# Document Multi-Image Transform Stability Fix

## Root cause

`StructuredDocumentSpanLayout` previously treated every structured span image
as an insertion candidate. It sorted all units by ProseMirror position and
passed each one through `resolveInitialRectangleOverlaps` against the units
that happened to be earlier in that traversal.

That made a passive render/reflow operation positional authority. Adding or
reordering a photo could move an already positioned photo. The resolved
rectangle was then exposed through `imageLeftPx`, `imageTopPx`, and the
rendered dimensions, and the model also replaced `attributes.xOffsetPx` and
`attributes.yPx` with those resolved values. A later transform interaction
could therefore start from collision-generated geometry and commit it as if it
were authored geometry.

## Geometry ownership

The layout now distinguishes three geometry layers:

1. **Authored frame** — persistent `DocumentImageAttributes` and the
   `authoredFrame` projection in `StructuredImageLayout`.
2. **Occupied/layout region** — the image frame plus caption and wrap padding,
   used for exclusions and collision obstacles.
3. **Rendered/resolved frame** — `imageLeftPx`, `imageTopPx`, rendered width and
   height, plus `renderedXOffsetPx`. This is layout output and is never written
   back into `attributes` by passive rendering.

The transform frame remains the geometry established by
`bf6f620104acad07641b222106f08645f354104d`: image left/top and rendered image
width/height. Captions remain outside transform chrome. Caption-inclusive
occupied rectangles continue to serve collision and text-exclusion layout
only.

## Positioned versus flow behavior

`verticalAnchor === 'page-position'` units are now placed at their authored
coordinates before collision analysis. Existing positioned images and explicit
row/stack groups become stable obstacles. If already-authored positioned
images overlap, the overlap is reported as unresolved/overflowing, but neither
image is silently moved.

Flow-anchored images continue to derive their initial vertical position from
article order and may reflow when earlier content changes. They are then
resolved around the fixed positioned obstacles and earlier flow units. This
keeps normal article flow behavior while preventing flow collision handling
from rewriting a positioned photo.

The default Add Photo path creates a flow image, so a newly inserted image can
be moved to the nearest deterministic collision-free layout position without
moving existing positioned images. An image explicitly changed to
page-position remains an explicitly positioned object; its authored position
is respected rather than being silently relocated during a passive render.

The collision candidate ordering for fixed units no longer controls their
positions. Consequently, the rendered frame of positioned photos is
independent of ProseMirror traversal order. Flow candidates retain document
order for article-flow allocation.

## Active transforms

Pointer drag and resize continue to use the rendered model rectangle for the
active interaction and use collision obstacles only while that interaction is
active. Preview overrides remain transient. Cancelling a drag or resize clears
the preview without dispatching a transaction; committing writes only the
final active image geometry. Passive layout recomputation no longer changes
the starting frame of a positioned photo.

The existing zoom conversion, snap, crop/focal, and resize constraints remain
unchanged. The prior alignment fix continues to anchor transform chrome to the
rendered frame rather than the caption-inclusive region.

## Span Columns

The Span Columns preservation rule from the previous fix remains in force:

- Span 2/3 changes define available layout width and do not enlarge a fitting
  frame.
- A frame wider than its destination span is clamped.
- `fit` recalculates height from the natural aspect ratio when clamped.
- `fill` preserves the authored frame height when clamped.
- Span 2 → 3 and Span 3 → 2 preserve dimensions whenever they fit.

The multi-image stability change does not feed span collision output into these
authored dimensions.

## Groups and captions

Groups remain compound layout units. Row and stack child geometry is produced
by the existing group layout helpers, and group metadata changes remain the
explicit mechanism allowed to reposition or resize group children. An
unrelated image cannot passively translate an existing group.

Caption geometry remains included in group bounds, occupied regions, and
exclusions, but not in the transform frame or transform chrome.

## Persistence

No schema or serialization changes were required. Persistent image attributes
remain the source used by save/reopen. The Chromium regression covers:

```text
transform A → add B → transform B → save/reopen → add C
```

Both A and B retain their committed frame geometry after reopen, and adding C
does not alter either image. Existing page-switch, crop/focal, and group
persistence coverage remains green.

## Files changed

- `src/document/components/StructuredDocumentSpanLayout.tsx`
  - fixed positioned/group obstacle handling;
  - authored/resolved geometry separation;
  - rendered offset projection.
- `__tests__/document-positioned-image-contract.test.ts`
  - stable positioned frames;
  - overlapping positioned images;
  - traversal-order determinism;
  - flow-versus-positioned collision behavior;
  - group stability.
- `e2e/document-span-transform-preservation.spec.ts`
  - multi-photo add/transform/reopen regression and frame persistence checks.
- `docs/implementation/document-multi-image-transform-stability-fix.md`

## Validation

Passed:

- focused Vitest: 5 files, 114 tests;
- full Vitest: 58 files, 600 tests;
- coverage: 58 files, 600 tests;
- TypeScript;
- ESLint and `npm run lint`;
- production build;
- `npm run validate`;
- recovery tests: 3 passed;
- Rust/Tauri tests: 20 passed;
- relevant Document Chromium suites: 15 passed;
- span-transform preservation suite: 3 passed;
- existing photo-transform alignment, reconstruction, group, crop, zoom,
  persistence, and export regressions.

The historical layout suite had 5 passing tests and one unrelated existing
visual snapshot failure. `historical-page-49.png` expects 632×816 while the
current rendered page is 618×798. No snapshot was changed or weakened.

## Remaining limitations

- Explicitly page-positioned insertion is treated as an authored placement and
  is not silently relocated. The normal Add Photo flow path receives
  collision-aware placement through flow layout.
- Existing overlapping positioned images remain overlapping by design; the
  model reports the unresolved collision rather than mutating either photo.
- Group resize and compound transform semantics remain owned by the existing
  group implementation.
- Persistence schema, history ownership, export ownership, and recovery were
  not redesigned.

## Rollback

Revert the single fix commit. This restores the prior collision-resolution
behavior while leaving the earlier photo transform alignment and Span Columns
dimension-preservation commits intact.
