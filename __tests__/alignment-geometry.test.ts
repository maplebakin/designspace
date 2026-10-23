import { describe, expect, it } from 'vitest';
import {
  calculateAlignmentDeltaToBounds,
  calculateDistributionDeltas,
  calculateExactGapDeltas,
} from '../src/editor/fabric/alignmentGeometry';

describe('selection alignment geometry', () => {
  it('aligns object centers to the current selection rather than the page', () => {
    const bounds = { left: 100, top: 200, width: 600, height: 300 };
    const card = { left: 180, top: 220, width: 100, height: 140 };

    expect(calculateAlignmentDeltaToBounds(card, bounds, 'middle')).toEqual({
      dx: 0,
      dy: 60,
    });
    expect(calculateAlignmentDeltaToBounds(card, bounds, 'center')).toEqual({
      dx: 170,
      dy: 0,
    });
  });

  it('aligns visual edges correctly for differently sized objects', () => {
    const bounds = { left: 40, top: 80, width: 500, height: 400 };
    const object = { left: 160, top: 190, width: 120, height: 150 };

    expect(calculateAlignmentDeltaToBounds(object, bounds, 'left').dx).toBe(-120);
    expect(calculateAlignmentDeltaToBounds(object, bounds, 'right').dx).toBe(260);
    expect(calculateAlignmentDeltaToBounds(object, bounds, 'top').dy).toBe(-110);
    expect(calculateAlignmentDeltaToBounds(object, bounds, 'bottom').dy).toBe(140);
  });

  it('distributes cards with equal horizontal visual gaps and anchored outer edges', () => {
    const bounds = { left: 100, top: 100, width: 700, height: 300 };
    const rects = [
      { left: 100, top: 120, width: 100, height: 160 },
      { left: 260, top: 120, width: 150, height: 160 },
      { left: 700, top: 120, width: 100, height: 160 },
    ];

    const deltas = calculateDistributionDeltas(rects, bounds, 'horizontal');
    const moved = rects.map((rect, index) => ({
      ...rect,
      left: rect.left + deltas[index].dx,
    }));

    expect(moved[0].left).toBe(100);
    expect(moved[2].left + moved[2].width).toBe(800);

    const firstGap = moved[1].left - (moved[0].left + moved[0].width);
    const secondGap = moved[2].left - (moved[1].left + moved[1].width);
    expect(firstGap).toBe(secondGap);
    expect(firstGap).toBe(175);
  });

  it('distributes vertically and keeps deltas mapped to original object order', () => {
    const bounds = { left: 50, top: 50, width: 300, height: 700 };
    const rects = [
      { left: 100, top: 650, width: 100, height: 100 },
      { left: 100, top: 50, width: 100, height: 100 },
      { left: 100, top: 250, width: 100, height: 200 },
    ];

    const deltas = calculateDistributionDeltas(rects, bounds, 'vertical');
    const tops = rects.map((rect, index) => rect.top + deltas[index].dy);

    expect(tops[1]).toBe(50);
    expect(tops[2]).toBe(300);
    expect(tops[0]).toBe(650);
  });

  it('sets exact horizontal gaps for different widths while anchoring the leftmost object', () => {
    const rects = [
      { left: 420, top: 80, width: 60, height: 90 },
      { left: 100, top: 80, width: 120, height: 90 },
      { left: 260, top: 80, width: 80, height: 90 },
    ];
    const deltas = calculateExactGapDeltas(rects, 25, 'horizontal');
    const moved = rects.map((rect, index) => ({
      ...rect,
      left: rect.left + deltas[index].dx,
    })).sort((a, b) => a.left - b.left);

    expect(moved[0].left).toBe(100);
    expect(moved[1].left - (moved[0].left + moved[0].width)).toBe(25);
    expect(moved[2].left - (moved[1].left + moved[1].width)).toBe(25);
  });

  it('sets exact vertical gaps for different heights and supports zero gap', () => {
    const rects = [
      { left: 40, top: 300, width: 60, height: 70 },
      { left: 40, top: 80, width: 60, height: 100 },
      { left: 40, top: 200, width: 60, height: 50 },
    ];
    const deltas = calculateExactGapDeltas(rects, 0, 'vertical');
    const moved = rects.map((rect, index) => ({
      ...rect,
      top: rect.top + deltas[index].dy,
    })).sort((a, b) => a.top - b.top);

    expect(moved[0].top).toBe(80);
    expect(moved[1].top).toBe(180);
    expect(moved[2].top).toBe(230);
    expect(moved[1].top - (moved[0].top + moved[0].height)).toBe(0);
    expect(moved[2].top - (moved[1].top + moved[1].height)).toBe(0);
  });

  it('rejects invalid gaps without moving objects', () => {
    const rects = [
      { left: 0, top: 0, width: 100, height: 100 },
      { left: 200, top: 0, width: 100, height: 100 },
    ];

    expect(calculateExactGapDeltas(rects, -1, 'horizontal')).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
    ]);
    expect(calculateExactGapDeltas(rects, Number.NaN, 'horizontal')).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
    ]);
  });
});
