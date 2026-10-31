"""Write-time validation of JSON content, mirroring the zod schemas in web/src/lib/api/types.

The frontend schemas are the spec for response shapes. These checkers REJECT (never sanitise) anything that would not
parse there. No HTML is accepted anywhere: every string is plain text. A checker is `check(value, path)` and raises
`ContentError` carrying "path: message" strings.
"""
from __future__ import annotations

import re
from urllib.parse import urlsplit

SLUG_PATTERN = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
SLUG_MAX_LENGTH = 100
_BLUR = re.compile(r'^data:image/(?:png|jpeg|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$')
_SAFE_SCHEMES = {'http', 'https', 'mailto', 'tel'}
_MAX_URL = 2048
_HTML = re.compile(r'<\s*[a-zA-Z/!]')

EVENT_TYPES = ['social', 'rated_tournament', 'league', 'workshop', 'special']
EVENT_AUDIENCES = ['all_levels', 'beginner', 'solo']
PAIRING_MODES = ['social_balanced', 'swiss', 'round_robin', 'none']
RATING_POOLS = ['blitz', 'rapid', 'classical']
STORY_KINDS = ['club_notes', 'event_notes', 'rivalries']
CONTACT_TOPICS = ['joining_event', 'partnership', 'payment', 'other']
SITE_KEYS = ['home', 'community', 'nav', 'footer', 'meta']
LEGAL_PAGES = ['privacy', 'terms', 'refund-policy']


class ContentError(Exception):
    def __init__(self, messages):
        self.messages = list(messages)
        super().__init__('; '.join(self.messages))


def _fail(path, msg):
    raise ContentError([f'{path or "value"}: {msg}'])


def is_slug(value) -> bool:
    return isinstance(value, str) and len(value) <= SLUG_MAX_LENGTH and bool(SLUG_PATTERN.match(value))


def _has_forbidden(value: str) -> bool:
    return any(ord(c) <= 0x20 or 0x7F <= ord(c) <= 0x9F or c == '\\' for c in value)


def is_safe_href(value) -> bool:
    if not isinstance(value, str) or not value or len(value) > _MAX_URL or _has_forbidden(value):
        return False
    try:
        parts = urlsplit(value)
        _ = parts.port
    except ValueError:
        return False
    if parts.scheme not in _SAFE_SCHEMES:
        return False
    if parts.scheme in ('http', 'https'):
        return bool(parts.hostname) and parts.username is None and parts.password is None
    return True


def is_internal_path(value) -> bool:
    if not isinstance(value, str) or not value or len(value) > _MAX_URL or _has_forbidden(value):
        return False
    if not value.startswith('/') or value.startswith('//'):
        return False
    path_only = re.split(r'[?#]', value, maxsplit=1)[0]
    return not any(seg in ('.', '..') for seg in path_only.split('/'))


def is_media_src(value) -> bool:
    if is_internal_path(value):
        return True
    if not isinstance(value, str) or not is_safe_href(value):
        return False
    parts = urlsplit(value)
    return parts.scheme == 'https' and not parts.query


# ---------- combinators ----------

def text(max_len, min_len=1, nullable=False):
    def check(value, path):
        if value is None and nullable:
            return
        if not isinstance(value, str):
            _fail(path, 'must be a string')
        if len(value.strip()) < min_len or len(value) > max_len:
            _fail(path, f'length must be {min_len}..{max_len}')
        if _HTML.search(value):
            _fail(path, 'HTML is not allowed')
    return check


def boolean():
    def check(value, path):
        if not isinstance(value, bool):
            _fail(path, 'must be a boolean')
    return check


def integer(lo, hi):
    def check(value, path):
        if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
            _fail(path, f'must be an integer {lo}..{hi}')
    return check


def number(lo, hi, step=None):
    def check(value, path):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not lo <= value <= hi:
            _fail(path, f'must be a number {lo}..{hi}')
        if step and (value / step) != int(value / step):
            _fail(path, f'must be a multiple of {step}')
    return check


def enum(options):
    def check(value, path):
        if value not in options:
            _fail(path, f'must be one of {options}')
    return check


def literal(expected):
    def check(value, path):
        if value != expected or type(value) is not type(expected):
            _fail(path, f'must be {expected!r}')
    return check


def link():
    def check(value, path):
        if not (is_safe_href(value) or is_internal_path(value)):
            _fail(path, 'must be a safe URL or a site path')
    return check


def safe_href():
    def check(value, path):
        if not is_safe_href(value):
            _fail(path, 'must be an http, https, mailto or tel URL')
    return check


def nullable(inner):
    def check(value, path):
        if value is not None:
            inner(value, path)
    return check


def arr(item, min_len=0, max_len=1000):
    def check(value, path):
        if not isinstance(value, list):
            _fail(path, 'must be a list')
        if not min_len <= len(value) <= max_len:
            _fail(path, f'must have {min_len}..{max_len} items')
        errors = []
        for i, element in enumerate(value):
            try:
                item(element, f'{path}[{i}]')
            except ContentError as exc:
                errors.extend(exc.messages)
        if errors:
            raise ContentError(errors)
    return check


def obj(required=None, optional=None):
    required = required or {}
    optional = optional or {}

    def check(value, path):
        if not isinstance(value, dict):
            _fail(path, 'must be an object')
        errors = []
        for key in value:
            if key not in required and key not in optional:
                errors.append(f'{path}.{key}: unknown field')
        for key, checker in required.items():
            if key not in value:
                errors.append(f'{path}.{key}: required')
                continue
            try:
                checker(value[key], f'{path}.{key}')
            except ContentError as exc:
                errors.extend(exc.messages)
        for key, checker in optional.items():
            if key in value:
                try:
                    checker(value[key], f'{path}.{key}')
                except ContentError as exc:
                    errors.extend(exc.messages)
        if errors:
            raise ContentError(errors)
    return check


def one_of_type(variants, discriminator='type'):
    def check(value, path):
        if not isinstance(value, dict) or value.get(discriminator) not in variants:
            _fail(path, f'{discriminator} must be one of {sorted(variants)}')
        variants[value[discriminator]](value, path)
    return check


# ---------- media ----------

def _focal(value, path):
    obj({'x': number(0, 1), 'y': number(0, 1)})(value, path)


def _blur(value, path):
    if not isinstance(value, str) or len(value) > 4096 or not _BLUR.match(value):
        _fail(path, 'must be a small inline image data URL')


def _media_src(value, path):
    if not is_media_src(value):
        _fail(path, 'media URL must be a site path or an https URL without a query')


_media_base = {'src': _media_src, 'width': integer(1, 20000), 'height': integer(1, 20000), 'focal': _focal}


def media_ref():
    """Inline media object as it appears in public DTOs (decorative/alt union). Used by story image blocks."""
    def check(value, path):
        if not isinstance(value, dict) or not isinstance(value.get('decorative'), bool):
            _fail(path, 'decorative flag required')
        if value['decorative']:
            obj({**_media_base, 'decorative': literal(True), 'alt': literal('')}, {'blurDataUrl': _blur})(value, path)
        else:
            obj({**_media_base, 'decorative': literal(False), 'alt': text(300)}, {'blurDataUrl': _blur})(value, path)
    return check


def check_media_fields(src, alt, decorative, width, height, fx, fy, blur):
    """Validate the columns of a MediaAsset row (same rules as the public MediaRef)."""
    value = {'src': src, 'width': width, 'height': height, 'focal': {'x': fx, 'y': fy},
             'decorative': bool(decorative), 'alt': '' if decorative else alt}
    if blur:
        value['blurDataUrl'] = blur
    media_ref()(value, 'media')


def collection_ref(exists=None):
    """A media collection reference `{"collection": key}` resolved at read time."""
    def check(value, path):
        obj({'collection': text(100)})(value, path)
        if exists is not None and not exists(value['collection']):
            _fail(path, 'unknown media collection')
    return check


# ---------- content blocks (closed model) ----------

def _blocks():
    t = text
    variants = {
        'heading': obj({'type': literal('heading'), 'level': enum([2, 3]), 'text': t(200)}),
        'paragraph': obj({'type': literal('paragraph'), 'text': t(4000)}),
        'quote': obj({'type': literal('quote'), 'text': t(1000)}, {'attribution': t(120)}),
        'image': obj({'type': literal('image'), 'media': media_ref()}, {'caption': t(300)}),
        'list': obj({'type': literal('list'), 'ordered': boolean(), 'items': arr(t(500), 1, 50)}),
        'link': obj({'type': literal('link'), 'label': t(120), 'href': link()}),
    }
    return arr(one_of_type(variants), 0, 200)


check_blocks = _blocks()


# ---------- event JSON fields ----------

_highlight = obj({'title': text(80), 'body': text(300)})
check_experience = obj({
    # eyebrow, heading, body are optional in the builder UI; allow empty strings so an event can publish
    # without filling them in.
    'eyebrow': text(60, min_len=0), 'heading': text(160, min_len=0), 'body': text(1200, min_len=0),
    'highlights': arr(_highlight, 0, 8),
})
check_faq = arr(obj({'question': text(200), 'answer': text(1500)}), 0, 20)
check_logistics = arr(text(400), 0, 12)
check_at_a_glance = obj({'membershipRequired': boolean(), 'hostedArrival': boolean()})

_rating = nullable(obj({'pool': enum(RATING_POOLS), 'value': integer(0, 4000)}))
check_identity = obj({
    'displayName': text(80), 'initials': text(3), 'rating': _rating, 'cityChapter': text(80, nullable=True),
}, optional={
    # Opaque public profile slug (null when the player is not linkable). Optional: snapshots from before it existed omit it.
    'publicId': text(16, min_len=12, nullable=True),
})
check_standings = arr(obj({
    'place': integer(1, 10 ** 6),
    'identity': check_identity,
    'score': number(0, 200, 0.5),
    'rounds': integer(0, 100),
    'rating': _rating,
}), 0, 500)
check_social = arr(obj({'label': text(40), 'href': safe_href()}), 0, 8)


# ---------- site sections ----------

def site_section_checker(key, collection_exists=None):
    media = collection_ref(collection_exists)
    cta = obj({'label': text(60), 'href': link()})
    eyebrow, headline, body = text(60), text(160), text(1200)
    title_body = obj({'title': text(80), 'body': text(400)})
    block = {'eyebrow': eyebrow, 'headline': headline, 'body': body, 'media': media}
    nav_item = obj({'label': text(40), 'href': link()})
    shapes = {
        'home': obj({
            'hero': obj({
                'eyebrow': eyebrow, 'headlineLine1': text(80), 'headlineAccent': text(80), 'lead': text(200),
                'body': body, 'proofPoints': arr(text(60), 0, 6), 'primaryCta': cta, 'secondaryCta': cta,
                'media': media,
            }),
            'upcoming': obj({'eyebrow': eyebrow, 'title': text(100), 'intro': text(300), 'cta': cta}),
            'firstVisit': obj({
                'eyebrow': eyebrow, 'headline': headline, 'body': body, 'cta': cta,
                'promises': arr(title_body, 4, 4), 'media': media,
            }),
            'stands': obj({
                'eyebrow': eyebrow, 'headline': headline, 'body': body,
                'principles': arr(title_body, 3, 3), 'media': media,
            }),
            'moreThanAGame': obj({**block, 'cta': cta}),
            'finalCta': obj({**block, 'cta': cta}),
        }),
        'community': obj({
            'hero': obj({'eyebrow': eyebrow, 'headline': headline, 'lead': text(400), 'media': media}),
            'principles': arr(title_body, 1, 6),
            'hospitality': obj({'eyebrow': eyebrow, 'headline': headline, 'body': body, 'cta': cta}),
        }),
        'nav': obj({'primary': arr(nav_item, 1, 8), 'authCta': cta}),
        'footer': obj({
            'tagline': text(120),
            'links': arr(nav_item, 0, 12),
            'social': arr(obj({'label': text(40), 'href': safe_href()}), 0, 8),
            'legalNote': text(200, nullable=True),
        }),
        'meta': obj({
            'siteName': text(60), 'titleTemplate': text(80), 'description': text(300), 'defaultCity': text(80),
        }),
    }
    return shapes[key]


def collect_collection_refs(value):
    """Yield every `{"collection": key}` reference found in a section's content."""
    if isinstance(value, dict):
        if set(value) == {'collection'} and isinstance(value['collection'], str):
            yield value['collection']
        else:
            for v in value.values():
                yield from collect_collection_refs(v)
    elif isinstance(value, list):
        for v in value:
            yield from collect_collection_refs(v)
