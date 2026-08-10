import { describe, expect, it } from 'vitest';
import {
  CURRENT_DOCUMENT_SCHEMA_VERSION,
  DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
  normalizeDesignSpaceProjectPayload,
  type DocumentProjectPayload,
} from '../src/editor/project/projectSchema';
import type {
  DocumentContentJson,
} from '../src/document/types/documentProject';

const positionedImage = (id: string): DocumentContentJson => ({
  type: 'documentFlowImage',
  attrs: {
    id,
    assetId: `asset-${id}`,
    wrap: 'span-columns',
    verticalAnchor: 'page-position',
    coordinateSpace: 'body-span',
    widthPx: 240,
    heightPx: 160,
    xOffsetPx: 0,
    yPx: 200,
  },
});

const payload = (
  schemaVersion: number,
  imageGroups?: unknown
) => ({
  schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
  editorMode: 'document',
  projectId: 'group-schema-project',
  projectName: 'Group schema project',
  document: {
    schemaVersion,
    language: 'de',
  },
  pages: [{
    kind: 'document',
    id: 'page-50',
    name: 'Page 50',
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
    titleContent: {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    },
    bodyContent: {
      type: 'doc',
      content: [
        positionedImage('image-a'),
        positionedImage('image-b'),
        positionedImage('image-c'),
        {
          type: 'documentFlowImage',
          attrs: {
            id: 'float-image',
            assetId: 'asset-float',
            wrap: 'float-left',
            verticalAnchor: 'flow',
          },
        },
      ],
    },
    columnCount: 3,
    columnGapPx: 24,
    dropCap: false,
    suppressFolio: false,
    overlayObjects: [],
    ...(imageGroups === undefined ? {} : { imageGroups }),
  }],
  lastUpdated: '2026-07-29T00:00:00.000Z',
});

describe('document image-group schema v4', () => {
  it('migrates schema v3 pages to an explicit empty group collection', () => {
    const normalized = normalizeDesignSpaceProjectPayload(
      payload(3)
    ) as DocumentProjectPayload;

    expect(CURRENT_DOCUMENT_SCHEMA_VERSION).toBe(6);
    expect(normalized.document.schemaVersion).toBe(6);
    expect(normalized.pages[0].imageGroups).toEqual([]);
    expect(
      normalized.pages[0].bodyContent.content?.[0]?.attrs?.coordinateSpace
    ).toBe('body-span');
  });

  it('normalizes valid records and safely repairs orphan or duplicate membership', () => {
    const normalized = normalizeDesignSpaceProjectPayload(payload(5, [{
      id: 'bottom-images',
      kind: 'row',
      childImageIds: [
        'image-a',
        'image-b',
        'image-b',
        'float-image',
        'missing-image',
      ],
      gapPx: 20,
      sharedWidth: true,
    }, {
      id: 'right-stack',
      kind: 'stack',
      childImageIds: ['image-b', 'image-c'],
      gapPx: 12,
      sharedWidth: true,
    }])) as DocumentProjectPayload;

    expect(normalized.pages[0].imageGroups).toEqual([{
      id: 'bottom-images',
      kind: 'row',
      childImageIds: ['image-a', 'image-b'],
      gapPx: 20,
      sharedWidth: false,
    }]);
  });

  it('round-trips canonical group records without changing order or policy', () => {
    const once = normalizeDesignSpaceProjectPayload(payload(5, [{
      id: 'right-stack',
      kind: 'stack',
      childImageIds: ['image-c', 'image-a'],
      gapPx: 18.5,
      sharedWidth: true,
    }])) as DocumentProjectPayload;
    const twice = normalizeDesignSpaceProjectPayload(
      JSON.parse(JSON.stringify(once))
    ) as DocumentProjectPayload;

    expect(twice.pages[0].imageGroups).toEqual(
      once.pages[0].imageGroups
    );
    expect(twice.pages[0].imageGroups[0].childImageIds).toEqual([
      'image-c',
      'image-a',
    ]);
  });

  it('rejects future document schema versions beyond v5', () => {
    expect(() => normalizeDesignSpaceProjectPayload(
      payload(CURRENT_DOCUMENT_SCHEMA_VERSION + 1)
    )).toThrow(/unsupported document schema/i);
  });

  it('migrates legacy asset strings to bounded content-hash metadata', () => {
    const normalized = normalizeDesignSpaceProjectPayload({
      ...payload(4),
      assets: { 'asset-photo': 'data:image/png;base64,UEhPVE8=' },
    }) as DocumentProjectPayload;
    expect(normalized.document.schemaVersion).toBe(6);
    expect(normalized.assetMetadata?.['asset-photo']).toMatchObject({
      byteLength: 'data:image/png;base64,UEhPVE8='.length,
    });
    expect(normalized.assetMetadata?.['asset-photo']?.contentHash).toBeTruthy();
  });
});
