# Design Space — Orientation Briefing (WitchClick)

Generated: 2026-04-12

This document is a cold-start orientation for future LLM sessions working on the **Design Space** feature in this repository.

---

## 0) Scope and repository reality check

- `LLM_PROJECT_BRIEFING.md` was not present in this checkout.
- `LLM_PROJECT_CONTEXT.md` is present and was used as the style baseline.
- Requested paths were verified:
  - `src/pages`: missing
  - `src/components`: present (global app components live here)
  - `src/scripts`: missing
  - `src/lib`: missing
  - `dev-api.js`: missing
  - `tools/`: missing
  - `scripts/`: missing
- In this repo, Design Space is primarily implemented under `src/editor/`, with app entry wiring in `src/main.tsx` and `src/App.tsx`.

---

## 1) What Design Space is in this repo

Design Space is a React + Fabric.js canvas editor embedded as the main app experience. The implementation is split into:

- App shell and routing state (`src/App.tsx`)
- Editor UI composition (`src/editor/components/*`)
- Canvas lifecycle + event system (`src/editor/components/CanvasStage.tsx`, hooks/services)
- Central state orchestration (`src/editor/state/editorStore.ts`)
- Persistence (`src/editor/db.ts`, file import/export, autosave)
- Theme/palette systems (`useThemeStore`, import modals, Theme sidebar)
- Export pipeline (PNG/SVG/PDF)

---

## 2) Reconstructed user workflow (current behavior)

### A) Startup

1. App boots from `src/main.tsx` and renders `App`.
2. On localhost, prior service workers are unregistered in `main.tsx`.
3. `App` starts with `currentView = 'dashboard'`, but immediately auto-switches to editor if `projectName` exists.
4. Default store state sets `projectName = 'Untitled Project'`, so app effectively starts in editor in most cases.

### B) Editing session

1. `EditorShell` renders top toolbar + left workspace panel + canvas stage + right properties/layers panel + page strip + status bar.
2. `CanvasStage` initializes Fabric canvas through `useCanvasLifecycle`, then registers all canvas handlers through `canvasEventService`.
3. Object operations update store-backed serialized canvas state; layer sync writes Fabric render state from serialized state (`syncCanvasLayers`).
4. User edits through tools/panels: shapes, text, uploads (image/svg/pdf background), layouts, stickers, template browser, theme controls, properties.

### C) Save/load/export

1. File menu supports `Open File` and `Save Project` for `.apocaproject.json`.
2. Quick Open (`Cmd/Ctrl+K`) loads projects from IndexedDB.
3. Autosave updates an existing DB project if one with same name exists.
4. Export modal and `Cmd/Ctrl+E` are DEV-gated (not shown in non-DEV builds).

### D) Theme/palette flow

1. `BrandModal` imports theme JSON into brand vault.
2. `DesignSpaceImportModal` imports palette JSON and classifies colors.
3. `ThemeSidebar` applies palette colors to selection/brush and supports "Magic Match" from image dominant color.

---

## 3) Where the workflow breaks or dead-ends

1. Dashboard is effectively bypassed on startup.
- `App` switches to editor whenever `projectName` is truthy.
- Default `projectName` is already truthy (`Untitled Project`).

2. "Back to Projects" is effectively non-functional.
- `EditorShell` receives `onBackToDashboard` and shows a `Projects` button.
- Clicking it sets dashboard view, but `App` effect immediately flips back to editor because `projectName` remains truthy.

3. Dashboard open/load actions can no-op.
- `ProjectDashboard` calls `loadProject` / `loadProjectFile`.
- Both store loaders early-return when `canvas` is null.
- In dashboard mode, canvas is not yet mounted; open operations may not actually load data.

4. Export is hidden outside development.
- `ExportModal` returns `null` when `!import.meta.env.DEV`.
- `setShowExportModal` hard-forces false in non-DEV.
- `Cmd/Ctrl+E` shortcut is also blocked in non-DEV.

5. Minor compile-risk signal in `EditorShell`.
- JSX uses `<Search />` near quick-open button, but `Search` is not present in the visible icon import list in current file snapshot.

---

## 4) File orientation map

### 4.1 Entry, shell, and top-level flow

| File | What it does | What it exposes | Connects to | Placeholder/TODO/incomplete notes |
|---|---|---|---|---|
| `src/main.tsx` | React entrypoint; unregisters SW on localhost | Root render | `App` | No TODO markers |
| `src/App.tsx` | Chooses dashboard/editor view; registers sample plugin + offline snapshot writes | `<App />` | `ProjectDashboard`, `EditorShell`, store, theme store, offline manager | View-switch logic conflicts with default projectName |
| `src/editor/components/ProjectDashboard.tsx` | Landing dashboard (new/open/recent projects) | `<ProjectDashboard />` | `editorStore` load/create functions | Load/open depends on canvas being initialized elsewhere |
| `src/editor/components/EditorShell.tsx` | Main editor layout and modal orchestration | `<EditorShell />` | Canvas stage + all side panels/modals | Quick-open Search icon import likely incomplete |
| `src/editor/components/FileDropdown.tsx` | File menu actions | `<FileDropdown />` | project file load/save, presets, import modal | "Import to DesignSpace" imports palettes, not canvas/projects |
| `src/editor/components/ProjectBrowser.tsx` | Modal wrapper around dashboard from editor | `<ProjectBrowser />` | `ProjectDashboard` | Not used when `onBackToDashboard` prop is supplied (current app path) |
| `src/editor/components/ProjectQuickOpenModal.tsx` | Cmd/Ctrl+K quick-open DB projects | `<ProjectQuickOpenModal />` | `getAllProjects`, `loadProject` | Works only when canvas exists |
| `src/editor/components/ProjectPresetsModal.tsx` | Preset modal container | `<ProjectPresetsModal />` | `ProjectPresets` | No TODO markers |
| `src/editor/components/ProjectPresets.tsx` | New project preset chooser with clear-confirmation | `<ProjectPresets />` | `createProject`, `fitCanvasToViewport`, preset config | Presets require canvas to exist |

### 4.2 Core state, synchronization, and persistence

| File | What it does | What it exposes | Connects to | Placeholder/TODO/incomplete notes |
|---|---|---|---|---|
| `src/editor/state/editorStore.ts` | Primary orchestration store; tool actions, project lifecycle, persistence hooks | `useEditorStore`, actions/types | Fabric canvas, history store, canvas store, theme store, db | Export intentionally DEV-gated; several actions early-return when no canvas |
| `src/editor/state/useHistoryStore.ts` | Undo/redo snapshots + diff-based history + image asset ref counts | `useHistoryStore`, helpers for hydration/persistence | `editorStore`, Fabric serialization | No explicit TODO markers |
| `src/editor/state/layerSyncHandler.ts` | Reconciles serialized store objects with Fabric canvas objects | `syncCanvasLayers` | `editorStore`, z-index manifest, Fabric enliven | No TODO markers |
| `src/editor/state/useCanvasStore.ts` | Canonical document dimensions/pending size | `useCanvasStore` | `canvasUtils`, stage lifecycle | No TODO markers |
| `src/editor/db.ts` | Dexie schema + CRUD for projects/canvasData/templates/brandKit | `db` and types | `editorStore`, `templateService` | Save/update pattern is name/project-id based, no explicit conflicts handling |
| `src/editor/services/templateService.ts` | Template DB CRUD + migration from persisted localStorage payload | `saveTemplate/listTemplate/.../migrateFromLocalStorage` | `db`, App boot migration effect | No explicit TODO markers |

### 4.3 Canvas lifecycle and event system

| File | What it does | What it exposes | Connects to | Placeholder/TODO/incomplete notes |
|---|---|---|---|---|
| `src/editor/components/CanvasStage.tsx` | Fabric stage host, sync checks, onboarding size picker, safe zone overlays, DnD | `<CanvasStage />` | lifecycle hook, interaction hook, event service, layer sync, stores | Has circuit-breaker + sync error overlay; complex critical-path file |
| `src/editor/hooks/useCanvasLifecycle.ts` | Atomic canvas init/dispose sequence to avoid double init | `useCanvasLifecycle` | `editorStore`, theme store, Fabric | Defensive cleanup for StrictMode double-initialization |
| `src/editor/hooks/useCanvasStageInteractions.ts` | Drag/drop image handling + placeholder/frame replacement | `useCanvasStageInteractions` | `assetLoader`, canvas stage | No TODO markers |
| `src/editor/services/canvasEventService.ts` | Centralized Fabric event registration/cleanup | `registerAllCanvasEventHandlers` + helper registrars | canvas stage + smart guides/textbox services | No TODO markers |
| `src/editor/fabric/canvasUtils.ts` | Document-paper model, guides/bleed, resize/fit/zoom/rotate helpers | many exported utilities | canvas store, editor store, page border service | No TODO markers |
| `src/editor/fabric/guideRegistry.ts` | Guide object registry for safe filtering | singleton registry | `canvasUtils`, `CanvasStage` | No TODO markers |
| `src/editor/fabric/zIndexManifest.ts` | Canonical layer ordering for guides/content | z-index functions/enums | layer sync, factories, guides | No TODO markers |

### 4.4 Editing UI, insertions, and object tooling

| File | What it does | What it exposes | Connects to | Placeholder/TODO/incomplete notes |
|---|---|---|---|---|
| `src/editor/components/Inserter.tsx` | Design/sticker/template tabs; uploads incl. PDF background | `<Inserter />` | object factories, asset loader, TemplateBrowser, `pdfUtils` | No TODO markers |
| `src/editor/components/ShapesPanel.tsx` | Shape insertion panel | `<ShapesPanel />` | object factories/store | No TODO markers |
| `src/editor/components/MaskFrame.tsx` | Frame placeholder insertion UI | `<MaskFrame />` | frame factories/object factories | No TODO markers |
| `src/editor/components/AssetLibrary.tsx` | Static built-in assets panel | `<AssetLibrary />` | Fabric object creation + store | Uses hardcoded assets data |
| `src/editor/components/StickerTab.tsx` | Sticker search/insert tab | `<StickerTab />` | store asset library | No TODO markers |
| `src/editor/components/SelectionToolbar.tsx` | On-canvas selection quick actions | `<SelectionToolbar />` | editor store actions | No TODO markers |
| `src/editor/components/LayersPanel.tsx` | Layer ordering, visibility, lock controls | `<LayersPanel />` | layer state/store actions | No TODO markers |
| `src/editor/components/PropertiesPanel.tsx` | Object/canvas properties; image adjustment sliders; theme sidebar embed | `<PropertiesPanel />` | store actions + `ThemeSidebar` | Vision palette appears only if colors were fed into theme vision palette |
| `src/editor/components/ThemeSidebar.tsx` | Palette + token linking + apocapalette import + magic match | `<ThemeSidebar />` | theme store + editor store + color utilities | No explicit TODO markers |
| `src/editor/fabric/objectFactories.ts` | Primitive/object insertion helpers incl. placeholders/layouts | exported factory functions | inserter + keyboard shortcuts + editor shell | Placeholder objects are feature-level placeholders (intentional) |
| `src/editor/fabric/frameFactories.ts` | Circle/hex/star/badge frame creation | factory functions | MaskFrame/interactions | No TODO markers |

### 4.5 Import/export and PDF path

| File | What it does | What it exposes | Connects to | Placeholder/TODO/incomplete notes |
|---|---|---|---|---|
| `src/editor/components/DesignSpaceImportModal.tsx` | Multi-file palette import UX | `<DesignSpaceImportModal />` | `designSpaceImporter`, theme store | "DesignSpace import" is palette-only |
| `src/editor/services/designSpaceImporter.ts` | Parses JSON color structures and categorizes semantic buckets | `importThemeFromFile` etc. | import modal | RGB/HSL parsing helpers are commented out |
| `src/editor/components/ExportModal.tsx` | Export UI for PNG/SVG/PDF | `<ExportModal />` | `advancedExportManager` | Hard blocked in non-DEV builds |
| `src/editor/export/advancedExportManager.ts` | Unified PNG/SVG/PDF export manager | class singleton | render/svg utils + jsPDF + plugin hooks | Active path for export modal |
| `src/editor/fabric/exportCanvas.ts` | Alternate canvas export pipeline (clone canvas objects) | `exportCanvas`, `downloadExportedCanvas` | store export action path | Used by `editorStore.exportCanvas` |
| `src/editor/fabric/exportUtils.ts` | Low-level download helpers for svg/png/jpeg/pdf | export helper funcs | `editorStore.exportCanvas` | Legacy-style direct download helpers |
| `src/editor/services/exportService.ts` | Validation-heavy export service with typed result objects | validation/export helpers | not main modal path | Appears underused relative to advanced manager |
| `src/editor/fabric/pdfUtils.ts` | Imports PDF first page as canvas background image | `loadPdfAsBackground` | Inserter uploads tab | PDF import path is active |
| `src/types/pdfjs-worker.d.ts` | Type declaration for bundled pdf worker URL import | module declaration | `pdfUtils.ts` | No TODO markers |

### 4.6 Theme/brand/settings and preset systems

| File | What it does | What it exposes | Connects to | Placeholder/TODO/incomplete notes |
|---|---|---|---|---|
| `src/editor/state/useThemeStore.ts` | Theme vault, palette vault, brush/background, recent/vision palette state | `useThemeStore` + helpers/hooks | editor store, UI theme store | Vision palette requires external feeder (vision board store path) |
| `src/editor/components/BrandModal.tsx` | Theme vault import/activate UI | `<BrandModal />` | `validateThemeFile`, theme/editor store | Active in EditorShell style tab |
| `src/editor/components/SettingsModal.tsx` | UI skin presets + theme JSON import | `<SettingsModal />` | `useUiThemeStore` | Active in EditorShell style tab |
| `src/editor/config/canvasPresets.ts` | Single source of truth for canvas preset groups | preset constants/builders | dashboard, settings popover, project presets | Good centralization |
| `src/editor/components/CanvasSettingsPopover.tsx` | Header popover for resize/background/guides | `<CanvasSettingsPopover />` | canvas utils + presets + store | Includes safer resize-choice modal |
| `src/editor/components/CanvasSettingsPanel.tsx` | Overlay panel for unit/safe-zone toggles | `<CanvasSettingsPanel />` | CanvasStageOverlays | Partially overlaps with other settings surfaces |
| `src/editor/components/PageBorderPopover.tsx` | Border style UI controls | `<PageBorderPopover />` | page border service | Active in style tab |
| `src/editor/services/pageBorderService.ts` | Creates/removes/refits decorative border group | border service fns | popover + canvas resize refit | No TODO markers |

### 4.7 Runtime extension/offline/collab modules

| File | What it does | What it exposes | Connects to | Placeholder/TODO/incomplete notes |
|---|---|---|---|---|
| `src/components/NetworkStatusIndicator.tsx` | Offline/slow network badge + restore snapshot button | `<NetworkStatusIndicator />` | `useNetworkStatus`, lightweight offline manager | Restore writes directly to canvasObjects/projectName store fields |
| `src/hooks/useNetworkStatus.ts` | Network quality hook and offline queue helper | hooks | NetworkStatusIndicator | No TODO markers |
| `src/editor/offline/pwaOfflineManager.ts` | Lightweight idb snapshot save/load + SW registration | singleton manager | `App`, NetworkStatusIndicator | Active offline path in current app |
| `sw.js` | Service worker install/fetch/sync scaffolding | SW script | offline manager registration | Contains "real implementation" comments for sync |
| `src/editor/utils/pwaOfflineSupport.ts` | Larger offline engine (projects/assets/sync queue) | singleton class | no active runtime imports found | Multiple "In a real implementation..." markers |
| `src/editor/collaboration/collaborativeEditingManager.ts` | Lightweight local collab state broadcaster | singleton manager | no active runtime imports found | No backend wiring |
| `src/editor/utils/collaborativeEditing.ts` | CRDT/collab scaffold with operation hooks | singleton + helpers | no active runtime imports found | Multiple stub/"real implementation" markers |
| `src/editor/utils/pluginArchitecture.ts` | Plugin API + hook bus (`onObjectAdded/onExport/onThemeChange`) | plugin manager/context/types | App + advanced export + object-add flow | Active but minimal |
| `src/editor/plugins/samplePlugin.ts` | Demo plugin that toasts/logs hook events | sample plugin | registered in `App.tsx` | Example only |
| `src/config.ts` | Config keys for collaboration + template marketplace APIs | `appConfig` | marketplace/collab scaffolds | API URLs defined but not actively consumed by runtime UI |

### 4.8 Template/marketplace/vision-board adjacent modules

| File | What it does | What it exposes | Connects to | Placeholder/TODO/incomplete notes |
|---|---|---|---|---|
| `src/editor/components/TemplateBrowser.tsx` | Community + saved template browser and saver | `<TemplateBrowser />` | template service + editor store | Community templates include placeholder theme IDs |
| `src/editor/utils/templateMarketplace.ts` | Marketplace class with featured/search/install/upload APIs | singleton + converters | no active runtime imports found | Extensive mock data + "real implementation" comments |
| `src/editor/utils/templateMarketplaceApi.ts` | Marketplace endpoint constant | API object | no active runtime imports found | Thin config only |
| `src/editor/components/VisionBoard.tsx` | Mood-board style workspace with pinned design states/colors | `<VisionBoard />` | visionBoardStore + editor store | No active render path found in current UI |
| `src/editor/state/visionBoardStore.ts` | Vision board item model + color extraction + selection/zoom/pan state | store/hooks | VisionBoard | Actively feeds `useThemeStore.addToVisionPalette` when used |
| `src/editor/state/useAssetStore.ts` | Alternate asset + vision-board item store | store/actions | no active runtime imports found | Appears superseded by visionBoardStore/editorStore |
| `src/editor/components/BoardItem.tsx` | Draggable/resizable board card used by VisionBoard | `<BoardItem />` | VisionBoard | Inactive unless VisionBoard is wired |
| `src/editor/components/SidebarBlueprints.tsx` | Sidebar blueprint UI | `<SidebarBlueprints />` | no active runtime imports found | Unsurfaced |
| `src/editor/services/CanvasFilterService.ts` | Image filter utility wrappers | filter functions | no active runtime imports found | Unsurfaced utility |
| `src/editor/services/GradientService.ts` | Gradient utility service | gradient helpers | no active runtime imports found | Unsurfaced utility |

### 4.9 Related validation/tooling files

| File | What it does | What it exposes | Connects to | Placeholder/TODO/incomplete notes |
|---|---|---|---|---|
| `src/utils/validateFunctionalityWarnings.ts` | DEV-only string-based code checks for guides/alignment/z-index | warning getter | `App.tsx` DEV warning toast | Validation by source-string heuristics |
| `validate-functionality.js` | Node script that scans source for expected guide/alignment patterns | script | manual/CI usage | Summary text suggests audit script rather than runtime behavior |
| `vite.config.ts` | Vite config + vendor chunking (incl. PDF libs) | build config | build/runtime | PDF libs intentionally split into `vendor-pdf` |

---

## 5) Built but not clearly surfaced (or weakly surfaced)

1. IndexedDB project save path exists but primary visible "Save Project" UX is file download.
- `saveProject(name)` exists in store but no obvious direct menu trigger in current top-level UI.
- Autosave updates DB entry by matching name if one exists.

2. Production export is functionally disabled despite implemented export stack.
- Multiple export implementations exist (`advancedExportManager`, `exportCanvas`, `exportUtils`, `exportService`), but UI access is DEV-only.

3. Vision Board stack is implemented but not mounted in primary editor flow.
- `VisionBoard.tsx`, `visionBoardStore.ts`, and `BoardItem.tsx` exist.

4. Marketplace stack exists but appears detached.
- `templateMarketplace.ts` and `templateMarketplaceApi.ts` have no active runtime import path.

5. Secondary/legacy systems exist in parallel.
- `utils/pwaOfflineSupport.ts` (large) vs active lightweight `offline/pwaOfflineManager.ts`.
- `useAssetStore.ts` vs `visionBoardStore.ts` + editor store asset handling.

6. `ProjectBrowser` modal pathway is currently bypassed in normal app composition.
- `EditorShell` falls back to `ProjectBrowser` only when `onBackToDashboard` is absent.

---

## 6) Planned but not implemented (explicit signals)

1. Collaboration backend integration.
- `utils/collaborativeEditing.ts` contains repeated "In a real implementation" comments for websocket/awareness sync.

2. Marketplace API integration.
- `utils/templateMarketplace.ts` uses mock assets and placeholder network behavior.

3. Full offline sync pipeline.
- `utils/pwaOfflineSupport.ts` and `sw.js` include "real implementation" comments for server sync behavior.

4. Marketplace/collab endpoint config usage.
- `src/config.ts` defines API URLs; active runtime integration is minimal or absent.

---

## 7) Key engineering risks for future LLM edits

1. Behavior drift between multiple parallel paths.
- Save/load/export/offline all have overlapping implementations.

2. Initialization assumptions around canvas availability.
- Many store actions no-op when canvas is null; dashboard-driven flows are sensitive to mount order.

3. Store/canvas dual-source complexity.
- Serialized `canvasObjects` are intended source-of-truth while Fabric is render delegate.
- `syncCanvasLayers`/event handlers/sync locks must remain consistent.

4. UI gating by environment.
- Export and validation warnings differ by `import.meta.env.DEV`.

---

## 8) Recommended read order for next LLM session

1. `src/App.tsx`
2. `src/editor/state/editorStore.ts`
3. `src/editor/components/EditorShell.tsx`
4. `src/editor/components/CanvasStage.tsx`
5. `src/editor/hooks/useCanvasLifecycle.ts`
6. `src/editor/services/canvasEventService.ts`
7. `src/editor/state/layerSyncHandler.ts`
8. `src/editor/fabric/canvasUtils.ts`
9. `src/editor/db.ts`
10. `src/editor/components/FileDropdown.tsx` + `ProjectDashboard.tsx` + `ProjectQuickOpenModal.tsx`
11. `src/editor/components/Inserter.tsx` + `TemplateBrowser.tsx` + `DesignSpaceImportModal.tsx`
12. `src/editor/components/ExportModal.tsx` + `src/editor/export/advancedExportManager.ts`

---

## 9) Practical notes for future contributors

- Treat `src/editor/` as the feature boundary for Design Space in this repo.
- Verify canvas availability assumptions before wiring dashboard/load flows.
- If making save/export changes, decide intentionally whether the canonical path is file-based, DB-based, or both.
- Preserve sync lock/layer sync patterns unless intentionally refactoring end-to-end.
- If re-enabling production export, remove all DEV-only gating points together (modal render, shortcut, store setter).

