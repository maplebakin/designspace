import type { ApocapaletteTheme } from '../types/apocapalette';

/**
 * Navigates an object using dot notation path.
 *
 * @example
 * getValueByPath({ brand: { primary: { value: '#000' } } }, 'brand.primary.value') // '#000'
 */
const getValueByPath = (obj: object, path: string): any => {
    return path.split('.').reduce((acc, part) => acc && (acc as any)[part], obj);
};

/**
 * Resolves a theme token value from a theme object using dot notation path.
 *
 * Features:
 * - Navigates nested objects using dot notation (e.g., 'brand.primary.value')
 * - Automatically appends '.value' if the path doesn't end with it and initial lookup fails
 * - Extracts the 'value' property from objects that have it
 * - Returns null for null/undefined inputs or when value cannot be resolved
 * - Supports fallback values
 *
 * @param theme - The theme object (can be null/undefined)
 * @param path - Dot-notation path to the token (e.g., 'brand.primary' or 'typography.heading.value')
 * @param fallback - Optional fallback value if resolution fails
 *
 * @example
 * const theme = { brand: { primary: { value: '#ff0000' } } };
 * resolveThemeValue(theme, 'brand.primary') // '#ff0000'
 * resolveThemeValue(theme, 'brand.primary.value') // '#ff0000'
 * resolveThemeValue(theme, 'brand.missing', '#000') // '#000' (fallback)
 * resolveThemeValue(null, 'brand.primary') // null
 */
export const resolveThemeValue = (
    theme: ApocapaletteTheme | object | null | undefined,
    path: string,
    fallback?: string
): string | null => {
    if (!theme) return fallback ?? null;

    // Try to get value at path
    let value = getValueByPath(theme, path);

    // If not found and path doesn't end with '.value', try appending '.value'
    if (!value && !path.endsWith('.value')) {
        value = getValueByPath(theme, `${path}.value`);
    }

    // If value is an object with a 'value' property, extract it
    if (value && typeof value === 'object' && 'value' in value) {
        value = (value as { value: string }).value;
    }

    // Return the resolved value or fallback
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);

    return fallback ?? null;
};

/**
 * Resolves a theme token value and converts numbers to CSS px values.
 * Useful for layout tokens that may be defined as numbers.
 *
 * @param theme - The theme object (can be null/undefined)
 * @param path - Dot-notation path to the token
 * @param fallback - Optional fallback value if resolution fails
 *
 * @example
 * const theme = { spacing: { small: { value: 8 } } };
 * resolveThemeValueWithPx(theme, 'spacing.small') // '8px'
 * resolveThemeValueWithPx(theme, 'colors.primary') // '#ff0000' (unchanged for strings)
 */
export const resolveThemeValueWithPx = (
    theme: ApocapaletteTheme | object | null | undefined,
    path: string,
    fallback?: string
): string | null => {
    if (!theme) return fallback ?? null;

    let value = getValueByPath(theme, path);

    if (!value && !path.endsWith('.value')) {
        value = getValueByPath(theme, `${path}.value`);
    }

    if (value && typeof value === 'object' && 'value' in value) {
        value = (value as { value: any }).value;
    }

    // Convert numbers to px
    if (typeof value === 'number') return `${value}px`;
    if (typeof value === 'string') return value;

    return fallback ?? null;
};

/**
 * Resolves multiple theme values at once.
 * Returns an object mapping the same keys to their resolved values.
 *
 * @param theme - The theme object (can be null/undefined)
 * @param paths - Object mapping keys to token paths
 *
 * @example
 * const theme = { brand: { primary: { value: '#ff0000' } } };
 * resolveThemeValues(theme, {
 *   primary: 'brand.primary',
 *   secondary: 'brand.secondary'
 * })
 * // { primary: '#ff0000', secondary: null }
 */
export const resolveThemeValues = <T extends Record<string, string>>(
    theme: ApocapaletteTheme | object | null | undefined,
    paths: T
): Record<keyof T, string | null> => {
    const result = {} as Record<keyof T, string | null>;

    for (const key in paths) {
        result[key] = resolveThemeValue(theme, paths[key]);
    }

    return result;
};
