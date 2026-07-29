# Historical book layout gap analysis

Audit date: 2026-07-29  
Repository commit: `62a604e916f30e07ea862a13254fa5a7bbeabee6`  
Scope: the React/TypeScript document editor, its project persistence and recovery paths, and its PNG/PDF/print export path. The Fabric canvas editor was inspected only where it shares project storage, routing, recovery, or export infrastructure.

## 1. Executive summary

Design Space currently has a credible **single-page document-reconstruction prototype**, not a four-page book-layout system. It uses two Tiptap editors (one title document and one body document), a `DocumentPage` record stored inside the shared v2 project envelope, CSS multi-column flow for ordinary content, and a second, manually measured “structured span” renderer when one or more `span-columns` image nodes are present. Images are either Tiptap image nodes in `bodyContent` or independently persisted page overlays. PNG and PDF export clone and rasterize the currently mounted page DOM.

The strongest implemented slice is a one-page, one-to-three-column article with styled inline text, image insertion, captions, CSS float wrapping, and newer positioned spanning images. The reported recent work is present:

- `06e71155` added structured image placement and wrap controls.
- `77c8aea4` fixed structured image reselection and export-state cleanup.
- `1535953a` introduced multiple structured images, exclusion rectangles, collision geometry, live drag/resize previews, and multi-image tests.
- `62a604e9` changed position commits to recover the target by stable image ID when ProseMirror positions or selections are stale.
- `18333d40` added startup storage gating, bounded Zustand persistence, and IndexedDB write fingerprinting.
- `7bb2e24b`, `9729a6d8`, `d7724067`, and `db70c628` added, fixed, resumed, and bounded the Tauri/Chromium recovery workflow.

Those changes are valuable but incomplete. The editor cannot represent a four-page document at all: `normalizeDocumentPayload` rejects anything except exactly one document page, `DocumentEditorShell` always edits `pages[0]`, and `DocumentExportService` produces a one-page raster PDF. There is no page-number model, mirrored inner/outer margins, starting folio, page parity, or per-page layout navigation.

The next largest blockers are:

1. Typography is mostly fixed CSS. There are no font-family, colour, line-height, paragraph-spacing, indentation, reusable style, heading, quotation, author-credit, or configurable drop-cap models.
2. The structured renderer is a DOM-measure-and-clone layer, not a shared deterministic layout engine. It duplicates CSS-column layout, hides the actual Tiptap source while viewing structured flow, and can export transient preview DOM.
3. Compound image layouts have no persistent group or alignment abstraction. Independent structured images can approximate a pair or stack, but the UI still suppresses span choices when any other spanning image exists.
4. Export is a screenshot of the mounted DOM. The PDF is a single full-page PNG, the background is forced white, fonts are not embedded as PDF text, and no test verifies exported visual placement or wrapping.
5. Base64 assets are never garbage-collected or deduplicated during normal editing. Repeated replace/delete/import operations can grow every autosaved payload and recreate substantial IndexedDB write amplification.

Overall readiness for faithfully recreating, editing, saving, reloading, and exporting pages 49–52 is **41/100**. The current schema and Tiptap foundation can be extended; the evidence does not justify replacing the editor wholesale.

Current page-by-page attainability:

| Source page | Current attainability | Blocking differences |
|---|---|---|
| 49 | Partial as a standalone project | Three columns, a title, a fixed-size drop cap, a positioned structured image, and attached caption can be approximated. Blue title/drop-cap colour, configurable drop-cap metrics, centred caption, cream paper, folio 49, and reliable structured drop-cap export are missing. |
| 50 | Not reproducible through the normal UI | Bold text is available, but the second spanning-image choice is suppressed, there is no side-by-side pair/gap/group workflow, captions cannot be centred independently, and folio 50 is missing. |
| 51 | Not reproducible through the normal UI | Two independently positioned exclusions can be constructed directly in JSON and manually stacked, but the UI guard, lack of stack/shared-width/group controls, lack of deterministic initial collision resolution, and missing folio 51 prevent a supported workflow. |
| 52 | Partial as a standalone project | Three-column text, bold, italic, and natural unused space are possible. Semantic subsection, quotation/scripture, signoff/author styles, cream paper, and folio 52 are missing. It cannot coexist with pages 49–51 in one document. |

## 2. Current architecture

### 2.1 Editor shell and page composition

Files and symbols:

- `src/document/components/DocumentEditorShell.tsx`
  - `DocumentEditorShell`
  - `insertAssetIntoBody`
  - `updateSelectedImage`
  - `handleLayoutChange`
  - `exportDocument`
- `src/document/components/DocumentPageView.tsx`
  - `DocumentPageView`
  - `hasMeaningfulDocumentContent`
- `src/document/components/TitleEditor.tsx`
  - `TitleEditor`
- `src/document/components/FlowEditor.tsx`
  - `FlowEditor`
  - `getSelectedDocumentImage`
  - `commitStructuredDocumentImagePosition`

`DocumentEditorShell` reads the first and only page with `project?.pages[0]`, owns live Tiptap editor references, translates toolbar actions into Tiptap transactions or page-store updates, and passes a live DOM ref to export. `DocumentPageView` builds a fixed 96-CSS-pixel-per-inch sheet, applies four physical padding values as margins, mounts the title and body editors, and mounts overlay layers in front of and behind the page content.

The title and body are separate ProseMirror documents. This makes a full-width article title easy, but means title/body selection, history, and style state are separate. The body is one rectangular flex region beneath the title; there is no page-region model.

Coupling and risks:

- The shell, toolbar, Tiptap transactions, Zustand page store, structured renderer, and export DOM are tightly coupled through component refs and DOM state.
- Page size is duplicated: `DocumentPage.size` drives the document editor, while `ProductProjectFields.document.pageSize` is normalized separately in `projectSchema.ts`. A blank document can therefore carry a 2550×3300 project-level page-size record while its actual `DocumentPage.size` is 8.5×11 inches.
- All document editing assumes `pages[0]`.

### 2.2 Tiptap schema and text formatting

Files and symbols:

- `src/document/extensions/DocumentTextStyleExtension.ts`
  - `DocumentTextStyleExtension`
  - `setDocumentFontSize`
- `src/document/extensions/DocumentAlignmentExtension.ts`
  - `DocumentAlignmentExtension`
- `src/document/extensions/SanitizedPasteExtension.ts`
  - `sanitizeDocumentPasteHtml`
  - `SanitizedPasteExtension`
- `src/document/extensions/DocumentImageExtension.ts`
  - `DocumentInlineImageExtension`
  - `DocumentFlowImageExtension`
  - `DocumentImageCommandsExtension`

Both editors use a deliberately reduced StarterKit. Paragraphs, bold, italic, underline, history, and basic document nodes are present. Headings, blockquotes, lists, links, code, and horizontal rules are explicitly disabled in `TitleEditor` and `FlowEditor`. `DocumentTextStyleExtension` stores only `fontSizePx`; `DocumentAlignmentExtension` stores `textAlign` on paragraphs.

This is a safe narrow schema, but it has no semantic nodes or marks for subsection headings, author/signature text, quotations, colour, font family, line height, tracking, paragraph spacing, indentation, named styles, or configurable drop caps.

### 2.3 Image document model and node views

Files and symbols:

- `src/document/types/documentProject.ts`
  - `DocumentFlowImage`
  - `DocumentOverlayImage`
- `src/document/extensions/DocumentImageExtension.ts`
  - `DocumentImageAttributes`
  - `normalizeDocumentImageAttributes`
  - `calculateDocumentImageDragY`
  - `calculateDocumentImageXOffset`
  - `moveSelectedDocumentImage`
- `src/document/components/DocumentImageNodeView.tsx`
  - `DocumentImageNodeView`
- `src/document/components/DocumentOverlayLayer.tsx`
  - `DocumentOverlayLayer`

Tiptap image nodes are atoms with structured attributes: ID, asset ID, natural and rendered size, wrap mode, span count/start, uniform wrap padding, vertical spacing, vertical anchor, body-relative Y, horizontal placement, body-span-relative X offset, and a caption string. Captions are structurally attached as an image-node attribute and render inside the figure.

Page overlays are a second model in `DocumentPage.overlayObjects`. They use page-origin `xPx`/`yPx`, rendered size, front/behind placement, and caption metadata. They do not exclude text.

`DocumentImageNodeView` supports click selection and aspect-preserving horizontal resize. Structured span images bypass the normal node view for display and are rendered as cloned HTML inside `StructuredDocumentSpanLayout`.

Coupling and risks:

- Converting between flow and overlay images deletes one representation before inserting the other. There is no transaction spanning Tiptap and Zustand, so a failure can lose or orphan an image.
- Legacy image nodes with no ID normalize to `id: ''`; IDs are not repaired on hydration.
- Caption alignment/spacing/style is fixed in CSS and not in the node model.

### 2.4 Columns, structured spans, and exclusions

Files and symbols:

- `src/document/components/FlowEditor.tsx`
  - CSS-column source editor
  - `StructuredDocumentSpanLayout` switch
- `src/document/components/StructuredDocumentSpanLayout.tsx`
  - `buildDocumentSpanLayoutModel` (older single-image model)
  - `buildMultiDocumentSpanLayoutModel` (active multi-image model)
  - `createStructuredContentMeasurer`
  - `allocateElementsToHeight`
  - `moveRectangleWithoutCollisions`
  - `clampResizeWidthWithoutCollisions`
- `src/document/styles/document-page.css`
  - `.document-flow-prosemirror`
  - `.document-spanning-layout`
  - `.document-span-layout__*`

Without a spanning image, the browser lays out the editable `.document-flow-prosemirror` with CSS `column-count`, `column-gap`, `column-fill: auto`, and `hyphens: auto`.

With any `span-columns` node, `buildMultiDocumentSpanLayoutModel` serializes `editor.getHTML()`, parses top-level elements, removes structured image elements from the text stream, measures DOM clones in a hidden host, computes image and caption rectangles, expands them by padding/spacing, creates free rectangular bands per physical column, and allocates/splits text elements into those bands. The real Tiptap source is hidden while the structured view is active. Clicking text switches back to the editable CSS-column source while leaving cloned images visible.

Important duplication and fragility:

- `buildDocumentSpanLayoutModel` and `buildMultiDocumentSpanLayoutModel` duplicate layout concepts.
- Normal content uses the browser column algorithm; structured content uses custom element measurement and whitespace splitting.
- Selection does not live in the rendered structured columns. Editing swaps to a different layout representation.
- Layout depends on browser DOM measurement, installed fonts, serialized HTML, and top-level element splitting. It is not a pure deterministic function of committed project JSON.
- Existing overlapping structured images are not automatically resolved; `moveRectangleWithoutCollisions` skips obstacles already overlapping the start rectangle.
- Candidate text bands narrower than 72 px are discarded.

### 2.5 Toolbar and inspector controls

Files and symbols:

- `src/document/components/DocumentSidebar.tsx`
  - page preset, orientation, four margins, columns, gap, title size, drop-cap toggle, image/reference import
- `src/document/components/DocumentToolbar.tsx`
  - `DocumentImageInspectorValue`
  - text formatting controls
  - image layout/position/caption controls

The UI exposes 1–3 columns, column gap, Letter/A4, orientation, physical top/right/bottom/left margins, title size, a drop-cap boolean, inline font size, bold/italic/underline, paragraph alignment, image width, wrap padding, span choice, structured X/Y placement, overlay X/Y, caption text, alt text, replace, and delete.

UI/model disagreement: `DocumentEditorShell.canSelectedImageSpan` is old single-span logic from `cddc0e0b`. It sets `canSpanColumns: false` as soon as a different spanning image exists. The multi-image layout added in `1535953a` supports multiple structured images, but normal users cannot turn a second selected image into a span through the toolbar.

### 2.6 Project types, normalization, store, and browser persistence

Files and symbols:

- `src/document/types/documentProject.ts`
  - `DocumentPage`
- `src/editor/project/projectSchema.ts`
  - `DESIGN_SPACE_PROJECT_SCHEMA_VERSION`
  - `normalizeDocumentProjectPage`
  - `normalizeDesignSpaceProjectPayload`
- `src/document/state/documentStore.ts`
  - `createBlankDocumentProject`
  - `normalizeDocumentPayload`
  - `queueAutosave`
  - `flushAutosave`
- `src/editor/db.ts`
  - `DesignSpaceDB`
  - `fingerprintProjectPayload`
  - `saveProject`
  - `updateProject`
- `src/editor/project/projectOpenService.ts`
  - `inspectLibraryProject`
  - `inspectDesignSpaceProjectFile`

The document payload is stored as opaque JSON in the same Dexie `canvasData` table as Fabric projects. `editorMode: 'document'` routes it back to the document store. `normalizeDocumentPayload` requires exactly one document page. Page normalization clamps known values but preserves `bodyContent` as an opaque Tiptap JSON tree.

The store is not Zustand-persisted. It debounces library autosaves by 900 ms, tracks a revision and project-session token, and prevents an older async save result from clearing newer dirty state. Dexie stores one project metadata row and one JSON row per newly created project. `updateProject` fingerprints payloads before modifying JSON, but updates every `canvasData` row matching a project ID rather than only `project.canvasDataId`.

There is no normal-editing asset table. Assets are data URLs embedded in the project JSON map. Deleting or replacing an image never removes the old asset.

### 2.7 Startup storage protection and Tauri recovery

Files and symbols:

- `src/editor/persistence/startupStorageRecovery.ts`
  - `prepareStartupStorage`
  - `assertIndexedDbStartupAllowed`
- `src/editor/persistence/boundedPersistStorage.ts`
  - `createBoundedPersistStorage`
- `src/editor/recovery/RecoveryWorkspace.tsx`
- `src/editor/recovery/recoveryClient.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/src/recovery.rs`
- `src-tauri/recovery_tools/recover_indexeddb.py`
  - `validate_and_migrate`
  - bounded two-pass recovery

Startup runs before `App` imports. Oversized/corrupt known localStorage entries are quarantined, and IndexedDB is not opened if the origin estimate exceeds 1 GiB or cannot be obtained. Tauri recovery discovers the exact browser-origin database, requires a verified filesystem backup, extracts bounded records in a Python subprocess, deduplicates identical revisions and same-project assets, writes portable project files, and only permits source deletion after verification and explicit confirmation.

Document payloads survive recovery because the extractor copies page/Tiptap JSON opaquely and recognizes `editorMode: 'document'`. It does not validate document node types, image IDs, image attributes, or asset references, and its automated fixture covers canvas projects only.

### 2.8 Export and print

Files and symbols:

- `src/document/services/documentExportService.ts`
  - `createCleanDocumentClone`
  - `prepareDocumentExportClone`
  - `createDocumentSvgMarkup`
  - `DocumentExportService.exportPngBlob`
  - `DocumentExportService.exportPdfBlob`
  - `DocumentExportService.print`
- `src/document/styles/document-print.css`
- `src/editor/export/advancedExportManager.ts` (Fabric-only; not used by the document editor)

The service waits for live fonts and retained images, clones the mounted export root, copies computed styles, removes editor/reference nodes, forces structured layouts into viewing state, inlines image sources, serializes the clone into SVG `foreignObject`, then draws it to an output canvas at the requested DPI. PDF export inserts that single PNG as a full-page image in jsPDF.

Editor and export do not independently run the same layout engine. Export snapshots whatever structured DOM the mounted React editor currently has. This normally matches the visible editor, but can include an uncommitted drag/resize preview and cannot export a document without mounting it. The default and shell call path force `#ffffff`; normalized project background metadata is unused.

## 3. Verified current capabilities

| Capability | Status | Evidence | Relevant files | Relevant tests | Confidence |
|---|---|---|---|---|---|
| Fixed physical single-page sheet | Complete | Page uses inches converted at 96 CSS px/in; export uses requested inches and DPI. | `DocumentPageView.tsx:DocumentPageView`; `documentExportService.ts:calculateDocumentPixelDimensions` | `document-orientation.test.ts`; `document-export.test.ts`; Playwright orientation/export tests | High |
| Letter/A4 and portrait/landscape | Complete | Both presets normalize and update page/overlay/reference geometry. | `documentPageOrientation.ts`; `DocumentSidebar.tsx` | Orientation unit and Playwright tests | High |
| Custom physical page dimensions | Missing | Type permits a string preset, but `normalizeDocumentProjectPage` maps everything except A4 to Letter and recomputes dimensions. | `projectSchema.ts:normalizeDocumentProjectPage` | None | High |
| Four independent margins | Complete | UI and page padding persist top/right/bottom/left inch values. | `DocumentSidebar.tsx`; `DocumentPageView.tsx` | `document-editor.test.ts` margin test | High |
| Mirrored margins and folios | Missing | No inner/outer or page-number fields/rendering. | `DocumentPage` | None | High |
| Overflow warning | Partial | Body scroll/structured height is checked; title, overlays, printable bounds, and multi-page continuation are not. | `FlowEditor.tsx:isDocumentFlowOverflowing` | Unit UI warning test | High |
| Serif body/title typography | Complete | Georgia/Times is fixed in editor and structured CSS. | `document-page.css` | Rendering tests only | High |
| Bold, italic, underline, alignment | Complete | Tiptap commands persist marks/paragraph alignment. | `DocumentEditorShell.tsx:handleFormat`; alignment extension | Editor tests | High |
| Per-selection font size | Complete | `documentTextStyle` mark stores `fontSizePx`. | `DocumentTextStyleExtension.ts` | Unit and Playwright typography tests | High |
| Font family, colour, line/paragraph/tracking/indent controls | Missing | No attributes, extensions, controls, or CSS variables. | Text schema and toolbar | None | High |
| Semantic article title | Partial | Separate title document has fixed bold styling, but no named/title style or colour. | `TitleEditor.tsx`; `.document-title-prosemirror` | Title typing/size tests | High |
| Semantic subsection/quote/author/caption styles | Missing | Headings and blockquotes are disabled; caption CSS is fixed. | `FlowEditor.tsx` StarterKit config | None | High |
| Drop cap | Present but fragile | Boolean CSS pseudo-element has fixed black/inherited colour/size and is absent from structured cloned columns. | `DocumentPage.dropCap`; drop-cap CSS; export pseudo copy | Toggle tests do not inspect pixels | High |
| 1–3 continuous columns | Complete | Native CSS columns work for content without spans. | `.document-flow-prosemirror`; sidebar | Unit and Playwright column tests | High |
| Structured rectangular exclusions | Partial | Explicit band allocation exists only for `span-columns` images; CSS floats cover ordinary images; overlays do not wrap. | `buildMultiDocumentSpanLayoutModel` | Multi-image model tests and one Playwright span test | High |
| Live structured reflow on drag/resize | Complete | rAF preview overrides rebuild the multi-image model; one Tiptap transaction commits on release. | `StructuredDocumentSpanLayout` | Zoom/commit/undo tests | High |
| Stable structured image commit by ID | Complete | Commit checks expected position then scans by ID. | `FlowEditor.tsx:commitStructuredDocumentImagePosition` | Stable-ID unit test | High |
| Multiple structured images in model | Partial | Model, rectangles, rendering, selection, collision, and persistence attributes work; toolbar blocks creating a second span and no full reload/export visual test exists. | `buildMultiDocumentSpanLayoutModel`; `canSelectedImageSpan` | Two-image unit integration test | High |
| Flow and overlay image insertion | Complete | Validated PNG/JPEG/WebP assets insert as Tiptap nodes; flow images can convert to overlays. | Asset service; editor shell | Asset/editor/Playwright tests | High |
| Image reselection | Complete | Node view and structured slots set node selection; regression tests cover switching text/image. | Node view; structured layout | Unit and Playwright tests | High |
| Zoom-aware dragging/resizing | Partial | Structured spans and overlays divide pointer deltas by zoom; keyboard and all wrap modes are not covered. | Structured layout; overlay layer | Multi-scale structured tests; Playwright fit-scale drag | High |
| Aspect-ratio-preserving resize | Complete | Height is derived from natural aspect ratio in node, structured, inspector, and overlay paths. | Image extension/node view/shell | Resize tests | High |
| Captions structurally attached to images | Complete | Caption is an image/overlay attribute and renders within the figure. | Image schema/node view/overlay | Serialization, reload, export-clone tests | High |
| Caption formatting controls | Missing | Fixed 10 px italic left alignment and fixed 5 px top margin; no style attributes. | `document-page.css` | None | High |
| Side-by-side/stack groups | Missing | No group/container/page-region node, group metadata, gap helper, or group movement. | Entire document schema | None | High |
| Debounced bounded library save | Complete | 900 ms debounce, revision/session guards, 100 MB payload cap, payload fingerprint. | Document store; `db.ts` | Store race/autosave and DB dedup tests | High |
| Asset lifecycle boundedness | Present but fragile | Input validation and total payload cap exist, but imported/replaced/deleted assets accumulate as duplicated data URLs. | `documentAssetService.ts`; document store | No GC/dedup test | High |
| Save/reload structured image | Complete | Tiptap JSON attributes and asset map round-trip; one real-browser span reload is tested. | Store/project schema | Store and Playwright tests | High |
| Tauri recovery preserves document JSON | Partial | Extractor recognizes document mode and copies pages, but document-node/asset integrity is not validated or fixture-tested. | Recovery Python/Rust | Recovery tests are canvas-oriented | High |
| Exact-size PNG | Complete | 300 DPI Letter output verified as 2550×3300. | Document export service | Unit and Playwright dimension tests | High |
| PDF output | Partial | Correct one-page MediaBox exists, but content is a raster screenshot; no multi-page, folios, background setting, font embedding, or visual fidelity proof. | `exportPdfBlob` | MediaBox/download tests only | High |
| Editor chrome/reference exclusion | Complete | Export clone physically removes marked nodes. | `createCleanDocumentClone` | Export unit tests | High |
| Exported wrapping/caption fidelity | Present but fragile | Export retains the currently rendered structured DOM; tests assert markup/text presence, not rendered geometry or pixels. | Export clone and structured renderer | Clone-markup tests | High |
| Example four-page recipe/fixture | Missing | Only synthetic Harwood test content exists; no page 49–52 recipe or golden output. | `e2e/document-reconstruction.spec.ts` | None for target layouts | High |

## 4. Gap matrix

Legend: phases are S0 (paper colour slice), P1 (multi-page/folios), P2 (typography), P3 (layout kernel and positioned images), P4 (compound helpers), P5 (persistence/recovery), P6 (export hardening), and P7 (target fixtures/visual regression). “Migration” means an explicit transform/defaulting contract, not merely Tiptap silently applying defaults.

### 4.1 Page model

| Checklist item | Status | Exact gap | Severity | Pages | Likely files/subsystems | Schema | Migration | Export | Phase |
|---|---|---|---|---|---|---|---|---|---|
| Fixed physical dimensions | Complete | Single page is fixed at 96 CSS px/in and exported at requested DPI. | Low | 49–52 | Page view/export | No | No | Yes, already | — |
| Configurable page size | Partial | Only Letter/A4 and orientation; custom dimensions are discarded on normalization. | Medium | 49–52 | `DocumentPage.size`, page normalizer/sidebar | Yes | Yes | Yes | P1 |
| Top/bottom/inner/outer margins | Partial | Four absolute sides exist; no inner/outer semantic margins. | High | 49–52 | Page type, page view, sidebar | Yes | Yes | Yes | P1 |
| Mirrored left/right behaviour | Missing | No page parity or mirror transform. | High | 49–52 | Page model/layout/export | Yes | Yes | Yes | P1 |
| Outside-bottom page numbers | Missing | No folio fields or renderer. | Critical | 49–52 | Page model/page view/export | Yes | Yes | Yes | P1 |
| Configurable starting page number | Missing | No project/page numbering settings. | Critical | 49–52 | Project document metadata/UI | Yes | Yes | Yes | P1 |
| Cream paper background | Missing | `project.document.background` defaults cream but editor sheet and export force white and never read it. | High | 49–52 | Shell/page view/export/sidebar | No | No | Yes | S0 |
| Overflow detection | Partial | Body-only warning; no page continuation, overlay bounds, title overflow, or deterministic overflow record. | High | 49–52 | Flow editor/layout kernel/page store | Possibly | If persisted | Yes | P3 |

### 4.2 Typography

| Checklist item | Status | Exact gap | Severity | Pages | Likely files/subsystems | Schema | Migration | Export | Phase |
|---|---|---|---|---|---|---|---|---|---|
| Serif body font | Complete | Fixed Georgia/Times, not selectable. | Low | 49–52 | CSS | No | No | Yes | P2 |
| Full justification | Partial | Paragraph alignment can be set manually; body default is left and no page/style default exists. | High | 49–52 | Alignment extension/style model | Yes for defaults/styles | Yes | Yes | P2 |
| Font size and family controls | Partial | Font size mark exists; family is absent. | High | 49–52 | Text-style extension/toolbar | Yes | Yes | Yes | P2 |
| Line height | Missing | Fixed 1.42. | Medium | 49–52 | Named style/block attrs | Yes | Yes | Yes | P2 |
| Paragraph spacing | Missing | Fixed `.72em`. | Medium | 49–52 | Named style/block attrs | Yes | Yes | Yes | P2 |
| First-line indentation | Missing | No model/control. | Medium | 49–52 | Paragraph attrs/styles | Yes | Yes | Yes | P2 |
| Character spacing | Missing | Feasible as a bounded text-style mark/style property, but absent. | Low | 49–52 | Text-style extension | Yes | Yes | Yes | P2 |
| Bold and italic | Complete | StarterKit marks persist. | Low | 50, 52 | Tiptap/toolbar | No | No | Yes | — |
| Text colour | Missing | No colour mark/control. | High | 49 | Text-style extension/toolbar | Yes | Yes | Yes | P2 |
| Article-title style | Partial | Separate bold title region, but no named style, family, colour, spacing, or reusable preset. | High | 49 | Title editor/style registry | Yes | Yes | Yes | P2 |
| Subsection-heading style | Missing | Heading schema is disabled; bold paragraphs are only a visual workaround. | High | 50, 52 | Flow schema/named styles | Yes | Yes | Yes | P2 |
| Caption style | Partial | Structural caption with fixed italic CSS; target centre alignment cannot be stored. | High | 49–51 | Image attrs/styles/toolbar | Yes | Yes | Yes | P2 |
| Author/signature style | Missing | No semantic node/style. | Medium | 52 | Flow schema/named styles | Yes | Yes | Yes | P2 |
| Quotation/scripture style | Missing | Blockquote is explicitly disabled. | High | 52 | Flow schema/named styles | Yes | Yes | Yes | P2 |
| Configurable drop cap | Present but fragile | Boolean only; fixed 3.35 em, inherited colour, no line-span; structured view/export misses it. | High | 49 | Page/style schema/layout/export | Yes | Yes | Yes | P2/P3 |
| Reusable named styles | Missing | No registry or style IDs. | High | 49–52 | Project/page schema, extensions, toolbar | Yes | Yes | Yes | P2 |
| Hyphenation strategy | Present but fragile | `hyphens:auto` exists without language metadata, dictionary policy, or export tests. | Medium | 49–52 | Page language/style/export | Yes for language | Yes | Yes | P2/P6 |
| Widow/orphan/keep-with-next | Present but fragile | CSS `widows/orphans:2` exists, but manual structured splitting ignores it; no keep-with-next. | Medium | 49–52 | Layout kernel/block attrs | Yes for keep rules | Yes | Yes | P3 |

### 4.3 Multi-column flow

| Checklist item | Status | Exact gap | Severity | Pages | Likely files/subsystems | Schema | Migration | Export | Phase |
|---|---|---|---|---|---|---|---|---|---|
| One/two/three columns | Complete | Implemented per single page. | Low | 49–52 | Page/FlowEditor | No | No | Yes | — |
| Configurable column gap | Complete | Pixel gap persists. | Low | 49–52 | Page/sidebar/CSS | No | No | Yes | — |
| Continuous flow between columns | Partial | Native flow is good; structured flow is reconstructed from cloned elements. | High | 49–52 | CSS columns/layout kernel | No | No | Yes | P3 |
| Reflow after text edits | Complete | Tiptap update increments layout revision. | Low | 49–52 | FlowEditor | No | No | Yes | — |
| Reflow after image movement/resize | Complete | Structured preview rebuilds bands live; ordinary CSS floats reflow natively. | Low | 49–51 | Structured renderer/node view | No | No | Yes | — |
| Per-page layout differences | Missing | Exactly one document page is accepted. | Critical | 49–52 | Store/shell/page navigation | Yes | Yes | Yes | P1 |
| Stable editing selection across columns | Present but fragile | Native CSS columns retain Tiptap selection; structured mode swaps between hidden source and cloned display. | High | 49–51 | FlowEditor/structured renderer | No | No | Indirect | P3 |
| Deterministic overflow | Present but fragile | DOM/font measurement and fallback estimation can vary; overflow text is appended to the last band. | High | 49–52 | Layout kernel/fonts | Possibly | Possibly | Yes | P3/P6 |
| Correct save/reload | Partial | Column settings and one structured layout reload; no four-page or multi-image visual equality proof. | High | 49–52 | Store/schema/tests | Yes for pages | Yes | Yes | P1/P7 |

### 4.4 Positioned images

| Checklist item | Status | Exact gap | Severity | Pages | Likely files/subsystems | Schema | Migration | Export | Phase |
|---|---|---|---|---|---|---|---|---|---|
| Insert image | Complete | Validated raster import/paste/drop exists. | Low | 49–51 | Asset service/shell | No | No | Yes | — |
| Stable image IDs | Partial | New images use UUIDs; legacy/malformed nodes can retain empty or duplicate IDs. | High | 49–51 | Image normalization/project migration | Yes for doc schema version | Yes | Yes | P5 |
| Reliable select/reselect | Complete | Recent structured and node-view selection fixes are tested. | Low | 49–51 | Node view/structured view | No | No | No | — |
| Horizontal/vertical drag | Partial | Structured fixed spans and overlays only; ordinary flow images cannot be freely positioned. | High | 49–51 | Layout kernel/node attrs | No | No | Yes | P3 |
| Resize | Complete | Pointer and numeric width resize exist. | Low | 49–51 | Node view/structured/overlay | No | No | Yes | — |
| Preserve aspect ratio by default | Complete | Always preserved; no unlock option. | Low | 49–51 | Geometry helpers | No | No | Yes | — |
| Numeric x/y/width/height | Partial | X/Y are mode-specific, width exists, height is derived and not directly editable. | Medium | 49–51 | Inspector/image attrs | Possibly | Yes if added | Yes | P3 |
| Keyboard nudging | Missing | No arrow-key image movement. | Medium | 49–51 | Shell shortcuts/layout commands | No | No | No | P3 |
| Column-span controls | Partial | Span 2/3 and start column exist, but second-span UI is blocked. | High | 49–51 | Shell/toolbar | No | No | Yes | P3 |
| Left/centre/right/custom placement | Partial | Only structured spans have all four; floats and overlays use different subsets. | Medium | 49–51 | Image positioning contract | No | No | Yes | P3 |
| Printable-boundary constraints | Partial | Structured images clamp to body/span; live overlays clamp only to non-negative coordinates and can leave the page. | High | 49–51 | Geometry/page constraints | No | No | Yes | P3 |
| Predictable collision behaviour | Present but fragile | Only structured drag/resize avoids non-overlapping peers; insertion, existing overlaps, overlays, and floats have no common policy. | High | 50–51 | Layout kernel | No | No | Yes | P3 |
| Multiple images per page | Partial | Model supports them; normal UI cannot create multiple spans and no end-to-end reload/export proof exists. | Critical | 50–51 | Shell/structured renderer/tests | No | No | Yes | P3 |
| Non-100% zoom | Partial | Structured and overlay pointer deltas account for zoom; ordinary modes and keyboard are untested. | Medium | 49–51 | Interaction geometry | No | No | No | P3 |
| Persist through save/reload/reconstruction/export | Partial | Attributes persist and a single structured image is E2E-tested; multi-image, recovery, and visual export equality are not. | Critical | 49–51 | Store/recovery/export/tests | No | No | Yes | P5/P7 |

### 4.5 Text wrapping

| Checklist item | Status | Exact gap | Severity | Pages | Likely files/subsystems | Schema | Migration | Export | Phase |
|---|---|---|---|---|---|---|---|---|---|
| No-wrap mode | Partial | `top-bottom` prevents side wrap but is named/behaves as a single-column block; no uniform explicit no-wrap contract. | Medium | 50–51 | Wrap enum/CSS/layout | Yes if renamed/expanded | Yes | Yes | P3 |
| Rectangular wrap mode | Partial | CSS floats wrap ordinary figures; explicit rectangles apply only to span images. | Critical | 49–51 | Layout kernel/image modes | No | No | Yes | P3 |
| Configurable wrap padding | Complete | Uniform padding persists. | Low | 49–51 | Image attrs/inspector | No | No | Yes | — |
| Independent padding sides | Missing | One scalar plus separate vertical spacing only. | Low | 49–51 | Image attrs/geometry | Yes | Yes | Yes | P3 |
| Caption included in occupied rectangle | Complete | Structured caption height is measured; CSS float figure naturally includes caption. | Low | 49–51 | Structured renderer/CSS | No | No | Yes | — |
| Multiple exclusion rectangles | Partial | Supported for structured images, inaccessible through ordinary second-span UI. | Critical | 50–51 | Structured renderer/shell | No | No | Yes | P3 |
| Live reflow or documented commit model | Complete | Structured preview is live and commits once; implementation is not documented for users. | Low | 49–51 | Structured renderer | No | No | Yes | — |
| Stable wrapping after reload | Partial | One span is tested; multi-image geometry equality is not. | High | 49–51 | Store/layout/tests | No | No | Yes | P7 |
| Stable wrapping in export | Present but fragile | Mounted DOM clone is retained, but no pixel/geometry assertion proves it. | Critical | 49–51 | Export/layout/tests | No | No | Yes | P6/P7 |

### 4.6 Captions

| Checklist item | Status | Exact gap | Severity | Pages | Likely files/subsystems | Schema | Migration | Export | Phase |
|---|---|---|---|---|---|---|---|---|---|
| Structurally belongs to image | Complete | Stored on image node/overlay record. | Low | 49–51 | Image schemas | No | No | Yes | — |
| Moves with image | Complete | Renders inside figure/slot. | Low | 49–51 | Node/overlay renderers | No | No | Yes | — |
| Width follows image | Complete | Caption is 100% figure width. | Low | 49–51 | CSS | No | No | Yes | — |
| Editable text | Complete | Inspector updates caption string. | Low | 49–51 | Toolbar/shell | No | No | Yes | — |
| Italic/alignment controls | Partial | Italic is forced; alignment is fixed left and not configurable. | High | 49–51 | Image attrs/style controls | Yes | Yes | Yes | P2 |
| Spacing controls | Missing | Fixed 5 px top margin. | Medium | 49–51 | Image attrs/style controls | Yes | Yes | Yes | P2 |
| Included in wrapping | Complete | Included for structured and CSS figure wrapping. | Low | 49–51 | Layout/CSS | No | No | Yes | — |
| Save/reload/export | Partial | String persists and export clone retains it; no multi-caption pixel/export test. | High | 50–51 | Store/export/tests | No | No | Yes | P7 |

### 4.7 Compound image layouts

| Checklist item | Status | Exact gap | Severity | Pages | Likely files/subsystems | Schema | Migration | Export | Phase |
|---|---|---|---|---|---|---|---|---|---|
| Side-by-side pair | Partial | Can be manually approximated with two independent full-span positioned images, but UI guard blocks creation and no pair primitive/helper exists. | Critical | 50 | Structured renderer/shell | Yes for durable helper metadata | Yes | Yes | P4 |
| Configurable horizontal gap | Missing | No pair gap contract. | High | 50 | Group/alignment helper | Yes | Yes | Yes | P4 |
| Independent pair captions | Partial | Independent image captions exist; pair workflow does not. | High | 50 | Image nodes/group helper | No | No | Yes | P4 |
| Group movement | Missing | No group selection or movement. | High | 50–51 | Page image-group metadata/commands | Yes | Yes | Yes | P4 |
| Individual child editing | Partial | Independent images are editable, but not as members of a group. | Medium | 50–51 | Selection/group helper | Yes | Yes | No | P4 |
| Vertical stack | Partial | Two independent fixed images can be manually stacked; no stack workflow or constraints. | Critical | 51 | Structured renderer/group helper | Yes | Yes | Yes | P4 |
| Configurable vertical gap | Missing | No stack gap contract. | High | 51 | Group helper | Yes | Yes | Yes | P4 |
| Shared-width option | Missing | Images retain independent widths only. | High | 51 | Group helper | Yes | Yes | Yes | P4 |
| Independent stack captions | Partial | Per-image captions exist without stack semantics. | High | 51 | Image nodes/group helper | No | No | Yes | P4 |
| Stack beside flowing text | Partial | Independent exclusion rectangles can approximate it; toolbar and deterministic stack layout are missing. | Critical | 51 | Layout kernel/group helper | Yes | Yes | Yes | P3/P4 |

### 4.8 Persistence

| Checklist item | Status | Exact gap | Severity | Pages | Likely files/subsystems | Schema | Migration | Export | Phase |
|---|---|---|---|---|---|---|---|---|---|
| Stable IDs | Partial | New IDs are stable; missing/duplicate legacy IDs are not repaired. | High | 49–51 | Project migration/image schema | Yes | Yes | Yes | P5 |
| Structured serialized attributes | Complete | Image geometry/caption/wrap attrs are JSON. | Low | 49–51 | Tiptap schema | No | No | Yes | — |
| Schema versioning | Partial | Project v2 exists; document/node changes have no independent version. | High | 49–52 | Project schema | Yes | Yes | Yes | P5 |
| Migrations | Partial | General normalization and defaults exist, but no explicit document-node/group/page evolution chain. | High | 49–52 | Project schema/recovery | Yes | Yes | Yes | P5 |
| Missing-asset handling | Present but fragile | Flow nodes show “Image unavailable”; overlays disappear; no validation/report/repair. | High | 49–51 | Node view/overlay/project inspection | Possibly | Possibly | Yes | P5 |
| Bounded/debounced saves | Complete | 900 ms debounce, revision/session guards, size cap. | Low | 49–52 | Store/DB | No | No | No | — |
| No save/hydration loops | Complete | Current tests cover race/session and startup regressions. | Low | 49–52 | Store/startup | No | No | No | — |
| No unbounded IndexedDB growth | Present but fragile | Logical rows are bounded, but orphan/duplicate base64 assets grow payloads and duplicate legacy rows are all rewritten. | Critical | 49–51 | Asset lifecycle/DB update | No | No | Indirect | P5 |
| Identical reload layout | Partial | JSON reload is proven; pixel-identical layout is not. | Critical | 49–52 | Layout/fonts/tests | No | No | Yes | P7 |
| Export reads committed state | Present but fragile | Export clones mounted DOM and can capture structured preview overrides not yet in Tiptap/store. | High | 49–51 | Export/structured interaction | No | No | Yes | P6 |
| Recovery supports new types/attrs | Partial | Opaque preservation helps, but recovery performs shallow document validation and has no document fixture. | High | 49–52 | Recovery Python/schema tests | Yes when types added | Yes | Yes | P5 |

### 4.9 Export

| Checklist item | Status | Exact gap | Severity | Pages | Likely files/subsystems | Schema | Migration | Export | Phase |
|---|---|---|---|---|---|---|---|---|---|
| PDF output | Partial | One-page raster PDF only. | Critical | 49–52 | Document export service | No | No | Yes | P1/P6 |
| Correct physical dimensions | Complete | PNG pixels and PDF MediaBox are tested. | Low | 49–52 | Export service | No | No | Yes | — |
| Correct image placement | Present but fragile | DOM is cloned, but exported geometry/pixels are not tested. | Critical | 49–51 | Layout/export/tests | No | No | Yes | P6/P7 |
| Correct wrapping | Present but fragile | Same mounted structured DOM is retained; no visual proof and CSS/manual paths differ. | Critical | 49–52 | Layout/export/tests | No | No | Yes | P6/P7 |
| Correct captions | Present but fragile | Text survives clone; alignment/geometry pixels are not verified. | High | 49–51 | Export/tests | No | No | Yes | P6/P7 |
| Correct column flow | Present but fragile | Markup survives; no exported reading-order or visual geometry assertion. | Critical | 49–52 | Layout/export/tests | No | No | Yes | P6/P7 |
| Correct background | Missing | White is hard-coded/defaulted; project cream metadata is ignored. | High | 49–52 | Shell/export/page view | No | No | Yes | S0 |
| Correct page numbers | Missing | No page-number renderer/model. | Critical | 49–52 | Page/export | Yes | Yes | Yes | P1 |
| Print-resolution images | Partial | Page raster is 300 DPI, but source effective DPI is not checked or warned. | High | 49–51 | Asset metadata/export | Possibly | Yes if metadata added | Yes | P6 |
| Predictable font handling | Partial | Waits for browser fonts and rasterizes computed styles; no embedded/selectable PDF text or substitution report. | High | 49–52 | Export/font registry | Possibly | Possibly | Yes | P6 |
| No editor chrome | Complete | Marked nodes are removed. | Low | 49–52 | Export cleanup | No | No | Yes | — |
| Tests for all four layouts | Missing | No target recipes/goldens. | Critical | 49–52 | Fixtures/Playwright | No | No | Yes | P7 |

### 4.10 Testing

| Checklist item | Status | Exact gap | Severity | Pages | Likely files/subsystems | Schema | Migration | Export | Phase |
|---|---|---|---|---|---|---|---|---|---|
| Serialization and geometry unit tests | Complete | Strong current image geometry and project round-trip coverage. | Low | 49–51 | Unit tests | No | No | Some | — |
| Document editing integration tests | Complete | Extensive jsdom shell/Tiptap coverage. | Low | 49–52 | `document-editor.test.ts` | No | No | Some | — |
| Save/reload tests | Partial | Single-page and one span covered; no compound/four-page visual equality. | High | 49–52 | Store/Playwright | No | No | Yes | P7 |
| Reconstruction tests | Partial | Synthetic one-page article only. | High | 49–52 | Playwright/fixtures | No | No | Yes | P7 |
| Drag/resize multiple zoom levels | Complete | Structured image parameterized tests and browser fit-zoom drag. | Low | 49–51 | Unit/Playwright | No | No | No | — |
| Multi-image collision tests | Partial | Geometry and one two-image integration test; no browser insertion/reload/export. | High | 50–51 | Unit/Playwright | No | No | Yes | P7 |
| Caption persistence tests | Partial | String-level persistence exists; style/multi-caption/export pixels absent. | High | 49–51 | Store/export/Playwright | No | No | Yes | P7 |
| Side-by-side tests | Missing | No durable feature. | High | 50 | Unit/Playwright | No | No | Yes | P4/P7 |
| Vertical-stack tests | Missing | No durable feature. | High | 51 | Unit/Playwright | No | No | Yes | P4/P7 |
| Page-number parity tests | Missing | No feature. | Critical | 49–52 | Unit/Playwright/export | No | No | Yes | P1 |
| Export tests | Partial | Dimensions, cleanup, markup, downloads; not visual content fidelity. | Critical | 49–52 | Export tests | No | No | Yes | P6/P7 |
| Playwright coverage | Partial | Five document tests; one span and one simple article export. | High | 49–52 | E2E | No | No | Yes | P7 |
| Visual regression strategy | Missing | Screenshots only on failure; no baselines or pixel diffs. | Critical | 49–52 | Playwright/CI artifacts | No | No | Yes | P7 |

## 5. Architecture decisions

### How columns are represented

`DocumentPage.columnCount` and `columnGapPx` are page attributes. Ordinary flow is CSS multi-column layout on one Tiptap DOM. Structured spanning-image flow is a separate React-rendered set of absolute text bands generated from serialized Tiptap HTML. Columns are not Tiptap nodes and are not stored as regions.

This is adequate as a persisted semantic model—column count/gap plus content and image exclusions—but the two rendering algorithms must be consolidated behind one layout contract.

### How image coordinates are represented

- Overlay `xPx`/`yPx`: unzoomed CSS pixels from the physical page origin.
- Structured `yPx`: unzoomed CSS pixels from the **body region top**, not the page top.
- Structured `xOffsetPx`: unzoomed CSS pixels from the left edge of the selected column span.
- `spanStartColumn`: determines that span origin.
- Width/height: unzoomed CSS layout pixels.
- Flow images: semantic document position with no free X/Y.

Pointer deltas are divided by `viewScale`; persisted values are not zoom-scaled. This is mostly coherent, but “px” has three origins (page, body, and span) and the types do not encode them. Conversion code in `convertSelectedFlowToOverlay` and `handleLayoutChange` performs ad hoc origin changes, including fixed offsets.

Recommendation: retain unzoomed 96-CSS-px/in layout units, but name coordinate spaces explicitly in types and centralize conversions: `PagePoint`, `BodyPoint`, `SpanOffset`, and `ViewportPoint`. Do not persist zoomed coordinates.

### How exclusion rectangles are computed

`buildMultiDocumentSpanLayoutModel` calculates the image rectangle from span geometry and placement, measures caption height, expands horizontally by `wrapPaddingPx` and vertically by `verticalSpacingPx`, intersects rectangles with each column, and creates free X intervals for each Y band. Text is then allocated into bands by measured height and whitespace splitting.

Caption inclusion is correct in intent. The algorithm should be extracted into a pure geometry/layout module with an injected text measurer and explicit reading-order rules. DOM parsing and React preview state should be adapters, not the layout engine.

### How captions are represented

Captions are strings on image nodes and overlay records, not sibling paragraphs. They move and persist with their image. This is the right structural baseline. The gap is style metadata and rich caption editing, not ownership.

### Whether image groups exist or group nodes are advisable

No image groups exist in the document editor. Fabric grouping is unrelated.

An explicit nested Tiptap image-group node is **not** the smallest durable next architecture. The active layout code discovers individual `documentFlowImage` nodes but matches them to top-level serialized HTML children; nesting would break that assumption and complicate selection, migration, and text allocation.

Recommended approach:

1. Keep individual image nodes as the canonical children.
2. Remove the single-span UI guard.
3. Add alignment/distribution commands that operate on selected image IDs.
4. When persistent group movement/gap/shared-width behaviour is implemented, add a small page-level `imageGroups` array keyed by stable child image IDs, with `kind: 'row' | 'stack'`, ordered children, gap, and optional shared-width policy.
5. Keep group metadata declarative; derive child rectangles through the same layout kernel.

This preserves individual editing and captions, avoids nested-node migration, and supports group movement. It does require atomic store helpers so body-content and group metadata cannot diverge.

### Whether page-level layout regions are needed

Persisted arbitrary page-region nodes are not required for pages 49–52. A reusable page layout kernel can derive text bands from:

- the page/body content rectangle,
- column count/gap,
- title height,
- positioned image/caption/group exclusion rectangles, and
- optional keep rules.

Page 50’s lower pair and page 51’s right stack can be exclusions; page 52’s blank final area is natural remaining space. Persist page regions only if later products require independently authored text stories or non-continuous reading orders. Introducing regions now would duplicate content ownership and add unnecessary editing complexity.

No document layout is hard-coded specifically to pages 49–52 or to a document recipe. The only historical-article content found is synthetic Harwood text inside `__tests__/document-editor.test.ts` and `e2e/document-reconstruction.spec.ts`. The recipe system under `src/editor/recipes/` generates Fabric canvas projects and is not connected to `DocumentEditorShell`. Conversely, several layout constants are globally hard-coded rather than recipe-specific: 96 CSS px/in, 14 px body text, 1.42 line height, 24 px default column gap, 72 px minimum free text-band width, and 720 px fallback structured width/height.

There is also no code path that treats captions as free-standing body paragraphs: current captions are correctly stored inside image attributes. The risk is fixed plain-string styling and the separate overlay/image schemas, not caption ownership.

### Whether the current editor schema can support the target

Yes, incrementally. Tiptap can add bounded paragraph/style attributes and semantic block nodes; the project can add pages, folio settings, style definitions, and optional image-group metadata. The image nodes already have the essential stable asset/geometry/caption attributes.

Required evolution:

- a document-specific schema version/migration chain,
- multi-page project/store/UI support,
- named text styles and semantic blocks,
- cleaned-up image IDs and coordinate contracts,
- a shared layout kernel,
- group helper metadata,
- multi-page export.

No evidence requires replacing Tiptap.

### Whether editor and export share a layout engine

Not in a durable sense. Export clones the mounted editor DOM after the editor/structured renderer has already laid it out. It does not reconstruct layout from committed JSON. The apparent sharing is DOM snapshot coupling, not a reusable engine.

Risk of divergence is high:

- normal CSS columns and structured manual columns differ;
- editing and structured viewing are different DOM representations;
- drop caps work on `.ProseMirror` but not structured text bands;
- export can capture transient structured preview state;
- print, PNG/PDF rasterization, and screen rendering depend on different browser contexts;
- project background metadata is ignored by both page rendering and the shell export call.

## 6. Persistence and recovery risk review

### Autosave and hydration

Positive findings:

- `queueAutosave` coalesces edits for 900 ms.
- `revision` prevents a completed write from marking newer edits saved.
- `projectSessionToken` prevents writes from a replaced session updating live state.
- hydration cancels pending autosave.
- Flow/title editors set incoming content without emitting updates when unfocused.
- unit tests cover in-flight edits, replaced sessions, unsupported hydration, and debouncing.

Risks:

- Every Tiptap transaction updates the entire `bodyContent` JSON and eventually serializes the entire project, including all base64 assets.
- Overlay dragging calls `updateOverlay` on every pointer move. Debouncing usually coalesces writes, but a pause longer than 900 ms during a drag can save an intermediate state; repeated interactions create significant LevelDB revision churn.
- `updateProjectTimestamp` changes the serialized payload for every actual save, so payload fingerprinting cannot suppress a dirty save even if only save metadata changed.

### Serialization and schema evolution

The v2 project envelope is validated, but document page normalization is a reconstruction, not a versioned migration. It drops unrecognized page-level fields because `normalizeDocumentProjectPage` returns a new fixed shape. Tiptap body JSON is retained opaquely, which protects current node attrs but gives no repair for:

- missing/duplicate image IDs,
- unsupported future node types,
- orphan group references,
- missing asset IDs,
- invalid coordinate-space values.

New pages, named styles, group metadata, and folio settings should not be added under unchanged v2 semantics without an explicit migration contract.

### Asset persistence and IndexedDB growth

The most plausible path back to uncontrolled database growth is normal document asset churn:

1. Every import/replace creates a new data URL under a new asset ID.
2. Image deletion or replacement does not remove the previous asset.
3. Importing the same image again does not content-deduplicate it.
4. Every autosave rewrites the full JSON payload.
5. Chromium LevelDB may retain historical values until compaction.

The 100 MB character cap eventually stops saves, but it does not keep growth modest or recover unused storage.

A second amplification path exists for damaged legacy databases: `DesignSpaceDB.updateProject` uses `canvasData.where('projectId').equals(projectId).modify(...)`. If a prior bug left multiple JSON rows for one project, every save rewrites all of them even though `loadProject` reads only `project.canvasDataId`.

Required controls:

- reference-count or reachability-based asset GC at committed transaction/save boundaries;
- content-hash deduplication for document assets;
- update only the referenced `canvasDataId`, quarantine/report duplicates;
- payload byte/asset count telemetry before the hard limit;
- tests that replace/delete/reinsert images hundreds of times without payload growth.

### Browser recovery and Tauri recovery

Startup protection is intentionally conservative and avoids opening suspect IndexedDB. Tauri recovery is read-only until the separately confirmed cleanup phase and has bounded record, output, event, and metadata sizes. These are strong controls.

Gaps:

- `recover_indexeddb.py:validate_and_migrate` only checks that a document project has a document page. It does not validate the document schema or referenced assets before marking recovery `complete: true`.
- Same-project asset deduplication replaces any string exactly equal to an asset ID anywhere in the payload, not only known asset-reference fields. That is broad, though accidental caption/text matches are unlikely.
- Recovery tests exercise canvas fixtures; there is no recovered document containing current image attrs, multiple images, missing assets, or future group/style nodes.
- Browser project inspection validates only the assets envelope type before normalization.

### Reload and export state

Reload reproduces serialized attributes, but the rendered layout is recomputed from current DOM/font metrics. “Identical layout” is therefore not proven.

Export reads the mounted DOM, not a committed snapshot. During structured drag/resize, `previewOverrides` change layout without changing Tiptap JSON. An export started during that state can capture preview geometry. Export should either flush/cancel interactions and serialize a committed snapshot, or construct an offscreen renderer from committed project data.

## 7. Test coverage assessment

### Existing relevant tests

- `__tests__/document-editor.test.ts`
  - shell structure, columns, margins, drop-cap state, text editing, font sizes, image modes, geometry, structured movement/resize, stale-position ID commit, two-image exclusions/collision, selection, and zoom.
- `__tests__/document-store.test.ts`
  - page/project mutations, v2 persistence, orientation, structured image JSON, autosave/race/session behaviour.
- `__tests__/document-export.test.ts`
  - physical dimensions, clone cleanup, structured markup retention, font/image waiting, SVG dimensions, one-page PDF MediaBox, print CSS.
- `__tests__/document-assets.test.ts`
  - image validation, clipboard, reference PDF rasterization, sanitization.
- `__tests__/project-schema.test.ts`
  - v1/v2 routing, document normalization, recovery metadata, quarantine.
- `__tests__/db-write-deduplication.test.ts`
  - unchanged JSON-row write suppression.
- `__tests__/startup-storage-recovery.test.ts`
  - localStorage quarantine and IndexedDB startup gate.
- `e2e/document-reconstruction.spec.ts`
  - five Chromium workflows, including one structured span save/reload/PNG download and one simple article PNG/PDF export.
- `e2e/startup-stability.spec.ts`, `e2e/indexeddb-recovery-fixture.spec.ts`, `e2e/recovery-workspace.spec.ts`
  - startup and recovery regression coverage.
- `src-tauri/recovery_tools/tests/test_recovery.py` and Rust tests in `src-tauri/src/recovery.rs`
  - bounded extraction, deduplication, backup/resume/cleanup safety.

### Tests that prove behaviour

- Tiptap JSON and store round trips prove current attributes persist.
- Revision/session autosave tests prove stale async writes do not overwrite live state.
- Stable-ID commit tests prove a drag commit can recover from a stale ProseMirror position.
- Parameterized structured resize tests prove pointer deltas are unscaled and commits are undoable.
- Real-browser structured span tests prove selection, drag, resize, save, reopen, and DOM geometry in one environment.
- PNG dimension and PDF MediaBox tests prove physical output boxes.

### Brittle or insufficient tests

- Many structured unit tests run in jsdom with fallback height estimation. They can pass while Chromium typography and band breaks are wrong.
- Export clone tests assert retained attributes/text, not actual rendered pixels.
- The Playwright export test checks a white corner, PNG dimensions, PDF page size, and absence of browser errors. It would pass if article text, captions, wrapping, or image placement were blank or wrong elsewhere.
- The structured Playwright test downloads PNG but never decodes regions around the image or compares a screenshot.
- Drop-cap tests check a toggle/data attribute, not computed or exported appearance.
- Multi-image coverage constructs Tiptap JSON directly; it does not expose the toolbar guard that prevents a user-created second span.
- Recovery has no document fixture.
- No test renders multiple document pages because the model rejects them.

### Missing test classes

- document schema migration tests with missing/duplicate IDs;
- asset reachability/GC and repeated replacement-size tests;
- multi-page save/reload/navigation tests;
- page-number parity and starting-folio tests;
- inner/outer margin parity tests;
- named typography/style serialization tests;
- structured drop-cap, heading keep, hyphenation, widow/orphan tests;
- real-browser creation/reload of two positioned images;
- side-by-side and vertical-stack group tests;
- multiple-image collision insertion and initial-overlap tests;
- printable-boundary tests for overlays and structured images;
- export-from-committed-state versus active-preview tests;
- recovered document fixtures with current and future node attributes;
- effective image DPI warning tests;
- four target layout export tests.

### Recommended Playwright and visual regression additions

Create one deterministic fixture/project recipe per target page and a four-page project fixture. For each:

- assert semantic/project JSON after editing;
- save, close, reopen, and assert geometry in unzoomed layout coordinates;
- export PNG at 300 DPI and PDF;
- compare full-page PNGs against reviewed baselines with a small antialiasing tolerance;
- add focused crops for title/drop cap, each image/caption, exclusion boundaries, and folio;
- rasterize PDF pages in CI and compare them to the same baselines;
- run at 50%, fit, 100%, and 150% zoom for interaction tests while expecting identical committed layout values;
- use pinned web fonts or repository-hosted font files so visual baselines are reproducible.

## 8. Recommended implementation roadmap

### S0 — Wire the existing paper background through editor and export

**Objective:** make the existing normalized document background authoritative.  
**User-visible result:** new and reopened document pages display/export cream paper, with a basic paper-colour control.  
**Likely files:** document store, shell, page view, sidebar, export call/tests.  
**Schema:** none; `project.document.background.value` already exists.  
**Migration:** none; normalization already defaults `#FAF8F5`.  
**Tests:** store update, editor computed background, clean clone, PNG corner colour, reload.  
**Risks:** avoid a second page-level background source of truth.  
**Completion:** screen, PNG, PDF, and print use the same committed colour and no test expects hard-coded white.

### P1 — Multi-page document and folio vertical slice

**Objective:** support four document pages with per-page configuration, parity, navigation, and multi-page PDF.  
**User-visible result:** users can create/reorder/select four pages, assign starting page 49, use inner/outer margins, and see 49/51 right and 50/52 left folios.  
**Likely files:** `DocumentPage`, project schema, document store, shell/page view, a document page strip, export service.  
**Schema:** add document schema version, folio settings, page parity/margin semantics, and active page.  
**Migration:** convert one-page v2 documents losslessly, derive inner/outer from current left/right.  
**Tests:** migration, four-page save/reload, parity, page navigation, multi-page PDF MediaBoxes/order, no page-number editor chrome.  
**Risks:** duplicated project/page size sources; autosaving only the active page; mounting/exporting inactive pages.  
**Completion:** a saved/reopened project has four independently editable pages numbered 49–52, and one four-page PDF preserves order/parity.

### P2 — Named typography and semantic article styles

**Objective:** provide durable historical-publication typography.  
**User-visible result:** full justification, blue title, subsection heading, caption, author credit, quotation, and configurable drop cap are selectable named styles.  
**Likely files:** Tiptap extensions, title/body editors, toolbar/sidebar, page CSS, project types/schema.  
**Schema:** style definitions/IDs, paragraph style attribute, expanded text-style attributes, drop-cap settings, page language.  
**Migration:** map current title, body, captions, and `dropCap: true` to default named styles.  
**Tests:** JSON/HTML round trip, selection behaviour, style inheritance, structured layout measurement, export visual crops.  
**Risks:** arbitrary CSS injection; changing layout when old projects open; style-copy duplication between title/body.  
**Completion:** every target text role is model-backed, editable, reusable, and visually identical after reload/export.

### P3 — Consolidated layout kernel and complete positioned-image contract

**Objective:** make one deterministic layout path own columns, exclusions, overflow, coordinates, boundaries, and collisions.  
**User-visible result:** users can create multiple positioned wrapping images, drag/nudge/resize them at any zoom, and get stable live reflow.  
**Likely files:** replace duplicated functions in `StructuredDocumentSpanLayout.tsx` with `document/layout/*`; FlowEditor, image extension, inspector, page CSS/export adapter.  
**Schema:** likely document schema bump for explicit coordinate-space and four-side wrap padding; preserve current attrs through migration.  
**Migration:** normalize/repair IDs, clamp values, translate current body/span offsets without visual movement.  
**Tests:** pure geometry, reading order, keep rules, initial overlaps, boundary constraints, multi-zoom browser interactions, committed/export state.  
**Risks:** changing existing band breaks; selection mapping between rendered columns and ProseMirror; performance during typing.  
**Completion:** CSS-only and structured paths no longer disagree, all exclusion rectangles use one kernel, and output is deterministic under pinned fonts.

### P4 — Compound image alignment and grouping helpers

**Objective:** support page 50’s pair and page 51’s stack without nested group nodes.  
**User-visible result:** align two selected images into a row or stack, set gap/shared width, move the group, then edit either child/caption.  
**Likely files:** `DocumentPage.imageGroups`, store atomic helpers, toolbar, layout kernel, selection UI.  
**Schema:** page-level image-group records keyed by child image IDs.  
**Migration:** default empty groups; validate/remove orphan memberships.  
**Tests:** grouping/ungrouping, row/stack geometry, group movement, child edit, independent captions, reload/recovery/export.  
**Risks:** body-content/group metadata atomicity; delete/reorder membership cleanup.  
**Completion:** pair and stack operations meet all compound checklist items and survive save/reload/export.

### P5 — Persistence, assets, migrations, and recovery hardening

**Objective:** keep richer documents bounded and recoverable.  
**User-visible result:** repeated image work does not bloat projects; missing assets are reported and repairable; recovered documents retain all features.  
**Likely files:** document asset service/store, DB, project schema/open service, recovery Python/Rust/tests.  
**Schema:** asset metadata/content hashes and document schema version if not already added.  
**Migration:** hash/deduplicate existing assets, repair IDs, validate group/style references.  
**Tests:** repeated replace/delete/import, duplicate legacy rows, missing assets, document recovery fixtures, failed/interrupted migration.  
**Risks:** deleting still-referenced assets; large one-time migration cost; portable-file compatibility.  
**Completion:** reachable assets alone are persisted, one JSON row is updated, payload growth is bounded, and current document fixtures recover as complete only after deep validation.

### P6 — Committed-state, multi-page print-quality export

**Objective:** export from a committed project snapshot through the same layout kernel.  
**User-visible result:** four-page PDF/PNG output has correct cream background, folios, typography, images, wrapping, and captions.  
**Likely files:** document export service, offscreen document renderer, font registry, layout kernel, print CSS.  
**Schema:** only if font embedding/effective-DPI metadata is persisted.  
**Migration:** defaults for fonts/DPI policy.  
**Tests:** preview-state exclusion, source DPI warnings, font substitution/embedding, four-page PDF raster comparisons.  
**Risks:** browser `foreignObject` font behaviour, memory at four 300-DPI pages, raster-only PDF accessibility/searchability.  
**Completion:** export does not depend on active UI state; all four pages pass visual regression and physical-size checks. A later vector/text PDF path may remain a documented enhancement.

### P7 — Historical page recipes and release-quality visual regression

**Objective:** encode pages 49–52 as acceptance fixtures.  
**User-visible result:** the application can recreate, reopen, and export the requested article layouts repeatably.  
**Likely files:** fixtures/recipes, Playwright specs, visual baselines, CI artifact configuration.  
**Schema:** none beyond earlier phases.  
**Migration:** none.  
**Tests:** one focused test per page plus four-page round trip/export; screenshot and PDF raster baselines.  
**Risks:** nondeterministic fonts/antialiasing; overly broad screenshot tolerances.  
**Completion:** reviewed baselines pass in CI, and each target requirement is tied to at least one behavioural and one visual assertion.

## 9. Immediate next slice

### Recommendation: authoritative cream paper colour

This is the best single focused session because it is visible on every target page, directly fixes a known editor/export mismatch, and uses an existing persisted field without changing schemas or migrations.

**Exact scope**

- Add a bounded paper-colour update action that writes `project.document.background.value`.
- Expose a simple document paper colour input in the page settings, defaulting to the already normalized `#FAF8F5`.
- Pass that committed value to `DocumentPageView` and apply it to the sheet/export root.
- Pass the same value as `backgroundColor` to PNG, PDF, and print export.
- Replace the Playwright white-corner assertion with the committed cream RGBA value.

**Explicit non-goals**

- no multi-page work;
- no page numbers or mirrored margins;
- no named colour palette/theme integration;
- no typography or image-layout changes;
- no broad export refactor;
- no new schema version.

**Acceptance criteria**

1. A new blank document visibly uses `#FAF8F5`.
2. Changing the paper colour marks the document dirty and autosaves through the existing path.
3. Save/reopen and portable project download/reopen preserve the colour.
4. PNG and PDF page backgrounds use the same colour; print clone does too.
5. Reference scans and editor chrome remain excluded.
6. No new page-level colour field is introduced.

**Tests to add**

- document-store test for background update and reload;
- document-editor test for page/export-root style;
- export service test that supplied colour fills the output path;
- Playwright save/reopen test and decoded PNG corner-pixel assertion;
- regression assertion that default normalization remains `#FAF8F5`.

**Likely files to modify**

- `src/document/state/documentStore.ts`
- `src/document/components/DocumentEditorShell.tsx`
- `src/document/components/DocumentPageView.tsx`
- `src/document/components/DocumentSidebar.tsx`
- `src/document/services/documentExportService.ts` only if the existing option path needs tightening
- `__tests__/document-store.test.ts`
- `__tests__/document-editor.test.ts`
- `__tests__/document-export.test.ts`
- `e2e/document-reconstruction.spec.ts`

**Rollback considerations**

The change is data-compatible because the field already exists and is normalized. Rollback consists of removing the control/wiring; saved v2 files remain readable and the unused background metadata remains harmless. Keep hard validation to CSS colour values so malformed project strings cannot become arbitrary style text.

## 10. Open questions

1. Should the four source pages be stored as four independently editable page stories, or should body text be one continuous story automatically flowing across pages? The current editor is one story per page; this choice materially changes page-break editing and overflow semantics.
2. What exact physical trim size and historical font family should pages 49–52 use? The repository contains only Letter/A4 defaults and Georgia/Times fallbacks.
3. Should the deliverable PDF prioritize searchable/selectable text and embedded fonts, or is a print-resolution raster-backed PDF acceptable? The current path provides the latter only.
4. Should automatic hyphenation use a specific language/dictionary, and is preserving the source publication’s exact line breaks more important than responsive reflow after editing?

## Verification performed

- `npm run lint` — passed.
- `npm test` — 17 files, 258 tests passed.
- `npm run build` — TypeScript and Vite production build passed.
- `npm run test:recovery` — 2 recovery-tool tests passed.
- `npm run test:e2e -- e2e/document-reconstruction.spec.ts` — 5 Chromium tests passed.
- One initial `npm test -- --runInBand` attempt failed because Vitest does not support the Jest `--runInBand` option; the correct test command was then run successfully. This is not a repository failure.
