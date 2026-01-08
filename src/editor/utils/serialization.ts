import * as fabric from 'fabric';

const CUSTOM_PROPS = ['id', 'tokenRole', 'colorLocked', 'isPlaceholder'] as const;

export const toSerializableObject = (obj: fabric.Object) => {
  const base = obj.toObject([...CUSTOM_PROPS]);
  const target = obj as any;
  return {
    ...base,
    id: target.id ?? null,
    tokenRole: target.tokenRole ?? null,
    colorLocked: target.colorLocked ?? false,
    isPlaceholder: target.isPlaceholder ?? false,
  };
};
