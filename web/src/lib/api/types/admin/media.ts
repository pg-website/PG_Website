import { z } from 'zod'
import { adminActorSchema, draftText, writeVersionSchema } from '@/lib/api/types/admin/common'
import { mediaModeSchema } from '@/lib/api/types/media'
import {
  countSchema,
  focalSchema,
  backendUrlSchema,
  isBackendUrl,
  isoInstantSchema,
  mediaSrcSchema,
  plainText,
  uuidSchema,
  versionSchema,
} from '@/lib/api/types/primitives'

// Admin media library (contract S07 to S12; CMS-SPEC "Media"; UI-STATES "media missing alt text").
// Uploads go DIRECT to Supabase Storage by a signed URL: the API validates type and size first and never receives bytes.
// Alt text: a published asset needs alt text or an explicit `decorative` flag (ARCH-001 13.3). The contract (OQ-12) says
// a missing alt "warns" on save; this file makes the PUBLISHED state strict and the draft state tolerant.

export const MEDIA_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const
export const mediaContentTypeSchema = z.enum(MEDIA_CONTENT_TYPES)
/** Upload size ceiling (inferred): 10 MB. The server owns the real limit. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** `POST /admin/media/uploads` (S07). */
export const uploadRequestSchema = z.strictObject({
  filename: z.string().trim().min(1).max(200),
  contentType: mediaContentTypeSchema,
  sizeBytes: z.int().min(1).max(MAX_UPLOAD_BYTES),
})
export type UploadRequest = z.infer<typeof uploadRequestSchema>

/** S07 response. `uploadUrl` must be on the Storage host: the adapter checks it (ARCH-001 11.6).
 * In dev (STORAGE_MODE=fake) the server returns a relative path (/api/dev-storage/…) — accepted in non-production. */
const uploadUrlSchema =
  process.env.NODE_ENV !== 'production'
    ? z.string().refine((v) => v.startsWith('/') || isBackendUrl(v), 'URL must be absolute or a dev-relative path')
    : backendUrlSchema

export const uploadTicketSchema = z.object({
  assetId: uuidSchema,
  uploadUrl: uploadUrlSchema,
  headers: z.record(z.string().min(1).max(100), z.string().max(1000)),
  expiresAt: isoInstantSchema,
})
export type UploadTicket = z.infer<typeof uploadTicketSchema>

// ---------- Asset ----------

export const MEDIA_ASSET_STATUSES = ['draft', 'published', 'archived'] as const
export const mediaAssetStatusSchema = z.enum(MEDIA_ASSET_STATUSES)
export type MediaAssetStatus = z.infer<typeof mediaAssetStatusSchema>

export const MEDIA_USER_KINDS = ['event', 'story', 'testimonial', 'site_section'] as const
export const mediaUserKindSchema = z.enum(MEDIA_USER_KINDS)

/** One place an asset is referenced. Deleting an asset with any reference returns ASSET_IN_USE (F-ACMS-007). */
/** `id` is a UUID for events, stories and testimonials, the section key for `site_section`. */
export const mediaUsageSchema = z.object({
  kind: mediaUserKindSchema,
  id: z.string().min(1).max(100),
  label: plainText(120),
})
export type MediaUsage = z.infer<typeof mediaUsageSchema>

/** Alt text or the explicit decorative flag. Both unset is a draft state ("missing alt" attention item). */
const altText = z.string().trim().min(1).max(300)

const assetBase = {
  id: uuidSchema,
  src: mediaSrcSchema,
  width: z.int().min(1).max(20000),
  height: z.int().min(1).max(20000),
  contentType: mediaContentTypeSchema,
  sizeBytes: z.int().min(1),
  focal: focalSchema,
  credit: draftText(200).nullable(),
  /** How many places reference this asset; `usedBy` is capped for payload size, this count is not. */
  usageCount: countSchema,
  usedBy: z.array(mediaUsageSchema).max(20),
  uploadedAt: isoInstantSchema,
  uploadedBy: adminActorSchema,
  version: versionSchema,
}

/**
 * Alt text is a union so that a PUBLISHED asset without alt (and not decorative) is unrepresentable. Draft and archived
 * assets may lack alt (`alt: null`); the dashboard lists them as "media without alt".
 */
const altState = z.discriminatedUnion('decorative', [
  z.object({ decorative: z.literal(false), alt: altText.nullable() }),
  z.object({ decorative: z.literal(true), alt: z.literal('') }),
])

// "Published" is derived from usage, so an in-use asset can still lack alt (seeded rows). The read schema tolerates it and
// the UI flags it as "missing alt"; publishing is blocked server-side (NOT_PUBLISHABLE).
export const mediaAssetSchema = z.object({ ...assetBase, status: mediaAssetStatusSchema }).and(altState)
export type MediaAssetDto = z.infer<typeof mediaAssetSchema>

/** Shorter row used inside an asset list. */
export const mediaAssetSummarySchema = z.object({
  id: uuidSchema,
  src: mediaSrcSchema,
  width: z.int().min(1).max(20000),
  height: z.int().min(1).max(20000),
  alt: z.string().max(300).nullable(),
  decorative: z.boolean(),
  focal: focalSchema,
})
export type MediaAssetSummary = z.infer<typeof mediaAssetSummarySchema>

// ---------- Queries and writes ----------

export const mediaAssetsQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(100).optional(),
  status: mediaAssetStatusSchema.optional(),
  /** Attention filter: assets that cannot be published yet. */
  missingAlt: z.boolean().optional(),
  page: z.int().min(1).optional(),
  pageSize: z.int().min(1).max(100).optional(),
})
export type MediaAssetsQuery = z.infer<typeof mediaAssetsQuerySchema>

/**
 * `PATCH /admin/media/assets/{assetId}` (S10). Strict and partial. `focal` is 0..1 on both axes (out of range rejected,
 * never clamped, F-14). Choosing `decorative: true` clears alt; the server rejects both together.
 * `status: 'published'` is blocked by NOT_PUBLISHABLE (fields.alt) without alt or decorative. Archive instead of delete.
 */
export const updateMediaAssetSchema = z
  .strictObject({
    alt: altText,
    decorative: z.boolean(),
    focal: focalSchema,
    credit: draftText(200).nullable(),
    status: mediaAssetStatusSchema,
    version: writeVersionSchema,
  })
  .partial()
  .required({ version: true })
  .refine((value) => !(value.decorative === true && value.alt !== undefined), {
    message: 'A decorative image has no alt text',
    path: ['alt'],
  })
export type UpdateMediaAsset = z.infer<typeof updateMediaAssetSchema>

// ---------- Asset lists (events, stories, site sections; PLAN-010) ----------

/** Autoplay interval bounds match the public carousel (media.ts). */
export const MEDIA_INTERVAL_MIN = 2000
export const MEDIA_INTERVAL_MAX = 60000
export const MEDIA_INTERVAL_DEFAULT = 5000
const intervalMs = z.int().min(MEDIA_INTERVAL_MIN).max(MEDIA_INTERVAL_MAX)

/** Backend cap per asset list. */
export const MAX_ASSET_LIST_ITEMS = 50

/** Admin read of an owner's ordered images. `mode` is derived by the server (1 = static, 2+ = carousel). */
export const adminMediaListSchema = z.object({
  assetIds: z.array(uuidSchema).max(MAX_ASSET_LIST_ITEMS),
  assets: z.array(mediaAssetSummarySchema).max(MAX_ASSET_LIST_ITEMS),
  mode: mediaModeSchema,
  autoplay: z.boolean(),
  intervalMs,
})
export type AdminMediaList = z.infer<typeof adminMediaListSchema>

/** Write shape: `{ assetIds, autoplay?, intervalMs? }`. No duplicates. */
export const mediaListInputSchema = z.strictObject({
  assetIds: z.array(uuidSchema).max(MAX_ASSET_LIST_ITEMS).refine((v) => new Set(v).size === v.length, 'No duplicates'),
  autoplay: z.boolean().optional(),
  intervalMs: intervalMs.optional(),
})
export type MediaListInput = z.infer<typeof mediaListInputSchema>
