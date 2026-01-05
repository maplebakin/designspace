
import { create } from 'zustand';
import * as fabric from 'fabric';
import { debounce } from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import { 
    addTemplateToDb, 
    deleteTemplateFromDb, 
    getTemplatesFromDb, 
    TemplateData,
    getBrandVaultFromDb,
    saveBrandVaultToDb
} from '../utils/indexedDb';
import { clearBleedGuides, clearSafeMarginGuides } from '../fabric/canvasUtils';

const MAX_HISTORY_SIZE = 50;
const CUSTOM_STICKERS_STORAGE_KEY = 'witchclick_custom_stickers';

type UnitMode = 'px' | 'in';

export interface Layer {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
}

export interface StickerData {
  id: string;
  imageUrl: string;
  name?: string;
  tags: string[];
  category: string;
}

export interface ApocapaletteTheme {
    meta: {
        schema: string;
        name: string;
    };
    [key: string]: any; // for foundation, brand, etc.
}

export interface CategorizedSwatches {
    [category: string]: { [name: string]: string };
}

export interface BrandCollection {
    id: string;
    name: string;
    themeData: ApocapaletteTheme; // Store the whole theme
    swatches: CategorizedSwatches;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const formatObjectType = (type: string | undefined) => {
  if (!type) return 'Object';
  return type.replace(/-/g, ' ').split(' ').map(capitalize).join(' ');
};

interface EditorState {
  canvas: fabric.Canvas | null;
  selectedObject: fabric.Object | null;
  hoveredObject: fabric.Object | null;
  layers: Layer[];
  selectedLayerId: string | null;
  showGuides: boolean;
  brandVault: BrandCollection[];
  activeBrandCollectionId: string | null;
  themeData: ApocapaletteTheme | null; // Full active theme
  themeFonts: {
    heading: string;
    body: string;
  };
  customFonts: string[];
  customStickers: StickerData[];
  templates: TemplateData[];
  toastMessage: string | null;
  unitMode: UnitMode;
  bleedPx: number;
  history: string[];
  historyIndex: number;
  isLoading: boolean;
  isTemplateSaving: boolean;
  isTemplateLoading: boolean;
  zoom: number;
  vpt: number[];
  setVpt: (vpt: number[]) => void;
  setCanvas: (canvas: fabric.Canvas | null) => void;
  setSelectedObject: (object: fabric.Object | null) => void;
  setHoveredObject: (object: fabric.Object | null) => void;
  setObjectFill: (fill: string) => void;
  setObjectThemedFill: (tokenRole: string, fill: string) => void;
  setLayers: (objects: fabric.Object[]) => void;
  setSelectedLayerId: (id: string | null) => void;
  setThemeData: (themeData: ApocapaletteTheme | null) => void;
  toggleShowGuides: () => void;
  saveState: () => void;
  undo: () => void;
  redo: () => void;
  setZoom: (zoom: number) => void;
  fitToScreen: () => void;
  addThemeToVault: (jsonString: string) => void;
  applyTheme: (theme: ApocapaletteTheme) => void;
  resetTheme: () => void;
  setToastMessage: (message: string | null) => void;
  setUnitMode: (mode: UnitMode) => void;
  setBleedPx: (value: number) => void;
  resetViewCanvas: (() => void) | null;
  setResetViewCanvas: (fn: (() => void) | null) => void;
  isPreviewMode: boolean; 
  togglePreviewMode: () => void;
  loadBrandVault: () => Promise<void>;
  setActiveBrandCollectionId: (id: string) => void;
  addCustomFont: (fontName: string) => void;
  addCustomSticker: (sticker: StickerData) => Promise<void>;
  removeCustomSticker: (id: string) => void;
  loadTemplates: () => Promise<void>;
  saveTemplate: (name: string) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  loadTemplate: (template: TemplateData) => Promise<void>;
}

const loadCustomStickersFromLocalStorage = (): StickerData[] => {
  const savedStickers = localStorage.getItem(CUSTOM_STICKERS_STORAGE_KEY);
  if (savedStickers) {
    return JSON.parse(savedStickers);
  }
  return [];
};

const saveCustomStickersToLocalStorage = (stickers: StickerData[]) => {
  localStorage.setItem(CUSTOM_STICKERS_STORAGE_KEY, JSON.stringify(stickers));
};

const swatchCategories: { [category: string]: { [name: string]: string } } = {
    'Brand': {
        'Primary': 'brand.primary.value',
        'Secondary': 'brand.secondary.value',
        'Accent': 'brand.accent.value',
    },
    'Foundation': {
        'Base': 'foundation.base.value',
        'Surface': 'foundation.surface.value',
        'Overlay': 'foundation.overlay.value',
    },
    'Typography & UI': {
        'Heading': 'typography.heading.value',
        'Body': 'typography.body.value',
        'Muted': 'typography.muted.value',
    }
};

const recursivelyExtractValues = (obj: any, path: string = ''): { [key: string]: string } => {
    let result: { [key: string]: string } = {};
    for (const key in obj) {
        if (typeof obj[key] === 'object' && obj[key] !== null && 'value' in obj[key]) {
             const newPath = path ? `${path}.${key}` : key;
             result[newPath] = obj[key].value;
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            const newPath = path ? `${path}.${key}` : key;
            result = { ...result, ...recursivelyExtractValues(obj[key], newPath) };
        }
    }
    return result;
};

const useEditorStore = create<EditorState>((set, get) => {
  const initialCustomStickers = loadCustomStickersFromLocalStorage();

  return {
    canvas: null,
    selectedObject: null,
    hoveredObject: null,
    layers: [],
    selectedLayerId: null,
    showGuides: true,
    brandVault: [],
    activeBrandCollectionId: null,
    themeData: null,
    themeFonts: {
      heading: 'serif',
      body: 'sans-serif',
    },
    customFonts: [],
    customStickers: initialCustomStickers,
    toastMessage: null,
    unitMode: 'px',
    history: [],
    historyIndex: -1,
    isLoading: false,
    isTemplateSaving: false,
    isTemplateLoading: false,
    zoom: 1,
    vpt: [1, 0, 0, 1, 0, 0],
    bleedPx: 8,
    templates: [],
    isPreviewMode: false,

    setVpt: (vpt) => set({ vpt }),
    setCanvas: (canvas) => {
        set({
            canvas,
            zoom: canvas ? canvas.getZoom() : 1,
            vpt: canvas ? canvas.viewportTransform : [1, 0, 0, 1, 0, 0],
        });
        if (canvas) {
            get().setLayers(canvas.getObjects());
        }
        get().loadBrandVault();
    },
    setSelectedObject: (object) => set({ selectedObject: object }),
    setHoveredObject: (object) => set({ hoveredObject: object }),
    resetViewCanvas: null, 
    setResetViewCanvas: (fn) => set({ resetViewCanvas: fn }),
    togglePreviewMode: () => set((state) => ({ isPreviewMode: !state.isPreviewMode })),
    toggleShowGuides: () => set((state) => ({ showGuides: !state.showGuides })),
    setSelectedLayerId: (id) => set({ selectedLayerId: id }),
    setThemeData: (themeData) => set({ themeData }),

    setObjectFill: (fill) => {
      const { canvas, selectedObject } = get();
      if (selectedObject && canvas) {
        // When setting a raw color, remove the token role
        selectedObject.set('tokenRole', null);
        if (selectedObject.type === 'i-text' || selectedObject.type === 'textbox') {
            selectedObject.set('fill', fill);
        } else if (selectedObject.stroke) {
            selectedObject.set('stroke', fill);
        } else {
            selectedObject.set('fill', fill);
        }
        canvas.requestRenderAll();
        get().saveState();
      }
    },

    setObjectThemedFill: (tokenRole, fill) => {
      const { canvas, selectedObject } = get();
      if (selectedObject && canvas) {
        selectedObject.set('tokenRole', tokenRole);
        if (selectedObject.type === 'i-text' || selectedObject.type === 'textbox') {
            selectedObject.set('fill', fill);
        } else if (selectedObject.stroke) {
            selectedObject.set('stroke', fill);
        } else {
            selectedObject.set('fill', fill);
        }
        canvas.requestRenderAll();
        get().saveState();
      }
    },

    setLayers: (objects) => {
      const newLayers = objects
        .filter(obj => !(obj as any).isGuide)
        .map((obj): Layer => ({
          id: (obj as any).id || '',
          name: formatObjectType(obj.type),
          type: obj.type || 'object',
          visible: obj.visible ?? true,
          locked: !!obj.lockMovementX, // Use actual lock status
        }));
      set({ layers: newLayers });
    },

    saveState: debounce(() => {
      const { canvas, isLoading, history, historyIndex } = get();
      if (isLoading || !canvas) return;

      const json = canvas.toJSON(['id', 'tokenRole']);
      localStorage.setItem('witchclick_current_design', JSON.stringify(json));

      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(JSON.stringify(json));

      if (newHistory.length > MAX_HISTORY_SIZE) {
        newHistory.shift();
      }
      const newIndex = newHistory.length - 1;
      if (history[historyIndex] === newHistory[newIndex] && history.length > 0) {
        return;
      }
      set({ history: newHistory, historyIndex: newIndex });
    }, 300),

    undo: () => {
      const { history, historyIndex, canvas } = get();
      if (historyIndex > 0 && canvas) {
        set({ isLoading: true });
        const prevState = JSON.parse(history[historyIndex - 1]);
        canvas.loadFromJSON(prevState, () => {
          canvas.requestRenderAll();
          set({ historyIndex: historyIndex - 1, isLoading: false, selectedObject: null, zoom: canvas.getZoom() });
          get().setLayers(canvas.getObjects());
        });
      }
    },

    redo: () => {
      const { history, historyIndex, canvas } = get();
      if (historyIndex < history.length - 1 && canvas) {
        set({ isLoading: true });
        const nextState = JSON.parse(history[historyIndex + 1]);
        canvas.loadFromJSON(nextState, () => {
          canvas.requestRenderAll();
          set({ historyIndex: historyIndex + 1, isLoading: false, selectedObject: null, zoom: canvas.getZoom() });
          get().setLayers(canvas.getObjects());
        });
      }
    },

    setZoom: (zoom) => set({ zoom }),

import { applyActiveThemeToCanvas } from '../fabric/themeUtils';
...
    fitToScreen: () => {
      const { canvas } = get();
      if (canvas) {
        canvas.setZoom(1);
        canvas.absolutePan(new fabric.Point(0, 0));
        set({ zoom: 1 });
      }
    },
    
    addThemeToVault: (jsonString: string) => {
        try {
            const json: ApocapaletteTheme = JSON.parse(jsonString);

            if (json.meta?.schema !== 'generic-token-pack-v1') {
                set({ toastMessage: 'Invalid Theme: Schema is not generic-token-pack-v1' });
                return;
            }

            const flatSwatches = recursivelyExtractValues(json);
            
            const categorizedSwatches: CategorizedSwatches = {};
            for (const category in swatchCategories) {
                categorizedSwatches[category] = {};
                for (const name in swatchCategories[category]) {
                    const path = swatchCategories[category][name];
                    const color = Object.entries(flatSwatches).find(([p]) => p === path)?.[1];
                    if (color) {
                         categorizedSwatches[category][name] = color;
                    }
                }
            }

            const newCollection: BrandCollection = {
                id: uuidv4(),
                name: json.meta.name || 'Untitled Theme',
                themeData: json,
                swatches: categorizedSwatches,
            };

            const newVault = [...get().brandVault, newCollection];
            set({ brandVault: newVault });
            saveBrandVaultToDb(newVault);
            get().applyTheme(json); // Immediately apply the newly added theme
            set({ toastMessage: `Theme Imported & Applied: ${newCollection.name}` });

        } catch (error: any) {
            console.error('Failed to import theme:', error.message);
            set({ toastMessage: 'Invalid Theme File' });
        }
    },

    applyTheme: (theme: ApocapaletteTheme) => {
        set({ themeData: theme });
        // Use a timeout to ensure state update has propagated before applying
        setTimeout(() => applyActiveThemeToCanvas(), 0);
    },

    resetTheme: () => {
        const { canvas } = get();
        if (!canvas) return;

        canvas.getObjects().forEach(obj => {
            (obj as any).tokenRole = null;
        });

        canvas.requestRenderAll();
        get().saveState();
        set({ toastMessage: 'Theme links have been reset.' });
    },


    setToastMessage: (message) => set({ toastMessage: message }),
    setUnitMode: (mode) => set({ unitMode: mode }),
    setBleedPx: (value) => set({ bleedPx: value }),

    loadBrandVault: async () => {
        const vault = await getBrandVaultFromDb();
        set({ brandVault: vault });
        if (vault.length > 0 && !get().activeBrandCollectionId) {
            const firstCollection = vault[0];
            set({ activeBrandCollectionId: firstCollection.id, themeData: firstCollection.themeData });
        }
    },

    setActiveBrandCollectionId: (id: string) => {
        const activeCollection = get().brandVault.find(b => b.id === id);
        if (activeCollection) {
            set({ activeBrandCollectionId: id, themeData: activeCollection.themeData });
        }
    },

    addCustomFont: (fontName) => set((state) => {
      if (state.customFonts.includes(fontName)) return state;
      return { customFonts: [...state.customFonts, fontName] };
    }),

    addCustomSticker: async (sticker) => {
      const updatedStickers = [...get().customStickers, sticker];
      saveCustomStickersToLocalStorage(updatedStickers);
      set({ customStickers: updatedStickers });
    },

    removeCustomSticker: (id) => {
      const updatedStickers = get().customStickers.filter((sticker) => sticker.id !== id);
      saveCustomStickersToLocalStorage(updatedStickers);
      set({ customStickers: updatedStickers });
    },

    loadTemplates: async () => {
      set({ isTemplateLoading: true });
      try {
        const templates = await getTemplatesFromDb();
        const sorted = templates.sort((a, b) => b.createdAt - a.createdAt);
        set({ templates: sorted });
      } catch (error) {
        console.error('Failed to load templates', error);
        set({ toastMessage: 'Failed to load templates.' });
      } finally {
        set({ isTemplateLoading: false });
      }
    },

    saveTemplate: async (name) => {
      const { canvas, unitMode } = get();
      if (!canvas) {
        set({ toastMessage: 'No canvas to save as a template.' });
        return;
      }

      const trimmedName = name.trim();
      const templateName = trimmedName || 'Untitled Template';
      set({ isTemplateSaving: true });

      try {
        const width = canvas.getWidth() || canvas.width || 1;
        const height = canvas.getHeight() || canvas.height || 1;
        const maxThumb = 320;
        const scale = Math.min(1, maxThumb / Math.max(width, height));
        const thumbnail = canvas.toDataURL({ format: 'png', multiplier: scale });
        const json = canvas.toJSON(['id', 'tokenRole']);
        const template: TemplateData = {
          id: uuidv4(),
          name: templateName,
          json,
          unitMode,
          themeName: null,
          thumbnail,
          createdAt: Date.now(),
        };

        await addTemplateToDb(template);
        await get().loadTemplates();
        set({ toastMessage: `Template saved: ${templateName}` });
      } catch (error) {
        console.error('Failed to save template', error);
        set({ toastMessage: 'Failed to save template.' });
      } finally {
        set({ isTemplateSaving: false });
      }
    },

    deleteTemplate: async (id) => {
      set({ isTemplateLoading: true });
      try {
        await deleteTemplateFromDb(id);
        await get().loadTemplates();
        set({ toastMessage: 'Template removed.' });
      } catch (error) {
        console.error('Failed to delete template', error);
        set({ toastMessage: 'Failed to delete template.' });
      } finally {
        set({ isTemplateLoading: false });
      }
    },

    loadTemplate: async (template) => {
      const { canvas } = get();
      if (!canvas) return;

      set({ isLoading: true });
      clearSafeMarginGuides(canvas);
      clearBleedGuides(canvas);

      await new Promise<void>((resolve) => {
        canvas.loadFromJSON(template.json, () => {
          canvas.renderAll();
          resolve();
        });
      });

      set({ isLoading: false, selectedObject: null });
      get().setLayers(canvas.getObjects());
      get().saveState();
      get().setUnitMode(template.unitMode);
      set({ toastMessage: `Loaded template: ${template.name}` });
    },
  };
});

export { useEditorStore };

