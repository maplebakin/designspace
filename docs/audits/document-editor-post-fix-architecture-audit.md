# Document editor post-fix architecture audit

Audit scope: the current local working tree at `31b958f7ea1f65f7b907ba1d60b2d023d606debe`.

This is a read-only architecture audit. No runtime behavior, source file, test,
snapshot, or `AGENTS.md` file was changed. The only artifact created by this
audit is this report.

## Executive conclusion

**Verdict: C — the Document editor has overlapping ownership models and should
be simplified before further targeted fixes.**

The persisted document model and the structured page compositor are viable. The
problem is the boundary around active text editing. The canonical page is
fragment-based, while the local editing overlay introduced by `31b958f7` is
keyed to a top-level ProseMirror block. A block can be split into several
structured fragments, but the overlay selects one fragment as its geometry and
masks all fragments for that block. The current visible jump is therefore
consistent with a real abstraction mismatch, not merely a missing CSS offset.

There are also several deliberate but competing mirrors of state: ProseMirror
selection, shell selection state, document-store selection IDs, structured
layout records, the copied `SelectedDocumentImage.position`, and toolbar
projections. The stable image-ID helpers make the principal selection route
safe, but cached-position and mirror-based routes remain around it. Similar
duplication exists in live text rendering, draft/store synchronization,
dirty-state publication, and legacy compatibility adapters.

This does not justify reconsidering the entire structured layout approach. It
does justify consolidating the text block/fragment identity boundary, selection
projection, and compatibility paths before adding more narrowly targeted
interaction fixes.

The reported text jump was **not fixed during this audit**.

## 1. Repository state

The repository state was recorded before creating this report:

| Item | State |
|---|---|
| Branch | `main` |
| HEAD at audit start | `31b958f7ea1f65f7b907ba1d60b2d023d606debe` (`fix(document): preserve canonical layout during typing`) |
| Upstream | `origin/main` at `bde21c927d957b8080be817c801fc05fe7ce2911` |
| Commits ahead of upstream | 1 (`31b958f7`) |
| Unstaged changes | None |
| Pre-existing staged changes | `AGENTS.md` only |
| Source changes after `31b958f7` | None |
| Snapshot changes | None |
| Staged `AGENTS.md` index blob | `dc8c3cd4fe8d128614bfa0a6c2c7e7ca5bb88d22` |

`AGENTS.md` is absent from the base commit and was already staged when the
audit started. It was not included in this report's change and was not
rewritten.

## 2. Runtime architecture map

The current runtime can be represented as follows:

```text
UnifiedEditorSession
├── ProjectChangeCoordinator
│   └── ProjectLifecycleAuthority
│       ├── exact lifecycle snapshot/revisions
│       └── coalesced presentation snapshot
├── useLegacyProjectSessionBridge
│   ├── documentStore project/status subscriptions
│   ├── compatibility command/mutation adapters
│   └── shared document/canvas session adapter
└── UnifiedEditorChrome
    └── DocumentEditorShell
        ├── shell selection/focus/toolbar/reference state
        ├── live draft queue and flush boundaries
        ├── page/project operations and export orchestration
        └── DocumentPageView
            ├── page sheet and paper background
            ├── ScanReferenceLayer (editor-only)
            ├── document-page-export-root
            │   ├── title FlowEditor / Tiptap editor
            │   ├── body FlowEditor / Tiptap editor
            │   │   ├── .document-flow-prosemirror
            │   │   │   └── DocumentImageNodeView source nodes
            │   │   └── StructuredDocumentSpanLayout
            │   │       ├── structured text-band HTML fragments
            │   │       ├── structured span image slots/chrome
            │   │       ├── ordinary-flow image hit targets
            │   │       └── local active-block CSS overlay
            │   └── editor-only overlays/folio/warnings
            └── export-only offscreen renderer/service
                ├── fresh committed page/layout render
                └── clean clone/rasterization
```

There is one persisted title/body ProseMirror JSON representation. There are
several transient or derived representations of that same content:

* the mounted ProseMirror source DOM;
* structured text-band fragments produced by
  `buildMultiDocumentSpanLayoutModel`;
* the active-block view that exposes selected ProseMirror children over the
  structured page;
* export renderer DOM and its cleaned clone.

The image model has the same intentional split: persistent image nodes and
attributes are in ProseMirror, while structured slots, flow-image hit targets,
chrome, and drag transforms are derived or transient.

### Inspected source inventory

| Path | Responsibility inspected |
|---|---|
| `src/document/components/DocumentEditorShell.tsx` | Page/session subscriptions, selection mirrors, text/photo handoff, live-draft flushing, reference import, image mutations, save/export/page operations. |
| `src/document/components/FlowEditor.tsx` | Tiptap lifecycle, PM selection and focus, structured-mode classes, layout reconciliation, image selection/position commits, overflow scheduling. |
| `src/document/components/StructuredDocumentSpanLayout.tsx` | Structured model construction, fragment allocation, image exclusions, point-to-position resolution, local editing overlay, drag/resize preview paths, structured hit targets. |
| `src/document/components/DocumentPageView.tsx` | Page sheet, title/body regions, reference placement, live/export root layering, paper-color ownership, editor-only title affordance. |
| `src/document/components/DocumentImageNodeView.tsx` | PM image source rendering, frame/caption/chrome, image hit handling, resize preview, stable-ID selection route. |
| `src/document/extensions/DocumentImageExtension.ts` | Image attributes, current-document image-ID traversal, stable-ID NodeSelection helper, image command boundary. |
| `src/document/components/DocumentToolbar.tsx` | Text/image/group/reference context priority, inspector ownership, toolbar render/format projections. |
| `src/document/styles/document-page.css` | Page/reference/source/CV/local-overlay/image/chrome visibility, stacking, pointer-events, columns, and title layout modes. |
| `src/document/state/documentStore.ts` | Project/page persistence, specialized text commits, generic page updates, image-group repair, dirty/status, save/autosave, page operations, reference state. |
| `src/document/services/documentLiveDraft.ts` | Global live-draft flush registration and ownership. |
| `src/document/services/documentLiveTextDiagnostics.ts` | Existing counters and timing metrics for project churn, draft flushes, and live typing. |
| `src/editor/session/projectChangeCoordinator.ts` | Authored mutation observation and transaction subscribers. |
| `src/editor/session/projectChangeAdapters.ts` | Mutation adapter boundary from editor operations to the coordinator. |
| `src/editor/session/projectLifecycleAuthority.ts` | Exact revision/save watermark state, shared autosave, and coalesced presentation snapshot. |
| `src/editor/session/legacyRendererAdapters.tsx` | Legacy document-store subscriptions, unified-session bridge, compatibility commands and adapter modes. |
| `src/document/services/documentReferenceService.ts` | PNG/PDF reference ingestion, PDF.js render, raster validation, asset handoff, diagnostics. |
| `src/document/components/DocumentProjectExportRenderer.tsx` | Offscreen committed export render and removal of reference/editor-only layers. |
| `src/document/services/documentExportService.ts` | Clean clone, export exclusions, paper-color fill, PNG/PDF/print capture. |

## 3. Ownership matrix

Abbreviations used below:

* **PM** — Tiptap/ProseMirror document, selection, history, and source DOM.
* **CV** — canonical structured visual model and its text/image fragments.
* **LE** — local editing presentation: the single-column ProseMirror source
  with only active direct children exposed.
* **SH** — `DocumentEditorShell` state and projections.
* **DS** — document Zustand store and persisted project snapshot.
* **LA** — `ProjectLifecycleAuthority` and `ProjectChangeCoordinator`.
* **SR** — `ScanReferenceLayer`.
* **DG** — direct DOM drag-preview layer.
* **EX** — export renderer/service.

| State | Persistent/live content | Visible text and objects | Keyboard, caret, selection, pointer | Layout and image geometry | Dirty, persistence, reference, export | Multiple-owner finding |
|---|---|---|---|---|---|---|
| A. Document idle / no selection | DS is committed authority; PM is mounted projection. | CV is visible when any image is structured; otherwise PM source is visible. Structured source image nodes may be hidden. | No active text caret ownership. Structured bands and explicit image hit targets handle pointers. | CV or ordinary PM/CSS layout; image attributes are PM authority. | SR is editor-only; LA and DS own change/save state; EX is inactive. | Intentional mounted-source/derived-view duplication, but usually one visible text owner. |
| B. Body text selected, not actively typing | PM owns the selection; DS may be one draft flush behind. | Canonical CV remains visible; structured HTML can contain synthetic selection/caret decoration. | PM selection is authoritative, while SH tracks focused text region and toolbar format. Structured band resolves pointer positions. | CV remains frozen. | LA can observe transactions; no authored change for selection alone. | PM selection, SH focus state, and canonical selection decoration can disagree during transitions. |
| C. Active structured text editing | PM live draft is authoritative; `pendingTextDraftsRef` defers DS replacement. | Non-active CV fragments remain visible; active CV fragments are masked; LE exposes one or more PM direct children. | PM owns input/caret/history. Structured bands initiate text selection; injected CSS determines exposed PM children. | CV supplies geometry; LE uses DOM rects and local CSS. Images remain CV/DG-owned. | LA observes authored revisions; DS catches up on flush. SR remains visible. | **Yes:** PM source, CV fragments, LE, synthetic decoration, and SH focus all participate. Block-vs-fragment mismatch is the direct jump risk. |
| D. Title editing | PM title draft and shell live-draft boundary. | Title PM editor is the visible title owner; body uses its current mode. Empty title has an editor-only zero-flow affordance. | Title PM owns caret and input; SH owns title focus/context. | Title region changes when content becomes meaningful; body/CV geometry follows afterward. | LA/DS receive title content at draft flush; EX omits empty affordance. | Title PM plus page-flow region plus empty-title overlay are separate presentation states, but the title path is less fragmented than body editing. |
| E. Photo selected | PM NodeSelection is the intended authority. SH copies `selectedFlowImage`; DS stores `selectedFlowImageId`; structured IDs/group are also tracked. | Structured slot or explicit flow hit target is visible; source NodeView may also be mounted but hidden. | Stable image ID is used by the principal selection helper; shell/toolbar consume copied state. | CV image record and PM attributes describe the frame. | Selection is not authored; LA/DS remain unchanged. SR is pointer-transparent unless adjusting. | **Yes:** PM selection, shell object, store ID, structured IDs/group, toolbar object, and cached position are parallel representations. |
| F. Photo dragging | PM attrs remain unchanged until pointerup; DG holds transient position. | Slot/wrapper is moved by `translate3d`; chrome moves with it; CV remains the captured geometry snapshot. | Pointer capture and transient intent own the gesture. | Constraint/snap/collision calculations use the snapshot; one PM geometry commit is intended at pointerup. | One authored transaction at commit, then LA/DS/autosave. | Intentional transient DOM/model split; risk is stale handoff or a cached shell position, not the rAF transform itself. |
| G. Photo resizing | PM attrs remain unchanged during preview; `previewOverrides` carries React/model preview. | Structured model re-renders the preview; source/slot chrome follows that model. | Resize handle pointer target; shell/FlowEditor commit on completion. | Resize currently uses the expensive model-preview path, unlike drag. | One or more preview renders, then authored commit. | **Yes:** resize preview is a second geometry presentation path and can rebuild CV per pointer update. |
| H. Reference adjustment | DS reference settings/assets are the persisted authority. | SR paints the reference; document content remains above it. | SR receives pointers only when adjustment is enabled/unlocked; otherwise `pointer-events:none`. | Reference uses page-sized layer, scale, fit, and offset; content/CV geometry is separate. | `setReference` uses generic page update; reference is removed from EX. | Reference has a distinct pointer owner, but async import page capture can target the wrong page after navigation. |
| I. Save/autosave | PM may have a pending draft; flush makes DS current before serialization. | Existing page view remains visible; save chrome is LA presentation. | No new editor pointer owner. | No intended geometry change. | LA owns shared save scheduling; DS retains legacy dirty/status fields; adapter/store executes persistence. | **Yes:** LA and DS both expose dirty/save state; exact LA revisions and presentation LA snapshots intentionally differ. |
| J. Page switching | DS active page is persistent/navigation authority; global draft handler flushes mounted editor. | PM/CV remount for the new page. | Navigation command owns the gesture. | New page computes its own CV; old transient editing state is reset. | Shell/store operations flush drafts before switch. | Global singleton draft handler and page-captured async callbacks create cross-page risk. |
| K. Export/print | EX uses a committed clone/page input; shell flushes drafts first. | Fresh export renderer is the visible export surface; editor chrome/reference are excluded. | No editor input/caret. | Canonical layout is rebuilt in export context. | Paper color is explicit; reference is omitted. | EX is a separate renderer by design; stale output is possible only if a caller bypasses a required flush boundary. |

The most important ownership conflict is state C. The page needs canonical
fragment geometry for reconstruction, but input needs a cheap PM editing owner.
The current implementation uses both and connects them through a block index,
which is not a one-to-one visual identity.

## 4. Text-rendering ownership audit

| Representation | Mounted state | Visible state | Interactive state | Geometry/style source | Coverage and transition behavior |
|---|---|---|---|---|---|
| Canonical PM document model | Always represented in the editor state while the editor is mounted. | Not itself a paint surface. | PM remains the document, history, and selection authority. | ProseMirror node positions and attributes. | The source model survives every presentation change. |
| `.document-flow-prosemirror` | Mounted by `FlowEditor`. | Ordinary pages show it; structured idle mode applies `structured-source` and hides it; active editing makes it a cheap single-column source. | Native contenteditable/input and PM caret. The root is generally pointer-transparent in structured overlay mode, with focus retained by PM. | PM DOM, page CSS, typography, zoomed parent. | It changes from hidden to absolute/single-column on entry to structured editing. Direct-child visibility is then injected by `StructuredDocumentSpanLayout`. |
| Structured text bands | Mounted by `StructuredDocumentSpanLayout` when a span image activates structured mode. | Canonical visible text in structured mode; raw `dangerouslySetInnerHTML` band fragments. | Band pointer handlers resolve coordinates to PM positions; bands are not contenteditable. | Multi-column allocator, measured HTML fragments, image exclusions, and line boxes. | One PM block can become several band fragments. This is the canonical page view, not a source editing DOM. |
| Local active editing overlay | Implemented by CSS rules injected by the structured layout component. | Only selected PM direct children are exposed; other PM children remain `visibility:hidden`; active canonical fragments are marked transparent. | PM child supplies the actual caret/input; the structured band remains the pointer-selection surface. | Canonical fragment DOM rectangle, source-root DOM rectangle, and `scaleX/scaleY` computed from those roots. | It positions a whole PM block at one selected fragment rectangle. It is not fragment-aware when a block is split. |
| Document image NodeViews | Mounted as PM source nodes. | Hidden by structured-mode CSS where CV has a corresponding image; visible in ordinary source mode. | NodeView image/frame routes selection and resize when it is the active visible owner. | PM image attributes and NodeView frame geometry. | This is a second image representation, intentionally hidden in structured states; visibility failure would create duplication. |
| Export renderer | New offscreen `DocumentProjectExportRenderer`/clean clone. | Visible only to export/print capture. | Not interactive. | Committed page clone, canonical layout, explicit paper color. | Removes editor-only reference, hit targets, chrome, source layers, and live editing state. |

The application therefore has one document model but multiple renderers. That
is not intrinsically wrong; the problem is that renderer identity and geometry
identity are not the same thing during active body editing. The transition can
be summarized as:

```text
canonical CV fragments
       │  enter text editing
       ├── active fragments become transparent
       ├── PM root becomes absolute, cheap, single-column
       ├── all PM children become hidden
       └── one PM block is positioned over one selected fragment
```

The last step is not valid for a block that has multiple fragments. It also
means a mode switch changes both the visible owner and the geometry source in
the same interaction. The injected style is installed in a layout effect after
React state changes, so there is a window in which the DOM has changed mode but
the overlay geometry has not yet been installed.

There is a further caret ownership concern: `decorateStructuredTextHtml`
can add synthetic selection/caret decoration to canonical HTML while the real
PM caret is active. The active fragment's text is made transparent, but a
synthetic caret or border can remain visible. This is a potential two-caret
representation rather than a proven persistent duplicate in every state.

## 5. Coordinate-space audit

### Coordinate-space graph

```text
physical page space (unzoomed CSS px, origin at page top-left)
        │
        ├── page margins/content rectangle
        │       └── body/content origin and title/padding offsets
        │
        ├── structured body/layout space (unzoomed CSS px)
        │       ├── columns, bands, exclusions, image frames
        │       └── local structured block rectangles
        │
        └── page transform / viewScale
                │
                ▼
viewport/client space (browser CSS px)
        ├── DOM getBoundingClientRect / Range.getClientRects
        ├── caretRangeFromPoint / PM position resolver
        └── pointer deltas

viewport point ──(DOM ranges, no numeric zoom conversion)──> PM document position
viewport delta ──(divide viewScale)────────────────────────> body/layout delta
page-position attrs ──(subtract body origin)───────────────> rendered body frame
rendered body frame ──(add body origin)────────────────────> committed page attrs
canonical viewport rect + PM-root rect ──(divide local scale)─> LE CSS position
```

### Conversion inventory

| Conversion or helper | Source → target | Zoom behavior | Origin/margin behavior | Audit result |
|---|---|---|---|---|
| `pagePointToBodyPoint` / `bodyPointToPagePoint` | Branded page ↔ body points | No implicit zoom; caller supplies page/body relationship. | Uses an explicit `bodyBoundsOnPage`. | The clearest canonical conversion route. |
| `pagePointToViewportPoint` / `viewportPointToPagePoint` | Page ↔ client viewport | Multiplies/divides view scale and uses page origin. | Page origin is explicit. | Consistent for page-space pointer work. |
| `viewportDeltaToLayoutDelta` | Client delta → unzoomed layout delta | Divides by `viewScale`. | Delta has no absolute origin. | Used by fluid drag; no evidence of double scaling. |
| `measureDocumentPagePositionOriginOffsetPx` | Measured body/content DOM relationship → vertical body/page offset | Divides the measured rect difference by `viewScale`. | Subtracts computed `paddingTop`; effectively vertical-only. | Correctly supports page-position image render/commit, but is an ad hoc DOM measurement separate from the branded graph. |
| `resolveStructuredBandPositionAtPoint` / `resolveStructuredDocumentPositionAtPoint` | Client point → PM document position | Uses viewport `Range`/band rects directly; intentionally no numeric zoom conversion. | Nearest-band fallback uses structured band ranges. | Appropriate for pointer hit testing, but the PM range mapping uses source annotations based on text lengths. |
| `annotateSourceElementRanges` | PM top-level block position → raw HTML element range | None. | Uses PM block offset plus `textContent.length`, not PM inline node-size mapping. | Drift risk for marks, inline content, Unicode, and image nodes. |
| Local overlay effect in `StructuredDocumentSpanLayout` | Canonical fragment viewport rect + PM source-root viewport rect → local PM CSS `left/top/width` | Divides by source-root `scaleX/scaleY`. | Uses DOM-relative positions, not explicit body/page origin. | **Separate ad hoc coordinate authority**; sensitive to renderer transition and fragment selection. |
| `flowImageFrames` measurement | Visible frame viewport rect → structured-root-relative frame | Divides by root scale. | Relative to current structured body root. | Useful for frame hit targets, but another DOM-derived geometry path. |
| Page-position image render/commit | Persistent page `xOffsetPx/yPx` ↔ structured body frame | Page render/commit uses the measured body origin. | Vertical origin is added/subtracted around body layout. | Persistent geometry is source-authoritative; passive CV should not rewrite it. |
| Reference adjustment | Client delta → reference offset | Divides client movement by zoom. | Relative to reference layer/page. | Separate and understandable; pointer ownership changes while adjusting. |
| Export | Page-space layout → export pixels | Export scale is explicit; paper color is filled separately. | Uses page coordinates. | Separate renderer by design; requires draft flush before capture. |

### Coordinate conflicts and risks

1. The active edit overlay does not use the same branded page/body conversion
   path used by image placement. It derives CSS from two DOM rectangles and
   local scale factors. That can be valid locally, but it creates a second
   geometry authority and is measured across a renderer mode switch.
2. `measureDocumentPagePositionOriginOffsetPx` models the body/page difference
   as a vertical offset. Title height, body padding, page margins, and the
   structured overlay's absolute positioning all participate in that offset in
   different ways. There is no single named body-origin object consumed by all
   text, image, and overlay paths.
3. A canonical structured rectangle is a fragment rectangle, while the local
   overlay consumes a block rectangle. This is the primary coordinate cause of
   the reported jump.
4. Source element annotations use `textContent.length` to derive PM ranges.
   That is not equivalent to ProseMirror's node-size/inline-offset mapping for
   all supported content.
5. Shell-side mutation paths still consume copied
   `selectedFlowImage.position` values in multiple places. The selection helper
   is ID-authoritative, but not every consumer re-resolves the ID immediately
   before using the position.

## 6. ProseMirror block versus structured fragment mapping

This is the most direct explanation of the current symptom.

`getStructuredTextEditTarget` enumerates top-level ProseMirror children and
returns a range plus stable direct-child indexes. The local overlay then uses
those indexes to expose `:nth-child(index + 1)` in the PM source.

The structured compositor takes a different path:

1. `editor.getHTML()` is parsed into top-level HTML elements.
2. `annotateSourceElementRanges` associates each element with a top-level PM
   block index and an approximate range.
3. The layout allocator measures and splits elements to fit column/band
   heights.
4. Image exclusion intervals can split the same block around an image or
   caption region.
5. Continuations inherit the same `data-document-block-index`.

Consequently, one PM paragraph can produce multiple structured fragments:

```text
PM block 5
├── fragment 5a: column 1, above/around an exclusion
├── fragment 5b: column 1 continuation
└── fragment 5c: column 2 continuation
```

The overlay effect queries all canonical elements with the active block index,
then stores them in a `Map`. Repeated `Map.set(blockIndex, element)` calls mean
the last matching fragment wins. Separately, `firstActive` is used for the
active-edit diagnostic rectangle. Thus the actual CSS position and the
diagnostic rectangle can describe different fragments.

The effect hides all canonical fragments for the active block, then positions
the entire PM block at the last fragment's rectangle. The whole paragraph
cannot coincide with every fragment it previously occupied. It can therefore
appear to jump to a later column, to the other side of an image exclusion, or
to a continuation position when editing starts.

The abstraction mismatch leaks in three additional ways:

* A full PM paragraph is exposed even if only a fragment was clicked.
* A block-level mask hides every fragment, so there is no fragment-specific
  handoff.
* `data-document-block-index` is a structural index, not a persistent visual
  fragment identity; it is stable enough for ordinary direct-child edits but
  not sufficient for split layout geometry.

This is a diagnosis only. No mapping or masking behavior was changed.

## 7. Mode-transition state machine

| Transition | Trigger and event order | State/CSS/selection changes | Geometry timing | Race or ownership risk |
|---|---|---|---|---|
| Idle → body text | Structured band `pointerdown` resolves client point, stores transient text intent, calls `onEditText(position)`, dispatches one PM `TextSelection`, focuses PM. | Shell focus changes; `textEditing` becomes true; source changes from hidden to absolute single-column; local style is injected; active canonical block is marked. | Resolver measures canonical ranges before mode change; overlay measures source/canonical rects after React state change. | DOM ownership changes during the same gesture; late click must not reverse pointerdown owner. Intent guard handles the common case but is transient. |
| Body text → another body paragraph | Another band pointerdown resolves a new PM position and active block. | Pending draft remains; active block signature changes; old PM child hides and new child exposes. | New canonical fragment is measured after the state/render transition. | Block-to-fragment ambiguity repeats; switching can visually jump even without leaving text mode. |
| Body text → photo | Photo frame/hit target pointerdown chooses image ID; `FlowEditor.onSelectImage` reconciles/clears editing, then fresh ID lookup creates NodeSelection. | Text mode/CV overlay is removed; shell image/group IDs and toolbar context update. | CV may rebuild once before/after selection; image slot becomes owner. | Selection mirrors and cached shell positions can briefly disagree; click suppression depends on transient intent. |
| Photo → body text | Text band pointerdown resolves exact position and calls `onEditText(position)`. | PM NodeSelection becomes one TextSelection; shell clears image/group/overlay state and focuses body. | Canonical CV is used to locate the target; local overlay is installed afterward. | Correct coordinate handoff now exists, but the new block/fragment geometry can move the live block. |
| Photo → drag | Image pointerdown selects/captures; movement past 6px starts DG preview; pointerup commits. | Intent owner becomes image; DOM transform changes; PM attrs stay fixed until commit. | Snapshot geometry is captured before motion; rAF writes latest transform. | Intent/capture cleanup and stable commit are separate from React state; transient transform can outlive a mode change if teardown is incomplete. |
| Photo → resize | Resize-handle pointerdown enters resize preview. | `previewOverrides` updates React/model state; toolbar remains image context. | Structured model is recomputed for preview updates. | Resize has a different, heavier preview architecture from drag; selected object and preview geometry can drift. |
| Any → reference adjustment | Toolbar/reference control sets adjustment mode; SR pointer events become active. | Reference layer receives pointer input; document pointer interactions are blocked by the active reference surface. | Reference uses its page-sized layer and zoom conversion. | Correct while mode is explicit; finishing adjustment must restore pointer transparency immediately. |
| Reference adjustment → document | Finish/lock/exit control clears adjustment mode. | SR returns to `pointer-events:none`; document hit targets become active. | No document geometry should change. | A stale adjustment flag or layer can shield document input. |
| Any editing state → save/autosave | Shared command or timer calls flush, then persistence adapter saves. | Draft map is flushed; LA enters saving/saved/error states. | Export/save uses committed project after flush. | Ordering is deliberately guarded, but PM live content and DS snapshot are different authorities until flush. |
| Any editing state → page switch | Navigation command flushes drafts and changes active page; shell resets selection/focus state. | PM/CV unmount/remount; global draft handler changes effective owner. | New page recomputes layout. | Global singleton draft handler and async reference-import page capture are cross-page risks. |

The interaction-intent ref introduced by the photo/text handoff work is an
important guard: pointerdown is intended to be authoritative and click
handlers suppress themselves. It is not a persistent state machine. In the
current code, click suppression is not keyed/validated against the click's
pointer ID, and pointerup can leave the intent until a later click clears it.
That is a brittleness risk for unusual cancellation, multi-pointer, or DOM
transition sequences, even though ordinary mouse tests cover the common path.

## 8. CSS mode audit

| Selector | Purpose | State | Visibility/interaction effect | Interaction risk |
|---|---|---|---|---|
| `.document-page-sheet` | Own the editor paper background and clipping/isolation. | All page states. | Background is below reference and content; `isolation:isolate`. | Correct structural owner; any child opaque background can still defeat intended layering. |
| `.document-page-export-root` / `.document-page-content` | Page-sized authored layer. | All; export root gets paper color only on export. | Live editor root is transparent; content is above reference. | Relies on separate export background ownership, which is correct but must remain explicit. |
| `.document-title-region` | Real title flow region and bottom spacing. | Meaningful title. | Contributes layout height and margin. | Empty title is handled by a separate class; state transition is a body-origin change. |
| `.document-title-region--empty` | Editor-only empty-title affordance. | Empty, unsuppressed, non-export. | Absolute/zero-flow; pointer-events are kept off the region while button owns interaction. | Correct separation, but title focus still changes editor presentation. |
| `.document-flow-editor__content--structured-source` | Hide source PM while CV owns structured idle rendering. | Structured, not editing. | `display:none` for the source surface. | Source is a hidden second renderer; mode changes replace the visible owner. |
| `.document-flow-editor__content--structured-text-editing` | Mount source PM over the page during active structured editing. | Active body edit. | Absolute source layer, visible PM styling, root interaction constrained. | Combines with CV masking and injected block rules; transition can be non-atomic visually. |
| `.structured-live-single-column .document-flow-prosemirror` | Avoid WebKit multicolumn editing cost. | Active body edit. | Forces `column-count:1`, no gap, `column-fill:auto`. | The full-width source surface was the prior visual owner; local overlay narrows visibility but keeps the full document's internal layout. |
| `.structured-local-block-editing .document-flow-prosemirror > *` | Prevent non-active PM children from painting. | Active body edit. | All direct children `visibility:hidden`; injected `nth-child` rules expose active blocks and position them. | Hidden children still participate in some layout; entire block is exposed for a fragment-based target. |
| `.document-spanning-layout[data-text-editing=true]` | Place CV structured layer above source during editing. | Active body edit. | Absolute high-z layer, pointer-transparent. | Source is not the top stacking owner; visibility depends on transparent active CV text rather than a single true owner. |
| `.document-spanning-layout[data-text-editing=true] .document-span-layout__text-column` | Keep canonical columns visible and selectable. | Active body edit. | Text columns remain visible and pointer-enabled for text hit testing. | Canonical and source text interaction/paint are split. |
| `.document-span-layout__text-band[data-document-active-edit-block=true]` / active marker | Mask only active canonical text fragments. | Active body edit. | Active canonical text becomes transparent; decoration may remain. | Marker is block-index based, so all split fragments are masked together. |
| `.document-image-node` in structured editing | Avoid source image duplication. | Structured active/idle paths. | Source image NodeViews are hidden while CV owns images. | If a structured counterpart is missing, hiding the source would make an image inert/invisible. |
| `.document-span-layout__image-slot` | Structured image wrapper. | Structured layout. | Slot is pointer-transparent except canonical frame/caption targets; selected slot receives higher z-index. | Large wrapper and nested target rules must remain frame-bounded. |
| `.document-span-layout__image-slot[data-image-selected=true]` | Keep selected image/chrome above peers. | Photo selected. | Raises selected slot z-index. | Intended, but a transparent/oversized selected wrapper could shield another object if nested pointer rules drift. |
| `.document-span-layout__flow-image-frame` | Raw ordinary flow image is not itself the selection owner. | Structured layout. | Frame pointer-events disabled. | The visual raw HTML image and explicit hit target are separate owners. |
| `.document-span-layout__flow-image-hit-target` | Frame-sized editor-only stable-ID hit target. | Structured layout, non-span flow image. | Pointer-enabled, export-excluded. | Correct separation from raw band HTML, but it can drift from the visual frame geometry. |
| `.document-image-chrome` / resize handle | Keep chrome from stealing general image/text pointer input while enabling resize. | Image selected. | Chrome pointer-transparent; handle pointer-enabled. | Transform and hit-testing depend on chrome staying frame-bound. |
| `.document-scan-reference` | Reference layer and image. | Reference visible. | z-index below authored content; pointer-transparent except adjustment. | Correct editor stack; layer must not become an invisible shield when not adjusting. |

The CSS is not one contradictory rule set so much as several assumptions
composed together: one fix made the full PM surface visible and single-column;
the later fix retained that performance mode but exposed only a local block;
the canonical layer was then retained around it. The remaining issue is that
the CSS hiding unit is a PM block while the canonical painting unit is a
structured fragment.

## 9. Historical-fix assumption audit

| Commit | Problem solved | Assumption introduced | Current status / later interaction |
|---|---|---|---|
| `bf6f6201` | Photo transform chrome alignment. | Image frame and selection chrome share one canonical frame rectangle. | Still valid for structured slots; local overlay does not change image chrome ownership. |
| `d7f7c844` | Preserve dimensions through span conversion. | Authored image attributes, not passive layout, own transform dimensions. | Still valid; multiple derived frame measurements surround it. |
| `a562588c` | Multi-image transform stability. | Positioned image geometry must not be rewritten by passive layout. | Still a core invariant; shell cached positions are a remaining drift risk. |
| `a5adf7a7` | Stable-ID secondary-image selection. | Persistent image ID, followed by current PM traversal, is selection authority. | Still valid and important; subsequent `9d6e4a03` extended structured interaction to default flow photos. |
| `9d6e4a03` | Default flow photo selection when another image spans. | Every visible flow image needs a structured hit route even if it is not a span image. | Current structured model keeps ordinary flow images in raw bands plus explicit hit targets. |
| `031bf487` | Flow-photo drag-to-pin and reference-layer restoration. | Flow/fixed anchor semantics are distinct; live page owns paper background and reference sits below authored content. | Still valid; reference import has a separate async page-target risk. |
| `a8b3a66a` | Scanned PDF reference ingestion. | PDF.js render → canvas → PNG, with raster-content sanity checks, is the reference asset boundary. | Still valid; reference diagnostic declaration is broader than the current PageView emission. |
| `df285137` | Trailing-edge autosave and empty-title collapse. | Autosave timer is a shared trailing debounce; empty title can use a zero-flow editor affordance. | Still valid; document store and lifecycle still expose parallel dirty/save fields. |
| `028dd7c8` | Fluid photo drag preview. | Pointer-frame feedback belongs in direct DOM transform; model commit happens once. | Still valid and coherent; resize still uses model/React preview. |
| `c369917a` | Photo/text coordinate handoff. | Pointerdown owner and click-derived text position should be explicit; text selection is coordinate based. | Stable-ID/photo handoff works in the main route; block/fragment geometry is now the next boundary. |
| `12dbc570` | Immediate visible structured typing. | PM source must be visible while typing; full structured mirror can be deferred. | Later narrowed by local overlay, but the performance CSS and source presentation remain. |
| `6c354e8c` | Remove per-key project-state churn. | PM is a live draft; DS synchronization can be coalesced and flushed at boundaries. | Still the persistence model; introduces a deliberate PM-versus-DS temporal split. |
| `bde21c92` | Isolate WebKit multicolumn typing latency. | A full PM editing surface must be single-column for acceptable WebKit latency. | The later local overlay changes the visible goal but retains the single-column source constraint. |
| `31b958f7` | Preserve canonical page layout while typing. | A top-level PM block can be positioned over its canonical structured representation. | This is the assumption currently contradicted by split block fragments. |

The most important obsolete or narrowed assumption is the `bde21c92` idea that
the full one-column source can be the visible editing presentation. `31b958f7`
correctly narrows visible ownership to a local block, but leaves the underlying
full-document single-column source and block-index bridge. That is compatibility
machinery, not a clean replacement architecture.

## 10. Duplicate-mechanism audit

| Operation | Implementations found | Canonical route | Drift or compatibility risk |
|---|---|---|---|
| Select text by point | Structured range/line-box resolver in `StructuredDocumentSpanLayout`; PM `posAtCoords`/DOM position routes in `FlowEditor`; `caretRangeFromPoint` helper; explicit `createDocumentTextSelection`. | Structured pointer → `resolveStructuredDocumentPositionAtPoint` → explicit PM `TextSelection`. | Different routes use different DOM owners and fallbacks; only the structured route knows canonical columns. |
| Select image | `DocumentImageNodeView`; structured span slot; ordinary flow hit target; shell structured-image request handler. | Stable image ID → current PM traversal → verified NodeSelection. | Some routes still carry a cached position hint; shell has mirror state and image/group selection logic. |
| Resolve image position | `findDocumentImagePositions`/`findDocumentImagePositionById`; shell `findDocumentFlowImagePositions`; current NodeSelection; layout records’ `imagePosition`. | Extension stable-ID traversal for selection and commits. | Shell mutation paths use `selectedFlowImage.position`; layout positions are useful geometry records, not authority. |
| Calculate body origin | `pageGeometry` content rectangle; CSS page/content padding; `measureDocumentPagePositionOriginOffsetPx`; layout/model body dimensions. | Branded page/body coordinate helpers plus explicit origin. | Overlay uses DOM-relative local scale instead; vertical origin is measured separately from text overlay geometry. |
| Calculate image frame | Structured model frame geometry; measured flow-image DOM frames; NodeView frame; shell layout model. | Authored PM attrs plus canonical structured frame model. | Several derived measurements can disagree during mode transitions or previews. |
| Reconcile structured layout | FlowEditor revision/dirty scheduling; `buildMultiDocumentSpanLayoutModel`; shell-side layout calls for controls; fresh export renderer; older `buildDocumentSpanLayoutModel` test utility. | Multi-image structured model in FlowEditor. | Runtime and test/compatibility builders preserve older concepts; resize still invokes model preview work. |
| Flush live text | Shell `flushPendingTextDrafts`; global `flushDocumentLiveDrafts`; store save/page/export operations; Unified session close. | Shell pending draft plus registered global boundary. | Global singleton handler assumes one active document editor and has cross-mount risk. |
| Enter/exit text mode | FlowEditor focus/blur/selection callbacks; structured `onEditText`; shell `focusedTextRegion`; transient pointer intent. | Coordinate pointer event plus one PM selection and shell state projection. | Several callbacks can react to one gesture; React/CSS mode changes occur during event completion. |
| Autosave/dirty | Lifecycle authority shared scheduler/presentation; documentStore legacy timers/status; adapter mode selection. | LA in unified mode; DS persistence execution. | Two visible state families remain; exact revision notifications still differ from presentation notifications. |
| Export preparation | Shell flush/orchestration; `DocumentProjectExportRenderer`; `documentExportService` clean clone; print CSS. | Shell flush → committed export renderer/service. | Multiple entry points need to preserve the flush and reference-exclusion contract. |

The duplicated mechanisms are not all bugs. Some are appropriate adapters for
different renderers. The architectural issue is that the code does not always
make the canonical route versus compatibility route explicit, so a later fix
can update one path while a neighboring path still uses stale positions or a
different visual owner.

## 11. Test-quality audit

The classifications below describe how faithfully a test proves the user
workflow, not whether the underlying unit is useful.

| Area | Classification | Evidence inspected | Gap or false-positive pattern |
|---|---|---|---|
| Stable-ID image selection | A for the current primary mixed-mode test; D for the earlier setup | `e2e/document-secondary-photo-selection.spec.ts` now adds A as span, adds B default, clicks A, then clicks B and checks shell/toolbar/NodeSelection. | The historical helper configured B to span before selection, so it did not prove default-B selection. The current branch has a better test, but the old false-positive pattern remains in history/documentation. |
| Structured ordinary-flow image rendering | A/B | Current secondary-photo test checks a default flow image hit target and visible ID; unit/layout tests cover records. | Frame-count helpers primarily count structured frames and can miss a visible PM source duplicate if CSS visibility regresses. |
| Local structured text overlay | B with a D gap | `e2e/document-structured-text-hit-testing.spec.ts` uses real mouse input, checks three columns, one-column PM source, hidden non-active children, and paragraph switching. | The helper selects `activeCanonical[activeCanonical.length - 1]`. There is no acceptance test where the active PM block is split into multiple canonical fragments around a span image and must stay at the clicked fragment. |
| Structured typing performance | B/D | `e2e/document-live-typing-performance.spec.ts` types with human-like delays and checks model/project churn. | The setup makes photos span images and clicks a first-band target; it does not cover a split paragraph/fragment overlay or every mixed ordinary-flow case. |
| Scanned PDF visibility | B for newer default test; C/D for retained synthetic test | Scanned fixture and default settings are tested in newer reference/selection paths. The older vector-rectangle test in reconstruction explicitly chooses Stretch and opacity 1 and samples page corner `(10,10)`. | The vector test can pass while a scan-image-XObject or default contain/0.35 pipeline fails. It is a false-positive visibility test, not a replacement for the newer scan test. |
| Autosave debounce | A/B plus D legacy unit | Human-paced E2E and timed authority tests now distinguish trailing debounce. | The older immediate burst with no time between edits proves neither throttle nor debounce and should not be read as trailing-edge proof. |
| Drag-to-pin and fluid drag | A/B | Reconstruction and fluid-drag suites use real pointer interactions and inspect transforms/commits. | Resize remains a separate React/model preview path; drag performance tests do not establish resize performance. |
| Span dimensions and image exclusion | B/A | Span preservation, transform, and page-space tests cover dimensions and image stability. | No focused test ties a split text fragment to local overlay geometry while editing. |
| Reference controls/persistence | A/B | Existing controls, save/reopen, page switch, and export tests inspect state and source. | Some older tests prove controls/state rather than painted pixels; the report history itself identifies this gap. |
| Title/empty-title behavior | A/B | Empty-title E2E and editor tests inspect zero-flow behavior and title transition. | The title path is tested separately from the block-fragment body issue. |
| Save/reopen/export | A/B | Reconstruction/export/recovery suites flush drafts and inspect output/state. | The strongest local-overlay visual workflow is not combined with all of save/reopen/page-switch/export in one test. |

The key missing regression is not simply “local editing exists.” It is:

```text
click a paragraph whose PM block is split into structured fragments
→ keep the clicked fragment's page position
→ expose the real PM block without moving it to another fragment
```

No inspected test proves that invariant. This is the test gap most closely
aligned with the current user-visible symptom.

## 12. User-workflow audit

| Reconstruction step | Current active renderer/owner | Persistent and geometry authority | Workaround or divergence from user expectation |
|---|---|---|---|
| 1. Import scanned PDF reference | Shell → reference service → DS → SR. | DS asset/reference; SR paints editor-only page layer. | Controls/source can exist independently of painted-pixel proof in older tests. Async completion captures a page ID after an `await`, so navigation during import is a risk. |
| 2. Create 3-column page | Page config in DS; CV activates when a span image exists. | DS page config; CV column allocation. | A three-column page without a span image may still use ordinary PM CSS rather than the structured compositor. |
| 3. Add text | PM is live; DS catches up through draft flush. | PM live text, DS after flush; CV is canonical when active. | During structured editing, text ownership is split and can jump at block/fragment boundaries. |
| 4. Add two photos | PM NodeViews initially; structured records/hit targets once CV is active. | PM image IDs/attrs. | One visible frame per ID is intended, but source and structured representations remain mounted. |
| 5. Span/resize/place photos | Shell controls, CV layout, PM attribute commits, DG for drag. | PM attrs for authored geometry; CV for passive frame. | Some shell operations still use copied PM positions. Resize and drag have different preview paths. |
| 6. Edit text around photos | CV fragments plus LE local PM block. | CV geometry and PM content. | This is the main divergence: a block-level editing surface is mapped to fragment-level page composition. |
| 7. Switch text/photo repeatedly | Pointerdown intent, stable-ID selection, coordinate text resolver, shell mirrors. | PM selection and IDs; shell projects toolbar/focus. | One-click switching works in tested ordinary cases, but multiple mirrors and mode effects remain race surfaces. |
| 8. Drag photos | DG transform against captured CV geometry; PM commit on pointerup. | PM authored geometry only at commit. | This is the most coherent interaction boundary in the current design. |
| 9. Edit captions | PM image attributes/NodeView or structured image unit. | PM caption content/attrs. | Caption bounds are intentionally kept outside transform chrome; representation changes by mode. |
| 10. Save/reopen | Draft flush → DS → LA/adapter persistence; CV remounts. | DS persisted JSON/assets. | Boundary is explicit and generally safe; global draft ownership is a complexity risk. |
| 11. Export | Fresh EX renderer and clean clone. | Committed DS/PM JSON; explicit paper color. | Reference/editor layers are excluded as intended; export depends on every entry path flushing first. |

## 13. Performance architecture audit

The current performance boundaries are substantially better than before, but
they are implemented as several special cases:

| Cadence | Current work | Intended owner | Architectural observation |
|---|---|---|---|
| Per authored text transaction/key | PM transaction/history; `handleStructuredEditorUpdate`; ProjectChange observation; live-draft queue; toolbar format observation; MutationObserver/overflow scheduling that is deferred during active editing. | PM/LA and lightweight draft observation. | Exact authored revisions still advance per transaction. The presentation lifecycle snapshot is coalesced, but exact subscribers and format reads remain per input. |
| Per pointer frame for photo drag | Constraint/snap/collision calculation from a captured snapshot; one rAF DOM transform; imperative guides. | DG plus captured CV geometry. | This boundary is coherent and does not rebuild the structured model for ordinary drag. |
| Per pointer frame for resize | `previewOverrides` React state and model dependency. | React/CV. | Different, heavier preview architecture; likely maintenance and performance drift. |
| Per editing session | Mode changes; source CSS class; injected local-edit style; active block/fragment lookup; focus/selection projections. | FlowEditor/CV/SH. | Session transition changes renderer, stacking, and geometry authority at once. |
| Idle/draft boundary | Shell live-draft timer (350ms); canonical structured reconciliation on exit/needed boundary; overflow reconciliation after editing. | SH draft + FlowEditor reconciliation. | Content and visual reconciliation have distinct timing and are not one formal session state. |
| Save/autosave | Draft flush, project serialization/store persistence, LA watermark/status transitions. | LA + DS adapter. | Save ordering is guarded; DS and LA still retain parallel status representations. |
| Export/print | Draft flush; clone/fresh renderer; font readiness/animation frames; clean clone and rasterization. | EX. | Explicit separate owner; editor-only layers are excluded. |

The current design is not “slow by one remaining hot loop.” It has a sensible
fast live-draft boundary, but its visible editing presentation is assembled
from a canonical compositor, a full PM source, and an active-block bridge.
That is why improving one path can leave a new visual or state boundary behind.

## 14. Persistence and authority audit

### What is canonical

* ProseMirror is the authoritative live text/image document, including undo,
  redo, current selection, and image attributes.
* The document store is the persisted project snapshot after the live draft is
  flushed.
* Stable persistent image ID plus current PM traversal is the authoritative
  image-selection lookup.
* Structured layout is derived geometry and visual composition. It is not an
  authority for persistent image attributes.
* Drag transforms, local overlay styles, selection chrome, guides, and
  `previewOverrides` are transient and are not intended to persist.

### Where authorities diverge temporarily

During active body/title editing, PM content can be newer than the DS body or
title JSON. `pendingTextDraftsRef` is the intentional boundary. ProjectChange
authored revision observation can already reflect that PM transaction while the
DS snapshot still contains the previous content. This is safe only because
save/export/page-switch/recovery/close paths flush the draft first.

The structured compositor is deliberately allowed to be stale during active
typing. This preserves input responsiveness, but it means any operation that
uses the canonical layout while a draft is pending must either tolerate stale
visual text or flush/reconcile first. Image operations and export have explicit
flush/reconcile paths; the architecture would benefit from making that
precondition universal rather than relying on call-site discipline.

### Specific safety findings

* Save/autosave calls flush the global live-draft handler before persistence.
* Page operations and unified-session close also flush pending drafts.
* Export and print flush before mounting/capturing the export renderer.
* Recovery uses the store after the same draft boundary.
* No examined preview state is intentionally serialized.
* The global `documentLiveDraft` singleton assumes one active mounted document
  editor. A remount or multi-document scenario could replace the handler while
  a draft remains in the previous editor.
* `DocumentEditorShell.handleReferenceImport` starts an async import and later
  uses the current page closure/state to set the reference. If the active page
  changes while the import is running, the asset can be associated with a page
  other than the page on which the import began. This is a data-association
  risk independent of the text jump.
* `selectedFlowImage.position` is a copied current position at selection time.
  Stable-ID selection/commit paths re-resolve correctly, but several shell
  metadata/mutation paths still trust that copied position.
* Image groups are correctly treated as an image-affecting concern in the fast
  text path; ordinary typing does not run full group repair. This is a good
  separation, but it adds another distinction between fast and generic store
  paths.

## 15. Risk register

| Priority | Finding | Evidence | User-visible consequence | Likely architectural issue | Local patch or simplification? |
|---|---|---|---|---|---|
| P0 | No demonstrated P0 in this static audit. | Save/export/recovery paths have explicit draft flushes and no preview state is intentionally persisted. | No confirmed unrecoverable data loss found from inspected code. | Risk is conditional on a missed boundary or replaced global draft handler. | Keep under regression coverage; do not label the current text jump P0. |
| P1 | Active local editing maps a PM block to one of several structured fragments. | Allocator splits blocks; all continuations share block index; `canonicalByBlockIndex` retains the last fragment; entire block is positioned there. | Entering/editing a paragraph can jump to another column, continuation, or image-side region. | Block identity and fragment identity are conflated at the renderer boundary. | Simplification is preferable: establish a fragment-aware edit identity/geometry contract before more CSS patches. |
| P1 | Body text has multiple simultaneous paint/interaction owners during active editing. | CV fragments remain visible except active masks; PM source is exposed; synthetic canonical decorations can coexist; band pointer and PM caret are separate. | Caret/selection/paint can appear displaced, duplicate, or transition through an intermediate location. | No single explicit active text presentation owner; masking is a CSS convention. | Consolidate ownership rather than add more visibility exceptions. |
| P1 (conditional) | Async reference import can associate a successful asset with the wrong active page. | Reference page ID is captured/used around an async import; no inspected transaction token binds import to its origin page. | Reference appears to import successfully but is attached to a different page after navigation. | Asset ingestion and page mutation are not one page-scoped operation. | A page-scoped operation boundary is preferable; at minimum this needs an explicit invariant before more reference work. |
| P2 | Selection is mirrored in PM, shell, store, group state, toolbar, and cached positions. | `selectedFlowImage`, `selectedFlowImageId`, structured IDs/group, overlay ID, toolbar projection, and `SelectedDocumentImage.position`. | Stale inspector/toolbar or a mutation targeting a prior image after switching. | Derived selection projection and authored image identity are not separated everywhere. | Consolidate projection and make ID re-resolution universal; avoid another isolated callback fix. |
| P2 | Local overlay and image geometry use ad hoc DOM coordinate conversion beside branded page/body helpers. | Overlay uses source/canonical rects and local scale; page-position images use measured origin offset and branded conversions. | Zoom/title/body-origin changes can produce alignment jumps or inconsistent geometry. | No single geometry service spans page, body, fragment, block, and viewport spaces. | Consolidation preferred; local offset patches are likely to drift. |
| P2 | Live draft is a global singleton and DS/LA retain parallel lifecycle state. | `registerDocumentLiveDraftFlushHandler`; DS dirty/status plus LA exact/presentation snapshots. | Cross-mount flush loss or inconsistent UI status in unusual session transitions. | Compatibility architecture assumes one document/session owner. | Clarify session ownership and projections before expanding features. |
| P2 | Resize preview rebuilds structured model while drag preview is direct DOM. | `previewOverrides` is a model dependency; drag uses DG rAF transform. | Resize can feel less responsive and has different handoff failure modes. | Two transform-preview architectures. | Stabilize identity/geometry first; do not broaden optimization during this audit. |
| P2 | Pointer intent lifetime is transient but not fully pointer-ID scoped. | Intent is set on pointerdown, click suppresses based on presence, cleanup can wait for click. | Rare stale suppression or gesture reclassification around cancellation/multi-pointer DOM changes. | Event ownership is represented by a loose ref rather than a completed gesture record. | Consolidate gesture ownership; avoid timing hacks. |
| P3 | Legacy/generic store and layout paths remain beside optimized paths. | Generic `updatePage`, old autosave/status fields, compatibility adapters, older span builder/test utility. | Future fixes can update one route and silently bypass another. | Incremental fixes have accumulated compatibility machinery without a retirement boundary. | Simplification/explicit route labels preferred. |
| P3 | CSS mode rules encode historical assumptions not expressed as one state model. | Structured-source hidden, single-column source, local block visibility, active canonical transparency, pointer-transparent layers. | Future state combinations can create transient blank/duplicate/intercepting DOM. | CSS is compensating for renderer ownership transitions. | Replace with a small explicit presentation state contract over time. |
| P4 | Test helpers can hide complexity or assert derived DOM rather than visible ownership. | Last-fragment helper, vector PDF corner test, structured-only frame counters, prior preconfigured-B helper. | Regressions can pass while the real workflow fails. | Coverage follows individual fixes, not cross-fix workflows. | Add missing invariants before changing implementation. |

## 16. Strategic verdict

The evidence supports **C**, not A or B:

* This is more than one local coordinate bug because there are multiple text
  renderers and the local overlay has a different identity granularity from
  the canonical compositor.
* It is more than one or two independent abstractions because selection,
  geometry, draft state, and lifecycle state also have parallel projections.
* It is not D because the structured compositor, stable-ID image authority,
  live draft boundary, and direct drag preview each have coherent invariants
  and are valuable for the reconstruction workflow.

The architecture should be simplified around its boundaries rather than
replaced wholesale.

## 17. Recommended stabilization goals

These are architectural goals, not implementation steps.

### Goal 1 — Establish one fragment-aware text geometry identity

Make the relationship between a PM range, its structured fragments, and the
active editing region explicit. A PM block may remain the content/history unit,
but it cannot be the only geometry unit when the compositor splits it. The
same identity should drive hit testing, masking, active edit geometry, and
reconciliation.

### Goal 2 — Establish one interaction and selection projection

Treat PM selection/attributes as the source and derive shell, toolbar,
structured IDs, group, and inspector state from a single projection. Make
stable-ID re-resolution the common boundary for every image mutation, and make
the active pointer gesture a completed, pointer-scoped owner rather than a
loose cross-event ref.

### Goal 3 — Fence and retire compatibility presentation paths

Define explicit boundaries for live PM presentation, canonical structured
presentation, transient drag/resize presentation, DS draft synchronization,
shared lifecycle presentation, and export. Once those contracts are explicit,
identify which old source/CSS/layout/store paths are compatibility-only and
retire or isolate them. This includes the global draft owner and parallel dirty
state, not just the visible text CSS.

## 18. Validation and handoff

No tests, builds, snapshots, or runtime commands were run as part of this
audit beyond read-only repository/file searches and Git state inspection. The
existing implementation reports and test files were inspected as evidence;
their historical validation results were not regenerated here. No unrelated
snapshot was changed.

The final working-tree expectation is:

* this audit document is the only new repository artifact;
* `AGENTS.md` remains separately staged and byte-for-byte unchanged;
* no source or test path is changed;
* the text-jump symptom remains intentionally unfixed.
