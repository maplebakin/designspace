import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import { useEditorStore } from '../state/editorStore';
import { isActiveSelection } from '../utils/typeGuards';
import { isUserObject } from '../utils/objectUtils';
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
const CLIPBOARD_CUSTOM_PROPS = [
  'id',
  'tokenRole',
  'colorLocked',
  'isPlaceholder',
  'adjustments',
  '__fixedWidth',
  '__fixedHeight',
  'originalFontSize',
  'recipeId',
  'recipePageId',
  'slotId',
  'semanticRole',
];

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
    // Clone the active object(s) and store in buffer
    const cloned = await activeObject.clone(CLIPBOARD_CUSTOM_PROPS);

    if (isActiveSelection(activeObject)) {
      // Multiple objects selected - store each one
      const selection = activeObject as fabric.ActiveSelection;
      const objects = selection.getObjects();
      clipboardBuffer = await Promise.all(
        objects.map(async (obj) => {
          const clonedObj = await obj.clone(CLIPBOARD_CUSTOM_PROPS);
          return clonedObj.toObject(CLIPBOARD_CUSTOM_PROPS);
        })
      );
    } else {
      // Single object selected
      clipboardBuffer = [cloned.toObject(CLIPBOARD_CUSTOM_PROPS)];
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

    for (const objectData of clipboardBuffer) {
      // Create object from serialized data
      const obj = await createObjectFromData(objectData);
      if (!obj) continue;

      // Assign new ID and offset position
      (obj as any).id = uuidv4();
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
    const type = typeof data.type === 'string' ? data.type.toLowerCase() : data.type;
    const { type: _type, ...options } = data;

    switch (type) {
      case 'rect':
        return new fabric.Rect(options);
      case 'circle':
        return new fabric.Circle(options);
      case 'ellipse':
        return new fabric.Ellipse(options);
      case 'triangle':
        return new fabric.Triangle(options);
      case 'polygon':
        return new fabric.Polygon(data.points || [], options);
      case 'polyline':
        return new fabric.Polyline(data.points || [], options);
      case 'line':
        return new fabric.Line([data.x1 || 0, data.y1 || 0, data.x2 || 0, data.y2 || 0], options);
      case 'path':
        return new fabric.Path(data.path, options);
      case 'text':
        return new fabric.Text(data.text || '', options);
      case 'i-text':
        return new fabric.IText(data.text || '', options);
      case 'textbox':
        return new fabric.Textbox(data.text || '', options);
      case 'image':
        if (data.src) {
          return await fabric.FabricImage.fromURL(data.src, { crossOrigin: 'anonymous', ...options });
        }
        return null;
      case 'group': {
        const groupObjects = await Promise.all(
          (data.objects || []).map((objData: any) => createObjectFromData(objData))
        );
        const validObjects = groupObjects.filter((obj): obj is fabric.Object => obj !== null);
        return new fabric.Group(validObjects, options);
      }
      default:
        console.warn(`[ClipboardService] Unknown object type: ${type}`);
        return null;
    }
  } catch (error) {
    console.error('[ClipboardService] Failed to create object:', error);
    return null;
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
