import { z } from 'zod'
import { ratingPoolSchema } from '@/lib/api/types/identity'

// Public player profile (PLAN-007, `GET /players/{publicId}`). Only what the player chose to show: ratings are empty
// when hidden, the city is null when hidden. No email, phone, birthday, user id or handle.

export const publicProfileSchema = z.object({
  publicId: z.string().regex(/^[a-z2-7]{12,16}$/),
  displayName: z.string().trim().min(1).max(80),
  initials: z.string().trim().min(1).max(3),
  cityChapter: z.string().trim().min(1).max(80).nullable(),
  ratings: z.array(z.object({ pool: ratingPoolSchema, value: z.int().min(0).max(4000) })),
  /** Year the player joined. */
  memberSince: z.int().min(2000).max(3000),
  eventsPlayed: z.int().min(0),
})
export type PublicProfileDto = z.infer<typeof publicProfileSchema>
