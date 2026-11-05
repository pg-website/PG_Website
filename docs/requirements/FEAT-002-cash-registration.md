# Requirement: Cash Registration

**ID:** FEAT-002
**Type:** requirement
**Version:** 1
**Status:** approved
**Owner:** PG Chess project owner
**Date:** 2026-11-05

---

## Goal

Enable admins to register a player as paid-and-confirmed for a paid event when payment was collected in cash at the venue, without going through Razorpay.

## Problem

At physical events, some players pay entry fees in cash at the venue desk. Currently:

- The only path to `confirmed` status on a paid event is a completed Razorpay transaction.
- Admins have no UI or API to mark a player as paid in cash.
- Workarounds (temporarily zeroing the entry fee, or direct database edits) create inconsistent records, bypass capacity checks, leave no audit trail, and require developer intervention for an ordinary operational task.

This gap causes unreliable attendance data, reconciliation problems, and surfaces an operational risk every time an in-person event is held.

## Users

| Role | Description |
|------|-------------|
| Admin / event operator | Signed-in account with role `admin`. Uses this action at the venue desk on event day, or in the Control Room after the fact, to confirm players who paid entry fees in cash. |
| Project owner / accountant | Reviews the payments and audit views to reconcile cash collected at events against registration records. |

## User Stories

| ID | Statement | Priority |
|----|-----------|---------|
| US-01 | As an admin at the venue, I want to register a player who paid cash in hand as confirmed, so that their place is secured and the event capacity reflects reality. | must |
| US-02 | As an admin, I want cash-registered players to appear with a clear CASH label in all payments and registrations views, so that I can reconcile cash collected against the record. | must |
| US-03 | As an admin, I want the cash registration to check capacity the same way an online payment does, so that I never oversell an event. | must |
| US-04 | As the project owner, I want every cash registration to carry an audit record showing who performed it, when, and for how much, so that I can hold admins accountable and detect errors. | must |
| US-05 | As an admin, I want to promote an existing pending or waitlisted registration to confirmed with cash payment, so that I do not create a duplicate record for a player who already has a registration in progress. | must |

## Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01 | An admin-only action (API endpoint and UI trigger) creates or promotes a registration to `confirmed` status on a paid event, recording that payment was collected in cash. | must |
| FR-02 | The action is accessible from two locations: the Control Room > Registrations tab (screen 47 from FEAT-001) for a specific event, and the global Payments admin screen (screen 55 from FEAT-001). | must |
| FR-03 | The cash registration stores: the amount collected in paise, the admin actor identity, the UTC timestamp, the event, and the player. The data model must make cash payments distinguishable from Razorpay payments and from free-event confirmations. | must |
| FR-04 | The action enforces event capacity identically to the Razorpay payment confirmation path. No capacity override is provided. | must |
| FR-05 | If the player has no existing registration for the event, a new `confirmed` registration is created directly. If the player has an existing `pending`, `waitlist`, or `offer` registration, that record is promoted to `confirmed` and no duplicate is created. | must |
| FR-06 | If the player is already `confirmed` for the event, the action is rejected with a clear error message and no record is changed. | must |
| FR-07 | If the event has reached capacity, the action is rejected with a clear error message; no registration is created or modified. | must |
| FR-08 | The action requires admin authentication and authorisation. Any unauthenticated or non-admin request is rejected with HTTP 403. The auth check must be performed inside the action handler itself, not relied upon from middleware alone. | must |
| FR-09 | An audit record is written atomically with the registration state change containing: actor user ID, actor display name, event ID, player ID, amount in paise, action type `cash_registration`, and UTC timestamp. If the audit write fails, the entire action fails and no partial state is committed. | must |
| FR-10 | A confirmation dialog is presented in the UI before the action is committed, displaying the player name, event name, amount, and entry fee for comparison. | must |
| FR-11 | The amount field is pre-populated with the event's published entry fee but remains editable by the admin to handle discounts or discrepancies; the edited value is the amount recorded and stored. | should |
| FR-12 | Cash registrations appear in the Control Room Registrations tab, the Control Room Payments tab, and the global Payments admin screen with a CASH badge and the actor's name visible. | must |
| FR-13 | The cash registration action is not available on free events (entry fee = 0); the action is absent or explicitly disabled with an explanatory label on free events. | must |
| FR-14 | The action is strictly admin-only. No player-facing UI or API path exposes cash registration. | must |

## Acceptance Criteria

| ID | Description | Verification | Priority |
|----|-------------|-------------|---------|
| AC-01 | Given an admin opens the cash registration dialog on a paid event with available capacity, when they select a player with no existing registration, enter a valid amount and confirm, then a `confirmed` registration exists for the player, `confirmed_at` is set to approximately the action time, `amount_paise` equals the entered amount converted from rupees, the cash payment method is recorded on the registration, and remaining capacity decrements by 1. | API integration test; admin UI Playwright scenario. | must |
| AC-02 | Given every successful cash registration action, when it completes, then an audit record is persisted containing actor user ID, actor display name, event ID, player ID, amount in paise, action type `cash_registration`, and a UTC timestamp within 2 seconds of the server time at execution. | Integration test asserting all audit record fields. | must |
| AC-03 | Given a paid event that has reached its registered-capacity limit, when an admin attempts a cash registration, then the server returns an error naming the event and stating it is full; no registration record is created or modified. | API test with a full-event fixture; Playwright dialog error state. | must |
| AC-04 | Given a player with an existing `pending` registration on the event, when an admin cash-registers them, then the existing registration record is promoted to `confirmed` (same registration ID retained), the cash payment method and amount are recorded, and no second registration is created. | API test asserting registration ID is unchanged before and after and state is `confirmed`. | must |
| AC-05 | Given a player with an existing `waitlist` or `offer` registration, when an admin cash-registers them, then the same behaviour as AC-04 applies: the existing record is promoted, no duplicate is created. | API test for each source state (`waitlist`, `offer`). | must |
| AC-06 | Given a player already in `confirmed` status for the event, when an admin attempts a cash registration, then the server returns an error stating the player is already confirmed, and no record is changed. | API test; Playwright dialog error state. | must |
| AC-07 | Given a successful cash registration, when the Control Room Registrations tab for that event is viewed, then the player row shows a CASH badge that is visually distinct from rows with an online Razorpay payment and from rows with a free-event confirmation. | Playwright visual assertion; manual review. | must |
| AC-08 | Given one or more cash registrations on an event, when the Control Room Payments tab or the global Payments admin screen is viewed, then each cash entry appears with: player name, amount displayed in INR (formatted per FEAT-001 A-07), CASH label, admin actor name, and timestamp. | Playwright scenario covering Control Room Payments tab (screen 50) and global Payments admin (screen 55). | must |
| AC-09 | Given the audit log for an event, when the cash registration entry is viewed, then it shows admin actor name, player name, amount collected in INR, and the timestamp of the action. | Playwright audit tab scenario; integration test. | must |
| AC-10 | Given the cash registration amount field, when a value of 0, a negative number, or a non-numeric string is entered, then the confirm button is disabled and an inline validation error describes the required format; no API call is made before the input is valid. | Unit test on the validation logic; Playwright validation scenario. | must |
| AC-11 | Given a free event (entry fee = 0), when the Control Room Registrations tab renders, then the cash registration action is absent or disabled with a visible label explaining it is not applicable; no API path accepts a cash registration request for a free event. | Playwright on a free-event fixture; API test returning 400 or 403 for a free event. | must |
| AC-12 | Given an API request to the cash registration endpoint with no credentials, with player-role credentials, or with a forged admin claim, then the response is HTTP 403 and no registration or audit record is created. | API security tests: unauthenticated, player auth, tampered JWT. | must |
| AC-13 | Given two concurrent cash registration requests for the same player on the same event submitted simultaneously, then exactly one succeeds, the other returns a clear conflict or capacity error, and no duplicate registrations or audit records are created. | Concurrent API integration test relying on database-level constraints. | must |
| AC-14 | Given the confirmation dialog, when the admin clicks Confirm, then the button is immediately disabled with a loading indicator until the server responds; on success the dialog closes and the registrations list refreshes to show the new CASH-labelled row; on failure the error message is shown inside the dialog and the admin's entered amount is preserved. | Playwright with delayed-response and error mock scenarios. | must |

## Edge Cases

| ID | Edge case | Expected behaviour | Covered by |
|----|-----------|--------------------|-----------|
| EC-01 | Event reaches capacity between the admin opening the dialog and clicking Confirm. | Server rejects with a capacity-full error; the dialog remains open with the admin's input preserved and the error displayed. | AC-03, AC-14 |
| EC-02 | Player has a `cancelled` or `refunded` prior registration and pays cash at the door. | Behaviour depends on OQ-01. Default: create a fresh confirmed registration (prior cancelled record is unaffected). If the backend disallows re-registration after cancellation, reject with a clear message rather than silently failing. | OQ-01 |
| EC-03 | Admin enters an amount that differs from the published event fee (e.g., a last-minute discount). | The entered amount is stored without automatic correction. The UI should display both the published fee and the entered amount in the confirmation dialog so the admin can review before committing (FR-10). | FR-10, FR-11 |
| EC-04 | Admin attempts cash registration on a cancelled or completed event. | The action is unavailable. The server rejects the request with a clear status error; the UI does not present the dialog trigger for cancelled or completed events. | FR-01 |
| EC-05 | Network failure after the server commits the registration but before the UI receives the response. | The registration is confirmed on the server. The admin can reload the Registrations tab and see the CASH-labelled confirmed row. The UI must not display success before receiving a server confirmation response. | AC-14 |
| EC-06 | Cash-registering a waitlisted player and waitlist rebalancing. | Backend concern: the frontend promotes the registration and reflects the new confirmed state. Whether the next waitlisted player automatically receives an offer is governed by existing waitlist logic and is out of scope for this feature. | OQ-03 |

## Non-Goals

- Player-facing cash payment UI: players cannot initiate or acknowledge a cash payment through the product.
- Razorpay integration changes: no modification to the existing online payment flow.
- Cash refund processing: if a cash-paid player cancels, the refund is handled entirely offline. The system does not process or track cash refunds; an admin note is an optional backend extension outside this feature's scope.
- Membership, comp, or donation pricing.
- Split payment (cash + online for the same registration).
- Cash registration on free events.
- Bulk cash registration (multiple players in a single action).
- Receipt or invoice generation for cash payments.
- Admin capacity override: registering beyond the event's published capacity limit.

## Constraints

- C-01: The cash registration endpoint must authenticate and authorise the request inside the handler itself, not rely solely on middleware or page-level guards, consistent with the react-best-practices rule 3.1 (Authenticate Server Actions Like API Routes).
- C-02: Capacity enforcement must reuse the same atomic check-and-decrement used by the Razorpay payment confirmation path. A separate code path that could diverge from the online flow is not acceptable.
- C-03: Amount is stored in integer paise, consistent with the existing `Registration.amount_paise` field. The UI accepts and displays rupees; the conversion is handled server-side or at the API boundary and is not left to client discretion.
- C-04: The data model must make cash payments distinguishable from Razorpay payments (`payment_order_state = 'paid'`) and from free-event confirmations (`payment_order_state = 'none'`). Whether this is a new enum value on `payment_order_state` (e.g., `'cash'`) or a separate `payment_method` field is an architecture decision; the product requirement is that the distinction is stored and queryable for reporting.
- C-05: The audit record must be written in the same database transaction as the registration state change. If the audit write fails, the action fails atomically and no partial state is left in the database.
- C-06: The CASH badge and actor attribution must appear in all existing admin payments and registrations views (Control Room tabs and global Payments admin) without requiring a new dedicated admin screen.

## Dependencies

| Name | Type | Required | Notes |
|------|------|----------|-------|
| FEAT-001 (frontend rewrite — Control Room Registrations tab, Control Room Payments tab, global Payments admin screen) | feature | true | The cash registration UI trigger lives inside screens 47, 50, and 55 delivered by FEAT-001. |
| Django Registration model (existing) | backend | true | Must be extended to store the cash payment method indicator and support the `confirmed` promotion path without Razorpay. |
| Django audit log (existing) | backend | true | The `cash_registration` action type must be written to the same audit log used for other admin actions (screen 53). |
| Admin authentication and authorisation system (existing) | backend | true | The endpoint reuses the existing admin auth checks. |

## Assumptions

- A-01: The existing audit log table (or equivalent audit store) can record a `cash_registration` action type with the required fields (actor, player, event, amount, timestamp) without a new table.
- A-02: The backend's capacity-check logic is encapsulated in a reusable service function so that the cash registration path can call it without duplicating the check.
- A-03: Amount display in INR follows the formatting established in FEAT-001 A-07: whole rupees without decimals unless paise are non-zero, Indian digit grouping, "Free" for zero.
- A-04: The CASH badge visual style is accommodated by the existing design system tokens. No new design components beyond badge placement are required.
- A-05: A player account must already exist in the system before an admin can cash-register them. Creating a new player account on behalf of a walk-in is out of scope for this feature.

## Open Questions

| ID | Question | Blocking |
|----|----------|---------|
| OQ-01 | Should cash registration be permitted when the player's prior registration is in `cancelled` or `refunded` state? The business case exists (player cancelled online then showed up to pay cash), but it may conflict with refund-accounting rules. | false |
| OQ-02 | Should the UI display a warning when the admin enters an amount that differs from the event's published entry fee, and if so, at what percentage threshold should the warning appear? | false |
| OQ-03 | When a waitlisted player is cash-registered (their record is promoted to `confirmed`), should the backend automatically extend an offer to the next player on the waitlist to fill the vacated waitlist slot, or is that a separate manual action? | false |
| OQ-04 | Should admins be able to attach a free-text note to a cash registration (e.g., "collected by John Doe at the front desk")? If yes, where should the note be surfaced — payments view only, or also the registrations view? | false |
| OQ-05 | Should the global Payments admin screen (screen 55 from FEAT-001) display cash payments inline alongside Razorpay payments with a filter toggle, or in a separate tab? | false |

## Success Metrics

| Metric | Target |
|--------|--------|
| Cash registrations that produce a complete, persisted audit record | 100% |
| Cash registrations that bypass the event capacity check | 0 |
| Duplicate registrations created by the cash registration action | 0 |
| Admin views (registrations, payments) that distinguish CASH from Razorpay and free-event confirmations | 100% of impacted screens |

---

## Schema Conformance

Checked against `schemas/requirement.schema.yaml` on 2026-11-05.

| Schema property | Value in this document | Result |
|-----------------|------------------------|--------|
| `id` (pattern `^FEAT-[0-9]{3,}$`) | FEAT-002 | Pass |
| `type` (const `requirement`) | requirement | Pass |
| `version` (integer ≥ 1) | 1 | Pass |
| `status` (enum: draft, ready, approved, blocked, cancelled) | approved | Pass |
| `title` | Cash Registration | Pass |
| `goal` (present, non-empty) | One sentence, present | Pass |
| `problem` | Present | Pass |
| `users` (role required per item) | Two entries, both have `role` | Pass |
| `user_stories` (id, statement, priority in must/should/could) | US-01 to US-05; all have id, statement, and a valid priority | Pass |
| `functional_requirements` (id, description, priority) | FR-01 to FR-14; all have id, description, and a valid priority | Pass |
| `acceptance_criteria` (at least 1; id, description, verification required) | AC-01 to AC-14; all have id, description, verification, and a valid priority | Pass |
| `non_goals` (array of strings) | 9 entries | Pass |
| `constraints` (array of strings) | C-01 to C-06 | Pass |
| `dependencies` (name required per item) | 4 entries, all have `name` | Pass |
| `assumptions` (array of strings) | A-01 to A-05 | Pass |
| `open_questions` (id, question, blocking boolean) | OQ-01 to OQ-05; all have id, question, and a boolean blocking value | Pass |
| `success_metrics` (metric required per item) | 4 entries, all have `metric` | Pass |
