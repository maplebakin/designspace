import React from 'react';
import { resizeCanvas, addSafeMarginGuides, clearSafeMarginGuides } from '../fabric/canvasUtils';
import { useEditorStore } from '../state/editorStore';
import { PRINT_DPI } from '../utils/units';

type ProjectPreset = {
  name: string;
  description: string;
  unit: 'in' | 'px';
  width: number;
  height: number;
  dpi: number;
};

const printPresets: ProjectPreset[] = [
  { name: 'Ritual Card', description: 'Standard • 5" × 7" @ 300 DPI', unit: 'in', width: 5, height: 7, dpi: PRINT_DPI },
  { name: 'Tarot Card', description: 'Large • 3.5" × 5" @ 300 DPI', unit: 'in', width: 3.5, height: 5, dpi: PRINT_DPI },
  { name: 'A4 Document', description: '8.27" × 11.69" @ 300 DPI', unit: 'in', width: 8.27, height: 11.69, dpi: PRINT_DPI },
  { name: 'US Letter', description: '8.5" × 11" @ 300 DPI', unit: 'in', width: 8.5, height: 11, dpi: PRINT_DPI },
];

const digitalPresets: ProjectPreset[] = [
  { name: 'Instagram Square', description: '1080 × 1080 px • 96 DPI', unit: 'px', width: 1080, height: 1080, dpi: 96 },
  { name: 'Instagram Story', description: '1080 × 1920 px • 96 DPI', unit: 'px', width: 1080, height: 1920, dpi: 96 },
  { name: 'Desktop Wallpaper', description: '1920 × 1080 px • 96 DPI', unit: 'px', width: 1920, height: 1080, dpi: 96 },
];

const confirmClearMessage =
  'Selecting a new preset will clear your current design. Save first if needed before continuing.';

export const ProjectPresets: React.FC = () => {
  const { canvas, setUnitMode, setLayers, setCanvasBackgroundColor } = useEditorStore();

  const applyPreset = (preset: ProjectPreset) => {
    if (!canvas) return;
    if (canvas.getObjects().length > 0) {
      const proceed = window.confirm(confirmClearMessage);
      if (!proceed) return;
    }

    canvas.discardActiveObject();
    clearSafeMarginGuides(canvas);
    canvas.clear();

    const widthPx = preset.unit === 'in' ? Math.round(preset.width * preset.dpi) : preset.width;
    const heightPx = preset.unit === 'in' ? Math.round(preset.height * preset.dpi) : preset.height;

    setUnitMode(preset.unit);
    setLayers([]);

    resizeCanvas(widthPx, heightPx);
    setCanvasBackgroundColor('#ffffff');

    if (preset.unit === 'in') {
      addSafeMarginGuides(canvas);
    } else {
      clearSafeMarginGuides(canvas);
    }
  };

  const renderButton = (preset: ProjectPreset) => (
    <button
      key={`${preset.name}-${preset.width}-${preset.height}`}
      onClick={() => applyPreset(preset)}
      className="w-full text-left px-3 py-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all duration-300 ease-in-out flex flex-col gap-1"
    >
      <span className="text-xs uppercase tracking-widest text-slate-400">{preset.name}</span>
      <span className="text-[10px] uppercase tracking-widest text-slate-500">{preset.description}</span>
    </button>
  );

  return (
    <section className="px-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-widest text-slate-400">New Project</h3>
        <span className="text-[9px] uppercase tracking-widest text-slate-500">Presets</span>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-slate-500">Print (300 DPI)</span>
          <span className="text-[9px] uppercase tracking-widest text-amber-200">Safe Margin 24px</span>
        </div>
        <div className="space-y-2">
          {printPresets.map(renderButton)}
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-slate-500">Digital (96 DPI)</span>
          <span className="text-[9px] uppercase tracking-widest text-slate-500">Pixels Mode</span>
        </div>
        <div className="space-y-2">
          {digitalPresets.map(renderButton)}
        </div>
      </div>
    </section>
  );
};
