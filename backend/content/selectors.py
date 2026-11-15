"""Read queries for the public API. All are bounded, select/prefetch related media, and never write."""
from __future__ import annotations

from django.db.models import Prefetch, Q
from django.utils import timezone

from . import validation as v
from .models import Event, LegalPage, MediaCollection, SiteSection, Story, Testimonial

UPCOMING_STATUSES = ('published', 'registration_open', 'sold_out', 'ongoing')

_items = Prefetch('items', queryset=None)


def _collection_prefetch(prefix=''):
    from .models import MediaCollectionItem
    return Prefetch(f'{prefix}items', queryset=MediaCollectionItem.objects.select_related('asset').order_by('order', 'id'))


def public_events():
    return Event.objects.exclude(status='draft')


def _with_card_media(qs):
    """Cards show `cover`, or the first gallery photo when the builder only filled the gallery."""
    return qs.select_related('cover', 'media').prefetch_related(_collection_prefetch('media__'))


def upcoming_events(*, q=None, type=None, audience=None, free=None, city=None):
    qs = _with_card_media(public_events().filter(status__in=UPCOMING_STATUSES, ends_at__gte=timezone.now()))
    if q:
        qs = qs.filter(Q(title__icontains=q) | Q(promise__icontains=q))
    if type:
        qs = qs.filter(type=type)
    if audience:
        qs = qs.filter(audience=audience)
    if free is True:
        qs = qs.filter(price_paise=0)
    elif free is False:
        qs = qs.filter(price_paise__gt=0)
    if city:
        qs = qs.filter(city__iexact=city)
    return qs.order_by('starts_at', 'slug')


def past_events(*, q=None, type=None):
    qs = _with_card_media(public_events().filter(status='completed'))
    if q:
        qs = qs.filter(Q(title__icontains=q) | Q(promise__icontains=q))
    if type:
        qs = qs.filter(type=type)
    return qs.order_by('-starts_at', 'slug')


def event_by_slug(slug, *, include_drafts=False):
    """`include_drafts` is only for a valid, entity-scoped preview key (content.preview)."""
    if not v.is_slug(slug):
        return None
    base = Event.objects.all() if include_drafts else public_events()
    return (base.filter(slug=slug)
            .select_related('cover', 'media', 'archive_gallery')
            .prefetch_related(_collection_prefetch('media__'), _collection_prefetch('archive_gallery__'))
            .first())


def event_for_availability(slug):
    if not v.is_slug(slug):
        return None
    return public_events().filter(slug=slug).first()


def published_section(key):
    if key not in v.SITE_KEYS:
        return None
    return SiteSection.objects.filter(key=key, status='published').first()


def collections_for(content):
    keys = set(v.collect_collection_refs(content))
    qs = MediaCollection.objects.filter(key__in=keys).prefetch_related(_collection_prefetch())
    return {c.key: c for c in qs}


def published_stories():
    return Story.objects.filter(status='published').select_related('cover').order_by('-published_on', 'slug')


def story_by_slug(slug, *, include_drafts=False):
    if not v.is_slug(slug):
        return None
    base = Story.objects.select_related('cover') if include_drafts else published_stories()
    return base.filter(slug=slug).first()


def published_testimonials():
    return (Testimonial.objects.filter(published=True, portrait__isnull=False, consent_at__isnull=False)
            .select_related('portrait').order_by('sort_order', 'created_at')[:24])


def legal_page(page):
    if page not in v.LEGAL_PAGES:
        return None
    return LegalPage.objects.filter(page=page).first()


FIXED_PAGES = ['/', '/play', '/past-events', '/community', '/stories', '/contact', '/privacy', '/terms',
               '/refund-policy']


def sitemap_entries():
    """Fixed pages, then public events (cancelled ones kept and marked), then published stories."""
    latest = {}
    for key, model, field in (('site', SiteSection, 'updated_at'), ('legal', LegalPage, 'updated_at')):
        latest[key] = model.objects.order_by(f'-{field}').values_list(field, flat=True).first()
    now = timezone.now()
    base = max([d for d in latest.values() if d], default=now)
    entries = [{'type': 'page', 'path': p, 'updatedAt': base} for p in FIXED_PAGES]
    for slug, status, updated in public_events().order_by('starts_at', 'slug').values_list('slug', 'status', 'updated_at'):
        entry = {'type': 'event', 'slug': slug, 'updatedAt': updated}
        if status == 'cancelled':
            entry['cancelled'] = True
        entries.append(entry)
    for slug, updated in published_stories().values_list('slug', 'updated_at'):
        entries.append({'type': 'story', 'slug': slug, 'updatedAt': updated})
    return entries
