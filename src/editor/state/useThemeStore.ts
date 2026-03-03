import { createWithEqualityFn } from 'zustand/traditional';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import * as fabric from 'fabric';
import { saveBrandVaultToDb } from '../utils/indexedDb';
import { resolveThemeValue } from '../utils/themeResolver';
import type { ApocapaletteTheme } from '../types/apocapalette';
import type { BrandKit } from '../db';
import { useUiThemeStore } from './uiThemeStore';
import { importThemeJson, type SimpleThemeJson, type ColorCategory } from '../services/designSpaceImporter';

// --- INTERFACES ---

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

export interface ColorPalette {
    id: string;
    name: string;
    colors: string[];
    categories: Partial<Record<ColorCategory, string[]>>;
}

export interface IngestedPalette {
    name: string;
    mode: string;
    categories: {
        backgrounds?: Record<string, string>;
        text?: Record<string, string>;
        brand?: Record<string, string>;
        interactive?: Record<string, string>;
        status?: Record<string, string>;
        neutrals?: Record<string, string>;
    };
}

// --- UTILITY FUNCTIONS ---

const LEGACY_RECENT_COLORS_KEY = 'designspace_recent_colors';
const MAX_RECENT_COLORS = 10;

const DEFAULT_BRAND_KIT: BrandKit = {
    colors: ['#1f2933', '#3b82f6', '#ef4444', '#10b981', '#f59e0b'],
    typography: {
        heading: { fontFamily: 'Arial', fontSize: 32, fontWeight: 'bold' },
        body: { fontFamily: 'Arial', fontSize: 16, fontWeight: 'normal' },
    },
    logoAssets: [],
};

const normalizeColor = (color: string): string => {
    if (/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color)) {
        return color.toUpperCase();
    }
    if (color.startsWith('rgb(')) {
        return rgbToHex(color);
    }
    return '#000000';
};

const rgbToHex = (rgb: string): string => {
    const match = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (!match) return '#000000';

    const r = parseInt(match[1], 10);
    const g = parseInt(match[2], 10);
    const b = parseInt(match[3], 10);

    return `#${[r, g, b]
        .map((value) => {
            const hex = value.toString(16);
            return hex.length === 1 ? `0${hex}` : hex;
        })
        .join('')
        .toUpperCase()}`;
};

const normalizeCanvasBackgroundColor = (color: string | null): string | null => {
    if (!color) return null;
    const trimmed = color.trim();
    if (!trimmed || trimmed.toLowerCase() === 'transparent') return null;
    if (/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(trimmed)) {
        return trimmed.toUpperCase();
    }
    if (trimmed.startsWith('rgb(')) {
        return rgbToHex(trimmed);
    }
    return null;
};

const getInitialRecentColors = () => {
    if (typeof window === 'undefined') return [];
    try {
        const stored = localStorage.getItem(LEGACY_RECENT_COLORS_KEY);
        if (!stored) return [];
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const findDefaultTheme = (vault: BrandCollection[]) => {
    const byName = vault.find((theme) =>
        theme.name?.toLowerCase() === 'midnight'
        || theme.themeData?.meta?.name?.toLowerCase() === 'midnight'
    );
    return byName || vault[0] || null;
};

// --- THEME STATE INTERFACE ---

interface ThemeState {
    // Theme Data
    brandVault: BrandCollection[];
    activeBrandCollectionId: string | null;
    themeData: ApocapaletteTheme | null;
    brandPalette: { [key: string]: string };
    paletteVault: ColorPalette[];
    activePaletteId: string | null;
    importedPalette: IngestedPalette | null;

    // Canvas Background
    canvasBackgroundColor: string | null;

    // Drawing Colors
    brushColor: string;

    // Vision Palette - Colors extracted from vision board images
    visionPalette: string[];

    // Recent Colors - Color history used in controls
    recentColors: string[];

    // Brand Kit (colors + typography)
    brandKit: BrandKit | null;
    brandKitLoading: boolean;

    // Actions - Pure Theme State
    setBrandVault: (vault: BrandCollection[]) => void;
    setThemeData: (theme: ApocapaletteTheme | null) => void;
    setActiveBrandCollectionId: (id: string | null) => void;
    setCanvasBackgroundColor: (color: string | null) => void;
    setBrushColor: (color: string) => void;
    setBrandPalette: (palette: { [key: string]: string }) => void;
    setPaletteVault: (vault: ColorPalette[]) => void;
    setActivePaletteId: (id: string | null) => void;
    setImportedPalette: (palette: IngestedPalette | null) => void;
    addPaletteToVault: (palette: ColorPalette) => void;
    addPalettesToVault: (palettes: ColorPalette[]) => void;

    // Actions - Vision Palette
    addToVisionPalette: (colors: string[]) => void;
    removeFromVisionPalette: (color: string) => void;
    clearVisionPalette: () => void;

    // Actions - Recent Colors
    addRecentColor: (color: string) => void;
    clearRecentColors: () => void;

    // Actions - Brand Kit
    setBrandKit: (brandKit: BrandKit | null) => void;
    loadBrandKit: () => Promise<BrandKit | null>;
    saveBrandKit: (brandKit: BrandKit) => Promise<{ success: boolean; error?: string }>;
    addColorToBrandKit: (color: string) => Promise<{ success: boolean; error?: string }>;

    // Actions - Theme Management
    addThemeToVault: (jsonString: string) => { success: boolean; error?: string; collection?: BrandCollection };
    selectThemeFromVault: (id: string) => ApocapaletteTheme | null;
    getActiveTheme: () => ApocapaletteTheme | null;
    initializeDefaultTheme: () => void;

    // Actions - Color Resolution
    resolveTokenColor: (tokenRole: string) => string | null;
    getDefaultTokenRole: (objectType: string, role?: string) => string;
}

// --- ZUSTAND STORE IMPLEMENTATION ---

export const useThemeStore = createWithEqualityFn<ThemeState>()(
    persist(
        (set, get) => ({
            // Initial State
            brandVault: [],
            activeBrandCollectionId: null,
            themeData: null,
            brandPalette: {},
            paletteVault: [],
            activePaletteId: null,
            importedPalette: null,
            canvasBackgroundColor: null,
            brushColor: '#111111',
            visionPalette: [],
            recentColors: getInitialRecentColors(),
            brandKit: null,
            brandKitLoading: false,

            // --- Pure State Setters ---

            setBrandVault: (vault) => set({ brandVault: vault }),

            setThemeData: (theme) => set({ themeData: theme }),

            setActiveBrandCollectionId: (id) => set({ activeBrandCollectionId: id }),

            setCanvasBackgroundColor: (color) =>
                set({ canvasBackgroundColor: normalizeCanvasBackgroundColor(color) }),

            setBrushColor: (color) => set({ brushColor: color }),

            setBrandPalette: (palette) => set({ brandPalette: palette }),

            setPaletteVault: (vault) => set({ paletteVault: vault }),

            setActivePaletteId: (id) => set({ activePaletteId: id }),

            setImportedPalette: (palette) => set({ importedPalette: palette }),

            addPaletteToVault: (palette) => {
                const next = [...get().paletteVault, palette];
                set({ paletteVault: next, activePaletteId: palette.id });
            },

            addPalettesToVault: (palettes) => {
                if (palettes.length === 0) return;
                const next = [...get().paletteVault, ...palettes];
                set({ paletteVault: next, activePaletteId: palettes[0].id });
            },

            // --- Vision Palette Actions ---

            addToVisionPalette: (colors) => {
                set((state) => {
                    // Normalize colors and filter duplicates
                    const normalizedNew = colors.map(c => c.toLowerCase());
                    const existing = new Set(state.visionPalette.map(c => c.toLowerCase()));
                    const toAdd = normalizedNew.filter(c => !existing.has(c));
                    // Keep max 20 colors, most recent at the front
                    const combined = [...toAdd, ...state.visionPalette].slice(0, 20);
                    return { visionPalette: combined };
                });
            },

            removeFromVisionPalette: (color) => {
                set((state) => ({
                    visionPalette: state.visionPalette.filter(
                        c => c.toLowerCase() !== color.toLowerCase()
                    ),
                }));
            },

            clearVisionPalette: () => set({ visionPalette: [] }),

            // --- Recent Colors Actions ---

            addRecentColor: (color) => {
                const normalized = normalizeColor(color);
                set((state) => {
                    const filtered = state.recentColors.filter(
                        (value) => value.toLowerCase() !== normalized.toLowerCase()
                    );
                    const next = [normalized, ...filtered].slice(0, MAX_RECENT_COLORS);
                    return { recentColors: next };
                });
            },

            clearRecentColors: () => set({ recentColors: [] }),

            // --- Brand Kit Actions ---

            setBrandKit: (brandKit) => set({ brandKit }),

            loadBrandKit: async () => {
                set({ brandKitLoading: true });
                try {
                    const { db } = await import('../db');
                    const stored = await db.getBrandKit();
                    const nextKit = stored || DEFAULT_BRAND_KIT;
                    set({ brandKit: nextKit, brandKitLoading: false });
                    return nextKit;
                } catch (error) {
                    console.error('Failed to load brand kit:', error);
                    set({ brandKitLoading: false });
                    return null;
                }
            },

            saveBrandKit: async (brandKit) => {
                try {
                    const { db } = await import('../db');
                    await db.saveBrandKit(brandKit);
                    set({ brandKit });
                    return { success: true };
                } catch (error) {
                    console.error('Failed to save brand kit:', error);
                    return { success: false, error: 'Failed to save brand kit' };
                }
            },

            addColorToBrandKit: async (color) => {
                const normalized = normalizeColor(color);
                const currentKit = get().brandKit || DEFAULT_BRAND_KIT;
                if (currentKit.colors.some((value) => value.toLowerCase() === normalized.toLowerCase())) {
                    return { success: true };
                }
                const updated = {
                    ...currentKit,
                    colors: [...currentKit.colors, normalized],
                };
                set({ brandKit: updated });
                try {
                    const { db } = await import('../db');
                    await db.saveBrandKit(updated);
                    return { success: true };
                } catch (error) {
                    console.error('Failed to add color to brand kit:', error);
                    return { success: false, error: 'Failed to add color to brand kit' };
                }
            },

            // --- Theme Management Actions ---

            addThemeToVault: (jsonString: string) => {
                try {
                    const parsed = JSON.parse(jsonString) as Record<string, unknown>;
                    const meta = (parsed as { meta?: { name?: unknown; schema?: unknown } }).meta;
                    const metaName = typeof meta?.name === 'string' ? meta.name.trim() : '';
                    const metaSchema = typeof meta?.schema === 'string' ? meta.schema.trim() : '';
                    const isApocapalette = Boolean(metaName || metaSchema);

                    if (metaSchema && metaSchema !== 'generic-token-pack-v1') {
                        return { success: false, error: 'Invalid Schema' };
                    }

                    if (isApocapalette) {
                        const json = parsed as ApocapaletteTheme;
                        const newCollection: BrandCollection = {
                            id: uuidv4(),
                            name: metaName || 'Untitled Theme',
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
                        set({
                            brandVault: newVault,
                            activeBrandCollectionId: newCollection.id,
                            themeData: json
                        });
                        saveBrandVaultToDb(newVault);

                        // Sync with UI theme if enabled
                        const { projectSyncEnabled, applyThemeFromTokens } = useUiThemeStore.getState();
                        if (projectSyncEnabled) {
                            applyThemeFromTokens(json);
                        }

                        return { success: true, collection: newCollection };
                    }

                    const importResult = importThemeJson(parsed as SimpleThemeJson);
                    if (!importResult.success || !importResult.collection) {
                        return { success: false, error: importResult.error || 'Invalid Theme File' };
                    }

                    const newVault = [...get().brandVault, importResult.collection];
                    set({
                        brandVault: newVault,
                        activeBrandCollectionId: importResult.collection.id,
                        themeData: importResult.collection.themeData
                    });
                    saveBrandVaultToDb(newVault);

                    // Sync with UI theme if enabled
                    const { projectSyncEnabled, applyThemeFromTokens } = useUiThemeStore.getState();
                    if (projectSyncEnabled) {
                        applyThemeFromTokens(importResult.collection.themeData);
                    }

                    return { success: true, collection: importResult.collection };
                } catch (e) {
                    return { success: false, error: 'Invalid Theme File' };
                }
            },

            selectThemeFromVault: (id: string) => {
                const { brandVault } = get();
                const selectedTheme = brandVault.find(brand => brand.id === id);
                if (selectedTheme) {
                    set({
                        activeBrandCollectionId: id,
                        themeData: selectedTheme.themeData
                    });

                    // Sync with UI theme if enabled
                    const { projectSyncEnabled, applyThemeFromTokens } = useUiThemeStore.getState();
                    if (projectSyncEnabled) {
                        applyThemeFromTokens(selectedTheme.themeData);
                    }

                    return selectedTheme.themeData;
                }
                return null;
            },

            getActiveTheme: () => {
                const { themeData, brandVault, activeBrandCollectionId } = get();
                return themeData
                    || brandVault.find((brand) => brand.id === activeBrandCollectionId)?.themeData
                    || null;
            },

            initializeDefaultTheme: () => {
                const { brandVault } = get();
                const defaultTheme = findDefaultTheme(brandVault);
                if (defaultTheme) {
                    set({
                        themeData: defaultTheme.themeData,
                        activeBrandCollectionId: defaultTheme.id
                    });
                } else {
                    set({ themeData: null, activeBrandCollectionId: null });
                }
            },

            // --- Color Resolution Actions ---

            resolveTokenColor: (tokenRole: string) => {
                const { themeData } = get();
                if (!themeData) return null;
                return resolveThemeValue(themeData, tokenRole);
            },

            getDefaultTokenRole: (objectType: string, role?: string) => {
                if (objectType === 'i-text' || objectType === 'textbox') {
                    return role === 'heading' ? 'typography.heading.value' : 'typography.body.value';
                } else if (objectType === 'image') {
                    return 'brand.accent.value';
                }
                return 'brand.primary.value';
            },
        }),
        {
            name: 'designspace-theme',
            partialize: (state) => ({
                themeData: state.themeData,
                brandVault: state.brandVault,
                activeBrandCollectionId: state.activeBrandCollectionId,
                canvasBackgroundColor: state.canvasBackgroundColor,
                brushColor: state.brushColor,
                brandPalette: state.brandPalette,
                paletteVault: state.paletteVault,
                activePaletteId: state.activePaletteId,
                importedPalette: state.importedPalette,
                visionPalette: state.visionPalette,
                recentColors: state.recentColors,
            }),
            onRehydrateStorage: () => (state) => {
                if (!state) return;
                state.setCanvasBackgroundColor(state.canvasBackgroundColor);
            },
        }
    )
);

// --- CANVAS-AWARE THEME OPERATIONS ---
// These functions need canvas access and are designed to be called from editorStore
// or components that have access to both stores

// Sync lock reason type for theme operations
export type SyncLockReason = 'init' | 'theme-apply' | 'undo' | 'redo' | 'batch';

/**
 * Apply the active theme to all objects on the canvas.
 * This function should be called after theme changes when canvas is ready.
 */
export const applyThemeToCanvas = (
    canvas: fabric.Canvas,
    themeData: ApocapaletteTheme,
    callbacks: {
        saveState: () => void;
        requestLayerSync: () => void;
        acquireSyncLock?: (reason: SyncLockReason) => void;
        releaseSyncLock?: () => void;
    }
) => {
    const { saveState, requestLayerSync, acquireSyncLock, releaseSyncLock } = callbacks;

    // Acquire sync lock if provided
    acquireSyncLock?.('theme-apply');

    try {
        let objectsChanged = false;

        const applyThemeToObject = (obj: fabric.Object) => {
            if ((obj as any).colorLocked) {
                return;
            }

            const tokenRole = (obj as any).tokenRole;
            if (tokenRole) {
                const colorValue = resolveThemeValue(themeData, tokenRole);
                if (colorValue) {
                    // Determine whether to apply to fill or stroke
                    if (obj.stroke && !obj.fill) {
                        if (obj.stroke !== colorValue) {
                            obj.set('stroke', colorValue);
                            objectsChanged = true;
                        }
                    } else {
                        if (obj.fill !== colorValue) {
                            obj.set('fill', colorValue);
                            objectsChanged = true;
                        }
                    }
                }
            }

            if (obj.type === 'group' || obj.type === 'activeSelection') {
                const groupObjects = (obj as fabric.Group).getObjects();
                groupObjects.forEach(applyThemeToObject);
            }
        };

        canvas.getObjects().forEach(applyThemeToObject);

        if (objectsChanged) {
            canvas.requestRenderAll();
            saveState();
            requestLayerSync();
        }
    } finally {
        releaseSyncLock?.();
    }
};

/**
 * Apply a themed fill color to a specific object.
 */
export const applyThemedFillToObject = (
    object: fabric.Object,
    canvas: fabric.Canvas,
    tokenRole: string,
    themeData: ApocapaletteTheme,
    callbacks: {
        saveState: () => void;
        requestLayerSync: () => void;
    }
) => {
    const colorValue = resolveThemeValue(themeData, tokenRole);
    if (colorValue) {
        object.set({ fill: colorValue, tokenRole, colorLocked: false });
        canvas.requestRenderAll();
        callbacks.saveState();
        callbacks.requestLayerSync();
    }
};

/**
 * Apply a tint filter to an image using theme colors.
 */
export const applyThemeTintToImage = (
    image: fabric.Image,
    canvas: fabric.Canvas,
    tokenRole: string,
    themeData: ApocapaletteTheme,
    callbacks: {
        saveState: () => void;
        requestLayerSync: () => void;
    }
) => {
    const colorValue = resolveThemeValue(themeData, tokenRole);
    if (!colorValue) return;

    image.filters = image.filters?.filter(f => f.type !== 'BlendColor') || [];
    image.filters.push(new fabric.filters.BlendColor({
        color: colorValue,
        mode: 'tint',
        alpha: 0.5
    }));

    image.applyFilters();
    canvas.requestRenderAll();
    callbacks.saveState();
    callbacks.requestLayerSync();
};

/**
 * Reset an object to its default theme color based on type.
 */
export const resetObjectToDefaultTheme = (
    object: fabric.Object,
    canvas: fabric.Canvas,
    themeData: ApocapaletteTheme,
    callbacks: {
        saveState: () => void;
        requestLayerSync: () => void;
    }
) => {
    const { getDefaultTokenRole } = useThemeStore.getState();
    const defaultTokenRole = getDefaultTokenRole(object.type || '', (object as any).role);

    const colorValue = resolveThemeValue(themeData, defaultTokenRole);
    if (colorValue) {
        object.set({
            fill: colorValue,
            tokenRole: defaultTokenRole,
            colorLocked: false,
        });

        if (object.type === 'image') {
            (object as fabric.Image).filters = [];
            (object as fabric.Image).applyFilters();
        }

        canvas.requestRenderAll();
        callbacks.saveState();
        callbacks.requestLayerSync();
    }
};

/**
 * Reset all theme links on canvas objects.
 */
export const resetAllThemeLinks = (
    canvas: fabric.Canvas,
    callbacks: {
        saveState: () => void;
    }
) => {
    canvas.getObjects().forEach(obj => {
        (obj as any).tokenRole = null;
    });
    canvas.requestRenderAll();
    callbacks.saveState();
};

// --- SELECTOR HOOKS ---
// Convenient selectors for common theme data access

export const useActiveTheme = () => useThemeStore((state) => state.themeData);
export const useBrandVault = () => useThemeStore((state) => state.brandVault);
export const useActiveBrandCollectionId = () => useThemeStore((state) => state.activeBrandCollectionId);
export const useCanvasBackgroundColor = () => useThemeStore((state) => state.canvasBackgroundColor);
export const useBrushColor = () => useThemeStore((state) => state.brushColor);
export const useVisionPalette = () => useThemeStore((state) => state.visionPalette);
