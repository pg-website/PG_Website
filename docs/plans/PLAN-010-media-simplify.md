---
id: PLAN-010
type: plan
feature_id: FEAT-001
architecture_id: ARCH-001
version: 1
status: draft
date: 2026-11-01
---

# PLAN-010: Simplify media (assets only, no user-facing collections)

Owner decision: the Media page manages **assets only**. An event, story or site section picks one or more assets directly (ordered). Galleries are never shared across events. One image is static; two or more is a carousel.

Execution rules (owner memory): backend first, no new mocks, extend the existing Django app, tests and security review after the pages, agents run typecheck and lint only, do not touch other uncommitted files.

## 1. Approach: private per-owner galleries (option A)

Keep `MediaCollection` / `MediaCollectionItem` as internal storage, but each collection is owned by exactly one event, story or site section and is never shown or named in the UI. The API accepts `media: { assetIds: [...], autoplay?, intervalMs? }`; the server creates or updates the owner's private collection. `mode` is derived (1 asset = static, 2+ = carousel). The public read API is unchanged, so `Carousel`, `EventGallery` and `MediaFrame` keep working.

Later option B (drop the tables and store ordered asset lists directly) can follow without UI change.

## 2. Tasks

### Phase B: Backend
- TASK-1001 `adminapi/event_builder.py` (lines ~138, 210, 552-563): accept `media.assetIds` (max `MAX_COLLECTION_ITEMS` = 50), upsert the event's private collection, derive `mode`, return `assetIds` plus asset summaries in the draft read. Publish validation: every asset has alt text or is decorative.
- TASK-1002 `adminapi/cms_service.py` and `editorial_service.py`: same `assetIds` input for site sections and stories.
- TASK-1003 `adminapi/media_service.py` / `views_media.py` / `urls.py`: remove the public admin collection endpoints (list, create, patch, delete) or leave them unrouted; assets endpoints stay. Asset `usedBy` keeps reporting events, stories and sections (drop the `collection` kind).
- TASK-1004 Data migration: mark existing shared collections as owned by their single user; if one collection is used by several owners, clone it per owner. Update the OpenAPI file and `ENDPOINTS-IMPLEMENTED.md`.

### Phase F: Frontend
- TASK-1010 `lib/api/types/admin/media.ts`, `event-builder.ts`, `site-content.ts`, `stories.ts`, `response-schemas.ts`, `pg-admin-api.ts`, `adapters/real-admin.ts`, `query/keys.ts`, `query-options/admin.ts`: replace `collectionId` with `assetIds`; remove collection admin calls and schemas.
- TASK-1011 New shared `AssetListField` (multi-select from the asset library, upload inline, drag to reorder, remove, first = cover, alt-missing warning, 50 cap). Base it on `features/cms/MediaPickerDialog.tsx` and `MediaSlotField.tsx`.
- TASK-1012 Event builder `MediaStep.tsx`: use `AssetListField`; remove the Display select (derive it), keep an optional autoplay toggle shown when 2 or more. Delete `CollectionField`, `CollectionThumbs`, `NewCollectionPanel`. Update `ReviewSummary`, `SeoPreview`, `step-schemas.ts`.
- TASK-1013 CMS slots (`features/cms`): use `AssetListField` where a slot allows several images; delete `picker/CollectionChoices.tsx`.
- TASK-1014 Media page: remove the Collections tab, `CollectionsTab`, `CollectionDetail`; render the assets grid directly with upload as the primary action; update copy ("Upload once, set alt text, then add to events and pages").
- TASK-1015 `event-control/gallery/GalleryTab.tsx`: switch to assets.
- TASK-1016 Remove collection seeds from `lib/mock/seeds/{media,events,site}.ts` only where the types no longer compile.

### Phase Q (after pages, per owner rule)
- TASK-1020 Update `patch.test.ts`, `store.test.ts`, `review.test.ts`, `admin.test.ts`, `events.test.ts`; add backend tests for derived mode, the 50 cap and the alt check.
- TASK-1021 Security review: ownership of assets and galleries, no cross-owner asset leakage, reorder and idempotency.

## 3. Risks
- Existing shared collections need cloning (TASK-1004); verify on a DB copy first.
- Public pages cache revalidation (`content/revalidation.py`, `signals.py`) must fire on asset-list changes.
- The working tree already has uncommitted edits to `MediaStep.tsx`, `AssetEditPanel.tsx`, `ReviewSummary.tsx`, `step-schemas.ts`, `event_builder.py`, and `keys.ts`. Coordinate with the owner before editing them.

## 4. Decisions
- Resolved: no shared galleries; assets-only Media page; mode derived from count.
- Open: keep the autoplay toggle (default off, 5000 ms), or always autoplay carousels?
