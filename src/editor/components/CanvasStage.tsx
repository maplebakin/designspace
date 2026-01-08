
import React, { useRef, useEffect } from 'react';
import { shallow } from 'zustand/shallow';
import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import { LayoutTemplate, Square, Upload } from 'lucide-react';
import { hydrateCanvasDataWithAssets, sanityCheckCanvas, useEditorStore } from '../state/editorStore';
import { initSmartGuides } from '../fabric/smartGuides';
import {
  clearPersistentGuides,
  ensureObjectId,
  initFabricSerialization,
  reviveCustomFabricProps,
  drawPersistentGuides,
} from '../fabric/initFabricCanvas';
import { useUiThemeStore } from '../state/uiThemeStore';
import type { ApocapaletteTheme } from '../types/apocapalette';
import * as objectFactories from '../fabric/objectFactories';

initFabricSerialization();

type CanvasNavKey = 'design' | 'blueprints' | 'stickers' | 'text' | 'uploads';
type CanvasObjectEvent = { target?: fabric.Object };

const AUTOSAVE_STORAGE_KEY = 'witchclick_current_design';

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
    setLayers, 
    saveState, 
    setSelectedLayerId, 
    themeData,
    bleedPx,
    layers,
    activeTool,
    brushColor,
    brushSize,
    canvasBackgroundColor,
    setVpt,
    setZoom,
    setCanvasOffset,
    snapEnabled,
    addImageAsset,
    addLayer,
    updateLayer,
    removeLayer
  } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
      setCanvas: state.setCanvas,
      setSelectedObject: state.setSelectedObject,
      setLayers: state.setLayers,
      saveState: state.saveState,
      setSelectedLayerId: state.setSelectedLayerId,
      themeData: state.themeData,
      bleedPx: state.bleedPx,
      layers: state.layers,
      activeTool: state.activeTool,
      brushColor: state.brushColor,
      brushSize: state.brushSize,
      canvasBackgroundColor: state.canvasBackgroundColor,
      setVpt: state.setVpt,
      setZoom: state.setZoom,
      setCanvasOffset: state.setCanvasOffset,
      snapEnabled: state.snapEnabled,
      addImageAsset: state.addImageAsset,
      addLayer: state.addLayer,
      updateLayer: state.updateLayer,
      removeLayer: state.removeLayer,
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
  const cleanupPromiseRef = useRef<Promise<void> | null>(null);
  const activeToolRef = useRef(activeTool);
  const canvasOffsetRef = useRef({ x: 0, y: 0 });
  const snapEnabledRef = useRef(snapEnabled);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    snapEnabledRef.current = snapEnabled;
  }, [snapEnabled]);

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

  const waitForCanvasContext = async (canvas: fabric.Canvas) => {
    const canvasAny = canvas as any;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const lowerReady = Boolean(canvas.lowerCanvasEl?.getContext?.('2d'));
      const upperReady = Boolean(canvasAny.upperCanvasEl?.getContext?.('2d'));
      if (lowerReady && upperReady) return true;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return false;
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

      setCanvas(canvas);
      syncCanvasOffset();
      syncViewportState(canvas);

    const formatLayerName = (obj: fabric.Object) => {
      const name = (obj as any).name;
      if (name) return name;
      const type = obj.type || 'object';
      return type.replace(/-/g, ' ').split(' ').map((part) =>
        part.charAt(0).toUpperCase() + part.slice(1)
      ).join(' ');
    };

    const getLayerFromObject = (obj: fabric.Object) => {
      if ((obj as any).isGuide) return null;
      const id = (obj as any).id as string | undefined;
      if (!id) return null;
      return {
        id,
        name: formatLayerName(obj),
        type: obj.type || 'object',
        visible: obj.visible ?? true,
        movementLocked: !!obj.lockMovementX,
        colorLocked: !!(obj as any).colorLocked,
      };
    };

    const handleObjectEvent = (event?: CanvasObjectEvent) => {
      const target = event?.target as fabric.Object | undefined;
      if (!target || (target as any).isGuide) {
        return;
      }
      const update = getLayerFromObject(target);
      if (update) {
        updateLayer(update.id, {
          name: update.name,
          type: update.type,
          visible: update.visible,
          movementLocked: update.movementLocked,
          colorLocked: update.colorLocked,
        });
      }
      saveState();
    };

    const handleObjectRemoved = (event?: CanvasObjectEvent) => {
      const target = event?.target as fabric.Object | undefined;
      if (target && !(target as any).isGuide) {
        const id = (target as any).id as string | undefined;
        if (id) {
          removeLayer(id);
        }
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
      saveState();
    };

    const handleObjectMoving = (event: any) => {
      if (!snapEnabledRef.current) return;
      const target = event?.target as fabric.Object | undefined;
      if (!target || (target as any).isGuide) return;
      const gridSize = 10;
      const left = target.left ?? 0;
      const top = target.top ?? 0;
      const snappedLeft = Math.round(left / gridSize) * gridSize;
      const snappedTop = Math.round(top / gridSize) * gridSize;
      target.set({ left: snappedLeft, top: snappedTop });
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
      const layer = getLayerFromObject(target);
      if (layer) {
        addLayer(layer);
      }
      saveState();
    };

    const savedDesign = localStorage.getItem(AUTOSAVE_STORAGE_KEY);
    const loadSavedDesign = async () => {
      if (!savedDesign) {
        drawPersistentGuides(canvas, useEditorStore.getState().themeData, useEditorStore.getState().bleedPx);
        setLayers(canvas.getObjects());
        return;
      }
      try {
        const ready = await waitForCanvasContext(canvas);
        if (!ready || isEffectCancelled) return;
        const parsedDesign = JSON.parse(savedDesign);
        const hydratedDesign = hydrateCanvasDataWithAssets(
          parsedDesign,
          useEditorStore.getState().imageAssets
        );
        await trackPromise(canvas.loadFromJSON(hydratedDesign, reviveCustomFabricProps));
        if (isEffectCancelled) return;
        sanityCheckCanvas(canvas, useEditorStore.getState().themeData);
        drawPersistentGuides(
          canvas,
          useEditorStore.getState().themeData,
          useEditorStore.getState().bleedPx
        );
        canvas.requestRenderAll();
        setLayers(canvas.getObjects());
      } catch (error) {
        if (isEffectCancelled) return;
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        if (message.includes('aborted')) return;
      }
    };

    void loadSavedDesign();

    const cleanupSmartGuides = initSmartGuides(canvas);

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
    canvas.on('object:moving', handleObjectMoving);
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
      if (activeObject && activeObject.type !== 'activeSelection') {
        setSelectedLayerId((activeObject as any).id);
      } else {
        setSelectedLayerId(null);
      }
    };

    const handleSelectionCleared = () => {
      setSelectedObject(null);
      setSelectedLayerId(null);
    };

    canvas.on('selection:created', handleSelection);
    canvas.on('selection:updated', handleSelection);
    canvas.on('selection:cleared', handleSelectionCleared);

    const handleResize = () => {
      const { width, height } = container.getBoundingClientRect();
      canvas.setDimensions({ width, height });
      drawPersistentGuides(canvas, useEditorStore.getState().themeData, useEditorStore.getState().bleedPx);
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
      clearPersistentGuides(canvas);
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
      canvas.off('object:added', handleObjectAdded);
      canvas.off('object:removed', handleObjectRemoved);
      canvas.off('object:modified', handleObjectEvent);
      canvas.off('object:scaling', handleObjectScaling);
      canvas.off('object:moving', handleObjectMoving);
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
    drawPersistentGuides(fabricCanvas, themeData, bleedPx);
    fabricCanvas.requestRenderAll();
  }, [fabricCanvas, themeData, bleedPx, uiVars, canvasBackgroundColor]);

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

  useEffect(() => {
    if (!fabricCanvas) return;
    const handleAutoSave = (event?: CanvasObjectEvent) => {
      if (event?.target && (event.target as any).isGuide) return;
      try {
        localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(fabricCanvas.toJSON()));
      } catch {
        // ignore storage failures
      }
    };

    fabricCanvas.on('object:added', handleAutoSave);
    fabricCanvas.on('object:modified', handleAutoSave);

    return () => {
      fabricCanvas.off('object:added', handleAutoSave);
      fabricCanvas.off('object:modified', handleAutoSave);
    };
  }, [fabricCanvas]);

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

  const isCanvasEmpty = layers.length === 0;

  const handleHearthUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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
    objectFactories.addRectangle(fabricCanvas);
    sanityCheckCanvas(fabricCanvas, useEditorStore.getState().themeData);
    saveState();
  };

  return (
    <div className="workspace relative w-full h-full bg-[color:var(--ui-bg)] flex items-center justify-center">
      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragLeave={handleDragLeave}
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas ref={canvasRef} className="bg-white shadow-[0_25px_70px_rgba(0,0,0,0.45)] rounded-[18px]" />
      </div>
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/png, image/jpeg"
        onChange={handleHearthUpload}
        className="hidden"
      />
      {isCanvasEmpty && (
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
                onClick={() => uploadInputRef.current?.click()}
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
