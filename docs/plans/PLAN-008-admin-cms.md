---
id: PLAN-008
type: plan
feature_id: FEAT-001
architecture_id: ARCH-001
version: 1
status: draft
date: 2026-11-01
---

# PLAN-008: Admin CMS (screens 33, 35, 36; routes `/admin/content`, `/admin/stories`, `/admin/testimonials`)

Note on numbering: PLAN-005, 006 and 007 are already used by the dated plan files (admin-settings, razorpay-go-live, player-card-profile), so this is the next free number, PLAN-008. It covers PLAN-002 FE-20 (TASK-073), FE-21 (TASK-074) and FE-22 (TASK-075), and FR-37, FR-16, FR-19, AC-52, AC-16.

**Execution rules (owner memory):** backend first, no new mocks, extend the existing Django app. Tests and security reviews are deferred until the main pages are built (section 7). Agents run typecheck and lint only; the owner runs one build per batch. Legacy `src/` is not referenced. Do not touch the owner's other uncommitted files (event-builder, AssetEditPanel, registrations).

## 1. Scope: CMS content types managed

Sources: FEAT-000 section 2.12 (F-ACMS-001 to 004, 009, 010), FEAT-001 FR-37/FR-19/FR-16, `Frontend reference/docs/CMS-SPEC.md`.

| Type | Keys / shape | Screen |
|---|---|---|
| Site sections | fixed keys `home`, `community`, `nav`, `footer`, `meta` (typed content, no HTML); draft/publish/versions/conflict | 33 `/admin/content` |
| Legal pages | `privacy`, `terms`, `refund-policy`: title, closed content blocks, effective date; draft/publish | 33 (legal tab) |
| Stories | kind, slug (lock after first publish), eyebrow, title, dek, closed block body, reading time, featured, media collection | 35 `/admin/stories` |
| Testimonials | name, descriptor, exact quote, portrait asset, consent, sort order; publish gate | 36 `/admin/testimonials` |
| Draft preview | PV01 preview link opens site in draft mode | all three |

Out of scope here: Media library (done, see 2026-10-30-media-library.md), event public copy (event builder), settings (PLAN-005).

## 2. Gaps vs what exists (verified in code)

### Backend: essentially complete (BE-08, PLAN-002 row 9 marked done)
- `backend/adminapi/urls.py` lines 42-58 mount S01-S06, S13-S16; `views_cms.py`, `cms_service.py`, `editorial_service.py`, `content/validation.py` (`SITE_KEYS`, `LEGAL_PAGES`).
- PV01 `POST /api/admin/preview-link` and `POST /api/preview/exchange` exist (`preview_service.py`, `content/preview.py`).
- Publish writes revalidation outbox row in the same transaction (cms_service docstring). All rows "Matches" in `docs/architecture/pgapi-contract/ENDPOINTS-IMPLEMENTED.md` lines 87-107.
- Media picker endpoints S07-S12 exist (media library is built).

Backend gaps to verify or close (small):
- G1. No documented story-slug availability endpoint; FE-21 spec asks for "slug availability check". Only `SLUG_TAKEN` on write is known. Needs a decision (OQ-3).
- G2. Contract note F5 in `BACKEND_INTEGRATION_STATUS.md` (S04 returns `published`, web earlier expected `clean`): web `cms.ts` already uses `published`; confirm and close the doc item.
- G3. No `sortOrder` reorder endpoint is evident for testimonials beyond PATCH field; confirm PATCH accepts `sortOrder`.
- G4. Dev preview requires https origins (ENDPOINTS-IMPLEMENTED line 205); needs a web-side dev relaxation or https env.
- G5. Legal publish gate for unapproved wording (OQ-04 of FEAT-001) is a process gate only, nothing enforced.

### Frontend: types and client done, UI missing
- Done: `web/src/lib/api/types/admin/{cms,stories,testimonials}.ts`, `pg-admin-api.ts` (`cms`, `stories`, `testimonials`, `preview`), `adapters/real-admin.ts`, `response-schemas.ts`, query options in `lib/query/query-options/admin.ts` (lines 131-218; no mutations seen), nav item in `adminNav.ts`, routes in `routes.ts`, shared `components/admin/SaveBar.tsx`, `SplitWorkspace.tsx`, `ui/table/ResponsiveTable.tsx`.
- Missing: all three pages are `<PlaceholderPage>` (`web/src/app/(admin)/admin/content|stories|testimonials/page.tsx`); no `web/src/features/cms`, `stories-admin`, `testimonials-admin`; no mutation hooks; no block editor; no media picker component for CMS use (check `features/admin/media` and event-builder MediaStep for reuse before creating).

## 3. Data model and endpoint list (all existing unless marked)

Models (existing, `backend/content/models.py`): `SiteSection` (live), `LegalPage` (live), `ContentDraft` (kind, key, version lock, change_summary, updated_by), `ContentVersion` (immutable publish history), Story, Testimonial, `MediaAsset`, `MediaCollection`.

| ID | Method and path | Notes |
|---|---|---|
| S01 | GET `/api/admin/cms/sections` | rows: key, status clean/draft/published, version |
| S02 | GET `/api/admin/cms/sections/{key}` | published + draft side by side, lastChange |
| S03 | PUT `/api/admin/cms/sections/{key}/draft` | `{version, content}`; VERSION_CONFLICT |
| S04 | POST `.../publish` | Idempotency-Key required; NO_DRAFT, NO_CHANGES |
| S05 | GET `.../versions` | paged history |
| S06 | GET/PUT `/api/admin/legal/{page}`, POST `.../publish` | |
| S13 | GET/POST `/api/admin/stories`, GET/PATCH `/{id}` | SLUG_TAKEN, SLUG_LOCKED |
| S14 | POST `/stories/{id}/publish` (IK), `/unpublish` | |
| S15 | GET/POST `/api/admin/testimonials`, GET/PATCH `/{id}` | |
| S16 | POST `/testimonials/{id}/publish` (IK), `/unpublish` | CONSENT_REQUIRED, ASSET_ARCHIVED |
| PV01 | POST `/api/admin/preview-link` | |
| NEW? | GET slug availability for stories | only if OQ-3 says yes |

## 4. Tasks (dependency ordered)

IDs are PLAN-local (CMS-xx) to avoid collision with TASK-0xx numbers in PLAN-001.

### Phase A: Backend (backend-engineer)

**CMS-B1: Backend conformance sweep for CMS endpoints** (backend-engineer, S, deps none, risk low)
- Goal: close G2, G3, G5 by reading code and a manual request pass; fix any drift between `web/src/lib/api/types/admin/*` and DRF responses.
- Files: `backend/adminapi/cms_service.py`, `editorial_service.py`, `views_cms.py`, `docs/architecture/pgapi-contract/ENDPOINTS-IMPLEMENTED.md`, `docs/BACKEND_INTEGRATION_STATUS.md`.
- Acceptance: testimonial PATCH accepts `sortOrder`; F5 closed in docs; S02 with no live copy and no draft returns a valid shape for each of 5 keys and 3 legal pages (seed or empty-state safe); changes listed in ENDPOINTS-IMPLEMENTED.
- Testing: deferred (section 7); manual curl or Django shell only.

**CMS-B2: DROPPED (owner decision, OQ-3). Do not build.** Original scope kept for reference:
**Story slug availability check** (backend-engineer, S, deps CMS-B1, risk low)
- Goal: `GET /api/admin/stories/slug-check?slug=&excludeId=` returning `{available}`; AdminView default deny.
- Files: `backend/adminapi/views_cms.py`, `editorial_service.py`, `urls.py` (register before `stories/<str:story_id>`), `docs/api/pg-chess-backend.openapi.yaml`, `web/src/lib/api/pg-admin-api.ts` + `adapters/real-admin.ts` + `response-schemas.ts` (type only, owned by CMS-F1).
- Acceptance: unavailable for existing slug excluding itself; invalid slug returns VALIDATION_FAILED; documented in contract.
- Skip this task if the owner accepts SLUG_TAKEN on save only.

**CMS-B3: Seed/initial content check for sections and legal pages** (backend-engineer, S, deps CMS-B1, risk medium)
- Goal: confirm the public site reads real published content (fallback bundled copy today); provide a management command or data migration seeding initial published `home/community/nav/footer/meta` and legal placeholders so the editor opens on real data. Only if OQ-5 says seed from bundled copy.
- Files: `backend/content/management/commands/` (new), `backend/content/models.py` (read only).
- Acceptance: running the command is idempotent; admin S01 shows 5 rows with published content; no legal wording is invented (legal stays unpublished until owner approval).

### Phase B: Frontend (frontend-engineer); all depend on CMS-B1

**CMS-F1: Mutation hooks and shared CMS plumbing** (S, deps CMS-B1; B2 if used)
- Goal: `useMutation` hooks for save draft, publish (generates Idempotency-Key), conflict handling, preview link, story and testimonial create/patch/publish/unpublish with cache invalidation by `qk.admin.*`.
- Files: `web/src/features/cms/hooks/*.ts`, `web/src/lib/query/query-options/admin.ts` (extend only), `web/src/lib/query/keys.ts` if needed.
- Acceptance: typecheck/lint clean; VERSION_CONFLICT surfaces a typed conflict state; a successful publish invalidates section, list and versions queries; no mocks added.

**CMS-F2: Content page shell, section list and version-aware editor frame** (M, deps CMS-F1)
- Goal: replace placeholder at `web/src/app/(admin)/admin/content/page.tsx`; `features/cms/ContentAdminPage.tsx` using `SplitWorkspace`: list of 5 sections + 3 legal pages with status badge; `SaveBar` states clean, dirty, validation blocked, saved-not-published, published, conflict; unsaved-changes guard; skeleton, empty, error states.
- Files: `web/src/app/(admin)/admin/content/page.tsx`, `web/src/features/cms/{ContentAdminPage,SectionList,SectionEditorFrame,useDirtyGuard}.tsx`.
- Acceptance: AC-52 state list reachable with the real backend; leaving dirty warns; no horizontal scroll at 320px; text-only inputs (no HTML); server-driven only.

**CMS-F3: Per-section field editors (lazy chunks)** (L, deps CMS-F2; split per section if too large)
- Goal: typed forms for `home`, `community`, `nav`, `footer`, `meta`, matching `siteSectionDtoSchema` in `lib/api/types/site-content.ts`; each editor lazy-loaded (`next/dynamic`); media collection slots use the picker (CMS-F4).
- Files: `web/src/features/cms/editors/{HomeEditor,CommunityEditor,NavEditor,FooterEditor,MetaEditor}.tsx`, `web/src/features/cms/fields/*`.
- Acceptance: draft payload parses with `saveCmsDraftSchema`; array fields (nav links, proof points) add/remove/reorder with keyboard access; field errors from `VALIDATION_FAILED` map to inputs.

**CMS-F4: Media picker for CMS and stories** (M, deps CMS-F1; reuse `features/admin/media`)
- Goal: select an asset or collection (including archived warnings) from the existing media library for section slots, story media and testimonial portrait.
- Files: `web/src/features/cms/MediaPickerDialog.tsx` (reuse list queries from `features/admin/media`); check event-builder `MediaStep.tsx` first and extract rather than duplicate (do not edit the owner's modified event-builder files; wrap or import only).
- Acceptance: returns asset id or collection id; archived assets not selectable; alt text visible.

**CMS-F5: Legal page editor + closed block editor** (M, deps CMS-F2, CMS-F4)
- Goal: editor for title, effective date, closed `contentBlocksSchema` blocks (add/reorder/remove; no HTML); shared with stories body.
- Files: `web/src/features/cms/blocks/BlockEditor.tsx`, `web/src/features/cms/legal/LegalEditor.tsx`.
- Acceptance: only block types in `lib/api/types/content-blocks.ts` offered; link scheme restricted per schema; publishing a legal page first opens a confirm dialog ("This is a legal page, are you sure?"); no other gate (OQ-4); publish uses IK.

**CMS-F6: Conflict dialog + optional read-only version list** (S-M, deps CMS-F2)
- Scope note (OQ-6): version list is read-only, no restore, and may be skipped if not quick. The conflict dialog is required.
- Goal: S05 history list (paged, read-only) and conflict dialog showing the other version ("see other version", reload, never silent overwrite).
- Files: `web/src/features/cms/{VersionHistory,ConflictDialog}.tsx`.
- Acceptance: VERSION_CONFLICT shows editor name and time from `lastChange`; user chooses reload or keep local copy as a new edit.

**CMS-F7: Preview link action** (S, deps CMS-F2)
- Goal: "Preview draft" button via PV01 opening new tab. Verified on the deployed environment only (OQ-8); no dev https/http work.
- Files: `web/src/features/cms/PreviewButton.tsx`, `web/src/lib/api/types/admin/preview.ts` (only if G4 relaxation chosen).
- Acceptance: link opens site draft; button disabled when no draft; error state shown.

**CMS-F8: Stories admin** (L, deps CMS-F1, CMS-F4, CMS-F5; CMS-B2 optional)
- Goal: list (filters status/kind/search, `ResponsiveTable`) + editor (kind, eyebrow, title, dek, slug with lock UI, block body, reading minutes, featured, media), create, save, publish, unpublish, preview.
- Files: `web/src/app/(admin)/admin/stories/page.tsx`, `web/src/features/stories-admin/*`.
- Acceptance: slug locked after first publish with explanation; SLUG_TAKEN shown at the slug field; NOT_PUBLISHABLE lists missing fields; featured toggle; draft title may be empty.

**CMS-F9: Testimonials admin** (M, deps CMS-F1, CMS-F4)
- Goal: metric strip, list/editor rows (portrait, name, descriptor, exact quote, consent checkbox, sort order), publish/unpublish, live layout preview (1-3 grid, 4+ carousel, none = section omitted).
- Files: `web/src/app/(admin)/admin/testimonials/page.tsx`, `web/src/features/testimonials-admin/*`.
- Acceptance: publish blocked client-side and server-side without quote, photo, consent, name, descriptor; server codes `CONSENT_REQUIRED`, `ASSET_ARCHIVED` displayed; no automatic quote editing.

**CMS-F10: Wire nav, routes, metadata and dashboard CMS health** (S, deps F2, F8, F9)
- Goal: confirm `adminNav.ts`, `routes.ts`, route metadata; remove `PlaceholderPage` use for the three routes; link admin dashboard CMS attention item if present.
- Files: `web/src/components/layout/admin/adminNav.ts`, `web/src/lib/routes/routes.ts`, `web/src/features/admin/dashboard/*` (read first).
- Acceptance: typecheck/lint clean; three routes render real pages.

## 5. Dependency and parallel summary

```
CMS-B1 -> (B2, B3 optional, parallel) 
CMS-B1 -> CMS-F1 -> CMS-F2 -> F3, F5(needs F4), F6, F7 (parallel)
CMS-F1 -> CMS-F4 -> F5, F8, F9
F5 -> F8;  F2/F8/F9 -> F10
```
(B2 dropped: now 12 tasks, 2 backend + 10 frontend.) Parallel: B3 alongside F1; after F1, F4 runs alongside F2; after F2, F3, F6, F7 in parallel; F8 and F9 in parallel once F4/F5 (F9 needs only F4). 13 tasks total (3 backend, 10 frontend). Frontend can be batched in 3 owner builds: (F1,F2,F4), (F3,F5,F6,F7), (F8,F9,F10).

## 6. Open questions for the owner

All resolved by the owner (2026-11-01).

1. OQ-1 RESOLVED: Section set is fixed (home, community, nav, footer, meta + 3 legal pages). Hospitality, principles, FAQ live inside `home`/`community` content.
2. OQ-2 RESOLVED: Closed block model is final. Ship paragraph, heading, list, image first; add other types later.
3. OQ-3 RESOLVED: No live slug check; `SLUG_TAKEN` on save is enough. **CMS-B2 is dropped.**
4. OQ-4 RESOLVED: Publishing a legal page shows a confirm dialog ("This is a legal page, are you sure?"). No second approver, no backend gate. Legal-text owner (PLAN-001 Q9): Sai Ram, named by the owner 2026-11-01. Sai Ram approves legal wording before an admin publishes.
5. OQ-5 RESOLVED: Seed initial content (CMS-B3 stays). Legal pages stay unpublished.
6. OQ-6 RESOLVED: Old versions are not needed now. Show a read-only version list only if S05 makes it quick; no restore. Conflict dialog stays (data safety).
7. OQ-7 RESOLVED: Admin only. No editor role.
8. OQ-8 RESOLVED: Preview is tested on the deployed environment only; no local https or http relaxation work.
9. OQ-9 RESOLVED: Build from CMS-SPEC.md and the existing admin look; owner reviews the first batch and adjusts.

## 7. Deferred phases (not blocking)

- Tests: backend (cms_service publish/conflict, testimonial consent gate, slug lock), web unit (zod drafts, hostile fixtures AC-13/AC-102), Playwright AC-16/AC-25/AC-52 publish-to-visible and conflict scenarios.
- Security review: CMS rendering/XSS (SEC-001 F-14), draft-preview token exchange, admin default-deny audit, idempotency on publish.
- Accessibility pass and mobile E2E (PLAN-001 R5).

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Block editor (F5) is the largest unknown | M/H | Reuse closed model only; ship paragraph/heading/list/image first if time-boxed |
| Draft and public schema drift (resolved collection vs reference) | M | S03 accepts both (documented); editor sends the shape it received |
| Conflict UX loses user edits | H | Keep local copy until user chooses; never auto-overwrite |
| Dev preview needs https | L | OQ-8 |
| Legal text published unapproved | H (legal) | OQ-4 process gate; seed leaves legal unpublished |
| Reusing event-builder media code touches owner's uncommitted files | M | Import only, never edit those files |
| Idempotency-Key reuse on retry | M | Generate key per publish intent in CMS-F1 |
| Large L tasks (F3, F8) exceed one session | M | Split per section/per concern when assigned |
