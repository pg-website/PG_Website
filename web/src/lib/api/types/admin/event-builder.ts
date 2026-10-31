import { z } from 'zod'
import { draftText, lastChangeSchema, publishReadinessSchema, writeVersionSchema } from '@/lib/api/types/admin/common'
import { slugFieldSchema } from '@/lib/api/types/admin/slug'
import { eventAudienceSchema, eventStatusSchema, eventTypeSchema, pairingModeSchema } from '@/lib/api/types/event-state'
import { ratingPoolSchema } from '@/lib/api/types/identity'
import { mediaModeSchema } from '@/lib/api/types/media'
import {
  authoringSlugSchema,
  currencySchema,
  isoInstantSchema,
  paiseSchema,
  mediaCollectionIdSchema,
  uuidSchema,
  versionSchema,
} from '@/lib/api/types/primitives'

// Event Builder draft (contract E02 to E04, E06; screens 38 to 45; FEAT-001 OQ-07 locked fields).
// Eight steps: Basics, Experience, Registration, Payment, Game system, Media, Communications, Review.
// A draft may be incomplete in ANY step (E02), so step fields are nullable or empty; "complete" is decided by the server
// and returned as `readiness` (publish blockers). Money is integer paise, currency is fixed to INR.

export const BUILDER_STEPS = [
  'basics',
  'experience',
  'registration',
  'payment',
  'game_system',
  'media',
  'communications',
  'review',
] as const
export const builderStepSchema = z.enum(BUILDER_STEPS)
export type BuilderStep = z.infer<typeof builderStepSchema>
/** Steps that hold editable data. `review` is a read-only summary step with no stored fields. */
export const BUILDER_DATA_STEPS = BUILDER_STEPS.filter((step) => step !== 'review')

/** Step 1 to 7 field groups mirror the PATCH body of E04. */
const venueText = draftText(120)

export const basicsStepSchema = z.object({
  title: draftText(120),
  slug: slugFieldSchema,
  type: eventTypeSchema,
  /** One-line promise used on cards. */
  promise: draftText(200),
  startsAt: isoInstantSchema.nullable(),
  endsAt: isoInstantSchema.nullable(),
  venueName: venueText,
  address: draftText(300),
  area: draftText(80),
  city: draftText(80),
  audience: eventAudienceSchema,
})
export type BasicsStep = z.infer<typeof basicsStepSchema>

const highlight = z.object({ title: draftText(80), body: draftText(300) })
const faq = z.object({ question: draftText(200), answer: draftText(1500) })

/**
 * Experience mode: the broad feel of the event. Shown as choice cards in the builder (screen 39).
 * 'social' → Hosted social (introductions, relaxed matching).
 * 'competitive' → Competitive (rounds, clocks, standings).
 * Backend gap: this field is not yet in the E04 PATCH contract; it is stored UI-side only and noted.
 */
export const EXPERIENCE_MODES = ['social', 'competitive'] as const
export const experienceModeSchema = z.enum(EXPERIENCE_MODES)
export type ExperienceMode = z.infer<typeof experienceModeSchema>

export const experienceStepSchema = z.object({
  description: draftText(4000),
  eyebrow: draftText(60),
  heading: draftText(160),
  body: draftText(1200),
  highlights: z.array(highlight).max(8),
  logistics: z.array(draftText(400)).max(12),
  faq: z.array(faq).max(20),
  hostedArrival: z.boolean(),
  /**
   * Arrival promise: a short paragraph shown on the event card (screen 39, "Arrival promise" textarea).
   * Backend gap: not yet in the E04 experience PATCH. Optional so legacy server responses (without this field) still parse.
   */
  arrivalPromise: draftText(400).optional().default(''),
  /**
   * Experience mode choice card (screen 39). Backend gap: field not in E04; UI-only.
   * Optional so server responses without this field still parse.
   * @see EXPERIENCE_MODES
   */
  mode: experienceModeSchema.nullable().optional().default(null),
  /**
   * Public tags: free-text chip array (screen 39, "Public tags" input).
   * Backend gap (PLAN-003 Q3): no tags field in the builder resource. Stored UI-only; not sent in PATCH.
   * Optional so server responses without this field still parse.
   */
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional().default([]),
})
export type ExperienceStep = z.infer<typeof experienceStepSchema>

/** Operational group: needs the stronger permission tier and is audited (E04, F-ADEV-020). */
export const registrationStepSchema = z.object({
  /** Null means unlimited (publish no longer requires a capacity). */
  capacity: z.int().min(1).max(100000).nullable(),
  waitlistEnabled: z.boolean(),
  opensAt: isoInstantSchema.nullable(),
  closesAt: isoInstantSchema.nullable(),
  membershipRequired: z.boolean(),
  /** First-timer question shown during registration (builder step 3). */
  askFirstTimer: z.boolean(),
  minAge: z.int().min(0).max(120).nullable(),
})
export type RegistrationStep = z.infer<typeof registrationStepSchema>

/** Operational group. No member or comp pricing at launch (OQ-09). The browser sends intent; the server prices. */
export const paymentStepSchema = z.object({
  pricePaise: paiseSchema,
  currency: currencySchema,
  /** Cancellation and refund window before the start, in hours. Null means no refunds. */
  refundWindowHours: z
    .int()
    .min(0)
    .max(24 * 60)
    .nullable(),
  holdMinutes: z.int().min(1).max(60),
})
export type PaymentStep = z.infer<typeof paymentStepSchema>

/** Operational group. League and workshop engines are Later (F-PAIR-010): the types stay selectable, the engine is `none`. */
export const gameSystemStepSchema = z.discriminatedUnion('rated', [
  z.object({
    rated: z.literal(true),
    pool: ratingPoolSchema,
    pairingMode: pairingModeSchema,
    rounds: z.int().min(1).max(20).nullable(),
    timeControl: draftText(60),
  }),
  z.object({
    rated: z.literal(false),
    pairingMode: pairingModeSchema,
    rounds: z.int().min(1).max(20).nullable(),
    timeControl: draftText(60),
  }),
])
export type GameSystemStep = z.infer<typeof gameSystemStepSchema>

export const mediaStepSchema = z.object({
  /** Event media collection (S12). Null until chosen; 0 assets renders the placeholder. */
  collectionId: mediaCollectionIdSchema.nullable(),
  mode: mediaModeSchema,
})
export type MediaStep = z.infer<typeof mediaStepSchema>

/** Per-event toggles for state-triggered messages (C15); also part of the builder resource (E03/E04). */
export const MESSAGE_TRIGGERS = [
  'confirmation',
  'reminder_24h',
  'checkin_open',
  'pairing_published',
  'post_event',
] as const
export const messageTriggerSchema = z.enum(MESSAGE_TRIGGERS)
export type MessageTrigger = z.infer<typeof messageTriggerSchema>

/** Email only at launch; WhatsApp is shown as not connected in settings (G07). */
export const MESSAGE_CHANNELS = ['email'] as const
export const messageChannelSchema = z.enum(MESSAGE_CHANNELS)
export type MessageChannel = z.infer<typeof messageChannelSchema>

export const communicationsStepSchema = z.object({
  triggers: z.record(messageTriggerSchema, z.boolean()),
  channels: z.array(messageChannelSchema).min(1).max(1),
})
export type CommunicationsStep = z.infer<typeof communicationsStepSchema>

// ---------- Resource ----------

/** Fields that cannot change once registrations or payments exist (FEAT-001 OQ-07, OQ-22). */
export const LOCKABLE_FIELDS = ['pricePaise', 'capacity', 'pairingMode', 'rated', 'pool', 'slug'] as const
export const lockableFieldSchema = z.enum(LOCKABLE_FIELDS)
export type LockableField = z.infer<typeof lockableFieldSchema>

/** `GET /admin/events/{id}` (E03) and the E02/E04 response: the whole builder resource. */
export const builderDraftSchema = z.object({
  id: uuidSchema,
  status: eventStatusSchema,
  basics: basicsStepSchema,
  experience: experienceStepSchema,
  registration: registrationStepSchema,
  payment: paymentStepSchema,
  gameSystem: gameSystemStepSchema,
  media: mediaStepSchema,
  communications: communicationsStepSchema,
  /** Fields the server refuses to change now, each with its text reason in `lockedReasons` (AC-84). */
  lockedFields: z.array(lockableFieldSchema).max(10),
  lockedReasons: z.partialRecord(lockableFieldSchema, draftText(300)),
  /** Publish readiness: not ready lists blockers per step (`blockers[].field` starts with the step key). */
  readiness: publishReadinessSchema,
  version: versionSchema,
  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
  lastChange: lastChangeSchema.nullable(),
})
export type BuilderDraftDto = z.infer<typeof builderDraftSchema>

// ---------- Writes ----------

/** `POST /admin/events` (E02): a draft with any subset of steps; the title alone is enough to start. */
export const createDraftSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  type: eventTypeSchema.optional(),
  slug: authoringSlugSchema.optional(),
})
export type CreateDraftInput = z.infer<typeof createDraftSchema>

/**
 * `PATCH /admin/events/{id}` (E04): partial update of one or more steps, with `version`. Strict at every level so a stray
 * key (id, status, slug on a locked event) never travels. Status changes use publish/unpublish/cancel/complete.
 */
const partialStep = <T extends z.ZodObject>(schema: T) => schema.partial().strict()

/** Flat partial of the game-system step; the server validates `pool` only when `rated` is true. */
export const gameSystemPatchSchema = z
  .strictObject({
    rated: z.boolean(),
    pool: ratingPoolSchema,
    pairingMode: pairingModeSchema,
    rounds: z.int().min(1).max(20).nullable(),
    timeControl: draftText(60),
  })
  .partial()

export const basicsPatchSchema = partialStep(
  basicsStepSchema.omit({ slug: true }).extend({ slug: authoringSlugSchema.nullable() }),
)
/**
 * Experience PATCH excludes:
 * - `tags` — backend gap, not in E04
 * - `mode` — backend gap, UI-only
 */
export const experiencePatchSchema = partialStep(experienceStepSchema.omit({ tags: true, mode: true }))

export const updateBuilderDraftSchema = z.strictObject({
  version: writeVersionSchema,
  basics: basicsPatchSchema.optional(),
  experience: experiencePatchSchema.optional(),
  registration: partialStep(registrationStepSchema).optional(),
  payment: partialStep(paymentStepSchema.omit({ currency: true })).optional(),
  gameSystem: gameSystemPatchSchema.optional(),
  media: partialStep(mediaStepSchema).optional(),
  communications: partialStep(communicationsStepSchema).optional(),
})
export type UpdateBuilderDraftInput = z.infer<typeof updateBuilderDraftSchema>

/** E06 row: event type with its configurable defaults. Bounded. */
export const eventTypeDefaultsSchema = z.object({
  type: eventTypeSchema,
  label: draftText(60),
  defaultPairingMode: pairingModeSchema,
  defaultRated: z.boolean(),
  /** League and workshop are selectable but their engine is Later (F-PAIR-010). */
  engineAvailable: z.boolean(),
})
export type EventTypeDefaultsDto = z.infer<typeof eventTypeDefaultsSchema>

// ---------- Lifecycle commands (E07 to E10) ----------

/** E07 response. `publishedAt` is stamped by the server; the slug is locked from this moment. */
export const publishEventResultSchema = z.object({
  id: uuidSchema,
  slug: authoringSlugSchema,
  status: eventStatusSchema,
  publishedAt: isoInstantSchema,
  version: versionSchema,
})
export type PublishEventResult = z.infer<typeof publishEventResultSchema>

/** E08 response: back to draft. The slug stays locked. */
export const unpublishEventResultSchema = z.object({
  id: uuidSchema,
  status: eventStatusSchema,
  version: versionSchema,
})
export type UnpublishEventResult = z.infer<typeof unpublishEventResultSchema>

export const openRegistrationResultSchema = z.object({
  id: uuidSchema,
  status: eventStatusSchema,
  version: versionSchema,
})
export type OpenRegistrationResult = z.infer<typeof openRegistrationResultSchema>

export const closeRegistrationResultSchema = z.object({
  id: uuidSchema,
  status: eventStatusSchema,
  closesAt: isoInstantSchema,
  version: versionSchema,
})
export type CloseRegistrationResult = z.infer<typeof closeRegistrationResultSchema>

/** E09 request. Refund and notification choices are explicit (admin confirmation, STATE-MACHINES "Event"). */
export const cancelEventSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
  notifyParticipants: z.boolean(),
  refund: z.boolean(),
})
export type CancelEventInput = z.infer<typeof cancelEventSchema>

/** E09 response. Refunds run asynchronously: `refundsQueued` counts payments queued, not refunded. */
export const cancelEventResultSchema = z.object({
  id: uuidSchema,
  status: z.literal('cancelled'),
  cancelledAt: isoInstantSchema,
  refundsQueued: z.int().min(0),
  version: versionSchema,
})
export type CancelEventResult = z.infer<typeof cancelEventResultSchema>

/** E10 request. */
export const completeEventSchema = z.strictObject({ publishArchive: z.boolean().optional() })
export type CompleteEventInput = z.infer<typeof completeEventSchema>

/** E10 response. */
export const completeEventResultSchema = z.object({
  id: uuidSchema,
  status: z.literal('completed'),
  completedAt: isoInstantSchema,
  version: versionSchema,
})
export type CompleteEventResult = z.infer<typeof completeEventResultSchema>
