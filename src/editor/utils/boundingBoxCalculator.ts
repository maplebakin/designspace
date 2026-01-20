import * as fabric from 'fabric';

/**
 * Calculates the distance between two objects' bounding boxes
 * @param obj1 First fabric object
 * @param obj2 Second fabric object
 * @returns An object containing dx, dy, gapX, gapY distances
 */
export const calculateBoundingBoxDistance = (obj1: fabric.Object, obj2: fabric.Object) => {
  if (!obj1 || !obj2) {
    return { dx: 0, dy: 0, gapX: 0, gapY: 0 };
  }

  // Get bounding rectangles for both objects
  const bbox1 = obj1.getBoundingRect();
  const bbox2 = obj2.getBoundingRect();

  // Calculate centers
  const center1X = bbox1.left + bbox1.width / 2;
  const center2X = bbox2.left + bbox2.width / 2;
  const center1Y = bbox1.top + bbox1.height / 2;
  const center2Y = bbox2.top + bbox2.height / 2;

  // Calculate distances between centers
  const dx = center2X - center1X;
  const dy = center2Y - center1Y;

  // Calculate gaps (minimum distances between edges)
  const gapX = Math.max(
    0,
    Math.max(bbox1.left, bbox2.left) - Math.min(bbox1.left + bbox1.width, bbox2.left + bbox2.width)
  );
  
  const gapY = Math.max(
    0,
    Math.max(bbox1.top, bbox2.top) - Math.min(bbox1.top + bbox1.height, bbox2.top + bbox2.height)
  );

  return { dx, dy, gapX, gapY };
};