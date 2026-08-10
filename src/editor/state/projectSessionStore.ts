import { create } from 'zustand';
import type { EditorMode } from '../project/projectSchema';
import {
  createEmptySelectionEvent,
  type PageViewport,
  type ProjectSessionCommands,
  type ProjectSessionDescriptor,
  type ProjectSessionSnapshot,
  type SelectionEvent,
} from '../session/projectSession';

type ProjectSessionState = {
  editorMode: EditorMode;
  session: ProjectSessionSnapshot | null;
  viewport: PageViewport | null;
  selection: SelectionEvent;
  commands: ProjectSessionCommands | null;
  setEditorMode: (mode: EditorMode) => void;
  setSessionDescriptor: (descriptor: ProjectSessionDescriptor) => void;
  setSessionSnapshot: (
    snapshot: ProjectSessionSnapshot,
    commands: ProjectSessionCommands
  ) => void;
  setViewport: (viewport: PageViewport) => void;
  reportSelection: (event: SelectionEvent) => void;
  clearSession: () => void;
};

const emptyState = {
  editorMode: 'canvas',
  session: null,
  viewport: null,
  selection: createEmptySelectionEvent(),
  commands: null,
} satisfies Pick<
  ProjectSessionState,
  'editorMode' | 'session' | 'viewport' | 'selection' | 'commands'
>;

export const useProjectSessionStore = create<ProjectSessionState>((set) => ({
  ...emptyState,
  setEditorMode: (editorMode) => set({
    editorMode,
    session: null,
    viewport: null,
    selection: createEmptySelectionEvent(),
    commands: null,
  }),
  setSessionDescriptor: (descriptor) => set({
    editorMode: descriptor.compatibilityMode,
    session: {
      ...descriptor,
      isDirty: false,
      saveStatus: 'saved',
      canSave: true,
      canClose: true,
    },
    viewport: null,
    selection: createEmptySelectionEvent(),
    commands: null,
  }),
  setSessionSnapshot: (session, commands) => set({
    editorMode: session.compatibilityMode,
    session,
    commands,
  }),
  setViewport: (viewport) => set({ viewport }),
  reportSelection: (selection) => set({ selection }),
  clearSession: () => set({
    ...emptyState,
    selection: createEmptySelectionEvent(),
  }),
}));
