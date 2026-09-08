# Document fragment and selection simplification

This Move-2 pass starts from `8749b306` and is deliberately limited to the
Document editing boundary. Persistence, Canvas, export, geometry kernels,
schema, and recovery were not reopened.

## 1. Final text ownership contract

```text
ProseMirror document / selection / history
        │
        ├── live keyboard and caret surface (one owner)
        │
        └── StructuredDocumentSpanLayout
              ├── frozen page geometry
              └── non-editing visual fragments
```

The structured compositor remains the visual geometry authority. ProseMirror
remains the content, input, history, and native-selection authority. The
structured copy no longer manufactures a second caret or selection highlight.
Native `::selection` and the mounted PM surface are the only active editing
decoration paths.

## 2. Live/frozen fragment identity

Structured fragment IDs remain transient layout anchors. Their numeric PM
ranges are now explicitly treated as frozen metadata, not live positions.
`resolveLiveStructuredFragmentRange()` resolves a frozen fragment against the
current PM block using the stable block index and fragment ordinal/span. The
active edit target uses these resolved ranges after text changes instead of
comparing current selection positions directly with stale layout numbers.

```text
frozen fragment ID + block/ordinal span
        │
        └── resolve against current PM block
                    │
                    └── active edit target / selection owner
```

This keeps the compositor frozen during typing while making the identity
contract explicit. The long multi-column marked/Unicode regression inserts text
after the layout is frozen and verifies that the selected continuation fragment
remains the target.

## 3. Paint/caret ownership

Removed the `decorateStructuredTextHtml()` DOM rewrite and its generated
selection-highlight/caret markup. That code walked every structured text node,
split text nodes, inserted synthetic spans, and attempted to avoid duplicating
the live PM caret. It was an independent paint owner and an unnecessary
selection bridge.

The active fragment mask is now applied directly to the rendered band element;
the band HTML remains the compositor's authored text and is not rewritten for
selection state. The PM source owns active glyphs, caret, and selection.

The PM source is still a single cheap source surface and structured editing
still avoids CSS multicolumn contenteditable. A PM block may still be mounted
over the selected frozen fragment for presentation; this pass does not claim
that one block is a perfect multi-fragment WYSIWYG surface. It removes the
second caret/highlight owner and makes that remaining limitation explicit.

## 4. Selection transition architecture

`DocumentSelectionProjection` remains the shell's UI projection. Existing
compatibility mirrors in the store remain because adapters and older tests
consume them, but this pass does not add another selection source. Synthetic
structured selection decoration is gone; PM selection is projected to the
toolbar/inspector and native browser painting.

```text
PM / structured pointer intent / overlay interaction
                 │
                 ▼
       DocumentSelectionProjection
                 │
                 ├── toolbar and inspector
                 ├── structured image/group chrome
                 └── compatibility store mirrors
```

The existing pointer-scoped image/text ownership and stable-ID PM lookup were
preserved. No Canvas or persistence selection behavior was changed.

## 5. Async image operation identity

Ordinary image import, clipboard paste/drop, and selected-image replacement now
capture a bounded context before awaiting ingestion:

```text
session identity + library/project identity + page ID
       + insertion position or replacement image ID
                         │
                         ▼ await ingestion
                         │
              ownership validation
                         │
             insert/replace or abort
```

Completion checks session, project target, and active page before adding asset
bytes or dispatching PM mutations. A page switch or session replacement causes
the operation to abort rather than inserting into whichever page is current
after `await`. Replacement also re-resolves the current image by stable ID.

## 6. Mechanisms removed

- 177 lines of structured synthetic caret/selection decoration logic;
- generated `.document-structured-caret` and
  `.document-structured-selection-highlight` CSS paths;
- text-node splitting and DOM range decoration for active PM selections;
- direct dependency of structured band HTML on live selection/caret offsets.

The four measured runtime files changed as follows (baseline `8749b306` →
current):

| File | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `DocumentEditorShell.tsx` | 4,207 | 4,275 | +68 |
| `FlowEditor.tsx` | 1,478 | 1,478 | 0 |
| `StructuredDocumentSpanLayout.tsx` | 4,744 | 4,600 | -144 |
| `DocumentImageNodeView.tsx` | 414 | 414 | 0 |

The shell increase is the explicit bounded image-operation guard. Runtime TS
code decreased by 76 lines across the measured files; CSS lost 35 lines. The
net active editing surface is smaller, even though selection-controller
consolidation is not yet complete.

## 7. Compatibility paths retained and why

- Raw DocumentStore selection IDs remain adapter outputs consumed by unified
  session compatibility code.
- `DocumentSelectionProjection` remains the single shell presentation object.
- PM single-column source remains mounted for WebKit-safe native input.
- Existing pointer intent, stable image IDs, group projection, drag preview,
  and export exclusion paths were protected.
- No legacy API was deleted solely because a direct production caller was not
  found.

## 8. Reconstruction workflow

The existing reconstruction/photo/span test matrix and fragment contract tests
remain green. The new frozen-layout regression covers a long paragraph split
across columns, selection of a continuation fragment, insertion after the
layout snapshot, and re-resolution of the same fragment identity.

The async image path now has the required page/session guard at the shell
boundary. A full browser delayed-ingestion workflow is still a follow-up test
opportunity; the current Vitest suite verifies the resolver and editor/store
contracts rather than pretending DOM attributes prove painted ownership.

## 9. Performance

The pass removes per-selection DOM rewriting and synthetic marker insertion.
It does not rebuild structured layout per keystroke, restore multicolumn
contenteditable, alter lifecycle debounce, or touch persistence. The existing
WebKit/Tauri typing architecture remains in place.

## 10. Validation

Passed during this pass:

- fragment/image contract tests: 30 passed;
- Document editor and store tests: 106 passed;
- TypeScript (`npx tsc --noEmit`);
- ESLint (`npm run lint`).
- full Vitest: 60 files, 637 passed;
- coverage: passed (62.52% statements, 53.32% branches);
- production build (`npm run build`);
- recovery tests: 3 passed;
- Rust tests: 20 passed;
- Chromium: 81/84 passed in the full run. Two interaction failures passed on
  isolated reruns; the remaining failure is the pre-existing reviewed
  historical page-49 snapshot dimension mismatch. No snapshot was updated.

Tauri/WebKit typing was not available in this environment.

## 11. Remaining risks

- A PM block is still the mounted editing presentation unit when a paragraph
  spans several frozen fragments. The numeric-range staleness problem is
  bounded by explicit live resolution, but the visual model is not a full
  multi-fragment editable clone.
- The shell still contains compatibility selection reconciliation for external
  store callers; projection is not yet a completely write-only mirror.
- Delayed image-ingestion browser coverage should be added with a real blocked
  ingestion promise and visible page assertions.

### Direct answers

- Runtime Document complexity decreased: yes, by 76 TS lines in the measured
  runtime files and 35 CSS lines, chiefly removing synthetic decoration.
- Old selection paths removed: one entire structured synthetic caret/highlight
  path, including its DOM walker and text-node splitting.
- CSS ownership mechanisms removed: two generated classes and their active
  editing CSS branches.
- PM block treated as a visual fragment: yes, the existing active-source
  placement still does this; it is documented as a remaining limitation.
- Frozen identity stale after typing: numeric ranges can be stale, but active
  target resolution now maps the stable fragment anchor to the current block.
- Selection projection one-way: active editing decoration is one-way through
  PM → projection; compatibility store reconciliation remains for legacy
  external setters.
- Wrong-page/session async image completion: guarded operations now abort when
  session, project target, or page no longer matches.
- Exactly deleted: `decorateStructuredTextHtml`, its synthetic caret/highlight
  spans, and their CSS ownership paths. No persistence, Canvas, schema, export,
  or protected geometry mechanism was deleted.
