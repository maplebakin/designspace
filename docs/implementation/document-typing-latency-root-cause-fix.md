| Variant | Chromium input → next frame (p50 / p95 / max ms) | Tauri/WebKitGTK input → next frame (p50 / p95 / max ms) | Findings |
| --- | ---: | ---: | --- |
| A — normal production behavior | 2.2 / 3.9 / 8.8 | 9 / 206 / 307 | Three-column live contenteditable; desktop showed multi-second mutation tails and repeated structured builds. |
| B — lifecycle presentation notifications suppressed | 2.2 / 9.4 / 11.0 | 3 / 11 / 13* | React bridge fan-out disappeared; typing latency did not materially change. |
| C — live CSS columns disabled | 2.1 / 6.4 / 9.7 | 4 / 5 / 7 | Desktop mutation tail fell from about 1.4–2.6 s to about 0.56 s; this isolated WebKit multicolumn layout as the dominant cause. |
| D — B + C | 2.1 / 9.8 / 11.7 | — | Chromium confirmed the effects were additive but small after CSS columns were removed. |
| E — toolbar format observation disabled | 2.2 / 3.9 / 13.0 | — | Chromium showed no material improvement; desktop format reads were only about 3 ms total over the accepted burst. |
| F — reference/photos/chrome hidden | 2.1 / 3.8 / 5.9 | — | Chromium showed no material improvement; authored visual layers were not the primary typing blocker. |
| Final production fix | 2.1 / 10.6 / 60.0 | 5 / 8 / 14 | Live structured editing uses one flow column, the canonical compositor is frozen, and lifecycle UI is presentation-coalesced. |

\* The Tauri lifecycle control used the same editor lifecycle on a simpler document because the desktop control route was run before the structured-page WebKit reproduction was stabilized. The structured desktop reproduction and the direct CSS-column control were run on the same two-photo, three-column page.

# Document typing latency root-cause fix

## Root cause

There were two separate costs.

First, the lifecycle authority published its complete snapshot for every
authored revision. That woke the unified React bridge even when the only field
that changed was the internal authored watermark. This was real state fan-out,
but it was not the remaining desktop typing stall: Chromium’s lifecycle
suppression experiment removed the per-character bridge/session renders without
materially changing input-to-frame latency.

The decisive failure was WebKitGTK’s handling of the live ProseMirror
contenteditable. While a structured page was being edited, the visible source
editor still had `column-count: 3`, `column-gap`, and `column-fill: auto`.
Each native text mutation caused WebKit to lay out the full multicolumn
contenteditable. The structured model was already frozen, but WebKit still
queued native input behind the multicolumn layout. The clean Tauri reproduction
accepted only 10–14 characters during a several-second burst and showed
input-to-mutation tails around 1.4–2.6 seconds.

The first transaction also had a focus-state race: WebKit could deliver a text
transaction before React had committed `editingStructuredText`. The transaction
selection itself is now treated as authoritative, so that first character cannot
fall through to synchronous structured recomposition.

## Final architecture

During structured text editing there is one visible text owner: the actual
ProseMirror editor. It remains backed by the canonical ProseMirror document and
browser caret; no second persisted text model is introduced. The canonical
structured page remains mounted for page context, photos, captions, reference
alignment, and hit testing, but its text is transparent and its model is not
rebuilt for ordinary keystrokes.

The live ProseMirror surface switches to a single flow column only for the
active editing presentation. This is the measured WebKit-safe overlay behavior.
The page temporarily shows the editable body as one continuous flow while the
user types; the canonical columns are restored when text editing ends. A photo
click, blur, or another operation requiring canonical composition reconciles the
dirty structured layout exactly once.

An idle reconciliation timer was removed. In WebKit, a timer can fire between
physical keystrokes when one layout turn is already long, recreating the same
input backlog. The layout remains dirty in a ref and is reconciled at explicit
handoff/flush boundaries.

## Lifecycle fan-out

`ProjectLifecycleAuthority` still tracks exact authored and persisted revisions,
save watermarks, in-flight saves, and autosave scheduling synchronously. Exact
listeners remain available to commands and diagnostics.

The React bridge now subscribes to a presentation snapshot containing only
fields that affect shared chrome: dirty state, save status, pending autosave,
capabilities, session identity, and autosave diagnostics. A dirty-to-dirty
revision increment does not notify React. The exact authored revision remains
available without making the shared chrome render per character.

The authority test preserves 80 authored revisions while producing one dirty
presentation notification for the burst. Chromium’s structured regression
observed zero lifecycle presentation notifications during the measured burst
and two bridge renders for setup/handoff rather than one per character.

## Measurements and secondary contributors

The Chromium isolation run reported approximately:

- normal: 90 lifecycle subscriber/UI notifications and 180 bridge/session
  renders in the diagnostic burst;
- lifecycle suppression: zero lifecycle notifications and zero bridge/session
  renders during the burst, with similar input-to-frame latency;
- toolbar and visual-layer controls: no material latency change;
- structured model builds: zero during the final typing burst;
- toolbar reads: still one observation per authored transaction, but their
  measured time was small and they were not the desktop bottleneck.

The final Chromium performance suite typed 59 characters with zero structured
model builds during the burst, zero lifecycle presentation notifications, and
an observed last input-to-visible update of about 10.6 ms in the passing run.
The five-second regression typed 89 characters with no model rebuild during
the burst and no autosave before the idle boundary.

The actual desktop route used the Tauri application with WebKitGTK 4.1
(WebKitGTK 2.50.4), a three-column page with two positioned photos, and real
XTest keyboard/pointer input. After the fix, the accepted desktop burst had
input-to-next-frame p50 5 ms, p95 8 ms, max 14 ms; long-task counters stayed at
zero; the structured model build count stayed at one after entering the live
surface; and the lifecycle presentation notification count stayed at one for
the dirty transition rather than increasing per character. The same desktop
session’s input-to-mutation p50/p95/max was 172/189/532 ms, which is still a
WebKit mutation-observer tail but no longer the visible paint path.

The Tauri smoke route also reopened the saved raster-reference document and
showed the scan visibly painted behind the editable page. The reference layer
remained editor-only.

## Persistence and safety

- ProjectChange remains authored and revision-accurate per ProseMirror
  transaction.
- The existing 900 ms trailing-edge autosave remains unchanged.
- The live draft is flushed before autosave serialization, manual Save, page
  switching, export, and recovery boundaries.
- Save watermark handling still prevents an older in-flight save from marking
  newer typing clean.
- Clicking a photo leaves text editing, reconciles the pending structured model,
  and preserves photo geometry.
- The structured page-position photos, captions, and reference remain owned by
  the canonical page layers and do not enter the live text surface.

## Validation

Passed during this change:

- focused lifecycle authority tests: 14/14;
- full Vitest: 59 files, 627 tests;
- coverage: 59 files, 627 tests;
- relevant Document Chromium suite: 39/39;
- TypeScript, ESLint, production build, and `npm run validate`;
- recovery tests: 3/3;
- Rust/Tauri tests: 20/20;
- actual Tauri/WebKitGTK development smoke and diagnostics route.

The full Chromium suite completed 81/82 without updating snapshots. The one
failure is the existing unrelated `historical-page-49.png` visual snapshot
(expected 632×816, received 618×798); no snapshot was regenerated. Unrelated
historical visual snapshots are not modified.

## Remaining limitations

While a structured text region is active, the temporary live editing
presentation is a single flow column rather than a fully re-typeset three-column
page. This is intentional: it keeps the caret and typed characters responsive
in WebKit. Canonical structured columns and all authored geometry return when
editing ends or an explicit page operation requires them.

The desktop diagnostic route currently uses XTest input and reports both
input-to-next-frame and input-to-mutation so future WebKit regressions can be
distinguished from visible paint latency.
