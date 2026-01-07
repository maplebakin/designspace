import React from 'react';
import { X } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import { ProjectPresets } from './ProjectPresets';

export const ProjectPresetsModal: React.FC = () => {
  const { isProjectPresetsOpen, setProjectPresetsOpen } = useEditorStore();

  if (!isProjectPresetsOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[color:var(--ui-panel)] rounded-lg shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col border border-[color:var(--ui-border)] backdrop-blur-[var(--ui-blur)] text-[color:var(--ui-text)]">
        <header className="flex items-center justify-between p-4 border-b border-[color:var(--ui-border)]">
          <h2 className="text-[11px] uppercase tracking-widest text-slate-200">Project Presets</h2>
          <button
            onClick={() => setProjectPresetsOpen(false)}
            className="p-2 rounded-full hover:bg-white/10 transition-all duration-300 ease-in-out"
          >
            <X className="w-5 h-5 stroke-[1.5] text-[color:var(--muted-icon)]" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <ProjectPresets onPresetApplied={() => setProjectPresetsOpen(false)} />
        </div>
      </div>
    </div>
  );
};
