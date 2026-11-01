---
id: ARCH-001
type: architecture
feature_id: FEAT-001
version: 2
status: ready
title: "Backend contract and gap matrix: what the new backend must satisfy (companion to ARCH-001-web-frontend)"
changelog:
  - version: 2
    date: 2026-10-22
    changes:
      - "Specify both token modes (body for dev/mock, httpOnly cookie for launch) per OD-01; CSRF header on refresh in cookie mode; absolute lifetime, role re-read, family revocation with grace window, admin session cap and step-up re-auth"
      - "Add negative conformance tests (section 4.6) encoding all 16 legacy defects (L-1 to L-16) as NCT tests with verification steps for TASK-092 suite"
      - "Specify revalidation event id inside HMAC per F-07; per-entity monotonic version counter per OD-06; webhook types include player and result for privacy purge per F-15"
      - "Hardened preview exchange (POST /api/preview/exchange) per F-06: POST with bearer, single-use token, path validation, cookie naming"
      - "Add backend-supplied URL allowlist requirement per F-16: media, checkout, preview, OAuth URLs must resolve to BACKEND_PUBLIC_HOSTS allow-list"
      - "Idempotency header name corrected to Idempotency-Key (title case) per ARCH-001 11.8"
      - "Resolve preview exchange path discrepancy: /api/preview/exchange per rewrite model"
      - "Add inferred tasks for backend PLAN: F-08 slug validation, step-up endpoint if waiver, emergency purge runbook"
context: "The whole codebase, backend included, is being replaced. The frontend is built first against the typed PgApi interface and mocks, so that interface is the executable specification of the new backend. FEAT-000 lists the product features; the legacy Django app is used only to classify what exists today. Whether the new backend extends Django or is rebuilt (FEAT-000 OQ-18) is still open, so this contract is framework-agnostic."
current_state: "Legacy Django REST app (accounts, tournaments, payments, gallery) with about 25 endpoints, UUID-only event ids, no slugs, no envelope, no idempotency, no CMS, no event room, no jobs, and four known security defects. Hosting is decided: Vercel (sin1), Railway Singapore (API, worker, scheduler), Supabase Postgres and Storage in Singapore."
proposed_solution: "Publish one backend contract document that states the cross-cutting conventions (unified envelope, stable error codes, page-number pagination, Idempotency-Key, rotating refresh tokens, integer paise, slugs immutable once published, ISO times with serverNow, capability flags, rate limits, single-origin rewrite), the endpoint catalogue by domain with roles, DTO summaries, state machines and FEAT-000 feature ids, a screen-by-screen gap matrix against the legacy Django code for all 59 screens and states, the webhooks and jobs the backend must run, the security and privacy requirements (including the four known legacy defects, Supabase lockdown and audit log), and a headline-only candidate task list for the separate backend PLAN. The machine-readable form is the TASK-022 export of PgApi; this document is the human-readable companion and wins on intent where the two differ until reconciled."
components:
  - {id: COMP-B01, name: "Platform conventions", responsibility: "Envelope renderer and exception handler, stable error codes, pagination, Idempotency-Key store, request ids, rate limiting, proxy trust", changes: ["New"]}
  - {id: COMP-B02, name: "Auth and accounts", responsibility: "Register, login, rotating refresh tokens with reuse detection, me, password reset, optional Google OAuth, server-owned roles", changes: ["Modified or new"]}
  - {id: COMP-B03, name: "Public projections and CMS publishing", responsibility: "Published site sections, events, stories, testimonials, legal pages, sitemap entries, availability; draft and publish with versions", changes: ["New"]}
  - {id: COMP-B04, name: "Registration and payments", responsibility: "Eligibility, capacity holds, waitlist, Razorpay order, verify, webhook, refund, reconcile, payment ledger", changes: ["New"]}
  - {id: COMP-B05, name: "Event Room and results", responsibility: "Per-player snapshot with capability flags, self check-in, result submit, confirm, dispute", changes: ["New"]}
  - {id: COMP-B06, name: "Pairing and rating engine", responsibility: "Rounds lifecycle, Swiss and balanced social pairing, finalise once, Glicko-2 ledger", changes: ["Modified or new"]}
  - {id: COMP-B07, name: "Admin operations", responsibility: "Dashboard, events and builder drafts, control room, players, payments, settings, audit", changes: ["New"]}
  - {id: COMP-B08, name: "Media and storage", responsibility: "Signed upload URLs, asset and collection records, referenced-asset protection, public-read published media", changes: ["New"]}
  - {id: COMP-B09, name: "Jobs: worker and scheduler", responsibility: "Hold and offer expiry, status transitions, reminders, reconciliation, rating processing, message delivery", changes: ["New"]}
  - {id: COMP-B10, name: "Revalidation outbox and preview exchange", responsibility: "Signed POST to the web app after commit with retries; single-use preview token exchange", changes: ["New"]}
  - {id: COMP-B11, name: "Communications adapter", responsibility: "Stored-then-delivered email with per-recipient state behind a provider adapter", changes: ["Modified or new"]}
  - {id: COMP-B12, name: "Data lockdown", responsibility: "Supabase REST API unreachable, RLS without policies, bucket policies, pooler-compatible access", changes: ["New"]}
data_changes:
  - {type: table, name: "Target model (inferred mapping of DATABASE-SCHEMA)", description: "profiles, user_roles, player_public_profiles, cms_pages, cms_sections, cms_versions, media_assets, media_collections, media_collection_items, testimonials, editorial_stories, navigation_items, site_settings, event_types, events, event_registrations, event_checkins, event_rounds, event_pairings, event_messages, message_deliveries, payment_orders, payments, refunds, payment_webhook_events, rating_profiles, rating_transactions, audit_log, notifications, contact_messages, idempotency_keys, refresh_tokens, revalidation_outbox, legacy_id_map"}
  - {type: migration, name: "Legacy data and region move", description: "Legacy users, tournaments, registrations, rounds, pairings, ratings and gallery photos map into the new model with reconciliation counts and money totals; Supabase Seoul to Singapore is a separate owner-run operation"}
apis:
  - {method: ANY, path: "/api/* (100 catalogue rows, about 114 method and path operations, section 3)", purpose: "Public reads, auth, registration and payments, player area, Event Room, admin events and control room, CMS, media, players, payments, settings, preview link", authentication: "Bearer access token; public reads need none"}
  - {method: POST, path: "/api/webhooks/razorpay", purpose: "Provider webhook, delivered straight to Railway", authentication: "Raw-body signature"}
  - {method: POST, path: "/api/preview/exchange", purpose: "Server-to-server preview token exchange from the web app", authentication: "Shared PREVIEW_SECRET"}
  - {method: POST, path: "{web}/api/revalidate", purpose: "Outbound signed call from the backend to the web app (owned by the web app)", authentication: "HMAC-SHA256 per ARCH-001 section 9"}
integrations:
  - {name: "Razorpay", purpose: "Orders, payment fetch, refunds, webhooks", failure_mode: "Registration stays pending with an expiring hold; webhook and reconcile job converge state; mismatches shown to admins, never silently fixed"}
  - {name: "Vercel web app", purpose: "Receives signed revalidation calls; rewrites /api/* to the API", failure_mode: "Outbox retries up to 5 times; the 15-minute safety net on the web side heals a miss"}
  - {name: "Supabase Postgres and Storage", purpose: "Data via pooler, media objects", failure_mode: "API returns 5xx envelope; web keeps serving the previous good ISR page"}
  - {name: "Email provider", purpose: "Transactional and event email", failure_mode: "Message stored first, per-recipient failure recorded and retried"}
security:
  authentication: "Short-lived access token, single-use rotating refresh token with reuse detection, role read from the database on every privileged request"
  authorization: "Server-owned roles, object-level checks on every player and admin endpoint, capability flags returned to the UI, price and capacity never taken from the browser"
  threats:
    - "Anonymous access to registration lists and player PII (legacy defect)"
    - "Double rating of a round (legacy defect)"
    - "Payment accepted on signature alone (legacy defect)"
    - "State change inside a GET (legacy defect)"
    - "Forged or replayed Razorpay webhook"
    - "Direct access to Supabase REST API with the public anon key"
    - "Stale role claim in a long-lived access token"
  mitigations:
    - "Public projections separate from admin DTOs; admin-only registration endpoints"
    - "ratings_processed_at gate plus unique ledger key inside one transaction"
    - "Fetch payment from Razorpay and check order id, exact amount, currency and status before confirming"
    - "Scheduler owns status transitions; GET is read-only"
    - "Raw-body signature check and provider event id dedupe"
    - "RLS enabled with no policies on every table, or the Data API disabled; CI check"
    - "Role checked from the database for admin endpoints"
observability:
  logs:
    - "Request id on every response and log line; webhook receipt, outcome and provider event id; revalidation attempts; job runs"
  metrics:
    - "Webhook failures, hold expiries, revalidation retries, rating job duration, 5xx rate, 429 rate"
  traces:
    - "meta.request_id equals the X-Request-ID header"
  alerts:
    - "Payment or webhook failure, reconcile mismatch count above zero, revalidation delivery exhausted, rating job failure"
performance:
  expected_load: "Modest community traffic; event-day bursts of tens to low hundreds of Event Room pollers"
  latency_requirements: "Availability and Event Room snapshot are cheap indexed reads; snapshot polled every 5 to 30 seconds per client"
  scalability: "Stateless API on Railway; worker and scheduler are separate services; Postgres through the transaction-mode pooler"
migration:
  required: true
  strategy: "Build the new backend to this contract; migrate legacy data with reconciliation; cut over only after the owner approval gate (PLAN-001 TASK-106)"
  rollback: "Legacy backend stays untouched and read-only until sign-off; legacy ids kept in legacy_id_map"
risks:
  - {id: RISK-B01, description: "Contract drift between this document, the PgApi export and the real backend", severity: high, mitigation: "TASK-022 export is machine-readable truth; TASK-092 conformance suite runs against CONTRACT_BASE_URL"}
  - {id: RISK-B02, description: "OQ-18 unresolved while the contract assumes capabilities Django does not have today", severity: medium, mitigation: "Framework-agnostic wording; gap matrix shows the delta either way"}
  - {id: RISK-B03, description: "Money and capacity races (hold, webhook, expiry, waitlist offer)", severity: high, mitigation: "Single atomic reserve function, idempotency keys, provider-state reconcile, explicit late-capture rule"}
  - {id: RISK-B04, description: "Missed or duplicated revalidation after scheduler-driven state changes", severity: medium, mitigation: "Transactional outbox, same event id on retry, safety net on the web side"}
  - {id: RISK-B05, description: "Additional error codes and DTO naming proposed here are not yet in the frontend copy map", severity: medium, mitigation: "Marked inferred; frontend degrades to HTTP fallback copy; owner and architect to ratify"}
decisions:
  - {id: DEC-B01, decision: "Contract is framework-agnostic and expressed as PgApi plus the HTTP conventions in section 2", rationale: "OQ-18 is open and hosting works either way", alternatives: ["Assume Django", "Assume a rebuild"]}
  - {id: DEC-B02, decision: "Page-number pagination in meta.pagination for all lists", rationale: "Matches DEC-011 EnvelopePageNumberPagination and the lists here are small (inferred)", alternatives: ["Cursor pagination"]}
  - {id: DEC-B03, decision: "Data keys camelCase, envelope keys snake_case", rationale: "Matches ARCH-001 DTO examples and DEC-011 (inferred convention)", alternatives: ["All snake_case", "All camelCase"]}
  - {id: DEC-B04, decision: "Payment and registration state change only through provider events, verify, refund and cancel endpoints", rationale: "Legacy admin PATCH could mark a payment paid with no ledger", alternatives: ["Keep admin override"]}
assumptions:
  - "ARCH-001-web-frontend sections 9, 11, 12 and 20 are approved as written and not reopened here"
  - "FEAT-001 owner-approved defaults of 2026-10-21 stand (OQ-01 story pages, OQ-02 results flow, OQ-03 draftMode, OQ-09 hidden features)"
  - "Items marked inferred are proposals for the owner and the backend PLAN, not decisions"
open_decisions:
  - "OQ-18 extend Django or rebuild (owner and architect)"
  - "Final DTO field names come from the TASK-016, 017 and 022 export"
  - "Additional error codes in section 2.2 tier C need frontend copy"
  - "Preview exchange base path discrepancy (section 3.10)"
  - "Hold length, waitlist offer window, refund rules, late-capture rule (FEAT-000 OQ-07, OQ-08; FEAT-001 OQ-17)"
---

# Architecture: Backend Contract and Gap Matrix

**ID:** ARCH-001 (companion document; main document is `docs/architecture/ARCH-001-web-frontend.md`)
**Type:** architecture
**Feature:** FEAT-001 (`docs/requirements/FEAT-001-frontend-rewrite.md`), inventory FEAT-000 (`docs/requirements/FEAT-000-feature-inventory.md`)
**Plan:** PLAN-001, TASK-004
**Version:** 1
**Status:** ready (schema-valid and complete; pending owner review, no agent may approve)
**Date:** 2026-10-22
**Author:** architect

How to read this: section 2 holds the conventions every endpoint obeys. Section 3 is the endpoint catalogue (the "what"). Section 4 is the gap matrix (legacy delta per screen). Sections 5 and 6 are what runs without a screen (webhooks, jobs, security). Section 7 is a headline task list for the separate backend PLAN; it carries no estimates and no ordering. Anything not stated in a source document is marked **(inferred)**.

Contents:

1. Purpose and how to use
2. Conventions
3. Endpoint catalogue
4. Gap matrix (59 screens and states)
5. Webhooks and jobs
6. Security and privacy requirements
7. Candidate backend task list (handoff)
8. Open questions and discrepancies


## 1. Purpose and how to use

**What this is.** The contract the new backend must satisfy so that the Next.js app in `web/` works unchanged when the mock adapter is replaced by the real one. It is derived from the screens, from FEAT-000 (features), ARCH-001-web-frontend sections 4, 9, 11, 12, 20, 22 and 23, and the reference documents in `Frontend reference/docs/`. The legacy Django code was read only to classify what exists today (section 4).

**Executable form.** The frontend `PgApi` interface (`web/src/lib/api/pg-api.ts`), its zod DTOs and the mock fixtures are the executable form of this contract. TASK-022 exports them to `docs/architecture/pgapi-contract/` (JSON Schemas, one example per state, error codes, envelope, webhook payload). TASK-092 turns that export into a conformance suite that can be pointed at `CONTRACT_BASE_URL`. Precedence: the export wins on field names and shapes once it exists; this document wins on intent, behaviour, security and state rules. A mismatch is a defect in one of the two and is fixed, not worked around.

**Framework-agnostic (OQ-18 open).** Nothing here assumes Django, FastAPI or any framework. Section 4 states the delta from today's Django app so the owner and backend planner can judge "extend" versus "rebuild"; it does not choose. Observation (not a decision): most screens need new capability regardless of framework; the legacy code contributes mainly auth, a Swiss generator and a Glicko-2 implementation, and the latter two are unverified (FEAT-000 F-PAIR-002, F-RATE-002).

**Out of scope here.** Backend task ordering, estimates and detailed planning (a separate PLAN). Frontend internals. The ISR and revalidation detail (TASK-113 extracts ARCH-001 section 9; this document only points to it). Features hidden at launch by FEAT-001 OQ-09 (rematch, member/comp/donation pricing, WhatsApp/SMS, waivers): the contract leaves room for them but does not require them at launch.

**Reading conventions.** `F-xxx` are FEAT-000 feature ids. Role is `public` (no token), `player`, or `admin`. Paths are relative to the API base; the browser reaches them as `/api/...` through the Vercel rewrite, so every path below omits the `/api` prefix. DTO names are the `PgApi` names where ARCH-001 gives them and are **(inferred)** otherwise.

**Counts.** 59 screens and states: the 58 reference screens plus story detail (FEAT-001 row 59). Screens 12, 57 and 58 need no backend data; they appear in the matrix for completeness.

## 2. Conventions

### 2.1 Envelope (DEC-011, approved 2026-09-15)

Every response under `/api/` (except 204/205 and the inbound Razorpay webhook) is:

```json
{ "success": true, "message": "optional", "data": {}, "error": null,
  "meta": { "request_id": "uuid", "timestamp": "2026-10-22T10:00:00+05:30", "pagination": null } }
```

On failure: `success=false`, `data=null`, `error={ code, detail, fields, retry_after }`. `fields` is `{ "fieldName": ["message"] }`. `retry_after` is seconds or null. `meta.request_id` equals the `X-Request-ID` response header. `meta.pagination` is present only on lists. The frontend tolerates the legacy bare shape during transition only (ARCH-001 11.2); the new backend must not emit it. Keys inside `data` are camelCase **(inferred; follows the ARCH-001 examples `placesLeft`, `serverNow`, `holdExpiresAt`)**; envelope keys stay snake_case as in DEC-011.

### 2.2 Stable error codes

The frontend copy map must hold a key for every code the backend can emit. Tier A is the 15 codes of `BACKEND-CONTRACT.md`. Tier B are transport fallbacks owned by the frontend (ARCH-001 11.7). Tier C are **inferred additions** the endpoints below need; they need frontend copy (TASK-014) and ratification. Until ratified the frontend falls back to HTTP-status copy, so adding a code is backward compatible.

| Tier | Code | HTTP | Meaning |
|---|---|---|---|
| A | AUTH_REQUIRED | 401 | No, expired or invalid access token; failed refresh |
| A | ADMIN_REQUIRED | 403 | Authenticated, not admin |
| A | EVENT_NOT_FOUND | 404 | Unknown, unpublished or draft event slug or id |
| A | REGISTRATION_NOT_OPEN | 409 | Window not open yet |
| A | REGISTRATION_CLOSED | 409 | Window closed, event cancelled or completed |
| A | EVENT_FULL | 409 | Capacity reached and no waitlist |
| A | ALREADY_REGISTERED | 409 | Active registration or waitlist entry exists |
| A | PAYMENT_REQUIRED | 402 | Action needs a paid, confirmed registration |
| A | PAYMENT_MISMATCH | 409 | Provider order id, amount, currency or status differs from the server order |
| A | INVALID_SIGNATURE | 400 | Checkout or webhook signature invalid |
| A | CHECKIN_WINDOW_CLOSED | 409 | Outside the check-in window |
| A | REGISTRATION_NOT_CONFIRMED | 409 | No confirmed registration |
| A | ROUND_NOT_FOUND | 404 | Unknown round |
| A | RESULTS_NOT_FINAL | 409 | Finalise with results not final |
| A | ROUND_ALREADY_FINALIZED | 409 | `ratings_processed_at` already set (replay with the same key returns the original success, see 2.5) |
| B | HTTP_400/401/403/404/429/5XX, NETWORK, TIMEOUT, BAD_RESPONSE, MOCK_SERVER_MUTATION | | Frontend-originated; the backend must not reuse these names |
| C | VALIDATION_FAILED | 400 | Field errors in `error.fields` |
| C | RATE_LIMITED | 429 | With `retry_after` and `Retry-After` |
| C | INVALID_CREDENTIALS | 401 | Login failure, neutral text |
| C | EMAIL_TAKEN | 409 | Sign-up with an existing email |
| C | WEAK_PASSWORD | 400 | Below policy (FEAT-000 OQ-13) |
| C | RESET_TOKEN_INVALID | 400 | Reset token bad, used or expired |
| C | HOLD_EXPIRED | 409 | Order or verify against an expired hold |
| C | SLUG_TAKEN | 409 | Duplicate slug on check or publish |
| C | SLUG_LOCKED | 409 | Slug change after publish |
| C | VERSION_CONFLICT | 409 | Save with a stale `version` (F-ACMS-003) |
| C | NOT_PUBLISHABLE | 422 | Publish blocked; `blockers[]` or `fields` explain |
| C | ASSET_IN_USE | 409 | Delete of a referenced media asset (F-ACMS-007) |
| C | NOT_FOUND | 404 | Any other missing entity |
| C | IDEMPOTENCY_CONFLICT | 422 | Same key, different body |
| C | RESULT_NOT_ALLOWED | 403 | Capability flag false for submit, confirm or dispute |
| C | CANCELLATION_NOT_ALLOWED | 409 | Outside the cancellation policy |
| C | SIGNUP_CLOSED | 403 | Register while admin setting `auth.signupOpen` is false (ratified BE-14) |
| C | METHOD_NOT_ALLOWED | 405 | Known `/api/*` path, unsupported method (ratified BE-14) |
| C | UNSUPPORTED_MEDIA_TYPE | 415 | Request body is not `application/json` (ratified BE-14) |
| C | STORAGE_UNAVAILABLE | 503 | Media storage unreachable or answered unexpectedly (ratified BE-14) |
| C | INTERNAL_ERROR | 500 | Unhandled server error; no detail is exposed (ratified BE-14) |
| C | PAYMENT_UNAVAILABLE | 503 | Payment provider unreachable or not configured (ratified BE-14) |

**Ratified BE-14 (FE task):** the six codes above are Tier C. The web must add them to `web/src/lib/api/types/error-codes.ts` and `error-copy.ts`; until then the web falls back to HTTP-status copy.

### 2.3 Pagination

Page-number, matching DEC-011: query `page` (1-based, default 1) and `page_size` (default 20, max 100). `meta.pagination = { page, page_size, total, total_pages }` **(inferred names)**. Unbounded lists are not allowed except those marked "bounded" in section 3 (nav items, testimonials, settings groups, an event's rounds). Legacy had no pagination (F-NFR-012).

### 2.4 Authentication and token semantics (ARCH-001 section 12, owner-accepted)

**Token mode selection (OD-01).**  The contract specifies two token modes to ensure the frontend change stays inside `browser/tokens.ts` and backend service decisions are independent. Mode is selected at deploy time; the frontend receives the token in both modes and handles storage and refresh respectively.

| Item | Dev/mock mode | Launch mode (required) |
|---|---|---|
| **Transport** | Body: `{ accessToken, refreshToken }` on login/refresh/exchange | **Cookie: `__Secure-pg_rt` (httpOnly, Secure, SameSite=Strict, Path=/api/auth)** |
| **Access token** | Bearer, 5 to 15 min, in-memory only. Carries user id; role read from DB per 6.2 | Same |
| **Refresh token** | Single use, rotating, in body `POST /auth/refresh`; frontend stores in `localStorage` pg:auth:v1 | Single use, rotating, in httpOnly cookie. **CSRF header check required: frontend must send `X-CSRF-Token: <access-token>` on refresh** (the header authenticates the same-origin request). Cookie always sent by browser; header is custom and requires a script. |
| **Rotation** | Each refresh returns `{ accessToken, refreshToken }` pair; presented token invalidated immediately | Same; server must set the new cookie |
| **Reuse detection** | Presenting an already-used token revokes the whole family and returns `AUTH_REQUIRED`. Tolerate a replay of the same token within 10 seconds (grace window), returning the same new pair **(protects flaky venue networks)**. If reuse is detected outside the grace window, revoke the family and return `AUTH_REQUIRED` with reason `REFRESH_REUSED`. | Same |
| **Absolute lifetime** | 14 days sliding (legacy value, kept for mock; backend decides) | **14 days absolute** (no sliding on each refresh). On expiry all refreshes fail with `AUTH_REQUIRED` and a `SESSION_EXPIRED` reason. |
| **Logout** | `POST /auth/logout` with refreshToken in body; revokes family server-side before frontend clears localStorage | `POST /auth/logout` with no body; server revokes the family via the cookie; succeeds even if already revoked |
| **Role and status re-read** | On every refresh (or at most every 5 min with a server-side cache per user), check the database for role and account status changes. If demoted or suspended, return `AUTH_REQUIRED` with reason `ROLE_CHANGED` or `ACCOUNT_SUSPENDED`. | Same |
| **Password reset** | Request returns 200 (neutral) for any email; confirm takes `{ token, newPassword }`, token single use and 1 hour expiry. On confirm, revoke all refresh families for the user. | Same |
| **Admin session cap and step-up re-auth** | When launching with a waiver (OD-01): admin refresh tokens must have absolute lifetime of 12 hours or less. On access to refund, role change or data export endpoints, backend must require a step-up via `POST /auth/step-up { password }` returning a fresh access token valid for 5 minutes for that one operation. Error code: `STEP_UP_REQUIRED` (401). Step-up flow: frontend detects 401 with that code and prompts for password, retries the original request with the new token, then discards it. **Transport (decided BE-14): the grant is sent in the `X-Step-Up-Token` request header; `Authorization: Bearer` stays the normal access token on the same call. FE task: the web step-up adapter (`StepUpOpts`, `requester`) must send `X-Step-Up-Token` instead of replacing the Bearer token.** | Same if launched with localStorage waiver; remove entirely if launch mode active. |
| **Google OAuth** | Flagged. Backend-mediated PKCE: `GET /auth/oauth/google/start` returns `{ url }`; callback completes server-side and redirects to `/auth/callback?code=<one-time-code>`. `POST /auth/oauth/exchange { code }` returns token pair (body or cookie mode matching above). No provider tokens stored. Linking rule open (FEAT-000 OQ-12). Endpoints **inferred**. | Same |

### 2.5 Idempotency (ARCH-001 section 11.8)

Header `Idempotency-Key: <uuid v4>` is **required** on: registration reserve/confirm/waitlist, order creation, payment verify, result submission, and admin finalise, publish, refund and message send. Optional elsewhere. **Contact submit (P11) is optional (decided BE-14): the honeypot and the per-IP limit protect it; a sent key is still honoured.** Rules: the server stores scope (user or anonymous), key, method and path, request hash and response for at least 24 hours; a repeat with the same key and body returns the original status and body with header `Idempotent-Replay: true`; the same key with a different body returns `IDEMPOTENCY_CONFLICT`; a missing required key returns `VALIDATION_FAILED` with `fields.idempotencyKey`. **Header name is `Idempotency-Key` (title case), not `x-idempotency-key`.**  Finalise is additionally idempotent by state (`ratings_processed_at`).

### 2.6 Money

Integer paise plus `currency: "INR"` (`pricePaise`, `amountPaise`). The browser never sends price, amount or currency (AC-35). Legacy used decimal rupees (`entry_fee`, F-NFR-007).

### 2.7 Ids and slugs

- Entity ids are UUIDs and internal. Signed-in and admin routes use the event UUID (`/app/events/{id}`, FEAT-001 OQ-06 default).
- `slug` exists on **events and stories**. Legal pages and site sections use fixed keys (`privacy`, `terms`, `refund-policy`; `home`, `community`, `nav`, `footer`, `meta`). Regex `^[a-z0-9]+(-[a-z0-9]+)*$`, 3 to 80 characters **(length inferred)**, unique per type, case-insensitive.
- **Immutable once published** (FR-03, D-03). Drafts may change slug and have no public URL. After first publish a change returns `SLUG_LOCKED`; unpublishing does not unlock it. Cancelled and completed events keep their slug and URL (FEAT-001 OQ-08).
- Collision: the server never auto-suffixes silently on publish. `GET /admin/slugs/check` reports availability and a suggested free alternative; the builder suggests from the title and calls it.
- Unpublished and draft slugs return 404 on public reads with no hint they exist (FR-04).
- Correcting a mistaken slug after publish has no UI path (FEAT-001 OQ-15); any operator procedure and redirect is the backend PLAN's call (FEAT-000 OQ-24).

### 2.8 Time

ISO 8601 with offset (`+05:30`). Responses that drive a countdown or window carry `serverNow` (Event Room snapshot, availability, registration hold, check-in). Store UTC; display zone `Asia/Kolkata` is a frontend concern. Dates without time (`birthday`) are `YYYY-MM-DD`.

### 2.9 Capability flags

State-dependent permission is computed by the server and returned; the UI never infers who may act (FEAT-001 OQ-02, ARCH-001 11.1).

- Event Room snapshot: `capabilities: { canCheckIn, canSubmitResult, canConfirmResult, canDispute, canContactHost }` and `result: { state: 'none'|'submitted'|'awaiting_confirmation'|'final'|'disputed', submittedBy?: 'me'|'opponent'|'host' }`.
- Admin resources: `capabilities` (for example `canFinalise` with `blockers: [{ code, reason }]` on a round; `canPublish`, `canRefund`, `canCancel` on event and payment rows) and `lockedFields: string[]` on an event that has registrations (FEAT-001 OQ-07 default: price, capacity reduction, game system). Every disabled control needs a text reason from the server (AC-84).
- The registration state resolver returns the computed state (3.3).

### 2.10 Rate limits

Return 429 with `RATE_LIMITED`, `error.retry_after` and a `Retry-After` header. Launch starting points **(inferred, tunable)**: login and register 10 per minute per IP and 5 per minute per email; password-reset request 3 per hour per email and 10 per hour per IP; refresh 30 per minute per token family; contact 3 per hour per IP; Event Room snapshot 12 per minute per user (client polls no faster than 5 s); privileged admin commands 60 per minute per admin. Public reads are CDN-friendly and lightly limited. Derive the client IP only from the trusted proxy chain Vercel then Railway; the rewrite hides the browser IP unless forwarding is configured (confirm in TASK-115).

### 2.11 CORS and the rewrite

The browser calls same-origin `/api/*`; Vercel rewrites to Railway (`afterFiles`), so the web app needs **no CORS**. The backend must not depend on `Origin`. Allow-list CORS only for explicit needs (local dev against a remote backend, the conformance suite), never `*` with credentials. Inherited constraints (ARCH-001 12.7): proxied bodies stay small (media uploads go direct to Storage by signed URL); requests finish well inside the Vercel function limit (confirm in TASK-115); server-side public fetches use `API_INTERNAL_URL`, send no cookies or tokens. The Razorpay webhook and the revalidation call do **not** pass through the rewrite.

### 2.12 Caching headers

Public read endpoints: `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` **(inferred; the web layer is the authoritative cache)**. Availability, Event Room snapshot, `me` and every player and admin response: `no-store`. Preview responses: `private, no-store`.

## 3. Endpoint catalogue

**How to read.** One row per endpoint. `IK` = `Idempotency-Key` required (2.5). Request/response names are `PgApi` DTOs (inferred where ARCH-001 does not name them); all responses use the envelope (2.1) and lists use 2.3. "SM" points to a state machine in `Frontend reference/docs/STATE-MACHINES.md`: **E** event, **R** registration, **PO** payment order, **RD** round, **PR** pairing result, **CMS** page/story (draft to published). Screens use the FEAT-001 numbers (59 = story detail). Every endpoint not marked `public` returns `AUTH_REQUIRED` without a valid token; every `admin` endpoint returns `ADMIN_REQUIRED` for a non-admin and is audited when it mutates (6.5).

### 3.1 Public reads (role: public, cacheable per 2.12 except where noted)

| ID | Endpoint | Request, response | SM | Features | Screens |
|---|---|---|---|---|---|
| P01 | GET /site/{section} (`home`, `community`, `nav`, `footer`, `meta`) | `SiteSectionDto` published only: typed fields, resolved media collections, `version`, `updatedAt`. Nav and footer are fetched by every public page. | CMS | F-PUB-001, 006, 010, 012; F-SEO-002 | 1, 6, 1-11 |
| P02 | GET /events | Query `q`, `type`, `audience` (beginner, solo), `free`, `city`, `page`. `Page<EventCardDto>`: slug, title, promise, starts/ends, area, format, `pricePaise`, status, first-timer count, `placesLeftHint`, cover media. Published upcoming only; cancelled, draft and completed excluded (OQ-08). | E | F-PUB-002, 011 | 1, 2 |
| P03 | GET /events/{slug} | `EventDetailDto`: essentials, logistics, FAQ, venue address, media collection, mode inputs (`registrationState`, window times), cancelled notice; for completed events also standings, winner, recap, gallery when the archive is published. 404 `EVENT_NOT_FOUND` for draft or unpublished. | E | F-PUB-003, 004, 011, 012; F-SEO-003, 006; F-EVT-015, 016; F-PROF-005 | 3, 4 |
| P04 | GET /events/{slug}/availability | `AvailabilityDto { state, placesLeft, waitlistOpen, serverNow }`, `no-store`, tiny, no auth. `state` is one of open, full_waitlist, sold_out, closed, not_yet_open, completed, cancelled. | E | F-REG-001; F-PUB-011 | 3 |
| P05 | GET /past-events | Query `q`, `type`, `page`. `Page<EventCardDto>` of completed events with `archivePublished` flag. | E | F-PUB-005 | 5 |
| P06 | GET /stories | Query `page`. `Page<StoryCardDto>`: slug, kind, title, dek, date, reading time, featured, cover. | CMS | F-PUB-007, 012 | 7, 1 |
| P07 | GET /stories/{slug} | `StoryDetailDto` with a closed block model (heading, paragraph, quote, image, list, link), no HTML. | CMS | F-PUB-008 | 59 |
| P08 | GET /testimonials | `TestimonialDto[]` published only, bounded, sorted; quote, name, descriptor, portrait. | CMS | F-PUB-009 | 1 |
| P09 | GET /legal/{page} (`privacy`, `terms`, `refund-policy`) | `LegalPageDto`: title, blocks, `effectiveDate`, `version`. | CMS | F-LEG-001; F-PAY-008 | 9, 10, 11 |
| P10 | GET /sitemap-entries | `SitemapEntryDto[]` `{ type, slug or path, updatedAt, cancelled? }`; `page_size` up to 1000 (inferred). | - | F-SEO-004 | no UI |
| P11 | POST /contact | `IK`. `{ name, email, topic, message }`. 202. Rate limited (2.10); destination from settings; honeypot or equivalent spam control (inferred). | - | F-CON-001 | 8 |
| P12 | GET /settings/public | **Inferred.** Non-secret contact config: support email, WhatsApp or phone link for "Message event desk", social URLs, default city. Could instead ride inside P01 `footer`/`meta`; ratify in the PgApi export. | - | F-CON-002; F-EVT-014 | 8, 24-29 |

### 3.2 Authentication and session (ARCH-001 section 12)

| ID | Endpoint | Request, response | SM | Features | Screens |
|---|---|---|---|---|---|
| A01 | POST /auth/register | `{ name, email, password, optional profile fields }` to `{ user: MeDto, accessToken, refreshToken }`. Creates private profile, public-profile stub, `player` role in one transaction. `EMAIL_TAKEN`, `WEAK_PASSWORD`, field errors. | - | F-AUTH-001, 008 | 14 |
| A02 | POST /auth/login | `{ email, password }` to the same triple. `INVALID_CREDENTIALS` is neutral. | - | F-AUTH-002 | 13 |
| A03 | POST /auth/refresh | `{ refreshToken }` to `{ accessToken, refreshToken }`; rotation and reuse detection per 2.4. | - | F-AUTH-003 | no UI |
| A04 | POST /auth/logout | `{ refreshToken }`; revokes the family; always succeeds. | - | F-AUTH-002 | all signed-in |
| A05 | GET /auth/me | `MeDto`: id, name, email, **role**, `profileComplete`, onboarding flags, city, ratings summary. Role comes from the server. `no-store`. | - | F-AUTH-007 | 13-17, guards |
| A06 | POST /auth/password-reset | `{ email }`; identical 200 for known and unknown email; rate limited. | - | F-AUTH-004 | 16 |
| A07 | POST /auth/password-reset/confirm | `{ token, newPassword }`; single use. `RESET_TOKEN_INVALID`. Revokes existing refresh families (inferred). | - | F-AUTH-004 | 16 |
| A08 | GET /auth/oauth/google/start | Flag-gated. Returns `{ url }` (PKCE state held server side). | - | F-AUTH-005 | 13, 14 |
| A09 | POST /auth/oauth/exchange | Flag-gated. `{ code }` to token triple; used by the callback screen for success, `AUTH_REQUIRED` or a reasoned failure. | - | F-AUTH-005, 006 | 15 |
| A10 | GET /auth/oauth/google/callback | Flag-gated provider redirect target on the API origin; validates state, creates or links the account, redirects the browser to the web `/auth/callback?code=...`. Not called by the frontend code directly. | - | F-AUTH-005 | 15 |

### 3.3 Registration and payments (role: player unless stated)

Rule of ownership (BACKEND-CONTRACT): the browser sends intent (event slug, registration id, Razorpay callback fields). The server derives user, price, capacity, window, hold, payment state. The split of the reference `create-payment-order` command into reserve plus order is **inferred**; a backend may expose them as one call if the response carries both the hold and the order.

| ID | Endpoint | Request, response | SM | Features | Screens |
|---|---|---|---|---|---|
| R01 | GET /events/{slug}/registration | Resolves the state for this player: `RegistrationStateDto` discriminated union `open_free`, `open_paid`, `full_waitlist`, `sold_out`, `closed`, `not_yet_open`, `already_registered { registration }`, `ineligible { reason }`, plus `requiredProfileFields[]`, `pricePaise`, `serverNow`. Never exposes other players. | R, E | F-REG-001, 008; F-PROF-002 | 18-21 |
| R02 | POST /registrations | `IK`. `{ eventSlug, profile? }`. Atomic window, capacity, eligibility and duplicate check. Free event: returns `confirmed`. Paid: creates `pending` registration with a capacity hold, returns `{ registration, holdExpiresAt, serverNow }` (no money taken). Errors: `REGISTRATION_NOT_OPEN`, `REGISTRATION_CLOSED`, `EVENT_FULL`, `ALREADY_REGISTERED`, `EVENT_NOT_FOUND`. | R | F-REG-001, 002, 003, 008, 011 | 18, 19, 21 |
| R03 | POST /registrations/waitlist | `IK`. `{ eventSlug }`. Joins the waitlist when the event is full and waitlist is on; returns `{ registration, position }`. Full without waitlist: `EVENT_FULL`. | R | F-REG-005 | 20 |
| R04 | POST /payments/orders | `IK`. `{ registrationId }`. Requires a live hold (`HOLD_EXPIRED` otherwise). Creates or returns the single Razorpay order from the **server** price: `{ orderId, amountPaise, currency, keyId, holdExpiresAt, serverNow }`. Amount, currency and key come only from this response. | PO, R | F-PAY-001, 002; F-REG-008 | 18 |
| R05 | POST /payments/verify | `IK`. `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }` (names kept from Razorpay). Server resolves order and user, verifies the checkout signature, **fetches the payment from Razorpay** and checks order id, exact amount, currency and status, writes the payment ledger, confirms the registration. Returns `{ registration }` with state `confirming` or `confirmed`. Errors: `INVALID_SIGNATURE`, `PAYMENT_MISMATCH`, `HOLD_EXPIRED`. | PO, R | F-PAY-003 | 18, 21 |
| R06 | GET /registrations/{registrationId} | Owner only. `RegistrationDto` with payment and refund state (`created`, `attempted`, `paid`, `failed`, `expired`, `refunded`), `holdExpiresAt`, waitlist position. Polling-safe, `no-store`. Drives "confirming payment" and the return-after-closing-the-tab case. | R, PO | F-REG-004; F-PAY-010 | 18, 21, 23 |
| R07 | POST /registrations/{registrationId}/cancel | `IK` optional. Applies the event cancellation policy, releases capacity, starts a refund when due. `CANCELLATION_NOT_ALLOWED`. Rules open (FEAT-000 OQ-07). | R, PO | F-REG-007; F-PAY-008 | 23 |
| R08 | POST /registrations/{registrationId}/accept-offer | `IK`. Accepts a waitlist promotion inside the offer window; creates the hold (paid) or confirms (free). Offer window open (OQ-08, default 2 h). **Inferred** endpoint. | R | F-REG-006 | 20, 23 |
| W01 | POST /webhooks/razorpay (inbound, not a PgApi method) | Raw-body signature check, dedupe by provider event id, reconcile `captured`, `failed`, `refunded`. Delivered straight to Railway. Detail in section 5. | PO, R | F-PAY-004 | no UI |

Add-to-calendar (F-PLY-005) is generated by the frontend from event data (FR-29); no endpoint. A server `.ics` endpoint is not required (inferred).

### 3.4 Player area (role: player; `no-store`)

| ID | Endpoint | Request, response | SM | Features | Screens |
|---|---|---|---|---|---|
| M01 | GET /me/next-up | `NextUpDto`: next confirmed event, where and when, what to do now, board, opponent, colour if published; or null (empty state). | R, RD | F-PLY-001; F-EVT-003 | 22 |
| M02 | GET /me/recent-games | `Page<GameDto>` (small): opponent public name, result, rating delta. | PR | F-PLY-003 | 22 |
| M03 | GET /me/people | Opponents played most, with public identity only. Rematch actions hidden at launch (OQ-09). | - | F-PLY-003, 004 | 22 |
| M04 | GET /me/registrations | Query `scope=upcoming\|history`, `page`. `Page<MyRegistrationDto>` with registration, payment and refund state, event link data (slug and id), waitlist position, `canCancel`. | R, PO | F-PLY-002; F-PAY-010 | 23 |
| M05 | GET /me/events/{eventId}/room | **Event Room snapshot**: `roomState` (`before_checkin`, `checkin_open`, `pairing_pending`, `live_round`, `between_rounds`, `complete`), `serverNow`, window times, check-in status incl. manual-check-in-required, current published round and **my** pairing only (board, opponent public identity, colour, time control), `result` and `capabilities` (2.9), running standings (public), score and place, rating processing state and delta once processed, version marker for cheap change detection. Only the caller's own pairing is returned. `REGISTRATION_NOT_CONFIRMED` if not confirmed. | R, RD, PR | F-EVT-003, 008, 011, 012, 013, 015 | 24-29 |
| M06 | POST /me/events/{eventId}/check-in | `IK` optional. Requires confirmed registration and window open: `CHECKIN_WINDOW_CLOSED`, `REGISTRATION_NOT_CONFIRMED`. Default window 30 min before start (FEAT-000 OQ-09). Returns the new snapshot fragment. | R | F-EVT-004 | 24, 25 |
| M07 | POST /me/events/{eventId}/results | `IK`. `{ pairingId, outcome }` (`white`, `black`, `draw`). Allowed only if `capabilities.canSubmitResult`; else `RESULT_NOT_ALLOWED`. Result goes `pending` to `submitted`. | PR | F-EVT-009 | 27 |
| M08 | POST /me/events/{eventId}/results/{pairingId}/confirm | `IK` optional. Opponent or host confirms: `submitted` to `final`. | PR | F-EVT-010 | 27 |
| M09 | POST /me/events/{eventId}/results/{pairingId}/dispute | `IK` optional. `{ note? }`. `submitted` to `disputed`; admin resolves (A-area). | PR | F-EVT-010 | 27 |
| M10 | GET /me/ratings | Pools `blitz`, `rapid`, `classical`: rating, RD, volatility not exposed, `games`, `provisional` flag (threshold open, OQ-10), last change. Public visibility respected for others, not for self. | - | F-RATE-001, 005, 006, 007 | 22, 30 |
| M11 | GET /me/ratings/{pool}/ledger | `Page<LedgerEntryDto>` (round or game, opponent public name, before, after, delta, event link). Append-only source. | - | F-RATE-003, 007 | 29, 30 |
| M12 | GET /me/ratings/{pool}/trend | Query `days` (default 90). Series `[{ at, rating }]`, bounded. | - | F-RATE-007 | 30 |
| M13 | GET /me/profile | `ProfileDto`: private fields (name, city, area, phone, birthday, Chess.com handle, FIDE id), email read-only, `publicIdentity` flags. | - | F-PROF-003, 004 | 31 |
| M14 | PATCH /me/profile | Allow-listed private fields only; never role, email or ratings. `VALIDATION_FAILED` with `fields`. | - | F-PROF-003; F-PROF-002 | 18, 19, 31 |
| M15 | PATCH /me/public-identity | Per-field visibility toggles for name, PG ratings, Chess.com handle, city chapter. Email, phone and birthday cannot be made public (rejected). | - | F-PROF-004; F-RATE-008 | 31 |
| M16 | PATCH /me/preferences | First-login preferences `{ playStyle?, mood?, skipped? }`; skippable; marks onboarding done. Mapping to legacy `skill_level` unconfirmed. | - | F-PROF-001 | 17 |

Public player profile (PLAN-007, supersedes the FEAT-000 OQ-26 default): `GET /players/{publicId}` (unauthenticated, 60 per minute per IP, identical `NOT_FOUND` 404 for malformed, unknown, hidden, suspended or under-18 players). Every PublicIdentity carries an opaque `publicId` (random `User.public_slug`, never the pk or email), `null` when `show_display_name` is false, the account is suspended, or the player is under 18 by birthday (no guardian-consent field exists yet), and for the missing-user fallback. Profile data: publicId, displayName, initials, cityChapter (per flag), ratings per pool (only if `show_ratings`), memberSince (year), eventsPlayed (count). No email, phone, birthday, pk or chess.com handle.

### 3.5 Admin: dashboard, events and builder (role: admin, mutations audited)

| ID | Endpoint | Request, response | SM | Features | Screens |
|---|---|---|---|---|---|
| D01 | GET /admin/dashboard | Next or today event summary, first-timer count, pending payments, website health, `attention[]` (unreconciled payments, media without alt, testimonial missing consent, capacity warning), empty state when no upcoming event. | E | F-ADEV-001; F-PAY-009 | 32 |
| E01 | GET /admin/events | Query `status`, `type`, `q`, `page`. `Page<AdminEventRowDto>`: id, title, date, type, capacity and filled, price, pairing mode, status, `capabilities`. | E | F-ADEV-002 | 37 |
| E02 | POST /admin/events | Create a draft (`BuilderDraftDto`, any step may be incomplete) with a server-side `version`. | E | F-ADEV-003 | 38 |
| E03 | GET /admin/events/{id} | Full builder resource across the 8 steps incl. `lockedFields`, `version`, publish `blockers[]`. | E | F-ADEV-003, 012 | 38-45, 46 |
| E04 | PATCH /admin/events/{id} | Partial update of one or more steps with `version`; `VERSION_CONFLICT` when stale. Locked fields rejected once registrations or payments exist (FEAT-000 OQ-22). Operational field groups (capacity, payment, pairing, eligibility, rating) require the stronger permission tier and audit (F-ADEV-020). | E | F-ADEV-004-010, 012, 013, 020 | 38-45 |
| E05 | GET /admin/slugs/check | Query `type=event\|story`, `slug`, `excludeId?`. `{ available, suggestion? }`. | - | F-SEO-006 | 38, 35 |
| E06 | GET /admin/event-types | Event types with configurable defaults (social, rated tournament, league, workshop, special); league and workshop usable but engine for them is Later (F-PAIR-010). Bounded. | - | F-ADEV-013 | 38, 42 |
| E07 | POST /admin/events/{id}/publish | `IK`. Validates "ready to publish"; `NOT_PUBLISHABLE` with `blockers[]`; `SLUG_TAKEN`. Draft to published, stamps time, audit, **emits revalidation** `event/published` (3.10). | E, CMS | F-ADEV-011; F-EVT-001; F-SEO-005 | 45 |
| E08 | POST /admin/events/{id}/unpublish | Published to draft only if no confirmed registrations, else `NOT_PUBLISHABLE`; emits `event/unpublished` (inferred rule). | E | F-EVT-001 | 37, 46 |
| E09 | POST /admin/events/{id}/cancel | `IK`. `{ reason, notifyParticipants, refund }`. Cancels with participant communication and refunds all paid registrations (async); audit; emits `event/cancelled`. | E, R, PO | F-EVT-002 | 37, 46 |
| E10 | POST /admin/events/{id}/complete | Marks the event complete (also done by the scheduler); optional `publishArchive`. Emits `event/completed`. | E | F-EVT-016 | 46, 52 |

### 3.6 Admin: control room (role: admin; `{id}` is the event UUID)

| ID | Endpoint | Request, response | SM | Features | Screens |
|---|---|---|---|---|---|
| C01 | GET /admin/events/{id}/overview | Summary strip (confirmed, first-timers, checked in, pairing status), run-of-show checklist items, arrival metrics, pairing engine summary. | E | F-ADEV-014, 015; F-EVT-006, 007 | 46 |
| C02 | GET /admin/events/{id}/registrations | Query `q` (name, phone, registration id), `payment`, `status`, `firstTimer`, `page`. `Page<AdminRegistrationDto>` with rating, first-time flag, payment state, check-in, `welcomed`, row `capabilities`. This is the only place registration PII is returned, and only to admins. | R, PO | F-ADEV-016; F-EVT-007; F-REG-010 | 47 |
| C03 | POST /admin/events/{id}/registrations/{regId}/actions | `{ action: cancel \| move_to_waitlist \| promote \| mark_welcomed \| set_pairing_active, reason? }`. Registration and payment state change only through this and the refund endpoint, never by a free-form status patch (DEC-B04). | R | F-ADEV-016; F-PAIR-009; F-EVT-007 | 47 |
| C04 | POST /admin/events/{id}/check-in | `{ registrationId, state }` host-desk check-in or undo; any time (default). | R | F-EVT-005 | 48 |
| C05 | GET /admin/events/{id}/check-in | Desk list, search, arrival counts, first-timer queue with `welcomed` and assignee (assignee field inferred). | R | F-EVT-005, 006, 007 | 48 |
| C06 | GET /admin/events/{id}/rounds | Rounds (bounded) with state, version, pairings, results, `capabilities { canPublish, canFinalise, blockers[] }`. | RD, PR | F-PAIR-001, 005 | 49 |
| C07 | POST /admin/events/{id}/rounds/generate | `{ roundNo, method? }`. Derives players from checked-in or registered players, rating, score, opponent history, colour balance. Creates an **unpublished draft** round. Rated Swiss and social balanced. No FIDE compliance claim. | RD | F-PAIR-002, 003, 004, 009 | 49, 46 |
| C08 | PATCH /admin/events/{id}/rounds/{roundId}/pairings | Edit boards, players, colours, byes in a draft; after publish an edit creates a new round version with a mandatory reason and an audit entry. | RD | F-PAIR-005, 006 | 49 |
| C09 | POST /admin/events/{id}/rounds/{roundId}/publish | `IK`. Draft to published (visible to players, notifies them); emits notifications, not site revalidation. | RD | F-PAIR-006; F-NOTI-004 | 49 |
| C10 | POST /admin/events/{id}/rounds/{roundId}/start | Published to live (also scheduler-driven where configured, inferred). | RD | F-PAIR-001 | 49 |
| C11 | PUT /admin/events/{id}/rounds/{roundId}/pairings/{pairingId}/result | Admin records or overrides a result (`final`) or resolves a dispute (`resolveResult`) with a reason. | PR | F-PAIR-007; F-EVT-010 | 49 |
| C12 | POST /admin/events/{id}/rounds/{roundId}/finalise | `IK`. Only when all results are final (`RESULTS_NOT_FINAL`). Idempotent by `ratings_processed_at` (`ROUND_ALREADY_FINALIZED` on a different key; same key returns original). Sets round `completed`, enqueues rating processing (5.4). Returns processing state. | RD | F-PAIR-008; F-RATE-002, 004 | 49 |
| C13 | GET /admin/events/{id}/payments | `Page<AdminPaymentRowDto>` for the event: player, amount, status, provider ids, `mismatch`, `capabilities { canRefund }`. | PO | F-PAY-005 | 50 |
| C14 | GET/POST /admin/events/{id}/messages | GET: message log with per-recipient delivery state incl. partial failure, channel health (email only at launch). POST `IK`: `{ audience, channel, subject, body }`; stores first, returns 202; delivery by the worker. Audience: confirmed, waitlist, checked in, first-timers. | - | F-COMM-002-006 | 51 |
| C15 | GET/PATCH /admin/events/{id}/communications | Per-event toggles for state-triggered messages (confirmation, 24 h reminder, check-in open, pairing published, post-event) and channels. Also part of the builder step 7 resource (E03/E04); listed separately only if the backend splits it. | - | F-ADEV-010; F-COMM-002 | 44 |
| C16 | GET/PATCH /admin/events/{id}/recap | Recap text, `publishArchive` flag, gallery collection link; PATCH emits `event/updated` when the archive is published. | E | F-ADEV-017; F-EVT-016 | 52 |
| C17 | GET /admin/events/{id}/audit | Query `actor`, `action`, `from`, `to`, `page`. Time-ordered actor, action, object. Plus `?format=csv` log export (distinct from the dropped player CSV export, FEAT-001 OQ-18). | - | F-ADEV-018; F-AADM-008 | 53 |

### 3.7 Admin: CMS, media, stories, testimonials, preview (role: admin)

| ID | Endpoint | Request, response | SM | Features | Screens |
|---|---|---|---|---|---|
| S01 | GET /admin/cms/sections | Bounded list of sections (`home` sub-sections, `community`, `nav`, `footer`, `meta`) with status (`clean`, `draft`, `published`), `version`, `updatedAt`, `updatedBy`. | CMS | F-ACMS-001, 004 | 33 |
| S02 | GET /admin/cms/sections/{key} | Draft and published copies side by side, typed fields, media collection ids, `version`. | CMS | F-ACMS-001, 002 | 33 |
| S03 | PUT /admin/cms/sections/{key}/draft | Save draft with `version`; `VERSION_CONFLICT` returns the other editor's change summary (F-ACMS-003). Typed content only, no HTML (server validates field types and lengths and URL schemes `http`, `https`, `mailto`, `tel`). | CMS | F-ACMS-001, 003 | 33 |
| S04 | POST /admin/cms/sections/{key}/publish | `IK`. Stamps time, writes `cms_versions` history, audit, **emits** `site/{key}/published`. | CMS | F-ACMS-002, 003 | 33 |
| S05 | GET /admin/cms/sections/{key}/versions | History list (basic; a history browser may slip to Later, FEAT-000). | CMS | F-ACMS-003 | 33 |
| S06 | GET/PUT /admin/legal/{page} and POST .../publish | Draft, publish, `effectiveDate`, `version`. Same pattern as S02 to S04; emits `legal/{page}/published`. Production publish needs approved wording (FEAT-001 OQ-04, a process gate). | CMS | F-LEG-001 | 9-11 |
| S07 | POST /admin/media/uploads | `{ filename, contentType, sizeBytes }` returns `{ assetId, uploadUrl, headers, expiresAt }`: a **signed upload URL to Supabase Storage**; the server validates type and size allow-list before issuing, never receives the bytes. | - | F-ACMS-005 | 34, 43 |
| S08 | POST /admin/media/assets/{assetId}/complete | After the browser uploads: the server verifies the object, reads dimensions, strips EXIF, records the asset. | - | F-ACMS-005, 008 | 34 |
| S09 | GET /admin/media/assets | Query `q`, `status`, `missingAlt`, `page`. `Page<MediaAssetDto>`: URL, dimensions, `alt`, `decorative`, `focalX/Y`, `credit`, `archived`, `usedBy[]`. | - | F-ACMS-005 | 34 |
| S10 | PATCH /admin/media/assets/{assetId} | alt text or explicit `decorative=true`, focal point (0 to 1), credit, archive. Missing alt warns, does not block (FEAT-001 OQ-12). | - | F-ACMS-005, 007 | 34 |
| S11 | DELETE /admin/media/assets/{assetId} | `ASSET_IN_USE` if referenced; archive instead (S10). Emits `media/*`-mapped revalidation when a published asset is archived or replaced (3.10). | - | F-ACMS-007 | 34 |
| S12 | GET/POST /admin/media/collections, GET/PATCH /admin/media/collections/{id} | Name, `mode` (`static`/`carousel`), `autoplay`, `intervalMs`, ordered `items[{assetId}]`. 0 assets placeholder, 1 static, 2+ carousel are frontend rules; the server returns the ordered data. | - | F-ACMS-006 | 34, 43, 52 |
| S13 | GET /admin/stories, POST /admin/stories, GET/PATCH /admin/stories/{id} | Story resource: kind, `slug`, eyebrow, title, dek, closed block body, date, reading time, featured, media collection, status, `version`. Body format: closed block model (FEAT-001 OQ-01 approved; FEAT-000 OQ-11). | CMS | F-ACMS-009; F-SEO-006 | 35 |
| S14 | POST /admin/stories/{id}/publish and /unpublish | `IK` on publish. `SLUG_TAKEN`; slug locked after first publish. Emits `story/*`. | CMS | F-ACMS-009; F-SEO-005 | 35 |
| S15 | GET /admin/testimonials, POST, GET/PATCH /admin/testimonials/{id} | Quote (exact, never rewritten), name, descriptor, portrait asset, `consentAt`, `sortOrder`, status. | CMS | F-ACMS-010 | 36 |
| S16 | POST /admin/testimonials/{id}/publish and /unpublish | Publish needs quote + photo + consent, enforced here (`NOT_PUBLISHABLE`, `fields`). Emits `testimonial/*`. The two records named in FEAT-000 stay unpublished until approved. | CMS | F-ACMS-010; F-PUB-009 | 36 |
| PV01 | POST /admin/preview-link | `{ kind: 'event'\|'story'\|'site', id }` returns `{ url }` = `{SITE}/api/draft?token=<opaque>`; token single use, 5 minutes. | - | F-ACMS-002 | 33, 35, 45 |

### 3.8 Admin: players, payments, settings

| ID | Endpoint | Request, response | SM | Features | Screens |
|---|---|---|---|---|---|
| G01 | GET /admin/players | Query `q` (name, email, phone; max 100; phone-like queries match on digits only), `page`. `Page<AdminPlayerRowDto>`; rows add `rating {pool, rating, provisional} \| null` (highest-games pool) and `attendancePct \| null`. | - | F-AADM-001 | 54 |
| G02 | GET /admin/players/{id} | Record: event history, attendance, rating context, permitted private fields only (limited by role). Adds `ratings[].rd`, `registered`, `nextEvent {id, slug, title, startsAt} \| null`, `historyTruncated`, row `rating`/`attendancePct`. Each view is audited (`player.view_private`, no PII, one row per admin+player per 5 min, fail closed) and `no-store`. | - | F-AADM-001; F-EVT-017 | 54 |
| G03 | PUT /admin/players/{id}/role | `IK`. `{ role: 'player'\|'admin' }`. Audited; also guards against removing the last admin (inferred). Initial admins are seeded, not self-granted (FEAT-000 OQ-17). | - | F-AADM-002; F-AUTH-007 | 54 |
| G04 | GET /admin/payments | Query `status`, `eventId`, `mismatch`, `from`, `to`, `page`. Global ledger: player, event, amount, status, provider ids, updated, mismatch flag. | PO | F-AADM-004; F-PAY-005 | 55 |
| G05 | POST /admin/payments/{id}/refund | `IK`. `{ amountPaise?, reason }` (full refund by default). Calls Razorpay, then updates payment and registration **together**; refund state `pending` until the provider event confirms. | PO, R | F-PAY-007 | 50, 55 |
| G06 | POST /admin/payments/reconcile | `{ eventId? }`. Compares provider and PG state, flags mismatches, never silently fixes. Also run by the scheduler. Returns counts. | PO | F-PAY-009 | 32, 50, 55 |
| G07 | GET /admin/settings | Grouped non-secret settings (brand and site, authentication, ratings, payments, notifications, event defaults) plus integration health `{ google, razorpay, email, whatsapp }` as `connected` flags. **Never** returns or accepts secret values. | - | F-AADM-005, 006; F-COMM-006 | 56 |
| G08 | PATCH /admin/settings | Partial update with `version`; keys on a server allow-list; audit. | - | F-AADM-005 | 56 |

### 3.9 Contact

Public submission is P11. A submissions inbox (F-CON-003) is Later and has no screen; the contract only requires that submissions are stored (`contact_messages`) and delivered to the destination configured in settings (FEAT-001 OQ-10).

### 3.10 Revalidation callout and preview exchange

**Revalidation outbox and event id (F-07, OD-06).**  On every successful publish, update, unpublish, cancel, complete or delete of an event, story, testimonial, site section, media asset, legal page or player/result (for privacy purge, F-15), **after the database commit**, the backend writes a row to a `revalidation_outbox` table (transactional; if the write fails the mutation fails). Each row holds: event id (UUID), type (one of `event`, `story`, `testimonial`, `site/<section>`, `media`, `legal`, `player`, `result`, per entity), action, entity id and slug (if applicable), entity monotonic `version` counter, timestamp. A dispatcher (API on-commit and scheduler as backstop) sends the signed `POST {SITE}/api/revalidate` described in ARCH-001 section 9. Signing requirement change (F-07): **sign the tuple `timestamp.eventId.rawBody`; put the eventId inside the HMAC** (not just in the header). Headers: `X-PG-Timestamp`, `X-PG-Event-Id`, `X-PG-Signature: v1=<hex-sha256>`; payload is `{ type, action, id, slug?, occurredAt, version }` as JSON. 300 s window, `X-PG-Event-Id` stable across retries, 202 on success. A duplicate event id returns 202 no-op after validation. Retries: exponential backoff up to 5 attempts, same event id, fresh timestamp and signature. `version` is the entity's monotonic counter that increments with every change (not just publish); the spec is in OD-06 decision below. Scheduler-driven transitions (registration open/close, sold out, completed) emit too. For a media change emit one call per referencing entity, not a coarse `media` fallback. TASK-113 extracts the full signing spec and test vectors; this document points to it and does not duplicate details. Types `player` (actions `deleted`, `privacy_updated`, `emergency_purge`) and `result` (action `deleted`) are specified in section 5.6; the purge procedure is in `OPS-003-privacy-purge-runbook.md`.

**Per-entity monotonic version (OD-06 decision).** Every entity that can be revalidated (events, stories, testimonials, site sections, media collections, legal pages) has a database column `version` that is: auto-incremented on every INSERT or UPDATE (not soft-delete), immutable once written, returned in all responses including public reads, used to short-circuit cache checks ("if the version is the same, the content is the same"). Frontend benefit: cheap change detection between polls (replay or not?). Backend benefit: a stale revalidation event with an old `version` number is safe to ignore (no-op dedupe). The `version` column should be `BIGINT` and should be exposed in list and detail DTOs for all entities.

**Preview exchange (F-06 hardening).**  `POST /api/preview/exchange` (decided: path is `/api/preview/exchange` per the rewrite model), server to server only. Request body: `{ token }` where `token` is the single-use short-lived preview token from `createPreviewLink`. Authentication: `Authorization: Bearer <PREVIEW_SECRET>` (not body-based; only the backend calls this). Response: `{ path, previewKey }` where `path` is the relative slug-based link (e.g., `/events/my-event` or `/stories/my-story`) and `previewKey` is a new short-lived (5 minutes) bearer token that grants read access to unpublished content of the named entity only via the `X-Preview-Key` header. Requirements: (a) consume the preview token in this call (single-use); (b) validate the incoming bearer against the shared `PREVIEW_SECRET` with constant-time compare; (c) return 401 on mismatch; (d) the `path` must be a relative path starting with `/` and matching an allow-list (e.g., `/^/(events|stories|admin.*)/`); (e) draft content must never be returned by any public endpoint unless `X-Preview-Key: <valid-key>` is present on a read. Test requirement (F-06): after a draft link exchange, an anonymous `GET /api/events/{slug}` returns published content or 404 (no ISR cache poisoning); draft responses carry `Cache-Control: private, no-store` and `X-Robots-Tag: noindex`.

## 4. Gap matrix (59 screens and states)

**Legacy column meaning** (judged on the Django code in `backend/`, not on the old frontend):

- **yes**: an equivalent exists and needs only the global changes below.
- **partial**: part of the data or behaviour exists but must change materially (new fields, new rules, security fix) or covers only some of the screen.
- **no**: nothing usable exists; build new.
- **n/a**: the screen needs no backend data.

**Global delta applied to every legacy row** (not repeated per row): no unified envelope or stable error codes (legacy returns bare payloads and `{detail}` or `{field: msg}`); decimal rupees instead of integer paise; snake_case; no `Idempotency-Key`; no rate limiting; no `request_id`; no pagination; Django `AllowAny`/`IsAuthenticatedOrReadOnly` defaults; no audit log; CORS-based rather than same-origin; JWT claims carry `role`. Where FEAT-000 rates a feature `partial` or `exists` only because the *old frontend* had hard-coded content (screens 6, 9, 10, 11, 34), this matrix rates the *backend* `no` and says so.

### 4.1 Legacy endpoint disposition (24 legacy endpoints, classification only)

| Legacy endpoint | Today | Disposition against this contract |
|---|---|---|
| POST auth/register | Creates user and 3 rating rows; min password 6; accepts skill level to seed rating | Keep behaviour idea, change password policy, add profile stub, return envelope (A01) |
| POST auth/login | Neutral invalid-credentials; returns access, refresh, user | Keep (A02) |
| POST auth/logout | Returns 200, revokes nothing | Replace: revoke family (A04) |
| GET, PATCH auth/me | User with ratings; PATCH allow-list includes pincode and gender | Keep shape idea, split into A05, M13, M14 |
| POST auth/token/refresh | Rotates but never invalidates the old token | Replace: single-use rotation with reuse detection (A03) |
| POST auth/password-reset, confirm | Neutral reset; stateless 1 h signed token, reusable; min password 6 | Harden: single use, policy, revoke sessions (A06, A07) |
| GET, POST tournaments/ | Admin create; public list; **GET promotes status to ongoing (write in GET)**; `registered_count` counts paid only | Replace by P02, E01, E02; promotion moves to the scheduler |
| GET, PATCH tournaments/{id}/ | UUID detail, admin patch | Replace by P03, E03, E04 (slug, projections, drafts) |
| GET, POST tournaments/{id}/registrations/ | **GET is public and returns email, Razorpay ids**; POST registers with no capacity or window check, sets `paid` for free events | Remove public GET; replace by R02, C02 |
| PATCH tournaments/{id}/registrations/{rid}/ | Admin can set `payment_status` and `score` directly | Replace by C03 (no free-form payment status) |
| GET tournaments/{id}/leaderboard/ | Global rating table | Dropped (FEAT-000 section 6) |
| GET tournaments/{id}/export-csv/ | Admin CSV of players | Dropped (FEAT-000 section 6) |
| GET, POST tournaments/{id}/rounds/ | **GET is public, returns pairings with names**; POST creates next round | Replace by C06, C07, M05 (player sees own pairing only) |
| POST rounds/{id}/pairings/ | Admin adds pairing | Fold into C08 |
| POST rounds/{id}/generate-swiss/ | Deletes and recreates pairings, no draft or publish | Reference for pairing logic only (C07); needs verification |
| POST rounds/{id}/update-ratings/ | **Not idempotent**: re-run re-rates; no ledger | Replace by C12 plus rating job (5.4) |
| POST rounds/{id}/complete/ | Sets `is_complete` | Replace by C12 |
| PATCH pairings/{id}/ | Admin sets result | Fold into C11 |
| GET tournaments/profile/ | Any caller can fetch any user by id, full `UserSerializer` incl. email, phone, birthday | **Remove**; public identity subset only inside event views (6.1) |
| GET tournaments/profile/tournament-history/ | Player history with payment status and rating before/after | Replace by M04 |
| POST payments/{id}/create-order/ | Server price, Razorpay order; no hold, no idempotency | Replace by R04 |
| POST payments/{id}/verify/ | **Signature only**; no amount or status check | Replace by R05 |
| GET gallery/ | Public photo list | Dropped as a page; data migrates to media assets (F-NFR-008) |

Of the 24: 2 dropped, 1 data-only migration source, 2 kept with small changes (login, me), 19 replaced or substantially changed.

### 4.2 Screen matrix, public and player (screens 1 to 31)

| # | Screen and route | Data needed | Endpoint | Legacy | Notes |
|---|---|---|---|---|---|
| 1 | Home `/` | CMS sections, upcoming cards, testimonials, featured story, nav, footer | P01, P02, P08, P06 | partial | Event list exists; CMS, testimonials, media collections, first-timer count, area do not. Cards need event media |
| 2 | Play `/play` | Filterable, searchable, paginated event list | P02 | partial | Legacy filters status and `upcoming` only; no type, audience, free, search, pagination; GET writes status |
| 3 | Event open `/events/[slug]` | Event detail by slug, live availability | P03, P04 | partial | Legacy UUID detail; no slug, summary, media, audience, waitlist, venue address; counts paid only |
| 4 | Event completed `/events/[slug]` | Archive: facts, final standings, winner, recap, gallery | P03 | no | Per-event standings (F-EVT-015) and recap do not exist; legacy leaderboard is a dropped global table |
| 5 | Past events `/past-events` | Searchable archive of completed events | P05 | partial | `status=completed` filter exists; no search, no pagination, no archive flag |
| 6 | Community `/community` | CMS page | P01 | no | Legacy has no CMS; page was hard-coded in the old frontend |
| 7 | Stories `/stories` | Stories list, featured | P06 | no | |
| 8 | Contact `/contact` | Submit; contact config | P11, P12 | no | Legacy form only simulated success |
| 9 | Privacy `/privacy` | Legal text, effective date | P09 | no | Text was hard-coded; wording needs approval (OQ-04) |
| 10 | Terms `/terms` | Legal text, effective date | P09 | no | As screen 9 |
| 11 | Refund policy `/refund-policy` | Legal text; refund rules | P09 | no | New page; rules open (FEAT-000 OQ-07) |
| 12 | 404 | none | - | n/a | Unknown slug returns 404 from P03/P07 |
| 13 | Login `/login` | Credentials; session; Google (flag) | A02, A03, A05 (A08 flagged) | yes | Login and neutral error exist. Refresh rotation and reuse detection are a cross-cutting gap (6.2). Google is `no` |
| 14 | Create account `/login?mode=signup` | Register; field errors | A01 (A08 flagged) | partial | Exists; min password 6, no profile stub or public-profile row, no verification (FEAT-000 OQ-13), seeds rating from self-reported skill |
| 15 | OAuth callback `/auth/callback` | Code exchange | A09, A10 | no | Flagged; not required to launch |
| 16 | Reset password `/reset-password` | Request, confirm | A06, A07 | partial | Neutral request exists; token reusable within 1 h, min password 6, no session revoke |
| 17 | Welcome `/welcome` | Preferences, skip | M16, A05 | no | Legacy keeps `skill_level` at sign-up only |
| 18 | Register, paid `/events/[slug]/register` | State, hold, order, verify, status | R01, R02, R04, R05, R06 | partial | Order and verify exist but: no hold, no capacity or window check, no idempotency, signature-only verify, no webhook, no ledger |
| 19 | Register, free | State, confirm | R01, R02 | partial | POST registration exists; no capacity or window check; sets `paid` for free events |
| 20 | Register, waitlist | State, join, position, offer | R01, R03, R08 | no | |
| 21 | Register, success | Registration status, calendar data | R06 | partial | Only history list exists; no single-registration read; confirmation email absent (reset email only) |
| 22 | Player dashboard `/app` | Next up, recent games, people, ratings | M01, M02, M03, M10 | partial | History and `me` ratings exist; next-up, games, people do not |
| 23 | My events `/app/events` | Registrations with payment, refund, waitlist state | M04, R07 | partial | `tournament-history` has no waitlist, hold or refund state, no cancel |
| 24 | Event room, before check-in `/app/events/[id]` | Snapshot | M05 | no | No snapshot, no check-in, no published flag on rounds |
| 25 | Event room, check-in open | Snapshot; check-in | M05, M06 | no | |
| 26 | Event room, pairing pending | Snapshot | M05 | no | |
| 27 | Event room, live round | Snapshot; submit, confirm, dispute | M05, M07, M08, M09 | no | Legacy pairing result is admin-only and has no lifecycle |
| 28 | Event room, between rounds | Snapshot; standings | M05 | no | |
| 29 | Event room, complete | Snapshot; ledger; rating delta | M05, M11 | no | Legacy keeps only rating before/after on the registration |
| 30 | Ratings `/app/rating` | Pools, ledger, trend, provisional | M10, M11, M12 | partial | Per-pool rating (Glicko-2 fields) exists; no ledger, no trend, no provisional rule; legacy defaults 1500/350/0.06 |
| 31 | Profile `/app/profile` | Private fields, public-identity flags | M13, M14, M15 | partial | GET/PATCH `me` exists; no visibility flags; legacy profile endpoint exposes any user's PII (remove) |
| 59 | Story detail `/stories/[slug]` | Story by slug, block body | P07 | no | Needs closed block model |

(Row 59 is placed here with the public screens; its position in the numbering is last.)

### 4.3 Screen matrix, admin and design reference (screens 32 to 58)

| # | Screen and route | Data needed | Endpoint | Legacy | Notes |
|---|---|---|---|---|---|
| 32 | Admin dashboard `/admin` | Aggregates, attention list | D01, G06 | no | No aggregates, no health, no media/testimonial signals |
| 33 | Website CMS `/admin/content` | Sections, draft, publish, versions, conflict | S01-S05 | no | No CMS, no versions |
| 34 | Media `/admin/media` | Upload, assets, collections, alt, focal, protection | S07-S12 | no | Legacy `gallery_photos` is URL, caption, category only; no upload, alt, focal point or collections. FEAT-000 rates this `partial`; rated `no` here because the backend gap is total |
| 35 | Stories admin `/admin/stories` | Story CRUD, slug, publish | S13, S14, E05 | no | |
| 36 | Testimonials admin `/admin/testimonials` | CRUD, consent, publish rules | S15, S16 | no | |
| 37 | Events admin `/admin/events` | List with filters and counts; cancel | E01, E09 | partial | Admin list and PATCH exist; no draft or cancelled status, counts are paid only |
| 38 | Builder 1 Basics | Core fields, slug check, draft | E02-E05 | partial | name, date, venue, format, time control exist; no type, city/area, summary, slug, draft |
| 39 | Builder 2 Experience | Experience fields | E03, E04 | no | |
| 40 | Builder 3 Registration | Capacity, waitlist, window, eligibility, first-timer question | E03, E04 | partial | `max_players`, `registration_deadline` exist; no waitlist, open time, eligibility |
| 41 | Builder 4 Payment | Pricing, refund window | E03, E04 | partial | `entry_fee` (decimal rupees) only; no refund window; member and comp hidden (OQ-09) |
| 42 | Builder 5 Game system | Pairing mode, rated, pool, rounds, time control | E03, E04, E06 | partial | format, rounds, time control exist; no pairing mode, rated flag |
| 43 | Builder 6 Media | Event media collection | E03, E04, S12 | no | |
| 44 | Builder 7 Communications | Message toggles | C15 (or E03) | no | |
| 45 | Builder 8 Review and publish | Ready check, preview, publish | E07, PV01 | no | No draft, publish or preview |
| 46 | Control overview | Summary, run of show | C01, C07 | no | |
| 47 | Control registrations | Searchable registrations, row actions | C02, C03 | partial | Admin list with rating exists (and is leaking publicly); PATCH of `is_pairing_active` exists; no search, pagination, row actions, first-timer data |
| 48 | Control check-in desk | Search, check in, welcomed | C04, C05 | no | |
| 49 | Control pairings and rounds | Draft, edit, publish, result entry, finalise | C06-C12 | partial | Rounds, pairings, Swiss generator, result entry and rating update exist; no draft/publish/version, no board numbers, not idempotent, no dispute lifecycle |
| 50 | Control payments | Event payments, refund, reconcile | C13, G05, G06 | no | Razorpay ids live on the registration row; no ledger, refund, reconcile |
| 51 | Control messages | Compose, audience, delivery state | C14 | no | Only password-reset email exists |
| 52 | Control gallery and recap | Photos, recap, publish archive | C16, S12 | no | |
| 53 | Control audit | Audit read and export | C17 | no | No audit log |
| 54 | Players admin | Search, record, role | G01-G03 | no | No admin player search; role is set only in the database |
| 55 | Payments admin | Global ledger | G04-G06 | no | |
| 56 | Settings admin | Grouped settings, integration health | G07, G08 | no | |
| 57 | Design system `/handoff/design-system` | none | - | n/a | Dev-only |
| 58 | UI states `/handoff/states` | none | - | n/a | Dev-only |

### 4.4 Totals

| Legacy status | Count | Screens |
|---|---:|---|
| yes | 1 | 13 |
| partial | 20 | 1, 2, 3, 5, 14, 16, 18, 19, 21, 22, 23, 30, 31, 37, 38, 40, 41, 42, 47, 49 |
| no | 35 | 4, 6, 7, 8, 9, 10, 11, 15, 17, 20, 24-29, 32-36, 39, 43-46, 48, 50-56, 59 |
| n/a (no backend data) | 3 | 12, 57, 58 |
| **Total** | **59** | |

Reading: only login is close to usable as is. 20 screens could be served by extending existing tables and endpoints, but each of those also carries a security or correctness defect (section 6) or needs new fields. 35 screens need new backend capability. Every screen with `no` and no legacy ancestor (CMS, media, event room, ledger, audit, messages) is the same size of work under "extend Django" or "rebuild"; the choice mainly affects auth, event, registration and pairing code and the data migration (OQ-18, section 8).

### 4.5 Coverage checks

- Every PgApi endpoint in section 3 is used by at least one screen except: P10 (sitemap), A03 (refresh), A10 (provider redirect), W01 (webhook), P12 (inferred config read), C15 (optional split). These are system or cross-cutting.
- Every screen except 12, 57, 58 maps to at least one endpoint, and every MVP feature in FEAT-000 either appears in a "Features" column above or is a job/side effect in section 5 (F-AUTH-008 in A01, F-REG-011 in 2.5, F-PAY-004 in W01, F-PAY-006 in 5.2, F-AADM-007 in 6.5).
- Features with no screen in FEAT-000 Appendix B (F-PUB-008 is now screen 59; F-ADEV-019 venues and hosts, F-AADM-003 host permissions, F-COMM-009 consent preferences, F-NOTI-001 in-app notifications, F-CON-003 inbox, F-LEG-004 data export) have **no endpoint in this contract**; they are Later or default-hidden (FEAT-000 OQ-02, OQ-26, OQ-28; FEAT-001 OQ-09). The data model should not preclude them.

### 4.6 Negative conformance tests (legacy defects as MUST NOT requirements)

The backend plan's TASK-092 conformance suite must encode each legacy defect as a test that verifies the new backend does not reproduce it. Failure is a blocker.

| Test ID | Legacy defect (L-#) | MUST NOT requirement | Verification |
|---|---|---|---|
| NCT-L1 | Anonymous registration list leak (L-1) | No public or player endpoint returns another person's email, phone, birthday, provider ids, or payment state. Registration lists (C02, G04) are admin-only; public registrations are 404. | Mock anonymous and player tokens; GET on endpoints that return DTO with user data; scan for `email`, `phone`, `birthday`, `razorpay_*`, `payment_id`, `order_id` fields in the response; fail if found. |
| NCT-L2 | Public profile leaks PII (L-2) | No endpoint at any role returns the full profile of another user; profile is available only to self (M13), the public-identity subset via standings/opponents (opt-in, flags), or the PLAN-007 public profile (opaque `publicId`, same flags, no PII). | Try to GET another user's profile; must 404 or return public-identity subset only (name per flag, no email/phone/birthday). |
| NCT-L3 | Refresh not revoked (L-3); see also F-02 | Presenting an already-used refresh token revokes the family and returns `AUTH_REQUIRED` with `REFRESH_REUSED`. Absolute lifetime enforced: refresh after expiry fails with `SESSION_EXPIRED`. Role changes, suspensions, password reset and logout revoke all families. | (a) Rotate to token B; try to use token A again — must fail `REFRESH_REUSED` after grace window. (b) Set token lifetime to -1 second in test; retry refresh — must fail `SESSION_EXPIRED`. (c) Change user role in DB; retry refresh with old token — must fail with `ROLE_CHANGED`. (d) Call logout; retry refresh — must fail `AUTH_REQUIRED`. |
| NCT-L4 | Role trusted from JWT (L-4) | Role is read from the database (or a database-backed cache with 5-minute TTL max) on every admin endpoint, never trusted from the access token claim alone. | For an admin endpoint (e.g., E01 list), demote the user role in the DB, then retry with the same access token — must fail `ADMIN_REQUIRED` within 5 min. |
| NCT-L5 | Insecure SECRET_KEY fallback (L-5) | The backend fails to start if any required secret is unset; no fallback defaults to a weak value. | Deploy with missing secret; must fail startup with a clear error, not default to a known string. |
| NCT-L6 | No throttling on auth, reset, contact (L-6) | Rate limits per IP and per account on login (10/min per IP, 5/min per email), register (10/min per IP, 5/min per email), password-reset request (3/h per email, 10/h per IP), and contact (3/h per IP). All return 429 with `RATE_LIMITED`, `retry_after` and `Retry-After` header. Responses are generic (no "too many attempts" in the detail). | Fire 11 login attempts in 1 min from the same IP — 11th must be 429. Fire 6 attempts in 1 min to the same email — 6th must be 429. Fire 4 password-reset requests in 1 h to the same email — 4th must be 429. Response must not name the account. |
| NCT-L7 | No capacity check (L-7) | Registration (R02) is atomic: if the hold does not fit in available capacity (confirmed + unexpired holds), it fails with `EVENT_FULL` (or `ALREADY_REGISTERED` if the player is already registered). | (a) Create event, capacity 1, two players register — second gets `EVENT_FULL`. (b) First player has an expired hold; second player registers — succeeds, first can re-register. |
| NCT-L8 | CORS and role from JWT (L-8) | No CORS dependence; `Origin` header is not checked. Role is read from the database, not the JWT claim. | Remove all CORS checks; confirm no CORS header in responses. Confirm role from DB, not token (NCT-L4). |
| NCT-L9 | Unpaginated lists, no rate limit, no request-id (L-9) | All list endpoints return `meta.pagination`; all responses have `meta.request_id`. Rate limits per 2.10 and per-IP limits on public endpoints. | Every list endpoint must return `meta.pagination` with page/page_size/total/total_pages. Every response must have `meta.request_id` matching `X-Request-ID` header. Call any endpoint 13 times in quick succession from the same IP — expect 429 on appropriate endpoints. |
| NCT-L10 | No Razorpay webhook (L-10) | The backend receives the Razorpay webhook and uses it as the source of truth for payment state; the browser `verify` call is a hint only. Webhook dedupe by provider event id; payment captured state drives registration confirmation, not browser call alone. | Mock Razorpay webhook for a captured payment; verify registration transitions to `confirming`/`confirmed`. Replay the same webhook twice — second must be idempotent (200, no double-confirmation). |
| NCT-L11 | No hold or capacity check on order (L-11) | Order creation (R04) requires a live hold (`HOLD_EXPIRED` if expired). Timeouts and retries are reliable. | Create order without a hold — must fail `HOLD_EXPIRED`. Create order with expired hold — must fail. Confirm holds are checked before order. |
| NCT-L12 | CSV formula injection (L-12) | Any CSV export (audit in C17) must prefix dangerous characters (`=`, `+`, `-`, `@`) with a single quote `'` in every cell. Filenames must not contain shell metacharacters or path traversal sequences. | Export audit as CSV; check that names starting with `=` have a `'` prefix; try a filename with `../` — must fail or sanitise. |
| NCT-L13 | CORS with credentials (L-13) | No CORS; same-origin only. Backend responds only to same-origin requests via the rewrite. | Confirm no `Access-Control-Allow-Credentials: true` header. Test from a different origin — request must not succeed (browser SOP blocks it). |
| NCT-L14 | No HSTS, secure cookie, proxy SSL (L-14) | Backend must set security headers: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cache-Control` per 2.12, authenticated responses have `Cache-Control: no-store`. | Check headers on every response; verify HSTS is set to at least 31536000 (1 year). Verify admin/authenticated endpoints have `no-store`. |
| NCT-L15 | Admin writes payment_status with no audit (L-15) | Every privileged mutation (refund, role change, cancel, publish, etc.) is audited with actor, action, object, before and after (section 6.5). Audit table is append-only; no UPDATE or DELETE grant for the app role. | Perform a refund as an admin; check `audit_log` has an entry with actor_id, action, object_id, before (payment state), after. Try to DELETE or UPDATE an audit row — must fail. |
| NCT-L16 | DRF legacy `next` URLs (L-16) | Pagination uses page numbers (`meta.pagination.page`, `.page_size`) or opaque cursors, never `next` absolute URLs. If the backend returns URLs (preview link, media URL, OAuth start URL), they must be relative paths, not absolute. | List endpoint must use page numbers. Preview link response must have a relative path (starts with `/`), not an absolute URL. No `next` field in paginated responses. |

## 5. Webhooks and jobs

Topology (FEAT-000 section 5, ARCH-001 section 18): Railway runs an **API** service, a **worker** and a **scheduler**; all use Postgres through the transaction-mode pooler. A job must be safe to run twice (at-least-once), take a database lock or use an atomic update so two scheduler instances do not double-process, and write an audit or log line with the job name and affected count. Jobs never run inside a GET (legacy status promotion did).

### 5.1 Razorpay webhook (inbound, direct to Railway, not via Vercel)

| Item | Requirement |
|---|---|
| Endpoint | `POST /webhooks/razorpay` on the API service. Excluded from auth, the envelope renderer and rate limiting by user (IP allow-list or provider signature only). |
| Verification | HMAC-SHA256 of the **raw body** with the webhook secret (backend secret only) before JSON is trusted; constant-time compare; failure returns 400 and logs the reason code only. |
| Dedupe | Store each provider event id in `payment_webhook_events` (unique). A repeat returns 200 with no side effects. |
| Events handled | payment captured and failed, order paid, refund processed and failed (exact event names per the Razorpay account configuration; confirm in the backend PLAN). Unknown events are stored and acknowledged. |
| Effects | Moves `payment_orders` and `payments` forward only (never trusts browser state, STATE-MACHINES). Captured: confirm the registration if the hold is valid or capacity still exists; otherwise apply the **late-capture rule** (default from FEAT-001 OQ-17: auto-refund with a visible refund-pending state and a support link; owner to confirm). Refund processed: update payment **and** registration together. |
| Response | 200 quickly (under a few seconds); heavy work (email) queued to the worker. 5xx only for transient infrastructure faults so the provider retries. |
| Mismatch | Amount, currency or order-id disagreement creates a mismatch record surfaced to admins (G04, G06); it is never silently corrected. |

### 5.2 Scheduler jobs (Railway scheduler)

| Job | Cadence (inferred) | Does | Emits |
|---|---|---|---|
| Hold expiry | every minute | `pending` holds past `holdExpiresAt` stop counting toward capacity, order moves `expired`; next waitlisted player gets an offer. F-PAY-006, F-REG-003 | notification; `event` revalidation only if the public state flips |
| Waitlist offer expiry | every minute | Lapse unclaimed offers (default window 2 h, OQ-08) and offer to next. F-REG-006 | notification |
| Event status transitions | every minute | Open and close registration at window times, mark `sold_out` when full, `ongoing` at start, `completed` per rule. Replaces legacy write-on-GET. F-EVT-001 | **revalidation** for each public state change (ARCH-001 9.4) |
| Payment reconciliation | hourly and on demand (G06) | Compare Razorpay and PG records; flag mismatches. F-PAY-009 | audit and attention list |
| Reminders | every 5 minutes | 24-hour reminder, check-in open, post-event thanks with recap and rating link. F-NOTI-002, 003, 006 | email via 5.5 |
| Revalidation retry | every 30 seconds | Re-send undelivered outbox rows (5.6) | - |
| Idempotency and token cleanup | daily | Purge idempotency keys older than 24 h to 7 d, expired reset and refresh tokens | - |

### 5.3 Hold and capacity rule

Capacity is checked and a hold written in **one atomic operation** (R02). Confirmed registrations plus unexpired holds must never exceed capacity. "Never take money after capacity is unavailable unless the event explicitly supports overbooking" (EVENT-ENGINE). Default hold 10 minutes (FEAT-000 OQ-08, a proposal). The client countdown uses `holdExpiresAt` and `serverNow`, never its own clock.

### 5.4 Rating processing (worker, idempotent per round)

Triggered by C12. Steps in one database transaction: lock the round row; if `ratings_processed_at` is set, stop and report the stored outcome; read all final results; load every player's rating from the **same pre-round snapshot**; compute Glicko-2 for all players; insert `rating_transactions` rows with a unique key `(round_id, player_id, pool)`; only then update `rating_profiles`; set `ratings_processed_at`. Unrated and social events create no deltas (F-RATE-006). The Glicko-2 implementation must be tested on published known vectors (F-RATE-002; the legacy module's vectors are unverified). Event Room shows "rating processing" until the flag is set (M05). Failure leaves `ratings_processed_at` null and retries; a half-written ledger is impossible by the single transaction.

### 5.5 Email adapter and delivery worker

Provider adapter interface `send(message) -> providerId | error` with the provider open (Resend per docs, SendGrid today; FEAT-000 OQ-05). Messages (C14) are **stored with audience first**, then the worker resolves recipients, writes `message_deliveries` rows (queued, sent, failed, with reason) and retries failures with backoff. Transactional email (registration confirmation, password reset, waitlist offer) uses the same adapter and template store. Email is the only channel at launch (FEAT-001 OQ-09); WhatsApp and SMS adapters, consent records and provider health are Later. Never log recipient lists or phone numbers (6.6).

### 5.6 Revalidation callout to Vercel

Outbound `POST {SITE}/api/revalidate` as specified in ARCH-001 section 9 (headers `X-PG-Timestamp`, `X-PG-Event-Id`, `X-PG-Signature: v1=...`; body `{ type, action, id, slug?, occurredAt, version }`). Event id must be inside the HMAC per section 3.10 and F-07. Signing details, replay window, tag mapping and response codes are **not repeated here**; TASK-113 extracts them and TASK-022 ships shared signing vectors. Backend obligations: write an outbox row in the **same transaction** as the content change; a dispatcher (API after commit, scheduler as backstop) delivers it; treat 202 as done; on non-2xx or timeout retry up to 5 times with exponential backoff, same event id, fresh timestamp and signature; alert when attempts are exhausted; `version` is the entity's monotonic version per OD-06. Secrets: `REVALIDATE_SECRET` shared with the web app (rotatable with an overlap, ARCH-001 17.2), `SITE` URL per environment. The web side's 15-minute safety net heals a miss but the 60-second publish target depends on this call.

**Webhook types for privacy and purge (F-15).** The `type` field in revalidation messages must include: `event`, `story`, `testimonial`, `site/{section}`, `media`, `legal`, `player` (for privacy opt-out or data deletion), and `result` (for player or minor photo purge). On `player` type with action `deleted`, `privacy_updated` or `emergency_purge`, and on `result` type with action `deleted`, the web app must expire the affected pages. Tags cannot be wildcarded and there is no `player:{id}` tag, so the contract is as follows (resolves ARCH-001-isr-revalidation section 6 D-2; PLAN-002 BE-00 = PLAN-001 TASK-127):

| type | actions | Body `id` / `slug` | Backend obligation | Web tags expired (proposal, to be added to the 9.4 table) |
|---|---|---|---|---|
| `player` | `deleted`, `privacy_updated`, `emergency_purge` | player UUID; no `slug` | One call per player id (the body has a single `id`; never a list). `privacy_updated` is emitted when any public-identity field, photo, display name, consent or guardian-consent flag changes, including a minor's consent being withdrawn. Also send one `event` / `updated` call (with slug) for every published event where the player appears in registrations, pairings, standings or results. | `events`, `past-events`, `site:home`, `stories`, `testimonials`, `sitemap` |
| `result` | `deleted` (also used for a withdrawn result) | result UUID; no `slug` | One call per result id, plus one `event` / `updated` call (with slug) for the owning event. | `events`, `past-events` |

Rules: `version` is the player's or result's monotonic counter (OD-06); `emergency_purge` must still increment it. Until the web handler implements these rows it answers `400` for these types, so the backend must treat `400` as a configuration failure and alert (not retry beyond the normal 5 attempts). Public identity fields are opt-in and default private; a minor shows initials only unless guardian consent is recorded (see the runbook). Image purge is not done by a webhook: the Storage object key is versioned and the `next/image` cache is handled as in OPS-003.

**Emergency purge.** If a guardian or legal request demands immediate removal of a minor's data or image, an authorised admin (never the customer UI) calls a step-up-protected admin endpoint that, in one transaction, withdraws consent or deletes the data, rotates or deletes the Storage object, writes an audit row, and writes `player` / `emergency_purge` outbox rows (one per id) plus the dependent `event` / `result` rows. The full procedure (who, when, what happens, verification) is in `OPS-003-privacy-purge-runbook.md`.

### 5.7 Other integrations

| Integration | Direction | Notes |
|---|---|---|
| Razorpay API | outbound | Create order, fetch payment, refund. Keys in backend secrets only; public `keyId` returned in R04 |
| Supabase Storage | outbound | Issue signed upload URLs (S07), verify objects (S08), public-read published media, signed read URLs for drafts (FEAT-001 OQ-14) |
| Google OAuth | both | Flagged, A08 to A10 |
| Preview exchange | inbound from Vercel | `POST /api/preview/exchange` with `PREVIEW_SECRET` (3.10) |
| Legacy data migration | one-off | Mapping tables and reconciliation counts and money totals (F-NFR-008); separate from the Seoul to Singapore database move, which the owner runs |

## 6. Security and privacy requirements

### 6.1 Known legacy defects the new backend must not reproduce (FEAT-000 F-NFR-004, F-03, PLAN-001 section 4)

**Encoding as conformance tests (F-03).** Each legacy defect below is encoded as a negative conformance test (section 4.6) with test id `NCT-L#`. The backend plan's TASK-092 suite must fail on any reproduction of these defects. The conformance suite runs against the live backend at `CONTRACT_BASE_URL`; failure blocks TASK-101 sign-off.

| # | Legacy defect (evidence in `backend/`) | Requirement | Conformance test | Where enforced |
|---|---|---|---|---|
| L1 | **Anonymous registration list leak.** `GET tournaments/{id}/registrations/` is public and returns `user_email`, `user_name`, `user_city`, `razorpay_payment_id`, `razorpay_order_id`. Related: `GET tournaments/profile/?user_id=` returns any user's full record (email, phone, birthday) to anyone, and `GET .../rounds/` is public with pairings. | No public or player endpoint may return another person's email, phone, birthday, provider ids or payment state. Registration lists exist only as admin endpoints (C02, G04). Other players appear only through the public-identity subset (M15 flags). Public DTOs are separate types; a contract test scans public responses for emails, phones and provider ids (AC-103). | NCT-L1 | P02, P03, C02, M05 |
| L2 | **Non-idempotent rating update.** `update-ratings` re-rates every time it is called and keeps no ledger. | Finalise is idempotent by `ratings_processed_at` and `Idempotency-Key`; Glicko-2 uses one pre-round snapshot; ledger rows are append-only with a unique `(round, player, pool)` key; the whole update is one transaction (5.4). | NCT-L2 | C12, 5.4 |
| L3 | **Signature-only payment verify.** `verify` checks the HMAC of `order|payment` and marks `paid`; it never confirms the payment with Razorpay, the amount, currency or status, and any admin PATCH can also set `payment_status`. | Verify fetches the payment from Razorpay and checks order id, exact amount, currency and acceptable status against the server-owned order, then writes the ledger and confirms the registration. A webhook provides asynchronous reconciliation. Payment and registration state change only through verify, webhook, refund and cancel (DEC-B04). | NCT-L10 | R05, W01, C03 |
| L4 | **Status change in GET.** `GET tournaments/` runs an `UPDATE` promoting past-due events to `ongoing`. | All GETs are side-effect free (and safe to cache). Status transitions run on the scheduler (5.2). A test asserts no write occurs during any GET. | (implicit in all endpoints) | 5.2 |
| L5 | Weak password policy (minimum 6) and reusable reset token. | Stronger minimum enforced server side (FEAT-000 OQ-13 default); reset token single use; reset revokes refresh families. | NCT-L5 | A01, A07 |
| L6 | Refresh rotation never invalidates the old token; logout revokes nothing. | Family revocation and reuse detection (2.4). Absolute lifetime enforced. Role re-read on each refresh. | NCT-L3 | A03, A04, 2.4 |
| L7 | No capacity or registration-window check on registration; free events set `paid`. | Atomic eligibility check in R02. | NCT-L7 | R02 |
| L8 | CORS with credentials from a list; admin role read from the JWT claim. | No CORS dependence (2.11); admin role read from the database on each admin request (6.2). | NCT-L4, NCT-L8, NCT-L13 | 2.11, 6.2 |
| L9 | Unpaginated lists; no rate limiting; no request ids. | 2.3, 2.10, 2.1. Every response has `meta.request_id` and `meta.pagination`; public and auth endpoints are rate-limited. | NCT-L6, NCT-L9 | all |
| L10 | No Razorpay webhook; payment marked only by browser call. | The backend receives and validates the Razorpay webhook; browser verify is a hint only. Webhook is the source of truth for payment state. | NCT-L10 | W01, section 5.1 |
| L11 | No hold or capacity check on order; no timeouts or idempotency. | Order creation requires a live hold. Timeouts on all external calls. Idempotency-Key required. | NCT-L11 | R04, 2.5 |
| L12 | CSV export: formula injection and header injection. | Any CSV export prefixes `= + - @` with `'` in every cell. Filenames are sanitised. | NCT-L12 | C17, 6.5 |
| L13 | CORS with credentials from a list. | Same-origin only via the rewrite; no CORS headers. | NCT-L13 | 2.11 |
| L14 | No HSTS, secure cookie or proxy SSL settings behind Railway. | Security headers set: HSTS, nosniff, deny framing, cache control, no-store on authenticated responses. | NCT-L14 | 6.2, 2.12 |
| L15 | Admin writes arbitrary `payment_status` and `score` with no audit. | Every privileged mutation is audited: actor, action, object, before, after (section 6.5). Audit is append-only. | NCT-L15 | 6.5 |
| L16 | DRF `next` absolute URLs and flat error shapes. | Pagination uses page numbers, not `next` URLs. Returned URLs are relative paths, not absolute. | NCT-L16 | 2.3, 3.10, 6.3 |

### 6.2 Authentication and authorisation

- Every endpoint declares its role. The default for new endpoints is **deny** (authenticated, explicit role), not public.
- Roles are `player` and `admin` at launch (FEAT-000 OQ-02 default). The role lives in a server-owned store with **no client write path**; only G03 changes it, audited. Role is read from the database (or a cache invalidated on change) on admin requests, never trusted from a long-lived token alone.
- Object-level checks on every player endpoint: a caller reaches only their own registrations, payments, snapshot and pairing. The Event Room snapshot returns the caller's own pairing and public standings only.
- Field-level tiers on admin writes: editorial copy versus operational fields (capacity, payment, pairing, eligibility, rating) with stronger permission and audit (F-ADEV-020).
- Admin MFA is Later (FEAT-000 OQ-14); the design must not preclude it.
- Passwords: strong adaptive hash; no password or token in logs; login and reset paths timing-neutral for unknown emails.

### 6.3 Input and output safety

- All CMS, story, testimonial, legal, event and profile text is stored as plain text or the closed block model; **no HTML**. The server validates field types, lengths and URL schemes (`http`, `https`, `mailto`, `tel`); the frontend renders as inert text (ARCH-001 17.1). Do not sanitise by stripping and trust; reject.
- Media: type and size allow-list before issuing an upload URL, magic-byte check on completion, EXIF stripped, dimensions stored, no executable types, object keys not guessable for drafts.
- Public DTOs are minimal (AC-103). Draft content never appears on public endpoints; preview needs a valid `previewKey` scoped to the entity.
- Settings never store or return secrets (G07). Integration health returns booleans only.
- Open redirects: the backend returns only server-chosen paths (relative, starting with `/`); OAuth `state` and redirect targets are validated against an allow-list.
- **Backend-supplied absolute URLs (F-16 decision).** All URLs returned by the backend (media URLs from Storage, checkout links from Razorpay, signed upload URLs, preview links, OAuth start URLs, pagination next links if used) must resolve to an allow-listed same-origin host. A configuration constant `BACKEND_PUBLIC_HOSTS` lists the allowed hosts (e.g., `storage.example.com`, `checkout.razorpay.com`). The frontend never follows a URL with a bearer token unless the resolved origin is `location.origin` (or configured trusted hosts). The backend must validate that any absolute URL it builds or returns is on the allow-list before sending it in the response.

### 6.4 Supabase lockdown (OQ-06, F-NFR-004)

Supabase is Postgres and Storage hosting only; **the backend owns all data access**. Requirements: the auto-generated Data API (PostgREST) must be unreachable: either disable it or enable row-level security with **no policies** on every table (including future ones: add a CI check that fails if any table in the exposed schemas has RLS off); revoke default grants to `anon` and `authenticated` on application schemas; no anon or service-role key in any client, in the web app or in frontend env vars; the service-role key and database URL live only in Railway secrets; Storage buckets: published media public-read, drafts private with signed URLs, writes only through backend-issued signed uploads; connection through the pooler in transaction mode (no session-level state, no server-side cursors if Django, no long transactions holding a pooled connection across external calls). A separate staging Supabase project and Railway environment; paid plan with daily backups **before real payments** and a tested restore. Note: the reference docs' RLS policy rules (AUTH-SECURITY) are design intent for object-level rules and become server-side checks here (FEAT-000 section 1).

### 6.5 Audit log

`audit_log` is append-only and written in the same transaction as the mutation. Each row: `actor_id`, `actor_role`, `action`, `object_type`, `object_id`, `before`, `after` (redacted of secrets and PII beyond ids), `request_id`, `ip` (coarse, inferred), `occurred_at`. Required for: event create, update, publish, unpublish, cancel and complete; round generate, edit, publish, correct, finalise; result overrides and dispute resolution; check-in overrides; registration actions; refunds and reconcile; role changes; CMS, legal, story, testimonial and media publish and delete; settings changes; message sends. Read endpoints C17 (event scope) and a global read for admins; export for the event audit view. If the audit write fails the mutation fails (**policy inferred**; FEAT-000 lists "policy if audit is unavailable" as open in UI-STATES, so confirm). No UPDATE or DELETE grant on the table for the application role.

### 6.6 Logging, privacy and retention

- Never log tokens, Razorpay secrets, signatures, raw bodies of payment or auth requests, full phone lists, service-role keys or message bodies. Log `request_id`, route, status, latency, actor id.
- Private versus public identity is enforced in data and API (separate projections); retention period, deletion and export requests are open (FEAT-000 OQ-16, F-LEG-004 Later).
- Consent: testimonial consent timestamp is mandatory to publish; channel consent for WhatsApp/SMS is Later and legal-reviewed.
- Analytics intake, if built, is first-party and pseudonymous (F-ANA-003); none is required at launch (FEAT-001 NG-12).
- Security headers on the API: `X-Content-Type-Options: nosniff`, `Cache-Control` per 2.12, HSTS at the edge. CSP for the web app is a frontend concern (ARCH-001 section 10).

### 6.7 Observability requirements

`meta.request_id` equals `X-Request-ID`; accept an inbound request id from the Vercel proxy and log it. Metrics and alerts (provider open): webhook signature failures and processing errors, hold expiries per hour, reconcile mismatches above zero, revalidation attempts exhausted, rating job failure, 5xx and 429 rates, queue depth of the message worker.

## 7. Candidate backend task list (handoff note)

Headline items only. This is **not a plan**: no estimates, no ordering, no owners, no dependencies beyond what is stated in the contract. The backend PLAN (a separate document, after OQ-18) decides sequence and splitting. Feature tiers (MVP, Launch, Later) are in FEAT-000.

1. **Decide the backend direction** (OQ-18): extend the Django app or rebuild; record an ADR. Everything below applies to either.
2. **Platform conventions**: envelope renderer and exception handler, stable error codes (tiers A and C), pagination, request ids, `Idempotency-Key` store, rate limiting, trusted-proxy handling, health endpoint, structured logging.
3. **Data model and migrations**: target tables (data_changes in the front matter), pooler-compatible access, `legacy_id_map`, reconciliation counts and money totals, Supabase lockdown with a CI guard.
4. **Auth and accounts**: register, login, rotating refresh with reuse detection, logout, `me`, password reset, role store, seeded admins, optional Google flow behind a flag.
5. **Public projections and CMS publishing**: site sections, events by slug, availability, past events, stories, testimonials, legal, sitemap entries; draft and publish with versions; slug rules.
6. **Revalidation outbox and preview exchange**: signed callout per ARCH-001 section 9, retries, scheduler-emitted state changes, `/preview/exchange`.
7. **Registration engine**: atomic eligibility, capacity, holds, waitlist and offers, free confirmation, cancel, idempotency.
8. **Payments**: Razorpay order, hardened verify, webhook with dedupe, ledger, refunds, reconcile, late-capture rule.
9. **Player area reads**: next-up, my events, profile and public identity, preferences, ratings pools, ledger and trend.
10. **Event Room**: snapshot with capability flags and change marker, self check-in, result submit, confirm, dispute.
11. **Pairing and rating engine**: round lifecycle with draft and versioned publish, Swiss and balanced social generators, byes, finalise once, Glicko-2 on known vectors, rating ledger.
12. **Admin events and control room**: builder drafts and field locking, event actions, registrations and check-in desk, payments tab, messages, recap and archive, audit read.
13. **Media and storage**: signed uploads, asset and collection records, referenced-asset protection, EXIF stripping.
14. **Admin players, payments, settings, roles, audit**: including the audit log write path.
15. **Jobs**: scheduler (holds, offers, transitions, reconcile, reminders, retries) and worker (email delivery, rating processing).
16. **Communications**: email adapter, state-triggered messages, audience selection, delivery state.
17. **Contact intake** and destination config.
18. **Conformance**: deploy the TASK-022 export as the test target, run the TASK-092 suite against `CONTRACT_BASE_URL`, and a staging environment wired to the web preview (revalidation round trip with TASK-116).
19. **Security verification**: tests for L1 to L9 in section 6.1, public-response PII scan, admin-endpoint authorisation matrix, webhook forgery tests.
20. **Hosting setup**: Railway services and environments, Supabase Singapore project (owner-run move), secrets including `REVALIDATE_SECRET`, `PREVIEW_SECRET`, Razorpay keys and webhook secret, backups before payments.

Deliberately not listed (Later or hidden at launch): rematch, member/comp/donation pricing, WhatsApp and SMS, waivers, host (event-scoped) permissions, venues table, in-app notification inbox, admin MFA, receipts and tax invoices, data export and deletion tooling, league and workshop engines, contact inbox UI.

## 8. Open questions, discrepancies and inferences

### 8.1 Decisions and owner questions

**Resolved by this update (2026-10-22):**

| Decision | Owner status | Impact |
|---|---|---|
| OD-01: Token mode selection (2.4) | ACCEPTED | Both modes in contract; frontend change inside `browser/tokens.ts`. For mock-backed build, body mode OK. For launch, httpOnly cookie required (or documented waiver with compensating controls). Backend specifies mode at deploy; frontend receives token in both modes and handles storage. |
| OD-06: Per-entity monotonic version and per-instance revalidation dedupe (3.10, 5.6) | ACCEPTED | Every revalidatable entity has `version` BIGINT that increments on every change. Backend provides `version` in all responses. Revalidation dedupes by event id within 300 s window (idempotent operation). No global nonce store required. |

**Open questions for the owner:**

| # | Question | Why it matters here | Default used in this document |
|---|---|---|---|
| Q1 | OQ-18: extend Django or rebuild? | Decides how much of section 4's `partial` rows is reused | None; contract is neutral |
| Q2 | Refund and cancellation rules, hold length, waitlist offer window, late-capture behaviour (FEAT-000 OQ-07, OQ-08; FEAT-001 OQ-17) | R02, R07, R08, W01 behaviour | Full refund until the per-event window; 10 minute hold; 2 hour offer; auto-refund on late capture |
| Q3 | Password policy and email verification (OQ-13) | A01, A07 | Stronger minimum, no verification at launch |
| Q4 | Which email provider and the contact destination (OQ-05, FEAT-001 OQ-10) | P11, 5.5 | Adapter; provider open |
| Q5 | Accept tier C error codes (2.2) and inferred conventions | Frontend copy map and conformance suite | Proposed; define in TASK-022 export |
| Q6 | If the audit log write fails, does the privileged mutation fail? (6.5) | Availability versus accountability | Fails (strict) |
| Q7 | Initial admin emails (OQ-17) | G03, seeding | Owner supplies before staging |
| Q8 | Is a server `.ics` endpoint wanted, or is frontend-generated calendar enough? | F-PLY-005 | Frontend-generated |

### 8.2 Discrepancies found in the source documents (resolved here)

1. **Preview exchange path (resolved).** ARCH-001 8.4 writes `POST {API_INTERNAL_URL}/preview/exchange` while all other calls are under `/api/*`. Decision: the backend path is `/api/preview/exchange` to match the rewrite model (`/api/:path*` → `${API_INTERNAL_URL}/api/:path*`). ARCH-001 should read `/api/preview/exchange` where it says `{API_INTERNAL_URL}/preview/exchange`. Updated in section 3.10 and open questions below.
2. **Idempotency header name (resolved).** `openapi.yaml` says `x-idempotency-key`; ARCH-001 11.8 and this document say `Idempotency-Key`. **Decision: `Idempotency-Key` (title case)** per ARCH-001 wins; corrected in 2.5.
3. **Edge Functions versus HTTP endpoints.** The reference docs name seven Supabase Edge Functions (`create-payment-order`, `verify-payment`, `check-in`, `generate-pairings`, `finalize-round`, `admin-set-role`, `send-event-message`) and public reads through RLS. These are design intent (FEAT-001 C-11); here they map to R02 and R04 (split), R05, M06, C07, C12, G03, C14. Reading public data via direct Supabase queries is **not** allowed (6.4).
4. **Screen count.** TASK-004 and PLAN-001 say "58 screens"; FEAT-001 has 59 (adds story detail). This document covers 59.
5. **Pagination style.** DEC-011 names page-number pagination; cursor pagination might suit the ledger and audit later. Kept page-number (DEC-B02).
6. **Story entity name.** `editorial_stories` (DATABASE-SCHEMA) versus `cms_stories` (ROUTE-DATA-MATRIX); to be reconciled in the schema (FEAT-000 section 4 already notes it).
7. **Legacy status of Media and Community.** FEAT-000 rates screens 6 and 34 features `partial` because the old frontend had hard-coded content; this matrix rates the backend `no`.
8. **Results flow is player-driven.** FEAT-000 OQ-01 and FEAT-001 OQ-02 default: either player submits, opponent or host confirms, admin resolves. Host is not a launch role, so "host confirms" means an admin acting at the desk (C11) until host permissions exist (FEAT-000 OQ-02).

### 8.3 Inferred items and tasks for the backend PLAN

Tier C error codes (2.2 list is proposed; define in TASK-022 export); camelCase `data` keys; `meta.pagination` field names; slug length bounds (3 to 80 chars per 2.7, enforced per 8.2 item 2 and F-08); cache header values; rate-limit numbers; endpoint paths and splits (R02/R04, R08, P12, A08 to A10, S-series, C-series paths); `page_size` for sitemap entries (up to 1000 per 3.1); the 10-second refresh replay grace (2.4); unpublish rule (E08); last-admin guard (G03); scheduler cadences; audit-failure policy; job names; `BACKEND_PUBLIC_HOSTS` allow-list (6.3 F-16). Additional backend PLAN tasks: (a) encode negative conformance tests NCT-L1 to NCT-L16 in TASK-092; (b) verify signature construction per F-07 (event id in HMAC, validate format, equal-length compare, streaming cap, 202 on duplicate); (c) implement per-entity `version` columns for all revalidatable entities; (d) add `player` and `result` webhook types with emergency purge runbook (F-15); (e) add `/admin/auth/step-up` endpoint if launching with localStorage waiver; (f) validate route param slugs against regex before fetch (F-08); (g) update ARCH-001 section 8.4 to say `/api/preview/exchange` instead of `{API_INTERNAL_URL}/preview/exchange` (resolved in 8.2 item 1). The machine-readable export (TASK-022) fixes the final names and field types.
