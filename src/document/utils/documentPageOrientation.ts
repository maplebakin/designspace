import type {
  DocumentOverlayImage,
  DocumentPage,
  ScanReference,
} from '../types/documentProject';

export type DocumentPaperPreset = 'letter' | 'a4';
export type DocumentPageOrientation = 'portrait' | 'landscape';

const CSS_PIXELS_PER_INCH = 96;

const PORTRAIT_DIMENSIONS: Record<
  DocumentPaperPreset,
  { widthIn: number; heightIn: number }
> = {
  letter: { widthIn: 8.5, heightIn: 11 },
  a4: { widthIn: 210 / 25.4, heightIn: 297 / 25.4 },
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export const getDocumentPaperDimensions = (
  preset: DocumentPaperPreset,
  orientation: DocumentPageOrientation
) => {
  const portrait = PORTRAIT_DIMENSIONS[preset];
  return orientation === 'landscape'
    ? { widthIn: portrait.heightIn, heightIn: portrait.widthIn }
    : { ...portrait };
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
  }
): DocumentPage => {
  const preset = update.preset
    ?? (page.size.presetId === 'a4' ? 'a4' : 'letter');
  const orientation = update.orientation ?? page.size.orientation;
  const dimensions = getDocumentPaperDimensions(preset, orientation);
  return {
    ...page,
    size: {
      ...page.size,
      presetId: preset,
      orientation,
      ...dimensions,
    },
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
