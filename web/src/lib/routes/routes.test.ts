import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ADMIN_EVENT_TABS, ROUTES, ROUTE_GROUPS, SERVER_ENDPOINTS, routeById, routesInGroup } from './routes.ts'
import { resolveRoute } from './resolve.ts'

const webRoot = process.cwd()
const repoRoot = resolve(webRoot, '..')
const appRoot = join(webRoot, 'src', 'app')

// FEAT-001 "Screen and Route Map (59)" plus "Routes outside the 59" (page routes only). Transcribed on purpose rather
// than parsed from the markdown, so a registry edit that drops a route fails here.
const FEAT_001_PAGE_ROUTES = [
  '/',
  '/play',
  '/events/[slug]',
  '/past-events',
  '/community',
  '/stories',
  '/stories/[slug]',
  '/contact',
  '/privacy',
  '/terms',
  '/refund-policy',
  '/login',
  '/auth/callback',
  '/reset-password',
  '/welcome',
  '/events/[slug]/register',
  '/app',
  '/app/events',
  '/app/events/[id]',
  '/app/rating',
  '/app/profile',
  '/admin',
  '/admin/content',
  '/admin/media',
  '/admin/stories',
  '/admin/testimonials',
  '/admin/events',
  '/admin/events/[id]/[tab]',
  '/admin/players',
  '/admin/payments',
  '/admin/settings',
  '/handoff/design-system',
  '/handoff/states',
  // outside the 59
  '/handoff',
  '/admin/events/[id]',
  '/admin/events/[id]/edit',
  '/players/[publicId]',
]

describe('route registry', () => {
  it('contains every FEAT-001 page route exactly once', () => {
    const patterns = ROUTES.map((route) => route.pattern)
    expect(new Set(patterns).size).toBe(patterns.length)
    expect(patterns.toSorted()).toEqual(FEAT_001_PAGE_ROUTES.toSorted())
  })

  it('covers FEAT-001 screens 1 to 59 (screen 12 is the global not-found)', () => {
    const screens = new Set(ROUTES.flatMap((route) => route.screens))
    const missing = Array.from({ length: 59 }, (_, i) => i + 1).filter((n) => n !== 12 && !screens.has(n))
    expect(missing).toEqual([])
  })

  it('has unique ids', () => {
    expect(new Set(ROUTES.map((route) => route.id)).size).toBe(ROUTES.length)
    expect(routeById('event').pattern).toBe('/events/[slug]')
  })

  it('matches route-manifest.json (the reference), modulo the documented additions', () => {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, 'Frontend reference', 'route-manifest.json'), 'utf8'),
    ) as Record<'public' | 'auth' | 'player' | 'admin' | 'handoff', string[]>
    const toNext = (path: string) => path.replace(/:(\w+)/g, '[$1]')
    const groupKey = { public: 'public', auth: 'auth', app: 'player', admin: 'admin', handoff: 'handoff' } as const
    // Additions beyond the manifest: story detail (row 59, OQ-01) and the Control Room routes (the manifest lists
    // only /admin/events/:id; FEAT-001 splits it into tabs and an edit entry).
    const additions = new Set(['/stories/[slug]', '/players/[publicId]', '/admin/events/[id]/[tab]', '/admin/events/[id]/edit'])
    // Removals: /admin/events/new was replaced by CreateDraftButton (create the draft, then open /edit); the manifest
    // still lists it.
    const removals = new Set(['/admin/events/new'])
    for (const group of ROUTE_GROUPS) {
      const registry = routesInGroup(group)
        .map((route) => route.pattern)
        .filter((pattern) => !additions.has(pattern))
      const expected = manifest[groupKey[group]].map(toNext).filter((pattern) => !removals.has(pattern))
      expect(registry.toSorted(), group).toEqual(expected.toSorted())
    }
  })

  it('applies the rendering matrix (ARCH-001 7.1)', () => {
    for (const route of ROUTES) {
      if (route.group === 'public') {
        expect(route.render === 'static' || route.render === 'isr', route.pattern).toBe(true)
        expect(route.noindex, route.pattern).toBe(false)
        expect(route.auth, route.pattern).toBe('none')
        expect(route.csp, route.pattern).toBe('public')
      } else {
        expect(route.render, route.pattern).toBe('dynamic')
        expect(route.noindex, route.pattern).toBe(true)
        expect(route.csp, route.pattern).toBe('client')
      }
      expect(route.devOnly, route.pattern).toBe(route.group === 'handoff')
    }
    expect(routeById('event').render).toBe('isr')
    expect(routeById('story').render).toBe('isr')
    // Registration is a client-class route even though it shares /events/[slug] with the public page.
    expect(routeById('register').group).toBe('auth')
    expect(routeById('register').csp).toBe('client')
  })

  it('requires admin for every admin route and a session for player routes', () => {
    expect(routesInGroup('admin').every((route) => route.auth === 'admin')).toBe(true)
    expect(routesInGroup('app').every((route) => route.auth === 'user')).toBe(true)
    expect(routeById('login').auth).toBe('none')
  })

  it('lists the Control Room tabs once each', () => {
    expect(new Set(ADMIN_EVENT_TABS).size).toBe(9)
    expect(routeById('event-control').expand).toEqual({ tab: ADMIN_EVENT_TABS })
  })

  it('declares the server endpoints outside the page registry', () => {
    const patterns = SERVER_ENDPOINTS.map((endpoint) => endpoint.pattern)
    expect(patterns).toEqual(
      expect.arrayContaining(['/api/revalidate', '/api/draft', '/api/draft/exit', '/api/csp-report']),
    )
  })

  it('resolves concrete paths with App Router precedence', () => {
    expect(resolveRoute('/admin/events/abc123')?.id).toBe('event-control-index')
    expect(resolveRoute('/admin/events/abc123/pairings')?.id).toBe('event-control')
    expect(resolveRoute('/admin/events/abc123/edit')?.id).toBe('event-edit')
    expect(resolveRoute('/admin/events/abc123/nonsense')).toBeUndefined()
    expect(resolveRoute('/events/spring-open')?.id).toBe('event')
    expect(resolveRoute('/events/spring-open/register')?.id).toBe('register')
    expect(resolveRoute('/nope')).toBeUndefined()
    expect(resolveRoute('/api/revalidate')).toBeUndefined()
  })
})

// The registry and src/app/** must not drift (TASK-013 acceptance: "manifest and file routes stay in sync").
function collectPages(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) collectPages(full, found)
    else if (name === 'page.tsx') found.push(full)
  }
  return found
}

describe('src/app route tree', () => {
  const pages = collectPages(appRoot).map((file) => {
    const segments = relative(appRoot, file).split(/[\\/]/).slice(0, -1)
    const group = /^\((\w+)\)$/.exec(segments[0] ?? '')?.[1]
    const pattern = `/${segments.slice(1).join('/')}`
    return { group, pattern: pattern === '/' ? '/' : pattern }
  })

  it('has a page.tsx for every registry route, in the registry group, and no others', () => {
    const fromFiles = pages.map((page) => `${page.group}:${page.pattern}`).toSorted()
    const fromRegistry = ROUTES.map((route) => `${route.group}:${route.pattern}`).toSorted()
    expect(fromFiles).toEqual(fromRegistry)
  })

  it('puts force-dynamic in every client group layout and in no public layout', () => {
    for (const group of ROUTE_GROUPS) {
      const source = readFileSync(join(appRoot, `(${group})`, 'layout.tsx'), 'utf8')
      const dynamic = /export const dynamic = 'force-dynamic'/.test(source)
      expect(dynamic, group).toBe(group !== 'public')
    }
  })

  it('does not leave force-dynamic in any page (it lives in the group layouts)', () => {
    for (const file of collectPages(appRoot)) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/force-dynamic/)
    }
  })

  it('sets noindex in every non-public group layout, and index in (public)', () => {
    for (const group of ROUTE_GROUPS) {
      const source = readFileSync(join(appRoot, `(${group})`, 'layout.tsx'), 'utf8')
      expect(source, group).toContain(group === 'public' ? 'INDEX_METADATA' : 'NOINDEX_METADATA')
    }
  })

  it('renders the SkipLink before <main> in every group layout and keeps the (handoff) mock gate', () => {
    for (const group of ROUTE_GROUPS) {
      const source = readFileSync(join(appRoot, `(${group})`, 'layout.tsx'), 'utf8')
      expect(source.indexOf('<SkipLink />'), group).toBeGreaterThan(-1)
      expect(source.indexOf('<SkipLink />'), group).toBeLessThan(source.indexOf('<MainLandmark>'))
    }
    const handoff = readFileSync(join(appRoot, '(handoff)', 'layout.tsx'), 'utf8')
    expect(handoff).toMatch(/if \(!envPublic\.USE_MOCKS\) notFound\(\)/)
  })

  it('ships error and not-found boundaries, and loading for each client group', () => {
    for (const group of ROUTE_GROUPS) expect(existsSync(join(appRoot, `(${group})`, 'error.tsx')), group).toBe(true)
    for (const group of ROUTE_GROUPS.filter((g) => g !== 'public')) {
      expect(existsSync(join(appRoot, `(${group})`, 'loading.tsx')), group).toBe(true)
    }
    expect(existsSync(join(appRoot, 'not-found.tsx'))).toBe(true)
    expect(existsSync(join(appRoot, 'global-error.tsx'))).toBe(true)
  })
})
