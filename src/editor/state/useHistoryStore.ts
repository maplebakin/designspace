import { createWithEqualityFn } from 'zustand/traditional';
import { debounce } from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import * as fabric from 'fabric';
import { assetBlobRegistry, revokeTrackedBlobUrl } from '../services/assetLoader';
import {
  ensureObjectId,
  loadCanvasFromJsonSafely,
  reviveCustomFabricProps,
} from '../fabric/initFabricCanvas';
import {
  isSerializedImageObject,
  normalizeSerializedObjectForFabric,
  serializeCanvasObjects,
} from '../utils/serialization';
import { recordDiff, ObjectDiff, SerializedObject } from '../utils/diffSaver';
import { isPersistableCanvasObject } from '../utils/objectUtils';

// --- CONSTANTS ---
const MAX_HISTORY_SIZE = 50;
const SAVE_STATE_DEBOUNCE_MS = 300;

// --- TYPES ---
export type HistorySnapshot = {
  type: 'full';
  data: any;
} | {
  type: 'diff';
  data: ObjectDiff;
};

export type HistoryCanvasSize = Readonly<{
  width: number;
  height: number;
}>;

const normalizeHistoryCanvasSize = (value: unknown): HistoryCanvasSize | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { width?: unknown; height?: unknown };
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
};

const areHistoryCanvasSizesEqual = (
  first: HistoryCanvasSize | undefined,
  second: HistoryCanvasSize | undefined,
) => first?.width === second?.width && first?.height === second?.height;

type HistorySyncReason = 'undo' | 'redo';
type HistorySyncLockToken = unknown;

type HistoryContext = {
  getCanvas: () => fabric.Canvas | null;
  getScope?: () => string | number | null;
  getImageAssets: () => Record<string, string>;
  setImageAssets: (assets: Record<string, string>) => void;
  getAssetRefCount: () => Map<string, number>;
  setAssetRefCount: (counts: Map<string, number>) => void;
  /** Keep assets referenced by an in-memory page snapshot alive while history is rebased. */
  isAssetRetained?: (id: string) => boolean;
  getDirtyObjectsRef: () => Set<string> | null;
  requestLayerSync: () => void;
  syncCanvasToStore?: () => void;
  setSelectedObjectId: (id: string | null) => void;
  clearSelection?: () => void;
  getBackground?: () => string | undefined;
  setBackground?: (background: string | null) => void;
  /** Authoritative document dimensions participate in canvas history. */
  getCanvasSize?: () => HistoryCanvasSize | undefined;
  setCanvasSize?: (size: HistoryCanvasSize) => void;
  acquireSyncLock?: (reason: HistorySyncReason) => boolean;
  releaseSyncLock?: (reason?: HistorySyncReason, token?: HistorySyncLockToken) => void;
  /** Verify that an async replay still owns the lock it acquired. */
  isSyncLockOwned?: (reason: HistorySyncReason, token?: HistorySyncLockToken) => boolean;
  /** Stable identity for the lock acquired by one replay operation. */
  getSyncLockToken?: () => HistorySyncLockToken;
  /** Injectable revival boundary for delayed/replaced-session replay fencing. */
  reviveObjects?: (objects: any[]) => Promise<fabric.Object[]>;
  /** Stage a full checkpoint off-canvas before committing it to the live view. */
  loadCanvasState?: (
    canvas: fabric.Canvas,
    canvasData: any,
    reviver: any,
    isCurrent: () => boolean,
  ) => Promise<boolean>;
};

export interface HistoryState {
  // Pure History State
  historyIndex: number;
  lastHistorySnapshot: {
    objects: SerializedObject[];
    background?: string;
    canvasSize?: HistoryCanvasSize;
  } | null;
  historyDirty: boolean;

  // Internal history storage
  _snapshots: string[];
  _lastSnapshotAt: number;
  _context: HistoryContext | null;

  // Actions - Pure State Management
  setContext: (context: HistoryContext) => void;
  setHistoryIndex: (index: number) => void;
  setLastHistorySnapshot: (snapshot: {
    objects: SerializedObject[];
    background?: string;
    canvasSize?: HistoryCanvasSize;
  } | null) => void;
  markHistoryDirty: () => void;
  consumeHistoryDirty: () => boolean;

  // Actions - History Operations
  pushSnapshot: (snapshot: string, options?: { force?: boolean }) => {
    pushed: boolean;
    dropped: string[];
    retained: string[];
  };
  getSnapshot: (index: number) => string | null;
  undoSnapshot: () => string | null;
  redoSnapshot: () => string | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  resetHistory: () => void;

  // Actions - Canvas-Aware History
  saveState: (options?: { force?: boolean }) => void;
  takeSnapshot: () => void;
  /** Resolve true only when a scene replay actually completed. */
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  clearHistory: () => void;
  flushPendingSave: () => void;
  cancelPendingSave: () => void;

  // Computed
  historyLength: () => number;
}

const isDataUrl = (value: string) => value.startsWith('data:');
const isLikelyUrl = (value: string) =>
  value.startsWith('blob:')
  || value.startsWith('data:')
  || value.startsWith('http://')
  || value.startsWith('https://');

const getSerializedImageAssetId = (object: any) => {
  const assetId = typeof object?.assetId === 'string' && object.assetId.trim().length > 0
    ? object.assetId.trim()
    : undefined;
  const objectId = typeof object?.id === 'string' && object.id.trim().length > 0
    ? object.id.trim()
    : undefined;
  return assetId || objectId;
};

const createObjectUrlFromDataUrl = (dataUrl: string, id?: string) => {
  try {
    const [meta, rawData] = dataUrl.split(',');
    if (!rawData) return dataUrl;
    const isBase64 = meta.includes(';base64');
    const mime = meta.split(':')[1]?.split(';')[0] || 'application/octet-stream';
    const decoded = isBase64 ? atob(rawData) : decodeURIComponent(rawData);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i += 1) {
      bytes[i] = decoded.charCodeAt(i);
    }
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const assetId = id && id.trim().length > 0 ? id : uuidv4();
    assetBlobRegistry.register(objectUrl, 'image', assetId, 'data-url');
    return objectUrl;
  } catch {
    return dataUrl;
  }
};

const getCanvasObjects = (canvasData: any) => {
  if (!canvasData) return null;
  if (Array.isArray(canvasData)) return canvasData;
  if (!canvasData.objects) return null;
  return canvasData?.objects;
};

const buildCanvasData = (canvasData: any, objects: any[]) => {
  if (!canvasData || Array.isArray(canvasData)) {
    return { objects };
  }
  return { ...canvasData, objects };
};

const mapSerializedObjectTree = (
  objects: any[],
  mapper: (object: any) => any
): any[] => objects.map((object) => {
  if (!object || typeof object !== 'object') return object;
  const mappedChildren = Array.isArray(object.objects)
    ? mapSerializedObjectTree(object.objects, mapper)
    : object.objects;
  return mapper(
    Array.isArray(object.objects)
      ? { ...object, objects: mappedChildren }
      : object
  );
});

export const prepareCanvasDataForPersistence = (
  canvasData: any,
  imageAssets: Record<string, string>
) => {
  const objects = getCanvasObjects(canvasData);
  if (!Array.isArray(objects)) {
    return { canvasData, imageAssets };
  }
  let nextAssets = imageAssets;
  const nextObjects = mapSerializedObjectTree(objects, (obj: any) => {
    if (!obj || !isSerializedImageObject(obj)) return obj;
    const id = typeof obj.id === 'string' && obj.id.trim().length > 0 ? obj.id : uuidv4();
    const assetId = getSerializedImageAssetId(obj) || id;
    const src = typeof obj.src === 'string' ? obj.src : '';
    let assetUrl = nextAssets[assetId] || (assetId !== id ? nextAssets[id] : undefined);
    if (assetUrl && !nextAssets[assetId]) {
      nextAssets = { ...nextAssets, [assetId]: assetUrl };
    }
    if (assetUrl && isDataUrl(assetUrl)) {
      const objectUrl = createObjectUrlFromDataUrl(assetUrl, assetId);
      nextAssets = { ...nextAssets, [assetId]: objectUrl };
      assetUrl = objectUrl;
    }
    if (!assetUrl && src) {
      const referencedAsset = !isLikelyUrl(src) ? nextAssets[src] : undefined;
      if (referencedAsset) {
        if (!nextAssets[assetId]) {
          nextAssets = { ...nextAssets, [assetId]: referencedAsset };
        }
        assetUrl = referencedAsset;
      } else if (src.startsWith('blob:')) {
        nextAssets = { ...nextAssets, [assetId]: src };
        assetUrl = src;
      } else if (isDataUrl(src)) {
        const objectUrl = createObjectUrlFromDataUrl(src, assetId);
        nextAssets = { ...nextAssets, [assetId]: objectUrl };
        assetUrl = objectUrl;
      } else {
        nextAssets = { ...nextAssets, [assetId]: src };
        assetUrl = src;
      }
    }
    if (assetUrl) {
      return { ...obj, id, assetId, src: assetId };
    }
    if (id !== obj.id) {
      return { ...obj, id, assetId };
    }
    return { ...obj, assetId };
  });
  return {
    canvasData: buildCanvasData(canvasData, nextObjects),
    imageAssets: nextAssets,
  };
};

export const hydrateCanvasDataWithAssets = (
  canvasData: any,
  imageAssets: Record<string, string>
) => {
  const objects = getCanvasObjects(canvasData);
  if (!Array.isArray(objects)) {
    return canvasData;
  }
  return {
    ...buildCanvasData(canvasData, objects),
    objects: mapSerializedObjectTree(objects, (obj: any) => {
      if (!obj || !isSerializedImageObject(obj)) return obj;
      const assetId = getSerializedImageAssetId(obj) || '';
      const assetUrl = assetId ? imageAssets[assetId] : '';
      if (assetUrl) {
        return { ...obj, src: assetUrl };
      }
      return obj;
    }),
  };
};

/**
 * Parse a history snapshot from JSON string.
 */
export const parseHistorySnapshot = (snapshotStr: string): HistorySnapshot | null => {
  try {
    const parsed = JSON.parse(snapshotStr) as HistorySnapshot | any;
    if (parsed && typeof parsed === 'object' && parsed.type) {
      return parsed as HistorySnapshot;
    }
    return { type: 'full', data: parsed };
  } catch {
    return null;
  }
};

const resolveHistoryStateAtIndex = (snapshots: string[], targetIndex: number) => {
  let resolved: any = null;

  for (let index = 0; index <= targetIndex; index += 1) {
    const snapshot = parseHistorySnapshot(snapshots[index]);
    if (!snapshot) return null;
    if (snapshot.type === 'full') {
      resolved = JSON.parse(JSON.stringify(snapshot.data));
      continue;
    }
    if (!resolved) return null;

    const currentObjects = (getCanvasObjects(resolved) || []) as SerializedObject[];
    const removedIds = new Set(snapshot.data.removed.map((object) => object.id));
    const nextObjects = currentObjects
      .filter((object) => !removedIds.has(object.id))
      .map((object) => {
        const patch = snapshot.data.changed.find((candidate) => candidate.id === object.id);
        if (!patch) return object;
        const nextObject = { ...object, ...patch.next };
        (patch.unsetNext ?? []).forEach((key) => {
          delete (nextObject as any)[key];
        });
        return nextObject;
      });
    nextObjects.push(...snapshot.data.added);
    const desiredOrder = snapshot.data.order?.after;
    if (Array.isArray(desiredOrder)) {
      const byId = new Map(nextObjects.map((object) => [object.id, object]));
      const ordered = desiredOrder
        .map((id) => byId.get(id))
        .filter((object): object is SerializedObject => !!object);
      const orderedIds = new Set(ordered.map((object) => object.id));
      nextObjects.splice(
        0,
        nextObjects.length,
        ...ordered,
        ...nextObjects.filter((object) => !orderedIds.has(object.id)),
      );
    }
    resolved = buildCanvasData(resolved, nextObjects);
  }

  return resolved;
};

const collectImageAssetCounts = (objects: SerializedObject[]) => {
  const counts = new Map<string, number>();
  const visit = (obj: any) => {
    if (Array.isArray(obj?.objects)) {
      obj.objects.forEach(visit);
    }
    if (!obj || !isSerializedImageObject(obj)) return;
    const assetId = getSerializedImageAssetId(obj);
    if (!assetId) return;
    counts.set(assetId, (counts.get(assetId) ?? 0) + 1);
  };
  objects.forEach(visit);
  return counts;
};

const collectImageAssetCountsFromSnapshot = (snapshot: HistorySnapshot) => {
  if (snapshot.type === 'full') {
    const objects = (getCanvasObjects(snapshot.data) || []) as SerializedObject[];
    return collectImageAssetCounts(objects);
  }
  const counts = new Map<string, number>();
  const diff = snapshot.data;
  const addedCounts = collectImageAssetCounts(diff.added);
  const removedCounts = collectImageAssetCounts(diff.removed);

  const mergeCounts = (source: Map<string, number>) => {
    source.forEach((count, id) => {
      counts.set(id, (counts.get(id) ?? 0) + count);
    });
  };

  mergeCounts(addedCounts);
  mergeCounts(removedCounts);

  diff.changed.forEach((patch) => {
    const getPatchAssetId = (part: Partial<SerializedObject>) => {
      const explicit = typeof (part as any)?.assetId === 'string' && (part as any).assetId.trim()
        ? (part as any).assetId.trim()
        : undefined;
      const source = typeof (part as any)?.src === 'string' && !isLikelyUrl((part as any).src)
        ? (part as any).src
        : undefined;
      // Diff patches omit unchanged `type`; an image source/assetId is still
      // unambiguous because ordinary Fabric objects have neither field.
      return explicit || source;
    };
    const previousAssetId = getPatchAssetId(patch.prev);
    const nextAssetId = getPatchAssetId(patch.next);
    if (previousAssetId) counts.set(previousAssetId, (counts.get(previousAssetId) ?? 0) + 1);
    if (nextAssetId) counts.set(nextAssetId, (counts.get(nextAssetId) ?? 0) + 1);
  });

  return counts;
};

// A shallow property patch cannot safely revive engine-owned nested values
// such as gradients, patterns, clip paths, filters, shadows, and grouped
// object trees.  Those mutations deliberately become a full checkpoint so
// Fabric's normal JSON reviver remains the inverse of the serialization.
const diffRequiresFullSnapshot = (diff: ObjectDiff) => diff.changed.some((patch) => {
  const keys = new Set([
    ...Object.keys(patch.prev || {}),
    ...Object.keys(patch.next || {}),
  ]);
  return [...keys].some((key) => {
    if (key === 'id' || key === 'type') return false;
    const previous = (patch.prev as any)?.[key];
    const next = (patch.next as any)?.[key];
    return (
      (previous !== null && typeof previous === 'object')
      || (next !== null && typeof next === 'object')
      || key === 'clipPath'
      || key === 'gradient'
      || key === 'pattern'
      || key === 'shadow'
      || key === 'filters'
      || key === 'objects'
    );
  });
});

export const applyAssetRefCounts = (
  assetRefCount: Map<string, number>,
  imageAssets: Record<string, string>,
  counts: Map<string, number>,
  delta: 1 | -1,
  options: { preserveAsset?: (id: string) => boolean } = {},
) => {
  const nextRefCount = new Map(assetRefCount);
  let nextAssets = imageAssets;

  counts.forEach((count, id) => {
    if (!id || !Number.isFinite(count) || count <= 0) return;
    const current = nextRefCount.get(id) ?? 0;
    if (delta < 0 && current === 0) {
      return;
    }
    const next = current + count * delta;
    if (next <= 0 && current > 0) {
      // History may be discarded while an inactive page still owns the same
      // uploaded bytes through its in-memory canvasData snapshot.  That page
      // ownership is distinct from history and must survive the release;
      // leave the URL available with no history ref so the next page switch
      // can rehydrate it and establish a new live/history owner.
      if (options.preserveAsset?.(id)) {
        nextRefCount.delete(id);
        return;
      }
      nextRefCount.delete(id);
      const assetUrl = nextAssets[id];
      if (assetUrl) {
        if (nextAssets === imageAssets) {
          nextAssets = { ...imageAssets };
        }
        delete nextAssets[id];
        if (assetUrl.startsWith('blob:')) {
          const revoked = revokeTrackedBlobUrl(assetUrl);
          if (!revoked) {
            URL.revokeObjectURL(assetUrl);
          }
        }
      }
    } else {
      nextRefCount.set(id, next);
    }
  });

  return { nextRefCount, nextAssets };
};

const hydrateSerializedObjectsWithAssets = (
  objects: SerializedObject[],
  imageAssets: Record<string, string>
) => mapSerializedObjectTree(objects, (obj) => {
  if (!obj || !isSerializedImageObject(obj)) return obj;
  const assetId = getSerializedImageAssetId(obj) || '';
  const assetUrl = assetId ? imageAssets[assetId] : '';
  if (assetUrl) {
    return { ...obj, src: assetUrl };
  }
  return obj;
});

const resolveImagePatchSrc = (
  patch: Partial<SerializedObject>,
  imageAssets: Record<string, string>
) => {
  if (!patch || typeof patch !== 'object') return patch;
  const patchSrc = (patch as any).src;
  const patchAssetId = getSerializedImageAssetId(patch);
  if (patchAssetId && imageAssets[patchAssetId]) {
    return { ...patch, src: imageAssets[patchAssetId] } as Partial<SerializedObject>;
  }
  if (typeof patchSrc === 'string' && imageAssets[patchSrc]) {
    return { ...patch, src: imageAssets[patchSrc] } as Partial<SerializedObject>;
  }
  if (typeof patchSrc === 'string' && !isLikelyUrl(patchSrc)) {
    const sanitized = { ...patch } as Partial<SerializedObject>;
    delete (sanitized as any).src;
    return sanitized;
  }
  return patch;
};

const applyObjectPatch = async (
  object: fabric.Object,
  patch: Partial<SerializedObject>,
  imageAssets: Record<string, string>,
  unsetKeys: readonly string[] = [],
  isCurrent?: () => boolean,
) => {
  if (isCurrent && !isCurrent()) return false;
  if (!patch || (Object.keys(patch).length === 0 && unsetKeys.length === 0)) return true;
  const resolvedPatch = resolveImagePatchSrc(patch, imageAssets);

  const removeUnsetProperties = (target: fabric.Object) => {
    unsetKeys.forEach((key) => {
      if (key === 'id' || key === 'type') return;
      delete (target as any)[key];
    });
  };

  const resolvedSrc = (resolvedPatch as any).src;
  if (object.type === 'image') {
    const image = object as fabric.Image;
    const remainingPatch = { ...resolvedPatch };
    if (typeof resolvedSrc === 'string') {
      delete (remainingPatch as any).src;

      if (typeof (image as any).setSrc === 'function') {
        await new Promise<void>((resolve) => {
          const setSrcResult = (image as any).setSrc(
            resolvedSrc,
            () => resolve(),
            { crossOrigin: 'anonymous' }
          );
          if (setSrcResult && typeof setSrcResult.then === 'function') {
            setSrcResult.then(() => resolve()).catch(() => resolve());
          }
        });
        if (isCurrent && !isCurrent()) return false;
      } else {
        (image as any).src = resolvedSrc;
      }
    }

    if (Object.keys(remainingPatch).length > 0) {
      // Fabric's filter/shadow values are class instances at runtime. Use
      // the same reviver as loadFromJSON for those nested values rather than
      // leaving plain JSON objects on the live image.
      if ('filters' in remainingPatch || 'adjustments' in remainingPatch) {
        reviveCustomFabricProps(remainingPatch as any, image as any);
        delete (remainingPatch as any).filters;
        delete (remainingPatch as any).adjustments;
      }
      image.set(remainingPatch as any);
    }
    removeUnsetProperties(image);
    image.setCoords();
    return true;
  }

  const scalarPatch = { ...resolvedPatch } as any;
  if (
    object.type === 'i-text'
    || object.type === 'textbox'
    || object.type === 'text'
  ) {
    if ('shadow' in scalarPatch) {
      reviveCustomFabricProps(scalarPatch, object as any);
      delete scalarPatch.shadow;
    }
  }
  object.set(scalarPatch as any);
  removeUnsetProperties(object);
  object.setCoords();
  return true;
};

const disposeRevivedObjects = (objects: fabric.Object[]) => {
  objects.forEach((object) => {
    try {
      object.dispose?.();
    } catch {
      // Stale replay cleanup must not mask the session-fence decision.
    }
  });
};

/** Restore persisted object order without moving non-persisted paper/guides. */
const reorderCanvasObjects = (
  canvas: fabric.Canvas,
  desiredPersistedIds: readonly string[] | undefined,
) => {
  if (!desiredPersistedIds) return;
  const current = canvas.getObjects();
  const persisted = current.filter(isPersistableCanvasObject);
  const byId = new Map(persisted.map((object) => [String((object as any).id), object]));
  const ordered = desiredPersistedIds
    .map((id) => byId.get(id))
    .filter((object): object is fabric.Object => !!object);
  const orderedIds = new Set(ordered.map((object) => String((object as any).id)));
  ordered.push(...persisted.filter((object) => !orderedIds.has(String((object as any).id))));

  const persistedSlots = current
    .map((object, index) => (isPersistableCanvasObject(object) ? index : -1))
    .filter((index) => index >= 0);
  ordered.forEach((object, index) => {
    const targetIndex = persistedSlots[index];
    if (targetIndex === undefined) return;
    const currentIndex = canvas.getObjects().indexOf(object);
    if (currentIndex !== targetIndex) {
      canvas.moveObjectTo(object, targetIndex);
    }
  });
};

// --- ZUSTAND STORE IMPLEMENTATION ---
export const useHistoryStore = createWithEqualityFn<HistoryState>()(
  (set, get) => {
    const debouncedSaveState = debounce((
      options?: { force?: boolean },
      expectedScope?: string | number | null,
    ) => {
      const { _context, lastHistorySnapshot, historyLength } = get();
      if (!_context) return;
      if (
        expectedScope !== undefined
        && _context.getScope
        && expectedScope !== _context.getScope()
      ) {
        return;
      }
      const canvas = _context.getCanvas();
      if (!canvas) return;

      // Clear dirty flag
      get().consumeHistoryDirty();

      canvas.getObjects().filter(isPersistableCanvasObject).forEach((obj) => {
        ensureObjectId(obj, canvas);
      });

      const rawObjects = serializeCanvasObjects(canvas) as SerializedObject[];
      const background = _context.getBackground?.() ?? (canvas.backgroundColor || undefined);
      const canvasSize = normalizeHistoryCanvasSize(_context.getCanvasSize?.());
      const { canvasData: historyCanvasData, imageAssets: nextAssets } =
        prepareCanvasDataForPersistence({
          objects: rawObjects,
          background,
          ...(canvasSize ? { canvasSize } : {}),
        }, _context.getImageAssets());
      const historyObjects = (getCanvasObjects(historyCanvasData) || []) as SerializedObject[];

      let snapshot: HistorySnapshot;
      if (!lastHistorySnapshot || historyLength() === 0) {
        snapshot = { type: 'full', data: historyCanvasData };
      } else {
        const diff = recordDiff(lastHistorySnapshot.objects, historyObjects, _context.getDirtyObjectsRef());
        const backgroundChanged = lastHistorySnapshot.background !== historyCanvasData.background;
        const canvasSizeChanged = !areHistoryCanvasSizesEqual(
          lastHistorySnapshot.canvasSize,
          canvasSize,
        );
        if (
          diff.added.length === 0
          && diff.removed.length === 0
          && diff.changed.length === 0
          && !diff.order
          && !backgroundChanged
          && !canvasSizeChanged
        ) {
          return;
        }
        // A page resize is part of the same canonical scene checkpoint as its
        // objects.  Keep the patch contract object-only and promote any size
        // change to a full checkpoint so replay can restore dimensions and
        // content atomically.
        snapshot = backgroundChanged || canvasSizeChanged || diffRequiresFullSnapshot(diff)
          ? { type: 'full', data: historyCanvasData }
          : { type: 'diff', data: diff };
      }

      const pushResult = get().pushSnapshot(JSON.stringify(snapshot), options);
      let nextRefCount = _context.getAssetRefCount();
      let adjustedAssets = nextAssets;

      if (pushResult.pushed) {
        const snapshotCounts = collectImageAssetCountsFromSnapshot(snapshot);
        if (snapshotCounts.size > 0) {
          const adjusted = applyAssetRefCounts(
            nextRefCount,
            adjustedAssets,
            snapshotCounts,
            1
          );
          nextRefCount = adjusted.nextRefCount;
          adjustedAssets = adjusted.nextAssets;
        }

        pushResult.retained.forEach((retainedSnapshot) => {
          const parsed = parseHistorySnapshot(retainedSnapshot);
          if (!parsed) return;
          const retainedCounts = collectImageAssetCountsFromSnapshot(parsed);
          if (retainedCounts.size === 0) return;
          const adjusted = applyAssetRefCounts(
            nextRefCount,
            adjustedAssets,
            retainedCounts,
            1
          );
          nextRefCount = adjusted.nextRefCount;
          adjustedAssets = adjusted.nextAssets;
        });

        pushResult.dropped.forEach((droppedSnapshot) => {
          const parsed = parseHistorySnapshot(droppedSnapshot);
          if (!parsed) return;
          const droppedCounts = collectImageAssetCountsFromSnapshot(parsed);
          if (droppedCounts.size === 0) return;
          const adjusted = applyAssetRefCounts(
            nextRefCount,
            adjustedAssets,
            droppedCounts,
            -1
          );
          nextRefCount = adjusted.nextRefCount;
          adjustedAssets = adjusted.nextAssets;
        });
      }

      _context.setImageAssets(adjustedAssets);
      _context.setAssetRefCount(nextRefCount);
      set({
        lastHistorySnapshot: {
          objects: historyObjects,
          background: historyCanvasData.background,
          ...(canvasSize ? { canvasSize } : {}),
        },
      });

      if (pushResult.pushed) {
        _context.getDirtyObjectsRef()?.clear();
      }
    }, SAVE_STATE_DEBOUNCE_MS);

    return ({
      // Initial State
      historyIndex: -1,
      lastHistorySnapshot: null,
      historyDirty: false,
      _snapshots: [],
      _lastSnapshotAt: 0,
      _context: null,

      // --- Pure State Setters ---

      setContext: (context) => set({ _context: context }),

      setHistoryIndex: (index) => set({ historyIndex: index }),

      setLastHistorySnapshot: (snapshot) => set({ lastHistorySnapshot: snapshot }),

      markHistoryDirty: () => set({ historyDirty: true }),

      consumeHistoryDirty: () => {
        const { historyDirty } = get();
        if (historyDirty) {
          set({ historyDirty: false });
          return true;
        }
        return false;
      },

      // --- History Operations ---

      pushSnapshot: (snapshot, _options = {}) => {
        const { _snapshots, historyIndex } = get();
        const now = Date.now();

        const dropped: string[] = _snapshots.slice(historyIndex + 1);
        const retained: string[] = [];
        const trimmed = _snapshots.slice(0, historyIndex + 1);

        trimmed.push(snapshot);

        while (trimmed.length > MAX_HISTORY_SIZE) {
          // The first snapshot is the reconstruction baseline for all later
          // diffs. Before evicting it, materialize the state represented by
          // the next snapshot as a new full baseline. Otherwise the oldest
          // retained diff can no longer be replayed after history trimming.
          const first = parseHistorySnapshot(trimmed[0]);
          if (first?.type === 'full' && trimmed.length > 1) {
            const rebasedState = resolveHistoryStateAtIndex(trimmed, 1);
            if (rebasedState) {
              const previousNext = trimmed[1];
              const rebasedSnapshot = JSON.stringify({
                type: 'full',
                data: rebasedState,
              } satisfies HistorySnapshot);
              trimmed[1] = rebasedSnapshot;
              dropped.push(previousNext);
              retained.push(rebasedSnapshot);
            }
          }
          const removed = trimmed.shift();
          if (removed) dropped.push(removed);
        }

        const newIndex = trimmed.length - 1;

        set({
          _snapshots: trimmed,
          _lastSnapshotAt: now,
          historyIndex: newIndex,
        });

        return { pushed: true, dropped, retained };
      },

      getSnapshot: (index) => {
        const { _snapshots } = get();
        return _snapshots[index] ?? null;
      },

      undoSnapshot: () => {
        const { _snapshots, historyIndex } = get();
        if (historyIndex <= 0) return null;

        const newIndex = historyIndex - 1;
        set({ historyIndex: newIndex });
        return _snapshots[newIndex] ?? null;
      },

      redoSnapshot: () => {
        const { _snapshots, historyIndex } = get();
        if (historyIndex >= _snapshots.length - 1) return null;

        const newIndex = historyIndex + 1;
        set({ historyIndex: newIndex });
        return _snapshots[newIndex] ?? null;
      },

      canUndo: () => {
        const { historyIndex } = get();
        return historyIndex > 0;
      },

      canRedo: () => {
        const { _snapshots, historyIndex } = get();
        return historyIndex < _snapshots.length - 1;
      },

      resetHistory: () => {
        debouncedSaveState.cancel();
        const { _context, _snapshots } = get();
        // Snapshot asset references are owned by history, not by the canvas
        // that happens to be current when the reset occurs.  Release every
        // discarded snapshot before replacing the baseline; otherwise each
        // page/project rebaseline leaks one reference (and its blob URL).
        if (_context && _snapshots.length > 0) {
          const discardedCounts = new Map<string, number>();
          _snapshots.forEach((snapshotString) => {
            const snapshot = parseHistorySnapshot(snapshotString);
            if (!snapshot) return;
            collectImageAssetCountsFromSnapshot(snapshot).forEach((count, id) => {
              discardedCounts.set(id, (discardedCounts.get(id) ?? 0) + count);
            });
          });
          if (discardedCounts.size > 0) {
            const adjusted = applyAssetRefCounts(
              _context.getAssetRefCount(),
              _context.getImageAssets(),
              discardedCounts,
              -1,
              { preserveAsset: _context.isAssetRetained },
            );
            _context.setImageAssets(adjusted.nextAssets);
            _context.setAssetRefCount(adjusted.nextRefCount);
          }
        }
        set({
          _snapshots: [],
          historyIndex: -1,
          _lastSnapshotAt: 0,
          lastHistorySnapshot: null,
          historyDirty: false,
        });
      },

      // --- Canvas-Aware History ---

      saveState: (options) => {
        const scope = get()._context?.getScope?.() ?? null;
        debouncedSaveState(options, scope);
        if (options?.force) {
          debouncedSaveState.flush();
        }
      },

      flushPendingSave: () => {
        debouncedSaveState.flush();
      },

      cancelPendingSave: () => {
        debouncedSaveState.cancel();
      },

      takeSnapshot: () => {
        debouncedSaveState.cancel();
        const { _context } = get();
        if (!_context) return;
        const canvas = _context.getCanvas();
        if (!canvas) return;

        canvas.getObjects().filter(isPersistableCanvasObject).forEach((obj) => {
          ensureObjectId(obj, canvas);
        });

        const rawObjects = serializeCanvasObjects(canvas) as SerializedObject[];
        const background = _context.getBackground?.() ?? (canvas.backgroundColor || undefined);
        const canvasSize = normalizeHistoryCanvasSize(_context.getCanvasSize?.());
        const { canvasData: historyCanvasData, imageAssets: nextAssets } =
          prepareCanvasDataForPersistence({
            objects: rawObjects,
            background,
            ...(canvasSize ? { canvasSize } : {}),
          }, _context.getImageAssets());
        const historyObjects = (getCanvasObjects(historyCanvasData) || []) as SerializedObject[];

        const pushResult = get().pushSnapshot(
          JSON.stringify({ type: 'full', data: historyCanvasData }),
          { force: true }
        );
        let nextRefCount = _context.getAssetRefCount();
        let adjustedAssets = nextAssets;

        if (pushResult.pushed) {
          const snapshotCounts = collectImageAssetCountsFromSnapshot({ type: 'full', data: historyCanvasData });
          if (snapshotCounts.size > 0) {
            const adjusted = applyAssetRefCounts(
              nextRefCount,
              adjustedAssets,
              snapshotCounts,
              1
            );
            nextRefCount = adjusted.nextRefCount;
            adjustedAssets = adjusted.nextAssets;
          }

          pushResult.retained.forEach((retainedSnapshot) => {
            const parsed = parseHistorySnapshot(retainedSnapshot);
            if (!parsed) return;
            const retainedCounts = collectImageAssetCountsFromSnapshot(parsed);
            if (retainedCounts.size === 0) return;
            const adjusted = applyAssetRefCounts(
              nextRefCount,
              adjustedAssets,
              retainedCounts,
              1
            );
            nextRefCount = adjusted.nextRefCount;
            adjustedAssets = adjusted.nextAssets;
          });

          pushResult.dropped.forEach((droppedSnapshot) => {
            const parsed = parseHistorySnapshot(droppedSnapshot);
            if (!parsed) return;
            const droppedCounts = collectImageAssetCountsFromSnapshot(parsed);
            if (droppedCounts.size === 0) return;
            const adjusted = applyAssetRefCounts(
              nextRefCount,
              adjustedAssets,
              droppedCounts,
              -1
            );
            nextRefCount = adjusted.nextRefCount;
            adjustedAssets = adjusted.nextAssets;
          });
        }

        _context.setImageAssets(adjustedAssets);
        _context.setAssetRefCount(nextRefCount);
        set({
          lastHistorySnapshot: {
            objects: historyObjects,
            background: historyCanvasData.background,
            ...(canvasSize ? { canvasSize } : {}),
          },
        });

        if (pushResult.pushed) {
          _context.getDirtyObjectsRef()?.clear();
        }
      },

      clearHistory: () => {
        get().resetHistory();
      },

      undo: async () => {
        get().flushPendingSave();
        const { _context } = get();
        if (!_context) return false;
        const canvas = _context.getCanvas();
        if (!canvas || !get().canUndo()) return false;

        const acquired = _context.acquireSyncLock
          ? _context.acquireSyncLock('undo')
          : true;
        if (!acquired) return false;

        const replayScope = _context.getScope?.() ?? null;
        const replayLockToken = _context.getSyncLockToken?.();
        const isCurrentReplay = () => (
          get()._context === _context
          && _context.getCanvas() === canvas
          && (!_context.getScope || _context.getScope() === replayScope)
          && (!_context.isSyncLockOwned || _context.isSyncLockOwned('undo', replayLockToken))
        );

        try {
          const currentIndex = get().historyIndex;
          const targetIndex = currentIndex - 1;
          const currentSnapshotStr = get().getSnapshot(currentIndex);
          const targetSnapshotStr = get().getSnapshot(targetIndex);
          if (!currentSnapshotStr || !targetSnapshotStr) {
            return false;
          }

            const snapshot = parseHistorySnapshot(currentSnapshotStr);
            if (!snapshot) return false;

            const imageAssets = _context.getImageAssets();

            if (snapshot.type === 'full') {
            const targetState = resolveHistoryStateAtIndex(get()._snapshots, targetIndex);
            if (!targetState) return false;
            const hydratedState = hydrateCanvasDataWithAssets(targetState, imageAssets);
            const historyObjects = (getCanvasObjects(targetState) || []) as SerializedObject[];
            const loaded = _context.loadCanvasState
              ? await _context.loadCanvasState(canvas, hydratedState, reviveCustomFabricProps, isCurrentReplay)
              : (await loadCanvasFromJsonSafely(canvas, hydratedState, reviveCustomFabricProps), true);
            if (!loaded) return false;
            if (!isCurrentReplay()) return false;
            const targetCanvasSize = normalizeHistoryCanvasSize(targetState?.canvasSize);
            if (targetCanvasSize) {
              _context.setCanvasSize?.(targetCanvasSize);
            }
            if (!isCurrentReplay()) return false;
            _context.setBackground?.(typeof targetState?.background === 'string' ? targetState.background : null);
            canvas.backgroundColor = 'transparent';
            canvas.requestRenderAll();
            set({
              historyIndex: targetIndex,
              lastHistorySnapshot: {
                objects: historyObjects,
                background: targetState?.background,
                ...(targetCanvasSize ? { canvasSize: targetCanvasSize } : {}),
              },
            });
            if (_context.clearSelection) {
              _context.clearSelection();
            } else {
              _context.setSelectedObjectId(null);
            }
            _context.syncCanvasToStore?.();
            _context.requestLayerSync();
            return true;
          }

          if (snapshot.type === 'diff') {
            const diff = snapshot.data;
            const reviveObjects = _context.reviveObjects ?? fabric.util.enlivenObjects;
            const removedObjects = await reviveObjects(
              hydrateSerializedObjectsWithAssets(diff.removed, imageAssets)
                .map(normalizeSerializedObjectForFabric)
            ) as fabric.Object[];
            if (!isCurrentReplay()) {
              disposeRevivedObjects(removedObjects);
              return false;
            }

            diff.added.forEach((objToAdd) => {
              const objToRemove = canvas.getObjects().find((o) => (o as any).id === objToAdd.id);
              if (objToRemove) canvas.remove(objToRemove);
            });
            removedObjects.forEach((obj) => canvas.add(obj));

            for (const patch of diff.changed) {
              if (!isCurrentReplay()) return false;
              const targetObj = canvas.getObjects().find((o) => (o as any).id === patch.id);
              if (targetObj) {
                const applied = await applyObjectPatch(
                  targetObj,
                  patch.prev,
                  imageAssets,
                  patch.unsetPrev,
                  isCurrentReplay,
                );
                if (!applied || !isCurrentReplay()) return false;
              }
            }

            if (!isCurrentReplay()) return false;

            reorderCanvasObjects(canvas, diff.order?.before);

            const rawObjects = serializeCanvasObjects(canvas) as SerializedObject[];
            const background = _context.getBackground?.() ?? (canvas.backgroundColor || undefined);
            const canvasSize = normalizeHistoryCanvasSize(_context.getCanvasSize?.());
            const { canvasData: historyCanvasData, imageAssets: nextAssets } =
              prepareCanvasDataForPersistence({
                objects: rawObjects,
                background,
                ...(canvasSize ? { canvasSize } : {}),
              }, imageAssets);
            const historyObjects = (getCanvasObjects(historyCanvasData) || []) as SerializedObject[];
            set({
              historyIndex: targetIndex,
              lastHistorySnapshot: {
                objects: historyObjects,
                background: historyCanvasData.background,
                ...(canvasSize ? { canvasSize } : {}),
              },
            });
            _context.setImageAssets(nextAssets);
            if (_context.clearSelection) {
              _context.clearSelection();
            } else {
              _context.setSelectedObjectId(null);
            }
            _context.syncCanvasToStore?.();
            _context.requestLayerSync();
            canvas.requestRenderAll();
            return true;
          }
          return false;
        } finally {
          _context.releaseSyncLock?.('undo', replayLockToken);
        }
      },

      redo: async () => {
        get().flushPendingSave();
        const { _context } = get();
        if (!_context) return false;
        const canvas = _context.getCanvas();
        if (!canvas || !get().canRedo()) return false;

        const acquired = _context.acquireSyncLock
          ? _context.acquireSyncLock('redo')
          : true;
        if (!acquired) return false;

        const replayScope = _context.getScope?.() ?? null;
        const replayLockToken = _context.getSyncLockToken?.();
        const isCurrentReplay = () => (
          get()._context === _context
          && _context.getCanvas() === canvas
          && (!_context.getScope || _context.getScope() === replayScope)
          && (!_context.isSyncLockOwned || _context.isSyncLockOwned('redo', replayLockToken))
        );

        try {
          const targetIndex = get().historyIndex + 1;
          const snapshotStr = get().getSnapshot(targetIndex);
          if (!snapshotStr) {
            return false;
          }

          const snapshot = parseHistorySnapshot(snapshotStr);
          if (!snapshot) return false;

          const imageAssets = _context.getImageAssets();

          if (snapshot.type === 'full') {
            const hydratedState = hydrateCanvasDataWithAssets(snapshot.data, imageAssets);
            const historyObjects = (getCanvasObjects(snapshot.data) || []) as SerializedObject[];
            const loaded = _context.loadCanvasState
              ? await _context.loadCanvasState(canvas, hydratedState, reviveCustomFabricProps, isCurrentReplay)
              : (await loadCanvasFromJsonSafely(canvas, hydratedState, reviveCustomFabricProps), true);
            if (!loaded) return false;
            if (!isCurrentReplay()) return false;
            const targetCanvasSize = normalizeHistoryCanvasSize(snapshot.data?.canvasSize);
            if (targetCanvasSize) {
              _context.setCanvasSize?.(targetCanvasSize);
            }
            if (!isCurrentReplay()) return false;
            _context.setBackground?.(typeof snapshot.data?.background === 'string' ? snapshot.data.background : null);
            canvas.backgroundColor = 'transparent';
            canvas.requestRenderAll();
            set({
              historyIndex: targetIndex,
              lastHistorySnapshot: {
                objects: historyObjects,
                background: snapshot.data?.background,
                ...(targetCanvasSize ? { canvasSize: targetCanvasSize } : {}),
              },
            });
            if (_context.clearSelection) {
              _context.clearSelection();
            } else {
              _context.setSelectedObjectId(null);
            }
            _context.syncCanvasToStore?.();
            _context.requestLayerSync();
            return true;
          }

          if (snapshot.type === 'diff') {
            const diff = snapshot.data;

            const reviveObjects = _context.reviveObjects ?? fabric.util.enlivenObjects;
            const addedObjects = await reviveObjects(
              hydrateSerializedObjectsWithAssets(diff.added, imageAssets)
                .map(normalizeSerializedObjectForFabric)
            ) as fabric.Object[];
            if (!isCurrentReplay()) {
              disposeRevivedObjects(addedObjects);
              return false;
            }
            addedObjects.forEach((obj) => canvas.add(obj));

            diff.removed.forEach((objToRemove) => {
              const obj = canvas.getObjects().find((o) => (o as any).id === objToRemove.id);
              if (obj) canvas.remove(obj);
            });

            for (const patch of diff.changed) {
              if (!isCurrentReplay()) return false;
              const targetObj = canvas.getObjects().find((o) => (o as any).id === patch.id);
              if (targetObj) {
                const applied = await applyObjectPatch(
                  targetObj,
                  patch.next,
                  imageAssets,
                  patch.unsetNext,
                  isCurrentReplay,
                );
                if (!applied || !isCurrentReplay()) return false;
              }
            }

            if (!isCurrentReplay()) return false;

            reorderCanvasObjects(canvas, diff.order?.after);

            const rawObjects = serializeCanvasObjects(canvas) as SerializedObject[];
            const background = _context.getBackground?.() ?? (canvas.backgroundColor || undefined);
            const canvasSize = normalizeHistoryCanvasSize(_context.getCanvasSize?.());
            const { canvasData: historyCanvasData, imageAssets: nextAssets } =
              prepareCanvasDataForPersistence({
                objects: rawObjects,
                background,
                ...(canvasSize ? { canvasSize } : {}),
              }, imageAssets);
            const historyObjects = (getCanvasObjects(historyCanvasData) || []) as SerializedObject[];
            set({
              historyIndex: targetIndex,
              lastHistorySnapshot: {
                objects: historyObjects,
                background: historyCanvasData.background,
                ...(canvasSize ? { canvasSize } : {}),
              },
            });
            _context.setImageAssets(nextAssets);
            if (_context.clearSelection) {
              _context.clearSelection();
            } else {
              _context.setSelectedObjectId(null);
            }
            _context.syncCanvasToStore?.();
            _context.requestLayerSync();
            canvas.requestRenderAll();
            return true;
          }
          return false;
        } finally {
          _context.releaseSyncLock?.('redo', replayLockToken);
        }
      },

      historyLength: () => {
        return get()._snapshots.length;
      },
    });
  }
);

// --- SELECTOR HOOKS ---
export const useHistoryIndex = () => useHistoryStore((state) => state.historyIndex);
export const useCanUndo = () => useHistoryStore((state) => state.canUndo());
export const useCanRedo = () => useHistoryStore((state) => state.canRedo());
