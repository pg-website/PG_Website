---
id: PLAN-013
type: plan
feature_id: FEAT-001
architecture_id: ARCH-001
version: 1
status: in progress
date: 2026-11-16
---

# PLAN-013: Tests for the Event Builder resource

Target: `backend/adminapi/event_builder.py` (contract E02-E06) — DTO, PATCH validation, locked fields, publish
readiness, capabilities. Runner is the Django test runner (`manage.py test adminapi`), not pytest. No production code
changes in this plan: a defect found by a test is reported, not patched.

## 1. Layering

| Behaviour | Layer | File |
|---|---|---|
| `parse_create`, `parse_patch`, `parse_event_id`, `default_communications` | unit, no DB (`SimpleTestCase`) | `adminapi/test_event_builder_parsing.py` |
| `readiness` blockers (row only, no media) | unit, no DB (`SimpleTestCase`) | `adminapi/test_event_builder_readiness.py` |
| `readiness` alt-text blocker, `has_commitments`, `locked_fields`, `unpublish_blockers`, `capabilities`, `draft_dto`, `type_defaults` | `TestCase` (needs PostgreSQL) | `adminapi/test_event_builder_state.py` |
| PATCH through HTTP (version conflict, step-up, slug lock) | integration `TestCase` | deferred — `event_service.update_event`, only if asked |

Fixtures are unsaved `Event(**fields)` rows for the pure functions, and draft rows plus in-memory status/`first_published_at` mutation for the state tests (saving a non-draft row requires `at_a_glance`/`experience` content that is irrelevant to these functions). Hand-worked expectations, not values read back from the code.

## 2. Phases

### Phase 1 — parsing (this change, `test_event_builder_parsing.py`)
- [x] `parse_event_id`: valid UUID string; unknown string, `None`, int → `EventNotFound`.
- [x] `parse_create`: minimal payload defaults (`type='social'`, `slug=None`); trimming; blank/`None`/non-string/121-char/HTML title; slug blank → `None`, too short, uppercase/spaces; invalid `type`; unknown key rejected; non-object → `form` error.
- [x] `parse_patch` envelope: missing/`bool`/negative/string `version`; non-object payload; unknown step; `review` is not patchable; version 0 accepted; empty nested object accepted.
- [x] `basics`: trimming, blank title allowed in a draft, `null`/`''` slug clears, aware/`Z`/naive/garbage instants, invalid `type`/`audience`, unknown field.
- [x] `experience`: blank row dropped, half-filled row rejected, trimmed row kept, non-object row, 8/12/20 caps, invalid `mode`, non-bool `hostedArrival`, field length caps.
- [x] `registration`: `''` capacity → unlimited (`None`), `0`/`100001`/`true` rejected, `minAge` bounds, non-bool flags, naive `opensAt`.
- [x] `payment`: `pricePaise` bounds (`MAX_PAISE`), `refundWindowHours` `None`/`1441`, `holdMinutes` `0`/`61`.
- [x] `gameSystem`: `rounds` `None`/`21`, invalid `pool`/`pairingMode`, integer `rated`, `timeControl` length.
- [x] `media`: `assetIds` normalised to lowercase UUID strings, duplicates, bad id, 50 cap, `autoplay` type, `intervalMs` 2000..60000, `collectionId`/`mode` rejected as unknown (PLAN-010 regression).
- [x] `communications`: `channels=['email']` accepted and not echoed, other channel rejected, partial trigger, unknown trigger, non-bool trigger.
- [x] all errors in one payload reported together; steps not sent are absent from the result.

Result: 74 tests, all passing (`manage.py test adminapi.test_event_builder_parsing`, no database). Two assumptions were
wrong and the tests were corrected, not the code: `parse_create` requires a title (only PATCH may blank it), and
errors are deduplicated per path, so each half-filled list row gets its own entry.

### Phase 2 — publish readiness (`test_event_builder_readiness.py`)
- A complete draft is ready with `capacity=None` (unlimited) and no description: both are never blockers.
- Missing/blank title, missing slug, missing/past/equal start, missing/end-before-start end, missing time control.
- Rated without pool; `swiss`/`round_robin` without rounds; `social_balanced`/`none` need no rounds.
- Registration closes before it opens, and closes after the start.
- Paid event with `refund_window_hours=None` is ready (explicit "no refunds").
- A near-empty draft reports every blocker at once, exact `(code, field)` list.
- Alt-text blocker: gallery asset without alt and not decorative blocks; decorative or alt-texted does not.

### Phase 3 — state (`test_event_builder_state.py`)
- `has_commitments` / `locked_fields`: empty; confirmed; `confirming`; `waitlist`; `refunded`; `pending` with a live hold; `pending` with an expired hold (not locked); cancelled (not locked); a `PaymentOrder` row alone; `first_published_at` adds `slug` last.
- `unpublish_blockers`: not live; clean published; confirmed players; payment in flight (`confirming`, and `pending` + `attempted`); `confirming=False` override.
- `capabilities` per status (draft ready/not ready, published, registration_open, sold_out, ongoing, cancelled) plus the lifecycle buttons `canOpenRegistration` / `canCloseRegistration` / `canDelete`, with exact reasons.
- `draft_dto`: shape, editable/locked slug (with `lockedAt` in `+05:30`), `lockedReasons`, rated-with-blank-pool reporting `rapid`, unrated has no `pool`, stored trigger overrides, media gallery DTO (mode derived), `lastChange=None`, `version`.
- `type_defaults` per event type and `default_communications`.

## 3. Commands

```
cd backend
./venv/Scripts/python.exe manage.py test adminapi.test_event_builder_parsing
./venv/Scripts/python.exe manage.py check
./venv/Scripts/python.exe manage.py makemigrations --check --dry-run
```

Phase 2 uses `SimpleTestCase`; phase 3 needs PostgreSQL (`localhost:5432`, reachable) and runs with `--keepdb`.

## 4. Decisions and open questions

- Keep one file per phase rather than one large module, so the pure parsing contract is runnable without a database.
- Assert exact messages and codes, not just "not empty": the frontend maps these strings.
- Open: whether to cover `views_events.py` PATCH end-to-end (step-up, `Idempotency-Key`, slug conflict). Out of scope until requested; it needs an admin user and a step-up grant.
- Open: `capabilities` composes "A ongoing event …" from `status.replace('_', ' ')`; tests assert the current wording, so a grammar fix must update them deliberately.
