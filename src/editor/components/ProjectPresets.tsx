import React from 'react';
import { shallow } from 'zustand/shallow';
import { fitCanvasToViewport } from '../fabric/canvasUtils';
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

type ProjectPresetsProps = {
  onPresetApplied?: () => void;
};

export const ProjectPresets: React.FC<ProjectPresetsProps> = ({ onPresetApplied }) => {
  const { canvas, createProject, setCanvasBackgroundColor } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
      createProject: state.createProject,
      setCanvasBackgroundColor: state.setCanvasBackgroundColor,
    }),
    shallow
  );

  const applyPreset = (preset: ProjectPreset) => {
    if (!canvas) return;
    if (canvas.getObjects().length > 0) {
      const proceed = window.confirm(confirmClearMessage);
      if (!proceed) return;
    }

    const widthPx = preset.unit === 'in' ? Math.round(preset.width * preset.dpi) : preset.width;
    const heightPx = preset.unit === 'in' ? Math.round(preset.height * preset.dpi) : preset.height;

    createProject({
      canvasSize: { width: widthPx, height: heightPx },
      unitMode: preset.unit,
      source: 'project-presets-modal',
    });
    setCanvasBackgroundColor('#ffffff');

    // Fit canvas to viewport after resize
    requestAnimationFrame(() => {
      const container = document.querySelector('.workspace');
      if (container) {
        const rect = container.getBoundingClientRect();
        fitCanvasToViewport(rect.width, rect.height);
      }
    });

    onPresetApplied?.();
  };

  const renderButton = (preset: ProjectPreset) => (
    <button
      key={`${preset.name}-${preset.width}-${preset.height}`}
      onClick={() => applyPreset(preset)}
      className={`w-full text-left px-3 py-3 rounded-2xl border transition-all duration-300 ease-in-out flex flex-col gap-1 ${
        preset.name === 'US Letter'
          ? 'bg-[color:var(--brand-primary)]/20 border-[color:var(--brand-primary)]/50 hover:bg-[color:var(--brand-primary)]/30'
          : 'bg-white/5 border-white/10 hover:bg-white/10'
      }`}
    >
      <span className={`text-xs uppercase tracking-widest ${preset.name === 'US Letter' ? 'text-[color:var(--brand-primary)]' : 'text-slate-200'}`}>{preset.name}</span>
      <span className="text-[10px] uppercase tracking-widest text-slate-300">{preset.description}</span>
    </button>
  );

  return (
    <section className="px-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-widest text-slate-200">New Project</h3>
        <span className="text-[9px] uppercase tracking-widest text-slate-300">Presets</span>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-slate-300">Print (300 DPI)</span>
          <span className="text-[9px] uppercase tracking-widest text-amber-200">Safe Margin 24px</span>
        </div>
        <div className="space-y-2">
          {printPresets.map(renderButton)}
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-slate-300">Digital (96 DPI)</span>
          <span className="text-[9px] uppercase tracking-widest text-slate-300">Pixels Mode</span>
        </div>
        <div className="space-y-2">
          {digitalPresets.map(renderButton)}
        </div>
      </div>
    </section>
  );
};
