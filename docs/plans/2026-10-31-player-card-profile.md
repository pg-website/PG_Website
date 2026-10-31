---
id: PLAN-007
type: plan
feature_id: FEAT-001
architecture_id: ARCH-001
version: 1
status: draft
date: 2026-10-31
---

# PLAN-007: Shared PlayerCard and public player profile

**Feature:** One shared `PlayerCard` component. Clicking a player wherever one appears opens that player's public profile page (new).
**Execution rules (owner memory):** backend first, then the profile page, then component wiring. Extend the existing Django app, local Postgres, no new mocks. Tests and security reviews are deferred (Phase 5, listed, not scheduled). Agents run typecheck, lint and dependency checks only, never a full build. Do not touch the owner's other uncommitted files.

## 0. Requirements/ARCH gap (to confirm)

No approved FEAT or ARCH covers a public player profile. This plan reuses FEAT-001 / ARCH-001 ids as placeholders. It deliberately reverses a documented decision (identity has no id/handle: NCT-L1/L2, FEAT-000 OQ-26), so it needs explicit owner approval before TASK-001 starts.

| OQ | Decision needed | Planner recommendation (assumed below) |
|----|-----------------|----------------------------------------|
| OQ-1 | Opaque public id | New random `public_slug` on `User` (12 chars, base32 lowercase, unique, nullable, never the UUID pk, no email/handle derivation). Exposed in identity JSON as `publicId`. |
| OQ-2 | When is it null | Null when `show_display_name` is false (hidden profile). Also null for minors without guardian consent (F-15), BUT the backend has no guardian/minor data model (grep for guardian/F-15 in backend: 0 hits; only `birthday` exists). Need a rule: derive "minor" from `birthday` < 18 and treat as no consent until a consent field exists. Confirm. |
| OQ-3 | Profile contents | Only: displayName, initials, rating (if `show_ratings`, per pool, all three pools), cityChapter (if `show_city_chapter`), member-since (year), event count (count only). No email/phone/birthday/id. chess.com handle only if `show_chess_com_handle` (default false); recommend excluding in v1. Confirm. |
| OQ-4 | Route and access | `GET /api/players/{publicId}` (no auth, rate-limited like other public reads); page at `/players/[publicId]` in the `(public)` group, SSR, `noindex`. Confirm public vs login-only. |
| OQ-5 | Revocation | Toggling `show_display_name` off must make the profile 404 and links disappear. Stale links in stored snapshots (`event.winner` JSON written by `control_service.py:670`, `event_service.py:458`, and `seed_data.py`) just 404 safely. Confirm that is acceptable. Rotate slug on re-show? Recommend no. |
| OQ-6 | "My PG" meaning | See section 1. |
| OQ-7 | Suspended accounts | Recommend 404 for `status != active`. |
| OQ-8 | Admin PlayerSeat | Recommend out of scope (admin already has player admin). |

## 1. Verified findings

- No public profile route: only `web/src/app/(app)/app/profile/page.tsx` (own settings). Confirmed by route glob.
- `web/src/lib/api/types/identity.ts` `publicIdentitySchema` has no id (confirmed). Used by `standings.ts:11`, `event-room.ts:82`, `my-events.ts:60,71,81`, `event.ts:107` (winner, nullable).
- Backend single choke point: `backend/registrations/dto.py` `identity_dto()` and `IdentityBook.get()` (including the missing-user fallback at line 68, which must stay unlinked). Callers: `room.py:208,236,297`, `selectors.py:57,82,110`. Adding `publicId` here propagates to every consumer. `IdentityBook` loads whole `User` rows, so no extra query.
- Visibility flags in `backend/accounts/models.py:40-43`. Rating data: `current_ratings()` (PoolRating wins over Rating summary).
- **"My PG" match:** `/app/rating` and `/app/profile` show only the signed-in player's OWN data, so a card linking to one's own public profile is of little value (useful at most as a "view my public profile" preview link on `/app/profile`). The better match is the dashboard `/app` (`features/player/dashboard/People.tsx` opponents list, next-up opponent) and the event room `/app/events/[id]` (`StandingsList.tsx`, game opponents in `event-room.ts:82` and `my-events.ts:60,71`). Plan wires those, plus an optional own-profile preview link in `ProfilePage.tsx`.
- Player rows today: `components/public/event/EventStandings.tsx` (Server Component, plain text in ResponsiveTable cell), `features/player/event-room/StandingsList.tsx` (Avatar, name, "(you)", score), `features/player/dashboard/People.tsx` (Avatar, name, city), `components/public/events/PlayResults.tsx` (winner, verify). Admin `PlayerSeat.tsx` out of scope (OQ-8).

## 2. Design resolutions

1. **Id:** `User.public_slug` (new nullable unique CharField(16), generated with `secrets` on first need, backfilled by data migration for existing users). Not derived from pk/email.
2. **Visibility gate:** one helper `public_id_for(user)` in `dto.py`; returns slug only if `show_display_name` and not (minor without consent) and `status == 'active'`; else `None`. Used by both `identity_dto` and the profile view, so list and profile cannot disagree.
3. **Identity schema:** add `publicId: z.string().regex(/^[a-z2-7]{12,16}$/).nullable().default(null)`. Default keeps existing seeds/snapshots valid, no mock changes.
4. **Profile endpoint:** `GET /api/players/{publicId}` returns `PublicProfile` = identity fields + `ratings[]` (per pool, only if `show_ratings`) + `memberSince` (year) + `eventsPlayed` (int). 404 (same body) for unknown, hidden, minor-no-consent or suspended, so existence is not leaked.
5. **PlayerCard props:** `identity: PublicIdentity`, `variant: 'row' | 'compact'`, `isYou?: boolean`, `trailing?: ReactNode` (score etc.), `showRating?`, `showCity?`. States: linked (`publicId` set: wraps in `next/link` to `/players/{publicId}`, focus ring, accessible name "View profile of X"), unlinked (`publicId` null: plain, no link, no hover affordance), you (adds "(you)" badge; still linked), loading skeleton. Must remain Server-Component-safe (no hooks, no `'use client'`).
6. **Routes:** add `playerProfile` to `web/src/lib/routes.ts` with a typed builder.

## 3. Tasks

| ID | Title | Owner | Size | Depends On | Status |
|----|-------|-------|------|-----------|--------|
| TASK-001 | Owner confirms OQ-1..OQ-8 (gate) | planner/owner | S | - | todo |
| TASK-002 | `User.public_slug` field, migration, backfill | backend-engineer | M | TASK-001 | done |
| TASK-003 | `public_id_for()` and `publicId` in `identity_dto`/`IdentityBook` | backend-engineer | S | TASK-002 | done |
| TASK-004 | Public profile service/selector + DTO | backend-engineer | M | TASK-003 | done |
| TASK-005 | `GET /api/players/<publicId>` view, URL, throttle | backend-engineer | S | TASK-004 | done |
| TASK-006 | Update seed data and OpenAPI/contract/privacy docs | backend-engineer | S | TASK-003, TASK-005 | done |
| TASK-007 | Zod: `publicId` on identity; `publicProfileSchema` | frontend-engineer | S | TASK-005 | done |
| TASK-008 | API client: `getPlayerProfile` in pg-api, real adapter, response-schemas, query key/options | frontend-engineer | M | TASK-007 | done |
| TASK-009 | Route constant + `/players/[publicId]` page (loading/not-found/error) | frontend-engineer | M | TASK-008 | done |
| TASK-010 | `PlayerCard` shared component | frontend-engineer | M | TASK-007 | done |
| TASK-011 | Adopt in `EventStandings.tsx` (public) | frontend-engineer | S | TASK-009, TASK-010 | done |
| TASK-012 | Adopt in `StandingsList.tsx` (event room) | frontend-engineer | S | TASK-009, TASK-010 | done |
| TASK-013 | Adopt in dashboard `People.tsx`, opponents, winner (`PlayResults.tsx`); optional preview link in `ProfilePage.tsx` | frontend-engineer | M | TASK-009, TASK-010 | done |
| TASK-014 | Deferred: tests (Phase 5) | backend/frontend | M | all above | deferred |
| TASK-015 | Deferred: security/privacy review | reviewer | M | all above | deferred |

Sizes: S under 1 hour, M 1-3 hours.

## 4. Task details

### TASK-001 - Gate
Goal: owner answers section 0. Acceptance: each OQ marked decided; plan status set `ready`. Risk: reverses NCT-L1/L2; do not skip.

### TASK-002 - `public_slug`
- Files: `backend/accounts/models.py` (field near line 51), new migration in `backend/accounts/migrations/` (schema + RunPython backfill, unique after backfill), user-creation paths (`UserManager.create_user` and OAuth creation in `accounts/views.py`/services) to assign a slug on create (or lazily via `ensure_public_slug`).
- Notes: use `secrets.token_bytes` -> base32 lowercase, retry on collision. Never expose via any admin/private DTO that would be confused with the pk.
- Acceptance: migration applies on local Postgres and is reversible; every existing and new user has a unique slug; slug is unrelated to pk/email.
- Risk: medium (migration on users table).

### TASK-003 - `publicId` in identity
- Files: `backend/registrations/dto.py` (`identity_dto`, `IdentityBook.get` fallback returns `publicId: None`, new `public_id_for`).
- Acceptance: hidden-name user -> `publicId` null; visible -> slug; missing-user fallback null; no extra queries per row (IdentityBook query count unchanged); all callers (`room.py`, `selectors.py`) emit the key without edits. Update the module docstring to note the new, deliberate field.
- Risk: medium (privacy invariant).

### TASK-004 - Profile selector
- Files: new `backend/registrations/profile.py` (or `accounts/public_profile.py`).
- Notes: lookup by slug + `public_id_for` gate; ratings for all three pools via `current_ratings` and `show_ratings`; `memberSince` from `created_at.year`; `eventsPlayed` = count of confirmed registrations of completed events (reuse existing registration status rules in `rules.py`).
- Acceptance: returns None for any non-visible case; never includes email/phone/birthday/pk/handle; fields follow flags.

### TASK-005 - Endpoint
- Files: new view in `backend/registrations/views*.py` (or `accounts`), route in the matching `urls.py` mounted at `/api/players/<slug>`, `pgchess/urls.py` if a new mount is needed; use the project's response envelope (`core/responses`) and existing public-read throttle.
- Acceptance: 200 with envelope for visible player without auth; identical 404 for unknown/hidden/suspended/minor; slug validated by regex before lookup.

### TASK-006 - Seed and docs
- Files: `backend/content/seed_data.py` (standings identities at ~273-279 may omit `publicId`, default null; add one only if a real user exists), `docs/api/pg-chess-backend.openapi.yaml` (new path, `publicId` on identity schema), `ENDPOINTS-IMPLEMENTED.md`, contract note 3.4 and the NCT-L1/L2 / OQ-26 text updated to "no id except the opaque `publicId`", `identity.ts` header comment (done in TASK-007).
- Acceptance: docs state the new rule and the null conditions.

### TASK-007 - Zod
- Files: `web/src/lib/api/types/identity.ts` (add `publicId`, update header comment), new `web/src/lib/api/types/player-profile.ts`, export where types are barrelled, `identity` type-level "no secrets" checks if any.
- Acceptance: existing schemas (`standings`, `event-room`, `my-events`, `event`) still parse payloads lacking `publicId`; typecheck clean.

### TASK-008 - Client
- Files: `web/src/lib/api/pg-api.ts` (interface), the real adapter in `web/src/lib/api/adapters/real.ts`, `web/src/lib/api/types/response-schemas.ts`, `web/src/lib/query/query-keys` (`qk.players.profile`), `web/src/lib/query/query-options/*`. No mock adapter additions (rule); if the mock adapter type requires the method, throw a clear "not available in mock" error rather than inventing data.
- Acceptance: response parsed through the registered schema; 404 surfaces as a typed not-found error.

### TASK-009 - Page
- Files: `web/src/lib/routes.ts`, `web/src/app/(public)/players/[publicId]/page.tsx`, `loading.tsx`, `not-found.tsx`; feature component `web/src/features/player/public-profile/PublicProfile.tsx`.
- Notes: SSR fetch, `generateMetadata` with `robots: noindex`, uses design-system Avatar/Card; shows rating per pool only when present; city only when present. Check `Frontend reference/screens` for a matching design before building.
- Acceptance: visible profile renders; unknown id shows not-found; no private fields rendered; reachable without login.

### TASK-010 - PlayerCard
- Files: `web/src/components/player/PlayerCard.tsx` (shared location; confirm folder convention in `components/`), reuses `components/ui/Avatar`.
- Acceptance: props/states per section 2.5; unlinked renders no anchor; linked has keyboard focus style and aria-label; works in a Server Component; no new dependencies.

### TASK-011..013 - Adoption
- `EventStandings.tsx`: replace the plain name text in the cell; keep columns and sort.
- `StandingsList.tsx`: replace Avatar+name+"(you)" with `PlayerCard isYou`; score via `trailing`.
- `People.tsx`, event-room/next-up opponents, `PlayResults.tsx` winner: same pattern. Check `ProfilePage.tsx` for an own-profile preview link only if the user's own `publicId` is available from `/auth/me` (it is not today; skip unless OQ-6 approves adding it).
- Acceptance: every listed surface links when `publicId` present and is plain when null; no layout regressions at mobile width; the owner's uncommitted edits to unrelated files are untouched.
- Risk: some of these files may have the owner's uncommitted edits; read before editing.

## 5. Deferred phase (not scheduled)
- TASK-014 tests: backend (hidden, minor, suspended, unknown slug all give identical 404; query-count of IdentityBook; slug uniqueness/backfill), frontend (schema back-compat parse, PlayerCard linked/unlinked/you, profile page states).
- TASK-015 security/privacy review: enumeration resistance, slug entropy, rate limiting, no PII leakage, cache headers, noindex, stale snapshot links.

## 6. Dependency summary and parallelism
Chain: 001 -> 002 -> 003 -> 004 -> 005 -> 007 -> 008 -> 009 -> 011/012/013.
Parallel: TASK-006 (docs) alongside 004/005; TASK-010 (PlayerCard) can start as soon as TASK-007 lands, in parallel with 008/009 (the card only needs the schema and a route builder); 011, 012, 013 are independent of each other.
Backend must be complete (through 005) before any frontend task, per the backend-first rule; TASK-007 may be drafted once the shape is fixed in TASK-001.

## 7. Blockers
- No approved requirement/architecture for reversing NCT-L1/L2 (TASK-001).
- No guardian/consent data model for F-15 minors (OQ-2).
- Owner has many uncommitted changes in `backend/` and `web/src/lib/api`; coordinate to avoid conflicts, particularly in `dto.py` consumers and `response-schemas.ts`.
