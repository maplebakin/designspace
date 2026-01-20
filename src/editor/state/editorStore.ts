import { createWithEqualityFn } from 'zustand/traditional';
import { persist } from 'zustand/middleware';
import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import { ensureObjectId, reviveCustomFabricProps } from '../fabric/initFabricCanvas';
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
import { resizeCanvas } from '../fabric/canvasUtils';
import { toSerializableObject } from '../utils/serialization';
import { useUiThemeStore } from './uiThemeStore';
import type { ApocapaletteTheme } from '../types/apocapalette';
import { applyAssetRefCounts, hydrateCanvasDataWithAssets, prepareCanvasDataForPersistence } from './useHistoryStore';
import { useHistoryStore } from './useHistoryStore';
import { unitScale as unitScaleMap, UnitMode } from '../utils/units';
import { applyActiveThemeToCanvas } from '../fabric/themeUtils';
import {
    useThemeStore,
    applyThemeToCanvas,
    applyThemedFillToObject,
    applyThemeTintToImage,
    resetObjectToDefaultTheme as resetObjectTheme,
    resetAllThemeLinks,
} from './useThemeStore';

// Re-export BrandCollection for backward compatibility
export type { BrandCollection } from './useThemeStore';


// --- CONSTANTS ---

// Default canvas size: US Letter at 300 DPI (8.5" × 11")
export const DEFAULT_CANVAS_SIZE = {
  width: 2550,   // 8.5" at 300 DPI = 2550px
  height: 3300,  // 11" at 300 DPI = 3300px
};

// Default canvas background color (cream)
export const DEFAULT_CANVAS_BACKGROUND = '#FAF8F5';

export interface Template {
  id: string;
  name: string;
  canvasData: string; // Stored as stringified JSON
  defaultThemeId: string;
  thumbnail?: string;
  canvasSize?: { width: number; height: number };
  unitMode?: UnitMode;
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

export type EditorTool = 'select' | 'draw' | 'pan' | 'erase';

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

export type ProjectFilePayload = {
  projectName: string;
  canvasData: any;
  assets?: Record<string, string>;
  activeTheme: ApocapaletteTheme | null;
  lastUpdated: string;
  canvasSize?: { width: number; height: number };
  unitMode?: UnitMode;
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
        if (obj.type === 'group' || obj.type === 'activeSelection') {
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

    if (failedIds.length > 0) {
        const preview = failedIds.slice(0, 3).join(', ');
        const suffix = failedIds.length > 3 ? ` (+${failedIds.length - 3} more)` : '';
        throw new Error(
            `Export failed: ${failedIds.length} image(s) could not be encoded. ` +
            `Ensure external assets allow CORS or replace them before exporting. ` +
            `Failed IDs: ${preview}${suffix}`
        );
    }

    const serializedObjects = canvas.getObjects().map(toSerializableObject);
    const objectsWithAssets = replaceImageSources(serializedObjects, assets);
    return {
        canvasData: {
            objects: objectsWithAssets,
            background: canvas.backgroundColor || undefined,
        },
        assets,
    };
};

const buildLayerStateFromObjects = (
    objects: fabric.Object[],
    canvas?: fabric.Canvas | null
) => {
    const nextLayers: Layer[] = [];
    const nextById: Record<string, fabric.Object> = {};
    const nextCanvasObjects: SerializedFabricObject[] = [];

    objects.forEach((obj) => {
        if ((obj as any).isGuide) return;
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
  showGuides: boolean;
  dirtyObjectsRef: Set<string> | null;

  toastMessage: string | null;
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
  isProjectPresetsOpen: boolean;
  activeTool: EditorTool;
  brushSize: number;
  showOnboarding: boolean;
  layerSyncHandler: (() => void) | null;
  hasLayerSyncHandler: boolean;
  batchDepth: number;
  batchNeedsSync: boolean;
  batchNeedsSave: boolean;
  autoSaveStatus: 'idle' | 'saving' | 'saved';
  autoSaveTimer: ReturnType<typeof setTimeout> | null;

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
  setToastMessage: (message: string | null) => void;
  setUnitMode: (mode: UnitMode) => void;
  setCanvasBackgroundColor: (color: string) => void;
  setZoom: (zoom: number) => void;
  setVpt: (vpt: number[]) => void;
  setCanvasOffset: (offset: { x: number; y: number }) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setGridEnabled: (enabled: boolean) => void;
  setShowOnboarding: (show: boolean) => void;
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
  startNewProject: () => void;
  downloadProjectFile: () => Promise<void>;
  loadProjectFile: (file: File) => Promise<void>;
  setProjectPresetsOpen: (open: boolean) => void;
  setProjectName: (name: string) => void;
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
  getAllProjects: () => Promise<any[]>;
  updateCurrentProject: () => Promise<void>;
  setAutoSaveStatus: (status: 'idle' | 'saving' | 'saved') => void;

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
}

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
            setSelectedObjectId: (id) => set({ selectedObjectId: id }),
            acquireSyncLock: (reason) => get().acquireSyncLock(reason),
            releaseSyncLock: () => get().releaseSyncLock(),
        });

        return ({
            canvas: null,
        canvasReadyState: 'uninitialized',
        canvasObjects: [], // PHASE 2.1: Primary source of truth
        selectedObjectId: null,
        layers: [],
        layersById: {},
        selectedLayerIds: [],
        showGuides: true,
        dirtyObjectsRef: null,

        toastMessage: null,
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
        isProjectPresetsOpen: false,
        activeTool: 'select',
        brushSize: 8,
        showOnboarding: true,
        layerSyncHandler: null,
        hasLayerSyncHandler: false,
        batchDepth: 0,
        batchNeedsSync: false,
        batchNeedsSave: false,
        autoSaveStatus: 'idle',
        autoSaveTimer: null,
        showHelpModal: false,
        showExportModal: false,
        syncLock: {
            isLocked: false,
            reason: null,
            queuedSync: false,
        },

    setCanvas: (canvas) => {
        const currentBackground = useThemeStore.getState().canvasBackgroundColor;
        const nextBackground =
            currentBackground ?? (canvas?.backgroundColor ? String(canvas.backgroundColor) : null);
        useThemeStore.getState().setCanvasBackgroundColor(nextBackground);
        set({ canvas });
        if (!canvas) return;

        // Only apply theme if canvas is ready (not during initialization)
        const { canvasReadyState, saveState, requestLayerSync, acquireSyncLock, releaseSyncLock } = get();
        const themeData = useThemeStore.getState().themeData;
        if (canvasReadyState === 'ready' && themeData) {
            applyThemeToCanvas(canvas, themeData, {
                saveState,
                requestLayerSync,
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
    setLayers: (objects) => {
        const nextState = buildLayerStateFromObjects(objects, get().canvas);
        set(nextState);
    },
    syncCanvasToStore: (canvasOverride) => {
        const targetCanvas = canvasOverride ?? get().canvas;
        if (!targetCanvas) return;
        const objects = targetCanvas.getObjects();
        const nextState = buildLayerStateFromObjects(objects, targetCanvas);
        set(nextState);
    },
    removeSelectedObject: () => {
        const { canvas, setSelectedObjectId, setSelectedLayerIds, requestLayerSync, saveState } = get();
        if (!canvas) return;
        const activeObject = canvas.getActiveObject();
        if (!activeObject) return;

        if (activeObject.type === 'activeSelection') {
            const selection = activeObject as fabric.ActiveSelection;
            selection.getObjects().forEach((obj) => canvas.remove(obj));
        } else {
            canvas.remove(activeObject);
        }

        canvas.discardActiveObject();
        canvas.requestRenderAll();
        setSelectedObjectId(null);
        setSelectedLayerIds([]);
        requestLayerSync();
        saveState();
    },
    alignSelectedObjects: (direction) => {
        const { canvas, startBatch, endBatch } = get();
        if (!canvas) return;
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
        if (!canvas) return;
        if (direction === 'horizontal') {
            distributeHorizontally(canvas);
        } else {
            distributeVertically(canvas);
        }
    },
    groupSelectedObjects: () => {
        const { canvas, syncCanvasToStore } = get();
        if (!canvas) return;
        groupObjects(canvas);
        syncCanvasToStore(canvas);
    },
    ungroupSelectedObjects: () => {
        const { canvas, syncCanvasToStore } = get();
        if (!canvas) return;
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
        set({ canvasObjects: objects });
    },

    markHistoryDirty: () => {
        useHistoryStore.getState().markHistoryDirty();
    },
    consumeHistoryDirty: () => {
        return useHistoryStore.getState().consumeHistoryDirty();
    },
    toggleShowGuides: () => set((state) => ({ showGuides: !state.showGuides })),
    setToastMessage: (message) => set({ toastMessage: message }),
    setUnitMode: (mode) => {
        set((state) => {
            const nextScale = unitScaleMap[mode];
            return {
                unitMode: mode,
                unitScale: nextScale,
                unitZoom: state.zoom * nextScale,
            };
        });
    },
    setCanvasBackgroundColor: (color) => {
        const { canvas, saveState } = get();
        if (canvas) {
            canvas.backgroundColor = color;
            canvas.requestRenderAll();
            saveState();
        }
        // Delegate to theme store (single source of truth)
        useThemeStore.getState().setCanvasBackgroundColor(color);
    },
    setZoom: (zoom) => set((state) => ({ zoom, unitZoom: zoom * state.unitScale })),
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
    resetViewCanvas: () => {
        const { canvas } = get();
        if (!canvas) return;
        const nextVpt = [1, 0, 0, 1, 0, 0] as fabric.TMat2D;
        canvas.setZoom(1);
        canvas.setViewportTransform(nextVpt);
        canvas.requestRenderAll();
        set({ zoom: 1, vpt: [...nextVpt] });
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
    setProjectName: (name) => set({ projectName: name }),
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
            setSelectedLayerIds,
            setSelectedObjectId,
        } = get();
        if (!canvas) return;
        const { brandVault, themeData } = useThemeStore.getState();

        setLayers([]);
        setSelectedLayerIds([]);
        setSelectedObjectId(null);
        canvas.clear();
        useThemeStore.getState().setCanvasBackgroundColor(
            canvas.backgroundColor ? String(canvas.backgroundColor) : null
        );

        const nextWidth = template.canvasSize?.width;
        const nextHeight = template.canvasSize?.height;
        if (
            typeof nextWidth === 'number'
            && Number.isFinite(nextWidth)
            && typeof nextHeight === 'number'
            && Number.isFinite(nextHeight)
        ) {
            canvas.setWidth(Math.max(1, Math.round(nextWidth)));
            canvas.setHeight(Math.max(1, Math.round(nextHeight)));
        }
        if (template.unitMode) {
            get().setUnitMode(template.unitMode);
        }

        const themeToApply = template.defaultThemeId
            ? brandVault.find((brand) => brand.id === template.defaultThemeId)
            : null;

        canvas.loadFromJSON(template.canvasData, reviveCustomFabricProps).then(() => {
            resetViewCanvas();
            sanityCheckCanvas(canvas, themeToApply?.themeData ?? themeData);
            requestLayerSync();
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
        const serializedObjects = canvas.getObjects().map(toSerializableObject);
        const json = {
            objects: serializedObjects,
            background: canvas.backgroundColor || undefined,
        };
        const thumbnail = canvas.toDataURL({ multiplier: 0.1 });
        const newTemplate: Template = {
            id: uuidv4(),
            name: `Template ${new Date().toISOString()}`,
            canvasData: JSON.stringify(json),
            defaultThemeId: activeBrandCollectionId || '',
            thumbnail,
            canvasSize: {
                width: Math.round(canvas.getWidth()),
                height: Math.round(canvas.getHeight()),
            },
            unitMode,
        };
        const nextTemplates = [newTemplate, ...userTemplates];
        set({ userTemplates: nextTemplates, toastMessage: `Saved template: ${newTemplate.name}` });
    },

    startNewProject: () => {
        const {
            canvas,
            requestLayerSync,
            setLayers,
            setSelectedLayerIds,
            setSelectedObjectId,
            setUnitMode,
        } = get();
        if (canvas) {
            canvas.discardActiveObject();
            setLayers([]);
            setSelectedLayerIds([]);
            setSelectedObjectId(null);
            canvas.clear();

            // Set default canvas size to US Letter (8.5" × 11" at 300 DPI)
            resizeCanvas(DEFAULT_CANVAS_SIZE.width, DEFAULT_CANVAS_SIZE.height);

            // Set unit mode to inches for print projects
            setUnitMode('in');

            requestLayerSync();
        }

        useHistoryStore.getState().resetHistory();

        // Initialize default theme from theme store
        useThemeStore.getState().initializeDefaultTheme();
        applyActiveThemeToCanvas();

        // Reset canvas background in theme store
        useThemeStore.getState().setCanvasBackgroundColor(null);

        set({
            projectName: 'Untitled Project',
            isProjectPresetsOpen: false, // Don't show presets by default anymore
        });
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

        let exportData: { canvasData: any; assets: Record<string, string> };
        try {
            exportData = await buildExportCanvasData(canvas);
        } catch (error) {
            const message = error instanceof Error && error.message
                ? error.message
                : 'Failed to prepare project for export.';
            setToastMessage(message);
            return;
        }

        const payload: ProjectFilePayload = {
            projectName: projectName || 'Untitled Project',
            canvasData: exportData.canvasData,
            assets: exportData.assets,
            activeTheme: fallbackTheme,
            lastUpdated: new Date().toISOString(),
            canvasSize: {
                width: Math.round(canvas.getWidth()),
                height: Math.round(canvas.getHeight()),
            },
            unitMode,
        };

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
        setToastMessage(`Saved project: ${payload.projectName}`);
    },

    loadProjectFile: async (file) => {
        const {
            canvas,
            requestLayerSync,
            setToastMessage,
            resetViewCanvas,
            setLayers,
            setSelectedLayerIds,
            setSelectedObjectId,
        } = get();
        if (!canvas) return;

        try {
            const text = await file.text();
            const raw = JSON.parse(text) as Partial<ProjectFilePayload>;
            const fallbackName = file.name
                .replace(/\.apocaproject\.json$/i, '')
                .replace(/\.json$/i, '');
            const projectName =
                typeof raw.projectName === 'string' && raw.projectName.trim().length > 0
                    ? raw.projectName
                    : (fallbackName || 'Untitled Project');
            const activeTheme = raw.activeTheme && typeof raw.activeTheme === 'object'
                ? (raw.activeTheme as ApocapaletteTheme)
                : null;
            const rawUnitMode = raw.unitMode;
            if (rawUnitMode === 'px' || rawUnitMode === 'in' || rawUnitMode === 'cm' || rawUnitMode === 'mm') {
                get().setUnitMode(rawUnitMode);
            }

            let canvasData = raw.canvasData;
            if (!canvasData) {
                throw new Error('Missing canvas data');
            }
            if (typeof canvasData === 'string') {
                canvasData = JSON.parse(canvasData);
            }
            const fileAssets =
                raw.assets && typeof raw.assets === 'object'
                    ? (raw.assets as Record<string, string>)
                    : {};
            const { canvasData: migratedCanvasData, imageAssets: nextAssets } =
                prepareCanvasDataForPersistence(canvasData, fileAssets);
            const hydratedCanvasData = hydrateCanvasDataWithAssets(
                migratedCanvasData,
                nextAssets
            );

            canvas.discardActiveObject();
            setLayers([]);
            setSelectedLayerIds([]);
            setSelectedObjectId(null);
            canvas.clear();
            const nextSize = raw.canvasSize;
            if (
                nextSize
                && typeof nextSize.width === 'number'
                && Number.isFinite(nextSize.width)
                && typeof nextSize.height === 'number'
                && Number.isFinite(nextSize.height)
            ) {
                canvas.setWidth(Math.max(1, Math.round(nextSize.width)));
                canvas.setHeight(Math.max(1, Math.round(nextSize.height)));
            }
            await canvas.loadFromJSON(hydratedCanvasData, reviveCustomFabricProps);
            resetViewCanvas();

            sanityCheckCanvas(canvas, activeTheme);
            requestLayerSync();
            useHistoryStore.getState().resetHistory();

            set({
                projectName,
                isProjectPresetsOpen: false,
                imageAssets: nextAssets,
            });
            useThemeStore.getState().setCanvasBackgroundColor(
                canvas.backgroundColor ? String(canvas.backgroundColor) : null
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

        // Only trigger auto-save for named projects to avoid unnecessary state updates
        const projectName = get().projectName;
        if (projectName && projectName !== 'Untitled Project') {
            get().triggerAutoSave();
        }
    },

    takeSnapshot: () => {
        useHistoryStore.getState().takeSnapshot();
    },

    clearHistory: () => {
        useHistoryStore.getState().clearHistory();
    },

    undo: async () => {
        await useHistoryStore.getState().undo();
    },

    redo: async () => {
        await useHistoryStore.getState().redo();
    },

    // --- THEME ACTIONS (Delegated to theme store) ---
    addThemeToVault: (jsonString: string) => {
        const result = useThemeStore.getState().addThemeToVault(jsonString);
        if (result.success && result.collection) {
            set({ toastMessage: `Theme Imported: ${result.collection.name}` });
            // Apply theme to canvas
            const { canvas, canvasReadyState, saveState, requestLayerSync, acquireSyncLock, releaseSyncLock } = get();
            const themeData = useThemeStore.getState().themeData;
            if (canvas && canvasReadyState === 'ready' && themeData) {
                applyThemeToCanvas(canvas, themeData, {
                    saveState,
                    requestLayerSync,
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
            const { canvas, canvasReadyState, saveState, requestLayerSync, acquireSyncLock, releaseSyncLock } = get();
            if (canvas && canvasReadyState === 'ready') {
                applyThemeToCanvas(canvas, themeData, {
                    saveState,
                    requestLayerSync,
                    acquireSyncLock,
                    releaseSyncLock,
                });
            }
        }
    },

    applyTheme: (theme) => {
        useThemeStore.getState().setThemeData(theme);
        // Apply theme to canvas if ready
        const { canvas, canvasReadyState, saveState, requestLayerSync, acquireSyncLock, releaseSyncLock } = get();
        if (canvas && canvasReadyState === 'ready') {
            applyThemeToCanvas(canvas, theme, {
                saveState,
                requestLayerSync,
                acquireSyncLock,
                releaseSyncLock,
            });
        }
    },

    resetTheme: () => {
        const { canvas, saveState } = get();
        if (!canvas) return;
        resetAllThemeLinks(canvas, { saveState });
        set({ toastMessage: 'Theme links reset' });
    },

    toggleMovementLock: (layerId) => {
        const { canvas, requestLayerSync, saveState } = get();
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
            requestLayerSync();
            saveState();
        }
    },

    toggleColorLock: (layerId) => {
        const { canvas, requestLayerSync, saveState } = get();
        const obj = canvas?.getObjects().find(o => (o as any).id === layerId);
        if (obj) {
            (obj as any).colorLocked = !(obj as any).colorLocked;
            requestLayerSync();
            saveState();
        }
    },

    setObjectFill: (fill) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync } = get();
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);
        if (selectedObject && canvas) {
            selectedObject.set({ fill, tokenRole: null });
            canvas.requestRenderAll();
            saveState();
            requestLayerSync();
        }
    },

    setObjectThemedFill: (tokenRole) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync } = get();
        const themeData = useThemeStore.getState().themeData;
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);
        if (selectedObject && canvas && themeData) {
            applyThemedFillToObject(selectedObject, canvas, tokenRole, themeData, {
                saveState,
                requestLayerSync,
            });
        }
    },

    applyTint: (tokenRole) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync } = get();
        const themeData = useThemeStore.getState().themeData;
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);
        const image = selectedObject as fabric.Image;
        if (image && image.type === 'image' && canvas && themeData) {
            applyThemeTintToImage(image, canvas, tokenRole, themeData, {
                saveState,
                requestLayerSync,
            });
        }
    },

    resetObjectToDefaultTheme: () => {
        const { canvas, selectedObjectId, saveState, requestLayerSync } = get();
        const themeData = useThemeStore.getState().themeData;
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);
        if (!selectedObject || !canvas || !themeData) return;

        resetObjectTheme(selectedObject, canvas, themeData, {
            saveState,
            requestLayerSync,
        });
    },

    // Text Effects Actions
    setTextShadow: (shadowParams) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync } = get();
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
            saveState();
            requestLayerSync();
        }
    },

    setTextStroke: (strokeParams) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync } = get();
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);

        if (selectedObject && (selectedObject.type === 'i-text' || selectedObject.type === 'textbox')) {
            const updates: any = {};
            if (strokeParams.color !== undefined) updates.stroke = strokeParams.color;
            if (strokeParams.width !== undefined) updates.strokeWidth = strokeParams.width;

            selectedObject.set(updates);
            canvas?.requestRenderAll();
            saveState();
            requestLayerSync();
        }
    },

    setTextCharSpacing: (spacing) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync } = get();
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);

        if (selectedObject && (selectedObject.type === 'i-text' || selectedObject.type === 'textbox')) {
            selectedObject.set({ charSpacing: spacing });
            canvas?.requestRenderAll();
            saveState();
            requestLayerSync();
        }
    },

    // Image Adjustment Actions
    setImageBrightness: (value) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync } = get();
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);

        if (selectedObject && selectedObject.type === 'image') {
            const image = selectedObject as fabric.Image;

            // Ensure adjustments property exists
            if (!image.adjustments) {
                image.adjustments = { brightness: 0, contrast: 0, saturation: 0 };
            }

            let brightnessFilter = image.filters?.find(f => f.type === 'Brightness') as fabric.filters.Brightness | undefined;

            if (brightnessFilter) {
                brightnessFilter.brightness = value;
            } else {
                if (!image.filters) image.filters = [];
                brightnessFilter = new fabric.filters.Brightness({ brightness: value });
                (image.filters as any[]).push(brightnessFilter);
            }

            // Update the adjustments property
            image.adjustments.brightness = value;

            image.applyFilters();
            canvas?.requestRenderAll();
            saveState();
            requestLayerSync();
        }
    },

    setImageContrast: (value) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync } = get();
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);

        if (selectedObject && selectedObject.type === 'image') {
            const image = selectedObject as fabric.Image;

            // Ensure adjustments property exists
            if (!image.adjustments) {
                image.adjustments = { brightness: 0, contrast: 0, saturation: 0 };
            }

            let contrastFilter = image.filters?.find(f => f.type === 'Contrast') as fabric.filters.Contrast | undefined;

            if (contrastFilter) {
                contrastFilter.contrast = value;
            } else {
                if (!image.filters) image.filters = [];
                contrastFilter = new fabric.filters.Contrast({ contrast: value });
                (image.filters as any[]).push(contrastFilter);
            }

            // Update the adjustments property
            image.adjustments.contrast = value;

            image.applyFilters();
            canvas?.requestRenderAll();
            saveState();
            requestLayerSync();
        }
    },

    setImageSaturation: (value) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync } = get();
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);

        if (selectedObject && selectedObject.type === 'image') {
            const image = selectedObject as fabric.Image;

            // Ensure adjustments property exists
            if (!image.adjustments) {
                image.adjustments = { brightness: 0, contrast: 0, saturation: 0 };
            }

            let saturationFilter = image.filters?.find(f => f.type === 'Saturation') as fabric.filters.Saturation | undefined;

            if (saturationFilter) {
                saturationFilter.saturation = value;
            } else {
                if (!image.filters) image.filters = [];
                saturationFilter = new fabric.filters.Saturation({ saturation: value });
                (image.filters as any[]).push(saturationFilter);
            }

            // Update the adjustments property
            image.adjustments.saturation = value;

            image.applyFilters();
            canvas?.requestRenderAll();
            saveState();
            requestLayerSync();
        }
    },

    setImageAdjustments: (adjustments) => {
        const { canvas, selectedObjectId, saveState, requestLayerSync } = get();
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);

        if (selectedObject && selectedObject.type === 'image') {
            const image = selectedObject as fabric.Image;

            // Ensure adjustments property exists
            if (!image.adjustments) {
                image.adjustments = { brightness: 0, contrast: 0, saturation: 0 };
            }

            // Update brightness filter
            if (adjustments.brightness !== undefined) {
                let brightnessFilter = image.filters?.find(f => f.type === 'Brightness') as fabric.filters.Brightness | undefined;

                if (brightnessFilter) {
                    brightnessFilter.brightness = adjustments.brightness;
                } else {
                    if (!image.filters) image.filters = [];
                    brightnessFilter = new fabric.filters.Brightness({ brightness: adjustments.brightness });
                    (image.filters as any[]).push(brightnessFilter);
                }

                // Update the adjustments property
                image.adjustments.brightness = adjustments.brightness;
            }

            // Update contrast filter
            if (adjustments.contrast !== undefined) {
                let contrastFilter = image.filters?.find(f => f.type === 'Contrast') as fabric.filters.Contrast | undefined;

                if (contrastFilter) {
                    contrastFilter.contrast = adjustments.contrast;
                } else {
                    if (!image.filters) image.filters = [];
                    contrastFilter = new fabric.filters.Contrast({ contrast: adjustments.contrast });
                    (image.filters as any[]).push(contrastFilter);
                }

                // Update the adjustments property
                image.adjustments.contrast = adjustments.contrast;
            }

            // Update saturation filter
            if (adjustments.saturation !== undefined) {
                let saturationFilter = image.filters?.find(f => f.type === 'Saturation') as fabric.filters.Saturation | undefined;

                if (saturationFilter) {
                    saturationFilter.saturation = adjustments.saturation;
                } else {
                    if (!image.filters) image.filters = [];
                    saturationFilter = new fabric.filters.Saturation({ saturation: adjustments.saturation });
                    (image.filters as any[]).push(saturationFilter);
                }

                // Update the adjustments property
                image.adjustments.saturation = adjustments.saturation;
            }

            image.applyFilters();
            canvas?.requestRenderAll();
            saveState();
            requestLayerSync();
        }
    },

    resetImageAdjustments: () => {
        const { canvas, selectedObjectId, saveState, requestLayerSync } = get();
        const selectedObject = resolveSelectedObject(canvas, selectedObjectId);

        if (selectedObject && selectedObject.type === 'image') {
            const image = selectedObject as fabric.Image;

            // Remove all adjustment filters
            if (image.filters) {
                image.filters = image.filters.filter(f =>
                    f.type !== 'Brightness' &&
                    f.type !== 'Contrast' &&
                    f.type !== 'Saturation'
                );
            }

            // Reset the adjustments property
            image.adjustments = {
                brightness: 0,
                contrast: 0,
                saturation: 0
            };

            image.applyFilters();
            canvas?.requestRenderAll();
            saveState();
            requestLayerSync();
        }
    },

    exportCanvas: async (options) => {
        const { canvas } = get();
        if (!canvas) {
            console.error('Canvas not available for export');
            return;
        }

        try {
            // Handle SVG export separately
            if (options.format === 'svg') {
                const { downloadSvg } = await import('../fabric/exportUtils');
                downloadSvg(canvas, 'design');
            } else {
                // Dynamically import the export function to avoid circular dependencies
                const { downloadExportedCanvas } = await import('../fabric/exportCanvas');
                const exportOptions = {
                    ...options,
                    format: options.format as 'png' | 'jpeg',
                };
                await downloadExportedCanvas(canvas, exportOptions);
            }
        } catch (error) {
            console.error('Export failed:', error);
            set({ toastMessage: 'Export failed. Please try again.' });
        }
    },

    // Project Persistence Actions
    saveProject: async (name) => {
        const { canvas, unitMode } = get();
        if (!canvas) return;
        const { themeData } = useThemeStore.getState();

        try {
            const exportData = await buildExportCanvasData(canvas);

            const payload = {
                canvasData: exportData.canvasData,
                assets: exportData.assets,
                activeTheme: themeData,
                lastUpdated: new Date().toISOString(),
                canvasSize: {
                    width: Math.round(canvas.getWidth()),
                    height: Math.round(canvas.getHeight()),
                },
                unitMode,
            };

            const jsonPayload = JSON.stringify(payload);

            // Generate thumbnail by getting a small version of the canvas
            const thumbnail = canvas.toDataURL({
                format: 'png',
                multiplier: 0.1, // Small thumbnail
                quality: 0.8
            });

            // Import and use the database
            const { db } = await import('../db');
            await db.saveProject(name, jsonPayload, thumbnail);
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

            const { canvas, requestLayerSync, setLayers, setSelectedLayerIds, setSelectedObjectId } = get();
            if (!canvas) return;

            const { canvasData, assets, activeTheme, canvasSize, unitMode } = JSON.parse(result.canvasData);
            const hydratedCanvasData = await import('../fabric/initFabricCanvas').then(mod =>
                mod.hydrateCanvasDataWithAssets(canvasData, assets)
            );

            // Clear canvas and load new data
            canvas.discardActiveObject();
            setLayers([]);
            setSelectedLayerIds([]);
            setSelectedObjectId(null);
            canvas.clear();

            if (canvasSize) {
                canvas.setWidth(Math.max(1, Math.round(canvasSize.width)));
                canvas.setHeight(Math.max(1, Math.round(canvasSize.height)));
            }

            if (unitMode) {
                get().setUnitMode(unitMode);
            }

            await canvas.loadFromJSON(hydratedCanvasData, (await import('../fabric/initFabricCanvas')).reviveCustomFabricProps);
            requestLayerSync();

            // Update theme if available
            if (activeTheme) {
                get().applyTheme(activeTheme);
            }

            useHistoryStore.getState().resetHistory();

            set({
                imageAssets: { ...get().imageAssets, ...assets },
                projectName: result.project.name,
            });

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
        const { projectName, canvas } = get();
        if (!canvas || !projectName) return;

        try {
            const exportData = await buildExportCanvasData(canvas);

            const payload = {
                canvasData: exportData.canvasData,
                assets: exportData.assets,
                activeTheme: useThemeStore.getState().themeData,
                lastUpdated: new Date().toISOString(),
                canvasSize: {
                    width: Math.round(canvas.getWidth()),
                    height: Math.round(canvas.getHeight()),
                },
                unitMode: get().unitMode,
            };

            const jsonPayload = JSON.stringify(payload);

            // Generate thumbnail - using 0.1 multiplier for small, fast thumbnails
            const thumbnail = canvas.toDataURL({
                format: 'png',
                multiplier: 0.1, // Small thumbnail
                quality: 0.8
            });

            // Import and use the database
            const { db } = await import('../db');

            // Find existing project by name and update it
            const projects = await db.getAllProjects();
            const existingProject = projects.find(p => p.name === projectName);

            if (existingProject) {
                await db.updateProject(existingProject.id!, jsonPayload, thumbnail);
            }
        } catch (error) {
            console.error('Failed to update project:', error);
        }
    },

    setAutoSaveStatus: (status) => set({ autoSaveStatus: status }),
    setShowHelpModal: (show) => set({ showHelpModal: show }),
    setShowExportModal: (show) => set({ showExportModal: show }),

    triggerAutoSave: () => {
        const { projectName, updateCurrentProject, setAutoSaveStatus } = get();
        if (!projectName || projectName === 'Untitled Project') return;

        // Set status to saving
        setAutoSaveStatus('saving');

        // Debounced save - wait 2 seconds of inactivity before saving
        const currentTimer = get().autoSaveTimer;
        if (currentTimer !== null) {
            clearTimeout(currentTimer);
        }

        const timer = setTimeout(async () => {
            await updateCurrentProject();
            setAutoSaveStatus('saved');

            // Reset status after 2 seconds
            setTimeout(() => {
                if (get().autoSaveStatus === 'saved') {
                    setAutoSaveStatus('idle');
                }
            }, 2000);
        }, 2000);

        // Store timer reference to clear if another action occurs
        set({ autoSaveTimer: timer });
    },
        });
    },
    {
        name: 'designspace-editor',
        partialize: (state) => ({
            // Theme state is now persisted by the theme store (designspace-theme)
            // We only persist non-theme editor state here
            userTemplates: state.userTemplates,
            assets: state.assets,
            unitMode: state.unitMode,
            unitScale: state.unitScale,
            unitZoom: state.unitZoom,
            showGuides: state.showGuides,
            bleedPx: state.bleedPx,
            isPreviewMode: state.isPreviewMode,
            projectName: state.projectName,
            activeTool: state.activeTool,
            brushSize: state.brushSize,
            snapEnabled: state.snapEnabled,
            gridEnabled: state.gridEnabled,
            autoSaveStatus: state.autoSaveStatus,
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
        if (obj.type === 'group' || obj.type === 'activeSelection') {
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
