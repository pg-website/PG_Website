'use client'

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Route } from 'next'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ConfirmAction } from '@/components/admin/ConfirmAction'
import { FilterBar } from '@/components/admin/FilterBar'
import { Button } from '@/components/ui/Button'
import { CreateDraftButton } from '@/features/admin/events/CreateDraftButton'
import { EmptyState } from '@/components/ui/feedback/EmptyState'
import { ErrorState } from '@/components/ui/feedback/ErrorState'
import { Field } from '@/components/ui/form/Field'
import { Select } from '@/components/ui/form/Select'
import { PageIntro } from '@/components/ui/PageIntro'
import { EVENT_STATUS_LABEL, EVENT_STATUS_TONE } from '@/components/domain/eventStatusLabels'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ResponsiveTable } from '@/components/ui/table/ResponsiveTable'
import type { TableColumn } from '@/components/ui/table/tableTypes'
import { TablePagination } from '@/components/ui/table/TablePagination'
import { eventTypeLabel, pairingModeLabel } from '@/components/domain/eventLabels'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import { useToast } from '@/components/ui/feedback/useToast'
import type { AdminEventRowDto, AdminEventsQuery } from '@/lib/api/types/admin/event-list'
import { EVENT_STATUSES, EVENT_TYPES, eventStatusSchema, eventTypeSchema } from '@/lib/api/types/event-state'
import { formatEventDateTime } from '@/lib/format/date'
import { formatInr } from '@/lib/format/money'
import { adminEventsQuery } from '@/lib/query/query-options/admin'

const eventHref = (id: string, suffix = ''): Route => `/admin/events/${encodeURIComponent(id)}${suffix}` as Route

function RowActions({ row }: { row: AdminEventRowDto }) {
  const api = useApi().admin
  const queryClient = useQueryClient()
  const toast = useToast()

  return (
    <div className="flex flex-wrap gap-2">
      {row.capabilities.canEdit.allowed ? (
        <Button href={eventHref(row.id, '/edit')} variant="secondary" size="sm">
          Edit<span className="sr-only"> {row.title}</span>
        </Button>
      ) : null}
      {row.capabilities.canDelete?.allowed === true ? (
        <ConfirmAction
          renderTrigger={(open) => (
            <Button variant="secondary" size="sm" onClick={open}>
              Delete<span className="sr-only"> {row.title}</span>
            </Button>
          )}
          title="Delete this draft?"
          consequence={`"${row.title}" will be permanently deleted. This cannot be undone.`}
          confirmLabel="Delete event"
          actionLabel="delete this event"
          onConfirm={async () => {
            // Optimistically remove the row from every cached events page.
            // Use the 2-element prefix ['admin', 'events'] so TanStack's partial matching
            // covers all filter/page variants (qk.admin.events() adds a 3rd queryPart element
            // that won't match the stored keys which always carry the full filter string).
            queryClient.setQueriesData<{ items: AdminEventRowDto[]; pagination: unknown }>(
              { queryKey: ['admin', 'events'] },
              (old) =>
                old === undefined
                  ? old
                  : { ...old, items: old.items.filter((r) => r.id !== row.id) },
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

const PAGE_SIZE = 20
const ALL = 'all'
const SEARCH_DEBOUNCE_MS = 300

const STATUS_OPTIONS = [
  { value: ALL, label: 'All states' },
  ...EVENT_STATUSES.map((value) => ({ value, label: EVENT_STATUS_LABEL[value] })),
]
const TYPE_OPTIONS = [
  { value: ALL, label: 'All types' },
  ...EVENT_TYPES.map((value) => ({ value, label: eventTypeLabel(value) })),
]

// State chips visible from 480 px (xs). Reference screen 37: All | Draft | Registration open | Live | Completed.
// Cancelled and sold-out are accessible via the select only (rare operational states).
const STATUS_CHIP_OPTIONS = [
  { value: ALL, label: 'All' },
  { value: 'draft', label: EVENT_STATUS_LABEL.draft },
  { value: 'registration_open', label: EVENT_STATUS_LABEL.registration_open },
  { value: 'ongoing', label: 'Live' },
  { value: 'completed', label: EVENT_STATUS_LABEL.completed },
] as const

const COLUMNS: readonly TableColumn<AdminEventRowDto>[] = [
  {
    id: 'title',
    header: 'Event',
    rowHeader: true,
    priority: 'primary',
    cell: (row) => {
      const subtitle = [row.area, row.city].filter(Boolean).join(', ')
      return subtitle ? (
        <span className="grid gap-0.5">
          <span>{row.title}</span>
          <span className="text-sm text-muted">{subtitle}</span>
        </span>
      ) : (
        row.title
      )
    },
  },
  {
    id: 'startsAt',
    header: 'Date',
    cell: (row) => (row.startsAt === null ? 'Not scheduled' : formatEventDateTime(row.startsAt)),
  },
  { id: 'type', header: 'Type', cell: (row) => eventTypeLabel(row.type) },
  {
    id: 'filled',
    header: 'Capacity',
    align: 'end',
    cell: (row) => (row.capacity === null ? `${row.filled} (unlimited)` : `${row.filled} / ${row.capacity}`),
  },
  { id: 'price', header: 'Price', align: 'end', cell: (row) => formatInr(row.pricePaise) },
  { id: 'pairing', header: 'Pairing', cell: (row) => pairingModeLabel(row.pairingMode) },
  {
    id: 'status',
    header: 'Status',
    priority: 'primary',
    cell: (row) => <StatusBadge tone={EVENT_STATUS_TONE[row.status]}>{EVENT_STATUS_LABEL[row.status]}</StatusBadge>,
  },
]

export function AdminEventsPage() {
  const api = useApi().admin
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const parsedStatus = eventStatusSchema.safeParse(params.get('status'))
  const parsedType = eventTypeSchema.safeParse(params.get('type'))
  const status = parsedStatus.success ? parsedStatus.data : undefined
  const type = parsedType.success ? parsedType.data : undefined
  const q = params.get('q')?.trim() ?? ''
  const pageParam = Number(params.get('page'))
  const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1

  const [search, setSearch] = useState(q)

  const update = (changes: Record<string, string | undefined>): void => {
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === '') next.delete(key)
      else next.set(key, value)
    }
    const qs = next.toString()
    router.replace((qs === '' ? pathname : `${pathname}?${qs}`) as Route, { scroll: false })
  }

  // Debounced search: write to the URL (and reset to page 1) once typing pauses.
  useEffect(() => {
    if (search.trim() === q) return
    const timer = setTimeout(() => {
      update({ q: search.trim().slice(0, 100), page: undefined })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `update` is rebuilt every render; only the typed text and URL value matter.
  }, [search, q])

  const filter: AdminEventsQuery = {
    page,
    pageSize: PAGE_SIZE,
    ...(status === undefined ? {} : { status }),
    ...(type === undefined ? {} : { type }),
    ...(q === '' ? {} : { q }),
  }
  const query = useQuery({ ...adminEventsQuery(api, filter), placeholderData: keepPreviousData })

  const activeCount = (status === undefined ? 0 : 1) + (type === undefined ? 0 : 1) + (q === '' ? 0 : 1)
  const data = query.data
  const summary =
    data === undefined ? undefined : `${data.pagination.total} ${data.pagination.total === 1 ? 'event' : 'events'}`

  let body
  if (data === undefined && query.isError) {
    body = (
      <ErrorState
        error={query.error}
        action="load events"
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  } else {
    body = (
      <ResponsiveTable
        caption="Events"
        columns={COLUMNS}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        rowHref={(row) => eventHref(row.id)}
        loading={data === undefined}
        actions={(row) => <RowActions row={row} />}
        empty={
          <EmptyState
            framed={false}
            title={activeCount > 0 ? 'No events match these filters' : 'No events yet'}
            action={
              activeCount > 0 ? (
                <Button variant="secondary" onClick={reset}>
                  Reset filters
                </Button>
              ) : (
                <CreateDraftButton>New event</CreateDraftButton>
              )
            }
          >
            {activeCount > 0
              ? 'Try a different state, type or search term.'
              : 'Create a draft to start building your first event.'}
          </EmptyState>
        }
        footer={
          data === undefined ? undefined : (
            <TablePagination
              pagination={data.pagination}
              onPageChange={(next) => {
                update({ page: next === 1 ? undefined : String(next) })
              }}
              label="Event pages"
            />
          )
        }
      />
    )
  }

  function reset(): void {
    setSearch('')
    router.replace(pathname as Route, { scroll: false })
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 py-6">
      <PageIntro
        variant="admin"
        eyebrow="Events"
        title="Every room PG runs, in one place."
        description="Social nights, tournaments, workshops, leagues and special formats share the same event core."
        actions={<CreateDraftButton>New event</CreateDraftButton>}
      />

      {/* State chips — visible from 480 px (xs breakpoint). Reference screen 37. */}
      <div role="group" aria-label="Filter by state" className="hidden flex-wrap gap-2 xs:flex">
        {STATUS_CHIP_OPTIONS.map(({ value: chipValue, label }) => (
          <button
            key={chipValue}
            type="button"
            aria-pressed={status === (chipValue === ALL ? undefined : chipValue)}
            onClick={() => {
              update({ status: chipValue === ALL ? undefined : chipValue, page: undefined })
            }}
            className={[
              'min-h-tap rounded-public border px-3 py-2 font-ui text-sm transition-colors duration-control',
              (chipValue === ALL ? status === undefined : status === chipValue)
                ? 'border-forest bg-forest text-parchment'
                : 'border-line-admin bg-transparent text-ink hover:border-ink',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      <FilterBar
        label="Filter events"
        search={{ value: search, onChange: setSearch, label: 'Search events', placeholder: 'Title or slug' }}
        activeCount={activeCount}
        onReset={reset}
        resultSummary={summary}
      >
        {/* State select — visible below 480 px (xs breakpoint) only; chips replace it above. */}
        <Field label="State" className="xs:hidden sm:w-56">
          <Select
            options={STATUS_OPTIONS}
            value={status ?? ALL}
            onValueChange={(value) => {
              update({ status: value === ALL ? undefined : value, page: undefined })
            }}
          />
        </Field>
        <Field label="Type" className="sm:w-56">
          <Select
            options={TYPE_OPTIONS}
            value={type ?? ALL}
            onValueChange={(value) => {
              update({ type: value === ALL ? undefined : value, page: undefined })
            }}
          />
        </Field>
      </FilterBar>
      {body}
    </div>
  )
}
