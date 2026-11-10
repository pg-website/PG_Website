"""Auth endpoints A01-A10, step-up, and the /me profile endpoints (M13-M16)."""
import logging

from django.conf import settings
from django.db import IntegrityError, transaction
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.views import APIView

from content import runtime_settings
from core import ratelimit
from core.clientip import client_ip
from core.errors import (AuthRequired, EmailTaken, InvalidCredentials, NotFound, SignupClosed, ValidationFailed,
                         WeakPassword)
from core.responses import ok
from core.validation import MISSING, PHONE_RE, CHESS_HANDLE_RE, FIDE_ID_RE, Collector, present, require_object

from . import passwords, services
from .authentication import bearer_token
from .dto import MOODS, PLAY_STYLES, me_dto, profile_dto
from .models import User

logger = logging.getLogger('pg.auth')

COOKIE_MODE = lambda: settings.AUTH_TOKEN_MODE == 'cookie'  # noqa: E731  (read per request so tests can override)


class PublicView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]


class PrivateView(APIView):
    permission_classes = [IsAuthenticated]


# ---- token delivery (contract 2.4: body mode vs cookie mode) ----
def _set_refresh_cookie(response, session) -> None:
    max_age = max(1, int((session.family.expires_at - session.family.created_at).total_seconds()))
    response.set_cookie(
        settings.AUTH_REFRESH_COOKIE_NAME,
        session.refresh,
        max_age=max_age,
        path=settings.AUTH_REFRESH_COOKIE_PATH,
        secure=settings.AUTH_REFRESH_COOKIE_SECURE,
        httponly=True,
        samesite='Strict',
    )


def _token_data(session) -> dict:
    data = {'accessToken': session.access}
    if not COOKIE_MODE():
        data['refreshToken'] = session.refresh
    return data


def _token_response(session, extra=None, *, status=200):
    response = ok({**(extra or {}), **_token_data(session)}, status=status)
    if COOKIE_MODE():
        _set_refresh_cookie(response, session)
    return response


def _require_csrf_header(request) -> None:
    # Cookie mode only: a custom header cannot be sent cross-site without a CORS preflight, which the allow-list denies.
    if COOKIE_MODE() and not request.META.get('HTTP_X_CSRF_TOKEN', '').strip():
        raise AuthRequired()


def _refresh_token_from(request) -> str | None:
    if COOKIE_MODE():
        return request.COOKIES.get(settings.AUTH_REFRESH_COOKIE_NAME)
    data = request.data if isinstance(request.data, dict) else {}
    token = data.get('refreshToken')
    return token if isinstance(token, str) else None


# ---- A01 ----
class RegisterView(PublicView):
    def post(self, request):
        if not runtime_settings.signup_open():  # admin setting auth.signupOpen (G08)
            raise SignupClosed()
        data = require_object(request.data)
        c = Collector(data)
        c.reject_unknown({'name', 'email', 'password', 'city', 'phone'})
        name = c.text('name', max_len=80)
        email = c.email()
        password = data.get('password')
        message = passwords.check_length(password)
        if message:
            c.add('password', message)
        city = c.text('city', max_len=80, required=False)
        phone = c.text('phone', max_len=20, min_len=7, required=False, pattern=PHONE_RE)
        c.done()

        ip = client_ip(request)
        ratelimit.check_and_hit('register-ip', ip, ratelimit.REGISTER_PER_IP)
        ratelimit.check_and_hit('register-email', email, ratelimit.REGISTER_PER_EMAIL)
        if passwords.is_weak(password, email):
            raise WeakPassword(fields={'password': [WeakPassword.default_detail]})
        try:
            with transaction.atomic():
                if User.objects.filter(email=email).exists():
                    raise EmailTaken(fields={'email': [EmailTaken.default_detail]})
                user = User.objects.create_user(
                    email, password, name, city=city if present(city) else None, phone=phone if present(phone) else None,
                )
                session = services.issue_session(user)
        except IntegrityError:  # lost a race on the unique email
            raise EmailTaken(fields={'email': [EmailTaken.default_detail]}) from None
        return _token_response(session, {'user': me_dto(user)}, status=201)


# ---- A02 ----
class LoginView(PublicView):
    def post(self, request):
        data = require_object(request.data)
        c = Collector(data)
        c.reject_unknown({'email', 'password'})
        email = c.email()
        password = data.get('password')
        if not isinstance(password, str) or not password:
            c.add('password', 'This is required.')
        elif len(password) > passwords.MAX_LENGTH:
            c.add('password', f'Use at most {passwords.MAX_LENGTH} characters.')
        c.done()

        ratelimit.check_and_hit('login-ip', client_ip(request), ratelimit.LOGIN_PER_IP)
        ratelimit.check('login', email, ratelimit.LOGIN_FAILURES_PER_EMAIL)  # same for known and unknown emails
        user = services.authenticate_password(email, password)
        if user is None:
            ratelimit.hit('login', email, ratelimit.LOGIN_FAILURES_PER_EMAIL)
            raise InvalidCredentials()
        if user.status == 'suspended':
            raise AuthRequired(reason='ACCOUNT_SUSPENDED')
        ratelimit.clear('login', email)
        return _token_response(services.issue_session(user), {'user': me_dto(user)})


# ---- A03 ----
class RefreshView(PublicView):
    def post(self, request):
        _require_csrf_header(request)
        ratelimit.check_and_hit('refresh-ip', client_ip(request), ratelimit.REFRESH_PER_IP)
        try:
            _user, session = services.rotate_refresh(_refresh_token_from(request))
        except AuthRequired as exc:
            if COOKIE_MODE():
                exc.delete_cookies = [(settings.AUTH_REFRESH_COOKIE_NAME, settings.AUTH_REFRESH_COOKIE_PATH)]
            raise
        return _token_response(session)


# ---- A04 ----
class LogoutView(PublicView):
    def post(self, request):
        _require_csrf_header(request)
        family_id = None
        raw = bearer_token(request)
        if raw:
            from . import tokens

            payload = tokens.read_signed(raw)
            if payload and payload.get('t') == tokens.ACCESS:
                family_id = payload.get('f')
        services.logout(_refresh_token_from(request), family_id)
        response = ok(None, status=200)
        response.delete_cookie(settings.AUTH_REFRESH_COOKIE_NAME, path=settings.AUTH_REFRESH_COOKIE_PATH)
        return response


# ---- A05 ----
class MeView(PrivateView):
    def get(self, request):
        return ok(me_dto(request.user), headers={'Cache-Control': 'no-store'})


# ---- A06 ----
class PasswordResetRequestView(PublicView):
    def post(self, request):
        c = Collector(require_object(request.data))
        c.reject_unknown({'email'})
        email = c.email()
        c.done()
        # Both limits count every request, known email or not, so the limit itself reveals nothing.
        ratelimit.check_and_hit('reset-ip', client_ip(request), ratelimit.RESET_PER_IP)
        ratelimit.check_and_hit('reset-email', email, ratelimit.RESET_PER_EMAIL)
        services.request_password_reset(email)
        return ok(None)  # identical for known and unknown addresses


# ---- A07 ----
class PasswordResetConfirmView(PublicView):
    def post(self, request):
        data = require_object(request.data)
        c = Collector(data)
        c.reject_unknown({'token', 'newPassword'})
        token = c.text('token', max_len=512, strip=False)
        new_password = data.get('newPassword')
        message = passwords.check_length(new_password)
        if message:
            c.add('newPassword', message)
        c.done()
        ratelimit.check_and_hit('reset-confirm-ip', client_ip(request), ratelimit.RESET_CONFIRM_PER_IP)

        def validate(user):
            if passwords.is_weak(new_password, user.email):
                raise WeakPassword(fields={'newPassword': [WeakPassword.default_detail]})

        user = services.confirm_password_reset(token, new_password, validate)
        ratelimit.clear('login', user.email)
        return ok(None)


# ---- step-up ----
class StepUpView(PrivateView):
    def post(self, request):
        c = Collector(require_object(request.data))
        c.reject_unknown({'password'})
        password = c.text('password', max_len=passwords.MAX_LENGTH, strip=False)
        c.done()
        user = request.user
        ratelimit.check('step-up', str(user.pk), ratelimit.STEP_UP_FAILURES_PER_USER)
        try:
            token = services.issue_step_up(user, password)
        except InvalidCredentials:
            ratelimit.hit('step-up', str(user.pk), ratelimit.STEP_UP_FAILURES_PER_USER)
            raise
        ratelimit.clear('step-up', str(user.pk))
        return ok({'accessToken': token})


# ---- A08-A10: Google OAuth, flag-gated stubs ----
def _oauth_gate() -> None:
    if not settings.GOOGLE_AUTH_ENABLED:
        raise NotFound('Google sign-in is not enabled.')
    # The provider round trip (PKCE, state, account linking OQ-12) is a later slice.
    raise NotFound('Google sign-in is not configured.')


class OAuthStartView(PublicView):
    def get(self, request):
        _oauth_gate()


class OAuthExchangeView(PublicView):
    def post(self, request):
        _oauth_gate()


class OAuthCallbackView(PublicView):
    def get(self, request):
        _oauth_gate()


# ---- M13-M16 ----
PROFILE_FIELDS = {'name', 'city', 'area', 'phone', 'birthday', 'chessComHandle', 'fideId'}


class ProfileView(PrivateView):
    def get(self, request):
        return ok(profile_dto(request.user))

    def patch(self, request):
        c = Collector(require_object(request.data))
        c.reject_unknown(PROFILE_FIELDS)  # role, email, ratings, id and the rest are rejected, never dropped
        values = {
            'name': c.text('name', max_len=80, required=False),
            'city': c.text('city', max_len=80, required=False),
            'area': c.text('area', max_len=80, required=False),
            'phone': c.text('phone', max_len=20, min_len=7, required=False, pattern=PHONE_RE),
            'birthday': c.iso_date('birthday'),
            'chess_com_handle': c.text('chessComHandle', max_len=25, min_len=3, required=False, pattern=CHESS_HANDLE_RE),
            'fide_id': c.text('fideId', max_len=12, min_len=3, required=False, pattern=FIDE_ID_RE),
        }
        c.done()
        user = request.user
        changed = []
        for field, value in values.items():
            if present(value):
                setattr(user, field, value)
                changed.append(field)
        if changed:
            user.save(update_fields=[*changed, 'updated_at'])
        return ok(profile_dto(user))


class PublicIdentityView(PrivateView):
    FLAGS = {
        'showDisplayName': 'show_display_name',
        'showRatings': 'show_ratings',
        'showChessComHandle': 'show_chess_com_handle',
        'showCityChapter': 'show_city_chapter',
    }

    def patch(self, request):
        c = Collector(require_object(request.data))
        c.reject_unknown(set(self.FLAGS))  # no key exists for email, phone or birthday: they cannot be made public
        values = {attr: c.boolean(key) for key, attr in self.FLAGS.items()}
        c.done()
        user = request.user
        changed = [attr for attr, value in values.items() if value is not None and value is not MISSING]
        for attr in changed:
            setattr(user, attr, values[attr])
        if changed:
            user.save(update_fields=[*changed, 'updated_at'])
        return ok(profile_dto(user))


class ChangePasswordView(PrivateView):
    """PLAN-012 TASK-205. PATCH /api/me/password — authenticated self-service password change."""

    def patch(self, request):
        data = require_object(request.data)
        c = Collector(data)
        c.reject_unknown({'currentPassword', 'newPassword'})
        current = c.text('currentPassword', max_len=passwords.MAX_LENGTH, strip=False)
        new_pwd = data.get('newPassword')
        message = passwords.check_length(new_pwd)
        if message:
            c.add('newPassword', message)
        c.done()
        ratelimit.check_and_hit(
            'change-password', str(request.user.pk),
            ratelimit.LOGIN_FAILURES_PER_USER if hasattr(ratelimit, 'LOGIN_FAILURES_PER_USER') else ratelimit.LOGIN_PER_IP,
        )

        def validate(user):
            if passwords.is_weak(new_pwd, user.email):
                raise WeakPassword(fields={'newPassword': [WeakPassword.default_detail]})

        try:
            services.change_own_password(request.user, current, new_pwd, validate)
        except InvalidCredentials:
            raise ValidationFailed(fields={'currentPassword': ['Incorrect password.']})
        return ok(None)


class PreferencesView(PrivateView):
    def patch(self, request):
        c = Collector(require_object(request.data))
        c.reject_unknown({'playStyle', 'mood', 'skipped'})
        play_style = c.choice('playStyle', PLAY_STYLES)
        mood = c.choice('mood', MOODS)
        skipped = c.boolean('skipped')
        c.done()
        user = request.user
        if skipped is not True:
            if play_style is not None:
                user.play_style = play_style
            if mood is not None:
                user.mood = mood
        user.onboarding_done = True  # saving or skipping both finish onboarding
        user.save(update_fields=['play_style', 'mood', 'onboarding_done', 'updated_at'])
        return ok(me_dto(user))
