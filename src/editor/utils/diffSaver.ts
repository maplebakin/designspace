import * as fabric from 'fabric';

// A simplified representation of what toSerializableObject produces.
export type SerializedObject = fabric.Object & {
  id: string;
};

export type ObjectPatch = {
  id: string;
  prev: Partial<SerializedObject>;
  next: Partial<SerializedObject>;
};

export type ObjectDiff = {
  added: SerializedObject[];
  removed: SerializedObject[];
  changed: ObjectPatch[];
};

const valuesEqual = (a: unknown, b: unknown) => {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
};

const buildPatch = (prevObj: SerializedObject, nextObj: SerializedObject): ObjectPatch | null => {
  const prevPatch: Partial<SerializedObject> = {};
  const nextPatch: Partial<SerializedObject> = {};
  const keys = new Set<string>([
    ...Object.keys(prevObj),
    ...Object.keys(nextObj),
  ]);

  keys.forEach((key) => {
    if (key === 'id') return;
    const prevValue = (prevObj as any)[key];
    const nextValue = (nextObj as any)[key];
    if (!valuesEqual(prevValue, nextValue)) {
      (prevPatch as any)[key] = prevValue;
      (nextPatch as any)[key] = nextValue;
    }
  });

  if (Object.keys(prevPatch).length === 0 && Object.keys(nextPatch).length === 0) {
    return null;
  }

  return {
    id: prevObj.id,
    prev: prevPatch,
    next: nextPatch,
  };
};

export function recordDiff(
  prevObjects: SerializedObject[],
  nextObjects: SerializedObject[],
  dirtyIds?: Set<string> | null,
): ObjectDiff {
  const shouldFilterDirty = !!dirtyIds && dirtyIds.size > 0;
  const prevMap = new Map(prevObjects.map((obj) => [obj.id, obj]));
  const nextMap = new Map(nextObjects.map((obj) => [obj.id, obj]));

  const added: SerializedObject[] = [];
  const removed: SerializedObject[] = [];
  const changed: ObjectPatch[] = [];

  for (const [id, nextObj] of nextMap.entries()) {
    const prevObj = prevMap.get(id);
    if (!prevObj) {
      added.push(nextObj);
    } else {
      if (shouldFilterDirty && !dirtyIds!.has(id)) {
        continue;
      }
      if (JSON.stringify(prevObj) !== JSON.stringify(nextObj)) {
        const patch = buildPatch(prevObj, nextObj);
        if (patch) {
          changed.push(patch);
        }
      }
    }
  }

  for (const [id, prevObj] of prevMap.entries()) {
    if (!nextMap.has(id)) {
      removed.push(prevObj);
    }
  }

  return { added, removed, changed };
}
