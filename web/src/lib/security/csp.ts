// Content Security Policy builders (TASK-120, ARCH-001 10.3 / DEC-005, SEC-001 F-05 / F-11 / F-22).
//
// This is the ONLY module that builds CSP strings (.claude/rules/40-frontend.mdc). Three policies, so they cannot drift:
//   1. baseline   default-deny fallback for any path that is in neither route class (F-05). Exactly the ARCH baseline.
//   2. public     static header from next.config `headers()`: `'self' 'unsafe-inline'` scripts, no nonce, so prerendered
//                 pages stay prerendered and CDN-cacheable.
//   3. client     per-request nonce + 'strict-dynamic' from src/proxy.ts, with Razorpay / Google / Supabase allowances
//                 only on the paths that need them.
//
// Pure, dependency-light and edge-safe: no `server-only`, no `process` access at module scope. next.config.ts imports it
// through a relative `.ts` path, so it must not use the `@/` alias. Hosts come from env (never literals, except the two
// fixed third parties named by ARCH-001 10.3) and are validated before they reach a header (directive injection guard).
// eslint-disable-next-line no-restricted-imports -- next.config.ts imports this module natively (no @/ alias resolution at config load)
import { detectTarget, type GuardEnv } from '../env/guard.ts'
// eslint-disable-next-line no-restricted-imports -- next.config.ts imports this module natively (no @/ alias resolution at config load)
import { patternToRegExp } from '../routes/csp-class.ts'

/** Request header carrying the per-request nonce from the proxy to server components (read by `headers()`). */
export const NONCE_HEADER = 'x-nonce'
export const ROBOTS_NOINDEX_VALUE = 'noindex, nofollow'
export const CSP_REPORT_PATH = '/api/csp-report'
export const CSP_REPORT_GROUP = 'csp-endpoint'

export type CspMode = 'enforce' | 'report-only'

export const CSP_HEADER_NAME = 'Content-Security-Policy'
export const CSP_REPORT_ONLY_HEADER_NAME = 'Content-Security-Policy-Report-Only'

export interface CspHeader {
  readonly name: typeof CSP_HEADER_NAME | typeof CSP_REPORT_ONLY_HEADER_NAME
  readonly value: string
}

export interface CspConfig {
  readonly mode: CspMode
  /** `next dev`: adds 'unsafe-eval' and the HMR websocket. Never true in a production build. */
  readonly dev: boolean
  /** The deployment target is production (VERCEL_ENV / VERCEL_TARGET_ENV). Gates upgrade-insecure-requests. */
  readonly production: boolean
  readonly googleAuth: boolean
  readonly razorpay: boolean
  /** Exact Supabase Storage host (no scheme, no wildcard) or undefined (mock builds). */
  readonly supabaseHost: string | undefined
}

// ---------- environment ----------

/** Variables this module reads. `process.env` is assignable to it. */
export type CspEnv = GuardEnv

/**
 * Staging Report-Only switch (TASK-120 notes: `NEXT_PUBLIC_CSP_REPORT_ONLY`). Only the literal 'true' enables it, and it
 * is ignored (enforcing wins) when the deployment target is production.
 */
export const REPORT_ONLY_ENV = 'NEXT_PUBLIC_CSP_REPORT_ONLY'

export function isProductionTarget(env: CspEnv): boolean {
  return detectTarget(env) === 'production'
}

/**
 * Report-Only is never emitted on production (ARCH-001 10.5, SEC-001 F-05). This is the single decision point, used by the
 * build-time `headers()` and the runtime proxy alike: on a production target the flag is ignored and the policy enforces.
 */
export function resolveCspMode(env: CspEnv): CspMode {
  if (isProductionTarget(env)) return 'enforce'
  return env[REPORT_ONLY_ENV] === 'true' ? 'report-only' : 'enforce'
}

// Exact host, optional port, no scheme, no wildcard, no separators. Anything else could add directives or sources.
const HOST_SHAPE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/i

/** Problems that must stop a build or deploy. Empty means the CSP environment is acceptable. */
export function checkCspEnv(env: CspEnv): string[] {
  const problems: string[] = []
  const flag = env[REPORT_ONLY_ENV]
  if (flag !== undefined && flag !== '' && flag !== 'true' && flag !== 'false') {
    problems.push(`${REPORT_ONLY_ENV} must be "true" or "false", got "${flag}".`)
  }
  if (flag === 'true' && isProductionTarget(env)) {
    problems.push(
      `${REPORT_ONLY_ENV}=true is not allowed on a production deployment: Content-Security-Policy-Report-Only is never used in production (ARCH-001 10.5).`,
    )
  }
  const host = env.NEXT_PUBLIC_SUPABASE_STORAGE_HOST?.trim()
  if (host !== undefined && host !== '' && !HOST_SHAPE.test(host)) {
    problems.push(
      'NEXT_PUBLIC_SUPABASE_STORAGE_HOST must be a bare host such as "abc.supabase.co" (no scheme, path or wildcard).',
    )
  }
  return problems
}

/** Throws one readable error listing every problem. Used by next.config.ts at build start. */
export function assertCspEnv(env: CspEnv): void {
  const problems = checkCspEnv(env)
  if (problems.length > 0)
    throw new Error(`CSP environment check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
}

/** Builds the config from the environment. Throws when the Supabase host is malformed (it would reach a header). */
export function readCspConfig(env: CspEnv): CspConfig {
  const host = env.NEXT_PUBLIC_SUPABASE_STORAGE_HOST?.trim()
  if (host !== undefined && host !== '' && !HOST_SHAPE.test(host)) {
    throw new Error('NEXT_PUBLIC_SUPABASE_STORAGE_HOST must be a bare host such as "abc.supabase.co".')
  }
  return {
    mode: resolveCspMode(env),
    dev: env.NODE_ENV === 'development',
    production: isProductionTarget(env),
    googleAuth: env.NEXT_PUBLIC_GOOGLE_AUTH === 'true',
    razorpay: env.NEXT_PUBLIC_RAZORPAY_ENABLED === 'true',
    supabaseHost: host === undefined || host === '' ? undefined : host.toLowerCase(),
  }
}

export function cspHeaderName(mode: CspMode): CspHeader['name'] {
  return mode === 'report-only' ? CSP_REPORT_ONLY_HEADER_NAME : CSP_HEADER_NAME
}

// ---------- third-party allowances (ARCH-001 10.3), applied per path ----------

const RAZORPAY_CONNECT = ['https://api.razorpay.com', 'https://lumberjack.razorpay.com'] as const
const RAZORPAY_FRAME = ['https://api.razorpay.com', 'https://checkout.razorpay.com'] as const
const GOOGLE = ['https://accounts.google.com'] as const

// Next proxy-matcher syntax, same dialect as CLIENT_PATH_MATCHERS.
const RAZORPAY_PATHS = ['/events/:slug/register'].map(patternToRegExp)
const GOOGLE_PATHS = ['/login', '/auth/:path*', '/events/:slug/register'].map(patternToRegExp)
// Signed-URL uploads and previews (F-22): Supabase `connect-src` / `img-src` and `blob:` only under /admin.
const ADMIN_UPLOAD_PATHS = ['/admin/:path*'].map(patternToRegExp)

const matchesAny = (patterns: readonly RegExp[], pathname: string) => patterns.some((p) => p.test(pathname))

/** Path-scoped third-party sources for the client policy. Pure function of config and path. */
export function clientAllowances(pathname: string, config: CspConfig) {
  const razorpay = config.razorpay && matchesAny(RAZORPAY_PATHS, pathname)
  const google = config.googleAuth && matchesAny(GOOGLE_PATHS, pathname)
  const upload = matchesAny(ADMIN_UPLOAD_PATHS, pathname)
  const supabase = upload && config.supabaseHost !== undefined ? [`https://${config.supabaseHost}`] : []
  // S3-protocol presigned uploads go to <ref>.storage.supabase.co, a sibling of the REST host <ref>.supabase.co.
  const supabaseS3 =
    upload && config.supabaseHost !== undefined && config.supabaseHost.endsWith('.supabase.co')
      ? [`https://${config.supabaseHost.replace(/\.supabase\.co$/, '.storage.supabase.co')}`]
      : []
  return {
    connect: [...(razorpay ? RAZORPAY_CONNECT : []), ...(google ? GOOGLE : []), ...supabase, ...supabaseS3],
    frame: [...(razorpay ? RAZORPAY_FRAME : []), ...(google ? GOOGLE : [])],
    img: [...(upload ? ['blob:'] : []), ...supabase],
    razorpay,
    google,
  }
}

// ---------- rendering ----------

type Directive = readonly [name: string, values: readonly string[]]

function render(directives: readonly Directive[]): string {
  return directives.map(([name, values]) => (values.length === 0 ? name : `${name} ${values.join(' ')}`)).join('; ')
}

const unique = (values: readonly string[]) => [...new Set(values)]

/** Default-deny fallback for paths in neither route class (SEC-001 F-05). The exact ARCH-001 10.3 baseline. */
export function buildBaselinePolicy(): string {
  return render([
    ['default-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    ['form-action', ["'self'"]],
  ])
}

// Dev-only: HMR websocket. Never present in a production build.
const DEV_CONNECT = ['ws://localhost:*', 'ws://127.0.0.1:*']

// Directives shared by both route classes. `default-src 'none'` with every fetch directive listed explicitly, so a new
// resource type is denied until someone adds it here (stricter than the ARCH baseline's `default-src 'self'`).
function tail(config: CspConfig): Directive[] {
  return [
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    ['form-action', ["'self'"]],
    ...(config.production ? ([['upgrade-insecure-requests', []]] as Directive[]) : []),
    ['report-uri', [CSP_REPORT_PATH]],
    ['report-to', [CSP_REPORT_GROUP]],
  ]
}

/**
 * Static policy for the `public` class (all of (public), sitemap.xml, robots.txt). No nonce: the header is fixed at build
 * time. `'unsafe-inline'` scripts are the accepted trade-off in ARCH-001 10.4 (Next's inline bootstrap and flight payload
 * cannot be hashed under ISR). Supabase and `blob:` are absent (F-22): images go through the same-origin optimiser.
 */
export function buildPublicPolicy(config: CspConfig): string {
  return render([
    ['default-src', ["'none'"]],
    ['script-src', ["'self'", "'unsafe-inline'", ...(config.dev ? ["'unsafe-eval'"] : [])]],
    ['style-src', ["'self'"]],
    // Focal-point `object-position` and width styles are inline style attributes (F-14).
    ['style-src-attr', ["'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:']],
    ['font-src', ["'self'"]],
    ['connect-src', ["'self'", ...(config.dev ? DEV_CONNECT : [])]],
    ['frame-src', ["'none'"]],
    ...tail(config),
  ])
}

const NONCE_SHAPE = /^[A-Za-z0-9+/]{16,}={0,2}$/

/** 16 random bytes, base64. One per request (never cached, never shared). */
export function createNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

export interface ClientPolicyInput {
  readonly nonce: string
  /** Request pathname, used to scope Razorpay / Google / Supabase allowances. */
  readonly pathname: string
  readonly config: CspConfig
}

/**
 * Strict policy for the `client` class: nonce + 'strict-dynamic' scripts, nonce styles. Third-party sources only on the
 * paths that need them and only when their flag is on (AC-33: flag off means no Google source anywhere).
 */
export function buildClientPolicy({ nonce, pathname, config }: ClientPolicyInput): string {
  if (!NONCE_SHAPE.test(nonce)) throw new Error('Invalid CSP nonce: expected base64 of at least 16 characters.')
  const allow = clientAllowances(pathname, config)
  return render([
    ['default-src', ["'none'"]],
    ['script-src', ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(config.dev ? ["'unsafe-eval'"] : [])]],
    ['style-src', ["'self'", `'nonce-${nonce}'`]],
    ['style-src-attr', ["'unsafe-inline'"]],
    ['img-src', unique(["'self'", ...allow.img])],
    ['font-src', ["'self'"]],
    ['connect-src', unique(["'self'", ...allow.connect, ...(config.dev ? DEV_CONNECT : [])])],
    ['frame-src', allow.frame.length > 0 ? unique(allow.frame) : ["'none'"]],
    ...tail(config),
  ])
}

// ---------- header objects ----------

export function baselineCspHeader(config: CspConfig): CspHeader {
  return { name: cspHeaderName(config.mode), value: buildBaselinePolicy() }
}

export function publicCspHeader(config: CspConfig): CspHeader {
  return { name: cspHeaderName(config.mode), value: buildPublicPolicy(config) }
}

export function clientCspHeader(input: ClientPolicyInput): CspHeader {
  return { name: cspHeaderName(input.config.mode), value: buildClientPolicy(input) }
}

/** Value of the `Reporting-Endpoints` header that `report-to` resolves against (F-22). Same-origin relative URL. */
export const REPORTING_ENDPOINTS_VALUE = `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`
