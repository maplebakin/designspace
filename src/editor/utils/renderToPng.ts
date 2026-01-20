import * as fabric from 'fabric';

interface RenderToPngOptions {
  scale?: number;
  includeBackground?: boolean;
  backgroundColor?: string | null;
}

const shouldSkipObject = (object: fabric.Object) =>
  !object.visible || (object as any).isGuide || (object as any).isSmartGuide;

const applyObjectStyles = (
  ctx: CanvasRenderingContext2D,
  object: fabric.Object,
  parentOpacity: number
) => {
  const fill = (object as any).fill;
  const stroke = (object as any).stroke;
  const strokeWidth = (object as any).strokeWidth ?? 0;
  const opacity = typeof object.opacity === 'number' ? object.opacity : 1;

  ctx.globalAlpha = opacity * parentOpacity;
  if (typeof fill === 'string') {
    ctx.fillStyle = fill;
  } else {
    ctx.fillStyle = 'transparent';
  }
  if (typeof stroke === 'string') {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    if ((object as any).strokeDashArray) {
      ctx.setLineDash((object as any).strokeDashArray);
    } else {
      ctx.setLineDash([]);
    }
    if ((object as any).strokeLineCap) {
      ctx.lineCap = (object as any).strokeLineCap;
    }
    if ((object as any).strokeLineJoin) {
      ctx.lineJoin = (object as any).strokeLineJoin;
    }
  } else {
    ctx.lineWidth = 0;
    ctx.setLineDash([]);
  }
};

const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  rx: number,
  ry: number
) => {
  const radiusX = Math.min(rx, width / 2);
  const radiusY = Math.min(ry, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + radiusX, y);
  ctx.lineTo(x + width - radiusX, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radiusY);
  ctx.lineTo(x + width, y + height - radiusY);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radiusX, y + height);
  ctx.lineTo(x + radiusX, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radiusY);
  ctx.lineTo(x, y + radiusY);
  ctx.quadraticCurveTo(x, y, x + radiusX, y);
  ctx.closePath();
};

const drawText = (ctx: CanvasRenderingContext2D, object: fabric.Object) => {
  const text = String((object as any).text ?? '');
  if (!text.trim()) return;
  const lines = text.split(/\r?\n/);
  const fontSize = Number((object as any).fontSize ?? 16);
  const fontFamily = (object as any).fontFamily || 'sans-serif';
  const fontWeight = (object as any).fontWeight || 'normal';
  const fontStyle = (object as any).fontStyle || 'normal';
  const lineHeight = Number((object as any).lineHeight ?? 1.16);
  const textAlign = (object as any).textAlign || 'left';

  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.textAlign = textAlign === 'center' ? 'center' : textAlign === 'right' ? 'right' : 'left';
  ctx.textBaseline = 'top';

  const width = Number(object.width ?? 0);
  const height = Number(object.height ?? lines.length * fontSize);
  const originX = textAlign === 'center' ? 0 : textAlign === 'right' ? width / 2 : -width / 2;
  const originY = -height / 2;

  lines.forEach((line, index) => {
    const y = originY + index * fontSize * lineHeight;
    if ((object as any).stroke && (object as any).strokeWidth) {
      ctx.strokeText(line, originX, y);
    }
    ctx.fillText(line, originX, y);
  });
};

const drawObject = (
  ctx: CanvasRenderingContext2D,
  object: fabric.Object,
  parentOpacity: number
) => {
  if (shouldSkipObject(object)) return;

  if (object.type === 'group' || object.type === 'activeSelection') {
    const group = object as fabric.Group;
    const groupOpacity = typeof group.opacity === 'number' ? group.opacity : 1;
    group.getObjects().forEach((child) => drawObject(ctx, child, parentOpacity * groupOpacity));
    return;
  }

  const matrix = object.calcTransformMatrix() as fabric.TMat2D;
  ctx.save();
  ctx.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
  applyObjectStyles(ctx, object, parentOpacity);

  if (object.type === 'rect') {
    const rect = object as fabric.Rect;
    const width = Number(rect.width ?? 0);
    const height = Number(rect.height ?? 0);
    const rx = Number((rect as any).rx ?? 0);
    const ry = Number((rect as any).ry ?? 0);
    const x = -width / 2;
    const y = -height / 2;
    if (rx || ry) {
      drawRoundedRect(ctx, x, y, width, height, rx, ry);
    } else {
      ctx.beginPath();
      ctx.rect(x, y, width, height);
    }
    if ((object as any).fill) ctx.fill();
    if ((object as any).stroke && (object as any).strokeWidth) ctx.stroke();
  } else if (object.type === 'circle') {
    const circle = object as fabric.Circle;
    const radius = Number(circle.radius ?? 0);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    if ((object as any).fill) ctx.fill();
    if ((object as any).stroke && (object as any).strokeWidth) ctx.stroke();
  } else if (object.type === 'triangle') {
    const triangle = object as fabric.Triangle;
    const width = Number(triangle.width ?? 0);
    const height = Number(triangle.height ?? 0);
    ctx.beginPath();
    ctx.moveTo(0, -height / 2);
    ctx.lineTo(width / 2, height / 2);
    ctx.lineTo(-width / 2, height / 2);
    ctx.closePath();
    if ((object as any).fill) ctx.fill();
    if ((object as any).stroke && (object as any).strokeWidth) ctx.stroke();
  } else if (object.type === 'polygon') {
    const polygon = object as fabric.Polygon;
    const points = (polygon.get('points') || []) as Array<{ x: number; y: number }>;
    const offset = polygon.pathOffset || new fabric.Point(0, 0);
    if (points.length > 0) {
      ctx.beginPath();
      points.forEach((point, index) => {
        const x = point.x - offset.x;
        const y = point.y - offset.y;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.closePath();
      if ((object as any).fill) ctx.fill();
      if ((object as any).stroke && (object as any).strokeWidth) ctx.stroke();
    }
  } else if (object.type === 'path') {
    const pathObject = object as fabric.Path;
    if (pathObject.path) {
      const pathData = pathObject.path
        .map((segment) => segment.map(String).join(' '))
        .join(' ');
      const path2d = new Path2D(pathData);
      if ((object as any).fill) ctx.fill(path2d);
      if ((object as any).stroke && (object as any).strokeWidth) ctx.stroke(path2d);
    }
  } else if (object.type === 'i-text' || object.type === 'textbox' || object.type === 'text') {
    drawText(ctx, object);
  } else if (object.type === 'image') {
    const image = object as fabric.Image;
    const element = (image as any).getElement?.() || (image as any)._element;
    if (element) {
      const width = Number(image.width ?? 0);
      const height = Number(image.height ?? 0);
      ctx.drawImage(element, -width / 2, -height / 2, width, height);
    }
  }

  ctx.restore();
};

export const renderCanvasToPngBlob = async (
  canvas: fabric.Canvas,
  options: RenderToPngOptions
) => {
  const scale = options.scale ?? 2;
  const width = canvas.getWidth();
  const height = canvas.getHeight();
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = Math.round(width * scale);
  outputCanvas.height = Math.round(height * scale);

  const ctx = outputCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create export canvas context.');
  }

  ctx.scale(scale, scale);

  if (options.includeBackground) {
    const background = options.backgroundColor || canvas.backgroundColor;
    if (background && typeof background === 'string') {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
  }

  canvas.getObjects().forEach((obj) => drawObject(ctx, obj, 1));

  return new Promise<Blob>((resolve, reject) => {
    outputCanvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to export PNG.'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
};
