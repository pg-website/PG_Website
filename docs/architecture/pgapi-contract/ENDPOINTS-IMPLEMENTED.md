# Implemented endpoints (BE-14 reconciliation)

Generated 2026-10-27 from the mounted Django routes (`backend/*/urls.py`), compared with `docs/architecture/ARCH-001-backend-contract.md` section 3 and `web/src/lib/api/types/*` (read-only). The machine-readable twin is `docs/api/pg-chess-backend.openapi.yaml`; its method and path set equals the mounted routes (checked by script; the only extra mounted routes are the DEBUG-only `/api/dev-storage/*` stand-ins and the catch-all `/api/*` 404 envelope).

## Conventions that apply to every row

- Base path `/api`, no trailing slashes. Every response uses the DEC-011 envelope (`success`, `data`, `error{code,detail,fields,retry_after}`, `meta{request_id,timestamp,pagination}`) except 204/205, the Razorpay webhook, the `?format=csv` audit export and the dev-storage stand-ins. Keys inside `data` are camelCase. Unknown `/api/*` paths and methods answer in the envelope (`NOT_FOUND`, `METHOD_NOT_ALLOWED`).
- Auth: `public` = none; `player` = bearer access token (`AUTH_REQUIRED` without it); `admin` = bearer, role re-read from the database (`ADMIN_REQUIRED`). Private responses are `no-store`.
- Idempotency: header `Idempotency-Key` (UUID v4). `required` rows answer `VALIDATION_FAILED` (`fields.idempotencyKey`) when it is missing; a replay returns the original response with `Idempotent-Replay: true`; same key, different body gives `IDEMPOTENCY_CONFLICT` (422).
- Step-up: grant from `POST /auth/step-up`, single use, 5 minutes, sent as `X-Step-Up-Token` (decided BE-14; `Authorization: Bearer` stays the access token, so the web must send the header: FE task F1); missing or used gives 401 `STEP_UP_REQUIRED`.
- Rate limits answer 429 `RATE_LIMITED` with `retry_after` and `Retry-After`.
- Error codes in the table are those named in the OpenAPI operation; the common ones (`AUTH_REQUIRED`, `ADMIN_REQUIRED`, `VALIDATION_FAILED`, `RATE_LIMITED`, `NOT_FOUND`) can occur on any row of the matching auth class.
- Status column: `Matches` = route, method, auth, idempotency and the DTO key names agree with contract section 3 and the web types as far as the key-level comparison goes; other values name the drift (D-numbers refer to the section below).

## Endpoint table

| ID | Method | Path | Auth | Idempotency-Key | Step-up | Success status and response | Errors | Status vs contract |
|---|---|---|---|---|---|---|---|---|| - | GET | `/api/health` | public | - | - | 200 Liveness and database ping | - | Extra (not in contract) |
| A01 | POST | `/api/auth/register` | public | - | - | 201 Create an account | `SIGNUP_CLOSED` `EMAIL_TAKEN` | Matches; may answer 403 `SIGNUP_CLOSED` (outside taxonomy, D2) |
| A02 | POST | `/api/auth/login` | public | - | - | 200 Sign in | `INVALID_CREDENTIALS` `AUTH_REQUIRED` `ACCOUNT_SUSPENDED` | Matches |
| A03 | POST | `/api/auth/refresh` | public | - | - | 200 Rotate the refresh token | `AUTH_REQUIRED` `REFRESH_REUSED` | Matches |
| A04 | POST | `/api/auth/logout` | public | - | - | 200 Sign out (revokes the session family) | - | Matches |
| A05 | GET | `/api/auth/me` | player | - | - | 200 Current user | - | Matches |
| A06 | POST | `/api/auth/password-reset` | public | - | - | 200 Request a password reset (neutral response) | - | Matches |
| A07 | POST | `/api/auth/password-reset/confirm` | public | - | - | 200 Set a new password with a reset token | `RESET_TOKEN_INVALID` `WEAK_PASSWORD` `VALIDATION_FAILED` | Matches |
| - | POST | `/api/auth/step-up` | player | - | - | 200 Re-enter password to obtain a single-use step-up grant (5 minutes) | - | Extra (contract 2.4 describes it, not in 3.2). Returns `{accessToken}` single-use grant; see D1 |
| A08 | GET | `/api/auth/oauth/google/start` | public | - | - |  Google sign-in start (flag-gated stub, 404 NOT_FOUND today) | - | Stub: flag-gated, always 404 NOT_FOUND until the provider flow is built |
| A09 | POST | `/api/auth/oauth/exchange` | public | - | - |  Google code exchange (flag-gated stub, 404 NOT_FOUND today) | - | Stub: flag-gated, always 404 NOT_FOUND |
| A10 | GET | `/api/auth/oauth/google/callback` | public | - | - |  Google provider callback (flag-gated stub, 404 NOT_FOUND today) | - | Stub: flag-gated, always 404 NOT_FOUND |
| M13 | GET | `/api/me/profile` | player | - | - | 200 Private profile | - | Matches |
| M14 | PATCH | `/api/me/profile` | player | - | - | 200 Update allow-listed private fields | `VALIDATION_FAILED` | Matches |
| M15 | PATCH | `/api/me/public-identity` | player | - | - | 200 Visibility toggles for the public identity | - | Matches |
| M16 | PATCH | `/api/me/preferences` | player | - | - | 200 First-login preferences (saving or skipping both finish onboarding) | - | Matches |
| P01 | GET | `/api/site/{section}` | public | - | - | 200 Published site section | - | Matches |
| P02 | GET | `/api/events` | public | - | - | 200 Upcoming published events | - | Matches |
| P03 | GET | `/api/events/{slug}` | public | - | - | 200 Event detail by slug | `EVENT_NOT_FOUND` | Matches |
| P04 | GET | `/api/events/{slug}/availability` | public | - | - | 200 Live availability (no-store) | - | Matches |
| P05 | GET | `/api/past-events` | public | - | - | 200 Completed events | - | Matches |
| P06 | GET | `/api/stories` | public | - | - | 200 Published stories | - | Matches |
| P07 | GET | `/api/stories/{slug}` | public | - | - | 200 Story detail (closed block body, no HTML) | - | Matches |
| P08 | GET | `/api/testimonials` | public | - | - | 200 Published testimonials | - | Matches |
| P09 | GET | `/api/legal/{page}` | public | - | - | 200 Legal page | - | Matches |
| P10 | GET | `/api/sitemap-entries` | public | - | - | 200 Sitemap entries (page_size up to 1000) | - | Matches |
| P12 | GET | `/api/settings/public` | public | - | - | 200 Public settings | - | Matches |
| P11 | POST | `/api/contact` | public | optional | - | 202 Contact form (202, stored then emailed to the configured destination) | `IDEMPOTENCY_CONFLICT` `CONTACT_DESTINATION_EMAIL` | Deviates: Idempotency-Key optional (contract 2.5: required); see D3 |
| - | POST | `/api/preview/exchange` | public | - | - | 200 Preview exchange (server to server; bearer PREVIEW_SECRET) | `VALIDATION_FAILED` `AUTH_REQUIRED` `PREVIEW_SECRET` | Matches |
| R01 | GET | `/api/events/{slug}/registration` | player | - | - | 200 Registration state for the signed-in player | - | Matches |
| R02 | POST | `/api/registrations` | player | required | - | 201 Reserve a place (Idempotency-Key required) | `REGISTRATION_NOT_OPEN` `REGISTRATION_CLOSED` `EVENT_FULL` `ALREADY_REGISTERED` | Matches |
| R03 | POST | `/api/registrations/waitlist` | player | required | - | 201 Join the waitlist (Idempotency-Key required) | - | Matches |
| R06 | GET | `/api/registrations/{registrationId}` | player | - | - | 200 Registration detail (owner only, polling-safe) | - | Matches |
| R07 | POST | `/api/registrations/{registrationId}/cancel` | player | optional | - | 200 Cancel a registration (Idempotency-Key optional) | `CANCELLATION_NOT_ALLOWED` | Matches |
| R08 | POST | `/api/registrations/{registrationId}/accept-offer` | player | required | - | 200 Accept a waitlist offer (Idempotency-Key required) | - | Matches |
| R04 | POST | `/api/payments/orders` | player | required | - | 200 Create or return the payment order (Idempotency-Key required) | `HOLD_EXPIRED` `ALREADY_REGISTERED` `PAYMENT_UNAVAILABLE` | Matches |
| R05 | POST | `/api/payments/verify` | player | required | - | 200 Verify a Checkout payment (Idempotency-Key required) | `VALIDATION_FAILED` `INVALID_SIGNATURE` `PAYMENT_MISMATCH` `HOLD_EXPIRED` `PAYMENT_UNAVAILABLE` | Matches |
| W01 | POST | `/api/webhooks/razorpay` | HMAC signature | - | - | 200 Razorpay webhook (inbound from Razorpay, not called by the web app) | - | Matches W01: raw body, no envelope, no bearer |
| P-PLAYER | GET | `/api/players/{publicId}` | public | - | - | 200 Public player profile `{publicId, displayName, initials, cityChapter, ratings[{pool,value}], memberSince, eventsPlayed}`. Unauthenticated, 60/min/IP. | `NOT_FOUND` (identical for malformed, unknown, hidden, suspended, under-18) | PLAN-007. Additive: every PublicIdentity now has `publicId` (string or null; null when the name is hidden, suspended, under 18 by birthday, or missing user). |
| M01 | GET | `/api/me/next-up` | player | - | - | 200 Next confirmed event (data is null when none) | - | Matches |
| M02 | GET | `/api/me/recent-games` | player | - | - | 200 Recent final games (default page size 5) | - | Matches |
| M03 | GET | `/api/me/people` | player | - | - | 200 Opponents played most (public identity only) | - | Matches |
| M04 | GET | `/api/me/registrations` | player | - | - | 200 My registrations | - | Matches. Additive (PLAN-003 EV-01): each row's `event.cover` is the public media shape (`src`, `width`, `height`, `focal`, `decorative`, `alt`, optional `blurDataUrl`), `null` when the event has no cover or the asset is archived. |
| M05 | GET | `/api/me/events/{eventId}/room` | player | - | - | 200 Event room snapshot (12 requests per minute per user) | `REGISTRATION_NOT_CONFIRMED` | Matches |
| M06 | POST | `/api/me/events/{eventId}/check-in` | player | optional | - | 200 Self check-in (Idempotency-Key optional) | `CHECKIN_WINDOW_CLOSED` `MANUAL_REQUIRED` `REGISTRATION_NOT_CONFIRMED` | Matches |
| M07 | POST | `/api/me/events/{eventId}/results` | player | required | - | 200 Submit my game result (Idempotency-Key required) | `RESULT_NOT_ALLOWED` | Matches |
| M08 | POST | `/api/me/events/{eventId}/results/{pairingId}/confirm` | player | optional | - | 200 Opponent confirms a submitted result (Idempotency-Key optional) | - | Matches |
| M09 | POST | `/api/me/events/{eventId}/results/{pairingId}/dispute` | player | optional | - | 200 Dispute a submitted result (Idempotency-Key optional) | - | Matches |
| M10 | GET | `/api/me/ratings` | player | - | - | 200 Rating pools summary (always blitz, rapid, classical) | - | Matches |
| M11 | GET | `/api/me/ratings/{pool}/ledger` | player | - | - | 200 Rating ledger (rated rows, newest first) | - | Matches |
| M12 | GET | `/api/me/ratings/{pool}/trend` | player | - | - | 200 Rating trend series | - | Matches |
| - | GET | `/api/admin/ping` | admin | - | - | 200 Admin foundation check (401 anonymous, 403 non-admin) | - | Extra (not in contract) |
| D01 | GET | `/api/admin/dashboard` | admin | - | - | 200 Dashboard aggregates (next or today's event, pending payments, website health, attention) | - | Matches |
| E01 | GET | `/api/admin/events` | admin | - | - | 200 List events (all statuses, newest start first) | - | Matches; row includes `area` and `city` (neighbourhood subtitle and city name) |
| E02 | POST | `/api/admin/events` | admin | - | - | 201 Create a draft (any step may be incomplete) | `SLUG_TAKEN` | Matches |
| E03 | GET | `/api/admin/events/{eventId}` | admin | - | - | 200 Full builder resource (8 steps, lockedFields, readiness blockers, version) | `EVENT_NOT_FOUND` | Matches |
| E04 | PATCH | `/api/admin/events/{eventId}` | admin | - | conditional (operational fields of a public event) | 200 Partial update of one or more steps | `STEP_UP_REQUIRED` `VERSION_CONFLICT` `SLUG_LOCKED` `SLUG_TAKEN` `VALIDATION_FAILED` | Deviates: step-up grant read from `X-Step-Up-Token` (web sends it as Bearer); see D1 |
| E05 | GET | `/api/admin/slugs/check` | admin | - | - | 200 Is a slug free (event or story)? | - | Matches |
| E06 | GET | `/api/admin/event-types` | admin | - | - | 200 Event types with their configurable defaults | - | Matches |
| S07 | POST | `/api/admin/media/uploads` | admin | - | - | 201 Issue a signed upload URL (the server never receives the bytes) | `RATE_LIMITED` `STORAGE_UNAVAILABLE` | Matches |
| S09 | GET | `/api/admin/media/assets` | admin | - | - | 200 List media assets | - | Matches web (D4 applied) |
| S08 | POST | `/api/admin/media/assets/{assetId}/complete` | admin | - | - | 200/201 Complete an upload (verify object, read dimensions, strip EXIF, record the asset) | `ALT_MISSING` `VALIDATION_FAILED` | Matches web (D4 applied) |
| - | GET | `/api/admin/media/assets/{assetId}` | admin | - | - | 200 Read one media asset | - | Matches web (D4 applied) |
| S10 | PATCH | `/api/admin/media/assets/{assetId}` | admin | - | - | 200 Update alt text, decorative flag, focal point, credit or archive state | `VERSION_CONFLICT` `ALT_MISSING` | Matches web (D4 applied) |
| S11 | DELETE | `/api/admin/media/assets/{assetId}` | admin | - | - | 200 Delete an unreferenced asset | `ASSET_IN_USE` | Matches |
| S01 | GET | `/api/admin/cms/sections` | admin | - | - | 200 List CMS sections | - | Matches web (D5 applied) |
| S02 | GET | `/api/admin/cms/sections/{key}` | admin | - | - | 200 Read a section (draft and published side by side) | - | Matches web (D5 applied). With no live copy and no draft: `status: clean`, `published: null`, `draft: null`, `version: 0`, `lastChange: null` (CMS-B1 verified, all 5 keys) |
| S03 | PUT | `/api/admin/cms/sections/{key}/draft` | admin | - | - | 200 Save the section draft | `VERSION_CONFLICT` | Matches; `savedAt` added by BE-14 |
| S04 | POST | `/api/admin/cms/sections/{key}/publish` | admin | required | - | 200 Publish the section draft (Idempotency-Key required) | `VERSION_CONFLICT` `IDEMPOTENCY_CONFLICT` `NOT_PUBLISHABLE` `NO_DRAFT` `NO_CHANGES` `INVALID_CONTENT` | Matches (returns status published; F5 closed) |
| S05 | GET | `/api/admin/cms/sections/{key}/versions` | admin | - | - | 200 Publish history of a section (newest first) | - | Matches |
| S06 | GET | `/api/admin/legal/{page}` | admin | - | - | 200 Read a legal page (draft and published side by side) | - | Matches. Empty (no live, no draft): `status: clean`, `published: null`, `draft: null`, `version: 0` for privacy, terms, refund-policy |
| S06 | PUT | `/api/admin/legal/{page}` | admin | - | - | 200 Save the legal page draft | `VERSION_CONFLICT` | Matches |
| S06 | POST | `/api/admin/legal/{page}/publish` | admin | required | - | 200 Publish the legal page draft (Idempotency-Key required) | `VERSION_CONFLICT` `IDEMPOTENCY_CONFLICT` `NOT_PUBLISHABLE` | Matches |
| S13 | GET | `/api/admin/stories` | admin | - | - | 200 List stories (without body) | - | Matches |
| S13 | POST | `/api/admin/stories` | admin | - | - | 201 Create a story draft | `SLUG_TAKEN` | Matches |
| S13 | GET | `/api/admin/stories/{storyId}` | admin | - | - | 200 Read a story | - | Matches |
| S13 | PATCH | `/api/admin/stories/{storyId}` | admin | - | - | 200 Update a story | `SLUG_TAKEN` `SLUG_LOCKED` `VERSION_CONFLICT` | Matches |
| S14 | POST | `/api/admin/stories/{storyId}/publish` | admin | required | - | 200 Publish a story (Idempotency-Key required) | `SLUG_TAKEN` `IDEMPOTENCY_CONFLICT` `NOT_PUBLISHABLE` | Matches |
| S14 | POST | `/api/admin/stories/{storyId}/unpublish` | admin | - | - | 200 Unpublish a story | `NOT_PUBLISHABLE` | Matches |
| - | POST | `/api/admin/preview-link` | admin | - | - | 200 PV01 Create a draft preview link | - | Matches |
| S15 | GET | `/api/admin/testimonials` | admin | - | - | 200 List testimonials | - | Matches |
| S15 | POST | `/api/admin/testimonials` | admin | - | - | 201 Create a testimonial draft | - | Matches |
| S15 | GET | `/api/admin/testimonials/{testimonialId}` | admin | - | - | 200 Read a testimonial | - | Matches |
| S15 | PATCH | `/api/admin/testimonials/{testimonialId}` | admin | - | - | 200 Update a testimonial | `VERSION_CONFLICT` `NOT_PUBLISHABLE` | Matches; accepts `sortOrder` (int 0-1000), `version`, quote, name, descriptor, portraitAssetId, consent |
| S16 | POST | `/api/admin/testimonials/{testimonialId}/publish` | admin | required | - | 200 Publish a testimonial (Idempotency-Key required) | `NOT_PUBLISHABLE` `REQUIRED` `CONSENT_REQUIRED` `ASSET_ARCHIVED` `ALREADY_PUBLISHED` | Matches |
| S16 | POST | `/api/admin/testimonials/{testimonialId}/unpublish` | admin | - | - | 200 Unpublish a testimonial | `NOT_PUBLISHABLE` | Matches |
| E07 | POST | `/api/admin/events/{eventId}/publish` | admin | required | - | 200 Publish a draft (Idempotency-Key required) | `SLUG_TAKEN` `NOT_PUBLISHABLE` | Matches |
| E08 | POST | `/api/admin/events/{eventId}/unpublish` | admin | - | - | 200 Unpublish (back to draft; only with no confirmed registrations or payment in flight) | `NOT_PUBLISHABLE` | Matches |
| E09 | POST | `/api/admin/events/{eventId}/cancel` | admin | required | conditional (refundable payments) | 200 Cancel an event (Idempotency-Key required) | `STEP_UP_REQUIRED` `CANCELLATION_NOT_ALLOWED` | Deviates: step-up grant read from `X-Step-Up-Token` (web sends it as Bearer); see D1 |
| E10 | POST | `/api/admin/events/{eventId}/complete` | admin | - | - | 200 Mark an event completed (it must have started) | - | Matches |
| C06 | GET | `/api/admin/events/{eventId}/rounds` | admin | - | - | 200 Rounds of an event (bounded, at most 30) with pairings, results and capabilities | `RESULTS_NOT_FINAL` | Matches |
| C07 | POST | `/api/admin/events/{eventId}/rounds/generate` | admin | optional | - | 200/201 Generate an UNPUBLISHED draft round (Idempotency-Key optional) | - | Matches |
| C08 | PATCH | `/api/admin/events/{eventId}/rounds/{roundId}/pairings` | admin | - | - | 200 Edit boards, players, colours and byes | `VERSION_CONFLICT` | Matches |
| C09 | POST | `/api/admin/events/{eventId}/rounds/{roundId}/publish` | admin | required | - | 200 Publish a draft round (Idempotency-Key required) | `VERSION_CONFLICT` `NOT_PUBLISHABLE` `NO_PAIRINGS` `PLAYER_NOT_CONFIRMED` `ROUND_NOT_DRAFT` | Matches |
| C10 | POST | `/api/admin/events/{eventId}/rounds/{roundId}/start` | admin | - | - | 200 Start a published round (published to live) | `VERSION_CONFLICT` | Matches |
| C11 | PUT | `/api/admin/events/{eventId}/rounds/{roundId}/pairings/{pairingId}/result` | admin | - | - | 200 Record or override a result, or resolve a dispute (reason mandatory, audited) | `RESULT_NOT_ALLOWED` | Matches |
| C12 | POST | `/api/admin/events/{eventId}/rounds/{roundId}/finalise` | admin | required | - | 200 Finalise a live round and process ratings (Idempotency-Key required) | `RESULTS_NOT_FINAL` `ROUND_ALREADY_FINALIZED` `VERSION_CONFLICT` | Matches |
| C01 | GET | `/api/admin/events/{eventId}/overview` | admin | - | - | 200 Control room overview (summary strip, run of show, arrival metrics, pairing summary) | `EVENT_NOT_FOUND` | Matches |
| C02 | GET | `/api/admin/events/{eventId}/registrations` | admin | - | - | 200 Registrations of an event (admin only; the only place registration PII is returned) | - | Matches |
| C03 | POST | `/api/admin/events/{eventId}/registrations/{regId}/actions` | admin | optional | conditional (`cancel` of a captured payment) | 200 Registration action (the only way registration state changes besides refund) | `STEP_UP_REQUIRED` `AUTH_REQUIRED` `VALIDATION_FAILED` | Deviates: step-up grant read from `X-Step-Up-Token` (web sends it as Bearer); see D1 |
| C05 | GET | `/api/admin/events/{eventId}/check-in` | admin | - | - | 200 Host desk list (search, arrival counts, first-timer queue) | - | Matches |
| C04 | POST | `/api/admin/events/{eventId}/check-in` | admin | - | - | 200 Host-desk check-in or undo (any time except a cancelled event) | `REGISTRATION_NOT_CONFIRMED` | Matches |
| C13 | GET | `/api/admin/events/{eventId}/payments` | admin | - | - | 200 Payments of an event (one row per payment order) | - | Matches |
| C16 | GET | `/api/admin/events/{eventId}/recap` | admin | - | - | 200 Recap, archive gallery images (`assetIds`) and archive flag | - | Matches |
| C16 | PATCH | `/api/admin/events/{eventId}/recap` | admin | - | - | 200 Update the recap, gallery link or archive flag (completed events only) | `VERSION_CONFLICT` | Matches |
| C14 | GET | `/api/admin/events/{eventId}/messages` | admin | - | - | 200 Message log with per-recipient delivery counts and channel health | - | Matches |
| C14 | POST | `/api/admin/events/{eventId}/messages` | admin | required | - | 202 Send a message to an audience (Idempotency-Key required, 202) | `IDEMPOTENCY_CONFLICT` | Matches |
| C14 | GET | `/api/admin/events/{eventId}/messages/{messageId}` | admin | - | - | 200 One message with per-recipient delivery state (up to 500 recipients) | - | Matches |
| C15 | GET | `/api/admin/events/{eventId}/communications` | admin | - | - | 200 Per-event toggles for state-triggered messages | - | Matches |
| C15 | PATCH | `/api/admin/events/{eventId}/communications` | admin | - | - | 200 Update trigger toggles | `VERSION_CONFLICT` | Matches |
| C17 | GET | `/api/admin/events/{eventId}/audit` | admin | - | only with `format=csv` | 200 Event audit log (time ordered) or CSV export | `STEP_UP_REQUIRED` `AUTH_REQUIRED` | Deviates: step-up grant read from `X-Step-Up-Token` (web sends it as Bearer); see D1 |
| G01 | GET | `/api/admin/players` | admin | - | - | 200 Search players | - | Matches |
| G02 | GET | `/api/admin/players/{playerId}` | admin | - | - | 200 Player record | - | Matches |
| G03 | PUT | `/api/admin/players/{playerId}/role` | admin | required | yes | 200 Change a player's role (step-up) | `STEP_UP_REQUIRED` `AUTH_REQUIRED` `IDEMPOTENCY_CONFLICT` `VALIDATION_FAILED` | Deviates: step-up grant read from `X-Step-Up-Token` (web sends it as Bearer); see D1 |
| G04 | GET | `/api/admin/payments` | admin | - | - | 200 Global payments ledger | - | Matches |
| G06 | POST | `/api/admin/payments/reconcile` | admin | - | - | 200 Reconcile payments with the provider | - | Matches |
| G05 | POST | `/api/admin/payments/{paymentId}/refund` | admin | required | yes | 200 Refund a captured payment (step-up) | `STEP_UP_REQUIRED` `AUTH_REQUIRED` `IDEMPOTENCY_CONFLICT` | Deviates: step-up grant read from `X-Step-Up-Token` (web sends it as Bearer); see D1 |
| G07 | GET | `/api/admin/settings` | admin | - | - | 200 Grouped non-secret settings and integration health | - | Matches |
| G08 | PATCH | `/api/admin/settings` | admin | - | - | 200 Partial settings update | `VERSION_CONFLICT` `VALIDATION_FAILED` | Matches |

## Contract coverage

Every endpoint ID in contract section 3 (P01-P12, A01-A10, R01-R08, W01, M01-M16, D01, E01-E10, C01-C17, S01-S16, PV01, G01-G08) plus `POST /api/preview/exchange` (3.10) is mounted. Extras not in section 3: `GET /api/health`, `GET /api/admin/ping`, `POST /api/auth/step-up` (contract 2.4), `GET /api/admin/events/{id}/messages/{messageId}` (log detail). A08-A10 are mounted flag-gated stubs.

## Drift found and decisions applied (BE-14 follow-up)

| # | Area | Decision | Result |
|---|---|---|---|
| D1 | Step-up transport | Keep `X-Step-Up-Token` on the backend; `Authorization: Bearer` is the access token. | Recorded in ARCH-001 2.4 and OpenAPI. FE task F1: the web step-up adapter (`StepUpOpts`, `requester.bearer`) sends `X-Step-Up-Token` and keeps the access token as Bearer. |
| D2 | Error codes | `SIGNUP_CLOSED`, `METHOD_NOT_ALLOWED`, `UNSUPPORTED_MEDIA_TYPE`, `STORAGE_UNAVAILABLE`, `INTERNAL_ERROR`, `PAYMENT_UNAVAILABLE` ratified as Tier C. | Added to the ARCH-001 2.2 table. FE task F2: add them to `web/src/lib/api/types/error-codes.ts` (and `error-copy.ts`). |
| D3 | Contact idempotency | P11 `Idempotency-Key` stays optional. | ARCH-001 2.5 and OpenAPI amended. |
| D4 | Media DTOs (S07-S12) | Backend reshaped to the web types (see below). `MediaCollection` keeps integer ids. | Done. FE task F3/F4 below. |
| D5 | CMS sections (S01/S02) | Adopt the web wrapped shape. | Done (see below). |
| D6 | S03 draft save result | `savedAt` added; `status` is always `draft`. | Done. |
| D7 | Brand settings revalidation | Keep as is: G08 writes `site/updated` rows for `footer` and `meta` when a public brand contact field changes; the web `public-settings` fetch is tagged `site:meta`, which expires it. There is no dedicated settings tag. | Documented only. |

### D4 media shapes now returned

- Asset: `focal {x,y}`, `status` (`archived` when archived; else `published` when the asset is referenced by any published entity, else `draft`), `usageCount` (uncapped), `usedBy[{kind,id,label,field}]` (capped at 20; `kind` is `event|story|testimonial|site_section|collection`; `site_section` ids are the section key; `collection` ids are integer strings), `uploadedBy {id,name}` (nil UUID, name `System` for seeded assets; new column `MediaAsset.uploaded_by`, migration `content/0010`), `uploadedAt`, `alt` is `null` when unset and `""` when decorative, `credit` is `null` when empty. Also kept: `archivedAt`, `missingAlt`, `contentType`, `sizeBytes`, `filename`, `version`, `updatedAt`.
- "Published" means: a non-draft event (its cover, or its `media`/`archive_gallery` collection items), a published story cover, a published testimonial portrait, or a collection referenced by a published site section.
- S10 PATCH accepts `focal {x,y}` and `status` (`archived` archives; `draft`/`published` unarchive, `published` needs alt or `decorative`, else 422 `NOT_PUBLISHABLE` with `fields.alt`). Legacy `focalX`, `focalY`, `archived` are still accepted. S09 `status` filter accepts `active|archived|all|draft|published`.
- Collection: `items` are asset summaries `{id,src,width,height,alt,decorative,focal}` (was `[{assetId, asset}]`), plus `usageCount` (events using it as media or gallery, plus published site sections referencing its key), `lastChange {by,at,summary}|null` (newest audited change by an admin), `itemCount`, `key`. The list response has no `items`. Item cap stays 50 (web allows 24).
- Collection `id` is an integer primary key as a decimal string; the event builder `media.collectionId` is the same.

### D5 CMS shapes now returned

- S02: `published` and `draft` are `{key,version,updatedAt,content}` (published `version` is the live row version, draft `version` is the draft write token). `draft` is non-null only when there are unpublished edits (`status: draft`); otherwise the editor reads `published`. Top-level `version` is still the draft write token (0 = none), plus `updatedAt` and `lastChange {by,at,summary}|null` (the unpublished edit, else the latest publish with a known actor). Kept for compatibility: `hasUnpublishedChanges`, `publishedAt`, `publishedVersion`, `collections`, `updatedBy`, `changeSummary`.
- `status`: `draft` unpublished edits; `clean` nothing unpublished (a draft equal to live, or no content at all); `published` a live copy never edited.
- S01 rows: `updatedAt` is never null (epoch when the section has neither a live copy nor a draft).
- S03 returns the S02 shape plus `savedAt`, with `status: draft`.

### D8 admin drift fixes (every admin response now parses with the web zod schemas)

- C13 / G04 payments: the row builder (`control_service.payment_rows`) referenced `open_mm`, a local of `list_payments`, so both endpoints raised `NameError` and answered 500 `INTERNAL_ERROR`; the open-mismatch query is now built inside the row builder.
- S02/S03 sections: `published` and `draft` `content` now carry the public shape; every `{collection: key}` reference is resolved to `{mode, autoplay, intervalMs, items}` (was left as the reference). S03 input accepts both the resolved and the reference form; storage keeps the reference form (see D9).
- S05 versions: rows carry `version` (same value as `number`); `publishedBy` is never null (nil actor when unknown).
- S06 legal: `published` and `draft` carry `page`; `updatedAt` is never null (latest of live copy and draft, epoch when neither); `lastChange` added.
- S13 stories (detail, create, update): `slug` is the lock union `{lock: editable, value}` / `{lock: locked, value, lockedAt}`; `collectionId` and `lastChange` added. List rows keep the slug string. S14 results add `publishedAt` (`null` after unpublish).
- S15/S16 testimonials: `portrait` (asset summary or `null`), `lastChange`, and `publishedAt` (published rows) added; S16 results add `at`. `lastChange` for stories and testimonials is read from the audit trail (these rows keep no editor columns).
- S09/S08/S10 media assets: `contentType` is always one of the four accepted types (read from the `src` extension when the row has none) and `sizeBytes` is at least 1.
- S12 collection list rows now include `items` (was only `itemCount`).
- PV01 preview link: `url` is absolute, `FRONTEND_URL` + `/api/draft?token=...` (was relative), because the web type requires an absolute https URL.

### D9 admin write payloads aligned to the web request schemas

Every admin write body was compared with `web/src/lib/api/types/admin/*.ts` and `adapters/real-admin.ts`. Fixed:

- S13 stories: `Story.collection` (nullable FK to `MediaCollection`, migration `content.0011_story_collection`); `collectionId` accepted on create/PATCH (integer key string or `null`) and returned on detail. `coverAssetId` stays accepted (legacy). `slug` is optional on create (a free slug is proposed from the title). PATCH may blank `title`; `publishedOn: null` and `readingMinutes: null` are accepted as "no change" (the columns are never empty). A story collection counts toward the collection's `usageCount` and keeps its assets "published".
- S15 testimonials: web `consent: boolean` (the server stamps `consentAt`; `true` keeps an existing stamp, `false` clears it); legacy `consentAt` still accepted (not both). `name`/`descriptor` are optional on create and may be blanked on PATCH, as is `quote`; publishing now requires `name` and `descriptor` too (`missing`/blockers list them), because the web published schema needs them.
- S03 section draft: accepts the resolved `{mode, autoplay, intervalMs, items}` collection the read returns, as well as `{collection: key}`. A resolved collection is mapped to the collection already referenced at that place, else any collection with identical settings and the same images (items matched by `src`), else a new `MediaCollection` is created in the same transaction (rolled back if validation fails). Unknown `src` is a field error.
- S07: `image/avif` accepted (web enum); fake-storage `uploadUrl` is absolute (`BACKEND_PUBLIC_URL` setting, else the request host). `media_service` `version` accepts 0 (web `writeVersionSchema` is `min(0)`).
- S10 media asset PATCH: `credit: null` clears the credit.
- E04 builder PATCH: `basics.title` may be blank (web `draftText`; readiness still blocks publish). C15 communications PATCH: `triggers: {}` accepted.
- Event builder review fixes (E02-E10, P03/P04):
  - E04: `rated: true` with `pool` in one request no longer 500s. Every rejected field is named in `error.fields` by its exact builder path (`basics.slug` for `SLUG_TAKEN`/`SLUG_LOCKED`, `payment.pricePaise`/`registration.capacity`/... for locked fields, `basics.endsAt`/`gameSystem.pool`/... for model validation errors, mapped from snake_case). Statuses are unchanged (SLUG_* stay 409 per contract 2.2, locked/validation 400). `basics.slug: null` (or `""`) clears a draft slug. An unchanged media collection id is a no-op (no version bump or audit row).
  - Unlimited capacity: `registration.capacity` null (or `""`) means no limit and is no longer a publish blocker. Admin DTOs keep `capacity: null` (web schemas are already nullable). Public `placesLeftHint` is `null`; P04 availability returns state `open`, `placesLeft: 100000` (sentinel, the web schema maximum) and an additive `unlimited: true`. Reserve, waitlist promotion, payment capture and control-room free seats treat null as always free.
  - P03: `media.mode` of the event overrides the collection mode in the public event DTO.
  - Publish blockers added: registration closes no later than the event start (`registration.closesAt`); a set media collection needs one image with alt text or marked decorative (`media.collectionId`).
  - Idempotency-Key is now honoured (optional) on E02, E08 and E10; a replay returns the original result. `core/idempotency.py` no longer purges per call; the scheduled `cleanup_expired` job (48 h retention) covers it.
  - E09 `notifyParticipants` is NOT implemented: it is only recorded in the audit row; no participant message is sent (needs a cancellation email template).
- PV01: story preview links failed with `This item cannot be previewed` (path built as `/storys/<slug>`); now `/stories/<slug>`.
- Compared and already aligned: events create/PATCH/cancel/complete, registration actions, check-in, rounds (generate, pairings, publish, start, result, finalise), messages, recap, players role, refund, reconcile, settings, legal draft, media collections, content block shapes and the five site section shapes.

Not conforming (reported, not changed): the web `httpsUrlSchema` requires `https` for S07 `uploadUrl` and PV01 `url`, so with a local http origin (`FRONTEND_URL`, the request host in fake storage) the web rejects both whatever the backend sends; a dev run needs https origins (set `BACKEND_PUBLIC_URL` and `FRONTEND_URL` to https) or a web-side dev relaxation.

## Frontend tasks (web/ was not touched)

- F1: send the step-up grant as `X-Step-Up-Token` and keep the access token as Bearer.
- F2: add `SIGNUP_CLOSED`, `METHOD_NOT_ALLOWED`, `UNSUPPORTED_MEDIA_TYPE`, `STORAGE_UNAVAILABLE`, `INTERNAL_ERROR`, `PAYMENT_UNAVAILABLE` to `error-codes.ts` and the copy map.
- F3: media `usedBy[].id` for `site_section` is the section key and for `collection` an integer string; relax `mediaUsageSchema.id` from UUID to string. `uploadedBy` for seeded assets is the nil UUID.
- F4: relax the media collection id from UUID to string in `mediaCollectionAdminSchema.id`, and `collectionId` in the event builder media step (and any `mediaCollectionIdSchema` use).
- F5: S04 (CMS publish) returns `status: published`; the web `publishCmsResultSchema` literal is `clean`. Align one side (not covered by the decisions above).
- F6: collection item cap is 50 on the backend, 24 on the web.


## PLAN-010: media simplified to assets only (backend)

- Removed: `GET/POST /api/admin/media/collections`, `GET/PATCH /api/admin/media/collections/{collectionId}` (S12). Assets endpoints (S07-S11) are unchanged; asset `usedBy[].kind` no longer includes `collection` (events, stories, testimonials, site sections only).
- Galleries are private to one owner (event, event archive, story, site-section slot). `MediaCollection` is internal storage (`owner_kind`, `owner_ref`), never exposed. Mode is derived: 1 asset static, 2+ carousel. Cap 50 (`MAX_COLLECTION_ITEMS`). `autoplay` default false, `intervalMs` default 5000 (2000..60000).
- Event builder `media` (E03 read, E04 PATCH): `{assetIds, assets, mode, autoplay, intervalMs}` on read; `{assetIds?, autoplay?, intervalMs?}` on write. `collectionId` and `mode` are no longer accepted. Publish blocker `media.assetIds` when any image lacks alt text and is not decorative.
- Recap (C16): `collectionId` replaced by `assetIds` (read and PATCH), stored as the event archive private gallery.
- Stories (S13): `collectionId` replaced by `media` (`{assetIds, autoplay?, intervalMs?}` in; `{assetIds, assets, mode, autoplay, intervalMs}` out on detail). Publish blocker `media.assetIds` for missing alt.
- Site sections (S02/S03): each image slot is sent as `{assetIds, autoplay?, intervalMs?}`; reads return the public shape plus `assetIds` and `assets`. The `collections` array is removed from the section detail. Publish rejects a draft with an image lacking alt text. A published slot is forked on first draft edit, so the live copy is never mutated before publish.
- Public read API output is unchanged.
- Migrations: `content/0013_private_galleries` (schema), `content/0014_private_galleries_data` (claims each collection for its single owner and clones shared ones per owner; rewrites section `{collection: key}` references).
