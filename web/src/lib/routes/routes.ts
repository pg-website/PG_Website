// Typed route registry (TASK-013). Single source of truth for every page URL the app serves: path pattern, route group,
// rendering mode, auth requirement, noindex flag and CSP class. Hand-written from FEAT-001 "Screen and Route Map (59)"
// plus the routes outside the 59, and kept in sync with `src/app/**` and `Frontend reference/route-manifest.json` by
// tests (routes.test.ts, app-tree.test.ts). Pure data, no directive: safe on server and client.
//
// Patterns use Next syntax (`[slug]`). The proxy matcher syntax (`:slug`) lives in csp-class.ts.
// ARCH-001 sections: 6.1 layout, 7.1 rendering matrix, 10.3 CSP route classes, 17.4 indexing.

export const ROUTE_GROUPS = ['public', 'auth', 'app', 'admin', 'handoff'] as const
export type RouteGroup = (typeof ROUTE_GROUPS)[number]

/**
 * static: prerendered at build. isr: prerendered on demand with `revalidate = 900` and `generateStaticParams`.
 * dynamic: a dynamic shell, the group layout exports `dynamic = 'force-dynamic'` (ARCH-001 7.2).
 */
export type RenderMode = 'static' | 'isr' | 'dynamic'

/** none: anyone. user: any signed-in role. admin: role admin. Guards are UX only (ARCH-001 12.5). */
export type AuthRequirement = 'none' | 'user' | 'admin'

/** public: static header from next.config. client: per-request nonce from proxy.ts (TASK-120). none: /api/* handlers. */
export type CspClass = 'public' | 'client' | 'none'

/** Event Control Room tabs (screens 46 to 53). `/admin/events/[id]/[tab]` accepts only these. */
export const ADMIN_EVENT_TABS = [
  'overview',
  'registrations',
  'check-in',
  'pairings',
  'standings',
  'payments',
  'messages',
  'gallery',
  'audit',
] as const
export type AdminEventTab = (typeof ADMIN_EVENT_TABS)[number]

export interface RouteDef {
  /** Stable id used by placeholders and tests. */
  readonly id: string
  /** Next path pattern, for example `/events/[slug]`. */
  readonly pattern: string
  readonly group: RouteGroup
  /** Human page name. */
  readonly name: string
  readonly render: RenderMode
  readonly auth: AuthRequirement
  /** True when the page carries `noindex` metadata and `X-Robots-Tag` (ARCH-001 17.4). */
  readonly noindex: boolean
  readonly csp: Exclude<CspClass, 'none'>
  /** FEAT-001 screen numbers served by this route (several screens can be states of one route). */
  readonly screens: readonly number[]
  /** Dev-only: the group layout returns 404 unless mocks are enabled (ARCH-001 7.1). */
  readonly devOnly: boolean
  /** Values a dynamic segment may take when the route is a closed set (for example `[tab]`). */
  readonly expand?: Readonly<Record<string, readonly string[]>>
}

interface Options {
  render?: 'static' | 'isr'
  auth?: AuthRequirement
  screens?: readonly number[]
  expand?: Readonly<Record<string, readonly string[]>>
}

// (public): indexed, in the sitemap, static-header CSP, no request APIs.
function pub<const Id extends string>(id: Id, pattern: string, name: string, options: Options = {}) {
  return {
    id,
    pattern,
    group: 'public',
    name,
    render: options.render ?? 'static',
    auth: 'none',
    noindex: false,
    csp: 'public',
    screens: options.screens ?? [],
    devOnly: false,
  } as const satisfies RouteDef
}

// Client groups: dynamic shell, noindex, nonce CSP.
function client<const Id extends string, const G extends Exclude<RouteGroup, 'public'>>(
  group: G,
  id: Id,
  pattern: string,
  name: string,
  options: Options = {},
) {
  return {
    id,
    pattern,
    group,
    name,
    render: 'dynamic',
    auth: options.auth ?? (group === 'admin' ? 'admin' : group === 'handoff' ? 'none' : 'user'),
    noindex: true,
    csp: 'client',
    screens: options.screens ?? [],
    devOnly: group === 'handoff',
    ...(options.expand === undefined ? {} : { expand: options.expand }),
  } as const satisfies RouteDef
}

export const ROUTES = [
  // ---- (public): FEAT-001 screens 1 to 11 and 59 (screen 12 is the global not-found) ----
  pub('home', '/', 'Home', { screens: [1] }),
  pub('play', '/play', 'Play', { screens: [2] }),
  pub('event', '/events/[slug]', 'Event', { render: 'isr', screens: [3, 4] }),
  pub('past-events', '/past-events', 'Past events', { screens: [5] }),
  pub('community', '/community', 'Community', { screens: [6] }),
  pub('stories', '/stories', 'Stories', { screens: [7] }),
  pub('story', '/stories/[slug]', 'Story', { render: 'isr', screens: [59] }),
  // Public player profile (PLAN-007): on demand, noindex (set in the page metadata).
  pub('player-profile', '/players/[publicId]', 'Player profile', { render: 'isr' }),
  pub('contact', '/contact', 'Contact', { screens: [8] }),
  pub('privacy', '/privacy', 'Privacy policy', { screens: [9] }),
  pub('terms', '/terms', 'Terms of use', { screens: [10] }),
  pub('refund-policy', '/refund-policy', 'Refund and cancellation policy', { screens: [11] }),

  // ---- (auth): screens 13 to 21. /login also serves screen 14 (`?mode=signup`) ----
  client('auth', 'login', '/login', 'Login', { auth: 'none', screens: [13, 14] }),
  client('auth', 'auth-callback', '/auth/callback', 'Sign-in callback', { auth: 'none', screens: [15] }),
  client('auth', 'reset-password', '/reset-password', 'Reset password', { auth: 'none', screens: [16] }),
  client('auth', 'welcome', '/welcome', 'Welcome', { screens: [17] }),
  // Same `[slug]` segment name as the public event page, different final path.
  client('auth', 'register', '/events/[slug]/register', 'Registration', { screens: [18, 19, 20, 21] }),

  // ---- (app): screens 22 to 31 ----
  client('app', 'player-home', '/app', 'Player home', { screens: [22] }),
  client('app', 'my-events', '/app/events', 'My events', { screens: [23] }),
  client('app', 'event-room', '/app/events/[id]', 'Event room', { screens: [24, 25, 26, 27, 28, 29] }),
  client('app', 'rating', '/app/rating', 'Ratings', { screens: [30] }),
  client('app', 'profile', '/app/profile', 'Profile', { screens: [31] }),

  // ---- (admin): screens 32 to 56 ----
  client('admin', 'admin-home', '/admin', 'Admin dashboard', { screens: [32] }),
  client('admin', 'admin-content', '/admin/content', 'Website CMS', { screens: [33] }),
  client('admin', 'admin-media', '/admin/media', 'Media', { screens: [34] }),
  client('admin', 'admin-stories', '/admin/stories', 'Stories admin', { screens: [35] }),
  client('admin', 'admin-testimonials', '/admin/testimonials', 'Testimonials admin', { screens: [36] }),
  client('admin', 'admin-events', '/admin/events', 'Events admin', { screens: [37] }),
  client('admin', 'event-builder', '/admin/events/new', 'Event builder', { screens: [38, 39, 40, 41, 42, 43, 44, 45] }),
  
  // Redirects to `/admin/events/[id]/overview` (outside the 59).
  client('admin', 'event-control-index', '/admin/events/[id]', 'Event control'),
  client('admin', 'event-control', '/admin/events/[id]/[tab]', 'Event control', {
    screens: [46, 47, 48, 49, 50, 51, 52, 53],
    expand: { tab: ADMIN_EVENT_TABS },
  }),
  // Edit an existing event in the builder (default for OQ-07, outside the 59).
  client('admin', 'event-edit', '/admin/events/[id]/edit', 'Edit event'),
  client('admin', 'admin-players', '/admin/players', 'Players admin', { screens: [54] }),
  client('admin', 'admin-payments', '/admin/payments', 'Payments admin', { screens: [55] }),
  client('admin', 'admin-settings', '/admin/settings', 'Settings admin', { screens: [56] }),

  // ---- (handoff): developer only, 404 unless mocks are enabled ----
  client('handoff', 'handoff', '/handoff', 'Handoff index'),
  client('handoff', 'handoff-design-system', '/handoff/design-system', 'Design system', { screens: [57] }),
  client('handoff', 'handoff-states', '/handoff/states', 'UI states', { screens: [58] }),
] as const

/** Public player profile path (PLAN-007). `publicId` is the opaque slug from a PublicIdentity; the segment is encoded. */
export const playerProfileHref = (publicId: string): `/players/${string}` => `/players/${encodeURIComponent(publicId)}`

export type RouteId = (typeof ROUTES)[number]['id']

/**
 * Server endpoints outside the page registry (ARCH-001 23.1). They live under `app/api/**` or are metadata files and are
 * owned by later tasks (TASK-113, 119, 122, 099). Listed so `/api/*` handling has one definition.
 */
export const SERVER_ENDPOINTS = [
  { pattern: '/api/revalidate', kind: 'handler', csp: 'none' },
  { pattern: '/api/draft', kind: 'handler', csp: 'none' },
  { pattern: '/api/draft/exit', kind: 'handler', csp: 'none' },
  { pattern: '/api/csp-report', kind: 'handler', csp: 'none' },
  { pattern: '/sitemap.xml', kind: 'metadata', csp: 'public' },
  { pattern: '/robots.txt', kind: 'metadata', csp: 'public' },
] as const satisfies readonly { pattern: string; kind: 'handler' | 'metadata'; csp: CspClass }[]

const BY_ID: ReadonlyMap<string, RouteDef> = new Map(ROUTES.map((route) => [route.id, route]))

/** Registry entry for a route id. Throws on an unknown id, which the `RouteId` type already rules out. */
export function routeById(id: RouteId): RouteDef {
  const route = BY_ID.get(id)
  if (route === undefined) throw new Error(`Unknown route id: ${id}`)
  return route
}

export function routesInGroup(group: RouteGroup): readonly RouteDef[] {
  return ROUTES.filter((route) => route.group === group)
}
