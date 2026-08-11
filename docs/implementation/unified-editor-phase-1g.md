# Unified Editor Phase 1G Implementation Report

## Scope and authority

Phase 1G closes the Document overlay-geometry observation gap in the existing
shadow stream. The legacy Document store still performs the mutation, dirty
marking, autosave scheduling, history work, and persistence. The
`ProjectChangeCoordinator` only receives a normalized observation after the
legacy commit succeeds, and the diagnostic observer remains an optional,
runtime-only subscriber.

The diagnostic authored revision is not a canonical project revision, save
token, schema revision, persistence revision, or undo depth. The observed
legacy dirty/save state is not owned dirty state.

## Geometry paths and normalized contract

All three supported interactions now use the same narrow reporting helper in
`DocumentEditorShell`:

```text
pointer drag/resize
keyboard arrow nudge
inspector width/height/X/Y
        -> commitOverlayGeometry succeeds
        -> modify-structured-geometry
        -> target structured-image / stable overlay ID
```

The pointer path was already trusted. It still reports once from the
`DocumentOverlayLayer` pointer-up callback. Keyboard handling now consumes the
existing boolean returned by `nudgeOverlay`; Shift distance and one-keydown
granularity are unchanged. Inspector numeric controls retain their existing
`onChange` behavior: every successful geometry store commit is observed
individually. No batching, keyup buffering, timers, or history semantics were
added. Caption, alt text, crop focal values, placement, and other metadata-only
inspector updates do not masquerade as geometry.

`commitOverlayGeometry` now returns `false` when the normalized result is
identical to the existing geometry. Stale page/overlay IDs and no-op requests
therefore produce no committed observation and no legacy revision. This only
corrects the existing success signal; it adds no dirty, save, autosave, or
history call. The pointer callback was refactored to the same helper, so it did
not gain a second notification. No Fabric, Tiptap, DOM, or Document runtime
object crosses the shared contract.

The normalized shape remains:

```text
source: document
action: modify-structured-geometry
domain: geometry
target.kind: structured-image
target.id: stable overlay ID
assetEffect: none
```

The diagnostic coverage contract records the three trusted interaction inputs
(`pointer`, `keyboard`, and `inspector`) while retaining
`completeAuthoredCoverage: false`.

## Checkpoints, lifecycle, and granularity

Phase 1F's bounded checkpoints remain unchanged. A successful store commit is
reported synchronously after the legacy update; the observer records
`after-authored-commit`, and the normalized session snapshot later records the
real `legacy-became-dirty` transition. Save start/clean completion remain
derived from actual legacy lifecycle transitions, with no timeout inserted.
The diagnostic revision increments once per successful store commit and does
not coalesce keyboard repeat or inspector input events.

React StrictMode remains safe: the shell's keyboard listener is cleaned up and
re-established by its existing effect lifecycle, and a single keydown produces
one callback. Hydration, overlay selection, page navigation, reopen, and export
do not call the explicit commit boundary. Existing Phase 1F suppression and
session disposal behavior remains in force.

## Dirty-source inventory

The inventory below is based on the current `markDirty`/`saveState` paths, not
on diagnostic assumptions.

| Engine | Dirty-producing family | Current legacy trigger | Coordinator status | Classification / ownership blocker |
|---|---|---|---|---|
| Document | Add, duplicate, remove, and reorder page | `markDirty` after page mutation | Observed through normalized unified page commands | TRUSTED-OBSERVED; not a blocker at that boundary |
| Document | Column count | `updatePage` then `markDirty` | `modify-page-metadata` | TRUSTED-OBSERVED; not a blocker at that boundary |
| Document | Overlay pointer, keyboard, and inspector geometry | `commitOverlayGeometry` -> `updatePage` -> `markDirty` | `modify-structured-geometry` | TRUSTED-OBSERVED; not a blocker at that boundary |
| Document | Active page selection | Persists `activePageIndex`, increments revision, calls `markDirty('navigation-persistence')` | No authored transaction by design | NAVIGATION-PERSISTENCE; requires separate policy before shared authored dirty ownership |
| Document | Title/body Tiptap content and flow-image transactions | `updatePage`, `commitPageImageState`, or `updateBodyContent` | No reliable shared boundary | UNOBSERVED-AUTHORED; blocks ownership |
| Document | Overlay add/remove, placement, caption, alt text, crop/focal, replacement, and metadata | `addOverlay`, `removeOverlay`, or `updateOverlay` | Geometry only is observed | UNOBSERVED-AUTHORED; blocks ownership |
| Document | Margins, paper size/orientation, background, column gap, folio/title flags, language, drop cap, styles, and most page settings | `updatePage` or the corresponding document action | Column count only is observed | UNOBSERVED-AUTHORED; blocks ownership |
| Document | Assets, references, project rename/language/styles/folios | `addAsset`, `setReference`, or project-level `markDirty` paths | No shared transaction | UNOBSERVED-AUTHORED; blocks ownership |
| Document | Tiptap undo/redo and recovery/open hydration | Native history or lifecycle hydration | Not emitted as authored diagnostic transactions | HISTORY-OWNED / REPLAY-SUPPRESSED or LIFECYCLE; remains legacy-owned |
| Canvas | Object add/remove | Store `saveState` or Fabric lifecycle update followed by `markProjectDirty` | `add-freeform-object` / `remove-freeform-object` with stable object ID | TRUSTED-OBSERVED, with conservative asset effects |
| Canvas | Committed object movement/transform | Fabric `object:modified` update/save path | `modify-freeform-geometry` | TRUSTED-OBSERVED; programmatic-vs-user ambiguity remains documented |
| Canvas | Fabric text editing | `text:changed` update/save path | No text transaction; a later `object:modified` is not a reliable text boundary | UNOBSERVED-AUTHORED; blocks ownership |
| Canvas | Styles, fills, strokes, locks, text effects, image adjustments, alignment, distribution, and z-order | Direct object update followed by `saveState` | No normalized action | UNOBSERVED-AUTHORED; blocks ownership |
| Canvas | Group/ungroup and related structural rewrites | Suppressed add/remove events plus explicit `saveState` | No group transaction | UNOBSERVED-AUTHORED; blocks ownership |
| Canvas | Drawing, erase, and textbox creation | Fabric object/save paths; erase uses a drawing operation rather than a stable product command | Generic add may occur for some paths, but no reliable drawing/erase semantic observation | AMBIGUOUS; blocks ownership |
| Canvas | Clipboard paste, image/frame creation, and asset changes | Object insertion plus existing asset/save logic | Object add may be observed; asset ownership/reference effects remain engine-owned | PARTIALLY OBSERVED / UNOBSERVED-AUTHORED; blocks ownership for asset dirty coordination |
| Canvas | Add/delete/reorder pages | `markProjectDirty` after page action | Normalized page transaction through unified commands | TRUSTED-OBSERVED at the unified boundary |
| Canvas | Page switch, fit, zoom, selection, and focus | Page switch hydrates/syncs without authored dirty; viewport/selection are transient | No transaction | LIFECYCLE / NON-AUTHORED |
| Canvas | Templates, recipes, theme application, and restoration | Maintenance/hydration paths and final legacy save state | Suppressed or outside a stable product transaction | AMBIGUOUS / HISTORY-OWNED; blocks ownership |
| Canvas | Project load, recovery hydration, and export rendering | Lifecycle/reset or render-only work | Suppressed and not observed | LIFECYCLE / NON-AUTHORED |
| Canvas | Undo/redo | Native history replay sets legacy dirty; sync lock suppresses replay object events | No authored replay transaction | HISTORY-OWNED / REPLAY-SUPPRESSED; remains legacy-owned |

The inventory confirms that geometry parity improves evidence but does not make
the transaction stream complete. In particular, Document content/metadata and
Canvas text/style/group/drawing/asset families can still make legacy state
dirty without a trustworthy normalized transaction. The page-selection
navigation mismatch is understood, not repaired or reclassified as authored
content.

## Save, reopen, hydration, recovery, and regression behavior

The existing Document save path persisted keyboard-equivalent overlay geometry,
and the existing load path reopened the changed coordinates with a clean store
and revision baseline. Diagnostic state is not serialized or restored. The
editor tests also prove that overlay selection and hydration produce zero
geometry observations. Existing page-selection persistence, autosave timing,
history, recovery hydration, export, and schemas were not changed.

## Tests and validation

Added or extended focused tests for:

- pointer exactly-once regression;
- inspector width and X geometry observations, no-op suppression, and silent
  metadata-only updates;
- keyboard 1 px/Shift 10 px observations, stale-target suppression, and
  StrictMode listener behavior;
- truthful no-op `commitOverlayGeometry`/`nudgeOverlay` results;
- save/reopen persistence of committed overlay geometry;
- hydration/selection silence; and
- diagnostic coverage listing all three trusted geometry inputs.

Focused validation passed for the Document editor, overlay store geometry,
Phase 1E diagnostic, and Phase 1F regression suites. TypeScript and ESLint also
passed after the implementation. Full Vitest passed with 46 files and 473
tests. Coverage passed at 59.83% statements, 50.60% branches, 58.90%
functions, and 61.95% lines. The production build passed, as did the recovery
tool suite (3 tests) and Rust/Tauri tests (20 library tests, with zero failures
in the binary and doc-test targets). The full browser suite passed 51 of 52
tests. Its one failure, reproduced in an isolated rerun, is the pre-existing
historical page-49 visual snapshot: the rendered sheet was 618x798 while the
baseline expects 632x816. No Phase 1G code or snapshot was changed for that
unrelated mismatch. Browserslist also emitted its existing stale caniuse-lite
warning.

## Authority, rollback, and next slice

Phase 1G remains shadow-only. The diagnostic observer does not call dirty, save,
autosave, history, persistence, recovery, export, or asset-ownership APIs.
Deleting this slice restores the former callback behavior; the only legacy
semantic adjustment is the truthful no-op return value, which aligns with the
existing no-op `updatePage` behavior and requires no migration.

Evidence still does **not** support shared dirty/change ownership. The exact
recommended next slice is a shadow-only Document overlay add/remove boundary:
normalize the explicit user-facing add and remove commits, suppress hydration,
recovery, page-switch, and teardown events, and compare them through
save/reopen/recovery before selecting another content family. Do not begin
shared dirty, autosave, history, canonical asset ownership, or mixed-page
authority.
