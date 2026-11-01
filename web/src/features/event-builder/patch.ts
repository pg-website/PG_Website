import type { LockableField } from '@/lib/api/types/admin/event-builder'
import type { PendingPatch, StepDataKey } from '@/features/event-builder/types'

// Pure helpers that turn step form values (READ shape) into the PATCH shape of E04 and back. No React.

/** Fields of each step that the server can lock once registrations or payments exist (FEAT-001 OQ-07). */
const LOCKABLE_BY_STEP: Partial<Record<StepDataKey, readonly LockableField[]>> = {
  basics: ['slug'],
  registration: ['capacity'],
  payment: ['pricePaise'],
  gameSystem: ['rated', 'pool', 'pairingMode'],
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]))
}

/** A cleared slug travels as `null` (the server clears a draft slug); a locked or unknown shape never travels. */
function slugWriteValue(value: unknown): string | null | undefined {
  if (typeof value === 'string') return value.trim() === '' ? null : value
  if (typeof value === 'object' && value !== null) {
    const slug = value as { lock?: unknown; value?: unknown }
    if (slug.lock === 'editable') {
      if (typeof slug.value === 'string') return slug.value.trim() === '' ? null : slug.value
      if (slug.value === null) return null
    }
  }
  return undefined
}

const isBlank = (text: unknown): boolean => typeof text !== 'string' || text.trim() === ''

/** Highlight and FAQ rows the author left empty are dropped before they travel, so the form matches the server. */
function withoutBlankRows(field: string, value: unknown): unknown {
  if (!Array.isArray(value)) return value
  if (field === 'highlights') {
    return value.filter(
      (row: { title?: unknown; body?: unknown } | null) => !(isBlank(row?.title) && isBlank(row?.body)),
    )
  }
  if (field === 'faq') {
    return value.filter(
      (row: { question?: unknown; answer?: unknown } | null) => !(isBlank(row?.question) && isBlank(row?.answer)),
    )
  }
  return value
}

/**
 * Read-shape step values to the flat write shape. Drops what must never travel: locked fields, the read-only slug
 * object of a published event, `currency` (the server prices) and `pool` of an unrated game. A step may give the slug
 * either as the read object or as a plain string.
 */
export function toWriteValues(
  key: StepDataKey,
  values: Record<string, unknown>,
  locked: readonly LockableField[],
): Record<string, unknown> {
  const lockedHere: readonly string[] = (LOCKABLE_BY_STEP[key] ?? []).filter((field) => locked.includes(field))
  const out: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(values)) {
    if (value === undefined) continue
    if (lockedHere.includes(field)) continue
    if (key === 'basics' && field === 'slug') {
      const slug = slugWriteValue(value)
      if (slug !== undefined) out.slug = slug
      continue
    }
    if (key === 'experience') {
      // `tags` and `mode` are UI-only (backend gap, PLAN-003 Q3 / EV-09). Never send them.
      if (field === 'tags' || field === 'mode') continue
      out[field] = withoutBlankRows(field, value)
      continue
    }
    // Media: `assets` and `mode` are read-only (the server derives them); only the list and autoplay settings travel.
    if (key === 'media' && field !== 'assetIds' && field !== 'autoplay' && field !== 'intervalMs') continue
    if (key === 'payment' && field === 'currency') continue
    if (key === 'gameSystem' && field === 'pool' && values.rated === false) continue
    out[field] = value
  }
  return out
}

/** Fields of `values` whose write value differs from `baseline`. */
export function diffStep(
  key: StepDataKey,
  baseline: Record<string, unknown>,
  values: Record<string, unknown>,
  locked: readonly LockableField[],
): Record<string, unknown> {
  const before = toWriteValues(key, baseline, locked)
  const after = toWriteValues(key, values, locked)
  const out: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(after)) {
    if (!deepEqual(before[field], value)) out[field] = value
  }
  return out
}

/** Lays write-shape edits over a step's read shape (form defaults, preview, diff baseline). */
export function overlayStep<T extends object>(
  key: StepDataKey,
  step: T,
  fields: Record<string, unknown> | undefined,
): T {
  if (fields === undefined || Object.keys(fields).length === 0) return step
  const next: Record<string, unknown> = { ...(step as Record<string, unknown>) }
  for (const [field, value] of Object.entries(fields)) {
    if (key === 'basics' && field === 'slug') {
      const current = next.slug as { lock?: string } | undefined
      if (current?.lock === 'editable' && (typeof value === 'string' || value === null)) {
        next.slug = { lock: 'editable', value }
      }
      continue
    }
    next[field] = value
  }
  return next as T
}

export function hasPending(patch: PendingPatch | null): boolean {
  if (patch === null) return false
  return Object.values(patch).some((fields) => fields !== undefined && Object.keys(fields).length > 0)
}

/** `later` wins field by field. */
export function mergePatch(earlier: PendingPatch | null, later: PendingPatch): PendingPatch {
  const out: PendingPatch = { ...earlier }
  for (const [key, fields] of Object.entries(later) as [StepDataKey, Record<string, unknown>][]) {
    out[key] = { ...out[key], ...fields }
  }
  return out
}

const STEP_ALIASES: Readonly<Record<string, string>> = {
  basics: 'basics',
  experience: 'experience',
  registration: 'registration',
  payment: 'payment',
  gamesystem: 'game_system',
  game_system: 'game_system',
  'game-system': 'game_system',
  media: 'media',
  communications: 'communications',
}

/** Splits a blocker field path (`payment.pricePaise`) into its step id and the rest. Unknown prefixes give a null step. */
export function parseBlockerField(field: string | undefined): { step: string | null; rest: string | null } {
  if (field === undefined) return { step: null, rest: null }
  const [head = '', ...tail] = field.split('.')
  const step = STEP_ALIASES[head.toLowerCase()] ?? null
  return { step, rest: step === null || tail.length === 0 ? null : tail.join('.') }
}

// ---------- Staged operational edits (M1) ----------

/**
 * Operational fields (mirror of the backend OPERATIONAL_FIELDS). On a public event the server asks for step-up before it
 * accepts them, so they are never autosaved: they wait behind an explicit "Apply changes".
 */
export const OPERATIONAL_FIELDS: Readonly<Record<string, readonly string[]>> = {
  registration: ['capacity', 'waitlistEnabled', 'minAge', 'membershipRequired'],
  payment: ['pricePaise', 'refundWindowHours', 'holdMinutes'],
  gameSystem: ['rated', 'pool', 'pairingMode', 'rounds'],
  basics: ['audience'],
}

/** Drafts autosave everything; any other status stages the operational fields. */
export function isStagedField(key: StepDataKey, field: string, status: string): boolean {
  return status !== 'draft' && (OPERATIONAL_FIELDS[key] ?? []).includes(field)
}

/** Splits unsent edits into what the autosave may send and what waits for "Apply changes". */
export function splitStaged(pending: PendingPatch, status: string): { autosave: PendingPatch; staged: PendingPatch } {
  const autosave: PendingPatch = {}
  const staged: PendingPatch = {}
  for (const [key, fields] of Object.entries(pending) as [StepDataKey, Record<string, unknown> | undefined][]) {
    if (fields === undefined) continue
    const auto: Record<string, unknown> = {}
    const wait: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(fields)) {
      if (isStagedField(key, field, status)) wait[field] = value
      else auto[field] = value
    }
    if (Object.keys(auto).length > 0) autosave[key] = auto
    if (Object.keys(wait).length > 0) staged[key] = wait
  }
  return { autosave, staged }
}

/** `step.field` paths of a patch, for example `registration.capacity`. */
export function patchPaths(patch: PendingPatch): string[] {
  return Object.entries(patch).flatMap(([key, fields]) => Object.keys(fields ?? {}).map((field) => `${key}.${field}`))
}

// ---------- Rejected fields (M2) ----------

const STEP_KEY_SET: ReadonlySet<string> = new Set([
  'basics',
  'experience',
  'registration',
  'payment',
  'gameSystem',
  'media',
  'communications',
])

/** The builder path of a server field name (`basics.endsAt`, `experience.highlights.0.title` -> `experience.highlights`). */
export function rootPath(name: string): string | null {
  const [step, field] = name.split('.')
  return step !== undefined && field !== undefined && STEP_KEY_SET.has(step) ? `${step}.${field}` : null
}

/** Form field name of a builder path (the slug is an object in the form). */
export function formFieldName(path: string): string {
  const [, field = ''] = path.split('.')
  return path === 'basics.slug' ? 'slug.value' : field
}

export interface RejectedFields {
  /** First server message per builder path that was part of `sent`. */
  rejected: Record<string, string>
  /** Messages of names that are not a sent builder field (`form`, unknown names). */
  unmapped: string[]
}

/** Sorts `error.fields` into rejected sent fields and the rest. Pure. */
export function classifyRejected(
  fields: Readonly<Record<string, readonly string[]>>,
  sent: PendingPatch,
): RejectedFields {
  const sentPaths = new Set(patchPaths(sent))
  const rejected: Record<string, string> = {}
  const unmapped: string[] = []
  for (const [name, messages] of Object.entries(fields)) {
    const message = messages[0]
    if (message === undefined) continue
    const path = rootPath(name)
    if (path !== null && sentPaths.has(path)) rejected[path] ??= message
    else unmapped.push(message)
  }
  return { rejected, unmapped }
}

/** Removes the given `step.field` paths from a patch (rejected fields must not be sent again). */
export function dropPaths(pending: PendingPatch, paths: readonly string[]): PendingPatch {
  const drop = new Set(paths)
  const out: PendingPatch = {}
  for (const [key, fields] of Object.entries(pending) as [StepDataKey, Record<string, unknown> | undefined][]) {
    if (fields === undefined) continue
    const left = Object.fromEntries(Object.entries(fields).filter(([field]) => !drop.has(`${key}.${field}`)))
    if (Object.keys(left).length > 0) out[key] = left
  }
  return out
}
