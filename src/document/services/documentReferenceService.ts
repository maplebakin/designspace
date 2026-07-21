import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ingestDocumentImage, type DocumentAsset } from './documentAssetService';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_RENDER_PIXELS = 25_000_000;

const readFileBytes = async (file: File) => new Uint8Array(await file.arrayBuffer());

const validatePdf = async (file: File) => {
  if (file.size <= 0) throw new Error('The selected PDF is empty.');
  if (file.size > MAX_PDF_BYTES) throw new Error('PDF references must be 25 MB or smaller.');
  if (file.type && file.type !== 'application/pdf') {
    throw new Error('The selected file is not declared as a PDF.');
  }
  const bytes = await readFileBytes(file);
  if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') {
    throw new Error('The selected file does not have a valid PDF signature.');
  }
  return bytes;
};

const canvasToBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('The PDF page could not be converted to an image.'));
  }, 'image/png');
});

export const renderFirstPdfPageAsDocumentAsset = async (
  file: File
): Promise<DocumentAsset> => {
  const bytes = await validatePdf(file);
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  try {
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const requestedScale = 2;
    const pixelLimitedScale = Math.sqrt(MAX_RENDER_PIXELS / (base.width * base.height));
    const viewport = page.getViewport({ scale: Math.max(1, Math.min(requestedScale, pixelLimitedScale)) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create a canvas for the PDF reference.');
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    const blob = await canvasToBlob(canvas);
    return ingestDocumentImage(blob, {
      fileName: `${file.name.replace(/\.pdf$/i, '') || 'PDF'}-page-1.png`,
    });
  } finally {
    await loadingTask.destroy();
  }
};

export const ingestDocumentReference = (file: File) =>
  file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    ? renderFirstPdfPageAsDocumentAsset(file)
    : ingestDocumentImage(file);
