# Unified Editor Canvas Coverage Sweep

Status: completed as a bounded shadow-observation evidence batch.

This sweep audits and observes only discrete Canvas commands whose existing
legacy paths expose a completed mutation boundary. Canvas mutation ownership,
dirty state, autosave, history, persistence, recovery, export, and asset
ownership remain legacy-authoritative. The normalized ProjectChange stream and
diagnostic revisions remain shadow data. `completeAuthoredCoverage` remains
`false`.

## Audit result

The following commands have a defensible post-mutation boundary and are now
observed:

| Command family | Existing entry points | Normalized action | Decision |
| --- | --- | --- | --- |
| Visibility | Layers Panel Eye / Hide / Show | `modify-freeform-visibility` | Accepted |
| Relative z-order | Layers Panel Move Up / Move Down; Context Menu Bring Forward / Send Backward | `move-freeform-forward` / `move-freeform-backward` | Accepted for one selected object |
| Absolute z-order | Context Menu and single-selection toolbar Bring to Front / Send to Back | `bring-freeform-to-front` / `send-freeform-to-back` | Accepted for one selected object |
| Layer drag reorder | Layers Panel completed drop | `reorder-freeform-object` | Accepted |
| Selection Lock | Context Menu Lock Selection; Shift-click Layers lock button | `modify-freeform-selection-lock` | Accepted for successful explicit toggles |

The accepted actions all use `source: 'canvas'`,
`domains: ['freeform-content']`, a stable
`{ kind: 'freeform-object', id }` target, and `assetEffect: 'none'`. No
Fabric object, React event, layer object, serialized snapshot, selection, or
raw Fabric event crosses the normalized seam.

## Visibility

The existing Layers Panel path is:

```text
Eye button
  -> object.set('visible', nextVisible)
  -> selection synchronization when hiding the selected object
  -> commitCanvasMutation(render, sync, save, layer sync)
  -> live/store postcondition proof
  -> optional shadow observation
```

The live Fabric object and the synchronized serialized/store object must both
contain the requested `visible` value. The object must have a stable ID, be a
user object rather than editor chrome, and the Canvas must be ready and not
hydrating. Selection clearing caused by hiding a selected object is legacy
selection churn; it does not create another authored transaction.

The command is a toggle, so every valid invocation changes the current boolean.
There is no ordinary same-value visibility setter or synthetic no-op boundary.
A missing, stale, system, non-ready, hydrating, or postcondition-invalid target
produces zero normalized transactions.

Fabric's persisted `visible` property and the existing Canvas serialization
path preserve hide/show through save and reopen. Hydration and layer
projection remain silent.

## Z-order

### Button commands

The Context Menu and single-selection toolbar use the existing clipboard
service functions. The Layers Panel buttons use the existing Fabric calls
directly. The audit confirmed these are distinct legacy routes, but their
resulting single-object intents are the same:

- `bringObjectForward` and Layers Move Up produce
  `move-freeform-forward`.
- `sendObjectBackwards` and Layers Move Down produce
  `move-freeform-backward`.
- `bringObjectToFront` produces `bring-freeform-to-front`.
- `sendObjectToBack` produces `send-freeform-to-back`.

Observation occurs after the existing render, Canvas/store synchronization,
layer synchronization, and `saveState` call. The full user-object order in the
live Canvas and synchronized store must equal the post-mutation order, and the
target must be a stable, observable user object. A relative command at the
front/back boundary, or an absolute command that is already at its requested
boundary, remains a legacy no-op for observation and emits zero transactions.

The four clipboard actions still preserve their existing ActiveSelection
behavior. Multi-selection z-order is deliberately not observed because the
normalized target model is singular and the operation has multiple authored
targets. The legacy mutation, synchronization, save, and rendering behavior
remain unchanged for multi-selection.

### Layer drag reorder

Drag-over only updates panel hover state. A completed drop is the boundary:

```text
drop(sourceId, targetId)
  -> handleReorder
  -> applyLayerOrder
  -> moveObjectTo for the requested user-object order
  -> commitCanvasMutation
  -> exact live/store order proof
  -> one reorder observation for sourceId
```

The action is `reorder-freeform-object`, rather than one of the relative
actions, because a drop expresses an arbitrary completed order intent. Same
source/target, missing, stale, or invalid layer IDs do not mutate or observe.
The test harness proves that a single completed drop produces one transaction
and that intermediate drag-over activity does not.

The serialized Canvas object array preserves the resulting order through save
and reopen. See the history note below for the separate pre-existing
order-history limitation.

## Selection Lock

Selection Lock is separate from the previously trusted Transform Lock. The
existing `toggleObjectLock` command sets or clears all of these properties from
the current `lockMovementX` value:

- `lockMovementX`
- `lockMovementY`
- `lockRotation`
- `lockScalingX`
- `lockScalingY`
- `lockSkewingX`
- `lockSkewingY`
- `hasControls`
- `selectable`

It does not assign `evented`; the observer verifies that the pre-existing
`evented` value survives unchanged. Locking also invokes the existing
`clearSelection` behavior. The live object and synchronized store object must
match the complete resulting state before
`modify-freeform-selection-lock` is emitted.

The two proven ordinary routes converge on the same store command:

```text
Context Menu Lock Selection
  -> selectObjectById(targetId)
  -> toggleObjectLock()

Shift-click Layers lock button
  -> toggleObjectLock(layerId)
```

Each successful toggle changes the boolean selected by the legacy command and
there is no ordinary same-value no-op invocation. Missing, stale, system,
non-ready, hydrating, and postcondition-invalid targets remain silent.

The audit also confirmed a current legacy UI limitation: locking clears the
active selection and makes the object non-selectable. The Context Menu derives
its unlock availability from the active object, so after a Context Menu lock it
shows a disabled `Lock Selection` state rather than a usable unlock command.
The Layers Panel Shift-click route can unlock by ID. This sweep records the
limitation and does not add a UI workaround or change lock ownership.

Selection Lock fields are included in the existing custom Fabric serialization
and survive reopen. History replay restores them through the existing
hydration machinery without producing a new authored observation.

## Theme and other candidate commands classified during the audit

Theme relinking, themed fill, reset-to-default-theme, and global theme
application were inspected but deferred. The existing themed-fill and reset
commands can clear `colorLocked` while changing `fill` and `tokenRole`; their
primary semantics are theme/style ownership rather than a lock command. Global
theme application can recolour many objects and can skip locked objects. A
single-object observer for those paths would misclassify a side effect as a
Color Lock or generic metadata transaction. They belong in a later high-volume
theme/style slice.

Manual fill, the native colour picker, recent/Vision Palette fill, opacity,
stroke, gradients, shadows, corner radius, typography, image adjustments, and
Canvas text remain unobserved. No picker debounce, timing heuristic, generic
Fabric-property listener, or synthetic theme commit was added.

## Commit, postcondition, and failure rules

Every accepted path observes after the existing legacy mutation and its
existing synchronization calls. The observer is optional and uses the existing
error-isolated semantic seam. If it throws, Fabric state, store/layer state,
dirty state, save scheduling, persistence, and history are unaffected.

The accepted postconditions are:

- Visibility: live and store `visible` equal the intended value.
- Single-object z-order: live and store user-object order equal the completed
  order, and the previous order differs for a transaction.
- Layer drag reorder: the completed drop changes and proves the exact requested
  user-object order.
- Selection Lock: all lock/control/selectability fields listed above match the
  intended state and `evented` is unchanged in both live and store objects.

No observation is inferred from rendering, selection changes, layer
synchronization, Fabric lifecycle events, serialization, theme reads, or
property noise. Hydration, project/template/recovery loading, page switching,
history replay, and teardown remain silent.

## Exactly-once evidence

The focused sweep suite proves one diagnostic revision for each successful
explicit command and zero revisions for invalid, boundary, multi-selection,
hydration, replay, and teardown paths. It also proves that the Context Menu and
Layers Shift-click Selection Lock routes produce the same action/domain/target
semantics, and that Layers/Context/toolbar z-order routes produce their shared
single-object action families.

The accepted observation callbacks are called only from the completed legacy
routes:

- `LayersPanel` reports visibility, button z-order, and completed drag reorder
  after `commitCanvasMutation`.
- `clipboardService` reports single-object z-order after its existing save and
  synchronization sequence.
- `toggleObjectLock` reports Selection Lock after its existing save and
  synchronization sequence.

No event-service or renderer lifecycle callback was expanded to infer these
commands.

## Persistence and native history

Visibility, z-order array order, and Selection Lock fields use the existing
Canvas serialization and persistence paths. The sweep required no schema,
migration, or recovery changes. Reopen tests verify the persisted state and
zero authored observations during hydration.

Dirty state and save scheduling remain legacy-owned. The accepted commands
still call the same existing mutation/save paths and leave the legacy editor
dirty in the same way.

Native history behavior is also unchanged:

- Visibility and Selection Lock property changes are represented by the
  existing history diff path. Undo/redo restores them silently.
- The existing diff history compares objects by ID and does not encode array
  order. Consequently, order-only z-order and layer-reorder changes still run
  their legacy dirty/save path and persist through the page serialization path,
  but do not create a native undo snapshot. This is a pre-existing legacy
  behavior discovered by the sweep, not a reason to add shared history or to
  redesign the diff format here.
- Calling legacy undo/redo around an order command produces zero new authored
  z-order observations. No replay event is promoted into the shadow stream.

## Diagnostic coverage

The diagnostic model now adds only these narrow fields:

```ts
canvasVisibility: true;
canvasZOrder: true;
canvasLayerReorder: true;
canvasSelectionLock: true;
```

`completeAuthoredCoverage` remains `false`. The inventory retains separate
gaps for multi-selection/other reorder paths, full-object lock and unsupported
Selection Lock invocation paths, remaining style controls, theme side effects,
Canvas text, Document formatting, and other metadata. No broad
`canvasMetadata` or generic style flag was added.

## Updated Canvas authored-change inventory

### A. Trusted observed

- Canvas geometry mutations from the earlier phases.
- Canvas object add/remove and completed drawing strokes.
- Canvas grouping and ungrouping.
- Shape Border Style.
- Transform Lock/Unlock.
- Theme Color Lock/Unlock as the explicit Layers Panel command only.
- Visibility hide/show from the Layers Panel.
- Single-object relative z-order from Layers Move Up/Down and Context Menu
  Bring Forward/Send Backward.
- Single-object absolute z-order from Context Menu and Selection Toolbar Bring
  to Front/Send to Back.
- Completed single-object Layers drag reorder.
- Successful explicit Selection Lock toggles from Context Menu Lock Selection
  and Shift-click Layers Lock.
- Existing trusted Document overlay/image/geometry/page observations.

### B. Audited and intentionally deferred

- Multi-selection z-order, because one operation has multiple targets while
  the current shadow target is singular.
- Context Menu Selection Unlock after a Context Menu lock, because the current
  legacy selection-clearing/non-selectable behavior makes that UI route
  unreachable without a UX or command redesign.
- Theme-token linking/unlinking, themed fill, reset-to-default-theme, and
  global theme application, because their primary semantics include fill,
  token-role, and broad theme ownership.
- Any additional reorder route that does not expose a completed single-drop or
  completed button boundary.

### C. Still unobserved / high-volume

- Manual Canvas fill colour, native picker intermediate values, recent colours,
  Vision Palette fill, opacity, stroke colour/width, gradients, shadows,
  corner radius, typography, image adjustments, and remaining styles.
- Canvas text editing and text formatting.
- Other Canvas object metadata controls, including full-object/unsupported
  lock variants, duplication/copy semantics, and any future metadata commands.
- Theme side effects and Color Lock mutations performed by themed-fill/reset
  commands.
- Assets, templates/recipes, full-page restoration, and other broad content
  operations.
- Document/Tiptap authored text, formatting, and remaining document style
  changes.

### D. System/replay-only, not authored

- Canvas hydration/reopen, project/template/recovery load, and page switching.
- `sanityCheckCanvas` and other defaulting/normalization of missing fields.
- History undo/redo reconstruction and replay.
- Rendering, selection churn, layer synchronization, serialization reads, and
  theme reads/skips.
- Canvas event-service registration/cleanup and teardown.

## Remaining blockers before Canvas observation is sufficiently complete

The main remaining work is high-volume authored content/style coverage, not
another isolated layer button. Canvas text and high-frequency style paths need
real product transaction boundaries, and Document/Tiptap editing needs an
explicit authored grouping model. Theme ownership, asset references,
multi-target operations, and the legacy order-history limitation also need
separate architectural decisions before shared change ownership can be
considered. The current native colour picker remains unsuitable for semantic
observation until the product exposes an explicit commit boundary.

## Tests and validation

Focused sweep:

- `npx vitest run __tests__/unified-editor-canvas-coverage-sweep.test.ts` — 18
  tests passed.
- The focused suite covers visibility, all accepted z-order routes, completed
  drag reorder, single/multi-selection behavior, Selection Lock convergence,
  stable targets, postconditions, persistence/reopen, dirty state, invalid and
  boundary paths, observer failure, replay/hydration/page teardown silence,
  diagnostic revisions, and deferred coverage gaps.

The full validation commands and results are recorded here after the final
regression run:

- `npm test -- --run` — 55 files, 566 tests passed.
- `npm run test:coverage` — 55 files, 566 tests passed; 61.96% statements,
  53.24% branches, 61.39% functions, 64.04% lines.
- `npx tsc --noEmit` — passed.
- `npm run lint` — passed with zero warnings.
- `npm run build` — passed, including lint, TypeScript, and the Vite
  production build.
- `npm run validate` — passed.
- `npm run test:recovery` — 3 Python tests passed.
- `cargo test --manifest-path src-tauri/Cargo.toml` — 20 Rust library tests
  passed; binary tests and doc-tests passed.
- `DESIGN_SPACE_E2E_PORT=5184 npx playwright test e2e/editor-fabric.spec.ts`
  — 29 Chromium tests passed.
- `DESIGN_SPACE_E2E_PORT=5185 npx playwright test
  e2e/document-reconstruction.spec.ts` — 8 Chromium reconstruction tests
  passed.

The full Vitest run includes the Phase 1M–1O, theme, Canvas, and Document
regression suites. No unrelated visual snapshots were changed. The only
recurring output was the repository's existing stale Browserslist data notice;
it did not fail validation.

No unrelated visual snapshots are to be changed. Any pre-existing failure will
be listed separately from sweep failures.

## Rollback

Revert the completed sweep commit:

```bash
git revert <canvas-coverage-sweep-commit-sha>
```

The revert removes only the shadow vocabulary, postcondition callbacks,
adapter/diagnostic fields, focused tests, and this report. It does not transfer
legacy mutation, dirty, autosave, history, persistence, recovery, or export
ownership. The separately staged `AGENTS.md` is intentionally outside the
commit and must remain staged and byte-for-byte unchanged.

## Readiness verdict

Not ready for shared change ownership. This batch is evidence only. The
normalized transactions are useful for measuring authored coverage, but the
legacy Canvas remains authoritative and the high-volume Canvas/Document gaps
are material.

## Recommended next large work package

The next slice should be **High-volume authored content/style coverage**:

- define trustworthy authored boundaries for Canvas text and remaining
  high-volume Canvas style editing;
- audit Document/Tiptap authored grouping and formatting transactions;
- keep manual colour-picker observation deferred until an explicit product
  commit boundary exists;
- establish cross-editor diagnostic evidence without moving dirty, autosave,
  history, persistence, asset, or recovery ownership.

This should be a bounded architectural work package, not another one-button
micro-phase. No shared ownership change is recommended until that evidence is
complete.
