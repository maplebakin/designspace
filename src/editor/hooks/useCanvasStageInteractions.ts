import { useCallback, useEffect, useRef } from 'react';
import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import { loadImageFromFile, safeLoadImage } from '../services/assetLoader';
import { isActiveSelection } from '../utils/typeGuards';

type CanvasMutationOptions = { persist?: boolean; activate?: boolean };

type UseCanvasStageInteractionsArgs = {
  fabricCanvas: fabric.Canvas | null;
  addImageAsset: (id: string, url: string) => void;
  addObjectToCanvas: (
    canvas: fabric.Canvas,
    obj: fabric.Object,
    options?: CanvasMutationOptions
  ) => void;
  scheduleUpdate: (
    canvas?: fabric.Canvas | null,
    options?: CanvasMutationOptions
  ) => void;
  setShowOnboarding: (show: boolean) => void;
  trackPromise: <T>(promise: Promise<T>, abortSignal?: AbortSignal) => Promise<T>;
};

const getCanvasPointer = (canvas: fabric.Canvas, event: MouseEvent) => {
  const nextCanvas = canvas as any;
  if (typeof nextCanvas.getScenePoint === 'function') {
    return nextCanvas.getScenePoint(event);
  }
  if (typeof nextCanvas.getPointer === 'function') {
    return nextCanvas.getPointer(event);
  }
  return new fabric.Point(0, 0);
};

const buildRegularPolygonPoints = (sides: number, radius: number) => {
  const points = [];
  const step = (Math.PI * 2) / sides;
  const startAngle = -Math.PI / 2;
  for (let index = 0; index < sides; index += 1) {
    const angle = startAngle + step * index;
    points.push({
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    });
  }
  return points;
};

const buildStarPoints = (points: number, outerRadius: number, innerRadius: number) => {
  const result = [];
  const totalPoints = points * 2;
  const step = (Math.PI * 2) / totalPoints;
  const startAngle = -Math.PI / 2;
  for (let index = 0; index < totalPoints; index += 1) {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = startAngle + step * index;
    result.push({
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    });
  }
  return result;
};

const resolveFrameType = (placeholder: fabric.Object) => {
  const rawType = (placeholder as any).frameType;
  if (rawType === 'circle' || rawType === 'star' || rawType === 'hexagon' || rawType === 'badge') {
    return rawType;
  }
  if (placeholder.type === 'circle') return 'circle';
  if (placeholder.type === 'polygon') {
    const points = (placeholder as fabric.Polygon).points ?? [];
    if (points.length === 6) return 'hexagon';
    if (points.length === 10) return 'star';
    if (points.length >= 12) return 'badge';
  }
  return null;
};

const createFrameClipPath = (
  frameType: ReturnType<typeof resolveFrameType>,
  clipWidth: number,
  clipHeight: number,
  angle: number
) => {
  const radius = Math.min(clipWidth, clipHeight) / 2;
  if (frameType === 'circle') {
    return new fabric.Circle({
      radius,
      left: 0,
      top: 0,
      originX: 'center',
      originY: 'center',
      angle,
    });
  }
  if (frameType === 'hexagon') {
    return new fabric.Polygon(buildRegularPolygonPoints(6, radius), {
      left: 0,
      top: 0,
      originX: 'center',
      originY: 'center',
      angle,
    });
  }
  if (frameType === 'star') {
    return new fabric.Polygon(buildStarPoints(5, radius, radius * 0.5), {
      left: 0,
      top: 0,
      originX: 'center',
      originY: 'center',
      angle,
    });
  }
  if (frameType === 'badge') {
    return new fabric.Polygon(buildStarPoints(12, radius, radius * 0.82), {
      left: 0,
      top: 0,
      originX: 'center',
      originY: 'center',
      angle,
    });
  }
  return new fabric.Rect({
    width: clipWidth,
    height: clipHeight,
    left: 0,
    top: 0,
    originX: 'center',
    originY: 'center',
    angle,
  });
};

export const useCanvasStageInteractions = ({
  fabricCanvas,
  addImageAsset,
  addObjectToCanvas,
  scheduleUpdate,
  setShowOnboarding,
  trackPromise,
}: UseCanvasStageInteractionsArgs) => {
  const placeholderHighlightRef = useRef<{
    obj: fabric.Object;
    shadow: fabric.Shadow | null;
  } | null>(null);
  const frameHighlightRef = useRef<{
    obj: fabric.Object;
    originalFill: string | fabric.Pattern | fabric.Gradient<'linear'> | fabric.Gradient<'radial'> | null;
    originalOpacity: number;
  } | null>(null);

  const clearPlaceholderHighlight = useCallback(() => {
    const current = placeholderHighlightRef.current;
    if (!current || !fabricCanvas) return;
    current.obj.set('shadow', current.shadow || undefined);
    placeholderHighlightRef.current = null;
    fabricCanvas.requestRenderAll();
  }, [fabricCanvas]);

  const setPlaceholderHighlight = useCallback((placeholder: fabric.Object | null) => {
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
  }, [clearPlaceholderHighlight, fabricCanvas]);

  const clearFrameHighlight = useCallback(() => {
    const current = frameHighlightRef.current;
    if (!current || !fabricCanvas) return;
    current.obj.set({
      fill: current.originalFill,
      opacity: current.originalOpacity,
    });
    frameHighlightRef.current = null;
    fabricCanvas.requestRenderAll();
  }, [fabricCanvas]);

  const setFrameHighlight = useCallback((frame: fabric.Object | null) => {
    if (!fabricCanvas) return;
    if (frameHighlightRef.current?.obj === frame) return;
    clearFrameHighlight();
    if (!frame) return;

    const originalFill = frame.fill;
    const originalOpacity = frame.opacity ?? 1;
    frame.set({
      fill: 'rgba(128, 0, 128, 0.5)',
      opacity: 0.8,
    });

    frameHighlightRef.current = { obj: frame, originalFill, originalOpacity };
    if (frame.group) {
      (frame.group as any).dirty = true;
    }
    fabricCanvas.requestRenderAll();
  }, [clearFrameHighlight, fabricCanvas]);

  const findPlaceholderAtPointer = useCallback((pointer: fabric.Point) => {
    if (!fabricCanvas) return null;
    const objects = fabricCanvas.getObjects().slice().reverse();

    const findInObject = (obj: fabric.Object): fabric.Object | null => {
      if ((obj as any).isPlaceholder && obj.containsPoint(pointer)) {
        return obj;
      }
      if (obj.type === 'group' || isActiveSelection(obj)) {
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
  }, [fabricCanvas]);

  const findFrameAtPointer = useCallback((pointer: fabric.Point) => {
    if (!fabricCanvas) return null;
    const objects = fabricCanvas.getObjects().slice().reverse();

    const findInObject = (obj: fabric.Object): fabric.Object | null => {
      if ((obj as any).isFrame && obj.containsPoint(pointer)) {
        return obj;
      }
      if (obj.type === 'group' || isActiveSelection(obj)) {
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
  }, [fabricCanvas]);

  const replacePlaceholderWithImage = useCallback((
    canvas: fabric.Canvas,
    placeholder: fabric.Object,
    img: fabric.FabricImage,
    options?: CanvasMutationOptions
  ) => {
    const center = placeholder.getCenterPoint();
    const angle = placeholder.angle || 0;
    const bounds = placeholder.getBoundingRect();
    const boxWidth = bounds.width;
    const boxHeight = bounds.height;
    const group = placeholder.group as fabric.Group | undefined;
    const groupScaleX = group?.scaleX ?? 1;
    const groupScaleY = group?.scaleY ?? 1;
    const imgWidth = img.width || 1;
    const imgHeight = img.height || 1;
    const scaleX = boxWidth / imgWidth;
    const scaleY = boxHeight / imgHeight;
    const scale = Math.max(scaleX, scaleY);
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

    const frameType = resolveFrameType(placeholder);
    img.clipPath = createFrameClipPath(frameType, clipWidth, clipHeight, angle);

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
      addObjectToCanvas(canvas, img, options);
      if (placeholderIndex >= 0) {
        canvas.moveObjectTo(img, placeholderIndex);
      }
    }
    scheduleUpdate(canvas, options);
  }, [addObjectToCanvas, scheduleUpdate]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!fabricCanvas) return;
    const imageUrl = event.dataTransfer.getData('text/plain');
    if (!imageUrl) {
      clearPlaceholderHighlight();
      clearFrameHighlight();
      return;
    }
    const pointer = getCanvasPointer(fabricCanvas, event.nativeEvent as MouseEvent);
    const placeholder = findPlaceholderAtPointer(pointer);
    const frameAtPointer = findFrameAtPointer(pointer);

    if (frameAtPointer) {
      setFrameHighlight(frameAtPointer);
      clearPlaceholderHighlight();
      return;
    }

    setPlaceholderHighlight(placeholder);
    clearFrameHighlight();
  }, [
    clearFrameHighlight,
    clearPlaceholderHighlight,
    fabricCanvas,
    findFrameAtPointer,
    findPlaceholderAtPointer,
    setFrameHighlight,
    setPlaceholderHighlight,
  ]);

  const handleDragLeave = useCallback(() => {
    clearPlaceholderHighlight();
    clearFrameHighlight();
  }, [clearFrameHighlight, clearPlaceholderHighlight]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setShowOnboarding(false);
    const imageUrl = event.dataTransfer.getData('text/plain');
    const isSticker = event.dataTransfer.getData('isSticker') === 'true';

    if (!fabricCanvas) return;

    if (!imageUrl) {
      const file = event.dataTransfer.files?.[0];
      if (!file) {
        clearPlaceholderHighlight();
        clearFrameHighlight();
        return;
      }
      clearPlaceholderHighlight();
      clearFrameHighlight();
      const pointer = getCanvasPointer(fabricCanvas, event.nativeEvent as MouseEvent);

      trackPromise(loadImageFromFile(file))
        .then((result) => {
          if (!result.success) {
            console.error('Failed to load dropped image:', result.errorMessage);
            return;
          }

          const id = result.id;
          result.asset.set({
            id,
            src: result.blobUrl,
            left: pointer.x,
            top: pointer.y,
            originX: 'center',
            originY: 'center',
          });
          addImageAsset(id, result.blobUrl!);
          addObjectToCanvas(fabricCanvas, result.asset, { persist: true });
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message.toLowerCase() : '';
          if (!message.includes('aborted')) {
            console.error('Error loading dropped image:', error);
          }
        });
      return;
    }

    clearPlaceholderHighlight();
    clearFrameHighlight();

    const pointer = getCanvasPointer(fabricCanvas, event.nativeEvent as MouseEvent);
    const placeholder = findPlaceholderAtPointer(pointer);
    const targetObject = fabricCanvas.getObjects().find((obj) =>
      obj.containsPoint(pointer) && obj.type === 'image'
    ) as fabric.Image;

    trackPromise(safeLoadImage(imageUrl, { crossOrigin: 'anonymous' }))
      .then((result) => {
        if (!result.success) {
          const message = result.errorMessage.toLowerCase();
          if (!message.includes('aborted')) {
            console.error('Failed to load image:', result.errorMessage);
          }
          return;
        }

        const img = result.asset;

        if (placeholder) {
          replacePlaceholderWithImage(fabricCanvas, placeholder, img, { persist: true });
        } else if (targetObject) {
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
          addObjectToCanvas(fabricCanvas, img, { persist: true });
        } else {
          const maxWidth = isSticker ? 150 : 200;
          if (img.width && img.width > maxWidth) {
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
          addObjectToCanvas(fabricCanvas, img, { persist: true });
        }
        scheduleUpdate(fabricCanvas, { persist: true });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        if (message.includes('aborted')) return;
        console.error('Error loading image:', error);
      });
  }, [
    addImageAsset,
    addObjectToCanvas,
    clearFrameHighlight,
    clearPlaceholderHighlight,
    fabricCanvas,
    findPlaceholderAtPointer,
    replacePlaceholderWithImage,
    scheduleUpdate,
    setShowOnboarding,
    trackPromise,
  ]);

  const handleImageUpload = useCallback(async (file?: File | null) => {
    setShowOnboarding(false);
    if (!file || !fabricCanvas) return;

    const result = await loadImageFromFile(file);
    if (!result.success) {
      console.error('Failed to load image:', result.errorMessage);
      return;
    }

    const id = result.id;
    result.asset.set({ id, src: result.blobUrl });
    addImageAsset(id, result.blobUrl!);
    addObjectToCanvas(fabricCanvas, result.asset, { persist: true });
    fabricCanvas.centerObject(result.asset);
    scheduleUpdate(fabricCanvas, { persist: true });
    window.requestAnimationFrame(() => document.getElementById('editor-shell')?.focus());
  }, [addImageAsset, addObjectToCanvas, fabricCanvas, scheduleUpdate, setShowOnboarding]);

  useEffect(() => () => {
    clearPlaceholderHighlight();
    clearFrameHighlight();
  }, [clearFrameHighlight, clearPlaceholderHighlight]);

  return {
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleImageUpload,
  };
};
