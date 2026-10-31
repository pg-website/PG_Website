---
id: PLAN-005
type: plan
feature_id: FEAT-001
architecture_id: ARCH-001
version: 1
status: ready
date: 2026-10-31
---

# PLAN-005: Admin Settings page (screen 56, route `admin-settings`)

**Feature:** Replace the `<PlaceholderPage>` at `web/src/app/(admin)/admin/settings/page.tsx` with a working settings admin: grouped sections, integration status (booleans only), versioned partial save. Covers PLAN-002 FE-24 / TASK-091, FR-46, AC-68.
**Execution rules (owner memory):** backend first, no new mocks, extend the existing Django app. Tests and security reviews are deferred until the main pages are built, so test items below are listed but not scheduled. Agents run typecheck and lint only. No full `next build`; the owner runs one build per batch. Do not touch the owner's other uncommitted files.

---

## 1. What already exists (verified)

### Backend (done, BE-10)
- `GET` and `PATCH /api/admin/settings` (G07/G08): `backend/adminapi/urls.py:66` -> `views_ops.SettingsView` -> `settings_service.read()/update()`. Listed "Matches" in `ENDPOINTS-IMPLEMENTED.md` (lines 138-139); present in `docs/api/pg-chess-backend.openapi.yaml:3251`.
- Server allow-list `FIELDS` with validators for 6 groups: brand, auth, ratings, payments (currency read-only), notifications (includes `contactDestinationEmail`), eventDefaults. Unknown group/field rejected with `VALIDATION_FAILED`. `version` required, `VERSION_CONFLICT` on mismatch, audit row `settings.update`, brand contact fields stored in `PublicSettings` with `site/updated` revalidation emitted for `footer` and `meta`.
- `integrations` returns booleans `{google, razorpay, email, whatsapp}`, derived from server config (never values). `whatsapp` is hard-coded `false`.
- Runtime read side `content/runtime_settings.py` is wired for: `ratings.provisionalGames`, `auth.signupOpen`, `payments.holdMinutes`, `notifications.emailEnabled/reminderHoursBefore/senderName/contactDestinationEmail`, `brand.siteName`.
- Per-event comms toggles (C15) are a separate surface (`getCommunications` in Control Room), not part of this page.

### Frontend (types and client done, UI missing)
- `web/src/lib/api/types/admin/settings.ts`: strict Zod schemas (`settingsSchema`, `settingsPatchSchema`, `SETTINGS_GROUPS`, `integrationHealthSchema`), secret-key guard, type-level no-secrets check. Matches the backend shape.
- `pg-admin-api.ts` `PgAdminSettingsApi` (`getSettings`, `updateSettings`), `real-admin.ts:397`, `response-schemas.ts` `adminSettingsResponses`, `qk.admin.settings()`, `adminSettingsQuery` in `query/query-options/admin.ts:243`.
- Nav item already in `adminNav.ts`; route registered in `routes.ts:153`.
- Design reference: `Frontend reference/screens/56-admin-settings.html` (left group nav, Brand & site form, Integrations list with badges).
- Patterns to follow: `features/admin/payments/PaymentsAdminPage.tsx` (page shell), `features/admin/media/CollectionDetail.tsx` (react-hook-form save, `VERSION_CONFLICT` handling, `copyFor`, toast), `ConfirmAction` for risky changes.
- No mock admin settings seed exists. Per the rules none is added; the page uses the real adapter only.

## 2. Gaps

| # | Gap | Resolution |
|---|-----|-----------|
| G1 | No settings UI at all | TASK-002..008 |
| G2 | No page-level wiring of `adminSettingsQuery` / mutation with invalidation | TASK-002, TASK-003 |
| G3 | Stored but not enforced settings: `auth.googleSignInEnabled`, `auth.adminSessionHours`, `ratings.ratingsEnabled`, `ratings.showRatingsByDefault`, `payments.defaultRefundWindowHours`, `eventDefaults.*` (not read by `runtime_settings`; builder defaults not confirmed) | TASK-001 audits; see OQ-1 |
| G4 | Design shows "Timezone" which is not in the contract | OQ-2; not built unless approved |
| G5 | `integrations.whatsapp` always `false`; desk WhatsApp link is `brand.deskContactHref` | Display only, no backend work |
| G6 | `siteName` is stored in `AdminSettings.values`; confirm it is surfaced publicly if the UI promises it | TASK-001 |

No new endpoints are required. Backend work is limited to a verification task (and a small fix only if TASK-001 finds a contract mismatch).

---

## 3. Tasks

| ID | Title | Owner | Size | Depends On | Status |
|----|-------|-------|------|-----------|--------|
| TASK-001 | Verify G07/G08 against the UI contract; document enforcement gaps | backend-engineer | S | - | done |
| TASK-002 | `useAdminSettings` query and `useSaveSettings` mutation hooks | frontend-engineer | S | TASK-001 | done |
| TASK-003 | `AdminSettingsPage` shell: group nav, loading/error states, wire route | frontend-engineer | M | TASK-002 | done |
| TASK-004 | `IntegrationStatus` panel (read-only booleans) | frontend-engineer | S | TASK-003 | done |
| TASK-005 | Brand & site and Notifications sections (incl. contact destination) | frontend-engineer | M | TASK-003 | done |
| TASK-006 | Authentication, Ratings and Payments sections | frontend-engineer | M | TASK-003 | done |
| TASK-007 | Event defaults section | frontend-engineer | S | TASK-003 | done |
| TASK-008 | Save flow: dirty diff patch, `version`, conflict and field-error handling | frontend-engineer | M | TASK-005 (shared form core) | done |

Sizes: S under 1 hour, M 1-3 hours.

---

## 4. Task details

### TASK-001 - Verify G07/G08 against the UI contract
- **Owner:** backend-engineer
- **Goal:** Confirm the live endpoints return exactly what `settingsSchema` parses and accept what `settingsPatchSchema` sends; record which settings are enforced at runtime.
- **Rationale:** Backend first. A schema mismatch discovered after building eight form sections is expensive.
- **Affected files:** read `backend/adminapi/settings_service.py`, `views_ops.py`, `content/runtime_settings.py`, `docs/api/pg-chess-backend.openapi.yaml` (`/admin/settings`). Edit only if a mismatch is found.
- **Implementation notes:**
  - Compare field names, nullability (`deskContactHref`, `defaultRefundWindowHours`, `contactDestinationEmail` defaulting to support email), `updatedAt` format, `version` for a never-saved row (returns 1, `updatedAt` epoch) against the Zod schemas.
  - Confirm `VALIDATION_FAILED` field keys use dotted paths (`group.field`) so the UI can map errors.
  - Grep for consumers of each stored-only setting listed in gap G3 and write the result in the "Findings" block at the bottom of this plan (or in the task hand-back).
  - If `OpenAPI` `/admin/settings` is out of date versus the service, fix the spec only.
- **Acceptance criteria:**
  - [ ] Written confirmation that response and patch shapes match the Zod schemas, or a minimal fix.
  - [ ] List of settings that are saved but not yet enforced, handed to the owner (OQ-1).
  - [ ] No secret or provider value appears in the response (re-checked).
- **Testing:** deferred (manual `curl` against local Postgres is enough).
- **Risk:** low.

### TASK-002 - Query and mutation hooks
- **Owner:** frontend-engineer
- **Goal:** Provide `useAdminSettings()` (wraps `adminSettingsQuery`) and `useSaveSettings()` (calls `api.settings.updateSettings`, writes the returned DTO into the cache, invalidates `qk.admin.settings()`).
- **Rationale:** Keeps cache handling out of the form components; matches how other admin features consume `query-options/admin.ts`.
- **Affected files:** new `web/src/features/admin/settings/useAdminSettings.ts`. Reuse existing `qk.admin.settings()` and `adminSettingsQuery`; do not edit them unless a gap appears.
- **Implementation notes:** follow the admin API accessor used in `PaymentsAdminPage.tsx`. Response of PATCH is the full `SettingsDto`; use it to reset the form and bump `version`. staleTime 0 already set for versioned resources.
- **Acceptance criteria:**
  - [ ] Hooks typed from `SettingsDto` and `SettingsPatch`.
  - [ ] After a successful save the cached settings equal the server response.
  - [ ] `tsc --noEmit` and lint pass.
- **Testing:** deferred.
- **Risk:** low.

### TASK-003 - Page shell and route wiring
- **Owner:** frontend-engineer
- **Goal:** `AdminSettingsPage` with the left group nav (Brand & site, Authentication, Ratings, Payments, Notifications, Event defaults, Integrations), skeleton/loading, error with retry, and render it from `app/(admin)/admin/settings/page.tsx`.
- **Rationale:** Replaces the placeholder; gives sections a place to mount.
- **Affected files:** new `web/src/features/admin/settings/AdminSettingsPage.tsx`, `SettingsNav.tsx`; edit `web/src/app/(admin)/admin/settings/page.tsx` (keep `routeMetadata('admin-settings')`).
- **Implementation notes:** layout per `56-admin-settings.html` (`cms-static` style nav plus surface). Group ids come from `SETTINGS_GROUPS`. Use the Tailwind and `components/ui` primitives used by Payments and Media pages; one section visible at a time, selected group kept in the URL hash or local state (no new route). Admin layout is desktop-first.
- **Acceptance criteria:**
  - [ ] `/admin/settings` renders the shell with real data from G07.
  - [ ] Loading and error states use the existing shared components.
  - [ ] Keyboard-operable nav with `aria-current` on the active group.
  - [ ] Typecheck and lint pass; `PlaceholderPage` import removed from this route only.
- **Testing:** deferred.
- **Risk:** low.

### TASK-004 - Integration status panel
- **Owner:** frontend-engineer
- **Goal:** Read-only list: Google sign-in, Razorpay, Email provider, WhatsApp provider, each a badge (Connected / Not connected) from `integrations` booleans.
- **Rationale:** AC-68: only "configured" or "not configured", never a value or an input.
- **Affected files:** new `web/src/features/admin/settings/IntegrationStatus.tsx`.
- **Implementation notes:** no inputs, no copy-to-clipboard, no env var names. Short help text: "Provider secrets are managed in the server environment." Reuse the existing Badge/StatusPill component.
- **Acceptance criteria:**
  - [ ] Four rows rendered from `integrations`; no editable control in the panel.
  - [ ] Status is conveyed by text, not colour alone.
- **Testing:** deferred (later DOM scan for secret fixtures per AC-68).
- **Risk:** low.

### TASK-005 - Brand & site and Notifications sections
- **Owner:** frontend-engineer
- **Goal:** Forms for `brand` (siteName, supportEmail, deskContactHref, defaultCity, social list up to 8 label+href) and `notifications` (emailEnabled, senderName, contactDestinationEmail, reminderHoursBefore).
- **Rationale:** Covers the F-CON-002 contact config and the contact-form destination (FEAT-001 OQ-10), plus the global email switch.
- **Affected files:** new `BrandSection.tsx`, `NotificationsSection.tsx`, `SocialLinksField.tsx`, shared `SettingsForm.tsx` (react-hook-form + `zodResolver` using the group schemas from `types/admin/settings.ts`) under `web/src/features/admin/settings/`.
- **Implementation notes:** reuse `brandSettingsSchema` and `notificationSettingsSchema` as the resolver; no new Zod types. Help text on `contactDestinationEmail`: "Contact-form messages are delivered here." Help text on `deskContactHref`: "WhatsApp or phone link for Message event desk (https, mailto or tel)." Note the public site updates after save (revalidation is server-side).
- **Acceptance criteria:**
  - [ ] All fields prefilled from G07 and validated client-side with the same limits as the server.
  - [ ] Social links can be added, removed (max 8) with accessible labels.
  - [ ] Disabling `emailEnabled` shows a one-line consequence note (event messages and state emails stop).
  - [ ] Typecheck and lint pass.
- **Testing:** deferred.
- **Risk:** medium (shared form core is reused by TASK-006 and TASK-007).

### TASK-006 - Authentication, Ratings and Payments sections
- **Owner:** frontend-engineer
- **Goal:** Forms for `auth` (googleSignInEnabled, signupOpen, adminSessionHours 1-12), `ratings` (ratingsEnabled, provisionalGames, showRatingsByDefault), `payments` (currency read-only INR, holdMinutes 1-60, defaultRefundWindowHours nullable 0-1440).
- **Rationale:** Remaining launch settings of screen 56.
- **Affected files:** new `AuthSection.tsx`, `RatingsSection.tsx`, `PaymentsSection.tsx` in `web/src/features/admin/settings/`.
- **Implementation notes:** `currency` displayed as plain text, never sent in the patch (patch schema omits it). `signupOpen=false` and `googleSignInEnabled` change should use `ConfirmAction` with a consequence line ("New players cannot create accounts"). Empty `defaultRefundWindowHours` means null ("no default window"). If OQ-1 says some settings are not yet enforced, label them accordingly or hide them per owner decision.
- **Acceptance criteria:**
  - [ ] Number fields enforce server ranges; nullable field clears to null.
  - [ ] Currency is not editable and not in the PATCH body.
  - [ ] Risky toggles require confirmation.
- **Testing:** deferred.
- **Risk:** medium (depends on OQ-1).

### TASK-007 - Event defaults section
- **Owner:** frontend-engineer
- **Goal:** Form for `eventDefaults` (type, pairingMode, capacity, waitlistEnabled, timeControl).
- **Rationale:** Last settings group on the screen.
- **Affected files:** new `EventDefaultsSection.tsx`.
- **Implementation notes:** option lists from `eventTypeSchema` and `pairingModeSchema` in `types/event-state`; reuse existing label maps from the builder if present (grep before adding any).
- **Acceptance criteria:**
  - [ ] Selects show human labels and submit contract enum values.
  - [ ] Capacity 1-100000 enforced.
- **Testing:** deferred.
- **Risk:** low.

### TASK-008 - Save flow: diff patch, version, conflicts, field errors
- **Owner:** frontend-engineer
- **Goal:** One save action per section sending only changed fields as a `SettingsPatch` with the loaded `version`; handle success, `VERSION_CONFLICT`, and `VALIDATION_FAILED`.
- **Rationale:** Server rejects stale versions and unknown keys; the UI must send minimal, valid patches and recover cleanly.
- **Affected files:** `SettingsForm.tsx` (save logic), `AdminSettingsPage.tsx` (dirty-navigation guard), optional `settings-diff.ts` pure helper.
- **Implementation notes:**
  - Build the patch from `formState.dirtyFields`; skip the request when nothing changed.
  - On success: `toast.success('Settings saved')`, reset form from the returned DTO.
  - On `VERSION_CONFLICT`: same pattern as `CollectionDetail.tsx` (banner "Settings changed elsewhere", refetch, keep user's edits visible where practical).
  - On `VALIDATION_FAILED`: map dotted `group.field` keys to field errors with `setError`; unmapped errors via `copyFor(error, { action: 'save settings' })`.
  - Use `isAbortError` guard as elsewhere. Never log or render raw request bodies.
- **Acceptance criteria:**
  - [ ] Save sends only changed fields plus `version`; the PATCH never contains `currency`, `integrations`, or any secret-looking key.
  - [ ] Conflict and validation failures show actionable inline messages.
  - [ ] Unsaved changes prompt on section switch or leave.
  - [ ] Typecheck and lint pass. No full build run.
- **Testing:** deferred (later unit test for the diff helper).
- **Risk:** medium.

---

## 5. Dependency summary and parallelism

```
TASK-001 (backend verify)
  -> TASK-002 (hooks)
    -> TASK-003 (shell)
         -> TASK-004 (integrations)            \
         -> TASK-005 (brand + notifications) -> TASK-008 (save flow)
         -> TASK-006 (auth, ratings, payments)  > can run in parallel after TASK-005 form core lands
         -> TASK-007 (event defaults)          /
```

- TASK-001 can be quick and TASK-002/003 may begin once it confirms no mismatch (the endpoints already exist, so risk of rework is low).
- After TASK-003: TASK-004, TASK-006, TASK-007 are parallel. TASK-005 should land first (or be done by the same agent) because it establishes the shared `SettingsForm`; TASK-006/007 then reuse it.
- Critical path: 001 -> 002 -> 003 -> 005 -> 008.

## 6. Feature acceptance criteria (end to end)

- [ ] `/admin/settings` shows all six groups and integration status from live G07 data.
- [ ] Editing and saving any group persists via G08 with the correct `version`; a second save works with the new version.
- [ ] A stale save shows the conflict message and recovers.
- [ ] No secret or credential value is displayed or editable anywhere (AC-68).
- [ ] Changing brand contact fields is reflected on the public contact page/footer after revalidation.
- [ ] Typecheck and lint pass; owner runs one build for the batch.

## 7. Open questions

| ID | Question | Owner of answer |
|----|----------|-----------------|
| OQ-1 | Stored but not enforced settings. **Decided:** keep editable, show a "Not yet applied" badge. List lives in `NOT_APPLIED_KEYS` (`features/admin/settings/settings-meta.ts`). Enforced settings carry no badge. | Owner (decided 2026-10-31) |
| OQ-2 | Timezone field. **Decided:** dropped (not in contract). | Owner (decided) |
| OQ-3 | `signupOpen` / Google toggles. **Decided:** confirm dialog only, no step-up. | Owner (decided) |
| OQ-4 | WhatsApp row. **Decided:** permanently "Not connected". | Owner (decided) |

## 8. Blockers

None. Endpoints, Zod types, adapter methods, query options and route already exist.

## 9. Findings (TASK-001, read-only)

- Response shape of `settings_service.read()` matches `settingsSchema` (groups, `integrations` booleans, `version`, `updatedAt`). Patch validators match the Zod ranges.
- MISMATCH (minor): `_defaults()` sets `notifications.contactDestinationEmail` to `None`, but `read()` replaces it with `brand.supportEmail`; fine. `brand.deskContactHref` is null-capable on both sides.
- RISK: `DEFAULT_SUPPORT_EMAIL = 'desk@example.com'` is returned when no `PublicSettings` row exists; it passes `z.email()`.
- `updatedAt` for a never-saved row is the epoch in server local time (`iso()` uses `localtime`, offset included); `z.iso.datetime({ offset: true })` accepts it.
- Validation errors use dotted `group.field` keys (`brand.supportEmail`); the UI maps them. Brand-level (`brand`) and `form`/`version` keys are shown via the generic banner.
- Backend `_email` regex is looser than Zod `z.email()`: client may reject something the server accepts; not harmful.
- Backend trims strings in `STRIP`; Zod `plainText` does not trim, so a value with surrounding spaces round-trips trimmed (form becomes dirty-free after reset).
