import type { PageAssetEffect } from '../session/projectMutation';

/**
 * The only normalized Canvas authored facts that may cross the engine adapter
 * boundary. These are stable product IDs; no Fabric instance is included.
 */
export type CanvasCommittedMutation =
  | Readonly<{
      action: 'modify-freeform-geometry';
      objectId: string;
    }>
  | Readonly<{
      action: 'modify-freeform-geometry';
      pageScope: true;
    }>
  | Readonly<{
      action: 'modify-freeform-style';
      objectId: string;
      style: CanvasStyleCommitKind;
    }>
  | Readonly<{
      action: 'modify-freeform-text-content';
      objectId: string;
    }>
  | Readonly<{
      action: 'apply-freeform-style-preset';
      objectId: string;
    }>
  | Readonly<{
      action: 'reset-freeform-image-adjustments';
      objectId: string;
    }>
  | Readonly<{
      action: 'modify-freeform-theme-link';
      objectId: string;
    }>
  | Readonly<{
      action: 'apply-freeform-theme' | 'reset-freeform-theme-links';
      pageScope: true;
    }>
  | Readonly<{
      action: 'apply-freeform-design-state';
      pageScope: true;
    }>
  | Readonly<{
      action: 'apply-freeform-template' | 'apply-project-recipe';
      projectScope: true;
    }>
  | Readonly<{
      action: 'add-page' | 'remove-page' | 'reorder-page';
      pageId: string;
    }>
  | Readonly<{
      action: 'resize-freeform-page' | 'reset-freeform-page';
      pageScope: true;
    }>
  | Readonly<{
      action: 'modify-page-metadata';
      pageScope: true;
    }>
  | Readonly<{
      action: 'modify-freeform-transform-lock';
      objectId: string;
    }>
  | Readonly<{
      action: 'modify-freeform-theme-color-lock';
      objectId: string;
    }>
  | Readonly<{
      action: CanvasDiscreteObjectMutationAction;
      objectId: string;
    }>
  | Readonly<{
      action: 'reorder-freeform-objects';
      pageScope: true;
    }>
  | Readonly<{
      action: 'add-freeform-object' | 'remove-freeform-object';
      objectId: string;
      assetEffect: PageAssetEffect;
    }>
  | Readonly<{
      action: 'replace-freeform-image';
      objectId: string;
      assetEffect: PageAssetEffect;
    }>
  | Readonly<{
      action: 'add-freeform-objects';
      pageScope: true;
      assetEffect: PageAssetEffect;
    }>
  | Readonly<{
      action: 'remove-freeform-objects';
      pageScope: true;
      assetEffect: PageAssetEffect;
    }>
  | Readonly<{
      action: 'group-freeform-objects' | 'ungroup-freeform-objects';
      groupId: string;
    }>;

export type CanvasDiscreteObjectMutationAction =
  | 'modify-freeform-visibility'
  | 'move-freeform-forward'
  | 'move-freeform-backward'
  | 'bring-freeform-to-front'
  | 'send-freeform-to-back'
  | 'modify-freeform-selection-lock'
  | 'reorder-freeform-object';

/**
 * The style controls that have an explicit product-level completion boundary.
 * This is intentionally not a Fabric property map: controls without a
 * trustworthy completion event remain outside this union.
 */
export type CanvasStyleCommitKind =
  | 'border-style'
  | 'fill-mode'
  | 'fill-color'
  | 'gradient-color'
  | 'stroke-color'
  | 'shadow-color'
  | 'font-family'
  | 'font-size'
  | 'style-preset'
  | 'font-weight'
  | 'text-align'
  | 'opacity'
  | 'fill-opacity'
  | 'stroke-width'
  | 'shadow-blur'
  | 'shadow-offset-x'
  | 'shadow-offset-y'
  | 'text-line-height'
  | 'text-letter-spacing'
  | 'text-stroke-width'
  | 'corner-radius'
  | 'image-adjustment-brightness'
  | 'image-adjustment-contrast'
  | 'image-adjustment-saturation';

export type CanvasStyleValue = string | number;

const normalizeStyleColor = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

const readFillOpacity = (fill: unknown): number | null => {
  if (typeof fill !== 'string') return null;
  const rgba = fill.match(/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgba) return rgba[1] === undefined ? 1 : Number(rgba[1]);
  const hex = fill.match(/^#([\da-f]{8})$/i);
  if (hex) return parseInt(hex[1].slice(6), 16) / 255;
  if (/^#[\da-f]{3,6}$/i.test(fill)) return 1;
  return null;
};

const readShadowValue = (object: any, key: 'blur' | 'offsetX' | 'offsetY') => {
  const value = object?.shadow?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const readImageAdjustmentValue = (object: any, type: string, key: string) => {
  const filter = Array.isArray(object?.filters)
    ? object.filters.find((candidate: any) => candidate?.type === type)
    : null;
  const value = filter?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

/**
 * Reads one semantic control value from a live or serialized object. The
 * result is used only to prove no-op and postcondition behavior before the
 * stable-ID observation crosses the adapter boundary.
 */
export const readCanvasStyleValue = (
  object: any,
  style: CanvasStyleCommitKind
): CanvasStyleValue | null => {
  switch (style) {
    case 'border-style': {
      const dash = Array.isArray(object?.strokeDashArray)
        ? object.strokeDashArray
        : [];
      if (dash.length === 0) return 'solid';
      if (dash[0] === 12 && dash[1] === 8) return 'dashed';
      if (dash[0] === 2 && dash[1] === 6) return 'dotted';
      return 'custom';
    }
    case 'fill-mode':
      return object?.fill && typeof object.fill === 'object'
        && Array.isArray(object.fill.colorStops)
        ? 'gradient'
        : 'solid';
    case 'fill-color':
      return normalizeStyleColor(object?.fill);
    case 'gradient-color':
      return Array.isArray(object?.fill?.colorStops)
        ? object.fill.colorStops
          .map((stop: any) => normalizeStyleColor(stop?.color))
          .join('|')
        : '';
    case 'stroke-color':
      return normalizeStyleColor(object?.stroke);
    case 'shadow-color':
      return normalizeStyleColor(object?.shadow?.color);
    case 'style-preset':
      return JSON.stringify({
        fill: typeof object?.fill === 'string'
          ? normalizeStyleColor(object.fill)
          : Array.isArray(object?.fill?.colorStops)
            ? object.fill.colorStops.map((stop: any) => ({
                offset: stop?.offset,
                color: normalizeStyleColor(stop?.color),
              }))
            : null,
        stroke: normalizeStyleColor(object?.stroke),
        strokeWidth: object?.strokeWidth ?? null,
        shadow: object?.shadow
          ? {
              color: normalizeStyleColor(object.shadow.color),
              blur: object.shadow.blur,
              offsetX: object.shadow.offsetX,
              offsetY: object.shadow.offsetY,
            }
          : null,
      });
    case 'font-family':
      return typeof object?.fontFamily === 'string' ? object.fontFamily : '';
    case 'font-size':
      return typeof object?.fontSize === 'number' ? object.fontSize : 0;
    case 'font-weight':
      return object?.fontWeight === undefined ? 'normal' : String(object.fontWeight);
    case 'text-align':
      return typeof object?.textAlign === 'string' ? object.textAlign : 'left';
    case 'opacity':
      return typeof object?.opacity === 'number' ? object.opacity : 1;
    case 'fill-opacity':
      return readFillOpacity(object?.fill);
    case 'stroke-width':
    case 'text-stroke-width':
      return typeof object?.strokeWidth === 'number' ? object.strokeWidth : 0;
    case 'shadow-blur':
      return readShadowValue(object, 'blur');
    case 'shadow-offset-x':
      return readShadowValue(object, 'offsetX');
    case 'shadow-offset-y':
      return readShadowValue(object, 'offsetY');
    case 'text-line-height':
      return typeof object?.lineHeight === 'number' ? object.lineHeight : 1;
    case 'text-letter-spacing':
      return typeof object?.charSpacing === 'number' ? object.charSpacing : 0;
    case 'corner-radius': {
      const rx = typeof object?.rx === 'number' ? object.rx : 0;
      const ry = typeof object?.ry === 'number' ? object.ry : 0;
      return `${rx}:${ry}`;
    }
    case 'image-adjustment-brightness':
      return readImageAdjustmentValue(object, 'Brightness', 'brightness');
    case 'image-adjustment-contrast':
      return readImageAdjustmentValue(object, 'Contrast', 'contrast');
    case 'image-adjustment-saturation':
      return readImageAdjustmentValue(object, 'Saturation', 'saturation');
  }
};

export const areCanvasStyleValuesEqual = (
  left: CanvasStyleValue | null | undefined,
  right: CanvasStyleValue | null | undefined
) => {
  if (typeof left === 'number' && typeof right === 'number') {
    return Math.abs(left - right) < 0.000001;
  }
  return left === right;
};

export type CanvasCommittedMutationObserver = (
  mutation: CanvasCommittedMutation
) => void;

/**
 * Explicitly suppresses object lifecycle observations for synchronous engine
 * maintenance such as project reset, grouping, or temporary measurement.
 * This is a scope, not a timer, so asynchronous editor timing cannot leak
 * suppression into a later authored action.
 */
const suppressedCanvases = new WeakSet<object>();

export const isCanvasObjectMutationSuppressed = (
  canvas: object | null | undefined
) => !!canvas && suppressedCanvases.has(canvas);

export const withCanvasObjectMutationSuppressed = <T>(
  canvas: object,
  operation: () => T
): T => {
  suppressedCanvases.add(canvas);
  try {
    return operation();
  } finally {
    suppressedCanvases.delete(canvas);
  }
};

/**
 * Existing Canvas system-object flags are the discriminator for event-based
 * observations. `excludeFromSync` and `__layerSyncing` cover serialized layer
 * reconciliation, while the other flags cover editor-only chrome and
 * temporary frame/template helpers.
 */
export const isCanvasObjectObservationTarget = (object: any): object is {
  id: string;
  type?: string;
} => {
  if (!object) return false;
  if (
    object.isGuide
    || object.isSmartGuide
    || object.isDocumentPaper
    || object.isPageBorder
    || object.isSafeZoneOverlay
    || object.isPersistentGuide
    || object.isPlaceholder
    || object.excludeFromExport
    || object.excludeFromSync
    || object.__layerSyncing
  ) {
    return false;
  }
  return typeof object.id === 'string' && object.id.trim().length > 0;
};

/**
 * Canvas does not prove canonical asset ownership at this boundary. Image
 * additions are therefore conservative, while removal delegates cleanup to
 * the existing engine reference-count path.
 */
export const getCanvasObjectAssetEffect = (
  action: 'add-freeform-object' | 'remove-freeform-object',
  object: { type?: string }
): PageAssetEffect => {
  if (object.type !== 'image') return 'none';
  return action === 'remove-freeform-object'
    ? 'cleanup-delegated'
    : 'unknown-engine-owned';
};
