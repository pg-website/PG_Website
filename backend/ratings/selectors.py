"""Read queries for the ratings API. Owner-only by construction: every function takes the user and filters on it."""
from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from accounts.models import User

from .models import POOLS, RD_CEILING, RATING_MAX, RATING_MIN, PoolRating, RatingLedgerEntry

TREND_MAX_POINTS = 400  # the DTO allows at most 400
TREND_DEFAULT_DAYS = 90


def provisional_threshold() -> int:
    from content import runtime_settings
    return runtime_settings.provisional_games()  # admin setting, else RATING_PROVISIONAL_GAMES


def _clamp(value: float) -> int:
    return int(max(RATING_MIN, min(RATING_MAX, round(value))))


def pool_state(games: int) -> str:
    """unrated (no rated games) | provisional (fewer than the threshold) | established."""
    if games <= 0:
        return 'unrated'
    return 'provisional' if games < provisional_threshold() else 'established'


def _last_changes(user, pools) -> dict[str, int]:
    out: dict[str, int] = {}
    for pool in pools:
        delta = (RatingLedgerEntry.objects.filter(user=user, pool=pool, rated=True)
                 .order_by('-created', '-id').values_list('delta', flat=True).first())
        if delta is not None:
            out[pool] = delta
    return out


def ratings_summary_for(user: User) -> dict[str, dict]:
    """Exactly one summary per pool, keyed by pool, in the M10 DTO shape. Also the hook for accounts' /auth/me:
    ``[{'pool': p, 'rating': s['rating'], 'games': s['games'], 'provisional': s['state'] == 'provisional'}
       for p, s in ratings_summary_for(user).items() if s['state'] != 'unrated']``."""
    rows = {r.pool: r for r in PoolRating.objects.filter(user=user)}
    changes = _last_changes(user, [p for p, r in rows.items() if r.games > 0])
    summary: dict[str, dict] = {}
    for pool in POOLS:
        row = rows.get(pool)
        if row is None or row.games <= 0:
            summary[pool] = {'pool': pool, 'state': 'unrated', 'games': 0}
            continue
        summary[pool] = {
            'pool': pool,
            'state': pool_state(row.games),
            'rating': _clamp(row.rating),
            'rd': int(max(0, min(RD_CEILING, round(row.rd)))),
            'games': row.games,
            'lastChange': changes.get(pool),
        }
    return summary


def ledger_for(user: User, pool: str):
    """Rated rows only (the DTO requires numeric before/after/delta; unrated games carry no delta and are not listed).
    Newest first, stable on ties."""
    return (RatingLedgerEntry.objects.filter(user=user, pool=pool, rated=True).order_by('-created', '-id'))


def opponent_identities(entries) -> dict:
    """{opponent_id: (displayName, initials)} for one page of rows, in one query. Respects show_display_name."""
    ids = {e.opponent_id for e in entries if e.opponent_id}
    if not ids:
        return {}
    return {u.pk: public_identity(u.name, u.show_display_name) for u in User.objects.filter(pk__in=ids)}


def public_identity(name: str, visible: bool = True) -> tuple[str, str]:
    name = (name or '').strip()
    if not visible or not name:
        return 'PG player', 'PG'
    initials = ''.join(part[0] for part in name.split()[:2]).upper()
    return name[:80], (initials or name[0].upper())[:3]


def trend_for(user: User, pool: str, days: int = TREND_DEFAULT_DAYS) -> list[dict]:
    """Oldest-first series of {at, rating}: a starting point at the window start, then one point per rated game."""
    now = timezone.now()
    start = now - timedelta(days=days)
    base = RatingLedgerEntry.objects.filter(user=user, pool=pool, rated=True)
    rows = list(base.filter(created__gte=start).order_by('-created', '-id')[: TREND_MAX_POINTS - 1])
    rows.reverse()
    if rows:
        opening = rows[0].before
    else:
        last = base.filter(created__lt=start).order_by('-created', '-id').values_list('after', flat=True).first()
        if last is None:
            return []
        opening = last
    series = [{'at': start, 'rating': opening}]
    series += [{'at': r.created, 'rating': r.after} for r in rows]
    return series
