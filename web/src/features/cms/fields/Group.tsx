import type { ReactNode } from 'react'
import { Surface } from '@/components/ui/Surface'

/** Titled panel that groups related fields. */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Surface tone="admin" padding="md" as="section">
      <div className="flex min-w-0 flex-col gap-4">
        <h3 className="font-display text-xl wrap-break-word">{title}</h3>
        {children}
      </div>
    </Surface>
  )
}
