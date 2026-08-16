import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fabric from 'fabric';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PropertiesPanel } from '../src/editor/components/PropertiesPanel';
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

const originalCanvasState = useEditorStore.getState();
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
  });
  useHistoryStore.getState().resetHistory();
  useHistoryStore.getState().takeSnapshot();
};

const seedShape = (canvas: fabric.Canvas, id = 'border-shape') => {
  const shape = new fabric.Rect({
    id,
    left: 40,
    top: 50,
    width: 100,
    height: 70,
    fill: '#ff0000',
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

const installDiagnostic = (projectId = 'border-style-project'): DiagnosticHarness => {
  const coordinator = createProjectChangeCoordinator();
  const diagnostic = createProjectChangeDiagnosticObserver({ coordinator });
  diagnostic.observeSession({
    projectId,
    legacyDirty: false,
    legacySaveStatus: 'saved',
  });
  const committed = vi.fn((mutation: any) => {
    if (mutation.action !== 'modify-freeform-style') return;
    observeCommittedEngineChange(coordinator, {
      projectId,
      source: 'canvas',
      action: mutation.action,
      pageIds: ['canvas-page'],
      domains: ['style'],
      target: { kind: 'freeform-object', id: mutation.objectId },
      assetEffect: 'none',
    });
  });
  useEditorStore.getState().setCommittedMutationObserver(committed);
  const harness = { coordinator, diagnostic, committed };
  diagnostics.push(harness);
  return harness;
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('Unified Editor Phase 1M Canvas Border Style observation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    diagnostics.splice(0).forEach(({ coordinator, diagnostic }) => {
      diagnostic.dispose();
      coordinator.dispose();
    });
    canvases.splice(0).forEach(({ canvas, element }) => {
      canvas.dispose();
      element.remove();
    });
    useEditorStore.setState(originalCanvasState, true);
    useHistoryStore.setState(originalHistoryState, true);
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('uses the native completed color change after live picker updates as one style commit', async () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    seedShape(canvas);
    const { committed } = installDiagnostic('fill-audit-project');

    render(React.createElement(PropertiesPanel));
    const fill = screen.getByLabelText('Fill color');
    const initialRevision = useEditorStore.getState().changeRevision;

    act(() => {
      fireEvent.pointerDown(fill);
      fireEvent.input(fill, { target: { value: '#112233' } });
      fireEvent.input(fill, { target: { value: '#223344' } });
      fireEvent.change(fill, { target: { value: '#223344' } });
    });

    expect(useEditorStore.getState().changeRevision).toBe(initialRevision + 2);
    expect((canvas.getObjects()[0] as fabric.Rect).fill).toBe('#223344');
    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledWith({
      action: 'modify-freeform-style',
      objectId: 'border-shape',
      style: 'fill-color',
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
  });

  it('maps one successful Border Style selection to one normalized style transaction', async () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const { diagnostic, committed } = installDiagnostic();
    const lifecycleCommitted = vi.fn();
    const lifecycle = registerObjectEventHandlers({
      canvas,
      callbacks: { onCommittedMutation: lifecycleCommitted },
    });

    render(React.createElement(PropertiesPanel));
    act(() => {
      fireEvent.change(screen.getByLabelText('Border style'), {
        target: { value: 'dashed' },
      });
    });

    const serialized = useEditorStore.getState().canvasObjects.find(
      (object) => object.id === 'border-shape'
    ) as any;
    const snapshot = diagnostic.view.getSnapshot();
    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledWith({
      action: 'modify-freeform-style',
      objectId: 'border-shape',
      style: 'border-style',
    });
    expect(snapshot).toMatchObject({
      observedRevision: 1,
      committedTransactionCount: 1,
      lastCommittedTransaction: {
        source: 'canvas',
        action: 'modify-freeform-style',
        domains: ['style'],
        target: { kind: 'freeform-object', id: 'border-shape' },
        assetEffect: 'none',
        status: 'committed',
      },
    });
    expect((shape as any).strokeDashArray).toEqual([12, 8]);
    expect(serialized.strokeDashArray).toEqual([12, 8]);
    expect((useEditorStore.getState().layersById['border-shape'] as any).strokeDashArray)
      .toEqual([12, 8]);
    expect(useEditorStore.getState()).toMatchObject({
      isDirty: true,
      changeRevision: 1,
    });
    expect(lifecycleCommitted).not.toHaveBeenCalled();
    lifecycle.cleanup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
  });

  it('emits no transaction for no selection, stale/system targets, or an effective no-op', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const { diagnostic, committed } = installDiagnostic();

    useEditorStore.getState().clearSelection();
    useEditorStore.getState().reportCommittedCanvasBorderStyle('border-shape');

    useEditorStore.setState({ selectedObjectId: 'stale-object' });
    useEditorStore.getState().reportCommittedCanvasBorderStyle('stale-object');

    const systemObject = new fabric.Rect({
      id: 'system-border',
      width: 20,
      height: 20,
      isPageBorder: true,
    } as any);
    canvas.add(systemObject);
    canvas.setActiveObject(systemObject);
    useEditorStore.setState({ selectedObjectId: 'system-border' });
    useEditorStore.getState().reportCommittedCanvasBorderStyle('system-border');

    useEditorStore.getState().selectObjectById('border-shape');
    render(React.createElement(PropertiesPanel));
    act(() => {
      fireEvent.change(screen.getByLabelText('Border style'), {
        target: { value: 'solid' },
      });
    });

    expect((shape as any).strokeDashArray == null).toBe(true);
    expect(committed).not.toHaveBeenCalled();
    expect(diagnostic.view.getSnapshot()).toMatchObject({
      observedRevision: 0,
      committedTransactionCount: 0,
    });
  });

  it('keeps the legacy mutation, store state, dirty state, and history when observation throws', async () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const committed = vi.fn(() => {
      throw new Error('diagnostic unavailable');
    });
    useEditorStore.getState().setCommittedMutationObserver(committed);

    render(React.createElement(PropertiesPanel));
    act(() => {
      fireEvent.change(screen.getByLabelText('Border style'), {
        target: { value: 'dotted' },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect((shape as any).strokeDashArray).toEqual([2, 6]);
    expect((useEditorStore.getState().canvasObjects.find(
      (object) => object.id === 'border-shape'
    ) as any)?.strokeDashArray).toEqual([2, 6]);
    expect(useEditorStore.getState().isDirty).toBe(true);
    expect({
      length: useHistoryStore.getState().historyLength(),
      index: useHistoryStore.getState().historyIndex,
      dash: useHistoryStore.getState().lastHistorySnapshot?.objects?.[0]?.strokeDashArray,
    }).toEqual({ length: 2, index: 1, dash: [2, 6] });
    expect(useHistoryStore.getState().canUndo()).toBe(true);
    expect(committed).toHaveBeenCalledTimes(1);
  });

  it('keeps history undo/redo replay silent after one authored style transaction', async () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    seedShape(canvas);
    const { diagnostic, committed } = installDiagnostic();

    render(React.createElement(PropertiesPanel));
    act(() => {
      fireEvent.change(screen.getByLabelText('Border style'), {
        target: { value: 'dashed' },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(committed).toHaveBeenCalledTimes(1);

    await act(async () => {
      await useEditorStore.getState().undo();
      await flushPromises();
      await useEditorStore.getState().redo();
      await flushPromises();
    });

    expect(committed).toHaveBeenCalledTimes(1);
    expect((canvas.getObjects()[0] as fabric.Rect).strokeDashArray).toEqual([12, 8]);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(1);
    expect(useEditorStore.getState().isDirty).toBe(true);
  });

  it('hydrates and reopens saved Border Style without authored observations', async () => {
    const sourceCanvas = createCanvas();
    installCanvas(sourceCanvas);
    const sourceShape = seedShape(sourceCanvas);
    sourceShape.set({ strokeDashArray: [2, 6] });
    useEditorStore.getState().syncCanvasToStore(sourceCanvas);
    const serialized = {
      version: fabric.version,
      objects: sourceCanvas.getObjects().map((object) => toSerializableObject(object)),
    };

    const reopenedCanvas = createCanvas();
    installCanvas(reopenedCanvas);
    const { diagnostic, committed } = installDiagnostic('reopen-project');
    const lifecycleCommitted = vi.fn();
    const lifecycle = registerObjectEventHandlers({
      canvas: reopenedCanvas,
      callbacks: { onCommittedMutation: lifecycleCommitted },
    });

    await loadCanvasFromJsonSafely(reopenedCanvas, serialized, reviveCustomFabricProps);
    useEditorStore.getState().syncCanvasToStore(reopenedCanvas);

    expect((reopenedCanvas.getObjects()[0] as fabric.Rect).strokeDashArray).toEqual([2, 6]);
    expect(committed).not.toHaveBeenCalled();
    expect(lifecycleCommitted).not.toHaveBeenCalled();
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(0);
    lifecycle.cleanup();
  });

  it('keeps page switching and event-service teardown transaction-silent', async () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const { diagnostic, committed } = installDiagnostic('page-switch-project');
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

    await useEditorStore.getState().switchToPage(1);
    await useEditorStore.getState().switchToPage(0);
    lifecycle.cleanup();

    expect(committed).not.toHaveBeenCalled();
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(0);
  });

  it('exposes the Border Style and closure coverage without a generic styles claim', () => {
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
      canvasCommittedColorControls: true,
      canvasNumericControls: true,
      canvasPresetResetCommands: true,
      canvasThemeOperations: true,
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
