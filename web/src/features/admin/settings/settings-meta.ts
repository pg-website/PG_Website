import type { SettingsGroup } from '@/lib/api/types/admin/settings'

/**
 * Settings that are saved but not yet enforced by the backend (PLAN-005 OQ-1). They stay editable and show a
 * "Not yet applied" badge. Update this list when the backend starts reading a setting. Keys are `group.field`;
 * `eventDefaults.*` covers the whole group.
 */
export const NOT_APPLIED_KEYS: readonly string[] = [
  'auth.googleSignInEnabled',
  'auth.adminSessionHours',
  'ratings.ratingsEnabled',
  'ratings.showRatingsByDefault',
  'payments.defaultRefundWindowHours',
  'eventDefaults.*',
]

export function isNotApplied(group: SettingsGroup, field: string): boolean {
  return NOT_APPLIED_KEYS.includes(`${group}.${field}`) || NOT_APPLIED_KEYS.includes(`${group}.*`)
}

export const GROUP_LABEL: Readonly<Record<SettingsGroup, string>> = {
  brand: 'Brand & site',
  auth: 'Authentication',
  ratings: 'Ratings',
  payments: 'Payments',
  notifications: 'Notifications',
  eventDefaults: 'Event defaults',
}

export type SettingsSectionId = SettingsGroup | 'integrations'
