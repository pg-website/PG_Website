import type { ZodType } from 'zod'
import { describe, expect, it } from 'vitest'
import { patchSchemaFor, STEP_FORM_SCHEMAS } from '@/features/event-builder/step-schemas'
import { STEP_DATA_KEYS } from '@/features/event-builder/types'

// Form schemas are what marks a step complete in the stepper; PATCH schemas are what may travel (E04). The rules here
// mirror the backend `readiness` blockers, so a step the UI calls complete is one the server can publish.

const basics = {
  title: 'Saturday Social',
  slug: { lock: 'editable' as const, value: 'saturday-social' },
  type: 'social' as const,
  promise: '',
  startsAt: '2026-12-01T18:00:00+05:30',
  endsAt: '2026-12-01T21:00:00+05:30',
  venueName: '',
  address: '',
  area: '',
  city: '',
  audience: 'all_levels' as const,
}

const registration = {
  capacity: 24,
  waitlistEnabled: true,
  opensAt: null,
  closesAt: null,
  membershipRequired: false,
  askFirstTimer: true,
  minAge: null,
}

const gameSystem = {
  rated: false,
  pairingMode: 'social_balanced' as const,
  rounds: null,
  timeControl: '10+5',
}

function issues(schema: ZodType, value: unknown): { path: string; message: string }[] {
  const result = schema.safeParse(value)
  return result.success ? [] : result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
}

describe('basics form schema', () => {
  it('passes a complete step', () => {
    expect(STEP_FORM_SCHEMAS.basics.safeParse(basics).success).toBe(true)
  })

  it('requires a title and treats whitespace as blank', () => {
    for (const title of ['', '   ']) {
      expect(issues(STEP_FORM_SCHEMAS.basics, { ...basics, title })).toContainEqual({
        path: 'title',
        message: 'This is required.',
      })
    }
  })

  it('requires both times', () => {
    expect(issues(STEP_FORM_SCHEMAS.basics, { ...basics, startsAt: null })).toContainEqual({
      path: 'startsAt',
      message: 'Set when the event starts.',
    })
    expect(issues(STEP_FORM_SCHEMAS.basics, { ...basics, endsAt: null })).toContainEqual({
      path: 'endsAt',
      message: 'Set when the event ends.',
    })
  })

  it('requires the end to be strictly after the start', () => {
    const message = { path: 'endsAt', message: 'The end must be after the start.' }
    expect(issues(STEP_FORM_SCHEMAS.basics, { ...basics, endsAt: basics.startsAt })).toContainEqual(message)
    expect(
      issues(STEP_FORM_SCHEMAS.basics, { ...basics, endsAt: '2026-12-01T17:00:00+05:30' }),
    ).toContainEqual(message)
  })

  it('does not report an end rule when the start is still missing', () => {
    const got = issues(STEP_FORM_SCHEMAS.basics, { ...basics, startsAt: null, endsAt: basics.endsAt })
    expect(got.map((issue) => issue.path)).toEqual(['startsAt'])
  })

  it('rejects a slug that is not a slug', () => {
    expect(issues(STEP_FORM_SCHEMAS.basics, { ...basics, slug: { lock: 'editable', value: 'Not A Slug' } })).toContainEqual(
      expect.objectContaining({ path: 'slug.value' }),
    )
  })
})

describe('registration form schema', () => {
  it('passes unlimited capacity and an open window', () => {
    expect(STEP_FORM_SCHEMAS.registration.safeParse({ ...registration, capacity: null }).success).toBe(true)
  })

  it('rejects a window that closes at or before it opens', () => {
    const window = { opensAt: '2026-11-01T10:00:00+05:30', closesAt: '2026-11-20T10:00:00+05:30' }
    expect(issues(STEP_FORM_SCHEMAS.registration, { ...registration, ...window })).toEqual([])
    expect(
      issues(STEP_FORM_SCHEMAS.registration, {
        ...registration,
        ...window,
        closesAt: window.opensAt,
      }),
    ).toContainEqual({ path: 'closesAt', message: 'Registration must close after it opens.' })
  })

  it('does not compare a window with only one side set', () => {
    expect(issues(STEP_FORM_SCHEMAS.registration, { ...registration, closesAt: '2026-11-20T10:00:00+05:30' })).toEqual([])
  })

  it('rejects a zero capacity', () => {
    expect(issues(STEP_FORM_SCHEMAS.registration, { ...registration, capacity: 0 })).not.toEqual([])
  })
})

describe('game system form schema', () => {
  it('requires a time control', () => {
    expect(issues(STEP_FORM_SCHEMAS.gameSystem, { ...gameSystem, timeControl: '  ' })).toContainEqual({
      path: 'timeControl',
      message: 'This is required.',
    })
  })

  it('requires rounds for swiss and round robin only', () => {
    const message = { path: 'rounds', message: 'Set the number of rounds.' }
    for (const pairingMode of ['swiss', 'round_robin'] as const) {
      expect(issues(STEP_FORM_SCHEMAS.gameSystem, { ...gameSystem, pairingMode, rounds: null })).toContainEqual(message)
      expect(
        STEP_FORM_SCHEMAS.gameSystem.safeParse({ ...gameSystem, pairingMode, rounds: 5 }).success,
      ).toBe(true)
    }
    expect(STEP_FORM_SCHEMAS.gameSystem.safeParse({ ...gameSystem, pairingMode: 'social_balanced' }).success).toBe(true)
  })

  it('needs a rating pool once the event is rated', () => {
    expect(STEP_FORM_SCHEMAS.gameSystem.safeParse({ ...gameSystem, rated: true }).success).toBe(false)
    expect(STEP_FORM_SCHEMAS.gameSystem.safeParse({ ...gameSystem, rated: true, pool: 'rapid' }).success).toBe(true)
  })
})

describe('experience, payment, media and communications form schemas', () => {
  const experience = {
    description: '',
    eyebrow: '',
    heading: '',
    body: '',
    highlights: [],
    logistics: [],
    faq: [],
    hostedArrival: true,
  }

  it('caps highlights at eight and defaults the optional fields', () => {
    const row = { title: 'Free tea', body: 'Chai all evening' }
    expect(STEP_FORM_SCHEMAS.experience.safeParse({ ...experience, highlights: Array(8).fill(row) }).success).toBe(true)
    expect(STEP_FORM_SCHEMAS.experience.safeParse({ ...experience, highlights: Array(9).fill(row) }).success).toBe(false)
    const parsed = STEP_FORM_SCHEMAS.experience.parse(experience) as { arrivalPromise: string; mode: null }
    expect(parsed.arrivalPromise).toBe('')
    expect(parsed.mode).toBeNull()
  })

  it('bounds the price and the hold', () => {
    const payment = { pricePaise: 29900, currency: 'INR', refundWindowHours: null, holdMinutes: 10 }
    expect(STEP_FORM_SCHEMAS.payment.safeParse(payment).success).toBe(true)
    expect(STEP_FORM_SCHEMAS.payment.safeParse({ ...payment, pricePaise: 100_000_001 }).success).toBe(false)
    expect(STEP_FORM_SCHEMAS.payment.safeParse({ ...payment, holdMinutes: 0 }).success).toBe(false)
  })

  const triggers = {
    confirmation: true,
    reminder_24h: true,
    checkin_open: true,
    pairing_published: true,
    post_event: false,
  }

  it('allows an empty gallery and exactly one email channel', () => {
    expect(
      STEP_FORM_SCHEMAS.media.safeParse({ assetIds: [], assets: [], mode: 'static', autoplay: false, intervalMs: 5000 })
        .success,
    ).toBe(true)
    expect(STEP_FORM_SCHEMAS.communications.safeParse({ triggers, channels: ['email'] }).success).toBe(true)
    expect(STEP_FORM_SCHEMAS.communications.safeParse({ triggers, channels: [] }).success).toBe(false)
    expect(STEP_FORM_SCHEMAS.communications.safeParse({ triggers, channels: ['email', 'email'] }).success).toBe(false)
  })

  it('needs every message trigger present (the record is exhaustive)', () => {
    expect(STEP_FORM_SCHEMAS.communications.safeParse({ triggers: {}, channels: ['email'] }).success).toBe(false)
    const missingOne = {
      confirmation: true,
      reminder_24h: true,
      checkin_open: true,
      pairing_published: true,
    }
    expect(STEP_FORM_SCHEMAS.communications.safeParse({ triggers: missingOne, channels: ['email'] }).success).toBe(false)
    expect(STEP_FORM_SCHEMAS.communications.safeParse({ triggers: { ...triggers, confirmation: 'yes' } }).success).toBe(
      false,
    )
  })
})

describe('STEP_FORM_SCHEMAS', () => {
  it('has one form schema per data step', () => {
    expect(Object.keys(STEP_FORM_SCHEMAS).sort()).toEqual([...STEP_DATA_KEYS].sort())
  })
})

describe('patchSchemaFor', () => {
  it('accepts a partial step but rejects unknown keys', () => {
    expect(patchSchemaFor('basics').safeParse({ title: 'Renamed' }).success).toBe(true)
    expect(patchSchemaFor('basics').safeParse({ colour: 'red' }).success).toBe(false)
  })

  it('accepts a cleared slug and unlimited capacity', () => {
    expect(patchSchemaFor('basics').safeParse({ slug: null }).success).toBe(true)
    expect(patchSchemaFor('registration').safeParse({ capacity: null }).success).toBe(true)
    expect(patchSchemaFor('registration').safeParse({ capacity: 0 }).success).toBe(false)
  })

  it('never lets a locked-out server field travel', () => {
    expect(patchSchemaFor('basics').safeParse({ status: 'published' }).success).toBe(false)
    expect(patchSchemaFor('media').safeParse({ mode: 'carousel' }).success).toBe(false)
    expect(patchSchemaFor('payment').safeParse({ currency: 'USD' }).success).toBe(false)
  })
})
