import * as fabric from 'fabric';

const DEFAULT_FONT_STACK = "'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif";

interface SerializeToSVGOptions {
  width: number;
  height: number;
  includeBackground?: boolean;
  backgroundColor?: string | null;
  fontFamily?: string;
}

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) return '0';
  return Number(value.toFixed(3)).toString();
};

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getEditorFontStack = () => {
  if (typeof window === 'undefined') return DEFAULT_FONT_STACK;
  const raw = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue('--font-ui')
    .trim();
  return raw.length > 0 ? raw : DEFAULT_FONT_STACK;
};

const buildFontFamily = (fontFamily: string | undefined, fallbackStack: string) => {
  if (!fontFamily) return fallbackStack;
  const normalized = fontFamily.trim();
  if (
    normalized.includes('system-ui') ||
    normalized.includes('-apple-system') ||
    normalized.includes('BlinkMacSystemFont')
  ) {
    return normalized;
  }
  return `${normalized}, ${fallbackStack}`;
};

const shouldSkipObject = (object: fabric.Object) =>
  !object.visible || (object as any).isGuide || (object as any).isSmartGuide;

const getFill = (object: fabric.Object) =>
  typeof (object as any).fill === 'string' ? ((object as any).fill as string) : 'none';

const getStroke = (object: fabric.Object) =>
  typeof (object as any).stroke === 'string' ? ((object as any).stroke as string) : 'none';

const buildStyleAttributes = (object: fabric.Object) => {
  const attrs: string[] = [];
  const fill = getFill(object);
  const stroke = getStroke(object);
  const strokeWidth = (object as any).strokeWidth ?? 0;
  const strokeDashArray = (object as any).strokeDashArray as number[] | undefined;

  attrs.push(`fill="${escapeXml(fill)}"`);
  if (stroke !== 'none') {
    attrs.push(`stroke="${escapeXml(stroke)}"`);
    attrs.push(`stroke-width="${formatNumber(strokeWidth)}"`);
    if (strokeDashArray && strokeDashArray.length > 0) {
      attrs.push(`stroke-dasharray="${strokeDashArray.map(formatNumber).join(' ')}"`);
    }
    if ((object as any).strokeLineCap) {
      attrs.push(`stroke-linecap="${(object as any).strokeLineCap}"`);
    }
    if ((object as any).strokeLineJoin) {
      attrs.push(`stroke-linejoin="${(object as any).strokeLineJoin}"`);
    }
    if ((object as any).strokeUniform) {
      attrs.push('vector-effect="non-scaling-stroke"');
    }
  }
  const opacity = typeof object.opacity === 'number' ? object.opacity : 1;
  if (opacity < 1) {
    attrs.push(`opacity="${formatNumber(opacity)}"`);
  }
  return attrs.join(' ');
};

const matrixToSvg = (matrix: fabric.TMat2D) =>
  `matrix(${matrix.map(formatNumber).join(' ')})`;

const getRelativeMatrix = (object: fabric.Object, parentMatrix?: fabric.TMat2D) => {
  const ownMatrix = object.calcTransformMatrix() as fabric.TMat2D;
  if (!parentMatrix) return ownMatrix;
  const inverseParent = fabric.util.invertTransform(parentMatrix);
  return fabric.util.multiplyTransformMatrices(inverseParent, ownMatrix) as fabric.TMat2D;
};

const polygonToPath = (points: { x: number; y: number }[], pathOffset: fabric.Point) =>
  points
    .map((point, index) => {
      const command = index === 0 ? 'M' : 'L';
      const x = formatNumber(point.x - pathOffset.x);
      const y = formatNumber(point.y - pathOffset.y);
      return `${command}${x} ${y}`;
    })
    .join(' ')
    .concat(' Z');

const pathCommandsToString = (commands: any[][]) =>
  commands
    .map((segment) =>
      segment
        .map((part, index) => {
          if (index === 0) return String(part);
          return formatNumber(Number(part));
        })
        .join(' ')
    )
    .join(' ');

const serializeText = (object: fabric.Object, fontStack: string) => {
  const text = String((object as any).text ?? '');
  if (!text.trim()) return '';
  const lines = text.split(/\r?\n/);
  const fontFamily = buildFontFamily((object as any).fontFamily, fontStack);
  const fontSize = Number((object as any).fontSize ?? 16);
  const fontWeight = (object as any).fontWeight || 'normal';
  const fontStyle = (object as any).fontStyle || 'normal';
  const textAlign = (object as any).textAlign || 'left';
  const textAnchor = textAlign === 'center' ? 'middle' : textAlign === 'right' ? 'end' : 'start';
  const width = Number(object.width ?? 0);
  const height = Number(object.height ?? lines.length * fontSize);
  const lineHeight = Number((object as any).lineHeight ?? 1.16);
  const letterSpacing = (object as any).charSpacing
    ? (Number((object as any).charSpacing) / 1000) * fontSize
    : 0;
  const baseX =
    textAnchor === 'middle' ? 0 : textAnchor === 'end' ? width / 2 : -width / 2;
  const startY = -height / 2 + fontSize;

  const attrs = [
    `x="${formatNumber(baseX)}"`,
    `y="${formatNumber(startY)}"`,
    `font-family="${escapeXml(fontFamily)}"`,
    `font-size="${formatNumber(fontSize)}"`,
    `font-weight="${escapeXml(String(fontWeight))}"`,
    `font-style="${escapeXml(String(fontStyle))}"`,
    `text-anchor="${textAnchor}"`,
    `dominant-baseline="alphabetic"`,
  ];
  if (letterSpacing) {
    attrs.push(`letter-spacing="${formatNumber(letterSpacing)}"`);
  }
  const fill = getFill(object);
  attrs.push(`fill="${escapeXml(fill)}"`);

  const tspans = lines
    .map((line, index) => {
      const dy = index === 0 ? 0 : fontSize * lineHeight;
      return `<tspan x="${formatNumber(baseX)}" dy="${formatNumber(dy)}">${escapeXml(
        line
      )}</tspan>`;
    })
    .join('');

  return `<text ${attrs.join(' ')}>${tspans}</text>`;
};

const serializeObject = (
  object: fabric.Object,
  fontStack: string,
  parentMatrix?: fabric.TMat2D
): string => {
  if (shouldSkipObject(object)) return '';

  if (object.type === 'group' || object.type === 'activeSelection') {
    const group = object as fabric.Group;
    const relativeMatrix = getRelativeMatrix(group, parentMatrix);
    const groupMatrix = group.calcTransformMatrix() as fabric.TMat2D;
    const opacity =
      typeof group.opacity === 'number' && group.opacity < 1
        ? ` opacity="${formatNumber(group.opacity)}"`
        : '';
    const children = group
      .getObjects()
      .map((child) => serializeObject(child, fontStack, groupMatrix))
      .join('');
    return `<g transform="${matrixToSvg(relativeMatrix)}"${opacity}>${children}</g>`;
  }

  const relativeMatrix = getRelativeMatrix(object, parentMatrix);
  const transformAttr = `transform="${matrixToSvg(relativeMatrix)}"`;
  const styleAttrs = buildStyleAttributes(object);

  if (object.type === 'rect') {
    const rect = object as fabric.Rect;
    const width = Number(rect.width ?? 0);
    const height = Number(rect.height ?? 0);
    const rx = Number((rect as any).rx ?? 0);
    const ry = Number((rect as any).ry ?? 0);
    return `<rect ${transformAttr} x="${formatNumber(-width / 2)}" y="${formatNumber(
      -height / 2
    )}" width="${formatNumber(width)}" height="${formatNumber(height)}" rx="${formatNumber(
      rx
    )}" ry="${formatNumber(ry)}" ${styleAttrs} />`;
  }

  if (object.type === 'circle') {
    const circle = object as fabric.Circle;
    const radius = Number(circle.radius ?? 0);
    return `<circle ${transformAttr} cx="0" cy="0" r="${formatNumber(radius)}" ${styleAttrs} />`;
  }

  if (object.type === 'triangle') {
    const triangle = object as fabric.Triangle;
    const width = Number(triangle.width ?? 0);
    const height = Number(triangle.height ?? 0);
    const points = [
      { x: 0, y: -height / 2 },
      { x: width / 2, y: height / 2 },
      { x: -width / 2, y: height / 2 },
    ];
    const d = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${formatNumber(point.x)} ${formatNumber(point.y)}`)
      .join(' ')
      .concat(' Z');
    return `<path ${transformAttr} d="${d}" ${styleAttrs} />`;
  }

  if (object.type === 'polygon') {
    const polygon = object as fabric.Polygon;
    const points = polygon.get('points') || [];
    const pathOffset = polygon.pathOffset || new fabric.Point(0, 0);
    const d = polygonToPath(points, pathOffset);
    return `<path ${transformAttr} d="${d}" ${styleAttrs} />`;
  }

  if (object.type === 'path') {
    const pathObject = object as fabric.Path;
    const d = pathCommandsToString(pathObject.path || []);
    return `<path ${transformAttr} d="${d}" ${styleAttrs} />`;
  }

  if (object.type === 'i-text' || object.type === 'textbox' || object.type === 'text') {
    const textMarkup = serializeText(object, fontStack);
    if (!textMarkup) return '';
    return `<g ${transformAttr}>${textMarkup}</g>`;
  }

  if (object.type === 'image') {
    const image = object as fabric.Image;
    const element = (image as any).getElement?.() || (image as any)._element;
    const src = typeof (image as any).getSrc === 'function' ? (image as any).getSrc() : element?.src;
    if (!src || typeof src !== 'string') return '';
    const width = Number(image.width ?? 0);
    const height = Number(image.height ?? 0);
    return `<image ${transformAttr} x="${formatNumber(-width / 2)}" y="${formatNumber(
      -height / 2
    )}" width="${formatNumber(width)}" height="${formatNumber(height)}" href="${escapeXml(
      src
    )}" preserveAspectRatio="none" />`;
  }

  return '';
};

export const serializeToSVG = (objects: fabric.Object[], options: SerializeToSVGOptions) => {
  const fontStack = options.fontFamily || getEditorFontStack();
  const content = objects.map((obj) => serializeObject(obj, fontStack)).join('');
  const background =
    options.includeBackground && options.backgroundColor
      ? `<rect width="${formatNumber(options.width)}" height="${formatNumber(
          options.height
        )}" fill="${escapeXml(options.backgroundColor)}" />`
      : '';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(
      options.width
    )}" height="${formatNumber(options.height)}" viewBox="0 0 ${formatNumber(
      options.width
    )} ${formatNumber(options.height)}" style="font-family:${escapeXml(fontStack)}">`,
    background,
    content,
    '</svg>',
  ].join('');
};
