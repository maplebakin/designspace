# Unified Editor Phase 1N Implementation Report

## Scope and result

Phase 1N audited the existing Canvas **Lock Position / Unlock Position**
command and normalized the trustworthy discrete command that the product
currently exposes through the Context Menu and Layers Panel. The command is
broader than its UI label: it is a persisted Fabric transform-capability lock,
not a position-only lock.

The existing `toggleMovementLock` store action remains authoritative. Its
legacy Fabric mutation, Canvas/store synchronization, layer synchronization,
dirty state, autosave, native history, persistence, recovery, export, and
asset ownership were not moved into the ProjectChangeCoordinator. The new
transaction is shadow-only, and `completeAuthoredCoverage` remains `false`.

The proven chain is:

    one successful Lock/Unlock Position invocation
      -> toggleMovementLock
      -> one completed legacy transform-lock mutation
      -> one modify-freeform-transform-lock observation
      -> one diagnostic authored revision

## Confirmed user-facing entry points and convergence

The complete ordinary route audit found two user-facing routes that invoke the
same store command:

| Route | Existing handler | Store boundary |
|---|---|---|
| Context Menu `Lock Position` / `Unlock Position` | `ContextMenu.handleToggleLock` chooses `selectedObjectId`, falling back to the active Fabric object ID, then calls `toggleMovementLock(targetId)` | `toggleMovementLock` |
| Layers Panel lock button, ordinary click | `LayersPanel.handleToggleMovementLock` calls `toggleMovementLock(layer.id)` when Shift is not held | `toggleMovementLock` |

No other ordinary UI route invoking `toggleMovementLock` was found. The two
routes therefore share one semantic adapter boundary; no route-specific
transaction adapter or UI event observation was added.

The following routes remain deliberately separate:

- Context Menu `Lock Selection` / `Unlock Selection` calls
  `toggleObjectLock()` after selecting the target.
- Shift-click on the Layers Panel lock button calls `toggleObjectLock(id)`.

Those routes can change selection, selectability, eventability, skew locks,
and transform flags. They are not reported as
`modify-freeform-transform-lock` transactions in Phase 1N.

## Full transform-lock audit

`toggleMovementLock` finds the current top-level Canvas object by the supplied
stable ID and computes:

    nextLocked = !object.lockMovementX

It then sets exactly these six Fabric properties:

| Property | Locked result | Unlocked result | Persisted by existing serializer |
|---|---:|---:|---|
| `lockMovementX` | `true` | `false` | yes |
| `lockMovementY` | `true` | `false` | yes |
| `lockRotation` | `true` | `false` | yes |
| `lockScalingX` | `true` | `false` | yes |
| `lockScalingY` | `true` | `false` | yes |
| `hasControls` | `false` | `true` | yes |

It does not change `lockSkewingX`, `lockSkewingY`, `selectable`, `evented`,
color locking, visibility, geometry, or selection state. The existing
`toggleObjectLock` selection-lock path is broader and is intentionally not
normalized here.

The UI term **Position Lock** is therefore confirmed to be narrower than the
actual persisted/runtime behavior. The command also prevents rotation and
scaling and hides transform controls. The normalized product semantic uses
**transform lock** rather than repeating the misleading position-only label.

If the five transform flags are inconsistent before invocation, existing
behavior remains the authority: the next state is derived from
`lockMovementX`, and the five flags plus `hasControls` are canonicalized to the
corresponding locked or unlocked state. `lockSkewingX/Y` remain unchanged.
This behavior is covered by a focused test rather than silently redefined.

## Exact legacy mutation boundary

The unmodified legacy operation is ordered as follows:

1. Find the object by `layerId`.
2. Derive the intended boolean from the pre-mutation `lockMovementX` value.
3. Set the six existing Fabric properties listed above.
4. Call `syncCanvasToStore(canvas)`.
5. Call `requestLayerSync()`.
6. Call `saveState()`.
7. Only then attempt the optional semantic observation.

No render event, Fabric lifecycle event, layer event, selection event, timeout,
debounce, blur, delayed callback, or browser heuristic defines the observation
boundary. The current command does not need a synthetic commit boundary:
the store action itself is the completed discrete user command.

## Normalized vocabulary

The smallest engine-neutral vocabulary added for this command is:

    action:     modify-freeform-transform-lock
    source:     canvas
    domains:    ['freeform-content']
    target:     { kind: 'freeform-object', id: stableObjectId }
    assetEffect: 'none'

The internal Canvas observation carries only the action discriminator and the
stable object ID. The normalized transaction contains no Fabric object,
serialized snapshot, raw Fabric event, layer object, UI label, React event,
selection state, or lock-property map. `modify-freeform-geometry` was not used
because the command changes transform capability, not object geometry, and it
was not classified as style.

## Success, postcondition, and invalid-target rules

The semantic callback is attempted only when all of these checks pass after the
legacy mutation:

- the same object reference is still present on the current Canvas;
- the object has a non-empty stable ID and passes the existing system/editor
  object filter;
- the editor is still `ready` and Canvas hydration is not active;
- the Canvas is not under the existing synchronization/replay lock;
- Fabric `lockMovementX/Y`, `lockRotation`, `lockScalingX/Y`, and `hasControls`
  exactly match the intended next state;
- the synchronized serialized `canvasObjects` entry with that ID matches the
  same six-field postcondition.

The existing `observeSemanticMutation` wrapper additionally requires an
installed observer, a live Canvas, and no scoped mutation suppression. It
catches observer failures so diagnostics cannot change the result of the
legacy command.

Missing IDs, stale IDs, system/editor-only objects, failed postconditions,
hydration, internal synchronization, non-ready teardown state, and replay
therefore produce zero semantic transactions. A valid toggle always changes
`lockMovementX` by definition; there is no ordinary same-value/no-op input in
the existing API. Phase 1N does not manufacture an idempotent API merely for
observation. A second valid invocation is an Unlock (or Lock) command and is
observed separately.

## Exactly-once evidence

The focused suite exercises both UI routes against the same store action and
checks the complete metadata:

| Stage | Result for one valid invocation |
|---|---:|
| Legacy Fabric transform-lock mutation | one |
| Canvas/store serialized lock state | one matching state |
| Layer movement-lock state | one matching state |
| Optional committed Canvas callback | 1 |
| Normalized ProjectChange transaction | 1 |
| Diagnostic authored revision | +1 |
| Asset effect | `none` |

The direct Fabric write does not produce a second semantic observation through
the object event service. Rendering, layer synchronization, controls
visibility, and selection changes are not observation sources. The focused
tests register the existing lifecycle service and verify that it does not add a
second transaction for the direct lock command.

## Serialization, persistence, and reopen

The existing `toSerializableObject` path already includes `hasControls`,
`lockMovementX`, `lockMovementY`, `lockRotation`, and `lockScalingX/Y` in both
its custom property list and explicit serialized result. No schema or
migration change was required.

The focused persistence test proves:

1. an unlocked object is locked through the existing command;
2. the serialized representation contains all six resulting fields;
3. `loadCanvasFromJsonSafely` reopens the object with the same transform-lock
   state;
4. synchronized store state and layer state reflect the lock;
5. hydration/reopen emits zero authored observations; and
6. an Unlock after reopen emits exactly one new transaction.

`lockSkewingX/Y` are serialized by the existing path as well, but because
`toggleMovementLock` does not change them they are not part of this command's
postcondition.

## History, hydration, navigation, and teardown

Canvas history remains native and legacy-owned. The command still calls the
existing `saveState`, and the history snapshot contains the changed transform
lock fields. The focused tests prove:

    Lock   -> one authored transaction
    Undo   -> zero additional authored transactions
    Redo   -> zero additional authored transactions

Undo and redo restore the lock state through the existing sync-lock and
hydration machinery; they do not call `toggleMovementLock` and do not
masquerade as authored Lock/Unlock commands. Direct reopen, page switching,
event-service cleanup, and teardown remain transaction-silent.

## Observer failure isolation

An observer that throws is caught by the existing store observation boundary.
The focused failure test verifies that Fabric lock state, serialized/store
state, layer state, dirty state, autosave status, and history still update as
they did before observation was added. The observer has no authority to roll
back or reject a successful legacy mutation.

## Diagnostic coverage

Coverage now records only the narrow command proven here:

    canvasBorderStyle: true
    canvasTransformLock: true
    completeAuthoredCoverage: false

The overall styles gap remains. The inventory now explicitly retains:

- `remaining Canvas style controls`;
- `Canvas Selection Lock and full-object lock`;
- `other Canvas object metadata controls`;
- `Canvas text/style editing beyond Border Style`; and
- `Document formatting/styles`.

No coverage was claimed for Selection Lock, full-object lock semantics,
visibility, z-order, color lock, copy/duplicate, remaining styles, Canvas text,
assets, templates/recipes, or bulk restoration.

## Updated dirty-source inventory

| Engine/family | Phase 1N classification | Ownership/readiness impact |
|---|---|---|
| Canvas object add/remove, geometry, drawing, grouping/ungrouping, Border Style | TRUSTED-OBSERVED | Existing narrow boundaries; no shared ownership implied. |
| Canvas transform lock (`toggleMovementLock`) | TRUSTED-OBSERVED | One discrete store command, stable ID, proven Fabric/serialized postcondition, shadow-only. |
| Canvas Selection Lock / full-object lock (`toggleObjectLock`) | UNOBSERVED-AUTHORED | Separate broader semantics; intentionally outside Phase 1N. |
| Canvas color lock, visibility, z-order, and other object metadata controls | UNOBSERVED-AUTHORED | Discrete-looking controls still need individual boundary audits. |
| Canvas fill colour and remaining style controls | UNOBSERVED-AUTHORED / DEFERRED | Phase 1M deferred fill colour because native picker changes have no trustworthy one-action boundary. |
| Canvas text/style editing beyond Border Style, assets/replacement, copy/duplicate | UNOBSERVED-AUTHORED / AMBIGUOUS | Core authored sources remain legacy-controlled. |
| Canvas templates, recipes, bulk restoration, page settings, selection, zoom | AMBIGUOUS / LIFECYCLE-NON-AUTHORED | Must not be inferred from transform-lock observation. |
| Canvas hydration, page switching, recovery restoration, native undo/redo, export, teardown | HISTORY/REPLAY/LIFECYCLE/NON-AUTHORED | Existing guards remain authoritative and transaction-silent. |
| Document ordinary text and formatting/styles | UNOBSERVED-AUTHORED | Core blocker remains. |
| Document broader settings, metadata, assets, references, groups, captions, and bulk restore | UNOBSERVED-AUTHORED / AMBIGUOUS | Requires separate semantic boundaries. |

The evidence still does not support shared dirty authority, shared autosave,
shared history, or a shared persistence/recovery owner.

## Tests and validation

Focused Phase 1N coverage is in
`__tests__/unified-editor-phase-1n.test.ts` and includes 15 passing tests for:

- Layers Panel Lock and Unlock;
- Context Menu Lock and Unlock;
- route convergence and exact action/domain/target/asset metadata;
- stable IDs and final Fabric, serialized, store, and layer state;
- legacy dirty/save/history behavior;
- missing, stale, system, no-selection, and failed-postcondition behavior;
- optional observer failure isolation;
- undo/redo replay silence;
- serialization/reopen and post-reopen Unlock;
- page switching and teardown silence;
- inconsistent pre-existing lock state;
- Shift-click and Context Menu Selection Lock exclusion; and
- narrow diagnostic coverage with incomplete authored coverage.

Validation results:

- `npx vitest run __tests__/unified-editor-phase-1n.test.ts`: 15 passed;
- `npm test`: 53 files, 528 tests passed;
- `npm run test:coverage`: 53 files, 528 tests passed; 61.23% statements,
  52.62% branches, 60.35% functions, and 63.36% lines;
- `npx tsc --noEmit`: passed;
- `npm run lint`: passed;
- `npm run build`: passed; Vite transformed 2,277 modules;
- `npm run validate`: passed;
- `npm run test:recovery`: 3 Python tests passed;
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 20 tests passed;
- `npx playwright test e2e/editor-fabric.spec.ts e2e/document-reconstruction.spec.ts`:
  37 Chromium tests passed; and
- no visual snapshots were changed.

The repository emitted its existing invalid local-storage path warning and
stale Browserslist data notice. They were non-failing and unrelated to Phase
1N. No pre-existing validation failure was observed.

## Rollback

Revert the Phase 1N commit to remove the optional transform-lock callback,
action vocabulary, coverage flag, focused tests, and this report. No project
file migration, schema migration, IndexedDB repair, persistence conversion, or
recovery action is required. Legacy Canvas behavior remains the authority after
rollback.

## Readiness verdict and recommended Phase 1O slice

**Readiness verdict: NOT READY for shared change ownership.** Phase 1N is
successful shadow-observation evidence for one discrete Canvas transform-lock
command. Selection Lock, other object metadata, remaining Canvas styles and
text, assets, templates, and ordinary Document text/formatting remain
unobserved or ambiguous. Do not begin shared dirty authority, shared autosave,
shared history, Canvas text debounce, canonical asset ownership, or
persistence/recovery redesign.

The exact recommended Phase 1O slice is: **audit and, only if its existing
Layers Panel boundary is equally trustworthy, normalize Canvas Color Lock
(`toggleColorLock`) as one discrete object-metadata command.** Trace every
current Color Lock entry point, prove its serialized/reopen and replay behavior,
and keep Selection Lock and all other metadata controls outside that slice. If
Color Lock does not have a stable post-mutation boundary, stop at the audit and
report the gap rather than adding timing or generalized Fabric-property
observation.
