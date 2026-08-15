import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fabric from 'fabric';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { ContextMenu } from '../src/editor/components/ContextMenu';
import { LayersPanel } from '../src/editor/components/LayersPanel';
import { SelectionToolbar } from '../src/editor/components/SelectionToolbar';
import {
  loadCanvasFromJsonSafely,
  reviveCustomFabricProps,
} from '../src/editor/fabric/initFabricCanvas';
import {
  observeCommittedEngineChange,
} from '../src/editor/session/projectChangeAdapters';
import {
  createProjectChangeCoordinator,
} from '../src/editor/session/projectChangeCoordinator';
import {
  createProjectChangeDiagnosticObserver,
} from '../src/editor/session/projectChangeDiagnostic';
import { registerObjectEventHandlers } from '../src/editor/services/canvasEventService';
import {
  bringForward,
  bringToFront,
  sendBackward,
  sendToBack,
} from '../src/editor/services/clipboardService';
import { useEditorStore } from '../src/editor/state/editorStore';
import { useHistoryStore } from '../src/editor/state/useHistoryStore';
import { toSerializableObject } from '../src/editor/utils/serialization';

type CanvasHarness = {
  canvas: fabric.Canvas;
  element: HTMLCanvasElement;
};

type DiagnosticHarness = {
  coordinator: ReturnType<typeof createProjectChangeCoordinator>;
  diagnostic: ReturnType<typeof createProjectChangeDiagnosticObserver>;
  committed: ReturnType<typeof vi.fn>;
};

const originalEditorState = useEditorStore.getState();
const originalHistoryState = useHistoryStore.getState();
const canvases: CanvasHarness[] = [];
const diagnostics: DiagnosticHarness[] = [];

const acceptedActions = new Set([
  'modify-freeform-visibility',
  'move-freeform-forward',
  'move-freeform-backward',
  'bring-freeform-to-front',
  'send-freeform-to-back',
  'reorder-freeform-object',
  'modify-freeform-selection-lock',
]);

const createCanvas = (): fabric.Canvas => {
  const element = document.createElement('canvas');
  element.width = 520;
  element.height = 360;
  document.body.appendChild(element);
  const canvas = new fabric.Canvas(element, {
    width: 520,
    height: 360,
    renderOnAddRemove: false,
  });
  canvases.push({ canvas, element });
  return canvas;
};

const installCanvas = (canvas: fabric.Canvas) => {
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
    hasLayerSyncHandler: false,
    layerSyncHandler: null,
  });
  useHistoryStore.getState().resetHistory();
  useHistoryStore.getState().takeSnapshot();
};

const createShape = (id: string, overrides: Record<string, unknown> = {}) => (
  new fabric.Rect({
    id,
    left: 40,
    top: 50,
    width: 90,
    height: 60,
    fill: '#3366ff',
    visible: true,
    selectable: true,
    evented: true,
    lockMovementX: false,
    lockMovementY: false,
    lockRotation: false,
    lockScalingX: false,
    lockScalingY: false,
    lockSkewingX: false,
    lockSkewingY: false,
    hasControls: true,
    ...overrides,
  } as any)
);

const seedShapes = (
  canvas: fabric.Canvas,
  ids = ['bottom', 'middle', 'top']
) => {
  const shapes = ids.map((id, index) => createShape(id, {
    left: 40 + (index * 120),
  }));
  canvas.add(...shapes);
  useEditorStore.getState().syncCanvasToStore(canvas);
  useEditorStore.getState().selectObjectById(ids[0]);
  useHistoryStore.getState().resetHistory();
  useHistoryStore.getState().takeSnapshot();
  useEditorStore.setState({
    isDirty: false,
    changeRevision: 0,
    autoSaveStatus: 'idle',
    saveStatus: 'saved',
  });
  return shapes;
};

const userOrder = (canvas: fabric.Canvas) => canvas.getObjects()
  .map((object) => (object as any).id)
  .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

const installDiagnostic = (projectId = 'canvas-coverage-sweep-project'): DiagnosticHarness => {
  const coordinator = createProjectChangeCoordinator();
  const diagnostic = createProjectChangeDiagnosticObserver({ coordinator });
  diagnostic.observeSession({
    projectId,
    legacyDirty: false,
    legacySaveStatus: 'saved',
  });
  const committed = vi.fn((mutation: any) => {
    if (!acceptedActions.has(mutation.action)) return;
    observeCommittedEngineChange(coordinator, {
      projectId,
      source: 'canvas',
      action: mutation.action,
      pageIds: ['canvas-page'],
      domains: ['freeform-content'],
      target: { kind: 'freeform-object', id: mutation.objectId },
      assetEffect: 'none',
    });
  });
  useEditorStore.getState().setCommittedMutationObserver(committed);
  const harness = { coordinator, diagnostic, committed };
  diagnostics.push(harness);
  return harness;
};

const expectTransaction = (
  diagnostic: DiagnosticHarness,
  action: string,
  objectId: string,
) => {
  expect(diagnostic.view.getSnapshot().lastCommittedTransaction).toMatchObject({
    source: 'canvas',
    action,
    domains: ['freeform-content'],
    target: { kind: 'freeform-object', id: objectId },
    assetEffect: 'none',
    status: 'committed',
  });
};

const expectSelectionLockState = (object: fabric.Object, locked: boolean) => {
  expect(object.lockMovementX).toBe(locked);
  expect(object.lockMovementY).toBe(locked);
  expect(object.lockRotation).toBe(locked);
  expect(object.lockScalingX).toBe(locked);
  expect(object.lockScalingY).toBe(locked);
  expect(object.lockSkewingX).toBe(locked);
  expect(object.lockSkewingY).toBe(locked);
  expect(object.hasControls).toBe(!locked);
  expect(object.selectable).toBe(!locked);
};

describe('Unified Editor Canvas coverage sweep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    cleanup();
    diagnostics.splice(0).forEach(({ coordinator, diagnostic }) => {
      diagnostic.dispose();
      coordinator.dispose();
    });
    canvases.splice(0).forEach(({ canvas, element }) => {
      canvas.dispose();
      element.remove();
    });
    useEditorStore.setState(originalEditorState, true);
    useHistoryStore.setState(originalHistoryState, true);
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('observes Visibility hide and show exactly once with persisted store state', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const [shape] = seedShapes(canvas, ['visibility-shape']);
    const { diagnostic, committed } = installDiagnostic();

    render(React.createElement(LayersPanel));
    const layer = screen.getByTestId('layer-item');
    act(() => {
      fireEvent.click(within(layer).getByTestId('layer-toggle-visibility'));
    });

    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledWith({
      action: 'modify-freeform-visibility',
      objectId: 'visibility-shape',
    });
    expectTransaction(diagnostic, 'modify-freeform-visibility', 'visibility-shape');
    expect(shape.visible).toBe(false);
    expect(useEditorStore.getState().canvasObjects[0].visible).toBe(false);
    expect(useEditorStore.getState().layers[0].visible).toBe(false);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(1);

    act(() => {
      fireEvent.click(within(screen.getByTestId('layer-item')).getByTestId('layer-toggle-visibility'));
    });

    expect(committed).toHaveBeenCalledTimes(2);
    expect(shape.visible).toBe(true);
    expect(useEditorStore.getState().canvasObjects[0].visible).toBe(true);
    expect(useEditorStore.getState().layers[0].visible).toBe(true);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(2);
  });

  it('keeps hiding a selected object selection churn-free and preserves legacy dirty/history behavior', async () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    seedShapes(canvas, ['visibility-shape']);
    const { diagnostic, committed } = installDiagnostic();

    render(React.createElement(LayersPanel));
    act(() => {
      fireEvent.click(within(screen.getByTestId('layer-item')).getByTestId('layer-toggle-visibility'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(committed).toHaveBeenCalledTimes(1);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(1);
    expect(useEditorStore.getState()).toMatchObject({
      isDirty: true,
      changeRevision: 1,
      autoSaveStatus: 'dirty',
    });
    expect(useHistoryStore.getState().canUndo()).toBe(true);
    expect(useEditorStore.getState().selectedObjectId).toBeNull();
  });

  it('keeps Visibility hydration, reopen, undo, redo, and teardown silent', async () => {
    const sourceCanvas = createCanvas();
    installCanvas(sourceCanvas);
    const [shape] = seedShapes(sourceCanvas, ['visibility-shape']);
    const { diagnostic, committed } = installDiagnostic('visibility-reopen-project');

    render(React.createElement(LayersPanel));
    act(() => {
      fireEvent.click(within(screen.getByTestId('layer-item')).getByTestId('layer-toggle-visibility'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
      await useEditorStore.getState().undo();
      await useEditorStore.getState().redo();
    });

    expect(committed).toHaveBeenCalledTimes(1);
    expect((sourceCanvas.getObjects()[0] as any).visible).toBe(false);

    const serialized = {
      version: fabric.version,
      objects: sourceCanvas.getObjects().map((object) => toSerializableObject(object)),
    };
    const reopenedCanvas = createCanvas();
    installCanvas(reopenedCanvas);
    useEditorStore.getState().setCommittedMutationObserver(committed);
    await loadCanvasFromJsonSafely(reopenedCanvas, serialized, reviveCustomFabricProps);
    useEditorStore.getState().syncCanvasToStore(reopenedCanvas);

    expect((reopenedCanvas.getObjects()[0] as any).visible).toBe(false);
    expect(useEditorStore.getState().canvasObjects[0].visible).toBe(false);
    expect(committed).toHaveBeenCalledTimes(1);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(1);

    useEditorStore.getState().setCanvasReadyState('disposing');
    useEditorStore.getState().reportCommittedCanvasVisibility(shape.id as string, true);
    expect(committed).toHaveBeenCalledTimes(1);
  });

  it('keeps invalid Visibility targets and observer failure isolated', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const [shape] = seedShapes(canvas, ['visibility-shape']);
    const systemObject = createShape('system-border', { isPageBorder: true });
    canvas.add(systemObject);
    useEditorStore.getState().syncCanvasToStore(canvas);
    const committed = vi.fn(() => {
      throw new Error('diagnostic unavailable');
    });
    useEditorStore.getState().setCommittedMutationObserver(committed);

    useEditorStore.getState().reportCommittedCanvasVisibility('missing', false);
    useEditorStore.getState().reportCommittedCanvasVisibility('system-border', false);
    useEditorStore.getState().setCanvasReadyState('ready');
    render(React.createElement(LayersPanel));
    act(() => {
      fireEvent.click(within(screen.getByTestId('layer-item')).getByTestId('layer-toggle-visibility'));
    });

    expect(committed).toHaveBeenCalledTimes(1);
    expect(shape.visible).toBe(false);
    expect(useEditorStore.getState().canvasObjects.find((object) => object.id === shape.id)?.visible).toBe(false);
    expect(useEditorStore.getState().isDirty).toBe(true);
  });

  it('converges Layers Move Up/Down and Context/Toolbar relative z-order commands', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shapes = seedShapes(canvas);
    const { diagnostic, committed } = installDiagnostic();

    act(() => {
      useEditorStore.getState().selectObjectById('bottom');
    });
    render(React.createElement(LayersPanel));

    const layerItems = screen.getAllByTestId('layer-item');
    const bottomLayer = layerItems.find((item) => item.getAttribute('data-layer-id') === 'bottom');
    if (!bottomLayer) throw new Error('Bottom layer was not rendered');
    act(() => {
      fireEvent.click(within(bottomLayer).getByTestId('layer-move-up'));
    });
    expect(committed).toHaveBeenCalledWith({
      action: 'move-freeform-forward',
      objectId: 'bottom',
    });
    expect(userOrder(canvas)).toEqual(['middle', 'bottom', 'top']);

    act(() => {
      fireEvent.click(within(screen.getAllByTestId('layer-item').find((item) => item.getAttribute('data-layer-id') === 'bottom')!).getByTestId('layer-move-down'));
    });
    expect(committed).toHaveBeenCalledWith({
      action: 'move-freeform-backward',
      objectId: 'bottom',
    });
    expect(userOrder(canvas)).toEqual(['bottom', 'middle', 'top']);

    act(() => {
      useEditorStore.getState().selectObjectById('middle');
    });
    cleanup();
    render(React.createElement(ContextMenu, { x: 10, y: 10, onClose: vi.fn() }));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Bring Forward' }));
    });
    expect(committed).toHaveBeenCalledWith({
      action: 'move-freeform-forward',
      objectId: 'middle',
    });

    act(() => {
      useEditorStore.getState().selectObjectById('bottom');
    });
    cleanup();
    render(React.createElement(SelectionToolbar));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Bring to Front' }));
    });
    expect(committed).toHaveBeenCalledWith({
      action: 'bring-freeform-to-front',
      objectId: 'bottom',
    });
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(4);
    expect(shapes).toHaveLength(3);
  });

  it('observes Context Menu absolute z-order commands exactly once and treats boundary commands as no-ops', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    seedShapes(canvas);
    const { diagnostic, committed } = installDiagnostic();

    useEditorStore.getState().selectObjectById('bottom');
    render(React.createElement(ContextMenu, { x: 10, y: 10, onClose: vi.fn() }));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Bring to Front' }));
    });
    expectTransaction(diagnostic, 'bring-freeform-to-front', 'bottom');
    expect(committed).toHaveBeenCalledTimes(1);

    useEditorStore.getState().selectObjectById('bottom');
    cleanup();
    render(React.createElement(ContextMenu, { x: 10, y: 10, onClose: vi.fn() }));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Bring to Front' }));
    });
    expect(committed).toHaveBeenCalledTimes(1);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(1);

    useEditorStore.getState().selectObjectById('bottom');
    cleanup();
    render(React.createElement(ContextMenu, { x: 10, y: 10, onClose: vi.fn() }));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Send to Back' }));
    });
    expect(committed).toHaveBeenCalledTimes(2);
    expectTransaction(diagnostic, 'send-freeform-to-back', 'bottom');

    useEditorStore.getState().selectObjectById('bottom');
    cleanup();
    render(React.createElement(ContextMenu, { x: 10, y: 10, onClose: vi.fn() }));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Send to Back' }));
    });
    expect(committed).toHaveBeenCalledTimes(2);
  });

  it('keeps multi-selection z-order legacy-owned because the shadow target is singular', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    seedShapes(canvas);
    const { diagnostic, committed } = installDiagnostic();

    useEditorStore.getState().selectObjectsByIds(['bottom', 'middle']);
    bringToFront();

    expect(userOrder(canvas)).toEqual(['top', 'bottom', 'middle']);
    expect(committed).not.toHaveBeenCalled();
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(0);
  });

  it('observes one completed Layers drag reorder with a stable moved-object target', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    seedShapes(canvas);
    const { diagnostic, committed } = installDiagnostic();
    render(React.createElement(LayersPanel));

    const source = screen.getAllByTestId('layer-item')
      .find((item) => item.getAttribute('data-layer-id') === 'top');
    const target = screen.getAllByTestId('layer-item')
      .find((item) => item.getAttribute('data-layer-id') === 'bottom');
    if (!source || !target) throw new Error('Drag source or target layer was not rendered');
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      getData: vi.fn(() => 'top'),
    };

    act(() => {
      fireEvent.dragStart(source, { dataTransfer });
      fireEvent.dragOver(target, { dataTransfer });
      fireEvent.drop(target, { dataTransfer });
    });

    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledWith({
      action: 'reorder-freeform-object',
      objectId: 'top',
    });
    expectTransaction(diagnostic, 'reorder-freeform-object', 'top');
    expect(userOrder(canvas)).toEqual(['top', 'bottom', 'middle']);
    expect(useEditorStore.getState().canvasObjects.map((object) => object.id)).toEqual(userOrder(canvas));
  });

  it('keeps z-order and drag replay/reopen silent while preserving dirty history', async () => {
    const sourceCanvas = createCanvas();
    installCanvas(sourceCanvas);
    seedShapes(sourceCanvas);
    const { diagnostic, committed } = installDiagnostic('z-order-reopen-project');

    useEditorStore.getState().selectObjectById('bottom');
    bringForward();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
      await useEditorStore.getState().undo();
      await useEditorStore.getState().redo();
    });
    expect(committed).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState()).toMatchObject({
      isDirty: true,
      changeRevision: 1,
    });
    // The legacy diff history does not encode object-array order. The sweep
    // preserves that behavior while proving replay attempts remain silent.
    expect(useHistoryStore.getState().canUndo()).toBe(false);

    const serialized = {
      version: fabric.version,
      objects: sourceCanvas.getObjects().map((object) => toSerializableObject(object)),
    };
    const reopenedCanvas = createCanvas();
    installCanvas(reopenedCanvas);
    useEditorStore.getState().setCommittedMutationObserver(committed);
    await loadCanvasFromJsonSafely(reopenedCanvas, serialized, reviveCustomFabricProps);
    useEditorStore.getState().syncCanvasToStore(reopenedCanvas);

    expect(userOrder(reopenedCanvas)).toEqual(['middle', 'bottom', 'top']);
    expect(committed).toHaveBeenCalledTimes(1);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(1);

    useEditorStore.getState().setCanvasReadyState('disposing');
    useEditorStore.getState().reportCommittedCanvasZOrder(
      'bottom',
      'move-freeform-forward',
      ['middle', 'bottom', 'top'],
      ['middle', 'bottom', 'top'],
    );
    expect(committed).toHaveBeenCalledTimes(1);
  });

  it('isolates z-order observer failure and invalid targets from legacy ordering', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    seedShapes(canvas);
    const committed = vi.fn(() => {
      throw new Error('diagnostic unavailable');
    });
    useEditorStore.getState().setCommittedMutationObserver(committed);
    useEditorStore.getState().selectObjectById('bottom');

    bringForward();
    canvas.discardActiveObject();
    useEditorStore.getState().selectObjectById('missing');
    bringForward();

    expect(committed).toHaveBeenCalledTimes(1);
    expect(userOrder(canvas)).toEqual(['middle', 'bottom', 'top']);
    expect(useEditorStore.getState().isDirty).toBe(true);
  });

  it('observes Context Menu Selection Lock with the complete legacy postcondition', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const [shape] = seedShapes(canvas, ['selection-lock-shape']);
    const eventedBefore = shape.evented;
    const { diagnostic, committed } = installDiagnostic();

    render(React.createElement(ContextMenu, { x: 10, y: 10, onClose: vi.fn() }));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Lock Selection' }));
    });

    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledWith({
      action: 'modify-freeform-selection-lock',
      objectId: 'selection-lock-shape',
    });
    expectTransaction(diagnostic, 'modify-freeform-selection-lock', 'selection-lock-shape');
    expectSelectionLockState(shape, true);
    expect(shape.evented).toBe(eventedBefore);
    expect(canvas.getActiveObject()).toBeUndefined();
    expect(useEditorStore.getState().selectedObjectId).toBeNull();
    expect(useEditorStore.getState().canvasObjects[0]).toMatchObject({
      id: 'selection-lock-shape',
      selectable: false,
      evented: eventedBefore,
      lockSkewingX: true,
      lockSkewingY: true,
    });
  });

  it('converges Shift-click Layers Selection Lock and Unlock on the same command', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const [shape] = seedShapes(canvas, ['selection-lock-shape']);
    const { diagnostic, committed } = installDiagnostic();
    render(React.createElement(LayersPanel));

    act(() => {
      fireEvent.click(screen.getByTestId('layer-toggle-lock'), { shiftKey: true });
    });
    expectSelectionLockState(shape, true);
    expect(committed).toHaveBeenCalledTimes(1);

    act(() => {
      fireEvent.click(screen.getByTestId('layer-toggle-lock'), { shiftKey: true });
    });
    expectSelectionLockState(shape, false);
    expect(committed).toHaveBeenCalledTimes(2);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(2);
    expect(committed).toHaveBeenLastCalledWith({
      action: 'modify-freeform-selection-lock',
      objectId: 'selection-lock-shape',
    });
  });

  it('characterizes the current Context Menu Selection Unlock limitation without inventing a UI fix', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const [shape] = seedShapes(canvas, ['selection-lock-shape']);
    const { diagnostic, committed } = installDiagnostic();

    render(React.createElement(ContextMenu, { x: 10, y: 10, onClose: vi.fn() }));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Lock Selection' }));
    });
    expect(shape.selectable).toBe(false);
    expect(committed).toHaveBeenCalledTimes(1);

    cleanup();
    render(React.createElement(ContextMenu, { x: 10, y: 10, onClose: vi.fn() }));
    expect(screen.getByRole('button', { name: 'Lock Selection' }).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Unlock Selection' })).toBeNull();
    expect(committed).toHaveBeenCalledTimes(1);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(1);
  });

  it('persists Selection Lock through reopen and keeps hydration silent', async () => {
    const sourceCanvas = createCanvas();
    installCanvas(sourceCanvas);
    const [shape] = seedShapes(sourceCanvas, ['selection-lock-shape']);
    const { diagnostic, committed } = installDiagnostic('selection-lock-reopen-project');

    useEditorStore.getState().toggleObjectLock(shape.id as string);
    expect(committed).toHaveBeenCalledTimes(1);
    const serialized = {
      version: fabric.version,
      objects: sourceCanvas.getObjects().map((object) => toSerializableObject(object)),
    };
    expect(serialized.objects[0]).toMatchObject({
      selectable: false,
      lockMovementX: true,
      lockSkewingX: true,
      hasControls: false,
    });

    const reopenedCanvas = createCanvas();
    installCanvas(reopenedCanvas);
    useEditorStore.getState().setCommittedMutationObserver(committed);
    await loadCanvasFromJsonSafely(reopenedCanvas, serialized, reviveCustomFabricProps);
    useEditorStore.getState().syncCanvasToStore(reopenedCanvas);

    expectSelectionLockState(reopenedCanvas.getObjects()[0], true);
    expect(committed).toHaveBeenCalledTimes(1);

    useEditorStore.getState().toggleObjectLock('selection-lock-shape');
    expectSelectionLockState(reopenedCanvas.getObjects()[0], false);
    expect(committed).toHaveBeenCalledTimes(2);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(2);
  });

  it('keeps Selection Lock history replay, teardown, invalid targets, and observer failure safe', async () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const [shape] = seedShapes(canvas, ['selection-lock-shape']);
    const { diagnostic, committed } = installDiagnostic();

    useEditorStore.getState().toggleObjectLock(shape.id as string);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
      await useEditorStore.getState().undo();
      await useEditorStore.getState().redo();
    });
    expect(committed).toHaveBeenCalledTimes(1);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(1);

    useEditorStore.getState().reportCommittedCanvasSelectionLock('missing', true, true);
    useEditorStore.getState().setCanvasReadyState('disposing');
    useEditorStore.getState().reportCommittedCanvasSelectionLock(shape.id as string, true, true);
    expect(committed).toHaveBeenCalledTimes(1);

    useEditorStore.setState({ canvasReadyState: 'ready' });
    const throwingObserver = vi.fn(() => {
      throw new Error('diagnostic unavailable');
    });
    useEditorStore.getState().setCommittedMutationObserver(throwingObserver);
    useEditorStore.getState().toggleObjectLock(shape.id as string);
    expect(throwingObserver).toHaveBeenCalledTimes(1);
    expectSelectionLockState(shape, false);
    expect(useEditorStore.getState().isDirty).toBe(true);
  });

  it('treats every valid Selection Lock toggle as a state change and keeps system objects unobserved', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const [shape] = seedShapes(canvas, ['selection-lock-shape']);
    const systemObject = createShape('system-guide', { isGuide: true });
    canvas.add(systemObject);
    useEditorStore.getState().syncCanvasToStore(canvas);
    const { diagnostic, committed } = installDiagnostic();

    useEditorStore.getState().toggleObjectLock(shape.id as string);
    useEditorStore.getState().toggleObjectLock(shape.id as string);
    useEditorStore.getState().toggleObjectLock('system-guide');

    expect(committed).toHaveBeenCalledTimes(2);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(2);
    expectSelectionLockState(shape, false);
    expectSelectionLockState(systemObject, true);
  });

  it('reports the sweep coverage fields and preserves explicit deferred gaps', () => {
    const coordinator = createProjectChangeCoordinator();
    const diagnostic = createProjectChangeDiagnosticObserver({ coordinator });
    diagnostic.observeSession({
      projectId: 'coverage-project',
      legacyDirty: false,
      legacySaveStatus: 'saved',
    });

    const coverage = diagnostic.view.getSnapshot().coverage;
    expect(coverage).toMatchObject({
      canvasBorderStyle: true,
      canvasTransformLock: true,
      canvasThemeColorLock: true,
      canvasVisibility: true,
      canvasZOrder: true,
      canvasLayerReorder: true,
      canvasSelectionLock: true,
      completeAuthoredCoverage: false,
    });
    expect(coverage.unobservedAuthoredChangeCategories).toEqual(
      expect.arrayContaining([
        'Canvas multi-selection z-order and other reorder paths',
        'Canvas full-object lock and unsupported Selection Lock invocation paths',
        'Canvas native fill, stroke, shadow, and gradient colour pickers',
        'Canvas theme-token linking, unlinking, reset, and global theme application',
        'Canvas font-size, corner-radius, style presets, and image-reset commands',
        'Document native paper/text/drop-cap colour pickers',
      ])
    );
    expect(coverage.unobservedAuthoredChangeCategories).not.toContain('Canvas Selection Lock and full-object lock');

    diagnostic.dispose();
    coordinator.dispose();
  });

  it('keeps Canvas event-service teardown silent for the accepted families', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    seedShapes(canvas);
    const { committed } = installDiagnostic();
    const lifecycle = registerObjectEventHandlers({
      canvas,
      callbacks: { onCommittedMutation: committed },
    });

    lifecycle.cleanup();
    useEditorStore.getState().setCanvasReadyState('disposing');
    useEditorStore.getState().reportCommittedCanvasVisibility('bottom', false);
    useEditorStore.getState().reportCommittedCanvasZOrder(
      'bottom',
      'move-freeform-forward',
      ['bottom', 'middle', 'top'],
      ['middle', 'bottom', 'top'],
    );
    useEditorStore.getState().reportCommittedCanvasSelectionLock('bottom', true, true);

    expect(committed).not.toHaveBeenCalled();
  });
});
