import { useEditorStore } from '../state/editorStore';
import { useThemeStore, applyThemeToCanvas, BrandCollection } from '../state/useThemeStore';
import { colorDifference } from '../utils/color';

// Re-export BrandCollection for backward compatibility
export type { BrandCollection } from '../state/useThemeStore';

/**
 * Iterates through all objects on the canvas and applies colors from the
 * active theme if the object has a 'tokenRole' property.
 * SKIPS any objects that are locked.
 *
 * PHASE 1.3 SAFETY GATE: This function will NOT execute unless canvasReadyState === 'ready'.
 * This prevents theme application during initialization, preventing race conditions.
 *
 * PHASE 2.2 SYNC LOCK: This function acquires a sync lock to prevent interference
 * during theme application.
 *
 * NOTE: This function now delegates to themeStore's applyThemeToCanvas for the actual
 * theme application logic.
 */
export const applyActiveThemeToCanvas = (options?: { observe?: boolean }) => {
    const {
        canvas,
        saveState,
        requestLayerSync,
        syncCanvasToStore,
        canvasReadyState,
        acquireSyncLock,
        releaseSyncLock
    } = useEditorStore.getState();

    // Get theme data from themeStore (source of truth)
    const themeData = useThemeStore.getState().themeData;

    // PHASE 1.3: Strict gate - only apply theme if canvas is fully ready
    if (canvasReadyState !== 'ready') {
        if (themeData) {
            console.warn('[Phase 1.3] Theme application blocked - canvas not ready. State:', canvasReadyState);
        }
        return;
    }

    if (!canvas || !themeData) {
        return;
    }

    // Delegate to themeStore's applyThemeToCanvas
    applyThemeToCanvas(canvas, themeData, {
        saveState,
        requestLayerSync,
        syncCanvasToStore,
        acquireSyncLock,
        releaseSyncLock,
        ...(options?.observe === false ? {} : { onCommitted: undefined }),
    });
};

/**
 * Finds the best theme from the brand vault that matches a given color.
 * @param hex - The hex color to match against.
 * @returns The best matching BrandCollection or null if none found.
 */
export const findBestThemeMatch = (hex: string): BrandCollection | null => {
    // Get brand vault from themeStore (source of truth)
    const { brandVault } = useThemeStore.getState();
    if (brandVault.length === 0) {
        return null;
    }

    let bestMatch: BrandCollection | null = null;
    let minDifference = Infinity;

    brandVault.forEach(collection => {
        const anchorColor = collection.themeData.brand?.primary?.value;
        if (anchorColor) {
            const difference = colorDifference(hex, anchorColor);
            if (difference < minDifference) {
                minDifference = difference;
                bestMatch = collection;
            }
        }
    });

    return bestMatch;
}
