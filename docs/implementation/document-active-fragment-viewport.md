# Document active structured fragment viewport

This bounded fix follows `5b616660bfe84867f554264f76dae9948efd0099`. It
changes only the active structured-text presentation boundary.

## 1. Final presentation contract

```text
ProseMirror content/history/selection/caret
                 │
                 ▼
      active fragment viewport (real clipped DOM container)
                 │
                 ▼
        frozen StructuredDocumentSpanLayout fragments
```

The PM editor remains the live input engine and source of truth. Structured
layout remains the page geometry authority. The PM block is no longer placed
as though it were itself a visual fragment. The parent viewport owns the
fragment rectangle and clips every live pixel to that rectangle.

## 2. Active viewport model

`ActiveStructuredFragmentViewport` records the complete handoff:

- fragment ID and page ID;
- PM block index and current resolved PM range;
- structured fragment rectangle;
- measured live PM range rectangle; and
- the internal alignment offset applied to the PM source.

The structured model chooses the fragment and its page-space rectangle.
`Range.getBoundingClientRect()` is used only to calculate the internal source
offset. It cannot select an interaction target.

The viewport is mounted around `EditorContent`, has a physical `overflow:
hidden` boundary, and is sized to the active fragment. The PM source is
translated inside that container so its resolved range begins at the fragment
origin. The active PM block is exposed through a ProseMirror node decoration;
all other PM blocks remain hidden while structured editing is active.

## 3. Caret crossing and structural edits

The active fragment target is recomputed from the current PM selection and the
frozen fragment model. When the selection crosses into a continuation, the
viewport geometry and PM node decoration move to the new fragment without
blurring or remounting the editor. PM focus and native selection remain intact.

Text transactions do not rebuild the structured model. The viewport is
re-aligned against the current live range and remains clipped if the frozen
layout becomes temporarily stale. Structural edits continue to use the
existing deferred reconciliation boundary.

## 4. Removed whole-block presentation machinery

Deleted from `StructuredDocumentSpanLayout`:

- the generated `<style data-document-live-edit-style>` element;
- generated `:nth-child(...)` source-block selectors;
- `fragmentByBlockIndex` placement maps;
- whole-block `position`, `left`, `top`, `width`, and conditional height rules;
- the first-active-fragment placement assumption;
- the old single-fragment-only clipping branch;
- source-block positioning as the visual geometry mechanism.

The replacement has one viewport container, one PM decoration plugin, one live
range measurement, and one transform. There are no competing active-source
presentation paths.

## 5. Regression coverage

The structured text hit-testing browser suite now verifies the viewport's
physical clipping, canonical non-active fragments, stable columns/photos, and
continued typing. It also captures an intentional screenshot of the active
fragment viewport:

`e2e/document-structured-text-hit-testing.spec.ts-snapshots/active-fragment-viewport-chromium-linux.png`

The existing multi-column typing performance tests remain green and report
zero structured model rebuilds during the typing burst. The reproduction's
failure mode—live text painting through neighboring frozen content—cannot
occur outside the viewport rectangle.

## 6. Complexity counts

Measured against `5b616660`:

| Surface | Before | After | Change |
| --- | ---: | ---: | ---: |
| `StructuredDocumentSpanLayout.tsx` | 4,600 | 4,725 | +125 |
| `FlowEditor.tsx` | 1,478 | 1,482 | +4 |
| `document-page.css` | 2,417 | 2,461 | +44 |
| generated active-source style rules | present | 0 | −100% |
| active presentation helpers | whole-block placement + clip branch | viewport model + PM decoration | replaced |

The line count rises because the viewport is an explicit boundary rather than
another selector convention. Active presentation complexity decreases in kind:
one clipping container and one PM decoration replace the previous generated
placement table and block-positioning rules. No old whole-block positioning
machinery remains.

## 7. Acceptance answers

- **Is a PM block still treated as a visual fragment?** No. It is an input
  source clipped by a fragment viewport; its own box is not the geometry
  authority.
- **Can live PM text paint outside the active fragment?** No. The viewport has
  a physical overflow clip; the PM source cannot paint outside its bounds.
- **What determines viewport geometry?** The frozen structured fragment's page
  rectangle.
- **What determines internal alignment?** The current PM range's DOM rect,
  used only for translation inside the viewport.
- **What happens when the caret crosses fragments?** The current selection is
  resolved to the next frozen fragment; the PM decoration and viewport move
  while editor focus/selection stay alive.
- **What whole-block machinery was deleted?** Generated style tags,
  nth-child selectors, block placement maps, whole-block geometry rules, and
  the first-fragment placement assumption.
- **Did runtime complexity decrease?** The measured line count increases for
  the explicit boundary, but the old competing presentation path is gone:
  generated rule count is zero and ownership is now one viewport plus one PM
  decoration.
- **Was the screenshot reproduction eliminated?** Yes. The new viewport
  screenshot and browser clipping assertions pass; live typing and structured
  hit-testing remain green.

## 8. Validation

Passed:

- full Vitest: 60 files, 637 tests;
- coverage: 62.49% statements, 64.62% lines;
- focused Document editor/fragment tests: 110 passed;
- focused structured hit-testing, live-typing, and historical drop-cap browser
  set: 6 passed;
- TypeScript, ESLint, production build, `validate`, recovery tests, and Rust
  tests (20 passed);
- intentional active-fragment viewport screenshot; no unrelated snapshots
  changed.

The final full Chromium run completed with 79/85 passing. Its six failures were
outside the viewport assertions: reference persistence/image-loading and
reference-adjustment timing, fixed-photo geometry tolerance, one flaky photo
selection timing case (which passed when rerun alone), and two existing
historical export/snapshot assumptions. The focused viewport/live-typing/
historical reproduction set remained 6/6 green. Native Tauri/WebKit validation
is unavailable in this environment.

## 9. Alignment and masking follow-up

The remaining overlap was not viewport spill. It was a canonical ownership
failure: the active flag was placed on the whole structured text band whenever
one of its fragments was active. That left the active fragment's frozen glyphs
visible. A drop-cap `::first-letter` rule also supplied its own explicit color,
so hiding the element's normal text color did not hide that glyph.

The mask now lives on the exact element carrying the active
`data-document-fragment-id`, and has an explicit `::first-letter` transparent
rule. Non-active fragments in the same band remain untouched. The regression
checks the exact active element and its drop-cap pseudo-element. Because the
structured HTML is installed with React `dangerouslySetInnerHTML`, the
imperative mask synchronizer also verifies the DOM's active-ID set before
skipping a pass and reapplies it after a render replaces those nodes.

The alignment calculation now names every boundary and converts through client
space:

```text
structured fragment page/body CSS px
        -> structured-layout client rect (zoomed)
        -> editor-root client rect (zoomed)
        -> viewport-local CSS px
        -> live PM range client rect
        -> editor-root CSS-pixel transform
```

The active viewport records these values in
`data-active-edit-viewport-diagnostics`, including both the pre-transform
source range and the final live range.

On the historical page-49 first paragraph with a drop cap, the measured
activation was:

| Measurement | Result |
| --- | ---: |
| fragment page/body rect | `0, 0, 220.27 × 139.13` CSS px |
| root/editor client origin | `848.668, 319.246` px (identical) |
| root scale | `0.75548 × 0.75564` |
| viewport client rect | `848.668, 319.246, 166.451 × 105.134` px |
| source range before transform | top `320.757`, right `1015.119` px |
| applied alignment transform | `x=0`, `y=-2.000` editor CSS px |
| final live range | top `319.246`, right `1015.119` px |
| active canonical fragment | top `319.246`, right `1015.119` px |

The final live range and canonical fragment share the same left/top/right
within sub-pixel measurement noise. Their bottom edges differ by 3.68 px because
the DOM range reports painted glyph bounds while the canonical element reports
its full line-box fragment rectangle; the visible baseline/glyph edge is the
aligned contract.

The focused historical regression is
`historical-book-layout.spec.ts :: aligns and masks the active first drop-cap
fragment`, with screenshot
`historical-page-49-active-first-drop-cap-chromium-linux.png`. It passes with
the page visually unchanged except for the live editor's caret/selection. It
also records the client rectangles of every text column and occupied image
before activation and requires each left/top/width/height delta to remain below
1 CSS px during activation.
