import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fabric from 'fabric';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
import { calculateFitCanvasZoom, FIT_VIEWPORT_PADDING, updateDocumentPaper } from '../src/editor/fabric/canvasUtils';
import { addCircleFrame } from '../src/editor/fabric/frameFactories';
import { loadDailyPlannerTemplate, loadRetroManualTemplate } from '../src/editor/fabric/blueprintFactories';
import { addIText } from '../src/editor/fabric/objectFactories';
import { ExportModal } from '../src/editor/components/ExportModal';
import { BrandKit } from '../src/editor/components/BrandKit';
import { TemplateBrowser } from '../src/editor/components/TemplateBrowser';
import { EditorShell } from '../src/editor/components/EditorShell';
import { ProductPageNavigator } from '../src/editor/components/ProductPageNavigator';
import { PageStrip } from '../src/editor/components/PageStrip';
import { buildProductStarterRecipeCards, ProductStarter } from '../src/editor/components/ProductStarter';
import { ProjectDashboard } from '../src/editor/components/ProjectDashboard';
import { ProjectPresets } from '../src/editor/components/ProjectPresets';
import { ProjectPresetsModal } from '../src/editor/components/ProjectPresetsModal';
import { isUserObject } from '../src/editor/utils/objectUtils';
import type { ProductRecipe } from '../src/editor/recipes/productRecipeTypes';
import {
  bringForward,
  bringToFront,
  clearClipboard,
  copySelection,
  pasteFromClipboard,
  sendToBack,
} from '../src/editor/services/clipboardService';
import { db } from '../src/editor/db';
import {
  DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
  LEGACY_DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
} from '../src/editor/project/projectSchema';
import { registerObjectEventHandlers } from '../src/editor/services/canvasEventService';
import { useKeyboardShortcuts } from '../src/editor/hooks/useKeyboardShortcuts';

const productForgeMocks = vi.hoisted(() => ({
  generateProductForgeArtifacts: vi.fn(),
  packageProductForgeZip: vi.fn(),
}));

vi.mock('../src/editor/productForge/generateProductForgeArtifacts', () => ({
  generateProductForgeArtifacts: productForgeMocks.generateProductForgeArtifacts,
}));

vi.mock('../src/editor/productForge/packageProductForgeZip', () => ({
  packageProductForgeZip: productForgeMocks.packageProductForgeZip,
}));

vi.mock('../src/editor/components/CanvasStage', () => ({
  CanvasStage: () => null,
}));

vi.mock('../src/editor/components/Inserter', () => ({
  Inserter: () => null,
}));

vi.mock('../src/editor/db', () => ({
  db: {
    renameProject: vi.fn().mockResolvedValue(undefined),
    getAllProjects: vi.fn().mockResolvedValue([]),
    getProject: vi.fn().mockResolvedValue(null),
    loadProject: vi.fn().mockResolvedValue(null),
    saveProject: vi.fn().mockResolvedValue('new-id'),
    getBrandKit: vi.fn().mockResolvedValue(null),
    saveBrandKit: vi.fn().mockResolvedValue('brand-kit-id'),
    updateProject: vi.fn().mockResolvedValue(undefined),
    addProject: vi.fn().mockResolvedValue('new-id'),
    templates: {
      toArray: vi.fn().mockResolvedValue([]),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
      get: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(1),
      update: vi.fn().mockResolvedValue(1),
      delete: vi.fn().mockResolvedValue(undefined),
    },
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

const readBlobText = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result ?? ''));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(blob);
});

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

const testTheme = {
  meta: { schema: 'generic-token-pack-v1', name: 'Test Theme' },
  brand: {
    primary: { value: '#00aa00' },
    accent: { value: '#3366ff' },
  },
  typography: {
    heading: { value: '#111111' },
    body: { value: '#222222' },
  },
  surfaces: {
    background: { value: '#ffffff' },
  },
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
    productProjectFields: null,
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
    productForgeMocks.generateProductForgeArtifacts.mockReset();
    productForgeMocks.packageProductForgeZip.mockReset();
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

  it('serializes rapid page switches so the active index and Fabric content cannot diverge', async () => {
    const pageOne = rectObject('page-one-shape');
    const pageTwo = rectObject('page-two-shape', { fill: '#0000ff' });
    const pageThree = rectObject('page-three-shape', { fill: '#00aa00' });
    useEditorStore.setState({
      pages: [
        { id: 'page-1', name: 'Page 1', canvasData: { objects: [pageOne] }, canvasSize: { width: 800, height: 600 } },
        { id: 'page-2', name: 'Page 2', canvasData: { objects: [pageTwo] }, canvasSize: { width: 700, height: 500 } },
        { id: 'page-3', name: 'Page 3', canvasData: { objects: [pageThree] }, canvasSize: { width: 600, height: 400 } },
      ],
      activePageIndex: 0,
      canvasObjects: [pageOne],
    });

    const originalLoad = harness.canvas.loadFromJSON.bind(harness.canvas);
    let releaseFirstLoad!: () => void;
    const firstLoadGate = new Promise<void>((resolve) => {
      releaseFirstLoad = resolve;
    });
    let loadCount = 0;
    const loadSpy = vi.spyOn(harness.canvas, 'loadFromJSON').mockImplementation(async (...args: any[]) => {
      loadCount += 1;
      if (loadCount === 1) await firstLoadGate;
      return originalLoad(...args);
    });

    const firstSwitch = useEditorStore.getState().switchToPage(1);
    await flushPromises();
    const secondSwitch = useEditorStore.getState().switchToPage(2);
    await flushPromises();

    expect(loadSpy).toHaveBeenCalledTimes(1);
    releaseFirstLoad();
    await Promise.all([firstSwitch, secondSwitch]);
    await flushPromises();

    expect(loadSpy).toHaveBeenCalledTimes(2);
    expect(useEditorStore.getState().activePageIndex).toBe(2);
    expect(objectIds(harness.canvas)).toEqual(['page-three-shape']);
    expect(useEditorStore.getState().canvasObjects.map((object) => object.id)).toEqual(['page-three-shape']);
    expect(useCanvasStore.getState()).toMatchObject({ width: 600, height: 400 });
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

  it('applies BrandKit colors to Fabric and canvasObjects before layer sync can overwrite them', async () => {
    vi.mocked(db.getBrandKit).mockResolvedValueOnce({
      colors: ['#123456'],
      typography: {
        heading: { fontFamily: 'Arial', fontSize: 32, fontWeight: 'bold' },
        body: { fontFamily: 'Arial', fontSize: 16, fontWeight: 'normal' },
      },
      logoAssets: [],
    });
    useEditorStore.getState().addObject(rectObject('brand-shape'), { save: false, select: true });
    await flushLayerAndHistory();

    render(React.createElement(BrandKit));
    await act(async () => {
      await flushPromises();
    });
    await act(async () => {
      fireEvent.click(screen.getByTitle('Apply #123456'));
      await flushLayerAndHistory();
    });

    expect(objectById(harness.canvas, 'brand-shape')?.fill).toBe('#123456');
    expect(useEditorStore.getState().canvasObjects.find((object) => object.id === 'brand-shape')?.fill).toBe('#123456');
  });

  it('commits themed fill to canvasObjects before history and layer sync', async () => {
    useThemeStore.getState().setThemeData(testTheme as any);
    useEditorStore.getState().addObject(rectObject('theme-fill-shape'), { save: false, select: true });
    await flushLayerAndHistory();

    useEditorStore.getState().setObjectThemedFill('brand.accent.value');
    await flushLayerAndHistory();

    const serialized = useEditorStore.getState().canvasObjects.find((object) => object.id === 'theme-fill-shape');
    expect(objectById(harness.canvas, 'theme-fill-shape')?.fill).toBe('#3366ff');
    expect(serialized).toMatchObject({
      fill: '#3366ff',
      tokenRole: 'brand.accent.value',
      colorLocked: false,
    });
  });

  it('commits theme tint filters to canvasObjects before history and layer sync', async () => {
    useThemeStore.getState().setThemeData(testTheme as any);
    const image = imageObject('theme-image');
    harness.canvas.add(image);
    useEditorStore.getState().syncCanvasToStore(harness.canvas);
    useEditorStore.getState().requestLayerSync({ force: true });
    useEditorStore.getState().selectObjectById('theme-image');
    await flushLayerAndHistory();

    useEditorStore.getState().applyTint('brand.accent.value');
    await flushLayerAndHistory();

    const liveImage = objectById(harness.canvas, 'theme-image') as fabric.Image | undefined;
    const serialized = useEditorStore.getState().canvasObjects.find((object) => object.id === 'theme-image') as any;
    expect(liveImage?.filters?.some((filter: any) => filter.type === 'BlendColor')).toBe(true);
    expect(serialized?.filters?.some((filter: any) => filter.type === 'BlendColor')).toBe(true);
  });

  it('commits reset-to-default theme changes to canvasObjects before history and layer sync', async () => {
    useThemeStore.getState().setThemeData(testTheme as any);
    useEditorStore.getState().addObject(rectObject('reset-theme-shape', {
      fill: '#ff00ff',
      tokenRole: 'brand.accent.value',
    } as any), { save: false, select: true });
    await flushLayerAndHistory();

    useEditorStore.getState().resetObjectToDefaultTheme();
    await flushLayerAndHistory();

    const serialized = useEditorStore.getState().canvasObjects.find((object) => object.id === 'reset-theme-shape');
    expect(objectById(harness.canvas, 'reset-theme-shape')?.fill).toBe('#00aa00');
    expect(serialized).toMatchObject({
      fill: '#00aa00',
      tokenRole: 'brand.primary.value',
      colorLocked: false,
    });
  });

  it('renders product-studio framing in the main editor shell without replacing existing panels', () => {
    useEditorStore.setState({
      projectName: 'Chaos Craft Planner',
      productProjectFields: {
        productMetadata: {
          title: 'Moon Kit Chaos Craft Planner',
        },
        recipe: {
          id: 'chaosCraftPlanner',
          version: '0.1.0',
          generatedAt: '2026-01-01T00:00:00.000Z',
        },
      } as any,
      pages: [
        {
          id: 'page-cover',
          name: 'Cover',
          canvasData: { objects: [], background: DEFAULT_CANVAS_BACKGROUND },
          canvasSize: { width: 2550, height: 3300 },
        },
        {
          id: 'page-overview',
          name: 'Project Overview',
          canvasData: { objects: [], background: DEFAULT_CANVAS_BACKGROUND },
          canvasSize: { width: 2550, height: 3300 },
        },
      ],
      activePageIndex: 1,
    });

    render(React.createElement(EditorShell, { onBackToDashboard: vi.fn() }));

    expect(screen.getByTestId('editor-shell').className).toContain('design-space-shell');
    expect(screen.getByTestId('editor-toolbar').className).toContain('design-space-topbar');
    expect(screen.getByTestId('editor-workspace').className).toContain('design-space-workspace');
    expect(screen.getByTestId('left-panel').className).toContain('design-space-left');
    expect(screen.getByTestId('canvas-workspace').className).toContain('design-space-canvas');
    expect(screen.getByTestId('right-panel').className).toContain('design-space-inspector');
    expect(screen.getByTestId('page-strip').className).toContain('design-space-page-strip');
    expect(screen.getByTestId('status-bar').className).toContain('design-space-statusbar');

    expect(screen.getByText('Design Space')).toBeTruthy();
    expect(screen.getByText('Printable Product Studio')).toBeTruthy();
    expect(screen.getByTestId('product-context-summary').textContent).toContain('Moon Kit Chaos Craft Planner');
    expect(screen.getByTestId('product-context-summary').textContent).toContain('chaosCraftPlanner v0.1.0');
    expect(screen.getByTestId('product-context-summary').textContent).toContain('2 pages');
    expect(screen.getByTestId('product-context-summary').textContent).toContain('Project Overview');

    const leftPanel = within(screen.getByTestId('left-panel'));
    expect(leftPanel.getByText('Product Workflow')).toBeTruthy();
    expect(leftPanel.getByText('Start from a recipe, edit pages, theme, then export.')).toBeTruthy();
    expect(leftPanel.getByRole('button', { name: 'Starter' })).toBeTruthy();
    expect(leftPanel.getByRole('button', { name: 'Pages' })).toBeTruthy();
    expect(leftPanel.getByRole('button', { name: 'Theme' })).toBeTruthy();
    expect(leftPanel.getByRole('button', { name: 'Export ZIP' })).toBeTruthy();
    expect(leftPanel.getByTestId('product-page-navigator')).toBeTruthy();
    expect(leftPanel.getByRole('button', { name: 'Go to page 1 Cover' })).toBeTruthy();
    expect(leftPanel.getByRole('button', { name: 'Go to page 2 Project Overview' })).toBeTruthy();
    expect(leftPanel.getByTestId('product-page-nav-item-2').getAttribute('aria-current')).toBe('page');
    fireEvent.click(leftPanel.getByRole('button', { name: 'Starter' }));
    expect(leftPanel.getByTestId('product-starter')).toBeTruthy();
    expect(leftPanel.getByText('Chaos Craft Planner')).toBeTruthy();

    expect(screen.getByTestId('right-tab-product')).toBeTruthy();
    expect(screen.getByTestId('right-tab-page')).toBeTruthy();
    expect(screen.getByTestId('right-tab-object')).toBeTruthy();
    expect(screen.getByTestId('right-tab-theme')).toBeTruthy();
    expect(screen.getByTestId('right-tab-layers')).toBeTruthy();
    expect(screen.getByTestId('right-inspector-product-panel').textContent).toContain('Moon Kit Chaos Craft Planner');
    expect(screen.getByTestId('right-inspector-product-panel').textContent).toContain('chaosCraftPlanner v0.1.0');
    expect(screen.getByTestId('right-inspector-product-panel').textContent).toContain('2 pages');

    fireEvent.click(screen.getByTestId('right-tab-page'));
    expect(screen.getByTestId('right-inspector-page-panel').textContent).toContain('2 Project Overview');
    expect(screen.getByTestId('right-inspector-page-panel').textContent).toContain('2550 × 3300 px');

    fireEvent.click(screen.getByTestId('right-tab-object'));
    expect(screen.getByTestId('right-inspector-object-panel').textContent).toContain('Select an object to edit it.');
    expect(screen.getByTestId('right-inspector-object-panel').textContent).toContain('Properties');

    fireEvent.click(screen.getByTestId('right-tab-theme'));
    expect(screen.getByTestId('right-inspector-theme-panel').textContent).toContain('Brand Kit');
    expect(screen.getByTestId('right-inspector-theme-panel').textContent).toContain('Color Palettes');

    fireEvent.click(screen.getByTestId('right-tab-layers'));
    expect(screen.getByTestId('right-inspector-layers-panel').textContent).toContain('Layers');
    expect(screen.getByRole('button', { name: 'Export' }).textContent).toContain('Export / ZIP');
  });

  it('renders the canvas paper as a distinct non-exported workbench sheet', () => {
    useCanvasStore.setState({ width: 2550, height: 3300 });

    updateDocumentPaper(harness.canvas, '#fffdf8');

    const paper = harness.canvas.getObjects().find((object) => (object as any).isDocumentPaper) as fabric.Rect | undefined;
    expect(paper).toBeTruthy();
    expect(paper?.excludeFromExport).toBe(true);
    expect((paper as any)?.isGuide).toBe(true);
    expect(paper?.originX).toBe('left');
    expect(paper?.originY).toBe('top');
    expect(paper?.left).toBe(0);
    expect(paper?.top).toBe(0);
    expect(paper?.width).toBe(2550);
    expect(paper?.height).toBe(3300);
    expect(paper?.stroke).toBe('rgba(74, 56, 45, 0.30)');
    expect(paper?.strokeWidth).toBe(2);
    expect(paper?.shadow).toBeTruthy();
    expect(FIT_VIEWPORT_PADDING).toBe(48);
  });

  it('calculates fit zoom from the bounded canvas viewport dimensions', () => {
    const zoom = calculateFitCanvasZoom({
      containerWidth: 760,
      containerHeight: 744,
      documentWidth: 2550,
      documentHeight: 3300,
    });

    expect(zoom).toBeCloseTo((744 - 24 - FIT_VIEWPORT_PADDING) / 3300, 5);
    expect(2550 * zoom).toBeLessThan(760 - 24);
    expect(3300 * zoom).toBeLessThanOrEqual(744 - 24 - FIT_VIEWPORT_PADDING);
  });

  it('renders project feedback in the scoped non-obstructive toast surface and dismisses it', () => {
    useEditorStore.setState({
      toastMessage: 'Loaded project: Tarot Card Template',
      toast: null,
    });

    render(React.createElement(EditorShell, { onBackToDashboard: vi.fn() }));

    const toast = screen.getByTestId('design-space-toast');
    expect(toast.className).toContain('design-space-toast');
    expect(toast.className).toContain('design-space-toast-info');
    expect(toast.textContent).toContain('Loaded project: Tarot Card Template');
    expect(toast.textContent).not.toContain('LOADED PROJECT: TAROT CARD TEMPLATE');

    fireEvent.click(within(toast).getByRole('button', { name: 'Dismiss toast' }));

    expect(screen.queryByTestId('design-space-toast')).toBeNull();
  });

  it('switches pages from the vertical product page navigator through the existing sync flow', async () => {
    useEditorStore.setState({
      pages: [
        {
          id: 'page-cover',
          name: 'Cover',
          canvasData: { objects: [], background: DEFAULT_CANVAS_BACKGROUND },
          canvasSize: { width: 800, height: 600 },
        },
        {
          id: 'page-overview',
          name: 'Project Overview',
          canvasData: { objects: [rectObject('page-two-shape', { fill: '#0000ff' })], background: DEFAULT_CANVAS_BACKGROUND },
          canvasSize: { width: 800, height: 600 },
        },
      ],
      activePageIndex: 0,
    });
    useEditorStore.getState().addObject(rectObject('unsaved-page-one-shape'), { save: false, select: false });
    await flushLayerAndHistory();

    render(React.createElement(ProductPageNavigator));

    expect(screen.getByRole('button', { name: 'Go to page 1 Cover' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('Cover')).toBeTruthy();
    expect(screen.getByText('Project Overview')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Go to page 2 Project Overview' }));
      await flushLayerAndHistory();
    });

    const state = useEditorStore.getState();
    expect(state.activePageIndex).toBe(1);
    expect(state.pages[0].canvasData.objects.map((object: SerializedFabricObject) => object.id)).toContain('unsaved-page-one-shape');
    expect(objectIds(harness.canvas)).toEqual(['page-two-shape']);
    expect(screen.getByRole('button', { name: 'Go to page 2 Project Overview' }).getAttribute('aria-current')).toBe('page');
  });

  it('preserves the fitted viewport when switching pages from the vertical product page navigator', async () => {
    useEditorStore.setState({
      pages: [
        {
          id: 'page-cover',
          name: 'Cover',
          canvasData: { objects: [], background: DEFAULT_CANVAS_BACKGROUND },
          canvasSize: { width: 2550, height: 3300 },
        },
        {
          id: 'page-tracker',
          name: 'Tracker',
          canvasData: { objects: [rectObject('page-two-shape', { fill: '#0000ff' })], background: DEFAULT_CANVAS_BACKGROUND },
          canvasSize: { width: 2550, height: 3300 },
        },
      ],
      activePageIndex: 0,
    });
    const fittedVpt: fabric.TMat2D = [0.22, 0, 0, 0.22, 118, 48];
    harness.canvas.setViewportTransform(fittedVpt);
    useEditorStore.getState().setZoom(0.22);
    useEditorStore.getState().setVpt([...fittedVpt]);

    render(React.createElement(ProductPageNavigator));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Go to page 2 Tracker' }));
      await flushLayerAndHistory();
    });

    expect(harness.canvas.getZoom()).toBeCloseTo(0.22, 5);
    expect(harness.canvas.viewportTransform).toEqual(fittedVpt);
    expect(useEditorStore.getState().vpt).toEqual([...fittedVpt]);
  });

  it('preserves the fitted viewport when switching pages from the page strip', async () => {
    useEditorStore.setState({
      pages: [
        {
          id: 'page-cover',
          name: 'Cover',
          canvasData: { objects: [], background: DEFAULT_CANVAS_BACKGROUND },
          canvasSize: { width: 2550, height: 3300 },
        },
        {
          id: 'page-notes',
          name: 'Notes',
          canvasData: { objects: [rectObject('page-two-shape', { fill: '#0000ff' })], background: DEFAULT_CANVAS_BACKGROUND },
          canvasSize: { width: 2550, height: 3300 },
        },
      ],
      activePageIndex: 0,
    });
    const fittedVpt: fabric.TMat2D = [0.24, 0, 0, 0.24, 96, 42];
    harness.canvas.setViewportTransform(fittedVpt);
    useEditorStore.getState().setZoom(0.24);
    useEditorStore.getState().setVpt([...fittedVpt]);

    render(React.createElement(PageStrip));
    const notesPageButton = screen.getByRole('button', { name: 'Open page 2: Notes' });

    await act(async () => {
      fireEvent.click(notesPageButton);
      await flushLayerAndHistory();
    });

    expect(harness.canvas.getZoom()).toBeCloseTo(0.24, 5);
    expect(harness.canvas.viewportTransform).toEqual(fittedVpt);
    expect(useEditorStore.getState().activePageIndex).toBe(1);
  });

  it('uses product-first copy on the dashboard without changing the create project entry point', async () => {
    (db.getAllProjects as any).mockResolvedValueOnce([]);

    render(React.createElement(ProjectDashboard));
    await act(async () => {
      await flushPromises();
    });

    expect(screen.getByText('Printable Product Studio')).toBeTruthy();
    expect(screen.getByText('Create themed printable products, reopen saved projects, and package sellable downloads from one workspace.')).toBeTruthy();
    expect(screen.getByTestId('dashboard-new-project').textContent).toContain('Create Product');
    expect(screen.getByText('Open Product Project')).toBeTruthy();
    expect(screen.getByText('Recent Product Projects')).toBeTruthy();
    expect(screen.getByText('No product projects yet.')).toBeTruthy();
    expect(screen.getByTestId('dashboard-panel').className).toContain('max-w-[1120px]');
    expect(screen.getByTestId('dashboard-panel').className).toContain('project-dashboard-panel');
    expect(screen.getByTestId('dashboard-actions').className).toContain('project-dashboard-actions');
    expect(screen.getByTestId('dashboard-root').className).not.toMatch(/\bscale-|transform|zoom\b/);
    expect(screen.getByTestId('dashboard-panel').className).not.toMatch(/\bscale-|transform|zoom\b/);
    expect(screen.getByTestId('dashboard-new-project').className).toContain('min-h-[150px]');
    expect(screen.getByTestId('dashboard-new-project').className).toContain('project-dashboard-action-card');
    expect(screen.getByTestId('dashboard-new-project').className).toContain('justify-start');
    expect(screen.getByTestId('dashboard-open-project').className).toContain('min-h-[150px]');
    expect(screen.getByTestId('dashboard-open-project').className).toContain('project-dashboard-action-card');
    expect(screen.getByTestId('dashboard-open-project').className).toContain('justify-start');
    expect(screen.getByText('Start a printable product project and choose a recipe or preset in the editor.')).toBeTruthy();
    expect(screen.getByText('Load an existing Design Space project file from your computer.')).toBeTruthy();
  });

  it('keeps dashboard create and open actions wired to existing behavior', async () => {
    (db.getAllProjects as any).mockResolvedValueOnce([]);
    const onProjectOpen = vi.fn();

    render(React.createElement(ProjectDashboard, { onProjectOpen }));
    await act(async () => {
      await flushPromises();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('dashboard-new-project'));
      await flushPromises();
    });

    expect(onProjectOpen).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState().showOnboarding).toBe(true);
    expect(useEditorStore.getState().pages).toHaveLength(1);
  });

  it('keeps the dashboard open product action wired to project file loading', async () => {
    (db.getAllProjects as any).mockResolvedValueOnce([]);
    const loadProjectFileSpy = vi.spyOn(useEditorStore.getState(), 'loadProjectFile').mockResolvedValue(undefined);
    const onProjectOpen = vi.fn();
    const projectFile = new File(['{}'], 'craft-planner.apocaproject.json', { type: 'application/json' });
    Object.defineProperty(projectFile, 'text', {
      configurable: true,
      value: vi.fn().mockResolvedValue('{}'),
    });

    render(React.createElement(ProjectDashboard, { onProjectOpen }));
    await act(async () => {
      await flushPromises();
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('dashboard-open-file-input'), {
        target: { files: [projectFile] },
      });
      await flushPromises();
    });

    expect(onProjectOpen).toHaveBeenCalledTimes(1);
    expect(loadProjectFileSpy).toHaveBeenCalledWith(projectFile);
  });

  it('renders recent product projects as readable dashboard rows', async () => {
    (db.getAllProjects as any).mockResolvedValueOnce([
      {
        id: 'project-1',
        name: 'Chaos Craft Planner Draft',
        lastModified: '2026-06-20T10:30:00.000Z',
      },
      {
        id: 'project-2',
        name: 'Gift Planner Test',
        lastModified: '2026-06-21T11:00:00.000Z',
      },
    ]);

    render(React.createElement(ProjectDashboard));
    await act(async () => {
      await flushPromises();
    });

    const cards = screen.getAllByTestId('dashboard-project-card');
    expect(cards).toHaveLength(2);
    expect(screen.getByText('Chaos Craft Planner Draft')).toBeTruthy();
    expect(screen.getByText('Gift Planner Test')).toBeTruthy();
    expect(screen.getAllByText('Open editable product project')).toHaveLength(2);
    expect(cards[0].className).toContain('rounded-2xl');
    expect(cards[0].textContent).toContain('Chaos Craft Planner Draft');
  });

  it('renders the separated ProductStarter recipe card with product output context', () => {
    render(React.createElement(ProductStarter));

    expect(screen.getByTestId('product-starter')).toBeTruthy();
    expect(screen.getByText('Product Starter')).toBeTruthy();
    const chaosCard = screen.getByTestId('recipe-chaos-craft-planner');
    expect(within(chaosCard).getByText('Chaos Craft Planner')).toBeTruthy();
    expect(within(chaosCard).getByText('Generate a 10-page printable craft planner using your active theme.')).toBeTruthy();
    expect(within(chaosCard).getByText('Printable PDF + page previews + portable product metadata.')).toBeTruthy();
    expect(screen.getByText('More templates and blank canvases remain available under Insert → Templates.')).toBeTruthy();
  });

  it('renders the Crochet Pattern Decoder Kit card from the recipe registry', () => {
    render(React.createElement(ProductStarter));

    const crochetCard = screen.getByTestId('recipe-crochet-pattern-decoder');
    expect(within(crochetCard).getByText('Crochet Pattern Decoder Kit')).toBeTruthy();
    expect(within(crochetCard).getByText(
      'Break down crochet patterns into abbreviations, stitch notes, gauge checks, row tracking, and modification notes.'
    )).toBeTruthy();
    expect(within(crochetCard).getByText('Printable PDF + page previews + portable product metadata.')).toBeTruthy();
  });

  it('builds ProductStarter cards from recipe metadata', () => {
    const fixtureRecipe: ProductRecipe = {
      id: 'fixtureRecipe',
      version: '1.2.3',
      name: 'Internal Fixture Name',
      displayName: 'Fixture Product Kit',
      starterDescription: 'Generate a fixture printable product.',
      starterOutputHint: 'Fixture PDF + fixture previews.',
      defaultPageSize: {
        presetId: 'us-letter',
        width: 2550,
        height: 3300,
        unitMode: 'in',
        dpi: 300,
      },
      pages: [
        { id: 'cover', name: 'Cover', label: 'Cover' },
      ],
      productMetadataDefaults: {
        titleTemplate: '{Theme Name} Fixture Product Kit',
      },
      exportSettingsDefaults: {
        fileSlug: 'fixture-product-kit',
      },
    };

    expect(buildProductStarterRecipeCards([fixtureRecipe])).toMatchObject([
      {
        id: 'fixtureRecipe',
        name: 'Fixture Product Kit',
        description: 'Generate a fixture printable product.',
        outputHint: 'Fixture PDF + fixture previews.',
        version: '1.2.3',
        testId: 'recipe-fixture-recipe',
      },
    ]);
  });

  it('renders and triggers a fixture recipe without ProductStarter code changes', async () => {
    const fixtureRecipe: ProductRecipe = {
      id: 'fixtureRecipe',
      version: '1.2.3',
      name: 'Internal Fixture Name',
      displayName: 'Fixture Product Kit',
      starterDescription: 'Generate a fixture printable product.',
      starterOutputHint: 'Fixture PDF + fixture previews.',
      defaultPageSize: {
        presetId: 'us-letter',
        width: 2550,
        height: 3300,
        unitMode: 'in',
        dpi: 300,
      },
      pages: [
        { id: 'cover', name: 'Cover', label: 'Cover' },
      ],
      productMetadataDefaults: {
        titleTemplate: '{Theme Name} Fixture Product Kit',
      },
      exportSettingsDefaults: {
        fileSlug: 'fixture-product-kit',
      },
    };
    const createSpy = vi
      .spyOn(useEditorStore.getState(), 'createProjectFromRecipe')
      .mockResolvedValue(undefined);

    render(React.createElement(ProductStarter, { recipes: [fixtureRecipe] }));

    expect(screen.getByText('Fixture Product Kit')).toBeTruthy();
    expect(screen.getByText('Generate a fixture printable product.')).toBeTruthy();
    expect(screen.getByText('Fixture PDF + fixture previews.')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('recipe-fixture-recipe'));
      await flushLayerAndHistory();
    });

    expect(createSpy).toHaveBeenCalledWith('fixtureRecipe');
  });

  it('triggers the Crochet Pattern Decoder recipe from the registry card', async () => {
    const createSpy = vi
      .spyOn(useEditorStore.getState(), 'createProjectFromRecipe')
      .mockResolvedValue(undefined);

    render(React.createElement(ProductStarter));

    await act(async () => {
      fireEvent.click(screen.getByTestId('recipe-crochet-pattern-decoder'));
      await flushLayerAndHistory();
    });

    expect(createSpy).toHaveBeenCalledWith('crochetPatternDecoder');
  });

  it('preserves ProductStarter unsaved-work confirmation before recipe generation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    useEditorStore.getState().addObject(rectObject('existing-work'), { save: false, select: false });
    await flushLayerAndHistory();

    render(React.createElement(ProductStarter));
    await act(async () => {
      fireEvent.click(screen.getByTestId('recipe-chaos-craft-planner'));
      await flushLayerAndHistory();
    });

    expect(confirmSpy).toHaveBeenCalledWith('Creating Chaos Craft Planner will clear your current design. Continue?');
    expect(useEditorStore.getState().pages).toHaveLength(1);
    expect(objectIds(harness.canvas)).toContain('existing-work');
  });

  it('switches the left workflow from ProductStarter to Pages after recipe creation succeeds', async () => {
    useThemeStore.getState().setThemeData(testTheme as any);
    render(React.createElement(EditorShell, { onBackToDashboard: vi.fn() }));

    const leftPanel = within(screen.getByTestId('left-panel'));
    fireEvent.click(leftPanel.getByRole('button', { name: 'Starter' }));
    expect(leftPanel.getByTestId('product-starter')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('recipe-chaos-craft-planner'));
      await flushLayerAndHistory();
    });

    expect(leftPanel.getByTestId('product-page-navigator')).toBeTruthy();
    expect(leftPanel.getByText('10 total')).toBeTruthy();
    expect(leftPanel.getByRole('button', { name: 'Go to page 1 Cover' })).toBeTruthy();
    expect(leftPanel.getByRole('button', { name: 'Go to page 10 Blank Notes' })).toBeTruthy();
  });

  it('keeps ProductStarter open when recipe creation is cancelled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    useEditorStore.getState().addObject(rectObject('existing-work'), { save: false, select: false });
    await flushLayerAndHistory();
    render(React.createElement(EditorShell, { onBackToDashboard: vi.fn() }));

    const leftPanel = within(screen.getByTestId('left-panel'));
    fireEvent.click(leftPanel.getByRole('button', { name: 'Starter' }));

    await act(async () => {
      fireEvent.click(screen.getByTestId('recipe-chaos-craft-planner'));
      await flushLayerAndHistory();
    });

    expect(confirmSpy).toHaveBeenCalledWith('Creating Chaos Craft Planner will clear your current design. Continue?');
    expect(leftPanel.getByTestId('product-starter')).toBeTruthy();
    expect(leftPanel.queryByTestId('product-page-navigator')).toBeNull();
    expect(useEditorStore.getState().pages).toHaveLength(1);
  });

  it('shows generated Chaos Craft Planner pages in the vertical product page navigator', async () => {
    useThemeStore.getState().setThemeData(testTheme as any);

    render(React.createElement(ProductStarter));
    await act(async () => {
      fireEvent.click(screen.getByTestId('recipe-chaos-craft-planner'));
      await flushLayerAndHistory();
    });

    cleanup();
    render(React.createElement(ProductPageNavigator));

    expect(screen.getByTestId('product-page-navigator')).toBeTruthy();
    expect(screen.getByText('10 total')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to page 1 Cover' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to page 2 Project Overview' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to page 3 WIP Tracker' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to page 10 Blank Notes' })).toBeTruthy();
  });

  it('keeps generated recipe pages at the fitted viewport after page switches', async () => {
    useThemeStore.getState().setThemeData(testTheme as any);

    render(React.createElement(ProductStarter));
    await act(async () => {
      fireEvent.click(screen.getByTestId('recipe-chaos-craft-planner'));
      await flushLayerAndHistory();
    });

    const fittedZoom = harness.canvas.getZoom();
    expect(fittedZoom).toBeLessThan(1);

    cleanup();
    render(React.createElement(ProductPageNavigator));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Go to page 2 Project Overview' }));
      await flushLayerAndHistory();
    });

    expect(useEditorStore.getState().activePageIndex).toBe(1);
    expect(harness.canvas.getZoom()).toBeCloseTo(fittedZoom, 5);
    expect(harness.canvas.viewportTransform?.[0]).toBeCloseTo(fittedZoom, 5);
  });

  it('starts a blank preset with empty canvasObjects and synced active page data', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    useEditorStore.getState().addObject(rectObject('old-shape'), { save: false, select: false });
    await flushLayerAndHistory();
    useEditorStore.getState().syncActivePageFromCanvas();
    expect(useEditorStore.getState().pages[0].canvasData.objects.map((object: SerializedFabricObject) => object.id)).toEqual(['old-shape']);

    render(React.createElement(TemplateBrowser));
    await act(async () => {
      await flushPromises();
    });
    fireEvent.click(screen.getByText('US Letter'));
    await flushLayerAndHistory();

    expect(confirmSpy).toHaveBeenCalled();
    expect(objectIds(harness.canvas)).toEqual([]);
    expect(useEditorStore.getState().canvasObjects).toEqual([]);
    expect(useEditorStore.getState().pages).toHaveLength(1);
    expect(useEditorStore.getState().pages[0].canvasData.objects).toEqual([]);
    expect(useEditorStore.getState().pages[0].canvasSize).toEqual({ width: 2550, height: 3300 });
    expect(useCanvasStore.getState().width).toBe(2550);
    expect(useCanvasStore.getState().height).toBe(3300);
  });

  it('renders the New Canvas modal with readable preset sections and keeps preset selection working', async () => {
    useEditorStore.setState({ isProjectPresetsOpen: true });

    render(React.createElement(ProjectPresetsModal));

    expect(screen.getAllByText('New Canvas')).toHaveLength(2);
    expect(screen.getByText('Choose a size to get started')).toBeTruthy();
    expect(screen.getByText('Print (300 DPI)')).toBeTruthy();
    expect(screen.getByText('Digital (96 DPI)')).toBeTruthy();
    expect(screen.getByText('US Letter')).toBeTruthy();
    expect(screen.getByText('Instagram Square')).toBeTruthy();
    expect(screen.getByTestId('project-preset-us-letter').className).toContain('project-presets-card');
    expect(screen.getByTestId('project-preset-us-letter').className).toContain('project-presets-card-recommended');

    await act(async () => {
      fireEvent.click(screen.getByTestId('project-preset-us-letter'));
      await flushLayerAndHistory();
    });

    expect(useCanvasStore.getState().width).toBe(2550);
    expect(useCanvasStore.getState().height).toBe(3300);
    expect(useEditorStore.getState().isProjectPresetsOpen).toBe(false);
  });

  it('renders ProjectPresets with readable preset cards when used directly', () => {
    render(React.createElement(ProjectPresets));

    expect(screen.getByText('New Canvas')).toBeTruthy();
    expect(screen.getByText('Print (300 DPI)')).toBeTruthy();
    expect(screen.getByText('Digital (96 DPI)')).toBeTruthy();
    expect(screen.getByTestId('project-preset-a4-document').className).toContain('project-presets-card');
    expect(screen.getByText('Safe Margin 24px')).toBeTruthy();
    expect(screen.getByText('Pixels Mode')).toBeTruthy();
  });

  it('creates a Chaos Craft Planner from the ProductStarter recipe trigger', async () => {
    useThemeStore.getState().setThemeData(testTheme as any);

    render(React.createElement(ProductStarter));
    await act(async () => {
      fireEvent.click(screen.getByTestId('recipe-chaos-craft-planner'));
      await flushLayerAndHistory();
    });

    const state = useEditorStore.getState();
    expect(state.pages).toHaveLength(10);
    expect(state.activePageIndex).toBe(0);
    expect(state.pages[0].name).toBe('Cover');
    expect(objectIds(harness.canvas)).toContain('chaosCraftPlanner-cover-title');
    expect(state.canvasObjects.map((object) => object.id)).toContain('chaosCraftPlanner-cover-title');
    expect(state.productProjectFields?.recipe).toMatchObject({
      id: 'chaosCraftPlanner',
      version: '0.1.0',
    });
    expect(state.productProjectFields?.productMetadata?.title).toBe('Test Theme Chaos Craft Planner');
    expect(state.saveStatus).toBe('unsaved');
  });

  it('creates a Chaos Craft Planner with the safe default theme when no active theme is selected', async () => {
    useThemeStore.getState().setThemeData(null);
    useThemeStore.getState().setBrandVault([]);
    useThemeStore.getState().setActiveBrandCollectionId(null);

    render(React.createElement(ProductStarter));
    await act(async () => {
      fireEvent.click(screen.getByTestId('recipe-chaos-craft-planner'));
      await flushLayerAndHistory();
    });

    const state = useEditorStore.getState();
    expect(state.pages).toHaveLength(10);
    expect(state.pages[0].name).toBe('Cover');
    expect(state.productProjectFields?.theme?.name).toBe('Default Theme');
    expect(state.productProjectFields?.productMetadata?.title).toBe('Default Theme Chaos Craft Planner');
    expect(useThemeStore.getState().themeData?.meta?.name).toBe('Default Theme');
  });

  it('preserves generated recipe and product fields when downloading the project file', async () => {
    let capturedBlob: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
      capturedBlob = value as Blob;
      return 'blob:recipe-project-export';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    useThemeStore.getState().setThemeData(testTheme as any);

    render(React.createElement(ProductStarter));
    await act(async () => {
      fireEvent.click(screen.getByTestId('recipe-chaos-craft-planner'));
      await flushLayerAndHistory();
    });

    await act(async () => {
      await useEditorStore.getState().downloadProjectFile();
      await flushPromises();
    });

    expect(capturedBlob).toBeTruthy();
    vi.useRealTimers();
    const exported = JSON.parse(await readBlobText(capturedBlob!));
    expect(exported.schemaVersion).toBe(DESIGN_SPACE_PROJECT_SCHEMA_VERSION);
    expect(exported.recipe).toMatchObject({
      id: 'chaosCraftPlanner',
      version: '0.1.0',
    });
    expect(exported.pages).toHaveLength(10);
    expect(exported.pages[0].name).toBe('Cover');
    expect(exported.productMetadata.title).toBe('Test Theme Chaos Craft Planner');
    expect(exported.exportSettings.pdfFileName).toBe('test-theme-chaos-craft-planner.pdf');
  });

  it('exports .apocaproject JSON with the product-aware schema version', async () => {
    let capturedBlob: Blob | null = null;
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
      capturedBlob = value as Blob;
      return 'blob:project-export';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    useEditorStore.getState().addObject(rectObject('schema-shape'), { save: false, select: false });
    await flushLayerAndHistory();

    await useEditorStore.getState().downloadProjectFile();

    expect(createObjectUrlSpy).toHaveBeenCalled();
    expect(capturedBlob).toBeTruthy();
    vi.useRealTimers();
    const exported = JSON.parse(await readBlobText(capturedBlob!));
    expect(exported.schemaVersion).toBe(DESIGN_SPACE_PROJECT_SCHEMA_VERSION);
    expect(exported.document.pageSize).toMatchObject({ width: 800, height: 600, unitMode: 'in' });
    expect(exported.pages[0].canvasData.objects.map((object: SerializedFabricObject) => object.id)).toContain('schema-shape');
  });

  it('loads product-aware project payloads and updates without losing product fields', async () => {
    const productPayload = {
      schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      projectId: 'product-project-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      metadata: {
        name: 'Loaded Product',
        slug: 'loaded-product',
        sourceApp: 'design-space',
      },
      document: {
        pageSize: { presetId: 'us-letter', width: 2550, height: 3300, unitMode: 'in', dpi: 300 },
        background: { tokenRole: 'surfaces.page-background.value', value: '#f7f1e8' },
        bleedPx: 36,
        safeMarginPx: 72,
      },
      theme: {
        source: 'apocapalette',
        themeId: 'theme-1',
        name: 'Moon Kit',
        slug: 'moon-kit',
        version: '1.0.0',
        tokens: testTheme,
      },
      recipe: {
        id: 'homeResetPack',
        version: '0.1.0',
        generatedAt: '2026-01-01T00:00:00.000Z',
      },
      pages: [{
        id: 'page-1',
        name: 'Cover',
        canvasData: { objects: [rectObject('loaded-shape')], background: '#f7f1e8' },
        canvasSize: { width: 2550, height: 3300 },
      }],
      activePageIndex: 0,
      canvasData: { objects: [rectObject('loaded-shape')], background: '#f7f1e8' },
      assets: {},
      activeTheme: testTheme,
      lastUpdated: '2026-01-02T00:00:00.000Z',
      canvasSize: { width: 2550, height: 3300 },
      unitMode: 'in',
      exportSettings: {
        pdfFileName: 'loaded-product.pdf',
        previewFileNames: ['loaded-product-preview-page-01.png'],
        formats: ['pdf', 'png'],
        dpi: 300,
        includeBackground: true,
      },
      productMetadata: {
        title: 'Loaded Product',
        description: 'Printable product description',
        tags: ['printable', 'planner'],
        category: 'home',
        useCases: ['reset'],
        includedFiles: ['loaded-product.pdf'],
        listingCopy: {
          shortDescription: 'Short listing copy',
          longDescription: 'Long listing copy',
          bullets: ['Editable', 'Printable'],
        },
      },
    };
    vi.mocked(db.loadProject).mockResolvedValueOnce({
      project: {
        id: 'product-project-1',
        name: 'Loaded Product',
        lastModified: new Date('2026-01-02T00:00:00.000Z'),
        canvasDataId: 'canvas-data-1',
      },
      canvasData: JSON.stringify(productPayload),
    });

    await useEditorStore.getState().loadProject('product-project-1');
    await flushLayerAndHistory();

    expect(objectIds(harness.canvas)).toEqual(['loaded-shape']);
    expect(useEditorStore.getState().productProjectFields?.recipe?.id).toBe('homeResetPack');
    vi.mocked(db.updateProject).mockClear();

    await useEditorStore.getState().updateCurrentProject();

    const savedPayload = JSON.parse(vi.mocked(db.updateProject).mock.calls.at(-1)?.[2] as string);
    expect(savedPayload.schemaVersion).toBe(DESIGN_SPACE_PROJECT_SCHEMA_VERSION);
    expect(savedPayload.projectId).toBe('product-project-1');
    expect(savedPayload.recipe).toMatchObject({ id: 'homeResetPack', version: '0.1.0' });
    expect(savedPayload.document).toMatchObject({
      pageSize: { presetId: 'us-letter', width: 2550, height: 3300, unitMode: 'in', dpi: 300 },
      background: { tokenRole: 'surfaces.page-background.value', value: '#f7f1e8' },
      bleedPx: 36,
      safeMarginPx: 72,
    });
    expect(savedPayload.productMetadata).toMatchObject({
      title: 'Loaded Product',
      description: 'Printable product description',
      tags: ['printable', 'planner'],
      includedFiles: ['loaded-product.pdf'],
    });
    expect(savedPayload.pages[0].canvasData.objects.map((object: SerializedFabricObject) => object.id)).toEqual(['loaded-shape']);
  });

  it('loads v1 product projects whose active Fabric data is stored at the payload root', async () => {
    const activeCanvasData = {
      objects: [rectObject('legacy-product-shape')],
      background: '#f7f1e8',
    };
    const legacyProductPayload = {
      schemaVersion: LEGACY_DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      projectName: 'Recent Product Draft',
      pages: [{
        id: 'legacy-page-1',
        name: 'Cover',
        canvasSize: { width: 1200, height: 900 },
      }],
      activePageIndex: 0,
      canvasData: activeCanvasData,
      lastUpdated: '2026-06-20T10:30:00.000Z',
      canvasSize: { width: 1200, height: 900 },
      unitMode: 'in',
    };
    vi.mocked(db.loadProject).mockResolvedValueOnce({
      project: {
        id: 'recent-product-project',
        name: 'Recent Product Draft',
        lastModified: new Date('2026-06-20T10:30:00.000Z'),
        canvasDataId: 'legacy-canvas-data',
      },
      canvasData: JSON.stringify(legacyProductPayload),
    });

    await useEditorStore.getState().loadProject('recent-product-project');
    await flushLayerAndHistory();

    expect(objectIds(harness.canvas)).toEqual(['legacy-product-shape']);
    expect(useEditorStore.getState()).toMatchObject({
      currentLibraryProjectId: 'recent-product-project',
      projectName: 'Recent Product Draft',
      activePageIndex: 0,
      isDirty: false,
    });
    expect(useEditorStore.getState().pages[0]).toMatchObject({
      kind: 'canvas',
      id: 'legacy-page-1',
      canvasSize: { width: 1200, height: 900 },
    });
    expect(useEditorStore.getState().toastMessage).toBe('Loaded project: Recent Product Draft');
  });

  it('routes ExportModal current-page and all-pages PDF through AdvancedExportManager', async () => {
    const exportSpy = vi.spyOn(advancedExportManager, 'export').mockResolvedValue(undefined);
    const exportPagesSpy = vi.spyOn(advancedExportManager, 'exportPagesPdf').mockResolvedValue(undefined);
    const onClose = vi.fn();
    useThemeStore.getState().setCanvasBackgroundColor('#ffeecc');
    useEditorStore.getState().addObject(rectObject('pdf-shape'), { save: false, select: false });
    await flushPromises();

    render(React.createElement(ExportModal, { isOpen: true, onClose }));

    expect(screen.getByText('Product Bundle / Product Forge ZIP')).toBeTruthy();
    expect(screen.getByText('Quick Exports')).toBeTruthy();
    expect(screen.getByText('Advanced Exports')).toBeTruthy();
    expect(screen.getByText('Packages the printable PDF, preview PNGs, metadata, manifest, README, and listing copy.')).toBeTruthy();
    expect(screen.getByText('1 page ready for PDF, previews, metadata, and ZIP packaging.')).toBeTruthy();
    expect(screen.getByText('Common current-page downloads for previews and proofing.')).toBeTruthy();
    expect(screen.getByText('Lower-level formats for testing, assets, and manual workflows.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download PNG (300 DPI)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download JPEG' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download SVG' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download PNG (All Pages)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download JPEG (All Pages)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download SVG (All Pages)' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await act(async () => { await flushPromises(); });
    expect(exportSpy).toHaveBeenCalledWith(harness.canvas, 'pdf', expect.objectContaining({
      includeBackground: true,
      backgroundColor: '#FFEECC',
      dpi: 300,
      fileName: 'Integration Test',
    }));

    const allPagesPdfButton = screen.getByRole('button', { name: 'Download PDF (All Pages)' }) as HTMLButtonElement;
    expect(allPagesPdfButton.disabled).toBe(false);
    fireEvent.click(allPagesPdfButton);
    await act(async () => { await flushPromises(); });
    expect(exportPagesSpy).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      includeBackground: true,
      backgroundColor: '#FFEECC',
      dpi: 300,
      fileName: 'Integration Test',
      imageAssets: {},
    }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('downloads Product Forge ZIP from the current editor project', async () => {
    const artifactResult = {
      productTitle: 'Integration Product',
      pageCount: 1,
      artifacts: [],
      manifest: {
        schemaVersion: 'product-forge-artifacts-v1',
        generatedAt: '2026-06-18T00:00:00.000Z',
        productTitle: 'Integration Product',
        pageCount: 1,
        pageSize: { width: 800, height: 600, unitMode: 'in', dpi: 300 },
        files: [],
      },
    };
    const zipBlob = new Blob(['zip'], { type: 'application/zip' });
    productForgeMocks.generateProductForgeArtifacts.mockResolvedValue(artifactResult);
    productForgeMocks.packageProductForgeZip.mockResolvedValue({
      status: 'generated',
      fileName: 'integration-product.zip',
      mimeType: 'application/zip',
      blob: zipBlob,
      sizeBytes: zipBlob.size,
      manifest: artifactResult.manifest,
      packagedFiles: [],
    });
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:product-zip');
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const linkClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const syncSpy = vi.spyOn(useEditorStore.getState(), 'syncActivePageFromCanvas');
    useEditorStore.setState({
      productProjectFields: {
        schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
        projectId: 'product-zip-project',
        updatedAt: '2026-06-18T00:00:00.000Z',
        metadata: { name: 'Integration Product', sourceApp: 'design-space' },
        document: {
          pageSize: { presetId: 'us-letter', width: 2550, height: 3300, unitMode: 'in', dpi: 300 },
        },
        recipe: { id: 'chaosCraftPlanner', version: '0.1.0' },
        theme: { name: 'Test Theme' },
        exportSettings: {
          pdfFileName: 'integration-product.pdf',
          previewFileNames: ['integration-product-preview-page-01.png'],
          formats: ['pdf', 'png'],
          dpi: 300,
          includeBackground: true,
        },
        productMetadata: {
          title: 'Integration Product',
          tags: ['planner'],
          useCases: ['testing'],
        },
      },
    });
    const onClose = vi.fn();

    render(React.createElement(ExportModal, { isOpen: true, onClose }));

    expect(screen.getByText('Integration Product')).toBeTruthy();
    expect(screen.getByText('chaosCraftPlanner v0.1.0')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId('download-product-zip'));
      await flushPromises();
    });

    expect(syncSpy).toHaveBeenCalled();
    expect(productForgeMocks.generateProductForgeArtifacts).toHaveBeenCalledWith(expect.objectContaining({
      projectName: 'Integration Test',
      pages: expect.any(Array),
      productProjectFields: expect.objectContaining({
        recipe: { id: 'chaosCraftPlanner', version: '0.1.0' },
      }),
    }));
    expect(syncSpy.mock.invocationCallOrder[0]).toBeLessThan(
      productForgeMocks.generateProductForgeArtifacts.mock.invocationCallOrder[0]
    );
    expect(productForgeMocks.packageProductForgeZip).toHaveBeenCalledWith(
      artifactResult,
      expect.objectContaining({
        productMetadata: expect.objectContaining({ title: 'Integration Product' }),
        recipe: { id: 'chaosCraftPlanner', version: '0.1.0' },
        exportSettings: expect.objectContaining({ pdfFileName: 'integration-product.pdf' }),
      })
    );
    expect(createObjectUrlSpy).toHaveBeenCalledWith(zipBlob);
    expect(linkClickSpy).toHaveBeenCalled();
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:product-zip');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a Product ZIP error without triggering download when packaging fails', async () => {
    const artifactResult = {
      productTitle: 'Broken Product',
      pageCount: 1,
      artifacts: [],
      manifest: {
        schemaVersion: 'product-forge-artifacts-v1',
        generatedAt: '2026-06-18T00:00:00.000Z',
        productTitle: 'Broken Product',
        pageCount: 1,
        pageSize: { width: 800, height: 600, unitMode: 'in', dpi: 300 },
        files: [],
      },
    };
    productForgeMocks.generateProductForgeArtifacts.mockResolvedValue(artifactResult);
    productForgeMocks.packageProductForgeZip.mockResolvedValue({
      status: 'failed',
      fileName: 'broken-product.zip',
      mimeType: 'application/zip',
      manifest: artifactResult.manifest,
      packagedFiles: [],
      errors: ['Printable PDF artifact is failed: PDF render failed'],
    });
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:should-not-download');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onClose = vi.fn();

    render(React.createElement(ExportModal, { isOpen: true, onClose }));

    await act(async () => {
      fireEvent.click(screen.getByTestId('download-product-zip'));
      await flushPromises();
    });

    expect(screen.getByRole('alert').textContent).toContain('Printable PDF artifact is failed: PDF render failed');
    expect(createObjectUrlSpy).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables Product ZIP download when there are no pages to package', () => {
    useEditorStore.setState({ pages: [] });

    render(React.createElement(ExportModal, { isOpen: true, onClose: vi.fn() }));

    expect((screen.getByTestId('download-product-zip') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('No pages are available to package yet.')).toBeTruthy();
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

describe('core persistence regressions', () => {
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

  it('embeds an inactive page image nested in a group when downloading a project', async () => {
    vi.useRealTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(['inactive-image'], { type: 'image/png' }),
    } as Response);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    let capturedBlob: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
      if (value instanceof Blob && value.type === 'application/json') capturedBlob = value;
      return 'blob:project-download';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    useEditorStore.setState({
      pages: [
        {
          id: 'page-1',
          name: 'Page 1',
          canvasData: { objects: [], background: '#ffffff' },
          canvasSize: { width: 800, height: 600 },
        },
        {
          id: 'page-2',
          name: 'Page 2',
          canvasData: {
            objects: [{
              id: 'group-1',
              type: 'group',
              objects: [{ id: 'inactive-image', type: 'image', src: 'inactive-image' }],
            }],
            background: '#ffffff',
          },
          canvasSize: { width: 800, height: 600 },
        },
      ],
      activePageIndex: 0,
      imageAssets: { 'inactive-image': 'https://assets.test/inactive.png' },
    });

    await useEditorStore.getState().downloadProjectFile();

    expect(fetchSpy).toHaveBeenCalledWith('https://assets.test/inactive.png');
    expect(capturedBlob).toBeTruthy();
    const payload = JSON.parse(await readBlobText(capturedBlob!));
    expect(payload.pages[1].canvasData.objects[0].objects[0].src).toBe('inactive-image');
    expect(payload.assets['inactive-image']).toMatch(/^data:image\/png;base64,/);
  });

  it('does not autosave an unsaved or imported project by matching its name', async () => {
    vi.mocked(db.getAllProjects).mockClear();
    vi.mocked(db.updateProject).mockClear();
    useEditorStore.setState({
      projectName: 'Same Name As Library Project',
      currentLibraryProjectId: null,
      isDirty: false,
      autoSaveStatus: 'idle',
      saveStatus: 'saved',
    });

    useEditorStore.getState().saveState();
    await vi.advanceTimersByTimeAsync(2500);

    expect(db.getAllProjects).not.toHaveBeenCalled();
    expect(db.updateProject).not.toHaveBeenCalled();
    expect(useEditorStore.getState()).toMatchObject({
      isDirty: true,
      autoSaveStatus: 'dirty',
      saveStatus: 'unsaved',
    });
  });

  it('clears dirty state only after ID-targeted autosave succeeds', async () => {
    vi.mocked(db.updateProject).mockClear();
    useEditorStore.setState({
      projectName: 'Stable Library Project',
      currentLibraryProjectId: 'stable-library-id',
      isDirty: false,
      autoSaveStatus: 'idle',
      saveStatus: 'saved',
    });

    useEditorStore.getState().saveState();
    await vi.advanceTimersByTimeAsync(2500);
    await flushPromises();

    expect(db.updateProject).toHaveBeenCalledWith(
      'stable-library-id',
      'Stable Library Project',
      expect.any(String),
      expect.any(String)
    );
    expect(useEditorStore.getState()).toMatchObject({
      isDirty: false,
      autoSaveStatus: 'saved',
      saveStatus: 'saved',
    });
  });

  it('keeps existing canvas work intact when project import structure is malformed', async () => {
    useEditorStore.getState().addObject(rectObject('keep-me'), { save: false, select: false });
    await flushLayerAndHistory();
    const malformedFile = {
      name: 'malformed.apocaproject.json',
      text: async () => JSON.stringify({
        projectName: 'Broken',
        pages: [{ id: 'bad-page', name: 'Bad', canvasData: { objects: 'not-an-array' } }],
      }),
    } as File;

    await useEditorStore.getState().loadProjectFile(malformedFile);

    expect(objectIds(harness.canvas)).toContain('keep-me');
    expect(useEditorStore.getState().canvasObjects.map((object) => object.id)).toContain('keep-me');
    expect(useEditorStore.getState().toastMessage).toBe('Failed to load project file.');
  });

  it('rejects oversized imported page dimensions before replacing current work', async () => {
    useEditorStore.getState().addObject(rectObject('keep-size-safe'), { save: false, select: false });
    await flushLayerAndHistory();
    const oversizedFile = {
      name: 'oversized.apocaproject.json',
      size: 1024,
      text: async () => JSON.stringify({
        projectName: 'Oversized',
        pages: [{
          id: 'oversized-page',
          name: 'Oversized Page',
          canvasData: { objects: [] },
          canvasSize: { width: 30_001, height: 600 },
        }],
      }),
    } as File;

    await useEditorStore.getState().loadProjectFile(oversizedFile);

    expect(objectIds(harness.canvas)).toContain('keep-size-safe');
    expect(useEditorStore.getState().canvasObjects.map((object) => object.id)).toContain('keep-size-safe');
    expect(useEditorStore.getState().toastMessage).toBe('Failed to load project file.');
  });

  it('syncs keyboard nudges to the store before history and layer reconciliation', async () => {
    useEditorStore.getState().addObject(rectObject('nudge-me'), { save: true, select: true });
    await flushLayerAndHistory();
    render(React.createElement(() => {
      useKeyboardShortcuts();
      return null;
    }));
    const before = objectById(harness.canvas, 'nudge-me')?.left ?? 0;

    fireEvent.keyDown(window, { key: 'ArrowRight' });

    expect(objectById(harness.canvas, 'nudge-me')?.left).toBe(before + 1);
    expect(useEditorStore.getState().canvasObjects.find((object) => object.id === 'nudge-me')?.left).toBe(before + 1);
    await flushLayerAndHistory();
    expect(objectById(harness.canvas, 'nudge-me')?.left).toBe(before + 1);
  });

  it('records Fabric text editing events as persistent document mutations', () => {
    const text = new fabric.IText('Draft', { id: 'editable-text' } as any);
    harness.canvas.add(text);
    const onUpdate = vi.fn();
    const onHistoryDirty = vi.fn();
    const registration = registerObjectEventHandlers({
      canvas: harness.canvas,
      callbacks: { onUpdate, onHistoryDirty },
    });

    text.set({ text: 'Final' });
    harness.canvas.fire('text:changed', { target: text } as any);

    expect(onHistoryDirty).toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledWith(harness.canvas, { persist: true });
    registration.cleanup();
  });

  it('can unlock a non-selectable layer by ID after a full lock', async () => {
    useEditorStore.getState().addObject(rectObject('lock-me'), { save: true, select: true });
    await flushLayerAndHistory();

    useEditorStore.getState().toggleObjectLock('lock-me');
    await flushLayerAndHistory();
    expect(objectById(harness.canvas, 'lock-me')).toMatchObject({
      selectable: false,
      lockMovementX: true,
    });

    useEditorStore.getState().toggleObjectLock('lock-me');
    await flushLayerAndHistory();
    expect(objectById(harness.canvas, 'lock-me')).toMatchObject({
      selectable: true,
      lockMovementX: false,
    });
  });

  it('marks page reordering unsaved and schedules autosave only for a stable library ID', () => {
    useEditorStore.setState({
      currentLibraryProjectId: 'library-project',
      pages: [
        { id: 'page-1', name: 'Page 1', canvasData: { objects: [] }, canvasSize: { width: 800, height: 600 } },
        { id: 'page-2', name: 'Page 2', canvasData: { objects: [] }, canvasSize: { width: 800, height: 600 } },
      ],
      activePageIndex: 0,
      isDirty: false,
      autoSaveStatus: 'idle',
      saveStatus: 'saved',
    });

    useEditorStore.getState().reorderPages(0, 1);

    expect(useEditorStore.getState().pages.map((page) => page.id)).toEqual(['page-2', 'page-1']);
    expect(useEditorStore.getState()).toMatchObject({
      isDirty: true,
      autoSaveStatus: 'dirty',
      saveStatus: 'unsaved',
    });
    expect(useEditorStore.getState().autoSaveTimer).not.toBeNull();
  });

  it('undoes a background full snapshot whose preceding history entry is a diff', async () => {
    useEditorStore.getState().addObject(rectObject('shape-before-background'), { save: true, select: false });
    await flushLayerAndHistory();
    useEditorStore.getState().setCanvasBackgroundColor('#123456');
    await flushLayerAndHistory();

    expect(useThemeStore.getState().canvasBackgroundColor).toBe('#123456');
    await useEditorStore.getState().undo();
    await flushPromises();

    expect(useThemeStore.getState().canvasBackgroundColor).toBe(DEFAULT_CANVAS_BACKGROUND);
    expect(objectIds(harness.canvas)).toContain('shape-before-background');
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
