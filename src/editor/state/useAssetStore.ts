import { createWithEqualityFn } from 'zustand/traditional';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { ComponentType, SVGProps } from 'react';
import dynamicIconImports from 'lucide-react/dynamicIconImports';

const MAX_RECENT_COLORS = 20;

type LucideIconImport = () => Promise<{ default: ComponentType<SVGProps<SVGSVGElement>> }>;

export type VisionBoardItemType = 'image' | 'color' | 'pinned-state';

export interface VisionBoardItemBase {
    id: string;
    type: VisionBoardItemType;
    label?: string;
    createdAt: number;
    updatedAt: number;
}

export interface VisionBoardImageItem extends VisionBoardItemBase {
    type: 'image';
    src: string;
    thumbnail?: string;
}

export interface VisionBoardColorItem extends VisionBoardItemBase {
    type: 'color';
    hex: string;
}

export interface VisionBoardPinnedStateItem extends VisionBoardItemBase {
    type: 'pinned-state';
    canvasData: string;
    thumbnail?: string;
    canvasSize?: { width: number; height: number };
}

export type VisionBoardItem = VisionBoardImageItem | VisionBoardColorItem | VisionBoardPinnedStateItem;

export type CreateVisionBoardItem = Omit<VisionBoardItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

export interface UploadedImageAsset {
    id: string;
    url: string;
    label?: string;
    tags?: string[];
}

export type LucideIconMatch = {
    type: 'icon';
    key: string;
    name: string;
    importIcon: LucideIconImport;
};

export type UploadedImageMatch = {
    type: 'image';
    id: string;
    url: string;
    label?: string;
    tags?: string[];
};

export type AssetSearchResults = {
    icons: LucideIconMatch[];
    images: UploadedImageMatch[];
};

export interface AssetSearchOptions {
    maxIconResults?: number;
    maxImageResults?: number;
}

const capitalize = (value: string) => (value ? value[0].toUpperCase() + value.slice(1) : value);

const toTitleCase = (value: string) =>
    value
        .split('-')
        .map((part) => capitalize(part))
        .join(' ');

const normalizeSearchValue = (value: string) => value.trim().toLowerCase();

const LUCIDE_ICON_INDEX = Object.keys(dynamicIconImports)
    .sort()
    .map((key) => {
        const name = toTitleCase(key);
        return {
            key,
            name,
            searchable: `${key} ${name}`.toLowerCase(),
        };
    });

const getLucideImporter = (key: string): LucideIconImport => {
    const importer = (dynamicIconImports as Record<string, LucideIconImport>)[key];
    if (!importer) {
        return () => Promise.reject(new Error(`Missing lucide icon: ${key}`));
    }
    return importer;
};

const applyLimit = <T,>(items: T[], limit?: number) => {
    if (typeof limit !== 'number' || Number.isNaN(limit) || limit < 0) {
        return items;
    }
    return items.slice(0, limit);
};

const searchLucideIcons = (query: string, maxResults?: number): LucideIconMatch[] => {
    const normalized = normalizeSearchValue(query);
    const matches = normalized.length === 0
        ? LUCIDE_ICON_INDEX
        : LUCIDE_ICON_INDEX.filter((icon) => icon.searchable.includes(normalized));
    return applyLimit(matches, maxResults).map((icon) => ({
        type: 'icon',
        key: icon.key,
        name: icon.name,
        importIcon: getLucideImporter(icon.key),
    }));
};

const buildImageSearchText = (asset: UploadedImageAsset) => {
    const parts = [asset.label, asset.id, ...(asset.tags ?? [])].filter(Boolean);
    return parts.join(' ').toLowerCase();
};

const searchUploadedImages = (
    query: string,
    assets: UploadedImageAsset[],
    maxResults?: number
): UploadedImageMatch[] => {
    const normalized = normalizeSearchValue(query);
    const matches = normalized.length === 0
        ? assets
        : assets.filter((asset) => buildImageSearchText(asset).includes(normalized));
    return applyLimit(matches, maxResults).map((asset) => ({
        type: 'image',
        id: asset.id,
        url: asset.url,
        label: asset.label,
        tags: asset.tags,
    }));
};

export const searchAssets = (
    query: string,
    uploadedImages: UploadedImageAsset[] = [],
    options: AssetSearchOptions = {}
): AssetSearchResults => ({
    icons: searchLucideIcons(query, options.maxIconResults),
    images: searchUploadedImages(query, uploadedImages, options.maxImageResults),
});

interface AssetState {
    visionBoardItems: VisionBoardItem[];
    recentColors: string[];
    recentFonts: string[];

    addVisionBoardItem: (item: CreateVisionBoardItem) => string;
    updateVisionBoardItem: (
        id: string,
        updates: Partial<Omit<VisionBoardItem, 'id' | 'type' | 'createdAt'>>
    ) => void;
    removeVisionBoardItem: (id: string) => void;
    clearVisionBoard: () => void;

    addRecentColor: (color: string) => void;
    clearRecentColors: () => void;

    addRecentFont: (fontFamily: string) => void;
    clearRecentFonts: () => void;
}

const rgbToHex = (rgb: string): string | null => {
    const match = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (!match) return null;
    const r = Math.min(255, Math.max(0, parseInt(match[1], 10)));
    const g = Math.min(255, Math.max(0, parseInt(match[2], 10)));
    const b = Math.min(255, Math.max(0, parseInt(match[3], 10)));
    return `#${[r, g, b]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()}`;
};

const normalizeColor = (color: string): string | null => {
    const trimmed = color.trim();
    if (!trimmed) return null;
    if (/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(trimmed)) {
        return trimmed.toUpperCase();
    }
    if (trimmed.startsWith('rgb(')) {
        return rgbToHex(trimmed);
    }
    return trimmed;
};

const normalizeFont = (fontFamily: string): string | null => {
    const trimmed = fontFamily.trim();
    return trimmed.length > 0 ? trimmed : null;
};

export const useAssetStore = createWithEqualityFn<AssetState>()(
    persist(
        (set) => ({
            visionBoardItems: [],
            recentColors: [],
            recentFonts: [],

            addVisionBoardItem: (input) => {
                const id = input.id ?? uuidv4();
                const now = Date.now();
                const nextItem = {
                    ...input,
                    id,
                    createdAt: now,
                    updatedAt: now,
                } as VisionBoardItem;
                set((state) => ({
                    visionBoardItems: [
                        ...state.visionBoardItems,
                        nextItem,
                    ],
                }));
                return id;
            },
            updateVisionBoardItem: (id, updates) => {
                set((state) => ({
                    visionBoardItems: state.visionBoardItems.map((item) =>
                        item.id === id
                            ? {
                                ...item,
                                ...updates,
                                updatedAt: Date.now(),
                            }
                            : item
                    ),
                }));
            },
            removeVisionBoardItem: (id) => {
                set((state) => ({
                    visionBoardItems: state.visionBoardItems.filter((item) => item.id !== id),
                }));
            },
            clearVisionBoard: () => set({ visionBoardItems: [] }),

            addRecentColor: (color) => {
                const normalized = normalizeColor(color);
                if (!normalized) return;
                set((state) => {
                    const filtered = state.recentColors.filter(
                        (value) => value.toLowerCase() !== normalized.toLowerCase()
                    );
                    return { recentColors: [normalized, ...filtered].slice(0, MAX_RECENT_COLORS) };
                });
            },
            clearRecentColors: () => set({ recentColors: [] }),

            addRecentFont: (fontFamily) => {
                const normalized = normalizeFont(fontFamily);
                if (!normalized) return;
                set((state) => {
                    const filtered = state.recentFonts.filter(
                        (value) => value.toLowerCase() !== normalized.toLowerCase()
                    );
                    return { recentFonts: [normalized, ...filtered] };
                });
            },
            clearRecentFonts: () => set({ recentFonts: [] }),
        }),
        {
            name: 'designspace-asset-store',
        }
    )
);
