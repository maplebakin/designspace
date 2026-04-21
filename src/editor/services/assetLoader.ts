import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';

/**
 * Asset Loader Service
 *
 * Centralized service for loading various asset types with:
 * - Blob URL lifecycle management (prevents memory leaks)
 * - Unified error handling
 * - Type-safe results
 * - Progress tracking capability
 */

// --- TYPES ---

export type AssetType = 'image' | 'svg' | 'pdf' | 'sticker';

export interface AssetLoadSuccess<T = fabric.FabricImage> {
    success: true;
    asset: T;
    blobUrl?: string;
    id: string;
}

export interface AssetLoadError {
    success: false;
    error: Error;
    errorMessage: string;
    blobUrl?: string; // If a blob URL was created, it will be auto-revoked
}

export type AssetLoadResult<T = fabric.FabricImage> = AssetLoadSuccess<T> | AssetLoadError;

export interface ImageLoadOptions {
    /** Cross-origin setting for external URLs */
    crossOrigin?: 'anonymous' | 'use-credentials';
    /** Custom ID for the loaded image */
    id?: string;
    /** Additional Fabric.js image options */
    fabricOptions?: Partial<fabric.ImageProps>;
}

export interface FileToAssetOptions {
    /** Whether to add the asset to canvas automatically */
    addToCanvas?: boolean;
    /** Canvas to add to if addToCanvas is true */
    canvas?: fabric.Canvas;
    /** Position to place the asset */
    position?: { x: number; y: number };
    /** Whether to center the object on the canvas */
    center?: boolean;
}

// --- BLOB URL REGISTRY ---

/**
 * Global registry to track all blob URLs created by the asset loader.
 * Maps blob URLs to metadata for debugging and cleanup.
 */
class BlobUrlRegistry {
    private urls = new Map<string, {
        id: string;
        type: AssetType;
        createdAt: Date;
        file?: string; // Original file name if available
    }>();

    register(url: string, type: AssetType, id: string, fileName?: string): void {
        this.urls.set(url, {
            id,
            type,
            createdAt: new Date(),
            file: fileName
        });
    }

    revoke(url: string): boolean {
        const metadata = this.urls.get(url);
        if (!metadata) return false;

        try {
            URL.revokeObjectURL(url);
            this.urls.delete(url);
            return true;
        } catch (error) {
            console.warn(`Failed to revoke blob URL ${url}:`, error);
            return false;
        }
    }

    revokeAll(): number {
        let count = 0;
        for (const url of this.urls.keys()) {
            if (this.revoke(url)) count++;
        }
        return count;
    }

    getMetadata(url: string) {
        return this.urls.get(url);
    }

    /**
     * Get a URL by asset ID.
     * Returns the first matching URL for the given asset ID.
     */
    get(id: string): string | undefined {
        for (const [url, metadata] of this.urls.entries()) {
            if (metadata.id === id) {
                return url;
            }
        }
        return undefined;
    }

    getAllUrls(): string[] {
        return Array.from(this.urls.keys());
    }

    getStats() {
        return {
            total: this.urls.size,
            byType: Array.from(this.urls.values()).reduce((acc, meta) => {
                acc[meta.type] = (acc[meta.type] || 0) + 1;
                return acc;
            }, {} as Record<AssetType, number>)
        };
    }
}

// Singleton registry instance
const blobRegistry = new BlobUrlRegistry();

// --- ERROR HANDLING ---

class AssetLoadingError extends Error {
    constructor(
        message: string,
        public readonly code:
            | 'INVALID_FILE'
            | 'LOAD_FAILED'
            | 'UNSUPPORTED_FORMAT'
            | 'NETWORK_ERROR'
            | 'PARSE_ERROR'
            | 'UNKNOWN_ERROR',
        public readonly originalError?: unknown
    ) {
        super(message);
        this.name = 'AssetLoadingError';
    }
}

function createErrorResult(
    error: unknown,
    blobUrl?: string
): AssetLoadError {
    // Auto-revoke blob URL on error
    if (blobUrl) {
        blobRegistry.revoke(blobUrl);
    }

    if (error instanceof AssetLoadingError) {
        return {
            success: false,
            error,
            errorMessage: error.message,
            blobUrl
        };
    }

    const errorMessage = error instanceof Error
        ? error.message
        : 'Unknown error occurred while loading asset';

    return {
        success: false,
        error: error instanceof Error ? error : new Error(errorMessage),
        errorMessage,
        blobUrl
    };
}

// --- CORE LOADING FUNCTIONS ---

/**
 * Creates a blob URL from a File and registers it for tracking.
 * Always use this instead of URL.createObjectURL directly.
 */
export function createTrackedBlobUrl(
    file: File,
    type: AssetType,
    id?: string
): { url: string; id: string } {
    const blobUrl = URL.createObjectURL(file);
    const assetId = id || uuidv4();
    blobRegistry.register(blobUrl, type, assetId, file.name);
    return { url: blobUrl, id: assetId };
}

/**
 * Revokes a blob URL and removes it from tracking.
 * Always use this instead of URL.revokeObjectURL directly.
 */
export function revokeTrackedBlobUrl(url: string): boolean {
    return blobRegistry.revoke(url);
}

/**
 * Loads a Fabric.js image from a URL (blob or external).
 * Handles errors and provides consistent result format.
 */
export async function loadFabricImage(
    url: string,
    options: ImageLoadOptions = {}
): Promise<AssetLoadResult<fabric.FabricImage>> {
    const id = options.id || uuidv4();

    try {
        const img = await fabric.Image.fromURL(url, {
            crossOrigin: options.crossOrigin || 'anonymous',
            ...options.fabricOptions
        });

        // Ensure the image loaded successfully
        if (!img || !img.width || !img.height) {
            throw new AssetLoadingError(
                'Image loaded but has invalid dimensions',
                'LOAD_FAILED'
            );
        }

        // Set custom properties
        (img as any).id = id;

        return {
            success: true,
            asset: img,
            id
        };
    } catch (error) {
        throw new AssetLoadingError(
            `Failed to load image from ${url}`,
            'LOAD_FAILED',
            error
        );
    }
}

/**
 * Safe image loading wrapper for external URLs or blob URLs.
 * Use this for loading images from any source without creating tracked blobs.
 * For File objects, use loadImageFromFile() instead.
 *
 * @example
 * // Load from external URL
 * const result = await safeLoadImage('https://example.com/image.jpg');
 * if (result.success) {
 *   canvas.add(result.asset);
 * }
 *
 * @example
 * // Load from blob URL (not tracked)
 * const blobUrl = URL.createObjectURL(file);
 * const result = await safeLoadImage(blobUrl);
 * if (result.success) {
 *   canvas.add(result.asset);
 * }
 * URL.revokeObjectURL(blobUrl); // Manual cleanup required
 */
export async function safeLoadImage(
    url: string,
    options: ImageLoadOptions = {}
): Promise<AssetLoadResult<fabric.FabricImage>> {
    try {
        return await loadFabricImage(url, options);
    } catch (error) {
        return createErrorResult(error);
    }
}

/**
 * Loads an image from a File object.
 * Creates a tracked blob URL and loads the image.
 */
export async function loadImageFromFile(
    file: File,
    options: ImageLoadOptions = {}
): Promise<AssetLoadResult<fabric.FabricImage>> {
    // Validate file type
    if (!file.type.startsWith('image/')) {
        return createErrorResult(
            new AssetLoadingError(
                `Invalid file type: ${file.type}. Expected an image.`,
                'INVALID_FILE'
            )
        );
    }

    const { url: blobUrl, id } = createTrackedBlobUrl(file, 'image', options.id);
    const dataUrl = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });

    try {
        const result = await loadFabricImage(blobUrl, { ...options, id });

        if (result.success) {
            if (dataUrl) {
                (result.asset as any).svgDataUrl = dataUrl;
            }
            return {
                ...result,
                blobUrl
            };
        }

        return createErrorResult(result.error, blobUrl);
    } catch (error) {
        return createErrorResult(error, blobUrl);
    }
}

/**
 * Loads an SVG from a File object as a string.
 * Returns the SVG content as text for further processing.
 */
export async function loadSvgFromFile(
    file: File
): Promise<AssetLoadResult<string>> {
    const id = uuidv4();

    // Validate file type
    if (file.type !== 'image/svg+xml' && !file.name.endsWith('.svg')) {
        return createErrorResult(
            new AssetLoadingError(
                `Invalid file type: ${file.type}. Expected SVG.`,
                'INVALID_FILE'
            )
        );
    }

    return new Promise((resolve) => {
        const reader = new FileReader();

        reader.onload = (event: ProgressEvent<FileReader>) => {
            try {
                const svgString = event.target?.result as string;

                if (!svgString || typeof svgString !== 'string') {
                    resolve(createErrorResult(
                        new AssetLoadingError(
                            'Failed to read SVG file content',
                            'LOAD_FAILED'
                        )
                    ));
                    return;
                }

                resolve({
                    success: true,
                    asset: svgString,
                    id
                });
            } catch (error) {
                resolve(createErrorResult(
                    new AssetLoadingError(
                        'Failed to parse SVG content',
                        'PARSE_ERROR',
                        error
                    )
                ));
            }
        };

        reader.onerror = () => {
            resolve(createErrorResult(
                new AssetLoadingError(
                    `Failed to read file: ${file.name}`,
                    'LOAD_FAILED',
                    reader.error
                )
            ));
        };

        reader.readAsText(file);
    });
}

/**
 * Loads a sticker (PNG image) from a File.
 * Similar to loadImageFromFile but specifically for stickers.
 */
export async function loadStickerFromFile(
    file: File,
    options: ImageLoadOptions = {}
): Promise<AssetLoadResult<fabric.FabricImage>> {
    // Validate file type (stickers must be PNG)
    if (file.type !== 'image/png') {
        return createErrorResult(
            new AssetLoadingError(
                `Invalid file type: ${file.type}. Stickers must be PNG.`,
                'INVALID_FILE'
            )
        );
    }

    const { url: blobUrl, id } = createTrackedBlobUrl(file, 'sticker', options.id);

    try {
        const result = await loadFabricImage(blobUrl, { ...options, id });

        if (result.success) {
            return {
                ...result,
                blobUrl
            };
        }

        return createErrorResult(result.error, blobUrl);
    } catch (error) {
        return createErrorResult(error, blobUrl);
    }
}

// --- HELPER UTILITIES ---

/**
 * Extracts file metadata for asset registration.
 */
export function extractFileMetadata(file: File) {
    const baseName = file.name.split('.').slice(0, -1).join('.') || file.name;
    const extension = file.name.split('.').pop()?.toLowerCase();

    let format: 'png' | 'jpeg' | 'svg' | undefined;
    if (file.type === 'image/png') format = 'png';
    else if (file.type === 'image/jpeg') format = 'jpeg';
    else if (file.type === 'image/svg+xml') format = 'svg';

    return {
        baseName,
        extension,
        format,
        size: file.size,
        type: file.type,
        tags: [baseName.toLowerCase(), 'upload']
    };
}

/**
 * Validates if a file is a supported image type.
 */
export function isSupportedImageFile(file: File): boolean {
    const supportedTypes = [
        'image/png',
        'image/jpeg',
        'image/jpg',
        'image/svg+xml',
        'image/webp'
    ];
    return supportedTypes.includes(file.type);
}

/**
 * Validates if a file is a PNG (for stickers).
 */
export function isPngFile(file: File): boolean {
    return file.type === 'image/png';
}

/**
 * Validates if a file is an SVG.
 */
export function isSvgFile(file: File): boolean {
    return file.type === 'image/svg+xml' || file.name.endsWith('.svg');
}

// --- CLEANUP & DIAGNOSTICS ---

/**
 * Revokes all tracked blob URLs.
 * Call this when cleaning up or unmounting components.
 */
export function revokeAllTrackedBlobUrls(): number {
    return blobRegistry.revokeAll();
}

/**
 * Cleans up all assets by revoking tracked blob URLs.
 * Alias for revokeAllTrackedBlobUrls() with a more semantic name.
 * Use in useEffect cleanup or component unmounting.
 *
 * @example
 * useEffect(() => {
 *   return () => {
 *     cleanupAssets(); // Cleanup on unmount
 *   };
 * }, []);
 *
 * @returns Number of URLs revoked
 */
export function cleanupAssets(): number {
    return revokeAllTrackedBlobUrls();
}

/**
 * Gets statistics about tracked blob URLs.
 * Useful for debugging memory leaks.
 */
export function getBlobUrlStats() {
    return blobRegistry.getStats();
}

/**
 * Gets all currently tracked blob URLs.
 * Useful for debugging.
 */
export function getAllTrackedBlobUrls(): string[] {
    return blobRegistry.getAllUrls();
}

/**
 * Gets metadata for a specific blob URL.
 */
export function getBlobUrlMetadata(url: string) {
    return blobRegistry.getMetadata(url);
}

// --- EXPORT REGISTRY FOR ADVANCED USE CASES ---

/**
 * Export the registry for advanced use cases.
 * Most code should use the exported functions instead.
 */
export const assetBlobRegistry = blobRegistry;
