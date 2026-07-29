/**
 * Document page geometry is expressed in unzoomed CSS layout pixels.
 *
 * The origin is always the physical page's top-left corner. Editor zoom is a
 * viewport concern and must never be passed into or persisted from this module.
 */
export const DOCUMENT_CSS_PIXELS_PER_INCH = 96 as const;

export const MIN_DOCUMENT_FOLIO_NUMBER = 1 as const;
export const MAX_DOCUMENT_FOLIO_NUMBER = 999_999 as const;

export type DocumentPageParity = 'recto' | 'verso';
export type DocumentOutsideEdge = 'left' | 'right';

export type DocumentSemanticMarginsIn = Readonly<{
  topIn: number;
  bottomIn: number;
  innerIn: number;
  outerIn: number;
}>;

export type DocumentPhysicalMarginsIn = Readonly<{
  topIn: number;
  rightIn: number;
  bottomIn: number;
  leftIn: number;
}>;

export type DocumentPageRectanglePx = Readonly<{
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
  rightPx: number;
  bottomPx: number;
}>;

export type DocumentContentRectangleInput = Readonly<{
  widthIn: number;
  heightIn: number;
  margins: DocumentSemanticMarginsIn;
  folioNumber: number;
}>;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const finiteNumber = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const nonNegativeNumber = (value: unknown) => {
  const numeric = finiteNumber(value);
  return numeric === null ? 0 : Math.max(0, numeric);
};

/**
 * Normalizes user- or file-provided folios to the bounded integer range that
 * the document model supports.
 */
export const normalizeDocumentFolioNumber = (
  value: unknown,
  fallback: number = MIN_DOCUMENT_FOLIO_NUMBER
) => {
  const normalizedFallback = finiteNumber(fallback);
  const safeFallback = normalizedFallback === null
    ? MIN_DOCUMENT_FOLIO_NUMBER
    : clamp(
        Math.trunc(normalizedFallback),
        MIN_DOCUMENT_FOLIO_NUMBER,
        MAX_DOCUMENT_FOLIO_NUMBER
      );
  const numeric = finiteNumber(value);
  if (numeric === null) return safeFallback;
  return clamp(
    Math.trunc(numeric),
    MIN_DOCUMENT_FOLIO_NUMBER,
    MAX_DOCUMENT_FOLIO_NUMBER
  );
};

/**
 * Returns the folio for a zero-based page index. Invalid or negative indexes
 * resolve to the first page. The configured starting folio is bounded, but
 * derived page folios remain consecutive beyond that input bound.
 */
export const getDocumentFolioNumber = (
  startingNumber: number,
  pageIndex: number
) => {
  const start = normalizeDocumentFolioNumber(startingNumber);
  const numericIndex = finiteNumber(pageIndex);
  const safeIndex = numericIndex === null
    ? 0
    : Math.max(0, Math.trunc(numericIndex));
  return Math.min(Number.MAX_SAFE_INTEGER, start + safeIndex);
};

export const getDocumentPageParity = (
  folioNumber: number
): DocumentPageParity => (
  Math.max(
    MIN_DOCUMENT_FOLIO_NUMBER,
    Math.trunc(finiteNumber(folioNumber) ?? MIN_DOCUMENT_FOLIO_NUMBER)
  ) % 2 === 0
    ? 'verso'
    : 'recto'
);

export const getDocumentOutsideEdge = (
  folioNumber: number
): DocumentOutsideEdge => (
  getDocumentPageParity(folioNumber) === 'recto' ? 'right' : 'left'
);

/**
 * Converts semantic book margins to physical page sides. Recto (odd) pages
 * bind on the left; verso (even) pages bind on the right.
 */
export const resolveDocumentPhysicalMargins = (
  margins: DocumentSemanticMarginsIn,
  folioNumber: number
): DocumentPhysicalMarginsIn => {
  const topIn = nonNegativeNumber(margins.topIn);
  const bottomIn = nonNegativeNumber(margins.bottomIn);
  const innerIn = nonNegativeNumber(margins.innerIn);
  const outerIn = nonNegativeNumber(margins.outerIn);
  const recto = getDocumentPageParity(folioNumber) === 'recto';

  return {
    topIn,
    rightIn: recto ? outerIn : innerIn,
    bottomIn,
    leftIn: recto ? innerIn : outerIn,
  };
};

export const documentInchesToPagePixels = (inches: number) =>
  nonNegativeNumber(inches) * DOCUMENT_CSS_PIXELS_PER_INCH;

export const documentPagePixelsToInches = (pixels: number) =>
  nonNegativeNumber(pixels) / DOCUMENT_CSS_PIXELS_PER_INCH;

/**
 * Calculates the physical content box in unzoomed, top-left page-space pixels.
 * Malformed or excessive margins collapse an axis to zero rather than
 * producing negative geometry.
 */
export const getDocumentContentRectanglePx = ({
  widthIn,
  heightIn,
  margins,
  folioNumber,
}: DocumentContentRectangleInput): DocumentPageRectanglePx => {
  const safeWidthIn = nonNegativeNumber(widthIn);
  const safeHeightIn = nonNegativeNumber(heightIn);
  const physicalMargins = resolveDocumentPhysicalMargins(
    margins,
    folioNumber
  );

  const leftIn = Math.min(physicalMargins.leftIn, safeWidthIn);
  const topIn = Math.min(physicalMargins.topIn, safeHeightIn);
  const rightEdgeIn = Math.max(
    leftIn,
    safeWidthIn - Math.min(physicalMargins.rightIn, safeWidthIn)
  );
  const bottomEdgeIn = Math.max(
    topIn,
    safeHeightIn - Math.min(physicalMargins.bottomIn, safeHeightIn)
  );

  const xPx = documentInchesToPagePixels(leftIn);
  const yPx = documentInchesToPagePixels(topIn);
  const rightPx = documentInchesToPagePixels(rightEdgeIn);
  const bottomPx = documentInchesToPagePixels(bottomEdgeIn);

  return {
    xPx,
    yPx,
    widthPx: rightPx - xPx,
    heightPx: bottomPx - yPx,
    rightPx,
    bottomPx,
  };
};
