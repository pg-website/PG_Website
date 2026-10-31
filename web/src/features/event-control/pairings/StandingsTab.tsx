'use client'

import { useQuery } from '@tanstack/react-query'
import { QueryView } from '@/components/ui/feedback/QueryView'
import { Skeleton } from '@/components/ui/feedback/Skeleton'
import { StandingsSection } from '@/features/event-control/pairings/StandingsSection'
import type { ControlTabProps } from '@/features/event-control/tabs'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import { adminRoundsQuery } from '@/lib/query/query-options/admin'

const placeholder = (
  <div className="flex flex-col gap-3">
    <Skeleton shape="card" className="h-16" />
    <Skeleton shape="card" className="h-16" />
    <Skeleton shape="card" className="h-16" />
  </div>
)

/** Control Room Standings tab: live standings computed from finalised round results. */
export function StandingsTab({ eventId }: ControlTabProps) {
  const admin = useApi().admin
  const query = useQuery(adminRoundsQuery(admin, eventId))

  return (
    <section aria-label="Standings" className="min-w-0">
      <QueryView
        query={query}
        loadingLabel="Loading standings"
        skeleton={placeholder}
        errorAction="load the standings"
        headingLevel={2}
      >
        {(data) => <StandingsSection data={data} />}
      </QueryView>
    </section>
  )
}
