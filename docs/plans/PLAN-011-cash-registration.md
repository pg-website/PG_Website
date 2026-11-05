---
id: PLAN-011
type: plan
feature_id: FEAT-002
architecture_id: ARCH-002
version: 1
status: ready
date: 2026-11-05
---

# PLAN-011: Cash Registration for Paid Events

Covers FEAT-002 (US-01 to US-05, FR-01 to FR-14, AC-01 to AC-14). Implements the minimum-footprint change
described in ARCH-002: two new DB columns, one new service function, one new API endpoint, DTO extensions,
and a `CashRegisterDialog` frontend component added to the Control Room Registrations tab.

Prerequisite: FEAT-001 control room screens (screen 47 Registrations tab, screen 50 Payments tab, screen 55
global Payments admin) must be deployed. Backend tasks (TASK-001 through TASK-006) are independent of that
frontend work and may proceed in parallel.

---

## 1. Requirements recap

- An admin-only `POST /api/admin/events/{event_id}/registrations/cash` endpoint creates or promotes a
  registration to `confirmed` with `payment_method='cash'`.
- Capacity is enforced identically to the Razorpay path (reuses `lock_event`, `release_expired`,
  `rules.occupied`, `adjust_confirmed`).
- An audit record (`action='registration.cash_registration'`) is written inside the same atomic transaction.
- `Registration` gains two new nullable/defaulted columns: `payment_method` and `cash_registered_by`.
- All existing admin payments and registrations views surface a CASH badge and actor name without a new screen.
- Cash registration is unavailable on free events (server guard + UI suppression).

---

## 2. What exists vs gaps (verified in code)

### Backend gaps
- `Registration` model has no `payment_method` field. The distinction between free, Razorpay-paid, and
  cash-paid confirmations cannot be stored. → **TASK-001** (migration), **TASK-002** (model fields).
- `registrations/services.py` has no `cash_register()` function. → **TASK-003**.
- `adminapi/views_control.py` has no `CashRegistrationView`. → **TASK-004**.
- `adminapi/urls.py` has no `events/<id>/registrations/cash` route. → **TASK-004**.
- `adminapi/control_service.py`: `registration_dto` lacks `paymentMethod`, `actorName`;
  `capabilities()` lacks `canCashRegister`; `list_payments` does not union cash rows. → **TASK-005**.
- `adminapi/ledger_service.py`: `list_ledger` / `payment_rows` do not include cash registrations. → **TASK-005**.

### Frontend gaps
- No `CashRegisterDialog` component exists. The Control Room Registrations tab has no cash-register trigger. → **TASK-007**, **TASK-008**.
- `AdminRegistrationDto` in `control-registrations.ts` has no `paymentMethod` or `actorName` field. → **TASK-006**.
- `AdminPaymentRowDto` / `AdminLedgerRowDto` in `payments.ts` have no `paymentMethod` or `actorName`. → **TASK-006**.
- `adminRegistrationCapabilitiesSchema` has no `canCashRegister` flag. → **TASK-006**.
- No `cashRegisterPlayer()` API method. → **TASK-006**.
- Payments and registrations list components do not render a CASH badge. → **TASK-008**.

---

## 3. Tasks (dependency order)

Status legend: `[ ]` pending. Owner abbreviations: BE = `backend-engineer`, FE = `frontend-engineer`,
TE = `test-engineer`.

---

### Phase B — Backend

#### TASK-001 · Django migration: add payment_method and cash_registered_by

- **Owner:** `backend-engineer`
- **Risk:** low
- **Effort:** S (half day)
- **Dependencies:** none
- **Status:** pending

**Goal:** Add two new columns to `event_registrations`, a DB-level CheckConstraint, and a partial covering
index. This migration is non-blocking in PostgreSQL 14+: adding a column with a constant default and adding a
nullable FK are both fast operations (default stored in catalog; no row rewrite).

**Affected files:**
- `backend/registrations/models.py` (model declarations and Meta — see TASK-002)
- `backend/registrations/migrations/0004_add_payment_method.py` (new migration file)

**Implementation notes:**
- Create migration `0004_add_payment_method.py` via `python manage.py makemigrations registrations`.
- Migration must contain:
  - `AddField`: `payment_method` — `CharField(max_length=10, default='razorpay', choices=[('razorpay','razorpay'),('cash','cash')])`; non-null, non-blank.
  - `AddField`: `cash_registered_by` — `ForeignKey(User, null=True, blank=True, on_delete=SET_NULL, related_name='+')`
  - `AddConstraint`: `CheckConstraint(condition=Q(payment_method__in=['razorpay','cash']), name='reg_payment_method_valid')`
  - `AddIndex`: `Index(fields=['event','payment_method'], condition=Q(payment_method='cash'), name='reg_cash_method_idx')`
- Do NOT touch model code in this task; that is TASK-002. Generate the migration from the model changes in TASK-002 and apply them together (make TASK-002 a prerequisite of running `makemigrations`), or write the migration by hand referencing ARCH-002 §3.1 exactly.
- Confirm migration is reversible (`python manage.py migrate registrations 0003`) with `RemoveField` / `RemoveConstraint` / `RemoveIndex` operations.

**Acceptance criteria:**
- [ ] `python manage.py migrate registrations` succeeds on a clean DB.
- [ ] `python manage.py migrate registrations 0003` rolls back cleanly.
- [ ] `SELECT column_name FROM information_schema.columns WHERE table_name='event_registrations'` lists both new columns.
- [ ] DB-level CheckConstraint rejects `payment_method='stripe'` at the SQL layer (verify with a raw INSERT in a test).
- [ ] Partial index `reg_cash_method_idx` exists and is scoped to `payment_method='cash'` rows only.

**Tests required:**
- Migration rollback test (run forward then backward via Django test runner's `--keepdb` path).
- DB constraint test: attempt to save a `Registration` with an invalid `payment_method` and assert `IntegrityError`.

---

#### TASK-002 · Registration model: payment_method and cash_registered_by fields

- **Owner:** `backend-engineer`
- **Risk:** low
- **Effort:** S (half day)
- **Dependencies:** none (drives TASK-001's migration; can be done first)
- **Status:** pending

**Goal:** Add the two new fields and the new constraint/index entries to the `Registration` model class so the
Django ORM reflects the schema change from TASK-001.

**Affected files:**
- `backend/registrations/models.py`

**Implementation notes:**
- Add at the top of `Registration`:
  ```python
  PAYMENT_METHODS = [('razorpay', 'razorpay'), ('cash', 'cash')]
  ```
- Add after `refund_state`:
  ```python
  payment_method = models.CharField(max_length=10, choices=PAYMENT_METHODS, default='razorpay')
  cash_registered_by = models.ForeignKey(
      User, null=True, blank=True, on_delete=models.SET_NULL, related_name='+',
  )
  ```
- In `class Meta` → `constraints`, append:
  ```python
  models.CheckConstraint(
      condition=Q(payment_method__in=['razorpay', 'cash']),
      name='reg_payment_method_valid',
  ),
  ```
- In `class Meta` → `indexes`, append:
  ```python
  models.Index(
      fields=['event', 'payment_method'],
      condition=Q(payment_method='cash'),
      name='reg_cash_method_idx',
  ),
  ```
- `payment_method` goes after `refund_state` and before `manual_checkin_required` to minimise diff churn.
- Do not add `cash_registered_by` to `ACTIVE` or any existing constant; it is a denormalised attribution field only.

**Acceptance criteria:**
- [ ] `Registration.PAYMENT_METHODS` exists.
- [ ] `reg.payment_method` returns `'razorpay'` for all existing ORM-fetched rows (default applied by migration).
- [ ] `reg.cash_registered_by` is `None` for all existing rows.
- [ ] `reg.payment_method = 'cash'; reg.save()` persists without error.
- [ ] `reg.payment_method = 'invalid'; reg.full_clean()` raises `ValidationError` (choices check).
- [ ] `python manage.py check` passes with no system check errors.

**Tests required:**
- Unit test: instantiate `Registration` with `payment_method='razorpay'` and `'cash'`; assert field values.
- Unit test: `full_clean()` raises `ValidationError` for an invalid method value.

---

#### TASK-003 · cash_register() service function

- **Owner:** `backend-engineer`
- **Risk:** high
- **Effort:** M (1 day)
- **Dependencies:** TASK-002
- **Status:** pending

**Goal:** Implement `cash_register(request, event, player, amount_paise)` in `registrations/services.py`.
This is the core business logic: atomic capacity check, create-or-promote registration, expire dangling orders,
write audit record. Must reuse existing primitives — do not duplicate capacity logic.

**Affected files:**
- `backend/registrations/services.py`

**Implementation notes:**
- Follow ARCH-002 §3.2 exactly (the service pseudocode is authoritative).
- Reuse: `lock_event`, `release_expired`, `rules.occupied`, `rules.active_registration`, `adjust_confirmed`, `_expire_order`.
- Raise `AlreadyRegistered` if `existing.status == 'confirmed'` (FR-06, AC-06).
- Raise `ValidationFailed` if `existing.payment_order_state == 'attempted'` (RISK-002-05; the payment is in-flight; the admin must cancel before cash-registering).
- Capacity check required only for new registrations and waitlist promotions (not for `pending`/`offer` promotions — the seat is already in `occupied`). See ARCH-002 §3.2 capacity table.
- Call `_expire_order(existing)` when `existing.payment_order_state == 'created'` before changing status.
- Call `adjust_confirmed(event.pk, +1)` in all promotion paths (new, pending, offer, waitlist).
- Write audit inside `transaction.atomic()`:
  ```python
  audit.write(
      request,
      action='registration.cash_registration',
      object_type='registration',
      object_id=reg.pk,
      before={'promoted': promoted, 'prevStatus': existing.status if promoted else None},
      after={
          'status': 'confirmed', 'paymentMethod': 'cash',
          'amountPaise': amount_paise,
          'eventId': str(event.pk), 'playerId': str(player.pk),
          'actorName': (request.user.name or '').strip()[:80] or 'Admin',
      },
  )
  ```
- Set `reg.event = event` before returning (so the view can build the DTO without an extra query).
- Add `logger.info(...)` after the atomic block for observability (ARCH-002 §7).
- Caller pre-validates: `event.price_paise > 0`, `event.status not in ('cancelled', 'completed')`, `amount_paise > 0`. Service should re-assert these at entry as a safety net but not duplicate the view-layer error messages.

**Acceptance criteria:**
- [ ] New registration path: creates a `confirmed` `Registration` with `payment_method='cash'` and `cash_registered_by=request.user`.
- [ ] Promote-pending path: existing `pending` row is updated in-place (same `id`); no new row created.
- [ ] Promote-waitlist path: same as pending; capacity check runs.
- [ ] Promote-offer path: same as pending; no capacity check (offer already in `occupied`).
- [ ] `AlreadyRegistered` raised when player is already `confirmed`.
- [ ] `ValidationFailed` raised when `payment_order_state == 'attempted'`.
- [ ] `EventFull` raised when capacity is exhausted (new and waitlist paths only).
- [ ] Audit record written with all required fields inside the same transaction.
- [ ] If audit write fails, the whole transaction rolls back (no partial state).
- [ ] Concurrent identical calls: exactly one succeeds; the other gets `AlreadyRegistered` or `EventFull` (not a DB exception surfaced to the caller unhandled).

**Tests required:**
- Integration tests covering all promotion paths (new, pending, offer, waitlist).
- `AlreadyRegistered`, `EventFull`, `ValidationFailed` error cases.
- Concurrent test: two threads targeting the same last seat — one succeeds, one fails.
- Audit record content assertion (all `after` fields present and correct).

---

#### TASK-004 · CashRegistrationView endpoint and URL

- **Owner:** `backend-engineer`
- **Risk:** medium
- **Effort:** S (half day)
- **Dependencies:** TASK-003
- **Status:** pending

**Goal:** Add `CashRegistrationView` to `adminapi/views_control.py` and register the URL in `adminapi/urls.py`.
The view validates the request body, delegates to `cash_register()`, builds and returns the registration DTO.

**Affected files:**
- `backend/adminapi/views_control.py`
- `backend/adminapi/urls.py`

**Implementation notes:**
- Follow ARCH-002 §3.3 for the view skeleton; the pseudocode is authoritative.
- Inherit from `AdminView` (applies `IsAdmin` permission — role re-read from DB on every request; satisfies FR-08, C-01).
- Wrap the work function in `run_idempotent(request, work)` (idempotency store; a replayed `Idempotency-Key` returns the original 201).
- Body validation order:
  1. Unknown field rejection (consistent with existing `_object_body` pattern in the file).
  2. `playerId`: valid UUID, player exists (or `errors['playerId']`).
  3. `amountPaise`: positive integer (or `errors['amountPaise']`).
  4. Raise `ValidationFailed(fields=errors)` if any errors.
  5. Resolve event via `control_event(event_id)` (raises `EventNotFound` for drafts/unknowns).
  6. Guard: `event.price_paise == 0` → `ValidationFailed` (FR-13, AC-11).
  7. Guard: `event.status in ('cancelled', 'completed')` → `ValidationFailed` (EC-04).
  8. Call `reg_services.cash_register(request, event, player, amount)`.
  9. Build DTO via `registration_dto(...)` (from TASK-005) and return `ok(dto, status=201)`.
- URL entry (append to `urlpatterns` after the existing `registrations/<str:reg_id>/actions` line):
  ```python
  path('events/<str:event_id>/registrations/cash',
       cv.CashRegistrationView.as_view(),
       name='admin-event-cash-registration'),
  ```
- Do not add a player-facing alias; the endpoint lives exclusively under `/api/admin/`.

**Acceptance criteria:**
- [ ] `POST /api/admin/events/{id}/registrations/cash` with valid admin token and body → `201 {ok: true, data: {…}}`.
- [ ] Unauthenticated request → `401`.
- [ ] Player-role token → `403`.
- [ ] Missing/invalid `playerId` → `400 VALIDATION_FAILED`.
- [ ] `amountPaise ≤ 0` or non-integer → `400 VALIDATION_FAILED`.
- [ ] Free event → `400 VALIDATION_FAILED` with explanatory message.
- [ ] Cancelled/completed event → `400 VALIDATION_FAILED`.
- [ ] Unknown `event_id` → `404`.
- [ ] Unknown `playerId` → `400 VALIDATION_FAILED` (or `404` per ARCH-002 error table; must be consistent with existing player-resolution patterns in the file).
- [ ] Replayed `Idempotency-Key` → `201` with the original response (no second DB write).
- [ ] Response includes `paymentMethod: 'cash'` and `actorName` (requires TASK-005).

**Tests required:**
- API integration tests for all HTTP status codes listed above.
- Idempotency replay test.
- Security test: unauthenticated, player token, forged role.

---

#### TASK-005 · DTO and payments view extensions

- **Owner:** `backend-engineer`
- **Risk:** medium
- **Effort:** M (1 day)
- **Dependencies:** TASK-002
- **Status:** pending

**Goal:** Extend `registration_dto`, `capabilities`, `list_payments` (control_service.py) and
`list_ledger` / `payment_rows` (ledger_service.py) to surface `paymentMethod`, `actorName`,
`canCashRegister`, and cash registration rows in the payments views.

**Affected files:**
- `backend/adminapi/control_service.py`
- `backend/adminapi/ledger_service.py`

**Implementation notes:**

**`registration_dto` extension (control_service.py):**
- Add two fields to the returned dict:
  ```python
  'paymentMethod': reg.payment_method,  # 'razorpay' | 'cash'
  'actorName': (reg.cash_registered_by.name or 'Admin')[:80]
               if reg.cash_registered_by_id else None,
  ```
- Select-related `cash_registered_by` in the queryset that feeds `registration_dto` to avoid N+1.

**`capabilities()` extension (control_service.py):**
- Add `canCashRegister` flag:
  ```python
  can_cash = (
      _flag(True)
      if not over and event.price_paise > 0 and eff in ('pending', 'waitlist', 'offer')
      else _flag(False, 'Only pending, waitlisted or offered registrations on paid events can be cash-registered.')
  )
  ```
  where `eff` is the effective status and `over` is `event.status in OVER`.
- Include `'canCashRegister': can_cash` in the capabilities dict.

**`list_payments` extension (control_service.py):**
- Union cash registrations into the paginated payments result. The union must happen at the ORM level
  (before pagination) so that total counts are accurate (RISK-002-02).
- Annotate `Registration.objects.filter(event=event, payment_method='cash')` with the same column shape
  as the existing `PaymentOrder` queryset (use `Value(...)` / `F(...)` annotations to align field names).
- Key discriminating fields: `paymentMethod='cash'`, `actorName`, `paidAt=confirmedAt`, no `providerOrderId`,
  no `providerPaymentId`, `canRefund=False` (with reason "Cash payments are not refunded through the system.").
- Existing Razorpay rows implicitly have `paymentMethod='razorpay'` (add the annotation for parity).

**`list_ledger` / `payment_rows` extension (ledger_service.py):**
- Apply the same union pattern for the global Payments admin screen (screen 55).
- Cash rows get `paymentMethod='cash'`, event context, `actorName`, and `mismatch: {mismatch: false}`.

**Fallback for deleted admin:** If `cash_registered_by_id` is not null but the User row is gone (SET_NULL
would have set it to null, so this scenario shouldn't arise; document the invariant in a comment).
Surface `actorName: 'Deleted admin'` only if `cash_registered_by_id` is not null and the join returns null
(defensive coding; the FK is SET_NULL so the ID will also be null in that case — this is a no-op guard).

**Acceptance criteria:**
- [ ] `registration_dto` output includes `paymentMethod` (`'razorpay'` for existing rows, `'cash'` for cash rows) and `actorName` (`null` unless cash).
- [ ] `capabilities` output includes `canCashRegister: {allowed: true}` for pending/waitlist/offer rows on a paid, non-over event; `{allowed: false, reason: ...}` otherwise.
- [ ] `list_payments` returns cash registrations alongside Razorpay orders; total page count includes cash rows.
- [ ] `list_ledger` returns cash registrations in the global payments screen.
- [ ] No N+1 queries: `cash_registered_by` is fetched via `select_related` or prefetch.
- [ ] `assertNumQueries` for a page with both Razorpay and cash payments does not exceed the baseline + 1.

**Tests required:**
- Integration test: list_payments with one Razorpay and one cash registration — both appear, total=2.
- Integration test: capabilities for each status (pending, waitlist, offer, confirmed, cancelled) on paid vs free event.
- N+1 query count test.

---

### Phase C — Frontend

#### TASK-006 · TypeScript DTO types and API method

- **Owner:** `frontend-engineer`
- **Risk:** low
- **Effort:** S (half day)
- **Dependencies:** none (can start immediately against ARCH-002 contract; wired to real endpoint after TASK-004)
- **Status:** pending

**Goal:** Extend `AdminRegistrationDto`, `adminRegistrationCapabilitiesSchema`, `AdminPaymentRowDto`, and
`AdminLedgerRowDto` with the new fields. Add `cashRegisterPlayer()` API method.

**Affected files:**
- `web/src/lib/api/types/admin/control-registrations.ts`
- `web/src/lib/api/types/admin/payments.ts`
- `web/src/lib/api/pg-api.ts` (or whichever file houses the admin API client methods — confirm location)
- `web/src/lib/api/types/response-schemas.ts` (if the cash registration response needs a new schema entry)

**Implementation notes:**

`control-registrations.ts`:
- Add `paymentMethodSchema = z.enum(['razorpay', 'cash'])` (or reuse from primitives if one exists).
- Extend `adminRegistrationSchema` with:
  ```typescript
  paymentMethod: z.enum(['razorpay', 'cash']).nullable().optional(),
  actorName: plainText(80).nullable().optional(),
  ```
  Use `.nullable().optional()` so existing API responses that do not include the field remain valid
  during the deployment window (backend ships first).
- Extend `adminRegistrationCapabilitiesSchema` with:
  ```typescript
  canCashRegister: capabilityFlagSchema,
  ```
- Add `cashRegisterInputSchema`:
  ```typescript
  export const cashRegisterInputSchema = z.strictObject({
    playerId: uuidSchema,
    amountPaise: z.int().min(1),
  })
  export type CashRegisterInput = z.infer<typeof cashRegisterInputSchema>
  ```

`payments.ts`:
- Add `paymentMethod: z.enum(['razorpay', 'cash']).optional()` and
  `actorName: plainText(80).nullable().optional()` to `ledgerBase`.
- Existing `adminPaymentRowSchema` and `adminLedgerRowSchema` pick up the fields automatically.

API client:
- Add `cashRegisterPlayer(eventId: string, body: CashRegisterInput): Promise<AdminRegistrationDto>` calling
  `POST /api/admin/events/{eventId}/registrations/cash` with `Idempotency-Key` header.
- Follow the same pattern as other admin mutation methods in the file (error handling, response parsing).

**Acceptance criteria:**
- [ ] `AdminRegistrationDto` includes `paymentMethod` and `actorName`.
- [ ] `adminRegistrationCapabilitiesSchema` includes `canCashRegister`.
- [ ] `AdminPaymentRowDto` and `AdminLedgerRowDto` include `paymentMethod` and `actorName`.
- [ ] `cashRegisterPlayer()` method exists and sends `Idempotency-Key`.
- [ ] `tsc --noEmit` passes with no new type errors.
- [ ] Existing snapshot tests or type tests in `admin.test.ts` remain green (additive changes only).

**Tests required:**
- Type-level unit test: parse a mock API response with `paymentMethod: 'cash'` using the updated schema; assert no parse error.
- Existing tests in `web/src/lib/api/types/admin.test.ts` must continue to pass.

---

#### TASK-007 · CashRegisterDialog component

- **Owner:** `frontend-engineer`
- **Risk:** medium
- **Effort:** M (1 day)
- **Dependencies:** TASK-006
- **Status:** pending

**Goal:** Implement `CashRegisterDialog.tsx` in the Control Room Registrations tab feature directory.
The dialog handles player search, amount input, confirmation step, submission, success, and all error states.

**Affected files:**
- `web/src/features/admin/events/control-room/CashRegisterDialog.tsx` (new file)
  *(confirm exact directory by locating the RegistrationsTab component in the codebase; the architecture
  names `controlroom/` and `control-room/` — use whichever exists)*

**Implementation notes:**

Dialog flow (FR-10, AC-14, §5.1 of ARCH-002):
1. **Trigger:** Toolbar button "Register with cash". Hidden (not just disabled) when `event.pricePaise === 0`
   or `event.status` is `'cancelled'` or `'completed'` (FR-13, EC-04). Use `canCashRegister` from the
   row capability only for per-row actions; the toolbar button is event-level.
2. **Player search:** Text input → `GET /api/admin/players?q=...` (existing endpoint, no new backend
   required). Show player name, email, existing registration status. Debounce with `useDeferredValue` or
   a debounced value (consistent with `PlayersAdminPage` pattern).
3. **Amount field:** Numeric input (rupees), pre-populated with `event.pricePaise / 100` (integer divide —
   whole rupees; display paise component if non-zero per A-03). Admin may edit (FR-11). Value must be
   `> 0` and a valid positive number (AC-10). Convert to paise server-side: send `amountPaise =
   Math.round(rupees * 100)`.
4. **Confirmation step:** Show player name, event name, published entry fee, and entered amount side by side
   so the admin can review discrepancies (FR-10, EC-03). Confirm button disabled during loading (AC-14).
5. **Submit:** Call `api.admin.cashRegisterPlayer(eventId, {playerId, amountPaise})`. On success: close
   dialog, invalidate/refetch the registrations query, show a success toast. On failure: display error
   message inside dialog (do not close), preserve entered amount, re-enable Confirm (AC-14, EC-01).
6. **Validation (AC-10):** Amount `≤ 0` or non-numeric → Confirm disabled + inline error. No player
   selected → Confirm disabled. Never fire the API call with invalid input.

React best-practices compliance:
- Do not define sub-components inside `CashRegisterDialog` (rule 5.4 — no components inside components).
- Use functional `setState` updates where the new state depends on previous state (rule 5.11).
- Use `useTransition` for the async submit (rule 6.11) — provides `isPending` state and prevents double-submit.
- Pre-populate the amount field with lazy state init (rule 5.12): `useState(() => event.pricePaise / 100)`.
- Keep the dialog content memoized if it is conditionally mounted and re-open is frequent (rule 5.6).

**Acceptance criteria:**
- [ ] Dialog toolbar button is absent for free events (`pricePaise === 0`).
- [ ] Player search shows name, email, and current registration status.
- [ ] Amount field defaults to published entry fee; admin can override.
- [ ] Confirmation step shows both published fee and entered amount.
- [ ] Confirm disabled while loading; loading indicator visible.
- [ ] On success: dialog closes, registrations list refreshes, new CASH-labelled row appears.
- [ ] On failure: error shown inside dialog; amount preserved; Confirm re-enabled.
- [ ] `tsc --noEmit` and lint pass.
- [ ] No components defined inside the component (rule 5.4).

**Tests required:**
- Component unit test: amount validation — `0`, negative, non-numeric → button disabled + error visible.
- Component unit test: free-event prop → toolbar button absent.
- Component unit test: success path → mock API resolves → dialog closes, success callback fired.
- Component unit test: error path → mock API rejects → error shown, amount preserved.
- Playwright e2e (created in TASK-010): open dialog, enter player and amount, confirm, assert CASH row appears.

---

#### TASK-008 · CASH badge and actor attribution in list views

- **Owner:** `frontend-engineer`
- **Risk:** low
- **Effort:** S (half day)
- **Dependencies:** TASK-006
- **Status:** pending

**Goal:** Render the CASH badge and `actorName` attribution in the Control Room Registrations tab, the
Control Room Payments tab, and the Global Payments admin screen. No new screen is introduced (C-06).

**Affected files:**
- Control Room Registrations list component (wherever `AdminRegistrationDto` is rendered — find by searching
  for `adminRegistrationSchema` or the list column definitions).
- Control Room Payments tab list component (wherever `AdminPaymentRowDto` is rendered).
- Global Payments admin screen (wherever `AdminLedgerRowDto` is rendered —
  `web/src/features/admin/payments/payments-columns.tsx` and `PaymentsAdminPage.tsx`).
- Optionally: a shared `PaymentMethodBadge` or `CashBadge` component if it doesn't already exist.

**Implementation notes:**
- When `paymentMethod === 'cash'`:
  - Registrations tab: show a `CASH` badge in the status/payment column, visually distinct from the
    Razorpay "Paid" chip and the free "Free" state.
  - Payments tabs: show CASH badge; suppress `providerOrderId`/`providerPaymentId` columns (they will be
    null/absent); show `actorName` as "By <name>" in the actor column.
- Badge style: use an existing badge design token (neutral/accent colour). Do not introduce a new colour token.
  Use Tailwind classes consistent with the codebase's badge pattern (reference `RefundAction.tsx` for
  an existing badge example).
- Explicit conditional rendering (`count > 0 ? ... : null` pattern, not `&&` with a truthy check on the
  string) to avoid rendering `"0"` or `"false"` artefacts (rule 6.9).

**Acceptance criteria:**
- [ ] `paymentMethod === 'cash'` → CASH badge visible in all three admin list views.
- [ ] `paymentMethod === 'razorpay'` → no CASH badge (Razorpay-specific chips remain unchanged).
- [ ] `actorName` displayed in the payments tab rows as "By <name>".
- [ ] Free-event confirmation rows (if `paymentMethod` is `null` or `'razorpay'` with `amountPaise === 0`) unaffected.
- [ ] `tsc --noEmit` and lint pass.
- [ ] No new colour tokens introduced; badge uses existing design system.

**Tests required:**
- Component unit test: render a row with `paymentMethod: 'cash'` → CASH badge present.
- Component unit test: render a row with `paymentMethod: 'razorpay'` → no CASH badge.
- Playwright e2e (TASK-010): navigate to Payments tab after cash registration → CASH badge and actor name visible.

---

### Phase D — Verification

#### TASK-009 · Backend tests

- **Owner:** `test-engineer`
- **Risk:** medium
- **Effort:** M (1 day)
- **Dependencies:** TASK-004, TASK-005
- **Status:** pending

**Goal:** Cover all backend acceptance criteria with Django integration tests. Locate or create the test
module for `adminapi` control-room views (check `backend/adminapi/tests/` or `backend/tests/`).

**Affected files:**
- `backend/registrations/tests/test_cash_register.py` (new file)
- `backend/adminapi/tests/test_cash_registration_view.py` (new file, or extend existing control-room test file)

**Tests to write:**

*Service-level (test_cash_register.py):*
- New registration path (AC-01): creates confirmed row with `payment_method='cash'` and correct `amount_paise`.
- Promote-pending path (AC-04): same `id` before and after; status=`confirmed`; no duplicate row.
- Promote-waitlist path (AC-05): same behaviour; capacity check runs and fails when full.
- Promote-offer path (AC-05): same behaviour; no capacity check (offer already in `occupied`).
- `AlreadyRegistered` when player already confirmed (AC-06).
- `EventFull` when capacity exhausted for new and waitlist paths (AC-03).
- `ValidationFailed` when `payment_order_state='attempted'` (RISK-002-05).
- Dangling `payment_order_state='created'` is expired before promotion.
- Audit record content: all `after` fields present and correct (AC-02); timestamp within 2 seconds.
- Audit failure rolls back registration (FR-09, C-05): mock `audit.write` to raise → assert no Registration change.
- Concurrent test (AC-13): two threads targeting last seat — one succeeds, one gets `EventFull` or `AlreadyRegistered`; no duplicates.

*View-level (test_cash_registration_view.py):*
- Unauthenticated → 401 (AC-12).
- Player-role token → 403 (AC-12).
- Valid admin token + valid body → 201; response includes `paymentMethod: 'cash'`, `actorName` (AC-01).
- `playerId` missing → 400 VALIDATION_FAILED.
- `amountPaise ≤ 0` → 400 VALIDATION_FAILED (AC-10).
- Free event → 400 VALIDATION_FAILED (AC-11).
- Cancelled/completed event → 400 VALIDATION_FAILED (EC-04).
- Unknown event_id → 404.
- Unknown playerId → 400 VALIDATION_FAILED.
- Idempotency replay: second request with same key → 201, no second DB write.
- `list_payments` with both Razorpay and cash payments → both appear; total count is 2 (RISK-002-02).
- `list_ledger` includes cash rows (global payments screen).
- `capabilities` canCashRegister=true for pending/waitlist/offer on paid event; false for confirmed/cancelled and for free events.

**Acceptance criteria:**
- [ ] All test cases above pass in CI (`pytest backend/ -x`).
- [ ] No real secrets or PII in fixtures.
- [ ] `assertNumQueries` for `list_payments` page with mixed Razorpay+cash rows does not exceed baseline +1 (N+1 guard).

---

#### TASK-010 · Frontend tests and Playwright e2e

- **Owner:** `test-engineer`
- **Risk:** medium
- **Effort:** M (1 day)
- **Dependencies:** TASK-007, TASK-008
- **Status:** pending

**Goal:** Component tests for `CashRegisterDialog` and CASH badge; Playwright e2e for the full admin flow
(open dialog → enter player and amount → confirm → CASH row appears → payments tab shows CASH badge and actor).

**Affected files:**
- `web/src/features/admin/events/control-room/CashRegisterDialog.test.tsx` (new)
- `web/src/features/admin/payments/PaymentsAdminPage.test.tsx` (extend)
- `web/src/tests/e2e/cash-registration.spec.ts` (new, or extend existing admin e2e suite)

**Tests to write:**

*Component tests (Vitest + Testing Library):*
- `CashRegisterDialog`: amount=0 → Confirm disabled + error visible (AC-10).
- `CashRegisterDialog`: negative amount → same.
- `CashRegisterDialog`: non-numeric input → same.
- `CashRegisterDialog`: no player selected → Confirm disabled.
- `CashRegisterDialog`: free-event prop → toolbar button absent (AC-11).
- `CashRegisterDialog`: success response → `onSuccess` callback called; dialog in closed state.
- `CashRegisterDialog`: error response → error message shown; amount preserved (AC-14).
- `CashRegisterDialog`: loading state → Confirm disabled; loading indicator present (AC-14).
- CASH badge component (or column): `paymentMethod='cash'` → badge rendered.
- CASH badge component: `paymentMethod='razorpay'` → badge absent.

*Playwright e2e (against Django dev backend; no new mocks per codebase conventions):*
- **Happy path (AC-01, AC-07, AC-08):**
  1. Admin logs in, navigates to Control Room → Registrations tab for a paid event with capacity.
  2. Clicks "Register with cash".
  3. Searches for a player with no existing registration.
  4. Amount pre-filled with event entry fee; admin confirms.
  5. Dialog closes; registrations list shows new CASH-labelled confirmed row.
  6. Navigate to Payments tab → cash entry shows CASH badge, actor name, and correct amount.
- **Capacity full (AC-03):** Pre-fill event to capacity; attempt cash registration → error in dialog.
- **Already confirmed (AC-06):** Player already confirmed → error in dialog.
- **Free event (AC-11):** Navigate to free-event control room → "Register with cash" button absent.
- **Validation (AC-10):** Enter `0` in amount field → Confirm button remains disabled.
- **Delayed response / loading (AC-14):** Mock a delayed response; assert button is disabled with loading
  indicator while request is in-flight.

**Acceptance criteria:**
- [ ] All component tests pass (`vitest run`).
- [ ] All Playwright scenarios pass against the dev backend.
- [ ] `axe` accessibility check on the open dialog reveals no violations.
- [ ] `tsc --noEmit` and lint pass on new test files.

---

## 4. Dependency summary

```
TASK-001 (migration)   ← independent
TASK-002 (model)       ← independent (drives TASK-001)
TASK-003 (service)     ← TASK-002
TASK-004 (endpoint)    ← TASK-003
TASK-005 (DTOs)        ← TASK-002

TASK-006 (TS types)    ← independent
TASK-007 (dialog)      ← TASK-006
TASK-008 (badge)       ← TASK-006

TASK-009 (BE tests)    ← TASK-004, TASK-005
TASK-010 (FE tests)    ← TASK-007, TASK-008
```

The backend and frontend phases are fully independent until integration testing (TASK-009, TASK-010).

---

## 5. Critical path

```
TASK-002 → TASK-003 → TASK-004 → TASK-009
```

The critical path is the backend service → endpoint → test chain. The model (TASK-002) gates the
service (TASK-003), which gates the endpoint (TASK-004), which gates backend verification (TASK-009).
The migration (TASK-001) must be applied before TASK-009 runs against a real DB, but the code for TASK-002
through TASK-005 can be written and reviewed before the migration is applied.

---

## 6. Parallel work opportunities

| Group | Tasks | Can start |
|-------|-------|-----------|
| `backend-model` | TASK-001, TASK-002 | Immediately (independent) |
| `backend-service-dto` | TASK-003 (after 002), TASK-005 (after 002) | After TASK-002 |
| `frontend-all` | TASK-006, TASK-007 (after 006), TASK-008 (after 006) | Immediately |
| `verification` | TASK-009 (after 004+005), TASK-010 (after 007+008) | After respective deps |

Frontend (TASK-006 through TASK-008) can be developed, reviewed, and merged before the backend ships,
as long as the new DTO fields use `.optional()` / `.nullable()` so that existing API responses remain valid.

---

## 7. Rollout

```yaml
rollout:
  migration: true
  feature_flag: false
  order:
    - Apply Django migration (TASK-001): python manage.py migrate registrations
    - Deploy backend (TASK-002 through TASK-005)
    - Deploy frontend (TASK-006 through TASK-008)
  rollback: >
    1. Revert frontend deploy (old frontend ignores the new DTO fields — backward-compatible).
    2. Revert backend deploy (old code uses DEFAULT 'razorpay' and ignores the new columns — backward-compatible).
    3. Reverse migration only if no cash registrations have been created:
       python manage.py migrate registrations 0003
       If cash registrations exist, leave the columns in place (they carry data) and open a follow-up
       to decide whether to delete or archive those records before reversing.
```

---

## 8. Security considerations (summary)

- **Auth:** `IsAdmin` on `AdminView` re-reads role from DB on every request. No middleware-only trust (FR-08, C-01).
- **Capacity race:** `SELECT ... FOR UPDATE` on Event row (`lock_event`) serialises all concurrent modifications — identical to Razorpay path (C-02, AC-13).
- **Duplicate guard:** `reg_one_active_per_user_event` unique constraint + `AlreadyRegistered` service guard.
- **Input:** `amountPaise` validated as positive integer server-side regardless of UI (C-03). Free event and event-status guards are server-side (AC-11, EC-04).
- **Audit atomicity:** `audit.write()` inside `transaction.atomic()`; audit failure rolls back the whole transaction (C-05, FR-09).
- **No player-facing path:** endpoint under `/api/admin/`; no public route alias.

---

## 9. Risks and mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| RISK-002-01: simultaneous cash-register and promote collide on the same registration | low | Event row lock + unique constraint; second request gets `AlreadyRegistered` |
| RISK-002-02: cash rows not counted before pagination → wrong totals in payments view | medium | Union at ORM level before paginator; test with mixed fixture (TASK-009) |
| RISK-002-03: actor name lost when admin is deleted | low | SET_NULL + `'Deleted admin'` fallback in DTO; audit log retains immutable actor_id |
| RISK-002-04: free-event cash registration via direct API (UI hides button, but API not guarded alone) | low | Service-level guard: `event.price_paise > 0`; API test (TASK-009) |
| RISK-002-05: pending registration with in-flight Razorpay payment (`attempted` state) cash-registered | medium | Service raises `ValidationFailed` for `payment_order_state='attempted'`; admin must cancel first |

---

## 10. Schema conformance

Checked against `schemas/plan.schema.yaml` on 2026-11-05.

| Schema property | Value | Result |
|---|---|---|
| `id` (pattern `^PLAN-[0-9]{3,}$`) | PLAN-011 | Pass |
| `type` (const `plan`) | plan | Pass |
| `feature_id` (pattern `^FEAT-[0-9]{3,}$`) | FEAT-002 | Pass |
| `architecture_id` (pattern `^ARCH-[0-9]{3,}$`) | ARCH-002 | Pass |
| `version` (integer ≥ 1) | 1 | Pass |
| `status` (enum: draft/ready/approved/blocked) | ready | Pass |
| `tasks` (array, minItems 1; each has id, title, owner, status) | 10 tasks; all have required fields | Pass |
| Each task `id` (pattern `^TASK-[0-9]{3,}$`) | TASK-001 to TASK-010 | Pass |
| Each task `owner` (enum) | backend-engineer, frontend-engineer, test-engineer | Pass |
| Each task `status` (enum) | pending | Pass |
| `critical_path` (array of strings) | Present | Pass |
| `rollout` (object with migration, feature_flag, rollback) | Present | Pass |

---

## 11. Task summary

| ID | Title | Owner | Effort | Risk | Dependencies |
|----|-------|-------|--------|------|--------------|
| TASK-001 | Django migration: payment_method + cash_registered_by | backend-engineer | S | low | — |
| TASK-002 | Registration model: new fields + constraint + index | backend-engineer | S | low | — |
| TASK-003 | cash_register() service function | backend-engineer | M | high | TASK-002 |
| TASK-004 | CashRegistrationView endpoint and URL | backend-engineer | S | medium | TASK-003 |
| TASK-005 | DTO and payments view extensions | backend-engineer | M | medium | TASK-002 |
| TASK-006 | TypeScript DTO types and API method | frontend-engineer | S | low | — |
| TASK-007 | CashRegisterDialog component | frontend-engineer | M | medium | TASK-006 |
| TASK-008 | CASH badge and actor attribution in list views | frontend-engineer | S | low | TASK-006 |
| TASK-009 | Backend tests | test-engineer | M | medium | TASK-004, TASK-005 |
| TASK-010 | Frontend tests and Playwright e2e | test-engineer | M | medium | TASK-007, TASK-008 |

**Total tasks:** 10 (BE 4, FE 3, TE 2 + 1 migration/model split = 4 BE total)
**Total effort:** 5 × S + 5 × M = 2.5 days + 5 days = ~7.5 dev-days (parallelisable to ~3 calendar days with concurrent BE and FE tracks).
