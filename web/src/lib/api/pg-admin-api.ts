import type { StepUpToken } from '@/lib/api/types/admin/common'
import type { AuditEntryDto, AuditQuery } from '@/lib/api/types/admin/control-audit'
import type {
  CheckInAllResult,
  CheckInDeskDto,
  AdminCheckInQuery,
  ManualCheckInInput,
  ManualCheckInResult,
} from '@/lib/api/types/admin/control-checkin'
import type {
  CommunicationsSettingsDto,
  MessageAccepted,
  MessageDetailDto,
  MessageLogDto,
  SendMessageInput,
  UpdateCommunicationsInput,
} from '@/lib/api/types/admin/control-messages'
import type { EventOverviewDto } from '@/lib/api/types/admin/control-overview'
import type { EventRecapDto, UpdateRecapInput } from '@/lib/api/types/admin/control-recap'
import type {
  AdminRegistrationDto,
  AdminRegistrationsQuery,
  RegistrationActionInput,
} from '@/lib/api/types/admin/control-registrations'
import type {
  AdminRoundDto,
  AdminRoundsDto,
  EditPairingsInput,
  FinaliseResult,
  GenerateRoundInput,
  RecordResultResult,
  ResultCommandInput,
} from '@/lib/api/types/admin/control-rounds'
import type { DashboardSummaryDto } from '@/lib/api/types/admin/dashboard'
import type {
  AdminLegalPageDto,
  CmsSectionDto,
  CmsSectionRow,
  CmsVersionEntry,
  PublishCmsResult,
  PublishLegalResult,
  SaveCmsDraftInput,
  SaveCmsDraftResult,
  SaveLegalDraftInput,
} from '@/lib/api/types/admin/cms'
import type {
  BuilderDraftDto,
  CancelEventInput,
  CancelEventResult,
  CompleteEventInput,
  CompleteEventResult,
  CreateDraftInput,
  EventTypeDefaultsDto,
  PublishEventResult,
  UnpublishEventResult,
  OpenRegistrationResult,
  CloseRegistrationResult,
  UpdateBuilderDraftInput,
} from '@/lib/api/types/admin/event-builder'
import type { AdminEventRowDto, AdminEventsQuery } from '@/lib/api/types/admin/event-list'
import type {
  CreateMediaCollection,
  MediaAssetDto,
  MediaAssetsQuery,
  MediaCollectionsQuery,
  MediaCollectionAdminDto,
  UpdateMediaAsset,
  UpdateMediaCollection,
  UploadRequest,
  UploadTicket,
} from '@/lib/api/types/admin/media'
import type {
  AdminLedgerRowDto,
  AdminPaymentRowDto,
  EventPaymentsQuery,
  LedgerQuery,
  ReconcileRequest,
  ReconcileResult,
  RefundRequest,
  RefundResult,
} from '@/lib/api/types/admin/payments'
import type {
  AdminPlayerDto,
  AdminPlayerRowDto,
  AdminPlayersQuery,
  ChangeRoleInput,
  ChangeRoleResult,
} from '@/lib/api/types/admin/players'
import type { CreatePreviewLinkInput, PreviewLinkDto } from '@/lib/api/types/admin/preview'
import type { SettingsDto, SettingsPatch } from '@/lib/api/types/admin/settings'
import type { SlugCheckQuery, SlugCheckResult } from '@/lib/api/types/admin/slug'
import type {
  AdminStoriesQuery,
  AdminStoryDto,
  AdminStoryRowDto,
  CreateStoryInput,
  StoryPublishResult,
  UpdateStoryInput,
} from '@/lib/api/types/admin/stories'
import type {
  AdminTestimonialDto,
  AdminTestimonialsQuery,
  CreateTestimonialInput,
  UpdateTestimonialInput,
} from '@/lib/api/types/admin/testimonials'
import type { PublicationResult } from '@/lib/api/types/admin/common'
import type { Page } from '@/lib/api/types/pagination'
import type { IdempotencyKey } from '@/lib/api/types/primitives'
import type { LegalPage } from '@/lib/api/types/legal-sitemap'
import type { SiteSection } from '@/lib/api/types/site-content'

// PgAdminApi: the admin surface of the contract (backend contract 3.5 to 3.8; ARCH-001 11.1 and 23.2). TASK-017.
// Rules for every implementer (real adapter, mock adapter):
//   - BROWSER ONLY: every call needs the in-memory access token of an admin and must never run during server rendering.
//     A non-admin gets ADMIN_REQUIRED; the UI also hides the area, but the server is the authority.
//   - Responses are validated with the schemas in `types/response-schemas.ts` (adminResponses.*). A mismatch is BAD_RESPONSE.
//   - Every write that edits a versioned resource carries the `version` last read. A stale one fails with VERSION_CONFLICT;
//     the caller re-reads the resource and shows `lastChange` (the error body has no slot for the other editor's change).
//   - Idempotency-Key is REQUIRED (positional `key`) on publish, finalise, cancel, refund, role change and message send
//     (contract 2.5). It is created when the admin's intent starts and reused for retries of the same intent.
//   - STEP-UP: refund, role change and audit export need a fresh step-up token (contract 2.4). The caller obtains it from
//     `player.auth.stepUp`, passes it in `opts.stepUp`, and discards it. The adapter sends it as `X-Step-Up-Token` for that
//     one request (the access token stays the bearer). A call without it fails with STEP_UP_REQUIRED (401); nothing here stores a password or a token.
//   - Disabled controls come from `capabilities` flags with a text reason (AC-84). The UI never infers permission.
//   - The browser never sends price, amount, currency, user id or a status. Intent only (AC-35, DEC-B04).
//   - Lists are paged with `page` and `pageSize`; bounded lists (CMS sections, event types, rounds, settings) are not.
//
// Endpoint-id mapping: see README.md beside this file.

/** Options for admin calls. Structurally the same as `RequestOpts` in pg-api.ts; redeclared to avoid a type import cycle. */
export interface AdminRequestOpts {
  signal?: AbortSignal
}

/** Calls that need a fresh step-up token (refund, role change, audit export). */
export interface StepUpOpts extends AdminRequestOpts {
  stepUp: StepUpToken
}

/** Optional idempotency on commands where the contract says the key is optional. */
export interface AdminOptionalKeyOpts extends AdminRequestOpts {
  idempotencyKey?: IdempotencyKey
}

type EventId = AdminEventRowDto['id']

// ---------- Dashboard (D01, screen 32) ----------

export interface PgAdminDashboardApi {
  /** D01. no-store. `event: null` is the "no upcoming event" empty state. */
  getDashboard(opts?: AdminRequestOpts): Promise<DashboardSummaryDto>
}

// ---------- Events and the builder (E01 to E10, screens 37 to 45) ----------

export interface PgAdminEventsApi {
  /** E01 */
  listEvents(query?: AdminEventsQuery, opts?: AdminRequestOpts): Promise<Page<AdminEventRowDto>>
  /** E02. Creates a draft; any step may be incomplete. */
  createDraft(input: CreateDraftInput, opts?: AdminOptionalKeyOpts): Promise<BuilderDraftDto>
  /** E03. The whole builder resource with `lockedFields`, `version` and publish readiness. */
  getEvent(eventId: EventId, opts?: AdminRequestOpts): Promise<BuilderDraftDto>
  /** E04. VERSION_CONFLICT when stale; locked fields are rejected once registrations or payments exist. */
  updateEvent(eventId: EventId, input: UpdateBuilderDraftInput, opts?: AdminRequestOpts): Promise<BuilderDraftDto>
  /** E05. Slug availability for an event or story, with a free suggestion when taken. */
  checkSlug(query: SlugCheckQuery, opts?: AdminRequestOpts): Promise<SlugCheckResult>
  /** E06. Bounded. */
  getEventTypes(opts?: AdminRequestOpts): Promise<EventTypeDefaultsDto[]>
  /** E07. Idempotency-Key required. NOT_PUBLISHABLE (blockers), SLUG_TAKEN. Locks the slug. */
  publishEvent(eventId: EventId, key: IdempotencyKey, opts?: AdminRequestOpts): Promise<PublishEventResult>
  /** E08. NOT_PUBLISHABLE when confirmed registrations exist. The slug stays locked. */
  unpublishEvent(eventId: EventId, opts?: AdminOptionalKeyOpts): Promise<UnpublishEventResult>
  /** Opens registrations for a published event. Idempotency-Key required. */
  openRegistrations(eventId: EventId, key: IdempotencyKey, opts?: AdminRequestOpts): Promise<OpenRegistrationResult>
  /** Closes registrations immediately for a registration_open event. */
  closeRegistrations(eventId: EventId, opts?: AdminRequestOpts): Promise<CloseRegistrationResult>
  /** Permanently deletes a draft event. Only allowed when canDelete.allowed is true. */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  deleteEvent(eventId: EventId, opts?: AdminRequestOpts): Promise<{}>
  /** E09. Idempotency-Key required. Refunds are queued asynchronously. */
  cancelEvent(
    eventId: EventId,
    input: CancelEventInput,
    key: IdempotencyKey,
    opts?: AdminRequestOpts,
  ): Promise<CancelEventResult>
  /** E10 */
  completeEvent(eventId: EventId, input?: CompleteEventInput, opts?: AdminOptionalKeyOpts): Promise<CompleteEventResult>
}

// ---------- Event control room (C01 to C17, screens 46 to 53) ----------

export interface PgAdminControlApi {
  /** C01 */
  getOverview(eventId: EventId, opts?: AdminRequestOpts): Promise<EventOverviewDto>
  /** C02. The only place registration PII is returned. */
  listRegistrations(
    eventId: EventId,
    query?: AdminRegistrationsQuery,
    opts?: AdminRequestOpts,
  ): Promise<Page<AdminRegistrationDto>>
  /** C03. Registration and payment state change only here and in `payments.refund`. */
  actOnRegistration(
    eventId: EventId,
    registrationId: AdminRegistrationDto['id'],
    input: RegistrationActionInput,
    opts?: AdminOptionalKeyOpts,
  ): Promise<AdminRegistrationDto>
  /** C05 */
  getCheckInDesk(eventId: EventId, query?: AdminCheckInQuery, opts?: AdminRequestOpts): Promise<CheckInDeskDto>
  /** C04. Manual host-desk check-in or undo, any time. */
  setCheckIn(eventId: EventId, input: ManualCheckInInput, opts?: AdminOptionalKeyOpts): Promise<ManualCheckInResult>
  /** Host-desk "check in everyone": every confirmed player not yet arrived, in one call. */
  checkInAll(eventId: EventId, opts?: AdminOptionalKeyOpts): Promise<CheckInAllResult>
  /** C06. Bounded. */
  listRounds(eventId: EventId, opts?: AdminRequestOpts): Promise<AdminRoundsDto>
  /** C07. Creates an unpublished draft round. */
  generateRound(eventId: EventId, input: GenerateRoundInput, opts?: AdminOptionalKeyOpts): Promise<AdminRoundDto>
  /** C08. After publish an edit needs a reason and creates a new round version. */
  editPairings(
    eventId: EventId,
    roundId: AdminRoundDto['id'],
    input: EditPairingsInput,
    opts?: AdminRequestOpts,
  ): Promise<AdminRoundDto>
  /** C09. Idempotency-Key required. Notifies players. */
  publishRound(
    eventId: EventId,
    roundId: AdminRoundDto['id'],
    version: AdminRoundDto['version'],
    key: IdempotencyKey,
    opts?: AdminRequestOpts,
  ): Promise<AdminRoundDto>
  /** C10 */
  startRound(
    eventId: EventId,
    roundId: AdminRoundDto['id'],
    version: AdminRoundDto['version'],
    opts?: AdminOptionalKeyOpts,
  ): Promise<AdminRoundDto>
  /** C11. `{ action: 'record' }` enters or overrides a result; `{ action: 'resolve' }` settles a dispute. Reason required. */
  recordResult(
    eventId: EventId,
    roundId: AdminRoundDto['id'],
    pairingId: string,
    input: ResultCommandInput,
    opts?: AdminOptionalKeyOpts,
  ): Promise<RecordResultResult>
  /** C12. Idempotency-Key required. RESULTS_NOT_FINAL until every result is final; ROUND_ALREADY_FINALIZED on a new key. */
  finaliseRound(
    eventId: EventId,
    roundId: AdminRoundDto['id'],
    version: AdminRoundDto['version'],
    key: IdempotencyKey,
    opts?: AdminRequestOpts,
  ): Promise<FinaliseResult>
  /** C13 */
  listEventPayments(
    eventId: EventId,
    query?: EventPaymentsQuery,
    opts?: AdminRequestOpts,
  ): Promise<Page<AdminPaymentRowDto>>
  /** C14 GET */
  listMessages(eventId: EventId, opts?: AdminRequestOpts): Promise<MessageLogDto>
  /** C14 GET one message with per-recipient delivery state (inferred sub-path). */
  getMessage(eventId: EventId, messageId: MessageDetailDto['id'], opts?: AdminRequestOpts): Promise<MessageDetailDto>
  /** C14 POST. Idempotency-Key required. 202: stored, delivery by the worker. */
  sendMessage(
    eventId: EventId,
    input: SendMessageInput,
    key: IdempotencyKey,
    opts?: AdminRequestOpts,
  ): Promise<MessageAccepted>
  /** C15 GET */
  getCommunications(eventId: EventId, opts?: AdminRequestOpts): Promise<CommunicationsSettingsDto>
  /** C15 PATCH */
  updateCommunications(
    eventId: EventId,
    input: UpdateCommunicationsInput,
    opts?: AdminRequestOpts,
  ): Promise<CommunicationsSettingsDto>
  /** C16 GET */
  getRecap(eventId: EventId, opts?: AdminRequestOpts): Promise<EventRecapDto>
  /** C16 PATCH. Publishing the archive emits `event/updated`. */
  updateRecap(eventId: EventId, input: UpdateRecapInput, opts?: AdminRequestOpts): Promise<EventRecapDto>
  /** C17 */
  listAudit(eventId: EventId, query?: AuditQuery, opts?: AdminRequestOpts): Promise<Page<AuditEntryDto>>
  /** C17 `?format=csv`. Needs a step-up token (data export). Resolves the CSV file; it is not parsed. */
  exportAudit(eventId: EventId, query: AuditQuery | undefined, opts: StepUpOpts): Promise<Blob>
}

// ---------- CMS (S01 to S06, screen 33) ----------

export interface PgAdminCmsApi {
  /** S01. Bounded. */
  listSections(opts?: AdminRequestOpts): Promise<CmsSectionRow[]>
  /** S02. Draft and published side by side. */
  getSection(key: SiteSection, opts?: AdminRequestOpts): Promise<CmsSectionDto>
  /** S03. The input's `key` selects the section and the content shape. VERSION_CONFLICT when stale. */
  saveSectionDraft(input: SaveCmsDraftInput, opts?: AdminRequestOpts): Promise<SaveCmsDraftResult>
  /** S04. Idempotency-Key required. */
  publishSection(
    key: SiteSection,
    version: CmsSectionDto['version'],
    idempotencyKey: IdempotencyKey,
    opts?: AdminRequestOpts,
  ): Promise<PublishCmsResult>
  /** S05 */
  listSectionVersions(key: SiteSection, opts?: AdminRequestOpts): Promise<Page<CmsVersionEntry>>
  /** S06 GET */
  getLegalPage(page: LegalPage, opts?: AdminRequestOpts): Promise<AdminLegalPageDto>
  /** S06 PUT */
  saveLegalDraft(page: LegalPage, input: SaveLegalDraftInput, opts?: AdminRequestOpts): Promise<AdminLegalPageDto>
  /** S06 publish. Idempotency-Key required. Production publish needs approved wording (process gate). */
  publishLegalPage(
    page: LegalPage,
    version: AdminLegalPageDto['version'],
    key: IdempotencyKey,
    opts?: AdminRequestOpts,
  ): Promise<PublishLegalResult>
}

// ---------- Media (S07 to S12, screen 34) ----------

export interface PgAdminMediaApi {
  /** S07. Returns a signed upload URL; the browser uploads to Storage directly (the API never receives bytes). */
  requestUpload(input: UploadRequest, opts?: AdminRequestOpts): Promise<UploadTicket>
  /** S08. After the browser upload: the server verifies, reads dimensions and strips EXIF. */
  completeUpload(assetId: UploadTicket['assetId'], opts?: AdminRequestOpts): Promise<MediaAssetDto>
  /** S09 */
  listAssets(query?: MediaAssetsQuery, opts?: AdminRequestOpts): Promise<Page<MediaAssetDto>>
  /** S10. Alt or decorative, focal 0..1, credit, archive. */
  updateAsset(assetId: MediaAssetDto['id'], input: UpdateMediaAsset, opts?: AdminRequestOpts): Promise<MediaAssetDto>
  /** S11. ASSET_IN_USE when referenced: archive instead. */
  deleteAsset(assetId: MediaAssetDto['id'], opts?: AdminRequestOpts): Promise<void>
  /** S12 */
  listCollections(query?: MediaCollectionsQuery, opts?: AdminRequestOpts): Promise<Page<MediaCollectionAdminDto>>
  /** S12 */
  getCollection(id: MediaCollectionAdminDto['id'], opts?: AdminRequestOpts): Promise<MediaCollectionAdminDto>
  /** S12 */
  createCollection(input: CreateMediaCollection, opts?: AdminRequestOpts): Promise<MediaCollectionAdminDto>
  /** S12 */
  updateCollection(
    id: MediaCollectionAdminDto['id'],
    input: UpdateMediaCollection,
    opts?: AdminRequestOpts,
  ): Promise<MediaCollectionAdminDto>
}

// ---------- Stories (S13, S14, screen 35) ----------

export interface PgAdminStoriesApi {
  /** S13 */
  listStories(query?: AdminStoriesQuery, opts?: AdminRequestOpts): Promise<Page<AdminStoryRowDto>>
  /** S13 */
  createStory(input: CreateStoryInput, opts?: AdminRequestOpts): Promise<AdminStoryDto>
  /** S13 */
  getStory(id: AdminStoryDto['id'], opts?: AdminRequestOpts): Promise<AdminStoryDto>
  /** S13. SLUG_LOCKED when the slug changes after first publish. */
  updateStory(id: AdminStoryDto['id'], input: UpdateStoryInput, opts?: AdminRequestOpts): Promise<AdminStoryDto>
  /** S14. Idempotency-Key required. SLUG_TAKEN, NOT_PUBLISHABLE. Locks the slug. */
  publishStory(id: AdminStoryDto['id'], key: IdempotencyKey, opts?: AdminRequestOpts): Promise<StoryPublishResult>
  /** S14 */
  unpublishStory(id: AdminStoryDto['id'], opts?: AdminOptionalKeyOpts): Promise<StoryPublishResult>
}

// ---------- Testimonials (S15, S16, screen 36) ----------

export interface PgAdminTestimonialsApi {
  /** S15 */
  listTestimonials(query?: AdminTestimonialsQuery, opts?: AdminRequestOpts): Promise<Page<AdminTestimonialDto>>
  /** S15 */
  createTestimonial(input: CreateTestimonialInput, opts?: AdminRequestOpts): Promise<AdminTestimonialDto>
  /** S15 */
  getTestimonial(id: AdminTestimonialDto['id'], opts?: AdminRequestOpts): Promise<AdminTestimonialDto>
  /** S15 */
  updateTestimonial(
    id: AdminTestimonialDto['id'],
    input: UpdateTestimonialInput,
    opts?: AdminRequestOpts,
  ): Promise<AdminTestimonialDto>
  /** S16. Needs quote + photo + consent: NOT_PUBLISHABLE with `fields` otherwise. */
  publishTestimonial(id: AdminTestimonialDto['id'], opts?: AdminOptionalKeyOpts): Promise<PublicationResult>
  /** S16 */
  unpublishTestimonial(id: AdminTestimonialDto['id'], opts?: AdminOptionalKeyOpts): Promise<PublicationResult>
}

// ---------- Preview (PV01) ----------

export interface PgAdminPreviewApi {
  /** PV01. Single-use link valid 5 minutes. The adapter checks the URL is on the site origin and /api/draft. */
  createPreviewLink(input: CreatePreviewLinkInput, opts?: AdminRequestOpts): Promise<PreviewLinkDto>
}

// ---------- Players (G01 to G03, screen 54) ----------

export interface PgAdminPlayersApi {
  /** G01 */
  listPlayers(query?: AdminPlayersQuery, opts?: AdminRequestOpts): Promise<Page<AdminPlayerRowDto>>
  /** G02. Permitted private fields only (limited by role). */
  getPlayer(id: AdminPlayerDto['id'], opts?: AdminRequestOpts): Promise<AdminPlayerDto>
  /** G03. Idempotency-Key and a step-up token required. The server blocks removing the last admin. */
  changeRole(
    id: AdminPlayerDto['id'],
    input: ChangeRoleInput,
    key: IdempotencyKey,
    opts: StepUpOpts,
  ): Promise<ChangeRoleResult>
}

// ---------- Payments (G04 to G06, screen 55; per-event list is control.listEventPayments) ----------

export interface PgAdminPaymentsApi {
  /** G04. Global ledger. */
  listLedger(query?: LedgerQuery, opts?: AdminRequestOpts): Promise<Page<AdminLedgerRowDto>>
  /** G05. Idempotency-Key and a step-up token required. Refund stays `pending` until the provider confirms. */
  refund(
    paymentId: AdminLedgerRowDto['id'],
    input: RefundRequest,
    key: IdempotencyKey,
    opts: StepUpOpts,
  ): Promise<RefundResult>
  /** G06. Counts only; mismatches are listed through the ledger filter, never silently fixed. */
  reconcile(input?: ReconcileRequest, opts?: AdminOptionalKeyOpts): Promise<ReconcileResult>
}

// ---------- Settings (G07, G08, screen 56) ----------

export interface PgAdminSettingsApi {
  /** G07. Grouped, non-secret only; integration health as `connected` flags. */
  getSettings(opts?: AdminRequestOpts): Promise<SettingsDto>
  /** G08. Partial update with `version`; keys on a server allow-list. */
  updateSettings(input: SettingsPatch, opts?: AdminRequestOpts): Promise<SettingsDto>
}

export interface PgAdminApi {
  dashboard: PgAdminDashboardApi
  events: PgAdminEventsApi
  control: PgAdminControlApi
  cms: PgAdminCmsApi
  media: PgAdminMediaApi
  stories: PgAdminStoriesApi
  testimonials: PgAdminTestimonialsApi
  preview: PgAdminPreviewApi
  players: PgAdminPlayersApi
  payments: PgAdminPaymentsApi
  settings: PgAdminSettingsApi
}
