import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import { useEditorStore } from '../state/editorStore';
import { isActiveSelection } from '../utils/typeGuards';
import { isUserObject } from '../utils/objectUtils';
import {
  normalizeSerializedObjectForFabric,
  serializeCanvasObjects,
  toSerializableObject,
} from '../utils/serialization';
import { reviveCustomFabricProps } from '../fabric/initFabricCanvas';
import { attachTextboxAutoFitHandlers } from './textboxDrawingService';
import { withCanvasObjectMutationSuppressed } from './canvasMutationObservation';

/**
 * Clipboard Service
 *
 * Handles copy, paste, and duplicate operations for canvas objects.
 * Maintains an internal clipboard buffer for object data.
 */

// Clipboard buffer - stores serialized object data
let clipboardBuffer: any[] | null = null;

// Paste offset to prevent perfect overlapping
const PASTE_OFFSET = 20;
type SingleObjectZOrderAction =
  | 'move-freeform-forward'
  | 'move-freeform-backward'
  | 'bring-freeform-to-front'
  | 'send-freeform-to-back';

const getUserObjectOrder = (canvas: fabric.Canvas) => canvas.getObjects()
  .filter(isUserObject)
  .map((object) => (object as any).id)
  .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

const areObjectIdListsEqual = (
  first: readonly string[],
  second: readonly string[]
) => first.length === second.length && first.every((id, index) => id === second[index]);

/**
 * Copies the currently selected object(s) to the clipboard buffer
 */
export const copySelection = async (): Promise<boolean> => {
  const { canvas } = useEditorStore.getState();
  if (!canvas) return false;

  const activeObject = canvas.getActiveObject();
  if (!activeObject) return false;

  try {
    if (isActiveSelection(activeObject)) {
      const selection = activeObject as fabric.ActiveSelection;
      const selectedObjects = new Set(selection.getObjects());
      // The canvas-level scene serializer realizes an ActiveSelection's
      // matrix for each child.  Serializing children through clone()/toObject
      // alone leaves them in selection-local coordinates.
      clipboardBuffer = serializeCanvasObjects(
        canvas,
        (object) => selectedObjects.has(object),
      ).map((serialized: any) => {
        if (serialized.type?.toLowerCase() !== 'image') return serialized;
        const assetId = typeof serialized.assetId === 'string' && serialized.assetId.trim()
          ? serialized.assetId
          : (typeof serialized.id === 'string' ? serialized.id : undefined);
        return assetId ? { ...serialized, assetId } : serialized;
      });
    } else {
      const serialized = toSerializableObject(activeObject);
      if (serialized?.type?.toLowerCase() === 'image') {
        const assetId = typeof serialized.assetId === 'string' && serialized.assetId.trim()
          ? serialized.assetId
          : (typeof serialized.id === 'string' ? serialized.id : undefined);
        clipboardBuffer = [assetId ? { ...serialized, assetId } : serialized];
      } else {
        clipboardBuffer = [serialized];
      }
    }

    return true;
  } catch (error) {
    console.error('[ClipboardService] Copy failed:', error);
    return false;
  }
};

/**
 * Pastes objects from the clipboard buffer onto the canvas
 */
export const pasteFromClipboard = async (): Promise<boolean> => {
  const { canvas, requestLayerSync, saveState, selectObjectById, selectObjectsByIds, syncCanvasToStore } = useEditorStore.getState();
  if (!canvas || !clipboardBuffer || clipboardBuffer.length === 0) return false;

  try {
    const pastedObjects: fabric.Object[] = [];
    const usedIds = collectCanvasObjectIds(canvas);

    for (const objectData of clipboardBuffer) {
      // Create object from serialized data
      const obj = await createObjectFromData(objectData);
      if (!obj) continue;

      // Every pasted object tree receives fresh runtime identity.  Asset
      // identity is deliberately separate for images so two objects can
      // reference one durable byte payload without duplicating it.
      assignFreshObjectTreeIds(obj, usedIds);
      obj.set({
        left: (obj.left || 0) + PASTE_OFFSET,
        top: (obj.top || 0) + PASTE_OFFSET,
      });
      obj.setCoords();

      if (
        obj.type === 'textbox' &&
        typeof (obj as any).__fixedWidth === 'number' &&
        typeof (obj as any).__fixedHeight === 'number'
      ) {
        attachTextboxAutoFitHandlers(obj as fabric.Textbox, canvas);
      }

      pastedObjects.push(obj);
    }

    withCanvasObjectMutationSuppressed(canvas, () => {
      pastedObjects.forEach((object) => canvas.add(object));
    });

    // Select the pasted objects
    if (pastedObjects.length === 1) {
      selectObjectById((pastedObjects[0] as any).id);
    } else if (pastedObjects.length > 1) {
      selectObjectsByIds(pastedObjects.map((obj) => (obj as any).id));
    }

    canvas.requestRenderAll();
    syncCanvasToStore(canvas);
    requestLayerSync();
    saveState();

    useEditorStore.getState().reportCommittedCanvasObjectBatch(
      pastedObjects.map((object) => String((object as any).id)),
      pastedObjects.some((object) => object.type === 'image')
        ? 'unknown-engine-owned'
        : 'none'
    );

    // Update clipboard buffer with new positions for subsequent pastes
    clipboardBuffer = clipboardBuffer.map((data) => ({
      ...data,
      left: (data.left || 0) + PASTE_OFFSET,
      top: (data.top || 0) + PASTE_OFFSET,
    }));

    return true;
  } catch (error) {
    console.error('[ClipboardService] Paste failed:', error);
    return false;
  }
};

/**
 * Duplicates the currently selected object(s) in place
 * (Copy + Paste in one operation)
 */
export const duplicateSelection = async (): Promise<boolean> => {
  const copied = await copySelection();
  if (!copied) return false;
  return pasteFromClipboard();
};

/**
 * Creates a Fabric.js object from serialized data
 */
const createObjectFromData = async (data: any): Promise<fabric.Object | null> => {
  try {
    const normalized = normalizeSerializedObjectForFabric(data);
    const revived = await fabric.util.enlivenObjects([normalized], {
      reviver: (serialized, instance) => {
        if (instance) reviveCustomFabricProps(serialized as any, instance as any);
      },
    }) as fabric.Object[];
    const object = revived[0];
    if (!object) return null;
    reviveObjectTree(normalized, object);
    return object;
  } catch (error) {
    console.error('[ClipboardService] Failed to create object:', error);
    return null;
  }
};

const collectCanvasObjectIds = (canvas: fabric.Canvas): Set<string> => {
  const ids = new Set<string>();
  const visit = (object: fabric.Object) => {
    const id = (object as any).id;
    if (typeof id === 'string' && id.trim()) ids.add(id);
    if (typeof (object as any).getObjects === 'function') {
      (object as fabric.Group).getObjects().forEach(visit);
    }
    const clipPath = (object as any).clipPath;
    if (clipPath instanceof fabric.Object) visit(clipPath);
  };
  canvas.getObjects().forEach(visit);
  return ids;
};

const assignFreshObjectTreeIds = (
  object: fabric.Object,
  usedIds: Set<string>,
) => {
  let nextId = uuidv4();
  while (usedIds.has(nextId)) nextId = uuidv4();
  (object as any).id = nextId;
  usedIds.add(nextId);
  if (typeof (object as any).getObjects === 'function') {
    (object as fabric.Group).getObjects().forEach((child) => {
      assignFreshObjectTreeIds(child, usedIds);
    });
  }
  const clipPath = (object as any).clipPath;
  if (clipPath instanceof fabric.Object) assignFreshObjectTreeIds(clipPath, usedIds);
};

const reviveObjectTree = (serialized: any, object: fabric.Object) => {
  reviveCustomFabricProps(serialized as any, object as any);
  const children = Array.isArray(serialized?.objects)
    && typeof (object as any).getObjects === 'function'
    ? (object as fabric.Group).getObjects()
    : [];
  if (Array.isArray(serialized?.objects)) {
    serialized.objects.forEach((child: any, index: number) => {
      const revivedChild = children[index];
      if (revivedChild) reviveObjectTree(child, revivedChild);
    });
  }
  if (serialized?.clipPath && (object as any).clipPath instanceof fabric.Object) {
    reviveObjectTree(serialized.clipPath, (object as any).clipPath);
  }
};

const commitZOrderMutation = ({
  action,
  applyToSelection,
  applyToObject,
}: {
  action: SingleObjectZOrderAction;
  applyToSelection: (selection: fabric.ActiveSelection, canvas: fabric.Canvas) => void;
  applyToObject: (object: fabric.Object, canvas: fabric.Canvas) => void;
}): void => {
  const { canvas, requestLayerSync, saveState, syncCanvasToStore } = useEditorStore.getState();
  if (!canvas) return;

  const activeObject = canvas.getActiveObject();
  if (!activeObject) return;

  const previousObjectIds = getUserObjectOrder(canvas);
  const multiSelection = isActiveSelection(activeObject);
  if (multiSelection) {
    applyToSelection(activeObject as fabric.ActiveSelection, canvas);
  } else {
    applyToObject(activeObject, canvas);
  }
  const expectedObjectIds = getUserObjectOrder(canvas);

  canvas.requestRenderAll();
  syncCanvasToStore(canvas);
  requestLayerSync();
  saveState();

  if (multiSelection && !areObjectIdListsEqual(previousObjectIds, expectedObjectIds)) {
    useEditorStore.getState().reportCommittedCanvasPageOrder(
      previousObjectIds,
      expectedObjectIds,
    );
  } else if (!multiSelection && !areObjectIdListsEqual(previousObjectIds, expectedObjectIds)) {
    useEditorStore.getState().reportCommittedCanvasZOrder(
      (activeObject as any).id,
      action,
      previousObjectIds,
      expectedObjectIds,
    );
  }
};

/**
 * Brings the selected object(s) to the front of the canvas.
 * Multi-selection is represented by a page-scoped reorder fact because the
 * product intent is one authored order operation over several objects.
 */
export const bringToFront = (): void => {
  commitZOrderMutation({
    action: 'bring-freeform-to-front',
    applyToSelection: (selection, canvas) => {
      selection.getObjects().forEach((obj) => canvas.bringObjectToFront(obj));
    },
    applyToObject: (object, canvas) => canvas.bringObjectToFront(object),
  });
};

/**
 * Sends the selected object(s) to the back of the canvas.
 * Multi-selection is represented by a page-scoped reorder fact because the
 * product intent is one authored order operation over several objects.
 */
export const sendToBack = (): void => {
  commitZOrderMutation({
    action: 'send-freeform-to-back',
    applyToSelection: (selection, canvas) => {
      [...selection.getObjects()].reverse().forEach((obj) => canvas.sendObjectToBack(obj));
    },
    applyToObject: (object, canvas) => canvas.sendObjectToBack(object),
  });
};

/**
 * Brings the selected object(s) forward by one level.
 * Multi-selection is represented by a page-scoped reorder fact because the
 * product intent is one authored order operation over several objects.
 */
export const bringForward = (): void => {
  commitZOrderMutation({
    action: 'move-freeform-forward',
    applyToSelection: (selection, canvas) => {
      selection.getObjects().forEach((obj) => canvas.bringObjectForward(obj));
    },
    applyToObject: (object, canvas) => canvas.bringObjectForward(object),
  });
};

/**
 * Sends the selected object(s) backward by one level.
 * Multi-selection is represented by a page-scoped reorder fact because the
 * product intent is one authored order operation over several objects.
 */
export const sendBackward = (): void => {
  commitZOrderMutation({
    action: 'move-freeform-backward',
    applyToSelection: (selection, canvas) => {
      [...selection.getObjects()].reverse().forEach((obj) => canvas.sendObjectBackwards(obj));
    },
    applyToObject: (object, canvas) => canvas.sendObjectBackwards(object),
  });
};

/**
 * Checks if clipboard has content
 */
export const hasClipboardContent = (): boolean => {
  return clipboardBuffer !== null && clipboardBuffer.length > 0;
};

/**
 * Clears the clipboard buffer
 */
export const clearClipboard = (): void => {
  clipboardBuffer = null;
};
