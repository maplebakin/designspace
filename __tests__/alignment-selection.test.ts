import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as fabric from 'fabric';
import { isActiveSelection } from '../src/editor/utils/typeGuards';

const storeMocks = vi.hoisted(() => ({
  syncCanvasToStore: vi.fn(),
  saveState: vi.fn(),
  syncSelectionFromCanvas: vi.fn(),
}));

vi.mock('../src/editor/state/editorStore', () => ({
  useEditorStore: {
    getState: () => storeMocks,
  },
}));

vi.mock('../src/editor/state/useCanvasStore', () => ({
  useCanvasStore: {
    getState: () => ({ width: 1000, height: 1000 }),
  },
}));

import {
  alignMiddle,
  distributeHorizontally,
  spaceWithExactHorizontalGap,
  spaceWithExactVerticalGap,
} from '../src/editor/fabric/alignment';

describe('Fabric multi-selection alignment', () => {
  let canvas: fabric.Canvas;

  beforeEach(() => {
    const canvasElement = document.createElement('canvas');
    canvasElement.width = 1000;
    canvasElement.height = 1000;
    canvas = new fabric.Canvas(canvasElement);
    vi.clearAllMocks();
  });

  afterEach(() => {
    canvas.dispose();
  });

  const addCenteredCard = (left: number, top: number, width = 100, height = 160) => {
    const card = new fabric.Rect({
      left,
      top,
      width,
      height,
      originX: 'center',
      originY: 'center',
    });
    canvas.add(card);
    return card;
  };

  it('lines selected center-origin cards up with each other and keeps them selected', () => {
    const first = addCenteredCard(200, 250);
    const second = addCenteredCard(500, 400);
    const third = addCenteredCard(800, 310);

    canvas.setActiveObject(new fabric.ActiveSelection([first, second, third], { canvas }));

    alignMiddle(canvas);

    const centers = [first, second, third].map((card) => {
      const rect = card.getBoundingRect();
      return rect.top + rect.height / 2;
    });

    expect(centers[0]).toBeCloseTo(centers[1], 5);
    expect(centers[1]).toBeCloseTo(centers[2], 5);
    expect(isActiveSelection(canvas.getActiveObject())).toBe(true);
    expect((canvas.getActiveObject() as fabric.ActiveSelection).getObjects()).toHaveLength(3);
    expect(storeMocks.syncSelectionFromCanvas).toHaveBeenCalled();
    expect(storeMocks.saveState).toHaveBeenCalled();
  });

  it('spaces center-origin cards evenly by their visual edges and preserves the row selection', () => {
    const first = addCenteredCard(200, 300, 100, 160);
    const second = addCenteredCard(420, 300, 140, 160);
    const third = addCenteredCard(800, 300, 100, 160);

    canvas.setActiveObject(new fabric.ActiveSelection([first, second, third], { canvas }));

    distributeHorizontally(canvas);

    const cards = [first, second, third]
      .map((card) => card.getBoundingRect())
      .sort((a, b) => a.left - b.left);
    const firstGap = cards[1].left - (cards[0].left + cards[0].width);
    const secondGap = cards[2].left - (cards[1].left + cards[1].width);

    expect(firstGap).toBeCloseTo(secondGap, 5);
    expect(isActiveSelection(canvas.getActiveObject())).toBe(true);
    expect((canvas.getActiveObject() as fabric.ActiveSelection).getObjects()).toHaveLength(3);
  });

  it('spaces scaled center-origin objects by an exact horizontal visual gap', () => {
    const first = addCenteredCard(200, 300, 100, 160);
    const second = addCenteredCard(500, 360, 140, 160);
    second.set({ scaleX: 1.5, scaleY: 0.75 });
    second.setCoords();

    canvas.setActiveObject(new fabric.ActiveSelection([first, second], { canvas }));
    const firstBefore = first.getBoundingRect();
    const secondBefore = second.getBoundingRect();
    spaceWithExactHorizontalGap(canvas, 30);

    const rects = [first, second].map((card) => card.getBoundingRect()).sort((a, b) => a.left - b.left);
    expect(rects[0].left).toBeCloseTo(firstBefore.left, 5);
    expect(rects[1].left - (rects[0].left + rects[0].width)).toBeCloseTo(30, 5);
    expect(second.getBoundingRect().top).toBeCloseTo(secondBefore.top, 5);
    expect(isActiveSelection(canvas.getActiveObject())).toBe(true);
  });

  it('spaces center-origin objects vertically and keeps multi-selection active', () => {
    const first = addCenteredCard(300, 200, 100, 100);
    const second = addCenteredCard(420, 500, 100, 140);
    canvas.setActiveObject(new fabric.ActiveSelection([first, second], { canvas }));

    const firstBefore = first.getBoundingRect();
    spaceWithExactVerticalGap(canvas, 20);

    const rects = [first, second].map((card) => card.getBoundingRect()).sort((a, b) => a.top - b.top);
    expect(rects[0].top).toBeCloseTo(firstBefore.top, 5);
    expect(rects[1].top - (rects[0].top + rects[0].height)).toBeCloseTo(20, 5);
    expect(isActiveSelection(canvas.getActiveObject())).toBe(true);
  });

  it('leaves guide objects untouched when an active selection contains one', () => {
    const first = addCenteredCard(200, 300);
    const second = addCenteredCard(500, 300);
    const guide = new fabric.Rect({
      left: 900,
      top: 300,
      width: 40,
      height: 40,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    });
    (guide as any).isGuide = true;
    canvas.add(guide);
    const guideBefore = guide.getBoundingRect();
    canvas.setActiveObject(new fabric.ActiveSelection([first, second, guide], { canvas }));

    spaceWithExactHorizontalGap(canvas, 30);

    const guideAfter = guide.getBoundingRect();
    expect(guideAfter.left).toBeCloseTo(guideBefore.left, 5);
    expect(guideAfter.top).toBeCloseTo(guideBefore.top, 5);
  });
});
