import * as fabric from 'fabric';
import { useCanvasStore } from '../state/useCanvasStore';

interface RenderToPngOptions {
  scale?: number;
  includeBackground?: boolean;
  backgroundColor?: string | null;
}

const getClonedViewportTransform = (canvas: fabric.Canvas): fabric.TMat2D => {
  const fallback: fabric.TMat2D = [1, 0, 0, 1, 0, 0];
  return canvas.viewportTransform
    ? ([...canvas.viewportTransform] as fabric.TMat2D)
    : fallback;
};

const getExportExcludedObjects = (canvas: fabric.Canvas) =>
  canvas.getObjects().filter((object) =>
    (object as any).excludeFromExport || (object as any).isGuide || (object as any).isSmartGuide
  );

export const renderCanvasToPngBlob = async (
  canvas: fabric.Canvas,
  options: RenderToPngOptions
) => {
  const scale = options.scale ?? 2;
  const { width, height } = useCanvasStore.getState();
  const originalZoom = canvas.getZoom();
  const originalVpt = getClonedViewportTransform(canvas);
  const originalBackgroundColor = canvas.backgroundColor;
  const nextBackgroundColor = options.includeBackground
    ? options.backgroundColor ?? originalBackgroundColor
    : '';
  const hiddenObjects = getExportExcludedObjects(canvas).map((object) => ({
    object,
    visible: object.visible,
  }));

  canvas.setZoom(1);
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  canvas.backgroundColor = nextBackgroundColor;
  hiddenObjects.forEach(({ object }) => object.set('visible', false));
  canvas.renderAll();

  try {
    const dataUrl = canvas.toDataURL({
      format: 'png',
      multiplier: scale,
      left: 0,
      top: 0,
      width,
      height,
      quality: 1,
    });
    const response = await fetch(dataUrl);
    return await response.blob();
  } finally {
    hiddenObjects.forEach(({ object, visible }) => object.set('visible', visible));
    canvas.setZoom(originalZoom);
    canvas.setViewportTransform(originalVpt);
    canvas.backgroundColor = originalBackgroundColor;
    canvas.renderAll();
  }
};
