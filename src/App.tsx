
import { EditorShell } from './editor/components/EditorShell';
import { UIThemeProvider } from './editor/components/UIThemeProvider';

function App() {
  return (
    <UIThemeProvider>
      <EditorShell />
    </UIThemeProvider>
  );
}

export default App;
