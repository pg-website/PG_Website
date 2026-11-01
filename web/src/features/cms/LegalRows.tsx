'use client'

import { useQueries } from '@tanstack/react-query'
import { CmsStatusBadge } from '@/features/cms/CmsStatusBadge'
import { LEGAL_LABELS, sameSelection, type CmsSelection } from '@/features/cms/cmsLabels'
import { RowButton } from '@/features/cms/RowButton'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import { LEGAL_PAGES } from '@/lib/api/types/legal-sitemap'
import { adminLegalPageQuery } from '@/lib/query/query-options/admin'

/** The three legal pages. Rows always show; a badge appears once that page has loaded (no list endpoint exists). */
export function LegalRows({
  selected,
  onSelect,
}: {
  selected: CmsSelection | null
  onSelect: (s: CmsSelection) => void
}) {
  const api = useApi().admin
  const results = useQueries({ queries: LEGAL_PAGES.map((page) => adminLegalPageQuery(api, page)) })
  return (
    <ul className="flex flex-col gap-2">
      {LEGAL_PAGES.map((page, index) => {
        const data = results[index]?.data
        const selection: CmsSelection = { kind: 'legal', key: page }
        return (
          <RowButton
            key={page}
            label={LEGAL_LABELS[page]}
            selected={sameSelection(selected, selection)}
            onSelect={() => onSelect(selection)}
            badge={
              data === undefined ? null : <CmsStatusBadge status={data.status} unpublished={data.published === null} />
            }
          />
        )
      })}
    </ul>
  )
}
