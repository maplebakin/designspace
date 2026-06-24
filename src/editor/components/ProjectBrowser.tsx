import React, { useState } from 'react';
import { Folder } from 'lucide-react';
import { ProjectDashboard } from './ProjectDashboard';

export const ProjectBrowser: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="ui-button-soft group flex items-center gap-2 px-4 py-2 rounded-full text-[11px] uppercase tracking-widest"
      >
        <Folder className="w-4 h-4 stroke-[1.5]" />
        <span>Projects</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[color:var(--ui-panel)] rounded-xl border border-[color:var(--ui-border)] w-full max-w-7xl max-h-[90vh] flex flex-col text-[color:var(--ui-panel-text)] shadow-[0_16px_30px_rgba(0,0,0,0.35)]">
            <ProjectDashboard onOpenComplete={() => setIsOpen(false)} />
            <div className="p-4 border-t border-[color:var(--ui-border)] flex justify-end">
              <button
                onClick={() => setIsOpen(false)}
                className="ui-button-soft px-4 py-2 rounded-lg text-sm border-[color:var(--brand-primary)]/30 bg-[color:var(--brand-primary)]/12 hover:bg-[color:var(--brand-primary)]/18"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
