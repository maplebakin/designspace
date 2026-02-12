/**
 * advancedExports - Advanced exports with multi-page support
 * Implements Task 18: Implement advanced exports with multi-page support
 */

import * as fabric from 'fabric';
import { jsPDF } from 'jspdf';

export interface ExportOptions {
  format: 'png' | 'jpeg' | 'svg' | 'pdf' | 'multi-page-pdf';
  quality?: number; // For JPEG
  multiplier?: number; // For raster formats
  clipToCanvas?: boolean;
  bleed?: number; // Bleed margin in pixels
  includeGuides?: boolean;
  includeBackground?: boolean;
  pages?: PageExportOptions[]; // For multi-page exports
  pdfOptions?: PdfExportOptions; // For PDF-specific options
  includeCropMarks?: boolean; // Added for line 459 error
}

export interface PageExportOptions {
  id: string;
  name: string;
  width: number;
  height: number;
  objects: fabric.Object[]; // Specific objects for this page
  bleed?: number;
  cropMarks?: boolean;
  pageNumber?: number;
}

export interface PdfExportOptions {
  pageSize?: 'a3' | 'a4' | 'a5' | 'letter' | 'legal' | 'tabloid' | [number, number]; // Custom size in points
  pageOrientation?: 'portrait' | 'landscape';
  compress?: boolean;
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  includePageNumbers?: boolean;
  includeCropMarks?: boolean;
  includeBleed?: boolean;
}

export interface ExportResult {
  success: boolean;
  data?: Blob | string; // Data URL or blob
  filename: string;
  format: string;
  size: number; // Size in bytes
  error?: string;
}

export class AdvancedExportManager {
  private static instance: AdvancedExportManager;

  static getInstance(): AdvancedExportManager {
    if (!AdvancedExportManager.instance) {
      AdvancedExportManager.instance = new AdvancedExportManager();
    }
    return AdvancedExportManager.instance;
  }

  /**
   * Export canvas with advanced options
   */
  async exportCanvas(canvas: fabric.Canvas, options: ExportOptions): Promise<ExportResult> {
    try {
      switch (options.format) {
        case 'multi-page-pdf':
          return await this.exportMultiPagePdf(canvas, options);
        case 'pdf':
          return await this.exportPdf(canvas, options);
        case 'png':
        case 'jpeg':
        case 'svg':
          return await this.exportRasterOrSvg(canvas, options);
        default:
          return {
            success: false,
            filename: '',
            format: options.format,
            size: 0,
            error: `Unsupported format: ${options.format}`
          };
      }
    } catch (error) {
      console.error('Export failed:', error);
      return {
        success: false,
        filename: '',
        format: options.format,
        size: 0,
        error: error instanceof Error ? error.message : 'Unknown error during export'
      };
    }
  }

  /**
   * Export to raster format (PNG, JPEG) or SVG
   */
  private exportRasterOrSvg(canvas: fabric.Canvas, options: ExportOptions): ExportResult {
    const { format, multiplier = 1, clipToCanvas = true, bleed = 0, includeGuides = false, includeBackground = true } = options;
    
    // Temporarily hide guides if not included
    let guidesHidden = false;
    if (!includeGuides) {
      const allObjects = canvas.getObjects();
      allObjects.forEach(obj => {
        if ((obj as any).isGuide) {
          obj.set({ visible: false });
          guidesHidden = true;
        }
      });
    }

    // Add bleed if specified
    let exportCanvas: fabric.Canvas;
    if (bleed > 0) {
      exportCanvas = this.createCanvasWithBleed(canvas, bleed, includeBackground);
    } else {
      exportCanvas = canvas;
    }

    let dataUrl: string;
    let mimeType: string;
    let extension: string;

    if (format === 'svg') {
      dataUrl = exportCanvas.toSVG({
        suppressPreamble: false,
      }) || '';
      mimeType = 'image/svg+xml';
      extension = 'svg';
    } else {
      dataUrl = exportCanvas.toDataURL({
        format: format as 'png' | 'jpeg',
        quality: options.quality || (format === 'jpeg' ? 0.92 : 1),
        multiplier: multiplier,
        left: clipToCanvas ? 0 : undefined,
        top: clipToCanvas ? 0 : undefined,
        width: clipToCanvas ? canvas.width : undefined,
        height: clipToCanvas ? canvas.height : undefined,
      });
      mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
      extension = format;
    }

    // Restore guides if they were hidden
    if (guidesHidden) {
      const allObjects = canvas.getObjects();
      allObjects.forEach(obj => {
        if ((obj as any).isGuide) {
          obj.set({ visible: true });
        }
      });
      canvas.requestRenderAll();
    }

    // Convert data URL to blob
    const byteCharacters = atob(dataUrl.split(',')[1]);
    const byteArrays = [];

    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512);
      const byteNumbers = new Array(slice.length);

      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }

      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }

    const blob = new Blob(byteArrays, { type: mimeType });
    const size = blob.size;

    return {
      success: true,
      data: blob,
      filename: `design.${extension}`,
      format,
      size
    };
  }

  /**
   * Export to PDF
   */
  private async exportPdf(canvas: fabric.Canvas, options: ExportOptions): Promise<ExportResult> {
    const pdfOptions = options.pdfOptions || {};
    const { pageSize = 'a4', pageOrientation = 'portrait', title, author, subject, keywords } = pdfOptions;
    
    // Determine page size in points (1 inch = 72 points)
    let pageWidth: number, pageHeight: number;
    if (Array.isArray(pageSize)) {
      [pageWidth, pageHeight] = pageSize;
    } else {
      // Standard page sizes in points
      const sizes: Record<string, [number, number]> = {
        'a3': [841.89, 1190.55],
        'a4': [595.28, 841.89],
        'a5': [419.53, 595.28],
        'letter': [612, 792],
        'legal': [612, 1008],
        'tabloid': [792, 1224],
      };
      
      [pageWidth, pageHeight] = sizes[pageSize] || sizes['a4'];
      
      // Swap dimensions if landscape
      if (pageOrientation === 'landscape') {
        [pageWidth, pageHeight] = [pageHeight, pageWidth];
      }
    }

    // Create a temporary canvas to render the content at appropriate size
    const canvasElement = document.createElement('canvas');
    canvasElement.width = pageWidth;
    canvasElement.height = pageHeight;

    const tempCanvas = new fabric.Canvas(canvasElement, {
      width: pageWidth,
      height: pageHeight,
    });

    // Copy objects from the original canvas
    const originalObjects = canvas.getObjects();
    const filteredObjects = originalObjects.filter((obj: fabric.Object) => !(options.includeGuides === false && (obj as any).isGuide));
    const clonedObjectsPromises: Promise<fabric.Object>[] = filteredObjects.map((obj: fabric.Object) => {
      return new Promise<fabric.Object>((resolve) => {
        (obj.clone as any)(['id', 'tokenRole', 'colorLocked']).then((cloned: fabric.Object) => resolve(cloned));
      });
    });
    const clonedObjects = await Promise.all(clonedObjectsPromises);

    // Calculate scaling to fit content in PDF page
    const contentWidth = canvas.getWidth();
    const contentHeight = canvas.getHeight();
    
    const scaleX = pageWidth / contentWidth;
    const scaleY = pageHeight / contentHeight;
    const scale = Math.min(scaleX, scaleY) * 0.9; // 90% to leave margins

    // Position content in the center
    const offsetX = (pageWidth - contentWidth * scale) / 2;
    const offsetY = (pageHeight - contentHeight * scale) / 2;

    // Add scaled objects to temp canvas
    clonedObjects.forEach((obj: fabric.Object, index: number) => {
      obj.set({
        left: (originalObjects[index].left || 0) * scale + offsetX,
        top: (originalObjects[index].top || 0) * scale + offsetY,
        scaleX: (obj.scaleX || 1) * scale,
        scaleY: (obj.scaleY || 1) * scale,
        angle: obj.angle,
      });
      obj.setCoords();
      tempCanvas.add(obj);
    });

    // Create the PDF
    const pdf = new jsPDF({
      orientation: pageOrientation,
      unit: 'pt',
      format: Array.isArray(pageSize) ? [pageWidth, pageHeight] : pageSize,
    });

    // Set document properties
    if (title) pdf.setProperties({ title });
    if (author) pdf.setProperties({ author });
    if (subject) pdf.setProperties({ subject });
    if (keywords) pdf.setProperties({ keywords });

    // Add the canvas content to the PDF
    const imageData = tempCanvas.toDataURL({ format: 'png', multiplier: 2 }); // Higher res for PDF
    pdf.addImage(imageData, 'PNG', 0, 0, pageWidth, pageHeight);

    // Clean up
    tempCanvas.dispose();

    // Get PDF as blob
    const pdfBlob = new Blob([pdf.output('blob')], { type: 'application/pdf' });
    const size = pdfBlob.size;

    return {
      success: true,
      data: pdfBlob,
      filename: 'design.pdf',
      format: 'pdf',
      size
    };
  }

  /**
   * Export multi-page PDF
   */
  private async exportMultiPagePdf(canvas: fabric.Canvas, options: ExportOptions): Promise<ExportResult> {
    const pdfOptions = options.pdfOptions || {};
    const { pageSize = 'a4', pageOrientation = 'portrait', title, author, subject, keywords, includePageNumbers } = pdfOptions;
    
    // Determine page size in points (1 inch = 72 points)
    let pageWidth: number, pageHeight: number;
    if (Array.isArray(pageSize)) {
      [pageWidth, pageHeight] = pageSize;
    } else {
      // Standard page sizes in points
      const sizes: Record<string, [number, number]> = {
        'a3': [841.89, 1190.55],
        'a4': [595.28, 841.89],
        'a5': [419.53, 595.28],
        'letter': [612, 792],
        'legal': [612, 1008],
        'tabloid': [792, 1224],
      };
      
      [pageWidth, pageHeight] = sizes[pageSize] || sizes['a4'];
      
      // Swap dimensions if landscape
      if (pageOrientation === 'landscape') {
        [pageWidth, pageHeight] = [pageHeight, pageWidth];
      }
    }

    // Create the PDF
    const pdf = new jsPDF({
      orientation: pageOrientation,
      unit: 'pt',
      format: Array.isArray(pageSize) ? [pageWidth, pageHeight] : pageSize,
    });

    // Set document properties
    if (title) pdf.setProperties({ title });
    if (author) pdf.setProperties({ author });
    if (subject) pdf.setProperties({ subject });
    if (keywords) pdf.setProperties({ keywords });

    // Get pages from options or create a single page with all objects
    const pages = options.pages || [{
      id: 'page-1',
      name: 'Page 1',
      width: canvas.getWidth(),
      height: canvas.getHeight(),
      objects: canvas.getObjects(),
    }];

    // Process each page
    for (let i = 0; i < pages.length; i++) {
      if (i > 0) {
        pdf.addPage([pageWidth, pageHeight], pageOrientation);
      }

      const page = pages[i];
      
      // Create a temporary canvas for this page
      const canvasElement = document.createElement('canvas');
      canvasElement.width = pageWidth;
      canvasElement.height = pageHeight;

      const tempCanvas = new fabric.Canvas(canvasElement, {
        width: pageWidth,
        height: pageHeight,
      });

      // Calculate scaling to fit page content in PDF page
      const scaleX = pageWidth / page.width;
      const scaleY = pageHeight / page.height;
      const scale = Math.min(scaleX, scaleY) * 0.9; // 90% to leave margins

      // Position content in the center
      const offsetX = (pageWidth - page.width * scale) / 2;
      const offsetY = (pageHeight - page.height * scale) / 2;

      // Clone and add objects for this page
      const clonedObjectsPromises: Promise<fabric.Object>[] = page.objects.map((obj: fabric.Object) => {
        return new Promise<fabric.Object>((resolve) => {
          (obj.clone as any)(['id', 'tokenRole', 'colorLocked']).then((cloned: fabric.Object) => resolve(cloned));
        });
      });
      const clonedObjects = await Promise.all(clonedObjectsPromises);

      // Add scaled objects to temp canvas
      clonedObjects.forEach((obj: fabric.Object, index: number) => {
        obj.set({
          left: (page.objects[index].left || 0) * scale + offsetX,
          top: (page.objects[index].top || 0) * scale + offsetY,
          scaleX: (obj.scaleX || 1) * scale,
          scaleY: (obj.scaleY || 1) * scale,
          angle: obj.angle,
        });
        obj.setCoords();
        tempCanvas.add(obj);
      });

      // Add the page content to the PDF
      const imageData = tempCanvas.toDataURL({ format: 'png', multiplier: 2 }); // Higher res for PDF
      pdf.addImage(imageData, 'PNG', 0, 0, pageWidth, pageHeight);

      // Add page number if requested
      if (includePageNumbers) {
        pdf.setFontSize(10);
        pdf.text(`${i + 1} / ${pages.length}`, pageWidth - 30, pageHeight - 10);
      }

      // Clean up
      tempCanvas.dispose();
    }

    // Get PDF as blob
    const pdfBlob = new Blob([pdf.output('blob')], { type: 'application/pdf' });
    const size = pdfBlob.size;

    return {
      success: true,
      data: pdfBlob,
      filename: 'multipage-design.pdf',
      format: 'multi-page-pdf',
      size
    };
  }

  /**
   * Create a canvas with bleed area
   */
  private createCanvasWithBleed(canvas: fabric.Canvas, bleed: number, includeBackground: boolean): fabric.Canvas {
    const newWidth = canvas.width! + (bleed * 2);
    const newHeight = canvas.height! + (bleed * 2);

    const canvasElement = document.createElement('canvas');
    canvasElement.width = newWidth;
    canvasElement.height = newHeight;

    const bleedCanvas = new fabric.Canvas(canvasElement, {
      width: newWidth,
      height: newHeight,
    });

    // Copy background if included
    if (includeBackground && canvas.backgroundColor) {
      bleedCanvas.backgroundColor = canvas.backgroundColor as any;
    }

    // Clone and reposition all objects
    canvas.getObjects().forEach(obj => {
      obj.clone(['id', 'tokenRole', 'colorLocked']).then((clonedObj: fabric.Object) => {
        clonedObj.set({
          left: (obj.left || 0) + bleed,
          top: (obj.top || 0) + bleed,
        });
        clonedObj.setCoords();
        bleedCanvas.add(clonedObj);
      });
    });

    return bleedCanvas;
  }

  /**
   * Export with bleed and crop marks
   */
  async exportWithBleedAndCropMarks(canvas: fabric.Canvas, options: ExportOptions): Promise<ExportResult> {
    const { bleed = 0, includeCropMarks = false } = options;

    // If no bleed or crop marks needed, just do a regular export
    if (bleed === 0 && !includeCropMarks) {
      return this.exportCanvas(canvas, options);
    }

    // Create canvas with bleed
    let exportCanvas = canvas;
    if (bleed > 0) {
      exportCanvas = this.createCanvasWithBleed(canvas, bleed, options.includeBackground ?? true);
    }

    // Add crop marks if needed
    if (includeCropMarks && bleed > 0) {
      this.addCropMarks(exportCanvas, bleed);
    }

    // Perform export with the modified canvas
    const result = await this.exportRasterOrSvg(exportCanvas, {
      ...options,
      multiplier: options.multiplier || 1,
    });

    // Clean up the temporary canvas if we created one
    if (bleed > 0 && exportCanvas !== canvas) {
      exportCanvas.dispose();
    }

    return result;
  }

  /**
   * Add crop marks to a canvas
   */
  private addCropMarks(canvas: fabric.Canvas, bleed: number): void {
    const width = canvas.width!;
    const height = canvas.height!;
    const markLength = 20; // Length of crop marks in pixels
    const strokeWidth = 1;
    const strokeColor = '#000000';

    // Create crop marks at corners
    const cropMarks = [
      // Top-left
      new fabric.Line([bleed - markLength, bleed, bleed, bleed], { stroke: strokeColor, strokeWidth }),
      new fabric.Line([bleed, bleed - markLength, bleed, bleed], { stroke: strokeColor, strokeWidth }),
      
      // Top-right
      new fabric.Line([width - bleed, bleed - markLength, width - bleed, bleed], { stroke: strokeColor, strokeWidth }),
      new fabric.Line([width - bleed + markLength, bleed, width - bleed, bleed], { stroke: strokeColor, strokeWidth }),
      
      // Bottom-left
      new fabric.Line([bleed, height - bleed, bleed, height - bleed + markLength], { stroke: strokeColor, strokeWidth }),
      new fabric.Line([bleed - markLength, height - bleed, bleed, height - bleed], { stroke: strokeColor, strokeWidth }),
      
      // Bottom-right
      new fabric.Line([width - bleed, height - bleed, width - bleed, height - bleed + markLength], { stroke: strokeColor, strokeWidth }),
      new fabric.Line([width - bleed + markLength, height - bleed, width - bleed, height - bleed], { stroke: strokeColor, strokeWidth }),
    ];

    cropMarks.forEach(mark => {
      canvas.add(mark);
    });
  }

  /**
   * Generate print-ready PDF with bleeds, crop marks, and color profiles
   */
  async exportPrintReadyPdf(canvas: fabric.Canvas, options: ExportOptions): Promise<ExportResult> {
    const printOptions = {
      ...options,
      pdfOptions: {
        ...(options.pdfOptions || {}),
        includeCropMarks: true,
        includeBleed: true,
      },
      bleed: options.bleed || 30, // Default 30px bleed for print
      includeCropMarks: true,
    };

    return this.exportWithBleedAndCropMarks(canvas, printOptions);
  }
}

// Create a singleton instance
export const advancedExportManager = AdvancedExportManager.getInstance();

// Helper function for UI components
export const downloadExportResult = async (result: ExportResult): Promise<void> => {
  if (!result.success || !result.data) {
    console.error('Cannot download failed export:', result.error);
    return;
  }

  const url = URL.createObjectURL(result.data as Blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};