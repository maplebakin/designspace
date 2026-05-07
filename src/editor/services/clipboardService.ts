import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import { useEditorStore } from '../state/editorStore';
import { isActiveSelection } from '../utils/typeGuards';

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
    const cloned = await activeObject.clone(['id', 'tokenRole', 'colorLocked', 'isPlaceholder', 'adjustments']);

    if (isActiveSelection(activeObject)) {
      // Multiple objects selected - store each one
      const selection = activeObject as fabric.ActiveSelection;
      const objects = selection.getObjects();
      clipboardBuffer = await Promise.all(
        objects.map(async (obj) => {
          const clonedObj = await obj.clone(['id', 'tokenRole', 'colorLocked', 'isPlaceholder', 'adjustments']);
          return clonedObj.toObject(['id', 'tokenRole', 'colorLocked', 'isPlaceholder', 'adjustments']);
        })
      );
    } else {
      // Single object selected
      clipboardBuffer = [cloned.toObject(['id', 'tokenRole', 'colorLocked', 'isPlaceholder', 'adjustments'])];
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

      canvas.add(obj);
      pastedObjects.push(obj);
    }

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

/**
 * Brings the selected object(s) to the front of the canvas
 */
export const bringToFront = (): void => {
  const { canvas, requestLayerSync, saveState, syncCanvasToStore } = useEditorStore.getState();
  if (!canvas) return;

  const activeObject = canvas.getActiveObject();
  if (!activeObject) return;

  if (isActiveSelection(activeObject)) {
    const selection = activeObject as fabric.ActiveSelection;
    selection.getObjects().forEach((obj) => canvas.bringObjectToFront(obj));
  } else {
    canvas.bringObjectToFront(activeObject);
  }

  canvas.requestRenderAll();
  syncCanvasToStore(canvas);
  requestLayerSync();
  saveState();
};

/**
 * Sends the selected object(s) to the back of the canvas
 */
export const sendToBack = (): void => {
  const { canvas, requestLayerSync, saveState, syncCanvasToStore } = useEditorStore.getState();
  if (!canvas) return;

  const activeObject = canvas.getActiveObject();
  if (!activeObject) return;

  if (isActiveSelection(activeObject)) {
    const selection = activeObject as fabric.ActiveSelection;
    // Reverse order to maintain relative stacking
    [...selection.getObjects()].reverse().forEach((obj) => canvas.sendObjectToBack(obj));
  } else {
    canvas.sendObjectToBack(activeObject);
  }

  canvas.requestRenderAll();
  syncCanvasToStore(canvas);
  requestLayerSync();
  saveState();
};

/**
 * Brings the selected object(s) forward by one level
 */
export const bringForward = (): void => {
  const { canvas, requestLayerSync, saveState, syncCanvasToStore } = useEditorStore.getState();
  if (!canvas) return;

  const activeObject = canvas.getActiveObject();
  if (!activeObject) return;

  if (isActiveSelection(activeObject)) {
    const selection = activeObject as fabric.ActiveSelection;
    selection.getObjects().forEach((obj) => canvas.bringObjectForward(obj));
  } else {
    canvas.bringObjectForward(activeObject);
  }

  canvas.requestRenderAll();
  syncCanvasToStore(canvas);
  requestLayerSync();
  saveState();
};

/**
 * Sends the selected object(s) backward by one level
 */
export const sendBackward = (): void => {
  const { canvas, requestLayerSync, saveState, syncCanvasToStore } = useEditorStore.getState();
  if (!canvas) return;

  const activeObject = canvas.getActiveObject();
  if (!activeObject) return;

  if (isActiveSelection(activeObject)) {
    const selection = activeObject as fabric.ActiveSelection;
    [...selection.getObjects()].reverse().forEach((obj) => canvas.sendObjectBackwards(obj));
  } else {
    canvas.sendObjectBackwards(activeObject);
  }

  canvas.requestRenderAll();
  syncCanvasToStore(canvas);
  requestLayerSync();
  saveState();
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
