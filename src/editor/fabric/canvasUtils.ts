
import * as fabric from 'fabric';
import { useEditorStore } from '../state/editorStore';
import { SAFE_MARGIN_PX } from '../utils/units';

let safeMarginGuides: fabric.Line[] = [];
let bleedGuides: fabric.Object[] = []; // Changed to fabric.Object[]

const GUIDE_DASH_ARRAY = [6, 4];
const BLEED_STROKE_DASHED = 'rgba(239, 68, 68, 0.85)';
const BLEED_DASH_ARRAY = [4, 4];
const TRIM_LINE_COLOR = 'rgba(255, 255, 255, 0.6)'; // Crisp white for trim line

export const clearSafeMarginGuides = (canvas: fabric.Canvas) => {
  if (!canvas) return;
  safeMarginGuides.forEach((guide) => {
    canvas.remove(guide);
  });
  safeMarginGuides = [];
};

export const addSafeMarginGuides = (canvas: fabric.Canvas) => {
  if (!canvas) return;
  clearSafeMarginGuides(canvas);

  const width = canvas.getWidth();
  const height = canvas.getHeight();
  const margin = SAFE_MARGIN_PX;

  const guideOptions = {
    stroke: 'rgba(0, 255, 255, 0.7)', // Soft cyan glow
    strokeWidth: 1,
    strokeDashArray: GUIDE_DASH_ARRAY,
    selectable: false,
    evented: false,
    hasControls: false,
    hasBorders: false,
    hoverCursor: 'default',
    perPixelTargetFind: false,
    excludeFromExport: true,
  };

  const top = new fabric.Line([margin, margin, width - margin, margin], guideOptions);
  const bottom = new fabric.Line([margin, height - margin, width - margin, height - margin], guideOptions);
  const left = new fabric.Line([margin, margin, margin, height - margin], guideOptions);
  const right = new fabric.Line([width - margin, margin, width - margin, height - margin], guideOptions);

  const guides = [top, bottom, left, right].map((line) => {
    line.set('isGuide', true);
    canvas.add(line);
    const sendToBack = (canvas as any).sendToBack;
    if (typeof sendToBack === 'function') {
      sendToBack.call(canvas, line);
    }
    return line;
  });

  safeMarginGuides = guides;
  canvas.requestRenderAll();
};

export const clearBleedGuides = (canvas: fabric.Canvas) => {
  if (!canvas) return;
  bleedGuides.forEach((guide) => {
    canvas.remove(guide);
  });
  bleedGuides = [];
};

export const renderBleedGuides = (canvas: fabric.Canvas, bleed: number) => {
  if (!canvas || bleed === undefined || bleed === null) return; // Handle bleed being 0, undefined or null
  clearBleedGuides(canvas);

  const width = canvas.getWidth();
  const height = canvas.getHeight();

  // 1. Bleed Visualization (Grey Zone)
  // Create a transparent rect that covers the entire canvas for the bleed zone visual
  const bleedZoneRect = new fabric.Rect({
    left: 0,
    top: 0,
    width: width,
    height: height,
    fill: 'rgba(204, 204, 204, 0.1)', // Light grey with alpha 0.1
    selectable: false,
    evented: false,
    hasControls: false,
    hasBorders: false,
    hoverCursor: 'default',
    perPixelTargetFind: false,
    excludeFromExport: true,
    isBleedZone: true, // Custom property for identification
  });
  bleedGuides.push(bleedZoneRect);
  canvas.add(bleedZoneRect);
  const sendToBack = (canvas as any).sendToBack;
  if (typeof sendToBack === 'function') {
    sendToBack.call(canvas, bleedZoneRect);
  }

  // 2. Trim Line Clarity (Crisp 1px solid line at the actual Canvas Edge)
  const trimLineOptions = {
    stroke: TRIM_LINE_COLOR,
    strokeWidth: 1,
    selectable: false,
    evented: false,
    hasControls: false,
    hasBorders: false,
    hoverCursor: 'default',
    perPixelTargetFind: false,
    excludeFromExport: true,
    isTrimLine: true, // Custom property for identification
  };

  const createTrimLine = (points: [number, number, number, number]) => {
    const line = new fabric.Line(points, trimLineOptions);
    line.set('isGuide', true); // Also mark as guide for general exclusion
    canvas.add(line);
    const bringToFront = (canvas as any).bringToFront;
    if (typeof bringToFront === 'function') {
      bringToFront.call(canvas, line);
    }
    return line;
  };

  const trimTop = createTrimLine([0, 0, width, 0]);
  const trimBottom = createTrimLine([0, height, width, height]);
  const trimLeft = createTrimLine([0, 0, 0, height]);
  const trimRight = createTrimLine([width, 0, width, height]);
  bleedGuides.push(trimTop, trimBottom, trimLeft, trimRight);


  // Existing dashed bleed lines (now visually representing the "cut beyond this" area)
  const bleedLineOptions = {
    stroke: BLEED_STROKE_DASHED,
    strokeWidth: 1,
    strokeDashArray: BLEED_DASH_ARRAY,
    selectable: false,
    evented: false,
    hasControls: false,
    hasBorders: false,
    hoverCursor: 'default',
    perPixelTargetFind: false,
    excludeFromExport: true,
  };

  const createBleedLine = (points: [number, number, number, number]) => {
    const line = new fabric.Line(points, bleedLineOptions);
    line.set('isGuide', true);
    canvas.add(line);
    const bringToFront = (canvas as any).bringToFront;
    if (typeof bringToFront === 'function') {
      bringToFront.call(canvas, line);
    }
    return line;
  };

  const topDashed = createBleedLine([bleed, bleed, width - bleed, bleed]);
  const bottomDashed = createBleedLine([bleed, height - bleed, width - bleed, height - bleed]);
  const leftDashed = createBleedLine([bleed, bleed, bleed, height - bleed]);
  const rightDashed = createBleedLine([width - bleed, bleed, width - bleed, height - bleed]);

  bleedGuides.push(topDashed, bottomDashed, leftDashed, rightDashed);
  canvas.requestRenderAll();
};

export const resizeCanvas = (width: number, height: number) => {
  const { canvas, saveState } = useEditorStore.getState();
  if (!canvas) return;

  const currentCenter = canvas.getCenter();

  // Set new dimensions
  canvas.setWidth(width);
  canvas.setHeight(height);

  // Pan the viewport to re-center the content
  const newCenter = canvas.getCenter();
  const panX = newCenter.left - currentCenter.left;
  const panY = newCenter.top - currentCenter.top;

  canvas.relativePan(new fabric.Point(panX, panY));

  canvas.requestRenderAll();
  saveState();
};

export const resizeCanvasToFitContent = () => {
  const { canvas, saveState } = useEditorStore.getState();
  if (!canvas) return;

  const allObjects = canvas.getObjects();
  if (allObjects.length === 0) {
    alert('Canvas is empty. No design to fit.');
    return;
  }

  // Temporarily create a group of all objects to get their combined bounding box
  const tempGroup = new fabric.Group(allObjects, { objectCaching: false });
  canvas.add(tempGroup); // Must be added to canvas to calculate bounding box correctly

  const bbox = tempGroup.getBoundingRect(); // `true` for includeTransform

  // Remove the temporary group, but not the individual objects
  canvas.remove(tempGroup);

  const padding = 50;
  const newWidth = bbox.width + padding * 2;
  const newHeight = bbox.height + padding * 2;

  // Calculate how much to shift objects to center them in the new canvas
  // The bbox.left and bbox.top are relative to the current canvas origin
  const offsetX = padding - bbox.left;
  const offsetY = padding - bbox.top;

  // Update canvas dimensions
  canvas.setWidth(newWidth);
  canvas.setHeight(newHeight);

  // Reposition all objects by applying the offset
  allObjects.forEach((obj: fabric.Object) => {
    obj.set({
      left: obj.left + offsetX,
      top: obj.top + offsetY,
    });
    obj.setCoords(); // Update controls and bounding box of the object
  });

  canvas.renderAll();
  saveState();
};

export const updateGuides = (canvas: fabric.Canvas, show: boolean) => {
    if (!canvas) return;

    if (show) {
        const { bleedPx } = useEditorStore.getState();
        addSafeMarginGuides(canvas);
        renderBleedGuides(canvas, bleedPx);
    } else {
        clearSafeMarginGuides(canvas);
        clearBleedGuides(canvas);
    }
    canvas.requestRenderAll();
}
