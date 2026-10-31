"""Response projections (camelCase inside `data`). Everything here is built from the caller's OWN rows, or from the
public identity subset of other players (name/rating/city per their visibility flags). No email, phone, birthday,
handle, user id or provider id is ever emitted (NCT-L1, NCT-L2). The one deliberate exception is the opaque
`publicId` (User.public_slug, PLAN-007): a random slug, never the pk, emitted only when `public_id_for` allows it."""
from __future__ import annotations

from django.utils import timezone

from accounts.models import Rating, User
from core.responses import iso
from ratings.models import PoolRating

from . import rules
from .models import Registration

HIDDEN_NAME = 'PG player'
HIDDEN_INITIALS = 'PG'


def initials_of(name: str) -> str:
    parts = [p for p in name.replace('-', ' ').split() if p[:1].isalnum()]
    letters = ''.join(p[0] for p in parts[:2]).upper()
    return letters[:3] or HIDDEN_INITIALS


class _RatingValue:
    __slots__ = ('rating',)

    def __init__(self, rating: int):
        self.rating = rating


def current_ratings(user_ids, pool: str) -> dict:
    """{user_id: int rating} in one or two queries. The ratings app's PoolRating (moved only by process_round) wins
    once the player has rated games; the account-level summary row is the fallback for players without any."""
    ids = {i for i in user_ids if i is not None}
    if not ids:
        return {}
    out = {r.user_id: int(round(r.rating)) for r in Rating.objects.filter(user_id__in=ids, pool=pool)}
    for row in PoolRating.objects.filter(user_id__in=ids, pool=pool, games__gt=0):
        out[row.user_id] = int(round(row.rating))
    return out


MINOR_AGE = 18


def is_minor(user: User, today=None) -> bool:
    """Derived from `birthday` only. No guardian-consent field exists yet, so a minor is treated as without consent
    (F-15). An unknown birthday is not a minor."""
    born = user.birthday
    if born is None:
        return False
    today = today or timezone.localdate()
    age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
    return age < MINOR_AGE


def public_id_for(user: User) -> str | None:
    """The single visibility gate for the public player profile: the slug, or None when the player must not be
    linkable (hidden display name, suspended, minor without consent, or no slug yet)."""
    if not user.public_slug or not user.show_display_name or user.status != 'active' or is_minor(user):
        return None
    return user.public_slug


def identity_dto(user: User, pool: str, rating_row: Rating | None) -> dict:
    """PublicIdentity: the visibility toggles are applied HERE, before anything is sent."""
    shown = user.show_display_name
    rating = None
    if user.show_ratings and rating_row is not None:
        rating = {'pool': pool, 'value': max(0, min(4000, rating_row.rating))}
    return {
        'displayName': user.name if shown else HIDDEN_NAME,
        'initials': initials_of(user.name) if shown else HIDDEN_INITIALS,
        'rating': rating,
        'cityChapter': user.city if (user.show_city_chapter and user.city) else None,
        'publicId': public_id_for(user),
    }


class IdentityBook:
    """Batch loader: two queries for any number of players (no N+1)."""

    def __init__(self, user_ids, pool: str):
        ids = {i for i in user_ids if i is not None}
        self.pool = pool
        self.users = {u.pk: u for u in User.objects.filter(pk__in=ids)}
        self.ratings = {uid: _RatingValue(value) for uid, value in current_ratings(ids, pool).items()}

    def get(self, user_id) -> dict:
        user = self.users.get(user_id)
        if user is None:  # should not happen (FK PROTECT); never fabricate a real identity
            return {'displayName': HIDDEN_NAME, 'initials': HIDDEN_INITIALS, 'rating': None, 'cityChapter': None,
                    'publicId': None}
        return identity_dto(user, self.pool, self.ratings.get(user_id))

    def name_key(self, user_id) -> str:
        user = self.users.get(user_id)
        return (user.name if user else '').lower()


def pool_of(event) -> str:
    return event.rating_pool or 'rapid'


# ---------------------------------------------------------------- registration

def payment_summary(reg: Registration, event=None) -> dict | None:
    if reg.payment_order_state == 'none' and reg.refund_state == 'none':
        return None
    order = reg.payment_order_state if reg.payment_order_state != 'none' else 'paid'
    if reg.refund_state == 'refunded':
        order = 'refunded'  # a late-captured payment keeps `paid` while the refund is `pending`
    amount = reg.amount_paise or (event.price_paise if event is not None else 0)
    return {'orderState': order, 'refundState': reg.refund_state, 'amountPaise': amount, 'currency': 'INR'}


def registration_dto(reg: Registration, now) -> dict:
    """RegistrationDto (discriminated on `status`). `reg.event` must be loaded (select_related)."""
    event = reg.event
    base = {'id': str(reg.pk), 'eventId': str(event.pk), 'eventSlug': event.slug, 'createdAt': iso(reg.created_at)}
    status = rules.effective_status(reg, now)

    if status == 'expired':  # an unpaid hold or unclaimed offer that ran out; the scheduler will persist it
        when = reg.hold_expires_at or reg.offer_expires_at or now
        return {**base, 'status': 'cancelled', 'cancelledAt': iso(when), 'payment': None}
    if status in ('pending', 'confirming'):
        in_flight = status == 'confirming' or reg.payment_order_state in ('attempted', 'paid')
        hold = {'holdExpiresAt': iso(reg.hold_expires_at or now), 'serverNow': iso(now)}
        if in_flight:
            payment = payment_summary(reg, event) or {
                'orderState': 'attempted', 'refundState': 'none', 'amountPaise': event.price_paise, 'currency': 'INR'}
            return {**base, 'status': 'confirming', **hold, 'payment': payment}
        return {**base, 'status': 'pending', **hold, 'payment': payment_summary(reg, event)}
    if status == 'confirmed':
        return {**base, 'status': 'confirmed', 'payment': payment_summary(reg, event)}
    if status in ('waitlist', 'offer'):
        offer = None
        if status == 'offer':
            offer = {'expiresAt': iso(reg.offer_expires_at), 'serverNow': iso(now)}
        return {**base, 'status': 'waitlist', 'position': reg.waitlist_position(now), 'offer': offer}
    if status == 'refunded':
        return {**base, 'status': 'refunded', 'refundedAt': iso(reg.refunded_at or reg.cancelled_at or now),
                'payment': payment_summary(reg, event) or {
                    'orderState': 'refunded', 'refundState': 'refunded', 'amountPaise': event.price_paise,
                    'currency': 'INR'}}
    return {**base, 'status': 'cancelled', 'cancelledAt': iso(reg.cancelled_at or now),
            'payment': payment_summary(reg, event)}


def event_link(event) -> dict:
    return {'id': str(event.pk), 'slug': event.slug, 'title': event.title, 'startsAt': iso(event.starts_at),
            'area': event.area, 'status': event.status}


def event_cover(event):
    """Public media shape for the event cover, or None. An archived asset is never exposed."""
    from content.serializers import media_dto
    cover = event.cover
    return None if cover is None or cover.archived else media_dto(cover)


def venue_text(event) -> str:
    return f'{event.venue_name} · {event.area}'[:200]
