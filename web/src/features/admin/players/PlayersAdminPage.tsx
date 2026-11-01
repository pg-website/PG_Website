'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { Route } from 'next'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { SplitWorkspace } from '@/components/admin/SplitWorkspace'
import { EmptyState } from '@/components/ui/feedback/EmptyState'
import { ErrorState } from '@/components/ui/feedback/ErrorState'
import { SkeletonRegion } from '@/components/ui/feedback/SkeletonRegion'
import { Field } from '@/components/ui/form/Field'
import { Input } from '@/components/ui/form/Input'
import { Heading } from '@/components/ui/Heading'
import { ResponsiveTable } from '@/components/ui/table/ResponsiveTable'
import { TablePagination } from '@/components/ui/table/TablePagination'
import { TableSkeleton } from '@/components/ui/table/TableSkeleton'
import { Text } from '@/components/ui/Text'
import { PLAYER_COLUMNS } from '@/features/admin/players/players-columns'
import { parseSelectedId, toSearchQuery } from '@/features/admin/players/players-labels'
import { PlayerRecord } from '@/features/admin/players/PlayerRecord'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import type { AdminPlayersQuery } from '@/lib/api/types/admin/players'
import { adminPlayersQuery } from '@/lib/query/query-options/admin'

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300
const SEARCH_MAX = 100

const playerHref = (id: string): Route => `/admin/players?player=${encodeURIComponent(id)}` as Route

/**
 * Admin players (screen 54): search by name, email or phone, a paged list and the selected player's record.
 * The selection lives in the URL (`?player=`) so it survives reload and browser back works on mobile. The search text is
 * sent raw (trimmed) after a pause: the backend normalises phone formats. Search is the only filter (OQ-2).
 */
export function PlayersAdminPage() {
  const api = useApi().admin
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const selectedId = parseSelectedId(params.get('player'))

  const [text, setText] = useState('')
  const [q, setQ] = useState<string | undefined>(undefined)
  // The page belongs to the query it was chosen for: a new search starts on page 1 without an effect.
  const [pageState, setPageState] = useState<{ q: string | undefined; page: number }>({ q: undefined, page: 1 })
  const page = pageState.q === q ? pageState.page : 1

  useEffect(() => {
    const next = toSearchQuery(text)
    if (next === q) return
    const timer = setTimeout(() => {
      setQ(next)
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [text, q])

  const filter: AdminPlayersQuery = { page, pageSize: PAGE_SIZE, ...(q === undefined ? {} : { q }) }
  const query = useQuery({ ...adminPlayersQuery(api, filter), placeholderData: keepPreviousData })
  const data = query.data

  const closeDetail = (): void => {
    router.push(pathname as Route)
  }

  let list
  if (data === undefined && query.isPending) {
    list = (
      <SkeletonRegion label="Loading players">
        <TableSkeleton />
      </SkeletonRegion>
    )
  } else if (data === undefined) {
    list = (
      <ErrorState
        error={query.error}
        action="load players"
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  } else {
    list = (
      <ResponsiveTable
        caption="Players"
        columns={PLAYER_COLUMNS}
        rows={data.items}
        getRowId={(row) => row.id}
        rowHref={(row) => playerHref(row.id)}
        empty={
          <EmptyState framed={false} title="No players match">
            {q === undefined
              ? 'No players have joined yet.'
              : 'Check the spelling, or try part of the name, the email or the phone number.'}
          </EmptyState>
        }
        footer={
          <TablePagination
            pagination={data.pagination}
            onPageChange={(next) => {
              setPageState({ q, page: next })
            }}
            label="Players pages"
          />
        }
      />
    )
  }

  return (
    <div className="grid gap-6 p-4 sm:p-6">
      <header>
        <Heading level={1} size="section">
          Players
        </Heading>
        <Text variant="small" className="mt-1">
          Find a player, see their record and manage their role.
        </Text>
      </header>

      <SplitWorkspace
        listLabel="Players list"
        detailLabel="Player record"
        detailOpen={selectedId !== null}
        onBack={closeDetail}
        backLabel="Back to players"
        list={
          <div className="grid gap-4">
            <Field label="Search players" hint="Name, email or phone.">
              <Input
                type="search"
                inputMode="search"
                autoComplete="off"
                maxLength={SEARCH_MAX}
                value={text}
                onChange={(event) => {
                  setText(event.target.value)
                }}
              />
            </Field>
            <div aria-live="polite" className="text-sm text-ink-soft">
              {data === undefined
                ? null
                : `${String(data.pagination.total)} ${data.pagination.total === 1 ? 'player' : 'players'}`}
            </div>
            {list}
          </div>
        }
        detail={
          selectedId === null ? (
            <EmptyState framed={false} title="No player selected">
              Choose a player from the list to see their record.
            </EmptyState>
          ) : (
            <PlayerRecord key={selectedId} playerId={selectedId} />
          )
        }
      />
    </div>
  )
}
