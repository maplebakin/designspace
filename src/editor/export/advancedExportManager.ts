import { jsPDF } from 'jspdf';
import * as fabric from 'fabric';
import { renderCanvasToPngBlob } from '../utils/renderToPng';
import { serializeToSVG } from '../utils/serializeToSVG';
import { pluginManager } from '../utils/pluginArchitecture';
import { sanitizeExportBaseName } from '../utils/exportFileName';
import {
  deliverFile,
  deliverFiles,
  type FileBatchDeliveryResult,
  type FileDeliveryResult,
} from '../services/fileDeliveryService';
import { loadCanvasFromJsonSafely, reviveCustomFabricProps } from '../fabric/initFabricCanvas';
import { hydrateCanvasDataWithAssets } from '../state/useHistoryStore';
import type { ProjectPage } from '../state/editorStore';
import { serializeCanvasObjects } from '../utils/serialization';
import {
  DEFAULT_CANVAS_BACKGROUND,
  createExportSceneSnapshot,
  createPageSceneSnapshot,
  type ExportSceneSnapshot,
} from '../scene/sceneSnapshot';

export type AdvancedExportFormat = 'png' | 'jpeg' | 'svg' | 'pdf';

export type AdvancedExportOptions = {
  includeBackground?: boolean;
  backgroundColor?: string | null;
  dpi?: number;
  sourceDpi?: number;
  bleedPx?: number;
  pageSize?: { width: number; height: number };
  fileName?: string;
  quality?: number;
  /** Authored page snapshot captured before an async renderer boundary. */
  authoredSnapshot?: ExportSceneSnapshot;
};

export type ExportPagesPdfOptions = AdvancedExportOptions & {
  imageAssets?: Record<string, string>;
  format?: 'png' | 'jpeg';
  pdfImageDpi?: number;
  pdfImageQuality?: number;
};

export type ExportPagesFormat = Exclude<AdvancedExportFormat, 'pdf'>;

export type ExportedPageBlob = {
  pageNumber: number;
  fileName: string;
  blob: Blob;
};

const normalizeDpi = (value: number | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

export const calculateRasterExportScale = (
  targetDpi: number | undefined,
  sourceDpi: number | undefined,
  fallbackSourceDpi = 150
) => {
  const source = normalizeDpi(sourceDpi, fallbackSourceDpi);
  const target = normalizeDpi(targetDpi, source);
  return Math.max(0.05, Math.min(8, target / source));
};

export const calculatePdfPageSizeInches = (
  width: number,
  height: number,
  sourceDpi: number | undefined
) => {
  const dpi = normalizeDpi(sourceDpi, 300);
  return {
    width: Math.max(1, width) / dpi,
    height: Math.max(1, height) / dpi,
  };
};

const waitForDocumentFonts = async () => {
  if (typeof document === 'undefined' || !document.fonts?.ready) return;
  await document.fonts.ready;
};

/** Capture authored scene data before export awaits fonts or image revival. */
const captureExportScene = (
  canvas: fabric.Canvas,
  authoredSnapshot?: ExportSceneSnapshot,
): ExportSceneSnapshot => {
  if (authoredSnapshot) return authoredSnapshot;
  const backgroundColor = canvas.backgroundColor ? String(canvas.backgroundColor) : null;
  return createExportSceneSnapshot({
    canvasSize: {
      width: Math.max(1, Math.round(canvas.getWidth())),
      height: Math.max(1, Math.round(canvas.getHeight())),
    },
    scene: {
      objects: serializeCanvasObjects(canvas),
      ...(backgroundColor ? { background: backgroundColor } : {}),
    },
  });
};

const getProjectPageExportSize = (page: ProjectPage) => ({
  width: Math.max(1, Math.round(Number(page.canvasSize?.width) || 1)),
  height: Math.max(1, Math.round(Number(page.canvasSize?.height) || 1)),
});

/**
 * Adapt a durable canvas page mirror into the renderer-neutral export
 * snapshot. Page size and background come from that page snapshot; the
 * current live canvas store is intentionally not consulted here.
 */
export const createProjectPageExportSnapshot = (
  page: ProjectPage,
  options: Pick<ExportPagesPdfOptions, 'backgroundColor' | 'imageAssets' | 'sourceDpi'> = {},
): ExportSceneSnapshot => {
  const scene = page.canvasData || { objects: [] };
  const background = typeof scene.background === 'string'
    ? scene.background
    : options.backgroundColor ?? DEFAULT_CANVAS_BACKGROUND;
  const pageSnapshot = createPageSceneSnapshot({
    pageId: page.id,
    canvasSize: getProjectPageExportSize(page),
    scene: {
      ...scene,
      background,
    },
    thumbnail: page.thumbnail,
  });
  return createExportSceneSnapshot({
    pageId: page.id,
    canvasSize: pageSnapshot.canvasSize,
    sourceDpi: options.sourceDpi,
    scene: pageSnapshot.scene,
    assets: options.imageAssets || {},
  });
};

export class AdvancedExportManager {
  async export(
    canvas: fabric.Canvas,
    format: AdvancedExportFormat,
    options: AdvancedExportOptions = {}
  ): Promise<FileDeliveryResult> {
    pluginManager.emitHook('onExport', { format, options });
    const fileName = sanitizeExportBaseName(options.fileName);
    const scene = captureExportScene(canvas, options.authoredSnapshot);

    if (format === 'png') {
      const blob = await this.exportPng(canvas, options, scene);
      return deliverFile({
        content: blob,
        fileName: `${fileName}.png`,
        extension: 'png',
        dialogTitle: 'Save PNG export',
        filterName: 'PNG image',
      });
    }

    if (format === 'jpeg') {
      const blob = await this.exportJpeg(canvas, options, scene);
      return deliverFile({
        content: blob,
        fileName: `${fileName}.jpeg`,
        extension: 'jpeg',
        dialogTitle: 'Save JPEG export',
        filterName: 'JPEG image',
      });
    }

    if (format === 'svg') {
      const blob = await this.exportSnapshotSvg(scene, options);
      return deliverFile({
        content: blob,
        fileName: `${fileName}.svg`,
        extension: 'svg',
        dialogTitle: 'Save SVG export',
        filterName: 'SVG image',
      });
    }

    const blob = await this.exportPdf(canvas, options, scene);
    return deliverFile({
      content: blob,
      fileName: `${fileName}.pdf`,
      extension: 'pdf',
      dialogTitle: 'Save PDF export',
      filterName: 'PDF document',
    });
  }

  async exportPng(
    canvas: fabric.Canvas,
    options: AdvancedExportOptions = {},
    scene?: ExportSceneSnapshot,
  ): Promise<Blob> {
    return this.exportSnapshotPng(
      scene ?? captureExportScene(canvas, options.authoredSnapshot),
      options,
    );
  }

  private async exportSnapshotPng(
    scene: ExportSceneSnapshot,
    options: AdvancedExportOptions = {},
  ): Promise<Blob> {
    await waitForDocumentFonts();
    const { canvas, element } = await this.createSnapshotCanvas(scene);
    try {
      const scaleFactor = calculateRasterExportScale(
        options.dpi ?? 300,
        options.sourceDpi ?? scene.sourceDpi,
      );
      const background = options.backgroundColor ?? scene.scene.background ?? null;
      return await renderCanvasToPngBlob(canvas, {
        scale: scaleFactor,
        includeBackground: options.includeBackground ?? true,
        backgroundColor: background,
      });
    } finally {
      canvas.dispose();
      element.remove();
    }
  }

  async exportJpeg(
    canvas: fabric.Canvas,
    options: AdvancedExportOptions = {},
    scene?: ExportSceneSnapshot,
  ): Promise<Blob> {
    return this.exportSnapshotJpeg(
      scene ?? captureExportScene(canvas, options.authoredSnapshot),
      options,
    );
  }

  private async exportSnapshotJpeg(
    scene: ExportSceneSnapshot,
    options: AdvancedExportOptions = {},
  ): Promise<Blob> {
    await waitForDocumentFonts();
    const { canvas, element } = await this.createSnapshotCanvas(scene);
    try {
      const scaleFactor = calculateRasterExportScale(
        options.dpi ?? 300,
        options.sourceDpi ?? scene.sourceDpi,
      );
      const background = options.backgroundColor ?? scene.scene.background ?? '#ffffff';
      return await renderCanvasToPngBlob(canvas, {
        scale: scaleFactor,
        includeBackground: true,
        backgroundColor: background,
        format: 'jpeg',
        quality: options.quality ?? 0.92,
      });
    } finally {
      canvas.dispose();
      element.remove();
    }
  }

  exportSvg(canvas: fabric.Canvas, options: AdvancedExportOptions = {}): Blob {
    const authoredSnapshot = options.authoredSnapshot;
    const background = options.backgroundColor
      ?? authoredSnapshot?.scene.background
      ?? (canvas.backgroundColor ? String(canvas.backgroundColor) : null);
    const { width: documentWidth, height: documentHeight } = authoredSnapshot?.canvasSize
      ?? {
        width: Math.max(1, Math.round(canvas.getWidth())),
        height: Math.max(1, Math.round(canvas.getHeight())),
      };
    const svg = serializeToSVG(canvas, {
      width: options.pageSize?.width ?? authoredSnapshot?.canvasSize.width ?? documentWidth,
      height: options.pageSize?.height ?? authoredSnapshot?.canvasSize.height ?? documentHeight,
      includeBackground: options.includeBackground ?? true,
      backgroundColor: background,
    });
    return new Blob([svg], { type: 'image/svg+xml' });
  }

  async exportPdf(
    canvas: fabric.Canvas,
    options: AdvancedExportOptions = {},
    scene?: ExportSceneSnapshot,
  ): Promise<Blob> {
    const captured = scene ?? captureExportScene(canvas, options.authoredSnapshot);
    const blob = await this.exportSnapshotPng(captured, {
      ...options,
      sourceDpi: options.sourceDpi ?? captured.sourceDpi,
    });
    const imageUrl = URL.createObjectURL(blob);
    const pageWidth = options.pageSize?.width ?? captured.canvasSize.width;
    const pageHeight = options.pageSize?.height ?? captured.canvasSize.height;
    const { width: widthInches, height: heightInches } = calculatePdfPageSizeInches(
      pageWidth,
      pageHeight,
      options.sourceDpi ?? captured.sourceDpi
    );
    const doc = new jsPDF({
      orientation: widthInches >= heightInches ? 'landscape' : 'portrait',
      unit: 'in',
      format: [widthInches, heightInches],
    });

    try {
      doc.addImage(imageUrl, 'PNG', 0, 0, widthInches, heightInches);
      const pdfBlob = doc.output('blob');
      if (!pdfBlob || pdfBlob.size <= 0) {
        throw new Error('PDF export did not produce a nonzero Blob.');
      }
      return pdfBlob;
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  }

  private async createSnapshotCanvas(scene: ExportSceneSnapshot) {
    const element = document.createElement('canvas');
    const canvas = new fabric.Canvas(element, {
      width: scene.canvasSize.width,
      height: scene.canvasSize.height,
      enableRetinaScaling: false,
      renderOnAddRemove: false,
    });
    try {
      await loadCanvasFromJsonSafely(
        canvas,
        hydrateCanvasDataWithAssets(scene.scene, scene.assets),
        reviveCustomFabricProps,
      );
      canvas.setDimensions(scene.canvasSize);
      canvas.backgroundColor = scene.scene.background ?? 'transparent';
      canvas.renderAll();
      return { canvas, element };
    } catch (error) {
      canvas.dispose();
      element.remove();
      throw error;
    }
  }

  private async exportSnapshotSvg(
    scene: ExportSceneSnapshot,
    options: AdvancedExportOptions = {},
  ): Promise<Blob> {
    await waitForDocumentFonts();
    const { canvas, element } = await this.createSnapshotCanvas(scene);
    try {
      return this.exportSvg(canvas, {
        ...options,
        backgroundColor: options.backgroundColor ?? scene.scene.background,
        pageSize: options.pageSize ?? scene.canvasSize,
      });
    } finally {
      canvas.dispose();
      element.remove();
    }
  }

  async exportPagesPdf(
    pages: ProjectPage[],
    options: ExportPagesPdfOptions = {}
  ): Promise<FileDeliveryResult> {
    pluginManager.emitHook('onExport', { format: 'pdf', options: { ...options, scope: 'all-pages' } });
    const fileName = sanitizeExportBaseName(options.fileName);
    const blob = await this.exportPagesPdfBlob(pages, options);
    return deliverFile({
      content: blob,
      fileName: `${fileName}.pdf`,
      extension: 'pdf',
      dialogTitle: 'Save PDF export',
      filterName: 'PDF document',
    });
  }

  async exportPagesPdfBlob(
    pages: ProjectPage[],
    options: ExportPagesPdfOptions = {}
  ): Promise<Blob> {
    const pdfImageDpi = Math.max(96, Math.min(options.pdfImageDpi ?? options.dpi ?? 150, 200));
    const pdfImageQuality = Math.max(0.1, Math.min(options.pdfImageQuality ?? options.quality ?? 0.88, 0.95));
    const pdf = new jsPDF({ unit: 'in', format: [1, 1] });
    pdf.deletePage(1);

    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const pageSnapshot = createProjectPageExportSnapshot(page, options);
      const pageWidth = pageSnapshot.canvasSize.width;
      const pageHeight = pageSnapshot.canvasSize.height;
      const blob = await this.renderPageToPngBlob(page, {
        ...options,
        dpi: pdfImageDpi,
        format: 'jpeg',
        quality: pdfImageQuality,
        pageSize: { width: pageWidth, height: pageHeight },
      });
      const imageBytes = await blobToUint8Array(blob);
      const { width: widthInches, height: heightInches } = calculatePdfPageSizeInches(
        pageWidth,
        pageHeight,
        options.sourceDpi ?? pageSnapshot.sourceDpi
      );

      pdf.addPage(
        [widthInches, heightInches],
        widthInches >= heightInches ? 'landscape' : 'portrait'
      );
      pdf.addImage(
        imageBytes,
        'JPEG',
        0,
        0,
        widthInches,
        heightInches,
        `page-${index + 1}`,
        'FAST'
      );
    }

    const pdfBlob = pdf.output('blob');
    if (!pdfBlob || pdfBlob.size <= 0) {
      throw new Error('PDF export did not produce a nonzero Blob.');
    }
    return pdfBlob;
  }

  async exportPages(
    pages: ProjectPage[],
    format: ExportPagesFormat,
    options: ExportPagesPdfOptions = {}
  ): Promise<FileBatchDeliveryResult> {
    pluginManager.emitHook('onExport', { format, options: { ...options, scope: 'all-pages' } });
    const exportedPages = await this.exportPagesToBlobs(pages, format, options);
    return deliverFiles(
      exportedPages.map(({ blob, fileName }) => ({
        content: blob,
        fileName,
        extension: format,
      })),
      { dialogTitle: `Choose a folder for the exported ${format.toUpperCase()} pages` }
    );
  }

  async exportPagesToBlobs(
    pages: ProjectPage[],
    format: ExportPagesFormat,
    options: ExportPagesPdfOptions = {}
  ): Promise<ExportedPageBlob[]> {
    const fileName = sanitizeExportBaseName(options.fileName);
    const exportedPages: ExportedPageBlob[] = [];

    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const pageNumber = String(index + 1).padStart(2, '0');
      const pageSize = getProjectPageExportSize(page);
      const pageWidth = pageSize.width;
      const pageHeight = pageSize.height;
      const pageOptions = {
        ...options,
        pageSize: { width: pageWidth, height: pageHeight },
      };

      if (format === 'svg') {
        const blob = await this.renderPageToSvgBlob(page, pageOptions);
        exportedPages.push({
          pageNumber: index + 1,
          fileName: `${fileName}-page-${pageNumber}.svg`,
          blob,
        });
        continue;
      }

      const blob = await this.renderPageToPngBlob(page, {
        ...pageOptions,
        format,
      });
      exportedPages.push({
        pageNumber: index + 1,
        fileName: `${fileName}-page-${pageNumber}.${format}`,
        blob,
      });
    }

    return exportedPages;
  }

  private async renderPageToPngBlob(
    page: ProjectPage,
    options: ExportPagesPdfOptions
  ): Promise<Blob> {
    await waitForDocumentFonts();
    const scene = createProjectPageExportSnapshot(page, options);
    const pageWidth = scene.canvasSize.width;
    const pageHeight = scene.canvasSize.height;
    const canvasElement = document.createElement('canvas');
    const exportCanvas = new fabric.Canvas(canvasElement, {
      width: pageWidth,
      height: pageHeight,
      enableRetinaScaling: false,
    });

    try {
      const hydrated = hydrateCanvasDataWithAssets(scene.scene, scene.assets);
      await exportCanvas.loadFromJSON(hydrated, reviveCustomFabricProps);
      exportCanvas.setDimensions({ width: pageWidth, height: pageHeight });
      const background = scene.scene.background
        ?? (exportCanvas.backgroundColor ? String(exportCanvas.backgroundColor) : null);
      const originalBackgroundColor = exportCanvas.backgroundColor;
      const hiddenObjects = exportCanvas.getObjects()
        .filter((object) =>
          (object as any).excludeFromExport || (object as any).isGuide || (object as any).isSmartGuide
        )
        .map((object) => ({ object, visible: object.visible }));

      exportCanvas.backgroundColor = options.includeBackground ?? true
        ? background ?? originalBackgroundColor
        : '';
      hiddenObjects.forEach(({ object }) => object.set('visible', false));
      exportCanvas.renderAll();

      const dataUrl = exportCanvas.toDataURL({
        format: options.format === 'jpeg' ? 'jpeg' : 'png',
        multiplier: calculateRasterExportScale(
          options.dpi ?? 300,
          options.sourceDpi ?? scene.sourceDpi,
        ),
        left: 0,
        top: 0,
        width: pageWidth,
        height: pageHeight,
        quality: options.quality ?? 1,
      });
      const response = await fetch(dataUrl);
      return await response.blob();
    } finally {
      exportCanvas.dispose();
      canvasElement.remove();
    }
  }

  private async renderPageToSvgBlob(
    page: ProjectPage,
    options: ExportPagesPdfOptions
  ): Promise<Blob> {
    await waitForDocumentFonts();
    const scene = createProjectPageExportSnapshot(page, options);
    const pageWidth = scene.canvasSize.width;
    const pageHeight = scene.canvasSize.height;
    const canvasElement = document.createElement('canvas');
    const exportCanvas = new fabric.Canvas(canvasElement, {
      width: pageWidth,
      height: pageHeight,
      enableRetinaScaling: false,
    });

    try {
      const hydrated = hydrateCanvasDataWithAssets(scene.scene, scene.assets);
      await exportCanvas.loadFromJSON(hydrated, reviveCustomFabricProps);
      exportCanvas.setDimensions({ width: pageWidth, height: pageHeight });
      return this.exportSvg(exportCanvas, {
        ...options,
        includeBackground: options.includeBackground,
        backgroundColor: scene.scene.background,
        pageSize: { width: pageWidth, height: pageHeight },
        authoredSnapshot: scene,
      });
    } finally {
      exportCanvas.dispose();
      canvasElement.remove();
    }
  }
}

export const advancedExportManager = new AdvancedExportManager();

const blobToUint8Array = async (blob: Blob): Promise<Uint8Array> => {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) {
        resolve(new Uint8Array(result));
        return;
      }
      reject(new Error('Failed to read image blob as binary data.'));
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read image blob.'));
    reader.readAsArrayBuffer(blob);
  });
};
