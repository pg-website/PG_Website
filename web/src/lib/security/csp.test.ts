import { describe, expect, it } from 'vitest'
import { matchingClasses } from '@/lib/routes/csp-class'
import { ROUTES } from '@/lib/routes/routes'
import {
  CSP_HEADER_NAME,
  CSP_REPORT_ONLY_HEADER_NAME,
  REPORT_ONLY_ENV,
  assertCspEnv,
  baselineCspHeader,
  buildBaselinePolicy,
  buildClientPolicy,
  buildPublicPolicy,
  checkCspEnv,
  clientCspHeader,
  createNonce,
  publicCspHeader,
  readCspConfig,
  resolveCspMode,
  type CspConfig,
} from './csp.ts'

const base: CspConfig = {
  mode: 'enforce',
  dev: false,
  production: true,
  googleAuth: false,
  razorpay: false,
  supabaseHost: undefined,
}
const NONCE = 'AAAAAAAAAAAAAAAAAAAAAA=='

/** Parses a policy into directive name -> sources, failing on a repeated directive (browsers ignore the second). */
function parse(policy: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const part of policy.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/)
    if (name === undefined || name === '') continue
    expect(map.has(name), `duplicate directive ${name}`).toBe(false)
    map.set(name, values)
  }
  return map
}

describe('baseline policy (SEC-001 F-05)', () => {
  it('is exactly the ARCH-001 10.3 default-deny baseline', () => {
    expect(buildBaselinePolicy()).toBe(
      "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    )
  })
})

describe('public static policy (ARCH-001 10.3)', () => {
  const policy = parse(buildPublicPolicy(base))

  it('has the exact directive set in production', () => {
    expect(Object.fromEntries(policy)).toEqual({
      'default-src': ["'none'"],
      'script-src': ["'self'", "'unsafe-inline'"],
      'style-src': ["'self'"],
      'style-src-attr': ["'unsafe-inline'"],
      'img-src': ["'self'", 'data:'],
      'font-src': ["'self'"],
      'connect-src': ["'self'"],
      'frame-src': ["'none'"],
      'manifest-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'frame-ancestors': ["'none'"],
      'form-action': ["'self'"],
      'upgrade-insecure-requests': [],
      'report-uri': ['/api/csp-report'],
      'report-to': ['csp-endpoint'],
    })
  })

  it('never carries a nonce, strict-dynamic, wildcard, http: source or eval in production', () => {
    const text = buildPublicPolicy(base)
    expect(text).not.toMatch(/nonce-|strict-dynamic|unsafe-eval|http:|\*/)
    expect(text).not.toMatch(/blob:/)
  })

  it('keeps Supabase, Razorpay and Google out regardless of env (F-22)', () => {
    const text = buildPublicPolicy({ ...base, supabaseHost: 'abc.supabase.co', razorpay: true, googleAuth: true })
    expect(text).not.toMatch(/supabase|razorpay|google/)
  })

  it('omits upgrade-insecure-requests outside production and adds eval only in dev', () => {
    expect(parse(buildPublicPolicy({ ...base, production: false })).has('upgrade-insecure-requests')).toBe(false)
    expect(buildPublicPolicy({ ...base, production: false })).not.toContain('unsafe-eval')
    expect(parse(buildPublicPolicy({ ...base, dev: true, production: false })).get('script-src')).toContain(
      "'unsafe-eval'",
    )
  })
})

describe('client strict policy (ARCH-001 10.3)', () => {
  const build = (pathname: string, config: Partial<CspConfig> = {}) =>
    parse(buildClientPolicy({ nonce: NONCE, pathname, config: { ...base, ...config } }))

  it('has the exact directive set on a plain client path', () => {
    expect(Object.fromEntries(build('/app'))).toEqual({
      'default-src': ["'none'"],
      'script-src': ["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"],
      'style-src': ["'self'", `'nonce-${NONCE}'`],
      'style-src-attr': ["'unsafe-inline'"],
      'img-src': ["'self'"],
      'font-src': ["'self'"],
      'connect-src': ["'self'"],
      'frame-src': ["'none'"],
      'manifest-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'frame-ancestors': ["'none'"],
      'form-action': ["'self'"],
      'upgrade-insecure-requests': [],
      'report-uri': ['/api/csp-report'],
      'report-to': ['csp-endpoint'],
    })
  })

  it('never has unsafe-inline or unsafe-eval in script-src in production, and no wildcard or http: source', () => {
    for (const path of ['/app', '/login', '/events/x/register', '/admin/media']) {
      const config = { razorpay: true, googleAuth: true, supabaseHost: 'abc.supabase.co' }
      const text = buildClientPolicy({ nonce: NONCE, pathname: path, config: { ...base, ...config } })
      expect(parse(text).get('script-src'), path).not.toContain("'unsafe-inline'")
      expect(text, path).not.toMatch(/unsafe-eval|http:|\*|data:\s*;?[^;]*script/)
    }
  })

  it('adds Razorpay only on /events/[slug]/register and only when the flag is on', () => {
    const on = { razorpay: true }
    const register = build('/events/spring/register', on)
    expect(register.get('connect-src')).toEqual([
      "'self'",
      'https://api.razorpay.com',
      'https://lumberjack.razorpay.com',
    ])
    expect(register.get('frame-src')).toEqual(['https://api.razorpay.com', 'https://checkout.razorpay.com'])
    expect(register.get('script-src')).not.toContain('https://checkout.razorpay.com')
    for (const path of ['/app', '/login', '/admin', '/events/spring/registered']) {
      expect(buildClientPolicy({ nonce: NONCE, pathname: path, config: { ...base, ...on } }), path).not.toMatch(
        /razorpay/,
      )
    }
    expect(buildClientPolicy({ nonce: NONCE, pathname: '/events/spring/register', config: base })).not.toMatch(
      /razorpay/,
    )
  })

  it('adds Google only on sign-in paths and only when the flag is on (AC-33)', () => {
    const on = { googleAuth: true }
    expect(build('/login', on).get('connect-src')).toContain('https://accounts.google.com')
    expect(build('/login', on).get('frame-src')).toEqual(['https://accounts.google.com'])
    expect(build('/auth/callback', on).get('connect-src')).toContain('https://accounts.google.com')
    for (const path of ['/app', '/admin', '/welcome']) {
      expect(buildClientPolicy({ nonce: NONCE, pathname: path, config: { ...base, ...on } }), path).not.toMatch(
        /google/,
      )
    }
    expect(buildClientPolicy({ nonce: NONCE, pathname: '/login', config: base })).not.toMatch(/google/)
  })

  it('scopes the Supabase host and blob: to /admin (F-22)', () => {
    const on = { supabaseHost: 'abc.supabase.co' }
    expect(build('/admin/media', on).get('connect-src')).toEqual([
      "'self'",
      'https://abc.supabase.co',
      'https://abc.storage.supabase.co',
    ])
    expect(build('/admin/media', on).get('img-src')).toEqual(["'self'", 'blob:', 'https://abc.supabase.co'])
    expect(buildClientPolicy({ nonce: NONCE, pathname: '/app', config: { ...base, ...on } })).not.toMatch(
      /supabase|blob:/,
    )
  })

  it('adds unsafe-eval and the HMR socket in dev only', () => {
    const dev = build('/app', { dev: true, production: false })
    expect(dev.get('script-src')).toContain("'unsafe-eval'")
    expect(dev.get('connect-src')).toContain('ws://localhost:*')
    expect(build('/app').get('script-src')).not.toContain("'unsafe-eval'")
  })

  it('rejects a nonce that could break out of the header', () => {
    for (const nonce of ["x'; script-src *", 'short', 'a b c d e f g h i j k l m n o p', '']) {
      expect(() => buildClientPolicy({ nonce, pathname: '/app', config: base }), nonce).toThrow(/nonce/)
    }
  })

  it('generates a unique base64 nonce of at least 128 bits per request', () => {
    const nonces = Array.from({ length: 500 }, () => createNonce())
    expect(new Set(nonces).size).toBe(500)
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/)
      expect(atob(nonce)).toHaveLength(16)
    }
    const a = buildClientPolicy({ nonce: nonces[0] ?? '', pathname: '/app', config: base })
    const b = buildClientPolicy({ nonce: nonces[1] ?? '', pathname: '/app', config: base })
    expect(a).not.toBe(b)
  })

  it('builds a valid policy for every client route in the registry', () => {
    for (const route of ROUTES.filter((r) => r.csp === 'client')) {
      const path = route.pattern.replace(/\[(\w+)\]/g, 'x')
      expect(matchingClasses(path), path).toEqual(['client'])
      expect(buildClientPolicy({ nonce: NONCE, pathname: path, config: base }), path).toContain("'strict-dynamic'")
    }
  })
})

describe('Report-Only refusal in production (ARCH-001 10.5, SEC-001 F-05)', () => {
  it('enables report-only only when the flag is exactly "true" on a non-production target', () => {
    expect(resolveCspMode({ [REPORT_ONLY_ENV]: 'true', VERCEL_ENV: 'preview' })).toBe('report-only')
    expect(resolveCspMode({ [REPORT_ONLY_ENV]: 'true' })).toBe('report-only') // local
    expect(resolveCspMode({ [REPORT_ONLY_ENV]: 'true', VERCEL_TARGET_ENV: 'staging' })).toBe('report-only')
    for (const value of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
      expect(resolveCspMode({ [REPORT_ONLY_ENV]: value, VERCEL_ENV: 'preview' }), String(value)).toBe('enforce')
    }
  })

  it('refuses report-only on production, by either Vercel variable', () => {
    expect(resolveCspMode({ [REPORT_ONLY_ENV]: 'true', VERCEL_ENV: 'production' })).toBe('enforce')
    expect(resolveCspMode({ [REPORT_ONLY_ENV]: 'true', VERCEL_TARGET_ENV: 'production' })).toBe('enforce')
    expect(readCspConfig({ [REPORT_ONLY_ENV]: 'true', VERCEL_ENV: 'production' }).mode).toBe('enforce')
  })

  it('fails the environment check loudly rather than silently downgrading', () => {
    expect(checkCspEnv({ [REPORT_ONLY_ENV]: 'true', VERCEL_ENV: 'production' })[0]).toMatch(
      /not allowed on a production/,
    )
    expect(() => assertCspEnv({ [REPORT_ONLY_ENV]: 'true', VERCEL_ENV: 'production' })).toThrow(
      /CSP environment check failed/,
    )
    expect(checkCspEnv({ [REPORT_ONLY_ENV]: 'maybe' })[0]).toMatch(/"true" or "false"/)
    expect(checkCspEnv({ [REPORT_ONLY_ENV]: 'true', VERCEL_ENV: 'preview' })).toEqual([])
    expect(checkCspEnv({})).toEqual([])
  })

  it('never emits a Report-Only header name when the target is production', () => {
    const env = { [REPORT_ONLY_ENV]: 'true', VERCEL_ENV: 'production' }
    const config = readCspConfig(env)
    expect(publicCspHeader(config).name).toBe(CSP_HEADER_NAME)
    expect(clientCspHeader({ nonce: NONCE, pathname: '/app', config }).name).toBe(CSP_HEADER_NAME)
    expect(baselineCspHeader(config).name).toBe(CSP_HEADER_NAME)
  })

  it('emits exactly one header, named Report-Only, in staging mode', () => {
    const config = readCspConfig({ [REPORT_ONLY_ENV]: 'true', VERCEL_ENV: 'preview' })
    expect(publicCspHeader(config).name).toBe(CSP_REPORT_ONLY_HEADER_NAME)
    expect(clientCspHeader({ nonce: NONCE, pathname: '/app', config }).name).toBe(CSP_REPORT_ONLY_HEADER_NAME)
  })
})

describe('environment parsing', () => {
  it('reads flags, host and target', () => {
    const config = readCspConfig({
      VERCEL_ENV: 'production',
      NEXT_PUBLIC_GOOGLE_AUTH: 'true',
      NEXT_PUBLIC_RAZORPAY_ENABLED: 'true',
      NEXT_PUBLIC_SUPABASE_STORAGE_HOST: ' ABC.supabase.co ',
    })
    expect(config).toMatchObject({
      production: true,
      googleAuth: true,
      razorpay: true,
      supabaseHost: 'abc.supabase.co',
      dev: false,
    })
  })

  it('rejects a Supabase host that could inject directives or sources', () => {
    for (const host of ['https://abc.supabase.co', 'a.co; script-src *', '*.supabase.co', 'a.co/path', 'a b.co']) {
      expect(() => readCspConfig({ NEXT_PUBLIC_SUPABASE_STORAGE_HOST: host }), host).toThrow(/bare host/)
      expect(checkCspEnv({ NEXT_PUBLIC_SUPABASE_STORAGE_HOST: host }), host).toHaveLength(1)
    }
  })
})

describe('exclusivity with the route classes', () => {
  it('maps every registered page to exactly one policy builder', () => {
    for (const route of ROUTES) {
      const path = route.pattern.replace(/\[(\w+)\]/g, 'x')
      const classes = matchingClasses(path)
      expect(classes, path).toHaveLength(1)
      expect(classes[0], path).toBe(route.csp)
    }
  })
})
