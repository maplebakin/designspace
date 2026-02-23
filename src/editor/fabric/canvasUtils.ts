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

let safeMarginGuides: fabric.Line[] = [];
let bleedGuides: fabric.Object[] = []; // Changed to fabric.Object[]
let documentPaper: fabric.Rect | null = null;

const GUIDE_DASH_ARRAY = [6, 4];
const BLEED_STROKE_DASHED = 'rgba(239, 68, 68, 0.85)';
const BLEED_DASH_ARRAY = [4, 4];
const TRIM_LINE_COLOR = 'rgba(255, 255, 255, 0.6)'; // Crisp white for trim line

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
    // Update existing paper
    documentPaper.set({
      width,
      height,
      fill: backgroundColor,
    });
    documentPaper.setCoords();
  } else {
    // Create new paper rectangle
    documentPaper = new fabric.Rect({
      left: 0,
      top: 0,
      width,
      height,
      fill: backgroundColor,
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      hoverCursor: 'default',
      perPixelTargetFind: false,
    });

    // Set custom properties
    (documentPaper as any).excludeFromExport = true;
    (documentPaper as any).isGuide = true; // Mark as guide so it's excluded from object operations

    // Custom properties
    (documentPaper as any).isDocumentPaper = true;

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
export const resizeCanvas = (width: number, height: number): void => {
  const { canvas, saveState, setZoom, setVpt } = useEditorStore.getState();
  if (!canvas) return;

  // Store document dimensions in the canvas store
  useCanvasStore.getState().setCanvasSize(width, height);

  const hasObjects = canvas.getObjects().some((obj) => !(obj as any).isGuide);

  // Reset viewport and zoom for a clean start
  const nextVpt = [1, 0, 0, 1, 0, 0] as fabric.TMat2D;
  canvas.setZoom(1);
  canvas.setViewportTransform(nextVpt);
  setZoom(1);
  setVpt([...nextVpt]);

  // Update the document paper to reflect new dimensions
  const { canvasBackgroundColor } = useThemeStore.getState();
  const paperColor = canvasBackgroundColor || '#FAF8F5';
  updateDocumentPaper(canvas, paperColor);
  refitPageBorder(canvas);

  if (!hasObjects) {
    canvas.requestRenderAll();
    updateGuides(canvas, useEditorStore.getState().showGuides);
    saveState();
    return;
  }

  canvas.requestRenderAll();
  updateGuides(canvas, useEditorStore.getState().showGuides);
  saveState();
};

const isDesignObject = (obj: fabric.Object) => !(obj as any).isGuide;

export const resizeCanvasOnly = (width: number, height: number): void => {
  resizeCanvas(width, height);
  useEditorStore.getState().requestLayerSync();
};

export const clearAndResizeCanvas = (width: number, height: number): void => {
  const {
    canvas,
    setLayers,
    setSelectedLayerIds,
    setSelectedObjectId,
    requestLayerSync,
  } = useEditorStore.getState();
  if (!canvas) return;

  canvas.discardActiveObject();
  setLayers([]);
  setSelectedLayerIds([]);
  setSelectedObjectId(null);
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

  canvas.discardActiveObject();
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

  // Calculate document center
  const docCenterX = documentWidth / 2;
  const docCenterY = documentHeight / 2;

  // Calculate offset to center the document
  const offsetX = (viewWidth / 2) - (docCenterX * zoom);
  const offsetY = (viewHeight / 2) - (docCenterY * zoom);

  // Apply viewport transform
  const vpt: fabric.TMat2D = [zoom, 0, 0, zoom, offsetX, offsetY];
  canvas.setViewportTransform(vpt);
  canvas.setZoom(zoom);

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

  // Add padding around the canvas (48px on each side)
  const padding = 96;
  const availableWidth = containerWidth - padding;
  const availableHeight = containerHeight - padding;

  // Calculate zoom to fit the document in the viewport
  const scaleX = availableWidth / documentWidth;
  const scaleY = availableHeight / documentHeight;
  const zoom = Math.min(scaleX, scaleY, 1); // Don't zoom in past 100%

  // Use the common centering function
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
