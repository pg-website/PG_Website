# Media Library — Implementation Plan

**Date:** 2026-10-30  
**Feature:** Admin Media Library (`/admin/media`)  
**Scope:** Frontend only — backend and API adapter layers are complete.

---

## Context

The backend is fully implemented (`views_media.py`, routes in `urls.py`). All Zod schemas live in `web/src/lib/api/types/admin/media.ts`. All adapter methods exist in `real-admin.ts` (lines 279–309). Query options for media already exist in `query-options/admin.ts` (lines 161–191): `adminMediaAssetsQuery`, `adminMediaCollectionsQuery`, `adminMediaCollectionsPickerQuery`, `adminMediaCollectionQuery`.

The page at `web/src/app/(admin)/admin/media/page.tsx` currently renders `<PlaceholderPage routeId="admin-media" />`.

---

## Visual reference

Screen `34-admin-media.html` shows:
- `work-head` header: eyebrow `MEDIA LIBRARY`, h1, description, **Upload media →** button
- Two-column `two-col` layout:
  - **Left column** (`ASSETS`): search input + photo thumbnail grid (`media-list-static` / `media-tile`)
  - **Right column** (`COLLECTION`): collection name h2, form fields for mode / autoplay / interval / focal / alt text

The reference conflates assets and collections in the same right-panel. Based on the API types, the correct interpretation is:
- Selecting an **asset** opens **AssetEditPanel** (alt, decorative, credit, status, focal)
- The right column in the reference screenshot is actually a **CollectionDetail** — this will be reached via a separate tab or by clicking a collection row.

---

## Dependency graph

```
TASK-001 (no deps)
    └─ TASK-002  ─── TASK-003 (AssetsTab)
                         └─ TASK-004 (UploadFlow) ─ merged into TASK-003
                         └─ TASK-005 (AssetEditPanel)
    └─ TASK-006 (CollectionsTab)
                         └─ TASK-007 (CollectionDetail)
TASK-008 (wire page.tsx) — depends on TASK-002, TASK-003, TASK-005, TASK-006, TASK-007
```

Tasks 003 + 004 can be done in parallel with 005.  
Tasks 006 + 007 can be done in parallel with 003–005.  
TASK-008 is the integration gate.

---

## Tasks

---

### TASK-001 — Query-options audit (already done — skip)

All four media query options already exist in `query-options/admin.ts`. **No work needed.**

---

### TASK-002 — Scaffold `MediaLibraryPage` feature shell

**Effort:** S  
**Owner:** frontend-engineer  
**Status:** todo

**Goal:** Create the top-level client component that owns the page layout (header + tab switcher) and is imported by `page.tsx`.

**Affected files:**
- `web/src/features/admin/media/MediaLibraryPage.tsx` ← **create**

**Implementation notes:**
- `'use client'` component.
- Render `<PageIntro>` with eyebrow `MEDIA LIBRARY`, h1 `Photographs are content, not decoration.`, and body copy from the reference.
- Add an **Upload media** `<Button variant="primary">` in the `PageIntro` action slot. Wire it to open the upload dialog (implemented in TASK-003). Pass an `onUploadClick` prop down; the trigger lives here, the logic in the upload hook.
- Render an `assets | collections` tab switcher using local `useState<'assets' | 'collections'>`.
- Render `<AssetsTab onUploadClick={...} />` or `<CollectionsTab />` based on active tab.
- `<AssetsTab>` and `<CollectionsTab>` are stub imports at this stage (they will exist after TASK-003/TASK-006).

**Acceptance criteria:**
- Page renders header and tab switcher without errors.
- Switching tabs swaps the panel (no routing change needed — single-page tabs).

**Dependencies:** none  
**Risk:** Low

---

### TASK-003 — `AssetsTab` — searchable thumbnail grid + upload trigger

**Effort:** M  
**Owner:** frontend-engineer  
**Status:** todo

**Goal:** Render the paginated, searchable asset grid. Allow selecting an asset (sets selection state, opens `AssetEditPanel`). Expose upload trigger.

**Affected files:**
- `web/src/features/admin/media/AssetsTab.tsx` ← **create**
- `web/src/features/admin/media/AssetTile.tsx` ← **create**

**Adapter methods used:**
- `admin.media.listAssets(query)` via `adminMediaAssetsQuery`

**Query keys used:**
- `qk.admin.mediaAssets(query)` (from `query-options/admin.ts` `adminMediaAssetsQuery`)

**Implementation notes:**
- Props: `onUploadClick: () => void`.
- Local state: `q: string` (debounced 350 ms, matching `CollectionField.tsx` pattern), `selectedId: string | null`, `page: number`.
- Use `useQuery(adminMediaAssetsQuery(api.admin, { q: debouncedQ, page }))` — wrap with `<QueryView>` (already used in Dashboard) for loading / error states.
- Render a CSS grid of `<AssetTile>` components (thumbnail `<img>`, filename label beneath, selected ring on click).
- `AssetTile` props: `asset: MediaAssetDto`, `selected: boolean`, `onClick: () => void`. Show a warning badge if `asset.alt === null && !asset.decorative` (missing alt).
- Pagination: previous/next buttons driven by `pagination` in the response.
- Pass `selectedId` up via an `onSelect` prop to `MediaLibraryPage`, which then opens `AssetEditPanel`.
- Use `contain-intrinsic-size` CSS hint on tiles for off-screen rendering perf (rule 6.2).

**Acceptance criteria:**
- Grid renders real assets from the API.
- Search filters with debounce; page resets to 1 on new search.
- Selecting a tile highlights it; unselecting by clicking again or pressing Escape clears selection.
- Assets with missing alt text show a visual indicator.

**Dependencies:** TASK-002  
**Risk:** Low-Medium (pagination + debounce state)

---

### TASK-004 — `useUploadFlow` — 3-step upload hook

**Effort:** M  
**Owner:** frontend-engineer  
**Status:** todo

**Goal:** Encapsulate the signed-URL upload flow. Returns a function `upload(file)` and state `{ status, progress, error }`.

**Affected files:**
- `web/src/features/admin/media/useUploadFlow.ts` ← **create**

**Adapter methods used:**
1. `admin.media.requestUpload(UploadRequest)` — get `UploadTicket`
2. `PUT uploadTicket.uploadUrl` with file bytes + headers from ticket (direct fetch, NOT through the API adapter)
3. `admin.media.completeUpload(assetId)` — notify server

**Implementation notes:**
- Accept `file: File` and return a Promise that resolves to the completed `MediaAssetDto`.
- Step 1: Validate file type (against `MEDIA_CONTENT_TYPES`) and size (≤ `MAX_UPLOAD_BYTES`) before any network call. Throw a typed `UploadError` on violation.
- Step 2: `requestUpload({ filename: file.name, contentType, sizeBytes: file.size })`.
- Step 3: `fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: file })`. Track `XMLHttpRequest` upload progress via `xhr.upload.onprogress` for a progress percentage (0–100).
- Step 4: `completeUpload(ticket.assetId)`.
- After success: call `queryClient.invalidateQueries({ queryKey: qk.admin.mediaAssets() })` to refresh the grid.
- Expose `progress: number | null` (null when idle), `status: 'idle' | 'uploading' | 'completing' | 'done' | 'error'`, `error: string | null`.
- The hook should allow a single concurrent upload (block re-entry while in-flight).

**Acceptance criteria:**
- Valid file → asset appears in the grid after completion.
- File too large or wrong type → immediate client-side error without network call.
- Storage PUT failure → surfaces error message.
- `completeUpload` failure → surfaces error and leaves asset in `draft` status (user can retry).

**Dependencies:** TASK-002  
**Risk:** Medium (direct fetch to Supabase; CORS headers must match ticket)

---

### TASK-005 — `AssetEditPanel` — right-side detail panel

**Effort:** M  
**Owner:** frontend-engineer  
**Status:** todo

**Goal:** Show the selected asset's metadata and allow editing alt text, decorative flag, credit, status, and focal point display. Save via PATCH.

**Affected files:**
- `web/src/features/admin/media/AssetEditPanel.tsx` ← **create**

**Adapter methods used:**
- `admin.media.updateAsset(assetId, UpdateMediaAsset)` (mutation)
- `admin.media.deleteAsset(assetId)` (mutation — archive flow)

**Query keys invalidated after save:**
- `qk.admin.mediaAssets()` (list refresh)

**Implementation notes:**
- Props: `assetId: string | null` — renders empty/placeholder when null.
- Fetch the selected asset from the already-loaded list data (no separate query needed; look up by id from the cached `listAssets` response).
- Form fields (use `react-hook-form` with `zodResolver(updateMediaAssetSchema.partial())`):
  - `alt` — textarea, disabled when `decorative: true`
  - `decorative` — checkbox; toggling to `true` clears alt field
  - `credit` — text input (nullable)
  - `status` — `<Select>` (draft / published / archived); guard: cannot publish without alt or decorative
  - `focal` — display only as `{x}% / {y}%` (read-only from asset, writeable in future focal-point picker task)
- Show `usageCount` + `usedBy` list (up to 20 entries) below the form as a read-only "Used by" section.
- Save button calls `updateAsset`; on success invalidate list query and show success toast.
- Delete button: disabled if `usageCount > 0` (show tooltip "Remove from all collections first"). If 0, confirm via `<ConfirmDialog>` then `deleteAsset` and clear selection.
- Optimistic update pattern: update form `version` from response to allow immediate re-saves.

**Acceptance criteria:**
- Selecting an asset fills the panel.
- Toggling decorative disables/clears alt field.
- Cannot publish without alt or decorative (form-level validation).
- Save PATCH succeeds; version bumps; list tile reflects updated alt state.
- Delete only available when usageCount is 0; clears selection after success.

**Dependencies:** TASK-003  
**Risk:** Medium (version-conflict handling, decorative/alt logic)

---

### TASK-006 — `CollectionsTab` — list + create form

**Effort:** S  
**Owner:** frontend-engineer  
**Status:** todo

**Goal:** Show the full list of media collections; allow creating a new collection inline.

**Affected files:**
- `web/src/features/admin/media/CollectionsTab.tsx` ← **create**
- `web/src/features/admin/media/CreateCollectionForm.tsx` ← **create**

**Adapter methods used:**
- `admin.media.listCollections()` via `adminMediaCollectionsQuery`
- `admin.media.createCollection(CreateMediaCollection)` (mutation)

**Query keys:**
- `qk.admin.mediaCollections()` (list)

**Implementation notes:**
- Render a list of collection rows: `name`, `mode`, item count, `updatedAt`. Each row is clickable — sets `selectedCollectionId` state, which renders `CollectionDetail` (TASK-007) in a right panel (same two-col layout as assets tab).
- **CreateCollectionForm**: minimal `react-hook-form` form — `name` (text), `mode` (select: static / carousel), `autoplay` (checkbox), `intervalMs` (number, only shown when mode = carousel). `items` defaults to `[]`; user adds items after creation via `CollectionDetail`.
- On create success: invalidate `qk.admin.mediaCollections()` and auto-select the new collection.
- Reuse `adminMediaCollectionsQuery` — this is the non-infinite version (full list up to 100, sufficient for admin).

**Acceptance criteria:**
- Collections list loads and renders.
- Create form validates name (min 1, max 120), intervalMs bounds (2000–60000).
- After creation, new collection appears selected in the detail panel.

**Dependencies:** TASK-002  
**Risk:** Low

---

### TASK-007 — `CollectionDetail` — settings + item management

**Effort:** L  
**Owner:** frontend-engineer  
**Status:** todo

**Goal:** Show and edit a collection's name/mode settings and manage its ordered item list (add from asset library, reorder, remove).

**Affected files:**
- `web/src/features/admin/media/CollectionDetail.tsx` ← **create**
- `web/src/features/admin/media/CollectionItemGrid.tsx` ← **create**

**Adapter methods used:**
- `admin.media.getCollection(id)` via `adminMediaCollectionQuery`
- `admin.media.updateCollection(id, UpdateMediaCollection)` (mutation — settings and item list together)

**Query keys:**
- `qk.admin.mediaCollection(id)`
- Invalidate `qk.admin.mediaCollections()` after save (list shows item count)

**Implementation notes:**
- Props: `collectionId: number`.
- Fetch with `adminMediaCollectionQuery`; wrap with `<QueryView>`.
- **Settings form** (react-hook-form + zodResolver):
  - `name` — text
  - `mode` — select (static / carousel)
  - `autoplay` — checkbox (shown only when mode = carousel)
  - `intervalMs` — number input with ms label (shown only when mode = carousel)
- **Item grid** (`CollectionItemGrid`): renders `items` as ordered thumbnail grid (same `AssetTile` component from TASK-003, without selection state but with a remove button).
  - Reorder: drag-and-drop using native HTML5 drag API or a simple up/down arrow button pair (no third-party DnD library unless already in the project).
  - **Add asset** button opens a modal asset picker: reuse `adminMediaAssetsQuery` with a search input to find assets, click to add (append to end of items). Respect `MAX_COLLECTION_ITEMS` = 50.
  - Remove: removes item from local list state.
- Save sends the full new `items` array + changed settings + `version`. This is a single PATCH call.
- Version conflict: if `VERSION_CONFLICT` returned, refetch the collection and warn the user.

**Acceptance criteria:**
- Collection name, mode, autoplay, interval render and save correctly.
- Items reorder, add, and remove correctly in local state before save.
- Save sends correct ordered `items` array.
- Exceeding 50 items disables the Add button (client-side guard).
- Version conflict shows a warning and reloads.

**Dependencies:** TASK-006, TASK-003 (AssetTile reuse), TASK-005 (can reuse the asset-picker modal pattern)  
**Risk:** Medium-High (item order state, version conflict, modal asset picker)

---

### TASK-008 — Wire `page.tsx` — replace PlaceholderPage

**Effort:** S  
**Owner:** frontend-engineer  
**Status:** todo

**Goal:** Replace the stub `page.tsx` with the real `MediaLibraryPage` component.

**Affected files:**
- `web/src/app/(admin)/admin/media/page.tsx` ← **modify**

**Implementation notes:**
```tsx
import type { Metadata } from 'next'
import { MediaLibraryPage } from '@/features/admin/media/MediaLibraryPage'
import { routeMetadata } from '@/lib/routes/metadata'

export const metadata: Metadata = routeMetadata('admin-media')

export default function Page() {
  return <MediaLibraryPage />
}
```
- No data fetching at the RSC layer — the page is fully client-rendered via `'use client'` in `MediaLibraryPage` (consistent with other admin feature pages like `AdminDashboard`).

**Acceptance criteria:**
- `/admin/media` loads `MediaLibraryPage` without errors.
- `PlaceholderPage` is no longer rendered.

**Dependencies:** TASK-002, TASK-003, TASK-005, TASK-006, TASK-007  
**Risk:** Low

---

## Parallel work opportunities

| Wave | Tasks | Can run in parallel? |
|------|-------|----------------------|
| 1 | TASK-002 | Alone (no deps) |
| 2 | TASK-003 + TASK-004 | Yes — both depend only on TASK-002 |
| 2 | TASK-006 | Yes — depends only on TASK-002 |
| 3 | TASK-005 | After TASK-003 |
| 3 | TASK-007 | After TASK-006 (and reuses AssetTile from TASK-003) |
| 4 | TASK-008 | After all of 2 + 3 |

---

## Summary

| Task | Title | Effort | Deps |
|------|-------|--------|------|
| TASK-001 | Query-options audit | — (already done) | — |
| TASK-002 | MediaLibraryPage shell | S | — |
| TASK-003 | AssetsTab grid + search | M | TASK-002 |
| TASK-004 | useUploadFlow hook | M | TASK-002 |
| TASK-005 | AssetEditPanel | M | TASK-003 |
| TASK-006 | CollectionsTab list + create | S | TASK-002 |
| TASK-007 | CollectionDetail settings + items | L | TASK-006, TASK-003 |
| TASK-008 | Wire page.tsx | S | All above |

**Total implementation tasks:** 7 (TASK-001 skipped as already complete)  
**Estimated waves:** 4  
**Blockers:** None — backend and all infrastructure is ready.
