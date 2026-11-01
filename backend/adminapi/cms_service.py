"""Admin CMS: site sections S01-S05 and legal pages S06 (contract 3.9).

Model: the live copy is `SiteSection` / `LegalPage` (what the public API serves). The working copy is a `ContentDraft`
row whose `version` is the editor's optimistic lock (0 = no draft yet). Publishing, in one transaction with the row
locks and the strict audit row: validates the draft again, writes the live row (the content signal writes the
revalidation outbox row in the same transaction), appends an immutable `ContentVersion`.
"""
from __future__ import annotations

import datetime
import json

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

import audit
from content import validation as v
from content.models import ContentDraft, ContentVersion, LegalPage, MediaAsset, MediaCollection, SiteSection
from content.selectors import collections_for
from content.serializers import collection_dto, media_dto
from core.errors import NotFound, NotPublishable, ValidationFailed, VersionConflict
from core.responses import iso

from . import media_service as ms

MAX_CONTENT_BYTES = 200_000
MAX_SUMMARY = 300


# ---------------------------------------------------------------- shared helpers

def _who(user):
    return None if user is None else {'id': str(user.pk), 'name': getattr(user, 'name', '') or 'Admin'}


def _content_errors(exc: v.ContentError, field='content') -> ValidationFailed:
    return ValidationFailed(fields={field: [m[:300] for m in exc.messages[:10]]})


def _model_errors(exc: DjangoValidationError) -> ValidationFailed:
    fields = {}
    for key, messages in (exc.message_dict if hasattr(exc, 'error_dict') else {'form': exc.messages}).items():
        fields[key] = [str(m)[:300] for m in messages][:5]
    return ValidationFailed(fields=fields)


def resolve_image_blocks(blocks, field='body'):
    """Image blocks may carry `assetId` instead of the inline media object: resolve it to the public media shape.
    Returns a new list; every other block is passed on for the closed-model validator to check."""
    if not isinstance(blocks, list):
        return blocks  # the validator reports the shape error
    out, ids = [], {}
    for n, block in enumerate(blocks):
        if isinstance(block, dict) and block.get('type') == 'image' and 'assetId' in block and 'media' not in block:
            ids[n] = block['assetId']
    assets = {}
    if ids:
        parsed = {}
        for n, raw in ids.items():
            try:
                parsed[n] = ms.parse_asset_id(raw) if isinstance(raw, str) else None
            except NotFound:
                parsed[n] = None
            if parsed[n] is None:
                raise ValidationFailed(fields={f'{field}.{n}.assetId': ['Use a valid asset id.']})
        assets = {a.pk: a for a in MediaAsset.objects.filter(pk__in=set(parsed.values()))}
        for n, pk in parsed.items():
            asset = assets.get(pk)
            if asset is None or asset.archived:
                raise ValidationFailed(fields={f'{field}.{n}.assetId': ['This asset does not exist or is archived.']})
        ids = parsed
    for n, block in enumerate(blocks):
        if n in ids:
            block = {k: val for k, val in block.items() if k != 'assetId'}
            block['media'] = media_dto(assets[ids[n]])
        out.append(block)
    return out


def _size_check(content, field):
    if len(json.dumps(content, ensure_ascii=False, default=str)) > MAX_CONTENT_BYTES:
        raise ValidationFailed(fields={field: ['This is too large.']})


def _summary(errors, data):
    if 'summary' not in data:
        return ''
    value = data['summary']
    if not isinstance(value, str) or len(value.strip()) > MAX_SUMMARY or any(ord(c) < 0x20 for c in value):
        errors['summary'] = [f'Use at most {MAX_SUMMARY} characters.']
        return ''
    return value.strip()


def _draft_row(kind, key):
    return ContentDraft.objects.filter(kind=kind, key=key).select_related('updated_by').first()


def _locked_draft(kind, key) -> ContentDraft:
    """Create-if-missing then lock (the unique constraint settles a creation race)."""
    try:
        ContentDraft.objects.get_or_create(kind=kind, key=key)
    except IntegrityError:
        pass
    return ContentDraft.objects.select_for_update(of=('self',)).select_related('updated_by').get(kind=kind, key=key)


def _conflict(draft: ContentDraft) -> VersionConflict:
    who = getattr(draft.updated_by, 'name', '') or 'another editor'
    summary = f' ({draft.change_summary})' if draft.change_summary else ''
    return VersionConflict(reason=f'Changed by {who} at {iso(draft.updated_at)}{summary}.')


def _has_draft(draft) -> bool:
    return draft is not None and draft.version > 0


def _parse_draft_body(data, allowed):
    ms._unknown(data, allowed | {'version', 'summary'})
    errors = {}
    version = data.get('version')
    if not ms._is_int(version) or version < 0:
        errors['version'] = ['Send the version last read (0 when there is no draft yet).']
    summary = _summary(errors, data)
    return errors, version, summary


# ---------------------------------------------------------------- sections: S01, S02

def _live_section(key):
    return SiteSection.objects.filter(key=key, status='published').first()


def _section_status(live, draft) -> str:
    """Web row status: `draft` = unpublished edits; `clean` = nothing unpublished (or nothing at all);
    `published` = live copy that was never edited."""
    if _has_draft(draft):
        if live is None or draft.content != live.content:
            return 'draft'
        return 'clean'
    return 'published' if live is not None else 'clean'


EPOCH = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)


def _last_change(kind, key, draft):
    """{by, at, summary}: the unpublished edit if there is one, else the latest publish. None when no actor is known."""
    if _has_draft(draft) and draft.updated_by_id:
        return {'by': _who(draft.updated_by), 'at': iso(draft.updated_at), 'summary': draft.change_summary or None}
    last = (ContentVersion.objects.filter(kind=kind, key=key, published_by__isnull=False)
            .select_related('published_by').order_by('-number').first())
    if last is None:
        return None
    return {'by': _who(last.published_by), 'at': iso(last.published_at), 'summary': last.summary or None}


def collections_for_keys(keys) -> dict:
    """key -> MediaCollection with items prefetched, for the keys referenced by section content (one query pair)."""
    return collections_for([{'collection': k} for k in sorted(keys)]) if keys else {}


def last_changes(object_type, ids) -> dict:
    """id (as given) -> {by, at, summary} from the newest audit row that has an actor (batched; None when unknown).
    Stories and testimonials keep no editor columns, so their `lastChange` is read from the audit trail."""
    from audit.models import AuditLog
    wanted = {str(i): i for i in ids}
    out = {}
    if not wanted:
        return out
    rows = (AuditLog.objects.filter(object_type=object_type, object_id__in=list(wanted), actor__isnull=False)
            .select_related('actor').order_by('-occurred_at'))
    for row in rows:
        pk = wanted[row.object_id]
        if pk not in out:
            out[pk] = {'by': _who(row.actor), 'at': iso(row.occurred_at), 'summary': None}
    return out


def _wrapped(key, version, updated_at, content):
    return {'key': key, 'version': version, 'updatedAt': iso(updated_at), 'content': content}


def check_section_key(key) -> str:
    if key not in v.SITE_KEYS:
        raise NotFound('Section not found.')
    return key


def list_sections() -> list[dict]:
    live = {s.key: s for s in SiteSection.objects.filter(status='published')}
    drafts = {d.key: d for d in ContentDraft.objects.filter(kind='site').select_related('updated_by')}
    rows = []
    for key in v.SITE_KEYS:
        s, d = live.get(key), drafts.get(key)
        status = _section_status(s, d)
        stamps = [x.updated_at for x in (s, d if _has_draft(d) else None) if x is not None]
        last_draft = d if _has_draft(d) else None
        rows.append({
            'key': key, 'status': status, 'hasUnpublishedChanges': status == 'draft',
            'version': d.version if d is not None else 0,
            'publishedAt': iso(s.updated_at) if s is not None else None,
            'updatedAt': iso(max(stamps) if stamps else EPOCH),
            'updatedBy': _who(last_draft.updated_by) if last_draft else None,
        })
    return rows


def resolve_admin_refs(value, collections: dict):
    """Admin read of section content: each `{collection: key}` reference becomes the private gallery in the public
    shape (mode, autoplay, intervalMs, items) plus `assetIds` and `assets` summaries (PLAN-010)."""
    if isinstance(value, dict):
        if set(value) == {'collection'} and isinstance(value['collection'], str):
            c = collections.get(value['collection'])
            gallery = ms.gallery_dto(c)
            return {**collection_dto(c), 'assetIds': gallery['assetIds'], 'assets': gallery['assets']}
        return {k: resolve_admin_refs(x, collections) for k, x in value.items()}
    if isinstance(value, list):
        return [resolve_admin_refs(x, collections) for x in value]
    return value


def section_detail(key) -> dict:
    """Web `cmsSectionSchema`: `published` and `draft` are `{key, version, updatedAt, content}` wrappers; `draft` is
    null unless there are unpublished edits. `version` is the draft write token (0 = no draft yet)."""
    check_section_key(key)
    live, draft = _live_section(key), _draft_row('site', key)
    has = _has_draft(draft)
    status = _section_status(live, draft)
    unpublished = status == 'draft'
    working = draft.content if has else (live.content if live is not None else None)
    stamps = [x.updated_at for x in (live, draft if has else None) if x is not None]
    # The web reads both copies in the public section shape: `{collection: key}` references become the resolved
    # collection (mode, autoplay, intervalMs, items). Drafts keep the reference form in storage and on input.
    refs = set()
    for content in (live.content if live is not None else None, draft.content if unpublished else None):
        refs.update(v.collect_collection_refs(content))
    collections = collections_for_keys(refs)
    return {
        'key': key, 'status': status, 'hasUnpublishedChanges': unpublished,
        'version': draft.version if draft is not None else 0,
        'published': (_wrapped(key, live.version, live.updated_at, resolve_admin_refs(live.content, collections))
                      if live is not None else None),
        'draft': (_wrapped(key, draft.version, draft.updated_at, resolve_admin_refs(draft.content, collections))
                  if unpublished else None),
        'updatedAt': iso(max(stamps) if stamps else EPOCH),
        'lastChange': _last_change('site', key, draft),
        'publishedAt': iso(live.updated_at) if live is not None else None,
        'publishedVersion': live.version if live is not None else None,
        'updatedBy': _who(draft.updated_by) if has else None,
        'changeSummary': (draft.change_summary or None) if has else None,
    }


# ---------------------------------------------------------------- sections: S03

def _validate_section(key, content, field='content'):
    if not isinstance(content, dict):
        raise ValidationFailed(fields={field: ['Send the section as a JSON object.']})
    _size_check(content, field)
    exists = lambda k: MediaCollection.objects.filter(key=k).exists()  # noqa: E731
    try:
        v.site_section_checker(key, exists)(content, key)
    except v.ContentError as exc:
        raise _content_errors(exc, field) from None


_GALLERY_KEYS = ms.GALLERY_INPUT_KEYS | ms.GALLERY_ECHO_KEYS
_RESOLVED_KEYS = {'mode', 'autoplay', 'intervalMs', 'items'}


def _is_gallery_input(value) -> bool:
    """`{assetIds, autoplay?, intervalMs?}` (what the admin sends), tolerating the read-only keys it was read with."""
    return isinstance(value, dict) and 'assetIds' in value and set(value) <= _GALLERY_KEYS


def _is_legacy_resolved(value) -> bool:
    return (isinstance(value, dict) and set(value) == _RESOLVED_KEYS and isinstance(value['items'], list)
            and value['mode'] in ('static', 'carousel'))


def _legacy_to_gallery(resolved: dict, path: str) -> dict:
    """Old clients echo the public shape; map its images back to asset ids by `src`."""
    srcs = []
    for n, item in enumerate(resolved['items']):
        src = item.get('src') if isinstance(item, dict) else None
        if not isinstance(src, str):
            raise ValidationFailed(fields={f'content.{path}.items.{n}': ['Send the image as it was read.']})
        srcs.append(src)
    assets = {}
    for asset in MediaAsset.objects.filter(src__in=srcs, archived=False).order_by('-created_at'):
        assets.setdefault(asset.src, asset.pk)
    for n, src in enumerate(srcs):
        if src not in assets:
            raise ValidationFailed(fields={f'content.{path}.items.{n}': ['This image is not in the media library.']})
    return {'assetIds': [str(assets[s]) for s in srcs], 'autoplay': resolved['autoplay'],
            'intervalMs': resolved['intervalMs']}


def _gallery_for_slot(section_key: str, raw: dict, current_ref, live_keys: set, path: str) -> str:
    """Store the slot's images in a private gallery owned by this section slot and return its collection key.
    The gallery the live copy shows is never edited in place: a draft edit of a published slot clones it first."""
    parsed, errors = ms.parse_gallery(raw, f'content.{path}')
    if errors:
        raise ValidationFailed(fields=errors)
    owner_ref = f'{section_key}:{path}'
    current = None
    if isinstance(current_ref, dict) and isinstance(current_ref.get('collection'), str):
        current = MediaCollection.objects.filter(key=current_ref['collection']).first()
        if current is not None and current.key in live_keys:
            # The live copy shows this gallery: keep it intact and fork a draft gallery from it.
            parsed.setdefault('asset_ids', ms.gallery_asset_ids(current))
            parsed.setdefault('autoplay', current.autoplay)
            parsed.setdefault('interval_ms', current.interval_ms)
            current = None
        elif current is not None and (current.owner_kind != 'site_section' or current.owner_ref != owner_ref):
            parsed.setdefault('asset_ids', ms.gallery_asset_ids(current))
            current = None
    gallery = ms.set_gallery('site_section', owner_ref, current, parsed, f'content.{path}.assetIds')
    return gallery.key


def _unresolve_collections(value, current, section_key, live_keys, path=''):
    """Replace every gallery in submitted section content by its `{collection: key}` reference. The legacy reference
    form passes through unchanged. `current` is the stored content at the same place (or None)."""
    if _is_legacy_resolved(value):
        value = _legacy_to_gallery(value, path or 'content')
    if _is_gallery_input(value):
        return {'collection': _gallery_for_slot(section_key, value, current, live_keys, path or 'content')}
    if isinstance(value, dict):
        return {k: _unresolve_collections(x, current.get(k) if isinstance(current, dict) else None,
                                          section_key, live_keys, f'{path}.{k}' if path else k)
                for k, x in value.items()}
    if isinstance(value, list):
        return [_unresolve_collections(x, current[i] if isinstance(current, list) and i < len(current) else None,
                                       section_key, live_keys, f'{path}.{i}' if path else str(i))
                for i, x in enumerate(value)]
    return value


def _draft_result(key, draft) -> dict:
    # Web `saveCmsDraftResultSchema` literal status 'draft' ("saved but not published"); the full detail is kept alongside.
    return {**section_detail(key), 'status': 'draft', 'savedAt': iso(draft.updated_at)}


def save_section_draft(request, key, data) -> dict:
    check_section_key(key)
    errors, version, summary = _parse_draft_body(data, {'content'})
    if 'content' not in data:
        errors['content'] = ['This is required.']
    if errors:
        raise ValidationFailed(fields=errors)
    content = data['content']
    if not isinstance(content, dict):
        raise ValidationFailed(fields={'content': ['Send the section as a JSON object.']})
    _size_check(content, 'content')
    with transaction.atomic():
        draft = _locked_draft('site', key)
        if version != draft.version:
            raise _conflict(draft)
        # The web sends back the resolved collections it read; store them as collection references. Anything created
        # here is rolled back with the rest if validation fails below.
        live = _live_section(key)
        stored = draft.content if _has_draft(draft) else (live.content if live is not None else None)
        live_keys = set(v.collect_collection_refs(live.content)) if live is not None else set()
        content = _unresolve_collections(content, stored, key, live_keys)
        _validate_section(key, content)
        if _has_draft(draft) and draft.content == content:
            return _draft_result(key, draft)
        before = draft.version
        draft.content, draft.version = content, draft.version + 1
        draft.change_summary, draft.updated_by = summary, request.user
        draft.save()
        audit.write(request, action='cms.section.draft', object_type='site_section', object_id=key,
                    before={'draftVersion': before}, after={'draftVersion': draft.version, 'summary': summary})
    return _draft_result(key, draft)


# ---------------------------------------------------------------- sections: S04

def publish_section(request, key, data) -> dict:
    check_section_key(key)
    ms._unknown(data, {'version', 'summary'})
    errors = {}
    expected = data.get('version')
    if 'version' in data and (not ms._is_int(expected) or expected < 0):
        errors['version'] = ['Send the draft version last read.']
    summary = _summary(errors, data)
    if errors:
        raise ValidationFailed(fields=errors)
    with transaction.atomic():
        draft = _locked_draft('site', key)
        if expected is not None and expected != draft.version:
            raise _conflict(draft)
        live = SiteSection.objects.select_for_update().filter(key=key).first()
        if not _has_draft(draft):
            raise NotPublishable(blockers=[{'code': 'NO_DRAFT', 'reason': 'There is no draft to publish.'}],
                                 fields={'form': ['There is no draft to publish.']})
        if live is not None and live.status == 'published' and live.content == draft.content:
            raise NotPublishable(blockers=[{'code': 'NO_CHANGES', 'reason': 'The draft matches the live copy.'}],
                                 fields={'form': ['The draft matches the live copy.']})
        try:
            _validate_section(key, draft.content)
        except ValidationFailed as exc:
            blockers = [{'code': 'INVALID_CONTENT', 'reason': m, 'field': 'content'}
                        for m in (exc.fields or {}).get('content', [])[:10]]
            raise NotPublishable(blockers=blockers or None, fields=exc.fields) from None
        gallery_keys = set(v.collect_collection_refs(draft.content))
        if gallery_keys and ms.missing_alt_in(
                MediaCollection.objects.filter(key__in=gallery_keys).values_list('pk', flat=True)):
            reason = 'Every image needs alt text (or must be marked decorative).'
            raise NotPublishable(blockers=[{'code': 'INVALID', 'reason': reason, 'field': 'content'}],
                                 fields={'content': [reason]})
        before = {'status': live.status if live else None, 'version': live.version if live else None}
        if live is None:
            live = SiteSection(key=key)
        live.content, live.status = draft.content, 'published'
        try:
            live.save()  # content.signals writes the site/{key} outbox row in this transaction
        except DjangoValidationError as exc:
            raise _model_errors(exc) from None
        now = timezone.now()
        number = (ContentVersion.objects.filter(kind='site', key=key).order_by('-number')
                  .values_list('number', flat=True).first() or 0) + 1
        ContentVersion.objects.create(kind='site', key=key, number=number, content=draft.content,
                                      summary=summary or draft.change_summary, published_by=request.user,
                                      published_at=now)
        audit.write(request, action='cms.section.publish', object_type='site_section', object_id=key,
                    before=before, after={'status': 'published', 'version': live.version, 'versionNumber': number})
    return {'key': key, 'status': 'published', 'publishedAt': iso(now), 'versionNumber': number,
            'version': draft.version, 'publishedVersion': live.version}


# ---------------------------------------------------------------- sections: S05

def list_versions(kind, key):
    return ContentVersion.objects.filter(kind=kind, key=key).select_related('published_by').order_by('-number')


def version_dto(row: ContentVersion) -> dict:
    return {'version': row.number, 'number': row.number, 'publishedAt': iso(row.published_at),
            'publishedBy': _who(row.published_by) or dict(ms.NIL_ACTOR), 'summary': row.summary or None}


# ---------------------------------------------------------------- legal: S06

def check_legal_page(page) -> str:
    if page not in v.LEGAL_PAGES:
        raise NotFound('Legal page not found.')
    return page


def _legal_content(row: LegalPage) -> dict:
    return {'title': row.title, 'blocks': row.blocks, 'effectiveDate': row.effective_date.isoformat()}


def legal_detail(page) -> dict:
    check_legal_page(page)
    live, draft = LegalPage.objects.filter(page=page).first(), _draft_row('legal', page)
    has = _has_draft(draft)
    stamps = [x.updated_at for x in (live, draft if has else None) if x is not None]
    published = {'page': page, **_legal_content(live)} if live is not None else None
    working = {'page': page, **draft.content} if has else published
    if has:
        status = 'draft' if live is None or _legal_content(live) != draft.content else 'published'
    else:
        status = 'published' if live is not None else 'clean'
    return {
        'page': page, 'status': status, 'hasUnpublishedChanges': status == 'draft',
        'version': draft.version if draft is not None else 0,
        'draft': working, 'published': published,
        'publishedAt': iso(live.updated_at) if live is not None else None,
        'publishedVersion': live.version if live is not None else None,
        'updatedAt': iso(max(stamps) if stamps else EPOCH),
        'lastChange': _last_change('legal', page, draft),
        'updatedBy': _who(draft.updated_by) if has else None,
        'changeSummary': (draft.change_summary or None) if has else None,
    }


def _parse_legal_content(data) -> dict:
    errors = {}
    out = {}
    title = data.get('title')
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= 120 or any(ord(c) < 0x20 for c in title):
        errors['title'] = ['Use 1 to 120 characters.']
    else:
        out['title'] = title.strip()
    raw_date = data.get('effectiveDate')
    try:
        if not isinstance(raw_date, str) or len(raw_date) != 10:
            raise ValueError
        out['effectiveDate'] = datetime.date.fromisoformat(raw_date).isoformat()
    except ValueError:
        errors['effectiveDate'] = ['Use a date as YYYY-MM-DD.']
    if 'blocks' not in data:
        errors['blocks'] = ['This is required.']
    else:
        blocks = resolve_image_blocks(data['blocks'], 'blocks')
        try:
            _size_check(blocks, 'blocks')
            v.check_blocks(blocks, 'blocks')
            out['blocks'] = blocks
        except v.ContentError as exc:
            errors['blocks'] = [m[:300] for m in exc.messages[:10]]
        except ValidationFailed as exc:
            errors.update(exc.fields or {})
    if errors:
        raise ValidationFailed(fields=errors)
    return out


def save_legal_draft(request, page, data) -> dict:
    check_legal_page(page)
    errors, version, summary = _parse_draft_body(data, {'title', 'blocks', 'effectiveDate'})
    if errors:
        raise ValidationFailed(fields=errors)
    content = _parse_legal_content(data)
    with transaction.atomic():
        draft = _locked_draft('legal', page)
        if version != draft.version:
            raise _conflict(draft)
        if _has_draft(draft) and draft.content == content:
            return legal_detail(page)
        before = draft.version
        draft.content, draft.version = content, draft.version + 1
        draft.change_summary, draft.updated_by = summary, request.user
        draft.save()
        audit.write(request, action='legal.draft', object_type='legal_page', object_id=page,
                    before={'draftVersion': before}, after={'draftVersion': draft.version, 'summary': summary})
    return legal_detail(page)


def publish_legal(request, page, data) -> dict:
    check_legal_page(page)
    ms._unknown(data, {'version', 'summary'})
    errors = {}
    expected = data.get('version')
    if 'version' in data and (not ms._is_int(expected) or expected < 0):
        errors['version'] = ['Send the draft version last read.']
    summary = _summary(errors, data)
    if errors:
        raise ValidationFailed(fields=errors)
    with transaction.atomic():
        draft = _locked_draft('legal', page)
        if expected is not None and expected != draft.version:
            raise _conflict(draft)
        live = LegalPage.objects.select_for_update().filter(page=page).first()
        if not _has_draft(draft):
            raise NotPublishable(blockers=[{'code': 'NO_DRAFT', 'reason': 'There is no draft to publish.'}],
                                 fields={'form': ['There is no draft to publish.']})
        if live is not None and _legal_content(live) == draft.content:
            raise NotPublishable(blockers=[{'code': 'NO_CHANGES', 'reason': 'The draft matches the live copy.'}],
                                 fields={'form': ['The draft matches the live copy.']})
        try:
            content = _parse_legal_content(draft.content)
        except ValidationFailed as exc:
            raise NotPublishable(fields=exc.fields) from None
        before = {'version': live.version if live else None}
        if live is None:
            live = LegalPage(page=page)
        live.title, live.blocks = content['title'], content['blocks']
        live.effective_date = datetime.date.fromisoformat(content['effectiveDate'])
        try:
            live.save()  # content.signals writes the legal/{page} outbox row in this transaction
        except DjangoValidationError as exc:
            raise _model_errors(exc) from None
        now = timezone.now()
        number = (ContentVersion.objects.filter(kind='legal', key=page).order_by('-number')
                  .values_list('number', flat=True).first() or 0) + 1
        ContentVersion.objects.create(kind='legal', key=page, number=number, content=draft.content,
                                      summary=summary or draft.change_summary, published_by=request.user,
                                      published_at=now)
        audit.write(request, action='legal.publish', object_type='legal_page', object_id=page,
                    before=before, after={'version': live.version, 'versionNumber': number,
                                          'effectiveDate': content['effectiveDate']})
    return {'page': page, 'status': 'published', 'publishedAt': iso(now), 'versionNumber': number,
            'version': draft.version, 'publishedVersion': live.version}
