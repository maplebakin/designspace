import * as fabric from 'fabric';
import { useEditorStore, BrandCollection } from '../state/editorStore';
import { colorDifference } from '../utils/color';

/**
 * Safely retrieves a nested value from an object using a dot-notation string.
 * @param obj The object to query.
 * @param path The dot-notation path (e.g., 'brand.primary.value').
 * @returns The value if found, otherwise undefined.
 */
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

/**
 * Iterates through all objects on the canvas and applies colors from the
 * active theme if the object has a 'tokenRole' property.
 * SKIPS any objects that are locked.
 */
export const applyActiveThemeToCanvas = () => {
    const { canvas, themeData, saveState, requestLayerSync } = useEditorStore.getState();

    if (!canvas || !themeData) {
        return;
    }

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
};

/**
 * Finds the best theme from the brand vault that matches a given color.
 * @param hex - The hex color to match against.
 * @returns The best matching BrandCollection or null if none found.
 */
export const findBestThemeMatch = (hex: string): BrandCollection | null => {
    const { brandVault } = useEditorStore.getState();
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
