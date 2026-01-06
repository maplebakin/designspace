
import React, { useRef, useEffect } from 'react';
import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import { sanityCheckCanvas, useEditorStore } from '../state/editorStore';
import { initSmartGuides } from '../fabric/smartGuides';
import { updateGuides } from '../fabric/canvasUtils';
import { initFabricSerialization, reviveCustomFabricProps } from '../fabric/initFabricCanvas';

initFabricSerialization();

export const CanvasStage: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { 
    canvas: fabricCanvas, 
    setCanvas, 
    setSelectedObject, 
    setLayers, 
    saveState, 
    setSelectedLayerId, 
    showGuides 
  } = useEditorStore();

  const isSpacebarDownRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastPosXRef = useRef(0);
  const lastPosYRef = useRef(0);
  const placeholderHighlightRef = useRef<{
    obj: fabric.Object;
    shadow: fabric.Shadow | null;
  } | null>(null);

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

    const handleCanvasUpdate = () => {
        setLayers(canvas.getObjects());
        saveState();
      };

    const handleObjectEvent = () => {
      handleCanvasUpdate();
    };

    const savedDesign = localStorage.getItem('witchclick_current_design');
    if (savedDesign) {
      canvas.loadFromJSON(JSON.parse(savedDesign), reviveCustomFabricProps).then(() => {
        sanityCheckCanvas(canvas, useEditorStore.getState().themeData);
        canvas.requestRenderAll();
        handleCanvasUpdate();
      });
    } else {
      handleCanvasUpdate();
    }

    const cleanupSmartGuides = initSmartGuides(canvas);

    canvas.on('object:added', handleObjectEvent);
    canvas.on('object:removed', handleObjectEvent);
    canvas.on('object:modified', handleObjectEvent);

    // Pan with spacebar
    const onMouseDown = (opt: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
      const e = opt.e as MouseEvent;
      if (isSpacebarDownRef.current && e.button === 0) {
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
          canvas.requestRenderAll();
          lastPosXRef.current = e.clientX;
          lastPosYRef.current = e.clientY;
        }
      }
    };

    const onMouseUp = () => {
        isPanningRef.current = false;
        canvas.setCursor(isSpacebarDownRef.current ? 'grab' : 'default');
    };

    canvas.on('mouse:down', onMouseDown);
    canvas.on('mouse:move', onMouseMove);
    canvas.on('mouse:up', onMouseUp);

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'Space' && !isSpacebarDownRef.current) {
            e.preventDefault();
            isSpacebarDownRef.current = true;
            canvas.setCursor('grab');
            canvas.selection = false;
            canvas.requestRenderAll();
        }
    };

    const handleGlobalKeyUp = (e: KeyboardEvent) => {
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
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      cleanupSmartGuides();
      window.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('keyup', handleGlobalKeyUp);
      resizeObserver.unobserve(container);
      canvas.dispose();
      setCanvas(null);
    };
  }, []);

  useEffect(() => {
    if (!fabricCanvas) return;
    updateGuides(fabricCanvas, showGuides);
  }, [fabricCanvas, showGuides]);

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
    
    fabric.Image.fromURL(imageUrl, { crossOrigin: 'anonymous' }).then((img: fabric.FabricImage) => {
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
        fabricCanvas.requestRenderAll();
        setLayers(fabricCanvas.getObjects());
        saveState();
    });
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={handleDragLeave}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} />
    </div>
  );
};
