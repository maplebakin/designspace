/**
 * Canvas Operations API
 *
 * Simplified, user-friendly API for common canvas operations.
 * Wraps the lower-level store actions and fabric utilities.
 *
 * Use this module for programmatic canvas manipulation from
 * components or external integrations.
 *
 * @module canvasOperations
 */

import { ActiveSelection } from 'fabric';
import { useEditorStore } from '../state/editorStore';
import { useCanvasStore } from '../state/useCanvasStore';
import { resizeCanvas, zoomToCenter, fitCanvasToViewport, rotateCanvas as rotateCanvasInternal } from '../fabric/canvasUtils';
import { PrintSizes, SocialSizes, convertDimensions, UnitMode } from './units';
import { showError, showInfo, ErrorMessages } from './errorHandling';

// ============================================================================
// TYPES
// ============================================================================

/** Canvas size preset */
export interface SizePreset {
  width: number;
  height: number;
  label: string;
}

/** Options for setting canvas size */
export interface SetSizeOptions {
  /** Width in the specified unit */
  width: number;
  /** Height in the specified unit */
  height: number;
  /** Unit of the provided dimensions (default: 'px') */
  unit?: UnitMode;
  /** Whether to preserve existing content (default: true) */
  preserveContent?: boolean;
}

/** Options for zoom operations */
export interface ZoomOptions {
  /** Target zoom level (1 = 100%) */
  level?: number;
  /** Zoom relative to current (e.g., 1.1 = zoom in 10%) */
  relative?: number;
  /** Fit document to viewport */
  fit?: boolean;
}

/** Export format options */
export type ExportFormat = 'png' | 'jpeg' | 'svg';

/** Options for export operations */
export interface ExportOptions {
  /** Export format */
  format: ExportFormat;
  /** Quality for JPEG (0-1, default: 0.92) */
  quality?: number;
  /** Resolution multiplier (1 = 1x, 2 = 2x, etc.) */
  multiplier?: number;
  /** Clip to canvas bounds (default: true) */
  clipToCanvas?: boolean;
}

// ============================================================================
// SIZE OPERATIONS
// ============================================================================

/**
 * Sets the canvas size to a preset.
 *
 * @param preset - Size preset from PrintSizes or SocialSizes
 *
 * @example
 * ```ts
 * import { setCanvasSizePreset, PrintSizes } from './canvasOperations';
 * setCanvasSizePreset(PrintSizes.LETTER);
 * ```
 */
export function setCanvasSizePreset(preset: SizePreset): void {
  resizeCanvas(preset.width, preset.height);
  showInfo(`Canvas set to ${preset.label}`);
}

/**
 * Sets the canvas size with custom dimensions.
 *
 * @param options - Size options including width, height, and unit
 *
 * @example
 * ```ts
 * // Set to 5" x 7" in inches
 * setCanvasSize({ width: 5, height: 7, unit: 'in' });
 *
 * // Set to 1920 x 1080 in pixels
 * setCanvasSize({ width: 1920, height: 1080 });
 * ```
 */
export function setCanvasSize(options: SetSizeOptions): void {
  const { width, height, unit = 'px' } = options;

  // Convert to pixels if needed
  const { width: pxWidth, height: pxHeight } = convertDimensions({
    width,
    height,
    fromUnit: unit,
    toUnit: 'px',
  });

  resizeCanvas(Math.round(pxWidth), Math.round(pxHeight));
}

/**
 * Gets the current canvas size in the specified unit.
 *
 * @param unit - Target unit (default: 'px')
 * @returns Current canvas dimensions
 */
export function getCanvasSize(unit: UnitMode = 'px'): { width: number; height: number } {
  const { width, height } = useCanvasStore.getState();
  return convertDimensions({ width, height, fromUnit: 'px', toUnit: unit });
}

/**
 * Rotates the canvas (swaps width and height).
 */
export function rotateCanvas(): void {
  rotateCanvasInternal();
}

// ============================================================================
// ZOOM OPERATIONS
// ============================================================================

/**
 * Sets the zoom level or adjusts it relatively.
 *
 * @param options - Zoom options
 *
 * @example
 * ```ts
 * // Set to 100%
 * zoom({ level: 1 });
 *
 * // Zoom in by 25%
 * zoom({ relative: 1.25 });
 *
 * // Fit to viewport
 * zoom({ fit: true });
 * ```
 */
export function zoom(options: ZoomOptions): void {
  const { canvas } = useEditorStore.getState();
  if (!canvas) {
    showError(ErrorMessages.CANVAS_NOT_READY);
    return;
  }

  if (options.fit) {
    const container = canvas.getElement().parentElement;
    if (container) {
      const { width, height } = container.getBoundingClientRect();
      fitCanvasToViewport(width, height);
    }
    return;
  }

  if (options.level !== undefined) {
    zoomToCenter(options.level);
    return;
  }

  if (options.relative !== undefined) {
    const currentZoom = canvas.getZoom();
    zoomToCenter(currentZoom * options.relative);
  }
}

/**
 * Zoom in by 25%.
 */
export function zoomIn(): void {
  zoom({ relative: 1.25 });
}

/**
 * Zoom out by 20%.
 */
export function zoomOut(): void {
  zoom({ relative: 0.8 });
}

/**
 * Reset zoom to 100%.
 */
export function zoomReset(): void {
  zoom({ level: 1 });
}

/**
 * Fit canvas to viewport.
 */
export function zoomFit(): void {
  zoom({ fit: true });
}

// ============================================================================
// HISTORY OPERATIONS
// ============================================================================

/**
 * Undo the last action.
 */
export async function undo(): Promise<void> {
  await useEditorStore.getState().undo();
}

/**
 * Redo the last undone action.
 */
export async function redo(): Promise<void> {
  await useEditorStore.getState().redo();
}

// ============================================================================
// SELECTION OPERATIONS
// ============================================================================

/**
 * Selects all objects on the canvas.
 */
export function selectAll(): void {
  const { canvas } = useEditorStore.getState();
  if (!canvas) return;

  const objects = canvas.getObjects().filter((obj) => !(obj as any).isGuide);
  if (objects.length === 0) return;

  const selection = new ActiveSelection(objects, { canvas });
  canvas.setActiveObject(selection);
  canvas.requestRenderAll();
}

/**
 * Deselects all objects.
 */
export function deselectAll(): void {
  const { canvas } = useEditorStore.getState();
  if (!canvas) return;

  canvas.discardActiveObject();
  canvas.requestRenderAll();
}

/**
 * Deletes the selected object(s).
 */
export function deleteSelection(): void {
  useEditorStore.getState().removeSelectedObject();
}

// ============================================================================
// EXPORT OPERATIONS
// ============================================================================

/**
 * Exports the canvas to a file.
 *
 * @param options - Export options
 *
 * @example
 * ```ts
 * // Export as PNG at 2x resolution
 * exportCanvas({ format: 'png', multiplier: 2 });
 *
 * // Export as JPEG with 90% quality
 * exportCanvas({ format: 'jpeg', quality: 0.9 });
 * ```
 */
export async function exportCanvas(options: ExportOptions): Promise<void> {
  const {
    format,
    quality = 0.92,
    multiplier = 1,
    clipToCanvas = true,
  } = options;

  await useEditorStore.getState().exportCanvas({
    format,
    quality,
    multiplier,
    clipToCanvas,
  });
}

// ============================================================================
// RE-EXPORTS
// ============================================================================

export { PrintSizes, SocialSizes };
