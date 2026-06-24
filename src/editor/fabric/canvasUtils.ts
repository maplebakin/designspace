/**
 * Canvas Utilities
 *
 * Core functions for canvas manipulation including:
 * - Document paper background management
 * - Safe margin and bleed guide rendering
 * - Canvas resizing and viewport centering
 * - Fit-to-viewport calculations
 *
 * The canvas uses a two-layer dimension model:
 * 1. **Document dimensions** (stored in useCanvasStore) - the actual design size
 * 2. **Viewport dimensions** (canvas element size) - the visible workspace area
 *
 * @module canvasUtils
 */

import * as fabric from 'fabric';
import { useEditorStore } from '../state/editorStore';
import { useCanvasStore } from '../state/useCanvasStore';
import { useThemeStore } from '../state/useThemeStore';
import { SAFE_MARGIN_PX } from '../utils/units';
import { guideRegistry } from './guideRegistry';
import { refitPageBorder } from '../services/pageBorderService';
import { CanvasLayer, assignZIndex } from './zIndexManifest';
import { isUserObject } from '../utils/objectUtils';

let safeMarginGuides: fabric.Line[] = [];
let bleedGuides: fabric.Object[] = []; // Changed to fabric.Object[]
let documentPaper: fabric.Rect | null = null;

// Rulers (CanvasRuler.tsx, RULER_SIZE=24) permanently overlay the top-left of the canvas.
// All centering calculations use this inset so the document appears visually centered
// in the ruler-excluded area rather than in the full canvas element.
export const CANVAS_RULER_INSET = 24;

const GUIDE_DASH_ARRAY = [8, 6];
const SAFE_MARGIN_STROKE = 'rgba(47, 79, 70, 0.46)';
const BLEED_STROKE_DASHED = 'rgba(178, 87, 60, 0.52)';
const BLEED_DASH_ARRAY = [4, 4];
const TRIM_LINE_COLOR = 'rgba(74, 56, 45, 0.34)';
const PAPER_EDGE_COLOR = 'rgba(74, 56, 45, 0.30)';
const PAPER_SHADOW = '0 28px 70px rgba(74, 56, 45, 0.22)';
export const FIT_VIEWPORT_PADDING = 48;

// --- DOCUMENT PAPER (Background for document area only) ---

/**
 * Clears the document paper rectangle from the canvas.
 */
export const clearDocumentPaper = (canvas: fabric.Canvas) => {
  if (!canvas || !documentPaper) return;
  guideRegistry.unregister(documentPaper);
  canvas.remove(documentPaper);
  documentPaper = null;
};

/**
 * Creates or updates the document paper rectangle.
 * This rectangle represents the document area and shows the background color.
 * Areas outside this rectangle will be transparent (showing the workspace).
 */
export const updateDocumentPaper = (canvas: fabric.Canvas, backgroundColor: string) => {
  if (!canvas) return;

  // Get document dimensions from store
  const { width, height } = useCanvasStore.getState();

  if (documentPaper) {
    // Update existing paper dimensions and color.
    // Explicitly set originX/originY: Fabric 7's default is 'center', which would place the
    // paper's center at (0,0) instead of its top-left corner, visually shifting it left by docW/2.
    documentPaper.set({
      left: 0,
      top: 0,
      originX: 'left',
      originY: 'top',
      width,
      height,
      fill: backgroundColor,
      stroke: PAPER_EDGE_COLOR,
      strokeWidth: 2,
      shadow: new fabric.Shadow(PAPER_SHADOW),
    });
    documentPaper.setCoords();
    // Re-add via canvas.add() if it was stripped from the canvas (e.g. by canvas.clear()).
    // Using sendObjectToBack on a removed object bypasses _onObjectAdded, leaving
    // documentPaper.canvas=undefined and skipping proper coord initialisation.
    if (!canvas.getObjects().includes(documentPaper)) {
      guideRegistry.register(documentPaper, 'document-paper');
      assignZIndex(documentPaper, CanvasLayer.DOCUMENT_PAPER);
      canvas.add(documentPaper);
    }
  } else {
    // Create new paper rectangle.
    // originX/originY must be 'left'/'top': Fabric 7's default is 'center', which would place
    // the paper's center at Fabric (0,0) and shift its left edge to -docW/2 visually.
    documentPaper = new fabric.Rect({
      left: 0,
      top: 0,
      originX: 'left',
      originY: 'top',
      width,
      height,
      fill: backgroundColor,
      stroke: PAPER_EDGE_COLOR,
      strokeWidth: 2,
      shadow: new fabric.Shadow(PAPER_SHADOW),
      excludeFromExport: true,
      isGuide: true,
      isDocumentPaper: true,
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      hoverCursor: 'default',
      perPixelTargetFind: false,
    });
    guideRegistry.register(documentPaper, 'document-paper');
    assignZIndex(documentPaper, CanvasLayer.DOCUMENT_PAPER);
    canvas.add(documentPaper);
  }

  // Ensure it's at the bottom
  canvas.sendObjectToBack(documentPaper);
};

export const clearSafeMarginGuides = (canvas: fabric.Canvas) => {
  if (!canvas) return;
  safeMarginGuides.forEach((guide) => {
    guideRegistry.unregister(guide); // PHASE 3.1: Unregister from guide registry
    canvas.remove(guide);
  });
  safeMarginGuides = [];
};

export const addSafeMarginGuides = (canvas: fabric.Canvas) => {
  if (!canvas) return;
  clearSafeMarginGuides(canvas);

  // Use document dimensions from store, not canvas element dimensions
  const { width, height } = useCanvasStore.getState();
  const margin = SAFE_MARGIN_PX;

  const guideOptions = {
    stroke: SAFE_MARGIN_STROKE,
    strokeWidth: 1,
    strokeDashArray: GUIDE_DASH_ARRAY,
    isGuide: true,
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
    guideRegistry.register(line, 'safe-margin'); // PHASE 3.1: Register with guide registry
    assignZIndex(line, CanvasLayer.SAFE_MARGIN_GUIDES); // Assign z-index
    canvas.add(line);
    return line;
  });

  safeMarginGuides = guides;
  canvas.requestRenderAll();
};

export const clearBleedGuides = (canvas: fabric.Canvas) => {
  if (!canvas) return;
  bleedGuides.forEach((guide) => {
    guideRegistry.unregister(guide); // PHASE 3.1: Unregister from guide registry
    canvas.remove(guide);
  });
  bleedGuides = [];
};

export const renderBleedGuides = (canvas: fabric.Canvas, bleed: number) => {
  if (!canvas || bleed === undefined || bleed === null) return; // Handle bleed being 0, undefined or null
  clearBleedGuides(canvas);

  // Use document dimensions from store, not canvas element dimensions
  const { width, height } = useCanvasStore.getState();

  // 1. Bleed Visualization (Grey Zone)
  // Create a transparent rect that covers the entire canvas for the bleed zone visual
  const bleedZoneRect = new fabric.Rect({
    left: 0,
    top: 0,
    originX: 'left',
    originY: 'top',
    width: width,
    height: height,
    fill: 'rgba(178, 87, 60, 0.035)',
    selectable: false,
    evented: false,
    hasControls: false,
    hasBorders: false,
    hoverCursor: 'default',
    perPixelTargetFind: false,
    excludeFromExport: true,
    isBleedZone: true,
  });
  guideRegistry.register(bleedZoneRect, 'bleed-zone'); // PHASE 3.1: Register with guide registry
  assignZIndex(bleedZoneRect, CanvasLayer.BLEED_ZONE); // Assign z-index
  bleedGuides.push(bleedZoneRect);
  canvas.add(bleedZoneRect);

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
    guideRegistry.register(line, 'trim'); // PHASE 3.1: Register with guide registry
    assignZIndex(line, CanvasLayer.TRIM_LINE); // Assign z-index
    canvas.add(line);
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
    guideRegistry.register(line, 'bleed'); // PHASE 3.1: Register with guide registry
    assignZIndex(line, CanvasLayer.BLEED_GUIDES); // Assign z-index
    canvas.add(line);
    return line;
  };

  const topDashed = createBleedLine([bleed, bleed, width - bleed, bleed]);
  const bottomDashed = createBleedLine([bleed, height - bleed, width - bleed, height - bleed]);
  const leftDashed = createBleedLine([bleed, bleed, bleed, height - bleed]);
  const rightDashed = createBleedLine([width - bleed, bleed, width - bleed, height - bleed]);

  bleedGuides.push(topDashed, bottomDashed, leftDashed, rightDashed);
  canvas.requestRenderAll();
};

/**
 * Resizes the canvas document to new dimensions.
 *
 * This updates the logical document size (not the viewport element size).
 * Objects remain at their current positions. Use this when changing
 * the design size (e.g., switching from Letter to A4).
 *
 * @param width - New document width in pixels
 * @param height - New document height in pixels
 *
 * @example
 * ```ts
 * // Resize to US Letter at 300 DPI
 * resizeCanvas(2550, 3300);
 *
 * // Resize to A4 at 300 DPI
 * resizeCanvas(2480, 3508);
 * ```
 */
export const resizeCanvas = (
  width: number,
  height: number,
  options: { save?: boolean; skipRender?: boolean; resetViewport?: boolean } = {}
): void => {
  const { canvas, saveState, setZoom, setVpt } = useEditorStore.getState();
  if (!canvas) return;

  // Store document dimensions in the canvas store
  useCanvasStore.getState().setCanvasSize(width, height);

  const hasObjects = canvas.getObjects().some(isUserObject);

  if (options.resetViewport !== false) {
    // Reset viewport and zoom for a clean start when changing the active document size.
    const nextVpt = [1, 0, 0, 1, 0, 0] as fabric.TMat2D;
    canvas.setZoom(1);
    canvas.setViewportTransform(nextVpt);
    setZoom(1);
    setVpt([...nextVpt]);
  } else if (canvas.viewportTransform) {
    setZoom(canvas.getZoom());
    setVpt([...canvas.viewportTransform]);
  }

  // Update the document paper to reflect new dimensions
  const { canvasBackgroundColor } = useThemeStore.getState();
  const paperColor = canvasBackgroundColor || '#FAF8F5';
  updateDocumentPaper(canvas, paperColor);
  refitPageBorder(canvas);

  if (!hasObjects) {
    if (!options.skipRender) canvas.requestRenderAll();
    updateGuides(canvas, useEditorStore.getState().showGuides);
    if (options.save !== false) {
      saveState();
    }
    return;
  }

  if (!options.skipRender) canvas.requestRenderAll();
  updateGuides(canvas, useEditorStore.getState().showGuides);
  if (options.save !== false) {
    saveState();
  }
};

const isDesignObject = (obj: fabric.Object) => isUserObject(obj);

export const resizeCanvasOnly = (width: number, height: number): void => {
  resizeCanvas(width, height);
  useEditorStore.getState().requestLayerSync();
};

export const clearAndResizeCanvas = (width: number, height: number): void => {
  const {
    canvas,
    setLayers,
    clearSelection,
    requestLayerSync,
  } = useEditorStore.getState();
  if (!canvas) return;

  clearSelection();
  setLayers([]);
  canvas.clear();
  requestLayerSync();
  resizeCanvas(width, height);
};

export const resizeCanvasAndScaleContent = (width: number, height: number): void => {
  const { canvas } = useEditorStore.getState();
  if (!canvas) return;

  const { width: currentWidth, height: currentHeight } = useCanvasStore.getState();
  if (currentWidth <= 0 || currentHeight <= 0) {
    resizeCanvasOnly(width, height);
    return;
  }

  const scaleX = width / currentWidth;
  const scaleY = height / currentHeight;

  useEditorStore.getState().clearSelection();
  canvas.getObjects().forEach((obj) => {
    if (!isDesignObject(obj)) return;
    obj.set({
      left: (obj.left ?? 0) * scaleX,
      top: (obj.top ?? 0) * scaleY,
      scaleX: (obj.scaleX ?? 1) * scaleX,
      scaleY: (obj.scaleY ?? 1) * scaleY,
    });
    obj.setCoords();
  });

  resizeCanvas(width, height);
  useEditorStore.getState().requestLayerSync();
};

/**
 * Centers the document in the viewport at the given zoom level.
 * This is the core centering logic used by both fitCanvasToViewport and zoomToCenter.
 */
export const centerDocumentInViewport = (
  canvas: fabric.Canvas,
  zoom: number,
  containerWidth?: number,
  containerHeight?: number
) => {
  const { setZoom, setVpt } = useEditorStore.getState();

  // Get document dimensions from the store
  const { width: documentWidth, height: documentHeight } = useCanvasStore.getState();

  // Use provided dimensions or get from canvas
  const viewWidth = containerWidth ?? canvas.getWidth();
  const viewHeight = containerHeight ?? canvas.getHeight();

  // Rulers permanently cover CANVAS_RULER_INSET px at the top and left of the canvas.
  // Center within the visible (ruler-excluded) area so the document appears visually
  // centered to the user, not just centered in the raw canvas element.
  const inset = CANVAS_RULER_INSET;
  const effectiveWidth = viewWidth - inset;
  const effectiveHeight = viewHeight - inset;

  const offsetX = inset + (effectiveWidth / 2) - (documentWidth / 2) * zoom;
  const offsetY = inset + (effectiveHeight / 2) - (documentHeight / 2) * zoom;

  // Apply viewport transform
  const vpt: fabric.TMat2D = [zoom, 0, 0, zoom, offsetX, offsetY];
  canvas.setViewportTransform(vpt);

  setZoom(zoom);
  setVpt([...vpt]);

  canvas.requestRenderAll();
};

/**
 * Zooms to a specific level while keeping the document centered.
 *
 * Use this for programmatic zoom controls (zoom in/out buttons, zoom slider).
 * Zoom is clamped between 5% (0.05) and 2000% (20).
 *
 * @param zoom - Target zoom level (1 = 100%)
 *
 * @example
 * ```ts
 * zoomToCenter(1);    // 100% zoom
 * zoomToCenter(0.5);  // 50% zoom
 * zoomToCenter(2);    // 200% zoom
 * ```
 */
export const zoomToCenter = (zoom: number): void => {
  const { canvas } = useEditorStore.getState();
  if (!canvas) return;

  const clampedZoom = Math.min(20, Math.max(0.05, zoom));
  centerDocumentInViewport(canvas, clampedZoom);
};

export const calculateFitCanvasZoom = ({
  containerWidth,
  containerHeight,
  documentWidth,
  documentHeight,
  rulerInset = CANVAS_RULER_INSET,
  padding = FIT_VIEWPORT_PADDING,
}: {
  containerWidth: number;
  containerHeight: number;
  documentWidth: number;
  documentHeight: number;
  rulerInset?: number;
  padding?: number;
}) => {
  const effectiveWidth = Math.max(1, containerWidth - rulerInset);
  const effectiveHeight = Math.max(1, containerHeight - rulerInset);
  const availableWidth = Math.max(1, effectiveWidth - padding);
  const availableHeight = Math.max(1, effectiveHeight - padding);
  const scaleX = availableWidth / documentWidth;
  const scaleY = availableHeight / documentHeight;
  return Math.min(scaleX, scaleY, 1);
};

/**
 * Fits the document to the available viewport with padding.
 *
 * Calculates the optimal zoom level to display the entire document
 * within the container while maintaining aspect ratio. Never zooms
 * in beyond 100% to avoid showing pixelation.
 *
 * @param containerWidth - Width of the viewport container in pixels
 * @param containerHeight - Height of the viewport container in pixels
 *
 * @example
 * ```ts
 * // Called on window resize
 * fitCanvasToViewport(window.innerWidth - sidebarWidth, window.innerHeight);
 * ```
 */
export const fitCanvasToViewport = (containerWidth: number, containerHeight: number): void => {
  const { canvas } = useEditorStore.getState();
  if (!canvas) return;

  // Get document dimensions from the store (not from canvas element)
  const { width: documentWidth, height: documentHeight } = useCanvasStore.getState();

  const zoom = calculateFitCanvasZoom({
    containerWidth,
    containerHeight,
    documentWidth,
    documentHeight,
  });

  // Use the common centering function (also applies ruler inset internally)
  centerDocumentInViewport(canvas, zoom, containerWidth, containerHeight);
};

/**
 * Rotate the canvas by swapping width and height (portrait <-> landscape)
 */
export const rotateCanvas = () => {
  const { canvas, saveState, setZoom, setVpt } = useEditorStore.getState();
  if (!canvas) return;

  // Use document dimensions from store
  const { width: currentWidth, height: currentHeight } = useCanvasStore.getState();

  // Swap dimensions
  const newWidth = currentHeight;
  const newHeight = currentWidth;

  // Update stored document dimensions
  useCanvasStore.getState().setCanvasSize(newWidth, newHeight);

  // Get all objects (excluding guides)
  const objects = canvas.getObjects().filter((obj) => !(obj as any).isGuide);

  // Reposition objects to maintain relative position
  // Calculate the center offset
  const centerOffsetX = (newWidth - currentWidth) / 2;
  const centerOffsetY = (newHeight - currentHeight) / 2;

  objects.forEach((obj) => {
    obj.set({
      left: (obj.left ?? 0) + centerOffsetX,
      top: (obj.top ?? 0) + centerOffsetY,
    });
    obj.setCoords();
  });

  // Reset viewport - fitCanvasToViewport will be called by the caller
  const nextVpt = [1, 0, 0, 1, 0, 0] as fabric.TMat2D;
  canvas.setZoom(1);
  canvas.setViewportTransform(nextVpt);
  setZoom(1);
  setVpt([...nextVpt]);

  canvas.requestRenderAll();
  updateGuides(canvas, useEditorStore.getState().showGuides);
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

  // Update stored document dimensions (canvas element size is managed by ResizeObserver)
  useCanvasStore.getState().setCanvasSize(newWidth, newHeight);

  // Reposition all objects by applying the offset
  allObjects.forEach((obj: fabric.Object) => {
    obj.set({
      left: obj.left + offsetX,
      top: obj.top + offsetY,
    });
    obj.setCoords(); // Update controls and bounding box of the object
  });

  // Update guides and center the viewport
  updateGuides(canvas, useEditorStore.getState().showGuides);
  centerDocumentInViewport(canvas, 1);

  canvas.renderAll();
  saveState();
};

import { enforceZOrder } from './zIndexManifest';

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

    // Enforce z-order after updating guides
    enforceZOrder(canvas);
    canvas.requestRenderAll();
}
