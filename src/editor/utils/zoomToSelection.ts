import * as fabric from 'fabric';
import { useEditorStore } from '../state/editorStore';
import { isActiveSelection } from './typeGuards';

/**
 * Zooms the canvas to fit the selected objects with specified padding.
 * Centers the selected objects in the viewport.
 * @param canvas The fabric canvas instance
 * @param padding The padding around the selected objects in pixels
 */
export const zoomToSelection = (canvas: fabric.Canvas, padding: number = 50) => {
  if (!canvas) return;

  // Get selected objects
  const activeObject = canvas.getActiveObject();
  if (!activeObject) return;

  let objectsToConsider: fabric.Object[] = [];

  if (isActiveSelection(activeObject)) {
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

  // Prevent division by zero for zero-size selections
  if (bboxWidth <= 0 || bboxHeight <= 0) return;

  // Get viewport dimensions (canvas element size)
  const viewWidth = canvas.getWidth();
  const viewHeight = canvas.getHeight();

  // Calculate the scale factor needed to fit the bounding box in the viewport with padding
  const scaleX = (viewWidth - padding * 2) / bboxWidth;
  const scaleY = (viewHeight - padding * 2) / bboxHeight;
  const zoom = Math.min(scaleX, scaleY, 1); // Don't zoom in beyond 100%

  // Calculate the center of the bounding box
  const selectionCenterX = minX + bboxWidth / 2;
  const selectionCenterY = minY + bboxHeight / 2;

  // Calculate the offset to center the selection in the viewport
  const offsetX = (viewWidth / 2) - (selectionCenterX * zoom);
  const offsetY = (viewHeight / 2) - (selectionCenterY * zoom);

  // Apply viewport transform
  const vpt: fabric.TMat2D = [zoom, 0, 0, zoom, offsetX, offsetY];
  canvas.setViewportTransform(vpt);

  // Update store state to keep UI in sync
  const { setZoom, setVpt } = useEditorStore.getState();
  setZoom(zoom);
  setVpt([...vpt]);

  // Request render to update the canvas
  canvas.requestRenderAll();
};
