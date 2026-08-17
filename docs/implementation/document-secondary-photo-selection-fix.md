# Secondary structured photo selection fix

## Root cause

The visible structured renderer passed `(position, imageId, additive)` to the
selection callback. `FlowEditor` trusted the visual model position whenever
the group-selection callback returned the clicked ID. A document edit could
shift the photo before the event handler ran, leaving that position pointing
at a paragraph or another image. The source `DocumentImageNodeView` had a
second cached-position path: it called the shell callback and then independently
called `setNodeSelection(getPos())`.

There was also a hit-testing defect. A structured image slot included caption
flow in its box, and a selected slot was raised above other slots. That made an
otherwise transparent/caption-only part of the selected container capable of
shielding a different visible photo. The 50ms pointerdown/click suppression
window was removed as a separate race risk.

Passive collision geometry was not the cause and was left unchanged.

## Stable-ID selection rule

`DocumentImageExtension.ts` now exports:

- `findDocumentImagePositions(editor, imageId, nodeType?)` for traversal;
- `findDocumentImagePositionById(editor, imageId, expectedNodeType?)`, which
  requires exactly one persistent image node for the ID and verifies the node;
- `selectDocumentImageById(editor, imageId, expectedNodeType?)`, which creates
  a fresh `NodeSelection` and verifies that the selected node still has the
  requested ID and type.

Structured selection ignores the visual position hint, applies existing group
semantics to the stable ID, resolves that chosen ID in the current document,
and fails closed for missing or duplicate IDs. Structured position and size
commits use the same unique-ID lookup. Source node-view selection uses the
same helper and no longer dispatches a cached `getPos()` selection.

## Hit targets and overlap behavior

The canonical visible frame carries:

```html
data-document-visible-image-id="<persistent-id>"
data-document-image-hit-target="true"
```

Structured slots retain their layout geometry and selected visual z-index, but
the slot itself is `pointer-events: none`. Only the actual frame and actual
caption receive pointer events; caption flow therefore cannot create an
invisible image hitbox. Transform chrome remains pointer-transparent except
for its resize handle. At an overlap pixel, the frame painted on top receives
the pointer; a transparent portion of another selected slot cannot intercept
it.

## Selection-state synchronization

After a successful ID-based selection, ProseMirror owns the primary image
selection. The existing selection callback derives `selectedFlowImage` from
that `NodeSelection`, updates `selectedFlowImageId`, and keeps
`selectedStructuredImageIds` and group state consistent with the existing
group rules. The toolbar inspector and structured layout now expose their
selected ID for regression assertions; they are both driven from the same
selection result.

## Transform results

Chromium coverage confirms that the second photo can be selected, resized in
both fit and fill modes, and moved without changing the first photo's frame
geometry. The transform outline and resize handle stay bound to B. Flow-
anchored photos retain their existing movement restriction; selection remains
independent from that permission.

## Regression results

Added coverage includes:

- non-overlapping B selection and A/B/A/B switching;
- partial overlap and top-frame hit testing;
- caption-inclusive slot shielding regression;
- B resize and movement with A unchanged;
- text-editing mode followed by B selection;
- document-position change after text insertion;
- page switching and save/reopen selection;
- missing/duplicate ID fail-closed behavior;
- frame-sized hit-target attributes and current NodeSelection resolution.

## Validation

Completed during implementation:

- focused Vitest: `95/95` tests passed;
- positioned-image contract Vitest: `20/20` tests passed;
- secondary-photo Chromium E2E: `4/4` tests passed;
- previous transform/text Chromium suites: `6/6` tests passed;
- full Vitest: `602/602` tests passed;
- full coverage run: `602/602` tests passed (`61.54%` statements,
  `52.61%` branches, `60.83%` functions, `63.62%` lines);
- `npx tsc --noEmit`;
- `npm run lint`.
- `npm run build`;
- `npm run validate`;
- `npm run test:recovery` (`3/3`);
- `cargo test --manifest-path src-tauri/Cargo.toml` (`20/20`).

No unrelated historical visual snapshots were updated. `dist/`, coverage, and
test-result output remain generated artifacts.

## Remaining limitations

Duplicate persistent image IDs are treated as invalid and are not selected.
Arbitrary vertical dragging remains intentionally unavailable for flow-anchored
images; their toolbar movement semantics are unchanged. The existing selected
z-index still controls which frame is visually on top at a true overlap, while
hit testing is restricted to that frame rather than the slot or caption flow.
