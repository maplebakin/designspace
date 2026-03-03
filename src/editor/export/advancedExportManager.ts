import { jsPDF } from 'jspdf';
import * as fabric from 'fabric';
import { renderCanvasToPngBlob } from '../utils/renderToPng';
import { serializeToSVG } from '../utils/serializeToSVG';
import { coordinateSystem } from '../utils/coordinateSystem';
import { pluginManager } from '../utils/pluginArchitecture';

export type AdvancedExportFormat = 'png' | 'svg' | 'pdf';

export type AdvancedExportOptions = {
  includeBackground?: boolean;
  backgroundColor?: string | null;
  dpi?: number;
  bleedPx?: number;
  pageSize?: { width: number; height: number };
  fileName?: string;
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

    if (format === 'png') {
      const blob = await this.exportPng(canvas, options);
      triggerDownload(blob, `${options.fileName ?? 'design-space-export'}.png`);
      return;
    }

    if (format === 'svg') {
      const blob = this.exportSvg(canvas, options);
      triggerDownload(blob, `${options.fileName ?? 'design-space-export'}.svg`);
      return;
    }

    const blob = await this.exportPdf(canvas, options);
    triggerDownload(blob, `${options.fileName ?? 'design-space-export'}.pdf`);
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

  exportSvg(canvas: fabric.Canvas, options: AdvancedExportOptions = {}): Blob {
    const background = options.backgroundColor ?? (canvas.backgroundColor ? String(canvas.backgroundColor) : null);
    const svg = serializeToSVG(canvas.getObjects(), {
      width: options.pageSize?.width ?? canvas.getWidth(),
      height: options.pageSize?.height ?? canvas.getHeight(),
      includeBackground: options.includeBackground ?? true,
      backgroundColor: background,
    });
    return new Blob([svg], { type: 'image/svg+xml' });
  }

  async exportPdf(canvas: fabric.Canvas, options: AdvancedExportOptions = {}): Promise<Blob> {
    const blob = await this.exportPng(canvas, options);
    const imageUrl = URL.createObjectURL(blob);
    const pageWidth = options.pageSize?.width ?? canvas.getWidth();
    const pageHeight = options.pageSize?.height ?? canvas.getHeight();
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
}

export const advancedExportManager = new AdvancedExportManager();
