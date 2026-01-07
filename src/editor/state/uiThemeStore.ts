import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApocapaletteTheme } from '../types/apocapalette';

export type UiThemeVars = {
  '--ui-bg': string;
  '--ui-panel': string;
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

  return {
    '--ui-bg': uiBg,
    '--ui-panel': uiPanel,
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
  root.style.setProperty('--brand-primary', vars['--ui-accent']);
  root.style.setProperty('--brand-accent', vars['--ui-accent']);
  root.style.setProperty('--border-subtle', vars['--ui-border']);
  root.style.setProperty('--muted-icon', vars['--ui-text']);
};

export const UI_THEME_PRESETS: UiThemePreset[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Dark / velvet',
    vars: {
      '--ui-bg': '#16090c',
      '--ui-panel': 'rgba(20, 8, 8, 0.8)',
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

export const useUiThemeStore = create<UiThemeState>()(
  persist(
    (set) => ({
      vars: initialPreset.vars,
      activePresetId: initialPreset.id,
      projectSyncEnabled: true,
      setVars: (vars) =>
        set((state) => {
          const nextVars = {
            ...state.vars,
            ...vars,
            '--ui-blur': normalizeBlur(vars['--ui-blur'] ?? state.vars['--ui-blur']),
          };
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
          applyCssVars(preset.vars);
          return { vars: preset.vars, activePresetId: preset.id };
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
          applyCssVars(state.vars);
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
