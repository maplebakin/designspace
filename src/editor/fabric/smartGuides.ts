
import * as fabric from 'fabric';
import { useEditorStore } from '../state/editorStore';

const SNAP_THRESHOLD = 5;
const GUIDE_COLOR = 'rgba(128, 0, 128, 0.8)'; // Purple
const GUIDE_STROKE_WIDTH = 1;

interface Point {
  x: number;
  y: number;
}

interface SnappingAnchor {
  point: Point;
  type: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
  orientation: 'vertical' | 'horizontal'; // To specify if it's a vertical or horizontal guide
}

/**
 * Initializes smart alignment guides on the Fabric.js canvas.
 * @param canvas The fabric.Canvas instance to attach the guides to.
 */
export const initSmartGuides = (canvas: fabric.Canvas) => {
  let aligningLines: fabric.Line[] = [];
  let lastSnapCoords: { x?: number; y?: number } = {};
  let currentRenderRAF: number | null = null;
  let isAltKeyDown = false; // New state variable

  const removeAlignLines = () => {
    aligningLines.forEach(line => canvas.remove(line));
    aligningLines = [];
    if (currentRenderRAF) {
      cancelAnimationFrame(currentRenderRAF);
      currentRenderRAF = null;
    }
  };

  const drawVerticalLine = (x: number) => {
    const line = new fabric.Line([x, -canvas.height, x, canvas.height * 2], {
      stroke: GUIDE_COLOR,
      strokeWidth: GUIDE_STROKE_WIDTH,
      selectable: false,
      evented: false,
    });
    aligningLines.push(line);
    canvas.add(line);
  };

  const drawHorizontalLine = (y: number) => {
    const line = new fabric.Line([-canvas.width, y, canvas.width * 2, y], {
      stroke: GUIDE_COLOR,
      strokeWidth: GUIDE_STROKE_WIDTH,
      selectable: false,
      evented: false,
    });
    aligningLines.push(line);
    canvas.add(line);
  };

  const getAnchorPoints = (object: fabric.Object): SnappingAnchor[] => {
    const points: SnappingAnchor[] = [];
    const coords = object.getCoords();
    const xs = coords.map(point => point.x);
    const ys = coords.map(point => point.y);
    if (xs.length === 0 || ys.length === 0) {
      return points;
    }
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const centerX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
    const centerY = ys.reduce((sum, value) => sum + value, 0) / ys.length;

    // Vertical lines (x-coordinates)
    points.push({ point: { x: minX, y: centerY }, type: 'left', orientation: 'vertical' });
    points.push({ point: { x: centerX, y: centerY }, type: 'center', orientation: 'vertical' });
    points.push({ point: { x: maxX, y: centerY }, type: 'right', orientation: 'vertical' });

    // Horizontal lines (y-coordinates)
    points.push({ point: { x: centerX, y: minY }, type: 'top', orientation: 'horizontal' });
    points.push({ point: { x: centerX, y: centerY }, type: 'middle', orientation: 'horizontal' });
    points.push({ point: { x: centerX, y: maxY }, type: 'bottom', orientation: 'horizontal' });

    return points;
  };

  const collectAnchors = (object: fabric.Object): SnappingAnchor[] => {
    if (object.type === 'group') {
      const groupObjects = (object as fabric.Group & { _objects?: fabric.Object[] })._objects || [];
      return groupObjects.reduce<SnappingAnchor[]>(
        (acc, child) => acc.concat(collectAnchors(child)),
        []
      );
    }
    return getAnchorPoints(object);
  };

  const onObjectMoving = (e: any) => {
    const activeObject = e?.target as fabric.Object | undefined;
    if (!activeObject) return;

    if (!useEditorStore.getState().snapEnabled) {
      removeAlignLines();
      lastSnapCoords = {};
      return;
    }

    if (isAltKeyDown) {
      removeAlignLines();
      canvas.requestRenderAll();
      lastSnapCoords = {}; // Ensure no snap is applied on mouse:up
      return;
    }

    removeAlignLines(); // This also handles cancelling currentRenderRAF
    lastSnapCoords = {}; // Reset potential snap coordinates for current move

    let minDistanceX = SNAP_THRESHOLD + 1;
    let minDistanceY = SNAP_THRESHOLD + 1;
    let snapX: number | undefined;
    let snapY: number | undefined;
    let guideLineX: number | undefined;
    let guideLineY: number | undefined;

    const activeObjectAnchors = getAnchorPoints(activeObject);
    const canvasObjects = canvas.getObjects().filter(obj => obj !== activeObject && !obj.get('isGuide') && obj.evented);
    const cellSize = 100;
    const grid = new Map<string, fabric.Object[]>();

    const addToGrid = (obj: fabric.Object) => {
      const bbox = obj.getBoundingRect();
      const minX = Math.floor(bbox.left / cellSize);
      const maxX = Math.floor((bbox.left + bbox.width) / cellSize);
      const minY = Math.floor(bbox.top / cellSize);
      const maxY = Math.floor((bbox.top + bbox.height) / cellSize);
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          const key = `${x}:${y}`;
          const bucket = grid.get(key);
          if (bucket) {
            bucket.push(obj);
          } else {
            grid.set(key, [obj]);
          }
        }
      }
    };

    canvasObjects.forEach(addToGrid);

    const activeBBox = activeObject.getBoundingRect();
    const activeMinX = Math.floor(activeBBox.left / cellSize) - 1;
    const activeMaxX = Math.floor((activeBBox.left + activeBBox.width) / cellSize) + 1;
    const activeMinY = Math.floor(activeBBox.top / cellSize) - 1;
    const activeMaxY = Math.floor((activeBBox.top + activeBBox.height) / cellSize) + 1;
    const nearbyObjects = new Set<fabric.Object>();

    for (let x = activeMinX; x <= activeMaxX; x += 1) {
      for (let y = activeMinY; y <= activeMaxY; y += 1) {
        const bucket = grid.get(`${x}:${y}`);
        if (bucket) {
          bucket.forEach(obj => nearbyObjects.add(obj));
        }
      }
    }

    nearbyObjects.forEach((obj: fabric.Object) => {
        // Performance: Bounding box check first
        const objBBox = obj.getBoundingRect();
        // Expand bbox to include snap threshold for proximity check
        const expandedActiveBBox = {
            left: activeBBox.left - SNAP_THRESHOLD,
            top: activeBBox.top - SNAP_THRESHOLD,
            right: activeBBox.left + activeBBox.width + SNAP_THRESHOLD,
            bottom: activeBBox.top + activeBBox.height + SNAP_THRESHOLD,
        };
        const expandedObjBBox = {
            left: objBBox.left - SNAP_THRESHOLD,
            top: objBBox.top - SNAP_THRESHOLD,
            right: objBBox.left + objBBox.width + SNAP_THRESHOLD,
            bottom: objBBox.top + objBBox.height + SNAP_THRESHOLD,
        };

        // If bounding boxes don't overlap within expanded threshold, skip detailed check
        if (expandedActiveBBox.left > expandedObjBBox.right ||
            expandedActiveBBox.right < expandedObjBBox.left ||
            expandedActiveBBox.top > expandedObjBBox.bottom ||
            expandedActiveBBox.bottom < expandedObjBBox.top) {
            return;
        }

      const objAnchors = collectAnchors(obj);

      activeObjectAnchors.forEach(activeAnchor => {
        objAnchors.forEach(staticAnchor => {
            // Check for vertical alignment (x-coordinates)
            if (activeAnchor.orientation === 'vertical' && staticAnchor.orientation === 'vertical') {
                const distance = Math.abs(activeAnchor.point.x - staticAnchor.point.x);
                if (distance < SNAP_THRESHOLD && distance < minDistanceX) {
                    minDistanceX = distance;
                    // Calculate where active object's left should be to align activeAnchor.x with staticAnchor.x
                    snapX = activeObject.left + (staticAnchor.point.x - activeAnchor.point.x);
                    guideLineX = staticAnchor.point.x;
                }
            }

            // Check for horizontal alignment (y-coordinates)
            if (activeAnchor.orientation === 'horizontal' && staticAnchor.orientation === 'horizontal') {
                const distance = Math.abs(activeAnchor.point.y - staticAnchor.point.y);
                if (distance < SNAP_THRESHOLD && distance < minDistanceY) {
                    minDistanceY = distance;
                    // Calculate where active object's top should be to align activeAnchor.y with staticAnchor.y
                    snapY = activeObject.top + (staticAnchor.point.y - activeAnchor.point.y);
                    guideLineY = staticAnchor.point.y;
                }
            }
        });
      });
    });

    if (snapX !== undefined) {
        lastSnapCoords.x = snapX;
        drawVerticalLine(guideLineX as number);
    }
    if (snapY !== undefined) {
        lastSnapCoords.y = snapY;
        drawHorizontalLine(guideLineY as number);
    }

    if (aligningLines.length > 0) {
      if (currentRenderRAF) {
        cancelAnimationFrame(currentRenderRAF);
      }
      currentRenderRAF = requestAnimationFrame(() => {
        canvas.requestRenderAll();
        currentRenderRAF = null;
      });
    }
  };

  const onMouseUpHandler = () => { // Named the anonymous function
    // This now correctly handles RAF cleanup within removeAlignLines
    removeAlignLines();

    if (!useEditorStore.getState().snapEnabled) {
      lastSnapCoords = {};
      return;
    }

    const activeObject = canvas.getActiveObject();
    if (activeObject && (lastSnapCoords.x !== undefined || lastSnapCoords.y !== undefined)) {
      const snapOptions: {
        left ? : number;
        top ? : number
      } = {};

      if (lastSnapCoords.x !== undefined) {
        snapOptions.left = lastSnapCoords.x;
      }
      if (lastSnapCoords.y !== undefined) {
        snapOptions.top = lastSnapCoords.y;
      }

      activeObject.set(snapOptions);
      activeObject.setCoords(); // Update object's bounding box
      canvas.requestRenderAll(); // Use requestRenderAll consistently
    }
    lastSnapCoords = {}; // Clear snap coordinates after drop
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.altKey) {
      isAltKeyDown = true;
      removeAlignLines(); // Clear guides immediately if Alt is pressed during drag
      canvas.requestRenderAll();
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if (!e.altKey) { // Only set to false if alt key is released
      isAltKeyDown = false;
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);

  canvas.on('object:moving', onObjectMoving);
  canvas.on('mouse:up', onMouseUpHandler); // Use the named handler
  canvas.on('object:modified', removeAlignLines); // Use the centralized cleanup function

  // Return a cleanup function
  return () => {
    canvas.off('object:moving', onObjectMoving);
    canvas.off('mouse:up', onMouseUpHandler);
    canvas.off('object:modified', removeAlignLines);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
  };
};
