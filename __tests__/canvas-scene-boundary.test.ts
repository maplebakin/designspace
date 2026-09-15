import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fabric from 'fabric';
import {
  hydrateCanvasDataWithAssets,
  prepareCanvasDataForPersistence,
} from '../src/editor/state/useHistoryStore';
import {
  isSerializedImageObject,
  serializeCanvasObjects,
  toSerializableObject,
} from '../src/editor/utils/serialization';
import { ungroupObjects } from '../src/editor/fabric/grouping';
import { useEditorStore } from '../src/editor/state/editorStore';

describe('Fabric scene serialization boundary', () => {
  let element: HTMLCanvasElement;
  let canvas: fabric.Canvas;

  beforeEach(() => {
    element = document.createElement('canvas');
    document.body.appendChild(element);
    canvas = new fabric.Canvas(element, { width: 800, height: 600 });
  });

  afterEach(() => {
    canvas.dispose();
    element.remove();
  });

  it('serializes ActiveSelection children in page coordinates without deselection', () => {
    const first = new fabric.Rect({ left: 200, top: 200, width: 40, height: 30 });
    const second = new fabric.Rect({ left: 400, top: 300, width: 20, height: 20 });
    (first as any).id = 'first';
    (second as any).id = 'second';
    canvas.add(first, second);
    canvas.setActiveObject(new fabric.ActiveSelection([first, second], { canvas }));

    const serialized = serializeCanvasObjects(canvas) as any[];

    expect(serialized.map((object) => ({
      id: object.id,
      left: object.left,
      top: object.top,
    }))).toEqual([
      { id: 'first', left: 200, top: 200 },
      { id: 'second', left: 400, top: 300 },
    ]);
    expect(canvas.getActiveObject()?.type).toMatch(/activeSelection|activeselection/);
  });

  it('round-trips a transformed ActiveSelection in page space while it remains selected', async () => {
    const first = new fabric.Rect({ left: 140, top: 120, width: 48, height: 32 });
    const second = new fabric.Rect({ left: 360, top: 260, width: 34, height: 56 });
    (first as any).id = 'selection-first';
    (second as any).id = 'selection-second';
    canvas.add(first, second);

    const selection = new fabric.ActiveSelection([first, second], { canvas });
    canvas.setActiveObject(selection);
    selection.set({ left: 275, top: 215, scaleX: 1.35, scaleY: 0.72, angle: 31 });
    selection.setCoords();
    const expectedCorners = [first, second].map((object) => object.getCoords().map((point) => ({
      x: point.x,
      y: point.y,
    })));

    const selectedSerialized = serializeCanvasObjects(canvas) as any[];
    expect(canvas.getActiveObject()).toBe(selection);
    canvas.discardActiveObject();
    const deselectedSerialized = serializeCanvasObjects(canvas) as any[];
    canvas.setActiveObject(first);
    const singlySelectedSerialized = serializeCanvasObjects(canvas) as any[];
    canvas.discardActiveObject();
    selectedSerialized.forEach((selectedObject, index) => {
      const deselectedObject = deselectedSerialized[index];
      const singlySelectedObject = singlySelectedSerialized[index];
      expect(deselectedObject.id).toBe(selectedObject.id);
      expect(deselectedObject.left).toBeCloseTo(selectedObject.left, 3);
      expect(deselectedObject.top).toBeCloseTo(selectedObject.top, 3);
      expect(deselectedObject.scaleX).toBeCloseTo(selectedObject.scaleX, 3);
      expect(deselectedObject.scaleY).toBeCloseTo(selectedObject.scaleY, 3);
      expect(deselectedObject.angle).toBeCloseTo(selectedObject.angle, 3);
      expect(singlySelectedObject.id).toBe(selectedObject.id);
      expect(singlySelectedObject.left).toBeCloseTo(selectedObject.left, 3);
      expect(singlySelectedObject.top).toBeCloseTo(selectedObject.top, 3);
      expect(singlySelectedObject.scaleX).toBeCloseTo(selectedObject.scaleX, 3);
      expect(singlySelectedObject.scaleY).toBeCloseTo(selectedObject.scaleY, 3);
      expect(singlySelectedObject.angle).toBeCloseTo(selectedObject.angle, 3);
    });

    const reopenedElement = document.createElement('canvas');
    document.body.appendChild(reopenedElement);
    const reopened = new fabric.Canvas(reopenedElement, { width: 800, height: 600 });
    try {
      await reopened.loadFromJSON({ objects: selectedSerialized });
      const reopenedObjects = reopened.getObjects();
      expect(reopenedObjects.map((object) => (object as any).id)).toEqual([
        'selection-first',
        'selection-second',
      ]);
      reopenedObjects.forEach((object, objectIndex) => {
        object.setCoords();
        object.getCoords().forEach((point, cornerIndex) => {
          expect(point.x).toBeCloseTo(expectedCorners[objectIndex][cornerIndex].x, 3);
          expect(point.y).toBeCloseTo(expectedCorners[objectIndex][cornerIndex].y, 3);
        });
      });
    } finally {
      reopened.dispose();
      reopenedElement.remove();
    }
  });

  it('recognizes Fabric class-name image payloads and replaces their source with an asset id', () => {
    const source = document.createElement('canvas');
    source.width = 2;
    source.height = 2;
    const image = new fabric.FabricImage(source, { left: 20, top: 30 });
    (image as any).id = 'uploaded-image';
    (image as any).src = 'blob:session-only';

    const serialized = toSerializableObject(image) as any;
    expect(serialized.type).toBe('Image');
    expect(isSerializedImageObject(serialized)).toBe(true);

    const prepared = prepareCanvasDataForPersistence(
      { objects: [serialized] },
      { 'uploaded-image': 'blob:session-only' },
    );
    expect(prepared.canvasData.objects[0].src).toBe('uploaded-image');
    expect(prepared.imageAssets['uploaded-image']).toBe('blob:session-only');

    const hydrated = hydrateCanvasDataWithAssets(
      prepared.canvasData,
      prepared.imageAssets,
    );
    expect(hydrated.objects[0].src).toBe('blob:session-only');
  });

  it('detaches transformed group children while preserving their physical corners', () => {
    const first = new fabric.Rect({ left: -40, top: -20, width: 80, height: 40 });
    const second = new fabric.Rect({ left: 60, top: 30, width: 30, height: 50 });
    (first as any).id = 'group-first';
    (second as any).id = 'group-second';
    const group = new fabric.Group([first, second], {
      left: 300,
      top: 250,
      angle: 30,
      scaleX: 1.5,
      scaleY: 0.75,
    });
    (group as any).id = 'transformed-group';
    canvas.add(group);
    canvas.setActiveObject(group);

    const before = [first, second].map((object) => object.getCoords().map((point) => ({
      x: point.x,
      y: point.y,
    })));
    const originalState = useEditorStore.getState();
    useEditorStore.setState({
      canvas,
      clearSelection: () => canvas.discardActiveObject(),
      syncCanvasToStore: () => undefined,
      requestLayerSync: () => undefined,
      saveState: () => undefined,
    });

    try {
      expect(ungroupObjects(canvas)).toMatchObject({
        action: 'ungroup-freeform-objects',
        groupId: 'transformed-group',
      });
      expect(canvas.getObjects().map((object) => (object as any).id)).toEqual([
        'group-first',
        'group-second',
      ]);
      expect(first.group).toBeUndefined();
      expect((first as any).parent).toBeUndefined();
      expect(second.group).toBeUndefined();
      expect((second as any).parent).toBeUndefined();
      const after = [first, second].map((object) => object.getCoords());
      after.forEach((corners, objectIndex) => {
        corners.forEach((point, cornerIndex) => {
          expect(point.x).toBeCloseTo(before[objectIndex][cornerIndex].x, 8);
          expect(point.y).toBeCloseTo(before[objectIndex][cornerIndex].y, 8);
        });
      });
    } finally {
      useEditorStore.setState({
        canvas: originalState.canvas,
        clearSelection: originalState.clearSelection,
        syncCanvasToStore: originalState.syncCanvasToStore,
        requestLayerSync: originalState.requestLayerSync,
        saveState: originalState.saveState,
      });
    }
  });
});
