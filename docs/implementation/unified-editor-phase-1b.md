# Unified Editor Phase 1b

## Scope

Phase 1b moves product-level lifecycle observation and common chrome above the
existing Canvas and Document engines. It does not merge the engines, introduce
mixed-layer authoring, or change a persisted project format.

The resulting route is:

```text
App application routing
  -> UnifiedEditorSession
    -> UnifiedEditorShell (shared product chrome/lifecycle/navigation)
      -> PageViewport (shared viewport boundary)
        -> Canvas legacy adapter -> existing EditorShell/Fabric path
        -> Document legacy adapter -> existing DocumentEditorShell/Tiptap path
```

`editorMode` remains an internal compatibility/open discriminator. New shared
chrome consumes the renderer/session capability exposed by the adapter rather
than presenting Canvas and Document as two product creation modes.

## Responsibilities moved into shared ownership

`UnifiedEditorShell` now owns the common product surface for an active session:

- project identity and rename entry point;
- normalized save status (`saved`, `unsaved`, `saving`, `error`);
- Save, File/Save to Library, Download Project, and return-to-projects actions;
- browser `beforeunload` protection;
- Tauri close-request protection and save/discard handling;
- dirty return-to-dashboard guard and existing unsaved-navigation dialog;
- shared page navigation and page-level action presentation;
- shared transient zoom controls and Fit page entry point;
- narrow-screen recovery/download notice.

`App.tsx` now handles application startup, dashboard/editor routing, plugin
startup, and compatibility dispatch. It no longer owns the active project's
dirty/save observation, close listeners, save/download delegation, or guard
modals.

The common shell deliberately does not own mutation state. Every command below
delegates to the active legacy adapter, which delegates to the existing store.

## Final shared contracts

`src/editor/session/projectSession.ts` remains the engine-neutral contract
boundary. Phase 1b adds:

- `ProjectSessionSnapshot.canSave` and `canClose` lifecycle observations;
- `ProjectPageDescriptor.folio` as a read-only product-facing page number;
- optional document folio input during descriptor creation;
- `ProjectSessionCommands.renameProject`;
- optional product-level `ProjectSessionCommands.close`, supplied by the routed
  `UnifiedEditorSession` rather than fabricated inside an engine adapter;
- delegated page commands: `addPage`, `duplicatePage`, `removePage`, and
  `reorderPage`;
- `ProjectSessionCommands.fitPage` for adapters that can provide fit directly.

The page command methods are optional where the current engine does not support
the operation. Canvas currently has no native duplicate-page operation, so its
shared UI does not fabricate one. No command type contains a Fabric object,
Fabric canvas, Tiptap editor, ProseMirror view, DOM node, or live engine
reference.

`src/editor/state/projectSessionStore.ts` remains transient Zustand state. It
stores the descriptor/snapshot, viewport, selection envelope, and delegated
command functions only; it does not become a persistence source of truth.

## Canvas compatibility adapter

`src/editor/session/legacyRendererAdapters.tsx` maps shared commands to the
existing `useEditorStore` operations:

- save/download/dirty/rename delegate to the Canvas store;
- page selection/add/remove/reorder delegate to existing Canvas page methods;
- zoom delegates to `zoomToCenter`;
- fit delegates to `resetViewCanvas`;
- selection continues to be translated from existing Fabric selection state
  into the Phase 1 high-level selection envelope.

`EditorShell` accepts `useSharedChrome`. In that mode its legacy project
identity, save, return, page navigation, page strip, and zoom controls are
suppressed while Fabric tools, product panels, Canvas settings, contextual
export, shortcuts, status information, and existing modals remain engine-owned.
The default remains unchanged for direct/legacy shell consumers.

The common shell preserves the existing Canvas page-strip geometry at the
bottom of the workbench and keeps the legacy Canvas stage's authored-coordinate
fit calculations intact. Its page navigation is a normalized read/command
surface, not a second Canvas page model.

## Document compatibility adapter

The Document adapter maps shared commands to the existing `useDocumentStore`
operations:

- save/download/dirty/rename delegate to the Document store;
- page selection/add/duplicate/remove/reorder delegate to Document page
  mutations;
- zoom delegates to `setZoom`;
- Fit page is registered from the existing `DocumentEditorShell` fit callback,
  preserving its workspace measurement and page geometry calculation.

`DocumentEditorShell` accepts `useSharedChrome`. Its legacy top bar remains as
a contextual export/print surface, but shared identity/save/file/back controls,
page navigation, and zoom are hidden in unified mode. Structured text, named
styles, image/group editing, references, folios, Tiptap history, and Document
layout remain owned by the existing shell/store.

The normalized descriptor carries the current starting folio as a display
number for shared tabs. It is derived from the loaded Document payload and is
not written back as a new field.

## Viewport and zoom boundary

`PageViewport` remains the shared read-only viewport boundary. It continues to
report page ID, renderer kind, page size, coordinate space, CSS display size,
viewport dimensions, and transient zoom.

No persisted Canvas coordinate is converted. Canvas source dimensions continue
to be adapted from legacy logical pixels/output DPI into display CSS pixels only
inside the Phase 1 boundary. Document page geometry continues to use its
existing 96-CSS-pixel page space. The shared zoom buttons call the adapter's
engine-specific zoom mechanism and never enter authored page data or export
geometry.

## Selection and focus boundary

Selection remains engine-native and transient. Canvas selection continues to
use Fabric/store selection; Document text/image/group selection continues to
use Tiptap/Document state. Adapters report only the existing high-level
`SelectionEvent` envelope to `useProjectSessionStore`.

Phase 1b does not implement mixed-engine selection, cross-engine focus
arbitration, shared undo/redo, or mixed-layer z-order. The shared shell only
routes common chrome and observes lifecycle/navigation context.

## Persistence, recovery, and export

No persisted schema, migration, IndexedDB layout, project-file envelope,
recovery validator, autosave debounce, history implementation, asset lifecycle,
or export renderer changed in this slice.

Canvas continues to save through the Canvas store and export through its native
Canvas path. Document continues to save through the Document store and export
through the committed Document browser/Tauri path. Reference scans and editor
chrome remain excluded from Document export; viewport zoom does not affect
export dimensions. The adapter command layer only delegates these operations.

## Tests and validation

Added focused contract coverage in:

- `__tests__/unified-editor-phase-1b.test.ts` — shared Canvas/Document chrome,
  delegated page commands, folio display, zoom, and dirty navigation guard;
- `__tests__/project-session.test.ts` — lifecycle fields and folio normalization;
- `__tests__/unified-editor-session.test.ts` — both adapters mount with shared
  chrome and expose delegated lifecycle/page commands.

Validation completed:

- `npm test` — 42 files, 440 tests passed;
- `npm run lint` — passed;
- `npx tsc --noEmit` — passed;
- `npm run build` — passed;
- Canvas browser smoke `e2e/editor-fabric.spec.ts` — 29 passed;
- Canvas product browser smoke `e2e/product-studio-ui-smoke.spec.ts` — passed;
- Document reconstruction browser suite
  `e2e/document-reconstruction.spec.ts` — 8 tests passed;
- combined Canvas product + Document reconstruction run — 9 passed.

The initial browser pass exposed shell-only layout/accessibility regressions:
the Canvas strip was below the legacy status bar, Document fit was rounded to
75% instead of above the existing threshold, and legacy Canvas File/narrow
recovery affordances were absent from unified chrome. These were corrected in
the shared shell/CSS boundary. No engine or persistence code was changed to
address them.

Tauri/Rust validation was not rerun because this slice does not touch Rust,
native delivery, or export implementation code; the browser coverage exercises
the same committed Document and Canvas command paths without changing them.

## Deliberately deferred work

The following remain future consolidation work:

- canonical shared mutation state and transaction/history coordination;
- a UnifiedPage or mixed structured/freeform persistence record;
- shared asset metadata/lifecycle and legacy Canvas asset convergence;
- Fabric/Tiptap mixed-layer mounting and z-order;
- freeform exclusion geometry affecting structured text flow;
- project-wide undo/redo and merged autosave/recovery ownership;
- one compositor for mixed Canvas/Document export;
- removal of legacy shells, compatibility dispatch, or duplicate engine
  controls;
- shared cross-engine selection/focus and accessibility coordination.

## Risks discovered

The largest Phase 1b risk is layout coupling: both legacy shells still assume
they own a full-height viewport. The shared shell now compensates with explicit
renderer flex/height boundaries and preserves the legacy Canvas strip/status
relationship. Any later shell extraction must retain these boundary tests.

The second risk is command capability asymmetry. Canvas does not currently
provide duplicate-page semantics, while Document does. Optional shared commands
are used instead of silently emulating or rewriting either engine's model.

The remaining mixed-page pointer/focus and z-order risks are intentionally not
addressed until a mixed-layer renderer exists.

## Rollback path

The Phase 1b change is one focused commit. Reverting it restores the Phase 1
`UnifiedEditorSession` wrapper and App-owned guard lifecycle while leaving the
Phase 1 contracts, adapters, and all persisted project formats intact. Direct
legacy shell consumers remain protected by `useSharedChrome={false}` defaults.

## Recommended next slice

The next safe slice is a contract-only mutation/result boundary for normalized
page actions and asset references, beginning with explicit command outcomes and
dirty/revision observation in each adapter. It should not introduce mixed-layer
writes or a new persistence schema; it should establish transaction boundaries
before any canonical shared mutation state or cross-engine history work.
