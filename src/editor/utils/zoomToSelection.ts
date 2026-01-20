import * as fabric from 'fabric';

/**
 * Zooms the canvas to fit the selected objects with specified padding
 * @param canvas The fabric canvas instance
 * @param padding The padding around the selected objects in pixels
 */
export const zoomToSelection = (canvas: fabric.Canvas, padding: number = 50) => {
  if (!canvas) return;

  // Get selected objects
  const activeObject = canvas.getActiveObject();
  if (!activeObject) return;

  let objectsToConsider: fabric.Object[] = [];
  
  if (activeObject.type === 'activeSelection') {
    // If it's a group selection, get all objects in the selection
    objectsToConsider = (activeObject as fabric.ActiveSelection).getObjects();
  } else {
    // If it's a single object, just consider that object
    objectsToConsider = [activeObject];
  }

  if (objectsToConsider.length === 0) return;

  // Calculate the bounding box of all selected objects
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  objectsToConsider.forEach(obj => {
    const bbox = obj.getBoundingRect();
    minX = Math.min(minX, bbox.left);
    minY = Math.min(minY, bbox.top);
    maxX = Math.max(maxX, bbox.left + bbox.width);
    maxY = Math.max(maxY, bbox.top + bbox.height);
  });

  // Calculate the dimensions of the bounding box
  const bboxWidth = maxX - minX;
  const bboxHeight = maxY - minY;

  // Get canvas dimensions
  const canvasWidth = canvas.getWidth();
  const canvasHeight = canvas.getHeight();

  // Calculate the scale factor needed to fit the bounding box in the canvas with padding
  const scaleX = (canvasWidth - padding * 2) / bboxWidth;
  const scaleY = (canvasHeight - padding * 2) / bboxHeight;
  const scale = Math.min(scaleX, scaleY, 1); // Don't zoom in beyond 100%

  // Calculate the center of the bounding box
  const centerPoint = new fabric.Point(
    minX + bboxWidth / 2,
    minY + bboxHeight / 2
  );

  // Set the new zoom and position
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]); // Reset transform first
  canvas.setZoom(scale);
  
  // Calculate the offset to center the bounding box in the canvas
  const offsetX = canvasWidth / 2 - centerPoint.x * scale;
  const offsetY = canvasHeight / 2 - centerPoint.y * scale;
  
  canvas.absolutePan(new fabric.Point(offsetX, offsetY));
  
  // Request render to update the canvas
  canvas.requestRenderAll();
};