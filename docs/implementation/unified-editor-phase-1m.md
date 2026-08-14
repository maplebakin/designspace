# Unified Editor Phase 1M Implementation Report

## Scope and result

Phase 1M audited the existing Canvas fill-colour path and deferred it. The
native colour picker does not expose a trustworthy semantic completion
boundary: every delivered colour change is forwarded immediately into the
legacy Fabric/store/save path. No picker debounce, timeout, blur, pointer-up,
picker-close, or browser-specific commit heuristic was added.

The fallback is the existing discrete Shape **Border Style** select. Its
successful values are observed after the unchanged legacy mutation and its
postconditions are proven:

    one Border Style selection
      -> modify-freeform-style
      -> one diagnostic authored revision

The ProjectChangeCoordinator and diagnostic model remain shadow-only. Fabric
mutation, Canvas/store synchronization, layer synchronization, dirty state,
autosave, native history, persistence, recovery, export, and asset ownership
remain legacy-authoritative. `completeAuthoredCoverage` remains `false`.

## Fill-colour audit

The current shape Fill Color path was traced end to end:

1. `ShapeProperties` renders `ColorPicker` for a selected rect, circle,
   triangle, or polygon.
2. `ColorPicker` listens to the native `input[type="color"]` `onChange` and
   calls its parent immediately. Its recent-colour buttons call the same
   parent immediately.
3. The Shape Fill Color parent calls
   `PropertiesPanel.updateSelectedObject({ fill, tokenRole: null })`.
4. `updateSelectedObject` immediately calls Fabric `set`, `setCoords`,
   `canvas.requestRenderAll`, `syncCanvasToStore`, `requestLayerSync`, and
   `saveState`.
5. Vision Palette selections in the same panel use that same immediate
   `updateSelectedObject` path. Theme Sidebar and Brand Kit palette actions
   also mutate selected-object fill immediately through their own existing
   `setObjectFill`/`commitCanvasMutation` paths.

The Vitest audit dispatched two sequential realistic colour-change
notifications to the existing native input. The legacy `changeRevision`
advanced twice, the legacy mutation path ran twice, and the final Fabric fill
was the second value. There is no existing completed-action callback that
distinguishes intermediate picker values from the final chosen colour. The
same control also has no explicit no-op/commit signal beyond each individual
change event.

Fill colour therefore fails the Phase 1M acceptance rule for a stable
one-human-action/one-committed-change boundary. It remains unobserved and is
included in the remaining Canvas style gap. No fill-colour transaction is
emitted by this phase.

## Chosen command and entry points

The chosen command is the existing **Border Style** select in the Shape
section of `PropertiesPanel`. It is available for the existing shape types:
rect, circle, triangle, and polygon. The select maps:

| User value | Existing Fabric value |
|---|---|
| Solid | `undefined`/`null` effective dash |
| Dashed | `[12, 8]` |
| Dotted | `[2, 6]` |

There are no other user-facing entry points for this freeform shape Border
Style control. Page-border line style is a separate system/editor chrome path;
it is not a user freeform object and is excluded by the existing system-object
filter. Initial object factories, templates, recipes, hydration, and imported
project data are also not authored Border Style commands.

## Legacy mutation boundary and normalized vocabulary

The existing select handler passes a narrow `border-style` commit hint to
`updateSelectedObject`. The legacy mutation remains first:

    selectedObject.set({ strokeDashArray })
    selectedObject.setCoords()
    canvas.requestRenderAll()
    syncCanvasToStore(canvas)
    requestLayerSync()
    saveState()

The observer is attempted only afterward. It requires all of the following:

- the selected object still has a non-empty stable ID;
- the same Fabric object is still present on the Canvas;
- the object remains the selected active object with the same selected ID;
- the effective Fabric Border Style equals the requested value;
- the serialized `canvasObjects` entry has the same effective Border Style;
- the object passes `isCanvasObjectObservationTarget`, so system/editor-only
  chrome is excluded;
- hydration, synchronization suppression, and history replay guards are not
  active.

The smallest shared vocabulary is:

    source:     canvas
    action:     modify-freeform-style
    domains:    ['style']
    target:     { kind: 'freeform-object', id: stableObjectId }
    assetEffect: 'none'

The internal Canvas callback carries the fixed narrow discriminator
`style: 'border-style'`; the normalized transaction does not carry Fabric
objects, serialized snapshots, dash arrays, UI events, picker state, or React
state. No generic arbitrary-property event bus was added.

The store reports this one typed mutation through
`reportCommittedCanvasBorderStyle`. It rechecks active selection, stable
object identity, system-object eligibility, hydration, and the existing sync
lock before invoking the optional observer. Existing observer wrappers catch
diagnostic failures, so the legacy mutation cannot be turned into a failed
style command.

## Success, no-op, and invalid rules

One explicit select change to a different effective value produces one
callback and one normalized committed transaction. An already-effective
value returns before Fabric mutation, synchronization, save, or observation.
No transaction is emitted for missing/no selection, stale selection, missing
object, system/editor-only object, failed postcondition, hydration, internal
synchronization, or replay.

The observer is not inferred from `object:modified`, rendering, layer events,
selection changes, or Fabric lifecycle noise. In the focused harness the
existing object-event service received no style lifecycle transaction for the
direct Fabric `set`; the successful command still produced exactly one
semantic callback. Diagnostic subscriber failures remain isolated by the
existing coordinator and store error boundaries.

## Exactly-once evidence

The focused Phase 1M suite proves the following concrete chain:

| Stage | Result for one Dashed selection |
|---|---:|
| Legacy Fabric style mutation | one `[12, 8]` mutation |
| Serialized/store style state | one matching `[12, 8]` state |
| Optional Canvas semantic callback | 1 |
| Normalized ProjectChange transaction | 1 committed `modify-freeform-style` |
| Diagnostic authored revision | +1 |
| Diagnostic asset effect | `none` |

No extra transaction is produced by history replay, hydration/reopen, page
switching, event-service teardown, selection changes, or system-object paths.
The existing legacy history debounce remains a legacy save mechanism; it is
not used to define or batch the semantic observation boundary.

## History, hydration, replay, and lifecycle behavior

The existing `saveState` call remains in the legacy style path. The focused
tests establish a history snapshot, change Border Style, advance the existing
history save, then undo and redo. The callback count remains one throughout;
undo/redo do not create fresh authored style transactions.

Saved style state is serialized with the existing Fabric serializer and
reopens with the existing guarded `loadCanvasFromJsonSafely` path. Reopen
restores the dash array while producing zero semantic callbacks and zero
Fabric lifecycle observations. Page switching uses the existing guarded page
replacement path and remains transaction-silent. Event-service cleanup and
teardown do not report a style change.

## Diagnostic coverage

`ProjectChangeDiagnosticCoverage` now records only this narrow style command:

    canvasBorderStyle: true
    completeAuthoredCoverage: false

The former broad `styles` category was narrowed to:

- `remaining Canvas style controls`;
- `Canvas text/style editing beyond Border Style`;
- `Document formatting/styles`.

No general Canvas style coverage, fill-colour coverage, Canvas text coverage,
or Document formatting coverage was claimed.

## Dirty, save, reopen, and recovery behavior

The existing style mutation still calls `saveState`, so legacy
`isDirty`/`changeRevision`, history, autosave scheduling, Canvas/store state,
layer synchronization, persistence, and recovery behavior remain in their
previous owners. The optional observer never marks dirty, saves, writes
IndexedDB, changes history, changes recovery data, or owns assets. The
diagnostic revision is runtime-only and resets on a new session/reopen.

## Remaining dirty-source inventory

| Engine/family | Classification after Phase 1M | Readiness impact |
|---|---|---|
| Canvas object add/remove | TRUSTED-OBSERVED | Existing stable lifecycle boundary; image effects remain conservative. |
| Canvas committed geometry | TRUSTED-OBSERVED | Existing modified boundary. |
| Canvas completed drawing | TRUSTED-OBSERVED | Existing persistent path-add boundary. |
| Canvas Group/Ungroup | TRUSTED-OBSERVED | One explicit command per Phase 1L. |
| Canvas Border Style | TRUSTED-OBSERVED | One explicit select command maps to one style transaction. |
| Canvas fill colour and remaining style controls | UNOBSERVED-AUTHORED / DEFERRED | Native picker and other style controls lack a trustworthy shared commit boundary. |
| Canvas text/style editing beyond Border Style | UNOBSERVED-AUTHORED | High-volume/core blocker. |
| Canvas assets/replacement and copy/duplicate | UNOBSERVED-AUTHORED / AMBIGUOUS | Asset ownership and authored grouping semantics remain legacy-controlled. |
| Canvas templates/recipes/bulk restoration | AMBIGUOUS / LIFECYCLE-NON-AUTHORED | Reconstruction is not inferred as authored style work. |
| Canvas page metadata, selection, zoom, hydration, page switch, teardown, export | UNOBSERVED-AUTHORED or LIFECYCLE/NON-AUTHORED | Must not be inferred from style observation. |
| Canvas native undo/redo | HISTORY/REPLAY-OWNED | Existing sync-lock/hydration suppression remains authoritative. |
| Document page/overlay/flow-image boundaries already proven | TRUSTED-OBSERVED | Narrow existing Phase 1B–1L coverage only. |
| Document ordinary text and formatting/styles | UNOBSERVED-AUTHORED | High-volume/core blocker. |
| Document broader settings, metadata, assets, references, groups, and captions | UNOBSERVED-AUTHORED / AMBIGUOUS | Separate semantic boundaries are still required. |
| Document navigation, hydration, recovery, remount, and export | NAVIGATION/LIFECYCLE/NON-AUTHORED | Must remain transaction-silent. |

The product still has ordinary legacy dirty sources without normalized
transactions. The evidence does not support shared dirty or change ownership.

## Tests and validation

Added `__tests__/unified-editor-phase-1m.test.ts` with eight focused tests
covering fill audit/defer, successful Border Style normalization, action/domain
and target metadata, final Fabric/serialized/layer state, legacy dirty/history,
invalid and no-op behavior, observer failure isolation, history replay,
hydration/reopen, page switching/teardown, diagnostic revision, and narrow
coverage. The existing Phase 1E coverage expectation was updated to the new
accurate category wording.

Final relevant validation:

- `npx vitest run __tests__/unified-editor-phase-1m.test.ts`: 8 tests passed;
- `npm test`: 52 files, 513 tests passed;
- `npm run test:coverage`: 52 files, 513 tests passed; 60.94% statements,
  52.12% branches, 60.12% functions, and 63.10% lines;
- `npx tsc --noEmit`: passed;
- `npm run lint`: passed;
- `npm run build`: passed; Vite transformed 2,277 modules;
- `npm run validate`: passed;
- `npm run test:recovery`: 3 Python tests passed;
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 20 tests passed;
- `npx playwright test e2e/editor-fabric.spec.ts e2e/document-reconstruction.spec.ts`:
  37 Chromium tests passed;
- no visual snapshots were changed.

The existing Browserslist freshness notice and Vitest local-storage warning
remain non-failing environment notices. No unrelated validation failure was
observed in this phase.

## Rollback and readiness verdict

Rollback is limited to reverting the Phase 1M commit. It requires no project
file migration, schema migration, IndexedDB repair, persistence conversion,
or recovery action. Removing the change removes the optional Border Style
callback, action vocabulary, coverage flag, test suite, and report; legacy
Canvas behavior remains the authority.

**Readiness verdict: NOT READY for shared change ownership.** This phase is
successful as shadow-observation evidence for one discrete Canvas style
command, but fill colour, Canvas text and remaining styles, assets, templates,
and ordinary Document text/formatting remain unobserved or ambiguous. Do not
begin shared dirty authority, shared autosave, shared history, Canvas text
debounce, canonical asset ownership, or persistence/recovery redesign.

The exact recommended Phase 1N slice is: **audit the existing Canvas
Lock/Unlock Position command only**, tracing its Context Menu and Layers panel
entry points through the shared `toggleMovementLock` store helper. Accept it
only if those discrete clicks converge on one stable-object postcondition with
no-op, replay, hydration, and observer-failure evidence; otherwise defer it
and keep the shadow stream unchanged. Do not revisit fill colour until the
product supplies a real picker commit boundary.
