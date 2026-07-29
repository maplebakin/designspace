import type {
  DocumentOverlayImage,
  DocumentPage,
  DocumentPageMargins,
  ScanReference,
} from '../types/documentProject';

export type DocumentPaperPreset = 'letter' | 'a4' | 'custom';
export type DocumentPageOrientation = 'portrait' | 'landscape';

const CSS_PIXELS_PER_INCH = 96;

const PORTRAIT_DIMENSIONS: Record<
  Exclude<DocumentPaperPreset, 'custom'>,
  { widthIn: number; heightIn: number }
> = {
  letter: { widthIn: 8.5, heightIn: 11 },
  a4: { widthIn: 210 / 25.4, heightIn: 297 / 25.4 },
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const normalizeCustomDimension = (value: number, fallback: number) =>
  clamp(Number.isFinite(value) ? value : fallback, 1, 24);

export const getDocumentPaperDimensions = (
  preset: Exclude<DocumentPaperPreset, 'custom'>,
  orientation: DocumentPageOrientation
) => {
  const portrait = PORTRAIT_DIMENSIONS[preset];
  return orientation === 'landscape'
    ? { widthIn: portrait.heightIn, heightIn: portrait.widthIn }
    : { ...portrait };
};

const constrainMarginPair = (
  first: number,
  second: number,
  maximumTotal: number
): [number, number] => {
  const safeFirst = Math.max(0, Number.isFinite(first) ? first : 0);
  const safeSecond = Math.max(0, Number.isFinite(second) ? second : 0);
  const total = safeFirst + safeSecond;
  if (total <= maximumTotal || total <= 0) {
    return [safeFirst, safeSecond];
  }
  const scale = maximumTotal / total;
  return [safeFirst * scale, safeSecond * scale];
};

export const constrainDocumentPageMargins = (
  margins: DocumentPageMargins,
  widthIn: number,
  heightIn: number
): DocumentPageMargins => {
  const [innerIn, outerIn] = constrainMarginPair(
    margins.innerIn,
    margins.outerIn,
    Math.max(0, widthIn - 0.25)
  );
  const [topIn, bottomIn] = constrainMarginPair(
    margins.topIn,
    margins.bottomIn,
    Math.max(0, heightIn - 0.25)
  );
  return { topIn, bottomIn, innerIn, outerIn };
};

export const constrainDocumentOverlayToPage = (
  overlay: DocumentOverlayImage,
  widthIn: number,
  heightIn: number
): DocumentOverlayImage => {
  const pageWidthPx = widthIn * CSS_PIXELS_PER_INCH;
  const pageHeightPx = heightIn * CSS_PIXELS_PER_INCH;
  return {
    ...overlay,
    xPx: clamp(overlay.xPx, 0, Math.max(0, pageWidthPx - overlay.widthPx)),
    yPx: clamp(overlay.yPx, 0, Math.max(0, pageHeightPx - overlay.heightPx)),
  };
};

export const constrainDocumentReferenceToPage = (
  reference: ScanReference | undefined,
  widthIn: number,
  heightIn: number
): ScanReference | undefined => {
  if (!reference) return undefined;
  const pageWidthPx = widthIn * CSS_PIXELS_PER_INCH;
  const pageHeightPx = heightIn * CSS_PIXELS_PER_INCH;
  return {
    ...reference,
    offsetXPx: clamp(reference.offsetXPx, -pageWidthPx, pageWidthPx),
    offsetYPx: clamp(reference.offsetYPx, -pageHeightPx, pageHeightPx),
  };
};

export const updateDocumentPagePaper = (
  page: DocumentPage,
  update: {
    preset?: DocumentPaperPreset;
    orientation?: DocumentPageOrientation;
    widthIn?: number;
    heightIn?: number;
  }
): DocumentPage => {
  const preset = update.preset
    ?? page.size.presetId;
  const orientation = update.orientation ?? page.size.orientation;
  const dimensions = preset === 'custom'
    ? (() => {
        const orientationChanged =
          orientation !== page.size.orientation
          && update.widthIn === undefined
          && update.heightIn === undefined;
        return {
          widthIn: orientationChanged
            ? normalizeCustomDimension(page.size.heightIn, 8.5)
            : normalizeCustomDimension(
                update.widthIn ?? page.size.widthIn,
                page.size.widthIn
              ),
          heightIn: orientationChanged
            ? normalizeCustomDimension(page.size.widthIn, 11)
            : normalizeCustomDimension(
                update.heightIn ?? page.size.heightIn,
                page.size.heightIn
              ),
        };
      })()
    : getDocumentPaperDimensions(preset, orientation);
  return {
    ...page,
    size: {
      ...page.size,
      presetId: preset,
      orientation,
      ...dimensions,
    },
    margins: constrainDocumentPageMargins(
      page.margins,
      dimensions.widthIn,
      dimensions.heightIn
    ),
    overlayObjects: page.overlayObjects.map((overlay) =>
      constrainDocumentOverlayToPage(
        overlay,
        dimensions.widthIn,
        dimensions.heightIn
      )
    ),
    reference: constrainDocumentReferenceToPage(
      page.reference,
      dimensions.widthIn,
      dimensions.heightIn
    ),
  };
};
