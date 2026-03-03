/**
 * zIndexManifest - Z-index layer definitions for canvas objects
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

export const ZIndexLayer = {
  DocumentPaper: CanvasLayer.DOCUMENT_PAPER,
  BleedZone: CanvasLayer.BLEED_ZONE,
  TrimLine: CanvasLayer.TRIM_LINE,
  ContentBackground: CanvasLayer.CONTENT_BACKGROUND,
  Content: CanvasLayer.CONTENT_NORMAL,
  ContentForeground: CanvasLayer.CONTENT_FOREGROUND,
  Guides: CanvasLayer.SAFE_MARGIN_GUIDES,
  SmartGuides: CanvasLayer.SMART_GUIDES,
  GridOverlay: CanvasLayer.GRID_OVERLAY,
} as const;

export type SerializedZIndexLike = {
  type?: string;
  isGuide?: boolean;
  isDocumentPaper?: boolean;
  isSafeZoneOverlay?: boolean;
  zIndex?: number;
  __zIndex?: number;
};

export const getDefaultLayerForObject = (obj: SerializedZIndexLike): CanvasLayer => {
  if (obj.isDocumentPaper) return CanvasLayer.DOCUMENT_PAPER;
  if (obj.isGuide) return CanvasLayer.SAFE_MARGIN_GUIDES;
  if (obj.isSafeZoneOverlay) return CanvasLayer.BLEED_GUIDES;
  switch (obj.type) {
    case 'line':
      return CanvasLayer.SAFE_MARGIN_GUIDES;
    default:
      return CanvasLayer.CONTENT_NORMAL;
  }
};

export const getSerializedZIndex = (obj: SerializedZIndexLike): number =>
  obj.zIndex ?? obj.__zIndex ?? getDefaultLayerForObject(obj);

export const withManifestZIndex = <T extends SerializedZIndexLike>(obj: T, preferred?: CanvasLayer): T & { zIndex: number } => {
  const zIndex = preferred ?? getSerializedZIndex(obj);
  return {
    ...obj,
    zIndex,
    __zIndex: zIndex,
  };
};

export const enforceSerializedZOrder = <T extends SerializedZIndexLike>(objects: T[]): Array<T & { zIndex: number }> =>
  [...objects]
    .map((obj) => withManifestZIndex(obj))
    .sort((a, b) => getSerializedZIndex(a) - getSerializedZIndex(b));

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
  (obj as any).zIndex = layer;
}

/**
 * Get the z-index of an object
 */
export function getZIndex(obj: import('fabric').Object): CanvasLayer {
  return (obj as any).__zIndex ?? CanvasLayer.CONTENT_NORMAL;
}
