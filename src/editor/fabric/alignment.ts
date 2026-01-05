
import * as fabric from 'fabric';
import { useEditorStore } from '../state/editorStore';

/**
 * Distributes selected objects horizontally with equal spacing.
 * Assumes at least 3 objects are selected.
 * @param canvas The fabric.Canvas instance.
 */
export const distributeHorizontally = (canvas: fabric.Canvas) => {
    const activeObject = canvas.getActiveObject();
    if (!activeObject || activeObject.type !== 'activeSelection') {
        return;
    }

    const activeSelection = activeObject as fabric.ActiveSelection;
    const selectedObjects = activeSelection.getObjects() as fabric.Object[];

    if (selectedObjects.length < 3) {
        return;
    }

    // Sort objects by their left position
    selectedObjects.sort((a, b) => (a.left || 0) - (b.left || 0));

    // Get the bounding box of the entire selection
    const boundingBox = activeSelection.getBoundingRect();

    // Calculate total width taken by objects (sum of their widths)
    const totalObjectsWidth = selectedObjects.reduce((sum: number, obj: fabric.Object) => sum + (obj.getScaledWidth() || 0), 0);

    // Calculate the available space for gaps
    const availableGapSpace = boundingBox.width - totalObjectsWidth;

    // Calculate the size of each gap
    const numGaps = selectedObjects.length - 1;
    const uniformGap = numGaps > 0 ? availableGapSpace / numGaps : 0;

    let currentX = boundingBox.left;
    selectedObjects.forEach((obj: fabric.Object, index: number) => {
        if (index === 0) {
            // The first object stays at its leftmost position in the bounding box
            obj.set({ left: currentX });
        } else {
            // Position subsequent objects based on previous object's width and the uniform gap
            currentX += (selectedObjects[index - 1].getScaledWidth() || 0) + uniformGap;
            obj.set({ left: currentX });
        }
        obj.setCoords(); // Update object's controls
    });

    // Update the active selection's position and render
    activeSelection.setCoords();
    canvas.requestRenderAll();
    useEditorStore.getState().saveState();
};

/**
 * Distributes selected objects vertically with equal spacing.
 * Assumes at least 3 objects are selected.
 * @param canvas The fabric.Canvas instance.
 */
export const distributeVertically = (canvas: fabric.Canvas) => {
    const activeObject = canvas.getActiveObject();
    if (!activeObject || activeObject.type !== 'activeSelection') {
        return;
    }

    const activeSelection = activeObject as fabric.ActiveSelection;
    const selectedObjects = activeSelection.getObjects() as fabric.Object[];

    if (selectedObjects.length < 3) {
        return;
    }

    // Sort objects by their top position
    selectedObjects.sort((a, b) => (a.top || 0) - (b.top || 0));

    // Get the bounding box of the entire selection
    const boundingBox = activeSelection.getBoundingRect();

    // Calculate total height taken by objects (sum of their heights)
    const totalObjectsHeight = selectedObjects.reduce((sum: number, obj: fabric.Object) => sum + (obj.getScaledHeight() || 0), 0);

    // Calculate the available space for gaps
    const availableGapSpace = boundingBox.height - totalObjectsHeight;

    // Calculate the size of each gap
    const numGaps = selectedObjects.length - 1;
    const uniformGap = numGaps > 0 ? availableGapSpace / numGaps : 0;

    let currentY = boundingBox.top;
    selectedObjects.forEach((obj: fabric.Object, index: number) => {
        if (index === 0) {
            // The first object stays at its topmost position in the bounding box
            obj.set({ top: currentY });
        } else {
            // Position subsequent objects based on previous object's height and the uniform gap
            currentY += (selectedObjects[index - 1].getScaledHeight() || 0) + uniformGap;
            obj.set({ top: currentY });
        }
        obj.setCoords(); // Update object's controls
    });

    // Update the active selection's position and render
    activeSelection.setCoords();
    canvas.requestRenderAll();
    useEditorStore.getState().saveState();
};
