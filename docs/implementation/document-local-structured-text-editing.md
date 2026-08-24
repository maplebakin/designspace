# Local structured text editing

## Why the previous edit presentation was insufficient

The WebKitGTK typing fix deliberately changed the live ProseMirror surface to
`column-count: 1`. That was necessary because a multicolumn
`contenteditable` made every native text mutation lay out the whole body and
produced the desktop latency regression measured in the preceding fix. It did
keep typing responsive, but it also made a reconstructed three-column page
temporarily look like one wide article. The user lost the spatial relationship
between columns, photographs, captions, and the reference scan precisely while
editing.

Restoring multicolumn editing would reintroduce the measured WebKit failure.
The change in this commit keeps the source editor single-column and changes
only which part of it is painted.

## Final presentation architecture

There is still one document authority: the mounted ProseMirror editor. It owns
the document, browser caret, selection, input, and undo/redo history. No second
text model is created and no editor-only overlay is persisted.

While structured body text is active:

1. The canonical `StructuredDocumentSpanLayout` remains visible and frozen.
   Its columns, non-active paragraphs, images, captions, and reference layer
   retain their page-space geometry.
2. The current ProseMirror selection is converted into a transient
   `StructuredTextEditTarget`. It records the current top-level block range and
   block indexes; it is refreshed when the selection crosses a block or the
   document gains/removes a block.
3. Only the matching canonical block fragment is masked with transparent text.
   Neighboring canonical text remains painted, so the page still visibly has
   three columns.
4. The real ProseMirror DOM remains mounted in its measured, cheap
   `column-count: 1` mode. Its non-active direct children are hidden, while the
   active child is exposed with an editor-owned stylesheet and positioned over
   the canonical block rectangle.

The stylesheet is installed outside the ProseMirror DOM and addresses the
active child by its current `:nth-child()` index. This is intentional. An early
implementation wrote temporary attributes and inline styles directly onto
ProseMirror-managed children; the editor observed those mutations and entered
an expensive DOM reconciliation loop. The final implementation performs no
managed-node mutation during ordinary typing.

The canonical layer remains above the source layer. Transparent text on the
active canonical block allows the real caret/text to show through, while the
canonical layer continues to own photographs, captions, and editor chrome.
The source root remains `column-count: 1`; there is no multicolumn
`contenteditable` in the final path.

## Block geometry and zoom

The canonical block’s rendered rectangle is the geometry source. The active
source child is positioned in the source editor’s layout coordinate space using
the difference between the canonical and source rectangles, divided by the
source page scale. The page’s existing zoom transform then applies once to the
result; pointer or CSS coordinates are not scaled a second time.

The browser regression measured the active source block against its canonical
counterpart at fit-page zoom. Left, top, and width stayed within 3 CSS pixels,
and the three physical column rectangles remained unchanged while text was
typed. The same local stylesheet is recomputed when the page zoom changes.

## Editing behavior

Clicking text still uses the coordinate-based handoff introduced by the photo ↔
text fix: the resolver supplies the exact ProseMirror position, one
`TextSelection` is dispatched, and the active block is derived from that live
selection. Clicking a different paragraph changes the target and moves the
source child to the new canonical column without switching the whole page to a
wide text presentation.

Enter and ordinary typing remain native ProseMirror transactions. A
transaction-triggered animation-frame sync notices a changed direct-child
count or active block index and exposes the new paragraph without rebuilding
the structured model per character. During the short editing interval the new
paragraph can overlap frozen downstream content; leaving text editing or an
operation that requires canonical composition reconciles the structured page
once. Multi-block selections expose the selected direct children as one local
editing region, still without enabling CSS multicolumn editing.

Clicking a photo continues to flush/reconcile the pending structured text
presentation, restore canonical text ownership, and select the stable photo ID
in one gesture. Photo geometry is not rewritten merely because the local text
surface is shown or removed. The reference remains behind the authored page
and is not included in export.

## Performance evidence

The bde21 desktop benchmark measured the structured live typing path at p50/p95/
max `5/8/14 ms` input-to-next-frame, with zero recurring long tasks and zero
structured model builds during the typing burst. The new local presentation
preserves the same architecture: the source remains single-column, ordinary
typing changes only ProseMirror’s live DOM, and canonical model composition is
not a per-character operation.

In Chromium, the passing local-overlay regression typed 59 characters with
`modelBuildsDuringBurst = 0`, `lifecycleNotificationsDuringBurst = 0`, and an
observed final input-to-visible value of 10.2 ms. The five-second regression
typed 89 characters; model-build count stayed unchanged during the burst and
autosave remained at zero until the idle boundary. The local geometry test
also confirmed that columns and photo rectangles did not move during typing.

An actual Tauri/WebKitGTK smoke run was repeated with the development typing
diagnostics enabled. The clean direct three-column body route (without a
structured span fixture) reported p50/p95/max `6/15/44 ms` and zero long tasks.
The previously verified bde21 structured-page run reported `5/8/14 ms`.
The local overlay’s browser assertions pass, but a separate automated Tauri
run with a fully prepared span/photo fixture was not completed in this pass;
therefore no unverified WebKit number is claimed for the new overlay itself.
This is a remaining validation limitation rather than a relaxation of the
single-column requirement.

## Persistence, autosave, and export

The local presentation is transient. ProseMirror remains the source for the
body JSON, authored ProjectChange revisions remain exact, the live draft flush
boundaries remain unchanged, and the 900 ms trailing-edge autosave still
serializes the latest draft. Manual Save, page switching, recovery, export,
and photo selection continue to reconcile pending text before operations that
need canonical page state.

The local stylesheet, active-block mask, caret, and source editor are
editor-only. Export uses the canonical document representation, so the active
editing overlay cannot add duplicate text, placeholder spacing, or editor
chrome to PNG/PDF output.

## Validation

Passed:

- `document-editor.test.ts`: 79/79;
- structured typing and hit-testing Chromium suite: 5/5;
- autosave typing Chromium suite: 4/4;
- reconstruction, reference, page-space, selection, transform, and span
  preservation Chromium suite: 22/22;
- `git diff --check`, ESLint, TypeScript, and production build on the current
  implementation;
- actual Tauri/WebKitGTK development diagnostics smoke run.

The full Chromium suite completed 82/83. The one failure is the pre-existing
`historical-page-49.png` snapshot size mismatch (expected 632×816, received
618×798); no historical visual snapshot was regenerated or changed.

## Remaining limitations

The active block is intentionally allowed to grow locally while surrounding
canonical content stays frozen. A large edit can temporarily overlap a later
frozen block until reconciliation. New paragraphs and drop-cap blocks retain
the normal ProseMirror editing semantics, but specialized drop-cap visual
editing is not independently redesigned here. A production automated WebKit
benchmark for the fully prepared local-overlay fixture remains desirable; the
available desktop smoke route was verified on the same single-column source
path and a direct three-column document, but not the complete span/photo
fixture.
