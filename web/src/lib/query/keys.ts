import type { RatingPool } from '@/lib/api/types/identity'

// Query key factory (ARCH-001 11.9). The first element is the domain; every later element is a primitive
// (RBP rerender-dependencies), so keys hash cheaply and compare by value. Filter objects are folded into one canonical
// string by `queryPart` (sorted keys, undefined dropped) so `{a:1,b:2}` and `{b:2,a:1}` are the same cache entry.
// Pure: no React, no TanStack import, safe anywhere. Importing it from (public) is still forbidden by depcruise (lib/query).
//
// Invalidation works by prefix: `qk.me()` = ['me'] covers every key that starts with 'me'; `qk.admin.event(id)` covers the
// event's registrations, rounds, payments and so on. Keep that nesting when adding keys.

/** Canonical, order-independent string for a filter or page query. Empty or missing becomes ''. */
export function queryPart(query: object | undefined): string {
  if (query === undefined) return ''
  const entries = Object.entries(query as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return entries.length === 0 ? '' : JSON.stringify(entries)
}

export const qk = {
  // ---- player and auth ----
  /** Session identity (A05). Role comes from here. */
  me: () => ['me'] as const,
  nextUp: () => ['me', 'next-up'] as const,
  recentGames: (q?: object) => ['me', 'recent-games', queryPart(q)] as const,
  people: () => ['me', 'people'] as const,
  myRegistrations: (q?: object) => ['me', 'registrations', queryPart(q)] as const,
  profile: () => ['me', 'profile'] as const,
  registration: (slug: string) => ['registration', slug] as const,
  registrationEvent: (slug: string) => ['registration', 'event', slug] as const,
  registrationAvailability: (slug: string) => ['registration', 'availability', slug] as const,
  registrationById: (registrationId: string) => ['registration', 'by-id', registrationId] as const,
  eventRoom: (eventId: string) => ['event-room', eventId] as const,
  ratings: () => ['me', 'ratings'] as const,
  rating: (pool: RatingPool) => ['me', 'ratings', pool] as const,
  ratingLedger: (pool: RatingPool, page: number) => ['me', 'ratings', pool, 'ledger', page] as const,
  ratingTrend: (pool: RatingPool, days: number | 'default' = 'default') =>
    ['me', 'ratings', pool, 'trend', days] as const,

  /** Public player profile (PLAN-007). */
  playerProfile: (publicId: string) => ['players', publicId] as const,

  // ---- admin (PgAdminApi groups; second element is the group) ----
  admin: {
    all: () => ['admin'] as const,
    dashboard: () => ['admin', 'dashboard'] as const,

    // events and builder (E01 to E10)
    events: (filter?: object) => ['admin', 'events', queryPart(filter)] as const,
    event: (id: string) => ['admin', 'event', id] as const,
    eventTypes: () => ['admin', 'event-types'] as const,
    slugCheck: (kind: string, slug: string) => ['admin', 'slug-check', kind, slug] as const,

    // event control room (C01 to C17); all nested under admin/event/{id}
    overview: (id: string) => ['admin', 'event', id, 'overview'] as const,
    registrations: (id: string, q?: object) => ['admin', 'event', id, 'registrations', queryPart(q)] as const,
    checkIn: (id: string, q?: object) => ['admin', 'event', id, 'check-in', queryPart(q)] as const,
    /** Prefix of every desk list of one event (all filters and searches). `checkIn(id)` is NOT a prefix: it ends in ''. */
    checkInAll: (id: string) => ['admin', 'event', id, 'check-in'] as const,
    rounds: (id: string) => ['admin', 'event', id, 'rounds'] as const,
    /** C13: payments of one event. */
    payments: (id: string, q?: object) => ['admin', 'event', id, 'payments', queryPart(q)] as const,
    /** C14: message log and one message. */
    messages: (id: string) => ['admin', 'event', id, 'messages'] as const,
    message: (id: string, messageId: string) => ['admin', 'event', id, 'messages', messageId] as const,
    /** C15 */
    communications: (id: string) => ['admin', 'event', id, 'communications'] as const,
    /** C16 */
    recap: (id: string) => ['admin', 'event', id, 'recap'] as const,
    /** C17 */
    audit: (id: string, q?: object) => ['admin', 'event', id, 'audit', queryPart(q)] as const,

    // CMS (S01 to S06)
    cms: () => ['admin', 'cms'] as const,
    cmsSection: (key: string) => ['admin', 'cms', 'section', key] as const,
    cmsVersions: (key: string) => ['admin', 'cms', 'section', key, 'versions'] as const,
    legalPage: (page: string) => ['admin', 'cms', 'legal', page] as const,

    // media (S07 to S12)
    mediaAssets: (q?: object) => ['admin', 'media', 'assets', queryPart(q)] as const,
    mediaCollections: () => ['admin', 'media', 'collections'] as const,
    mediaCollectionsPicker: (q: string) => ['admin', 'media', 'collections', 'picker', q] as const,
    mediaCollection: (id: string) => ['admin', 'media', 'collections', id] as const,

    // stories (S13, S14) and testimonials (S15, S16)
    stories: (q?: object) => ['admin', 'stories', queryPart(q)] as const,
    story: (id: string) => ['admin', 'story', id] as const,
    testimonials: (q?: object) => ['admin', 'testimonials', queryPart(q)] as const,
    testimonial: (id: string) => ['admin', 'testimonial', id] as const,

    // players (G01 to G03), global payments ledger (G04 to G06), settings (G07, G08)
    players: (q?: object) => ['admin', 'players', queryPart(q)] as const,
    player: (id: string) => ['admin', 'player', id] as const,
    ledger: (q?: object) => ['admin', 'ledger', queryPart(q)] as const,
    settings: () => ['admin', 'settings'] as const,
  },
} as const

/** Element type of `invalidates` lists: a key (or key prefix) from the factory above. */
export type AppQueryKey = readonly [string, ...unknown[]]
