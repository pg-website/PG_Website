import { StatusBadge } from '@/components/ui/StatusBadge'

/** "Not yet applied" marker for settings the backend stores but does not enforce (see NOT_APPLIED_KEYS). */
export function NotAppliedBadge() {
  return (
    <StatusBadge tone="neutral" className="ml-2 align-middle">
      Not yet applied
    </StatusBadge>
  )
}
