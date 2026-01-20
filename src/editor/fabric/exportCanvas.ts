import * as fabric from 'fabric';

export interface ExportOptions {
  format: 'png' | 'jpeg';
  quality?: number; // For JPEG
  multiplier: number; // For high-res export
  clipToCanvas: boolean; // Whether to clip to canvas bounds or export all
}

export const exportCanvas = async (canvas: fabric.Canvas, options: ExportOptions): Promise<Blob> => {
  const { format, quality = 1, multiplier = 1, clipToCanvas = true } = options;

  // Store original canvas properties
  const originalWidth = canvas.getWidth();
  const originalHeight = canvas.getHeight();

  // Calculate export dimensions
  let exportWidth = originalWidth;
  let exportHeight = originalHeight;
  let offsetX = 0;
  let offsetY = 0;

  if (!clipToCanvas) {
    // Calculate bounds of all objects to determine export size
    const objects = canvas.getObjects().filter(obj => !(obj as any).isGuide);
    if (objects.length > 0) {
      // Find the bounding box of all objects
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      objects.forEach(obj => {
        const objBounds = obj.getBoundingRect(); // Get bounding rectangle
        minX = Math.min(minX, objBounds.left);
        minY = Math.min(minY, objBounds.top);
        maxX = Math.max(maxX, objBounds.left + objBounds.width);
        maxY = Math.max(maxY, objBounds.top + objBounds.height);
      });

      // Add some padding around the objects
      const padding = 20;
      exportWidth = Math.ceil(maxX - minX) + padding * 2;
      exportHeight = Math.ceil(maxY - minY) + padding * 2;

      // Calculate offset to position objects correctly
      offsetX = -minX + padding;
      offsetY = -minY + padding;
    }
  }

  // Create a temporary canvas element for export
  const tempCanvasElement = document.createElement('canvas');
  const exportCanvasInstance = new fabric.Canvas(tempCanvasElement, {
    width: exportWidth * multiplier,
    height: exportHeight * multiplier,
    enableRetinaScaling: false,
  });

  // Clone all objects and add them to the export canvas
  const objects = canvas.getObjects().filter(obj => !(obj as any).isGuide);
  const clonedObjects: fabric.Object[] = [];

  for (const obj of objects) {
    // Skip guide objects
    if ((obj as any).isGuide) continue;

    // Clone the object using Fabric.js v6 async clone
    const clonedObj = await obj.clone(['id', 'tokenRole', 'colorLocked', 'isPlaceholder', 'adjustments']);

    // Adjust position based on whether we're clipping to canvas or exporting all
    if (!clipToCanvas) {
      // Position relative to the calculated bounds
      clonedObj.set({
        left: ((obj.left || 0) + offsetX) * multiplier,
        top: ((obj.top || 0) + offsetY) * multiplier,
      });
    } else {
      // Scale position to match the multiplier
      clonedObj.set({
        left: (obj.left || 0) * multiplier,
        top: (obj.top || 0) * multiplier,
      });
    }

    // Scale the object if it has scaling properties
    if (clonedObj.scaleX) clonedObj.scaleX = (clonedObj.scaleX || 1) * multiplier;
    if (clonedObj.scaleY) clonedObj.scaleY = (clonedObj.scaleY || 1) * multiplier;

    // Scale stroke width for vector objects to maintain visual appearance
    if (clonedObj.strokeWidth) {
      (clonedObj as any).strokeWidth = (clonedObj as any).strokeWidth * multiplier;
    }

    // Update coordinates
    clonedObj.setCoords();
    clonedObjects.push(clonedObj);
  }

  // Add all cloned objects to the export canvas
  exportCanvasInstance.add(...clonedObjects);

  // Set background if the original canvas has one
  if (canvas.backgroundColor) {
    exportCanvasInstance.backgroundColor = canvas.backgroundColor;
  }

  // Render all
  exportCanvasInstance.renderAll();

  // Get the data URL with the specified format and quality
  const dataUrl = exportCanvasInstance.toDataURL({
    format: format,
    quality: format === 'jpeg' ? quality : undefined,
    multiplier: 1, // We've already handled scaling manually
  });

  // Clean up the temporary canvas
  exportCanvasInstance.dispose();
  tempCanvasElement.remove();

  // Convert data URL to blob
  return new Promise<Blob>((resolve, reject) => {
    fetch(dataUrl)
      .then(res => res.blob())
      .then(blob => resolve(blob))
      .catch(err => reject(err));
  });
};

export const downloadExportedCanvas = async (canvas: fabric.Canvas, options: ExportOptions): Promise<void> => {
  const blob = await exportCanvas(canvas, options);
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `design-${Date.now()}.${options.format}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  // Clean up
  URL.revokeObjectURL(url);
};