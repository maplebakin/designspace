# Unified Editor — High-Volume Authored Content & Style Coverage

## Scope and verdict

This package extends the shadow-only ProjectChange stream across high-volume
authored Canvas and Document content/style surfaces. Legacy Canvas and Document
dirty state, autosave, native history, persistence, recovery, export, and asset
ownership remain authoritative.

Final verdict:

**NOT READY FOR SHARED DIRTY/AUTOSAVE AUTHORITY WORK**

The new boundaries are trustworthy for the observed families below, but
material authored surfaces still have no defensible completed-interaction
boundary. Transferring shared dirty/autosave authority would therefore either
miss authored changes or infer them from the wrong engine events.

The smallest remaining work is one consolidated package:
**Remaining Authored Boundary Closure & Authority Readiness**. It should
establish explicit product commit boundaries for the remaining Canvas
color/numeric/preset/reset controls and remaining Document metadata/style
settings, then repeat the authority-readiness audit. It must not be split into
one package per toolbar control.

completeAuthoredCoverage remains false.

## Canvas text transaction model

The installed Fabric version is Fabric 7.4.x. Browser and Vitest harnesses
confirm this editing lifecycle for IText and Textbox:

1. text:editing:entered fires when editing starts.
2. Zero or more text:changed events fire while editing. The existing handler
   continues its legacy high-frequency dirty/history/persistence work.
3. text:editing:exited fires when editing completes.
4. Fabric emits object:modified for changed text after exit.

The observer captures the stable object ID and initial text at entry. At exit it
holds the session until the changed-text object:modified completion event. It
compares initial/final text, verifies that the object is still a live user
object in the Canvas, and verifies that the serialized store object contains
the final text. Only then it emits:

- action: modify-freeform-text-content
- source: canvas
- domain: freeform-content
- target: freeform-object with the stable object ID
- assetEffect: none

The normalized transaction contains no Fabric object, text snapshot, event, or
editor state. The changed-text completion is not also emitted as geometry.
Unchanged sessions, stale/removed targets, editor-only objects, hydration,
sync-locked replay, and teardown are silent. No timer, debounce, or elapsed
time inference is used.

Session grouping was chosen over one transaction per text:changed event because
the installed engine exposes a reliable entered/exited lifecycle while raw
changed events are explicitly high-frequency legacy persistence events.
Typing, replacement, deletion, paste, and multi-character edits therefore have
one authored semantic boundary per completed editing session.

## Canvas style classification

The existing modify-freeform-style action is reused. The internal style kind is
a closed list of explicit product controls, not a generic Fabric-property event
bus.

### Trusted observed

Discrete controls:

- Shape Border Style: Solid, Dashed, Dotted (retained from Phase 1M).
- Shape Fill Mode: Solid or Gradient.
- Text font family.
- Text weight.
- Text alignment.

Controls with a real completed interaction boundary:

- Shape, text, and image opacity.
- Shape fill opacity.
- Shape and text stroke width.
- Shape, text, and image shadow blur.
- Shape and text shadow X/Y offsets.
- Text line height.
- Text letter spacing.
- Text stroke width.
- Image brightness, contrast, and saturation adjustments.

ControlSlider keeps legacy live onChange behavior and adds optional onCommit.
Pointer interactions commit on pointer-up; keyboard interactions commit on
key-up. A held keyboard interaction is retained until completion. There are no
timers or debounce semantics. The store reporter runs only after live and
serialized values agree, the value differs from the captured initial value,
and the target is a stable live user object.

The normalized style transaction uses action modify-freeform-style, source
canvas, domain style, a freeform-object target with the stable ID, and
assetEffect none. The internal style kind is used only to prove the
postcondition and is not placed in the shared transaction payload.

### Intentionally deferred

- Native fill, stroke, shadow, and gradient color pickers. Their current
  callback is a live onChange path and does not prove one human action equals
  one semantic commit. Vision Palette fill changes use the same path.
- Text font-size number input.
- Shape corner-radius sliders, which still have no explicit completion boundary.
- Multi-mutation text style presets.
- Image adjustment reset.
- Theme-token linking/unlinking, themed fill, reset-to-default-theme, and
  global theme application.
- Remaining Canvas object metadata controls.

No picker-close, blur, pointer-timing, browser-specific, or synthetic
aggregation heuristic was added.

## Document/Tiptap transaction model

FlowEditor already forwarded the ProseMirror Transaction to its update
callback. TitleEditor now forwards the same transaction information to the
Document shell.

The shell updates the legacy Document store first, then observes only when:

- transaction.docChanged is true;
- the transaction is not a ProseMirror history transaction;
- the authored-content projection differs before and after it;
- the active page still exists and contains the completed content.

The title/body families are modify-structured-title-content and
modify-structured-body-content. Both use source document, domain
structured-content, a page target with the stable page ID, and assetEffect
none.

The stream contains no ProseMirror steps, transactions, selections, Editor
instances, or JSON snapshots. The transaction is boundary evidence only.
Typing, deletion, replacement, paste, marks, alignment, font-size/style marks,
named/block styles, and flow-control attributes authored through Tiptap are
covered by these broad families.

### Image-only duplicate protection

src/document/services/documentContentObservation.ts provides a product
projection that removes known documentInlineImage and documentFlowImage nodes,
removes only known implicit block defaults, and treats the normalized empty body
placeholder as structural noise. This handles both image nodes nested in a
paragraph and the existing insertion command that replaces an empty paragraph
with a top-level flow-image node.

An image-only Tiptap transaction therefore does not create a generic body
content transaction. Existing explicit image lifecycle and geometry observers
remain responsible for those actions. A transaction that genuinely changes
both image structure and authored text can still produce both semantic facts.
History transactions use the installed ProseMirror history predicate. Initial
hydration, page switching, and teardown do not call the authored observer.

## Document non-Tiptap style and metadata families

The existing discrete modify-page-metadata family remains in place, with
postcondition checks for completed page preset, folio/title suppression, and
page-language updates.

The newly covered style family is modify-document-style-metadata, using source
document, domain style, a page target with the stable ID, and assetEffect none.
It covers completed discrete updates to named-style font family, weight,
alignment, hyphenation, and italic state, plus discrete drop-cap enabled and
font-family changes. Store equivalence checks prevent transactions for
effective no-ops.

Deferred non-Tiptap surfaces include native paper/text/drop-cap color pickers,
document language, folio numbering/visibility, continuous page margins and
column gap, custom-size editing, numeric named-style/drop-cap settings,
references, and remaining inspector/asset metadata.

## Diagnostics and authored-change inventory

New narrow trusted coverage fields:

- canvasTextContent: true
- canvasExplicitStyleControls: true
- documentTitleContent: true
- documentBodyContent: true
- documentTextFormatting: true
- documentStyleMetadata: true

Existing narrow coverage from prior phases is preserved, including geometry,
object lifecycle, drawing, grouping, Border Style, transform lock, theme color
lock, visibility, z-order, selection lock, and trusted structured image/page
families.

### TRUSTED OBSERVED

- Canvas text content by Fabric editing session.
- The explicit Canvas style controls listed above.
- Prior discrete Canvas Coverage Sweep and Phase 1M–1O actions.
- Document title/body authored Tiptap content and formatting transactions.
- Existing structured image/overlay operations without generic image-only
  duplicates.
- Discrete page metadata and the listed Document style/drop-cap families.

### INTENTIONALLY DEFERRED BUT NOT REQUIRED FOR THIS SHADOW PACKAGE

- Native picker intermediate values and controls without a completed
  interaction boundary.
- Canvas corner-radius, numeric font-size, style presets, and image reset.
- Remaining continuous Document settings while their existing legacy store
  updates remain authoritative.

These are not safe to omit from a future full shared-authority handoff. They
are deferred here because manufacturing a boundary would be less trustworthy
than leaving legacy ownership intact.

### BLOCKING SHARED DIRTY/AUTOSAVE AUTHORITY

- Canvas native fill/stroke/shadow/gradient color commands and other picker
  paths.
- Canvas font-size, corner-radius, style-preset, image-reset, theme-token,
  global-theme, and remaining authored metadata commands.
- Document paper/color/language/folio/continuous page metadata and numeric
  named-style/drop-cap settings.
- Remaining structured image metadata, captions/image groups, references, and
  inspector/asset mutations where the semantic family is not represented.

These are the smallest blockers to replacing legacy dirty/autosave authority
with a complete shared authored stream. They are not blockers to continued
shadow evidence work.

### SYSTEM/REPLAY ONLY

- Fabric rendering, selection, layer synchronization, smart guides, and
  editor-only Canvas chrome.
- Canvas hydration, reconstruction, template/project/recovery loading, page
  switching, teardown, and sync-locked native history replay.
- Tiptap selection-only transactions, initial hydration, and history
  undo/redo transactions.
- Serialization and diagnostic projection itself.

The known Canvas z-order array-order/history limitation remains unchanged and
is carried forward for later history-authority work.

## Legacy ownership and failure isolation

Canvas observers run after legacy mutation, store/layer synchronization, and
save-state work. The style reporter additionally performs the existing store
synchronization needed by legacy style setters that otherwise update only their
history/layer path. It never takes mutation ownership.

Document observers run after the existing store or discrete metadata update.
Canvas and Document notifier wrappers catch diagnostic failures. A throwing
observer cannot roll back or prevent legacy mutation, dirty state, save,
history, persistence, or reopen behavior.

No shared dirty, autosave, history, persistence, recovery, asset, or schema
authority was introduced.

## Tests and validation

Focused package coverage:

- unified-editor-high-volume-content-style-coverage.test.ts: 9 tests for
  Fabric session grouping, no-op/stale/replay behavior, observer failure,
  style postconditions, pointer/keyboard slider completion, Tiptap transaction
  forwarding, image-only projection, Document style metadata, diagnostics, and
  real body editing.
- Existing Phase 1D–1O and Canvas Coverage Sweep tests updated only for the
  narrowed diagnostic inventory and live-target fixture.
- A real Chromium Canvas fill-opacity keyboard test in editor-fabric.spec.ts.

Validation completed:

- Focused high-volume suite: 9 tests passed.
- Full Vitest: 56 files, 575 tests passed.
- V8 coverage: passed; 62.03% statements, 53.35% branches, 61.36% functions,
  64.14% lines.
- TypeScript: npx tsc --noEmit passed.
- ESLint: npm run lint passed with zero warnings.
- Production build: npm run build passed.
- Repository validation: npm run validate passed.
- Recovery tests: 3 Python tests passed.
- Rust/Tauri tests: 20 unit tests passed; doc-test target had 0 tests.
- Canvas Chromium/E2E: 30 tests passed, including real text editing and the
  new fill-opacity keyboard interaction.
- Document typography/reconstruction Chromium/E2E: 9 tests passed.

Only the existing stale Browserslist notice and test-runner local-storage-file
warning appeared; neither caused a failure. No visual snapshots changed.

## Rollback

No schema or persistence migration was introduced. Roll back with:

git revert --no-edit <high-volume-coverage-commit-sha>

Before and after rollback, verify that the separately staged AGENTS.md index
entry and worktree bytes are unchanged. Do not stage, unstage, reset, or revert
that file as part of rollback.

## Shared-authority readiness

This package is ready for continued shadow evidence and one consolidated
remaining-boundary closure package. It is **not** ready for shared dirty or
autosave authority because the blocking authored families above still lack
trustworthy semantic commit boundaries. History, persistence, recovery, and
asset authority should remain legacy-owned until those gaps are closed and a
separate handoff package re-evaluates the complete authored inventory.
