import type { PageAssetEffect } from '../session/projectMutation';

/**
 * The only Canvas object lifecycle facts that may cross the engine adapter
 * boundary. These are stable product IDs; no Fabric instance is included.
 */
export type CanvasCommittedMutation =
  | Readonly<{
      action: 'modify-freeform-geometry';
      objectId: string;
    }>
  | Readonly<{
      action: 'add-freeform-object' | 'remove-freeform-object';
      objectId: string;
      assetEffect: PageAssetEffect;
    }>;

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
