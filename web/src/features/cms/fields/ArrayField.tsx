'use client'

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Surface } from '@/components/ui/Surface'
import { useModel, type Path } from '@/features/cms/fields/model'

interface ArrayFieldProps {
  path: Path
  label: string
  /** Singular noun for button names ("link" -> "Add link", "Move link 2 up"). */
  noun: string
  min?: number
  max?: number
  /** Fixed-length lists: no add, remove or reorder. */
  fixed?: boolean
  newItem: () => unknown
  renderItem: (itemPath: Path, index: number) => ReactNode
}

/** Editable list with add, remove and keyboard-reachable move up/down buttons (no drag needed). */
export function ArrayField({
  path,
  label,
  noun,
  min = 0,
  max = 50,
  fixed = false,
  newItem,
  renderItem,
}: ArrayFieldProps) {
  const model = useModel()
  const raw = model.get(path)
  const items = Array.isArray(raw) ? (raw as unknown[]) : []
  const error = model.errorAt(path)
  const locked = model.disabled
  const commit = (next: unknown[]) => {
    model.set(path, next)
  }
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return
    const next = [...items]
    const moved = next.splice(from, 1)[0]
    if (moved === undefined) return
    next.splice(to, 0, moved)
    commit(next)
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h4 className="text-label font-semibold">{label}</h4>
      {items.length === 0 ? <p className="text-label text-muted">Nothing here yet.</p> : null}
      <ul className="flex min-w-0 flex-col gap-3">
        {items.map((_, index) => (
          <li key={index} className="min-w-0">
            <Surface tone="paper" padding="md">
              <div className="flex min-w-0 flex-col gap-3">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="text-label text-muted">
                    {noun} {index + 1} of {items.length}
                  </span>
                  {fixed ? null : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={locked || index === 0}
                        aria-label={`Move ${noun} ${index + 1} up`}
                        onClick={() => {
                          move(index, index - 1)
                        }}
                      >
                        Up
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={locked || index === items.length - 1}
                        aria-label={`Move ${noun} ${index + 1} down`}
                        onClick={() => {
                          move(index, index + 1)
                        }}
                      >
                        Down
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={locked || items.length <= min}
                        aria-label={`Remove ${noun} ${index + 1}`}
                        onClick={() => {
                          commit(items.filter((__, i) => i !== index))
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
                {renderItem([...path, index], index)}
              </div>
            </Surface>
          </li>
        ))}
      </ul>
      {error === undefined ? null : (
        <p role="alert" className="text-sm font-semibold text-danger-ink">
          {error}
        </p>
      )}
      {fixed ? null : (
        <div>
          <Button
            size="sm"
            variant="secondary"
            disabled={locked || items.length >= max}
            onClick={() => {
              commit([...items, newItem()])
            }}
          >
            Add {noun}
          </Button>
        </div>
      )}
    </div>
  )
}
