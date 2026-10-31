# PLAN-001 v5 Task Details: Phases 0 to 2 (TASK-001 to TASK-039, TASK-111/113/114/115/117, plus TASK-124-128)

Narrative companion to `docs/plans/PLAN-001-frontend-rewrite.md` (version 5). This file is **not** a `task.schema.yaml` document; the schema-shaped documents are the seven long-form files `TASK-010`, `-014`, `-057`, `-062`, `-064`, `-077`, `-085`. DoD-S (screen), DoD-G (general) and DoD-R (react-best-practices, Next.js edition) are defined in section 3 of the plan. Paths are relative to `C:\work\PG_Website`. Est = S/M/L. "RBP" = `.claude/skills/react-best-practices` (rule ids in parentheses). v5 adds Phase 0.5 (TASK-124-128) for SEC-001 follow-ups.

**Stack (v2):** Next.js App Router + TypeScript strict + Tailwind v4 in `web/`. Route groups `(public)`, `(auth)`, `(app)`, `(admin)`, `(handoff)` under `web/src/app/`. Public pages are Server Components, prerendered (static/ISR with on-demand revalidation). `(auth)`, `(app)` and `(admin)` are client-rendered behind auth and `noindex`. TanStack Query is used in client areas only. The mock adapter works on the server and in the browser.

**Backend stance (v2):** the whole codebase, backend included, is being replaced. The `PgApi` interface plus the mocks are the contract the new backend must satisfy. Product features come from `docs/requirements/FEAT-000-feature-inventory.md` (being written by the product-manager; referenced by path only). No task targets the current Django API.

**Hosting stance (v3, owner-confirmed):** Next.js on Vercel (Pro plan, functions pinned to Singapore `sin1`); backend on Railway Southeast Asia (Singapore) as API, worker and scheduler services; Supabase Postgres moving from Seoul to a new Singapore project (pooler, transaction mode); media in Supabase Storage; browser reaches the API through a Vercel `/api/*` rewrite to Railway; Razorpay webhooks go straight to Railway. See plan section 2 "Hosting & regions", TASK-115 and TASK-117.

## Phase 0: Gates and housekeeping

### TASK-001 FEAT-001 requirements: frontend rewrite scope
- **Owner:** product-manager | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** `docs/requirements/FEAT-001-frontend-rewrite.md` (template `templates/requirement.md`) with scope, personas, the 58 screens/states mapped to routes, mobile/a11y/SEO/performance requirements, out-of-scope list, and decisions already taken. Uses FEAT-000 (`docs/requirements/FEAT-000-feature-inventory.md`) as an input; FEAT-000 is a precursor to FEAT-001, not a replacement.
- **Dependencies:** none (consumes FEAT-000 when it lands)
- **Files:** `docs/requirements/FEAT-001-frontend-rewrite.md`
- **Notes:** Record explicit scope decisions: **old public Gallery page, tournament leaderboard and CSV export are dropped** (event gallery and recap in the reference design are kept). Record that the backend is out of scope and that prerendered SEO is a requirement for public pages.
- **Acceptance:** [ ] validates against `schemas/requirement.schema.yaml` [ ] all 58 screens listed with route and priority [ ] SEO/prerender, mobile and performance targets measurable [ ] dropped features listed [ ] open questions each owned [ ] user approves
- **Tests:** schema validation

### TASK-002 ARCH-001 web frontend architecture (Next.js, RBP conventions)
- **Owner:** architect | **Est:** L | **Risk:** high | **Status:** complete
- **Goal:** `docs/architecture/ARCH-001.md` covering: Next.js version and App Router layout with route groups; rendering strategy per route (static/ISR vs client-rendered); server/client component boundary rules; data fetching (server fetch with tags for public, TanStack Query for client areas); API client, envelope, error-code copy map; query-key scheme; mock strategy usable in server rendering; Tailwind v4 token strategy; next/font and next/image; auth token handling (Q2 decided); event-room polling; forms; dialogs; a11y and test strategy; performance budget; feature flags (`NEXT_PUBLIC_*`); CSP; SEO and structured data; slug rules; no Server Actions unless justified.
- **Rationale:** Golden rule: no implementation without approved architecture. **Adopts RBP as the governing React standard and records, for Next.js, which rule categories apply (see plan section 2).**
- **Dependencies:** TASK-001
- **Files:** `docs/architecture/ARCH-001.md`, optional ADRs in `docs/decisions/`
- **Notes (mandatory sections):** code splitting (automatic per route plus `next/dynamic` for heavy client features); data fetching and cache tags; parallel server fetching and Suspense/streaming boundaries; bundle conventions (no barrel imports, `optimizePackageImports` where a package must be barrel-imported, statically analysable import paths); initial JS budget measured against the empty-app baseline; `server-only` and `'use client'` boundaries; serialization limits across the boundary; "no module-level mutable request state, including in the mock layer"; versioned storage. **Hosting (v3): ARCH-001 takes the topology from plan section 2 "Hosting & regions" as given; the detail lives in TASK-115.**
- **Acceptance:** [ ] validates against `schemas/architecture.schema.yaml` [ ] every proposal P1 to P11 recorded as approved or superseded, with Next.js supersessions listed [ ] RBP applicability table matches plan section 2 [ ] defines the `PgApi` boundary used by TASK-016/017 and exported by TASK-022 [ ] numeric First Load JS and per-area budgets [ ] user approves
- **Tests:** schema validation

### TASK-003 Web-frontend rule, skill and agent guidance (references RBP)
- **Owner:** architect | **Est:** S | **Risk:** medium | **Status:** complete
- **Goal:** New `.claude/rules/40-frontend-web.mdc` (globs `web/**`), web skill, frontend-engineer agent update, `00-team.mdc` roster line, `30-planning.mdc` (path and `owner`). **The web rule and skill must name RBP as the governing standard, state that for this Next.js app `server-*` and Next rules apply, and encode DoD-S/G/R.**
- **Rationale:** Blocker B2: existing guidance steers engineers to Expo/StyleSheet/`frontend/screens/`.
- **Dependencies:** TASK-002
- **Files:** `.claude/rules/40-frontend.mdc`, `.claude/rules/40-frontend-web.mdc` (new), `.claude/rules/00-team.mdc`, `.claude/rules/30-planning.mdc`, `.claude/skills/frontend/SKILL.md` or sibling, `.claude/agents/frontend-engineer.md`
- **Acceptance:** [ ] no instruction tells a `web/` engineer to use Expo/React Native/StyleSheet [ ] web rule cites RBP and its priority order (waterfalls, bundle, server, client fetching, re-render, rendering, js) [ ] rule states server/client boundary rules and "no mutable module state during server render" [ ] agent lists RBP among skills [ ] planning rule and schema agree on `owner`
- **Tests:** manual review

### TASK-004 Backend contract and gap matrix (what the new backend must satisfy)
- **Owner:** architect | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** `docs/architecture/ARCH-001-backend-contract.md`: for each of the 58 screens, the data and mutations the screen needs, expressed as the `PgApi` methods and their payloads, with a status column derived from FEAT-000 and from the old Django code (kept only as reference for field semantics, not as a target). Includes cross-cutting requirements: unified envelope, error codes, `slug` on events and stories (unique, immutable once published; UUID stays the internal id), revalidation webhook (TASK-113), idempotency keys, availability endpoint, event-room snapshot, token model.
- **Rationale:** Reframes the former gap matrix as the contract the new backend must satisfy; becomes the handoff to a separate backend PLAN.
- **Dependencies:** TASK-001
- **Files:** `docs/architecture/ARCH-001-backend-contract.md`
- **Notes:** Source of truth for features is `docs/requirements/FEAT-000-feature-inventory.md`. Do not plan backend tasks in detail. The hosting facts that touch the contract (single origin via the Vercel `/api/*` rewrite, Razorpay webhooks straight to Railway, Railway worker/scheduler for jobs, pooler-compatible database access) are summarised in plan section 4 and detailed in TASK-115.
- **Acceptance:** [ ] each of the 58 screens maps to PgApi methods [ ] slug, envelope, revalidation, idempotency and token rules stated [ ] FEAT-000 feature ids are cross-referenced [ ] no estimates or ordering for backend work
- **Tests:** manual review

### TASK-005 Asset inventory: fonts, imagery, brand mark
- **Owner:** product-manager | **Est:** S | **Risk:** medium | **Status:** complete
- **Goal:** `docs/designs/asset-inventory.md`: font sources and licences (build-time self-hosting through `next/font`, Google or local files), every reference image URL with slot, widths and ship/replace/placeholder decision, logo availability, **image host/CDN for `next/image` `remotePatterns`: decided in v3 (Q16) as Supabase Storage; record the bucket host and any local-image fallbacks**, no hot-linking in production.
- **Dependencies:** none
- **Acceptance:** [ ] each font has source, licence, file plan [ ] each image has a status [ ] hot-linking and image host decisions recorded
- **Tests:** manual review

### TASK-006 Security design review of ARCH-001
- **Owner:** security-reviewer | **Est:** S | **Risk:** medium | **Status:** complete
- **Goal:** `docs/reviews/SEC-ARCH-001.md` (template `templates/security-review.md`): token handling (short-lived access token in memory, refresh token in versioned storage, confirm acceptable under Q2), CSP including Next inline script/nonce needs and Razorpay, revalidation webhook authentication and replay protection, guards are UX only, CMS content rendering and JSON-LD escaping, mock-mode safety in production builds, server/client secret separation (`REVALIDATE_SECRET`, `API_INTERNAL_URL`), dependency policy.
- **Dependencies:** TASK-002
- **Acceptance:** [ ] validates against the security-review schema [ ] no critical/high finding without agreed mitigation in ARCH-001
- **Tests:** schema validation

### TASK-113 ISR and revalidation strategy and webhook contract
- **Owner:** architect | **Est:** M | **Risk:** high | **Status:** complete
- **Goal:** `docs/architecture/ARCH-001-isr-revalidation.md`: which public routes are static, ISR or on-demand; cache tags (`events`, `event:{slug}`, `past-events`, `site:home`, `site:nav`, `stories`, `story:{slug}`, `testimonials`, `legal:{page}`); time-based safety-net `revalidate`; `generateStaticParams` (upcoming plus latest 50 completed) with `dynamicParams` for the rest; the **webhook contract the new backend must call when an admin publishes**: `POST /api/revalidate`, HMAC-SHA256 signature over the raw body in `X-PG-Signature`, timestamp header with a 5 minute replay window, body `{type, action, id, slug?, occurredAt, version}` where type is event, story, testimonial, site, media or legal and action is published, updated, unpublished, deleted, cancelled or completed; idempotent, 202 response; mapping from each (type, action) to tags and paths; how volatile data (availability, registration state) is **not** baked into HTML: a client island fetches live availability, the prerendered HTML shows last-known text with reserved space.
- **Rationale:** Prerendering is mandatory (Q7); staleness rules must be explicit before any public page is built.
- **Dependencies:** TASK-002, TASK-004
- **Files:** `docs/architecture/ARCH-001-isr-revalidation.md`
- **Notes (v3):** The caller is the Railway backend (API or worker) and the receiver is the Vercel `/api/revalidate` route; both read the same shared secret (`REVALIDATE_SECRET`) from their own environment. The webhook goes directly Railway to Vercel, not through the `/api/*` rewrite.
- **Acceptance:** [ ] every public route has a rendering mode and tag set [ ] webhook payload, signature, replay protection and error responses specified [ ] volatile-data rule stated [ ] published, unpublished, cancelled and completed event flows described end to end [ ] slug immutability and unpublished-event behaviour (404 for drafts, archive for completed, cancelled page for cancelled) specified [ ] reviewed by TASK-006
- **Tests:** manual review

### TASK-115 Hosting and runtime note: Vercel (sin1) + Railway (Singapore) + Supabase (Singapore)
- **Owner:** architect | **Est:** S | **Risk:** medium | **Status:** complete
- **Goal:** `docs/architecture/ARCH-001-hosting.md` documenting the owner-confirmed hosting topology (Q15 and Q16 resolved) so that ARCH-001, TASK-105 and the backend plan share one source:
  - **Frontend:** Next.js on Vercel. The Pro plan is needed for commercial use. Vercel functions are pinned to Singapore (`sin1`) (`vercel.json` or project region setting). Note the ISR persistence, on-demand revalidation and `next/image` optimiser behaviour on Vercel.
  - **Backend:** Railway, Southeast Asia (Singapore) region: an API service, a worker and a scheduler/cron service (hold expiry, reminders, rating processing, emails). Services share one repo or image per ARCH-001/backend plan; this note only fixes regions, service roles and networking.
  - **Database:** Supabase Postgres in a new Singapore (ap-southeast-1) project, moving from ap-northeast-2 (Seoul); the move itself is TASK-117. The backend connects through the Supabase connection pooler in transaction mode; if the backend is Django, server-side cursors must be disabled (`DISABLE_SERVER_SIDE_CURSORS`), and long-lived session features (advisory locks, `LISTEN/NOTIFY`, prepared statements) are avoided or use the direct connection for migrations only. Paid plan with daily backups before real payments.
  - **Media:** uploads go to Supabase Storage; its host is added to `next/image` `remotePatterns` (resolves Q16); state whether large uploads use signed upload URLs straight from the browser to Storage or go via the API.
  - **Environment matrix:**
    | Environment | Frontend | Backend | Database / Storage | Notes |
    |-------------|----------|---------|--------------------|-------|
    | production | Vercel production (`sin1`) | Railway production (API, worker, scheduler) | Supabase production project (Singapore, paid plan, daily backups) | `NEXT_PUBLIC_USE_MOCKS` forbidden |
    | staging | Vercel staging domain or preview alias | Railway staging environment | separate Supabase staging project | Razorpay test keys; used to verify TASK-105 |
    | preview | Vercel preview deployments per PR | none (mock mode by explicit opt-in only) | none | no real data, no secrets beyond preview-safe values |
  - **Environment variables**, split server-only vs public: server-only `API_INTERNAL_URL` (Railway API service URL used by server fetches and the rewrite destination), `REVALIDATE_SECRET` (shared HMAC secret, set in both Vercel and Railway, never in client code); public `NEXT_PUBLIC_API_BASE_URL` (relative `/api`, same origin), `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_USE_MOCKS`, `NEXT_PUBLIC_GOOGLE_AUTH`, `NEXT_PUBLIC_RAZORPAY_ENABLED`, `NEXT_PUBLIC_CONTACT_MODE`, Supabase Storage host (config, not a secret). Railway-side secrets (database URL via pooler, Razorpay keys and webhook secret, email provider key) are listed by name only, with the environment each belongs to.
  - **API access:** the browser calls the API through a Vercel rewrite `/api/*` to the Railway API service (`next.config.ts` `rewrites` or `vercel.json`), giving one origin: no CORS, and the refresh token can later move to an httpOnly cookie. Confirm rewrite behaviour for request body size, timeouts and cookies, and note `/api/revalidate` is a Next route handler that must take precedence over the rewrite.
  - **Webhooks:** Razorpay webhooks go straight to the Railway API service (not through Vercel). Django-to-Vercel publish revalidation uses the HMAC-signed `/api/revalidate` route (TASK-113, TASK-114) with the shared secret in both environments.
  - **Supabase lockdown** is referenced here and detailed in TASK-117.
  - **Open:** OQ-18 (extend the Django app or rebuild) stays open; record that this topology works either way.
- **Rationale:** The owner has decided the hosting; the architecture and deployment tasks need one written source with regions, env matrix and rewrite details, and the pooler/cursor constraint must reach the backend plan.
- **Dependencies:** TASK-002
- **Blockers:** none (Q15 and Q16 resolved by the owner).
- **Files:** `docs/architecture/ARCH-001-hosting.md`
- **Acceptance:** [ ] regions recorded (Vercel `sin1`, Railway Singapore, Supabase ap-southeast-1) [ ] env matrix (production, staging, preview) and the server-only vs public variable list complete [ ] rewrite `/api/*` to Railway specified, including precedence of `/api/revalidate` and no-CORS consequence [ ] Razorpay webhook path to Railway and revalidation path to Vercel specified, with the shared secret held in both environments [ ] pooler transaction-mode and disabled server-side cursors constraint stated for the backend plan [ ] Supabase Storage in `remotePatterns` and the upload path stated [ ] ISR persistence and image-optimiser behaviour on Vercel confirmed (or `images.unoptimized` fallback) [ ] Vercel Pro plan requirement recorded [ ] reviewed by TASK-006 for secrets handling
- **Tests:** manual review

### TASK-117 Database region move runbook (Seoul to Singapore) and Supabase lockdown checklist
- **Owner:** architect | **Est:** S | **Risk:** medium | **Status:** complete
- **Goal:** `docs/architecture/ARCH-001-db-region-move.md`, a runbook the **owner executes** (the owner performs the move):
  1. **Move steps:** create the new Singapore (ap-southeast-1) Supabase project (paid plan); decide the freeze or low-traffic window; dump the current ap-northeast-2 (Seoul) database (`pg_dump`, plus Storage objects if any) and restore into the new project; recreate roles/extensions the app needs; update connection strings to the pooler (transaction mode) in Railway production and the staging environment; point the backend at the new project; verify.
  2. **Reconciliation:** row counts per table, money totals (payments, orders), latest-id spot checks, and a login/registration/payment smoke test against the new database.
  3. **Rollback:** keep the Seoul project read-only and untouched until sign-off; connection-string revert procedure; retention period before deletion.
  4. **Supabase lockdown checklist:** Supabase's auto-generated REST API must not expose data, because the backend owns all data access: enable RLS with no policies on every backend table (or disable the REST API for the project); verify with an anonymous request that returns no rows or an error; no anon or service-role keys in client code, Vercel public variables or logs; Storage bucket policies allow only the intended public read of media and no anonymous writes; direct database access limited to Railway and the owner.
  5. **Backups and environments:** paid plan with daily backups enabled and a restore drill before taking real payments; separate Supabase staging project for the Railway staging environment.
- **Rationale:** The database moves region and the Supabase API surface is an exposure risk; the owner needs one checklist covering both.
- **Dependencies:** none
- **Files:** `docs/architecture/ARCH-001-db-region-move.md`
- **Notes:** Independent of ARCH-001 and of OQ-18, so it can start immediately. If the backend is rebuilt (OQ-18) the legacy-data migration (F-NFR-008) may be combined with this move; the runbook records that option but does not decide it.
- **Acceptance:** [ ] steps cover create, dump/restore, connection-string update (pooler, transaction mode), verify [ ] reconciliation checks listed with pass criteria [ ] rollback and Seoul retention stated [ ] lockdown checklist includes RLS-with-no-policies or API disabled, key hygiene, Storage policies and an anonymous-request check [ ] daily backups and restore drill required before real payments [ ] staging project separation stated
- **Tests:** manual review; owner confirms execution

## Phase 0.5: Security follow-ups (v5, from SEC-001)

### TASK-124 GATE: ARCH-001 v2 scaffold conditions absorbed
- **Owner:** architect | **Est:** S | **Risk:** medium | **Status:** complete
- ✅ SEC-001 conditions folded into ARCH-001
- **Goal:** Fold SEC-001 scaffold conditions (before TASK-007) into ARCH-001 v2 addendum or amended sections. Absorb: (1) default-deny CSP baseline, mutually exclusive path patterns, one-header-per-route crawl test (F-05); (2) revalidation spec: event id inside HMAC, strict format, equal-length compare, streaming cap, 202 on duplicate, slug regex, key rotation runbook (F-07, F-08); (3) allow-list mock guard, no promote-from-preview (F-09); (4) lint and schema rules: tokens ban from `(public)`, wider sinks, URL-scheme refinement, focal clamp (F-04, F-14).
- **Dependencies:** TASK-006 (SEC-001 complete)
- **Acceptance:** [ ] ARCH-001 v2 or addendum records these changes [ ] TASK-007 and dependents have TASK-124 as a blocking dependency
- **Tests:** manual review

### TASK-125 Dual-mode token module (localStorage for mock, httpOnly cookie for launch)
- **Owner:** frontend-engineer | **Est:** M | **Risk:** high | **Status:** complete
- **Goal:** `browser/tokens.ts` supporting both modes behind `NEXT_PUBLIC_USE_MOCKS` switch: (1) mock mode stores refresh token in localStorage (pg:auth:v1) and access token in memory; (2) launch mode stores refresh token in httpOnly Secure SameSite=Strict cookie (Path=/api/auth) and access token in memory, with CSRF-header refresh. Includes step-up re-authentication flow scaffolding for refund, role change and export actions. Verifies deterministic access token expiry and rotation behaviour. OD-01 decision: ACCEPTED for mock-backed build; REQUIRED for launch.
- **Dependencies:** TASK-007, TASK-124
- **Acceptance:** [ ] both modes work (verified in tests) [ ] /api/auth endpoint exists with cookie-set logic [ ] CSRF header on refresh request [ ] step-up re-auth hooks scaffolded but not yet wired to screens [ ] no admin refresh token in localStorage [ ] admin session cap at 12h (if mock mode allows admin token)
- **Tests:** unit tests for token refresh in both modes; integration test of /api/auth

### TASK-126 Vercel Firewall rate limits and Deployment Protection ops checklist
- **Owner:** architect | **Est:** S | **Risk:** medium | **Status:** complete
- **Goal:** Document (not execute): `docs/architecture/OPS-001-vercel-firewall-and-protection.md` recording Vercel Firewall rules for rate-limiting `/api/csp-report` and `/api/revalidate`, and Deployment Protection constraints for preview deployments. Deliverable lists rules to configure and key settings (e.g., request-per-minute thresholds per SEC-001 F-11, Deployment Protection bypass rules for staging).
- **Dependencies:** TASK-124
- **Acceptance:** [ ] checklist includes /api/csp-report rate limits [ ] /api/revalidate rate limits (per SEC-001 OD-06) [ ] Deployment Protection on preview deployments [ ] threshold values and timing rationale explained [ ] TASK-105 will execute these
- **Tests:** manual review

### TASK-127 Privacy purge runbook and webhook types
- **Owner:** architect | **Est:** S | **Risk:** medium | **Status:** complete
- **Goal:** (1) Update ARCH-001-backend-contract.md section 9.4 to add webhook types for player and result changes (privacy opt-out, takedown, profile privacy changes, result withdrawal); (2) new ops doc `ARCH-001-privacy-purge-runbook.md` for emergency image and data purge (F-15: ISR may serve old page if regeneration fails; 31-day image cache; minors initials-only rule). Includes Supabase Storage version-key strategy and ISR invalidation procedure.
- **Dependencies:** TASK-113
- **Acceptance:** [ ] player and result webhook types added to contract [ ] purge runbook includes Supabase Storage version-key approach [ ] minors initials-only rule recorded [ ] emergency purge procedure stated (who, when, what happens)
- **Tests:** manual review

### TASK-128 CI hardening: dependency gate, pinned actions, 2FA policy
- **Owner:** architect | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** Add to .github/workflows and CONTRIBUTING.md: (1) high/critical audit gate (fail CI if dependencies have severity >= high); (2) pinned action versions (use SHA, not tags); (3) 2FA requirement on publish; (4) env scoping (no production secrets in PR workflows); (5) supply-chain SLA in CONTRIBUTING.md (e.g. security patch response SLA). Deliverable: workflow rules in .github/workflows/POLICY.md and CONTRIBUTING.md update (F-19: supply-chain controls incomplete).
- **Dependencies:** TASK-124
- **Acceptance:** [ ] high/critical audit runs in CI [ ] sample workflow shows pinned SHA [ ] 2FA and env scoping rules stated [ ] SLA section added to CONTRIBUTING
- **Tests:** CI verification

## Phase 1: Foundation

### TASK-007 Scaffold web/ (Next.js App Router)
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** `web/` with Next.js (version per ARCH-001), React 19, TypeScript strict (+`noUncheckedIndexedAccess`), Tailwind v4 through `@tailwindcss/postcss`, route-group skeleton `(public)`, `(auth)`, `(app)`, `(admin)`, `(handoff)` with a root layout, typed server/public env modules, `next.config.ts` (typed routes, images config, security headers hook), `@next/bundle-analyzer` behind `ANALYZE=true`, `.env.example`.
- **Dependencies:** TASK-002, TASK-003
- **Files:** `web/package.json`, `web/next.config.ts`, `web/postcss.config.mjs`, `web/tsconfig.json`, `web/src/app/layout.tsx`, `web/src/app/(public)/page.tsx` (stub), `web/src/lib/env.server.ts`, `web/src/lib/env.public.ts`, `web/.env.example`
- **Notes:** Independent package, not a root workspace member. Env: `NEXT_PUBLIC_USE_MOCKS`, `NEXT_PUBLIC_API_BASE_URL`, `API_INTERNAL_URL` (server), `NEXT_PUBLIC_SITE_URL`, `REVALIDATE_SECRET` (server only), `NEXT_PUBLIC_GOOGLE_AUTH`, `NEXT_PUBLIC_RAZORPAY_ENABLED`, `NEXT_PUBLIC_CONTACT_MODE`. `env.server.ts` starts with `import 'server-only'`. A production build for the production domain must fail when mocks are enabled; preview builds may enable mocks with an explicit opt-in variable. Measure and record the empty-app First Load JS baseline for the budget. Choose dependencies that tree-shake or support per-module imports (`bundle-barrel-imports`).
- **Acceptance:** [ ] `dev`, `build`, `start`, `typecheck` pass [ ] strict TS [ ] env modules validate with zod and fail fast; server env cannot be imported from a client component (build error) [ ] production build with mocks rejected unless the preview opt-in is set [ ] `ANALYZE=true npm run build` emits the bundle report [ ] baseline First Load JS recorded [ ] nothing outside `web/` modified
- **Tests:** env parsing unit tests; build-guard test

### TASK-008 Lint, format, unit-test tooling and RBP lint rules
- **Owner:** frontend-engineer | **Est:** S | **Risk:** low | **Status:** complete
- **Goal:** ESLint (`eslint-config-next` core-web-vitals, `typescript-eslint`, `jsx-a11y`, `react-hooks`), Prettier, Vitest + jsdom, Testing Library, `vitest-axe`, `npm run check`. **RBP enforcement:** `no-restricted-imports` banning root imports of barrel-heavy packages and our own `index.ts` barrels (except documented entry points); `react-hooks/exhaustive-deps` as error; `react/no-unstable-nested-components`; hex-colour-in-class lint; **a boundary rule: `'use client'` files may not import `server-only` modules or `*.server.ts`; Server Components may not import client-only browser modules**; a check that props passed from Server to Client components are plain serialisable values.
- **Dependencies:** TASK-007
- **Files:** `web/eslint.config.mjs`, `.prettierrc`, `vitest.config.ts`, `src/test/setup.ts`
- **Acceptance:** [ ] `npm run check` passes on the scaffold [ ] sample axe test runs [ ] fixture proving each ban fails lint: barrel import, own barrel, nested component, raw hex, client importing server-only
- **Tests:** lint-failure fixtures

### TASK-009 Playwright harness for mobile, responsive and prerender checks
- **Owner:** test-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** Viewports 1440x900, 1280x800, 1024x768, 768x1024, 390x844, 320x568; Chromium and WebKit; helpers `expectNoHorizontalScroll`, `expectTouchTargets(44)`, `expectNoAxeViolations(serious+)`, reduced-motion project, `mockScenario()`, request-log capture, and **`fetchRawHtml(url)` (no JavaScript) for prerender assertions**.
- **Dependencies:** TASK-007
- **Files:** `web/playwright.config.ts`, `web/e2e/helpers/*`, `web/e2e/smoke.spec.ts`
- **Notes:** Runs against `next build && next start` in mock mode (the mock adapter runs in the server process, so no browser-only MSW is needed).
- **Acceptance:** [ ] smoke spec passes on six viewports [ ] helpers fail on deliberately broken fixtures [ ] raw-HTML helper proves a prerendered page contains its content with JS disabled [ ] commands documented
- **Tests:** helper self-tests

### TASK-010 Tailwind v4 theme tokens, base layer, utilities **[schema-form task file]**
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal/notes/criteria:** see `docs/plans/FEAT-001/TASK-010.md`. Summary: CSS-first `@theme` from `design-tokens.json`, fonts via CSS variables from `next/font`, safe-area, control-height, `cv-auto` content-visibility utility, token check script.
- **Dependencies:** TASK-007

### TASK-011 Self-hosted fonts with next/font and resource hints
- **Owner:** frontend-engineer | **Est:** S | **Risk:** medium | **Status:** complete
- **Goal:** Newsreader, Anek Latin, Fragment Mono through `next/font` (`next/font/google` self-hosts at build with no runtime request to Google, or `next/font/local` with committed OFL files per TASK-005), Latin subsets, `display: swap`, CSS variables consumed by TASK-010, automatic size-adjusted fallbacks, `preload` only for the faces used above the fold. API origin `preconnect` where the browser calls it (with the v3 `/api/*` rewrite the browser calls the same origin, so no extra preconnect is needed for the API).
- **Dependencies:** TASK-010, TASK-005
- **Files:** `web/src/app/fonts.ts`, `web/src/app/layout.tsx`
- **Acceptance:** [ ] no request to `fonts.googleapis.com` or `fonts.gstatic.com` at runtime [ ] font payload on Home reported and within ARCH-001 budget (target under 150 KB) [ ] font-swap CLS under 0.02 [ ] unused weights/italics not shipped [ ] licences committed
- **Tests:** Playwright network assertion

### TASK-012 Formatters, hooks and versioned storage
- **Owner:** frontend-engineer | **Est:** S | **Risk:** low | **Status:** complete
- **Goal:** Server-safe pure formatters (`formatEventDate`, `formatTimeRange`, `formatInr`, `formatRatingDelta` with U+2212, `formatOrdinal`) in Asia/Kolkata; client hooks `useMediaQuery`, `useReducedMotion`, `useDocumentTitle` (client areas only), `useLiveAnnouncer`, `useOnlineStatus`; versioned try/catch storage helper.
- **Dependencies:** TASK-007
- **Files:** `web/src/lib/format/*` (no directive, server and client safe), `web/src/lib/hooks/*` (`'use client'`)
- **Notes (RBP):** Hoist `Intl.*` instances and RegExps to module level (immutable module state is allowed on the server; `js-hoist-regexp`, `js-cache-function-results`); formatters must be deterministic across server and client (explicit `timeZone` and locale) to avoid hydration mismatches (`rendering-hydration-suppress-warning` only as a last resort); passive and shared listeners (`client-passive-event-listeners`, `client-event-listeners`).
- **Acceptance:** [ ] unit tests: midnight, month boundary, zero fee "FREE", negative deltas [ ] same output on server and client for a fixed instant [ ] hooks clean up listeners [ ] storage helper never throws [ ] no module-level mutable state in format code
- **Tests:** unit tests

### TASK-013 App Router structure: route groups, layouts, boundaries, skip link
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** Route table realised as Next route groups from `route-manifest.json`: `(public)` (/, /play, /events/[slug], /past-events, /community, /stories, /contact, /privacy, /terms, /refund-policy), `(auth)` (/login, /auth/callback, /reset-password, /welcome, /events/[slug]/register), `(app)` (/app, /app/events, /app/events/[id], /app/rating, /app/profile), `(admin)` (/admin and children, /admin/events/new, /admin/events/[id]/[tab]), `(handoff)`; each group has its own `layout.tsx`, `loading.tsx`, `error.tsx` and `not-found.tsx` where relevant; skip link; focus-on-navigation and title announcement for client areas; `noindex` metadata and `X-Robots-Tag` header (middleware or `proxy.ts`, per the Next version in ARCH-001) for `(auth)`, `(app)`, `(admin)`, `(handoff)`; `(handoff)` returns `notFound()` unless mocks/preview are enabled.
- **Dependencies:** TASK-007
- **Files:** `web/src/app/(public|auth|app|admin|handoff)/**`, `web/src/middleware.ts` or `proxy.ts`, `web/src/components/SkipLink.tsx`
- **Notes:** `(public)/events/[slug]/page.tsx` and `(auth)/events/[slug]/register/page.tsx` share the `[slug]` segment name and resolve to different final paths. Extra routes beyond the manifest (confirm in ARCH-001): `/reset-password?token=` confirm mode, `/admin/events/[id]/[tab]`, builder edit entry `/admin/events/[id]/edit`, `not-found`. Next `<Link>` prefetch is the default navigation preload; for `next/dynamic` client features add hover/focus preload helpers (`bundle-preload`). Any middleware or `proxy.ts` must not intercept `/api/*` paths that the Vercel rewrite forwards to Railway (v3), except `/api/revalidate`, which is a local route handler.
- **Acceptance:** [ ] every manifest route resolves to a stub inside the correct group [ ] `next build` output shows static prerender for `(public)` stubs and dynamic/client rendering for the others as designed [ ] noindex header present on non-public groups [ ] handoff absent from the production prerender output [ ] unknown path renders the not-found page; route error renders the group `error.tsx` with retry [ ] skip link works and focus/title behave on client navigation [ ] no group imports another group's feature code
- **Tests:** unit test that manifest and file routes stay in sync; Playwright header and skip-link tests; build-output assertion

### TASK-014 API client core, envelope, error map **[schema-form task file]**
- **Owner:** frontend-engineer | **Est:** L | **Risk:** high | **Status:** complete
- **Goal/notes/criteria:** see `docs/plans/FEAT-001/TASK-014.md`. Summary: shared envelope/error modules, a `server-only` fetch entry with cache tags, a browser client with single-flight refresh, error-copy map.
- **Dependencies:** TASK-002, TASK-007

### TASK-015 Query layer for client areas, queryOptions and polling
- **Owner:** frontend-engineer | **Est:** S | **Risk:** low | **Status:** complete
- **Goal:** `QueryClientProvider` mounted only in the `(auth)`, `(app)` and `(admin)` layouts (never in `(public)`), `QueryClient` defaults (stale time by data kind, no retry on 4xx), typed key factory, `queryOptions()` factories, mutation helper invalidating the smallest set, `usePolling` (visibility-aware, backoff, offline-aware, refetch on focus).
- **Dependencies:** TASK-014
- **Files:** `web/src/lib/query/{provider,keys,queryOptions,mutation,polling}.ts(x)` (`'use client'` where needed)
- **Notes (RBP):** one query client per browser session created in a `useState` initialiser, never at module scope on the server (`server-no-shared-module-state`); primitive key parts (`rerender-dependencies`); `select` for derived values (`rerender-derived-state`); same `queryOptions` reused by components and prefetches so one cache entry serves both (`client-swr-dedup`).
- **Acceptance:** [ ] public layout bundle does not include TanStack Query (bundle report) [ ] two components with the same key trigger one request [ ] polling pauses in hidden tabs [ ] no module-scope QueryClient [ ] mutations never claim success before server confirmation
- **Tests:** fake-timer polling tests; dedup test; bundle assertion

### TASK-016 Domain types, zod schemas and PgApi: public and player
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** zod schemas/types for SiteContent, Event (reference state vocabulary, **`slug` required**, UUID `id` internal), Registration (all UI-STATES), EventRoom, RatingProfile/ledger, PlayerProfile, PublicIdentity; `PgApi` methods for screens 01 to 31 (public reads callable on the server; mutations browser-only). Discriminated unions for state machines; money as integer paise.
- **Dependencies:** TASK-002, TASK-004, TASK-007
- **Files:** `web/src/lib/api/types/*`, `web/src/lib/api/pg-api.ts`
- **Notes (RBP):** public read types expose only fields the UI needs, to keep RSC props small (`server-serialization`).
- **Acceptance:** [ ] every method needed by screens 01 to 31 typed [ ] illegal states unrepresentable [ ] event and story types require a slug and document immutability-once-published [ ] public read DTOs contain no private fields
- **Tests:** type and zod parse tests

### TASK-017 Domain types, zod schemas and PgApi: admin
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** Types, schemas and `PgAdminApi` for CMS (draft/published/version), media (alt, focal point, mode, autoplay, interval), stories (slug), testimonials, builder draft (8 steps, slug proposal and uniqueness check), event control, players, payments, settings. Version/`updatedAt` for conflict state; settings cannot carry secrets.
- **Dependencies:** TASK-002, TASK-004, TASK-007
- **Files:** `web/src/lib/api/types/admin/*`, `web/src/lib/api/pg-admin-api.ts`
- **Acceptance:** [ ] every method for screens 32 to 56 typed [ ] settings types cannot carry secrets [ ] slug availability check method exists
- **Tests:** type and zod parse tests

### TASK-018 Mock adapter core (server- and browser-safe) and public fixtures
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** `PgApi` mock usable during server rendering and in the browser, selected by `NEXT_PUBLIC_USE_MOCKS`; latency simulation; deterministic seeds from the reference (Saturday Social, Beginner Circle, After Work Blitz, Monsoon Open, stories, testimonials, site content) with slugs; failure injection (`?mock=error|slow|empty`, test hooks); composition entry `getPublicApi()` / `getBrowserApi()`.
- **Dependencies:** TASK-015, TASK-016
- **Files:** `web/src/lib/mock/*`, `web/src/lib/api/index.ts`
- **Notes (RBP):** **Public-read mocks are pure functions over immutable seed data. Any mutable mock state (registrations, check-in, CMS edits) lives in a client-side store created per browser session and is never written during server rendering (`server-no-shared-module-state`).** Mock modules are loaded by dynamic `import()` only when the flag is on so production bundles exclude them (`bundle-conditional`). Fixtures reference local images, never hot links.
- **Acceptance:** [ ] public methods return data matching the zod schemas on server and client [ ] error/slow/empty modes work [ ] a test renders two concurrent server requests with different scenarios and proves no cross-request leakage [ ] production bundle contains no mock code (build-output test)
- **Tests:** composition and schema conformance tests; concurrency isolation test

### TASK-019 Mock player fixtures and scenario switcher
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** Role switch (signed-out/player/admin), every registration state in `docs/UI-STATES.md`, every Event Room state (6 production plus manual check-in, result awaiting confirmation, rating processing pending), rating pools (empty, provisional), dashboard with no next event. Scenario panel selectable by query param, client-only.
- **Dependencies:** TASK-018
- **Files:** `web/src/lib/mock/player/*`, `web/src/lib/mock/scenario.ts`, `web/src/components/dev/ScenarioPanel.tsx`
- **Acceptance:** [ ] each UI-STATES registration/attendance/rating state selectable [ ] panel dev/mock-only and keyboard accessible [ ] mock mutations update in-memory client state realistically
- **Tests:** scenario transition tests

### TASK-020 Mock admin fixtures
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** Fixtures and in-memory (client-side) mutations for CMS, media (missing alt), stories, testimonials (incomplete, consent missing, 3 vs 4+), events in each status, builder drafts, control-room data, players, payments, settings.
- **Dependencies:** TASK-017, TASK-018
- **Files:** `web/src/lib/mock/admin/*`
- **Acceptance:** [ ] each CMS and admin-operations state in UI-STATES reproducible [ ] conflict and audit-unavailable triggerable [ ] publishing in the mock fires the revalidation trigger used by TASK-114
- **Tests:** publish gating and conflict unit tests

### TASK-021 Mock auth, session and profile services (contract behaviour)
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** Mock implementation of the auth part of `PgApi` that behaves like the contract: login, register (field errors), logout, me, update me, short-lived access token plus rotating refresh token simulation, password-reset request (neutral response) and confirm (expired/invalid), onboarding preferences. Repurposed from the former Django auth adapter.
- **Dependencies:** TASK-014, TASK-016, TASK-018
- **Files:** `web/src/lib/mock/auth/*`
- **Acceptance:** [ ] token expiry and refresh rotation are simulated so TASK-014 single-flight logic is exercised [ ] reset response is neutral for known and unknown emails [ ] register returns per-field errors in envelope form [ ] no credentials or tokens are logged
- **Tests:** unit tests for token lifecycle and neutral responses

### TASK-022 PgApi contract export for the new backend plan
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** Generate `docs/architecture/pgapi-contract/` from the zod schemas and mock fixtures: method list, request/response JSON Schemas, example payloads per state, error codes with copy, envelope shape, slug rules, idempotency header, revalidation webhook payload (from TASK-113). Repurposed from the former real-adapter task: the contract replaces any integration with the old Django API.
- **Dependencies:** TASK-004, TASK-016, TASK-017, TASK-113
- **Files:** `web/scripts/export-contract.ts`, `docs/architecture/pgapi-contract/*`
- **Acceptance:** [ ] export regenerates deterministically from source (CI check) [ ] every PgApi method has schema and at least one example per state [ ] FEAT-000 feature ids are referenced where known [ ] file is the single hand-off artifact for the backend PLAN
- **Tests:** snapshot test of the export; schema validity test

### TASK-023 Auth context, token store and session bootstrap
- **Owner:** frontend-engineer | **Est:** M | **Risk:** high | **Status:** complete
- **Goal:** Client `AuthProvider` mounted in `(auth)`, `(app)`, `(admin)` layouts (not `(public)`): user, role, status loading/signedOut/signedIn, signIn/signUp/signOut/refreshUser; short-lived access token in memory and refresh token in versioned storage (Q2); bootstrap via `me`; cross-tab sign-out; mock role switching through the same provider.
- **Dependencies:** TASK-014, TASK-015, TASK-021
- **Files:** `web/src/features/auth/AuthContext.tsx`, `useAuth.ts`, `web/src/lib/api/browser/tokens.ts`
- **Notes (RBP):** split state and actions contexts, derived selectors (`useIsAdmin`) (`rerender-defer-reads`, `rerender-derived-state`); memoised provider value; versioned keys (`client-localstorage-schema`). No auth state is read during server rendering of public pages. (v3: the single-origin `/api/*` rewrite keeps a later move of the refresh token to an httpOnly cookie possible; this task does not implement it.)
- **Acceptance:** [ ] reload restores session; expired refresh signs out cleanly [ ] sign-out propagates across tabs [ ] no flash of signed-out UI in client areas [ ] a component reading only `isAdmin` does not re-render on unrelated profile changes [ ] access token never persisted; tokens never in URLs or logs
- **Tests:** transition tests; re-render count test

### TASK-024 Route guards and return-to intent
- **Owner:** frontend-engineer | **Est:** M | **Risk:** high | **Status:** complete
- **Goal:** Client `RequireAuth`, `RequireRole`, `RedirectIfAuthed` used in the `(app)`/`(admin)`/`(auth)` layouts; `returnTo` preserved through login/create/OAuth; session-expired restore; 403 renders PermissionState.
- **Dependencies:** TASK-013, TASK-023
- **Files:** `web/src/features/auth/guards.tsx`, `returnTo.ts`
- **Notes:** `returnTo` is a same-origin relative path only. Guards are UX only; the server enforces authorisation. Because tokens live in the browser, middleware cannot verify sessions; it only sets `noindex`.
- **Acceptance:** [ ] open-redirect attempts rejected (at least 10 malicious inputs) [ ] first signup can route via `/welcome` then back [ ] skeleton, never protected content, while auth loads
- **Tests:** `returnTo` unit tests; Playwright intent preservation

### TASK-111 Public server data layer: cached fetchers, tags and request dedup
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** Server-only functions used by `(public)` Server Components: `getSiteContent`, `getUpcomingEvents`, `getEventBySlug`, `getPastEvents`, `getStories`, `getTestimonials`, `getLegalPage`, `getSitemapEntries`. Each wraps `serverGet` (TASK-014) with the cache tags and `revalidate` safety net defined in TASK-113 and is wrapped in `React.cache` for per-request dedup.
- **Rationale:** One place that makes public pages prerenderable, deduplicated and tag-revalidatable.
- **Dependencies:** TASK-014, TASK-016, TASK-018
- **Files:** `web/src/lib/data/public/*.ts` (each starts with `import 'server-only'`)
- **Notes (RBP):** `React.cache` for repeated calls within a render (`server-cache-react`); callers start independent fetches together and use composition so siblings fetch in parallel (`server-parallel-fetching`, `async-parallel`); per-item nested fetches chained inside `Promise.all` (`server-parallel-nested-fetching`); return minimal DTOs (`server-serialization`, `server-dedup-props`); static assets and config hoisted to module scope (`server-hoist-static-io`); no mutable module state (`server-no-shared-module-state`). (v3: server-side fetches go straight to the Railway API via `API_INTERNAL_URL`, not through the browser-facing `/api/*` rewrite.)
- **Acceptance:** [ ] each function carries the tags from TASK-113 [ ] calling `getEventBySlug` from `generateMetadata` and from the page triggers one upstream request (test) [ ] home data fetches run in parallel (timing test with mock latency) [ ] client import of this module fails the build [ ] DTOs contain only fields the pages render [ ] works identically with mocks on the server
- **Tests:** unit tests with a counting mock; build-boundary test

### TASK-114 Revalidation endpoint and mock publish trigger
- **Owner:** frontend-engineer | **Est:** M | **Risk:** high | **Status:** complete
- **Goal:** Implement `POST /api/revalidate` route handler per TASK-113: verify HMAC and timestamp, validate payload with zod, map (type, action) to `revalidateTag`/`revalidatePath`, respond 202 quickly, idempotent. Add a dev/preview-only mock trigger so mock "publish" actions in the admin call it.
- **Dependencies:** TASK-007, TASK-111, TASK-113
- **Files:** `web/src/app/api/revalidate/route.ts`, `web/src/lib/revalidate/*`
- **Notes (RBP):** start validation and secret loading early, await late (`async-api-routes`); non-blocking work after the response with `after()` where available (`server-after-nonblocking`); secret read from server env only. (v3: this route is called directly by the Railway backend with the shared `REVALIDATE_SECRET`; it must take precedence over the `/api/*` rewrite to Railway.)
- **Acceptance:** [ ] missing/invalid signature or stale timestamp returns 401 without revalidating [ ] replaying a valid request is harmless [ ] each (type, action) in the TASK-113 table revalidates exactly the listed tags/paths (test with spies) [ ] endpoint is excluded from the sitemap and returns no body data [ ] secret never appears in logs, responses or client bundles
- **Tests:** unit and integration tests; security test for signature and replay

## Phase 2: Design system and shells

### TASK-025 Layout and typography primitives
- **Owner:** frontend-engineer | **Est:** M | **Risk:** low | **Status:** complete
- **Goal:** `Shell`, `Section`, `Eyebrow`, `Heading`, `Lede`, `PageIntro`/`WorkHead`, `Surface`, `InfoRow`/`InfoStack`, `ActionRow`, `Divider`, `VisuallyHidden`.
- **Dependencies:** TASK-010
- **Files:** `web/src/components/ui/*` (one file per component, no barrel)
- **Notes (RBP):** these are **Server Components** (no directive, no hooks); hoist static JSX (`rendering-hydration` risk avoided by being server-rendered; `rendering-hoist-jsx`).
- **Acceptance:** [ ] tokens only [ ] heading level independent of visual size [ ] renders in a Server Component with no `'use client'` [ ] shown in TASK-039 page
- **Tests:** component tests, axe

### TASK-026 Button, TextLink, Icon set, StatusBadge, Avatar
- **Owner:** frontend-engineer | **Est:** M | **Risk:** low | **Status:** complete
- **Goal:** `Button` (primary/secondary/copper/ghost, link or button, loading, full width, 46px public/48px admin, hover lift respecting reduced motion), `TextLink` (wraps `next/link`), per-module `Icon` set (24px viewBox), `StatusBadge` (text always present), `Avatar` (initials fallback, `next/image`).
- **Dependencies:** TASK-010, TASK-011, TASK-025
- **Files:** `web/src/components/ui/{Button,TextLink,StatusBadge,Avatar}.tsx`, `web/src/components/ui/icons/*.tsx`
- **Notes (RBP):** **Each icon is its own module imported by path, no `icons/index.ts`, no third-party icon package (`bundle-barrel-imports`); SVG precision 1 to 2 decimals (`rendering-svg-precision`).** Non-interactive pieces stay Server Components; only the loading-state `Button` variant needs client behaviour.
- **Acceptance:** [ ] hit area at least 44px on all sizes [ ] loading button announces busy state and blocks double submit [ ] every variant AA contrast [ ] a page using 3 icons ships 3 icon modules (bundle check) [ ] a static link renders without client JS
- **Tests:** component tests, axe

### TASK-027 Form primitives
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** `Field`, `Input`, `Select`, `Textarea`, `Switch`, `ChoiceCard`, `Checkbox`; react-hook-form + zod glue (`useZodForm`), error summary focusing the first invalid field, `inputMode`/`autocomplete` presets. 48px controls, 16px minimum font.
- **Dependencies:** TASK-025, TASK-026
- **Files:** `web/src/components/ui/form/*` (`'use client'`), `web/src/lib/forms/*`
- **Notes (RBP):** uncontrolled inputs via `register` by default, scoped `useWatch` (`rerender-defer-reads`); zod schemas at module scope; forms are client islands inside Server Component pages.
- **Acceptance:** [ ] errors adjacent text and programmatically associated [ ] invalid submit moves focus [ ] WebKit 390px shows no input zoom [ ] typing in one field does not re-render siblings
- **Tests:** component tests, axe, re-render test

### TASK-028 Feedback primitives
- **Owner:** frontend-engineer | **Est:** M | **Risk:** low | **Status:** complete
- **Goal:** `Skeleton` variants, `EmptyState`, `ErrorState`, `PermissionState`, `Toast` + live region, `ProgressBar`, `Banner`. Copy follows `screens/58-ui-states.html`. Skeleton, EmptyState and Banner are Server Components; Toast and ErrorState with retry are client.
- **Dependencies:** TASK-012, TASK-025, TASK-026
- **Files:** `web/src/components/ui/feedback/*`
- **Acceptance:** [ ] each shown in `/handoff/states` [ ] live-region announcements verified [ ] skeleton dimensions match final layout (no CLS) [ ] conditionals use ternaries with explicit `null`, never `&&` on numbers (`rendering-conditional-render`)
- **Tests:** component tests

### TASK-029 Dialog and Drawer/Sheet
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** `Dialog`, `Drawer`, bottom `Sheet`: focus trap, Escape, scroll lock, focus return, inert background, safe-area, reduced motion.
- **Dependencies:** TASK-026
- **Files:** `web/src/components/ui/overlay/*` (`'use client'`)
- **Notes (RBP):** content mounted only while open; per-package Radix imports if P1 stays (`bundle-barrel-imports`); overlay trigger buttons can be Server Component children passed as `children` to minimise serialisation.
- **Acceptance:** [ ] focus returns to trigger; Tab cycles; Escape closes [ ] no body scroll on iOS Safari (WebKit test) [ ] usable at 320 with safe-area padding [ ] closed overlays cost no DOM
- **Tests:** component and Playwright keyboard tests

### TASK-030 Tabs and Stepper
- **Owner:** frontend-engineer | **Est:** M | **Risk:** low | **Status:** complete
- **Goal:** `Tabs` (ARIA; route-linked variant uses `next/link`; local variant for filters; narrow screens use a scroll-snap strip with the active tab scrolled into view and overflow affordance), `Stepper` (vertical, compact horizontal, "Step n of 8").
- **Dependencies:** TASK-026
- **Files:** `web/src/components/ui/{Tabs,Stepper}.tsx`
- **Acceptance:** [ ] arrow-key navigation; route-linked tabs remain real links [ ] 8 tabs reachable by touch and keyboard at 320 [ ] only the active panel is rendered
- **Tests:** component tests; Playwright at 320

### TASK-031 ResponsiveTable
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** Real `<table>` at 720px and up; below, labelled stacked rows with the same semantics; column priority decides the collapsed summary; built-in skeleton, empty and error slots. Server Component by default (static data) with an optional client variant for sorting.
- **Dependencies:** TASK-025, TASK-026
- **Files:** `web/src/components/ui/ResponsiveTable.tsx`
- **Notes (RBP):** rows use `cv-auto` with measured `contain-intrinsic-size`; beyond 200 rows ARCH-001 picks windowing (`rendering-content-visibility`); memoised row (`rerender-memo`); lookup maps (`js-index-maps`); `toSorted` (`js-tosorted-immutable`).
- **Acceptance:** [ ] no horizontal scroll at 320 with 7 realistic columns [ ] screen readers read each stacked cell with its label [ ] 1,000-row fixture first paint under 100 ms on a throttled CPU and scrolls without long tasks [ ] row actions never off-screen
- **Tests:** component tests; Playwright 320/1024; axe; perf fixture

### TASK-032 ResponsiveImage and MediaFrame (next/image)
- **Owner:** frontend-engineer | **Est:** S | **Risk:** medium | **Status:** complete
- **Goal:** Wrapper over `next/image`: explicit aspect-ratio container with `fill`, `sizes`, focal point as `object-position`, lazy by default, `priority` for the LCP image only, required `alt` (`decorative` explicit), `MediaFrame` (2px radius, tag overlay), `remotePatterns` per TASK-005/TASK-115 (Supabase Storage host, Q16 resolved).
- **Dependencies:** TASK-010
- **Files:** `web/src/components/ui/{ResponsiveImage,MediaFrame}.tsx`, `web/next.config.ts` (images)
- **Acceptance:** [ ] no layout shift [ ] focal point changes crop per ratio [ ] missing `alt` is a type error [ ] only the `priority` image is eager [ ] optimised widths requested match `sizes` (network check) [ ] works in mock mode with local images
- **Tests:** component tests; CLS check in TASK-099

### TASK-033 Accessible Carousel (client island, lazy)
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** Previous/next, indicators, swipe, keyboard, visible pause/play, autoplay off by default and never under reduced motion, pause on hover/focus, polite announcements, 0 or 1 item renders as static server-rendered markup. The interactive implementation is a client component loaded with `next/dynamic` only when a collection has two or more items; the first slide is server-rendered so the LCP image and SEO content exist in HTML.
- **Dependencies:** TASK-012, TASK-026, TASK-032
- **Files:** `web/src/components/ui/Carousel.tsx`, `CarouselImpl.tsx` (`'use client'`)
- **Acceptance:** [ ] meets WCAG 2.2.2 and the carousel rules in `docs/ACCESSIBILITY.md` [ ] never auto-advances essential info [ ] controls 44px and usable at 320 [ ] static case loads no carousel chunk [ ] first slide present in the raw HTML
- **Tests:** component tests (0/1/n, keyboard, reduced motion), axe, raw-HTML assertion

### TASK-034 Domain components
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** `EventCard` (+skeleton), `EventFacts`, `BoardCard`, `RatingPoolCard`, `ResultRow`, `Timeline`, `MetricTile`/`ControlRoomSummary`. Server Components unless interaction demands otherwise. Only components meeting the COMPONENT-CATALOG new-component rule.
- **Dependencies:** TASK-026, TASK-028, TASK-032
- **Files:** `web/src/components/domain/*`
- **Notes (RBP):** `React.memo` list items used inside client lists (`rerender-memo`); no nested components (`rerender-no-inline-components`); props are primitives or small DTOs.
- **Acceptance:** [ ] correct at 320 with long names [ ] shown in `/handoff/design-system` [ ] parent re-render with unchanged data does not re-render cards in client lists [ ] `EventCard` renders with no client JS
- **Tests:** component tests, axe, long-text fixtures

### TASK-035 Reveal-on-scroll utility
- **Owner:** frontend-engineer | **Est:** S | **Risk:** low | **Status:** complete
- **Goal:** One-time reveal (500 to 800 ms) using CSS with a single shared IntersectionObserver in a tiny client island; content is fully visible in the server HTML and without JS; disabled under reduced motion.
- **Dependencies:** TASK-010, TASK-012
- **Files:** `web/src/components/ui/Reveal.tsx` (`'use client'`)
- **Notes (RBP):** no hydration flicker: initial state is "visible" and the observer only adds a pre-reveal class to elements below the fold after hydration (`rendering-hydration-no-flicker`); one observer for all targets (`client-event-listeners`).
- **Acceptance:** [ ] the LCP element is never hidden or delayed [ ] no reveal under reduced motion [ ] 50 targets create one observer [ ] no hydration mismatch warnings
- **Tests:** mocked-observer tests

### TASK-036 PublicNav and Footer with mobile menu
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** Public header and footer (screens 01 to 12) as Server Components with `next/link` (prefetch). Mobile: compact brand and a client menu-trigger island opening a drawer; primary CTA visible without opening the menu; safe areas. An auth-aware island swaps "Log in" for "My PG/Admin" after hydration without layout shift.
- **Dependencies:** TASK-013, TASK-023, TASK-026, TASK-029
- **Files:** `web/src/components/layout/{PublicNav,Footer,PublicLayout,MobileMenu,AuthAwareLink}.tsx`
- **Notes:** the layout must not read cookies or headers, or all public pages become dynamic.
- **Acceptance:** [ ] trigger has name, `aria-expanded`, 44px target [ ] active route via `aria-current`, not colour alone [ ] no wrap/overflow at 320 [ ] prerendered HTML contains the full nav with working links [ ] auth swap causes no layout shift [ ] layout does not opt public pages into dynamic rendering (build output)
- **Tests:** component tests; Playwright keyboard and 320; raw-HTML nav assertion

### TASK-037 PlayerShell
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** 248px sidebar at 960px+; below, compact top bar + menu drawer; contextual "Event room" shortcut when an event is live or check-in is open. Client layout in `(app)` with `RequireRole`.
- **Dependencies:** TASK-013, TASK-023, TASK-026, TASK-029
- **Files:** `web/src/components/layout/{PlayerShell,PlayerNav}.tsx`
- **Acceptance:** [ ] only players/admins reach it [ ] drawer focus trap/return; safe-area on top bar [ ] no horizontal scroll at 320/390 [ ] shell does not import admin code
- **Tests:** component and Playwright tests

### TASK-038 AdminShell
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** 264px sidebar with nine items at 960px+ (navigable at 1024); below, drawer with top bar title; Events active for `/admin/events/*`. Client layout in `(admin)` with `RequireRole('admin')`.
- **Dependencies:** TASK-013, TASK-023, TASK-026, TASK-029
- **Files:** `web/src/components/layout/{AdminShell,AdminNav}.tsx`
- **Acceptance:** [ ] non-admins get PermissionState [ ] nine items fit the drawer at 320x568, scrolling inside the drawer only [ ] admin chunks not loaded for public or player routes (network test)
- **Tests:** component and Playwright tests

## Phase 1.5: Follow-ups from ARCH-001 section 30 (foundation tier)

### TASK-120 Edge policy: `proxy.ts` with route-class CSP, security headers, CSP report endpoint, Report-Only rollout
- **Owner:** frontend-engineer | **Est:** M | **Risk:** high | **Status:** complete
- **Goal:** `web/src/lib/security/proxy.ts` (Next.js middleware) implementing `src/middleware.ts`: per-request nonce for client groups `(auth)`, `(app)`, `(admin)`, `(handoff)` with a nonce-based CSP header (`'self' 'nonce-{n}' 'strict-dynamic'` on `script-src`, nonce on `style-src`); static CSP on `(public)` paths from `next.config.ts` headers (`'self' 'unsafe-inline'` on `script-src`, no `unsafe-eval`); all routes carry `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (geolocation, camera, microphone denied). Report-Only phase (header `Content-Security-Policy-Report-Only`) for staging/preview with violations sent to `/api/csp-report`. Playwright test verifies CSP nonce presence on a client page and hydration succeeds (no script-src blocks).
- **Rationale:** ARCH-001 section 10 (DEC-005). CSP is a build requirement, not deferred to deployment. Section 10.3 specifies the two policies and how they are applied. AC-101 requires a nonce-based CSP on client groups and a static CSP on public pages.
- **Dependencies:** TASK-007, TASK-013
- **Files:** `web/src/middleware.ts`, `web/src/lib/security/{csp.ts,proxy.ts}`, `web/e2e/csp.spec.ts`
- **Notes (RBP):** CSP module is a single source for both policies so they cannot drift (`server-no-shared-module-state` for the CSP object, policy directives only at module scope). Nonce is generated per request and passed to Next via the `x-nonce` header; Next injects it into inline scripts. `/api/csp-report` is a route handler that logs violations without storing them (observability hook from TASK-122). The middleware matcher excludes static files and prefetch requests. Report-Only is configured via `NEXT_PUBLIC_CSP_REPORT_ONLY` for staging.
- **Acceptance:** [ ] `npm run check` and build pass [ ] middleware on `/login`, `/app/dashboard` adds a nonce header and CSP response [ ] `/api/static/style.css` is skipped (no nonce needed) [ ] hydration tests at 390 and 320 pass without CSP console errors [ ] CSP directives in the source and config match ARCH-001 section 10.2 [ ] Report-Only mode can be enabled via env var [ ] `/api/csp-report` POST accepts and logs a CSP violation (no storage) [ ] public route CSP has no nonce (static header from config)
- **Tests:** unit tests for `csp.ts` policy building; Playwright CSP header assertions and hydration test (390, 320); middleware skip-list test
- **Risk:** High (CSP blocks scripts if misconfigured, and hydration failures break the app). Requires careful testing.
- **DoD-R:** Nonce applied consistently; CSP report hook deferred with `bundle-defer-third-party` if a provider is added later.

### TASK-121 Architecture lint: dependency-cruiser config for M3 to M6 rules, `check:build-output` script
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** `dependency-cruiser.js` configuration file enforcing ARCH-001 module boundaries (M3 to M6 from Appendix A.3): `(public)` may not import `features/*`, `lib/query`, client overlay primitives, or mock stores; no route group imports another route group's code; server-only modules start with `import 'server-only'`; client modules start with `'use client'`; no circular dependencies. Plus a `check:build-output` npm script that parses `next build` output and asserts: every route has a rendering mode (static/ISR/dynamic), `revalidate` values are finite and >= 60, mock sentinel never appears (build would include mock code), secret env names never appear, public group routes carry `noindex`. Add fixtures proving each lint rule breaks.
- **Rationale:** ARCH-001 section 30 F-04. Mechanical enforcement of module rules prevents drift; build-output checks catch secrets and mock leaks.
- **Dependencies:** TASK-008
- **Files:** `web/dependency-cruiser.js`, `web/scripts/check-build-output.ts`, updated `web/package.json` (`check:build-output`), `web/e2e/fixtures/lint-failures/**`
- **Notes:** `dependency-cruiser` runs in CI; violations fail the build. The script runs after `next build` in CI and locally (add to `check` target). Ignore `next.js` and `react` from the cruiser scope (they are frameworks, not app code).
- **Acceptance:** [ ] `npm run check` includes the lint pass [ ] sample violations are created and `dependency-cruiser` fails on each: public importing from features, features importing features, (public) importing Query, client importing server-only module [ ] build-output script parses the build summary and passes/fails on routing modes, revalidate values, no mock markers, no secret names [ ] fixtures provided for each lint rule
- **Tests:** lint-failure fixtures; build-output assertions
- **Risk:** Medium (misconfigured rules could block legitimate code or miss violations).

### TASK-122 Observability adapter and PII scrubber: `lib/observe` with error/vital/analytics hooks, web-vitals hook, `/api/csp-report` logging
- **Owner:** frontend-engineer | **Est:** M | **Risk:** medium | **Status:** complete
- **Goal:** `web/src/lib/observe/index.ts` exporting an `Observer` interface with methods `reportError(error, ctx)`, `reportVital(v)`, and `track(event)`, plus a no-op default implementation and a console implementation for development. A tiny client component in the root layout uses `useReportWebVitals` from `next/analytics` to feed LCP, CLS, INP, TTFB, FCP into `reportVital`. PII scrubber utility `lib/observe/scrubber.ts` removes tokens, passwords, PII patterns from error messages and request bodies before sending. `/api/csp-report` route handler receives CSP violation reports and calls `Observer.reportError` with the violation details and context (area: 'csp', violation.violatedDirective). No analytics provider is configured yet (NG-12); the adapter is ready for one to be plugged in later.
- **Rationale:** ARCH-001 section 19. Observability infrastructure is built now so error tracking and performance metrics can be sent without PII. CSP violations logged as errors provide visibility into client-side issues.
- **Dependencies:** TASK-007, TASK-014
- **Files:** `web/src/lib/observe/{index.ts,scrubber.ts,console.ts}`, `web/src/app/api/csp-report/route.ts`, `web/src/app/(public)/layout.tsx` (vitals component)
- **Notes (RBP):** observer is a singleton; the provider is swapped at one place (`lib/observe/index.ts`, `bundle-defer-third-party` when a provider is chosen); web-vitals hook loaded after hydration and only in production (development uses console). Scrubber tests include hostile payloads (credit card numbers, email addresses, tokens). Error context carries area (route group) and action name for debugging without storing full URLs.
- **Acceptance:** [ ] interface defined and exported [ ] no-op and console implementations present and tested [ ] `useReportWebVitals` reports five vitals to the observer [ ] scrubber removes common PII patterns (tokens starting with specific prefixes, passwords, email in structured fields, credit card numbers) [ ] `/api/csp-report` endpoint logs a violation with context [ ] observer is not called during server render (only client) [ ] adding a provider requires only one `lib/observe/index.ts` change
- **Tests:** unit tests for interface, scrubber patterns, observer logging; Playwright vitals reported (network log check); endpoint test with a sample CSP violation
- **Risk:** Medium (PII scrubber misses could leak data; observer misconfiguration could breach privacy or send sensitive data to a wrong endpoint).

### TASK-039 Handoff routes: index, design-system, UI states
- **Owner:** frontend-engineer | **Est:** M | **Risk:** low | **Status:** complete
- **Goal:** `/handoff`, `/handoff/design-system`, `/handoff/states` replacing reference screens 57 and 58; mock/preview only (`notFound()` otherwise).
- **Dependencies:** TASK-013, TASK-019, TASK-023, TASK-028, TASK-034
- **Files:** `web/src/app/(handoff)/handoff/**`
- **Acceptance:** [ ] DoD-S met; no horizontal scroll at 320 [ ] every state in `docs/UI-STATES.md` has an example [ ] absent from the production prerender output and sitemap (asserted)
- **Tests:** Playwright snapshots 390/1440; build-output assertion
