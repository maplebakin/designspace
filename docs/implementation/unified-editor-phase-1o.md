# Unified Editor Phase 1O — Canvas Theme Color Lock Observation

Status: completed as a shadow-observation evidence slice.

Phase 1O audits and observes only the existing explicit Canvas `Lock Color` / `Unlock Color` command. Legacy Canvas mutation, dirty state, autosave, history, serialization, persistence, recovery, export, and theme ownership remain authoritative. `completeAuthoredCoverage` remains `false`.

## Audit result

The user-facing `Lock Color` label is broader than the persisted behavior. `colorLocked` is a theme-application guard:

- `true` causes `applyThemeToCanvas` to skip the object, so global theme application does not replace its current fill or stroke-derived colour;
- it does not prevent ordinary manual fill editing;
- it does not itself clear or change `tokenRole`;
- it is serialized as a custom Fabric property and survives reopen.

The audited store boundary is:

```text
Layers Panel droplet
  -> toggleColorLock(layerId)
  -> direct colorLocked toggle
  -> syncCanvasToStore + requestLayerSync + saveState
  -> live/store postcondition proof
  -> optional shadow observation
```

`toggleColorLock` negates the current value, so every valid invocation changes the boolean. There is no ordinary same-value no-op case and no setter or synthetic commit boundary was added.

## Semantic answers

1. `colorLocked: true` does not prevent ordinary manual colour editing. The `PropertiesPanel` `updateSelectedObject` path and the Theme Sidebar manual/recent/palette fill paths update `fill` and clear `tokenRole` while leaving `colorLocked` unchanged. The store-level `setObjectFill` path was exercised directly in the focused test.
2. `colorLocked: true` prevents the existing global theme application path from recolouring the object. Theme application reads the flag and skips the object; it does not emit a Color Lock observation.
3. An explicit Lock Color command preserves the existing `tokenRole`. A skipped global theme application also leaves it unchanged.
4. Unlocking permits later theme application to use the retained `tokenRole` again. This does not apply after a manual fill has cleared the role.
5. Existing-object commands that intentionally clear the flag include `applyThemedFillToObject`, reached by `setObjectThemedFill`, and `resetObjectToDefaultTheme`, reached by `resetObjectToDefaultTheme`. Both set their primary theme meaning and `colorLocked: false` together.
6. No other current production command was found that sets an existing object to `colorLocked: true`. `toggleColorLock` is the explicit authoring path. The `setColorLocked` type helper has no production callers.
7. `sanityCheckCanvas` initializes a missing or nullish `colorLocked` to `false`. This is system normalization, not authored intent. The Fabric reviver also defaults a missing serialized value to `false`.
8. `colorLocked` is included in `CUSTOM_PROPS` and explicitly returned by `toSerializableObject`; serialization and reopen preserve both `true` and `false`.

Other reads and initialization paths include layer projection, Fabric type declarations, clipboard custom-property copying, object/factory defaults, recipe generation, and image replacement. These do not define an explicit Color Lock command. `resetAllThemeLinks` changes `tokenRole` only and leaves `colorLocked` unchanged.

## Scope and entry points

The only proven user-facing route for this command is:

```text
Layers Panel droplet button
  -> handleToggleColorLock(layer.id)
  -> toggleColorLock(layerId)
```

The Context Menu has Position Lock and Selection Lock, but no Color Lock item. No second user-facing caller of `toggleColorLock` was found. A `data-testid` was added to the existing droplet button solely to make the established route directly testable; no control behavior or label was redesigned.

Selection Lock remains separate. Shift-click on the Layers Panel Position Lock button calls `toggleObjectLock`; Context Menu Selection Lock calls the same separate path. Neither emits the Phase 1O action.

## Normalized vocabulary

The trusted shadow transaction is:

```ts
{
  action: 'modify-freeform-theme-color-lock',
  source: 'canvas',
  domains: ['style'],
  target: { kind: 'freeform-object', id: stableObjectId },
  assetEffect: 'none',
}
```

The action is deliberately narrower than `modify-freeform-color`, `modify-freeform-fill`, or a generic lock action. It describes protection from theme recolouring without claiming that manual colour edits are blocked. The transaction contains no Fabric object, UI event, layer object, selection state, serialized snapshot, or picker state.

## Commit and postcondition rules

The legacy toggle remains unchanged in ownership and order. Phase 1O captures the intended next boolean before the direct assignment, then waits until the existing Canvas/store synchronization, layer synchronization request, and `saveState` call have run.

Observation is emitted only when all of the following are true:

- the Canvas still contains the same object instance;
- the object has a non-empty stable ID and is not an editor/system target;
- the Canvas is ready and not hydrating;
- the live Fabric object has `object.colorLocked === intendedNextState`;
- the serialized `canvasObjects` entry with the same ID has the same value.

Missing IDs, stale objects, absent Canvas, system/editor-only objects, non-ready lifecycle states, hydration, and failed postconditions produce zero semantic transactions. The successful legacy mutation is never rolled back because observation is unavailable or throws.

Because `toggleColorLock` is a toggle, the tested no-op rule is that there is no ordinary valid same-value invocation: two valid toggles produce two state changes and two observations. Internal defaulting, theme reads, layer projection, rendering, and serialization do not enter the authored seam.

## Exactly-once and failure isolation

For both Lock and Unlock, the focused suite proves:

```text
one explicit Layers Panel command
  -> one legacy boolean change
  -> one committed semantic callback
  -> one normalized transaction
  -> one diagnostic revision
```

The callback is invoked directly after the postcondition proof. Fabric lifecycle events, layer synchronization, selection, rendering, theme application, hydration, and history replay are not used to infer Color Lock transactions. The optional observer is guarded by the existing failure-isolation seam. A throwing observer leaves Fabric state, store state, layer state, dirty state, and history intact.

## Theme behavior

The behavioral tests use a stable-ID object with `tokenRole: 'brand.primary.value'`:

1. Locking changes `false` to `true` and emits one transaction.
2. Applying a different theme skips the locked object, leaves its current fill and `tokenRole` unchanged, and emits no Color Lock transaction.
3. Unlocking changes `true` to `false` and emits one transaction.
4. Applying a later theme recolours the object through its retained token role.

Manual fill while locked remains allowed. It updates the fill, clears `tokenRole`, leaves `colorLocked: true`, and emits no Color Lock transaction. After that manual edit, unlocking does not restore theme linkage because the legacy manual-fill path has already cleared the role. This behavior is characterized and preserved; the Properties Panel and picker paths were not redesigned or observed in Phase 1O.

The explicit themed-fill and reset-to-default commands clear `colorLocked` as part of their own primary theme operation. They remain outside Phase 1O and do not emit `modify-freeform-theme-color-lock`. Global theme application merely reading/skipping a locked object also remains outside the command.

## Serialization, hydration, and history

The tests cover:

- Lock Color, serialize, reopen, and verify `colorLocked: true` and the retained token role;
- Unlock Color after reopen, serialize, reopen again, and verify `colorLocked: false`;
- zero authored observations during `loadCanvasFromJsonSafely` and store synchronization;
- `sanityCheckCanvas` defaulting a missing property to `false` without a transaction;
- history undo and redo restoring lock state through legacy replay without adding authored Color Lock revisions;
- page switching, Canvas event-service cleanup, and teardown readiness remaining silent.

No schema or persistence migration was required. Legacy dirty/save behavior remains authoritative: a valid toggle still marks the editor dirty, increments the legacy change revision once, schedules the existing save behavior, and records the existing history snapshot.

## Diagnostic coverage

Added:

```ts
canvasThemeColorLock: true
```

Kept `completeAuthoredCoverage: false`. The unobserved inventory now explicitly distinguishes:

- Canvas manual fill colour, opacity, and other colour controls;
- Canvas theme-token linking, unlinking, reset, and global theme application;
- Color Lock side effects performed by other commands;
- Canvas Selection Lock/full-object lock and other Canvas metadata;
- remaining Canvas styles and Canvas text/style editing.

The trusted field covers only the explicit Layers Panel toggle. It does not claim coverage for manual fill, token linking, reset, global theme application, Vision Palette application, or any other command that may happen to clear `colorLocked`.

## Tests and validation

Focused Phase 1O:

- `npx vitest run __tests__/unified-editor-phase-1o.test.ts` — 20 passed.
- Covers Lock/Unlock metadata, stable ID, final Fabric/store/layer state, dirty/history, invalid/system targets, failed postcondition, observer failure, serialization/reopen, history replay, hydration, page switching/teardown, diagnostic revisions, theme skip/resume, manual editing, excluded theme commands, sanity normalization, Selection Lock separation, and narrow coverage.

Regression validation:

- `npm test` — 54 files, 548 tests passed.
- `npm run test:coverage` — 54 files, 548 tests passed; 61.36% statements, 52.75% branches, 60.51% functions, 63.49% lines.
- `npx tsc --noEmit` — passed.
- `npm run lint` — passed with zero warnings.
- `npm run build` — passed.
- `npm run validate` — passed.
- `npm run test:recovery` — 3 Python tests passed.
- `cargo test --manifest-path src-tauri/Cargo.toml` — 20 Rust library tests passed; binary tests and doc-tests passed.
- Relevant Canvas Chromium subset — 15 passed.
- Relevant Document/reconstruction Chromium subset — 16 passed, with one unrelated failure described below.
- Existing theme/editor integration suite — 79 tests passed; the full Vitest run also includes all theme-related coverage.

Known unrelated validation failure: `e2e/document-reconstruction.spec.ts:1125` failed only because the test's `browserErrors` assertion received `Failed to load resource: the server responded with a status of 404 ()`. It is outside the Phase 1O file set, which contains no Document changes, and the remaining 16 matching Document/reconstruction tests passed. No visual snapshots were changed.

## Remaining dirty-source inventory

Trusted shadow observations now include the explicit Canvas Border Style command, explicit Canvas Transform Lock command, and explicit Canvas Theme Color Lock command. The broader authored inventory remains incomplete. Relevant unobserved Canvas sources are:

- manual fill colour, native picker/recent/Vision Palette fill, opacity, stroke colour/width, gradients, shadows, and other style controls;
- theme-token linking and unlinking, reset-to-default-theme, global theme application, and Vision Palette/theme side effects;
- `colorLocked` mutations performed as a side effect of themed-fill or reset commands;
- Selection Lock/full-object lock, visibility, z-order, duplication/copy semantics, and other object metadata;
- Canvas text/style editing and all Document formatting/styles;
- assets, templates/recipes, recovery/full-page restoration, and remaining structured/document sources.

These remain legacy-owned and are intentionally not inferred from generic Fabric property writes.

## Rollback

Revert the Phase 1O commit with:

```bash
git revert <phase-1o-commit-sha>
```

This removes only the shadow action, adapter/diagnostic coverage, store postcondition observation, focused tests, report, and the existing test hook. It does not change the legacy Color Lock behavior, theme behavior, serialization, persistence, dirty state, or history ownership. The separately staged `AGENTS.md` is not part of the commit and must remain staged and unchanged.

## Readiness verdict

Not ready for shared change ownership. Phase 1O is evidence only: the normalized transaction and diagnostic revision are shadow data, while legacy Canvas mutation, dirty state, autosave, history, persistence, recovery, export, and theme behavior remain authoritative. Broader authored coverage and the ownership migration work are intentionally still outstanding.

## Recommended Phase 1P slice

Audit and, only if its existing boundary meets the same postcondition and exactly-once rules, normalize the discrete Canvas Visibility command already exposed by the Layers Panel Eye/Hide control (`handleToggleVisibility` and its current `visible` mutation). Keep z-order, duplication, remaining metadata, and all text/theme/style commands out of that slice.
