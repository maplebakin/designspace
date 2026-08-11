# Unified Editor Phase 1I Implementation Report

## Scope and authority

Phase 1I adds passive shadow observations for explicit Document flow-image
insertion and removal. The Document store and Tiptap remain authoritative for
content, dirty state, autosave, persistence, native history, recovery, export,
and assets. `ProjectChangeCoordinator` receives a normalized observation only
after the existing mutation has committed. The diagnostic revision is runtime
only; it is not a canonical project revision, Tiptap transaction count, store
revision, save token, or undo depth.

## Investigated insertion paths

The supported user insertion routes are:

- DocumentSidebar and DocumentToolbar file inputs;
- image drag/drop through `FlowEditor`;
- image clipboard paste through `ingestImageFromClipboardEvent`; and
- the shared `importImages`/`insertAssetIntoBody` path.

The semantic boundary is `insertAssetIntoBody`, after `insertDocumentImage`
returns success and the current Tiptap document contains exactly one
`documentFlowImage` with the generated stable ID. Every successful file in a
multi-file import emits one observation; failures, cancellation, unavailable
editors, and failed insertion emit none. Partial success is retained because
diagnostics never roll back legacy work. Clipboard ingestion has its existing
duplicate-event guard and converges on the same helper; the asset-service
tests continue to cover file and safe-HTML clipboard ingestion.

Direct `insertDocumentImage` calls used by conversion/layout internals are not
treated as independent user insertion events. Imports currently use
`float-left`, so `documentInlineImage` lifecycle is intentionally not claimed
by this phase.

## Investigated removal paths

Toolbar Delete and native Delete/Backspace with a selected flow-image node now
converge on `commitFlowImageRemoval`. It first confirms one matching node,
performs the existing direct or grouped batch deletion, verifies the node is
absent from the committed Tiptap document, and then reports exactly one
`remove-structured-flow-image`. A missing/stale/already-removed ID, failed
command, or teardown emits none. Group repair remains inside the existing
single content commit and cannot create additional lifecycle observations.

The normalized product shape is:

```text
source: document
action: add-structured-flow-image | remove-structured-flow-image
domain: structured-content
target.kind: structured-image
target.id: stable flow-image ID
assetEffect: retained-reference | cleanup-delegated
```

The renderer adapter uses the mutation's page ID and flow-image ID, never a
DOM node, Tiptap editor, ProseMirror transaction, Document object, URL, or
store reference. `flowImageId` is the persisted DocumentImage `id`; it remains
separate from `assetId`. Add means an existing/newly ingested asset is
referenced. Remove means the reference is removed; it does not claim that
media was physically deleted. Existing `pruneDocumentAssets` behavior remains
legacy-owned and runs during explicit persistence compaction, not diagnostics.

## Conversion, replacement, groups, and history

Phase 1H's flow-to-overlay conversion remains one
`add-structured-overlay`; its source flow deletion is deliberately suppressed
and does not become a flow-image removal. Overlay-to-flow conversion currently
removes the overlay and inserts the flow node through raw internal calls, so
both lifecycle observations remain suppressed rather than falsely describing
one representation change as two product actions. This is deferred until a
dedicated representation-change boundary exists.

Replacing an existing image preserves its flow-image ID and changes asset
reference/attributes; it remains unobserved rather than becoming remove-plus-
add. Grouping, ungrouping, group repair, and image metadata changes remain
unobserved authored families. Native undo/redo is silent because observation
is attached only to explicit import/delete helpers, not generic Tiptap update
events. Native Tiptap/ProseMirror history remains unchanged.

One product action may perform multiple legacy mutations. Insertion can dirty
once for asset insertion and again for body-content insertion; the diagnostic
revision advances once. Store revision numbers therefore need not match
normalized product transaction counts.

## Hydration and lifecycle safety

`setContent(..., { emitUpdate: false })`, project open, library load, recovery
hydration, page switching, editor remount, export rendering, and teardown do
not call either semantic helper. Existing flow-image nodes appearing during
hydration are historical state, not authored additions. The new delete
callback is optional, stored only in the editor's callback ref, and cleaned up
with the existing editor lifecycle. StrictMode tests show no duplicate
callbacks.

## Diagnostic coverage and dirty-source inventory

Coverage now reports `documentFlowImageAdd` and `documentFlowImageRemove` as
trusted capabilities while `completeAuthoredCoverage` remains `false`.

| Engine | Family | Classification | Ownership impact |
|---|---|---|---|
| Document | Page commands, column count, overlay geometry/lifecycle, explicit flow-image import/delete | TRUSTED-OBSERVED | Covered boundary only |
| Document | Active page selection persisted as `activePageIndex` | NAVIGATION-PERSISTENCE | Separate policy required |
| Document | Title/body text, flow-image geometry/wrap/metadata, inline-image lifecycle, captions, groups, references, styles, page settings, folios, replacement, assets, bulk/template restore | UNOBSERVED-AUTHORED | Core blockers |
| Document | Open/recovery hydration and native history replay | LIFECYCLE / HISTORY-OWNED | Must remain silent |
| Canvas | Page mutations, object add/remove, committed geometry | TRUSTED-OBSERVED | Covered boundary only |
| Canvas | Text, styles, groups, drawing/erase, asset operations, templates/recipes/restoration | UNOBSERVED-AUTHORED / AMBIGUOUS | Core blockers |
| Canvas | Selection, zoom, page switching, hydration, export, history replay | LIFECYCLE / HISTORY-OWNED | Not authored change |

Ordinary text editing, styling, flow-image geometry, Canvas drawing, and asset
operations can still dirty the legacy project without a trustworthy
transaction. Evidence therefore still does not support shared dirty/change
ownership.

## Save/reopen, recovery, and assets

Existing Document store save/reopen tests continue to prove portable content and
asset resolution through the existing persistence system. The new tests prove
that inserted flow-image nodes receive exactly one observation, deletion
persists through the existing content path, and reopen/hydration does not
replay lifecycle transactions. Recovery hydration remains transaction-silent;
the observer does not write recovery data. No schema, IndexedDB layout, or
portable project format changed.

## Tests and validation

Added `unified-editor-phase-1i.test.ts` for normalized add/remove actions,
asset-effect domains, coverage, and rejected outcomes. Extended
`document-editor.test.ts` for multi-file insertion, toolbar and node-selection
deletion, StrictMode exactly-once behavior, stale deletion, native history
replay, conversion suppression, hydration, page switching, teardown, and the
legacy-revision-versus-product-count distinction. Existing document asset
tests cover file and safe-HTML clipboard ingestion.

Validation completed as follows:

- `npm test`: 48 files, 485 tests passed.
- Phase 1D–1I focused suites: 97 tests passed; the persistence round-trip
  test also passed independently.
- `npm run test:coverage`: 48 files, 485 tests passed; 60.24% statements,
  50.96% branches, 59.26% functions, and 62.40% lines.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run validate`,
  `npm run test:recovery` (3 tests), and `cargo test --manifest-path
  src-tauri/Cargo.toml --lib` (20 tests) passed.
- The historical Playwright suite passed 5 of 6 tests. Its single failure is
  the known unrelated `historical-page-49.png` mismatch: expected 632x816,
  received 618x798. The snapshot was not changed; the other five historical
  checks passed.

The repository also continues to print existing React `act(...)`, Fabric,
local-storage, and Browserslist warnings; none caused a failure. No new
Phase 1I-specific visual regression was identified.

## Authority, rollback, and next slice

Dirty, autosave, history, persistence, recovery, export, and asset cleanup
remain legacy-owned. Removing this commit removes the optional callbacks and
shadow vocabulary with no data migration or repair. The next smallest slice
should be Phase 1J: a shadow-only Document text semantic commit boundary, using
one existing reliable completion/transaction-group boundary and never one
transaction per keystroke. If inspection cannot prove such a boundary,
explicitly defer text observation rather than synthesizing it, and choose one
discrete page-metadata command instead. Shared dirty/change ownership must not
begin yet.
