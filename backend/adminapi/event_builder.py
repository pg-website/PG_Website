"""Event Builder resource (contract E02-E06): DTO, PATCH validation, locked fields, publish readiness, capabilities.

Response shapes mirror web/src/lib/api/types/admin/{event-builder,event-list,common}.ts (camelCase inside `data`).
Nothing here talks to a payment provider; everything is a pure function of the Event row plus a few cheap queries.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from content import validation as v
from content.models import MAX_PAISE, Event
from core.errors import ValidationFailed
from core.responses import iso
from payments.models import PaymentOrder
from registrations import conf as reg_conf
from registrations.models import Registration

from . import media_service as ms

BUILDER_STEPS = ('basics', 'experience', 'registration', 'payment', 'game_system', 'media', 'communications', 'review')
TRIGGERS = ('confirmation', 'reminder_24h', 'checkin_open', 'pairing_published', 'post_event')
CHANNELS = ('email',)
MEDIA_MODES = ('static', 'carousel')

# E06: label, default pairing, default rated, engine available (league and workshop engines are Later, F-PAIR-010).
EVENT_TYPE_DEFAULTS = {
    'social': ('Social night', 'social_balanced', False, True),
    'rated_tournament': ('Rated tournament', 'swiss', True, True),
    'league': ('League', 'none', False, False),
    'workshop': ('Workshop', 'none', False, False),
    'special': ('Special event', 'none', False, True),
}
TYPE_LABELS = {k: val[0] for k, val in EVENT_TYPE_DEFAULTS.items()}

# Statuses in which the builder still accepts edits / cancel.
EDITABLE_STATUSES = ('draft', 'published', 'registration_open', 'sold_out')
LIVE_STATUSES = ('published', 'registration_open', 'sold_out')

# Operational field groups (capacity, payment, pairing, eligibility, rating): audited with their own action, and
# once the event is public they need a step-up (the "stronger tier", see views.EventDetailView).
OPERATIONAL_FIELDS = {
    'registration': {'capacity', 'waitlistEnabled', 'minAge', 'membershipRequired'},
    'payment': {'pricePaise', 'refundWindowHours', 'holdMinutes'},
    'gameSystem': {'rated', 'pool', 'pairingMode', 'rounds'},
    'basics': {'audience'},
}

LOCK_REASONS = {
    'pricePaise': 'The price cannot change once players have registered or paid.',
    'capacity': 'Capacity cannot change once players have registered or paid.',
    'pairingMode': 'The pairing mode cannot change once players have registered or paid.',
    'rated': 'Rated or unrated cannot change once players have registered or paid.',
    'pool': 'The rating pool cannot change once players have registered or paid.',
    'slug': 'The slug cannot change after the first publish.',
}
# DTO field -> lockable name
LOCKABLE_PATHS = {
    ('payment', 'pricePaise'): 'pricePaise',
    ('registration', 'capacity'): 'capacity',
    ('gameSystem', 'pairingMode'): 'pairingMode',
    ('gameSystem', 'rated'): 'rated',
    ('gameSystem', 'pool'): 'pool',
}


# ---------------------------------------------------------------- lookups

def parse_event_id(raw):
    try:
        return uuid.UUID(str(raw))
    except (ValueError, AttributeError, TypeError):
        from core.errors import EventNotFound
        raise EventNotFound() from None


def has_commitments(event: Event) -> bool:
    """True once any registration holds a place or money for this event (expired/cancelled unpaid holds do not count)."""
    live = Registration.objects.filter(event_id=event.pk).filter(
        Q(status__in=['confirmed', 'confirming', 'refunded', 'waitlist', 'offer'])
        | Q(status='pending', payment_order_state__in=['attempted', 'paid'])
        | Q(status='pending', hold_expires_at__gt=timezone.now()))
    return live.exists() or PaymentOrder.objects.filter(registration__event_id=event.pk).exists()


def locked_fields(event: Event) -> list[str]:
    locked = []
    if has_commitments(event):
        locked += ['pricePaise', 'capacity', 'pairingMode', 'rated', 'pool']
    if event.first_published_at is not None:
        locked.append('slug')
    return locked


# ---------------------------------------------------------------- readiness (publish blockers)

def _b(code, reason, field=None):
    out = {'code': code, 'reason': reason}
    if field:
        out['field'] = field
    return out


def readiness(event: Event, now=None) -> dict:
    now = now or timezone.now()
    out = []
    ex = event.experience or {}

    def need(value, field, label, code='REQUIRED'):
        if not (isinstance(value, str) and value.strip()):
            out.append(_b(code, f'{label} is required.', field))

    need(event.title, 'basics.title', 'The title')
    if not event.slug:
        out.append(_b('REQUIRED', 'Choose a slug for the event page.', 'basics.slug'))
    if event.starts_at is None:
        out.append(_b('REQUIRED', 'Set when the event starts.', 'basics.startsAt'))
    elif event.starts_at <= now:
        out.append(_b('STARTS_IN_PAST', 'The start time must be in the future.', 'basics.startsAt'))
    if event.ends_at is None:
        out.append(_b('REQUIRED', 'Set when the event ends.', 'basics.endsAt'))
    elif event.starts_at is not None and event.ends_at <= event.starts_at:
        out.append(_b('INVALID', 'The end must be after the start.', 'basics.endsAt'))

    # The description is optional: it is never a publish blocker.

    # Capacity is optional: null means unlimited (owner decision), so it is never a publish blocker.
    if (event.registration_opens_at and event.registration_closes_at
            and event.registration_closes_at <= event.registration_opens_at):
        out.append(_b('INVALID', 'Registration must close after it opens.', 'registration.closesAt'))
    if (event.registration_closes_at and event.starts_at is not None
            and event.registration_closes_at > event.starts_at):
        out.append(_b('INVALID', 'Registration must close no later than the event starts.', 'registration.closesAt'))
    if event.media_id and ms.missing_alt_in([event.media_id]):
        out.append(_b('INVALID', 'Every image needs alt text (or must be marked decorative).', 'media.assetIds'))

    need(event.time_control, 'gameSystem.timeControl', 'The time control')
    if event.rated and not event.rating_pool:
        out.append(_b('REQUIRED', 'Choose the rating pool for a rated event.', 'gameSystem.pool'))
    if event.pairing_mode in ('swiss', 'round_robin') and not event.rounds_planned:
        out.append(_b('REQUIRED', 'Set the number of rounds.', 'gameSystem.rounds'))
    if event.price_paise > 0 and event.refund_window_hours is None:
        pass  # null means "no refunds": a valid, explicit choice
    if not out:
        return {'ready': True}
    return {'ready': False, 'blockers': out[:50]}


# ---------------------------------------------------------------- DTOs

def _highlights(event):
    return list((event.experience or {}).get('highlights') or [])


def _triggers(event):
    stored = (event.communications or {}).get('triggers') or {}
    return {t: bool(stored.get(t, True)) for t in TRIGGERS}


def _game_system(event):
    base = {'pairingMode': event.pairing_mode, 'rounds': event.rounds_planned, 'timeControl': event.time_control}
    if event.rated:
        return {'rated': True, 'pool': event.rating_pool or 'rapid', **base}
    return {'rated': False, **base}


def _slug_field(event):
    if event.first_published_at is not None and event.slug:
        return {'lock': 'locked', 'value': event.slug, 'lockedAt': iso(event.first_published_at)}
    return {'lock': 'editable', 'value': event.slug}


def draft_dto(event: Event) -> dict:
    ex = event.experience or {}
    locked = locked_fields(event)
    last = None
    if event.updated_by_id:
        last = {'by': {'id': str(event.updated_by_id), 'name': event.updated_by.name or 'Admin'},
                'at': iso(event.updated_at), 'summary': event.last_change_summary or None}
    glance = event.at_a_glance or {}
    return {
        'id': str(event.pk),
        'status': event.status,
        'basics': {
            'title': event.title, 'slug': _slug_field(event), 'type': event.type, 'promise': event.promise,
            'startsAt': iso(event.starts_at), 'endsAt': iso(event.ends_at), 'venueName': event.venue_name,
            'address': event.address, 'area': event.area, 'city': event.city, 'audience': event.audience,
        },
        'experience': {
            'description': event.description, 'arrivalPromise': event.arrival_promise,
            'eyebrow': ex.get('eyebrow', ''), 'heading': ex.get('heading', ''),
            'body': ex.get('body', ''), 'highlights': _highlights(event), 'logistics': list(event.logistics or []),
            'faq': list(event.faq or []), 'hostedArrival': bool(glance.get('hostedArrival', False)),
        },
        'registration': {
            'capacity': event.capacity, 'waitlistEnabled': event.waitlist_enabled,
            'opensAt': iso(event.registration_opens_at), 'closesAt': iso(event.registration_closes_at),
            'membershipRequired': bool(glance.get('membershipRequired', False)),
            'askFirstTimer': event.ask_first_timer, 'minAge': event.min_age,
        },
        'payment': {'pricePaise': event.price_paise, 'currency': 'INR',
                    'refundWindowHours': event.refund_window_hours, 'holdMinutes': event.hold_minutes},
        'gameSystem': _game_system(event),
        'media': ms.gallery_dto(event.media if event.media_id else None),
        'communications': {'triggers': _triggers(event), 'channels': list(CHANNELS)},
        'lockedFields': locked,
        'lockedReasons': {k: LOCK_REASONS[k] for k in locked},
        'readiness': readiness(event),
        'version': event.version,
        'createdAt': iso(event.created_at),
        'updatedAt': iso(event.updated_at),
        'lastChange': last,
    }


def _allowed():
    return {'allowed': True}


def _denied(reason, blockers=None):
    out = {'allowed': False, 'reason': reason}
    if blockers:
        out['blockers'] = blockers
    return out


def unpublish_blockers(event: Event, *, confirming=None) -> list[dict]:
    if event.status not in LIVE_STATUSES:
        return [_b('NOT_PUBLISHED', 'Only a published event can be unpublished.')]
    blockers = []
    if event.confirmed_count > 0:
        blockers.append(_b('HAS_CONFIRMED', 'Players are confirmed for this event. Cancel the event instead.'))
    else:
        if confirming is None:
            confirming = Registration.objects.filter(event_id=event.pk).filter(
                Q(status='confirming') | Q(status='pending', payment_order_state__in=['attempted', 'paid'])).exists()
        if confirming:
            blockers.append(_b('PAYMENT_IN_FLIGHT', 'A payment is in progress for this event.'))
    return blockers


def capabilities(event: Event, *, confirming=None, ready=None) -> dict:
    status = event.status
    if status != 'draft':
        can_publish = _denied('This event is already published.' if status in LIVE_STATUSES
                              else f'A {status.replace("_", " ")} event cannot be published.')
    else:
        ready = ready or readiness(event)
        if ready['ready']:
            can_publish = _allowed()
        else:
            can_publish = _denied('Finish the missing details before publishing.', ready['blockers'])
    ub = unpublish_blockers(event, confirming=confirming)
    can_unpublish = _allowed() if not ub else _denied(ub[0]['reason'], ub)
    if status in LIVE_STATUSES:
        can_cancel = _allowed()
    elif status == 'draft':
        can_cancel = _denied('A draft is not cancelled. Delete or leave it as a draft.')
    else:
        can_cancel = _denied(f'A {status.replace("_", " ")} event cannot be cancelled.')
    can_edit = (_allowed() if status in EDITABLE_STATUSES
                else _denied(f'A {status.replace("_", " ")} event can no longer be edited.'))
    can_open_registration = (_allowed() if status == 'published'
                             else _denied('Only a published event can open registrations.'))
    can_close_registration = (
        _allowed() if status == 'registration_open'
        else _denied('Only an open-registration event can have registrations closed.')
    )
    can_delete = (_allowed() if status == 'draft'
                  else _denied('Only a draft event can be deleted.'))
    return {'canPublish': can_publish, 'canUnpublish': can_unpublish, 'canCancel': can_cancel, 'canEdit': can_edit,
            'canOpenRegistration': can_open_registration, 'canCloseRegistration': can_close_registration,
            'canDelete': can_delete}


def row_dto(event: Event, *, confirming=None) -> dict:
    return {
        'id': str(event.pk), 'title': event.title, 'slug': event.slug, 'type': event.type, 'status': event.status,
        'startsAt': iso(event.starts_at), 'area': event.area, 'city': event.city,
        'capacity': event.capacity, 'filled': event.confirmed_count,
        'pricePaise': event.price_paise, 'currency': 'INR', 'pairingMode': event.pairing_mode,
        'capabilities': capabilities(event, confirming=confirming), 'version': event.version,
    }


# ---------------------------------------------------------------- input parsing (E02, E04)

class _Errors:
    def __init__(self):
        self.fields: dict[str, list[str]] = {}

    def add(self, path, message):
        bucket = self.fields.setdefault(path, [])
        if message not in bucket:
            bucket.append(message)

    def done(self):
        if self.fields:
            raise ValidationFailed(fields=self.fields)


def _text(errs, path, value, max_len, *, required=False):
    if not isinstance(value, str):
        errs.add(path, 'Enter text.')
        return None
    value = value.strip()
    if required and not value:
        errs.add(path, 'This is required.')
        return None
    if len(value) > max_len:
        errs.add(path, f'Use at most {max_len} characters.')
        return None
    if v._HTML.search(value):
        errs.add(path, 'HTML is not allowed.')
        return None
    return value


def _int(errs, path, value, lo, hi, *, nullable=False):
    if value is None and nullable:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        errs.add(path, f'Enter a whole number from {lo} to {hi}.')
        return None
    return value


def _bool(errs, path, value):
    if not isinstance(value, bool):
        errs.add(path, 'Choose true or false.')
        return None
    return value


def _enum(errs, path, value, options):
    if not isinstance(value, str) or value not in options:
        errs.add(path, 'Choose one of the listed options.')
        return None
    return value


def _instant(errs, path, value):
    if value is None:
        return None
    parsed = None
    if isinstance(value, str) and len(value) <= 40:
        try:
            parsed = parse_datetime(value)
        except ValueError:
            parsed = None
    if not isinstance(parsed, datetime) or timezone.is_naive(parsed):
        errs.add(path, 'Use an ISO 8601 date-time with a UTC offset.')
        return None
    return parsed


def _object(errs, path, value, allowed):
    if not isinstance(value, dict):
        errs.add(path, 'Send an object.')
        return None
    for key in value:
        if key not in allowed:
            errs.add(f'{path}.{key}', 'This field cannot be changed here.')
    return {k: x for k, x in value.items() if k in allowed}


def valid_slug(errs, path, value):
    if not isinstance(value, str) or not v.is_slug(value) or not 3 <= len(value) <= 80:
        errs.add(path, 'Use 3 to 80 lowercase letters, digits and single hyphens.')
        return None
    return value


def parse_create(data) -> dict:
    errs = _Errors()
    if not isinstance(data, dict):
        raise ValidationFailed(fields={'form': ['Send a JSON object.']})
    for key in data:
        if key not in ('title', 'type', 'slug'):
            errs.add(str(key)[:60], 'This field cannot be changed here.')
    out = {}
    if 'title' not in data:
        errs.add('title', 'This is required.')
    else:
        out['title'] = _text(errs, 'title', data['title'], 120, required=True)
    out['type'] = _enum(errs, 'type', data['type'], v.EVENT_TYPES) if 'type' in data else 'social'
    out['slug'] = valid_slug(errs, 'slug', data['slug']) if data.get('slug') not in (None, '') else None
    errs.done()
    return out


def _clean_list(errs, path, value, max_items, item_fn):
    if not isinstance(value, list) or len(value) > max_items:
        errs.add(path, f'Send a list of at most {max_items} items.')
        return None
    items = []
    for i, raw in enumerate(value):
        item = item_fn(f'{path}.{i}', raw)
        if item is not None:
            items.append(item)
    return items


def _blank(*values):
    return all(isinstance(x, str) and not x.strip() for x in values)


def parse_patch(data) -> tuple[int, dict]:
    """-> (version, {step: {field: cleaned}}) for the fields present. Strict at every level."""
    errs = _Errors()
    if not isinstance(data, dict):
        raise ValidationFailed(fields={'form': ['Send a JSON object.']})
    steps = {'basics', 'experience', 'registration', 'payment', 'gameSystem', 'media', 'communications'}
    for key in data:
        if key != 'version' and key not in steps:
            errs.add(str(key)[:60], 'This field cannot be changed here.')
    version = data.get('version')
    if isinstance(version, bool) or not isinstance(version, int) or version < 0:
        errs.add('version', 'Send the version you loaded.')
        version = 0
    out: dict[str, dict] = {}

    if 'basics' in data:
        raw = _object(errs, 'basics', data['basics'],
                      {'title', 'slug', 'type', 'promise', 'startsAt', 'endsAt', 'venueName', 'address', 'area', 'city',
                       'audience'})
        if raw is not None:
            b = {}
            for key, limit in (('title', 120), ('promise', 200), ('venueName', 120), ('address', 300), ('area', 80),
                               ('city', 80)):
                if key in raw:
                    # Web draftText: a draft may blank the title; readiness reports it as a publish blocker.
                    b[key] = _text(errs, f'basics.{key}', raw[key], limit)
            if 'slug' in raw:
                # null / empty clears the slug (drafts only; a published event's slug is locked by the service).
                b['slug'] = (None if raw['slug'] in (None, '') else valid_slug(errs, 'basics.slug', raw['slug']))
            if 'type' in raw:
                b['type'] = _enum(errs, 'basics.type', raw['type'], v.EVENT_TYPES)
            if 'audience' in raw:
                b['audience'] = _enum(errs, 'basics.audience', raw['audience'], v.EVENT_AUDIENCES)
            for key in ('startsAt', 'endsAt'):
                if key in raw:
                    b[key] = _instant(errs, f'basics.{key}', raw[key])
            out['basics'] = b

    if 'experience' in data:
        raw = _object(errs, 'experience', data['experience'],
                      {'description', 'arrivalPromise', 'eyebrow', 'heading', 'body', 'highlights', 'logistics', 'faq',
                       'hostedArrival'})
        if raw is not None:
            e = {}
            for key, limit in (('description', 4000), ('arrivalPromise', 400), ('eyebrow', 60), ('heading', 160), ('body', 1200)):
                if key in raw:
                    e[key] = _text(errs, f'experience.{key}', raw[key], limit)
            if 'hostedArrival' in raw:
                e['hostedArrival'] = _bool(errs, 'experience.hostedArrival', raw['hostedArrival'])

            def highlight(path, item):
                o = _object(errs, path, item, {'title', 'body'})
                if o is None:
                    return None
                title = _text(errs, f'{path}.title', o.get('title', ''), 80)
                body = _text(errs, f'{path}.body', o.get('body', ''), 300)
                if title is None or body is None or _blank(title, body):
                    return None
                if _blank(title) or _blank(body):
                    errs.add(path, 'Fill in both the title and the text, or remove the row.')
                    return None
                return {'title': title, 'body': body}

            def faq(path, item):
                o = _object(errs, path, item, {'question', 'answer'})
                if o is None:
                    return None
                q = _text(errs, f'{path}.question', o.get('question', ''), 200)
                a = _text(errs, f'{path}.answer', o.get('answer', ''), 1500)
                if q is None or a is None or _blank(q, a):
                    return None
                if _blank(q) or _blank(a):
                    errs.add(path, 'Fill in both the question and the answer, or remove the row.')
                    return None
                return {'question': q, 'answer': a}

            def logistic(path, item):
                t = _text(errs, path, item, 400)
                return t or None

            if 'highlights' in raw:
                e['highlights'] = _clean_list(errs, 'experience.highlights', raw['highlights'], 8, highlight)
            if 'logistics' in raw:
                e['logistics'] = _clean_list(errs, 'experience.logistics', raw['logistics'], 12, logistic)
            if 'faq' in raw:
                e['faq'] = _clean_list(errs, 'experience.faq', raw['faq'], 20, faq)
            out['experience'] = e

    if 'registration' in data:
        raw = _object(errs, 'registration', data['registration'],
                      {'capacity', 'waitlistEnabled', 'opensAt', 'closesAt', 'membershipRequired', 'askFirstTimer',
                       'minAge'})
        if raw is not None:
            r = {}
            if 'capacity' in raw:
                if isinstance(raw['capacity'], str) and not raw['capacity'].strip():
                    raw['capacity'] = None  # empty means unlimited
                r['capacity'] = _int(errs, 'registration.capacity', raw['capacity'], 1, 100000, nullable=True)
            if 'minAge' in raw:
                r['minAge'] = _int(errs, 'registration.minAge', raw['minAge'], 0, 120, nullable=True)
            for key in ('waitlistEnabled', 'membershipRequired', 'askFirstTimer'):
                if key in raw:
                    r[key] = _bool(errs, f'registration.{key}', raw[key])
            for key in ('opensAt', 'closesAt'):
                if key in raw:
                    r[key] = _instant(errs, f'registration.{key}', raw[key])
            out['registration'] = r

    if 'payment' in data:
        raw = _object(errs, 'payment', data['payment'], {'pricePaise', 'refundWindowHours', 'holdMinutes'})
        if raw is not None:
            p = {}
            if 'pricePaise' in raw:
                p['pricePaise'] = _int(errs, 'payment.pricePaise', raw['pricePaise'], 0, MAX_PAISE)
            if 'refundWindowHours' in raw:
                p['refundWindowHours'] = _int(errs, 'payment.refundWindowHours', raw['refundWindowHours'], 0, 1440,
                                              nullable=True)
            if 'holdMinutes' in raw:
                p['holdMinutes'] = _int(errs, 'payment.holdMinutes', raw['holdMinutes'], 1, 60)
            out['payment'] = p

    if 'gameSystem' in data:
        raw = _object(errs, 'gameSystem', data['gameSystem'], {'rated', 'pool', 'pairingMode', 'rounds', 'timeControl'})
        if raw is not None:
            g = {}
            if 'rated' in raw:
                g['rated'] = _bool(errs, 'gameSystem.rated', raw['rated'])
            if 'pool' in raw:
                g['pool'] = _enum(errs, 'gameSystem.pool', raw['pool'], v.RATING_POOLS)
            if 'pairingMode' in raw:
                g['pairingMode'] = _enum(errs, 'gameSystem.pairingMode', raw['pairingMode'], v.PAIRING_MODES)
            if 'rounds' in raw:
                g['rounds'] = _int(errs, 'gameSystem.rounds', raw['rounds'], 1, 20, nullable=True)
            if 'timeControl' in raw:
                g['timeControl'] = _text(errs, 'gameSystem.timeControl', raw['timeControl'], 60)
            out['gameSystem'] = g

    if 'media' in data:
        raw = _object(errs, 'media', data['media'], {'assetIds', 'autoplay', 'intervalMs'})
        if raw is not None:
            parsed_media, media_errs = ms.parse_gallery(raw, 'media')
            for path, msgs in media_errs.items():
                for msg in msgs:
                    errs.add(path, msg)
            m = {}
            if 'asset_ids' in parsed_media:
                m['assetIds'] = [str(i) for i in parsed_media['asset_ids']]
            if 'autoplay' in parsed_media:
                m['autoplay'] = parsed_media['autoplay']
            if 'interval_ms' in parsed_media:
                m['intervalMs'] = parsed_media['interval_ms']
            out['media'] = m

    if 'communications' in data:
        raw = _object(errs, 'communications', data['communications'], {'triggers', 'channels'})
        if raw is not None:
            c = {}
            if 'triggers' in raw:
                trig = _object(errs, 'communications.triggers', raw['triggers'], set(TRIGGERS))
                if trig is not None:
                    c['triggers'] = {k: _bool(errs, f'communications.triggers.{k}', x) for k, x in trig.items()}
            if 'channels' in raw:
                if raw['channels'] != list(CHANNELS):
                    errs.add('communications.channels', 'Email is the only channel at launch.')
            out['communications'] = c
    errs.done()
    return version, out


def default_communications() -> dict:
    return {'triggers': {t: True for t in TRIGGERS}, 'channels': list(CHANNELS)}


def type_defaults(event_type: str) -> dict:
    label, pairing, rated, _engine = EVENT_TYPE_DEFAULTS[event_type]
    return {'format': label, 'pairing_mode': pairing, 'rated': rated, 'rating_pool': 'rapid' if rated else '',
            'hold_minutes': reg_conf.hold_minutes()}
