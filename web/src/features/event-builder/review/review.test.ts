import { describe, expect, it } from 'vitest'
import { summarize } from '@/features/event-builder/review/ReviewSummary'
import { toSeoPreview } from '@/features/event-builder/review/seo-model'
import type { BuilderDraftDto } from '@/lib/api/types/admin/event-builder'

const NOW = '2026-10-01T10:00:00+05:30'

const draft = {
  id: '7b0e3f1e-5d8a-4f3b-9c55-2f1b0c5d9a10',
  status: 'draft',
  basics: {
    title: 'Saturday Social',
    slug: { lock: 'editable', value: 'saturday-social' },
    type: 'social',
    promise: 'Easy games. Good coffee.',
    startsAt: '2026-10-24T17:00:00+05:30',
    endsAt: null,
    venueName: 'Roastery Room',
    address: '',
    area: 'Jubilee Hills',
    city: 'Hyderabad',
    audience: 'all_levels',
  },
  experience: {
    description: 'A relaxed evening of chess.',
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
  readiness: { ready: true },
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  lastChange: null,
} as unknown as BuilderDraftDto

describe('toSeoPreview', () => {
  it('builds title, description and canonical URL like the public event page', () => {
    const model = toSeoPreview(draft, {}, null)
    expect(model.documentTitle).toBe("Saturday Social | Pawn's Gambit")
    expect(model.description).toBe('Easy games. Good coffee. A relaxed evening of chess.')
    expect(model.url.endsWith('/events/saturday-social')).toBe(true)
    expect(model.hasSlug).toBe(true)
  })

  it('lays unsent edits over the draft and uses placeholders when the slug is missing', () => {
    const model = toSeoPreview(draft, { basics: { title: 'New name', slug: '' } }, null)
    expect(model.documentTitle).toBe("New name | Pawn's Gambit")
    expect(model.hasSlug).toBe(false)
    expect(model.url.endsWith('/events/your-event-address')).toBe(true)
  })

  it('uses the cover image when given and the brand card otherwise', () => {
    const cover = { src: 'https://cdn.example.test/a.jpg', width: 800, height: 600, alt: 'Players' }
    expect(toSeoPreview(draft, {}, cover).imageUrl).toBe('https://cdn.example.test/a.jpg')
    expect(toSeoPreview(draft, {}, null).imageUrl.endsWith('/opengraph-image')).toBe(true)
  })
})

describe('summarize', () => {
  it('gives one row per data step with plain facts', () => {
    const rows = summarize(draft, { payment: { pricePaise: 0 } })
    expect(rows.map((row) => row.step)).toEqual([
      'basics',
      'experience',
      'registration',
      'payment',
      'game_system',
      'media',
      'communications',
    ])
    expect(rows.find((row) => row.step === 'payment')?.facts[0]).toBe('Free')
    expect(rows.find((row) => row.step === 'communications')?.facts[0]).toBe('4 of 5 emails on')
  })
})
