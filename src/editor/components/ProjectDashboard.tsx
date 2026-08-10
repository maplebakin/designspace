import React, { useState, useEffect, useMemo, useRef } from 'react';
import { shallow } from 'zustand/shallow';
import { useEditorStore } from '../state/editorStore';
import { Sparkles, FolderOpen, Plus, ChevronDown, ChevronUp, Pencil, FileText } from 'lucide-react';
import { DEFAULT_CANVAS_SIZE } from '../state/editorStore';
import type { EditorMode } from '../project/projectSchema';
import type { ProjectSessionDescriptor } from '../session/projectSession';
import {
  inspectDesignSpaceProjectFile,
  inspectLibraryProject,
} from '../project/projectOpenService';
import { useDocumentStore } from '../../document/state/documentStore';
import { getStartupStorageStatus } from '../persistence/startupStorageRecovery';
import { RecoveryWorkspace } from '../recovery/RecoveryWorkspace';

interface ProjectItem {
  id: string;
  name: string;
  lastModified: Date;
  thumbnail?: string;
}

const INITIAL_DISPLAY_COUNT = 5;

interface ProjectDashboardProps {
  onProjectOpen?: (
    mode?: EditorMode,
    session?: ProjectSessionDescriptor
  ) => void | Promise<void>;
  onOpenComplete?: () => void | Promise<void>;
}

export const ProjectDashboard: React.FC<ProjectDashboardProps> = ({ onProjectOpen, onOpenComplete }) => {
  const [allProjects, setAllProjects] = useState<ProjectItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const storageStatus = getStartupStorageStatus();

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
    let cancelled = false;
    const run = async () => {
      if (storageStatus.indexedDbBlocked) {
        setLibraryError(
          storageStatus.reason === 'origin-storage-oversized'
            ? 'The browser library is unusually large and has been isolated so Design Space can open safely.'
            : 'The browser library could not be inspected safely and has been isolated for recovery.'
        );
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const list = await getAllProjects();
        if (cancelled) return;
        setAllProjects(
          list.map((p: any) => ({ ...p, lastModified: new Date(p.lastModified) }))
        );
      } catch (error) {
        if (!cancelled) {
          setLibraryError(error instanceof Error ? error.message : 'The project library could not be loaded.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [getAllProjects, storageStatus.indexedDbBlocked, storageStatus.reason]);

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
    Number.isNaN(date.getTime()) ? 'Unknown date' : new Intl.DateTimeFormat('en-US', {
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

  const openProjectInEditor = async (
    loadAction: () => Promise<void>,
    mode: EditorMode = 'canvas',
    session?: ProjectSessionDescriptor
  ) => {
    await onProjectOpen?.(mode, session);
    if (mode === 'document') {
      await loadAction();
      await onOpenComplete?.();
      return;
    }
    const canvasReady = await waitForEditorCanvas();
    if (!canvasReady) {
      setToastMessage('Editor is still initializing. Please try again.');
      return;
    }
    await loadAction();
    await onOpenComplete?.();
  };

  const openProjectPresetsInEditor = async () => {
    createProject({
      canvasSize: DEFAULT_CANVAS_SIZE,
      unitMode: 'in',
      source: 'project-presets-modal-confirmed',
    });
    setShowOnboarding(true);
    await onProjectOpen?.('canvas');
    await onOpenComplete?.();
  };

  const openBlankDocumentInEditor = async () => {
    useDocumentStore.getState().createBlankProject();
    await onProjectOpen?.('document');
    await onOpenComplete?.();
  };

  const openLibraryProject = async (projectId: string) => {
    try {
      const inspection = await inspectLibraryProject(projectId);
      if (!inspection) {
        setToastMessage('Project not found.');
        return;
      }
      if (inspection.editorMode === 'document') {
        useDocumentStore.getState().hydrateProject(
          inspection.payload,
          inspection.libraryProjectId
        );
        await onProjectOpen?.('document', inspection.session);
        await onOpenComplete?.();
        return;
      }
      await openProjectInEditor(
        () => loadProject(projectId),
        'canvas',
        inspection.session
      );
    } catch (error) {
      setToastMessage(error instanceof Error ? error.message : 'Failed to open project.');
    }
  };

  const openPortableProjectFile = async (file: File) => {
    try {
      const inspection = await inspectDesignSpaceProjectFile(file);
      if (inspection.editorMode === 'document') {
        useDocumentStore.getState().hydrateProject(inspection.payload, null);
        await onProjectOpen?.('document', inspection.session);
        await onOpenComplete?.();
        return;
      }
      await openProjectInEditor(
        () => loadProjectFile(file),
        'canvas',
        inspection.session
      );
    } catch (error) {
      setToastMessage(error instanceof Error ? error.message : 'Failed to open project file.');
    }
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
    <main
      id="main-content"
      tabIndex={-1}
      data-testid="dashboard-root"
      className="project-dashboard-root min-h-screen bg-[color:var(--ui-bg)] px-6 py-8 text-[color:var(--ui-text)] md:px-10 lg:py-12"
      style={{ background: 'var(--bg-warm-radial)' }}
    >
      <div
        data-testid="dashboard-panel"
        className="project-dashboard-panel mx-auto w-full max-w-[1120px] rounded-[2rem] border border-[color:var(--ui-border)] bg-[color:var(--ui-panel-opaque)] p-5 text-[color:var(--ui-text)] backdrop-blur-[var(--ui-blur)] md:p-7 lg:p-8"
        style={{ boxShadow: 'var(--hero-shadow)' }}
      >
        <section className="project-dashboard-header rounded-[1.75rem] border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)] p-6 md:p-8">
          <div className="project-dashboard-header-inner flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="project-dashboard-title-group flex items-start gap-4">
              <div className="project-dashboard-brand-icon flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-[color:var(--brand-primary)]/30 bg-[color:var(--brand-primary)]/16 text-[color:var(--brand-primary)]">
                <Sparkles className="h-7 w-7 stroke-[1.5]" />
              </div>
              <div>
                <p className="project-dashboard-eyebrow text-xs font-semibold uppercase tracking-widest text-[color:var(--brand-primary)]">Printable Product Studio</p>
                <h1 className="project-dashboard-title mt-2 text-4xl font-semibold tracking-normal md:text-5xl" style={{ fontFamily: 'var(--font-display)' }}>Design Space</h1>
                <p className="project-dashboard-description mt-4 max-w-2xl text-base font-medium leading-7 text-[color:var(--ui-panel-text)]">
                  Create themed printable products, reopen saved projects, and package sellable downloads from one workspace.
                </p>
              </div>
            </div>
            <div className="project-dashboard-status rounded-2xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] px-4 py-3 text-sm font-semibold text-[color:var(--ui-panel-text)]">
              Product projects stay editable until you are ready to export.
            </div>
          </div>
        </section>

        <div data-testid="dashboard-actions" className="project-dashboard-actions mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
          <button
            onClick={() => {
              void openProjectPresetsInEditor();
            }}
            data-testid="dashboard-new-project"
            className="project-dashboard-action-card project-dashboard-action-card-primary group flex min-h-[150px] flex-col justify-start gap-4 rounded-[1.5rem] border border-[color:var(--brand-primary)]/38 bg-[color:var(--ui-panel)] p-6 text-left text-[color:var(--ui-text)] shadow-[var(--ui-shadow-soft)] outline-none transition-colors duration-200 hover:border-[color:var(--brand-primary)]/70 hover:bg-[color:var(--brand-primary)]/12 focus-visible:ring-2 focus-visible:ring-[color:var(--brand-primary)]/45"
            style={{ fontFamily: 'var(--font-ui)' }}
          >
            <span className="project-dashboard-card-top flex items-center justify-between gap-4">
              <span className="project-dashboard-card-icon project-dashboard-card-icon-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color:var(--brand-primary)] text-white shadow-sm">
                <Plus className="h-5 w-5 stroke-[1.5]" aria-hidden="true" />
              </span>
              <span className="project-dashboard-card-badge rounded-full border border-[color:var(--brand-primary)]/30 bg-[color:var(--ui-panel)] px-3 py-1 text-xs font-semibold text-[color:var(--brand-primary)]">
                Start
              </span>
            </span>
            <span>
              <span className="project-dashboard-card-title block text-xl font-semibold tracking-normal text-[color:var(--ui-text)]">Create Product</span>
              <span className="project-dashboard-card-description mt-2 block max-w-md text-sm font-medium leading-6 text-[color:var(--ui-panel-text)]">
                Start a printable product project and choose a recipe or preset in the editor.
              </span>
            </span>
          </button>

          <label
            data-testid="dashboard-open-project"
            className="project-dashboard-action-card group flex min-h-[150px] cursor-pointer flex-col justify-start gap-4 rounded-[1.5rem] border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] p-6 text-left text-[color:var(--ui-text)] shadow-[var(--ui-shadow-soft)] outline-none transition-colors duration-200 hover:border-[color:var(--brand-primary)]/45 hover:bg-[color:var(--ui-surface-strong)] focus-within:ring-2 focus-within:ring-[color:var(--brand-primary)]/35"
            style={{ fontFamily: 'var(--font-ui)', boxShadow: 'var(--ui-shadow-soft)' }}
          >
            <span className="project-dashboard-card-top flex items-center justify-between gap-4">
              <span className="project-dashboard-card-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)] text-[color:var(--brand-primary)]">
                <FolderOpen className="h-5 w-5 stroke-[1.5]" aria-hidden="true" />
              </span>
              <span className="project-dashboard-card-badge rounded-full border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--ui-panel-text)]">
                File
              </span>
            </span>
            <span>
              <span className="project-dashboard-card-title block text-xl font-semibold tracking-normal text-[color:var(--ui-text)]">Open Product Project</span>
              <span className="project-dashboard-card-description mt-2 block max-w-md text-sm font-medium leading-6 text-[color:var(--ui-panel-text)]">
                Load an existing Design Space project file from your computer.
              </span>
            </span>
            <input
              type="file"
              data-testid="dashboard-open-file-input"
              accept=".apocaproject.json,.json"
              className="hidden"
              onChange={(e) => {
                const input = e.currentTarget;
                void (async () => {
                  const file = input.files?.[0];
                  if (!file) return;
                  try {
                    await openPortableProjectFile(file);
                  } finally {
                    input.value = '';
                  }
                })();
              }}
            />
          </label>

          <button
            type="button"
            onClick={() => {
              void openBlankDocumentInEditor();
            }}
            data-testid="dashboard-new-document"
            className="project-dashboard-action-card group flex min-h-[132px] flex-col justify-start gap-4 rounded-[1.5rem] border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] p-6 text-left text-[color:var(--ui-text)] shadow-[var(--ui-shadow-soft)] outline-none transition-colors duration-200 hover:border-[color:var(--brand-primary)]/45 hover:bg-[color:var(--ui-surface-strong)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-primary)]/35 md:col-span-2 md:flex-row md:items-center"
            style={{ fontFamily: 'var(--font-ui)' }}
          >
            <span className="project-dashboard-card-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)] text-[color:var(--brand-primary)]">
              <FileText className="h-5 w-5 stroke-[1.5]" aria-hidden="true" />
            </span>
            <span>
              <span className="project-dashboard-card-title block text-xl font-semibold tracking-normal text-[color:var(--ui-text)]">Create Document Project</span>
              <span className="project-dashboard-card-description mt-2 block max-w-2xl text-sm font-medium leading-6 text-[color:var(--ui-panel-text)]">
                Reconstruct a fixed-size article page with flowing columns, wrapped photographs, and a removable scan reference.
              </span>
            </span>
          </button>
        </div>

        <section className="project-dashboard-library mt-7 rounded-[1.75rem] border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)] p-5 md:p-6">
          <div className="project-dashboard-library-header mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="project-dashboard-eyebrow text-xs font-semibold uppercase tracking-widest text-[color:var(--brand-primary)]">Library</p>
              <h2 className="project-dashboard-section-title mt-1 text-xl font-semibold text-[color:var(--ui-text)]">Recent Product Projects</h2>
            </div>
            {!isLoading && allProjects.length > 0 && (
              <span className="project-dashboard-count rounded-full border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] px-3 py-1 text-xs font-medium uppercase tracking-widest text-[color:var(--ui-panel-text)]">
                {allProjects.length} project{allProjects.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <RecoveryWorkspace startupBlocked={storageStatus.indexedDbBlocked} />
          {libraryError ? (
            <div
              className="project-dashboard-empty-state rounded-2xl border border-amber-500/35 bg-amber-100/10 px-5 py-6 text-sm font-medium leading-6 text-[color:var(--ui-panel-text)]"
              data-testid="dashboard-library-recovery"
              role="status"
            >
              <strong className="block text-[color:var(--ui-text)]">Library recovery mode</strong>
              <span className="mt-1 block">{libraryError}</span>
              {storageStatus.usageBytes !== null && (
                <span className="mt-2 block text-xs">
                  Detected storage: {(storageStatus.usageBytes / (1024 ** 3)).toFixed(1)} GB.
                  Existing IndexedDB data has not been deleted or rewritten.
                </span>
              )}
              <span className="mt-2 block text-xs">
                You can still create an unsaved project or open a portable project file. Browser-library access remains disabled until the damaged origin storage is recovered or removed.
              </span>
            </div>
          ) : isLoading ? (
            <div className="project-dashboard-empty-state rounded-2xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] px-5 py-7 text-base font-medium text-[color:var(--ui-panel-text)]">Loading…</div>
          ) : allProjects.length === 0 ? (
            <div className="project-dashboard-empty-state rounded-2xl border border-dashed border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] px-5 py-9 text-base font-medium leading-7 text-[color:var(--ui-panel-text)]">
              No product projects yet.
            </div>
          ) : (
            <div className="project-dashboard-project-list grid gap-3">
              {displayedProjects.map((project) => (
                <div
                  key={project.id}
                  data-testid="dashboard-project-card"
                  className="project-dashboard-project-card group flex items-center gap-3 rounded-2xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] p-3 transition-colors duration-200 hover:border-[color:var(--brand-primary)]/35 hover:bg-[color:var(--ui-surface-strong)]"
                  style={{ boxShadow: 'var(--ui-shadow-soft)' }}
                >
                  {editingProjectId === project.id ? (
                    <div className="project-dashboard-edit-row flex flex-1 items-center gap-4">
                      <div className="project-dashboard-project-thumb flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)] text-xl font-semibold text-[color:var(--brand-primary)]">
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
                        className="project-dashboard-rename-input flex-1 border-b border-[color:var(--brand-primary)]/50 bg-transparent pb-1 text-base text-[color:var(--ui-text)] outline-none"
                      />
                    </div>
                  ) : (
                    <>
                      <button
                        className="project-dashboard-project-open flex min-w-0 flex-1 items-center gap-4 rounded-xl p-2 text-left outline-none transition-colors duration-200 hover:bg-[color:var(--ui-surface-soft)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-primary)]/35"
                        onClick={() => void openLibraryProject(project.id)}
                      >
                        <span className="project-dashboard-project-thumb flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)] text-xl font-semibold text-[color:var(--brand-primary)]">
                          {project.thumbnail ? (
                            <img src={project.thumbnail} alt="" className="h-full w-full object-cover" />
                          ) : (
                            project.name.charAt(0).toUpperCase()
                          )}
                        </span>
                        <span className="project-dashboard-project-copy min-w-0">
                          <span className="project-dashboard-project-title block truncate text-base font-semibold text-[color:var(--ui-text)]">{project.name}</span>
                          <span className="project-dashboard-project-date mt-1 block text-sm font-medium leading-5 text-[color:var(--ui-panel-text)]">{formatDate(project.lastModified)}</span>
                          <span className="project-dashboard-project-pill mt-2 inline-flex rounded-full border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)] px-2.5 py-1 text-xs font-semibold text-[color:var(--ui-panel-text)]">
                            Open editable product project
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); startRename(project.id, project.name); }}
                        className="project-dashboard-rename-button shrink-0 rounded-lg p-2 text-[color:var(--ui-panel-text)] opacity-80 transition-all duration-150 hover:bg-[color:var(--ui-hover-strong)] hover:text-[color:var(--brand-primary)] group-hover:opacity-100"
                        title="Rename project"
                        data-testid={`rename-project-${project.id}`}
                      >
                        <Pencil className="h-4 w-4 stroke-[1.5]" />
                      </button>
                    </>
                  )}
                </div>
              ))}
              {hasMoreProjects && (
                <button
                  onClick={() => setShowAll(!showAll)}
                  className="project-dashboard-show-all flex w-full items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-medium uppercase tracking-widest text-[color:var(--ui-panel-text)] transition-colors duration-200 hover:bg-[color:var(--ui-panel)] hover:text-[color:var(--brand-primary)]"
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
        </section>
      </div>
    </main>
  );
};
