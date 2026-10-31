// Route-param validation (ARCH-001 M13). Run before any fetch or tag operation; call `notFound()` on mismatch.
import { ADMIN_EVENT_TABS, type AdminEventTab } from './routes.ts'

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** Event and story slugs: lower-case words joined by single hyphens, at most 100 characters. */
export function isValidSlug(value: string): boolean {
  return value.length <= 100 && SLUG.test(value)
}

/** Opaque entity ids (UUIDs or similar): URL-safe characters only, at most 64. */
export function isValidEntityId(value: string): boolean {
  return ENTITY_ID.test(value)
}

export function isAdminEventTab(value: string): value is AdminEventTab {
  return (ADMIN_EVENT_TABS as readonly string[]).includes(value)
}

const PUBLIC_ID = /^[a-z2-7]{12,16}$/

/** Opaque public player id (PLAN-007): 12 to 16 lower-case base32 characters. */
export function isValidPublicId(value: string): boolean {
  return PUBLIC_ID.test(value)
}
