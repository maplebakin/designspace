import React, { useState } from 'react';
import { Folder } from 'lucide-react';
import { ProjectDashboard } from './ProjectDashboard';

export const ProjectBrowser: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="group flex items-center gap-2 px-4 py-2 bg-white/5 text-[color:var(--ui-text)] rounded-full border border-[color:var(--border-subtle)] hover:bg-white/10 transition-all duration-300 ease-in-out text-[11px] uppercase tracking-widest"
      >
        <Folder className="w-4 h-4 stroke-[1.5]" />
        <span>Projects</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50">
          <div className="bg-[color:var(--ui-panel)] rounded-xl border border-[color:var(--ui-border)] w-full h-full max-w-7xl max-h-[90vh] flex flex-col text-[color:var(--ui-panel-text)] shadow-[0_16px_30px_rgba(0,0,0,0.35)] m-4">
            <ProjectDashboard />
            <div className="p-4 border-t border-[color:var(--ui-border)] flex justify-end">
              <button
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 bg-[color:var(--brand-primary)] rounded-lg hover:opacity-90 transition-opacity text-sm"
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