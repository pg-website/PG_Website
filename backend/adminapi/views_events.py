"""Admin dashboard and events (contract 3.5: D01, E01-E10). Default deny: every view is an AdminView."""
from __future__ import annotations

import uuid
from datetime import timedelta

from django.db.models import Count, F, Max, Q, Sum
from django.utils import timezone

from content.models import Event, MediaAsset, RevalidationOutbox, Story, Testimonial
from core.errors import ValidationFailed
from core.idempotency import run_idempotent
from core.pagination import PagePagination
from core.responses import iso, now_iso, ok
from payments.models import PaymentMismatch
from registrations.models import Registration

from . import event_builder as eb
from . import event_service as svc
from .permissions import require_step_up
from .views import AdminView


class AdminPagePagination(PagePagination):
    """`page_size` (contract 2.3), also accepting the frontend spelling `pageSize`. Max 100."""

    def get_page_size(self, request):
        if 'page_size' not in request.query_params and 'pageSize' in request.query_params:
            try:
                return max(1, min(int(request.query_params['pageSize']), self.max_page_size))
            except (TypeError, ValueError):
                raise ValidationFailed(fields={'pageSize': ['Enter a whole number.']}) from None
        try:
            return super().get_page_size(request)
        except (TypeError, ValueError):
            raise ValidationFailed(fields={'page_size': ['Enter a whole number.']}) from None


def _object_body(request) -> dict:
    if not isinstance(request.data, dict):
        raise ValidationFailed(fields={'form': ['Send a JSON object.']})
    return request.data


# ---------------------------------------------------------------- D01

LIVE_FOR_DASHBOARD = ('published', 'registration_open', 'sold_out', 'ongoing')


def _attention(next_event, now):
    items = []

    def add(kind, message, count, href):
        if count > 0:
            items.append({'kind': kind, 'message': message, 'count': count, 'href': href})

    mismatches = PaymentMismatch.objects.filter(resolved_at__isnull=True).count()
    add('unreconciled_payment',
        f'{mismatches} payment{"s" if mismatches != 1 else ""} need{"" if mismatches != 1 else "s"} reconciling.',
        mismatches, '/admin/payments?filter=mismatch')
    no_alt = MediaAsset.objects.filter(decorative=False, alt='').count()
    add('media_missing_alt', f'{no_alt} image{"s" if no_alt != 1 else ""} missing alt text.', no_alt,
        '/admin/media?filter=missing-alt')
    no_consent = Testimonial.objects.filter(consent_at__isnull=True).count()
    add('testimonial_missing_consent',
        f'{no_consent} testimonial{"s" if no_consent != 1 else ""} without consent to publish.', no_consent,
        '/admin/testimonials?filter=missing-consent')
    if next_event is not None and next_event.capacity and next_event.confirmed_count * 10 >= next_event.capacity * 9:
        add('capacity_warning', f'{next_event.title} is almost full.', 1, f'/admin/events/{next_event.pk}')
    return items[:20]


def _website_health(now):
    pending = RevalidationOutbox.objects.filter(status='pending')
    stale = pending.filter(occurred_at__lt=now - timedelta(minutes=10)).exists()
    failed = RevalidationOutbox.objects.filter(status='failed', occurred_at__gte=now - timedelta(hours=24)).exists()
    last = RevalidationOutbox.objects.filter(action='published').aggregate(t=Max('occurred_at'))['t']
    return {'state': 'down' if failed else ('degraded' if stale else 'ok'),
            'lastPublishedAt': iso(last), 'pendingRevalidations': pending.count()}


class DashboardView(AdminView):
    def get(self, request):
        now = timezone.now()
        nxt = (Event.objects.filter(status__in=LIVE_FOR_DASHBOARD, ends_at__gte=now, starts_at__isnull=False)
               .order_by('starts_at').first())
        pending = (Registration.objects.filter(status__in=['pending', 'confirming'], amount_paise__gt=0)
                   .filter(Q(status='confirming') | Q(hold_expires_at__gt=now) | Q(payment_order_state='attempted'))
                   .aggregate(n=Count('id'), amount=Sum('amount_paise')))
        count = pending['n']
        data = {
            'event': None if nxt is None else {
                'id': str(nxt.pk), 'slug': nxt.slug, 'title': nxt.title, 'status': nxt.status,
                'startsAt': iso(nxt.starts_at), 'confirmed': nxt.confirmed_count, 'capacity': nxt.capacity,
                'firstTimers': nxt.first_timer_count},
            'pendingPayments': {'count': count, 'amountPaise': pending['amount'] or 0, 'currency': 'INR'},
            'websiteHealth': _website_health(now),
            'attention': _attention(nxt, now),
            'serverNow': iso(now),
        }
        return ok(data)


# ---------------------------------------------------------------- E01, E02

class EventsView(AdminView):
    def get(self, request):
        q = request.query_params
        errors = {}
        status, etype = q.get('status'), q.get('type')
        if status is not None and status not in [s for s, _ in Event.STATUSES]:
            errors['status'] = ['Choose one of the listed options.']
        if etype is not None and etype not in eb.EVENT_TYPE_DEFAULTS:
            errors['type'] = ['Choose one of the listed options.']
        search = (q.get('q') or '').strip()
        if len(search) > 100:
            errors['q'] = ['Use at most 100 characters.']
        if errors:
            raise ValidationFailed(fields=errors)
        qs = Event.objects.all()
        if status:
            qs = qs.filter(status=status)
        if etype:
            qs = qs.filter(type=etype)
        if search:
            qs = qs.filter(Q(title__icontains=search) | Q(slug__icontains=search))
        qs = qs.order_by(F('starts_at').desc(nulls_first=True), '-created_at', 'id')
        paginator = AdminPagePagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        ids = [e.pk for e in page]
        confirming = set(Registration.objects.filter(event_id__in=ids).filter(
            Q(status='confirming') | Q(status='pending', payment_order_state__in=['attempted', 'paid']))
            .values_list('event_id', flat=True))
        return paginator.get_paginated_response([eb.row_dto(e, confirming=e.pk in confirming) for e in page])

    def post(self, request):
        parsed = eb.parse_create(request.data)

        def work():
            event = svc.create_draft(request, parsed)
            return ok(eb.draft_dto(event), status=201)
        return run_idempotent(request, work)  # Idempotency-Key optional: a replay returns the original 201


# ---------------------------------------------------------------- E03, E04

class EventDetailView(AdminView):
    def get(self, request, event_id):
        return ok(eb.draft_dto(svc.get_event(event_id)))

    def patch(self, request, event_id):
        version, parsed = eb.parse_patch(request.data)
        event = svc.update_event(request, event_id, version, parsed)
        return ok(eb.draft_dto(event))


# ---------------------------------------------------------------- E05, E06

def _suggest(base: str, entity: str, exclude_id) -> str | None:
    for n in range(2, 30):
        suffix = f'-{n}'
        candidate = base[:80 - len(suffix)].rstrip('-') + suffix
        if len(candidate) >= 3 and _is_available(entity, candidate, exclude_id):
            return candidate
    return None


def _is_available(entity: str, slug: str, exclude_id) -> bool:
    model = Event if entity == 'event' else Story
    qs = model.objects.filter(slug__iexact=slug)
    if exclude_id is not None:
        qs = qs.exclude(pk=exclude_id)
    return not qs.exists()


class SlugCheckView(AdminView):
    def get(self, request):
        q = request.query_params
        errors = {}
        entity = q.get('type')
        if entity not in ('event', 'story'):
            errors['type'] = ['Choose event or story.']
        slug = q.get('slug', '')
        eb.valid_slug(_Collect(errors), 'slug', slug)
        exclude = None
        if q.get('excludeId'):
            try:
                exclude = uuid.UUID(q['excludeId'])
            except ValueError:
                errors['excludeId'] = ['Use a valid id.']
        if errors:
            raise ValidationFailed(fields=errors)
        if _is_available(entity, slug, exclude):
            return ok({'available': True})
        suggestion = _suggest(slug, entity, exclude)
        return ok({'available': False, **({'suggestion': suggestion} if suggestion else {})})


class _Collect:
    def __init__(self, errors):
        self.errors = errors

    def add(self, path, message):
        self.errors.setdefault(path, []).append(message)


class EventTypesView(AdminView):
    def get(self, request):
        return ok([{'type': t, 'label': label, 'defaultPairingMode': pairing, 'defaultRated': rated,
                    'engineAvailable': engine}
                   for t, (label, pairing, rated, engine) in eb.EVENT_TYPE_DEFAULTS.items()])


# ---------------------------------------------------------------- E07-E10

class PublishView(AdminView):
    def post(self, request, event_id):
        def work():
            event, now = svc.publish(request, event_id)
            return ok({'id': str(event.pk), 'slug': event.slug, 'status': event.status, 'publishedAt': iso(now),
                       'version': event.version})
        return run_idempotent(request, work, required=True)


class UnpublishView(AdminView):
    def post(self, request, event_id):
        def work():
            event = svc.unpublish(request, event_id)
            return ok({'id': str(event.pk), 'status': event.status, 'version': event.version})
        return run_idempotent(request, work)  # Idempotency-Key optional; a replay returns the original result


class OpenRegistrationView(AdminView):
    def post(self, request, event_id):
        def work():
            event = svc.open_registration(request, event_id)
            return ok({'id': str(event.pk), 'status': event.status, 'version': event.version})
        return run_idempotent(request, work, required=True)


class CloseRegistrationView(AdminView):
    def post(self, request, event_id):
        def work():
            event = svc.close_registration(request, event_id)
            return ok({
                'id': str(event.pk),
                'status': event.status,
                'closesAt': iso(event.registration_closes_at),
                'version': event.version,
            })
        return run_idempotent(request, work)


class DeleteEventView(AdminView):
    def delete(self, request, event_id):
        svc.delete_event(request, event_id)
        return ok({})


class CancelView(AdminView):
    def post(self, request, event_id):
        data = _object_body(request)
        errors = {}
        for key in data:
            if key not in ('reason', 'notifyParticipants', 'refund'):
                errors[str(key)[:60]] = ['This field cannot be changed here.']
        reason = data.get('reason')
        if not isinstance(reason, str) or not reason.strip():
            errors['reason'] = ['This is required.']
        elif len(reason.strip()) > 500:
            errors['reason'] = ['Use at most 500 characters.']
        for key in ('notifyParticipants', 'refund'):
            if not isinstance(data.get(key), bool):
                errors[key] = ['Choose true or false.']
        if errors:
            raise ValidationFailed(fields=errors)
        notify, refund = data['notifyParticipants'], data['refund']

        def work():
            eid = eb.parse_event_id(event_id)
            stepped_up = False
            if refund and svc.refundable_payments_exist(eid):
                require_step_up(request)  # refunds are step-up protected (contract 2.4)
                stepped_up = True
            event, cancelled_at, refunds = svc.cancel(request, event_id, reason=reason.strip(), notify=notify,
                                                      refund=refund, stepped_up=stepped_up)
            svc.execute_refunds(refunds)  # after commit; a provider outage leaves them pending for the retry job
            return ok({'id': str(event.pk), 'status': 'cancelled', 'cancelledAt': iso(cancelled_at),
                       'refundsQueued': len(refunds), 'version': event.version})
        return run_idempotent(request, work, required=True)


class CompleteView(AdminView):
    def post(self, request, event_id):
        data = request.data if request.data else {}
        if not isinstance(data, dict):
            raise ValidationFailed(fields={'form': ['Send a JSON object.']})
        errors = {str(k)[:60]: ['This field cannot be changed here.'] for k in data if k != 'publishArchive'}
        archive = data.get('publishArchive')
        if 'publishArchive' in data and not isinstance(archive, bool):
            errors['publishArchive'] = ['Choose true or false.']
        if errors:
            raise ValidationFailed(fields=errors)
        def work():
            event, now = svc.complete(request, event_id, publish_archive=archive)
            return ok({'id': str(event.pk), 'status': 'completed', 'completedAt': iso(now), 'version': event.version})
        return run_idempotent(request, work)  # Idempotency-Key optional; a replay returns the original result
