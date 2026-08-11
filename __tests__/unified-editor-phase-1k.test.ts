import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fabric from 'fabric';
import {
  reviveCustomFabricProps,
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
import { useEditorStore } from '../src/editor/state/editorStore';
import { useHistoryStore } from '../src/editor/state/useHistoryStore';

type DrawingTool = 'draw' | 'erase';

const cleanLifecycle = (projectId: string) => ({
  projectId,
  legacyDirty: false,
  legacySaveStatus: 'saved' as const,
});

const createPointerEvent = (
  type: 'mousedown' | 'mousemove' | 'mouseup',
  x: number,
  y: number
) => ({
  type,
  button: 0,
  buttons: type === 'mouseup' ? 0 : 1,
  clientX: x,
  clientY: y,
  isPrimary: true,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
});

const createCanvas = () => {
  const element = document.createElement('canvas');
  element.width = 320;
  element.height = 240;
  document.body.appendChild(element);
  const canvas = new fabric.Canvas(element, {
    width: 320,
    height: 240,
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

const configureCurrentBrush = (canvas: fabric.Canvas, tool: DrawingTool) => {
  const brush = new fabric.PencilBrush(canvas);
  brush.width = 6;

  if (tool === 'erase') {
    // This intentionally mirrors CanvasStage. Fabric 7's PencilBrush does not
    // copy this brush-only property onto the created Path.
    (brush as any).globalCompositeOperation = 'destination-out';
    brush.color = '#000000';
  } else {
    brush.color = '#123456';
  }

  canvas.freeDrawingBrush = brush;
  canvas.isDrawingMode = true;
  return brush;
};

const performStroke = (canvas: fabric.Canvas, tool: DrawingTool) => {
  configureCurrentBrush(canvas, tool);
  (canvas as any)._onMouseDown({
    e: createPointerEvent('mousedown', 20, 30),
    pointer: new fabric.Point(20, 30),
  });
  (canvas as any)._onMouseMove({
    e: createPointerEvent('mousemove', 120, 130),
    pointer: new fabric.Point(120, 130),
  });
  (canvas as any)._onMouseUp({
    e: createPointerEvent('mouseup', 180, 160),
    pointer: new fabric.Point(180, 160),
  });
};

const installObservation = (
  canvas: fabric.Canvas,
  tool: DrawingTool,
  onCommittedMutation: (mutation: any) => void
) => registerObjectEventHandlers({
  canvas,
  callbacks: { onCommittedMutation },
  refs: { activeTool: { current: tool } } as any,
});

describe('Unified Editor Phase 1K Canvas freehand observation', () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;
  const originalCanvasState = useEditorStore.getState();
  const originalHistoryState = useHistoryStore.getState();

  beforeEach(() => {
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      },
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: vi.fn(),
    });
    useEditorStore.setState({
      syncLock: { isLocked: false, reason: null, queuedSync: false },
    });
  });

  afterEach(() => {
    useEditorStore.setState(originalCanvasState, true);
    useHistoryStore.setState(originalHistoryState, true);
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: originalRequestAnimationFrame,
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: originalCancelAnimationFrame,
    });
  });

  it.each<DrawingTool>(['draw', 'erase'])(
    'maps one completed %s gesture to one existing add-freeform-object observation', (tool) => {
      const { canvas, dispose } = createCanvas();
      const committed = vi.fn();
      const pathEvents: string[] = [];
      canvas.on('before:path:created', () => pathEvents.push('before:path:created'));
      canvas.on('object:added', () => pathEvents.push('object:added'));
      canvas.on('path:created', () => pathEvents.push('path:created'));
      const registration = installObservation(canvas, tool, committed);

      performStroke(canvas, tool);

      const path = canvas.getObjects()[0];
      expect(path?.type).toBe('path');
      expect(typeof (path as any)?.id).toBe('string');
      expect(pathEvents).toEqual([
        'before:path:created',
        'object:added',
        'path:created',
      ]);
      expect(committed).toHaveBeenCalledTimes(1);
      expect(committed).toHaveBeenCalledWith({
        action: 'add-freeform-object',
        objectId: (path as any).id,
        assetEffect: 'none',
      });

      registration.cleanup();
      dispose();
    }
  );

  it('proves the current erase tool is a path add, not a semantic erase mutation', () => {
    const { canvas, dispose } = createCanvas();
    const committed = vi.fn();
    const registration = installObservation(canvas, 'erase', committed);
    const brush = configureCurrentBrush(canvas, 'erase');

    performStroke(canvas, 'erase');

    const path = canvas.getObjects()[0] as fabric.Path;
    expect((brush as any).globalCompositeOperation).toBe('destination-out');
    expect(path.globalCompositeOperation).toBe('source-over');
    expect(path.stroke).toBe('#000000');
    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed.mock.calls[0][0].action).toBe('add-freeform-object');

    registration.cleanup();
    dispose();
  });

  it('does not observe preview movement or an unfinished gesture', () => {
    const { canvas, dispose } = createCanvas();
    const committed = vi.fn();
    const registration = installObservation(canvas, 'draw', committed);
    configureCurrentBrush(canvas, 'draw');

    (canvas as any)._onMouseDown({
      e: createPointerEvent('mousedown', 20, 30),
      pointer: new fabric.Point(20, 30),
    });
    (canvas as any)._onMouseMove({
      e: createPointerEvent('mousemove', 120, 130),
      pointer: new fabric.Point(120, 130),
    });

    expect(canvas.getObjects()).toHaveLength(0);
    expect(committed).not.toHaveBeenCalled();

    registration.cleanup();
    dispose();
  });

  it('records the current single-click PencilBrush dot instead of inventing a no-op', () => {
    const { canvas, dispose } = createCanvas();
    const committed = vi.fn();
    const registration = installObservation(canvas, 'draw', committed);
    configureCurrentBrush(canvas, 'draw');

    (canvas as any)._onMouseDown({
      e: createPointerEvent('mousedown', 20, 30),
      pointer: new fabric.Point(20, 30),
    });
    (canvas as any)._onMouseUp({
      e: createPointerEvent('mouseup', 20, 30),
      pointer: new fabric.Point(20, 30),
    });

    expect(canvas.getObjects()).toHaveLength(1);
    expect((canvas.getObjects()[0] as any).type).toBe('path');
    expect(committed).toHaveBeenCalledTimes(1);

    registration.cleanup();
    dispose();
  });

  it('observes separate completed strokes separately without timing-based batching', () => {
    const { canvas, dispose } = createCanvas();
    const committed = vi.fn();
    const registration = installObservation(canvas, 'draw', committed);

    performStroke(canvas, 'draw');
    performStroke(canvas, 'draw');

    expect(canvas.getObjects()).toHaveLength(2);
    expect(committed).toHaveBeenCalledTimes(2);
    expect(new Set(committed.mock.calls.map(([mutation]) => mutation.objectId)).size).toBe(2);

    registration.cleanup();
    dispose();
  });

  it('keeps hydration, page replacement, teardown, and history replay silent', async () => {
    const first = createCanvas();
    const firstCommitted = vi.fn();
    const firstRegistration = installObservation(first.canvas, 'draw', firstCommitted);
    performStroke(first.canvas, 'draw');
    const savedPath = first.canvas.getObjects()[0];
    const saved = {
      version: fabric.version,
      objects: [savedPath.toObject(['id'])],
    };
    const savedPathId = (savedPath as any).id;
    firstRegistration.cleanup();
    first.dispose();

    const reopened = createCanvas();
    const reopenedCommitted = vi.fn();
    const reopenedRegistration = installObservation(reopened.canvas, 'draw', reopenedCommitted);
    await loadCanvasFromJsonSafely(reopened.canvas, saved, reviveCustomFabricProps);

    expect(reopened.canvas.getObjects().map((object) => (object as any).id)).toEqual([savedPathId]);
    expect(reopenedCommitted).not.toHaveBeenCalled();

    withCanvasObjectMutationSuppressed(reopened.canvas, () => reopened.canvas.clear());
    expect(reopenedCommitted).not.toHaveBeenCalled();

    useEditorStore.setState({
      syncLock: { isLocked: true, reason: 'undo', queuedSync: false },
    });
    const replayPath = new fabric.Path('M 0 0 L 20 20', { id: 'history-replay' } as any);
    reopened.canvas.add(replayPath);
    reopened.canvas.remove(replayPath);
    expect(reopenedCommitted).not.toHaveBeenCalled();

    reopenedRegistration.cleanup();
    reopened.dispose();
  });

  it('increments the diagnostic revision once for the existing drawing result and keeps erase semantic coverage explicit', () => {
    const coordinator = createProjectChangeCoordinator();
    const observer = createProjectChangeDiagnosticObserver({ coordinator });
    observer.observeSession(cleanLifecycle('canvas-drawing-project'));
    const { canvas, dispose } = createCanvas();
    const committed = vi.fn((mutation) => observeCommittedEngineChange(coordinator, {
      projectId: 'canvas-drawing-project',
      source: 'canvas',
      action: mutation.action,
      pageIds: ['canvas-page'],
      domains: ['freeform-content'],
      target: { kind: 'freeform-object', id: mutation.objectId },
      assetEffect: mutation.assetEffect,
    }));
    const registration = installObservation(canvas, 'draw', committed);

    performStroke(canvas, 'draw');

    expect(observer.view.getSnapshot()).toMatchObject({
      observedRevision: 1,
      committedTransactionCount: 1,
      lastCommittedTransaction: expect.objectContaining({
        action: 'add-freeform-object',
        target: { kind: 'freeform-object', id: (canvas.getObjects()[0] as any).id },
      }),
      coverage: {
        canvasObjectAdd: true,
        canvasDrawing: true,
        canvasErase: false,
        completeAuthoredCoverage: false,
      },
    });

    registration.cleanup();
    dispose();
    observer.dispose();
    coordinator.dispose();
  });

  it('coalesces the drawing event, history-dirty flag, and window mouseup into one legacy revision', () => {
    const { canvas, dispose } = createCanvas();
    useHistoryStore.getState().resetHistory();
    useEditorStore.setState({
      batchDepth: 0,
      batchNeedsSave: false,
      isDirty: false,
      changeRevision: 0,
      autoSaveStatus: 'idle',
      saveStatus: 'saved',
      syncLock: { isLocked: false, reason: null, queuedSync: false },
    });
    const onUpdate = (_targetCanvas: fabric.Canvas, options?: { persist?: boolean }) => {
      if (!options?.persist) return;
      if (useEditorStore.getState().batchDepth === 0) {
        useEditorStore.getState().startBatch();
      }
    };
    const registered = registerObjectEventHandlers({
      canvas,
      callbacks: {
        onUpdate,
        onHistoryDirty: () => useEditorStore.getState().markHistoryDirty(),
      },
      refs: { activeTool: { current: 'draw' } } as any,
    });

    performStroke(canvas, 'draw');
    expect(useEditorStore.getState().changeRevision).toBe(0);

    if (useEditorStore.getState().consumeHistoryDirty()) {
      useEditorStore.getState().saveState();
    }
    expect(useEditorStore.getState().changeRevision).toBe(0);

    useEditorStore.getState().endBatch();
    expect(useEditorStore.getState()).toMatchObject({
      changeRevision: 1,
      isDirty: true,
      autoSaveStatus: 'dirty',
      saveStatus: 'unsaved',
    });

    registered.cleanup();
    dispose();
  });
});
