import * as fabric from 'fabric';
import { jsPDF } from 'jspdf';

const getClonedViewportTransform = (canvas: fabric.Canvas): fabric.TMat2D => {
  const fallback: fabric.TMat2D = [1, 0, 0, 1, 0, 0];
  return canvas.viewportTransform
    ? ([...canvas.viewportTransform] as fabric.TMat2D)
    : fallback;
};

/**
 * Downloads the canvas as an SVG file
 */
export const downloadSvg = (canvas: fabric.Canvas, fileName: string = 'design') => {
  // Temporarily reset zoom to 100% for export
  const originalZoom = canvas.getZoom();
  const originalVpt = getClonedViewportTransform(canvas);
  
  // Reset viewport transform to 100% scale
  canvas.setZoom(1);
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  canvas.renderAll();

  // Generate SVG
  const svgString = canvas.toSVG({
    suppressPreamble: false,
    viewBox: {
      x: 0,
      y: 0,
      width: canvas.getWidth(),
      height: canvas.getHeight(),
    }
  });

  // Restore original zoom
  canvas.setZoom(originalZoom);
  canvas.setViewportTransform(originalVpt);
  canvas.renderAll();

  // Clean up the SVG string (remove internal IDs and metadata)
  const cleanedSvgString = cleanSvgString(svgString);

  // Create and download the file
  const blob = new Blob([cleanedSvgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName}.svg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Downloads the canvas as a PNG file
 */
export const downloadPng = (canvas: fabric.Canvas, fileName: string = 'design', scale: number = 1) => {
  // Temporarily reset zoom to 100% for export
  const originalZoom = canvas.getZoom();
  const originalVpt = getClonedViewportTransform(canvas);
  
  // Reset viewport transform to 100% scale
  canvas.setZoom(1);
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  canvas.renderAll();

  // Generate PNG with specified scale
  const dataUrl = canvas.toDataURL({
    format: 'png',
    multiplier: scale,
    quality: 1,
  });

  // Restore original zoom
  canvas.setZoom(originalZoom);
  canvas.setViewportTransform(originalVpt);
  canvas.renderAll();

  // Create and download the file
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${fileName}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

/**
 * Downloads the canvas as a JPEG file
 */
export const downloadJpeg = (
  canvas: fabric.Canvas,
  fileName: string = 'design',
  scale: number = 1,
  quality: number = 0.92
) => {
  // Temporarily reset zoom to 100% for export
  const originalZoom = canvas.getZoom();
  const originalVpt = getClonedViewportTransform(canvas);

  // Reset viewport transform to 100% scale
  canvas.setZoom(1);
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  canvas.renderAll();

  // Generate JPEG with specified scale
  const dataUrl = canvas.toDataURL({
    format: 'jpeg',
    multiplier: scale,
    quality,
  });

  // Restore original zoom
  canvas.setZoom(originalZoom);
  canvas.setViewportTransform(originalVpt);
  canvas.renderAll();

  // Create and download the file
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${fileName}.jpeg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

/**
 * Downloads the canvas as a PDF file
 */
export const downloadPdf = (canvas: fabric.Canvas, fileName: string = 'design') => {
  // Temporarily reset zoom to 100% for export
  const originalZoom = canvas.getZoom();
  const originalVpt = getClonedViewportTransform(canvas);

  // Reset viewport transform to 100% scale
  canvas.setZoom(1);
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  canvas.renderAll();

  const width = canvas.getWidth();
  const height = canvas.getHeight();
  const dataUrl = canvas.toDataURL({
    format: 'png',
    multiplier: 1,
    quality: 1,
  });

  // Restore original zoom
  canvas.setZoom(originalZoom);
  canvas.setViewportTransform(originalVpt);
  canvas.renderAll();

  const pdf = new jsPDF({
    orientation: width >= height ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [width, height],
  });

  pdf.addImage(dataUrl, 'PNG', 0, 0, width, height);
  pdf.save(`${fileName}.pdf`);
};

/**
 * Cleans up the SVG string by removing internal IDs and metadata
 */
const cleanSvgString = (svgString: string): string => {
  // Remove internal Fabric.js IDs and metadata
  let cleaned = svgString
    // Remove data-fabric attributes
    .replace(/data-fabric-\w+="[^"]*"/g, '')
    // Remove internal IDs
    .replace(/id="[^"]*"/g, '')
    // Remove empty attributes
    .replace(/\s*=\s*""/g, '')
    // Remove extra whitespace
    .replace(/\s+/g, ' ')
    // Remove empty groups
    .replace(/<g>\s*<\/g>/g, '');

  return cleaned.trim();
};

/**
 * Exports canvas to SVG string
 */
export const exportToSvgString = (canvas: fabric.Canvas): string => {
  // Temporarily reset zoom to 100% for export
  const originalZoom = canvas.getZoom();
  const originalVpt = getClonedViewportTransform(canvas);
  
  // Reset viewport transform to 100% scale
  canvas.setZoom(1);
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  canvas.renderAll();

  // Generate SVG
  const svgString = canvas.toSVG({
    suppressPreamble: false,
    viewBox: {
      x: 0,
      y: 0,
      width: canvas.getWidth(),
      height: canvas.getHeight(),
    }
  });

  // Restore original zoom
  canvas.setZoom(originalZoom);
  canvas.setViewportTransform(originalVpt);
  canvas.renderAll();

  // Clean up the SVG string
  return cleanSvgString(svgString);
};

/**
 * Exports canvas to PNG data URL
 */
export const exportToPngDataUrl = (canvas: fabric.Canvas, scale: number = 1): string => {
  // Temporarily reset zoom to 100% for export
  const originalZoom = canvas.getZoom();
  const originalVpt = getClonedViewportTransform(canvas);
  
  // Reset viewport transform to 100% scale
  canvas.setZoom(1);
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  canvas.renderAll();

  // Generate PNG with specified scale
  const dataUrl = canvas.toDataURL({
    format: 'png',
    multiplier: scale,
    quality: 1,
  });

  // Restore original zoom
  canvas.setZoom(originalZoom);
  canvas.setViewportTransform(originalVpt);
  canvas.renderAll();

  return dataUrl;
};
