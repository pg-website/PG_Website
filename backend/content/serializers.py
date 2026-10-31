"""Public DTO builders. Output keys are camelCase and match the zod schemas in web/src/lib/api/types.

Only PUBLIC fields are emitted: no UUIDs for events/stories, no confirmed counts, no internal notes, no emails.
Input serializer for the contact form lives at the bottom.
"""
from __future__ import annotations

from rest_framework import serializers

from core.responses import iso

from . import validation as v
from .models import Event, MediaAsset, MediaCollection

EMPTY_COLLECTION = {'mode': 'static', 'autoplay': False, 'intervalMs': 6000, 'items': []}


def media_dto(asset: MediaAsset | None):
    if asset is None:
        return None
    # An image still missing alt text (allowed in the admin, with a warning) is exposed as decorative so the public
    # MediaRef stays valid and assistive tech skips it rather than reading an empty label.
    decorative = asset.decorative or not asset.alt
    dto = {
        'src': asset.src,
        'width': asset.width,
        'height': asset.height,
        'focal': {'x': asset.focal_x, 'y': asset.focal_y},
        'decorative': decorative,
        'alt': '' if decorative else asset.alt,
    }
    if asset.blur_data_url:
        dto['blurDataUrl'] = asset.blur_data_url
    return dto


def collection_dto(collection: MediaCollection | None):
    if collection is None:
        return dict(EMPTY_COLLECTION, items=[])
    return {
        'mode': collection.mode,
        'autoplay': collection.autoplay,
        'intervalMs': collection.interval_ms,
        'items': [media_dto(item.asset) for item in collection.items.all()],  # prefetched, ordered
    }


def resolve_collection_refs(value, collections: dict):
    """Replace every {"collection": key} reference in stored section content with the resolved collection."""
    if isinstance(value, dict):
        if set(value) == {'collection'} and isinstance(value['collection'], str):
            return collection_dto(collections.get(value['collection']))
        return {k: resolve_collection_refs(x, collections) for k, x in value.items()}
    if isinstance(value, list):
        return [resolve_collection_refs(x, collections) for x in value]
    return value


def site_section_dto(section, collections):
    return {
        'key': section.key,
        'version': section.version,
        'updatedAt': iso(section.updated_at),
        'content': resolve_collection_refs(section.content, collections),
    }


# ---------------------------------------------------------------- events

def _places_left_hint(event: Event):
    if event.status in ('completed', 'cancelled'):
        return None
    if event.places_left is None:
        return None  # unlimited: no scarcity hint
    return min(event.places_left, 100000)


def event_card_dto(event: Event):
    return {
        'slug': event.slug,
        'title': event.title,
        'promise': event.promise,
        'type': event.type,
        'audience': event.audience,
        'status': event.status,
        'startsAt': iso(event.starts_at),
        'endsAt': iso(event.ends_at),
        'area': event.area,
        'city': event.city,
        'format': event.format,
        'price': {'pricePaise': event.price_paise, 'currency': 'INR'},
        'rated': event.rated,
        'firstTimerCount': event.first_timer_count,
        'placesLeftHint': _places_left_hint(event),
        'cover': media_dto(event.cover),
        'archivePublished': event.archive_published,
        'version': event.version,
    }


def _event_media_dto(event: Event):
    dto = collection_dto(event.media)
    dto['mode'] = event.media_mode  # the event's own mode overrides the collection's
    return dto


def _linkable(identities):
    """Archive identities are frozen JSON, so re-check each `publicId` against the live visibility gate: a player who has
    since hidden their profile (or been suspended) loses the link instead of pointing at a 404."""
    from accounts.models import User
    from registrations.dto import public_id_for

    slugs = {i.get('publicId') for i in identities if i and i.get('publicId')}
    ok = {u.public_slug for u in User.objects.filter(public_slug__in=slugs) if public_id_for(u)} if slugs else set()
    return [None if i is None else {**i, 'publicId': i.get('publicId') if i.get('publicId') in ok else None}
            for i in identities]


def event_detail_dto(event: Event):
    archive = None
    if event.status == 'completed' and event.archive_published:
        standings = event.standings or []
        winner, *identities = _linkable([event.winner, *(row.get('identity') for row in standings)])
        archive = {
            'recap': event.recap or None,
            'winner': winner,
            'standings': [{**row, 'identity': identity} for row, identity in zip(standings, identities)],
            'gallery': collection_dto(event.archive_gallery) if event.archive_gallery_id else None,
            'roundsPlayed': event.rounds_played,
        }
    dto = event_card_dto(event)
    dto.update({
        'description': event.description,
        'venue': {'area': event.area, 'city': event.city, 'venueName': event.venue_name, 'address': event.address},
        'experience': event.experience,
        'atAGlance': {
            'format': event.format,
            'timeControl': event.time_control,
            'membershipRequired': bool(event.at_a_glance.get('membershipRequired', False)),
            'hostedArrival': bool(event.at_a_glance.get('hostedArrival', False)),
        },
        'pairingMode': event.pairing_mode,
        'rating': {'rated': True, 'pool': event.rating_pool} if event.rated else {'rated': False},
        'registration': {
            'opensAt': iso(event.registration_opens_at),
            'closesAt': iso(event.registration_closes_at),
            'waitlistEnabled': event.waitlist_enabled,
        },
        'logistics': event.logistics,
        'faq': event.faq,
        'media': _event_media_dto(event),
        'cancelled': ({'reason': event.cancelled_reason, 'cancelledAt': iso(event.cancelled_at or event.updated_at)}
                      if event.status == 'cancelled' else None),
        'archive': archive,
        'updatedAt': iso(event.updated_at),
    })
    return dto


def availability_dto(event: Event, now):
    state, left, waitlist = event.availability(now)
    dto = {'state': state, 'placesLeft': left, 'waitlistOpen': waitlist, 'serverNow': iso(now)}
    if event.capacity is None:
        dto['unlimited'] = True  # placesLeft is then the 100000 sentinel
    return dto


# ---------------------------------------------------------------- stories, testimonials, legal, settings

def story_card_dto(story):
    return {
        'slug': story.slug,
        'kind': story.kind,
        'title': story.title,
        'dek': story.dek,
        'publishedOn': story.published_on.isoformat(),
        'readingMinutes': story.reading_minutes,
        'featured': story.featured,
        'cover': media_dto(story.cover),
        'version': story.version,
    }


def story_detail_dto(story):
    dto = story_card_dto(story)
    dto.update({'eyebrow': story.eyebrow, 'body': story.body, 'updatedAt': iso(story.updated_at)})
    return dto


def testimonial_dto(t):
    return {
        'id': str(t.id), 'quote': t.quote, 'name': t.name, 'descriptor': t.descriptor,
        'portrait': media_dto(t.portrait), 'version': t.version,
    }


def legal_dto(page):
    return {
        'page': page.page,
        'title': page.title,
        'blocks': page.blocks,
        'effectiveDate': page.effective_date.isoformat(),
        'version': page.version,
    }


def public_settings_dto(s):
    return {
        'supportEmail': s.support_email,
        'deskContactHref': s.desk_contact_href or None,
        'social': s.social,
        'defaultCity': s.default_city,
    }


# ---------------------------------------------------------------- contact input

class ContactInputSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=80, trim_whitespace=True)
    email = serializers.EmailField(max_length=254)
    topic = serializers.ChoiceField(choices=v.CONTACT_TOPICS)
    message = serializers.CharField(max_length=2000, trim_whitespace=True)
    website = serializers.CharField(max_length=200, required=False, allow_blank=True, trim_whitespace=False)

    def validate_name(self, value):
        return self._plain(value)

    def validate_message(self, value):
        return self._plain(value)

    @staticmethod
    def _plain(value):
        if v._HTML.search(value):
            raise serializers.ValidationError('HTML is not allowed.')
        return value
