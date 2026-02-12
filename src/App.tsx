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

  // Initialize accessibility features
  useEffect(() => {
    injectAccessibilityStyles();
  }, []);

  // Subscribe to project changes to know when to switch to editor
  const projectName = useEditorStore((state) => state.projectName);
  const layersById = useEditorStore((state) => state.layersById);

  // Switch to editor when a project is loaded or created
  useEffect(() => {
    // If there's a project name or objects on canvas, show editor
    if (projectName || Object.keys(layersById).length > 0) {
      setCurrentView('editor');
    }
  }, [projectName, layersById]);

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
