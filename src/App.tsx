import { useState, useEffect } from 'react';
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
      if (!isDirty) return;
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
          if (!isDirty) return;
          const answer = window.prompt('Save project before closing? Type: save / dont / cancel', 'save');
          const normalized = (answer || 'cancel').trim().toLowerCase();
          if (normalized === 'save') {
            await downloadProjectFile();
            const appWindow = await import('@tauri-apps/api/window');
            appWindow.getCurrentWindow().close();
            return;
          }
          if (normalized === 'dont') {
            const appWindow = await import('@tauri-apps/api/window');
            appWindow.getCurrentWindow().close();
            return;
          }
          event.payload?.preventDefault?.();
        });
      } catch {
        // ignore
      }
    };
    void init();
    return () => {
      if (unlisten) unlisten();
    };
  }, [isDirty, downloadProjectFile]);

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
      </UIThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
