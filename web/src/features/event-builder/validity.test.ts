import { describe, expect, it } from 'vitest'
import { parseValidSteps, validStepKey } from '@/features/event-builder/validity'
import type { BuilderState } from '@/features/event-builder/store'
import type { BuilderDraftDto, BuilderStep } from '@/lib/api/types/admin/event-builder'
import type { PendingPatch } from '@/features/event-builder/types'

// validStepKey feeds the stepper and the Continue button: a step may move on exactly when its FORM schema passes over
// the server resource with unsent edits laid on top.

const NOW = '2026-10-01T10:00:00+05:30'
const ALL_STEPS: BuilderStep[] = [
  'basics',
  'experience',
  'registration',
  'payment',
  'game_system',
  'media',
  'communications',
  'review',
]

const draft = {
  id: '7b0e3f1e-5d8a-4f3b-9c55-2f1b0c5d9a10',
  status: 'draft',
  basics: {
    title: 'Saturday Social',
    slug: { lock: 'editable', value: 'saturday-social' },
    type: 'social',
    promise: '',
    startsAt: '2026-12-01T18:00:00+05:30',
    endsAt: '2026-12-01T21:00:00+05:30',
    venueName: '',
    address: '',
    area: '',
    city: '',
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
    capacity: 24,
    waitlistEnabled: true,
    opensAt: null,
    closesAt: null,
    membershipRequired: false,
    askFirstTimer: true,
    minAge: null,
  },
  payment: { pricePaise: 29900, currency: 'INR', refundWindowHours: 24, holdMinutes: 10 },
  gameSystem: { rated: false, pairingMode: 'social_balanced', rounds: null, timeControl: '10+5' },
  media: { assetIds: [], assets: [], mode: 'static', autoplay: false, intervalMs: 5000 },
  communications: {
    triggers: {
      confirmation: true,
      reminder_24h: true,
      checkin_open: true,
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

function state(server: Partial<BuilderDraftDto> = {}, pending: PendingPatch = {}): BuilderState {
  return { server: { ...draft, ...server }, pending } as unknown as BuilderState
}

function validSteps(server: Partial<BuilderDraftDto> = {}, pending: PendingPatch = {}): BuilderStep[] {
  return [...parseValidSteps(validStepKey(state(server, pending)))]
}

describe('validStepKey', () => {
  it('marks every step valid, including review which has no data', () => {
    expect(validSteps()).toEqual(ALL_STEPS)
  })

  it('excludes basics while the title, start or end is missing', () => {
    expect(validSteps({ basics: { ...draft.basics, title: '  ' } })).not.toContain('basics')
    expect(validSteps({ basics: { ...draft.basics, startsAt: null } })).not.toContain('basics')
    expect(validSteps({ basics: { ...draft.basics, endsAt: null } })).not.toContain('basics')
  })

  it('leaves the other steps alone when one step is incomplete', () => {
    const valid = validSteps({ basics: { ...draft.basics, title: '' } })
    expect(valid).toEqual(ALL_STEPS.filter((step) => step !== 'basics'))
  })

  it('layers unsent edits over the server resource', () => {
    const server = { basics: { ...draft.basics, title: '' } }
    expect(validSteps(server, { basics: { title: 'Renamed' } })).toContain('basics')
  })

  it('keeps a step out while an unsent edit makes it invalid', () => {
    expect(validSteps({}, { basics: { endsAt: draft.basics.startsAt } })).not.toContain('basics')
    expect(validSteps({}, { registration: { capacity: 0 } })).not.toContain('registration')
    expect(validSteps({}, { gameSystem: { timeControl: '' } })).not.toContain('game_system')
  })

  it('does not leak a pending edit into another step', () => {
    const pending: PendingPatch = { basics: { title: 'Renamed' } }
    expect(
      validSteps({ experience: { ...draft.experience, highlights: Array(9).fill({ title: 't', body: 'b' }) } }),
    ).not.toContain('experience')
    expect(validSteps({}, pending)).toContain('experience')
  })

  it('requires rounds on a swiss event and accepts unlimited capacity', () => {
    expect(validSteps({ gameSystem: { ...draft.gameSystem, pairingMode: 'swiss', rounds: null } })).not.toContain(
      'game_system',
    )
    expect(validSteps({ gameSystem: { ...draft.gameSystem, pairingMode: 'swiss', rounds: 5 } })).toContain(
      'game_system',
    )
    expect(validSteps({ registration: { ...draft.registration, capacity: null } })).toContain('registration')
  })

  it('returns a stable string for unchanged state', () => {
    const same = state()
    const first = validStepKey(same)
    // A re-render passes the same references: the memo returns the cached key, not a new join.
    expect(validStepKey(same)).toBe(first)
    expect(first).toBe(ALL_STEPS.join(','))
  })
})

describe('parseValidSteps', () => {
  it('reads an empty key as no valid step', () => {
    expect([...parseValidSteps('')]).toEqual([])
  })

  it('round trips the key', () => {
    const key = validStepKey(state({ basics: { ...draft.basics, title: '' } }))
    expect([...parseValidSteps(key)]).toEqual(ALL_STEPS.filter((step) => step !== 'basics'))
  })
})
