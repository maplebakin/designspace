import { createWithEqualityFn } from 'zustand/traditional';
import { persist } from 'zustand/middleware';
import type { ApocapaletteTheme } from '../types/apocapalette';
import { createBoundedPersistStorage } from '../persistence/boundedPersistStorage';

export type UiThemeVars = {
  '--ui-bg': string;
  '--ui-panel': string;
  '--ui-panel-opaque': string;
  '--ui-panel-text': string;
  '--ui-accent': string;
  '--ui-text': string;
  '--ui-border': string;
  '--ui-blur': string;
  '--ui-ruler-face': string;
  '--ui-ruler-tick': string;
};

export type UiThemePreset = {
  id: 'midnight' | 'hedge' | 'dawn';
  name: string;
  description: string;
  vars: UiThemeVars;
};

const DEFAULT_BLUR = '12px';

const resolveTokenValue = (obj: object | null, path: string): string | null => {
  if (!obj) return null;
  const getValueByPath = (target: object, keyPath: string): any =>
    keyPath.split('.').reduce((acc, part) => acc && (acc as any)[part], target);

  let value = getValueByPath(obj, path);
  if (!value && !path.endsWith('.value')) {
    value = getValueByPath(obj, `${path}.value`);
  }
  if (value && typeof value === 'object' && 'value' in value) {
    return (value as { value: string }).value;
  }
  return typeof value === 'string' ? value : null;
};

const normalizeBlur = (value: string | number | null | undefined) => {
  if (typeof value === 'number') return `${value}px`;
  if (typeof value === 'string' && value.trim().length > 0) return value;
  return DEFAULT_BLUR;
};

const parseColor = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
      return { r, g, b, a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a };
    }
  }
  const rgbMatch = trimmed.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map((part) => part.trim());
    if (parts.length >= 3) {
      const parseChannel = (channel: string) => {
        if (channel.endsWith('%')) {
          return Math.round((parseFloat(channel) / 100) * 255);
        }
        return Math.round(parseFloat(channel));
      };
      const r = parseChannel(parts[0]);
      const g = parseChannel(parts[1]);
      const b = parseChannel(parts[2]);
      const a = parts[3] !== undefined ? Math.max(0, Math.min(1, parseFloat(parts[3]))) : 1;
      return { r, g, b, a };
    }
  }
  return null;
};

const hexToRgb = (hex: string): string => {
  const clean = hex.trim().replace('#', '');
  const normalized = clean.length === 3
    ? clean.split('').map((channel) => `${channel}${channel}`).join('')
    : clean;
  if (normalized.length !== 6) return '31, 41, 55';
  const r = parseInt(normalized.substring(0, 2), 16);
  const g = parseInt(normalized.substring(2, 4), 16);
  const b = parseInt(normalized.substring(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return '31, 41, 55';
  return `${r}, ${g}, ${b}`;
};

const blendColors = (foreground: { r: number; g: number; b: number; a: number }, background: { r: number; g: number; b: number; a: number }) => {
  const alpha = foreground.a + background.a * (1 - foreground.a);
  if (alpha === 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const r = Math.round((foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha);
  const g = Math.round((foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha);
  const b = Math.round((foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha);
  return { r, g, b, a: alpha };
};

const toRgbString = (color: { r: number; g: number; b: number }) => `rgb(${color.r}, ${color.g}, ${color.b})`;

const resolveOpaquePanel = (panel: string, background: string) => {
  const panelColor = parseColor(panel);
  if (!panelColor) return panel;
  const backgroundColor = parseColor(background);
  const blended = backgroundColor ? blendColors(panelColor, backgroundColor) : panelColor;
  return toRgbString(blended);
};

const pickReadableTextColor = (panel: string, background: string) => {
  const panelColor = parseColor(panel);
  const backgroundColor = parseColor(background);
  const blended = panelColor && backgroundColor ? blendColors(panelColor, backgroundColor) : panelColor;
  if (!blended) return '#f8fafc';
  const luminance = (0.2126 * blended.r + 0.7152 * blended.g + 0.0722 * blended.b) / 255;
  return luminance > 0.6 ? '#0f172a' : '#f8fafc';
};

const mapThemeToVars = (theme: ApocapaletteTheme): UiThemeVars => {
  const uiBg =
    resolveTokenValue(theme, 'surfaces.background')
    || resolveTokenValue(theme, 'surfaces.page-background')
    || '#1c0d0d';
  const uiPanel =
    resolveTokenValue(theme, 'surfaces.surface-plain')
    || resolveTokenValue(theme, 'glass.glass-surface')
    || 'rgba(20, 8, 8, 0.8)';
  const uiAccent = resolveTokenValue(theme, 'brand.primary') || '#A133FF';
  const uiText =
    resolveTokenValue(theme, 'typography.body')
    || resolveTokenValue(theme, 'typography.heading')
    || '#E2E8F0';
  const uiBorder = resolveTokenValue(theme, 'borders.border-subtle') || 'rgba(148, 163, 184, 0.35)';
  const uiBlur = normalizeBlur(resolveTokenValue(theme, 'glass.glass-blur'));
  const rulerFace = resolveTokenValue(theme, 'surfaces.header-background') || uiPanel;
  const rulerTick =
    resolveTokenValue(theme, 'typography.body')
    || resolveTokenValue(theme, 'typography.heading')
    || uiText;
  const panelText = pickReadableTextColor(uiPanel, uiBg);
  const panelOpaque = resolveOpaquePanel(uiPanel, uiBg);

  return {
    '--ui-bg': uiBg,
    '--ui-panel': uiPanel,
    '--ui-panel-opaque': panelOpaque,
    '--ui-panel-text': panelText,
    '--ui-accent': uiAccent,
    '--ui-text': uiText,
    '--ui-border': uiBorder,
    '--ui-blur': uiBlur,
    '--ui-ruler-face': rulerFace,
    '--ui-ruler-tick': rulerTick,
  };
};

const applyCssVars = (vars: UiThemeVars) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  Object.entries(vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
  const panelText = vars['--ui-panel-text'] || vars['--ui-text'];
  const panelOpaque = vars['--ui-panel-opaque'] || vars['--ui-panel'];
  const primaryColor = vars['--ui-accent'];
  root.style.setProperty('--ui-panel-text', panelText);
  root.style.setProperty('--ui-panel-opaque', panelOpaque);
  root.style.setProperty('--brand-primary', primaryColor);
  root.style.setProperty('--brand-primary-rgb', hexToRgb(primaryColor));
  root.style.setProperty('--brand-accent', primaryColor);
  root.style.setProperty('--border-subtle', vars['--ui-border']);
  root.style.setProperty('--muted-icon', vars['--ui-panel-text']);
};

const ensurePanelVars = (vars: UiThemeVars) => {
  const panelText = vars['--ui-panel-text'] || pickReadableTextColor(vars['--ui-panel'], vars['--ui-bg']);
  const panelOpaque = vars['--ui-panel-opaque'] || resolveOpaquePanel(vars['--ui-panel'], vars['--ui-bg']);
  return { ...vars, '--ui-panel-text': panelText, '--ui-panel-opaque': panelOpaque };
};

export const UI_THEME_PRESETS: UiThemePreset[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Dark / velvet',
      vars: {
        '--ui-bg': '#f6efe6',
        '--ui-panel': 'rgba(255, 249, 241, 0.84)',
        '--ui-panel-opaque': resolveOpaquePanel('rgba(255, 249, 241, 0.84)', '#f6efe6'),
        '--ui-panel-text': '#4a3f38',
        '--ui-accent': '#b8878f',
        '--ui-text': '#4a3f38',
      '--ui-border': 'rgba(138, 110, 92, 0.24)',
      '--ui-blur': DEFAULT_BLUR,
      '--ui-ruler-face': 'rgba(255, 252, 246, 0.9)',
      '--ui-ruler-tick': 'rgba(90, 68, 56, 0.62)',
    },
  },
  {
    id: 'hedge',
    name: 'Hedge',
    description: 'Green / earthy',
      vars: {
        '--ui-bg': '#eef1ea',
        '--ui-panel': 'rgba(247, 251, 245, 0.84)',
        '--ui-panel-opaque': resolveOpaquePanel('rgba(247, 251, 245, 0.84)', '#eef1ea'),
        '--ui-panel-text': '#405046',
        '--ui-accent': '#8ea591',
        '--ui-text': '#405046',
      '--ui-border': 'rgba(114, 138, 119, 0.26)',
      '--ui-blur': DEFAULT_BLUR,
      '--ui-ruler-face': 'rgba(250, 253, 249, 0.92)',
      '--ui-ruler-tick': 'rgba(64, 80, 70, 0.62)',
    },
  },
  {
    id: 'dawn',
    name: 'Dawn',
    description: 'Light / pastel',
      vars: {
        '--ui-bg': '#fbf5f1',
        '--ui-panel': 'rgba(255, 250, 246, 0.88)',
        '--ui-panel-opaque': resolveOpaquePanel('rgba(255, 250, 246, 0.88)', '#fbf5f1'),
        '--ui-panel-text': '#4d3f3f',
        '--ui-accent': '#c59aa0',
        '--ui-text': '#4d3f3f',
      '--ui-border': 'rgba(171, 133, 126, 0.24)',
      '--ui-blur': DEFAULT_BLUR,
      '--ui-ruler-face': 'rgba(255, 252, 249, 0.94)',
      '--ui-ruler-tick': 'rgba(77, 63, 63, 0.62)',
    },
  },
];

interface UiThemeState {
  vars: UiThemeVars;
  activePresetId: UiThemePreset['id'];
  projectSyncEnabled: boolean;
  setVars: (vars: Partial<UiThemeVars>) => void;
  applyThemeFromTokens: (theme: ApocapaletteTheme) => void;
  applyPreset: (presetId: UiThemePreset['id']) => void;
  setProjectSyncEnabled: (enabled: boolean) => void;
}

const initialPreset = UI_THEME_PRESETS[0];

export const useUiThemeStore = createWithEqualityFn<UiThemeState>()(
  persist(
    (set) => ({
      vars: initialPreset.vars,
      activePresetId: initialPreset.id,
      projectSyncEnabled: true,
      setVars: (vars) =>
        set((state) => {
          const nextVars = ensurePanelVars({
            ...state.vars,
            ...vars,
            '--ui-blur': normalizeBlur(vars['--ui-blur'] ?? state.vars['--ui-blur']),
          });
          applyCssVars(nextVars);
          return { vars: nextVars };
        }),
      applyThemeFromTokens: (theme) =>
        set(() => {
          const nextVars = mapThemeToVars(theme);
          applyCssVars(nextVars);
          return {
            vars: nextVars,
            activePresetId: 'midnight',
          };
        }),
      applyPreset: (presetId) =>
        set(() => {
          const preset = UI_THEME_PRESETS.find((item) => item.id === presetId) || initialPreset;
          const nextVars = ensurePanelVars(preset.vars);
          applyCssVars(nextVars);
          return { vars: nextVars, activePresetId: preset.id };
        }),
      setProjectSyncEnabled: (enabled) => set({ projectSyncEnabled: enabled }),
    }),
    {
      name: 'designspace-ui-theme',
      storage: createBoundedPersistStorage({ maxBytes: 256 * 1024 }),
      partialize: (state) => ({
        vars: state.vars,
        activePresetId: state.activePresetId,
        projectSyncEnabled: state.projectSyncEnabled,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.vars) {
          const nextVars = ensurePanelVars(state.vars);
          applyCssVars(nextVars);
          state.vars = nextVars;
        }
      },
    }
  )
);

if (typeof document !== 'undefined') {
  applyCssVars(useUiThemeStore.getState().vars);
}

export const mapUiTokensToVars = mapThemeToVars;
export const applyUiCssVars = applyCssVars;
