'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { EmptyState } from '@/components/ui/feedback/EmptyState'
import { ErrorState } from '@/components/ui/feedback/ErrorState'
import { SkeletonRegion } from '@/components/ui/feedback/SkeletonRegion'
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge'
import { ResponsiveTable } from '@/components/ui/table/ResponsiveTable'
import { TablePagination } from '@/components/ui/table/TablePagination'
import { TableSkeleton } from '@/components/ui/table/TableSkeleton'
import type { TableColumn } from '@/components/ui/table/tableTypes'
import type { ControlTabProps } from '@/features/event-control/tabs'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import type { AdminPaymentRowDto, EventPaymentsQuery } from '@/lib/api/types/admin/payments'
import { PAYMENT_ORDER_STATES, type PaymentOrderState } from '@/lib/api/types/payment'
import { formatEventDateTime } from '@/lib/format/date'
import { formatInr } from '@/lib/format/money'
import { adminEventPaymentsQuery } from '@/lib/query/query-options/admin'

const ALL = 'all'
const PAGE_SIZE = 50

const STATE_LABEL: Record<PaymentOrderState, string> = {
  created: 'Created',
  attempted: 'Attempted',
  paid: 'Captured',
  failed: 'Failed',
  expired: 'Expired',
  refunded: 'Refunded',
}

const STATE_TONE: Record<PaymentOrderState, StatusTone> = {
  created: 'neutral',
  attempted: 'warning',
  paid: 'success',
  failed: 'danger',
  expired: 'neutral',
  refunded: 'neutral',
}

const STATUS_OPTIONS: Array<{ value: PaymentOrderState | typeof ALL; label: string }> = [
  { value: ALL, label: 'All' },
  ...PAYMENT_ORDER_STATES.map((value) => ({ value, label: STATE_LABEL[value] })),
]

function toQuery(status: PaymentOrderState | typeof ALL, page: number): EventPaymentsQuery {
  return {
    page,
    pageSize: PAGE_SIZE,
    ...(status === ALL ? {} : { status }),
  }
}

const COLUMNS: TableColumn<AdminPaymentRowDto>[] = [
  {
    id: 'player',
    header: 'Player',
    cell: (row) => row.playerName,
    priority: 'primary',
    rowHeader: true,
  },
  {
    id: 'amount',
    header: 'Amount',
    cell: (row) => formatInr(row.amountPaise),
    align: 'end',
    priority: 'primary',
  },
  {
    id: 'status',
    header: 'Status',
    cell: (row) => (
      <span className="inline-flex items-center gap-1.5">
        <StatusBadge tone={STATE_TONE[row.state]}>{STATE_LABEL[row.state]}</StatusBadge>
        {row.mismatch.mismatch && (
          <StatusBadge tone="warning" aria-label={`Mismatch: ${row.mismatch.kind}`}>
            Mismatch
          </StatusBadge>
        )}
      </span>
    ),
    priority: 'primary',
  },
  {
    id: 'provider-id',
    header: 'Provider ID',
    cell: (row) => (
      <span className="font-mono text-xs text-ink-soft" title={row.providerOrderId}>
        {row.providerOrderId}
      </span>
    ),
    priority: 'secondary',
    mono: true,
  },
  {
    id: 'updated',
    header: 'Updated',
    cell: (row) => formatEventDateTime(row.updatedAt),
    priority: 'secondary',
  },
]

/** Payments tab (screen 50, C13): server-paged list of payment orders for this event. */
export function PaymentsTab({ eventId }: ControlTabProps) {
  const api = useApi()
  const [status, setStatus] = useState<PaymentOrderState | typeof ALL>(ALL)
  const [page, setPage] = useState(1)

  const query = useQuery({
    ...adminEventPaymentsQuery(api.admin, eventId, toQuery(status, page)),
    placeholderData: keepPreviousData,
  })
  const data = query.data

  const update = (next: PaymentOrderState | typeof ALL): void => {
    setStatus(next)
    setPage(1)
  }

  return (
    <div className="grid min-w-0 gap-4">
      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => update(opt.value)}
            aria-pressed={status === opt.value}
            className={[
              'inline-flex min-h-11 items-center rounded-public border px-3 py-2 text-sm transition-colors',
              status === opt.value
                ? 'border-forest bg-forest text-parchment'
                : 'border-line bg-surface text-ink hover:border-forest/50',
            ].join(' ')}
          >
            {opt.label}
          </button>
        ))}
        {data !== undefined && (
          <span className="ml-auto self-center text-sm text-ink-soft">
            {data.pagination.total} payment{data.pagination.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {data === undefined && query.isPending ? (
        <SkeletonRegion label="Loading payments">
          <TableSkeleton />
        </SkeletonRegion>
      ) : data === undefined ? (
        <ErrorState
          error={query.error}
          action="load payments"
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : (
        <ResponsiveTable
          caption="Event payments"
          columns={COLUMNS}
          rows={data.items}
          getRowId={(row) => row.id}
          empty={
            <EmptyState framed={false} title={status !== ALL ? 'No payments match' : 'No payments yet'}>
              {status !== ALL
                ? 'Change or reset the filter to see more payments.'
                : 'Payments appear here once players start registering.'}
            </EmptyState>
          }
          footer={<TablePagination pagination={data.pagination} onPageChange={setPage} label="Payment pages" />}
        />
      )}
    </div>
  )
}
