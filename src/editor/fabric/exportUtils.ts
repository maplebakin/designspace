
import * as fabric from 'fabric';
import { PDFDocument } from 'pdf-lib';
import { useEditorStore } from '../state/editorStore';

// Helper function to trigger a browser download
const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

// Helper function to toggle visibility of guide objects
const toggleGuideVisibility = (canvas: fabric.Canvas, visible: boolean) => {
  canvas.getObjects().forEach(obj => {
    if ((obj as any).excludeFromExport) { // Check for the custom property
      obj.set({ visible });
    }
  });
  canvas.renderAll(); // Re-render after changing visibility
};

/**
 * Generates a high-resolution PNG from the canvas content and triggers a download.
 * @param canvas - The fabric.Canvas instance.
 */
export const downloadPng = (canvas: fabric.Canvas) => {
  canvas.discardActiveObject();
  toggleGuideVisibility(canvas, false); // Hide guides

  const dataURL = canvas.toDataURL({
    format: 'png',
    multiplier: 2, // for high-resolution
  });
  
  const blob = dataURLToBlob(dataURL);
  triggerDownload(blob, 'design.png');

  toggleGuideVisibility(canvas, true); // Show guides again
};

// Utility to convert data URL to Blob
function dataURLToBlob(dataURL: string) {
    const arr = dataURL.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], {type:mime});
}


/**
 * Generates a JPG from the canvas content with a specified quality and triggers a download.
 * @param canvas - The fabric.Canvas instance.
 * @param quality - The quality of the JPG image (0-1).
 */
export const downloadJpg = (canvas: fabric.Canvas, quality: number) => {
    canvas.discardActiveObject();
    toggleGuideVisibility(canvas, false); // Hide guides

    const dataURL = canvas.toDataURL({
        format: 'jpeg',
        quality: quality,
        multiplier: 2,
    });

    const blob = dataURLToBlob(dataURL);
    triggerDownload(blob, 'design.jpg');

    toggleGuideVisibility(canvas, true); // Show guides again
}

/**
 * Generates an SVG from the canvas content and triggers a download.
 * @param canvas - The fabric.Canvas instance.
 */
export const downloadSvg = (canvas: fabric.Canvas) => {
    toggleGuideVisibility(canvas, false); // Hide guides

    const svg = canvas.toSVG();
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    triggerDownload(blob, 'design.svg');

    toggleGuideVisibility(canvas, true); // Show guides again
};

/**
 * Generates a print-ready PDF from the canvas content, including bleed and trim boxes.
 * @param canvas The fabric.Canvas instance.
 */
export const downloadPdf = async (canvas: fabric.Canvas) => {
    canvas.discardActiveObject();
    toggleGuideVisibility(canvas, false); // Hide guides

    const bleedPx = useEditorStore.getState().bleedPx;
    const PRINT_DPI = 300;
    const pxToPoints = (px: number) => (px / PRINT_DPI) * 72;

    const canvasWidth = canvas.getWidth();
    const canvasHeight = canvas.getHeight();
    
    // The final trim size of the document
    const trimWidth = canvasWidth - (bleedPx * 2);
    const trimHeight = canvasHeight - (bleedPx * 2);

    // Create a new PDF document
    const pdfDoc = await PDFDocument.create();

    // The full page size including bleed, in points
    const pageW_pt = pxToPoints(canvasWidth);
    const pageH_pt = pxToPoints(canvasHeight);
    const page = pdfDoc.addPage([pageW_pt, pageH_pt]);

    // Embed the canvas image
    const imgData = canvas.toDataURL({
        format: 'png',
        multiplier: PRINT_DPI / 72, // Export at 300 DPI resolution
    });
    const pngImage = await pdfDoc.embedPng(imgData);
    
    // Draw the image to fill the entire page (including bleed area)
    page.drawImage(pngImage, {
        x: 0,
        y: 0,
        width: pageW_pt,
        height: pageH_pt,
    });

    const bleed_pt = pxToPoints(bleedPx);

    // Define the PDF boxes
    // BleedBox: The full size of the page content, including bleed.
    page.setBleedBox(0, 0, pageW_pt, pageH_pt);

    // TrimBox: The final dimensions of the page after it has been trimmed.
    page.setTrimBox(
        bleed_pt, // x starts after the left bleed
        bleed_pt, // y starts after the bottom bleed
        pageW_pt - bleed_pt, // new width is total width minus right bleed
        pageH_pt - bleed_pt  // new height is total height minus top bleed
    );

    // ArtBox: The area of the page that contains the actual artwork. 
    // Often the same as the TrimBox for printables.
    page.setArtBox(
        bleed_pt, 
        bleed_pt, 
        pageW_pt - bleed_pt, 
        pageH_pt - bleed_pt
    );

    // Save the PDF and trigger download
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    triggerDownload(blob, 'design-print-ready.pdf');

    toggleGuideVisibility(canvas, true); // Show guides again
};
