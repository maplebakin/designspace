import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { StaticCanvas } from 'fabric/node';
import {
  AdvancedExportManager,
  calculatePdfPageSizeInches,
  calculateRasterExportScale,
} from '../src/editor/export/advancedExportManager';

const dataUrlToBlob = (dataUrl: string, mimeType: string) => {
  const encoded = dataUrl.split(',')[1] || '';
  return new Blob([Buffer.from(encoded, 'base64')], { type: mimeType });
};

const blobToBytes = (blob: Blob) => new Promise<Uint8Array>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    if (reader.result instanceof ArrayBuffer) {
      resolve(new Uint8Array(reader.result));
      return;
    }
    reject(new Error('Expected PDF Blob to produce an ArrayBuffer.'));
  };
  reader.onerror = () => reject(reader.error || new Error('Failed to read PDF Blob.'));
  reader.readAsArrayBuffer(blob);
});

describe('advanced export DPI semantics', () => {
  it('renders source pixels at target/source DPI rather than doubling 300-DPI print canvases', () => {
    expect(calculateRasterExportScale(300, 300)).toBe(1);
    expect(calculateRasterExportScale(150, 300)).toBe(0.5);

    const canvas = new StaticCanvas(null, {
      width: 300,
      height: 600,
      enableRetinaScaling: false,
    });
    try {
      const dataUrl = canvas.toDataURL({
        format: 'png',
        multiplier: calculateRasterExportScale(150, 300),
      });
      const png = Buffer.from(dataUrl.split(',')[1], 'base64');
      expect(png.readUInt32BE(16)).toBe(150);
      expect(png.readUInt32BE(20)).toBe(300);
    } finally {
      canvas.dispose();
    }
  });

  it('derives PDF MediaBox dimensions from declared source DPI', async () => {
    expect(calculatePdfPageSizeInches(2550, 3300, 300)).toEqual({
      width: 8.5,
      height: 11,
    });

    const jpegCanvas = new StaticCanvas(null, {
      width: 1,
      height: 1,
      enableRetinaScaling: false,
      backgroundColor: '#ffffff',
    });
    const jpegBlob = dataUrlToBlob(
      jpegCanvas.toDataURL({ format: 'jpeg', multiplier: 1 }),
      'image/jpeg'
    );
    jpegCanvas.dispose();

    const manager = new AdvancedExportManager();
    const renderSpy = vi.spyOn(manager as any, 'renderPageToPngBlob')
      .mockImplementation(async (_page: unknown, options: any) => {
        expect(options.sourceDpi).toBe(300);
        expect(options.dpi).toBe(150);
        return jpegBlob;
      });
    const pdfBlob = await manager.exportPagesPdfBlob([
      {
        id: 'letter-page',
        name: 'Letter',
        canvasData: { objects: [] },
        canvasSize: { width: 2550, height: 3300 },
      },
    ] as any, {
      dpi: 300,
      sourceDpi: 300,
      pdfImageDpi: 150,
      includeBackground: true,
      backgroundColor: '#ffffff',
    });

    const pdf = await PDFDocument.load(await blobToBytes(pdfBlob));
    const pageSize = pdf.getPage(0).getSize();
    expect(pageSize.width).toBeCloseTo(8.5 * 72, 4);
    expect(pageSize.height).toBeCloseTo(11 * 72, 4);
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });
});
