# Photo ↔ Text Interaction Handoff Fix

## Summary

This change makes a pointer gesture choose one interaction owner at pointerdown
and preserves that owner through the rest of the gesture. A click on structured
text now enters text editing at the position resolved from the clicked page
coordinates. A click on a photo continues to select that photo by stable image
ID. The selection-only transition does not change authored document content or
photo geometry.

## Exact root cause

There were two independent problems in the old photo-to-text path:

1. `FlowEditor` handled `onEditText()` while a photo `NodeSelection` was active
   by creating `TextSelection.near(selection.from, -1)`. That made the previous
   photo's ProseMirror position the spatial fallback for a click somewhere else
   on the page.
2. `StructuredDocumentSpanLayout` then called `onEditText()` and dispatched a
   second, exact text selection from the clicked band. The intermediate
   image-relative selection allowed focus, toolbar, and layout-layer callbacks
   to race. The broad layout pointer handler also discarded the pointer
   coordinates and called the same no-argument path.

The previous `pointerSelectedImageIdRef` only suppressed a duplicate click for
the same image. It did not represent the owner of the whole pointer gesture,
so a pointerdown that changed the interaction layer could be reclassified by a
later click event. The null-image selection path also needed to clear group
selection state along with the selected image IDs.

## Previous and final paths

Previously, the effective path was:

```text
photo NodeSelection
  → onEditText()
  → TextSelection.near(previousPhotoPosition, -1)
  → focus/selection callbacks
  → clicked text position applied separately
```

The final path is:

```text
pointerdown
  → classify owner: text | image | resize
  → for text, resolve the current visible point to a ProseMirror position
  → onEditText(resolvedPosition)
  → one TextSelection transaction at that position
  → focus the body editor
  → consume the later click for the same pointer gesture
```

`createDocumentTextSelection()` clamps a supplied position to the current
document. If the structured resolver cannot find a reasonable text position,
the fallback is document-relative (`TextSelection.atStart`), never the prior
image position. The resolver's nearest line/region behavior handles whitespace,
line ends, and clicks near a text band.

Text dragging still updates the range as the pointer moves, but the initial
caret is already the position from the initiating pointerdown. Keyboard-only
image exit retains its separate near-document behavior where useful; it is not
used for pointer-based text entry.

## Gesture ownership and hit testing

`StructuredDocumentSpanLayout` now keeps a transient intent record containing
the pointer ID, owner, image ID where applicable, and resolved text position.
Image and resize handlers establish their own intent. Text-band and broad-layout
handlers establish text intent. The root and image click handlers consume an
existing intent instead of selecting a different owner. Pointer cancel, blur,
Escape cancellation, and unmount clear the transient record.

The canonical visible photo frame / flow-image hit target remains the only
structured photo interaction surface. The broad layout pointer handler ignores
occupied image slots and flow-image hit targets, so it cannot claim a photo
click. Existing caption and frame geometry behavior is unchanged.

Browser evidence from the default-flow-photo regression shows
`elementFromPoint()` at the visible B frame resolving to
`.document-span-layout__flow-image-hit-target` with B's persistent
`data-document-visible-image-id`. The text-point evidence resolves to the
explicit structured text column. The overlap/edge regression continues to
select the frame on the visible image and text immediately outside it.

## Selection-state synchronization

The text transition creates a ProseMirror `TextSelection` directly. The normal
selection callback then clears:

- `selectedFlowImage`;
- `selectedFlowImageId`;
- `selectedStructuredImageIds`;
- `selectedImageGroupId`; and
- the selected overlay context when body text is focused.

The shell exposes the relevant transient IDs and selection kind as diagnostic
attributes. The browser assertions verify text selection, body focus, body
toolbar context, and the absence of photo inspector/chrome after one click.

## Regression results

- The default B regression first selects a newly inserted ordinary flow photo
  while A is already span-columns; it does not pre-convert B.
- The far-away text regression selects text near the top of column 1 after a
  photo near the bottom is selected. The resolved position is the clicked text
  position, not a position adjacent to the photo.
- The repeated A → text column 1 → B → text column 3 → A → text column 2 → B
  switching sequence passes with one click per transition.
- The next keypress (`XYZ`) is inserted at the clicked text location without a
  second click, and both image rectangles remain unchanged.
- Selection-only handoffs produce no authored update in the component test;
  the browser regression also keeps the structured layout revision unchanged.
- Existing image-edge, caption, ordinary-flow-mode, overlap, stable-position,
  save/reopen, page-switch, transform, and fluid-drag regressions remain green.

## Validation

The focused interaction/geometry Chromium batch passed 26 tests, including the
new handoff test, structured text hit testing, secondary-photo selection,
reconstruction page-space, reference, fluid drag, autosave typing, transform
alignment, and span-preservation coverage.

Final validation results:

- Full Vitest: 58 files, 622 tests passed.
- Coverage: passed; Statements 62.07%, Branches 53.00%, Functions 61.35%,
  Lines 64.17%.
- ESLint, TypeScript, production build, and `npm run validate`: passed.
- Recovery tools: 3 tests passed.
- Rust/Tauri: 20 Rust tests passed, Cargo check passed, and Tauri CLI 2.9.6
  was available.
- Full Chromium: 77 tests passed. One unrelated historical visual snapshot
  (`historical-page-49.png`) still fails with the existing 632×816 versus
  618×798 mismatch; no historical snapshot was updated.

## Remaining limitations

The resolver can only choose a precise caret where the structured compositor has
usable text/line geometry. Empty-document or otherwise unmapped clicks use the
document-start fallback. Keyboard commands that intentionally leave an image
selection remain distinct from pointer-based spatial handoff semantics.
