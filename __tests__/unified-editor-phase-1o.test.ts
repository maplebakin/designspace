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
import {
  sanityCheckCanvas,
  useEditorStore,
} from '../src/editor/state/editorStore';
import { useHistoryStore } from '../src/editor/state/useHistoryStore';
import { useThemeStore } from '../src/editor/state/useThemeStore';
import type { ApocapaletteTheme } from '../src/editor/types/apocapalette';
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
const originalThemeState = useThemeStore.getState();
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
  id = 'theme-color-lock-shape',
  colorLocked = false
) => {
  const shape = new fabric.Rect({
    id,
    left: 40,
    top: 50,
    width: 100,
    height: 70,
    fill: '#111111',
    tokenRole: 'brand.primary.value',
    colorLocked,
    selectable: true,
    evented: true,
  } as any);
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

const testTheme = (primary: string, accent = '#3366ff'): ApocapaletteTheme => ({
  meta: { schema: 'generic-token-pack-v1', name: 'Phase 1O Theme' },
  brand: {
    primary: { value: primary },
    accent: { value: accent },
  },
  typography: {
    heading: { value: '#222222' },
    body: { value: '#333333' },
  },
  surfaces: {
    background: { value: '#ffffff' },
  },
});

const installDiagnostic = (projectId = 'theme-color-lock-project'): DiagnosticHarness => {
  const coordinator = createProjectChangeCoordinator();
  const diagnostic = createProjectChangeDiagnosticObserver({ coordinator });
  diagnostic.observeSession({
    projectId,
    legacyDirty: false,
    legacySaveStatus: 'saved',
  });
  const committed = vi.fn((mutation: any) => {
    if (mutation.action !== 'modify-freeform-theme-color-lock') return;
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

const expectColorTransaction = (
  diagnostic: DiagnosticHarness,
  objectId = 'theme-color-lock-shape'
) => {
  expect(diagnostic.view.getSnapshot().lastCommittedTransaction).toMatchObject({
    source: 'canvas',
    action: 'modify-freeform-theme-color-lock',
    domains: ['style'],
    target: { kind: 'freeform-object', id: objectId },
    assetEffect: 'none',
    status: 'committed',
  });
};

describe('Unified Editor Phase 1O Canvas theme color-lock observation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useThemeStore.setState({
      themeData: null,
      activeBrandCollectionId: null,
    });
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
    useThemeStore.setState(originalThemeState, true);
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('observes one Layers Panel Lock Color command with stable semantic metadata', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const { diagnostic, committed } = installDiagnostic();

    render(React.createElement(LayersPanel));
    act(() => {
      fireEvent.click(screen.getByTestId('layer-toggle-color-lock'));
    });

    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledWith({
      action: 'modify-freeform-theme-color-lock',
      objectId: 'theme-color-lock-shape',
    });
    expectColorTransaction(diagnostic);
    expect(shape.colorLocked).toBe(true);
    expect(shape.tokenRole).toBe('brand.primary.value');
    expect(useEditorStore.getState().canvasObjects[0]).toMatchObject({
      id: 'theme-color-lock-shape',
      colorLocked: true,
      tokenRole: 'brand.primary.value',
    });
    expect(useEditorStore.getState().layers[0]).toMatchObject({
      id: 'theme-color-lock-shape',
      colorLocked: true,
    });
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(1);
  });

  it('observes one Layers Panel Unlock Color command with the same action', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas, 'theme-color-lock-shape', true);
    const { diagnostic, committed } = installDiagnostic();

    render(React.createElement(LayersPanel));
    act(() => {
      fireEvent.click(screen.getByTestId('layer-toggle-color-lock'));
    });

    expect(committed).toHaveBeenCalledTimes(1);
    expectColorTransaction(diagnostic);
    expect(shape.colorLocked).toBe(false);
    expect(shape.tokenRole).toBe('brand.primary.value');
    expect(useEditorStore.getState().canvasObjects[0].colorLocked).toBe(false);
    expect(useEditorStore.getState().layers[0].colorLocked).toBe(false);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(1);
  });

  it('proves Layers Panel is the only current explicit Color Lock route', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    seedShape(canvas);
    const { committed } = installDiagnostic();

    render(React.createElement(ContextMenu, { x: 10, y: 10, onClose: vi.fn() }));

    expect(screen.queryByRole('button', { name: 'Lock Color' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unlock Color' })).toBeNull();
    expect(committed).not.toHaveBeenCalled();
  });

  it('keeps legacy dirty state, history, and layer synchronization intact', async () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const { diagnostic, committed } = installDiagnostic();

    render(React.createElement(LayersPanel));
    act(() => {
      fireEvent.click(screen.getByTestId('layer-toggle-color-lock'));
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
      id: 'theme-color-lock-shape',
      colorLocked: true,
    });
    expect(shape.colorLocked).toBe(true);
  });

  it('emits no transaction for missing, stale, absent-canvas, or system targets', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    seedShape(canvas);
    const systemObject = new fabric.Rect({
      id: 'system-page-border',
      width: 20,
      height: 20,
      isPageBorder: true,
      colorLocked: false,
    } as any);
    canvas.add(systemObject);
    const { committed } = installDiagnostic();

    useEditorStore.getState().toggleColorLock('missing-object');
    useEditorStore.getState().toggleColorLock('stale-object');
    useEditorStore.getState().toggleColorLock('system-page-border');
    useEditorStore.setState({ canvas: null });
    useEditorStore.getState().toggleColorLock('theme-color-lock-shape');

    expect(committed).not.toHaveBeenCalled();
    expect(systemObject.colorLocked).toBe(true);
  });

  it('does not observe a mutation whose serialized postcondition is inconsistent', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const { committed } = installDiagnostic();
    const originalSyncCanvasToStore = useEditorStore.getState().syncCanvasToStore;

    useEditorStore.setState({
      syncCanvasToStore: () => {
        shape.colorLocked = false;
        originalSyncCanvasToStore(canvas);
      },
    });

    useEditorStore.getState().toggleColorLock('theme-color-lock-shape');

    expect(committed).not.toHaveBeenCalled();
    expect(shape.colorLocked).toBe(false);
    expect(useEditorStore.getState().isDirty).toBe(true);
  });

  it('treats every valid toggle as a state-changing command without inventing a no-op', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const { diagnostic, committed } = installDiagnostic();

    useEditorStore.getState().toggleColorLock(shape.id as string);
    useEditorStore.getState().toggleColorLock(shape.id as string);

    expect(committed).toHaveBeenCalledTimes(2);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(2);
    expect(shape.colorLocked).toBe(false);
  });

  it('isolates observer failure from the successful legacy Color Lock command', async () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const committed = vi.fn(() => {
      throw new Error('diagnostic unavailable');
    });
    useEditorStore.getState().setCommittedMutationObserver(committed);

    render(React.createElement(LayersPanel));
    act(() => {
      fireEvent.click(screen.getByTestId('layer-toggle-color-lock'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(committed).toHaveBeenCalledTimes(1);
    expect(shape.colorLocked).toBe(true);
    expect(useEditorStore.getState().canvasObjects[0].colorLocked).toBe(true);
    expect(useEditorStore.getState().layers[0].colorLocked).toBe(true);
    expect(useEditorStore.getState()).toMatchObject({
      isDirty: true,
      changeRevision: 1,
    });
    expect(useHistoryStore.getState().canUndo()).toBe(true);
  });

  it('keeps history undo and redo replay silent for Lock and Unlock', async () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const { diagnostic, committed } = installDiagnostic();

    useEditorStore.getState().toggleColorLock(shape.id as string);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    useEditorStore.getState().toggleColorLock(shape.id as string);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
      await useEditorStore.getState().undo();
      await useEditorStore.getState().redo();
    });

    expect(committed).toHaveBeenCalledTimes(2);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(2);
    expect(canvas.getObjects()[0].colorLocked).toBe(false);
  });

  it('persists true and false colorLocked state through serialization and reopen silently', async () => {
    const sourceCanvas = createCanvas();
    installCanvas(sourceCanvas);
    const sourceShape = seedShape(sourceCanvas);
    const { diagnostic, committed } = installDiagnostic('reopen-theme-color-lock-project');

    useEditorStore.getState().toggleColorLock(sourceShape.id as string);
    expect(committed).toHaveBeenCalledTimes(1);
    const lockedSerialized = {
      version: fabric.version,
      objects: sourceCanvas.getObjects().map((object) => toSerializableObject(object)),
    };
    expect(lockedSerialized.objects[0]).toMatchObject({
      id: 'theme-color-lock-shape',
      colorLocked: true,
      tokenRole: 'brand.primary.value',
    });

    const reopenedCanvas = createCanvas();
    installCanvas(reopenedCanvas);
    useEditorStore.getState().setCommittedMutationObserver(committed);
    await loadCanvasFromJsonSafely(reopenedCanvas, lockedSerialized, reviveCustomFabricProps);
    useEditorStore.getState().syncCanvasToStore(reopenedCanvas);

    expect((reopenedCanvas.getObjects()[0] as any).colorLocked).toBe(true);
    expect((reopenedCanvas.getObjects()[0] as any).tokenRole).toBe('brand.primary.value');
    expect(useEditorStore.getState().canvasObjects[0]).toMatchObject({
      id: 'theme-color-lock-shape',
      colorLocked: true,
    });
    expect(committed).toHaveBeenCalledTimes(1);

    useEditorStore.getState().toggleColorLock('theme-color-lock-shape');
    expect(committed).toHaveBeenCalledTimes(2);
    expect((reopenedCanvas.getObjects()[0] as any).colorLocked).toBe(false);
    const unlockedSerialized = {
      version: fabric.version,
      objects: reopenedCanvas.getObjects().map((object) => toSerializableObject(object)),
    };
    expect(unlockedSerialized.objects[0]).toMatchObject({ colorLocked: false });

    const reopenedAgain = createCanvas();
    installCanvas(reopenedAgain);
    useEditorStore.getState().setCommittedMutationObserver(committed);
    await loadCanvasFromJsonSafely(reopenedAgain, unlockedSerialized, reviveCustomFabricProps);
    useEditorStore.getState().syncCanvasToStore(reopenedAgain);

    expect((reopenedAgain.getObjects()[0] as any).colorLocked).toBe(false);
    expect(committed).toHaveBeenCalledTimes(2);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(2);
  });

  it('keeps hydration, page switching, and event-service teardown silent', async () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const { diagnostic, committed } = installDiagnostic('lifecycle-theme-color-lock-project');
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

  it('keeps a Color Lock command during teardown outside authored observation', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const { committed } = installDiagnostic();

    useEditorStore.getState().setCanvasReadyState('disposing');
    useEditorStore.getState().toggleColorLock(shape.id as string);

    expect(shape.colorLocked).toBe(true);
    expect(committed).not.toHaveBeenCalled();
  });

  it('does not classify Shift-click Selection Lock as theme Color Lock', () => {
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
      objectId: 'theme-color-lock-shape',
    });
    expect(shape.selectable).toBe(false);
    expect(shape.colorLocked).toBe(false);
  });

  it('keeps Context Menu Selection Lock outside theme Color Lock coverage', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    const { committed } = installDiagnostic();

    render(React.createElement(ContextMenu, { x: 10, y: 10, onClose: vi.fn() }));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Lock Selection' }));
    });

    expect(committed).toHaveBeenCalledWith({
      action: 'modify-freeform-selection-lock',
      objectId: 'theme-color-lock-shape',
    });
    expect(shape.colorLocked).toBe(false);
  });

  it('skips locked theme-linked objects, retains tokenRole, and resumes legacy theme behavior after unlock', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    shape.set({ fill: '#111111', tokenRole: 'brand.primary.value', colorLocked: false });
    useEditorStore.getState().syncCanvasToStore(canvas);
    useEditorStore.setState({ isDirty: false, changeRevision: 0 });
    const { diagnostic, committed } = installDiagnostic();

    useEditorStore.getState().toggleColorLock(shape.id as string);
    useEditorStore.getState().applyTheme(testTheme('#222222'));

    expect(shape.fill).toBe('#111111');
    expect(shape.colorLocked).toBe(true);
    expect(shape.tokenRole).toBe('brand.primary.value');
    expect(committed).toHaveBeenCalledTimes(1);

    useEditorStore.getState().toggleColorLock(shape.id as string);
    useEditorStore.getState().applyTheme(testTheme('#333333'));

    expect(shape.colorLocked).toBe(false);
    expect(shape.tokenRole).toBe('brand.primary.value');
    expect(shape.fill).toBe('#333333');
    expect(committed).toHaveBeenCalledTimes(2);
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(2);
  });

  it('allows manual fill editing while locked, clears tokenRole, and emits no Color Lock transaction', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas, 'manual-fill-while-locked', true);
    const { committed } = installDiagnostic();

    useEditorStore.getState().setObjectFill('#abcdef');

    expect(shape.fill).toBe('#abcdef');
    expect(shape.colorLocked).toBe(true);
    expect(shape.tokenRole).toBeNull();
    expect(useEditorStore.getState().canvasObjects[0]).toMatchObject({
      fill: '#abcdef',
      colorLocked: true,
      tokenRole: null,
    });
    expect(committed).not.toHaveBeenCalled();
  });

  it('keeps explicit themed-fill and reset-to-default commands outside Color Lock coverage', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas, 'theme-command-shape', true);
    useThemeStore.getState().setThemeData(testTheme('#224466'));
    const { committed } = installDiagnostic();

    useEditorStore.getState().setObjectThemedFill('brand.accent.value');
    expect(shape.colorLocked).toBe(false);
    expect(shape.tokenRole).toBe('brand.accent.value');
    expect(committed).not.toHaveBeenCalled();

    shape.colorLocked = true;
    useEditorStore.getState().syncCanvasToStore(canvas);
    useEditorStore.getState().resetObjectToDefaultTheme();
    expect(shape.colorLocked).toBe(false);
    expect(shape.tokenRole).toBe('brand.primary.value');
    expect(committed).not.toHaveBeenCalled();
  });

  it('keeps sanityCheckCanvas defaulting missing colorLocked silent', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas);
    delete (shape as any).colorLocked;
    const { committed } = installDiagnostic();

    const report = sanityCheckCanvas(canvas, null);

    expect(report).toMatchObject({ missingIds: 0, invalidRoles: 0 });
    expect((shape as any).colorLocked).toBe(false);
    expect(committed).not.toHaveBeenCalled();
    expect(useEditorStore.getState().changeRevision).toBe(0);
  });

  it('does not observe unrelated global theme application while an object is locked', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = seedShape(canvas, 'global-theme-locked', true);
    useThemeStore.getState().setThemeData(testTheme('#111111'));
    const { committed } = installDiagnostic();

    useEditorStore.getState().applyTheme(testTheme('#999999'));

    expect(shape.fill).toBe('#111111');
    expect(shape.colorLocked).toBe(true);
    expect(committed).not.toHaveBeenCalled();
  });

  it('reports only narrow theme Color Lock coverage and keeps authored coverage incomplete', () => {
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
      completeAuthoredCoverage: false,
    });
    expect(coverage.unobservedAuthoredChangeCategories).toEqual(
      expect.arrayContaining([
        'Canvas native fill, stroke, shadow, and gradient colour pickers',
        'Canvas theme-token linking, unlinking, reset, and global theme application',
        'Canvas theme color lock mutations from other commands',
        'Canvas full-object lock and unsupported Selection Lock invocation paths',
        'Document native paper/text/drop-cap colour pickers',
      ])
    );
    expect(coverage.unobservedAuthoredChangeCategories).not.toContain('styles');

    diagnostic.dispose();
    coordinator.dispose();
  });
});
