import { describe, expect, it } from 'vitest';
import {
  collectGroupableDocumentImageIds,
  duplicateDocumentPageImageState,
  findDocumentImageGroupForImage,
  normalizeDocumentImageGroupGapPx,
  normalizeDocumentImageGroups,
  removeDocumentImageGroup,
  removeDocumentImageIdsFromGroups,
} from '../src/document/model/documentImageGroups';
import type {
  DocumentContentJson,
  DocumentImageGroup,
  DocumentPage,
} from '../src/document/types/documentProject';
import { DEFAULT_DOCUMENT_DROP_CAP } from '../src/document/typography/documentTypography';

const imageNode = (
  id: string,
  options: {
    wrap?: string;
    verticalAnchor?: string;
    assetId?: string;
  } = {}
): DocumentContentJson => ({
  type: 'documentFlowImage',
  attrs: {
    id,
    assetId: options.assetId ?? `asset-${id}`,
    wrap: options.wrap ?? 'span-columns',
    verticalAnchor: options.verticalAnchor ?? 'page-position',
    coordinateSpace: 'body-span',
    caption: `${id} caption`,
  },
});

const content = (
  nodes: DocumentContentJson[]
): DocumentContentJson => ({
  type: 'doc',
  content: nodes,
});

const pageWithGroups = (
  groups: DocumentImageGroup[],
  bodyNodes = [imageNode('image-a'), imageNode('image-b')]
): DocumentPage => ({
  kind: 'document',
  id: 'page-1',
  name: 'Page 1',
  size: {
    presetId: 'letter',
    orientation: 'portrait',
    widthIn: 8.5,
    heightIn: 11,
    dpi: 300,
  },
  margins: {
    topIn: 0.5,
    bottomIn: 0.5,
    innerIn: 0.5,
    outerIn: 0.5,
  },
  titleContent: content([{
    type: 'documentInlineImage',
    attrs: {
      id: 'title-inline',
      assetId: 'asset-title',
      caption: 'Title image caption',
    },
  }]),
  bodyContent: content(bodyNodes),
  columnCount: 3,
  columnGapPx: 24,
  dropCap: DEFAULT_DOCUMENT_DROP_CAP,
  suppressFolio: false,
  overlayObjects: [{
    id: 'overlay-image',
    assetId: 'asset-overlay',
    altText: 'Overlay',
    xPx: 20,
    yPx: 30,
    widthPx: 200,
    heightPx: 120,
    placement: 'front',
    caption: 'Overlay caption',
  }],
  imageGroups: groups,
});

const collectIds = (value: DocumentContentJson): string[] => [
  ...((
    value.type === 'documentFlowImage'
    || value.type === 'documentInlineImage'
  ) && typeof value.attrs?.id === 'string'
    ? [value.attrs.id]
    : []),
  ...(value.content || []).flatMap(collectIds),
];

describe('document image-group model', () => {
  it('normalizes gap values to the bounded persisted contract', () => {
    expect(normalizeDocumentImageGroupGapPx(undefined)).toBe(16);
    expect(normalizeDocumentImageGroupGapPx(-100)).toBe(0);
    expect(normalizeDocumentImageGroupGapPx('24.26')).toBe(24.3);
    expect(normalizeDocumentImageGroupGapPx(900)).toBe(480);
    expect(normalizeDocumentImageGroupGapPx('invalid', 19.94)).toBe(19.9);
  });

  it('repairs orphan children, duplicate memberships, IDs, and invalid groups deterministically', () => {
    const normalized = normalizeDocumentImageGroups([
      {
        id: 'group',
        kind: 'row',
        childImageIds: ['image-a', 'image-a', 'image-b', 'missing'],
        gapPx: -20,
        sharedWidth: true,
      },
      {
        id: 'group',
        kind: 'stack',
        childImageIds: ['image-b', 'image-c', 'image-d'],
        gapPx: 900,
        sharedWidth: true,
      },
      {
        id: '',
        kind: 'stack',
        childImageIds: ['image-e', 'missing'],
        gapPx: 12,
        sharedWidth: false,
      },
      {
        kind: 'unexpected',
        childImageIds: ['image-e', 'image-f'],
        gapPx: '18.36',
        sharedWidth: true,
      },
      null,
    ], [
      'image-a',
      'image-b',
      'image-c',
      'image-d',
      'image-e',
      'image-f',
    ]);

    expect(normalized).toEqual([
      {
        id: 'group',
        kind: 'row',
        childImageIds: ['image-a', 'image-b'],
        gapPx: 0,
        sharedWidth: false,
      },
      {
        id: 'group-2',
        kind: 'stack',
        childImageIds: ['image-c', 'image-d'],
        gapPx: 480,
        sharedWidth: true,
      },
      {
        id: 'image-group-4',
        kind: 'row',
        childImageIds: ['image-e', 'image-f'],
        gapPx: 18.4,
        sharedWidth: false,
      },
    ]);
  });

  it('repairs memberships after image and group deletion', () => {
    const groups: DocumentImageGroup[] = [{
      id: 'row',
      kind: 'row',
      childImageIds: ['image-a', 'image-b'],
      gapPx: 12,
      sharedWidth: false,
    }, {
      id: 'stack',
      kind: 'stack',
      childImageIds: ['image-c', 'image-d', 'image-e'],
      gapPx: 20,
      sharedWidth: true,
    }];

    const withoutImages = removeDocumentImageIdsFromGroups(
      groups,
      ['image-a', 'image-d']
    );
    expect(withoutImages).toEqual([{
      ...groups[1],
      childImageIds: ['image-c', 'image-e'],
    }]);
    expect(findDocumentImageGroupForImage(
      withoutImages,
      'image-e'
    )?.id).toBe('stack');
    expect(removeDocumentImageGroup(withoutImages, 'stack')).toEqual([]);
  });

  it('only exposes uniquely identified page-position flow images as groupable', () => {
    const groupable = collectGroupableDocumentImageIds([
      content([
        imageNode('positioned'),
        imageNode('flow-image', { verticalAnchor: 'flow' }),
        imageNode('float-image', {
          wrap: 'float-left',
          verticalAnchor: 'flow',
        }),
        imageNode('duplicate'),
      ]),
      content([imageNode('duplicate')]),
    ]);

    expect(groupable).toEqual(['positioned']);
  });

  it('duplicates all image identities and remaps group membership without duplicating geometry state', () => {
    const source = pageWithGroups([{
      id: 'source-stack',
      kind: 'stack',
      childImageIds: ['image-a', 'image-b'],
      gapPx: 22,
      sharedWidth: true,
    }]);
    const duplicated = duplicateDocumentPageImageState(source, {
      // Deliberately faulty factories prove the helper still avoids collisions
      // with source and previously generated IDs.
      createImageId: (sourceId) => sourceId ?? 'generated-image',
      createGroupId: (sourceId) => sourceId,
    });
    const sourceIds = [
      ...collectIds(source.titleContent),
      ...collectIds(source.bodyContent),
      ...source.overlayObjects.map((overlay) => overlay.id),
    ];
    const duplicatedIds = [
      ...collectIds(duplicated.titleContent),
      ...collectIds(duplicated.bodyContent),
      ...duplicated.overlayObjects.map((overlay) => overlay.id),
    ];

    expect(new Set(duplicatedIds).size).toBe(duplicatedIds.length);
    duplicatedIds.forEach((id) => expect(sourceIds).not.toContain(id));
    expect(duplicated.imageGroups).toEqual([{
      id: 'source-stack-2',
      kind: 'stack',
      childImageIds: [
        duplicated.imageIdMap.get('image-a'),
        duplicated.imageIdMap.get('image-b'),
      ],
      gapPx: 22,
      sharedWidth: true,
    }]);
    expect(
      duplicated.bodyContent.content?.[0]?.attrs?.caption
    ).toBe('image-a caption');
    expect(duplicated.overlayObjects[0]).toMatchObject({
      assetId: 'asset-overlay',
      caption: 'Overlay caption',
    });
  });

  it('drops ambiguous legacy group membership while assigning unique duplicate-page IDs', () => {
    const source = pageWithGroups([{
      id: 'ambiguous-row',
      kind: 'row',
      childImageIds: ['duplicate', 'image-b'],
      gapPx: 16,
      sharedWidth: false,
    }], [
      imageNode('duplicate'),
      imageNode('duplicate'),
      imageNode('image-b'),
    ]);
    const duplicated = duplicateDocumentPageImageState(source, {
      createImageId: () => 'new-image',
      createGroupId: () => 'new-group',
    });
    const duplicatedIds = collectIds(duplicated.bodyContent);

    expect(new Set(duplicatedIds).size).toBe(duplicatedIds.length);
    expect(duplicated.imageIdMap.has('duplicate')).toBe(false);
    expect(duplicated.imageGroups).toEqual([]);
  });
});
