"""Django settings for the PG Chess API.

Secrets and deploy-specific values come from the environment (or backend/.env via python-dotenv). Nothing secret has a
fallback value: a missing SECRET_KEY stops the process unless DEBUG is on (NCT-L5).
"""
import os
import secrets
from datetime import timedelta
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / '.env')


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == '':
        return default
    return raw.strip().lower() in ('1', 'true', 'yes', 'on')


def env_list(name: str, default: str = '') -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(',') if item.strip()]


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, '').strip()
    return int(raw) if raw else default


DEBUG = env_bool('DEBUG', False)

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', '').strip()
if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured('DJANGO_SECRET_KEY must be set (it has no default outside DEBUG).')
    # Development only: a random per-process key. Tokens signed with it stop working when the server restarts.
    SECRET_KEY = secrets.token_urlsafe(64)
elif len(SECRET_KEY) < 32 and not DEBUG:
    raise ImproperlyConfigured('DJANGO_SECRET_KEY is too short (use at least 32 random characters).')

ALLOWED_HOSTS = env_list('ALLOWED_HOSTS', 'localhost,127.0.0.1')

INSTALLED_APPS = [
    'django.contrib.contenttypes',
    'django.contrib.auth',
    'rest_framework',
    'corsheaders',
    'core',
    'content',
    'accounts',
    'audit',
    'adminapi',
    'comms',
    'registrations',
    'ratings',
    'payments',
]

AUTH_USER_MODEL = 'accounts.User'

MIDDLEWARE = [
    'core.middleware.RequestIdMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'pgchess.urls'
WSGI_APPLICATION = 'pgchess.wsgi.application'
APPEND_SLASH = False  # the contract's paths have no trailing slash

# ---- Database ----
# DB_SSLMODE: 'require' for Supabase/hosted Postgres; 'prefer' (default) for local dev.
# Supabase direct connections (port 5432) require SSL; set DB_SSLMODE=require in production.
_db_sslmode = os.environ.get('DB_SSLMODE', '').strip()
_db_options: dict = {'sslmode': _db_sslmode} if _db_sslmode else {}

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ.get('DB_NAME', 'postgres'),
        'USER': os.environ.get('DB_USER', 'postgres'),
        'PASSWORD': os.environ.get('DB_PASSWORD', ''),
        'HOST': os.environ.get('DB_HOST', 'localhost'),
        'PORT': os.environ.get('DB_PORT', '5432'),
        'CONN_MAX_AGE': env_int('DB_CONN_MAX_AGE', 0),
        'OPTIONS': _db_options,
    }
}

# ---- Proxy handling (contract 2.10: client IP only from the trusted proxy chain) ----
# Number of trusted reverse proxies in front of Django (Vercel then Railway = 2 if both append to X-Forwarded-For).
# 0 means "no proxy": the client IP is REMOTE_ADDR and X-Forwarded-* headers are ignored.
TRUSTED_PROXY_COUNT = env_int('TRUSTED_PROXY_COUNT', 0)
if TRUSTED_PROXY_COUNT > 0:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# ---- Security headers (L-14) ----
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'
SECURE_REFERRER_POLICY = 'same-origin'
SECURE_HSTS_SECONDS = 0 if DEBUG else 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_SSL_REDIRECT = env_bool('SECURE_SSL_REDIRECT', False)
DATA_UPLOAD_MAX_MEMORY_SIZE = 256 * 1024  # JSON bodies are small; media goes direct to storage

# ---- REST framework ----
REST_FRAMEWORK = {
    'DEFAULT_RENDERER_CLASSES': ('core.renderers.EnvelopeRenderer',),
    'DEFAULT_PARSER_CLASSES': ('rest_framework.parsers.JSONParser',),
    'EXCEPTION_HANDLER': 'core.exception_handler.api_exception_handler',
    'DEFAULT_PAGINATION_CLASS': 'core.pagination.PagePagination',
    'PAGE_SIZE': 20,
    'DEFAULT_AUTHENTICATION_CLASSES': ('accounts.authentication.BearerAuthentication',),
    # Default deny (contract 6.2): public views must opt in with AllowAny.
    'DEFAULT_PERMISSION_CLASSES': ('rest_framework.permissions.IsAuthenticated',),
    'UNAUTHENTICATED_USER': None,
    'URL_FORMAT_OVERRIDE': None,
}

# ---- Auth and token policy (contract 2.4) ----
AUTH_TOKEN_MODE = os.environ.get('AUTH_TOKEN_MODE', 'body').strip().lower()
if AUTH_TOKEN_MODE not in ('body', 'cookie'):
    raise ImproperlyConfigured("AUTH_TOKEN_MODE must be 'body' or 'cookie'.")
# '__Secure-' cookies need the Secure flag, which browsers refuse over plain http, so the dev default has no prefix.
AUTH_REFRESH_COOKIE_NAME = os.environ.get('AUTH_REFRESH_COOKIE_NAME', 'pg_rt' if DEBUG else '__Secure-pg_rt')
AUTH_REFRESH_COOKIE_PATH = '/api/auth'
AUTH_REFRESH_COOKIE_SECURE = not DEBUG
ACCESS_TOKEN_TTL = timedelta(minutes=env_int('ACCESS_TOKEN_TTL_MINUTES', 10))
STEP_UP_TTL = timedelta(minutes=5)
REFRESH_GRACE = timedelta(seconds=10)
PLAYER_SESSION_LIFETIME = timedelta(days=14)  # absolute
ADMIN_SESSION_LIFETIME = timedelta(hours=12)  # absolute cap
PASSWORD_RESET_TTL = timedelta(hours=1)
SESSION_RETENTION = timedelta(hours=24)  # revoked/expired families kept this long so a late replay still reports why
GOOGLE_AUTH_ENABLED = env_bool('GOOGLE_AUTH_ENABLED', False)
RATING_PROVISIONAL_GAMES = env_int('RATING_PROVISIONAL_GAMES', 10)  # threshold is an open question (OQ-10)

PASSWORD_HASHERS = [
    'django.contrib.auth.hashers.PBKDF2PasswordHasher',
    'django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher',
]

# ---- CORS (contract 2.11): the web app is same-origin through the rewrite; allow-list only for explicit needs ----
CORS_ALLOWED_ORIGINS = env_list('CORS_ALLOWED_ORIGINS', 'http://localhost:3000')
CORS_ALLOW_CREDENTIALS = env_bool('CORS_ALLOW_CREDENTIALS', False)
CORS_URLS_REGEX = r'^/api/.*$'
CORS_ALLOW_HEADERS = [
    'accept', 'authorization', 'content-type', 'idempotency-key', 'x-csrf-token', 'x-request-id',
]
CORS_EXPOSE_HEADERS = ['X-Request-ID', 'Retry-After', 'Idempotent-Replay']

# ---- Email ----
ANYMAIL = {'SENDGRID_API_KEY': os.environ.get('SENDGRID_API_KEY', '')}
EMAIL_BACKEND = os.environ.get(
    'EMAIL_BACKEND',
    'django.core.mail.backends.console.EmailBackend' if DEBUG else 'anymail.backends.sendgrid.EmailBackend',
)
DEFAULT_FROM_EMAIL = "Pawn's Gambit <noreply@pgchess.in>"
# Provider adapter used by comms (message store -> worker -> provider). 'django' sends through EMAIL_BACKEND (SendGrid via
# anymail by default, console in DEBUG); 'fake' keeps messages in memory and is DEBUG only; a dotted path to an
# EmailAdapter subclass plugs in another provider (OQ-05).
EMAIL_ADAPTER = os.environ.get('EMAIL_ADAPTER', '').strip() or 'django'
if EMAIL_ADAPTER == 'fake' and not DEBUG:
    raise ImproperlyConfigured("EMAIL_ADAPTER='fake' is only allowed when DEBUG is on.")
# Where P11 contact submissions are delivered when no admin override is saved. Empty: the public support email.
CONTACT_DESTINATION_EMAIL = os.environ.get('CONTACT_DESTINATION_EMAIL', '').strip()
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:3000' if DEBUG else 'https://pgchess.in').rstrip('/')

# ---- Razorpay (contract 3.3 R04/R05, 5.1) ----
# RAZORPAY_MODE 'live' talks to RAZORPAY_API_BASE; 'fake' is an in-database stand-in for local development only.
# The default is 'fake' when DEBUG and 'live' otherwise; 'fake' with DEBUG off stops the process.
RAZORPAY_MODE = os.environ.get('RAZORPAY_MODE', '').strip().lower() or ('fake' if DEBUG else 'live')
if RAZORPAY_MODE not in ('live', 'fake'):
    raise ImproperlyConfigured("RAZORPAY_MODE must be 'live' or 'fake'.")
if RAZORPAY_MODE == 'fake' and not DEBUG:
    raise ImproperlyConfigured("RAZORPAY_MODE='fake' is only allowed when DEBUG is on.")
RAZORPAY_KEY_ID = os.environ.get('RAZORPAY_KEY_ID', '').strip()
RAZORPAY_KEY_SECRET = os.environ.get('RAZORPAY_KEY_SECRET', '').strip()
RAZORPAY_WEBHOOK_SECRET = os.environ.get('RAZORPAY_WEBHOOK_SECRET', '').strip()
RAZORPAY_API_BASE = (os.environ.get('RAZORPAY_API_BASE', '').strip() or 'https://api.razorpay.com/v1').rstrip('/')
if RAZORPAY_MODE == 'live':
    _missing = [n for n, v in (('RAZORPAY_KEY_ID', RAZORPAY_KEY_ID), ('RAZORPAY_KEY_SECRET', RAZORPAY_KEY_SECRET),
                               ('RAZORPAY_WEBHOOK_SECRET', RAZORPAY_WEBHOOK_SECRET)) if not v]
    if _missing:
        raise ImproperlyConfigured('RAZORPAY_MODE=live needs: ' + ', '.join(_missing))
else:  # fake: obvious placeholders so the local flow works with an empty .env
    RAZORPAY_KEY_ID = RAZORPAY_KEY_ID or 'rzp_test_PLACEHOLDER'
    RAZORPAY_KEY_SECRET = RAZORPAY_KEY_SECRET or 'placeholder-key-secret'
    RAZORPAY_WEBHOOK_SECRET = RAZORPAY_WEBHOOK_SECRET or 'placeholder-webhook-secret'
RAZORPAY_CONNECT_TIMEOUT = 3.05

# ---- Draft preview (PV01, POST /api/preview/exchange) ----
# Shared secret the web server sends as `Authorization: Bearer`. Unset = exchange always answers 401 (preview off).
PREVIEW_SECRET = os.environ.get('PREVIEW_SECRET', '').strip()
if not DEBUG and (PREVIEW_SECRET.startswith('placeholder') or len(PREVIEW_SECRET) < 32):
    PREVIEW_SECRET = ''  # a placeholder or short secret never enables preview outside development
RAZORPAY_READ_TIMEOUT = 10

# ---- Media storage (contract 3.7 S07-S12) ----
# STORAGE_MODE 'supabase' issues signed upload URLs against the Supabase Storage bucket (public for reads, writes only
# through these URLs); 'fake' is a local-disk stand-in for development only (DEBUG). Default: fake when DEBUG.
# SUPABASE_SECRET_KEY is backend-only and never returned, logged or sent to the web app.
STORAGE_MODE = os.environ.get('STORAGE_MODE', '').strip().lower() or ('fake' if DEBUG else 'supabase')
if STORAGE_MODE not in ('supabase', 'fake'):
    raise ImproperlyConfigured("STORAGE_MODE must be 'supabase' or 'fake'.")
if STORAGE_MODE == 'fake' and not DEBUG:
    raise ImproperlyConfigured("STORAGE_MODE='fake' is only allowed when DEBUG is on.")
SUPABASE_URL = os.environ.get('SUPABASE_URL', '').strip().rstrip('/')
SUPABASE_SECRET_KEY = os.environ.get('SUPABASE_SECRET_KEY', '').strip()
SUPABASE_MEDIA_BUCKET = os.environ.get('SUPABASE_MEDIA_BUCKET', '').strip() or 'pg-media'
if STORAGE_MODE == 'supabase':
    _missing = [n for n, v in (('SUPABASE_URL', SUPABASE_URL), ('SUPABASE_SECRET_KEY', SUPABASE_SECRET_KEY)) if not v]
    if _missing:
        raise ImproperlyConfigured('STORAGE_MODE=supabase needs: ' + ', '.join(_missing))
    if not SUPABASE_URL.startswith('https://'):
        raise ImproperlyConfigured('SUPABASE_URL must be an https URL.')
MEDIA_MAX_BYTES = 10 * 1024 * 1024
MEDIA_UPLOAD_TTL_SECONDS = 2 * 60 * 60  # Supabase signed upload URLs are valid for two hours
FAKE_STORAGE_ROOT = BASE_DIR / '.fake_storage'
# Public origin of this API as the browser reaches it, used to make the fake-storage upload URL absolute (the web
# requires an absolute URL). Empty: built from the request host (validated by ALLOWED_HOSTS).
BACKEND_PUBLIC_URL = os.environ.get('BACKEND_PUBLIC_URL', '').strip().rstrip('/')
if BACKEND_PUBLIC_URL and not BACKEND_PUBLIC_URL.startswith(('http://', 'https://')):
    raise ImproperlyConfigured('BACKEND_PUBLIC_URL must start with http:// or https://.')

# ---- Locale and time ----
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Kolkata'
USE_I18N = False
USE_TZ = True

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ---- Logging: structured key=value lines, never bodies, tokens, passwords or emails (contract 6.6) ----
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {'plain': {'format': '%(asctime)s %(levelname)s %(name)s %(message)s'}},
    'handlers': {'console': {'class': 'logging.StreamHandler', 'formatter': 'plain'}},
    'loggers': {
        'pg': {'handlers': ['console'], 'level': 'INFO', 'propagate': False},
        'django.request': {'handlers': ['console'], 'level': 'ERROR', 'propagate': False},
    },
}
