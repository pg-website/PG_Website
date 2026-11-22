'use client'

import { useQuery } from '@tanstack/react-query'
import { GalleryRecapContent } from '@/features/event-control/gallery/GalleryRecapContent'
import { QueryView } from '@/components/ui/feedback/QueryView'
import { Skeleton } from '@/components/ui/feedback/Skeleton'
import type { ControlTabProps } from '@/features/event-control/tabs'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import { adminRecapQuery } from '@/lib/query/query-options/admin'

/** Gallery and recap tab (screen 52, C16). */
export function GalleryTab({ eventId }: ControlTabProps) {
  const api = useApi()
  const query = useQuery(adminRecapQuery(api.admin, eventId))

  return (
    <QueryView
      query={query}
      loadingLabel="Loading gallery and recap"
      skeleton={
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
      errorAction="load gallery and recap"
    >
      {(recap) => <GalleryRecapContent eventId={eventId} recap={recap} />}
    </QueryView>
  )
}
