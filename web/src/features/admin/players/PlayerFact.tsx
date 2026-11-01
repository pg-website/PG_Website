import type { ReactNode } from 'react'

export function PlayerFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="wrap-break-word">{children}</dd>
    </div>
  )
}

