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
| P1 — Multi-page documents and folios | Complete | `9505d48e` |
| P2 — Historical typography styles | Complete | `86ba84a1` |
| P3 — Shared layout and image geometry | Complete | `ea3ca727` |
| P4 — Image rows and stacks | Complete | pending phase commit |
| P5 — Persistence, migrations, assets, recovery | Complete | pending phase commit |
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

## P2 — Historical typography styles

Status: Complete

Schema changes:

- The nested document schema is now version 2.
- The document owns a validated language tag and a complete named-style
  registry for article title, body, subsection heading, caption, quotation,
  and author/signature roles.
- Paragraph JSON carries a bounded `documentStyleId`; a bounded
  `documentStyleFontSizePx` block override exists only to preserve differing
  per-page legacy title sizes without reintroducing a page-level style source.
- Each page owns a validated drop-cap settings object and may override the
  document language.
- Image and overlay captions store explicit presentation overrides or the
  `inherit` sentinel, so the named caption style remains functional.

Migration behaviour:

- Schema-v1 title and body appearance is preserved: the former 42px title,
  dark text colours, left-aligned body, and legacy caption presentation are
  retained.
- The first legacy page title size becomes the article-title named style.
  Differing later-page sizes become safe block overrides, including empty
  titles and paragraphs created after reopening.
- `dropCap: true` becomes an enabled bounded settings object.
- Title, body, heading, quotation, and signature content receives a semantic
  role while inline marks and unknown structural content remain intact.
- Persisted inline typography marks are reduced to bounded font size, trusted
  font-family IDs, validated hex colours, and bounded tracking; hostile or
  arbitrary CSS-bearing values normalize to `null`.
- Legacy captions receive explicit left/italic/5px overrides. New captions
  inherit the centered italic named caption style unless the user chooses an
  image-specific override.

Files changed:

- `src/document/typography/documentTypography.ts`
- `src/document/typography/documentTypographyCss.ts`
- `src/document/extensions/DocumentBlockStyleExtension.ts`
- `src/document/extensions/DocumentTextStyleExtension.ts`
- `src/document/extensions/DocumentImageExtension.ts`
- `src/document/types/documentProject.ts`
- `src/editor/project/projectSchema.ts`
- `src/document/state/documentStore.ts`
- `src/document/components/TitleEditor.tsx`
- `src/document/components/FlowEditor.tsx`
- `src/document/components/StructuredDocumentSpanLayout.tsx`
- `src/document/components/DocumentPageView.tsx`
- `src/document/components/DocumentProjectExportRenderer.tsx`
- `src/document/components/DocumentEditorShell.tsx`
- `src/document/components/DocumentSidebar.tsx`
- `src/document/components/DocumentToolbar.tsx`
- `src/document/components/DocumentImageNodeView.tsx`
- `src/document/components/DocumentOverlayLayer.tsx`
- `src/document/styles/document-page.css`
- `docs/architecture/document-typography.md`
- P2 unit, integration, export-reconstruction, and Playwright tests
- this implementation journal

Implemented behaviour:

- Users can edit every named style through bounded controls for family, size,
  colour, line height, paragraph spacing, first-line indent, alignment, weight,
  italic, tracking, and hyphenation.
- The body toolbar assigns durable body, subsection, quotation/scripture, and
  author/signature roles instead of relying on incidental bold text.
- Document and page language metadata reaches live editors, structured
  measurement hosts, committed offscreen pages, and export clones.
- Drop caps have page-level enablement plus bounded family, colour, size,
  line-span, and spacing controls. The same target and CSS contract is used by
  ordinary flow, structured flow, and export pseudo-style capture.
- Browser hyphenation uses the stored language and `hyphens` policy; normal
  word breaking remains the explicit fallback. Paragraphs retain
  `widows: 2`/`orphans: 2`.
- The live page and committed offscreen renderer consume one
  `getDocumentTypographyCssVariables` adapter; persisted projects contain
  model values, never CSS stacks or arbitrary declarations.
- Caption-specific alignment, italic, and spacing controls override the named
  caption style only when explicitly set.

Tests and verification:

- Focused P2 model, extension, caption, structured-layout, schema, store, and
  export-renderer suite — 62 tests passed
- `npm test -- --run` — 23 files, 313 tests passed
- `npx tsc --noEmit` — passed
- `npm run lint` — passed
- `npm run build` — passed
- `npm run test:e2e -- e2e/document-reconstruction.spec.ts
  e2e/document-typography.spec.ts` — 7 tests passed
- Both previously sensitive structured-image Playwright workflows pass after
  verifying that normalized null block attributes do not reset selection when
  focus moves to the image inspector.

Deviations and limitations:

- Semantic roles are bounded attributes on Tiptap paragraphs rather than
  enabling arbitrary HTML heading/blockquote nodes. This preserves the
  existing editor schema while providing durable roles to all renderers.
- Named fonts currently resolve to trusted system serif/sans stacks. P6 will
  add pinned fixture fonts, font readiness, and substitution diagnostics.
- Keep-with-next is not yet exposed as a model control; subsection roles are
  ready for a bounded pagination policy when the consolidated P3 layout kernel
  owns all flow decisions.
- Active-page PNG and print still originate from the mounted export root.
  Committed-snapshot PNG/print is intentionally completed in P6.

## P3 — Shared layout and image geometry

Status: Complete

Schema changes:

- The nested document schema is now version 3.
- Image nodes canonically store four independent wrap-padding sides and an
  explicit `flow` or `body-span` coordinate-space tag.
- Positioned spanning images retain unzoomed body-relative Y and
  span-relative X coordinates; page overlays retain unzoomed page-relative
  coordinates.
- Legacy scalar `wrapPaddingPx` and `verticalSpacingPx` remain parse-only
  compatibility inputs and are not emitted by project or HTML serialization.

Migration behaviour:

- Schema-v2 span padding maps horizontal padding to left/right and vertical
  spacing to top/bottom.
- Float, inline, and top/bottom images receive mode-compatible four-sided
  padding without visually changing existing documents.
- Coordinate space is derived from active image mode instead of trusting an
  arbitrary persisted value.
- The schema-v2 typography migration is explicitly bounded to versions below
  2, so the v3 geometry migration cannot reapply legacy caption or title
  presentation.
- Canonical comparison prevents Tiptap's parse-only compatibility attributes
  from triggering an external-content reset while an inspector field is being
  edited.

Files changed:

- `src/document/layout/coordinateSpaces.ts`
- `src/document/layout/layoutKernel.ts`
- `src/document/layout/overlayGeometry.ts`
- `src/document/layout/index.ts`
- `src/document/types/documentProject.ts`
- `src/editor/project/projectSchema.ts`
- `src/document/extensions/DocumentImageExtension.ts`
- `src/document/state/documentStore.ts`
- `src/document/components/DocumentEditorShell.tsx`
- `src/document/components/DocumentImageNodeView.tsx`
- `src/document/components/DocumentOverlayLayer.tsx`
- `src/document/components/DocumentPageView.tsx`
- `src/document/components/DocumentToolbar.tsx`
- `src/document/components/FlowEditor.tsx`
- `src/document/components/StructuredDocumentSpanLayout.tsx`
- `src/document/styles/document-page.css`
- `docs/architecture/document-layout-and-image-geometry.md`
- P3 geometry, schema, interaction, store, editor, and Playwright tests
- this implementation journal

Implemented behaviour:

- Branded page, body, and viewport coordinate types centralize conversions and
  make zoom a presentation-only transform.
- A pure layout kernel owns page/body/column rectangles, four-sided
  caption-aware exclusions, boundaries, overflow, collision detection,
  collision-constrained movement and resize, and deterministic initial overlap
  resolution.
- Structured layout consumes every positioned spanning image, creates
  simultaneous exclusion rectangles, includes caption height, and reports
  unresolved collisions as overflow.
- Page overlays and structured images use transient pointer previews and
  commit once on pointer-up; cancellation and blur do not dirty the project.
- Stable image IDs recover move and resize targets after stale ProseMirror
  positions. Overlay commits capture both page ID and object ID.
- New and resized images are clamped to printable/body boundaries and avoid
  peers under the documented same-layer collision policy.
- The inspector exposes numeric X/Y/width/height where applicable, four
  independent wrap paddings, aspect-ratio-preserving size changes, and
  1px/10px keyboard nudging.
- The second-spanning-image toolbar guard is removed. Import selects the new
  stable-ID node even under an existing structured overlay, and importing
  during another image NodeSelection inserts instead of replacing.

Tests and verification:

- Focused P3 geometry, schema, overlay interaction/store, structured image,
  and editor suite — 152 tests passed before final regression additions
- `npm test -- --reporter=dot` — 28 files, 360 tests passed
- `npm run build` — passed (lint, TypeScript, and production bundle)
- `npx playwright test e2e/document-reconstruction.spec.ts --grep
  "two independently positioned|family-history span"` — 2 tests passed
- `git diff --check` — passed

Deviations and limitations:

- Ordinary inline/float/top-bottom layout remains browser CSS flow. The pure
  kernel owns explicit rectangles, while DOM text and caption measurement are
  injected renderer adapters rather than a standalone typesetting engine.
- Structured initial-overlap correction is deterministic transient render
  geometry and does not silently dirty old projects; a subsequent interaction
  commits the displayed geometry.
- Overlay pointer interaction measures caption height. Store-only numeric
  commits cannot reproduce DOM caption metrics and conservatively collide on
  image rectangles.
- Front and behind overlay layers intentionally do not collide with each
  other; peers within the same layer do.
- Selected-page PNG and print still use the mounted live root. P6 will route
  those workflows through the committed offscreen renderer already used by
  multi-page PDF.

## P4 — Image rows and stacks

Status: Complete

Objective: add durable row and vertical-stack helpers while keeping individual
image nodes and captions canonical.

Schema changes:

- The nested document schema is now version 4.
- Each page has an `imageGroups` collection with stable group IDs, ordered
  child image IDs, row/stack kind, bounded gap, and stack shared-width policy.
- Existing schema-v3 pages migrate to an explicit empty collection.

Migration and repair behaviour:

- Group records are normalized on project load and every page write.
- Missing children, duplicate memberships, blank IDs, malformed kinds, and
  groups with fewer than two children are repaired or discarded deterministically.
- Only uniquely identified page-positioned span images are groupable; overlays
  and flow-anchored images remain outside this coordinate contract.
- Page duplication remaps every image, overlay, and group ID and then remaps
  group membership to the duplicated children.
- Removing a child removes it from its group and removes a now-invalid group.

Files changed:

- `src/document/types/documentProject.ts`
- `src/editor/project/projectSchema.ts`
- `src/document/model/documentImageGroups.ts`
- `src/document/layout/imageGroupLayout.ts`
- `src/document/layout/index.ts`
- `src/document/state/documentStore.ts`
- `src/document/components/FlowEditor.tsx`
- `src/document/components/StructuredDocumentSpanLayout.tsx`
- `src/document/components/DocumentEditorShell.tsx`
- `src/document/components/DocumentToolbar.tsx`
- `src/document/components/DocumentProjectExportRenderer.tsx`
- `src/document/styles/document-page.css`
- `docs/architecture/document-image-groups.md`
- P4 model, geometry, schema, toolbar, and regression tests

Implemented behaviour:

- The toolbar supports selecting multiple compatible positioned images,
  arranging them into a row or stack, changing gap, enabling stack shared
  width, and ungrouping.
- Groups derive child image, caption, occupied, and collision rectangles from
  `src/document/layout/imageGroupLayout.ts`; each child retains independent
  caption controls and selection.
- Group bounds are a single collision unit. Pointer dragging translates the
  complete row/stack at 0.5–2x zoom and commits only the anchor image's
  canonical body-span coordinate; resize excludes sibling children from the
  obstacle list.
- Ungroup and child deletion materialize the current derived geometry before
  committing body JSON and metadata through one ProseMirror transaction. The
  store repairs the page record in one dirty revision.
- The export renderer passes page groups into the same structured layout
  subsystem, so inactive-page export does not rely on mounted group UI.

Tests and verification:

- Group geometry: row/stack captions, shared width, fit, clamp, translation,
  overlap, and collision tests passed.
- Group model/schema: normalization, duplicate repair, migration, page
  duplication, future-version rejection, and bounded-gap tests passed.
- Toolbar group control tests passed.
- Full unit suite after P4 changes: 32 files, 385 tests passed.
- `npx tsc --noEmit`, `npm run lint`, and `npm run build` passed.

Deviations and limitations:

- Group metadata is deliberately declarative; nested group nodes and generic
  page-region nodes were not introduced.
- Groupable images must share a span coordinate contract. The UI reports an
  actionable message for incompatible selections rather than coercing flow or
  overlay coordinates.
- Group resizing is currently expressed through child image controls and the
  shared-width policy; a dedicated rigid-group resize handle remains a later
  enhancement.

## P5 — Persistence, migrations, assets, and recovery

Status: Complete

Objective: keep the multi-page/group document durable under browser saves,
portable files, duplicate imports, missing assets, and desktop recovery.

Schema changes:

- The nested document schema is now version 5.
- Existing v4 group records remain lossless; v4 and earlier payloads normalize
  to the current schema and synthesize bounded `assetMetadata` entries for
  legacy string-only assets.
- Asset metadata stores a synchronous content fingerprint, encoded byte length,
  and optional MIME/dimension/file-name information. Unknown fields remain
  preserved by the portable normalizer.

Files changed:

- `src/editor/project/projectSchema.ts`
- `src/document/types/documentAsset.ts`
- `src/document/model/documentAssets.ts`
- `src/document/state/documentStore.ts`
- `src/editor/db.ts`
- `src/document/components/DocumentEditorShell.tsx`
- `src/document/components/DocumentSidebar.tsx`
- `src/document/components/DocumentOverlayLayer.tsx`
- `src/document/services/documentExportService.ts`
- `src/document/styles/document-page.css`
- `src-tauri/recovery_tools/recover_indexeddb.py`
- `src-tauri/src/recovery.rs`
- P5 schema, lifecycle, DB-growth, recovery, and asset tests

Implemented behaviour:

- Identical imported data URLs reuse an existing canonical asset ID. New
  assets receive bounded metadata; replacing an image updates the stable node
  reference to the canonical ID.
- Reachability is computed across title/body nodes, overlays, and reference
  scans. Save, autosave, and portable download compact unreachable sources and
  metadata. `inspectAssetReferences()` exposes reachable, missing, and orphan
  IDs to the editor; the sidebar reports missing references.
- Missing node and overlay assets render explicit placeholders. Export fails
  with a clear count instead of silently producing a blank historical image.
- Browser DB updates modify only `project.canvasDataId`. Duplicate legacy rows
  are left intact for forensic recovery and exposed through
  `getProjectStorageDiagnostics()`; the old `where(projectId).modify()` growth
  path is gone.
- Recovery validation now understands current multi-page document payloads,
  document schema versions through 5, image/group records, duplicate or
  malformed image IDs, missing assets, and generated asset metadata. Rust
  startup validation deep-checks recovered document pages and group shape
  before accepting a report.

Tests and verification:

- `npx vitest run __tests__/document-store.test.ts
  __tests__/document-image-schema-v4.test.ts
  __tests__/document-asset-lifecycle.test.ts
  __tests__/db-write-deduplication.test.ts` — 31 tests passed
- `python3 -m unittest discover -s src-tauri/recovery_tools/tests -v` — 3
  tests passed, including a two-page current document recovery fixture
- `cargo test --manifest-path src-tauri/Cargo.toml` — 20 tests passed
- `npm run build` — passed

Risks and limitations:

- The browser asset fingerprint is a bounded synchronous deduplication key,
  not a cryptographic integrity claim. Recovery computes SHA-256 for data URLs.
- Missing assets are recoverable through the existing replace/import controls;
  export intentionally fails until every printable image is available.
- Duplicate IndexedDB rows are reported, not deleted during normal saves; the
  verified-backup recovery workflow remains the authority for forensic cleanup.
