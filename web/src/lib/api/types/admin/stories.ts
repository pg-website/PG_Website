import { z } from 'zod'
import { adminMediaListSchema, mediaListInputSchema } from '@/lib/api/types/admin/media'
import { draftText, lastChangeSchema, publicationStatusSchema, writeVersionSchema } from '@/lib/api/types/admin/common'
import { slugFieldSchema } from '@/lib/api/types/admin/slug'
import { contentBlocksSchema } from '@/lib/api/types/content-blocks'
import {
  authoringSlugSchema,
  isoDateSchema,
  isoInstantSchema,
  uuidSchema,
  versionSchema,
} from '@/lib/api/types/primitives'
import { storyKindSchema } from '@/lib/api/types/story'

// Admin stories (contract S13, S14, screen 35; FEAT-001 OQ-01 closed block body). The slug follows the same rules as
// events (see slug.ts): editable while the story has never been published, locked for good after first publish.
// A draft body may be empty; publishing needs title, dek, slug and at least one block (server: NOT_PUBLISHABLE).

export const adminStoriesQuerySchema = z.strictObject({
  status: publicationStatusSchema.optional(),
  kind: storyKindSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  page: z.int().min(1).optional(),
  pageSize: z.int().min(1).max(100).optional(),
})
export type AdminStoriesQuery = z.infer<typeof adminStoriesQuerySchema>

/** List row (`GET /admin/stories`). */
export const adminStoryRowSchema = z.object({
  id: uuidSchema,
  kind: storyKindSchema,
  title: draftText(160),
  /** Null until the author picks one (draft). */
  slug: authoringSlugSchema.nullable(),
  status: publicationStatusSchema,
  featured: z.boolean(),
  publishedOn: isoDateSchema.nullable(),
  updatedAt: isoInstantSchema,
  version: versionSchema,
})
export type AdminStoryRowDto = z.infer<typeof adminStoryRowSchema>

/** `GET /admin/stories/{id}` (S13). Body is the closed block model: no HTML, no free-form layout. */
export const adminStorySchema = z.object({
  id: uuidSchema,
  kind: storyKindSchema,
  slug: slugFieldSchema,
  eyebrow: draftText(60),
  title: draftText(160),
  dek: draftText(300),
  body: contentBlocksSchema,
  publishedOn: isoDateSchema.nullable(),
  readingMinutes: z.int().min(1).max(120).nullable(),
  featured: z.boolean(),
  /** Story images (ordered asset list). */
  media: adminMediaListSchema,
  status: publicationStatusSchema,
  version: versionSchema,
  updatedAt: isoInstantSchema,
  lastChange: lastChangeSchema.nullable(),
})
export type AdminStoryDto = z.infer<typeof adminStorySchema>

/** `POST /admin/stories`: a draft needs only a kind and a title. */
export const createStorySchema = z.strictObject({
  kind: storyKindSchema,
  title: z.string().trim().min(1).max(160),
  slug: authoringSlugSchema.optional(),
})
export type CreateStoryInput = z.infer<typeof createStorySchema>

/** `PATCH /admin/stories/{id}`: partial, with `version`. A `slug` on a published story fails with SLUG_LOCKED. */
export const updateStorySchema = z.strictObject({
  version: writeVersionSchema,
  kind: storyKindSchema.optional(),
  slug: authoringSlugSchema.optional(),
  eyebrow: draftText(60).optional(),
  title: draftText(160).optional(),
  dek: draftText(300).optional(),
  body: contentBlocksSchema.optional(),
  publishedOn: isoDateSchema.nullable().optional(),
  readingMinutes: z.int().min(1).max(120).nullable().optional(),
  featured: z.boolean().optional(),
  media: mediaListInputSchema.optional(),
})
export type UpdateStoryInput = z.infer<typeof updateStorySchema>

/** Publish result for S14: the slug is locked from this moment. */
export const storyPublishResultSchema = z.object({
  id: uuidSchema,
  slug: authoringSlugSchema,
  status: publicationStatusSchema,
  publishedAt: isoInstantSchema.nullable(),
  version: versionSchema,
})
export type StoryPublishResult = z.infer<typeof storyPublishResultSchema>
