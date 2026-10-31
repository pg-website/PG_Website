# Feature Inventory: Pawn's Gambit (PG Chess) Platform

**ID:** FEAT-000
**Type:** feature-inventory
**Version:** 2
**Status:** draft
**Date:** 2026-10-21

**Purpose:** One list of every product feature for the full rewrite (new Next.js + TypeScript + Tailwind frontend built first against mocks; new or changed backend later). FEAT-001 (frontend requirements) and the future backend plan are derived from this file. It is a feature list, not a requirements document: no acceptance criteria, no code.

**Version 2 change:** owner hosting decisions recorded (OQ-06 resolved): Vercel (Singapore) frontend, Railway (Singapore) backend, Supabase Postgres moving from Seoul to Singapore, Supabase Storage for media. See OQ-06 in section 7 and the notes in sections 2.12, 2.19 and 5. OQ-18 (extend or rebuild the backend) stays open.

---

## 1. Conventions

**Sources.** Design handoff in `Frontend reference/` (58 screens in `SCREEN-MAP.csv`, plus docs), the legacy Django backend in `backend/` and the legacy React `src/` (used only for the Legacy status column), and `docs/plans/PLAN-001-frontend-rewrite.md` (read only; it still describes a Vite SPA and is being updated in parallel, so nothing here depends on it). Anything not stated in a source is marked **inferred**.

**Stack caveat.** The reference docs describe a Supabase design (RLS, Edge Functions such as `create-payment-order`). The real legacy backend is Django REST over Supabase Postgres (`MIGRATION.md`). This inventory describes behaviour, not mechanism. Read "RLS" as "object-level permission rules enforced on the server". Hosting is now decided (OQ-06: Vercel, Railway, Supabase Postgres and Storage, all in Singapore). The framework of the new backend (extend the Django app or rebuild) is still an architect decision (OQ-18); the hosting works either way.

**Decisions already made by the owner (applied throughout).**
- Legacy public Gallery page, tournament leaderboard and CSV export are dropped (section 6). The new event gallery/recap stays.
- Event and story URLs use slugs; the backend provides unique slugs.
- Auth: email/password required. Google sign-in appears in the design and is planned and feature-flagged. A refresh token in browser storage is acceptable.
- Public pages are prerendered and SEO-friendly (Event schema, Open Graph).
- Payments use Razorpay. Pricing, verification and webhook are server-owned. The browser never decides paid state.
- Mobile-first usage, especially the live Event Room at a physical event.
- Hosting (OQ-06, resolved): Next.js on Vercel (Pro plan, functions in Singapore `sin1`); backend on Railway Singapore (API, worker, scheduler); Supabase Postgres in a new Singapore project (moving from Seoul); media in Supabase Storage.

**Priority (proposed, inferred; owner to confirm).**
- **MVP**: needed to run one real event end to end (browse, register free or paid, pay, check in, pairings and results, ratings) with admin staff operating it.
- **Launch**: needed before the public launch, but not for the first real event.
- **Later**: after launch, dev-only, or waiting on an undecided owner choice.

**Legacy status.** `exists` = a working equivalent is in the Django app or old frontend. `partial` = some of it exists or it behaves differently. `none` = nothing today. Legacy findings come from reading `backend/*/views.py`, `urls.py`, `models.py`.

**ID scheme.** `F-<DOMAIN>-NNN`. Domains: PUB, SEO, AUTH, PROF, PLY (Player home; added to the suggested list because the dashboard and My Events fit no other domain), REG, PAY, EVT, PAIR, RATE, ADEV, ACMS, AADM, COMM, NOTI, CON, LEG, ANA, NFR.

**Screen numbers** are the `SCREEN-MAP.csv` numbers (1-58). "none" = not in the 58 screens. "no UI" = backend or system behaviour with no screen. "all" = cross-cutting.

**Actors.** V = visitor, P = player, H = host/event staff (role status unclear, see section 3), A = admin, S = system/job.

---

## 2. Feature table

### 2.0 Summary

| Domain | Code | MVP | Launch | Later | Total |
|--------|------|----:|-------:|------:|------:|
| Public site & discovery | PUB | 7 | 6 | 0 | 13 |
| SEO & sharing | SEO | 4 | 2 | 0 | 6 |
| Authentication & accounts | AUTH | 7 | 1 | 2 | 10 |
| Onboarding & profile | PROF | 1 | 4 | 0 | 5 |
| Player home | PLY | 2 | 2 | 1 | 5 |
| Event registration | REG | 6 | 4 | 1 | 11 |
| Payments, refunds & reconciliation | PAY | 6 | 4 | 1 | 11 |
| Event lifecycle & Event Room | EVT | 7 | 10 | 0 | 17 |
| Pairing & rounds engine | PAIR | 7 | 2 | 1 | 10 |
| Ratings | RATE | 4 | 4 | 1 | 9 |
| Admin: events | ADEV | 12 | 7 | 1 | 20 |
| Admin: CMS, media, stories, testimonials | ACMS | 2 | 8 | 0 | 10 |
| Admin: players, payments, settings, roles, audit | AADM | 2 | 6 | 1 | 9 |
| Communications | COMM | 1 | 6 | 2 | 9 |
| Notifications & reminders | NOTI | 0 | 6 | 0 | 6 |
| Contact form | CON | 0 | 2 | 1 | 3 |
| Legal pages | LEG | 1 | 0 | 3 | 4 |
| Analytics | ANA | 0 | 2 | 1 | 3 |
| Non-functional | NFR | 6 | 7 | 1 | 14 |
| **Total** | | **75** | **83** | **17** | **175** |

### 2.1 Public site & discovery (PUB)

| ID | Feature | Description | Priority | Actors | Screens | Backend needs | Legacy status | Notes |
|----|---------|-------------|----------|--------|---------|---------------|---------------|-------|
| F-PUB-001 | Home page | Editorial home: hero, upcoming games, first-visit promise, community, story, final CTA; copy and media come from CMS, cards from published events | MVP | V | 1 | Published site-content read (home); published upcoming events | partial | Old Home exists with hard-coded content; CMS content did not exist. Cards use the event media collection, not a home gallery |
| F-PUB-002 | Play: event discovery | Search and filter events (All, Social, Beginner friendly, Rated, Free); cards show atmosphere, date, area, format, fee, first-timer signal, status; empty state with reset | MVP | V | 2 | Public event list with filters, search, pagination | partial | `GET /api/tournaments/` has status and upcoming filters only; no type, audience, free filter or search |
| F-PUB-003 | Event detail | Decision essentials above detail: promise, date/time, area, format, price, availability, registration CTA; first-timer expectations; logistics; modes open, full, closed, sold out | MVP | V | 3 | Public event projection by slug | partial | Legacy has UUID detail without slug, summary, media, audience, waitlist |
| F-PUB-004 | Event archive mode | Completed event becomes archive/recap: facts, final standings, gallery, recap; no registration CTA | Launch | V | 4 | Completed-event projection with standings, recap, media | none | Needs F-EVT-015, F-EVT-016 |
| F-PUB-005 | Past events archive | Searchable permanent archive of completed events; each keeps its public URL | Launch | V | 5 | Completed events list with search/type filter | partial | Legacy can list status=completed |
| F-PUB-006 | Community page | Editorial positioning and hospitality copy | Launch | V | 6 | CMS page read | partial | Legacy has no community page (old Home only) |
| F-PUB-007 | Stories list | Featured story plus chronological grid of essays, member profiles, rivalries, event recaps | Launch | V | 7 | Published stories list | none | |
| F-PUB-008 | Story detail page | Single story at a slug URL, "Read story" target from the list | Launch | V | none | Story by slug with media | none | Owner wants slug URLs; no story-detail screen in the 58 (inferred need). Needs design (OQ-11) |
| F-PUB-009 | Testimonials section | Published and consented testimonials; 1-3 shown as grid, 4+ as accessible carousel | Launch | V | 1 | Published testimonials read | none | Unpublished records never render. Keerthy Ganta and Parth Thakkar records stay unpublished until approved |
| F-PUB-010 | Public navigation and footer | CMS-driven nav labels, order, footer, social URLs; shared across public pages | MVP | V | 1-12 | Navigation and footer content read | partial | Old Navbar/Footer hard-coded |
| F-PUB-011 | Public-safe event projection | Public event shape with places left, first-timers joining, price; hides internal notes, provider data, registrations | MVP | V | 1, 2, 3, 5 | Projection/serializer; counts computed server-side | partial | Legacy `registered_count` counts paid only; legacy registration list leaks email and Razorpay IDs to anonymous callers (security finding) |
| F-PUB-012 | Media collection rendering | Static or carousel from a media collection; 0 assets = placeholder, 1 = static, 2+ = controls; alt text and focal point honoured | MVP | V | 1, 3, 4, 6, 7 | Collection read with ordered assets, alt, focal X/Y | none | Frontend behaviour; backend supplies data |
| F-PUB-013 | 404 / not found | Friendly not-found page with next actions | MVP | V | 12 | none (unknown slug returns 404) | partial | |

### 2.2 SEO & sharing (SEO)

| ID | Feature | Description | Priority | Actors | Screens | Backend needs | Legacy status | Notes |
|----|---------|-------------|----------|--------|---------|---------------|---------------|-------|
| F-SEO-001 | Prerendered public pages | All public routes render with real content in the first HTML response | MVP | V | 1-12 | Public read endpoints usable at build/request time; list of published slugs | none | Legacy is a client-rendered SPA. Hosting decided (OQ-06 resolved): Next.js on Vercel, functions in Singapore (`sin1`) |
| F-SEO-002 | Per-page metadata | Title, description, canonical per page from CMS page metadata and event/story fields | MVP | V | 1-12 | Metadata fields on pages, events, stories | none | |
| F-SEO-003 | Event structured data and share cards | schema.org Event JSON-LD and Open Graph/Twitter tags with event image, date, venue | MVP | V | 3, 4 | Event fields: start/end, venue address, price, status, image URL | none | Data must be complete (venue address owner input) |
| F-SEO-004 | Sitemap and crawl rules | sitemap.xml of published events/stories/pages; robots rules; noindex on login, app and admin | Launch | V | no UI | Published slug list with last-modified | none | inferred |
| F-SEO-005 | Revalidation on publish | Backend notifies the frontend when events, stories or CMS content publish/unpublish so prerendered pages refresh | Launch | A, S | no UI | Publish hook (signed call to frontend revalidate endpoint), retry | none | MVP can use time-based revalidation. Decided path: Railway backend calls the Vercel HMAC-signed `/api/revalidate` route with a secret shared by both environments (OQ-06) |
| F-SEO-006 | Unique slugs | Stable unique slugs for events and stories, generated by backend; collision handling | MVP | A, V | 3, 4, 35, 38 | Slug field, uniqueness, collision suffix, redirect on rename (inferred) | none | Legacy uses UUIDs. Slug-change policy open (OQ-24) |

### 2.3 Authentication & accounts (AUTH)

| ID | Feature | Description | Priority | Actors | Screens | Backend needs | Legacy status | Notes |
|----|---------|-------------|----------|--------|---------|---------------|---------------|-------|
| F-AUTH-001 | Email/password sign-up | Create account with name, email, password; field-level errors | MVP | V | 14 | Register endpoint | exists | Legacy also accepts city, phone, chess_com_username, fide_id, skill_level; min password 6 (OQ-13) |
| F-AUTH-002 | Login and logout | Email/password sign-in; sign-out; invalid-credential messaging | MVP | V, P, A | 13 | Login, logout | exists | |
| F-AUTH-003 | Session refresh | Short-lived access token, refresh token kept in browser storage (owner-accepted); silent refresh; expiry handling | MVP | P, A | no UI | Token refresh | exists | Legacy rotates without blacklist (finding). Expired session while holding an event intent returns to login and restores route. The browser reaches the API through a same-origin Vercel `/api/*` rewrite (OQ-06), so the token can later move to an httpOnly cookie |
| F-AUTH-004 | Password reset | Request with neutral response (never reveals account existence); set new password from emailed link | MVP | V | 16 | Reset request, confirm, email send, token expiry | exists | Legacy link is `FRONTEND_URL/reset-password?token=` |
| F-AUTH-005 | Google sign-in | "Continue with Google" on login and sign-up; callback processes, redirects, recovers on failure | Launch | V | 13, 14, 15 | OAuth code flow (PKCE), account creation or linking by email, no extra scopes, no provider tokens stored | none | Planned and feature-flagged; hidden until backend supports it. Account-linking rule open (OQ-12) |
| F-AUTH-006 | Return-to-intent | After login/sign-up/OAuth, user returns to the page or registration they started | MVP | V, P | 13, 14, 15, 18, 19, 20 | Consistent AUTH_REQUIRED 401 code | none | Mostly frontend |
| F-AUTH-007 | Server-owned roles | Role never stored in an editable profile; admin-only role assignment, audited | MVP | A | 54, 56 | Role store, set-role endpoint, audit | partial | Legacy has `role` (player/admin) on user row; set only by DB. No UI in the 58 for role assignment (inferred: Players admin) |
| F-AUTH-008 | First-account setup | On first auth create private profile, public-profile stub and player role | MVP | S | no UI | Creation side effects in one transaction | partial | Legacy creates one user row |
| F-AUTH-009 | Admin MFA | Require MFA for admin accounts if operationally feasible | Later | A | no UI | MFA support in auth provider | none | From AUTH-SECURITY "before launch ... if feasible" (OQ-14) |
| F-AUTH-010 | Email verification | Confirm email on sign-up "where configured" | Later | V | 14 | Verification token flow | none | inferred from UI-STATES; owner has not chosen (OQ-13) |

### 2.4 Onboarding & profile (PROF)

| ID | Feature | Description | Priority | Actors | Screens | Backend needs | Legacy status | Notes |
|----|---------|-------------|----------|--------|---------|---------------|---------------|-------|
| F-PROF-001 | First-login preferences | Optional "how do you like to play" and "what are you in the mood for"; no rating exam; skippable | Launch | P | 17 | Preferences on profile (play style, intent) | none | Legacy has `skill_level` at sign-up only, not editable later. Proposed mapping to skill_level is unconfirmed |
| F-PROF-002 | Progressive profile completion | Ask only fields an event needs (e.g. phone, first-timer answer) at registration; never dump user into a generic form after OAuth | Launch | P | 17, 18, 19, 20 | Per-event required-fields rule; partial profile update | none | |
| F-PROF-003 | Private profile | View/edit display name, city, area, phone, birthday, Chess.com handle, FIDE ID; email read-only | MVP | P | 31 | Get/patch own profile | exists | Legacy `PATCH me` also edits pincode, gender; unsaved-changes guard is frontend |
| F-PROF-004 | Public identity controls | Per-field toggles for what others see (name, PG ratings, Chess.com handle, city chapter). Email, phone, birthday never public | Launch | P | 31 | Public-profile record with visibility flags; strict field allow-list | none | Legacy public `profile` endpoint exists (fields not audited for PII) |
| F-PROF-005 | Public player projection | Safe subset of a player (name, ratings, city chapter) used in standings, pairings and opponent cards | Launch | V, P | 4, 22, 27, 31 | Public-profile read honouring visibility flags | partial | No public player page exists in the 58 screens (OQ-26) |

### 2.5 Player home (PLY)

| ID | Feature | Description | Priority | Actors | Screens | Backend needs | Legacy status | Notes |
|----|---------|-------------|----------|--------|---------|---------------|---------------|-------|
| F-PLY-001 | Player dashboard | Answers in five seconds: next event, where/when, what to do, round/board/opponent, current rating, recent results | MVP | P | 22 | Aggregated "me/dashboard" read | partial | Legacy has tournament-history and profile only |
| F-PLY-002 | My Events | Upcoming registrations with state (confirmed, waitlist, payment pending), history, link to event room or archive | MVP | P | 23 | My registrations with event, payment and refund state | partial | Legacy `tournament-history` has no waitlist, hold or refund state |
| F-PLY-003 | Recent games and people | Last results with rating delta; opponents played most, with actions | Launch | P | 22 | Game ledger read; opponent aggregates | none | |
| F-PLY-004 | Rematch request | "Ask for a rematch" / "Challenge again" between players; both-request overrides rematch avoidance | Later | P | 22 | Rematch request entity and notification | none | Buttons appear in design; no data model or flow defined (OQ-20) |
| F-PLY-005 | Add to calendar | Calendar file or link after confirmation | Launch | P | 21, 23 | Event time/venue; optional .ics endpoint | none | inferred from UX-FLOWS "add to calendar" |

### 2.6 Event registration (REG)

| ID | Feature | Description | Priority | Actors | Screens | Backend needs | Legacy status | Notes |
|----|---------|-------------|----------|--------|---------|---------------|---------------|-------|
| F-REG-001 | Eligibility and state resolution | Server decides per player/event: open, closed, not yet open, full, sold out, already registered, ineligible | MVP | P | 3, 18, 19, 20 | Atomic check of window, capacity, eligibility, duplicate | partial | Legacy has duplicate check only; no capacity or window check |
| F-REG-002 | Free registration | Confirm place with no provider involved | MVP | P | 19, 21 | Create confirmed registration | partial | Legacy sets payment_status `paid` for free events |
| F-REG-003 | Paid registration with hold | Capacity hold created before payment, expiry shown as countdown, then Razorpay | MVP | P | 18 | Hold record with expiry, counted against capacity | none | Hold length not set (OQ-08); design example shows 10 minutes |
| F-REG-004 | Confirmation and uncertain-payment states | Success page; "confirming payment" while server reconciles; failed/cancelled payment keeps intent; no duplicate paid registration | MVP | P | 18, 21 | Canonical registration status read; polling-safe | none | |
| F-REG-005 | Waitlist | Full event with waitlist on: join without paying, see position | Launch | P | 20 | Waitlist state and position | none | Sold-out view shows next event when waitlist is off |
| F-REG-006 | Waitlist promotion | When a place opens, offer it; short acceptance/payment window; lapse passes to next | Launch | P, S | 20, 23 | Promotion logic, offer expiry job, notification | none | Window length open (OQ-08) |
| F-REG-007 | Cancel registration | Player cancels where event policy allows; capacity released; refund per policy | Launch | P | 23 | Cancel endpoint with policy check | none | Rules open (OQ-07) |
| F-REG-008 | Server-owned price | Price and currency derived by server per event and player; browser never sends amount | MVP | P | 18, 19 | Price resolution | partial | Legacy order uses DB fee, good |
| F-REG-009 | Alternate pricing modes | Member price, invite/comp, donation | Later | P, A | 40, 41 | Memberships, comp flag, donation amount rules | none | Builder shows member and comp options; PRODUCT-SCOPE lists donation (OQ-03) |
| F-REG-010 | First-timer capture | Ask first-timer / preference at signup or registration; feeds host list | Launch | P | 17, 40, 47 | First-timer flag per registration (derived from attendance history plus answer) | none | |
| F-REG-011 | Idempotent registration | Repeat requests (double tap, retry) never create duplicates or double holds | MVP | P | no UI | Idempotency key on registration/order calls | none | |

### 2.7 Payments, refunds & reconciliation (PAY)

| ID | Feature | Description | Priority | Actors | Screens | Backend needs | Legacy status | Notes |
|----|---------|-------------|----------|--------|---------|---------------|---------------|-------|
| F-PAY-001 | Server-side order creation | Create Razorpay order from server price for a held place | MVP | P | 18 | Create-order endpoint, order record | partial | Legacy creates order but without hold or idempotency |
| F-PAY-002 | Checkout handoff | Browser opens Razorpay Standard Checkout with public key and server order ID; no card data touches PG | MVP | P | 18 | Order ID and public key in response | exists | Old frontend `razorpay.js` |
| F-PAY-003 | Server verification | Verify signature, fetch payment from Razorpay, check order ID, exact amount, currency, status; then confirm registration | MVP | P | 18 | Verify endpoint; payment write | partial | Legacy checks signature only, not amount/status |
| F-PAY-004 | Webhook reconciliation | Raw-body signature check, dedupe by provider event ID, replay-safe; reconciles captured, failed, refunded | MVP | S | no UI | Webhook endpoint, event store | none | Closing the browser after paying must still end in confirmed. Razorpay webhooks are delivered straight to the Railway API service, not through Vercel (OQ-06) |
| F-PAY-005 | Payment ledger | Order, payment and webhook-event records; provider IDs, amounts, states | MVP | A | 50, 55 | Tables for orders, payments, webhook events | none | Legacy keeps Razorpay IDs on the registration row |
| F-PAY-006 | Hold expiry and release | Expired holds stop counting toward capacity and are cleaned up | MVP | S | 18 | Scheduled job | none | Runs on the Railway scheduler service (OQ-06) |
| F-PAY-007 | Refund execution | Admin refunds a captured payment; payment and registration states update together | Launch | A | 50, 55 | Refund call to Razorpay, state update, audit | none | Legacy has a `refunded` status value only |
| F-PAY-008 | Refund and cancellation policy | Per-event refund window and rules applied consistently in UI, API and policy page | Launch | A, P | 41, 11, 23 | Refund-window fields; eligibility check | none | Rules open (OQ-07); builder shows "24 hours before start" as an example |
| F-PAY-009 | Reconciliation and mismatches | "Reconcile now" compares provider vs PG state; mismatches are shown, never silently fixed | Launch | A | 32, 50, 55 | Reconcile job/endpoint, mismatch flag | none | |
| F-PAY-010 | Player payment state | Payment pending, captured, refund pending, refunded visible to the player | Launch | P | 18, 23 | State fields on my-registrations | none | |
| F-PAY-011 | Receipts and tax invoices | Receipt/invoice with approved tax wording if applicable | Later | P | no UI | Invoice generation | none | Owner input "tax/invoice wording if applicable" (OQ-07) |

### 2.8 Event lifecycle & Event Room (EVT)

| ID | Feature | Description | Priority | Actors | Screens | Backend needs | Legacy status | Notes |
|----|---------|-------------|----------|--------|---------|---------------|---------------|-------|
| F-EVT-001 | Event lifecycle | draft, published, registration_open, sold_out/ongoing, completed; cancelled allowed with admin confirmation; automatic transitions by time | MVP | A, S | 37, 46 | State machine, transition job | partial | Legacy has upcoming/registration_open/ongoing/completed; promotion happens inside a GET (finding); no draft or cancelled |
| F-EVT-002 | Event cancellation | Cancel with a participant communication plan and refunds | Launch | A | 37, 46 | Cancel flow: notify, refund all, audit | none | |
| F-EVT-003 | Event Room state | One snapshot driving six states: before check-in, check-in open, checked in/pairing pending, live round, between rounds, complete | MVP | P | 24-29 | Event-room snapshot read (registration, check-in, round, pairing, standings, rating processing state) | none | Player sees only own pairing/result plus public standings |
| F-EVT-004 | Player self check-in | "I'm at the venue" tap within the check-in window; host desk sees it at once | MVP | P | 24, 25 | Check-in endpoint (confirmed registration, window) | none | Default window 30 minutes before (OQ-09) |
| F-EVT-005 | Host desk check-in | Search by name, phone or registration ID and check a player in manually | MVP | H, A | 48 | Check-in by staff; search | none | Phone-first layout |
| F-EVT-006 | Arrival metrics | Expected, checked in, first-timers, late arrivals | Launch | H, A | 46, 48 | Counts | none | |
| F-EVT-007 | First-timer host queue | List of first-time attendees with intro assignment and "welcomed" mark, available before doors open | Launch | H, A | 46, 47, 48 | First-timer list; welcomed flag and assignee | none | Assignee field not in schema (inferred) |
| F-EVT-008 | Pairing display | Board number, opponent, colour, time control; host action on mobile | MVP | P | 26, 27 | Published pairing for my registration | partial | Legacy rounds endpoint returns pairings with names but no board number or published flag |
| F-EVT-009 | Result submission | Player (or host) submits a result for their board; pending-confirmation feedback | MVP | P, H | 27 | Result submit endpoint, authorisation | none | Who may submit is open (OQ-01). Admin entry exists in F-PAIR-007 |
| F-EVT-010 | Result confirmation and disputes | pending, submitted, final; submitted can be disputed; "Pairing issue?" route to host; ratings use final only | Launch | P, H, A | 27, 49 | Result states, dispute flag | none | |
| F-EVT-011 | Between-rounds view | "Result saved, next pairing being prepared", score so far and current place | Launch | P | 28 | Running standings | none | |
| F-EVT-012 | Event complete view | Wrap-up with games, new opponents, rating change and link to rating page | Launch | P | 29 | Event summary; rating delta once processed | none | Shows "rating processing" until done |
| F-EVT-013 | Live updates | Room refreshes without a hard reload; polling with manual refresh now, realtime later | MVP | P | 24-29 | Cheap snapshot endpoint with change marker | none | Django has no realtime layer; poor venue networks expected |
| F-EVT-014 | Message event desk | "Message event desk" help action in every room state | Launch | P, H | 24-29 | Player-to-desk contact mechanism | none | Mechanism undefined; event_messages is outbound only (OQ-21) |
| F-EVT-015 | Standings | Per-event standings (score, tiebreaks, place) for live and final display | Launch | V, P | 4, 28, 29 | Standings computation | none | Legacy `leaderboard` is a global rating table (dropped) |
| F-EVT-016 | Completion and archive publish | Mark event complete; admin chooses to publish the archive page with recap and gallery | Launch | A | 4, 5, 52 | Archive flag and recap fields | none | |
| F-EVT-017 | Attendance record | Who attended, used by players admin and metrics | Launch | S | 54 | Derived from check-in/results | none | |

### 2.9 Pairing & rounds engine (PAIR)

| ID | Feature | Description | Priority | Actors | Screens | Backend needs | Legacy status | Notes |
|----|---------|-------------|----------|--------|---------|---------------|---------------|-------|
| F-PAIR-001 | Round lifecycle | draft, published, live, completed; draft can be voided if replaced | MVP | A | 49 | Round states | partial | Legacy has `is_complete` only |
| F-PAIR-002 | Swiss pairing | Pairings from score, rating, rematch history, colour balance, saved as an unpublished draft | MVP | A | 49 | Swiss generator | partial | Legacy generator exists (not audited for colour balance); it deletes and recreates pairings with no draft/publish. PG makes no FIDE-compliance claim |
| F-PAIR-003 | Balanced social matching | Suggest games from rating distance, recent rematches, player preference; admin or host may override; player may accept | Launch | A, H, P | 46, 49 | Cost-based matcher | none | "Player accepts / host changes" flow from UX-FLOWS (OQ-25) |
| F-PAIR-004 | Open play | Event with no generated pairing | Launch | A | 42 | Pairing mode flag | none | |
| F-PAIR-005 | Draft editing | Edit boards and players in a draft; board numbers | MVP | A | 49 | Pairing edit | partial | Legacy `PATCH pairing` edits result only (to confirm) |
| F-PAIR-006 | Publish and correct | Publish round to players (notifies them); edits after publish create a new version and audit entry | MVP | A | 49 | Publish action, versioning, audit | none | |
| F-PAIR-007 | Admin result entry | Admin records or overrides a result | MVP | A | 49 | Result write | exists | Legacy `PATCH pairings/<id>/` |
| F-PAIR-008 | Finalise round | Allowed only when all results are final; idempotent; triggers rating processing | MVP | A | 49 | Finalise action with processed-at gate | partial | Legacy `update-ratings` is not idempotent: re-running re-rates |
| F-PAIR-009 | Byes, withdrawals, late players | Inactive players excluded, odd player gets a bye, late arrivals added | MVP | A | 47, 49 | Active flag, bye handling | exists | Legacy `is_pairing_active`; bye handling inferred from nullable opponent |
| F-PAIR-010 | League and workshop formats | Round-robin with standings across dates; attendance-only workshops | Later | A | 42 | Schedule-based rounds; cross-date standings | none | Event types exist in design; engine for them not specified (OQ-27) |

### 2.10 Ratings (RATE)

| ID | Feature | Description | Priority | Actors | Screens | Backend needs | Legacy status | Notes |
|----|---------|-------------|----------|--------|---------|---------------|---------------|-------|
| F-RATE-001 | Rating pools | Independent Blitz, Rapid and Classical rating per player (rating, RD, volatility, games) | MVP | P, S | 22, 30 | Rating profile unique per (player, pool) | exists | Legacy `Rating` per time_control; defaults 1500 / RD 350 / vol 0.06 |
| F-RATE-002 | Glicko-2 round update | Every player in a round is rated from the same pre-round snapshot | MVP | S | 49 | Glicko-2 calculation, tested on known vectors | partial | Legacy `glicko2.py` exists, vectors not verified. Runs as a triggered job on the Railway worker (OQ-06) |
| F-RATE-003 | Rating ledger | Append-only transaction per rated game or round; written before current rating is replaced; auditable and rebuildable | Launch | S | 29, 30 | Ledger table | none | Legacy keeps only rating_before/after on the registration |
| F-RATE-004 | Idempotent finalisation | A processed round can never rate twice (processed-at gate, single transaction) | MVP | S | 49 | Transactional finalise; processed-at | none | Core fix to legacy behaviour |
| F-RATE-005 | Provisional and RD explanation | New or high-RD players shown as "New"/provisional; plain-language RD note | Launch | P | 22, 30 | RD and games count exposed; threshold rule | none | Threshold value open (OQ-10) |
| F-RATE-006 | Rated vs social games | Event flags rated/unrated and pool; unrated and social games create no deltas | MVP | A, S | 30, 42 | Rated flag and pool on event | partial | Legacy tournaments always use a time_control |
| F-RATE-007 | Rating page data | Pool cards, trend series (e.g. 90 days), recent ledger | Launch | P | 29, 30 | Series and ledger reads per pool | partial | Legacy `me` returns current rating only |
| F-RATE-008 | Rating visibility | Ratings visible to others only if the player allows (F-PROF-004) | Launch | P | 31 | Visibility check in projections | none | |
| F-RATE-009 | Ledger rebuild | Recompute current ratings from the ledger | Later | A, S | no UI | Rebuild job | none | "Rebuild potential" in DATABASE-SCHEMA |

### 2.11 Admin: events (ADEV)

| ID | Feature | Description | Priority | Actors | Screens | Backend needs | Legacy status | Notes |
|----|---------|-------------|----------|--------|---------|---------------|---------------|-------|
| F-ADEV-001 | Admin dashboard | Next event status, first-timers, pending payments, website health, "needs attention" list (payments unreconciled, media without alt, testimonial missing consent) | Launch | A | 32 | Operational aggregates | none | |
| F-ADEV-002 | Events list | All events across types and statuses: date, type, capacity/filled, price, pairing, status; state filters | MVP | A | 37 | Admin event list with filters, counts | partial | Legacy admin list exists |
| F-ADEV-003 | Event Builder flow | 8-step flow with per-step validation, draft saved server-side, one step at a time on mobile | MVP | A | 38-45 | Draft event persistence | none | Legacy has no draft status |
| F-ADEV-004 | Builder 1: Basics | Title, type, city, area, venue, start, end, short summary | MVP | A | 38 | Event core fields | partial | Legacy: name, date, venue, format, time_control |
| F-ADEV-005 | Builder 2: Experience | Hosted social vs competitive, arrival promise, beginner friendly, hosted introductions, public tags | MVP | A | 39 | Experience fields on event | none | Experience comes before mechanics by design |
| F-ADEV-006 | Builder 3: Registration | Capacity, waitlist on/off, open and close times, eligibility, first-timer question | MVP | A | 40 | Registration config fields | partial | Legacy: max_players, registration_deadline |
| F-ADEV-007 | Builder 4: Payment | Free, fixed price, member price, invite/comp; fee, currency (INR), refund window, provider (Razorpay) | MVP | A | 41 | Pricing and refund fields | partial | Legacy: entry_fee only. Member and comp tied to OQ-03 |
| F-ADEV-008 | Builder 5: Game system | Balanced social, Swiss, open play; rated yes/no, pool, time control, rounds | MVP | A | 42 | Game-system fields | partial | Legacy: format, rounds, time_control |
| F-ADEV-009 | Builder 6: Media | Attach event media collection: static or carousel, autoplay, alt, focal | MVP | A | 43 | Event to collection link | none | |
| F-ADEV-010 | Builder 7: Communications | Toggle each state-triggered message and its channels | Launch | A | 44 | Per-event message config | none | See F-COMM-002 |
| F-ADEV-011 | Builder 8: Review and publish | Summary, public preview, "ready to publish" check, save draft, publish | MVP | A | 45 | Publish with validation | none | |
| F-ADEV-012 | Edit existing event | Reopen the builder for an existing event | MVP | A | 38-45 | Update with status-safe field rules | partial | Manifest has `/admin/events/new` only (OQ-22). Legacy PATCH exists |
| F-ADEV-013 | Event types and defaults | Social, rated tournament, league, workshop, special; each supplies configurable defaults | Launch | A | 38 | Event-type table with defaults | none | Type is data, not a hard-coded fork |
| F-ADEV-014 | Control Room frame | Event header, summary strip (confirmed, first-timers, checked in, pairing), eight route-linked tabs | MVP | A, H | 46-53 | Event summary read | none | |
| F-ADEV-015 | Overview tab | Run-of-show checklist (venue confirmed, newcomer list, pairing publish), pairing engine summary | Launch | A, H | 46 | Run-of-show items per event | none | Items inferred from the screen |
| F-ADEV-016 | Registrations tab | Search registrations: player, rating, first-time, payment, registration status; row actions | MVP | A | 47 | Registration list with joins; row actions (cancel, move, mark) | partial | Legacy admin list exists, no row actions beyond PATCH |
| F-ADEV-017 | Gallery and recap tab | Upload event photos, write recap, toggle "publish archive page" | Launch | A | 52 | Event media collection; recap text; publish flag | none | |
| F-ADEV-018 | Event audit tab | Time-ordered actor, action, object; export log | Launch | A | 53 | Audit read filtered by event; export | none | Log export is kept; not the dropped CSV player export |
| F-ADEV-019 | Venues and host assignment | Reusable venue records; assign hosts to an event | Later | A | none | Venue and event-host records | none | Free-text venue is enough to start; host scope open (OQ-02) |
| F-ADEV-020 | Field permission tiers | Operational fields (capacity, payment, pairing, eligibility, rating) need stronger permission and audit than editorial copy | Launch | A | 38-45 | Permission check per field group | none | From CMS-SPEC boundary |

### 2.12 Admin: CMS, media, stories, testimonials (ACMS)

| ID | Feature | Description | Priority | Actors | Screens | Backend needs | Legacy status | Notes |
|----|---------|-------------|----------|--------|---------|---------------|---------------|-------|
| F-ACMS-001 | Structured section editor | Edit Home Hero, Upcoming, First Visit, Community, Story, Final CTA, Navigation, Footer through fixed fields; no free HTML | Launch | A | 33 | Pages and sections store with typed content | none | Layout stays design-system owned |
| F-ACMS-002 | Draft, preview, publish | Draft is separate from published; admin preview reads draft; publish stamps time and audit | Launch | A | 33 | Status per page/section; preview auth | none | |
| F-ACMS-003 | Edit conflict and history | Detect "changed by another admin"; basic version history | Launch | A | 33 | Version number or etag; history table | none | Full history browser could slip to Later |
| F-ACMS-004 | Page metadata and copy pages | SEO title/description, community and other page copy | Launch | A | 33 | Metadata fields | none | Feeds F-SEO-002 |
| F-ACMS-005 | Media library | Upload (type and size validation, progress), search; alt text, decorative flag, focal X/Y, credit/rights | MVP | A | 34 | Upload storage, media asset record | partial | Legacy gallery photo = URL, caption, category only. **Storage decided (OQ-06): uploads go to Supabase Storage**; the frontend allow-lists its host in `next/image` `remotePatterns`. Bucket policies are part of the Supabase lockdown checklist |
| F-ACMS-006 | Media collections | Named collections: static or carousel, autoplay, interval, ordered assets; reusable across sections and events | MVP | A | 34, 43 | Collection and item records | none | |
| F-ACMS-007 | Referenced-asset protection | Block deleting referenced assets; archive instead | Launch | A | 34 | Reference check | none | |
| F-ACMS-008 | Responsive image delivery | Sized derivatives, stored dimensions, cache headers | Launch | V | 1-7 | Derivative generation or image service | none | Originals in Supabase Storage; optimisation by `next/image` on Vercel unless the architect chooses otherwise |
| F-ACMS-009 | Stories admin | Create, edit, publish essays, recaps, rivalries, member profiles: kind, slug, eyebrow, title, summary, body, date, reading time, featured, media | Launch | A | 35 | Story CRUD, publish, slug | none | Body format ("as implemented") not defined (OQ-11) |
| F-ACMS-010 | Testimonials admin | Photo, exact quote, name, descriptor, consent timestamp, sort order, publish; publish blocked without quote, photo and consent; no automatic rewriting | Launch | A | 36 | Testimonial CRUD with publish validation | none | Consent rules enforced on the server |

### 2.13 Admin: players, payments, settings, roles, audit (AADM)

| ID | Feature | Description | Priority | Actors | Screens | Backend needs | Legacy status | Notes |
|----|---------|-------------|----------|--------|---------|---------------|---------------|-------|
| F-AADM-001 | Players admin | Search by name, email or phone; record with event history, attendance, rating context, permitted private fields | Launch | A | 54 | Player search and admin projection | none | Private fields limited by role |
| F-AADM-002 | Role management | Assign and revoke roles; admin only; audited | Launch | A | 54 | Set-role endpoint | none | Initial admins can be seeded (OQ-17) |
| F-AADM-003 | Event-scoped host permissions | Host or organiser gets access to one event's operations without admin | Later | A, H | none | Per-event permission model | none | DEVELOPER-HANDOFF: launch can use admin for all (OQ-02) |
| F-AADM-004 | Payments admin | Global ledger: player, event, amount, status, provider IDs, updated; mismatch flag; reconcile | Launch | A | 55 | Ledger query with filters | none | |
| F-AADM-005 | Settings | Brand and site (default city, timezone, support email, WhatsApp), Authentication, Ratings, Payments, Notifications, Event defaults; no secrets | Launch | A | 56 | Settings store (non-secret) | none | Default city Hyderabad, timezone Asia/Kolkata in design |
| F-AADM-006 | Integration status | Show Google, Razorpay, email, WhatsApp provider health | Launch | A | 56 | Health/connected flags | none | |
| F-AADM-007 | Audit log write | Every privileged mutation records actor, time, before/after, request ID | MVP | S | no UI | Append-only audit table | none | Policy if audit is unavailable is open in UI-STATES |
| F-AADM-008 | Audit log read | Admin views and exports audit entries | Launch | A | 53 | Filtered audit read | none | Same as F-ADEV-018 for events |
| F-AADM-009 | Admin access guard | Admin routes and endpoints refuse non-admins; clear permission state | MVP | A | 32-56 | Role check on every admin endpoint (ADMIN_REQUIRED) | partial | Legacy `IsAdminUser` exists |

### 2.14 Communications (COMM)

| ID | Feature | Description | Priority | Actors | Screens | Backend needs | Legacy status | Notes |
|----|---------|-------------|----------|--------|---------|---------------|---------------|-------|
| F-COMM-001 | Transactional email | Send registration confirmation and account emails through the email provider | MVP | S | 21 | Email adapter, templates | partial | Legacy sends password-reset email only (SendGrid via anymail). Provider open (OQ-05). Sending runs on the Railway worker (OQ-06) |
| F-COMM-002 | State-triggered messages | Per-event toggles and channels for confirmation, 24-hour reminder, check-in open, pairing published, post-event | Launch | A, S | 44, 51 | Trigger rules; templates | none | "Useful, sparse, state-aware", no bulk promos |
| F-COMM-003 | One-off event message | Admin sends a message to an event audience | Launch | A | 51 | Store message and audience first, then deliver | none | |
| F-COMM-004 | Audience selection | Pick recipients (confirmed, waitlist, checked in, first-timers) | Launch | A | 51 | Audience queries | none | Segments inferred |
| F-COMM-005 | Message log and delivery state | Per-message, per-recipient status including partial failure | Launch | A | 51 | Message and delivery records | none | |
| F-COMM-006 | Channel health | Email, WhatsApp, SMS connection state | Launch | A | 51, 56 | Provider health checks | none | |
| F-COMM-007 | WhatsApp channel | Event-day messages over WhatsApp | Later | S | 51 | Approved provider adapter | none | Provider undecided; consent required (OQ-04) |
| F-COMM-008 | SMS channel | Optional SMS | Later | S | 51 | Provider adapter | none | OQ-04 |
| F-COMM-009 | Consent and contact preferences | Explicit consent before WhatsApp/SMS; per-channel opt-out; consent stored with timestamp | Launch | P | none | Consent records; preference fields | none | No screen in the 58 for preferences (inferred need); legal review needed |

### 2.15 Notifications & reminders (NOTI)

| ID | Feature | Description | Priority | Actors | Screens | Backend needs | Legacy status | Notes |
|----|---------|-------------|----------|--------|---------|---------------|---------------|-------|
| F-NOTI-001 | In-app notifications | Notices independent of email/WhatsApp delivery | Launch | P | none | Notification records; read endpoint | none | No bell or inbox in the 58 screens (OQ-28) |
| F-NOTI-002 | 24-hour reminder | Scheduled reminder before the event | Launch | S | no UI | Scheduler | none | Railway scheduler service (OQ-06) |
| F-NOTI-003 | Check-in open notice | Notify when check-in opens | Launch | S | no UI | Scheduler | none | Railway scheduler service (OQ-06) |
| F-NOTI-004 | Pairing published notice | Immediate board/opponent notice on publish | Launch | S | no UI | Trigger on publish | none | |
| F-NOTI-005 | Waitlist offer notice | Tell the next waitlisted player a place opened | Launch | S | no UI | Trigger on release | none | Pairs with F-REG-006 |
| F-NOTI-006 | Post-event message | Thank-you with recap and rating link | Launch | S | no UI | Trigger on completion | none | |

### 2.16 Contact form (CON)

| ID | Feature | Description | Priority | Actors | Screens | Backend needs | Legacy status | Notes |
|----|---------|-------------|----------|--------|---------|---------------|---------------|-------|
| F-CON-001 | Contact form | Name, email, topic (joining an event, partnership, payment), message; validation, success and error states | Launch | V | 8 | Submit endpoint, spam/rate protection, delivery to configured destination | none | Legacy form only simulates success; `mailto:contact@pgchess.in` shown (design shows hello@pgchess.in, see OQ-05) |
| F-CON-002 | Contact details config | WhatsApp, email, social URLs managed in CMS or settings | Launch | A | 8, 56 | Settings read | partial | Legacy `socials.jsx` hard-coded |
| F-CON-003 | Submission store and inbox | Keep submissions for follow-up | Later | A | none | Contact record | none | inferred; no admin screen exists |

### 2.17 Legal pages (LEG)

| ID | Feature | Description | Priority | Actors | Screens | Backend needs | Legacy status | Notes |
|----|---------|-------------|----------|--------|---------|---------------|---------------|-------|
| F-LEG-001 | Privacy, Terms, Refund pages | Readable legal pages with effective date, CMS-managed text, linked from footer and payment | MVP | V | 9, 10, 11 | CMS legal content | partial | Legacy has Privacy and Terms pages; refund page is new. Wording needs owner/legal approval |
| F-LEG-002 | Policy acceptance record | Record that the user accepted terms at sign-up or registration | Later | P | 14, 18 | Consent record with version | none | inferred |
| F-LEG-003 | Event waiver / conduct acknowledgement | Optional per-event waiver text and acceptance | Later | P | 40 | Waiver text and acceptance record | none | Only "if PG chooses to require it" (OQ-23) |
| F-LEG-004 | Data export and deletion | Handle a player's request to export or delete their data | Later | P, A | none | Export and anonymise procedures | none | inferred |

### 2.18 Analytics (ANA)

| ID | Feature | Description | Priority | Actors | Screens | Backend needs | Legacy status | Notes |
|----|---------|-------------|----------|--------|---------|---------------|---------------|-------|
| F-ANA-001 | Funnel event capture | event_viewed, find_game_started, registration_started/completed, payment_started/completed, waitlist_joined, event_checked_in, pairing_viewed, result_submitted, event_attended, player_returned_21d | Launch | S | 2, 3, 18-21, 25-27 | First-party event intake; server-side events for attended/returned | none | |
| F-ANA-002 | Community metrics | First-game conversion, registration to attendance, first-timer to second visit in 21 days, repeat-opponent rate, distinct opponents, fill time, waitlist conversion | Later | A | 32 | Aggregates over events | none | Referral metric "when implemented" |
| F-ANA-003 | Analytics privacy | Pseudonymous IDs; no phone, email, DOB or payment IDs; consent per chosen product | Launch | S | no UI | Data-minimisation rules | none | Product choice open (OQ-19) |

### 2.19 Non-functional (NFR)

| ID | Feature | Description | Priority | Actors | Screens | Backend needs | Legacy status | Notes |
|----|---------|-------------|----------|--------|---------|---------------|---------------|-------|
| F-NFR-001 | Accessibility WCAG 2.2 AA | Keyboard access, focus, skip link, labels, live regions, reduced motion, 200% zoom, 320px layout; alt text managed in CMS | MVP | all | all | Alt text and decorative flag in media data | none | Test with VoiceOver, NVDA, keyboard only |
| F-NFR-002 | Mobile-first responsive | Designed for 320-1440px; Event Room essentials at 390px; admin tables become stacked rows | MVP | all | all | none | none | Physical-event use drives it |
| F-NFR-003 | Performance | Fast mobile load; targets and bundle budgets to be set by architecture | Launch | all | all | Cacheable public reads; paginated lists | none | PLAN-001 proposes LCP under 2.5 s, CLS under 0.1, INP under 200 ms (proposal, unconfirmed). Frontend functions, backend and database are all co-located in Singapore (OQ-06) to keep latency low for India |
| F-NFR-004 | Security controls | Server-owned authorisation and price; object-level checks; secrets only on the server; CSP, HSTS, nosniff, referrer and permissions headers; no tokens or full phone lists in logs | MVP | all | all | Per AUTH-SECURITY and BACKEND-CONTRACT | partial | Legacy findings: open registration list, min password 6, no refresh blacklist. **Supabase lockdown (OQ-06):** the auto-generated Supabase REST API must be unreachable because the backend owns all data access: enable RLS with no policies on every backend table, or disable the API; no Supabase anon or service keys in client code |
| F-NFR-005 | Privacy and PII separation | Private vs public identity enforced in data and API; retention rules | Launch | all | 31 | Separate public-profile projection | none | Retention period open (OQ-16) |
| F-NFR-006 | Observability | Request IDs on responses and logs, error tracking, alerts for payment/webhook failures, backups with restore drill | Launch | S | no UI | Logging, metrics, alerting | partial | Decision DEC-011 proposes `meta.request_id` but is not implemented. Backups: Supabase paid plan with daily backups must be on before real payments are taken (OQ-06) |
| F-NFR-007 | Locale, time and currency | English; all times in IST (Asia/Kolkata); amounts in INR with correct format; amounts held in minor units | MVP | all | all | Timezone-aware datetimes; currency field | partial | English-only is inferred; no i18n requirement stated |
| F-NFR-008 | Legacy data migration | Move users, tournaments, registrations, rounds/pairings, ratings and gallery photos into the new model with reconciliation counts and money totals | Launch | S | no UI | Mapping tables, scripts, reconciliation | none | Legacy IDs kept until sign-off. Data access in OQ-16. **Region move (OQ-06):** the database also moves from Supabase ap-northeast-2 (Seoul) to a new Singapore (ap-southeast-1) project; the owner performs it (create project, dump/restore, update connection strings) following a runbook with row-count and money-total reconciliation. This is an infrastructure move and is separate from the legacy-to-new-model data migration, though the two can be combined if the backend is rebuilt (OQ-18) |
| F-NFR-009 | API envelope and stable error codes | One response envelope and stable codes (AUTH_REQUIRED, EVENT_FULL, PAYMENT_MISMATCH and so on) for the UI to map to friendly text | MVP | all | all | Renderer and exception handler | none | DEC-011 approved but not implemented; legacy responses are bare |
| F-NFR-010 | Environments, CI and rollback | Separate local, staging, production; CI gates; backups; rollback plan | Launch | S | no UI | Infrastructure | none | Decided (OQ-06): production, staging (separate Railway environment and separate Supabase project) and Vercel preview deployments |
| F-NFR-011 | Poor-network behaviour | No success shown before server confirmation; explicit pending, success, failure for results, payments and admin changes | MVP | all | 58 | Idempotent mutations | none | |
| F-NFR-012 | Pagination and list scale | Paginated lists for events, registrations, payments, players | Launch | all | 2, 5, 47, 54, 55 | Pagination in list endpoints | none | Legacy has none |
| F-NFR-013 | Rate limiting and abuse protection | Limits on auth, contact, privileged functions | Launch | S | no UI | Throttling | none | Launch checklist item |
| F-NFR-014 | Design-system and UI-states reference pages | Dev-only pages for review | Later | dev | 57, 58 | none | none | Must be disabled in production |

---

## 3. Actors & roles

| Actor | Who | What they can do | Source / status |
|-------|-----|------------------|-----------------|
| Visitor (V) | Anyone not signed in | Browse home, events, archive, stories, community, legal; contact form; sign up or log in | Clear |
| Player (P) | Signed-in account with role `player` | Register, pay, cancel, check in, see own pairing, submit result (if allowed), view ratings, edit profile | Clear |
| Admin (A) | Role `admin` | Everything in the Control Room: CMS, media, events, rounds, payments, players, settings, roles, audit | Clear |
| Host / event staff (H) | Person running a venue on the night | Check-in desk, first-timer welcome list, possibly result entry and pairing overrides | **Unclear.** `event_hosts` exists in the data model and "Mark welcomed" appears on screen 48, but DEVELOPER-HANDOFF says launch can use `admin` for all operations. Needs an owner decision (OQ-02) |
| System (S) | Scheduled jobs, webhooks | Hold expiry, reminders, status changes, rating processing, reconciliation | Clear |
| Member | Player with a membership | Member price | **Unclear.** `memberships` entity and "Member price" in the builder, but event copy says "No membership needed" (OQ-03) |
| Payment-exception owner | Named person who handles failed payments | Operational role, not a software role | Launch checklist asks for a named owner; no software role |

Notes: the legacy app has only `player` and `admin`. A "first-timer" is a player state, not a role.

## 4. Core entities

Names from `DATABASE-SCHEMA.md` and `CONTENT-MODEL-MAP.md`. Items marked **inferred** are needed by features here but not named in those docs.

| Entity | Purpose |
|--------|---------|
| profiles | Private account data and preferences |
| user_roles | Server-owned role per user |
| player_public_profiles | Deliberately public identity fields and visibility flags |
| memberships | Optional member pricing and status (OQ-03) |
| cms_pages | Public pages with metadata and publish state |
| cms_sections | Typed content blocks within a page, each pointing at a media collection |
| media_assets | Uploaded images with alt, focal point, credit, archive state |
| media_collections | Named static/carousel sets with autoplay and interval |
| media_collection_items | Ordered assets in a collection |
| testimonials | Quote, photo, consent, sort order, publish state |
| editorial_stories | Stories and recaps with slug, kind, media, publish state (named `cms_stories` in ROUTE-DATA-MATRIX; names to be reconciled) |
| navigation_items | Nav and footer links, labels, order |
| site_settings | Non-secret configuration |
| event_types | Configurable defaults per type |
| events | Unified master record for social, tournament, league, workshop, special |
| venues | Reusable locations |
| event_hosts | Event-scoped staff assignment |
| event_registrations | Player place in an event with state, hold, waitlist position |
| event_checkins | Arrival record, self or staff |
| event_rounds | Round per event with lifecycle state and version |
| event_pairings | Board, players, colours and result with lifecycle |
| event_messages | Outbound messages with audience and delivery state |
| payment_orders | PG's expected purchase (server price) |
| payments | Provider-confirmed money state |
| payment_webhook_events | Provider events kept for replay protection and evidence |
| rating_profiles | One row per player and pool |
| rating_transactions | Append-only rating history |
| audit_log | Privileged mutations with actor, before/after, request ID |
| notifications | In-app notices |
| refunds (inferred) | Refund requests and results linked to payments |
| cms_versions (inferred) | History and conflict detection for CMS edits |
| waitlist_offers (inferred) | Offer and expiry per waitlisted player, if not held on registrations |
| contact_messages (inferred) | Contact form submissions |
| consent_records (inferred) | Channel and policy consent with timestamp and version |
| message_deliveries (inferred) | Per-recipient delivery state |
| analytics_events (inferred) | First-party funnel events |
| legacy_id_map (inferred) | Old IDs to new IDs during migration |

## 5. Background jobs & integrations

Hosting (OQ-06, resolved): scheduled jobs and background workers run on Railway (Southeast Asia, Singapore) as separate services beside the API service: a **worker** (message delivery, email sending, rating processing, retries) and a **scheduler/cron** (hold expiry, waitlist offer expiry, status transitions, reconciliation, reminders). They read and write Supabase Postgres (Singapore) through the connection pooler. The frontend runs on Vercel (functions pinned to `sin1`).

| Item | Type | What it does | Features |
|------|------|--------------|----------|
| Razorpay webhook | Integration, inbound | Verify raw-body signature, dedupe, reconcile captured, failed, refunded. Delivered straight to the Railway API service, not through Vercel | F-PAY-004 |
| Razorpay API | Integration, outbound | Create orders, fetch payments, issue refunds | F-PAY-001, 003, 007 |
| Hold expiry | Scheduled job (Railway scheduler) | Release expired capacity holds | F-PAY-006, F-REG-003 |
| Waitlist offer expiry | Scheduled job (Railway scheduler) | Lapse unclaimed offers, offer to next | F-REG-006 |
| Event status transitions | Scheduled job (Railway scheduler) | Open and close registration, start and complete by time (replaces legacy write-on-GET) | F-EVT-001 |
| Payment reconciliation | Scheduled job (Railway scheduler) and on demand | Compare Razorpay and PG records, flag mismatches | F-PAY-009 |
| Rating processing | Triggered job (Railway worker, on finalise) | Compute Glicko-2 and write ledger once per round | F-RATE-002, 003, 004 |
| Reminders | Scheduled job (Railway scheduler) | 24-hour reminder, check-in open, post-event | F-NOTI-002, 003, 006 |
| Event-triggered notices | Event hooks | Pairing published, waitlist offer, registration confirmed | F-NOTI-004, 005, F-COMM-001 |
| Message delivery worker | Background worker (Railway worker) | Send stored messages and emails, record per-recipient result, retry | F-COMM-003, 005 |
| Email provider | Integration | Transactional and event email. Docs suggest Resend; legacy uses SendGrid via anymail | F-COMM-001 (OQ-05) |
| WhatsApp / SMS provider | Integration | Event-day messages, only with consent | F-COMM-007, 008 (OQ-04) |
| Google OAuth | Integration | Sign-in with Google | F-AUTH-005 |
| Frontend revalidation hook | Integration, outbound | On publish/unpublish the Railway backend calls the Vercel `/api/revalidate` route with an HMAC-signed request (shared secret configured in both environments), with retry | F-SEO-005 |
| Browser-to-API rewrite | Hosting configuration | Vercel rewrite `/api/*` to the Railway API service so the browser sees one origin (no CORS) | F-AUTH-003, F-NFR-004 |
| Sitemap source | On-demand read | List of published URLs with last-modified | F-SEO-004 |
| Media storage and image processing | Integration | **Supabase Storage** (decided, OQ-06) stores uploads; `next/image` on Vercel makes derivatives; the Storage host is allow-listed in `remotePatterns` | F-ACMS-005, 008 |
| Analytics intake | Integration | Receive first-party funnel events | F-ANA-001 |
| Legacy migration and reconciliation | One-off job | Move data, compare counts and money totals | F-NFR-008 |
| Database region move | One-off operation (owner) | Move Supabase Postgres from ap-northeast-2 (Seoul) to a new Singapore (ap-southeast-1) project: create project, dump/restore, update connection strings (pooler, transaction mode; Django must disable server-side cursors), reconcile counts and money totals | F-NFR-008, 010 |
| Supabase lockdown | Security configuration | Make the auto-generated Supabase REST API unreachable: RLS enabled with no policies on all backend tables, or API disabled; Storage bucket policies for media only | F-NFR-004 |
| Backups and monitoring | Operations | Supabase paid plan with daily backups before taking real payments; restore drill, alerts | F-NFR-006, 010 |

## 6. Explicitly out of scope / dropped

**Dropped by owner decision (legacy features not carried over).**

| Item | Where it lives today | What replaces it |
|------|----------------------|------------------|
| Public Gallery page | `src/pages/Gallery.jsx`, `GET /api/gallery/` | Per-event gallery and recap (F-PUB-004, F-ADEV-017). Legacy photos still migrate into media assets and collections by event (F-NFR-008) |
| Tournament leaderboard | `GET /api/tournaments/<id>/leaderboard/` (a global rating table for the time control) | Per-event standings (F-EVT-015). No global leaderboard in the new product |
| CSV export | `GET /api/tournaments/<id>/export-csv/` | Nothing. The admin audit log export (F-ADEV-018) is a different feature and stays |

**Not in initial launch (PRODUCT-SCOPE).**
- Generic social feed
- User-to-user direct messages
- Streak or other addictive mechanics
- Public phone or email directory
- Arbitrary admin HTML injection (the CMS is structured, not a page builder)
- Any claim of official FIDE pairing unless an approved FIDE pairing integration is added later
- Card data collection on PG infrastructure (Razorpay Standard Checkout only)

**Other exclusions (inferred).**
- Supabase-specific mechanisms (RLS policies as an authorisation layer, Edge Functions, `VITE_USE_MOCKS`) are design-doc implementation detail, not product features. Supabase remains in use only as Postgres and Storage hosting (OQ-06); the backend owns all data access.
- Decorative legacy visuals (3D pawn, shader rings, background blobs) are not carried over; the new design replaces them. Inferred from legacy component names only.
- Installable PWA (PLAN-001 optional task) is not scheduled and not part of this inventory.
- A referral or "+1" programme appears in ANALYTICS "when implemented" and has no feature or screen.
- Mock or demo mode in production is forbidden. Dev-only review pages are F-NFR-014 (Later).

## 7. Open questions / decisions needed from the owner

"Blocks" shows the earliest piece of work that needs the answer. "Proposal" is a default the team could use if the owner does not answer; it is not a decision.

| ID | Question | Blocks | Proposal if unanswered |
|----|----------|--------|------------------------|
| OQ-01 | Who may submit a result: both players, the host only, either? Who can dispute and who has the final say? | F-EVT-009, 010 (MVP) | Either player submits; opponent or host confirms; admin resolves disputes |
| OQ-02 | Does anyone besides admins need event-scoped host or organiser access at launch? If yes, who and what can they do (check-in, results, pairings, messages)? | F-EVT-005, F-AADM-003 | Launch with admins only; add a host permission later |
| OQ-03 | Membership and discount model: do memberships exist at launch? Member price, comp/invite and donation modes (all appear in the design or scope docs) | F-REG-009, F-ADEV-007 | Free and fixed price only at launch; hide member, comp and donation |
| OQ-04 | WhatsApp and SMS: which provider, which message types, and the consent wording? | F-COMM-007, 008, 009 | Email only at launch |
| OQ-05 | Email provider (docs suggest Resend; legacy uses SendGrid), sender domain, and the contact-form destination (`hello@pgchess.in` in the design vs `contact@pgchess.in` in the old site) | F-COMM-001, F-CON-001 (MVP) | Keep SendGrid; one support address from settings |
| OQ-06 | **RESOLVED (owner-confirmed, v2).** Where will the Next.js frontend be hosted, and where will the backend run? **Decision:** Frontend on Vercel (Next.js; Pro plan needed for commercial use; functions pinned to Singapore `sin1`). Backend on Railway, Southeast Asia (Singapore): an API service, a worker and scheduler/cron services (hold expiry, reminders, rating processing, emails). Database: Supabase Postgres, **moving from ap-northeast-2 (Seoul) to a new Singapore (ap-southeast-1) project**; the owner performs the move (create project, dump/restore, update connection strings). The backend uses the Supabase connection pooler (transaction mode; if Django, disable server-side cursors). Paid Supabase plan with daily backups before real payments. Staging: separate Railway environment and separate Supabase project; Vercel preview deployments. Supabase's auto-generated REST API is locked down (RLS enabled with no policies on all backend tables, or API disabled) because the backend owns data access. Media uploads: **Supabase Storage** (allow-listed in `next/image` `remotePatterns`). The browser calls the API through a Vercel rewrite `/api/*` to Railway, giving one origin (no CORS) and allowing the refresh token to move to an httpOnly cookie later. Razorpay webhooks go straight to Railway, not through Vercel. Django-to-Vercel publish revalidation uses the HMAC-signed `/api/revalidate` route with a shared secret in both environments. Hosting works whether OQ-18 is answered "extend Django" or "rebuild". | (was F-SEO-001, 005) no longer blocks | n/a |
| OQ-07 | Refund and cancellation rules: default window (design example: 24 hours before start), partial refunds, no-shows, who may override, event cancellation by PG, and tax/invoice wording | F-PAY-007, 008, F-REG-007 | Full refund until the per-event window closes; none after; admin may override with a reason |
| OQ-08 | Hold length for paid places (design example: 10 minutes) and waitlist offer window | F-REG-003, 006 (MVP) | 10-minute hold; 2-hour waitlist offer |
| OQ-09 | Default check-in window (design example: opens 30 minutes before) and what happens to late arrivals | F-EVT-004 (MVP) | 30 minutes before start; host can check in at any time |
| OQ-10 | Do PG ratings launch immediately for all rated formats? What counts as provisional (games or RD threshold)? Seed rating for new players? | F-RATE-005, 006 | Rated events only; provisional while RD is above a threshold set in settings; 1500 start as in legacy |
| OQ-11 | Individual story pages: required? What is the story body format (rich text, blocks, markdown)? No screen exists. | F-PUB-008, F-ACMS-009 | Story detail page needed; simple structured blocks |
| OQ-12 | Google sign-in: link to an existing email account automatically, or require login first? Is it required for the first release? | F-AUTH-005 | Flagged off at launch; link only after email is verified by Google |
| OQ-13 | Password rules (legacy minimum is 6) and whether email verification is required | F-AUTH-001, 010 | Stronger minimum enforced by the new backend; no verification at launch |
| OQ-14 | Admin MFA: required, optional, or later? | F-AUTH-009 | Later |
| OQ-15 | Supported cities at launch and the real venue addresses and map links (needed for Event schema) | F-SEO-003, F-ADEV-004 | Hyderabad only (default in the design) |
| OQ-16 | Data retention, deletion requests, and access to the production database export for migration (OWNER-LAUNCH-INPUTS lists a production Supabase export) | F-NFR-005, 008, F-LEG-004 | Keep legacy data read-only for an agreed period; retention to be set by legal review |
| OQ-17 | Initial admin identities | F-AADM-002 | Owner supplies emails before staging |
| OQ-18 | Backend direction: extend the current Django app or build a new one; what happens to the Supabase-specific parts of the reference docs? (Database hosting is decided in OQ-06: Supabase Postgres stays, moved to Singapore. This question is now only about the backend code.) **Still open.** | All backend planning | Keep Django REST; treat Supabase text in the reference as design intent |
| OQ-19 | Analytics product and consent approach | F-ANA-001, 003 | First-party events only, no third-party script |
| OQ-20 | Rematch request: is it a launch feature? How does it work (request, accept, notify, schedule)? | F-PLY-004 | Later |
| OQ-21 | "Message event desk": how does a player reach the desk (message in app, WhatsApp link, phone)? | F-EVT-014 | Show a configurable WhatsApp or phone link from settings |
| OQ-22 | Editing an existing event: reuse the builder at an edit URL, and which fields lock after registrations or payments exist? | F-ADEV-012 | Reuse the builder; lock price, capacity-down and game system once registrations exist |
| OQ-23 | Is an event waiver or conduct acknowledgement required, and what wording? | F-LEG-003 | Not required |
| OQ-24 | When an event or story title changes, does the slug change? Should old slugs redirect? | F-SEO-006 | Slug fixed after publish; admin can change with an automatic redirect |
| OQ-25 | Social matching: how does a player accept a suggested game, and how does a host override it? | F-PAIR-003 | Host-driven at launch; player acceptance later |
| OQ-26 | Is there a public player profile page? The public-profile entity exists but no screen. | F-PROF-005 | No public player page; show name and rating only inside event views. **Superseded 2026-10-31 (PLAN-007, owner approved):** public page `/players/{publicId}` with an opaque `publicId` in identity; no other id is exposed. |
| OQ-27 | League and workshop formats: needed at launch, and how do standings work across dates? | F-PAIR-010 | Later; launch with social, tournament and special |
| OQ-28 | In-app notifications: is there an inbox or bell, or are notices shown only in the Event Room and by email? | F-NOTI-001 | Event Room banners and email only |

**Owner inputs that are not decisions** (from OWNER-LAUNCH-INPUTS; no engineering blocker, but needed before launch): production database and platform access, Google OAuth client and secret, Razorpay test and live credentials and webhook secret, email and messaging provider credentials, domain and DNS, final logo, real photography with rights, approved testimonial quotes, photos and consent for Keerthy Ganta and Parth Thakkar (and any others), venue addresses, social and contact URLs, and approved privacy, terms and refund wording. Added by the hosting decision: a Vercel Pro account, a Railway project (production and staging environments), a new Singapore Supabase project (production, plus a separate staging project) on a paid plan, and the shared revalidation secret.

Items from OWNER-LAUNCH-INPUTS already mapped to questions above: admin identities (OQ-17), event-scoped host access (OQ-02), check-in window (OQ-09), cancellation and refund window (OQ-07), rating launch scope (OQ-10), supported cities (OQ-15).

## Appendix A. Screen traceability (58 screens)

Every screen in `SCREEN-MAP.csv` maps to at least one feature. Cross-cutting features (F-NFR-001, 002, 004, 007, 009, 011) apply to every screen and are not repeated in each row.

| # | Screen | Feature IDs |
|---|--------|-------------|
| 1 | Home | F-PUB-001, 009, 010, 011, 012; F-SEO-001, 002 |
| 2 | Play | F-PUB-002, 011; F-SEO-001, 002; F-ANA-001; F-NFR-012 |
| 3 | Event: Open | F-PUB-003, 011, 012; F-SEO-001, 002, 003, 006; F-REG-001; F-ANA-001 |
| 4 | Event: Completed | F-PUB-004, 012; F-SEO-003, 006; F-EVT-015, 016; F-PROF-005 |
| 5 | Past Events | F-PUB-005, 011; F-SEO-001, 002; F-EVT-016; F-NFR-012 |
| 6 | Community | F-PUB-006, 010, 012; F-SEO-001, 002 |
| 7 | Stories | F-PUB-007, 008, 012; F-SEO-001, 002 |
| 8 | Contact | F-CON-001, 002 |
| 9 | Privacy Policy | F-LEG-001; F-SEO-001 |
| 10 | Terms of Use | F-LEG-001; F-SEO-001 |
| 11 | Refund & Cancellation Policy | F-LEG-001; F-PAY-008; F-SEO-001 |
| 12 | 404 | F-PUB-013 |
| 13 | Login | F-AUTH-002, 003, 005, 006 |
| 14 | Create Account | F-AUTH-001, 005, 006, 008, 010; F-LEG-002 |
| 15 | OAuth Callback | F-AUTH-005, 006 |
| 16 | Reset Password | F-AUTH-004 |
| 17 | First Login (Welcome) | F-PROF-001, 002; F-REG-010 |
| 18 | Registration: Paid | F-REG-001, 003, 004, 008, 011; F-PAY-001, 002, 003, 006, 010; F-PROF-002; F-AUTH-006; F-ANA-001; F-LEG-002 |
| 19 | Registration: Free | F-REG-001, 002, 008, 011; F-PROF-002; F-AUTH-006 |
| 20 | Registration: Waitlist | F-REG-001, 005, 006; F-NOTI-005; F-AUTH-006 |
| 21 | Registration: Success | F-REG-002, 004; F-PLY-005; F-COMM-001 |
| 22 | Player: Dashboard | F-PLY-001, 003, 004; F-RATE-001, 005; F-PROF-005; F-EVT-003 |
| 23 | Player: My Events | F-PLY-002, 005; F-REG-006, 007; F-PAY-008, 010; F-EVT-003 |
| 24 | Event Room: Before check-in | F-EVT-003, 004, 013, 014 |
| 25 | Event Room: Check-in open | F-EVT-003, 004, 013, 014 |
| 26 | Event Room: Pairing pending | F-EVT-003, 008, 013, 014; F-NOTI-004 |
| 27 | Event Room: Live round | F-EVT-003, 008, 009, 010, 013, 014; F-PROF-005; F-ANA-001 |
| 28 | Event Room: Between rounds | F-EVT-003, 011, 013, 014, 015 |
| 29 | Event Room: Complete | F-EVT-003, 012, 013, 014, 015; F-RATE-003, 007 |
| 30 | Player: Ratings | F-RATE-001, 003, 005, 006, 007 |
| 31 | Player: Profile | F-PROF-003, 004; F-RATE-008; F-NFR-005 |
| 32 | Admin: Dashboard | F-ADEV-001; F-PAY-009; F-AADM-009; F-ANA-002 |
| 33 | Admin: Website CMS | F-ACMS-001, 002, 003, 004 |
| 34 | Admin: Media | F-ACMS-005, 006, 007, 008 |
| 35 | Admin: Stories | F-ACMS-009; F-SEO-005, 006 |
| 36 | Admin: Testimonials | F-ACMS-010 |
| 37 | Admin: Events | F-ADEV-002; F-EVT-001, 002 |
| 38 | Event Builder 1: Basics | F-ADEV-003, 004, 012, 013, 020; F-SEO-006 |
| 39 | Event Builder 2: Experience | F-ADEV-003, 005, 020 |
| 40 | Event Builder 3: Registration | F-ADEV-003, 006, 020; F-REG-009, 010; F-LEG-003 |
| 41 | Event Builder 4: Payment | F-ADEV-003, 007, 020; F-PAY-008; F-REG-009 |
| 42 | Event Builder 5: Game system | F-ADEV-003, 008, 020; F-PAIR-004, 010; F-RATE-006 |
| 43 | Event Builder 6: Media | F-ADEV-003, 009; F-ACMS-006 |
| 44 | Event Builder 7: Communications | F-ADEV-003, 010; F-COMM-002 |
| 45 | Event Builder 8: Review | F-ADEV-003, 011; F-EVT-001; F-SEO-005 |
| 46 | Event Control: Overview | F-ADEV-014, 015; F-EVT-001, 006, 007; F-PAIR-003 |
| 47 | Event Control: Registrations | F-ADEV-016; F-EVT-007; F-REG-010; F-PAIR-009 |
| 48 | Event Control: Check-in | F-EVT-005, 006, 007 |
| 49 | Event Control: Pairings & rounds | F-PAIR-001, 002, 005, 006, 007, 008, 009; F-EVT-010; F-RATE-002, 004; F-NOTI-004 |
| 50 | Event Control: Payments | F-PAY-005, 007, 009 |
| 51 | Event Control: Messages | F-COMM-002, 003, 004, 005, 006, 007, 008 |
| 52 | Event Control: Gallery & recap | F-ADEV-017; F-EVT-016; F-ACMS-006 |
| 53 | Event Control: Audit | F-ADEV-018; F-AADM-007, 008 |
| 54 | Admin: Players | F-AADM-001, 002; F-AUTH-007; F-EVT-017 |
| 55 | Admin: Payments | F-AADM-004; F-PAY-005, 007, 009 |
| 56 | Admin: Settings | F-AADM-005, 006; F-AUTH-007; F-COMM-006; F-CON-002 |
| 57 | Design System | F-NFR-014 |
| 58 | UI States | F-NFR-011, 014 |

**Check:** 58 rows, no screen unmapped.

## Appendix B. MVP features with no screen or only cross-cutting scope

Every MVP feature either lists screens in section 2 or is listed here as explicit "no UI" or cross-cutting.

| Feature | Reason |
|---------|--------|
| F-AUTH-003 Session refresh | no UI (token handling) |
| F-AUTH-008 First-account setup | no UI (side effects of first sign-in) |
| F-REG-011 Idempotent registration | no UI (API behaviour) |
| F-PAY-004 Webhook reconciliation | no UI (inbound integration) |
| F-AADM-007 Audit log write | no UI (read side is screen 53, F-AADM-008) |
| F-NFR-001 Accessibility | cross-cutting, all screens |
| F-NFR-002 Mobile-first responsive | cross-cutting, all screens |
| F-NFR-004 Security controls | cross-cutting |
| F-NFR-007 Locale, time and currency | cross-cutting |
| F-NFR-009 API envelope and error codes | cross-cutting; surfaces as the error states on screen 58 |
| F-NFR-011 Poor-network behaviour | cross-cutting; shown on screen 58 |

Features marked "none" in the Screens column (F-PUB-008, F-ADEV-019, F-AADM-003, F-COMM-009, F-NOTI-001, F-CON-003, F-LEG-004) are not MVP and need design before they can be built. They are the places where the 58-screen design has a gap.

## Appendix C. How to use this file later

1. **Finish the backend by priority.** Take MVP features first, then Launch, then Later. For each feature use the "Backend needs" and "Legacy status" columns: `none` means build, `partial` means change what exists, `exists` means keep and harden. Tick a feature off only when the legacy status is replaced by the new backend behaviour.
2. **Derive the API contract from the frontend.** Do not design endpoints in the abstract. The frontend plan builds a typed `PgApi` interface and a mock adapter first. The backend contract is whatever that interface and its mock fixtures need, mapped back to feature IDs here. Resolve differences against the reference BACKEND-CONTRACT and the stable error codes in F-NFR-009.
3. **Trace the frontend plan.** FEAT-001 and the frontend plan tasks should cite feature IDs from this file. Appendix A tells you which features each screen exercises, so a screen task can be checked for completeness.
4. **Close open questions before the affected feature.** Section 7 lists which feature each question blocks. MVP-blocking questions are OQ-01, 03, 05, 08, 09 and 18 (OQ-06, hosting, was resolved in version 2).
5. **Revise, don't fork.** When a decision is made, update this file (bump the version) rather than recording it elsewhere. Features that gain a screen or a decision should have their Notes column cleared.
6. **Validate before use as a requirement.** This file is `draft`. FEAT-001 will be a full requirements document with acceptance criteria; this inventory does not replace it.
