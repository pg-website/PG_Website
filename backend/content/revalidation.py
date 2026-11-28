"""Revalidation outbox and signed callout to the web app (contract 3.10 / 5.6, ARCH-001-isr-revalidation.md).

Writing: call `emit(type, action, entity_id=..., slug=..., version=...)` inside the transaction that changes the entity.
The outbox row commits (or rolls back) with that change; after commit one delivery attempt is made when REVALIDATE_URL
and REVALIDATE_SECRET are set. `emit_media_changed()` fans a media change out to one row per referencing entity.
`notify_publish()` is the older positional spelling used by the signals.

Delivery: `dispatch_pending()` (management command `dispatch_revalidation`, every 30 s from the scheduler) sends due
rows. Rows are claimed with `SELECT ... FOR UPDATE SKIP LOCKED` and leased (`next_attempt_at` pushed forward, attempt
counted) before the HTTP call, so concurrent dispatchers and the on-commit path never send the same row twice. A row
is retried up to MAX_ATTEMPTS with exponential backoff, the same event id and a fresh timestamp and signature.
A 202 is done; 400/413 mark the row failed at once (never retried); exhaustion is logged at ERROR with the marker
`revalidate_exhausted` (alert on it). A queued row is skipped when a newer version of the same entity is already
delivered.

Signature: HMAC-SHA256(key=secret utf-8, msg="{timestamp}.{eventId}.{rawBody}"), header `v1=<hex>`. The body bytes
are serialised once and those exact bytes are sent. No personal data goes in the body (player/result ids are opaque
uuids).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import time
from datetime import timedelta

import requests
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import RevalidationOutbox

logger = logging.getLogger('pg.revalidate')

MAX_ATTEMPTS = 5
TIMEOUT_SECONDS = 3
LEASE_SECONDS = 60
# Delay after failed attempt n (1-based) before attempt n+1: the ladder proposed in ISR doc section 5.
BACKOFF_SECONDS = (2, 5, 15, 45)
DEFAULT_BATCH = 20

TYPES = {'event', 'story', 'testimonial', 'site', 'media', 'legal', 'player', 'result'}
ACTIONS = {'published', 'updated', 'unpublished', 'deleted', 'cancelled', 'completed',
           'privacy_updated', 'emergency_purge'}
COMMON_ACTIONS = {'published', 'updated', 'unpublished', 'deleted'}
ALLOWED_ACTIONS = {
    'event': COMMON_ACTIONS | {'cancelled', 'completed'},
    'story': COMMON_ACTIONS,
    'testimonial': COMMON_ACTIONS,
    'site': COMMON_ACTIONS,
    'media': COMMON_ACTIONS,
    'legal': COMMON_ACTIONS,
    'player': {'deleted', 'privacy_updated', 'emergency_purge'},
    'result': {'deleted'},
}
SLUGGED = {'event', 'story'}
SLUG_RE = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
MAX_SLUG = 100
MAX_ENTITY_ID = 64


def sign(secret: str, timestamp: str, event_id: str, raw_body: bytes) -> str:
    message = timestamp.encode() + b'.' + event_id.encode() + b'.' + raw_body
    return 'v1=' + hmac.new(secret.encode('utf-8'), message, hashlib.sha256).hexdigest()


def _config():
    url = os.environ.get('REVALIDATE_URL', '').strip()
    secret = os.environ.get('REVALIDATE_SECRET', '')
    if not url or not secret:
        return None
    if '://' in url and url.rstrip('/').count('/') <= 2:  # origin only -> default path
        url = url.rstrip('/') + '/api/revalidate'
    return url, secret


def build_body(row: RevalidationOutbox) -> bytes:
    payload = {'type': row.type, 'action': row.action, 'id': row.entity_id}
    if row.slug:
        payload['slug'] = row.slug
    payload['occurredAt'] = timezone.localtime(row.occurred_at).isoformat(timespec='seconds')
    payload['version'] = row.entity_version
    return json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode('utf-8')


# ---------------------------------------------------------------- writing

def emit(type, action, *, entity_id, slug='', version=0):
    """Write one outbox row (call inside the mutating transaction) and schedule a delivery after commit.

    `entity_id`: uuid for event/story/testimonial/media/player/result, the key for site/legal. `slug` is required for
    event and story and ignored for other types. `version` is the entity's monotonic counter after the change
    (for `deleted` and `emergency_purge` pass the incremented value). Raises ValueError for an invalid combination,
    so a programming error fails the mutation instead of silently dropping the notification."""
    if type not in TYPES or action not in ALLOWED_ACTIONS[type]:
        raise ValueError(f'invalid revalidation pair type={type!r} action={action!r}')
    entity_id = str(entity_id or '')
    if not entity_id or len(entity_id) > MAX_ENTITY_ID:
        raise ValueError('revalidation entity_id is required and at most 64 characters')
    slug = str(slug or '') if type in SLUGGED else ''
    if type in SLUGGED and (not slug or len(slug) > MAX_SLUG or not SLUG_RE.match(slug)):
        raise ValueError(f'revalidation slug is required and must match the slug rule for type={type}')
    row = RevalidationOutbox.objects.create(
        type=type, action=action, entity_id=entity_id, slug=slug, entity_version=max(int(version or 0), 0),
    )
    if _config() is not None:
        transaction.on_commit(lambda: _safe_deliver(row.pk))
    return row


def notify_publish(type, action, slug_or_id, *, entity_id=None, version=0):
    """Positional spelling of `emit()`: `slug_or_id` is the slug for events/stories, otherwise the entity key."""
    return emit(type, action, entity_id=entity_id or slug_or_id,
                slug=slug_or_id if type in SLUGGED else '', version=version)


def media_referrers(asset_ids=(), collection_ids=()):
    """Published entities that show the given assets/collections -> list of (type, entity_id, slug, version).
    Imported lazily to avoid a models <-> revalidation import cycle at load time."""
    from .models import Event, MediaCollection, MediaCollectionItem, SiteSection, Story, Testimonial
    asset_ids, collections = set(asset_ids), set(collection_ids)
    if asset_ids:
        collections |= set(MediaCollectionItem.objects.filter(asset_id__in=asset_ids)
                           .values_list('collection_id', flat=True))
    found = []
    ev = Q(media_id__in=collections) | Q(archive_gallery_id__in=collections)
    if asset_ids:
        ev |= Q(cover_id__in=asset_ids)
    for e in Event.objects.filter(ev).exclude(status='draft').only('id', 'slug', 'version'):
        found.append(('event', e.pk, e.slug, e.version))
    if asset_ids:
        for s in Story.objects.filter(cover_id__in=asset_ids, status='published').only('id', 'slug', 'version'):
            found.append(('story', s.pk, s.slug, s.version))
        for t in Testimonial.objects.filter(portrait_id__in=asset_ids, published=True).only('id', 'version'):
            found.append(('testimonial', t.pk, '', t.version))
    if collections:
        keys = set(MediaCollection.objects.filter(pk__in=collections).values_list('key', flat=True))
        if keys:
            for sec in SiteSection.objects.filter(status='published'):
                if _refs_collection(sec.content, keys):
                    found.append(('site', sec.key, '', sec.version))
    return found


def _refs_collection(value, keys) -> bool:
    if isinstance(value, dict):
        if set(value) == {'collection'}:
            return value['collection'] in keys
        return any(_refs_collection(x, keys) for x in value.values())
    if isinstance(value, list):
        return any(_refs_collection(x, keys) for x in value)
    return False


def emit_media_changed(*, asset_ids=(), collection_ids=()):
    """One `updated` row per referencing entity (never a coarse `media` row unless the set cannot be computed).
    Returns the rows written."""
    try:
        referrers = media_referrers(asset_ids, collection_ids)
    except Exception:  # fallback: coarse mapping when the referrer set cannot be computed
        logger.exception('revalidate_media_referrers_failed')
        ids = list(asset_ids) or list(collection_ids)
        return [emit('media', 'updated', entity_id=ids[0])] if ids else []
    return [emit(t, 'updated', entity_id=i, slug=s, version=v) for t, i, s, v in referrers]


# ---------------------------------------------------------------- delivery

def _claim(pk=None, limit=DEFAULT_BATCH):
    """Lock due pending rows (skipping rows another worker holds), lease them and count the attempt."""
    now = timezone.now()
    claimed = []
    with transaction.atomic():
        qs = RevalidationOutbox.objects.select_for_update(skip_locked=True).filter(
            status='pending', next_attempt_at__lte=now)
        if pk is not None:
            qs = qs.filter(pk=pk)
        for row in qs.order_by('id')[:limit]:
            newer = RevalidationOutbox.objects.filter(
                status='delivered', type=row.type, entity_id=row.entity_id, entity_version__gt=row.entity_version,
            ).exists()
            if newer:
                row.status = 'skipped'
                row.save(update_fields=['status'])
                continue
            row.attempts += 1
            row.next_attempt_at = now + timedelta(seconds=LEASE_SECONDS)
            row.save(update_fields=['attempts', 'next_attempt_at'])
            claimed.append(row)
    return claimed


def _safe_deliver(pk):
    try:
        for row in _claim(pk=pk, limit=1):
            deliver(row)
    except Exception as exc:  # delivery must never break the publishing request
        logger.error('revalidate_error exc=%s', type(exc).__name__)


def deliver(row: RevalidationOutbox) -> bool:
    """Send a claimed row (attempt already counted). Updates and saves its state; returns True when delivered."""
    config = _config()
    if config is None:
        return False
    url, secret = config
    body = build_body(row)
    timestamp = str(int(time.time()))
    event_id = str(row.event_id)
    headers = {
        'Content-Type': 'application/json',
        'X-PG-Timestamp': timestamp,
        'X-PG-Event-Id': event_id,
        'X-PG-Signature': sign(secret, timestamp, event_id, body),
    }
    code = None
    try:
        response = requests.post(url, data=body, headers=headers, timeout=TIMEOUT_SECONDS, allow_redirects=False)
        code = response.status_code
    except requests.RequestException as exc:
        logger.warning('revalidate_network_error event_id=%s exc=%s', event_id, type(exc).__name__)
    row.last_status_code = code
    now = timezone.now()
    if code == 202:
        row.status, row.delivered_at = 'delivered', now
    elif code in (400, 413):
        row.status = 'failed'  # the payload itself is rejected: a defect, never retried
        logger.error('revalidate_rejected event_id=%s type=%s status=%s', event_id, row.type, code)
    elif row.attempts >= MAX_ATTEMPTS:
        row.status = 'failed'
        logger.error('revalidate_exhausted event_id=%s type=%s status=%s attempts=%d',
                     event_id, row.type, code, row.attempts)
    else:
        delay = BACKOFF_SECONDS[min(row.attempts, len(BACKOFF_SECONDS)) - 1]
        row.next_attempt_at = now + timedelta(seconds=delay)
        logger.warning('revalidate_retry event_id=%s status=%s attempts=%d', event_id, code, row.attempts)
    row.save(update_fields=['status', 'last_status_code', 'delivered_at', 'next_attempt_at'])
    return row.status == 'delivered'


def dispatch_pending(limit=DEFAULT_BATCH) -> int:
    """Scheduler backstop: claim and deliver due rows in id order. Safe to run concurrently. Returns delivered count."""
    if _config() is None:
        return 0
    return sum(1 for row in _claim(limit=limit) if deliver(row))
