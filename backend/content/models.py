"""Public content models (contract 3.1, 3.9, 3.10, OD-06).

JSON fields are validated on every write (`save()` runs `clean_content()`), against the shapes the frontend zod schemas
accept (see content/validation.py). No HTML is stored. `version` is a monotonic BIGINT bumped on every change.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models, transaction
from django.utils import timezone

from . import validation as v

slug_validator = RegexValidator(
    v.SLUG_PATTERN, "Use lowercase letters, digits and single hyphens."
)
MAX_PAISE = 100_000_000


def run_checker(checker, value, field):
    try:
        checker(value, field)
    except v.ContentError as exc:
        raise ValidationError({field: exc.messages}) from None


class VersionedModel(models.Model):
    """Adds `version` (BIGINT, monotonic: 1 on insert, +1 on every later save) and `updated_at`."""

    version = models.BigIntegerField(default=1, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True

    def clean_content(self):  # overridden
        pass

    def save(self, *args, **kwargs):
        self.clean_content()
        if self._state.adding:
            self.version = 1
        else:
            self.version = (self.version or 0) + 1
            update_fields = kwargs.get("update_fields")
            if update_fields is not None:
                kwargs["update_fields"] = list(
                    set(update_fields) | {"version", "updated_at"}
                )
        # One transaction for the row and the post_save signal that writes its revalidation outbox row.
        with transaction.atomic(using=kwargs.get("using")):
            super().save(*args, **kwargs)


class SlugLockedMixin(models.Model):
    """Slug is immutable once the row has been published for the first time (FR-03, contract 2.7)."""

    first_published_at = models.DateTimeField(null=True, blank=True, editable=False)

    class Meta:
        abstract = True

    def check_slug_lock(self):
        if self._state.adding or self.first_published_at is None:
            return
        previous = (
            type(self).objects.filter(pk=self.pk).values_list("slug", flat=True).first()
        )
        if previous is not None and previous != self.slug:
            raise ValidationError(
                {"slug": "The slug cannot change after the first publish."}
            )


# ---------------------------------------------------------------- media


class MediaAsset(VersionedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    src = models.CharField(max_length=2048)
    alt = models.CharField(max_length=300, blank=True)
    decorative = models.BooleanField(default=False)
    width = models.PositiveIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(20000)]
    )
    height = models.PositiveIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(20000)]
    )
    focal_x = models.FloatField(
        default=0.5, validators=[MinValueValidator(0), MaxValueValidator(1)]
    )
    focal_y = models.FloatField(
        default=0.5, validators=[MinValueValidator(0), MaxValueValidator(1)]
    )
    blur_data_url = models.TextField(blank=True, max_length=4096)
    # Storage bookkeeping and editorial fields (BE-07). Legacy/seeded assets have an empty storage_key.
    storage_key = models.CharField(max_length=300, blank=True)
    content_type = models.CharField(max_length=40, blank=True)
    size_bytes = models.PositiveIntegerField(default=0)
    original_filename = models.CharField(max_length=200, blank=True)
    credit = models.CharField(max_length=200, blank=True)
    archived = models.BooleanField(default=False, db_index=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    def __str__(self):
        return self.alt[:60] or self.src

    def clean_content(self):
        try:
            # Missing alt warns but does not block (FEAT-001 OQ-12): validate the rest of the row with a stand-in alt.
            v.check_media_fields(
                self.src,
                self.alt or "x",
                self.decorative,
                self.width,
                self.height,
                self.focal_x,
                self.focal_y,
                self.blur_data_url,
            )
        except v.ContentError as exc:
            raise ValidationError({"src": exc.messages}) from None


class MediaCollection(VersionedModel):
    MODES = [("static", "static"), ("carousel", "carousel")]
    key = models.SlugField(max_length=100, unique=True)
    name = models.CharField(max_length=120, blank=True)
    mode = models.CharField(max_length=10, choices=MODES, default="static")
    autoplay = models.BooleanField(default=False)
    interval_ms = models.PositiveIntegerField(
        default=6000, validators=[MinValueValidator(2000), MaxValueValidator(60000)]
    )

    def __str__(self):
        return self.key


class MediaUpload(models.Model):
    """A signed upload that has been issued (S07). `id` becomes the MediaAsset id when S08 completes it.
    The object key is random and never derived from the client's filename."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    storage_key = models.CharField(max_length=300, unique=True)
    original_filename = models.CharField(max_length=200)
    content_type = models.CharField(max_length=40)
    size_bytes = models.PositiveIntegerField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    class Meta:
        indexes = [
            models.Index(
                fields=["created_by", "expires_at"], name="media_upload_user_exp"
            )
        ]


class MediaCollectionItem(models.Model):
    collection = models.ForeignKey(
        MediaCollection, on_delete=models.CASCADE, related_name="items"
    )
    asset = models.ForeignKey(MediaAsset, on_delete=models.PROTECT, related_name="+")
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["collection", "order"], name="uniq_collection_item_order"
            )
        ]


# ---------------------------------------------------------------- events

UNLIMITED_PLACES = (
    100000  # public sentinel for "no capacity limit" (max of the web placesLeft schema)
)


class Event(SlugLockedMixin, VersionedModel):
    TYPES = [(x, x) for x in v.EVENT_TYPES]
    AUDIENCES = [(x, x) for x in v.EVENT_AUDIENCES]
    PAIRING = [(x, x) for x in v.PAIRING_MODES]
    POOLS = [(x, x) for x in v.RATING_POOLS]
    STATUSES = [
        (x, x)
        for x in [
            "draft",
            "published",
            "registration_open",
            "sold_out",
            "ongoing",
            "completed",
            "cancelled",
        ]
    ]
    TRANSITIONS = {
        "draft": ["published"],
        "published": ["registration_open", "cancelled"],
        "registration_open": ["sold_out", "ongoing", "cancelled"],
        "sold_out": ["registration_open", "ongoing", "cancelled"],
        "ongoing": ["completed"],
        "completed": [],
        "cancelled": [],
    }

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # A builder draft may be incomplete (E02): slug, dates and capacity are nullable until publish; publish readiness
    # (adminapi.event_builder.readiness) guarantees they are set on every public event.
    slug = models.CharField(
        max_length=100, unique=True, null=True, blank=True, validators=[slug_validator]
    )
    title = models.CharField(max_length=120)
    promise = models.CharField(max_length=200, blank=True, default="")
    arrival_promise = models.CharField(max_length=400, blank=True, default="")
    description = models.TextField(max_length=4000, blank=True, default="")
    type = models.CharField(max_length=20, choices=TYPES)
    audience = models.CharField(max_length=20, choices=AUDIENCES, default="all_levels")
    status = models.CharField(
        max_length=20, choices=STATUSES, default="draft", db_index=True
    )
    pairing_mode = models.CharField(max_length=20, choices=PAIRING, default="none")

    starts_at = models.DateTimeField(null=True, blank=True, db_index=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    area = models.CharField(max_length=80, blank=True, default="")
    city = models.CharField(max_length=80, blank=True, default="", db_index=True)
    venue_name = models.CharField(max_length=120, blank=True, default="")
    address = models.CharField(max_length=300, blank=True, default="")
    format = models.CharField(max_length=60, blank=True, default="")
    time_control = models.CharField(max_length=60, blank=True, default="")

    price_paise = models.PositiveIntegerField(
        default=0, validators=[MaxValueValidator(MAX_PAISE)]
    )
    capacity = models.PositiveIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(100000)],
    )
    # Registrations do not exist yet: availability derives from this integer. The registration slice must keep it
    # equal to the number of CONFIRMED registrations (and then replace it with a count query).
    confirmed_count = models.PositiveIntegerField(default=0)
    registration_opens_at = models.DateTimeField(null=True, blank=True)
    registration_closes_at = models.DateTimeField(null=True, blank=True)
    waitlist_enabled = models.BooleanField(default=False)
    first_timer_count = models.PositiveIntegerField(default=0)
    rated = models.BooleanField(default=False)
    rating_pool = models.CharField(max_length=20, choices=POOLS, blank=True)

    # Event Builder steps (BE-04). `at_a_glance` / `experience` JSON keep the public shapes; these hold the rest.
    ask_first_timer = models.BooleanField(default=True)
    min_age = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MaxValueValidator(120)]
    )
    refund_window_hours = models.PositiveIntegerField(
        null=True, blank=True, validators=[MaxValueValidator(24 * 60)]
    )
    hold_minutes = models.PositiveSmallIntegerField(
        default=10, validators=[MinValueValidator(1), MaxValueValidator(60)]
    )
    rounds_planned = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(20)]
    )
    media_mode = models.CharField(
        max_length=10,
        choices=[("static", "static"), ("carousel", "carousel")],
        default="static",
    )
    communications = models.JSONField(default=dict, blank=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    last_change_summary = models.CharField(max_length=300, blank=True, default="")

    experience = models.JSONField(default=dict)
    at_a_glance = models.JSONField(default=dict)
    faq = models.JSONField(default=list, blank=True)
    logistics = models.JSONField(default=list, blank=True)

    cover = models.ForeignKey(
        MediaAsset, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    media = models.ForeignKey(
        MediaCollection,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="+",
    )

    cancelled_reason = models.CharField(max_length=500, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    archive_published = models.BooleanField(default=False)
    archive_published_at = models.DateTimeField(null=True, blank=True)
    recap = models.TextField(blank=True, max_length=4000)
    winner = models.JSONField(null=True, blank=True)
    standings = models.JSONField(default=list, blank=True)
    rounds_played = models.PositiveSmallIntegerField(
        default=0, validators=[MaxValueValidator(100)]
    )
    archive_gallery = models.ForeignKey(
        MediaCollection,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="+",
    )

    class Meta:
        ordering = ["starts_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(ends_at__gt=models.F("starts_at")),
                name="event_ends_after_start",
            ),
        ]
        indexes = [
            models.Index(fields=["status", "starts_at"], name="event_status_start_idx")
        ]

    def __str__(self):
        return self.slug or self.title

    @property
    def is_public(self):
        return self.status != "draft"

    def clean_content(self):
        draft = self.status == "draft"
        if self.slug is None and not draft:
            raise ValidationError({"slug": "A public event needs a slug."})
        if self.slug is not None and not v.is_slug(self.slug):
            raise ValidationError({"slug": "Invalid slug."})
        self.check_slug_lock()
        if not draft:  # a builder draft may hold incomplete copy; the publish blockers say what is missing
            run_checker(v.check_experience, self.experience, "experience")
            run_checker(v.check_at_a_glance, self.at_a_glance, "at_a_glance")
        run_checker(v.check_faq, self.faq, "faq")
        run_checker(v.check_logistics, self.logistics, "logistics")
        run_checker(v.check_standings, self.standings, "standings")
        if self.winner is not None:
            run_checker(v.check_identity, self.winner, "winner")
        if self.rated and not self.rating_pool and not draft:
            raise ValidationError({"rating_pool": "A rated event needs a rating pool."})
        if self.ends_at and self.starts_at and self.ends_at <= self.starts_at:
            raise ValidationError({"ends_at": "Must be after the start."})
        if self.status == "cancelled" and not self.cancelled_reason:
            raise ValidationError(
                {"cancelled_reason": "A cancelled event needs a reason."}
            )
        if self.status != "draft" and self.first_published_at is None:
            self.first_published_at = timezone.now()

    # ---- derived, read-only (no side effects) ----
    @property
    def places_left(self):
        """Places still free, or None when capacity is unlimited (capacity null)."""
        if self.capacity is None:
            return None
        return max(0, self.capacity - self.confirmed_count)

    def availability(self, now=None):
        """-> (state, placesLeft, waitlistOpen) per event-state.ts. Pure function of the row and the clock."""
        now = now or timezone.now()
        raw_left = self.places_left
        unlimited = raw_left is None
        left = (
            UNLIMITED_PLACES if unlimited else raw_left
        )  # sentinel keeps the public schema (int 0..100000) valid
        if self.status == "cancelled":
            return "cancelled", left, False
        if self.status == "completed":
            return "completed", left, False
        if self.status == "ongoing" or (
            self.registration_closes_at and now > self.registration_closes_at
        ):
            return "closed", left, False
        if self.status == "published" or (
            self.registration_opens_at and now < self.registration_opens_at
        ):
            return "not_yet_open", left, False
        if unlimited or (left > 0 and self.status != "sold_out"):
            return "open", left, False
        if self.waitlist_enabled:
            return "full_waitlist", 0, True
        return "sold_out", 0, False


# ---------------------------------------------------------------- site sections


class SiteSection(VersionedModel):
    KEYS = [(x, x) for x in v.SITE_KEYS]
    STATUSES = [("draft", "draft"), ("published", "published")]
    key = models.CharField(max_length=20, unique=True, choices=KEYS)
    status = models.CharField(max_length=10, choices=STATUSES, default="draft")
    content = models.JSONField(default=dict)
    first_published_at = models.DateTimeField(null=True, blank=True, editable=False)

    def __str__(self):
        return self.key

    @property
    def is_public(self):
        return self.status == "published"

    def clean_content(self):
        if self.key not in v.SITE_KEYS:
            raise ValidationError({"key": "Unknown section."})
        exists = lambda k: MediaCollection.objects.filter(key=k).exists()  # noqa: E731
        run_checker(v.site_section_checker(self.key, exists), self.content, "content")
        if self.status == "published" and self.first_published_at is None:
            self.first_published_at = timezone.now()


class ContentDraft(models.Model):
    """Unpublished working copy of a site section or legal page (S02/S03/S06). The live copy stays in SiteSection /
    LegalPage, so public reads never see a draft. `version` is the editor's optimistic-lock counter: it only ever
    grows, and 0 means "no draft yet" (a row is created lazily by the first save and kept after publish)."""

    KINDS = [("site", "site"), ("legal", "legal")]
    kind = models.CharField(max_length=10, choices=KINDS)
    key = models.CharField(max_length=40)
    content = models.JSONField(default=dict)
    version = models.BigIntegerField(default=0)
    change_summary = models.CharField(max_length=300, blank=True, default="")
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["kind", "key"], name="uniq_content_draft")
        ]

    def __str__(self):
        return f"{self.kind}/{self.key}"


class ContentVersion(models.Model):
    """Immutable publish history (`cms_versions`): the exact content that went live, numbered per kind and key."""

    kind = models.CharField(max_length=10, choices=ContentDraft.KINDS)
    key = models.CharField(max_length=40)
    number = models.PositiveIntegerField()
    content = models.JSONField()
    summary = models.CharField(max_length=300, blank=True, default="")
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    published_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-number"]
        constraints = [
            models.UniqueConstraint(
                fields=["kind", "key", "number"], name="uniq_content_version"
            )
        ]

    def __str__(self):
        return f"{self.kind}/{self.key} v{self.number}"


# ---------------------------------------------------------------- stories


class Story(SlugLockedMixin, VersionedModel):
    KINDS = [(x, x) for x in v.STORY_KINDS]
    STATUSES = [("draft", "draft"), ("published", "published")]
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.CharField(max_length=100, unique=True, validators=[slug_validator])
    kind = models.CharField(max_length=20, choices=KINDS)
    eyebrow = models.CharField(max_length=60)
    title = models.CharField(max_length=160)
    dek = models.CharField(max_length=300)
    published_on = models.DateField()
    reading_minutes = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(120)]
    )
    featured = models.BooleanField(default=False)
    cover = models.ForeignKey(
        MediaAsset, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    # The story's media collection (web `collectionId`, S12). Optional; not part of the public story DTO.
    collection = models.ForeignKey(
        MediaCollection,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="stories",
    )
    body = models.JSONField(default=list)
    status = models.CharField(
        max_length=10, choices=STATUSES, default="draft", db_index=True
    )

    class Meta:
        ordering = ["-published_on", "slug"]
        verbose_name_plural = "stories"

    def __str__(self):
        return self.slug

    @property
    def is_public(self):
        return self.status == "published"

    def clean_content(self):
        if not v.is_slug(self.slug):
            raise ValidationError({"slug": "Invalid slug."})
        self.check_slug_lock()
        run_checker(v.check_blocks, self.body, "body")
        if self.status == "published" and self.first_published_at is None:
            self.first_published_at = timezone.now()


# ---------------------------------------------------------------- testimonials


class Testimonial(VersionedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    quote = models.CharField(max_length=600)
    name = models.CharField(max_length=80)
    descriptor = models.CharField(max_length=120)
    portrait = models.ForeignKey(
        MediaAsset, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    consent_at = models.DateTimeField(
        null=True, blank=True, help_text="When the person agreed to be quoted."
    )
    published = models.BooleanField(default=False)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "created_at"]

    def __str__(self):
        return self.name

    @property
    def is_public(self):
        return self.published

    def clean_content(self):
        if self.published:
            missing = [
                n
                for n, ok in (
                    ("quote", bool(self.quote.strip())),
                    ("portrait", self.portrait_id is not None),
                    ("consent_at", self.consent_at is not None),
                )
                if not ok
            ]
            if missing:
                raise ValidationError(
                    {"published": f"Cannot publish without: {', '.join(missing)}."}
                )


# ---------------------------------------------------------------- legal


class LegalPage(VersionedModel):
    PAGES = [(x, x) for x in v.LEGAL_PAGES]
    page = models.CharField(max_length=20, unique=True, choices=PAGES)
    title = models.CharField(max_length=120)
    blocks = models.JSONField(default=list)
    effective_date = models.DateField()

    def __str__(self):
        return self.page

    is_public = True

    def clean_content(self):
        run_checker(v.check_blocks, self.blocks, "blocks")


# ---------------------------------------------------------------- settings, contact


class PublicSettings(models.Model):
    """Singleton (pk=1): non-secret contact configuration (P12)."""

    support_email = models.EmailField(max_length=254)
    desk_contact_href = models.CharField(
        max_length=2048, blank=True, help_text="WhatsApp or phone link, optional."
    )
    social = models.JSONField(default=list, blank=True)
    default_city = models.CharField(max_length=80, default="Hyderabad")
    version = models.BigIntegerField(default=1, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "public settings"

    def save(self, *args, **kwargs):
        self.pk = 1
        if self.desk_contact_href and not v.is_safe_href(self.desk_contact_href):
            raise ValidationError(
                {"desk_contact_href": "Must be an http, https, mailto or tel URL."}
            )
        run_checker(v.check_social, self.social, "social")
        if not PublicSettings.objects.filter(pk=1).exists():
            self.version = 1
        else:
            self.version = (self.version or 0) + 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        return cls.objects.filter(pk=1).first()

    def __str__(self):
        return "Public settings"


class AdminSettings(models.Model):
    """Singleton (pk=1): admin-editable NON-SECRET settings (G07/G08). `values` holds only allow-listed overrides,
    keyed `group.field`. The brand contact fields live in PublicSettings (one source for P12). Never stores secrets."""

    values = models.JSONField(default=dict, blank=True)
    version = models.BigIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    class Meta:
        verbose_name_plural = "admin settings"
        db_table = "admin_settings"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    def __str__(self):
        return "Admin settings"


class ContactMessage(models.Model):
    """Stored contact submissions (P11). Private: never exposed by a public endpoint."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=80)
    email = models.EmailField(max_length=254)
    topic = models.CharField(max_length=20, choices=[(x, x) for x in v.CONTACT_TOPICS])
    message = models.TextField(max_length=2000)
    idempotency_key = models.UUIDField(null=True, blank=True, unique=True)
    request_hash = models.CharField(max_length=64, blank=True)
    ip_hash = models.CharField(max_length=64, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    # Delivery to the configured destination (comms.delivery). Stored first; the worker (or one attempt right after the
    # request) sends it. `delivery_error` is a short reason code, never provider text.
    DELIVERY_STATES = [(s, s) for s in ("pending", "sent", "failed", "skipped")]
    delivery_state = models.CharField(
        max_length=8, choices=DELIVERY_STATES, default="pending"
    )
    delivery_attempts = models.PositiveSmallIntegerField(default=0)
    next_attempt_at = models.DateTimeField(default=timezone.now)
    delivered_at = models.DateTimeField(null=True, blank=True)
    delivery_error = models.CharField(max_length=60, blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["delivery_state", "next_attempt_at"],
                name="contact_delivery_due_idx",
            )
        ]

    def __str__(self):
        return f"{self.topic} {self.created_at:%Y-%m-%d}"


# ---------------------------------------------------------------- preview (PV01, exchange)


class PreviewGrant(models.Model):
    """Single-use preview link token (`purpose='link'`, 5 min) or the short-lived read key it is exchanged for
    (`purpose='key'`, 5 min). Only the SHA-256 of the secret is stored. A grant names one entity (`kind` + `ref`)."""

    PURPOSES = [("link", "link"), ("key", "key")]
    KINDS = [
        ("event", "event"),
        ("story", "story"),
        ("site", "site"),
        ("legal", "legal"),
    ]
    token_hash = models.CharField(max_length=64, unique=True)
    purpose = models.CharField(max_length=4, choices=PURPOSES)
    kind = models.CharField(max_length=10, choices=KINDS)
    ref = models.CharField(max_length=64)
    path = models.CharField(max_length=200)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(db_index=True)
    used_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.purpose}:{self.kind}/{self.ref}"


# ---------------------------------------------------------------- revalidation outbox


class RevalidationOutbox(models.Model):
    """One row per publish-relevant change (contract 3.10). `event_id` is stable across retries."""

    STATUSES = [
        ("pending", "pending"),
        ("delivered", "delivered"),
        ("failed", "failed"),
        ("skipped", "skipped"),
    ]
    event_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    type = models.CharField(max_length=20)
    action = models.CharField(max_length=20)
    entity_id = models.CharField(max_length=64)
    slug = models.CharField(max_length=100, blank=True)
    entity_version = models.BigIntegerField(default=0)
    occurred_at = models.DateTimeField(default=timezone.now)
    status = models.CharField(
        max_length=10, choices=STATUSES, default="pending", db_index=True
    )
    attempts = models.PositiveSmallIntegerField(default=0)
    next_attempt_at = models.DateTimeField(default=timezone.now)
    last_status_code = models.PositiveSmallIntegerField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["id"]
        indexes = [
            models.Index(fields=["status", "next_attempt_at"], name="outbox_due_idx")
        ]

    def __str__(self):
        return f"{self.type}/{self.action} {self.slug or self.entity_id}"
