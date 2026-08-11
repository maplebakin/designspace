# Unified Editor Phase 1H Implementation Report

## Scope and authority

Phase 1H adds read-only shadow observations for the Document overlay lifecycle.
The Document store still performs overlay insertion/removal, dirty marking,
autosave, persistence, and selection cleanup. `ProjectChangeCoordinator` only
receives a normalized observation after a legacy operation succeeds. The
diagnostic revision remains runtime-only and is not a project revision, save
token, schema version, asset owner, or history depth.

## Investigated overlay paths

The current checkout has one runtime `addOverlay` caller:
`DocumentEditorShell.convertSelectedFlowToOverlay`, reached when the user
changes a selected flow image to `front` or `behind`. File, drag/drop, and
clipboard imports first ingest an asset and insert a Tiptap flow/inline image;
they do not create an overlay directly. Store tests and fixtures call
`addOverlay` directly but are not product paths.

The runtime `removeOverlay` callers are:

- the Document shell Delete/Backspace handler;
- the selected-image toolbar delete callback;
- flow-to-overlay conversion internals; and
- overlay-to-flow and span-layout conversion internals.

The first two are explicit user deletion boundaries. The latter two are
representation conversions and are intentionally not lifecycle observations.
Page hydration, project open/recovery, page switching, export rendering, and
component teardown do not call these explicit user boundaries.

## Product boundaries and normalized contract

`addOverlay` and `removeOverlay` now return `boolean` success results. They
reject a missing project/page, a blank or duplicate overlay ID, or a missing
overlay without changing dirty state. Existing callers that ignore the result
continue to work. The result is checked from authoritative post-commit state.

The only current user-visible path that creates an overlay is flow-to-overlay
layout conversion. It reports one `add-structured-overlay` observation after
the overlay exists, with the source flow deletion suppressed. This treats the
conversion as one product lifecycle result and avoids a false
remove-plus-add pair. A future dedicated `change-structured-layout` action can
replace this representation if the product needs that distinction; Phase 1H
does not normalize general flow-image lifecycle.

Explicit Delete/Backspace and toolbar deletion report one
`remove-structured-overlay` observation after successful removal. Conversion
removals report none. The shared shape is:

```text
source: document
domain: structured-content
target.kind: structured-image
target.id: stable overlay ID
action: add-structured-overlay | remove-structured-overlay
assetEffect: retained-reference | cleanup-delegated
```

No Document object, Tiptap editor, DOM node, URL, or store reference crosses
the callback/coordinator boundary. The existing adapter supplies current
project/page IDs and the coordinator adds `asset-reference` when the asset
effect is not `none`.

## Exactly-once, stale, and failure behavior

Observation is attached only to explicit successful shell calls. A successful
overlay removal through either current user input route emits exactly one
transaction, including under React StrictMode. Stale or already-removed IDs
return `false` and emit no transaction. A failed add/cancelled import never
reaches the overlay commit boundary. Diagnostic callback exceptions remain
isolated by the existing notifier; they cannot roll back or interrupt the
legacy mutation.

The flow-to-overlay test proves one add observation and no paired removal.
Overlay-to-flow and span conversion remain silent for both lifecycle actions.
Native Tiptap history and any replayed flow representation changes remain
engine-owned; no shared history transaction was introduced.

## Overlay identity and asset effects

Overlay identity is `DocumentOverlayImage.id`; media identity is its separate
`assetId`. The new target always carries the overlay ID and never equates it
with an asset ID. Add uses `retained-reference`: the current conversion already
has an ingested asset referenced by the flow image, and the overlay adds a
reference to that media. Remove uses `cleanup-delegated`: it removes the
overlay reference but does not claim that media was physically deleted.

`pruneDocumentAssets` runs during explicit `saveProject` and project download
compaction. Autosave writes the current payload without this compaction step.
Phase 1H does not invoke pruning, change asset ownership, or add an asset
store. Save/reopen tests prove that an added overlay resolves its asset and
that existing save-time pruning removes an unreferenced asset after overlay
deletion.

## One product action versus legacy revisions

The normalized transaction count intentionally does not mirror the Document
store revision. Importing a flow image can separately dirty the project for
asset insertion and Tiptap content insertion. Flow-to-overlay conversion can
then dirty once for the Tiptap deletion and once for `addOverlay`. Phase 1H
reports one product-level overlay-add result for that conversion and does not
repair the multiple legacy increments. Explicit overlay removal currently
performs one legacy authored update, while save compaction is a later
persistence concern.

## Lifecycle, hydration, and recovery

The existing Phase 1F/1G lifecycle checkpoints are unchanged. A committed
add/remove increments diagnostic revision once, records `after-authored-commit`,
and is compared with real legacy dirty/save transitions. Save completion retains
the historical diagnostic revision.

Hydrating an existing overlay project, loading a library or portable project,
recovering a project, selecting/restoring an overlay, switching pages, and
unmounting the editor emit zero overlay lifecycle transactions. The callback is
not registered as a store subscription, so rendering teardown cannot look like
project deletion. Recovery and export remain outside the diagnostic observer.

## Diagnostic coverage and dirty-source inventory

Coverage now explicitly reports `documentOverlayAdd` and
`documentOverlayRemove` alongside page structure, Canvas add/remove/geometry,
Document overlay geometry for pointer/keyboard/inspector inputs, and Document
column metadata. `completeAuthoredCoverage` remains `false`.

Current dirty-source classification remains:

| Engine | Family | Classification | Shared-ownership status |
|---|---|---|---|
| Document | Page mutations, column count, overlay geometry, explicit overlay add/remove | TRUSTED-OBSERVED | Covered boundary; not a blocker alone |
| Document | Active page selection persisted as `activePageIndex` | NAVIGATION-PERSISTENCE | Requires separate policy |
| Document | Tiptap title/body and flow-image lifecycle | UNOBSERVED-AUTHORED | Core blocker |
| Document | Overlay metadata, replacement, captions, groups, references, styles, folios, page settings, assets | UNOBSERVED-AUTHORED | Core blocker |
| Document | Open/recovery hydration and native Tiptap replay | LIFECYCLE / HISTORY-OWNED | Not authored observation |
| Canvas | Object add/remove, committed geometry, page mutations | TRUSTED-OBSERVED | Covered boundary; asset ownership remains legacy |
| Canvas | Text, styles, groups, drawing/erase, asset operations, templates/recipes/restoration | UNOBSERVED-AUTHORED / AMBIGUOUS | Core blockers |
| Canvas | Page switch, selection, zoom, hydration, export, replay | LIFECYCLE / HISTORY-OWNED | Not authored observation |

Everyday text editing, styling, flow-image changes, drawing, and asset
operations remain invisible or ambiguous. Evidence therefore still does not
support shared dirty/change ownership.

## Tests and validation

Added or extended:

- overlay store success/no-op results and legacy revision behavior;
- overlay asset save/reopen and save-time pruning behavior;
- explicit keyboard/toolbar deletion and stale deletion suppression;
- flow-to-overlay exactly-once add observation with conversion suppression;
- hydration, page-switch, StrictMode, and teardown silence;
- normalized coordinator add/remove actions and rejected outcome counting; and
- diagnostic coverage assertions.

Validation completed:

- focused Phase 1H/Document suites: 5 files, 96 tests passed;
- full Vitest: 47 files, 478 tests passed;
- coverage: 59.97% statements, 50.77% branches, 59.00% functions, 62.11% lines;
- TypeScript and ESLint: passed;
- production build: passed;
- recovery tools: 3 tests passed;
- Rust/Tauri: 20 tests passed, with zero binary/doc-test failures; and
- browser E2E: 51 passed, 1 failed.

The single browser failure is the known unrelated historical page-49 visual
snapshot mismatch: 618x798 rendered versus a 632x816 baseline. It reproduced
in the full run and was not changed or updated by Phase 1H. Browserslist also
reports its existing stale caniuse-lite warning.

## Authority, rollback, and next slice

Dirty, autosave, history, persistence, recovery, export, and asset cleanup
remain legacy-owned. No schema, IndexedDB layout, portable project format, or
recovery behavior changed. Removing this focused commit restores the prior
optional callback behavior and store void-return API; no migration or data
repair is required.

Evidence does not support beginning shared dirty/change ownership. The exact
next slice should be a shadow-only Document flow-image/content transaction
boundary, beginning with one reliable committed flow-image insertion/removal
source and its native history/recovery suppression rules. Do not begin shared
dirty, autosave, history, canonical asset ownership, or mixed-page authority.
