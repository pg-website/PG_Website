'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { CmsContent } from '@/lib/api/types/admin/cms'

// CMS-F3: path-based model over one section's `content`. The editors are thin forms; this holds the immutable update and
// maps zod issue paths to the field that owns them (the frame separately blocks Save with the same schema).

export type Path = readonly (string | number)[]

export function getIn(source: unknown, path: Path): unknown {
  let current = source
  for (const part of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string | number, unknown>)[part]
  }
  return current
}

export function setIn<T>(source: T, path: Path, next: unknown): T {
  const [head, ...rest] = path
  if (head === undefined) return next as T
  const copy: Record<string | number, unknown> = Array.isArray(source)
    ? ([...(source as unknown[])] as unknown as Record<string | number, unknown>)
    : { ...(source as Record<string, unknown>) }
  copy[head] = setIn(copy[head], rest, next)
  return copy as T
}

/** Same as above for a legal draft, whose fields sit at the top level (`title`, `effectiveDate`, `blocks.0.text`). */
export function legalIssuesToFieldErrors(
  issues: readonly { path: PropertyKey[]; message: string }[],
): Map<string, string> {
  const map = new Map<string, string>()
  for (const issue of issues) {
    const key = issue.path.map(String).join('.')
    if (!map.has(key)) map.set(key, issue.message)
  }
  return map
}

interface Model {
  get: (path: Path) => unknown
  set: (path: Path, next: unknown) => void
  errorAt: (path: Path) => string | undefined
  disabled: boolean
}

const ModelContext = createContext<Model | null>(null)

/**
 * Field errors owned by the frame (the same schema result that blocks Save), keyed by the dotted path under `content`.
 * Null until the user has tried to save, so a fresh edit does not light up every incomplete field.
 */
export const FieldErrorsContext = createContext<ReadonlyMap<string, string> | null>(null)

const NO_ERRORS: ReadonlyMap<string, string> = new Map()

/** Turns zod issues for a `{ key, version, content }` draft into a path -> first message map. */
export function issuesToFieldErrors(issues: readonly { path: PropertyKey[]; message: string }[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const issue of issues) {
    const [first, ...rest] = issue.path
    if (first !== 'content') continue
    const key = rest.join('.')
    if (!map.has(key)) map.set(key, issue.message)
  }
  return map
}

export function useModel(): Model {
  const model = useContext(ModelContext)
  if (model === null) throw new Error('Field used outside an editor model')
  return model
}

export function ModelProvider({
  value,
  onChange,
  disabled,
  children,
}: {
  value: CmsContent
  onChange: (next: CmsContent) => void
  disabled: boolean
  children: ReactNode
}) {
  const errors = useContext(FieldErrorsContext) ?? NO_ERRORS
  const model = useMemo<Model>(
    () => ({
      get: (path) => getIn(value.content, path),
      set: (path, next) => {
        onChange(setIn(value, ['content', ...path], next))
      },
      errorAt: (path) => errors.get(path.join('.')),
      disabled,
    }),
    [value, onChange, errors, disabled],
  )
  return <ModelContext.Provider value={model}>{children}</ModelContext.Provider>
}
