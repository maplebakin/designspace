import { useState, useEffect, useRef, useMemo } from 'react';
import { EditorShell } from './editor/components/EditorShell';
import { UIThemeProvider } from './editor/components/UIThemeProvider';
import { ProjectDashboard } from './editor/components/ProjectDashboard';
import { useEditorStore } from './editor/state/editorStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NetworkStatusIndicator } from './components/NetworkStatusIndicator';
import { NotificationProvider } from './components/NotificationProvider';
import { injectAccessibilityStyles } from './utils/accessibility';
import { useThemeStore } from './editor/state/useThemeStore';
import { pluginManager, PluginManagerContext } from './editor/utils/pluginArchitecture';
import { pwaOfflineManager } from './editor/offline/pwaOfflineManager';
import { getValidationWarnings } from './utils/validateFunctionalityWarnings';
import { DocumentEditorShell } from './document/components/DocumentEditorShell';
import { useDocumentStore } from './document/state/documentStore';
import { useProjectSessionStore } from './editor/state/projectSessionStore';
import type { EditorMode } from './editor/project/projectSchema';

function App() {
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showLeaveEditorModal, setShowLeaveEditorModal] = useState(false);
  const isProgrammaticCloseRef = useRef(false);
  const leaveEditorCancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    injectAccessibilityStyles();
  }, []);

  const canvasProjectName = useEditorStore((state) => state.projectName);
  const canvasIsDirty = useEditorStore((state) => state.isDirty);
  const downloadCanvasProjectFile = useEditorStore((state) => state.downloadProjectFile);
  const saveCanvasProject = useEditorStore((state) => state.saveProject);
  const canvasObjects = useEditorStore((state) => state.canvasObjects);
  const setToast = useEditorStore((state) => state.setToast);
  const editorMode = useProjectSessionStore((state) => state.editorMode);
  const setEditorMode = useProjectSessionStore((state) => state.setEditorMode);
  const documentProjectName = useDocumentStore((state) => state.project?.projectName);
  const documentIsDirty = useDocumentStore((state) => state.isDirty);
  const downloadDocumentProjectFile = useDocumentStore((state) => state.downloadProjectFile);
  const saveDocumentProject = useDocumentStore((state) => state.saveProject);
  const setDocumentToastMessage = useDocumentStore((state) => state.setToastMessage);
  const projectName = editorMode === 'document' ? documentProjectName : canvasProjectName;
  const isDirty = editorMode === 'document' ? documentIsDirty : canvasIsDirty;
  const themeData = useThemeStore((state) => state.themeData);
  const manager = useMemo(() => pluginManager, []);
  const previousObjectIdsRef = useRef<string[]>([]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty || isProgrammaticCloseRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const init = async () => {
      const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI__;
      if (!isTauri) return;
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
          if (isProgrammaticCloseRef.current) {
            return;
          }

          if (!isDirty) {
            return;
          }

          event.preventDefault();
          setShowCloseModal(true);
        });
      } catch {
        // ignore
      }
    };
    void init();
    return () => {
      if (unlisten) unlisten();
    };
  }, [isDirty]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      void pwaOfflineManager.registerServiceWorker();
    }
  }, []);

  useEffect(() => {
    if (editorMode !== 'canvas') return;
    const previousIds = previousObjectIdsRef.current;
    const nextIds = canvasObjects.map((object) => object.id).filter((id): id is string => typeof id === 'string');
    const addedIds = nextIds.filter((id) => !previousIds.includes(id));
    addedIds.forEach((id) => {
      const object = canvasObjects.find((entry) => entry.id === id);
      if (object) {
        void manager.emitHook('onObjectAdded', object);
      }
    });
    previousObjectIdsRef.current = nextIds;
  }, [canvasObjects, editorMode, manager]);

  useEffect(() => {
    if (themeData) {
      void manager.emitHook('onThemeChange', themeData);
    }
  }, [manager, themeData]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const warnings = getValidationWarnings();
    if (warnings.length > 0) {
      setToast({
        message: warnings[0],
        details: warnings.slice(1).join(' | '),
        variant: 'warning',
        durationMs: 6000,
      });
    }
  }, [setToast]);

  const closeTauriWindow = async () => {
    isProgrammaticCloseRef.current = true;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } finally {
      setTimeout(() => {
        isProgrammaticCloseRef.current = false;
      }, 250);
    }
  };

  const showActiveError = (message: string) => {
    if (editorMode === 'document') {
      setDocumentToastMessage(message);
    } else {
      setToast({
        message,
        variant: 'error',
      });
    }
  };

  const downloadActiveProjectFile = async () => {
    if (editorMode === 'document') {
      await downloadDocumentProjectFile();
    } else {
      await downloadCanvasProjectFile();
    }
  };

  const saveActiveProject = async () => {
    const safeName = projectName?.trim()
      || (editorMode === 'document' ? 'Untitled Document' : 'Untitled Project');
    if (editorMode === 'document') {
      await saveDocumentProject(safeName);
    } else {
      await saveCanvasProject(safeName);
    }
  };

  const activeProjectIsDirty = () =>
    editorMode === 'document'
      ? useDocumentStore.getState().isDirty
      : useEditorStore.getState().isDirty;

  const handleSaveAndClose = async () => {
    await downloadActiveProjectFile();
    if (activeProjectIsDirty()) {
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

  const handleCancelClose = () => {
    setShowCloseModal(false);
  };

  const handleBackToDashboard = () => {
    if (isDirty) {
      setShowLeaveEditorModal(true);
      return;
    }
    setHasActiveSession(false);
  };

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

  const returnToDashboardAfterSave = () => {
    setShowLeaveEditorModal(false);
    setHasActiveSession(false);
  };

  const handleSaveToLibraryAndReturn = async () => {
    await saveActiveProject();
    if (!activeProjectIsDirty()) {
      returnToDashboardAfterSave();
    }
  };

  const handleDownloadAndReturn = async () => {
    await downloadActiveProjectFile();
    if (!activeProjectIsDirty()) {
      returnToDashboardAfterSave();
    }
  };

  const handleDiscardAndReturn = () => {
    returnToDashboardAfterSave();
  };

  const handleProjectOpen = (mode: EditorMode = 'canvas') => {
    setEditorMode(mode);
    setHasActiveSession(true);
  };

  return (
    <ErrorBoundary>
      <NotificationProvider>
        <PluginManagerContext.Provider value={manager}>
          <UIThemeProvider>
            <NetworkStatusIndicator />
            {!hasActiveSession ? (
              <ProjectDashboard onProjectOpen={handleProjectOpen} />
            ) : (
              editorMode === 'document' ? (
                <DocumentEditorShell onBackToDashboard={handleBackToDashboard} />
              ) : (
                <EditorShell onBackToDashboard={handleBackToDashboard} />
              )
            )}

            {showCloseModal && (
              <div className="design-space-app-dialog-backdrop fixed inset-0 z-[120] bg-[rgba(58,40,32,0.52)] backdrop-blur-sm flex items-center justify-center p-4">
                <div
                  className="design-space-app-dialog-panel w-full max-w-md rounded-2xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] text-[color:var(--ui-text)] shadow-[0_28px_70px_rgba(74,56,45,0.26)] p-6"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="close-project-dialog-title"
                >
                  <h2 id="close-project-dialog-title" className="text-lg font-semibold mb-2">Save project before closing?</h2>
                  <p className="text-sm text-[color:var(--ui-panel-text)]/70 mb-6">
                    You have unsaved changes. Choose what to do before Design Space closes.
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={handleCancelClose}
                      className="ui-button-soft px-4 py-2 rounded-lg text-xs uppercase tracking-widest"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void handleDontSaveAndClose()}
                      className="ui-button-soft px-4 py-2 rounded-lg text-rose-900 text-xs uppercase tracking-widest border-rose-300/45 bg-rose-200/42 hover:bg-rose-200/55"
                    >
                      Don&apos;t Save
                    </button>
                    <button
                      onClick={() => void handleSaveAndClose()}
                      className="ui-button-soft px-4 py-2 rounded-lg text-xs uppercase tracking-widest border-[color:var(--brand-primary)]/40 bg-[color:var(--brand-primary)]/16 hover:bg-[color:var(--brand-primary)]/24"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showLeaveEditorModal && (
              <div
                className="design-space-app-dialog-backdrop fixed inset-0 z-[125] bg-[rgba(58,40,32,0.52)] backdrop-blur-sm flex items-center justify-center p-4"
                data-testid="unsaved-navigation-dialog"
              >
                <div
                  className="design-space-app-dialog-panel w-full max-w-lg rounded-2xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] text-[color:var(--ui-text)] shadow-[0_28px_70px_rgba(74,56,45,0.26)] p-6"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="leave-editor-dialog-title"
                  aria-describedby="leave-editor-dialog-description"
                >
                  <h2 id="leave-editor-dialog-title" className="text-lg font-semibold mb-2">Save before returning to Projects?</h2>
                  <p id="leave-editor-dialog-description" className="text-sm text-[color:var(--ui-panel-text)]/75 mb-6">
                    This project has unsaved changes. Save a browser-library copy, download a portable project file, or explicitly discard the changes before leaving the editor.
                  </p>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      ref={leaveEditorCancelRef}
                      type="button"
                      onClick={() => setShowLeaveEditorModal(false)}
                      className="ui-button-soft px-4 py-2 rounded-lg text-xs uppercase tracking-widest"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDiscardAndReturn}
                      className="ui-button-soft px-4 py-2 rounded-lg text-xs uppercase tracking-widest text-rose-900 border-rose-300/45 bg-rose-200/42 hover:bg-rose-200/55"
                    >
                      Discard Changes
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDownloadAndReturn()}
                      className="ui-button-soft px-4 py-2 rounded-lg text-xs uppercase tracking-widest"
                    >
                      Download Project File
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveToLibraryAndReturn()}
                      className="ui-button-soft px-4 py-2 rounded-lg text-xs uppercase tracking-widest border-[color:var(--brand-primary)]/40 bg-[color:var(--brand-primary)]/16 hover:bg-[color:var(--brand-primary)]/24"
                    >
                      Save to Library
                    </button>
                  </div>
                </div>
              </div>
            )}
          </UIThemeProvider>
        </PluginManagerContext.Provider>
      </NotificationProvider>
    </ErrorBoundary>
  );
}

export default App;
