"""Admin players (contract 3.8: G01 list, G02 record, G03 role change).

Email, phone and the private profile are returned only here, only to admins (single role at launch, so every
permitted private field is visible). The role is changed only by `change_role`: step-up protected, audited in the
same transaction, never self-service, never the last active admin. A role change ends the target's sessions through
the existing family/role check (ROLE_CHANGED), so no token cleanup is needed here.
"""
from __future__ import annotations

import uuid

from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Q, Value
from django.db.models.functions import Replace
from django.utils import timezone

import audit
from accounts.models import Rating, User
from audit.models import AuditLog
from content import runtime_settings
from core.errors import NotFound, ValidationFailed
from core.responses import iso
from core.validation import PHONE_QUERY_RE, phone_digits
from registrations.models import Registration

from . import control_service as cs
from .permissions import require_step_up

ROLES = ('player', 'admin')
VISIBLE_FIELDS = ['phone', 'birthday', 'area', 'chessComHandle', 'fideId']
HISTORY_MAX = 100
ROLE_ACTION = 'player.role_change'
VIEW_ACTION = 'player.view_private'
VIEW_AUDIT_WINDOW = timedelta(minutes=5)  # one private-view audit row per admin+player per window (limits refetch flood)
MIN_PHONE_QUERY_DIGITS = 4
NATIONAL_NUMBER_DIGITS = 10  # a "+<cc>" query also matches stored numbers kept without the country code


def _name(user) -> str:
    return (user.name or '').strip()[:80] or 'Player'


def _parse_id(raw) -> uuid.UUID:
    try:
        return uuid.UUID(str(raw))
    except ValueError:
        raise NotFound() from None


def _attendance_pct(attended: int, registered: int):
    """Whole percent of past confirmed registrations attended; None (not 0) when there is nothing to divide by."""
    if registered <= 0:
        return None
    return min(100, round(100 * attended / registered))


def _primary_rating(ratings) -> dict | None:
    """The highest-games pool (ties: pool name); None when the player has no rating row. `provisional` lets the
    client show "New" (OQ-4)."""
    ratings = list(ratings)
    if not ratings:
        return None
    best = max(ratings, key=lambda r: (r.games_played, r.pool))
    return {'pool': best.pool, 'rating': best.rating, 'provisional': best.games_played < runtime_settings.provisional_games()}


def _row(u: User, attended: int, registered: int = 0, rating: dict | None = None) -> dict:
    return {'id': str(u.pk), 'name': _name(u), 'email': u.email, 'city': u.city or None, 'role': u.role,
            'status': u.status, 'eventsAttended': attended, 'joinedAt': iso(u.created_at),
            'rating': rating, 'attendancePct': _attendance_pct(attended, registered)}


def _search_filter(search: str) -> Q:
    """Name/email match the trimmed text. A phone-looking query also matches on digits only, against the stored
    number stripped the same way (stored phones keep their formatting), so "98765 43210", "+91 98765-43210" and
    "9876543210" find the same player."""
    cond = Q(name__icontains=search) | Q(email__icontains=search)
    digits = phone_digits(search)
    if PHONE_QUERY_RE.match(search) and len(digits) >= MIN_PHONE_QUERY_DIGITS:
        candidates = {digits}
        if search.startswith('+') and len(digits) > NATIONAL_NUMBER_DIGITS:
            candidates.add(digits[-NATIONAL_NUMBER_DIGITS:])
        for cand in candidates:
            cond |= Q(phone_digits__contains=cand)
    return cond


def list_players(request, pagination_cls):
    q = request.query_params
    search = (q.get('q') or '').strip()
    if len(search) > 100:
        raise ValidationFailed(fields={'q': ['Use at most 100 characters.']})
    now = timezone.now()
    confirmed = Q(event_registrations__status='confirmed')
    qs = User.objects.annotate(
        attended=Count('event_registrations', filter=confirmed & Q(event_registrations__checked_in_at__isnull=False)),
        registered=Count('event_registrations', filter=confirmed & Q(event_registrations__event__starts_at__lt=now)),
    )
    if search:
        stored = Value('')
        expr = Replace('phone', Value(' '), stored)
        for ch in '()+-':
            expr = Replace(expr, Value(ch), stored)
        qs = qs.annotate(phone_digits=expr).filter(_search_filter(search))
    qs = qs.order_by('-created_at', 'id').prefetch_related('ratings')  # one extra query for the whole page
    paginator = pagination_cls()
    rows = list(paginator.paginate_queryset(qs, request))
    return paginator, [_row(u, u.attended, u.registered, _primary_rating(u.ratings.all())) for u in rows]


def _flag(allowed: bool, reason: str = '') -> dict:
    return {'allowed': True} if allowed else {'allowed': False, 'reason': reason}


def _active_admins() -> int:
    return User.objects.filter(role='admin', status='active').count()


def _can_change_role(request, user: User) -> dict:
    if user.pk == request.user.pk:
        return _flag(False, 'You cannot change your own role.')
    if user.role == 'admin' and user.status == 'active' and _active_admins() <= 1:
        return _flag(False, 'This is the last admin. Promote another admin first.')
    return _flag(True)


def _version(user: User) -> int:
    return 1 + AuditLog.objects.filter(object_type='player', object_id=str(user.pk), action=ROLE_ACTION).count()


def _audit_private_view(request, user: User) -> None:
    """Record that this admin opened the player's private record (OQ-6). No PII in the payload: only the actor, the
    player id and the NAMES of the field groups exposed. One row per admin+player per VIEW_AUDIT_WINDOW. Any failure
    propagates, so the record is not returned without its audit row."""
    with transaction.atomic():
        since = timezone.now() - VIEW_AUDIT_WINDOW
        if AuditLog.objects.filter(actor=request.user, action=VIEW_ACTION, object_type='player',
                                   object_id=str(user.pk), occurred_at__gte=since).exists():
            return
        audit.write(request, action=VIEW_ACTION, object_type='player', object_id=user.pk,
                    after={'fields': VISIBLE_FIELDS})


def get_player(request, player_id) -> dict:
    pk = _parse_id(player_id)
    user = User.objects.filter(pk=pk).first()
    if user is None:
        raise NotFound()
    _audit_private_view(request, user)  # fail closed: no audit row, no private fields
    now = timezone.now()
    all_regs = Registration.objects.filter(user=user)
    regs = list(all_regs.select_related('event').order_by('-event__starts_at', '-created_at')[:HISTORY_MAX])
    confirmed = all_regs.filter(status='confirmed')
    attended = confirmed.filter(checked_in_at__isnull=False).count()
    registered = confirmed.filter(event__starts_at__lt=now).count()
    next_reg = confirmed.filter(event__starts_at__gte=now).select_related('event').order_by('event__starts_at', 'id').first()
    next_event = None if next_reg is None else {
        'id': str(next_reg.event_id), 'slug': next_reg.event.slug, 'title': next_reg.event.title[:120],
        'startsAt': iso(next_reg.event.starts_at)}
    history_total = all_regs.count()
    history = [{'registrationId': str(r.pk), 'eventId': str(r.event_id), 'eventSlug': r.event.slug,
                'eventTitle': r.event.title[:120], 'startsAt': iso(r.event.starts_at),
                'status': cs._web_status(r, now), 'attended': r.checked_in_at is not None}
               for r in regs if r.event.starts_at is not None]
    threshold = runtime_settings.provisional_games()
    rating_rows = list(Rating.objects.filter(user=user).order_by('pool'))
    ratings = [{'pool': r.pool, 'rating': r.rating, 'rd': r.rd, 'games': r.games_played,
                'provisional': r.games_played < threshold} for r in rating_rows]
    return {**_row(user, attended, registered, _primary_rating(rating_rows)),
            'registered': registered, 'nextEvent': next_event, 'historyTruncated': history_total > HISTORY_MAX,
            'phone': user.phone or None,
            'birthday': user.birthday.isoformat() if user.birthday else None, 'area': user.area or None,
            'chessComHandle': user.chess_com_handle or None, 'fideId': user.fide_id or None,
            'visibleFields': VISIBLE_FIELDS, 'history': history, 'ratings': ratings,
            'canChangeRole': _can_change_role(request, user), 'version': _version(user)}


def _parse_role(data) -> str:
    if not isinstance(data, dict):
        raise ValidationFailed(fields={'form': ['Send a JSON object.']})
    errors = {str(k)[:60]: ['This field cannot be changed here.'] for k in data if k != 'role'}
    role = data.get('role')
    if role not in ROLES:
        errors['role'] = ['Choose one of the listed options.']
    if errors:
        raise ValidationFailed(fields=errors)
    return role


def change_role(request, player_id, data) -> dict:
    role = _parse_role(data)
    pk = _parse_id(player_id)
    if User.objects.filter(pk=pk).first() is None:
        raise NotFound()
    require_step_up(request)  # before any change; single-use grant
    with transaction.atomic():
        # Lock every admin row (and the target) in a fixed order so two concurrent demotions cannot both pass the guard.
        ids = set(User.objects.filter(role='admin').values_list('pk', flat=True)) | {pk}
        locked = {u.pk: u for u in User.objects.select_for_update().filter(pk__in=ids).order_by('pk')}
        user = locked.get(pk)
        if user is None:
            raise NotFound()
        if user.pk == request.user.pk:
            raise ValidationFailed(fields={'role': ['You cannot change your own role.']})
        if user.role == role:
            return {'id': str(user.pk), 'role': user.role, 'changedAt': iso(user.updated_at)}
        if role == 'admin' and user.status != 'active':
            raise ValidationFailed(fields={'role': ['A suspended account cannot be made an admin.']})
        if user.role == 'admin' and user.status == 'active':
            remaining = sum(1 for u in locked.values() if u.role == 'admin' and u.status == 'active' and u.pk != pk)
            if remaining < 1:
                raise ValidationFailed(fields={'role': ['The last admin cannot be demoted.']})
        before = user.role
        user.role = role
        user.save(update_fields=['role', 'updated_at'])
        audit.write(request, action=ROLE_ACTION, object_type='player', object_id=user.pk,
                    before={'role': before}, after={'role': role})
        return {'id': str(user.pk), 'role': user.role, 'changedAt': iso(user.updated_at)}
