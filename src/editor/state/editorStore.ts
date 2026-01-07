import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as fabric from 'fabric';
import { debounce } from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import { 
    saveBrandVaultToDb
} from '../utils/indexedDb';
import { applyActiveThemeToCanvas } from '../fabric/themeUtils';
import { reviveCustomFabricProps } from '../fabric/initFabricCanvas';
import { useUiThemeStore } from './uiThemeStore';
import type { ApocapaletteTheme } from '../types/apocapalette';

// --- CONSTANTS ---
const MAX_HISTORY_SIZE = 50;
const AUTOSAVE_STORAGE_KEY = 'witchclick_current_design';

export interface Template {
  id: string;
  name: string;
  canvasData: string; // Stored as stringified JSON
  defaultThemeId: string;
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
    format?: 'svg' | 'png';
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
  activeTheme: ApocapaletteTheme | null;
  lastUpdated: string;
};

// --- UTILITY FUNCTIONS ---
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const formatObjectType = (type: string | undefined) => {
  if (!type) return 'Object';
  return type.replace(/-/g, ' ').split(' ').map(capitalize).join(' ');
};
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
  selectedLayerId: string | null;
  showGuides: boolean;
  brandVault: BrandCollection[];
  activeBrandCollectionId: string | null;
  themeData: ApocapaletteTheme | null;
  toastMessage: string | null;
  history: string[];
  historyIndex: number;
  unitMode: 'px' | 'in' | 'cm' | 'mm';
  zoom: number;
  vpt: number[];
  isPreviewMode: boolean;
  brandPalette: { [key: string]: string };
  bleedPx: number;
  canvasBackgroundColor: string | null;
  canvasOffset: { x: number; y: number };
  assets: StickerData[];
  templates: Template[];
  userTemplates: Template[];
  projectName: string;
  isProjectPresetsOpen: boolean;
  activeTool: EditorTool;
  brushSize: number;
  brushColor: string;

  setCanvas: (canvas: fabric.Canvas | null) => void;
  setSelectedObject: (object: fabric.Object | null) => void;
  setLayers: (objects: fabric.Object[]) => void;
  setSelectedLayerId: (id: string | null) => void;
  toggleShowGuides: () => void;
  saveState: () => void;
  setToastMessage: (message: string | null) => void;
  setUnitMode: (mode: 'px' | 'in' | 'cm' | 'mm') => void;
  setCanvasBackgroundColor: (color: string) => void;
  setZoom: (zoom: number) => void;
  setVpt: (vpt: number[]) => void;
  setCanvasOffset: (offset: { x: number; y: number }) => void;
  resetViewCanvas: () => void;
  addAssetToLibrary: (asset: StickerData) => void;
  removeAssetFromLibrary: (id: string) => void;
  setTemplates: (templates: Template[]) => void;
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
  undo: () => void;
  redo: () => void;
}

// --- ZUSTAND STORE IMPLEMENTATION ---
export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
        canvas: null,
        selectedObject: null,
        layers: [],
        selectedLayerId: null,
        showGuides: true,
        brandVault: [],
        activeBrandCollectionId: null,
        themeData: null,
        toastMessage: null,
        history: [],
        historyIndex: -1,
        unitMode: 'px',
        zoom: 1,
        vpt: [1, 0, 0, 1, 0, 0],
        isPreviewMode: false,
        brandPalette: {},
        bleedPx: 0,
        canvasBackgroundColor: null,
        canvasOffset: { x: 0, y: 0 },
        assets: [],
        templates: [],
        userTemplates: [],
        projectName: 'Untitled Project',
        isProjectPresetsOpen: false,
        activeTool: 'select',
        brushSize: 8,
        brushColor: '#111111',

    setCanvas: (canvas) => {
        const currentBackground = get().canvasBackgroundColor;
        const nextBackground =
            currentBackground ?? (canvas?.backgroundColor ? String(canvas.backgroundColor) : null);
        set({ canvas, canvasBackgroundColor: nextBackground });
        if (canvas) {
            get().setLayers(canvas.getObjects());
            if (get().themeData) {
                applyActiveThemeToCanvas();
            }
        }
    },
    setSelectedObject: (object) => set({ selectedObject: object }),
    setSelectedLayerId: (id) => set({ selectedLayerId: id }),
    setLayers: (objects) => {
        const newLayers = objects
            .filter(obj => !(obj as any).isGuide)
            .map((obj): Layer => ({
                id: (obj as any).id || '',
                name: (obj as any).name || formatObjectType(obj.type),
                type: obj.type || 'object',
                visible: obj.visible ?? true,
                movementLocked: !!obj.lockMovementX,
                colorLocked: !!(obj as any).colorLocked,
            }));
        set({ layers: newLayers });
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
    resetViewCanvas: () => {
        const { canvas } = get();
        if (canvas) {
            const center = canvas.getCenter();
            const nextVpt = [1, 0, 0, 1, center.left, center.top] as fabric.TMat2D;
            canvas.setViewportTransform(nextVpt);
            canvas.setZoom(1);
            set({ zoom: 1, vpt: nextVpt });
        }
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
    setProjectPresetsOpen: (open) => set({ isProjectPresetsOpen: open }),
    setProjectName: (name) => set({ projectName: name }),
    setActiveTool: (tool) => set({ activeTool: tool }),
    setBrushSize: (size) => set({ brushSize: size }),
    setBrushColor: (color) => set({ brushColor: color }),
    loadTemplate: (template) => {
        const { canvas, setLayers, brandVault, applyTheme, setToastMessage } = get();
        if (!canvas) return;

        canvas.clear();
        set({ canvasBackgroundColor: canvas.backgroundColor ? String(canvas.backgroundColor) : null });
        const themeToApply = template.defaultThemeId
            ? brandVault.find((brand) => brand.id === template.defaultThemeId)
            : null;

        canvas.loadFromJSON(template.canvasData, reviveCustomFabricProps).then(() => {
            canvas.requestRenderAll();
            sanityCheckCanvas(canvas, themeToApply?.themeData ?? get().themeData);
            setLayers(canvas.getObjects());
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
        const { canvas, activeBrandCollectionId, userTemplates } = get();
        if (!canvas) return;
        const json = canvas.toJSON();
        const thumbnail = canvas.toDataURL({ multiplier: 0.1 });
        const newTemplate: Template = {
            id: uuidv4(),
            name: `Template ${new Date().toISOString()}`,
            canvasData: JSON.stringify(json),
            defaultThemeId: activeBrandCollectionId || '',
            thumbnail,
        };
        const nextTemplates = [newTemplate, ...userTemplates];
        set({ userTemplates: nextTemplates, toastMessage: `Saved template: ${newTemplate.name}` });
    },

    startNewProject: () => {
        const { canvas, brandVault, setLayers } = get();
        if (canvas) {
            canvas.discardActiveObject();
            canvas.clear();
            setLayers([]);
        }

        const defaultTheme = findDefaultTheme(brandVault);
        if (defaultTheme) {
            set({ themeData: defaultTheme.themeData, activeBrandCollectionId: defaultTheme.id });
            applyActiveThemeToCanvas();
        } else {
            set({ themeData: null, activeBrandCollectionId: null });
        }

        set({
            history: [],
            historyIndex: -1,
            projectName: 'Untitled Project',
            isProjectPresetsOpen: true,
            canvasBackgroundColor: null,
        });
    },

    downloadProjectFile: () => {
        const { canvas, themeData, activeBrandCollectionId, brandVault, projectName, setToastMessage } = get();
        if (!canvas) return;

        const fallbackTheme = themeData
            || brandVault.find((brand) => brand.id === activeBrandCollectionId)?.themeData
            || null;

        const payload: ProjectFilePayload = {
            projectName: projectName || 'Untitled Project',
            canvasData: canvas.toJSON(),
            activeTheme: fallbackTheme,
            lastUpdated: new Date().toISOString(),
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
        const { canvas, setLayers, setToastMessage } = get();
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

            let canvasData = raw.canvasData;
            if (!canvasData) {
                throw new Error('Missing canvas data');
            }
            if (typeof canvasData === 'string') {
                canvasData = JSON.parse(canvasData);
            }

            canvas.discardActiveObject();
            canvas.clear();
            await canvas.loadFromJSON(canvasData, reviveCustomFabricProps);
            canvas.requestRenderAll();

            sanityCheckCanvas(canvas, activeTheme);
            setLayers(canvas.getObjects());

            set({
                projectName,
                history: [],
                historyIndex: -1,
                isProjectPresetsOpen: false,
                canvasBackgroundColor: canvas.backgroundColor ? String(canvas.backgroundColor) : null,
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
    
    saveState: debounce(() => {
        const { canvas, history, historyIndex } = get();
        if (!canvas) return;
        const json = canvas.toJSON();
        const serialized = JSON.stringify(json);
        
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(serialized);
        if (newHistory.length > MAX_HISTORY_SIZE) newHistory.shift();
        
        set({ history: newHistory, historyIndex: newHistory.length - 1 });
        if (typeof window !== 'undefined') {
            try {
                localStorage.setItem(AUTOSAVE_STORAGE_KEY, serialized);
            } catch {
                // ignore storage failures
            }
        }
    }, 300),

    undo: () => {
        const { history, historyIndex, canvas, setLayers } = get();
        if (historyIndex > 0 && canvas) {
            const prevState = JSON.parse(history[historyIndex - 1]);
            canvas.loadFromJSON(prevState, () => {
                canvas.requestRenderAll();
                set({ historyIndex: historyIndex - 1, selectedObject: null });
                setLayers(canvas.getObjects());
            });
        }
    },

    redo: () => {
        const { history, historyIndex, canvas, setLayers } = get();
        if (historyIndex < history.length - 1 && canvas) {
            const nextState = JSON.parse(history[historyIndex + 1]);
            canvas.loadFromJSON(nextState, () => {
                canvas.requestRenderAll();
                set({ historyIndex: historyIndex + 1, selectedObject: null });
                setLayers(canvas.getObjects());
            });
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
        const { canvas, setLayers, saveState } = get();
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
            setLayers(canvas!.getObjects());
            saveState();
        }
    },

    toggleColorLock: (layerId) => {
        const { canvas, setLayers, saveState } = get();
        const obj = canvas?.getObjects().find(o => (o as any).id === layerId);
        if (obj) {
            (obj as any).colorLocked = !(obj as any).colorLocked;
            setLayers(canvas!.getObjects());
            saveState();
        }
    },

    setObjectFill: (fill) => {
        const { canvas, selectedObject, saveState } = get();
        if (selectedObject && canvas) {
            selectedObject.set({ fill, tokenRole: null });
            canvas.requestRenderAll();
            saveState();
        }
    },

    setObjectThemedFill: (tokenRole) => {
        const { canvas, selectedObject, themeData, saveState } = get();
        if (selectedObject && canvas && themeData) {
            const colorValue = resolveThemeValue(themeData, tokenRole);
            if (colorValue) {
                selectedObject.set({ fill: colorValue, tokenRole, colorLocked: false });
                canvas.requestRenderAll();
                saveState();
            }
        }
    },

    applyTint: (tokenRole) => {
        const { canvas, selectedObject, themeData, saveState } = get();
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
        }
    },

    resetObjectToDefaultTheme: () => {
        const { canvas, selectedObject, themeData, saveState, setLayers } = get();
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
                setLayers(canvas.getObjects());
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
        useEditorStore.getState().setLayers(canvas.getObjects());
    }

    return report;
};
