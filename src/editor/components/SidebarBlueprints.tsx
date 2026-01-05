
import React from 'react';
import { useEditorStore } from '../state/editorStore';
import { loadDailyPlannerTemplate } from '../fabric/blueprintFactories';
import { LayoutTemplate } from 'lucide-react';

export const SidebarBlueprints: React.FC = () => {
  const { canvas, brandPalette } = useEditorStore();

  const handleLoadTemplate = () => {
    if (canvas) {
      loadDailyPlannerTemplate(canvas, brandPalette);
    }
  };

  return (
    <div className="py-4 space-y-6">
      <div className="px-4">
        <h3 className="text-[11px] uppercase tracking-widest text-slate-400 mb-3">Templates</h3>
        <div className="px-2">
          <button
            onClick={handleLoadTemplate}
            className="group w-full flex items-center gap-2 px-2 py-2 text-left text-xs uppercase tracking-widest text-slate-200 rounded-lg hover:bg-white/5 transition-all duration-300 ease-in-out"
          >
            <LayoutTemplate className="w-5 h-5 stroke-[1.5] text-[color:var(--muted-icon)] group-hover:text-[color:var(--brand-primary)] transition-all duration-300 ease-in-out" />
            <span>Daily Planner</span>
          </button>
        </div>
      </div>
    </div>
  );
};
