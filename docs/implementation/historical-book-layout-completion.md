# Historical book layout completion

## 1. Summary

The Design Space document editor now supports the historical-book target as a
real, persisted multi-page document rather than a single-page preview. Tiptap
remains the editing foundation; a normalized Zustand project owns four
independent page stories, page furniture, styles, image geometry, and group
metadata. The shared document layout kernel is consumed by the live structured
renderer and by committed offscreen export rendering.

Overall readiness is **90/100**. Pages 49–52 can be reconstructed with fixed
Letter/A4/custom physical pages, mirrored folios, cream paper, named German
typography, drop caps, multi-column flow, positioned images, captions,
rectangular wrapping, row/stack helpers, save/reopen, recovery, and ordered
print-quality raster PDF output. The remaining points reflect intentional
roadmap limits: raster rather than vector/text PDF, no source scans or verified
transcription in the repository, one shared print CSS box for mixed-size print,
and no dedicated rigid-group resize handle.

## 2. Implemented phases

### S0 — authoritative paper background

`project.document.background.value` is the sole paper source of truth. Blank and
malformed projects normalize to `#FAF8F5`; the sidebar edit marks the project
dirty and the value survives autosave, portable reopen, screen rendering, PNG,
PDF, and print.

### P1 — multi-page documents and folios

`DocumentPage[]` now owns independent title/body stories and page settings.
Pages can be added, duplicated, removed, selected, reordered, and saved without
overwriting inactive pages. Starting folio, visibility, suppression, outside
bottom placement, parity, and semantic inner/outer margins are persisted. A
four-page PDF exports in source order without mounting inactive pages.

### P2 — historical typography

The bounded named-style registry covers article title, body, subsection heading,
caption, quotation, and author/signature. Paragraph roles are model attributes,
not inferred bold markup. Style values are enum- and range-normalized, German
language metadata is persisted, browser hyphenation has an explicit fallback,
and drop caps have bounded enabled, colour, size, line-span, family, and spacing
settings across screen, structured layout, and export.

### P3 — shared layout and image geometry

`src/document/layout/` now contains branded page/body/viewport coordinate types,
physical page/margin/column calculations, collision and exclusion geometry, and
the image layout contract. Spanning images use unzoomed `body-span` coordinates;
zoom is presentation-only. Multiple image/caption exclusion rectangles,
collision resolution, resize/drag/nudge commits, printable bounds, and stable
image-ID commits are shared by editor and export adapters.

### P4 — compound image helpers

Page-level declarative `imageGroups` support ordered row and stack groups,
bounded gap, stack shared-width policy, group translation, ungrouping, child
selection, caption preservation, and repair after child deletion/replacement.
Individual Tiptap image nodes remain canonical; nested image-group nodes were not
introduced.

### P5 — persistence, assets, migrations, and recovery

Document schema version 5 adds asset metadata and completes the migration chain.
Stable IDs, duplicate repair, content-fingerprint deduplication, reachability
compaction, missing-asset placeholders, storage diagnostics, primary-key-only
IndexedDB updates, and deep Python/Rust recovery validation are implemented
without weakening backup gates.

### P6 — committed multi-page export

`mountCommittedDocumentExportPages` clones a project snapshot and mounts every
page offscreen at 96 CSS pixels per inch. Selected PNG, all-page PNG, ordered
mixed-size PDF, and print consume these committed sources, not the active live
DOM or transient drag preview. Rasterization is sequential and low effective
source-image DPI warnings are surfaced.

### P7 — historical fixtures and visual regression

`createHistoricalBookFixtureProject()` is a deterministic four-page document
factory. It is imported through the normal portable-file dashboard workflow in
Playwright. Per-page model assertions, committed export assertions, four page
sheet crops, four-page PDF assertions, and numbered PNG assertions are included.

## 3. Architectural changes

- `src/document/state/documentStore.ts` is the page/project mutation boundary;
  editor callbacks update only the active page and autosave the normalized
  project payload.
- `src/editor/project/projectSchema.ts` normalizes the project envelope,
  document pages, named styles, folios, image geometry, groups, and assets.
- `DocumentPageView`, `TitleEditor`, and `FlowEditor` render editable page
  stories. `StructuredDocumentSpanLayout` is a DOM-measurement adapter over the
  pure kernel, not a second persisted document model.
- `src/document/layout/coordinateSpaces.ts`, `pageGeometry.ts`,
  `layoutKernel.ts`, and `imageGroupLayout.ts` define page/body/viewport
  origins, columns, occupied rectangles, exclusion padding, collision policy,
  and group geometry.
- `DocumentProjectExportRenderer.tsx` is the dedicated committed renderer;
  `documentExportService.ts` owns clean clones, resource waits, PNG, PDF, DPI,
  and print.
- `documentAssets.ts`, `editor/db.ts`, and the store's compaction helpers own
  asset reachability and bounded persistence. Tauri Python/Rust recovery reads
  the same normalized shapes.

The editor and export renderer share the page view, typography CSS variables,
FlowEditor structured model, image groups, captions, and asset map. Remaining
DOM measurement is deliberately injected at the renderer boundary; serialized
HTML parsing is not used as a project source of truth.

## 4. Schema and migrations

The project envelope remains `design-space-project-v2`; the nested document
schema is now `CURRENT_DOCUMENT_SCHEMA_VERSION = 5` in
`src/editor/project/projectSchema.ts`.

1. Legacy/v1 and one-page document payloads normalize to a valid `DocumentPage`
   array with one page and no data loss.
2. Image geometry migration (schema 3) canonicalizes four-sided padding and
   explicit `flow`/`body-span` coordinate space from legacy scalar fields.
3. Group migration (schema 4) adds `imageGroups: []` and repairs invalid,
   duplicate, orphan, or undersized memberships.
4. Asset migration (schema 5) synthesizes bounded `assetMetadata` for legacy
   string assets and preserves valid MIME, dimensions, and file-name metadata.
5. Typography migration maps title/body/caption content to named defaults and
   maps legacy `dropCap: true` to safe bounded settings.
6. Recovery migration repairs empty or duplicate IDs across both title and body
   stories, normalizes current group shape, reports missing asset references,
   and rejects document schemas newer than the recovery implementation.

Coordinates are persisted only in unzoomed 96-CSS-pixel units. Captions are
attributes of the image node/overlay record; group metadata references stable
image IDs and never duplicates child geometry.

## 5. User-visible workflows

- Create or open a document, edit independent page stories, and use the compact
  page navigator to add, duplicate, remove, reorder, and select pages.
- Configure Letter, A4, or bounded custom dimensions; orientation; top/bottom and
  semantic inner/outer margins; German page language; paper colour; folio start,
  visibility, and per-page suppression.
- Choose named styles and semantic paragraph roles, set body/title controls,
  and configure a drop cap.
- Insert/reselect/replace images, edit alt text and attached captions, choose
  no-wrap/float/span layout, set numeric geometry, drag/resize/nudge at zoom,
  and select multiple compatible images to arrange a row or stack.
- Download a portable project file and reopen it through the dashboard. Missing
  assets remain visible as placeholders and block export with an explicit error.
- Export the current page PNG, all pages as numbered PNG downloads, all pages as
  an ordered PDF, or the committed pages through print.

## 6. Export behaviour

All export paths begin with a cloned normalized project snapshot. Editor chrome,
reference scans, selection state, resize handles, placeholders, and overflow
warnings are excluded. Fonts are awaited through `document.fonts.ready`.

PNG uses 300 DPI by default and calculates effective source-image DPI. PDF is a
raster-backed jsPDF document with one physical page per source, source order,
per-page MediaBoxes, background, folios, image placement, wrapping, captions,
groups, and named typography. Pages are rasterized sequentially to bound memory.
Print uses a committed multi-page host and removes it on `afterprint` or the
bounded fallback timer.

The PDF limitation is intentional: text is not selectable/searchable. The
layout contract and ordered page-source interface leave room for a future
vector/text renderer.

## 7. Persistence and recovery changes

- Autosave remains bounded/debounced and stores the complete page array, active
  page, document settings, groups, and asset metadata.
- Identical imported data URLs reuse a canonical asset ID. Save, autosave, and
  portable download prune unreachable assets and metadata across title/body,
  overlays, references, groups, and image nodes.
- `DesignSpaceDB.updateProject` updates exactly the referenced `canvasDataId`;
  duplicate legacy rows are diagnosed, not rewritten or silently deleted.
- `inspectAssetReferences()` exposes reachable, missing, and orphan IDs; the
  sidebar renders missing-image placeholders and export reports the exact
  missing count.
- Python recovery hashes data URLs, repairs current pages/styles/groups/IDs,
  warns about missing assets, and retains safe unknown fields. Rust startup
  validation checks current document pages and group shape before recovery is
  marked complete.

## 8. Historical fixtures

The source photographs were not present under `docs/reference/historical-book/`
or Git history at baseline. The fixture therefore uses a repository-local
placeholder PNG and representative German text, explicitly avoiding fabricated
historical transcription.

The four pages exercise:

- 49: blue multiline title, three columns, blue drop cap, lower-right spanning
  image, caption, and wrapping;
- 50: upper text with semantic headings and a bottom row with independent
  captions;
- 51: narrow left story and a right-side stack with different child heights and
  captions; and
- 52: three-column headings, closing text, quotation, author signature, and a
  natural short final area.

Baselines and update instructions are documented in
`docs/architecture/historical-book-fixtures.md`.

## 9. Tests and verification

Final verification completed on 2026-08-02:

- `npm test -- --reporter=dot` — 34 files, 400 tests passed.
- `npx tsc --noEmit` — passed.
- `npm run lint` — passed.
- `npm run build` — passed.
- `python3 -m unittest discover -s src-tauri/recovery_tools/tests -v` — 3
  tests passed.
- `cargo test --manifest-path src-tauri/Cargo.toml` — 20 tests passed.
- `npm run test:e2e -- e2e/document-reconstruction.spec.ts
  e2e/document-typography.spec.ts e2e/historical-book-layout.spec.ts
  --reporter=line` — 10 tests passed.

Coverage includes schema/geometry/unit tests, store and DB-growth tests,
asset-deduplication and missing-asset tests, save/reload and reconstruction
tests, drag/resize tests at multiple zoom levels, row/stack tests, committed
multi-page renderer tests, PDF MediaBox tests, recovery tests, page navigation,
portable fixture import, PNG/PDF export, and reviewed Chromium visual crops.

## 10. Remaining limitations

- PDF is raster-backed; selectable text and true vector font embedding are not
  implemented.
- The repository lacks the historical scans and a verified complete German
  transcription, so fixture imagery/text are representative placeholders.
- Product decision deliberately keeps four independent page stories; automatic
  cross-page continuous flow is not implemented.
- Browser print CSS assumes one shared physical print box for a print job. PDF
  supports mixed page dimensions; the historical fixture uses one Letter size.
- Group resize is expressed through child controls/shared-width policy rather
  than a dedicated rigid group handle.
- All-page PNG uses sequential browser downloads. Browsers may require the user
  to allow multiple downloads; the service and unit tests still rasterize and
  name every page deterministically.
- Existing test output contains non-failing React `act(...)` warnings in legacy
  interaction tests and a stale Browserslist database notice.

## 11. Exact commit list

- `4e4e4809` — wire authoritative document paper background
- `9505d48e` — add multi-page documents and folios
- `86ba84a1` — add historical document typography styles
- `ea3ca727` — consolidate document layout and image geometry
- `335cd164` — add document image rows and stacks
- `9f68a02e` — harden document assets migrations and recovery
- `687e7c22` — export committed multi-page document layouts
- `db831442` — repair export scope and recovery image IDs
- `0986414b` — allow slower committed export mounting
- `b761c93a` — add historical page fixtures and visual regressions
- `aef589e9` — record completed historical layout verification

## 12. Final readiness score with justification

**90/100.** The persisted page model, mirrored folios, named typography,
drop-cap styling, multi-column/structured layout, positioned images and
captions, row/stack metadata, bounded asset lifecycle, recovery validation, and
committed multi-page PDF/export paths are implemented and covered by passing
unit, integration, recovery, and Playwright tests. Ten points remain for the
explicit limitations in section 10: raster-only PDF, absent source scans and
transcription, independent rather than cross-page stories, mixed-size print
CSS, dedicated group resize, and browser multi-download policy. These limits
do not prevent faithful editable reconstruction of the four specified fixture
layouts.
