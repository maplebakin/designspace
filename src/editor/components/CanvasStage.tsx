
import React, { useRef, useEffect } from 'react';
import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import { LayoutTemplate, Square, Upload } from 'lucide-react';
import { sanityCheckCanvas, useEditorStore } from '../state/editorStore';
import { initSmartGuides } from '../fabric/smartGuides';
import { ensureObjectId, initFabricSerialization, reviveCustomFabricProps, drawPersistentGuides } from '../fabric/initFabricCanvas';
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
    setCanvasOffset
  } = useEditorStore();
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
  const activeToolRef = useRef(activeTool);
  const canvasOffsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

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
    const vpt = canvas.viewportTransform;
    if (vpt) {
      setVpt([...vpt]);
    }
  };

  const syncCanvasOffset = () => {
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

    const handleCanvasUpdate = () => {
        setLayers(canvas.getObjects());
        saveState();
      };

    const handleObjectEvent = (event?: CanvasObjectEvent) => {
      if (event?.target && (event.target as any).isGuide) {
        return;
      }
      handleCanvasUpdate();
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
      handleCanvasUpdate();
    };

    const savedDesign = localStorage.getItem(AUTOSAVE_STORAGE_KEY);
    const loadSavedDesign = async () => {
      if (!savedDesign) {
        drawPersistentGuides(canvas, useEditorStore.getState().themeData, useEditorStore.getState().bleedPx);
        handleCanvasUpdate();
        return;
      }
      try {
        const ready = await waitForCanvasContext(canvas);
        if (!ready || isEffectCancelled) return;
        await trackPromise(canvas.loadFromJSON(JSON.parse(savedDesign), reviveCustomFabricProps));
        if (isEffectCancelled) return;
        sanityCheckCanvas(canvas, useEditorStore.getState().themeData);
        drawPersistentGuides(
          canvas,
          useEditorStore.getState().themeData,
          useEditorStore.getState().bleedPx
        );
        canvas.requestRenderAll();
        handleCanvasUpdate();
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

    canvas.on('object:added', handleObjectAdded);
    canvas.on('object:removed', handleObjectEvent);
    canvas.on('object:modified', handleObjectEvent);
    canvas.on('object:scaling', handleObjectScaling);
    canvas.on('after:render', handleAfterRender);

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

    return () => {
      isCancelledRef.current = true;
      isEffectCancelled = true;
      const pendingPromises = Array.from(pendingPromisesRef.current);
      pendingPromises.forEach((promise) => {
        promise.catch((error) => {
          const message = error instanceof Error ? error.message.toLowerCase() : '';
          if (message.includes('aborted')) return;
        });
      });
      cleanupSmartGuides();
      window.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('keyup', handleGlobalKeyUp);
      resizeObserver.unobserve(container);
      canvas.off('object:scaling', handleObjectScaling);
      canvas.off('after:render', handleAfterRender);

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

      if (pendingPromises.length > 0) {
        Promise.allSettled(pendingPromises).finally(() => {
          pendingPromisesRef.current.clear();
          disposeCanvas();
        });
      } else {
        disposeCanvas();
      }

      setCanvas(null);
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

    if (!imageUrl || !fabricCanvas) return;
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
        setLayers(fabricCanvas.getObjects());
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
      const reader = new FileReader();
      reader.onload = (f: ProgressEvent<FileReader>) => {
        const data = f.target?.result as string;
        trackPromise(fabric.Image.fromURL(data as string, { crossOrigin: 'anonymous' }))
          .then((img: fabric.FabricImage) => {
            if (isCancelledRef.current) return;
            fabricCanvas.add(img);
            fabricCanvas.centerObject(img);
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
      reader.readAsDataURL(file);
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
