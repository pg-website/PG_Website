"""Session and credential logic (contract 2.4). Views stay thin; every rule lives here.

Revocations are committed BEFORE the error is raised: an exception inside transaction.atomic would roll them back.
"""
import hashlib
import logging
import secrets
from dataclasses import dataclass

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.utils import timezone

from core.errors import AuthRequired, InvalidCredentials, ResetTokenInvalid, StepUpRequired

from . import tokens
from .models import AuthFamily, PasswordResetToken, StepUpGrant, User

logger = logging.getLogger('pg.auth')

# Verified against when the email is unknown, so login timing does not reveal whether an account exists.
_DUMMY_HASH = make_password('pg-timing-neutral-dummy')


@dataclass
class Session:
    access: str
    refresh: str
    family: AuthFamily


def _lifetime(role: str):
    return settings.ADMIN_SESSION_LIFETIME if role == 'admin' else settings.PLAYER_SESSION_LIFETIME


def _prune_families() -> None:
    cutoff = timezone.now() - settings.SESSION_RETENTION
    AuthFamily.objects.filter(expires_at__lt=cutoff).delete()
    AuthFamily.objects.filter(revoked_at__lt=cutoff).delete()


def issue_session(user: User) -> Session:
    now = timezone.now()
    family = AuthFamily.objects.create(
        user=user, role=user.role, created_at=now, last_used_at=now, expires_at=now + _lifetime(user.role),
    )
    return Session(tokens.mint_access(user.pk, family.pk), tokens.make_refresh(family.pk, 0), family)


def revoke_family(family: AuthFamily, reason: str) -> None:
    if family.revoked_at is None:
        family.revoked_at = timezone.now()
        family.revoked_reason = reason
        family.save(update_fields=['revoked_at', 'revoked_reason'])


def revoke_all_for_user(user_id, reason: str = 'SESSION_EXPIRED') -> None:
    AuthFamily.objects.filter(user_id=user_id, revoked_at__isnull=True).update(
        revoked_at=timezone.now(), revoked_reason=reason,
    )


def authenticate_password(email: str, password: str) -> User | None:
    """Timing-neutral credential check: one hash verification whether or not the account exists."""
    user = User.objects.filter(email=email).first()
    if user is None:
        check_password(password, _DUMMY_HASH)
        return None
    return user if user.check_password(password) else None


def rotate_refresh(refresh_token: str | None) -> tuple[User, Session]:
    """A03. Returns the user and the new session pair, or raises AUTH_REQUIRED with a reason."""
    parsed = tokens.parse_refresh(refresh_token or '')
    if parsed is None:
        raise AuthRequired()
    family_id, generation = parsed
    failure: tuple[str | None] | None = None
    result = None

    with transaction.atomic():
        family = AuthFamily.objects.select_for_update().filter(pk=family_id).select_related('user').first()
        if family is None:
            raise AuthRequired()
        user = family.user
        now = timezone.now()
        if family.revoked_at is not None:
            known = family.revoked_reason in ('REFRESH_REUSED', 'SESSION_EXPIRED', 'ROLE_CHANGED', 'ACCOUNT_SUSPENDED')
            failure = (family.revoked_reason if known else None,)
        elif family.expires_at <= now:
            revoke_family(family, 'SESSION_EXPIRED')
            failure = ('SESSION_EXPIRED',)
        elif user.status == 'suspended':
            revoke_family(family, 'ACCOUNT_SUSPENDED')
            failure = ('ACCOUNT_SUSPENDED',)
        elif user.role != family.role:
            revoke_family(family, 'ROLE_CHANGED')
            failure = ('ROLE_CHANGED',)
        elif generation == family.generation:
            family.generation += 1
            family.rotated_at = now
            family.last_used_at = now
            family.save(update_fields=['generation', 'rotated_at', 'last_used_at'])
            result = family
        elif (
            generation == family.generation - 1
            and family.rotated_at is not None
            and now - family.rotated_at < settings.REFRESH_GRACE
        ):
            result = family  # lost response: hand back the current pair, no further rotation
        else:
            revoke_family(family, 'REFRESH_REUSED')
            failure = ('REFRESH_REUSED',)

    if failure is not None:
        raise AuthRequired(reason=failure[0])
    return result.user, Session(
        tokens.mint_access(result.user_id, result.pk), tokens.make_refresh(result.pk, result.generation), result,
    )


def logout(refresh_token: str | None, access_family_id=None) -> None:
    """A04. Revokes the family of any token presented; unknown or already revoked is a silent no-op."""
    ids = []
    parsed = tokens.parse_refresh(refresh_token or '')
    if parsed is not None:
        ids.append(parsed[0])
    if access_family_id is not None:
        ids.append(access_family_id)
    for family in AuthFamily.objects.filter(pk__in=ids, revoked_at__isnull=True):
        revoke_family(family, 'logout')


# ---- password reset ----
def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def request_password_reset(email: str) -> None:
    """A06. Does the same visible work for known and unknown emails; the email goes out on a background thread."""
    user = User.objects.filter(email=email).first()
    if user is None or user.status != 'active':
        return
    token = secrets.token_urlsafe(32)
    now = timezone.now()
    with transaction.atomic():
        PasswordResetToken.objects.filter(user=user, used_at__isnull=True).update(used_at=now)  # latest link wins
        PasswordResetToken.objects.create(
            user=user, token_hash=_hash_token(token), created_at=now, expires_at=now + settings.PASSWORD_RESET_TTL,
        )
    from comms import transactional  # lazy: comms imports registrations, which imports accounts
    link = f'{settings.FRONTEND_URL}/reset-password?token={token}'
    # Template store + provider adapter; failures are logged by class and never change the neutral response.
    transactional.send_password_reset_async(user.email, user.name, link)


def confirm_password_reset(token: str, new_password: str, validate) -> None:
    """A07. `validate(user)` raises WEAK_PASSWORD; a weak password does not burn the token."""
    with transaction.atomic():
        record = (
            PasswordResetToken.objects.select_for_update()
            .select_related('user')
            .filter(token_hash=_hash_token(token))
            .first()
        )
        now = timezone.now()
        if record is None or record.used_at is not None or record.expires_at <= now:
            raise ResetTokenInvalid()
        validate(record.user)
        record.used_at = now
        record.save(update_fields=['used_at'])
        user = record.user
        user.set_password(new_password)
        user.save(update_fields=['password', 'updated_at'])
        revoke_all_for_user(user.pk)  # contract 2.4: reset revokes every refresh family
    return user


# ---- authenticated password change (PLAN-012 TASK-205) ----
def change_own_password(user: User, current_password: str, new_password: str, validate) -> None:
    """A-NEW. Lets a signed-in user change their own password. Clears must_change_password. Revokes all sessions."""
    if not user.check_password(current_password):
        raise InvalidCredentials()
    validate(user)  # raises WeakPassword if too weak
    with transaction.atomic():
        user.set_password(new_password)
        user.must_change_password = False
        user.save(update_fields=['password', 'must_change_password', 'updated_at'])
        revoke_all_for_user(user.pk)


# ---- step-up ----
def issue_step_up(user: User, password: str) -> str:
    if not user.check_password(password):
        raise InvalidCredentials()
    grant = StepUpGrant.objects.create(user=user, expires_at=timezone.now() + settings.STEP_UP_TTL)
    return tokens.mint_step_up(user.pk, grant.pk)


def consume_step_up(token: str | None, user: User) -> None:
    """For admin views of refund, role change and export: STEP_UP_REQUIRED unless `token` is a live, unused grant."""
    payload = tokens.read_signed(token or '')
    if payload is None or payload.get('t') != tokens.STEP_UP or payload.get('u') != str(user.pk):
        raise StepUpRequired()
    with transaction.atomic():
        grant = StepUpGrant.objects.select_for_update().filter(pk=payload.get('j'), user=user).first()
        if grant is None or grant.used_at is not None or grant.expires_at <= timezone.now():
            raise StepUpRequired()
        grant.used_at = timezone.now()
        grant.save(update_fields=['used_at'])
