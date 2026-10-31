import { ApiError } from '@/lib/api/errors'
import type { EventsQuery, PastEventsQuery, PgApi, PgPlayerApi, PgPublicApi, ReadOpts } from '@/lib/api/pg-api'
import { eventSummarySchema, type EventCardDto, type EventDetailDto } from '@/lib/api/types/event'
import type { LegalPage, SitemapEntryDto } from '@/lib/api/types/legal-sitemap'
import type { Page, PageQuery } from '@/lib/api/types/pagination'
import type { SiteSection, SiteSectionDto } from '@/lib/api/types/site-content'
import { storyCardSchema, type StoryCardDto } from '@/lib/api/types/story'
import { createMockPlayerAuth, type MockPlayerAuthOptions } from '@/lib/mock/auth/player-api'
import { createMeGroup, createRegistrationGroup } from '@/lib/mock/player/registrations'
import { createEventRoomGroup } from '@/lib/mock/player/room'
import { createRatingGroup } from '@/lib/mock/player/rating'
import { createPlayerRunner } from '@/lib/mock/player/context'
import type { PlayerStateStore } from '@/lib/mock/player/state'
import { inject, type InjectionOptions } from '@/lib/mock/latency'
import type { MockMode } from '@/lib/mock/mode'
import { paginate } from '@/lib/mock/paginate'
import { MOCK_EVENTS, MOCK_AVAILABILITY } from '@/lib/mock/seeds/events'
import { MOCK_LEGAL } from '@/lib/mock/seeds/legal'
import { MOCK_SETTINGS, MOCK_SITE } from '@/lib/mock/seeds/site'
import { MOCK_STORIES } from '@/lib/mock/seeds/stories'
import { MOCK_TESTIMONIALS } from '@/lib/mock/seeds/testimonials'
import { MOCK_SENTINEL } from '@/lib/mock/sentinel'

// The mock PgApi (ARCH-001 11.3, 11.4). PUBLIC methods are pure functions of (immutable seeds, mode): no module-level
// state, nothing written during a server render, safe for concurrent requests. The server uses mode 'default'; the
// browser passes a resolver backed by the session store (browser-api.ts).
// player.auth and player.profile are the mock auth backend (TASK-021, lib/mock/auth): their mutable state lives only in
// the browser session store passed in `auth.store`; without one (the server) they answer AUTH_REQUIRED or
// MOCK_SERVER_MUTATION. player.me/registration/eventRoom/rating (TASK-019) keep their changes in `playerStore` the same
// way. Admin still rejects with "not implemented in mock" until TASK-020.

export interface MockAdapterOptions extends InjectionOptions {
  /** Resolved on every call so a browser can change mode between calls. Default: always 'default'. */
  getMode?: () => MockMode
  /** Browser only: called after a contact message is "sent". */
  onContactSent?: () => void
  /** Mock auth backend: session store, session bridge (TokenManager), Google flag, access TTL. Default: no store. */
  auth?: MockPlayerAuthOptions
  /** Browser only: the mock player data store (registrations, Event Room progress, scenario). Default: none (server). */
  playerStore?: PlayerStateStore
}

/** Latency and failure injection for one call: the mode is resolved per call (adapter `gate`). */
function createGate(options: MockAdapterOptions) {
  return async (opts?: { signal?: AbortSignal | undefined }) => {
    const mode = options.getMode?.() ?? 'default'
    await inject(mode, options, opts?.signal)
    return mode
  }
}

/** Projects a detail seed to its card: the schema strips every detail-only field. */
function toCard(detail: EventDetailDto): EventCardDto {
  return eventSummarySchema.parse(detail)
}

function matches(card: EventCardDto, query: PastEventsQuery | EventsQuery | undefined): boolean {
  if (query === undefined) return true
  const text = query.q?.trim().toLowerCase()
  if (text !== undefined && text !== '' && !`${card.title} ${card.promise}`.toLowerCase().includes(text)) return false
  if (query.type !== undefined && card.type !== query.type) return false
  if ('audience' in query && query.audience !== undefined && card.audience !== query.audience) return false
  if ('free' in query && query.free === true && card.price.pricePaise !== 0) return false
  if ('city' in query && query.city !== undefined && card.city.toLowerCase() !== query.city.toLowerCase()) return false
  return true
}

const isPast = (status: EventCardDto['status']) => status === 'completed' || status === 'cancelled'

export function notImplementedInMock(path: string): ApiError {
  return new ApiError('HTTP_5XX', { status: 501, detail: `${MOCK_SENTINEL} ${path} is not implemented in mock` })
}

/** Deep placeholder: any `group.method(...)` rejects with "not implemented in mock". Typed through unknown on purpose. */
function unimplementedGroup<T>(name: string): T {
  const group = (groupName: string | symbol) =>
    new Proxy(
      {},
      {
        get: (_target, method) =>
          typeof method === 'string'
            ? () => Promise.reject(notImplementedInMock(`${name}.${String(groupName)}.${method}`))
            : undefined,
      },
    )
  return new Proxy({}, { get: (_target, key) => (typeof key === 'string' ? group(key) : undefined) }) as unknown as T
}

export function createMockPublicApi(options: MockAdapterOptions = {}): PgPublicApi {
  const gate = createGate(options)

  const events = (): readonly EventDetailDto[] => MOCK_EVENTS
  const bySlug = (slug: string) => events().find((event) => event.slug === slug) ?? null

  return {
    async getSiteContent<K extends SiteSection>(section: K, opts?: ReadOpts) {
      await gate(opts)
      return MOCK_SITE[section] as Extract<SiteSectionDto, { key: K }>
    },
    async getUpcomingEvents(query?: EventsQuery, opts?: ReadOpts): Promise<Page<EventCardDto>> {
      const mode = await gate(opts)
      const cards =
        mode === 'empty'
          ? []
          : events()
              .map(toCard)
              .filter((card) => !isPast(card.status) && matches(card, query))
              .toSorted((a, b) => a.startsAt.localeCompare(b.startsAt))
      return paginate(cards, query)
    },
    async getEventBySlug(slug, opts) {
      const mode = await gate(opts)
      return mode === 'empty' ? null : bySlug(slug)
    },
    async getEventAvailability(slug, opts) {
      await gate(opts)
      const availability = MOCK_AVAILABILITY[slug]
      if (availability === undefined) throw new ApiError('EVENT_NOT_FOUND', { status: 404 })
      return availability
    },
    async getPastEvents(query?: PastEventsQuery, opts?: ReadOpts): Promise<Page<EventCardDto>> {
      const mode = await gate(opts)
      const cards =
        mode === 'empty'
          ? []
          : events()
              .map(toCard)
              .filter((card) => isPast(card.status) && matches(card, query))
              .toSorted((a, b) => b.startsAt.localeCompare(a.startsAt))
      return paginate(cards, query)
    },
    async getStories(query?: PageQuery, opts?: ReadOpts): Promise<Page<StoryCardDto>> {
      const mode = await gate(opts)
      const cards = mode === 'empty' ? [] : MOCK_STORIES.map((story) => storyCardSchema.parse(story))
      return paginate(cards, query)
    },
    async getStoryBySlug(slug, opts) {
      const mode = await gate(opts)
      return mode === 'empty' ? null : (MOCK_STORIES.find((story) => story.slug === slug) ?? null)
    },
    async getTestimonials(opts) {
      const mode = await gate(opts)
      return mode === 'empty' ? [] : [...MOCK_TESTIMONIALS]
    },
    async getLegalPage(page: LegalPage, opts) {
      await gate(opts)
      return MOCK_LEGAL[page]
    },
    async getSitemapEntries(query, opts): Promise<Page<SitemapEntryDto>> {
      await gate(opts)
      const entries: SitemapEntryDto[] = [
        ...['/', '/play', '/community', '/stories', '/past-events', '/contact'].map((path) => ({
          type: 'page' as const,
          path,
          updatedAt: MOCK_SITE.home.updatedAt,
        })),
        ...events().map((event) => ({
          type: 'event' as const,
          slug: event.slug,
          updatedAt: event.updatedAt,
          ...(event.status === 'cancelled' ? { cancelled: true } : {}),
        })),
        ...MOCK_STORIES.map((story) => ({ type: 'story' as const, slug: story.slug, updatedAt: story.updatedAt })),
      ]
      return paginate(entries, query)
    },
    async getPublicSettings(opts) {
      await gate(opts)
      return MOCK_SETTINGS
    },
    async getPlayerProfile(_publicId, opts) {
      await gate(opts)
      // No mock profile data on purpose (PLAN-007): public profiles exist only against the real backend.
      throw new ApiError('HTTP_5XX', { status: 501, detail: `${MOCK_SENTINEL} player profile is not available in mock` })
    },
    async submitContact(_input, _key, opts) {
      // A mutation: browser only (ARCH-001 11.4). The body is never stored or logged.
      if (typeof window === 'undefined') throw new ApiError('MOCK_SERVER_MUTATION', { status: 0 })
      await gate(opts)
      options.onContactSent?.()
    },
  }
}

/** Player groups: auth and profile from the mock auth backend; me, registration, eventRoom and rating from lib/mock/player. */
export function createMockPlayerApi(options: MockAdapterOptions = {}): PgPlayerApi {
  const authOptions = options.auth ?? { store: null }
  const { auth, profile, bearer } = createMockPlayerAuth(authOptions, createGate(options))
  const runner = createPlayerRunner({
    authStore: authOptions.store,
    playerStore: options.playerStore ?? null,
    now: authOptions.now,
  })
  return {
    auth,
    profile,
    me: createMeGroup(runner, bearer),
    registration: createRegistrationGroup(runner, bearer),
    eventRoom: createEventRoomGroup(runner, bearer),
    rating: createRatingGroup(runner, bearer),
  }
}

/** Full mock PgApi: public and every player group served; admin rejects as not implemented. */
export function createMockPgApi(options: MockAdapterOptions = {}): PgApi {
  return {
    public: createMockPublicApi(options),
    player: createMockPlayerApi(options),
    admin: unimplementedGroup<PgApi['admin']>('admin'),
  }
}
