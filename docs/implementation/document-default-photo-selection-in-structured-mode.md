# Default photo selection in structured mode

## Scope

This fix continues the stable-ID selection work from `a5adf7a77f2f23c2e37d5e118a47e5f7532a9fb3` and covers the mixed state where Photo A is `span-columns` and a newly inserted Photo B remains an ordinary flow image.

## Root cause

The previous Chromium test was a false positive. Its setup converted B to a span before the first B-selection assertion, so it only exercised the existing structured-span collection and its stable-ID selection route. It did not exercise a newly added default photo.

On the real path, B was a `documentFlowImage` with its persisted default `wrap: "float-left"`. `StructuredDocumentSpanLayout` collected only `documentFlowImage` nodes with `wrap: "span-columns"`. B therefore had no structured image record, no structured hit target, and no call into the stable-ID selection helper. Its visible owner was the raw `FIGURE.document-image.document-image--flow` serialized inside an `explicit-text-column` band. The source NodeView was not the visible frame owner. The pre-fix browser audit found no `data-document-visible-image-id` or `data-document-image-hit-target` on the visible figure; `elementFromPoint()` at B's frame center returned `IMG.document-image__media`, with no hit-target ID and a closest text-band ancestor.

This was primarily a visual-model ownership and hit-testing failure. The stale-position and pointerdown/click race fixes were not the cause of this regression: B never reached that structured selection path. The structured text-editing source layer could also expose an ordinary image separately, so source image nodes are now hidden while the composed text layer is active to preserve the one-visible-frame invariant.

## Stable-ID selection rule

`StructuredFlowImageLayout` now records every persistent non-span `documentFlowImage` and every `documentInlineImage` when structured composition is active. Their cached visual positions are metadata only.

The explicit flow-image pointer handler passes the persistent ID and node type to `FlowEditor`. `FlowEditor` validates the requested ID with `findDocumentImagePositionById(editor, imageId, nodeType)`, preserves existing group/primary-child decisions, and then calls `selectDocumentImageById(editor, primaryId, nodeType)`. That helper traverses the current ProseMirror document, requires exactly one matching persistent node, creates a `NodeSelection` at its current position, and verifies the resulting node ID and type. Missing, duplicate, or type-mismatched IDs fail closed without selecting another image.

The resulting ID is reflected by the ProseMirror `NodeSelection`, `selectedFlowImageId`, `selectedStructuredImageIds`, group state, toolbar inspector, and structured-layout selection attributes. Resize and movement commits also re-resolve by ID before changing node attributes.

## Canonical owner and hit testing

The raw text-band figure remains the single visual rendering of an ordinary flow or inline image, but it is marked with `data-document-structured-flow-image="true"` and its photo frame is made pointer-inert. Caption flow remains outside that inert frame and retains text interaction.

After the fix, a layout measurement effect reads the raw frame rectangle, excluding caption height, and projects one editor-only, frame-sized `.document-span-layout__flow-image-hit-target` over it. The target carries:

- `data-document-visible-image-id="<persistent-id>"`
- `data-document-image-hit-target="true"`
- the current document position and node type as diagnostic attributes

In the post-fix browser audit, B's raw frame had `pointer-events: none`; the explicit target had `pointer-events: auto`, matched the frame bounds within sub-pixel rounding, and `elementFromPoint()` at the visible center returned the target with B's ID. It was not inside an explicit text column. The same remained true after entering text-editing mode; the source NodeView was `display: none` and zero-sized.

The target is editor-only and marked for export exclusion. It is not another image, so A and B still produce exactly one visible `.document-image__frame` each. Selected span slots retain their established z-index values, but the slots themselves have `pointer-events: none`; only their visible frame and actual caption are interactive. The flow target remains frame-sized and does not gain a selected-image click shield. The overlap Chromium test confirms that the top visible frame receives overlap clicks and caption flow is not treated as photo hit area.

## Modes and transforms

With A spanning columns, B remains selectable in `float-left`, `float-right`, and `top-bottom` modes, and the inspector reports B's actual wrap, dimensions, caption, crop mode, and ID. Inline images are retained as inline records and can use the same stable-ID selection route without being converted into an absolute span model; inline direct structured resize/drag chrome remains intentionally absent.

The new default-B test uses actual mouse coordinates. It selects B, verifies B's inspector and transform affordance, resizes B, and verifies A's frame geometry is unchanged. After B is explicitly converted to a span, fit and fill resize and page-position movement continue to target B only; A remains unchanged. Ordinary flow layout movement continues to follow its existing toolbar/flow semantics rather than gaining arbitrary page drag behavior.

## Regression results

The required default-B test was run against the pre-fix implementation first and failed because `elementFromPoint()` had no B hit target. After the fix it passes, along with:

- A/B/A/B switching before and after B's conversion to a span;
- ordinary float-left, float-right, and top-bottom selection;
- overlap selection and caption hit testing;
- text editing followed by B selection;
- current-position resolution after text insertion;
- page switching and save/reopen with A span and B ordinary flow;
- export removal of editor-only hit targets while retaining the one visible photo.

The mixed state contains two persistent image nodes and two visible frames: A exactly once and B exactly once. No source image, raw-band image, or hit target creates a duplicate visible photo.

## Validation

- Focused secondary-photo Chromium suite: 7 passed.
- Relevant Document Chromium suite (`e2e/document-*.spec.ts`): 22 passed.
- Full Vitest: 58 files, 604 tests passed.
- Coverage: 61.49% statements, 52.53% branches, 60.85% functions, 63.54% lines.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed; production `npm run build`: passed.
- `npm run validate`: passed.
- `npm run test:recovery`: 3 passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 20 passed, with no failures.

## Remaining limitations

Ordinary flow and inline image pixels still use the semantic text-band renderer; the separate React target owns only frame interaction, deliberately leaving captions in text flow. Inline images retain inline semantics and do not receive page-position drag or direct structured resize handles. No unrelated historical visual snapshots were changed.
