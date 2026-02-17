import type { UnitMode } from '../utils/units';

export type CanvasPresetCategory = 'social' | 'print';

export type CanvasPreset = {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  unitMode: UnitMode;
  category: CanvasPresetCategory;
};

const BASE_PRESETS: CanvasPreset[] = [
  {
    id: 'us-letter',
    name: 'US Letter',
    description: '8.5" × 11" @ 300 DPI',
    width: Math.round(8.5 * 300),
    height: Math.round(11 * 300),
    unitMode: 'in',
    category: 'print',
  },
  {
    id: 'a4-document',
    name: 'A4',
    description: '210 × 297 mm @ 300 DPI',
    width: 2480,
    height: 3508,
    unitMode: 'in',
    category: 'print',
  },
  {
    id: 'a5-grimoire',
    name: 'A5 Grimoire',
    description: '5.8" × 8.3" @ 300 DPI',
    width: 1740,
    height: 2490,
    unitMode: 'in',
    category: 'print',
  },
  {
    id: 'ritual-card',
    name: 'Ritual Card',
    description: '5" × 7" @ 300 DPI',
    width: 1500,
    height: 2100,
    unitMode: 'in',
    category: 'print',
  },
  {
    id: 'tarot-card',
    name: 'Tarot Card',
    description: '3.5" × 5" @ 300 DPI',
    width: Math.round(3.5 * 300),
    height: Math.round(5 * 300),
    unitMode: 'in',
    category: 'print',
  },
  {
    id: 'instagram-square',
    name: 'Instagram Square',
    description: '1080 × 1080 px',
    width: 1080,
    height: 1080,
    unitMode: 'px',
    category: 'social',
  },
  {
    id: 'instagram-story',
    name: 'Instagram Story',
    description: '1080 × 1920 px',
    width: 1080,
    height: 1920,
    unitMode: 'px',
    category: 'social',
  },
  {
    id: 'youtube-thumbnail',
    name: 'YouTube Thumbnail',
    description: '1280 × 720 px',
    width: 1280,
    height: 720,
    unitMode: 'px',
    category: 'social',
  },
  {
    id: 'tiktok-video',
    name: 'TikTok Video',
    description: '1080 × 1920 px',
    width: 1080,
    height: 1920,
    unitMode: 'px',
    category: 'social',
  },
  {
    id: 'pinterest-pin',
    name: 'Pinterest Pin',
    description: '1000 × 1500 px',
    width: 1000,
    height: 1500,
    unitMode: 'px',
    category: 'social',
  },
  {
    id: 'desktop-wallpaper',
    name: 'Desktop Wallpaper',
    description: '1920 × 1080 px',
    width: 1920,
    height: 1080,
    unitMode: 'px',
    category: 'social',
  },
];

const PRESET_INDEX = new Map(BASE_PRESETS.map((preset) => [preset.id, preset]));

export const CANVAS_PRESET_REGISTRY = Object.freeze({
  print: BASE_PRESETS.filter((preset) => preset.category === 'print'),
  social: BASE_PRESETS.filter((preset) => preset.category === 'social'),
});

const resolvePresetIds = (ids: string[]) =>
  ids
    .map((id) => PRESET_INDEX.get(id))
    .filter((preset): preset is CanvasPreset => !!preset);

export const DASHBOARD_PRESETS = resolvePresetIds([
  'instagram-square',
  'instagram-story',
  'youtube-thumbnail',
  'tiktok-video',
  'pinterest-pin',
  'desktop-wallpaper',
]);

export const CANVAS_SETTINGS_PRESETS = resolvePresetIds([
  'us-letter',
  'a4-document',
  'a5-grimoire',
  'ritual-card',
  'instagram-square',
]);

export const PROJECT_PRESET_GROUPS = Object.freeze({
  print: resolvePresetIds(['ritual-card', 'tarot-card', 'a4-document', 'us-letter']),
  social: resolvePresetIds(['instagram-square', 'instagram-story', 'desktop-wallpaper']),
});

export const buildRecentCanvasPresets = (sizes: Array<{ width: number; height: number }>): CanvasPreset[] => {
  const seen = new Set<string>();
  const recent: CanvasPreset[] = [];
  sizes.forEach((size, index) => {
    const width = Math.max(1, Math.round(size.width));
    const height = Math.max(1, Math.round(size.height));
    const key = `${width}x${height}`;
    if (seen.has(key)) return;
    seen.add(key);
    recent.push({
      id: `recent-${index}-${key}`,
      name: `Recent ${index + 1}`,
      description: `${width} × ${height} px`,
      width,
      height,
      unitMode: 'px' as UnitMode,
      category: 'social',
    });
  });
  return recent.slice(0, 6);
};
