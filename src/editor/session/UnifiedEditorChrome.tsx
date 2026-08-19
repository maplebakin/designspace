import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Expand,
  Home,
  Maximize2,
  Minus,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { ProjectNameEditor } from '../components/ProjectNameEditor';
import { useProjectSessionStore } from '../state/projectSessionStore';
import type {
  LegacyRendererKind,
  ProjectPageDescriptor,
  ProjectSessionCommands,
  ProjectSessionSnapshot,
} from './projectSession';
import type { PageMutationCommand } from './projectMutation';

type UnifiedPageNavigationProps = {
  session: ProjectSessionSnapshot;
  commands: ProjectSessionCommands | null;
};

const pageName = (page: ProjectPageDescriptor, index: number) =>
  page.name?.trim() || `Page ${index + 1}`;

const pageNumber = (page: ProjectPageDescriptor, index: number) =>
  page.folio || index + 1;

const confirmRemovePage = (page: ProjectPageDescriptor) => {
  if (typeof window === 'undefined') return true;
  return window.confirm(`Remove ${page.name || 'this page'}? This cannot be undone.`);
};

const runPageMutation = async (
  commands: ProjectSessionCommands | null,
  command: PageMutationCommand
) => {
  if (!commands) return;
  try {
    const result = await commands.mutatePage(command);
    if (!result.ok) commands.notify(result.error.message);
  } catch (error) {
    commands.notify(error instanceof Error ? error.message : 'The page action failed.');
  }
};

const SharedPageButton: React.FC<{
  page: ProjectPageDescriptor;
  index: number;
  active: boolean;
  onSelect: () => void;
  documentStyle?: boolean;
}> = ({ page, index, active, onSelect, documentStyle = false }) => (
  <button
    type="button"
    onClick={onSelect}
    aria-current={active ? 'page' : undefined}
    aria-label={documentStyle
      ? `Open ${pageName(page, index)}, folio ${pageNumber(page, index)}`
      : `Go to page ${index + 1} ${pageName(page, index)}`}
    data-testid={documentStyle
      ? `document-page-tab-${index}`
      : `product-page-nav-item-${index + 1}`}
    className={documentStyle
      ? `unified-document-page-tab${active ? ' is-selected' : ''}`
      : `unified-canvas-page-item${active ? ' is-selected' : ''}`}
    role={documentStyle ? 'tab' : undefined}
    aria-selected={documentStyle ? active : undefined}
  >
    {documentStyle ? (
      <>
        <span>{pageNumber(page, index)}</span>
        <small>{pageName(page, index)}</small>
      </>
    ) : (
      <>
        <span className="unified-canvas-page-number">{index + 1}</span>
        <span className="unified-canvas-page-copy">
          <span>{pageName(page, index)}</span>
          <small>{active ? 'Current page' : 'Open page'}</small>
        </span>
      </>
    )}
  </button>
);

const UnifiedCanvasPageNavigator: React.FC<UnifiedPageNavigationProps> = ({
  session,
  commands,
}) => (
  <aside className="unified-canvas-page-navigator" data-document-editor-ui="true">
    <div
      className="design-space-page-navigator flex h-full flex-col"
      data-testid="product-page-navigator"
    >
      <div className="design-space-page-navigator-header border-b border-[color:var(--border-subtle)] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">
            Product Pages
          </span>
          <span className="text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/70">
            {session.pages.length} total
          </span>
        </div>
      </div>
      <div className="design-space-page-list min-h-0 flex-1 overflow-y-auto p-2">
        <div className="space-y-1.5">
          {session.pages.map((page, index) => (
            <SharedPageButton
              key={page.id}
              page={page}
              index={index}
              active={session.activePageIndex === index}
              onSelect={() => void runPageMutation(commands, {
                kind: 'select-page',
                projectId: session.projectId,
                pageId: page.id,
              })}
            />
          ))}
        </div>
      </div>
      <div className="design-space-page-navigator-footer border-t border-[color:var(--border-subtle)] p-2">
        <button
          type="button"
          onClick={() => void runPageMutation(commands, {
            kind: 'add-page',
            projectId: session.projectId,
          })}
          disabled={!commands?.mutatePage}
          className="design-space-add-page flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[color:var(--ui-border)] px-3 py-2 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)] transition-all duration-200 hover:border-[color:var(--brand-primary)] hover:text-[color:var(--brand-primary)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Page
        </button>
        <p className="mt-2 text-center text-[8px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/60">
          Page actions are available in the strip below.
        </p>
      </div>
    </div>
  </aside>
);

export const UnifiedCanvasPageStrip: React.FC<UnifiedPageNavigationProps> = ({
  session,
  commands,
}) => {
  const [dragPageId, setDragPageId] = useState<string | null>(null);

  return (
    <div
      data-testid="page-strip"
      data-document-editor-ui="true"
      className="design-space-page-strip unified-canvas-page-strip flex h-[72px] shrink-0 items-center gap-2 overflow-x-auto border-t border-[color:var(--ui-border)] bg-[color:var(--ui-panel)]/80 px-3 py-1.5 backdrop-blur-[var(--ui-blur)]"
    >
      {session.pages.map((page, index) => (
        <div
          key={page.id}
          draggable={Boolean(commands?.mutatePage)}
          onDragStart={() => setDragPageId(page.id)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            if (
              dragPageId === null
              || dragPageId === page.id
              || !commands?.mutatePage
            ) return;
            void runPageMutation(commands, {
              kind: 'reorder-page',
              projectId: session.projectId,
              pageId: dragPageId,
              targetIndex: index,
            });
            setDragPageId(null);
          }}
          onDragEnd={() => setDragPageId(null)}
          className="group relative shrink-0"
        >
          <button
            type="button"
            onClick={() => void runPageMutation(commands, {
              kind: 'select-page',
              projectId: session.projectId,
              pageId: page.id,
            })}
            aria-current={session.activePageIndex === index ? 'page' : undefined}
            aria-label={`Open page ${index + 1}: ${pageName(page, index)}`}
            className={`design-space-page-strip-item h-[56px] w-20 rounded-xl border p-1 text-left transition-all duration-200 ${session.activePageIndex === index
              ? 'border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/14 shadow-[var(--ui-shadow-soft)]'
              : 'border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)]/60 hover:bg-[color:var(--ui-surface-strong)]'}`}
          >
            <div className="h-8 w-full overflow-hidden rounded-md border border-[color:var(--ui-border)] bg-[var(--warm-paper)]" />
            <div className={`mt-1 text-[9px] uppercase tracking-widest ${session.activePageIndex === index ? 'text-[color:var(--brand-primary)]' : 'text-[color:var(--ui-panel-text)]'}`}>
              Page {index + 1}
            </div>
          </button>
          {session.pages.length > 1 && (
            <button
              type="button"
              aria-label={`Delete page ${index + 1}: ${pageName(page, index)}`}
              disabled={!commands?.mutatePage}
              onClick={(event) => {
                event.stopPropagation();
                if (!commands?.mutatePage || !confirmRemovePage(page)) return;
                void runPageMutation(commands, {
                  kind: 'remove-page',
                  projectId: session.projectId,
                  pageId: page.id,
                });
              }}
              className="absolute right-1 top-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[rgba(74,56,45,0.7)] text-[#fbf7f2] opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 disabled:hidden"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => void runPageMutation(commands, {
          kind: 'add-page',
          projectId: session.projectId,
        })}
        disabled={!commands?.mutatePage}
        className="design-space-page-strip-add flex h-[56px] w-8 shrink-0 items-center justify-center rounded-xl border border-dashed border-[color:var(--ui-border)] text-[color:var(--ui-panel-text)] transition-all duration-200 hover:border-[color:var(--brand-primary)] hover:text-[color:var(--brand-primary)] disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Add page"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
};

const UnifiedDocumentPageNavigation: React.FC<UnifiedPageNavigationProps> = ({
  session,
  commands,
}) => {
  const activePage = session.pages[session.activePageIndex];

  return (
    <nav
      className="document-page-navigation unified-document-page-navigation"
      data-document-editor-ui="true"
      data-testid="document-page-navigation"
      aria-label="Document pages"
    >
      <div className="document-page-navigation__tabs" role="tablist">
        {session.pages.map((page, index) => (
          <SharedPageButton
            key={page.id}
            page={page}
            index={index}
            active={session.activePageIndex === index}
            onSelect={() => void runPageMutation(commands, {
              kind: 'select-page',
              projectId: session.projectId,
              pageId: page.id,
            })}
            documentStyle
          />
        ))}
      </div>
      <div className="document-page-navigation__actions">
        <button
          type="button"
          data-testid="document-move-page-left"
          aria-label="Move page left"
          disabled={session.activePageIndex <= 0 || !commands?.mutatePage || !activePage}
          onClick={() => {
            if (activePage && commands?.mutatePage) {
              void runPageMutation(commands, {
                kind: 'reorder-page',
                projectId: session.projectId,
                pageId: activePage.id,
                targetIndex: session.activePageIndex - 1,
              });
            }
          }}
        >
          <ChevronLeft size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="document-move-page-right"
          aria-label="Move page right"
          disabled={session.activePageIndex >= session.pages.length - 1 || !commands?.mutatePage || !activePage}
          onClick={() => {
            if (activePage && commands?.mutatePage) {
              void runPageMutation(commands, {
                kind: 'reorder-page',
                projectId: session.projectId,
                pageId: activePage.id,
                targetIndex: session.activePageIndex + 1,
              });
            }
          }}
        >
          <ChevronRight size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="document-duplicate-page"
          disabled={!commands?.mutatePage || !activePage}
          onClick={() => {
            if (!activePage) return;
            void runPageMutation(commands, {
              kind: 'duplicate-page',
              projectId: session.projectId,
              sourcePageId: activePage.id,
            });
          }}
        >
          <Copy size={14} aria-hidden="true" />
          Duplicate
        </button>
        <button
          type="button"
          data-testid="document-add-page"
          disabled={!commands?.mutatePage}
          onClick={() => void runPageMutation(commands, {
            kind: 'add-page',
            projectId: session.projectId,
          })}
        >
          <Plus size={14} aria-hidden="true" />
          Add page
        </button>
        <button
          type="button"
          data-testid="document-remove-page"
          aria-label="Remove current page"
          disabled={session.pages.length <= 1 || !commands?.mutatePage || !activePage}
          onClick={() => {
            if (activePage && commands?.mutatePage && confirmRemovePage(activePage)) {
              void runPageMutation(commands, {
                kind: 'remove-page',
                projectId: session.projectId,
                pageId: activePage.id,
              });
            }
          }}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
};

export const UnifiedPageNavigation: React.FC<UnifiedPageNavigationProps> = (props) =>
  props.session.rendererKind === 'document'
    ? <UnifiedDocumentPageNavigation {...props} />
    : <UnifiedCanvasPageNavigator {...props} />;

const SAVE_STATUS_LABELS: Record<ProjectSessionSnapshot['saveStatus'], string> = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Save failed',
};

const UnifiedSaveStatus: React.FC<{
  status: ProjectSessionSnapshot['saveStatus'];
  documentStyle: boolean;
}> = ({ status, documentStyle }) => (
  <span
    className={documentStyle ? 'document-save-status' : 'unified-save-status'}
    data-state={status}
    data-testid={documentStyle ? 'document-save-status' : 'unified-save-status'}
    role="status"
    aria-live="polite"
  >
    {SAVE_STATUS_LABELS[status]}
  </span>
);

export type UnifiedEditorLifecycleDiagnostics = Readonly<{
  authoredRevision: number;
  autosaveInvocationCount: number;
}>;

const UnifiedProjectHeader: React.FC<{
  session: ProjectSessionSnapshot | null;
  commands: ProjectSessionCommands | null;
  onBackToDashboard?: () => void;
  lifecycleDiagnostics?: UnifiedEditorLifecycleDiagnostics;
}> = ({ session, commands, onBackToDashboard, lifecycleDiagnostics }) => {
  const documentStyle = session?.rendererKind === 'document';
  const projectName = session?.projectName
    || (documentStyle ? 'Untitled Document' : 'Untitled Project');
  const [fileMenuOpen, setFileMenuOpen] = useState(false);

  const saveToLibrary = async () => {
    await commands?.save(projectName);
    setFileMenuOpen(false);
  };

  return (
    <header
      className="unified-project-header"
      data-testid="unified-project-header"
      data-document-editor-ui={documentStyle ? 'true' : undefined}
      data-authored-revision={lifecycleDiagnostics?.authoredRevision}
      data-autosave-invocations={lifecycleDiagnostics?.autosaveInvocationCount}
    >
      <div className="unified-project-header__identity">
        <div className="unified-project-header__brand">
          <strong>Design Space</strong>
          <span>One project workspace</span>
        </div>
        <span className="unified-project-header__divider" aria-hidden="true">/</span>
        {documentStyle ? (
          <input
            aria-label="Document project name"
            data-testid="document-project-name"
            value={projectName}
            onChange={(event) => void commands?.renameProject(event.target.value)}
            className="unified-project-header__document-name"
          />
        ) : (
          <ProjectNameEditor
            name={projectName}
            onRename={(name) => void commands?.renameProject(name)}
          />
        )}
        {session && <UnifiedSaveStatus status={session.saveStatus} documentStyle={documentStyle} />}
      </div>
      <div className="unified-project-header__actions">
        <button
          type="button"
          className="unified-project-header__button"
          onClick={onBackToDashboard}
          aria-label={documentStyle ? 'Back to projects' : undefined}
        >
          <Home size={16} aria-hidden="true" />
          Projects
        </button>
        <div className="unified-project-header__file-menu">
          <button
            type="button"
            className="unified-project-header__button"
            aria-expanded={fileMenuOpen}
            onClick={() => setFileMenuOpen((open) => !open)}
          >
            File
          </button>
          {fileMenuOpen && (
            <div className="unified-project-header__file-menu-panel">
              <button type="button" onClick={() => void saveToLibrary()} disabled={!commands}>
                Save to Library
              </button>
              <button
                type="button"
                onClick={() => {
                  void commands?.download();
                  setFileMenuOpen(false);
                }}
                disabled={!commands}
              >
                Download Project
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          className="unified-project-header__button"
          onClick={() => void commands?.download()}
          disabled={!commands}
        >
          <Download size={16} aria-hidden="true" />
          Download
        </button>
        <button
          type="button"
          className="unified-project-header__button unified-project-header__button--primary"
          onClick={() => void commands?.save(projectName)}
          disabled={!commands || !session?.canSave || session.saveStatus === 'saving'}
        >
          <Save size={16} aria-hidden="true" />
          Save
        </button>
      </div>
    </header>
  );
};

const UnifiedZoomControls: React.FC<{
  rendererKind: LegacyRendererKind;
  zoom: number;
  commands: ProjectSessionCommands | null;
}> = ({ rendererKind, zoom, commands }) => {
  const documentStyle = rendererKind === 'document';
  const setZoom = (nextZoom: number) => {
    commands?.setViewportZoom(Math.max(0.25, Math.min(2, nextZoom)));
  };

  return (
    <div
      className={documentStyle ? 'document-zoom-controls' : 'unified-zoom-controls'}
      data-document-export-exclude="true"
      data-document-editor-ui="true"
      data-testid={documentStyle ? 'document-zoom-controls' : 'unified-zoom-controls'}
    >
      <button type="button" onClick={() => setZoom(zoom - 0.1)} aria-label="Zoom out">
        <Minus size={16} aria-hidden="true" />
      </button>
      <span data-testid={documentStyle ? 'document-zoom-indicator' : 'unified-zoom-indicator'}>
        {Math.round(zoom * 100)}%
      </span>
      <button type="button" onClick={() => setZoom(zoom + 0.1)} aria-label="Zoom in">
        <Plus size={16} aria-hidden="true" />
      </button>
      <span className="document-zoom-controls__divider" aria-hidden="true" />
      <button
        type="button"
        aria-label="Fit page"
        onClick={() => commands?.fitPage?.()}
        disabled={!commands?.fitPage}
      >
        {documentStyle ? <Maximize2 size={15} aria-hidden="true" /> : <Expand size={15} aria-hidden="true" />}
        Fit page
      </button>
    </div>
  );
};

export type UnifiedEditorShellProps = {
  session: ProjectSessionSnapshot | null;
  commands: ProjectSessionCommands | null;
  zoom: number;
  onBackToDashboard?: () => void;
  lifecycleDiagnostics?: UnifiedEditorLifecycleDiagnostics;
  children: React.ReactNode | ((slots: UnifiedEditorShellContentSlots) => React.ReactNode);
};

export type UnifiedEditorShellContentSlots = Readonly<{
  /** Shared Canvas page chrome can be mounted inside the legacy content region. */
  canvasPageStrip: React.ReactNode;
}>;

export const UnifiedEditorShell: React.FC<UnifiedEditorShellProps> = ({
  session,
  commands,
  zoom,
  onBackToDashboard,
  lifecycleDiagnostics,
  children,
}) => {
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showLeaveEditorModal, setShowLeaveEditorModal] = useState(false);
  const isProgrammaticCloseRef = useRef(false);
  const leaveEditorCancelRef = useRef<HTMLButtonElement>(null);
  const clearSession = useProjectSessionStore((state) => state.clearSession);
  const rendererKind = session?.rendererKind || 'canvas';
  const isDirty = session?.isDirty ?? false;
  const projectName = session?.projectName
    || (rendererKind === 'document' ? 'Untitled Document' : 'Untitled Project');
  const usesContentSlot = typeof children === 'function';
  const canvasPageStrip = session && rendererKind === 'canvas'
    ? <UnifiedCanvasPageStrip session={session} commands={commands} />
    : null;
  const renderedChildren = usesContentSlot
    ? children({ canvasPageStrip })
    : children;

  const returnToDashboard = useCallback(() => {
    setShowLeaveEditorModal(false);
    if (commands?.close) {
      void commands.close();
      return;
    }
    clearSession();
    onBackToDashboard?.();
  }, [clearSession, commands, onBackToDashboard]);

  const showActiveError = useCallback((message: string) => {
    commands?.notify(message);
  }, [commands]);

  const readDirty = useCallback(
    () => commands?.isDirty() ?? isDirty,
    [commands, isDirty]
  );

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!readDirty() || isProgrammaticCloseRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [readDirty]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const init = async () => {
      const isTauri = typeof window !== 'undefined' && !!(window as unknown as { __TAURI__?: unknown }).__TAURI__;
      if (!isTauri) return;
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
          if (isProgrammaticCloseRef.current || !readDirty()) return;
          event.preventDefault();
          setShowCloseModal(true);
        });
      } catch {
        // Native close protection is best effort when the browser bridge is unavailable.
      }
    };
    void init();
    return () => unlisten?.();
  }, [readDirty]);

  useEffect(() => {
    if (!showLeaveEditorModal) return;
    leaveEditorCancelRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setShowLeaveEditorModal(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [showLeaveEditorModal]);

  const closeTauriWindow = async () => {
    isProgrammaticCloseRef.current = true;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } finally {
      window.setTimeout(() => {
        isProgrammaticCloseRef.current = false;
      }, 250);
    }
  };

  const handleSaveAndClose = async () => {
    const delivery = await commands?.download();
    if (!delivery || delivery.status === 'cancelled') return;
    if (readDirty()) {
      showActiveError('Project could not be downloaded. The window will stay open.');
      return;
    }
    setShowCloseModal(false);
    await closeTauriWindow();
  };

  const handleDontSaveAndClose = async () => {
    setShowCloseModal(false);
    await closeTauriWindow();
  };

  const handleBackToDashboard = () => {
    if (readDirty() && session?.canClose !== false) {
      setShowLeaveEditorModal(true);
      return;
    }
    returnToDashboard();
  };

  const handleSaveToLibraryAndReturn = async () => {
    await commands?.save(projectName);
    if (!readDirty()) returnToDashboard();
  };

  const handleDownloadAndReturn = async () => {
    const delivery = await commands?.download();
    if (!delivery || delivery.status === 'cancelled') return;
    if (!readDirty()) returnToDashboard();
  };

  return (
    <div
      className="unified-editor-shell"
      data-testid="unified-editor-shell"
      data-renderer-kind={rendererKind}
    >
      <UnifiedProjectHeader
        session={session}
        commands={commands}
        onBackToDashboard={onBackToDashboard ? handleBackToDashboard : undefined}
        lifecycleDiagnostics={lifecycleDiagnostics}
      />
      <div
        className="unified-narrow-recovery"
        data-testid="narrow-editor-notice"
        data-document-editor-ui="true"
        data-document-export-exclude="true"
      >
        <div>
          <strong>Editing works best on a larger screen.</strong>
          <span>The editor remains available here, with project recovery and navigation kept within reach.</span>
        </div>
        <button
          type="button"
          onClick={() => void commands?.download()}
          disabled={!commands}
          className="unified-project-header__button"
        >
          <Download size={16} aria-hidden="true" />
          Download Project
        </button>
      </div>
      {session && rendererKind === 'canvas' ? (
        <div className="unified-canvas-editor-layout">
          <UnifiedCanvasPageNavigator session={session} commands={commands} />
          <div className="unified-editor-renderer">{renderedChildren}</div>
        </div>
      ) : (
        <>
          {session && <UnifiedPageNavigation session={session} commands={commands} />}
          <div className="unified-editor-renderer">{renderedChildren}</div>
        </>
      )}
      {session && rendererKind === 'canvas' && !usesContentSlot && canvasPageStrip}
      <UnifiedZoomControls
        rendererKind={rendererKind}
        zoom={zoom}
        commands={commands}
      />

      {showCloseModal && (
        <div className="design-space-app-dialog-backdrop fixed inset-0 z-[120] flex items-center justify-center bg-[rgba(58,40,32,0.52)] p-4 backdrop-blur-sm">
          <div
            className="design-space-app-dialog-panel w-full max-w-md rounded-2xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] p-6 text-[color:var(--ui-text)] shadow-[0_28px_70px_rgba(74,56,45,0.26)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-project-dialog-title"
          >
            <h2 id="close-project-dialog-title" className="mb-2 text-lg font-semibold">Save project before closing?</h2>
            <p className="mb-6 text-sm text-[color:var(--ui-panel-text)]/70">
              You have unsaved changes. Choose what to do before Design Space closes.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setShowCloseModal(false)} className="ui-button-soft rounded-lg px-4 py-2 text-xs uppercase tracking-widest">Cancel</button>
              <button type="button" onClick={() => void handleDontSaveAndClose()} className="ui-button-soft rounded-lg border-rose-300/45 bg-rose-200/42 px-4 py-2 text-xs uppercase tracking-widest text-rose-900 hover:bg-rose-200/55">Don&apos;t Save</button>
              <button type="button" onClick={() => void handleSaveAndClose()} className="ui-button-soft rounded-lg border-[color:var(--brand-primary)]/40 bg-[color:var(--brand-primary)]/16 px-4 py-2 text-xs uppercase tracking-widest hover:bg-[color:var(--brand-primary)]/24">Save</button>
            </div>
          </div>
        </div>
      )}

      {showLeaveEditorModal && (
        <div
          className="design-space-app-dialog-backdrop fixed inset-0 z-[125] flex items-center justify-center bg-[rgba(58,40,32,0.52)] p-4 backdrop-blur-sm"
          data-testid="unsaved-navigation-dialog"
        >
          <div
            className="design-space-app-dialog-panel w-full max-w-lg rounded-2xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] p-6 text-[color:var(--ui-text)] shadow-[0_28px_70px_rgba(74,56,45,0.26)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-editor-dialog-title"
            aria-describedby="leave-editor-dialog-description"
          >
            <h2 id="leave-editor-dialog-title" className="mb-2 text-lg font-semibold">Save before returning to Projects?</h2>
            <p id="leave-editor-dialog-description" className="mb-6 text-sm text-[color:var(--ui-panel-text)]/75">
              This project has unsaved changes. Save a browser-library copy, download a portable project file, or explicitly discard the changes before leaving the editor.
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button ref={leaveEditorCancelRef} type="button" onClick={() => setShowLeaveEditorModal(false)} className="ui-button-soft rounded-lg px-4 py-2 text-xs uppercase tracking-widest">Cancel</button>
              <button type="button" onClick={returnToDashboard} className="ui-button-soft rounded-lg border-rose-300/45 bg-rose-200/42 px-4 py-2 text-xs uppercase tracking-widest text-rose-900 hover:bg-rose-200/55">Discard Changes</button>
              <button type="button" onClick={() => void handleDownloadAndReturn()} className="ui-button-soft rounded-lg px-4 py-2 text-xs uppercase tracking-widest">Download Project File</button>
              <button type="button" onClick={() => void handleSaveToLibraryAndReturn()} className="ui-button-soft rounded-lg border-[color:var(--brand-primary)]/40 bg-[color:var(--brand-primary)]/16 px-4 py-2 text-xs uppercase tracking-widest hover:bg-[color:var(--brand-primary)]/24">Save to Library</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
