import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge'
import type { CmsRowStatus } from '@/lib/api/types/admin/cms'

const STATUS_VIEW: Record<CmsRowStatus, { tone: StatusTone; label: string }> = {
  clean: { tone: 'success', label: 'Published' },
  published: { tone: 'success', label: 'Published' },
  draft: { tone: 'warning', label: 'Unpublished changes' },
}

/** Badge text for a row. `unpublished` is a legal page that was never published. */
export function CmsStatusBadge({ status, unpublished = false }: { status: CmsRowStatus; unpublished?: boolean }) {
  if (unpublished && status !== 'draft') return <StatusBadge tone="neutral">Not published</StatusBadge>
  const view = STATUS_VIEW[status]
  return <StatusBadge tone={view.tone}>{view.label}</StatusBadge>
}
