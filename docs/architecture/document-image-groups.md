# Document image rows and stacks

P4 adds compound image alignment without introducing nested Tiptap nodes.
Individual `documentFlowImage` nodes remain canonical for assets, captions,
selection, and persisted geometry. Each `DocumentPage` stores an
`imageGroups` array keyed by stable image IDs:

```ts
{
  id: string;
  kind: 'row' | 'stack';
  childImageIds: string[];
  gapPx: number;
  sharedWidth: boolean;
}
```

`src/document/model/documentImageGroups.ts` validates and repairs this
metadata. It removes missing IDs, duplicate memberships, and groups with fewer
than two children. Only uniquely identified page-positioned span images are
groupable; flow images and page overlays use different coordinate spaces.

`src/document/layout/imageGroupLayout.ts` is the pure geometry contract. It
derives image, caption, occupied, group-bound, translation, fitting, clamping,
overlap, and collision rectangles. `StructuredDocumentSpanLayout` injects DOM
caption measurement, calls the geometry helper, then uses the same derived
rectangles for screen exclusions, collision units, drag previews, and export.

Group metadata is committed atomically with image-node transactions through
`DOCUMENT_IMAGE_GROUPS_TRANSACTION_META` and
`commitStructuredDocumentImageBatch`. The store validates the resulting body
and group records in one page revision. Deleting a member repairs membership;
ungrouping first materializes the current derived child rectangles as ordinary
image attributes so the children remain visually stable.

Persisted coordinates continue to use unzoomed 96-CSS-pixel body-span units.
Zoom is applied only by viewport conversion during pointer interaction.
Captions remain structurally attached to each image node, so rows and stacks
retain independent caption text, alignment, italic state, and spacing through
save/reload and export.

The current renderer still uses a raster-backed PDF path. Because export mounts
the committed page snapshot and passes `page.imageGroups` to the same
structured layout component, group geometry does not depend on the active page
or editor preview state.
