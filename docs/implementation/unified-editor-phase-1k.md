# Unified Editor Phase 1K Implementation Report

## Scope and result

Phase 1K audited Canvas freehand drawing and erasing against the existing
Fabric event and ProjectChange streams. No new drawing or erase action was
added. A completed drawing stroke is already observed truthfully through the
existing `add-freeform-object` transaction. The current erase tool does not
perform semantic erasure: it creates another regular Fabric `Path`. The
diagnostic model now records drawing coverage explicitly while leaving
semantic eraser coverage false.

All Canvas mutation, dirty, autosave, native history, persistence, recovery,
export, and asset behavior remains legacy-owned. The diagnostic revision is
runtime-only and is not a canonical project revision, Canvas `changeRevision`,
history index, save token, or undo depth.

## Fabric event versus product action

`CanvasStage` enables `isDrawingMode` for both `draw` and `erase`. Both tools
currently instantiate Fabric 7.4 `PencilBrush`. A completed stroke follows:

    pointer movement -> before:path:created -> object:added -> path:created

`PencilBrush` creates one persistent `Path` in `_finalizeAndAddPath`; it does
not create a path for preview movement alone. `canvasEventService` listens to
`object:added`, assigns an ID with `ensureObjectId`, persists through the
existing callback, and emits one stable `add-freeform-object` observation. It
does not listen to `path:created`, so the drawing-specific Fabric event cannot
duplicate the transaction.

The normalized result is:

    source: canvas
    action: add-freeform-object
    domain: freeform-content
    target.kind: freeform-object
    target.id: stable Fabric object ID
    assetEffect: none

The brush/tool is not encoded in the action. A drawn path is still a freeform
object product result.

## Current erase behavior

The erase branch sets `globalCompositeOperation = 'destination-out'` on the
`PencilBrush`, then adds the brush path exactly like drawing. Fabric 7's
`PencilBrush.createPath` does not copy that brush-only property to the new
`Path`; the committed path remains `source-over` with a black stroke. No
existing object is removed, modified, clipped, or replaced. Consequently the
current concrete erase-tool result is also one `add-freeform-object`, not an
`erase-freeform-content` action. The desired semantic eraser remains an
unobserved/ambiguous engine behavior. Adding a gesture-level erase transaction
would be optimistic and would double-count the actual path add, so it was not
implemented. Fixing or redesigning the eraser is outside this shadow phase.

An empty click is not treated as a diagnostic no-op because the current
PencilBrush creates a dot path for that input. A gesture that has not reached
Fabric's path finalization produces no transaction. Missed or cancelled
semantic erasure cannot currently be observed because semantic erasure is not
implemented by this path.

## Suppression and exactly-once behavior

No `path:created`, mouse-move, brush-preview, or gesture timer observer was
added. One completed stroke produces one object lifecycle observation; two
completed strokes produce two observations. Hydration uses
`loadCanvasFromJsonSafely`, which holds the existing hydration guard while
Fabric creates objects. History undo/redo uses the existing sync lock and
hydration path. Internal clear/reset uses
`withCanvasObjectMutationSuppressed`. Page replacement, editor teardown,
renderer disposal, and export therefore do not become authored add/remove
events.

The stable object ID is the only Canvas value crossing the adapter. Fabric
objects, brush instances, event objects, pointer coordinates, and path data do
not enter the coordinator or diagnostic state. Drawing paths have no asset
effect; image-object removal continues to use the existing conservative
Canvas asset semantics.

## Legacy dirty and history relationship

For a draw or current erase-tool path, `object:added` marks the existing
history-dirty flag and schedules persistent synchronization. The existing
`EditorShell` window mouseup consumes that flag and requests `saveState`; the
`CanvasStage` batch keeps the event callback and mouseup request coalesced. The
focused harness records one legacy `changeRevision` increment for this normal
path, while the diagnostic observer records one product transaction. These
counts are intentionally different concepts and are not required to match in
other Canvas entry points or timing paths.

Undo and redo remain native-history operations. Their object replay is behind
the existing sync lock/hydration suppression and creates no fresh authored
ProjectChange transaction. No history grouping, stroke batching, debounce, or
shared undo behavior was introduced.

## Diagnostic coverage

`ProjectChangeDiagnosticCoverage` now exposes:

    canvasDrawing: true
    canvasErase: false
    completeAuthoredCoverage: false

The previous broad “drawing and erase operations” gap was replaced with the
more accurate semantic eraser gap: the current erase tool creates a regular
PencilBrush path. Existing `canvasObjectAdd` coverage remains the mechanism
that observes completed drawing/current erase-tool path results.

## Dirty-source inventory

| Engine | Family | Classification | Shared dirty impact |
|---|---|---|---|
| Canvas | Normal object add/remove and committed transform geometry | TRUSTED-OBSERVED | Covered at the existing object lifecycle/modified boundaries |
| Canvas | Completed freehand drawing | TRUSTED-OBSERVED | One persistent path maps to one `add-freeform-object` |
| Canvas | Current erase tool output | TRUSTED-OBSERVED for path add; AMBIGUOUS for eraser intent | No semantic erasure boundary exists; do not claim erase coverage |
| Canvas | Fabric text editing | UNOBSERVED-AUTHORED | High-volume core blocker |
| Canvas | Styles, grouping/ungrouping, and object-content edits | UNOBSERVED-AUTHORED | Common authored changes remain invisible |
| Canvas | Image/asset operations | UNOBSERVED-AUTHORED / AMBIGUOUS | Asset ownership and cleanup remain engine-owned |
| Canvas | Templates, recipes, and bulk restoration | AMBIGUOUS / UNOBSERVED-AUTHORED | Object lifecycle events do not prove user intent |
| Canvas | Selection, zoom, hydration, page switch, teardown, and export | LIFECYCLE / NON-AUTHORED | Must remain silent |
| Canvas | Undo/redo replay | HISTORY-OWNED / REPLAY-SUPPRESSED | Not a fresh authored action |
| Document | Page commands, overlay lifecycle/geometry, flow-image lifecycle, column count, and orientation | TRUSTED-OBSERVED | Narrow trusted boundaries only |
| Document | Title/body text, formatting, flow controls, captions, references, groups, broader metadata, and assets | UNOBSERVED-AUTHORED / AMBIGUOUS | High-volume Document text remains a core blocker |
| Document | Active page selection | NAVIGATION-PERSISTENCE | Must remain distinct from authored content |
| Document | Hydration, recovery, setContent, remount, and export | LIFECYCLE / NON-AUTHORED | Must remain silent |

Ordinary Canvas text, style, grouping, and asset work, ordinary Document text
and formatting, and the unresolved semantic eraser behavior can still make the
legacy project dirty without a corresponding normalized authored transaction.

## Save, reopen, recovery, and page lifecycle

The focused round-trip serializes a committed path with its stable ID, loads it
through the existing guarded Fabric hydration path, verifies the ID survives,
and observes zero authored transactions during reopen. Suppressed clear and
sync-locked add/remove replay are also silent. Existing Canvas save/reopen and
recovery suites remain unchanged and passing; Phase 1K does not participate in
project persistence or recovery writes.

Switching pages is represented by guarded replacement/hydration, not object
creation/deletion. Teardown only removes listeners and disposes renderer
resources; it does not report removals.

## Tests and validation

Added `unified-editor-phase-1k.test.ts` covering:

- real Fabric draw and current erase-tool event sequences;
- exactly one existing normalized observation per completed stroke;
- stable IDs and absence of Fabric runtime objects in the callback;
- no preview/unfinished-gesture transactions;
- separate-stroke granularity without time batching;
- hydration, page replacement, suppressed teardown, and history silence;
- stable-ID serialization/reopen behavior;
- diagnostic revision and coverage state;
- coalesced legacy dirty/changeRevision behavior.

No new ProjectChangeAction or production mutation callback was required. The
known unrelated historical page-49 visual mismatch remains expected:
632x816 versus 618x798 at the existing 0.05 threshold. It was not changed.

## Readiness, rollback, and next slice

Evidence does not support shared dirty/change ownership. Canvas drawing is now
proven covered, but the current eraser intent is not a real semantic mutation,
and ordinary Canvas text/styles/grouping/assets plus Document text/formatting
remain unobserved. Legacy dirty, autosave, history, persistence, recovery,
export, and asset authority remain unchanged.

The next slice should first be a separately scoped product/engine decision on
the current eraser implementation: establish a real committed erase result
and its suppression/history semantics before adding a diagnostic observation.
If that decision is deferred, the next safe shadow slice is one discrete
Canvas style or grouping command with a proven commit boundary; do not invent
Canvas text debounce or stroke batching. Reverting this Phase 1K commit
requires no migration, schema change, or data repair.
