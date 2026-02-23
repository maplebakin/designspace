import React, { useState, useEffect } from 'react';
import { shallow } from 'zustand/shallow';
import { useEditorStore } from '../state/editorStore';
import { Sparkles, FolderOpen, Plus } from 'lucide-react';

interface ProjectItem {
  id: string;
  name: string;
  lastModified: Date;
  thumbnail?: string;
}

interface ProjectDashboardProps {
  onProjectOpen?: () => void;
}

export const ProjectDashboard: React.FC<ProjectDashboardProps> = ({ onProjectOpen }) => {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const {
    getAllProjects,
    loadProject,
    setProjectPresetsOpen,
    loadProjectFile,
  } = useEditorStore((state) => ({
    getAllProjects: state.getAllProjects,
    loadProject: state.loadProject,
    setProjectPresetsOpen: state.setProjectPresetsOpen,
    loadProjectFile: state.loadProjectFile,
  }), shallow);

  useEffect(() => {
    const run = async () => {
      setIsLoading(true);
      try {
        const list = await getAllProjects();
        setProjects(
          list
            .slice(0, 5)
            .map((p: any) => ({ ...p, lastModified: new Date(p.lastModified) }))
        );
      } finally {
        setIsLoading(false);
      }
    };
    void run();
  }, [getAllProjects]);

  const formatDate = (date: Date) =>
    new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);

  return (
    <div className="min-h-screen bg-[color:var(--ui-bg)] text-[color:var(--ui-text)] flex items-center justify-center p-6">
      <div className="w-full max-w-4xl rounded-3xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)]/70 backdrop-blur-[var(--ui-blur)] p-8 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
        <div className="text-center mb-8">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-[color:var(--brand-primary)]/20 text-[color:var(--brand-primary)] flex items-center justify-center mb-3">
            <Sparkles className="w-6 h-6" />
          </div>
          <h1 className="text-3xl font-semibold tracking-wide">Design Space</h1>
          <p className="text-slate-400 mt-2 text-sm">Multi-page design studio</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
          <button
            onClick={() => {
              setProjectPresetsOpen(true);
              onProjectOpen?.();
            }}
            className="h-12 rounded-xl border border-[color:var(--brand-primary)]/40 bg-[color:var(--brand-primary)]/15 hover:bg-[color:var(--brand-primary)]/25 transition-all uppercase tracking-widest text-xs flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" /> New Project
          </button>

          <label className="h-12 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all uppercase tracking-widest text-xs flex items-center justify-center gap-2 cursor-pointer">
            <FolderOpen className="w-4 h-4" /> Open Project
            <input
              type="file"
              accept=".apocaproject.json,.json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                await loadProjectFile(file);
                onProjectOpen?.();
                e.currentTarget.value = '';
              }}
            />
          </label>
        </div>

        <div>
          <h2 className="text-[11px] uppercase tracking-widest text-slate-300 mb-3">Recent Projects</h2>
          {isLoading ? (
            <div className="text-sm text-slate-400">Loading…</div>
          ) : projects.length === 0 ? (
            <div className="text-sm text-slate-400">No recent projects yet.</div>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={async () => {
                    await loadProject(project.id);
                    onProjectOpen?.();
                  }}
                  className="w-full text-left rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-3"
                >
                  <div className="text-sm text-slate-100">{project.name}</div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">{formatDate(project.lastModified)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
