import * as fabric from 'fabric';
import { isActiveSelection } from './typeGuards';

interface SerializeToSVGOptions {
  width: number;
  height: number;
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

const getCanvasImageObjects = (objects: fabric.Object[]): fabric.Image[] =>
  objects.flatMap((object) => {
    if (object.type === 'group' || isActiveSelection(object)) {
      return getCanvasImageObjects((object as fabric.Group).getObjects());
    }
    return object.type === 'image' ? [object as fabric.Image] : [];
  });

const getImageSrc = (image: fabric.Image) => {
  const anyImage = image as any;
  if (typeof anyImage.getSrc === 'function') {
    const src = anyImage.getSrc();
    return typeof src === 'string' ? src : '';
  }
  const element = anyImage.getElement?.() || anyImage._element;
  return typeof element?.src === 'string' ? element.src : '';
};

const shouldInlineImageSrc = (src: string) =>
  !!src && !src.startsWith('data:') && !/^https?:\/\//i.test(src) && !src.startsWith('//');

const getInlineImageDataUrl = (image: fabric.Image) => {
  const anyImage = image as any;
  if (typeof anyImage.svgDataUrl === 'string' && anyImage.svgDataUrl.startsWith('data:')) {
    return anyImage.svgDataUrl;
  }
  const element = anyImage.getElement?.() || anyImage._element;
  if (!element || typeof document === 'undefined') {
    return '';
  }
  const width = element.naturalWidth || element.width;
  const height = element.naturalHeight || element.height;
  if (!width || !height) {
    return '';
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return '';
    }
    context.drawImage(element, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
};

export const serializeToSVG = (canvas: fabric.Canvas, options: SerializeToSVGOptions) => {
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
  const inlinedImages = getCanvasImageObjects(canvas.getObjects())
    .map((image) => {
      const src = getImageSrc(image);
      if (!shouldInlineImageSrc(src)) {
        return null;
      }
      const dataUrl = getInlineImageDataUrl(image);
      if (!dataUrl) {
        return null;
      }
      const anyImage = image as any;
      const hadOwnGetSrc = Object.prototype.hasOwnProperty.call(anyImage, 'getSrc');
      const originalGetSrc = anyImage.getSrc;
      anyImage.getSrc = () => dataUrl;
      return { image: anyImage, hadOwnGetSrc, originalGetSrc };
    })
    .filter((entry): entry is { image: any; hadOwnGetSrc: boolean; originalGetSrc: any } => !!entry);

  canvas.setZoom(1);
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  canvas.backgroundColor = nextBackgroundColor;
  hiddenObjects.forEach(({ object }) => object.set('visible', false));
  canvas.renderAll();

  try {
    return canvas.toSVG({
      suppressPreamble: false,
      viewBox: {
        x: 0,
        y: 0,
        width: options.width,
        height: options.height,
      },
    });
  } finally {
    inlinedImages.forEach(({ image, hadOwnGetSrc, originalGetSrc }) => {
      if (hadOwnGetSrc) {
        image.getSrc = originalGetSrc;
        return;
      }
      delete image.getSrc;
    });
    hiddenObjects.forEach(({ object, visible }) => object.set('visible', visible));
    canvas.setZoom(originalZoom);
    canvas.setViewportTransform(originalVpt);
    canvas.backgroundColor = originalBackgroundColor;
    canvas.renderAll();
  }
};
