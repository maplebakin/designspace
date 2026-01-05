import * as fabric from 'fabric';
import { useEditorStore } from '../state/editorStore';

export const groupObjects = (canvas: fabric.Canvas) => {
  const activeObject = canvas.getActiveObject();
  if (!activeObject || activeObject.type !== 'activeSelection') {
    return;
  }

  const activeSelection = activeObject as fabric.ActiveSelection;
  const objects = activeSelection.getObjects().slice();
  objects.forEach((obj) => canvas.remove(obj));

  const group = new fabric.Group(objects, {
    left: activeSelection.left,
    top: activeSelection.top,
    originX: 'center',
    originY: 'center',
  });
  canvas.add(group);
  canvas.setActiveObject(group);

  canvas.requestRenderAll();
  useEditorStore.getState().saveState();
};

export const ungroupObjects = (canvas: fabric.Canvas) => {
  const activeObject = canvas.getActiveObject();
  if (!activeObject || activeObject.type !== 'group') {
    return;
  }

  const group = activeObject as fabric.Group;
  const children = group.getObjects();
  canvas.remove(group);
  children.forEach((child) => {
    canvas.add(child);
    child.setCoords();
  });

  canvas.discardActiveObject();
  canvas.requestRenderAll();
  useEditorStore.getState().saveState();
};
