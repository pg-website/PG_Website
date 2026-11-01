import { z } from 'zod'
import { mediaAssetSummarySchema } from '@/lib/api/types/admin/media'
import { mediaCollectionSchema as publicMediaSchema } from '@/lib/api/types/media'
import { isoInstantSchema, linkHrefSchema, plainText, safeHrefSchema, uuidSchema, versionSchema } from '@/lib/api/types/primitives'

// Published site sections (contract P01; CONTENT-MODEL-MAP.md). Typed fields only, no HTML, no free-form layout.
// A section is `{ key, version, updatedAt, content }`, a discriminated union on `key`, so a consumer that asks for
// `home` gets the home shape and nothing else. Draft state never appears here (published only, FR-04).

export const SITE_SECTIONS = ['home', 'community', 'nav', 'footer', 'meta'] as const
export const siteSectionSchema = z.enum(SITE_SECTIONS)
export type SiteSection = z.infer<typeof siteSectionSchema>

export const cta = z.object({ label: plainText(60), href: linkHrefSchema })
export type CtaDto = z.infer<typeof cta>

/**
 * Image slot. The public read is `{ mode, autoplay, intervalMs, items }`; the admin read adds `assetIds` and `assets`
 * (PLAN-010). The draft save sends `{ assetIds, autoplay, intervalMs }` (the adapter converts, see real-admin.ts).
 */
const mediaCollectionSchema = publicMediaSchema.extend({
  assetIds: z.array(uuidSchema).max(50).optional(),
  assets: z.array(mediaAssetSummarySchema).max(50).optional(),
})

const eyebrow = plainText(60)
const headline = plainText(160)
const body = plainText(1200)

const titleBody = z.object({ title: plainText(80), body: plainText(400) })

const sectionBlock = z.object({ eyebrow, headline, body, media: mediaCollectionSchema })

const homeSchema = z.object({
  hero: z.object({
    eyebrow,
    headlineLine1: plainText(80),
    headlineAccent: plainText(80),
    lead: plainText(200),
    body,
    proofPoints: z.array(plainText(60)).max(6),
    primaryCta: cta,
    secondaryCta: cta,
    media: mediaCollectionSchema,
  }),
  upcoming: z.object({ eyebrow, title: plainText(100), intro: plainText(300), cta }),
  firstVisit: z.object({
    eyebrow,
    headline,
    body,
    cta,
    promises: z.array(titleBody).length(4),
    media: mediaCollectionSchema,
  }),
  stands: z.object({
    eyebrow,
    headline,
    body,
    principles: z.array(titleBody).length(3),
    media: mediaCollectionSchema,
  }),
  moreThanAGame: sectionBlock.extend({ cta }),
  finalCta: sectionBlock.extend({ cta }),
})
export type HomeContentDto = z.infer<typeof homeSchema>

const communitySchema = z.object({
  hero: z.object({ eyebrow, headline, lead: plainText(400), media: mediaCollectionSchema }),
  principles: z.array(titleBody).min(1).max(6),
  hospitality: z.object({ eyebrow, headline, body, cta }),
})

const navItem = z.object({ label: plainText(40), href: linkHrefSchema })
const navSchema = z.object({
  primary: z.array(navItem).min(1).max(8),
  authCta: cta,
})

const socialLink = z.object({ label: plainText(40), href: safeHrefSchema })
const footerSchema = z.object({
  tagline: plainText(120),
  links: z.array(navItem).max(12),
  social: z.array(socialLink).max(8),
  legalNote: plainText(200).nullable(),
})

/** Site-wide metadata defaults for SEO (ARCH-001 8.1). */
const metaSchema = z.object({
  siteName: plainText(60),
  titleTemplate: plainText(80),
  description: plainText(300),
  defaultCity: plainText(80),
})

const sectionEnvelope = { version: versionSchema, updatedAt: isoInstantSchema }

export const siteSectionDtoSchema = z.discriminatedUnion('key', [
  z.object({ key: z.literal('home'), ...sectionEnvelope, content: homeSchema }),
  z.object({ key: z.literal('community'), ...sectionEnvelope, content: communitySchema }),
  z.object({ key: z.literal('nav'), ...sectionEnvelope, content: navSchema }),
  z.object({ key: z.literal('footer'), ...sectionEnvelope, content: footerSchema }),
  z.object({ key: z.literal('meta'), ...sectionEnvelope, content: metaSchema }),
])
export type SiteSectionDto = z.infer<typeof siteSectionDtoSchema>
export type SiteSectionOf<K extends SiteSection> = Extract<SiteSectionDto, { key: K }>

/** Non-secret contact configuration (contract P12, inferred; may instead ride inside `footer` / `meta`). */
export const publicSettingsSchema = z.object({
  supportEmail: z.email().max(254),
  /** WhatsApp or phone link for "Message event desk" and the contact page. Null when not configured. */
  deskContactHref: safeHrefSchema.nullable(),
  social: z.array(socialLink).max(8),
  defaultCity: plainText(80),
})
export type PublicSettingsDto = z.infer<typeof publicSettingsSchema>
