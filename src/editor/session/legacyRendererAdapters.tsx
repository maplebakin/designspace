import React, { useEffect, useMemo, useSyncExternalStore } from 'react';
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
import type { CanvasCommittedMutation } from '../services/canvasEventService';
import type { DocumentCommittedMutation } from '../../document/components/DocumentEditorShell';
import type { PageAssetEffect } from './projectMutation';
import {
  executeObservedPageMutation,
  observeCommittedEngineChange,
} from './projectChangeAdapters';
import type { ProjectChangeCoordinator } from './projectChangeCoordinator';
import type {
  ProjectLifecycleAuthority,
  ProjectLifecycleSaveAdapter,
} from './projectLifecycleAuthority';
import {
  describeCanvasPageAssets,
  describeDocumentPageAssets,
  executeCanvasPageMutation,
  executeDocumentPageMutation,
} from './legacyPageMutationAdapters';
import { useEditorStore } from '../state/editorStore';
import { useProjectSessionStore } from '../state/projectSessionStore';

export type LegacyRendererAdapterProps = {
  onBackToDashboard?: () => void;
  onSelectionEvent: (event: SelectionEvent) => void;
  changeCoordinator?: ProjectChangeCoordinator;
  useSharedChrome?: boolean;
  onRegisterFitPage?: (fitPage: (() => void) | null) => void;
  /** Shared chrome may provide a page strip to the embedded engine surface. */
  sharedPageStrip?: React.ReactNode;
};

export type LegacyRendererAdapter = Readonly<{
  kind: LegacyRendererKind;
  render: React.ComponentType<LegacyRendererAdapterProps>;
}>;

type CanvasSessionState = {
  canvasReadyState: ReturnType<typeof useEditorStore.getState>['canvasReadyState'];
  projectName: string;
  productProjectFields: ReturnType<typeof useEditorStore.getState>['productProjectFields'];
  currentLibraryProjectId: string | null;
  sessionIdentity: string;
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
  sessionIdentity: string;
  isDirty: boolean;
  saveStatus: ReturnType<typeof useDocumentStore.getState>['saveStatus'];
  lastDirtyReason: ReturnType<typeof useDocumentStore.getState>['lastDirtyReason'];
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

const createCanvasCommands = (
  changeCoordinator: ProjectChangeCoordinator,
  lifecycleAuthority: ProjectLifecycleAuthority
): ProjectSessionCommands => ({
  save: async (name) => {
    const state = useEditorStore.getState();
    await lifecycleAuthority.save(name?.trim() || state.projectName || 'Untitled Project');
  },
  download: async () => {
    const revision = lifecycleAuthority.getSnapshot().authoredRevision;
    const result = await useEditorStore.getState().downloadProjectFile();
    if (result?.status === 'saved') {
      lifecycleAuthority.markPersistedRevision(revision);
    }
    return result;
  },
  notify: (message) => {
    useEditorStore.getState().setToast({
      message,
      variant: 'error',
    });
  },
  isDirty: () => lifecycleAuthority.getSnapshot().isDirty,
  renameProject: (name) => useEditorStore.getState().renameCurrentProject(name),
  mutatePage: (command) => executeObservedPageMutation({
    command,
    source: 'canvas',
    coordinator: changeCoordinator,
    execute: executeCanvasPageMutation,
  }),
  describePageAssets: async (pageId) => describeCanvasPageAssets(pageId),
  changeCoordinator,
  setViewportZoom: (zoom) => zoomToCenter(zoom),
  fitPage: () => useEditorStore.getState().resetViewCanvas(),
});

const createDocumentCommands = (
  changeCoordinator: ProjectChangeCoordinator,
  lifecycleAuthority: ProjectLifecycleAuthority
): ProjectSessionCommands => ({
  save: async (name) => {
    await lifecycleAuthority.save(name);
  },
  download: async () => {
    const revision = lifecycleAuthority.getSnapshot().authoredRevision;
    const result = await useDocumentStore.getState().downloadProjectFile();
    if (result?.status === 'saved') {
      lifecycleAuthority.markPersistedRevision(revision);
    }
    return result;
  },
  notify: (message) => useDocumentStore.getState().setToastMessage(message),
  isDirty: () => lifecycleAuthority.getSnapshot().isDirty,
  renameProject: async (name) => {
    useDocumentStore.getState().renameProject(name);
  },
  mutatePage: (command) => executeObservedPageMutation({
    command,
    source: 'document',
    coordinator: changeCoordinator,
    execute: executeDocumentPageMutation,
  }),
  describePageAssets: async (pageId) => describeDocumentPageAssets(pageId),
  changeCoordinator,
  setViewportZoom: (zoom) => useDocumentStore.getState().setZoom(zoom),
});

export const useLegacyProjectSessionBridge = (
  changeCoordinator: ProjectChangeCoordinator,
  lifecycleAuthority: ProjectLifecycleAuthority
) => {
  const mode = useProjectSessionStore((state) => state.editorMode);
  const source = useProjectSessionStore((state) => state.session?.source);
  const canvasState = useEditorStore((state) => ({
    canvasReadyState: state.canvasReadyState,
    projectName: state.projectName,
    productProjectFields: state.productProjectFields,
    currentLibraryProjectId: state.currentLibraryProjectId,
    sessionIdentity: state.sessionIdentity,
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
  const documentSessionIdentity = useDocumentStore(
    (state) => state.sessionIdentity
  );
  const documentIsDirty = useDocumentStore((state) => state.isDirty);
  const documentSaveStatus = useDocumentStore((state) => state.saveStatus);
  const documentDirtyReason = useDocumentStore((state) => state.lastDirtyReason);
  const documentZoom = useDocumentStore((state) => state.zoom);
  const documentState = useMemo<DocumentSessionState>(() => ({
    project: documentProject,
    currentLibraryProjectId: documentLibraryProjectId,
    sessionIdentity: documentSessionIdentity,
    isDirty: documentIsDirty,
    saveStatus: documentSaveStatus,
    lastDirtyReason: documentDirtyReason,
    zoom: documentZoom,
  }), [
    documentIsDirty,
    documentDirtyReason,
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
  const lifecycleSnapshot = useSyncExternalStore(
    lifecycleAuthority.subscribe,
    lifecycleAuthority.getSnapshot,
    lifecycleAuthority.getSnapshot
  );
  const sessionIdentity = mode === 'document'
    ? documentState.sessionIdentity
    : canvasState.sessionIdentity;
  const sessionKey = `${mode}:${sessionIdentity}`;
  const lifecycleAdapter = useMemo<ProjectLifecycleSaveAdapter>(() => (
    mode === 'document'
      ? {
          canSave: () => Boolean(useDocumentStore.getState().project),
          canAutosave: () => {
            const state = useDocumentStore.getState();
            return Boolean(state.currentLibraryProjectId && state.project);
          },
          autosaveDelayMs: 900,
          save: async (name) => useDocumentStore.getState().saveProject(name),
          autosave: async () => useDocumentStore.getState().flushAutosave(),
        }
      : {
          canSave: () => Boolean(useEditorStore.getState().canvas),
          canAutosave: () => {
            const state = useEditorStore.getState();
            return Boolean(state.currentLibraryProjectId && state.canvas);
          },
          autosaveDelayMs: 2000,
          save: async (name) => {
            const state = useEditorStore.getState();
            return state.saveProject(
              name?.trim() || state.projectName || 'Untitled Project'
            );
          },
          autosave: async () => {
            await useEditorStore.getState().updateCurrentProject();
            return true;
          },
        }
  ), [mode]);

  useEffect(() => {
    if (!descriptor) {
      lifecycleAuthority.endSession();
      useEditorStore.getState().setLifecycleAuthorityMode('legacy');
      useDocumentStore.getState().setLifecycleAuthorityMode('legacy');
      return;
    }

    if (mode === 'document') {
      useEditorStore.getState().setLifecycleAuthorityMode('legacy');
      useDocumentStore.getState().setLifecycleAuthorityMode('shared');
    } else {
      useEditorStore.getState().setLifecycleAuthorityMode('shared');
      useDocumentStore.getState().setLifecycleAuthorityMode('legacy');
    }
    lifecycleAuthority.startSession({
      projectId: descriptor.projectId,
      sessionIdentity: sessionKey,
      adapter: lifecycleAdapter,
    });

    return () => {
      lifecycleAuthority.endSession();
      useEditorStore.getState().setLifecycleAuthorityMode('legacy');
      useDocumentStore.getState().setLifecycleAuthorityMode('legacy');
    };
  }, [
    descriptor !== null,
    lifecycleAdapter,
    lifecycleAuthority,
    mode,
    sessionKey,
  ]);

  useEffect(() => {
    if (!descriptor) return;
    lifecycleAuthority.startSession({
      projectId: descriptor.projectId,
      sessionIdentity: sessionKey,
      adapter: lifecycleAdapter,
    });
  }, [
    canvasState.canvasReadyState,
    canvasState.currentLibraryProjectId,
    descriptor?.projectId,
    documentState.currentLibraryProjectId,
    documentState.project !== null,
    lifecycleAdapter,
    lifecycleAuthority,
    sessionKey,
  ]);
  const snapshot = useMemo(
    () => {
      if (!descriptor) return null;
      return createSessionSnapshot(
        descriptor,
        lifecycleSnapshot.isDirty,
        lifecycleSnapshot.saveStatus,
        {
          legacyDirtyReason: lifecycleSnapshot.isDirty
            ? 'authored-content'
            : null,
          canSave: lifecycleSnapshot.canSave,
          canClose: lifecycleSnapshot.canClose,
        }
      );
    }, [
      descriptor,
      lifecycleSnapshot,
      mode,
    ]
  );
  const commands = useMemo(
    () => mode === 'document'
      ? createDocumentCommands(changeCoordinator, lifecycleAuthority)
      : createCanvasCommands(changeCoordinator, lifecycleAuthority),
    [changeCoordinator, lifecycleAuthority, mode]
  );
  const zoom = mode === 'document' ? documentState.zoom : canvasState.zoom;

  return {
    mode,
    descriptor,
    snapshot,
    commands,
    zoom,
    legacyLifecycle: mode === 'document'
      ? {
          isDirty: documentState.isDirty,
          saveStatus: documentState.saveStatus,
          legacyDirtyReason: documentState.lastDirtyReason,
        }
      : {
          isDirty: canvasState.isDirty,
          saveStatus: canvasState.saveStatus,
          legacyDirtyReason: null,
        },
  };
};

const CanvasLegacyRendererAdapter: React.FC<LegacyRendererAdapterProps> = ({
  onBackToDashboard,
  onSelectionEvent,
  changeCoordinator,
  useSharedChrome,
  onRegisterFitPage,
  sharedPageStrip,
}) => {
  const session = useProjectSessionStore((state) => state.session);
  const pageId = session?.activePageId;
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

  useEffect(() => {
    if (!onRegisterFitPage) return;
    onRegisterFitPage(() => useEditorStore.getState().resetViewCanvas());
    return () => onRegisterFitPage(null);
  }, [onRegisterFitPage]);

  const onCommittedCanvasMutation = React.useCallback((
    mutation: CanvasCommittedMutation
  ) => {
    const currentSession = useProjectSessionStore.getState().session;
    const currentPageId = currentSession?.activePageId;
    if (!changeCoordinator || !currentSession?.projectId || !currentPageId) return;
    if ('groupId' in mutation) {
      observeCommittedEngineChange(changeCoordinator, {
        projectId: currentSession.projectId,
        source: 'canvas',
        action: mutation.action,
        pageIds: [currentPageId],
        domains: ['freeform-content'],
        target: {
          kind: 'freeform-group',
          id: mutation.groupId,
        },
        assetEffect: 'none',
      });
      return;
    }

    if (mutation.action === 'modify-freeform-style') {
      observeCommittedEngineChange(changeCoordinator, {
        projectId: currentSession.projectId,
        source: 'canvas',
        action: mutation.action,
        pageIds: [currentPageId],
        domains: ['style'],
        target: {
          kind: 'freeform-object',
          id: mutation.objectId,
        },
        assetEffect: 'none',
      });
      return;
    }

    if (
      mutation.action === 'apply-freeform-style-preset'
      || mutation.action === 'reset-freeform-image-adjustments'
    ) {
      observeCommittedEngineChange(changeCoordinator, {
        projectId: currentSession.projectId,
        source: 'canvas',
        action: mutation.action,
        pageIds: [currentPageId],
        domains: ['style'],
        target: {
          kind: 'freeform-object',
          id: mutation.objectId,
        },
        assetEffect: 'none',
      });
      return;
    }

    if (mutation.action === 'modify-freeform-theme-link') {
      observeCommittedEngineChange(changeCoordinator, {
        projectId: currentSession.projectId,
        source: 'canvas',
        action: mutation.action,
        pageIds: [currentPageId],
        domains: ['style'],
        target: {
          kind: 'freeform-object',
          id: mutation.objectId,
        },
        assetEffect: 'none',
      });
      return;
    }

    if (
      mutation.action === 'apply-freeform-theme'
      || mutation.action === 'reset-freeform-theme-links'
    ) {
      observeCommittedEngineChange(changeCoordinator, {
        projectId: currentSession.projectId,
        source: 'canvas',
        action: mutation.action,
        pageIds: [currentPageId],
        domains: ['style'],
        target: {
          kind: 'page',
          id: currentPageId,
        },
        assetEffect: 'none',
      });
      return;
    }

    if (mutation.action === 'apply-freeform-design-state' && 'pageScope' in mutation) {
      observeCommittedEngineChange(changeCoordinator, {
        projectId: currentSession.projectId,
        source: 'canvas',
        action: mutation.action,
        pageIds: [currentPageId],
        domains: ['freeform-content'],
        target: {
          kind: 'page',
          id: currentPageId,
        },
        assetEffect: 'none',
      });
      return;
    }

    if (
      mutation.action === 'apply-freeform-template'
      || mutation.action === 'apply-project-recipe'
    ) {
      observeCommittedEngineChange(changeCoordinator, {
        projectId: currentSession.projectId,
        source: 'canvas',
        action: mutation.action,
        pageIds: [currentPageId],
        domains: ['page-structure', 'freeform-content'],
        target: {
          kind: 'project',
          id: currentSession.projectId,
        },
        assetEffect: 'none',
      });
      return;
    }

    if (
      mutation.action === 'add-page'
      || mutation.action === 'remove-page'
      || mutation.action === 'reorder-page'
    ) {
      observeCommittedEngineChange(changeCoordinator, {
        projectId: currentSession.projectId,
        source: 'canvas',
        action: mutation.action,
        pageIds: [mutation.pageId],
        domains: ['page-structure'],
        target: {
          kind: 'page',
          id: mutation.pageId,
        },
        assetEffect: 'none',
      });
      return;
    }

    if (mutation.action === 'reorder-freeform-objects') {
      observeCommittedEngineChange(changeCoordinator, {
        projectId: currentSession.projectId,
        source: 'canvas',
        action: mutation.action,
        pageIds: [currentPageId],
        domains: ['freeform-content'],
        target: {
          kind: 'page',
          id: currentPageId,
        },
        assetEffect: 'none',
      });
      return;
    }

    if (mutation.action === 'add-freeform-objects' && 'pageScope' in mutation) {
      observeCommittedEngineChange(changeCoordinator, {
        projectId: currentSession.projectId,
        source: 'canvas',
        action: mutation.action,
        pageIds: [currentPageId],
        domains: mutation.assetEffect === 'none'
          ? ['freeform-content']
          : ['freeform-content', 'asset-reference'],
        target: {
          kind: 'page',
          id: currentPageId,
        },
        assetEffect: mutation.assetEffect,
      });
      return;
    }

    if (mutation.action === 'remove-freeform-objects' && 'pageScope' in mutation) {
      observeCommittedEngineChange(changeCoordinator, {
        projectId: currentSession.projectId,
        source: 'canvas',
        action: mutation.action,
        pageIds: [currentPageId],
        domains: mutation.assetEffect === 'none'
          ? ['freeform-content']
          : ['freeform-content', 'asset-reference'],
        target: {
          kind: 'page',
          id: currentPageId,
        },
        assetEffect: mutation.assetEffect,
      });
      return;
    }

    if (
      (mutation.action === 'resize-freeform-page'
        || mutation.action === 'reset-freeform-page')
      && 'pageScope' in mutation
    ) {
      observeCommittedEngineChange(changeCoordinator, {
        projectId: currentSession.projectId,
        source: 'canvas',
        action: mutation.action,
        pageIds: [currentPageId],
        domains: ['page-structure', 'freeform-content', 'geometry'],
        target: {
          kind: 'page',
          id: currentPageId,
        },
        assetEffect: 'none',
      });
      return;
    }

    if (mutation.action === 'modify-freeform-geometry' && 'pageScope' in mutation) {
      observeCommittedEngineChange(changeCoordinator, {
        projectId: currentSession.projectId,
        source: 'canvas',
        action: mutation.action,
        pageIds: [currentPageId],
        domains: ['geometry', 'freeform-content'],
        target: {
          kind: 'page',
          id: currentPageId,
        },
        assetEffect: 'none',
      });
      return;
    }

    if (mutation.action === 'modify-page-metadata' && 'pageScope' in mutation) {
      observeCommittedEngineChange(changeCoordinator, {
        projectId: currentSession.projectId,
        source: 'canvas',
        action: mutation.action,
        pageIds: [currentPageId],
        domains: ['page-structure'],
        target: {
          kind: 'page',
          id: currentPageId,
        },
        assetEffect: 'none',
      });
      return;
    }

    if (mutation.action === 'modify-freeform-text-content') {
      observeCommittedEngineChange(changeCoordinator, {
        projectId: currentSession.projectId,
        source: 'canvas',
        action: mutation.action,
        pageIds: [currentPageId],
        domains: ['freeform-content'],
        target: {
          kind: 'freeform-object',
          id: mutation.objectId,
        },
        assetEffect: 'none',
      });
      return;
    }

    if (mutation.action === 'modify-freeform-transform-lock') {
      observeCommittedEngineChange(changeCoordinator, {
        projectId: currentSession.projectId,
        source: 'canvas',
        action: mutation.action,
        pageIds: [currentPageId],
        domains: ['freeform-content'],
        target: {
          kind: 'freeform-object',
          id: mutation.objectId,
        },
        assetEffect: 'none',
      });
      return;
    }

    if (mutation.action === 'modify-freeform-theme-color-lock') {
      observeCommittedEngineChange(changeCoordinator, {
        projectId: currentSession.projectId,
        source: 'canvas',
        action: mutation.action,
        pageIds: [currentPageId],
        domains: ['style'],
        target: {
          kind: 'freeform-object',
          id: mutation.objectId,
        },
        assetEffect: 'none',
      });
      return;
    }

    if (
      mutation.action === 'modify-freeform-visibility'
      || mutation.action === 'move-freeform-forward'
      || mutation.action === 'move-freeform-backward'
      || mutation.action === 'bring-freeform-to-front'
      || mutation.action === 'send-freeform-to-back'
      || mutation.action === 'modify-freeform-selection-lock'
      || mutation.action === 'reorder-freeform-object'
    ) {
      observeCommittedEngineChange(changeCoordinator, {
        projectId: currentSession.projectId,
        source: 'canvas',
        action: mutation.action,
        pageIds: [currentPageId],
        domains: ['freeform-content'],
        target: {
          kind: 'freeform-object',
          id: mutation.objectId,
        },
        assetEffect: 'none',
      });
      return;
    }

    if (!('objectId' in mutation)) return;

    const assetEffect = mutation.action === 'modify-freeform-geometry'
      ? 'none'
      : 'assetEffect' in mutation
        ? mutation.assetEffect
        : 'none';
    const domains = mutation.action === 'modify-freeform-geometry'
      ? ['geometry'] as const
      : assetEffect === 'none'
        ? ['freeform-content'] as const
        : ['freeform-content', 'asset-reference'] as const;
    observeCommittedEngineChange(changeCoordinator, {
      projectId: currentSession.projectId,
      source: 'canvas',
      action: mutation.action,
      pageIds: [currentPageId],
      domains,
      target: {
        kind: 'freeform-object',
        id: mutation.objectId,
      },
      assetEffect,
    });
  }, [changeCoordinator]);

  return (
    <EditorShell
      onBackToDashboard={onBackToDashboard}
      useSharedChrome={useSharedChrome}
      sharedPageStrip={sharedPageStrip}
      onCommittedCanvasMutation={onCommittedCanvasMutation}
    />
  );
};

const DocumentLegacyRendererAdapter: React.FC<LegacyRendererAdapterProps> = ({
  onBackToDashboard,
  onSelectionEvent,
  changeCoordinator,
  useSharedChrome,
  onRegisterFitPage,
}) => {
  const onCommittedDocumentMutation = React.useCallback((
    mutation: DocumentCommittedMutation
  ) => {
    const currentSession = useProjectSessionStore.getState().session;
    const currentPageId = currentSession?.activePageId;
    if (!changeCoordinator || !currentSession?.projectId || !currentPageId) return;
    const observe = (
      action: DocumentCommittedMutation['action'],
      pageId: string,
      domains: readonly ('project-metadata' | 'page-structure' | 'structured-content' | 'geometry' | 'style' | 'asset-reference')[],
      target: { kind: 'project' | 'page' | 'structured-image' | 'structured-group'; id: string },
      assetEffect: PageAssetEffect = 'none'
    ) => observeCommittedEngineChange(changeCoordinator, {
      projectId: currentSession.projectId,
      source: 'document',
      action,
      pageIds: [pageId],
      domains,
      target,
      assetEffect,
    });

    switch (mutation.action) {
      case 'add-page':
      case 'duplicate-page':
      case 'remove-page':
      case 'reorder-page':
        observe(mutation.action, mutation.pageId, ['page-structure'], {
          kind: 'page',
          id: mutation.pageId,
        });
        return;
      case 'modify-document-metadata':
        observe(mutation.action, mutation.pageId, ['project-metadata'], {
          kind: 'project',
          id: currentSession.projectId,
        });
        return;
      case 'modify-document-reference':
        observe(
          mutation.action,
          mutation.pageId,
          ['project-metadata', 'asset-reference'],
          { kind: 'page', id: mutation.pageId },
          mutation.assetEffect || 'none'
        );
        return;
      case 'modify-structured-image-metadata':
        observe(
          mutation.action,
          mutation.pageId,
          ['structured-content'],
          {
            kind: 'structured-image',
            id: mutation.imageId,
          },
          mutation.assetEffect || 'none'
        );
        return;
      case 'modify-structured-image-layout':
        observe(
          mutation.action,
          mutation.pageId,
          ['geometry'],
          mutation.imageId
            ? { kind: 'structured-image', id: mutation.imageId }
            : { kind: 'page', id: mutation.pageId }
        );
        return;
      case 'modify-structured-image-group':
        observe(mutation.action, mutation.pageId, ['structured-content'], {
          kind: 'structured-group',
          id: mutation.groupId,
        });
        return;
      case 'modify-document-style-metadata':
        observe(mutation.action, mutation.pageId, ['style'], {
          kind: 'page',
          id: mutation.pageId,
        });
        return;
      case 'modify-page-metadata':
        observe(mutation.action, mutation.pageId, ['page-structure'], {
          kind: 'page',
          id: mutation.pageId,
        });
        return;
      case 'modify-structured-title-content':
      case 'modify-structured-body-content':
        observe(mutation.action, mutation.pageId, ['structured-content'], {
          kind: 'page',
          id: mutation.pageId,
        });
        return;
      case 'modify-structured-geometry':
        observe(mutation.action, currentPageId, ['geometry'], {
          kind: 'structured-image',
          id: mutation.overlayId,
        });
        return;
      case 'add-structured-overlay':
      case 'remove-structured-overlay':
        observe(mutation.action, currentPageId, ['structured-content'], {
          kind: 'structured-image',
          id: mutation.overlayId,
        }, mutation.assetEffect);
        return;
      case 'add-structured-flow-image':
      case 'remove-structured-flow-image':
      case 'remove-structured-inline-image':
        observe(mutation.action, mutation.pageId, ['structured-content'], {
          kind: 'structured-image',
          id: mutation.flowImageId,
        }, mutation.assetEffect);
        return;
    }
  }, [changeCoordinator]);

  return (
    <DocumentEditorShell
      onBackToDashboard={onBackToDashboard}
      onSelectionEvent={onSelectionEvent}
      useSharedChrome={useSharedChrome}
      onRegisterFitPage={onRegisterFitPage}
      onCommittedMutation={onCommittedDocumentMutation}
    />
  );
};

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
