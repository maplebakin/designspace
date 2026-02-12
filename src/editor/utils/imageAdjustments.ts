/**
 * Image Adjustment Utilities
 *
 * Provides consolidated functions for applying brightness, contrast,
 * and saturation adjustments to Fabric.js images. These utilities
 * reduce code duplication and ensure consistent behavior.
 */

import * as fabric from 'fabric';
import type { ImageAdjustments, DesignSpaceImage } from '../types/fabric-extensions.d';
import { isImage } from './typeGuards';

// ============================================================================
// TYPES
// ============================================================================

/** Supported adjustment types */
export type AdjustmentType = 'brightness' | 'contrast' | 'saturation';

/** Filter instance type (any adjustment filter) */
type AdjustmentFilter = fabric.filters.Brightness | fabric.filters.Contrast | fabric.filters.Saturation;

/** Adjustment options for applying changes */
export interface ApplyAdjustmentOptions {
  /** The canvas to request render on */
  canvas: fabric.Canvas | null;
  /** Callback to save state after adjustment */
  onSaveState?: () => void;
  /** Callback to sync layers after adjustment */
  onLayerSync?: () => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default adjustment values (neutral state) */
export const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
};

/** Filter type names matching Fabric.js filter naming convention */
const FILTER_TYPE_MAP: Record<AdjustmentType, string> = {
  brightness: 'Brightness',
  contrast: 'Contrast',
  saturation: 'Saturation',
};

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Ensures an image object has the adjustments property initialized.
 */
export function ensureAdjustments(image: fabric.FabricImage): ImageAdjustments {
  const dsImage = image as DesignSpaceImage;
  if (!dsImage.adjustments) {
    dsImage.adjustments = { ...DEFAULT_ADJUSTMENTS };
  }
  return dsImage.adjustments;
}

/**
 * Gets the current adjustments from an image, or defaults if not set.
 */
export function getAdjustments(image: fabric.FabricImage | null | undefined): ImageAdjustments {
  if (!image) return { ...DEFAULT_ADJUSTMENTS };
  const dsImage = image as DesignSpaceImage;
  return dsImage.adjustments ?? { ...DEFAULT_ADJUSTMENTS };
}

/**
 * Finds a filter by type in the image's filter array.
 */
function findFilter<T extends AdjustmentFilter>(
  image: fabric.FabricImage,
  filterType: string
): T | undefined {
  if (!image.filters) return undefined;
  return image.filters.find((f) => f.type === filterType) as T | undefined;
}

/**
 * Applies a single adjustment type to an image.
 *
 * @param image - The Fabric.js image to adjust
 * @param type - The type of adjustment (brightness, contrast, or saturation)
 * @param value - The adjustment value (-1 to 1, 0 is neutral)
 */
export function applySingleAdjustment(
  image: fabric.FabricImage,
  type: AdjustmentType,
  value: number
): void {
  // Ensure filters array exists
  if (!image.filters) {
    image.filters = [];
  }

  const filterTypeName = FILTER_TYPE_MAP[type];
  let filter = findFilter(image, filterTypeName);

  if (filter) {
    // Update existing filter
    (filter as any)[type] = value;
  } else {
    // Create new filter
    let newFilter: AdjustmentFilter;
    switch (type) {
      case 'brightness':
        newFilter = new fabric.filters.Brightness({ brightness: value });
        break;
      case 'contrast':
        newFilter = new fabric.filters.Contrast({ contrast: value });
        break;
      case 'saturation':
        newFilter = new fabric.filters.Saturation({ saturation: value });
        break;
    }
    // Use type assertion for Fabric.js filter compatibility
    (image.filters as unknown as AdjustmentFilter[]).push(newFilter);
    filter = newFilter;
  }

  // Update stored adjustment value
  const adjustments = ensureAdjustments(image);
  adjustments[type] = value;

  // Apply filters to the image
  image.applyFilters();
}

/**
 * Applies multiple adjustments to an image at once.
 *
 * @param image - The Fabric.js image to adjust
 * @param adjustments - Partial adjustments to apply
 * @param options - Optional callbacks for state management
 */
export function applyAdjustments(
  image: fabric.FabricImage,
  adjustments: Partial<ImageAdjustments>,
  options?: ApplyAdjustmentOptions
): void {
  // Apply each adjustment type that was provided
  if (adjustments.brightness !== undefined) {
    applySingleAdjustment(image, 'brightness', adjustments.brightness);
  }
  if (adjustments.contrast !== undefined) {
    applySingleAdjustment(image, 'contrast', adjustments.contrast);
  }
  if (adjustments.saturation !== undefined) {
    applySingleAdjustment(image, 'saturation', adjustments.saturation);
  }

  // Handle canvas render and callbacks
  if (options?.canvas) {
    options.canvas.requestRenderAll();
  }
  options?.onSaveState?.();
  options?.onLayerSync?.();
}

/**
 * Resets all adjustments on an image to neutral values.
 *
 * @param image - The Fabric.js image to reset
 * @param options - Optional callbacks for state management
 */
export function resetAdjustments(
  image: fabric.FabricImage,
  options?: ApplyAdjustmentOptions
): void {
  // Remove all adjustment filters
  if (image.filters) {
    image.filters = image.filters.filter(
      (f) =>
        f.type !== 'Brightness' &&
        f.type !== 'Contrast' &&
        f.type !== 'Saturation'
    );
  }

  // Reset stored adjustments
  (image as DesignSpaceImage).adjustments = { ...DEFAULT_ADJUSTMENTS };

  // Apply empty filters
  image.applyFilters();

  // Handle canvas render and callbacks
  if (options?.canvas) {
    options.canvas.requestRenderAll();
  }
  options?.onSaveState?.();
  options?.onLayerSync?.();
}

/**
 * High-level function to apply an adjustment to the selected object.
 * Returns false if the selected object is not an image.
 *
 * @param selectedObject - The currently selected Fabric object
 * @param type - The adjustment type to apply
 * @param value - The adjustment value
 * @param options - Canvas and callback options
 * @returns True if adjustment was applied, false if object is not an image
 */
export function applyAdjustmentToSelection(
  selectedObject: fabric.FabricObject | null | undefined,
  type: AdjustmentType,
  value: number,
  options?: ApplyAdjustmentOptions
): boolean {
  if (!selectedObject || !isImage(selectedObject)) {
    return false;
  }

  applySingleAdjustment(selectedObject as fabric.FabricImage, type, value);

  // Handle canvas render and callbacks
  if (options?.canvas) {
    options.canvas.requestRenderAll();
  }
  options?.onSaveState?.();
  options?.onLayerSync?.();

  return true;
}

/**
 * High-level function to reset adjustments on the selected object.
 * Returns false if the selected object is not an image.
 *
 * @param selectedObject - The currently selected Fabric object
 * @param options - Canvas and callback options
 * @returns True if adjustments were reset, false if object is not an image
 */
export function resetAdjustmentsOnSelection(
  selectedObject: fabric.FabricObject | null | undefined,
  options?: ApplyAdjustmentOptions
): boolean {
  if (!selectedObject || !isImage(selectedObject)) {
    return false;
  }

  resetAdjustments(selectedObject as fabric.FabricImage, options);
  return true;
}
