import { createWithEqualityFn } from 'zustand/traditional';
import { debounce } from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import * as fabric from 'fabric';
import { assetBlobRegistry, revokeTrackedBlobUrl } from '../services/assetLoader';
import { ensureObjectId, reviveCustomFabricProps } from '../fabric/initFabricCanvas';
import { toSerializableObject } from '../utils/serialization';
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

type HistorySyncReason = 'undo' | 'redo';

type HistoryContext = {
  getCanvas: () => fabric.Canvas | null;
  getImageAssets: () => Record<string, string>;
  setImageAssets: (assets: Record<string, string>) => void;
  getAssetRefCount: () => Map<string, number>;
  setAssetRefCount: (counts: Map<string, number>) => void;
  getDirtyObjectsRef: () => Set<string> | null;
  requestLayerSync: () => void;
  syncCanvasToStore?: () => void;
  setSelectedObjectId: (id: string | null) => void;
  clearSelection?: () => void;
  getBackground?: () => string | undefined;
  setBackground?: (background: string | null) => void;
  acquireSyncLock?: (reason: HistorySyncReason) => void;
  releaseSyncLock?: () => void;
};

export interface HistoryState {
  // Pure History State
  historyIndex: number;
  lastHistorySnapshot: { objects: SerializedObject[]; background?: string } | null;
  historyDirty: boolean;

  // Internal history storage
  _snapshots: string[];
  _lastSnapshotAt: number;
  _context: HistoryContext | null;

  // Actions - Pure State Management
  setContext: (context: HistoryContext) => void;
  setHistoryIndex: (index: number) => void;
  setLastHistorySnapshot: (snapshot: { objects: SerializedObject[]; background?: string } | null) => void;
  markHistoryDirty: () => void;
  consumeHistoryDirty: () => boolean;

  // Actions - History Operations
  pushSnapshot: (snapshot: string, options?: { force?: boolean }) => { pushed: boolean; dropped: string[] };
  getSnapshot: (index: number) => string | null;
  undoSnapshot: () => string | null;
  redoSnapshot: () => string | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  resetHistory: () => void;

  // Actions - Canvas-Aware History
  saveState: (options?: { force?: boolean }) => void;
  takeSnapshot: () => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  clearHistory: () => void;

  // Computed
  historyLength: () => number;
}

const isDataUrl = (value: string) => value.startsWith('data:');
const isLikelyUrl = (value: string) =>
  value.startsWith('blob:')
  || value.startsWith('data:')
  || value.startsWith('http://')
  || value.startsWith('https://');

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

export const prepareCanvasDataForPersistence = (
  canvasData: any,
  imageAssets: Record<string, string>
) => {
  const objects = getCanvasObjects(canvasData);
  if (!Array.isArray(objects)) {
    return { canvasData, imageAssets };
  }
  let nextAssets = imageAssets;
  const nextObjects = objects.map((obj: any) => {
    if (!obj || obj.type !== 'image') return obj;
    const id = typeof obj.id === 'string' && obj.id.trim().length > 0 ? obj.id : uuidv4();
    const src = typeof obj.src === 'string' ? obj.src : '';
    let assetUrl = nextAssets[id];
    if (assetUrl && isDataUrl(assetUrl)) {
      const objectUrl = createObjectUrlFromDataUrl(assetUrl, id);
      nextAssets = { ...nextAssets, [id]: objectUrl };
      assetUrl = objectUrl;
    }
    if (!assetUrl && src) {
      if (src.startsWith('blob:')) {
        nextAssets = { ...nextAssets, [id]: src };
        assetUrl = src;
      } else if (isDataUrl(src)) {
        const objectUrl = createObjectUrlFromDataUrl(src, id);
        nextAssets = { ...nextAssets, [id]: objectUrl };
        assetUrl = objectUrl;
      }
    }
    if (assetUrl) {
      return { ...obj, id, src: id };
    }
    if (id !== obj.id) {
      return { ...obj, id };
    }
    return obj;
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
    objects: objects.map((obj: any) => {
      if (!obj || obj.type !== 'image') return obj;
      const id = typeof obj.id === 'string' ? obj.id : '';
      const assetUrl = id ? imageAssets[id] : '';
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

const collectImageAssetCounts = (objects: SerializedObject[]) => {
  const counts = new Map<string, number>();
  objects.forEach((obj) => {
    if (!obj || obj.type !== 'image') return;
    const id = typeof obj.id === 'string' && obj.id.trim().length > 0 ? obj.id : '';
    if (!id) return;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  });
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
    const prevSrc = (patch.prev as any)?.src;
    const nextSrc = (patch.next as any)?.src;
    if (typeof prevSrc === 'string' && !isLikelyUrl(prevSrc)) {
      counts.set(prevSrc, (counts.get(prevSrc) ?? 0) + 1);
    }
    if (typeof nextSrc === 'string' && !isLikelyUrl(nextSrc)) {
      counts.set(nextSrc, (counts.get(nextSrc) ?? 0) + 1);
    }
  });

  return counts;
};

export const applyAssetRefCounts = (
  assetRefCount: Map<string, number>,
  imageAssets: Record<string, string>,
  counts: Map<string, number>,
  delta: 1 | -1
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
) => objects.map((obj) => {
  if (!obj || obj.type !== 'image') return obj;
  const id = typeof obj.id === 'string' ? obj.id : '';
  const assetUrl = id ? imageAssets[id] : '';
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
  imageAssets: Record<string, string>
) => {
  if (!patch || Object.keys(patch).length === 0) return;
  const resolvedPatch = resolveImagePatchSrc(patch, imageAssets);

  const resolvedSrc = (resolvedPatch as any).src;
  if (object.type === 'image' && typeof resolvedSrc === 'string') {
    const image = object as fabric.Image;
    const nextSrc = resolvedSrc;
    const remainingPatch = { ...resolvedPatch };
    delete (remainingPatch as any).src;

    if (typeof (image as any).setSrc === 'function') {
      await new Promise<void>((resolve) => {
        const setSrcResult = (image as any).setSrc(
          nextSrc,
          () => resolve(),
          { crossOrigin: 'anonymous' }
        );
        if (setSrcResult && typeof setSrcResult.then === 'function') {
          setSrcResult.then(() => resolve()).catch(() => resolve());
        }
      });
    } else {
      (image as any).src = nextSrc;
    }

    if (Object.keys(remainingPatch).length > 0) {
      image.set(remainingPatch as any);
    }
    image.setCoords();
    return;
  }

  object.set(resolvedPatch as any);
  object.setCoords();
};

// --- ZUSTAND STORE IMPLEMENTATION ---
export const useHistoryStore = createWithEqualityFn<HistoryState>()(
  (set, get) => {
    const debouncedSaveState = debounce((options?: { force?: boolean }) => {
      const { _context, lastHistorySnapshot, historyLength } = get();
      if (!_context) return;
      const canvas = _context.getCanvas();
      if (!canvas) return;

      // Clear dirty flag
      get().consumeHistoryDirty();

      canvas.getObjects().filter(isPersistableCanvasObject).forEach((obj) => {
        ensureObjectId(obj, canvas);
      });

      const rawObjects = canvas.getObjects().filter(isPersistableCanvasObject).map(toSerializableObject) as SerializedObject[];
      const background = _context.getBackground?.() ?? (canvas.backgroundColor || undefined);
      const { canvasData: historyCanvasData, imageAssets: nextAssets } =
        prepareCanvasDataForPersistence({ objects: rawObjects, background }, _context.getImageAssets());
      const historyObjects = (getCanvasObjects(historyCanvasData) || []) as SerializedObject[];

      let snapshot: HistorySnapshot;
      if (!lastHistorySnapshot || historyLength() === 0) {
        snapshot = { type: 'full', data: historyCanvasData };
      } else {
        const diff = recordDiff(lastHistorySnapshot.objects, historyObjects, _context.getDirtyObjectsRef());
        const backgroundChanged = lastHistorySnapshot.background !== historyCanvasData.background;
        if (
          diff.added.length === 0
          && diff.removed.length === 0
          && diff.changed.length === 0
          && !backgroundChanged
        ) {
          return;
        }
        snapshot = backgroundChanged
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
      set({ lastHistorySnapshot: { objects: historyObjects, background: historyCanvasData.background } });

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
        const trimmed = _snapshots.slice(0, historyIndex + 1);

        trimmed.push(snapshot);

        while (trimmed.length > MAX_HISTORY_SIZE) {
          const removed = trimmed.shift();
          if (removed) dropped.push(removed);
        }

        const newIndex = trimmed.length - 1;

        set({
          _snapshots: trimmed,
          _lastSnapshotAt: now,
          historyIndex: newIndex,
        });

        return { pushed: true, dropped };
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
        debouncedSaveState(options);
      },

      takeSnapshot: () => {
        const { _context } = get();
        if (!_context) return;
        const canvas = _context.getCanvas();
        if (!canvas) return;

        canvas.getObjects().filter(isPersistableCanvasObject).forEach((obj) => {
          ensureObjectId(obj, canvas);
        });

        const rawObjects = canvas.getObjects().filter(isPersistableCanvasObject).map(toSerializableObject) as SerializedObject[];
        const background = _context.getBackground?.() ?? (canvas.backgroundColor || undefined);
        const { canvasData: historyCanvasData, imageAssets: nextAssets } =
          prepareCanvasDataForPersistence({ objects: rawObjects, background }, _context.getImageAssets());
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
          lastHistorySnapshot: { objects: historyObjects, background: historyCanvasData.background },
        });

        if (pushResult.pushed) {
          _context.getDirtyObjectsRef()?.clear();
        }
      },

      clearHistory: () => {
        get().resetHistory();
      },

      undo: async () => {
        const { _context } = get();
        if (!_context) return;
        const canvas = _context.getCanvas();
        if (!canvas || !get().canUndo()) return;

        _context.acquireSyncLock?.('undo');

        try {
          const currentSnapshotStr = get().getSnapshot(get().historyIndex);
          const targetSnapshotStr = get().undoSnapshot();
          if (!currentSnapshotStr || !targetSnapshotStr) {
            return;
          }

          const snapshot = parseHistorySnapshot(currentSnapshotStr);
          if (!snapshot) return;

          const imageAssets = _context.getImageAssets();

          if (snapshot.type === 'full') {
            const targetSnapshot = parseHistorySnapshot(targetSnapshotStr);
            if (!targetSnapshot || targetSnapshot.type !== 'full') return;
            const hydratedState = hydrateCanvasDataWithAssets(targetSnapshot.data, imageAssets);
            const historyObjects = (getCanvasObjects(targetSnapshot.data) || []) as SerializedObject[];
            await canvas.loadFromJSON(hydratedState, reviveCustomFabricProps);
            _context.setBackground?.(typeof targetSnapshot.data?.background === 'string' ? targetSnapshot.data.background : null);
            canvas.backgroundColor = 'transparent';
            canvas.requestRenderAll();
            set({
              lastHistorySnapshot: {
                objects: historyObjects,
                background: targetSnapshot.data?.background,
              },
            });
            if (_context.clearSelection) {
              _context.clearSelection();
            } else {
              _context.setSelectedObjectId(null);
            }
            _context.syncCanvasToStore?.();
            _context.requestLayerSync();
            return;
          }

          if (snapshot.type === 'diff') {
            const diff = snapshot.data;

            diff.added.forEach((objToAdd) => {
              const objToRemove = canvas.getObjects().find((o) => (o as any).id === objToAdd.id);
              if (objToRemove) canvas.remove(objToRemove);
            });

            const removedObjects = await fabric.util.enlivenObjects(
              hydrateSerializedObjectsWithAssets(diff.removed, imageAssets)
            ) as fabric.Object[];
            removedObjects.forEach((obj) => canvas.add(obj));

            for (const patch of diff.changed) {
              const targetObj = canvas.getObjects().find((o) => (o as any).id === patch.id);
              if (targetObj) {
                await applyObjectPatch(targetObj, patch.prev, imageAssets);
              }
            }

            const rawObjects = canvas.getObjects().filter(isPersistableCanvasObject).map(toSerializableObject) as SerializedObject[];
            const background = _context.getBackground?.() ?? (canvas.backgroundColor || undefined);
            const { canvasData: historyCanvasData, imageAssets: nextAssets } =
              prepareCanvasDataForPersistence({ objects: rawObjects, background }, imageAssets);
            const historyObjects = (getCanvasObjects(historyCanvasData) || []) as SerializedObject[];
            set({
              lastHistorySnapshot: { objects: historyObjects, background: historyCanvasData.background },
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
          }
        } finally {
          _context.releaseSyncLock?.();
        }
      },

      redo: async () => {
        const { _context } = get();
        if (!_context) return;
        const canvas = _context.getCanvas();
        if (!canvas || !get().canRedo()) return;

        _context.acquireSyncLock?.('redo');

        try {
          const snapshotStr = get().redoSnapshot();
          if (!snapshotStr) {
            return;
          }

          const snapshot = parseHistorySnapshot(snapshotStr);
          if (!snapshot) return;

          const imageAssets = _context.getImageAssets();

          if (snapshot.type === 'full') {
            const hydratedState = hydrateCanvasDataWithAssets(snapshot.data, imageAssets);
            const historyObjects = (getCanvasObjects(snapshot.data) || []) as SerializedObject[];
            await canvas.loadFromJSON(hydratedState, reviveCustomFabricProps);
            _context.setBackground?.(typeof snapshot.data?.background === 'string' ? snapshot.data.background : null);
            canvas.backgroundColor = 'transparent';
            canvas.requestRenderAll();
            set({
              lastHistorySnapshot: {
                objects: historyObjects,
                background: snapshot.data?.background,
              },
            });
            if (_context.clearSelection) {
              _context.clearSelection();
            } else {
              _context.setSelectedObjectId(null);
            }
            _context.syncCanvasToStore?.();
            _context.requestLayerSync();
            return;
          }

          if (snapshot.type === 'diff') {
            const diff = snapshot.data;

            const addedObjects = await fabric.util.enlivenObjects(
              hydrateSerializedObjectsWithAssets(diff.added, imageAssets)
            ) as fabric.Object[];
            addedObjects.forEach((obj) => canvas.add(obj));

            diff.removed.forEach((objToRemove) => {
              const obj = canvas.getObjects().find((o) => (o as any).id === objToRemove.id);
              if (obj) canvas.remove(obj);
            });

            for (const patch of diff.changed) {
              const targetObj = canvas.getObjects().find((o) => (o as any).id === patch.id);
              if (targetObj) {
                await applyObjectPatch(targetObj, patch.next, imageAssets);
              }
            }

            const rawObjects = canvas.getObjects().filter(isPersistableCanvasObject).map(toSerializableObject) as SerializedObject[];
            const background = _context.getBackground?.() ?? (canvas.backgroundColor || undefined);
            const { canvasData: historyCanvasData, imageAssets: nextAssets } =
              prepareCanvasDataForPersistence({ objects: rawObjects, background }, imageAssets);
            const historyObjects = (getCanvasObjects(historyCanvasData) || []) as SerializedObject[];
            set({
              lastHistorySnapshot: { objects: historyObjects, background: historyCanvasData.background },
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
          }
        } finally {
          _context.releaseSyncLock?.();
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
