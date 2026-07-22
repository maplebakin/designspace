import { createWithEqualityFn } from 'zustand/traditional';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuidv4 } from 'uuid';
import { extractHexColors } from '../utils/colorExtraction';
import { useThemeStore } from './useThemeStore';
import { createBoundedPersistStorage } from '../persistence/boundedPersistStorage';

// --- TYPES ---

/**
 * Base position and dimensions for vision board items
 */
export interface VisionItemPosition {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    zIndex?: number;
}

/**
 * Image item - supports blob URLs and regular URLs
 */
export interface ImageVisionItem {
    type: 'image';
    id: string;
    position: VisionItemPosition;
    src: string;              // blob: URL or https: URL
    thumbnail?: string;       // Optional smaller preview
    label?: string;
    extractedColors?: string[]; // Colors extracted from the image
    createdAt: number;
    updatedAt: number;
}

/**
 * Color swatch item - hex color with optional metadata
 */
export interface ColorVisionItem {
    type: 'color';
    id: string;
    position: VisionItemPosition;
    hex: string;              // e.g., '#ff5733'
    label?: string;
    source?: 'manual' | 'extracted' | 'imported';
    createdAt: number;
    updatedAt: number;
}

/**
 * Design state item - serialized canvas state from serialization.ts
 * This allows saving canvas snapshots to the vision board
 */
export interface DesignStateVisionItem {
    type: 'design-state';
    id: string;
    position: VisionItemPosition;
    canvasData: string;       // JSON string from toSerializableObject[]
    thumbnail?: string;       // Preview image of the design
    label?: string;
    canvasSize?: {
        width: number;
        height: number;
    };
    extractedColors?: string[]; // Colors used in the design
    createdAt: number;
    updatedAt: number;
}

/**
 * Union type for all vision board items
 */
export type VisionItem = ImageVisionItem | ColorVisionItem | DesignStateVisionItem;

/**
 * Input types for adding new items (without auto-generated fields)
 */
export type AddImageInput = Omit<ImageVisionItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };
export type AddColorInput = Omit<ColorVisionItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };
export type AddDesignStateInput = Omit<DesignStateVisionItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };
export type AddVisionItemInput = AddImageInput | AddColorInput | AddDesignStateInput;

// --- UTILITY FUNCTIONS ---

/**
 * Check if a string is a valid hex color
 */
const isValidHex = (hex: string): boolean => {
    return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(hex);
};

/**
 * Normalize hex color to 6-digit format
 */
const normalizeHex = (hex: string): string => {
    const cleaned = hex.replace('#', '').toLowerCase();
    if (cleaned.length === 3) {
        return `#${cleaned[0]}${cleaned[0]}${cleaned[1]}${cleaned[1]}${cleaned[2]}${cleaned[2]}`;
    }
    return `#${cleaned}`;
};

/**
 * Extract colors from a design state JSON
 */
const extractColorsFromDesignState = (canvasData: string): string[] => {
    try {
        const data = JSON.parse(canvasData);
        const objects = Array.isArray(data) ? data : data.objects || [];
        const colors = new Set<string>();

        const extractFromObject = (obj: any) => {
            if (!obj) return;

            // Extract fill color
            if (typeof obj.fill === 'string' && isValidHex(obj.fill)) {
                colors.add(normalizeHex(obj.fill));
            }

            // Extract stroke color
            if (typeof obj.stroke === 'string' && isValidHex(obj.stroke)) {
                colors.add(normalizeHex(obj.stroke));
            }

            // Extract background color
            if (typeof obj.backgroundColor === 'string' && isValidHex(obj.backgroundColor)) {
                colors.add(normalizeHex(obj.backgroundColor));
            }

            // Recursively extract from grouped objects
            if (Array.isArray(obj.objects)) {
                obj.objects.forEach(extractFromObject);
            }
        };

        objects.forEach(extractFromObject);

        // Also check for canvas background
        if (data.background && typeof data.background === 'string' && isValidHex(data.background)) {
            colors.add(normalizeHex(data.background));
        }

        return Array.from(colors);
    } catch {
        return [];
    }
};

// --- STORE INTERFACE ---

interface VisionBoardState {
    // State
    items: VisionItem[];
    selectedItemIds: string[];
    boardSize: { width: number; height: number };
    zoom: number;
    panOffset: { x: number; y: number };

    // Item Actions
    addItem: (input: AddVisionItemInput) => string;
    addItems: (inputs: AddVisionItemInput[]) => string[];
    removeItem: (id: string) => void;
    removeItems: (ids: string[]) => void;
    updateItem: <T extends VisionItem>(id: string, updates: Partial<Omit<T, 'id' | 'type' | 'createdAt'>>) => void;
    updatePosition: (id: string, position: Partial<VisionItemPosition>) => void;
    updatePositions: (updates: Array<{ id: string; position: Partial<VisionItemPosition> }>) => void;
    reorderItem: (id: string, newZIndex: number) => void;
    duplicateItem: (id: string) => string | null;
    clearBoard: () => void;

    // Color Extraction
    extractColorsFromImageItem: (id: string) => Promise<string[]>;

    // Selection Actions
    selectItem: (id: string, additive?: boolean) => void;
    selectItems: (ids: string[]) => void;
    deselectItem: (id: string) => void;
    deselectAll: () => void;
    selectAll: () => void;

    // View Actions
    setZoom: (zoom: number) => void;
    setPanOffset: (offset: { x: number; y: number }) => void;
    setBoardSize: (size: { width: number; height: number }) => void;
    resetView: () => void;

    // Getters
    getItemById: (id: string) => VisionItem | undefined;
    getItemsByType: <T extends VisionItem['type']>(type: T) => Extract<VisionItem, { type: T }>[];
}

// --- SELECTORS ---

/**
 * Extract all unique colors from the vision board as a global palette.
 * Includes: color items, extracted colors from images, and colors from design states.
 */
export const selectExtractedColors = (state: VisionBoardState): string[] => {
    const colors = new Set<string>();

    state.items.forEach(item => {
        switch (item.type) {
            case 'color':
                if (isValidHex(item.hex)) {
                    colors.add(normalizeHex(item.hex));
                }
                break;

            case 'image':
                item.extractedColors?.forEach(color => {
                    if (isValidHex(color)) {
                        colors.add(normalizeHex(color));
                    }
                });
                break;

            case 'design-state':
                // Use pre-extracted colors if available
                if (item.extractedColors) {
                    item.extractedColors.forEach(color => {
                        if (isValidHex(color)) {
                            colors.add(normalizeHex(color));
                        }
                    });
                } else {
                    // Fall back to extracting from canvas data
                    extractColorsFromDesignState(item.canvasData).forEach(color => {
                        colors.add(color);
                    });
                }
                break;
        }
    });

    return Array.from(colors);
};

/**
 * Get colors grouped by their source items
 */
export const selectColorsBySource = (state: VisionBoardState): Map<string, { itemId: string; itemLabel?: string; colors: string[] }> => {
    const result = new Map<string, { itemId: string; itemLabel?: string; colors: string[] }>();

    state.items.forEach(item => {
        const colors: string[] = [];

        switch (item.type) {
            case 'color':
                if (isValidHex(item.hex)) {
                    colors.push(normalizeHex(item.hex));
                }
                break;

            case 'image':
                item.extractedColors?.forEach(color => {
                    if (isValidHex(color)) {
                        colors.push(normalizeHex(color));
                    }
                });
                break;

            case 'design-state':
                if (item.extractedColors) {
                    item.extractedColors.forEach(color => {
                        if (isValidHex(color)) {
                            colors.push(normalizeHex(color));
                        }
                    });
                } else {
                    extractColorsFromDesignState(item.canvasData).forEach(color => {
                        colors.push(color);
                    });
                }
                break;
        }

        if (colors.length > 0) {
            result.set(item.id, {
                itemId: item.id,
                itemLabel: item.label,
                colors,
            });
        }
    });

    return result;
};

// --- STORE IMPLEMENTATION ---

export const useVisionBoardStore = createWithEqualityFn<VisionBoardState>()(
    persist(
        immer((set, get) => ({
            // Initial State
            items: [],
            selectedItemIds: [],
            boardSize: { width: 2000, height: 2000 },
            zoom: 1,
            panOffset: { x: 0, y: 0 },

            // --- Item Actions ---

            addItem: (input) => {
                const id = input.id || uuidv4();
                const now = Date.now();

                set((state) => {
                    const baseItem = {
                        ...input,
                        id,
                        createdAt: now,
                        updatedAt: now,
                        position: {
                            ...input.position,
                            zIndex: input.position.zIndex ?? state.items.length,
                        },
                    };

                    // Auto-extract colors for design-state items
                    if (input.type === 'design-state' && !input.extractedColors) {
                        (baseItem as DesignStateVisionItem).extractedColors =
                            extractColorsFromDesignState(input.canvasData);
                    }

                    state.items.push(baseItem as VisionItem);
                });

                // Auto-extract colors for image items asynchronously
                if (input.type === 'image' && !input.extractedColors) {
                    // Use setTimeout to ensure state is committed before extraction
                    setTimeout(() => {
                        get().extractColorsFromImageItem(id);
                    }, 0);
                }

                return id;
            },

            addItems: (inputs) => {
                const ids: string[] = [];
                const now = Date.now();

                set((state) => {
                    inputs.forEach((input, index) => {
                        const id = input.id || uuidv4();
                        ids.push(id);

                        const baseItem = {
                            ...input,
                            id,
                            createdAt: now,
                            updatedAt: now,
                            position: {
                                ...input.position,
                                zIndex: input.position.zIndex ?? state.items.length + index,
                            },
                        };

                        if (input.type === 'design-state' && !input.extractedColors) {
                            (baseItem as DesignStateVisionItem).extractedColors =
                                extractColorsFromDesignState(input.canvasData);
                        }

                        state.items.push(baseItem as VisionItem);
                    });
                });

                return ids;
            },

            removeItem: (id) => {
                set((state) => {
                    const index = state.items.findIndex(item => item.id === id);
                    if (index !== -1) {
                        state.items.splice(index, 1);
                    }
                    // Also deselect if selected
                    const selIndex = state.selectedItemIds.indexOf(id);
                    if (selIndex !== -1) {
                        state.selectedItemIds.splice(selIndex, 1);
                    }
                });
            },

            removeItems: (ids) => {
                set((state) => {
                    state.items = state.items.filter(item => !ids.includes(item.id));
                    state.selectedItemIds = state.selectedItemIds.filter(id => !ids.includes(id));
                });
            },

            updateItem: (id, updates) => {
                set((state) => {
                    const item = state.items.find(i => i.id === id);
                    if (item) {
                        Object.assign(item, updates, { updatedAt: Date.now() });

                        // Re-extract colors if canvasData changed for design-state
                        if (item.type === 'design-state' && 'canvasData' in updates) {
                            item.extractedColors = extractColorsFromDesignState(item.canvasData);
                        }
                    }
                });
            },

            updatePosition: (id, position) => {
                set((state) => {
                    const item = state.items.find(i => i.id === id);
                    if (item) {
                        Object.assign(item.position, position);
                        item.updatedAt = Date.now();
                    }
                });
            },

            updatePositions: (updates) => {
                set((state) => {
                    const now = Date.now();
                    updates.forEach(({ id, position }) => {
                        const item = state.items.find(i => i.id === id);
                        if (item) {
                            Object.assign(item.position, position);
                            item.updatedAt = now;
                        }
                    });
                });
            },

            reorderItem: (id, newZIndex) => {
                set((state) => {
                    const item = state.items.find(i => i.id === id);
                    if (item) {
                        item.position.zIndex = newZIndex;
                        item.updatedAt = Date.now();
                    }
                });
            },

            duplicateItem: (id) => {
                const original = get().items.find(i => i.id === id);
                if (!original) return null;

                const newId = uuidv4();
                const now = Date.now();

                set((state) => {
                    const duplicate = {
                        ...JSON.parse(JSON.stringify(original)),
                        id: newId,
                        createdAt: now,
                        updatedAt: now,
                        position: {
                            ...original.position,
                            x: original.position.x + 20,
                            y: original.position.y + 20,
                            zIndex: state.items.length,
                        },
                        label: original.label ? `${original.label} (copy)` : undefined,
                    };
                    state.items.push(duplicate);
                });

                return newId;
            },

            clearBoard: () => {
                set((state) => {
                    state.items = [];
                    state.selectedItemIds = [];
                });
            },

            // --- Color Extraction ---

            extractColorsFromImageItem: async (id) => {
                const item = get().items.find(i => i.id === id);
                if (!item || item.type !== 'image') return [];

                try {
                    // Extract colors from the image source
                    const imageSource = item.thumbnail || item.src;
                    const colors = await extractHexColors(imageSource, {
                        colorCount: 5,
                        quality: 10,
                        minColorDifference: 30,
                    });

                    if (colors.length > 0) {
                        // Update the vision board item with extracted colors
                        set((state) => {
                            const targetItem = state.items.find(i => i.id === id);
                            if (targetItem && targetItem.type === 'image') {
                                targetItem.extractedColors = colors;
                                targetItem.updatedAt = Date.now();
                            }
                        });

                        // Add colors to the theme store's vision palette
                        useThemeStore.getState().addToVisionPalette(colors);
                    }

                    return colors;
                } catch (error) {
                    console.error('Failed to extract colors from image:', error);
                    return [];
                }
            },

            // --- Selection Actions ---

            selectItem: (id, additive = false) => {
                set((state) => {
                    if (additive) {
                        if (!state.selectedItemIds.includes(id)) {
                            state.selectedItemIds.push(id);
                        }
                    } else {
                        state.selectedItemIds = [id];
                    }
                });
            },

            selectItems: (ids) => {
                set((state) => {
                    state.selectedItemIds = ids;
                });
            },

            deselectItem: (id) => {
                set((state) => {
                    const index = state.selectedItemIds.indexOf(id);
                    if (index !== -1) {
                        state.selectedItemIds.splice(index, 1);
                    }
                });
            },

            deselectAll: () => {
                set((state) => {
                    state.selectedItemIds = [];
                });
            },

            selectAll: () => {
                set((state) => {
                    state.selectedItemIds = state.items.map(item => item.id);
                });
            },

            // --- View Actions ---

            setZoom: (zoom) => {
                set((state) => {
                    state.zoom = Math.max(0.1, Math.min(5, zoom));
                });
            },

            setPanOffset: (offset) => {
                set((state) => {
                    state.panOffset = offset;
                });
            },

            setBoardSize: (size) => {
                set((state) => {
                    state.boardSize = size;
                });
            },

            resetView: () => {
                set((state) => {
                    state.zoom = 1;
                    state.panOffset = { x: 0, y: 0 };
                });
            },

            // --- Getters ---

            getItemById: (id) => {
                return get().items.find(item => item.id === id);
            },

            getItemsByType: (type) => {
                return get().items.filter(item => item.type === type) as any;
            },
        })),
        {
            name: 'designspace-vision-board',
            storage: createBoundedPersistStorage({ maxBytes: 8 * 1024 * 1024 }),
            partialize: (state) => ({
                items: state.items,
                boardSize: state.boardSize,
                // Don't persist view state (zoom, pan, selection)
            }),
        }
    )
);

// --- HOOK SELECTORS ---

/**
 * Hook to get all extracted colors from the vision board
 */
export const useExtractedColors = () =>
    useVisionBoardStore((state) => selectExtractedColors(state));

/**
 * Hook to get colors grouped by source
 */
export const useColorsBySource = () =>
    useVisionBoardStore((state) => selectColorsBySource(state));

/**
 * Hook to get selected items
 */
export const useSelectedItems = () =>
    useVisionBoardStore((state) =>
        state.selectedItemIds
            .map(id => state.items.find(item => item.id === id))
            .filter((item): item is VisionItem => item !== undefined)
    );

/**
 * Hook to get items sorted by z-index for rendering
 */
export const useSortedItems = () =>
    useVisionBoardStore((state) =>
        [...state.items].sort((a, b) => (a.position.zIndex ?? 0) - (b.position.zIndex ?? 0))
    );
