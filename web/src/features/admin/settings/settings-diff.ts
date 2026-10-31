import type { SettingsPatch } from '@/lib/api/types/admin/settings'

type Group = Exclude<keyof SettingsPatch, 'version'>

/** Fields of `values` whose value differs from `original` (deep compare through JSON; values are plain data). */
export function changedFields<T extends object>(original: T, values: T): Partial<T> {
  const out: Partial<T> = {}
  for (const key of Object.keys(values) as (keyof T)[]) {
    if (JSON.stringify(original[key]) !== JSON.stringify(values[key])) out[key] = values[key]
  }
  return out
}

/** Builds a single-group patch with `version`, or null when nothing changed. */
export function buildPatch<G extends Group>(
  group: G,
  version: number,
  original: object,
  values: object,
): SettingsPatch | null {
  const diff = changedFields(original as Record<string, unknown>, values as Record<string, unknown>)
  if (Object.keys(diff).length === 0) return null
  return { version, [group]: diff } as SettingsPatch
}
