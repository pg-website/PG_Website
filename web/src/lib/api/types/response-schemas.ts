import { z } from 'zod'
import { publicationResultSchema } from '@/lib/api/types/admin/common'
import { auditEntrySchema } from '@/lib/api/types/admin/control-audit'
import { checkInAllResultSchema, checkInDeskSchema, manualCheckInResultSchema } from '@/lib/api/types/admin/control-checkin'
import {
  communicationsSettingsSchema,
  messageAcceptedSchema,
  messageDetailSchema,
  messageLogSchema,
} from '@/lib/api/types/admin/control-messages'
import { eventOverviewSchema } from '@/lib/api/types/admin/control-overview'
import { eventRecapSchema } from '@/lib/api/types/admin/control-recap'
import { adminRegistrationSchema } from '@/lib/api/types/admin/control-registrations'
import {
  adminRoundSchema,
  adminRoundsSchema,
  finaliseResultSchema,
  recordResultResultSchema,
} from '@/lib/api/types/admin/control-rounds'
import {
  adminLegalPageSchema,
  cmsSectionRowSchema,
  cmsSectionSchema,
  cmsVersionEntrySchema,
  publishCmsResultSchema,
  publishLegalResultSchema,
  saveCmsDraftResultSchema,
} from '@/lib/api/types/admin/cms'
import { dashboardSummarySchema } from '@/lib/api/types/admin/dashboard'
import {
  builderDraftSchema,
  cancelEventResultSchema,
  completeEventResultSchema,
  eventTypeDefaultsSchema,
  publishEventResultSchema,
  unpublishEventResultSchema,
  openRegistrationResultSchema,
  closeRegistrationResultSchema,
} from '@/lib/api/types/admin/event-builder'
import { adminEventRowSchema } from '@/lib/api/types/admin/event-list'
import { mediaAssetSchema, uploadTicketSchema } from '@/lib/api/types/admin/media'
import {
  adminLedgerRowSchema,
  adminPaymentRowSchema,
  reconcileResultSchema,
  refundResultSchema,
} from '@/lib/api/types/admin/payments'
import { adminPlayerRowSchema, adminPlayerSchema, changeRoleResultSchema } from '@/lib/api/types/admin/players'
import { previewLinkSchema } from '@/lib/api/types/admin/preview'
import { settingsSchema } from '@/lib/api/types/admin/settings'
import { slugCheckResultSchema } from '@/lib/api/types/admin/slug'
import { adminStoryRowSchema, adminStorySchema, storyPublishResultSchema } from '@/lib/api/types/admin/stories'
import { adminTestimonialSchema } from '@/lib/api/types/admin/testimonials'
import {
  authResultSchema,
  meSchema,
  oauthStartSchema,
  sessionTokensSchema,
  stepUpResultSchema,
} from '@/lib/api/types/auth'
import { contactInputSchema } from '@/lib/api/types/contact'
import { checkInResultSchema, eventRoomSnapshotSchema, resultUpdateSchema } from '@/lib/api/types/event-room'
import { eventDetailSchema, eventSummarySchema } from '@/lib/api/types/event'
import { availabilitySchema } from '@/lib/api/types/event-state'
import { legalPageDtoSchema, sitemapEntrySchema } from '@/lib/api/types/legal-sitemap'
import { gameSchema, myRegistrationSchema, nextUpSchema, personSchema } from '@/lib/api/types/my-events'
import { pageSchema } from '@/lib/api/types/pagination'
import { paymentOrderSchema } from '@/lib/api/types/payment'
import { profileSchema } from '@/lib/api/types/profile'
import { ledgerEntrySchema, ratingProfileSchema, ratingTrendSchema } from '@/lib/api/types/rating'
import {
  cancelResultSchema,
  joinWaitlistResultSchema,
  registrationResultSchema,
  registrationSchema,
  registrationStateSchema,
  reserveResultSchema,
} from '@/lib/api/types/registration'
import { publicProfileSchema } from '@/lib/api/types/player-profile'
import { publicSettingsSchema, siteSectionDtoSchema } from '@/lib/api/types/site-content'
import { storyCardSchema, storyDetailSchema } from '@/lib/api/types/story'
import { testimonialsSchema } from '@/lib/api/types/testimonial'

// The response schema of every PgApi method. Adapters pass the matching schema to `request(...)` (ARCH-001 11.2: a
// payload that fails it becomes ApiError(BAD_RESPONSE)). The type-level test in pg-api.test-d.ts asserts that each
// method's resolved type equals `z.infer` of the schema listed here, so interface and schema cannot drift apart.
// `void` methods (202/204) and `T | null` slug reads are listed with their payload schema; null handling is the adapter's.

/** Public: payload schemas. `getSiteContent` is resolved per section key from `siteSectionDtoSchema`. */
export const publicResponses = {
  getSiteContent: siteSectionDtoSchema,
  getUpcomingEvents: pageSchema(eventSummarySchema),
  getEventBySlug: eventDetailSchema,
  getEventAvailability: availabilitySchema,
  getPastEvents: pageSchema(eventSummarySchema),
  getStories: pageSchema(storyCardSchema),
  getStoryBySlug: storyDetailSchema,
  getTestimonials: testimonialsSchema,
  getLegalPage: legalPageDtoSchema,
  getSitemapEntries: pageSchema(sitemapEntrySchema),
  getPublicSettings: publicSettingsSchema,
  getPlayerProfile: publicProfileSchema,
} as const

export const authResponses = {
  login: authResultSchema,
  register: authResultSchema,
  refresh: sessionTokensSchema,
  getMe: meSchema,
  stepUp: stepUpResultSchema,
  startGoogleSignIn: oauthStartSchema,
  exchangeOAuthCode: sessionTokensSchema,
} as const

export const meResponses = {
  getNextUp: nextUpSchema,
  getRecentGames: pageSchema(gameSchema),
  getPeople: z.array(personSchema).max(50),
  getMyEvents: pageSchema(myRegistrationSchema),
} as const

export const registrationResponses = {
  getRegistrationState: registrationStateSchema,
  reserve: reserveResultSchema,
  joinWaitlist: joinWaitlistResultSchema,
  createPaymentOrder: paymentOrderSchema,
  verifyPayment: registrationResultSchema,
  getRegistration: registrationSchema,
  cancelRegistration: cancelResultSchema,
  acceptWaitlistOffer: registrationResultSchema,
} as const

export const eventRoomResponses = {
  getSnapshot: eventRoomSnapshotSchema,
  checkIn: checkInResultSchema,
  submitResult: resultUpdateSchema,
  confirmResult: resultUpdateSchema,
  disputeResult: resultUpdateSchema,
} as const

export const ratingResponses = {
  getRatings: ratingProfileSchema,
  getLedger: pageSchema(ledgerEntrySchema),
  getTrend: ratingTrendSchema,
} as const

export const profileResponses = {
  getProfile: profileSchema,
  updateProfile: profileSchema,
  updatePublicIdentity: profileSchema,
  savePreferences: meSchema,
} as const

// ---------- Admin (TASK-017). Keys equal the PgAdminApi method names within each group. ----------
// `void` and `Blob` methods (`media.deleteAsset`, `control.exportAudit`) have no payload schema and are not listed.

export const adminDashboardResponses = { getDashboard: dashboardSummarySchema } as const

export const adminEventsResponses = {
  listEvents: pageSchema(adminEventRowSchema),
  createDraft: builderDraftSchema,
  getEvent: builderDraftSchema,
  updateEvent: builderDraftSchema,
  checkSlug: slugCheckResultSchema,
  getEventTypes: z.array(eventTypeDefaultsSchema).max(10),
  publishEvent: publishEventResultSchema,
  unpublishEvent: unpublishEventResultSchema,
  openRegistrations: openRegistrationResultSchema,
  closeRegistrations: closeRegistrationResultSchema,
  cancelEvent: cancelEventResultSchema,
  completeEvent: completeEventResultSchema,
  deleteEvent: z.object({}),
  /** PLAN-012 */
  enrollPlayer: adminRegistrationSchema,
} as const

export const adminControlResponses = {
  getOverview: eventOverviewSchema,
  listRegistrations: pageSchema(adminRegistrationSchema),
  actOnRegistration: adminRegistrationSchema,
  /** FEAT-002 */
  cashRegisterPlayer: adminRegistrationSchema,
  getCheckInDesk: checkInDeskSchema,
  setCheckIn: manualCheckInResultSchema,
  checkInAll: checkInAllResultSchema,
  listRounds: adminRoundsSchema,
  generateRound: adminRoundSchema,
  editPairings: adminRoundSchema,
  publishRound: adminRoundSchema,
  startRound: adminRoundSchema,
  recordResult: recordResultResultSchema,
  finaliseRound: finaliseResultSchema,
  listEventPayments: pageSchema(adminPaymentRowSchema),
  listMessages: messageLogSchema,
  getMessage: messageDetailSchema,
  sendMessage: messageAcceptedSchema,
  getCommunications: communicationsSettingsSchema,
  updateCommunications: communicationsSettingsSchema,
  getRecap: eventRecapSchema,
  updateRecap: eventRecapSchema,
  listAudit: pageSchema(auditEntrySchema),
} as const

export const adminCmsResponses = {
  listSections: z.array(cmsSectionRowSchema).max(20),
  getSection: cmsSectionSchema,
  saveSectionDraft: saveCmsDraftResultSchema,
  publishSection: publishCmsResultSchema,
  listSectionVersions: pageSchema(cmsVersionEntrySchema),
  getLegalPage: adminLegalPageSchema,
  saveLegalDraft: adminLegalPageSchema,
  publishLegalPage: publishLegalResultSchema,
} as const

export const adminMediaResponses = {
  requestUpload: uploadTicketSchema,
  completeUpload: mediaAssetSchema,
  listAssets: pageSchema(mediaAssetSchema),
  updateAsset: mediaAssetSchema,
} as const

export const adminStoriesResponses = {
  listStories: pageSchema(adminStoryRowSchema),
  createStory: adminStorySchema,
  getStory: adminStorySchema,
  updateStory: adminStorySchema,
  publishStory: storyPublishResultSchema,
  unpublishStory: storyPublishResultSchema,
} as const

export const adminTestimonialsResponses = {
  listTestimonials: pageSchema(adminTestimonialSchema),
  createTestimonial: adminTestimonialSchema,
  getTestimonial: adminTestimonialSchema,
  updateTestimonial: adminTestimonialSchema,
  publishTestimonial: publicationResultSchema,
  unpublishTestimonial: publicationResultSchema,
} as const

export const adminPreviewResponses = { createPreviewLink: previewLinkSchema } as const

export const adminPlayersResponses = {
  listPlayers: pageSchema(adminPlayerRowSchema),
  getPlayer: adminPlayerSchema,
  changeRole: changeRoleResultSchema,
  /** PLAN-012 */
  createPlayer: adminPlayerSchema,
} as const

export const adminPaymentsResponses = {
  listLedger: pageSchema(adminLedgerRowSchema),
  refund: refundResultSchema,
  reconcile: reconcileResultSchema,
} as const

export const adminSettingsResponses = {
  getSettings: settingsSchema,
  updateSettings: settingsSchema,
} as const

/** `submitContact` sends this body and expects a bodyless 202. Exported for the browser client and the export script. */
export const submitContactRequest = contactInputSchema
