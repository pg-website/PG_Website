# PLAN-002: Remaining Work (Backend first, then Frontend)

**Derived from:** `PLAN-001-frontend-rewrite.md` (v6) + the actual state of `backend/` and `web/` on 2026-10-27.
**Scope:** build work only. **Excluded by owner request:** security review and testing (TASK-006/101 reviews, all `test-engineer` tasks 009/059/092-098/116, code audit 110). Cutover (TASK-106 to 109) stays gated and is not planned here.
**Execution model:** two stages, **strictly serial**. Stage B (backend) finishes completely, then Stage F (frontend) starts. Tasks inside a stage run one after another in the order listed.
**Contract sources:** `docs/architecture/ARCH-001-backend-contract.md` (endpoint IDs P/A/R/M/D/E/C/S/G below), `ARCH-001-isr-revalidation.md`, `ARCH-001-web-frontend.md`.

---

> **Progress (2026-10-31):** [x] = done. Stage B: ALL 16 items COMPLETE (BE-00 to BE-14 + BE-G). Stage F: 26/42 items done. FE-01 to FE-02, FE-12 to FE-14, FE-15 to FE-17, FE-25 to FE-33 complete. FE-03, FE-04, FE-09 to FE-11, FE-18 to FE-24, FE-34 to FE-40 and FE-G remain.

## 1. Current state (verified in the repo)

### Backend (`backend/`, Django 6.1 + DRF, extends existing app per OQ-18)

| Area | State | Evidence |
|------|-------|----------|
| Platform (`core`) | Done | Envelope, error codes, pagination, request ids, rate limit, idempotency store, client IP, health |
| Auth (`accounts`) | Done | A01-A10 (Google flow is a flagged stub), `/me/profile|public-identity|preferences`, body and cookie token modes, step-up grants, refresh rotation |
| Public reads (`content`) | Done (read side) | P01-P12, models for events, sections, stories, testimonials, legal, media, settings, contact, `RevalidationOutbox`, `dispatch_revalidation` command |
| Registration engine (`registrations`) | Mostly done | R01-R03, R06-R08, holds, waitlist, offers, `expire_holds_and_offers`; **R04/R05 are stubs** (`create_payment_order`, `verify_payment` refuse) |
| Player area | Done | M01-M16: next-up, my events, room snapshot, check-in, result submit/confirm/dispute, ratings pools/ledger/trend |
| Ratings | Engine exists | `ratings/glicko2.py`, `rate_round` command, append-only ledger, `RatingRun` |
| Admin API (`/api/admin/*`) | **Not started** | No admin urls, no audit log, no admin permission class |
| Razorpay | **Not started** | No order/verify, no `POST /webhooks/razorpay`, no `payment_webhook_events`, no refunds |
| Media upload | **Not started** | Models exist; no signed upload, EXIF strip, collections API |
| Pairing generation / round lifecycle API | **Not started** | Models exist (`registrations.Round/Pairing`); `tournaments/swiss.py` is legacy and unmounted |
| Preview exchange | **Not started** | `/api/preview/exchange` and `X-Preview-Key` reads missing |
| Communications | **Not started** | Email adapter, message log, deliveries, state-triggered mail, contact delivery |
| Scheduler/worker | Partial | Only `expire_holds_and_offers` and `dispatch_revalidation`; no `Procfile` worker/scheduler entries, no status-transition/reminder/reconcile jobs |
| Legacy apps | Unmounted | `tournaments/`, `payments/`, `gallery/` carry known defects (README "Legacy routes") |
| Tests | None (excluded by request) | |

### Frontend (`web/`, Next.js 16, mock-backed)

| Area                                                                                                                        | State                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Foundation, tokens, fonts, API client, query layer, auth context, guards, CSP/proxy, observability, revalidation route, SEO | Done                                                                                          |
| Design system primitives, Dialog/Drawer/Tabs/Table/Carousel, domain components, PublicNav/Footer/PlayerShell                | Done                                                                                          |
| Public site (Home, Play, Event detail + archive, Past events, Community, Stories + detail, Contact, Legal, 404)             | Done                                                                                          |
| Auth: Login, Signup, Reset, Welcome                                                                                         | Done                                                                                          |
| Player: Dashboard, My Events, Event Room (all 6 states), Rating ledger, Profile                                             | Done (Rating chart pending)                                                                   |
| Mock adapter: public, auth, player                                                                                          | Done; **admin mock fixtures pending**                                                         |
| Real adapter                                                                                                                | `lib/api/adapters/real.ts` exists, not yet verified against the live backend                  |
| **Placeholder pages (9 lines,** `PlaceholderPage`**)**                                                                      | All 14 admin routes, `/handoff` x3, `/auth/callback`                                          |
| **Stub routes (13 lines)**                                                                                                  | `/events/[slug]/register`, `/admin/events/[id]`, `/edit`, `/[tab]` (event room route is real) |

### PLAN-001 tasks superseded or stale

- TASK-125 (dual-mode tokens), TASK-120/121/122 (CSP, arch lint, observability), TASK-118/123 are **complete** in PLAN-001's front matter; keep them closed.
- TASK-105 (deploy config) was blocked on "the backend"; it becomes unblocked at the end of Stage B and is scheduled in Stage F.
- TASK-100 (fix QA findings), TASK-110, TASK-116 are dropped from this plan because they depend on the excluded testing/audit work.

---

## 2. Agents

| Agent | Used for |
|-------|----------|
| `architect` | BE-00 only (runbook/webhook types) |
| `backend-engineer` | All Stage B build tasks (Django 6.1 + DRF + PostgreSQL) |
| `code-reviewer` | One read-only gate at the end of each stage (BE-G, FE-G). Not a security/test task. |
| `frontend-engineer` | All Stage F tasks (Next.js 16, React 19, Tailwind v4; `react-best-practices` applies) |
| `workflow-controller` | Final READY/BLOCKED gate (optional, last) |

Handoff rule: Stage F does not begin until BE-G reports PASS and the endpoint checklist in section 5 is fully ticked.

---

# STAGE B: BACKEND (serial)

Order is chosen so each task only depends on earlier ones, and so the shared pieces (audit log, admin permission, outbox) land before the endpoints that need them. Same Django project, so migrations never run in parallel.

| # | ID | Task | Agent | Est | Depends on |
|---|----|------|-------|-----|-----------|
| 1 | [x] BE-00 | Privacy purge runbook and webhook types (= PLAN-001 TASK-127): add `player`/`result` revalidation types and emergency-purge runbook to the contract and an ops doc | architect | S | none |
| 2 | [x] BE-01 | Admin foundation: `IsAdmin` permission (`ADMIN_REQUIRED`), step-up enforcement helper, `AuditLog` model + `audit.write()` (strict: mutation fails if audit write fails, Q6 default), `/api/admin/` router, `Procfile` entries for `worker` and `scheduler` | backend-engineer | M | [x] BE-00 |
| 3 | [x] BE-02 | Revalidation completion: confirm signing is `timestamp.eventId.rawBody`, headers, 300 s window, 5 retries with backoff, per-entity monotonic `version`, new types (`player`, `result`), emit from every mutating service; `dispatch_revalidation` loop-safe for the scheduler | backend-engineer | M | [x] BE-01 |
| 4 | [x] BE-03 | Razorpay slice: R04 `POST /payments/orders` (server price, single order per registration), R05 `POST /payments/verify` (signature + provider fetch + exact amount/currency check), W01 `POST /webhooks/razorpay` (raw-body HMAC, `payment_webhook_events` dedupe, captured/failed/refund events, late-capture auto-refund rule), payment ledger, mismatch records. Use `requests` (already a dependency) | backend-engineer | L | [x] BE-02 |
| 5 | [x] BE-04 | Admin events and builder: D01 dashboard aggregates, E01-E06 (list, create draft, get, PATCH with `version` + `VERSION_CONFLICT`, slug check, event types), locked-fields rule, E07-E10 (publish with `blockers[]`, unpublish, cancel with async refunds via BE-03, complete) | backend-engineer | L | [x] BE-03 |
| 6 | [x] BE-05 | Rounds and pairings: C06-C12. Port `swiss.py` into a service (rated Swiss + social balanced, byes, colour balance), draft/publish/start, versioned post-publish edits with reason, admin result override/dispute resolve, finalise (idempotent) that triggers the existing `rate_round`/Glicko-2 run | backend-engineer | L | [x] BE-04 |
| 7 | [x] BE-06 | Control room data: C01 overview, C02/C03 registrations list and actions, C04/C05 check-in desk, C13 event payments, C16 recap, C17 audit read (+ CSV) | backend-engineer | M | [x] BE-05 |
| 8 | [x] BE-07 | Media and storage: S07 signed Supabase upload URL (type/size allow-list), S08 complete (verify object, dimensions, EXIF strip via Pillow), S09-S11 assets (alt, decorative, focal point, archive, `ASSET_IN_USE`), S12 collections; revalidation per referencing entity | backend-engineer | L | [x] BE-06 |
| 9 | [x] BE-08 | CMS admin: S01-S05 sections (draft/publish/versions), S06 legal, S13/S14 stories (closed block body, slug lock), S15/S16 testimonials (consent gate); publish emits revalidation | backend-engineer | L | [x] BE-07 |
| 10 | [x] BE-09 | Preview: PV01 `POST /admin/preview-link` (single-use, 5 min), `POST /api/preview/exchange` (bearer `PREVIEW_SECRET`, constant-time compare, allow-listed relative path, `previewKey`), `X-Preview-Key` draft reads with `Cache-Control: private, no-store` and `X-Robots-Tag: noindex` | backend-engineer | M | [x] BE-08 |
| 11 | [x] BE-10 | Admin players, payments, settings: G01/G02 players, G03 role change (last-admin guard, step-up), G04 payments ledger, G05 refund (Razorpay then payment+registration together), G06 reconcile, G07/G08 settings (allow-list, no secrets) | backend-engineer | L | [x] BE-09 |
| 12 | [x] BE-11 | Communications: email adapter interface (provider per OQ-05, default SendGrid already via anymail), template store, C14 messages (store first, 202, worker delivers, per-recipient state), C15 toggles, transactional mail (confirmation, reset, waitlist offer), P11 contact delivery to configured destination | backend-engineer | L | [x] BE-10 |
| 13 | [x] BE-12 | Scheduler and worker commands (idempotent, row-locked, log name + count): event status transitions (replaces any write-on-GET), reminders (24 h, check-in open, post-event), hourly reconcile, revalidation retry (30 s), daily token/idempotency cleanup, message delivery worker, rating processing worker; wire to `Procfile` | backend-engineer | M | [x] BE-11 |
| 14 | [x] BE-13 | Legacy retirement and data hygiene: remove or rebuild unmounted `tournaments/`, `payments/`, `gallery/` (keep `glicko2`/`swiss` only if still referenced), drop dead models via migration, Supabase lockdown migration (RLS on, no policies) with a check, update `backend/README.md` and `.env.example` (`PREVIEW_SECRET`, Razorpay, storage, email vars) | backend-engineer | M | [x] BE-12 |
| 15 | [x] BE-14 | Contract reconciliation: diff every implemented route against the contract section 3 and `web/src/lib/api/types/*`; fix response-shape drift on the backend side; produce `docs/architecture/pgapi-contract/ENDPOINTS-IMPLEMENTED.md` (this is the content of PLAN-001 TASK-022 from the backend side) | backend-engineer | M | [x] BE-13 |
| 16 | [x] **BE-G** | Backend gate: read-only review of the diff against ARCH-001-backend-contract and DEC-011 (envelope); verify section 5 checklist; PASS/FAIL list | code-reviewer | S | [x] BE-14 |

### Acceptance criteria per task (summary)

- **Every task:** routes follow the envelope and stable error codes; no trailing slashes; admin mutations audited; list endpoints paginated (`page_size` max 100); mutations that create money/registrations accept `Idempotency-Key`; `python manage.py check` and `makemigrations --check` clean; migrations apply on a local PostgreSQL; no secrets in code or logs.
- **BE-03:** the browser never supplies price, key or amount; `HOLD_EXPIRED`, `INVALID_SIGNATURE`, `PAYMENT_MISMATCH` returned as contracted; webhook repeat returns 200 with no side effects.
- **BE-04:** `NOT_PUBLISHABLE` carries `blockers[]`; `SLUG_TAKEN`; slug immutable after first publish; locked fields rejected once registrations/payments exist.
- **BE-05:** finalise returns the original result on the same idempotency key and `ROUND_ALREADY_FINALIZED` otherwise; rating deltas written in one transaction.
- **BE-09:** an anonymous `GET /api/events/{slug}` after a preview exchange returns published data or 404.
- **BE-12:** running any job twice has no extra effect.

### Stage B exit (all must be true to start Stage F)

1. All rows in section 5 are implemented.
2. Local run: `migrate`, `seed_*` commands, `runserver` OK; `AUTH_TOKEN_MODE` works in both `body` and `cookie`.
3. Revalidation call reaches the web `/api/revalidate` on a local dev site (manual check by the agent, no test suite).
4. BE-G PASS.
5. Owner-run items (not agent work) noted as open: Supabase Singapore move (RUNBOOK-001), Railway services, secrets, Razorpay account webhook config.

---

# STAGE F: FRONTEND (serial, starts after BE-G)

Same package (`web/`), so tasks run in the order below. All are `frontend-engineer`. DoD-S, DoD-P (public), DoD-G and DoD-R from PLAN-001 section 3 apply, minus the test and QA items excluded above (lint, typecheck and existing unit tests must stay green).

## F-A. Wire to the real backend

| # | ID | Task | PLAN-001 ref | Est | Depends on |
|---|----|------|--------------|-----|-----------|
| 1 | [x] FE-01 | Real adapter bring-up: finish `adapters/real.ts` for public, auth and player endpoints; env switch `NEXT_PUBLIC_USE_MOCKS=false`; `/api/*` rewrite to `API_INTERNAL_URL`; fix any DTO/zod drift against `ENDPOINTS-IMPLEMENTED.md`; update `types/*` and mocks to match | TASK-022 (frontend half) | M | BE-G |
| 2 | [x] FE-02 | Cookie token mode against backend `AUTH_TOKEN_MODE=cookie` (CSRF header, refresh/logout), step-up flow wired to `/auth/step-up` | TASK-125 follow-up | S | [x] FE-01 |
| 3 | FE-03 | Revalidation handshake: verify `/api/revalidate` accepts backend-signed calls (shared `REVALIDATE_SECRET`), tag mapping for new types (`player`, `result`, `media`, `legal`, `site/*`) | TASK-114 follow-up | S | [x] FE-01 |
| 4 | FE-04 | Draft preview: `/api/draft`, `/api/draft/exit`, preview banner, `createPreviewLink` in `PgAdminApi`, exchange with `/api/preview/exchange`, mock preview route | TASK-119 | M | FE-03, BE-09 |

## F-B. Remaining player-facing screens

| # | ID | Task | PLAN-001 ref | Est | Depends on |
|---|----|------|--------------|-----|-----------|
| 5 | [x] FE-05 | Registration frame: layout, parallel load, state resolver, ineligible states (screens 18-21 shell) replacing the 13-line stub | TASK-055 | L | [x] FE-01 |
| 6 | [x] FE-06 | Registration: free confirmation and success (19, 21) | TASK-056 | M | FE-05 |
| 7 | [x] FE-07 | Registration: waitlist join and accept-offer (20) | TASK-058 | S | FE-05 |
| 8 | [x] FE-08 | Registration: paid flow, hold countdown from `holdExpiresAt/serverNow`, lazy Razorpay checkout, confirming-payment polling | TASK-057 | L | FE-05, BE-03 |
| 9 | ⏳ FE-09 | OAuth callback screen (15), feature-flagged | TASK-052 | S | [x] FE-01 |
| 10 | ⏳ FE-10 | Rating trend chart (lazy, accessible, table alternative) | TASK-067 | M | [x] FE-01 |
| 11 | ⏳ FE-11 | Handoff routes: `/handoff`, design-system, UI states (mock/dev only; `notFound()` in production) | TASK-039 | M | FE-10 |

## F-C. Admin foundation

| # | ID | Task | PLAN-001 ref | Est | Depends on |
|---|----|------|--------------|-----|-----------|
| 12 | [x] FE-12 | **Revised (owner decision 2026-10-28):** no admin mocks. Replaced by a real admin adapter wired straight to the backend admin API (PgAdminApi real implementation: typed client, zod schemas from ENDPOINTS-IMPLEMENTED.md, step-up and idempotency support). Admin routes run against the real backend only | TASK-020 (replaced) | M | [x] FE-01 |
| 13 | [x] FE-13 | AdminShell: sidebar to drawer, role guard, step-up prompt integration | TASK-038 | M | [x] FE-12 |
| 14 | [x] FE-14 | Admin patterns: SplitWorkspace, FilterBar, SaveBar (dirty/publish, `VERSION_CONFLICT` UX), ConfirmAction | TASK-069 | M | [x] FE-13 |

## F-D. Admin screens (each built against the real admin API from Stage B)

| # | ID | Task | PLAN-001 ref | Screens | Est | Backend |
|---|----|------|--------------|---------|-----|---------|
| 15 | [x] FE-15 | Admin dashboard | TASK-070 | 32 | M | D01 |
| 16 | [x] FE-16 | Admin events list with state filters | TASK-076 | 37 | M | E01 |
| 17 | [x] FE-17 | Payments admin: ledger, mismatch, reconcile, refund | TASK-090 | 55 | M | G04-G06 |
| 18 | ⏳ FE-18 | Media library: grid, search, upload with progress (signed URL flow) | TASK-071 | 34 left | M | S07-S11 |
| 19 | ⏳ FE-19 | Media collection editor: static/carousel, order, alt, focal-point picker (lazy) | TASK-072 | 34 right | L | S12 |
| 20 | ⏳ FE-20 | Website CMS: per-section lazy editors, draft/publish, preview link | TASK-073 | 33 | L | S01-S06, PV01 |
| 21 | ⏳ FE-21 | Stories admin with slug rules and publish | TASK-074 | 35 | M | S13, S14, E05 |
| 22 | ⏳ FE-22 | Testimonials admin with consent/publish gating | TASK-075 | 36 | M | S15, S16 |
| 23 | ⏳ FE-23 | Players admin (search, record, role change with step-up) | TASK-089 | 54 | M | G01-G03 |
| 24 | ⏳ FE-24 | Settings admin (no secrets, integration status) | TASK-091 | 56 | M | G07, G08 |
| 25 | [x] FE-25 | Event Builder framework per DEC-023 (vanilla store, per-step RHF, debounce, one-step mobile mode, publish blockers) | TASK-077 | 38-45 | L | E02-E06 |
| 26 | [x] FE-26 | Builder steps 1-2: Basics (slug check) and Experience | TASK-078 | 38, 39 | M | E03/E04 |
| 27 | [x] FE-27 | Builder steps 3-4: Registration and Payment | TASK-079 | 40, 41 | M | E04 |
| 28 | [x] FE-28 | Builder steps 5-6: Game system and Media | TASK-080 | 42, 43 | M | E04, S12 |
| 29 | [x] FE-29 | Builder steps 7-8: Communications and Review/publish with SEO preview | TASK-081 | 44, 45 | M | E04, E07, C15 |
| 30 | [x] FE-30 | Control Room frame: header, summary strip, route-linked tabs (replaces the three `[id]` stubs) | TASK-082 | 46-53 shell | M | E03, C01 |
| 31 | [x] FE-31 | Control: Overview and Registrations | TASK-083 | 46, 47 | M | C01-C03 |
| 32 | [x] FE-32 | Control: Check-in desk (phone-first) | TASK-084 | 48 | M | C04, C05 |
| 33 | [x] FE-33 | Control: Pairings and rounds (draft/publish/start/finalise, post-publish reason) | TASK-085 | 49 | L | C06-C12 |
| 34 | ⏳ FE-34 | Control: Payments tab | TASK-086 | 50 | S | C13, G05 |
| 35 | ⏳ FE-35 | Control: Messages tab | TASK-087 | 51 | M | C14 |
| 36 | ⏳ FE-36 | Control: Gallery/recap and Audit tabs | TASK-088 | 52, 53 | M | C16, C17 |

## F-E. Delivery

| # | ID | Task | PLAN-001 ref | Est | Depends on |
|---|----|------|--------------|-----|-----------|
| 37 | ⏳ FE-37 | CI implementation per OPS-002 (workflows, CODEOWNERS, dependabot, supply-chain script, exceptions registry, PR template); fold contract stub decision OD-CI-01 (recommend: small in-repo stub or point build at the real staging API) | TASK-129 | L | FE-36 |
| 38 | ⏳ FE-38 | Performance budget check: First Load JS per route vs `budgets.json`, bundle-analyzer evidence for admin never loading on public routes, Lighthouse mobile run; fix regressions | TASK-099 | M | FE-37 |
| 39 | ⏳ FE-39 | Deployment config: Vercel (`sin1`) project settings, `/api/*` rewrite to Railway, env matrix (prod/staging/preview), Firewall and Deployment Protection per OPS-001, ISR persistence note | TASK-105 | M | FE-38 |
| 40 | ⏳ FE-40 (optional) | PWA basics (manifest, icons, offline page) | TASK-103 | S | FE-39 |
| 41 | ⏳ **FE-G** | Frontend gate: read-only review of `web/` against ARCH-001 and the web-frontend rule | code-reviewer | M | FE-39 |
| 42 | ⏳ FINAL | Workflow readiness gate (READY/BLOCKED) | workflow-controller | S | FE-G |

### Stage F exit

All 58 routes plus `/stories/[slug]` render real content (no `PlaceholderPage` left), `NEXT_PUBLIC_USE_MOCKS=false` works end to end locally, lint/typecheck/unit tests green, FE-G PASS. Cutover (PLAN-001 TASK-106 to 109) remains an owner-approved gate and is not started by this plan.

---

## 3. Dependency summary

```
BE-00 -> BE-01 -> BE-02 -> BE-03 -> BE-04 -> BE-05 -> BE-06 -> BE-07 -> BE-08
      -> BE-09 -> BE-10 -> BE-11 -> BE-12 -> BE-13 -> BE-14 -> BE-G
                                                                 |
                                                           (Stage F starts)
FE-01 -> FE-02, FE-03 -> FE-04 -> FE-05 -> FE-06..FE-08 -> FE-09 -> FE-10 -> FE-11
      -> FE-12 -> FE-13 -> FE-14 -> FE-15..FE-24 -> FE-25 -> FE-26..FE-29
      -> FE-30 -> FE-31..FE-36 -> FE-37 -> FE-38 -> FE-39 -> (FE-40) -> FE-G -> FINAL
```

Critical path: BE-03 (payments) -> BE-04/05 (events, rounds) -> BE-14 -> FE-01 -> FE-14 -> FE-25 -> FE-33 -> FE-39.

## 4. Totals

- Stage B: 17 items (1 architect, 15 backend-engineer, 1 code-reviewer). Rough size: 6 L, 6 M, 1 S build tasks.
- Stage F: 42 items (1 architect-free; 40 frontend-engineer incl. 1 optional, 1 code-reviewer, 1 workflow-controller).
- Tasks removed relative to PLAN-001's remaining list: all testing, security review, QA triage (TASK-100, 110, 116 and the test-engineer set).

## 5. Backend endpoint checklist (Stage B exit)

Already implemented, re-verify in BE-14: P01-P12, A01-A10, R01-R03, R06-R08, M01-M16.

To be implemented:

| Group | IDs | Task |
|-------|-----|------|
| Payments | R04, R05, W01 | [x] BE-03 |
| Admin events | D01, E01-E10 | [x] BE-04 |
| Rounds | C06-C12 | [x] BE-05 |
| Control room | C01-C05, C13, C16, C17 | [x] BE-06 |
| Media | S07-S12 | [x] BE-07 |
| CMS/stories/testimonials/legal | S01-S06, S13-S16 | [x] BE-08 |
| Preview | PV01, `/api/preview/exchange` | [x] BE-09 |
| Players/payments/settings | G01-G08 | [x] BE-10 |
| Communications | C14, C15, P11 delivery | [x] BE-11 |
| Jobs | hold/offer expiry (exists), status transitions, reminders, reconcile, revalidation retry, cleanup | [x] BE-12 |

## 6. Open decisions that affect scheduling (defaults used)

| # | Decision | Default used |
|---|----------|--------------|
| 1 | Email provider (OQ-05) | Keep SendGrid via anymail behind an adapter |
| 2 | Refund/cancel rules, hold 10 min, offer window 2 h, late-capture auto-refund | Contract defaults (section 8.1 Q2) |
| 3 | Audit write failure fails the mutation (Q6) | Strict |
| 4 | Initial admin emails (Q7) | Owner supplies before staging; seeded via command |
| 5 | Contract stub vs real staging API for CI builds (OD-CI-01) | Decide at FE-37 |
| 6 | Whether to keep mock-only admin fixtures long term | Keep for dev/preview (FE-12), not used in production |
