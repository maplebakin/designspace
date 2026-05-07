import { jsPDF } from 'jspdf';
import * as fabric from 'fabric';
import { renderCanvasToPngBlob } from '../utils/renderToPng';
import { serializeToSVG } from '../utils/serializeToSVG';
import { coordinateSystem } from '../utils/coordinateSystem';
import { pluginManager } from '../utils/pluginArchitecture';
import { useCanvasStore } from '../state/useCanvasStore';
import { sanitizeExportBaseName } from '../utils/exportFileName';
import { reviveCustomFabricProps } from '../fabric/initFabricCanvas';
import { hydrateCanvasDataWithAssets } from '../state/useHistoryStore';
import type { ProjectPage } from '../state/editorStore';

export type AdvancedExportFormat = 'png' | 'jpeg' | 'svg' | 'pdf';

export type AdvancedExportOptions = {
  includeBackground?: boolean;
  backgroundColor?: string | null;
  dpi?: number;
  bleedPx?: number;
  pageSize?: { width: number; height: number };
  fileName?: string;
  quality?: number;
};

type ExportPagesPdfOptions = AdvancedExportOptions & {
  imageAssets?: Record<string, string>;
};

const triggerDownload = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export class AdvancedExportManager {
  async export(
    canvas: fabric.Canvas,
    format: AdvancedExportFormat,
    options: AdvancedExportOptions = {}
  ): Promise<void> {
    pluginManager.emitHook('onExport', { format, options });
    const fileName = sanitizeExportBaseName(options.fileName);

    if (format === 'png') {
      const blob = await this.exportPng(canvas, options);
      triggerDownload(blob, `${fileName}.png`);
      return;
    }

    if (format === 'jpeg') {
      const blob = await this.exportJpeg(canvas, options);
      triggerDownload(blob, `${fileName}.jpeg`);
      return;
    }

    if (format === 'svg') {
      const blob = this.exportSvg(canvas, options);
      triggerDownload(blob, `${fileName}.svg`);
      return;
    }

    const blob = await this.exportPdf(canvas, options);
    triggerDownload(blob, `${fileName}.pdf`);
  }

  async exportPng(canvas: fabric.Canvas, options: AdvancedExportOptions = {}): Promise<Blob> {
    const scaleFactor = (options.dpi ?? 300) / 150;
    const background = options.backgroundColor ?? (canvas.backgroundColor ? String(canvas.backgroundColor) : null);
    return renderCanvasToPngBlob(canvas, {
      scale: Math.max(1, scaleFactor),
      includeBackground: options.includeBackground ?? true,
      backgroundColor: background,
    });
  }

  async exportJpeg(canvas: fabric.Canvas, options: AdvancedExportOptions = {}): Promise<Blob> {
    const scaleFactor = (options.dpi ?? 300) / 150;
    const background = options.backgroundColor ?? (canvas.backgroundColor ? String(canvas.backgroundColor) : null) ?? '#ffffff';
    return renderCanvasToPngBlob(canvas, {
      scale: Math.max(1, scaleFactor),
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
    const widthInches = coordinateSystem.fromFabricUnits(pageWidth, 'in');
    const heightInches = coordinateSystem.fromFabricUnits(pageHeight, 'in');
    const doc = new jsPDF({
      orientation: widthInches >= heightInches ? 'landscape' : 'portrait',
      unit: 'in',
      format: [widthInches, heightInches],
    });

    doc.addImage(imageUrl, 'PNG', 0, 0, widthInches, heightInches);
    URL.revokeObjectURL(imageUrl);
    return doc.output('blob');
  }

  async exportPagesPdf(
    pages: ProjectPage[],
    options: ExportPagesPdfOptions = {}
  ): Promise<void> {
    pluginManager.emitHook('onExport', { format: 'pdf', options: { ...options, scope: 'all-pages' } });
    const fileName = sanitizeExportBaseName(options.fileName);
    const pdf = new jsPDF({ unit: 'in', format: [1, 1] });
    pdf.deletePage(1);

    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const pageWidth = Math.max(1, Math.round(page.canvasSize?.width ?? useCanvasStore.getState().width));
      const pageHeight = Math.max(1, Math.round(page.canvasSize?.height ?? useCanvasStore.getState().height));
      const blob = await this.renderPageToPngBlob(page, {
        ...options,
        pageSize: { width: pageWidth, height: pageHeight },
      });
      const imageDataUrl = await blobToDataUrl(blob);
      const widthInches = coordinateSystem.fromFabricUnits(pageWidth, 'in');
      const heightInches = coordinateSystem.fromFabricUnits(pageHeight, 'in');

      pdf.addPage(
        [widthInches, heightInches],
        widthInches >= heightInches ? 'landscape' : 'portrait'
      );
      pdf.addImage(imageDataUrl, 'PNG', 0, 0, widthInches, heightInches);
    }

    triggerDownload(pdf.output('blob'), `${fileName}.pdf`);
  }

  private async renderPageToPngBlob(
    page: ProjectPage,
    options: ExportPagesPdfOptions
  ): Promise<Blob> {
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
        format: 'png',
        multiplier: Math.max(1, (options.dpi ?? 300) / 150),
        left: 0,
        top: 0,
        width: pageWidth,
        height: pageHeight,
        quality: 1,
      });
      const response = await fetch(dataUrl);
      return await response.blob();
    } finally {
      exportCanvas.dispose();
      canvasElement.remove();
    }
  }
}

export const advancedExportManager = new AdvancedExportManager();

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
