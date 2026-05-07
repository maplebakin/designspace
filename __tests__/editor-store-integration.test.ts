import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fabric from 'fabric';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  getPendingLayerSyncSelectionIds,
  setPendingLayerSyncSelectionIds,
  useEditorStore,
  DEFAULT_CANVAS_BACKGROUND,
  type SerializedFabricObject,
} from '../src/editor/state/editorStore';
import { useCanvasStore } from '../src/editor/state/useCanvasStore';
import { useHistoryStore } from '../src/editor/state/useHistoryStore';
import { useThemeStore } from '../src/editor/state/useThemeStore';
import { syncCanvasLayers } from '../src/editor/state/layerSyncHandler';
import { advancedExportManager } from '../src/editor/export/advancedExportManager';
import { addCircleFrame } from '../src/editor/fabric/frameFactories';
import { loadDailyPlannerTemplate, loadRetroManualTemplate } from '../src/editor/fabric/blueprintFactories';
import { addIText } from '../src/editor/fabric/objectFactories';
import { ExportModal } from '../src/editor/components/ExportModal';
import { isUserObject } from '../src/editor/utils/objectUtils';
import {
  bringForward,
  bringToFront,
  clearClipboard,
  copySelection,
  pasteFromClipboard,
  sendToBack,
} from '../src/editor/services/clipboardService';
import { db } from '../src/editor/db';

vi.mock('../src/editor/db', () => ({
  db: {
    renameProject: vi.fn().mockResolvedValue(undefined),
    getAllProjects: vi.fn().mockResolvedValue([]),
    getProject: vi.fn().mockResolvedValue(null),
    updateProject: vi.fn().mockResolvedValue(undefined),
    addProject: vi.fn().mockResolvedValue('new-id'),
  },
}));

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const flushLayerAndHistory = async () => {
  await flushPromises();
  await vi.advanceTimersByTimeAsync(350);
  await flushPromises();
};

const rectObject = (id: string, overrides: Partial<SerializedFabricObject> = {}): SerializedFabricObject => ({
  id,
  type: 'rect',
  left: 10,
  top: 20,
  width: 100,
  height: 80,
  fill: '#ff0000',
  visible: true,
  ...overrides,
});

const objectIds = (canvas: fabric.Canvas) =>
  canvas.getObjects()
    .map((object) => (object as any).id)
    .filter(Boolean);

const objectById = (canvas: fabric.Canvas, id: string) =>
  canvas.getObjects().find((object) => (object as any).id === id);

const imageObject = (id: string) => {
  const source = document.createElement('canvas');
  source.width = 24;
  source.height = 24;
  const image = new fabric.Image(source, {
    left: 40,
    top: 50,
    width: 24,
    height: 24,
    originX: 'center',
    originY: 'center',
  });
  image.set({
    id,
    src: 'blob:integration-image',
    tokenRole: 'brand.accent.value',
    colorLocked: false,
  } as any);
  return image;
};

const installLayerSyncHandler = (canvas: fabric.Canvas) => {
  useEditorStore.getState().setLayerSyncHandler(() => {
    const state = useEditorStore.getState();
    const pendingSelectionIds = getPendingLayerSyncSelectionIds();
    const requestedSelectionIds = [...(pendingSelectionIds ?? state.pendingLayerSyncSelectionIds ?? state.selectedLayerIds)];
    void syncCanvasLayers(state.canvasObjects, canvas, {
      selectedObjectId: state.selectedObjectId,
    }).then(({ layersById, selectOnInsertIds }) => {
      const resolvedSelectionIds = selectOnInsertIds.length > 0 ? selectOnInsertIds : requestedSelectionIds;
      const strippedCanvasObjects = selectOnInsertIds.length > 0
        ? useEditorStore.getState().canvasObjects.map((object) => {
          if (!(object as any).__selectOnInsert) return object;
          const { __selectOnInsert: _selectOnInsert, ...rest } = object as any;
          return rest;
        })
        : useEditorStore.getState().canvasObjects;
      useEditorStore.setState({
        layersById,
        canvasObjects: strippedCanvasObjects,
        pendingLayerSyncSelectionIds: pendingSelectionIds ? null : useEditorStore.getState().pendingLayerSyncSelectionIds,
      });
      if (pendingSelectionIds) {
        setPendingLayerSyncSelectionIds(null);
      }
      if (resolvedSelectionIds.length > 0) {
        useEditorStore.getState().selectObjectsByIds(resolvedSelectionIds);
      } else {
        const currentState = useEditorStore.getState();
        if (currentState.selectedLayerIds.length === 0 && !canvas.getActiveObject()) {
          useEditorStore.getState().clearSelection();
        }
      }
    });
  });
};

const createHarness = () => {
  const element = document.createElement('canvas');
  element.width = 800;
  element.height = 600;
  document.body.appendChild(element);
  const canvas = new fabric.Canvas(element, { width: 800, height: 600 });

  useCanvasStore.setState({ width: 800, height: 600, hasPendingSize: false });
  useThemeStore.getState().setCanvasBackgroundColor(DEFAULT_CANVAS_BACKGROUND);
  useHistoryStore.getState().resetHistory();
  setPendingLayerSyncSelectionIds(null);
  useEditorStore.setState({
    canvas: null,
    canvasReadyState: 'ready',
    canvasObjects: [],
    selectedObjectId: null,
    selectedLayerIds: [],
    pendingLayerSyncSelectionIds: null,
    layers: [],
    layersById: {},
    imageAssets: {},
    assetRefCount: new Map(),
    pages: [{
      id: 'page-1',
      name: 'Page 1',
      canvasData: { objects: [], background: DEFAULT_CANVAS_BACKGROUND },
      canvasSize: { width: 800, height: 600 },
    }],
    activePageIndex: 0,
    layerSyncHandler: null,
    hasLayerSyncHandler: false,
    dirtyObjectsRef: new Set(),
    syncLock: { isLocked: false, reason: null, queuedSync: false },
    isDirty: false,
    projectName: 'Integration Test',
  });

  installLayerSyncHandler(canvas);
  useEditorStore.getState().setCanvas(canvas);
  useHistoryStore.getState().takeSnapshot();

  return {
    canvas,
    dispose: () => {
      clearClipboard();
      setPendingLayerSyncSelectionIds(null);
      useEditorStore.getState().setLayerSyncHandler(null);
      useEditorStore.getState().setCanvas(null);
      canvas.dispose();
      element.remove();
      useHistoryStore.getState().resetHistory();
    },
  };
};

describe('mounted store editor integration', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    harness?.dispose();
    vi.useRealTimers();
  });

  it('inserts through editorStore, syncs Fabric/layers/selection, and enables undo', async () => {
    expect(useHistoryStore.getState().canUndo()).toBe(false);

    useEditorStore.getState().addObject(rectObject('shape-1'), { save: true, select: true });
    await flushLayerAndHistory();

    expect(objectIds(harness.canvas)).toContain('shape-1');
    expect(useEditorStore.getState().layers.map((layer) => layer.id)).toContain('shape-1');
    expect(Object.keys(useEditorStore.getState().layersById)).toContain('shape-1');
    expect(useEditorStore.getState().selectedObjectId).toBe('shape-1');
    expect(useEditorStore.getState().selectedLayerIds).toEqual(['shape-1']);
    expect((harness.canvas.getActiveObject() as any)?.id).toBe('shape-1');
    expect(useHistoryStore.getState().canUndo()).toBe(true);
  });

  it('does not leave stale Fabric or store selection for non-selecting insertion', async () => {
    useEditorStore.getState().addObject(rectObject('selected-shape'), { save: false, select: true });
    await flushLayerAndHistory();
    expect((harness.canvas.getActiveObject() as any)?.id).toBe('selected-shape');

    useEditorStore.getState().addObject(rectObject('background-shape'), { save: true, select: false });
    await flushLayerAndHistory();

    expect(objectIds(harness.canvas)).toEqual(['selected-shape', 'background-shape']);
    expect(harness.canvas.getActiveObject()).toBeUndefined();
    expect(useEditorStore.getState().selectedObjectId).toBeNull();
    expect(useEditorStore.getState().selectedLayerIds).toEqual([]);
    expect(useHistoryStore.getState().canUndo()).toBe(true);
  });

  it('skips insertion selection for hidden or non-selectable serialized objects', async () => {
    useEditorStore.getState().addObject(rectObject('hidden-shape', { visible: false }), { save: false, select: true });
    await flushLayerAndHistory();

    expect(objectIds(harness.canvas)).toContain('hidden-shape');
    expect(harness.canvas.getActiveObject()).toBeUndefined();
    expect(useEditorStore.getState().selectedLayerIds).toEqual([]);

    useEditorStore.getState().addObject(rectObject('locked-shape', { selectable: false }), { save: false, select: true });
    await flushLayerAndHistory();

    expect(objectIds(harness.canvas)).toContain('locked-shape');
    expect(harness.canvas.getActiveObject()).toBeUndefined();
    expect(useEditorStore.getState().selectedLayerIds).toEqual([]);
  });

  it('keeps selection helpers synchronized with Fabric active selection and clear/delete flows', async () => {
    useEditorStore.getState().addObjects([
      rectObject('shape-1'),
      rectObject('shape-2', { left: 160 }),
    ], { save: false, selectLast: false });
    await flushLayerAndHistory();

    useEditorStore.getState().selectObjectById('shape-1');
    expect((harness.canvas.getActiveObject() as any)?.id).toBe('shape-1');
    expect(useEditorStore.getState().selectedObjectId).toBe('shape-1');
    expect(useEditorStore.getState().selectedLayerIds).toEqual(['shape-1']);

    useEditorStore.getState().selectObjectsByIds(['shape-1', 'shape-2']);
    const activeSelection = harness.canvas.getActiveObject() as fabric.ActiveSelection;
    expect(['activeSelection', 'activeselection']).toContain(activeSelection.type);
    expect(useEditorStore.getState().selectedObjectId).toBeNull();
    expect(useEditorStore.getState().selectedLayerIds).toEqual(['shape-1', 'shape-2']);
    useEditorStore.setState({ selectedObjectId: 'stale', selectedLayerIds: ['stale'] });
    useEditorStore.getState().syncSelectionFromCanvas(harness.canvas);
    expect(useEditorStore.getState().selectedObjectId).toBeNull();
    expect(useEditorStore.getState().selectedLayerIds).toEqual(['shape-1', 'shape-2']);

    useEditorStore.getState().clearSelection();
    expect(harness.canvas.getActiveObject()).toBeUndefined();
    expect(useEditorStore.getState().selectedLayerIds).toEqual([]);

    useEditorStore.getState().selectObjectById('shape-1');
    useEditorStore.getState().removeSelectedObject();
    await flushLayerAndHistory();

    expect(objectIds(harness.canvas)).not.toContain('shape-1');
    expect(useEditorStore.getState().canvasObjects.map((object) => object.id)).not.toContain('shape-1');
    expect(useEditorStore.getState().selectedObjectId).toBeNull();
    expect(useEditorStore.getState().selectedLayerIds).toEqual([]);
  });

  it('undoes and redoes inserted objects through useHistoryStore-backed editor actions', async () => {
    useEditorStore.getState().addObject(rectObject('shape-1'), { save: true, select: true });
    await flushLayerAndHistory();

    await useEditorStore.getState().undo();
    await flushPromises();
    expect(objectIds(harness.canvas)).not.toContain('shape-1');
    expect(useEditorStore.getState().canvasObjects.map((object) => object.id)).not.toContain('shape-1');
    expect(useHistoryStore.getState().canRedo()).toBe(true);

    await useEditorStore.getState().redo();
    await flushPromises();
    expect(objectIds(harness.canvas)).toContain('shape-1');
    expect(useEditorStore.getState().canvasObjects.map((object) => object.id)).toContain('shape-1');
    expect(useHistoryStore.getState().canUndo()).toBe(true);
  });

  it('switches and deletes pages without carrying stale selection or corrupting remaining page data', async () => {
    const pageOne = rectObject('page-one-shape');
    const pageTwo = rectObject('page-two-shape', { fill: '#0000ff' });
    useEditorStore.setState({
      pages: [
        {
          id: 'page-1',
          name: 'Page 1',
          canvasData: { objects: [pageOne], background: '#ffffff' },
          canvasSize: { width: 800, height: 600 },
        },
        {
          id: 'page-2',
          name: 'Page 2',
          canvasData: { objects: [pageTwo], background: '#eeeeee' },
          canvasSize: { width: 500, height: 400 },
        },
      ],
      activePageIndex: 0,
      canvasObjects: [pageOne],
      selectedObjectId: 'page-one-shape',
      selectedLayerIds: ['page-one-shape'],
    });
    useEditorStore.getState().requestLayerSync({ force: true });
    await flushPromises();

    await useEditorStore.getState().switchToPage(1);
    await flushPromises();

    expect(objectIds(harness.canvas)).toEqual(['page-two-shape']);
    expect(useEditorStore.getState().canvasObjects.map((object) => object.id)).toEqual(['page-two-shape']);
    expect(useEditorStore.getState().selectedLayerIds).toEqual([]);
    expect(useCanvasStore.getState().width).toBe(500);
    expect(useCanvasStore.getState().height).toBe(400);
    expect(useHistoryStore.getState().canUndo()).toBe(false);

    await useEditorStore.getState().deletePage(0);
    await flushPromises();

    const remainingPage = useEditorStore.getState().pages[0];
    expect(useEditorStore.getState().activePageIndex).toBe(0);
    expect(remainingPage.id).toBe('page-2');
    expect(remainingPage.canvasData.objects.map((object: SerializedFabricObject) => object.id)).toEqual(['page-two-shape']);
    expect(objectIds(harness.canvas)).toEqual(['page-two-shape']);
  });

  it('routes store-level raster/vector exports through AdvancedExportManager', async () => {
    const exportSpy = vi.spyOn(advancedExportManager, 'export').mockResolvedValue(undefined);
    useEditorStore.getState().addObject(rectObject('shape-1'), { save: false, select: false });
    await flushPromises();

    await useEditorStore.getState().exportCanvas({ format: 'png', multiplier: 2, clipToCanvas: true });
    await useEditorStore.getState().exportCanvas({ format: 'jpeg', multiplier: 1, quality: 0.8, clipToCanvas: true });
    await useEditorStore.getState().exportCanvas({ format: 'svg', multiplier: 1, clipToCanvas: true });

    expect(exportSpy).toHaveBeenCalledTimes(3);
    expect(exportSpy.mock.calls.map((call) => call[1])).toEqual(['png', 'jpeg', 'svg']);
    expect(exportSpy.mock.calls[0][2]).toMatchObject({
      includeBackground: true,
      backgroundColor: DEFAULT_CANVAS_BACKGROUND,
      dpi: 300,
      fileName: 'Integration Test',
    });
  });

  it('commits real mask frame factory insertion into Fabric, layers, selection, history, and page serialization', async () => {
    addCircleFrame(harness.canvas);
    await flushLayerAndHistory();

    const frame = harness.canvas.getObjects().find((object) => (object as any).isFrame);
    expect(frame).toBeTruthy();
    expect((frame as any).frameType).toBe('circle');
    expect((frame as any).excludeFromExport).toBeFalsy();
    expect(useEditorStore.getState().layers.map((layer) => layer.id)).toContain((frame as any).id);
    expect(useEditorStore.getState().selectedLayerIds).toEqual([(frame as any).id]);
    expect((harness.canvas.getActiveObject() as any)?.id).toBe((frame as any).id);
    expect(useHistoryStore.getState().canUndo()).toBe(true);

    useEditorStore.getState().syncActivePageFromCanvas();
    const serializedIds = useEditorStore.getState().pages[0].canvasData.objects.map((object: SerializedFabricObject) => object.id);
    expect(serializedIds).toContain((frame as any).id);
  });

  it('commits blueprint factories to Fabric/store/history and preserves page data across switches', async () => {
    useEditorStore.getState().addObject(rectObject('stale-before-template'), { save: false, select: true });
    await flushLayerAndHistory();
    expect(useEditorStore.getState().selectedLayerIds).toEqual(['stale-before-template']);

    loadDailyPlannerTemplate(harness.canvas, ['#111111', '#222222', '#333333', '#444444', '#555555']);
    await flushLayerAndHistory();

    const dailyIds = objectIds(harness.canvas);
    expect(dailyIds.length).toBeGreaterThan(0);
    expect(dailyIds).not.toContain('stale-before-template');
    expect(useEditorStore.getState().canvasObjects.map((object) => object.id)).toEqual(dailyIds);
    expect(useEditorStore.getState().layers.length).toBe(dailyIds.length);
    expect(harness.canvas.getActiveObject()).toBeUndefined();
    expect(useEditorStore.getState().selectedObjectId).toBeNull();
    expect(useEditorStore.getState().selectedLayerIds).toEqual([]);
    expect(useHistoryStore.getState().canUndo()).toBe(true);

    useEditorStore.getState().syncActivePageFromCanvas();
    useEditorStore.setState({
      pages: [
        useEditorStore.getState().pages[0],
        {
          id: 'blank-page',
          name: 'Blank',
          canvasData: { objects: [], background: '#ffffff' },
          canvasSize: { width: 800, height: 600 },
        },
      ],
    });
    await useEditorStore.getState().switchToPage(1);
    await flushPromises();
    await useEditorStore.getState().switchToPage(0);
    await flushPromises();
    expect(objectIds(harness.canvas)).toEqual(dailyIds);
    await flushLayerAndHistory();

    loadRetroManualTemplate(harness.canvas, ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#FDFBF7']);
    await flushLayerAndHistory();
    const retroUserIds = harness.canvas.getObjects()
      .filter(isUserObject)
      .map((object) => (object as any).id)
      .filter(Boolean);
    expect(retroUserIds.length).toBeGreaterThan(0);
    expect(useEditorStore.getState().canvasObjects.map((object) => object.id)).toEqual(retroUserIds);
    expect(harness.canvas.getActiveObject()).toBeUndefined();
    expect(useEditorStore.getState().selectedLayerIds).toEqual([]);
    expect(useCanvasStore.getState().width).toBe(1650);
    expect(useCanvasStore.getState().height).toBe(2550);
    expect(useThemeStore.getState().canvasBackgroundColor).toBe('#FDFBF7');
  });

  it('loads stored templates with cleared post-insertion selection and synced layers/history', async () => {
    useEditorStore.getState().addObject(rectObject('stale-before-load-template'), { save: false, select: true });
    await flushLayerAndHistory();

    useEditorStore.getState().loadTemplate({
      id: 'template-record',
      name: 'Stored Template',
      canvasData: JSON.stringify({
        objects: [
          rectObject('template-shape', { left: 120, top: 140, fill: '#00ff00' }),
        ],
        background: '#abcdef',
      }),
      defaultThemeId: '',
      canvasSize: { width: 640, height: 480 },
      unitMode: 'px',
    });
    await flushLayerAndHistory();

    expect(objectIds(harness.canvas)).toEqual(['template-shape']);
    expect(useEditorStore.getState().canvasObjects.map((object) => object.id)).toEqual(['template-shape']);
    expect(useEditorStore.getState().layers.map((layer) => layer.id)).toEqual(['template-shape']);
    expect(harness.canvas.getActiveObject()).toBeUndefined();
    expect(useEditorStore.getState().selectedObjectId).toBeNull();
    expect(useEditorStore.getState().selectedLayerIds).toEqual([]);
    expect(useCanvasStore.getState().width).toBe(640);
    expect(useCanvasStore.getState().height).toBe(480);
    expect(useThemeStore.getState().canvasBackgroundColor).toBe('#ABCDEF');
    expect(useHistoryStore.getState().canUndo()).toBe(true);
  });

  it('commits direct single image insertion into Fabric/store/layers/selection/history', async () => {
    const image = imageObject('image-asset-1');
    harness.canvas.add(image);
    harness.canvas.centerObject(image);
    useEditorStore.getState().selectObjectById('image-asset-1');
    useEditorStore.getState().syncCanvasToStore(harness.canvas);
    useEditorStore.getState().requestLayerSync({ force: true });
    useEditorStore.getState().saveState();
    await flushLayerAndHistory();

    expect(objectIds(harness.canvas)).toEqual(['image-asset-1']);
    expect(useEditorStore.getState().canvasObjects).toHaveLength(1);
    expect(useEditorStore.getState().canvasObjects[0]).toMatchObject({
      id: 'image-asset-1',
      type: 'Image',
      tokenRole: 'brand.accent.value',
      colorLocked: false,
    });
    expect(useEditorStore.getState().layers.map((layer) => layer.id)).toEqual(['image-asset-1']);
    expect((harness.canvas.getActiveObject() as any)?.id).toBe('image-asset-1');
    expect(useEditorStore.getState().selectedObjectId).toBe('image-asset-1');
    expect(useEditorStore.getState().selectedLayerIds).toEqual(['image-asset-1']);
    expect(useHistoryStore.getState().canUndo()).toBe(true);
  });

  it('routes ExportModal current-page and all-pages PDF through AdvancedExportManager', async () => {
    const exportSpy = vi.spyOn(advancedExportManager, 'export').mockResolvedValue(undefined);
    const exportPagesSpy = vi.spyOn(advancedExportManager, 'exportPagesPdf').mockResolvedValue(undefined);
    const onClose = vi.fn();
    useThemeStore.getState().setCanvasBackgroundColor('#ffeecc');
    useEditorStore.getState().addObject(rectObject('pdf-shape'), { save: false, select: false });
    await flushPromises();

    render(React.createElement(ExportModal, { isOpen: true, onClose }));

    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await flushPromises();
    expect(exportSpy).toHaveBeenCalledWith(harness.canvas, 'pdf', expect.objectContaining({
      includeBackground: true,
      backgroundColor: '#FFEECC',
      dpi: 300,
      fileName: 'Integration Test',
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Download PDF (All Pages)' }));
    await flushPromises();
    expect(exportPagesSpy).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      includeBackground: true,
      backgroundColor: '#FFEECC',
      dpi: 300,
      fileName: 'Integration Test',
      imageAssets: {},
    }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('copies and pastes a single object with a new ID, synced layers, selection, and undo/redo', async () => {
    useEditorStore.getState().addObject(rectObject('source-shape'), { save: true, select: true });
    await flushLayerAndHistory();

    expect(await copySelection()).toBe(true);
    expect(await pasteFromClipboard()).toBe(true);
    await flushLayerAndHistory();

    const idsAfterPaste = objectIds(harness.canvas);
    expect(idsAfterPaste).toHaveLength(2);
    expect(idsAfterPaste).toContain('source-shape');
    const pastedId = idsAfterPaste.find((id) => id !== 'source-shape');
    expect(pastedId).toBeTruthy();
    expect(useEditorStore.getState().canvasObjects.map((object) => object.id)).toEqual(idsAfterPaste);
    expect(useEditorStore.getState().layers.map((layer) => layer.id)).toEqual(idsAfterPaste);
    expect(useEditorStore.getState().selectedLayerIds).toEqual([pastedId]);
    expect((harness.canvas.getActiveObject() as any)?.id).toBe(pastedId);

    await useEditorStore.getState().undo();
    await flushPromises();
    expect(objectIds(harness.canvas)).toEqual(['source-shape']);

    await useEditorStore.getState().redo();
    await flushPromises();
    expect(objectIds(harness.canvas)).toContain(pastedId);
  });

  it('copies and pastes multi-selection without reusing IDs or corrupting selection', async () => {
    useEditorStore.getState().addObjects([
      rectObject('shape-1'),
      rectObject('shape-2', { left: 180 }),
    ], { save: true, selectLast: false });
    await flushLayerAndHistory();
    useEditorStore.getState().selectObjectsByIds(['shape-1', 'shape-2']);

    expect(await copySelection()).toBe(true);
    expect(await pasteFromClipboard()).toBe(true);
    await flushLayerAndHistory();

    const ids = objectIds(harness.canvas);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(useEditorStore.getState().selectedLayerIds).toHaveLength(2);
    expect(useEditorStore.getState().selectedLayerIds.every((id) => !['shape-1', 'shape-2'].includes(id))).toBe(true);
    expect(useEditorStore.getState().canvasObjects.map((object) => object.id)).toEqual(ids);
  });

  it('keeps Fabric order and layer mirror in sync after z-order actions', async () => {
    useEditorStore.getState().addObjects([
      rectObject('bottom'),
      rectObject('middle', { left: 140 }),
      rectObject('top', { left: 280 }),
    ], { save: true, selectLast: false });
    await flushLayerAndHistory();

    useEditorStore.getState().selectObjectById('bottom');
    bringToFront();
    await flushLayerAndHistory();
    expect(objectIds(harness.canvas)).toEqual(['middle', 'top', 'bottom']);
    expect(useEditorStore.getState().canvasObjects.map((object) => object.id)).toEqual(['middle', 'top', 'bottom']);
    expect(useEditorStore.getState().layers.map((layer) => layer.id)).toEqual(['middle', 'top', 'bottom']);
    expect(useEditorStore.getState().selectedLayerIds).toEqual(['bottom']);
    expect(useHistoryStore.getState().canUndo()).toBe(true);

    sendToBack();
    await flushLayerAndHistory();
    expect(objectIds(harness.canvas)[0]).toBe('bottom');

    useEditorStore.getState().selectObjectById('middle');
    bringForward();
    await flushLayerAndHistory();
    expect(useEditorStore.getState().canvasObjects.map((object) => object.id)).toEqual(objectIds(harness.canvas));
  });

  it('groups and ungroups multi-selection while keeping store, layer, selection, and history coherent', async () => {
    useEditorStore.getState().addObjects([
      rectObject('shape-1', { tokenRole: 'brand.primary' } as any),
      rectObject('shape-2', { left: 180, colorLocked: true }),
    ], { save: true, selectLast: false });
    await flushLayerAndHistory();

    useEditorStore.getState().selectObjectsByIds(['shape-1', 'shape-2']);
    useEditorStore.getState().groupSelectedObjects();
    await flushLayerAndHistory();

    const group = harness.canvas.getObjects().find((object) => object.type === 'group') as fabric.Group | undefined;
    expect(group).toBeTruthy();
    const groupId = (group as any).id;
    expect(groupId).toBeTruthy();
    expect(objectIds(harness.canvas)).toEqual([groupId]);
    expect(useEditorStore.getState().canvasObjects.map((object) => object.id)).toEqual([groupId]);
    expect(useEditorStore.getState().selectedLayerIds).toEqual([groupId]);
    expect(group?.getObjects().map((object) => (object as any).id)).toEqual(['shape-1', 'shape-2']);

    useEditorStore.getState().ungroupSelectedObjects();
    await flushLayerAndHistory();
    expect(objectIds(harness.canvas)).toEqual(['shape-1', 'shape-2']);
    expect(useEditorStore.getState().canvasObjects.map((object) => object.id)).toEqual(['shape-1', 'shape-2']);
    expect(useEditorStore.getState().selectedLayerIds).toEqual([]);

    await useEditorStore.getState().undo();
    await flushPromises();
    expect(harness.canvas.getObjects().some((object) => object.type === 'group')).toBe(true);
  });

  it('aligns and distributes active selections without targeting system objects, and undo restores positions', async () => {
    useEditorStore.getState().addObjects([
      rectObject('shape-1', { left: 120, top: 50 }),
      rectObject('shape-2', { left: 260, top: 120 }),
      rectObject('shape-3', { left: 520, top: 220 }),
    ], { save: true, selectLast: false });
    await flushLayerAndHistory();

    const guide = new fabric.Rect({ id: 'guide', left: 90, top: 90, width: 40, height: 40 } as any);
    (guide as any).isGuide = true;
    harness.canvas.add(guide);
    ['shape-1', 'shape-2', 'shape-3'].forEach((id) => objectById(harness.canvas, id)?.setCoords());
    const originalLefts = ['shape-1', 'shape-2', 'shape-3']
      .map((id) => Math.round(objectById(harness.canvas, id)?.getBoundingRect().left ?? -1));
    useEditorStore.getState().selectObjectsByIds(['shape-1', 'shape-2', 'shape-3']);

    useEditorStore.getState().alignSelectedObjects('left');
    await flushLayerAndHistory();
    expect(['shape-1', 'shape-2', 'shape-3'].map((id) => Math.round(objectById(harness.canvas, id)?.getBoundingRect().left ?? -1))).toEqual([0, 0, 0]);
    expect(objectById(harness.canvas, 'guide')?.left).toBe(90);
    expect(useEditorStore.getState().selectedLayerIds).toEqual([]);

    await useEditorStore.getState().undo();
    await flushPromises();
    ['shape-1', 'shape-2', 'shape-3'].forEach((id) => objectById(harness.canvas, id)?.setCoords());
    expect(['shape-1', 'shape-2', 'shape-3']
      .map((id) => Math.round(objectById(harness.canvas, id)?.getBoundingRect().left ?? -1))).toEqual(originalLefts);

    useEditorStore.getState().selectObjectsByIds(['shape-1', 'shape-2', 'shape-3']);
    useEditorStore.getState().distributeSelectedObjects('horizontal');
    await flushLayerAndHistory();
    expect(useEditorStore.getState().canvasObjects.map((object) => object.id)).toEqual(
      harness.canvas.getObjects().filter(isUserObject).map((object) => (object as any).id)
    );
  });

  it('inserts text, syncs layer/selection/history, and preserves serialized text properties', async () => {
    addIText(harness.canvas, {
      text: 'Headline',
      fontSize: 48,
      fontWeight: 'bold',
      role: 'heading',
    });
    await flushLayerAndHistory();

    const textObject = harness.canvas.getObjects().find((object) => object.type === 'i-text') as fabric.IText | undefined;
    expect(textObject).toBeTruthy();
    const textId = (textObject as any).id;
    expect(useEditorStore.getState().layers.map((layer) => layer.id)).toContain(textId);
    expect(useEditorStore.getState().selectedLayerIds).toEqual([textId]);
    expect(useHistoryStore.getState().canUndo()).toBe(true);

    useEditorStore.getState().syncActivePageFromCanvas();
    const serialized = useEditorStore.getState().pages[0].canvasData.objects.find((object: SerializedFabricObject) => object.id === textId);
    expect(serialized).toMatchObject({
      text: 'Headline',
      fontSize: 48,
      fontWeight: 'bold',
      tokenRole: 'typography.heading.value',
    });

    await useEditorStore.getState().undo();
    await flushPromises();
    expect(objectIds(harness.canvas)).not.toContain(textId);

    await useEditorStore.getState().redo();
    await flushPromises();
    expect(objectIds(harness.canvas)).toContain(textId);
  });

  it('records text content and text property edits in store, serialization, and undo history', async () => {
    addIText(harness.canvas, { text: 'Draft', fontSize: 32, role: 'body' });
    await flushLayerAndHistory();
    const textObject = harness.canvas.getObjects().find((object) => object.type === 'i-text') as fabric.IText;
    const textId = (textObject as any).id;

    textObject.set({ text: 'Final copy', fontSize: 40, textAlign: 'center', opacity: 0.5 });
    textObject.setCoords();
    harness.canvas.requestRenderAll();
    useEditorStore.getState().syncCanvasToStore(harness.canvas);
    useEditorStore.getState().saveState();
    await flushLayerAndHistory();

    const mirrored = useEditorStore.getState().canvasObjects.find((object) => object.id === textId);
    expect(mirrored).toMatchObject({
      text: 'Final copy',
      fontSize: 40,
      textAlign: 'center',
      opacity: 0.5,
    });
    useEditorStore.getState().syncActivePageFromCanvas();
    const serialized = useEditorStore.getState().pages[0].canvasData.objects.find((object: SerializedFabricObject) => object.id === textId);
    expect(serialized).toMatchObject({ text: 'Final copy', fontSize: 40, opacity: 0.5 });

    await useEditorStore.getState().undo();
    await flushPromises();
    const restored = objectById(harness.canvas, textId) as fabric.IText;
    expect(restored.text).toBe('Draft');
    expect(restored.fontSize).toBe(32);
  });

  it('syncs text effect store actions and restores them through undo', async () => {
    addIText(harness.canvas, { text: 'Styled', fontSize: 28, role: 'body' });
    await flushLayerAndHistory();
    const textObject = harness.canvas.getObjects().find((object) => object.type === 'i-text') as fabric.IText;
    const textId = (textObject as any).id;

    useEditorStore.getState().setTextCharSpacing(160);
    useEditorStore.getState().setTextLineHeight(1.6);
    useEditorStore.getState().setTextStroke({ color: '#123456', width: 2 });
    await flushLayerAndHistory();

    expect(objectById(harness.canvas, textId)).toMatchObject({
      charSpacing: 160,
      lineHeight: 1.6,
      stroke: '#123456',
      strokeWidth: 2,
    });
    expect(useEditorStore.getState().canvasObjects.find((object) => object.id === textId)).toMatchObject({
      charSpacing: 160,
      lineHeight: 1.6,
      stroke: '#123456',
      strokeWidth: 2,
    });

    await useEditorStore.getState().undo();
    await flushPromises();
    const restored = objectById(harness.canvas, textId) as fabric.IText;
    expect(restored.charSpacing ?? 0).toBe(0);
    expect(restored.strokeWidth ?? 0).toBe(1);
  });

  it('syncs general object property edits and preserves them through serialization and undo', async () => {
    useEditorStore.getState().addObject(rectObject('shape-1'), { save: true, select: true });
    await flushLayerAndHistory();

    useEditorStore.getState().setObjectFill('#00ff00');
    useEditorStore.getState().setObjectStrokeColor('#0000ff');
    useEditorStore.getState().setObjectStrokeWidth(6);
    await flushLayerAndHistory();
    const shape = objectById(harness.canvas, 'shape-1')!;
    shape.set({ opacity: 0.4, angle: 30, flipX: true, left: 240, top: 180 });
    shape.setCoords();
    useEditorStore.getState().syncCanvasToStore(harness.canvas);
    useEditorStore.getState().saveState();
    await flushLayerAndHistory();

    expect(useEditorStore.getState().canvasObjects.find((object) => object.id === 'shape-1')).toMatchObject({
      fill: '#00ff00',
      stroke: '#0000ff',
      strokeWidth: 6,
      opacity: 0.4,
      angle: 30,
      flipX: true,
      left: 240,
      top: 180,
    });
    useEditorStore.getState().syncActivePageFromCanvas();
    const serializedShape = useEditorStore.getState().pages[0].canvasData.objects.find((object: SerializedFabricObject) => object.id === 'shape-1');
    expect(serializedShape).toMatchObject({
      fill: '#00ff00',
      stroke: '#0000ff',
      opacity: 0.4,
      angle: 30,
      flipX: true,
    });

    await useEditorStore.getState().undo();
    await flushPromises();
    const restored = objectById(harness.canvas, 'shape-1')!;
    expect(restored.fill).toBe('#00ff00');
    expect(restored.opacity ?? 1).toBe(1);
    expect(restored.angle ?? 0).toBe(0);
  });

  it('hides selected layers without leaving stale selection and restores visibility with undo/redo', async () => {
    useEditorStore.getState().addObject(rectObject('shape-1'), { save: true, select: true });
    await flushLayerAndHistory();
    const shape = objectById(harness.canvas, 'shape-1')!;

    shape.set('visible', false);
    useEditorStore.getState().syncSelectionFromCanvas(harness.canvas);
    harness.canvas.requestRenderAll();
    useEditorStore.getState().syncCanvasToStore(harness.canvas);
    useEditorStore.getState().requestLayerSync({ force: true });
    useEditorStore.getState().saveState();
    await flushLayerAndHistory();

    expect(shape.visible).toBe(false);
    expect(useEditorStore.getState().selectedLayerIds).toEqual([]);
    expect(useEditorStore.getState().layers.find((layer) => layer.id === 'shape-1')?.visible).toBe(false);
    useEditorStore.getState().syncActivePageFromCanvas();
    expect(useEditorStore.getState().pages[0].canvasData.objects[0]).toMatchObject({ id: 'shape-1', visible: false });

    await useEditorStore.getState().undo();
    await flushLayerAndHistory();
    expect(objectById(harness.canvas, 'shape-1')?.visible).toBe(true);

    await useEditorStore.getState().redo();
    await flushLayerAndHistory();
    expect(objectById(harness.canvas, 'shape-1')?.visible).toBe(false);
  });

  it('locks selected objects, clears selection, blocks helper reselection, and restores lock state with undo', async () => {
    useEditorStore.getState().addObject(rectObject('shape-1'), { save: true, select: true });
    await flushLayerAndHistory();

    useEditorStore.getState().toggleObjectLock();
    await flushLayerAndHistory();

    const locked = objectById(harness.canvas, 'shape-1')!;
    expect(locked.lockMovementX).toBe(true);
    expect(locked.selectable).toBe(false);
    expect(useEditorStore.getState().selectedLayerIds).toEqual([]);
    expect(useEditorStore.getState().layers.find((layer) => layer.id === 'shape-1')?.movementLocked).toBe(true);

    useEditorStore.getState().selectObjectById('shape-1');
    expect(harness.canvas.getActiveObject()).toBeUndefined();
    expect(useEditorStore.getState().selectedLayerIds).toEqual([]);

    useEditorStore.getState().syncActivePageFromCanvas();
    expect(useEditorStore.getState().pages[0].canvasData.objects[0]).toMatchObject({
      lockMovementX: true,
      selectable: false,
    });

    await useEditorStore.getState().undo();
    await flushPromises();
    const unlocked = objectById(harness.canvas, 'shape-1')!;
    expect(unlocked.lockMovementX).toBeFalsy();
    expect(unlocked.selectable).not.toBe(false);
    useEditorStore.getState().selectObjectById('shape-1');
    expect((harness.canvas.getActiveObject() as any)?.id).toBe('shape-1');
  });
});

describe('renameCurrentProject', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    harness?.dispose();
    vi.useRealTimers();
  });

  it('updates projectName in the store immediately', async () => {
    useEditorStore.setState({ projectName: 'Old Name', currentLibraryProjectId: null });
    await useEditorStore.getState().renameCurrentProject('New Name');
    expect(useEditorStore.getState().projectName).toBe('New Name');
  });

  it('trims whitespace and falls back to Untitled Project for blank names', async () => {
    useEditorStore.setState({ projectName: 'My Design', currentLibraryProjectId: null });

    await useEditorStore.getState().renameCurrentProject('   ');
    expect(useEditorStore.getState().projectName).toBe('Untitled Project');

    await useEditorStore.getState().renameCurrentProject('  Padded Name  ');
    expect(useEditorStore.getState().projectName).toBe('Padded Name');
  });

  it('does not push a canvas undo history entry on rename', async () => {
    useEditorStore.setState({ projectName: 'Before', currentLibraryProjectId: null });
    const snapshotsBefore = useHistoryStore.getState().historyLength();

    await useEditorStore.getState().renameCurrentProject('After');

    expect(useEditorStore.getState().projectName).toBe('After');
    expect(useHistoryStore.getState().historyLength()).toBe(snapshotsBefore);
  });

  it('does not set isDirty on rename', async () => {
    useEditorStore.setState({ projectName: 'A', currentLibraryProjectId: null, isDirty: false });
    await useEditorStore.getState().renameCurrentProject('B');
    expect(useEditorStore.getState().isDirty).toBe(false);
  });
});

describe('renameProject (dashboard)', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
    vi.mocked(db.renameProject).mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    harness?.dispose();
    vi.useRealTimers();
  });

  it('returns early without DB call or toast for blank name', async () => {
    useEditorStore.setState({ toastMessage: '' });
    await useEditorStore.getState().renameProject('project-1', '   ');
    expect(db.renameProject).not.toHaveBeenCalled();
    expect(useEditorStore.getState().toastMessage).toBe('');
  });

  it('trims whitespace and shows success toast', async () => {
    useEditorStore.setState({ toastMessage: '' });
    await useEditorStore.getState().renameProject('project-1', '  Trimmed Name  ');
    expect(db.renameProject).toHaveBeenCalledWith('project-1', 'Trimmed Name');
    expect(useEditorStore.getState().toastMessage).toMatch(/Project renamed to: Trimmed Name/i);
  });

  it('does not update projectName in the store', async () => {
    useEditorStore.setState({ projectName: 'Open Project' });
    await useEditorStore.getState().renameProject('some-other-id', 'New Dashboard Name');
    expect(useEditorStore.getState().projectName).toBe('Open Project');
  });

  it('does not set isDirty', async () => {
    useEditorStore.setState({ isDirty: false });
    await useEditorStore.getState().renameProject('project-1', 'Valid Name');
    expect(useEditorStore.getState().isDirty).toBe(false);
  });
});
