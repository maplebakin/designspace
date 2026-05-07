import React, { useState, useEffect, useMemo, useRef } from 'react';
import { shallow } from 'zustand/shallow';
import { useEditorStore } from '../state/editorStore';
import { Sparkles, FolderOpen, Plus, ChevronDown, ChevronUp, Pencil } from 'lucide-react';
import { DEFAULT_CANVAS_SIZE } from '../state/editorStore';

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
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const {
    getAllProjects,
    loadProject,
    loadProjectFile,
    setToastMessage,
    renameProject,
    currentLibraryProjectId,
    setProjectName,
    createProject,
    setShowOnboarding,
  } = useEditorStore((state) => ({
    getAllProjects: state.getAllProjects,
    loadProject: state.loadProject,
    loadProjectFile: state.loadProjectFile,
    setToastMessage: state.setToastMessage,
    renameProject: state.renameProject,
    currentLibraryProjectId: state.currentLibraryProjectId,
    setProjectName: state.setProjectName,
    createProject: state.createProject,
    setShowOnboarding: state.setShowOnboarding,
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

  useEffect(() => {
    if (editingProjectId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [editingProjectId]);

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
    createProject({
      canvasSize: DEFAULT_CANVAS_SIZE,
      unitMode: 'in',
      source: 'project-presets-modal-confirmed',
    });
    setShowOnboarding(true);
    await onProjectOpen?.();
  };

  const startRename = (projectId: string, currentName: string) => {
    setEditingProjectId(projectId);
    setEditDraft(currentName);
  };

  const cancelRename = () => {
    setEditingProjectId(null);
    setEditDraft('');
  };

  const commitRename = async (projectId: string) => {
    const safeName = editDraft.trim() || 'Untitled Project';
    const original = allProjects.find((p) => p.id === projectId)?.name;
    setEditingProjectId(null);
    setEditDraft('');
    if (safeName === original) return;
    setAllProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, name: safeName } : p)));
    await renameProject(projectId, safeName);
    if (currentLibraryProjectId === projectId) {
      setProjectName(safeName);
    }
  };

  return (
    <div className="min-h-screen bg-[color:var(--ui-bg)] text-[color:var(--ui-text)] flex items-center justify-center p-6" style={{ background: 'var(--bg-warm-radial)' }}>
      <div className="w-full max-w-[880px] rounded-[2rem] border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] backdrop-blur-[var(--ui-blur)] p-10" style={{ boxShadow: 'var(--hero-shadow)' }}>
        <div className="text-center mb-8">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-[color:var(--brand-primary)]/20 text-[color:var(--brand-primary)] flex items-center justify-center mb-3.5">
            <Sparkles className="w-6 h-6 stroke-[1.5]" />
          </div>
          <h1 className="text-4xl font-semibold tracking-[0.02em]" style={{ fontFamily: 'var(--font-display)' }}>Design Space</h1>
          <p className="text-[color:var(--ui-panel-text)]/70 mt-3 text-sm">Multi-page design studio</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
          <button
            onClick={() => {
              void openProjectPresetsInEditor();
            }}
            data-testid="dashboard-new-project"
            className="h-12 rounded-xl text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all duration-200 border border-[color:var(--brand-primary)]/35 bg-[color:var(--brand-primary)]/14 text-[color:var(--brand-primary)] hover:bg-[color:var(--brand-primary)]/22"
            style={{ fontFamily: 'var(--font-ui)' }}
          >
            <Plus className="w-4 h-4 stroke-[1.5]" /> New Project
          </button>

          <label className="h-12 rounded-xl text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 cursor-pointer transition-all duration-200 border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)] text-[color:var(--ui-panel-text)] hover:bg-[color:var(--ui-surface-strong)] hover:text-[color:var(--ui-text)]"
            style={{ fontFamily: 'var(--font-ui)', boxShadow: 'var(--ui-shadow-soft)' }}
          >
            <FolderOpen className="w-4 h-4 stroke-[1.5]" /> Open Project
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
                <div
                  key={project.id}
                  data-testid="dashboard-project-card"
                  className="w-full rounded-2xl px-4 py-3 transition-all duration-200 group border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)]/60 hover:bg-[color:var(--ui-surface-strong)] cursor-default"
                  style={{ boxShadow: 'var(--ui-shadow-soft)' }}
                >
                  {editingProjectId === project.id ? (
                    <div className="flex items-center gap-3">
                      <div className="w-14 h-14 rounded-xl shrink-0 border border-[color:var(--ui-border)] overflow-hidden flex items-center justify-center bg-[color:var(--ui-surface-soft)] text-[color:var(--brand-primary)] text-lg font-semibold">
                        {project.thumbnail ? (
                          <img src={project.thumbnail} alt="" className="w-full h-full object-cover" />
                        ) : (
                          project.name.charAt(0).toUpperCase()
                        )}
                      </div>
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); void commitRename(project.id); }
                          if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                        }}
                        onBlur={() => void commitRename(project.id)}
                        data-testid="dashboard-rename-input"
                        className="flex-1 bg-transparent text-sm text-[color:var(--ui-text)] outline-none border-b border-[color:var(--brand-primary)]/50 pb-0.5"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="w-14 h-14 rounded-xl shrink-0 border border-[color:var(--ui-border)] overflow-hidden flex items-center justify-center bg-[color:var(--ui-surface-soft)] text-[color:var(--brand-primary)] text-lg font-semibold">
                        {project.thumbnail ? (
                          <img src={project.thumbnail} alt="" className="w-full h-full object-cover" />
                        ) : (
                          project.name.charAt(0).toUpperCase()
                        )}
                      </div>
                      <button
                        className="flex-1 text-left min-w-0"
                        onClick={() => void openProjectInEditor(() => loadProject(project.id))}
                      >
                        <div className="text-sm text-[color:var(--ui-text)] truncate font-medium">{project.name}</div>
                        <div className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/60 mt-1">{formatDate(project.lastModified)}</div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); startRename(project.id, project.name); }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-[color:var(--ui-hover-strong)] text-[color:var(--ui-panel-text)] hover:text-[color:var(--brand-primary)] transition-all duration-150 shrink-0"
                        title="Rename project"
                        data-testid={`rename-project-${project.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5 stroke-[1.5]" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {hasMoreProjects && (
                <button
                  onClick={() => setShowAll(!showAll)}
                  className="w-full flex items-center justify-center gap-1.5 py-3 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)] hover:text-[color:var(--brand-primary)] transition-colors duration-200"
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
