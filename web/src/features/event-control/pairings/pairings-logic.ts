import type { AdminPairingDto, AdminRoundDto, EditPairingsInput } from '@/lib/api/types/admin/control-rounds'

// Pure state and derivation logic of the Pairings tab (FE-33). No React, no API calls: everything here is unit tested.

type GamePairing = Extract<AdminPairingDto, { kind: 'game' }>
type Side = 'white' | 'black'

/** The server answers this id for a player whose registration is gone. Such a seat cannot be moved. */
export const NO_REGISTRATION_ID = '00000000-0000-0000-0000-000000000000'

/** Largest board number the server accepts (C08). */
export const MAX_BOARD_NO = 500
/** The player picker renders at most this many rows; the rest are reached by typing. */
export const MAX_PICKER_ROWS = 100

export interface DraftBoard {
  board: number
  /** Null while a seat is empty (a new board, or a player was moved off it). Saving needs both seats filled. */
  white: string | null
  black: string | null
  /** A board with a result is read-only (the server refuses to change it). */
  locked: boolean
}

/** Local, unsaved arrangement of a round. Players are identified by registration id. */
export interface DraftModel {
  boards: readonly DraftBoard[]
  byes: readonly string[]
}

/** What the editor shows about one player: a seated player, or an unseated candidate from the round. */
export interface PlayerInfo {
  registrationId: string
  name: string
  rating: number | null
  firstTimer: boolean
  /** Known only for candidates. Null for seated players (the round DTO does not carry check-in for them). */
  checkedIn: boolean | null
}

/** Every player the editor can name: seated players first, then the round's unseated candidates. */
export function playerDirectory(round: Pick<AdminRoundDto, 'pairings' | 'candidates'>): ReadonlyMap<string, PlayerInfo> {
  const map = new Map<string, PlayerInfo>()
  for (const candidate of round.candidates) {
    map.set(candidate.registrationId, { ...candidate })
  }
  for (const pairing of round.pairings) {
    const seated = pairing.kind === 'bye' ? [pairing.player] : [pairing.white, pairing.black]
    for (const player of seated) {
      map.set(player.registrationId, {
        registrationId: player.registrationId,
        name: player.name,
        rating: player.rating,
        firstTimer: player.firstTimer,
        checkedIn: null,
      })
    }
  }
  return map
}

export function modelFromRound(round: Pick<AdminRoundDto, 'pairings'>): DraftModel {
  const boards: DraftBoard[] = []
  const byes: string[] = []
  for (const pairing of round.pairings) {
    if (pairing.kind === 'bye') {
      byes.push(pairing.player.registrationId)
    } else {
      boards.push({
        board: pairing.board,
        white: pairing.white.registrationId,
        black: pairing.black.registrationId,
        locked:
          pairing.result.state !== 'none' ||
          pairing.white.registrationId === NO_REGISTRATION_ID ||
          pairing.black.registrationId === NO_REGISTRATION_ID,
      })
    }
  }
  boards.sort((a, b) => a.board - b.board)
  return { boards, byes }
}

/** Is this player's seat movable in the model? (Not on a locked board, and has a registration.) */
export function isMovable(model: DraftModel, registrationId: string): boolean {
  if (registrationId === NO_REGISTRATION_ID) return false
  for (const board of model.boards) {
    if (board.white === registrationId || board.black === registrationId) return !board.locked
  }
  return model.byes.includes(registrationId)
}

export type Location = { kind: 'seat'; board: number; side: Side } | { kind: 'bye' }

/** Where a player sits in the model, or null when not seated (unpaired). */
export function locate(model: DraftModel, registrationId: string): Location | null {
  for (const board of model.boards) {
    if (board.white === registrationId) return { kind: 'seat', board: board.board, side: 'white' }
    if (board.black === registrationId) return { kind: 'seat', board: board.board, side: 'black' }
  }
  return model.byes.includes(registrationId) ? { kind: 'bye' } : null
}

/**
 * Puts a player into a seat. If the player already sits elsewhere, the seat's current occupant takes that place (a
 * swap; an empty seat leaves an empty place). An unseated player displaces the occupant to the unpaired list. Refuses
 * (returns the same model) for a locked board, a locked origin board or an unknown board.
 */
export function placeInSeat(model: DraftModel, boardNo: number, side: Side, registrationId: string): DraftModel {
  const target = model.boards.find((board) => board.board === boardNo)
  if (target === undefined || target.locked || target[side] === registrationId) return model
  if (registrationId === NO_REGISTRATION_ID) return model
  const from = locate(model, registrationId)
  if (from?.kind === 'seat' && model.boards.find((board) => board.board === from.board)?.locked === true) return model
  const occupant = target[side]

  let byes = [...model.byes]
  if (from?.kind === 'bye') {
    byes = occupant === null ? byes.filter((id) => id !== registrationId) : byes.map((id) => (id === registrationId ? occupant : id))
  }
  const boards = model.boards.map((board) => {
    const next: DraftBoard = { ...board }
    if (board.board === boardNo) next[side] = registrationId
    if (from?.kind === 'seat' && from.board === board.board) next[from.side] = occupant
    return next
  })
  return { boards, byes }
}

/** Adds an unpaired player to the byes. A seated player is not moved (empty a seat first). */
export function addBye(model: DraftModel, registrationId: string): DraftModel {
  if (registrationId === NO_REGISTRATION_ID || locate(model, registrationId) !== null) return model
  return { ...model, byes: [...model.byes, registrationId] }
}

export function removeBye(model: DraftModel, registrationId: string): DraftModel {
  if (!model.byes.includes(registrationId)) return model
  return { ...model, byes: model.byes.filter((id) => id !== registrationId) }
}

/** Adds an empty board numbered after the highest one. Returns the same model at the server's board limit. */
export function addBoard(model: DraftModel): DraftModel {
  const next = Math.max(0, ...model.boards.map((board) => board.board)) + 1
  if (next > MAX_BOARD_NO) return model
  return { ...model, boards: [...model.boards, { board: next, white: null, black: null, locked: false }] }
}

/** Removes an unlocked board. Its players become unpaired. */
export function removeBoard(model: DraftModel, boardNo: number): DraftModel {
  const target = model.boards.find((board) => board.board === boardNo)
  if (target === undefined || target.locked) return model
  return { ...model, boards: model.boards.filter((board) => board.board !== boardNo) }
}

/** Swaps the seats of two players (board slot or bye). Returns the same object when the swap is not allowed. */
export function swapPlayers(model: DraftModel, a: string, b: string): DraftModel {
  if (a === b || !isMovable(model, a) || !isMovable(model, b)) return model
  const swap = (id: string | null): string | null => (id === null ? null : id === a ? b : id === b ? a : id)
  return {
    boards: model.boards.map((board) =>
      board.locked ? board : { ...board, white: swap(board.white), black: swap(board.black) },
    ),
    byes: model.byes.map((id) => swap(id) ?? id),
  }
}

/** Swaps white and black on one board (no effect on a locked or unknown board). */
export function flipColours(model: DraftModel, boardNo: number): DraftModel {
  const target = model.boards.find((board) => board.board === boardNo)
  if (target === undefined || target.locked) return model
  return {
    ...model,
    boards: model.boards.map((board) =>
      board.board === boardNo ? { ...board, white: board.black, black: board.white } : board,
    ),
  }
}

export function sameModel(a: DraftModel, b: DraftModel): boolean {
  return (
    a.boards.length === b.boards.length &&
    a.byes.length === b.byes.length &&
    a.boards.every((board, i) => {
      const other = b.boards[i]
      return (
        other !== undefined && board.board === other.board && board.white === other.white && board.black === other.black
      )
    }) &&
    a.byes.every((id, i) => id === b.byes[i])
  )
}

/** Reasons the draft cannot be saved yet (shown as text above the boards). Empty when it can be saved. */
export function draftProblems(model: DraftModel): string[] {
  return model.boards
    .filter((board) => board.white === null || board.black === null)
    .map((board) => `Board ${String(board.board)} needs a player on both sides.`)
}

/** A round that was published or started takes a new round version on every edit, and then a reason is required. */
export function editPhase(round: Pick<AdminRoundDto, 'state'>): 'draft' | 'after_publish' {
  return round.state === 'draft' ? 'draft' : 'after_publish'
}

export type EditRequest =
  | { ok: true; input: EditPairingsInput }
  | { ok: false; reasonMissing: true }
  | { ok: false; incomplete: true }

/**
 * Builds the C08 body. After publish a blank reason is refused here (the server also requires it). A board with an
 * empty seat is refused too (`incomplete`); the editor shows `draftProblems` before it gets here.
 */
export function buildEditInput(
  model: DraftModel,
  round: Pick<AdminRoundDto, 'state'>,
  version: number,
  reason: string,
): EditRequest {
  const boards: EditPairingsInput['boards'] = []
  for (const board of model.boards) {
    if (board.white === null || board.black === null) return { ok: false, incomplete: true }
    boards.push({ board: board.board, whiteRegistrationId: board.white, blackRegistrationId: board.black })
  }
  const byes = model.byes.map((registrationId) => ({ registrationId }))
  const trimmed = reason.trim()
  if (editPhase(round) === 'draft') {
    return {
      ok: true,
      input: { phase: 'draft', version, boards, byes, ...(trimmed === '' ? {} : { reason: trimmed }) },
    }
  }
  if (trimmed === '') return { ok: false, reasonMissing: true }
  return { ok: true, input: { phase: 'after_publish', version, boards, byes, reason: trimmed } }
}

// ---------- Round progress (TASK-008) ----------

/** "N of M results final": M is the number of games (byes have no result). */
export function resultProgress(round: Pick<AdminRoundDto, 'pairings'>): { final: number; total: number } {
  const games = gamesOf(round)
  return { final: games.filter((pairing) => pairing.result.state === 'final').length, total: games.length }
}

// ---------- Publish and finalise consequences (TASK-009) ----------

export interface RoundCounts {
  /** Game boards (byes excluded). */
  boards: number
  byes: number
  /** Distinct players on a board or a bye: the people a publish notifies. */
  players: number
  /** Distinct players on a board (byes excluded): the people a finalise rates. */
  gamePlayers: number
}

/** Boards, byes and distinct players of a round, as the publish and finalise dialogs describe them. */
export function roundCounts(round: Pick<AdminRoundDto, 'pairings'>): RoundCounts {
  const ids = new Set<string>()
  const gameIds = new Set<string>()
  let boards = 0
  let byes = 0
  for (const pairing of round.pairings) {
    if (pairing.kind === 'bye') {
      byes += 1
      ids.add(pairing.player.registrationId)
    } else {
      boards += 1
      for (const id of [pairing.white.registrationId, pairing.black.registrationId]) {
        ids.add(id)
        gameIds.add(id)
      }
    }
  }
  return { boards, byes, players: ids.size, gamePlayers: gameIds.size }
}

// ---------- Rematch warning (advisory, TASK-007) ----------

/** Order-independent key for a pair of registration ids. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * Keys of the game pairings the server flagged as rematches. The round DTO only says this about pairings that exist
 * now, so a pair the editor creates is not known here (see the report).
 */
export function rematchKeys(round: Pick<AdminRoundDto, 'pairings'>): ReadonlySet<string> {
  const keys = new Set<string>()
  for (const pairing of gamesOf(round)) {
    if (pairing.rematch) keys.add(pairKey(pairing.white.registrationId, pairing.black.registrationId))
  }
  return keys
}

/** Boards in the draft whose two players already met (warn before save; saving is still allowed). */
export function rematchBoards(model: DraftModel, keys: ReadonlySet<string>): number[] {
  if (keys.size === 0) return []
  return model.boards
    .filter((board) => board.white !== null && board.black !== null && keys.has(pairKey(board.white, board.black)))
    .map((board) => board.board)
}

/** Text for the version a published round's edit creates. Never a hard-coded number. */
export function nextVersionCopy(round: Pick<AdminRoundDto, 'version'>): string {
  return `This creates version ${String(round.version + 1)} and notifies the affected players.`
}

// ---------- Player picker (searchable White, Black and bye choices) ----------

export interface PickerOption extends PlayerInfo {
  /** Where the player sits now ("Board 2 White", "Bye"), or null when unpaired. */
  seatedAt: string | null
}

function seatLabel(model: DraftModel, registrationId: string): string | null {
  const where = locate(model, registrationId)
  if (where === null) return null
  return where.kind === 'bye' ? 'Bye' : `Board ${String(where.board)} ${where.side === 'white' ? 'White' : 'Black'}`
}

/** Unpaired first, checked-in first, then by name. Seated players come last so a swap is never the default. */
function rank(option: PickerOption): number {
  if (option.seatedAt !== null) return 3
  if (option.checkedIn === true) return 0
  if (option.checkedIn === false) return 2
  return 1
}

function sortOptions(options: PickerOption[]): PickerOption[] {
  return options.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

/**
 * Players offered for one seat: every known player except those on a locked board. Choosing a seated player swaps
 * seats, so no player can end up on two seats.
 */
export function seatOptions(
  model: DraftModel,
  directory: ReadonlyMap<string, PlayerInfo>,
  boardNo: number,
  side: Side,
): PickerOption[] {
  const occupant = model.boards.find((board) => board.board === boardNo)?.[side] ?? null
  const locked = new Set<string>()
  for (const board of model.boards) {
    if (!board.locked) continue
    if (board.white !== null) locked.add(board.white)
    if (board.black !== null) locked.add(board.black)
  }
  const options: PickerOption[] = []
  for (const info of directory.values()) {
    if (info.registrationId === NO_REGISTRATION_ID || locked.has(info.registrationId)) continue
    const seatedAt = info.registrationId === occupant ? null : seatLabel(model, info.registrationId)
    options.push({ ...info, seatedAt })
  }
  return sortOptions(options)
}

/** Players who can be added as a bye: unpaired only (a seated player is moved by choosing a seat). */
export function byeOptions(model: DraftModel, directory: ReadonlyMap<string, PlayerInfo>): PickerOption[] {
  const options: PickerOption[] = []
  for (const info of directory.values()) {
    if (info.registrationId === NO_REGISTRATION_ID || locate(model, info.registrationId) !== null) continue
    options.push({ ...info, seatedAt: null })
  }
  return sortOptions(options)
}

/** Name or exact rating match, case-insensitive. An empty query keeps everything. */
export function filterOptions<T extends PlayerInfo>(options: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...options]
  return options.filter(
    (option) => option.name.toLowerCase().includes(q) || (option.rating !== null && String(option.rating) === q),
  )
}

// ---------- Round selection and generation ----------

/** Round to show first: the one in play, else the newest (so the admin lands on the work that needs attention). */
export function defaultRoundId(rounds: readonly AdminRoundDto[]): string | null {
  if (rounds.length === 0) return null
  const open = rounds.findLast(
    (round) => round.state === 'live' || round.state === 'published' || round.state === 'draft',
  )
  return (open ?? rounds[rounds.length - 1])?.id ?? null
}

export interface GeneratePlan {
  /** The round number a Generate action would create or regenerate; null when none can be generated. */
  roundNo: number | null
  /** True when it replaces an existing draft. */
  regenerates: boolean
  /** Visible explanation when `roundNo` is null. */
  reason: string | null
}

const GENERATE_EVENT_STATUSES: readonly string[] = ['published', 'registration_open', 'sold_out', 'ongoing']

export function planGenerate(
  rounds: readonly AdminRoundDto[],
  eventStatus: string,
  roundsPlanned: number | null,
): GeneratePlan {
  if (!GENERATE_EVENT_STATUSES.includes(eventStatus)) {
    return {
      roundNo: null,
      regenerates: false,
      reason: 'Rounds can be generated once the event is published and until it ends.',
    }
  }
  const last = rounds.length === 0 ? undefined : rounds.reduce((a, b) => (b.roundNo > a.roundNo ? b : a))
  if (last === undefined) return { roundNo: 1, regenerates: false, reason: null }
  if (last.state === 'draft') return { roundNo: last.roundNo, regenerates: true, reason: null }
  if (last.state !== 'completed' && last.state !== 'void') {
    return {
      roundNo: null,
      regenerates: false,
      reason: `Finalise round ${String(last.roundNo)} before generating round ${String(last.roundNo + 1)}.`,
    }
  }
  const next = last.roundNo + 1
  if (roundsPlanned !== null && roundsPlanned > 0 && next > roundsPlanned) {
    return {
      roundNo: null,
      regenerates: false,
      reason: `All ${String(roundsPlanned)} planned round${roundsPlanned === 1 ? '' : 's'} have been played.`,
    }
  }
  return { roundNo: next, regenerates: false, reason: null }
}

// ---------- Results ----------

export type ResultAction = 'record' | 'override' | 'resolve'

/** What the admin can do to a game's result, from server capabilities. `null` when nothing is possible. */
export function resultActionFor(pairing: GamePairing): ResultAction | null {
  if (pairing.result.state === 'disputed') return pairing.capabilities.canResolveDispute.allowed ? 'resolve' : null
  if (!pairing.capabilities.canEnterResult.allowed) return null
  return pairing.result.state === 'final' ? 'override' : 'record'
}

export function disputedGames(round: Pick<AdminRoundDto, 'pairings'>): GamePairing[] {
  return round.pairings.filter(
    (pairing): pairing is GamePairing => pairing.kind === 'game' && pairing.result.state === 'disputed',
  )
}

export function gamesOf(round: Pick<AdminRoundDto, 'pairings'>): GamePairing[] {
  return round.pairings.filter((pairing): pairing is GamePairing => pairing.kind === 'game')
}

export function openResultCount(round: Pick<AdminRoundDto, 'pairings'>): number {
  return gamesOf(round).filter((pairing) => pairing.result.state !== 'final').length
}
