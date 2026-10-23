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
});
