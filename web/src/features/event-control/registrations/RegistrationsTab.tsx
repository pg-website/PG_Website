'use client'

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useState, type ReactNode } from 'react'
import { FilterBar } from '@/components/admin/FilterBar'
import { EmptyState } from '@/components/ui/feedback/EmptyState'
import { ErrorState } from '@/components/ui/feedback/ErrorState'
import { SkeletonRegion } from '@/components/ui/feedback/SkeletonRegion'
import { Field } from '@/components/ui/form/Field'
import { Select } from '@/components/ui/form/Select'
import { ResponsiveTable } from '@/components/ui/table/ResponsiveTable'
import { TablePagination } from '@/components/ui/table/TablePagination'
import { TableSkeleton } from '@/components/ui/table/TableSkeleton'
import { CashRegisterDialog } from '@/features/event-control/registrations/CashRegisterDialog'
import { RegistrationActions } from '@/features/event-control/registrations/RegistrationActions'
import { REGISTRATION_COLUMNS } from '@/features/event-control/registrations/registrations-columns'
import {
  REGISTRATION_PAYMENT_LABEL,
  REGISTRATION_STATUS_LABEL,
} from '@/features/event-control/registrations/registrations-labels'
import type { ControlTabProps } from '@/features/event-control/tabs'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import type { AdminRegistrationDto, AdminRegistrationsQuery } from '@/lib/api/types/admin/control-registrations'
import { PAYMENT_ORDER_STATES, type PaymentOrderState } from '@/lib/api/types/payment'
import { REGISTRATION_STATUSES, type RegistrationStatus } from '@/lib/api/types/registration'
import { qk } from '@/lib/query/keys'
import { adminRegistrationsQuery } from '@/lib/query/query-options/admin'

const ALL = 'all'
const PAGE_SIZE = 50

const STATUS_OPTIONS = [
  { value: ALL, label: 'All statuses' },
  ...REGISTRATION_STATUSES.map((value) => ({ value, label: REGISTRATION_STATUS_LABEL[value] })),
]
const PAYMENT_OPTIONS = [
  { value: ALL, label: 'All payments' },
  ...PAYMENT_ORDER_STATES.map((value) => ({ value, label: REGISTRATION_PAYMENT_LABEL[value] })),
]
const FIRST_OPTIONS = [
  { value: ALL, label: 'Everyone' },
  { value: 'yes', label: 'First-timers only' },
  { value: 'no', label: 'Returning players' },
]

interface Filters {
  q: string
  status: RegistrationStatus | typeof ALL
  payment: PaymentOrderState | typeof ALL
  first: 'yes' | 'no' | typeof ALL
}
const NO_FILTERS: Filters = { q: '', status: ALL, payment: ALL, first: ALL }

function toQuery(filters: Filters, page: number): AdminRegistrationsQuery {
  const q = filters.q.trim().slice(0, 100)
  return {
    page,
    pageSize: PAGE_SIZE,
    ...(q === '' ? {} : { q }),
    ...(filters.status === ALL ? {} : { status: filters.status }),
    ...(filters.payment === ALL ? {} : { payment: filters.payment }),
    ...(filters.first === ALL ? {} : { firstTimer: filters.first === 'yes' }),
  }
}

/** Registrations tab (screen 47, C02 + C03): server-paged list, filters, per-row actions from server capabilities. */
export function RegistrationsTab({ eventId, overview }: ControlTabProps) {
  const api = useApi()
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [page, setPage] = useState(1)
  const deferredSearch = useDeferredValue(filters.q)
  const query = useQuery({
    ...adminRegistrationsQuery(api.admin, eventId, toQuery({ ...filters, q: deferredSearch }, page)),
    placeholderData: keepPreviousData,
  })
  const data = query.data

  const update = (next: Partial<Filters>): void => {
    setFilters((current) => ({ ...current, ...next }))
    setPage(1)
  }
  const activeCount =
    (filters.q.trim() === '' ? 0 : 1) +
    (filters.status === ALL ? 0 : 1) +
    (filters.payment === ALL ? 0 : 1) +
    (filters.first === ALL ? 0 : 1)

  const refresh = (): void => {
    // Counts in the summary strip change too, so the whole event prefix (overview, lists) is refreshed.
    void queryClient.invalidateQueries({ queryKey: qk.admin.event(eventId) })
  }

  const renderActions = (row: AdminRegistrationDto): ReactNode => (
    <RegistrationActions eventId={eventId} row={row} onDone={refresh} />
  )

  // FEAT-002: show the cash-register button on paid, non-terminal events only (rule 6.9: explicit ternary)
  const showCashRegister =
    overview.pricePaise !== 0 &&
    overview.status !== 'cancelled' &&
    overview.status !== 'completed'

  return (
    <div className="grid min-w-0 gap-4">
      {showCashRegister ? (
        <div className="flex justify-end">
          <CashRegisterDialog eventId={eventId} overview={overview} onSuccess={refresh} />
        </div>
      ) : null}
      <FilterBar
        label="Filter registrations"
        search={{
          value: filters.q,
          onChange: (value) => {
            update({ q: value })
          },
          label: 'Search',
          placeholder: 'Name, phone or registration id',
        }}
        activeCount={activeCount}
        onReset={() => {
          setFilters(NO_FILTERS)
          setPage(1)
        }}
        resultSummary={data === undefined ? undefined : `${data.pagination.total} registrations`}
      >
        <Field label="Status" className="sm:w-48">
          <Select
            options={STATUS_OPTIONS}
            value={filters.status}
            onValueChange={(value) => {
              update({ status: REGISTRATION_STATUSES.find((s) => s === value) ?? ALL })
            }}
          />
        </Field>
        <Field label="Payment" className="sm:w-48">
          <Select
            options={PAYMENT_OPTIONS}
            value={filters.payment}
            onValueChange={(value) => {
              update({ payment: PAYMENT_ORDER_STATES.find((s) => s === value) ?? ALL })
            }}
          />
        </Field>
        <Field label="Experience" className="sm:w-52">
          <Select
            options={FIRST_OPTIONS}
            value={filters.first}
            onValueChange={(value) => {
              update({ first: value === 'yes' || value === 'no' ? value : ALL })
            }}
          />
        </Field>
      </FilterBar>

      {data === undefined && query.isPending ? (
        <SkeletonRegion label="Loading registrations">
          <TableSkeleton />
        </SkeletonRegion>
      ) : data === undefined ? (
        <ErrorState
          error={query.error}
          action="load registrations"
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : (
        <ResponsiveTable
          caption="Registrations"
          columns={REGISTRATION_COLUMNS}
          rows={data.items}
          getRowId={(row) => row.id}
          actions={renderActions}
          actionsLabel="Actions"
          empty={
            <EmptyState framed={false} title={activeCount > 0 ? 'No registrations match' : 'No registrations yet'}>
              {activeCount > 0
                ? 'Change or reset the filters to see more players.'
                : 'Players appear here as soon as they register.'}
            </EmptyState>
          }
          footer={<TablePagination pagination={data.pagination} onPageChange={setPage} label="Registration pages" />}
        />
      )}
    </div>
  )
}
