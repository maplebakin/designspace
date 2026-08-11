# Unified Editor Phase 1D

## Scope

Phase 1D introduces a read-only `ProjectChangeCoordinator` seam above the
existing Canvas and Document engines. It describes authored changes after
legacy code has performed them; it is not a mutation dispatcher, persistence
writer, dirty-state owner, history, asset store, or export service.

The resulting direction is:

```text
shared command or committed engine event
  -> legacy Canvas/Document implementation
  -> ProjectChangeCoordinator observation
  -> normalized runtime transaction
  -> passive subscribers
```

No persisted project format, schema version, engine store, or renderer was
changed.

## Coordinator contract

`src/editor/session/projectChangeCoordinator.ts` defines the shared vocabulary:

- `ProjectChangeSource`: `canvas`, `document`, or `shared`;
- `ProjectChangeDomain`: project metadata, page structure, structured content,
  freeform content, geometry, style, and asset reference;
- `ProjectChangeAction`: the currently observed page actions plus committed
  freeform and structured geometry actions;
- `ProjectChangeObservation`: project ID, stable page IDs, source, action,
  domains, optional stable target ID, asset effect, and optional runtime
  correlation ID;
- `ProjectChangeTransaction`: runtime transaction ID, project/page identity,
  source/action/domains, asset effect, start/completion timestamps, outcome,
  and an optional normalized error;
- `ProjectChangeEvent`: a phase event for `begin`, `commit`, `reject`, or
  `fail`.

The coordinator API is intentionally small:

```ts
begin(observation)
complete(handle, completion?)
reject(handle, error, completion?)
fail(handle, error, completion?)
observeCommitted(observation, completion?)
subscribeEvents(listener)
subscribe(listener) // terminal transactions only
dispose()
```

The coordinator retains only in-flight transaction metadata. Transaction IDs
are runtime-only and are never used as page, object, or asset IDs. No live
Fabric object, Fabric canvas, Tiptap editor, ProseMirror transaction, DOM node,
blob URL, or project snapshot can enter the contract.

## Transaction semantics

Terminal statuses mean:

- `committed`: the legacy implementation completed the authored change;
- `rejected`: a valid product command was not permitted or supported, such as
  Canvas duplicate-page support or a stale page ID;
- `failed`: the legacy implementation reported or threw an unexpected error.

For command-driven page actions, the adapter ordering is:

1. begin one transaction for the authored command;
2. delegate to the existing adapter/store;
3. inspect the normalized Phase 1C result;
4. complete, reject, or fail the same transaction exactly once.

Page selection is deliberately excluded. It remains a navigation/session
operation and does not create an authored transaction. Zoom, selection, focus,
hover, guides, snap candidates, pointer previews, and save/recovery lifecycle
events are also excluded.

`ProjectChangeCoordinator` isolates every event and transaction subscriber. A
throwing passive subscriber is reported through the optional diagnostic error
hook and cannot prevent other subscribers, roll back a successful mutation, or
change coordinator state. `dispose()` clears active transactions and listeners;
the routed `UnifiedEditorSession` disposes its coordinator on unmount.

## Page mutation integration

`src/editor/session/projectChangeAdapters.ts` correlates the Phase 1C
`PageMutationResult` with one transaction. `legacyRendererAdapters.tsx` uses
this wrapper for both Canvas and Document `mutatePage` commands.

The legacy stores remain authoritative:

- Canvas still calls its existing `switchToPage`, `addPage`, `deletePage`, and
  `reorderPages` paths. Unsupported duplicate-page remains a normal rejected
  transaction.
- Document still calls its existing page actions, including native duplicate
  and last-page protection.
- Store-owned active-page changes, selection reset, dirty marking, autosave,
  thumbnails/serialization, and history-related side effects are not repeated
  by the coordinator.

The transaction reports the result's stable affected page IDs. A failed command
reports `unknown-engine-owned` asset effect because a partial engine-side
effect cannot be proven absent; a normal rejection reports no asset change.
Successful page results reuse the Phase 1C asset vocabulary, including
`retained-reference` and `cleanup-delegated`, and automatically include the
`asset-reference` domain when the effect is not `none`.

There is no second store observer for page actions. This avoids emitting one
transaction from the shared command and another from the legacy store.

## Representative Canvas observation

`src/editor/services/canvasEventService.ts` exposes a narrow engine-local
`CanvasCommittedMutation` callback. It is invoked only from the existing
`object:modified` handler, after the existing dirty/history/update work and
smart-guide cleanup. It reports:

```ts
{
  action: 'modify-freeform-geometry',
  objectId: 'stable-fabric-object-id'
}
```

`object:moving` previews, selection changes, zoom, and hydration events do not
invoke it. `CanvasStage` and `EditorShell` pass the callback through their
existing lifecycle boundary; the Canvas legacy adapter translates it into a
shared geometry transaction using the current project/page ID read from the
session at event time. The callback carries an object ID, not a Fabric object.

This is intentionally one reliable geometry boundary, not broad Fabric event
instrumentation. Fabric object add/remove, text editing, style changes, group
operations, and drawing remain unobserved by the coordinator for now.

## Representative Document observation

`DocumentEditorShell` accepts an engine-local committed-mutation callback. The
existing `DocumentOverlayLayer` keeps move/resize previews local and calls its
parent only at pointer-up. The shell then calls the existing
`commitOverlayGeometry`; only a successful store commit reports:

```ts
{
  action: 'modify-structured-geometry',
  overlayId: 'stable-document-overlay-id'
}
```

The Document legacy adapter translates this into a shared geometry transaction
whose target is a `structured-image`. This observes one committed overlay
geometry boundary without instrumenting every Tiptap transaction or every
Document metadata action.

Structured text keystrokes, Tiptap history grouping, flow-image transactions,
captions, image groups, references, page settings, and inspector-only geometry
changes are deliberately deferred until a reliable user-visible transaction
boundary is defined for each operation. The coordinator must not emit one
transaction per keystroke or pointer preview.

## Asset-effect integration

The coordinator reuses `PageAssetEffect` from Phase 1C; it introduces no
competing asset vocabulary and no asset store. Page mutations report the
effects already returned by their adapters. Representative geometry events
currently report `none` because neither event changes an asset reference.

The known Canvas issue remains unchanged: legacy image object IDs can also key
the `imageAssets` map. The new transaction contract treats a target object ID
as object identity and `assetEffect` as the separate media-reference channel;
it does not promote object IDs or runtime blob URLs into canonical asset IDs.
Asset cleanup, pruning, embedding, source hydration, blob revocation,
deduplication, and portable-file preparation remain engine-owned.

## Correlation, lifecycle, and error isolation

Command transactions begin before adapter delegation and terminate only after
the normalized result is known. Native engine observations use
`observeCommitted` at the committed event boundary. The page command path does
not also subscribe to a store event, so it has one transaction per command.

The routed session creates one coordinator per mounted unified editor session,
exposes it through the runtime-only `ProjectSessionCommands.changeCoordinator`
contract for future passive consumers, and disposes it with the session. No
coordinator object is persisted in Zustand project payloads or IndexedDB. The
Canvas callback reads the current session/page when the event arrives, avoiding
stale page IDs without re-registering handlers for every page switch.

## Responsibilities still legacy-owned

Phase 1D deliberately leaves these unchanged:

- Canvas/Fabric state, object factories, selection, geometry, grouping, dirty
  state, autosave, history, persistence, recovery, and export;
- Document/Tiptap state, layout kernel, structured images/groups, captions,
  folios, references, dirty state, autosave, history, persistence, recovery,
  and committed browser/Tauri/print export;
- project schemas, Document schema v6, IndexedDB records, portable files,
  recovery validators, asset lifecycle, Product Forge, templates, recipes,
  `editorMode` compatibility dispatch, and page models;
- cross-engine selection, mixed-page composition, z-order, wrapping
  exclusions, canonical mutation state, shared dirty/autosave, shared history,
  and canonical asset ownership.

The coordinator observes authored changes; it does not own them.

## Tests and validation

Added `__tests__/unified-editor-phase-1d.test.ts` covering:

- Canvas add-page committed transaction and page selection exclusion;
- unsupported Canvas duplicate and stale-ID rejection transactions;
- Document duplicate-page retained-reference asset effect;
- representative Canvas/Document normalized geometry observations;
- stable IDs/no engine snapshots in transaction objects;
- event ordering, subscriber isolation, unsubscribe, disposal, and no
  post-disposal notifications;
- one committed Canvas `object:modified` adapter event.

Extended existing coverage with:

- `__tests__/unified-editor-session.test.ts` asserting the shared runtime
  coordinator is exposed by both legacy routes;
- `__tests__/document-editor.test.ts` asserting one committed Document overlay
  geometry observation after pointer movement.

Validation during implementation:

- Phase 1D focused coordinator/adapter suite — 8 tests passed;
- focused regression suite (Phase 1C, unified session, Canvas hydration,
  Document overlay interaction, and Document editor) — 6 files / 88 tests
  passed;
- full Vitest suite — 44 files / 454 tests passed;
- TypeScript no-emit check — passed;
- ESLint with zero warnings — passed.
- production Vite build — passed.
- Canvas, product-studio, and Document reconstruction browser suites — 38
  Playwright tests passed.
- recovery suite — 3 tests passed.

The repository's existing Browserslist freshness warning remains informational.
Tauri/Rust validation was not rerun because this slice does not touch native
delivery, WebKitGTK capture, or export implementation code.

## Known risks and deferred issues

- Fabric's `object:modified` is the current committed geometry boundary, but a
  future programmatic Fabric mutation that emits the same event could be
  indistinguishable from a user gesture. Broader instrumentation should wait
  for an explicit command/gesture correlation contract.
- Document overlay geometry is covered, while Tiptap text and structured
  image/group transactions still lack one shared user-visible boundary.
- The transaction stream is descriptive only. It does not yet provide enough
  before/after data for undo, recovery, asset pruning, or canonical save.
- Legacy Canvas object/asset identity coupling and separate engine histories,
  autosave timers, and recovery paths remain migration risks.
- A future mixed-page compositor still needs explicit pointer ownership,
  cross-engine focus, z-order, coordinate conversion, export parity, and
  WebKitGTK coverage.

## Rollback path

Revert the focused Phase 1D commit. The existing Phase 1C commands continue to
delegate directly to the legacy stores, and the existing Canvas/Document event
handlers remain functional because the added callbacks are optional. No schema,
project file, IndexedDB record, migration, or data repair is required to roll
back. The Phase 1C unified session and asset/mutation contracts remain intact.

## Recommended next slice

The next safe slice is an opt-in, read-only consumer that derives one
diagnostic project revision/change view from the completed coordinator stream,
starting only with page mutations and the two committed geometry events above.
It should compare the stream with existing legacy dirty/revision observations
without becoming the dirty/autosave writer. Once that contract is covered by
legacy save/reopen and recovery round trips, shared dirty/change coordination
can begin without replacing either engine's history or persistence writer.
