# Unified Editor Phase 1L Implementation Report

## Scope and result

Phase 1L audited the existing Canvas Group and Ungroup commands and added one
optional semantic observation at their successful store command boundary.
Fabric's internal child removal, group insertion, reparenting, selection, and
coordinate work remains below the shared product-change seam.

The resulting shadow stream is:

    one successful Group command
      -> group-freeform-objects
      -> one diagnostic revision

    one successful Ungroup command
      -> ungroup-freeform-objects
      -> one diagnostic revision

No ProjectChange action is emitted for the internal Fabric object lifecycle
events. Legacy dirty state, autosave, history, persistence, recovery, export,
selection, and asset authority remain unchanged and legacy-owned. The
diagnostic revision remains runtime-only; it is not a canonical project
revision, Canvas `changeRevision`, history entry, save token, or undo depth.

## Group and Ungroup entry points

The complete current user-facing Canvas command surface was traced:

- `SelectionToolbar` calls `useEditorStore.getState().groupSelectedObjects()`
  or `ungroupSelectedObjects()` from its Group/Ungroup control.
- `useKeyboardShortcuts` maps Cmd/Ctrl+G to Group and Shift+Cmd/Ctrl+G to
  Ungroup.
- No separate Layers-panel, context-menu, or alternate grouping service calls
  the Fabric helpers. The toolbar and keyboard routes therefore converge on
  the same store boundary.
- `clipboardService` constructs copied groups while pasting/duplicating, but
  it does not call the Group command. Copy/duplicate remains a separate,
  currently unobserved authored family and does not produce a Group semantic
  transaction.

Document image grouping is a separate structured-content feature and is not
part of this Canvas phase.

## Fabric implementation discovered

`groupObjects` requires an active `fabric.ActiveSelection` with at least two
objects. It removes the selected root objects inside the existing
`withCanvasObjectMutationSuppressed` scope, constructs a `fabric.Group`, adds
it to the canvas, assigns an ID through the existing `ensureObjectId` path,
selects the group, synchronizes the canvas/layers, and calls the existing
`saveState`.

`ungroupObjects` requires an active Fabric group with at least one child. It
captures the former group ID and child references, removes the group and adds
the children back inside the same suppression scope, restores child
coordinates, clears selection, synchronizes the canvas/layers, and calls the
existing `saveState`.

In the Fabric 7.4 event harness, one two-member Group command generated:

    object:removed  child A
    object:removed  child B
    object:added    group G

One Ungroup generated:

    object:removed  group G
    object:added    child A
    object:added    child B

The existing object lifecycle observer is suppressed for this synchronous
engine churn. No `object:modified` event from the tested Group/Ungroup path is
promoted to a geometry transaction. Selection changes and relative-coordinate
rewrites are transient implementation work.

The legacy command still performs the same Fabric and store work as before.
The only production change is that the helpers return a small local result
after the existing command succeeds; the store then optionally reports it.

## Semantic commit boundary and vocabulary

The semantic callback is invoked after the successful Group/Ungroup helper has
verified its postcondition. It carries only a stable ID:

    type CanvasCommittedMutation =
      | { action: 'group-freeform-objects'; groupId: string }
      | { action: 'ungroup-freeform-objects'; groupId: string }

The engine adapter maps these to:

    source:     canvas
    action:     group-freeform-objects | ungroup-freeform-objects
    domain:     freeform-content
    target:     { kind: 'freeform-group', id: groupId }
    assetEffect: none

`freeform-group` is an engine-neutral target kind. A Fabric `Group`, active
selection, event object, serialized object, transform, or child object is
never placed in the shared transaction. The transaction intentionally carries
no member-ID array: the group target is sufficient for the current diagnostic
contract, and adding a bounded member field would not improve the current
dirty comparison.

This keeps the semantic distinction explicit:

- ONE GROUP COMMAND is a product structure change.
- MANY FABRIC OBJECT MUTATIONS are implementation churn.
- GROUP STRUCTURE CHANGE is the observed domain.
- CHILD GEOMETRY REWRITE is not an independent authored transform.
- A FABRIC GROUP is runtime state.
- A `freeform-group` target is the shared product identity.

## Identity and postconditions

Before grouping, the focused round-trip contains child IDs `shape-a` and
`shape-b`. After grouping it contains a new UUID-backed group ID `G` whose
children retain `shape-a` and `shape-b`. After ungrouping, the root objects
again have `shape-a` and `shape-b`; those IDs are not regenerated.

The existing recursive Fabric serialization includes the group ID and child
IDs. The serializer/hydration test reloads the grouped representation and
verifies both the group and child IDs without emitting any semantic
transaction. No schema field or migration was introduced.

Grouping does not create or delete media references, so both semantic actions
use `assetEffect: none`. Grouping an image with a shape remains the same
freeform-content action; it does not imply asset creation, deletion, or
ownership transfer.

## Success, no-op, and exactly-once rules

Group observation requires an active selection of at least two observable
objects, a group that remains on the current canvas, a stable non-empty group
ID, and a group that passes the existing system-object filter. Ungroup
observation requires a non-empty active group with a stable ID, observable
children, the former group removed from the canvas, and every child restored
as a root object.

There is no transaction for an empty/single/invalid selection, stale target,
empty group, missing ID, or a command that does not meet its postcondition.
The legacy helper is not rolled back when diagnostic eligibility fails; the
legacy operation remains authoritative and the shadow stream conservatively
omits an unprovable observation.

The store reports exactly one semantic result after each successful helper
call. The object lifecycle callbacks remain suppressed during the helper, so
child removal plus group addition cannot produce duplicate lifecycle
transactions. The semantic callback is optional and wrapped in the existing
error-isolation style: if it throws, grouping/ungrouping, dirty state, history,
and persistence still succeed normally.

## Selection, nested groups, and mixed objects

ActiveSelection-to-group and group-to-child selection transitions remain
transient. No selection action was added to the shared vocabulary.

The current Fabric helper permits a group to be grouped with another object;
the focused tests cover a nested group and verify one Group semantic action
for each explicit command. The current helper rejects non-group Ungroup
targets. Mixed image/shape grouping was also exercised and produced one
freeform-content action with no asset effect.

## History, hydration, page switching, and teardown

Canvas history remains the existing `useHistoryStore` path. Undo/redo acquire
the existing sync lock and restore serialized canvas state through the guarded
hydration path. The focused Group and Ungroup replay tests show:

- undo Group does not emit a fresh Ungroup transaction;
- redo Group does not emit a fresh Group transaction;
- undo/redo Ungroup does not emit fresh lifecycle or semantic transactions.

Project hydration, template/project load, recovery hydration, page switching,
renderer initialization, and component/session teardown remain outside the
explicit Group helper. Existing suppression and hydration guards therefore do
not turn reconstructed groups into authored Group commands, and disposal does
not turn removed runtime objects into Ungroup commands. Template, recipe,
full-page restore, and bulk reconstruction semantics remain separate coverage
gaps rather than being inferred from Fabric object shape.

Copy/duplicate uses `clipboardService` and does not invoke
`groupSelectedObjects`; it is not classified as an explicit Group command.
Copy/duplicate remains an unobserved authored family. No new duplication or
template behavior was introduced.

## Save, reopen, and recovery

The grouped serializer round-trip preserves the group ID, child IDs, and
membership. Existing Canvas integration tests continue to verify store,
layer, selection, history, Group, and Ungroup coherence. The new hydration
test loads that serialized result through `loadCanvasFromJsonSafely` and
observes zero Group/Ungroup or child lifecycle callbacks.

Existing save/reopen and recovery paths remain responsible for writing and
loading project data. The diagnostic observer does not participate in those
paths. The diagnostic runtime revision starts fresh on a later session; old
Group/Ungroup transactions are not replayed during reopen or recovery.

## Legacy revision versus product transaction

In the focused direct command harness, after a clean baseline:

| Operation | Fabric lifecycle events | Legacy `changeRevision` | Normalized product transactions |
|---|---:|---:|---:|
| Group two objects | 2 removes + 1 add | +1 | +1 Group |
| Ungroup one group | 1 remove + 2 adds | +1 | +1 Ungroup |

The existing Canvas stage may coalesce persistence scheduling around event
callbacks, but it does not change the semantic rule. These counts are not
required to match in all engine entry points. A diagnostic product action is
not a Canvas store revision and is not intended to become one.

## Diagnostic coverage

`ProjectChangeDiagnosticCoverage` now records:

    canvasGrouping: true
    canvasUngrouping: true
    completeAuthoredCoverage: false

The previous broad `styles and grouping` gap was narrowed to `styles`.
`canvasErase` remains `false`: Phase 1K proved that the current “eraser” is a
PencilBrush path and is a separate product-behavior task, not semantic erasure.
No eraser behavior was changed here.

## Updated dirty-source inventory

| Engine/family | Classification | Current observation and readiness impact |
|---|---|---|
| Canvas object add/remove | TRUSTED-OBSERVED | Stable object lifecycle boundaries; image effects remain conservative. |
| Canvas committed transforms | TRUSTED-OBSERVED | `modify-freeform-geometry` at the committed modified boundary. |
| Canvas freehand drawing | TRUSTED-OBSERVED | A completed persistent Fabric path maps to `add-freeform-object`. |
| Canvas current erase tool | PRODUCT-BEHAVIOR-NOT-IMPLEMENTED / AMBIGUOUS | Current tool creates a PencilBrush path; no semantic erase action is claimed. |
| Canvas Group/Ungroup | TRUSTED-OBSERVED | One explicit command maps to one structural transaction after Phase 1L. |
| Canvas text editing | UNOBSERVED-AUTHORED | High-volume core blocker; native text changes dirty/history without a semantic callback. |
| Canvas styles | UNOBSERVED-AUTHORED | Style controls and object style commits are not normalized. |
| Canvas assets and replacement | UNOBSERVED-AUTHORED / AMBIGUOUS | Existing object lifecycle effects do not establish canonical asset ownership or all asset operations. |
| Canvas copy/duplicate | UNOBSERVED-AUTHORED | Separate product action; not a Group command. |
| Canvas templates/recipes/bulk restoration | AMBIGUOUS / LIFECYCLE-NON-AUTHORED | Reconstruction is not inferred as explicit Group; bulk authored semantics remain separate. |
| Canvas page/project metadata | UNOBSERVED-AUTHORED | Only the currently instrumented page structure boundaries are trusted. |
| Canvas selection, zoom, hydration, page switch, teardown, export | LIFECYCLE/NON-AUTHORED | Must remain transaction-silent. |
| Canvas native undo/redo | HISTORY/REPLAY-OWNED | Existing sync-lock/hydration suppression prevents fresh authored events. |
| Document page structure, orientation, column count | TRUSTED-OBSERVED | Narrow discrete metadata/page boundaries only. |
| Document overlay lifecycle and geometry | TRUSTED-OBSERVED | Existing explicit add/remove/geometry boundaries. |
| Document flow-image lifecycle | TRUSTED-OBSERVED | Existing explicit add/remove boundaries. |
| Document ordinary title/body text | UNOBSERVED-AUTHORED | High-volume/core blocker; Phase 1J found no trustworthy commit boundary. |
| Document formatting, styles, flow controls, captions, references, groups | UNOBSERVED-AUTHORED | Tiptap/store updates are too broad or lack semantic completion. |
| Document broader page settings and metadata | UNOBSERVED-AUTHORED | Beyond the selected orientation/column boundaries. |
| Document asset/replacement operations | AMBIGUOUS / UNOBSERVED-AUTHORED | Asset/reference ownership remains legacy-controlled. |
| Document active-page selection | NAVIGATION-PERSISTENCE | Kept separate from authored content dirty semantics. |
| Document hydration, recovery, setContent, remount, export | LIFECYCLE/NON-AUTHORED | Must remain silent. |

The remaining high-volume/core blockers are ordinary Document text and
formatting, Canvas text and styles, broader asset operations, and templates or
bulk restoration. Therefore ordinary user work can still make a legacy editor
dirty without a normalized ProjectChange transaction.

## Tests and validation

Added `__tests__/unified-editor-phase-1l.test.ts`, covering:

- Group event order and exactly-once semantic observation;
- Ungroup observation and stable child IDs;
- invalid, stale, single-object, and empty-group no-op behavior;
- observer error isolation;
- nested and mixed image/shape groups;
- history replay silence for Group and Ungroup;
- grouped serialization/hydration silence;
- diagnostic revision, target, domain, asset-effect, dirty, and coverage state.

The existing Group/Ungroup integration test remains green. Final validation:

- `npm test`: 51 files, 505 tests passed;
- `npm run test:coverage`: 51 files, 505 tests passed; 60.35% statements,
  51.11% branches, 59.42% functions, 62.51% lines;
- focused Phase 1L suite: 1 file, 8 tests passed;
- `npx tsc --noEmit`: passed;
- `npm run lint`: passed;
- `npm run build`: passed; Vite transformed 2,277 modules. The existing
  Browserslist database freshness notice remains;
- `npm run validate`: passed;
- `npm run test:recovery`: 3 Python recovery tests passed;
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 20 tests passed;
- focused Canvas Fabric and Document reconstruction browser run: 36 tests
  passed. One unrelated project-rename test saw a transient console 404 in
  the combined run; its isolated rerun passed;
- the historical page-49 visual check still reproduces the known unrelated
  failure: expected 632x816, received 618x798, 22,424 differing pixels / 0.05
  ratio. No snapshot was changed.

## Authority, readiness, and rollback

Phase 1L remains shadow-only. The ProjectChangeCoordinator and diagnostic view
observe completed legacy commands; they do not perform grouping, mark or clear
dirty, schedule autosave, write IndexedDB, alter schemas, create history,
change recovery, change export, or own assets. Selection and native history
remain engine-owned.

Evidence still does **not** support global shared dirty/change ownership.
Canvas structural object lifecycle, geometry, drawing, and now Group/Ungroup
are materially more observable, but ordinary Canvas text/styles/assets and
ordinary Document text/formatting remain common invisible dirty sources. The
semantic eraser also remains a separate product task.

The exact next slice should be **Phase 1M: audit one discrete Canvas style
command**, starting with a fill-color commit only if the current control has a
real successful/no-op boundary. If the control produces intermediate writes,
defer it rather than inventing debounce and choose another discrete boundary.
Do not begin shared dirty authority, Canvas text debounce, shared autosave,
shared history, canonical asset ownership, or mixed-page composition.

Rollback is trivial: revert the Phase 1L commit. No project-file migration,
schema change, IndexedDB repair, or data conversion is required.
