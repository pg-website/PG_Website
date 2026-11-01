import type { StatusTone } from '@/components/ui/StatusBadge'
import type { UserRole } from '@/lib/api/types/auth'
import type { RatingPool } from '@/lib/api/types/identity'
import type {
  AccountStatus,
  PermittedPrivateField,
  PlayerRatingContext,
  PlayerRowRating,
} from '@/lib/api/types/admin/players'
import type { RegistrationStatus } from '@/lib/api/types/registration'

export const ROLE_LABEL: Readonly<Record<UserRole, string>> = { player: 'Player', admin: 'Admin' }
export const ROLE_TONE: Readonly<Record<UserRole, StatusTone>> = { player: 'neutral', admin: 'copper' }

export const STATUS_LABEL: Readonly<Record<AccountStatus, string>> = { active: 'Active', suspended: 'Suspended' }
export const STATUS_TONE: Readonly<Record<AccountStatus, StatusTone>> = { active: 'success', suspended: 'warning' }

export const POOL_LABEL: Readonly<Record<RatingPool, string>> = { blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical' }

export const HISTORY_STATUS_LABEL: Readonly<Record<RegistrationStatus, string>> = {
  pending: 'Pending',
  confirming: 'Confirming',
  confirmed: 'Confirmed',
  waitlist: 'Waitlist',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
}

export const PRIVATE_FIELD_LABEL: Readonly<Record<PermittedPrivateField, string>> = {
  phone: 'Phone',
  birthday: 'Birthday',
  area: 'Area',
  chessComHandle: 'Chess.com',
  fideId: 'FIDE ID',
}

/** "1286 Rapid", or "New" when unrated or still provisional (never a made-up number). */
export function ratingText(rating: PlayerRowRating | null): string {
  if (rating === null || rating.provisional) return 'New'
  return `${String(rating.rating)} ${POOL_LABEL[rating.pool]}`
}

/** "1286 . RD 71" for the record; provisional pools say so. */
export function ratingDetail(rating: PlayerRatingContext): string {
  const base = `${String(rating.rating)} \u00b7 RD ${String(rating.rd)}`
  return rating.provisional ? `${base} \u00b7 Provisional` : base
}

/** "86%", or a dash when the player has no past registrations to measure. */
export function attendanceText(pct: number | null): string {
  return pct === null ? '\u2014' : `${String(pct)}%`
}

/** "8/9" for the record. */
export function attendanceRatio(attended: number, registered: number): string {
  return registered <= 0 ? '\u2014' : `${String(attended)}/${String(registered)}`
}

/** The search text sent to the API: trimmed and capped; empty means no `q`. Raw otherwise, the backend normalises phones. */
export function toSearchQuery(text: string): string | undefined {
  const trimmed = text.trim().slice(0, 100)
  return trimmed === '' ? undefined : trimmed
}

/** A `?player=` value is used only when it looks like an id; anything else means no selection. */
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function parseSelectedId(value: string | null): string | null {
  return value !== null && ID_PATTERN.test(value) ? value : null
}
