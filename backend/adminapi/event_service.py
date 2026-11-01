"""Admin event writes (E02, E04, E07-E10). Every mutation: one `transaction.atomic()` holding the event row lock, the
change, the strict audit row (audit.write) and, through content.signals, the revalidation outbox row.

Provider calls (refund execution) run only after the transaction commits (contract 5.1: never under row locks).
"""
from __future__ import annotations

import logging
import uuid

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import F
from django.db.models.functions import Greatest
from django.utils import timezone

import audit
from content.models import Event
from core.errors import (CancellationNotAllowed, EventNotFound, NotPublishable, SlugLocked, SlugTaken, StepUpRequired,
                         ValidationFailed, VersionConflict)
from core.responses import iso
from payments import services as pay_services
from payments.models import Payment
from registrations import services as reg_services
from registrations.models import Registration

from . import event_builder as eb
from . import media_service as ms
from .permissions import require_step_up

logger = logging.getLogger('pg.adminapi')

# ---------------------------------------------------------------- helpers


def _locked_event(event_id) -> Event:
    event = (Event.objects.select_for_update(of=('self',)).select_related('updated_by')
             .filter(pk=eb.parse_event_id(event_id)).first())
    if event is None:
        raise EventNotFound()
    return event


def slug_taken(slug: str, exclude_id=None) -> bool:
    qs = Event.objects.filter(slug__iexact=slug)
    if exclude_id is not None:
        qs = qs.exclude(pk=exclude_id)
    return qs.exists()


# Model field (snake_case) -> builder field path, so the web can attach the message to the right input.
MODEL_TO_BUILDER = {
    'title': 'basics.title', 'slug': 'basics.slug', 'type': 'basics.type', 'promise': 'basics.promise',
    'starts_at': 'basics.startsAt', 'ends_at': 'basics.endsAt', 'venue_name': 'basics.venueName',
    'address': 'basics.address', 'area': 'basics.area', 'city': 'basics.city', 'audience': 'basics.audience',
    'description': 'experience.description', 'experience': 'experience.body', 'faq': 'experience.faq',
    'logistics': 'experience.logistics', 'at_a_glance': 'experience.hostedArrival',
    'capacity': 'registration.capacity', 'waitlist_enabled': 'registration.waitlistEnabled',
    'registration_opens_at': 'registration.opensAt', 'registration_closes_at': 'registration.closesAt',
    'ask_first_timer': 'registration.askFirstTimer', 'min_age': 'registration.minAge',
    'price_paise': 'payment.pricePaise', 'refund_window_hours': 'payment.refundWindowHours',
    'hold_minutes': 'payment.holdMinutes', 'rated': 'gameSystem.rated', 'rating_pool': 'gameSystem.pool',
    'pairing_mode': 'gameSystem.pairingMode', 'rounds_planned': 'gameSystem.rounds',
    'time_control': 'gameSystem.timeControl', 'media': 'media.assetIds', 'media_mode': 'media.assetIds',
    'communications': 'communications.triggers', '__all__': 'form',
}


def _model_errors(exc: DjangoValidationError) -> ValidationFailed:
    fields = {}
    for key, messages in (exc.message_dict if hasattr(exc, 'error_dict') else {'form': exc.messages}).items():
        path = MODEL_TO_BUILDER.get(key, key if key == 'form' else 'form')
        bucket = fields.setdefault(path, [])
        bucket += [str(m) for m in messages if str(m) not in bucket]
        del bucket[5:]
    return ValidationFailed(fields=fields)


def _save(event: Event, user, summary: str) -> None:
    event.updated_by = user
    event.last_change_summary = summary[:300]
    try:
        event.save()
    except DjangoValidationError as exc:
        raise _model_errors(exc) from None
    except IntegrityError:
        raise SlugTaken(fields={'basics.slug': [SlugTaken.default_detail]}) from None


def get_event(event_id) -> Event:
    event = Event.objects.select_related('updated_by').filter(pk=eb.parse_event_id(event_id)).first()
    if event is None:
        raise EventNotFound()
    return event


# ---------------------------------------------------------------- E02 create

def create_draft(request, parsed: dict) -> Event:
    with transaction.atomic():
        slug = parsed['slug']
        if slug and slug_taken(slug):
            raise SlugTaken(fields={'slug': [SlugTaken.default_detail]})
        defaults = eb.type_defaults(parsed['type'])
        event = Event(title=parsed['title'], type=parsed['type'], slug=slug, status='draft',
                      experience={'eyebrow': '', 'heading': '', 'body': '', 'highlights': []},
                      at_a_glance={'membershipRequired': False, 'hostedArrival': False},
                      communications=eb.default_communications(), **defaults)
        _save(event, request.user, 'Created the draft')
        audit.write(request, action='event.create', object_type='event', object_id=event.pk,
                    after={'title': event.title, 'type': event.type, 'slug': event.slug, 'status': 'draft'})
    return event


# ---------------------------------------------------------------- E04 patch

def _current(dto: dict, step: str, field: str):
    if step == 'basics' and field == 'slug':
        return dto['basics']['slug']['value']
    return dto[step].get(field)  # `pool` is absent from the DTO of an unrated event


def _normalise(value):
    if hasattr(value, 'isoformat') and hasattr(value, 'tzinfo'):
        return iso(value)
    return str(value) if value.__class__.__name__ == 'UUID' else value


def _apply(event: Event, step: str, field: str, value) -> None:
    glance = dict(event.at_a_glance or {})
    ex = dict(event.experience or {})
    if step == 'basics':
        attr = {'venueName': 'venue_name', 'startsAt': 'starts_at', 'endsAt': 'ends_at'}.get(field, field)
        old_label = eb.TYPE_LABELS.get(event.type)
        setattr(event, attr, value)
        if field == 'type' and event.format in ('', old_label):
            event.format = eb.TYPE_LABELS[value]
    elif step == 'experience':
        if field in ('eyebrow', 'heading', 'body', 'highlights'):
            ex.update({'eyebrow': ex.get('eyebrow', ''), 'heading': ex.get('heading', ''), 'body': ex.get('body', ''),
                       'highlights': ex.get('highlights', [])})
            ex[field] = value
            event.experience = ex
        elif field == 'hostedArrival':
            event.at_a_glance = {'membershipRequired': bool(glance.get('membershipRequired', False)),
                                 'hostedArrival': value}
        else:
            attr = {'arrivalPromise': 'arrival_promise'}.get(field, field)
            setattr(event, attr, value)  # description, arrival_promise, logistics, faq
    elif step == 'registration':
        if field == 'membershipRequired':
            event.at_a_glance = {'membershipRequired': value, 'hostedArrival': bool(glance.get('hostedArrival', False))}
        else:
            attr = {'waitlistEnabled': 'waitlist_enabled', 'opensAt': 'registration_opens_at',
                    'closesAt': 'registration_closes_at', 'askFirstTimer': 'ask_first_timer',
                    'minAge': 'min_age'}.get(field, field)
            setattr(event, attr, value)
    elif step == 'payment':
        setattr(event, {'pricePaise': 'price_paise', 'refundWindowHours': 'refund_window_hours',
                        'holdMinutes': 'hold_minutes'}[field], value)
    elif step == 'gameSystem':
        setattr(event, {'rated': 'rated', 'pool': 'rating_pool', 'pairingMode': 'pairing_mode',
                        'rounds': 'rounds_planned', 'timeControl': 'time_control'}[field], value)
    elif step == 'media':
        pass  # applied once for the whole step by _apply_media
    elif step == 'communications':
        merged = {t: bool(((event.communications or {}).get('triggers') or {}).get(t, True)) for t in eb.TRIGGERS}
        merged.update(value)
        event.communications = {'triggers': merged, 'channels': list(eb.CHANNELS)}


def _apply_media(event: Event, fields: dict) -> None:
    """Create or update the event's private gallery; the mode is derived from the asset count."""
    parsed = {}
    if 'assetIds' in fields:
        parsed['asset_ids'] = [uuid.UUID(i) for i in fields['assetIds']]
    if 'autoplay' in fields:
        parsed['autoplay'] = fields['autoplay']
    if 'intervalMs' in fields:
        parsed['interval_ms'] = fields['intervalMs']
    current = event.media if event.media_id else None
    gallery = ms.set_gallery('event', event.pk, current, parsed)
    event.media = gallery
    event.media_mode = gallery.mode


def update_event(request, event_id, version: int, parsed: dict) -> Event:
    user = request.user
    with transaction.atomic():
        event = _locked_event(event_id)
        if event.version != version:
            raise VersionConflict()
        if event.status not in eb.EDITABLE_STATUSES:
            raise ValidationFailed(fields={'form': [f'A {event.status.replace("_", " ")} event can no longer be edited.']})

        dto = eb.draft_dto(event)
        changes: dict[tuple[str, str], tuple] = {}
        for step, fields in parsed.items():
            for field, new in fields.items():
                if step == 'communications' and field == 'triggers':
                    for trig, flag in new.items():
                        old = dto['communications']['triggers'][trig]
                        if old != flag:
                            changes[('communications', f'triggers.{trig}')] = (old, flag)
                    continue
                if step == 'communications':
                    continue  # channels already validated to the single launch value
                if step == 'gameSystem' and field == 'pool' and parsed['gameSystem'].get('rated', event.rated) is False:
                    raise ValidationFailed(fields={'gameSystem.pool': ['Only a rated event has a rating pool.']})
                old = _current(dto, step, field)
                norm = _normalise(new)
                if norm != old:
                    changes[(step, field)] = (old, norm)
        if not changes:
            return event

        errors = {}
        locked = set(eb.locked_fields(event))
        for (step, field), lock in eb.LOCKABLE_PATHS.items():
            if lock in locked and (step, field) in changes:
                errors[f'{step}.{field}'] = [eb.LOCK_REASONS[lock]]
        if errors:
            raise ValidationFailed(fields=errors)

        if ('basics', 'slug') in changes:
            new_slug = changes[('basics', 'slug')][1]
            if event.first_published_at is not None:
                raise SlugLocked(fields={'basics.slug': [eb.LOCK_REASONS['slug']]})
            if new_slug is not None and slug_taken(new_slug, event.pk):
                raise SlugTaken(fields={'basics.slug': [SlugTaken.default_detail]})

        operational = {k: val for k, val in changes.items() if k[1] in eb.OPERATIONAL_FIELDS.get(k[0], ())}
        editorial = {k: val for k, val in changes.items() if k not in operational}
        if operational and event.status != 'draft':
            require_step_up(request)  # the stronger tier: money, capacity and rating rules of a public event

        for (step, field) in changes:
            if step in ('communications', 'media'):
                continue
            _apply(event, step, field, parsed[step][field])
        if any(step == 'media' for step, _f in changes):
            _apply_media(event, {f: parsed['media'][f] for (s, f) in changes if s == 'media'})
        if 'communications' in parsed and parsed['communications'].get('triggers'):
            _apply(event, 'communications', 'triggers', parsed['communications']['triggers'])
        if event.rated and not event.rating_pool:
            event.rating_pool = 'rapid'
        if not event.rated:
            event.rating_pool = ''
        if (event.registration_opens_at and event.registration_closes_at
                and event.registration_closes_at <= event.registration_opens_at):
            raise ValidationFailed(fields={'registration.closesAt': ['Registration must close after it opens.']})
        if event.status != 'draft':  # a public event must stay publishable in the fields this save touches
            touched = {f'{s}.{f}'.split('.triggers')[0] for (s, f) in changes}
            blockers = eb.readiness(event).get('blockers', [])
            hit = {b['field']: [b['reason']] for b in blockers
                   if b.get('field') in touched and b['code'] != 'STARTS_IN_PAST'}
            if hit:
                raise ValidationFailed(fields=hit)

        summary = 'Updated ' + ', '.join(sorted({s for s, _f in changes})).replace('gameSystem', 'game system')
        _save(event, user, summary)

        def snap(group):
            return {f'{s}.{f}': val[0] for (s, f), val in group.items()}, {f'{s}.{f}': val[1] for (s, f), val in group.items()}

        if editorial:
            before, after = snap(editorial)
            audit.write(request, action='event.update', object_type='event', object_id=event.pk,
                        before=before, after=after)
        if operational:
            before, after = snap(operational)
            audit.write(request, action='event.update_operational', object_type='event', object_id=event.pk,
                        before=before, after=after)
    return event


# ---------------------------------------------------------------- E07 publish

def publish(request, event_id) -> tuple[Event, object]:
    with transaction.atomic():
        event = _locked_event(event_id)
        if event.status != 'draft':
            raise NotPublishable(blockers=[eb._b('ALREADY_PUBLISHED', 'This event is already published.')])
        ready = eb.readiness(event)
        if not ready['ready']:
            raise NotPublishable(blockers=ready['blockers'],
                                 fields={b['field']: [b['reason']] for b in ready['blockers'] if b.get('field')})
        if slug_taken(event.slug, event.pk):
            raise SlugTaken(fields={'basics.slug': [SlugTaken.default_detail]})
        now = timezone.now()
        event.status = 'published'
        _save(event, request.user, 'Published')  # signal writes the event/published outbox row in this transaction
        audit.write(request, action='event.publish', object_type='event', object_id=event.pk,
                    before={'status': 'draft'}, after={'status': 'published', 'slug': event.slug})
    return event, now


# ---------------------------------------------------------------- E08 unpublish

def unpublish(request, event_id) -> Event:
    with transaction.atomic():
        event = _locked_event(event_id)
        blockers = eb.unpublish_blockers(event)
        if blockers:
            raise NotPublishable(blockers=blockers, fields={'form': [blockers[0]['reason']]})
        before = event.status
        event.status = 'draft'
        _save(event, request.user, 'Unpublished')  # slug stays locked: first_published_at is kept
        audit.write(request, action='event.unpublish', object_type='event', object_id=event.pk,
                    before={'status': before}, after={'status': 'draft'})
    return event


# ---------------------------------------------------------------- E08b open_registration

def open_registration(request, event_id) -> Event:
    with transaction.atomic():
        event = _locked_event(event_id)
        if event.status != 'published':
            raise NotPublishable(
                blockers=[eb._b('NOT_PUBLISHED', 'Only a published event can open registrations.')],
                fields={'form': ['Only a published event can open registrations.']},
            )
        event.status = 'registration_open'
        _save(event, request.user, 'Opened registrations')
        audit.write(
            request,
            action='event.open_registration',
            object_type='event',
            object_id=event.pk,
            before={'status': 'published'},
            after={'status': 'registration_open'},
        )
    return event


# ---------------------------------------------------------------- close registration

def close_registration(request, event_id) -> Event:
    with transaction.atomic():
        event = _locked_event(event_id)
        if event.status != 'registration_open':
            raise NotPublishable(
                blockers=[eb._b('NOT_OPEN', 'Only a registration-open event can have registrations closed.')],
                fields={'form': ['Only a registration-open event can have registrations closed.']},
            )
        now = timezone.now()
        event.registration_closes_at = now
        _save(event, request.user, 'Closed registrations')
        audit.write(
            request,
            action='event.close_registration',
            object_type='event',
            object_id=event.pk,
            before={'registration_closes_at': None},
            after={'registration_closes_at': iso(now)},
        )
    return event


# ---------------------------------------------------------------- delete draft

def delete_event(request, event_id) -> None:
    with transaction.atomic():
        event = _locked_event(event_id)
        if event.status != 'draft':
            raise ValidationFailed(
                fields={'form': ['Only a draft event can be deleted.']}
            )
        event_pk = event.pk
        event_slug = event.slug
        event.delete()
        audit.write(
            request,
            action='event.delete',
            object_type='event',
            object_id=event_pk,
            before={'status': 'draft', 'slug': event_slug},
            after={},
        )


# ---------------------------------------------------------------- E09 cancel

def refundable_payments_exist(event_id) -> bool:
    return Payment.objects.filter(order__registration__event_id=event_id, order__registration__status='confirmed',
                                  status='captured', flagged=False).exists()


def cancel(request, event_id, *, reason: str, notify: bool, refund: bool, stepped_up: bool):
    """-> (event, cancelled_at, refunds). `refunds` are PENDING rows to execute after the caller's commit."""
    refunds = []
    cancelled_regs = 0
    with transaction.atomic():
        event = _locked_event(event_id)
        if event.status not in eb.LIVE_STATUSES:
            raise CancellationNotAllowed(f'A {event.status.replace("_", " ")} event cannot be cancelled.')
        now = timezone.now()
        confirmed_released = 0
        active = (Registration.objects.select_for_update().filter(event_id=event.pk, status__in=Registration.ACTIVE)
                  .order_by('id'))
        for reg in list(active):
            was_confirmed = reg.status == 'confirmed'
            reg.status = 'cancelled'
            reg.cancelled_at = now
            if reg.payment_order_state == 'created':
                reg.payment_order_state = 'expired'
                reg_services._expire_order(reg)
            reg.save(update_fields=['status', 'cancelled_at', 'payment_order_state', 'updated_at'])
            cancelled_regs += 1
            if not was_confirmed:
                continue
            confirmed_released += 1
            if refund:
                for payment in Payment.objects.filter(order__registration_id=reg.pk, status='captured', flagged=False):
                    if not stepped_up:
                        raise StepUpRequired()
                    try:
                        refunds.append(pay_services.refund_payment(payment, reason='cancellation', execute=False))
                    except pay_services.RefundError as exc:
                        logger.warning('event_cancel_refund_skipped reason=%s', exc)
        if confirmed_released:  # relative update: no sold-out flip revalidation, the cancelled row covers it
            Event.objects.filter(pk=event.pk).update(confirmed_count=Greatest(F('confirmed_count') - confirmed_released, 0))
        event.refresh_from_db()
        event.status = 'cancelled'
        event.cancelled_reason = reason
        event.cancelled_at = now
        _save(event, request.user, 'Cancelled the event')  # signal writes event/cancelled
        audit.write(request, action='event.cancel', object_type='event', object_id=event.pk, reason=reason,
                    before={'status': 'published'},
                    after={'status': 'cancelled', 'notifyParticipants': notify, 'refund': refund,
                           'registrationsCancelled': cancelled_regs, 'refundsQueued': len(refunds)})
    return event, now, refunds


def execute_refunds(refunds) -> None:
    """After commit. A provider failure leaves the row pending for the retry job; it never fails the cancel."""
    for refund in refunds:
        try:
            pay_services.execute_refund(refund)
        except Exception:  # noqa: BLE001
            logger.exception('event_cancel_refund_execute_failed')


# ---------------------------------------------------------------- E10 complete

def complete(request, event_id, *, publish_archive: bool | None):
    with transaction.atomic():
        event = _locked_event(event_id)
        now = timezone.now()
        if event.status not in eb.LIVE_STATUSES + ('ongoing',) or event.starts_at is None or event.starts_at > now:
            raise ValidationFailed(fields={'form': ['Only an event that has started can be completed.']})
        before = event.status
        event.status = 'completed'
        if publish_archive is not None:
            if publish_archive and not event.archive_published:
                event.archive_published_at = now
            event.archive_published = publish_archive
        # Compute and store standings, rounds_played and winner from finalised results.
        from registrations import room as reg_room
        from registrations.models import Round
        completed_rounds = list(Round.objects.filter(event=event).exclude(state='void'))
        if completed_rounds:
            rows = reg_room.standings(event, completed_rounds)
            public = reg_room.public_rows(rows)
            event.standings = public
            event.rounds_played = len([r for r in completed_rounds if r.state == 'completed'])
            # Winner: first place (lowest place number). Ties: keep the first alphabetically (already sorted).
            event.winner = public[0]['identity'] if public else None
        _save(event, request.user, 'Completed the event')  # signal writes event/completed
        audit.write(request, action='event.complete', object_type='event', object_id=event.pk,
                    before={'status': before}, after={'status': 'completed', 'archivePublished': event.archive_published})
    return event, now
