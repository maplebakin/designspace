# Unified Editor Phase 1F Implementation Report

## Scope and architecture

Phase 1F expands the Phase 1E shadow model without making it authoritative. The
runtime-only `ProjectChangeDiagnosticView` still subscribes passively to
terminal `ProjectChangeCoordinator` transactions. It now exposes bounded
diagnostic lifecycle checkpoints, a legacy dirty-source hint, and expanded
coverage for Canvas object lifecycle and one Document metadata boundary.

`observedRevision` is a diagnostic authored revision, not a canonical project
revision. It starts at zero for each unified project session and increments only
for committed normalized transactions. It is not persisted, used by schemas,
used by IndexedDB, used by history, or used by save/autosave decisions.

`legacyDirty` and `legacySaveStatus` remain observed values from the existing
`ProjectSession` adapter. They are observed legacy state, not owned dirty state.
The diagnostic observer never calls dirty, save, autosave, history, recovery,
export, or asset-ownership APIs.

## Lifecycle checkpoints

The view retains at most 32 runtime checkpoints. The supported kinds are:

- `session-opened`
- `after-authored-commit`
- `legacy-became-dirty`
- `save-started`
- `save-completed-clean`
- `save-failed`
- `before-close`
- `session-closed`

`after-authored-commit` is recorded after the transaction has incremented the
diagnostic revision. Save checkpoints are derived from actual normalized
`ProjectSession` transitions; no timeout or debounce timing is used. A clean
save advances the diagnostic clean baseline when the legacy lifecycle proves a
previous dirty/saving state, but it does not erase historical diagnostic
revision count.

The observer resets on project ID changes, unsubscribes on disposal, and is
safe under React StrictMode. Repeated lifecycle snapshots do not create
duplicate checkpoints or subscriptions.

## Document page-selection semantics

Page selection remains intentionally non-authored in the transaction stream.
The legacy Document store nevertheless marks it dirty because `selectPage`
updates the persisted top-level `activePageIndex`, increments the store
revision, and protects that preference from an in-flight save restoring the old
index. Document persistence preserves `activePageIndex`, save/reopen tests
restore it, and the existing autosave race test depends on the revision bump.

Therefore Phase 1F retains the legacy behavior and classifies it as
`navigation-persistence`. It is not treated as authored content or a history
change. The normalized session adapter carries this runtime-only reason into
the diagnostic comparison. A navigation dirty state is reported explicitly as
`legacy-dirty-with-navigation-persistence`, not as a broken transaction
agreement. The user-facing dirty boolean and save behavior are unchanged.

## Canvas add/remove observation

Canvas serialized-store insertion/removal (`addObject`, `addObjects`, and
`removeObject`) and direct Fabric object lifecycle events now share the narrow
`CanvasCommittedMutation` adapter. They emit `add-freeform-object` or
`remove-freeform-object` with project/page context added by the existing legacy
renderer adapter, a stable object ID, and no Fabric object.

Shape additions/removals report `assetEffect: none`. Image additions report
`unknown-engine-owned`; image removals report `cleanup-delegated`. These are
conservative effects and do not assert that a Canvas object ID is a canonical
asset ID.

Hydration and internal replay are suppressed by the existing hydration guard,
the Canvas sync lock, and `__layerSyncing` markers. Explicit synchronous
suppression covers project/template/recipe reset, grouping/ungrouping, resize
clears, vision-board restoration, and temporary helpers. System chrome,
placeholders, guides, and measurement objects are filtered. History restore,
undo, and redo remain history-owned and do not create authored add/remove
transactions.

## Additional authored boundary and coverage

The selected additional family is a discrete Document page metadata command:
changing the page column count emits one `modify-page-metadata` transaction
after the existing store update. It does not instrument Tiptap keystrokes or
alter native editor history.

Trusted Phase 1F coverage is now:

- normalized page structure mutations;
- Canvas committed geometry;
- Canvas object add/remove;
- Document committed overlay pointer-up geometry; and
- Document column-count metadata commits.

Coverage remains explicitly incomplete for text editing, Fabric text/styles,
grouping, captions, references, most page settings and flow/inspector changes,
asset mutations, drawing/erase, templates, recipes, and full-page restoration.
The diagnostic revision must not be read as a complete project revision.

## Save, reopen, recovery, and tests

The existing save paths remain responsible for persistence. Covered mutations
make the legacy engine dirty, save transitions are observed through session
snapshots, and diagnostic history remains after a clean save. Reopen/hydration
starts a new runtime baseline and does not replay stored edits as new
transactions. Recovery continues to hydrate/write through its existing paths;
the diagnostic model is not recoverable and performs no recovery writes.

Added focused coverage includes lifecycle checkpoints, navigation dirty
classification, page metadata, Canvas add/remove IDs and asset effects,
hydration/sync-lock/suppression behavior, store add/remove observation, and
StrictMode session lifecycle. Existing Document selection save-race and
round-trip tests were extended with the runtime reason.

Validation completed:

- TypeScript, ESLint, production build: passed.
- Full Vitest: 46 files, 469 tests passed.
- Coverage run: 46 files, 469 tests passed; 59.75% statements overall.
- Canvas, Product/Document, and reconstruction E2E: 38 passed.
- Recovery tests: 3 passed.
- Rust/Tauri tests: 20 passed.

## Mismatches, rollback, and next slice

The known page-selection mismatch is now explained as intentional persisted
navigation/session state. Other legacy dirty sources can still lack a
transaction, especially text, styles, inspector changes, structured flow,
asset changes, drawing/erase, templates, and full-page restoration. Document
keyboard/inspector overlay commits also remain outside the trusted pointer-up
boundary. These cases remain coverage gaps or inconclusive comparisons rather
than automatic errors.

Evidence is materially stronger but does not support beginning shared dirty or
change ownership. Rollback is straightforward: revert this single Phase 1F
commit and remove the optional observer/callback wiring. Existing engine
mutation, dirty, save, autosave, history, persistence, recovery, export, and
schema behavior remains the authority either way.

The exact next slice should remain shadow-only: normalize one reliable Document
overlay keyboard/inspector commit boundary and compare it through the same
checkpoint model. Reassess shared coordination only after that evidence and
the remaining unobserved dirty categories are quantified; do not start shared
dirty, autosave, history, canonical asset ownership, or mixed-page authority.
