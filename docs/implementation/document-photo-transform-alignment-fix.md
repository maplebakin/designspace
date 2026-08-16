# Document Photo Transform Alignment Fix

## Root cause

The defect was in the structured-flow image chrome, not in Canvas and not in
the page-overlay image path.

`StructuredDocumentSpanLayout` correctly calculated a photo frame from
`imageLeftPx`, `imageTopPx`, `renderedImageWidthPx`, and
`renderedImageHeightPx`. However, the selection outline was applied to
`.document-span-layout__image-content`, and the resize handle was positioned
against the image slot's bottom edge. That content/slot box also contains the
caption. For grouped or adjacent photos with captions, its height was the
caption-inclusive occupied region (`imageRegionHeightPx`), not the rendered
photo frame. The same structural problem existed in `DocumentImageNodeView`,
where selection chrome and the handle followed the outer image content after
the caption.

The mismatch was amplified by zoom because both boxes were scaled together;
zoom did not cause the error, it only made the different source rectangles
more visible. A browser probe with two grouped adjacent images measured
caption-inclusive slot/content heights of approximately 209px and 122px while
the corresponding rendered photo frames were approximately 162px and 75px at
101% zoom.

## Geometry model after the fix

The transformable photo frame now has one explicit geometry contract:

```text
page-space frame = {
  left: imageLeftPx,
  top: imageTopPx,
  width: renderedImageWidthPx,
  height: renderedImageHeightPx,
}
```

`getStructuredImageFrameGeometry` is the shared projection used by the
structured layout renderer and its editor-only transform chrome. The chrome
is an absolutely positioned sibling inside the image slot, whose origin is
the slot's model `left/top`; its width and height are the model's rendered
frame width and height. The selection outline and resize handle therefore end
at the actual photo frame, while caption flow remains outside the transform
boundary.

The page still uses the existing unzoomed page/body coordinate model and the
existing `.document-page-transform { transform: scale(zoom) }` projection.
Because the frame and chrome are both children of that projection, their
viewport rectangles remain coincident at every zoom. Group collision and
exclusion geometry continues to use the caption-inclusive occupied rectangle;
that is layout flow geometry, not transform geometry.

The regular Tiptap image node view uses the same separation: a frame container
holds the rendered frame and handle, and the caption remains a sibling. Crop
mode and focal coordinates still control the frame's media rendering only;
they do not change the transform boundary independently of the model frame.

## Before and after

Before:

- selecting a structured image outlined the caption-inclusive content box;
- the resize handle could sit below the actual photo at the occupied-region
  bottom;
- grouped/adjacent photos could show guides at positions that did not match
  their visible frames;
- NodeView selection had the same caption-inclusive boundary risk.

After:

- selection outline and handle are frame-bound;
- captions remain selectable/rendered flow content without expanding photo
  transform chrome;
- preview resize and committed resize use the same frame projection;
- group/reflow, crop/focal changes, zoom, reopen, and page switching rebuild
  the same model and remain aligned;
- editor-only chrome carries both `data-document-editor-only` and
  `data-document-export-exclude` and is not part of export HTML.

No persisted schema, image attributes, history format, reference layer, or
export renderer was redesigned.

## Files changed

- `src/document/components/StructuredDocumentSpanLayout.tsx` — added the
  frame-geometry projection and rendered frame-bound structured chrome.
- `src/document/components/DocumentImageNodeView.tsx` — separated the frame
  container/handle from caption flow and bound NodeView selection to the frame.
- `src/document/extensions/DocumentImageExtension.ts` — marked the rendered
  photo frame for deterministic DOM inspection without changing persisted
  image attributes.
- `src/document/styles/document-page.css` — added frame-bound structured
  chrome styling and corrected NodeView selection/handle selectors.
- `__tests__/document-positioned-image-contract.test.ts` — verifies the model
  frame projection, caption separation, selected chrome, and export exclusion.
- `e2e/document-photo-transform-alignment.spec.ts` — Chromium coverage for
  grouped adjacent photos, captions, crop/focal state, resize preview and
  commit, zoom, save/reopen, and page switching.

## Tests and validation

Passed:

- focused Vitest document image/layout suite: 5 files, 107 tests;
- full Vitest suite: 58 files, 593 tests;
- V8 coverage: completed successfully (61.53% statements overall);
- TypeScript: `npx tsc --noEmit`;
- ESLint: `npm run lint`;
- production build: `npm run build`;
- `npm run validate`;
- recovery tests: 3 passed;
- Rust/Tauri tests: 20 library tests passed;
- focused photo/reconstruction Chromium suite: 9 passed;
- supplemental structured-text, typography, and historical-layout coverage:
  8 passed.

One unrelated existing visual-regression test remains failing and was not
altered: `historical-book-layout.spec.ts` expected the page-49 screenshot at
632x816, while the current run rendered 618x798. The other eight tests in that
supplemental command passed. No snapshot was updated. The failure is a page
fit/screenshot-size mismatch outside the changed transform chrome geometry;
the focused reconstruction and export/image tests passed.

The normal Node `--localstorage-file` warnings and the existing Browserslist
staleness notice were non-failing warnings.

## Remaining edge cases

- A grouped selection continues to expose individual child photo frames and
  the existing primary-image resize handle; this fix does not redesign group
  selection into one aggregate resize box.
- Page overlay images and scan/reference handling use their existing explicit
  page-space geometry and were intentionally left unchanged.
- The visual outline stroke itself is editor chrome; its two-pixel stroke does
  not participate in layout geometry.

## Rollback

Revert the containing fix commit. This restores the previous selection/handle
placement without requiring a data migration or persistence rollback. The
change does not alter stored image attributes or project schema.
