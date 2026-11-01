"""Player-area reads (M01-M04). All bounded, owner-scoped (`user=` is always the authenticated caller), no writes."""
from __future__ import annotations

from collections import Counter

from django.db.models import Q
from django.utils import timezone

from accounts.models import User
from core.responses import iso

from . import conf, room, rules
from .dto import IdentityBook, event_cover, event_link, pool_of, registration_dto, venue_text
from .models import Pairing, Registration, Round

ACTIVE_NOW = ('pending', 'confirming', 'confirmed', 'waitlist', 'offer')
PEOPLE_LIMIT = 50


def my_registrations(user: User, scope: str):
    """Queryset for M04. upcoming = active registrations on events that are not over; history = everything else."""
    now = timezone.now()
    base = Registration.objects.filter(user=user).select_related('event', 'event__cover')
    upcoming = Q(status__in=ACTIVE_NOW) & ~Q(event__status__in=['completed', 'cancelled']) & Q(event__ends_at__gte=now)
    if scope == 'upcoming':
        return base.filter(upcoming).order_by('event__starts_at', 'id')
    return base.exclude(upcoming).order_by('-event__starts_at', 'id')


def my_registration_dto(reg: Registration, now) -> dict:
    event = reg.event
    allowed, why = rules.cancel_policy(reg, event, now)
    status = rules.effective_status(reg, now)
    return {
        'registration': registration_dto(reg, now),
        'event': {**event_link(event), 'cover': event_cover(event)},
        'canCancel': allowed,
        'cancelBlockedReason': why,
        'canOpenRoom': status == 'confirmed' and event.status != 'cancelled',
    }


def next_up(user: User) -> dict | None:
    """M01: the soonest upcoming confirmed event, with the pairing once a round is published."""
    now = timezone.now()
    reg = (Registration.objects.filter(user=user, status='confirmed', event__ends_at__gte=now)
           .exclude(event__status__in=['completed', 'cancelled', 'draft']).select_related('event')
           .order_by('event__starts_at', 'id').first())
    if reg is None:
        return None
    ctx = room.load_context(reg, now)
    event = reg.event
    pairing = None
    p = ctx.my_pairing
    if ctx.my_in_current and p is not None and not p.is_bye and ctx.current is not None:
        is_white = p.white_id == user.pk
        book = IdentityBook({p.black_id if is_white else p.white_id}, pool_of(event))
        pairing = {'round': ctx.current.number, 'board': p.board, 'colour': 'white' if is_white else 'black',
                   'opponent': book.get(p.black_id if is_white else p.white_id)}
    return {'registrationId': str(reg.pk), 'event': {**event_link(event), 'cover': event_cover(event)}, 'venue': venue_text(event),
            'nextAction': room.next_action(ctx), 'pairing': pairing}


def _final_pairings(user: User):
    return (Pairing.objects.filter(result_state='final', is_bye=False, round__state__in=Round.VISIBLE)
            .filter(Q(white=user) | Q(black=user)).select_related('round', 'round__event'))


def recent_games(user: User):
    """M02 source rows: the caller's FINAL, non-bye pairings, newest first."""
    return _final_pairings(user).order_by('-finalised_at', '-id')


def game_dtos(user: User, pairings) -> list[dict]:
    rows = list(pairings)
    opponent_ids = {(p.black_id if p.white_id == user.pk else p.white_id) for p in rows}
    books: dict[str, IdentityBook] = {}
    out = []
    for p in rows:
        event = p.round.event
        pool = pool_of(event)
        book = books.get(pool) or books.setdefault(pool, IdentityBook(opponent_ids, pool))
        is_white = p.white_id == user.pk
        if p.outcome == 'draw':
            outcome = 'draw'
        else:
            outcome = 'win' if (p.outcome == 'white') == is_white else 'loss'
        out.append({
            'id': str(p.pk), 'outcome': outcome, 'pool': pool,
            'opponent': book.get(p.black_id if is_white else p.white_id),
            'ratingDelta': None,  # slice 2B's rating ledger will fill this once it exists
            'eventTitle': event.title, 'playedAt': iso(p.finalised_at or p.updated_at),
        })
    return out


def people(user: User) -> list[dict]:
    """M03: opponents played most (final games), public identity only."""
    counts: Counter = Counter()
    pools: dict = {}
    for p in _final_pairings(user):
        other = p.black_id if p.white_id == user.pk else p.white_id
        counts[other] += 1
        pools.setdefault(other, pool_of(p.round.event))
    top = counts.most_common(PEOPLE_LIMIT)
    books: dict[str, IdentityBook] = {}
    out = []
    for uid, games in sorted(top, key=lambda kv: (-kv[1], str(kv[0]))):
        pool = pools[uid]
        book = books.get(pool) or books.setdefault(pool, IdentityBook(counts.keys(), pool))
        out.append({'identity': book.get(uid), 'games': games})
    return out
