# Structured document live-typing performance fix

## Root cause and baseline

The visible structured-text path was inverted for editing. A ProseMirror
transaction updated the real document, but the source editor was made
transparent by `.document-flow-editor__content--structured-text-editing`. The
only visible text was the HTML mirror produced by
`StructuredDocumentSpanLayout`.

`FlowEditor.onUpdate` also incremented `layoutRevision` for every
`transaction.docChanged`. That invalidated
`buildMultiDocumentSpanLayoutModel()` for each character, so the character
could not be painted until the structured text was reparsed, measured, and
allocated across the columns.

The baseline reproduction used a three-column page with a scanned reference,
two photos, captions, and page-positioned images. Typing 59 characters
produced 236 additional structured model builds (four builds per input
transaction); the last baseline build was approximately 8.3 ms. An isolation
run after removing only the explicit revision increment still produced 118
builds, because normalized `imageGroups`, typography, and drop-cap objects
changed identity on every shell update. That run accumulated approximately
1.05 seconds of model-build time and 0.86 seconds of structured measurement
time during the burst.

This was composition latency, not autosave latency.

## Final presentation architecture

While a structured body is actively being edited:

- the real `.document-flow-prosemirror` is the immediate visible text and
  caret surface;
- the structured text bands remain mounted as transparent line-box/hit-test
  regions, so existing page-space text-position resolution continues to work;
- the canonical structured image slots, captions, reference layer, and editor
  chrome remain the visual owners of those objects;
- source ProseMirror image NodeViews remain hidden, preventing duplicate
  photos.

The structured text mirror is therefore not painted simultaneously with the
live source text. A normal input transaction is visible through the browser's
ordinary ProseMirror DOM update and does not increment `layoutRevision` while
structured text editing is active.

The structured layout is marked dirty and reconciled once after 500 ms without
a newer authored transaction. It is also flushed when leaving text editing or
selecting a photo. Image/layout transactions and non-editing document changes
continue to reconcile immediately. This keeps canonical column allocation,
span exclusions, drop caps, typography, captions, image geometry, and overflow
behavior intact.

The model now receives signature-stabilized image-group, typography, and
drop-cap inputs. Parent project updates can still occur for every authored
transaction, but equivalent normalized values no longer invalidate the
structured model by object identity alone.

The structured position resolver was also updated for the live surface. It
uses the visible structured band under the pointer and character-level browser
line rectangles to resolve a ProseMirror position, then falls back to the
existing caret resolver. This preserves one-click photo/text handoff while the
source editor is painted above the frozen composition.

## Diagnostics and measured result

The structured layout exposes test/development attributes for:

- input/update count;
- visible-update count and input-to-visible diagnostic time;
- model-build count and duration;
- structured measurement count and duration;
- cumulative build and measurement time.

In Chromium, the focused 59-character regression reported:

- input count: 9 before the typed sentence, 68 after;
- visible-update count: 9 before, 68 after;
- structured model builds: 28 before and 28 after the burst;
- model-build and measurement totals unchanged during the burst;
- last diagnostic input-to-visible marker: 29.8 ms.

After the idle window, one canonical reconciliation build occurred.

The continuous-burst regression typed 89 characters at 55 ms intervals,
approximately five seconds of realistic keyboard input. During the burst:

- 89 new authored input transactions were observed;
- structured model builds remained at 28;
- autosave invocations remained at zero;
- visible updates tracked all 89 inputs;
- the final input-to-visible diagnostic marker was 13.9 ms.

After typing stopped, the deferred structured composition caught up and the
existing 900 ms trailing-edge autosave ran once.

## Photos, references, and handoff behavior

Page-position photos remain in the canonical structured layer while text is
being edited. Their authored x/y geometry is not changed by the live typing
surface, and source image nodes are hidden rather than rendered a second time.
The scanned reference remains in its editor-only layer and is not part of the
live ProseMirror surface or export.

Photo-to-text and text-to-photo interaction remains one-click. A text click
uses its resolved page coordinate to create the requested text selection, and
selecting a photo flushes pending composition before selecting the stable image
ID. The affected secondary-photo, structured text hit-testing, and
reconstruction suites continue to pass.

Exports mount a fresh, non-editable `FlowEditor` from the committed project
snapshot, so export/print use canonical structured composition rather than the
temporary live editing presentation. Persistence continues to use the
ProseMirror body content; the live presentation introduces no authored schema
or geometry changes.

## Desktop runtime

The repository has no automated Tauri/WebKit WebDriver or Playwright WebKit
project. Tauri uses the existing Wry/WebKitGTK shell and the same production
Vite bundle; the production build completed successfully. The available Rust
Tauri test suite passed all 20 tests. A dedicated desktop UI smoke driver is a
remaining tooling limitation, not a browser-only implementation branch.

## Validation

Passed:

- focused live-typing Chromium suite;
- secondary-photo selection, structured text hit-testing, and reconstruction
  Chromium suites (18/18 after the hit-target cleanup);
- full Vitest: 623 tests;
- Vitest coverage: 623 tests;
- TypeScript;
- ESLint;
- production build;
- `npm run validate`;
- recovery Python tests;
- Tauri Rust tests: 20 tests.

The final broad Chromium run exercised the autosave, reference, photo drag,
transform, title, export, save/reopen, and page-switch regressions: 79 of 80
tests passed. The only remaining failure is the pre-existing
`historical-page-49.png` snapshot dimension mismatch (expected 632×816,
received 618×798). An earlier run exposed an intercepting transparent-band
pseudo-element; removing it restored the affected text-entry behavior, and
the focused reconstruction/selection/hit-testing suite passed 18/18. No
historical snapshot was updated.

## Remaining limitations

The live editing surface uses the browser's ordinary CSS-column rendering, so
canonical page-space pagination can move when the deferred reconciliation runs
after a meaningful edit. The full compositor remains synchronous during that
reconciliation and export; this fix removes it from the per-keystroke path but
does not move composition to a worker. The repository still lacks an automated
Tauri/WebKit interaction harness.
