/**
 * Textbox Drawing Service
 *
 * Handles the draw-to-create workflow for textboxes:
 * 1. User selects the textbox tool
 * 2. User drags on canvas to define textbox bounds
 * 3. On release, textbox is created with those dimensions
 * 4. Text automatically resizes to fit the bounds
 */

import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import { useEditorStore } from '../state/editorStore';
import { useThemeStore } from '../state/useThemeStore';

// ============================================================================
// TYPES
// ============================================================================

interface TextboxDrawingState {
  isDrawing: boolean;
  startX: number;
  startY: number;
  previewRect: fabric.Rect | null;
}


// ============================================================================
// CONSTANTS
// ============================================================================

const MIN_TEXTBOX_SIZE = 50; // Minimum size in pixels
const DEFAULT_FONT_SIZE = 48;
const PREVIEW_FILL = 'rgba(99, 102, 241, 0.1)';
const PREVIEW_STROKE = 'rgba(99, 102, 241, 0.6)';

// ============================================================================
// STATE
// ============================================================================

const state: TextboxDrawingState = {
  isDrawing: false,
  startX: 0,
  startY: 0,
  previewRect: null,
};

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Gets theme font settings for textbox.
 */
function getThemeFontSettings(): { fontFamily: string; fill: string } {
  const { themeData } = useThemeStore.getState();
  return {
    fontFamily: themeData?.typography?.body?.fontFamily || 'sans-serif',
    fill: themeData?.typography?.body?.value || '#000000',
  };
}

/**
 * Converts screen coordinates to canvas coordinates.
 */
function screenToCanvas(canvas: fabric.Canvas, screenX: number, screenY: number): { x: number; y: number } {
  const vpt = canvas.viewportTransform;
  if (!vpt) return { x: screenX, y: screenY };

  const zoom = canvas.getZoom();
  return {
    x: (screenX - vpt[4]) / zoom,
    y: (screenY - vpt[5]) / zoom,
  };
}

/**
 * Creates the preview rectangle shown while drawing.
 */
function createPreviewRect(x: number, y: number): fabric.Rect {
  const rect = new fabric.Rect({
    left: x,
    top: y,
    width: 0,
    height: 0,
    fill: PREVIEW_FILL,
    stroke: PREVIEW_STROKE,
    strokeWidth: 2,
    strokeDashArray: [5, 5],
    selectable: false,
    evented: false,
    excludeFromExport: true,
  });
  (rect as any).isPreview = true;
  (rect as any).isGuide = true;
  return rect;
}

/**
 * Adjusts font size to fill the textbox bounds.
 * Uses binary search to find the optimal font size.
 */
function adjustFontSizeToFill(
  textbox: fabric.Textbox,
  targetWidth: number,
  targetHeight: number
): void {
  const minFontSize = 8;
  const maxFontSize = Math.max(minFontSize, Math.floor(targetHeight * 0.9));

  // Store original dimensions
  (textbox as any).__fixedWidth = targetWidth;
  (textbox as any).__fixedHeight = targetHeight;
  (textbox as any).originalFontSize = DEFAULT_FONT_SIZE;

  textbox.set({ width: targetWidth });

  // Binary search for optimal font size
  let low = minFontSize;
  let high = maxFontSize;
  let bestFontSize = minFontSize;

  const fits = (fontSize: number): boolean => {
    textbox.set('fontSize', fontSize);
    textbox.initDimensions();
    const textHeight = textbox.height ?? 0;
    return textHeight <= targetHeight;
  };

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) {
      bestFontSize = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  textbox.set('fontSize', bestFontSize);
  textbox.initDimensions();
}

/**
 * Creates the final textbox with the specified bounds.
 */
function createTextbox(
  canvas: fabric.Canvas,
  left: number,
  top: number,
  width: number,
  height: number
): fabric.Textbox {
  const { fontFamily, fill } = getThemeFontSettings();

  const textbox = new fabric.Textbox('', {
    left,
    top,
    width,
    fontSize: DEFAULT_FONT_SIZE,
    fill,
    fontFamily,
    textAlign: 'left',
    originX: 'left',
    originY: 'top',
    editable: true,
    lockScalingFlip: true,
  });

  // Set custom properties
  (textbox as any).id = uuidv4();
  (textbox as any).tokenRole = 'typography.body.value';
  (textbox as any).__fixedWidth = width;
  (textbox as any).__fixedHeight = height;
  (textbox as any).originalFontSize = DEFAULT_FONT_SIZE;

  // Set up scaling handler to maintain auto-fit behavior
  setupTextboxScalingHandler(textbox, canvas);

  // Set up text change handler to auto-resize font
  setupTextChangeHandler(textbox, canvas);

  return textbox;
}

/**
 * Sets up handler to adjust font size when textbox is scaled.
 */
function setupTextboxScalingHandler(textbox: fabric.Textbox, canvas: fabric.Canvas): void {
  const handleScaling = () => {
    const scaleX = Math.abs(textbox.scaleX ?? 1);
    const scaleY = Math.abs(textbox.scaleY ?? 1);

    if (scaleX === 1 && scaleY === 1) return;

    const newWidth = (textbox.width ?? 100) * scaleX;
    const newHeight = ((textbox as any).__fixedHeight ?? textbox.height ?? 100) * scaleY;

    // Reset scale and apply new dimensions
    textbox.set({
      scaleX: 1,
      scaleY: 1,
      width: newWidth,
    });

    (textbox as any).__fixedWidth = newWidth;
    (textbox as any).__fixedHeight = newHeight;

    // Re-fit text to new dimensions
    adjustFontSizeToFill(textbox, newWidth, newHeight);
    textbox.setCoords();
    canvas.requestRenderAll();
  };

  textbox.on('scaling', handleScaling);
  // Also trigger on modified to catch scale changes
  textbox.on('modified', handleScaling);
}

/**
 * Sets up handler to adjust font size when text content changes.
 */
function setupTextChangeHandler(textbox: fabric.Textbox, canvas: fabric.Canvas): void {
  const handleTextChange = () => {
    const targetWidth = (textbox as any).__fixedWidth ?? textbox.width ?? 100;
    const targetHeight = (textbox as any).__fixedHeight ?? 100;

    // Only adjust if we have fixed dimensions
    if (targetWidth && targetHeight) {
      adjustFontSizeToFill(textbox, targetWidth, targetHeight);
      canvas.requestRenderAll();
    }
  };

  textbox.on('changed', handleTextChange);
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Handles mouse down event for textbox drawing.
 */
export function handleTextboxMouseDown(
  canvas: fabric.Canvas,
  e: MouseEvent
): void {
  // Only handle left click
  if (e.button !== 0) return;

  // Get canvas coordinates from pointer position
  const rect = canvas.getElement().getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;
  const { x, y } = screenToCanvas(canvas, screenX, screenY);

  state.isDrawing = true;
  state.startX = x;
  state.startY = y;

  // Create preview rectangle
  state.previewRect = createPreviewRect(x, y);
  canvas.add(state.previewRect);
  canvas.requestRenderAll();

  // Disable selection while drawing
  canvas.selection = false;
}

/**
 * Handles mouse move event for textbox drawing.
 */
export function handleTextboxMouseMove(
  canvas: fabric.Canvas,
  e: MouseEvent
): void {
  if (!state.isDrawing || !state.previewRect) return;

  // Get canvas coordinates
  const rect = canvas.getElement().getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;
  const { x, y } = screenToCanvas(canvas, screenX, screenY);

  // Calculate dimensions (support drawing in any direction)
  const left = Math.min(state.startX, x);
  const top = Math.min(state.startY, y);
  const width = Math.abs(x - state.startX);
  const height = Math.abs(y - state.startY);

  // Update preview rectangle
  state.previewRect.set({
    left,
    top,
    width,
    height,
  });
  state.previewRect.setCoords();
  canvas.requestRenderAll();
}

/**
 * Handles mouse up event for textbox drawing.
 * Creates the final textbox and enters editing mode.
 */
export function handleTextboxMouseUp(
  canvas: fabric.Canvas,
  _e: MouseEvent,
  onComplete?: (textbox: fabric.Textbox) => void
): fabric.Textbox | null {
  if (!state.isDrawing) return null;

  // Get final dimensions from preview
  const previewRect = state.previewRect;
  if (!previewRect) {
    state.isDrawing = false;
    return null;
  }

  const left = previewRect.left ?? state.startX;
  const top = previewRect.top ?? state.startY;
  const width = previewRect.width ?? 0;
  const height = previewRect.height ?? 0;

  // Remove preview rectangle
  canvas.remove(previewRect);
  state.previewRect = null;
  state.isDrawing = false;

  // Re-enable selection
  canvas.selection = true;

  // Check minimum size
  if (width < MIN_TEXTBOX_SIZE || height < MIN_TEXTBOX_SIZE) {
    // Too small - show toast and return
    useEditorStore.getState().setToastMessage(
      'Textbox too small. Draw a larger area.'
    );
    canvas.requestRenderAll();
    return null;
  }

  // Create the textbox
  const textbox = createTextbox(canvas, left, top, width, height);

  // Add to canvas
  canvas.add(textbox);
  useEditorStore.getState().selectObjectById((textbox as any).id);

  // Enter editing mode after a brief delay (allows canvas to update)
  setTimeout(() => {
    textbox.enterEditing();
    textbox.selectAll();
    canvas.requestRenderAll();
  }, 50);

  // Switch back to select tool
  useEditorStore.getState().setActiveTool('select');

  // Save state
  useEditorStore.getState().saveState();

  // Call completion callback
  onComplete?.(textbox);

  return textbox;
}

/**
 * Cancels the current textbox drawing operation.
 */
export function cancelTextboxDrawing(canvas: fabric.Canvas): void {
  if (state.previewRect) {
    canvas.remove(state.previewRect);
    state.previewRect = null;
  }
  state.isDrawing = false;
  canvas.selection = true;
  canvas.requestRenderAll();
}

/**
 * Returns whether textbox drawing is currently active.
 */
export function isTextboxDrawing(): boolean {
  return state.isDrawing;
}

/**
 * Sets up the cursor for textbox drawing mode.
 */
export function setTextboxDrawingCursor(canvas: fabric.Canvas): void {
  canvas.setCursor('crosshair');
}
