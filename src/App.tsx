import { useState, useEffect, useRef } from 'react';
import { EditorShell } from './editor/components/EditorShell';
import { UIThemeProvider } from './editor/components/UIThemeProvider';
import { ProjectDashboard } from './editor/components/ProjectDashboard';
import { useEditorStore } from './editor/state/editorStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NetworkStatusIndicator } from './components/NetworkStatusIndicator';
import { injectAccessibilityStyles } from './utils/accessibility';

type AppView = 'dashboard' | 'editor';

function App() {
  const [currentView, setCurrentView] = useState<AppView>('dashboard');
  const [showCloseModal, setShowCloseModal] = useState(false);
  const isProgrammaticCloseRef = useRef(false);

  useEffect(() => {
    injectAccessibilityStyles();
  }, []);

  const projectName = useEditorStore((state) => state.projectName);
  const layersById = useEditorStore((state) => state.layersById);
  const isDirty = useEditorStore((state) => state.isDirty);
  const downloadProjectFile = useEditorStore((state) => state.downloadProjectFile);

  useEffect(() => {
    if (projectName || Object.keys(layersById).length > 0) {
      setCurrentView('editor');
    }
  }, [projectName, layersById]);

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
        const eventApi = await import('@tauri-apps/api/event');
        unlisten = await eventApi.listen('tauri://close-requested', async (event: any) => {
          if (isProgrammaticCloseRef.current) {
            return;
          }

          if (!isDirty) {
            return;
          }

          event.payload?.preventDefault?.();
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

  const handleSaveAndClose = async () => {
    await downloadProjectFile();
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
    setCurrentView('dashboard');
  };

  return (
    <ErrorBoundary>
      <UIThemeProvider>
        <NetworkStatusIndicator />
        {currentView === 'dashboard' ? (
          <ProjectDashboard onProjectOpen={() => setCurrentView('editor')} />
        ) : (
          <EditorShell onBackToDashboard={handleBackToDashboard} />
        )}

        {showCloseModal && (
          <div className="fixed inset-0 z-[120] bg-[rgba(58,40,32,0.52)] backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] text-[color:var(--ui-text)] shadow-[0_28px_70px_rgba(74,56,45,0.26)] p-6">
              <h2 className="text-lg font-semibold mb-2">Save project before closing?</h2>
              <p className="text-sm text-slate-400 mb-6">
                You have unsaved changes. Choose what to do before Design Space closes.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={handleCancelClose}
                  className="px-4 py-2 rounded-lg border border-[color:var(--ui-border)] bg-white/50 hover:bg-white/70 text-xs uppercase tracking-widest"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleDontSaveAndClose()}
                  className="px-4 py-2 rounded-lg border border-rose-300/40 bg-rose-200/40 hover:bg-rose-200/55 text-rose-900 text-xs uppercase tracking-widest"
                >
                  Don&apos;t Save
                </button>
                <button
                  onClick={() => void handleSaveAndClose()}
                  className="px-4 py-2 rounded-lg border border-[color:var(--brand-primary)]/45 bg-[color:var(--brand-primary)]/30 hover:bg-[color:var(--brand-primary)]/40 text-xs uppercase tracking-widest"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </UIThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
