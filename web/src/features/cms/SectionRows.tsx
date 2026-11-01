'use client'

import { useQuery } from '@tanstack/react-query'
import { EmptyState } from '@/components/ui/feedback/EmptyState'
import { QueryView } from '@/components/ui/feedback/QueryView'
import { Skeleton } from '@/components/ui/feedback/Skeleton'
import { CmsStatusBadge } from '@/features/cms/CmsStatusBadge'
import { SECTION_LABELS, sameSelection, type CmsSelection } from '@/features/cms/cmsLabels'
import { RowButton } from '@/features/cms/RowButton'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import { adminCmsSectionsQuery } from '@/lib/query/query-options/admin'

const skeleton = (
  <div className="flex flex-col gap-2">
    {Array.from({ length: 5 }, (_, index) => (
      <Skeleton key={index} shape="card" className="h-16 w-full" />
    ))}
  </div>
)

/** The five site sections (S01): skeleton, error with retry, empty, data. */
export function SectionRows({
  selected,
  onSelect,
}: {
  selected: CmsSelection | null
  onSelect: (s: CmsSelection) => void
}) {
  const api = useApi().admin
  const query = useQuery(adminCmsSectionsQuery(api))
  return (
    <QueryView
      query={query}
      loadingLabel="Loading site sections"
      skeleton={skeleton}
      errorAction="load the site sections"
    >
      {(rows) =>
        rows.length === 0 ? (
          <EmptyState title="No site sections yet" framed={false}>
            The site sections have not been set up on the server. Ask a developer to seed the initial content.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => {
              const selection: CmsSelection = { kind: 'section', key: row.key }
              return (
                <RowButton
                  key={row.key}
                  label={SECTION_LABELS[row.key]}
                  selected={sameSelection(selected, selection)}
                  onSelect={() => onSelect(selection)}
                  badge={<CmsStatusBadge status={row.status} />}
                />
              )
            })}
          </ul>
        )
      }
    </QueryView>
  )
}
