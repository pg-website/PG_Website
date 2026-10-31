import type { PgAdminApi } from '@/lib/api/pg-admin-api'
import type {
  AuthResult,
  LoginInput,
  MeDto,
  OauthExchangeInput,
  OauthStart,
  PasswordResetConfirm,
  PasswordResetRequest,
  PreferencesInput,
  RefreshInput,
  RegisterInput,
  SessionTokens,
  StepUpInput,
  TokenCookieBody,
} from '@/lib/api/types/auth'
import type { ContactInput } from '@/lib/api/types/contact'
import type {
  CheckInResultDto,
  DisputeResultInput,
  EventRoomSnapshotDto,
  ResultUpdateDto,
  SubmitResultInput,
} from '@/lib/api/types/event-room'
import type { AvailabilityDto } from '@/lib/api/types/event-state'
import type { EventCardDto, EventDetailDto } from '@/lib/api/types/event'
import type { EventType, EventAudience } from '@/lib/api/types/event-state'
import type { RatingPool } from '@/lib/api/types/identity'
import type { LegalPage, LegalPageDto, SitemapEntryDto } from '@/lib/api/types/legal-sitemap'
import type { GameDto, MyEventsQuery, MyRegistrationDto, NextUpDto, PersonDto } from '@/lib/api/types/my-events'
import type { PublicProfileDto } from '@/lib/api/types/player-profile'
import type { Page, PageQuery } from '@/lib/api/types/pagination'
import type { PaymentOrderDto, CreateOrderInput, VerifyPaymentInput } from '@/lib/api/types/payment'
import type { IdempotencyKey, Slug } from '@/lib/api/types/primitives'
import type { ProfileDto, ProfileUpdate, PublicIdentityUpdate } from '@/lib/api/types/profile'
import type { LedgerEntryDto, RatingProfileDto, RatingTrendDto, TrendQuery } from '@/lib/api/types/rating'
import type {
  CancelResult,
  JoinWaitlistInput,
  JoinWaitlistResult,
  RegistrationResult,
  RegistrationStateDto,
  ReserveInput,
  ReserveResult,
  RegistrationDto,
} from '@/lib/api/types/registration'
import type { PublicSettingsDto, SiteSection, SiteSectionDto } from '@/lib/api/types/site-content'
import type { StoryCardDto, StoryDetailDto } from '@/lib/api/types/story'
import type { TestimonialDto } from '@/lib/api/types/testimonial'

// PgApi: the typed contract between the web app and the backend (ARCH-001 11.1; backend contract section 3).
// It is the executable specification of the new backend: TASK-022 exports it, TASK-092 runs a conformance suite on it.
// Rules for every implementer (real adapter, mock adapter):
//   - Public reads (`PgPublicApi`) are callable on the server (no token, tagged) and in the browser.
//   - Everything else is BROWSER ONLY: it needs the in-memory access token and must never run during server rendering.
//   - Responses are validated with the schemas in `types/response-schemas.ts`; a mismatch becomes ApiError(BAD_RESPONSE).
//   - Failures throw `ApiError` (TASK-014). A 404 on a slug read resolves `null`; every other 404 throws.
//   - The browser never sends price, amount, currency, user id or role (AC-35). Intent only.
//   - Methods that create or settle something take the `Idempotency-Key` created when the user's intent started.
//
// Endpoint-id mapping: see README.md beside this file.

/** Options for server-side public reads: the server adapter forwards `tags` and `revalidate` to the Next data cache. */
export interface ReadOpts {
  tags?: string[]
  revalidate?: number
  signal?: AbortSignal
  /** Draft preview (server only): sent as `X-Preview-Key`; the response is private and never cached or tagged. */
  previewKey?: string
}

/** Options for browser calls. */
export interface RequestOpts {
  signal?: AbortSignal
}

/** Optional idempotency (contract 2.5: optional on cancel-like and confirm-like calls). */
export interface OptionalKeyOpts extends RequestOpts {
  idempotencyKey?: IdempotencyKey
}

// ---------- Queries ----------

/** `GET /events` filters (P02). `free` and `audience` back the Play chips: Beginner friendly, Rated, Free. */
export interface EventsQuery extends PageQuery {
  q?: string
  type?: EventType
  audience?: EventAudience
  free?: boolean
  city?: string
}

/** `GET /past-events` (P05). */
export interface PastEventsQuery extends PageQuery {
  q?: string
  type?: EventType
}

// ---------- Public (server and browser, no token) ----------

export interface PgPublicApi {
  /** P01 */
  getSiteContent<K extends SiteSection>(section: K, opts?: ReadOpts): Promise<Extract<SiteSectionDto, { key: K }>>
  /** P02. Published upcoming events only. */
  getUpcomingEvents(query?: EventsQuery, opts?: ReadOpts): Promise<Page<EventCardDto>>
  /** P03. Resolves null for an unknown, draft or unpublished slug (the page calls notFound()). */
  getEventBySlug(slug: Slug, opts?: ReadOpts): Promise<EventDetailDto | null>
  /** P04. no-store; used by the browser availability island. */
  getEventAvailability(slug: Slug, opts?: ReadOpts): Promise<AvailabilityDto>
  /** P05 */
  getPastEvents(query?: PastEventsQuery, opts?: ReadOpts): Promise<Page<EventCardDto>>
  /** P06 */
  getStories(query?: PageQuery, opts?: ReadOpts): Promise<Page<StoryCardDto>>
  /** P07. Resolves null for an unknown or unpublished slug. */
  getStoryBySlug(slug: Slug, opts?: ReadOpts): Promise<StoryDetailDto | null>
  /** P08. Bounded, published only. */
  getTestimonials(opts?: ReadOpts): Promise<TestimonialDto[]>
  /** P09 */
  getLegalPage(page: LegalPage, opts?: ReadOpts): Promise<LegalPageDto>
  /** P10. `pageSize` up to 1000. */
  getSitemapEntries(query?: PageQuery, opts?: ReadOpts): Promise<Page<SitemapEntryDto>>
  /** P12 (inferred). */
  getPublicSettings(opts?: ReadOpts): Promise<PublicSettingsDto>
  /** PLAN-007. Resolves null for an unknown, hidden or suspended player (the page calls notFound()). */
  getPlayerProfile(publicId: string, opts?: ReadOpts): Promise<PublicProfileDto | null>
  /** P11. 202; resolves when accepted. Browser only in practice (a mutation). */
  submitContact(input: ContactInput, key: IdempotencyKey, opts?: RequestOpts): Promise<void>
}

// ---------- Player (browser only, bearer token) ----------

/** Authentication and session (A01 to A09). Calls before sign-in carry no token; `refresh` is single-flighted by the client. */
export interface PgAuthApi {
  /** A02 */
  login(input: LoginInput, opts?: RequestOpts): Promise<AuthResult>
  /** A01 */
  register(input: RegisterInput, opts?: RequestOpts): Promise<AuthResult>
  /** A03. Body mode sends the refresh token; cookie mode sends `{}` and the CSRF header. */
  refresh(input: RefreshInput, opts?: RequestOpts): Promise<SessionTokens>
  /** A04. Always succeeds server-side. */
  logout(input: RefreshInput, opts?: RequestOpts): Promise<void>
  /** A05. no-store. The role is read from here, never from a token claim. */
  getMe(opts?: RequestOpts): Promise<MeDto>
  /** A06. Neutral: identical outcome for known and unknown emails. */
  requestPasswordReset(input: PasswordResetRequest, opts?: RequestOpts): Promise<void>
  /** A07 */
  confirmPasswordReset(input: PasswordResetConfirm, opts?: RequestOpts): Promise<void>
  /** `POST /auth/step-up` (contract 2.4). Short-lived token for one sensitive operation. */
  stepUp(input: StepUpInput, opts?: RequestOpts): Promise<TokenCookieBody>
  /** A08. Flag-gated (NEXT_PUBLIC_GOOGLE_AUTH). */
  startGoogleSignIn(opts?: RequestOpts): Promise<OauthStart>
  /** A09. Flag-gated. */
  exchangeOAuthCode(input: OauthExchangeInput, opts?: RequestOpts): Promise<SessionTokens>
}

/** Player dashboard reads (M01 to M04). */
export interface PgMeApi {
  /** M01. Null is the empty state. */
  getNextUp(opts?: RequestOpts): Promise<NextUpDto | null>
  /** M02 */
  getRecentGames(query?: PageQuery, opts?: RequestOpts): Promise<Page<GameDto>>
  /** M03 */
  getPeople(opts?: RequestOpts): Promise<PersonDto[]>
  /** M04 */
  getMyEvents(query: MyEventsQuery, opts?: RequestOpts): Promise<Page<MyRegistrationDto>>
}

/** Registration and payments (R01 to R08). The server derives user, price, capacity, window, hold and payment state. */
export interface PgRegistrationApi {
  /** R01 */
  getRegistrationState(slug: Slug, opts?: RequestOpts): Promise<RegistrationStateDto>
  /** R02. Idempotency-Key required. Free: confirmed. Paid: pending with a hold. */
  reserve(input: ReserveInput, key: IdempotencyKey, opts?: RequestOpts): Promise<ReserveResult>
  /** R03. Idempotency-Key required. No payment is taken. */
  joinWaitlist(input: JoinWaitlistInput, key: IdempotencyKey, opts?: RequestOpts): Promise<JoinWaitlistResult>
  /** R04. Idempotency-Key required. Amount, currency and key come only from this response. */
  createPaymentOrder(input: CreateOrderInput, key: IdempotencyKey, opts?: RequestOpts): Promise<PaymentOrderDto>
  /** R05. Idempotency-Key required. May return `confirming`. */
  verifyPayment(input: VerifyPaymentInput, key: IdempotencyKey, opts?: RequestOpts): Promise<RegistrationResult>
  /** R06. Polling-safe, no-store, owner only. */
  getRegistration(registrationId: RegistrationDto['id'], opts?: RequestOpts): Promise<RegistrationDto>
  /** R07. Key optional. CANCELLATION_NOT_ALLOWED when outside policy. */
  cancelRegistration(registrationId: RegistrationDto['id'], opts?: OptionalKeyOpts): Promise<CancelResult>
  /** R08 (inferred). Idempotency-Key required. */
  acceptWaitlistOffer(
    registrationId: RegistrationDto['id'],
    key: IdempotencyKey,
    opts?: RequestOpts,
  ): Promise<RegistrationResult>
}

/** Event Room (M05 to M09). The UI renders from `capabilities` and `result`; it never infers who may act. */
export interface PgEventRoomApi {
  /** M05. no-store; polled (5 to 30 s). REGISTRATION_NOT_CONFIRMED when not confirmed. */
  getSnapshot(eventId: EventRoomSnapshotDto['eventId'], opts?: RequestOpts): Promise<EventRoomSnapshotDto>
  /** M06. Key optional. */
  checkIn(eventId: EventRoomSnapshotDto['eventId'], opts?: OptionalKeyOpts): Promise<CheckInResultDto>
  /** M07. Idempotency-Key required. RESULT_NOT_ALLOWED when `canSubmitResult` is false. */
  submitResult(
    eventId: EventRoomSnapshotDto['eventId'],
    input: SubmitResultInput,
    key: IdempotencyKey,
    opts?: RequestOpts,
  ): Promise<ResultUpdateDto>
  /** M08. Key optional. */
  confirmResult(
    eventId: EventRoomSnapshotDto['eventId'],
    pairingId: SubmitResultInput['pairingId'],
    opts?: OptionalKeyOpts,
  ): Promise<ResultUpdateDto>
  /** M09. Key optional. */
  disputeResult(
    eventId: EventRoomSnapshotDto['eventId'],
    pairingId: SubmitResultInput['pairingId'],
    input: DisputeResultInput,
    opts?: OptionalKeyOpts,
  ): Promise<ResultUpdateDto>
}

/** Ratings (M10 to M12). */
export interface PgRatingApi {
  /** M10 */
  getRatings(opts?: RequestOpts): Promise<RatingProfileDto>
  /** M11 */
  getLedger(pool: RatingPool, query?: PageQuery, opts?: RequestOpts): Promise<Page<LedgerEntryDto>>
  /** M12 */
  getTrend(pool: RatingPool, query?: TrendQuery, opts?: RequestOpts): Promise<RatingTrendDto>
}

/** Profile (M13 to M16): private account data and public chess identity are separate calls. */
export interface PgProfileApi {
  /** M13 */
  getProfile(opts?: RequestOpts): Promise<ProfileDto>
  /** M14 */
  updateProfile(input: ProfileUpdate, opts?: RequestOpts): Promise<ProfileDto>
  /** M15 */
  updatePublicIdentity(input: PublicIdentityUpdate, opts?: RequestOpts): Promise<ProfileDto>
  /** M16. Skippable first-login preferences; marks onboarding done. */
  savePreferences(input: PreferencesInput, opts?: RequestOpts): Promise<MeDto>
}

export interface PgPlayerApi {
  auth: PgAuthApi
  me: PgMeApi
  registration: PgRegistrationApi
  eventRoom: PgEventRoomApi
  rating: PgRatingApi
  profile: PgProfileApi
}

export interface PgApi {
  public: PgPublicApi
  player: PgPlayerApi
  /** Browser only, admin role (TASK-017). See pg-admin-api.ts. */
  admin: PgAdminApi
}
