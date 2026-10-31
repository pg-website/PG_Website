'use client'

import { useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { useCallback, useState, type ReactNode } from 'react'
import { Banner } from '@/components/ui/feedback/Banner'
import { EmptyState } from '@/components/ui/feedback/EmptyState'
import { Field } from '@/components/ui/form/Field'
import { Select } from '@/components/ui/form/Select'
import { cn } from '@/lib/cn'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ResponsiveTable } from '@/components/ui/table/ResponsiveTable'
import { GenerateAction } from '@/features/event-control/pairings/GenerateAction'
import { PAIRING_COLUMNS } from '@/features/event-control/pairings/pairings-columns'
import {
  GENERATE_METHODS,
  METHOD_LABEL,
  ROUND_STATE_LABEL,
  ROUND_STATE_SHORT,
  ROUND_STATE_TONE,
} from '@/features/event-control/pairings/pairings-labels'
import {
  defaultRoundId,
  disputedGames,
  openResultCount,
  planGenerate,
  resultActionFor,
  resultProgress,
} from '@/features/event-control/pairings/pairings-logic'
import { PairingRowActions } from '@/features/event-control/pairings/PairingRowActions'
import { RatingStatus } from '@/features/event-control/pairings/RatingStatus'
import { ResultAction } from '@/features/event-control/pairings/ResultAction'
import { RoundActions } from '@/features/event-control/pairings/RoundActions'
import type { AdminPairingDto, AdminRoundsDto } from '@/lib/api/types/admin/control-rounds'
import type { PairingMode } from '@/lib/api/types/event-state'
import { qk } from '@/lib/query/keys'

// The editor is only needed once an admin starts editing, so it stays out of this tab's first chunk.
const EditPairings = dynamic(() => import('@/features/event-control/pairings/EditPairings').then((m) => m.EditPairings))

interface Props {
  eventId: string
  data: AdminRoundsDto
  eventStatus: string
  mode: PairingMode
  roundsPlanned: number | null
}

/**
 * The loaded Pairings tab: round selector, state banners (draft, published, live, finalised, between rounds), lifecycle
 * actions, dispute queue and either the pairings table or the editor. All state of "what is allowed" comes from the
 * server's capabilities; the only local derivations are in pairings-logic.ts.
 */
export function RoundsView({ eventId, data, eventStatus, mode, roundsPlanned }: Props) {
  const queryClient = useQueryClient()
  const [picked, setPicked] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const rounds = data.rounds
  const plan = planGenerate(rounds, eventStatus, roundsPlanned)
  const defaultMethod = GENERATE_METHODS.includes(mode) ? mode : 'social_balanced'
  // Stable across renders while the event is the same, so memoised rows do not re-render when an unrelated row changes.
  const refresh = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: qk.admin.rounds(eventId) })
    void queryClient.invalidateQueries({ queryKey: qk.admin.overview(eventId) })
  }, [queryClient, eventId])

  const generate = (
    <GenerateAction
      eventId={eventId}
      plan={plan}
      defaultMethod={defaultMethod}
      onGenerated={(created) => {
        setPicked(created.id)
        setEditingId(null)
        refresh() // the new round is not in the cached list yet; without this the view keeps showing the old round
      }}
    />
  )
  const noGenerateReason =
    plan.roundNo === null && plan.reason !== null ? <p className="text-sm text-ink-soft">{plan.reason}</p> : null

  const selectedId = rounds.some((round) => round.id === picked) ? picked : defaultRoundId(rounds)
  // The row callback depends only on the round id, so it is stable while the round is the same.
  const activeRoundId =
    (rounds.find((candidate) => candidate.id === selectedId) ?? rounds[rounds.length - 1])?.id ?? ''
  const renderActions = useCallback(
    (row: AdminPairingDto): ReactNode => (
      <PairingRowActions eventId={eventId} roundId={activeRoundId} row={row} onDone={refresh} />
    ),
    [eventId, activeRoundId, refresh],
  )

  if (rounds.length === 0) {
    return (
      <EmptyState title="No rounds yet" headingLevel={2} action={plan.roundNo === null ? undefined : generate}>
        Generate round 1 to pair the players. It stays a draft until you publish it.
        {noGenerateReason}
      </EmptyState>
    )
  }
  const round = rounds.find((candidate) => candidate.id === selectedId) ?? rounds[rounds.length - 1]
  if (round === undefined) return null
  const editing = editingId === round.id && round.capabilities.canEdit.allowed

  const disputes = disputedGames(round)
  const open = openResultCount(round)
  const progress = resultProgress(round)
  const last = rounds.reduce((a, b) => (b.roundNo > a.roundNo ? b : a))
  const betweenRounds = last.state === 'completed' && plan.roundNo !== null && round.id === last.id

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {/* Under 720px: a horizontal strip of rounds that snaps to each chip. From 720px: the select. */}
      <nav aria-label="Rounds" className="-mx-gutter flex snap-x snap-mandatory gap-2 overflow-x-auto px-gutter pb-1 sm:hidden">
        {rounds.map((item) => {
          const current = item.id === round.id
          return (
            <button
              key={item.id}
              type="button"
              aria-current={current ? 'true' : undefined}
              onClick={() => {
                setPicked(item.id)
                setEditingId(null)
              }}
              className={cn(
                'min-h-tap shrink-0 snap-start rounded-public border px-4 py-2 text-sm font-semibold',
                current ? 'border-forest bg-forest text-parchment' : 'border-line-admin bg-admin-panel text-ink',
              )}
            >
              Round {String(item.roundNo)} · {ROUND_STATE_SHORT[item.state]}
            </button>
          )
        })}
      </nav>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Round" className="hidden w-full sm:grid sm:w-72">
          <Select
            value={round.id}
            onValueChange={(value) => {
              setPicked(value)
              setEditingId(null)
            }}
            options={rounds.map((item) => ({
              value: item.id,
              label: `Round ${String(item.roundNo)} · ${ROUND_STATE_SHORT[item.state]}`,
            }))}
          />
        </Field>
        <StatusBadge tone={ROUND_STATE_TONE[round.state]}>{ROUND_STATE_LABEL[round.state]}</StatusBadge>
        <span className="text-sm text-ink-soft">
          {METHOD_LABEL[round.method]} · Round version {round.version}, pairing version {round.pairingVersion}
        </span>
        <div className="ml-auto flex flex-col items-start gap-1">
          {plan.roundNo !== null && (!plan.regenerates || round.state === 'draft') ? generate : null}
          {plan.roundNo === null && round.id === last.id ? noGenerateReason : null}
        </div>
      </div>

      {betweenRounds ? (
        <Banner tone="info" title={`Between rounds: round ${String(last.roundNo)} is finalised`}>
          Generate round {plan.roundNo} when players are ready.
        </Banner>
      ) : null}
      {round.state === 'draft' ? (
        <Banner tone="info" title="Draft: players cannot see these pairings">
          Check the boards, then publish. Publishing notifies players.
        </Banner>
      ) : null}
      {round.state === 'published' ? (
        <Banner tone="info" title="Published: players can see their boards">
          Start the round when play begins. Corrections need a reason and notify the affected players.
        </Banner>
      ) : null}
      {round.state === 'live' ? (
        <Banner
          tone={open === 0 ? 'success' : 'info'}
          title={`${String(progress.final)} of ${String(progress.total)} results final`}
        >
          {open === 0
            ? 'You can finalise this round.'
            : `${String(open)} still open. Players submit results from their phones. You can enter or override any result below.${
                disputes.length > 0 ? ` ${String(disputes.length)} disputed.` : ''
              }`}
        </Banner>
      ) : null}
      {round.state === 'completed' ? <RatingStatus round={round} /> : null}
      {/* Under 720px the lifecycle actions sit in a sticky bottom bar (safe-area padded) so the board list is never
          hidden behind them; from 720px the bar is part of the page flow. */}
      {round.state === 'void' ? (
        <Banner tone="warning" title="This round was replaced">
          It is kept for the audit log only.
        </Banner>
      ) : (
        <div className="max-sm:sticky max-sm:bottom-0 max-sm:z-header max-sm:border-t max-sm:border-line-admin max-sm:bg-parchment/95 max-sm:px-gutter max-sm:pt-3 max-sm:pb-safe-3 max-sm:backdrop-blur-lg">
          <RoundActions
            key={round.id}
            eventId={eventId}
            round={round}
            onDone={() => {
              setEditingId(null)
              refresh()
            }}
            onEdit={() => {
              setEditingId(round.id)
            }}
          />
        </div>
      )}

      {disputes.length > 0 ? (
        <section aria-labelledby="dispute-queue" className="flex flex-col gap-2">
          <h2 id="dispute-queue" className="font-ui text-xl font-strong">
            Disputed results ({disputes.length})
          </h2>
          <ul className="grid list-none gap-2 p-0">
            {disputes.map((game) => {
              const action = resultActionFor(game)
              return (
                <li
                  key={game.pairingId}
                  className="rounded-md flex flex-wrap items-center justify-between gap-3 border border-line-admin bg-admin-panel p-3"
                >
                  <span className="min-w-0 wrap-break-word">
                    Board {game.board}: {game.white.name} v {game.black.name}
                  </span>
                  {action === null ? null : (
                    <ResultAction
                      eventId={eventId}
                      roundId={round.id}
                      pairing={game}
                      action={action}
                      onDone={refresh}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      <ResponsiveTable
        caption={`Round ${String(round.roundNo)} pairings`}
        columns={PAIRING_COLUMNS}
        rows={round.pairings}
        getRowId={(row) => row.pairingId}
        actionsLabel="Result actions"
        actions={renderActions}
        empty={
          <EmptyState title="No boards in this round" headingLevel={3}>
            {round.state === 'draft' ? 'Regenerate the draft to pair the players.' : 'This round has no pairings.'}
          </EmptyState>
        }
      />

      {editing ? (
        <EditPairings
          key={round.id}
          eventId={eventId}
          round={round}
          onExit={() => {
            setEditingId(null)
          }}
        />
      ) : null}
    </div>
  )
}
