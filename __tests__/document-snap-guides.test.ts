import { describe, expect, it } from 'vitest';
import {
  bodyPoint,
  bodyRectangle,
  snapDocumentRectangle,
  viewportDelta,
  viewportDeltaToLayoutDelta,
} from '../src/document/layout';

describe('document layout snapping', () => {
  it('snaps edges, centres, and nearby geometry in unzoomed body space', () => {
    const result = snapDocumentRectangle({
      rectangle: bodyRectangle(80, 120, 120, 80),
      desiredOrigin: bodyPoint(196, 202),
      bounds: bodyRectangle(0, 0, 640, 900),
      columns: [
        bodyRectangle(0, 0, 200, 900),
        bodyRectangle(220, 0, 200, 900),
      ],
      nearby: [bodyRectangle(360, 202, 100, 100)],
      thresholdPx: 8,
    });

    expect(result.rectangle.leftPx).toBe(200);
    expect(result.rectangle.topPx).toBe(202);
    expect(result.guides).toEqual(expect.arrayContaining([
      expect.objectContaining({ axis: 'x', positionPx: 320 }),
      expect.objectContaining({ axis: 'y', positionPx: 202 }),
    ]));
  });

  it('keeps snapping invariant when the editor zoom changes', () => {
    const layoutAtLowZoom = viewportDeltaToLayoutDelta(
      viewportDelta(80, 40),
      0.5,
      'body'
    );
    const layoutAtHighZoom = viewportDeltaToLayoutDelta(
      viewportDelta(160, 80),
      2,
      'body'
    );
    expect(layoutAtLowZoom).toMatchObject({ xPx: 160, yPx: 80 });
    expect(layoutAtHighZoom).toMatchObject({ xPx: 80, yPx: 40 });
  });
});
