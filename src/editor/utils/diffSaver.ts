import * as fabric from 'fabric';

// A simplified representation of what toSerializableObject produces.
export type SerializedObject = fabric.Object & {
  id: string;
};

export type ObjectDiff = {
  added: SerializedObject[];
  removed: SerializedObject[];
  changed: { prev: SerializedObject; next: SerializedObject }[];
};

export function recordDiff(
  prevObjects: SerializedObject[],
  nextObjects: SerializedObject[],
): ObjectDiff {
  const prevMap = new Map(prevObjects.map((obj) => [obj.id, obj]));
  const nextMap = new Map(nextObjects.map((obj) => [obj.id, obj]));

  const added: SerializedObject[] = [];
  const removed: SerializedObject[] = [];
  const changed: { prev: SerializedObject; next: SerializedObject }[] = [];

  for (const [id, nextObj] of nextMap.entries()) {
    const prevObj = prevMap.get(id);
    if (!prevObj) {
      added.push(nextObj);
    } else {
      if (JSON.stringify(prevObj) !== JSON.stringify(nextObj)) {
        changed.push({ prev: prevObj, next: nextObj });
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
