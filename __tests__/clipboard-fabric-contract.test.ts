import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fabric from 'fabric';
import {
  clearClipboard,
  copySelection,
  pasteFromClipboard,
} from '../src/editor/services/clipboardService';
import { useEditorStore } from '../src/editor/state/editorStore';
import { serializeCanvasObjects } from '../src/editor/utils/serialization';

const readCorners = (object: fabric.Object) => {
  object.setCoords();
  return object.getCoords().map((point) => ({ x: point.x, y: point.y }));
};

const expectCornersOffset = (
  actual: readonly { x: number; y: number }[],
  expected: readonly { x: number; y: number }[],
  offset = 20,
) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((point, index) => {
    expect(point.x).toBeCloseTo(expected[index].x + offset, 4);
    expect(point.y).toBeCloseTo(expected[index].y + offset, 4);
  });
};

const makeShape = (id: string, options: Partial<fabric.IRectOptions> = {}) => {
  const shape = new fabric.Rect({
    left: 180,
    top: 150,
    width: 48,
    height: 32,
    scaleX: 1.7,
    scaleY: 0.65,
    angle: 23,
    opacity: 0.63,
    ...options,
  });
  shape.id = id;
  return shape;
};

describe('clipboard Fabric revival contract', () => {
  let element: HTMLCanvasElement;
  let canvas: fabric.Canvas;
  let originalState: ReturnType<typeof useEditorStore.getState>;

  beforeEach(() => {
    element = document.createElement('canvas');
    document.body.appendChild(element);
    canvas = new fabric.Canvas(element, { width: 800, height: 600 });
    originalState = useEditorStore.getState();
    useEditorStore.setState({
      canvas,
      requestLayerSync: vi.fn(),
      saveState: vi.fn(),
      syncCanvasToStore: vi.fn(),
      selectObjectById: (id: string) => {
        const object = canvas.getObjects().find((candidate) => (candidate as any).id === id);
        if (object) canvas.setActiveObject(object);
      },
      selectObjectsByIds: (ids: string[]) => {
        const objects = canvas.getObjects().filter((candidate) => ids.includes(String((candidate as any).id)));
        if (objects.length > 0) canvas.setActiveObject(new fabric.ActiveSelection(objects, { canvas }));
      },
      reportCommittedCanvasObjectBatch: vi.fn(),
    } as any);
    clearClipboard();
  });

  afterEach(() => {
    clearClipboard();
    useEditorStore.setState(originalState as any);
    canvas.dispose();
    element.remove();
  });

  it('preserves transformed appearance when copying an ActiveSelection without deselection', async () => {
    const first = makeShape('source-first');
    const second = makeShape('source-second', {
      left: 330,
      top: 260,
      width: 42,
      height: 28,
      angle: -11,
      opacity: 0.41,
    });
    canvas.add(first, second);
    const selection = new fabric.ActiveSelection([first, second], { canvas });
    canvas.setActiveObject(selection);
    selection.set({ left: 270, top: 210, scaleX: 1.25, scaleY: 0.78, angle: 31 });
    selection.setCoords();

    const canonical = serializeCanvasObjects(canvas) as any[];
    const expectedObjects = await fabric.util.enlivenObjects(canonical) as fabric.Object[];
    const expected = expectedObjects.map(readCorners);
    expectedObjects.forEach((object) => object.dispose());
    expect(await copySelection()).toBe(true);
    expect(canvas.getActiveObject()).toBe(selection);
    expect(await pasteFromClipboard()).toBe(true);
    expect(canvas.getActiveObject()).toBeTruthy();
    // Measuring after the paste selection is discarded reads the page-space
    // child geometry; the copy/paste operation itself must not require this.
    canvas.discardActiveObject();

    const pasted = canvas.getObjects().filter((object) => object !== first && object !== second);
    expect(pasted).toHaveLength(2);
    expect(pasted.map((object) => (object as any).id)).not.toContain('source-first');
    expect(pasted.map((object) => (object as any).id)).not.toContain('source-second');
    pasted.forEach((object, index) => expectCornersOffset(readCorners(object), expected[index]));
    expect(pasted[0].opacity).toBeCloseTo(first.opacity ?? 1, 5);
    expect(pasted[1].opacity).toBeCloseTo(second.opacity ?? 1, 5);
  });

  it('gives transformed grouped pastes recursively fresh IDs while preserving child geometry', async () => {
    const image = makeShape('group-image');
    const shape = new fabric.Rect({ left: 24, top: 12, width: 34, height: 26, opacity: 0.4 });
    shape.id = 'group-shape';
    const group = new fabric.Group([image, shape], {
      left: 260,
      top: 220,
      scaleX: 1.4,
      scaleY: 0.72,
      angle: -19,
    });
    group.id = 'source-group';
    canvas.add(group);
    canvas.setActiveObject(group);
    const expectedChildren = group.getObjects().map(readCorners);
    expect(await copySelection()).toBe(true);
    expect(await pasteFromClipboard()).toBe(true);
    canvas.discardActiveObject();

    const pastedGroup = canvas.getObjects().find((object) => object !== group) as fabric.Group;
    expect(pastedGroup?.type).toBe('group');
    expect(pastedGroup.id).not.toBe(group.id);
    const sourceIds = new Set(['source-group', 'group-image', 'group-shape']);
    const pastedIds = new Set<string>();
    const collectIds = (object: fabric.Object) => {
      const id = String((object as any).id);
      expect(sourceIds.has(id)).toBe(false);
      expect(pastedIds.has(id)).toBe(false);
      pastedIds.add(id);
      if (typeof (object as any).getObjects === 'function') {
        (object as fabric.Group).getObjects().forEach(collectIds);
      }
    };
    collectIds(pastedGroup);
    pastedGroup.getObjects().forEach((object, index) => {
      expectCornersOffset(readCorners(object), expectedChildren[index]);
    });
    expect(pastedGroup.getObjects().find((object) => object.type === 'rect')).toBeInstanceOf(fabric.Rect);
  });
});
