import * as fabric from 'fabric';
import { reviveCustomFabricProps } from '../fabric/initFabricCanvas';
import { enforceSerializedZOrder, enforceZOrder } from '../fabric/zIndexManifest';
import { isUserObject } from '../utils/objectUtils';
import {
  normalizeSerializedObjectForFabric,
  normalizeSerializedObjectType,
  serializeCanvasObjects,
} from '../utils/serialization';
import type { SerializedFabricObject } from './editorStore';

type LayerSyncOptions = {
  selectedObjectId?: string | null;
  /** Reject late async work after this canvas/session has been replaced. */
  isCurrent?: () => boolean;
};

type LayerSyncResult = {
  layersById: Record<string, fabric.Object>;
  changed: boolean;
  selectOnInsertIds: string[];
};

type LayerRevival = (serialized: SerializedFabricObject) => Promise<fabric.Object | null>;

// A deterministic revival boundary keeps the queue contract testable without
// replacing Fabric's own object registry in production.  Browser/runtime code
// never installs this override; tests use it to hold a real enliven operation
// while newer desired states are queued.
let layerRevivalOverride: LayerRevival | null = null;

export const setLayerRevivalForTests = (revival: LayerRevival | null) => {
  layerRevivalOverride = revival;
};

const isStoreManagedObject = (obj: fabric.Object) => {
  return isUserObject(obj) && !(obj as any).excludeFromSync;
};

const serializeForComparison = (serialized: SerializedFabricObject) => {
  const { version: _version, ...rest } = normalizeSerializedObjectForFabric(serialized);
  return JSON.stringify(rest);
};

const serializeDesiredForComparison = (obj: SerializedFabricObject) => {
  const { version: _version, ...rest } = normalizeSerializedObjectForFabric(obj);
  return JSON.stringify(rest);
};

const enlivenObject = async (serialized: SerializedFabricObject) => {
  try {
    if (layerRevivalOverride) {
      return await layerRevivalOverride(serialized);
    }
    const objects = await fabric.util.enlivenObjects([
      normalizeSerializedObjectForFabric(serialized),
    ]) as fabric.Object[];
    const obj = objects[0];
    if (obj) {
      reviveCustomFabricProps(serialized as any, obj as any);
    }
    return obj ?? null;
  } catch {
    // A malformed/stale object must not reject the queue and strand every
    // later layer synchronization request for this canvas.
    return null;
  }
};

const layerSyncQueues = new WeakMap<fabric.Canvas, Promise<void>>();
const layerSyncGenerations = new WeakMap<fabric.Canvas, number>();

export const syncCanvasLayers = async (
  canvasObjects: SerializedFabricObject[],
  canvas: fabric.Canvas,
  options: LayerSyncOptions = {}
): Promise<LayerSyncResult | null> => {
  if (options.isCurrent && !options.isCurrent()) return null;
  const requestGeneration = (layerSyncGenerations.get(canvas) ?? 0) + 1;
  layerSyncGenerations.set(canvas, requestGeneration);
  const isLatestRequest = () => layerSyncGenerations.get(canvas) === requestGeneration;
  const previousSync = layerSyncQueues.get(canvas);
  let releaseSync: () => void = () => {};
  const currentSync = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  // Install our latch before waiting for the predecessor.  Installing it
  // after the await lets two callers observe the same predecessor and enter
  // the critical section together, which can duplicate asynchronously
  // enlivened objects.
  layerSyncQueues.set(canvas, currentSync);

  try {
  // A failed predecessor must not permanently poison the per-canvas queue.
  if (previousSync) {
    await previousSync.catch(() => undefined);
  }
  if (!isLatestRequest() || (options.isCurrent && !options.isCurrent())) return null;
  const desiredObjects = enforceSerializedZOrder(
    canvasObjects.filter((obj) => isUserObject(obj) && !(obj as any).excludeFromSync)
  ).filter((object, index, all) => (
    all.findIndex((candidate) => candidate.id === object.id) === index
  ));
  const currentObjects = canvas.getObjects().filter(isStoreManagedObject);
  // Use Fabric's canvas-level serializer for comparison as well as for
  // persistence.  While an ActiveSelection exists, each child's direct
  // toObject() is selection-local, whereas the store's desired objects are
  // page-space coordinates.  Comparing those two representations would
  // otherwise replace selected objects unnecessarily and disturb selection.
  const currentSerializedById = new Map(
    (serializeCanvasObjects(canvas, isStoreManagedObject) as SerializedFabricObject[])
      .map((serialized) => [serialized.id, serialized] as const)
  );
  let changed = false;

  // Repair duplicate IDs left by older synchronization paths before building
  // the identity map. Keep the first live object and discard later aliases so
  // one desired ID can never produce two Fabric instances.
  const uniqueCurrentObjects: fabric.Object[] = [];
  const seenCurrentIds = new Set<string>();
  currentObjects.forEach((object) => {
    const id = (object as any).id;
    if (typeof id !== 'string' || id.length === 0 || !seenCurrentIds.has(id)) {
      if (typeof id === 'string' && id.length > 0) seenCurrentIds.add(id);
      uniqueCurrentObjects.push(object);
      return;
    }
    (object as any).__layerSyncing = true;
    try {
      canvas.remove(object);
    } finally {
      delete (object as any).__layerSyncing;
    }
    changed = true;
  });
  const managedObjects = uniqueCurrentObjects;
  const currentById = new Map<string, fabric.Object>();

  managedObjects.forEach((obj) => {
    const id = (obj as any).id;
    if (typeof id === 'string' && id.length > 0) {
      currentById.set(id, obj);
    }
  });

  const desiredIds = new Set<string>();
  const selectOnInsertIds: string[] = [];
  for (const desired of desiredObjects) {
    if (!desired.id) continue;
    desiredIds.add(desired.id);
    if ((desired as any).__selectOnInsert) {
      selectOnInsertIds.push(desired.id);
    }
  }

  for (const current of managedObjects) {
    const currentId = (current as any).id;
    if (typeof currentId === 'string' && currentId.length > 0 && !desiredIds.has(currentId)) {
      (current as any).__layerSyncing = true;
      try {
        canvas.remove(current);
      } finally {
        delete (current as any).__layerSyncing;
      }
      changed = true;
    }
  }

  for (const desired of desiredObjects) {
    if (!desired.id) continue;
    const existing = currentById.get(desired.id);
    if (!existing) {
      const liveExisting = canvas.getObjects().find((obj) => (obj as any).id === desired.id);
      if (liveExisting) {
        currentById.set(desired.id, liveExisting);
        continue;
      }
      if (!isLatestRequest() || (options.isCurrent && !options.isCurrent())) return null;
      const nextObject = await enlivenObject(desired);
      if (!isLatestRequest() || (options.isCurrent && !options.isCurrent())) {
        nextObject?.dispose?.();
        return null;
      }
      if (nextObject) {
        (nextObject as any).__layerSyncing = true;
        canvas.add(nextObject);
        delete (nextObject as any).__layerSyncing;
        currentById.set(desired.id, nextObject);
        changed = true;
      }
      continue;
    }

    const serializedExisting = currentSerializedById.get(desired.id);
    if (
      normalizeSerializedObjectType(existing.type) !== normalizeSerializedObjectType(desired.type)
      || !serializedExisting
      || serializeForComparison(serializedExisting) !== serializeDesiredForComparison(desired)
    ) {
      if (!isLatestRequest() || (options.isCurrent && !options.isCurrent())) return null;
      const replacement = await enlivenObject(desired);
      if (!isLatestRequest() || (options.isCurrent && !options.isCurrent())) {
        replacement?.dispose?.();
        return null;
      }
      if (replacement) {
        (existing as any).__layerSyncing = true;
        try {
          canvas.remove(existing);
        } finally {
          delete (existing as any).__layerSyncing;
        }
        (replacement as any).__layerSyncing = true;
        canvas.add(replacement);
        delete (replacement as any).__layerSyncing;
        currentById.set(desired.id, replacement);
        changed = true;
      }
    }
  }

  if (!isLatestRequest() || (options.isCurrent && !options.isCurrent())) return null;
  enforceZOrder(canvas);

  const syncedManagedObjects = canvas.getObjects().filter(isStoreManagedObject);
  const layersById: Record<string, fabric.Object> = {};
  syncedManagedObjects.forEach((obj) => {
    const id = (obj as any).id;
    if (typeof id === 'string' && id.length > 0) {
      layersById[id] = obj;
    }
  });

  if (changed) {
    canvas.requestRenderAll();
  }

  return { layersById, changed, selectOnInsertIds };
  } finally {
    if (layerSyncQueues.get(canvas) === currentSync) {
      layerSyncQueues.delete(canvas);
    }
    releaseSync();
  }
};
