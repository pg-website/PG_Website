'use client'

import type { CmsSelection } from '@/features/cms/cmsLabels'
import { LegalRows } from '@/features/cms/LegalRows'
import { SectionRows } from '@/features/cms/SectionRows'

/** Left pane: the five site sections (S01) and the three legal pages (S06), each with a status badge. */
export function SectionList({
  selected,
  onSelect,
}: {
  selected: CmsSelection | null
  onSelect: (selection: CmsSelection) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h2 className="font-display text-xl">Site sections</h2>
        <SectionRows selected={selected} onSelect={onSelect} />
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="font-display text-xl">Legal pages</h2>
        <LegalRows selected={selected} onSelect={onSelect} />
      </div>
    </div>
  )
}
