import { create } from 'zustand';
import * as fabric from 'fabric';
import { debounce } from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import { 
    saveBrandVaultToDb
} from '../utils/indexedDb';
import { applyActiveThemeToCanvas } from '../fabric/themeUtils';
import { reviveCustomFabricProps } from '../fabric/initFabricCanvas';

// --- CONSTANTS ---
const MAX_HISTORY_SIZE = 50;

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

export interface ApocapaletteTheme {
    meta: { schema: string; name: string; };
    [key: string]: any;
}

export interface StickerData {
    id: string;
    url: string;
    tags: string[];
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
  customStickers: StickerData[];
  templates: Template[];
  userTemplates: Template[];

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
  resetViewCanvas: () => void;
  addCustomSticker: (url: string) => void;
  removeCustomSticker: (id: string) => void;
  setTemplates: (templates: Template[]) => void;
  loadTemplate: (template: Template) => void;
  saveCurrentAsTemplate: () => void;
  
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
export const useEditorStore = create<EditorState>((set, get) => ({
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
    customStickers: [],
    templates: [],
    userTemplates: (() => {
        if (typeof window === 'undefined') return [];
        try {
            const stored = localStorage.getItem('designspace_user_templates');
            return stored ? (JSON.parse(stored) as Template[]) : [];
        } catch {
            return [];
        }
    })(),

    setCanvas: (canvas) => {
        set({ canvas });
        if (canvas) {
            get().setLayers(canvas.getObjects());
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
    },
    setZoom: (zoom) => set({ zoom }),
    resetViewCanvas: () => {
        const { canvas } = get();
        if (canvas) {
            const center = canvas.getCenter();
            canvas.setViewportTransform([1, 0, 0, 1, center.left, center.top]);
            canvas.setZoom(1);
            set({ zoom: 1 });
        }
    },
    addCustomSticker: (url) => {
        const newSticker: StickerData = { id: uuidv4(), url, tags: [] };
        set((state) => ({ customStickers: [...state.customStickers, newSticker] }));
    },
    removeCustomSticker: (id) => {
        set((state) => ({
            customStickers: state.customStickers.filter((s) => s.id !== id),
        }));
    },
    setTemplates: (templates) => set({ templates }),
    loadTemplate: (template) => {
        const { canvas, setLayers, brandVault, applyTheme, setToastMessage } = get();
        if (!canvas) return;

        canvas.clear();
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
        try {
            localStorage.setItem('designspace_user_templates', JSON.stringify(nextTemplates));
        } catch {
            // ignore storage failures
        }
    },
    
    saveState: debounce(() => {
        const { canvas, history, historyIndex } = get();
        if (!canvas) return;
        const json = canvas.toJSON();
        
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(JSON.stringify(json));
        if (newHistory.length > MAX_HISTORY_SIZE) newHistory.shift();
        
        set({ history: newHistory, historyIndex: newHistory.length - 1 });
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
            if (json.meta?.schema !== 'generic-token-pack-v1') {
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
}));

export const sanityCheckCanvas = (canvas: fabric.Canvas, themeData: ApocapaletteTheme | null) => {
    let changed = false;
    const report = { missingIds: 0, invalidRoles: 0 };

    const walk = (obj: fabric.Object) => {
        const target = obj as any;
        if (!target.id) {
            target.id = uuidv4();
            report.missingIds += 1;
            changed = true;
        }
        if (target.colorLocked === undefined) {
            target.colorLocked = false;
            changed = true;
        }
        const tokenRole = target.tokenRole;
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
