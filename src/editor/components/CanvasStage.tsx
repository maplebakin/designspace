import React, { useRef, useEffect, useState } from 'react';
import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import { useEditorStore } from '../state/editorStore';
import { initSmartGuides } from '../fabric/smartGuides';
import { updateGuides } from '../fabric/canvasUtils';

export const CanvasStage: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { canvas: fabricCanvas, setCanvas, setSelectedObject, setHoveredObject, setLayers, saveState, setZoom, setVpt, unitMode, bleedPx, setResetViewCanvas, isPreviewMode, togglePreviewMode, setSelectedLayerId, showGuides } = useEditorStore();
  const [bleedTooltip, setBleedTooltip] = useState({ visible: false, left: 0, top: 0 });

  const isSpacebarDownRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastPosXRef = useRef(0);
  const lastPosYRef = useRef(0);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const { width, height } = container.getBoundingClientRect();

    const canvas = new fabric.Canvas(canvasRef.current, {
      width,
      height,
      backgroundColor: '#f8fafc',
      selection: true,
      controlsAboveOverlay: true,
      stopContextMenu: true,
    });

    setCanvas(canvas);

    const applyBleedSnap = (object?: fabric.Object | null) => {
      if (!canvas || unitMode !== 'in' || !object || object.get('isGuide')) return;
      if (bleedPx <= 0) return;

      const canvasWidth = canvas.getWidth();
      const canvasHeight = canvas.getHeight();
      const bbox = object.getBoundingRect();
      const coverageThreshold = 0.8;

      if (bbox.width < canvasWidth * coverageThreshold || bbox.height < canvasHeight * coverageThreshold) {
        return;
      }

      const nearLeft = bbox.left <= bleedPx;
      const nearRight = canvasWidth - (bbox.left + bbox.width) <= bleedPx;
      const nearTop = bbox.top <= bleedPx;
      const nearBottom = canvasHeight - (bbox.top + bbox.height) <= bleedPx;

      if (!(nearLeft || nearRight || nearTop || nearBottom)) {
        return;
      }

      const baseWidth = object.width || object.getScaledWidth() || 1;
      const baseHeight = object.height || object.getScaledHeight() || 1;
      const widthScale = (canvasWidth + bleedPx * 2) / baseWidth;
      const heightScale = (canvasHeight + bleedPx * 2) / baseHeight;
      const targetScale = Math.max(widthScale, heightScale);

      object.set({
        left: -bleedPx,
        top: -bleedPx,
        originX: 'left',
        originY: 'top',
        scaleX: targetScale,
        scaleY: targetScale,
      });
      object.setCoords();
      canvas.requestRenderAll();
      useEditorStore.getState().saveState();
    };

    const centerAndZoomToFit = () => {
      if (!canvas || !containerRef.current) return;

      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight;
      const canvasWidth = canvas.getWidth();
      const canvasHeight = canvas.getHeight();

      const padding = 50;
      const zoomX = (containerWidth - padding) / canvasWidth;
      const zoomY = (containerHeight - padding) / canvasHeight;
      let zoom = Math.min(zoomX, zoomY, 1);

      if (zoom <= 0) {
        zoom = 0.1;
      }

      canvas.setZoom(zoom);

      const vpt = canvas.viewportTransform;
      if (vpt) {
        vpt[4] = (containerWidth - canvasWidth * zoom) / 2;
        vpt[5] = (containerHeight - canvasHeight * zoom) / 2;
        canvas.setViewportTransform(vpt);
      }
      canvas.requestRenderAll();
      setZoom(zoom);
      if (canvas.viewportTransform) setVpt(canvas.viewportTransform);
    };

    const handleCanvasUpdate = (object?: fabric.Object) => {
        if (object) applyBleedSnap(object);
        setLayers(canvas.getObjects());
        saveState();
      };

    const handleObjectEvent = (event: any) => {
      handleCanvasUpdate((event?.target as fabric.Object | undefined) ?? undefined);
    };

    const savedDesign = localStorage.getItem('witchclick_current_design');
    if (savedDesign) {
      canvas.loadFromJSON(JSON.parse(savedDesign), () => {
        canvas.requestRenderAll();
        handleCanvasUpdate();
        centerAndZoomToFit();
        if (setResetViewCanvas) setResetViewCanvas(() => centerAndZoomToFit);
      });
    } else {
      handleCanvasUpdate();
      centerAndZoomToFit();
      if (setResetViewCanvas) setResetViewCanvas(() => centerAndZoomToFit);
    }

    const cleanupSmartGuides = initSmartGuides(canvas);

    canvas.on('object:added', handleObjectEvent);
    canvas.on('object:removed', handleObjectEvent);
    canvas.on('object:modified', handleObjectEvent);

    canvas.on('mouse:wheel', (opt: fabric.TEvent<WheelEvent>) => {
      const delta = opt.e.deltaY;
      let zoom = canvas.getZoom();
      const zoomFactor = Math.pow(1.001, -delta);
      zoom *= zoomFactor;

      if (zoom > 20) zoom = 20;
      if (zoom < 0.05) zoom = 0.05;

      canvas.zoomToPoint(new fabric.Point(opt.e.offsetX, opt.e.offsetY), zoom);
      opt.e.preventDefault();
      opt.e.stopPropagation();
      setZoom(zoom);
      if (canvas.viewportTransform) setVpt(canvas.viewportTransform);
    });

    const onMouseDown = (opt: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
      const e = opt.e as MouseEvent;
      if (e.button === 1 || e.altKey === true || e.button === 2 || (isSpacebarDownRef.current && e.button === 0)) {
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
        const vpt = canvas.viewportTransform;
        if (vpt) {
          vpt[4] += e.clientX - lastPosXRef.current;
          vpt[5] += e.clientY - lastPosYRef.current;

          if (!containerRef.current) return;
          const containerWidth = containerRef.current.clientWidth || 0;
          const containerHeight = containerRef.current.clientHeight || 0;
          const canvasWidth = canvas.getWidth();
          const canvasHeight = canvas.getHeight();
          const zoom = canvas.getZoom();

          const minVisiblePercent = 0.1;
          const scaledCanvasWidth = canvasWidth * zoom;
          const scaledCanvasHeight = canvasHeight * zoom;

          const minPanX = containerWidth - scaledCanvasWidth * (1 - minVisiblePercent);
          const maxPanX = scaledCanvasWidth * minVisiblePercent;
          const minPanY = containerHeight - scaledCanvasHeight * (1 - minVisiblePercent);
          const maxPanY = scaledCanvasHeight * minVisiblePercent;

          vpt[4] = Math.max(minPanX, Math.min(vpt[4], maxPanX));
          vpt[5] = Math.max(minPanY, Math.min(vpt[5], maxPanY));

          canvas.setViewportTransform(vpt);
          canvas.requestRenderAll();
          setVpt(vpt);
          lastPosXRef.current = e.clientX;
          lastPosYRef.current = e.clientY;
        }
      } else if (isSpacebarDownRef.current) {
        canvas.setCursor('grab');
      }
    };

    const onMouseUp = () => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        canvas.setCursor(isSpacebarDownRef.current ? 'grab' : 'default');
      }
    };

    canvas.on('mouse:down', onMouseDown);
    canvas.on('mouse:move', onMouseMove);
    canvas.on('mouse:up', onMouseUp);

    let clipboard: fabric.FabricObject | null = null;

    const copy = async () => {
      const activeObject = canvas.getActiveObject();
      if (activeObject) {
        clipboard = await activeObject.clone();
      }
    };

    const paste = async () => {
      if (!clipboard) return;
      const clonedObj = await clipboard.clone();
      canvas.discardActiveObject();
      clonedObj.set({
        left: (clonedObj.left ?? 0) + 10,
        top: (clonedObj.top ?? 0) + 10,
        evented: true,
      });
      if (clonedObj.type === 'activeSelection') {
        const activeSelection = clonedObj as fabric.ActiveSelection;
        activeSelection.canvas = canvas;
        activeSelection.forEachObject((obj: fabric.FabricObject) => {
          canvas.add(obj);
        });
        activeSelection.setCoords();
      } else {
        canvas.add(clonedObj);
      }
      if (clipboard) {
        clipboard.top = (clipboard.top ?? 0) + 10;
        clipboard.left = (clipboard.left ?? 0) + 10;
      }
      canvas.setActiveObject(clonedObj);
      canvas.requestRenderAll();
      saveState();
    };

    const deleteSelected = () => {
      const activeObjects = canvas.getActiveObjects();
      if (activeObjects.length > 0) {
        activeObjects.forEach((object: fabric.Object) => {
          canvas.remove(object);
        });
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        saveState();
      }
    };

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isInputFocused = activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement;

      if (isInputFocused) return;

      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'z') {
            e.preventDefault();
            useEditorStore.getState().undo();
        } else if (e.key === 'y') {
            e.preventDefault();
            useEditorStore.getState().redo();
        } else if (e.key === 'c') {
            void copy().catch(console.error);
        } else if (e.key === 'v') {
            void paste().catch(console.error);
        }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected();
    } else if (e.code === 'Space' && !isSpacebarDownRef.current) {
        e.preventDefault();
        isSpacebarDownRef.current = true;
        canvas.setCursor('grab');
        canvas.selection = false;
        canvas.requestRenderAll();
    } else if (e.key.toLowerCase() === 'w') {
        e.preventDefault();
        togglePreviewMode();
    }
    };

    const handleGlobalKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && isSpacebarDownRef.current) {
        isSpacebarDownRef.current = false;
        canvas.setCursor('default');
        canvas.selection = true;
        canvas.requestRenderAll();
      }
      if (!isPanningRef.current && !isSpacebarDownRef.current) {
        canvas.setCursor('default');
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
        setSelectedLayerId(null); // No single layer selected for multi-selection
      }
    };

    const handleSelectionCleared = () => {
      setSelectedObject(null);
      setSelectedLayerId(null);
    };

    const handleHover = (event: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
      const target = event.target as fabric.FabricObject | undefined;
      if (target && target.type !== 'activeSelection') {
        setHoveredObject(target);
      }
    };

    const handleHoverOut = () => {
      setHoveredObject(null);
    };

    canvas.on('selection:created', handleSelection);
    canvas.on('selection:updated', handleSelection);
    canvas.on('selection:cleared', handleSelectionCleared);
    canvas.on('mouse:over', handleHover);
    canvas.on('mouse:out', handleHoverOut);

    const handleResize = () => {
      const { width, height } = container.getBoundingClientRect();
      canvas.setDimensions({ width, height });
      canvas.renderAll();
      centerAndZoomToFit();
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      cleanupSmartGuides();
      window.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('keyup', handleGlobalKeyUp);
      resizeObserver.unobserve(container);
      canvas.clear = () => canvas;
      canvas.dispose();
      setSelectedObject(null);
      setCanvas(null);
      if (setResetViewCanvas) setResetViewCanvas(null);
    };
  }, []);

  const handlePointerMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (unitMode !== 'in' || bleedPx <= 0 || !containerRef.current) {
      setBleedTooltip({ visible: false, left: 0, top: 0 });
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const nearEdge =
      x <= bleedPx ||
      x >= rect.width - bleedPx ||
      y <= bleedPx ||
      y >= rect.height - bleedPx;
    if (nearEdge) {
      setBleedTooltip({
        visible: true,
        left: Math.min(Math.max(x + 8, 0), rect.width - 90),
        top: Math.min(Math.max(y + 8, 0), rect.height - 24),
      });
    } else {
      setBleedTooltip({ visible: false, left: 0, top: 0 });
    }
  };

  const handlePointerLeave = () => {
    setBleedTooltip({ visible: false, left: 0, top: 0 });
  };

  useEffect(() => {
    if (!fabricCanvas) return;
    // This effect now controls the visibility of all guides based on the store
    updateGuides(fabricCanvas, showGuides && unitMode === 'in');
  }, [fabricCanvas, showGuides, unitMode, bleedPx]);

  useEffect(() => {
    if (unitMode !== 'in') {
      setBleedTooltip({ visible: false, left: 0, top: 0 });
    }
  }, [unitMode]);

  useEffect(() => {
    if (!fabricCanvas || !containerRef.current) return;

    if (isPreviewMode) {
      fabricCanvas.getObjects().forEach(obj => {
        if (obj.isGuide || obj.isBleedZone || obj.isTrimLine) {
          obj.set({ visible: false });
        }
      });
      const canvasWidth = fabricCanvas.getWidth();
      const canvasHeight = fabricCanvas.getHeight();
      (fabricCanvas as any).clipTo = (ctx: CanvasRenderingContext2D) => {
        ctx.rect(0, 0, canvasWidth, canvasHeight);
      };

      if (containerRef.current) {
        containerRef.current.dataset.originalBg = containerRef.current.style.backgroundColor;
        containerRef.current.classList.remove('bg-[#121212]');
        containerRef.current.classList.add('bg-white');
      }
    } else {
      fabricCanvas.getObjects().forEach(obj => {
        if (obj.isGuide || obj.isBleedZone || obj.isTrimLine) {
          obj.set({ visible: true });
        }
      });
      (fabricCanvas as any).clipTo = null;

      if (containerRef.current) {
        containerRef.current.classList.remove('bg-white');
        containerRef.current.classList.add('bg-[#121212]');
      }
    }
    fabricCanvas.requestRenderAll();
  }, [isPreviewMode, fabricCanvas, containerRef]);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const imageUrl = e.dataTransfer.getData('text/plain');
    const isSticker = e.dataTransfer.getData('isSticker') === 'true';

    if (!imageUrl || !fabricCanvas) return;

    const pointer = fabricCanvas.getPointer(e.nativeEvent as MouseEvent);

    const dropTarget = fabricCanvas.getObjects().find(obj =>
        obj.containsPoint(pointer) && (obj as any).isFrame
    );

    if (dropTarget && !isSticker) {
      fabric.Image.fromURL(imageUrl, { crossOrigin: 'anonymous' }).then((img: fabric.FabricImage) => {
        const pattern = new fabric.Pattern({
          source: img.getElement(),
          repeat: 'no-repeat',
        });
        dropTarget.set({
          fill: pattern,
          stroke: 'transparent',
          strokeDashArray: [],
          patternSourceUrl: imageUrl,
        });
        fabricCanvas.requestRenderAll();
        saveState();
      });
    } else {
      fabric.Image.fromURL(imageUrl, { crossOrigin: 'anonymous' }).then((img: fabric.FabricImage) => {
        const maxWidth = isSticker ? 150 : 200;
        if (img.width! > maxWidth) {
          img.scaleToWidth(maxWidth);
        }
        img.set({
          id: uuidv4(),
          tokenRole: 'brand.accent.value',
          left: pointer.x,
          top: pointer.y,
          originX: 'center',
          originY: 'center',
        });
        if (isSticker) {
          img.set('shadow', new fabric.Shadow({
            color: 'rgba(0,0,0,0.4)',
            blur: 8,
            offsetX: 4,
            offsetY: 4,
          }));
        }
        fabricCanvas.add(img);
        fabricCanvas.requestRenderAll();
        saveState();
      });
    }
  };

  return (
    <div
      ref={containerRef}
      className={`w-full h-full relative ${isPreviewMode ? 'bg-white' : 'bg-[#121212]'}`}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onMouseMove={handlePointerMove}
      onMouseLeave={handlePointerLeave}
      onContextMenu={(e) => e.preventDefault()}
    >
      {bleedTooltip.visible && (
        <div
          className="pointer-events-none absolute text-[9px] uppercase tracking-widest text-rose-100 bg-[#1f0303]/90 px-2 py-1 rounded-full shadow-[0_0_12px_rgba(248,113,113,0.6)]"
          style={{ left: bleedTooltip.left, top: bleedTooltip.top }}
        >
          Bleed Zone
        </div>
      )}
      <div className={`relative shadow-2xl rounded-lg border border-gray-700 overflow-hidden ${isPreviewMode ? 'border-transparent' : ''}`}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
};

