import React, { useState, useEffect, useMemo } from 'react';
import { shallow } from 'zustand/shallow';
import { useEditorStore } from '../state/editorStore';
import { Sparkles, FolderOpen, Plus, ChevronDown, ChevronUp } from 'lucide-react';

interface ProjectItem {
  id: string;
  name: string;
  lastModified: Date;
  thumbnail?: string;
}

const INITIAL_DISPLAY_COUNT = 5;

interface ProjectDashboardProps {
  onProjectOpen?: () => void | Promise<void>;
}

export const ProjectDashboard: React.FC<ProjectDashboardProps> = ({ onProjectOpen }) => {
  const [allProjects, setAllProjects] = useState<ProjectItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const {
    getAllProjects,
    loadProject,
    setProjectPresetsOpen,
    loadProjectFile,
    setToastMessage,
  } = useEditorStore((state) => ({
    getAllProjects: state.getAllProjects,
    loadProject: state.loadProject,
    setProjectPresetsOpen: state.setProjectPresetsOpen,
    loadProjectFile: state.loadProjectFile,
    setToastMessage: state.setToastMessage,
  }), shallow);

  useEffect(() => {
    const run = async () => {
      setIsLoading(true);
      try {
        const list = await getAllProjects();
        setAllProjects(
          list.map((p: any) => ({ ...p, lastModified: new Date(p.lastModified) }))
        );
      } finally {
        setIsLoading(false);
      }
    };
    void run();
  }, [getAllProjects]);

  const displayedProjects = useMemo(() => {
    if (showAll) return allProjects;
    return allProjects.slice(0, INITIAL_DISPLAY_COUNT);
  }, [allProjects, showAll]);

  const hasMoreProjects = allProjects.length > INITIAL_DISPLAY_COUNT;

  const formatDate = (date: Date) =>
    new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);

  const waitForEditorCanvas = async (timeoutMs = 5000) => {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      const { canvas, canvasReadyState } = useEditorStore.getState();
      if (canvas && canvasReadyState === 'ready') {
        return true;
      }
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    }
    return false;
  };

  const openProjectInEditor = async (loadAction: () => Promise<void>) => {
    await onProjectOpen?.();
    const canvasReady = await waitForEditorCanvas();
    if (!canvasReady) {
      setToastMessage('Editor is still initializing. Please try again.');
      return;
    }
    await loadAction();
  };

  const openProjectPresetsInEditor = async () => {
    await onProjectOpen?.();
    const canvasReady = await waitForEditorCanvas();
    if (!canvasReady) {
      setToastMessage('Editor is still initializing. Please try again.');
      return;
    }
    setProjectPresetsOpen(true);
  };

  return (
    <div className="min-h-screen bg-[color:var(--ui-bg)] text-[color:var(--ui-text)] flex items-center justify-center p-6">
      <div className="w-full max-w-5xl rounded-[2rem] border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)]/88 backdrop-blur-[var(--ui-blur)] p-10 shadow-[0_26px_62px_rgba(74,56,45,0.22)]">
        <div className="text-center mb-8">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-[color:var(--brand-primary)]/20 text-[color:var(--brand-primary)] flex items-center justify-center mb-3">
            <Sparkles className="w-6 h-6" />
          </div>
          <h1 className="text-4xl font-semibold tracking-[0.02em]">Design Space</h1>
          <p className="text-[color:var(--ui-panel-text)]/70 mt-3 text-sm">Multi-page design studio</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
          <button
            onClick={() => {
              void openProjectPresetsInEditor();
            }}
            className="ui-button-soft h-12 rounded-xl uppercase tracking-widest text-xs flex items-center justify-center gap-2 border-[color:var(--brand-primary)]/35 bg-[color:var(--brand-primary)]/14 hover:bg-[color:var(--brand-primary)]/20"
          >
            <Plus className="w-4 h-4" /> New Project
          </button>

          <label className="ui-button-soft h-12 rounded-xl uppercase tracking-widest text-xs flex items-center justify-center gap-2 cursor-pointer">
            <FolderOpen className="w-4 h-4" /> Open Project
            <input
              type="file"
              accept=".apocaproject.json,.json"
              className="hidden"
              onChange={(e) => {
                void (async () => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    await openProjectInEditor(() => loadProjectFile(file));
                  } finally {
                    e.currentTarget.value = '';
                  }
                })();
              }}
            />
          </label>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Recent Projects Library</h2>
            {!isLoading && allProjects.length > 0 && (
              <span className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/60">
                {allProjects.length} project{allProjects.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {isLoading ? (
            <div className="text-sm text-[color:var(--ui-panel-text)]">Loading…</div>
          ) : allProjects.length === 0 ? (
            <div className="text-sm text-[color:var(--ui-panel-text)]">No recent projects yet.</div>
          ) : (
            <div className="space-y-3">
              {displayedProjects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => {
                    void openProjectInEditor(() => loadProject(project.id));
                  }}
                  className="ui-card-soft w-full text-left rounded-2xl px-5 py-4 transition-all duration-200 hover:bg-[color:var(--ui-surface-strong)] hover:-translate-y-[1px]"
                >
                  <div className="text-sm text-[color:var(--ui-text)]">{project.name}</div>
                  <div className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/60">{formatDate(project.lastModified)}</div>
                </button>
              ))}
              {hasMoreProjects && (
                <button
                  onClick={() => setShowAll(!showAll)}
                  className="w-full flex items-center justify-center gap-2 py-3 text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)] hover:text-[color:var(--ui-text)] transition-colors"
                >
                  {showAll ? (
                    <>
                      <ChevronUp className="w-4 h-4" />
                      Show Less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-4 h-4" />
                      Show All ({allProjects.length - INITIAL_DISPLAY_COUNT} more)
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
