import { z } from 'zod'
import { eventStatusSchema } from '@/lib/api/types/event-state'
import { gameOutcomeSchema } from '@/lib/api/types/rating'
import { publicIdentitySchema, ratingPoolSchema } from '@/lib/api/types/identity'
import { isoInstantSchema, plainText, slugSchema, uuidSchema } from '@/lib/api/types/primitives'
import { registrationSchema } from '@/lib/api/types/registration'
import { mediaRefSchema } from '@/lib/api/types/media'

// Player area reads (contract M01 to M04): next up, recent games, people, My Events. All `no-store`, owner only.

/**
 * Event link data: signed-in routes use the UUID (`/app/events/{id}`, OQ-06), public links use the slug.
 * `cover` is the event's hero/card image (added in EV-01). Null when the event has no cover.
 */
const eventLink = z.object({
  id: uuidSchema,
  slug: slugSchema,
  title: plainText(120),
  startsAt: isoInstantSchema,
  area: z.string().max(80), // optional in the event builder, so may be empty
  status: eventStatusSchema,
  cover: mediaRefSchema.nullable(),
})

/** `GET /me/events` rows (M04). `canCancel` is server-computed from the cancellation policy; the UI never infers it. */
export const myRegistrationSchema = z.object({
  registration: registrationSchema,
  event: eventLink,
  canCancel: z.boolean(),
  /** Text reason shown next to a disabled cancel action (AC-84). Null when cancel is allowed or not applicable. */
  cancelBlockedReason: plainText(200).nullable(),
  /** The Event Room is reachable only for a confirmed registration on a live or upcoming event. */
  canOpenRoom: z.boolean(),
})
export type MyRegistrationDto = z.infer<typeof myRegistrationSchema>

export const MY_EVENTS_SCOPES = ['upcoming', 'history'] as const
export const myEventsQuerySchema = z.object({
  scope: z.enum(MY_EVENTS_SCOPES),
  page: z.int().min(1).optional(),
  pageSize: z.int().min(1).max(100).optional(),
})
export type MyEventsQuery = z.infer<typeof myEventsQuerySchema>

/**
 * `GET /me/next-up` (M01) or null (empty state, dashboard with no next event). Board, opponent and colour appear only
 * once the round is published.
 */
export const nextUpSchema = z.object({
  registrationId: uuidSchema,
  event: eventLink,
  venue: plainText(200),
  /** What to do now, server-chosen text ("Check-in opens 30 minutes before play."). */
  nextAction: plainText(200),
  pairing: z
    .object({
      round: z.int().min(1).max(100),
      board: z.int().min(1).max(500),
      colour: z.enum(['white', 'black']),
      opponent: publicIdentitySchema,
    })
    .nullable(),
})
export type NextUpDto = z.infer<typeof nextUpSchema>

/** `GET /me/recent-games` rows (M02). Opponent is public identity only. */
export const gameSchema = z.object({
  id: uuidSchema,
  outcome: gameOutcomeSchema,
  pool: ratingPoolSchema,
  opponent: publicIdentitySchema,
  /** Null for unrated and social games (UI-STATES: "no delta for unrated/social game"). */
  ratingDelta: z.int().min(-1000).max(1000).nullable(),
  eventTitle: plainText(120),
  playedAt: isoInstantSchema,
})
export type GameDto = z.infer<typeof gameSchema>

/** `GET /me/people` rows (M03): opponents played most. Rematch actions are hidden at launch (OQ-09). */
export const personSchema = z.object({
  identity: publicIdentitySchema,
  games: z.int().min(1),
})
export type PersonDto = z.infer<typeof personSchema>
