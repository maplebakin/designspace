import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_CSS_PIXELS_PER_INCH,
  MAX_DOCUMENT_FOLIO_NUMBER,
  MIN_DOCUMENT_FOLIO_NUMBER,
  documentInchesToPagePixels,
  documentPagePixelsToInches,
  getDocumentContentRectanglePx,
  getDocumentFolioNumber,
  getDocumentOutsideEdge,
  getDocumentPageParity,
  normalizeDocumentFolioNumber,
  resolveDocumentPhysicalMargins,
  type DocumentSemanticMarginsIn,
} from '../src/document/layout/pageGeometry';

const historicalMargins: DocumentSemanticMarginsIn = {
  topIn: 0.5,
  bottomIn: 0.75,
  innerIn: 0.8,
  outerIn: 0.45,
};

describe('document page geometry', () => {
  it('derives historical folios 49–52 and their outside edges', () => {
    expect([0, 1, 2, 3].map((index) => {
      const folioNumber = getDocumentFolioNumber(49, index);
      return {
        folioNumber,
        parity: getDocumentPageParity(folioNumber),
        outsideEdge: getDocumentOutsideEdge(folioNumber),
      };
    })).toEqual([
      { folioNumber: 49, parity: 'recto', outsideEdge: 'right' },
      { folioNumber: 50, parity: 'verso', outsideEdge: 'left' },
      { folioNumber: 51, parity: 'recto', outsideEdge: 'right' },
      { folioNumber: 52, parity: 'verso', outsideEdge: 'left' },
    ]);
  });

  it('normalizes folios and page indexes to bounded integers', () => {
    expect(normalizeDocumentFolioNumber(undefined, 49)).toBe(49);
    expect(normalizeDocumentFolioNumber(Number.NaN, 50)).toBe(50);
    expect(normalizeDocumentFolioNumber(-12)).toBe(
      MIN_DOCUMENT_FOLIO_NUMBER
    );
    expect(normalizeDocumentFolioNumber(50.9)).toBe(50);
    expect(normalizeDocumentFolioNumber(Number.POSITIVE_INFINITY)).toBe(
      MIN_DOCUMENT_FOLIO_NUMBER
    );
    expect(normalizeDocumentFolioNumber(MAX_DOCUMENT_FOLIO_NUMBER + 100))
      .toBe(MAX_DOCUMENT_FOLIO_NUMBER);
    expect(getDocumentFolioNumber(49, -4)).toBe(49);
    expect(getDocumentFolioNumber(49, 2.8)).toBe(51);
    expect(getDocumentFolioNumber(MAX_DOCUMENT_FOLIO_NUMBER - 1, 100))
      .toBe(MAX_DOCUMENT_FOLIO_NUMBER + 99);
    expect([
      getDocumentFolioNumber(MAX_DOCUMENT_FOLIO_NUMBER - 1, 0),
      getDocumentFolioNumber(MAX_DOCUMENT_FOLIO_NUMBER - 1, 1),
      getDocumentFolioNumber(MAX_DOCUMENT_FOLIO_NUMBER - 1, 2),
    ]).toEqual([
      MAX_DOCUMENT_FOLIO_NUMBER - 1,
      MAX_DOCUMENT_FOLIO_NUMBER,
      MAX_DOCUMENT_FOLIO_NUMBER + 1,
    ]);
    expect(getDocumentPageParity(MAX_DOCUMENT_FOLIO_NUMBER + 1)).toBe('verso');
  });

  it('mirrors asymmetric inner and outer margins without changing their sum', () => {
    expect(resolveDocumentPhysicalMargins(historicalMargins, 49)).toEqual({
      topIn: 0.5,
      rightIn: 0.45,
      bottomIn: 0.75,
      leftIn: 0.8,
    });
    expect(resolveDocumentPhysicalMargins(historicalMargins, 50)).toEqual({
      topIn: 0.5,
      rightIn: 0.8,
      bottomIn: 0.75,
      leftIn: 0.45,
    });
  });

  it('calculates mirrored content rectangles in unzoomed 96px page space', () => {
    const recto = getDocumentContentRectanglePx({
      widthIn: 8.5,
      heightIn: 11,
      margins: historicalMargins,
      folioNumber: 49,
    });
    const verso = getDocumentContentRectanglePx({
      widthIn: 8.5,
      heightIn: 11,
      margins: historicalMargins,
      folioNumber: 50,
    });

    expect(recto).toEqual({
      xPx: 0.8 * DOCUMENT_CSS_PIXELS_PER_INCH,
      yPx: 0.5 * DOCUMENT_CSS_PIXELS_PER_INCH,
      widthPx: (8.5 - 0.8 - 0.45) * DOCUMENT_CSS_PIXELS_PER_INCH,
      heightPx: (11 - 0.5 - 0.75) * DOCUMENT_CSS_PIXELS_PER_INCH,
      rightPx: (8.5 - 0.45) * DOCUMENT_CSS_PIXELS_PER_INCH,
      bottomPx: (11 - 0.75) * DOCUMENT_CSS_PIXELS_PER_INCH,
    });
    expect(verso).toEqual({
      ...recto,
      xPx: 0.45 * DOCUMENT_CSS_PIXELS_PER_INCH,
      rightPx: (8.5 - 0.8) * DOCUMENT_CSS_PIXELS_PER_INCH,
    });
    expect(verso.widthPx).toBe(recto.widthPx);
  });

  it('collapses invalid or over-constrained content axes instead of going negative', () => {
    const rectangle = getDocumentContentRectanglePx({
      widthIn: 2,
      heightIn: 1,
      margins: {
        topIn: 2,
        bottomIn: -1,
        innerIn: 3,
        outerIn: 4,
      },
      folioNumber: 49,
    });

    expect(rectangle).toEqual({
      xPx: 2 * DOCUMENT_CSS_PIXELS_PER_INCH,
      yPx: DOCUMENT_CSS_PIXELS_PER_INCH,
      widthPx: 0,
      heightPx: 0,
      rightPx: 2 * DOCUMENT_CSS_PIXELS_PER_INCH,
      bottomPx: DOCUMENT_CSS_PIXELS_PER_INCH,
    });
  });

  it('converts physical inches without introducing zoom-scaled coordinates', () => {
    expect(documentInchesToPagePixels(1)).toBe(96);
    expect(documentInchesToPagePixels(8.5)).toBe(816);
    expect(documentPagePixelsToInches(816)).toBe(8.5);
    expect(documentInchesToPagePixels(-1)).toBe(0);
  });
});
