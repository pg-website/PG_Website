"""Public player profile (PLAN-007). Gated by `dto.public_id_for`, so the list link and the profile cannot disagree.
Never emits email, phone, birthday, pk, handle or any flag."""
from __future__ import annotations

import re

from accounts.models import User

from .dto import current_ratings, initials_of, public_id_for
from .models import Registration

SLUG_RE = re.compile(r'^[a-z2-7]{12,16}$')
POOLS = ('classical', 'rapid', 'blitz')


def public_profile(slug: str) -> dict | None:
    """PublicProfile dict, or None for every non-visible case (malformed, unknown, hidden, suspended, minor)."""
    if not isinstance(slug, str) or not SLUG_RE.fullmatch(slug):
        return None
    user = User.objects.filter(public_slug=slug).first()
    if user is None or public_id_for(user) is None:
        return None
    ratings = []
    if user.show_ratings:
        for pool in POOLS:
            value = current_ratings([user.pk], pool).get(user.pk)
            if value is not None:
                ratings.append({'pool': pool, 'value': max(0, min(4000, value))})
    events_played = Registration.objects.filter(user=user, status='confirmed', event__status='completed').count()
    return {
        'publicId': user.public_slug,
        'displayName': user.name,
        'initials': initials_of(user.name),
        'cityChapter': user.city if (user.show_city_chapter and user.city) else None,
        'ratings': ratings,
        'memberSince': user.created_at.year,
        'eventsPlayed': events_played,
    }
