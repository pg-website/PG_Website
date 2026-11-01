import { describe, expect, it } from 'vitest'
import {
  classifyRejected,
  diffStep,
  dropPaths,
  formFieldName,
  isStagedField,
  parseBlockerField,
  splitStaged,
  toWriteValues,
} from '@/features/event-builder/patch'
import { updateBuilderDraftSchema } from '@/lib/api/types/admin/event-builder'

describe('toWriteValues', () => {
  it('sends a cleared slug as null on a draft', () => {
    expect(toWriteValues('basics', { slug: { lock: 'editable', value: '' } }, [])).toEqual({ slug: null })
    expect(toWriteValues('basics', { slug: { lock: 'editable', value: null } }, [])).toEqual({ slug: null })
    expect(toWriteValues('basics', { slug: '  ' }, [])).toEqual({ slug: null })
  })

  it('keeps a typed slug and never sends a locked one', () => {
    expect(toWriteValues('basics', { slug: { lock: 'editable', value: 'my-event' } }, [])).toEqual({
      slug: 'my-event',
    })
    expect(toWriteValues('basics', { slug: { lock: 'locked', value: 'my-event' } }, [])).toEqual({})
    expect(toWriteValues('basics', { slug: 'x-y-z' }, ['slug'])).toEqual({})
  })

  it('clearing the slug of a draft that has one is a diff of null', () => {
    const server = { slug: { lock: 'editable', value: 'old-slug' } }
    expect(diffStep('basics', server, { slug: { lock: 'editable', value: '' } }, [])).toEqual({ slug: null })
    // Still empty on both sides: nothing to send.
    expect(
      diffStep('basics', { slug: { lock: 'editable', value: null } }, { slug: { lock: 'editable', value: '' } }, []),
    ).toEqual({})
  })

  it('sends null capacity (unlimited) as a diff and validates against the patch schema', () => {
    const diff = diffStep('registration', { capacity: 24 }, { capacity: null }, [])
    expect(diff).toEqual({ capacity: null })
    const body = updateBuilderDraftSchema.safeParse({ version: 3, registration: diff, basics: { slug: null } })
    expect(body.success).toBe(true)
  })

  it('drops blank highlight and FAQ rows so the form matches the server', () => {
    const values = {
      highlights: [
        { title: 'Prizes', body: 'Trophies' },
        { title: ' ', body: '' },
      ],
      faq: [
        { question: '', answer: '' },
        { question: 'Parking?', answer: '' },
      ],
    }
    expect(toWriteValues('experience', values, [])).toEqual({
      highlights: [{ title: 'Prizes', body: 'Trophies' }],
      faq: [{ question: 'Parking?', answer: '' }],
    })
  })

  it('adding only a blank row is not a change', () => {
    const server = { highlights: [], faq: [] }
    expect(diffStep('experience', server, { highlights: [{ title: '', body: '' }], faq: [] }, [])).toEqual({})
  })
})

describe('staged operational edits', () => {
  it('stages operational fields only once the event is not a draft', () => {
    expect(isStagedField('registration', 'capacity', 'draft')).toBe(false)
    expect(isStagedField('registration', 'capacity', 'published')).toBe(true)
    expect(isStagedField('payment', 'pricePaise', 'registration_open')).toBe(true)
    expect(isStagedField('gameSystem', 'pairingMode', 'published')).toBe(true)
    expect(isStagedField('gameSystem', 'rated', 'sold_out')).toBe(true)
    expect(isStagedField('basics', 'title', 'published')).toBe(false)
    expect(isStagedField('experience', 'description', 'published')).toBe(false)
  })

  it('splits a pending patch into autosave and staged parts', () => {
    const pending = {
      basics: { title: 'New title' },
      registration: { capacity: null, closesAt: '2026-11-01T10:00:00+05:30' },
      payment: { pricePaise: 50000 },
    }
    const live = splitStaged(pending, 'published')
    expect(live.autosave).toEqual({
      basics: { title: 'New title' },
      registration: { closesAt: '2026-11-01T10:00:00+05:30' },
    })
    expect(live.staged).toEqual({ registration: { capacity: null }, payment: { pricePaise: 50000 } })
    const draft = splitStaged(pending, 'draft')
    expect(draft.autosave).toEqual(pending)
    expect(draft.staged).toEqual({})
  })
})

describe('rejected fields', () => {
  const sent = { basics: { slug: 'taken-slug', title: 'T' }, payment: { pricePaise: 1 } }

  it('maps exact builder paths to the sent fields and keeps the rest as form messages', () => {
    const result = classifyRejected(
      {
        'basics.slug': ['That link is taken.'],
        'payment.pricePaise': ['Locked.', 'Second'],
        form: ['Something else.'],
        'registration.capacity': ['Not sent, so unmapped.'],
      },
      sent,
    )
    expect(result.rejected).toEqual({ 'basics.slug': 'That link is taken.', 'payment.pricePaise': 'Locked.' })
    expect(result.unmapped).toEqual(['Something else.', 'Not sent, so unmapped.'])
  })

  it('drops rejected paths from the pending patch and keeps other fields', () => {
    expect(dropPaths(sent, ['basics.slug'])).toEqual({ basics: { title: 'T' }, payment: { pricePaise: 1 } })
    expect(dropPaths(sent, ['basics.slug', 'basics.title', 'payment.pricePaise'])).toEqual({})
  })

  it('points the slug message at the nested form field', () => {
    expect(formFieldName('basics.slug')).toBe('slug.value')
    expect(formFieldName('registration.capacity')).toBe('capacity')
  })
})

describe('blocker to step mapping', () => {
  it('sends the new publish blockers to their steps', () => {
    expect(parseBlockerField('media.assetIds').step).toBe('media')
    expect(parseBlockerField('registration.closesAt').step).toBe('registration')
    expect(parseBlockerField('gameSystem.pool').step).toBe('game_system')
  })
})

describe('EV-09 experience backend gaps: tags and mode are never sent', () => {
  it('strips tags and mode from the experience write values', () => {
    const values = {
      description: 'A great event',
      eyebrow: 'Welcome',
      heading: 'Come play',
      body: 'It will be fun.',
      highlights: [],
      logistics: [],
      faq: [],
      hostedArrival: true,
      arrivalPromise: 'Walk in alone if you like.',
      mode: 'social',
      tags: ['ALL LEVELS', 'Come solo'],
    }
    const result = toWriteValues('experience', values, [])
    expect(result).not.toHaveProperty('tags')
    expect(result).not.toHaveProperty('mode')
    expect(result).toHaveProperty('arrivalPromise', 'Walk in alone if you like.')
    expect(result).toHaveProperty('hostedArrival', true)
  })

  it('adding a mode or tags is not a diff against a server response without them', () => {
    const server = {
      description: '',
      eyebrow: '',
      heading: '',
      body: '',
      highlights: [],
      logistics: [],
      faq: [],
      hostedArrival: false,
      arrivalPromise: '',
    }
    const withUiOnly = { ...server, mode: 'competitive', tags: ['Open to all'] }
    expect(diffStep('experience', server, withUiOnly, [])).toEqual({})
  })
})
