import { StatusBadge } from '@/components/ui/StatusBadge'
import type { TableColumn } from '@/components/ui/table/tableTypes'
import {
  REGISTRATION_PAYMENT_LABEL,
  REGISTRATION_STATUS_LABEL,
  REGISTRATION_STATUS_TONE,
} from '@/features/event-control/registrations/registrations-labels'
import type { AdminRegistrationDto } from '@/lib/api/types/admin/control-registrations'
import { formatEventDateTime } from '@/lib/format/date'

export const REGISTRATION_COLUMNS: readonly TableColumn<AdminRegistrationDto>[] = [
  {
    id: 'player',
    header: 'Player',
    rowHeader: true,
    priority: 'primary',
    cell: (row) => (
      <span className="grid gap-0.5">
        <span>{row.name}</span>
        {row.firstTimer ? <span className="text-sm text-ink-soft">First-timer</span> : null}
      </span>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    priority: 'primary',
    cell: (row) => (
      <StatusBadge tone={REGISTRATION_STATUS_TONE[row.status]}>{REGISTRATION_STATUS_LABEL[row.status]}</StatusBadge>
    ),
  },
  {
    id: 'payment',
    header: 'Payment',
    priority: 'primary',
    // FEAT-002 rule 6.9: explicit ternary, never `&&` with a string condition
    cell: (row) =>
      row.paymentMethod === 'cash' ? (
        <StatusBadge tone="copper">CASH</StatusBadge>
      ) : row.paymentState === null ? (
        'Free'
      ) : (
        REGISTRATION_PAYMENT_LABEL[row.paymentState]
      ),
  },
  {
    id: 'checkin',
    header: 'Check-in',
    cell: (row) => (row.checkedInAt === null ? 'Not yet' : formatEventDateTime(row.checkedInAt)),
  },
  { id: 'rating', header: 'Rating', align: 'end', cell: (row) => row.rating ?? '—' },
  { id: 'email', header: 'Email', cell: (row) => row.email },
  { id: 'phone', header: 'Phone', cell: (row) => row.phone ?? '—' },
  { id: 'registered', header: 'Registered', cell: (row) => formatEventDateTime(row.registeredAt) },
]
