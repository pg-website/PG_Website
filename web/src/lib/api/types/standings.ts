import { z } from 'zod'
import { publicIdentitySchema, ratingPoolSchema } from '@/lib/api/types/identity'

// Standings rows are PUBLIC projections: public identity only, never ids or contact data (NCT-L1).
// Used by the completed-event archive (screen 4) and the Event Room snapshot (screens 28, 29).

const halfPoints = z.number().min(0).max(200).multipleOf(0.5)

export const standingRowSchema = z.object({
  place: z.int().min(1),
  identity: publicIdentitySchema,
  /** Points scored (half points allowed). */
  score: halfPoints,
  /** Rounds played, so the UI can show "8/9". */
  rounds: z.int().min(0).max(100),
  /** Rating shown in the pool that the event is rated in, when the player allows it. */
  rating: z.object({ pool: ratingPoolSchema, value: z.int().min(0).max(4000) }).nullable(),
  /** First tie-break: sum of the opponents' scores. Optional so older responses and stored archives still parse. */
  buchholz: z.number().min(0).max(20000).optional(),
})
export type StandingRow = z.infer<typeof standingRowSchema>

export const standingsSchema = z.array(standingRowSchema).max(500)
