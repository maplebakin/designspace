import * as fabric from 'fabric';
import { useEditorStore } from '../state/editorStore';
import { useCanvasStore } from '../state/useCanvasStore';
import { CanvasLayer, assignZIndex, enforceZOrder } from './zIndexManifest';
import { guideRegistry } from './guideRegistry';

const SNAP_THRESHOLD = 8;
const GUIDE_COLOR = '#a855f7'; // Purple for visibility
const GUIDE_STROKE_WIDTH = 1;
const GRID_SPACING = 75; // 1/4 inch at 300 DPI - matches visual grid

interface Point {
  x: number;
  y: number;
}

interface SnappingAnchor {
  point: Point;
  type: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'grid';
  orientation: 'vertical' | 'horizontal';
}

interface SmartGuidesOptions {
  snapEnabled: boolean;
  gridEnabled: boolean;
}

export const initSmartGuides = (canvas: fabric.Canvas, _options: SmartGuidesOptions) => {
  let aligningLines: fabric.Line[] = [];
  let lastSnapDelta: { x: number; y: number } = { x: 0, y: 0 };
  let currentRenderRAF: number | null = null;
  let isAltKeyDown = false;

  const getDocumentBounds = () => {
    const { width: docWidth, height: docHeight } = useCanvasStore.getState();
    const documentPaper = canvas.getObjects().find((obj) => (obj as any).isDocumentPaper) as fabric.Object | undefined;
    if (!documentPaper) {
      return { left: 0, top: 0, width: docWidth, height: docHeight };
    }

    documentPaper.setCoords();
    const bounds = documentPaper.getBoundingRect();
    return {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width || docWidth,
      height: bounds.height || docHeight,
    };
  };

  const removeAlignLines = () => {
    aligningLines.forEach(line => {
      guideRegistry.unregister(line);
      canvas.remove(line);
    });
    aligningLines = [];
    if (currentRenderRAF) {
      cancelAnimationFrame(currentRenderRAF);
      currentRenderRAF = null;
    }
  };

  const drawVerticalLine = (x: number) => {
    const { top: docTop, height: docHeight } = getDocumentBounds();
    const line = new fabric.Line([x, docTop - docHeight, x, docTop + docHeight * 2], {
      stroke: GUIDE_COLOR,
      strokeWidth: GUIDE_STROKE_WIDTH,
      selectable: false,
      evented: false,
    });
    (line as any).isGuide = true;
    guideRegistry.register(line, 'smart-guide');
    assignZIndex(line, CanvasLayer.SMART_GUIDES);
    aligningLines.push(line);
    canvas.add(line);
  };

  const drawHorizontalLine = (y: number) => {
    const { left: docLeft, width: docWidth } = getDocumentBounds();
    const line = new fabric.Line([docLeft - docWidth, y, docLeft + docWidth * 2, y], {
      stroke: GUIDE_COLOR,
      strokeWidth: GUIDE_STROKE_WIDTH,
      selectable: false,
      evented: false,
    });
    (line as any).isGuide = true;
    guideRegistry.register(line, 'smart-guide');
    assignZIndex(line, CanvasLayer.SMART_GUIDES);
    aligningLines.push(line);
    canvas.add(line);
  };
  
  const drawGrid = () => {
    const ctx = canvas.contextTop;
    if (!ctx) return;

    // Always clear contextTop first to sync with zoom/pan
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const { gridEnabled } = useEditorStore.getState();
    if (!gridEnabled) return;

    const { left: docLeft, top: docTop, width: docWidth, height: docHeight } = getDocumentBounds();

    // Print-friendly grid: 1/4 inch (75px at 300 DPI)
    const spacing = GRID_SPACING;
    const gridColor = 'rgba(0, 0, 0, 0.1)'; // Black grid over the visible canvas

    ctx.save();
    const vpt = canvas.viewportTransform;
    if (vpt) {
        ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
    }

    // Clip to document area only
    ctx.beginPath();
    ctx.rect(docLeft, docTop, docWidth, docHeight);
    ctx.clip();

    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3; // Make grid more subtle

    // Draw vertical lines
    for (let x = docLeft; x <= docLeft + docWidth; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(x, docTop);
        ctx.lineTo(x, docTop + docHeight);
        ctx.stroke();
    }

    // Draw horizontal lines
    for (let y = docTop; y <= docTop + docHeight; y += spacing) {
        ctx.beginPath();
        ctx.moveTo(docLeft, y);
        ctx.lineTo(docLeft + docWidth, y);
        ctx.stroke();
    }

    ctx.restore();
  };

  const getAnchorPoints = (object: fabric.Object): SnappingAnchor[] => {
    const points: SnappingAnchor[] = [];
    object.setCoords(); // Ensure coords are up to date
    
    const aCoords = object.aCoords;
    if (!aCoords) return points;

    const { tl, tr, bl, br } = aCoords;
    const centerX = (tl.x + tr.x) / 2;
    const centerY = (tl.y + bl.y) / 2;

    points.push({ point: { x: (tl.x + bl.x) / 2, y: centerY }, type: 'left', orientation: 'vertical' });
    points.push({ point: { x: centerX, y: centerY }, type: 'center', orientation: 'vertical' });
    points.push({ point: { x: (tr.x + br.x) / 2, y: centerY }, type: 'right', orientation: 'vertical' });

    points.push({ point: { x: centerX, y: (tl.y + tr.y) / 2 }, type: 'top', orientation: 'horizontal' });
    points.push({ point: { x: centerX, y: centerY }, type: 'middle', orientation: 'horizontal' });
    points.push({ point: { x: centerX, y: (bl.y + br.y) / 2 }, type: 'bottom', orientation: 'horizontal' });

    return points;
  };

  const collectAnchors = (object: fabric.Object): SnappingAnchor[] => {
    if (object.type === 'group') {
      const groupObjects = (object as fabric.Group)._objects || [];
      return groupObjects.reduce<SnappingAnchor[]>(
        (acc, child) => {
            const childAnchors = getAnchorPoints(child);
            const groupMatrix = object.calcTransformMatrix();
            const transformedAnchors = childAnchors.map(anchor => ({
                ...anchor,
                point: fabric.util.transformPoint(anchor.point, groupMatrix)
            }));
            return acc.concat(transformedAnchors);
        },
        []
      );
    }
    return getAnchorPoints(object);
  };

  const onObjectMoving = (e: any) => {
    const activeObject = e.target as fabric.Object | undefined;
    if (!activeObject) return;
    if (!useEditorStore.getState().snapEnabled) {
      removeAlignLines();
      lastSnapDelta = { x: 0, y: 0 };
      return;
    }

    if (isAltKeyDown) {
      removeAlignLines();
      canvas.requestRenderAll();
      lastSnapDelta = { x: 0, y: 0 };
      return;
    }

    removeAlignLines();
    lastSnapDelta = { x: 0, y: 0 };

    let minDistanceX = SNAP_THRESHOLD + 1;
    let minDistanceY = SNAP_THRESHOLD + 1;
    let deltaX = 0;
    let deltaY = 0;
    let guideLineX: number | undefined;
    let guideLineY: number | undefined;

    const activeObjectAnchors = getAnchorPoints(activeObject);
    const canvasObjects = canvas
      .getObjects()
      .filter((obj) => obj !== activeObject && !obj.get('isGuide') && obj.evented);

    const bucketSize = SNAP_THRESHOLD * 2;
    const verticalBuckets = new Map<number, SnappingAnchor[]>();
    const horizontalBuckets = new Map<number, SnappingAnchor[]>();

    const addAnchorToBucket = (anchor: SnappingAnchor) => {
      const key =
        anchor.orientation === 'vertical'
          ? Math.round(anchor.point.x / bucketSize)
          : Math.round(anchor.point.y / bucketSize);
      const targetMap = anchor.orientation === 'vertical' ? verticalBuckets : horizontalBuckets;
      const existing = targetMap.get(key);
      if (existing) {
        existing.push(anchor);
      } else {
        targetMap.set(key, [anchor]);
      }
    };

    const { left: docLeft, top: docTop, width: docWidth, height: docHeight } = getDocumentBounds();
    const docRight = docLeft + docWidth;
    const docBottom = docTop + docHeight;
    const docCenterX = docLeft + docWidth / 2;
    const docCenterY = docTop + docHeight / 2;

    addAnchorToBucket({ point: { x: docLeft, y: docCenterY }, type: 'left', orientation: 'vertical' });
    addAnchorToBucket({ point: { x: docCenterX, y: docCenterY }, type: 'center', orientation: 'vertical' });
    addAnchorToBucket({ point: { x: docRight, y: docCenterY }, type: 'right', orientation: 'vertical' });
    addAnchorToBucket({ point: { x: docCenterX, y: docTop }, type: 'top', orientation: 'horizontal' });
    addAnchorToBucket({ point: { x: docCenterX, y: docCenterY }, type: 'middle', orientation: 'horizontal' });
    addAnchorToBucket({ point: { x: docCenterX, y: docBottom }, type: 'bottom', orientation: 'horizontal' });

    if (useEditorStore.getState().gridEnabled) {
      // Use document bounds and matching grid spacing
      for (let x = docLeft; x <= docRight; x += GRID_SPACING) {
        addAnchorToBucket({ point: { x, y: docTop }, type: 'grid', orientation: 'vertical' });
      }
      for (let y = docTop; y <= docBottom; y += GRID_SPACING) {
        addAnchorToBucket({ point: { x: docLeft, y }, type: 'grid', orientation: 'horizontal' });
      }
    }

    canvasObjects.forEach((obj) => {
      collectAnchors(obj).forEach(addAnchorToBucket);
    });

    const getCandidateAnchors = (orientation: 'vertical' | 'horizontal', key: number) => {
      const buckets = orientation === 'vertical' ? verticalBuckets : horizontalBuckets;
      const candidates: SnappingAnchor[] = [];
      for (let offset = -1; offset <= 1; offset += 1) {
        const bucket = buckets.get(key + offset);
        if (bucket) {
          candidates.push(...bucket);
        }
      }
      return candidates;
    };

    activeObjectAnchors.forEach((activeAnchor) => {
      const key =
        activeAnchor.orientation === 'vertical'
          ? Math.round(activeAnchor.point.x / bucketSize)
          : Math.round(activeAnchor.point.y / bucketSize);
      const candidates = getCandidateAnchors(activeAnchor.orientation, key);
      candidates.forEach((staticAnchor) => {
        if (activeAnchor.orientation === 'vertical' && staticAnchor.orientation === 'vertical') {
          const distance = Math.abs(activeAnchor.point.x - staticAnchor.point.x);
          if (distance < SNAP_THRESHOLD && distance < minDistanceX) {
            minDistanceX = distance;
            deltaX = staticAnchor.point.x - activeAnchor.point.x;
            guideLineX = staticAnchor.point.x;
          }
        }

        if (activeAnchor.orientation === 'horizontal' && staticAnchor.orientation === 'horizontal') {
          const distance = Math.abs(activeAnchor.point.y - staticAnchor.point.y);
          if (distance < SNAP_THRESHOLD && distance < minDistanceY) {
            minDistanceY = distance;
            deltaY = staticAnchor.point.y - activeAnchor.point.y;
            guideLineY = staticAnchor.point.y;
          }
        }
      });
    });

    if (deltaX !== 0) {
        lastSnapDelta.x = deltaX;
        if(minDistanceX <= SNAP_THRESHOLD) drawVerticalLine(guideLineX as number);
    }
    if (deltaY !== 0) {
        lastSnapDelta.y = deltaY;
        if(minDistanceY <= SNAP_THRESHOLD) drawHorizontalLine(guideLineY as number);
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

  const onMouseUpHandler = () => {
    removeAlignLines();

    if (!useEditorStore.getState().snapEnabled) {
      lastSnapDelta = { x: 0, y: 0 };
      return;
    }

    const activeObject = canvas.getActiveObject();
    if (activeObject && (lastSnapDelta.x !== 0 || lastSnapDelta.y !== 0)) {
        activeObject.set({
            left: activeObject.left + lastSnapDelta.x,
            top: activeObject.top + lastSnapDelta.y,
        });
        activeObject.setCoords();
        canvas.requestRenderAll();
    }
    // Enforce z-order after snapping or when releasing an object
    enforceZOrder(canvas);
    lastSnapDelta = { x: 0, y: 0 };
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.altKey) {
      isAltKeyDown = true;
      removeAlignLines();
      canvas.requestRenderAll();
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if (!e.altKey) {
      isAltKeyDown = false;
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);

  canvas.on('object:moving', onObjectMoving);
  canvas.on('mouse:up', onMouseUpHandler);
  canvas.on('object:modified', removeAlignLines);
  
  const afterRenderHandler = () => {
    drawGrid();
    // Only enforce z-order when needed to avoid performance issues
    // The z-order is also enforced in other places like onMouseUpHandler
  };

  canvas.on('after:render', afterRenderHandler);

  return () => {
    canvas.off('object:moving', onObjectMoving);
    canvas.off('mouse:up', onMouseUpHandler);
    canvas.off('object:modified', removeAlignLines);
    canvas.off('after:render', afterRenderHandler);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
  };
};
