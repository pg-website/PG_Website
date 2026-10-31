"""Admin rounds and pairings (contract C06-C12, screen 49). Response shapes mirror
web/src/lib/api/types/admin/control-rounds.ts (camelCase inside `data`).

Lifecycle (STATE-MACHINES "Round"): draft -> published -> live -> completed. Every mutation runs in one
`transaction.atomic()` holding the round row lock, the change and the strict audit row. Players only ever see published,
live and completed rounds (`Round.VISIBLE`); a draft is invisible to them.

Concurrency: `Round.version` is the optimistic token sent by the client; `Round.pairing_version` counts pairing changes.
Rating processing is delegated to `ratings.services.process_round` (idempotent by RatingRun and `ratings_processed_at`).
"""
from __future__ import annotations

import logging
import uuid

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

import audit
from accounts.models import Rating, User
from content.models import Event
from core.errors import (EventNotFound, InternalError, NotPublishable, ResultNotAllowed, ResultsNotFinal,
                         RoundAlreadyFinalized, RoundNotFound, ValidationFailed, VersionConflict)
from core.responses import iso
from ratings.models import PoolRating
from ratings.services import InvalidRound, process_round
from registrations import pairing_engine as engine
from registrations.dto import current_ratings, pool_of
from registrations.models import Pairing, Registration, Round

logger = logging.getLogger('pg.adminapi')

OUTCOMES = ('white', 'black', 'draw')
GENERATE_EVENT_STATUSES = ('published', 'registration_open', 'sold_out', 'ongoing')
EDITABLE_STATES = ('draft', 'published', 'live')
MAX_ROUNDS = 30
MAX_CANDIDATES = 500  # matches the 500-board bound on edits


# ---------------------------------------------------------------- parsing helpers

def parse_uuid(value, field='id'):
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        raise ValidationFailed(fields={field: ['Use a valid id.']}) from None


def _path_uuid(value, error):
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        raise error() from None


def _fail(field, message):
    return ValidationFailed(fields={field: [message]})


def require_object(data) -> dict:
    if not isinstance(data, dict):
        raise _fail('form', 'Send a JSON object.')
    return data


def reject_unknown(data: dict, allowed) -> None:
    unknown = {str(k)[:60]: ['This field cannot be changed here.'] for k in data if k not in allowed}
    if unknown:
        raise ValidationFailed(fields=unknown)


def parse_int(data, key, *, lo, hi, required=True):
    if key not in data:
        if required:
            raise _fail(key, 'This is required.')
        return None
    value = data[key]
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise _fail(key, f'Enter a whole number from {lo} to {hi}.')
    return value


def parse_reason(data, *, required: bool) -> str:
    value = data.get('reason')
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise _fail('reason', 'This is required.')
        return ''
    if not isinstance(value, str) or len(value.strip()) > 500:
        raise _fail('reason', 'Use at most 500 characters.')
    return value.strip()


def _wrong_state(message):
    return _fail('form', message)


# ---------------------------------------------------------------- loading

def _event(event_id, *, lock=False) -> Event:
    eid = _path_uuid(event_id, EventNotFound)
    qs = Event.objects.select_for_update(of=('self',)) if lock else Event.objects
    event = qs.filter(pk=eid).first()
    if event is None:
        raise EventNotFound()
    return event


def _round(event, round_id, *, lock=False) -> Round:
    rid = _path_uuid(round_id, RoundNotFound)
    qs = Round.objects.select_for_update(of=('self',)) if lock else Round.objects
    rnd = qs.filter(pk=rid, event=event).first()
    if rnd is None:
        raise RoundNotFound()
    return rnd


# ---------------------------------------------------------------- DTOs

class _View:
    """Batch-loaded facts for rendering one or more rounds of an event (no N+1)."""

    def __init__(self, event: Event, rounds):
        self.event = event
        self.rounds = list(rounds)
        self.pairings: dict = {r.pk: [] for r in self.rounds}
        for p in Pairing.objects.filter(round__in=self.rounds).order_by('round_id', 'board'):
            self.pairings[p.round_id].append(p)
        user_ids = set()
        for plist in self.pairings.values():
            for p in plist:
                user_ids.add(p.white_id)
                if p.black_id:
                    user_ids.add(p.black_id)
        self.users = {u.pk: u for u in User.objects.filter(pk__in=user_ids)}
        self.regs = {r.user_id: r for r in Registration.objects.filter(event=event, user_id__in=user_ids)
                     .exclude(status__in=['cancelled', 'refunded']).order_by('created_at')}  # newest wins
        self.ratings = current_ratings(user_ids, pool_of(event))
        self.first_timers = _first_timers(event, user_ids)
        self.played = _played_pairs(event)

    def rematch(self, p: Pairing, rnd_pk) -> bool:
        """Advisory flag: the two players met in another published, live or completed round of this event."""
        return any(r != rnd_pk for r in self.played.get(frozenset((p.white_id, p.black_id)), ()))

    def candidates(self, rnd: Round) -> list[dict]:
        """Confirmed, pairing-active registrations not seated in this round, by name, capped at MAX_CANDIDATES.
        Only editable rounds need them; other rounds get an empty list."""
        if rnd.state not in EDITABLE_STATES:
            return []
        seated = {p.white_id for p in self.pairings[rnd.pk]} | {p.black_id for p in self.pairings[rnd.pk] if p.black_id}
        regs = list(Registration.objects.filter(event=self.event, status='confirmed', pairing_active=True)
                    .exclude(user_id__in=seated).select_related('user')
                    .order_by('user__name', 'user_id', 'pk')[:MAX_CANDIDATES])
        ids = {r.user_id for r in regs}
        ratings = current_ratings(ids, pool_of(self.event))
        first = _first_timers(self.event, ids)
        return [{'registrationId': str(r.pk), 'name': r.user.name, 'rating': ratings.get(r.user_id),
                 'firstTimer': r.user_id in first, 'checkedIn': r.checked_in_at is not None} for r in regs]

    def player(self, user_id) -> dict:
        user = self.users[user_id]
        reg = self.regs.get(user_id)
        return {'registrationId': str(reg.pk) if reg else str(uuid.UUID(int=0)), 'name': user.name,
                'rating': self.ratings.get(user_id), 'firstTimer': user_id in self.first_timers}


def _played_pairs(event: Event) -> dict:
    """{frozenset(user ids): {round pk, ...}} over published, live and completed rounds (the `_history` rule). One query."""
    played: dict = {}
    rows = (Pairing.objects.filter(round__event=event, round__state__in=Round.VISIBLE, is_bye=False)
            .values_list('round_id', 'white_id', 'black_id'))
    for round_id, white, black in rows:
        played.setdefault(frozenset((white, black)), set()).add(round_id)
    return played


def _first_timers(event, user_ids) -> set:
    """Players with no confirmed registration at an earlier event (a host-desk welcome cue, not a rating fact)."""
    if not user_ids or event.starts_at is None:
        return set(user_ids)
    seen = set(Registration.objects.filter(user_id__in=user_ids, status='confirmed',
                                           event__starts_at__lt=event.starts_at)
               .exclude(event=event).values_list('user_id', flat=True))
    return set(user_ids) - seen


def _flag(allowed: bool, reason: str = '', blockers=None) -> dict:
    if allowed:
        return {'allowed': True}
    out = {'allowed': False, 'reason': reason}
    if blockers:
        out['blockers'] = blockers
    return out


def _side(pairing: Pairing, user_id) -> str:
    if user_id is not None and user_id == pairing.white_id:
        return 'white'
    if user_id is not None and user_id == pairing.black_id:
        return 'black'
    return 'admin'


def _result_dto(p: Pairing) -> dict:
    state = p.result_state
    if state == 'final':
        return {'state': 'final', 'outcome': p.outcome, 'decidedBy': 'admin' if p.admin_decided else 'players',
                'adminReason': p.admin_reason or None}
    if state == 'submitted':
        return {'state': 'submitted', 'outcome': p.outcome, 'submittedBy': _side(p, p.submitted_by_id),
                'submittedAt': iso(p.submitted_at or p.updated_at)}
    if state == 'disputed':
        side = _side(p, p.disputed_by_id)
        return {'state': 'disputed', 'outcome': p.outcome, 'submittedBy': _side(p, p.submitted_by_id),
                'disputedBy': side if side in ('white', 'black') else 'white', 'note': p.dispute_note or None}
    return {'state': 'none'}


def _pairing_dto(p: Pairing, rnd: Round, view: _View) -> dict:
    if p.is_bye:
        return {'kind': 'bye', 'pairingId': str(p.pk), 'board': p.board, 'player': view.player(p.white_id)}
    live = rnd.state == 'live'
    if live:
        enter = _flag(True)
    elif rnd.state == 'completed':
        enter = _flag(False, 'The round is finalised, so results are locked.')
    else:
        enter = _flag(False, 'Results open once the round is live.')
    if live and p.result_state == 'disputed':
        resolve = _flag(True)
    elif not live:
        resolve = _flag(False, 'Disputes can be resolved while the round is live.')
    else:
        resolve = _flag(False, 'This result is not disputed.')
    return {'kind': 'game', 'pairingId': str(p.pk), 'board': p.board, 'white': view.player(p.white_id),
            'black': view.player(p.black_id), 'result': _result_dto(p), 'rematch': view.rematch(p, rnd.pk),
            'capabilities': {'canEnterResult': enter, 'canResolveDispute': resolve}}


def _unresolved(pairings) -> int:
    return sum(1 for p in pairings if not p.is_bye and p.result_state != 'final')


def _unresolved_reason(pairings) -> str:
    """'2 results pending, 1 disputed.' (zero parts omitted). A disputed result is not final, so it is never pending."""
    disputed = sum(1 for p in pairings if not p.is_bye and p.result_state == 'disputed')
    pending = _unresolved(pairings) - disputed
    parts = []
    if pending:
        parts.append(f'{pending} result{"s" if pending != 1 else ""} pending')
    if disputed:
        parts.append(f'{disputed} disputed')
    return ', '.join(parts) + '.'


def _publish_blockers(rnd: Round, pairings, view: _View) -> list[dict]:
    out = []
    if not pairings:
        out.append({'code': 'NO_PAIRINGS', 'reason': 'Add at least one board before publishing.'})
    missing = 0
    for p in pairings:
        for uid in (p.white_id, p.black_id):
            reg = view.regs.get(uid) if uid else None
            if uid and (reg is None or reg.status != 'confirmed'):
                missing += 1
    if missing:
        out.append({'code': 'PLAYER_NOT_CONFIRMED',
                    'reason': f'{missing} paired player{"s" if missing != 1 else ""} no longer hold a confirmed place.'})
    return out


def _capabilities(rnd: Round, pairings, view: _View) -> dict:
    state = rnd.state
    unresolved = _unresolved(pairings)
    if state in EDITABLE_STATES:
        edit = _flag(True)
    else:
        edit = _flag(False, 'A finalised round cannot be edited.' if state == 'completed' else 'This round was replaced.')
    if state == 'draft':
        blockers = _publish_blockers(rnd, pairings, view)
        publish = _flag(False, blockers[0]['reason'], blockers) if blockers else _flag(True)
    else:
        publish = _flag(False, 'Only a draft round can be published.')
    start = _flag(True) if state == 'published' else _flag(
        False, 'Publish the round first.' if state == 'draft' else 'Only a published round can be started.')
    if state == 'live':
        if unresolved:
            reason = _unresolved_reason(pairings)
            finalise = _flag(False, reason, [{'code': 'RESULTS_NOT_FINAL', 'reason': reason}])
        else:
            finalise = _flag(True)
    elif state == 'completed':
        finalise = _flag(False, 'This round is already finalised.')
    else:
        finalise = _flag(False, 'Start the round before finalising it.')
    return {'canEdit': edit, 'canPublish': publish, 'canStart': start, 'canFinalise': finalise}


def rating_processing_dto(event: Event, rnd: Round) -> dict:
    if not event.rated:
        return {'status': 'not_rated'}
    if rnd.ratings_processed_at:
        return {'status': 'complete', 'processedAt': iso(rnd.ratings_processed_at)}
    return {'status': 'pending', 'enqueuedAt': iso(rnd.completed_at or rnd.updated_at)}


def _round_dto(rnd: Round, view: _View) -> dict:
    pairings = view.pairings[rnd.pk]
    out = {
        'id': str(rnd.pk), 'roundNo': rnd.number, 'state': rnd.state, 'method': rnd.method,
        'pairings': [_pairing_dto(p, rnd, view) for p in pairings],
        'unresolvedResults': _unresolved(pairings), 'pairingVersion': rnd.pairing_version,
        'capabilities': _capabilities(rnd, pairings, view), 'version': rnd.version, 'updatedAt': iso(rnd.updated_at),
        'candidates': view.candidates(rnd),
    }
    if rnd.state in ('published', 'live', 'completed'):
        out['publishedAt'] = iso(rnd.published_at or rnd.created_at)
    if rnd.state in ('live', 'completed'):
        out['startedAt'] = iso(rnd.started_at or rnd.published_at or rnd.created_at)
    if rnd.state == 'completed':
        out['finalisedAt'] = iso(rnd.completed_at or rnd.updated_at)
        out['ratingProcessing'] = rating_processing_dto(view.event, rnd)
    return out


def round_dto(event: Event, rnd: Round) -> dict:
    return _round_dto(rnd, _View(event, [rnd]))


# ---------------------------------------------------------------- C06

def list_rounds(event_id) -> dict:
    event = _event(event_id)
    rounds = list(Round.objects.filter(event=event).order_by('number')[:MAX_ROUNDS])
    view = _View(event, rounds)
    return {'rounds': [_round_dto(r, view) for r in rounds], 'serverNow': iso(timezone.now())}


# ---------------------------------------------------------------- C07 generate

def parse_generate(data) -> tuple[int, str | None]:
    data = require_object(data)
    reject_unknown(data, {'roundNo', 'method'})
    round_no = parse_int(data, 'roundNo', lo=1, hi=100)
    method = data.get('method')
    if method is not None and method not in ('social_balanced', 'swiss', 'round_robin', 'none'):
        raise _fail('method', 'Choose one of the listed options.')
    return round_no, method


def _history(event: Event, exclude_round_id=None):
    """(History, scores) from published, live and completed rounds. Scores use FINAL results only."""
    history = engine.History()
    scores: dict = {}
    qs = (Pairing.objects.filter(round__event=event, round__state__in=Round.VISIBLE)
          .select_related('round').order_by('round__number', 'board'))
    if exclude_round_id is not None:
        qs = qs.exclude(round_id=exclude_round_id)
    for p in qs:
        if p.is_bye:
            history.byes[p.white_id] = history.byes.get(p.white_id, 0) + 1
            scores[p.white_id] = scores.get(p.white_id, 0.0) + 1
            continue
        history.played.add(frozenset((p.white_id, p.black_id)))
        history.colours.setdefault(p.white_id, []).append('W')
        history.colours.setdefault(p.black_id, []).append('B')
        scores.setdefault(p.white_id, 0.0)
        scores.setdefault(p.black_id, 0.0)
        if p.result_state == 'final':
            if p.outcome == 'white':
                scores[p.white_id] += 1
            elif p.outcome == 'black':
                scores[p.black_id] += 1
            else:
                scores[p.white_id] += 0.5
                scores[p.black_id] += 0.5
    return history, scores


def _next_board_pairings(rnd: Round, draft: engine.Draft, now) -> list[Pairing]:
    rows = []
    for board, (white, black) in enumerate(draft.boards, start=1):
        rows.append(Pairing(round=rnd, board=board, white_id=white, black_id=black, is_bye=False))
    next_board = len(draft.boards) + 1
    for offset, uid in enumerate(draft.byes):
        rows.append(Pairing(round=rnd, board=next_board + offset, white_id=uid, black_id=None, is_bye=True,
                            result_state='final', outcome='white', finalised_at=now))
    return rows


def generate_round(request, event_id, round_no: int, method: str | None):
    with transaction.atomic():
        event = _event(event_id, lock=True)
        if event.status not in GENERATE_EVENT_STATUSES:
            raise _wrong_state('Rounds can be generated once the event is published and until it ends.')
        method = method or event.pairing_mode
        if method not in engine.METHODS:
            raise _fail('method', 'Choose Swiss or social balanced. This event type has no automatic pairing.')
        planned = event.rounds_planned
        if planned and round_no > planned:
            raise _fail('roundNo', f'This event plans {planned} round{"s" if planned != 1 else ""}.')

        existing = Round.objects.select_for_update().filter(event=event, number=round_no).first()
        if existing is not None and existing.state != 'draft':
            raise _fail('roundNo', 'This round already exists. Edit its pairings instead.')
        if existing is None:
            top = Round.objects.filter(event=event).aggregate(m=Max('number'))['m'] or 0
            if round_no != top + 1:
                raise _fail('roundNo', f'The next round to generate is round {top + 1}.')
        previous = Round.objects.filter(event=event, number=round_no - 1).first() if round_no > 1 else None
        if round_no > 1 and (previous is None or previous.state not in ('completed', 'void')):
            raise _fail('roundNo', f'Finalise round {round_no - 1} before generating round {round_no}.')

        regs = list(Registration.objects.filter(event=event, status='confirmed', pairing_active=True)
                    .select_related('user'))
        checked_in = [r for r in regs if r.checked_in_at is not None]
        pool_regs = checked_in or regs
        if len(pool_regs) < 2:
            raise _fail('form', 'At least 2 checked-in or registered players are needed to pair a round.')

        history, scores = _history(event, exclude_round_id=existing.pk if existing else None)
        ratings = current_ratings([r.user_id for r in pool_regs], pool_of(event))
        players = [engine.Player(id=r.user_id, rating=ratings.get(r.user_id, engine.DEFAULT_RATING),
                                 score=scores.get(r.user_id, 0.0)) for r in pool_regs]
        draft = engine.build_round(players, history, method=method, round_no=round_no)
        now = timezone.now()

        if existing is None:
            rnd = Round.objects.create(event=event, number=round_no, state='draft', method=method,
                                       time_control=(event.time_control or '')[:40])
            before = None
        else:
            rnd = existing
            before = {'pairings': existing.pairings.count(), 'pairingVersion': existing.pairing_version}
            existing.pairings.all().delete()
            rnd.method = method
            rnd.version += 1
            rnd.pairing_version += 1
            rnd.save(update_fields=['method', 'version', 'pairing_version', 'updated_at'])
        Pairing.objects.bulk_create(_next_board_pairings(rnd, draft, now))
        # Auto-close registrations when round 1 is generated (the player pool is now fixed).
        if round_no == 1 and event.status == 'registration_open':
            if event.registration_closes_at is None or event.registration_closes_at > now:
                event.registration_closes_at = now
                event.save(update_fields=['registration_closes_at', 'updated_at'])
        audit.write(request, action='round.generate', object_type='round', object_id=rnd.pk, before=before,
                    after={'event': str(event.pk), 'roundNo': round_no, 'method': method, 'boards': len(draft.boards),
                           'byes': len(draft.byes), 'rematches': draft.rematches, 'source':
                           'checked_in' if checked_in else 'registered'})
    return event, rnd, existing is None


# ---------------------------------------------------------------- C08 edit pairings

def parse_edit(data) -> dict:
    data = require_object(data)
    reject_unknown(data, {'phase', 'version', 'boards', 'byes', 'reason'})
    phase = data.get('phase')
    if phase not in ('draft', 'after_publish'):
        raise _fail('phase', 'Choose draft or after_publish.')
    version = parse_int(data, 'version', lo=0, hi=2 ** 31 - 1)
    reason = parse_reason(data, required=phase == 'after_publish')
    boards_raw, byes_raw = data.get('boards'), data.get('byes')
    if not isinstance(boards_raw, list) or len(boards_raw) > 500:
        raise _fail('boards', 'Send a list of at most 500 boards.')
    if not isinstance(byes_raw, list) or len(byes_raw) > 50:
        raise _fail('byes', 'Send a list of at most 50 byes.')
    boards, errors, seen_boards, seen_players = [], {}, set(), set()
    for i, item in enumerate(boards_raw):
        key = f'boards.{i}'
        if not isinstance(item, dict):
            errors[key] = ['Send an object.']
            continue
        extra = [k for k in item if k not in ('pairingId', 'board', 'whiteRegistrationId', 'blackRegistrationId')]
        if extra:
            errors[key] = ['Unknown fields.']
            continue
        board = item.get('board')
        if isinstance(board, bool) or not isinstance(board, int) or not 1 <= board <= 500:
            errors[f'{key}.board'] = ['Enter a whole number from 1 to 500.']
            continue
        white = _opt_uuid(item.get('whiteRegistrationId'))
        black = _opt_uuid(item.get('blackRegistrationId'))
        if white is None or black is None:
            errors[key] = ['Choose a white and a black player.']
            continue
        if white == black:
            errors[key] = ['A player cannot play themselves.']
        if board in seen_boards:
            errors[f'{key}.board'] = ['Board numbers must be unique.']
        if white in seen_players or black in seen_players:
            errors[key] = ['A player can be on one board only.']
        seen_boards.add(board)
        seen_players.update((white, black))
        boards.append((board, white, black))
    byes = []
    for i, item in enumerate(byes_raw):
        reg_id = _opt_uuid(item.get('registrationId')) if isinstance(item, dict) and set(item) == {'registrationId'} else None
        if reg_id is None:
            errors[f'byes.{i}'] = ['Choose a player.']
        elif reg_id in seen_players:
            errors[f'byes.{i}'] = ['A player can be on one board or bye only.']
        else:
            seen_players.add(reg_id)
            byes.append(reg_id)
    if errors:
        raise ValidationFailed(fields=errors)
    return {'phase': phase, 'version': version, 'reason': reason, 'boards': boards, 'byes': byes}


def _opt_uuid(value):
    try:
        return uuid.UUID(str(value)) if value is not None else None
    except ValueError:
        return None


def _summary(pairings) -> list:
    return [{'board': p.board, 'white': str(p.white_id), 'black': str(p.black_id) if p.black_id else None,
             'bye': p.is_bye, 'result': p.result_state} for p in pairings]


def _seat_map(pairings) -> dict:
    """{user id: seat} for notification diffing. A game seat carries board, colour and opponent; a bye carries only
    'bye' (a bye's board number is not a change the player needs to hear about)."""
    out = {}
    for p in pairings:
        if p.is_bye:
            out[p.white_id] = ('bye',)
        else:
            out[p.white_id] = ('game', p.board, 'white', p.black_id)
            out[p.black_id] = ('game', p.board, 'black', p.white_id)
    return out


def _seat_text(seat, round_no: int, users: dict) -> str:
    if seat is None:
        return f'You are no longer seated in round {round_no}. Check the current pairings with the host.'
    if seat[0] == 'bye':
        return f'You have a bye in round {round_no}; you do not play a game.'
    _, board, colour, opponent = seat
    opp = users.get(opponent)
    return f'Round {round_no}, board {board}: you play {colour} against {opp.name if opp else "your opponent"}.'


def _queue_pairing_notices(event: Event, rnd: Round, targets, seats_after: dict, users: dict, regs: dict, *,
                           correction: bool) -> int:
    """Queue `pairing_published` for the targets (user ids) inside the caller's transaction. A target without a
    usable registration is skipped (it cannot be linked to a dedupe key)."""
    from comms import transactional  # lazy: comms imports registrations models
    notices = []
    for uid in sorted(targets, key=str):
        user, reg = users.get(uid), regs.get(uid)
        if user is None or reg is None:
            continue
        notices.append((user, reg.pk, _seat_text(seats_after.get(uid), rnd.number, users)))
    return transactional.queue_pairing_notices(event, rnd.number, rnd.pk, rnd.pairing_version, notices,
                                               correction=correction)


def edit_pairings(request, event_id, round_id, parsed: dict):
    with transaction.atomic():
        event = _event(event_id)
        rnd = _round(event, round_id, lock=True)
        if rnd.state not in EDITABLE_STATES:
            raise _wrong_state('A finalised round cannot be edited.')
        expected = 'draft' if rnd.state == 'draft' else 'after_publish'
        if parsed['phase'] != expected:
            raise _fail('phase', 'Use draft for a draft round and after_publish once it is published.')
        if parsed['version'] != rnd.version:
            raise VersionConflict()

        # Registrations -> players. Only confirmed registrations of THIS event can be paired.
        reg_ids = {r for _, w, b in parsed['boards'] for r in (w, b)} | set(parsed['byes'])
        regs = {r.pk: r for r in Registration.objects.filter(event=event, pk__in=reg_ids, status='confirmed')}
        unknown = reg_ids - set(regs)
        if unknown:
            raise _fail('boards', 'Every player must hold a confirmed place at this event.')
        desired = [(board, regs[w].user_id, regs[b].user_id) for board, w, b in parsed['boards']]
        bye_users = [regs[r].user_id for r in parsed['byes']]
        if desired and max(d[0] for d in desired) + len(bye_users) > 500:
            raise _fail('byes', 'There are too many boards and byes.')

        existing = list(Pairing.objects.select_for_update().filter(round=rnd).order_by('board'))
        before = _summary(existing)
        seats_before = _seat_map(existing)
        keep = {}
        for p in existing:
            if not p.is_bye:
                keep[(p.board, p.white_id, p.black_id)] = p
        desired_keys = set(desired)
        for key, p in keep.items():
            if key not in desired_keys and p.result_state != 'none':
                raise _fail('boards', 'A board with a result cannot be changed. Resolve or override its result instead.')
        old_byes = {p.white_id for p in existing if p.is_bye}
        unchanged = (desired_keys == set(keep) and set(bye_users) == old_byes and len(bye_users) == len(old_byes))
        if unchanged and rnd.state != 'draft':
            raise _fail('form', 'Nothing changed.')

        now = timezone.now()
        Pairing.objects.filter(round=rnd, is_bye=True).delete()
        Pairing.objects.filter(pk__in=[p.pk for key, p in keep.items() if key not in desired_keys]).delete()
        top = max([d[0] for d in desired] or [0])
        # A board number freed by the delete above can be reused; kept boards already hold theirs.
        Pairing.objects.bulk_create(
            [Pairing(round=rnd, board=b, white_id=w, black_id=k, is_bye=False) for b, w, k in desired
             if (b, w, k) not in keep]
            + [Pairing(round=rnd, board=top + 1 + i, white_id=uid, black_id=None, is_bye=True, result_state='final',
                       outcome='white', finalised_at=now) for i, uid in enumerate(bye_users)])
        rnd.version += 1
        rnd.pairing_version += 1
        if parsed['reason']:
            rnd.last_change_reason = parsed['reason']
        rnd.save(update_fields=['version', 'pairing_version', 'last_change_reason', 'updated_at'])
        after_rows = list(Pairing.objects.filter(round=rnd).order_by('board'))
        after = _summary(after_rows)
        audit.write(request, action='round.pairings.correct' if rnd.state != 'draft' else 'round.pairings.edit',
                    object_type='round', object_id=rnd.pk, before={'pairings': before, 'pairingVersion': rnd.pairing_version - 1},
                    after={'pairings': after, 'pairingVersion': rnd.pairing_version, 'state': rnd.state},
                    reason=parsed['reason'])
        if rnd.state != 'draft':  # a correction after publish: only players whose seat changed are told
            seats_after = _seat_map(after_rows)
            changed = {uid for uid in set(seats_before) | set(seats_after)
                       if seats_before.get(uid) != seats_after.get(uid)}
            if changed:
                users = {u.pk: u for u in User.objects.filter(pk__in=set(seats_before) | set(seats_after))}
                regs = {}
                for r in (Registration.objects.filter(event=event, user_id__in=changed)
                          .exclude(status__in=['cancelled', 'refunded']).order_by('created_at')):
                    regs[r.user_id] = r  # newest wins, as in _View
                _queue_pairing_notices(event, rnd, changed, seats_after, users, regs, correction=True)
    return event, rnd


# ---------------------------------------------------------------- C09-C10

def _check_version(rnd: Round, version: int):
    if version != rnd.version:
        raise VersionConflict()


def parse_version_body(data) -> int:
    data = require_object(data)
    reject_unknown(data, {'version'})
    return parse_int(data, 'version', lo=0, hi=2 ** 31 - 1)


def publish_round(request, event_id, round_id, version: int):
    with transaction.atomic():
        event = _event(event_id)
        rnd = _round(event, round_id, lock=True)
        _check_version(rnd, version)
        if rnd.state != 'draft':
            raise NotPublishable('Only a draft round can be published.',
                                 blockers=[{'code': 'ROUND_NOT_DRAFT', 'reason': 'This round is already published.'}])
        view = _View(event, [rnd])
        blockers = _publish_blockers(rnd, view.pairings[rnd.pk], view)
        if blockers:
            raise NotPublishable(blockers=blockers)
        now = timezone.now()
        rnd.state, rnd.published_at = 'published', now
        rnd.version += 1
        rnd.save(update_fields=['state', 'published_at', 'version', 'updated_at'])
        audit.write(request, action='round.publish', object_type='round', object_id=rnd.pk,
                    before={'state': 'draft'}, after={'state': 'published', 'pairingVersion': rnd.pairing_version})
        # Every seated player (board or bye) is told. Queued in this transaction: a rollback drops the notices.
        # No site revalidation: a round is a player-side room fact, not published website content (contract C09).
        targets = {uid for p in view.pairings[rnd.pk] for uid in (p.white_id, p.black_id) if uid}
        _queue_pairing_notices(event, rnd, targets, _seat_map(view.pairings[rnd.pk]), view.users, view.regs,
                               correction=False)
    return event, rnd


def start_round(request, event_id, round_id, version: int):
    with transaction.atomic():
        event = _event(event_id)
        rnd = _round(event, round_id, lock=True)
        _check_version(rnd, version)
        if rnd.state != 'published':
            raise _wrong_state('Publish the round first.' if rnd.state == 'draft' else 'Only a published round can be started.')
        rnd.state, rnd.started_at = 'live', timezone.now()
        rnd.version += 1
        rnd.save(update_fields=['state', 'started_at', 'version', 'updated_at'])
        audit.write(request, action='round.start', object_type='round', object_id=rnd.pk,
                    before={'state': 'published'}, after={'state': 'live'})
    return event, rnd


# ---------------------------------------------------------------- C11 result

def parse_result(data) -> dict:
    data = require_object(data)
    reject_unknown(data, {'action', 'outcome', 'reason'})
    action = data.get('action')
    if action not in ('record', 'resolve'):
        raise _fail('action', 'Choose record or resolve.')
    outcome = data.get('outcome')
    if outcome not in OUTCOMES:
        raise _fail('outcome', 'Choose white, black or draw.')
    return {'action': action, 'outcome': outcome, 'reason': parse_reason(data, required=False)}


def record_result(request, event_id, round_id, pairing_id, parsed: dict):
    pid = _path_uuid(pairing_id, RoundNotFound)
    with transaction.atomic():
        event = _event(event_id)
        rnd = _round(event, round_id, lock=True)
        pairing = Pairing.objects.select_for_update(of=('self',)).filter(pk=pid, round=rnd).first()
        if pairing is None:
            raise RoundNotFound()
        if rnd.state != 'live' or pairing.is_bye:
            raise ResultNotAllowed('Results can be entered on a game while its round is live.')
        if parsed['action'] == 'resolve' and pairing.result_state != 'disputed':
            raise ResultNotAllowed('Only a disputed result can be resolved.')
        before = {'resultState': pairing.result_state, 'outcome': pairing.outcome}
        now = timezone.now()
        pairing.result_state, pairing.outcome = 'final', parsed['outcome']
        pairing.admin_decided, pairing.admin_reason = True, parsed['reason']
        pairing.confirmed_by, pairing.confirmed_at, pairing.finalised_at = request.user, now, now
        pairing.save(update_fields=['result_state', 'outcome', 'admin_decided', 'admin_reason', 'confirmed_by',
                                    'confirmed_at', 'finalised_at', 'updated_at'])
        rnd.version += 1
        rnd.save(update_fields=['version', 'updated_at'])
        audit.write(request, action='round.result.resolve' if parsed['action'] == 'resolve' else 'round.result.record',
                    object_type='pairing', object_id=pairing.pk, before=before,
                    after={'resultState': 'final', 'outcome': parsed['outcome'], 'round': str(rnd.pk)},
                    reason=parsed['reason'])
        view = _View(event, [rnd])
        unresolved = _unresolved(view.pairings[rnd.pk])
        dto = _pairing_dto(pairing, rnd, view)
        caps = _capabilities(rnd, view.pairings[rnd.pk], view)['canFinalise']
    return {'pairing': dto, 'unresolvedResults': unresolved, 'canFinalise': caps, 'roundVersion': rnd.version}


# ---------------------------------------------------------------- C12 finalise

def _idempotency_key(request) -> str:
    return (request.META.get('HTTP_IDEMPOTENCY_KEY') or '').strip().lower()[:64]


def _finalise_result(event: Event, rnd: Round) -> dict:
    return {'roundId': str(rnd.pk), 'state': 'completed', 'finalisedAt': iso(rnd.completed_at or rnd.updated_at),
            'ratingProcessing': rating_processing_dto(event, rnd), 'version': rnd.version}


def _seed_pool_ratings(user_ids, pool: str) -> None:
    """A player whose only rating is the account-level summary starts the ledger from THAT rating, not from 1500."""
    have = set(PoolRating.objects.filter(user_id__in=user_ids, pool=pool).values_list('user_id', flat=True))
    legacy = Rating.objects.filter(user_id__in=set(user_ids) - have, pool=pool)
    PoolRating.objects.bulk_create(
        [PoolRating(user_id=r.user_id, pool=pool, rating=float(r.rating), rd=float(r.rd),
                    volatility=float(r.volatility), games=0) for r in legacy], ignore_conflicts=True)


def _rating_payload(event: Event, games, now) -> dict:
    """Seed pool ratings (rated events) and build the `process_round` payload from a round's non-bye pairings."""
    pool = pool_of(event)
    if event.rated:
        _seed_pool_ratings([p.white_id for p in games] + [p.black_id for p in games], pool)
    return {
        'event': {'id': str(event.pk), 'slug': event.slug, 'title': event.title[:120]},
        'pool': pool, 'rated': bool(event.rated), 'played_at': now.isoformat(),
        'pairings': [{'player1_id': str(p.white_id), 'player2_id': str(p.black_id),
                      'score': 1 if p.outcome == 'white' else 0 if p.outcome == 'black' else 0.5}
                     for p in games],
    }


def process_rating_backlog(limit: int = 20) -> dict:
    """Worker backstop: finalise normally rates a round in the same transaction, so this finds only a completed round
    whose `ratings_processed_at` is still empty (an interrupted or manually completed round). Each round runs under its
    row lock and `process_round` is idempotent by RatingRun, so repeating is safe. Returns counts only."""
    ids = list(Round.objects.filter(state='completed', ratings_processed_at__isnull=True)
               .order_by('completed_at', 'pk').values_list('pk', flat=True)[:limit])
    done = skipped = 0
    for pk in ids:
        with transaction.atomic():
            rnd = Round.objects.select_for_update(skip_locked=True).filter(
                pk=pk, state='completed', ratings_processed_at__isnull=True).first()
            if rnd is None:
                continue
            event = Event.objects.get(pk=rnd.event_id)
            games = list(Pairing.objects.select_for_update().filter(round=rnd, is_bye=False).order_by('board'))
            if _unresolved(games):
                skipped += 1
                continue
            now = timezone.now()
            if games:
                try:
                    process_round(rnd.pk, _rating_payload(event, games, now))
                except InvalidRound:
                    logger.error('rating_backlog_invalid round=%s', rnd.pk)
                    skipped += 1
                    continue
            rnd.ratings_processed_at = now
            rnd.save(update_fields=['ratings_processed_at', 'updated_at'])
            done += 1
    logger.info('job=process_ratings processed=%d skipped=%d', done, skipped)
    return {'processed': done, 'skipped': skipped}


def finalise_round(request, event_id, round_id, version: int) -> dict:
    key = _idempotency_key(request)
    with transaction.atomic():
        event = _event(event_id)
        rnd = _round(event, round_id, lock=True)
        if rnd.state == 'completed' or rnd.ratings_processed_at is not None:
            if key and rnd.finalise_key == key:
                return _finalise_result(event, rnd)  # same key: the original success
            raise RoundAlreadyFinalized()
        _check_version(rnd, version)
        if rnd.state != 'live':
            raise _wrong_state('Start the round before finalising it.' if rnd.state in ('draft', 'published')
                               else 'This round cannot be finalised.')
        pairings = list(Pairing.objects.select_for_update().filter(round=rnd).order_by('board'))
        unresolved = _unresolved(pairings)
        if unresolved:
            reason = _unresolved_reason(pairings)
            raise ResultsNotFinal(blockers=[{'code': 'RESULTS_NOT_FINAL', 'reason': reason}])

        now = timezone.now()
        games = [p for p in pairings if not p.is_bye]
        if games:
            payload = _rating_payload(event, games, now)
            try:
                process_round(rnd.pk, payload)  # same transaction: a failure rolls the whole finalise back
            except InvalidRound:
                logger.exception('round_finalise_invalid round=%s', rnd.pk)
                raise InternalError() from None
        rnd.state, rnd.completed_at, rnd.ratings_processed_at = 'completed', now, now
        rnd.finalise_key = key
        rnd.version += 1
        rnd.save(update_fields=['state', 'completed_at', 'ratings_processed_at', 'finalise_key', 'version',
                                'updated_at'])
        audit.write(request, action='round.finalise', object_type='round', object_id=rnd.pk,
                    before={'state': 'live'},
                    after={'state': 'completed', 'rated': bool(event.rated), 'games': len(games)})
        return _finalise_result(event, rnd)
