import { describe, expect, it } from 'vitest';
import {
  bodyDelta,
  bodyPoint,
  bodyRectangle,
  clampDocumentImageGroupLayoutToBounds,
  fitDocumentImageGroupLayoutWithinBounds,
  getDocumentImageGroupCollisionObstacle,
  getDocumentImageGroupFitScale,
  layoutDocumentImageGroup,
  moveDocumentImageGroupWithoutCollisions,
  resolveInitialDocumentImageGroupOverlaps,
  scaleDocumentImageGroupLayout,
  translateDocumentImageGroupLayout,
  type CollisionObstacle,
  type DocumentImageGroupChildGeometry,
  type DocumentImageGroupLayout,
} from '../src/document/layout';

const child = (
  imageId: string,
  widthPx: number,
  heightPx: number,
  captionHeightPx = 0,
  captionSpacingPx = 0
): DocumentImageGroupChildGeometry => ({
  imageId,
  widthPx,
  heightPx,
  captionHeightPx,
  captionSpacingPx,
});

const obstacle = (
  id: string,
  leftPx: number,
  topPx: number,
  widthPx: number,
  heightPx: number
): CollisionObstacle<'body'> => ({
  id,
  rectangle: bodyRectangle(
    leftPx,
    topPx,
    widthPx,
    heightPx
  ),
});

const rowLayout = (): DocumentImageGroupLayout =>
  layoutDocumentImageGroup({
    kind: 'row',
    origin: bodyPoint(10, 20),
    gapPx: 16,
    children: [
      child('left', 100, 80, 20, 6),
      child('right', 120, 60, 40, 4),
    ],
  });

describe('document image group row layout', () => {
  it('top-aligns ordered images and includes independent captions in bounds', () => {
    const layout = rowLayout();

    expect(layout).toMatchObject({
      kind: 'row',
      origin: bodyPoint(10, 20),
      gapPx: 16,
      sharedWidth: false,
      sharedWidthPx: null,
    });
    expect(layout.children.map((item) => item.imageId)).toEqual([
      'left',
      'right',
    ]);
    expect(layout.children[0]).toMatchObject({
      imageRectangle: bodyRectangle(10, 20, 100, 80),
      captionRectangle: bodyRectangle(10, 106, 100, 20),
      occupiedRectangle: bodyRectangle(10, 20, 100, 106),
      aspectRatio: 1.25,
    });
    expect(layout.children[1]).toMatchObject({
      imageRectangle: bodyRectangle(126, 20, 120, 60),
      captionRectangle: bodyRectangle(126, 84, 120, 40),
      occupiedRectangle: bodyRectangle(126, 20, 120, 104),
      aspectRatio: 2,
    });
    expect(layout.bounds).toEqual(bodyRectangle(10, 20, 236, 106));
  });

  it('does not consume caption spacing when no caption has occupied height', () => {
    const layout = layoutDocumentImageGroup({
      kind: 'row',
      origin: bodyPoint(0, 0),
      gapPx: 10,
      children: [
        child('captionless', 80, 60, 0, 24),
        child('peer', 40, 50),
      ],
    });

    expect(layout.children[0].captionRectangle).toBeNull();
    expect(layout.children[0].occupiedRectangle).toEqual(
      bodyRectangle(0, 0, 80, 60)
    );
    expect(layout.bounds).toEqual(bodyRectangle(0, 0, 130, 60));
  });
});

describe('document image group stack layout', () => {
  it('places each image after the prior caption block and configured gap', () => {
    const layout = layoutDocumentImageGroup({
      kind: 'stack',
      origin: bodyPoint(10, 20),
      gapPx: 12,
      children: [
        child('top', 120, 80, 20, 6),
        child('bottom', 80, 100, 30, 4),
      ],
    });

    expect(layout.children[0].occupiedRectangle).toEqual(
      bodyRectangle(10, 20, 120, 106)
    );
    expect(layout.children[1]).toMatchObject({
      imageRectangle: bodyRectangle(10, 138, 80, 100),
      captionRectangle: bodyRectangle(10, 242, 80, 30),
      occupiedRectangle: bodyRectangle(10, 138, 80, 134),
    });
    expect(layout.bounds).toEqual(bodyRectangle(10, 20, 120, 252));
  });

  it('uses the first ordered width by default and preserves aspect ratios', () => {
    const layout = layoutDocumentImageGroup({
      kind: 'stack',
      origin: bodyPoint(0, 0),
      gapPx: 8,
      sharedWidth: true,
      children: [
        child('wide', 120, 80),
        child('portrait', 80, 100),
      ],
    });

    expect(layout.sharedWidthPx).toBe(120);
    expect(layout.children.map((item) => item.imageRectangle)).toEqual([
      bodyRectangle(0, 0, 120, 80),
      bodyRectangle(0, 88, 120, 150),
    ]);
    expect(layout.children.map((item) => item.aspectRatio)).toEqual([
      1.5,
      0.8,
    ]);
  });

  it('honours an explicit shared width without applying it to row groups', () => {
    const stack = layoutDocumentImageGroup({
      kind: 'stack',
      origin: bodyPoint(0, 0),
      gapPx: 5,
      sharedWidth: true,
      sharedWidthPx: 90,
      children: [
        child('wide', 120, 80),
        child('portrait', 80, 100),
      ],
    });
    const row = layoutDocumentImageGroup({
      kind: 'row',
      origin: bodyPoint(0, 0),
      gapPx: 5,
      sharedWidth: true,
      sharedWidthPx: 90,
      children: [
        child('wide', 120, 80),
        child('portrait', 80, 100),
      ],
    });

    expect(stack.children.map((item) => item.imageRectangle)).toEqual([
      bodyRectangle(0, 0, 90, 60),
      bodyRectangle(0, 65, 90, 112.5),
    ]);
    expect(row.sharedWidth).toBe(false);
    expect(row.sharedWidthPx).toBeNull();
    expect(row.children.map((item) => item.imageRectangle.widthPx)).toEqual([
      120,
      80,
    ]);
  });
});

describe('document image group fitting and translation', () => {
  it('translates images, captions, occupied blocks, and bounds atomically', () => {
    const original = rowLayout();
    const translated = translateDocumentImageGroupLayout(
      original,
      bodyDelta(30, -10)
    );

    expect(translated.origin).toEqual(bodyPoint(40, 10));
    expect(translated.bounds).toEqual(bodyRectangle(40, 10, 236, 106));
    expect(translated.children[0].imageRectangle).toEqual(
      bodyRectangle(40, 10, 100, 80)
    );
    expect(translated.children[0].captionRectangle).toEqual(
      bodyRectangle(40, 96, 100, 20)
    );
    expect(original.bounds).toEqual(bodyRectangle(10, 20, 236, 106));
  });

  it('clamps a group as a rigid unit and leaves oversized overflow explicit', () => {
    const bounds = bodyRectangle(0, 0, 300, 200);
    const outside = translateDocumentImageGroupLayout(
      rowLayout(),
      bodyDelta(250, 170)
    );
    const clamped = clampDocumentImageGroupLayoutToBounds(outside, bounds);

    expect(clamped.bounds).toEqual(bodyRectangle(64, 94, 236, 106));
    expect(clamped.children[0].imageRectangle).toEqual(
      bodyRectangle(64, 94, 100, 80)
    );

    const oversized = scaleDocumentImageGroupLayout(rowLayout(), 2);
    const anchored = clampDocumentImageGroupLayoutToBounds(
      oversized,
      bounds
    );
    expect(anchored.bounds).toEqual(bodyRectangle(0, 0, 472, 212));
  });

  it('uniformly fits occupied caption geometry without enlarging', () => {
    const layout = rowLayout();
    const bounds = bodyRectangle(50, 40, 118, 100);
    const result = fitDocumentImageGroupLayoutWithinBounds(layout, bounds);

    expect(getDocumentImageGroupFitScale(layout, bounds)).toBe(0.5);
    expect(result).toMatchObject({
      scale: 0.5,
      fits: true,
    });
    expect(result.layout.bounds).toEqual(
      bodyRectangle(50, 40, 118, 53)
    );
    expect(result.layout.gapPx).toBe(8);
    expect(result.layout.children[0].imageRectangle).toEqual(
      bodyRectangle(50, 40, 50, 40)
    );
    expect(result.layout.children[0].captionRectangle).toEqual(
      bodyRectangle(50, 83, 50, 10)
    );

    const generousBounds = bodyRectangle(0, 0, 500, 500);
    expect(getDocumentImageGroupFitScale(layout, generousBounds)).toBe(1);
  });

  it('normalizes malformed dimensions without creating negative geometry', () => {
    const layout = layoutDocumentImageGroup({
      kind: 'stack',
      origin: bodyPoint(5, 6),
      gapPx: -20,
      sharedWidth: true,
      sharedWidthPx: Number.NaN,
      children: [
        child('first', -10, Number.NaN, -3, -4),
        child('second', 0, 0),
      ],
    });

    expect(layout.gapPx).toBe(0);
    expect(layout.sharedWidthPx).toBe(1);
    expect(layout.children[0].imageRectangle).toEqual(
      bodyRectangle(5, 6, 1, 1)
    );
    expect(layout.children[0].captionRectangle).toBeNull();
    expect(layout.children[1].imageRectangle).toEqual(
      bodyRectangle(5, 7, 1, 1)
    );
    expect(layout.bounds).toEqual(bodyRectangle(5, 6, 1, 2));
  });
});

describe('document image group collision contracts', () => {
  it('exposes one conservative occupied obstacle for peer layout', () => {
    const layout = rowLayout();
    expect(getDocumentImageGroupCollisionObstacle(
      'pair-group',
      layout
    )).toEqual({
      id: 'pair-group',
      rectangle: bodyRectangle(10, 20, 236, 106),
    });
  });

  it('moves all children together and stops the group at the first obstacle', () => {
    const layout = layoutDocumentImageGroup({
      kind: 'row',
      origin: bodyPoint(0, 20),
      gapPx: 10,
      children: [
        child('left', 60, 50),
        child('right', 60, 50),
      ],
    });
    const result = moveDocumentImageGroupWithoutCollisions({
      layout,
      desiredOrigin: bodyPoint(300, 20),
      obstacles: [obstacle('fixed', 200, 0, 40, 100)],
      bounds: bodyRectangle(0, 0, 500, 200),
    });

    expect(result.travelFraction).toBeCloseTo(70 / 300);
    expect(result.blockingObstacleIds).toEqual(['fixed']);
    expect(result.initialCollisionIds).toEqual([]);
    expect(result.layout.bounds).toEqual(bodyRectangle(70, 20, 130, 50));
    expect(result.layout.children.map(
      (item) => item.imageRectangle.leftPx
    )).toEqual([70, 140]);
  });

  it('clamps group movement to body bounds in unzoomed layout units', () => {
    const layout = layoutDocumentImageGroup({
      kind: 'row',
      origin: bodyPoint(0, 20),
      gapPx: 10,
      children: [
        child('left', 60, 50),
        child('right', 60, 50),
      ],
    });
    const result = moveDocumentImageGroupWithoutCollisions({
      layout,
      desiredOrigin: bodyPoint(900, 900),
      obstacles: [],
      bounds: bodyRectangle(0, 0, 300, 200),
    });

    expect(result.travelFraction).toBe(1);
    expect(result.layout.bounds).toEqual(bodyRectangle(170, 150, 130, 50));
    expect(result.layout.origin).toEqual(bodyPoint(170, 150));
  });

  it('resolves initial group overlap deterministically and atomically', () => {
    const layout = layoutDocumentImageGroup({
      kind: 'stack',
      origin: bodyPoint(10, 10),
      gapPx: 10,
      children: [
        child('top', 80, 40),
        child('bottom', 80, 40),
      ],
    });
    const resolution = resolveInitialDocumentImageGroupOverlaps({
      layout,
      obstacles: [obstacle('existing', 0, 0, 100, 100)],
      bounds: bodyRectangle(0, 0, 300, 300),
    });

    expect(resolution.resolved).toBe(true);
    expect(resolution.collisionIds).toEqual([]);
    expect(resolution.layout.bounds).toEqual(
      bodyRectangle(100, 10, 80, 90)
    );
    expect(resolution.layout.children.map(
      (item) => item.imageRectangle.leftPx
    )).toEqual([100, 100]);
  });
});
