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
  constrainDocumentPageMargins,
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

  it('preserves safe custom dimensions and swaps them once when orientation changes', () => {
    const page = createBlankDocumentPage();
    const custom = updateDocumentPagePaper(page, {
      preset: 'custom',
      widthIn: 6.25,
      heightIn: 9.5,
    });

    expect(custom.size).toMatchObject({
      presetId: 'custom',
      orientation: 'portrait',
      widthIn: 6.25,
      heightIn: 9.5,
    });

    const landscape = updateDocumentPagePaper(custom, {
      orientation: 'landscape',
    });
    expect(landscape.size).toMatchObject({
      presetId: 'custom',
      orientation: 'landscape',
      widthIn: 9.5,
      heightIn: 6.25,
    });

    const repeated = updateDocumentPagePaper(landscape, {
      orientation: 'landscape',
    });
    expect(repeated.size).toEqual(landscape.size);

    const bounded = updateDocumentPagePaper(custom, {
      widthIn: 0.1,
      heightIn: 300,
    });
    expect(bounded.size.widthIn).toBe(1);
    expect(bounded.size.heightIn).toBe(24);
  });

  it('keeps live margin edits inside a minimum custom page', () => {
    const constrained = constrainDocumentPageMargins({
      topIn: 3,
      bottomIn: 3,
      innerIn: 3,
      outerIn: 3,
    }, 1, 1);

    expect(constrained.innerIn + constrained.outerIn).toBeCloseTo(0.75);
    expect(constrained.topIn + constrained.bottomIn).toBeCloseTo(0.75);
  });

  it('preserves document state and valid reference settings while bounding overlays', () => {
    const page = {
      ...createBlankDocumentPage(),
      margins: { topIn: 0.8, bottomIn: 0.6, innerIn: 0.5, outerIn: 0.7 },
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
