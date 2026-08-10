# Unified editor consolidation audit

**Audit date:** 2026-08-09
**Audited checkout:** `main` at `4791c54f` (`test(document): cover portable crop round-trips`)
**Scope:** architecture and redundancy only. No production code, schema, migration, or feature changes are part of this audit.

## 1. Executive verdict

Design Space should converge on **one project and one editor experience with multiple composition capabilities**. It should **not** converge by replacing Fabric with Tiptap, forcing arbitrary visual objects into document nodes, or making one rendering engine responsible for every object.

The repository already has the beginnings of a shared product boundary:

- `src/editor/project/projectSchema.ts` defines a versioned project envelope, shared product metadata, assets, themes, recipes, export settings, and recovery metadata.
- `src/editor/db.ts` stores both kinds of project payload in the same IndexedDB project/`canvasData` records, with bounded payload and recovery safeguards.
- `src/editor/project/projectOpenService.ts` can inspect a portable or library project before mounting an editor and detect its mode.
- `src/editor/services/fileDeliveryService.ts` is already shared by browser and Tauri save paths.
- Recent Document work has durable page-level image groups, crop/focal state, reference records, flow controls, a shared layout kernel, and browser/Tauri round-trip tests.

The current product boundary is nevertheless still an application fork. `src/App.tsx` stores a session-level `editorMode`, waits for a Fabric canvas for Canvas projects, and renders either `EditorShell` or `DocumentEditorShell`. The two shells then select different Zustand stores, page models, page navigators, selection systems, geometry/zoom systems, dirty/autosave lifecycles, histories, and export orchestrators. The common envelope reduces file-format duplication, but it does not yet provide a common editing model.

### Recommendation

Adopt a **unified project session and page compositor** with optional structured and freeform layers on each page:

```text
Project session
  canonical project metadata/theme/assets/export/recovery/session state
  pages[]
    canonical page size/background/furniture
    structured layer (optional)
      Tiptap stories, columns, flow images, captions, exclusions
    freeform layer (optional)
      Fabric objects, shapes, text boxes, SVGs, stickers, transforms
    reference layer (editor-only, optional)
```

The future canonical model should use a new unified page record with optional composition records (schema option **C** below), while legacy Canvas and Document payloads remain loadable through import/compatibility adapters. A unified shell should own navigation, save state, selection coordination, shortcuts, page settings, insertion, layers, reference, theme, and export commands. Specialized layer adapters should continue to own Tiptap transactions/layout and Fabric object lifecycle.

The first implementation slice should be a **shared, read-only project/page session contract plus a unified page viewport/compositor seam**, initially capable of mounting the existing Document renderer and the existing Fabric renderer as legacy layer adapters without changing either persisted format. This advances consolidation, tests the boundary, and keeps both current applications working.

## 2. Current architecture map

### 2.1 Application routing and lifecycle

`src/App.tsx` is the current application router:

1. `ProjectDashboard` opens or creates a project and determines `editorMode`.
2. `useProjectSessionStore` holds the active session discriminator (`canvas` or `document`) and active-session state.
3. Canvas projects render `EditorShell`; Document projects render `DocumentEditorShell`.
4. Before-unload, Tauri close, project naming, dirty guards, save, download, and close all branch on that mode.
5. Canvas-only plugin hooks are registered from the Canvas branch; Document projects do not enter that lifecycle.

This is a clean compatibility router, but it is not a shared editor session. The user-facing dashboard exposes the split directly as **Create Product** and **Create Document Project**, and opening a library/portable project chooses one shell before the project can be edited.

### 2.2 Canvas/Product domain

The primary code paths are:

- `src/editor/components/EditorShell.tsx`: Canvas toolbar, navigation, inserter, assets, layers, theme/Brand Kit, Product Starter, export, settings, and modal lifecycle.
- `src/editor/components/CanvasStage.tsx`: Fabric canvas mount, viewport resize/fit, editor-only guides/paper/safe zones, drawing/erase/textbox interaction, and Fabric lifecycle.
- `src/editor/hooks/useCanvasLifecycle.ts`: initialization/disposal sequencing, StrictMode protection, abort handling, and synchronization locks.
- `src/editor/services/canvasEventService.ts`: Fabric object add/remove/modify/text/selection/zoom/pan events and dirty/history synchronization.
- `src/editor/state/editorStore.ts`: the large Canvas application store. It owns the live Fabric instance, serialized objects, page list, current page, selection mirrors, assets, templates, theme-adjacent settings, dirty/autosave, and action methods.
- `src/editor/state/useCanvasStore.ts`, `src/editor/utils/coordinateSystem.ts`, and `src/editor/utils/units.ts`: Canvas logical dimensions, print/social presets, viewport zoom, and a 300-DPI-oriented unit system.
- `src/editor/fabric/*`: object factories, image/SVG/frame creation, grouping, alignment/distribution, z-order, smart guides, theme application, and Fabric-specific transforms.

The intended Canvas persistence source is `editorStore.canvasObjects`, with `pages[activePageIndex].canvasData` as the page payload. In practice, many commands still mutate the live Fabric canvas first and then serialize/synchronize it. `layersById` contains live Fabric references, while `canvasObjects` contains serialized records. The code has a `commitCanvasMutation` path, but the live instance and serialized store remain coupled during editing.

Canvas supports a broad freeform object vocabulary: shapes, lines, arbitrary Fabric text boxes/i-text, SVGs, stickers, image/frame clips, nested Fabric groups, arbitrary rotations/transforms, drawing, erasing, theme-linked fills, layers, and Product Starter recipes. `src/editor/fabric/smartGuides.ts` and `src/editor/fabric/alignment.ts` implement Canvas-local geometry against Canvas dimensions and nearby Fabric objects.

Canvas history is implemented by `src/editor/state/useHistoryStore.ts`. It stores bounded Fabric snapshots/diffs and image reference counts, restores Fabric, and resynchronizes layers. It is page-local and does not know about Tiptap, Document page metadata, Document image groups, references, or folios.

Canvas export is primarily `src/editor/export/advancedExportManager.ts`, called from `editorStore`, `ExportModal`, and Product Forge. It hydrates Fabric objects into an export canvas and emits PNG/JPEG/SVG/PDF artifacts. It is separate from Document’s committed DOM export.

### 2.3 Document domain

The current Document architecture is more explicit about persisted publishing semantics:

- `src/document/types/documentProject.ts`: `DocumentProjectPayload`, `DocumentPage`, `DocumentFlowImage`, `DocumentOverlayImage`, `DocumentImageGroup`, `ScanReference`, folio settings, page size/margins, columns, title/body content, crop/focal state, and stable image IDs.
- `src/document/state/documentStore.ts`: typed project hydration/normalization, page lifecycle, Tiptap JSON updates, image-group transactions, overlay/reference updates, asset lifecycle, dirty state, and autosave.
- `src/document/components/DocumentEditorShell.tsx`: Document toolbar/sidebar/page navigation, Tiptap editor refs, structured-image/group selection, reference controls, crop/caption controls, and export/print actions.
- `src/document/components/FlowEditor.tsx`: Tiptap/ProseMirror stories, named block/text styles, columns, flow images, sanitized paste, and flow controls.
- `src/document/components/DocumentPageView.tsx`: page-sized committed DOM compositor. It renders title/body, behind/front overlays, folios, and editor-only reference/selection chrome. Empty suppressed titles do not consume title space.
- `src/document/components/StructuredDocumentSpanLayout.tsx` and `src/document/layout/*`: shared page/body/viewport coordinate types, page geometry, column allocation, heading keep-with-next, keep-lines-together, column breaks, image groups, collision movement/resize, and snapping guides.
- `src/document/components/DocumentOverlayLayer.tsx`: page-origin unzoomed overlay geometry, pointer preview, commit-on-pointer-up behavior, crop rendering, collision blockers, and temporary guides.
- `src/document/components/DocumentProjectExportRenderer.tsx` and `src/document/services/documentExportService.ts`: committed browser PNG/PDF, Tauri/WebKitGTK capture, and print from the same committed DOM source.

Document persistence uses stable 96-CSS-pixel page/body coordinates. Zoom is a viewport concern; pointer previews are transient; final geometry is written only on commit. Document image groups remain page-level metadata and are not nested Tiptap group nodes. The recent crop/text-flow, group/reference, and portable round-trip work is therefore already close to a reusable structured composition layer.

Document history is not yet project-wide. Tiptap StarterKit undo/redo covers editor-local ProseMirror transactions, while page metadata, group metadata, overlay geometry, assets, references, and cross-page actions are committed by `documentStore` without a shared Document history stack.

### 2.4 Shared infrastructure that is real but incomplete

The following are shared today:

- versioned project normalization and compatibility detection in `projectSchema.ts`;
- the IndexedDB `projects`, `canvasData`, `brandKit`, `templates`, and recovery records in `db.ts`;
- bounded Zustand preference persistence and startup/recovery tooling;
- portable file inspection and native/browser file delivery;
- top-level project metadata, themes/recipes/export settings fields, and legacy asset envelopes.

The shared infrastructure is mostly an envelope and storage boundary. It does not yet canonicalize page composition, assets during editing, selection, history, coordinate space, or rendering.

## 3. Redundancy/capability matrix

The matrix records the current user-facing responsibility, implementation owners, and the recommended convergence boundary. “Current source of truth” means the data actually used to reopen/export the feature, not necessarily the intended store comment.

| Capability | Canvas/Product today | Document today | Current source/render/export evidence | Classification |
|---|---|---|---|---|
| Project creation | `ProjectDashboard` → `editorStore.createProject`/presets | Dashboard → `documentStore.createBlankProject` | Separate creation actions and mode selection in `App.tsx` | **DUPLICATED** |
| Project identity/metadata | Canvas store plus `ProductProjectFields` | Document payload plus shared product fields | Same project envelope/DB metadata, separate shell/store bindings | **SHARED** |
| Pages and navigation | `ProjectPage`, `PageStrip`, `ProductPageNavigator` | `DocumentPage`, `DocumentPageNavigation` | Separate page arrays, active-page actions, and navigators | **DUPLICATED** |
| Page sizing/presets | `canvasSize`, unit mode, `canvasPresets.ts`, 300-DPI print/social sizes | `DocumentPage.size`, paper presets, inches/DPI | Different page models and preset surfaces | **DUPLICATED** |
| Background/page appearance | Fabric canvas background and theme fill | DOM page sheet/theme styling | Different rendering and persistence conventions | **ADAPT** |
| Assets | `imageAssets`, `StickerData`, asset ref counts, Fabric hydration | top-level assets/metadata, `documentAssetService`, reachable-asset pruning | Same envelope field but different lifecycle and source resolution | **DUPLICATED** |
| Image import | Fabric image/SVG/PDF factories and `assetLoader` | Tiptap/overlay import through `documentStore`/document asset service | Same user action, different IDs/hydration/export handling | **ADAPT** |
| Image crop/frame behavior | Fabric clip paths, frame factories, image adjustments | persisted `cropMode`/focal model and DOM/Tauri object-fit rendering | Similar product need, incompatible current representations | **ADAPT** |
| Selection | Fabric active object/`selectedObjectId`/layer mirror | ProseMirror node selection plus transient image/group IDs | Separate pointer/event and focus ownership | **DUPLICATED** |
| Multi-selection | Fabric `ActiveSelection` | transient stable-ID multi-select for structured images | Both expose additive/group operations, with different semantics | **DUPLICATED** |
| Grouping | nested Fabric `Group` object graph | page-level `DocumentImageGroup` metadata over stable child IDs | Same command vocabulary but genuinely different group contracts | **RETAIN-SEPARATE-INTERNALLY** |
| Alignment/distribution | `fabric/alignment.ts` against Canvas bounds | layout-kernel align/distribute for page/body/group children | Common commands, engine-specific geometry | **ADAPT** |
| Snapping/guides | `fabric/smartGuides.ts`, grid and Fabric guide lines | `document/layout/snapGuides.ts`, DOM guides and column geometry | Parallel guide engines with different units/candidates | **ADAPT** |
| Coordinates/transforms/zoom | Fabric object transforms, 300-DPI logical pixels, Fabric viewport zoom | 96-CSS-pixel page/body coordinates and browser viewport zoom | Different persisted coordinate systems; cannot share raw numbers | **RETAIN-SEPARATE-INTERNALLY** |
| Text editing | Fabric i-text/textbox | Tiptap title/body stories | Both edit text, but only Document has semantic flow | **DUPLICATED** |
| Typography | Fabric font properties/theme token roles | named styles, roles, CSS variables, export typography | Common theme token source needed; Document semantics should lead | **ADAPT** |
| Freeform text boxes | fixed-frame Fabric textboxes and arbitrary placement | no equivalent | Fabric object factory and Fabric export | **FABRIC-PRIMARY** |
| Structured text flow | no equivalent | Tiptap stories, columns, flow allocator, breaks/keep rules | Document layout kernel and committed DOM export | **DOCUMENT-PRIMARY** |
| Structured exclusions/collision | no semantic text exclusion bridge | flow/overlay/span collision and column allocation | Document’s model-backed layout rules are canonical | **DOCUMENT-PRIMARY** |
| Shapes | Fabric rect/circle/line/polygon and properties panel | no equivalent | Fabric object factories/layer export | **FABRIC-PRIMARY** |
| SVG/artwork | Fabric SVG loading and object serialization | no equivalent | Fabric scene/export path | **FABRIC-PRIMARY** |
| Stickers/graphics | built-in assets, `Inserter`, `AssetLibrary`, Fabric objects | no equivalent | Canvas asset library and Fabric render | **FABRIC-PRIMARY** |
| Layers/z-order | serialized z-index manifest and live Fabric stack | DOM behind/content/front ordering | Same user concept, different render stacks | **ADAPT** |
| Page furniture/folios/borders | Fabric decorations/backgrounds | folios, page furniture candidates, document sheet | Common semantic bands needed; folio model exists on Document | **ADAPT** |
| Reference scans | no equivalent editor-only reference layer | persisted `ScanReference` + editor-only `ScanReferenceLayer` | Document reference excluded from export/print | **DOCUMENT-PRIMARY** |
| Themes | `useThemeStore`, Apocapalette tokens, Canvas application | `ProjectTheme`, document CSS/style resolution | Same product concern, two token/style adapters | **ADAPT** |
| Brand Kit | Canvas Brand Kit/theme modal and legacy typography/color shape | no equivalent full Brand Kit surface | Project theme should become canonical; Document style adapter required | **ADAPT** |
| Templates | Canvas template service and Fabric `canvasData` templates | no equivalent general template pipeline | Same product concept, Canvas-only implementation | **ADAPT** |
| Product recipes | Fabric `recipeRegistry`, Product Starter, generated Canvas pages | no Document recipe generator | Product metadata is shared; generator is Canvas-specific today | **ADAPT** |
| Product Forge/package metadata | Canvas export handoff/package generation | no separate Document handoff | `productForge/*` consumes Canvas export manager and shared product fields | **ADAPT** |
| Export/compositor | `advancedExportManager`, Fabric export/modal/Product Forge | committed DOM renderer + `documentExportService` browser/Tauri/print | Two committed renderer/orchestrator families | **DUPLICATED** |
| Native file delivery | `fileDeliveryService` | same service | Shared browser/Tauri destination adapter | **SHARED** |
| Persistence/save/load | Canvas live Fabric hydration and `editorStore` save | typed payload hydration and `documentStore` save | Same DB rows, separate write/read paths | **DUPLICATED** |
| Portable project files | Canvas/document envelopes with mode-specific normalization | same envelope, v6 Document normalization | Shared file format boundary, not a unified page format | **ADAPT** |
| Dirty/autosave | Canvas revisions and roughly two-second debounce | Document revisions and roughly 900ms debounce | Separate races, timers, and save-status state | **DUPLICATED** |
| Recovery | shared records/tools, Canvas object limits | shared records/tools, Document v6/image-group/reference repair | Shared storage but mode-specific validation/repair | **ADAPT** |
| Undo/redo | bounded Fabric snapshot/diff history | editor-local Tiptap undo/redo; page metadata lacks one stack | No cross-engine transaction boundary | **DUPLICATED** |
| Keyboard shortcuts | Canvas hook/Fabric focus/tool shortcuts | Document shell shortcuts, text commands, Escape drill-out | Separate global shortcut registries and focus assumptions | **DUPLICATED** |
| Project dashboard/navigation | `ProjectDashboard`, nested `ProjectBrowser`, quick-open | same dashboard routes to Document branch | Shared visuals but mode-specific actions and naming | **DUPLICATED** |
| Accessibility | UI ARIA panels, accessibility settings, Fabric interaction | DOM/Tiptap semantics and Document controls | Shared UI theme/settings possible; Canvas objects lack DOM semantics | **DUPLICATED** |
| Print | Canvas export-oriented raster/PDF path | committed Document DOM print path | Separate output fidelity and page sizing rules | **DUPLICATED** |
| Page thumbnail/preview | Canvas serialized thumbnail updates | Document navigation is model/page driven; no equivalent shared thumbnail lifecycle | Different preview generation/lifecycle | **DUPLICATED** |
| Captions/folio semantics | Fabric text can imitate them but has no structured ownership | image-owned captions, spacing/alignment/style, page folios | Document model and export already preserve these semantics | **DOCUMENT-PRIMARY** |

The important distinction is between duplicated **product responsibilities** and code that must remain specialized. A shared “Align” command is desirable; a single implementation of Fabric’s arbitrary transform math and the Document layout kernel is not.

## 4. Quantified duplication assessment

The counts below are an explicit taxonomy of the 43 matrix rows, not a percentage of lines of code or an estimate of effort:

- **16/43** are currently duplicated user-facing product responsibilities: creation, pages, sizing, assets, selection, multi-selection, text, export, persistence, autosave, history, shortcuts, navigation, accessibility, print, and previews.
- **15/43** are common product concepts that require adapters or a common contract (`ADAPT`): background, import, crop, alignment, snapping, typography, z-order, furniture, themes, Brand Kit, templates, recipes, Product Forge, portable files, and recovery. These are not all waste; some are legitimate engine adapters that are currently exposed as separate application surfaces.
- **8/43** are engine-unique capabilities worth preserving: four Fabric-primary areas (freeform text, shapes, SVG/artwork, stickers/graphics) and four Document-primary areas (structured flow, exclusions/column allocation, reference scans, caption/folio semantics).
- **2/43** should remain separate internally even in one editor: grouping semantics and coordinate/transform semantics.
- **2/43** are already genuinely shared infrastructure concerns: project identity/metadata and browser/Tauri file delivery.

The duplication is therefore substantial at the **application/lifecycle layer**, but lower at the **rendering-engine capability layer**. The current architecture is not two copies of the same editor; it is two partially overlapping products sharing a storage envelope.

### Responsibility-level duplication

- **Shell and lifecycle:** two editor shells, two top-level stores, two page navigation systems, two zoom/selection lifecycles, two save-status surfaces, and mode-branching close/unload handling in `App.tsx`. These are seven parallel lifecycle concerns that a unified shell should own.
- **Persistence/state:** two page models (`ProjectPage`/Canvas payload and `DocumentPage`/Document payload), two asset maps/lifecycles, two dirty/autosave implementations, two load/hydrate pathways, and two history models. The DB is shared, but the editing state is not.
- **Geometry/interaction:** two coordinate spaces (Canvas 300-DPI logical units versus Document 96-CSS-pixel page/body units), two viewport zoom systems, two snap/guide implementations, two alignment implementations, and two selection models. This is the highest-risk conceptual duplication because raw persisted coordinates cannot be interchanged safely.
- **Export:** two main committed renderer/orchestrator families (`advancedExportManager` and `DocumentProjectExportRenderer`/`documentExportService`), with separate browser/Tauri/print assumptions. `fileDeliveryService` is already shared and should stay shared.
- **Unique engine work:** Fabric’s object graph, arbitrary transforms, SVG/shapes/stickers/drawing and Canvas plugins are not redundant with Tiptap. Tiptap’s semantic text flow, column allocation, stable document image model, captions, folios, reference layer, and committed DOM export are not redundant with Fabric.

## 5. Unique capabilities worth preserving

### Preserve Fabric as the freeform engine

Fabric is the right owner for genuinely freeform visual objects:

- shapes and lines with arbitrary fills/strokes/shadows;
- SVG/artwork and sticker objects;
- arbitrary text boxes with fixed frames and free placement;
- rotations, scale/skew/transform origins, clip paths, and nested object groups;
- drawing and erasing where the product chooses to keep them;
- object-level z-order and layer-panel behavior;
- object factory/revival behavior and Fabric-native hit testing.

The Canvas object graph is a meaningful product capability, not merely legacy infrastructure. A unified editor should wrap it in a page/layer adapter and a shared asset/selection/history contract rather than translate every object into a Tiptap node.

### Preserve Document as the structured publishing engine

The Document architecture should become canonical for structured publishing semantics:

- Tiptap JSON stories and semantic paragraphs/headings;
- named typography roles/styles and heading keep-with-next behavior;
- deterministic columns, explicit column breaks, keep-lines-together, and flow allocation;
- wrapped, spanning, and overlay image placement with stable image IDs;
- image-owned captions and caption spacing/style/alignment;
- page margins, folios, continuation-page title suppression, and structured page furniture;
- page/body coordinate helpers, collision geometry, image group policies, and structured snapping;
- committed DOM rendering used by browser export, Tauri/WebKitGTK export, and print;
- editor-only reference scans and their export exclusion.

The recent Document work is already model-backed and portable. It should be extended as a layer, not rebuilt as a Canvas imitation.

## 6. Retirement candidates

These are candidates for later cleanup, not deletions in this audit. Each has a different confidence level and migration consequence.

### 6.1 Unregistered sample plugin — high confidence, low value

- **Current behavior:** `src/editor/plugins/samplePlugin.ts` demonstrates object-added, export, and theme hooks.
- **Reachability:** `rg` finds the file’s type import but no registration of `samplePlugin`. The active `pluginManager` is provided by `App.tsx` and used by Canvas export; the sample itself is not product functionality.
- **Coverage:** plugin infrastructure is exercised indirectly by export code; the sample plugin is not a user acceptance path.
- **Supersession:** a future extension API can be defined against the unified project/session contract instead of the Canvas-only `PluginAPI`.
- **Consequence:** remove or move to developer examples only after deciding whether plugins are a supported product extension surface. No data migration is required.

### 6.2 Paint-bucket affordance naming — medium confidence, no feature deletion implied

- **Current behavior:** the `PaintBucket` icon in `EditorShell` opens a Canvas background-color popover; it is not a paint-bucket object-fill tool. The actual `EditorTool` union contains select/draw/pan/erase/textbox, and Canvas drawing uses `fabric.PencilBrush`.
- **Reachability:** the background popover is reachable and the background-fill behavior is test-covered; the misleading name/icon is not an abandoned fill engine.
- **Supersession:** a unified Page/Theme panel should own page background. The icon can be renamed or removed after the common command exists.
- **Consequence:** UI-only cleanup; do not remove background functionality.

### 6.3 Duplicate project/preset surfaces — medium confidence

- **Current behavior:** `ProjectDashboard`, `ProjectBrowser`, `ProjectQuickOpenModal`, `ProjectPresets`, `ProjectPresetsModal`, `CanvasSettingsPopover`, and `CanvasSettingsPanel` expose overlapping project-open/new/page-settings flows. Several are mounted by `EditorShell`; dashboard and preset behavior have integration tests and an E2E smoke assertion.
- **Supersession:** one unified New Project flow, one project browser, and one Page settings surface can preserve all capabilities without two mode-specific navigation trees.
- **Consequence:** migrate callers and tests before removing a surface; preserve deep-link/quick-open and recovery paths.

### 6.4 Canvas-only export entry points — cleanup after compositor migration

- **Current behavior:** `advancedExportManager` is active, tested, consumed by `ExportModal`, `editorStore`, Product Forge, and Canvas E2E/integration tests. It is not dead code.
- **Supersession:** a unified committed page compositor can render both layers and feed Product Forge/package workflows.
- **Consequence:** do not retire until Canvas-only projects round-trip through the new compositor and Product Forge accepts the new artifact contract. Legacy Canvas export must remain the rollback path during migration.

### 6.5 Canvas AI layout suggestions — product decision required

- **Current behavior:** `aiLayoutSuggestions.ts` is active in `editorStore` and `SuggestionSidebar`, with unit coverage in `testSuite.test.ts`.
- **Supersession:** a future domain-level arrangement service could support both freeform and structured objects, but the current suggestion algorithm is Fabric-object-specific.
- **Consequence:** retain behind a Canvas adapter initially; retire only if product owners decide it is experimental/low-value. It should not block consolidation.

### 6.6 Historical “collaboration” claims — not a current subsystem

Older architecture notes mention collaboration/experimental systems, but the current checkout contains no `src/editor/collaboration` implementation. Do not plan migration work for a subsystem that is not present. The active PWA service-worker registration in `src/editor/offline/pwaOfflineManager.ts` is small and application-level; it is not a second editor persistence architecture.

## 7. Recommended unified project/page architecture

The target should be a product/domain unification with specialized rendering engines.

### 7.1 Canonical ownership

1. **Canonical Project:** a new domain-level `ProjectSession`/`UnifiedProject` service owns project identity, metadata, theme, assets, pages, export settings, recipe/Product Forge metadata, dirty/revision state, recovery status, and compatibility information. Zustand may remain the view-state mechanism, but no engine store should be the canonical project owner.
2. **Canonical Page:** a future `UnifiedPage` owns page ID/name/size/background/margins/furniture and optional structured/freeform/reference composition records. It is page-origin and unzoomed. It should not be a Fabric instance or a DOM node.
3. **Mixed pages:** yes. A page may contain only structured content, only freeform content, both, or neither. A single project may contain different mixtures and different page sizes.
4. **`editorMode`:** remove it from the canonical future model. Keep it temporarily as an envelope/import discriminator for old projects and as telemetry/compatibility metadata during migration. It must no longer mean “this project can only ever use one engine.” A transient editing context (for example, “text editing” or “freeform object editing”) is a different concept and should not be persisted as project mode.
5. **App replacement:** replace the mode branch with a `ProjectSessionProvider`/unified editor route. During migration it may load legacy Canvas and Document payloads into compatibility adapters, but the route should be one `UnifiedEditorShell` with a common session and page viewport.
6. **Shell:** one shell owns project lifecycle, navigation, save/dirty, Insert, Page, Assets, Layers, Theme/Brand, Reference, Export, keyboard focus, and accessibility. Engine-specific inspectors are contextual panels selected by the current selection and page composition.

### 7.2 Suggested page record (recommendation only)

Do not implement this in the audit. Conceptually:

```ts
type UnifiedPage = {
  id: string;
  name: string;
  size: PageSize;
  background: PageBackground;
  furniture?: PageFurniture;
  structured?: StructuredComposition;
  freeform?: FreeformComposition;
  reference?: ScanReference;
};
```

`StructuredComposition` should carry the current Document stories, structured images/groups, captions, folio/title settings, and any future explicit exclusions. `FreeformComposition` should carry a normalized Fabric object record/scene, not a live Fabric object. Both records should use stable IDs and common asset IDs.

This is a **new `UnifiedPage` option (C)** rather than merely adding a `freeform` field to `DocumentPage`. Extending `DocumentPage` would make every Canvas/social/template page pretend to be a structured document and would pull Fabric’s arbitrary object graph into a semantically wrong model. A new page kind alone is insufficient because it does not define optional layers or common page semantics. A unified page record gives migration a clear target while old page kinds remain importable.

### 7.3 Fabric placement and composition

Mount Fabric inside a page compositor, not beside the entire application shell:

```text
UnifiedPageViewport (viewport zoom only)
  PageCompositor (canonical page coordinates)
    background
    editor-only reference layer
    freeform-behind Fabric surface
    structured Document surface
    freeform-normal/front Fabric surface
    page furniture/folios
    selection, guides, and editor chrome
```

Initially, two Fabric surfaces or two explicitly partitioned Fabric render bands are safer than one opaque Fabric canvas, because a freeform object must be able to sit behind or in front of structured content. A single Fabric scene can remain the internal object source of truth if it can deterministically render those semantic bands. Do not use DOM z-index alone to imply a persisted cross-engine order.

### 7.4 Coordinates and zoom

- **Canonical persisted coordinates:** unzoomed page space in 96 CSS pixels per physical inch, matching the Document layout kernel’s page/body coordinate convention. Page size retains physical units and output DPI separately.
- **Fabric conversion:** legacy Canvas print coordinates are currently based on `src/editor/utils/units.ts` and often represent 300-DPI design pixels. Convert them explicitly at import/open into canonical page coordinates; do not divide raw values opportunistically in render code. Keep original legacy payload untouched until a successful compatibility save/round-trip is proven.
- **Fabric runtime:** Fabric may use an internal scale/viewport transform, but the adapter must map canonical page rectangles to Fabric coordinates and serialize back to canonical page coordinates. Fabric viewport zoom and `canvasOffset` remain transient.
- **Document runtime:** reuse `src/document/layout/coordinateSpaces.ts` and `layoutKernel.ts`; do not create a second unified geometry engine. Generalize page-space adapters around the kernel where needed.
- **Zoom:** one shell-level viewport zoom controls both surfaces. The compositor applies the same page-to-viewport transform; engine-specific zoom/viewport values are derived runtime state and never persisted as authored geometry.

### 7.5 Selection and focus

Introduce a transient shared selection controller, for example:

```ts
type SelectionTarget =
  | { kind: 'structured-text'; pageId: string; editor: 'title' | 'body' }
  | { kind: 'structured-image'; pageId: string; imageId: string }
  | { kind: 'structured-group'; pageId: string; groupId: string }
  | { kind: 'freeform-object'; pageId: string; objectId: string }
  | { kind: 'page'; pageId: string };
```

The controller is transient and never persisted. Tiptap node selections, Document stable-ID image selection, and Fabric active objects become adapters that report into it. Shift-click can add compatible targets; commands advertise whether they operate on mixed targets. A Document image group and a Fabric group remain different selection kinds even though both can show a group state.

Focus should follow the hit surface:

- clicking editable structured text focuses the relevant Tiptap editor and suppresses object shortcuts except text-safe commands;
- clicking a structured image/group or Fabric object moves focus to the shared selection controller and the contextual inspector;
- Escape exits text editing/node selection, then child selection, then group selection, then all selection;
- Tab/arrow behavior is owned by the shell only when no text editor is consuming the event;
- engine adapters must stop propagation for pointer/keyboard events they own and expose accessible command equivalents for selection and transforms.

### 7.6 Z-order policy

Persist semantic bands rather than interleaving raw DOM and Fabric stacking assumptions:

1. page background;
2. editor-only reference scan (never export/print);
3. freeform behind-content objects;
4. structured content, with its own internal flow/behind/front image semantics;
5. normal/front freeform objects;
6. folios, borders, and page furniture;
7. selection outlines, snap guides, and other editor chrome (never export).

Within a band, each engine retains its native order. Moving an object across bands is a deliberate domain command. Current Document `placement: 'front'|'behind'`, folios, and Canvas z-index manifest should map to these bands through adapters.

### 7.7 Structured wrapping boundary

Initially, **freeform Fabric objects must not affect structured text wrapping**. This is the smallest durable boundary: freeform objects are visual composition, while the Document allocator remains deterministic and model-backed.

If product needs arbitrary objects to exclude text later, add an explicit opt-in `StructuredExclusion` bridge in canonical page space. It should contain a stable object ID, exclusion shape (rectangle/polygon/path), padding, affected stories/columns, and enabled state. The structured allocator consumes committed exclusion records; it must not inspect Fabric instances or infer exclusions from every rotated object. The first bridge can support axis-aligned rectangles only, then expand deliberately.

## 8. Rendering-engine boundaries

| Responsibility | Canonical owner | Adapter boundary |
|---|---|---|
| Semantic paragraphs/headings/columns/flow/captions/folios | Document/Tiptap + layout kernel | Structured layer adapter publishes measured page geometry and commands |
| Shapes, SVGs, stickers, arbitrary text boxes, rotation, transforms | Fabric | Freeform layer adapter maps canonical page geometry to Fabric runtime |
| Images/assets | Shared asset domain | Document uses flow/overlay/object-fit; Fabric uses image/frame/clip factories |
| Crop/focal model | Shared semantic crop record | Document object-fit/Tauri adapter and Fabric clip-path adapter |
| Page geometry and snapping candidates | Shared page-space contract plus Document kernel primitives | Fabric adapter converts object bounds; Document adapter uses existing kernel |
| Z-order | Shared semantic bands | Fabric stack/DOM order adapters |
| Reference | Shared page record, Document-primary editor layer | Canvas/freeform pages can display the same editor-only scan layer |
| Themes/styles | Project theme/token domain | named Document styles and Fabric token-linked properties |

Do not replace Fabric merely to reduce the number of technologies. Do not add arbitrary Fabric objects as nested Tiptap nodes merely to achieve serialization symmetry. The desired unification is at project/page/session/command/persistence/composition boundaries.

## 9. State, persistence, and history architecture

### 9.1 Canonical state

Create one domain session boundary above both engines. It should have:

- canonical project/page payload;
- transient viewport, selection, focus, guides, and drag-preview state;
- a monotonically increasing revision and one dirty/save status;
- one command/transaction coordinator;
- engine adapters that can hydrate/render from canonical page records and emit domain mutations.

The current `editorStore` and `documentStore` can remain compatibility stores during migration. They must stop being the final owner of shared concerns one concern at a time. `canvasObjects` should eventually be a freeform layer record, not an application-wide project store; Document Tiptap JSON should eventually be a structured layer record, not the whole project identity.

### 9.2 Save, dirty, and autosave

Use one `ProjectChangeCoordinator` (name illustrative) that:

1. receives committed domain mutations from either engine;
2. increments one revision and marks the project dirty;
3. coalesces pointer moves and other high-frequency previews;
4. serializes one bounded canonical snapshot on the autosave debounce;
5. writes one IndexedDB project/data record transactionally;
6. exposes one save status to the shell and native-close guard.

Selection, engine instances, viewport zoom, guide lines, object hover, and pointer-preview coordinates remain transient. No pointermove should write a full project snapshot. The existing Canvas revision/hash/length safeguards and Document stale-save token are useful inputs to this coordinator.

### 9.3 Undo/redo

The target is a project-wide serializable command history:

- a Tiptap transaction becomes a structured-content command;
- a committed Document geometry/group/caption/reference change becomes a page command;
- a committed Fabric add/move/transform/group/style becomes a freeform command;
- a multi-layer user action is one transaction when it has one visible intent;
- pointer moves are coalesced from drag start to pointer-up;
- undo never stores live Fabric or DOM instances.

During migration, preserve Canvas `useHistoryStore` and Tiptap history as engine-local adapters. Add cross-engine history only after the unified session can capture both mutation streams; do not silently discard existing undo behavior.

## 10. Asset architecture

### Observed state

Both payload families have top-level asset fields, but the editing lifecycles differ:

- Canvas uses `imageAssets: Record<id, string>`, `StickerData`, asset reference counts, loader registries, blob/data/http URLs, and persistence-time preparation.
- Document uses stable `assetId`s, `assetMetadata`, content hashes/natural dimensions/MIME/filename, `documentAssetService`, and reachable-asset pruning.
- Shared DB/project-file limits and recovery logic already bound payload sizes, but identity/source cleanup is not one domain service.

### Recommendation

Make a `ProjectAssetStore` canonical, keyed by stable asset ID, with:

- embedded bytes or a portable source reference;
- MIME, filename, natural dimensions, content hash, and source kind;
- reference graph from structured images, freeform objects, templates, references, and product artifacts;
- lifecycle state for loading/revocation/errors;
- deterministic export resolver for browser and Tauri.

Keep Canvas legacy `imageAssets` and Document asset maps as compatibility/hydration views until old payloads are migrated. Blob URLs must remain runtime caches, never canonical persisted sources. Data URLs and remote URLs must be normalized into the existing portable-asset policy when saving/exporting. Stable Document image IDs and stable Fabric object IDs remain distinct; an asset ID is the shared media identity, not the visual-object identity.

Templates/stickers may reference assets or bundle source assets, but they should not create a second asset store. Recovery must validate references across both composition layers and preserve orphan/quarantine behavior rather than silently dropping bytes.

## 11. Export/compositor architecture

The target should be one `ProjectExportService`/committed page renderer with format-specific output adapters:

```text
canonical Project/Page snapshot
  -> committed page compositor
       background
       structured DOM/layout render
       Fabric freeform render/SVG/canvas surface
       furniture/folios
  -> browser PNG/PDF or Tauri/WebKitGTK PNG/PDF or print
  -> shared file delivery
```

The current Document committed DOM renderer is the strongest source for structured content, typography, flow, crops, folios, and print. Extend it to compose a canonical Fabric layer at the same page dimensions, or introduce a page compositor that uses the Document renderer as its structured child. Do not make the old Canvas `advancedExportManager` the mixed-page compositor merely because it already exports Fabric; it does not know Tiptap flow, CSS typography, Document crop semantics, or reference exclusion.

Fabric objects should be rendered from a committed snapshot, not from an interactive editor canvas with guides/selection. The export adapter must apply canonical page coordinates and output DPI at the final capture boundary. Browser and Tauri should consume the same committed page source; only capture/delivery should differ. Reference scans, selection, guides, placeholders, and `data-document-export-exclude` editor chrome remain excluded.

Product Forge should become a project-level package/artifact consumer. Its current metadata and seller preflight behavior are valuable, but it should request artifacts from the canonical export service instead of depending permanently on `ProjectPage[]` and the Canvas export manager.

Mixed-size pages are natural in this model: every `UnifiedPage` supplies its own physical size, margins, and output dimensions; the export loop creates a renderer context per page. Do not derive the entire project’s render size from the first page as the current Document envelope helper does.

## 12. UX and information architecture

### 12.1 Mental model

Replace the visible split between **Create Product** and **Create Document Project** with **New Project**. The start choices should configure a starting recipe/capability set, not permanently lock the editor:

- Blank print page
- Blank digital design
- Article/book layout
- Worksheet/printable
- Start from template
- Reconstruct from reference

An existing Canvas or Document file can still open with its legacy adapter, but a new project is simply a project. The user should never need to know whether the current selection is implemented by Fabric or Tiptap.

### 12.2 Unified command areas

Use a small number of stable information areas:

- **Insert:** Text, Shapes, Images, Graphics/Stickers, Assets, Template/Recipe.
- **Text:** semantic paragraph/heading styles when editing structured text; “Text box” creates a freeform Fabric object. The distinction should be described by outcome, not engine name.
- **Page:** size, margins, columns, background, folio, furniture, page order.
- **Layers:** semantic bands and per-engine object order, with clear group drill-in.
- **Theme/Brand:** project tokens, Brand Kit, named typography styles, and object overrides.
- **Reference:** import, fit to page, opacity, show/hide, lock/unlock, keyboard shortcut.
- **Contextual inspector:** selection-aware image crop/caption, group gap/arrangement, freeform transforms, text style, and alignment/distribution.
- **Export:** PNG/PDF/print/package using the same committed project snapshot.

One unified shell can keep the current rich Canvas and Document panels behind contextual tabs. It should not show every engine-specific control at once. Accessibility commands must have keyboard/menu equivalents for pointer-only Fabric operations.

## 13. Schema compatibility strategy

### 13.1 Existing compatibility obligations

The migration must continue to load and preserve:

- v1/v2 project envelopes and legacy mode inference;
- current Canvas page payloads and nested Fabric groups;
- current Document schema v6 and Tiptap content;
- stable image IDs, image groups, crop/focal fields, captions, references, folios, named styles, themes, recipes, Product Forge metadata, export settings, and recovery metadata;
- embedded assets and their existing payload/thumbnail bounds.

`normalizeDesignSpaceProjectPayload` is already the central normalization point. `projectOpenService.inspectLibraryProject` already provides a pre-mount inspection seam. These should be extended, not bypassed.

### 13.2 Future shape options

| Option | Fit to current code | Migration risk | Recommendation |
|---|---|---|---|
| A. Introduce a new page kind only | Easy discriminator, but no common layer contract; composition remains split | Low initial, high later | Insufficient alone |
| B. Extend `DocumentPage` with a freeform layer | Reuses Document page/layout code and v6 fields | High semantic risk for Canvas/social pages, Fabric object graph, and old recipes | Do not make DocumentPage the universal page |
| C. Introduce `UnifiedPage` with optional structured/freeform records | Explicit target; legacy pages can import into one page contract; mixed pages are natural | Moderate; requires new normalization/export/session adapters | **Recommended** |
| D. Keep current payloads and hide the split in App | Lowest short-term risk | Leaves duplicate state/lifecycle/export indefinitely | Compatibility bridge only, not target |

The recommended future envelope is a new schema version containing unified pages and a canonical asset store. It should be introduced only after an in-memory adapter and round-trip tests exist. Existing mode fields can remain as a compatibility discriminator for old files; new unified files should either omit it or set a clearly transitional value that does not constrain editing.

### 13.3 Migration rules

- Old Canvas payload: import each `ProjectPage` into a unified page with a freeform record; preserve legacy raw payload for rollback/diagnostics until the new save path is proven.
- Old Document payload: import each `DocumentPage` into a unified page with a structured record; preserve Document schema v6 content and metadata exactly.
- Assets: build the canonical asset index from both top-level maps and reachable object references; never discard a source merely because one engine cannot hydrate it.
- Crop/focal: keep the current Document crop model as the semantic record and use a Fabric adapter for clip paths; preserve legacy Canvas frame/clip metadata separately where exact equivalence is impossible.
- References: preserve `ScanReference`; keep it editor-only in all new render/export paths.
- Folios/styles/themes/recipes/product metadata/recovery: lift to project/page shared records while retaining legacy fields during dual-read.
- Recovery: teach validation and repair to understand both legacy payloads and the unified target before changing the primary write path.

## 14. Risk register

| Risk | Severity | Why it exists now | Mitigation | Earliest phase that must solve it |
|---|---|---|---|---|
| Fabric/Tiptap pointer ownership conflict | High | Both surfaces want pointer, selection, keyboard, and drag events; Canvas uses a live Fabric canvas while Document uses DOM/ProseMirror handlers | Unified hit-test policy, active editing context, explicit event capture/stop rules, pointer capture per adapter | Phase 1 compositor/prototype |
| Selection synchronization | High | Fabric active selection, Canvas ID mirrors, ProseMirror node selection, and Document transient image/group IDs are separate | Shared transient selection controller with engine adapters and deterministic Escape/focus rules | Phase 1 |
| 300-DPI Canvas vs 96-CSS-pixel Document geometry | High | Canvas unit conversion and smart guides use print-pixel dimensions; Document kernel persists page/body CSS pixels | Canonical unzoomed page coordinates; explicit legacy conversion and multi-page geometry tests at multiple zooms | Phase 1 before mixed editing |
| Mixed render-layer z-order | High | DOM structured content and Fabric stack cannot be interleaved by accidental CSS z-index | Persist semantic layer bands; render separate Fabric bands/surfaces; export from same compositor | Phase 1 compositor |
| Export parity | High | Canvas `advancedExportManager` and Document committed DOM/Tauri paths have different capture models; WebKitGTK differs from browser | One committed page source, golden browser/Tauri tests, output-dimension/crop/asset assertions | Phase 2 |
| Undo transaction boundaries | High | Canvas snapshot history and Tiptap history are engine-local; page metadata is outside both | Serializable project command coordinator; coalesce drags; retain local histories until replacement is proven | Phase 2 |
| Asset IDs, stale blob URLs, and portable size | High | Canvas runtime URL maps and Document metadata maps resolve sources differently; embedded payloads can be large | Canonical asset service, source normalization, ref graph, byte limits, revocation tests, recovery checks | Phase 2 |
| Autosave churn/races | High | Canvas and Document use different debounce/revision/save-token behavior and can write the same DB shape | One revision/dirty coordinator, commit-only geometry, one bounded snapshot write | Phase 2 |
| Legacy mode/schema migration | High | v1/v2 envelopes, Canvas pages, Document v6, and mode-based opening all exist | Dual-read adapters, new-schema feature gate, raw fallback, recovery fixtures, old-file round trips | Phase 2 before changing writes |
| WebKitGTK image/SVG/crop differences | High | Tauri Document export has explicit source embedding and SVG/crop handling; Fabric adds another capture path | Shared asset resolver, committed render tests in Tauri, no live blob URLs in export | Phase 2 |
| Mixed-size pages and project-level sizing | Medium | Canvas pages use per-page canvas sizes; Document envelope derives `document.pageSize` from first page | Make size page-owned in unified model and test heterogeneous projects | Phase 1 model contract |
| Page thumbnails/previews | Medium | Canvas updates serialized thumbnails; Document navigation does not share that lifecycle | Define a thumbnail renderer from committed page snapshots, with bounded cache | Phase 3 |
| Accessibility of Fabric objects | High | Fabric interaction is canvas-based and lacks native DOM semantics; Document has semantic DOM/Tiptap controls | Accessible layer list/selection inspector, keyboard transforms, focus announcements, object labels, reduced-motion support | Phase 1 unified shell |
| Large multi-page performance | Medium | Canvas hydrates a live page canvas; Document renders/exports page DOM; unified projects may retain both | Page virtualization, lazy engine mounts, bounded snapshots, thumbnail cache, measured performance budgets | Phase 3 |
| Template/recipe/Product Forge conversion | Medium | Current generators and package handoff consume Canvas `ProjectPage[]` and Canvas export | Keep generator adapters first; define canonical artifact/page contract before converting recipe authorship | Phase 3 |
| Recovery mismatch | High | Shared DB does not mean shared validation; Document recovery knows v6 image groups/references while Canvas validates Fabric limits | Unified recovery validator with legacy branches, quarantine/repair diagnostics, destructive-failure tests | Phase 2 |

## 15. Phased migration roadmap

Each phase keeps the current editors usable and has a rollback boundary.

### Phase 0 — Baseline and contract tests

- **Goal:** freeze behavioral contracts before changing ownership.
- **Change:** add architecture-level tests/specifications (not production changes in this audit) for old Canvas and Document open/save/portable/export/recovery behavior, asset identity, crop, references, folios, and historical page 49/50 regressions.
- **Touch:** test harness, project inspection fixtures, output comparison tooling.
- **Do not touch:** production stores, schemas, renderers, or App routing.
- **Compatibility:** all existing schema versions and current Document v6 remain green.
- **Acceptance:** old Canvas and Document files reopen/save/export identically within current tolerances.
- **Rollback:** remove only new test scaffolding.
- **Removable afterward:** none; this phase provides the safety net.

### Phase 1 — Shared session and page viewport seam

- **Goal:** establish one product shell boundary without changing persisted formats.
- **Change:** introduce a read-only canonical session/page interface and a unified page viewport/compositor. Mount legacy Canvas and Document renderers as adapters selected by inspected payload, with one navigation/zoom/focus contract where safe.
- **Touch:** `App.tsx`, `projectOpenService.ts`, `projectSessionStore`, shell/page viewport code, coordinate adapters, selection/focus contracts.
- **Do not touch:** legacy `editorStore`/`documentStore` write semantics, Fabric object schema, Document schema v6, export primary paths.
- **Compatibility:** old payloads still route to their current adapters; the existing mode value is used only for compatibility dispatch.
- **Acceptance:** both project types open in the new shell seam, page navigation/close guards remain correct, viewport zoom is visually consistent, reference/editor chrome stays out of export.
- **Rollback:** route back to the existing `App.tsx` shell branch while adapters remain unused.
- **Removable afterward:** no duplicate stores yet; the obsolete App-level branch is not removable until Phase 2 dual-read/write succeeds.

### Phase 2 — Canonical mutation, asset, and history services

- **Goal:** make shared product state authoritative while preserving engine renderers.
- **Change:** add unified page/project records in memory, canonical asset service, shared dirty/autosave coordinator, transient selection controller, and serializable command history. Add adapters that translate Canvas/Document mutations into those services.
- **Touch:** project/session stores, `projectSchema` normalization, asset lifecycle, recovery validation, history, keyboard/focus, save/load.
- **Do not touch:** arbitrary Fabric object behavior, Tiptap layout algorithms, existing per-engine rendering algorithms.
- **Compatibility:** dual-read legacy payloads; dual-write only behind explicit feature gating; legacy save remains available until round-trip equivalence passes.
- **Acceptance:** mixed page state can be saved/reopened; selection never persists; drag preview never autosaves; undo/redo spans a controlled cross-layer transaction; assets survive browser/Tauri round-trip.
- **Rollback:** disable canonical write path and replay legacy adapters from original payloads.
- **Removable afterward:** duplicate dirty/autosave/session save guards can be removed only after both stores use the coordinator.

### Phase 3 — Mixed-page compositor and unified commands

- **Goal:** allow structured and freeform layers on the same page.
- **Change:** enable optional `structured` and `freeform` composition records, semantic z-order bands, shared Insert/Layers/Page/Theme/Reference/Export commands, Fabric surfaces around the committed Document renderer, and common crop/asset adapters.
- **Touch:** unified page model, compositor, Fabric mounting, Document page renderer, selection/inspector UI, export/print/Tauri paths, thumbnails.
- **Do not touch:** unrelated product recipe content or remove legacy format reads prematurely.
- **Compatibility:** old Canvas/Document projects import into equivalent single-layer unified pages and can be exported through legacy or new path for comparison.
- **Acceptance:** blank unified project can create structured text plus freeform shapes/images, save/reopen, select each layer, preserve z-order, and export identical page dimensions in browser/Tauri.
- **Rollback:** disable mixed-layer write/read and use single-layer adapters.
- **Removable afterward:** `editorMode` App branching becomes removable when all supported payloads open through this shell and save through canonical session services.

### Phase 4 — Unified creation, templates, recipes, and Product Forge

- **Goal:** make “New Project” the only public creation mental model.
- **Change:** convert starting configurations into canonical project/page recipes; add structured/template composition records; make Product Forge consume canonical export artifacts.
- **Touch:** `ProjectDashboard`, Product Starter, template service, recipe registry/generator, Product Forge handoff, project metadata UI.
- **Do not touch:** unique Fabric drawing/transform internals or structured layout semantics.
- **Compatibility:** old recipe IDs and template payloads import through adapters; package files remain reproducible.
- **Acceptance:** each existing recipe creates an editable unified project; legacy project names/metadata/export settings survive; Product Forge package tests pass.
- **Rollback:** keep old Canvas recipe generator and package consumer behind a compatibility adapter.
- **Removable afterward:** duplicate Canvas/Document creation paths, mode-specific dashboard buttons, and old recipe-specific opening code.

### Phase 5 — Retire redundant application infrastructure

- **Goal:** remove the dual-app architecture after evidence, not before.
- **Change:** delete duplicate shell lifecycle, page navigation, asset hydration, export orchestration, and engine-specific public save guards that are now adapters only. Retain Fabric/Tiptap engines and legacy import readers.
- **Touch:** `EditorShell`, `DocumentEditorShell`, `editorStore`, `documentStore`, old export managers, duplicate panels, tests.
- **Do not touch:** legacy import/normalization/recovery readers until the compatibility window ends; Fabric and Document engines.
- **Compatibility:** all supported old files remain readable; an explicit archive/import policy is documented before removing write compatibility.
- **Acceptance:** one shell/session owns dirty/close/save/navigation/history/export; regression suite covers old Canvas, Document v6, historical pages, browser/Tauri, recovery, accessibility, and performance.
- **Rollback:** retain tagged legacy adapters and restore routing/configuration if a compatibility test regresses.
- **Removable afterward:** `editorMode` as a product mode, duplicate save/load paths, duplicate navigation, duplicate export orchestration, and obsolete creation surfaces.

### Earliest safe removal points

- **App `editorMode` branch:** after Phase 3, when both legacy payload kinds open through the unified shell and can still round-trip.
- **Duplicate shell lifecycle logic:** after Phase 3’s unified focus/selection/save/export contracts, with Phase 5 cleanup.
- **Duplicate save/load logic:** after Phase 2 canonical mutation/asset/autosave dual-read/write and recovery proof.
- **Duplicate page navigation:** after Phase 1 shared page viewport/navigation contract.
- **Duplicate asset lifecycle:** after Phase 2 canonical asset service and browser/Tauri/recovery round trips.
- **Duplicate export orchestration:** after Phase 3 mixed compositor plus Product Forge/export parity; do not remove the Canvas path earlier.
- **Canvas/Document creation paths:** after Phase 4 unified starter/recipe/template coverage and a documented legacy-import policy.

## 16. First implementation slice

The first slice should be:

> **Introduce a shared canonical read-only `ProjectSession`/`PageViewport` contract and mount the existing Canvas and Document renderers behind it, with a shared page-size/zoom/selection-event interface but no new persistence schema and no mixed-layer writes yet.**

This is the correct first cut because it:

- materially changes the product seam from “two applications” to “one session with adapters”;
- has low-to-moderate blast radius if it starts read-only;
- tests the hardest early risks—mount order, pointer ownership, zoom, page size, focus, thumbnails, and reference/export exclusion—before a schema migration;
- preserves all current Canvas and Document behavior and their existing save/export fallback paths;
- creates the seam needed by later canonical assets, selection, history, and mixed-page composition;
- can be rolled back by restoring the current `App.tsx` branch without rewriting production data.

It should not begin with a new schema or with simultaneous conversion of all Canvas object types and Document nodes. Those changes are safer once the compositor and compatibility adapters have demonstrated that the two existing renderers can coexist on a page-sized surface.

## 17. Explicit non-goals

This audit does not:

- implement the unified editor, a new schema, migrations, adapters, or a compositor;
- merge or rewrite `EditorShell`, `DocumentEditorShell`, `editorStore`, or `documentStore`;
- replace Fabric, Tiptap, the Document layout kernel, or the current export implementations;
- remove Canvas drawing, AI suggestions, templates, recipes, Product Forge, or any other feature;
- decide that every Fabric object should affect structured text wrapping;
- treat old architecture documents as current implementation truth;
- claim that a unified product page already exists;
- declare an experimental feature obsolete solely because it is old.

## 18. Open decisions requiring product-owner input

Before implementation, product owners should decide:

1. Is the permanent product promise “one project can mix structured and freeform layers on a page,” or only “one project can switch capabilities across pages”? The architecture supports both, but mixed pages determine the earliest compositor and z-order work.
2. Should freeform objects ever exclude structured text, and if so, is an explicit rectangle-only exclusion sufficient for the first release?
3. Which Fabric tools are core product value: drawing, eraser, AI layout suggestions, stickers, and arbitrary SVG/artwork? This affects retirement and accessibility budgets.
4. Is the 96-CSS-pixel canonical page coordinate space acceptable for legacy print projects, with output DPI separate, or is a different physical-unit contract required?
5. What is the compatibility policy for old project files: indefinite read support, a versioned import-only window, or a one-time conversion on save?
6. Should themes/Brand Kit become the single source for named typography tokens, or should Document named styles be the semantic authority with Brand Kit providing defaults?
7. Are Product Forge package outputs a public product promise or an internal seller workflow? This determines how early its artifact contract must be stabilized.
8. Which starting configurations should be first-class in the unified New Project flow, and which current recipes/templates should remain Canvas-only during migration?
9. What are the required accessibility levels for canvas objects, keyboard multi-selection, and screen-reader announcements before the unified shell can replace either existing shell?
10. What performance budget is required for mixed pages and large multi-page projects, especially in Tauri/WebKitGTK?

## Conclusion

The repository supports consolidation at the **product, project, page, session, command, asset, persistence, navigation, and export-composition boundaries**. It does not support a safe “one rendering engine” consolidation. The strongest durable architecture is one unified project/page model with optional structured and freeform layers, a shared page-space contract, and specialized Tiptap/layout and Fabric adapters. The Document model should own structured publishing semantics; Fabric should remain the freeform visual engine; the first migration should establish a reversible shared session/compositor seam before changing persisted data.
