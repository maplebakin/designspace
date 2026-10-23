import React, { useEffect, useMemo, useState } from 'react';
import { shallow } from 'zustand/shallow';
import { ChevronDown, Palette, Save, Sparkles, Trash2 } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import { useTarotPageStyleStore } from '../state/tarotPageStyleStore';
import { useThemeStore } from '../state/useThemeStore';
import {
  applyTarotPageStyle,
  DEFAULT_TAROT_PAGE_STYLE,
  getTarotPageStyle,
  type TarotPageStyle,
} from '../tarot/pageStyle';
import { commitCanvasMutation } from '../utils/commitCanvasMutation';
import { fromCanvasUnits, toCanvasUnits } from '../utils/units';

const Section: React.FC<{ title: string; children: React.ReactNode; open?: boolean }> = ({ title, children, open = false }) => (
  <details open={open} className="rounded-xl border border-[color:var(--ui-border)] bg-white/5">
    <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[10px] uppercase tracking-widest text-[color:var(--ui-text)]">
      {title}
      <ChevronDown className="h-3.5 w-3.5" />
    </summary>
    <div className="space-y-3 border-t border-[color:var(--ui-border)] px-3 py-3">{children}</div>
  </details>
);

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">{children}</span>
);

const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = (props) => (
  <select {...props} className="mt-1 h-8 w-full rounded-lg border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] px-2 text-xs text-[color:var(--ui-text)]" />
);

const NumberField: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label: string; unit?: string }> = ({ label, unit, ...props }) => (
  <label className="block">
    <Label>{label}{unit ? ` (${unit})` : ''}</Label>
    <input {...props} type="number" className="mt-1 h-8 w-full rounded-lg border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] px-2 text-xs text-[color:var(--ui-text)]" />
  </label>
);

const ColorField: React.FC<{ label: string; value: string; onChange: (value: string) => void }> = ({ label, value, onChange }) => (
  <label className="flex items-center justify-between gap-2">
    <Label>{label}</Label>
    <input aria-label={label} type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-7 w-10 rounded border border-[color:var(--ui-border)] bg-transparent" />
  </label>
);

const Toggle: React.FC<{ label: string; checked: boolean; onChange: (value: boolean) => void }> = ({ label, checked, onChange }) => (
  <label className="flex items-center justify-between gap-2 text-xs text-[color:var(--ui-text)]">
    <span>{label}</span>
    <input aria-label={label} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
  </label>
);

const textValue = (value: string, onChange: (value: string) => void, label: string) => (
  <label className="block">
    <Label>{label}</Label>
    <input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-8 w-full rounded-lg border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] px-2 text-xs text-[color:var(--ui-text)]" />
  </label>
);

export const TarotPageStylePanel: React.FC = () => {
  const { canvas, activePageIndex, requestLayerSync, syncActivePageFromCanvas, syncCanvasToStore, saveState } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
      activePageIndex: state.activePageIndex,
      requestLayerSync: state.requestLayerSync,
      syncActivePageFromCanvas: state.syncActivePageFromCanvas,
      syncCanvasToStore: state.syncCanvasToStore,
      saveState: state.saveState,
    }),
    shallow,
  );
  const unitMode = useEditorStore((state) => state.unitMode);
  const canvasBackgroundColor = useThemeStore((state) => state.canvasBackgroundColor);
  const savedStyles = useTarotPageStyleStore((state) => state.savedStyles);
  const saveStyle = useTarotPageStyleStore((state) => state.saveStyle);
  const renameStyle = useTarotPageStyleStore((state) => state.renameStyle);
  const deleteStyle = useTarotPageStyleStore((state) => state.deleteStyle);
  const [style, setStyle] = useState<TarotPageStyle>(DEFAULT_TAROT_PAGE_STYLE);
  const [saveName, setSaveName] = useState('My tarot style');

  useEffect(() => {
    if (!canvas) return;
    setStyle(getTarotPageStyle(canvas));
  }, [canvas, activePageIndex, canvasBackgroundColor]);

  const unitLabel = unitMode;
  const display = (value: number) => Number((fromCanvasUnits(value, unitMode) as number).toFixed(unitMode === 'px' ? 0 : 3));
  const toPx = (value: number) => Number(toCanvasUnits(value, unitMode));
  const update = <K extends keyof TarotPageStyle>(section: K, key: keyof TarotPageStyle[K], value: unknown) => {
    setStyle((current) => ({ ...current, [section]: { ...(current[section] as object), [key]: value } } as TarotPageStyle));
  };
  const apply = (nextStyle = style, applyContent = true) => {
    if (!canvas) return;
    applyTarotPageStyle(canvas, nextStyle, { applyContent });
    commitCanvasMutation(canvas, {
      syncCanvasToStore,
      syncActivePageFromCanvas,
      saveState,
      requestLayerSync,
    }, { syncPage: true });
    setStyle(getTarotPageStyle(canvas));
  };

  const starterStyles = useMemo(() => savedStyles.filter((entry) => entry.starter), [savedStyles]);
  const customStyles = useMemo(() => savedStyles.filter((entry) => !entry.starter), [savedStyles]);

  return (
    <div className="space-y-2" data-testid="tarot-page-style-panel">
      <div className="rounded-xl border border-[color:var(--brand-primary)]/30 bg-[color:var(--brand-primary)]/10 p-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[color:var(--brand-primary)]" />
          <div>
            <h3 className="text-[11px] uppercase tracking-widest text-[color:var(--ui-text)]">Tarot Page Style</h3>
            <p className="mt-1 text-[10px] text-[color:var(--ui-panel-text)]">Editable page decorations and card styling for experimentation.</p>
          </div>
        </div>
        <button type="button" onClick={() => apply()} data-testid="tarot-style-apply" className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[color:var(--brand-primary)] px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-white">
          <Palette className="h-3.5 w-3.5" /> Apply changes
        </button>
      </div>

      <Section title="Page" open>
        <ColorField label="Background" value={style.page.backgroundColor} onChange={(value) => update('page', 'backgroundColor', value)} />
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Content inset" unit={unitLabel} min={0} step={unitMode === 'px' ? 1 : 0.01} value={display(style.page.contentInset)} onChange={(event) => update('page', 'contentInset', toPx(Number(event.target.value)))} />
          <NumberField label="Header / spread gap" unit={unitLabel} min={0} step={unitMode === 'px' ? 1 : 0.01} value={display(style.page.headerSpreadGap)} onChange={(event) => update('page', 'headerSpreadGap', toPx(Number(event.target.value)))} />
        </div>
        <p className="text-[9px] text-[color:var(--ui-panel-text)]">The gap is a composition guide; cards remain where you arranged them until you move them deliberately.</p>
      </Section>

      <Section title="Border">
        <Select aria-label="Border type" value={style.border.type} onChange={(event) => update('border', 'type', event.target.value)}>
          <option value="none">None</option><option value="single">Single line</option><option value="double">Double line</option>
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Inset" unit={unitLabel} min={0} value={display(style.border.inset)} onChange={(event) => update('border', 'inset', toPx(Number(event.target.value)))} />
          <NumberField label="Line width" unit={unitLabel} min={0} step={unitMode === 'px' ? 1 : 0.01} value={display(style.border.width)} onChange={(event) => update('border', 'width', toPx(Number(event.target.value)))} />
          <NumberField label="Double spacing" unit={unitLabel} min={0} value={display(style.border.doubleSpacing)} onChange={(event) => update('border', 'doubleSpacing', toPx(Number(event.target.value)))} />
          <NumberField label="Corner radius" unit={unitLabel} min={0} value={display(style.border.cornerRadius)} onChange={(event) => update('border', 'cornerRadius', toPx(Number(event.target.value)))} />
        </div>
        <ColorField label="Border color" value={style.border.color} onChange={(value) => update('border', 'color', value)} />
        <NumberField label="Opacity" min={0} max={1} step={0.05} value={style.border.opacity} onChange={(event) => update('border', 'opacity', Number(event.target.value))} />
      </Section>

      <Section title="Header">
        {textValue(style.header.titleText, (value) => update('header', 'titleText', value), 'Title')}
        <div className="grid grid-cols-2 gap-2">
          <label><Label>Title font</Label><Select aria-label="Title font" value={style.header.titleFontFamily} onChange={(event) => update('header', 'titleFontFamily', event.target.value)}><option>Georgia</option><option>Inter</option><option>Cinzel</option><option>Cormorant Garamond</option><option>Arial</option></Select></label>
          <NumberField label="Title size" min={8} value={style.header.titleFontSize} onChange={(event) => update('header', 'titleFontSize', Number(event.target.value))} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label><Label>Alignment</Label><Select aria-label="Title alignment" value={style.header.titleAlignment} onChange={(event) => update('header', 'titleAlignment', event.target.value)}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></Select></label>
          <label><Label>Weight</Label><Select aria-label="Title weight" value={style.header.titleFontWeight} onChange={(event) => update('header', 'titleFontWeight', event.target.value)}><option value="normal">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="bold">Bold</option></Select></label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Horizontal offset" unit={unitLabel} value={display(style.header.titleOffsetX)} onChange={(event) => update('header', 'titleOffsetX', toPx(Number(event.target.value)))} />
          <NumberField label="Top spacing" unit={unitLabel} value={display(style.header.titleOffsetY)} onChange={(event) => update('header', 'titleOffsetY', toPx(Number(event.target.value)))} />
        </div>
        <div className="grid grid-cols-2 gap-2"><NumberField label="Letter spacing" min={0} value={style.header.titleLetterSpacing} onChange={(event) => update('header', 'titleLetterSpacing', Number(event.target.value))} /><ColorField label="Title color" value={style.header.titleColor} onChange={(value) => update('header', 'titleColor', value)} /></div>
        <Toggle label="Uppercase title" checked={style.header.titleUppercase} onChange={(value) => update('header', 'titleUppercase', value)} />
        <Toggle label="Show subtitle" checked={style.header.subtitleVisible} onChange={(value) => update('header', 'subtitleVisible', value)} />
        {style.header.subtitleVisible && <>
          {textValue(style.header.subtitleText, (value) => update('header', 'subtitleText', value), 'Subtitle')}
          <div className="grid grid-cols-2 gap-2"><label><Label>Subtitle font</Label><Select aria-label="Subtitle font" value={style.header.subtitleFontFamily} onChange={(event) => update('header', 'subtitleFontFamily', event.target.value)}><option>Georgia</option><option>Cormorant Garamond</option><option>Inter</option><option>Arial</option></Select></label><NumberField label="Subtitle size" min={8} value={style.header.subtitleFontSize} onChange={(event) => update('header', 'subtitleFontSize', Number(event.target.value))} /></div>
          <div className="grid grid-cols-2 gap-2"><NumberField label="Title gap" unit={unitLabel} min={0} value={display(style.header.subtitleSpacing)} onChange={(event) => update('header', 'subtitleSpacing', toPx(Number(event.target.value)))} /><NumberField label="Line height" min={0.6} step={0.1} value={style.header.subtitleLineHeight} onChange={(event) => update('header', 'subtitleLineHeight', Number(event.target.value))} /></div>
          <Toggle label="Italic subtitle" checked={style.header.subtitleItalic} onChange={(value) => update('header', 'subtitleItalic', value)} />
          <ColorField label="Subtitle color" value={style.header.subtitleColor} onChange={(value) => update('header', 'subtitleColor', value)} />
        </>}
      </Section>

      <Section title="Tarot Cards">
        <label><Label>Fill mode</Label><Select aria-label="Card fill mode" value={style.card.fillMode} onChange={(event) => update('card', 'fillMode', event.target.value)}><option value="filled">Filled</option><option value="outline">Outline</option></Select></label>
        <div className="grid grid-cols-2 gap-2"><ColorField label="Fill color" value={style.card.fillColor} onChange={(value) => update('card', 'fillColor', value)} /><ColorField label="Border color" value={style.card.borderColor} onChange={(value) => update('card', 'borderColor', value)} /></div>
        <div className="grid grid-cols-2 gap-2"><NumberField label="Border width" min={0} value={style.card.borderWidth} onChange={(event) => update('card', 'borderWidth', Number(event.target.value))} /><NumberField label="Corner radius" min={0} value={style.card.cornerRadius} onChange={(event) => update('card', 'cornerRadius', Number(event.target.value))} /></div>
        <div className="grid grid-cols-2 gap-2"><label><Label>Number font</Label><Select aria-label="Number font" value={style.card.numberFontFamily} onChange={(event) => update('card', 'numberFontFamily', event.target.value)}><option>Georgia</option><option>Cinzel</option><option>Cormorant Garamond</option><option>Inter</option></Select></label><NumberField label="Number size" min={8} value={style.card.numberFontSize} onChange={(event) => update('card', 'numberFontSize', Number(event.target.value))} /></div>
        <ColorField label="Number color" value={style.card.numberColor} onChange={(value) => update('card', 'numberColor', value)} />
        <label><Label>Position label</Label><Select aria-label="Position label placement" value={style.card.labelPlacement} onChange={(event) => update('card', 'labelPlacement', event.target.value)}><option value="inside">Show inside card</option><option value="below">Show below card</option><option value="hidden">Hide label</option></Select></label>
        <div className="grid grid-cols-2 gap-2"><label><Label>Label font</Label><Select aria-label="Label font" value={style.card.labelFontFamily} onChange={(event) => update('card', 'labelFontFamily', event.target.value)}><option>Georgia</option><option>Cormorant Garamond</option><option>Cinzel</option><option>Inter</option></Select></label><NumberField label="Label size" min={8} value={style.card.labelFontSize} onChange={(event) => update('card', 'labelFontSize', Number(event.target.value))} /></div>
        <div className="grid grid-cols-2 gap-2"><NumberField label="Label max width" unit={unitLabel} min={20} value={display(style.card.labelMaxWidth)} onChange={(event) => update('card', 'labelMaxWidth', toPx(Number(event.target.value)))} /><NumberField label="Label spacing" unit={unitLabel} min={0} value={display(style.card.labelSpacing)} onChange={(event) => update('card', 'labelSpacing', toPx(Number(event.target.value)))} /></div>
        <ColorField label="Label color" value={style.card.labelColor} onChange={(value) => update('card', 'labelColor', value)} />
      </Section>

      <Section title="Footer / Notes">
        <Toggle label="Show footer" checked={style.footer.visible} onChange={(value) => update('footer', 'visible', value)} />
        <div className="grid grid-cols-2 gap-2"><Toggle label="Date" checked={style.footer.dateVisible} onChange={(value) => update('footer', 'dateVisible', value)} /><Toggle label="Deck" checked={style.footer.deckVisible} onChange={(value) => update('footer', 'deckVisible', value)} /><Toggle label="Question" checked={style.footer.questionVisible} onChange={(value) => update('footer', 'questionVisible', value)} /><Toggle label="Notes" checked={style.footer.notesVisible} onChange={(value) => update('footer', 'notesVisible', value)} /></div>
        {textValue(style.footer.dateText, (value) => update('footer', 'dateText', value), 'Date text')}
        {textValue(style.footer.deckText, (value) => update('footer', 'deckText', value), 'Deck text')}
        {textValue(style.footer.questionText, (value) => update('footer', 'questionText', value), 'Question text')}
        {textValue(style.footer.notesText, (value) => update('footer', 'notesText', value), 'Notes text')}
        <div className="grid grid-cols-2 gap-2"><NumberField label="Footer height" unit={unitLabel} min={30} value={display(style.footer.height)} onChange={(event) => update('footer', 'height', toPx(Number(event.target.value)))} /><NumberField label="Field spacing" unit={unitLabel} min={0} value={display(style.footer.spacing)} onChange={(event) => update('footer', 'spacing', toPx(Number(event.target.value)))} /></div>
        <ColorField label="Footer line color" value={style.footer.lineColor} onChange={(value) => update('footer', 'lineColor', value)} />
      </Section>

      <Section title="Ornament">
        <label><Label>Style</Label><Select aria-label="Ornament style" value={style.ornament.style} onChange={(event) => update('ornament', 'style', event.target.value)}><option value="none">None</option><option value="divider">Simple divider</option></Select></label>
        <label><Label>Placement</Label><Select aria-label="Ornament placement" value={style.ornament.placement} onChange={(event) => update('ornament', 'placement', event.target.value)}><option value="header">Near header</option><option value="footer">Near footer</option></Select></label>
        <div className="grid grid-cols-2 gap-2"><NumberField label="Size" unit={unitLabel} min={4} value={display(style.ornament.size)} onChange={(event) => update('ornament', 'size', toPx(Number(event.target.value)))} /><ColorField label="Color" value={style.ornament.color} onChange={(value) => update('ornament', 'color', value)} /></div>
      </Section>

      <Section title="Saved Styles">
        <div className="flex gap-2"><input aria-label="Saved style name" value={saveName} onChange={(event) => setSaveName(event.target.value)} className="h-8 min-w-0 flex-1 rounded-lg border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] px-2 text-xs text-[color:var(--ui-text)]" /><button type="button" aria-label="Save current tarot style" data-testid="tarot-style-save" onClick={() => { if (saveStyle(saveName, style)) setSaveName('My tarot style'); }} className="flex h-8 items-center gap-1 rounded-lg border border-[color:var(--brand-primary)]/40 px-2 text-[10px] uppercase tracking-widest"><Save className="h-3 w-3" /> Save</button></div>
        <div className="space-y-2">
          {starterStyles.map((entry) => <div key={entry.id} className="flex items-center justify-between gap-2 rounded-lg border border-[color:var(--ui-border)] px-2 py-2"><span className="text-xs text-[color:var(--ui-text)]">{entry.name}<small className="ml-1 text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">starting point</small></span><button type="button" aria-label={`Apply ${entry.name} tarot style`} onClick={() => { setStyle(entry.style); apply(entry.style, false); }} className="rounded border border-[color:var(--ui-border)] px-2 py-1 text-[9px] uppercase tracking-widest">Apply</button></div>)}
          {customStyles.map((entry) => <div key={entry.id} className="flex items-center justify-between gap-2 rounded-lg border border-[color:var(--ui-border)] px-2 py-2"><span className="min-w-0 truncate text-xs text-[color:var(--ui-text)]">{entry.name}</span><div className="flex gap-1"><button type="button" onClick={() => { setStyle(entry.style); apply(entry.style, false); }} className="rounded border border-[color:var(--ui-border)] px-2 py-1 text-[9px] uppercase tracking-widest">Apply</button><button type="button" aria-label={`Rename ${entry.name}`} onClick={() => { const next = window.prompt('Rename tarot style', entry.name); if (next) renameStyle(entry.id, next); }} className="rounded border border-[color:var(--ui-border)] px-2 py-1 text-[9px] uppercase tracking-widest">Rename</button><button type="button" aria-label={`Delete ${entry.name}`} onClick={() => deleteStyle(entry.id)} className="rounded border border-rose-300/40 px-2 py-1 text-[9px] text-rose-800"><Trash2 className="h-3 w-3" /></button></div></div>)}
        </div>
      </Section>

      <div className="flex items-center justify-between px-1 text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/70"><span>Units: {unitLabel}</span><span>Page style stays editable</span></div>
    </div>
  );
};
