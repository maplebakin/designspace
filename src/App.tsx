import { useState, useEffect, useRef, useMemo } from 'react';
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
import { useProjectSessionStore } from './editor/state/projectSessionStore';
import type { EditorMode } from './editor/project/projectSchema';
import type { ProjectSessionDescriptor } from './editor/session/projectSession';
import { UnifiedEditorSession } from './editor/session/UnifiedEditorSession';

function App() {
  const [hasActiveSession, setHasActiveSession] = useState(false);

  useEffect(() => {
    injectAccessibilityStyles();
  }, []);

  const canvasObjects = useEditorStore((state) => state.canvasObjects);
  const setToast = useEditorStore((state) => state.setToast);
  const editorMode = useProjectSessionStore((state) => state.editorMode);
  const setEditorMode = useProjectSessionStore((state) => state.setEditorMode);
  const themeData = useThemeStore((state) => state.themeData);
  const manager = useMemo(() => pluginManager, []);
  const previousObjectIdsRef = useRef<string[]>([]);

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

  const handleBackToDashboard = () => setHasActiveSession(false);

  const handleProjectOpen = (
    mode: EditorMode = 'canvas',
    descriptor?: ProjectSessionDescriptor
  ) => {
    setEditorMode(mode);
    if (descriptor) {
      useProjectSessionStore.getState().setSessionDescriptor(descriptor);
    }
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
              <UnifiedEditorSession onBackToDashboard={handleBackToDashboard} />
            )}
          </UIThemeProvider>
        </PluginManagerContext.Provider>
      </NotificationProvider>
    </ErrorBoundary>
  );
}

export default App;
