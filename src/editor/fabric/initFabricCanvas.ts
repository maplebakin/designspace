import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import type { ApocapaletteTheme } from '../types/apocapalette';
import { SAFE_MARGIN_PX } from '../utils/units';

export const initFabricSerialization = () => {
  // Intentionally no-op: custom serialization handled via helpers.
};

type FabricReviver = NonNullable<Parameters<fabric.Canvas['loadFromJSON']>[1]>;

export const reviveCustomFabricProps: FabricReviver = (serialized, instance) => {
  if (!(instance instanceof fabric.Object)) return;
  const target = instance as any;
  if (target.id == null) target.id = serialized?.id ?? null;
  if (target.tokenRole === undefined) target.tokenRole = serialized?.tokenRole ?? null;
  if (target.colorLocked === undefined) target.colorLocked = serialized?.colorLocked ?? false;
  if (target.isPlaceholder === undefined) target.isPlaceholder = serialized?.isPlaceholder ?? false;
};

export const ensureObjectId = (
  target?: fabric.Object | null,
  canvas?: fabric.Canvas | null
) => {
  if (!target) return;
  const targetAny = target as any;
  const rawId = targetAny.id;
  if (!rawId || (typeof rawId === 'string' && rawId.trim().length === 0)) {
    targetAny.id = uuidv4();
  }
  if (!canvas) return;
  let currentId = targetAny.id;
  if (!currentId) return;
  const isDuplicate = () =>
    canvas
      .getObjects()
      .some((obj) => obj !== target && (obj as any).id === currentId);
  while (isDuplicate()) {
    currentId = uuidv4();
    targetAny.id = currentId;
  }
};

let persistentGuides: fabric.Object[] = [];

const resolveThemeValue = (obj: object | null, path: string): string | null => {
  if (!obj) return null;
  const getValueByPath = (target: object, keyPath: string): any =>
    keyPath.split('.').reduce((acc, part) => acc && (acc as any)[part], target);

  let value = getValueByPath(obj, path);
  if (!value && !path.endsWith('.value')) {
    value = getValueByPath(obj, `${path}.value`);
  }
  if (value && typeof value === 'object' && 'value' in value) {
    return (value as { value: string }).value;
  }
  return typeof value === 'string' ? value : null;
};

const withAlpha = (color: string, alpha: number) => {
  if (!color) return `rgba(255, 255, 255, ${alpha})`;
  const trimmed = color.trim();
  if (trimmed.startsWith('rgba')) {
    return trimmed.replace(/rgba\(([^)]+)\)/, (_, values) => {
      const parts = values.split(',').map((part: string) => part.trim());
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
    });
  }
  if (trimmed.startsWith('rgb')) {
    return trimmed.replace(/rgb\(([^)]+)\)/, (_, values) => `rgba(${values}, ${alpha})`);
  }
  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    const normalized = hex.length === 3
      ? hex.split('').map((ch) => ch + ch).join('')
      : hex;
    if (normalized.length === 6) {
      const r = parseInt(normalized.slice(0, 2), 16);
      const g = parseInt(normalized.slice(2, 4), 16);
      const b = parseInt(normalized.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  return color;
};

export const clearPersistentGuides = (canvas: fabric.Canvas) => {
  persistentGuides.forEach((guide) => canvas.remove(guide));
  persistentGuides = [];
};

export const drawPersistentGuides = (
  canvas: fabric.Canvas,
  themeData: ApocapaletteTheme | null,
  bleedPx: number
) => {
  if (!canvas) return;
  clearPersistentGuides(canvas);

  const width = canvas.getWidth();
  const height = canvas.getHeight();
  const bleed = Math.max(0, bleedPx || 0);
  const safeInset = bleed + SAFE_MARGIN_PX;
  const accent = resolveThemeValue(themeData, 'borders.border-accent-subtle')
    || 'rgba(255, 255, 255, 0.4)';
  const stroke = withAlpha(accent, 0.4);
  const dash = [6, 4];

  const baseOptions = {
    stroke,
    strokeWidth: 1,
    strokeDashArray: dash,
    selectable: false,
    evented: false,
    hasControls: false,
    hasBorders: false,
    hoverCursor: 'default',
    perPixelTargetFind: false,
    excludeFromExport: true,
  };

  const addGuide = (points: [number, number, number, number]) => {
    const line = new fabric.Line(points, baseOptions);
    line.set('isGuide', true);
    line.set('isPersistentGuide', true);
    canvas.add(line);
    const bringToFront = (canvas as any).bringToFront;
    if (typeof bringToFront === 'function') {
      bringToFront.call(canvas, line);
    }
    persistentGuides.push(line);
  };

  if (bleed > 0) {
    addGuide([bleed, bleed, width - bleed, bleed]);
    addGuide([bleed, height - bleed, width - bleed, height - bleed]);
    addGuide([bleed, bleed, bleed, height - bleed]);
    addGuide([width - bleed, bleed, width - bleed, height - bleed]);
  }

  const safeWidth = width - safeInset * 2;
  const safeHeight = height - safeInset * 2;
  if (safeWidth > 0 && safeHeight > 0) {
    addGuide([safeInset, safeInset, width - safeInset, safeInset]);
    addGuide([safeInset, height - safeInset, width - safeInset, height - safeInset]);
    addGuide([safeInset, safeInset, safeInset, height - safeInset]);
    addGuide([width - safeInset, safeInset, width - safeInset, height - safeInset]);
  }

  canvas.requestRenderAll();
};
