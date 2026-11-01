import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishReadinessSchema, capabilityFlagSchema } from '@/lib/api/types/admin/common'
import { auditEntrySchema } from '@/lib/api/types/admin/control-audit'
import { checkInDeskSchema, manualCheckInSchema } from '@/lib/api/types/admin/control-checkin'
import { messageDetailSchema, sendMessageSchema } from '@/lib/api/types/admin/control-messages'
import { registrationActionInputSchema } from '@/lib/api/types/admin/control-registrations'
import {
  adminRoundSchema,
  editPairingsSchema,
  finaliseResultSchema,
  resultCommandSchema,
} from '@/lib/api/types/admin/control-rounds'
import { saveCmsDraftSchema } from '@/lib/api/types/admin/cms'
import { dashboardSummarySchema } from '@/lib/api/types/admin/dashboard'
import { builderDraftSchema, cancelEventSchema, updateBuilderDraftSchema } from '@/lib/api/types/admin/event-builder'
import {
  mediaAssetSchema,
  updateMediaAssetSchema,
  mediaListInputSchema,
  uploadRequestSchema,
} from '@/lib/api/types/admin/media'
import { adminLedgerRowSchema, refundRequestSchema } from '@/lib/api/types/admin/payments'
import { changeRoleSchema } from '@/lib/api/types/admin/players'
import { createPreviewLinkSchema, previewLinkSchema } from '@/lib/api/types/admin/preview'
import { hasSecretLookingKey, settingsPatchSchema, settingsSchema } from '@/lib/api/types/admin/settings'
import { proposeSlug, slugCheckQuerySchema, slugCheckResultSchema, slugFieldSchema } from '@/lib/api/types/admin/slug'
import { adminStorySchema, updateStorySchema } from '@/lib/api/types/admin/stories'
import { adminTestimonialSchema } from '@/lib/api/types/admin/testimonials'
import { authoringSlugSchema } from '@/lib/api/types/primitives'

const NOW = '2026-10-22T10:00:00+05:30'
const ID = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'
const ID3 = '33333333-3333-4333-8333-333333333333'
const ACTOR = { id: ID, name: 'Asha Admin' }
const LAST = { by: ACTOR, at: NOW, summary: 'Edited hero copy' }
const ALLOWED = { allowed: true } as const
const DENIED = { allowed: false, reason: 'Results are not final' } as const

const asset = {
  id: ID,
  src: '/placeholders/hero.jpg',
  width: 1600,
  height: 900,
  contentType: 'image/jpeg',
  sizeBytes: 120000,
  focal: { x: 0.5, y: 0.4 },
  credit: null,
  usageCount: 1,
  usedBy: [{ kind: 'event', id: ID2, label: 'Saturday Social' }],
  uploadedAt: NOW,
  uploadedBy: ACTOR,
  version: 2,
  status: 'published',
  decorative: false,
  alt: 'Players at a board',
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('authoring slug', () => {
  it('accepts 3 to 80 chars of lowercase words', () => {
    expect(authoringSlugSchema.safeParse('abc').success).toBe(true)
    expect(authoringSlugSchema.safeParse('saturday-social-2026').success).toBe(true)
    expect(authoringSlugSchema.safeParse('a'.repeat(80)).success).toBe(true)
  })

  it.each([
    'ab',
    'a'.repeat(81),
    'Saturday-Social',
    'saturday_social',
    '-lead',
    'trail-',
    'double--hyphen',
    'has space',
    '',
  ])('rejects %j', (value) => {
    expect(authoringSlugSchema.safeParse(value).success).toBe(false)
  })

  it('proposes a slug from a title and refuses an unusable one', () => {
    expect(proposeSlug('Saturday Social: Oct 24!')).toBe('saturday-social-oct-24')
    expect(proposeSlug('Café Blitz')).toBe('cafe-blitz')
    expect(proposeSlug('!!')).toBeNull()
    const long = proposeSlug('word '.repeat(40))
    expect(long).not.toBeNull()
    expect(authoringSlugSchema.safeParse(long).success).toBe(true)
  })

  it('models the check query and the lock', () => {
    expect(slugCheckQuerySchema.safeParse({ type: 'event', slug: 'saturday-social', excludeId: ID }).success).toBe(true)
    expect(slugCheckQuerySchema.safeParse({ type: 'page', slug: 'saturday-social' }).success).toBe(false)
    expect(slugCheckQuerySchema.safeParse({ type: 'event', slug: 'Bad Slug' }).success).toBe(false)
    expect(slugCheckResultSchema.safeParse({ available: false, suggestion: 'saturday-social-2' }).success).toBe(true)
    expect(slugCheckResultSchema.safeParse({ available: true }).success).toBe(true)
    expect(slugFieldSchema.safeParse({ lock: 'editable', value: null }).success).toBe(true)
    expect(slugFieldSchema.safeParse({ lock: 'locked', value: 'saturday-social', lockedAt: NOW }).success).toBe(true)
    // A locked slug always has a value and a lock time.
    expect(slugFieldSchema.safeParse({ lock: 'locked', value: null, lockedAt: NOW }).success).toBe(false)
    expect(slugFieldSchema.safeParse({ lock: 'locked', value: 'saturday-social' }).success).toBe(false)
  })
})

describe('capability flags and readiness', () => {
  it('requires a text reason when a control is disabled (AC-84)', () => {
    expect(capabilityFlagSchema.safeParse(ALLOWED).success).toBe(true)
    expect(capabilityFlagSchema.safeParse(DENIED).success).toBe(true)
    expect(capabilityFlagSchema.safeParse({ allowed: false }).success).toBe(false)
    expect(capabilityFlagSchema.safeParse({ allowed: false, reason: '' }).success).toBe(false)
  })

  it('lists blockers whenever not ready', () => {
    expect(publishReadinessSchema.safeParse({ ready: true }).success).toBe(true)
    expect(
      publishReadinessSchema.safeParse({
        ready: false,
        blockers: [{ code: 'MISSING_SLUG', reason: 'Choose a slug', field: 'basics.slug' }],
      }).success,
    ).toBe(true)
    expect(publishReadinessSchema.safeParse({ ready: false, blockers: [] }).success).toBe(false)
  })
})

const draft = {
  id: ID,
  status: 'draft',
  basics: {
    title: 'Saturday Social',
    slug: { lock: 'editable', value: 'saturday-social' },
    type: 'social',
    promise: 'Easy games. Good coffee.',
    startsAt: '2026-10-24T17:00:00+05:30',
    endsAt: '2026-10-24T20:30:00+05:30',
    venueName: 'Roastery Room',
    address: '12 Road No 36',
    area: 'Jubilee Hills',
    city: 'Hyderabad',
    audience: 'all_levels',
  },
  experience: {
    description: '',
    eyebrow: '',
    heading: '',
    body: '',
    highlights: [],
    logistics: [],
    faq: [],
    hostedArrival: true,
  },
  registration: {
    capacity: 32,
    waitlistEnabled: true,
    opensAt: null,
    closesAt: null,
    membershipRequired: false,
    askFirstTimer: true,
    minAge: null,
  },
  payment: { pricePaise: 29900, currency: 'INR', refundWindowHours: 24, holdMinutes: 10 },
  gameSystem: { rated: false, pairingMode: 'social_balanced', rounds: null, timeControl: '' },
  media: { assetIds: [], assets: [], mode: 'static', autoplay: false, intervalMs: 5000 },
  communications: {
    triggers: {
      confirmation: true,
      reminder_24h: true,
      checkin_open: false,
      pairing_published: true,
      post_event: true,
    },
    channels: ['email'],
  },
  lockedFields: [],
  lockedReasons: {},
  readiness: {
    ready: false,
    blockers: [{ code: 'MISSING_EXPERIENCE', reason: 'Add a description', field: 'experience.description' }],
  },
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  lastChange: null,
}

describe('event builder', () => {
  it('accepts an incomplete draft across the 8 steps', () => {
    expect(builderDraftSchema.safeParse(draft).success).toBe(true)
  })

  it('rejects negative or fractional money and an unknown enum', () => {
    expect(builderDraftSchema.safeParse({ ...draft, payment: { ...draft.payment, pricePaise: -1 } }).success).toBe(
      false,
    )
    expect(builderDraftSchema.safeParse({ ...draft, payment: { ...draft.payment, pricePaise: 100.5 } }).success).toBe(
      false,
    )
    expect(builderDraftSchema.safeParse({ ...draft, payment: { ...draft.payment, currency: 'USD' } }).success).toBe(
      false,
    )
    expect(builderDraftSchema.safeParse({ ...draft, status: 'archived' }).success).toBe(false)
    expect(builderDraftSchema.safeParse({ ...draft, basics: { ...draft.basics, type: 'blitz_party' } }).success).toBe(
      false,
    )
  })

  it('rejects a bad authoring slug in the resource and in the patch', () => {
    expect(
      builderDraftSchema.safeParse({
        ...draft,
        basics: { ...draft.basics, slug: { lock: 'editable', value: 'No Good' } },
      }).success,
    ).toBe(false)
    expect(updateBuilderDraftSchema.safeParse({ version: 1, basics: { slug: 'ab' } }).success).toBe(false)
    expect(updateBuilderDraftSchema.safeParse({ version: 1, basics: { slug: 'good-slug' } }).success).toBe(true)
  })

  it('patch is strict: no status, id, currency or stray keys travel', () => {
    expect(updateBuilderDraftSchema.safeParse({ version: 1, status: 'published' }).success).toBe(false)
    expect(updateBuilderDraftSchema.safeParse({ version: 1, id: ID }).success).toBe(false)
    expect(updateBuilderDraftSchema.safeParse({ version: 1, payment: { currency: 'INR' } }).success).toBe(false)
    expect(updateBuilderDraftSchema.safeParse({ version: 1, payment: { pricePaise: -5 } }).success).toBe(false)
    expect(updateBuilderDraftSchema.safeParse({ version: 1, payment: { pricePaise: 49900 } }).success).toBe(true)
    expect(updateBuilderDraftSchema.safeParse({ basics: { title: 'x' } }).success).toBe(false) // version required
  })

  it('cancel needs a reason and explicit choices', () => {
    expect(
      cancelEventSchema.safeParse({ reason: 'Venue closed', notifyParticipants: true, refund: true }).success,
    ).toBe(true)
    expect(cancelEventSchema.safeParse({ reason: '', notifyParticipants: true, refund: true }).success).toBe(false)
    expect(cancelEventSchema.safeParse({ reason: 'x', notifyParticipants: true }).success).toBe(false)
  })
})

describe('media', () => {
  it('accepts a published asset with alt or decorative', () => {
    expect(mediaAssetSchema.safeParse(asset).success).toBe(true)
    expect(mediaAssetSchema.safeParse({ ...asset, decorative: true, alt: '' }).success).toBe(true)
  })

  it('accepts a draft asset without alt but rejects a published one', () => {
    expect(mediaAssetSchema.safeParse({ ...asset, status: 'draft', alt: null }).success).toBe(true)
    expect(mediaAssetSchema.safeParse({ ...asset, status: 'published', alt: null }).success).toBe(true)
    expect(mediaAssetSchema.safeParse({ ...asset, status: 'published', alt: '   ' }).success).toBe(false)
  })

  it('rejects a focal point outside 0..1', () => {
    expect(mediaAssetSchema.safeParse({ ...asset, focal: { x: 1.2, y: 0.5 } }).success).toBe(false)
    expect(mediaAssetSchema.safeParse({ ...asset, focal: { x: 0.5, y: -0.1 } }).success).toBe(false)
    expect(updateMediaAssetSchema.safeParse({ version: 1, focal: { x: 1.01, y: 0 } }).success).toBe(false)
    expect(updateMediaAssetSchema.safeParse({ version: 1, focal: { x: 1, y: 0 } }).success).toBe(true)
  })

  it('update is strict, versioned and refuses alt on a decorative image', () => {
    expect(updateMediaAssetSchema.safeParse({ alt: 'x' }).success).toBe(false) // version required
    expect(updateMediaAssetSchema.safeParse({ version: 1, alt: 'x', url: 'https://x.test/a.jpg' }).success).toBe(false)
    expect(updateMediaAssetSchema.safeParse({ version: 1, decorative: true, alt: 'x' }).success).toBe(false)
    expect(updateMediaAssetSchema.safeParse({ version: 1, decorative: true }).success).toBe(true)
  })

  it('asset list interval, cap and duplicate bounds', () => {
    expect(mediaListInputSchema.safeParse({ assetIds: [ID], autoplay: true, intervalMs: 5000 }).success).toBe(true)
    expect(mediaListInputSchema.safeParse({ assetIds: [] }).success).toBe(true)
    expect(mediaListInputSchema.safeParse({ assetIds: [ID], intervalMs: 500 }).success).toBe(false)
    expect(mediaListInputSchema.safeParse({ assetIds: [ID, ID] }).success).toBe(false)
    expect(mediaListInputSchema.safeParse({ assetIds: [ID], mode: 'carousel' }).success).toBe(false)
    expect(
      mediaListInputSchema.safeParse({
        assetIds: Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
      }).success,
    ).toBe(false)
  })

  it('upload request allow-lists type and size', () => {
    expect(
      uploadRequestSchema.safeParse({ filename: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 1000 }).success,
    ).toBe(true)
    expect(
      uploadRequestSchema.safeParse({ filename: 'a.svg', contentType: 'image/svg+xml', sizeBytes: 1000 }).success,
    ).toBe(false)
    expect(uploadRequestSchema.safeParse({ filename: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 0 }).success).toBe(
      false,
    )
    expect(
      uploadRequestSchema.safeParse({ filename: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 99_999_999 }).success,
    ).toBe(false)
  })
})

describe('testimonials', () => {
  const base = {
    id: ID,
    name: 'Meera R',
    descriptor: 'Weekend regular',
    sortOrder: 1,
    version: 1,
    updatedAt: NOW,
    lastChange: null,
  }
  const portrait = {
    id: ID2,
    src: '/placeholders/p.jpg',
    width: 400,
    height: 400,
    alt: 'Meera',
    decorative: false,
    focal: { x: 0.5, y: 0.5 },
  }

  it('accepts a complete published testimonial and an incomplete draft', () => {
    expect(
      adminTestimonialSchema.safeParse({
        ...base,
        status: 'published',
        quote: 'I came alone and left with friends.',
        portrait,
        consentAt: NOW,
        publishedAt: NOW,
      }).success,
    ).toBe(true)
    expect(
      adminTestimonialSchema.safeParse({ ...base, status: 'draft', quote: '', portrait: null, consentAt: null })
        .success,
    ).toBe(true)
  })

  it('rejects a published testimonial missing consent, photo or quote', () => {
    const published = { ...base, status: 'published', quote: 'Great', portrait, consentAt: NOW, publishedAt: NOW }
    expect(adminTestimonialSchema.safeParse({ ...published, consentAt: null }).success).toBe(false)
    expect(adminTestimonialSchema.safeParse({ ...published, consentAt: undefined }).success).toBe(false)
    expect(adminTestimonialSchema.safeParse({ ...published, portrait: null }).success).toBe(false)
    expect(adminTestimonialSchema.safeParse({ ...published, quote: '' }).success).toBe(false)
  })
})

describe('stories', () => {
  const story = {
    id: ID,
    kind: 'club_notes',
    slug: { lock: 'locked', value: 'club-notes-oct', lockedAt: NOW },
    eyebrow: 'Club notes',
    title: 'October at PG',
    dek: 'What happened.',
    body: [{ type: 'paragraph', text: 'Hello.' }],
    publishedOn: '2026-10-20',
    readingMinutes: 3,
    featured: false,
    media: { assetIds: [], assets: [], mode: 'static', autoplay: false, intervalMs: 5000 },
    status: 'published',
    version: 4,
    updatedAt: NOW,
    lastChange: LAST,
  }

  it('accepts a story and keeps the body in the closed block model', () => {
    expect(adminStorySchema.safeParse(story).success).toBe(true)
    expect(adminStorySchema.safeParse({ ...story, body: [{ type: 'html', html: '<b>x</b>' }] }).success).toBe(false)
  })

  it('applies the authoring slug to the patch and keeps it strict', () => {
    expect(updateStorySchema.safeParse({ version: 1, slug: 'ok-slug' }).success).toBe(true)
    expect(updateStorySchema.safeParse({ version: 1, slug: 'Not OK' }).success).toBe(false)
    expect(updateStorySchema.safeParse({ version: 1, status: 'published' }).success).toBe(false)
  })
})

describe('cms', () => {
  it('discriminates a draft save on the section key', () => {
    const nav = {
      key: 'nav',
      version: 3,
      content: {
        primary: [{ label: 'Play', href: '/play' }],
        authCta: { label: 'Sign in', href: '/login' },
      },
    }
    expect(saveCmsDraftSchema.safeParse(nav).success).toBe(true)
    expect(saveCmsDraftSchema.safeParse({ ...nav, version: undefined }).success).toBe(false)
    // Content of another section under the wrong key is rejected.
    expect(saveCmsDraftSchema.safeParse({ ...nav, key: 'footer' }).success).toBe(false)
    expect(saveCmsDraftSchema.safeParse({ ...nav, key: 'blog' }).success).toBe(false)
    // No HTML-ish link schemes.
    expect(
      saveCmsDraftSchema.safeParse({
        ...nav,
        content: { ...nav.content, authCta: { label: 'x', href: 'javascript:alert(1)' } },
      }).success,
    ).toBe(false)
  })
})

describe('settings never carry secrets', () => {
  const settings = {
    brand: {
      siteName: "Pawn's Gambit",
      supportEmail: 'hello@example.com',
      deskContactHref: 'tel:+910000000000',
      defaultCity: 'Hyderabad',
      social: [{ label: 'Instagram', href: 'https://instagram.com/pg' }],
    },
    auth: { googleSignInEnabled: false, signupOpen: true, adminSessionHours: 12 },
    ratings: { ratingsEnabled: true, provisionalGames: 10, showRatingsByDefault: true },
    payments: { currency: 'INR', holdMinutes: 10, defaultRefundWindowHours: 24 },
    notifications: {
      emailEnabled: true,
      senderName: 'Pawn Gambit',
      contactDestinationEmail: 'desk@example.com',
      reminderHoursBefore: 24,
    },
    eventDefaults: {
      type: 'social',
      pairingMode: 'social_balanced',
      capacity: 32,
      waitlistEnabled: true,
      timeControl: '10+5',
    },
    integrations: { google: false, razorpay: true, email: true, whatsapp: false },
    version: 7,
    updatedAt: NOW,
  }

  it('accepts a clean settings payload and patch', () => {
    expect(settingsSchema.safeParse(settings).success).toBe(true)
    expect(settingsPatchSchema.safeParse({ version: 7, ratings: { provisionalGames: 5 } }).success).toBe(true)
  })

  it('rejects an unknown key in any group (closed objects)', () => {
    expect(
      settingsSchema.safeParse({ ...settings, payments: { ...settings.payments, razorpayKeySecret: 'x' } }).success,
    ).toBe(false)
    expect(settingsSchema.safeParse({ ...settings, extra: 1 }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ version: 7, payments: { webhookSecret: 'whsec_x' } }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ version: 7, payments: { currency: 'INR' } }).success).toBe(false)
  })

  it.each([
    'apiKey',
    'api_key',
    'clientSecret',
    'razorpayKeySecret',
    'webhookSecret',
    'password',
    'smtpPassword',
    'accessToken',
    'privateKey',
    'signingKey',
    'credentials',
  ])('flags the secret-looking key %s at any depth', (key) => {
    expect(hasSecretLookingKey({ [key]: 'x' })).toBe(true)
    expect(hasSecretLookingKey({ nested: { deep: [{ [key]: 'x' }] } })).toBe(true)
  })

  it('does not flag ordinary setting keys', () => {
    expect(hasSecretLookingKey(settings)).toBe(false)
  })

  it('treats integration health as booleans only', () => {
    expect(
      settingsSchema.safeParse({ ...settings, integrations: { ...settings.integrations, razorpay: 'rzp_live_x' } })
        .success,
    ).toBe(false)
  })
})

describe('payments admin', () => {
  const row = {
    id: ID,
    registrationId: ID2,
    playerName: 'Kiran Rao',
    amountPaise: 29900,
    currency: 'INR',
    state: 'paid',
    refundState: 'none',
    providerOrderId: 'order_ABCdef123456',
    providerPaymentId: 'pay_ABCdef123456',
    refundedPaise: 0,
    updatedAt: NOW,
    capabilities: { canRefund: ALLOWED },
    version: 2,
    eventId: ID3,
    eventSlug: 'saturday-social',
    eventTitle: 'Saturday Social',
    mismatch: { mismatch: false },
  }

  it('accepts a clean row and a mismatched row with its kind', () => {
    expect(adminLedgerRowSchema.safeParse(row).success).toBe(true)
    expect(
      adminLedgerRowSchema.safeParse({
        ...row,
        mismatch: { mismatch: true, kind: 'amount', detail: 'Provider captured 19900', detectedAt: NOW },
      }).success,
    ).toBe(true)
    expect(adminLedgerRowSchema.safeParse({ ...row, mismatch: { mismatch: true } }).success).toBe(false)
  })

  it('rejects negative money and a bad provider id', () => {
    expect(adminLedgerRowSchema.safeParse({ ...row, amountPaise: -100 }).success).toBe(false)
    expect(adminLedgerRowSchema.safeParse({ ...row, refundedPaise: -1 }).success).toBe(false)
    expect(adminLedgerRowSchema.safeParse({ ...row, providerOrderId: 'x' }).success).toBe(false)
    expect(adminLedgerRowSchema.safeParse({ ...row, state: 'settled' }).success).toBe(false)
  })

  it('refund request is strict: paise only, positive, with a reason', () => {
    expect(refundRequestSchema.safeParse({ reason: 'Event cancelled' }).success).toBe(true)
    expect(refundRequestSchema.safeParse({ amountPaise: 10000, reason: 'Partial' }).success).toBe(true)
    expect(refundRequestSchema.safeParse({ amountPaise: -1, reason: 'x' }).success).toBe(false)
    expect(refundRequestSchema.safeParse({ amountPaise: 0, reason: 'x' }).success).toBe(false)
    expect(refundRequestSchema.safeParse({ amountPaise: 100.5, reason: 'x' }).success).toBe(false)
    expect(refundRequestSchema.safeParse({ reason: 'x', currency: 'INR' }).success).toBe(false)
    expect(refundRequestSchema.safeParse({ amountPaise: 100 }).success).toBe(false)
  })
})

describe('players admin', () => {
  it('role change is strict and limited to known roles', () => {
    expect(changeRoleSchema.safeParse({ role: 'admin' }).success).toBe(true)
    expect(changeRoleSchema.safeParse({ role: 'superuser' }).success).toBe(false)
    expect(changeRoleSchema.safeParse({ role: 'admin', userId: ID }).success).toBe(false)
  })
})

describe('control room', () => {
  const player = (name: string) => ({ registrationId: ID, name, rating: 1200, firstTimer: false })
  const game = {
    kind: 'game',
    pairingId: ID,
    board: 1,
    white: player('Asha K'),
    black: { ...player('Ravi S'), registrationId: ID2 },
    result: { state: 'none' },
    rematch: false,
    capabilities: { canEnterResult: ALLOWED, canResolveDispute: DENIED },
  }
  const round = {
    id: ID,
    roundNo: 1,
    method: 'swiss',
    pairings: [game],
    unresolvedResults: 1,
    pairingVersion: 1,
    candidates: [],
    capabilities: { canEdit: ALLOWED, canPublish: ALLOWED, canStart: DENIED, canFinalise: DENIED },
    version: 1,
    updatedAt: NOW,
    state: 'draft',
  }

  it('accepts draft and completed rounds, and a bye', () => {
    expect(adminRoundSchema.safeParse(round).success).toBe(true)
    expect(
      adminRoundSchema.safeParse({
        ...round,
        state: 'completed',
        publishedAt: NOW,
        finalisedAt: NOW,
        ratingProcessing: { status: 'pending', enqueuedAt: NOW },
        pairings: [{ kind: 'bye', pairingId: ID2, board: 9, player: player('Meera R') }],
      }).success,
    ).toBe(true)
  })

  it('rejects illegal round combinations', () => {
    expect(adminRoundSchema.safeParse({ ...round, state: 'published' }).success).toBe(false) // publishedAt required
    expect(
      adminRoundSchema.safeParse({ ...round, state: 'completed', publishedAt: NOW, finalisedAt: NOW }).success,
    ).toBe(false)
    expect(adminRoundSchema.safeParse({ ...round, state: 'archived' }).success).toBe(false)
  })

  it('models disputed and final results with what an admin needs', () => {
    const withResult = (result: unknown) =>
      adminRoundSchema.safeParse({ ...round, pairings: [{ ...game, result }] }).success
    expect(
      withResult({ state: 'disputed', outcome: 'white', submittedBy: 'white', disputedBy: 'black', note: null }),
    ).toBe(true)
    expect(
      withResult({ state: 'final', outcome: 'draw', decidedBy: 'admin', adminReason: 'Resolved at the desk' }),
    ).toBe(true)
    expect(withResult({ state: 'final', decidedBy: 'players', adminReason: null })).toBe(false) // outcome required
    expect(withResult({ state: 'disputed', outcome: 'white' })).toBe(false)
  })

  it('result commands need a reason and a known outcome', () => {
    expect(
      resultCommandSchema.safeParse({ action: 'record', outcome: 'white', reason: 'Entered at desk' }).success,
    ).toBe(true)
    expect(resultCommandSchema.safeParse({ action: 'resolve', outcome: 'draw', reason: 'Agreed' }).success).toBe(true)
    expect(resultCommandSchema.safeParse({ action: 'record', outcome: 'white' }).success).toBe(false)
    expect(resultCommandSchema.safeParse({ action: 'record', outcome: 'forfeit', reason: 'x' }).success).toBe(false)
    expect(resultCommandSchema.safeParse({ action: 'delete', outcome: 'white', reason: 'x' }).success).toBe(false)
  })

  it('post-publish pairing edits need a reason; draft edits do not', () => {
    const edit = { version: 1, boards: [{ board: 1, whiteRegistrationId: ID, blackRegistrationId: ID2 }], byes: [] }
    expect(editPairingsSchema.safeParse({ phase: 'draft', ...edit }).success).toBe(true)
    expect(editPairingsSchema.safeParse({ phase: 'after_publish', ...edit }).success).toBe(false)
    expect(editPairingsSchema.safeParse({ phase: 'after_publish', ...edit, reason: 'Late arrival' }).success).toBe(true)
  })

  it('finalise result carries the rating processing state', () => {
    expect(
      finaliseResultSchema.safeParse({
        roundId: ID,
        state: 'completed',
        finalisedAt: NOW,
        ratingProcessing: { status: 'pending', enqueuedAt: NOW },
        version: 5,
      }).success,
    ).toBe(true)
    expect(finaliseResultSchema.safeParse({ roundId: ID, state: 'live', finalisedAt: NOW, version: 5 }).success).toBe(
      false,
    )
  })

  it('message send is strict; delivery reports partial failure per recipient', () => {
    const send = { audience: 'confirmed', channel: 'email', subject: 'Doors open', body: 'See you at 5.' }
    expect(sendMessageSchema.safeParse(send).success).toBe(true)
    expect(sendMessageSchema.safeParse({ ...send, channel: 'sms' }).success).toBe(false)
    expect(sendMessageSchema.safeParse({ ...send, audience: 'everyone' }).success).toBe(false)
    expect(sendMessageSchema.safeParse({ ...send, html: '<b>x</b>' }).success).toBe(false)
    const detail = {
      id: ID,
      audience: 'confirmed',
      channel: 'email',
      subject: 'Doors open',
      body: 'See you at 5.',
      trigger: null,
      sentBy: ACTOR,
      createdAt: NOW,
      status: 'partial_failure',
      counts: { recipients: 2, queued: 0, sent: 0, delivered: 1, failed: 1 },
      recipients: [
        { registrationId: ID, name: 'Asha K', state: 'delivered', at: NOW },
        { registrationId: ID2, name: 'Ravi S', state: 'failed', reason: 'Mailbox full', at: NOW },
      ],
    }
    expect(messageDetailSchema.safeParse(detail).success).toBe(true)
    expect(
      messageDetailSchema.safeParse({
        ...detail,
        recipients: [{ registrationId: ID2, name: 'Ravi S', state: 'failed', at: NOW }],
      }).success,
    ).toBe(false) // a failure needs a reason
  })

  it('registration actions need a reason where a player is affected', () => {
    expect(registrationActionInputSchema.safeParse({ action: 'mark_welcomed' }).success).toBe(true)
    expect(registrationActionInputSchema.safeParse({ action: 'cancel' }).success).toBe(false)
    expect(registrationActionInputSchema.safeParse({ action: 'cancel', reason: 'No show' }).success).toBe(true)
    expect(registrationActionInputSchema.safeParse({ action: 'set_status', reason: 'x' }).success).toBe(false) // no free-form status
  })

  it('manual check-in and desk', () => {
    expect(manualCheckInSchema.safeParse({ registrationId: ID, state: 'checked_in' }).success).toBe(true)
    expect(manualCheckInSchema.safeParse({ registrationId: ID, state: 'not_checked_in' }).success).toBe(true)
    expect(manualCheckInSchema.safeParse({ registrationId: ID, state: 'late' }).success).toBe(false)
    expect(
      checkInDeskSchema.safeParse({
        counts: { expected: 10, arrived: 4, firstTimersWaiting: 2 },
        rows: {
          items: [
            {
              registrationId: ID,
              name: 'Asha K',
              firstTimer: true,
              welcomed: false,
              assignee: null,
              checkedInAt: null,
              checkInSource: null,
            },
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
        serverNow: NOW,
        version: 3,
      }).success,
    ).toBe(true)
  })

  it('audit entries use a known action', () => {
    const entry = { id: ID, at: NOW, actor: ACTOR, action: 'round.finalised', object: 'Round 2', summary: null }
    expect(auditEntrySchema.safeParse(entry).success).toBe(true)
    expect(auditEntrySchema.safeParse({ ...entry, action: 'round.exploded' }).success).toBe(false)
  })
})

describe('dashboard and preview', () => {
  it('accepts an empty-state dashboard and rejects a bad attention link', () => {
    const dash = {
      event: null,
      pendingPayments: { count: 0, amountPaise: 0, currency: 'INR' },
      websiteHealth: { state: 'ok', lastPublishedAt: null, pendingRevalidations: 0 },
      attention: [
        {
          kind: 'media_missing_alt',
          message: '2 images need alt text',
          count: 2,
          href: '/admin/media?missingAlt=true',
        },
      ],
      serverNow: NOW,
    }
    expect(dashboardSummarySchema.safeParse(dash).success).toBe(true)
    expect(
      dashboardSummarySchema.safeParse({
        ...dash,
        attention: [{ ...dash.attention[0], href: 'https://evil.example/admin' }],
      }).success,
    ).toBe(false)
    expect(
      dashboardSummarySchema.safeParse({ ...dash, pendingPayments: { count: 1, amountPaise: -1, currency: 'INR' } })
        .success,
    ).toBe(false)
  })

  it('preview link request and response', () => {
    expect(createPreviewLinkSchema.safeParse({ kind: 'event', id: ID }).success).toBe(true)
    expect(createPreviewLinkSchema.safeParse({ kind: 'site', id: 'home' }).success).toBe(true)
    expect(createPreviewLinkSchema.safeParse({ kind: 'site', id: ID }).success).toBe(false)
    expect(createPreviewLinkSchema.safeParse({ kind: 'page', id: ID }).success).toBe(false)
    expect(
      previewLinkSchema.safeParse({ url: 'https://pawnsgambit.example/api/draft?token=abc123', expiresAt: NOW })
        .success,
    ).toBe(true)
    expect(
      previewLinkSchema.safeParse({ url: 'https://pawnsgambit.example/admin?token=abc', expiresAt: NOW }).success,
    ).toBe(false)
    vi.stubEnv('NODE_ENV', 'production') // http is only accepted outside production
    expect(
      previewLinkSchema.safeParse({ url: 'http://pawnsgambit.example/api/draft?token=abc', expiresAt: NOW }).success,
    ).toBe(false)
  })
})
