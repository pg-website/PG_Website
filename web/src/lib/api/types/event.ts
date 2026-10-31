import { z } from 'zod'
import { standingsSchema } from '@/lib/api/types/standings'
import {
  eventAudienceSchema,
  eventTypeSchema,
  pairingModeSchema,
  publicEventStatusSchema,
} from '@/lib/api/types/event-state'
import { mediaCollectionSchema, mediaRefSchema } from '@/lib/api/types/media'
import { publicIdentitySchema, ratingPoolSchema } from '@/lib/api/types/identity'
import {
  countSchema,
  currencySchema,
  isoInstantSchema,
  paiseSchema,
  plainText,
  slugSchema,
  versionSchema,
} from '@/lib/api/types/primitives'

// Public event projections (contract P02, P03, P05). Public DTOs expose only what the pages render (AC-103):
// no UUID, no registration lists, no provider ids, no admin fields. `slug` is required, unique and IMMUTABLE ONCE
// PUBLISHED (FR-03): the public URL is /events/{slug} for the life of the event, including after it is completed or
// cancelled (FEAT-001 OQ-08). The internal UUID reaches the browser only through the player's own registration DTOs.

/** Price block. 0 paise is a free event (formatInr shows "Free"). Member and comp pricing are hidden at launch (OQ-09). */
export const eventPriceSchema = z.object({ pricePaise: paiseSchema, currency: currencySchema })

const rated = z.discriminatedUnion('rated', [
  z.object({ rated: z.literal(true), pool: ratingPoolSchema }),
  z.object({ rated: z.literal(false) }),
])

const venue = z.object({
  /** Short area label for cards, for example "Jubilee Hills". */
  area: z.string().max(80),
  city: z.string().max(80),
  /** Venue name and street address; present on detail only. May be blank on an unfinished builder. */
  venueName: z.string().max(120),
  /** Optional — admin may leave blank; not a publish blocker. */
  address: z.string().max(300),
})

/** Card for lists, Home and archive (`EventSummary`). */
export const eventSummarySchema = z.object({
  slug: slugSchema,
  title: plainText(120),
  /** One-line promise ("Easy games. Good coffee. Stay for another."). Optional — may be blank. */
  promise: z.string().max(200),
  type: eventTypeSchema,
  audience: eventAudienceSchema,
  status: publicEventStatusSchema,
  startsAt: isoInstantSchema,
  endsAt: isoInstantSchema,
  /** Neighbourhood or district (from Basics step). Empty string, null, or absent when not set. */
  area: z.string().max(80),
  /** City (from Basics step). Empty string, null, or absent when not set. */
  city: z.string().max(80),
  /** Short format label, for example "Social chess" or "5+2 Blitz". */
  format: z.string().max(60),
  price: eventPriceSchema,
  rated: z.boolean(),
  /** First-timer signal: how many first-timers are already joining (card: "7 joining"). */
  firstTimerCount: countSchema,
  /** Coarse hint only; the live number comes from availability (P04). Null when unknown or the event is over. */
  placesLeftHint: z.int().min(0).max(100000).nullable(),
  cover: mediaRefSchema.nullable(),
  /** Past events only (P05). */
  archivePublished: z.boolean(),
  version: versionSchema,
})
export type EventSummaryDto = z.infer<typeof eventSummarySchema>
/** ARCH-001 11.1 calls the card DTO `EventCardDto`; same type, both names are valid. */
export type EventCardDto = EventSummaryDto

const faqItemSchema = z.object({ question: plainText(200), answer: plainText(1500) })

const eventHighlightSchema = z.object({ title: plainText(80), body: plainText(300) })

/** The first-timer promise block: hosted arrival and pairing preference (builder step 2 and 3). */
const experienceSchema = z.object({
  /** Optional — welcome section fields may be blank if the admin didn't fill them in. */
  eyebrow: z.string().max(60).default(''),
  heading: z.string().max(160).default(''),
  body: z.string().max(1200).default(''),
  highlights: z.array(eventHighlightSchema).max(8).default([]),
})

const atAGlanceSchema = z.object({
  format: z.string().max(60),
  timeControl: z.string().max(60),
  membershipRequired: z.boolean(),
  hostedArrival: z.boolean(),
})

/** Registration window facts the open/full/closed panel reads together with live availability. */
const registrationWindowSchema = z.object({
  opensAt: isoInstantSchema.nullable(),
  closesAt: isoInstantSchema.nullable(),
  waitlistEnabled: z.boolean(),
})

/** Cancelled notice. Present only when status is cancelled. */
const cancelledNoticeSchema = z.object({ reason: plainText(500), cancelledAt: isoInstantSchema })

/** Archive block for completed events (screen 4). Present when the host has published the archive (F-EVT-016). */
export const eventArchiveSchema = z.object({
  recap: plainText(4000).nullable(),
  winner: publicIdentitySchema.nullable(),
  standings: standingsSchema,
  gallery: mediaCollectionSchema.nullable(),
  roundsPlayed: z.int().min(0).max(100),
})
export type EventArchiveDto = z.infer<typeof eventArchiveSchema>

/**
 * Detail page projection (`Event` public). Extends the card and adds logistics, FAQ and the archive. The registration
 * state itself is never here: it is player-specific (R01) and availability is live (P04).
 */
export const eventDetailSchema = eventSummarySchema.extend({
  description: z.string().max(4000),
  venue,
  experience: experienceSchema,
  atAGlance: atAGlanceSchema,
  pairingMode: pairingModeSchema,
  rating: rated,
  registration: registrationWindowSchema,
  logistics: z.array(plainText(400)).max(12),
  faq: z.array(faqItemSchema).max(20),
  media: mediaCollectionSchema,
  cancelled: cancelledNoticeSchema.nullable(),
  archive: eventArchiveSchema.nullable(),
  updatedAt: isoInstantSchema,
})
export type EventDetailDto = z.infer<typeof eventDetailSchema>
