# Unified editor Phase 1 implementation

Status: implemented in the focused Phase 1 seam commit.

## What changed

Design Space now has one App-level editor route, `UnifiedEditorSession`, for
both legacy project families. The route mounts the existing renderer through a
typed adapter selected by the compatibility `editorMode` discriminator:

```text
App
  -> ProjectDashboard / project-open inspection
  -> UnifiedEditorSession
     -> PageViewport
        -> CanvasLegacyRendererAdapter -> EditorShell -> Fabric
        -> DocumentLegacyRendererAdapter -> DocumentEditorShell -> Tiptap/layout kernel
```

This is a product/session seam, not an engine merge. Canvas and Document still
own their current rendering, mutation, persistence, history, and export paths.

## Shared interfaces

`src/editor/session/projectSession.ts` defines the engine-neutral read-only
boundary:

- `ProjectSessionDescriptor` and `ProjectPageDescriptor` identify the project,
  compatibility source, page order, active page, renderer kind, capabilities,
  and normalized display page size.
- `PageSizeDescriptor` records both legacy source dimensions and their display
  representation, plus the explicit coordinate space.
- `PageViewport` records active page, renderer kind, page size, transient zoom,
  measured viewport dimensions, mount state, and an explicit
  `outside-legacy-renderer` editor-chrome boundary.
- `SelectionEvent` reports only high-level targets (`structured-text`,
  `structured-image`, `structured-group`, `freeform-object`, `page`, or
  `none`). It contains no Fabric, ProseMirror, Tiptap, DOM, or live engine
  object.
- `ProjectSessionCommands` exposes save, download, notification, dirty-state,
  page selection, and viewport-zoom delegation without changing ownership of
  those operations.

`src/editor/session/PageViewport.tsx` is the common viewport boundary. It
reports page/display metadata and transient measurements; it intentionally does
not apply a second renderer transform.

## Compatibility adapters

`src/editor/session/legacyRendererAdapters.tsx` adapts the current stores and
shells without translating their authored records.

Canvas adaptation reads `editorStore.pages` and preserves their logical Canvas
pixel dimensions. It converts those dimensions to display CSS pixels only at
the seam using the existing product/output DPI (with the legacy 300 DPI
fallback). Canvas zoom delegates to `zoomToCenter`; page selection, save,
download, dirty state, and notifications delegate to `editorStore`.

Document adaptation reads `documentStore.project`. Physical page inches become
96-CSS-pixel display dimensions, while the page's output DPI remains separate.
Document zoom, page selection, save, download, dirty state, and notifications
delegate to `documentStore`.

`projectOpenService` now attaches a descriptor to pre-mount inspection results.
The dashboard passes that descriptor into the unified route while continuing to
hydrate/load the existing mode-specific store. This keeps inspection before
mount and retains the Canvas initialization ordering needed by its current
lifecycle.

## State, selection, and zoom boundaries

`useProjectSessionStore` now holds the transient session snapshot, viewport
observation, selection envelope, and delegated commands. It is not a new
persistence source. The Canvas and Document stores remain authoritative for
all writes, autosave, recovery, and histories.

The adapters translate native selection observations into the shared event
envelope. Document text focus reports structured text; existing Document image
and group state reports structured image/group; Canvas layer/object selection
reports freeform object selection. Native selection, text focus, Escape
handling, and engine keyboard guards remain in their existing shells. There is
no mixed-engine selection or persisted selection state.

Zoom remains transient. The shared viewport records the current product-level
zoom and the adapter delegates it to each engine's existing zoom mechanism.
No authored coordinate is rewritten, no Canvas DPI number is divided inside a
renderer, and export dimensions are not derived from viewport zoom.

## Deliberately not migrated

This slice does not introduce a unified page schema, mixed structured/freeform
page writes, a canonical asset service, shared undo/redo, a mixed-layer export
compositor, cross-engine wrapping exclusions, or a new save/autosave system.
It does not migrate Canvas coordinates, change a schema version, delete either
legacy shell, remove `editorMode`, rewrite Fabric/Tiptap serialization, or
change browser/Tauri export implementations. Reference scans and editor chrome
remain on their current Document/Canvas paths and are not routed into export.

Page navigation controls and detailed toolbars remain inside the legacy shells;
the shared command boundary is ready for later common navigation without
forcing a premature mutation abstraction.

## Verification

The focused suite covers the shared geometry/zoom/selection contract, both
legacy adapters, pre-mount Canvas/Document inspection, and existing Canvas and
Document integration behavior:

- `npx vitest run __tests__/project-session.test.ts __tests__/unified-editor-session.test.ts __tests__/project-schema.test.ts __tests__/editor-store-integration.test.ts __tests__/document-editor.test.ts`
- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
- `npm test`
- `DESIGN_SPACE_E2E_PORT=5189 npx playwright test e2e/product-studio-ui-smoke.spec.ts e2e/document-reconstruction.spec.ts`

Results: the focused seam run passed 5 test files / 165 tests; the full unit
and integration run passed 41 test files / 436 tests; TypeScript, lint, and
the production Vite build passed. The Canvas and Document browser smoke paths
passed 9 tests, including the blank-document reconstruction, persistence, and
export flows. Existing project-file schemas, save/autosave implementations,
recovery metadata, and export services are unchanged.

## Rollback and follow-ups

The rollback boundary is the focused Phase 1 commit: reverting it restores the
previous App mode branch while leaving all existing persisted formats and
engine stores intact. No data migration is needed to roll back.

Phase 2 should consolidate shared lifecycle/navigation observation and make the
session descriptor authoritative for common shell chrome while keeping legacy
writes delegated. Phase 3 can evaluate a mixed page compositor, shared
selection/focus controller, cross-layer z-order, and explicit structured-flow
exclusion bridges. Those phases must first resolve the remaining risks around
Fabric/Tiptap pointer ownership, mixed-layer export parity, and common history
transactions.
