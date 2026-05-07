import * as fabric from 'fabric';
import { frameScheduler, TaskPriority } from './frameScheduler';
import { useCanvasStore } from '../state/useCanvasStore';
import { isPersistableCanvasObject } from './objectUtils';

// Filter interface for serialization
interface SerializedFilter {
  type: string;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  [key: string]: any;
}

const CUSTOM_PROPS = [
  'id',
  'tokenRole',
  'colorLocked',
  'isPlaceholder',
  'isFrame',
  'frameType',
  'charSpacing',
  'stroke',
  'strokeWidth',
  'name',
  'isPageBorder',
  'borderSettings',
  'zIndex',
  '__zIndex',
  'selectable',
  'evented',
  'hasControls',
  'lockMovementX',
  'lockMovementY',
  'lockRotation',
  'lockScalingX',
  'lockScalingY',
  'lockSkewingX',
  'lockSkewingY',
] as const;

export const toSerializableObject = (obj: fabric.Object) => {
  const base = obj.toObject([...CUSTOM_PROPS]);
  const target = obj as any;

  // Handle shadow serialization
  let shadowData = null;
  if (target.shadow) {
    if (typeof target.shadow === 'string') {
      shadowData = target.shadow;
    } else if (target.shadow && typeof target.shadow === 'object') {
      shadowData = {
        color: target.shadow.color,
        blur: target.shadow.blur,
        offsetX: target.shadow.offsetX,
        offsetY: target.shadow.offsetY,
      };
    }
  }

  // Handle image filters serialization
  let filtersData: SerializedFilter[] | null = null;
  if (obj.type === 'image' && target.filters && Array.isArray(target.filters)) {
    filtersData = target.filters.map((filter: SerializedFilter) => {
      // Convert filter to serializable format
      if (filter.type === 'Brightness') {
        return { type: 'Brightness', brightness: filter.brightness };
      } else if (filter.type === 'Contrast') {
        return { type: 'Contrast', contrast: filter.contrast };
      } else if (filter.type === 'Saturation') {
        return { type: 'Saturation', saturation: filter.saturation };
      } else {
        // For other filter types, serialize their properties
        const filterData: SerializedFilter = { type: filter.type };
        Object.keys(filter).forEach(key => {
          if (key !== 'type' && typeof filter[key] !== 'function') {
            filterData[key] = filter[key];
          }
        });
        return filterData;
      }
    });
  }

  // Handle image adjustments serialization
  let adjustmentsData = null;
  if (obj.type === 'image') {
    // Extract adjustment values from filters if they exist
    const brightnessFilter = target.filters?.find((f: SerializedFilter) => f.type === 'Brightness');
    const contrastFilter = target.filters?.find((f: SerializedFilter) => f.type === 'Contrast');
    const saturationFilter = target.filters?.find((f: SerializedFilter) => f.type === 'Saturation');

    adjustmentsData = {
      brightness: brightnessFilter?.brightness || 0,
      contrast: contrastFilter?.contrast || 0,
      saturation: saturationFilter?.saturation || 0,
    };
  }

  return {
    ...base,
    id: target.id ?? null,
    tokenRole: target.tokenRole ?? null,
    colorLocked: target.colorLocked ?? false,
    isPlaceholder: target.isPlaceholder ?? false,
    charSpacing: target.charSpacing ?? 0,
    stroke: target.stroke ?? undefined,
    strokeWidth: target.strokeWidth ?? 0,
    name: target.name ?? undefined,
    isPageBorder: target.isPageBorder ?? false,
    borderSettings: target.borderSettings ?? undefined,
    zIndex: target.zIndex ?? target.__zIndex ?? undefined,
    __zIndex: target.__zIndex ?? target.zIndex ?? undefined,
    selectable: target.selectable,
    evented: target.evented,
    hasControls: target.hasControls,
    lockMovementX: target.lockMovementX ?? false,
    lockMovementY: target.lockMovementY ?? false,
    lockRotation: target.lockRotation ?? false,
    lockScalingX: target.lockScalingX ?? false,
    lockScalingY: target.lockScalingY ?? false,
    lockSkewingX: target.lockSkewingX ?? false,
    lockSkewingY: target.lockSkewingY ?? false,
    shadow: shadowData,
    filters: filtersData,
    adjustments: obj.type === 'image' ? adjustmentsData : undefined,
  };
};

// --- CANVAS STATE CAPTURE ---

/**
 * Options for capturing canvas state
 */
export interface CaptureCanvasOptions {
  /** Maximum dimension (width or height) for the thumbnail. Default: 300 */
  thumbnailMaxSize?: number;
  /** Image format for thumbnail. Default: 'png' */
  thumbnailFormat?: 'png' | 'jpeg' | 'webp';
  /** Quality for jpeg/webp thumbnails (0-1). Default: 0.8 */
  thumbnailQuality?: number;
  /** Whether to include the canvas background in thumbnail. Default: true */
  includeBackground?: boolean;
  /** Authoritative page/document background to serialize. */
  backgroundColor?: string | null;
}

/**
 * Result of capturing canvas state
 */
export interface CapturedCanvasState {
  /** Low-resolution thumbnail as a data URL */
  thumbnail: string;
  /** Full canvas serialization as JSON string */
  canvasData: string;
  /** Canvas dimensions at time of capture */
  canvasSize: {
    width: number;
    height: number;
  };
  /** Timestamp of capture */
  capturedAt: number;
}

/**
 * Captures the current canvas state for pinning to the Vision Board.
 * Generates a low-res thumbnail and full JSON serialization.
 *
 * @param canvas - The Fabric.js canvas instance to capture
 * @param options - Optional capture settings
 * @returns Object containing thumbnail dataURL and serialized canvas data
 *
 * @example
 * ```typescript
 * const state = captureCanvasState(canvas);
 * visionBoardStore.addItem({
 *   type: 'design-state',
 *   canvasData: state.canvasData,
 *   thumbnail: state.thumbnail,
 *   canvasSize: state.canvasSize,
 *   position: { x: 100, y: 100, width: 200, height: 150 },
 * });
 * ```
 */
export const captureCanvasState = (
  canvas: fabric.Canvas,
  options: CaptureCanvasOptions = {}
): CapturedCanvasState => {
  const {
    thumbnailMaxSize = 300,
    thumbnailFormat = 'png',
    thumbnailQuality = 0.8,
    includeBackground = true,
  } = options;

  const { width: canvasWidth, height: canvasHeight } = useCanvasStore.getState();

  // Calculate thumbnail scale to fit within max size
  const scale = Math.min(
    thumbnailMaxSize / canvasWidth,
    thumbnailMaxSize / canvasHeight,
    1 // Don't upscale if canvas is smaller than max
  );

  // Store current viewport transform to restore later
  const currentVpt = canvas.viewportTransform ? [...canvas.viewportTransform] : null;
  const originalBackgroundColor = canvas.backgroundColor;
  let thumbnail = '';

  try {
    canvas.backgroundColor = includeBackground
      ? options.backgroundColor ?? originalBackgroundColor
      : '';

    // Reset viewport for clean capture
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

    // Generate thumbnail with multiplier for lower resolution
    thumbnail = canvas.toDataURL({
      format: thumbnailFormat,
      quality: thumbnailQuality,
      multiplier: scale,
      enableRetinaScaling: false,
      withoutTransform: true,
      withoutShadow: false,
    } as any);
  } finally {
    if (currentVpt) {
      canvas.setViewportTransform(currentVpt as fabric.TMat2D);
    }
    canvas.backgroundColor = originalBackgroundColor;
  }

  // Serialize all objects (excluding guides and temporary objects)
  const objects = canvas.getObjects()
    .filter(obj => isPersistableCanvasObject(obj) && !(obj as any).isTemporary)
    .map(toSerializableObject);

  // Build full canvas data
  const canvasData = JSON.stringify({
    objects,
    background: includeBackground ? (options.backgroundColor || undefined) : undefined,
    version: '1.0',
  });

  return {
    thumbnail,
    canvasData,
    canvasSize: {
      width: canvasWidth,
      height: canvasHeight,
    },
    capturedAt: Date.now(),
  };
};

/**
 * Captures canvas state asynchronously, useful for large canvases.
 * Uses requestAnimationFrame to avoid blocking the UI.
 */
export const captureCanvasStateAsync = (
  canvas: fabric.Canvas,
  options: CaptureCanvasOptions = {}
): Promise<CapturedCanvasState> => {
  return new Promise((resolve) => {
    frameScheduler.scheduleTask(() => {
      const result = captureCanvasState(canvas, options);
      resolve(result);
    }, TaskPriority.Low);
  });
};

/**
 * Generates only a thumbnail from the canvas (lighter operation).
 * Useful for preview updates without full serialization.
 */
export const captureCanvasThumbnail = (
  canvas: fabric.Canvas,
  options: Omit<CaptureCanvasOptions, 'includeBackground'> & { includeBackground?: boolean } = {}
): string => {
  const {
    thumbnailMaxSize = 300,
    thumbnailFormat = 'png',
    thumbnailQuality = 0.8,
  } = options;

  const canvasWidth = canvas.getWidth();
  const canvasHeight = canvas.getHeight();

  const scale = Math.min(
    thumbnailMaxSize / canvasWidth,
    thumbnailMaxSize / canvasHeight,
    1
  );

  const currentVpt = canvas.viewportTransform ? [...canvas.viewportTransform] : null;
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

  const thumbnail = canvas.toDataURL({
    format: thumbnailFormat,
    quality: thumbnailQuality,
    multiplier: scale,
    enableRetinaScaling: false,
    withoutTransform: true,
  } as any);

  if (currentVpt) {
    canvas.setViewportTransform(currentVpt as fabric.TMat2D);
  }

  return thumbnail;
};
