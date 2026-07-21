import { describe, expect, it } from 'vitest';
import {
  createBlankDocumentPage,
} from '../src/document/state/documentStore';
import type {
  DocumentContentJson,
  DocumentOverlayImage,
  ScanReference,
} from '../src/document/types/documentProject';
import {
  getDocumentPaperDimensions,
  updateDocumentPagePaper,
} from '../src/document/utils/documentPageOrientation';
import {
  normalizeDocumentProjectPage,
} from '../src/editor/project/projectSchema';

const bodyContent: DocumentContentJson = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Before ' },
      {
        type: 'documentFlowImage',
        attrs: {
          id: 'flow-photo',
          assetId: 'asset-flow',
          widthPx: 220,
          heightPx: 140,
          wrap: 'float-left',
        },
      },
      { type: 'text', text: ' after' },
    ],
  }],
};

const overlay: DocumentOverlayImage = {
  id: 'overlay-photo',
  assetId: 'asset-overlay',
  altText: 'Family photo',
  xPx: 740,
  yPx: 930,
  widthPx: 240,
  heightPx: 180,
  placement: 'front',
  caption: 'Preserved caption',
};

const reference: ScanReference = {
  assetId: 'asset-reference',
  sourceType: 'image',
  opacity: 0.42,
  fit: 'cover',
  scale: 1.15,
  offsetXPx: 80,
  offsetYPx: -60,
  visible: true,
  locked: true,
};

describe('document page orientation', () => {
  it('provides Letter portrait and landscape dimensions', () => {
    expect(getDocumentPaperDimensions('letter', 'portrait')).toEqual({
      widthIn: 8.5,
      heightIn: 11,
    });
    expect(getDocumentPaperDimensions('letter', 'landscape')).toEqual({
      widthIn: 11,
      heightIn: 8.5,
    });
  });

  it('provides A4 portrait and landscape dimensions', () => {
    const portrait = getDocumentPaperDimensions('a4', 'portrait');
    const landscape = getDocumentPaperDimensions('a4', 'landscape');
    expect(portrait.widthIn).toBeCloseTo(210 / 25.4, 8);
    expect(portrait.heightIn).toBeCloseTo(297 / 25.4, 8);
    expect(landscape.widthIn).toBe(portrait.heightIn);
    expect(landscape.heightIn).toBe(portrait.widthIn);
  });

  it('preserves document state and valid reference settings while bounding overlays', () => {
    const page = {
      ...createBlankDocumentPage(),
      margins: { topIn: 0.8, rightIn: 0.7, bottomIn: 0.6, leftIn: 0.5 },
      titleContent: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: 'Preserved title' }],
        }],
      },
      bodyContent,
      columnCount: 3 as const,
      columnGapPx: 31,
      overlayObjects: [overlay],
      reference,
    };

    const landscape = updateDocumentPagePaper(page, {
      orientation: 'landscape',
    });

    expect(landscape).toMatchObject({
      size: {
        presetId: 'letter',
        orientation: 'landscape',
        widthIn: 11,
        heightIn: 8.5,
      },
      margins: page.margins,
      titleContent: page.titleContent,
      bodyContent,
      columnCount: 3,
      columnGapPx: 31,
      reference,
    });
    expect(landscape.overlayObjects[0]).toMatchObject({
      ...overlay,
      xPx: 740,
      yPx: 8.5 * 96 - overlay.heightPx,
    });
  });

  it('normalizes existing document pages without orientation data to portrait', () => {
    const normalized = normalizeDocumentProjectPage({
      kind: 'document',
      size: {
        presetId: 'letter',
        widthIn: 11,
        heightIn: 8.5,
        dpi: 300,
      },
    });

    expect(normalized.size).toMatchObject({
      presetId: 'letter',
      orientation: 'portrait',
      widthIn: 8.5,
      heightIn: 11,
    });
  });
});
