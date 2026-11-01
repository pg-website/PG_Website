"""Admin media: signed uploads, asset and collection records (contract 3.7 S07-S12).

Flow: S07 `issue_upload` validates type and size and returns a signed upload URL (the server never sees the bytes);
S08 `complete_upload` reads the object back, checks the magic bytes, reads dimensions, re-encodes the image (which drops
EXIF/GPS and every other metadata block except the ICC profile) and only then creates the MediaAsset. Network calls to
storage never run inside a transaction. Every mutation is one `transaction.atomic()` holding the row lock, the change
and the strict audit row; revalidation rows come from content.signals (one `updated` row per referencing entity via
`revalidation.emit_media_changed`, written in the same transaction).
"""
from __future__ import annotations

import io
import logging
import re
import secrets
import unicodedata
import uuid
import warnings

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError, Q
from django.utils import timezone
from PIL import Image, ImageOps, UnidentifiedImageError

import audit
from content import validation as v
from content.models import (Event, MediaAsset, MediaCollection, MediaCollectionItem, MediaUpload, SiteSection, Story,
                            Testimonial)
from content.storage import ObjectMissing, ObjectTooLarge, StorageError, get_storage, new_object_key
from core.errors import AssetInUse, NotFound, NotPublishable, RateLimited, StorageUnavailable, ValidationFailed, VersionConflict
from core.responses import iso

logger = logging.getLogger('pg.adminapi')

ALLOWED_TYPES = {
    'image/jpeg': {'ext': 'jpg', 'format': 'JPEG', 'names': {'jpg', 'jpeg'}},
    'image/png': {'ext': 'png', 'format': 'PNG', 'names': {'png'}},
    'image/webp': {'ext': 'webp', 'format': 'WEBP', 'names': {'webp'}},
    'image/avif': {'ext': 'avif', 'format': 'AVIF', 'names': {'avif'}},
}
MAX_DIMENSION = 20000
MAX_PIXELS = 60_000_000
MAX_PENDING_UPLOADS = 50
MAX_COLLECTION_ITEMS = 50
DEFAULT_INTERVAL_MS = 5000
MAX_USED_BY = 20
_CONTROL = re.compile(r'[\x00-\x1f\x7f-\x9f/\\]')


# ---------------------------------------------------------------- parsing helpers

def object_body(request) -> dict:
    if not isinstance(request.data, dict):
        raise ValidationFailed(fields={'form': ['Send a JSON object.']})
    return request.data


def _unknown(data: dict, allowed: set) -> None:
    extra = sorted(set(data) - allowed)
    if extra:
        raise ValidationFailed(fields={k: ['This field is not accepted.'] for k in extra[:10]})


def _is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _text(errors, field, value, max_len, *, min_len=0):
    if not isinstance(value, str):
        errors[field] = ['Enter text.']
        return None
    value = unicodedata.normalize('NFC', value).strip()
    if any(ord(c) < 0x20 or 0x7F <= ord(c) <= 0x9F for c in value):
        errors[field] = ['Remove control characters.']
        return None
    if len(value) < min_len or len(value) > max_len:
        errors[field] = [f'Use {min_len} to {max_len} characters.' if min_len else f'Use at most {max_len} characters.']
        return None
    return value


def _version(errors, data):
    if 'version' not in data:
        return None
    if not _is_int(data['version']) or data['version'] < 0:
        errors['version'] = ['Send the version last read.']
        return None
    return data['version']


def parse_asset_id(value) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError:
        raise NotFound('Media asset not found.') from None


def parse_collection_id(value) -> int | None:
    """Collection ids are the table's integer primary key, sent as a decimal string."""
    if isinstance(value, int) and not isinstance(value, bool):
        value = str(value)
    if isinstance(value, str) and value.isascii() and value.isdigit() and len(value) <= 18 and int(value) > 0:
        return int(value)
    return None


# ---------------------------------------------------------------- DTOs and usage

NIL_ACTOR = {'id': '00000000-0000-0000-0000-000000000000', 'name': 'System'}


def actor_dto(user) -> dict:
    if user is None:
        return dict(NIL_ACTOR)
    return {'id': str(user.pk), 'name': getattr(user, 'name', '') or 'Admin'}


def asset_summary_dto(asset: MediaAsset) -> dict:
    """Web `mediaAssetSummarySchema`: the short row used inside a collection."""
    return {'id': str(asset.pk), 'src': asset.src, 'width': asset.width, 'height': asset.height,
            'alt': '' if asset.decorative else (asset.alt or None), 'decorative': asset.decorative,
            'focal': {'x': asset.focal_x, 'y': asset.focal_y}}


_SRC_TYPES = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp',
              'avif': 'image/avif'}


def _content_type(asset: MediaAsset) -> str:
    """Stored type when it is one the web accepts; seeded or legacy rows without one are read from the src extension."""
    if asset.content_type in _SRC_TYPES.values():
        return asset.content_type
    return _SRC_TYPES.get(asset.src.rsplit('.', 1)[-1].lower(), 'image/jpeg')


def asset_dto(asset: MediaAsset, used_by=None, published=False) -> dict:
    """Web `mediaAssetSchema`. `used_by` is the full usage list (usageCount is uncapped, usedBy is capped).
    status: archived if archived, else published when referenced by any published entity, else draft."""
    used_by = used_by or []
    status = 'archived' if asset.archived else ('published' if published else 'draft')
    return {
        'id': str(asset.pk), 'src': asset.src, 'width': asset.width, 'height': asset.height,
        'alt': '' if asset.decorative else (asset.alt or None),
        'decorative': asset.decorative, 'focal': {'x': asset.focal_x, 'y': asset.focal_y}, 'credit': asset.credit or None,
        'status': status, 'archivedAt': iso(asset.archived_at), 'missingAlt': not (asset.decorative or asset.alt),
        'contentType': _content_type(asset), 'sizeBytes': max(1, asset.size_bytes or 0),
        'filename': asset.original_filename,
        'usageCount': len(used_by), 'usedBy': [dict(u) for u in used_by[:MAX_USED_BY]],
        'uploadedBy': actor_dto(asset.uploaded_by), 'uploadedAt': iso(asset.created_at),
        'version': asset.version, 'updatedAt': iso(asset.updated_at),
    }


def asset_dtos(assets) -> list:
    """DTOs for a batch of assets with a fixed number of queries."""
    assets = list(assets)
    used = usages([a.pk for a in assets])
    live = published_asset_ids()
    return [asset_dto(a, used[a.pk], a.pk in live) for a in assets]


def published_asset_ids() -> set:
    """Assets referenced by any published entity: published/non-draft events, published stories and testimonials,
    and collections shown by those events or by a published site section."""
    ids, cols = set(), set()
    for cover, media, gallery in Event.objects.exclude(status='draft').values_list('cover_id', 'media_id',
                                                                                    'archive_gallery_id'):
        ids.add(cover)
        cols.update((media, gallery))
    ids.update(Story.objects.filter(status='published').values_list('cover_id', flat=True))
    cols.update(Story.objects.filter(status='published').values_list('collection_id', flat=True))
    ids.update(Testimonial.objects.filter(published=True).values_list('portrait_id', flat=True))
    keys = set()
    for content in SiteSection.objects.filter(status='published').values_list('content', flat=True):
        keys.update(v.collect_collection_refs(content))
    if keys:
        cols.update(MediaCollection.objects.filter(key__in=keys).values_list('pk', flat=True))
    cols.discard(None)
    if cols:
        ids.update(MediaCollectionItem.objects.filter(collection_id__in=cols).values_list('asset_id', flat=True))
    ids.discard(None)
    return ids


def usages(asset_ids) -> dict:
    """asset id -> [{kind, id, label, field}] for events, stories, testimonials and site sections that
    show it (uncapped, de-duplicated). Batched: a fixed number of queries per call, whatever the page size."""
    ids = list(asset_ids)
    out = {i: [] for i in ids}
    if not ids:
        return out

    def add(asset_id, entry):
        bucket = out.setdefault(asset_id, [])
        if entry not in bucket:
            bucket.append(entry)

    items = list(MediaCollectionItem.objects.filter(asset_id__in=ids).select_related('collection')
                 .only('asset_id', 'collection__id', 'collection__key', 'collection__name'))
    by_collection = {}
    for item in items:
        c = item.collection
        # Private galleries are not a user-facing kind (PLAN-010): only the owning entity is reported below.
        by_collection.setdefault(c.pk, []).append(item.asset_id)
    for e in Event.objects.filter(cover_id__in=ids).only('id', 'title', 'cover_id'):
        add(e.cover_id, {'kind': 'event', 'id': str(e.pk), 'label': e.title, 'field': 'cover'})
    for s in Story.objects.filter(cover_id__in=ids).only('id', 'title', 'cover_id'):
        add(s.cover_id, {'kind': 'story', 'id': str(s.pk), 'label': s.title, 'field': 'cover'})
    for t in Testimonial.objects.filter(portrait_id__in=ids).only('id', 'name', 'portrait_id'):
        add(t.portrait_id, {'kind': 'testimonial', 'id': str(t.pk), 'label': t.name, 'field': 'portrait'})
    if by_collection:
        cols = list(by_collection)
        for e in Event.objects.filter(Q(media_id__in=cols) | Q(archive_gallery_id__in=cols)).only(
                'id', 'title', 'media_id', 'archive_gallery_id'):
            for cid, field in ((e.media_id, 'media'), (e.archive_gallery_id, 'archiveGallery')):
                for asset_id in by_collection.get(cid, ()):
                    add(asset_id, {'kind': 'event', 'id': str(e.pk), 'label': e.title, 'field': field})
        for st in Story.objects.filter(collection_id__in=cols).only('id', 'title', 'collection_id'):
            for asset_id in by_collection.get(st.collection_id, ()):
                add(asset_id, {'kind': 'story', 'id': str(st.pk), 'label': st.title, 'field': 'media'})
        keys = {c.key: c.pk for c in MediaCollection.objects.filter(pk__in=cols).only('id', 'key')}
        for section in SiteSection.objects.filter(status='published'):
            for key in set(v.collect_collection_refs(section.content)):
                for asset_id in by_collection.get(keys.get(key), ()):
                    add(asset_id, {'kind': 'site_section', 'id': section.key, 'label': section.key, 'field': 'content'})
    return out


def is_referenced(asset_id) -> bool:
    return (MediaCollectionItem.objects.filter(asset_id=asset_id).exists()
            or Event.objects.filter(cover_id=asset_id).exists()
            or Story.objects.filter(cover_id=asset_id).exists()
            or Testimonial.objects.filter(portrait_id=asset_id).exists())


# ---------------------------------------------------------------- S07

def issue_upload(request, data: dict) -> dict:
    _unknown(data, {'filename', 'contentType', 'sizeBytes'})
    errors = {}
    filename = _text(errors, 'filename', data.get('filename', ''), 200, min_len=1) if 'filename' in data else None
    if 'filename' not in data:
        errors['filename'] = ['This is required.']
    spec = None
    ctype = data.get('contentType')
    if not isinstance(ctype, str):
        errors['contentType'] = ['This is required.']
    else:
        spec = ALLOWED_TYPES.get(ctype.strip().lower())
        if spec is None:
            errors['contentType'] = ['Use a JPEG, PNG, WebP or AVIF image.']
    size = data.get('sizeBytes')
    if not _is_int(size) or size < 1:
        errors['sizeBytes'] = ['Send the file size in bytes.']
    elif size > settings.MEDIA_MAX_BYTES:
        errors['sizeBytes'] = [f'The file is larger than {settings.MEDIA_MAX_BYTES // (1024 * 1024)} MB.']
    if filename and spec is not None and '.' in filename:
        if filename.rsplit('.', 1)[1].lower() not in spec['names']:
            errors['filename'] = ['The file extension does not match the content type.']
    if errors:
        raise ValidationFailed(fields=errors)
    ctype = ctype.strip().lower()
    filename = _CONTROL.sub('_', filename)

    now = timezone.now()
    mine = MediaUpload.objects.filter(created_by=request.user)
    for stale in list(mine.filter(expires_at__lt=now)[:20]):  # abandoned uploads: drop the row and any leftover object
        try:
            get_storage().delete(stale.storage_key)
        except StorageError:
            pass
        stale.delete()
    if mine.count() >= MAX_PENDING_UPLOADS:
        raise RateLimited(60)

    storage = get_storage()
    key = new_object_key(spec['ext'])
    try:
        ticket = storage.create_upload(key, ctype)
    except StorageError:
        raise StorageUnavailable() from None
    upload = MediaUpload.objects.create(storage_key=key, original_filename=filename, content_type=ctype,
                                        size_bytes=size, created_by=request.user, expires_at=ticket.expires_at)
    upload_url = ticket.url
    if upload_url.startswith('/'):  # fake storage: the web needs an absolute URL
        base = settings.BACKEND_PUBLIC_URL or request.build_absolute_uri('/').rstrip('/')
        upload_url = base + upload_url
    return {'assetId': str(upload.pk), 'uploadUrl': upload_url, 'method': ticket.method, 'headers': ticket.headers,
            'expiresAt': iso(ticket.expires_at), 'maxBytes': settings.MEDIA_MAX_BYTES}


# ---------------------------------------------------------------- S08

class ImageRejected(Exception):
    pass


def process_image(data: bytes, content_type: str):
    """Verify magic bytes against the declared type, read dimensions and re-encode without metadata.
    Returns (clean_bytes, width, height). Raises ImageRejected with a user-safe message."""
    spec = ALLOWED_TYPES[content_type]
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            img = Image.open(io.BytesIO(data), formats=[spec['format']])
            if img.format != spec['format']:
                raise ImageRejected('The file content does not match its type.')
            if getattr(img, 'is_animated', False) and getattr(img, 'n_frames', 1) > 1:
                raise ImageRejected('Animated images are not supported.')
            width, height = img.size
            if not (1 <= width <= MAX_DIMENSION and 1 <= height <= MAX_DIMENSION) or width * height > MAX_PIXELS:
                raise ImageRejected('The image dimensions are too large.')
            img.load()
            icc = img.info.get('icc_profile')
            img = ImageOps.exif_transpose(img)  # bake the orientation in before the EXIF block is dropped
            width, height = img.size
            out = io.BytesIO()
            kwargs = {'icc_profile': icc} if icc else {}
            if spec['format'] == 'JPEG':
                if img.mode not in ('RGB', 'L', 'CMYK'):
                    img = img.convert('RGB')
                img.save(out, 'JPEG', quality=90, optimize=True, **kwargs)
            elif spec['format'] == 'PNG':
                img.save(out, 'PNG', optimize=True, **kwargs)
            else:
                if img.mode not in ('RGB', 'RGBA'):
                    img = img.convert('RGBA' if 'A' in img.getbands() or 'transparency' in img.info else 'RGB')
                img.save(out, spec['format'], quality=90, **({'method': 4} if spec['format'] == 'WEBP' else {}),
                         **kwargs)
    except ImageRejected:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, MemoryError, EOFError,
            Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ImageRejected('The file is not a valid image.') from None
    return out.getvalue(), width, height


def _discard(upload: MediaUpload, storage) -> None:
    try:
        storage.delete(upload.storage_key)
    except StorageError:
        logger.warning('media_discard_failed upload=%s', upload.pk)
    upload.delete()


def complete_upload(request, asset_id):
    """Returns (asset, created). Safe to call again: a completed upload returns its asset."""
    pk = parse_asset_id(asset_id)
    existing = MediaAsset.objects.filter(pk=pk).first()
    if existing is not None:
        return existing, False
    upload = MediaUpload.objects.filter(pk=pk).first()
    if upload is None:
        raise NotFound('Upload not found.')
    storage = get_storage()
    if upload.expires_at < timezone.now():
        _discard(upload, storage)
        raise ValidationFailed(fields={'assetId': ['This upload expired. Start the upload again.']})

    try:
        raw = storage.read(upload.storage_key, settings.MEDIA_MAX_BYTES)
    except ObjectMissing:
        raise ValidationFailed(fields={'file': ['The file has not been uploaded yet.']}) from None
    except ObjectTooLarge:
        _discard(upload, storage)
        raise ValidationFailed(fields={'file': ['The file is too large.']}) from None
    except StorageError:
        raise StorageUnavailable() from None
    try:
        clean, width, height = process_image(raw, upload.content_type)
    except ImageRejected as exc:
        _discard(upload, storage)
        raise ValidationFailed(fields={'file': [str(exc)]}) from None
    try:
        storage.write(upload.storage_key, clean, upload.content_type)
    except StorageError:
        raise StorageUnavailable() from None

    try:
        with transaction.atomic():
            locked = MediaUpload.objects.select_for_update().filter(pk=pk).first()
            if locked is None:  # a concurrent completion won
                return MediaAsset.objects.get(pk=pk), False
            asset = MediaAsset(
                id=pk, src=storage.public_url(upload.storage_key), width=width, height=height, alt='',
                storage_key=upload.storage_key, content_type=upload.content_type, size_bytes=len(clean),
                original_filename=upload.original_filename, uploaded_by=upload.created_by)
            try:
                asset.save()
            except DjangoValidationError as exc:
                raise ValidationFailed(fields={'file': [str(m) for m in sum(exc.message_dict.values(), [])][:3]}) from None
            locked.delete()
            audit.write(request, action='media.create', object_type='media_asset', object_id=asset.pk,
                        after={'width': width, 'height': height, 'contentType': asset.content_type,
                               'sizeBytes': asset.size_bytes})
    except MediaUpload.DoesNotExist:
        return MediaAsset.objects.get(pk=pk), False
    return asset, True


# ---------------------------------------------------------------- S09

def list_assets(params):
    errors = {}
    status = params.get('status', 'active')
    if status not in ('active', 'archived', 'all', 'draft', 'published'):
        errors['status'] = ['Choose active, archived, all, draft or published.']
    missing = params.get('missingAlt')
    if missing is not None and missing not in ('true', 'false'):
        errors['missingAlt'] = ['Use true or false.']
    q = (params.get('q') or '').strip()
    if len(q) > 100:
        errors['q'] = ['Use at most 100 characters.']
    if errors:
        raise ValidationFailed(fields=errors)
    qs = MediaAsset.objects.all()
    if status == 'active':
        qs = qs.filter(archived=False)
    elif status == 'archived':
        qs = qs.filter(archived=True)
    elif status == 'published':
        qs = qs.filter(archived=False, pk__in=published_asset_ids())
    elif status == 'draft':
        qs = qs.filter(archived=False).exclude(pk__in=published_asset_ids())
    if missing == 'true':
        qs = qs.filter(decorative=False, alt='')
    elif missing == 'false':
        qs = qs.exclude(decorative=False, alt='')
    if q:
        qs = qs.filter(Q(alt__icontains=q) | Q(credit__icontains=q) | Q(original_filename__icontains=q))
    return qs.order_by('-created_at', 'id')


def get_asset(asset_id) -> MediaAsset:
    asset = MediaAsset.objects.filter(pk=parse_asset_id(asset_id)).first()
    if asset is None:
        raise NotFound('Media asset not found.')
    return asset


# ---------------------------------------------------------------- S10

def parse_asset_patch(data: dict):
    _unknown(data, {'version', 'alt', 'decorative', 'focal', 'focalX', 'focalY', 'credit', 'archived', 'status'})
    errors, out = {}, {}
    version = _version(errors, data)
    if 'alt' in data:
        out['alt'] = _text(errors, 'alt', data['alt'], 300)
    if 'credit' in data:  # web: draftText(200).nullable(): null clears the credit
        out['credit'] = '' if data['credit'] is None else _text(errors, 'credit', data['credit'], 200)
    for field in ('decorative', 'archived'):
        if field in data:
            if not isinstance(data[field], bool):
                errors[field] = ['Send true or false.']
            else:
                out[field] = data[field]
    if 'focal' in data:
        focal = data['focal']
        if not isinstance(focal, dict) or set(focal) != {'x', 'y'}:
            errors['focal'] = ['Send {"x": 0..1, "y": 0..1}.']
        else:
            for axis, attr in (('x', 'focal_x'), ('y', 'focal_y')):
                value = focal[axis]
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 1:
                    errors[f'focal.{axis}'] = ['Use a number from 0 to 1.']
                else:
                    out[attr] = float(value)
    if 'status' in data:
        if data['status'] not in ('draft', 'published', 'archived'):
            errors['status'] = ['Choose draft, published or archived.']
        else:
            out['archived'] = data['status'] == 'archived'  # draft/published are derived from usage: they only unarchive
            if data['status'] == 'published':
                out['_require_alt'] = True
    for field, attr in (('focalX', 'focal_x'), ('focalY', 'focal_y')):
        if field in data:
            value = data[field]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 1:
                errors[field] = ['Use a number from 0 to 1.']
            else:
                out[attr] = float(value)
    if not errors and not out:
        errors['form'] = ['Send at least one field to change.']
    if errors:
        raise ValidationFailed(fields=errors)
    return version, out


def update_asset(request, asset_id, version, changes: dict):
    pk = parse_asset_id(asset_id)
    with transaction.atomic():
        asset = MediaAsset.objects.select_for_update().filter(pk=pk).first()
        if asset is None:
            raise NotFound('Media asset not found.')
        if version is not None and version != asset.version:
            raise VersionConflict()
        before, after = {}, {}
        changes = dict(changes)
        if changes.pop('_require_alt', False):
            alt_set = changes.get('alt', asset.alt)
            deco = changes.get('decorative', asset.decorative)
            if not (alt_set or deco):
                raise NotPublishable(blockers=[{'code': 'ALT_MISSING', 'reason': 'Add alt text or mark the image decorative.',
                                                'field': 'alt'}], fields={'alt': ['Add alt text or mark the image decorative.']})
        for attr, value in changes.items():
            if attr == 'archived':
                if value != asset.archived:
                    before[attr], after[attr] = asset.archived, value
                    asset.archived = value
                    asset.archived_at = timezone.now() if value else None
                continue
            if getattr(asset, attr) != value:
                before[attr], after[attr] = getattr(asset, attr), value
                setattr(asset, attr, value)
        if after:
            try:
                asset.save()  # content.signals writes one revalidation row per referencing entity
            except DjangoValidationError as exc:
                raise ValidationFailed(fields={'form': [str(m) for m in sum(exc.message_dict.values(), [])][:3]}) from None
            action = 'media.archive' if after.get('archived') is True else (
                'media.unarchive' if after.get('archived') is False else 'media.update')
            audit.write(request, action=action, object_type='media_asset', object_id=asset.pk, before=before, after=after)
    warnings_out = [] if (asset.decorative or asset.alt) else [{'code': 'ALT_MISSING', 'field': 'alt',
                                                                 'message': 'Add alt text or mark the image decorative.'}]
    return asset, warnings_out


# ---------------------------------------------------------------- S11

def delete_asset(request, asset_id) -> None:
    pk = parse_asset_id(asset_id)
    try:
        with transaction.atomic():
            asset = MediaAsset.objects.select_for_update().filter(pk=pk).first()
            if asset is None:
                raise NotFound('Media asset not found.')
            if is_referenced(pk):
                raise AssetInUse('This asset is in use. Archive it instead.')
            key = asset.storage_key
            snapshot = {'src': asset.src, 'contentType': asset.content_type, 'archived': asset.archived}
            asset.delete()
            audit.write(request, action='media.delete', object_type='media_asset', object_id=pk, before=snapshot)
            if key:
                transaction.on_commit(lambda: _delete_object(key))
    except ProtectedError:
        raise AssetInUse('This asset is in use. Archive it instead.') from None


def _delete_object(key: str) -> None:
    try:
        get_storage().delete(key)
    except StorageError:
        logger.warning('media_object_delete_failed')  # orphaned object only; the record is already gone


# ---------------------------------------------------------------- private galleries (PLAN-010)
#
# An event, story, event archive or site section shows an ordered list of assets. Internally that list lives in a
# MediaCollection owned by exactly one owner (owner_kind/owner_ref). It is never shown, named or shared in the admin.
# The mode is derived: one asset is static, two or more is a carousel.

GALLERY_INPUT_KEYS = {'assetIds', 'autoplay', 'intervalMs'}
GALLERY_ECHO_KEYS = {'mode', 'items', 'assets'}  # read-only keys a client may send back unchanged; ignored


def derive_mode(count: int) -> str:
    return 'carousel' if count >= 2 else 'static'


def parse_asset_ids(raw, path):
    """-> (ids or None, errors)."""
    if not isinstance(raw, list) or len(raw) > MAX_COLLECTION_ITEMS:
        return None, {path: [f'Send a list of at most {MAX_COLLECTION_ITEMS} asset ids.']}
    ids = []
    for n, item in enumerate(raw):
        try:
            if not isinstance(item, str):
                raise ValueError
            ids.append(uuid.UUID(item))
        except ValueError:
            return None, {f'{path}.{n}': ['Use a valid asset id.']}
    if len(set(ids)) != len(ids):
        return None, {path: ['Each asset can appear once.']}
    return ids, {}


def parse_gallery(raw: dict, path: str):
    """Parse `{assetIds?, autoplay?, intervalMs?}` -> (out, errors). out keys: asset_ids, autoplay, interval_ms."""
    out, errors = {}, {}
    if 'assetIds' in raw:
        ids, errs = parse_asset_ids(raw['assetIds'], f'{path}.assetIds')
        errors.update(errs)
        if ids is not None:
            out['asset_ids'] = ids
    if 'autoplay' in raw:
        if not isinstance(raw['autoplay'], bool):
            errors[f'{path}.autoplay'] = ['Send true or false.']
        else:
            out['autoplay'] = raw['autoplay']
    if 'intervalMs' in raw:
        if not _is_int(raw['intervalMs']) or not 2000 <= raw['intervalMs'] <= 60000:
            errors[f'{path}.intervalMs'] = ['Use 2000 to 60000 milliseconds.']
        else:
            out['interval_ms'] = raw['intervalMs']
    return out, errors


def check_assets(ids, current_ids, path: str) -> None:
    """Every asset must exist; an archived asset can stay in a list but cannot be newly added."""
    if not ids:
        return
    found = {a.pk: a for a in MediaAsset.objects.filter(pk__in=ids).only('id', 'archived')}
    errors = {}
    for n, i in enumerate(ids):
        asset = found.get(i)
        if asset is None:
            errors[f'{path}.{n}'] = ['This asset does not exist.']
        elif asset.archived and i not in current_ids:
            errors[f'{path}.{n}'] = ['Archived assets cannot be added.']
        if len(errors) >= 10:
            break
    if errors:
        raise ValidationFailed(fields=errors)


def gallery_asset_ids(collection) -> list:
    if collection is None:
        return []
    return list(MediaCollectionItem.objects.filter(collection=collection).order_by('order', 'id')
                .values_list('asset_id', flat=True))


def gallery_dto(collection) -> dict:
    """Admin read of a private gallery: ordered ids, asset summaries and the derived mode."""
    if collection is None:
        return {'assetIds': [], 'assets': [], 'mode': 'static', 'autoplay': False, 'intervalMs': DEFAULT_INTERVAL_MS}
    if 'items' in getattr(collection, '_prefetched_objects_cache', {}):
        assets = [i.asset for i in collection.items.all()]
    else:
        assets = [i.asset for i in collection.items.select_related('asset')]
    return {'assetIds': [str(a.pk) for a in assets], 'assets': [asset_summary_dto(a) for a in assets],
            'mode': derive_mode(len(assets)), 'autoplay': collection.autoplay, 'intervalMs': collection.interval_ms}


def missing_alt_in(collection_ids) -> bool:
    """True when any image in these galleries has no alt text and is not marked decorative (publish blocker)."""
    ids = list(collection_ids)
    return bool(ids) and MediaCollectionItem.objects.filter(
        collection_id__in=ids, asset__decorative=False, asset__alt='').exists()


def _replace_items(collection: MediaCollection, ids) -> None:
    # Raw delete + bulk_create bypass the per-row signals: the revalidation burst comes from the collection save.
    MediaCollectionItem.objects.filter(collection=collection)._raw_delete(using=MediaCollectionItem.objects.db)
    try:
        MediaCollectionItem.objects.bulk_create(
            [MediaCollectionItem(collection=collection, asset_id=i, order=n) for n, i in enumerate(ids)])
    except IntegrityError:
        raise ValidationFailed(fields={'media.assetIds': ['One of the assets no longer exists.']}) from None


def _private_key(owner_kind: str) -> str:
    base = owner_kind.replace('_', '-')
    while True:
        key = f'{base}-{secrets.token_hex(6)}'
        if not MediaCollection.objects.filter(key=key).exists():
            return key


def create_gallery(owner_kind: str, owner_ref: str, ids, autoplay=False, interval_ms=DEFAULT_INTERVAL_MS,
                   path='media.assetIds') -> MediaCollection:
    check_assets(ids, set(), path)
    collection = MediaCollection(key=_private_key(owner_kind), name='', mode=derive_mode(len(ids)),
                                 autoplay=autoplay, interval_ms=interval_ms, owner_kind=owner_kind,
                                 owner_ref=str(owner_ref))
    try:
        collection.save()
    except DjangoValidationError as exc:
        raise ValidationFailed(fields={'form': [str(m) for m in sum(exc.message_dict.values(), [])][:3]}) from None
    _replace_items(collection, ids)
    return collection


def set_gallery(owner_kind: str, owner_ref, current, parsed: dict, path='media.assetIds') -> MediaCollection:
    """Create or update the owner's private gallery from parsed `{asset_ids?, autoplay?, interval_ms?}`.
    `current` is the owner's gallery or None. Call inside the owner's transaction, owner row locked. The collection
    save bumps its version and emits one revalidation row per referencing published entity (content.signals)."""
    ids = parsed.get('asset_ids')
    if current is None:
        return create_gallery(owner_kind, owner_ref, ids or [], parsed.get('autoplay', False),
                              parsed.get('interval_ms', DEFAULT_INTERVAL_MS), path)
    cur_ids = gallery_asset_ids(current)
    changed = False
    if ids is not None and ids != cur_ids:
        check_assets(ids, set(cur_ids), path)
        _replace_items(current, ids)
        changed = True
    new_count = len(cur_ids) if ids is None else len(ids)
    for attr, val in (('autoplay', parsed.get('autoplay')), ('interval_ms', parsed.get('interval_ms')),
                      ('mode', derive_mode(new_count))):
        if val is not None and getattr(current, attr) != val:
            setattr(current, attr, val)
            changed = True
    if changed:
        try:
            current.save()
        except DjangoValidationError as exc:
            raise ValidationFailed(fields={'form': [str(m) for m in sum(exc.message_dict.values(), [])][:3]}) from None
    return current
