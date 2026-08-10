import React, { useEffect, useMemo } from 'react';
import { shallow } from 'zustand/shallow';
import { DocumentEditorShell } from '../../document/components/DocumentEditorShell';
import { useDocumentStore } from '../../document/state/documentStore';
import { EditorShell } from '../components/EditorShell';
import { zoomToCenter } from '../fabric/canvasUtils';
import {
  createProjectSessionDescriptor,
  createSessionSnapshot,
  type LegacyRendererKind,
  type ProjectSessionCommands,
  type ProjectSessionDescriptor,
  type ProjectSessionSource,
  type SelectionEvent,
  type SessionPayloadLike,
} from './projectSession';
import { useEditorStore } from '../state/editorStore';
import { useProjectSessionStore } from '../state/projectSessionStore';

export type LegacyRendererAdapterProps = {
  onBackToDashboard?: () => void;
  onSelectionEvent: (event: SelectionEvent) => void;
};

export type LegacyRendererAdapter = Readonly<{
  kind: LegacyRendererKind;
  render: React.ComponentType<LegacyRendererAdapterProps>;
}>;

type CanvasSessionState = {
  projectName: string;
  productProjectFields: ReturnType<typeof useEditorStore.getState>['productProjectFields'];
  currentLibraryProjectId: string | null;
  pages: ReturnType<typeof useEditorStore.getState>['pages'];
  activePageIndex: number;
  isDirty: boolean;
  saveStatus: ReturnType<typeof useEditorStore.getState>['saveStatus'];
  zoom: number;
  unitMode: ReturnType<typeof useEditorStore.getState>['unitMode'];
};

type DocumentSessionState = {
  project: ReturnType<typeof useDocumentStore.getState>['project'];
  currentLibraryProjectId: string | null;
  isDirty: boolean;
  saveStatus: ReturnType<typeof useDocumentStore.getState>['saveStatus'];
  zoom: number;
};

const getSessionSource = (
  current: ProjectSessionSource | undefined,
  hasLibraryProject: boolean
): ProjectSessionSource => current
  || (hasLibraryProject ? 'library' : 'new');

const createCanvasSessionDescriptor = (
  state: CanvasSessionState,
  source: ProjectSessionSource
): ProjectSessionDescriptor => {
  const productPageSize = state.productProjectFields?.document.pageSize;
  const activePage = state.pages[state.activePageIndex];
  const payload: SessionPayloadLike = {
    editorMode: 'canvas',
    projectId: state.productProjectFields?.projectId
      || state.currentLibraryProjectId
      || 'canvas-session',
    projectName: state.projectName || 'Untitled Project',
    pages: state.pages.map((page) => ({
      id: page.id,
      name: page.name,
      kind: 'canvas' as const,
      canvasSize: page.canvasSize,
    })),
    activePageIndex: state.activePageIndex,
    document: {
      pageSize: {
        width: productPageSize?.width || activePage?.canvasSize.width,
        height: productPageSize?.height || activePage?.canvasSize.height,
        dpi: productPageSize?.dpi || (state.unitMode === 'px' ? 96 : 300),
      },
    },
  };
  return createProjectSessionDescriptor(payload, { source });
};

const createDocumentSessionDescriptor = (
  state: DocumentSessionState,
  source: ProjectSessionSource
): ProjectSessionDescriptor | null => {
  if (!state.project) return null;
  return createProjectSessionDescriptor(state.project, { source });
};

const createCanvasCommands = (): ProjectSessionCommands => ({
  save: async (name) => {
    const state = useEditorStore.getState();
    await state.saveProject(name?.trim() || state.projectName || 'Untitled Project');
  },
  download: () => useEditorStore.getState().downloadProjectFile(),
  notify: (message) => {
    useEditorStore.getState().setToast({
      message,
      variant: 'error',
    });
  },
  isDirty: () => useEditorStore.getState().isDirty,
  selectPage: (index) => useEditorStore.getState().switchToPage(index),
  setViewportZoom: (zoom) => zoomToCenter(zoom),
});

const createDocumentCommands = (): ProjectSessionCommands => ({
  save: (name) => useDocumentStore.getState().saveProject(name),
  download: () => useDocumentStore.getState().downloadProjectFile(),
  notify: (message) => useDocumentStore.getState().setToastMessage(message),
  isDirty: () => useDocumentStore.getState().isDirty,
  selectPage: async (index) => {
    useDocumentStore.getState().selectPage(index);
  },
  setViewportZoom: (zoom) => useDocumentStore.getState().setZoom(zoom),
});

export const useLegacyProjectSessionBridge = () => {
  const mode = useProjectSessionStore((state) => state.editorMode);
  const source = useProjectSessionStore((state) => state.session?.source);
  const canvasState = useEditorStore((state) => ({
    projectName: state.projectName,
    productProjectFields: state.productProjectFields,
    currentLibraryProjectId: state.currentLibraryProjectId,
    pages: state.pages,
    activePageIndex: state.activePageIndex,
    isDirty: state.isDirty,
    saveStatus: state.saveStatus,
    zoom: state.zoom,
    unitMode: state.unitMode,
  }), shallow);
  const documentProject = useDocumentStore((state) => state.project);
  const documentLibraryProjectId = useDocumentStore(
    (state) => state.currentLibraryProjectId
  );
  const documentIsDirty = useDocumentStore((state) => state.isDirty);
  const documentSaveStatus = useDocumentStore((state) => state.saveStatus);
  const documentZoom = useDocumentStore((state) => state.zoom);
  const documentState = useMemo<DocumentSessionState>(() => ({
    project: documentProject,
    currentLibraryProjectId: documentLibraryProjectId,
    isDirty: documentIsDirty,
    saveStatus: documentSaveStatus,
    zoom: documentZoom,
  }), [
    documentIsDirty,
    documentLibraryProjectId,
    documentProject,
    documentSaveStatus,
    documentZoom,
  ]);

  const sessionSource = getSessionSource(
    source,
    mode === 'document'
      ? Boolean(documentState.currentLibraryProjectId)
      : Boolean(canvasState.currentLibraryProjectId)
  );
  const descriptor = useMemo(
    () => mode === 'document'
      ? createDocumentSessionDescriptor(documentState, sessionSource)
      : createCanvasSessionDescriptor(canvasState, sessionSource),
    [canvasState, documentState, mode, sessionSource]
  );
  const snapshot = useMemo(
    () => {
      if (!descriptor) return null;
      return createSessionSnapshot(
        descriptor,
        mode === 'document' ? documentState.isDirty : canvasState.isDirty,
        mode === 'document' ? documentState.saveStatus : canvasState.saveStatus
      );
    }, [canvasState.isDirty, canvasState.saveStatus, descriptor, documentState.isDirty, documentState.saveStatus, mode]
  );
  const commands = useMemo(
    () => mode === 'document' ? createDocumentCommands() : createCanvasCommands(),
    [mode]
  );
  const zoom = mode === 'document' ? documentState.zoom : canvasState.zoom;

  return {
    mode,
    descriptor,
    snapshot,
    commands,
    zoom,
  };
};

const CanvasLegacyRendererAdapter: React.FC<LegacyRendererAdapterProps> = ({
  onBackToDashboard,
  onSelectionEvent,
}) => {
  const pageId = useProjectSessionStore((state) => state.session?.activePageId);
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId);
  const selectedLayerIds = useEditorStore((state) => state.selectedLayerIds);

  useEffect(() => {
    const selectedIds = selectedLayerIds.length > 0
      ? selectedLayerIds
      : selectedObjectId
        ? [selectedObjectId]
        : [];
    const firstId = selectedIds[0];
    onSelectionEvent({
      source: 'canvas',
      pageId: pageId || null,
      target: firstId && pageId
        ? {
            kind: 'freeform-object',
            pageId,
            objectId: firstId,
            objectIds: selectedIds.length > 1 ? selectedIds : undefined,
          }
        : { kind: 'none' },
      isFocused: selectedIds.length > 0,
      isEditing: false,
    });
  }, [onSelectionEvent, pageId, selectedLayerIds, selectedObjectId]);

  return <EditorShell onBackToDashboard={onBackToDashboard} />;
};

const DocumentLegacyRendererAdapter: React.FC<LegacyRendererAdapterProps> = ({
  onBackToDashboard,
  onSelectionEvent,
}) => (
  <DocumentEditorShell
    onBackToDashboard={onBackToDashboard}
    onSelectionEvent={onSelectionEvent}
  />
);

export const legacyRendererAdapters: Readonly<Record<LegacyRendererKind, LegacyRendererAdapter>> = {
  canvas: {
    kind: 'canvas',
    render: CanvasLegacyRendererAdapter,
  },
  document: {
    kind: 'document',
    render: DocumentLegacyRendererAdapter,
  },
};
