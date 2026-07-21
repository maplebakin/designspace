import { createWithEqualityFn } from 'zustand/traditional';
import { persist } from 'zustand/middleware';
import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import { ensureObjectId, reviveCustomFabricProps } from '../fabric/initFabricCanvas';
import { MemoryManager } from '../../utils/memoryManager';
import {
    alignLeft,
    alignCenter,
    alignRight,
    alignTop,
    alignMiddle,
    alignBottom,
    distributeHorizontally,
    distributeVertically,
} from '../fabric/alignment';
import { groupObjects, ungroupObjects } from '../fabric/grouping';
import { resizeCanvas, fitCanvasToViewport } from '../fabric/canvasUtils';
import { toSerializableObject } from '../utils/serialization';
import { useUiThemeStore } from './uiThemeStore';
import { isPersistableCanvasObject, isUserObject } from '../utils/objectUtils';
import type { ApocapaletteTheme } from '../types/apocapalette';
import { applyAssetRefCounts, hydrateCanvasDataWithAssets, prepareCanvasDataForPersistence } from './useHistoryStore';
import { useHistoryStore } from './useHistoryStore';
import { useCanvasStore } from './useCanvasStore';
import { DEFAULT_CANVAS_SIZE } from './canvasDefaults';
import { unitScale as unitScaleMap, UnitMode } from '../utils/units';
import { applyActiveThemeToCanvas } from '../fabric/themeUtils';
import { advancedExportManager } from '../export/advancedExportManager';
import { CanvasLayer, enforceSerializedZOrder, withManifestZIndex, ZIndexLayer } from '../fabric/zIndexManifest';
import {
    useThemeStore,
    applyThemeToCanvas,
    applyThemedFillToObject,
    applyThemeTintToImage,
    resetObjectToDefaultTheme as resetObjectTheme,
    resetAllThemeLinks,
} from './useThemeStore';
import {
    applyAdjustmentToSelection,
    applyAdjustments,
    resetAdjustmentsOnSelection,
} from '../utils/imageAdjustments';
import { isActiveSelection, isImage } from '../utils/typeGuards';
import { showError, showInfo, ErrorMessages } from '../utils/errorHandling';
import { coordinateSystem } from '../utils/coordinateSystem';
import { type AccessibilitySettings, AccessibilityManager } from '../utils/accessibilityModes';
import { applySuggestionToObjects, generateSuggestions, type LayoutSuggestion } from '../utils/aiLayoutSuggestions';
import { commitCanvasMutation } from '../utils/commitCanvasMutation';
import {
    assertSupportedDesignSpaceProjectSchema,
    extractProductProjectFields,
    getDesignSpaceProjectEditorMode,
    normalizeDesignSpaceProjectPayload,
    type ProductAwareProjectPayload,
    type ProductProjectFields,
} from '../project/projectSchema';
import { generateProjectFromRecipe } from '../recipes/generateProjectFromRecipe';
import type { ProductRecipeId } from '../recipes/recipeRegistry';

// Re-export BrandCollection for backward compatibility
export type { BrandCollection } from './useThemeStore';
export { DEFAULT_CANVAS_SIZE } from './canvasDefaults';


// --- CONSTANTS ---

// Default canvas background color (cream)
export const DEFAULT_CANVAS_BACKGROUND = '#FAF8F5';

const MAX_PROJECT_FILE_BYTES = 100 * 1024 * 1024;
const MAX_PROJECT_PAGES = 250;
const MAX_OBJECTS_PER_PAGE = 10_000;
const MAX_OBJECT_NESTING_DEPTH = 50;
const MAX_PAGE_DIMENSION_PX = 30_000;
const MAX_EMBEDDED_ASSET_STRING_BYTES = 100 * 1024 * 1024;

export type AutoSaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';
export type ToastVariant = 'success' | 'info' | 'warning' | 'error';

export type ToastAction = {
    label: string;
    onAction: () => void;
};

export type ToastPayload = {
    id: string;
    message: string;
    variant: ToastVariant;
    details?: string;
    action?: ToastAction;
    durationMs?: number;
};

export type ToastInput = string | {
    message: string;
    variant?: ToastVariant;
    details?: string;
    action?: ToastAction;
    durationMs?: number;
};

let pendingLayerSyncSelectionIds: string[] | null = null;
let pendingInsertionCandidateIds: string[] | null = null;

export const getPendingLayerSyncSelectionIds = () =>
    pendingLayerSyncSelectionIds ? [...pendingLayerSyncSelectionIds] : null;

export const setPendingLayerSyncSelectionIds = (ids: string[] | null) => {
    pendingLayerSyncSelectionIds = ids ? [...ids] : null;
};

export const getPendingInsertionCandidateIds = () =>
    pendingInsertionCandidateIds ? [...pendingInsertionCandidateIds] : null;

export const setPendingInsertionCandidateIds = (ids: string[] | null) => {
    pendingInsertionCandidateIds = ids ? [...ids] : null;
};

export const finalizeInsertionSelection = (ids: string | string[]) => {
    const selectionIds = Array.isArray(ids) ? ids.filter(Boolean) : [ids].filter(Boolean);
    if (selectionIds.length === 0) return;
    setPendingLayerSyncSelectionIds(selectionIds);
    setPendingInsertionCandidateIds(selectionIds);

    let attempts = 0;
    const selectWhenReady = () => {
        const pendingIds = getPendingInsertionCandidateIds() ?? getPendingLayerSyncSelectionIds() ?? selectionIds;
        if (!pendingIds || pendingIds.length === 0) return;

        const { canvas, selectObjectById, selectObjectsByIds } = useEditorStore.getState();
        const allReady = !!canvas && pendingIds.every((id) =>
            canvas.getObjects().some((object) => (object as any).id === id)
        );

        if (allReady) {
            if (pendingIds.length === 1) {
                selectObjectById(pendingIds[0]);
            } else {
                selectObjectsByIds(pendingIds);
            }
            globalThis.setTimeout(() => {
                const state = useEditorStore.getState();
                const active = state.canvas?.getActiveObject();
                const activeIds = isActiveSelection(active)
                    ? (active as fabric.ActiveSelection).getObjects().map((object) => (object as any).id)
                    : [(active as any)?.id].filter(Boolean);
                const selectionStuck = pendingIds.every((id) =>
                    activeIds.includes(id) || state.selectedLayerIds.includes(id)
                );
                if (selectionStuck) return;
                setPendingLayerSyncSelectionIds(pendingIds);
                setPendingInsertionCandidateIds(pendingIds);
                attempts += 1;
                if (attempts < 40) {
                    globalThis.setTimeout(selectWhenReady, 25);
                }
            }, 25);
            return;
        }

        attempts += 1;
        if (attempts < 40) {
            globalThis.setTimeout(selectWhenReady, 16);
        }
    };

    globalThis.setTimeout(selectWhenReady, 0);
};

export const deriveSaveStatus = (status: AutoSaveStatus): SaveStatus => {
    switch (status) {
        case 'dirty':
            return 'unsaved';
        case 'saving':
            return 'saving';
        case 'error':
            return 'error';
        case 'saved':
        case 'idle':
        default:
            return 'saved';
    }
};

export interface Template {
  id: string;
  name: string;
  canvasData: string; // Stored as stringified JSON
  defaultThemeId: string;
  thumbnail?: string;
  canvasSize?: { width: number; height: number };
  unitMode?: UnitMode;
}

export interface ProjectPage {
  id: string;
  name: string;
  canvasData?: any;
  pages?: ProjectPage[];
  activePageIndex?: number;
  canvasSize: { width: number; height: number };
  thumbnail?: string;
}

// --- INTERFACES ---
export interface Layer {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  movementLocked: boolean;
  colorLocked: boolean;
}

export interface StickerData {
    id: string;
    url: string;
    tags: string[];
    format?: 'svg' | 'png' | 'jpeg';
    svg?: string;
    label?: string;
}

// BrandCollection is now defined in useThemeStore.ts and re-exported above

export type EditorTool = 'select' | 'draw' | 'pan' | 'erase' | 'textbox';

export type CanvasReadyState = 'uninitialized' | 'initializing' | 'ready' | 'disposing' | 'disposed';

/**
 * PHASE 2.1: Serialized representation of a Fabric.js object.
 * This is the PRIMARY source of truth for canvas objects.
 * Fabric.js canvas acts as a RENDER DELEGATE.
 */
export interface SerializedFabricObject {
  // Fabric.js base properties
  type: string;
  version?: string;
  originX?: string;
  originY?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  fill?: string | object;
  stroke?: string;
  strokeWidth?: number;
  strokeDashArray?: number[];
  strokeLineCap?: string;
  strokeDashOffset?: number;
  strokeLineJoin?: string;
  strokeUniform?: boolean;
  strokeMiterLimit?: number;
  scaleX?: number;
  scaleY?: number;
  angle?: number;
  flipX?: boolean;
  flipY?: boolean;
  opacity?: number;
  shadow?: object | string | null;
  visible?: boolean;
  backgroundColor?: string;
  fillRule?: string;
  paintFirst?: string;
  globalCompositeOperation?: string;
  skewX?: number;
  skewY?: number;

  // Custom properties
  id: string | null;
  tokenRole?: string | null;
  colorLocked?: boolean;
  isPlaceholder?: boolean;
  isGuide?: boolean;
  isFrame?: boolean;
  frameType?: 'circle' | 'star' | 'hexagon' | 'badge';

  // Type-specific properties (partial - extend as needed)
  text?: string; // for text objects
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  fontStyle?: string;
  textAlign?: string;
  charSpacing?: number; // for text letter spacing
  radius?: number; // for circles
  rx?: number; // for rectangles
  ry?: number;
  points?: Array<{ x: number; y: number }>; // for polygons
  src?: string; // for images
  crossOrigin?: string;
  filters?: any[];

  // Image adjustment properties
  adjustments?: {
    brightness?: number;
    contrast?: number;
    saturation?: number;
  };

  // Group/ActiveSelection
  objects?: SerializedFabricObject[];

  // Any other properties
  [key: string]: any;
}

export type ProjectFilePayload = Partial<ProductAwareProjectPayload<ProjectPage>> & {
  projectName: string;
  pages?: ProjectPage[];
  activePageIndex?: number;
  canvasData?: any;
  assets?: Record<string, string>;
  activeTheme?: ApocapaletteTheme | null;
  lastUpdated: string;
  canvasSize?: { width: number; height: number };
  unitMode?: UnitMode;
};

type CreateProjectOptions = {
  canvasSize?: { width: number; height: number };
  unitMode?: UnitMode;
  name?: string;
  source?: string;
};

// --- UTILITY FUNCTIONS ---
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const formatObjectType = (type: string | undefined) => {
  if (!type) return 'Object';
  return type.replace(/-/g, ' ').split(' ').map(capitalize).join(' ');
};
const buildLayerFromSerializedObject = (obj: SerializedFabricObject): Layer => ({
  id: obj.id || '',
  name: (obj as any).name || formatObjectType(obj.type),
  type: obj.type || 'object',
  visible: obj.visible ?? true,
  movementLocked: !!obj.lockMovementX,
  colorLocked: !!obj.colorLocked,
});

const buildLayerStateFromSerializedObjects = (
    objects: SerializedFabricObject[],
    layersById: Record<string, fabric.Object> = {}
) => {
    const userObjects = enforceSerializedZOrder(objects)
        .filter(isUserObject);
    const nextLayers = userObjects
        .map(buildLayerFromSerializedObject)
        .filter((layer) => layer.id);

    const nextById: Record<string, fabric.Object> = {};
    Object.entries(layersById).forEach(([id, value]) => {
        if (userObjects.some((obj) => obj.id === id)) {
            nextById[id] = value;
        }
    });

    return {
        canvasObjects: userObjects,
        layers: nextLayers,
        layersById: nextById,
    };
};

const getSuggestedLayouts = (objects: SerializedFabricObject[]) => generateSuggestions(objects);
const getValueByPath = (obj: object, path: string): any => {
    return path.split('.').reduce((acc, part) => acc && (acc as any)[part], obj);
};

const sanitizeFileName = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return 'design-space';
    const safe = trimmed
        .replace(/\s+/g, '-')
        .replace(/[^a-zA-Z0-9-_]/g, '')
        .toLowerCase();
    return safe || 'design-space';
};

const isDataUrl = (value: string) => value.startsWith('data:');

const readBlobAsDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
        const result = reader.result;
        if (typeof result === 'string') {
            resolve(result);
        } else {
            reject(new Error('Failed to read blob as data URL.'));
        }
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read blob.'));
    reader.readAsDataURL(blob);
});

const fetchAsDataUrl = async (src: string) => {
    if (typeof fetch !== 'function') {
        throw new Error('Fetch is not available.');
    }
    const response = await fetch(src);
    if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
    }
    const blob = await response.blob();
    return readBlobAsDataUrl(blob);
};

const getImageSource = (image: fabric.Image) => {
    const anyImage = image as any;
    if (typeof anyImage.getSrc === 'function') {
        const src = anyImage.getSrc();
        return typeof src === 'string' ? src : '';
    }
    const src = anyImage.src || anyImage._src;
    return typeof src === 'string' ? src : '';
};

const getImageElement = (image: fabric.Image) => {
    const anyImage = image as any;
    if (typeof anyImage.getElement === 'function') {
        return anyImage.getElement();
    }
    return anyImage._element || null;
};

const loadImageElementWithCors = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image for export: ${src}`));
    img.src = src;
});

const getElementSize = (element: HTMLImageElement | HTMLCanvasElement) => {
    if (element instanceof HTMLCanvasElement) {
        return { width: element.width, height: element.height };
    }
    return {
        width: element.naturalWidth || element.width,
        height: element.naturalHeight || element.height,
    };
};

const elementToDataUrl = async (element: HTMLImageElement | HTMLCanvasElement) => {
    if (typeof document === 'undefined') return null;
    const { width, height } = getElementSize(element);
    if (!width || !height) return null;

    if (typeof OffscreenCanvas !== 'undefined') {
        try {
            const offscreen = new OffscreenCanvas(width, height);
            const ctx = offscreen.getContext('2d');
            if (!ctx) return null;
            ctx.drawImage(element as CanvasImageSource, 0, 0);
            const blob = await offscreen.convertToBlob({ type: 'image/png' });
            return readBlobAsDataUrl(blob);
        } catch {
            // Fall back to DOM canvas below.
        }
    }

    try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(element as CanvasImageSource, 0, 0);
        return canvas.toDataURL('image/png');
    } catch {
        return null;
    }
};

const resolveImageDataUrl = async (image: fabric.Image) => {
    const src = getImageSource(image);
    if (src && isDataUrl(src)) return src;

    const element = getImageElement(image);
    if (element) {
        const elementDataUrl = await elementToDataUrl(element as HTMLImageElement | HTMLCanvasElement);
        if (elementDataUrl) return elementDataUrl;
    }

    if (src) {
        try {
            const corsElement = await loadImageElementWithCors(src);
            const corsDataUrl = await elementToDataUrl(corsElement);
            if (corsDataUrl) return corsDataUrl;
        } catch {
            // Ignore and fall through to fetch.
        }
        return fetchAsDataUrl(src);
    }

    return null;
};

const collectImageObjects = (objects: fabric.Object[]) => {
    const images: fabric.Image[] = [];
    const walk = (obj: fabric.Object) => {
        if (obj.type === 'group' || isActiveSelection(obj)) {
            (obj as fabric.Group).getObjects().forEach(walk);
            return;
        }
        if (obj.type === 'image') {
            images.push(obj as fabric.Image);
        }
    };
    objects.forEach(walk);
    return images;
};

const replaceImageSources = (objects: any[], assets: Record<string, string>): any[] => objects.map((obj) => {
    if (!obj) return obj;
    if (obj.type === 'image') {
        const id = typeof obj.id === 'string' && obj.id.trim().length > 0 ? obj.id : '';
        if (id && assets[id]) {
            return { ...obj, id, src: id };
        }
        return obj;
    }
    if (Array.isArray(obj.objects)) {
        return { ...obj, objects: replaceImageSources(obj.objects, assets) };
    }
    return obj;
});

const getDocumentCanvasSize = () => {
    const { width, height } = useCanvasStore.getState();
    return {
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
    };
};

const getPageBackgroundColor = () => {
    const themeBackground = useThemeStore.getState().canvasBackgroundColor;
    if (themeBackground && themeBackground.toLowerCase() !== 'transparent') {
        return themeBackground;
    }
    return DEFAULT_CANVAS_BACKGROUND;
};

const getSerializedPageBackground = () => {
    const background = getPageBackgroundColor();
    return background && background.toLowerCase() !== 'transparent'
        ? background
        : undefined;
};

const parseCanvasData = (canvasData: unknown) => {
    if (typeof canvasData === 'string') {
        return JSON.parse(canvasData);
    }
    return canvasData;
};

const normalizePageCanvasData = (canvasData: unknown) => {
    const parsed = parseCanvasData(canvasData);
    return parsed && typeof parsed === 'object'
        ? parsed
        : { objects: [], background: getSerializedPageBackground() };
};

const normalizePageSize = (
    size: unknown,
    fallback: { width: number; height: number } = DEFAULT_CANVAS_SIZE
) => {
    const candidate = size as { width?: unknown; height?: unknown } | null | undefined;
    const width = typeof candidate?.width === 'number' && Number.isFinite(candidate.width)
        ? Math.max(1, Math.round(candidate.width))
        : fallback.width;
    const height = typeof candidate?.height === 'number' && Number.isFinite(candidate.height)
        ? Math.max(1, Math.round(candidate.height))
        : fallback.height;
    return { width, height };
};

const getInitialPageLoadData = (
    rawPages: ProjectPage[] | null,
    activePageIndex: number,
    fallbackCanvasData: unknown
) => {
    if (rawPages && rawPages.length > 0) {
        const safeIndex = Math.max(0, Math.min(activePageIndex, rawPages.length - 1));
        const pageCanvasData = rawPages[safeIndex]?.canvasData;
        if (pageCanvasData !== undefined && pageCanvasData !== null) {
            return normalizePageCanvasData(pageCanvasData);
        }
    }
    return normalizePageCanvasData(fallbackCanvasData || { objects: [], background: getSerializedPageBackground() });
};

const buildExportCanvasData = async (canvas: fabric.Canvas) => {
    const imageObjects = collectImageObjects(canvas.getObjects());
    imageObjects.forEach((image) => ensureObjectId(image, canvas));

    const assets: Record<string, string> = {};
    const failedIds: string[] = [];
    for (const image of imageObjects) {
        const id = (image as any).id as string | undefined;
        if (!id) {
            failedIds.push('unknown');
            continue;
        }
        try {
            const dataUrl = await resolveImageDataUrl(image);
            if (!dataUrl) {
                throw new Error(`Image ${id} did not return a data URL.`);
            }
            assets[id] = dataUrl;
        } catch (error) {
            failedIds.push(id);
        }
    }

    const serializedObjects = canvas.getObjects().filter(isPersistableCanvasObject).map(toSerializableObject);
    const objectsWithAssets = replaceImageSources(serializedObjects, assets);
    return {
        canvasData: {
            objects: objectsWithAssets,
            background: getSerializedPageBackground(),
        },
        assets,
        failedAssetIds: failedIds,
    };
};

const collectReferencedImageAssetIds = (canvasData: unknown, target = new Set<string>()) => {
    const parsed = normalizePageCanvasData(canvasData) as { objects?: any[] };
    const visit = (object: any) => {
        if (!object || typeof object !== 'object') return;
        if (object.type === 'image' && typeof object.id === 'string' && object.id.trim()) {
            target.add(object.id);
        }
        if (Array.isArray(object.objects)) {
            object.objects.forEach(visit);
        }
    };
    if (Array.isArray(parsed.objects)) parsed.objects.forEach(visit);
    return target;
};

const prepareProjectPagesForPersistence = (
    pages: ProjectPage[],
    imageAssets: Record<string, string>
) => {
    let nextAssets = imageAssets;
    const nextPages = pages.map((page) => {
        const prepared = prepareCanvasDataForPersistence(
            normalizePageCanvasData(page.canvasData),
            nextAssets
        );
        nextAssets = prepared.imageAssets;
        return { ...page, canvasData: prepared.canvasData };
    });
    return { pages: nextPages, imageAssets: nextAssets };
};

const serializeProjectImageAssets = async (
    imageAssets: Record<string, string>,
    referencedIds: Set<string>
) => {
    const assets: Record<string, string> = {};
    const failedAssetIds: string[] = [];

    for (const id of referencedIds) {
        const source = imageAssets[id];
        if (!source) {
            throw new Error(`Unable to preserve image ${id} because its source is missing.`);
        }
        if (isDataUrl(source)) {
            assets[id] = source;
            continue;
        }
        try {
            assets[id] = await fetchAsDataUrl(source);
        } catch {
            if (source.startsWith('blob:')) {
                throw new Error(`Unable to preserve uploaded image ${id}. Keep the editor open and try again.`);
            }
            assets[id] = source;
            failedAssetIds.push(id);
        }
    }

    return { assets, failedAssetIds };
};

const buildProjectPersistenceData = async (
    canvas: fabric.Canvas,
    pages: ProjectPage[],
    imageAssets: Record<string, string>,
    activePageIndex: number
) => {
    const activeExport = await buildExportCanvasData(canvas);
    const prepared = prepareProjectPagesForPersistence(pages, imageAssets);
    const combinedAssetSources = {
        ...prepared.imageAssets,
        ...activeExport.assets,
    };
    const referencedIds = prepared.pages.reduce(
        (ids, page) => collectReferencedImageAssetIds(page.canvasData, ids),
        new Set<string>()
    );
    const serializedAssets = await serializeProjectImageAssets(combinedAssetSources, referencedIds);
    const activePageCanvasData = prepared.pages[activePageIndex]?.canvasData ?? activeExport.canvasData;

    return {
        pages: prepared.pages,
        runtimeImageAssets: prepared.imageAssets,
        canvasData: activePageCanvasData,
        assets: serializedAssets.assets,
        failedAssetIds: Array.from(new Set([
            ...activeExport.failedAssetIds,
            ...serializedAssets.failedAssetIds,
        ])),
    };
};

const parseProjectCanvasData = (value: unknown, label: string) => {
    let parsed: unknown;
    try {
        parsed = parseCanvasData(value);
    } catch {
        throw new Error(`${label} contains invalid canvas JSON.`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${label} is missing canvas data.`);
    }
    const objects = (parsed as any).objects;
    if (!Array.isArray(objects)) {
        throw new Error(`${label} must contain an objects array.`);
    }
    let objectCount = 0;
    const validateObject = (object: any, depth: number) => {
        objectCount += 1;
        if (objectCount > MAX_OBJECTS_PER_PAGE) {
            throw new Error(`${label} exceeds the ${MAX_OBJECTS_PER_PAGE.toLocaleString()} object limit.`);
        }
        if (depth > MAX_OBJECT_NESTING_DEPTH) {
            throw new Error(`${label} exceeds the maximum object nesting depth.`);
        }
        if (!object || typeof object !== 'object' || Array.isArray(object)) {
            throw new Error(`${label} contains an invalid object.`);
        }
        if (typeof object.type !== 'string' || object.type.trim().length === 0) {
            throw new Error(`${label} contains an object without a valid type.`);
        }
        if (object.objects !== undefined) {
            if (!Array.isArray(object.objects)) {
                throw new Error(`${label} contains invalid grouped objects.`);
            }
            object.objects.forEach((child: any) => validateObject(child, depth + 1));
        }
    };
    objects.forEach((object: any) => validateObject(object, 1));
    return parsed as Record<string, any>;
};

const validateProjectPayloadStructure = (raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Project file must contain a JSON object.');
    }
    const payload = raw as Record<string, any>;
    const validateDimensions = (candidate: any, label: string) => {
        if (candidate === undefined) return;
        const width = Number(candidate?.width);
        const height = Number(candidate?.height);
        if (
            !Number.isFinite(width)
            || width <= 0
            || width > MAX_PAGE_DIMENSION_PX
            || !Number.isFinite(height)
            || height <= 0
            || height > MAX_PAGE_DIMENSION_PX
        ) {
            throw new Error(`${label} has invalid dimensions.`);
        }
    };
    assertSupportedDesignSpaceProjectSchema(payload);
    if (getDesignSpaceProjectEditorMode(payload) !== 'canvas') {
        throw new Error('Document projects must be opened in the document editor.');
    }
    if (payload.assets !== undefined && (
        !payload.assets
        || typeof payload.assets !== 'object'
        || Array.isArray(payload.assets)
        || Object.values(payload.assets).some((value) => typeof value !== 'string')
    )) {
        throw new Error('Project assets must be a map of image sources.');
    }
    if (payload.assets) {
        const embeddedAssetBytes = Object.values(payload.assets)
            .filter((value): value is string => typeof value === 'string' && value.startsWith('data:'))
            .reduce((total, value) => total + value.length, 0);
        if (embeddedAssetBytes > MAX_EMBEDDED_ASSET_STRING_BYTES) {
            throw new Error('Project embedded assets exceed the 100 MB limit.');
        }
    }
    if (payload.pages !== undefined && !Array.isArray(payload.pages)) {
        throw new Error('Project pages must be an array.');
    }
    if (Array.isArray(payload.pages) && payload.pages.length > MAX_PROJECT_PAGES) {
        throw new Error(`Project exceeds the ${MAX_PROJECT_PAGES} page limit.`);
    }
    validateDimensions(payload.canvasSize, 'Project');
    validateDimensions(payload.document?.pageSize, 'Project document');
    if (Array.isArray(payload.pages) && payload.pages.length > 0) {
        payload.pages.forEach((page: any, index: number) => {
            if (!page || typeof page !== 'object' || Array.isArray(page)) {
                throw new Error(`Page ${index + 1} is invalid.`);
            }
            // Canvas data was optional on the original product page schema.
            // Some saved projects kept the active page JSON only at the payload
            // root and used `pages` for page names/sizes. Preserve that contract.
            if (page.canvasData !== undefined && page.canvasData !== null) {
                parseProjectCanvasData(page.canvasData, `Page ${index + 1}`);
            }
            if (page.canvasSize !== undefined) {
                validateDimensions(page.canvasSize, `Page ${index + 1}`);
            }
        });
        const requestedIndex = typeof payload.activePageIndex === 'number'
            ? Math.trunc(payload.activePageIndex)
            : 0;
        const activeIndex = Math.max(0, Math.min(requestedIndex, payload.pages.length - 1));
        const activePageCanvasData = payload.pages[activeIndex]?.canvasData;
        if (activePageCanvasData === undefined || activePageCanvasData === null) {
            parseProjectCanvasData(payload.canvasData, 'Project');
        }
    } else {
        parseProjectCanvasData(payload.canvasData, 'Project');
    }
};

const stageCanvasDataLoad = async (canvasData: any) => {
    if (typeof document === 'undefined') return;
    const element = document.createElement('canvas');
    const stagingCanvas = new fabric.StaticCanvas(element, { width: 1, height: 1 });
    try {
        await stagingCanvas.loadFromJSON(canvasData, reviveCustomFabricProps);
    } finally {
        await Promise.resolve(stagingCanvas.dispose());
        element.remove();
    }
};

const buildProjectFilePayload = (
    legacyPayload: ProjectFilePayload,
    productProjectFields: ProductProjectFields | null,
    options: { projectId?: string; now?: string } = {}
): ProductAwareProjectPayload<ProjectPage> => {
    const currentPageSize = legacyPayload.canvasSize
        ? {
            ...(productProjectFields?.document.pageSize ?? {}),
            width: legacyPayload.canvasSize.width,
            height: legacyPayload.canvasSize.height,
            unitMode: legacyPayload.unitMode ?? productProjectFields?.document.pageSize.unitMode,
        }
        : productProjectFields?.document.pageSize;
    const basePayload = {
        ...(productProjectFields ?? {}),
        ...legacyPayload,
        updatedAt: legacyPayload.lastUpdated,
        metadata: {
            ...(productProjectFields?.metadata ?? {}),
            name: legacyPayload.projectName,
            sourceApp: 'design-space' as const,
        },
        document: productProjectFields?.document
            ? {
                ...productProjectFields.document,
                pageSize: currentPageSize,
            }
            : undefined,
    };

    return normalizeDesignSpaceProjectPayload<ProjectPage>(basePayload, {
        projectName: legacyPayload.projectName,
        projectId: options.projectId ?? productProjectFields?.projectId,
        now: options.now ?? legacyPayload.lastUpdated,
        canvasSize: legacyPayload.canvasSize,
        unitMode: legacyPayload.unitMode,
        activeTheme: legacyPayload.activeTheme,
        defaultBackground: DEFAULT_CANVAS_BACKGROUND,
    });
};

const getPayloadActiveTheme = (payload: ProductAwareProjectPayload<ProjectPage>) =>
    payload.activeTheme && typeof payload.activeTheme === 'object'
        ? (payload.activeTheme as ApocapaletteTheme)
        : null;

const buildLayerStateFromObjects = (
    objects: fabric.Object[],
    canvas?: fabric.Canvas | null
) => {
    const nextLayers: Layer[] = [];
    const nextById: Record<string, fabric.Object> = {};
    const nextCanvasObjects: SerializedFabricObject[] = [];

    objects.forEach((obj) => {
        if (!isUserObject(obj)) return;
        ensureObjectId(obj, canvas ?? undefined);
        const serialized = toSerializableObject(obj) as SerializedFabricObject;
        nextCanvasObjects.push(serialized);
        const layer = buildLayerFromSerializedObject(serialized);
        if (!layer.id) return;
        nextLayers.push(layer);
        nextById[layer.id] = obj;
    });

    return {
        layers: nextLayers,
        layersById: nextById,
        canvasObjects: nextCanvasObjects,
    };
};

// findDefaultTheme moved to useThemeStore.ts

const resolveSelectedObject = (
    canvas: fabric.Canvas | null,
    selectedObjectId: string | null
) => {
    if (!canvas) return null;
    if (selectedObjectId) {
        const byId = canvas.getObjects().find((obj) => (obj as any).id === selectedObjectId);
        if (byId) return byId;
    }
    return canvas.getActiveObject() ?? null;
};

const getSelectableCanvasObjectsById = (canvas: fabric.Canvas | null, ids: string[]) => {
    if (!canvas || ids.length === 0) return [];
    const requestedIds = new Set(ids);
    return canvas.getObjects().filter((obj) => {
        const id = (obj as any).id;
        return typeof id === 'string'
            && requestedIds.has(id)
            && isUserObject(obj)
            && obj.visible !== false
            && obj.selectable !== false;
    });
};

const isSelectableSerializedObject = (object: SerializedFabricObject | null | undefined) =>
    !!object
    && isUserObject(object);

const getSelectionIdsFromCanvas = (canvas: fabric.Canvas | null) => {
    if (!canvas) {
        return { selectedObjectId: null, selectedLayerIds: [] as string[] };
    }
    const activeObject = canvas.getActiveObject();
    if (!activeObject) {
        return { selectedObjectId: null, selectedLayerIds: [] as string[] };
    }
    if (isActiveSelection(activeObject)) {
        const selectedLayerIds = (activeObject as fabric.ActiveSelection)
            .getObjects()
            .filter((obj) => isUserObject(obj) && obj.visible !== false)
            .map((obj) => (obj as any).id)
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
        return { selectedObjectId: null, selectedLayerIds };
    }
    if (!isUserObject(activeObject) || activeObject.visible === false) {
        return { selectedObjectId: null, selectedLayerIds: [] as string[] };
    }
    const id = (activeObject as any).id;
    return typeof id === 'string' && id.trim().length > 0
        ? { selectedObjectId: id, selectedLayerIds: [id] }
        : { selectedObjectId: null, selectedLayerIds: [] as string[] };
};

// --- EDITOR STATE INTERFACE ---
interface EditorState {
  canvas: fabric.Canvas | null;
  canvasReadyState: CanvasReadyState;

  // PHASE 2.1: PRIMARY source of truth for canvas objects
  // Fabric.js canvas is now a RENDER DELEGATE
  canvasObjects: SerializedFabricObject[];

  selectedObjectId: string | null;
  layers: Layer[];
  layersById: Record<string, fabric.Object>;
  selectedLayerIds: string[];
  pendingLayerSyncSelectionIds: string[] | null;
  showGuides: boolean;
  dirtyObjectsRef: Set<string> | null;
  layoutSuggestions: LayoutSuggestion[];
  showCanvasSettingsPanel: boolean;
  showSuggestionSidebar: boolean;
  accessibilitySettings: AccessibilitySettings;
  pendingViewportFit: boolean;

  toastMessage: string | null;
  toast: ToastPayload | null;
  unitMode: UnitMode;
  unitScale: number;
  unitZoom: number;
  zoom: number;
  vpt: number[];
  isPreviewMode: boolean;
  bleedPx: number;
  canvasOffset: { x: number; y: number };
  snapEnabled: boolean;
  gridEnabled: boolean;
  assets: StickerData[];
  templates: Template[];
  userTemplates: Template[];
  imageAssets: Record<string, string>;
  assetRefCount: Map<string, number>;
  projectName: string;
  productProjectFields: ProductProjectFields | null;
  currentLibraryProjectId: string | null;
  pages: ProjectPage[];
  activePageIndex: number;
  isDirty: boolean;
  isProjectPresetsOpen: boolean;
  isProjectQuickOpenOpen: boolean;
  activeTool: EditorTool;
  brushSize: number;
  showOnboarding: boolean;
  layerSyncHandler: (() => void) | null;
  hasLayerSyncHandler: boolean;
  batchDepth: number;
  batchNeedsSync: boolean;
  batchNeedsSave: boolean;
  autoSaveStatus: AutoSaveStatus;
  saveStatus: SaveStatus;
  autoSaveTimer: ReturnType<typeof setTimeout> | null;
  changeRevision: number;

  // PHASE 2.2: Sync Lock Mechanism
  syncLock: {
    isLocked: boolean;
    reason: 'init' | 'theme-apply' | 'undo' | 'redo' | 'batch' | null;
    queuedSync: boolean;
  };

  setCanvas: (canvas: fabric.Canvas | null) => void;
  setCanvasReadyState: (state: CanvasReadyState) => void;
  setSelectedObjectId: (id: string | null) => void;
  setLayers: (objects: fabric.Object[]) => void;
  syncCanvasToStore: (canvasOverride?: fabric.Canvas | null) => void;
  selectObjectById: (id: string | null) => void;
  selectObjectsByIds: (ids: string[]) => void;
  clearSelection: () => void;
  syncSelectionFromCanvas: (canvasOverride?: fabric.Canvas | null) => void;
  removeSelectedObject: () => void;
  alignSelectedObjects: (direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  distributeSelectedObjects: (direction: 'horizontal' | 'vertical') => void;
  groupSelectedObjects: () => void;
  ungroupSelectedObjects: () => void;
  addLayer: (layer: Layer) => void;
  updateLayer: (id: string, partial: Partial<Layer>) => void;
  removeLayer: (id: string) => void;
  setSelectedLayerIds: (ids: string[]) => void;
  setDirtyObjectsRef: (dirtyObjects: Set<string> | null) => void;
  setLayerSyncHandler: (handler: (() => void) | null) => void;
  requestLayerSync: (options?: { force?: boolean }) => void;

  // PHASE 2.1: Canvas objects management (Primary source of truth)
  setCanvasObjects: (objects: SerializedFabricObject[]) => void;
  addObject: (object: SerializedFabricObject, options?: { save?: boolean; select?: boolean }) => void;
  addObjects: (objects: SerializedFabricObject[], options?: { save?: boolean; selectLast?: boolean }) => void;
  updateObject: (id: string, updater: Partial<SerializedFabricObject> | ((object: SerializedFabricObject) => SerializedFabricObject)) => void;
  removeObject: (id: string, options?: { save?: boolean }) => void;

  // PHASE 2.2: Sync Lock Management
  acquireSyncLock: (reason: 'init' | 'theme-apply' | 'undo' | 'redo' | 'batch') => void;
  releaseSyncLock: () => void;

  startBatch: () => void;
  endBatch: () => void;
  markHistoryDirty: () => void;
  consumeHistoryDirty: () => boolean;
  toggleShowGuides: () => void;
  saveState: (options?: { force?: boolean }) => void;
  triggerAutoSave: () => void;
  setToast: (toast: ToastInput | null) => void;
  dismissToast: () => void;
  setToastMessage: (message: string | null) => void;
  setUnitMode: (mode: UnitMode) => void;
  setCanvasBackgroundColor: (color: string, options?: { save?: boolean }) => void;
  setZoom: (zoom: number) => void;
  setVpt: (vpt: number[]) => void;
  setCanvasOffset: (offset: { x: number; y: number }) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setGridEnabled: (enabled: boolean) => void;
  setShowOnboarding: (show: boolean) => void;
  toggleCanvasSettingsPanel: () => void;
  toggleSuggestionSidebar: () => void;
  clearPendingViewportFit: () => void;
  dismissSuggestion: (id: string) => void;
  refreshLayoutSuggestions: () => void;
  applySuggestion: (id: string) => void;
  updateAccessibilitySettings: (settings: Partial<AccessibilitySettings>) => void;
  resetViewCanvas: () => void;
  addAssetToLibrary: (asset: StickerData) => void;
  removeAssetFromLibrary: (id: string) => void;
  setTemplates: (templates: Template[]) => void;
  addImageAsset: (id: string, url: string) => void;
  removeImageAsset: (id: string) => void;
  incrementAssetRef: (id: string) => void;
  decrementAssetRef: (id: string) => void;
  loadTemplate: (template: Template) => void;
  saveCurrentAsTemplate: () => void;
  createProject: (options?: CreateProjectOptions) => void;
  createProjectFromRecipe: (recipeId: ProductRecipeId | string) => Promise<void>;
  startNewProject: (options?: {
    canvasSize?: { width: number; height: number };
    unitMode?: UnitMode;
  }) => void;
  switchToPage: (index: number, options?: { saveCurrent?: boolean }) => Promise<void>;
  addPage: () => Promise<void>;
  deletePage: (index: number) => Promise<void>;
  reorderPages: (from: number, to: number) => void;
  syncActivePageFromCanvas: () => void;
  setDirty: (dirty: boolean) => void;
  downloadProjectFile: () => Promise<void>;
  loadProjectFile: (file: File) => Promise<void>;
  setProjectPresetsOpen: (open: boolean) => void;
  setProjectQuickOpenOpen: (open: boolean) => void;
  setProjectName: (name: string) => void;
  setProductProjectFields: (fields: ProductProjectFields | null) => void;
  renameCurrentProject: (newName: string) => Promise<void>;
  setActiveTool: (tool: EditorTool) => void;
  setBrushSize: (size: number) => void;
  setBrushColor: (color: string) => void;
  
  // Theme Actions
  addThemeToVault: (jsonString: string) => void;
  setActiveBrandCollectionId: (id:string) => void;
  applyTheme: (theme: ApocapaletteTheme) => void;
  resetTheme: () => void;
  toggleMovementLock: (layerId: string) => void;
  toggleColorLock: (layerId: string) => void;
  setObjectFill: (fill: string) => void;
  setObjectThemedFill: (tokenRole: string) => void;
  applyTint: (tokenRole: string) => void;
  resetObjectToDefaultTheme: () => void;

  // Text Effects Actions
  setTextShadow: (shadowParams: { color?: string; blur?: number; offsetX?: number; offsetY?: number }) => void;
  setTextStroke: (strokeParams: { color?: string; width?: number }) => void;
  setTextCharSpacing: (spacing: number) => void;

  // Image Adjustment Actions
  setImageBrightness: (value: number) => void;
  setImageContrast: (value: number) => void;
  setImageSaturation: (value: number) => void;
  setImageAdjustments: (adjustments: { brightness?: number; contrast?: number; saturation?: number }) => void;
  resetImageAdjustments: () => void;

  // Export Actions
  exportCanvas: (options: { format: 'png' | 'jpeg' | 'svg'; quality?: number; multiplier: number; clipToCanvas: boolean }) => Promise<void>;

  // Project Persistence Actions
  saveProject: (name: string) => Promise<void>;
  loadProject: (projectId: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  duplicateProject: (projectId: string, newName: string) => Promise<void>;
  renameProject: (projectId: string, newName: string) => Promise<void>;
  getAllProjects: () => Promise<any[]>;
  updateCurrentProject: () => Promise<void>;
  setAutoSaveStatus: (status: AutoSaveStatus) => void;

  // History Actions
  takeSnapshot: () => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  clearHistory: () => void;

  // UI State
  showHelpModal: boolean;
  setShowHelpModal: (show: boolean) => void;
  showExportModal: boolean;
  setShowExportModal: (show: boolean) => void;

  // Safe Zone State
  showSafeZones: boolean;
  setShowSafeZones: (show: boolean) => void;

  // Stroke and Lock Actions
  setObjectStrokeColor: (color: string) => void;
  setObjectStrokeWidth: (width: number) => void;
  toggleObjectLock: (layerId?: string) => void;

  // Text Formatting Actions
  setTextLineHeight: (lineHeight: number) => void;
}

// Fabric mutates a shared canvas throughout loadFromJSON. Serialize page loads so
// rapid navigation cannot leave page metadata and visible canvas content out of sync.
let pageSwitchQueue: Promise<void> = Promise.resolve();

// --- ZUSTAND STORE IMPLEMENTATION ---
export const useEditorStore = createWithEqualityFn<EditorState>()(
  persist(
    (set, get) => {
        useHistoryStore.getState().setContext({
            getCanvas: () => get().canvas,
            getImageAssets: () => get().imageAssets,
            setImageAssets: (imageAssets) => set({ imageAssets }),
            getAssetRefCount: () => get().assetRefCount,
            setAssetRefCount: (assetRefCount) => set({ assetRefCount }),
            getDirtyObjectsRef: () => get().dirtyObjectsRef,
            requestLayerSync: () => get().requestLayerSync(),
            syncCanvasToStore: () => {
                const canvas = get().canvas;
                if (canvas) get().syncCanvasToStore(canvas);
            },
            setSelectedObjectId: (id) => set({ selectedObjectId: id }),
            clearSelection: () => get().clearSelection(),
            getBackground: () => getSerializedPageBackground(),
            setBackground: (background) => useThemeStore.getState().setCanvasBackgroundColor(background),
            acquireSyncLock: (reason) => get().acquireSyncLock(reason),
            releaseSyncLock: () => get().releaseSyncLock(),
        });

        const resetHistoryToCurrentCanvas = () => {
            const history = useHistoryStore.getState();
            history.resetHistory();
            history.takeSnapshot();
        };

        const markProjectDirty = () => {
            set((state) => ({
                isDirty: true,
                changeRevision: state.changeRevision + 1,
            }));
            get().setAutoSaveStatus('dirty');
            if (get().currentLibraryProjectId) {
                get().triggerAutoSave();
            }
        };

        return ({
            canvas: null,
        canvasReadyState: 'uninitialized',
        canvasObjects: [], // PHASE 2.1: Primary source of truth
        selectedObjectId: null,
        layers: [],
        layersById: {},
        selectedLayerIds: [],
        pendingLayerSyncSelectionIds: null,
        showGuides: true,
        dirtyObjectsRef: null,
        layoutSuggestions: [],
        showCanvasSettingsPanel: false,
        showSuggestionSidebar: true,
        accessibilitySettings: AccessibilityManager.getInstance().getSettings(),
        pendingViewportFit: false,

        toastMessage: null,
        toast: null,
        unitMode: 'in', // Default to inches for print-focused design
        unitScale: unitScaleMap['in'],
        unitZoom: 1,
        zoom: 1,
        vpt: [1, 0, 0, 1, 0, 0],
        isPreviewMode: false,
        bleedPx: 0,
        canvasOffset: { x: 0, y: 0 },
        snapEnabled: true,
        gridEnabled: true,
        assets: [],
        templates: [],
        userTemplates: [],
        imageAssets: {},
        assetRefCount: new Map(),
        projectName: 'Untitled Project',
        productProjectFields: null,
        currentLibraryProjectId: null,
        pages: [{ id: uuidv4(), name: 'Page 1', canvasData: { objects: [], background: DEFAULT_CANVAS_BACKGROUND }, canvasSize: { ...DEFAULT_CANVAS_SIZE }, thumbnail: undefined }],
        activePageIndex: 0,
        isDirty: false,
        isProjectPresetsOpen: false,
        isProjectQuickOpenOpen: false,
        activeTool: 'select',
        brushSize: 8,
        showOnboarding: true,
        layerSyncHandler: null,
        hasLayerSyncHandler: false,
        batchDepth: 0,
        batchNeedsSync: false,
        batchNeedsSave: false,
        autoSaveStatus: 'idle',
        saveStatus: 'saved',
        autoSaveTimer: null,
        changeRevision: 0,
        showHelpModal: false,
        showExportModal: false,
        showSafeZones: false,
        syncLock: {
            isLocked: false,
            reason: null,
            queuedSync: false,
        },

    setCanvas: (canvas) => {
        const currentBackground = useThemeStore.getState().canvasBackgroundColor;
        useThemeStore.getState().setCanvasBackgroundColor(currentBackground ?? null);
        set({ canvas });
        if (!canvas) {
            return;
        }

        // Only apply theme if canvas is ready (not during initialization)
        const { canvasReadyState, saveState, requestLayerSync, syncCanvasToStore, acquireSyncLock, releaseSyncLock } = get();
        const themeData = useThemeStore.getState().themeData;
        if (canvasReadyState === 'ready' && themeData) {
            applyThemeToCanvas(canvas, themeData, {
                saveState,
                requestLayerSync,
                syncCanvasToStore,
                acquireSyncLock,
                releaseSyncLock,
            });
        }

        if (!get().hasLayerSyncHandler) {
            return;
        }

        // Only sync if canvas is ready
        if (canvasReadyState === 'ready') {
            get().requestLayerSync();
        }
    },
    setCanvasReadyState: (state) => set({ canvasReadyState: state }),
    setSelectedObjectId: (id) => set({ selectedObjectId: id }),
    setSelectedLayerIds: (ids) => set({ selectedLayerIds: ids }),
    setDirtyObjectsRef: (dirtyObjects) => set({ dirtyObjectsRef: dirtyObjects }),
    clearSelection: () => {
        const { canvas } = get();
        if (canvas) {
            canvas.discardActiveObject();
            canvas.requestRenderAll();
        }
        setPendingLayerSyncSelectionIds(null);
        setPendingInsertionCandidateIds(null);
        set({ selectedObjectId: null, selectedLayerIds: [], pendingLayerSyncSelectionIds: null });
    },
    selectObjectById: (id) => {
        if (!id) {
            get().clearSelection();
            return;
        }
        const { canvas } = get();
        const object = getSelectableCanvasObjectsById(canvas, [id])[0];
        if (!canvas || !object) {
            setPendingLayerSyncSelectionIds(null);
            setPendingInsertionCandidateIds(null);
            set({ selectedObjectId: null, selectedLayerIds: [], pendingLayerSyncSelectionIds: null });
            return;
        }
        if (canvas.getActiveObject() !== object) {
            canvas.discardActiveObject();
            canvas.setActiveObject(object);
        }
        canvas.requestRenderAll();
        setPendingLayerSyncSelectionIds(null);
        setPendingInsertionCandidateIds(null);
        set({ selectedObjectId: id, selectedLayerIds: [id], pendingLayerSyncSelectionIds: null });
    },
    selectObjectsByIds: (ids) => {
        const uniqueIds = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.trim().length > 0)));
        const { canvas } = get();
        if (!canvas || uniqueIds.length === 0) {
            get().clearSelection();
            return;
        }
        const objects = getSelectableCanvasObjectsById(canvas, uniqueIds);
        const selectedLayerIds = objects
            .map((obj) => (obj as any).id)
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

        if (objects.length === 0) {
            get().clearSelection();
            return;
        }

        canvas.discardActiveObject();
        if (objects.length === 1) {
            canvas.setActiveObject(objects[0]);
            setPendingLayerSyncSelectionIds(null);
            setPendingInsertionCandidateIds(null);
            set({ selectedObjectId: selectedLayerIds[0] ?? null, selectedLayerIds, pendingLayerSyncSelectionIds: null });
        } else {
            const selection = new fabric.ActiveSelection(objects, { canvas });
            canvas.setActiveObject(selection);
            setPendingLayerSyncSelectionIds(null);
            setPendingInsertionCandidateIds(null);
            set({ selectedObjectId: null, selectedLayerIds, pendingLayerSyncSelectionIds: null });
        }
        canvas.requestRenderAll();
    },
    syncSelectionFromCanvas: (canvasOverride) => {
        const canvas = canvasOverride ?? get().canvas;
        const selection = getSelectionIdsFromCanvas(canvas);
        if (canvas && selection.selectedLayerIds.length === 0 && canvas.getActiveObject()) {
            canvas.discardActiveObject();
            canvas.requestRenderAll();
        }
        set(selection);
    },
    setLayers: (objects) => {
        const nextState = buildLayerStateFromObjects(objects, get().canvas);
        set(nextState);
    },
    syncCanvasToStore: (canvasOverride) => {
        const targetCanvas = canvasOverride ?? get().canvas;
        if (!targetCanvas) return;
        const objects = targetCanvas.getObjects();
        const nextState = buildLayerStateFromObjects(objects, targetCanvas);
        set({ ...nextState, layoutSuggestions: getSuggestedLayouts(nextState.canvasObjects) });
    },
    removeSelectedObject: () => {
        const { canvas, clearSelection, requestLayerSync, saveState, syncCanvasToStore } = get();
        if (!canvas) {
            set({ toastMessage: 'Editor canvas is not ready. Please try again.' });
            return;
        }
        const activeObject = canvas.getActiveObject();
        if (!activeObject) return;

        if (isActiveSelection(activeObject)) {
            const selection = activeObject as fabric.ActiveSelection;
            selection.getObjects().forEach((obj) => canvas.remove(obj));
        } else {
            canvas.remove(activeObject);
        }

        clearSelection();
        commitCanvasMutation(canvas, { syncCanvasToStore, saveState, requestLayerSync }, { render: false });
    },
    alignSelectedObjects: (direction) => {
        const { canvas, startBatch, endBatch } = get();
        if (!canvas) {
            set({ toastMessage: 'Editor canvas is not ready. Please try again.' });
            return;
        }
        startBatch();
        switch (direction) {
            case 'left':
                alignLeft(canvas);
                break;
            case 'center':
                alignCenter(canvas);
                break;
            case 'right':
                alignRight(canvas);
                break;
            case 'top':
                alignTop(canvas);
                break;
            case 'middle':
                alignMiddle(canvas);
                break;
            case 'bottom':
                alignBottom(canvas);
                break;
            default:
                break;
        }
        endBatch();
    },
    distributeSelectedObjects: (direction) => {
        const { canvas } = get();
        if (!canvas) {
            set({ toastMessage: 'Editor canvas is not ready. Please try again.' });
            return;
        }
        if (direction === 'horizontal') {
            distributeHorizontally(canvas);
        } else {
            distributeVertically(canvas);
        }
    },
    groupSelectedObjects: () => {
        const { canvas, syncCanvasToStore } = get();
        if (!canvas) {
            set({ toastMessage: 'Editor canvas is not ready. Please try again.' });
            return;
        }
        groupObjects(canvas);
        syncCanvasToStore(canvas);
    },
    ungroupSelectedObjects: () => {
        const { canvas, syncCanvasToStore } = get();
        if (!canvas) {
            set({ toastMessage: 'Editor canvas is not ready. Please try again.' });
            return;
        }
        ungroupObjects(canvas);
        syncCanvasToStore(canvas);
    },
    addLayer: (_layer) => {
        get().requestLayerSync();
    },
    updateLayer: (_id, _partial) => {
        get().requestLayerSync();
    },
    removeLayer: (_id) => {
        get().requestLayerSync();
    },
    setLayerSyncHandler: (handler) => {
        set({ layerSyncHandler: handler, hasLayerSyncHandler: !!handler });
        if (handler && get().canvas) {
            get().requestLayerSync();
        }
    },
    startBatch: () => {
        set((state) => ({ batchDepth: state.batchDepth + 1 }));
    },
    endBatch: () => {
        const { batchDepth, batchNeedsSync, batchNeedsSave } = get();
        const nextDepth = Math.max(0, batchDepth - 1);
        set({ batchDepth: nextDepth });
        if (nextDepth === 0) {
            if (batchNeedsSync) {
                set({ batchNeedsSync: false });
                get().requestLayerSync({ force: true });
            }
            if (batchNeedsSave) {
                set({ batchNeedsSave: false });
                get().saveState({ force: true });
            }
        }
    },
    requestLayerSync: (options) => {
        // PHASE 2.2: Check sync lock first
        const { syncLock, batchDepth, layerSyncHandler } = get();
        if (syncLock.isLocked && !options?.force) {
            set({ syncLock: { ...syncLock, queuedSync: true } });
            return;
        }

        if (batchDepth > 0 && !options?.force) {
            set({ batchNeedsSync: true });
            return;
        }
        if (layerSyncHandler) layerSyncHandler();
    },

    // PHASE 2.2: Sync Lock Management Actions
    acquireSyncLock: (reason) => {
        const { syncLock } = get();
        if (syncLock.isLocked) {
            console.warn(`[Phase 2.2] Sync lock already held by "${syncLock.reason}", cannot acquire for "${reason}"`);
            return;
        }
        set({ syncLock: { isLocked: true, reason, queuedSync: false } });
    },

    releaseSyncLock: () => {
        const { syncLock } = get();
        if (!syncLock.isLocked) {
            console.warn('[Phase 2.2] Attempted to release sync lock, but lock is not held');
            return;
        }

        const hadQueuedSync = syncLock.queuedSync;
        set({ syncLock: { isLocked: false, reason: null, queuedSync: false } });

        // If sync was queued while locked, execute it now
        if (hadQueuedSync) {
            get().requestLayerSync({ force: true });
        }
    },

    setCanvasObjects: (objects) => {
        const nextState = buildLayerStateFromSerializedObjects(objects, get().layersById);
        set({ ...nextState, layoutSuggestions: getSuggestedLayouts(nextState.canvasObjects) });
        get().requestLayerSync();
    },
    addObject: (object, options) => {
        const baseObject = withManifestZIndex(object, object.zIndex as CanvasLayer | undefined);
        const shouldSelect = options?.select !== false && !!baseObject.id && isSelectableSerializedObject(baseObject);
        const nextObject = {
            ...baseObject,
            ...(shouldSelect ? { __selectOnInsert: true } : {}),
        } as SerializedFabricObject;
        const nextState = buildLayerStateFromSerializedObjects([...get().canvasObjects, nextObject], get().layersById);
        set({
            ...nextState,
            layoutSuggestions: getSuggestedLayouts(nextState.canvasObjects),
            selectedObjectId: shouldSelect ? nextObject.id! : null,
            selectedLayerIds: shouldSelect ? [nextObject.id!] : [],
            pendingLayerSyncSelectionIds: shouldSelect ? [nextObject.id!] : [],
        });
        setPendingLayerSyncSelectionIds(shouldSelect ? [nextObject.id!] : null);
        if (!shouldSelect) {
            const { canvas } = get();
            if (canvas?.getActiveObject()) {
                canvas.discardActiveObject();
                canvas.requestRenderAll();
            }
        }
        get().requestLayerSync();
        if (shouldSelect && nextObject.id) {
            finalizeInsertionSelection(nextObject.id);
        }
        if (options?.save !== false) {
            get().saveState();
        }
    },
    addObjects: (objects, options) => {
        if (objects.length === 0) return;
        const nextObjects = objects.map((object, index) =>
            withManifestZIndex(
                object,
                object.zIndex as CanvasLayer | undefined
                    ?? (index === 0 ? ZIndexLayer.Content : undefined)
            )
        );
        const selectionCandidate = options?.selectLast !== false
            ? [...nextObjects].reverse().find((object) => object.id && isSelectableSerializedObject(object))
            : null;
        const nextObjectsWithSelection = nextObjects.map((object) => (
            selectionCandidate?.id && object.id === selectionCandidate.id
                ? ({ ...object, __selectOnInsert: true } as SerializedFabricObject)
                : object
        ));
        const nextState = buildLayerStateFromSerializedObjects([...get().canvasObjects, ...nextObjectsWithSelection], get().layersById);
        set({
            ...nextState,
            layoutSuggestions: getSuggestedLayouts(nextState.canvasObjects),
            selectedObjectId: selectionCandidate?.id ?? null,
            selectedLayerIds: selectionCandidate?.id ? [selectionCandidate.id] : [],
            pendingLayerSyncSelectionIds: selectionCandidate?.id ? [selectionCandidate.id] : [],
        });
        setPendingLayerSyncSelectionIds(selectionCandidate?.id ? [selectionCandidate.id] : null);
        if (!selectionCandidate?.id) {
            const { canvas } = get();
            if (canvas?.getActiveObject()) {
                canvas.discardActiveObject();
                canvas.requestRenderAll();
            }
        }
        get().requestLayerSync();
        if (selectionCandidate?.id) {
            finalizeInsertionSelection(selectionCandidate.id);
        }
        if (options?.save !== false) {
            get().saveState();
        }
    },
    updateObject: (id, updater) => {
        const nextObjects = get().canvasObjects.map((object) => {
            if (object.id !== id) return object;
            const nextObject = typeof updater === 'function' ? updater(object) : { ...object, ...updater };
            return withManifestZIndex(nextObject, nextObject.zIndex as CanvasLayer | undefined);
        });
        const nextState = buildLayerStateFromSerializedObjects(nextObjects, get().layersById);
        set({ ...nextState, layoutSuggestions: getSuggestedLayouts(nextState.canvasObjects) });
        get().requestLayerSync();
        get().saveState();
    },
    removeObject: (id, options) => {
        const nextObjects = get().canvasObjects.filter((object) => object.id !== id);
        const nextState = buildLayerStateFromSerializedObjects(nextObjects, get().layersById);
        const selectionWasRemoved = get().selectedLayerIds.includes(id) || get().selectedObjectId === id;
        set({
            ...nextState,
            layoutSuggestions: getSuggestedLayouts(nextState.canvasObjects),
            selectedObjectId: get().selectedObjectId === id ? null : get().selectedObjectId,
            selectedLayerIds: get().selectedLayerIds.filter((layerId) => layerId !== id),
        });
        if (selectionWasRemoved) {
            get().clearSelection();
        }
        get().requestLayerSync();
        if (options?.save !== false) {
            get().saveState();
        }
    },

    markHistoryDirty: () => {
        useHistoryStore.getState().markHistoryDirty();
    },
    consumeHistoryDirty: () => {
        return useHistoryStore.getState().consumeHistoryDirty();
    },
    toggleShowGuides: () => set((state) => ({ showGuides: !state.showGuides })),
    setToast: (toast) => {
        if (!toast) {
            set({ toast: null, toastMessage: null });
            return;
        }
        if (typeof toast === 'string') {
            const normalizedToast: ToastPayload = {
                id: uuidv4(),
                message: toast,
                variant: 'info',
                durationMs: 3000,
            };
            set({ toast: normalizedToast, toastMessage: toast });
            return;
        }

        const variant = toast.variant ?? 'info';
        const normalizedToast: ToastPayload = {
            id: uuidv4(),
            message: toast.message,
            variant,
            details: toast.details,
            action: toast.action,
            durationMs:
                typeof toast.durationMs === 'number'
                    ? toast.durationMs
                    : (variant === 'error' ? undefined : 3000),
        };
        set({ toast: normalizedToast, toastMessage: toast.message });
    },
    dismissToast: () => set({ toast: null, toastMessage: null }),
    setToastMessage: (message) => {
        if (!message) {
            get().dismissToast();
            return;
        }
        get().setToast(message);
    },
    setUnitMode: (mode) => {
        coordinateSystem.setMode(mode);
    },
    setCanvasBackgroundColor: (color, options) => {
        const { canvas, saveState } = get();
        // Delegate to theme store (single source of truth) before history reads background.
        useThemeStore.getState().setCanvasBackgroundColor(color);
        if (canvas) {
            canvas.backgroundColor = 'transparent';
            canvas.requestRenderAll();
            if (options?.save !== false) {
                saveState();
            }
        }
    },
    setZoom: (zoom) => {
        coordinateSystem.setZoom(zoom);
    },
    setVpt: (vpt) => set({ vpt }),
    setCanvasOffset: (offset) => set({ canvasOffset: offset }),
    setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
    setGridEnabled: (enabled) => {
        set({ gridEnabled: enabled });
        const { canvas } = get();
        if (canvas) {
            canvas.requestRenderAll();
        }
    },
    setShowOnboarding: (show) => set({ showOnboarding: show }),
    toggleCanvasSettingsPanel: () => set((state) => ({ showCanvasSettingsPanel: !state.showCanvasSettingsPanel })),
    toggleSuggestionSidebar: () => set((state) => ({ showSuggestionSidebar: !state.showSuggestionSidebar })),
    dismissSuggestion: (id) => set((state) => ({
        layoutSuggestions: state.layoutSuggestions.filter((suggestion) => suggestion.id !== id),
    })),
    refreshLayoutSuggestions: () => set((state) => ({
        layoutSuggestions: getSuggestedLayouts(state.canvasObjects),
    })),
    applySuggestion: (id) => {
        const suggestion = get().layoutSuggestions.find((entry) => entry.id === id);
        if (!suggestion) return;
        const nextObjects = applySuggestionToObjects(get().canvasObjects, suggestion);
        const nextState = buildLayerStateFromSerializedObjects(nextObjects, get().layersById);
        set({
            ...nextState,
            layoutSuggestions: getSuggestedLayouts(nextState.canvasObjects).filter((entry) => entry.id !== id),
        });
        get().requestLayerSync();
        get().saveState();
    },
    updateAccessibilitySettings: (settings) => {
        const manager = AccessibilityManager.getInstance();
        manager.updateSettings(settings);
        set({ accessibilitySettings: manager.getSettings() });
    },
    resetViewCanvas: () => {
        const { canvas } = get();
        if (!canvas) return;
        fitCanvasToViewport(canvas.getWidth(), canvas.getHeight());
    },
    addAssetToLibrary: (asset) => {
        const normalized: StickerData = {
            id: asset.id || uuidv4(),
            url: asset.url,
            tags: asset.tags ?? [],
            format: asset.format,
            svg: asset.svg,
            label: asset.label,
        };
        set((state) => {
            const alreadyExists = state.assets.some((item) => item.url === normalized.url);
            const nextAssets = alreadyExists ? state.assets : [normalized, ...state.assets];
            return { assets: nextAssets };
        });
    },
    removeAssetFromLibrary: (id) => {
        set((state) => ({
            assets: state.assets.filter((asset) => asset.id !== id),
        }));
    },
    setTemplates: (templates) => set({ templates }),
    addImageAsset: (id, url) => {
        if (!id || !url) return;
        set((state) => ({
            imageAssets: {
                ...state.imageAssets,
                [id]: url,
            },
        }));
    },
    removeImageAsset: (id) => {
        if (!id) return;
        set((state) => {
            if (!state.imageAssets[id]) return state;
            const { [id]: _, ...rest } = state.imageAssets;
            return { imageAssets: rest };
        });
    },
    incrementAssetRef: (id) => {
        if (!id) return;
        set((state) => {
            const counts = new Map<string, number>([[id, 1]]);
            const { nextRefCount, nextAssets } = applyAssetRefCounts(
                state.assetRefCount,
                state.imageAssets,
                counts,
                1
            );
            return {
                assetRefCount: nextRefCount,
                imageAssets: nextAssets,
            };
        });
    },
    decrementAssetRef: (id) => {
        if (!id) return;
        set((state) => {
            const counts = new Map<string, number>([[id, 1]]);
            const { nextRefCount, nextAssets } = applyAssetRefCounts(
                state.assetRefCount,
                state.imageAssets,
                counts,
                -1
            );
            return {
                assetRefCount: nextRefCount,
                imageAssets: nextAssets,
            };
        });
    },
    setProjectPresetsOpen: (open) => set({ isProjectPresetsOpen: open }),
    setProjectQuickOpenOpen: (open) => set({ isProjectQuickOpenOpen: open }),
    clearPendingViewportFit: () => set({ pendingViewportFit: false }),
    setProjectName: (name) => set({ projectName: name }),
    setProductProjectFields: (fields) => set({ productProjectFields: fields }),
    renameCurrentProject: async (newName) => {
        const safeName = newName.trim() || 'Untitled Project';
        set({ projectName: safeName });
        const { currentLibraryProjectId } = get();
        if (currentLibraryProjectId) {
            try {
                const { db } = await import('../db');
                await db.renameProject(currentLibraryProjectId, safeName);
            } catch (error) {
                console.error('[renameCurrentProject] Failed to persist name change:', error);
            }
        }
    },
    setActiveTool: (tool) => set({ activeTool: tool }),
    setBrushSize: (size) => set({ brushSize: size }),
    setBrushColor: (color) => useThemeStore.getState().setBrushColor(color),
    loadTemplate: (template) => {
        const {
            canvas,
            requestLayerSync,
            applyTheme,
            setToastMessage,
            resetViewCanvas,
            setLayers,
            clearSelection,
        } = get();
        if (!canvas) return;
        const { brandVault, themeData } = useThemeStore.getState();

        setLayers([]);
        clearSelection();
        canvas.clear();
        const templateCanvasData = normalizePageCanvasData(template.canvasData);
        useThemeStore.getState().setCanvasBackgroundColor(
            typeof (templateCanvasData as any)?.background === 'string'
                ? (templateCanvasData as any).background
                : null
        );

        const nextWidth = template.canvasSize?.width;
        const nextHeight = template.canvasSize?.height;
        if (
            typeof nextWidth === 'number'
            && Number.isFinite(nextWidth)
            && typeof nextHeight === 'number'
            && Number.isFinite(nextHeight)
        ) {
            const normalizedWidth = Math.max(1, Math.round(nextWidth));
            const normalizedHeight = Math.max(1, Math.round(nextHeight));
            resizeCanvas(normalizedWidth, normalizedHeight, {
                save: false,
                skipRender: true,
            });
            useCanvasStore.getState().clearPendingSize();
        }
        if (template.unitMode) {
            get().setUnitMode(template.unitMode);
        }

        const themeToApply = template.defaultThemeId
            ? brandVault.find((brand) => brand.id === template.defaultThemeId)
            : null;

        canvas.loadFromJSON(templateCanvasData, reviveCustomFabricProps).then(() => {
            canvas.backgroundColor = 'transparent';
            resetViewCanvas();
            sanityCheckCanvas(canvas, themeToApply?.themeData ?? themeData);
            clearSelection();
            commitCanvasMutation(canvas, {
                syncCanvasToStore: get().syncCanvasToStore,
                saveState: get().saveState,
                requestLayerSync,
            });
            setToastMessage(`Template loaded: ${template.name}`);

            if (template.defaultThemeId) {
                if (themeToApply) {
                    applyTheme(themeToApply.themeData);
                    setToastMessage(`Applied template theme: ${themeToApply.name}`);
                } else {
                    setToastMessage(`Template theme not found: ${template.defaultThemeId}`);
                }
            }

            });
    },
    saveCurrentAsTemplate: () => {
        const { canvas, userTemplates, unitMode } = get();
        const { activeBrandCollectionId } = useThemeStore.getState();
        if (!canvas) return;
        const serializedObjects = canvas.getObjects().filter(isPersistableCanvasObject).map(toSerializableObject);
        const documentSize = getDocumentCanvasSize();
        const json = {
            objects: serializedObjects,
            background: getSerializedPageBackground(),
        };
        const thumbnail = canvas.toDataURL({ multiplier: 0.1 });
        const newTemplate: Template = {
            id: uuidv4(),
            name: `Template ${new Date().toISOString()}`,
            canvasData: JSON.stringify(json),
            defaultThemeId: activeBrandCollectionId || '',
            thumbnail,
            canvasSize: {
                width: documentSize.width,
                height: documentSize.height,
            },
            unitMode,
        };
        const nextTemplates = [newTemplate, ...userTemplates];
        set({ userTemplates: nextTemplates, toastMessage: `Saved template: ${newTemplate.name}` });
    },

    createProject: (options) => {
        const {
            canvas,
            pages,
            isDirty,
            requestLayerSync,
            setUnitMode,
        } = get();
        const canResetExistingPages = options?.source === 'project-presets-modal-confirmed'
            || options?.source === 'load-project-file'
            || options?.source === 'load-project-db';
        const hasExistingPageContent = pages.some((page) =>
            Array.isArray(page?.canvasData?.objects)
            && page.canvasData.objects.some(isUserObject)
        );
        if ((hasExistingPageContent || isDirty) && !canResetExistingPages) {
            return;
        }
        const nextWidth = options?.canvasSize?.width ?? DEFAULT_CANVAS_SIZE.width;
        const nextHeight = options?.canvasSize?.height ?? DEFAULT_CANVAS_SIZE.height;
        const nextUnitMode = options?.unitMode ?? 'in';
        const normalizedName = options?.name?.trim();
        const nextProjectName = normalizedName && normalizedName.length > 0
            ? normalizedName
            : 'Untitled Project';
        const shouldHideOnboarding = options?.source === 'project-presets-modal-confirmed';

        if (canvas) {
            get().clearSelection();
            set({
                canvasObjects: [],
                layers: [],
                layersById: {},
                selectedObjectId: null,
                selectedLayerIds: [],
            });
            canvas.clear();

            resizeCanvas(nextWidth, nextHeight, { save: false, skipRender: true });
            setUnitMode(nextUnitMode);

            requestLayerSync({ force: true });
        } else {
            useCanvasStore.getState().setCanvasSize(nextWidth, nextHeight);
        }

        // Initialize default theme from theme store
        useThemeStore.getState().initializeDefaultTheme();
        applyActiveThemeToCanvas();

        // Reset canvas background in theme store
        useThemeStore.getState().setCanvasBackgroundColor(null);

        set({
            projectName: nextProjectName,
            productProjectFields: null,
            currentLibraryProjectId: null,
            pages: [{
                id: uuidv4(),
                name: 'Page 1',
                canvasData: { objects: [], background: DEFAULT_CANVAS_BACKGROUND },
                canvasSize: { width: nextWidth, height: nextHeight },
            }],
            activePageIndex: 0,
            isDirty: false,
            isProjectPresetsOpen: false,
            showOnboarding: shouldHideOnboarding ? false : get().showOnboarding,
            pendingViewportFit: shouldHideOnboarding,
            autoSaveStatus: 'idle',
            saveStatus: 'saved',
        });
        resetHistoryToCurrentCanvas();

    },
    createProjectFromRecipe: async (recipeId) => {
        const {
            canvas,
            clearSelection,
            requestLayerSync,
            resetViewCanvas,
            setToastMessage,
        } = get();
        if (!canvas) {
            setToastMessage('Editor canvas is not ready. Please try again.');
            return;
        }

        const { themeData, activeBrandCollectionId, brandVault } = useThemeStore.getState();
        const activeTheme = themeData
            || brandVault.find((brand) => brand.id === activeBrandCollectionId)?.themeData
            || null;

        try {
            const generatedProject = generateProjectFromRecipe(recipeId, {
                theme: activeTheme,
                themeId: activeBrandCollectionId ?? undefined,
            });
            const firstPage = generatedProject.pages[0];
            if (!firstPage?.canvasData) {
                throw new Error(`Recipe did not generate a usable first page: ${recipeId}`);
            }

            clearSelection();
            canvas.clear();
            resizeCanvas(generatedProject.document.pageSize.width, generatedProject.document.pageSize.height, {
                save: false,
                skipRender: true,
            });
            get().setUnitMode(generatedProject.document.pageSize.unitMode);
            useCanvasStore.getState().clearPendingSize();
            useThemeStore.getState().setThemeData(generatedProject.activeTheme as ApocapaletteTheme);
            useThemeStore.getState().setActiveBrandCollectionId(activeBrandCollectionId ?? null);
            useThemeStore.getState().setCanvasBackgroundColor(
                typeof firstPage.canvasData.background === 'string'
                    ? firstPage.canvasData.background
                    : generatedProject.document.background?.value ?? null
            );

            await canvas.loadFromJSON(firstPage.canvasData, reviveCustomFabricProps);
            canvas.backgroundColor = 'transparent';
            get().syncCanvasToStore(canvas);
            resetViewCanvas();
            sanityCheckCanvas(canvas, generatedProject.activeTheme as ApocapaletteTheme | null);
            clearSelection();

            set({
                projectName: generatedProject.projectName,
                productProjectFields: extractProductProjectFields(generatedProject),
                currentLibraryProjectId: null,
                imageAssets: {},
                assetRefCount: new Map(),
                pages: generatedProject.pages as ProjectPage[],
                activePageIndex: 0,
                isDirty: true,
                isProjectPresetsOpen: false,
                showOnboarding: false,
                pendingViewportFit: true,
                autoSaveStatus: 'dirty',
                saveStatus: 'unsaved',
            });
            requestLayerSync({ force: true });
            canvas.requestRenderAll();
            resetHistoryToCurrentCanvas();
            setToastMessage(`Created project: ${generatedProject.productMetadata?.title ?? generatedProject.projectName}`);
        } catch (error) {
            console.error('[createProjectFromRecipe] Failed to generate recipe project:', error);
            setToastMessage('Failed to create recipe project.');
        }
    },
    startNewProject: (options) => {
        get().createProject(options);
    },

    syncActivePageFromCanvas: () => {
        const { canvas, pages, activePageIndex, imageAssets } = get();
        if (!canvas || !pages[activePageIndex]) return;
        const serializedObjects = canvas.getObjects().filter(isPersistableCanvasObject).map(toSerializableObject);
        const rawData = { objects: serializedObjects, background: getSerializedPageBackground() };
        const prepared = prepareCanvasDataForPersistence(rawData, imageAssets);
        const documentSize = getDocumentCanvasSize();
        const nextPages = [...pages];
        nextPages[activePageIndex] = {
          ...nextPages[activePageIndex],
          canvasData: prepared.canvasData,
          canvasSize: documentSize,
          thumbnail: canvas.toDataURL({ format: 'png', multiplier: 0.1, quality: 0.7 }),
        };
        set({ pages: nextPages, imageAssets: prepared.imageAssets });
    },
    switchToPage: (index, options) => {
        const performSwitch = async () => {
            const { canvas, pages } = get();
            if (!canvas || index < 0 || index >= pages.length) return;
            if (options?.saveCurrent !== false) {
                get().syncActivePageFromCanvas();
            }
            const page = get().pages[index];
            if (!page) return;
            const hydrated = hydrateCanvasDataWithAssets(page.canvasData, get().imageAssets);
            await canvas.loadFromJSON(hydrated, reviveCustomFabricProps);
            const nextSize = normalizePageSize(page.canvasSize, getDocumentCanvasSize());
            resizeCanvas(nextSize.width, nextSize.height, {
                save: false,
                resetViewport: false,
            });
            const pageBackground =
                typeof (page.canvasData as any)?.background === 'string'
                    ? (page.canvasData as any).background
                    : null;
            useThemeStore.getState().setCanvasBackgroundColor(pageBackground);
            canvas.backgroundColor = 'transparent';
            get().clearSelection();
            get().syncCanvasToStore(canvas);
            set({ activePageIndex: index });
            get().requestLayerSync({ force: true });
            canvas.requestRenderAll();
            resetHistoryToCurrentCanvas();
        };

        const queuedSwitch = pageSwitchQueue.then(performSwitch, performSwitch);
        pageSwitchQueue = queuedSwitch.catch(() => undefined);
        return queuedSwitch;
    },
    addPage: async () => {
        get().syncActivePageFromCanvas();
        const next = { id: uuidv4(), name: `Page ${get().pages.length + 1}`, canvasData: { objects: [], background: DEFAULT_CANVAS_BACKGROUND }, canvasSize: { ...DEFAULT_CANVAS_SIZE } };
        set((state) => ({ pages: [...state.pages, next] }));
        await get().switchToPage(get().pages.length - 1);
        markProjectDirty();
    },
    deletePage: async (index) => {
        const { pages, activePageIndex } = get();
        if (pages.length <= 1) return;
        get().syncActivePageFromCanvas();
        const nextPages = pages.filter((_, i) => i !== index);
        let nextIndex = activePageIndex;
        if (activePageIndex >= nextPages.length) nextIndex = nextPages.length - 1;
        if (index < activePageIndex) nextIndex -= 1;
        const safeNextIndex = Math.max(0, nextIndex);
        set({ pages: nextPages, activePageIndex: safeNextIndex });
        await get().switchToPage(safeNextIndex, { saveCurrent: false });
        markProjectDirty();
    },
    reorderPages: (from, to) => {
        const { pages, activePageIndex } = get();
        if (from === to || from < 0 || to < 0 || from >= pages.length || to >= pages.length) return;
        const next = [...pages];
        const [m] = next.splice(from, 1);
        next.splice(to, 0, m);
        let nextActive = activePageIndex;
        if (activePageIndex === from) nextActive = to;
        else if (from < activePageIndex && to >= activePageIndex) nextActive -= 1;
        else if (from > activePageIndex && to <= activePageIndex) nextActive += 1;
        set({ pages: next, activePageIndex: nextActive });
        markProjectDirty();
    },
    downloadProjectFile: async () => {
        const {
            canvas,
            projectName,
            setToastMessage,
            unitMode,
        } = get();
        if (!canvas) return;
        const { themeData, activeBrandCollectionId, brandVault } = useThemeStore.getState();

        const fallbackTheme = themeData
            || brandVault.find((brand) => brand.id === activeBrandCollectionId)?.themeData
            || null;

        get().syncActivePageFromCanvas();
        let exportData: Awaited<ReturnType<typeof buildProjectPersistenceData>>;
        try {
            exportData = await buildProjectPersistenceData(
                canvas,
                get().pages,
                get().imageAssets,
                get().activePageIndex
            );
        } catch (error) {
            const message = error instanceof Error && error.message
                ? error.message
                : 'Failed to prepare project for export.';
            setToastMessage(message);
            return;
        }

        const savedAt = new Date().toISOString();
        const payload = buildProjectFilePayload({
            projectName: projectName || 'Untitled Project',
            pages: exportData.pages,
            activePageIndex: get().activePageIndex,
            canvasData: exportData.canvasData,
            assets: exportData.assets,
            activeTheme: fallbackTheme,
            lastUpdated: savedAt,
            canvasSize: getDocumentCanvasSize(),
            unitMode,
        }, get().productProjectFields, { now: savedAt });

        const json = JSON.stringify(payload, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${sanitizeFileName(projectName)}.apocaproject.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        set({
            productProjectFields: extractProductProjectFields(payload),
            pages: exportData.pages,
            imageAssets: exportData.runtimeImageAssets,
        });
        get().setAutoSaveStatus('saved');
        set({ isDirty: false });
        if (exportData.failedAssetIds.length > 0) {
            setToastMessage(
                `Saved project with ${exportData.failedAssetIds.length} linked image(s). Some images may require network access when reopened.`
            );
        } else {
            setToastMessage(`Saved project: ${payload.projectName}`);
        }
    },

    loadProjectFile: async (file) => {
        const {
            canvas,
            requestLayerSync,
            setToastMessage,
            resetViewCanvas,
        } = get();
        if (!canvas) return;

        try {
            if (typeof file.size === 'number' && file.size > MAX_PROJECT_FILE_BYTES) {
                throw new Error('Project file exceeds the 100 MB import limit.');
            }
            const text = await file.text();
            const raw = JSON.parse(text) as Partial<ProjectFilePayload>;
            validateProjectPayloadStructure(raw);
            const fallbackName = file.name
                .replace(/\.apocaproject\.json$/i, '')
                .replace(/\.json$/i, '');
            const normalizedPayload = normalizeDesignSpaceProjectPayload<ProjectPage>(raw, {
                projectName: fallbackName || 'Untitled Project',
                defaultBackground: DEFAULT_CANVAS_BACKGROUND,
            });
            const projectName = normalizedPayload.projectName;
            const activeTheme = getPayloadActiveTheme(normalizedPayload);
            const rawUnitMode = normalizedPayload.unitMode;
            const normalizedUnitMode =
                rawUnitMode === 'px' || rawUnitMode === 'in' || rawUnitMode === 'cm' || rawUnitMode === 'mm'
                    ? rawUnitMode
                    : 'in';

            const rawPages = Array.isArray(normalizedPayload.pages) && normalizedPayload.pages.length > 0
                ? normalizedPayload.pages
                : null;
            const safeActivePageIndex = rawPages && rawPages.length > 0
                ? Math.max(0, Math.min((normalizedPayload.activePageIndex ?? 0) as number, rawPages.length - 1))
                : 0;
            let canvasData = normalizedPayload.canvasData;
            if (!canvasData && (!rawPages || rawPages.length === 0)) {
                throw new Error('Missing canvas data');
            }
            canvasData = getInitialPageLoadData(rawPages as ProjectPage[] | null, safeActivePageIndex, canvasData);
            const fileAssets =
                normalizedPayload.assets && typeof normalizedPayload.assets === 'object'
                    ? normalizedPayload.assets
                    : {};
            const { canvasData: migratedCanvasData, imageAssets: nextAssets } =
                prepareCanvasDataForPersistence(canvasData || { objects: [] }, fileAssets);
            const hydratedCanvasData = hydrateCanvasDataWithAssets(
                migratedCanvasData,
                nextAssets
            );
            await stageCanvasDataLoad(hydratedCanvasData);

            const nextSize = normalizedPayload.canvasSize;
            const pageSize = rawPages && rawPages.length > 0
                ? normalizePageSize((rawPages[safeActivePageIndex] as ProjectPage | undefined)?.canvasSize, normalizePageSize(nextSize))
                : normalizePageSize(nextSize);
            const normalizedWidth = pageSize.width;
            const normalizedHeight = pageSize.height;

            get().createProject({
                canvasSize: { width: normalizedWidth, height: normalizedHeight },
                unitMode: normalizedUnitMode,
                name: projectName,
                source: 'load-project-file',
            });

            const nextCanvas = get().canvas;
            if (!nextCanvas) return;
            await nextCanvas.loadFromJSON(hydratedCanvasData, reviveCustomFabricProps);
            get().syncCanvasToStore(nextCanvas);
            resetViewCanvas();

            sanityCheckCanvas(nextCanvas, activeTheme);
            requestLayerSync();

            const normalizedPages = rawPages && rawPages.length > 0 ? rawPages : [{ id: uuidv4(), name: 'Page 1', canvasData: migratedCanvasData, canvasSize: { width: normalizedWidth, height: normalizedHeight } }];
            set({
                projectName,
                productProjectFields: extractProductProjectFields(normalizedPayload),
                isProjectPresetsOpen: false,
                imageAssets: nextAssets,
                pages: normalizedPages as any,
                activePageIndex: safeActivePageIndex,
                isDirty: false,
            });
            useThemeStore.getState().setCanvasBackgroundColor(
                typeof (migratedCanvasData as any)?.background === 'string'
                    ? (migratedCanvasData as any).background
                    : null
            );

            if (activeTheme) {
                useThemeStore.getState().setThemeData(activeTheme);
                useThemeStore.getState().setActiveBrandCollectionId(null);
                applyActiveThemeToCanvas();
                const { projectSyncEnabled, applyThemeFromTokens } = useUiThemeStore.getState();
                if (projectSyncEnabled) {
                    applyThemeFromTokens(activeTheme);
                }
            } else {
                useThemeStore.getState().setThemeData(null);
                useThemeStore.getState().setActiveBrandCollectionId(null);
            }

            resetHistoryToCurrentCanvas();
            set({ isDirty: false, autoSaveStatus: 'idle', saveStatus: 'saved' });
            setToastMessage(`Project loaded: ${projectName}`);
            } catch (error) {
            setToastMessage('Failed to load project file.');
        }
    },
    
    saveState: (options?: { force?: boolean }) => {
        if (get().batchDepth > 0 && !options?.force) {
            set({ batchNeedsSave: true });
            return;
        }
        useHistoryStore.getState().saveState(options);

        markProjectDirty();

    },

    takeSnapshot: () => {
        useHistoryStore.getState().takeSnapshot();
        markProjectDirty();
    },

    clearHistory: () => {
        useHistoryStore.getState().clearHistory();
        // Trigger memory cleanup when history is cleared
        MemoryManager.getInstance().performCleanup();
    },

    undo: async () => {
        const history = useHistoryStore.getState();
        if (!history.canUndo()) {
            return;
        }
        await history.undo();
        set({ isDirty: true });
        get().setAutoSaveStatus('dirty');
    },

    redo: async () => {
        const history = useHistoryStore.getState();
        if (!history.canRedo()) {
            return;
        }
        await history.redo();
        set({ isDirty: true });
        get().setAutoSaveStatus('dirty');
    },

    // --- THEME ACTIONS (Delegated to theme store) ---
    addThemeToVault: (jsonString: string) => {
        const result = useThemeStore.getState().addThemeToVault(jsonString);
        if (result.success && result.collection) {
            set({ toastMessage: `Theme Imported: ${result.collection.name}` });
            // Apply theme to canvas
            const { canvas, canvasReadyState, saveState, requestLayerSync, syncCanvasToStore, acquireSyncLock, releaseSyncLock } = get();
            const themeData = useThemeStore.getState().themeData;
            if (canvas && canvasReadyState === 'ready' && themeData) {
                applyThemeToCanvas(canvas, themeData, {
                    saveState,
                    requestLayerSync,
                    syncCanvasToStore,
                    acquireSyncLock,
                    releaseSyncLock,
                });
            }
        } else {
            set({ toastMessage: result.error || 'Invalid Theme File' });
        }
    },

    setActiveBrandCollectionId: (id) => {
        const themeData = useThemeStore.getState().selectThemeFromVault(id);
        if (themeData) {
            const brandVault = useThemeStore.getState().brandVault;
            const selectedTheme = brandVault.find(brand => brand.id === id);
            set({ toastMessage: `Theme Changed: ${selectedTheme?.name || 'Theme'}` });
            // Apply theme to canvas
            const { canvas, canvasReadyState, saveState, requestLayerSync, syncCanvasToStore, acquireSyncLock, releaseSyncLock } = get();
            if (canvas && canvasReadyState === 'ready') {
                applyThemeToCanvas(canvas, themeData, {
                    saveState,
                    requestLayerSync,
                    syncCanvasToStore,
                    acquireSyncLock,
                    releaseSyncLock,
                });
            }
        }
    },

    applyTheme: (theme) => {
        useThemeStore.getState().setThemeData(theme);
        // Apply theme to canvas if ready
        const { canvas, canvasReadyState, saveState, requestLayerSync, syncCanvasToStore, acquireSyncLock, releaseSyncLock } = get();
        if (canvas && canvasReadyState === 'ready') {
            applyThemeToCanvas(canvas, theme, {
                saveState,
                requestLayerSync,
                syncCanvasToStore,
                acquireSyncLock,
                releaseSyncLock,
            });
        }
        // Sync UI vars after applying canvas theme
        const { applyThemeFromTokens } = useUiThemeStore.getState();
        if (typeof applyThemeFromTokens === 'function') {
            applyThemeFromTokens(theme);
        }
    },

    resetTheme: () => {
        const { canvas, saveState, requestLayerSync, syncCanvasToStore } = get();
        if (!canvas) return;
        resetAllThemeLinks(canvas, { saveState, requestLayerSync, syncCanvasToStore });
        set({ toastMessage: 'Theme links reset' });
    },

    toggleMovementLock: (layerId) => {
        const { canvas, requestLayerSync, saveState, syncCanvasToStore } = get();
        const obj = canvas?.getObjects().find(o => (o as any).id === layerId);
        if (obj) {
            const isLocked = !obj.lockMovementX;
            obj.set({
                lockMovementX: isLocked,
                lockMovementY: isLocked,
                lockRotation: isLocked,
                lockScalingX: isLocked,
                lockScalingY: isLocked,
                hasControls: !isLocked,
            });
            syncCanvasToStore(canvas);
            requestLayerSync();
            saveState();
        }
    },

    toggleColorLock: (layerId) => {
        const { canvas, requestLayerSync, saveState, syncCanvasToStore } = get();
        const obj = canvas?.getObjects().find(o => (o as any).id === layerId);
        if (obj) {
            (obj as any).colorLocked = !(obj as any).colorLocked;
            syncCanvasToStore(canvas);
            requestLayerSync();
            saveState();
        }
    },

    setObjectFill: (fill) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync, syncCanvasToStore } = get();
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);
        if (selectedObject && canvas) {
            selectedObject.set({ fill, tokenRole: null });
            canvas.requestRenderAll();
            syncCanvasToStore(canvas);
            saveState();
            requestLayerSync();
        }
    },

    setObjectThemedFill: (tokenRole) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync, syncCanvasToStore } = get();
        const themeData = useThemeStore.getState().themeData;
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);
        if (selectedObject && canvas && themeData) {
            applyThemedFillToObject(selectedObject, canvas, tokenRole, themeData, {
                saveState,
                requestLayerSync,
                syncCanvasToStore,
            });
        }
    },

    applyTint: (tokenRole) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync, syncCanvasToStore } = get();
        const themeData = useThemeStore.getState().themeData;
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);
        const image = selectedObject as fabric.Image;
        if (image && image.type === 'image' && canvas && themeData) {
            applyThemeTintToImage(image, canvas, tokenRole, themeData, {
                saveState,
                requestLayerSync,
                syncCanvasToStore,
            });
        }
    },

    resetObjectToDefaultTheme: () => {
        const { canvas, selectedObjectId, saveState, requestLayerSync, syncCanvasToStore } = get();
        const themeData = useThemeStore.getState().themeData;
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);
        if (!selectedObject || !canvas || !themeData) return;

        resetObjectTheme(selectedObject, canvas, themeData, {
            saveState,
            requestLayerSync,
            syncCanvasToStore,
        });
    },

    // Text Effects Actions
    setTextShadow: (shadowParams) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync, syncCanvasToStore } = get();
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);

        if (selectedObject && (selectedObject.type === 'i-text' || selectedObject.type === 'textbox')) {
            const currentShadow = selectedObject.shadow as fabric.Shadow | null;
            const newShadow = new fabric.Shadow({
                color: shadowParams.color ?? (currentShadow?.color || '#000000'),
                blur: shadowParams.blur ?? (currentShadow?.blur || 0),
                offsetX: shadowParams.offsetX ?? (currentShadow?.offsetX || 0),
                offsetY: shadowParams.offsetY ?? (currentShadow?.offsetY || 0),
            });

            selectedObject.set({ shadow: newShadow });
            canvas?.requestRenderAll();
            if (canvas) syncCanvasToStore(canvas);
            saveState();
            requestLayerSync();
        }
    },

    setTextStroke: (strokeParams) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync, syncCanvasToStore } = get();
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);

        if (selectedObject && (selectedObject.type === 'i-text' || selectedObject.type === 'textbox')) {
            const updates: any = {};
            if (strokeParams.color !== undefined) updates.stroke = strokeParams.color;
            if (strokeParams.width !== undefined) updates.strokeWidth = strokeParams.width;

            selectedObject.set(updates);
            canvas?.requestRenderAll();
            if (canvas) syncCanvasToStore(canvas);
            saveState();
            requestLayerSync();
        }
    },

    setTextCharSpacing: (spacing) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync, syncCanvasToStore } = get();
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);

        if (selectedObject && (selectedObject.type === 'i-text' || selectedObject.type === 'textbox')) {
            selectedObject.set({ charSpacing: spacing });
            canvas?.requestRenderAll();
            if (canvas) syncCanvasToStore(canvas);
            saveState();
            requestLayerSync();
        }
    },

    // Image Adjustment Actions (using consolidated utilities)
    setImageBrightness: (value) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync } = get();
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);
        applyAdjustmentToSelection(selectedObject, 'brightness', value, {
            canvas,
            onSaveState: saveState,
            onLayerSync: requestLayerSync,
        });
    },

    setImageContrast: (value) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync } = get();
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);
        applyAdjustmentToSelection(selectedObject, 'contrast', value, {
            canvas,
            onSaveState: saveState,
            onLayerSync: requestLayerSync,
        });
    },

    setImageSaturation: (value) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync } = get();
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);
        applyAdjustmentToSelection(selectedObject, 'saturation', value, {
            canvas,
            onSaveState: saveState,
            onLayerSync: requestLayerSync,
        });
    },

    setImageAdjustments: (adjustments) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync } = get();
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);
        if (selectedObject && isImage(selectedObject)) {
            applyAdjustments(selectedObject as fabric.Image, adjustments, {
                canvas,
                onSaveState: saveState,
                onLayerSync: requestLayerSync,
            });
        }
    },

    resetImageAdjustments: () => {
        const { canvas, selectedObjectId, saveState, requestLayerSync } = get();
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);
        resetAdjustmentsOnSelection(selectedObject, {
            canvas,
            onSaveState: saveState,
            onLayerSync: requestLayerSync,
        });
    },

    exportCanvas: async (options) => {
        const { canvas, canvasReadyState } = get();
        if (!canvas) {
            showError(ErrorMessages.CANVAS_NOT_READY);
            return;
        }
        if (canvasReadyState !== 'ready') {
            showError(ErrorMessages.CANVAS_NOT_READY);
            return;
        }

        try {
            if (options.format === 'png' || options.format === 'svg' || options.format === 'jpeg') {
                await advancedExportManager.export(canvas, options.format, {
                    includeBackground: true,
                    backgroundColor: getPageBackgroundColor(),
                    dpi: Math.max(150, options.multiplier * 150),
                    quality: options.quality,
                    fileName: get().projectName || 'design',
                });
                showInfo(`${options.format.toUpperCase()} exported successfully`);
            }
        } catch (error) {
            showError(ErrorMessages.EXPORT_FAILED, {
                context: { error: error instanceof Error ? error.message : error },
            });
        }
    },

    // Project Persistence Actions
    saveProject: async (name) => {
        const { canvas, currentLibraryProjectId, projectName, unitMode } = get();
        if (!canvas) {
            set({ toastMessage: 'Editor canvas is not ready. Please try again.' });
            return;
        }
        const safeName = name.trim() || projectName?.trim() || 'Untitled Project';
        const { themeData } = useThemeStore.getState();

        try {
            get().syncActivePageFromCanvas();
            const revisionAtStart = get().changeRevision;
            const exportData = await buildProjectPersistenceData(
                canvas,
                get().pages,
                get().imageAssets,
                get().activePageIndex
            );

            const savedAt = new Date().toISOString();
            const payload = buildProjectFilePayload({
                projectName: safeName,
                pages: exportData.pages,
                activePageIndex: get().activePageIndex,
                canvasData: exportData.canvasData,
                assets: exportData.assets,
                activeTheme: themeData,
                lastUpdated: savedAt,
                canvasSize: getDocumentCanvasSize(),
                unitMode,
            }, get().productProjectFields, {
                projectId: currentLibraryProjectId ?? undefined,
                now: savedAt,
            });

            const jsonPayload = JSON.stringify(payload);

            // Generate thumbnail by getting a small version of the canvas
            const thumbnail = canvas.toDataURL({
                format: 'png',
                multiplier: 0.1, // Small thumbnail
                quality: 0.8
            });

            // Import and use the database
            const { db } = await import('../db');
            let nextLibraryProjectId = currentLibraryProjectId;
            let didUpdateExistingProject = false;
            if (nextLibraryProjectId) {
                const existingProject = await db.loadProject(nextLibraryProjectId);
                if (existingProject) {
                    await db.updateProject(nextLibraryProjectId, safeName, jsonPayload, thumbnail);
                    didUpdateExistingProject = true;
                } else {
                    nextLibraryProjectId = null;
                }
            }
            if (!nextLibraryProjectId) {
                nextLibraryProjectId = await db.saveProject(safeName, jsonPayload, thumbnail);
            }
            const hasNewerChanges = get().changeRevision !== revisionAtStart;
            set({
                currentLibraryProjectId: nextLibraryProjectId,
                projectName: safeName,
                productProjectFields: extractProductProjectFields(payload),
                pages: exportData.pages,
                imageAssets: exportData.runtimeImageAssets,
                isDirty: hasNewerChanges,
                autoSaveStatus: hasNewerChanges ? 'dirty' : 'saved',
                saveStatus: hasNewerChanges ? 'unsaved' : 'saved',
                toastMessage: didUpdateExistingProject
                    ? `Updated library project: ${safeName}`
                    : exportData.failedAssetIds.length > 0
                        ? `Saved to library with ${exportData.failedAssetIds.length} linked image(s)`
                        : `Saved to library: ${safeName}`,
            });
        } catch (error) {
            console.error('Failed to save project:', error);
            set({ toastMessage: 'Failed to save project.' });
        }
    },

    loadProject: async (projectId) => {
        try {
            const { db } = await import('../db');
            const result = await db.loadProject(projectId);

            if (!result) {
                console.error('Project not found');
                return;
            }

            const {
                canvas,
                requestLayerSync,
                resetViewCanvas,
                setShowOnboarding,
            } = get();
            if (!canvas) {
                set({ toastMessage: 'Editor canvas is not ready. Please try again.' });
                return;
            }

            const parsed = JSON.parse(result.canvasData);
            validateProjectPayloadStructure(parsed);
            const normalizedPayload = normalizeDesignSpaceProjectPayload<ProjectPage>(parsed, {
                projectName: result.project.name,
                defaultBackground: DEFAULT_CANVAS_BACKGROUND,
            });
            const rawPages = Array.isArray(normalizedPayload.pages) && normalizedPayload.pages.length > 0
                ? normalizedPayload.pages
                : null;
            const safeActivePageIndex = rawPages && rawPages.length > 0
                ? Math.max(0, Math.min((normalizedPayload.activePageIndex ?? 0) as number, rawPages.length - 1))
                : 0;
            const rawCanvasData = getInitialPageLoadData(rawPages as ProjectPage[] | null, safeActivePageIndex, normalizedPayload.canvasData);
            const rawAssets = normalizedPayload.assets && typeof normalizedPayload.assets === 'object'
                ? normalizedPayload.assets
                : {};
            const activeTheme = getPayloadActiveTheme(normalizedPayload);
            const canvasSize = rawPages && rawPages.length > 0
                ? (rawPages[safeActivePageIndex] as ProjectPage | undefined)?.canvasSize
                : normalizedPayload.canvasSize;
            const unitMode = normalizedPayload.unitMode;

            const { canvasData: migratedCanvasData, imageAssets: nextAssets } =
                prepareCanvasDataForPersistence(rawCanvasData || { objects: [] }, rawAssets);
            const hydratedCanvasData = hydrateCanvasDataWithAssets(
                migratedCanvasData,
                nextAssets
            );
            await stageCanvasDataLoad(hydratedCanvasData);

            const normalizedWidth =
                canvasSize
                && typeof canvasSize.width === 'number'
                && Number.isFinite(canvasSize.width)
                    ? Math.max(1, Math.round(canvasSize.width))
                    : DEFAULT_CANVAS_SIZE.width;
            const normalizedHeight =
                canvasSize
                && typeof canvasSize.height === 'number'
                && Number.isFinite(canvasSize.height)
                    ? Math.max(1, Math.round(canvasSize.height))
                    : DEFAULT_CANVAS_SIZE.height;
            const normalizedUnitMode =
                unitMode === 'px' || unitMode === 'in' || unitMode === 'cm' || unitMode === 'mm'
                    ? unitMode
                    : 'in';

            get().createProject({
                canvasSize: { width: normalizedWidth, height: normalizedHeight },
                unitMode: normalizedUnitMode,
                name: result.project.name,
                source: 'load-project-db',
            });

            const nextCanvas = get().canvas;
            if (!nextCanvas) return;
            await nextCanvas.loadFromJSON(hydratedCanvasData, reviveCustomFabricProps);
            get().syncCanvasToStore(nextCanvas);
            resetViewCanvas();
            sanityCheckCanvas(nextCanvas, activeTheme);
            requestLayerSync();

            if (activeTheme) {
                get().applyTheme(activeTheme);
                const { applyThemeFromTokens } = useUiThemeStore.getState();
                if (typeof applyThemeFromTokens === 'function') {
                    applyThemeFromTokens(activeTheme);
                }
            } else {
                useThemeStore.getState().setThemeData(null);
                useThemeStore.getState().setActiveBrandCollectionId(null);
            }

            const normalizedPages = rawPages && rawPages.length > 0 ? rawPages : [{ id: uuidv4(), name: "Page 1", canvasData: migratedCanvasData, canvasSize: { width: normalizedWidth, height: normalizedHeight } }];
            set({
                currentLibraryProjectId: projectId,
                imageAssets: nextAssets,
                projectName: result.project.name,
                productProjectFields: extractProductProjectFields(normalizedPayload),
                isProjectPresetsOpen: false,
                pages: normalizedPages as any,
                activePageIndex: safeActivePageIndex,
                isDirty: false,
            });

            setShowOnboarding(false);
            useThemeStore.getState().setCanvasBackgroundColor(
                typeof (migratedCanvasData as any)?.background === 'string'
                    ? (migratedCanvasData as any).background
                    : null
            );

            resetHistoryToCurrentCanvas();
            set({ isDirty: false, autoSaveStatus: 'idle', saveStatus: 'saved' });
            set({ toastMessage: `Loaded project: ${result.project.name}` });
            } catch (error) {
            console.error('Failed to load project:', error);
            set({ toastMessage: 'Failed to load project.' });
        }
    },

    deleteProject: async (projectId) => {
        try {
            const { db } = await import('../db');
            await db.deleteProject(projectId);
        } catch (error) {
            console.error('Failed to delete project:', error);
            set({ toastMessage: 'Failed to delete project.' });
        }
    },

    duplicateProject: async (projectId, newName) => {
        try {
            const { db } = await import('../db');
            await db.duplicateProject(projectId, newName);
            set({ toastMessage: `Project duplicated as: ${newName}` });
        } catch (error) {
            console.error('Failed to duplicate project:', error);
            set({ toastMessage: 'Failed to duplicate project.' });
        }
    },
    renameProject: async (projectId, newName) => {
        const normalizedName = newName.trim();
        if (!normalizedName) return;
        try {
            const { db } = await import('../db');
            await db.renameProject(projectId, normalizedName);
            set({ toastMessage: `Project renamed to: ${normalizedName}` });
        } catch (error) {
            console.error('Failed to rename project:', error);
            set({ toastMessage: 'Failed to rename project.' });
        }
    },

    getAllProjects: async () => {
        try {
            const { db } = await import('../db');
            return await db.getAllProjects();
        } catch (error) {
            console.error('Failed to get projects:', error);
            return [];
        }
    },

    updateCurrentProject: async () => {
        const { projectName, currentLibraryProjectId, canvas } = get();
        if (!canvas || !projectName || !currentLibraryProjectId) return;

        try {
            get().syncActivePageFromCanvas();
            const exportData = await buildProjectPersistenceData(
                canvas,
                get().pages,
                get().imageAssets,
                get().activePageIndex
            );
            const { db } = await import('../db');
            const targetProjectId = currentLibraryProjectId;

            const savedAt = new Date().toISOString();
            const payload = buildProjectFilePayload({
                projectName,
                pages: exportData.pages,
                activePageIndex: get().activePageIndex,
                canvasData: exportData.canvasData,
                assets: exportData.assets,
                activeTheme: useThemeStore.getState().themeData,
                lastUpdated: savedAt,
                canvasSize: getDocumentCanvasSize(),
                unitMode: get().unitMode,
            }, get().productProjectFields, {
                projectId: targetProjectId,
                now: savedAt,
            });

            const jsonPayload = JSON.stringify(payload);

            const thumbnail = canvas.toDataURL({
                format: 'png',
                multiplier: 0.1,
                quality: 0.8
            });

            await db.updateProject(targetProjectId, projectName, jsonPayload, thumbnail);
            set({
                currentLibraryProjectId: targetProjectId,
                productProjectFields: extractProductProjectFields(payload),
                pages: exportData.pages,
                imageAssets: exportData.runtimeImageAssets,
            });
        } catch (error) {
            console.error('Failed to update project:', error);
            throw error;
        }
    },

    setAutoSaveStatus: (status) => set({ autoSaveStatus: status, saveStatus: deriveSaveStatus(status) }),
    setDirty: (dirty) => set({ isDirty: dirty }),
    setShowHelpModal: (show) => set({ showHelpModal: show }),
    setShowExportModal: (show) => set({ showExportModal: show }),
    setShowSafeZones: (show) => set({ showSafeZones: show }),
    // Stroke and Lock Actions
    setObjectStrokeColor: (color) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync, syncCanvasToStore } = get();
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);
        if (selectedObject && canvas) {
            selectedObject.set({ stroke: color });
            canvas.requestRenderAll();
            syncCanvasToStore(canvas);
            saveState();
            requestLayerSync();
        }
    },

    setObjectStrokeWidth: (width) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync, syncCanvasToStore } = get();
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);
        if (selectedObject && canvas) {
            selectedObject.set({ strokeWidth: width });
            canvas.requestRenderAll();
            syncCanvasToStore(canvas);
            saveState();
            requestLayerSync();
        }
    },

    toggleObjectLock: (layerId) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync, syncCanvasToStore, clearSelection } = get();
        const selectedObject = layerId
            ? canvas?.getObjects().find((object) => (object as any).id === layerId) ?? null
            : resolveSelectedObject(canvas, selectedObjectId);
        if (selectedObject && canvas) {
            const isCurrentlyLocked = selectedObject.lockMovementX;
            const nextLocked = !isCurrentlyLocked;
            selectedObject.set({
                lockMovementX: nextLocked,
                lockMovementY: nextLocked,
                lockRotation: nextLocked,
                lockScalingX: nextLocked,
                lockScalingY: nextLocked,
                lockSkewingX: nextLocked,
                lockSkewingY: nextLocked,
                hasControls: isCurrentlyLocked,
                selectable: isCurrentlyLocked
            });
            if (nextLocked) {
                clearSelection();
            }
            canvas.requestRenderAll();
            syncCanvasToStore(canvas);
            saveState();
            requestLayerSync();
        }
    },

    // Text Formatting Actions
    setTextLineHeight: (lineHeight) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync, syncCanvasToStore } = get();
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);
        if (selectedObject && canvas && (selectedObject.type === 'i-text' || selectedObject.type === 'textbox')) {
            (selectedObject as fabric.Textbox | fabric.IText).set({ lineHeight });
            canvas.requestRenderAll();
            syncCanvasToStore(canvas);
            saveState();
            requestLayerSync();
        }
    },

    triggerAutoSave: () => {
        const { currentLibraryProjectId, updateCurrentProject, setAutoSaveStatus } = get();
        if (!currentLibraryProjectId) return;

        // Debounced save - wait 2 seconds of inactivity before saving
        const currentTimer = get().autoSaveTimer;
        if (currentTimer !== null) {
            clearTimeout(currentTimer);
        }

        const timer = setTimeout(async () => {
            const revisionAtStart = get().changeRevision;
            set({ autoSaveTimer: null });
            setAutoSaveStatus('saving');
            try {
                await updateCurrentProject();
                if (get().changeRevision !== revisionAtStart) {
                    setAutoSaveStatus('dirty');
                    get().triggerAutoSave();
                    return;
                }
                set({ isDirty: false });
                setAutoSaveStatus('saved');

                // Reset status after 2 seconds
                setTimeout(() => {
                    if (get().autoSaveStatus === 'saved') {
                        setAutoSaveStatus('idle');
                    }
                }, 2000);
            } catch {
                setAutoSaveStatus('error');
            }
        }, 2000);

        // Store timer reference to clear if another action occurs
        set({ autoSaveTimer: timer });
    },
        });
    },
    {
        name: 'designspace-editor',
        merge: (persistedState, currentState) => {
            if (!persistedState || typeof persistedState !== 'object') return currentState;
            // Legacy project payloads and blob-backed assets must not become live
            // state on startup. Project data belongs in IndexedDB/project files;
            // blob URLs are session-scoped. The legacy template migration reads
            // localStorage directly before the first preference write removes it.
            const {
                pages: _pages,
                activePageIndex: _activePageIndex,
                productProjectFields: _productProjectFields,
                isDirty: _isDirty,
                autoSaveStatus: _autoSaveStatus,
                saveStatus: _saveStatus,
                userTemplates: _userTemplates,
                assets: _assets,
                ...preferences
            } = persistedState as Record<string, unknown>;
            return { ...currentState, ...preferences };
        },
        partialize: (state) => ({
            // Theme state is now persisted by the theme store (designspace-theme)
            // We only persist non-theme editor state here
            unitMode: state.unitMode,
            unitScale: state.unitScale,
            unitZoom: state.unitZoom,
            showGuides: state.showGuides,
            bleedPx: state.bleedPx,
            isPreviewMode: state.isPreviewMode,
            projectName: state.projectName,
            currentLibraryProjectId: state.currentLibraryProjectId,
            activeTool: state.activeTool,
            brushSize: state.brushSize,
            snapEnabled: state.snapEnabled,
            gridEnabled: state.gridEnabled,
            showSafeZones: state.showSafeZones,
            showSuggestionSidebar: state.showSuggestionSidebar,
            accessibilitySettings: state.accessibilitySettings,
        }),
    }
  )
);

export const sanityCheckCanvas = (canvas: fabric.Canvas, themeData: ApocapaletteTheme | null) => {
    let changed = false;
    const report = { missingIds: 0, invalidRoles: 0 };

    const walk = (obj: fabric.Object) => {
        const target = obj as any;
        if (!target.id || (typeof target.id === 'string' && target.id.trim().length === 0)) {
            target.id = uuidv4();
            report.missingIds += 1;
            changed = true;
        }
        if (target.colorLocked == null) {
            target.colorLocked = false;
            changed = true;
        }
        if (target.tokenRole === undefined) {
            target.tokenRole = null;
            changed = true;
        }
        const tokenRole = target.tokenRole;
        if (typeof tokenRole === 'string' && tokenRole.trim().length === 0) {
            target.tokenRole = null;
            changed = true;
        }
        if (themeData && tokenRole != null) {
            if (typeof tokenRole !== 'string' || !getValueByPath(themeData, tokenRole)) {
                target.tokenRole = null;
                report.invalidRoles += 1;
                changed = true;
            }
        }
        if (obj.type === 'group' || isActiveSelection(obj)) {
            (obj as fabric.Group).getObjects().forEach(walk);
        }
    };

    canvas.getObjects().forEach(walk);

    if (report.missingIds === 0 && report.invalidRoles === 0) {
        return report;
    }

    if (changed) {
        canvas.requestRenderAll();
        useEditorStore.getState().requestLayerSync();
    }

    return report;
};
