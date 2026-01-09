
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import { LayoutTemplate, Square, Upload } from 'lucide-react';
import { sanityCheckCanvas, useEditorStore } from '../state/editorStore';
import { initSmartGuides } from '../fabric/smartGuides';
import { ensureObjectId, initFabricSerialization } from '../fabric/initFabricCanvas';
import { updateGuides } from '../fabric/canvasUtils';
import { useUiThemeStore } from '../state/uiThemeStore';
import type { ApocapaletteTheme } from '../types/apocapalette';
import * as objectFactories from '../fabric/objectFactories';

initFabricSerialization();

type CanvasNavKey = 'design' | 'blueprints' | 'stickers' | 'text' | 'uploads';
type CanvasObjectEvent = { target?: fabric.Object };



type CanvasStageProps = {
  onSelectNav?: (nav: CanvasNavKey) => void;
};

export const CanvasStage: React.FC<CanvasStageProps> = ({ onSelectNav }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const { 
    canvas: fabricCanvas, 
    setCanvas, 
    setSelectedObject, 
    saveState, 
    setLayers,
    setSelectedLayerIds, 
    themeData,
    bleedPx,
    layers,
    layersById,
    activeTool,
    brushColor,
    brushSize,
    canvasBackgroundColor,
    setVpt,
    setZoom,
    setCanvasOffset,
    snapEnabled,
    gridEnabled,
    addImageAsset,
    showOnboarding,
    setShowOnboarding,
    setLayerSyncHandler,
    showGuides,
    markHistoryDirty,
  } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
      setCanvas: state.setCanvas,
      setSelectedObject: state.setSelectedObject,
      saveState: state.saveState,
      setLayers: state.setLayers,
      setSelectedLayerIds: state.setSelectedLayerIds,
      themeData: state.themeData,
      bleedPx: state.bleedPx,
      layers: state.layers,
      layersById: state.layersById,
      activeTool: state.activeTool,
      brushColor: state.brushColor,
      brushSize: state.brushSize,
      canvasBackgroundColor: state.canvasBackgroundColor,
      setVpt: state.setVpt,
      setZoom: state.setZoom,
      setCanvasOffset: state.setCanvasOffset,
      snapEnabled: state.snapEnabled,
      gridEnabled: state.gridEnabled,
      addImageAsset: state.addImageAsset,
      showOnboarding: state.showOnboarding,
      setShowOnboarding: state.setShowOnboarding,
      setLayerSyncHandler: state.setLayerSyncHandler,
      showGuides: state.showGuides,
      markHistoryDirty: state.markHistoryDirty,
    }),
    shallow
  );
  const uiVars = useUiThemeStore((state) => state.vars);

  const isSpacebarDownRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastPosXRef = useRef(0);
  const lastPosYRef = useRef(0);
  const isCancelledRef = useRef(false);
  const pendingPromisesRef = useRef<Set<Promise<unknown>>>(new Set());
  const placeholderHighlightRef = useRef<{
    obj: fabric.Object;
    shadow: fabric.Shadow | null;
  } | null>(null);
  const viewportRafRef = useRef<number | null>(null);
  const canvasOffsetRafRef = useRef<number | null>(null);
  const layerSyncRafRef = useRef<number | null>(null);
  const cleanupPromiseRef = useRef<Promise<void> | null>(null);
  const activeToolRef = useRef(activeTool);
  const canvasOffsetRef = useRef({ x: 0, y: 0 });
  const snapEnabledRef = useRef(snapEnabled);
  const rerenderAttemptsRef = useRef(0);
  const viewportRecoveryAttemptsRef = useRef(0);
  const [isOverlayDismissed, setIsOverlayDismissed] = useState(false);

  const scheduleLayerSync = (targetCanvas?: fabric.Canvas | null) => {
    const nextCanvas = targetCanvas ?? fabricCanvas;
    if (!nextCanvas) return;
    if (layerSyncRafRef.current !== null) return;
    layerSyncRafRef.current = requestAnimationFrame(() => {
      layerSyncRafRef.current = null;
      setLayers(nextCanvas.getObjects());
    });
  };

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
    const orderedObjects = layers
      .map((layer) => layersById[layer.id])
      .filter((obj): obj is fabric.Object => !!obj);
    const background = fabricCanvas.backgroundColor;
    const backgroundImage = fabricCanvas.backgroundImage;
    fabricCanvas.discardActiveObject();
    fabricCanvas.clear();
    if (background !== undefined) {
      fabricCanvas.backgroundColor = background;
    }
    if (backgroundImage) {
      fabricCanvas.backgroundImage = backgroundImage;
    }
    orderedObjects.forEach((obj) => {
      fabricCanvas.add(obj);
      obj.setCoords();
    });
    updateGuides(fabricCanvas, showGuides);
    fabricCanvas.calcOffset();
    fabricCanvas.requestRenderAll();
    if (!areObjectsInView(fabricCanvas, orderedObjects)) {
      focusObjectsInView(fabricCanvas, orderedObjects);
    }
    scheduleLayerSync(fabricCanvas);
  }, [areObjectsInView, fabricCanvas, layers, layersById, showGuides, focusObjectsInView]);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    snapEnabledRef.current = snapEnabled;
  }, [snapEnabled]);

  useEffect(() => {
    setLayerSyncHandler(() => scheduleLayerSync(fabricCanvas));
    return () => {
      setLayerSyncHandler(null);
    };
  }, [fabricCanvas, setLayerSyncHandler]);

  useEffect(() => {
    const win = window as unknown as { __forceCanvasRerender?: () => void };
    win.__forceCanvasRerender = forceRerenderCanvas;
    return () => {
      if (win.__forceCanvasRerender === forceRerenderCanvas) {
        delete win.__forceCanvasRerender;
      }
    };
  }, [forceRerenderCanvas]);

  useEffect(() => {
    if (!fabricCanvas) return;
    const hasLayers = layers.length > 0;
    if (!hasLayers) {
      rerenderAttemptsRef.current = 0;
      viewportRecoveryAttemptsRef.current = 0;
      return;
    }
    const hasRenderableObjects = fabricCanvas
      .getObjects()
      .some((obj) => !(obj as any).isGuide);
    if (!hasRenderableObjects) {
      if (rerenderAttemptsRef.current < 2) {
        rerenderAttemptsRef.current += 1;
        forceRerenderCanvas();
      }
      return;
    }
    rerenderAttemptsRef.current = 0;
  }, [fabricCanvas, layers, forceRerenderCanvas]);

  useEffect(() => {
    if (!fabricCanvas) return;
    const objects = fabricCanvas
      .getObjects()
      .filter((obj) => !(obj as any).isGuide);
    if (objects.length === 0) {
      viewportRecoveryAttemptsRef.current = 0;
      return;
    }
    if (!areObjectsInView(fabricCanvas, objects)) {
      if (viewportRecoveryAttemptsRef.current < 2) {
        viewportRecoveryAttemptsRef.current += 1;
        focusObjectsInView(fabricCanvas, objects);
      }
      return;
    }
    viewportRecoveryAttemptsRef.current = 0;
  }, [areObjectsInView, fabricCanvas, layers, focusObjectsInView]);

  useEffect(() => {
    if (layers.length > 0) {
      setShowOnboarding(false);
    }
  }, [layers, setShowOnboarding]);

  const resolveThemeValue = (theme: ApocapaletteTheme | null, path: string): string | null => {
    if (!theme) return null;
    const getValueByPath = (obj: object, keyPath: string): any =>
      keyPath.split('.').reduce((acc, part) => acc && (acc as any)[part], obj);
    let value = getValueByPath(theme, path);
    if (!value && !path.endsWith('.value')) {
      value = getValueByPath(theme, `${path}.value`);
    }
    if (value && typeof value === 'object' && 'value' in value) {
      return (value as { value: string }).value;
    }
    return typeof value === 'string' ? value : null;
  };

  const trackPromise = <T,>(promise: Promise<T>) => {
    pendingPromisesRef.current.add(promise);
    promise.finally(() => pendingPromisesRef.current.delete(promise));
    return promise;
  };

  

  const syncViewportState = (canvas: fabric.Canvas) => {
    if (viewportRafRef.current !== null) return;
    viewportRafRef.current = requestAnimationFrame(() => {
      viewportRafRef.current = null;
      const vpt = canvas.viewportTransform;
      if (vpt) {
        setVpt([...vpt]);
      }
    });
  };

  const syncCanvasOffset = () => {
    if (canvasOffsetRafRef.current !== null) return;
    canvasOffsetRafRef.current = requestAnimationFrame(() => {
      canvasOffsetRafRef.current = null;
      if (!containerRef.current || !canvasRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const nextOffset = {
        x: canvasRect.left - containerRect.left,
        y: canvasRect.top - containerRect.top,
      };
      if (
        Math.abs(nextOffset.x - canvasOffsetRef.current.x) < 0.5
        && Math.abs(nextOffset.y - canvasOffsetRef.current.y) < 0.5
      ) {
        return;
      }
      canvasOffsetRef.current = nextOffset;
      setCanvasOffset(nextOffset);
      if (fabricCanvas) {
        fabricCanvas.calcOffset();
      }
    });
  };

  const clampPan = (canvas: fabric.Canvas) => {
    const vpt = canvas.viewportTransform;
    if (!vpt) return;
    const zoom = canvas.getZoom();
    const viewWidth = canvas.getWidth();
    const viewHeight = canvas.getHeight();
    const halfWidth = (viewWidth * zoom) / 2;
    const halfHeight = (viewHeight * zoom) / 2;
    const minX = -halfWidth;
    const maxX = viewWidth - halfWidth;
    const minY = -halfHeight;
    const maxY = viewHeight - halfHeight;
    const nextX = Math.min(maxX, Math.max(minX, vpt[4]));
    const nextY = Math.min(maxY, Math.max(minY, vpt[5]));
    if (nextX === vpt[4] && nextY === vpt[5]) return;
    vpt[4] = nextX;
    vpt[5] = nextY;
    canvas.setViewportTransform(vpt);
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

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    isCancelledRef.current = false;
    let isEffectCancelled = false;
    let cleanupRan = false;
    let cleanupResources: (() => void) | null = null;

    const initCanvas = async () => {
      if (cleanupPromiseRef.current) {
        await cleanupPromiseRef.current;
        cleanupPromiseRef.current = null;
      }
      if (!canvasRef.current || !containerRef.current || isEffectCancelled) return;

      const container = containerRef.current;
      const { width, height } = container.getBoundingClientRect();

      const canvas = new fabric.Canvas(canvasRef.current, {
        width,
        height,
        backgroundColor:
          canvasBackgroundColor
          || resolveThemeValue(themeData, 'surfaces.page-background')
          || uiVars['--ui-panel']
          || '#f8fafc',
        selection: true,
        controlsAboveOverlay: true,
        stopContextMenu: true,
      });
      canvas.calcOffset();

      setCanvas(canvas);
      syncCanvasOffset();
      syncViewportState(canvas);

    const handleObjectEvent = (event?: CanvasObjectEvent) => {
      const target = event?.target as fabric.Object | undefined;
      if (!target || (target as any).isGuide) {
        return;
      }
      markHistoryDirty();
      scheduleLayerSync(canvas);
    };

    const handleObjectRemoved = (event?: CanvasObjectEvent) => {
      const target = event?.target as fabric.Object | undefined;
      if (target && !(target as any).isGuide) {
        markHistoryDirty();
        scheduleLayerSync(canvas);
      }
      if (target?.type === 'image') {
        const id = (target as any).id as string | undefined;
        if (id) {
          const { imageAssets, removeImageAsset } = useEditorStore.getState();
          const imageUrl = imageAssets[id];
          if (imageUrl) {
            URL.revokeObjectURL(imageUrl);
            removeImageAsset(id);
          }
        }
      }
    };



    const handleObjectScaling = (event: any) => {
      const target = event.target as fabric.Object | undefined;
      if (!target || (target as any).isGuide) return;
      if (target.type !== 'rect') return;
      const rect = target as fabric.Rect;
      const rx = rect.rx ?? 0;
      const ry = rect.ry ?? 0;
      if (!rx && !ry) return;

      const scaleX = Math.abs(rect.scaleX ?? 1);
      const scaleY = Math.abs(rect.scaleY ?? 1);
      if (!scaleX || !scaleY) return;

      const baseRx = (rect as any).__baseRx ?? rx * scaleX;
      const baseRy = (rect as any).__baseRy ?? ry * scaleY;
      (rect as any).__baseRx = baseRx;
      (rect as any).__baseRy = baseRy;
      rect.set({
        rx: baseRx / scaleX,
        ry: baseRy / scaleY,
      });
    };

    const handleObjectAdded = (event: CanvasObjectEvent) => {
      const target = event.target as fabric.Object | undefined;
      if (!target) return;
      if ((target as any).isGuide) return;
      ensureObjectId(target, canvas);
      if (activeToolRef.current === 'draw' || activeToolRef.current === 'erase') {
        markHistoryDirty();
      }
      scheduleLayerSync(canvas);
    };

    updateGuides(canvas, useEditorStore.getState().showGuides);
    scheduleLayerSync(canvas);

    const cleanupSmartGuides = initSmartGuides(canvas, {
      snapEnabled,
      gridEnabled,
    });

    const handleAfterRender = () => {
      syncViewportState(canvas);
      syncCanvasOffset();
    };

    const handleMouseWheel = (opt: fabric.TPointerEventInfo<WheelEvent>) => {
      const evt = opt.e as WheelEvent;
      let zoom = canvas.getZoom();
      const zoomFactor = 0.999 ** evt.deltaY;
      zoom *= zoomFactor;
      const clampedZoom = Math.min(4, Math.max(0.25, zoom));
      const pointer = canvas.getPointer(evt);
      canvas.zoomToPoint(new fabric.Point(pointer.x, pointer.y), clampedZoom);
      clampPan(canvas);
      setZoom(clampedZoom);
      syncViewportState(canvas);
      evt.preventDefault();
      evt.stopPropagation();
    };

    canvas.on('object:added', handleObjectAdded);
    canvas.on('object:removed', handleObjectRemoved);
    canvas.on('object:modified', handleObjectEvent);
    canvas.on('object:scaling', handleObjectScaling);

    canvas.on('after:render', handleAfterRender);
    canvas.on('mouse:wheel', handleMouseWheel);

    // Pan with spacebar
    const onMouseDown = (opt: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
      const e = opt.e as MouseEvent;
      const tool = activeToolRef.current;
      const shouldPan = tool === 'pan' || (tool === 'select' && isSpacebarDownRef.current);
      if (shouldPan && e.button === 0) {
        isPanningRef.current = true;
        canvas.setCursor('grab');
        lastPosXRef.current = e.clientX;
        lastPosYRef.current = e.clientY;
      }
    };

    const onMouseMove = (opt: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
      if (isPanningRef.current) {
        canvas.setCursor('grabbing');
        const e = opt.e as MouseEvent;
        const deltaX = e.clientX - lastPosXRef.current;
        const deltaY = e.clientY - lastPosYRef.current;
        canvas.relativePan(new fabric.Point(deltaX, deltaY));
        clampPan(canvas);
        syncViewportState(canvas);
        lastPosXRef.current = e.clientX;
        lastPosYRef.current = e.clientY;
      }
    };

    const onMouseUp = () => {
        isPanningRef.current = false;
        const tool = activeToolRef.current;
        if (tool === 'pan') {
          canvas.setCursor('grab');
        } else {
          canvas.setCursor(isSpacebarDownRef.current ? 'grab' : 'default');
        }
    };

    canvas.on('mouse:down', onMouseDown);
    canvas.on('mouse:move', onMouseMove);
    canvas.on('mouse:up', onMouseUp);

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
        if (activeToolRef.current !== 'select') return;
        if (e.code === 'Space' && !isSpacebarDownRef.current) {
            e.preventDefault();
            isSpacebarDownRef.current = true;
            canvas.setCursor('grab');
            canvas.selection = false;
            canvas.requestRenderAll();
        }
    };

    const handleGlobalKeyUp = (e: KeyboardEvent) => {
        if (activeToolRef.current !== 'select') return;
        if (e.code === 'Space' && isSpacebarDownRef.current) {
            isSpacebarDownRef.current = false;
            canvas.setCursor('default');
            canvas.selection = true;
            canvas.requestRenderAll();
        }
    };
    
    window.addEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('keyup', handleGlobalKeyUp);

    const handleSelection = () => {
      const activeObject = canvas.getActiveObject();
      setSelectedObject(activeObject ?? null);
      if (!activeObject) {
        setSelectedLayerIds([]);
        return;
      }
      if (activeObject.type === 'activeSelection') {
        const ids = (activeObject as fabric.ActiveSelection)
          .getObjects()
          .map((obj) => (obj as any).id)
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
        setSelectedLayerIds(ids);
        return;
      }
      const id = (activeObject as any).id;
      if (typeof id === 'string' && id.trim().length > 0) {
        setSelectedLayerIds([id]);
      } else {
        setSelectedLayerIds([]);
      }
    };

    const handleSelectionCleared = () => {
      setSelectedObject(null);
      setSelectedLayerIds([]);
    };

    canvas.on('selection:created', handleSelection);
    canvas.on('selection:updated', handleSelection);
    canvas.on('selection:cleared', handleSelectionCleared);

    const handleResize = () => {
      const { width, height } = container.getBoundingClientRect();
      canvas.setDimensions({ width, height });
      canvas.calcOffset();
      updateGuides(canvas, useEditorStore.getState().showGuides);
      syncCanvasOffset();
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    cleanupResources = () => {
      const pendingPromises = Array.from(pendingPromisesRef.current);
      pendingPromises.forEach((promise) => {
        promise.catch((error) => {
          const message = error instanceof Error ? error.message.toLowerCase() : '';
          if (message.includes('aborted')) return;
        });
      });
      updateGuides(canvas, false);
      cleanupSmartGuides();
      window.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('keyup', handleGlobalKeyUp);
      resizeObserver.unobserve(container);
      resizeObserver.disconnect();
      if (viewportRafRef.current !== null) {
        cancelAnimationFrame(viewportRafRef.current);
        viewportRafRef.current = null;
      }
      if (canvasOffsetRafRef.current !== null) {
        cancelAnimationFrame(canvasOffsetRafRef.current);
        canvasOffsetRafRef.current = null;
      }
      if (layerSyncRafRef.current !== null) {
        cancelAnimationFrame(layerSyncRafRef.current);
        layerSyncRafRef.current = null;
      }
      canvas.off('object:added', handleObjectAdded);
      canvas.off('object:removed', handleObjectRemoved);
      canvas.off('object:modified', handleObjectEvent);
      canvas.off('object:scaling', handleObjectScaling);

      canvas.off('after:render', handleAfterRender);
      canvas.off('mouse:wheel', handleMouseWheel);
      canvas.off('mouse:down', onMouseDown);
      canvas.off('mouse:move', onMouseMove);
      canvas.off('mouse:up', onMouseUp);
      canvas.off('selection:created', handleSelection);
      canvas.off('selection:updated', handleSelection);
      canvas.off('selection:cleared', handleSelectionCleared);

      const disposeCanvas = () => {
        let disposeResult: Promise<unknown> | null = null;
        try {
          disposeResult = Promise.resolve(canvas.dispose());
        } catch (error) {
          const message = error instanceof Error ? error.message.toLowerCase() : '';
          if (!message.includes('aborted')) {
            return;
          }
        }
        disposeResult?.catch((error) => {
          const message = error instanceof Error ? error.message.toLowerCase() : '';
          if (message.includes('aborted')) return;
        });
      };

      const finalizeCleanup = async () => {
        await Promise.allSettled(pendingPromises);
        pendingPromisesRef.current.clear();
        disposeCanvas();
      };

      const cleanupPromise = finalizeCleanup();
      cleanupPromiseRef.current = cleanupPromise.then(() => undefined);
      void cleanupPromise;

      setCanvas(null);
    };
  };

  void initCanvas();

  return () => {
    if (cleanupRan) return;
    cleanupRan = true;
    isCancelledRef.current = true;
    isEffectCancelled = true;
    cleanupResources?.();
  };
}, []);

  useEffect(() => {
    if (!fabricCanvas) return;
    const paperColor =
      canvasBackgroundColor
      || resolveThemeValue(themeData, 'surfaces.page-background')
      || uiVars['--ui-panel']
      || '#f8fafc';
    fabricCanvas.backgroundColor = paperColor;
    updateGuides(fabricCanvas, showGuides);
    fabricCanvas.requestRenderAll();
  }, [fabricCanvas, themeData, bleedPx, uiVars, canvasBackgroundColor, showGuides]);

  useEffect(() => {
    if (!fabricCanvas) return;
    const tool = activeTool;
    const isDrawing = tool === 'draw' || tool === 'erase';
    fabricCanvas.isDrawingMode = isDrawing;
    fabricCanvas.selection = tool === 'select';
    fabricCanvas.skipTargetFind = tool !== 'select';

    if (tool === 'pan') {
      fabricCanvas.defaultCursor = 'grab';
      fabricCanvas.hoverCursor = 'grab';
    } else if (tool === 'draw' || tool === 'erase') {
      fabricCanvas.defaultCursor = 'crosshair';
      fabricCanvas.hoverCursor = 'crosshair';
    } else {
      fabricCanvas.defaultCursor = 'default';
      fabricCanvas.hoverCursor = 'move';
    }

    if (isDrawing) {
      applyDrawingBrush(fabricCanvas, tool === 'erase' ? 'erase' : 'draw');
    }
  }, [fabricCanvas, activeTool, brushColor, brushSize]);

  useEffect(() => {
    if (!fabricCanvas) return;
    (fabricCanvas as any).snapToGrid = snapEnabled;
  }, [fabricCanvas, snapEnabled]);

  

  const clearPlaceholderHighlight = () => {
    const current = placeholderHighlightRef.current;
    if (!current || !fabricCanvas) return;
    current.obj.set('shadow', current.shadow || undefined);
    placeholderHighlightRef.current = null;
    fabricCanvas.requestRenderAll();
  };

  const setPlaceholderHighlight = (placeholder: fabric.Object | null) => {
    if (!fabricCanvas) return;
    if (placeholderHighlightRef.current?.obj === placeholder) return;
    clearPlaceholderHighlight();
    if (!placeholder) return;

    const previousShadow = (placeholder.shadow as fabric.Shadow | null) ?? null;
    placeholder.set(
      'shadow',
      new fabric.Shadow({
        color: 'rgba(253, 224, 71, 0.55)',
        blur: 18,
        offsetX: 0,
        offsetY: 0,
      })
    );
    placeholderHighlightRef.current = { obj: placeholder, shadow: previousShadow };
    if (placeholder.group) {
      (placeholder.group as any).dirty = true;
    }
    fabricCanvas.requestRenderAll();
  };

  const findPlaceholderAtPointer = (pointer: fabric.Point) => {
    if (!fabricCanvas) return null;
    const objects = fabricCanvas.getObjects().slice().reverse();

    const findInObject = (obj: fabric.Object): fabric.Object | null => {
      if ((obj as any).isPlaceholder && obj.containsPoint(pointer)) {
        return obj;
      }
      if (obj.type === 'group' || obj.type === 'activeSelection') {
        const children = (obj as fabric.Group).getObjects().slice().reverse();
        for (const child of children) {
          const found = findInObject(child);
          if (found) return found;
        }
      }
      return null;
    };

    for (const obj of objects) {
      const found = findInObject(obj);
      if (found) return found;
    }
    return null;
  };

  const replacePlaceholderWithImage = (
    canvas: fabric.Canvas,
    placeholder: fabric.Object,
    img: fabric.FabricImage
  ) => {
    const center = placeholder.getCenterPoint();
    const angle = placeholder.angle || 0;
    const bounds = placeholder.getBoundingRect();
    const boxWidth = bounds.width;
    const boxHeight = bounds.height;
    const group = placeholder.group as fabric.Group | undefined;
    const groupScaleX = group?.scaleX ?? 1;
    const groupScaleY = group?.scaleY ?? 1;
    const scale = Math.max(
      boxWidth / ((img.width || 1) * groupScaleX),
      boxHeight / ((img.height || 1) * groupScaleY)
    );
    const clipWidth = boxWidth / (scale * groupScaleX);
    const clipHeight = boxHeight / (scale * groupScaleY);

    let left = center.x;
    let top = center.y;
    if (group) {
      const inverseGroup = fabric.util.invertTransform(group.calcTransformMatrix());
      const localPoint = fabric.util.transformPoint(center, inverseGroup);
      left = localPoint.x;
      top = localPoint.y;
    }

    img.set({
      left,
      top,
      originX: 'center',
      originY: 'center',
      scaleX: scale,
      scaleY: scale,
      angle,
      id: (placeholder as any).id ?? uuidv4(),
      tokenRole: (placeholder as any).tokenRole ?? null,
      colorLocked: (placeholder as any).colorLocked ?? false,
    });

    img.clipPath = new fabric.Rect({
      width: clipWidth,
      height: clipHeight,
      left: 0,
      top: 0,
      originX: 'center',
      originY: 'center',
      angle,
    });

    if (group) {
      const groupAny = group as any;
      const groupIndex = group.getObjects().indexOf(placeholder);
      group.remove(placeholder);
      group.add(img);
      if (groupIndex >= 0 && typeof groupAny.moveObjectTo === 'function') {
        groupAny.moveObjectTo(img, groupIndex);
      }
      if (typeof groupAny.addWithUpdate === 'function') {
        groupAny.addWithUpdate();
      }
    } else {
      const placeholderIndex = canvas.getObjects().indexOf(placeholder);
      canvas.remove(placeholder);
      canvas.add(img);
      if (placeholderIndex >= 0) {
        canvas.moveObjectTo(img, placeholderIndex);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!fabricCanvas) return;
    const imageUrl = e.dataTransfer.getData('text/plain');
    if (!imageUrl) {
      clearPlaceholderHighlight();
      return;
    }
    const pointer = fabricCanvas.getPointer(e.nativeEvent as MouseEvent);
    const placeholder = findPlaceholderAtPointer(pointer);
    setPlaceholderHighlight(placeholder);
  };

  const handleDragLeave = () => {
    clearPlaceholderHighlight();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setShowOnboarding(false);
    const imageUrl = e.dataTransfer.getData('text/plain');
    const isSticker = e.dataTransfer.getData('isSticker') === 'true';

    if (!fabricCanvas) return;

    if (!imageUrl) {
      const file = e.dataTransfer.files?.[0];
      if (!file) {
        clearPlaceholderHighlight();
        return;
      }
      clearPlaceholderHighlight();
      const pointer = fabricCanvas.getPointer(e.nativeEvent as MouseEvent);
      const objectURL = URL.createObjectURL(file);
      trackPromise(fabric.Image.fromURL(objectURL))
        .then((img: fabric.FabricImage) => {
          if (isCancelledRef.current) {
            URL.revokeObjectURL(objectURL);
            return;
          }
          const id = (img as any).id ?? uuidv4();
          img.set({
            id,
            src: objectURL,
            left: pointer.x,
            top: pointer.y,
            originX: 'center',
            originY: 'center',
          });
          addImageAsset(id, objectURL);
          fabricCanvas.add(img);
          sanityCheckCanvas(fabricCanvas, useEditorStore.getState().themeData);
          fabricCanvas.requestRenderAll();
          saveState();
        })
        .catch((error) => {
          URL.revokeObjectURL(objectURL);
          if (isCancelledRef.current) return;
          const message = error instanceof Error ? error.message.toLowerCase() : '';
          if (message.includes('aborted')) return;
        });
      return;
    }
    clearPlaceholderHighlight();

    const pointer = fabricCanvas.getPointer(e.nativeEvent as MouseEvent);
    const placeholder = findPlaceholderAtPointer(pointer);
    const targetObject = fabricCanvas.getObjects().find(obj =>
      obj.containsPoint(pointer) && obj.type === 'image'
    ) as fabric.Image;
    
    trackPromise(fabric.Image.fromURL(imageUrl, { crossOrigin: 'anonymous' }))
      .then((img: fabric.FabricImage) => {
        if (isCancelledRef.current) return;
        if (placeholder) {
            replacePlaceholderWithImage(fabricCanvas, placeholder, img);
        } else if (targetObject) {
            // Inherit settings from the target object
            img.set({
                left: targetObject.left,
                top: targetObject.top,
                scaleX: targetObject.scaleX,
                scaleY: targetObject.scaleY,
                angle: targetObject.angle,
                flipX: targetObject.flipX,
                flipY: targetObject.flipY,
                skewX: targetObject.skewX,
                skewY: targetObject.skewY,
                opacity: targetObject.opacity,
                id: (targetObject as any).id,
                tokenRole: (targetObject as any).tokenRole,
                colorLocked: (targetObject as any).colorLocked,
                filters: targetObject.filters,
            });
            img.applyFilters();
            fabricCanvas.remove(targetObject);
            fabricCanvas.add(img);
        } else {
            const maxWidth = isSticker ? 150 : 200;
            if (img.width! > maxWidth) {
                img.scaleToWidth(maxWidth);
            }
            img.set({
                id: uuidv4(),
                tokenRole: 'brand.accent.value',
                colorLocked: false,
                left: pointer.x,
                top: pointer.y,
                originX: 'center',
                originY: 'center',
            });
            fabricCanvas.add(img);
        }
        sanityCheckCanvas(fabricCanvas, useEditorStore.getState().themeData);
        fabricCanvas.requestRenderAll();
        saveState();
      })
      .catch((error) => {
        if (isCancelledRef.current) return;
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        if (message.includes('aborted')) return;
      });
  };

  const handleHearthUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setShowOnboarding(false);
    const file = e.target.files?.[0];
    if (file && fabricCanvas) {
      const objectURL = URL.createObjectURL(file);
      trackPromise(fabric.Image.fromURL(objectURL))
        .then((img: fabric.FabricImage) => {
          if (isCancelledRef.current) {
            URL.revokeObjectURL(objectURL);
            return;
          }
          const id = (img as any).id ?? uuidv4();
          img.set({ id, src: objectURL });
          addImageAsset(id, objectURL);
          fabricCanvas.add(img);
          fabricCanvas.centerObject(img);
          sanityCheckCanvas(fabricCanvas, useEditorStore.getState().themeData);
          fabricCanvas.requestRenderAll();
          saveState();
        })
        .catch((error) => {
          URL.revokeObjectURL(objectURL);
          if (isCancelledRef.current) return;
          const message = error instanceof Error ? error.message.toLowerCase() : '';
          if (message.includes('aborted')) return;
        });
    }
    if (uploadInputRef.current) uploadInputRef.current.value = '';
  };

  const handleAddShape = () => {
    if (!fabricCanvas) return;
    setShowOnboarding(false);
    objectFactories.addRectangle(fabricCanvas);
    sanityCheckCanvas(fabricCanvas, useEditorStore.getState().themeData);
    saveState();
  };

  const handleDismissOverlay = () => {
    if (!isOverlayDismissed) {
      setShowOnboarding(false);
      setIsOverlayDismissed(true);
    }
  };

  return (
    <div 
      className="workspace relative w-full h-full bg-[color:var(--ui-bg)] flex items-center justify-center"
      onClick={handleDismissOverlay}
    >
      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragLeave={handleDragLeave}
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas id="design-canvas" ref={canvasRef} className="bg-white shadow-[0_25px_70px_rgba(0,0,0,0.45)] rounded-[18px]" />
      </div>
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/png, image/jpeg"
        onChange={handleHearthUpload}
        className="hidden"
      />
      {showOnboarding && !isOverlayDismissed && (
        <div className="hearth absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto flex flex-col items-center gap-5 rounded-3xl border border-black/15 bg-white/90 px-10 py-8 text-center backdrop-blur-[var(--ui-blur)] shadow-[0_22px_60px_rgba(0,0,0,0.35)]">
            <div className="flex flex-col items-center gap-2">
              <span className="text-[11px] uppercase tracking-widest text-[#1a1a1a]">Start Ritual</span>
              <h2 className="text-xl font-semibold text-[#1a1a1a]">What shall we create today, Maddie?</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <button
                onClick={() => onSelectNav?.('blueprints')}
                className="flex h-28 w-40 flex-col items-center justify-center gap-2 rounded-2xl border border-black/10 bg-black/5 text-xs uppercase tracking-widest text-slate-900 transition-all duration-300 ease-in-out hover:border-[color:var(--brand-primary)]"
              >
                <LayoutTemplate className="w-6 h-6 stroke-[1.5]" />
                New Template
              </button>
              <button
                onClick={() => {
                  uploadInputRef.current?.click();
                }}
                className="flex h-28 w-40 flex-col items-center justify-center gap-2 rounded-2xl border border-black/10 bg-black/5 text-xs uppercase tracking-widest text-slate-900 transition-all duration-300 ease-in-out hover:border-[color:var(--brand-primary)]"
              >
                <Upload className="w-6 h-6 stroke-[1.5]" />
                Upload Image
              </button>
              <button
                onClick={handleAddShape}
                className="flex h-28 w-40 flex-col items-center justify-center gap-2 rounded-2xl border border-black/10 bg-black/5 text-xs uppercase tracking-widest text-slate-900 transition-all duration-300 ease-in-out hover:border-[color:var(--brand-primary)]"
              >
                <Square className="w-6 h-6 stroke-[1.5]" />
                Add Shape
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
