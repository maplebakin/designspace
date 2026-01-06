import * as fabric from 'fabric';

export const FABRIC_SERIALIZATION_PROPS = ['id', 'tokenRole', 'colorLocked', 'isPlaceholder'];

let serializationInitialized = false;

export const initFabricSerialization = () => {
  if (serializationInitialized) return;
  serializationInitialized = true;

  fabric.Object.ownDefaults.includeDefaultValues = false;

  const proto = fabric.Object.prototype as fabric.Object & {
    __customSerializationApplied?: boolean;
    toObject: (propertiesToInclude?: string[]) => Record<string, unknown>;
  };

  if (proto.__customSerializationApplied) return;
  proto.__customSerializationApplied = true;

  const originalToObject = proto.toObject;
  proto.toObject = function (propertiesToInclude?: string[]) {
    const base = originalToObject.call(this, propertiesToInclude);
    return {
      ...base,
      id: (this as any).id ?? null,
      tokenRole: (this as any).tokenRole ?? null,
      colorLocked: (this as any).colorLocked ?? false,
      isPlaceholder: (this as any).isPlaceholder ?? false,
    };
  };

  const existing = (fabric.Object as any).customProperties || [];
  (fabric.Object as any).customProperties = Array.from(
    new Set([...existing, ...FABRIC_SERIALIZATION_PROPS])
  );
};

export const reviveCustomFabricProps = (
  serialized: Record<string, any>,
  instance:
    | fabric.Object
    | fabric.Filter
    | fabric.Shadow
    | fabric.Gradient<'linear' | 'radial'>
    | fabric.Pattern
) => {
  if (!(instance instanceof fabric.Object)) return;
  const target = instance as any;
  if (target.id == null) target.id = serialized?.id ?? null;
  if (target.tokenRole === undefined) target.tokenRole = serialized?.tokenRole ?? null;
  if (target.colorLocked === undefined) target.colorLocked = serialized?.colorLocked ?? false;
  if (target.isPlaceholder === undefined) target.isPlaceholder = serialized?.isPlaceholder ?? false;
};
