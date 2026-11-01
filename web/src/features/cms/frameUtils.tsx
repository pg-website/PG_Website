import type { ReactNode } from 'react'
import { Banner } from '@/components/ui/feedback/Banner'
import { copyFor } from '@/lib/api/error-copy'
import type { CmsSectionDto } from '@/lib/api/types/admin/cms'

/** Danger banner from the error-copy map (never raw server text). */
export function errorBanner(error: unknown, action: string): ReactNode {
  const copy = copyFor(error, { action })
  return (
    <Banner tone="danger" title={copy.title} live="alert">
      {copy.body}
    </Banner>
  )
}

export function describeLastChange(lastChange: CmsSectionDto['lastChange']): string | null {
  if (lastChange === null) return null
  const when = new Date(lastChange.at)
  const time = Number.isNaN(when.getTime())
    ? ''
    : ` on ${when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
  return `Last change by ${lastChange.by.name}${time}.`
}
