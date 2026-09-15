import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fabric from 'fabric';
import { setLayerRevivalForTests, syncCanvasLayers } from '../src/editor/state/layerSyncHandler';
import { serializeCanvasObjects } from '../src/editor/utils/serialization';

const rectData = (id: string, left: number): any => ({
  type: 'rect',
  id,
  left,
  top: 40,
  width: 48,
  height: 36,
  fill: '#3366ff',
  zIndex: 100,
  __zIndex: 100,
});

describe('layer synchronization contract', () => {
  let canvas: fabric.Canvas;
  let element: HTMLCanvasElement;

  beforeEach(() => {
    element = document.createElement('canvas');
    document.body.appendChild(element);
    canvas = new fabric.Canvas(element, {
      width: 800,
      height: 600,
      enableRetinaScaling: false,
      renderOnAddRemove: false,
    });
  });

  afterEach(() => {
    setLayerRevivalForTests(null);
    canvas.dispose();
    element.remove();
  });

  it('preserves live Fabric object identity and avoids revival for a no-op scene sync', async () => {
    const { type: _type, ...rectOptions } = rectData('stable-object', 120);
    const object = new fabric.Rect(rectOptions);
    object.id = 'stable-object';
    (object as any).zIndex = 100;
    (object as any).__zIndex = 100;
    const imageSource = document.createElement('canvas');
    imageSource.width = 4;
    imageSource.height = 4;
    const image = new fabric.FabricImage(imageSource, { left: 240, top: 120 });
    (image as any).id = 'stable-image';
    (image as any).zIndex = 100;
    (image as any).__zIndex = 100;
    canvas.add(object, image);
    const serialized = serializeCanvasObjects(canvas) as any[];
    const selection = new fabric.ActiveSelection([object, image], { canvas });
    canvas.setActiveObject(selection);
    const revivalSpy = vi.fn(async () => null);
    setLayerRevivalForTests(revivalSpy);

    const result = await syncCanvasLayers(serialized as any, canvas, { isCurrent: () => true });

    expect(result?.changed).toBe(false);
    expect(canvas.getObjects()).toHaveLength(2);
    expect(canvas.getObjects()[0]).toBe(object);
    expect(canvas.getObjects()[1]).toBe(image);
    expect(canvas.getActiveObject()).toBe(selection);
    expect(revivalSpy).not.toHaveBeenCalled();
  });

  it('drops stale held revival work and installs only the newest desired state', async () => {
    let releaseFirstRevival!: () => void;
    const firstRevival = new Promise<void>((resolve) => {
      releaseFirstRevival = resolve;
    });
    const originalEnliven = fabric.util.enlivenObjects.bind(fabric.util);
    let enlivenCount = 0;
    const revivalSpy = vi.fn(async (serialized: any) => {
      enlivenCount += 1;
      if (enlivenCount === 1) await firstRevival;
      const revived = await originalEnliven([serialized]) as fabric.Object[];
      return revived[0] ?? null;
    });
    setLayerRevivalForTests(revivalSpy);

    const oldDesired = [rectData('old-object', 100)];
    const newestDesired = [rectData('new-object', 420)];
    const oldWork = syncCanvasLayers(oldDesired as any, canvas);
    await Promise.resolve();
    const newestWork = syncCanvasLayers(newestDesired as any, canvas);
    releaseFirstRevival();

    await expect(oldWork).resolves.toBeNull();
    const newestResult = await newestWork;
    expect(newestResult?.changed).toBe(true);
    expect(canvas.getObjects().map((object) => (object as any).id)).toEqual(['new-object']);
    expect((canvas.getObjects()[0] as any).left).toBeCloseTo(420, 5);
    expect(new Set(canvas.getObjects().map((object) => (object as any).id)).size).toBe(1);
    expect(enlivenCount).toBe(2);
  });
});
