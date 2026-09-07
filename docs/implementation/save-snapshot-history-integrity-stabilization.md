# Save / Snapshot / History Integrity Stabilization

Baseline: `b56833a2988875cde238461907e41d137dde0135`
Date: 2026-09-07

This pass implements Move 1 from the forensic audit: a completed persistence
operation has a precise snapshot, identity, target, and revision contract. It
does not redesign Document composition or either publishing engine.

## 1. Persistence operation contract

Added `src/editor/session/persistenceOperation.ts` with a small opaque
`PersistenceOperationContext` containing session identity, project identity,
library/file target identity, captured authored revision, and an immutable
renderer-owned snapshot.

Canvas save, Canvas update, Canvas download, Document save, and Document
download now capture their inputs before asynchronous work. A completion can
install live state only when session, project, target, and revision still
match. The persisted payload can still be written for its captured destination,
but it cannot replace a newer live session.

The shared adapter also acknowledges a download revision only when the same
engine session and lifecycle revision are still current.

## 2. Undo/Redo lifecycle signaling

Fabric reconstruction remains silent under its sync lock. The completed user
operation now emits exactly one semantic `undo-freeform` or `redo-freeform`
observation after replay. This advances the shared lifecycle revision,
participates in the normal trailing autosave schedule, and does not add a
history entry or unsuppress low-level Fabric events.

## 3. Stale async completion prevention

The guards cover same-session newer edits, page/target changes, and session or
project replacement. An old operation may finish its intended database/file
write, but it cannot replace newer Canvas pages/assets, rebind a replacement
session, install an old Document payload, clear dirty state for newer work, or
acknowledge a newer lifecycle revision.

Document library save retains its session-token behavior and now uses the
captured library target rather than rereading a possibly changed target after
an await.

## 4. Live-session asset retention

Document reachability compaction remains unchanged for persisted payloads.
Manual save keeps the un-compacted asset map in the live session while history
can still restore stable image IDs. The saved payload contains only currently
reachable assets; the live editor retains additional bytes solely as runtime
history support. Download similarly never mutates the live compacted project.

## 5. Draft registration lifecycle

The scoped live-draft registration remains editor-owned. StrictMode effect
probe cleanup now unregisters temporarily but defers scope disposal until the
cleanup is not followed by probe setup. A real unmount still disposes the
scope, so an old editor cannot flush a later editor.

## 6. Native close detection

`UnifiedEditorChrome` now reuses `isTauriRecoveryAvailable()`, the existing
detector that recognizes both `window.__TAURI_INTERNALS__` and
`window.__TAURI__`. No third detector was introduced. Chromium tests can verify
the shared predicate, but a real Tauri close-request harness was not available
in this environment; native close remains a manual acceptance step.

## 7. Mechanisms retired or made impossible

- Document download completion can no longer install its captured compacted
  project into the live store.
- Canvas persistence completion can no longer install captured pages/assets
  across a changed operation context.
- Shared download commands can no longer mark a newer lifecycle revision
  persisted merely because an older file delivery succeeded.
- Completed Canvas history replay is no longer invisible to shared dirty/
  autosave authority, while replay internals remain suppressed.
- A StrictMode probe can no longer permanently dispose the mounted draft scope.
- Live Document asset bytes are no longer discarded as a side effect of
  preparing a compacted persisted snapshot.

No renderer-specific history implementation, schema, export renderer,
geometry kernel, recovery boundary, or protected debounce was removed.

## 8. Reproduced forensic cases before/after

| Case | Before | After contract |
| --- | --- | --- |
| Canvas Save → Undo | Visible undo, shared lifecycle clean, DB retained old object | One semantic undo completion dirties shared lifecycle and schedules autosave |
| Delayed Document download | Old captured project replaced a newer rename | Old file is delivered; newer live project and dirty revision remain |
| Delete image → Save → Undo | Compaction removed bytes; undo showed unavailable image | Persisted payload is compact; live history-retained bytes render on undo |
| StrictMode immediate draft flush | Scope disposed during effect probe; global flush returned 0 | Probe cleanup cannot dispose the effective mount; real unmount still removes it |
| Delayed Canvas save/update | Completion could install old pages/assets or target binding | Completion installs only when the captured operation still owns current state |
| Native close | Chrome checked only `__TAURI__` | Chrome uses the configured runtime detector including `__TAURI_INTERNALS__` |

## 9. Validation

Completed during this pass:

- `npm test -- --run` — 60 files, 635 tests passed;
- `npm run test:coverage` — passed, 62.52% statements / 53.29% branches;
- `npx tsc --noEmit` — passed;
- `npm run lint` — passed;
- `npm run build` — passed;
- `npm run validate` — passed;
- `npm run test:recovery` — 3 Python tests passed;
- `cargo test --manifest-path src-tauri/Cargo.toml` — 20 Rust tests passed;
- `npm run test:e2e` — 82/84 Chromium tests passed.

The two Chromium failures were not caused by this change's persistence paths:
one was a timing-sensitive multi-photo drag bounding-box setup, and one was
the pre-existing reviewed page-49 screenshot dimension mismatch. No snapshot
was updated. Native Tauri UI validation was not available here; Chromium
bridge mocks are not native proof.

## 10. Remaining risks

- Canvas and Document still have renderer-specific history models; page,
  overlay, and metadata undo semantics are not unified.
- Navigation persistence remains a separate Document writer and should be
  brought under the same serialized operation boundary in a later pass.
- Async photo ingestion paths still need the page/session targeting rule used
  by reference import.
- Native close behavior needs an actual Tauri/WebKit close-request harness.
- StrictMode lifecycle coverage should be promoted to a mounted shell
  regression, not only source/service coverage.

Most importantly: a successful old persistence operation can still write its
own captured bytes to its intended external destination, but it can no longer
overwrite newer live state or mark that newer state clean.
