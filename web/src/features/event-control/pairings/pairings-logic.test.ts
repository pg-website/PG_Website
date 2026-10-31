import { describe, expect, it } from 'vitest'
import {
  buildEditInput,
  defaultRoundId,
  disputedGames,
  editPhase,
  flipColours,
  isMovable,
  modelFromRound,
  openResultCount,
  pairKey,
  placeInSeat,
  planGenerate,
  rematchBoards,
  resultActionFor,
  resultProgress,
  roundCounts,
  sameModel,
  swapPlayers,
} from '@/features/event-control/pairings/pairings-logic'
import type { AdminPairingDto, AdminResultDto, AdminRoundDto } from '@/lib/api/types/admin/control-rounds'

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const player = (n: number) => ({ registrationId: id(n), name: `P${String(n)}`, rating: 1500, firstTimer: false })
const allowed = { allowed: true } as const
const blocked = { allowed: false, reason: 'No.' } as const

function game(board: number, w: number, b: number, result: AdminResultDto = { state: 'none' }): AdminPairingDto {
  return {
    kind: 'game',
    pairingId: id(100 + board),
    board,
    white: player(w),
    black: player(b),
    result,
    rematch: false,
    capabilities: {
      canEnterResult: allowed,
      canResolveDispute: result.state === 'disputed' ? allowed : blocked,
    },
  }
}
const bye = (board: number, p: number): AdminPairingDto => ({
  kind: 'bye',
  pairingId: id(100 + board),
  board,
  player: player(p),
})

function round(
  roundNo: number,
  state: AdminRoundDto['state'],
  pairings: AdminPairingDto[] = [],
): Pick<AdminRoundDto, 'id' | 'roundNo' | 'state' | 'pairings'> {
  return { id: id(900 + roundNo), roundNo, state, pairings }
}
const asRounds = (...r: ReturnType<typeof round>[]): AdminRoundDto[] => r as unknown as AdminRoundDto[]

describe('draft model', () => {
  const r = round(1, 'draft', [game(1, 1, 2), game(2, 3, 4), bye(3, 5)])

  it('builds boards in order with byes apart', () => {
    const model = modelFromRound(r)
    expect(model.boards.map((b) => [b.board, b.white, b.black])).toEqual([
      [1, id(1), id(2)],
      [2, id(3), id(4)],
    ])
    expect(model.byes).toEqual([id(5)])
  })

  it('swaps two players across boards without mutating the original', () => {
    const model = modelFromRound(r)
    const next = swapPlayers(model, id(2), id(3))
    expect(next.boards.map((b) => [b.white, b.black])).toEqual([
      [id(1), id(3)],
      [id(2), id(4)],
    ])
    expect(model.boards[0]?.black).toBe(id(2))
    expect(sameModel(model, next)).toBe(false)
  })

  it('swaps a board player with the bye', () => {
    const next = swapPlayers(modelFromRound(r), id(1), id(5))
    expect(next.boards[0]?.white).toBe(id(5))
    expect(next.byes).toEqual([id(1)])
  })

  it('swapping twice restores the model', () => {
    const model = modelFromRound(r)
    expect(sameModel(swapPlayers(swapPlayers(model, id(1), id(4)), id(1), id(4)), model)).toBe(true)
  })

  it('ignores a swap with oneself or an unknown player', () => {
    const model = modelFromRound(r)
    expect(swapPlayers(model, id(1), id(1))).toBe(model)
    expect(swapPlayers(model, id(1), id(77))).toBe(model)
  })

  it('flips colours on one board only', () => {
    const next = flipColours(modelFromRound(r), 2)
    expect(next.boards.map((b) => [b.white, b.black])).toEqual([
      [id(1), id(2)],
      [id(4), id(3)],
    ])
    expect(flipColours(modelFromRound(r), 9)).toEqual(modelFromRound(r))
  })

  it('locks boards that have a result', () => {
    const played = round(1, 'live', [
      game(1, 1, 2, { state: 'final', outcome: 'draw', decidedBy: 'players', adminReason: null }),
      game(2, 3, 4),
    ])
    const model = modelFromRound(played)
    expect(isMovable(model, id(1))).toBe(false)
    expect(isMovable(model, id(3))).toBe(true)
    expect(swapPlayers(model, id(1), id(3))).toBe(model)
    expect(flipColours(model, 1)).toBe(model)
  })
})

describe('buildEditInput', () => {
  const model = modelFromRound(round(1, 'draft', [game(1, 1, 2), bye(2, 3)]))

  it('needs no reason for a draft and omits a blank one', () => {
    const result = buildEditInput(model, { state: 'draft' }, 4, '  ')
    expect(result).toEqual({
      ok: true,
      input: {
        phase: 'draft',
        version: 4,
        boards: [{ board: 1, whiteRegistrationId: id(1), blackRegistrationId: id(2) }],
        byes: [{ registrationId: id(3) }],
      },
    })
  })

  it('requires a reason after publish and trims it', () => {
    expect(buildEditInput(model, { state: 'published' }, 2, '  ')).toEqual({ ok: false, reasonMissing: true })
    const ok = buildEditInput(model, { state: 'live' }, 2, '  late arrival ')
    expect(ok.ok && ok.input.phase === 'after_publish' && ok.input.reason).toBe('late arrival')
  })

  it('maps round state to the edit phase', () => {
    expect(editPhase({ state: 'draft' })).toBe('draft')
    expect(editPhase({ state: 'published' })).toBe('after_publish')
    expect(editPhase({ state: 'live' })).toBe('after_publish')
  })
})

describe('planGenerate', () => {
  it('offers round 1 when there are no rounds', () => {
    expect(planGenerate([], 'registration_open', 3)).toMatchObject({ roundNo: 1, regenerates: false })
  })
  it('refuses outside the event window', () => {
    expect(planGenerate([], 'draft', 3).roundNo).toBeNull()
    expect(planGenerate([], 'completed', 3).reason).toMatch(/until it ends/)
  })
  it('regenerates the draft round', () => {
    expect(planGenerate(asRounds(round(1, 'draft')), 'ongoing', 3)).toMatchObject({ roundNo: 1, regenerates: true })
  })
  it('waits for the current round to finish', () => {
    const plan = planGenerate(asRounds(round(1, 'live')), 'ongoing', 3)
    expect(plan.roundNo).toBeNull()
    expect(plan.reason).toMatch(/Finalise round 1/)
  })
  it('offers the next round after a finalised one, until the plan is used up', () => {
    expect(planGenerate(asRounds(round(1, 'completed')), 'ongoing', 3).roundNo).toBe(2)
    expect(planGenerate(asRounds(round(1, 'completed')), 'ongoing', null).roundNo).toBe(2)
    expect(planGenerate(asRounds(round(3, 'completed')), 'ongoing', 3).reason).toMatch(/planned/)
  })
})

describe('round selection and results', () => {
  it('lands on the round in play, else the newest', () => {
    expect(defaultRoundId([])).toBeNull()
    const rs = asRounds(round(1, 'completed'), round(2, 'live'), round(3, 'void'))
    expect(defaultRoundId(rs)).toBe(id(902))
    expect(defaultRoundId(asRounds(round(1, 'completed'), round(2, 'completed')))).toBe(id(902))
  })

  it('derives the result action from state and capabilities', () => {
    const none = game(1, 1, 2) as Extract<AdminPairingDto, { kind: 'game' }>
    expect(resultActionFor(none)).toBe('record')
    const final = game(1, 1, 2, { state: 'final', outcome: 'white', decidedBy: 'players', adminReason: null })
    expect(resultActionFor(final as typeof none)).toBe('override')
    const disputed = game(1, 1, 2, {
      state: 'disputed',
      outcome: 'white',
      submittedBy: 'white',
      disputedBy: 'black',
      note: null,
    })
    expect(resultActionFor(disputed as typeof none)).toBe('resolve')
    expect(
      resultActionFor({ ...none, capabilities: { canEnterResult: blocked, canResolveDispute: blocked } }),
    ).toBeNull()
  })

  it('counts open results and finds disputes, ignoring byes', () => {
    const r = round(1, 'live', [
      game(1, 1, 2, { state: 'final', outcome: 'draw', decidedBy: 'players', adminReason: null }),
      game(2, 3, 4, { state: 'disputed', outcome: 'white', submittedBy: 'white', disputedBy: 'black', note: 'x' }),
      game(3, 5, 6),
      bye(4, 7),
    ])
    expect(openResultCount(r)).toBe(2)
    expect(disputedGames(r).map((g) => g.board)).toEqual([2])
  })
})

describe('editor helpers (TASK-006 to TASK-009)', () => {
  it('places a seated player into another seat and moves the occupant into the vacated one', () => {
    const model = modelFromRound(round(1, 'draft', [game(1, 1, 2), game(2, 3, 4), bye(3, 5)]))
    const next = placeInSeat(model, 2, 'white', id(1))
    expect(next.boards.map((b) => [b.white, b.black])).toEqual([
      [id(3), id(2)],
      [id(1), id(4)],
    ])
    expect(next.byes).toEqual([id(5)])
  })

  it('leaves a locked board alone when a player is placed on it', () => {
    const played = round(1, 'live', [
      game(1, 1, 2, { state: 'final', outcome: 'draw', decidedBy: 'players', adminReason: null }),
      game(2, 3, 4),
    ])
    const model = modelFromRound(played)
    expect(placeInSeat(model, 1, 'white', id(3))).toBe(model)
  })

  it('flags a rematch only on the board whose two players already met', () => {
    const rematch = { ...game(2, 3, 4), rematch: true } as AdminPairingDto
    const model = modelFromRound(round(1, 'draft', [game(1, 1, 2), rematch]))
    expect(rematchBoards(model, new Set([pairKey(id(4), id(3))]))).toEqual([2])
    expect(rematchBoards(model, new Set())).toEqual([])
  })

  it('counts boards, byes and players for the publish and finalise copy', () => {
    const counts = roundCounts(round(1, 'draft', [game(1, 1, 2), game(2, 3, 4), bye(3, 5)]))
    expect(counts).toEqual({ boards: 2, byes: 1, players: 5, gamePlayers: 4 })
  })

  it('reports results final out of games, ignoring byes', () => {
    const r = round(1, 'live', [
      game(1, 1, 2, { state: 'final', outcome: 'draw', decidedBy: 'players', adminReason: null }),
      game(2, 3, 4),
      bye(3, 5),
    ])
    expect(resultProgress(r)).toEqual({ final: 1, total: 2 })
  })
})
