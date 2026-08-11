import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadCanvasFromJsonSafely,
} from '../src/editor/fabric/initFabricCanvas';
import {
  createProjectChangeDiagnosticObserver,
} from '../src/editor/session/projectChangeDiagnostic';
import {
  createProjectChangeCoordinator,
} from '../src/editor/session/projectChangeCoordinator';
import {
  observeCommittedEngineChange,
} from '../src/editor/session/projectChangeAdapters';
import {
  registerObjectEventHandlers,
} from '../src/editor/services/canvasEventService';
import {
  withCanvasObjectMutationSuppressed,
} from '../src/editor/services/canvasMutationObservation';
import { useDocumentStore } from '../src/document/state/documentStore';
import { useEditorStore } from '../src/editor/state/editorStore';

const originalCanvasState = useEditorStore.getState();

const cleanLifecycle = (projectId: string) => ({
  projectId,
  legacyDirty: false,
  legacySaveStatus: 'saved' as const,
});

const committedObservation = (projectId: string) => ({
  projectId,
  source: 'canvas' as const,
  action: 'add-freeform-object' as const,
  pageIds: ['canvas-page'],
  domains: ['freeform-content'] as const,
  target: { kind: 'freeform-object' as const, id: 'object-1' },
  assetEffect: 'none' as const,
});

afterEach(() => {
  useDocumentStore.getState().reset();
  useEditorStore.setState(originalCanvasState, true);
});

describe('Unified Editor Phase 1F diagnostic lifecycle', () => {
  it('records bounded lifecycle checkpoints without changing diagnostic revision semantics', () => {
    const coordinator = createProjectChangeCoordinator({
      createTransactionId: (() => {
        let index = 0;
        return () => `phase-1f-tx-${++index}`;
      })(),
      now: (() => {
        let timestamp = 100;
        return () => timestamp++;
      })(),
    });
    const observer = createProjectChangeDiagnosticObserver({
      coordinator,
      now: (() => {
        let timestamp = 1000;
        return () => timestamp++;
      })(),
    });

    observer.observeSession(cleanLifecycle('checkpoint-project'));
    expect(observer.view.getSnapshot().recentCheckpoints.map(({ kind }) => kind))
      .toEqual(['session-opened']);

    coordinator.observeCommitted(committedObservation('checkpoint-project'));
    expect(observer.view.getSnapshot()).toMatchObject({
      observedRevision: 1,
      recentCheckpoints: [
        expect.objectContaining({ kind: 'session-opened', observedRevision: 0 }),
        expect.objectContaining({ kind: 'after-authored-commit', observedRevision: 1 }),
      ],
    });

    observer.observeSession({
      ...cleanLifecycle('checkpoint-project'),
      legacyDirty: true,
      legacySaveStatus: 'unsaved',
      legacyDirtyReason: 'authored-content',
    });
    observer.observeSession({
      ...cleanLifecycle('checkpoint-project'),
      legacyDirty: true,
      legacySaveStatus: 'saving',
      legacyDirtyReason: 'authored-content',
    });
    observer.observeSession(cleanLifecycle('checkpoint-project'));
    observer.checkpoint('before-close');
    observer.checkpoint('session-closed');

    const snapshot = observer.view.getSnapshot();
    expect(snapshot).toMatchObject({
      observedRevision: 1,
      lastLegacyCleanRevision: 1,
      changesSinceLegacyClean: 0,
      comparison: { state: 'consistent-clean' },
    });
    expect(snapshot.recentCheckpoints.map(({ kind }) => kind)).toEqual([
      'session-opened',
      'after-authored-commit',
      'legacy-became-dirty',
      'save-started',
      'save-completed-clean',
      'before-close',
      'session-closed',
    ]);

    Array.from({ length: 40 }, () => observer.checkpoint('session-closed'));
    expect(observer.view.getSnapshot().recentCheckpoints).toHaveLength(32);

    observer.dispose();
    coordinator.dispose();
  });

  it('classifies persisted Document page selection as navigation dirty, not authored change', () => {
    const coordinator = createProjectChangeCoordinator();
    const observer = createProjectChangeDiagnosticObserver({ coordinator });
    observer.observeSession(cleanLifecycle('navigation-project'));

    observer.observeSession({
      projectId: 'navigation-project',
      legacyDirty: true,
      legacySaveStatus: 'unsaved',
      legacyDirtyReason: 'navigation-persistence',
    });

    expect(observer.view.getSnapshot()).toMatchObject({
      observedRevision: 0,
      committedTransactionCount: 0,
      legacyDirtyReason: 'navigation-persistence',
      comparison: { state: 'legacy-dirty-with-navigation-persistence' },
    });

    observer.observeSession(cleanLifecycle('navigation-project'));
    expect(observer.view.getSnapshot()).toMatchObject({
      observedRevision: 0,
      lastLegacyCleanRevision: 0,
      comparison: { state: 'consistent-clean' },
    });

    observer.dispose();
    coordinator.dispose();
  });

  it('resets diagnostic runtime state on a project switch and keeps coverage incomplete', () => {
    const coordinator = createProjectChangeCoordinator();
    const observer = createProjectChangeDiagnosticObserver({ coordinator });
    observer.observeSession(cleanLifecycle('project-a'));
    coordinator.observeCommitted(committedObservation('project-a'));
    expect(observer.view.getSnapshot().observedRevision).toBe(1);

    observer.observeSession(cleanLifecycle('project-b'));
    expect(observer.view.getSnapshot()).toMatchObject({
      projectId: 'project-b',
      observedRevision: 0,
      committedTransactionCount: 0,
      rejectedTransactionCount: 0,
      failedTransactionCount: 0,
      recentCheckpoints: [expect.objectContaining({ kind: 'session-opened' })],
      coverage: {
        canvasObjectAdd: true,
        canvasObjectRemove: true,
        documentPageMetadata: true,
        completeAuthoredCoverage: false,
      },
    });

    observer.dispose();
    coordinator.dispose();
  });

  it('normalizes the selected page-metadata boundary without owning legacy dirty state', () => {
    const coordinator = createProjectChangeCoordinator();
    const observer = createProjectChangeDiagnosticObserver({ coordinator });
    observer.observeSession(cleanLifecycle('metadata-project'));

    observeCommittedEngineChange(coordinator, {
      projectId: 'metadata-project',
      source: 'document',
      action: 'modify-page-metadata',
      pageIds: ['document-page'],
      domains: ['page-structure'],
      target: { kind: 'page', id: 'document-page' },
      assetEffect: 'none',
    });

    expect(observer.view.getSnapshot()).toMatchObject({
      observedRevision: 1,
      lastCommittedTransaction: expect.objectContaining({
        action: 'modify-page-metadata',
        source: 'document',
        pageIds: ['document-page'],
        domains: ['page-structure'],
        target: { kind: 'page', id: 'document-page' },
      }),
    });
    expect(useDocumentStore.getState().isDirty).toBe(false);

    observer.dispose();
    coordinator.dispose();
  });
});

describe('Unified Editor Phase 1F Canvas object lifecycle observation', () => {
  it('emits one stable add/remove observation, suppresses hydration, and keeps history replay out', async () => {
    const listeners = new Map<string, (event: { target?: Record<string, unknown> }) => void>();
    const canvas = {
      on: vi.fn((name: string, listener: (event: { target?: Record<string, unknown> }) => void) => {
        listeners.set(name, listener);
      }),
      off: vi.fn((name: string) => listeners.delete(name)),
      getObjects: vi.fn(() => []),
      remove: vi.fn(),
    };
    const onCommittedMutation = vi.fn();
    useEditorStore.setState({
      syncLock: { isLocked: false, reason: null, queuedSync: false },
    });
    const registration = registerObjectEventHandlers({
      canvas: canvas as any,
      callbacks: { onCommittedMutation },
    });

    const loadFromJSON = vi.fn(async () => {
      listeners.get('object:added')?.({ target: { id: 'hydrated-add', type: 'rect' } });
      listeners.get('object:removed')?.({ target: { id: 'hydrated-remove', type: 'rect' } });
    });
    (canvas as any).loadFromJSON = loadFromJSON;
    await loadCanvasFromJsonSafely(canvas as any, { objects: [] });
    expect(onCommittedMutation).not.toHaveBeenCalled();

    listeners.get('object:added')?.({ target: { id: 'shape-1', type: 'rect' } });
    listeners.get('object:removed')?.({ target: { id: 'image-1', type: 'image' } });
    expect(onCommittedMutation).toHaveBeenCalledTimes(2);
    expect(onCommittedMutation).toHaveBeenNthCalledWith(1, {
      action: 'add-freeform-object',
      objectId: 'shape-1',
      assetEffect: 'none',
    });
    expect(onCommittedMutation).toHaveBeenNthCalledWith(2, {
      action: 'remove-freeform-object',
      objectId: 'image-1',
      assetEffect: 'cleanup-delegated',
    });
    expect(onCommittedMutation.mock.calls[0][0]).not.toHaveProperty('target');

    useEditorStore.setState({
      syncLock: { isLocked: true, reason: 'undo', queuedSync: false },
    });
    listeners.get('object:added')?.({ target: { id: 'undo-add', type: 'rect' } });
    listeners.get('object:removed')?.({ target: { id: 'undo-remove', type: 'rect' } });
    expect(onCommittedMutation).toHaveBeenCalledTimes(2);

    useEditorStore.setState({
      syncLock: { isLocked: false, reason: null, queuedSync: false },
    });
    withCanvasObjectMutationSuppressed(canvas, () => {
      listeners.get('object:added')?.({ target: { id: 'internal-add', type: 'rect' } });
      listeners.get('object:removed')?.({ target: { id: 'internal-remove', type: 'rect' } });
    });
    expect(onCommittedMutation).toHaveBeenCalledTimes(2);

    registration.cleanup();
  });

  it('observes serialized store add/remove commands once without retaining engine objects', () => {
    const onCommittedMutation = vi.fn();
    const canvas = {
      getActiveObject: vi.fn(() => null),
      discardActiveObject: vi.fn(),
      requestRenderAll: vi.fn(),
    };
    useEditorStore.setState({
      canvas: canvas as any,
      canvasObjects: [],
      committedMutationObserver: onCommittedMutation,
      syncLock: { isLocked: false, reason: null, queuedSync: false },
      layerSyncHandler: null,
      hasLayerSyncHandler: false,
      selectedObjectId: null,
      selectedLayerIds: [],
    });

    useEditorStore.getState().addObject({ id: 'store-shape', type: 'rect' }, {
      save: false,
      select: false,
    });
    useEditorStore.getState().removeObject('store-shape', { save: false });

    expect(onCommittedMutation).toHaveBeenCalledTimes(2);
    expect(onCommittedMutation).toHaveBeenNthCalledWith(1, {
      action: 'add-freeform-object',
      objectId: 'store-shape',
      assetEffect: 'none',
    });
    expect(onCommittedMutation).toHaveBeenNthCalledWith(2, {
      action: 'remove-freeform-object',
      objectId: 'store-shape',
      assetEffect: 'none',
    });
    expect(onCommittedMutation.mock.calls[0][0]).not.toHaveProperty('fabricObject');
  });
});
