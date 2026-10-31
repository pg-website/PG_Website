'use client'

import { useQueryClient } from '@tanstack/react-query'
import { ConfirmAction } from '@/components/admin/ConfirmAction'
import { CancelAction } from '@/features/event-control/CancelAction'
import { CompleteAction } from '@/features/event-control/CompleteAction'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/feedback/useToast'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import type { EventOverviewDto } from '@/lib/api/types/admin/control-overview'
import { qk } from '@/lib/query/keys'

/**
 * Event lifecycle buttons of the Control Room header (E07 to E10). Each shows only when the server's capability says it is
 * allowed (AC-84); nothing is inferred from `status`. Publish, cancel and complete go through ConfirmAction, which creates
 * the Idempotency-Key per intent. Cancel step-up is handled by the admin adapter (the server decides if a grant is needed).
 */
export function LifecycleActions({ overview }: { overview: EventOverviewDto }) {
  const api = useApi().admin
  const queryClient = useQueryClient()
  const toast = useToast()
  const caps = overview.capabilities
  const id = overview.eventId

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.admin.event(id) }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'events'] }),
      queryClient.invalidateQueries({ queryKey: qk.admin.dashboard() }),
    ])
  }

  return (
    <div className="flex flex-wrap gap-3">
      {caps.canPublish?.allowed === true ? (
        <ConfirmAction
          renderTrigger={(open) => <Button onClick={open}>Publish</Button>}
          title="Publish this event?"
          consequence="The event goes live on the public site and the address (slug) is locked from now on."
          confirmLabel="Publish event"
          actionLabel="publish this event"
          onConfirm={async (key) => {
            try {
              await api.events.publishEvent(id, key)
            } catch (error) {
              await refresh() // a refusal changes what the server lists as blockers
              throw error
            }
          }}
          onDone={() => {
            void refresh()
            toast.success('Event published')
          }}
        />
      ) : null}

      {caps.canUnpublish?.allowed === true ? (
        <ConfirmAction
          renderTrigger={(open) => (
            <Button variant="secondary" onClick={open}>
              Unpublish
            </Button>
          )}
          title="Unpublish this event?"
          consequence="The event returns to draft and disappears from the public site. The address (slug) stays locked."
          confirmLabel="Unpublish"
          actionLabel="unpublish this event"
          onConfirm={async (key) => {
            await api.events.unpublishEvent(id, { idempotencyKey: key })
          }}
          onDone={() => {
            void refresh()
            toast.success('Event unpublished')
          }}
        />
      ) : null}

      {caps.canOpenRegistration?.allowed === true ? (
        <ConfirmAction
          renderTrigger={(open) => <Button onClick={open}>Open registrations</Button>}
          title="Open registrations for this event?"
          consequence="Players will be able to register from the public event page immediately."
          confirmLabel="Open registrations"
          actionLabel="open registrations for this event"
          onConfirm={async (key) => {
            try {
              await api.events.openRegistrations(id, key)
            } catch (error) {
              await refresh()
              throw error
            }
          }}
          onDone={() => {
            void refresh()
            toast.success('Registrations opened')
          }}
        />
      ) : null}

      {caps.canCloseRegistration?.allowed === true ? (
        <ConfirmAction
          renderTrigger={(open) => (
            <Button variant="secondary" onClick={open}>Close registrations</Button>
          )}
          title="Close registrations?"
          consequence="Players will no longer be able to register. This takes effect immediately."
          confirmLabel="Close registrations"
          actionLabel="close registrations for this event"
          onConfirm={async () => {
            try {
              await api.events.closeRegistrations(id)
            } catch (error) {
              await refresh()
              throw error
            }
          }}
          onDone={() => {
            void refresh()
            toast.success('Registrations closed')
          }}
        />
      ) : null}

      {caps.canComplete.allowed ? <CompleteAction eventId={id} onDone={refresh} /> : null}
      {caps.canCancel.allowed ? <CancelAction eventId={id} onDone={refresh} /> : null}
    </div>
  )
}
