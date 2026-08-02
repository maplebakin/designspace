# Document layout and image geometry architecture

This document describes the phase-P3 layout contract. It covers the persisted
coordinate model, the shared geometry kernel, the boundary between ordinary
CSS flow and structured spanning layout, interaction commits, and the current
editor/export relationship.

## Core invariants

- Physical layout uses unzoomed CSS layout pixels at 96 CSS pixels per inch.
- Zoom is a viewport transform only. Zoom-scaled coordinates must never be
  written to project JSON or Tiptap attributes.
- Every free-position coordinate has an explicit origin.
- Image and caption together form the occupied rectangle used for structured
  wrapping and pointer-interaction collision checks.
- Pointer movement and resize previews are transient component state. One
  committed update is produced when an interaction completes.
- Structured-image commits resolve the target by stable image ID, even when a
  previously captured ProseMirror position is stale.
- The shared kernel contains pure rectangle, boundary, exclusion, and
  collision policy. DOM text measurement remains a renderer adapter.

The public layout surface is re-exported by
`src/document/layout/index.ts`.

## Persisted coordinate model

There are three image modes with deliberately different ownership and origins.

| Mode | Canonical record | Coordinate origin | Position fields |
| --- | --- | --- | --- |
| Page overlay | `DocumentPage.overlayObjects[]` / `DocumentOverlayImage` | Physical page top-left | `xPx`, `yPx`, `widthPx`, `heightPx` |
| Positioned spanning flow image | Tiptap `documentFlowImage` with `wrap: "span-columns"` and `verticalAnchor: "page-position"` | `yPx` from the body-region top; `xOffsetPx` from the selected column span's left edge | `coordinateSpace: "body-span"`, `xOffsetPx`, `yPx`, `widthPx`, `heightPx` |
| Ordinary flow image | Tiptap `documentInlineImage` or `documentFlowImage` using inline, float, or top/bottom flow | Browser document flow | `coordinateSpace: "flow"`; free-position coordinates are inactive |

The canonical types are `DocumentOverlayImage`,
`DocumentFlowImage`, `DocumentImageCoordinateSpace`, and
`DocumentImageWrapPadding` in
`src/document/types/documentProject.ts`.

`body-span` is a persisted semantic tag rather than a viewport coordinate
space. It makes the mixed origin of a spanning image explicit: vertical
position is body-relative, while horizontal offset is relative to its selected
column span. Changing `spanStartColumn` therefore changes the page position of
the same `xOffsetPx`.

Captions are not separate page records. Flow-image captions are stored in the
same Tiptap node attributes as their image. Overlay captions are stored on the
same `DocumentOverlayImage`. This structural ownership is what allows caption
movement, sizing, persistence, and exclusion geometry to follow the image.

## Units and coordinate spaces

`DOCUMENT_CSS_PIXELS_PER_INCH` in
`src/document/layout/pageGeometry.ts` is the authoritative 96-pixels-per-inch
conversion. `DocumentPageView` in
`src/document/components/DocumentPageView.tsx` creates the unscaled physical
page at `widthIn * 96` by `heightIn * 96`; its
`.document-page-transform` applies editor zoom outside that page.

`src/document/layout/coordinateSpaces.ts` provides branded runtime and
TypeScript representations:

- `PagePoint`, `PageRectangle`, and `PageDelta` use the physical page's
  top-left corner.
- `BodyPoint`, `BodyRectangle`, and `BodyDelta` use the body/content
  rectangle's top-left corner after physical margins are resolved.
- `ViewportPoint`, `ViewportRectangle`, and `ViewportDelta` use browser client
  pixels and are never persisted.

The constructors `pagePoint`, `bodyPoint`, `viewportPoint`,
`pageRectangle`, `bodyRectangle`, and `viewportRectangle` retain a
`coordinateSpace` runtime discriminant. Unique-symbol brands prevent page and
body values with otherwise identical shapes from being assigned
interchangeably.

The supported conversions are:

- `pagePointToBodyPoint` and `bodyPointToPagePoint`;
- `pageRectangleToBodyRectangle` and `bodyRectangleToPageRectangle`;
- `viewportPointToPagePoint` and `pagePointToViewportPoint`;
- `viewportDeltaToLayoutDelta` and `layoutDeltaToViewportDelta`.

`viewportDeltaToLayoutDelta` is the only interaction conversion that should
turn a client-pixel drag into persisted geometry. It divides by the effective
view scale and requires the caller to name the destination, `page` or `body`.
The inverse conversion multiplies by view scale for presentation only.

## Page, body, and column rectangles

`getDocumentLayoutRectangles` in
`src/document/layout/layoutKernel.ts` derives the complete geometry from
physical page size, semantic margins, folio parity, column count, and column
gap. It returns:

- a page-space physical page rectangle;
- `bodyOnPage`, the page-space content rectangle;
- `body`, the same content box with a body-space `(0, 0)` origin;
- one to three body-space column rectangles.

`getDocumentContentRectanglePx` and
`resolveDocumentPhysicalMargins` in
`src/document/layout/pageGeometry.ts` resolve inner/outer book margins to
physical left/right sides using folio parity. Malformed or excessive margins
collapse an axis to a non-negative rectangle instead of producing invalid
geometry.

`getDocumentColumnRectangles` in
`src/document/layout/layoutKernel.ts` is the canonical column calculation. It
normalizes the count to one through three, bounds the gap, and returns
deterministic body-space column rectangles and column width. A selected span is
derived from the left edge of its first column through the right edge of its
last column, including intervening gaps.

The live page still applies margins through
`DocumentPageView` and the column CSS variables
`--document-column-count` and `--document-column-gap`. The kernel supplies the
same column arithmetic to the structured renderer and geometry tests.

## Ordinary CSS flow and structured spanning flow

`FlowEditor` in `src/document/components/FlowEditor.tsx` has two rendering
paths.

### Ordinary path

When the body has no `documentFlowImage` with
`wrap: "span-columns"`, Tiptap's `.document-flow-prosemirror` is the visible
renderer. `src/document/styles/document-page.css` uses browser CSS columns
with `column-count`, `column-gap`, and `column-fill: auto`.

`documentInlineImage` remains inline. Non-spanning `documentFlowImage` nodes
use CSS figure flow:

- `float-left` and `float-right` use CSS floats and four-sided margin
  variables;
- `top-bottom` clears both sides;
- their captions remain inside the figure and therefore move and size with it.

Browser flow owns line breaking and ordinary float interaction with text. The
rectangle collision kernel does not replace browser float layout.

### Structured path

The presence of any spanning image makes
`StructuredDocumentSpanLayout` in
`src/document/components/StructuredDocumentSpanLayout.tsx` responsible for
the displayed body layout. `buildMultiDocumentSpanLayoutModel`:

1. collects every spanning Tiptap image, not just the first one;
2. parses the current editor HTML and separates the spanning image elements
   from the text source;
3. derives body-space columns and image spans through
   `getDocumentColumnRectangles`;
4. measures text and captions through an injected DOM measurer;
5. resolves image placement and builds one exclusion rectangle per image;
6. divides each physical column into available text bands around every active
   exclusion;
7. allocates content to those bands in deterministic column/band order.

The source Tiptap DOM is hidden while the structured renderer is the visible
read view. While text is being edited, the source is shown, its spanning image
nodes are hidden, structured text bands are hidden, and the structured image
slots remain overlaid and interactive. Tiptap remains the canonical editable
content and selection model; the generated band DOM is not an independent
editable story.

`rectanglesOverlap` and `moveRectangleWithoutCollisions` exported from the
structured component are compatibility adapters for existing callers and
tests. They convert `DocumentImageRectangle` values to branded body
rectangles and delegate to the shared kernel; they do not contain a second
collision implementation. Text-band allocation and DOM measurement remain in
the structured component because they are renderer-specific adapters rather
than general rectangle geometry.

## Image schema v3 and four-sided wrapping

`CURRENT_DOCUMENT_SCHEMA_VERSION` in
`src/editor/project/projectSchema.ts` introduced schema `3`. Schema v3 makes these image
attributes canonical:

- `wrapPaddingTopPx`;
- `wrapPaddingRightPx`;
- `wrapPaddingBottomPx`;
- `wrapPaddingLeftPx`;
- `coordinateSpace`.

Each padding side is normalized to a rounded value from 0 through 96 CSS
pixels by `normalizeDocumentImageGeometry` in
`src/document/types/documentProject.ts`. An explicit valid side wins
independently. A missing or malformed side uses the mode-compatible v2
fallback.

The v2 scalar migration is:

| v2 wrap mode | Top | Right | Bottom | Left |
| --- | --- | --- | --- | --- |
| `span-columns` | `verticalSpacingPx` | `wrapPaddingPx` | `verticalSpacingPx` | `wrapPaddingPx` |
| `float-left` | `0` | `wrapPaddingPx` | `wrapPaddingPx` | `0` |
| `float-right` | `0` | `0` | `wrapPaddingPx` | `wrapPaddingPx` |
| `top-bottom` | `wrapPaddingPx` | `0` | `wrapPaddingPx` | `0` |
| `inline` | `wrapPaddingPx` | `wrapPaddingPx` | `wrapPaddingPx` | `wrapPaddingPx` |

The inline scalar was not previously consumed by CSS; preserving it on every
side is lossless if inline wrapping later becomes configurable.

`coordinateSpace` is derived from active geometry rather than trusted from
unvalidated input:

- spanning plus page-positioned becomes `body-span`;
- every other combination becomes `flow`.

`normalizeDocumentImageContentGeometry` in
`src/document/types/documentProject.ts` and the image branch of
`normalizeDocumentContentStyles` in
`src/editor/project/projectSchema.ts` recursively canonicalize arbitrary
editor JSON before it is consumed or serialized. FlowEditor also uses the
same helper at its external-content equality boundary, so parse-only legacy
aliases cannot cause an unfocused editor to reset selection. Canonical output
removes `wrapPaddingPx` and `verticalSpacingPx`, preventing contradictory
persisted sources.

`createDocumentImageAttributes` in
`src/document/extensions/DocumentImageExtension.ts` parses both v3 HTML
attributes and legacy v2 HTML. It emits only
`data-wrap-padding-{top,right,bottom,left}-px` and
`data-coordinate-space`. The old scalar attributes remain parse-only runtime
aliases so direct legacy Tiptap input can still be opened.

Project normalization accepts missing, v1, and v2 document schema data and
writes the current normalized schema. A document schema newer than the current
schema is rejected instead of being
silently downgraded.

## Occupied and exclusion rectangles

`buildExclusionRectangle` in
`src/document/layout/layoutKernel.ts` accepts one or more occupied rectangles,
computes their bounding rectangle, applies normalized four-sided padding, and
optionally clips the result to layout bounds. Touching edges are not treated
as intersections.

For a structured image,
`buildMultiDocumentSpanLayoutModel` measures the rendered image and
`figcaption`. `imageRegionHeightPx` contains image height plus caption height
and resolved caption spacing. That caption-aware region is used for:

- collision rectangles;
- printable/body vertical bounds;
- four-sided text exclusion;
- resize collision checks.

Multiple spanning images therefore create multiple simultaneous exclusion
rectangles. Column bands are split against every exclusion intersecting that
column. Horizontal intervals narrower than 72 CSS pixels are not used as text
bands.

For page overlays, `DocumentOverlayLayer` measures the rendered figure at the
current zoom, converts its height back to unzoomed page units, and includes the
caption extension in pointer move and resize collision rectangles.
`getDocumentOverlayOccupiedRectangle` in
`src/document/layout/overlayGeometry.ts` also accepts an explicit caption
height for non-DOM callers.

Current limitation: the store-level overlay geometry adapter does not have a
DOM caption measurement. `getDocumentOverlayObstacles` therefore uses image
rectangles unless a component has already supplied measured obstacles. Pointer
interaction is caption-aware, but a purely programmatic numeric overlay
commit can only revalidate image bounds and peer image rectangles. A future
non-DOM caption metric would remove that remaining difference.

## Boundaries and collision policy

The pure policy lives in `src/document/layout/layoutKernel.ts`:

- `clampRectanglePositionToBounds` preserves size and clamps the origin;
- `fitRectangleWithinBounds` may shrink an oversized rectangle;
- `getRectangleOverflow` reports overflow without mutating geometry;
- `findRectangleCollisions` returns stable, ID-sorted results;
- `moveRectangleWithoutCollisions` sweeps to a desired origin and stops at the
  first obstacle;
- `resizeRectangleWithoutCollisions` resizes from the top-left anchor and
  finds the first collision through bounded sampling and binary search;
- `resolveInitialRectangleOverlaps` chooses the nearest safe obstacle or
  boundary edge, with top-most then left-most tie breaking.

Move results report both blocking IDs and obstacles that already overlapped
the starting rectangle. Starting overlaps do not trap movement. Insertion
callers are expected to use `resolveInitialRectangleOverlaps`.

Structured images are resolved in Tiptap document order. Each resolved
caption-aware rectangle becomes an obstacle for the following image. If no
safe candidate fits the selected span and body bounds, the requested
rectangle remains clamped and all involved IDs are reported through
`unresolvedCollisionIds`.

That automatic structured overlap resolution is a deterministic render-model
decision. It does not silently rewrite the original Tiptap coordinates. A
subsequent user drag or resize commits the displayed geometry. This preserves
the rule that rendering cannot dirty a project while ensuring identical input
reconstructs identically after reload.

Page overlays use page boundaries. `resolveNewDocumentOverlayGeometry` in
`src/document/layout/overlayGeometry.ts` resolves an overlap at insertion and
the store persists the corrected result. `commitDocumentOverlayGeometry`
applies resize, movement, collision, and page-boundary policy atomically.
Overlay collisions are limited to peers in the same `front` or `behind`
placement layer; the two layers intentionally do not block each other.

## Interaction previews and committed state

### Structured spanning images

`StructuredDocumentSpanLayout` stores pointer previews in
`previewOverrides`, `previewPositionRef`, and `previewResizeRef`.
`schedulePreview` batches visual updates through
`requestAnimationFrame`. Pointer deltas are converted from viewport to body
units by `viewportDeltaToLayoutDelta`; no pointermove writes project state.

On pointer completion, `FlowEditor` calls:

- `commitStructuredDocumentImagePosition`;
- `commitStructuredDocumentImageSize`.

Each function first verifies the captured ProseMirror position and image ID.
If the document changed and that position is stale, it scans the current
document for the same stable ID, commits there, restores a node selection, and
verifies the resulting attributes. Cancellation clears the preview without a
transaction. Stable IDs must be unique for this fallback to be unambiguous;
duplicate legacy-ID repair belongs to the persistence hardening phase.

### Page overlays

`DocumentOverlayLayer` keeps one local `preview` and one interaction snapshot.
It converts viewport deltas to page units and commits only from
`finishInteraction`. Cancellation or window blur rolls back the preview.

`commitOverlayGeometry(pageId, id, update)` in
`src/document/state/documentStore.ts` re-resolves the exact captured page and
stable overlay ID, applies `commitDocumentOverlayGeometry`, and writes that
overlay once. Stale page or object IDs are no-ops. `nudgeOverlay` uses the same
atomic path, so keyboard nudges and numeric geometry changes receive the same
page-boundary and collision policy.

One committed update increments the document revision once and enters the
existing 900 ms bounded autosave queue. Pointer previews neither mark the
project dirty nor serialize assets or page content.

The ordinary flow-image node view also keeps resize width locally and calls
Tiptap `updateAttributes` only when resize completes. Its size remains owned
by the image node; browser CSS continues to own its flow position.

## Overflow behavior

Overflow is reported, never moved to another page.

For ordinary CSS flow, `isDocumentFlowOverflowing` in
`src/document/components/FlowEditor.tsx` compares the body renderer's scroll
and client dimensions. For structured flow,
`buildMultiDocumentSpanLayoutModel` sets `overflowing` when measured content
remains after all bands or when an initial image collision cannot be resolved.
It exposes `layoutContentHeightPx` and `unresolvedCollisionIds`; remaining text
is appended to the final band so the failure is inspectable rather than
silently discarded.

`FlowEditor` reports the result to the shell, and `DocumentPageView` displays
`document-overflow-warning`. The warning is marked
`data-document-export-exclude="true"`. Per the independent-page-story model,
overflow does not create, select, or modify another page.

## Editor and export reuse

The live editor renders through `DocumentPageView`, `FlowEditor`,
`StructuredDocumentSpanLayout`, and
`src/document/styles/document-page.css`.

The committed multi-page PDF path uses
`mountCommittedDocumentExportPages` in
`src/document/components/DocumentProjectExportRenderer.tsx`. It:

1. deep-clones the committed project;
2. mounts every page offscreen at zoom 1 and true 96-CSS-pixel scale;
3. reuses `DocumentPageView`, `TitleEditor`, `FlowEditor`, the structured
   layout model, and the same CSS;
4. waits for page roots, fonts, and layout frames;
5. passes ordered page roots and physical sizes to
   `DocumentExportService.downloadPdfPages`.

This reuse gives the committed PDF path the same column, image, caption,
wrapping, paper, and folio rendering contract as the editor. Because the
snapshot has no component-local drag or resize preview, PDF does not capture
transient geometry.

The remaining export convergence is deferred to P6:

- selected-page PNG currently rasterizes the live selected
  `exportRootRef`;
- print currently clones the live selected `exportRootRef`;
- those two paths can observe mounted UI state, including an in-progress
  local geometry preview;
- browser CSS flow and DOM text measurement remain browser-rendered adapters,
  rather than a standalone pagination engine;
- export-specific DOM cloning and font/raster sequencing remain in
  `src/document/services/documentExportService.ts`.

P6 should route PNG, print, and PDF through one committed-snapshot renderer,
while retaining the shared layout kernel and the reusable page components.
The current raster PDF strategy does not prevent a later vector/text renderer,
provided that renderer consumes the same persisted geometry and layout
contract.

## Verification anchors

The phase-P3 contract is exercised by:

- `__tests__/document-layout-kernel.test.ts`: coordinate conversion, zoom
  independence, mirrored body/column geometry, four-sided caption-aware
  exclusions, bounds, deterministic collisions, initial overlap, and resize;
- `__tests__/document-image-schema-v3.test.ts`: v2-to-v3 JSON and HTML
  migration, bounded padding, canonical serialization, coordinate derivation,
  and future-schema rejection;
- `__tests__/document-positioned-image-contract.test.ts`: multiple structured
  images, caption-aware exclusions, collision/boundary behavior, stable-ID
  move/resize commits, initial overlap, and unresolved-overlap overflow;
- `__tests__/document-overlay-interaction.test.ts`: transactional preview,
  cancellation, zoom conversion, page bounds, and single commits;
- `__tests__/document-overlay-store-geometry.test.ts`: captured page/ID
  commits, stale-ID no-ops, one-revision atomic writes, collisions, and
  insertion resolution;
- `e2e/document-reconstruction.spec.ts`: UI reconstruction, zoom-aware
  structured dragging, caption persistence, and two independently positioned
  spanning images surviving reload.
