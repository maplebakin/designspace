import React from 'react';
import { shallow } from 'zustand/shallow';
import { useEditorStore } from '../state/editorStore';
import { isUserObject } from '../utils/objectUtils';
import { PROJECT_PRESET_GROUPS, type CanvasPreset } from '../config/canvasPresets';

const confirmClearMessage =
  'Selecting a new preset will clear your current design. Save first if needed before continuing.';

type ProjectPresetsProps = {
  onPresetApplied?: () => void;
};

export const ProjectPresets: React.FC<ProjectPresetsProps> = ({ onPresetApplied }) => {
  const { canvas, canvasReadyState, createProject, setCanvasBackgroundColor, pages, isDirty } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
      canvasReadyState: state.canvasReadyState,
      createProject: state.createProject,
      setCanvasBackgroundColor: state.setCanvasBackgroundColor,
      pages: state.pages,
      isDirty: state.isDirty,
    }),
    shallow
  );
  const presetsReady = !!canvas && canvasReadyState === 'ready';

  const applyPreset = (preset: CanvasPreset) => {
    if (!presetsReady || !canvas) return;
    const hasUserCanvasObjects = canvas.getObjects().some(isUserObject);
    const hasUserPageContent = pages.some((page) =>
      Array.isArray(page?.canvasData?.objects)
      && page.canvasData.objects.some(isUserObject)
    );
    if (hasUserCanvasObjects || hasUserPageContent || isDirty) {
      const proceed = window.confirm(confirmClearMessage);
      if (!proceed) return;
    }

    createProject({
      canvasSize: { width: preset.width, height: preset.height },
      unitMode: preset.unitMode,
      source: 'project-presets-modal-confirmed',
    });
    setCanvasBackgroundColor('#ffffff', { save: false });
    onPresetApplied?.();
  };

  const renderButton = (preset: CanvasPreset) => (
    <button
      key={`${preset.name}-${preset.width}-${preset.height}`}
      disabled={!presetsReady}
      onClick={() => applyPreset(preset)}
      data-testid={`project-preset-${preset.id}`}
      className={`w-full text-left px-3 py-3 rounded-2xl border transition-all duration-300 ease-in-out flex flex-col gap-1 ${
        preset.name === 'US Letter'
          ? 'bg-[color:var(--brand-primary)]/20 border-[color:var(--brand-primary)]/50 hover:bg-[color:var(--brand-primary)]/30'
          : 'bg-white/5 border-white/10 hover:bg-white/10'
      } ${!presetsReady ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span className={`text-xs uppercase tracking-widest ${preset.name === 'US Letter' ? 'text-[color:var(--brand-primary)]' : 'text-[color:var(--ui-text)]'}`}>{preset.name}</span>
      <span className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">{preset.description}</span>
    </button>
  );

  return (
    <section className="px-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-widest text-[color:var(--ui-text)]">New Project</h3>
        <span className="text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Presets</span>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Print (300 DPI)</span>
          <span className="text-[9px] uppercase tracking-widest text-amber-200">Safe Margin 24px</span>
        </div>
        <div className="space-y-2">
          {PROJECT_PRESET_GROUPS.print.map(renderButton)}
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Digital (96 DPI)</span>
          <span className="text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Pixels Mode</span>
        </div>
        <div className="space-y-2">
          {PROJECT_PRESET_GROUPS.social.map(renderButton)}
        </div>
      </div>
    </section>
  );
};
