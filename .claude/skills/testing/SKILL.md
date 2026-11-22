---
name: testing
description: How to write and run tests in this repo, Django 6.1 backend and Next.js 16 web app. Use when writing, running or reviewing tests.
---

# Testing Skill

## Purpose
Verify an implementation against its acceptance criteria with tests that fail for the right reason. Stack: Django 6.1 + DRF on PostgreSQL (`backend/`), Next.js 16 + React 19 + TypeScript (`web/`).

## Before writing anything
1. Read the requirements, acceptance criteria and the implementation diff (`git diff`, `git log`).
2. List cases: happy path, edge cases, error paths, and what must NOT happen (auth, locked fields, step-up).
3. Check for an existing test file next to the code. Extend it rather than starting a new one.
4. Decide the cheapest layer that proves the behaviour (see the table). Do not reach for e2e when a pure-function test does it.

| Behaviour | Layer | Where |
|---|---|---|
| Pure logic (pairing, tie-breaks, patch/diff, env parsing) | unit | `*.test.ts` (web), `SimpleTestCase` (backend) |
| React component, a11y, forms | component | `*.test.tsx` |
| API endpoint, permissions, DB writes | integration | Django `TestCase` |
| A real browser flow, CSP, prerender | e2e | `web/e2e/*.spec.ts` |

## Backend (Django test runner, not pytest)
- Runner: `python manage.py test <app>[.module]`. There is no pytest or pytest-django in `requirements.txt`. Do not add them.
- Use the virtualenv: `backend/venv/Scripts/python.exe manage.py ...` (system Python has no Django).
- Pure functions: `django.test.SimpleTestCase`, no database. See `registrations/test_tiebreaks.py`.
- Anything touching models: `django.test.TestCase`. It needs PostgreSQL (settings use `django.db.backends.postgresql` with `DB_*` env vars). Run `--keepdb` locally. If no database is reachable, say so. Do not report DB tests as passing.
- Files are `test_*.py` inside the app. Name tests for behaviour (`test_bye_counts_as_a_win`), not implementation.
- Hand-work fixtures and assert exact numbers. If a fixture does not prove what the test claims, fix the fixture. Never weaken the assertion to make it pass.
- Auth: admin endpoints need an admin user. Role changes, password resets and user creation need a step-up grant (`require_step_up`) and an `Idempotency-Key`. Test the missing-step-up case too.
- Before finishing: `python manage.py check` and `python manage.py makemigrations --check --dry-run`.

## Frontend (vitest 5 + Testing Library)
- Run: `npm test` (all), `npx vitest run <path>` (one file). Never `npx vitest` without `run` in a one-shot command, it stays in watch mode.
- Two projects (`vitest.config.ts`): `*.test.ts` runs in **node**, `*.test.tsx` runs in **jsdom** with cleanup from `src/test/setup.ts`. Put pure logic in `.ts` tests, components in `.tsx`.
- Globals are off: import `describe`, `it`, `expect`, `vi` from `vitest`.
- Components: `@testing-library/react` + `@testing-library/user-event`. Query by role and name, not by class or test id. Add `expectNoAxeViolations` from `@/test/axe` for anything interactive.
- Imports use the `@/*` alias. Server-only modules are stubbed by `src/test/server-only.ts`.
- Colocate: `Foo.tsx` -> `Foo.test.tsx`; `logic.ts` -> `logic.test.ts`.
- If the same logic exists in both stacks (tie-breaks do), use the same fixture and expected numbers in both tests so drift shows up.

## E2E (Playwright)
- `npm run e2e` runs against `next build && next start` in **mock mode**. Admin pages have no mocks (they always call the real backend), so admin flows cannot run here.
- Specs live in `web/e2e/`. Suffix `.raw.spec.ts` = JavaScript disabled, run once. `.selftest.spec.ts` = helper tests, run once. Other specs run once per viewport.
- Needs `npm run e2e:install` once. E2E is slow: do not run it for a change a unit test covers.

## Repo checks to run before reporting done
- Web: `npm run typecheck`, `npm run lint`, `npm test`. `npm run check` runs everything plus format, dependency-cruiser and tokens. Do **not** run `npm run build`, the owner runs one build per batch.
- Backend: `manage.py check`, `makemigrations --check --dry-run`, the affected test modules.
- Report real numbers (files/tests passed and failed). If a test fails, say whether your change caused it. Compare against a clean tree before claiming a failure is pre-existing. Do not `git stash` with a dirty tree to find out, read the failure instead.

## Known traps
- `src/lib/api/pg-api.test.ts` counts admin API methods and the schema registry. Adding a method to `PgAdminPlayersApi` or any admin group requires updating those counts and the registry entries.
- A `startTransition(async ...)` around a step-up call deadlocks the "Confirm it is you" prompt. Use a plain promise plus a pending flag. A component test cannot catch it without the real prompt mounted.
- Public pages cache for 15 minutes (`revalidate = 900`). A passing test does not mean the live site shows the change.
- Do not mock the database in backend integration tests. Mocked tests passed before and the real behaviour broke.

## Output
- List what was added or changed, what ran, and the result (counts).
- Flag anything untested and why, and anything you could not run (no database, no browser).
- Do not edit production code to make a test pass. Report the defect instead.
