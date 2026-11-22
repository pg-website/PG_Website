'use client'

import { useQueryClient } from '@tanstack/react-query'
import { ConfirmAction } from '@/components/admin/ConfirmAction'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/feedback/useToast'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import type { AdminEventRowDto } from '@/lib/api/types/admin/event-list'
import { eventHref, rowTitle } from '@/features/admin/events/event-row'

export function AdminEventRowActions({ row }: { row: AdminEventRowDto }) {
  const api = useApi().admin
  const queryClient = useQueryClient()
  const toast = useToast()
  const title = rowTitle(row)

  return (
    <div className="flex flex-wrap gap-2">
      {row.capabilities.canEdit.allowed ? (
        <Button href={eventHref(row.id, '/edit')} variant="secondary" size="sm">
          Edit<span className="sr-only"> {title}</span>
        </Button>
      ) : null}
      {row.capabilities.canDelete?.allowed === true ? (
        <ConfirmAction
          renderTrigger={(open) => (
            <Button variant="secondary" size="sm" onClick={open}>
              Delete<span className="sr-only"> {title}</span>
            </Button>
          )}
          title="Delete this draft?"
          consequence={`"${title}" will be permanently deleted. This cannot be undone.`}
          confirmLabel="Delete event"
          actionLabel="delete this event"
          onConfirm={async () => {
            // Optimistically remove the row from every cached events page.
            // Use the 2-element prefix ['admin', 'events'] so TanStack's partial matching
            // covers all filter/page variants (qk.admin.events() adds a 3rd queryPart element
            // that won't match the stored keys which always carry the full filter string).
            queryClient.setQueriesData<{ items: AdminEventRowDto[]; pagination: unknown }>(
              { queryKey: ['admin', 'events'] },
              (old) => (old === undefined ? old : { ...old, items: old.items.filter((r) => r.id !== row.id) }),
            )
            await api.events.deleteEvent(row.id)
          }}
          onDone={() => {
            void queryClient.invalidateQueries({ queryKey: ['admin', 'events'] })
            toast.success('Event deleted')
          }}
        />
      ) : null}
    </div>
  )
}
