import { useState, useEffect, useRef, useMemo } from 'react';
import { EditorShell } from './editor/components/EditorShell';
import { UIThemeProvider } from './editor/components/UIThemeProvider';
import { ProjectDashboard } from './editor/components/ProjectDashboard';
import { useEditorStore } from './editor/state/editorStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NetworkStatusIndicator } from './components/NetworkStatusIndicator';
import { NotificationProvider } from './components/NotificationProvider';
import { injectAccessibilityStyles } from './utils/accessibility';
import { migrateFromLocalStorage } from './editor/services/templateService';
import { useThemeStore } from './editor/state/useThemeStore';
import { pluginManager, PluginManagerContext } from './editor/utils/pluginArchitecture';
import { pwaOfflineManager } from './editor/offline/pwaOfflineManager';
import { getValidationWarnings } from './utils/validateFunctionalityWarnings';

const TEMPLATE_MIGRATION_FLAG_KEY = 'designspace-template-migration-v1';
let templateMigrationStarted = false;

function App() {
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const isProgrammaticCloseRef = useRef(false);

  useEffect(() => {
    injectAccessibilityStyles();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (window.localStorage.getItem(TEMPLATE_MIGRATION_FLAG_KEY) === 'done') return;
    if (templateMigrationStarted) return;
    templateMigrationStarted = true;

    let cancelled = false;
    const runMigration = async () => {
      try {
        await migrateFromLocalStorage();
      } finally {
        if (!cancelled) {
          window.localStorage.setItem(TEMPLATE_MIGRATION_FLAG_KEY, 'done');
        }
      }
    };

    void runMigration();
    return () => {
      cancelled = true;
    };
  }, []);

  const projectName = useEditorStore((state) => state.projectName);
  const isDirty = useEditorStore((state) => state.isDirty);
  const downloadProjectFile = useEditorStore((state) => state.downloadProjectFile);
  const canvasObjects = useEditorStore((state) => state.canvasObjects);
  const setToast = useEditorStore((state) => state.setToast);
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

  useEffect(() => {
    if (!import.meta.env.DEV) {
      void pwaOfflineManager.registerServiceWorker();
    }
  }, []);

  useEffect(() => {
    if (!projectName) return;
    void pwaOfflineManager.saveOfflineState({
      projectName,
      canvasObjects,
      savedAt: new Date().toISOString(),
    });
  }, [canvasObjects, projectName]);

  useEffect(() => {
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
  }, [canvasObjects, manager]);

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
    setHasActiveSession(false);
  };

  const handleProjectOpen = () => {
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
              <EditorShell onBackToDashboard={handleBackToDashboard} />
            )}

            {showCloseModal && (
              <div className="fixed inset-0 z-[120] bg-[rgba(58,40,32,0.52)] backdrop-blur-sm flex items-center justify-center p-4">
                <div className="w-full max-w-md rounded-2xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] text-[color:var(--ui-text)] shadow-[0_28px_70px_rgba(74,56,45,0.26)] p-6">
                  <h2 className="text-lg font-semibold mb-2">Save project before closing?</h2>
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
          </UIThemeProvider>
        </PluginManagerContext.Provider>
      </NotificationProvider>
    </ErrorBoundary>
  );
}

export default App;
