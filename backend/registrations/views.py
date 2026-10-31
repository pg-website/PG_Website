"""Registration (R01-R08) and player-area (M01-M09) endpoints. Role: authenticated player (default deny from settings).

Every response is `no-store`. Every object is looked up through the caller (`user=request.user`): there is no path
that takes a user id from the client. Another player's id answers NOT_FOUND / REGISTRATION_NOT_CONFIRMED.
"""
from __future__ import annotations

import re

from django.utils import timezone
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.views import APIView

from core import ratelimit
from core.clientip import client_ip
from core.errors import NotFound, ValidationFailed
from core.idempotency import run_idempotent
from core.pagination import PagePagination
from core.responses import iso, ok
from core.validation import Collector, require_object

from payments import services as payment_services

from . import profile, room, rules, selectors, services
from .dto import registration_dto
from .models import Registration

NO_STORE = 'no-store'
SNAPSHOT_LIMIT = ratelimit.Limit(12, ratelimit.MINUTE)  # contract 2.10: 12 per minute per user
PROFILE_LIMIT = ratelimit.Limit(60, ratelimit.MINUTE)  # per client IP, public read
COMMAND_LIMIT = ratelimit.Limit(30, ratelimit.MINUTE)


class PlayerView(APIView):
    permission_classes = [IsAuthenticated]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response['Cache-Control'] = NO_STORE
        return response


class PublicProfileView(APIView):
    """GET /players/{publicId}. Unauthenticated. Unknown, malformed, hidden, suspended and minor all give the SAME 404."""
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, public_id):
        ratelimit.check_and_hit('player-profile', client_ip(request), PROFILE_LIMIT)
        data = profile.public_profile(public_id)
        if data is None:
            raise NotFound('Player not found.')
        return ok(data, headers={'Cache-Control': 'public, max-age=0, s-maxage=60'})


def _limit(request, scope, limit):
    ratelimit.check_and_hit(scope, str(request.user.pk), limit)


def _page(view, request, queryset, to_dto):
    paginator = PagePagination()
    page = paginator.paginate_queryset(queryset, request, view=view)
    return paginator.get_paginated_response([to_dto(item) for item in page])


def _reg_for_dto(user, registration_id):
    return services.owned_registration(user, registration_id)


# ================================================================= R01-R08

class RegistrationStateView(PlayerView):
    """R01 GET /events/{slug}/registration. Read-only: expired holds are projected, never written here."""

    def get(self, request, slug):
        now = timezone.now()
        event = rules.find_public_event(slug)
        state, existing = rules.classify(event, request.user, now)
        data = {
            'state': state,
            'requiredProfileFields': rules.missing_profile_fields(request.user),
            'serverNow': iso(now),
        }
        priced = {'pricePaise': event.price_paise, 'currency': 'INR'}
        if state == 'open_free':
            data.update(pricePaise=0, currency='INR')
        elif state == 'open_paid':
            from . import conf
            data.update(**priced, holdMinutes=conf.hold_minutes())
        elif state == 'full_waitlist':
            data.update(**priced, waitlistPosition=rules.queue_length(event.pk) + 1)
        elif state == 'not_yet_open':
            data.update(**priced, opensAt=iso(event.registration_opens_at or event.starts_at))
        elif state == 'already_registered':
            existing.event = event
            data.update(**priced, registration=registration_dto(existing, now))
        elif state == 'ineligible':
            data.update(**priced, reason='profile_incomplete')
        else:  # sold_out, closed
            data.update(**priced)
        return ok(data)


def _slug_body(request, allowed):
    c = Collector(require_object(request.data))
    c.reject_unknown(allowed)
    slug = c.text('eventSlug', max_len=100)
    return c, slug


class ReserveView(PlayerView):
    """R02 POST /registrations (Idempotency-Key required)."""

    def post(self, request):
        def work():
            c, slug = _slug_body(request, {'eventSlug', 'profile'})
            profile = request.data.get('profile') if isinstance(request.data, dict) else None
            c.done()
            _limit(request, 'reg-command', COMMAND_LIMIT)
            reg = services.reserve(request.user, slug, profile)
            now = timezone.now()
            dto = registration_dto(reg, now)
            if reg.status == 'confirmed':
                return ok({'status': 'confirmed', 'registration': dto}, status=201)
            return ok({'status': 'pending', 'registration': dto, 'holdExpiresAt': iso(reg.hold_expires_at),
                       'serverNow': iso(now)}, status=201)
        return run_idempotent(request, work, required=True)


class WaitlistView(PlayerView):
    """R03 POST /registrations/waitlist (Idempotency-Key required)."""

    def post(self, request):
        def work():
            c, slug = _slug_body(request, {'eventSlug'})
            c.done()
            _limit(request, 'reg-command', COMMAND_LIMIT)
            reg, position = services.join_waitlist(request.user, slug)
            return ok({'registration': registration_dto(reg, timezone.now()), 'position': position}, status=201)
        return run_idempotent(request, work, required=True)


class PaymentOrderView(PlayerView):
    """R04 POST /payments/orders (Idempotency-Key required). Only the registration id is read from the browser."""

    def post(self, request):
        def work():
            c = Collector(require_object(request.data))
            c.reject_unknown({'registrationId'})
            rid = c.text('registrationId', max_len=36, min_len=36)
            c.done()
            _limit(request, 'pay-command', COMMAND_LIMIT)
            return ok(payment_services.create_order(request.user, rid))
        return run_idempotent(request, work, required=True)


PROVIDER_ID_RE = re.compile(r'^[A-Za-z0-9_]{1,64}$')


class PaymentVerifyView(PlayerView):
    """R05 POST /payments/verify (Idempotency-Key required): signature, provider fetch, exact amount check."""

    def post(self, request):
        def work():
            c = Collector(require_object(request.data))
            c.reject_unknown({'razorpay_order_id', 'razorpay_payment_id', 'razorpay_signature'})
            order_id = c.text('razorpay_order_id', max_len=64, pattern=PROVIDER_ID_RE)
            payment_id = c.text('razorpay_payment_id', max_len=64, pattern=PROVIDER_ID_RE)
            signature = c.text('razorpay_signature', max_len=128)
            c.done()
            _limit(request, 'pay-command', COMMAND_LIMIT)
            reg = payment_services.verify(request.user, order_id, payment_id, signature)
            return ok({'registration': registration_dto(reg, timezone.now())})
        return run_idempotent(request, work, required=True)


class RegistrationDetailView(PlayerView):
    """R06 GET /registrations/{id}: owner only."""

    def get(self, request, registration_id):
        reg = _reg_for_dto(request.user, registration_id)
        return ok(registration_dto(reg, timezone.now()))


class CancelView(PlayerView):
    """R07 POST /registrations/{id}/cancel (Idempotency-Key optional)."""

    def post(self, request, registration_id):
        def work():
            _limit(request, 'reg-command', COMMAND_LIMIT)
            reg = services.cancel(request.user, registration_id)
            return ok({'registration': registration_dto(reg, timezone.now())})
        return run_idempotent(request, work, required=False)


class AcceptOfferView(PlayerView):
    """R08 POST /registrations/{id}/accept-offer (Idempotency-Key required)."""

    def post(self, request, registration_id):
        def work():
            _limit(request, 'reg-command', COMMAND_LIMIT)
            reg = services.accept_offer(request.user, registration_id)
            return ok({'registration': registration_dto(reg, timezone.now())})
        return run_idempotent(request, work, required=True)


# ================================================================= M01-M04

class NextUpView(PlayerView):
    def get(self, request):
        return ok(selectors.next_up(request.user))


class RecentGamesView(PlayerView):
    def get(self, request):
        paginator = PagePagination()
        paginator.page_size = 5
        page = paginator.paginate_queryset(selectors.recent_games(request.user), request, view=self)
        return paginator.get_paginated_response(selectors.game_dtos(request.user, page))


class PeopleView(PlayerView):
    def get(self, request):
        return ok(selectors.people(request.user))


class MyRegistrationsView(PlayerView):
    def get(self, request):
        scope = request.query_params.get('scope', '')
        if scope not in ('upcoming', 'history'):
            raise ValidationFailed(fields={'scope': ['Choose one of the listed options.']})
        now = timezone.now()
        return _page(self, request, selectors.my_registrations(request.user, scope),
                     lambda reg: selectors.my_registration_dto(reg, now))


# ================================================================= M05-M09

class RoomView(PlayerView):
    def get(self, request, event_id):
        _limit(request, 'room-snapshot', SNAPSHOT_LIMIT)
        return ok(room.snapshot_for(request.user, event_id))


class CheckInView(PlayerView):
    def post(self, request, event_id):
        def work():
            _limit(request, 'reg-command', COMMAND_LIMIT)
            return ok(room.check_in(request.user, event_id))
        return run_idempotent(request, work, required=False)


class SubmitResultView(PlayerView):
    def post(self, request, event_id):
        def work():
            _limit(request, 'reg-command', COMMAND_LIMIT)
            return ok(room.submit_result(request.user, event_id, request.data))
        return run_idempotent(request, work, required=True)


class ConfirmResultView(PlayerView):
    def post(self, request, event_id, pairing_id):
        def work():
            _limit(request, 'reg-command', COMMAND_LIMIT)
            return ok(room.confirm_result(request.user, event_id, pairing_id))
        return run_idempotent(request, work, required=False)


class DisputeResultView(PlayerView):
    def post(self, request, event_id, pairing_id):
        def work():
            _limit(request, 'reg-command', COMMAND_LIMIT)
            return ok(room.dispute_result(request.user, event_id, pairing_id, request.data))
        return run_idempotent(request, work, required=False)
