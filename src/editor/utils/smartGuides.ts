import * as fabric from 'fabric';
import { calculateBoundingBoxDistance } from './boundingBoxCalculator';

/**
 * Draws smart distance indicators on the canvas while dragging an object
 * @param canvas The fabric canvas instance
 * @param draggedObject The object being dragged
 * @param allObjects All objects on the canvas
 * @param maxDistance Maximum distance to show guides (to avoid visual clutter)
 */
export const drawSmartDistanceIndicators = (
  canvas: fabric.Canvas,
  draggedObject: fabric.Object,
  allObjects: fabric.Object[],
  maxDistance: number = 200
) => {
  // Clear any existing guide lines
  clearSmartGuides(canvas);

  // Find the closest objects to show distance guides for
  const closestObjects: { object: fabric.Object; distance: number }[] = [];

  for (const obj of allObjects) {
    if (obj === draggedObject || (obj as any).isGuide) continue; // Skip the dragged object and guides

    const distanceInfo = calculateBoundingBoxDistance(draggedObject, obj);

    // Calculate the minimum distance between the objects
    const minDistance = Math.min(
      Math.abs(distanceInfo.dx),
      Math.abs(distanceInfo.dy),
      Math.abs(distanceInfo.gapX),
      Math.abs(distanceInfo.gapY)
    );

    if (minDistance < maxDistance) {
      closestObjects.push({ object: obj, distance: minDistance });
    }
  }

  // Sort by distance and take the closest 2
  closestObjects.sort((a, b) => a.distance - b.distance);
  const topTwo = closestObjects.slice(0, 2);

  // Draw guide lines for the top 2 closest objects
  for (const { object } of topTwo) {
    drawDistanceGuide(canvas, draggedObject, object);
  }
};

/**
 * Draws a distance guide line between two objects
 */
const drawDistanceGuide = (canvas: fabric.Canvas, obj1: fabric.Object, obj2: fabric.Object) => {
  const bbox1 = obj1.getBoundingRect();
  const bbox2 = obj2.getBoundingRect();

  // Calculate the distance info
  const distanceInfo = calculateBoundingBoxDistance(obj1, obj2);

  // Determine the direction of the gap
  let startX: number, startY: number, endX: number, endY: number;
  let labelX: number, labelY: number;
  let gapValue: number;
  // Choose the smallest gap to visualize
  if (Math.abs(distanceInfo.gapX) < Math.abs(distanceInfo.gapY) && distanceInfo.gapX > 0) {
    // Horizontal gap
    startX = bbox1.left + bbox1.width;
    startY = bbox1.top + bbox1.height / 2;
    endX = bbox2.left;
    endY = bbox2.top + bbox2.height / 2;
    labelX = startX + (endX - startX) / 2;
    labelY = startY - 10;
    gapValue = distanceInfo.gapX;
  } else if (distanceInfo.gapY > 0) {
    // Vertical gap
    startX = bbox1.left + bbox1.width / 2;
    startY = bbox1.top + bbox1.height;
    endX = bbox2.left + bbox2.width / 2;
    endY = bbox2.top;
    labelX = startX + 10;
    labelY = startY + (endY - startY) / 2;
    gapValue = distanceInfo.gapY;
  } else if (Math.abs(distanceInfo.dx) < Math.abs(distanceInfo.dy)) {
    // Horizontal center distance
    startX = bbox1.left + bbox1.width / 2;
    startY = bbox1.top + bbox1.height / 2;
    endX = bbox2.left + bbox2.width / 2;
    endY = bbox2.top + bbox2.height / 2;
    labelX = startX + (endX - startX) / 2;
    labelY = startY - 10;
    gapValue = distanceInfo.dx;
  } else {
    // Vertical center distance
    startX = bbox1.left + bbox1.width / 2;
    startY = bbox1.top + bbox1.height / 2;
    endX = bbox2.left + bbox2.width / 2;
    endY = bbox2.top + bbox2.height / 2;
    labelX = startX + 10;
    labelY = startY + (endY - startY) / 2;
    gapValue = distanceInfo.dy;
  }

  // Create the guide line
  const guideLine = new fabric.Line([startX, startY, endX, endY], {
    stroke: 'rgba(255, 105, 180, 0.7)', // Pink color
    strokeDashArray: [5, 5], // Dashed line
    selectable: false,
    evented: false,
    strokeWidth: 1,
    originX: 'center',
    originY: 'center',
  });

  // Create the distance label
  const label = new fabric.Text(`${Math.round(Math.abs(gapValue))}px`, {
    left: labelX,
    top: labelY,
    fontSize: 12,
    fill: 'rgba(255, 105, 180, 0.9)', // Pink color
    selectable: false,
    evented: false,
    originX: 'center',
    originY: 'center',
  });

  // Add the guide line and label to the canvas
  canvas.add(guideLine);
  canvas.add(label);

  // Store references to remove later
  (guideLine as any).isSmartGuide = true;
  (label as any).isSmartGuide = true;
};

/**
 * Clears all smart guide lines and labels from the canvas
 */
export const clearSmartGuides = (canvas: fabric.Canvas) => {
  const objectsToRemove: fabric.Object[] = [];
  
  canvas.getObjects().forEach(obj => {
    if ((obj as any).isSmartGuide) {
      objectsToRemove.push(obj);
    }
  });

  objectsToRemove.forEach(obj => {
    canvas.remove(obj);
  });
};
