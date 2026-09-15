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
  '__fixedWidth',
  '__fixedHeight',
  'originalFontSize',
  'charSpacing',
  'stroke',
  'strokeWidth',
  'name',
  'recipeId',
  'recipePageId',
  'slotId',
  'semanticRole',
  'assetId',
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

/**
 * Fabric uses lower-case type names on live objects and class names when an
 * object is serialized (for example `image` -> `Image`).  Keep that versioned
 * engine detail at the scene boundary instead of making every consumer guess
 * which spelling it received.
 */
const SERIALIZED_TYPE_ALIASES: Record<string, string> = {
  activeSelection: 'activeSelection',
  ActiveSelection: 'activeSelection',
  activeselection: 'activeSelection',
  Circle: 'circle',
  circle: 'circle',
  Ellipse: 'ellipse',
  ellipse: 'ellipse',
  Group: 'group',
  group: 'group',
  Image: 'image',
  image: 'image',
  IText: 'i-text',
  'i-text': 'i-text',
  Line: 'line',
  line: 'line',
  Path: 'path',
  path: 'path',
  Polygon: 'polygon',
  polygon: 'polygon',
  Polyline: 'polyline',
  polyline: 'polyline',
  Rect: 'rect',
  rect: 'rect',
  Text: 'text',
  text: 'text',
  Textbox: 'textbox',
  textbox: 'textbox',
  Triangle: 'triangle',
  triangle: 'triangle',
};

export const normalizeSerializedObjectType = (type: unknown): string | null => {
  if (typeof type !== 'string' || type.trim().length === 0) return null;
  return SERIALIZED_TYPE_ALIASES[type] ?? type;
};

export const isSerializedImageObject = (object: unknown): boolean =>
  normalizeSerializedObjectType((object as any)?.type) === 'image';

export const isSerializedGroupObject = (object: unknown): boolean =>
  normalizeSerializedObjectType((object as any)?.type) === 'group';

/**
 * Convert a durable Fabric object tree back to the runtime registry's type
 * discriminants before calling `fabric.util.enlivenObjects`. Fabric 7 emits
 * class names such as `Image` in JSON, while the runtime registry is keyed by
 * names such as `image`.
 */
export const normalizeSerializedObjectForFabric = (object: any): any => {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return object;
  const normalizedType = normalizeSerializedObjectType(object.type);
  return {
    ...object,
    ...(normalizedType ? { type: normalizedType } : {}),
    ...(Array.isArray(object.objects)
      ? { objects: object.objects.map(normalizeSerializedObjectForFabric) }
      : {}),
    ...(object.clipPath && typeof object.clipPath === 'object'
      ? { clipPath: normalizeSerializedObjectForFabric(object.clipPath) }
      : {}),
  };
};

const serializeShadow = (target: any, fallback: any = null) => {
  if (!target?.shadow) return fallback;
  if (typeof target.shadow === 'string') return target.shadow;
  if (typeof target.shadow === 'object') {
    return {
      color: target.shadow.color,
      blur: target.shadow.blur,
      offsetX: target.shadow.offsetX,
      offsetY: target.shadow.offsetY,
    };
  }
  return fallback;
};

const serializeFilters = (target: any, fallback: any = null): SerializedFilter[] | null => {
  if (!Array.isArray(target?.filters)) return fallback;
  return target.filters.map((filter: SerializedFilter) => {
    if (filter.type === 'Brightness') {
      return { type: 'Brightness', brightness: filter.brightness };
    }
    if (filter.type === 'Contrast') {
      return { type: 'Contrast', contrast: filter.contrast };
    }
    if (filter.type === 'Saturation') {
      return { type: 'Saturation', saturation: filter.saturation };
    }
    const filterData: SerializedFilter = { type: filter.type };
    Object.keys(filter).forEach((key) => {
      if (key !== 'type' && typeof filter[key] !== 'function') {
        filterData[key] = filter[key];
      }
    });
    return filterData;
  });
};

const serializeObjectFields = (base: Record<string, any>, target?: any) => {
  const objectType = target?.type ?? normalizeSerializedObjectType(base.type);
  const isImage = objectType === 'image' || isSerializedImageObject(base);
  const brightnessFilter = target?.filters?.find((f: SerializedFilter) => f.type === 'Brightness');
  const contrastFilter = target?.filters?.find((f: SerializedFilter) => f.type === 'Contrast');
  const saturationFilter = target?.filters?.find((f: SerializedFilter) => f.type === 'Saturation');
  const adjustments = isImage
    ? {
      brightness: brightnessFilter?.brightness ?? base.adjustments?.brightness ?? 0,
      contrast: contrastFilter?.contrast ?? base.adjustments?.contrast ?? 0,
      saturation: saturationFilter?.saturation ?? base.adjustments?.saturation ?? 0,
    }
    : undefined;

  return {
    ...base,
    id: target?.id ?? base.id ?? null,
    tokenRole: target?.tokenRole ?? base.tokenRole ?? null,
    colorLocked: target?.colorLocked ?? base.colorLocked ?? false,
    isPlaceholder: target?.isPlaceholder ?? base.isPlaceholder ?? false,
    __fixedWidth: target?.__fixedWidth ?? base.__fixedWidth,
    __fixedHeight: target?.__fixedHeight ?? base.__fixedHeight,
    originalFontSize: target?.originalFontSize ?? base.originalFontSize,
    charSpacing: target?.charSpacing ?? base.charSpacing ?? 0,
    stroke: target?.stroke ?? base.stroke ?? undefined,
    strokeWidth: target?.strokeWidth ?? base.strokeWidth ?? 0,
    name: target?.name ?? base.name ?? undefined,
    isPageBorder: target?.isPageBorder ?? base.isPageBorder ?? false,
    borderSettings: target?.borderSettings ?? base.borderSettings ?? undefined,
    assetId: isImage
      ? target?.assetId ?? base.assetId ?? target?.id ?? base.id ?? undefined
      : target?.assetId ?? base.assetId ?? undefined,
    zIndex: target?.zIndex ?? target?.__zIndex ?? base.zIndex ?? base.__zIndex ?? undefined,
    __zIndex: target?.__zIndex ?? target?.zIndex ?? base.__zIndex ?? base.zIndex ?? undefined,
    selectable: target?.selectable ?? base.selectable,
    evented: target?.evented ?? base.evented,
    hasControls: target?.hasControls ?? base.hasControls,
    lockMovementX: target?.lockMovementX ?? base.lockMovementX ?? false,
    lockMovementY: target?.lockMovementY ?? base.lockMovementY ?? false,
    lockRotation: target?.lockRotation ?? base.lockRotation ?? false,
    lockScalingX: target?.lockScalingX ?? base.lockScalingX ?? false,
    lockScalingY: target?.lockScalingY ?? base.lockScalingY ?? false,
    lockSkewingX: target?.lockSkewingX ?? base.lockSkewingX ?? false,
    lockSkewingY: target?.lockSkewingY ?? base.lockSkewingY ?? false,
    shadow: serializeShadow(target, base.shadow),
    filters: serializeFilters(target, base.filters),
    adjustments,
  };
};

const enrichSerializedTree = (base: any, target?: any): any => {
  if (!base || typeof base !== 'object') return base;
  const targetChildren = typeof target?.getObjects === 'function' ? target.getObjects() : [];
  const children = Array.isArray(base.objects)
    ? base.objects.map((child: any, index: number) => enrichSerializedTree(child, targetChildren[index]))
    : base.objects;
  return serializeObjectFields(
    Array.isArray(base.objects) ? { ...base, objects: children } : base,
    target,
  );
};

const ACTIVE_SELECTION_TRANSFORM_PROPS = [
  'left',
  'top',
  'scaleX',
  'scaleY',
  'angle',
  'skewX',
  'skewY',
  'flipX',
  'flipY',
] as const;

/**
 * Fabric's Canvas serializer has a private ActiveSelection realization path,
 * but StaticCanvas and object-list adapters do not.  Use Fabric's supported
 * matrix helper explicitly for selected children so every caller observes the
 * same page-space scene.  The live object is restored immediately; this is a
 * serialization-only realization and never changes selection or authored
 * state.
 */
const serializeActiveSelectionChild = (
  object: fabric.Object,
  activeSelection: fabric.ActiveSelection,
) => {
  const original = Object.fromEntries(
    ACTIVE_SELECTION_TRANSFORM_PROPS.map((key) => [key, (object as any)[key]]),
  );
  try {
    fabric.util.addTransformToObject(object, activeSelection.calcOwnMatrix());
    return object.toObject([...CUSTOM_PROPS]);
  } finally {
    object.set(original as any);
    object.setCoords();
  }
};

const getActiveSelectionForCanvas = (
  canvas: fabric.Canvas,
  liveObjects: fabric.Object[],
) => {
  const activeObject = typeof (canvas as any).getActiveObject === 'function'
    ? (canvas as any).getActiveObject() as fabric.Object | undefined
    : undefined;
  if (activeObject?.type === 'activeSelection') {
    return activeObject as fabric.ActiveSelection;
  }

  // Lightweight/recovery canvases may not expose getActiveObject, while their
  // objects can still carry an ActiveSelection parent.  Only infer that
  // parent; ordinary Group parents must remain nested scene structure.
  const parent = liveObjects.find((object) => (object as any).group?.type === 'activeSelection')
    ?.group;
  return parent?.type === 'activeSelection' ? parent as fabric.ActiveSelection : null;
};

export const toSerializableObject = (obj: fabric.Object) => {
  return enrichSerializedTree(obj.toObject([...CUSTOM_PROPS]), obj);
};

/**
 * Serialize a canvas through Fabric's canvas-level serializer.  Fabric's
 * canvas serializer realizes an ActiveSelection transform while serializing;
 * calling each selected object's `toObject` directly does not.  Keeping this
 * as the only page-scene entry point makes selection state irrelevant to the
 * durable geometry.
 */
export const serializeCanvasObjects = (
  canvas: fabric.Canvas,
  filter: (object: fabric.Object) => boolean = isPersistableCanvasObject,
) => {
  const liveObjects = canvas.getObjects();
  const activeSelection = getActiveSelectionForCanvas(canvas, liveObjects);
  const activeSelectionObjects = activeSelection
    ? new Set(activeSelection.getObjects())
    : new Set<fabric.Object>();
  // Fabric's canvas serializer omits objects marked `excludeFromExport`.
  // Pair against that same source list before applying Design Space's
  // persistability filter; pairing by raw canvas index shifts every object
  // after the first guide/paper layer.
  const serializedLiveObjects = liveObjects.filter((object) => !(object as any).excludeFromExport);
  // A real Fabric canvas is required for selection-aware page serialization,
  // but a few lightweight callers (thumbnail/state harnesses and recovery
  // tooling) intentionally provide only the object-list surface. Preserve
  // that compatibility without weakening the real-canvas path above.
  const serializedCanvas = typeof (canvas as any).toObject === 'function'
    ? (canvas as any).toObject([...CUSTOM_PROPS]) as any
    : {
        objects: serializedLiveObjects.map((object) => object.toObject([...CUSTOM_PROPS])),
      };
  const serializedObjects = Array.isArray(serializedCanvas?.objects)
    ? serializedCanvas.objects
    : [];

  return serializedLiveObjects
    .map((object, index) => ({ object, serialized: serializedObjects[index] }))
    .filter(({ object }) => filter(object))
    .map(({ object, serialized }) => {
      const pageSerialized = activeSelectionObjects.has(object) && activeSelection
        ? serializeActiveSelectionChild(object, activeSelection)
        : serialized ?? object.toObject([...CUSTOM_PROPS]);
      return enrichSerializedTree(pageSerialized, object);
    });
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
  const objects = serializeCanvasObjects(
    canvas,
    (obj) => isPersistableCanvasObject(obj) && !(obj as any).isTemporary,
  );

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
