import { z } from 'zod'
import { capabilityFlagSchema, writeVersionSchema } from '@/lib/api/types/admin/common'
import { resultOutcomeSchema } from '@/lib/api/types/event-room'
import { pairingModeSchema } from '@/lib/api/types/event-state'
import { countSchema, isoInstantSchema, plainText, uuidSchema, versionSchema } from '@/lib/api/types/primitives'

// Rounds, pairings, results and finalise (contract C06 to C12, screen 49; EVENT-ENGINE "Round lifecycle";
// STATE-MACHINES "Round", "Pairing result"). The server owns every transition; the UI renders `capabilities` and shows the
// text reason of a disabled control (AC-84).
//
//   Round:   draft -> published -> live -> completed;  draft -> void (replaced before publication)
//   Result:  none -> submitted -> final;  submitted -> disputed -> final (admin resolves)
//   Pairings are versioned: after publish an edit creates a NEW round version with a mandatory reason and an audit entry.
//   Finalise runs only when every result is final (RESULTS_NOT_FINAL otherwise), is idempotent by `ratings_processed_at`
//   (ROUND_ALREADY_FINALIZED on a different key; the same key returns the original success) and enqueues rating processing.

export const ADMIN_ROUND_STATES = ['draft', 'published', 'live', 'completed', 'void'] as const
export const adminRoundStateSchema = z.enum(ADMIN_ROUND_STATES)
export type AdminRoundState = z.infer<typeof adminRoundStateSchema>

/** Blocker code the finalise capability uses while results are missing or disputed (matches the error code). */
export const RESULTS_NOT_FINAL_BLOCKER = 'RESULTS_NOT_FINAL'

// ---------- Players and results on a board ----------

export const boardPlayerSchema = z.object({
  registrationId: uuidSchema,
  name: plainText(80),
  rating: z.int().min(0).max(4000).nullable(),
  firstTimer: z.boolean(),
})
export type BoardPlayer = z.infer<typeof boardPlayerSchema>

/** A checked-in or confirmed player who is not seated in this round yet (round `candidates`, editable rounds only). */
export const candidateSchema = boardPlayerSchema.extend({ checkedIn: z.boolean() })
export type Candidate = z.infer<typeof candidateSchema>

/** Who put a result in, from the admin's point of view (no "me"/"opponent" here). */
export const adminResultSourceSchema = z.enum(['white', 'black', 'admin'])

/**
 * Admin view of a pairing result. `final` always has an outcome; `disputed` always has the submitted outcome and the
 * dispute note, so the admin can resolve it. Ratings only use `final`.
 */
export const adminResultSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('none') }),
  z.object({
    state: z.literal('submitted'),
    outcome: resultOutcomeSchema,
    submittedBy: adminResultSourceSchema,
    submittedAt: isoInstantSchema,
  }),
  z.object({
    state: z.literal('disputed'),
    outcome: resultOutcomeSchema,
    submittedBy: adminResultSourceSchema,
    disputedBy: z.enum(['white', 'black']),
    note: plainText(500).nullable(),
  }),
  z.object({
    state: z.literal('final'),
    outcome: resultOutcomeSchema,
    decidedBy: z.enum(['players', 'admin']),
    /** Set when an admin recorded, overrode or resolved the result. */
    adminReason: plainText(500).nullable(),
  }),
])
export type AdminResultDto = z.infer<typeof adminResultSchema>
export type AdminResultState = AdminResultDto['state']

/**
 * A board is either a game or a bye (a bye has one player and no result to enter). A union keeps `opponent` from being
 * faked, same as the player room.
 */
export const adminPairingSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('game'),
    pairingId: uuidSchema,
    board: z.int().min(1).max(500),
    white: boardPlayerSchema,
    black: boardPlayerSchema,
    result: adminResultSchema,
    /** Advisory: the two players already met in another published, live or completed round of this event. */
    rematch: z.boolean(),
    capabilities: z.object({ canEnterResult: capabilityFlagSchema, canResolveDispute: capabilityFlagSchema }),
  }),
  z.object({
    kind: z.literal('bye'),
    pairingId: uuidSchema,
    board: z.int().min(1).max(500),
    player: boardPlayerSchema,
  }),
])
export type AdminPairingDto = z.infer<typeof adminPairingSchema>

// ---------- Round ----------

export const adminRatingProcessingSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('not_rated') }),
  z.object({ status: z.literal('pending'), enqueuedAt: isoInstantSchema }),
  z.object({ status: z.literal('complete'), processedAt: isoInstantSchema }),
])
export type AdminRatingProcessing = z.infer<typeof adminRatingProcessingSchema>

export const roundCapabilitiesSchema = z.object({
  canEdit: capabilityFlagSchema,
  canPublish: capabilityFlagSchema,
  canStart: capabilityFlagSchema,
  /** Disabled with `blockers[]` (code RESULTS_NOT_FINAL) until every result is final. */
  canFinalise: capabilityFlagSchema,
})
export type RoundCapabilities = z.infer<typeof roundCapabilitiesSchema>

const roundBase = {
  id: uuidSchema,
  roundNo: z.int().min(1).max(100),
  method: pairingModeSchema,
  pairings: z.array(adminPairingSchema).max(500),
  /** Games whose result is not `final` yet (excludes byes). Drives the "result incomplete" state. */
  unresolvedResults: countSchema,
  /** Increments on every pairing change, including post-publish corrections. */
  pairingVersion: versionSchema,
  /** Unseated, confirmed, pairing-active players for the editor. Empty when the round is not editable. Max 500. */
  candidates: z.array(candidateSchema).max(500),
  capabilities: roundCapabilitiesSchema,
  version: versionSchema,
  updatedAt: isoInstantSchema,
}

export const adminRoundSchema = z.discriminatedUnion('state', [
  z.object({ ...roundBase, state: z.literal('draft') }),
  z.object({ ...roundBase, state: z.literal('published'), publishedAt: isoInstantSchema }),
  z.object({ ...roundBase, state: z.literal('live'), publishedAt: isoInstantSchema, startedAt: isoInstantSchema }),
  z.object({
    ...roundBase,
    state: z.literal('completed'),
    publishedAt: isoInstantSchema,
    finalisedAt: isoInstantSchema,
    ratingProcessing: adminRatingProcessingSchema,
  }),
  z.object({ ...roundBase, state: z.literal('void') }),
])
export type AdminRoundDto = z.infer<typeof adminRoundSchema>

/** `GET /admin/events/{id}/rounds` (C06). Bounded. */
export const adminRoundsSchema = z.object({ rounds: z.array(adminRoundSchema).max(30), serverNow: isoInstantSchema })
export type AdminRoundsDto = z.infer<typeof adminRoundsSchema>

// ---------- Commands ----------

/** `POST .../rounds/generate` (C07): creates an UNPUBLISHED draft. No FIDE compliance claim is made by the engine. */
export const generateRoundSchema = z.strictObject({
  roundNo: z.int().min(1).max(100),
  method: pairingModeSchema.optional(),
})
export type GenerateRoundInput = z.infer<typeof generateRoundSchema>

const editBoard = z.strictObject({
  pairingId: uuidSchema.optional(),
  board: z.int().min(1).max(500),
  whiteRegistrationId: uuidSchema,
  blackRegistrationId: uuidSchema,
})
const editBye = z.strictObject({ registrationId: uuidSchema })
const pairingsEdit = {
  version: writeVersionSchema,
  boards: z.array(editBoard).max(500),
  byes: z.array(editBye).max(50),
}

/**
 * `PATCH .../rounds/{roundId}/pairings` (C08). A draft edit takes no reason. A published or live round edit creates a new
 * round version and REQUIRES a reason (audited). `colour` swaps are expressed by swapping the two ids.
 */
export const editPairingsSchema = z.discriminatedUnion('phase', [
  z.strictObject({ phase: z.literal('draft'), ...pairingsEdit, reason: plainText(500).optional() }),
  z.strictObject({ phase: z.literal('after_publish'), ...pairingsEdit, reason: z.string().trim().min(1).max(500) }),
])
export type EditPairingsInput = z.infer<typeof editPairingsSchema>

/** `POST .../rounds/{roundId}/publish` (C09), IK. Notifies players. */
export const publishRoundSchema = z.strictObject({ version: writeVersionSchema })
export type PublishRoundInput = z.infer<typeof publishRoundSchema>

/** `POST .../rounds/{roundId}/start` (C10). */
export const startRoundSchema = z.strictObject({ version: writeVersionSchema })
export type StartRoundInput = z.infer<typeof startRoundSchema>

/**
 * `PUT .../pairings/{pairingId}/result` (C11). `record` enters or overrides a result as final; `resolve` settles a
 * dispute. Both need a reason (audited). Strict.
 */
export const recordResultSchema = z.strictObject({
  action: z.literal('record'),
  outcome: resultOutcomeSchema,
  reason: z.string().trim().min(1).max(500),
})
export type RecordResultInput = z.infer<typeof recordResultSchema>

/** C11 `resolveResult`: settles a disputed pairing (ARCH-001 11.1 `admin.control.resolveResult`). */
export const resolveResultSchema = z.strictObject({
  action: z.literal('resolve'),
  outcome: resultOutcomeSchema,
  reason: z.string().trim().min(1).max(500),
})
export type ResolveResultInput = z.infer<typeof resolveResultSchema>

/** Wire body of C11: both forms on one endpoint, discriminated by `action`. */
export const resultCommandSchema = z.discriminatedUnion('action', [recordResultSchema, resolveResultSchema])
export type ResultCommandInput = z.infer<typeof resultCommandSchema>

/** C11 response: the updated pairing and the round-level counters the page needs to refresh the finalise control. */
export const recordResultResultSchema = z.object({
  pairing: adminPairingSchema,
  unresolvedResults: countSchema,
  canFinalise: capabilityFlagSchema,
  roundVersion: versionSchema,
})
export type RecordResultResult = z.infer<typeof recordResultResultSchema>

/** `POST .../rounds/{roundId}/finalise` (C12), IK. Idempotent by state: a replay returns the original success. */
export const finaliseRoundSchema = z.strictObject({ version: writeVersionSchema })
export type FinaliseRoundInput = z.infer<typeof finaliseRoundSchema>

export const finaliseResultSchema = z.object({
  roundId: uuidSchema,
  state: z.literal('completed'),
  finalisedAt: isoInstantSchema,
  ratingProcessing: adminRatingProcessingSchema,
  version: versionSchema,
})
export type FinaliseResult = z.infer<typeof finaliseResultSchema>
