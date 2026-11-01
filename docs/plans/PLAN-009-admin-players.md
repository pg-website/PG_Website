---
id: PLAN-009
type: plan
feature_id: FEAT-001
architecture_id: ARCH-001
version: 1
status: ready
date: 2026-11-01
---

# PLAN-009: Admin Players (screen 54, `/admin/players`)

Covers FEAT-000 F-AADM-001 (players search and record), F-AADM-002 (role management), F-AUTH-007 (step-up), F-EVT-017 (attendance context). Contract G01 to G03 (ARCH-001-backend-contract section 3.8). Maps to TASK-089 in `docs/plans/FEAT-001/TASKS-P6-P8.md`.

Execution rules inherited from PLAN-008 (owner memory): backend first, no new mocks, extend the existing Django app, tests and security review after the main page is built, agents run typecheck and lint only. Do not touch the owner's other uncommitted files.

## 1. Requirements recap

- Search by name, email or phone (`q`, max 100).
- List columns in the design: Player (name, city / "Newcomer"), PG rating (e.g. "1286 Rapid" or "New"), Events, Attendance %.
- Record panel: email, city, next event, rating per pool with RD ("1286 . RD 71"), attendance "8/9", event history, permitted private fields (phone, birthday, area, chess.com, FIDE).
- Role change `player` or `admin`: admin only, step-up, Idempotency-Key, audited, never self, never the last active admin, initial admins seeded (OQ-17).
- Private fields only in the record, never in list rows, limited by role. Desktop master-detail, mobile list then pushed detail.
- Required states (DoD-S): no results, no selection, loading, error, permission-limited.
- The requirements specify **no** ban, suspend, rating adjustment or other actions. Only search, record, and role change.

Status: ready; all owner decisions are recorded in section 6. Out of scope: ban, suspend, rating overrides, filters and sort.

## 2. What exists vs gaps (verified in code)

### Backend: G01 to G03 implemented
- `backend/adminapi/players_service.py`: `list_players` (q on name/email/phone icontains, `attended` annotation, newest first, paginated), `get_player` (row, private fields, `history` up to 100, `ratings`, `canChangeRole`, `version`), `change_role` (step-up before change, row locking of all admins, self-change block, last-admin guard, suspended cannot become admin, no-op returns current role, audit `player.role_change` in the same transaction).
- `views_ops.py` (`PlayersView`, `PlayerDetailView`, `PlayerRoleView` with `run_idempotent(required=True)`) and `urls.py` lines 60-62, all behind `AdminView` (default deny).
- `ENDPOINTS-IMPLEMENTED.md` rows G01 to G03 "Matches" (G03 deviates only in step-up header, D1).

Backend gaps against the design and contract:
- B-G1. **List row lacks rating and attendance %.** Design columns "PG rating" and "Attendance" are not in `AdminPlayerRowDto` (id, name, email, city, role, status, eventsAttended, joinedAt). Needs a contract decision (OQ-1) then additive fields.
- B-G2. **Record lacks RD, attendance denominator, next event.** `ratings[]` has pool, rating, games, provisional; no `rd` (model `Rating.rd` exists). Attendance is only `attended` count, no "registered" total (history has per-row `attended`, capped at 100). No next-event field.
- B-G3. **Search is `icontains` over three columns with no index support** (`LIKE %x%`); fine for launch volumes, flagged for scale. Phone search does not normalise formatting (spaces, +91). `q` is not escaped for LIKE wildcards by Django (Django escapes them in `icontains`, so OK) but PII in the query string lands in access logs (security note).
- B-G4. **Row exposes `email` and `status` to every admin**: acceptable (single role at launch) but the "limited by role" language is unimplemented; `VISIBLE_FIELDS` is a constant.
- B-G5. **`version` is derived from audit row count** (not an optimistic lock on the user row). G03 does not take `version`, so it is informational only. Confirm intent (OQ-5).
- B-G6. Role change ends the target's sessions via ROLE_CHANGED (documented in the service docstring); verify with a test.
- B-G7. No backend tests found under `backend/` for players (search for `test*.py` returned none). Confirm where tests live before TASK-P09.
- B-G8. Reads of private fields (G02) are **not audited**. Decide whether record views of PII should be logged (OQ-6).
- B-G9. No filter on role or status on G01 (not required by the design; see OQ-2).

### Frontend: contract client done, UI missing
- Done: `web/src/lib/api/types/admin/players.ts` (query, row, record, `changeRoleSchema`, result), `pg-admin-api.ts` `PgAdminPlayersApi` (`listPlayers`, `getPlayer`, `changeRole`), `adapters/real-admin.ts` lines 365-373 (G03 sent with step-up and idempotency key), `response-schemas.ts` `adminPlayersResponses`, query options `adminPlayersQuery` / player detail in `lib/query/query-options/admin.ts` lines 222-235, step-up infrastructure (`lib/api/browser/step-up-prompt.ts` `withStepUpToken`, `components/layout/admin/StepUpPrompt.tsx`), `ConfirmAction`, `ResponsiveTable`, `FilterBar`, `SplitWorkspace`, and a close pattern to copy: `features/admin/payments/{PaymentsAdminPage,RefundAction,payments-columns}`.
- Missing: `web/src/app/(admin)/admin/players/page.tsx` is still `<PlaceholderPage routeId="admin-players" />`; no `features/admin/players/*` (note TASKS-P6-P8 says `features/players-admin`, but implemented admin screens live in `features/admin/*`; follow the latter, OQ-7); no list/record/role-change components; no mutation hook or cache invalidation for the role change; `admin-players` in `adminNav` and `routes` to be confirmed.
- Open check: ENDPOINTS-IMPLEMENTED F1 (web must send `X-Step-Up-Token`): `X-Step-Up-Token` is referenced in `client.ts`, `requester.ts`, `real-admin.ts`, `step-up.ts`, so likely done, verify in T-02.

## 3. Tasks (dependency order)

Status legend: [ ] pending. Owner agents: backend-engineer (BE), frontend-engineer (FE), test-engineer (TE), security-reviewer (SR).

All decisions are resolved (section 6), so there is no decisions task; the former TASK-901 was removed. Task IDs 902 onward are kept stable.

### Phase B: Backend

#### TASK-902 Add rating summary and attendance to the list row (G01)
- **Owner:** BE | **Risk:** medium | **Deps:** none | **Status:** [ ]
- **Contract:** update ARCH-001-backend-contract section 3.8 (G01) and `pg-chess-backend.openapi.yaml` (`AdminPlayerRowDto`, lines ~3095-3139) in the same change, before code.
- **Goal:** Add additive fields to `_row` / `list_players`: `rating: {pool, rating, provisional} | null` (primary pool; "New" when none or provisional) and `attendancePct` (or `registeredCount` so the client derives it).
- **Files:** `backend/adminapi/players_service.py`, OpenAPI.
- **Notes:** Use annotations/prefetch, no per-row queries (N+1 guard). Attendance denominator counts confirmed registrations of past events only. Page size cap unchanged. Email/phone still not required in rows beyond current contract.
- **Acceptance:** [ ] constant query count for a page of 100 rows (assertNumQueries) [ ] newcomer with 0 events returns null rating and no divide-by-zero [ ] existing fields unchanged.
- **Tests:** query-count test, newcomer, multi-pool.

#### TASK-903 Enrich the record (G02): RD, attendance total, next event
- **Owner:** BE | **Risk:** low | **Deps:** none (parallel with 902; same file, coordinate merges) | **Status:** [ ]
- **Contract:** update contract section 3.8 (G02) and OpenAPI `AdminPlayerDto` first.
- **Goal:** Add `rd` to `ratings[]`, `registered` (denominator) and `nextEvent {id, slug, title, startsAt} | null` to the record.
- **Files:** `players_service.py`, OpenAPI.
- **Acceptance:** [ ] `rd` equals `Rating.rd` [ ] `nextEvent` is the soonest future confirmed registration, null otherwise [ ] history cap of 100 unchanged and the cap is stated in the response (`historyTruncated` if more exist, optional).
- **Tests:** record with future/past/cancelled registrations.

#### TASK-904 Harden search (G01)
- **Owner:** BE | **Risk:** low | **Deps:** none | **Status:** [ ]
- **Goal:** Phone numbers are stored normalised (decision OQ-8), so normalise the query with the same function used when storing (locate it in `accounts`; no `normalise_phone` helper was found by name, so find the validation/save path and reuse it, do not write a second normaliser). Match phone on the normalised form only when `q` looks like a phone (digits, spaces, dashes, parentheses, leading +); keep name and email `icontains` on the raw trimmed `q`. Ignore empty/whitespace `q`, keep the 100 limit; confirm `page` / `pageSize` bounds (`AdminPagePagination` max 100).
- **Acceptance:** [ ] "98765 43210", "+91 98765-43210" and "9876543210" all find the same player [ ] a name query containing digits still matches names [ ] q of 101 chars returns `VALIDATION_FAILED` [ ] request logging does not record `q` (verify log config).
- **Tests:** unit tests for the search matrix.

#### TASK-913 Audit admin reads of a player's private record (G02)
- **Owner:** BE | **Risk:** medium | **Deps:** none | **Status:** [ ]
- **Goal:** Decision OQ-6: write an audit entry when an admin views G02 (action e.g. `player.view_private`, object `player`, actor, object id; no PII values in the payload; list rows G01 are not audited).
- **Files:** `backend/adminapi/players_service.py` (`get_player`), `audit` app action registry if one exists.
- **Notes:** G02 is a GET, so the write must not break caching or idempotency semantics: set `Cache-Control: no-store`. Decide throttling in implementation: one entry per admin+player per short window (e.g. 5 minutes) to avoid log flooding from refetches; document the window. If the audit write fails, fail closed (do not return private fields) consistent with the existing "audit unavailable" posture.
- **Acceptance:** [ ] a G02 call writes one audit row with actor and player id [ ] repeated refetch inside the window does not add rows [ ] no phone/birthday/etc. in the audit payload [ ] failure to write audit returns an error, not the record.
- **Tests:** covered in TASK-910.

### Phase C: Frontend (can start in parallel with Phase B against the existing G01 to G03 shape)

#### TASK-905 Route, columns and labels
- **Owner:** FE | **Risk:** low | **Deps:** none | **Status:** [ ]
- **Goal:** Replace placeholder in `web/src/app/(admin)/admin/players/page.tsx` with `PlayersAdminPage`; create `features/admin/players/{players-columns.tsx,players-labels.ts}` (role and status labels, rating text "1286 Rapid"/"New", attendance %). Keep `routeMetadata('admin-players')`.
- **Acceptance:** [ ] route renders inside AdminShell [ ] columns Player (name + city or "Newcomer"), PG rating, Events, Attendance per design; fields not yet in the API show a neutral placeholder, never fake data [ ] no email or phone in list rows [ ] typecheck and lint pass.

#### TASK-906 List with search (G01)
- **Owner:** FE | **Risk:** medium | **Deps:** 905 | **Status:** [ ]
- **Goal:** Search input (debounced via `useDeferredValue`, trimmed, max 100 chars, empty means no `q`), `ResponsiveTable`, `TablePagination`, `keepPreviousData`, query key via `qk.admin.players`, selection stored in URL (`?player=<id>`).
- **Acceptance:** [ ] states: loading skeleton, empty ("no players match"), error with retry, results [ ] search stays responsive with 1,000 rows (rows `cv-auto`) [ ] selection survives paging and reload [ ] no `dangerouslySetInnerHTML`; names rendered as text.

#### TASK-907 Player record panel (G02) with master-detail layout
- **Owner:** FE | **Risk:** medium | **Deps:** 906 | **Status:** [ ]
- **Goal:** `PlayerRecord`: identity (name, email, city, role, status, joined), ratings per pool with provisional label (and RD when TASK-903 lands), attendance, event history table (title, date, status, attended; link to `/admin/events/...` when route exists), private fields section driven by `visibleFields` (hidden vs "not provided" distinguished as the type comment requires). Desktop `SplitWorkspace`; mobile list then pushed detail with back button and focus management.
- **Acceptance:** [ ] states: no selection, loading, error, 404 (player gone), permission-limited (field not in `visibleFields` shows "Not visible to your role") [ ] history 0 rows empty state [ ] phone/birthday formatted, not logged anywhere (no console/analytics) [ ] mobile back works with browser back [ ] accessible landmarks and headings.

#### TASK-908 Role change action (G03)
- **Owner:** FE | **Risk:** high | **Deps:** 907 | **Status:** [ ]
- **Goal:** `ChangeRoleAction` modeled on `RefundAction`: select/segmented control for `player` or `admin`, `ConfirmAction` (new Idempotency-Key per intent) wrapping `withStepUpToken` then `api.admin.players.changeRole`. Disabled with the server's reason when `canChangeRole.allowed` is false. On success invalidate list and record queries and show confirmation; on `STEP_UP_REQUIRED`, `ROLE_CHANGED`, validation errors show safe messages.
- **Acceptance:** [ ] button disabled with reason for self and last admin [ ] confirm dialog names the player and the new role, warns that the player is signed out of existing sessions [ ] double-click sends one request (key reuse) [ ] role never changes optimistically; UI reflects server result after refetch [ ] request body contains only `{role}`.

#### TASK-909 Nav entry and cross-links
- **Owner:** FE | **Risk:** low | **Deps:** 905 | **Status:** [ ]
- **Goal:** Confirm `adminNav` Players item matches design order (Overview, CMS, Media, Stories, Testimonials, Events, Players, Payments, Settings); optional link from event registrations rows and payments ledger to a player record.
- **Acceptance:** [ ] active state on `/admin/players` [ ] cross-links only if they carry a public-safe id.

### Phase D: Verification (deferred per owner rule, run after pages are built)

#### TASK-910 Backend tests for G01 to G03
- **Owner:** TE | **Risk:** medium | **Deps:** 902, 903, 904, 913 | **Status:** [ ]
- **Goal:** Establish (or locate) the Django test module for adminapi and cover: unauthenticated 401, non-admin player 403, admin 200 for G01/G02; G03 without step-up is `STEP_UP_REQUIRED`; reused step-up grant rejected; without Idempotency-Key rejected; replay returns the same result; self-change blocked; last-admin demotion blocked; concurrent demotions of two admins leave at least one (transactional test); suspended user cannot be promoted; audit row written with before/after and actor; target's session invalid after role change; G02 writes the private-view audit row (once per window, no PII in payload); phone search normalisation matrix; malformed UUID returns 404; unknown field in body returns `VALIDATION_FAILED`.
- **Acceptance:** [ ] all above pass in CI [ ] no real secrets or PII in fixtures.

#### TASK-911 Frontend component and e2e tests
- **Owner:** TE | **Risk:** medium | **Deps:** 906 to 908 | **Status:** [ ]
- **Goal:** Component tests for list states, search, record states, role-change flow (disabled reasons, step-up prompt, success, failure); extend `admin.test.ts` players block if fields change; Playwright: search then open record then change role with step-up (against Django dev backend, no new mock per owner rule).
- **Acceptance:** [ ] 1,000-row list without long tasks [ ] axe checks pass on list and record [ ] mobile viewport flow passes.

#### TASK-912 Security review
- **Owner:** SR | **Risk:** high | **Deps:** 910 | **Status:** [ ]
- **Goal:** Review authorization (AdminView default deny, no IDOR since admin-only), PII exposure (list rows vs record), step-up and idempotency on G03, last-admin race, audit completeness, log redaction of `q`, response caching (`Cache-Control: no-store` on G01/G02), CSRF and CORS settings for PUT.
- **Acceptance:** [ ] no high findings open [ ] private-view audit (TASK-913) verified complete and free of PII.

## 4. Dependency summary

```
902, 903, 904, 913 (backend, independent of each other)
905 -> 906 -> 907 -> 908
905 -> 909
902,903,904,913 -> 910
906,907,908 -> 911
910 -> 912
```

## 5. Parallelisable work

- 905 to 908 (frontend) can start immediately against the existing G01 to G03 shape; fields from 902/903 are additive and can be wired in once merged.
- 902, 903, 904 and 913 are all independent (902, 903, 904 and 913 touch `players_service.py`, so coordinate merges).
- 910 and 911 can run in parallel after their dependencies.
- Task count: 12 (BE 4, FE 5, TE 2, SR 1).

## 6. Decisions (resolved by owner, 2026-11-01) and remaining items

| ID | Decision | Effect on plan |
|---|---|---|
| OQ-1 | Add rating and attendance fields to list and record. | TASK-902, TASK-903. |
| OQ-2 | Filters and sort out of scope; search only. | None. |
| OQ-3 | Add RD, registered total and next event to G02. | TASK-903. |
| OQ-4 | List rating uses the player's highest-games pool; "New" when none or provisional. | TASK-902. |
| OQ-5 | `version` in G02 stays informational; G03 does not take it (last-admin row lock covers races). | None. |
| OQ-6 | Audit admin views of a player's private details. | New TASK-913; tests in 910; review in 912. |
| OQ-7 | Frontend lives in `web/src/features/admin/players`. The `features/players-admin` path in TASK-089 (TASKS-P6-P8) is superseded by this plan. | TASK-905 to 908. |
| OQ-8 | Phone numbers are stored normalised; search normalises the query the same way. | TASK-904. |
| OQ-9 | Ban, suspend and rating overrides are OUT OF SCOPE. `status` stays display-only. | No tasks. |
| OQ-10 | Admins are seeded, not self-granted; verifying a seed path exists is a go-live checklist item outside this plan. | None. |
| OQ-11 | Backend test location is located or created in TASK-910 (none found so far). | TASK-910. |

Remaining blockers: none. Implementation notes only: TASK-904 must locate the existing phone normaliser; TASK-910 must locate or create the adminapi test module.

## 7. Security considerations (summary)

- Authorization: every endpoint is an `AdminView`; role change additionally requires a single-use step-up grant (5 min) and an Idempotency-Key.
- Integrity: self-change and last-admin blocked server-side under row locks; client disabled state is advisory only.
- Audit: `player.role_change` with before/after and actor exists; admin reads of the private record are audited (TASK-913, no PII in the payload).
- Privacy: email/phone/private fields never in list payloads beyond contract; no PII in URLs except `q` (redact in logs); responses `no-store`; role-limited fields communicated via `visibleFields`.
- Sessions: role change ends target's sessions (ROLE_CHANGED); test it.
- Frontend: render all strings as text, validate responses with the existing zod schemas, never optimistic-update roles.
