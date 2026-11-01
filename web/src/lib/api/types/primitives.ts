import { z } from 'zod'

// Shared building blocks for every DTO schema (ARCH-001 11.1, 13.3, 17.1; backend contract 2.6 to 2.8).
// Pure zod: no server-only or browser-only imports, so server fetchers and browser clients share it.

// ---------- Slugs (FR-03, M13, F-08) ----------

/** Lowercase letters and digits joined by single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const SLUG_MAX_LENGTH = 100

/**
 * Public slug as read by the frontend (ARCH-001 M13: regex, max 100). Slugs on events and stories are unique and
 * IMMUTABLE ONCE PUBLISHED (FR-03, D-03, contract 2.7): never rebuild a public URL from a different value, and never
 * show a slug field as editable after first publish. Branded so a raw string cannot reach a fetcher unvalidated.
 */
export const slugSchema = z.string().max(SLUG_MAX_LENGTH).regex(SLUG_PATTERN).brand<'Slug'>()
export type Slug = z.infer<typeof slugSchema>

/** Validates a route param (M13). Returns null on mismatch so the page can call `notFound()` before any fetch or tag operation. */
export function parseSlug(value: string): Slug | null {
  const result = slugSchema.safeParse(value)
  return result.success ? result.data : null
}

/** Authoring bound from the backend contract 2.7 (3 to 80 characters, inferred). Used by the builder (TASK-017). */
export const authoringSlugSchema = z.string().min(3).max(80).regex(SLUG_PATTERN).brand<'Slug'>()

// ---------- Ids, keys ----------

/** Internal entity id. `guid` accepts any 8-4-4-4-12 hex id, so deterministic mock ids are fine. Never used in public URLs. */
export const uuidSchema = z.guid()


/** `Idempotency-Key` header value (contract 2.5, ARCH-001 11.8): a UUID v4 created when the user's intent starts. */
export const idempotencyKeySchema = z.uuidv4().brand<'IdempotencyKey'>()
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>

// ---------- Money (contract 2.6) ----------

/** Upper sanity bound: INR 10 lakh in paise. Anything larger is a backend bug, not a price. */
export const MAX_PAISE = 100_000_000

/** Integer paise, never negative, never fractional. The browser never sends price, amount or currency (AC-35). */
export const paiseSchema = z.int().min(0).max(MAX_PAISE)
export const currencySchema = z.literal('INR')

// ---------- Time (contract 2.8) ----------

/** ISO 8601 date-time with offset, for example 2026-10-24T17:00:00+05:30. */
export const isoInstantSchema = z.iso.datetime({ offset: true })
/** Calendar date without time, YYYY-MM-DD (birthday, effective date). */
export const isoDateSchema = z.iso.date()

// ---------- Counters ----------

export const countSchema = z.int().min(0)
/** Per-entity monotonic version (OD-06). Exposed on list and detail DTOs for cheap change detection. */
export const versionSchema = z.int().min(0)

// ---------- Text ----------

/** Plain text read from the backend. Rendered as inert text (never HTML), so only the length is bounded. */
export const plainText = (max: number) => z.string().min(1).max(max)
/** Plain text typed by a user. Trimmed before the length rules apply. */
export const inputText = (max: number) => z.string().trim().min(1).max(max)

export const emailSchema = z.string().trim().max(254).pipe(z.email())

// ---------- URL refinements (ARCH-001 17.1, A.8; contract 6.3) ----------

const MAX_URL_LENGTH = 2048
const SAFE_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:', 'tel:'])

// Whitespace, C0/C1 control characters and backslashes never belong in a link. Compared by code to keep the source ASCII.
function hasForbiddenCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x5c) return true
  }
  return false
}

function parseAbsolute(value: string): URL | null {
  if (value.length === 0 || value.length > MAX_URL_LENGTH || hasForbiddenCharacter(value)) return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function hasCredentialsOrNoHost(url: URL): boolean {
  return url.username !== '' || url.password !== '' || url.hostname === ''
}

/** Absolute link restricted to http, https, mailto and tel. Rejects javascript:, data:, vbscript:, credentials, controls. */
export function isSafeHref(value: string): boolean {
  const url = parseAbsolute(value)
  if (url === null || !SAFE_SCHEMES.has(url.protocol)) return false
  if (url.protocol === 'http:' || url.protocol === 'https:') return !hasCredentialsOrNoHost(url)
  return true
}

/** Same-origin path: starts with one slash, no scheme, no `//` or `/\`, no dot segments, no controls. */
export function isInternalPath(value: string): boolean {
  if (value.length === 0 || value.length > MAX_URL_LENGTH || hasForbiddenCharacter(value)) return false
  if (!value.startsWith('/') || value.startsWith('//')) return false
  const pathOnly = value.split(/[?#]/, 1)[0] ?? ''
  return !pathOnly.split('/').some((segment) => segment === '.' || segment === '..')
}

export function isHttpsUrl(value: string): boolean {
  const url = parseAbsolute(value)
  return url !== null && url.protocol === 'https:' && !hasCredentialsOrNoHost(url)
}

/** Absolute http(s), mailto or tel link (social links, CTA targets that leave the site). */
export const safeHrefSchema = z.string().refine(isSafeHref, 'Link must be an http, https, mailto or tel URL')
/** A link from CMS data: an absolute safe link or a same-origin path such as /play. */
export const linkHrefSchema = z
  .string()
  .refine((value) => isSafeHref(value) || isInternalPath(value), 'Link must be a safe URL or a site path')
/** Absolute https URL for backend-supplied destinations (OAuth start, checkout, signed uploads). Host is checked by the adapter (F-16). */
export const httpsUrlSchema = z.string().refine(isHttpsUrl, 'URL must be an absolute https URL')

/** Local development only: the backend hands out `http://localhost` URLs. Production stays https-only. */
export function isBackendUrl(value: string): boolean {
  if (isHttpsUrl(value)) return true
  if (process.env.NODE_ENV === 'production') return false
  const url = parseAbsolute(value)
  return url !== null && url.protocol === 'http:' && !hasCredentialsOrNoHost(url)
}

/** Absolute https URL, or http outside production (read at parse time). For preview links and signed uploads. */
export const backendUrlSchema = z
  .string()
  .refine(isBackendUrl, 'URL must be an absolute https URL (http is accepted outside production)')

// ---------- Media URL allow-list policy hook (F-16, F-24, contract 6.3) ----------

/** Decides whether an ABSOLUTE media URL is acceptable. Adapters inject a host allow-list built from env. */
export type MediaUrlPolicy = (url: URL) => boolean

/** Default policy: https and query-less (F-24). The host allow-list (BACKEND_PUBLIC_HOSTS) is injected by the adapter. */
export const defaultMediaUrlPolicy: MediaUrlPolicy = (url) => url.protocol === 'https:' && url.search === ''

export function isAllowedMediaSrc(value: string, policy: MediaUrlPolicy): boolean {
  if (isInternalPath(value)) return true // local /placeholders/* and other same-origin assets
  const url = parseAbsolute(value)
  return url !== null && !hasCredentialsOrNoHost(url) && policy(url)
}

/** Builds the `src` schema for a given policy. DTO schemas use `mediaSrcSchema`; adapters re-check with their own policy. */
export function createMediaSrcSchema(policy: MediaUrlPolicy) {
  return z.string().refine((value) => isAllowedMediaSrc(value, policy), 'Media URL is not on the allow-list')
}
export const mediaSrcSchema = createMediaSrcSchema(defaultMediaUrlPolicy)

// ---------- Focal point (13.3, F-14) ----------

/** 0..1 on both axes. Out-of-range values are rejected (not clamped): they would reach `object-position` (F-14). */
export const focalSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
export type Focal = z.infer<typeof focalSchema>
