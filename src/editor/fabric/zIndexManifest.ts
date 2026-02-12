/**
 * zIndexManifest - Z-index layer definitions for canvas objects
 * Implements Task 4.2: Z-Index Manifest for Guides from the roadmap
 */

export enum CanvasLayer {
  DOCUMENT_PAPER = -10,     // Document background (the visible canvas area)
  BLEED_ZONE = 0,           // Grey background for bleed
  TRIM_LINE = 1,            // White edge lines
  CONTENT_BACKGROUND = 10,  // User background objects
  CONTENT_NORMAL = 100,     // User objects (default)
  CONTENT_FOREGROUND = 200, // User foreground objects
  SAFE_MARGIN_GUIDES = 300, // Cyan dashed lines
  BLEED_GUIDES = 301,       // Red dashed lines
  SMART_GUIDES = 400,       // Purple snap lines (temporary)
  GRID_OVERLAY = 500,       // Grid (drawn on contextTop, not canvas)
}

/**
 * Enforce z-order based on the manifest
 * This function sorts all objects on the canvas according to their assigned z-index
 */
export function enforceZOrder(canvas: import('fabric').Canvas): void {
  const objects = canvas.getObjects();

  // Sort by __zIndex (default to CONTENT_NORMAL)
  const sorted = [...objects].sort((a, b) => {
    const zA = (a as any).__zIndex ?? CanvasLayer.CONTENT_NORMAL;
    const zB = (b as any).__zIndex ?? CanvasLayer.CONTENT_NORMAL;
    return zA - zB;
  });

  // Reorder on canvas using Fabric.js v6 API
  sorted.forEach((obj, index) => {
    canvas.moveObjectTo(obj, index);
  });
}

/**
 * Assign a z-index to an object
 */
export function assignZIndex(obj: import('fabric').Object, layer: CanvasLayer): void {
  (obj as any).__zIndex = layer;
}

/**
 * Get the z-index of an object
 */
export function getZIndex(obj: import('fabric').Object): CanvasLayer {
  return (obj as any).__zIndex ?? CanvasLayer.CONTENT_NORMAL;
}