# Document editor stabilization

This pass started from the post-fix architecture audit's verdict C: the
Document editor had overlapping ownership models. The implementation now has
explicit authorities at the content, geometry, selection, presentation, and
operation boundaries. It is simpler to reason about than the audited version,
although a small number of compatibility surfaces remain deliberately fenced.

## 1. Final authority contracts

| Responsibility | Before stabilization | Final authority | Transient or compatibility state |
| --- | --- | --- | --- |
| Live text content | ProseMirror plus block HTML and local block assumptions | Tiptap/ProseMirror document | Structured fragments are a derived rendering |
| Persisted text | ProseMirror updates, live draft, and generic page mutation paths | DocumentStore after a live-draft flush | The page/region draft map is deferred synchronization only |
| Structured page geometry | Structured layout mixed with DOM measurements and block indexes | `StructuredDocumentSpanLayout` model | DOM measurement is an input to model construction, not a downstream authority |
| Text visual unit | PM block in the local editing path | Runtime structured text fragment | Block identity remains the PM range identity |
| Image authored geometry | PM attributes and copied selection objects | Current PM image attributes | Layout rectangles and drag previews are derived/transient |
| Image targeting | Stable IDs, cached positions, and several selection projections | Stable persistent image ID plus fresh PM traversal | Position is diagnostic/hint data only |
| Text selection | PM selection plus synthetic caret/highlight decoration | PM `TextSelection` | Synthetic decoration remains only for inactive/compatibility rendering |
| UI selection | Shell image/text/group state and store mirrors | `DocumentSelectionProjection` | Store selection fields remain legacy adapter mirrors |
| Pointer ownership | Independent pointerdown and click handlers | Pointer-scoped intent chosen at pointerdown | Click is a guarded compatibility notification |
| Drag preview | React/model preview state in the hot pointer path | Imperative compositor transform | Resize still uses the existing model preview path |
| Reference | Current page after an async import | Page ID captured when the operation starts | Import aborts when the session/page no longer exists |
| Dirty/save lifecycle | DocumentStore fields and shared lifecycle state treated alike | `ProjectLifecycleAuthority` in unified mode | Store fields are documented compatibility/persistence state |
| Export | Live editor layers and paper background | Fresh committed export renderer | Reference and editor chrome are excluded |

The resulting contracts are:

```text
TEXT CONTENT AUTHORITY       = ProseMirror
PERSISTED PROJECT SNAPSHOT  = DocumentStore after live-draft flush
STRUCTURED PAGE GEOMETRY    = structured layout model
TEXT VISUAL GEOMETRY UNIT   = structured fragment
IMAGE AUTHORED GEOMETRY     = PM image attributes
IMAGE TARGET IDENTITY       = stable image ID + fresh PM lookup
SELECTION AUTHORITY         = PM/editor selection projected to UI
DRAG PREVIEW                = transient DOM transform
LIFECYCLE AUTHORITY         = ProjectLifecycleAuthority
REFERENCE AUTHORITY         = page-scoped reference state
EXPORT                      = fresh committed export renderer
```

## 2. Fragment-aware text geometry

`StructuredTextFragmentIdentity` is runtime layout metadata. It carries the
page, PM block range, exact fragment PM range, block and fragment ordinals,
column, segment ID, and an explicit body-space rectangle. The ID is derived
from the page, block, fragment range, and band; it is not persisted.

The model places the same fragment identity on the structured HTML that it
uses for:

- point-to-position resolution;
- active edit-target selection;
- canonical masking;
- active source-block placement;
- diagnostic geometry attributes; and
- reconciliation after the editor selection changes.

Top-level ranges come from the actual ProseMirror node positions and
`nodeSize`, not `textContent.length`. Marked text keeps its PM range, Unicode
keeps its UTF-16 text offset, and inline atom nodes count as a PM unit rather
than contributing caption or presentation text. Blocks containing non-text
inline content are kept intact rather than split by the HTML-cloning helper.

The geometry flow is now:

```text
PM document
    -> structured model allocation
    -> fragment PM range + body/page-space rectangle
    -> structured HTML attributes and hit testing
    -> active source placement using the model rectangle
```

Viewport coordinates are used only at the pointer boundary. The resolver uses
real line boxes to choose a PM position and fragment ID. The structured model
then remains the geometry authority. At the final DOM handoff, the structured
root scale accounts for page zoom once; the source DOM range is only used to
align the real PM content within that model rectangle.

The active editing path masks the selected fragment IDs, not every fragment
belonging to the PM block. Non-active continuation fragments remain visible.
The real PM node is exposed as the keyboard/caret owner at the selected
fragment's model rectangle, with source children hidden individually and the
source kept in an inexpensive single-column layout.

The focused fragment contract test covers a long marked/Unicode block that is
split into multiple fragments and checks PM range continuity, page identity,
column metadata, geometry, and preferred-fragment selection. The Chromium
structured hit-testing suite also verifies the active fragment and live source
rectangle across the visible columns.

Known limitation: the mounted PM node is still one DOM block. When an edit
range spans several fragments or several blocks, the current presentation
exposes the relevant source blocks at their first active fragment and lets the
live region temporarily grow over frozen content. This is intentional for
responsiveness but is a P2 follow-up for richer multi-fragment WYSIWYG editing.

## 3. Selection and gesture projection

`documentSelectionProjection.ts` defines one complete UI projection:

```text
mode, pageId, textRegion, imageIds, primaryImageId, groupId, overlayId
```

The shell, toolbar inputs, inspector, selection events, and structured chrome
read this projection. Projection updates are equality-guarded, so equivalent
selection notifications do not create a new React state object.

Image selection follows one path:

```text
visible image ID
    -> findDocumentImagePositionById(current editor)
    -> NodeSelection at the fresh position
    -> verify node type and ID
    -> project the resulting selection to UI
```

`getDocumentImageById` can return a current position for rendering and
diagnostics, but all shell mutation paths resolve the ID again immediately
before dispatching. No shell mutation uses `SelectedDocumentImage.position`
from an earlier render. Duplicate or missing IDs fail closed.

Grouped selection is projected atomically. The primary PM NodeSelection and
the group member IDs therefore cannot be reconciled as two competing primary
images. Clearing an image selection also clears image IDs, group ID, and the
primary ID together.

Each structured pointerdown writes a scoped intent record containing the
pointer ID, owner, phase, target image or fragment, and resolved text
position. Pointerup, cancel, lost capture, unmount, and page switching clean
the record. The later click event is consumed as compatibility bookkeeping and
cannot reverse the owner selected at pointerdown. Source NodeViews use the
same pointerdown-first rule with a local fallback for direct accessibility or
synthetic click activation.

The resulting switching behavior is one click per transition:

```text
photo -> exact PM text position + fragment -> TextSelection + body projection
text  -> exact stable image ID -> current NodeSelection + image projection
```

Selection-only switching creates no authored transaction, persistence write,
or autosave. The final 40-test reconstruction matrix covers far-away text,
nearby text, image edges, structured text selection drags, mixed image modes,
page switching, and save/reopen.

## 4. Presentation states and retired compatibility paths

The body presentation is now code-defined through
`data-document-presentation-state` and a small set of corresponding CSS
classes:

| State | Visible text owner | Keyboard/caret owner | Layout owner |
| --- | --- | --- | --- |
| `structured-idle` | Canonical structured fragments | None unless PM is explicitly focused | Structured model |
| `structured-text-editing` | Canonical non-active fragments plus the active real PM block | Real PM editor | Frozen structured model |
| `ordinary` / `ordinary-text-editing` | Ordinary PM editor | Real PM editor | Ordinary PM flow |
| Title editing | Title PM editor | Title PM editor | Title editor/page shell |
| Export | Export renderer | None | Fresh committed export layout |

The full PM source remains mounted in a cheap single-column flow because it is
the document and input owner. The old assumption that this entire source is
the visible page presentation is retired. It is now an internal source layer;
only active source blocks are exposed over canonical fragment geometry.

Before stabilization, the local editor used a block-index mask, a block-level
rectangle, canonical structured text, a full visible single-column source,
and synthetic caret/highlight decoration as partially overlapping owners.
The active path now uses fragment IDs and the native PM selection. Synthetic
caret/highlight markup remains available for inactive/compatibility decoration,
but it is explicitly skipped in active fragments.

### Removed / retired

- `textContent.length` as the PM document-range authority;
- block-index-only active masking (`data-document-active-edit-block`);
- the full single-column PM source as the visible structured-page UX;
- source-node attribute mutation as the local editing geometry mechanism;
- shell-local independent React state for selected image object, image IDs,
  group ID, and focused text region;
- mutation-time trust in cached selected-image PM positions;
- unguarded click re-selection after pointerdown;
- the production-wide singleton draft flush owner;
- attaching an async reference import to whichever page was current after
  `await`.

### Retained and fenced

- the canonical `StructuredDocumentSpanLayout` compositor;
- the PM single-column source and ProseMirror history/input system;
- `previewOverrides` for resize, which was not broadened into a new
  performance project;
- raw DocumentStore selection fields and the legacy draft registration API for
  older adapters/tests;
- inactive synthetic caret/highlight decoration;
- generic page mutation for image/document metadata;
- the shared ProjectChange and lifecycle authorities;
- direct DOM/rAF drag preview and stable-ID geometry commits;
- editor-only reference and export exclusion layers.

This is a net reduction in active ownership: four shell selection state slots
became one projection, and the old block/source presentation no longer
competes with fragment rendering. The retained compatibility mechanisms are
marked as such in the implementation rather than silently acting as a second
authority.

## 5. Draft, lifecycle, and session boundaries

ProseMirror remains the live text draft. On an ordinary text transaction, the
shell queues the newest JSON by `(pageId, region)` and emits the existing
authored ProjectChange boundary. A short coalescing flush updates the
DocumentStore using the specialized body/title snapshot path. That path
normalizes once, preserves unrelated page references, skips image-group repair
for plain text, and avoids generic whole-page equality work.

Persistence boundaries flush all registered drafts before reading the project:

- manual Save;
- shared autosave serialization;
- export and print;
- page/project switching;
- editor teardown and blur;
- recovery snapshot generation; and
- image operations that require current body JSON.

Production editors now own `DocumentLiveDraftScope` instances. A scope can
only flush its own handler, so a stale remounted editor cannot replace a newer
editor's handler. The global flush function remains as a boundary dispatcher
for registered scopes and legacy callers; it no longer represents one mutable
global owner.

The lifecycle authority still counts every authored transaction and preserves
the 900 ms trailing-edge autosave semantics. Presentation notifications remain
coalesced from the prior performance work; the fragment/selection changes do
not make selection-only transitions authored changes.

## 6. Reference operation ownership

Reference import captures both the target page ID and the current session
identity before asynchronous ingestion. On completion it verifies that the
session still matches and that the original page still exists, then calls the
page-targeted `setReference`. Switching pages during import therefore cannot
attach the result to the wrong page.

The editor stack remains structurally:

```text
page sheet / paper background
    -> editor-only reference layer
    -> transparent live export root / authored content
    -> editor chrome and selection layers
```

The reference layer uses `pointer-events: none` outside adjustment mode. It is
not part of the export renderer. Existing scan/PDF visibility, opacity, fit,
zoom, lock, adjustment, page-switch, save/reopen, and export tests remain
green, and the new async page-target regression passes.

## 7. Real workflow regressions

The focused Chromium matrix passed 40/40. It includes:

- fragment-level text selection and native caret/range behavior;
- canonical columns and photos remaining stable during local editing;
- default and span photo selection by stable ID;
- ordinary flow and page-position image transforms;
- pointerdown-first photo/text switching;
- compositor drag preview and one-commit handoff;
- image groups, crop/focal geometry, and span preservation;
- PDF/PNG reference visibility and reference operation ownership;
- empty-title geometry and fixed-photo preservation;
- autosave/manual-save/page-switch behavior; and
- save/reopen persistence and export exclusion.

The split-fragment unit contract and the structured text Chromium suite pass
without restoring CSS multicolumn contenteditable. The current text-jump
acceptance now selects the clicked fragment's PM range and places the active
source from that fragment's canonical rectangle; it no longer falls back to
the body top, another continuation, or the selected photo's position.

## 8. Tauri performance

The available desktop route was exercised in the actual Tauri application,
not inferred from Chromium. `tauri info` reported Tauri 2.10.3, Rust 1.93.1,
and WebKitGTK 2.50.4 on the local X11 desktop. A real keyboard smoke run
entered 116 inputs at a 50 ms interval and recorded:

| Metric | Result |
| --- | ---: |
| Input-to-next-frame p50 | 2 ms |
| Input-to-next-frame p95 | 10 ms |
| Input-to-next-frame max | 12 ms |
| Long tasks over 50 ms | 0 |
| Structured model builds during the typing burst | 0 |

The run used the current production bundle and the actual live PM path. The
available desktop automation did not have a prepared full reconstruction
fixture with imported scan, two positioned photos, and split span exclusions;
the smoke therefore proves the runtime path and WebKit behavior for the
mounted editor, but is not claimed as a complete desktop reconstruction
benchmark. The prior WebKit multicolumn reference was approximately
5/8/14 ms after isolation and approximately 9/206/307 ms before isolation;
the current smoke remains in the responsive range without reintroducing
multicolumn contenteditable.

## 9. Validation

Passed:

- focused Vitest editor/fragment/draft/projection tests: 4 files, 116 tests;
- full Vitest: 60 files, 632 tests;
- V8 coverage: 62.48% statements, 53.32% branches, 62.04% functions,
  64.59% lines;
- focused Document Chromium matrix: 40/40;
- TypeScript (`npx tsc --noEmit`);
- ESLint with zero warnings;
- production build;
- `npm run validate`;
- Python recovery tests: 3 passed;
- Rust/Tauri tests: 20 passed;
- full Chromium: 83/84 passed.

The one full-Chromium failure is the pre-existing unrelated
`historical-page-49.png` snapshot dimension mismatch (expected 632x816,
received 618x798). No historical snapshot was changed. `git diff --check`
also passes.

## 10. Remaining limitations and risks

- Multi-fragment live editing still exposes one real PM block at the first
  active fragment and may temporarily overlap frozen downstream content while
  typing. It is responsive and no longer jumps between columns, but richer
  fragment-range source presentation is a P2 follow-up.
- Legacy DocumentStore selection fields and the legacy draft registration
  function remain for compatibility. They are not the UI or production React
  authorities, but future callers could misuse them if they ignore the
  boundary comments.
- Resize preview remains model/state based while drag preview is imperative;
  this distinction is intentional and should be consolidated only with a
  separately profiled change.
- There is no automated full-fixture Tauri UI driver in this environment. The
  real WebKit smoke evidence is included above, but the complete reconstruction
  workflow is covered by Chromium rather than claimed as an automated desktop
  scenario.
- No new P0/P1 data-loss or wrong-image-target failure was observed in the
  validated paths. The remaining risks are P2 compatibility and multi-fragment
  presentation risks described above.

The post-stabilization verdict is B rather than C: the core architecture is
coherent, but the retained compatibility boundaries and multi-fragment source
presentation deserve consolidation before another broad feature pass.
