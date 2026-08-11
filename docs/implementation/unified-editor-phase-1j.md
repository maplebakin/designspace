# Unified Editor Phase 1J Implementation Report

## Scope and authority

Phase 1J evaluates whether the current Document text editors expose a reliable
product-level commit boundary. They do not. The implementation therefore uses
PATH B: text observation is explicitly deferred and one discrete page-orientation
metadata boundary is added to the shadow stream.

The Document store and Tiptap remain authoritative for content, dirty state,
autosave, persistence, native history, recovery, export, and assets. The
diagnostic revision remains runtime-only. It is not a canonical project
revision, Document store revision, Tiptap transaction count, native history
step, save token, or undo depth.

## Current text architecture

TitleEditor and FlowEditor each use Tiptap. Their onUpdate callbacks forward
the current JSON to updateTitleContent or updateBodyContent; the Document store
consequently runs updatePage and markDirty for each committed document update.
Body image-group commits use the same page update path. onFocus and onBlur
currently drive focus, selection, and toolbar state only. They are not
application commit events. onTransaction is not used as a semantic boundary.

The current concepts are intentionally distinct:

- A Tiptap transaction is an engine update and can represent typing, paste,
  formatting, flow controls, image attributes, or normalization.
- A text editing session would require a product-defined completion boundary;
  the current code does not record one.
- A native history step is grouped by ProseMirror history rules, including its
  existing 500 ms grouping behavior, but no public group-closed event exists
  in this application.
- A ProjectChange transaction is a normalized observation after a trusted
  product commit. It is not any of the three concepts above.

## Candidate boundary investigation

### Focus-to-blur session

Rejected. Focus and blur are currently UI state. Page switching, editor
destruction, and project close can invoke teardown rather than a meaningful
editing completion, and the current code has no reliable authored-origin or
changed-content checkpoint at blur. Adding one would invent new editor
semantics.

### Native history grouping

Rejected. ProseMirror history identifies undo/redo transactions, but it does
not expose an existing semantic group completion callback to this layer.
Using a timer, key-up, blur, or private history state would turn implementation
timing into product meaning and could misclassify replay.

### Tiptap onUpdate / store update

Rejected. These callbacks run for individual document changes and include
formatting, flow-control attributes, image changes, paste, normalization, and
programmatic updates. Treating them as ProjectChange actions would flood the
coordinator and double-count Phase 1I image lifecycle observations.

### Explicit editor commands

Formatting, alignment, block style, and flow-control commands are discrete,
but they are metadata/style families rather than a trustworthy definition of
ordinary title/body text editing. They remain unobserved.

No arbitrary debounce, idle timeout, new “Done editing” UX, fingerprinted
document history, generic transaction subscriber, or text commit API was
introduced. The report therefore records the required conclusion explicitly:

> TEXT OBSERVATION WAS DEFERRED BECAUSE NO TRUSTWORTHY PRODUCT-LEVEL COMMIT
> BOUNDARY CURRENTLY EXISTS.

## Selected metadata fallback

Page orientation was selected because the existing sidebar control represents a
clear user intent, calls updateDocumentPagePaper and then the synchronous
legacy updatePage command, targets an existing stable page ID, has built-in
equivalence/no-op behavior, and is already covered by persistence tests.
Column count was not selected because Phase 1F already observes it. Margins,
custom dimensions, and other numeric controls can commit on each input event;
orientation is the narrower and less transient boundary.

DocumentEditorShell now reports:

    source: document
    action: modify-page-metadata
    domain: page-structure
    target.kind: page
    target.id: stable Document page ID
    assetEffect: none

The callback first ignores an already-selected orientation, performs the
existing page update, then verifies the current store page has the requested
orientation before notifying. Thus one real orientation change produces one
optional observation and a no-op produces zero. The existing column-count
observation now uses the same narrow reporting helper. No dirty, save,
autosave, history, or persistence call was added.

## History, hydration, and double-count protection

There is no generic text observer, so native undo/redo remains silent and
Tiptap history behavior is unchanged. Flow-image insertion/removal from Phase
1I cannot additionally become modify-structured-text, because the fallback
does not observe body JSON. Structured image geometry, lifecycle, metadata,
group repair, and flow controls likewise remain outside this metadata boundary.

Mounting existing content, setContent, page switching, editor remount,
recovery hydration, export rendering, and teardown do not invoke the orientation
callback. Existing flow-image lifecycle suppression remains unchanged. The
orientation callback is a direct UI commit boundary; React StrictMode does not
register a new listener or duplicate it.

## Save, reopen, and recovery

The existing Document store round-trip persists landscape orientation and its
derived dimensions through serialized project data and reload. The new UI
test confirms one observation for the live command and no observation while
existing content mounts. Diagnostic state does not participate in that
round-trip and resets with a new diagnostic session.

Recovery and hydration remain legacy-owned. No recovery writer or loader was
changed; the recovery and Rust suites pass, and no recovery path calls the new
callback. The fallback has no asset effect and cannot change asset resolution
or pruning.

## Diagnostic coverage

ProjectChangeDiagnosticCoverage now exposes documentPageOrientation: true
alongside the existing documentPageMetadata: true. The model still reports
completeAuthoredCoverage: false, and the unobserved category now explicitly
states that page metadata beyond orientation and column count remains outside
the shadow stream.

Text coverage was not claimed. The diagnostic view still does not contain
editor objects, ProseMirror transactions, DOM nodes, or document snapshots.

## Dirty-source inventory

| Engine | Family | Classification | Shared dirty impact |
|---|---|---|---|
| Document | Add/duplicate/remove/reorder page commands | TRUSTED-OBSERVED | Covered only at normalized page-command boundaries |
| Document | Column count and page orientation | TRUSTED-OBSERVED | Narrow metadata evidence; not complete page metadata |
| Document | Overlay add/remove and pointer/keyboard/inspector geometry | TRUSTED-OBSERVED | Covered boundary only |
| Document | Flow-image add/remove | TRUSTED-OBSERVED | Covered boundary only |
| Document | Active page selection / activePageIndex | NAVIGATION-PERSISTENCE | Must remain separate from authored content |
| Document | Title/body text and text paste | UNOBSERVED-AUTHORED | High-volume, core blocker |
| Document | Bold/italic/underline, alignment, font/block styles, flow controls | UNOBSERVED-AUTHORED | Core editing blocker |
| Document | Margins, custom size, paper preset, suppress flags, languages, drop cap, folios, background, project rename | UNOBSERVED-AUTHORED | Additional dirty sources remain invisible |
| Document | Overlay metadata, flow-image geometry/metadata, captions, groups, references, replacement, asset changes | UNOBSERVED-AUTHORED / AMBIGUOUS | Asset and representation semantics need separate boundaries |
| Document | Open, recovery, setContent, remount, export | LIFECYCLE / NON-AUTHORED | Must remain silent |
| Document | Native editor history replay | HISTORY-OWNED / REPLAY-SUPPRESSED | Must not become fresh authored transactions |
| Canvas | Page commands, object add/remove, committed object geometry | TRUSTED-OBSERVED | Covered boundary only |
| Canvas | Text editing, styles, grouping, drawing/erase, asset operations | UNOBSERVED-AUTHORED | High-volume/core blockers |
| Canvas | Templates, recipes, bulk/full-page restoration | AMBIGUOUS / UNOBSERVED-AUTHORED | Bulk semantics are not normalized |
| Canvas | Selection, zoom, hydration, page switching, export, renderer teardown | LIFECYCLE / NON-AUTHORED | Must remain silent |
| Canvas | Native history restore | HISTORY-OWNED / REPLAY-SUPPRESSED | Not a new authored observation |

One Document text edit can increment the legacy revision on each updatePage; an
imported image can also dirty once for asset insertion and again for content
insertion. One normalized product transaction, where one exists, is
intentionally not required to equal those engine counters.

## Tests and validation

Added:

- document-editor.test.ts: one orientation observation, stable page target,
  legacy revision increment, no-op silence, and mount/hydration silence.
- unified-editor-phase-1j.test.ts: normalized page-metadata diagnostics,
  orientation coverage, and runtime-only revision behavior.

Validation completed:

- Focused Phase 1J/document suites: 2 files, 76 tests passed.
- npm test: 49 files, 488 tests passed.
- npm run test:coverage: 49 files, 488 tests passed; 60.26% statements,
  50.98% branches, 59.29% functions, and 62.42% lines.
- npm run lint, npx tsc --noEmit, npm run build, npm run validate,
  npm run test:recovery (3 tests), and cargo test --manifest-path
  src-tauri/Cargo.toml --lib (20 tests) passed.
- The focused historical page-49 Playwright check still fails only at the
  known unrelated historical-page-49.png snapshot: expected 632x816,
  received 618x798, with a 0.05 pixel-difference ratio. The snapshot was not
  changed. No Phase 1J visual regression was identified.

## Readiness, rollback, and next slice

The implementation is shadow-only. Legacy dirty, autosave, native history,
persistence, recovery, export, and asset ownership remain authoritative. No
schema, IndexedDB layout, portable project format, or migration changed.

Evidence does not support any shared dirty/change ownership. Ordinary Document
text editing and Canvas text, styling, drawing, grouping, and asset actions can
still make the legacy project dirty without a normalized ProjectChange
transaction. Removing this commit removes the optional orientation report and
coverage flag with no data migration or repair.

The exact next slice should be a product/architecture decision on a real
Document text completion contract. If the product does not already provide one,
continue shadow-only coverage with one separately audited discrete metadata
family (for example page language or drop-cap settings) and keep text
explicitly deferred; do not invent debounce or blur semantics. Shared dirty
ownership should not begin.
