import * as fabric from 'fabric';
import { reviveCustomFabricProps } from '../fabric/initFabricCanvas';
import { enforceSerializedZOrder, enforceZOrder } from '../fabric/zIndexManifest';
import { isUserObject } from '../utils/objectUtils';
import { toSerializableObject } from '../utils/serialization';
import type { SerializedFabricObject } from './editorStore';

type LayerSyncOptions = {
  selectedObjectId?: string | null;
};

type LayerSyncResult = {
  layersById: Record<string, fabric.Object>;
  changed: boolean;
};

const isStoreManagedObject = (obj: fabric.Object) => {
  return isUserObject(obj) && !(obj as any).excludeFromSync;
};

const serializeForComparison = (obj: fabric.Object) => {
  const serialized = toSerializableObject(obj) as SerializedFabricObject;
  const { version: _version, ...rest } = serialized;
  return JSON.stringify(rest);
};

const serializeDesiredForComparison = (obj: SerializedFabricObject) => {
  const { version: _version, ...rest } = obj;
  return JSON.stringify(rest);
};

const enlivenObject = async (serialized: SerializedFabricObject) => {
  const objects = await fabric.util.enlivenObjects([serialized as any]) as fabric.Object[];
  const obj = objects[0];
  if (obj) {
    reviveCustomFabricProps(serialized as any, obj as any);
  }
  return obj ?? null;
};

export const syncCanvasLayers = async (
  canvasObjects: SerializedFabricObject[],
  canvas: fabric.Canvas,
  options: LayerSyncOptions = {}
): Promise<LayerSyncResult> => {
  const desiredObjects = enforceSerializedZOrder(
    canvasObjects.filter((obj) => isUserObject(obj) && !(obj as any).excludeFromSync)
  );
  const currentObjects = canvas.getObjects().filter(isStoreManagedObject);
  const currentById = new Map<string, fabric.Object>();
  let changed = false;

  currentObjects.forEach((obj) => {
    const id = (obj as any).id;
    if (typeof id === 'string' && id.length > 0) {
      currentById.set(id, obj);
    }
  });

  const desiredIds = new Set<string>();
  for (const desired of desiredObjects) {
    if (!desired.id) continue;
    desiredIds.add(desired.id);
  }

  for (const current of currentObjects) {
    const currentId = (current as any).id;
    if (typeof currentId === 'string' && currentId.length > 0 && !desiredIds.has(currentId)) {
      canvas.remove(current);
      changed = true;
    }
  }

  for (const desired of desiredObjects) {
    if (!desired.id) continue;
    const existing = currentById.get(desired.id);
    if (!existing) {
      const nextObject = await enlivenObject(desired);
      if (nextObject) {
        canvas.add(nextObject);
        changed = true;
      }
      continue;
    }

    if (existing.type !== desired.type || serializeForComparison(existing) !== serializeDesiredForComparison(desired)) {
      const replacement = await enlivenObject(desired);
      if (replacement) {
        canvas.remove(existing);
        canvas.add(replacement);
        currentById.set(desired.id, replacement);
        changed = true;
      }
    }
  }

  enforceZOrder(canvas);

  const syncedManagedObjects = canvas.getObjects().filter(isStoreManagedObject);
  const layersById: Record<string, fabric.Object> = {};
  syncedManagedObjects.forEach((obj) => {
    const id = (obj as any).id;
    if (typeof id === 'string' && id.length > 0) {
      layersById[id] = obj;
    }
  });

  if (options.selectedObjectId) {
    const activeObject = layersById[options.selectedObjectId];
    if (activeObject && canvas.getActiveObject() !== activeObject) {
      canvas.setActiveObject(activeObject);
      changed = true;
    }
  }

  if (changed) {
    canvas.requestRenderAll();
  }

  return { layersById, changed };
};
