# Document reconstruction page-space interaction fix

## Result

The reconstruction workflow now supports promoting a structured flow photo to
an independently positioned page photo by dragging it. A click still selects
the photo without changing its layout mode. Reference scans, including the
first page of a PDF, are visible behind the live reconstruction and remain
excluded from export.

## Root causes

Two independent interaction/layering defects were involved:

1. `StructuredDocumentSpanLayout.handleImagePointerDown` selected the image,
   then returned immediately unless `verticalAnchor` was already
   `page-position`. A flow-anchored span could therefore be selected and
   resized, but could never establish a movement session.
2. `DocumentPageView` put `ScanReferenceLayer` at z-index 1 and the authored
   export root at z-index 2, while also applying an opaque inline
   `backgroundColor: paperColor` to that root. The reference asset and its
   controls were present, but the higher opaque rectangle painted over the
   scan. The pre-fix browser regression observed the root as
   `rgb(250, 248, 245)` instead of transparent.

The adjustment path had a related pointer-ownership problem: after the scan
was visible behind the root, the root could still shield the scan from pointer
input while adjustment was active.

## Drag-to-pin semantics

The structured image pointer lifecycle is now:

- Pointer down selects by persistent image ID and records the canonical
  rendered frame.
- Movement below a 6 CSS-pixel threshold is treated as a click. It does not
  mutate the image anchor.
- Once the threshold is crossed, a flow-anchored image previews from its
  current `imageLeftPx`, `imageTopPx`, `renderedImageWidthPx`, and
  `renderedImageHeightPx`. The first preview therefore does not jump.
- The preview adds `verticalAnchor: 'page-position'` only after the real drag
  begins. It preserves span count, span start column, dimensions, crop/focal
  settings, wrap padding, and caption. The existing snapping and collision
  rules still constrain the final frame.
- Pointer up commits promotion, `horizontalPlacement: 'custom'`, x, and y as
  one `setNodeMarkup` transaction through the existing
  `modify-structured-image-layout` observation path. The commit resolves the
  current ProseMirror position by stable image ID.
- Pointer cancel, blur, or a below-threshold pointer-up clears the preview and
  leaves the flow anchor unchanged.

Existing fixed-image movement retains its established collision geometry, and
resize remains independent of vertical-anchor promotion.

## Reference layering and pointer ownership

The live page now has one paper-background owner:

```text
document-page-sheet                 paperColor background
  ScanReferenceLayer                z-index 1, editor-only
  document-page-export-root         z-index 2, transparent in live editor
    authored content and editor UI
```

The export renderer opts into an export surface whose root has the paper
colour. The PNG/PDF/print services also continue to apply the explicit paper
colour to their clone/canvas surfaces. The reference is removed from export by
the existing reference/export-exclusion path.

When adjustment is off, the reference layer has `pointer-events: none`, so
text, photos, and transform chrome remain interactive. When adjustment is on,
the authored root temporarily has `pointer-events: none` and the unlocked
reference layer receives the drag. Finishing adjustment restores document
pointer interaction. Locked references refuse adjustment until explicitly
unlocked. Newly imported references start unlocked so the normal adjustment
workflow is available; the lock control remains persistent.

## Browser evidence

The PDF regression imports a valid one-page PDF, confirms
`data-reference-source-type="pdf"`, and confirms that PDF.js produces a
`data:image/png` source for page one. After the fix:

- the live export root computes to `rgba(0, 0, 0, 0)`;
- the reference layer has a non-zero page-overlapping rectangle;
- a page screenshot pixel differs from the paper colour, proving the scan is
  painted rather than merely represented by controls;
- adjustment changes the reference offsets through real mouse movement while
  the root is pointer-inert;
- visibility, opacity, fit-to-page, locking, finish-adjusting, and zoom are
  covered by browser assertions.

The secondary-photo suite also records the canonical owner for a default flow
photo: its raw source NodeView is zero-sized/hidden, while the visible frame's
structured hit target is a `document-span-layout__flow-image-hit-target` with
the persistent image ID. `elementFromPoint()` at its frame centre resolves to
that same ID.

## Persistence and export

The reconstruction acceptance flow creates a three-column page, imports a PDF
reference, adds two photos, spans and drags each photo without first changing
the vertical-placement selector, adds captions, verifies A remains unchanged
while B moves, switches pages, saves, reopens, and verifies both frame
geometries, captions, IDs, and reference source. PNG export retains the paper
colour and the reference is absent; the authored photos remain exportable and
editor-only chrome is excluded.

## Validation

- Focused drag/reference Chromium suite: 4 passed.
- Secondary-photo selection suite: 7 passed.
- Relevant document Chromium suites (selection, reconstruction, transform
  alignment, span preservation, structured text hit testing, and export): 25
  passed.
- Full Vitest: 606 tests across 58 files passed.
- Coverage: 61.48% statements, 52.60% branches, 60.84% functions, 63.54%
  lines.
- TypeScript, ESLint, production build, and `npm run validate`: passed.
- Recovery tests: 3 passed.
- Rust/Tauri tests: 20 passed; no failures.

## Remaining limitations

Direct drag-to-pin is intentionally implemented for structured span photos,
where the page-space frame and vertical-placement control exist. Ordinary
float/inline photos retain article-flow semantics and their existing
selection/resize behavior until the user converts them to a structured span
or explicitly changes their layout mode. Persisted locked references still
require an explicit unlock before adjustment.
