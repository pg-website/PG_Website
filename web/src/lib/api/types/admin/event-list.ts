import { z } from 'zod'
import { capabilityFlagSchema } from '@/lib/api/types/admin/common'
import { eventStatusSchema, eventTypeSchema, pairingModeSchema } from '@/lib/api/types/event-state'
import {
  countSchema,
  currencySchema,
  isoInstantSchema,
  paiseSchema,
  slugSchema,
  uuidSchema,
  versionSchema,
} from '@/lib/api/types/primitives'

// Admin events list (contract E01, screen 37). Capability flags carry a text reason when disabled (AC-84).

export const adminEventsQuerySchema = z.strictObject({
  status: eventStatusSchema.optional(),
  type: eventTypeSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  page: z.int().min(1).optional(),
  pageSize: z.int().min(1).max(100).optional(),
})
export type AdminEventsQuery = z.infer<typeof adminEventsQuerySchema>

/** What the row's menu may offer. Computed by the server from state, registrations and payments. */
export const adminEventCapabilitiesSchema = z.object({
  canPublish: capabilityFlagSchema,
  canUnpublish: capabilityFlagSchema,
  canCancel: capabilityFlagSchema,
  canEdit: capabilityFlagSchema,
  canDelete: capabilityFlagSchema.optional(),
})
export type AdminEventCapabilities = z.infer<typeof adminEventCapabilitiesSchema>

export const adminEventRowSchema = z.object({
  id: uuidSchema,
  /** Empty for a draft whose title was never filled in (the builder creates drafts with no title). */
  title: z.string().max(120),
  /** Null for a draft that has never been published and has no slug yet. */
  slug: slugSchema.nullable(),
  type: eventTypeSchema,
  status: eventStatusSchema,
  startsAt: isoInstantSchema.nullable(),
  capacity: z.int().min(0).max(100000).nullable(),
  /** Confirmed registrations (holds are not counted). */
  filled: countSchema,
  pricePaise: paiseSchema,
  currency: currencySchema,
  pairingMode: pairingModeSchema,
  capabilities: adminEventCapabilitiesSchema,
  version: versionSchema,
  /** Neighbourhood or district (from Basics step, E01). Empty string, null, or absent when not set. */
  area: z.string().max(80).nullish(),
  /** City (from Basics step, E01). Empty string, null, or absent when not set. */
  city: z.string().max(80).nullish(),
})
export type AdminEventRowDto = z.infer<typeof adminEventRowSchema>
