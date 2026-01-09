import { createWithEqualityFn } from 'zustand/traditional';
import { persist } from 'zustand/middleware';
import * as fabric from 'fabric';
import { debounce } from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import { 
    saveBrandVaultToDb
} from '../utils/indexedDb';
import { applyActiveThemeToCanvas } from '../fabric/themeUtils';
import { reviveCustomFabricProps } from '../fabric/initFabricCanvas';
import { toSerializableObject } from '../utils/serialization';
import { historyService } from '../utils/historyService';
import { useUiThemeStore } from './uiThemeStore';
import type { ApocapaletteTheme } from '../types/apocapalette';
import { recordDiff, ObjectDiff, SerializedObject } from '../utils/diffSaver';

type HistorySnapshot = {
  type: 'full';
  data: any;
} | {
  type: 'diff';
  data: ObjectDiff;
};

// --- CONSTANTS ---

export interface Template {
  id: string;
  name: string;
  canvasData: string; // Stored as stringified JSON
  defaultThemeId: string;
  thumbnail?: string;
  canvasSize?: { width: number; height: number };
  unitMode?: 'px' | 'in' | 'cm' | 'mm';
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

export interface BrandCollection {
    id: string;
    name: string;
    themeData: ApocapaletteTheme;
    swatches: {
        [key: string]: {
            [key: string]: string;
        }
    }
}

export type EditorTool = 'select' | 'draw' | 'pan' | 'erase';

export type ProjectFilePayload = {
  projectName: string;
  canvasData: any;
  assets?: Record<string, string>;
  activeTheme: ApocapaletteTheme | null;
  lastUpdated: string;
  canvasSize?: { width: number; height: number };
  unitMode?: 'px' | 'in' | 'cm' | 'mm';
};

// --- UTILITY FUNCTIONS ---
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const formatObjectType = (type: string | undefined) => {
  if (!type) return 'Object';
  return type.replace(/-/g, ' ').split(' ').map(capitalize).join(' ');
};
const buildLayerFromObject = (obj: fabric.Object): Layer => ({
  id: (obj as any).id || '',
  name: (obj as any).name || formatObjectType(obj.type),
  type: obj.type || 'object',
  visible: obj.visible ?? true,
  movementLocked: !!obj.lockMovementX,
  colorLocked: !!(obj as any).colorLocked,
});
const getValueByPath = (obj: object, path: string): any => {
    return path.split('.').reduce((acc, part) => acc && (acc as any)[part], obj);
};

const resolveThemeValue = (obj: object, path: string): string | null => {
    let value = getValueByPath(obj, path);
    if (!value && !path.endsWith('.value')) {
        value = getValueByPath(obj, `${path}.value`);
    }
    if (value && typeof value === 'object' && 'value' in value) {
        return (value as { value: string }).value;
    }
    return typeof value === 'string' ? value : null;
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

const createObjectUrlFromDataUrl = (dataUrl: string) => {
    try {
        const [meta, rawData] = dataUrl.split(',');
        if (!rawData) return dataUrl;
        const isBase64 = meta.includes(';base64');
        const mime = meta.split(':')[1]?.split(';')[0] || 'application/octet-stream';
        const decoded = isBase64 ? atob(rawData) : decodeURIComponent(rawData);
        const bytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i += 1) {
            bytes[i] = decoded.charCodeAt(i);
        }
        return URL.createObjectURL(new Blob([bytes], { type: mime }));
    } catch {
        return dataUrl;
    }
};

const getCanvasObjects = (canvasData: any) => {
    if (Array.isArray(canvasData)) {
        return canvasData;
    }
    return canvasData?.objects;
};

const buildCanvasData = (canvasData: any, objects: any[]) => {
    if (!canvasData || Array.isArray(canvasData)) {
        return { objects };
    }
    return { ...canvasData, objects };
};

const prepareCanvasDataForPersistence = (
    canvasData: any,
    imageAssets: Record<string, string>
) => {
    const objects = getCanvasObjects(canvasData);
    if (!Array.isArray(objects)) {
        return { canvasData, imageAssets };
    }
    let nextAssets = imageAssets;
    const nextObjects = objects.map((obj: any) => {
        if (!obj || obj.type !== 'image') return obj;
        const id = typeof obj.id === 'string' && obj.id.trim().length > 0 ? obj.id : uuidv4();
        const src = typeof obj.src === 'string' ? obj.src : '';
        let assetUrl = nextAssets[id];
        if (!assetUrl && src) {
            if (src.startsWith('blob:')) {
                nextAssets = { ...nextAssets, [id]: src };
                assetUrl = src;
            } else if (isDataUrl(src)) {
                const objectUrl = createObjectUrlFromDataUrl(src);
                nextAssets = { ...nextAssets, [id]: objectUrl };
                assetUrl = objectUrl;
            }
        }
        if (assetUrl) {
            return { ...obj, id, src: id };
        }
        if (id !== obj.id) {
            return { ...obj, id };
        }
        return obj;
    });
    return {
        canvasData: buildCanvasData(canvasData, nextObjects),
        imageAssets: nextAssets,
    };
};

export const hydrateCanvasDataWithAssets = (
    canvasData: any,
    imageAssets: Record<string, string>
) => {
    const objects = getCanvasObjects(canvasData);
    if (!Array.isArray(objects)) {
        return canvasData;
    }
    return {
        ...buildCanvasData(canvasData, objects),
        objects: objects.map((obj: any) => {
            if (!obj || obj.type !== 'image') return obj;
            const id = typeof obj.id === 'string' ? obj.id : '';
            const assetUrl = id ? imageAssets[id] : '';
            if (assetUrl) {
                return { ...obj, src: assetUrl };
            }
            return obj;
        }),
    };
};

const findDefaultTheme = (vault: BrandCollection[]) => {
    const byName = vault.find((theme) =>
        theme.name?.toLowerCase() === 'midnight'
        || theme.themeData?.meta?.name?.toLowerCase() === 'midnight'
    );
    return byName || vault[0] || null;
};

// --- EDITOR STATE INTERFACE ---
interface EditorState {
  canvas: fabric.Canvas | null;
  selectedObject: fabric.Object | null;
  layers: Layer[];
  layersById: Record<string, fabric.Object>;
  selectedLayerIds: string[];
  showGuides: boolean;
  brandVault: BrandCollection[];
  activeBrandCollectionId: string | null;
  themeData: ApocapaletteTheme | null;
  toastMessage: string | null;
  historyIndex: number;
  unitMode: 'px' | 'in' | 'cm' | 'mm';
  zoom: number;
  vpt: number[];
  isPreviewMode: boolean;
  brandPalette: { [key: string]: string };
  bleedPx: number;
  canvasBackgroundColor: string | null;
  canvasOffset: { x: number; y: number };
  snapEnabled: boolean;
  gridEnabled: boolean;
  assets: StickerData[];
  templates: Template[];
  userTemplates: Template[];
  imageAssets: Record<string, string>;
  projectName: string;
  isProjectPresetsOpen: boolean;
  activeTool: EditorTool;
  brushSize: number;
  brushColor: string;
  showOnboarding: boolean;
  lastHistorySnapshot: any | null;
  layerSyncHandler: (() => void) | null;
  historyDirty: boolean;

  setCanvas: (canvas: fabric.Canvas | null) => void;
  setSelectedObject: (object: fabric.Object | null) => void;
  setLayers: (objects: fabric.Object[]) => void;
  addLayer: (layer: Layer) => void;
  updateLayer: (id: string, partial: Partial<Layer>) => void;
  removeLayer: (id: string) => void;
  setSelectedLayerIds: (ids: string[]) => void;
  setLayerSyncHandler: (handler: (() => void) | null) => void;
  requestLayerSync: () => void;
  markHistoryDirty: () => void;
  consumeHistoryDirty: () => boolean;
  toggleShowGuides: () => void;
  saveState: (options?: { force?: boolean }) => void;
  setToastMessage: (message: string | null) => void;
  setUnitMode: (mode: 'px' | 'in' | 'cm' | 'mm') => void;
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
  loadTemplate: (template: Template) => void;
  saveCurrentAsTemplate: () => void;
  startNewProject: () => void;
  downloadProjectFile: () => void;
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
  
  // Other actions from original file
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

// --- ZUSTAND STORE IMPLEMENTATION ---
export const useEditorStore = createWithEqualityFn<EditorState>()(
  persist(
    (set, get) => ({
        canvas: null,
        selectedObject: null,
        layers: [],
        layersById: {},
        selectedLayerIds: [],
        showGuides: true,
        brandVault: [],
        activeBrandCollectionId: null,
        themeData: null,
        toastMessage: null,
        historyIndex: -1,
        unitMode: 'px',
        zoom: 1,
        vpt: [1, 0, 0, 1, 0, 0],
        isPreviewMode: false,
        brandPalette: {},
        bleedPx: 0,
        canvasBackgroundColor: null,
        canvasOffset: { x: 0, y: 0 },
        snapEnabled: true,
        gridEnabled: false,
        assets: [],
        templates: [],
        userTemplates: [],
        imageAssets: {},
        projectName: 'Untitled Project',
        isProjectPresetsOpen: false,
        activeTool: 'select',
        brushSize: 8,
        brushColor: '#111111',
        showOnboarding: true,
        lastHistorySnapshot: null,
        layerSyncHandler: null,
        historyDirty: false,

    setCanvas: (canvas) => {
        const currentBackground = get().canvasBackgroundColor;
        const nextBackground =
            currentBackground ?? (canvas?.backgroundColor ? String(canvas.backgroundColor) : null);
        set({ canvas, canvasBackgroundColor: nextBackground });
        if (canvas) {
            get().requestLayerSync();
            if (get().themeData) {
                applyActiveThemeToCanvas();
            }
        }
    },
    setSelectedObject: (object) => set({ selectedObject: object }),
    setSelectedLayerIds: (ids) => set({ selectedLayerIds: ids }),
    setLayers: (objects) => {
        const nextLayers: Layer[] = [];
        const nextById: Record<string, fabric.Object> = {};
        objects.forEach((obj) => {
            if ((obj as any).isGuide) return;
            const layer = buildLayerFromObject(obj);
            if (!layer.id) return;
            nextLayers.push(layer);
            nextById[layer.id] = obj;
        });
        set({ layers: nextLayers, layersById: nextById });
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
    setLayerSyncHandler: (handler) => set({ layerSyncHandler: handler }),
    requestLayerSync: () => {
        const handler = get().layerSyncHandler;
        if (handler) handler();
    },
    markHistoryDirty: () => {
        set({ historyDirty: true });
    },
    consumeHistoryDirty: () => {
        if (!get().historyDirty) return false;
        set({ historyDirty: false });
        return true;
    },
    toggleShowGuides: () => set((state) => ({ showGuides: !state.showGuides })),
    setToastMessage: (message) => set({ toastMessage: message }),
    setUnitMode: (mode) => set({ unitMode: mode }),
    setCanvasBackgroundColor: (color) => {
        const { canvas, saveState } = get();
        if (canvas) {
            canvas.backgroundColor = color;
            canvas.requestRenderAll();
            saveState();
        }
        set({ canvasBackgroundColor: color });
    },
    setZoom: (zoom) => set({ zoom }),
    setVpt: (vpt) => set({ vpt }),
    setCanvasOffset: (offset) => set({ canvasOffset: offset }),
    setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
    setGridEnabled: (enabled) => set({ gridEnabled: enabled }),
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
    setProjectPresetsOpen: (open) => set({ isProjectPresetsOpen: open }),
    setProjectName: (name) => set({ projectName: name }),
    setActiveTool: (tool) => set({ activeTool: tool }),
    setBrushSize: (size) => set({ brushSize: size }),
    setBrushColor: (color) => set({ brushColor: color }),
    loadTemplate: (template) => {
        const { canvas, requestLayerSync, brandVault, applyTheme, setToastMessage, resetViewCanvas } = get();
        if (!canvas) return;

        canvas.clear();
        set({ canvasBackgroundColor: canvas.backgroundColor ? String(canvas.backgroundColor) : null });

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
            set({ unitMode: template.unitMode });
        }

        const themeToApply = template.defaultThemeId
            ? brandVault.find((brand) => brand.id === template.defaultThemeId)
            : null;

        canvas.loadFromJSON(template.canvasData, reviveCustomFabricProps).then(() => {
            resetViewCanvas();
            sanityCheckCanvas(canvas, themeToApply?.themeData ?? get().themeData);
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
        const { canvas, activeBrandCollectionId, userTemplates, unitMode } = get();
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
        const { canvas, brandVault, requestLayerSync } = get();
        if (canvas) {
            canvas.discardActiveObject();
            canvas.clear();
            requestLayerSync();
        }

        historyService.reset();
        const defaultTheme = findDefaultTheme(brandVault);
        if (defaultTheme) {
            set({ themeData: defaultTheme.themeData, activeBrandCollectionId: defaultTheme.id });
            applyActiveThemeToCanvas();
        } else {
            set({ themeData: null, activeBrandCollectionId: null });
        }

        set({
            historyIndex: historyService.currentIndex,
            projectName: 'Untitled Project',
            isProjectPresetsOpen: true,
            canvasBackgroundColor: null,
            lastHistorySnapshot: null,
        });
    },

    downloadProjectFile: () => {
        const {
            canvas,
            themeData,
            activeBrandCollectionId,
            brandVault,
            projectName,
            setToastMessage,
            imageAssets,
            unitMode,
        } = get();
        if (!canvas) return;

        const fallbackTheme = themeData
            || brandVault.find((brand) => brand.id === activeBrandCollectionId)?.themeData
            || null;

        const serializedObjects = canvas.getObjects().map(toSerializableObject);
        const baseCanvasData = {
            objects: serializedObjects,
            background: canvas.backgroundColor || undefined,
        };
        const { canvasData, imageAssets: nextAssets } = prepareCanvasDataForPersistence(
            baseCanvasData,
            imageAssets
        );
        if (nextAssets !== imageAssets) {
            set({ imageAssets: nextAssets });
        }

        const payload: ProjectFilePayload = {
            projectName: projectName || 'Untitled Project',
            canvasData,
            assets: nextAssets,
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
        const { canvas, requestLayerSync, setToastMessage, resetViewCanvas } = get();
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
                set({ unitMode: rawUnitMode });
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
            historyService.reset();

            set({
                projectName,
                historyIndex: historyService.currentIndex,
                isProjectPresetsOpen: false,
                canvasBackgroundColor: canvas.backgroundColor ? String(canvas.backgroundColor) : null,
                imageAssets: nextAssets,
            });

            if (activeTheme) {
                set({ themeData: activeTheme, activeBrandCollectionId: null });
                applyActiveThemeToCanvas();
                const { projectSyncEnabled, applyThemeFromTokens } = useUiThemeStore.getState();
                if (projectSyncEnabled) {
                    applyThemeFromTokens(activeTheme);
                }
            } else {
                set({ themeData: null, activeBrandCollectionId: null });
            }

            setToastMessage(`Project loaded: ${projectName}`);
        } catch (error) {
            setToastMessage('Failed to load project file.');
        }
    },
    
    saveState: debounce((options?: { force?: boolean }) => {
        const { canvas, imageAssets, lastHistorySnapshot } = get();
        if (!canvas) return;
        set({ historyDirty: false });

        const currentObjects = canvas.getObjects().map(toSerializableObject) as SerializedObject[];
        const background = canvas.backgroundColor || undefined;
        let snapshot: HistorySnapshot;

        if (!lastHistorySnapshot || historyService.length === 0) {
            const canvasData = { objects: currentObjects, background };
            snapshot = { type: 'full', data: canvasData };
        } else {
            const diff = recordDiff(lastHistorySnapshot.objects, currentObjects);
            if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
                return; // No changes, no need to save
            }
            snapshot = { type: 'diff', data: diff };
        }

        const { imageAssets: nextAssets } = prepareCanvasDataForPersistence(
            { objects: currentObjects, background },
            imageAssets
        );

        historyService.pushSnapshot(JSON.stringify(snapshot), options);
        
        set({ 
            historyIndex: historyService.currentIndex,
            lastHistorySnapshot: { objects: currentObjects, background },
            imageAssets: nextAssets,
        });
    }, 300),

    undo: async () => {
        const { canvas, requestLayerSync, imageAssets } = get();
        if (!canvas || !historyService.canUndo()) return;

        const snapshotStr = historyService.undo();
        if (!snapshotStr) return;
        
        let snapshot: HistorySnapshot;
        try {
            snapshot = JSON.parse(snapshotStr);
            if (!snapshot.type) throw new Error('Legacy snapshot');
        } catch (e) {
            // Legacy snapshot
            const prevState = JSON.parse(snapshotStr);
            const hydratedState = hydrateCanvasDataWithAssets(prevState, imageAssets);
            await new Promise<void>(resolve => {
                canvas.loadFromJSON(hydratedState, () => {
                    canvas.requestRenderAll();
                    set({ 
                        historyIndex: historyService.currentIndex, 
                        selectedObject: null,
                        lastHistorySnapshot: prevState,
                    });
                    requestLayerSync();
                    resolve();
                });
            });
            return;
        }

        if (snapshot.type === 'full') {
            const hydratedState = hydrateCanvasDataWithAssets(snapshot.data, imageAssets);
            await new Promise<void>(resolve => {
                canvas.loadFromJSON(hydratedState, () => {
                    canvas.requestRenderAll();
                    set({ 
                        historyIndex: historyService.currentIndex,
                        selectedObject: null,
                        lastHistorySnapshot: snapshot.data,
                    });
                    requestLayerSync();
                    resolve();
                });
            });
        } else if (snapshot.type === 'diff') {
            const diff = snapshot.data;
            
            diff.added.forEach(objToAdd => {
                const objToRemove = canvas.getObjects().find(o => (o as any).id === objToAdd.id);
                if (objToRemove) canvas.remove(objToRemove);
            });

            const removedObjects = await fabric.util.enlivenObjects(diff.removed) as fabric.Object[];
            removedObjects.forEach(obj => canvas.add(obj));

            const changedObjects = await fabric.util.enlivenObjects(diff.changed.map(c => c.prev));
            changedObjects.forEach(prevObj => {
                const targetObj = canvas.getObjects().find(o => (o as any).id === (prevObj as any).id);
                if (targetObj) {
                    const oldProps = prevObj.toObject();
                    delete oldProps.type;
                    targetObj.set(oldProps);
                }
            });

            const newObjects = canvas.getObjects().map(toSerializableObject);
            const background = canvas.backgroundColor || undefined;
            set({
                historyIndex: historyService.currentIndex,
                selectedObject: null,
                lastHistorySnapshot: { objects: newObjects, background },
            });
            requestLayerSync();
            canvas.requestRenderAll();
        }
    },

    redo: async () => {
        const { canvas, requestLayerSync, imageAssets } = get();
        if (!canvas || !historyService.canRedo()) return;

        const snapshotStr = historyService.redo();
        if (!snapshotStr) return;

        let snapshot: HistorySnapshot;
        try {
            snapshot = JSON.parse(snapshotStr);
            if (!snapshot.type) throw new Error('Legacy snapshot');
        } catch (e) {
            // Legacy snapshot
            const nextState = JSON.parse(snapshotStr);
            const hydratedState = hydrateCanvasDataWithAssets(nextState, imageAssets);
            await new Promise<void>(resolve => {
                canvas.loadFromJSON(hydratedState, () => {
                    canvas.requestRenderAll();
                    set({ 
                        historyIndex: historyService.currentIndex,
                        selectedObject: null,
                        lastHistorySnapshot: nextState,
                    });
                    requestLayerSync();
                    resolve();
                });
            });
            return;
        }

        if (snapshot.type === 'full') {
            const hydratedState = hydrateCanvasDataWithAssets(snapshot.data, imageAssets);
            await new Promise<void>(resolve => {
                canvas.loadFromJSON(hydratedState, () => {
                    canvas.requestRenderAll();
                    set({
                        historyIndex: historyService.currentIndex,
                        selectedObject: null,
                        lastHistorySnapshot: snapshot.data,
                    });
                    requestLayerSync();
                    resolve();
                });
            });
        } else if (snapshot.type === 'diff') {
            const diff = snapshot.data;

            const addedObjects = await fabric.util.enlivenObjects(diff.added) as fabric.Object[];
            addedObjects.forEach(obj => canvas.add(obj));

            diff.removed.forEach(objToRemove => {
                const obj = canvas.getObjects().find(o => (o as any).id === objToRemove.id);
                if (obj) canvas.remove(obj);
            });

            const changedObjects = await fabric.util.enlivenObjects(diff.changed.map(c => c.next));
            changedObjects.forEach(nextObj => {
                const targetObj = canvas.getObjects().find(o => (o as any).id === (nextObj as any).id);
                if (targetObj) {
                    const newProps = nextObj.toObject();
                    delete newProps.type;
                    targetObj.set(newProps);
                }
            });
            
            const newObjects = canvas.getObjects().map(toSerializableObject);
            const background = canvas.backgroundColor || undefined;
            set({
                historyIndex: historyService.currentIndex,
                selectedObject: null,
                lastHistorySnapshot: { objects: newObjects, background },
            });
            requestLayerSync();
            canvas.requestRenderAll();
        }
    },

    // --- THEME ACTIONS ---
    addThemeToVault: (jsonString: string) => {
        try {
            const json: ApocapaletteTheme = JSON.parse(jsonString);
            if (json.meta?.schema && json.meta.schema !== 'generic-token-pack-v1') {
                set({ toastMessage: 'Invalid Schema' });
                return;
            }
            const newCollection: BrandCollection = {
                id: uuidv4(),
                name: json.meta.name || 'Untitled Theme',
                themeData: json,
                swatches: {
                    'Brand': {
                        'Primary': json.brand?.primary?.value || '#000000',
                        'Secondary': json.brand?.secondary?.value || '#888888',
                        'Accent': json.brand?.accent?.value || '#ff00ff',
                    }
                }
            };
            const newVault = [...get().brandVault, newCollection];
            set({ brandVault: newVault, activeBrandCollectionId: newCollection.id });
            saveBrandVaultToDb(newVault);
            get().applyTheme(json);
            set({ toastMessage: `Theme Imported: ${newCollection.name}` });
        } catch (e) {
            set({ toastMessage: 'Invalid Theme File' });
        }
    },

    setActiveBrandCollectionId: (id) => {
        const { brandVault, applyTheme } = get();
        const selectedTheme = brandVault.find(brand => brand.id === id);
        if (selectedTheme) {
            applyTheme(selectedTheme.themeData);
            set({ activeBrandCollectionId: id, toastMessage: `Theme Changed: ${selectedTheme.name}` });
        }
    },
    
    applyTheme: (theme) => {
        set({ themeData: theme });
        setTimeout(() => applyActiveThemeToCanvas(), 50);
    },

    resetTheme: () => {
        const { canvas, saveState } = get();
        if (!canvas) return;
        canvas.getObjects().forEach(obj => {
            (obj as any).tokenRole = null;
        });
        canvas.requestRenderAll();
        saveState();
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
        const { canvas, selectedObject, saveState, requestLayerSync } = get();
        if (selectedObject && canvas) {
            selectedObject.set({ fill, tokenRole: null });
            canvas.requestRenderAll();
            saveState();
            requestLayerSync();
        }
    },

    setObjectThemedFill: (tokenRole) => {
        const { canvas, selectedObject, themeData, saveState, requestLayerSync } = get();
        if (selectedObject && canvas && themeData) {
            const colorValue = resolveThemeValue(themeData, tokenRole);
            if (colorValue) {
                selectedObject.set({ fill: colorValue, tokenRole, colorLocked: false });
                canvas.requestRenderAll();
                saveState();
                requestLayerSync();
            }
        }
    },

    applyTint: (tokenRole) => {
        const { canvas, selectedObject, themeData, saveState, requestLayerSync } = get();
        const image = selectedObject as fabric.Image;
        if (image && image.type === 'image' && canvas && themeData) {
            const colorValue = resolveThemeValue(themeData, tokenRole);
            if (!colorValue) return;

            image.filters = image.filters?.filter(f => f.type !== 'BlendColor');
            image.filters?.push(new fabric.filters.BlendColor({
                color: colorValue,
                mode: 'tint',
                alpha: 0.5
            }));
            
            image.applyFilters();
            canvas.requestRenderAll();
            saveState();
            requestLayerSync();
        }
    },

    resetObjectToDefaultTheme: () => {
        const { canvas, selectedObject, themeData, saveState, requestLayerSync } = get();
        if (!selectedObject || !canvas || !themeData) return;

        let defaultTokenRole: string | null = null;
        if (selectedObject.type === 'i-text' || selectedObject.type === 'textbox') {
             defaultTokenRole = (selectedObject as any).role === 'heading' ? 'typography.heading.value' : 'typography.body.value';
        } else if (selectedObject.type === 'image') {
            defaultTokenRole = 'brand.accent.value';
        } else {
            defaultTokenRole = 'brand.primary.value';
        }
        
        if (defaultTokenRole) {
            const colorValue = resolveThemeValue(themeData, defaultTokenRole);
            if (colorValue) {
                selectedObject.set({
                    fill: colorValue,
                    tokenRole: defaultTokenRole,
                    colorLocked: false,
                });
                if (selectedObject.type === 'image') {
                    (selectedObject as fabric.Image).filters = [];
                    (selectedObject as fabric.Image).applyFilters();
                }
                canvas.requestRenderAll();
                saveState();
                requestLayerSync();
            }
        }
    },
    }),
    {
        name: 'designspace-editor',
        partialize: (state) => ({
            themeData: state.themeData,
            brandVault: state.brandVault,
            activeBrandCollectionId: state.activeBrandCollectionId,
            userTemplates: state.userTemplates,
            assets: state.assets,
            unitMode: state.unitMode,
            showGuides: state.showGuides,
            bleedPx: state.bleedPx,
            isPreviewMode: state.isPreviewMode,
            projectName: state.projectName,
            canvasBackgroundColor: state.canvasBackgroundColor,
            activeTool: state.activeTool,
            brushSize: state.brushSize,
            brushColor: state.brushColor,
            snapEnabled: state.snapEnabled,
            gridEnabled: state.gridEnabled,
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

    if (changed) {
        canvas.requestRenderAll();
        useEditorStore.getState().requestLayerSync();
    }

    return report;
};
