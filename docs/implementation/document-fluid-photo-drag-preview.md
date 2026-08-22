# Fluid structured photo drag preview

## Previous interaction path

Structured photo movement was represented as `previewOverrides` state. Each
pointer move scheduled a React state update, which rebuilt the structured
layout model and rerendered the text/image compositor before the next visible
position was painted. Snap guides were also stored in React state and updated
on raw pointer moves.

The geometry calculation itself was correct, including page bounds, column
snapping, nearby-image collision constraints, zoom conversion, and flow-to-page
promotion. The problem was the visual feedback path, not the committed layout
semantics.

## Visual preview architecture

Reposition drag now keeps the authored image attributes and `previewOverrides`
unchanged. Pointer movement still calculates the constrained rectangle from the
layout snapshot captured at pointer-down. It then stores only the newest layout
delta in refs:

```text
pointermove
  -> layout-space snap/collision calculation
  -> latest delta in refs
  -> one pending requestAnimationFrame
  -> translate3d() on the canonical image slot
```

The transform is applied to the structured image slot, so the visible image,
caption unit, selection outline, and resize handle move together. `will-change:
transform` is applied only while the preview is active and is removed on commit
or cancellation. No CSS transition is used.

Grouped images receive the same transform in the same visual frame. Their child
geometry is not rebuilt during movement.

Snap guides remain correct but are now two fixed editor-only DOM guide elements
updated imperatively by the same rAF writer. Moving a guide does not invalidate
the structured model.

## Commit and cancellation

The existing stable-ID position commit remains the only authored movement
operation. Pointer-up flushes the latest pending visual frame, commits the final
constrained coordinates once, and hides guides immediately. The temporary
transform remains until a layout effect observes that the committed model has
the expected image ID and coordinates; this prevents a one-frame snap-back to
the old model position.

A click still selects without changing the anchor. A real drag still promotes a
flow image to `verticalAnchor: 'page-position'` only at commit. Pointer cancel,
Escape, blur, teardown, or an unsuccessful commit removes the transform and
commits nothing.

Span count, authored dimensions, crop/focal settings, captions, and existing
collision/snap rules are not changed by the preview optimization.

## Performance evidence

The Chromium reconstruction regression performs 24 real pointer moves over a
two-photo page with a reference scan. At the tested non-integer zoom (the
fit-derived value after one zoom-out, approximately 65.6%), it observed:

- 24 pointer moves;
- 22 visual preview frames;
- zero additional structured model builds during the drag;
- no authored layout revision during the drag;
- one persistent geometry commit on pointer-up;
- no visible transform/chrome handoff jump beyond sub-pixel browser rounding.

The test also confirms that Photo A remains unchanged while Photo B moves, and
then exercises the reverse independent movement. Unit coverage verifies the
same transform for both members of a grouped image unit.

## Validation

Focused positioned-image Vitest coverage passes, including zoom conversion,
flow-to-pin, cancellation, Escape cancellation, no model mutation during
preview, one commit, visual delta calculation, and grouped translation.

The reconstruction page-space Chromium suite and the secondary-photo,
transform-alignment, span-preservation, and structured-text hit-testing suites
pass. Existing resize behavior remains on its prior model-preview path and was
not broadened in this fix.

The final validation run passed 58 Vitest files / 620 tests. Coverage was
61.82% statements, 52.83% branches, 61.13% functions, and 63.89% lines.
`npm run lint`, TypeScript, production build, `npm run validate`, the 10-test
reconstruction Chromium suite, the 13-test focused Document Chromium suites,
Python recovery tests (3), Rust tests (20), and the Tauri Debian build all
passed. The final 77-test Chromium sweep passed 76 tests; its single failure is
the existing `historical-page-49.png` visual snapshot dimension mismatch
(expected 632×816, runtime 618×798). No historical snapshot was updated. The
Tauri build emitted only the existing bundle-type warning.

## Remaining limitations

Resize preview still uses the existing React/model preview path. It remains
functionally covered but is a separate future performance optimization. The
browser regression uses the available document zoom controls, whose manual
increment produces a fit-derived non-integer zoom; unit coverage additionally
checks 0.5x, 1x, and 2x coordinate conversion.
