import * as fabric from 'fabric';
import { useEditorStore } from '../state/editorStore';
import { ensureObjectId } from './initFabricCanvas';
import { isActiveSelection } from '../utils/typeGuards';
import {
  isCanvasObjectObservationTarget,
  withCanvasObjectMutationSuppressed,
  type CanvasCommittedMutation,
} from '../services/canvasMutationObservation';

export const groupObjects = (canvas: fabric.Canvas): CanvasCommittedMutation | null => {
  const activeObject = canvas.getActiveObject();
  if (!isActiveSelection(activeObject)) {
    return null;
  }

  const activeSelection = activeObject as fabric.ActiveSelection;
  const objects = activeSelection.getObjects().slice();
  if (objects.length < 2) {
    return null;
  }
  const canObserveGroup = objects.every(isCanvasObjectObservationTarget);

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
  if (!group) return null;
  ensureObjectId(group, canvas);
  useEditorStore.getState().selectObjectById((group as any).id);

  canvas.requestRenderAll();
  useEditorStore.getState().syncCanvasToStore(canvas);
  useEditorStore.getState().requestLayerSync();
  useEditorStore.getState().saveState();

  const groupId = (group as any).id;
  if (
    !canvas.getObjects().includes(group)
    || !canObserveGroup
    || !isCanvasObjectObservationTarget(group)
    || typeof groupId !== 'string'
    || groupId.trim().length === 0
  ) {
    return null;
  }

  return {
    action: 'group-freeform-objects',
    groupId,
  };
};

export const ungroupObjects = (canvas: fabric.Canvas): CanvasCommittedMutation | null => {
  const activeObject = canvas.getActiveObject();
  if (!activeObject || activeObject.type !== 'group') {
    return null;
  }

  const group = activeObject as fabric.Group;
  const groupId = (group as any).id;
  const children = group.getObjects();
  if (children.length === 0) {
    return null;
  }
  const canObserveGroup = isCanvasObjectObservationTarget(group)
    && children.every(isCanvasObjectObservationTarget);
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

  if (
    canvas.getObjects().includes(group)
    || !canObserveGroup
    || typeof groupId !== 'string'
    || groupId.trim().length === 0
    || children.some((child) => !canvas.getObjects().includes(child))
  ) {
    return null;
  }

  return {
    action: 'ungroup-freeform-objects',
    groupId,
  };
};
