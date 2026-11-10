---
id: PLAN-012
type: plan
feature_id: FEAT-001
architecture_id: ARCH-001
version: 1
status: ready
date: 2026-11-10
---

# PLAN-012: Admin-Initiated Player Creation, First-Login Password Change, and Direct Event Enrollment

Covers FEAT-000 F-AUTH-007 (server-owned roles), F-AADM-001 (players admin), F-AADM-002 (role management). Extends PLAN-009 (admin players, `/admin/players`) with three new capabilities:

1. **Admin creates a player account** from the Players section, assigning a temporary first-time password.
2. **Force password change on first login** — the created user is gated behind a mandatory password change prompt the first time they sign in.
3. **Admin enrolls the player into any event** (free or paid) as a confirmed participant, bypassing the normal registration and payment flow.

Execution rules: backend first, extend the existing Django app, no new mocks (wire directly against the backend), agents run `typecheck` and `lint` only. Do not touch the owner's uncommitted files. PLAN-009 and PLAN-011 tasks are prerequisites for some tasks here; see the dependency summary (section 4).

---

## 1. Requirements recap

- **Player creation:** Admin fills in name + email + temporary password (plus optional city/phone). System creates a `player`-role account. Email must be unique. Audit log entry `player.create` written in the same transaction. Admin does not need the password reset email flow for this action.
- **Temporary password constraints:** Temporary password must meet the existing minimum-length and strength checks (`accounts/passwords.py`). Admin sets it; the system stores it hashed and sets `must_change_password=True` on the new user row.
- **Force password change on first login:** After any successful login, the frontend reads `mustChangePassword` from `GET /api/me`. If `true`, a non-dismissable full-page prompt is shown; the user cannot access the app until they supply their current password and a new one via `PATCH /api/me/password`. On success the flag is cleared and all other sessions for that user are revoked (same as the password reset path).
- **Admin enrollment (direct):** From the player record panel, admin can enroll the player in an upcoming event. The endpoint `POST /api/admin/events/{event_id}/registrations/enroll` creates a confirmed registration with `payment_method='admin_enrolled'` and `amount_paise=0` (a comp placement). Capacity is enforced. Works for both free and paid events. Audit record `registration.admin_enrolled` written in the same transaction.
- **Step-up for creation:** Admin creating a user is a privileged mutation; it requires a step-up grant (same posture as role change in PLAN-009).
- **Out of scope:** Password reset email for admin-created accounts, bulk user import, admin changing another user's password after initial creation, enrollment into cancelled/completed events, refunds for admin-enrolled registrations.

---

## 2. What exists vs gaps (verified in code)

### Backend

| Area | What exists | Gap |
|---|---|---|
| `User` model | `email`, `name`, `role`, `status`, `password` (hashed), `phone`, `city`, `created_at` | No `must_change_password` field |
| `UserManager.create_user` | Hashes password, saves user | Does not set `must_change_password`; no admin-creation audit |
| `POST /api/admin/players` | `PlayersView.get` (list only) | No `post` handler for creation |
| `me_dto` | `id`, `name`, `email`, `role`, `onboardingDone`, `ratings` | Does not expose `mustChangePassword` |
| `GET /api/me` (A05) | Returns `me_dto` | Missing `mustChangePassword` field |
| `PATCH /api/me/profile` | Edits profile fields | No password-change endpoint for authenticated users |
| `PasswordResetConfirmView` | Unauthenticated token-based reset | Cannot be reused for authenticated same-session change (requires token) |
| `Registration.payment_method` (PLAN-011) | `razorpay`, `cash` (after PLAN-011 TASK-001/002) | No `admin_enrolled` value; guard rejects free-event cash registration |
| `POST /api/admin/events/{id}/registrations/cash` | Cash registration for **paid** events only | No enrollment for free events; guard `price_paise == 0` → 400 |
| Admin players frontend | `PlayersAdminPage` (PLAN-009 TASK-905–908) | No "Create player" button or dialog |
| Players record panel | Player record (PLAN-009 TASK-907) | No "Enroll in event" action |
| Login flow / app shell | Reads `onboardingDone` flag | Does not check or gate on `mustChangePassword` |

### Frontend contract client

- `web/src/lib/api/types/admin/players.ts` has `PgAdminPlayersApi` (`listPlayers`, `getPlayer`, `changeRole`) — no `createPlayer`.
- `web/src/lib/api/types/` has `me` schema — no `mustChangePassword`.
- No `changePassword()` on the `me` API.
- No `enrollPlayer()` on the admin events API.

---

## 3. Tasks (dependency order)

Status legend: `[ ]` pending. Owner agents: `backend-engineer` (BE), `frontend-engineer` (FE), `test-engineer` (TE), `security-reviewer` (SR).

---

### Phase A — Schema and model changes

#### TASK-201  `must_change_password` field on `User` + migration

- **Owner:** BE | **Risk:** low | **Effort:** S | **Deps:** none | **Status:** [x]
- **Goal:** Add `must_change_password = models.BooleanField(default=False, db_default=False)` to `accounts/models.py::User` and generate migration `0002_user_must_change_password.py` (or the next numbered migration under `accounts/migrations/`).
- **Files:** `backend/accounts/models.py`, new migration file.
- **Implementation notes:**
  - Add the field after `onboarding_done` in the model class body.
  - Set both `default=False` and `db_default=False` so the migration adds a non-null column without a row rewrite (PostgreSQL stores the `db_default` in the catalog; existing rows get `false` without touching each row).
  - The migration must be reversible: `RemoveField` in the reverse operation.
  - Do **not** expose this field through `ProfileView`; it is internal.
- **Acceptance criteria:**
  - [ ] `python manage.py migrate accounts` succeeds on a clean DB.
  - [ ] `python manage.py migrate accounts <prev>` rolls back cleanly.
  - [ ] `User.objects.get(pk=…).must_change_password` returns `False` for all pre-existing rows.
  - [ ] `user.must_change_password = True; user.save()` persists without error.
  - [ ] `python manage.py check` passes.
- **Tests:** unit test — create user, assert `must_change_password=False`; set `True`, save, refetch, assert `True`.

---

#### TASK-202  Fold `admin_enrolled` into PLAN-011's `payment_method` migration

- **Owner:** BE | **Risk:** low | **Effort:** S | **Deps:** PLAN-011 TASK-001/002 (coordinate before either is applied) | **Status:** [x]
- **Goal:** Since PLAN-011 is not yet deployed, extend its initial `payment_method` migration and model to include `'admin_enrolled'` from the start — no separate migration needed.
- **Files:** `backend/registrations/models.py`, `backend/registrations/migrations/0005_registration_admin_enrolled.py` (new migration).
- **Implementation notes:**
  - `0004_add_payment_method` was already applied to the dev DB, so a clean `0005_registration_admin_enrolled` migration was created instead of editing in-place: it removes the old 2-value constraint, widens `max_length` to 20, and re-adds the constraint with all three values.
  - `PAYMENT_METHODS` in `registrations/models.py` is updated to:
    ```python
    PAYMENT_METHODS = [('razorpay', 'razorpay'), ('cash', 'cash'), ('admin_enrolled', 'admin_enrolled')]
    ```
  - `CheckConstraint` in `models.py` updated to include all three values.
- **Acceptance criteria:**
  - [ ] `Registration(payment_method='admin_enrolled').full_clean()` passes.
  - [ ] `Registration(payment_method='razorpay').full_clean()` and `payment_method='cash'` still pass.
  - [ ] `Registration(payment_method='stripe').full_clean()` raises `ValidationError`.
  - [ ] `python manage.py migrate registrations` (with the combined migration) succeeds on a clean DB.
  - [ ] Migration is reversible.
- **Tests:** unit test — `full_clean()` accepts all three values; rejects unknown.

---

### Phase B — Backend services

#### TASK-203  `create_player()` service

- **Owner:** BE | **Risk:** high | **Effort:** M | **Deps:** TASK-201 | **Status:** [x]
- **Goal:** Implement `create_player(request, data: dict) -> dict` in `backend/adminapi/players_service.py`. Creates a new `User` account at the request of an admin, sets a temporary password, and marks `must_change_password=True`.
- **Files:** `backend/adminapi/players_service.py`.
- **Implementation notes:**
  - Validate input with `Collector`:
    - `name`: text, max 80, required.
    - `email`: valid email, max 254, lowercased; raise `ValidationFailed(fields={'email': [...]})` if a `User` with that email already exists (check before creating; also catch `IntegrityError` from a race).
    - `password`: string, must pass `accounts.passwords.check_length` and `accounts.passwords.is_weak(password, email)`; raise `ValidationFailed(fields={'password': [...]})` on failure.
    - `city`: text, max 80, optional.
    - `phone`: text, max 20, min 7, optional; validate with `PHONE_RE` pattern (same as `RegisterView`).
    - Reject unknown keys.
  - Use `User.objects.create_user(email, password, name, city=…, phone=…)` inside `transaction.atomic()`.
  - Immediately set `user.must_change_password = True` and `user.save(update_fields=['must_change_password'])` in the same transaction.
  - Write audit record `player.create` inside the same transaction:
    ```python
    audit.write(
        request,
        action='player.create',
        object_type='user',
        object_id=user.pk,
        before=None,
        after={
            'name': user.name,
            'email': user.email,
            'role': user.role,
            'city': user.city or None,
            'mustChangePassword': True,
            'actorName': (request.user.name or '').strip()[:80] or 'Admin',
        },
    )
    ```
  - Do **not** send a registration email in this path (differs from self-service signup).
  - Return a player record dict (reuse / call `get_player(request, user.pk)` to build the DTO — or inline a minimal subset with `id`, `name`, `email`, `role`, `status`, `mustChangePassword`, `joinedAt`).
- **Acceptance criteria:**
  - [ ] Creates a `User` row with `role='player'`, `status='active'`, `must_change_password=True`.
  - [ ] Password is stored hashed (not plaintext); `user.check_password(supplied)` returns `True`.
  - [ ] Duplicate email raises `ValidationFailed` with `fields.email` set; no second user created.
  - [ ] Weak password raises `ValidationFailed` with `fields.password` set; no user created.
  - [ ] Audit record written with all required fields; audit failure rolls back the whole transaction.
  - [ ] Optional fields (`city`, `phone`) saved when provided; `None` when absent.
- **Tests:** see TASK-213.

---

#### TASK-204  `POST /api/admin/players` endpoint

- **Owner:** BE | **Risk:** medium | **Effort:** S | **Deps:** TASK-203 | **Status:** [x]
- **Goal:** Add a `post` handler to `PlayersView` in `backend/adminapi/views_ops.py` and no URL change is needed (the existing `path('players', op.PlayersView.as_view(), name='admin-players')` already routes `POST` there).
- **Files:** `backend/adminapi/views_ops.py`.
- **Implementation notes:**
  - `PlayersView.post` is already behind `AdminView` (default deny).
  - Wrap with `run_idempotent(request, work, required=True)` — idempotency key is required (same posture as role change G03).
  - Step-up is required: call `require_step_up(request)` (same as G03) before delegating to `create_player`.
  - Delegate body parsing and user creation entirely to `ps.create_player(request, request.data)`.
  - Return `ok(player_dto, status=201)`.
  - URL entry: **no change needed** — `POST /api/admin/players` already routes to `PlayersView` through the existing `players` path entry.
- **Acceptance criteria:**
  - [ ] `POST /api/admin/players` with valid admin token + step-up + idempotency key + body → `201 {ok: true, data: {id, name, email, …}}`.
  - [ ] Unauthenticated → `401`.
  - [ ] Player-role token → `403`.
  - [ ] Missing `X-Step-Up-Token` → `STEP_UP_REQUIRED`.
  - [ ] Missing `Idempotency-Key` → `IDEMPOTENCY_KEY_REQUIRED`.
  - [ ] Duplicate email → `400 VALIDATION_FAILED` with `fields.email`.
  - [ ] Weak password → `400 VALIDATION_FAILED` with `fields.password`.
  - [ ] Replayed `Idempotency-Key` → `201` with original response; no second user created.
- **Tests:** see TASK-213.

---

#### TASK-205  Authenticated password change: `PATCH /api/me/password`

- **Owner:** BE | **Risk:** medium | **Effort:** M | **Deps:** TASK-201 | **Status:** [x]
- **Goal:** New authenticated endpoint that lets a signed-in user change their own password. Clears `must_change_password` on success. Used both for forced first-login change and for voluntary self-service change.
- **Files:** `backend/accounts/views.py` (new `ChangePasswordView`), `backend/accounts/services.py` (new `change_own_password`), `backend/accounts/me_urls.py` (new route).
- **Service `change_own_password(user, current_password, new_password, validate)`:**
  ```python
  def change_own_password(user, current_password, new_password, validate):
      if not user.check_password(current_password):
          raise InvalidCredentials()
      validate(user)          # raises WeakPassword if too weak
      with transaction.atomic():
          user.set_password(new_password)
          user.must_change_password = False
          user.save(update_fields=['password', 'must_change_password', 'updated_at'])
          revoke_all_for_user(user.pk)  # revoke all sessions (same as password reset)
  ```
- **View `ChangePasswordView(PrivateView)`:**
  - `PATCH` method; rate-limited using `ratelimit.check_and_hit('change-password', str(user.pk), ...)`.
  - Body: `{currentPassword, newPassword}` — reject unknown keys.
  - `currentPassword`: string, required, max `passwords.MAX_LENGTH`.
  - `newPassword`: string, required; must pass `check_length` and `is_weak(new_password, user.email)`.
  - On `InvalidCredentials` raise `ValidationFailed(fields={'currentPassword': ['Incorrect password.']})`.
  - On success return `ok(None, status=200)`.
- **URL:** `path('password', views.ChangePasswordView.as_view())` in `me_urls.py`.
- **Implementation notes:**
  - After `revoke_all_for_user`, the current session is also revoked, so the frontend will receive `401` on the next request, which forces a fresh login with the new password. This is intentional — the forced password change path should log the user out after success. The frontend handles this by showing a "Password changed. Please log in again." message.
  - Do **not** send a password-reset-style confirmation email here.
- **Acceptance criteria:**
  - [ ] `PATCH /api/me/password` with correct `currentPassword` and valid `newPassword` → `200`.
  - [ ] `user.must_change_password` is `False` after the call.
  - [ ] All sessions for the user are revoked after the call.
  - [ ] Unauthenticated → `401`.
  - [ ] Wrong `currentPassword` → `400 VALIDATION_FAILED` with `fields.currentPassword`.
  - [ ] Weak `newPassword` → `400 WEAK_PASSWORD` (same as `WeakPassword` error).
  - [ ] `newPassword` same as `currentPassword`: allowed (no same-password guard at this stage).
- **Tests:** see TASK-213.

---

#### TASK-206  `me_dto` update to include `mustChangePassword`

- **Owner:** BE | **Risk:** low | **Effort:** S | **Deps:** TASK-201 | **Status:** [x]
- **Goal:** Add `mustChangePassword: user.must_change_password` to `me_dto()` in `backend/accounts/dto.py`.
- **Files:** `backend/accounts/dto.py`.
- **Implementation notes:**
  - Add `'mustChangePassword': user.must_change_password` to the dict returned by `me_dto`.
  - This field is always present in the `me` response from now on.
  - All existing callers of `me_dto` (`RegisterView`, `LoginView`, `MeView`) will automatically include the field.
  - No other DTO changes needed for this task.
- **Acceptance criteria:**
  - [ ] `GET /api/me` response includes `mustChangePassword: false` for all existing users.
  - [ ] `GET /api/me` after admin creates a player returns `mustChangePassword: true` when the new user logs in.
  - [ ] `GET /api/me` after the user changes their password returns `mustChangePassword: false`.
- **Tests:** unit test — `me_dto(user)` returns `mustChangePassword: False` by default; `True` when flag is set.

---

#### TASK-207  `admin_enroll()` service

- **Owner:** BE | **Risk:** high | **Effort:** M | **Deps:** TASK-202 | **Status:** [x]
- **Goal:** Implement `admin_enroll(request, event_id: str, data: dict) -> dict` in `backend/registrations/services.py` (or a suitable location such as `backend/adminapi/control_service.py`). Directly enrolls a player in any event (free or paid) as a confirmed participant with `payment_method='admin_enrolled'` and `amount_paise=0`.
- **Files:** `backend/registrations/services.py`.
- **Implementation notes:**
  - Parse and validate `playerId` (UUID, player exists; raise `ValidationFailed(fields={'playerId': […]})` otherwise).
  - Use the same capacity enforcement primitives as `cash_register()`: `lock_event`, `release_expired`, `rules.occupied`, `rules.active_registration`, `adjust_confirmed`, `_expire_order`.
  - Guards:
    - `event.status in ('cancelled', 'completed')` → raise `ValidationFailed` (EC-04).
    - `rules.active_registration(event, player)` is already `confirmed` → raise `AlreadyRegistered` (same as cash path).
    - `payment_order_state == 'attempted'` on an existing pending registration → raise `ValidationFailed` (same RISK-002-05 guard as cash path).
  - **No price guard** — unlike `cash_register()`, `admin_enroll()` works for both free and paid events.
  - Set `payment_method='admin_enrolled'`, `cash_registered_by=request.user` (reuse this FK for attribution; the field name remains meaningful for all admin-override payments).
  - Audit record inside `transaction.atomic()`:
    ```python
    audit.write(
        request,
        action='registration.admin_enrolled',
        object_type='registration',
        object_id=reg.pk,
        before={'promoted': promoted, 'prevStatus': existing.status if promoted else None},
        after={
            'status': 'confirmed', 'paymentMethod': 'admin_enrolled',
            'amountPaise': 0,
            'eventId': str(event.pk), 'playerId': str(player.pk),
            'actorName': (request.user.name or '').strip()[:80] or 'Admin',
        },
    )
    ```
  - Return the registration DTO (reuse `registration_dto` from `control_service.py`).
- **Acceptance criteria:**
  - [ ] Creates a `confirmed` registration with `payment_method='admin_enrolled'` and `amount_paise=0` for both free and paid events.
  - [ ] Capacity check runs for new and waitlist paths; `EventFull` raised when full.
  - [ ] `AlreadyRegistered` raised when player already `confirmed`.
  - [ ] Works on free events (`price_paise == 0`) without raising a validation error.
  - [ ] Audit record written; audit failure rolls back.
- **Tests:** see TASK-213.

---

#### TASK-208  `POST /api/admin/events/{event_id}/registrations/enroll` endpoint + URL

- **Owner:** BE | **Risk:** medium | **Effort:** S | **Deps:** TASK-207 | **Status:** [x]
- **Goal:** Add `AdminEnrollView` to `backend/adminapi/views_control.py` and register the URL.
- **Files:** `backend/adminapi/views_control.py`, `backend/adminapi/urls.py`.
- **Implementation notes:**
  - Inherit from `AdminView`.
  - Wrap with `run_idempotent(request, work, required=True)`.
  - No step-up required for enrollment (lower risk than role change; audit is sufficient). This matches the cash registration posture from PLAN-011.
  - Body: `{playerId}` only — `amountPaise` is always zero for admin enrollment.
  - Validate: `playerId` valid UUID; resolve event via `control_event(event_id)`.
  - Delegate to `reg_services.admin_enroll(request, event, player)`.
  - Return `ok(dto, status=201)`.
  - **URL** (append after the `registrations/cash` line in `urls.py`):
    ```python
    path('events/<str:event_id>/registrations/enroll',
         cv.AdminEnrollView.as_view(),
         name='admin-event-enroll'),
    ```
- **Acceptance criteria:**
  - [ ] `POST` with valid admin + idempotency key + `{playerId}` for a free event → `201`.
  - [ ] `POST` for a paid event → `201` (no price guard).
  - [ ] Unauthenticated → `401`; player token → `403`.
  - [ ] Missing `Idempotency-Key` → error.
  - [ ] Unknown `event_id` → `404`; cancelled/completed event → `400 VALIDATION_FAILED`.
  - [ ] Already confirmed player → `400 ALREADY_REGISTERED`.
  - [ ] Full event → `400 EVENT_FULL`.
  - [ ] Replayed idempotency key → `201` with original response.
- **Tests:** see TASK-213.

---

### Phase C — Frontend

#### TASK-209  TypeScript types and API methods

- **Owner:** FE | **Risk:** low | **Effort:** S | **Deps:** none (can develop against contract; wire to real backend after TASK-204/205/208) | **Status:** [x]
- **Goal:** Add TypeScript types and API client methods for all three new capabilities.
- **Files:**
  - `web/src/lib/api/types/admin/players.ts`
  - `web/src/lib/api/types/me.ts` (or wherever the `me` schema lives — locate by searching for `onboardingDone`)
  - `web/src/lib/api/pg-api.ts` or the admin API client file
  - `web/src/lib/api/pg-me-api.ts` or equivalent for authenticated user endpoints
- **Additions:**
  ```typescript
  // players.ts — admin creates player
  export const adminCreatePlayerInputSchema = z.strictObject({
    name:     z.string().min(1).max(80),
    email:    z.string().email(),
    password: z.string().min(1).max(128),
    city:     z.string().max(80).optional(),
    phone:    z.string().min(7).max(20).optional(),
  })
  export type AdminCreatePlayerInput = z.infer<typeof adminCreatePlayerInputSchema>
  // Response: reuse existing AdminPlayerRowDto or a minimal subset

  // me schema — add mustChangePassword
  // Extend the existing me response schema with:
  //   mustChangePassword: z.boolean().optional().default(false)
  // Use .optional().default(false) so existing API responses without the field
  // continue to parse (backward-compatible during deployment window).

  // admin events enrollment
  export const adminEnrollInputSchema = z.strictObject({
    playerId: z.string().uuid(),
  })
  export type AdminEnrollInput = z.infer<typeof adminEnrollInputSchema>

  // me password change
  export const changePasswordInputSchema = z.strictObject({
    currentPassword: z.string().min(1),
    newPassword:     z.string().min(1),
  })
  export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>
  ```
- **API methods:**
  - `api.admin.players.createPlayer(input: AdminCreatePlayerInput): Promise<AdminPlayerDto>` — `POST /api/admin/players` with `X-Step-Up-Token` and `Idempotency-Key`.
  - `api.admin.events.enrollPlayer(eventId: string, input: AdminEnrollInput): Promise<AdminRegistrationDto>` — `POST /api/admin/events/{eventId}/registrations/enroll` with `Idempotency-Key`.
  - `api.me.changePassword(input: ChangePasswordInput): Promise<void>` — `PATCH /api/me/password`.
- **Acceptance criteria:**
  - [ ] All new schemas parse their intended shapes; `tsc --noEmit` passes.
  - [ ] `mustChangePassword` field in the `me` schema has `.optional().default(false)` so existing responses remain valid.
  - [ ] Existing tests in `admin.test.ts` / `me.test.ts` stay green (additive changes only).
- **Tests:** type-level unit tests for each new schema against sample payloads.

---

#### TASK-210  `CreatePlayerDialog` component

- **Owner:** FE | **Risk:** medium | **Effort:** M | **Deps:** TASK-209 | **Status:** [x]
- **Goal:** New dialog component in `web/src/features/admin/players/` that allows an admin to create a new player account with a temporary password.
- **Files:** `web/src/features/admin/players/CreatePlayerDialog.tsx` (new).
- **Implementation notes — dialog flow:**
  1. **Trigger:** "Create Player" button in the toolbar of `PlayersAdminPage`. Always visible to admins.
  2. **Form fields:** Name (text, required), Email (email, required), Temporary Password (password input with show/hide toggle, required), City (text, optional), Phone (text, optional).
  3. **Password strength hint:** Inline warning if the password looks weak (mirror the strength check; the server is authoritative but a hint prevents unnecessary round trips).
  4. **Clipboard copy:** A "Copy password" icon button next to the temporary password field. Admin copies it to share with the new player out-of-band. The button uses `navigator.clipboard.writeText` and shows a brief "Copied!" confirmation (do not store the password in component state longer than needed for the copy).
  5. **Step-up:** Before submitting, call `api.auth.stepUp(password)` to obtain a step-up token, then pass it to `createPlayer`. Reuse the existing `withStepUpToken` / `StepUpPrompt` pattern from PLAN-009 TASK-908.
  6. **Submit:** Call `api.admin.players.createPlayer(input)`. On success: close dialog, invalidate/refetch the players list query, show a toast "Player created — share the temporary password with them."
  7. **Error states:** `VALIDATION_FAILED` with `fields.email` → inline email error; `fields.password` → inline password error; other errors → dialog-level error message.
  8. **Loading:** `useTransition` for the async submit (rule 6.11 from React best-practices); `isPending` disables the Create button.
- **React best-practices compliance:**
  - No sub-components defined inside `CreatePlayerDialog` (rule 5.4).
  - `useState(() => '')` lazy initialisation for form fields (rule 5.12).
  - Functional `setState` updates for error state (rule 5.11).
  - `useTransition` for the submit action (rule 6.11).
- **Acceptance criteria:**
  - [ ] Dialog opens from the toolbar "Create Player" button.
  - [ ] All fields present; name, email, password are required (Create button disabled when any is empty).
  - [ ] Password show/hide toggle works.
  - [ ] Copy-password button copies to clipboard; shows brief "Copied!" feedback.
  - [ ] On success: dialog closes, list refreshes, toast shown.
  - [ ] On `VALIDATION_FAILED`: inline field errors shown; dialog stays open; form remains filled.
  - [ ] `tsc --noEmit` and lint pass.
  - [ ] No components defined inside the component (rule 5.4).
- **Tests:** see TASK-214.

---

#### TASK-211  First-login forced password change prompt

- **Owner:** FE | **Risk:** medium | **Effort:** M | **Deps:** TASK-209 | **Status:** [x]
- **Goal:** After any successful login, if `user.mustChangePassword === true`, show a full-page, non-dismissable prompt requiring the user to change their password before using the app.
- **Files:**
  - `web/src/components/layout/MustChangePasswordGate.tsx` (new — a full-page blocker component)
  - The admin shell and/or player app shell layout file where `user` state is read (find by searching for `onboardingDone` usage in the shell/layout components)
- **Implementation notes:**
  1. **Gate placement:** In the app shell that wraps all authenticated routes, add a conditional render:
     ```tsx
     if (user.mustChangePassword) {
       return <MustChangePasswordGate user={user} onPasswordChanged={handlePasswordChanged} />
     }
     ```
     This renders before `{children}`, blocking all navigation.
  2. **`MustChangePasswordGate` component:** Full-page (or modal) form with:
     - Heading: "Set your new password"
     - Subtext: "Your admin has set a temporary password. You must choose a new password to continue."
     - `currentPassword` field (labelled "Temporary password", password input).
     - `newPassword` field (labelled "New password", password input with show/hide toggle).
     - `confirmNewPassword` field (client-side match check only — the server doesn't require it, but it is good UX).
     - Submit button "Set password".
     - No "Cancel" or close button — the user cannot dismiss this screen.
  3. **Submission:** Call `api.me.changePassword({currentPassword, newPassword})`. On success, the backend revokes all sessions and returns `200`. The frontend will receive a `401` on the next API call. Handle this by:
     - Clearing the local auth state / access token.
     - Showing a toast "Password changed successfully. Please log in again."
     - Redirecting to the login page (e.g. `router.replace('/login')`).
  4. **Error handling:** Wrong `currentPassword` → inline error on that field. Weak `newPassword` → inline error. Non-matching confirm → client-side inline error before submitting.
  5. **`useTransition` for the submit** (rule 6.11).
- **Acceptance criteria:**
  - [ ] When `user.mustChangePassword === true`, the full-page gate renders before any app content.
  - [ ] The gate cannot be dismissed by navigating away (blocks children).
  - [ ] Wrong temporary password shows an inline error; form stays open.
  - [ ] On success: auth state is cleared, user is redirected to login, toast shown.
  - [ ] When `user.mustChangePassword === false`, the gate is not rendered (no impact on normal users).
  - [ ] `tsc --noEmit` and lint pass.
- **Tests:** see TASK-214.

---

#### TASK-212  "Enroll in Event" action on the player record panel

- **Owner:** FE | **Risk:** medium | **Effort:** M | **Deps:** TASK-209 | **Status:** [x]
- **Goal:** Add an "Enroll in Event" action button and dialog to the player record panel (`PlayerRecord` component, built in PLAN-009 TASK-907). Admin can search upcoming events and directly enroll the selected player.
- **Files:** `web/src/features/admin/players/EnrollInEventDialog.tsx` (new), `web/src/features/admin/players/PlayerRecord.tsx` (extend, once PLAN-009 TASK-907 is done).
- **Implementation notes — dialog flow:**
  1. **Trigger:** "Enroll in Event" button in the player record panel, visible only when `player.role === 'player'` and `player.status === 'active'`.
  2. **Event search:** Text input → `GET /api/admin/events?status=registration_open&q=…` (or a suitable admin events list endpoint with status filter; confirm the exact query parameter with the existing admin events API). Debounced with `useDeferredValue` (rule 5.14 / consistent with existing patterns). Show event title, date, type, and whether the event is free or paid.
  3. **Event selection:** Single-select from the results. Show the selected event's name and entry fee (or "Free").
  4. **Confirmation step:** "Enroll [player name] in [event title]? This creates a confirmed spot (admin enrolled, no payment)."
  5. **Submit:** Call `api.admin.events.enrollPlayer(eventId, {playerId})`. On success: close dialog, show toast "Player enrolled in [event title]."
  6. **Error states:** `ALREADY_REGISTERED` → show "This player is already registered for this event."; `EVENT_FULL` → "This event is full."; other errors → dialog-level error.
  7. **No step-up required** for enrollment (consistent with TASK-208 — audit is the control here).
  8. **Loading states:** Loading skeleton during event search; `useTransition` for submit (rule 6.11).
- **Acceptance criteria:**
  - [ ] "Enroll in Event" button is present on the player record panel.
  - [ ] Event search results show event name, date, and fee (or "Free").
  - [ ] Confirm step names the player and event before enrolling.
  - [ ] On success: toast shown, dialog closes.
  - [ ] On `ALREADY_REGISTERED`: appropriate message shown.
  - [ ] On `EVENT_FULL`: appropriate message shown.
  - [ ] Works for both free and paid events.
  - [ ] `tsc --noEmit` and lint pass.
- **Tests:** see TASK-214.

---

### Phase D — Verification

#### TASK-213  Backend tests

- **Owner:** TE | **Risk:** medium | **Effort:** M | **Deps:** TASK-204, TASK-205, TASK-208 | **Status:** [ ]
- **Goal:** Comprehensive Django integration tests for all new backend endpoints and services.
- **Files:**
  - `backend/adminapi/tests/test_player_creation.py` (new)
  - `backend/accounts/tests/test_change_password.py` (new or extend existing)
  - `backend/adminapi/tests/test_admin_enroll.py` (new)

**Tests to write:**

*Player creation (test_player_creation.py):*
- Happy path: creates `User` with `role='player'`, `must_change_password=True`, hashed password, audit record.
- `me_dto` includes `mustChangePassword: true` for the new user.
- Duplicate email → `400 VALIDATION_FAILED` with `fields.email`; no second user created.
- Weak password → `400 VALIDATION_FAILED` with `fields.password`.
- Missing required fields → `400 VALIDATION_FAILED`.
- Unauthenticated → `401`; player token → `403`.
- Missing `X-Step-Up-Token` → `STEP_UP_REQUIRED`.
- Missing `Idempotency-Key` → idempotency error.
- Replayed `Idempotency-Key` → `201` with original response; no second user row.
- Audit record content: all `after` fields present; no plaintext password in audit.

*Authenticated password change (test_change_password.py):*
- Happy path: `PATCH /api/me/password` with correct `currentPassword` → `200`; `must_change_password=False`; all sessions revoked.
- Wrong `currentPassword` → `400 VALIDATION_FAILED` with `fields.currentPassword`.
- Weak `newPassword` → `400 WEAK_PASSWORD`.
- Unauthenticated → `401`.
- After success, the original access token's session is revoked (next request with same token → `401`).

*Admin enrollment (test_admin_enroll.py):*
- Happy path free event: creates confirmed registration with `payment_method='admin_enrolled'`, `amount_paise=0`; audit record.
- Happy path paid event: same as free (no price guard).
- Already confirmed → `400 ALREADY_REGISTERED`.
- Event full → `400 EVENT_FULL`.
- Cancelled/completed event → `400 VALIDATION_FAILED`.
- Unknown `event_id` → `404`; unknown `playerId` → `400 VALIDATION_FAILED`.
- Unauthenticated → `401`; player token → `403`.
- Missing `Idempotency-Key` → error.
- Replayed key → `201` with original response; no second registration row.
- Concurrent identical enrollment: only one succeeds.

- **Acceptance criteria:**
  - [ ] All tests pass in CI (`pytest backend/ -x`).
  - [ ] No plaintext passwords or PII (beyond name) in fixtures.
  - [ ] Audit record tests verify absence of plaintext password in the `after` payload.

---

#### TASK-214  Frontend tests and Playwright e2e

- **Owner:** TE | **Risk:** medium | **Effort:** M | **Deps:** TASK-210, TASK-211, TASK-212 | **Status:** [ ]
- **Goal:** Component tests for all new components; Playwright e2e for the full admin flow.
- **Files:**
  - `web/src/features/admin/players/CreatePlayerDialog.test.tsx` (new)
  - `web/src/components/layout/MustChangePasswordGate.test.tsx` (new)
  - `web/src/features/admin/players/EnrollInEventDialog.test.tsx` (new)
  - `web/src/tests/e2e/admin-player-creation.spec.ts` (new)

**Component tests:**
- `CreatePlayerDialog`: empty name/email/password → Create disabled; success path → `onSuccess` called, dialog closes; `VALIDATION_FAILED` email error → inline error shown, dialog stays open; copy-password button → writes to clipboard.
- `MustChangePasswordGate`: renders when `mustChangePassword=true`; does not render when `false`; wrong current password → inline error; success → clears auth state, triggers logout callback.
- `EnrollInEventDialog`: event search results shown; `ALREADY_REGISTERED` → error message; `EVENT_FULL` → error message; success path → `onSuccess` called.

**Playwright e2e (against Django dev backend; no new mocks):**
1. Admin logs in → navigates to `/admin/players` → clicks "Create Player" → fills form → copies password → submits → new player row appears in list.
2. New player logs in with temporary password → `MustChangePasswordGate` is shown → fills current (temp) and new password → submits → redirected to login.
3. New player logs in with new password → gate NOT shown → normal access.
4. Admin opens player record for the new player → clicks "Enroll in Event" → searches for an event → selects it → confirms → success toast shown.
5. Navigate to Event Control Room → Registrations tab → enrolled player appears with `ADMIN ENROLLED` badge.

- **Acceptance criteria:**
  - [ ] All component tests pass (`vitest run`).
  - [ ] All Playwright scenarios pass against the dev backend.
  - [ ] `axe` checks on `CreatePlayerDialog` and `MustChangePasswordGate` show no violations.
  - [ ] `tsc --noEmit` and lint pass on new test files.

---

#### TASK-215  Security review

- **Owner:** SR | **Risk:** high | **Deps:** TASK-213 | **Status:** [ ]
- **Goal:** Independent security audit of the three new capabilities.
- **Scope:**
  - **Player creation:** Admin authentication on `POST /api/admin/players` (AdminView + step-up); plaintext password never stored or logged (only hashed); audit `after` payload must not contain plaintext password; no timing-based email enumeration in the creation path (returning `VALIDATION_FAILED` with `fields.email` already-exists message is acceptable since this is an admin-only endpoint).
  - **`must_change_password` flag:** Flag is server-side only; client cannot clear it directly (only `PATCH /api/me/password` does so); gate is enforced at the component level AND by the fact that the session is revoked after the change (requiring re-login).
  - **Authenticated password change:** `currentPassword` check prevents account takeover if an admin leaves a logged-in session open; all sessions revoked on success; rate-limited; no PII in error messages.
  - **Admin enrollment:** No IDOR — endpoint is under `AdminView` (admin-only); capacity race handled by `lock_event` (same as cash registration); audit record present; no way for a non-admin to trigger enrollment (URL is admin-prefixed only).
  - **Temporary password communication:** PG does not email the temp password — admin copies it and shares out-of-band. Verify this is documented and no email is sent.
- **Acceptance criteria:**
  - [ ] No high or critical findings open.
  - [ ] Plaintext password absent from all audit records, logs, and API responses.
  - [ ] Step-up enforced on player creation.
  - [ ] `must_change_password` can only be cleared by the authenticated user themselves via `PATCH /api/me/password`.

---

## 4. Dependency summary

```
TASK-201 (User.must_change_password field)
TASK-202 (Registration.payment_method extension) — deps: PLAN-011 TASK-001/002
TASK-203 (create_player service)     — deps: TASK-201
TASK-204 (POST /api/admin/players)   — deps: TASK-203
TASK-205 (PATCH /api/me/password)    — deps: TASK-201
TASK-206 (me_dto update)             — deps: TASK-201
TASK-207 (admin_enroll service)      — deps: TASK-202
TASK-208 (POST .../enroll endpoint)  — deps: TASK-207

TASK-209 (TS types + API methods)    — deps: none (develop against contract)
TASK-210 (CreatePlayerDialog)        — deps: TASK-209
TASK-211 (MustChangePasswordGate)    — deps: TASK-209
TASK-212 (EnrollInEventDialog)       — deps: TASK-209

TASK-213 (Backend tests)             — deps: TASK-204, TASK-205, TASK-208
TASK-214 (Frontend tests + e2e)      — deps: TASK-210, TASK-211, TASK-212
TASK-215 (Security review)           — deps: TASK-213
```

---

## 5. Parallel work opportunities

| Group | Tasks | Can start |
|-------|-------|-----------|
| `model-migration` | TASK-201, TASK-202 | Immediately (independent of each other) |
| `backend-auth` | TASK-203, TASK-205, TASK-206 | After TASK-201 |
| `backend-enroll` | TASK-207 | After TASK-202 |
| `backend-endpoint-create` | TASK-204 | After TASK-203 |
| `backend-endpoint-enroll` | TASK-208 | After TASK-207 |
| `frontend-all` | TASK-209, TASK-210, TASK-211, TASK-212 | TASK-209 immediately; 210–212 after 209 |
| `verification` | TASK-213 (after 204+205+208), TASK-214 (after 210+211+212) | After respective deps |
| `security` | TASK-215 | After TASK-213 |

The backend and frontend can proceed fully in parallel (TASK-209 starts immediately; TS types use `.optional()` guards so they work before the backend ships).

---

## 6. Critical path

```
TASK-201 → TASK-203 → TASK-204 → TASK-213 → TASK-215
```

The slowest sequential chain is: model migration → service → endpoint → backend tests → security review.

---

## 7. Security considerations (summary)

- **Player creation auth:** `AdminView` (re-reads role from DB) + step-up grant (single-use, 5 min). No self-service path to this endpoint.
- **Password confidentiality:** Password is set using Django's `set_password()` (PBKDF2 hash). Never logged, never in audit payload, never in API responses.
- **Forced password change:** `must_change_password` is a server-side flag; the gate is enforced by the app shell (client) **and** implicitly by session revocation after `PATCH /api/me/password` (the user must re-authenticate with the new password).
- **Admin enrollment integrity:** `lock_event` serialises all concurrent capacity modifications; unique constraint on `(event, user, status IN active)` prevents double enrollment; audit record is atomic with the registration write.
- **No email disclosure:** The `POST /api/admin/players` path is admin-only and returns `fields.email` error for duplicates. This is not a privacy concern since admin already has access to the email list.
- **Out-of-band password communication:** PG does not email the temporary password. Admin copies it from the dialog and shares it securely (e.g. WhatsApp, in person). This is noted in the `CreatePlayerDialog` UX ("Share the temporary password with them out of band.").

---

## 8. Rollout

```yaml
rollout:
  migration: true
  feature_flag: false
  order:
    - Apply Django migrations (TASK-201 must_change_password; TASK-202 payment_method extension)
    - Deploy backend (TASK-203 through TASK-208): create_player service, endpoints, admin_enroll service
    - Deploy frontend (TASK-209 through TASK-212): types, dialogs, password gate
  rollback: >
    1. Revert frontend deploy (old frontend ignores new DTO fields; backward-compatible).
    2. Revert backend deploy.
    3. Reverse migrations only if no admin-created users or admin-enrolled registrations exist:
       python manage.py migrate accounts <prev>
       python manage.py migrate registrations <prev>
       If data exists, leave the columns in place and open a follow-up.
```

---

## 9. Risks and mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Admin forgets to share the temp password with the new player | low | `CreatePlayerDialog` has a prominent clipboard-copy button and a reminder toast message; password is shown in the dialog until it is closed |
| Temporary password intercepted if shared over insecure channel | low | Out-of-band channel choice is admin's responsibility; this is documented in the dialog and in the security review |
| `must_change_password` gate bypassed by direct API call | low | Flag is cleared only by `PATCH /api/me/password` (requires correct `currentPassword`); the gate is defence-in-depth UX over the server-side control |
| Admin enrollment used as a backdoor to bypass payment for paid events | medium | Audit record `registration.admin_enrolled` is written for every enrollment; admin-enrolled registrations are visible with a distinct badge in the Control Room |
| Concurrent player-creation and enrollment for the same email | low | `User` table has a unique constraint on `email`; second creator gets `IntegrityError → VALIDATION_FAILED` |
| TASK-202 and PLAN-011 TASK-001/002 merged independently | medium | Coordinate before either is merged — both edit the same `0004_add_payment_method.py` migration and `models.py`; land them in one commit or rebase before applying |

---

## 10. Task summary

| ID | Title | Owner | Effort | Risk | Dependencies |
|----|-------|-------|--------|------|--------------|
| TASK-201 | `User.must_change_password` field + migration | backend-engineer | S | low | — |
| TASK-202 | `Registration.payment_method` extend to `admin_enrolled` | backend-engineer | S | low | PLAN-011 TASK-001/002 |
| TASK-203 | `create_player()` service | backend-engineer | M | high | TASK-201 |
| TASK-204 | `POST /api/admin/players` endpoint | backend-engineer | S | medium | TASK-203 |
| TASK-205 | `PATCH /api/me/password` service + endpoint | backend-engineer | M | medium | TASK-201 |
| TASK-206 | `me_dto` update: add `mustChangePassword` | backend-engineer | S | low | TASK-201 |
| TASK-207 | `admin_enroll()` service | backend-engineer | M | high | TASK-202 |
| TASK-208 | `POST .../registrations/enroll` endpoint + URL | backend-engineer | S | medium | TASK-207 |
| TASK-209 | TypeScript types + API methods | frontend-engineer | S | low | — |
| TASK-210 | `CreatePlayerDialog` component | frontend-engineer | M | medium | TASK-209 |
| TASK-211 | `MustChangePasswordGate` component | frontend-engineer | M | medium | TASK-209 |
| TASK-212 | `EnrollInEventDialog` on player record | frontend-engineer | M | medium | TASK-209 |
| TASK-213 | Backend tests | test-engineer | M | medium | TASK-204, 205, 208 |
| TASK-214 | Frontend tests + Playwright e2e | test-engineer | M | medium | TASK-210, 211, 212 |
| TASK-215 | Security review | security-reviewer | — | high | TASK-213 |

**Total tasks:** 15 (BE 8, FE 4, TE 2, SR 1)  
**Total estimated effort:** 8 × S + 6 × M = 4 days + 6 days = ~10 dev-days (parallelisable to ~4 calendar days with concurrent BE and FE tracks).

**Migration note:** `0004_add_payment_method` (from PLAN-011) was already applied to the dev DB. TASK-202 was implemented as `0005_registration_admin_enrolled` — a new migration that removes the old 2-value constraint and re-adds it with all three values (`razorpay`, `cash`, `admin_enrolled`).
