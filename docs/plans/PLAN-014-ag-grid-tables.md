---
id: PLAN-014
type: plan
feature_id: none
architecture_id: ARCH-001
version: 1
status: draft
date: 2026-11-20
---

# PLAN-014: Migrate admin and player tables to AG Grid (same look)

Replace the hand-built `ResponsiveTable` (`web/src/components/ui/table/`) with AG Grid for the client-rendered admin and player tables, keeping the current visual style. Public, server-rendered tables stay on `ResponsiveTable`.

Execution rules (from earlier decisions): backend is untouched; agents run typecheck, lint and dependency checks only, the owner runs one build per batch; tests and security review are deferred until the main pages are done; do not touch the owner's uncommitted files.

---

## 1. What exists

- One custom component, `ResponsiveTable`, plus `TablePagination`, `TableSkeleton`, `tableTypes.ts`. No table package in `package.json`.
- 15 call sites across 18 files. Client-rendered (admin and player): `AdminEventsPage`, `PlayersAdminPage`, `PlayerRecordBody`, `PaymentsAdminPage`, `AssetsTab`, `AssetChoices`, `RegistrationList`, and the event control tabs (`RegistrationsTab`, `PaymentsTab`, `MessagesTab`, `AuditTab`, `RoundsView`, `StandingsSection`). Server-rendered and public: `EventStandings`.
- All paging, filtering and sorting is server-side through query params. Data comes from React Query.
- The API every table uses: `columns` (`id`, `header`, `cell(row)`, `align`, `mono`, `priority`, `rowHeader`), `rows`, `getRowId`, `rowHref`, `actions`, `empty`, `loading` / `loadingSlot`, `footer`, `stickyHeader`, `layout`, `virtualize`.
- Below 720px it renders labelled stacked cards instead of a table. Only one rendering is exposed to assistive technology.

## 2. Decisions to confirm before starting

| # | Decision | Recommendation |
|---|---|---|
| D1 | Edition | AG Grid **Community** (MIT). Enterprise features (server-side row model, row grouping, Excel export) are not needed because paging is already server-side. |
| D2 | Scope | Migrate the 13 client-rendered tables. **Keep `ResponsiveTable` for `EventStandings`** (public page): AG Grid is client-only, so it would drop server rendering and hurt SEO and first paint. |
| D3 | Mobile (below 720px) | AG Grid has no stacked-card layout. Keep a card list for small screens, rendered from the same column definitions, and show the grid from 720px. |
| D4 | Behavior | Keep server-side paging, filters and search exactly as they are. Use AG Grid's client-side row model on the current page only, with no AG Grid pagination. Sorting stays whatever each API supports today. |
| D5 | Rollout | One shared wrapper, then migrate page by page behind the same `columns` shape so each step is small and reversible. |

## 3. Risks

- **Bundle size.** AG Grid Community adds roughly 300 KB or more before gzip. Admin routes only, loaded with `next/dynamic` and registered modules (no `AllCommunityModule`) to keep it down.
- **Accessibility.** The project enforces WCAG 2.2 and has axe tests. AG Grid's keyboard model (grid navigation) differs from a plain table, and `rowHref` links and row action buttons must stay reachable by Tab. Needs a manual keyboard and screen-reader pass.
- **Styling parity.** AG Grid ships its own theme. The Theming API takes CSS variables, so map the existing tokens (`--line-admin`, `admin-panel`, `ink`, `ink-soft`, type scale) to it. Row height, 12px cell padding, eyebrow header style and the right-aligned tabular numerals must be matched by hand.
- **Server Components.** Cell renderers become client code. Any `cell` function that relies on server-only imports needs checking.
- **Loading, empty and error states** are rendered by the wrapper, not AG Grid, so they must keep their current look.

## 4. Tasks

### Phase 1: foundation (blocks everything else)

- **T1.** Add `ag-grid-community` and `ag-grid-react`. Pin the versions. Confirm they work with React 19 and Next 16.
- **T2.** Create `web/src/components/ui/table/DataGrid.tsx` (client component), loaded through `next/dynamic` with `ssr: false` and the `TableSkeleton` as fallback. Accept the same `TableColumn<Row>` shape, plus `rows`, `getRowId`, `rowHref`, `actions`, `empty`, `loading`, `footer`, `caption`. Register only the modules used.
- **T3.** Build the column adapter: `TableColumn` to AG Grid `ColDef` (`cell` to `cellRenderer`, `align` to `type: 'rightAligned'` plus tabular numerals, `mono` to a cell class, `rowHeader` to the linked first column, `actions` to a pinned right column).
- **T4.** Theme: a single AG Grid theme built from the existing CSS tokens so borders, header background, row height and fonts match `ResponsiveTable`. Compare side by side with `AdminEventsPage` as the reference.
- **T5.** Mobile card list for below 720px, reusing the stacked-card markup from `ResponsiveTable` (extract it into a shared `StackedRows` component so the grid wrapper and `ResponsiveTable` both use it).

### Phase 2: pilot

- **T6.** Migrate `AdminEventsPage` (the simplest case: filters, paging, row link, row actions). Verify the existing React Query cache behavior is unchanged, the loading skeleton, empty state, error state and pagination footer.
- **T7.** Keyboard and screen-reader check on the pilot. Decide go or no-go for the rest.

### Phase 3: roll out (can be done in parallel once T6 passes)

- **T8.** Players: `PlayersAdminPage`, `PlayerRecordBody`.
- **T9.** Payments: `PaymentsAdminPage`, event `PaymentsTab`.
- **T10.** Event control: `RegistrationsTab`, `MessagesTab`, `AuditTab`, `RoundsView`, `StandingsSection`.
- **T11.** Media and player: `AssetsTab`, `AssetChoices`, `RegistrationList`.

### Phase 4: cleanup

- **T12.** Remove dead code in `ResponsiveTable` that only the migrated tables used. Keep what `EventStandings` needs.
- **T13.** Update `web/src/lib/api/README.md` or the component docs, and the stale table notes in `theme.css`.
- **T14 (deferred with the other tests).** Component and axe tests for `DataGrid`, then a security and performance review.

## 5. Dependency order

T1 then T2, T3, T4 and T5 (in parallel) then T6 then T7 (gate) then T8, T9, T10 and T11 (in parallel) then T12 and T13.

## 6. Open questions

1. Is column sorting, resizing, hiding or reordering wanted? Those are the main reasons to adopt AG Grid, and none exist today. If none are wanted, the migration changes the library without adding anything the admins can see.
2. Is the mobile stacked-card layout required, or are admin screens desktop-only?
3. Is the real driver bundle and maintenance cost, or features? If it is the "reload every visit" behavior seen on `/admin/events`, that is a caching question, not a table-library one.
