# Unified Editor — Authority Handoff & Consolidation

Status: historical handoff record; implementation complete for its stated
milestone

Verdict: **UNIFIED DIRTY/AUTOSAVE AUTHORITY HANDOFF COMPLETE**

This document records the handoff milestone and its validation snapshot. It is
not the complete current architecture contract. The current typed scene,
authored-revision, persistence-acknowledgement, interaction-mode, export, and
auxiliary-storage boundaries are maintained in
[`docs/architecture/state-boundary-contracts.md`](../architecture/state-boundary-contracts.md).

## Current contract supersession

The handoff's `completeAuthoredCoverage` flag means only that the normalized
committed ProjectChange stream was sufficient for the handoff's dirty/autosave
decision. It is not a claim that one numeric counter replaces the
engine-specific Canvas and Document clocks, nor that it covers history,
durability, recovery, or asset ownership.

The current implementation additionally requires every routed renderer adapter
to deliver committed observations to the shared coordinator. Standalone legacy
mounts may omit that seam for compatibility; routed observation loss returns a
discriminated failure and is logged at the lifecycle boundary. The optional
diagnostic shadow observer remains a diagnostic projection only.

This package transfers unified authored dirty state, autosave scheduling, and
shared save status to a renderer-neutral lifecycle authority. Canvas and
Document still own their existing serialization and database writes. Native
history, recovery, and canonical asset ownership remain engine-owned.

At the time of this handoff, `completeAuthoredCoverage` was `true`. In this
package that meant the normalized committed ProjectChange stream was complete
enough to drive authored dirty and autosave decisions. It did not claim shared
history, persistence, recovery, or asset authority.

## Before and after

Before this handoff, `UnifiedEditorSession` exposed the legacy renderer store
values through the shared session bridge:

```text
Canvas editorStore.isDirty/saveStatus  ─┐
                                       ├─> ProjectSessionSnapshot
Document documentStore.isDirty/status ─┘

Canvas triggerAutoSave (2 s)      ─> Canvas persistence
Document queueAutosave (900 ms)   ─> Document persistence
```

After this handoff, the unified route has one lifecycle owner:

```text
committed ProjectChange
        │
        ▼
projectLifecycleAuthority
  authoredRevision / persistedRevision
  dirty / saveStatus / one autosave schedule
        │
        ▼
active renderer save adapter
  Canvas existing serializer + IndexedDB write
  Document existing serializer + IndexedDB write
        │
        ▼
persisted revision watermark
```

The lifecycle authority contains no Fabric object, Tiptap document, project
snapshot, history patch, database payload, or asset table.

## Shared lifecycle authority

`src/editor/session/projectLifecycleAuthority.ts` is a small runtime-only
authority subscribed once to the active `ProjectChangeCoordinator`.

Its snapshot tracks:

- project ID and renderer session identity;
- lifecycle generation;
- `authoredRevision`;
- `persistedRevision`;
- the revision currently being saved;
- derived `isDirty`;
- shared `saveStatus` (`saved`, `unsaved`, `saving`, or `error`);
- autosave eligibility and pending state;
- save-in-flight state;
- save/close capabilities.

The invariant is:

```text
isDirty = authoredRevision > persistedRevision
```

Only a `committed` transaction for the active project advances
`authoredRevision`. Begin, rejected, failed, mismatched-project, hydration,
replay, navigation, selection, viewport, serialization, and teardown activity
is ignored by the authority.

Opening or replacing a project starts a generation-local clean baseline. A
stable session identity updates the active adapter and project ID without
resetting authored revisions; a new identity cancels pending work, advances
the generation, and starts clean. Late promises from an old generation cannot
change the new session.

The authority subscribes to the coordinator exactly once. Subscriber and
adapter errors do not affect the legacy mutation that produced the observation,
but required observation delivery failures are surfaced through the typed
adapter result and lifecycle error reporting.

## Autosave scheduling and eligibility

The scheduler is shared by the unified route and has one pending timer and at
most one save in flight. A burst of committed changes coalesces into one save.
If newer authored revisions arrive while a save is in flight, completion only
advances the persisted watermark to the revision captured when that save
started and schedules a follow-up save.

The active renderer adapter supplies only the execution policy:

| Renderer | Shared delay | Autosave eligibility | Execution |
| --- | ---: | --- | --- |
| Canvas | 2,000 ms | existing library project and ready Canvas | existing `updateCurrentProject` |
| Document | 900 ms | existing library project and loaded Document project | existing `flushAutosave` |

New or portable projects do not autosave into a newly-created library entry.
They remain dirty until the user performs an explicit save, which establishes
the existing persistence destination. The shared scheduler owns when; the
adapter owns how.

Under `UnifiedEditorSession`, Canvas and Document legacy authored autosave
timers are disabled/guarded by `lifecycleAuthorityMode: 'shared'`. Standalone
legacy editor routes retain their original timers through
`lifecycleAuthorityMode: 'legacy'`. This preserves supported standalone
behavior without allowing two autosave schedulers under the unified route.

Document active-page selection is a special compatibility persistence path.
It is navigation persistence, not authored content. In shared mode it uses a
separate 900 ms `navigationPersistenceTimer` that writes the existing Document
payload without advancing the shared authored revision or invoking the shared
authored autosave scheduler. A real authored mutation cancels that timer; a
full save also cancels it. This preserves the existing persisted page-selection
behavior without making navigation appear as an authored ProjectChange.

## Manual save lifecycle

The shared command adapter wraps the existing renderer save operation:

1. cancel pending shared autosave;
2. capture the current authored revision;
3. expose `saving` and the in-flight watermark;
4. call the active Canvas or Document save implementation;
5. on success, advance `persistedRevision` to at least the captured revision;
6. leave the session `unsaved` and schedule another autosave if newer edits
   exist;
7. on failure, retain dirty state and expose `error` without advancing the
   persisted watermark.

For example, if revision 10 is saving and revisions 11 and 12 arrive, success
persists watermark 10 and leaves the session dirty at revision 12. The next
shared autosave captures revision 12. An older completion cannot mark a newer
session clean.

The shared `commands.save`, `commands.isDirty`, close checks, before-unload
guard, Save button state, and shared status chrome use this authority. Portable
download is still performed by the existing renderer export path; the shared
wrapper acknowledges only the authored revision captured for a successful
download, and newer edits remain dirty.

## Session snapshot and lifecycle integration

`useLegacyProjectSessionBridge` now subscribes to the authority with
`useSyncExternalStore`. The shared `ProjectSessionSnapshot` derives `isDirty`,
`saveStatus`, `canSave`, and `canClose` from the authority rather than from
Canvas or Document legacy status fields.

The bridge starts a shared lifecycle session for the active renderer and puts
the inactive renderer in legacy mode. Project replacement, editor-mode change,
close, teardown, and StrictMode cleanup cancel timers and invalidate old
in-flight work. The existing microtask-delayed runtime cleanup remains in
place so a React StrictMode setup/cleanup probe does not dispose the live
coordinator or authority.

## Legacy dirty machinery retained

Legacy state was not removed wholesale because it still participates in engine
behavior and compatibility persistence:

- Canvas `isDirty`, `changeRevision`, `autoSaveStatus`, `saveStatus`, and
  `triggerAutoSave` remain available for standalone routes and engine-local
  save/history bookkeeping. `markProjectDirty` only starts the legacy timer in
  legacy mode. The existing Canvas serializer and `updateCurrentProject` stay
  unchanged as persistence implementations.
- Document `isDirty`, `revision`, `saveStatus`, and legacy `queueAutosave` /
  `flushAutosave` remain available for standalone routes and compatibility
  writes. Authored legacy autosave is disabled in shared mode. Navigation
  persistence remains separate as described above.
- Legacy fields are still useful to the diagnostic parity observer and to
  engine-local safeguards. They no longer determine unified-shell dirty truth,
  unified save status, close confirmation, or shared autosave scheduling.

No second dirty inference mechanism was added. The shared authority does not
inspect Fabric events, store subscriptions, Tiptap state, or legacy dirty
booleans to infer authored changes.

## Parity diagnostics

The optional diagnostic observer continues to receive legacy lifecycle values
only as a migration guardrail. It does not mutate shared lifecycle state and is
not the source of truth. Required committed observations are a separate routed
contract; they are not diagnostics. Expected parity exceptions remain explicit:

- Document navigation persistence can make the legacy store dirty while the
  shared authored revision remains unchanged;
- engine-local save/history bookkeeping can change legacy status;
- hydration, replay, recovery, autosave bookkeeping, and teardown remain
  outside authored revisions.

Coverage now records:

```text
sharedDirtyAuthority:       true
sharedAutosaveAuthority:    true
sharedHistoryAuthority:     false
sharedPersistenceAuthority: false
sharedRecoveryAuthority:    false
sharedAssetAuthority:       false
completeAuthoredCoverage:   true
```

## History, persistence, recovery, and assets

These concerns were evaluated but deliberately not transferred.

### Native history — retained by each renderer

ProjectChange is not history storage and does not synthesize undo/redo entries.
Canvas and Document replay remain silent to the shared authored revision. The
known Canvas limitation remains: some array-order-only z-order changes persist
and dirty correctly but are not represented by current diff-history snapshots.
That is future history work, not a dirty/autosave blocker.

### Persistence implementation — retained by adapters

Canvas continues to serialize through its existing project payload, asset
preparation, thumbnail, and IndexedDB paths. Document continues to serialize
through its existing project payload and IndexedDB paths. This handoff did not
introduce a persistence schema migration. Later stabilization added typed
scene snapshots and persistence acknowledgements around these existing
adapters; those current guarantees are recorded in the architecture contract.

### Recovery — unchanged

The existing recovery workspace and recovery tools remain responsible for
backup, extraction, verification, and cleanup. Recovery/hydration paths remain
clean and silent unless existing product behavior explicitly marks restored
work dirty; this handoff does not reinterpret recovery data.

### Assets — unchanged at handoff time

Canonical asset ingestion, reference counting, persistence, and recovery remain
owned by the existing engine systems. The lifecycle authority carries no asset
data and does not become an asset database. Current auxiliary ownership and
session-only URL rules are documented in the architecture contract.

## Authority matrix

| Concern | Final owner |
| --- | --- |
| authored change detection | committed ProjectChange |
| dirty state | shared lifecycle authority |
| save status | shared lifecycle authority |
| autosave scheduling | shared lifecycle authority under UnifiedEditorSession |
| Canvas serialization/write | Canvas renderer adapter and existing persistence |
| Document serialization/write | Document renderer adapter and existing persistence |
| native history | legacy renderer |
| recovery | existing recovery system |
| canonical assets | existing engine systems |

## Tests and validation

Focused authority coverage includes:

- clean baseline and committed-only revision advancement;
- rejected/failed/mismatched transactions staying clean;
- one coalesced autosave for an edit burst;
- edit-during-save watermark behavior and follow-up autosave;
- manual-save cancellation and failure behavior;
- edit-during-manual-save behavior;
- non-persisted projects remaining eligible for manual save but ineligible for
  autosave;
- stale completion after project/session replacement;
- one guarded legacy timer path under shared mode for both renderers;
- shared session snapshot and command dirty truth;
- Document navigation persistence remaining separate from shared authored
  autosave.

Validation results:

- Focused authority/session/Document tests: **37 tests passed**.
- Full Vitest: **58 files, 592 tests passed**.
- Full coverage: **58 files, 592 tests passed**; statements 61.53%, branches
  52.50%, functions 60.79%, lines 63.60%.
- TypeScript (`npx tsc --noEmit`): **passed**.
- ESLint (`npm run lint`): **passed**.
- Production build (`npm run build`): **passed**.
- `npm run validate`: **passed**.
- Recovery tests (`npm run test:recovery`): **3 passed**.
- Rust/Tauri tests (`cargo test --manifest-path src-tauri/Cargo.toml`):
  **20 passed**; doc tests had no cases.
- Chromium/E2E: **52 passed, 2 failed of 54**. The failures were not caused
  by this handoff: one existing asset-library console assertion received the
  known server `404` resource warning, and one historical visual assertion
  received an environment-dependent 618×798 page instead of the stored
  632×816 snapshot. No visual snapshots were changed. Canvas, Document,
  recovery, reconstruction, save/reopen, native-color, and continuous-control
  tests otherwise passed.
- `git diff --check`: **passed**.

The E2E failures are recorded separately rather than hidden by weakening
console assertions or updating unrelated snapshots.

## Rollback

Revert the handoff commit to restore the prior observational session bridge and
legacy unified-route lifecycle behavior. No persisted schema or database
migration needs reversal. The separately staged `AGENTS.md` is not part of the
handoff commit and must remain untouched when reverting or cherry-picking this
change.

## Optional future work

The required unified-editor consolidation is complete. Future architectural
work may evaluate shared history semantics, the Canvas z-order diff-history
limitation, persistence implementation consolidation, recovery ownership, and
asset ownership independently. None is required before using the shared dirty,
autosave, and save-status authority delivered here.

**UNIFIED DIRTY/AUTOSAVE AUTHORITY HANDOFF COMPLETE**
