'use client'

import { useQuery } from '@tanstack/react-query'
import { QueryView } from '@/components/ui/feedback/QueryView'
import { Skeleton } from '@/components/ui/feedback/Skeleton'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import type { SiteSection } from '@/lib/api/types/site-content'
import { adminCmsVersionsQuery } from '@/lib/query/query-options/admin'

/** Read-only publish history of a section (S05, first page). No restore. Fetches only once opened would need state; it is cheap. */
export function VersionHistory({ sectionKey }: { sectionKey: SiteSection }) {
  const api = useApi().admin
  const query = useQuery(adminCmsVersionsQuery(api, sectionKey))
  return (
    <details className="min-w-0 rounded-public border border-line-admin p-4">
      <summary className="tap cursor-pointer font-semibold">Publish history</summary>
      <div className="pt-3">
        <QueryView
          query={query}
          loadingLabel="Loading publish history"
          skeleton={<Skeleton shape="block" className="h-16 w-full" />}
          errorAction="load the publish history"
        >
          {(page) =>
            page.items.length === 0 ? (
              <p className="text-label text-muted">Nothing has been published from here yet.</p>
            ) : (
              <ul className="flex min-w-0 flex-col gap-2">
                {page.items.map((entry) => (
                  <li key={entry.version} className="min-w-0 text-label wrap-break-word">
                    <span className="font-semibold">Version {entry.version}</span>
                    {' · '}
                    {new Date(entry.publishedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    {' · '}
                    {entry.publishedBy.name}
                    {entry.summary === null ? '' : ` · ${entry.summary}`}
                  </li>
                ))}
              </ul>
            )
          }
        </QueryView>
      </div>
    </details>
  )
}
