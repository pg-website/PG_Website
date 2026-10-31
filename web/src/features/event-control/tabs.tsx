import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'
import { EmptyState } from '@/components/ui/feedback/EmptyState'
import type { EventOverviewDto } from '@/lib/api/types/admin/control-overview'
import type { AdminEventTab } from '@/lib/routes/routes'

/** Props every Control Room tab receives. The shared overview is already loaded (C01), so a tab never refetches it. */
export interface ControlTabProps {
  eventId: string
  overview: EventOverviewDto
}

export const CONTROL_TAB_LABEL: Readonly<Record<AdminEventTab, string>> = {
  overview: 'Overview',
  registrations: 'Registrations',
  'check-in': 'Check-in',
  pairings: 'Pairings',
  standings: 'Standings',
  payments: 'Payments',
  messages: 'Messages',
  gallery: 'Gallery and recap',
  audit: 'Audit',
}

function makePlaceholder(tab: AdminEventTab): ComponentType<ControlTabProps> {
  const label = CONTROL_TAB_LABEL[tab]
  function TabPlaceholder() {
    return (
      <EmptyState title={`${label} is coming soon`} headingLevel={2}>
        This section of the Control Room is not available yet.
      </EmptyState>
    )
  }
  TabPlaceholder.displayName = `ControlTabPlaceholder(${tab})`
  return TabPlaceholder
}

/**
 * Tab plug-in registry (FE-30). One entry per route tab. A later task (FE-31..FE-36) replaces its entry with a lazy
 * component, for example:
 *   registrations: dynamic(() => import('@/features/event-control/registrations/RegistrationsTab').then((m) => m.RegistrationsTab))
 * The frame renders `CONTROL_TABS[tab]` under the header and summary strip, so each tab only owns its own body.
 * Keep the keys in step with `ADMIN_EVENT_TABS`; the Record type enforces it.
 */
export const CONTROL_TABS: Record<AdminEventTab, ComponentType<ControlTabProps>> = {
  overview: dynamic(() => import('@/features/event-control/overview/OverviewTab').then((m) => m.OverviewTab)),
  registrations: dynamic(() =>
    import('@/features/event-control/registrations/RegistrationsTab').then((m) => m.RegistrationsTab),
  ),
  'check-in': dynamic(() => import('@/features/event-control/check-in/CheckInTab').then((m) => m.CheckInTab)),
  pairings: dynamic(() => import('@/features/event-control/pairings/PairingsTab').then((m) => m.PairingsTab)),
  standings: dynamic(() => import('@/features/event-control/pairings/StandingsTab').then((m) => m.StandingsTab)),
  payments: dynamic(() => import('@/features/event-control/payments/PaymentsTab').then((m) => m.PaymentsTab)),
  messages: dynamic(() => import('@/features/event-control/messages/MessagesTab').then((m) => m.MessagesTab)),
  gallery: dynamic(() => import('@/features/event-control/gallery/GalleryTab').then((m) => m.GalleryTab)),
  audit: dynamic(() => import('@/features/event-control/audit/AuditTab').then((m) => m.AuditTab)),
}
