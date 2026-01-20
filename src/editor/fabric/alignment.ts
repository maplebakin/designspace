
import * as fabric from 'fabric';
import { useEditorStore } from '../state/editorStore';

const PAGE_PADDING = 20;

const getActiveSelection = (canvas: fabric.Canvas) => {
    const activeObject = canvas.getActiveObject();
    if (!activeObject || activeObject.type !== 'activeSelection') {
        return null;
    }
    return activeObject as fabric.ActiveSelection;
};

const applyObjectDelta = (object: fabric.Object, deltaX: number, deltaY: number) => {
    object.set({
        left: (object.left ?? 0) + deltaX,
        top: (object.top ?? 0) + deltaY,
    });
    object.setCoords();
};

const finalizeAlignment = (canvas: fabric.Canvas) => {
    canvas.requestRenderAll();
    const { syncCanvasToStore, saveState } = useEditorStore.getState();
    syncCanvasToStore(canvas);
    saveState();
};

const alignSingleObject = (
    canvas: fabric.Canvas,
    object: fabric.Object,
    direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
) => {
    const rect = object.getBoundingRect();
    const canvasWidth = canvas.getWidth();
    const canvasHeight = canvas.getHeight();
    let dx = 0;
    let dy = 0;

    switch (direction) {
        case 'left':
            dx = PAGE_PADDING - rect.left;
            break;
        case 'center':
            dx = canvasWidth / 2 - rect.width / 2 - rect.left;
            break;
        case 'right':
            dx = canvasWidth - PAGE_PADDING - (rect.left + rect.width);
            break;
        case 'top':
            dy = PAGE_PADDING - rect.top;
            break;
        case 'middle':
            dy = canvasHeight / 2 - rect.height / 2 - rect.top;
            break;
        case 'bottom':
            dy = canvasHeight - PAGE_PADDING - (rect.top + rect.height);
            break;
        default:
            break;
    }

    if (dx || dy) {
        applyObjectDelta(object, dx, dy);
        object.setCoords();
    }
    finalizeAlignment(canvas);
};

const alignMultipleObjects = (
    canvas: fabric.Canvas,
    selection: fabric.ActiveSelection,
    direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
) => {
    const objects = selection.getObjects();
    if (objects.length === 0) return;

    const rects = objects.map((object) => object.getBoundingRect());
    const lefts = rects.map((rect) => rect.left);
    const rights = rects.map((rect) => rect.left + rect.width);
    const tops = rects.map((rect) => rect.top);
    const bottoms = rects.map((rect) => rect.top + rect.height);
    const centersX = rects.map((rect) => rect.left + rect.width / 2);
    const centersY = rects.map((rect) => rect.top + rect.height / 2);

    const targetLeft = Math.min(...lefts);
    const targetRight = Math.max(...rights);
    const targetTop = Math.min(...tops);
    const targetBottom = Math.max(...bottoms);
    const targetCenterX = centersX.reduce((sum, value) => sum + value, 0) / centersX.length;
    const targetCenterY = centersY.reduce((sum, value) => sum + value, 0) / centersY.length;

    objects.forEach((object, index) => {
        const rect = rects[index];
        let dx = 0;
        let dy = 0;

        switch (direction) {
            case 'left':
                dx = targetLeft - rect.left;
                break;
            case 'center':
                dx = targetCenterX - (rect.left + rect.width / 2);
                break;
            case 'right':
                dx = targetRight - (rect.left + rect.width);
                break;
            case 'top':
                dy = targetTop - rect.top;
                break;
            case 'middle':
                dy = targetCenterY - (rect.top + rect.height / 2);
                break;
            case 'bottom':
                dy = targetBottom - (rect.top + rect.height);
                break;
            default:
                break;
        }

        if (dx || dy) {
            applyObjectDelta(object, dx, dy);
        }
    });

    selection.setCoords();
    finalizeAlignment(canvas);
};

const alignObjects = (
    canvas: fabric.Canvas,
    direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
) => {
    const activeObject = canvas.getActiveObject();
    if (!activeObject) return;

    if (activeObject.type === 'activeSelection') {
        alignMultipleObjects(canvas, activeObject as fabric.ActiveSelection, direction);
    } else {
        alignSingleObject(canvas, activeObject, direction);
    }
};

export const alignLeft = (canvas: fabric.Canvas) => alignObjects(canvas, 'left');
export const alignCenter = (canvas: fabric.Canvas) => alignObjects(canvas, 'center');
export const alignRight = (canvas: fabric.Canvas) => alignObjects(canvas, 'right');
export const alignTop = (canvas: fabric.Canvas) => alignObjects(canvas, 'top');
export const alignMiddle = (canvas: fabric.Canvas) => alignObjects(canvas, 'middle');
export const alignBottom = (canvas: fabric.Canvas) => alignObjects(canvas, 'bottom');

/**
 * Distributes selected objects horizontally with equal spacing.
 * Assumes at least 3 objects are selected.
 * @param canvas The fabric.Canvas instance.
 */
export const distributeHorizontally = (canvas: fabric.Canvas) => {
    const activeSelection = getActiveSelection(canvas);
    if (!activeSelection) return;
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
    finalizeAlignment(canvas);
};

/**
 * Distributes selected objects vertically with equal spacing.
 * Assumes at least 3 objects are selected.
 * @param canvas The fabric.Canvas instance.
 */
export const distributeVertically = (canvas: fabric.Canvas) => {
    const activeSelection = getActiveSelection(canvas);
    if (!activeSelection) return;
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
    finalizeAlignment(canvas);
};
