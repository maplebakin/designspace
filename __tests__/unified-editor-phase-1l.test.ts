import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fabric from 'fabric';
import {
  loadCanvasFromJsonSafely,
  reviveCustomFabricProps,
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
import { registerObjectEventHandlers } from '../src/editor/services/canvasEventService';
import { useEditorStore } from '../src/editor/state/editorStore';
import { useHistoryStore } from '../src/editor/state/useHistoryStore';
import { toSerializableObject } from '../src/editor/utils/serialization';

const createCanvas = () => {
  const element = document.createElement('canvas');
  element.width = 420;
  element.height = 320;
  document.body.appendChild(element);
  const canvas = new fabric.Canvas(element, {
    width: 420,
    height: 320,
    renderOnAddRemove: false,
  });

  return {
    canvas,
    dispose: () => {
      canvas.dispose();
      element.remove();
    },
  };
};

const installStoreCanvas = (canvas: fabric.Canvas) => {
  useEditorStore.setState({
    canvas,
    canvasReadyState: 'ready',
    canvasObjects: [],
    selectedObjectId: null,
    selectedLayerIds: [],
    layers: [],
    layersById: {},
    dirtyObjectsRef: new Set(),
    committedMutationObserver: null,
    currentLibraryProjectId: null,
    isDirty: false,
    changeRevision: 0,
    autoSaveStatus: 'idle',
    saveStatus: 'saved',
    syncLock: { isLocked: false, reason: null, queuedSync: false },
  });
  useHistoryStore.getState().resetHistory();
  useHistoryStore.getState().takeSnapshot();
};

const addPersistedObjects = async (canvas: fabric.Canvas) => {
  const first = new fabric.Rect({
    id: 'shape-a',
    left: 40,
    top: 50,
    width: 80,
    height: 50,
    fill: '#ff0000',
  });
  const second = new fabric.Rect({
    id: 'shape-b',
    left: 180,
    top: 120,
    width: 90,
    height: 60,
    fill: '#0000ff',
  });
  canvas.add(first, second);
  useEditorStore.getState().syncCanvasToStore(canvas);
  useEditorStore.getState().saveState();
  await vi.advanceTimersByTimeAsync(350);

  // Establish a clean diagnostic/legacy baseline without changing the history
  // snapshot that the command replay tests use.
  useEditorStore.setState({
    isDirty: false,
    changeRevision: 0,
    autoSaveStatus: 'idle',
    saveStatus: 'saved',
  });
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('Unified Editor Phase 1L Canvas grouping observation', () => {
  const originalCanvasState = useEditorStore.getState();
  const originalHistoryState = useHistoryStore.getState();

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    useEditorStore.setState(originalCanvasState, true);
    useHistoryStore.setState(originalHistoryState, true);
    vi.useRealTimers();
  });

  it('maps one Group command to one semantic transaction while suppressing Fabric churn', async () => {
    const { canvas, dispose } = createCanvas();
    installStoreCanvas(canvas);
    await addPersistedObjects(canvas);

    const coordinator = createProjectChangeCoordinator();
    const diagnostic = createProjectChangeDiagnosticObserver({ coordinator });
    diagnostic.observeSession({
      projectId: 'canvas-group-project',
      legacyDirty: false,
      legacySaveStatus: 'saved',
    });

    const committed = vi.fn((mutation) => {
      if (mutation.action !== 'group-freeform-objects' && mutation.action !== 'ungroup-freeform-objects') {
        return;
      }
      observeCommittedEngineChange(coordinator, {
        projectId: 'canvas-group-project',
        source: 'canvas',
        action: mutation.action,
        pageIds: ['canvas-page'],
        domains: ['freeform-content'],
        target: { kind: 'freeform-group', id: mutation.groupId },
        assetEffect: 'none',
      });
    });
    const lifecycleCommitted = vi.fn();
    const lifecycle = registerObjectEventHandlers({
      canvas,
      callbacks: { onCommittedMutation: lifecycleCommitted },
    });
    const events: string[] = [];
    canvas.on('object:removed', () => events.push('object:removed'));
    canvas.on('object:added', () => events.push('object:added'));
    canvas.on('object:modified', () => events.push('object:modified'));
    useEditorStore.getState().setCommittedMutationObserver(committed);
    useEditorStore.getState().selectObjectsByIds(['shape-a', 'shape-b']);

    useEditorStore.getState().groupSelectedObjects();
    await vi.advanceTimersByTimeAsync(350);

    const group = canvas.getObjects().find((object) => object.type === 'group') as fabric.Group;
    const groupId = (group as any).id as string;
    expect(groupId).toBeTruthy();
    expect(group.getObjects().map((object) => (object as any).id)).toEqual(['shape-a', 'shape-b']);
    expect(events).toEqual(['object:removed', 'object:removed', 'object:added']);
    expect(lifecycleCommitted).not.toHaveBeenCalled();
    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledWith({
      action: 'group-freeform-objects',
      groupId,
    });
    expect(diagnostic.view.getSnapshot()).toMatchObject({
      observedRevision: 1,
      committedTransactionCount: 1,
      lastCommittedTransaction: expect.objectContaining({
        action: 'group-freeform-objects',
        domains: ['freeform-content'],
        target: { kind: 'freeform-group', id: groupId },
        assetEffect: 'none',
      }),
      coverage: {
        canvasGrouping: true,
        canvasUngrouping: true,
        completeAuthoredCoverage: false,
      },
    });
    expect(useEditorStore.getState()).toMatchObject({
      isDirty: true,
      changeRevision: 1,
    });
    expect(group.toObject(['id']).id).toBe(groupId);
    expect((toSerializableObject(group) as any).objects.map((object: any) => object.id))
      .toEqual(['shape-a', 'shape-b']);

    lifecycle.cleanup();
    diagnostic.dispose();
    coordinator.dispose();
    dispose();
  });

  it('maps one Ungroup command to one semantic transaction and preserves child IDs', async () => {
    const { canvas, dispose } = createCanvas();
    installStoreCanvas(canvas);
    await addPersistedObjects(canvas);

    const committed = vi.fn();
    useEditorStore.getState().setCommittedMutationObserver(committed);
    useEditorStore.getState().selectObjectsByIds(['shape-a', 'shape-b']);
    useEditorStore.getState().groupSelectedObjects();
    await vi.advanceTimersByTimeAsync(350);
    const group = canvas.getObjects()[0] as fabric.Group;
    const groupId = (group as any).id as string;
    committed.mockClear();
    useEditorStore.setState({
      isDirty: false,
      changeRevision: 0,
      autoSaveStatus: 'idle',
      saveStatus: 'saved',
    });

    useEditorStore.getState().ungroupSelectedObjects();
    await vi.advanceTimersByTimeAsync(350);

    expect(canvas.getObjects().map((object) => (object as any).id)).toEqual(['shape-a', 'shape-b']);
    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledWith({
      action: 'ungroup-freeform-objects',
      groupId,
    });
    expect(useEditorStore.getState()).toMatchObject({
      isDirty: true,
      changeRevision: 1,
    });

    dispose();
  });

  it('does not observe invalid Group/Ungroup commands', async () => {
    const { canvas, dispose } = createCanvas();
    installStoreCanvas(canvas);
    await addPersistedObjects(canvas);
    const committed = vi.fn();
    useEditorStore.getState().setCommittedMutationObserver(committed);

    useEditorStore.getState().selectObjectById('shape-a');
    useEditorStore.getState().groupSelectedObjects();
    useEditorStore.getState().clearSelection();
    useEditorStore.getState().ungroupSelectedObjects();

    const emptyGroup = new fabric.Group([], { id: 'empty-group' });
    canvas.add(emptyGroup);
    canvas.setActiveObject(emptyGroup);
    useEditorStore.getState().ungroupSelectedObjects();

    expect(canvas.getObjects().map((object) => (object as any).id)).toEqual([
      'shape-a',
      'shape-b',
      'empty-group',
    ]);
    expect(committed).not.toHaveBeenCalled();

    dispose();
  });

  it('keeps grouping successful when the optional semantic observer throws', async () => {
    const { canvas, dispose } = createCanvas();
    installStoreCanvas(canvas);
    await addPersistedObjects(canvas);
    const committed = vi.fn(() => {
      throw new Error('diagnostic unavailable');
    });
    useEditorStore.getState().setCommittedMutationObserver(committed);
    useEditorStore.getState().selectObjectsByIds(['shape-a', 'shape-b']);

    useEditorStore.getState().groupSelectedObjects();

    expect(canvas.getObjects()[0]?.type).toBe('group');
    expect(committed).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState().isDirty).toBe(true);

    dispose();
  });

  it('keeps nested Group operations semantic and does not add member-specific actions', async () => {
    const { canvas, dispose } = createCanvas();
    installStoreCanvas(canvas);
    await addPersistedObjects(canvas);
    canvas.add(new fabric.Rect({
      id: 'shape-c',
      left: 300,
      top: 180,
      width: 40,
      height: 40,
      fill: '#00aa00',
    }));
    useEditorStore.getState().syncCanvasToStore(canvas);
    const committed = vi.fn();
    useEditorStore.getState().setCommittedMutationObserver(committed);

    useEditorStore.getState().selectObjectsByIds(['shape-a', 'shape-b']);
    useEditorStore.getState().groupSelectedObjects();
    const innerGroup = canvas.getObjects().find((object) => object.type === 'group') as fabric.Group;
    const shapeC = canvas.getObjects().find((object) => (object as any).id === 'shape-c');
    canvas.setActiveObject(new fabric.ActiveSelection([innerGroup, shapeC!], { canvas }));
    useEditorStore.getState().groupSelectedObjects();

    const outerGroup = canvas.getObjects().find((object) => object.type === 'group') as fabric.Group;
    expect(outerGroup).toBeTruthy();
    expect(outerGroup.getObjects().some((object) => object.type === 'group')).toBe(true);
    expect(committed).toHaveBeenCalledTimes(2);
    expect(committed.mock.calls.map(([mutation]) => mutation.action)).toEqual([
      'group-freeform-objects',
      'group-freeform-objects',
    ]);

    dispose();
  });

  it('uses the same content action for a mixed image and shape group without asset effects', async () => {
    const { canvas, dispose } = createCanvas();
    installStoreCanvas(canvas);
    await addPersistedObjects(canvas);
    const source = document.createElement('canvas');
    source.width = 24;
    source.height = 24;
    const image = new fabric.Image(source, {
      id: 'image-a',
      left: 260,
      top: 80,
      width: 24,
      height: 24,
    });
    canvas.add(image);
    useEditorStore.getState().syncCanvasToStore(canvas);
    const committed = vi.fn();
    useEditorStore.getState().setCommittedMutationObserver(committed);
    useEditorStore.getState().selectObjectsByIds(['image-a', 'shape-a']);

    useEditorStore.getState().groupSelectedObjects();

    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed.mock.calls[0][0]).toEqual({
      action: 'group-freeform-objects',
      groupId: expect.any(String),
    });
    expect(committed.mock.calls[0][0]).not.toHaveProperty('assetEffect');

    dispose();
  });

  it('keeps Group/Ungroup history replay silent', async () => {
    const { canvas, dispose } = createCanvas();
    installStoreCanvas(canvas);
    await addPersistedObjects(canvas);
    const committed = vi.fn();
    useEditorStore.getState().setCommittedMutationObserver(committed);
    useEditorStore.getState().selectObjectsByIds(['shape-a', 'shape-b']);

    useEditorStore.getState().groupSelectedObjects();
    await vi.advanceTimersByTimeAsync(350);
    expect(committed).toHaveBeenCalledTimes(1);

    await useEditorStore.getState().undo();
    await flushPromises();
    await useEditorStore.getState().redo();
    await flushPromises();
    expect(committed).toHaveBeenCalledTimes(1);

    const groupId = (canvas.getObjects().find((object) => object.type === 'group') as any)?.id;
    expect(groupId).toBeTruthy();
    useEditorStore.getState().selectObjectById(groupId);
    useEditorStore.getState().ungroupSelectedObjects();
    await vi.advanceTimersByTimeAsync(350);
    expect(committed).toHaveBeenCalledTimes(2);

    await useEditorStore.getState().undo();
    await flushPromises();
    await useEditorStore.getState().redo();
    await flushPromises();
    expect(committed).toHaveBeenCalledTimes(2);

    dispose();
  });

  it('hydrates a saved group without authored Group/Ungroup observations', async () => {
    const first = createCanvas();
    installStoreCanvas(first.canvas);
    await addPersistedObjects(first.canvas);
    useEditorStore.getState().selectObjectsByIds(['shape-a', 'shape-b']);
    useEditorStore.getState().groupSelectedObjects();
    await vi.advanceTimersByTimeAsync(350);
    const serialized = {
      version: fabric.version,
      objects: first.canvas.getObjects().map((object) => toSerializableObject(object)),
    };
    const groupId = (first.canvas.getObjects()[0] as any).id;
    first.dispose();

    const reopened = createCanvas();
    installStoreCanvas(reopened.canvas);
    const committed = vi.fn();
    const lifecycleCommitted = vi.fn();
    const lifecycle = registerObjectEventHandlers({
      canvas: reopened.canvas,
      callbacks: { onCommittedMutation: lifecycleCommitted },
    });
    useEditorStore.getState().setCommittedMutationObserver(committed);

    await loadCanvasFromJsonSafely(reopened.canvas, serialized, reviveCustomFabricProps);
    useEditorStore.getState().syncCanvasToStore(reopened.canvas);

    const hydratedGroup = reopened.canvas.getObjects()[0] as fabric.Group;
    expect((hydratedGroup as any).id).toBe(groupId);
    expect(hydratedGroup.getObjects().map((object) => (object as any).id)).toEqual(['shape-a', 'shape-b']);
    expect(committed).not.toHaveBeenCalled();
    expect(lifecycleCommitted).not.toHaveBeenCalled();

    lifecycle.cleanup();
    reopened.dispose();
  });
});
