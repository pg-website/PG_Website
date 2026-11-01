import { z } from 'zod'
import { capabilityFlagSchema, draftText, lastChangeSchema, writeVersionSchema } from '@/lib/api/types/admin/common'
import { isoInstantSchema, uuidSchema, versionSchema } from '@/lib/api/types/primitives'

// Control room gallery and recap (contract C16, screen 52; F-EVT-016). The recap text and the gallery collection belong to
// the completed event's archive. Publishing the archive emits `event/updated` (revalidation) on the server.

/** `GET /admin/events/{id}/recap` (C16). */
export const eventRecapSchema = z.object({
  eventId: uuidSchema,
  /** Plain text. Public archives render it inert (4000 max, same as the public archive). */
  recap: draftText(4000),
  /** Ordered archive gallery images (private to the event). */
  assetIds: z.array(uuidSchema).max(50),
  archivePublished: z.boolean(),
  archivePublishedAt: isoInstantSchema.nullable(),
  /** The archive can publish only for a completed event; a disabled flag carries the reason (AC-84). */
  canPublishArchive: capabilityFlagSchema,
  version: versionSchema,
  lastChange: lastChangeSchema.nullable(),
})
export type EventRecapDto = z.infer<typeof eventRecapSchema>

/** `PATCH /admin/events/{id}/recap`. Partial, with `version`. */
export const updateRecapSchema = z.strictObject({
  version: writeVersionSchema,
  recap: draftText(4000).optional(),
  assetIds: z.array(uuidSchema).max(50).optional(),
  publishArchive: z.boolean().optional(),
})
export type UpdateRecapInput = z.infer<typeof updateRecapSchema>
