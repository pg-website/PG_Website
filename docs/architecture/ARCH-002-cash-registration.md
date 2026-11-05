---
id: ARCH-002
type: architecture
feature_id: FEAT-002
version: 1
status: ready
title: "Cash Registration for Paid Events"

context: >
  Pawn's Gambit (pgchess.in) hosts physical chess tournaments. At in-person events, some players pay entry fees
  in cash at the venue desk. The existing registration path requires a completed Razorpay transaction to reach
  `confirmed` status; there is no admin path to register a player as confirmed with cash payment. Admins currently
  use error-prone workarounds (zeroing the entry fee, direct DB edits) that bypass capacity checks, leave no
  audit trail, and require developer involvement.

current_state: >
  The `Registration` model (event_registrations table) tracks payment state via `payment_order_state` (none,
  created, attempted, paid, failed, expired, refunded) and `amount_paise`. To reach `confirmed`, a registration
  must go through the Razorpay payment webhook path (`payment_order_state = 'paid'`). There is no field
  distinguishing between a free-event confirmation (`amount_paise = 0, payment_order_state = 'none'`) and a
  cash-paid confirmation. The admin control room (views_control.py) supports registration actions (cancel,
  move_to_waitlist, promote, mark_welcomed, set_pairing_active) but no direct cash-to-confirmed path. The
  audit log (`audit_log` table) is append-only and already supports arbitrary `action` strings. The capacity
  enforcement pattern (`lock_event` → `release_expired` → capacity check → `adjust_confirmed`) is encapsulated
  in `registrations/services.py` and must not be duplicated.

proposed_solution: >
  Add a single new admin endpoint `POST /api/admin/events/{event_id}/registrations/cash` that creates or
  promotes a registration to `confirmed` with `payment_method='cash'` in a single atomic transaction, enforcing
  capacity identically to the Razorpay path. The Registration model gains two new nullable columns:
  `payment_method` (varchar, choices razorpay|cash, default razorpay) and `cash_registered_by` (FK to User,
  SET_NULL). A new service function `cash_register()` in `registrations/services.py` holds the business logic
  and reuses `lock_event`, `release_expired`, `rules.occupied`, and `adjust_confirmed`. The view lives in
  `adminapi/views_control.py` and uses the existing `AdminView` base (IsAdmin permission, Bearer token,
  role re-read from DB). An audit record (`action='registration.cash_registration'`) is written inside the
  same transaction. The existing `registration_dto` and `list_payments` helpers in `control_service.py` are
  extended to surface `paymentMethod` and `actorName`. The frontend adds a `CashRegisterDialog` component in
  the existing Control Room Registrations tab toolbar; no new screen is introduced.

components:
  - id: COMP-B04-cash-service
    name: "Cash registration service function"
    responsibility: >
      `registrations.services.cash_register(request, event, player, amount_paise)` — atomically creates or
      promotes a registration to confirmed with payment_method='cash'. Reuses lock_event, release_expired,
      rules.occupied, adjust_confirmed, and _expire_order. Writes the audit record inside the same
      transaction.
    changes:
      - "New function `cash_register` in backend/registrations/services.py"
      - "Reuses existing primitives: lock_event, release_expired, adjust_confirmed, _expire_order"

  - id: COMP-B07-cash-view
    name: "Cash registration view and URL"
    responsibility: >
      `adminapi.views_control.CashRegistrationView` — POST handler that validates the request body, resolves
      the player, delegates to `cash_register`, and returns a full registration DTO. Registered at
      `events/<str:event_id>/registrations/cash` in adminapi/urls.py.
    changes:
      - "New class CashRegistrationView in backend/adminapi/views_control.py"
      - "New URL entry in backend/adminapi/urls.py"

  - id: COMP-B07-dto-changes
    name: "Registration and payments DTO extensions"
    responsibility: >
      `control_service.registration_dto` gains a `paymentMethod` field (razorpay|cash|null) and an
      `actorName` field (null unless cash). `control_service.list_payments` and `ledger_service.list_ledger`
      are extended to include cash-paid registrations alongside Razorpay orders, using a discriminated DTO
      shape (paymentMethod field present, no providerOrderId/providerPaymentId). `capabilities()` gains a
      `canCashRegister` flag for eligible rows.
    changes:
      - "registration_dto: add paymentMethod, actorName"
      - "capabilities: add canCashRegister flag"
      - "list_payments: union in cash registrations with payment_method='cash'"
      - "ledger_service.list_ledger: union in cash registrations"

  - id: COMP-B04-model-migration
    name: "Registration model migration"
    responsibility: >
      Adds `payment_method` (VARCHAR, choices razorpay|cash, default razorpay, NOT NULL) and
      `cash_registered_by_id` (FK → auth_user, nullable, SET_NULL) to the event_registrations table.
      Adds a DB-level CheckConstraint and a covering index on (event_id, payment_method).
    changes:
      - "New column payment_method on event_registrations"
      - "New FK column cash_registered_by_id on event_registrations"
      - "New CheckConstraint reg_payment_method_valid"
      - "New index reg_cash_method_idx on (event_id, payment_method)"

  - id: COMP-FE-cash-dialog
    name: "CashRegisterDialog frontend component"
    responsibility: >
      React component in web/src/features/admin/events/controlroom/. Renders a toolbar button on the
      Registrations tab (hidden on free events). Opens a modal with player search, amount input pre-filled
      with event.pricePaise/100, and a confirmation step showing player name, event name, published fee and
      entered amount. Calls the new endpoint, disables Confirm on submit, shows inline errors on failure,
      closes and refreshes the registrations list on success. CASH badge applied via existing badge tokens.
    changes:
      - "New component CashRegisterDialog.tsx in web/src/features/admin/events/controlroom/"
      - "CASH badge variant in existing badge component (or inline Tailwind class)"
      - "paymentMethod field added to AdminRegistrationDto TypeScript type"

data_changes:
  - type: migration
    name: "Add payment_method to event_registrations"
    description: >
      ALTER TABLE event_registrations ADD COLUMN payment_method VARCHAR(10) NOT NULL DEFAULT 'razorpay'.
      All existing rows receive 'razorpay' as the default — no row-by-row backfill required because the
      default covers all historical data (every past confirmed registration was via Razorpay or free; free
      events continue to use 'razorpay' as the method value since cash is never applicable). The Django
      migration uses `default='razorpay'` and sets `blank=False` to prevent future writes without a value.

  - type: migration
    name: "Add cash_registered_by FK to event_registrations"
    description: >
      ALTER TABLE event_registrations ADD COLUMN cash_registered_by_id UUID REFERENCES auth_user(id)
      ON DELETE SET NULL. Nullable; populated only when payment_method='cash'. Stores the admin User who
      performed the cash registration so that the payments view can display actor name without joining the
      audit log.

  - type: migration
    name: "Add CheckConstraint reg_payment_method_valid"
    description: >
      CHECK (payment_method IN ('razorpay', 'cash')). Enforced at DB level in addition to Django choices,
      consistent with the existing constraint pattern on the Registration model (reg_status_valid,
      reg_order_state_valid).

  - type: index
    name: "reg_cash_method_idx on (event_id, payment_method)"
    description: >
      Partial covering index to support the payments view query that unions cash registrations alongside
      PaymentOrder rows. Because cash registrations will be rare (a small fraction of all rows), a partial
      index WHERE payment_method = 'cash' is preferable; this avoids bloating the main event_status index.
      Django migration: models.Index(fields=['event', 'payment_method'], condition=Q(payment_method='cash'),
      name='reg_cash_method_idx').

apis:
  - method: POST
    path: /api/admin/events/{event_id}/registrations/cash
    purpose: >
      Create a confirmed cash registration for a player on a paid event, or promote their existing
      pending/waitlist/offer registration to confirmed. Idempotent when called with the same
      Idempotency-Key (run_idempotent, replay returns the original 201).
    authentication: "Bearer access token; admin role required; role re-read from DB (IsAdmin). No middleware-only trust."
    request:
      content_type: application/json
      body:
        playerId:
          type: string
          format: uuid
          required: true
          description: UUID of the User account to register. Must already exist.
        amountPaise:
          type: integer
          minimum: 1
          required: true
          description: Amount collected in paise (admin UI converts from rupees). Must be > 0.
      example:
        playerId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        amountPaise: 50000
    response:
      status: 201
      envelope: "{ok: true, data: AdminRegistrationDto}"
      dto_fields:
        id: registration UUID
        playerId: player UUID
        name: player display name
        email: player email (admin-only)
        phone: player phone (admin-only, nullable)
        status: "confirmed"
        paymentMethod: "cash"
        amountPaise: amount stored in paise
        confirmedAt: ISO-8601 UTC timestamp
        actorName: display name of the admin who performed the action
        paymentState: "null (no Razorpay order)"
        capabilities: updated CanDoMap for the registration
        version: optimistic concurrency token
    error_codes:
      VALIDATION_FAILED:
        status: 400
        cases:
          - "playerId is missing, not a valid UUID, or the player does not exist"
          - "amountPaise is missing, not an integer, or ≤ 0"
          - "Event is free (price_paise = 0) — FR-13, AC-11"
          - "Event status is cancelled or completed — EC-04"
      AUTH_REQUIRED:
        status: 401
        cases: ["No Bearer token"]
      ADMIN_REQUIRED:
        status: 403
        cases: ["Authenticated but role ≠ admin or account suspended"]
      EVENT_NOT_FOUND:
        status: 404
        cases: ["event_id does not resolve to a non-draft event"]
      PLAYER_NOT_FOUND:
        status: 404
        cases: ["playerId does not resolve to a known user"]
      EVENT_FULL:
        status: 409
        cases: ["Event is at capacity (occupied ≥ capacity) — FR-07, AC-03"]
      ALREADY_CONFIRMED:
        status: 409
        cases: ["Player already has a confirmed registration on this event — FR-06, AC-06"]

security:
  authentication: >
    Every request must carry a valid Bearer access token. `IsAdmin` permission class re-reads the user's
    role from the database on every request (not from the token claim). A demoted admin is rejected
    immediately. Consistent with ARCH-001 section 2.5 and constraint C-01 of FEAT-002.
  authorization: >
    Admin-only: `role == 'admin'` and `status != 'suspended'`. The check is performed inside the view
    handler (not in middleware alone), satisfying FR-08 and C-01. No player-facing path exists or is
    added. The endpoint is under `/api/admin/` which the Vercel rewrite proxies to Railway; there is no
    public route alias.
  threats:
    - "Capacity race: two concurrent admins cash-registering the same last seat simultaneously"
    - "Duplicate registration: same player cash-registered twice in rapid succession (double-click, retry)"
    - "Unauthorized access: attacker forges or replays a valid token with admin role"
    - "Free-event bypass: attacker sends a cash registration for a free event"
    - "Amount manipulation: attacker sends amountPaise=0 or a negative value"
    - "Event-status bypass: cash-registering on a cancelled or completed event"
  mitigations:
    - >
      Capacity race: mitigated by `select_for_update` on the Event row (`lock_event`) before all capacity
      checks and writes, identical to the Razorpay path. Only one transaction can hold the lock; the
      losing transaction sees the incremented confirmed_count and gets EVENT_FULL (AC-13, C-02).
    - >
      Duplicate registration: mitigated by the existing unique DB constraint
      `reg_one_active_per_user_event` (condition: status IN active set) and by the ALREADY_CONFIRMED
      guard in the service. A second concurrent request hits either the guard or the IntegrityError,
      which is caught and surfaced as ALREADY_CONFIRMED (AC-06, AC-13).
    - >
      Unauthorized access: IsAdmin re-reads role from DB; short-lived access tokens; rotating refresh
      tokens with reuse detection (ARCH-001 §2.5). No token forgery yields an admin role without DB
      write access.
    - >
      Free-event bypass: service checks `event.price_paise > 0` before creating or promoting; returns
      VALIDATION_FAILED if the event is free (AC-11).
    - >
      Amount manipulation: view validates `amountPaise` is an integer ≥ 1 before calling the service.
      Server receives the paise value; the UI converts rupees to paise locally but the server validates
      the final value regardless (C-03).
    - >
      Event-status bypass: service checks `event.status not in ('cancelled', 'completed')` before any
      write (EC-04).

observability:
  logs:
    - "Existing request_id propagation covers every admin request including cash registration"
    - "audit_log row: action=registration.cash_registration, object_type=registration, object_id=<reg_uuid>, actor=<admin_user>, after={status,amountPaise,paymentMethod,eventId,playerId} — written inside the transaction"
    - "Django application log line at INFO: pg.registrations cash_register event=<slug> player=<uuid> amount=<paise> promoted=<bool>"
  metrics:
    - "No new metric required; cash registrations appear in the existing confirmed_count per event"
    - "If the payments monitoring is extended, cash registrations can be tagged by paymentMethod='cash' on the registration row"
  traces:
    - "meta.request_id on the response equals the X-Request-ID header; covers the new endpoint without change"

performance:
  expected_load: >
    Cash registrations are an infrequent admin action (a few per event day, never bulk). No special
    caching or batching is required. The atomic lock on the Event row is the same as the Razorpay
    confirm path and resolves in milliseconds.
  latency_requirements: >
    Single DB round-trip under a row lock; response within 500 ms on Railway Singapore. No async work
    is needed; there is no email notification for cash registrations (the admin is physically present
    and confirmation is visual in the UI).
  scalability: >
    The endpoint participates in the same stateless Railway API scaling as every other admin endpoint.
    No additional infrastructure is required.

migration:
  required: true
  strategy: >
    1. Apply Django migration (addField payment_method DEFAULT 'razorpay' NOT NULL, addField
       cash_registered_by_id NULL, addConstraint, addIndex). The migration is non-blocking: adding a
       column with a constant default and adding a nullable FK column are both fast in PostgreSQL 14+
       without a full table rewrite (the default is stored in the catalog, not backfilled row-by-row).
    2. Deploy backend with the new service, view, and URL.
    3. Deploy frontend with the CashRegisterDialog component.
    4. No downtime or feature flag required; the new endpoint is additive and existing flows are
       unchanged.
  rollback: >
    Revert backend deploy (old code ignores the new columns). Revert frontend deploy. The new columns
    are nullable/defaulted and do not break the previous codebase. The migration can be reversed with
    RemoveField if needed; no cash registrations will exist yet if rollback is immediate.

risks:
  - id: RISK-002-01
    description: >
      Capacity double-spend: a waitlisted player is cash-registered to confirmed at the same moment
      another admin promotes them via the existing `promote` action (offer_registration). Both paths
      hold the event lock sequentially, so the second transaction sees the new confirmed_count and either
      confirms an offer (which is not a problem — the registration is already confirmed by cash, so the
      unique constraint fires as ALREADY_CONFIRMED) or the promote action sees `eff != 'waitlist'` and
      raises a validation error.
    severity: low
    mitigation: >
      The existing unique constraint `reg_one_active_per_user_event` and the event row lock make
      simultaneous promotion and cash-registration safe. The service must re-read the registration status
      inside the locked transaction (not from the view layer) to detect the race.

  - id: RISK-002-02
    description: >
      DTO divergence: the payments views (list_payments, list_ledger) currently union PaymentOrder rows
      only. If the union of cash registrations is added incorrectly (e.g., wrong ordering, wrong
      pagination), the page counts or sort order may be wrong.
    severity: medium
    mitigation: >
      The list_payments and list_ledger changes must add cash registrations to the queryset at the same
      ORM level (not post-pagination) so that the paginator counts them. Use a Django union queryset or
      a VALUES / annotate approach. Test with a fixture that has both Razorpay and cash payments on the
      same event.

  - id: RISK-002-03
    description: >
      Actor attribution lost: if the `cash_registered_by` FK is set to NULL by a cascade when the
      admin account is deleted, the payments view loses the actor name and shows null.
    severity: low
    mitigation: >
      SET_NULL is intentional (soft delete of admin; audit log retains the actor_id immutably). The
      payments DTO should display the actor name from `cash_registered_by.name` with a fallback to
      "Deleted admin" or the audit log display_name if the FK is null.

  - id: RISK-002-04
    description: >
      Free-event cash registration attempted via direct API call (bypassing the UI which hides the
      button). The server must reject it; the UI alone is not a sufficient guard.
    severity: low
    mitigation: >
      Service-level guard: `if event.price_paise == 0: raise ValidationFailed(...)`. Covered by AC-11
      acceptance test.

  - id: RISK-002-05
    description: >
      A `pending` registration whose Razorpay order state is 'created' or 'attempted' is cash-registered.
      The PaymentOrder row in the payments app would remain 'created', creating a dangling order.
    severity: medium
    mitigation: >
      The service must call `_expire_order(reg)` before changing status when
      `reg.payment_order_state == 'created'`. For 'attempted' state (payment in-flight), the service
      should refuse the cash registration and require the admin to cancel first (VALIDATION_FAILED with
      message "A payment is in progress for this registration.").

decisions:
  - id: DEC-002-01
    decision: >
      Add a new `payment_method` VARCHAR column to event_registrations rather than extending the
      `payment_order_state` enum.
    rationale: >
      `payment_order_state` already has a DB CheckConstraint listing its allowed values. Adding 'cash'
      there is semantically wrong (it describes a Razorpay order state machine, not a payment method).
      A separate `payment_method` column is cleaner, queryable independently, and leaves the Razorpay
      state machine unmodified (DEC-B04 from ARCH-001: payment state changes only through provider
      events, verify, refund and cancel).
    alternatives:
      - "Add 'cash' to payment_order_state enum — rejected: breaks the semantic of the state machine and existing constraints"
      - "Add a separate CashPayment table — rejected: unnecessary complexity; FEAT-002 constraint C-04 and design constraint both prefer extending the Registration row"

  - id: DEC-002-02
    decision: >
      Add `cash_registered_by` as a nullable FK on Registration rather than querying the audit log
      for the actor name in the payments view.
    rationale: >
      The payments view must display the actor name (FR-12, AC-08). Querying the audit log for each
      row in a paginated list is an N+1 problem and couples the read path to the audit schema. A
      denormalized FK on the Registration row is O(1) per row via JOIN and is consistent with the
      existing `welcomed_by` FK pattern on the same model.
    alternatives:
      - "Query audit_log on each page load — rejected: N+1, audit log is append-only and not indexed for this join"
      - "Store actor name as a CharField — rejected: stale if admin changes their name; FK is correct"

  - id: DEC-002-03
    decision: >
      Single new endpoint `POST .../registrations/cash` rather than extending the existing
      `RegistrationActionView` (`POST .../registrations/{reg_id}/actions`).
    rationale: >
      The existing action endpoint handles status transitions on an existing registration and requires
      `reg_id` in the path. Cash registration can either create a new registration (no existing reg_id)
      or promote an existing one — the client should not need to look up the existing reg_id before
      calling the endpoint. A single endpoint that accepts `playerId` and handles both paths is simpler
      and stateless from the client's perspective (the backend resolves the state). Additionally, the
      action endpoint's `_parse_action` function is tightly coupled to the existing ACTIONS list.
    alternatives:
      - "Extend ACTIONS with 'cash_register' on the existing action endpoint — rejected: requires reg_id which may not exist; would need a separate create path anyway"
      - "Two endpoints (create and promote) — rejected: unnecessary; the backend can unify transparently"

  - id: DEC-002-04
    decision: >
      Cash registrations appear in the existing Control Room Payments tab and Global Payments admin
      screen by extending list_payments/list_ledger to union in cash registrations, not by creating
      a new dedicated payments view.
    rationale: >
      FR-12 and C-06 require cash payments to appear in existing views without a new screen. A union
      query approach (annotate + union or conditional ORM filter) keeps the payments views unified and
      avoids frontend tab changes. The DTO shape is extended with a discriminating `paymentMethod`
      field that the UI uses to render the CASH badge and suppress Razorpay-specific fields.
    alternatives:
      - "Separate 'Cash' tab in payments views — rejected: C-06 explicitly disallows a new dedicated screen"
      - "Return cash registrations only in the registrations tab, not in payments — rejected: FR-12 requires payments views coverage"

  - id: DEC-002-05
    decision: >
      The service calls `release_expired(event, now)` at the start of the atomic block (before looking
      up the existing registration), identical to the reserve() and other service functions.
    rationale: >
      A player whose pending hold has expired still has status='pending' in the DB until the scheduler
      runs. If we do not release first, the unique constraint fires as ALREADY_REGISTERED for a player
      who has effectively no live registration, which is a confusing error. Releasing first converts
      the stale row to 'cancelled', freeing the unique slot and allowing a fresh creation. This is the
      established pattern in reserve(), join_waitlist().
    alternatives:
      - "Skip release_expired — rejected: leads to spurious ALREADY_REGISTERED errors for players with expired holds"

assumptions:
  - "The existing `audit.write()` function is called inside the atomic block; the RuntimeError guard ('must be called inside the mutation transaction') is already in place."
  - "The admin UI player search uses an existing admin players endpoint (GET /api/admin/players?q=...) and does not require a new backend endpoint for player lookup."
  - "The CASH badge visual styling uses the existing design system badge tokens; no new Figma component is needed beyond placement."
  - "Free events (price_paise = 0) can be detected reliably from the Event row; no separate flag is needed."
  - "The idempotency store (run_idempotent) can be applied to this endpoint; a replayed Idempotency-Key returns the original 201 without re-executing the registration."
  - "The event_id path parameter is a UUID (consistent with existing admin URLs); slug-based lookup is not added for this endpoint."

open_decisions:
  - "OQ-01 (FEAT-002): whether cash registration is permitted when the player has a prior cancelled or refunded registration. Recommendation: allow it (the unique constraint only blocks active statuses); the service does not currently read cancelled rows as 'existing'."
  - "OQ-04 (FEAT-002): whether a free-text admin note field is added to cash registrations. If yes, add a nullable `cash_note` TextField to Registration and surface it in the payments view."
  - "OQ-05 (FEAT-002): whether the global Payments admin screen shows cash payments inline (recommended) or in a separate tab. This affects the list_ledger union approach."
  - "Whether the 'attempted' payment_order_state blocks cash registration (recommended: yes, with a clear error) or whether the service should automatically expire the in-flight order."
---

# Architecture: Cash Registration for Paid Events

**ID:** ARCH-002
**Type:** architecture
**Feature:** FEAT-002 (`docs/requirements/FEAT-002-cash-registration.md`)
**Version:** 1
**Status:** ready
**Date:** 2026-11-05
**Author:** architect

## 1. Context

Pawn's Gambit (pgchess.in) hosts physical chess tournaments. At in-person events, some players pay entry fees in cash at the venue desk. The existing registration path requires a completed Razorpay transaction to reach `confirmed` status; there is no admin path to register a player as confirmed with cash payment. Admins currently work around this by zeroing the entry fee temporarily, editing the database directly, or contacting a developer. These workarounds bypass the capacity check, leave no audit trail, and create unreliable attendance data.

This architecture document specifies the minimum-footprint change that satisfies FEAT-002 without disrupting the existing Razorpay payment flow, free-event registration path, or the control room's other admin actions.

## 2. Current State

The key files reviewed:

| File | Purpose |
|------|---------|
| `backend/registrations/models.py` | `Registration` model — statuses, `payment_order_state`, `amount_paise` |
| `backend/registrations/services.py` | `lock_event`, `release_expired`, `adjust_confirmed`, `reserve()` — the patterns to reuse |
| `backend/registrations/rules.py` | `occupied()`, `holds_count()`, `active_registration()` — read-side capacity arithmetic |
| `backend/adminapi/views_control.py` | `RegistrationActionView` and `act()` — the existing mutation pattern |
| `backend/adminapi/control_service.py` | `registration_dto`, `capabilities`, `list_payments` — DTOs to extend |
| `backend/audit/writer.py` | `audit.write()` — append-only, must be inside `transaction.atomic()` |
| `backend/adminapi/permissions.py` | `IsAdmin` — role re-read from DB on every request |

**Existing Registration statuses:** `pending | confirming | confirmed | waitlist | offer | cancelled | refunded`

**Existing `payment_order_state` values:** `none | created | attempted | paid | failed | expired | refunded`

**Existing capacity enforcement pattern** (must be reused, not duplicated):
1. `lock_event(event_id)` — `SELECT ... FOR UPDATE` on the Event row
2. `release_expired(event, now)` — cancel stale holds/offers that stopped counting toward capacity
3. `rules.occupied(event.pk, now)` — `confirmed_count + holds_count` (unexpired holds + offers)
4. `adjust_confirmed(event.pk, delta)` — relative `F('confirmed_count') + delta` update in the same transaction

There is currently **no** `payment_method` field on `Registration`. The distinction between a free-event confirmation (`payment_order_state='none', amount_paise=0`) and a Razorpay-paid confirmation (`payment_order_state='paid', amount_paise>0`) is implicit. A cash-paid confirmation cannot be distinguished from either existing case.

## 3. Proposed Solution

### 3.1 Data Model Change

Add two columns to the `event_registrations` table (one migration, non-blocking in PostgreSQL):

```python
# In Registration model (backend/registrations/models.py)

PAYMENT_METHODS = [('razorpay', 'razorpay'), ('cash', 'cash')]

payment_method = models.CharField(
    max_length=10,
    choices=PAYMENT_METHODS,
    default='razorpay',
)
cash_registered_by = models.ForeignKey(
    User, null=True, blank=True,
    on_delete=models.SET_NULL,
    related_name='+',
)
```

New constraint and index:
```python
models.CheckConstraint(
    condition=Q(payment_method__in=['razorpay', 'cash']),
    name='reg_payment_method_valid',
),
models.Index(
    fields=['event', 'payment_method'],
    condition=Q(payment_method='cash'),
    name='reg_cash_method_idx',
),
```

**Backfill:** None required. The `DEFAULT 'razorpay'` clause populates all existing rows at migration time (PostgreSQL stores constant defaults in the catalog without a full table scan on PostgreSQL 11+). Every historical registration was either Razorpay-paid or a free-event confirmation; both correctly map to `'razorpay'` as the default method value.

### 3.2 New Service Function

```python
# backend/registrations/services.py

def cash_register(request, event: Event, player: User, amount_paise: int) -> Registration:
    """Admin-only: confirm a registration with cash payment.

    Caller has already validated:
      - event.price_paise > 0 (not a free event)
      - event.status not in ('cancelled', 'completed')
      - amount_paise > 0

    Returns the confirmed Registration.
    Raises:
      AlreadyRegistered — player already confirmed
      EventFull         — no capacity (for new + waitlist promotions)
      ValidationFailed  — payment in-flight ('attempted' state blocks promotion)
    """
    with transaction.atomic():
        event = lock_event(event.pk)          # serialises all capacity changes
        now = timezone.now()
        release_expired(event, now)           # cancel stale holds → free unique slot

        existing = active_registration(player, event.pk, now)

        if existing is not None and existing.status == 'confirmed':
            raise AlreadyRegistered()         # FR-06, AC-06

        if existing is not None and existing.payment_order_state == 'attempted':
            raise ValidationFailed(
                fields={'action': ['A payment is in progress. Cancel it before cash-registering.']})

        promoted = existing is not None       # True = update existing row

        if existing is None or existing.status == 'waitlist':
            # New registration or waitlist promotion: consumes a free seat
            if event.capacity is not None and rules.occupied(event.pk, now) >= event.capacity:
                raise EventFull()             # FR-07, AC-03

        # Expire any dangling Razorpay order on the existing pending row
        if existing is not None and existing.payment_order_state == 'created':
            existing.payment_order_state = 'expired'
            _expire_order(existing)

        changed = ['status', 'confirmed_at', 'amount_paise', 'payment_method',
                   'cash_registered_by', 'payment_order_state',
                   'hold_expires_at', 'offer_expires_at', 'version', 'updated_at']

        if existing is not None:
            existing.status = 'confirmed'
            existing.confirmed_at = now
            existing.amount_paise = amount_paise
            existing.payment_method = 'cash'
            existing.cash_registered_by = request.user
            existing.hold_expires_at = None
            existing.offer_expires_at = None
            existing.version += 1
            existing.save(update_fields=changed)
            reg = existing
        else:
            reg = Registration.objects.create(
                user=player,
                event=event,
                status='confirmed',
                confirmed_at=now,
                amount_paise=amount_paise,
                payment_method='cash',
                cash_registered_by=request.user,
            )

        adjust_confirmed(event.pk, +1)        # keeps Event.confirmed_count in step

        import audit
        audit.write(
            request,
            action='registration.cash_registration',
            object_type='registration',
            object_id=reg.pk,
            before={'promoted': promoted, 'prevStatus': existing.status if promoted else None},
            after={
                'status': 'confirmed',
                'paymentMethod': 'cash',
                'amountPaise': amount_paise,
                'eventId': str(event.pk),
                'playerId': str(player.pk),
                'actorName': (request.user.name or '').strip()[:80] or 'Admin',
            },
        )
        reg.event = event
        return reg
```

**Capacity semantics for each promotion path:**

| Prior status | Seat held before? | adjust_confirmed needed? | Capacity check needed? |
|---|---|---|---|
| None (new) | No | Yes (+1) | Yes |
| `pending` (unexpired hold) | Yes (in `holds_count`) | Yes (+1) | No (hold was already in `occupied`) |
| `offer` (unexpired offer) | Yes (in `holds_count`) | Yes (+1) | No (offer was already in `occupied`) |
| `waitlist` | No | Yes (+1) | Yes |

Note: `adjust_confirmed(+1)` is called in all paths. The `occupied()` counter (`confirmed_count + holds_count`) stays stable for `pending`/`offer` promotions (confirmed_count+1 offset by holds_count-1) but grows by 1 for new and waitlist paths.

### 3.3 New Endpoint

**URL:** `POST /api/admin/events/<str:event_id>/registrations/cash`

**View class:** `CashRegistrationView(AdminView)` in `backend/adminapi/views_control.py`

```python
class CashRegistrationView(AdminView):
    def post(self, request, event_id):
        def work():
            data = _object_body(request)
            errors = {}
            # Reject unknown fields
            for key in data:
                if key not in ('playerId', 'amountPaise'):
                    errors[str(key)[:60]] = ['This field cannot be changed here.']
            # Validate playerId
            player_id = data.get('playerId')
            player = None
            try:
                pid = uuid.UUID(str(player_id))
                player = User.objects.filter(pk=pid).first()
            except (ValueError, TypeError):
                errors['playerId'] = ['Use a valid UUID.']
            if player is None and 'playerId' not in errors:
                errors['playerId'] = ['Player not found.']
            # Validate amountPaise
            amount = data.get('amountPaise')
            if not isinstance(amount, int) or amount <= 0:
                errors['amountPaise'] = ['Enter a whole number greater than zero.']
            if errors:
                raise ValidationFailed(fields=errors)
            # Resolve event
            event = control_event(event_id)
            if event.price_paise == 0:
                raise ValidationFailed(fields={'action': ['Cash registration is not available on free events.']})
            if event.status in ('cancelled', 'completed'):
                raise ValidationFailed(fields={'action': [f'Cannot cash-register on a {event.status} event.']})
            reg = reg_services.cash_register(request, event, player, amount)
            now = timezone.now()
            dto = registration_dto(
                reg, event, now,
                rating=current_ratings([reg.user_id], pool_of(event)).get(reg.user_id),
                first_timer=with_first_timer(
                    Registration.objects.filter(pk=reg.pk), event).filter(is_first=True).exists(),
                free=free_seats(event, now),
            )
            return ok(dto, status=201)
        return run_idempotent(request, work)
```

**URL registration** in `backend/adminapi/urls.py`:
```python
path('events/<str:event_id>/registrations/cash',
     cv.CashRegistrationView.as_view(),
     name='admin-event-cash-registration'),
```

### 3.4 DTO Extensions

**`registration_dto`** (control_service.py) — adds `paymentMethod` and `actorName`:
```python
'paymentMethod': reg.payment_method,  # 'razorpay' | 'cash'
'actorName': (reg.cash_registered_by.name or 'Admin')[:80] if reg.cash_registered_by_id else None,
```

**`capabilities`** — adds `canCashRegister` flag for the registrations tab row actions:
```python
# canCashRegister: visible for pending/waitlist/offer rows on paid, non-over events
can_cash = (
    _flag(True)
    if not over and event.price_paise > 0 and eff in ('pending', 'waitlist', 'offer')
    else _flag(False, 'Only pending, waitlisted or offered registrations on paid events can be cash-registered.')
)
# (Confirmed rows already show CASH badge; button not needed there)
```

**`list_payments`** (control_service.py) — unions cash registrations into the payments view. The existing query operates on `PaymentOrder` rows; cash registrations have no `PaymentOrder`. The union is added after pagination on the same page via a companion query on `Registration.objects.filter(event=event, payment_method='cash')`. An alternative is to perform the union at the ORM level before pagination; this is preferred so counts are accurate:

```python
# Preferred approach: ORM-level union before pagination
# Two querysets annotated to match the same column shape, then union'd and paginated together.
# Implementation detail is left to the engineer; the key contract is that cash rows appear
# in the same paginated result with paymentMethod='cash' and no providerOrderId/providerPaymentId.
```

Cash payment row DTO shape (for payments view):
```json
{
  "id": "<registration_uuid>",
  "registrationId": "<registration_uuid>",
  "playerName": "...",
  "amountPaise": 50000,
  "currency": "INR",
  "state": "cash",
  "paymentMethod": "cash",
  "actorName": "Admin Name",
  "paidAt": "2026-11-05T10:30:00Z",
  "mismatch": {"mismatch": false},
  "capabilities": {
    "canRefund": {"allowed": false, "reason": "Cash payments are not refunded through the system."}
  }
}
```

### 3.5 System Flow

```mermaid
sequenceDiagram
    actor Admin
    participant UI as Control Room<br/>Registrations Tab
    participant API as POST /api/admin/events<br/>/{id}/registrations/cash
    participant DB as PostgreSQL

    Admin->>UI: Clicks "Register with cash" button
    note over UI: Button hidden on free events (price_paise == 0)
    UI->>Admin: Opens CashRegisterDialog
    note over UI: Amount pre-filled with event entry fee (in rupees)
    Admin->>UI: Enters/confirms player + amount, clicks Confirm
    note over UI: Confirm button disabled; loading indicator shown
    UI->>API: POST {playerId, amountPaise}

    API->>API: IsAdmin check (role re-read from DB)
    API->>API: Validate body (UUID, amountPaise > 0)
    API->>API: Resolve event (control_event: non-draft only)
    API->>API: Guard: event.price_paise > 0, status not cancelled/completed

    API->>DB: BEGIN transaction (atomic)
    API->>DB: SELECT event FOR UPDATE (lock_event)
    API->>DB: release_expired(event, now) → cancel stale holds
    API->>DB: SELECT existing active registration for player

    alt No existing active registration
        API->>DB: occupied(event.pk, now) >= capacity?
        note over DB: EventFull → 409 if full
        API->>DB: INSERT Registration(status=confirmed, payment_method=cash, ...)
    else Existing status = confirmed
        API->>DB: ROLLBACK
        API-->>UI: 409 ALREADY_CONFIRMED
    else Existing status = pending or offer
        note over DB: Seat already in occupied (hold/offer counted)<br/>No capacity check needed
        opt payment_order_state = 'created'
            API->>DB: Expire dangling Razorpay order (_expire_order)
        end
        API->>DB: UPDATE Registration(status=confirmed, payment_method=cash, ...)
    else Existing status = waitlist
        API->>DB: occupied(event.pk, now) >= capacity?
        note over DB: EventFull → 409 if full
        API->>DB: UPDATE Registration(status=confirmed, payment_method=cash, ...)
    end

    API->>DB: UPDATE Event SET confirmed_count += 1 (adjust_confirmed)
    API->>DB: INSERT audit_log(action=registration.cash_registration, actor, before, after)
    API->>DB: COMMIT

    API-->>UI: 201 {ok: true, data: {registration DTO, paymentMethod: "cash"}}
    UI->>UI: Close dialog
    UI->>UI: Refresh registrations list
    UI-->>Admin: Player row shows CASH badge, status=confirmed
```

## 4. Affected Components

### 4.1 Backend — `registrations` app (COMP-B04)

| File | Change |
|------|--------|
| `models.py` | Add `payment_method`, `cash_registered_by`, `reg_payment_method_valid` constraint, `reg_cash_method_idx` index |
| `services.py` | Add `cash_register()` function; no changes to existing functions |
| `migrations/XXXX_add_payment_method.py` | New migration (addField × 2, addConstraint, addIndex) |

### 4.2 Backend — `adminapi` app (COMP-B07)

| File | Change |
|------|--------|
| `views_control.py` | Add `CashRegistrationView` class |
| `urls.py` | Add URL entry for the new view |
| `control_service.py` | Extend `registration_dto` (paymentMethod, actorName), extend `capabilities` (canCashRegister), extend `list_payments` (union cash rows) |
| `ledger_service.py` | Extend `list_ledger` and `payment_rows` to include cash registrations with `paymentMethod='cash'` discriminator |

### 4.3 Frontend — Control Room (extends FEAT-001, COMP-B07 frontend)

| File | Change |
|------|--------|
| `web/src/features/admin/events/controlroom/CashRegisterDialog.tsx` | New component: toolbar button + modal |
| `web/src/features/admin/events/controlroom/RegistrationsTab.tsx` (or equivalent) | Import and render `CashRegisterDialog`; hide on free events |
| `web/src/lib/api/pg-api.ts` | Add `cashRegisterPlayer(eventId, body)` method; add `paymentMethod`, `actorName` to `AdminRegistrationDto` |
| Payments/registrations list components | Render CASH badge when `paymentMethod === 'cash'`; render `actorName` in the payments row |

## 5. Frontend Implementation Guidance

### 5.1 CashRegisterDialog

The dialog is surfaced as a toolbar button on the Control Room Registrations tab. The button is hidden or disabled with a tooltip when `event.pricePaise === 0` (free event), or when `event.status` is `cancelled` or `completed`.

**Dialog flow (FR-10, AC-14):**

1. **Player search:** Text input searches `GET /api/admin/players?q=...`. Displays player name, email, and existing registration status (if any) in a dropdown.
2. **Amount field:** Numeric input (rupees), pre-populated with `event.pricePaise / 100`. Admin may edit (FR-11). Accepts integers and decimals; converts to paise (`Math.round(rupees * 100)`). Validation: must be > 0, must be a valid number (AC-10).
3. **Confirmation step:** Shows player name, event name, published entry fee (from event), and entered amount side-by-side so the admin can review discrepancies before committing (EC-03).
4. **Submit:** Confirm button disabled while loading (AC-14). On success: close dialog, invalidate/refresh the registrations list, show success toast. On failure: display error inside dialog, preserve entered amount, re-enable Confirm (AC-14, EC-01).

**Validation (AC-10):**
- Amount ≤ 0 or non-numeric: Confirm button disabled, inline error message.
- No player selected: Confirm button disabled.

### 5.2 CASH Badge

The CASH badge is a visually distinct label applied to all registration rows and payment rows where `paymentMethod === 'cash'`. It should be clearly distinguishable from:
- Razorpay-paid confirmations (show payment state chip, e.g., "Paid")
- Free-event confirmations (show "Free" or no payment badge)

Use the existing badge design token for a neutral/accent colour distinct from the success (paid) and muted (free) states.

### 5.3 Payments View Changes

For the Control Room Payments tab and Global Payments admin screen, cash registrations appear as rows with:
- `paymentMethod: 'cash'` → renders CASH badge
- `actorName`: rendered as "By <name>" attribution
- `paidAt` (`confirmedAt`): timestamp column
- No provider order/payment IDs
- Refund capability disabled with reason "Cash payments are not refunded through the system."
- No mismatch indicator

## 6. Security Considerations

### 6.1 Authentication and Authorization

- `IsAdmin` permission class is applied via `AdminView` base. It re-reads `user.role` from the database on every request — a stale access token with a demoted role is rejected immediately.
- The endpoint is under `/api/admin/` which is not reachable by the player-facing app (no aliased public route). No middleware-only trust.
- Satisfies FR-08 and FEAT-002 constraint C-01.

### 6.2 Capacity Race Prevention

The `SELECT ... FOR UPDATE` on the Event row (`lock_event`) serialises all concurrent requests that modify `confirmed_count`. Two simultaneous cash registrations for the last seat: the first commits, incrementing `confirmed_count` to `capacity`; the second transaction re-reads `occupied(event.pk, now) >= event.capacity` after acquiring the lock and raises `EventFull`. This is identical to the Razorpay confirm path (C-02 satisfied, AC-13 satisfied).

### 6.3 Input Validation

- `amountPaise` is validated as a positive integer server-side, regardless of what the UI sends (C-03).
- `playerId` is validated as a UUID and resolved to a live User account before the transaction.
- Event guards (not free, not cancelled/completed) are enforced server-side.

### 6.4 Audit Atomicity

`audit.write()` is called inside `transaction.atomic()`. If the audit insert fails, the entire transaction rolls back and no partial state is committed (C-05, FR-09). The `audit.write()` function already enforces this with a `RuntimeError` if called outside an atomic block.

## 7. Observability

- **Audit log:** `action='registration.cash_registration'` row with `actor`, `before.promoted`, `after.{status, paymentMethod, amountPaise, eventId, playerId, actorName}`. Queryable in the Control Room Audit tab (screen 53). Satisfies FR-09, AC-02, AC-09.
- **Application log:** `logger.info('cash_register event=%s player=%s amount=%d promoted=%s', ...)` in `services.py` for operational monitoring.
- **Request ID:** propagated on every response via the existing middleware; no additional instrumentation needed.

## 8. Migration and Rollout

1. **Apply migration** (can run while the old code is live — the new columns have safe defaults and are nullable/defaulted):
   ```
   python manage.py migrate registrations
   ```
2. **Deploy backend** with the new service, view, and DTO changes.
3. **Deploy frontend** with `CashRegisterDialog` and updated DTO types.

No feature flag is required. The new endpoint is additive; existing endpoints are unchanged. The new columns on `Registration` are read as `'razorpay'` by the existing code (via the default) and ignored.

**Rollback:** Revert the backend deploy first (old code ignores new columns). Revert the frontend deploy. The migration can be reversed (`python manage.py migrate registrations <previous>`) if no cash registrations have been created.

## 9. Alternatives Considered

| Alternative | Verdict |
|---|---|
| Extend `payment_order_state` with `'cash'` | Rejected — `payment_order_state` is a Razorpay order state machine; adding 'cash' breaks the semantic and existing DB constraint |
| Separate `CashPayment` table | Rejected — over-engineered; FEAT-002 constraint and design constraint explicitly say no new table |
| Extend the existing `actions` endpoint with `action='cash_register'` | Rejected — requires `reg_id` in the path; can't create a new registration without a prior reg_id; the two paths (create + promote) cannot be unified through `reg_id` lookup alone |
| Separate "Cash payments" tab in the payments view | Rejected — FEAT-002 C-06 explicitly requires cash payments to appear in existing views without a new screen |
| Query audit log for actor name in payments view | Rejected — N+1 performance problem; `cash_registered_by` FK is consistent with `welcomed_by` on the same model |

## 10. Schema Conformance

Checked against `schemas/architecture.schema.yaml` on 2026-11-05.

| Schema property | Value | Result |
|---|---|---|
| `id` (pattern `^ARCH-[0-9]{3,}$`) | ARCH-002 | Pass |
| `type` (const `architecture`) | architecture | Pass |
| `feature_id` (pattern `^FEAT-[0-9]{3,}$`) | FEAT-002 | Pass |
| `version` (integer ≥ 1) | 1 | Pass |
| `status` (enum) | ready | Pass |
| `proposed_solution` (non-empty) | Present | Pass |
| `components` (at least one with id, name, responsibility) | 5 entries | Pass |
| `data_changes` (type enum, description) | 4 entries | Pass |
| `apis` (method, path) | 1 entry | Pass |
| `security` (object) | Present | Pass |
| `observability` (object) | Present | Pass |
| `migration` (object) | Present | Pass |
| `risks` (id, description) | 5 entries | Pass |
| `decisions` (id, decision, rationale) | 5 entries | Pass |
| `assumptions` (array) | 6 entries | Pass |
| `open_decisions` (array) | 4 entries | Pass |
