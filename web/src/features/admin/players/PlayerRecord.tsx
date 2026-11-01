'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Banner } from '@/components/ui/feedback/Banner'
import { EmptyState } from '@/components/ui/feedback/EmptyState'
import { ErrorState } from '@/components/ui/feedback/ErrorState'
import { SkeletonRegion } from '@/components/ui/feedback/SkeletonRegion'
import { PlayerRecordBody } from '@/features/admin/players/PlayerRecordBody'
import { ROLE_LABEL } from '@/features/admin/players/players-labels'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import { ApiError } from '@/lib/api/errors'
import { qk } from '@/lib/query/keys'
import { adminPlayerQuery } from '@/lib/query/query-options/admin'

/**
 * Record panel (G02): loading, error, 404, then the record. A role change refetches the list and the record.
 * Mount with `key={playerId}` so the success notice does not carry over to another player.
 */
export function PlayerRecord({ playerId }: { playerId: string }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const query = useQuery(adminPlayerQuery(api.admin, playerId))
  const [notice, setNotice] = useState<string | null>(null)

  if (query.data === undefined && query.isPending) {
    return (
      <SkeletonRegion label="Loading player">
        <div className="h-64 w-full bg-line motion-safe:animate-pulse" />
      </SkeletonRegion>
    )
  }
  if (query.data === undefined) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return (
        <EmptyState framed={false} title="Player not found">
          This player no longer exists. Pick another from the list.
        </EmptyState>
      )
    }
    return (
      <ErrorState
        error={query.error}
        action="load this player"
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  }

  const player = query.data
  return (
    <div className="grid gap-4">
      {notice === null ? null : (
        <div role="status">
          <Banner tone="success" title="Role changed">
            {notice}
          </Banner>
        </div>
      )}
      <PlayerRecordBody
        player={player}
        onRoleChanged={(role) => {
          setNotice(`${player.name} is now ${ROLE_LABEL[role].toLowerCase()}.`)
          void queryClient.invalidateQueries({ queryKey: qk.admin.player(playerId) })
          void queryClient.invalidateQueries({ queryKey: ['admin', 'players'] })
        }}
      />
    </div>
  )
}
