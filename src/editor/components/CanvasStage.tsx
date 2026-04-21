
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import * as fabric from 'fabric';
import { useEditorStore, DEFAULT_CANVAS_BACKGROUND } from '../state/editorStore';
import { useThemeStore } from '../state/useThemeStore';
import { initFabricSerialization } from '../fabric/initFabricCanvas';
import { resizeCanvas, updateGuides, fitCanvasToViewport, updateDocumentPaper, clearDocumentPaper } from '../fabric/canvasUtils';
import { useCanvasLifecycle } from '../hooks/useCanvasLifecycle';
import { resolveThemeValue } from '../utils/themeResolver';
import { dirtyObjects, registerAllCanvasEventHandlers } from '../services/canvasEventService';
import { ContextMenu, useContextMenu } from './ContextMenu';
import { useCanvasStore } from '../state/useCanvasStore';
import { guideRegistry } from '../fabric/guideRegistry';
import { frameScheduler, TaskPriority } from '../utils/frameScheduler';
import { coordinateSystem } from '../utils/coordinateSystem';
import { syncCanvasLayers } from '../state/layerSyncHandler';
import { CanvasSizePicker, CanvasStagePanels, CanvasSyncErrorOverlay } from './CanvasStageOverlays';
import { useCanvasStageInteractions } from '../hooks/useCanvasStageInteractions';

initFabricSerialization();

type CanvasNavKey = 'insert' | 'layers';

type CanvasStageProps = {
  onSelectNav?: (nav: CanvasNavKey) => void;
};

export const CanvasStage: React.FC<CanvasStageProps> = ({ onSelectNav: _onSelectNav }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // Context menu integration
  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu();
  const {
    canvas: fabricCanvas,
    canvasObjects,
    selectedObjectId,
    setSelectedObjectId,
    syncCanvasToStore,
    setSelectedLayerIds,
    bleedPx,
    layers,
    activeTool,
    brushSize,
    setVpt,
    setZoom,
    setCanvasOffset,
    snapEnabled,
    gridEnabled,
    addImageAsset,
    showOnboarding,
    setShowOnboarding,
    setUnitMode,
    setLayerSyncHandler,
    showGuides,
    markHistoryDirty,
    unitScale,
    setDirtyObjectsRef,
    showSafeZones,
  } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
      canvasObjects: state.canvasObjects,
      selectedObjectId: state.selectedObjectId,
      setSelectedObjectId: state.setSelectedObjectId,
      syncCanvasToStore: state.syncCanvasToStore,
      setSelectedLayerIds: state.setSelectedLayerIds,
      bleedPx: state.bleedPx,
      layers: state.layers,
      activeTool: state.activeTool,
      brushSize: state.brushSize,
      setVpt: state.setVpt,
      setZoom: state.setZoom,
      setCanvasOffset: state.setCanvasOffset,
      snapEnabled: state.snapEnabled,
      gridEnabled: state.gridEnabled,
      addImageAsset: state.addImageAsset,
      showOnboarding: state.showOnboarding,
      setShowOnboarding: state.setShowOnboarding,
      setUnitMode: state.setUnitMode,
      setLayerSyncHandler: state.setLayerSyncHandler,
      showGuides: state.showGuides,
      markHistoryDirty: state.markHistoryDirty,
      unitScale: state.unitScale,
      setDirtyObjectsRef: state.setDirtyObjectsRef,
      showSafeZones: state.showSafeZones,
    }),
    shallow
  );
  const { themeData, brushColor, canvasBackgroundColor } = useThemeStore(
    (state) => ({
      themeData: state.themeData,
      brushColor: state.brushColor,
      canvasBackgroundColor: state.canvasBackgroundColor,
    }),
    shallow
  );

  // Subscribe to document dimensions for paper updates
  const { width: docWidth, height: docHeight } = useCanvasStore(
    (state) => ({ width: state.width, height: state.height }),
    shallow
  );

  const isSpacebarDownRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastPosXRef = useRef(0);
  const lastPosYRef = useRef(0);
  const pendingPromisesRef = useRef<Set<Promise<unknown>>>(new Set());
  const updateRafRef = useRef<number | null>(null);
  const updateScheduledRef = useRef(false);
  const viewportRafRef = useRef<number | null>(null);
  const viewportScheduledRef = useRef(false);
  const persistCountRef = useRef(0); // PHASE 2.3: Counter-based persistence
  const activeToolRef = useRef(activeTool);
  const canvasOffsetRef = useRef({ x: 0, y: 0 });
  const snapEnabledRef = useRef(snapEnabled);
  const viewportRecoveryAttemptsRef = useRef(0);
  const didForceRerenderRef = useRef(false);
  const didInitialViewportFitRef = useRef(false);
  const [isOverlayDismissed, setIsOverlayDismissed] = useState(false);

  // PHASE 3.3: Circuit breaker for infinite re-render loop prevention
  const MAX_FORCE_RERENDER_ATTEMPTS = 2;
  const forceRerenderAttemptsRef = useRef(0);
  const forceRerenderBackoffRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Use the canvas lifecycle hook for atomic initialization and cleanup
  const { initializeCanvas, disposeCanvas } = useCanvasLifecycle(canvasRef, containerRef);

  useEffect(() => {
    if (!fabricCanvas) return;
    const pendingSize = useCanvasStore.getState().consumePendingSize();
    if (!pendingSize) return;
    resizeCanvas(pendingSize.width, pendingSize.height);
  }, [fabricCanvas]);

  // Canvas frame styling is now handled by CSS .canvas-wrapper class

  const isStoreManagedCanvasObject = useCallback((obj: fabric.Object) => {
    const target = obj as any;
    return !target.isGuide
      && !target.isDocumentPaper
      && !target.isSafeZoneOverlay
      && !target.isPersistentGuide
      && !target.excludeFromSync;
  }, []);

  const updateViewportState = useCallback((nextCanvas: fabric.Canvas) => {
    const vpt = nextCanvas.viewportTransform;
    if (vpt) {
      setVpt([...vpt]);
    }
    if (containerRef.current && canvasRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const nextOffset = {
        x: canvasRect.left - containerRect.left,
        y: canvasRect.top - containerRect.top,
      };
      if (
        Math.abs(nextOffset.x - canvasOffsetRef.current.x) >= 1.0  // Increased threshold to 1px
        || Math.abs(nextOffset.y - canvasOffsetRef.current.y) >= 1.0
      ) {
        canvasOffsetRef.current = nextOffset;
        // Use unitScale from store for conversion (keeping consistent with existing approach)
        const scaledOffset = {
          x: nextOffset.x * unitScale,
          y: nextOffset.y * unitScale,
        };
        setCanvasOffset(scaledOffset);
        nextCanvas.calcOffset();
      }
    }
  }, [setCanvasOffset, setVpt]);

  useEffect(() => {
    if (!fabricCanvas || !containerRef.current || didInitialViewportFitRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;

    didInitialViewportFitRef.current = true;
    frameScheduler.scheduleTask(() => {
      fitCanvasToViewport(rect.width, rect.height);
      updateViewportState(fabricCanvas);
    }, TaskPriority.High);
  }, [fabricCanvas, updateViewportState]);

  const scheduleUpdate = useCallback((
    targetCanvas?: fabric.Canvas | null,
    options?: { persist?: boolean; activate?: boolean }
  ) => {
    const nextCanvas = targetCanvas ?? fabricCanvas;
    if (!nextCanvas) return;
    const shouldPersist = !!options?.persist;

    // PHASE 2.3: Counter-based persistence - increment instead of setting boolean
    if (shouldPersist) {
      if (persistCountRef.current === 0) {
        useEditorStore.getState().startBatch();
      }
      persistCountRef.current += 1;
    }

    // Use the FrameScheduler to schedule the update
    frameScheduler.scheduleTask(() => {
        updateScheduledRef.current = false;
        updateRafRef.current = null;
        syncCanvasToStore(nextCanvas);
        updateViewportState(nextCanvas);
        nextCanvas.requestRenderAll();

        // PHASE 2.3: Counter-based persistence - reset counter and persist if > 0
        if (persistCountRef.current > 0) {
          persistCountRef.current = 0;
          useEditorStore.getState().endBatch();
        }
      }, TaskPriority.High);
  }, [fabricCanvas, syncCanvasToStore, updateViewportState]);

  const addObjectToCanvas = useCallback((
    canvas: fabric.Canvas,
    obj: fabric.Object,
    options?: { persist?: boolean; activate?: boolean }
  ) => {
    canvas.add(obj);
    if (options?.activate ?? true) {
      canvas.setActiveObject(obj);
    }
    scheduleUpdate(canvas, options);
  }, [scheduleUpdate]);

  const scheduleViewportUpdate = useCallback((targetCanvas?: fabric.Canvas | null) => {
    const nextCanvas = targetCanvas ?? fabricCanvas;
    if (!nextCanvas) return;

    // Use the FrameScheduler to schedule the viewport update
    frameScheduler.scheduleTask(() => {
        viewportScheduledRef.current = false;
        viewportRafRef.current = null;
        updateViewportState(nextCanvas);
      }, TaskPriority.Normal);
  }, [fabricCanvas, updateViewportState]);

  const getViewportBounds = useCallback((canvas: fabric.Canvas) => {
    const vpt = canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];
    const zoom = canvas.getZoom() || 1;
    const viewWidth = canvas.getWidth() / zoom;
    const viewHeight = canvas.getHeight() / zoom;
    const left = -vpt[4] / zoom;
    const top = -vpt[5] / zoom;
    return {
      left,
      top,
      right: left + viewWidth,
      bottom: top + viewHeight,
    };
  }, []);

  const getObjectsBounds = useCallback((objects: fabric.Object[]) => {
    if (objects.length === 0) return null;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    objects.forEach((obj) => {
      const rect = obj.getBoundingRect();
      minX = Math.min(minX, rect.left);
      minY = Math.min(minY, rect.top);
      maxX = Math.max(maxX, rect.left + rect.width);
      maxY = Math.max(maxY, rect.top + rect.height);
    });
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    return {
      left: minX,
      top: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }, []);

  const focusObjectsInView = useCallback(
    (canvas: fabric.Canvas, objects: fabric.Object[]) => {
      const bounds = getObjectsBounds(objects);
      if (!bounds) return;
      const padding = 40;
      const width = canvas.getWidth();
      const height = canvas.getHeight();
      if (!width || !height) return;
      const zoomX = width / (bounds.width + padding * 2);
      const zoomY = height / (bounds.height + padding * 2);
      const nextZoom = Math.min(1, zoomX, zoomY);
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height / 2;
      const vpt = canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];
      vpt[0] = nextZoom;
      vpt[3] = nextZoom;
      vpt[4] = width / 2 - centerX * nextZoom;
      vpt[5] = height / 2 - centerY * nextZoom;
      canvas.setViewportTransform(vpt);
      canvas.requestRenderAll();
      setZoom(nextZoom);
      setVpt([...vpt]);
    },
    [getObjectsBounds, setVpt, setZoom]
  );

  const areObjectsInView = useCallback((canvas: fabric.Canvas, objects: fabric.Object[]) => {
    if (objects.length === 0) return true;
    const viewport = getViewportBounds(canvas);
    return objects.some((obj) => {
      const rect = obj.getBoundingRect();
      return !(
        rect.left + rect.width < viewport.left
        || rect.left > viewport.right
        || rect.top + rect.height < viewport.top
        || rect.top > viewport.bottom
      );
    });
  }, [getViewportBounds]);

  const forceRerenderCanvas = useCallback(() => {
    if (!fabricCanvas) return;
    const background = fabricCanvas.backgroundColor;
    const backgroundImage = fabricCanvas.backgroundImage;
    fabricCanvas.discardActiveObject();
    fabricCanvas
      .getObjects()
      .filter(isStoreManagedCanvasObject)
      .forEach((obj) => fabricCanvas.remove(obj));
    if (background !== undefined) {
      fabricCanvas.backgroundColor = background;
    }
    if (backgroundImage) {
      fabricCanvas.backgroundImage = backgroundImage;
    }
    void syncCanvasLayers(canvasObjects, fabricCanvas, { selectedObjectId }).then(({ layersById: nextLayersById }) => {
      useEditorStore.setState({ layersById: nextLayersById });
      updateGuides(fabricCanvas, showGuides);
      fabricCanvas.calcOffset();
      fabricCanvas.requestRenderAll();
      const orderedObjects = fabricCanvas.getObjects().filter(isStoreManagedCanvasObject);
      if (!areObjectsInView(fabricCanvas, orderedObjects)) {
        focusObjectsInView(fabricCanvas, orderedObjects);
      }
    });
  }, [
    areObjectsInView,
    canvasObjects,
    fabricCanvas,
    focusObjectsInView,
    isStoreManagedCanvasObject,
    selectedObjectId,
    showGuides,
  ]);

  // PHASE 3.1: Use guideRegistry for bulletproof guide filtering
  const isCanvasInSync = useCallback(() => {
    if (!fabricCanvas) return true;
    const canvasIds = new Set(
      fabricCanvas.getObjects()
        .filter(isStoreManagedCanvasObject)
        .map((obj) => (obj as any).id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    );
    const storeIds = canvasObjects
      .map((obj) => obj.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (storeIds.length === 0) return true;
    if (canvasIds.size === 0) return false;
    return storeIds.every((id) => canvasIds.has(id));
  }, [canvasObjects, fabricCanvas, isStoreManagedCanvasObject]);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    snapEnabledRef.current = snapEnabled;
  }, [snapEnabled]);

  useEffect(() => {
    if (!fabricCanvas) return;
    if (!selectedObjectId) {
      fabricCanvas.discardActiveObject();
      fabricCanvas.requestRenderAll();
      return;
    }
    const targetObject = fabricCanvas
      .getObjects()
      .find((obj) => (obj as any).id === selectedObjectId);
    if (targetObject && fabricCanvas.getActiveObject() !== targetObject) {
      fabricCanvas.setActiveObject(targetObject);
      fabricCanvas.requestRenderAll();
    }
  }, [fabricCanvas, selectedObjectId]);

  useEffect(() => {
    const win = window as unknown as { __forceCanvasRerender?: () => void };
    win.__forceCanvasRerender = forceRerenderCanvas;
    return () => {
      if (win.__forceCanvasRerender === forceRerenderCanvas) {
        delete win.__forceCanvasRerender;
      }
    };
  }, [forceRerenderCanvas]);

  // PHASE 3.3: Canvas sync check with circuit breaker
  useEffect(() => {
    if (!fabricCanvas) return;
    const hasLayers = canvasObjects.length > 0;
    if (!hasLayers) {
      viewportRecoveryAttemptsRef.current = 0;
      didForceRerenderRef.current = false;
      forceRerenderAttemptsRef.current = 0; // Reset circuit breaker
      setSyncError(null);
      return;
    }

    if (!isCanvasInSync()) {
      // Circuit breaker: prevent infinite loops
      forceRerenderAttemptsRef.current += 1;

      if (forceRerenderAttemptsRef.current > MAX_FORCE_RERENDER_ATTEMPTS) {
        console.error('[CIRCUIT BREAKER] Canvas sync failed after', MAX_FORCE_RERENDER_ATTEMPTS, 'attempts. Manual intervention required.');
        setSyncError('Canvas synchronization failed. Please save your work and reload the page.');
        return;
      }

      if (didForceRerenderRef.current) return;
      didForceRerenderRef.current = true;

      frameScheduler.scheduleTask(() => {
        forceRerenderCanvas();
        forceRerenderBackoffRef.current = null;
      }, TaskPriority.High);

      return;
    }

    // Success - reset circuit breaker counter
    forceRerenderAttemptsRef.current = 0;
    didForceRerenderRef.current = false;
    setSyncError(null);
  }, [canvasObjects, fabricCanvas, forceRerenderCanvas, isCanvasInSync]);

  // Cleanup backoff timeout on unmount
  useEffect(() => {
    return () => {
      if (forceRerenderBackoffRef.current) {
        clearTimeout(forceRerenderBackoffRef.current);
        forceRerenderBackoffRef.current = null;
      }
    };
  }, []);

  // PHASE 3.4: Improved viewport recovery with smarter off-screen detection
  // Only auto-focus if ALL objects are COMPLETELY off-screen
  // Don't fight with the user if they intentionally panned away
  useEffect(() => {
    if (!fabricCanvas) return;
    const objects = guideRegistry.filterNonGuides(fabricCanvas.getObjects());
    if (objects.length === 0) {
      viewportRecoveryAttemptsRef.current = 0;
      return;
    }

    // Check if ANY objects are at least partially visible
    const hasAnyVisibleObject = areObjectsInView(fabricCanvas, objects);

    if (hasAnyVisibleObject) {
      // At least one object is visible - no recovery needed
      viewportRecoveryAttemptsRef.current = 0;
      return;
    }

    // All objects are off-screen - check if COMPLETELY off-screen
    const viewport = getViewportBounds(fabricCanvas);
    const objectBounds = getObjectsBounds(objects);

    if (!objectBounds) {
      viewportRecoveryAttemptsRef.current = 0;
      return;
    }

    // Calculate if objects are COMPLETELY off-screen (no overlap at all)
    const completelyOffScreen = (
      objectBounds.left + objectBounds.width < viewport.left ||
      objectBounds.left > viewport.right ||
      objectBounds.top + objectBounds.height < viewport.top ||
      objectBounds.top > viewport.bottom
    );

    if (completelyOffScreen && viewportRecoveryAttemptsRef.current < 2) {
      viewportRecoveryAttemptsRef.current += 1;
      // Only auto-focus on first mount or after canvas changes
      // Don't repeatedly try if user has panned away
      if (viewportRecoveryAttemptsRef.current === 1) {
        focusObjectsInView(fabricCanvas, objects);
      }
    }
  }, [areObjectsInView, fabricCanvas, layers, focusObjectsInView, getViewportBounds, getObjectsBounds]);

  useEffect(() => {
    if (layers.length > 0) {
      setShowOnboarding(false);
    }
  }, [layers, setShowOnboarding]);

  // Safe Zone Overlay Effect
  useEffect(() => {
    if (!fabricCanvas) return;

    const addSafeZoneOverlay = () => {
      // Remove existing safe zone overlay if it exists
      const existingOverlays = fabricCanvas.getObjects().filter(obj => (obj as any).isSafeZoneOverlay);
      existingOverlays.forEach(overlay => fabricCanvas.remove(overlay));

      if (!showSafeZones) {
        fabricCanvas.requestRenderAll();
        return;
      }

      // Calculate safe zone dimensions
      const canvasWidth = fabricCanvas.getWidth();
      const canvasHeight = fabricCanvas.getHeight();

      // Create four rectangles for the safe zone borders
      const overlays = [];

      // Top rectangle (above safe area)
      const topOverlay = new fabric.Rect({
        left: 0,
        top: 0,
        width: canvasWidth,
        height: bleedPx,
        fill: 'rgba(255, 0, 0, 0.2)', // Semi-transparent red
        selectable: false,
        evented: false,
        isGuide: true,
        isSafeZoneOverlay: true,
      });
      overlays.push(topOverlay);

      // Bottom rectangle (below safe area)
      const bottomOverlay = new fabric.Rect({
        left: 0,
        top: canvasHeight - bleedPx,
        width: canvasWidth,
        height: bleedPx,
        fill: 'rgba(255, 0, 0, 0.2)', // Semi-transparent red
        selectable: false,
        evented: false,
        isGuide: true,
        isSafeZoneOverlay: true,
      });
      overlays.push(bottomOverlay);

      // Left rectangle (left of safe area)
      const leftOverlay = new fabric.Rect({
        left: 0,
        top: bleedPx,
        width: bleedPx,
        height: canvasHeight - 2 * bleedPx,
        fill: 'rgba(255, 0, 0, 0.2)', // Semi-transparent red
        selectable: false,
        evented: false,
        isGuide: true,
        isSafeZoneOverlay: true,
      });
      overlays.push(leftOverlay);

      // Right rectangle (right of safe area)
      const rightOverlay = new fabric.Rect({
        left: canvasWidth - bleedPx,
        top: bleedPx,
        width: bleedPx,
        height: canvasHeight - 2 * bleedPx,
        fill: 'rgba(255, 0, 0, 0.2)', // Semi-transparent red
        selectable: false,
        evented: false,
        isGuide: true,
        isSafeZoneOverlay: true,
      });
      overlays.push(rightOverlay);

      // Add all overlays to canvas
      overlays.forEach(overlay => fabricCanvas.add(overlay));
      fabricCanvas.renderAll();
    };

    addSafeZoneOverlay();

    // Return cleanup function
    return () => {
      if (fabricCanvas) {
        // Remove existing safe zone overlay if it exists
        const existingOverlays = fabricCanvas.getObjects().filter(obj => (obj as any).isSafeZoneOverlay);
        existingOverlays.forEach(overlay => fabricCanvas.remove(overlay));
        fabricCanvas.renderAll();
      }
    };
  }, [fabricCanvas, showSafeZones, bleedPx]);

  // Document Paper Cleanup - Clears paper rect when canvas is disposed
  useEffect(() => {
    if (!fabricCanvas) return;

    return () => {
      if (fabricCanvas) {
        clearDocumentPaper(fabricCanvas);
      }
    };
  }, [fabricCanvas]);

  const trackPromise = <T,>(promise: Promise<T>, abortSignal?: AbortSignal) => {
    pendingPromisesRef.current.add(promise);
    promise.finally(() => pendingPromisesRef.current.delete(promise));

    // If aborted, return a rejected promise immediately
    if (abortSignal?.aborted) {
      return Promise.reject(new Error('Operation aborted'));
    }

    return promise;
  };

  const applyDrawingBrush = (canvas: fabric.Canvas, tool: 'draw' | 'erase') => {
    if (tool === 'erase') {
      const fallbackBrush = new fabric.PencilBrush(canvas);
      (fallbackBrush as any).globalCompositeOperation = 'destination-out';
      fallbackBrush.color = '#000000';
      fallbackBrush.width = brushSize;
      canvas.freeDrawingBrush = fallbackBrush;
      return;
    }

    const pencilBrush = new fabric.PencilBrush(canvas);
    pencilBrush.color = brushColor;
    pencilBrush.width = brushSize;
    canvas.freeDrawingBrush = pencilBrush;
  };

  const { handleDragLeave, handleDragOver, handleDrop, handleImageUpload } = useCanvasStageInteractions({
    fabricCanvas,
    addImageAsset,
    addObjectToCanvas,
    scheduleUpdate,
    setShowOnboarding,
    trackPromise,
  });

  // Setup function that registers all canvas event handlers using the canvas event service
  // This is passed to the lifecycle hook for atomic initialization
  const setupCanvasHandlers = useCallback((canvas: fabric.Canvas, abortSignal: AbortSignal) => {
    if (!containerRef.current) return null;
    const container = containerRef.current;

    // Check for early abort
    if (abortSignal.aborted) return null;

    // Register layer sync handler BEFORE setting canvas in store.
    setLayerSyncHandler(() => {
      frameScheduler.scheduleTask(() => {
        void syncCanvasLayers(useEditorStore.getState().canvasObjects, canvas, {
          selectedObjectId: useEditorStore.getState().selectedObjectId,
        }).then(({ layersById: nextLayersById }) => {
          useEditorStore.setState({ layersById: nextLayersById });
          updateViewportState(canvas);
        });
      }, TaskPriority.High);
    });
    useEditorStore.getState().requestLayerSync({ force: true });
    dirtyObjects.clear();
    setDirtyObjectsRef(dirtyObjects);

    // Register all canvas event handlers using the service
    const eventRegistry = registerAllCanvasEventHandlers({
      canvas,
      container,
      abortSignal,
      callbacks: {
        onUpdate: scheduleUpdate,
        onHistoryDirty: markHistoryDirty,
        onSelectedObjectId: setSelectedObjectId,
        onSelectedLayerIds: setSelectedLayerIds,
        onZoom: setZoom,
        onViewportChange: scheduleViewportUpdate,
      },
      refs: {
        activeTool: activeToolRef,
        isSpacebarDown: isSpacebarDownRef,
        isPanning: isPanningRef,
        lastPosX: lastPosXRef,
        lastPosY: lastPosYRef,
      },
      config: {
        snapEnabled,
        gridEnabled,
      },
    });

    // Return cleanup function that will be called by the lifecycle hook
    return () => {
      // Clean up pending promises
      const pendingPromises = Array.from(pendingPromisesRef.current);
      pendingPromises.forEach((promise) => {
        promise.catch((error) => {
          const message = error instanceof Error ? error.message.toLowerCase() : '';
          if (message.includes('aborted')) return;
        });
      });

      // Clean up guides and clear the guide registry
      updateGuides(canvas, false);
      guideRegistry.clear(); // PHASE 3.1: Clear guide registry on dispose

      // Clean up animation frame
      if (updateRafRef.current !== null) {
        cancelAnimationFrame(updateRafRef.current);
        updateRafRef.current = null;
        updateScheduledRef.current = false;

        // PHASE 2.3: Counter-based persistence cleanup
        if (persistCountRef.current > 0) {
          persistCountRef.current = 0;
          useEditorStore.getState().endBatch();
        }
      }
      if (viewportRafRef.current !== null) {
        cancelAnimationFrame(viewportRafRef.current);
        viewportRafRef.current = null;
        viewportScheduledRef.current = false;
      }

      // Clean up the FrameScheduler
      frameScheduler.cancel();

      // Clean up all event handlers using the registry
      eventRegistry.cleanupAll();
      setDirtyObjectsRef(null);
    };
  }, [
    scheduleUpdate,
    setLayerSyncHandler,
    markHistoryDirty,
    setSelectedObjectId,
    setSelectedLayerIds,
    setZoom,
    snapEnabled,
    gridEnabled,
    setDirtyObjectsRef,
  ]);

  // Main initialization effect using the lifecycle hook
  // IMPORTANT: This should only run ONCE on mount, not when setupCanvasHandlers changes
  useEffect(() => {
    let canvasInstance: fabric.Canvas | null = null;
    let cleanupHandlers: (() => void) | null = null;
    let abortController: AbortController | null = null;

    const init = async () => {
      const result = await initializeCanvas(setupCanvasHandlers);
      if (result) {
        canvasInstance = result.canvas;
        cleanupHandlers = result.cleanup;
        abortController = result.abortController;
      }
    };

    void init();

    return () => {
      if (canvasInstance) {
        void disposeCanvas(canvasInstance, cleanupHandlers, abortController);
      }
    };
  }, [initializeCanvas, disposeCanvas]);

  useEffect(() => {
    if (!fabricCanvas) return;
    const paperColor =
      canvasBackgroundColor
      || resolveThemeValue(themeData, 'surfaces.page-background')
      || DEFAULT_CANVAS_BACKGROUND; // Use the defined default background

    // Set canvas background to transparent so workspace shows through
    fabricCanvas.backgroundColor = 'transparent';

    // Create/update the document paper rectangle with the background color
    // This ensures only the document area has the background color
    updateDocumentPaper(fabricCanvas, paperColor);

    updateGuides(fabricCanvas, showGuides);
    fabricCanvas.requestRenderAll();
  }, [fabricCanvas, themeData, bleedPx, canvasBackgroundColor, showGuides, docWidth, docHeight]);

  // Update CoordinateSystem when unit mode changes
  const { unitMode } = useEditorStore(
    (state) => ({ unitMode: state.unitMode }),
    shallow
  );

  useEffect(() => {
    try {
      coordinateSystem.setMode(unitMode);
    } catch (error) {
      console.error('Error setting unit mode in CoordinateSystem:', error);
    }
  }, [unitMode]);

  useEffect(() => {
    if (!fabricCanvas) return;
    const tool = activeTool;
    const isDrawing = tool === 'draw' || tool === 'erase';
    fabricCanvas.isDrawingMode = isDrawing;
    fabricCanvas.selection = tool === 'select';
    fabricCanvas.skipTargetFind = tool !== 'select' && tool !== 'textbox';

    if (tool === 'pan') {
      fabricCanvas.defaultCursor = 'grab';
      fabricCanvas.hoverCursor = 'grab';
    } else if (tool === 'draw' || tool === 'erase') {
      fabricCanvas.defaultCursor = 'crosshair';
      fabricCanvas.hoverCursor = 'crosshair';
    } else if (tool === 'textbox') {
      fabricCanvas.defaultCursor = 'crosshair';
      fabricCanvas.hoverCursor = 'crosshair';
    } else {
      fabricCanvas.defaultCursor = 'crosshair';
      fabricCanvas.hoverCursor = 'move';
    }

    if (isDrawing) {
      applyDrawingBrush(fabricCanvas, tool === 'erase' ? 'erase' : 'draw');
    }
  }, [fabricCanvas, activeTool, brushColor, brushSize]);

  // Update CoordinateSystem when zoom changes
  const { zoom } = useEditorStore(
    (state) => ({ zoom: state.zoom }),
    shallow
  );

  useEffect(() => {
    coordinateSystem.setZoom(zoom);
  }, [zoom]);

  useEffect(() => {
    if (!fabricCanvas) return;
    (fabricCanvas as any).snapToGrid = snapEnabled;
  }, [fabricCanvas, snapEnabled]);

  const handleHearthUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await handleImageUpload(e.target.files?.[0]);
    if (uploadInputRef.current) uploadInputRef.current.value = '';
  };

  const handleDismissOverlay = () => {
    if (!isOverlayDismissed) {
      setShowOnboarding(false);
      setIsOverlayDismissed(true);
    }
  };

  return (
    <div
      className="workspace relative w-full h-full flex items-center justify-center overflow-hidden"
      onClick={handleDismissOverlay}
    >
      <div
        ref={containerRef}
        className="w-full h-full overflow-hidden bg-transparent"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragLeave={handleDragLeave}
        onContextMenu={showContextMenu}
      >
        <canvas id="design-canvas" ref={canvasRef} />
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={hideContextMenu}
          />
        )}
      </div>
      <CanvasStagePanels />
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/png, image/jpeg"
        onChange={handleHearthUpload}
        className="hidden"
      />
      {showOnboarding && !isOverlayDismissed && (
        <CanvasSizePicker
          onSelect={(width, height, unitMode) => {
            resizeCanvas(width, height);
            setUnitMode(unitMode);
            frameScheduler.scheduleTask(() => {
              if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                fitCanvasToViewport(rect.width, rect.height);
              }
            }, TaskPriority.High);
            setIsOverlayDismissed(true);
            setShowOnboarding(false);
          }}
          onDismiss={() => {
            // Default to US Letter and fit to viewport
            if (containerRef.current) {
              const rect = containerRef.current.getBoundingClientRect();
              fitCanvasToViewport(rect.width, rect.height);
            }
            setIsOverlayDismissed(true);
            setShowOnboarding(false);
          }}
        />
      )}
      <CanvasSyncErrorOverlay
        syncError={syncError}
        onDownloadProject={() => {
          useEditorStore.getState().downloadProjectFile();
        }}
        onReload={() => window.location.reload()}
        onDismiss={() => {
          setSyncError(null);
          forceRerenderAttemptsRef.current = 0;
        }}
      />
    </div>
  );
};
