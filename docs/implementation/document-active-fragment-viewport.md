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
| `StructuredDocumentSpanLayout.tsx` | 4,600 | 4,629 | +29 |
| `FlowEditor.tsx` | 1,478 | 1,482 | +4 |
| `document-page.css` | 2,417 | 2,455 | +38 |
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
- coverage: 62.43% statements, 64.56% lines;
- focused Document editor/fragment tests: 110 passed;
- focused structured hit-testing and live-typing browser set: 5 passed;
- TypeScript, ESLint, production build, `validate`, recovery tests, and Rust
  tests (20 passed);
- intentional active-fragment viewport screenshot; no unrelated snapshots
  changed.

The full Chromium run completed with 79/84 passing. Its failures were outside
the new viewport assertions: one historical page-49 snapshot dimension drift,
one reference-adjustment drag expectation, one fixed-photo geometry tolerance,
and three title-click cases from the first pointer-event arrangement. The title
workflow passed after restoring the pre-existing title affordance hit target;
the focused viewport suite remained 5/5 green. Native Tauri/WebKit validation
is unavailable in this environment.
