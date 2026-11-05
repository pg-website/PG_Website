"""Registration engine (contract 3.3 R02, R03, R07, R08; 5.2; 5.3).

Every write runs in `transaction.atomic()` and starts by locking the Event row (`SELECT ... FOR UPDATE`), so capacity
checks, holds, waitlist promotion and the `Event.confirmed_count` counter are serialised per event. Two players
racing for the last seat cannot both win (NCT-L7).

Capacity rule (5.3):   confirmed_count + unexpired holds + unexpired waitlist offers  <=  capacity.

Event.confirmed_count (content app) is updated here, in the same transaction, with a relative queryset update
(`F('confirmed_count') +/- n`). That bypasses `Event.save()` on purpose: availability endpoints are `no-store` and read the counter directly. Only when the
counter makes the event cross its capacity (sold out <-> places free, which the cached cards show) does
`adjust_confirmed` bump the event version and write an `event/updated` outbox row in the same transaction. The content app's own seed command resets the
counter to its demo number whenever it is re-run; nothing else writes it.

Money: this app stores `amount_paise`, `payment_order_state` and `refund_state` (mirrors of the payments app's rows).
A paid reservation creates a `pending` row with a capacity hold; orders, verify, the webhook and refunds are in
`payments/`. A cancelled paid place is marked `refund_state='pending'` for the refund caller (BE-04/BE-10) to pick up
via `payments.services.refund_payment`.
"""
from __future__ import annotations

import logging
import uuid

from django.db import IntegrityError, transaction
from django.db.models import F
from django.db.models.functions import Greatest
from django.utils import timezone

from accounts.models import User
from content.models import Event
from content.revalidation import emit
from core.errors import (AlreadyRegistered, CancellationNotAllowed, EventFull, EventNotFound, HoldExpired, NotFound,
                         RegistrationClosed, RegistrationNotOpen, ValidationFailed)
from core.validation import (CHESS_HANDLE_RE, FIDE_ID_RE, PHONE_RE, Collector, present, require_object)

from . import conf, rules
from .models import Registration

logger = logging.getLogger('pg.registrations')

PROFILE_KEYS = {'name', 'city', 'area', 'phone', 'birthday', 'chessComHandle', 'fideId'}


# ---------------------------------------------------------------- primitives (call inside atomic, event locked)

def lock_event(event_id) -> Event:
    return Event.objects.select_for_update().get(pk=event_id)


def adjust_confirmed(event_id, delta: int) -> None:
    """Keep Event.confirmed_count equal to the number of CONFIRMED registrations (relative update, never below 0)."""
    before = Event.objects.filter(pk=event_id).values('capacity', 'confirmed_count').first()
    Event.objects.filter(pk=event_id).update(confirmed_count=Greatest(F('confirmed_count') + delta, 0))
    if before is None:
        return
    after = Event.objects.filter(pk=event_id).values_list('confirmed_count', flat=True).first()
    cap = before['capacity']
    if cap is not None and (before['confirmed_count'] >= cap) != (after >= cap):  # unlimited never flips
        _emit_registration_flip(event_id)


def _emit_registration_flip(event_id) -> None:
    """The public sold-out state flipped: bump the event version and write an `event/updated` outbox row in the
    caller's transaction (the counter update itself is a queryset update and bypasses signals)."""
    Event.objects.filter(pk=event_id).update(version=F('version') + 1)
    event = Event.objects.filter(pk=event_id).only('id', 'slug', 'status', 'version').first()
    if event is not None and event.status != 'draft':
        emit('event', 'updated', entity_id=event.pk, slug=event.slug, version=event.version)


def notify_confirmed(reg: Registration) -> None:
    """Queue the confirmation email in the caller's transaction (comms honours the event toggle and email switch)."""
    from comms import transactional  # lazy: comms imports this app's models
    transactional.queue_registration_confirmation(reg)


def notify_offer(reg: Registration) -> None:
    from comms import transactional
    transactional.queue_waitlist_offer(reg)


def _event_open_for_promotion(event: Event, now) -> bool:
    return event.status not in ('cancelled', 'completed', 'ongoing', 'draft') and event.starts_at > now


def _expire_order(reg: Registration) -> None:
    """Keep the payments order row in step with the registration mirror (a late capture can still arrive)."""
    from payments.models import PaymentOrder
    PaymentOrder.objects.filter(registration_id=reg.pk, state='created').update(state='expired')


def release_expired(event: Event, now) -> int:
    """Persist expired holds and offers as cancelled. They stopped counting toward capacity the moment they expired
    (see rules.holds_count); this makes the row say so and frees the unique slot. Returns rows released."""
    released = 0
    stale = (Registration.objects.filter(event_id=event.pk, status='pending', hold_expires_at__lte=now)
             .exclude(payment_order_state__in=['attempted', 'paid']))
    for reg in stale.select_for_update():
        reg.status = 'cancelled'
        reg.cancelled_at = reg.hold_expires_at or now
        if reg.payment_order_state == 'created':
            reg.payment_order_state = 'expired'
            _expire_order(reg)
        reg.save(update_fields=['status', 'cancelled_at', 'payment_order_state', 'updated_at'])
        released += 1
    for reg in Registration.objects.filter(event_id=event.pk, status='offer', offer_expires_at__lte=now).select_for_update():
        reg.status = 'cancelled'  # an unclaimed offer forfeits the place
        reg.cancelled_at = reg.offer_expires_at or now
        reg.save(update_fields=['status', 'cancelled_at', 'updated_at'])
        released += 1
    return released


def promote_waitlist(event: Event, now) -> int:
    """Offer every free seat to the next waitlisted players, oldest first (offer window conf.offer_hours())."""
    if not _event_open_for_promotion(event, now):
        return 0
    free = 100000 if event.capacity is None else event.capacity - rules.occupied(event.pk, now)
    if free <= 0:
        return 0
    queue = (Registration.objects.filter(event_id=event.pk, status='waitlist')
             .order_by('waitlisted_at', 'id').select_for_update()[:free])
    from datetime import timedelta
    expires = now + timedelta(hours=conf.offer_hours())
    promoted = 0
    for reg in queue:
        reg.status = 'offer'
        reg.offer_expires_at = expires
        reg.save(update_fields=['status', 'offer_expires_at', 'updated_at'])
        reg.event = event
        notify_offer(reg)
        promoted += 1
    return promoted


def offer_registration(reg: Registration, now) -> None:
    """Offer a seat to ONE waitlisted registration (admin promote, C03). Caller holds the event lock and has checked
    that a seat is free; the offer window is the same as an automatic promotion."""
    from datetime import timedelta
    reg.status = 'offer'
    reg.offer_expires_at = now + timedelta(hours=conf.offer_hours())
    reg.save(update_fields=['status', 'offer_expires_at', 'updated_at'])
    notify_offer(reg)


def move_to_waitlist(reg: Registration, now) -> bool:
    """Put an unpaid registration at the back of the queue (admin, C03). Caller holds the event lock. Returns True
    when a confirmed seat was released (the caller then settles the event so the next player is offered it)."""
    was_confirmed = reg.status == 'confirmed'
    reg.status = 'waitlist'
    reg.waitlisted_at = now
    reg.hold_expires_at = None
    reg.offer_expires_at = None
    reg.confirmed_at = None
    reg.checked_in_at = None
    reg.check_in_source = ''
    if reg.payment_order_state == 'created':
        reg.payment_order_state = 'expired'
        _expire_order(reg)
    reg.save()
    if was_confirmed:
        adjust_confirmed(reg.event_id, -1)
    return was_confirmed


def settle_event(event: Event, now) -> dict:
    """Release expired rows, then promote. Idempotent; used by the scheduler command and after every cancel."""
    released = release_expired(event, now)
    promoted = promote_waitlist(event, now)
    return {'released': released, 'promoted': promoted}


# ---------------------------------------------------------------- input

def _apply_profile(user: User, profile) -> None:
    """Optional `profile` on R02: allow-listed private fields only, validated like PATCH /me/profile."""
    if profile is None:
        return
    c = Collector(require_object(profile))
    c.reject_unknown(PROFILE_KEYS)
    values = {
        'name': c.text('name', max_len=80, required=False),
        'city': c.text('city', max_len=80, required=False),
        'area': c.text('area', max_len=80, required=False),
        'phone': c.text('phone', max_len=20, min_len=7, required=False, pattern=PHONE_RE),
        'birthday': c.iso_date('birthday'),
        'chess_com_handle': c.text('chessComHandle', max_len=25, min_len=3, required=False, pattern=CHESS_HANDLE_RE),
        'fide_id': c.text('fideId', max_len=12, min_len=3, required=False, pattern=FIDE_ID_RE),
    }
    c.done()
    changed = [k for k, v in values.items() if present(v)]
    for k in changed:
        setattr(user, k, values[k])
    if changed:
        user.save(update_fields=[*changed, 'updated_at'])


def _refuse(state: str, user: User) -> Exception:
    if state == 'already_registered':
        return AlreadyRegistered()
    if state == 'closed':
        return RegistrationClosed()
    if state == 'not_yet_open':
        return RegistrationNotOpen()
    if state in ('full_waitlist', 'sold_out'):
        return EventFull()
    return ValidationFailed(fields={'profile': ['Complete your profile to register.']})


def _insert(**kwargs) -> Registration:
    try:
        with transaction.atomic():
            return Registration.objects.create(**kwargs)
    except IntegrityError:  # unique (user, event) while active: a double submit lost the race
        raise AlreadyRegistered() from None


# ---------------------------------------------------------------- R02 reserve

def reserve(user: User, slug, profile=None) -> Registration:
    from datetime import timedelta
    public = rules.find_public_event(slug)
    with transaction.atomic():
        event = lock_event(public.pk)
        now = timezone.now()
        release_expired(event, now)
        _apply_profile(user, profile)
        state, _existing = rules.classify(event, user, now)
        if state not in ('open_free', 'open_paid'):
            raise _refuse(state, user)
        if state == 'open_free':
            reg = _insert(user=user, event=event, status='confirmed', confirmed_at=now, amount_paise=0)
            adjust_confirmed(event.pk, +1)
        else:
            reg = _insert(user=user, event=event, status='pending', amount_paise=event.price_paise,
                          hold_expires_at=now + timedelta(minutes=conf.hold_minutes()))
        reg.event = event
        if reg.status == 'confirmed':
            notify_confirmed(reg)
        return reg


# ---------------------------------------------------------------- R03 waitlist

def join_waitlist(user: User, slug) -> tuple[Registration, int]:
    public = rules.find_public_event(slug)
    with transaction.atomic():
        event = lock_event(public.pk)
        now = timezone.now()
        release_expired(event, now)
        promote_waitlist(event, now)
        state, _existing = rules.classify(event, user, now)
        if state in ('open_free', 'open_paid'):
            raise ValidationFailed(fields={'eventSlug': ['Places are still available. Register instead of joining the waitlist.']})
        if state != 'full_waitlist':
            raise _refuse(state, user)
        reg = _insert(user=user, event=event, status='waitlist', waitlisted_at=now, amount_paise=event.price_paise)
        reg.event = event
        return reg, reg.waitlist_position(now)


# ---------------------------------------------------------------- R06 / ownership

def owned_registration(user: User, registration_id, *, lock: bool = False) -> Registration:
    """The caller's own registration or NOT_FOUND. Another player's id is indistinguishable from a missing one
    (object-level authorisation: no 403, no data, no existence leak)."""
    try:
        pk = uuid.UUID(str(registration_id))
    except ValueError:
        raise NotFound() from None
    qs = Registration.objects.select_related('event')
    if lock:
        qs = qs.select_for_update(of=('self',))
    reg = qs.filter(pk=pk, user=user).first()
    if reg is None:
        raise NotFound()
    return reg


# ---------------------------------------------------------------- R07 cancel

def cancel(user: User, registration_id) -> Registration:
    owned_registration(user, registration_id)  # cheap 404 before taking any lock
    with transaction.atomic():
        reg = owned_registration(user, registration_id)
        event = lock_event(reg.event_id)
        reg = owned_registration(user, registration_id, lock=True)
        now = timezone.now()
        reg.event = event
        status = rules.effective_status(reg, now)
        if status not in ('pending', 'confirming', 'confirmed', 'waitlist', 'offer'):
            raise CancellationNotAllowed('This registration is not active.', reason='NOT_ACTIVE')
        allowed, why = rules.cancel_policy(reg, event, now)
        if not allowed:
            raise CancellationNotAllowed(why or 'Cancellation is not available for this event.',
                                         reason='WITHIN_CUTOFF' if why else 'EVENT_STARTED')
        was_confirmed = reg.status == 'confirmed'
        paid = reg.payment_order_state == 'paid'
        reg.status = 'cancelled'
        reg.cancelled_at = now
        reg.offer_expires_at = None
        if paid:
            reg.refund_state = 'pending'  # slice 4's refund job picks this up; policy: full refund outside the cutoff
        elif reg.payment_order_state == 'created':
            reg.payment_order_state = 'expired'
            _expire_order(reg)
        reg.save()
        if was_confirmed:
            adjust_confirmed(event.pk, -1)
        settle_event(event, now)  # the freed seat goes to the next waitlisted player as an offer
        return reg


# ---------------------------------------------------------------- R08 accept offer

def accept_offer(user: User, registration_id) -> Registration:
    from datetime import timedelta
    owned_registration(user, registration_id)
    lapsed = False
    with transaction.atomic():  # persist a lapse and pass the seat on; this commits BEFORE the error is raised
        reg = owned_registration(user, registration_id)
        event = lock_event(reg.event_id)
        reg = owned_registration(user, registration_id, lock=True)
        now = timezone.now()
        if reg.status == 'offer' and (reg.offer_expires_at is None or reg.offer_expires_at <= now):
            settle_event(event, now)
            lapsed = True
    if lapsed:
        raise HoldExpired('Your offer has expired.')
    with transaction.atomic():
        reg = owned_registration(user, registration_id)
        event = lock_event(reg.event_id)
        reg = owned_registration(user, registration_id, lock=True)
        now = timezone.now()
        reg.event = event
        if reg.status in ('pending', 'confirming', 'confirmed'):
            raise AlreadyRegistered()
        if reg.status != 'offer':
            if reg.status == 'cancelled':
                raise HoldExpired('This registration is no longer active.')
            raise EventFull('There is no place on offer for you yet.')
        if event.status in ('cancelled', 'completed', 'ongoing') or event.starts_at <= now:
            raise RegistrationClosed()
        reg.offer_expires_at = None
        if event.price_paise == 0:
            reg.status = 'confirmed'
            reg.confirmed_at = now
            reg.amount_paise = 0
            reg.save()
            adjust_confirmed(event.pk, +1)
            notify_confirmed(reg)
        else:
            reg.status = 'pending'
            reg.amount_paise = event.price_paise
            reg.hold_expires_at = now + timedelta(minutes=conf.hold_minutes())
            reg.save()
        return reg


# ---------------------------------------------------------------- cash register (admin, FEAT-002)

def cash_register(request, event: Event, player: User, amount_paise: int) -> Registration:
    """Admin-only: confirm a registration with cash payment.

    Caller has already validated:
      - event.price_paise > 0 (not a free event)
      - event.status not in ('cancelled', 'completed')
      - amount_paise > 0

    Returns the confirmed Registration (with .event and .user pre-assigned).
    Raises:
      AlreadyRegistered  — player already confirmed
      EventFull          — no capacity (new + waitlist paths only)
      ValidationFailed   — payment is in-flight ('attempted' state blocks promotion)
    """
    with transaction.atomic():
        event = lock_event(event.pk)          # serialises all capacity changes
        now = timezone.now()
        release_expired(event, now)           # cancel stale holds → free unique slot

        existing = rules.active_registration(player, event.pk, now)

        if existing is not None and existing.status == 'confirmed':
            raise AlreadyRegistered()         # FR-06, AC-06

        if existing is not None and existing.payment_order_state == 'attempted':
            raise ValidationFailed(
                fields={'action': ['A payment is in progress. Cancel it before cash-registering.']})

        promoted = existing is not None
        prev_status = existing.status if existing is not None else None

        if existing is None or existing.status == 'waitlist':
            # New registration or waitlist promotion: consumes a free seat
            if event.capacity is not None and rules.occupied(event.pk, now) >= event.capacity:
                raise EventFull()             # FR-07, AC-03

        # Expire any dangling Razorpay order on the existing pending row
        if existing is not None and existing.payment_order_state == 'created':
            existing.payment_order_state = 'expired'
            _expire_order(existing)

        changed = ['status', 'confirmed_at', 'amount_paise', 'payment_method',
                   'cash_registered_by', 'payment_order_state',
                   'hold_expires_at', 'offer_expires_at', 'version', 'updated_at']

        if existing is not None:
            existing.status = 'confirmed'
            existing.confirmed_at = now
            existing.amount_paise = amount_paise
            existing.payment_method = 'cash'
            existing.cash_registered_by = request.user
            existing.hold_expires_at = None
            existing.offer_expires_at = None
            existing.version += 1
            existing.save(update_fields=changed)
            reg = existing
        else:
            reg = Registration.objects.create(
                user=player,
                event=event,
                status='confirmed',
                confirmed_at=now,
                amount_paise=amount_paise,
                payment_method='cash',
                cash_registered_by=request.user,
            )

        adjust_confirmed(event.pk, +1)        # keeps Event.confirmed_count in step

        import audit
        audit.write(
            request,
            action='registration.cash_registration',
            object_type='registration',
            object_id=reg.pk,
            before={'promoted': promoted, 'prevStatus': prev_status},
            after={
                'status': 'confirmed',
                'paymentMethod': 'cash',
                'amountPaise': amount_paise,
                'eventId': str(event.pk),
                'playerId': str(player.pk),
                'actorName': (request.user.name or '').strip()[:80] or 'Admin',
            },
        )
        reg.event = event
        reg.user = player
        return reg


# R04 / R05 (payment orders and verify) live in payments/services.py.

# ---------------------------------------------------------------- scheduler entry point

def expire_holds_and_offers(now=None) -> dict:
    """Release every expired hold/offer across all events and promote the waitlist. Safe to run twice and from two
    schedulers at once (each event is processed under its own row lock)."""
    now = now or timezone.now()
    from django.db.models import Q
    ids = set(Registration.objects.filter(
        Q(status='pending', hold_expires_at__lte=now) | Q(status='offer', offer_expires_at__lte=now)
    ).values_list('event_id', flat=True))
    ids |= set(Registration.objects.filter(status='waitlist').values_list('event_id', flat=True))
    totals = {'events': 0, 'released': 0, 'promoted': 0}
    for event_id in ids:
        with transaction.atomic():
            event = lock_event(event_id)
            result = settle_event(event, now)
        totals['events'] += 1
        totals['released'] += result['released']
        totals['promoted'] += result['promoted']
    logger.info('job=expire_holds_and_offers events=%d released=%d promoted=%d',
                totals['events'], totals['released'], totals['promoted'])
    return totals
