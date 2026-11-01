"""Event control room (contract 3.6: C01-C05, C13, C16, C17). Reads and the registration/check-in/recap writes.

Registration and payment state change only through `act` (C03) and the refund path (DEC-B04). Every write is one
`transaction.atomic()` holding the event row lock, the change and the strict audit row; provider calls (refund
execution) run only after the commit. Registration PII (email, phone) is returned only here, only to admins.
"""
from __future__ import annotations

import csv
import io
import re
import uuid
from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Exists, F, OuterRef, Q, Value
from django.utils import timezone
from django.utils.dateparse import parse_datetime

import audit
from accounts.models import User
from audit.models import AuditLog
from content.models import Event
from core.errors import EventNotFound, NotFound, RegistrationNotConfirmed, ValidationFailed, VersionConflict
from core.responses import iso
from payments import services as pay_services
from payments.models import Payment, PaymentMismatch, PaymentOrder, PaymentRefund
from registrations import conf, rules
from registrations import services as reg_services
from registrations.dto import current_ratings, pool_of
from registrations.models import Pairing, Registration, Round

from . import event_builder as eb
from . import event_service as svc
from . import media_service as ms_
from .permissions import require_step_up

ZERO_UUID = str(uuid.UUID(int=0))
WEB_REG_STATUSES = ('pending', 'confirming', 'confirmed', 'waitlist', 'cancelled', 'refunded')
WEB_PAYMENT_STATES = ('created', 'attempted', 'paid', 'failed', 'expired', 'refunded')
ACTIONS = ('cancel', 'move_to_waitlist', 'promote', 'mark_welcomed', 'set_pairing_active')
DESK_FILTERS = ('all', 'arrived', 'not_arrived', 'first_timers_unwelcomed')
OVER = ('cancelled', 'completed')


# ---------------------------------------------------------------- shared helpers

def control_event(event_id) -> Event:
    """The event of a control-room route. A draft has no control room (404), like an unknown id."""
    event = svc.get_event(event_id)
    if event.status == 'draft':
        raise EventNotFound()
    return event


def _flag(allowed: bool, reason: str = '') -> dict:
    return {'allowed': True} if allowed else {'allowed': False, 'reason': reason}


def _name(user) -> str:
    return (user.name or '').strip()[:80] or 'Player'


def with_first_timer(qs, event: Event):
    """Annotate `is_first`: no confirmed registration at an earlier event (same rule as the round desk)."""
    if event.starts_at is None:
        return qs.annotate(is_first=Value(True))
    seen = (Registration.objects.filter(user_id=OuterRef('user_id'), status='confirmed',
                                        event__starts_at__lt=event.starts_at).exclude(event_id=event.pk))
    return qs.annotate(is_first=~Exists(seen))


def _page_meta(paginator) -> dict:
    p = paginator.page.paginator
    return {'page': paginator.page.number, 'pageSize': paginator.get_page_size(paginator.request),
            'total': p.count, 'totalPages': p.num_pages if p.count else 0}


def _parse_bool(q, key, errors):
    raw = q.get(key)
    if raw is None:
        return None
    if raw not in ('true', 'false'):
        errors[key] = ['Choose true or false.']
        return None
    return raw == 'true'


def _parse_enum(q, key, allowed, errors):
    raw = q.get(key)
    if raw is None:
        return None
    if raw not in allowed:
        errors[key] = ['Choose one of the listed options.']
        return None
    return raw


def _parse_search(q, errors):
    raw = (q.get('q') or '').strip()
    if len(raw) > 100:
        errors['q'] = ['Use at most 100 characters.']
    return raw


def _search_q(raw: str) -> Q:
    cond = Q(user__name__icontains=raw) | Q(user__phone__icontains=raw)
    try:
        cond |= Q(pk=uuid.UUID(raw))
    except ValueError:
        pass
    return cond


def _web_status(reg: Registration, now) -> str:
    eff = rules.effective_status(reg, now)
    return {'offer': 'waitlist', 'expired': 'cancelled'}.get(eff, eff)


def free_seats(event: Event, now) -> int:
    if event.capacity is None:
        return 100000  # unlimited: a seat is always free
    return max(event.capacity - rules.occupied(event.pk, now), 0)


# ---------------------------------------------------------------- C02 row DTO and capabilities

def capabilities(reg: Registration, event: Event, now, *, first_timer: bool, free: int) -> dict:
    eff = rules.effective_status(reg, now)
    active = eff in ('pending', 'confirming', 'confirmed', 'waitlist', 'offer')
    over = event.status in OVER
    if over:
        gone = f'The event is {event.status}.'
        not_over = _flag(False, gone)
    else:
        gone, not_over = '', _flag(True)
    inactive = _flag(False, 'This registration is not active.')

    can_cancel = not_over if over else (_flag(True) if active else inactive)

    if over:
        can_wl = not_over
    elif not event.waitlist_enabled:
        can_wl = _flag(False, 'This event has no waitlist.')
    elif eff not in ('pending', 'confirmed', 'offer'):
        can_wl = inactive if not active else _flag(False, 'Only a confirmed, reserved or offered place can move.')
    elif reg.payment_order_state in ('attempted', 'paid') or (eff == 'confirmed' and reg.amount_paise > 0):
        can_wl = _flag(False, 'This place is paid. Cancel it to refund instead.')
    else:
        can_wl = _flag(True)

    if over:
        can_promote = not_over
    elif eff != 'waitlist':
        can_promote = _flag(False, 'Only a waitlisted player can be offered a place.')
    elif not reg_services._event_open_for_promotion(event, now):
        can_promote = _flag(False, 'This event is no longer taking players.')
    elif free <= 0:
        can_promote = _flag(False, 'There is no free place to offer.')
    else:
        can_promote = _flag(True)

    if eff != 'confirmed':
        can_welcome = _flag(False, 'Only a confirmed player can be welcomed.')
    elif not first_timer:
        can_welcome = _flag(False, 'This is not a first-time player.')
    elif reg.welcomed_at is not None:
        can_welcome = _flag(False, 'This player has already been welcomed.')
    else:
        can_welcome = _flag(True)

    if over:
        can_pair = not_over
    elif eff != 'confirmed':
        can_pair = _flag(False, 'Only a confirmed player is paired.')
    else:
        can_pair = _flag(True)

    return {'canCancel': can_cancel, 'canMoveToWaitlist': can_wl, 'canPromote': can_promote,
            'canMarkWelcomed': can_welcome, 'canSetPairingActive': can_pair}


def registration_dto(reg: Registration, event: Event, now, *, rating, first_timer: bool, free: int) -> dict:
    user = reg.user
    return {
        'id': str(reg.pk), 'playerId': str(user.pk), 'name': _name(user), 'email': user.email,
        'phone': user.phone or None, 'rating': rating, 'firstTimer': first_timer,
        'status': _web_status(reg, now),
        'paymentState': None if reg.payment_order_state == 'none' else reg.payment_order_state,
        'checkedInAt': iso(reg.checked_in_at), 'welcomed': reg.welcomed_at is not None,
        'pairingActive': reg.pairing_active, 'registeredAt': iso(reg.created_at),
        'capabilities': capabilities(reg, event, now, first_timer=first_timer, free=free), 'version': reg.version,
    }


def _registration_dtos(rows, event, now) -> list[dict]:
    ratings = current_ratings([r.user_id for r in rows], pool_of(event)) if rows else {}
    free = free_seats(event, now)
    return [registration_dto(r, event, now, rating=ratings.get(r.user_id), first_timer=bool(r.is_first), free=free)
            for r in rows]


def list_registrations(request, event: Event, pagination_cls):
    q = request.query_params
    errors: dict = {}
    search = _parse_search(q, errors)
    payment = _parse_enum(q, 'payment', WEB_PAYMENT_STATES, errors)
    status = _parse_enum(q, 'status', WEB_REG_STATUSES, errors)
    first = _parse_bool(q, 'firstTimer', errors)
    if errors:
        raise ValidationFailed(fields=errors)
    qs = with_first_timer(Registration.objects.filter(event=event).select_related('user'), event)
    if search:
        qs = qs.filter(_search_q(search))
    if payment:
        qs = qs.filter(payment_order_state=payment)
    if status:
        qs = qs.filter(status__in=['waitlist', 'offer'] if status == 'waitlist' else [status])
    if first is not None:
        qs = qs.filter(is_first=first)
    qs = qs.order_by('-created_at', 'id')
    paginator = pagination_cls()
    rows = list(paginator.paginate_queryset(qs, request))
    return paginator, _registration_dtos(rows, event, timezone.now())


# ---------------------------------------------------------------- C03 actions

def _parse_action(data) -> tuple[str, str]:
    if not isinstance(data, dict):
        raise ValidationFailed(fields={'form': ['Send a JSON object.']})
    errors = {str(k)[:60]: ['This field cannot be changed here.'] for k in data if k not in ('action', 'reason')}
    action, reason = data.get('action'), data.get('reason')
    if action not in ACTIONS:
        errors['action'] = ['Choose one of the listed options.']
    if reason is not None and (not isinstance(reason, str) or not reason.strip() or len(reason.strip()) > 500):
        errors['reason'] = ['Use 1 to 500 characters.']
    elif action in ('cancel', 'move_to_waitlist') and reason is None:
        errors['reason'] = ['A reason is required.']
    if errors:
        raise ValidationFailed(fields=errors)
    return action, (reason or '').strip()


def _refundable(reg_id) -> list[Payment]:
    return list(Payment.objects.filter(order__registration_id=reg_id, status='captured', flagged=False))


def act(request, event_id, reg_id, data) -> tuple[dict, list]:
    """-> (AdminRegistrationDto, refunds). `refunds` are pending rows to execute after the caller's commit."""
    action, reason = _parse_action(data)
    try:
        rid = uuid.UUID(str(reg_id))
    except ValueError:
        raise NotFound() from None
    event = control_event(event_id)
    if action == 'cancel' and _refundable(rid):
        require_step_up(request)  # a cancel that refunds money is step-up protected (contract 2.4)
    refunds: list = []
    with transaction.atomic():
        event = reg_services.lock_event(event.pk)
        reg = (Registration.objects.select_for_update(of=('self',)).select_related('user')
               .filter(pk=rid, event_id=event.pk).first())
        if reg is None:
            raise NotFound()
        reg.event = event
        now = timezone.now()
        first = with_first_timer(Registration.objects.filter(pk=reg.pk), event).filter(is_first=True).exists()
        caps = capabilities(reg, event, now, first_timer=first, free=free_seats(event, now))
        cap = caps[{'cancel': 'canCancel', 'move_to_waitlist': 'canMoveToWaitlist', 'promote': 'canPromote',
                    'mark_welcomed': 'canMarkWelcomed', 'set_pairing_active': 'canSetPairingActive'}[action]]
        if not cap['allowed']:
            raise ValidationFailed(fields={'action': [cap['reason']]})
        before_status = _web_status(reg, now)
        audit_after: dict = {}
        audit_name = f'registration.{action}'
        changed = ['updated_at', 'version']

        if action == 'cancel':
            was_confirmed = reg.status == 'confirmed'
            paid_payments = _refundable(reg.pk)
            reg.status = 'cancelled'
            reg.cancelled_at = now
            reg.offer_expires_at = None
            reg.hold_expires_at = None
            if reg.payment_order_state == 'created':
                reg.payment_order_state = 'expired'
                reg_services._expire_order(reg)
            reg.version += 1
            reg.save()
            if was_confirmed:
                reg_services.adjust_confirmed(event.pk, -1)
            for payment in paid_payments:
                try:
                    refunds.append(pay_services.refund_payment(payment, reason='cancellation', execute=False))
                except pay_services.RefundError as exc:
                    raise ValidationFailed(fields={'action': [f'The refund could not start ({exc}).']}) from None
            reg_services.settle_event(event, now)
            audit_after = {'status': 'cancelled', 'refundsQueued': len(refunds)}
        elif action == 'move_to_waitlist':
            reg.version += 1
            released = reg_services.move_to_waitlist(reg, now)  # saves the row
            if released:
                reg_services.settle_event(event, now)
            audit_after = {'status': 'waitlist'}
        elif action == 'promote':
            reg_services.offer_registration(reg, now)
            reg.version += 1
            reg.save(update_fields=changed)
            audit_after = {'status': 'offer'}
        elif action == 'mark_welcomed':
            reg.welcomed_at, reg.welcomed_by = now, request.user
            reg.version += 1
            reg.save(update_fields=['welcomed_at', 'welcomed_by', *changed])
            audit_after = {'welcomed': True}
        else:  # set_pairing_active: toggles
            reg.pairing_active = not reg.pairing_active
            reg.version += 1
            reg.save(update_fields=['pairing_active', *changed])
            audit_after = {'pairingActive': reg.pairing_active}
        audit.write(request, action=audit_name, object_type='registration', object_id=reg.pk, reason=reason,
                    before={'status': before_status, 'eventId': str(event.pk)},
                    after={**audit_after, 'eventId': str(event.pk)})
        reg.refresh_from_db()
        reg.event = event
        reg.user = User.objects.get(pk=reg.user_id)
        now = timezone.now()
        dto = registration_dto(reg, event, now, rating=current_ratings([reg.user_id], pool_of(event)).get(reg.user_id),
                               first_timer=first, free=free_seats(event, now))
    return dto, refunds


def execute_refunds(refunds) -> None:
    svc.execute_refunds(refunds)


# ---------------------------------------------------------------- C04 / C05 check-in desk

def _arrival_counts(event: Event) -> dict:
    agg = Registration.objects.filter(event=event, status='confirmed').aggregate(
        expected=Count('id'), arrived=Count('id', filter=Q(checked_in_at__isnull=False)))
    return {'arrived': agg['arrived'], 'expected': agg['expected']}


def set_check_in(request, event_id, data) -> dict:
    if not isinstance(data, dict):
        raise ValidationFailed(fields={'form': ['Send a JSON object.']})
    errors = {str(k)[:60]: ['This field cannot be changed here.'] for k in data if k not in ('registrationId', 'state')}
    rid = None
    try:
        rid = uuid.UUID(str(data.get('registrationId')))
    except ValueError:
        errors['registrationId'] = ['Use a valid id.']
    state = data.get('state')
    if state not in ('checked_in', 'not_checked_in'):
        errors['state'] = ['Choose one of the listed options.']
    if errors:
        raise ValidationFailed(fields=errors)
    event = control_event(event_id)
    if event.status == 'cancelled':
        raise ValidationFailed(fields={'form': ['A cancelled event has no check-in.']})
    with transaction.atomic():
        reg = (Registration.objects.select_for_update(of=('self',)).filter(pk=rid, event_id=event.pk).first())
        if reg is None:
            raise NotFound()
        if reg.status != 'confirmed':
            raise RegistrationNotConfirmed()
        now = timezone.now()
        want_in = state == 'checked_in'
        if (reg.checked_in_at is not None) != want_in:
            before = {'checkedIn': reg.checked_in_at is not None, 'source': reg.check_in_source or None}
            reg.checked_in_at = now if want_in else None
            reg.check_in_source = 'host' if want_in else ''
            reg.version += 1
            reg.save(update_fields=['checked_in_at', 'check_in_source', 'version', 'updated_at'])
            audit.write(request, action='checkin.set', object_type='registration', object_id=reg.pk,
                        before={**before, 'eventId': str(event.pk)},
                        after={'checkedIn': want_in, 'source': 'host' if want_in else None, 'eventId': str(event.pk)})
        return {'registrationId': str(reg.pk), 'checkedInAt': iso(reg.checked_in_at),
                'counts': _arrival_counts(event), 'serverNow': iso(now)}


def set_check_in_all(request, event_id) -> dict:
    """Host-desk "check in everyone": every confirmed player not yet arrived. One audit row for the whole batch."""
    event = control_event(event_id)
    if event.status == 'cancelled':
        raise ValidationFailed(fields={'form': ['A cancelled event has no check-in.']})
    with transaction.atomic():
        now = timezone.now()
        ids = list(Registration.objects.select_for_update(of=('self',))
                   .filter(event=event, status='confirmed', checked_in_at__isnull=True).values_list('pk', flat=True))
        if ids:
            Registration.objects.filter(pk__in=ids).update(
                checked_in_at=now, check_in_source='host', version=F('version') + 1, updated_at=now)
            audit.write(request, action='checkin.set', object_type='event', object_id=event.pk,
                        before={'checkedIn': 0, 'eventId': str(event.pk)},
                        after={'checkedIn': len(ids), 'source': 'host', 'eventId': str(event.pk)})
        return {'checkedIn': len(ids), 'counts': _arrival_counts(event), 'serverNow': iso(now)}


def desk(request, event: Event, pagination_cls) -> dict:
    q = request.query_params
    errors: dict = {}
    search = _parse_search(q, errors)
    flt = _parse_enum(q, 'filter', DESK_FILTERS, errors) or 'all'
    if errors:
        raise ValidationFailed(fields=errors)
    base = with_first_timer(Registration.objects.filter(event=event, status='confirmed'), event)
    agg = base.aggregate(expected=Count('id'), arrived=Count('id', filter=Q(checked_in_at__isnull=False)),
                         waiting=Count('id', filter=Q(is_first=True, welcomed_at__isnull=True)))
    qs = base.select_related('user', 'welcomed_by')
    if search:
        qs = qs.filter(_search_q(search))
    if flt == 'arrived':
        qs = qs.filter(checked_in_at__isnull=False)
    elif flt == 'not_arrived':
        qs = qs.filter(checked_in_at__isnull=True)
    elif flt == 'first_timers_unwelcomed':
        qs = qs.filter(is_first=True, welcomed_at__isnull=True)
    qs = qs.order_by('user__name', 'id')
    paginator = pagination_cls()
    rows = list(paginator.paginate_queryset(qs, request))
    items = [{'registrationId': str(r.pk), 'name': _name(r.user), 'firstTimer': bool(r.is_first),
              'welcomed': r.welcomed_at is not None,
              'assignee': _name(r.welcomed_by) if r.welcomed_by_id else None,
              'checkedInAt': iso(r.checked_in_at),
              'checkInSource': None if r.checked_in_at is None else ('desk' if r.check_in_source == 'host' else 'self')}
             for r in rows]
    return {'counts': {'expected': agg['expected'], 'arrived': agg['arrived'], 'firstTimersWaiting': agg['waiting']},
            'rows': {'items': items, 'pagination': _page_meta(paginator)},
            'serverNow': iso(timezone.now()), 'version': event.version}


# ---------------------------------------------------------------- C01 overview

def _can_complete(event: Event, now) -> dict:
    if event.status not in eb.LIVE_STATUSES + ('ongoing',):
        return _flag(False, f'A {event.status.replace("_", " ")} event cannot be completed.')
    if event.starts_at is None or event.starts_at > now:
        return _flag(False, 'Only an event that has started can be completed.')
    return _flag(True)


def overview(event: Event) -> dict:
    now = timezone.now()
    base = Registration.objects.filter(event=event)
    agg = base.aggregate(
        confirmed=Count('id', filter=Q(status='confirmed')),
        waitlist=Count('id', filter=Q(status='waitlist') | Q(status='offer', offer_expires_at__gt=now)),
        checked_in=Count('id', filter=Q(status='confirmed', checked_in_at__isnull=False)))
    firsts = with_first_timer(base.filter(status='confirmed'), event).filter(is_first=True).aggregate(
        total=Count('id'), welcomed=Count('id', filter=Q(welcomed_at__isnull=False)))
    rounds = list(Round.objects.filter(event=event).exclude(state='void').order_by('-number').values_list(
        'number', 'state'))
    current = rounds[0] if rounds else None
    open_rounds = any(s in ('draft', 'published', 'live') for _n, s in rounds)
    started = any(s in ('live', 'completed') for _n, s in rounds)
    opens = event.starts_at - timedelta(minutes=conf.checkin_opens_minutes_before())
    due_close = event.registration_closes_at or event.starts_at

    def item(key, label, due, done):
        return {'key': key, 'label': label, 'dueAt': iso(due), 'done': bool(done)}

    run = [
        item('registration_closes', 'Registration closes', due_close, now >= due_close),
        item('checkin_opens', 'Check-in opens', opens, now >= opens),
        item('welcome_first_timers', 'Welcome first-time players', event.starts_at,
             firsts['total'] == firsts['welcomed']),
        item('round_1_starts', 'Start the first round', event.starts_at, started),
        item('rounds_finalised', 'Finalise every round', event.ends_at, bool(rounds) and not open_rounds),
        item('event_completed', 'Complete the event', event.ends_at, event.status == 'completed'),
        item('recap_published', 'Publish the recap and gallery', None, event.archive_published),
    ]
    caps = eb.capabilities(event)
    return {
        'eventId': str(event.pk), 'slug': event.slug, 'title': event.title, 'status': event.status,
        'startsAt': iso(event.starts_at),
        'summary': {'confirmed': agg['confirmed'], 'waitlist': agg['waitlist'], 'firstTimers': firsts['total'],
                    'checkedIn': agg['checked_in'], 'capacity': event.capacity},
        'arrival': {'checkedIn': agg['checked_in'], 'expected': agg['confirmed'],
                    'welcomedFirstTimers': firsts['welcomed']},
        'pairing': {'mode': event.pairing_mode, 'roundsPlanned': event.rounds_planned,
                    'currentRound': current[0] if current else 0, 'currentRoundState': current[1] if current else None},
        'runOfShow': run,
        'capabilities': {'canComplete': _can_complete(event, now), 'canCancel': caps['canCancel'],
                         'canPublish': caps['canPublish'], 'canUnpublish': caps['canUnpublish'],
                         'canOpenRegistration': caps['canOpenRegistration'],
                         'canCloseRegistration': caps['canCloseRegistration']},
        'serverNow': iso(now), 'version': event.version,
    }


# ---------------------------------------------------------------- C13 payments

MISMATCH_KIND = {'AMOUNT': 'amount', 'CURRENCY': 'currency', 'ORDER': 'order_id', 'ORDER_UNKNOWN': 'order_id',
                 'STATUS': 'status', 'MISSING_PROVIDER': 'missing_at_provider'}


def _money(paise) -> str:
    return f'INR {paise / 100:.2f}' if paise is not None else 'unknown'


def _mismatch_dto(row: PaymentMismatch | None) -> dict:
    if row is None:
        return {'mismatch': False}
    if row.reason == 'AMOUNT':
        detail = f'Expected {_money(row.expected_amount_paise)}, provider reported {_money(row.actual_amount_paise)}.'
    elif row.reason == 'CURRENCY':
        detail = f'Expected {row.expected_currency or "unknown"}, provider reported {row.actual_currency or "unknown"}.'
    elif row.reason == 'MISSING_PROVIDER':
        detail = 'The provider has no record of this payment.'
    elif row.reason == 'STATUS':
        detail = 'The provider payment status or refunded amount differs from our ledger.'
    else:
        detail = 'The provider record does not match our order.'
    return {'mismatch': True, 'kind': MISMATCH_KIND.get(row.reason, 'status'), 'detail': detail,
            'detectedAt': iso(row.created_at)}


def _row_payment(payments):
    """The payment that represents an order: a captured or refunded one first, else the newest."""
    best = None
    for p in payments:
        rank = 1 if p.status in ('captured', 'refunded') else 0
        key = (rank, p.created_at)
        if best is None or key > best[0]:
            best = (key, p)
    return None if best is None else best[1]


def list_payments(request, event: Event, pagination_cls):
    q = request.query_params
    errors: dict = {}
    status = _parse_enum(q, 'status', WEB_PAYMENT_STATES, errors)
    mismatch = _parse_bool(q, 'mismatch', errors)
    if errors:
        raise ValidationFailed(fields=errors)
    open_mm = PaymentMismatch.objects.filter(resolved_at__isnull=True)
    qs = PaymentOrder.objects.filter(registration__event=event).select_related('user', 'registration')
    if status:
        qs = qs.filter(state=status)
    if mismatch is not None:
        has = Exists(open_mm.filter(Q(order_id=OuterRef('pk')) | Q(payment__order_id=OuterRef('pk'))))
        qs = qs.filter(has) if mismatch else qs.filter(~has)
    qs = qs.order_by('-updated_at', 'id')
    paginator = pagination_cls()
    orders = list(paginator.paginate_queryset(qs, request))
    return paginator, payment_rows(orders)


def payment_rows(orders, *, with_event: bool = False) -> list[dict]:
    """Ledger DTOs (C13 / G04) for one page of orders. `with_event` adds the G04 event fields."""
    ids = [o.pk for o in orders]
    by_order: dict = {i: [] for i in ids}
    for p in Payment.objects.filter(order_id__in=ids):
        by_order[p.order_id].append(p)
    pending_refunds = set(PaymentRefund.objects.filter(payment__order_id__in=ids, state='pending')
                          .values_list('payment_id', flat=True))
    mm: dict = {}
    open_mm = PaymentMismatch.objects.filter(resolved_at__isnull=True)
    for row in open_mm.filter(Q(order_id__in=ids) | Q(payment__order_id__in=ids)).select_related('payment').order_by(
            'created_at'):
        mm[row.order_id or row.payment.order_id] = row  # newest wins
    items = []
    for o in orders:
        payments = by_order[o.pk]
        pay = _row_payment(payments)
        remaining = (pay.amount_paise - pay.refunded_paise) if pay else 0
        in_flight = pay is not None and pay.pk in pending_refunds
        if pay is None:
            can = _flag(False, 'There is no captured payment to refund.')
        elif pay.status != 'captured':
            can = _flag(False, 'Only a captured payment can be refunded.')
        elif pay.flagged:
            can = _flag(False, 'This payment does not match the order and needs reconciling first.')
        elif in_flight:
            can = _flag(False, 'A refund is already in progress.')
        elif remaining <= 0:
            can = _flag(False, 'Nothing is left to refund.')
        else:
            can = _flag(True)
        updated = max([o.updated_at] + [p.updated_at for p in payments])
        items.append({
            'id': str((pay or o).pk), 'registrationId': str(o.registration_id), 'playerName': _name(o.user),
            'amountPaise': o.amount_paise, 'currency': o.currency, 'state': o.state,
            'refundState': o.registration.refund_state,
            'providerOrderId': o.provider_order_id,
            'providerPaymentId': pay.provider_payment_id if pay else None,
            'refundedPaise': sum(p.refunded_paise for p in payments), 'updatedAt': iso(updated),
            'capabilities': {'canRefund': can}, 'version': o.registration.version,
            'mismatch': _mismatch_dto(mm.get(o.pk)),
        })
        if with_event:
            ev = o.registration.event
            items[-1].update({'eventId': str(ev.pk), 'eventSlug': ev.slug, 'eventTitle': ev.title[:120]})
    return items


# ---------------------------------------------------------------- C16 recap

def recap_dto(event: Event) -> dict:
    can = (_flag(True) if event.status == 'completed'
           else _flag(False, 'The archive can be published only after the event is completed.'))
    last = None
    if event.updated_by_id:
        last = {'by': {'id': str(event.updated_by_id), 'name': (event.updated_by.name or 'Admin')[:80]},
                'at': iso(event.updated_at), 'summary': event.last_change_summary or None}
    return {'eventId': str(event.pk), 'recap': event.recap or '',
            'assetIds': ms_.gallery_dto(event.archive_gallery if event.archive_gallery_id else None)['assetIds'],
            'archivePublished': event.archive_published, 'archivePublishedAt': iso(event.archive_published_at),
            'canPublishArchive': can, 'version': event.version, 'lastChange': last}


def update_recap(request, event_id, data) -> Event:
    if not isinstance(data, dict):
        raise ValidationFailed(fields={'form': ['Send a JSON object.']})
    errors = {str(k)[:60]: ['This field cannot be changed here.']
              for k in data if k not in ('version', 'recap', 'assetIds', 'publishArchive')}
    version = data.get('version')
    if not isinstance(version, int) or isinstance(version, bool) or version < 0:
        errors['version'] = ['Send the version you loaded.']
    recap = data.get('recap')
    if 'recap' in data and (not isinstance(recap, str) or len(recap.strip()) > 4000):
        errors['recap'] = ['Use at most 4000 characters.']
    asset_ids = None
    if 'assetIds' in data:
        asset_ids, id_errors = ms_.parse_asset_ids(data['assetIds'], 'assetIds')
        errors.update(id_errors)
    publish = data.get('publishArchive')
    if 'publishArchive' in data and not isinstance(publish, bool):
        errors['publishArchive'] = ['Choose true or false.']
    if errors:
        raise ValidationFailed(fields=errors)
    control_event(event_id)
    with transaction.atomic():
        event = svc._locked_event(event_id)
        if event.version != version:
            raise VersionConflict()
        if event.status != 'completed':
            raise ValidationFailed(fields={'form': ['The recap can be edited only after the event is completed.']})
        before, after = {}, {}
        if 'recap' in data and recap.strip() != event.recap:
            before['recap'], after['recap'] = f'{len(event.recap)} characters', f'{len(recap.strip())} characters'
            event.recap = recap.strip()
        if asset_ids is not None:
            current = event.archive_gallery if event.archive_gallery_id else None
            cur_ids = ms_.gallery_asset_ids(current)
            if asset_ids != cur_ids:
                before['assetIds'], after['assetIds'] = [str(i) for i in cur_ids], [str(i) for i in asset_ids]
                gallery = ms_.set_gallery('event_archive', event.pk, current, {'asset_ids': asset_ids}, 'assetIds')
                event.archive_gallery = gallery
        action = 'event.recap_update'
        if publish is not None and publish != event.archive_published:
            before['archivePublished'], after['archivePublished'] = event.archive_published, publish
            event.archive_published = publish
            event.archive_published_at = timezone.now() if publish else event.archive_published_at
            action = 'archive.publish' if publish else 'archive.unpublish'
            # Recompute standings when publishing so they reflect any post-completion corrections.
            if publish:
                from registrations import room as reg_room
                from registrations.models import Round
                rounds = list(Round.objects.filter(event=event).exclude(state='void'))
                if rounds:
                    rows = reg_room.standings(event, rounds)
                    public = reg_room.public_rows(rows)
                    event.standings = public
                    event.rounds_played = len([r for r in rounds if r.state == 'completed'])
                    event.winner = public[0]['identity'] if public else None
        if not after:
            return event
        # Saving a public event writes its `event/updated` outbox row in this transaction (content.signals).
        svc._save(event, request.user, 'Updated the recap' if action == 'event.recap_update'
                  else ('Published the archive' if publish else 'Unpublished the archive'))
        audit.write(request, action=action, object_type='event', object_id=event.pk, before=before, after=after)
    return event


# ---------------------------------------------------------------- C17 audit

# Backend audit action -> the web `auditActionSchema` value. Anything not listed is not shown in the event log.
AUDIT_WEB = {
    'event.create': 'event.created', 'event.update': 'event.updated', 'event.update_operational': 'event.updated',
    'event.recap_update': 'event.updated', 'archive.unpublish': 'event.updated',
    'event.publish': 'event.published', 'event.unpublish': 'event.unpublished', 'event.cancel': 'event.cancelled',
    'event.complete': 'event.completed',
    'registration.cancel': 'registration.cancelled', 'registration.move_to_waitlist': 'registration.moved_to_waitlist',
    'registration.promote': 'registration.promoted', 'checkin.set': 'checkin.set',
    'round.generate': 'round.generated', 'round.pairings.edit': 'round.edited', 'round.pairings.correct': 'round.edited',
    'round.publish': 'round.published', 'round.start': 'round.started', 'round.finalise': 'round.finalised',
    'round.result.record': 'result.recorded', 'round.result.resolve': 'result.resolved',
    'payment.refund': 'payment.refunded', 'message.send': 'message.sent', 'archive.publish': 'archive.published',
}
WEB_AUDIT = {}
for _backend, _web in AUDIT_WEB.items():
    WEB_AUDIT.setdefault(_web, []).append(_backend)
AUDIT_CSV_MAX = 10000
_DANGEROUS = ('=', '+', '-', '@', '\t', '\r')


def csv_cell(value) -> str:
    """Neutralise spreadsheet formula injection: a cell starting with = + - @ tab or CR gets a leading single quote."""
    text = '' if value is None else str(value)
    return "'" + text if text.startswith(_DANGEROUS) else text


def _event_scope_q(event: Event) -> Q:
    rounds = list(Round.objects.filter(event=event).values_list('pk', flat=True))
    pairings = list(Pairing.objects.filter(round__event=event).values_list('pk', flat=True))
    regs = list(Registration.objects.filter(event=event).values_list('pk', flat=True))
    pays = list(Payment.objects.filter(order__registration__event=event).values_list('pk', flat=True))
    scope = Q(object_type='event', object_id=str(event.pk))
    for kind, ids in (('round', rounds), ('pairing', pairings), ('registration', regs), ('payment', pays)):
        if ids:
            scope |= Q(object_type=kind, object_id__in=[str(i) for i in ids])
    return scope


def _audit_query(request, event: Event):
    q = request.query_params
    errors: dict = {}
    actor = None
    if q.get('actor') is not None:
        try:
            actor = uuid.UUID(q['actor'])
        except ValueError:
            errors['actor'] = ['Use a valid id.']
    action = _parse_enum(q, 'action', tuple(WEB_AUDIT), errors)
    bounds = {}
    for key in ('from', 'to'):
        raw = q.get(key)
        if raw is None:
            continue
        try:
            parsed = parse_datetime(raw.replace(' ', '+')) if raw else None
        except ValueError:
            parsed = None
        if parsed is None or parsed.tzinfo is None:
            errors[key] = ['Use an ISO date and time with an offset.']
        else:
            bounds[key] = parsed
    if errors:
        raise ValidationFailed(fields=errors)
    qs = AuditLog.objects.filter(_event_scope_q(event)).filter(action__in=list(AUDIT_WEB))
    if actor:
        qs = qs.filter(actor_id=actor)
    if action:
        qs = qs.filter(action__in=WEB_AUDIT[action])
    if 'from' in bounds:
        qs = qs.filter(occurred_at__gte=bounds['from'])
    if 'to' in bounds:
        qs = qs.filter(occurred_at__lte=bounds['to'])
    return qs.select_related('actor').order_by('-occurred_at', '-id')


def _summary(row: AuditLog) -> str | None:
    if row.reason:
        return re.sub(r'\s+', ' ', row.reason).strip()[:500] or None
    after, before = row.after, row.before
    if not isinstance(after, dict):
        return None
    parts = []
    for key, value in after.items():
        if key == 'eventId' or value is None or not isinstance(value, (str, int, float, bool)):
            continue
        old = before.get(key) if isinstance(before, dict) else None
        parts.append(f'{key}: {old} to {value}' if old is not None else f'{key}: {value}')
    return re.sub(r'\s+', ' ', '; '.join(parts)).strip()[:500] or None


def _object_texts(rows) -> dict:
    ids: dict = {'event': set(), 'round': set(), 'pairing': set(), 'registration': set(), 'payment': set()}
    for r in rows:
        if r.object_type in ids:
            ids[r.object_type].add(r.object_id)
    texts: dict = {}
    for e in Event.objects.filter(pk__in=ids['event']):
        texts[('event', str(e.pk))] = f'Event {e.title}'
    for r in Round.objects.filter(pk__in=ids['round']):
        texts[('round', str(r.pk))] = f'Round {r.number}'
    for p in Pairing.objects.filter(pk__in=ids['pairing']).select_related('round'):
        texts[('pairing', str(p.pk))] = f'Board {p.board}, round {p.round.number}'
    for r in Registration.objects.filter(pk__in=ids['registration']).select_related('user'):
        texts[('registration', str(r.pk))] = f'Registration of {_name(r.user)}'
    for p in Payment.objects.filter(pk__in=ids['payment']).select_related('order__user'):
        texts[('payment', str(p.pk))] = f'Payment of {_name(p.order.user)}'
    return texts


def _entry_dtos(rows) -> list[dict]:
    texts = _object_texts(rows)
    out = []
    for r in rows:
        actor = r.actor
        out.append({'id': str(r.pk), 'at': iso(r.occurred_at),
                    'actor': {'id': str(actor.pk) if actor else ZERO_UUID,
                              'name': _name(actor) if actor else 'Former admin'},
                    'action': AUDIT_WEB[r.action],
                    'object': texts.get((r.object_type, r.object_id), f'{r.object_type.capitalize()}')[:200],
                    'summary': _summary(r)})
    return out


def list_audit(request, event: Event, pagination_cls):
    qs = _audit_query(request, event)
    paginator = pagination_cls()
    rows = list(paginator.paginate_queryset(qs, request))
    return paginator, _entry_dtos(rows)


def export_audit_csv(request, event: Event) -> str:
    """Step-up protected export (contract 2.4). Bounded to AUDIT_CSV_MAX rows. The export itself is audited."""
    require_step_up(request)
    qs = _audit_query(request, event)
    rows = list(qs[:AUDIT_CSV_MAX])
    entries = _entry_dtos(rows)
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator='\r\n')
    writer.writerow(['At', 'Actor', 'Action', 'Object', 'Summary'])
    for e in entries:
        writer.writerow([csv_cell(e['at']), csv_cell(e['actor']['name']), csv_cell(e['action']),
                         csv_cell(e['object']), csv_cell(e['summary'])])
    with transaction.atomic():
        audit.write(request, action='audit.export', object_type='event', object_id=event.pk,
                    after={'rows': len(entries)})
    return buf.getvalue()
