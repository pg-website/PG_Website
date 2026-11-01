import { describe, expect, it, vi } from 'vitest'
import { createBuilderStore } from '@/features/event-builder/store'
import { ApiError } from '@/lib/api/errors'
import type { BuilderDraftDto } from '@/lib/api/types/admin/event-builder'

const NOW = '2026-10-01T10:00:00+05:30'

function makeDraft(overrides: Partial<BuilderDraftDto> = {}): BuilderDraftDto {
  return {
    id: '7b0e3f1e-5d8a-4f3b-9c55-2f1b0c5d9a10',
    status: 'draft',
    basics: {
      title: 'Saturday Social',
      slug: { lock: 'editable', value: 'saturday-social' },
      type: 'social',
      promise: '',
      startsAt: null,
      endsAt: null,
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
    gameSystem: { rated: false, pairingMode: 'social_balanced', rounds: null, timeControl: '' },
    media: { assetIds: [], assets: [], mode: 'static', autoplay: false, intervalMs: 5000 },
    communications: { triggers: {}, channels: ['email'] },
    lockedFields: [],
    lockedReasons: {},
    readiness: { ready: true },
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    lastChange: null,
    ...overrides,
  } as unknown as BuilderDraftDto
}

const rejection = (fields: Record<string, string[]>, status = 409): ApiError =>
  new ApiError('SLUG_TAKEN', { status, fields })

describe('builder store: rejected fields', () => {
  it('drops the rejected field, shows its message, reloads and still saves the rest', async () => {
    const initial = makeDraft()
    const reloaded = makeDraft({ version: 2 })
    const calls: unknown[] = []
    const save = vi.fn((patch: unknown) => {
      calls.push(patch)
      if (calls.length === 1) return Promise.reject(rejection({ 'basics.slug': ['That link is already used.'] }))
      return Promise.resolve(makeDraft({ version: 3 }))
    })
    const reload = vi.fn(() => Promise.resolve(reloaded))
    const store = createBuilderStore({ initial, save, reload, delayMs: 10_000 })

    store.setStepValues('basics', {
      ...initial.basics,
      title: 'Renamed',
      slug: { lock: 'editable', value: 'taken-slug' },
    })
    await store.flush()

    // The message is at the field, the server resource was re-read, the rejected value left the patch.
    expect(store.getState().fieldErrors).toEqual({ 'basics.slug': 'That link is already used.' })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(store.getState().server.version).toBe(2)
    expect(store.getState().pending).toEqual({ basics: { title: 'Renamed' } })

    // The rest goes out on the next save and the rejected slug is not resent.
    await store.flush()
    expect(save).toHaveBeenCalledTimes(2)
    expect(calls[1]).toEqual({ basics: { title: 'Renamed' } })
    store.stop()
  })

  it('does not resend an unchanged rejected value, and sends it again once the admin edits it', async () => {
    const initial = makeDraft()
    const save = vi.fn(() => Promise.reject(rejection({ 'basics.slug': ['Taken.'] })))
    const reload = vi.fn(() => Promise.resolve(makeDraft({ version: 2 })))
    const store = createBuilderStore({ initial, save, reload, delayMs: 10_000 })
    const values = { ...initial.basics, slug: { lock: 'editable', value: 'taken-slug' } }

    store.setStepValues('basics', values)
    await store.flush()
    expect(save).toHaveBeenCalledTimes(1)

    // The form fires again with the same rejected value (another field changed): still nothing to send.
    store.setStepValues('basics', values)
    await store.flush()
    expect(save).toHaveBeenCalledTimes(1)
    expect(store.getState().fieldErrors['basics.slug']).toBe('Taken.')

    // A new slug clears the message and travels.
    store.setStepValues('basics', { ...values, slug: { lock: 'editable', value: 'free-slug' } })
    expect(store.getState().fieldErrors).toEqual({})
    expect(store.getState().pending).toEqual({ basics: { slug: 'free-slug' } })
    store.stop()
  })

  it('keeps unmapped messages as a form message instead of looping', async () => {
    const initial = makeDraft()
    const save = vi.fn(() => Promise.reject(rejection({ form: ['Cannot save right now.'] }, 400)))
    const reload = vi.fn(() => Promise.resolve(makeDraft()))
    const store = createBuilderStore({ initial, save, reload, delayMs: 10_000 })
    store.setStepValues('basics', { ...initial.basics, title: 'Another' })
    await store.flush()
    expect(store.getState().save).toBe('error')
    expect(store.getState().formError).toBe('Cannot save right now.')
    expect(store.getState().pending).toEqual({ basics: { title: 'Another' } })
    expect(save).toHaveBeenCalledTimes(1)
    store.stop()
  })
})

describe('builder store: staged operational edits', () => {
  it('autosave never sends capacity or price of a live event; applyStaged does', async () => {
    const initial = makeDraft({ status: 'published' })
    const save = vi.fn<(patch: unknown) => Promise<BuilderDraftDto>>(() =>
      Promise.resolve(makeDraft({ status: 'published', version: 2 })),
    )
    const store = createBuilderStore({ initial, save, reload: () => Promise.resolve(initial), delayMs: 10_000 })

    store.setStepValues('registration', { ...initial.registration, capacity: null })
    store.setStepValues('payment', { ...initial.payment, pricePaise: 49900 })
    store.setStepValues('basics', { ...initial.basics, title: 'Live rename' })

    await store.flush()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]?.[0]).toEqual({ basics: { title: 'Live rename' } })
    expect(store.getState().pending).toEqual({ registration: { capacity: null }, payment: { pricePaise: 49900 } })

    // Flushing again (leave, step change) still sends nothing: staged edits wait for the button.
    await store.flush()
    expect(save).toHaveBeenCalledTimes(1)

    await store.applyStaged()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]?.[0]).toEqual({ registration: { capacity: null }, payment: { pricePaise: 49900 } })
    expect(store.getState().pending).toEqual({})
    store.stop()
  })

  it('autosaves everything on a draft', async () => {
    const initial = makeDraft()
    const save = vi.fn<(patch: unknown) => Promise<BuilderDraftDto>>(() => Promise.resolve(makeDraft({ version: 2 })))
    const store = createBuilderStore({ initial, save, reload: () => Promise.resolve(initial), delayMs: 10_000 })
    store.setStepValues('registration', { ...initial.registration, capacity: null })
    await store.flush()
    expect(save.mock.calls[0]?.[0]).toEqual({ registration: { capacity: null } })
    store.stop()
  })
})
