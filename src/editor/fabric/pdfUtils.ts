import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import { useEditorStore } from '../state/editorStore';
import { commitCanvasMutation } from '../utils/commitCanvasMutation';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_RENDER_PIXELS = 25_000_000;

const readFileBytes = (file: File) => new Promise<Uint8Array>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    if (reader.result instanceof ArrayBuffer) {
      resolve(new Uint8Array(reader.result));
    } else {
      reject(new Error('Failed to read the PDF file.'));
    }
  };
  reader.onerror = () => reject(reader.error || new Error('Failed to read the PDF file.'));
  reader.readAsArrayBuffer(file);
});

const assertPdfFile = async (file: File) => {
  if (file.size <= 0) throw new Error('The selected PDF is empty.');
  if (file.size > MAX_PDF_BYTES) throw new Error('PDF backgrounds must be 25 MB or smaller.');
  if (file.type && file.type !== 'application/pdf') {
    throw new Error('The selected file is not declared as a PDF.');
  }
  const bytes = await readFileBytes(file);
  const signature = String.fromCharCode(...bytes.slice(0, 5));
  if (signature !== '%PDF-') throw new Error('The selected file does not have a valid PDF signature.');
  return bytes;
};

/**
 * Renders the first PDF page into a normal locked image layer. Keeping it as a
 * canvas object makes the background portable across page switches, project
 * files, history, and every export path.
 */
export const loadPdfAsBackground = async (file: File, canvas: fabric.Canvas) => {
  const bytes = await assertPdfFile(file);
  const loadingTask = pdfjsLib.getDocument({ data: bytes });

  try {
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const targetWidth = Math.max(1, canvas.width || 1);
    const targetHeight = Math.max(1, canvas.height || 1);
    const requestedScale = Math.max(targetWidth / baseViewport.width, targetHeight / baseViewport.height);
    const pixelLimitedScale = Math.sqrt(MAX_RENDER_PIXELS / (baseViewport.width * baseViewport.height));
    const viewport = page.getViewport({ scale: Math.max(1, Math.min(requestedScale, pixelLimitedScale)) });
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = Math.max(1, Math.round(viewport.width));
    tempCanvas.height = Math.max(1, Math.round(viewport.height));
    const context = tempCanvas.getContext('2d');
    if (!context) throw new Error('Could not create a canvas for the PDF background.');

    await page.render({ canvasContext: context, viewport, canvas: tempCanvas }).promise;
    const image = await fabric.Image.fromURL(tempCanvas.toDataURL('image/png'));
    if (!image.width || !image.height) throw new Error('The PDF page did not render a usable image.');

    image.set({
      id: uuidv4(),
      name: `${file.name.replace(/\.pdf$/i, '') || 'PDF'} background`,
      semanticRole: 'page-background',
      left: 0,
      top: 0,
      originX: 'left',
      originY: 'top',
      scaleX: targetWidth / image.width,
      scaleY: targetHeight / image.height,
      lockMovementX: true,
      lockMovementY: true,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      lockSkewingX: true,
      lockSkewingY: true,
      hasControls: false,
    } as any);

    canvas.getObjects()
      .filter((object) => (object as any).semanticRole === 'page-background')
      .forEach((object) => canvas.remove(object));
    canvas.add(image);
    canvas.sendObjectToBack(image);
    image.setCoords();

    const state = useEditorStore.getState();
    commitCanvasMutation(canvas, {
      syncCanvasToStore: state.syncCanvasToStore,
      saveState: state.saveState,
      requestLayerSync: state.requestLayerSync,
    });
    return image;
  } finally {
    await loadingTask.destroy();
  }
};
