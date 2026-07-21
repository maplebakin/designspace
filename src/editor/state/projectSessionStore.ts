import { create } from 'zustand';
import type { EditorMode } from '../project/projectSchema';

type ProjectSessionState = {
  editorMode: EditorMode;
  setEditorMode: (mode: EditorMode) => void;
};

export const useProjectSessionStore = create<ProjectSessionState>((set) => ({
  editorMode: 'canvas',
  setEditorMode: (editorMode) => set({ editorMode }),
}));
