import { describe, expect, it } from 'vitest';
import {
  bodyDelta,
  bodyPoint,
  bodyPointToPagePoint,
  bodyRectangle,
  bodyRectangleToPageRectangle,
  buildExclusionRectangle,
  clampPointToRectangle,
  clampRectanglePositionToBounds,
  expandRectangleByPadding,
  findRectangleCollisions,
  fitRectangleWithinBounds,
  getBoundingRectangle,
  getDocumentColumnRectangles,
  getDocumentLayoutRectangles,
  getRectangleOverflow,
  intersectRectangles,
  isRectangleWithinBounds,
  layoutDeltaToViewportDelta,
  moveRectangleWithoutCollisions,
  normalizeDocumentColumnCount,
  normalizeRectanglePadding,
  pagePoint,
  pagePointToBodyPoint,
  pagePointToViewportPoint,
  pageRectangle,
  pageRectangleToBodyRectangle,
  rectanglesOverlap,
  resizeRectangleWithoutCollisions,
  resolveInitialRectangleOverlaps,
  viewportDelta,
  viewportDeltaToLayoutDelta,
  viewportPoint,
  viewportPointToPagePoint,
  type BodyRectangle,
  type CollisionObstacle,
} from '../src/document/layout';

const bodyObstacle = (
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

describe('document coordinate spaces', () => {
  it('converts page points and rectangles to body coordinates reversibly', () => {
    const bodyBoundsOnPage = pageRectangle(72, 48, 672, 912);
    const onPage = pagePoint(100, 120);
    const inBody = pagePointToBodyPoint(onPage, bodyBoundsOnPage);

    expect(inBody).toEqual({
      coordinateSpace: 'body',
      xPx: 28,
      yPx: 72,
    });
    expect(bodyPointToPagePoint(inBody, bodyBoundsOnPage)).toEqual(onPage);

    const pageImage = pageRectangle(92, 88, 240, 160);
    const bodyImage = pageRectangleToBodyRectangle(
      pageImage,
      bodyBoundsOnPage
    );
    expect(bodyImage).toEqual({
      coordinateSpace: 'body',
      leftPx: 20,
      topPx: 40,
      widthPx: 240,
      heightPx: 160,
      rightPx: 260,
      bottomPx: 200,
    });
    expect(bodyRectangleToPageRectangle(
      bodyImage,
      bodyBoundsOnPage
    )).toEqual(pageImage);
  });

  it('converts viewport values at any zoom without creating persisted scale', () => {
    const bodyMove = viewportDeltaToLayoutDelta(
      viewportDelta(150, -75),
      1.5,
      'body'
    );
    expect(bodyMove).toEqual({
      coordinateSpace: 'body',
      xPx: 100,
      yPx: -50,
    });
    expect(layoutDeltaToViewportDelta(bodyDelta(100, -50), 1.5)).toEqual({
      coordinateSpace: 'viewport',
      xPx: 150,
      yPx: -75,
    });
    expect(viewportDeltaToLayoutDelta(
      viewportDelta(25, 40),
      0,
      'page'
    )).toMatchObject({ xPx: 25, yPx: 40 });

    const viewportOrigin = viewportPoint(10, 20);
    const pointOnPage = viewportPointToPagePoint(
      viewportPoint(210, 120),
      viewportOrigin,
      2
    );
    expect(pointOnPage).toEqual({
      coordinateSpace: 'page',
      xPx: 100,
      yPx: 50,
    });
    expect(pagePointToViewportPoint(
      pointOnPage,
      viewportOrigin,
      2
    )).toEqual(viewportPoint(210, 120));
  });
});

describe('document page, body, and column geometry', () => {
  const margins = {
    topIn: 0.5,
    bottomIn: 0.75,
    innerIn: 0.8,
    outerIn: 0.45,
  };

  it('derives mirrored page/body rectangles and deterministic columns', () => {
    const recto = getDocumentLayoutRectangles({
      widthIn: 8.5,
      heightIn: 11,
      margins,
      folioNumber: 49,
      columnCount: 3,
      columnGapPx: 24,
    });
    const verso = getDocumentLayoutRectangles({
      widthIn: 8.5,
      heightIn: 11,
      margins,
      folioNumber: 50,
      columnCount: 3,
      columnGapPx: 24,
    });

    expect(recto.page).toEqual(pageRectangle(0, 0, 816, 1056));
    expect(recto.bodyOnPage.leftPx).toBeCloseTo(76.8);
    expect(recto.bodyOnPage).toMatchObject({
      coordinateSpace: 'page',
      topPx: 48,
      widthPx: 696,
      heightPx: 936,
      rightPx: 772.8,
      bottomPx: 984,
    });
    expect(recto.body).toEqual(bodyRectangle(0, 0, 696, 936));
    expect(recto.columnWidthPx).toBe(216);
    expect(recto.columns).toEqual([
      bodyRectangle(0, 0, 216, 936),
      bodyRectangle(240, 0, 216, 936),
      bodyRectangle(480, 0, 216, 936),
    ]);
    expect(verso.bodyOnPage.leftPx).toBeCloseTo(43.2);
    expect(verso.body.widthPx).toBe(recto.body.widthPx);
    expect(verso.columns).toEqual(recto.columns);
  });

  it('bounds malformed column inputs without negative rectangles', () => {
    expect(normalizeDocumentColumnCount(-20)).toBe(1);
    expect(normalizeDocumentColumnCount(99)).toBe(3);
    expect(normalizeDocumentColumnCount(Number.NaN)).toBe(1);

    const collapsed = getDocumentColumnRectangles({
      bodyWidthPx: 40,
      bodyHeightPx: -10,
      columnCount: 3,
      columnGapPx: 999,
    });
    expect(collapsed.columnGapPx).toBe(20);
    expect(collapsed.columnWidthPx).toBe(0);
    expect(collapsed.columns.map((column) => ({
      leftPx: column.leftPx,
      widthPx: column.widthPx,
      heightPx: column.heightPx,
    }))).toEqual([
      { leftPx: 0, widthPx: 0, heightPx: 0 },
      { leftPx: 20, widthPx: 0, heightPx: 0 },
      { leftPx: 40, widthPx: 0, heightPx: 0 },
    ]);
  });
});

describe('document boundaries and exclusions', () => {
  it('separates position clamping, fitting, and overflow reporting', () => {
    const bounds = bodyRectangle(0, 0, 500, 400);
    const outside = bodyRectangle(-20, 350, 100, 100);
    const clamped = clampRectanglePositionToBounds(outside, bounds);
    expect(clamped).toEqual(bodyRectangle(0, 300, 100, 100));
    expect(isRectangleWithinBounds(clamped, bounds)).toBe(true);
    expect(clampPointToRectangle(
      bodyPoint(-20, 900),
      bounds
    )).toEqual(bodyPoint(0, 400));

    const oversized = bodyRectangle(10, 20, 600, 500);
    const anchored = clampRectanglePositionToBounds(oversized, bounds);
    expect(anchored).toEqual(bodyRectangle(0, 0, 600, 500));
    expect(getRectangleOverflow(anchored, bounds)).toEqual({
      topPx: 0,
      rightPx: 100,
      bottomPx: 100,
      leftPx: 0,
    });
    expect(fitRectangleWithinBounds(oversized, bounds)).toEqual(bounds);
  });

  it('builds four-sided, bounded exclusions including caption geometry', () => {
    const bodyBounds = bodyRectangle(0, 0, 300, 240);
    const image = bodyRectangle(100, 80, 200, 120);
    const caption = bodyRectangle(100, 205, 200, 25);
    const padding = {
      topPx: 10,
      rightPx: 20,
      bottomPx: 30,
      leftPx: 40,
    };

    expect(normalizeRectanglePadding(12)).toEqual({
      topPx: 12,
      rightPx: 12,
      bottomPx: 12,
      leftPx: 12,
    });
    expect(normalizeRectanglePadding({
      topPx: -1,
      rightPx: Number.NaN,
      bottomPx: 8,
    })).toEqual({
      topPx: 0,
      rightPx: 0,
      bottomPx: 8,
      leftPx: 0,
    });
    expect(getBoundingRectangle([image, caption])).toEqual(
      bodyRectangle(100, 80, 200, 150)
    );
    expect(expandRectangleByPadding(
      bodyRectangle(100, 80, 200, 150),
      padding
    )).toEqual(bodyRectangle(60, 70, 260, 190));
    expect(buildExclusionRectangle({
      occupiedRectangles: [image, caption],
      padding,
      bounds: bodyBounds,
    })).toEqual(bodyRectangle(60, 70, 240, 170));
    expect(buildExclusionRectangle({
      occupiedRectangles: [],
      padding: 12,
      bounds: bodyBounds,
    })).toBeNull();
  });

  it('uses strict intersections so touching edges remain available', () => {
    const left = bodyRectangle(0, 0, 100, 100);
    const touching = bodyRectangle(100, 0, 100, 100);
    const overlapping = bodyRectangle(90, 20, 100, 100);

    expect(intersectRectangles(left, touching)).toBeNull();
    expect(rectanglesOverlap(left, touching)).toBe(false);
    expect(intersectRectangles(left, overlapping)).toEqual(
      bodyRectangle(90, 20, 10, 80)
    );
    expect(rectanglesOverlap(left, overlapping)).toBe(true);
  });
});

describe('deterministic document collision geometry', () => {
  it('returns collisions in stable ID order independent of input order', () => {
    const rectangle = bodyRectangle(100, 100, 100, 100);
    const collisions = findRectangleCollisions(rectangle, [
      bodyObstacle('z-last', 150, 150, 100, 100),
      bodyObstacle('a-first', 50, 50, 100, 100),
      bodyObstacle('touching', 200, 100, 50, 50),
    ]);

    expect(collisions.map((collision) => collision.id)).toEqual([
      'a-first',
      'z-last',
    ]);
  });

  it('sweeps movement to the nearest obstacle and clamps to boundaries', () => {
    const start = bodyRectangle(0, 100, 100, 100);
    const moved = moveRectangleWithoutCollisions({
      start,
      desiredOrigin: bodyPoint(300, 100),
      obstacles: [bodyObstacle('fixed', 180, 100, 100, 100)],
      bounds: bodyRectangle(0, 0, 400, 400),
    });

    expect(moved.rectangle.leftPx).toBeCloseTo(80);
    expect(moved.rectangle.topPx).toBe(100);
    expect(moved.travelFraction).toBeCloseTo(80 / 300);
    expect(moved.blockingObstacleIds).toEqual(['fixed']);
    expect(moved.initialCollisionIds).toEqual([]);
    expect(rectanglesOverlap(
      moved.rectangle,
      bodyRectangle(180, 100, 100, 100)
    )).toBe(false);

    const boundaryOnly = moveRectangleWithoutCollisions({
      start,
      desiredOrigin: bodyPoint(900, -100),
      obstacles: [],
      bounds: bodyRectangle(0, 0, 400, 400),
    });
    expect(boundaryOnly.rectangle).toEqual(bodyRectangle(
      300,
      0,
      100,
      100
    ));
  });

  it('stops diagonal movement at the same result for any obstacle order', () => {
    const start = bodyRectangle(0, 0, 50, 50);
    const near = bodyObstacle('near', 100, 100, 50, 50);
    const far = bodyObstacle('far', 180, 180, 50, 50);
    const move = (obstacles: readonly CollisionObstacle<'body'>[]) =>
      moveRectangleWithoutCollisions({
        start,
        desiredOrigin: bodyPoint(200, 200),
        obstacles,
      });

    expect(move([near, far])).toEqual(move([far, near]));
    expect(move([near, far]).rectangle).toEqual(
      bodyRectangle(50, 50, 50, 50)
    );
    expect(move([near, far]).blockingObstacleIds).toEqual(['near']);
  });

  it('resolves initial overlaps to the nearest deterministic edge', () => {
    const result = resolveInitialRectangleOverlaps({
      rectangle: bodyRectangle(100, 100, 50, 50),
      obstacles: [bodyObstacle('occupied', 100, 100, 100, 100)],
      bounds: bodyRectangle(0, 0, 300, 300),
    });

    expect(result).toEqual({
      rectangle: bodyRectangle(100, 50, 50, 50),
      resolved: true,
      collisionIds: [],
    });
  });

  it('reports an unresolved overlap when bounds have no safe position', () => {
    const result = resolveInitialRectangleOverlaps({
      rectangle: bodyRectangle(25, 25, 50, 50),
      obstacles: [bodyObstacle('full-body', 0, 0, 100, 100)],
      bounds: bodyRectangle(0, 0, 100, 100),
    });

    expect(result.resolved).toBe(false);
    expect(result.rectangle).toEqual(bodyRectangle(25, 25, 50, 50));
    expect(result.collisionIds).toEqual(['full-body']);
  });

  it('stops resize at the first collision and respects printable bounds', () => {
    const start = bodyRectangle(0, 0, 100, 100);
    const collisionLimited = resizeRectangleWithoutCollisions({
      start,
      desiredWidthPx: 300,
      desiredHeightPx: 100,
      obstacles: [bodyObstacle('right-image', 180, 0, 50, 300)],
      bounds: bodyRectangle(0, 0, 400, 400),
    });

    expect(collisionLimited.rectangle.widthPx).toBeCloseTo(180, 8);
    expect(collisionLimited.rectangle.heightPx).toBe(100);
    expect(collisionLimited.resizeFraction).toBeCloseTo(0.4, 8);
    expect(collisionLimited.blockingObstacleIds).toEqual(['right-image']);
    expect(rectanglesOverlap(
      collisionLimited.rectangle,
      bodyRectangle(180, 0, 50, 300)
    )).toBe(false);

    const boundaryLimited = resizeRectangleWithoutCollisions({
      start,
      desiredWidthPx: 900,
      desiredHeightPx: 900,
      obstacles: [],
      bounds: bodyRectangle(0, 0, 150, 140),
    });
    expect(boundaryLimited.rectangle).toEqual(
      bodyRectangle(0, 0, 150, 140)
    );
    expect(boundaryLimited.resizeFraction).toBe(1);
  });

  it('keeps body rectangle types usable for multiple independent images', () => {
    const images: BodyRectangle[] = [
      bodyRectangle(10, 20, 100, 80),
      bodyRectangle(130, 20, 100, 80),
    ];
    const exclusion = buildExclusionRectangle({
      occupiedRectangles: images,
      padding: 8,
    });
    expect(exclusion).toEqual(bodyRectangle(2, 12, 236, 96));
  });
});
