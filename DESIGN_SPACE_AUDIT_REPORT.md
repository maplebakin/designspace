# Design Space Audit Report

> Historical baseline: this audit captured the repository before the current
> product-studio and document-reconstruction implementation. The current source
> and README supersede statements below that describe recipes, product metadata,
> Product Forge handoff, project validation, or document editing as absent.

## Implementation update

The worktree now delivers the audit's highest-priority recommendations:

- Versioned, editor-discriminated project payloads with product metadata and
  backward-compatible canvas fields.
- Recipe-driven multi-page products, including Chaos Craft Planner and Crochet
  Pattern Decoder Kit.
- A document reconstruction editor with structured text, columns, reference
  scans, image placement, persistence, and PNG/PDF export.
- A public-build boundary around internal Product Forge packaging.
- Safer project and asset ingestion, portable embedded assets, serialized page
  switching, and autosave revision protection.
- IndexedDB-backed project/template storage with lightweight preference-only
  `localStorage` persistence.
- Browser, unit, export, security, orientation, persistence, and document-flow
  regression coverage.

The remaining architectural cautions in this report—especially the size of
`editorStore`, mixed live-Fabric/store ownership, and print-preflight limits—are
still useful follow-up guidance.

## 1. Current App Summary

Design Space currently appears to be a browser-based Fabric.js design editor with a strong general-purpose canvas surface. It supports shape/text/image insertion, layers, selection tools, smart guides, canvas presets, page strips, saved projects, templates, themes, brand-kit colors, a vision board, and PNG/JPEG/SVG/PDF export.

The app is already closer to a printable editor than a pure Canva clone in a few important ways: the default unit mode is inches, print presets exist, page size is tracked separately from viewport size, multi-page documents exist, and export can produce PDF and page-by-page image/vector assets.

The product direction is still diffuse. The UI and data model mix print products, social canvases, mood-board workflows, generic templates, stickers/assets, image effects, theme palette exploration, and broad design-editor controls. The core canvas is useful, but the project model does not yet say "this is a printable product generated from a recipe and prepared for Product Forge."

## 2. Intended Product Builder Goal

Design Space should be a theme-aware printable product builder for generating sellable digital products.

ApocaPalette should provide theme tokens, palettes, brand kits, and product identity data. Design Space should apply those themes to reusable printable recipes and produce editable multi-page documents. Product Forge should receive the finished project and package/export sellable assets such as PDFs, PNG previews, README files, listing copy, metadata, and ZIP folders.

That means Design Space should optimize for:

- choosing/importing a theme
- choosing a printable recipe
- generating a multi-page product from recipe page templates
- editing text, shapes, placeholders, and theme-bound elements
- saving/loading the project reliably
- exporting PDFs and preview images through one export path
- handing structured product metadata to Product Forge

## 3. Current Architecture Map

- `src/editor/state/useCanvasStore.ts`
  - Owns document/page width and height plus a pending-size handshake.
  - This matches the intended constraint that canvas/document size should live here.

- `src/editor/state/editorStore.ts`
  - Owns the live Fabric canvas reference, serialized `canvasObjects`, layers, selection, tools, page list, project name, dirty/autosave state, assets, template actions, save/load, theme delegation, export wrappers, undo/redo wrappers, and many direct object editing commands.
  - It is currently the largest ownership hotspot.

- `src/editor/state/useHistoryStore.ts`
  - Owns undo/redo snapshots, diff/full snapshot storage, history index, image asset reference accounting, and undo/redo canvas rehydration.
  - This is mostly aligned with the intended constraint that `useHistoryStore` should be the only undo/redo owner.

- `src/editor/state/useThemeStore.ts`
  - Owns imported theme vaults, active theme data, palette vaults, recent colors, vision palette, brand kit persistence, and `canvasBackgroundColor`.
  - Theme ownership is useful, but page/document background ownership is too mixed with page serialization and export.

- `src/editor/export/advancedExportManager.ts`
  - Owns PNG, JPEG, SVG, single-page PDF, multi-page PDF, and multi-page image/vector downloads.
  - Export UI and store-level export routes use this manager, which matches the intended constraint.

- `src/editor/components/ExportModal.tsx`
  - Export UI for current page and all pages. Uses `advancedExportManager`.

- `src/editor/components/CanvasStage.tsx`
  - Owns Fabric canvas mounting, event registration, viewport behavior, document paper rendering, guide overlays, safe zones, drag/drop/image upload, and store-to-canvas layer sync registration.

- `src/editor/services/canvasEventService.ts`
  - Centralizes Fabric event handlers for object changes, selection, viewport, pan, keyboard, snapping, and textbox drawing integration.

- `src/editor/state/layerSyncHandler.ts`
  - Reconciles `editorStore.canvasObjects` into the live Fabric canvas. This makes `canvasObjects` behave as an intended source of truth, but it creates risk when live Fabric is mutated before `canvasObjects` is updated.

- `src/editor/fabric/canvasUtils.ts`
  - Owns document paper rendering, safe margin guides, bleed guides, canvas resize, viewport fit/centering, and rotate/fit-content helpers.

- `src/editor/components/PageStrip.tsx`
  - Multi-page navigation, add/delete/reorder pages.

- `src/editor/components/TemplateBrowser.tsx` and `src/editor/services/templateService.ts`
  - Snapshot-based template browsing, saving, loading, and IndexedDB persistence.
  - Templates are useful, but they are not yet printable product recipes.

- `src/editor/db.ts`
  - Dexie storage for projects, canvas payloads, brand kit, and template records.

- `src/editor/components/ThemeSidebar.tsx`, `src/editor/components/BrandKit.tsx`, `src/editor/services/designSpaceImporter.ts`, `src/utils/paletteIngest.js`
  - Theme and palette import/application surfaces.
  - There are two import ideas: generic ApocaPalette token-pack ingestion in `useThemeStore.addThemeToVault`, and simplified palette ingestion in `ThemeSidebar`.

- `src/editor/components/VisionBoard.tsx` and `src/editor/state/visionBoardStore.ts`
  - Mood-board/iteration board with images, colors, and pinned canvas states.
  - Useful for ideation, but not central to the printable product MVP.

- `src/editor/components/ProjectPresets.tsx`, `src/editor/config/canvasPresets.ts`, `src/editor/components/CanvasStageOverlays.tsx`
  - Print and social canvas presets, onboarding canvas picker, dashboard presets.

## 4. What Already Supports the Goal

- Print-sized documents exist.
  - `canvasPresets.ts` includes US Letter, A4, A5, ritual card, and tarot card.
  - `editorStore` defaults to inches.

- Logical document size is separated from viewport size.
  - `useCanvasStore` stores page/document dimensions.
  - `canvasUtils` treats the Fabric canvas element as viewport and uses document dimensions for paper/guides/export sizing.

- Multi-page documents exist.
  - `ProjectPage` has `id`, `name`, `canvasData`, `canvasSize`, and thumbnail.
  - `PageStrip` supports switching, adding, deleting, and reordering pages.
  - `AdvancedExportManager.exportPagesPdf` and `exportPages` can export all pages.

- Theme-token application exists.
  - Objects can carry `tokenRole`.
  - `applyThemeToCanvas`, `applyThemedFillToObject`, and related helpers resolve active theme tokens.
  - Saved templates can remember a `defaultThemeId`.

- Save/load exists.
  - Projects can be saved to IndexedDB.
  - `.apocaproject.json` download/load exists.
  - Image assets are separated through `assets` and `imageAssets` handling.

- Undo/redo exists in a dedicated store.
  - `useHistoryStore` tracks snapshots and exposes `undo`/`redo`.
  - Tests check the absence of legacy history owners.

- Export is mostly consolidated.
  - `ExportModal` and `editorStore.exportCanvas` route through `AdvancedExportManager`.
  - Tests check that live export routing does not import older export helpers.

- Export excludes editor-only objects.
  - `renderToPng`, `serializeToSVG`, and page export paths hide guides/document paper/smart guides.

- Templates exist as reusable snapshots.
  - Template storage, listing, saving, loading, thumbnails, and community starter layouts provide a foundation for recipes.

## 5. What Is Broken, Duplicated, or Risky

- `editorStore` owns too much.
  - It owns canvas lifecycle state, serialized document model, layers, pages, save/load, autosave, templates, assets, object editing commands, theme delegation, export wrappers, and UI flags.
  - This makes it difficult to enforce a clean product document model.

- Page background ownership is duplicated.
  - Current background lives in `useThemeStore.canvasBackgroundColor`.
  - Saved page background lives in `ProjectPage.canvasData.background`.
  - The visible paper is a non-exported Fabric rect in `canvasUtils.updateDocumentPaper`.
  - Export receives background via options, and multi-page export also reads `page.canvasData.background`.
  - The intended architecture says page/document paper should own saved/exported background. Right now background is split between theme state, page data, and export options.

- Direct Fabric mutations are inconsistent about syncing back to store before layer/history writes.
  - Good examples call `syncCanvasToStore(canvas)` before `saveState()` and `requestLayerSync()`, such as `setObjectFill`, stroke updates, and lock toggles.
  - Risky examples include `BrandKit.handleColorChange`, `applyThemedFillToObject`, `applyThemeTintToImage`, and `resetObjectToDefaultTheme`, which mutate Fabric and then save/request layer sync without consistently updating `canvasObjects`.
  - Because `layerSyncHandler` reconciles store state back into Fabric, stale `canvasObjects` can overwrite programmatic Fabric changes.

- `canvasObjects` and Fabric both behave like sources of truth.
  - Comments say `canvasObjects` is primary and Fabric is a render delegate.
  - Many editor actions still mutate Fabric directly, then attempt to sync afterward.
  - This can work, but only if every mutation follows the same sync order.

- Page state can drift from ad hoc canvas changes.
  - `syncActivePageFromCanvas` is called before page switches and multi-page exports, but not every action updates the page record immediately.
  - `TemplateBrowser.handleBlankPreset` clears and resizes the current Fabric canvas without going through `createProject`, so it can diverge from project/page setup expectations until a later sync.

- Project payload is editor-centric, not product-centric.
  - `ProjectFilePayload` has `projectName`, `pages`, `canvasData`, `assets`, `activeTheme`, `lastUpdated`, `canvasSize`, and `unitMode`.
  - It does not have recipe ID, product metadata, export intent, listing copy, page roles, SKU/slug, or Product Forge handoff fields.

- Theme ingestion is split.
  - `useThemeStore.addThemeToVault` supports ApocaPalette-like `generic-token-pack-v1`.
  - `ThemeSidebar` imports a simplified palette via `ingestApocapalette` and stores it as `importedPalette`, but that is not the same as selecting/applying a full theme.
  - For the MVP, there should be one canonical ApocaPalette import path.

- Export is consolidated for downloads, but not yet for Product Forge handoff.
  - `AdvancedExportManager` triggers downloads directly.
  - Product Forge will likely need blobs or structured export results, not only browser downloads.
  - The manager should remain the only export implementation, but it needs a non-download API surface for packaging.

- Multi-page export currently uses page snapshots.
  - This is correct in principle, but export quality depends on every page being synced before export.
  - `ExportModal` calls `syncActivePageFromCanvas` for all-pages export, which is good.

- History is per active canvas, not product-document level.
  - Switching pages resets history to the active page baseline.
  - That may be acceptable for MVP, but it means undo cannot cross page switches or recipe generation steps.

- Existing tests protect some architecture rules, but not all intended constraints.
  - Tests cover export routing, history owner absence, document size capture, page deletion, and some template/page behavior.
  - Tests do not yet enforce direct Fabric mutation sync order, canonical background ownership, or Product Forge handoff shape.

## 6. What Is In the Weeds

These features are not bad, but they should be deferred or de-emphasized until the printable product MVP is stable:

- Social canvas presets as first-class project starts.
  - Instagram, YouTube, TikTok, Pinterest, wallpaper, and similar presets should become preview/export derivatives, not core product recipes.

- Vision Board as a major workflow surface.
  - Useful for inspiration and iteration, but it does not directly generate sellable printable products.

- Broad Canva-like insertion library work.
  - Stickers, masks, advanced asset browsing, and generic community templates should stay secondary to recipe-driven printable generation.

- AI layout suggestions.
  - Helpful later, but premature before stable recipes, page roles, and product metadata.

- Plugin architecture.
  - Fine to keep, but not an MVP dependency for ApocaPalette -> Design Space -> Product Forge.

- Advanced image adjustments and magic image/theme matching.
  - These are useful creative features but peripheral to templated printable production.

- Marketplace/template purchase concepts in older docs.
  - Defer until product recipes and handoff bundles are real.

## 7. Required MVP Shape

The smallest useful Design Space MVP should support:

- Create/open project.
- Choose page size from print-first presets.
- Choose/import an ApocaPalette theme through one canonical theme import path.
- Choose a printable recipe.
- Generate pages from recipe page templates.
- Edit text, shapes, image/placeholders, and theme-bound colors.
- Save/load the whole product project.
- Export PDF and PNG previews through `AdvancedExportManager`.
- Generate Product Forge handoff metadata.

The MVP should feel like:

1. Select theme.
2. Select product recipe.
3. Generate editable pages.
4. Customize content.
5. Save project.
6. Export preview/PDF or hand off to Product Forge.

## 8. Recommended Data Model

Recommended project shape:

```ts
type DesignSpaceProject = {
  schemaVersion: 'design-space-project-v1';
  projectId: string;
  createdAt: string;
  updatedAt: string;
  metadata: {
    name: string;
    slug: string;
    author?: string;
    sourceApp: 'design-space';
  };
  document: {
    pageSize: {
      presetId?: string;
      width: number;
      height: number;
      unitMode: 'in' | 'px' | 'cm' | 'mm';
      dpi: number;
    };
    background: {
      tokenRole?: string;
      value: string;
    };
    bleedPx?: number;
    safeMarginPx?: number;
  };
  theme: {
    source: 'apocapalette';
    themeId?: string;
    name?: string;
    tokens: ApocapaletteTheme;
  };
  recipe: {
    id: string;
    version: string;
    generatedAt: string;
  };
  pages: Array<{
    id: string;
    name: string;
    role: string;
    templateId: string;
    pageNumber: number;
    canvasSize: { width: number; height: number };
    background?: {
      tokenRole?: string;
      value: string;
    };
    elements: SerializedFabricObject[];
    canvasData?: {
      objects: SerializedFabricObject[];
      background?: string;
    };
    thumbnail?: string;
  }>;
  exportSettings: {
    pdfFileName: string;
    previewFileNames: string[];
    formats: Array<'pdf' | 'png' | 'jpeg' | 'svg'>;
    dpi: number;
    includeBackground: boolean;
  };
  productMetadata: {
    title: string;
    subtitle?: string;
    description: string;
    tags: string[];
    category: string;
    useCases: string[];
    includedFiles: string[];
    listingCopy?: {
      shortDescription?: string;
      longDescription?: string;
      bullets?: string[];
    };
  };
};
```

Implementation note: `elements` and `canvasData.objects` should not both remain long-term. For compatibility, keep `canvasData` initially, then migrate toward a clearer `pages[].elements` model when the sync architecture is stable.

## 9. Product Recipe System

Recipes should be structured product definitions, not just saved Fabric snapshots.

Recommended recipe shape:

```ts
type ProductRecipe = {
  id: string;
  version: string;
  name: string;
  defaultPageSize: {
    presetId: string;
    width: number;
    height: number;
    unitMode: 'in';
    dpi: number;
  };
  pageTemplates: Array<{
    id: string;
    role: string;
    name: string;
    repeat?: number;
    defaultLabels: Record<string, string>;
    layoutSlots: Array<{
      id: string;
      type: 'text' | 'image' | 'shape' | 'table' | 'checklist' | 'notes';
      tokenRole?: string;
      bounds: { x: number; y: number; width: number; height: number };
      defaultValue?: string;
      editable: boolean;
    }>;
    fabricObjects: SerializedFabricObject[];
  }>;
  exportNames: {
    pdf: string;
    previews: string;
    metadata: string;
  };
  productMetadata: {
    titleTemplate: string;
    descriptionTemplate: string;
    tags: string[];
    category: string;
    includedFiles: string[];
  };
};
```

Suggested initial recipes:

- `chaosCraftPlanner`
  - Pages: cover, monthly overview, weekly spread, project tracker, materials list, notes.
  - Slots: title, month label, checklist rows, project cards, notes blocks.
  - Export names: `chaos-craft-planner.pdf`, `chaos-craft-planner-preview-page-01.png`.
  - Metadata: planner, craft organizer, printable PDF, editable themed pages.

- `crochetPatternDecoder`
  - Pages: cover, abbreviation guide, stitch key, pattern worksheet, row tracker, project notes.
  - Slots: pattern title, yarn/hook info, symbol table, row counters, difficulty badge.
  - Export names: `crochet-pattern-decoder.pdf`, `crochet-pattern-decoder-preview-page-01.png`.
  - Metadata: crochet, pattern helper, stitch guide, printable worksheet.

- `tarotJournal`
  - Pages: cover, card meaning page, daily draw, spread worksheet, reflection page.
  - Slots: card name, keywords, interpretation notes, spread positions, reflection prompts.
  - Export names: `tarot-journal.pdf`, `tarot-journal-preview-page-01.png`.
  - Metadata: tarot journal, printable workbook, spiritual planner, editable PDF.

- `homeResetPack`
  - Pages: cover, room reset checklist, declutter tracker, weekly home plan, supply list, reflection.
  - Slots: room labels, task checklists, progress meters, schedule blocks, notes.
  - Export names: `home-reset-pack.pdf`, `home-reset-pack-preview-page-01.png`.
  - Metadata: home organization, printable checklist, reset planner, cleaning workbook.

Recipes should define page roles and product metadata up front. Design Space can still store generated Fabric objects, but generation should be repeatable from recipe + theme + user overrides.

## 10. Integration Plan

ApocaPalette -> Design Space:

- Define one canonical ApocaPalette theme input.
- Normalize incoming theme JSON to `ApocapaletteTheme`.
- Store the full token pack in `project.theme.tokens`.
- Store source metadata such as ApocaPalette theme ID, name, slug, and version if available.
- Apply theme tokens to recipe-generated objects via `tokenRole`.
- Treat page background as document/page data that may reference a token, not as an incidental UI theme property.

Design Space internal flow:

- User chooses/imports a theme.
- User chooses a product recipe.
- Recipe generator creates pages from `ProductRecipe.pageTemplates`.
- Generated objects have stable IDs, names, roles, slot IDs, and token roles.
- User edits content.
- Direct Fabric edits sync back to `canvasObjects` before history/layer writes.
- Project save persists the product model, pages, theme, recipe, and product metadata.

Design Space -> Product Forge:

- Add a Product Forge handoff payload, separate from editor autosave.
- Use `AdvancedExportManager` as the only renderer for PDF/PNG/SVG/JPEG.
- Add non-download export methods that return blobs/results for Product Forge packaging.
- Include product metadata:
  - product title
  - recipe ID and version
  - theme name/ID
  - page size and page count
  - export file names
  - listing copy
  - tags/categories
  - included file manifest
- Product Forge should package the returned blobs plus README/listing/metadata into ZIP folders.

## 11. Next 3 Implementation Tasks

1. Stabilize direct Fabric mutation sync order.
   - Audit all programmatic `object.set`, `canvas.add`, `canvas.remove`, `canvas.clear`, and `loadFromJSON` paths.
   - Enforce the sequence: mutate Fabric, `syncCanvasToStore(canvas)`, update page if needed, `saveState`, then `requestLayerSync`.
   - Add tests for theme fill, BrandKit color apply, tint/reset theme, and blank preset behavior.

2. Introduce a product-aware project schema without replacing the current save/load path.
   - Extend `ProjectFilePayload` and IndexedDB payloads with optional `schemaVersion`, `recipe`, `document`, `theme`, `exportSettings`, and `productMetadata`.
   - Keep current `pages[].canvasData` compatibility.
   - Add migration helpers that wrap existing projects into the new shape.

3. Add the first recipe generator and Product Forge handoff metadata.
   - Create a small `src/editor/recipes` module with `ProductRecipe` types and one recipe, preferably `homeResetPack` or `chaosCraftPlanner`.
   - Generate multi-page `ProjectPage[]` from recipe + active ApocaPalette theme.
   - Add a handoff builder that returns product metadata and export file names, using `AdvancedExportManager` for PDF and PNG preview blobs.
