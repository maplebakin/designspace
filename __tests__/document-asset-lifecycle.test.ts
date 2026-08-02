import { describe, expect, it } from 'vitest';
import {
  collectDocumentAssetReferences,
  findMissingDocumentAssetIds,
  fingerprintDocumentAssetSource,
  normalizeDocumentAssetMetadata,
  pruneDocumentAssets,
} from '../src/document/model/documentAssets';
import type { DocumentPage } from '../src/document/types/documentProject';

const page = (assetId: string): DocumentPage => ({
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
  titleContent: { type: 'doc', content: [{ type: 'paragraph' }] },
  bodyContent: {
    type: 'doc',
    content: [{
      type: 'documentFlowImage',
      attrs: { id: 'image-1', assetId },
    }],
  },
  columnCount: 1,
  columnGapPx: 24,
  dropCap: {
    enabled: false,
    fontFamily: 'serif',
    color: '#224466',
    fontSizePx: 58,
    lineSpan: 3,
    spacingPx: 8,
  },
  suppressFolio: false,
  overlayObjects: [],
  imageGroups: [],
});

describe('document asset lifecycle', () => {
  it('reports missing and orphan assets from all page-owned references', () => {
    const pages = [page('missing'), {
      ...page('used'),
      reference: {
        assetId: 'reference',
        sourceType: 'image' as const,
        opacity: 0.3,
        fit: 'contain' as const,
        scale: 1,
        offsetXPx: 0,
        offsetYPx: 0,
        visible: true,
        locked: true as const,
      },
    }];
    const assets = {
      used: 'data:image/png;base64,USED',
      orphan: 'data:image/png;base64,ORPHAN',
    };
    expect(Array.from(collectDocumentAssetReferences(pages)).sort()).toEqual([
      'missing',
      'reference',
      'used',
    ]);
    expect(findMissingDocumentAssetIds(pages, assets)).toEqual([
      'missing',
      'reference',
    ]);
    expect(pruneDocumentAssets(pages, assets, {}).assets).toEqual({
      used: assets.used,
    });
  });

  it('synthesizes bounded metadata for legacy string-only assets', () => {
    const source = 'data:image/png;base64,PHOTO';
    const metadata = normalizeDocumentAssetMetadata(undefined, { photo: source });
    expect(metadata.photo).toEqual({
      contentHash: fingerprintDocumentAssetSource(source),
      byteLength: source.length,
    });
  });
});
