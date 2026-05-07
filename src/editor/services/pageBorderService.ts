import * as fabric from 'fabric';
import { useCanvasStore } from '../state/useCanvasStore';

export type LineStyle = 'solid' | 'dashed' | 'dotted';
export type CornerStyle = 'bracket' | 'flourish' | 'diamond' | 'cross' | 'rounded' | 'leaf';
export type EdgePattern = 'dots' | 'dashes' | 'diamonds' | 'stars';

export interface PageBorderSettings {
  lineEnabled: boolean;
  lineStyle: LineStyle;
  lineColor: string;
  lineWeight: number;
  inset: number;

  cornersEnabled: boolean;
  cornerStyle: CornerStyle;
  cornerSize: number;
  cornerColor: string;

  patternEnabled: boolean;
  edgePattern: EdgePattern;
  patternSize: number;
  patternSpacing: number;
  patternColor: string;

  vignetteEnabled: boolean;
  vignetteColor: string;
  vignetteSpread: number;
  vignetteIntensity: number;
}

export const DEFAULT_PAGE_BORDER_SETTINGS: PageBorderSettings = {
  lineEnabled: true,
  lineStyle: 'solid',
  lineColor: '#8f7767',
  lineWeight: 2,
  inset: 32,

  cornersEnabled: false,
  cornerStyle: 'rounded',
  cornerSize: 28,
  cornerColor: '#8f7767',

  patternEnabled: false,
  edgePattern: 'dots',
  patternSize: 12,
  patternSpacing: 26,
  patternColor: '#8f7767',

  vignetteEnabled: false,
  vignetteColor: '#3e2f26',
  vignetteSpread: 48,
  vignetteIntensity: 0.22,
};

const toRgba = (hexOrColor: string, alpha: number) => {
  const c = hexOrColor.trim();
  if (c.startsWith('rgba(')) {
    return c.replace(/rgba\(([^)]+)\)/, (_, parts) => {
      const p = String(parts).split(',').map((v) => v.trim());
      return `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${alpha})`;
    });
  }
  if (c.startsWith('rgb(')) {
    return c.replace(/rgb\(([^)]+)\)/, (_, parts) => `rgba(${parts}, ${alpha})`);
  }
  if (c.startsWith('#')) {
    const raw = c.slice(1);
    const hex = raw.length === 3 ? raw.split('').map((x) => x + x).join('') : raw;
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  return c;
};

export const getPageBorderGroup = (canvas: fabric.Canvas): fabric.Group | null => {
  const obj = canvas.getObjects().find((o) => (o as any).isPageBorder);
  return obj && obj.type === 'group' ? (obj as fabric.Group) : null;
};

export const removePageBorder = (canvas: fabric.Canvas) => {
  const existing = getPageBorderGroup(canvas);
  if (!existing) return;
  canvas.remove(existing);
  canvas.requestRenderAll();
};

const createCorner = (style: CornerStyle, size: number, color: string): fabric.Object => {
  const stroke = color;
  const common = {
    stroke,
    strokeWidth: Math.max(1, size * 0.07),
    fill: 'transparent',
    originX: 'center' as const,
    originY: 'center' as const,
    selectable: false,
    evented: false,
  };

  switch (style) {
    case 'bracket':
      return new fabric.Path(`M 0 ${size} L 0 0 L ${size} 0`, common);
    case 'flourish':
      return new fabric.Path(`M 0 ${size} Q ${size * 0.35} ${size * 0.2} ${size} 0 M ${size * 0.45} ${size} Q ${size * 0.7} ${size * 0.65} ${size} ${size * 0.45}`,
        common);
    case 'diamond':
      return new fabric.Polygon([
        { x: 0, y: -size * 0.35 },
        { x: size * 0.35, y: 0 },
        { x: 0, y: size * 0.35 },
        { x: -size * 0.35, y: 0 },
      ], { ...common, fill: 'transparent' });
    case 'cross':
      return new fabric.Path(`M 0 ${size * 0.5} L ${size} ${size * 0.5} M ${size * 0.5} 0 L ${size * 0.5} ${size}`, common);
    case 'leaf':
      return new fabric.Path(`M 0 ${size * 0.9} Q ${size * 0.2} ${size * 0.3} ${size * 0.8} ${size * 0.1} Q ${size * 0.55} ${size * 0.55} ${size * 0.3} ${size}`, common);
    case 'rounded':
    default:
      return new fabric.Path(`M 0 ${size} Q 0 0 ${size} 0`, common);
  }
};

const createPatternMotif = (pattern: EdgePattern, size: number, color: string): fabric.Object => {
  switch (pattern) {
    case 'dashes':
      return new fabric.Rect({
        width: size,
        height: Math.max(2, size * 0.18),
        rx: size * 0.08,
        ry: size * 0.08,
        fill: color,
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
      });
    case 'diamonds':
      return new fabric.Polygon([
        { x: 0, y: -size * 0.5 },
        { x: size * 0.5, y: 0 },
        { x: 0, y: size * 0.5 },
        { x: -size * 0.5, y: 0 },
      ], {
        fill: color,
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
      });
    case 'stars': {
      const outer = size * 0.5;
      const inner = size * 0.22;
      const points: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < 10; i += 1) {
        const radius = i % 2 === 0 ? outer : inner;
        const angle = (i * 36 * Math.PI) / 180;
        points.push({ x: radius * Math.sin(angle), y: -radius * Math.cos(angle) });
      }
      return new fabric.Polygon(points, {
        fill: color,
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
      });
    }
    case 'dots':
    default:
      return new fabric.Circle({
        radius: Math.max(1.5, size * 0.22),
        fill: color,
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
      });
  }
};

const placeBorderNearBottom = (canvas: fabric.Canvas, border: fabric.Object) => {
  const objects = canvas.getObjects();
  const firstContentIndex = objects.findIndex((o) => !(o as any).isGuide && !(o as any).isPageBorder);
  if (firstContentIndex <= 0) {
    canvas.sendObjectToBack(border);
    return;
  }
  canvas.moveObjectTo(border, firstContentIndex);
};

export const applyPageBorder = (canvas: fabric.Canvas, settings: PageBorderSettings) => {
  // Use document dimensions, not canvas element size.
  // canvas.getWidth()/getHeight() returns the viewport element size (e.g. 640×544),
  // which is unrelated to the document. All page-border children live in document
  // coordinate space, so they must be sized against the actual document dimensions.
  const { width, height } = useCanvasStore.getState();
  const inset = Math.max(0, settings.inset);
  const children: fabric.Object[] = [];

  if (settings.lineEnabled) {
    const dash = settings.lineStyle === 'dashed' ? [10, 7] : settings.lineStyle === 'dotted' ? [2, 8] : undefined;
    const lineRect = new fabric.Rect({
      left: inset,
      top: inset,
      width: Math.max(1, width - inset * 2),
      height: Math.max(1, height - inset * 2),
      fill: 'transparent',
      stroke: settings.lineColor,
      strokeWidth: settings.lineWeight,
      strokeDashArray: dash,
      selectable: false,
      evented: false,
      originX: 'left',
      originY: 'top',
    });
    children.push(lineRect);
  }

  if (settings.cornersEnabled) {
    const size = Math.max(8, settings.cornerSize);
    const cornerInset = inset + size * 0.42;
    const positions = [
      { x: cornerInset, y: cornerInset, angle: 0 },
      { x: width - cornerInset, y: cornerInset, angle: 90 },
      { x: width - cornerInset, y: height - cornerInset, angle: 180 },
      { x: cornerInset, y: height - cornerInset, angle: 270 },
    ];
    positions.forEach((pos) => {
      const corner = createCorner(settings.cornerStyle, size, settings.cornerColor);
      corner.set({ left: pos.x, top: pos.y, angle: pos.angle });
      children.push(corner);
    });
  }

  if (settings.patternEnabled) {
    const size = Math.max(6, settings.patternSize);
    const spacing = Math.max(size + 4, settings.patternSpacing);
    const edgeInset = inset + Math.max(settings.cornersEnabled ? settings.cornerSize * 0.7 : 0, size * 0.6);

    const createAt = (x: number, y: number, angle = 0) => {
      const motif = createPatternMotif(settings.edgePattern, size, settings.patternColor);
      motif.set({ left: x, top: y, angle });
      children.push(motif);
    };

    for (let x = edgeInset; x <= width - edgeInset; x += spacing) {
      createAt(x, inset, 0);
      createAt(x, height - inset, 0);
    }
    for (let y = edgeInset; y <= height - edgeInset; y += spacing) {
      createAt(inset, y, 90);
      createAt(width - inset, y, 90);
    }
  }

  if (settings.vignetteEnabled) {
    const spread = Math.max(12, settings.vignetteSpread);
    const alpha = Math.max(0.05, Math.min(0.85, settings.vignetteIntensity));
    const dark = toRgba(settings.vignetteColor, alpha);
    const clear = toRgba(settings.vignetteColor, 0);

    const top = new fabric.Rect({
      left: 0,
      top: 0,
      width,
      height: spread,
      fill: new fabric.Gradient({ type: 'linear', gradientUnits: 'pixels', coords: { x1: 0, y1: 0, x2: 0, y2: spread }, colorStops: [{ offset: 0, color: dark }, { offset: 1, color: clear }] }),
      selectable: false,
      evented: false,
      originX: 'left',
      originY: 'top',
    });
    const bottom = new fabric.Rect({
      left: 0,
      top: height - spread,
      width,
      height: spread,
      fill: new fabric.Gradient({ type: 'linear', gradientUnits: 'pixels', coords: { x1: 0, y1: spread, x2: 0, y2: 0 }, colorStops: [{ offset: 0, color: dark }, { offset: 1, color: clear }] }),
      selectable: false,
      evented: false,
      originX: 'left',
      originY: 'top',
    });
    const left = new fabric.Rect({
      left: 0,
      top: 0,
      width: spread,
      height,
      fill: new fabric.Gradient({ type: 'linear', gradientUnits: 'pixels', coords: { x1: 0, y1: 0, x2: spread, y2: 0 }, colorStops: [{ offset: 0, color: dark }, { offset: 1, color: clear }] }),
      selectable: false,
      evented: false,
      originX: 'left',
      originY: 'top',
    });
    const right = new fabric.Rect({
      left: width - spread,
      top: 0,
      width: spread,
      height,
      fill: new fabric.Gradient({ type: 'linear', gradientUnits: 'pixels', coords: { x1: spread, y1: 0, x2: 0, y2: 0 }, colorStops: [{ offset: 0, color: dark }, { offset: 1, color: clear }] }),
      selectable: false,
      evented: false,
      originX: 'left',
      originY: 'top',
    });

    children.push(top, bottom, left, right);
  }

  removePageBorder(canvas);

  if (children.length === 0) {
    canvas.requestRenderAll();
    return;
  }

  const group = new fabric.Group(children, {
    left: 0,
    top: 0,
    originX: 'left',
    originY: 'top',
    selectable: false,
    evented: false,
    hasBorders: false,
    hasControls: false,
    lockMovementX: true,
    lockMovementY: true,
  });

  (group as any).isPageBorder = true;
  (group as any).name = 'Page Border';
  (group as any).borderSettings = settings;
  (group as any).id = (group as any).id || 'page-border';

  canvas.add(group);
  placeBorderNearBottom(canvas, group);
  canvas.requestRenderAll();
};

export const refitPageBorder = (canvas: fabric.Canvas) => {
  const group = getPageBorderGroup(canvas);
  if (!group) return;
  const settings = (group as any).borderSettings as PageBorderSettings | undefined;
  if (!settings) return;
  applyPageBorder(canvas, settings);
};
