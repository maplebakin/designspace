# Unified Editor — Authored Boundary Closure

Status: complete

Verdict: **READY FOR SHARED DIRTY/AUTOSAVE AUTHORITY WORK**

This package closes the remaining material, reachable authored mutation
boundaries needed to make the shadow ProjectChange stream a candidate source
of truth for authored dirty and autosave triggering. It does not transfer
dirty, autosave, history, persistence, recovery, export, or asset ownership.
The legacy Canvas and Document implementations remain authoritative.

`completeAuthoredCoverage` is now `true`. That value means that every
reachable persistent user-authored mutation found in the final audit has a
normalized semantic observation, not that the other authority migrations are
complete.

## Initial blocker inventory

The previous high-volume package left the following material boundary classes
open:

| Surface | Initial status | Closure result |
| --- | --- | --- |
| Canvas native fill, stroke, shadow, gradient, recent-colour, and Vision Palette controls | Live callbacks had no semantic completion boundary | Closed with native `change` or explicit click completion; all use the existing style family |
| Canvas font-size and other numeric controls | Live input only | Closed with `CommittedInput` Enter/blur completion |
| Canvas corner radius and continuous style controls | Existing live preview needed an authored boundary | Closed with the established `ControlSlider` pointer/key completion |
| Canvas style presets and image-adjustment reset | Multi-property intent was not represented as one command | Closed as one product transaction per explicit preset/reset |
| Canvas theme-token linking, unlinking, themed fill, reset links, and global theme application | Authored theme mutations were not represented consistently | Closed with object, page, and project-level semantics |
| Canvas page resize/reset/background/border metadata | Several UI paths changed persistent page state without a common observer boundary | Closed with page postcondition checks |
| Canvas multi-object add/delete/reorder | Singular-object observation was insufficient | Closed with page-scoped batch semantics |
| Document paper/style colours and numeric page/style/drop-cap/folio settings | Several live or direct store paths lacked completion callbacks | Closed with shared colour, numeric, and slider contracts |
| Document title/body content and formatting | Tiptap transactions needed explicit authored classification | Closed from `docChanged` transactions, with image-only filtering |
| Structured image metadata, layout, groups, captions, references, and inline removal | Image-only and metadata changes could be conflated | Closed with image/group/reference families and deterministic postconditions |
| Asset effects | Ownership was intentionally still legacy-owned | Classified as support effects or explicit asset effects on the owning content transaction; no asset database handoff |

## Colour commit model

The native colour lifecycle was audited in the installed Chromium harness. The
control now has three distinct paths:

1. Native `input` remains the live legacy preview path.
2. Native DOM `change` is the semantic completion event.
3. Recent-colour and Vision Palette controls are explicit button commands.

`CommittedColorInput` captures the initial value at focus, pointer-down, or
keyboard interaction start. It does not use blur, pointer-up outside the
picker, delay, debounce, or browser timing inference as completion. The
native `change` listener compares the final value case-insensitively with the
captured value and emits one optional commit only when the effective value
changed. The live controlled-input rerender was exercised in Chromium; the
semantic listener remains attached to the current input and the final Fabric
fill is the value observed after the interaction.

Recent-colour buttons remain explicit clicks. A click on the current effective
colour updates no legacy state but emits no semantic transaction. Vision
Palette application reaches the same legacy fill mutation and is observed
after the final object fill is present. The existing `modify-freeform-style`
action is used; colour values and picker state are not placed in the
ProjectChange payload.

This makes native fill colour trustworthy for this package without changing
the live preview behavior. The previous deferral was correct for the old
callback-only path; the explicit native completion boundary closes that gap.

## Numeric and continuous commit models

`CommittedInput` preserves the existing live `onChange` behavior and adds a
deterministic completion contract:

```text
focus/edit -> zero or more legacy live updates -> Enter or focus leave
           -> one commit if the effective value changed
```

Enter marks the interaction complete, so a following blur cannot duplicate
the commit. Blur without a meaningful edit emits nothing. No timer or delayed
flush is involved. The initial effective string is captured at interaction
start; field-specific handlers perform the product-level numeric comparison
and postcondition check.

This contract closes Canvas font size and the reachable Document numeric
families: custom page size, margins, column gap, folio settings, named-style
numeric values, and drop-cap numeric settings.

`ControlSlider` is the existing explicit interaction model. It preserves live
movement, captures the value on pointer-down or keyboard start, and completes
on pointer-up or the completing keyboard key event. It emits once only when
the effective number changed. This closes Canvas corner radius and the
reachable Document continuous settings, including reference opacity and
continuous image controls.

## Canvas closure

### Accepted authored families

The following families now have a legacy-first, postcondition-checked
observation:

- existing page structure, object add/remove, drawing, geometry, grouping, and
  ungrouping;
- text content, grouped at the completed Fabric editing session;
- explicit style controls, including native/recent/Vision colours, opacity,
  fill opacity, typography, stroke, shadow, gradients, and corner radius;
- shape border style and the previously trusted transform/theme-colour locks;
- visibility, z-order buttons, layer reorder, and Selection Lock;
- style presets, represented by `apply-freeform-style-preset` rather than one
  fact per changed Fabric property;
- image adjustment reset, represented by
  `reset-freeform-image-adjustments`;
- object theme-token link/unlink and themed-fill/reset-link commands,
  represented by `modify-freeform-theme-link`;
- global theme application and global theme-link reset, represented as one
  page/project-level authored intent rather than one transaction per recoloured
  object;
- design-state, template, and recipe application;
- page resize/reset, canvas background, and page border/content metadata;
- object replacement and clipboard batch add/remove/reorder operations;
- multi-selection deletion and multi-object z-order operations.

The existing single-object z-order commands retain their precise actions
(`move-freeform-forward`, `move-freeform-backward`,
`bring-freeform-to-front`, and `send-freeform-to-back`). Multi-object reorder
uses `reorder-freeform-objects` with a page target. A multi-object command is
one authored intent; it does not emit one transaction per Fabric object.

### Theme semantics

Theme operations are separated by authored intent:

- changing one object's theme link is an object-level
  `modify-freeform-theme-link` transaction;
- applying a theme is `apply-freeform-theme` with a project/page-level target;
- resetting theme links is `reset-freeform-theme-links` with a page-level
  scope;
- `colorLocked` side effects are not misclassified as explicit Theme Color
  Lock commands;
- loading, hydration, template reconstruction, and theme reads use the
  silent path.

The existing theme behavior remains intact: a locked object is skipped by
theme recolouring, and theme application does not emit a synthetic lock
transaction. Manual fill behavior and token-role behavior remain legacy-owned.

### Canvas paths classified as non-blocking

The final audit found these source-level paths do not represent an additional
reachable material authored dirty command:

- `setObjectStrokeWidth` remains a legacy store API with no current user-facing
  caller; the reachable stroke-width control uses the committed style path;
- internal canvas fit/scale helpers are reconstruction/layout utilities, not
  current authored commands;
- the eraser currently creates a normal freehand path through the existing
  drawing/object-add path. There is no separate persistent erase mutation to
  observe, so `canvasErase` remains `false` while the resulting authored path
  is covered by drawing/object add;
- viewport, guides, snap/grid, selection, and inspector state are ephemeral
  editor state.

## Document closure

### Tiptap content and formatting

Flow body updates receive the actual ProseMirror `Transaction`; title updates
use the same transaction-aware boundary. A transaction is eligible for the
generic title/body semantic family only when `docChanged` and its authored
projection changed. Typing, deletion, paste, marks, alignment, font-size
marks, block styles, and flow-control changes therefore remain engine-neutral
content/formatting facts:

- `modify-structured-title-content`
- `modify-structured-body-content`

The ProjectChange payload contains only the stable page target, action,
domain, and asset effect. It contains no ProseMirror transaction, steps,
selection, editor instance, or document JSON.

Image-only transactions are classified before the generic body observer. A
known image command or an unchanged authored text projection does not emit a
second body-content transaction. An image insertion therefore remains one
image lifecycle fact, not image lifecycle plus generic body text.

### Document metadata and styles

The following reachable persistent settings are now observed at explicit
completion boundaries:

- paper/background colour and document style colour;
- document and page language;
- folio numbering, visibility, and numeric settings;
- page margins, custom dimensions, orientation, and column gap;
- named-style discrete, colour, and numeric settings;
- drop-cap enablement, colour, and numeric settings;
- page border and page presentation metadata;
- project/document rename and other document metadata.

Existing `modify-page-metadata`, `modify-document-style-metadata`, and
`modify-document-metadata` actions are reused where their target and domain
remain truthful. Page settings use page targets; document-level settings use
document/project targets. No generic metadata bag was added.

### Structured images, references, and groups

Persistent structured image changes now use the narrow families:

- `modify-structured-image-metadata` for captions and persistent image
  metadata;
- `modify-structured-image-layout` for wrap, size, position, and layout;
- `modify-structured-image-group` for persistent group membership/settings;
- existing overlay/flow image lifecycle and geometry actions for insertion,
  removal, and geometry;
- `remove-structured-inline-image` for inline-image removal;
- `modify-document-reference` for persistent reference import/settings.

Selection handles, inspector focus, scan hover state, and other temporary
reference/image UI state remain outside authored observation. Span-image move
commands now verify that the image position actually changed before reporting;
boundary no-ops remain silent.

Asset ingestion and asset-table updates remain legacy-owned. When an asset is
created as a support effect of an observed image command, the content
transaction carries the existing accurate `assetEffect`; no duplicate generic
asset transaction is emitted. Independently persistent image metadata remains
an image transaction, not an asset-ownership transfer.

## Target and vocabulary changes

The engine-neutral coordinator vocabulary was extended only where existing
single-object targets were insufficient:

- `project` targets represent project-wide authored theme/template/recipe
  intent;
- `page` targets represent page resize, page metadata, page-scoped theme, and
  multi-object/order intent;
- `freeform-object`, `freeform-group`, `structured-image`, and
  `structured-group` retain stable product IDs for object-level commands.

No Fabric object, React event, layer array, ProseMirror transaction, serialized
snapshot, theme JSON, or arbitrary property bag is placed in a normalized
transaction.

## Exactly-once and failure rules

Every newly observed family follows the same sequence:

```text
legacy mutation
  -> legacy synchronization / dirty / save / history behavior
  -> postcondition and stable-ID verification
  -> optional shadow ProjectChange observation
```

The observer is wrapped so an observer or diagnostic subscriber exception is
swallowed and reported out of band. It cannot roll back or interrupt a
successful Fabric/store/document mutation.

No effective change emits a transaction. Invalid/stale/system targets and
failed postconditions emit zero. Rendering, selection, layer synchronization,
theme reads, serialization, hydration, template/project/recovery loading,
undo/redo, page switching, autosave bookkeeping, and teardown remain silent.

Legacy history remains replay-owned. The known Canvas limitation that current
diff history does not represent some array-order-only z-order changes is
carried forward as a later history-authority concern; it does not create an
authored dirty-source gap because the order mutation is persisted and observed
at its user command boundary.

## Final authored inventory

### A. Trusted observed

- Canvas page structure, add/remove/drawing, text sessions, geometry, grouping,
  visibility, z-order, layer reorder, Selection Lock, Transform Lock, Theme
  Color Lock, border style, committed styles, colour controls, numeric/slider
  controls, presets/resets, theme operations, page metadata, and multi-target
  commands.
- Document title/body content and formatting through ProseMirror authored
  transactions.
- Document page structure, page metadata/style settings, language, folios,
  paper/background, margins, dimensions, orientation, column gap, named styles,
  and drop caps.
- Structured overlay/flow/inline image lifecycle, geometry, metadata, layout,
  captions, groups, references, and image replacement.
- Stable page/project/object/group targets and accurate support asset effects.

### B. User-authored and closed in this package

- Native colour picker completion, recent-colour clicks, and Vision Palette
  application.
- Shared numeric and slider completion boundaries.
- Canvas style presets, image adjustment reset, theme links, global themes,
  page resize/reset, page metadata, and multi-target commands.
- Document numeric/style metadata, persistent image metadata/layout/group
  commands, references, and inline-image removal.

### C. Unreachable or non-authority-blocking current paths

- Legacy store-only stroke-width API with no current UI route.
- Internal canvas fit/scale/reconstruction utilities that are not authored
  commands.
- No separate erase mutation exists in the current product: the eraser's
  persistent result is a normal completed drawing/path add.
- Ephemeral Canvas editor chrome, viewport, guides, snap/grid, selection, and
  Document selection/zoom/fit/inspector focus.

### D. Derived/system/support mutations

- Asset-table/ref-count maintenance supporting an observed image/content
  command.
- Theme recolouring and `colorLocked` reads caused by a global theme command.
- Thumbnail generation, navigation persistence, autosave bookkeeping, and
  save-status updates.

### E. Replay/hydration/system-only

- Canvas and Document hydration/reopen/reconstruction.
- Project/template/recipe load and recovery restoration.
- `sanityCheckCanvas` defaults and other system normalization.
- Native history undo/redo replay.
- Export and teardown.

There is no remaining reachable persistent user-authored dirty source in the
final inventory that produces zero normalized authored evidence. Therefore the
diagnostic coverage sets `completeAuthoredCoverage: true` while retaining the
non-authored categories above.

## Dirty/autosave parity evidence

The focused closure tests exercise the shared control contracts, product-level
theme targets, style-preset intent, no-op suppression, and diagnostic coverage.
The existing phase, Canvas sweep, high-volume, Document, and reconstruction
tests continue to exercise legacy dirty behavior, persistence, replay silence,
hydration silence, and stable targets. The full Vitest run passed with no
unobserved-authored diagnostic category for a reachable project edit.

No legacy dirty or autosave implementation was replaced. The final parity
claim is limited to authored-source coverage: each successful legacy dirty
mutation class has a corresponding optional shadow observation, while
navigation persistence and system bookkeeping remain intentionally separate.

## Diagnostics

Coverage now explicitly reports the newly closed families, including:

- `canvasCommittedColorControls`
- `canvasNumericControls`
- `canvasPresetResetCommands`
- `canvasThemeOperations`
- `canvasMultiTargetOperations`
- `canvasPageResize`
- `canvasPageMetadata`
- `documentMetadata`
- `documentImageMetadata`
- `documentImageLayout`
- `documentImageGroups`
- `documentReferences`
- `documentInlineImageRemove`

The existing narrow coverage fields remain true. `canvasErase` remains false
because no separate authored erase command exists; this is not an uncovered
reachable dirty source. `completeAuthoredCoverage` is true.

## Tests and validation

Focused closure coverage includes native colour `input`/`change`, no blur
inference, recent/explicit control completion, numeric Enter/blur and no-op
behavior, slider pointer/keyboard completion and no-op behavior, style-preset
single-intent semantics, project-level theme targets, and final diagnostics.
Existing tests were updated only for the intentional coverage contract and
new boundary behavior.

Results:

- Focused closure/Canvas/Document/history suites: **143 tests passed**.
- Full Vitest: **57 files, 581 tests passed**.
- Coverage: **57 files, 581 tests passed**; statements 61.32%, branches
  52.35%, functions 60.47%, lines 63.35%.
- TypeScript (`npx tsc --noEmit`): **passed**.
- ESLint (`npm run lint`): **passed**.
- Production build (`npm run build`): **passed**.
- `npm run validate`: **passed**.
- Recovery tests: **3 passed**.
- Rust/Tauri tests: **20 passed**; doc tests had no cases.
- Relevant Canvas/Document Chromium tests: **41 of 42 passed** in the final
  serial run. The one pre-existing startup smoke-test failure is only the
  harness assertion that a server `404` console message was emitted; canvas
  readiness, object state, and all feature assertions passed. Rerunning that
  exact test reproduced the same 404. The other 41 tests passed, including
  the native colour and continuous-control tests. No snapshot was changed.
- `git diff --check`: **passed**.

The only reported browser warning was the existing Browserslist freshness
warning. The transient parallel 404 console failures are recorded as harness
noise, not product failures.

## Rollback

Revert the closure commit to restore the previous shadow-observation behavior.
No schema, persistence, recovery, dirty-authority, autosave-authority,
history-authority, or asset-ownership migration is required to roll back.
The legacy Canvas and Document mutation paths remain the source of truth after
rollback.

## Readiness and next package

**READY FOR SHARED DIRTY/AUTOSAVE AUTHORITY WORK**

The exact next package is **Unified Authority Handoff & Consolidation**. It
should transfer shared dirty/autosave triggering first, behind the diagnostic
parity checks established here, and then explicitly evaluate history and
persistence authority from the known evidence. It should not begin mixed
Canvas/Document composition, schema migration, recovery redesign, or asset
ownership transfer as an implicit side effect.
