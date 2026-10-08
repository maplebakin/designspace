# State-boundary contracts

Status: current verified browser/app contract. Native/WebKitGTK acceptance is
a separate milestone and is not implied by the guarantees below.

This document describes the small set of state boundaries that the current
editor architecture relies on. Canvas/Fabric and Document/Tiptap retain their
engine-specific ownership; these contracts make the handoff between runtime,
authored state, persistence, and export explicit without replacing either
engine.

## Current verified guarantees

### Scene representations

The following representations are intentionally distinct:

| Representation | Owner and allowed use |
| --- | --- |
| `LiveRuntimeScene` | A live Fabric canvas for the active session/page. Runtime methods and selection ownership stay here. |
| `CanonicalSerializedScene` | Plain JSON produced by the existing `serializeCanvasObjects` adapter. Objects are page-space data, not Fabric instances. |
| `PageSceneSnapshot` | A page-space scene plus authoritative logical page dimensions and page identity. |
| `DurableSceneSnapshot` | Project/session/authored-revision identity, page snapshots, and portable asset sources for a durable canvas payload. |
| `TemplateSceneSnapshot` | A portable scene plus its portable asset bundle for templates and Vision Board design states. |
| `ExportSceneSnapshot` | An ephemeral canvas export input. It may retain a session URL while the renderer reads it, but it is never a durable save acknowledgement. |
| `DocumentExportSceneSnapshot` | A frozen normalized `DocumentProjectPayload` and ordered page IDs for the DOM/Tiptap export renderer. |

`src/editor/scene/sceneSnapshot.ts` is the single validation/adaptation
boundary. Existing Fabric revival remains in
`normalizeSerializedObjectForFabric` and `loadCanvasFromJsonSafely`; no second
serializer or direct live-object persistence path is part of the contract.
Portable boundaries reject `blob:` resources, malformed nested objects, live
Fabric methods, non-page-space coordinate declarations, invalid dimensions,
and non-string asset entries. Authored page/template adapters normalize page
dimensions and background into the scene snapshot before a loader or exporter
sees them.

### Page size, background, and export ownership

Canvas page geometry has one authored runtime owner and typed durable mirrors:

* `useCanvasStore` owns the active Fabric page's logical width and height. It
  does not own viewport CSS dimensions or a second durable page record.
* `ProjectPage.canvasSize` and `PageSceneSnapshot.canvasSize` are the durable
  page dimensions. History checkpoints carry the same page dimensions and
  replay them atomically with page content.
* Current-page persistence and export capture the active Fabric page geometry
  once and hand the result to the typed snapshot. All-page export adapts each
  durable `ProjectPage` mirror; it does not read the active runtime size store.
* `unitMode` and product page-size DPI are the authored conversion inputs.
  `resolveCanvasSourceDpi` supplies 96 DPI for pixel documents and 300 DPI for
  print units when no positive declared DPI exists. Physical export dimensions
  are calculated from the snapshot's page pixels and source DPI.

`useThemeStore.canvasBackgroundColor` owns authored canvas background state.
The Fabric paper rectangle and `canvas.backgroundColor` are renderer
projections: the paper is visible workspace decoration and the Fabric canvas
background is transparent while the paper is rendered. Page JSON/history
snapshots receive the authored background at the same capture boundary, and
all-page export prefers each page snapshot's background. A missing legacy page
background uses the explicit default rather than the active page's mutable
background.

`AdvancedExportManager` remains the canonical Fabric canvas export path.
`DocumentProjectExportRenderer` and `DocumentExportService` intentionally use
the document DOM/Tiptap renderer. Both receive frozen typed authored snapshots
and return explicit file-delivery results; using one renderer for both editor
engines is not a contract requirement.

### Authored revisions and history

`src/editor/session/authoredRevision.ts` defines the common vocabulary: session
identity, project identity, page identity, sequence, draft/committed phase, and
source. A repeated live draft update does not advance the committed sequence;
the commit does. Project replacement starts a new identity/baseline. Undo and
Redo are authored events when they change the user-visible engine state, while
their replay internals remain silent to the observation stream.

The Canvas `changeRevision` and Document `revision` clocks remain
engine-specific persistence fences. The shared lifecycle authority has its own
`shared-authored` sequence and compares it only with the matching session and
project identity. They are not interchangeable counters. The Document
authored-action journal remains the chronological document Undo/Redo owner;
Canvas `useHistoryStore` remains the Canvas history owner.

Live text draft state is not treated as a committed durable revision until its
commit boundary. A save captures both the numeric fence and the structured
authored revision; a late completion cannot install an older snapshot into a
newer session or divergent branch.

### Persistence acknowledgements

`src/editor/session/persistenceAcknowledgement.ts` is the discriminated result
boundary for persistence and file delivery. Its statuses distinguish:

* `initiated` and `target-allocated`;
* `durable-write-committed`;
* `stale-completion-rejected` and `conflict-detected`;
* `browser-download-initiated`;
* `native-save-confirmed`;
* `save-failed` and `save-cancelled`.

Each acknowledgement carries operation, revision domain, session, project,
target, captured revision, authored revision, and snapshot context. Only a
confirmed durable acknowledgement can set `canClearDirty`; stale, conflicted,
failed, cancelled, and browser-initiated delivery cannot. Browser link
activation is deliberately not reported as durable filesystem persistence.
The existing boolean renderer adapters remain compatibility bridges, while
routed save/close/navigation callers use the acknowledgement predicate before
clearing dirty state or leaving the project.

### Interaction modes and lifecycle observation

`src/editor/session/interactionMode.ts` models the valid temporary ownership
states: canvas editing, document idle, text editing, photo manipulation,
overlay manipulation, reference adjustment, and modal interaction. Each mode
declares its input surface, keyboard scope, selection authority, Escape action,
and session/page identity. Fabric and ProseMirror continue to own their native
selection objects; the mode is the product-level routing contract around them.

The routed unified session owns one `ProjectChangeCoordinator` and one shared
lifecycle authority. Its Canvas/Document adapters are required to deliver
committed observations. Standalone legacy mounts may omit the seam as an
explicit compatibility case. If a required coordinator delivery is rejected,
disposed, or throws, the adapter returns a discriminated non-delivery result
and logs it at the lifecycle boundary. The optional diagnostic shadow model is
not used to infer dirty state or persistence.

Session, project, and page transitions clear the mode and invalidate pending
work through the existing lifecycle fences. This contract does not claim new
native pointer cancellation or accessibility behavior.

### Auxiliary persistence ownership

| Domain | Active owner | Explicit compatibility/session boundary |
| --- | --- | --- |
| Templates | `templateService` and `DesignSpaceDB.templates` | Legacy `designspace-editor.userTemplates` is read and migrated transactionally; old `witchclick_assets_db.templates` rows remain recovery-readable and are no longer written. |
| Brand Vault | Persisted `designspace-theme` Zustand state | Old `witchclick_assets_db.brand_vault` rows remain compatibility/recovery-readable and are no longer mirror-written. |
| Brand Kit | `DesignSpaceDB.brandKit` through the `useThemeStore` Brand Kit actions | Existing schema/migration readers remain in place. |
| Palette vault and recent colours | Persisted `designspace-theme` state | These are theme preferences, not Brand Vault rows or project assets. |
| Vision Board | Bounded `designspace-vision-board` state for board items and board size | View/selection state is session-only. Design-state items carry a portable scene/asset bundle. Image items with `blob:` source or thumbnail are filtered from the persisted projection; historical storage is not deleted. |
| Uploaded sticker/inserter collection | `useEditorStore.assets` in the mounted editor session | It is session-only. Inserted artwork becomes a project-owned image asset; the UI calls these Session Assets and does not promise a recoverable library. |
| `witchclick_assets_db` auxiliary stores | None as an active product source of truth | `src/editor/utils/indexedDb.ts` is a deprecated inspection/migration/recovery compatibility boundary. Existing rows are retained; no new production writes are expected. |

Auxiliary records are not automatically included in a project backup unless
their data is embedded in the portable scene/project snapshot. A project
image asset and a session-only sticker-board URL are different ownership
classes.

### Recovery and migration scope

Canonical project/document IndexedDB rows and their indexes remain intact for
the existing recovery workspace. Legacy template localStorage migration writes
the complete batch to Dexie in one transaction and removes volatile legacy
keys only after commit. The historical auxiliary database is not purged:
forensic duplicate rows, old template/brand/sticker rows, and recovery readers
remain available. Stopping duplicate writes is the cleanup boundary.

Python recovery validates and reconstructs the documented portable project and
document payloads; Rust validates the resulting recovery report and schema.
Neither recovery suite can recreate a browser session's `blob:` capability or
promise native filesystem/dialog acceptance.

## Explicit non-guarantees and native gaps

The browser/app contract does not claim:

* WebKitGTK/Tauri rendering, native save-dialog confirmation, native cancel,
  filesystem failure, or atomic native replacement acceptance;
* browser download completion after a link is activated;
* automatic backup/recovery of session-only sticker uploads or discarded blob
  URL capabilities;
* replacement of Fabric/ProseMirror native selection ownership;
* a shared history store for the two engines;
* D01/D02 accessibility completion or IME-specific native event ordering.

These are separate acceptance or future-work milestones, not reasons to
weaken the current browser contracts.

## Historical milestones versus current truth

The forensic audit and implementation phase documents remain useful evidence
of the problems that motivated these boundaries, but their counts, findings,
and “unstarted” language are historical. Current status is recorded in
`docs/audits/head-95d8d3a-verified-audit.md` and this document. In particular:

* P0 browser/app trust-gate evidence and P1 closure are complete for their
  stated scope;
* P2 Cluster 1 established the scene, authored-revision,
  acknowledgement, and interaction contracts;
* this P2 Cluster 2 pass reconciles page/background/export ownership, retires
  the dead single-span compositor, stops duplicate auxiliary writes, and
  makes lifecycle observation failures visible;
* native/platform acceptance remains pending by design.
