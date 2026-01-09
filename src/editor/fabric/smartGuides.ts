import * as fabric from 'fabric';
import { inToPx } from '../utils/units';

const SNAP_THRESHOLD = 5;
const GUIDE_COLOR = 'rgba(128, 0, 128, 0.8)'; // Purple
const GUIDE_STROKE_WIDTH = 1;
const GRID_COLOR = 'rgba(128, 128, 128, 0.5)';
const GRID_STROKE_WIDTH = 0.5;

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

export const initSmartGuides = (canvas: fabric.Canvas, options: SmartGuidesOptions) => {
  let aligningLines: fabric.Line[] = [];
  let lastSnapDelta: { x: number; y: number } = { x: 0, y: 0 };
  let currentRenderRAF: number | null = null;
  let isAltKeyDown = false;

  const removeAlignLines = () => {
    aligningLines.forEach(line => canvas.remove(line));
    aligningLines = [];
    if (currentRenderRAF) {
      cancelAnimationFrame(currentRenderRAF);
      currentRenderRAF = null;
    }
  };

  const drawVerticalLine = (x: number) => {
    const line = new fabric.Line([x, -canvas.height * 2, x, canvas.height * 2], {
      stroke: GUIDE_COLOR,
      strokeWidth: GUIDE_STROKE_WIDTH,
      selectable: false,
      evented: false,
    });
    aligningLines.push(line);
    canvas.add(line);
  };

  const drawHorizontalLine = (y: number) => {
    const line = new fabric.Line([-canvas.width * 2, y, canvas.width * 2, y], {
      stroke: GUIDE_COLOR,
      strokeWidth: GUIDE_STROKE_WIDTH,
      selectable: false,
      evented: false,
    });
    aligningLines.push(line);
    canvas.add(line);
  };
  
  const drawGrid = () => {
    if (!options.gridEnabled) {
      canvas.clearContext(canvas.contextTop);
      canvas.requestRenderAll();
      return;
    }
    
    const halfInchPx = inToPx(0.5);
    const width = canvas.getWidth();
    const height = canvas.getHeight();
    const ctx = canvas.contextTop;
    
    ctx.save();
    const vpt = canvas.viewportTransform;
    if (vpt) {
        ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
    }
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = GRID_STROKE_WIDTH;

    for (let x = 0; x < width; x += halfInchPx) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
    for (let y = 0; y < height; y += halfInchPx) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
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
        if (!options.snapEnabled) {      removeAlignLines();
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
    const canvasObjects = canvas.getObjects().filter(obj => obj !== activeObject && !obj.get('isGuide') && obj.evented);
    
    let staticAnchors: SnappingAnchor[] = [];

    if (options.gridEnabled) {
        const halfInchPx = inToPx(0.5);
        for (let x = 0; x < canvas.getWidth(); x += halfInchPx) {
            staticAnchors.push({ point: { x, y: 0 }, type: 'grid', orientation: 'vertical' });
        }
        for (let y = 0; y < canvas.getHeight(); y += halfInchPx) {
            staticAnchors.push({ point: { x: 0, y }, type: 'grid', orientation: 'horizontal' });
        }
    }
    
    canvasObjects.forEach(obj => {
        staticAnchors = staticAnchors.concat(collectAnchors(obj));
    });

    activeObjectAnchors.forEach(activeAnchor => {
      staticAnchors.forEach(staticAnchor => {
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
        if(minDistanceX > 0) drawVerticalLine(guideLineX as number);
    }
    if (deltaY !== 0) {
        lastSnapDelta.y = deltaY;
        if(minDistanceY > 0) drawHorizontalLine(guideLineY as number);
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

    if (!options.snapEnabled) {
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
  };
  
  if (options.gridEnabled) {
    canvas.on('after:render', afterRenderHandler);
  }

  return () => {
    canvas.off('object:moving', onObjectMoving);
    canvas.off('mouse:up', onMouseUpHandler);
    canvas.off('object:modified', removeAlignLines);
    canvas.off('after:render', afterRenderHandler);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
  };
};
