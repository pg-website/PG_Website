"""Event Room (contract M05-M09): snapshot, check-in, submit / confirm / dispute a result.

Owner-only by construction: every query starts from the caller's own confirmed registration, and every pairing lookup
requires the caller to be one of its two players. A foreign registration, event or pairing answers like a missing one
(NOT_FOUND / REGISTRATION_NOT_CONFIRMED), never with data and never revealing that it exists.

The snapshot is a pure function of the database and the clock (no writes on GET). Only the caller's own pairing is
returned, plus public standings built from final results with the players' public-identity toggles applied.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import timedelta

from django.db import transaction
from django.db.models import Max, Q
from django.utils import timezone

from core.errors import (CheckinWindowClosed, NotFound, RegistrationNotConfirmed, ResultNotAllowed, ValidationFailed)
from core.responses import iso
from core.validation import Collector, MISSING, require_object

from . import conf
from . import tiebreaks as tb
from .dto import IdentityBook, pool_of, venue_text
from .models import Pairing, Registration, Round
from ratings.models import RatingLedgerEntry

ROOM_STATES = ('before_checkin', 'checkin_open', 'pairing_pending', 'live_round', 'between_rounds', 'complete')
CHECKIN_KINDS = ('not_open', 'open', 'checked_in', 'manual_required', 'closed')
OUTCOMES = ('white', 'black', 'draw')
MAX_STANDINGS = 500

NEXT_ACTION = {
    'before_checkin': 'Check-in opens {m} minutes before play.',
    'checkin_open': 'Check-in is open. Tell the host you are here.',
    'manual': 'Check in at the host desk.',
    'pairing_pending': 'You are checked in. Your pairing is being prepared.',
    'pairing_missed': 'Check-in has closed. Ask the host desk to get you into the next round.',
    'live_round': 'A round is on. Find your board.',
    'live_bye': 'You have a bye this round.',
    'awaiting_confirmation': 'Your opponent submitted a result. Confirm it or raise an issue.',
    'between_rounds': 'Result saved. The next pairing is being prepared.',
    'complete': 'Event complete.',
}


# ---------------------------------------------------------------- loading (owner-only)

def own_confirmed_registration(user, event_id, *, lock: bool = False) -> Registration:
    try:
        eid = uuid.UUID(str(event_id))
    except ValueError:
        raise NotFound() from None
    qs = Registration.objects.select_related('event')
    if lock:
        qs = qs.select_for_update(of=('self',))
    reg = qs.filter(user=user, event_id=eid, status='confirmed').first()
    if reg is None:  # not registered, waitlisted, cancelled, someone else's event: all look the same
        raise RegistrationNotConfirmed()
    return reg


# ---------------------------------------------------------------- state

@dataclass
class RoomContext:
    reg: Registration
    event: object
    now: object
    state: str
    check_in: dict
    rounds: list
    current: Round | None
    my_pairing: Pairing | None       # in the current round, else the latest round I played
    my_in_current: bool
    result: dict
    capabilities: dict
    reasons: dict
    extra: dict = field(default_factory=dict)


def _window(event):
    opens = event.starts_at - timedelta(minutes=conf.checkin_opens_minutes_before())
    closes = event.starts_at + timedelta(minutes=conf.checkin_closes_minutes_after())
    return opens, closes


def check_in_dto(reg: Registration, event, now) -> dict:
    opens, closes = _window(event)
    if reg.checked_in_at is not None:
        return {'status': 'checked_in', 'at': iso(reg.checked_in_at)}
    if event.status in ('cancelled', 'completed'):
        return {'status': 'closed'}
    if now < opens:
        return {'status': 'not_open', 'opensAt': iso(opens)}
    if reg.manual_checkin_required:
        return {'status': 'manual_required', 'reason': 'Check in at the host desk. The host will mark you present.'}
    if now <= closes:
        return {'status': 'open', 'closesAt': iso(closes)}
    return {'status': 'closed'}


def result_dto(pairing: Pairing | None, user) -> dict:
    if pairing is None or pairing.is_bye:
        return {'state': 'none'}
    mine = pairing.submitted_by_id == user.pk
    who = 'me' if mine else 'opponent'
    if pairing.result_state == 'final':
        return {'state': 'final', 'outcome': pairing.outcome}
    if pairing.result_state == 'submitted':
        return {'state': 'submitted', 'submittedBy': 'me'} if mine else {'state': 'awaiting_confirmation', 'submittedBy': 'opponent'}
    if pairing.result_state == 'disputed':
        return {'state': 'disputed', 'submittedBy': who} if pairing.submitted_by_id else {'state': 'disputed'}
    return {'state': 'none'}


def _capabilities(user, check_in: dict, current: Round | None, pairing: Pairing | None, in_current: bool):
    can_check_in = check_in['status'] == 'open'
    live = current is not None and in_current and pairing is not None and not pairing.is_bye
    can_submit = bool(live and current.state == 'live' and pairing.result_state == 'none')
    can_confirm = bool(live and current.state == 'live' and pairing.result_state == 'submitted'
                       and pairing.submitted_by_id != user.pk)
    can_dispute = bool(live and current.state == 'live' and pairing.result_state == 'submitted')
    caps = {'canCheckIn': can_check_in, 'canSubmitResult': can_submit, 'canConfirmResult': can_confirm,
            'canDispute': can_dispute, 'canContactHost': True}

    reasons = {}
    if not can_check_in:
        status = check_in['status']
        reasons['canCheckIn'] = {
            'checked_in': 'You are already checked in.',
            'manual_required': 'Check-in is at the host desk for this event.',
        }.get(status, 'Check-in is not open right now.')
    if not can_submit:
        if pairing is not None and pairing.is_bye and in_current:
            reasons['canSubmitResult'] = 'You have a bye this round, so there is no result to submit.'
        elif live and pairing.result_state != 'none':
            reasons['canSubmitResult'] = 'A result is already in for this game.'
        else:
            reasons['canSubmitResult'] = 'Results open once your round is live.'
    if not can_confirm:
        reasons['canConfirmResult'] = 'There is no result waiting for you to confirm.'
    if not can_dispute:
        reasons['canDispute'] = 'There is no result to raise an issue about.'
    return caps, reasons


def load_context(reg: Registration, now) -> RoomContext:
    user, event = reg.user, reg.event
    rounds = list(Round.objects.filter(event=event, state__in=Round.VISIBLE).order_by('number'))
    active = [r for r in rounds if r.state in ('published', 'live')]
    current = active[-1] if active else None
    completed = [r for r in rounds if r.state == 'completed']

    check_in = check_in_dto(reg, event, now)
    opens, closes = _window(event)
    if event.status == 'completed':
        state = 'complete'
    elif current is not None:
        state = 'live_round'
    elif completed:
        state = 'between_rounds'
    elif reg.checked_in_at is not None or now > closes:
        state = 'pairing_pending'
    elif now >= opens:
        state = 'checkin_open'
    else:
        state = 'before_checkin'

    mine = {p.round_id: p for p in Pairing.objects.filter(round__in=rounds).filter(Q(white=user) | Q(black=user))}
    pairing, in_current = None, False
    if current is not None and current.pk in mine:
        pairing, in_current = mine[current.pk], True
    else:
        for rnd in reversed(rounds):
            if rnd.pk in mine and (current is None or rnd.pk != current.pk):
                pairing = mine[rnd.pk]
                break

    caps, reasons = _capabilities(user, check_in, current, pairing, in_current)
    return RoomContext(reg=reg, event=event, now=now, state=state, check_in=check_in, rounds=rounds, current=current,
                       my_pairing=pairing, my_in_current=in_current, result=result_dto(pairing, user),
                       capabilities=caps, reasons=reasons)


def next_action(ctx: RoomContext) -> str:
    if ctx.state == 'before_checkin':
        return NEXT_ACTION['before_checkin'].format(m=conf.checkin_opens_minutes_before())
    if ctx.state == 'checkin_open':
        return NEXT_ACTION['manual' if ctx.check_in['status'] == 'manual_required' else 'checkin_open']
    if ctx.state == 'pairing_pending':
        return NEXT_ACTION['pairing_pending' if ctx.reg.checked_in_at else 'pairing_missed']
    if ctx.state == 'live_round':
        if ctx.my_in_current and ctx.my_pairing is not None and ctx.my_pairing.is_bye:
            return NEXT_ACTION['live_bye']
        if ctx.result.get('state') == 'awaiting_confirmation':
            return NEXT_ACTION['awaiting_confirmation']
        return NEXT_ACTION['live_round']
    return NEXT_ACTION[ctx.state]


# ---------------------------------------------------------------- standings

def standings(event, rounds) -> list[dict]:
    """Public standings from FINAL results only. Identity toggles are applied; no ids are included."""
    pairings = list(Pairing.objects.filter(round__in=rounds))
    book = IdentityBook({p.white_id for p in pairings} | {p.black_id for p in pairings if p.black_id}, pool_of(event))
    played: dict = {}
    finals = []
    for p in pairings:
        for uid in (p.white_id, p.black_id):
            if uid is not None:
                played.setdefault(uid, 0)
        if p.result_state != 'final':
            continue
        played[p.white_id] += 1
        if not p.is_bye:
            played[p.black_id] += 1
        finals.append(tb.Game(p.white_id, None if p.is_bye else p.black_id, p.outcome))
    points = tb.score_of(finals, played)
    breaks = tb.compute(finals, played)
    ordered = sorted(played, key=lambda uid: (-points[uid], *breaks[uid].key(), book.name_key(uid), str(uid)))
    ordered = ordered[:MAX_STANDINGS]
    places = tb.place_numbers(ordered, points, breaks)
    rows = []
    for uid, place in zip(ordered, places):
        identity = book.get(uid)
        rows.append({'place': place, 'identity': identity, 'score': points[uid], 'rounds': played[uid],
                     'rating': identity['rating'], 'buchholz': breaks[uid].buchholz, '_uid': uid})
    return rows


def public_rows(rows):
    return [{k: v for k, v in row.items() if not k.startswith('_')} for row in rows]


def rating_processing(event, rounds, user=None) -> dict:
    """not_rated: unrated or social event, nothing finalised, or this player had no rated game (byes only).
    pending: a finalised round has not been rated yet. complete: the caller's net movement for this event, read from
    the append-only ledger (first `before`, last `after`)."""
    if not event.rated:
        return {'status': 'not_rated'}
    done = [r for r in rounds if r.state == 'completed']
    if not done:
        return {'status': 'not_rated'}
    if not all(r.ratings_processed_at for r in done):
        return {'status': 'pending'}
    if user is None:
        return {'status': 'not_rated'}
    rows = list(RatingLedgerEntry.objects.filter(user=user, event_id=event.pk, rated=True,
                                                 round_id__in=[r.pk for r in done]).order_by('created', 'id'))
    if not rows:
        return {'status': 'not_rated'}
    before, after = rows[0].before, rows[-1].after
    return {'status': 'complete', 'pool': rows[0].pool, 'before': before, 'after': after, 'delta': after - before}


# ---------------------------------------------------------------- snapshot

def version_marker(ctx: RoomContext) -> int:
    event = ctx.event
    rounds = Round.objects.filter(event=event).aggregate(m=Max('updated_at'))['m']
    pairings = Pairing.objects.filter(round__event=event).aggregate(m=Max('updated_at'))['m']
    newest = max(t for t in (ctx.reg.updated_at, event.updated_at, rounds, pairings) if t is not None)
    state_idx = ROOM_STATES.index(ctx.state)
    check_idx = CHECKIN_KINDS.index(ctx.check_in['status'])
    return int(newest.timestamp() * 1000) * 100 + state_idx * 10 + check_idx


def build_snapshot(reg: Registration, now=None) -> dict:
    now = now or timezone.now()
    ctx = load_context(reg, now)
    event = ctx.event
    base = {
        'eventId': str(event.pk), 'eventSlug': event.slug, 'title': event.title, 'venue': venue_text(event),
        'startsAt': iso(event.starts_at), 'serverNow': iso(now), 'version': version_marker(ctx),
        'checkIn': ctx.check_in, 'capabilities': ctx.capabilities, 'result': ctx.result,
        'disabledReasons': ctx.reasons, 'roomState': ctx.state,
    }
    if ctx.state == 'live_round':
        table = public_rows(standings(event, ctx.rounds))
        pairing, bye = None, None
        if ctx.my_in_current and ctx.my_pairing is not None:
            p = ctx.my_pairing
            if p.is_bye:
                bye = {'round': ctx.current.number}
            else:
                is_white = p.white_id == reg.user_id
                book = IdentityBook({p.black_id if is_white else p.white_id}, pool_of(event))
                pairing = {
                    'pairingId': str(p.pk), 'round': ctx.current.number, 'board': p.board,
                    'colour': 'white' if is_white else 'black',
                    'opponent': book.get(p.black_id if is_white else p.white_id),
                    'timeControl': (p.time_control or ctx.current.time_control or event.time_control)[:40],
                }
        return {**base, 'roundState': ctx.current.state, 'pairing': pairing, 'bye': bye, 'standings': table}
    if ctx.state in ('between_rounds', 'complete'):
        rows = standings(event, ctx.rounds)
        mine = next((r for r in rows if r['_uid'] == reg.user_id), None)
        score = {'points': mine['score'] if mine else 0, 'roundsPlayed': mine['rounds'] if mine else 0,
                 'place': mine['place'] if mine else None}
        if ctx.state == 'between_rounds':
            return {**base, 'score': score, 'standings': public_rows(rows), 'nextRoundAt': None}
        return {**base, 'score': score, 'standings': public_rows(rows),
                'ratingProcessing': rating_processing(event, ctx.rounds, reg.user)}
    return base


def snapshot_for(user, event_id) -> dict:
    return build_snapshot(own_confirmed_registration(user, event_id))


# ---------------------------------------------------------------- M06 check-in

def check_in(user, event_id) -> dict:
    with transaction.atomic():
        reg = own_confirmed_registration(user, event_id, lock=True)
        now = timezone.now()
        status = check_in_dto(reg, reg.event, now)
        if status['status'] == 'manual_required':
            raise CheckinWindowClosed('Check in at the host desk for this event.', reason='MANUAL_REQUIRED')
        if status['status'] == 'open':
            reg.checked_in_at = now
            reg.check_in_source = 'self'
            reg.save(update_fields=['checked_in_at', 'check_in_source', 'updated_at'])
        elif status['status'] != 'checked_in':  # already checked in is a harmless repeat
            raise CheckinWindowClosed()
    reg = own_confirmed_registration(user, event_id)
    snap = build_snapshot(reg)
    return {'checkIn': snap['checkIn'], 'capabilities': snap['capabilities'], 'serverNow': snap['serverNow'],
            'version': snap['version']}


# ---------------------------------------------------------------- M07-M09 results

def _update(user, event_id) -> dict:
    snap = build_snapshot(own_confirmed_registration(user, event_id))
    return {'result': snap['result'], 'capabilities': snap['capabilities'], 'serverNow': snap['serverNow'],
            'version': snap['version']}


def _parse_pairing_id(value) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError:
        raise NotFound() from None


def _locked_own_pairing(user, event_id, pairing_id) -> Pairing:
    """The pairing, locked, only if it belongs to this event AND the caller plays in it. Otherwise NOT_FOUND."""
    own_confirmed_registration(user, event_id)
    pairing = (Pairing.objects.select_for_update(of=('self',)).select_related('round')
               .filter(pk=pairing_id, round__event_id=uuid.UUID(str(event_id))).first())
    if pairing is None or user.pk not in (pairing.white_id, pairing.black_id):
        raise NotFound()
    return pairing


def submit_result(user, event_id, data) -> dict:
    c = Collector(require_object(data))
    c.reject_unknown({'pairingId', 'outcome'})
    raw_pairing = c.text('pairingId', max_len=36, min_len=36)
    outcome = c.choice('outcome', OUTCOMES, required=True)
    c.done()
    try:
        pairing_id = uuid.UUID(raw_pairing)
    except ValueError:
        raise ValidationFailed(fields={'pairingId': ['Check the format of this field.']}) from None
    with transaction.atomic():
        pairing = _locked_own_pairing(user, event_id, pairing_id)
        if pairing.round.state != 'live' or pairing.is_bye or pairing.result_state != 'none':
            raise ResultNotAllowed()
        pairing.result_state = 'submitted'
        pairing.outcome = outcome
        pairing.submitted_by = user
        pairing.submitted_at = timezone.now()
        pairing.save(update_fields=['result_state', 'outcome', 'submitted_by', 'submitted_at', 'updated_at'])
    return _update(user, event_id)


def confirm_result(user, event_id, pairing_id) -> dict:
    pid = _parse_pairing_id(pairing_id)
    with transaction.atomic():
        pairing = _locked_own_pairing(user, event_id, pid)
        # Only the OTHER player confirms; the submitter cannot confirm their own entry.
        if (pairing.round.state != 'live' or pairing.result_state != 'submitted'
                or pairing.submitted_by_id == user.pk):
            raise ResultNotAllowed()
        now = timezone.now()
        pairing.result_state = 'final'
        pairing.confirmed_by = user
        pairing.confirmed_at = now
        pairing.finalised_at = now
        pairing.save(update_fields=['result_state', 'confirmed_by', 'confirmed_at', 'finalised_at', 'updated_at'])
    return _update(user, event_id)


def dispute_result(user, event_id, pairing_id, data) -> dict:
    c = Collector(require_object(data if data not in (None, '') else {}))
    c.reject_unknown({'note'})
    note = c.text('note', max_len=500, required=False)
    c.done()
    pid = _parse_pairing_id(pairing_id)
    with transaction.atomic():
        pairing = _locked_own_pairing(user, event_id, pid)
        if pairing.round.state != 'live' or pairing.result_state != 'submitted':
            raise ResultNotAllowed()
        pairing.result_state = 'disputed'
        pairing.disputed_by = user
        pairing.disputed_at = timezone.now()
        pairing.dispute_note = note if note not in (None, MISSING) else ''
        pairing.save(update_fields=['result_state', 'disputed_by', 'disputed_at', 'dispute_note', 'updated_at'])
    return _update(user, event_id)
