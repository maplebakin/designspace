import { jsPDF } from 'jspdf';
import * as fabric from 'fabric';
import { renderCanvasToPngBlob } from '../utils/renderToPng';
import { serializeToSVG } from '../utils/serializeToSVG';
import { pluginManager } from '../utils/pluginArchitecture';
import { useCanvasStore } from '../state/useCanvasStore';
import { sanitizeExportBaseName } from '../utils/exportFileName';
import {
  deliverFile,
  deliverFiles,
  type FileBatchDeliveryResult,
  type FileDeliveryResult,
} from '../services/fileDeliveryService';
import { reviveCustomFabricProps } from '../fabric/initFabricCanvas';
import { hydrateCanvasDataWithAssets } from '../state/useHistoryStore';
import type { ProjectPage } from '../state/editorStore';

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

export class AdvancedExportManager {
  async export(
    canvas: fabric.Canvas,
    format: AdvancedExportFormat,
    options: AdvancedExportOptions = {}
  ): Promise<FileDeliveryResult> {
    pluginManager.emitHook('onExport', { format, options });
    const fileName = sanitizeExportBaseName(options.fileName);

    if (format === 'png') {
      const blob = await this.exportPng(canvas, options);
      return deliverFile({
        content: blob,
        fileName: `${fileName}.png`,
        extension: 'png',
        dialogTitle: 'Save PNG export',
        filterName: 'PNG image',
      });
    }

    if (format === 'jpeg') {
      const blob = await this.exportJpeg(canvas, options);
      return deliverFile({
        content: blob,
        fileName: `${fileName}.jpeg`,
        extension: 'jpeg',
        dialogTitle: 'Save JPEG export',
        filterName: 'JPEG image',
      });
    }

    if (format === 'svg') {
      await waitForDocumentFonts();
      const blob = this.exportSvg(canvas, options);
      return deliverFile({
        content: blob,
        fileName: `${fileName}.svg`,
        extension: 'svg',
        dialogTitle: 'Save SVG export',
        filterName: 'SVG image',
      });
    }

    const blob = await this.exportPdf(canvas, options);
    return deliverFile({
      content: blob,
      fileName: `${fileName}.pdf`,
      extension: 'pdf',
      dialogTitle: 'Save PDF export',
      filterName: 'PDF document',
    });
  }

  async exportPng(canvas: fabric.Canvas, options: AdvancedExportOptions = {}): Promise<Blob> {
    await waitForDocumentFonts();
    const scaleFactor = calculateRasterExportScale(options.dpi ?? 300, options.sourceDpi);
    const background = options.backgroundColor ?? (canvas.backgroundColor ? String(canvas.backgroundColor) : null);
    return renderCanvasToPngBlob(canvas, {
      scale: scaleFactor,
      includeBackground: options.includeBackground ?? true,
      backgroundColor: background,
    });
  }

  async exportJpeg(canvas: fabric.Canvas, options: AdvancedExportOptions = {}): Promise<Blob> {
    await waitForDocumentFonts();
    const scaleFactor = calculateRasterExportScale(options.dpi ?? 300, options.sourceDpi);
    const background = options.backgroundColor ?? (canvas.backgroundColor ? String(canvas.backgroundColor) : null) ?? '#ffffff';
    return renderCanvasToPngBlob(canvas, {
      scale: scaleFactor,
      includeBackground: true,
      backgroundColor: background,
      format: 'jpeg',
      quality: options.quality ?? 0.92,
    });
  }

  exportSvg(canvas: fabric.Canvas, options: AdvancedExportOptions = {}): Blob {
    const background = options.backgroundColor ?? (canvas.backgroundColor ? String(canvas.backgroundColor) : null);
    const { width: documentWidth, height: documentHeight } = useCanvasStore.getState();
    const svg = serializeToSVG(canvas, {
      width: options.pageSize?.width ?? documentWidth,
      height: options.pageSize?.height ?? documentHeight,
      includeBackground: options.includeBackground ?? true,
      backgroundColor: background,
    });
    return new Blob([svg], { type: 'image/svg+xml' });
  }

  async exportPdf(canvas: fabric.Canvas, options: AdvancedExportOptions = {}): Promise<Blob> {
    const blob = await this.exportPng(canvas, options);
    const imageUrl = URL.createObjectURL(blob);
    const { width: documentWidth, height: documentHeight } = useCanvasStore.getState();
    const pageWidth = options.pageSize?.width ?? documentWidth;
    const pageHeight = options.pageSize?.height ?? documentHeight;
    const { width: widthInches, height: heightInches } = calculatePdfPageSizeInches(
      pageWidth,
      pageHeight,
      options.sourceDpi
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
      const pageWidth = Math.max(1, Math.round(page.canvasSize?.width ?? useCanvasStore.getState().width));
      const pageHeight = Math.max(1, Math.round(page.canvasSize?.height ?? useCanvasStore.getState().height));
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
        options.sourceDpi
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
      const pageWidth = Math.max(1, Math.round(page.canvasSize?.width ?? useCanvasStore.getState().width));
      const pageHeight = Math.max(1, Math.round(page.canvasSize?.height ?? useCanvasStore.getState().height));
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
    const pageWidth = Math.max(1, Math.round(options.pageSize?.width ?? page.canvasSize?.width ?? useCanvasStore.getState().width));
    const pageHeight = Math.max(1, Math.round(options.pageSize?.height ?? page.canvasSize?.height ?? useCanvasStore.getState().height));
    const canvasElement = document.createElement('canvas');
    const exportCanvas = new fabric.Canvas(canvasElement, {
      width: pageWidth,
      height: pageHeight,
      enableRetinaScaling: false,
    });

    try {
      const hydrated = hydrateCanvasDataWithAssets(
        page.canvasData || { objects: [] },
        options.imageAssets || {}
      );
      await exportCanvas.loadFromJSON(hydrated, reviveCustomFabricProps);
      exportCanvas.setDimensions({ width: pageWidth, height: pageHeight });
      const pageBackground = typeof (page.canvasData as any)?.background === 'string'
        ? (page.canvasData as any).background
        : null;
      const background = pageBackground
        ?? options.backgroundColor
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
        multiplier: calculateRasterExportScale(options.dpi ?? 300, options.sourceDpi),
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
    const pageWidth = Math.max(1, Math.round(options.pageSize?.width ?? page.canvasSize?.width ?? useCanvasStore.getState().width));
    const pageHeight = Math.max(1, Math.round(options.pageSize?.height ?? page.canvasSize?.height ?? useCanvasStore.getState().height));
    const canvasElement = document.createElement('canvas');
    const exportCanvas = new fabric.Canvas(canvasElement, {
      width: pageWidth,
      height: pageHeight,
      enableRetinaScaling: false,
    });

    try {
      const hydrated = hydrateCanvasDataWithAssets(
        page.canvasData || { objects: [] },
        options.imageAssets || {}
      );
      await exportCanvas.loadFromJSON(hydrated, reviveCustomFabricProps);
      exportCanvas.setDimensions({ width: pageWidth, height: pageHeight });
      const pageBackground = typeof (page.canvasData as any)?.background === 'string'
        ? (page.canvasData as any).background
        : null;
      const background = pageBackground
        ?? options.backgroundColor
        ?? (exportCanvas.backgroundColor ? String(exportCanvas.backgroundColor) : null);
      return this.exportSvg(exportCanvas, {
        ...options,
        includeBackground: options.includeBackground,
        backgroundColor: background,
        pageSize: { width: pageWidth, height: pageHeight },
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
