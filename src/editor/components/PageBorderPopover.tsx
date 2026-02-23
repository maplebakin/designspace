import React, { useMemo, useState } from 'react';
import { shallow } from 'zustand/shallow';
import { useEditorStore } from '../state/editorStore';
import {
  applyPageBorder,
  DEFAULT_PAGE_BORDER_SETTINGS,
  removePageBorder,
  type PageBorderSettings,
  type CornerStyle,
  type EdgePattern,
  type LineStyle,
} from '../services/pageBorderService';
import { getPageBorderGroup } from '../services/pageBorderService';

type TabId = 'line' | 'corners' | 'pattern' | 'vignette';

const tabClass = (active: boolean) =>
  `px-2 py-1 rounded-lg text-[10px] uppercase tracking-widest border ${
    active
      ? 'border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/18 text-[color:var(--brand-primary)]'
      : 'border-white/10 bg-white/5 text-[color:var(--ui-panel-text)] hover:bg-white/10'
  }`;

const cornerStyles: CornerStyle[] = ['bracket', 'flourish', 'diamond', 'cross', 'rounded', 'leaf'];
const edgePatterns: EdgePattern[] = ['dots', 'dashes', 'diamonds', 'stars'];
const lineStyles: LineStyle[] = ['solid', 'dashed', 'dotted'];

export const PageBorderPopover: React.FC = () => {
  const { canvas, saveState, requestLayerSync } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
      saveState: state.saveState,
      requestLayerSync: state.requestLayerSync,
    }),
    shallow
  );

  const initial = useMemo(() => {
    if (!canvas) return DEFAULT_PAGE_BORDER_SETTINGS;
    const existing = getPageBorderGroup(canvas);
    const settings = (existing as any)?.borderSettings as PageBorderSettings | undefined;
    return settings ? { ...DEFAULT_PAGE_BORDER_SETTINGS, ...settings } : DEFAULT_PAGE_BORDER_SETTINGS;
  }, [canvas]);

  const [settings, setSettings] = useState<PageBorderSettings>(initial);
  const [tab, setTab] = useState<TabId>('line');

  const set = <K extends keyof PageBorderSettings>(key: K, value: PageBorderSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const onApply = () => {
    if (!canvas) return;
    applyPageBorder(canvas, settings);
    requestLayerSync({ force: true });
    saveState({ force: true });
  };

  const onRemove = () => {
    if (!canvas) return;
    removePageBorder(canvas);
    requestLayerSync({ force: true });
    saveState({ force: true });
  };

  return (
    <div className="popover-container w-[360px]">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Page Border</h3>
        <button
          onClick={onRemove}
          className="px-2 py-1 rounded-lg border border-rose-300/35 bg-rose-200/40 text-rose-900 text-[10px] uppercase tracking-widest hover:bg-rose-200/60"
        >
          Remove Border
        </button>
      </div>

      <div className="flex flex-wrap gap-1 mt-3">
        <button onClick={() => setTab('line')} className={tabClass(tab === 'line')}>Line</button>
        <button onClick={() => setTab('corners')} className={tabClass(tab === 'corners')}>Corners</button>
        <button onClick={() => setTab('pattern')} className={tabClass(tab === 'pattern')}>Pattern</button>
        <button onClick={() => setTab('vignette')} className={tabClass(tab === 'vignette')}>Vignette</button>
      </div>

      <div className="mt-3 space-y-3">
        {tab === 'line' && (
          <>
            <label className="flex items-center justify-between text-[10px] uppercase tracking-widest">
              Enable line
              <input type="checkbox" checked={settings.lineEnabled} onChange={(e) => set('lineEnabled', e.target.checked)} />
            </label>
            <div className="grid grid-cols-3 gap-2">
              {lineStyles.map((style) => (
                <button key={style} onClick={() => set('lineStyle', style)} className={tabClass(settings.lineStyle === style)}>{style}</button>
              ))}
            </div>
            <label className="text-[10px] uppercase tracking-widest block">Line Color
              <input type="color" value={settings.lineColor} onChange={(e) => set('lineColor', e.target.value)} className="ml-2 h-7 w-10 align-middle" />
            </label>
            <label className="text-[10px] uppercase tracking-widest block">Weight ({settings.lineWeight}px)
              <input type="range" min={1} max={16} value={settings.lineWeight} onChange={(e) => set('lineWeight', Number(e.target.value))} className="w-full" />
            </label>
            <label className="text-[10px] uppercase tracking-widest block">Inset ({settings.inset}px)
              <input type="range" min={0} max={120} value={settings.inset} onChange={(e) => set('inset', Number(e.target.value))} className="w-full" />
            </label>
          </>
        )}

        {tab === 'corners' && (
          <>
            <label className="flex items-center justify-between text-[10px] uppercase tracking-widest">
              Enable corners
              <input type="checkbox" checked={settings.cornersEnabled} onChange={(e) => set('cornersEnabled', e.target.checked)} />
            </label>
            <label className="text-[10px] uppercase tracking-widest block">Style
              <select value={settings.cornerStyle} onChange={(e) => set('cornerStyle', e.target.value as CornerStyle)} className="w-full mt-1 rounded-lg border border-[color:var(--ui-border)] bg-white/65 px-2 h-8 text-xs">
                {cornerStyles.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="text-[10px] uppercase tracking-widest block">Size ({settings.cornerSize}px)
              <input type="range" min={10} max={90} value={settings.cornerSize} onChange={(e) => set('cornerSize', Number(e.target.value))} className="w-full" />
            </label>
            <label className="text-[10px] uppercase tracking-widest block">Color
              <input type="color" value={settings.cornerColor} onChange={(e) => set('cornerColor', e.target.value)} className="ml-2 h-7 w-10 align-middle" />
            </label>
          </>
        )}

        {tab === 'pattern' && (
          <>
            <label className="flex items-center justify-between text-[10px] uppercase tracking-widest">
              Enable pattern
              <input type="checkbox" checked={settings.patternEnabled} onChange={(e) => set('patternEnabled', e.target.checked)} />
            </label>
            <label className="text-[10px] uppercase tracking-widest block">Pattern
              <select value={settings.edgePattern} onChange={(e) => set('edgePattern', e.target.value as EdgePattern)} className="w-full mt-1 rounded-lg border border-[color:var(--ui-border)] bg-white/65 px-2 h-8 text-xs">
                {edgePatterns.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="text-[10px] uppercase tracking-widest block">Size ({settings.patternSize}px)
              <input type="range" min={6} max={40} value={settings.patternSize} onChange={(e) => set('patternSize', Number(e.target.value))} className="w-full" />
            </label>
            <label className="text-[10px] uppercase tracking-widest block">Spacing ({settings.patternSpacing}px)
              <input type="range" min={8} max={80} value={settings.patternSpacing} onChange={(e) => set('patternSpacing', Number(e.target.value))} className="w-full" />
            </label>
            <label className="text-[10px] uppercase tracking-widest block">Color
              <input type="color" value={settings.patternColor} onChange={(e) => set('patternColor', e.target.value)} className="ml-2 h-7 w-10 align-middle" />
            </label>
          </>
        )}

        {tab === 'vignette' && (
          <>
            <label className="flex items-center justify-between text-[10px] uppercase tracking-widest">
              Enable vignette
              <input type="checkbox" checked={settings.vignetteEnabled} onChange={(e) => set('vignetteEnabled', e.target.checked)} />
            </label>
            <label className="text-[10px] uppercase tracking-widest block">Color
              <input type="color" value={settings.vignetteColor} onChange={(e) => set('vignetteColor', e.target.value)} className="ml-2 h-7 w-10 align-middle" />
            </label>
            <label className="text-[10px] uppercase tracking-widest block">Spread ({settings.vignetteSpread}px)
              <input type="range" min={12} max={180} value={settings.vignetteSpread} onChange={(e) => set('vignetteSpread', Number(e.target.value))} className="w-full" />
            </label>
            <label className="text-[10px] uppercase tracking-widest block">Intensity ({Math.round(settings.vignetteIntensity * 100)}%)
              <input type="range" min={0.05} max={0.85} step={0.01} value={settings.vignetteIntensity} onChange={(e) => set('vignetteIntensity', Number(e.target.value))} className="w-full" />
            </label>
          </>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <button onClick={onApply} className="px-3 py-2 rounded-lg border border-[color:var(--brand-primary)]/40 bg-[color:var(--brand-primary)]/25 hover:bg-[color:var(--brand-primary)]/35 text-[11px] uppercase tracking-widest">
          Apply Border
        </button>
      </div>
    </div>
  );
};
