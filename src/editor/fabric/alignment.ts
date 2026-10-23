/**
 * Alignment Utilities
 *
 * Single objects align to the document bounds. Multi-selections align to their
 * own selection bounds, which gives design-tool semantics such as lining up
 * card centers without throwing the entire row to the page edge.
 *
 * @module alignment
 */

import * as fabric from 'fabric';
import { useEditorStore } from '../state/editorStore';
import { useCanvasStore } from '../state/useCanvasStore';
import { isActiveSelection } from '../utils/typeGuards';
import {
    calculateAlignmentDeltaToBounds,
    calculateDistributionDeltas,
    type AlignmentDirection,
    type DistributionAxis,
} from './alignmentGeometry';

/**
 * Gets the document bounds for single-object alignment.
 * Always uses authored document coordinates, never viewport dimensions.
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

/**
 * Alignment commands should not destroy the user's multi-selection. Rebuild
 * the ActiveSelection after applying scene-space deltas so they can align and
 * distribute repeatedly without reselecting every object.
 */
const restoreSelection = (canvas: fabric.Canvas, objects: fabric.Object[]) => {
    if (objects.length === 0) return;
    if (objects.length === 1) {
        canvas.setActiveObject(objects[0]);
    } else {
        canvas.setActiveObject(new fabric.ActiveSelection(objects, { canvas }));
    }
    canvas.getActiveObject()?.setCoords();
    useEditorStore.getState().syncSelectionFromCanvas(canvas);
};

const finalizeAlignment = (canvas: fabric.Canvas) => {
    canvas.requestRenderAll();
    const { syncCanvasToStore, saveState } = useEditorStore.getState();
    syncCanvasToStore(canvas);
    saveState();
};

/**
 * Aligns a single object to the document bounds.
 */
const alignSingleObject = (
    canvas: fabric.Canvas,
    object: fabric.Object,
    direction: AlignmentDirection,
) => {
    const rect = object.getBoundingRect();
    const { dx, dy } = calculateAlignmentDeltaToBounds(
        rect,
        getDocumentBounds(),
        direction,
    );

    if (dx || dy) {
        applyObjectDelta(object, dx, dy);
    }
    finalizeAlignment(canvas);
};

/**
 * Aligns multiple objects to each other, using the current selection bounds as
 * the reference. Example: Align Middle gives every selected card the same
 * vertical center while keeping the row where the user placed it.
 */
const alignMultipleObjects = (
    canvas: fabric.Canvas,
    selection: fabric.ActiveSelection,
    direction: AlignmentDirection,
) => {
    const objects = [...selection.getObjects()];
    if (objects.length === 0) return;

    const selectionBounds = selection.getBoundingRect();
    canvas.discardActiveObject();

    objects.forEach((object) => {
        const rect = object.getBoundingRect();
        const { dx, dy } = calculateAlignmentDeltaToBounds(
            rect,
            selectionBounds,
            direction,
        );
        if (dx || dy) {
            applyObjectDelta(object, dx, dy);
        }
    });

    restoreSelection(canvas, objects);
    finalizeAlignment(canvas);
};

/**
 * Aligns one object to the page, or a multi-selection to itself.
 */
const alignObjects = (
    canvas: fabric.Canvas,
    direction: AlignmentDirection,
) => {
    const activeObject = canvas.getActiveObject();
    if (!activeObject) return;

    if (isActiveSelection(activeObject)) {
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

const distributeSelection = (
    canvas: fabric.Canvas,
    axis: DistributionAxis,
) => {
    const selection = getActiveSelection(canvas);
    if (!selection) return;

    const objects = [...selection.getObjects()];
    if (objects.length < 3) return;

    const selectionBounds = selection.getBoundingRect();
    canvas.discardActiveObject();

    // Use visual bounding rectangles rather than obj.left/obj.top. Tarot cards
    // use centered origins, and other objects may be rotated or scaled.
    const rects = objects.map((object) => object.getBoundingRect());
    const deltas = calculateDistributionDeltas(rects, selectionBounds, axis);

    objects.forEach((object, index) => {
        const { dx, dy } = deltas[index];
        if (dx || dy) {
            applyObjectDelta(object, dx, dy);
        }
    });

    restoreSelection(canvas, objects);
    finalizeAlignment(canvas);
};

/**
 * Distributes 3+ selected objects horizontally with equal visual gaps while
 * keeping the leftmost and rightmost selection edges anchored.
 */
export const distributeHorizontally = (canvas: fabric.Canvas) =>
    distributeSelection(canvas, 'horizontal');

/**
 * Distributes 3+ selected objects vertically with equal visual gaps while
 * keeping the topmost and bottommost selection edges anchored.
 */
export const distributeVertically = (canvas: fabric.Canvas) =>
    distributeSelection(canvas, 'vertical');
