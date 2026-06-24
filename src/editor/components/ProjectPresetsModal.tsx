import React from 'react';
import { X } from 'lucide-react';
import { shallow } from 'zustand/shallow';
import { useEditorStore } from '../state/editorStore';
import { ProjectPresets } from './ProjectPresets';

export const ProjectPresetsModal: React.FC = () => {
  const { isProjectPresetsOpen, setProjectPresetsOpen } = useEditorStore(
    (state) => ({
      isProjectPresetsOpen: state.isProjectPresetsOpen,
      setProjectPresetsOpen: state.setProjectPresetsOpen,
    }),
    shallow
  );

  if (!isProjectPresetsOpen) return null;

  return (
    <div className="project-presets-modal-backdrop fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="project-presets-modal-panel bg-[color:var(--ui-panel)] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col border border-[color:var(--ui-border)] backdrop-blur-[var(--ui-blur)] text-[color:var(--ui-text)]">
        <header className="project-presets-modal-header flex items-center justify-between p-4 border-b border-[color:var(--ui-border)]">
          <div>
            <h2 className="text-[11px] uppercase tracking-widest text-[color:var(--ui-text)]">New Canvas</h2>
            <p>Choose a size to get started</p>
          </div>
          <button
            onClick={() => setProjectPresetsOpen(false)}
            className="project-presets-modal-close p-2 rounded-full hover:bg-white/10 transition-all duration-300 ease-in-out"
            aria-label="Close New Canvas"
          >
            <X className="w-5 h-5 stroke-[1.5] text-[color:var(--muted-icon)]" />
          </button>
        </header>
        <div className="project-presets-modal-body flex-1 overflow-y-auto p-6">
          <ProjectPresets onPresetApplied={() => setProjectPresetsOpen(false)} />
        </div>
      </div>
    </div>
  );
};
