'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { SaveBar } from '@/components/admin/SaveBar'
import { conflictFromLastChange, isVersionConflict, type ConflictInfo } from '@/components/admin/versionConflict'
import { Button } from '@/components/ui/Button'
import { Banner } from '@/components/ui/feedback/Banner'
import { useToast } from '@/components/ui/feedback/useToast'
import { Field } from '@/components/ui/form/Field'
import { Textarea } from '@/components/ui/form/Textarea'
import { Dialog } from '@/components/ui/overlay/Dialog'
import { PlayerPicker } from '@/features/event-control/pairings/PlayerPicker'
import { PlayerSeat } from '@/features/event-control/pairings/PlayerSeat'
import {
  addBoard,
  addBye,
  buildEditInput,
  byeOptions,
  draftProblems,
  editPhase,
  flipColours,
  isMovable,
  modelFromRound,
  nextVersionCopy,
  placeInSeat,
  playerDirectory,
  rematchBoards,
  rematchKeys,
  removeBoard,
  removeBye,
  sameModel,
  seatOptions,
  swapPlayers,
  type DraftModel,
  type PlayerInfo,
} from '@/features/event-control/pairings/pairings-logic'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import { copyFor } from '@/lib/api/error-copy'
import type { AdminRoundDto, EditPairingsInput } from '@/lib/api/types/admin/control-rounds'
import { useLiveAnnouncer } from '@/lib/hooks/useLiveAnnouncer'
import { qk } from '@/lib/query/keys'
import { useApiMutation } from '@/lib/query/mutation'

interface Props {
  eventId: string
  round: AdminRoundDto
  onExit: () => void
}

const SWAP_NOTE =
  'A player can be on one seat only. Choosing someone who is already seated moves them here and the other player takes their place.'

/**
 * Pairings editor (C08), opened as a dialog from the round. Boards change by choosing a player from a searchable list
 * (unpaired and checked-in players first), by adding or removing a board, or by adding or removing a bye. Select-to-swap
 * and "Swap colours" stay as shortcuts. A draft saves without a reason; once published or live every change creates a
 * new round version, needs a reason and is audited. Boards that already have a result are locked. A VERSION_CONFLICT
 * keeps the local edits on screen, re-reads the round and offers to load the other version.
 */
export function EditPairings({ eventId, round, onExit }: Props) {
  const api = useApi().admin
  const queryClient = useQueryClient()
  const toast = useToast()
  const announce = useLiveAnnouncer()
  const directory = useMemo(() => playerDirectory(round), [round])
  const rematches = useMemo(() => rematchKeys(round), [round])

  // The edit is based on this version. It is NOT updated by background refetches: a stale base must conflict.
  const [base, setBase] = useState(() => ({ version: round.version, model: modelFromRound(round) }))
  const [model, setModel] = useState<DraftModel>(base.model)
  const [selected, setSelected] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [conflict, setConflict] = useState<ConflictInfo | null>(null)
  const [failure, setFailure] = useState<ReturnType<typeof copyFor> | null>(null)

  const phase = editPhase(round)
  const dirty = !sameModel(model, base.model)
  const nameOf = (id: string): string => directory.get(id)?.name ?? 'player'
  const rematchOn = rematchBoards(model, rematches)

  const mutation = useApiMutation<AdminRoundDto, EditPairingsInput>({
    idempotent: false,
    mutationFn: (input) => api.control.editPairings(eventId, round.id, input),
    invalidates: () => [qk.admin.rounds(eventId), qk.admin.overview(eventId)],
    onSuccess: () => {
      toast.success(phase === 'draft' ? 'Draft pairings saved' : 'Pairings updated. Affected players were notified.')
      onExit()
    },
    onError: (error) => {
      if (isVersionConflict(error)) {
        setConflict(conflictFromLastChange(null))
        void queryClient.invalidateQueries({ queryKey: qk.admin.rounds(eventId) })
        return
      }
      setFailure(copyFor(error, { action: 'save these pairings' }))
    },
  })

  const pick = (registrationId: string): void => {
    if (selected === null) {
      setSelected(registrationId)
      announce(`${nameOf(registrationId)} selected. Choose who to swap with.`)
      return
    }
    if (selected === registrationId) {
      setSelected(null)
      return
    }
    const first = selected
    setModel((current) => swapPlayers(current, first, registrationId))
    announce(`Swapped ${nameOf(first)} and ${nameOf(registrationId)}.`)
    setSelected(null)
  }

  const choose = (boardNo: number, side: 'white' | 'black', registrationId: string): void => {
    setModel((current) => placeInSeat(current, boardNo, side, registrationId))
    setSelected(null)
    announce(`${nameOf(registrationId)} is ${side} on board ${String(boardNo)}.`)
  }

  const flip = (boardNo: number): void => {
    setModel((current) => flipColours(current, boardNo))
    announce(`Board ${String(boardNo)}: colours swapped.`)
  }

  const addNewBoard = (): void => {
    const next = addBoard(model)
    if (next === model) return
    setModel(next)
    announce(`Board ${String(next.boards[next.boards.length - 1]?.board ?? '')} added. Choose both players.`)
  }

  const removeOneBoard = (boardNo: number): void => {
    setModel((current) => removeBoard(current, boardNo))
    setSelected(null)
    announce(`Board ${String(boardNo)} removed.`)
  }

  const addOneBye = (registrationId: string): void => {
    setModel((current) => addBye(current, registrationId))
    announce(`${nameOf(registrationId)} gets a bye.`)
  }

  const removeOneBye = (registrationId: string): void => {
    setModel((current) => removeBye(current, registrationId))
    setSelected(null)
    announce(`Bye removed for ${nameOf(registrationId)}.`)
  }

  const save = (): void => {
    setFailure(null)
    const gaps = draftProblems(model)
    setProblems(gaps)
    if (gaps.length > 0) return
    const request = buildEditInput(model, round, base.version, reason)
    if (!request.ok) {
      if ('reasonMissing' in request) setReasonError(true)
      return
    }
    setReasonError(false)
    mutation.mutate(request.input)
  }

  const reload = (): void => {
    const fresh = modelFromRound(round)
    setBase({ version: round.version, model: fresh })
    setModel(fresh)
    setSelected(null)
    setConflict(null)
    setFailure(null)
    setProblems([])
    mutation.reset()
  }

  const discard = (): void => {
    setModel(base.model)
    setSelected(null)
    setFailure(null)
    setProblems([])
  }

  const closeAllowed = !dirty && !mutation.isPending

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && closeAllowed) onExit()
      }}
      title={`Edit pairings for round ${String(round.roundNo)}`}
      descriptionText={
        phase === 'after_publish'
          ? `${nextVersionCopy(round)} Give a reason for it.`
          : 'This is still a draft: players cannot see it yet.'
      }
      size="lg"
      presentation="sheet"
      dismissible={closeAllowed}
      closeLabel="Close editor"
    >
      <section aria-label="Edit pairings" className="flex min-w-0 flex-col gap-4">
        <Banner tone="info" title="Choose a player for each seat">
          Use &ldquo;Choose player&rdquo; to pick from a searchable list, or press a player and then another to swap them.
          &ldquo;Swap colours&rdquo; flips a board. {SWAP_NOTE}
        </Banner>

        {rematchOn.length > 0 ? (
          <Banner tone="warning" title="Already played">
            {rematchOn.length === 1
              ? `Board ${String(rematchOn[0])} pairs two players who already met in this event.`
              : `Boards ${rematchOn.join(', ')} pair players who already met in this event.`}{' '}
            You can still save.
          </Banner>
        ) : null}

        {model.boards.length === 0 ? (
          <p className="text-sm text-ink-soft">No boards yet. Add a board to pair players.</p>
        ) : null}

        <ol className="grid list-none gap-3 p-0">
          {model.boards.map((board) => {
            const boardLabel = `Board ${String(board.board)}`
            return (
              <li key={board.board} className="rounded-md flex flex-col gap-2 border border-line-admin bg-admin-panel p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-ui text-base font-strong">{boardLabel}</h3>
                  {board.locked ? <span className="text-sm text-ink-soft">Locked: has a result</span> : null}
                </div>
                {(['white', 'black'] as const).map((side) => {
                  const id = board[side]
                  const info: PlayerInfo | undefined = id === null ? undefined : directory.get(id)
                  const seatName = `${boardLabel} ${side === 'white' ? 'White' : 'Black'}`
                  return (
                    <div key={side} className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                      <span className="text-sm text-ink-soft sm:w-14 sm:shrink-0">
                        {side === 'white' ? 'White' : 'Black'}
                      </span>
                      <div className="min-w-0 flex-1">
                        {id !== null && info !== undefined ? (
                          <PlayerSeat
                            player={info}
                            label={seatName}
                            selected={selected === id}
                            movable={isMovable(model, id)}
                            onPick={() => {
                              pick(id)
                            }}
                          />
                        ) : (
                          <p className="min-h-control rounded-public border border-dashed border-line-admin px-3 py-2 text-sm text-ink-soft">
                            Empty seat
                          </p>
                        )}
                      </div>
                      <PlayerPicker
                        seatLabel={seatName}
                        triggerText={id === null ? 'Choose player' : 'Change'}
                        disabled={board.locked}
                        options={seatOptions(model, directory, board.board, side)}
                        swapNote={SWAP_NOTE}
                        onChoose={(registrationId) => {
                          choose(board.board, side, registrationId)
                        }}
                      />
                    </div>
                  )
                })}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={board.locked}
                    onClick={() => {
                      flip(board.board)
                    }}
                  >
                    Swap colours<span className="sr-only"> on board {board.board}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={board.locked}
                    onClick={() => {
                      removeOneBoard(board.board)
                    }}
                  >
                    Remove board<span className="sr-only"> {board.board}</span>
                  </Button>
                </div>
              </li>
            )
          })}
        </ol>

        <div>
          <Button variant="secondary" onClick={addNewBoard} disabled={model.boards.length >= 500}>
            Add board
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="font-ui text-base font-strong">Byes (sitting out this round)</h3>
          {model.byes.length === 0 ? <p className="text-sm text-ink-soft">No byes.</p> : null}
          <ul className="grid list-none gap-2 p-0">
            {model.byes.map((registrationId) => {
              const player = directory.get(registrationId)
              if (player === undefined) return null
              return (
                <li key={registrationId} className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <PlayerSeat
                      player={player}
                      label="Bye"
                      selected={selected === registrationId}
                      movable={isMovable(model, registrationId)}
                      onPick={() => {
                        pick(registrationId)
                      }}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      removeOneBye(registrationId)
                    }}
                  >
                    Remove bye<span className="sr-only"> for {player.name}</span>
                  </Button>
                </li>
              )
            })}
          </ul>
          <div>
            <PlayerPicker
              seatLabel="a bye"
              triggerText="Add bye"
              options={byeOptions(model, directory)}
              swapNote="Only players who are not on a board can get a bye. To move a seated player, choose their seat instead."
              onChoose={addOneBye}
            />
          </div>
        </div>

        {problems.length > 0 ? (
          <Banner tone="warning" title="Fill every seat before saving" live="alert">
            <ul className="list-disc pl-5">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Banner>
        ) : null}

        {phase === 'after_publish' ? (
          <Field
            label="Reason for the change"
            required
            hint="Up to 500 characters. Kept in the audit log."
            error={reasonError ? 'Give a reason for this change.' : undefined}
          >
            <Textarea
              value={reason}
              maxLength={500}
              onChange={(event) => {
                setReason(event.target.value)
                setReasonError(false)
              }}
            />
          </Field>
        ) : null}

        {failure === null ? null : (
          <Banner tone="danger" title={failure.title} live="alert">
            {failure.body}
          </Banner>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={!closeAllowed} onClick={onExit}>
            Close editor
          </Button>
          {dirty ? <p className="text-sm text-ink-soft">Save or discard your changes to close.</p> : null}
        </div>

        <SaveBar
          dirty={dirty}
          saving={mutation.isPending}
          onSave={save}
          onDiscard={discard}
          conflict={conflict}
          onReloadLatest={reload}
        />
      </section>
    </Dialog>
  )
}
