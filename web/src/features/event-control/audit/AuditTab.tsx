'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { EmptyState } from '@/components/ui/feedback/EmptyState'
import { ErrorState } from '@/components/ui/feedback/ErrorState'
import { SkeletonRegion } from '@/components/ui/feedback/SkeletonRegion'
import { ResponsiveTable } from '@/components/ui/table/ResponsiveTable'
import { TablePagination } from '@/components/ui/table/TablePagination'
import { TableSkeleton } from '@/components/ui/table/TableSkeleton'
import type { TableColumn } from '@/components/ui/table/tableTypes'
import type { ControlTabProps } from '@/features/event-control/tabs'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import { AUDIT_ACTIONS, type AuditEntryDto, type AuditQuery } from '@/lib/api/types/admin/control-audit'
import { Select } from '@/components/ui/form/Select'
import { Field } from '@/components/ui/form/Field'
import { formatEventDateTime } from '@/lib/format/date'
import { adminAuditQuery } from '@/lib/query/query-options/admin'

const ALL_ACTIONS = '__all' as const
type ActionFilter = typeof ALL_ACTIONS | (typeof AUDIT_ACTIONS)[number]
const PAGE_SIZE = 50

const COLUMNS: TableColumn<AuditEntryDto>[] = [
  {
    id: 'at',
    header: 'At',
    cell: (row) => formatEventDateTime(row.at),
    priority: 'primary',
  },
  {
    id: 'actor',
    header: 'Actor',
    cell: (row) => row.actor.name,
    priority: 'primary',
    rowHeader: true,
  },
  {
    id: 'action',
    header: 'Action',
    cell: (row) => row.action,
    priority: 'primary',
    mono: true,
  },
  {
    id: 'object',
    header: 'Object',
    cell: (row) => row.object,
    priority: 'secondary',
  },
  {
    id: 'summary',
    header: 'Summary',
    cell: (row) => row.summary ?? '—',
    priority: 'secondary',
  },
]

function toQuery(action: ActionFilter, page: number): AuditQuery {
  return {
    page,
    pageSize: PAGE_SIZE,
    ...(action === ALL_ACTIONS ? {} : { action }),
  }
}

/** Audit tab (screen 53, C17): time-ordered audit log with filter and CSV export. */
export function AuditTab({ eventId }: ControlTabProps) {
  const api = useApi()
  const [action, setAction] = useState<ActionFilter>(ALL_ACTIONS)
  const [page, setPage] = useState(1)

  const query = useQuery({
    ...adminAuditQuery(api.admin, eventId, toQuery(action, page)),
    placeholderData: keepPreviousData,
  })
  const data = query.data

  const handleActionChange = (next: string): void => {
    setAction(next as ActionFilter)
    setPage(1)
  }

  // CSV export requires raw-body requester (not yet implemented in frontend adapter)
  // const handleExport = async (): Promise<void> => { ... }

  return (
    <div className="grid min-w-0 gap-4">
      {/* Action filter */}
      <Field label="Filter by action">
        <Select
          value={action}
          onValueChange={handleActionChange}
          options={[
            { value: ALL_ACTIONS, label: 'All actions' },
            ...AUDIT_ACTIONS.map((act) => ({ value: act, label: act })),
          ]}
        />
      </Field>

      {/* Table section */}
      {data === undefined && query.isPending ? (
        <SkeletonRegion label="Loading audit log">
          <TableSkeleton />
        </SkeletonRegion>
      ) : data === undefined ? (
        <ErrorState
          error={query.error}
          action="load audit log"
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : (
        <ResponsiveTable
          caption="Event audit log"
          columns={COLUMNS}
          rows={data.items}
          getRowId={(row) => row.id}
          empty={
            <EmptyState framed={false} title={action !== ALL_ACTIONS ? 'No entries match' : 'No audit log yet'}>
              {action !== ALL_ACTIONS
                ? 'Change or reset the filter to see more entries.'
                : 'Event actions appear here as they happen.'}
            </EmptyState>
          }
          footer={<TablePagination pagination={data.pagination} onPageChange={setPage} label="Audit log pages" />}
        />
      )}
    </div>
  )
}
