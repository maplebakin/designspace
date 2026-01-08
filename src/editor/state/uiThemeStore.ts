import { createWithEqualityFn } from 'zustand/traditional';
import { persist } from 'zustand/middleware';
import type { ApocapaletteTheme } from '../types/apocapalette';

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
  const uiText = resolveTokenValue(theme, 'typography.text-body') || '#E2E8F0';
  const uiBorder = resolveTokenValue(theme, 'borders.border-subtle') || 'rgba(148, 163, 184, 0.35)';
  const uiBlur = normalizeBlur(resolveTokenValue(theme, 'glass.glass-blur'));
  const rulerFace = resolveTokenValue(theme, 'surfaces.header-background') || uiPanel;
  const rulerTick = resolveTokenValue(theme, 'typography.text-hint') || uiText;
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
  root.style.setProperty('--ui-panel-text', panelText);
  root.style.setProperty('--ui-panel-opaque', panelOpaque);
  root.style.setProperty('--brand-primary', vars['--ui-accent']);
  root.style.setProperty('--brand-accent', vars['--ui-accent']);
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
        '--ui-bg': '#16090c',
        '--ui-panel': 'rgba(20, 8, 8, 0.8)',
        '--ui-panel-opaque': resolveOpaquePanel('rgba(20, 8, 8, 0.8)', '#16090c'),
        '--ui-panel-text': '#f8fafc',
        '--ui-accent': '#A133FF',
        '--ui-text': '#E2E8F0',
      '--ui-border': 'rgba(148, 163, 184, 0.35)',
      '--ui-blur': DEFAULT_BLUR,
      '--ui-ruler-face': 'rgba(20, 8, 8, 0.85)',
      '--ui-ruler-tick': 'rgba(226, 232, 240, 0.7)',
    },
  },
  {
    id: 'hedge',
    name: 'Hedge',
    description: 'Green / earthy',
      vars: {
        '--ui-bg': '#0f1a12',
        '--ui-panel': 'rgba(18, 30, 20, 0.82)',
        '--ui-panel-opaque': resolveOpaquePanel('rgba(18, 30, 20, 0.82)', '#0f1a12'),
        '--ui-panel-text': '#f8fafc',
        '--ui-accent': '#2f855a',
        '--ui-text': '#e2f0e6',
      '--ui-border': 'rgba(134, 167, 152, 0.45)',
      '--ui-blur': DEFAULT_BLUR,
      '--ui-ruler-face': 'rgba(18, 30, 20, 0.88)',
      '--ui-ruler-tick': 'rgba(226, 240, 230, 0.7)',
    },
  },
  {
    id: 'dawn',
    name: 'Dawn',
    description: 'Light / pastel',
      vars: {
        '--ui-bg': '#f8f2f2',
        '--ui-panel': 'rgba(255, 255, 255, 0.85)',
        '--ui-panel-opaque': resolveOpaquePanel('rgba(255, 255, 255, 0.85)', '#f8f2f2'),
        '--ui-panel-text': '#1f2937',
        '--ui-accent': '#ff9aa2',
        '--ui-text': '#2d1f1f',
      '--ui-border': 'rgba(148, 107, 107, 0.35)',
      '--ui-blur': DEFAULT_BLUR,
      '--ui-ruler-face': 'rgba(255, 255, 255, 0.92)',
      '--ui-ruler-tick': 'rgba(45, 31, 31, 0.6)',
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
