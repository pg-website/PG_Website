import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { BlockersPanel } from '@/features/event-builder/BlockersPanel'
import { BuilderProvider } from '@/features/event-builder/context'
import { BuilderNavProvider } from '@/features/event-builder/nav-context'
import { createBuilderStore, type BuilderStore } from '@/features/event-builder/store'
import type { BuilderDraftDto, BuilderStep } from '@/lib/api/types/admin/event-builder'
import { expectNoAxeViolations } from '@/test/axe'
import { renderUi } from '@/test/render'

// Publish blockers come from the server's `readiness` (E03/E04). Review lists all of them; a data step lists only its
// own; every blocker with a known step deep-links to it.

const NOW = '2026-10-01T10:00:00+05:30'
const LABELS = { basics: 'Basics', media: 'Media', game_system: 'Game system' }

const TITLE_BLOCKER = { code: 'REQUIRED', reason: 'The title is required.', field: 'basics.title' }
const MEDIA_BLOCKER = {
  code: 'INVALID',
  reason: 'Every image needs alt text (or must be marked decorative).',
  field: 'media.assetIds',
}
const POOL_BLOCKER = { code: 'REQUIRED', reason: 'Choose the rating pool for a rated event.', field: 'gameSystem.pool' }

const draft = {
  id: '7b0e3f1e-5d8a-4f3b-9c55-2f1b0c5d9a10',
  status: 'draft',
  basics: {
    title: '',
    slug: { lock: 'editable', value: null },
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
    capacity: null,
    waitlistEnabled: false,
    opensAt: null,
    closesAt: null,
    membershipRequired: false,
    askFirstTimer: true,
    minAge: null,
  },
  payment: { pricePaise: 0, currency: 'INR', refundWindowHours: null, holdMinutes: 10 },
  gameSystem: { rated: false, pairingMode: 'none', rounds: null, timeControl: '' },
  media: { assetIds: [], assets: [], mode: 'static', autoplay: false, intervalMs: 5000 },
  communications: { triggers: {}, channels: ['email'] },
  lockedFields: [],
  lockedReasons: {},
  readiness: { ready: true },
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  lastChange: null,
} as unknown as BuilderDraftDto

const stores: BuilderStore[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.stop()
})

function renderPanel(step: BuilderStep, readiness: unknown) {
  const initial = { ...draft, readiness } as BuilderDraftDto
  const store = createBuilderStore({
    initial,
    save: () => Promise.resolve(initial),
    reload: () => Promise.resolve(initial),
    delayMs: 10_000,
  })
  stores.push(store)
  const goToStep = vi.fn()
  const view = renderUi(
    <BuilderProvider store={store}>
      <BuilderNavProvider goToStep={goToStep}>
        <BlockersPanel step={step} labels={LABELS} />
      </BuilderNavProvider>
    </BuilderProvider>,
  )
  return { ...view, goToStep }
}

const notReady = (...blockers: unknown[]) => ({ ready: false, blockers })

describe('BlockersPanel on the review step', () => {
  it('lists every blocker with a count and a deep link to its step', async () => {
    const { user, goToStep } = renderPanel('review', notReady(TITLE_BLOCKER, MEDIA_BLOCKER))

    expect(screen.getByText('Not ready to publish yet.')).toBeTruthy()
    expect(screen.getByText(/2 items to fix/)).toBeTruthy()
    expect(screen.getByText(TITLE_BLOCKER.reason)).toBeTruthy()
    expect(screen.getByText(MEDIA_BLOCKER.reason)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Go to Media' }))
    expect(goToStep).toHaveBeenCalledWith('media')
  })

  it('says "item" for a single blocker and maps gameSystem fields to the game system step', async () => {
    const { user, goToStep } = renderPanel('review', notReady(POOL_BLOCKER))

    expect(screen.getByText(/1 item to fix/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Go to Game system' }))
    expect(goToStep).toHaveBeenCalledWith('game_system')
  })

  it('shows the ready message when nothing is missing', () => {
    renderPanel('review', { ready: true })
    expect(screen.getByText('Ready to publish.')).toBeTruthy()
    expect(screen.getByText(/Nothing is missing/)).toBeTruthy()
  })

  it('has no axe violations', async () => {
    const { container } = renderPanel('review', notReady(TITLE_BLOCKER, MEDIA_BLOCKER))
    await expectNoAxeViolations(container)
  })
})

describe('BlockersPanel on a data step', () => {
  it('shows only its own blockers and offers no link to itself', () => {
    renderPanel('basics', notReady(TITLE_BLOCKER, MEDIA_BLOCKER))

    expect(screen.getByText('Needed before publishing.')).toBeTruthy()
    expect(screen.getByText(TITLE_BLOCKER.reason)).toBeTruthy()
    expect(screen.queryByText(MEDIA_BLOCKER.reason)).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders nothing when the blockers belong to other steps', () => {
    const { container } = renderPanel('basics', notReady(MEDIA_BLOCKER))
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when the event is ready', () => {
    const { container } = renderPanel('payment', { ready: true })
    expect(container.innerHTML).toBe('')
  })
})
