import * as fabric from 'fabric';
import { useEditorStore } from '../state/editorStore';
import { ensureObjectId } from './initFabricCanvas';
import { isActiveSelection } from '../utils/typeGuards';
import { withCanvasObjectMutationSuppressed } from '../services/canvasMutationObservation';

export const groupObjects = (canvas: fabric.Canvas) => {
  const activeObject = canvas.getActiveObject();
  if (!isActiveSelection(activeObject)) {
    return;
  }

  const activeSelection = activeObject as fabric.ActiveSelection;
  const objects = activeSelection.getObjects().slice();
  let group: fabric.Group | null = null;
  withCanvasObjectMutationSuppressed(canvas, () => {
    objects.forEach((obj) => canvas.remove(obj));

    group = new fabric.Group(objects, {
      left: activeSelection.left,
      top: activeSelection.top,
      originX: 'center',
      originY: 'center',
    });
    canvas.add(group);
  });
  if (!group) return;
  ensureObjectId(group, canvas);
  useEditorStore.getState().selectObjectById((group as any).id);

  canvas.requestRenderAll();
  useEditorStore.getState().syncCanvasToStore(canvas);
  useEditorStore.getState().requestLayerSync();
  useEditorStore.getState().saveState();
};

export const ungroupObjects = (canvas: fabric.Canvas) => {
  const activeObject = canvas.getActiveObject();
  if (!activeObject || activeObject.type !== 'group') {
    return;
  }

  const group = activeObject as fabric.Group;
  const children = group.getObjects();
  withCanvasObjectMutationSuppressed(canvas, () => {
    canvas.remove(group);
    children.forEach((child) => {
      canvas.add(child);
      child.setCoords();
    });
  });

  useEditorStore.getState().clearSelection();
  canvas.requestRenderAll();
  useEditorStore.getState().syncCanvasToStore(canvas);
  useEditorStore.getState().requestLayerSync();
  useEditorStore.getState().saveState();
};
