import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fabric from 'fabric';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContextMenu } from '../src/editor/components/ContextMenu';
import { LayersPanel } from '../src/editor/components/LayersPanel';
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

const createCanvas = (): fabric.Canvas => {
  const element = document.createElement('canvas');
  element.width = 420;
  element.height = 320;
  document.body.appendChild(element);
  const canvas = new fabric.Canvas(element, {
    width: 420,
    height: 320,
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

const seedShape = (
  canvas: fabric.Canvas,
  id = 'transform-lock-shape',
  locked = false
) => {
  const shape = new fabric.Rect({
    id,
    left: 40,
    top: 50,
    width: 100,
    height: 70,
    fill: '#ff0000',
    lockMovementX: locked,
    lockMovementY: locked,
    lockRotation: locked,
    lockScalingX: locked,
    lockScalingY: locked,
    lockSkewingX: false,
    lockSkewingY: false,
    hasControls: !locked,
    selectable: true,
    evented: true,
  });
  canvas.add(shape);
  useEditorStore.getState().syncCanvasToStore(canvas);
  useEditorStore.getState().selectObjectById(id);
  useHistoryStore.getState().resetHistory();
  useHistoryStore.getState().takeSnapshot();
  useEditorStore.setState({
    isDirty: false,
    changeRevision: 0,
    autoSaveStatus: 'idle',
    saveStatus: 'saved',
  });
  return shape;
};

const installDiagnostic = (projectId = 'transform-lock-project'): DiagnosticHarness => {
  const coordinator = createProjectChangeCoordinator();
  const diagnostic = createProjectChangeDiagnosticObserver({ coordinator });
  diagnostic.observeSession({
    projectId,
    legacyDirty: false,
    legacySaveStatus: 'saved',
  });
  const committed = vi.fn((mutation: any) => {
    if (mutation.action !== 'modify-freeform-transform-lock') return;
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

const expectTransformLockState = (object: fabric.Object, locked: boolean) => {
  expect(object.lockMovementX).toBe(locked);
  expect(object.lockMovementY).toBe(locked);
  expect(object.lockRotation).toBe(locked);
  expect(object.lockScalingX).toBe(locked);
  expect(object.lockScalingY).toBe(locked);
  expect(object.hasControls).toBe(!locked);
};

const getTransformTransaction = (diagnostic: DiagnosticHarness) => (
  diagnostic.view.getSnapshot().lastCommittedTransaction
);

describe('Unified Editor Phase 1N Canvas transform-lock observation', () => {
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

  it('observes one Layers Panel Lock Position command exactly once', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const { diagnostic, committed } = installDiagnostic();
    const lifecycleCommitted = vi.fn();
    const lifecycle = registerObjectEventHandlers({
      canvas,
      callbacks: { onCommittedMutation: lifecycleCommitted },
    });

    render(React.createElement(LayersPanel));
    act(() => {
      fireEvent.click(screen.getByTestId('layer-toggle-lock'));
    });

    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledWith({
      action: 'modify-freeform-transform-lock',
      objectId: 'transform-lock-shape',
    });
    expect(getTransformTransaction(diagnostic)).toMatchObject({
      source: 'canvas',
      action: 'modify-freeform-transform-lock',
      domains: ['freeform-content'],
      target: { kind: 'freeform-object', id: 'transform-lock-shape' },
      assetEffect: 'none',
      status: 'committed',
    });
    expectTransformLockState(shape, true);
    expect(useEditorStore.getState().canvasObjects[0]).toMatchObject({
      id: 'transform-lock-shape',
      lockMovementX: true,
      lockMovementY: true,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      hasControls: false,
    });
    expect(useEditorStore.getState().layers[0]).toMatchObject({
      id: 'transform-lock-shape',
      movementLocked: true,
    });
    expect(lifecycleCommitted).not.toHaveBeenCalled();
    lifecycle.cleanup();
  });

  it('observes one Layers Panel Unlock Position command exactly once', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas, 'transform-lock-shape', true);
    const { diagnostic, committed } = installDiagnostic();

    render(React.createElement(LayersPanel));
    act(() => {
      fireEvent.click(screen.getByTestId('layer-toggle-lock'));
    });

    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledWith({
      action: 'modify-freeform-transform-lock',
      objectId: 'transform-lock-shape',
    });
    expectTransformLockState(shape, false);
    expect(useEditorStore.getState().canvasObjects[0]).toMatchObject({
      lockMovementX: false,
      lockMovementY: false,
      lockRotation: false,
      lockScalingX: false,
      lockScalingY: false,
      hasControls: true,
    });
    expect(useEditorStore.getState().layers[0].movementLocked).toBe(false);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(1);
  });

  it('observes one Context Menu Lock Position command with the same semantics', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const { diagnostic, committed } = installDiagnostic();
    const onClose = vi.fn();

    render(React.createElement(ContextMenu, { x: 10, y: 10, onClose }));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Lock Position' }));
    });

    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledWith({
      action: 'modify-freeform-transform-lock',
      objectId: 'transform-lock-shape',
    });
    expect(getTransformTransaction(diagnostic)).toMatchObject({
      action: 'modify-freeform-transform-lock',
      domains: ['freeform-content'],
      target: { kind: 'freeform-object', id: 'transform-lock-shape' },
      assetEffect: 'none',
    });
    expectTransformLockState(shape, true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('observes one Context Menu Unlock Position command with the same semantics', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas, 'transform-lock-shape', true);
    const { diagnostic, committed } = installDiagnostic();

    render(React.createElement(ContextMenu, { x: 10, y: 10, onClose: vi.fn() }));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Unlock Position' }));
    });

    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledWith({
      action: 'modify-freeform-transform-lock',
      objectId: 'transform-lock-shape',
    });
    expectTransformLockState(shape, false);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(1);
  });

  it('keeps legacy dirty state and history while observing one command', async () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const { diagnostic, committed } = installDiagnostic();

    render(React.createElement(LayersPanel));
    act(() => {
      fireEvent.click(screen.getByTestId('layer-toggle-lock'));
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
    expect(useHistoryStore.getState().lastHistorySnapshot?.objects[0]).toMatchObject({
      id: 'transform-lock-shape',
      lockMovementX: true,
      lockRotation: true,
      lockScalingX: true,
      hasControls: false,
    });
    expectTransformLockState(shape, true);
  });

  it('does not observe missing, stale, system, or Context Menu no-selection targets', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const { committed } = installDiagnostic();

    useEditorStore.getState().toggleMovementLock('missing-object');
    useEditorStore.setState({ selectedObjectId: 'stale-object' });
    useEditorStore.getState().toggleMovementLock('stale-object');

    const systemObject = new fabric.Rect({
      id: 'system-border',
      width: 20,
      height: 20,
      isPageBorder: true,
    } as any);
    canvas.add(systemObject);
    useEditorStore.getState().toggleMovementLock('system-border');

    useEditorStore.getState().clearSelection();
    render(React.createElement(ContextMenu, { x: 10, y: 10, onClose: vi.fn() }));
    const lockButton = screen.getByRole('button', { name: 'Lock Position' });
    expect((lockButton as HTMLButtonElement).disabled).toBe(true);
    act(() => {
      fireEvent.click(lockButton);
    });

    expect(committed).not.toHaveBeenCalled();
    expect(shape.lockMovementX).toBe(false);
  });

  it('emits no transaction when the lock postcondition cannot be proven', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const { committed } = installDiagnostic();
    const originalSyncCanvasToStore = useEditorStore.getState().syncCanvasToStore;

    useEditorStore.setState({
      syncCanvasToStore: () => {
        shape.set('lockScalingY', false);
        originalSyncCanvasToStore(canvas);
      },
    });

    useEditorStore.getState().toggleMovementLock('transform-lock-shape');

    expect(committed).not.toHaveBeenCalled();
    expect(shape.lockMovementX).toBe(true);
    expect(shape.lockScalingY).toBe(false);
    expect(useEditorStore.getState().isDirty).toBe(true);
  });

  it('treats every valid toggle as a state-changing command rather than inventing a no-op boundary', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const { diagnostic, committed } = installDiagnostic();

    useEditorStore.getState().toggleMovementLock('transform-lock-shape');
    useEditorStore.getState().toggleMovementLock('transform-lock-shape');

    expect(committed).toHaveBeenCalledTimes(2);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(2);
    expectTransformLockState(shape, false);
  });

  it('isolates an observer failure from the legacy lock mutation', async () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const committed = vi.fn(() => {
      throw new Error('diagnostic unavailable');
    });
    useEditorStore.getState().setCommittedMutationObserver(committed);

    render(React.createElement(LayersPanel));
    act(() => {
      fireEvent.click(screen.getByTestId('layer-toggle-lock'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(committed).toHaveBeenCalledTimes(1);
    expectTransformLockState(shape, true);
    expect(useEditorStore.getState().canvasObjects[0].lockMovementX).toBe(true);
    expect(useEditorStore.getState()).toMatchObject({
      isDirty: true,
      changeRevision: 1,
    });
    expect(useEditorStore.getState().layers[0].movementLocked).toBe(true);
    expect(useHistoryStore.getState().canUndo()).toBe(true);
  });

  it('keeps history undo and redo replay silent', async () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const { diagnostic, committed } = installDiagnostic();

    render(React.createElement(LayersPanel));
    act(() => {
      fireEvent.click(screen.getByTestId('layer-toggle-lock'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
      await useEditorStore.getState().undo();
      await useEditorStore.getState().redo();
    });

    expect(committed).toHaveBeenCalledTimes(1);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(1);
    expectTransformLockState(canvas.getObjects()[0], true);
  });

  it('persists transform-lock fields through serialization and reopen without hydration observations', async () => {
    const sourceCanvas = createCanvas();
    installCanvas(sourceCanvas);
    const sourceShape = seedShape(sourceCanvas);
    const { diagnostic, committed } = installDiagnostic('reopen-transform-lock-project');

    useEditorStore.getState().toggleMovementLock('transform-lock-shape');
    expect(committed).toHaveBeenCalledTimes(1);
    const serialized = {
      version: fabric.version,
      objects: sourceCanvas.getObjects().map((object) => toSerializableObject(object)),
    };
    expect(serialized.objects[0]).toMatchObject({
      id: 'transform-lock-shape',
      lockMovementX: true,
      lockMovementY: true,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      hasControls: false,
    });

    const reopenedCanvas = createCanvas();
    installCanvas(reopenedCanvas);
    useEditorStore.getState().setCommittedMutationObserver(committed);
    await loadCanvasFromJsonSafely(reopenedCanvas, serialized, reviveCustomFabricProps);
    useEditorStore.getState().syncCanvasToStore(reopenedCanvas);

    const reopenedObject = reopenedCanvas.getObjects()[0];
    expectTransformLockState(reopenedObject, true);
    expect(useEditorStore.getState().canvasObjects[0]).toMatchObject({
      id: 'transform-lock-shape',
      lockMovementX: true,
      lockRotation: true,
      lockScalingX: true,
      hasControls: false,
    });
    expect(committed).toHaveBeenCalledTimes(1);

    useEditorStore.getState().toggleMovementLock('transform-lock-shape');
    expect(committed).toHaveBeenCalledTimes(2);
    expectTransformLockState(reopenedCanvas.getObjects()[0], false);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(2);
  });

  it('keeps page switching and Canvas event-service teardown silent', async () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const { diagnostic, committed } = installDiagnostic('page-switch-transform-lock-project');
    const lifecycle = registerObjectEventHandlers({
      canvas,
      callbacks: { onCommittedMutation: committed },
    });
    useEditorStore.setState({
      pages: [
        {
          id: 'canvas-page',
          name: 'Canvas Page',
          canvasData: { objects: [toSerializableObject(shape)], background: '#ffffff' },
          canvasSize: { width: 420, height: 320 },
        },
        {
          id: 'second-page',
          name: 'Second Page',
          canvasData: { objects: [], background: '#ffffff' },
          canvasSize: { width: 420, height: 320 },
        },
      ],
      activePageIndex: 0,
    });

    await useEditorStore.getState().switchToPage(1, { saveCurrent: false });
    await useEditorStore.getState().switchToPage(0, { saveCurrent: false });
    lifecycle.cleanup();

    expect(committed).not.toHaveBeenCalled();
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(0);
  });

  it('canonicalizes a partially inconsistent legacy lock state using lockMovementX', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    shape.set({
      lockMovementX: true,
      lockMovementY: false,
      lockRotation: false,
      lockScalingX: false,
      lockScalingY: false,
      hasControls: true,
    });
    useEditorStore.getState().syncCanvasToStore(canvas);
    useHistoryStore.getState().resetHistory();
    useHistoryStore.getState().takeSnapshot();
    useEditorStore.setState({ isDirty: false, changeRevision: 0 });
    const { committed } = installDiagnostic();

    useEditorStore.getState().toggleMovementLock('transform-lock-shape');

    expect(committed).toHaveBeenCalledTimes(1);
    expectTransformLockState(shape, false);
  });

  it('keeps Selection Lock separate from Transform Lock coverage', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const { committed } = installDiagnostic();

    render(React.createElement(LayersPanel));
    act(() => {
      fireEvent.click(screen.getByTestId('layer-toggle-lock'), { shiftKey: true });
    });

    expect(committed).toHaveBeenCalledWith({
      action: 'modify-freeform-selection-lock',
      objectId: 'transform-lock-shape',
    });
    expect(shape.selectable).toBe(false);
    expect(shape.lockSkewingX).toBe(true);
    expect(shape.lockSkewingY).toBe(true);
    expect(shape.lockMovementX).toBe(true);

    cleanup();
    const secondCanvas = createCanvas();
    installCanvas(secondCanvas);
    const secondShape = seedShape(secondCanvas);
    const secondDiagnostic = installDiagnostic('context-selection-lock-project');
    render(React.createElement(ContextMenu, { x: 10, y: 10, onClose: vi.fn() }));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Lock Selection' }));
    });

    expect(secondShape.selectable).toBe(false);
    expect(secondDiagnostic.committed).toHaveBeenCalledWith({
      action: 'modify-freeform-selection-lock',
      objectId: 'transform-lock-shape',
    });
  });

  it('reports only narrow transform-lock coverage and keeps authored coverage incomplete', () => {
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
      completeAuthoredCoverage: true,
    });
    expect(coverage.unobservedAuthoredChangeCategories).toEqual(
      expect.arrayContaining([
        'Canvas editor chrome, viewport, guides, snap/grid settings, and selection state',
        'Document selection, zoom, fit mode, and inspector focus state',
        'Hydration, replay, recovery bookkeeping, autosave, navigation persistence, and teardown',
      ])
    );
    expect(coverage.unobservedAuthoredChangeCategories).not.toContain('styles');

    diagnostic.dispose();
    coordinator.dispose();
  });
});
