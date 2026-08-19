import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ingestDocumentImage, type DocumentAsset } from './documentAssetService';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_RENDER_PIXELS = 25_000_000;
const MAX_DIAGNOSTIC_PIXELS = 250_000;

export type DocumentReferenceErrorCode =
  | 'REFERENCE_PDF_INVALID'
  | 'REFERENCE_PDF_RENDER_EMPTY'
  | 'REFERENCE_IMAGE_DECODE_FAILED';

export type DocumentReferenceDiagnosticCode =
  | 'REFERENCE_MISSING_STATE'
  | 'REFERENCE_ASSET_MISSING'
  | 'REFERENCE_SOURCE_MISSING'
  | 'REFERENCE_SOURCE_LOADING'
  | 'REFERENCE_SOURCE_PRESENT'
  | 'REFERENCE_IMAGE_DECODE_FAILED'
  | 'REFERENCE_PDF_RENDER_EMPTY'
  | 'REFERENCE_PRESENT_BUT_OCCLUDED';

export class DocumentReferenceError extends Error {
  constructor(
    message: string,
    public readonly code: DocumentReferenceErrorCode,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DocumentReferenceError';
  }
}

export type PdfRasterDiagnostics = {
  width: number;
  height: number;
  sampledPixelCount: number;
  nonTransparentPixelCount: number;
  meaningfulPixelCount: number;
  alphaCoverage: number;
  luminanceMinimum: number;
  luminanceMaximum: number;
  luminanceVariance: number;
  hasMeaningfulPaint: boolean;
};

export type PdfRenderOptions = {
  onDiagnostics?: (diagnostics: PdfRasterDiagnostics) => void;
};

const readFileBytes = async (file: File) => new Uint8Array(await file.arrayBuffer());

const validatePdf = async (file: File) => {
  if (file.size <= 0) {
    throw new DocumentReferenceError(
      'The selected PDF is empty.',
      'REFERENCE_PDF_INVALID',
    );
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new DocumentReferenceError(
      'PDF references must be 25 MB or smaller.',
      'REFERENCE_PDF_INVALID',
    );
  }
  if (file.type && file.type !== 'application/pdf') {
    throw new DocumentReferenceError(
      'The selected file is not declared as a PDF.',
      'REFERENCE_PDF_INVALID',
    );
  }
  const bytes = await readFileBytes(file);
  if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') {
    throw new DocumentReferenceError(
      'The selected file does not have a valid PDF signature.',
      'REFERENCE_PDF_INVALID',
    );
  }
  return bytes;
};

const getPdfWasmUrl = () => {
  if (typeof document === 'undefined') return undefined;
  try {
    return new URL('pdfjs-wasm/', document.baseURI).href;
  } catch {
    return undefined;
  }
};

/**
 * PDF.js 5.4 supports these options explicitly. Keeping the image decoder on
 * PDF.js's own path avoids WebKit ImageDecoder differences for scanned PDFs;
 * the Vite build exposes the matching OpenJPEG/QCMS files at wasmUrl.
 */
const getPdfDocumentOptions = (bytes: Uint8Array) => ({
  data: bytes,
  isImageDecoderSupported: false,
  isOffscreenCanvasSupported: false,
  canvasMaxAreaInBytes: MAX_RENDER_PIXELS * 4,
  ...(getPdfWasmUrl() ? { wasmUrl: getPdfWasmUrl() } : {}),
});

const canvasToBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new DocumentReferenceError(
      'The PDF page could not be converted to an image.',
      'REFERENCE_IMAGE_DECODE_FAILED',
    ));
  }, 'image/png');
});

const luminance = (red: number, green: number, blue: number) =>
  red * 0.2126 + green * 0.7152 + blue * 0.0722;

/**
 * Read a bounded downsample of the rendered canvas. This catches the common
 * PDF.js failure mode where rendering resolves and toBlob returns a valid,
 * dimensioned PNG even though no page pixels were painted.
 */
export const inspectPdfRasterCanvas = (
  canvas: HTMLCanvasElement,
): PdfRasterDiagnostics => {
  const width = Math.max(0, Math.trunc(canvas.width));
  const height = Math.max(0, Math.trunc(canvas.height));
  if (!width || !height) {
    return {
      width,
      height,
      sampledPixelCount: 0,
      nonTransparentPixelCount: 0,
      meaningfulPixelCount: 0,
      alphaCoverage: 0,
      luminanceMinimum: 0,
      luminanceMaximum: 0,
      luminanceVariance: 0,
      hasMeaningfulPaint: false,
    };
  }

  const sampleScale = Math.min(
    1,
    Math.sqrt(MAX_DIAGNOSTIC_PIXELS / (width * height)),
  );
  const sampleWidth = Math.max(1, Math.round(width * sampleScale));
  const sampleHeight = Math.max(1, Math.round(height * sampleScale));
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = sampleWidth;
  sampleCanvas.height = sampleHeight;
  const sampleContext = sampleCanvas.getContext('2d');
  if (!sampleContext) {
    throw new DocumentReferenceError(
      'The PDF page could not be inspected after rendering.',
      'REFERENCE_PDF_RENDER_EMPTY',
    );
  }

  try {
    sampleContext.drawImage(
      canvas,
      0,
      0,
      width,
      height,
      0,
      0,
      sampleWidth,
      sampleHeight,
    );
    const data = sampleContext.getImageData(
      0,
      0,
      sampleWidth,
      sampleHeight,
    ).data;
    const sampledPixelCount = Math.min(
      sampleWidth * sampleHeight,
      Math.floor(data.length / 4),
    );
    let nonTransparentPixelCount = 0;
    let meaningfulPixelCount = 0;
    let luminanceMinimum = 255;
    let luminanceMaximum = 0;
    let luminanceSum = 0;
    let luminanceSquareSum = 0;

    for (let index = 0; index < sampledPixelCount; index += 1) {
      const offset = index * 4;
      const alpha = data[offset + 3];
      if (alpha <= 4) continue;
      nonTransparentPixelCount += 1;
      const value = luminance(data[offset], data[offset + 1], data[offset + 2]);
      luminanceMinimum = Math.min(luminanceMinimum, value);
      luminanceMaximum = Math.max(luminanceMaximum, value);
      luminanceSum += value;
      luminanceSquareSum += value * value;
      // White/near-white pixels alone are not evidence that a page was
      // painted. A single dark or coloured scan mark is enough to retain a
      // legitimately sparse reference.
      if (value < 250 || alpha < 245) meaningfulPixelCount += 1;
    }

    const mean = nonTransparentPixelCount > 0
      ? luminanceSum / nonTransparentPixelCount
      : 0;
    const variance = nonTransparentPixelCount > 0
      ? Math.max(0, luminanceSquareSum / nonTransparentPixelCount - mean * mean)
      : 0;
    const alphaCoverage = sampledPixelCount > 0
      ? nonTransparentPixelCount / sampledPixelCount
      : 0;
    const hasMeaningfulPaint = nonTransparentPixelCount > 0
      && meaningfulPixelCount > 0;

    return {
      width,
      height,
      sampledPixelCount,
      nonTransparentPixelCount,
      meaningfulPixelCount,
      alphaCoverage,
      luminanceMinimum: nonTransparentPixelCount > 0 ? luminanceMinimum : 0,
      luminanceMaximum: nonTransparentPixelCount > 0 ? luminanceMaximum : 0,
      luminanceVariance: variance,
      hasMeaningfulPaint,
    };
  } catch (error) {
    throw new DocumentReferenceError(
      'The PDF page could not be inspected after rendering.',
      'REFERENCE_PDF_RENDER_EMPTY',
      error,
    );
  }
};

export const renderFirstPdfPageAsDocumentAsset = async (
  file: File,
  options: PdfRenderOptions = {},
): Promise<DocumentAsset> => {
  const bytes = await validatePdf(file);
  const loadingTask = pdfjsLib.getDocument(getPdfDocumentOptions(bytes));
  try {
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const requestedScale = 2;
    const pixelLimitedScale = Math.sqrt(MAX_RENDER_PIXELS / (base.width * base.height));
    const viewport = page.getViewport({
      scale: Math.max(1, Math.min(requestedScale, pixelLimitedScale)),
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) {
      throw new DocumentReferenceError(
        'Could not create a canvas for the PDF reference.',
        'REFERENCE_PDF_RENDER_EMPTY',
      );
    }
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    const diagnostics = inspectPdfRasterCanvas(canvas);
    options.onDiagnostics?.(diagnostics);
    if (!diagnostics.hasMeaningfulPaint) {
      throw new DocumentReferenceError(
        'That PDF page could not be rendered as a visible reference.',
        'REFERENCE_PDF_RENDER_EMPTY',
      );
    }
    const blob = await canvasToBlob(canvas);
    try {
      return await ingestDocumentImage(blob, {
        fileName: `${file.name.replace(/\.pdf$/i, '') || 'PDF'}-page-1.png`,
      });
    } catch (error) {
      throw new DocumentReferenceError(
        'The rendered PDF page could not be decoded as a visible image.',
        'REFERENCE_IMAGE_DECODE_FAILED',
        error,
      );
    }
  } finally {
    await loadingTask.destroy();
  }
};

export const ingestDocumentReference = (
  file: File,
  options: PdfRenderOptions = {},
) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  ? renderFirstPdfPageAsDocumentAsset(file, options)
  : ingestDocumentImage(file);
