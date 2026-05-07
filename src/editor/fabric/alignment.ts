/**
 * Alignment Utilities
 *
 * Provides functions to align objects to the canvas/document bounds.
 * All alignment operations use the document dimensions from useCanvasStore.
 *
 * @module alignment
 */

import * as fabric from 'fabric';
import { useEditorStore } from '../state/editorStore';
import { useCanvasStore } from '../state/useCanvasStore';
import { isActiveSelection } from '../utils/typeGuards';

/**
 * Gets the document bounds for alignment.
 * Always uses the document dimensions from the store (0, 0, width, height).
 * This ensures alignment is relative to the actual document, not the viewport.
 */
const getDocumentBounds = () => {
    const { width: docWidth, height: docHeight } = useCanvasStore.getState();
    return {
        left: 0,
        top: 0,
        width: docWidth,
        height: docHeight,
    };
};

const getActiveSelection = (canvas: fabric.Canvas) => {
    const activeObject = canvas.getActiveObject();
    if (!isActiveSelection(activeObject)) {
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

/**
 * Calculates the delta needed to align an object to the document bounds.
 */
const calculateAlignmentDelta = (
    rect: { left: number; top: number; width: number; height: number },
    direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
): { dx: number; dy: number } => {
    const { left: docLeft, top: docTop, width: docWidth, height: docHeight } = getDocumentBounds();
    let dx = 0;
    let dy = 0;

    switch (direction) {
        case 'left':
            // Align left edge of object to left edge of document
            dx = docLeft - rect.left;
            break;
        case 'center':
            // Align center of object to horizontal center of document
            dx = docLeft + docWidth / 2 - (rect.left + rect.width / 2);
            break;
        case 'right':
            // Align right edge of object to right edge of document
            dx = docLeft + docWidth - (rect.left + rect.width);
            break;
        case 'top':
            // Align top edge of object to top edge of document
            dy = docTop - rect.top;
            break;
        case 'middle':
            // Align center of object to vertical center of document
            dy = docTop + docHeight / 2 - (rect.top + rect.height / 2);
            break;
        case 'bottom':
            // Align bottom edge of object to bottom edge of document
            dy = docTop + docHeight - (rect.top + rect.height);
            break;
    }

    return { dx, dy };
};

/**
 * Aligns a single object to the document bounds.
 */
const alignSingleObject = (
    canvas: fabric.Canvas,
    object: fabric.Object,
    direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
) => {
    const rect = object.getBoundingRect();
    const { dx, dy } = calculateAlignmentDelta(rect, direction);

    if (dx || dy) {
        applyObjectDelta(object, dx, dy);
        object.setCoords();
    }
    finalizeAlignment(canvas);
};

/**
 * Aligns multiple objects to the document bounds.
 * Each object is aligned independently to the document edge/center.
 */
const alignMultipleObjects = (
    canvas: fabric.Canvas,
    selection: fabric.ActiveSelection,
    direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
) => {
    const objects = selection.getObjects();
    if (objects.length === 0) return;
    canvas.discardActiveObject();

    // Align each object to the document bounds
    objects.forEach((object) => {
        const rect = object.getBoundingRect();
        const { dx, dy } = calculateAlignmentDelta(rect, direction);

        if (dx || dy) {
            applyObjectDelta(object, dx, dy);
        }
    });

    useEditorStore.getState().syncSelectionFromCanvas(canvas);
    finalizeAlignment(canvas);
};

/**
 * Aligns the selected object(s) to the document bounds.
 *
 * @param canvas - The fabric.Canvas instance
 * @param direction - The alignment direction
 */
const alignObjects = (
    canvas: fabric.Canvas,
    direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
) => {
    const activeObject = canvas.getActiveObject();
    if (!activeObject) return;

    if (isActiveSelection(activeObject)) {
        alignMultipleObjects(canvas, activeObject as fabric.ActiveSelection, direction);
    } else {
        alignSingleObject(canvas, activeObject, direction);
    }
};

/**
 * Aligns selected object(s) to the left edge of the document.
 * @param canvas - The fabric.Canvas instance
 */
export const alignLeft = (canvas: fabric.Canvas) => alignObjects(canvas, 'left');

/**
 * Aligns selected object(s) to the horizontal center of the document.
 * @param canvas - The fabric.Canvas instance
 */
export const alignCenter = (canvas: fabric.Canvas) => alignObjects(canvas, 'center');

/**
 * Aligns selected object(s) to the right edge of the document.
 * @param canvas - The fabric.Canvas instance
 */
export const alignRight = (canvas: fabric.Canvas) => alignObjects(canvas, 'right');

/**
 * Aligns selected object(s) to the top edge of the document.
 * @param canvas - The fabric.Canvas instance
 */
export const alignTop = (canvas: fabric.Canvas) => alignObjects(canvas, 'top');

/**
 * Aligns selected object(s) to the vertical center of the document.
 * @param canvas - The fabric.Canvas instance
 */
export const alignMiddle = (canvas: fabric.Canvas) => alignObjects(canvas, 'middle');

/**
 * Aligns selected object(s) to the bottom edge of the document.
 * @param canvas - The fabric.Canvas instance
 */
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
    canvas.discardActiveObject();

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

    useEditorStore.getState().syncSelectionFromCanvas(canvas);
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
    canvas.discardActiveObject();

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

    useEditorStore.getState().syncSelectionFromCanvas(canvas);
    finalizeAlignment(canvas);
};
