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
  if (target.isFrame === undefined) target.isFrame = serialized?.isFrame ?? false;
  if (target.frameType === undefined) target.frameType = serialized?.frameType ?? undefined;
  if (target.isPageBorder === undefined) target.isPageBorder = serialized?.isPageBorder ?? false;
  if (target.name === undefined) target.name = serialized?.name ?? undefined;
  if (target.borderSettings === undefined) target.borderSettings = serialized?.borderSettings ?? undefined;
  if (target.zIndex === undefined) target.zIndex = serialized?.zIndex ?? serialized?.__zIndex ?? undefined;
  if (target.__zIndex === undefined) target.__zIndex = serialized?.zIndex ?? serialized?.__zIndex ?? undefined;

  // Handle text-specific properties
  if (instance.type === 'i-text' || instance.type === 'textbox') {
    if (serialized.charSpacing !== undefined) target.charSpacing = serialized.charSpacing;
    if (serialized.stroke !== undefined) target.stroke = serialized.stroke;
    if (serialized.strokeWidth !== undefined) target.strokeWidth = serialized.strokeWidth;

    // Handle shadow restoration
    if (serialized.shadow) {
      if (typeof serialized.shadow === 'string') {
        target.shadow = serialized.shadow;
      } else if (typeof serialized.shadow === 'object') {
        target.shadow = new fabric.Shadow({
          color: serialized.shadow.color || '#000000',
          blur: serialized.shadow.blur || 0,
          offsetX: serialized.shadow.offsetX || 0,
          offsetY: serialized.shadow.offsetY || 0,
        });
      }
    }
  }

  // Handle image-specific properties and filters
  if (instance.type === 'image') {
    if (serialized.filters && Array.isArray(serialized.filters) && serialized.filters.length > 0) {
      // Create filter instances from serialized data
      const filters = [];
      for (const filterData of serialized.filters) {
        if (filterData.type === 'Brightness') {
          filters.push(new fabric.filters.Brightness(filterData));
        } else if (filterData.type === 'Contrast') {
          filters.push(new fabric.filters.Contrast(filterData));
        } else if (filterData.type === 'Saturation') {
          filters.push(new fabric.filters.Saturation(filterData));
        } else if (filterData.type === 'Grayscale') {
          filters.push(new fabric.filters.Grayscale(filterData));
        } else {
          // For other filter types, try to recreate them if possible
          console.warn(`Unknown filter type: ${filterData.type}`);
        }
      }
      target.filters = filters;
      (instance as fabric.FabricImage).applyFilters();
    } else if (serialized.adjustments) {
      // If no filters are present but adjustments exist, apply them
      const filters = [];

      if (serialized.adjustments.brightness !== undefined && serialized.adjustments.brightness !== 0) {
        filters.push(new fabric.filters.Brightness({ brightness: serialized.adjustments.brightness }));
      }

      if (serialized.adjustments.contrast !== undefined && serialized.adjustments.contrast !== 0) {
        filters.push(new fabric.filters.Contrast({ contrast: serialized.adjustments.contrast }));
      }

      if (serialized.adjustments.saturation !== undefined && serialized.adjustments.saturation !== 0) {
        filters.push(new fabric.filters.Saturation({ saturation: serialized.adjustments.saturation }));
      }

      if (filters.length > 0) {
        target.filters = filters;
        (instance as fabric.FabricImage).applyFilters();
      }
    }

    // Set the adjustments property on the fabric object for easy access
    if (serialized.adjustments) {
      target.adjustments = {
        brightness: serialized.adjustments.brightness || 0,
        contrast: serialized.adjustments.contrast || 0,
        saturation: serialized.adjustments.saturation || 0,
      };
    } else {
      // Default adjustments
      target.adjustments = {
        brightness: 0,
        contrast: 0,
        saturation: 0,
      };
    }
  }
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

/**
 * Hydrates canvas data with assets from base64 strings.
 * This converts base64 asset data back to blob URLs for use in the canvas.
 */
export const hydrateCanvasDataWithAssets = async (
  canvasData: any,
  assets: Record<string, string> = {}
): Promise<any> => {
  if (!canvasData || !canvasData.objects) {
    return canvasData;
  }

  // Create a mapping from asset IDs to blob URLs
  const assetBlobUrls: Record<string, string> = {};

  for (const [assetId, base64Data] of Object.entries(assets)) {
    try {
      // Convert base64 to blob
      const response = await fetch(base64Data);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      assetBlobUrls[assetId] = blobUrl;
    } catch (error) {
      console.warn(`Failed to hydrate asset ${assetId}:`, error);
    }
  }

  // Update image objects with the new blob URLs
  const hydratedObjects = canvasData.objects.map((obj: any) => {
    if (obj.type === 'image' && obj.id && assetBlobUrls[obj.id]) {
      return {
        ...obj,
        src: assetBlobUrls[obj.id],
      };
    }
    return obj;
  });

  return {
    ...canvasData,
    objects: hydratedObjects,
  };
};
