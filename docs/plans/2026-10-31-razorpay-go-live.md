---
id: PLAN-006
type: plan
feature_id: FEAT-001
architecture_id: ARCH-001
version: 1
status: draft
date: 2026-10-31
---

# PLAN-006: Razorpay go-live (test-mode verification, hardening, rollout)

**Feature:** Take the already-built Razorpay integration live. This is go-live and hardening work, not a build. Covers registration payment (R04/R05), webhook (W01), admin refund and payments (G04/G05/G06), and reconcile.
**Execution rules (owner memory):** agents run typecheck and lint only; no full `next build` (owner runs one per batch). Tests and security review are deferred until the main pages are built, but they are listed in section 6 as a mandatory pre-go-live gate. Backend first, no new mocks. Do not touch the owner's other uncommitted files.

---

## 1. What already exists (verified)

- `backend/payments/razorpay_client.py`: live mode over `requests`; DEBUG-only `fake` mode (`FakeProviderRecord`, `razorpay_fake_pay` command). Logs use `_safe_path` and never log bodies.
- `services.py`: create_order, verify (logs `payment_verify_rejected reason=BAD_SIGNATURE`), record_payment (late capture path at ~line 307 auto-refunds when no seat), refund_payment, execute_refund, finish_refund. `payment_mismatch` is logged as a warning at `services.py:157` and `reconcile.py:46`.
- `webhooks.py`: W01 raw-body HMAC; events handled: `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`. Idempotency via unique `payment_webhook_events.provider_event_id` (header `X-Razorpay-Event-Id`, falls back to a body hash). Rejections log a reason code only.
- `reconcile.py` and `payments/jobs.py` (refund retry, `refund_blocked_over_limit`).
- `ENDPOINTS-IMPLEMENTED.md` marks R04, R05, W01, G04, G05, G06 as Matches.
- `backend/pgchess/settings.py` ~171-198: `RAZORPAY_MODE` defaults `fake` under DEBUG, else `live`; live requires `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` or startup fails; `fake` refused outside DEBUG.
- Frontend: `features/registration/HoldActivePanel.tsx` (lazy Checkout), `lib/api/types/payment.ts`, `lib/security/csp.ts`, env `NEXT_PUBLIC_RAZORPAY_ENABLED`, admin payments feature.
- `docs/deployment/DEPLOY-001-vercel-railway-supabase.md` section 4.1 and checklist cover env vars and webhook setup.

## 2. Gaps found

| # | Gap | Resolution |
|---|-----|-----------|
| G1 | PLAN-002 line 25 says "Razorpay: Not started". Stale; code and ENDPOINTS-IMPLEMENTED show it built. | TASK-010 (docs-only edit) |
| G2 | `settings_service._integrations()` razorpay flag = `mode=='live'` and key id and secret set. Webhook secret not checked, so the badge can say Connected while webhooks would be rejected (startup also fails without it today, so this is defence in depth). In test mode the badge says Not connected even with valid test keys. | TASK-003, OQ-3 |
| G3 | CSP: `RAZORPAY_FRAME` and `RAZORPAY_CONNECT` allowances exist, scoped to `/events/:slug/register` and only when `NEXT_PUBLIC_RAZORPAY_ENABLED=true`. Not confirmed: script load of `checkout.razorpay.com/v1/checkout.js` under the nonce plus strict-dynamic policy, `img-src`, and whether Razorpay's UPI/3DS redirects need extra `frame-src` or `form-action`. Cannot be settled without a real checkout. | TASK-005 (find in test mode), TASK-006 (fix) |
| G4 | Webhook retry/idempotency looks sound (unique event id, body-hash fallback). Not verified: a handler failure after the event row is stored must not cause the event to be recorded as processed while the effect was lost (Razorpay retries only on non-2xx). | TASK-004 |
| G5 | Observability: `payment_mismatch` is only a `logger.warning`. No alert, counter or admin surface was found for PAYMENT_MISMATCH, `refund_blocked_over_limit`, rejected webhooks, or stuck pending refunds. | TASK-007, OQ-4 |
| G6 | Refund failure handling: `refund.failed` and provider rejection paths exist; behaviour on real provider errors (insufficient balance, already refunded, partial amounts) is unproven. | TASK-005, TASK-008 |
| G7 | Rate limits on R04/R05/W01 and the G06 refund not confirmed. W01 must not be throttled by IP in a way that drops Razorpay retries. | TASK-004 |
| G8 | Secrets scrubbing: client logs are safe by design; need to confirm Django/Sentry-style error reporting, request logging and the audit log never include `X-Razorpay-Signature`, raw webhook bodies (contain customer email/phone), or key secret. | TASK-004, security gate |
| G9 | No test-mode vs live indicator on the admin settings page; the integrations payload is booleans only (AC-68). | OQ-3, TASK-003 |

No new endpoints are required.

---

## 3. Tasks

| ID | Title | Owner | Size | Depends On | Status |
|----|-------|-------|------|-----------|--------|
| TASK-001 | Razorpay account, KYC and business verification | owner | L (calendar time, days) | - | todo |
| TASK-002 | Test-mode keys, webhook endpoint and env setup | owner | S | TASK-001 (test keys only need an account) | todo |
| TASK-003 | Integration status: check webhook secret, expose mode safely | backend-engineer | S | OQ-3 | todo |
| TASK-004 | Audit webhook handler: idempotency on failure, rate limits, scrubbing | backend-engineer | M | - | todo |
| TASK-005 | Test-mode end-to-end run (real test keys) | owner + test-engineer | M | TASK-002, TASK-004 | todo |
| TASK-006 | Fix CSP and checkout issues found in TASK-005 | frontend-engineer | S | TASK-005 | todo |
| TASK-007 | Alerting on payment anomalies | backend-engineer | M | OQ-4 | todo |
| TASK-008 | Refund failure handling review and fixes | backend-engineer | S | TASK-005 | todo |
| TASK-009 | Frontend flag and failure-state review | frontend-engineer | S | - | todo |
| TASK-010 | Fix stale PLAN-002 Razorpay note | backend-engineer | S (minutes) | - | todo |
| TASK-011 | Pre-go-live gate: automated tests and security review | test-engineer, security-reviewer | M | TASK-003..009 | todo (deferred) |
| TASK-012 | Live keys, live webhook, env switch (flag still off) | owner | S | TASK-001 (KYC approved), TASK-011 | todo |
| TASK-013 | First live payment and refund, then enable for public | owner | S | TASK-012 | todo |

Sizes: S under 1 hour, M 1-3 hours, L longer than a session or waiting on third parties.

---

## 4. Task details

### TASK-001 - Razorpay account and KYC
- **Owner:** owner
- **Goal:** Active Razorpay account with live mode approved for the business.
- **Rationale:** Live keys are only issued after KYC. It has the longest lead time, so start now.
- **Steps:** create account, submit business and bank details, wait for activation, enable the payment methods wanted (UPI, cards, netbanking), confirm settlement bank account, confirm refunds are allowed on the account.
- **Acceptance criteria:**
  - [ ] Dashboard shows live mode activated.
  - [ ] Settlement account verified.
- **Risk:** medium (external timing, can block the whole plan).

### TASK-002 - Test-mode keys, webhook and env
- **Owner:** owner
- **Goal:** Staging/local backend running `RAZORPAY_MODE=live` against Razorpay **test** keys.
- **Steps:**
  - Dashboard (test mode): generate Key Id and Key Secret.
  - Add webhook: URL `https://<railway-backend-host>/api/webhooks/razorpay` (confirm the exact path from `backend/payments/urls.py` or `ENDPOINTS-IMPLEMENTED.md` W01), choose a strong secret, tick events `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed` (the five the handler maps).
  - Railway env: `RAZORPAY_MODE=live`, `RAZORPAY_KEY_ID=rzp_test_...`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Vercel env: `NEXT_PUBLIC_RAZORPAY_ENABLED=true` (public key id comes from R04, confirm none is needed in Vercel).
  - Webhook needs a public URL: use the Railway staging service, or a tunnel for local.
- **Acceptance criteria:**
  - [ ] Backend boots in live mode with test keys (startup check passes).
  - [ ] Dashboard "send test webhook" gets HTTP 200.
  - [ ] Secrets only in Railway/Vercel env, never in git or chat.
- **Risk:** low. Reference DEPLOY-001 section 4.1.

### TASK-003 - Integration status check
- **Owner:** backend-engineer
- **Goal:** `_integrations()['razorpay']` requires key id, key secret and webhook secret, and works as agreed in OQ-3 for test mode.
- **Affected files:** `backend/adminapi/settings_service.py` (`_integrations`), possibly `web/src/lib/api/types/admin/settings.ts` and `IntegrationStatus.tsx` if a mode field is added (frontend part handed to frontend-engineer).
- **Implementation notes:** keep booleans only if OQ-3 says so. If a mode indicator is approved, add a non-secret enum such as `razorpayMode: 'test' | 'live' | null` derived from the key id prefix (`rzp_test_` / `rzp_live_`), never the key itself, and update Zod schema, OpenAPI and the AC-68 type-level no-secrets guard consciously.
- **Acceptance criteria:**
  - [ ] Missing webhook secret yields not connected.
  - [ ] Response contains no key material.
  - [ ] Typecheck and lint pass.
- **Testing:** unit test for `_integrations` combinations (listed, deferred).
- **Risk:** low.

### TASK-004 - Webhook audit
- **Owner:** backend-engineer
- **Goal:** Confirm by reading and fix if needed: (a) event row insert and business effect are in one transaction, or a failed effect returns non-2xx so Razorpay retries; (b) unknown event types return 200 without effect; (c) signature compared in constant time on the raw body before any parsing; (d) W01 has no per-IP throttle that can drop retries, while R04/R05/G06 have limits; (e) no logging or error reporter captures raw body, signature header or key secret; (f) `order.paid` and `payment.captured` arriving for the same payment are idempotent.
- **Affected files:** `backend/payments/webhooks.py`, `razorpay_client.py`, `services.py`, rate-limit module, logging config in `settings.py`.
- **Acceptance criteria:**
  - [ ] Written findings, with minimal fixes only where a defect is confirmed.
  - [ ] Replaying the same event id twice yields one effect.
- **Testing:** deferred; the manual replay in TASK-005 covers it.
- **Risk:** medium (money path).

### TASK-005 - Test-mode end-to-end run
- **Owner:** owner (dashboard actions, test cards/UPI) with test-engineer writing the checklist result
- **Goal:** Prove behaviour with real provider responses. Fake mode cannot prove provider behaviour: it does not test real signatures from Razorpay, real webhook delivery and retry, real checkout UI, real error codes or refund timing.
- **Scenarios (record result for each):**
  1. R04 create order; amount, currency INR, order id stored.
  2. Checkout opens (no CSP errors in console), pay with a test card, R05 verify succeeds, registration confirmed.
  3. Webhook `payment.captured` arrives, signature accepted, duplicate delivery (resend from dashboard) is a no-op.
  4. Tampered R05 signature is rejected (`INVALID_SIGNATURE`).
  5. Payment failure (Razorpay failure test card): `payment.failed` handled, user can retry within the hold.
  6. User closes checkout / hold expires: no confirmation, no charge stuck.
  7. Late capture: pay after the hold expired or seat taken; confirm automatic refund is created and `refund.processed` arrives.
  8. Webhook before R05 and R05 before webhook (race): either order ends confirmed once.
  9. Admin refund via G06 with step-up auth: full and partial; `refund.processed` updates state; audit row written.
  10. Refund failure: refund more than refundable or already refunded; UI shows a clear message.
  11. Wrong webhook secret: returns rejection, logged with reason code only.
  12. Reconcile run (command or job) reports no mismatches, then after a deliberately missed webhook (disable webhook, pay) repairs state.
  13. Settings page badge shows expected state (see OQ-3).
- **Acceptance criteria:**
  - [ ] All 13 scenarios pass or are logged as defects with owner.
  - [ ] No secret or full webhook body found in Railway logs.
- **Risk:** medium.

### TASK-006 - CSP and checkout fixes
- **Owner:** frontend-engineer
- **Goal:** Resolve any CSP violation seen in TASK-005 scenario 2 (script, frame, connect, img, form-action for `checkout.razorpay.com`, `api.razorpay.com`, `lumberjack.razorpay.com`), keeping the allowance scoped to `/events/:slug/register` and the flag.
- **Affected files:** `web/src/lib/security/csp.ts`, its test file (update expectations only).
- **Acceptance criteria:**
  - [ ] No CSP violations in a full test payment (card and UPI intent/QR if enabled).
  - [ ] No allowance leaks to other routes when flag is off.
  - [ ] Typecheck and lint pass; no full build.
- **Risk:** medium (loosening CSP; keep minimal, security review in TASK-011).

### TASK-007 - Alerting on payment anomalies
- **Owner:** backend-engineer
- **Goal:** Someone is told when money state is wrong. Cover `payment_mismatch`, `refund_blocked_over_limit`, repeated webhook rejections, refunds pending longer than N minutes, reconcile finding drift.
- **Implementation notes:** smallest option first. Railway log alert on those log keys, or an error-tracker event, or a daily email from the reconcile job to the support/desk address. Pick per OQ-4. Log lines must stay free of PII and secrets.
- **Acceptance criteria:**
  - [ ] Forcing a mismatch (`razorpay_fake_pay` amount override in local DEBUG) triggers the chosen alert.
  - [ ] Documented runbook line: what to do on each alert.
- **Risk:** low to medium.

### TASK-008 - Refund failure handling
- **Owner:** backend-engineer
- **Goal:** Using TASK-005 observations, ensure provider refund errors leave a clear state (`failed` or retried via `payments/jobs.py`), the admin sees a reason code, and the player is not double-refunded.
- **Acceptance criteria:**
  - [ ] Failed refund visible in admin payments with an actionable message.
  - [ ] Retry cannot create a second provider refund (idempotency key or provider refund id guard confirmed).
- **Risk:** medium.

### TASK-009 - Frontend flag and failure states
- **Owner:** frontend-engineer
- **Goal:** With `NEXT_PUBLIC_RAZORPAY_ENABLED` not `true`, the registration panel shows a clear "online payment unavailable" state (no broken button, no checkout script load). Review error copy for declined, cancelled, network failure during verify, and "payment taken but not confirmed yet, do not pay again".
- **Affected files:** `web/src/features/registration/HoldActivePanel.tsx`, checkout component, `lib/api/types/payment.ts`.
- **Acceptance criteria:**
  - [ ] Flag off: no Razorpay script requested, clear message.
  - [ ] Each failure state has actionable copy via the existing `copyFor` pattern.
  - [ ] Typecheck and lint pass.
- **Risk:** low.

### TASK-010 - Stale PLAN-002 note
- **Owner:** backend-engineer (docs only)
- **Goal:** Change `docs/plans/PLAN-002-remaining-work.md` line 25 from "Razorpay: Not started" to reflect built, pending go-live (see PLAN-006).
- **Acceptance criteria:** [ ] one-line edit, nothing else touched.
- **Risk:** none. (This planning task did not edit it.)

### TASK-011 - Pre-go-live gate (deferred until main pages are built)
- **Owner:** test-engineer, security-reviewer
- **Goal:** Gate for TASK-012. Not scheduled now per project rules, but go-live is blocked until done.
- **Tests:** webhook signature accept/reject; idempotent replay; late-capture auto-refund; amount/currency mismatch gives PAYMENT_MISMATCH; refund over-limit; `_integrations` combos; CSP route scoping; step-up required on G06.
- **Security review:** secrets handling and log scrubbing (G8), CSP changes, webhook endpoint exposure, refund authorisation and audit, rate limits, no `RAZORPAY_MODE=fake` reachable in production, env separation of test and live keys.
- **Acceptance criteria:** [ ] tests pass; [ ] no open high/medium findings.
- **Risk:** high if skipped.

### TASK-012 - Live switch (flag off)
- **Owner:** owner
- **Goal:** Production runs live keys but public checkout still disabled.
- **Steps:** generate live Key Id/Secret; create a second webhook in live mode (new secret, same five events); set Railway `RAZORPAY_KEY_ID=rzp_live_...`, secret, webhook secret; keep Vercel `NEXT_PUBLIC_RAZORPAY_ENABLED` false; redeploy; send dashboard test webhook; remove test keys from production env.
- **Acceptance criteria:**
  - [ ] Backend boots, test webhook 200.
  - [ ] Settings page shows Razorpay connected (and live, if OQ-3 adds it).
- **Risk:** medium.

### TASK-013 - First live payment and enable
- **Owner:** owner
- **Goal:** Real-money smoke test, then public enablement.
- **Steps:** create a low-priced or hidden test event (smallest amount allowed, for example INR 1 if the event price rules permit; else owner-only event); enable flag for that run; pay with the owner's own instrument; confirm registration, webhook receipt, admin payment row, dashboard settlement; refund it from admin with step-up; confirm money returns; then enable the flag for public events. Watch logs/alerts for the first real payments.
- **Rollback:** set `NEXT_PUBLIC_RAZORPAY_ENABLED=false` in Vercel and redeploy (checkout disappears, existing confirmed registrations unaffected). For a backend fault, revert to the previous Railway deployment. Do not set `RAZORPAY_MODE=fake` in production (refused by design). Keep webhooks enabled during rollback so in-flight payments still reconcile; run reconcile afterwards and refund any stranded captures from the dashboard or admin.
- **Acceptance criteria:**
  - [ ] Payment, webhook, refund all succeed with real money.
  - [ ] Rollback steps written in DEPLOY-001 (owner decides if doc edit is wanted).
- **Risk:** medium.

---

## 5. Dependency summary and parallelism

```
TASK-001 (KYC, long lead)  -----------------------------\
TASK-002 (test keys, webhook) -> TASK-005 (e2e) -> TASK-006, TASK-008 \
TASK-004 (webhook audit) ---/                                          > TASK-011 (gate) -> TASK-012 -> TASK-013
TASK-003, TASK-007, TASK-009, TASK-010 (independent) ------------------/
```

- Start now in parallel: TASK-001 (owner), TASK-002 (owner), TASK-004, TASK-009, TASK-010. TASK-003 and TASK-007 once OQ-3/OQ-4 are answered.
- Critical path: 001 (KYC) -> 012 -> 013. Engineering path: 004 -> 005 -> 006/008 -> 011.

## 6. Feature acceptance criteria

- [ ] All 13 scenarios in TASK-005 pass in test mode with real test keys.
- [ ] Integration status accurately reflects configuration, including webhook secret.
- [ ] Alerts fire for payment anomalies.
- [ ] Tests and security review (TASK-011) complete before live keys go in.
- [ ] First live payment and refund verified; rollback documented.
- [ ] PLAN-002 note corrected.

## 7. Open questions

| ID | Question | Owner of answer |
|----|----------|-----------------|
| OQ-1 | Is the Razorpay account already created and KYC started? Who is the account holder? | Owner |
| OQ-2 | Is there a staging Railway service for test-mode runs, or does test mode run locally via a tunnel? Can test and live share the same Supabase/DB (no; recommend separate or clear test data before launch)? | Owner |
| OQ-3 | Test vs live indicator on settings page: keep booleans only (AC-68) and treat test keys as Not connected, or add a non-secret `razorpayMode` field? Recommendation: add the mode field, because "Connected" with test keys in production is a silent failure mode. | Owner |
| OQ-4 | Alert channel: Railway log alerts, error tracker, or daily email from reconcile? | Owner |
| OQ-5 | Registration fee minimums and refund policy (`payments.defaultRefundWindowHours` is currently stored but not enforced, see PLAN-005 OQ-1): does go-live need it enforced? | Owner |
| OQ-6 | Are GST invoices, Razorpay fees pass-through, or payment methods restrictions needed at launch? | Owner |

## 8. Blockers

- TASK-001 KYC approval (external) blocks live keys only; all engineering and test-mode work can proceed without it.
- Test-mode e2e (TASK-005) needs a publicly reachable backend URL for webhooks.
- Unverified in this pass: exact webhook path, rate-limit coverage, whether `checkout.js` loads under the current script-src. These are covered by TASK-004/005/006.
