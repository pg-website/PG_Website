"""Admin stories S13/S14 and testimonials S15/S16 (contract 3.9).

Stories and testimonials have no separate draft copy: the row's own status/published flag decides what the public API
serves, so editing a published row is live at once (and revalidates). Every mutation is one `transaction.atomic()` with
the row lock, the change (content.signals writes the revalidation outbox row) and the strict audit row.
"""
from __future__ import annotations

import datetime
import re
import secrets
import unicodedata
import uuid

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

import audit
from content import validation as v
from content.models import MediaAsset, Story, Testimonial
from core.errors import NotFound, NotPublishable, SlugLocked, SlugTaken, ValidationFailed, VersionConflict
from core.responses import iso

from . import media_service as ms
from .cms_service import _model_errors, _size_check, _who, last_changes, resolve_image_blocks

# `coverAssetId` and `consentAt` are the legacy forms; the web sends `media` (assetIds) and `consent`.
STORY_FIELDS = {'version', 'slug', 'kind', 'eyebrow', 'title', 'dek', 'publishedOn', 'readingMinutes', 'featured',
                'coverAssetId', 'media', 'body'}
TESTIMONIAL_FIELDS = {'version', 'quote', 'name', 'descriptor', 'portraitAssetId', 'consent', 'consentAt', 'sortOrder'}


def _uuid(value, label):
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        raise NotFound(f'{label} not found.') from None


def _flag(errors, data, field, out, attr):
    if field in data:
        if not isinstance(data[field], bool):
            errors[field] = ['Send true or false.']
        else:
            out[attr] = data[field]


def _asset_ref(errors, field, raw):
    """-> asset id or None (explicit null clears). Archived or missing assets are rejected."""
    if raw is None:
        return None
    try:
        pk = uuid.UUID(raw) if isinstance(raw, str) else None
    except ValueError:
        pk = None
    asset = MediaAsset.objects.filter(pk=pk, archived=False).only('id').first() if pk else None
    if asset is None:
        errors[field] = ['This asset does not exist or is archived.']
        return None
    return asset.pk


# ---------------------------------------------------------------- stories

def story_dto(s: Story, *, full=True) -> dict:
    dto = {
        'id': str(s.pk), 'slug': s.slug, 'kind': s.kind, 'title': s.title, 'dek': s.dek, 'eyebrow': s.eyebrow,
        'status': s.status, 'publishedOn': s.published_on.isoformat(), 'readingMinutes': s.reading_minutes,
        'featured': s.featured, 'coverAssetId': str(s.cover_id) if s.cover_id else None,
        'slugLocked': s.first_published_at is not None, 'firstPublishedAt': iso(s.first_published_at),
        'version': s.version, 'updatedAt': iso(s.updated_at),
    }
    if full:
        # Web `adminStorySchema`: `slug` is the lock union, `media` the story's private gallery (PLAN-010: assetIds plus
        # asset summaries), `lastChange` comes from the audit trail.
        dto['slug'] = ({'lock': 'locked', 'value': s.slug, 'lockedAt': iso(s.first_published_at)}
                       if s.first_published_at is not None else {'lock': 'editable', 'value': s.slug})
        dto['media'] = ms.gallery_dto(s.collection if s.collection_id else None)
        dto['lastChange'] = last_changes('story', [s.pk]).get(s.pk)
        dto['body'] = s.body
    return dto


def get_story(story_id, *, lock=False) -> Story:
    qs = Story.objects.select_for_update(of=('self',)) if lock else Story.objects.all()
    story = qs.filter(pk=_uuid(story_id, 'Story')).first()
    if story is None:
        raise NotFound('Story not found.')
    return story


def list_stories(params):
    errors = {}
    status, kind = params.get('status'), params.get('kind')
    if status is not None and status not in ('draft', 'published'):
        errors['status'] = ['Choose draft or published.']
    if kind is not None and kind not in v.STORY_KINDS:
        errors['kind'] = ['Choose one of the listed options.']
    q = (params.get('q') or '').strip()
    if len(q) > 100:
        errors['q'] = ['Use at most 100 characters.']
    if errors:
        raise ValidationFailed(fields=errors)
    qs = Story.objects.all().defer('body')
    if status:
        qs = qs.filter(status=status)
    if kind:
        qs = qs.filter(kind=kind)
    if q:
        qs = qs.filter(Q(title__icontains=q) | Q(slug__icontains=q))
    return qs.order_by('-published_on', 'slug')


def _slug_taken(slug, exclude_id=None) -> bool:
    qs = Story.objects.filter(slug__iexact=slug)
    if exclude_id is not None:
        qs = qs.exclude(pk=exclude_id)
    return qs.exists()


def _parse_story(data, *, creating: bool):
    ms._unknown(data, STORY_FIELDS - ({'version'} if creating else set()))
    errors, out = {}, {}
    version = None if creating else ms._version(errors, data)
    if 'slug' in data:
        slug = data['slug']
        if not isinstance(slug, str) or not v.is_slug(slug) or not 3 <= len(slug) <= 80:
            errors['slug'] = ['Use 3 to 80 lowercase letters, digits and single hyphens.']
        else:
            out['slug'] = slug
    if 'kind' in data:
        if data['kind'] not in v.STORY_KINDS:
            errors['kind'] = ['Choose one of the listed options.']
        else:
            out['kind'] = data['kind']
    elif creating:
        errors['kind'] = ['This is required.']
    for field, limit in (('title', 160), ('eyebrow', 60), ('dek', 300)):
        if field in data:
            # Web: create needs a title; a draft PATCH may blank it (the publish blockers say what is missing).
            out[field] = ms._text(errors, field, data[field], limit,
                                  min_len=1 if (field == 'title' and creating) else 0)
        elif creating and field == 'title':
            errors['title'] = ['This is required.']
    if 'publishedOn' in data and data['publishedOn'] is not None:  # null = unset: the column is never empty, no change
        try:
            if not isinstance(data['publishedOn'], str) or len(data['publishedOn']) != 10:
                raise ValueError
            out['published_on'] = datetime.date.fromisoformat(data['publishedOn'])
        except ValueError:
            errors['publishedOn'] = ['Use a date as YYYY-MM-DD.']
    if 'readingMinutes' in data and data['readingMinutes'] is not None:  # null = unset: no change
        n = data['readingMinutes']
        if not ms._is_int(n) or not 1 <= n <= 120:
            errors['readingMinutes'] = ['Use 1 to 120 minutes.']
        else:
            out['reading_minutes'] = n
    _flag(errors, data, 'featured', out, 'featured')
    if 'coverAssetId' in data:
        out['cover_id'] = _asset_ref(errors, 'coverAssetId', data['coverAssetId'])
    if 'media' in data:
        raw = data['media']
        if not isinstance(raw, dict) or set(raw) - ms.GALLERY_INPUT_KEYS:
            errors['media'] = ['Send {"assetIds": [...], "autoplay"?, "intervalMs"?}.']
        else:
            gallery, gallery_errors = ms.parse_gallery(raw, 'media')
            errors.update(gallery_errors)
            out['_gallery'] = gallery
    if 'body' in data:
        try:
            body = resolve_image_blocks(data['body'], 'body')
            _size_check(body, 'body')
            v.check_blocks(body, 'body')
            out['body'] = body
        except v.ContentError as exc:
            errors['body'] = [m[:300] for m in exc.messages[:10]]
        except ValidationFailed as exc:
            errors.update(exc.fields or {})
    if not errors and not creating and not out:
        errors['form'] = ['Send at least one field to change.']
    if errors:
        raise ValidationFailed(fields=errors)
    return version, out


def parse_story_create(data):
    return _parse_story(data, creating=True)[1]


def parse_story_patch(data):
    return _parse_story(data, creating=False)


def _proposed_slug(title: str) -> str:
    """A free slug from the title, for a draft created without one (web: slug is optional on create)."""
    words = unicodedata.normalize('NFKD', title).encode('ascii', 'ignore').decode().lower()
    base = re.sub(r'[^a-z0-9]+', '-', words).strip('-')[:80].strip('-')
    if len(base) < 3:
        base = 'story'
    slug = base
    while _slug_taken(slug):
        slug = f'{base[:73].rstrip("-")}-{secrets.token_hex(3)}'
    return slug


def create_story(request, parsed: dict) -> Story:
    if parsed.get('slug') is None:
        parsed = {**parsed, 'slug': _proposed_slug(parsed['title'])}
    if _slug_taken(parsed['slug']):
        raise SlugTaken()
    story = Story(slug=parsed['slug'], kind=parsed['kind'], title=parsed['title'], eyebrow=parsed.get('eyebrow', ''),
                  dek=parsed.get('dek', ''), published_on=parsed.get('published_on') or timezone.localdate(),
                  reading_minutes=parsed.get('reading_minutes', 1), featured=parsed.get('featured', False),
                  cover_id=parsed.get('cover_id'),
                  body=parsed.get('body', []), status='draft')
    try:
        with transaction.atomic():
            story.save()
            if parsed.get('_gallery', {}).get('asset_ids'):
                story.collection = ms.set_gallery('story', story.pk, None, parsed['_gallery'])
                story.save()
            audit.write(request, action='story.create', object_type='story', object_id=story.pk,
                        after={'slug': story.slug, 'kind': story.kind, 'title': story.title})
    except DjangoValidationError as exc:
        raise _model_errors(exc) from None
    except IntegrityError:
        raise SlugTaken() from None
    return story


def update_story(request, story_id, version, parsed: dict) -> Story:
    pk = get_story(story_id).pk
    try:
        with transaction.atomic():
            story = get_story(pk, lock=True)
            if version is not None and version != story.version:
                raise VersionConflict()
            if 'slug' in parsed and parsed['slug'] != story.slug:
                if story.first_published_at is not None:
                    raise SlugLocked()
                if _slug_taken(parsed['slug'], story.pk):
                    raise SlugTaken()
            before, after = {}, {}
            if '_gallery' in parsed:
                current = story.collection if story.collection_id else None
                cur_ids = ms.gallery_asset_ids(current)
                new_ids = parsed['_gallery'].get('asset_ids')
                if current is not None or new_ids:
                    gallery = ms.set_gallery('story', story.pk, current, parsed['_gallery'])
                    if gallery.pk != story.collection_id:
                        story.collection = gallery
                        before['media'], after['media'] = [str(i) for i in cur_ids], [str(i) for i in new_ids or []]
                    elif new_ids is not None and new_ids != cur_ids:
                        before['media'], after['media'] = [str(i) for i in cur_ids], [str(i) for i in new_ids]
            for attr, value in parsed.items():
                if attr == '_gallery':
                    continue
                if attr == 'body':
                    changed = story.body != value
                else:
                    changed = getattr(story, attr) != value
                if changed:
                    # Never put the whole body in the audit row: record that it changed.
                    before[attr] = '[body]' if attr == 'body' else getattr(story, attr)
                    after[attr] = '[body]' if attr == 'body' else value
                    setattr(story, attr, value)
            if after:
                story.save()  # signals: revalidates when the story is published
                audit.write(request, action='story.update', object_type='story', object_id=story.pk,
                            before=_jsonable(before), after=_jsonable(after))
    except DjangoValidationError as exc:
        raise _model_errors(exc) from None
    except IntegrityError:
        raise SlugTaken() from None
    return story


def _jsonable(d):
    return {k: (str(x) if isinstance(x, (datetime.date, uuid.UUID)) else x) for k, x in d.items()}


def story_blockers(story: Story) -> list[dict]:
    out = []

    def need(ok, code, reason, field):
        if not ok:
            out.append({'code': code, 'reason': reason, 'field': field})
    need(bool(story.title.strip()), 'REQUIRED', 'A title is required.', 'title')
    need(bool(story.eyebrow.strip()), 'REQUIRED', 'An eyebrow is required.', 'eyebrow')
    need(bool(story.dek.strip()), 'REQUIRED', 'A summary line is required.', 'dek')
    need(bool(story.body), 'REQUIRED', 'Add at least one block of body content.', 'body')
    need(not (story.collection_id and ms.missing_alt_in([story.collection_id])), 'INVALID',
         'Every image needs alt text (or must be marked decorative).', 'media.assetIds')
    return out


def publish_story(request, story_id) -> Story:
    with transaction.atomic():
        story = get_story(story_id, lock=True)
        if story.status == 'published':
            raise NotPublishable(blockers=[{'code': 'ALREADY_PUBLISHED', 'reason': 'This story is already published.'}],
                                 fields={'form': ['This story is already published.']})
        blockers = story_blockers(story)
        if blockers:
            raise NotPublishable(blockers=blockers, fields={b['field']: [b['reason']] for b in blockers})
        if _slug_taken(story.slug, story.pk):
            raise SlugTaken()
        story.status = 'published'
        try:
            story.save()  # sets first_published_at; signals write story/published in this transaction
        except DjangoValidationError as exc:
            raise _model_errors(exc) from None
        audit.write(request, action='story.publish', object_type='story', object_id=story.pk,
                    before={'status': 'draft'}, after={'status': 'published', 'slug': story.slug})
    return story


def unpublish_story(request, story_id) -> Story:
    with transaction.atomic():
        story = get_story(story_id, lock=True)
        if story.status != 'published':
            raise NotPublishable(blockers=[{'code': 'NOT_PUBLISHED', 'reason': 'This story is not published.'}],
                                 fields={'form': ['This story is not published.']})
        story.status = 'draft'  # the slug stays locked: first_published_at is kept
        story.save()
        audit.write(request, action='story.unpublish', object_type='story', object_id=story.pk,
                    before={'status': 'published'}, after={'status': 'draft'})
    return story


# ---------------------------------------------------------------- testimonials

def testimonial_dtos(items) -> list[dict]:
    """Web `adminTestimonialSchema` rows with a fixed number of queries (portrait, last change, publish time)."""
    items = list(items)
    ids = [t.pk for t in items]
    changes = last_changes('testimonial', ids)
    published_at = _publish_times(ids)
    portraits = {a.pk: a for a in MediaAsset.objects.filter(pk__in=[t.portrait_id for t in items if t.portrait_id])}
    out = []
    for t in items:
        dto = {
            'id': str(t.pk), 'quote': t.quote, 'name': t.name, 'descriptor': t.descriptor,
            'portraitAssetId': str(t.portrait_id) if t.portrait_id else None,
            'portrait': ms.asset_summary_dto(portraits[t.portrait_id]) if t.portrait_id in portraits else None,
            'consentAt': iso(t.consent_at),
            'sortOrder': t.sort_order, 'status': 'published' if t.published else 'draft',
            'missing': testimonial_missing(t), 'version': t.version, 'updatedAt': iso(t.updated_at),
            'lastChange': changes.get(t.pk),
        }
        if t.published:
            dto['publishedAt'] = published_at.get(t.pk) or iso(t.updated_at)
        out.append(dto)
    return out


def testimonial_dto(t: Testimonial) -> dict:
    return testimonial_dtos([t])[0]


def _publish_times(ids) -> dict:
    """testimonial id -> ISO time of its newest publish (audit trail); empty when it was never published here."""
    from audit.models import AuditLog
    wanted = {str(i): i for i in ids}
    out = {}
    if not wanted:
        return out
    rows = (AuditLog.objects.filter(object_type='testimonial', action='testimonial.publish',
                                    object_id__in=list(wanted)).order_by('-occurred_at'))
    for row in rows:
        out.setdefault(wanted[row.object_id], iso(row.occurred_at))
    return out


def testimonial_missing(t: Testimonial) -> list[str]:
    return [name for name, ok in (('quote', bool(t.quote.strip())), ('name', bool(t.name.strip())),
                                  ('descriptor', bool(t.descriptor.strip())),
                                  ('portraitAssetId', t.portrait_id is not None),
                                  ('consentAt', t.consent_at is not None)) if not ok]


def get_testimonial(testimonial_id, *, lock=False) -> Testimonial:
    qs = Testimonial.objects.select_for_update() if lock else Testimonial.objects.all()
    t = qs.filter(pk=_uuid(testimonial_id, 'Testimonial')).first()
    if t is None:
        raise NotFound('Testimonial not found.')
    return t


def list_testimonials(params):
    errors = {}
    status = params.get('status')
    if status is not None and status not in ('draft', 'published'):
        errors['status'] = ['Choose draft or published.']
    flt = params.get('filter')
    if flt is not None and flt != 'missing-consent':
        errors['filter'] = ['Use missing-consent.']
    if errors:
        raise ValidationFailed(fields=errors)
    qs = Testimonial.objects.all()
    if status:
        qs = qs.filter(published=(status == 'published'))
    if flt == 'missing-consent':
        qs = qs.filter(consent_at__isnull=True)
    return qs.order_by('sort_order', 'created_at', 'id')


def _parse_testimonial(data, *, creating: bool):
    ms._unknown(data, TESTIMONIAL_FIELDS - ({'version'} if creating else set()))
    errors, out = {}, {}
    version = None if creating else ms._version(errors, data)
    if 'quote' in data:
        q = data['quote']
        # The quote is stored exactly as typed (never trimmed, normalised or rewritten); only blank/oversized/control
        # characters are rejected.
        # A draft PATCH may blank the quote (web draftText); publish needs it.
        if (not isinstance(q, str) or (creating and not q.strip()) or len(q) > 600
                or any((ord(c) < 0x20 and c not in '\n\t') or 0x7F <= ord(c) <= 0x9F for c in q)):
            errors['quote'] = ['Enter the quote, up to 600 characters.']
        else:
            out['quote'] = q
    elif creating:
        errors['quote'] = ['This is required.']
    for field, limit in (('name', 80), ('descriptor', 120)):
        if field in data:
            out[field] = ms._text(errors, field, data[field], limit, min_len=1 if creating else 0)
        elif creating:
            out[field] = ''  # web: optional on create; publish needs both (testimonial_missing)
    if 'portraitAssetId' in data:
        out['portrait_id'] = _asset_ref(errors, 'portraitAssetId', data['portraitAssetId'])
    if 'consent' in data:
        # Web: a boolean; the server stamps `consentAt` (create/update below). Never a browser timestamp.
        if not isinstance(data['consent'], bool):
            errors['consent'] = ['Send true or false.']
        elif 'consentAt' in data:
            errors['consent'] = ['Send consent or consentAt, not both.']
        else:
            out['consent'] = data['consent']
    if 'consentAt' in data and 'consent' not in data:  # legacy form
        raw = data['consentAt']
        if raw is None:
            out['consent_at'] = None
        else:
            try:
                if not isinstance(raw, str):
                    raise ValueError
                when = datetime.datetime.fromisoformat(raw.replace('Z', '+00:00'))
                if when.tzinfo is None:
                    raise ValueError
                if when > timezone.now() + datetime.timedelta(minutes=5):
                    errors['consentAt'] = ['Consent cannot be dated in the future.']
                else:
                    out['consent_at'] = when
            except ValueError:
                errors['consentAt'] = ['Use a date and time with a timezone, or null.']
    if 'sortOrder' in data:
        n = data['sortOrder']
        if not ms._is_int(n) or not 0 <= n <= 1000:
            errors['sortOrder'] = ['Use a whole number from 0 to 1000.']
        else:
            out['sort_order'] = n
    if not errors and not creating and not out:
        errors['form'] = ['Send at least one field to change.']
    if errors:
        raise ValidationFailed(fields=errors)
    return version, out


def parse_testimonial_create(data):
    return _parse_testimonial(data, creating=True)[1]


def parse_testimonial_patch(data):
    return _parse_testimonial(data, creating=False)


def _resolve_consent(parsed: dict, current) -> dict:
    """Turn the web's `consent` boolean into `consent_at`: true stamps now (an existing stamp is kept), false clears."""
    parsed = dict(parsed)
    if 'consent' in parsed:
        consent = parsed.pop('consent')
        if consent:
            parsed['consent_at'] = current or timezone.now()
        else:
            parsed['consent_at'] = None
    return parsed


def create_testimonial(request, parsed: dict) -> Testimonial:
    parsed = _resolve_consent(parsed, None)
    t = Testimonial(quote=parsed['quote'], name=parsed['name'], descriptor=parsed['descriptor'],
                    portrait_id=parsed.get('portrait_id'), consent_at=parsed.get('consent_at'),
                    sort_order=parsed.get('sort_order', 0), published=False)  # always starts as a draft
    with transaction.atomic():
        t.save()
        audit.write(request, action='testimonial.create', object_type='testimonial', object_id=t.pk,
                    after={'name': t.name, 'consent': t.consent_at is not None})
    return t


def update_testimonial(request, testimonial_id, version, parsed: dict) -> Testimonial:
    pk = get_testimonial(testimonial_id).pk
    try:
        with transaction.atomic():
            t = get_testimonial(pk, lock=True)
            if version is not None and version != t.version:
                raise VersionConflict()
            before, after = {}, {}
            for attr, value in _resolve_consent(parsed, t.consent_at).items():
                if getattr(t, attr) != value:
                    # The quote is personal content: the audit row records that it changed, not what it says.
                    before[attr] = '[quote]' if attr == 'quote' else getattr(t, attr)
                    after[attr] = '[quote]' if attr == 'quote' else value
                    setattr(t, attr, value)
            if after:
                if t.published and testimonial_missing(t):
                    # Withdrawing consent, quote or photo from a live testimonial: it must be unpublished first.
                    raise NotPublishable('Unpublish this testimonial before removing its quote, photo or consent.',
                                         fields={m: ['Unpublish first.'] for m in testimonial_missing(t)})
                t.save()  # signals: revalidates when the testimonial is published
                audit.write(request, action='testimonial.update', object_type='testimonial', object_id=t.pk,
                            before=_stringify(before), after=_stringify(after))
    except DjangoValidationError as exc:
        raise _model_errors(exc) from None
    return t


def _stringify(d):
    return {k: (iso(x) if isinstance(x, datetime.datetime) else str(x) if isinstance(x, uuid.UUID) else x)
            for k, x in d.items()}


def publish_testimonial(request, testimonial_id) -> Testimonial:
    with transaction.atomic():
        t = get_testimonial(testimonial_id, lock=True)
        if t.published:
            raise NotPublishable(blockers=[{'code': 'ALREADY_PUBLISHED', 'reason': 'This testimonial is already published.'}],
                                 fields={'form': ['This testimonial is already published.']})
        missing = testimonial_missing(t)
        if missing:
            labels = {'quote': 'A quote is required.', 'name': 'A name is required.',
                      'descriptor': 'A descriptor is required.', 'portraitAssetId': 'A portrait photo is required.',
                      'consentAt': 'Record the date the person agreed to be quoted.'}
            blockers = [{'code': 'CONSENT_REQUIRED' if m == 'consentAt' else 'REQUIRED', 'reason': labels[m],
                         'field': m} for m in missing]
            raise NotPublishable(blockers=blockers, fields={b['field']: [b['reason']] for b in blockers})
        if t.portrait is not None and t.portrait.archived:
            raise NotPublishable(blockers=[{'code': 'ASSET_ARCHIVED', 'reason': 'The portrait is archived.',
                                            'field': 'portraitAssetId'}],
                                 fields={'portraitAssetId': ['The portrait is archived.']})
        t.published = True
        try:
            t.save()
        except DjangoValidationError as exc:
            raise _model_errors(exc) from None
        audit.write(request, action='testimonial.publish', object_type='testimonial', object_id=t.pk,
                    before={'status': 'draft'}, after={'status': 'published'})
    return t


def unpublish_testimonial(request, testimonial_id) -> Testimonial:
    with transaction.atomic():
        t = get_testimonial(testimonial_id, lock=True)
        if not t.published:
            raise NotPublishable(blockers=[{'code': 'NOT_PUBLISHED', 'reason': 'This testimonial is not published.'}],
                                 fields={'form': ['This testimonial is not published.']})
        t.published = False
        t.save()
        audit.write(request, action='testimonial.unpublish', object_type='testimonial', object_id=t.pk,
                    before={'status': 'published'}, after={'status': 'draft'})
    return t
