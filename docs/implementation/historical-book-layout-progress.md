# Historical book layout implementation progress

Implementation started: 2026-07-29  
Baseline commit: `62a604e916f30e07ea862a13254fa5a7bbeabee6`  
Canonical plan: `docs/audits/historical-book-layout-gap-analysis.md`

## Baseline

- Branch: `main`
- Post-audit code changes found: none
- Existing untracked material: the audit report under `docs/audits/`
- Historical reference directory: not present in the repository or Git history
- External page-numbered Darktable cache entries were inspected and were unrelated aquarium photographs; they were not copied or modified
- Verification:
  - `npm run lint` — passed
  - `npx tsc --noEmit` — passed
  - `npm test` — 17 files, 258 tests passed
  - `npm run build` — passed
  - `npm run test:recovery` — 2 tests passed
  - `cargo test --manifest-path src-tauri/Cargo.toml` — 20 Rust tests passed
  - `npm run test:e2e -- e2e/document-reconstruction.spec.ts` — 5 tests passed

## Phase status

| Phase | Status | Commit |
|---|---|---|
| S0 — Authoritative paper background | Complete | `4e4e4809` |
| P1 — Multi-page documents and folios | Complete | Pending phase commit |
| P2 — Historical typography styles | Pending | — |
| P3 — Shared layout and image geometry | Pending | — |
| P4 — Image rows and stacks | Pending | — |
| P5 — Persistence, migrations, assets, recovery | Pending | — |
| P6 — Committed multi-page export | Pending | — |
| P7 — Historical fixtures and visual regression | Pending | — |

## S0 — Authoritative paper background

Status: Complete

Planned source of truth: `project.document.background.value`.

Schema changes: none. Existing v2 metadata is used.

Migration behaviour: malformed document paper colours normalize to the existing
cream default; valid three- and six-digit hex colours normalize to a canonical
six-digit uppercase value.

Files changed:

- `src/document/utils/documentColor.ts`
- `src/editor/project/projectSchema.ts`
- `src/document/state/documentStore.ts`
- `src/document/components/DocumentEditorShell.tsx`
- `src/document/components/DocumentPageView.tsx`
- `src/document/components/DocumentSidebar.tsx`
- `src/document/services/documentExportService.ts`
- `__tests__/document-store.test.ts`
- `__tests__/document-editor.test.ts`
- `__tests__/document-export.test.ts`
- `e2e/document-reconstruction.spec.ts`
- this implementation journal

Implemented behaviour:

- blank and normalized document projects use `#FAF8F5`;
- the sidebar edits the project-level paper colour without adding a page field;
- valid three- or six-digit hex colours are canonicalized;
- malformed or CSS-bearing imported values fall back safely;
- valid changes mark the project dirty and use the existing bounded autosave;
- library and portable project reopen preserve the colour;
- the sheet, export root, PNG, raster PDF, and print clone receive the same
  committed value.

Tests and verification:

- `npx vitest run __tests__/document-store.test.ts __tests__/document-editor.test.ts __tests__/document-export.test.ts` — 81 tests passed
- `npm test` — 17 files, 263 tests passed
- `npx tsc --noEmit` — passed
- `npm run lint` — passed
- `npm run build` — passed
- `npm run test:e2e -- e2e/document-reconstruction.spec.ts` — 5 tests passed
- `git diff --check` — passed

Deviations and limitations:

- The colour contract is intentionally limited to validated hex colours rather
  than accepting arbitrary CSS strings.
- Multi-page offscreen rendering remains P6 work; S0 ensures every current
  render/export call receives the authoritative value.

## P1 — Multi-page documents and folios

Status: Complete

Schema changes:

- The nested document payload now has `schemaVersion: 1`.
- A project document owns an ordered `pages` array, a persisted active-page
  index, and document-level folio settings.
- Each page owns its title, body, physical dimensions, semantic
  top/bottom/inner/outer margins, overlays, and optional folio suppression.
- Page-size presets now include bounded custom dimensions in addition to Letter
  and A4.
- The outer project schema remains version 2; its legacy canvas compatibility
  mirror is derived from the first document page.

Migration behaviour:

- Existing one-page v2 document projects migrate losslessly into the page array
  and receive document schema version 1.
- Legacy left/right margins map to inner/outer according to the first folio's
  parity, preserving the first page's physical layout.
- Missing folio settings normalize to a hidden folio starting at 1.
- Invalid active-page indexes are clamped, and normalization guarantees at
  least one valid page.
- Duplicate-page operations remap page, overlay, and Tiptap image IDs while
  retaining shared immutable asset references.

Files changed:

- `src/document/types/documentProject.ts`
- `src/editor/project/projectSchema.ts`
- `src/document/layout/pageGeometry.ts`
- `src/document/utils/documentPageOrientation.ts`
- `src/document/state/documentStore.ts`
- `src/document/components/DocumentPageNavigation.tsx`
- `src/document/components/DocumentEditorShell.tsx`
- `src/document/components/DocumentPageView.tsx`
- `src/document/components/DocumentSidebar.tsx`
- `src/document/components/DocumentTopBar.tsx`
- `src/document/components/DocumentProjectExportRenderer.tsx`
- `src/document/services/documentExportService.ts`
- `src/document/styles/document-page.css`
- `__tests__/document-page-geometry.test.ts`
- `__tests__/document-orientation.test.ts`
- `__tests__/project-schema.test.ts`
- `__tests__/document-store.test.ts`
- `__tests__/document-editor.test.ts`
- `__tests__/document-export.test.ts`
- `e2e/document-reconstruction.spec.ts`
- this implementation journal

Implemented behaviour:

- Users can add, duplicate, remove, select, and reorder independently editable
  pages through a compact page strip, while the store enforces a one-page
  minimum.
- Page callbacks are ID-scoped, so a delayed update from a previously mounted
  Tiptap editor cannot overwrite the newly active page.
- Changing pages is a discrete revision that uses the existing bounded
  autosave, so a select-and-close workflow restores the selected page and an
  in-flight older save cannot roll navigation back.
- Folios support a configurable starting number, document-wide visibility,
  page-level suppression, and outside-bottom odd/even placement.
- Margins are stored semantically as inner/outer and resolved through shared
  page-parity geometry helpers.
- All pages, including inactive pages, are mounted from a frozen committed
  snapshot for sequential multi-page PDF export. PDF page order and each
  page's physical size are taken from its own page model.
- The PNG action is explicitly a current-page workflow.
- Custom page dimensions are validated between 1 and 24 inches.

Tests and verification:

- Focused P1 unit/integration suite — page geometry, schema, orientation,
  store, editor, and export coverage passed
- `npm test` — 18 files, 288 tests passed
- `npm run build` — passed (includes lint, TypeScript, and production bundle)
- `npm run test:e2e -- e2e/document-reconstruction.spec.ts` — 6 tests passed
- `npm run test:recovery` — 2 Python tests passed
- `cargo test --manifest-path src-tauri/Cargo.toml` — 20 Rust tests passed
- `git diff --check` — passed

Deviations and limitations:

- Page stories are independent by product decision; text overflow does not
  automatically continue onto the next page.
- PDF export already uses a frozen offscreen snapshot to make P1 genuinely
  multi-page. P6 will extend this path with explicit committed-state PNG and
  print workflows, font readiness, DPI diagnostics, and memory controls.
- The compact navigation strip is optimized for the four-page target rather
  than acting as a thumbnail browser.
- Full version-by-version migration orchestration, duplicate legacy database
  row handling, and deep recovery validation remain P5 work.
- A frozen-renderer integration test verifies ordered stories, authoritative
  background, mirrored folios/margins, and per-page folio suppression before
  PDF assembly.
- Non-finite page indexes are ignored, and derived folios remain consecutive
  even when subsequent page numbers exceed the bounded starting-folio input.
