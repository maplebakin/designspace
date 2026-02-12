/**
 * Theme Importer Service
 * Imports theme JSON files in various formats and auto-categorizes colors into semantic groups.
 *
 * Supported formats:
 * - Flat key/value: { "primary": "#ff0000", "background": "#ffffff" }
 * - Nested objects: { "colors": { "primary": "#ff0000" }, "brand": { "main": "#00ff00" } }
 * - Arrays: { "palette": ["#ff0000", "#00ff00", "#0000ff"] }
 * - Color objects: { "primary": { "value": "#ff0000" } }
 * - Named files: "base gray green.json" extracts name from filename
 */

import { v4 as uuidv4 } from 'uuid';
import type { ApocapaletteTheme } from '../types/apocapalette';
import type { BrandCollection } from '../state/useThemeStore';

export interface SimpleThemeJson {
  name?: string;
  mode?: 'light' | 'dark';
  [key: string]: unknown;
}

export type ColorCategory =
  | 'brand'
  | 'headers'
  | 'surfaces'
  | 'neutrals'
  | 'accents'
  | 'semantic';

interface CategorizedColor {
  key: string;
  value: string;
  category: ColorCategory;
  role: string;
}

// Match hex colors with optional alpha channel
const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// Match RGB/RGBA: rgb(255, 0, 0) or rgba(255, 0, 0, 0.5)
// const RGB_COLOR_REGEX = /^rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+)?\s*\)$/i;

// Match HSL/HSLA: hsl(360, 100%, 50%) or hsla(360, 100%, 50%, 0.5)
// const HSL_COLOR_REGEX = /^hsla?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*(?:,\s*[\d.]+)?\s*\)$/i;

// Keywords that hint at color categories
const CATEGORY_HINTS: Record<string, ColorCategory> = {
  text: 'headers',
  typography: 'headers',
  heading: 'headers',
  header: 'headers',
  title: 'headers',
  h1: 'headers',
  h2: 'headers',
  h3: 'headers',
  body: 'headers',
  copy: 'headers',
  brand: 'brand',
  logo: 'brand',
  primary: 'brand',
  secondary: 'brand',
  surface: 'surfaces',
  background: 'surfaces',
  canvas: 'surfaces',
  card: 'surfaces',
  panel: 'surfaces',
  neutral: 'neutrals',
  gray: 'neutrals',
  grey: 'neutrals',
  muted: 'neutrals',
  subtle: 'neutrals',
  border: 'neutrals',
  divider: 'neutrals',
  shadow: 'neutrals',
  interactive: 'accents',
  action: 'accents',
  link: 'accents',
  accent: 'accents',
  highlight: 'accents',
  focus: 'accents',
  hover: 'accents',
  active: 'accents',
  status: 'semantic',
  error: 'semantic',
  warning: 'semantic',
  success: 'semantic',
  info: 'semantic',
  danger: 'semantic',
};

function isHexColor(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return HEX_COLOR_REGEX.test(value);
}

// /**
//  * Check if a value is any valid color format (hex, rgb, hsl)
//  */
// function isValidColor(value: unknown): value is string {
//   if (typeof value !== 'string') return false;
//   return (
//     HEX_COLOR_REGEX.test(value) ||
//     RGB_COLOR_REGEX.test(value) ||
//     HSL_COLOR_REGEX.test(value)
//   );
// }

// /**
//  * Convert RGB to hex
//  */
// function rgbToHex(r: number, g: number, b: number): string {
//   const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
//   return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
// }

// /**
//  * Convert HSL to hex
//  */
// function hslToHex(h: number, s: number, l: number): string {
//   s /= 100;
//   l /= 100;

//   const c = (1 - Math.abs(2 * l - 1)) * s;
//   const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
//   const m = l - c / 2;

//   let r = 0, g = 0, b = 0;

//   if (h < 60) { r = c; g = x; b = 0; }
//   else if (h < 120) { r = x; g = c; b = 0; }
//   else if (h < 180) { r = 0; g = c; b = x; }
//   else if (h < 240) { r = 0; g = x; b = c; }
//   else if (h < 300) { r = x; g = 0; b = c; }
//   else { r = c; g = 0; b = x; }

//   return rgbToHex(
//     Math.round((r + m) * 255),
//     Math.round((g + m) * 255),
//     Math.round((b + m) * 255)
//   );
// }

// /**
//  * Normalize any color format to hex
//  */
// function normalizeToHex(value: string): string {
//   // Already hex
//   if (HEX_COLOR_REGEX.test(value)) {
//     // Normalize 3-char hex to 6-char
//     if (value.length === 4) {
//       const [, r, g, b] = value;
//       return `#${r}${r}${g}${g}${b}${b}`;
//     }
//     // Strip alpha channel if present
//     if (value.length === 9) {
//       return value.slice(0, 7);
//     }
//     if (value.length === 5) {
//       const [, r, g, b] = value;
//       return `#${r}${r}${g}${g}${b}${b}`;
//     }
//     return value;
//   }

//   // RGB format
//   const rgbMatch = value.match(RGB_COLOR_REGEX);
//   if (rgbMatch) {
//     return rgbToHex(
//       parseInt(rgbMatch[1], 10),
//       parseInt(rgbMatch[2], 10),
//       parseInt(rgbMatch[3], 10)
//     );
//   }

//   // HSL format
//   const hslMatch = value.match(HSL_COLOR_REGEX);
//   if (hslMatch) {
//     return hslToHex(
//       parseInt(hslMatch[1], 10),
//       parseInt(hslMatch[2], 10),
//       parseInt(hslMatch[3], 10)
//     );
//   }

//   return value;
// }

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h.split('').map(c => c + c).join('');
  }
  const num = parseInt(h, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function getLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function getSaturation(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

function inferCategoryFromKey(key: string): ColorCategory | null {
  const lower = key.toLowerCase();
  for (const [hint, category] of Object.entries(CATEGORY_HINTS)) {
    if (lower.includes(hint)) {
      return category;
    }
  }
  return null;
}

function inferCategoryFromColor(hex: string): ColorCategory {
  const luminance = getLuminance(hex);
  const saturation = getSaturation(hex);

  // Very low saturation = neutrals/grays
  if (saturation < 0.1) {
    return luminance > 0.85 ? 'surfaces' : 'neutrals';
  }

  // High saturation, medium luminance = brand/accents
  if (saturation > 0.5) {
    return luminance > 0.6 ? 'accents' : 'brand';
  }

  // Low-medium saturation, high luminance = surfaces
  if (luminance > 0.8) {
    return 'surfaces';
  }

  // Default to neutrals
  return 'neutrals';
}

/**
 * Recursively extract colors from various JSON structures
 */
function extractColorsFromValue(
  value: unknown,
  key: string,
  parentKey: string = ''
): Array<{ key: string; value: string; parentKey: string }> {
  const results: Array<{ key: string; value: string; parentKey: string }> = [];
  const fullKey = parentKey ? `${parentKey}.${key}` : key;

  // Direct hex color string
  if (isHexColor(value)) {
    results.push({ key: fullKey, value, parentKey });
    return results;
  }

  // Color object with 'value' property: { "value": "#hex" }
  if (typeof value === 'object' && value !== null && 'value' in value) {
    const colorValue = (value as Record<string, unknown>).value;
    if (isHexColor(colorValue)) {
      results.push({ key: fullKey, value: colorValue, parentKey });
      return results;
    }
  }

  // Array of colors: ["#hex1", "#hex2"]
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (isHexColor(item)) {
        results.push({ key: `${fullKey}[${index}]`, value: item, parentKey: fullKey });
      } else if (typeof item === 'object' && item !== null) {
        // Array of color objects
        const extracted = extractColorsFromValue(item, `${index}`, fullKey);
        results.push(...extracted);
      }
    });
    return results;
  }

  // Nested object: recurse into it
  if (typeof value === 'object' && value !== null) {
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      const extracted = extractColorsFromValue(nestedValue, nestedKey, fullKey);
      results.push(...extracted);
    }
  }

  return results;
}

function categorizeColors(json: SimpleThemeJson): CategorizedColor[] {
  const colors: CategorizedColor[] = [];
  const seenColors = new Set<string>(); // Avoid duplicates

  for (const [key, value] of Object.entries(json)) {
    // Skip metadata fields
    if (key === 'name' || key === 'mode' || key === 'meta' || key === '$schema') {
      continue;
    }

    const extracted = extractColorsFromValue(value, key);

    for (const { key: fullKey, value: colorValue, parentKey } of extracted) {
      // Create a unique identifier to avoid duplicates
      const uniqueId = `${fullKey}:${colorValue}`;
      if (seenColors.has(uniqueId)) continue;
      seenColors.add(uniqueId);

      // Try to infer category from key name (use full key path for better hints)
      let category = inferCategoryFromKey(fullKey);

      // Also check parent key for category hints
      if (!category && parentKey) {
        category = inferCategoryFromKey(parentKey);
      }

      // Fall back to color analysis
      if (!category) {
        category = inferCategoryFromColor(colorValue);
      }

      // Generate a readable role name from the key
      // Extract the last part of the key path for display
      const keyParts = fullKey.split('.');
      const displayKey = keyParts[keyParts.length - 1]
        .replace(/\[\d+\]$/, '') // Remove array indices
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .trim()
        .toLowerCase() || `color ${colors.length + 1}`;

      colors.push({
        key: fullKey,
        value: colorValue,
        category,
        role: displayKey,
      });
    }
  }

  return colors;
}

function buildSwatches(colors: CategorizedColor[]): BrandCollection['swatches'] {
  const swatches: BrandCollection['swatches'] = {};

  const categoryLabels: Record<ColorCategory, string> = {
    brand: 'Brand',
    headers: 'Headers',
    surfaces: 'Surfaces',
    neutrals: 'Neutrals',
    accents: 'Accents',
    semantic: 'Semantic',
  };

  for (const color of colors) {
    const label = categoryLabels[color.category];
    if (!swatches[label]) {
      swatches[label] = {};
    }
    // Capitalize role for display
    const displayRole = color.role
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    swatches[label][displayRole] = color.value;
  }

  return swatches;
}

function buildApocapaletteTheme(
  json: SimpleThemeJson,
  colors: CategorizedColor[]
): ApocapaletteTheme {
  const theme: ApocapaletteTheme = {
    meta: {
      schema: 'generic-token-pack-v1',
      name: json.name || 'Imported Theme',
    },
  };

  // Group colors by category for theme structure
  const byCategory = colors.reduce((acc, c) => {
    if (!acc[c.category]) acc[c.category] = [];
    acc[c.category].push(c);
    return acc;
  }, {} as Record<ColorCategory, CategorizedColor[]>);

  // Build brand section
  if (byCategory.brand?.length) {
    theme.brand = {};
    byCategory.brand.forEach((c, i) => {
      const role = i === 0 ? 'primary' : i === 1 ? 'secondary' : `color${i + 1}`;
      theme.brand[role] = { value: c.value };
    });
  }

  // Build surfaces section
  if (byCategory.surfaces?.length) {
    theme.surfaces = {};
    byCategory.surfaces.forEach((c) => {
      const key = c.key.toLowerCase().includes('background') ? 'background' : c.role.replace(/\s+/g, '-');
      theme.surfaces[key] = { value: c.value };
    });
  }

  // Build headers/typography section
  if (byCategory.headers?.length) {
    theme.typography = theme.typography || {};
    byCategory.headers.forEach((c) => {
      const key = c.role.replace(/\s+/g, '-');
      theme.typography[key] = { value: c.value };
    });
  }

  // Build neutrals section
  if (byCategory.neutrals?.length) {
    theme.neutrals = {};
    byCategory.neutrals.forEach((c, i) => {
      theme.neutrals[`neutral${i + 1}`] = { value: c.value };
    });
  }

  // Build accents section
  if (byCategory.accents?.length) {
    theme.accents = {};
    byCategory.accents.forEach((c, i) => {
      const role = i === 0 ? 'accent' : `accent${i + 1}`;
      theme.accents[role] = { value: c.value };
    });
    // Also add to brand.accent if not present
    if (!theme.brand) theme.brand = {};
    if (!theme.brand.accent && byCategory.accents[0]) {
      theme.brand.accent = { value: byCategory.accents[0].value };
    }
  }

  // Build semantic section
  if (byCategory.semantic?.length) {
    theme.semantic = {};
    byCategory.semantic.forEach((c) => {
      const key = c.role.replace(/\s+/g, '-');
      theme.semantic[key] = { value: c.value };
    });
  }

  // Store mode if provided
  if (json.mode) {
    theme.mode = json.mode;
  }

  return theme;
}

export interface ImportResult {
  success: boolean;
  error?: string;
  collection?: BrandCollection;
  categories?: Record<string, string[]>;
}

export function importThemeJson(json: SimpleThemeJson): ImportResult {
  try {
    const colors = categorizeColors(json);

    if (colors.length === 0) {
      return { success: false, error: 'No valid hex colors found in theme' };
    }

    const themeData = buildApocapaletteTheme(json, colors);
    const swatches = buildSwatches(colors);

    // Build categories summary for UI
    const categories: Record<string, string[]> = {};
    for (const color of colors) {
      if (!categories[color.category]) {
        categories[color.category] = [];
      }
      categories[color.category].push(color.value);
    }

    const collection: BrandCollection = {
      id: uuidv4(),
      name: json.name || 'Imported Theme',
      themeData,
      swatches,
    };

    return { success: true, collection, categories };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to import theme',
    };
  }
}

export function parseThemeFile(text: string, filename?: string): SimpleThemeJson {
  const json = JSON.parse(text);

  // If no name in JSON, extract from filename
  if (!json.name && filename) {
    json.name = extractNameFromFilename(filename);
  }

  return json;
}

/**
 * Extract a theme name from filename.
 * Examples:
 * - "base gray green.json" -> "Base Gray Green"
 * - "my-awesome-theme.json" -> "My Awesome Theme"
 * - "colors_v2.json" -> "Colors V2"
 */
export function extractNameFromFilename(filename: string): string {
  // Remove extension
  const nameWithoutExt = filename.replace(/\.json$/i, '');

  // Replace common separators with spaces
  const withSpaces = nameWithoutExt
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2'); // camelCase to spaces

  // Capitalize each word
  const capitalized = withSpaces
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  return capitalized || 'Imported Theme';
}

/**
 * Import theme from file content with filename for name extraction
 */
export function importThemeFromFile(
  text: string,
  filename: string
): ImportResult {
  try {
    const json = parseThemeFile(text, filename);
    return importThemeJson(json);
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to parse theme file',
    };
  }
}
