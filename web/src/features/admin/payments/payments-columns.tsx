import { StatusBadge } from '@/components/ui/StatusBadge'
import type { TableColumn } from '@/components/ui/table/tableTypes'
import {
  MISMATCH_LABEL,
  ORDER_STATE_LABEL,
  ORDER_STATE_TONE,
  REFUND_STATE_LABEL,
  REFUND_STATE_TONE,
} from '@/features/admin/payments/payments-labels'
import type { AdminLedgerRowDto } from '@/lib/api/types/admin/payments'
import { formatEventDateTime } from '@/lib/format/date'
import { formatInr } from '@/lib/format/money'

// Ledger columns (screen 55). Provider ids are shown to admins only. Mismatches are shown, never hidden or auto-fixed.

export const LEDGER_COLUMNS: readonly TableColumn<AdminLedgerRowDto>[] = [
  { id: 'player', header: 'Player', rowHeader: true, priority: 'primary', cell: (row) => row.playerName },
  { id: 'event', header: 'Event', priority: 'primary', cell: (row) => row.eventTitle },
  {
    id: 'amount',
    header: 'Amount',
    align: 'end',
    priority: 'primary',
    cell: (row) => formatInr(row.amountPaise, { zero: 'amount' }),
  },
  {
    id: 'state',
    header: 'Status',
    priority: 'primary',
    // FEAT-002 rule 6.9: explicit ternary for cash payment rows
    cell: (row) =>
      row.paymentMethod === 'cash' ? (
        <span className="inline-flex flex-col gap-0.5">
          <StatusBadge tone="copper">CASH</StatusBadge>
          {row.actorName !== null && row.actorName !== undefined ? (
            <span className="text-xs text-ink-soft">By {row.actorName}</span>
          ) : null}
        </span>
      ) : (
        <StatusBadge tone={ORDER_STATE_TONE[row.state]}>{ORDER_STATE_LABEL[row.state]}</StatusBadge>
      ),
  },
  {
    id: 'refund',
    header: 'Refund',
    cell: (row) => (
      <div className="grid gap-1">
        <StatusBadge tone={REFUND_STATE_TONE[row.refundState]}>{REFUND_STATE_LABEL[row.refundState]}</StatusBadge>
        {row.refundedPaise > 0 ? (
          <span className="text-sm text-ink-soft">{formatInr(row.refundedPaise, { zero: 'amount' })} returned</span>
        ) : null}
      </div>
    ),
  },
  {
    id: 'mismatch',
    header: 'Provider check',
    priority: 'primary',
    cell: (row) =>
      row.mismatch.mismatch ? (
        <div className="grid gap-1">
          <StatusBadge tone="danger">{MISMATCH_LABEL[row.mismatch.kind]}</StatusBadge>
          <span className="text-sm text-ink-soft">{row.mismatch.detail}</span>
        </div>
      ) : (
        <span className="text-ink-soft">None</span>
      ),
  },
  { id: 'order', header: 'Order id', mono: true, cell: (row) => row.providerOrderId },
  { id: 'payment', header: 'Payment id', mono: true, cell: (row) => row.providerPaymentId ?? '—' },
  { id: 'updated', header: 'Updated', cell: (row) => formatEventDateTime(row.updatedAt) },
]
