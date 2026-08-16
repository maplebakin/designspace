# Document Span Transform Preservation Fix

## Root cause

The Span Columns command treated a layout-region change as an image resize. In
`DocumentEditorShell.handleLayoutChange`, both the flow-image and overlay-image
branches replaced the authored frame width with the full destination span width
and derived a new height. This discarded a user-sized frame when changing from
one column to two or three columns, and it also changed the authored height of
fill-cropped images.

The structured span renderer already had the correct narrower-frame projection:
the rendered frame width is the smaller of the available span width and the
image's authored width. The command was therefore writing geometry that the
renderer did not require. Column-count normalization contained a similar
full-width clamp and could repeat the same damage after a reflow.

## New span transition semantics

`getDocumentImageSpanDimensions` is now the shared transition rule used by the
layout command, overlay conversion, and column-count normalization.

- The selected span defines the image's available layout region.
- If the current authored width fits, width and height are preserved exactly.
- If the current width is too large and the crop mode is `fit`, width is clamped
  to the span and height is recalculated from the natural aspect ratio.
- If the current width is too large and the crop mode is `fill`, width is
  clamped to the span while the authored frame height is preserved.
- A wider destination span never enlarges an existing frame.
- A narrower destination span only clamps when the existing frame cannot fit.
- Crop mode and focal coordinates are carried through unchanged.
- The existing horizontal placement semantics remain authoritative; custom
  `xOffsetPx` is clamped only to the valid destination range.
- Flow images retain their existing vertical anchor. Overlay conversion keeps
  the existing page-position Y projection.

The overlay-to-span path now applies the same dimension rule instead of
constructing a full-span frame. It continues to preserve the overlay's crop,
focal, caption, and page-position data. No schema or persistence format was
changed.

## Geometry model

The alignment fix from `bf6f620104acad07641b222106f08645f354104d` remains the
canonical geometry contract:

```text
transform frame = {
  left: imageLeftPx,
  top: imageTopPx,
  width: renderedImageWidthPx,
  height: renderedImageHeightPx,
}
```

Transform chrome continues to use the rendered image frame. Captions remain
outside that frame; caption-inclusive `imageRegionHeightPx` remains reserved
for collision and exclusion layout. No arbitrary visual offset was added.

Flow-anchored span images remain vertically controlled by article order and
the existing Move Earlier/Move Later behavior. They remain resizeable, crop
editable, and horizontally placeable. Page-position images continue to use the
existing page-coordinate drag, snap, and resize pipeline. The fix does not
change those affordances or redesign the toolbar.

## Grouping and adjacent-image behavior

The row/stack group model and structured span renderer were not changed. The
fix is limited to the explicit Span Columns transition and span-width
normalization. Existing grouped-row and grouped-stack layout coverage, the
caption-inclusive transform alignment coverage, and the adjacent-image
regression continue to pass.

The reconstruction regression was updated to choose its page-position snap
target from the rendered physical-column geometry. This reflects the intended
narrower frame rather than relying on the old full-span assumption.

## Persistence and lifecycle behavior

The existing Tiptap/document persistence path remains authoritative. The new
tests cover:

- single-column to Span 2 and Span 3;
- Span 2 to Span 3 without enlargement;
- Span 3 to Span 2 with fit and fill clamping;
- overlay to span conversion;
- live resize preview and committed geometry;
- crop/focal preservation;
- save, reopen, and page switching;
- alignment of the rendered frame and transform chrome after each transition.

Reopened images retain the final width, height, span count, crop mode, focal
coordinates, and span layout state. Existing page-position Y semantics are
preserved during overlay conversion.

## Files changed

- `src/document/extensions/DocumentImageExtension.ts` — shared span dimension
  calculation.
- `src/document/components/DocumentEditorShell.tsx` — dimension-preserving
  flow and overlay span transitions.
- `src/document/components/FlowEditor.tsx` — dimension-preserving column-count
  normalization.
- `__tests__/document-positioned-image-contract.test.ts` — fit/fill/no-clamp
  contract coverage.
- `e2e/document-span-transform-preservation.spec.ts` — realistic Chromium
  coverage for span transitions, resize, overlay conversion, crop/focal state,
  reopen, and page switching.
- `e2e/document-reconstruction.spec.ts` — geometry-aware existing page-position
  regression assertions.

## Validation

Passed:

- focused Vitest: 5 files, 110 tests;
- full Vitest: 58 files, 596 tests;
- coverage: 58 files, 596 tests;
- TypeScript (`npx tsc --noEmit`);
- ESLint and `npm run lint`;
- production build (`npm run build`);
- `npm run validate`;
- recovery tests: 3 passed;
- Rust/Tauri library tests: 20 passed;
- relevant Document Chromium suites: 14 passed;
- new span-transform Chromium suite: 2 passed;
- existing photo-transform alignment and reconstruction suites;
- grouped-image, crop, structured-text, and typography browser regressions.

The historical layout suite had 5 passing tests and one unrelated existing
visual failure. `historical-page-49.png` expects a 632×816 screenshot while the
current page renders at 618×798. No snapshot was updated and the failure was
not masked.

## Remaining limitations

- Overlay records do not expose a separate persisted horizontal-placement
  semantic. Overlay-to-span conversion therefore retains the existing left-side
  projection and lets the span renderer apply the structured image placement
  rules.
- Flow-anchored images intentionally do not gain free vertical pointer dragging;
  their vertical position remains article-flow controlled.
- Group resize behavior remains the existing group implementation; this fix
  does not introduce aggregate group transforms.
- The fix does not alter persistence schema, history ownership, export, or
  recovery behavior.

## Rollback

Revert the single fix commit. This removes the span-dimension helper and the
three transition call-site changes, while leaving the earlier transform-chrome
alignment fix and all legacy persistence behavior intact.
