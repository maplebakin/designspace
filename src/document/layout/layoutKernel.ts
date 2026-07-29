import {
  DOCUMENT_CSS_PIXELS_PER_INCH,
  getDocumentContentRectanglePx,
  type DocumentSemanticMarginsIn,
} from './pageGeometry';
import {
  bodyRectangle,
  coordinatePoint,
  coordinateRectangle,
  pageRectangle,
  type BodyRectangle,
  type CoordinatePoint,
  type CoordinateRectangle,
  type DocumentCoordinateSpace,
  type PageRectangle,
} from './coordinateSpaces';

export type DocumentColumnCount = 1 | 2 | 3;

export type DocumentLayoutRectangleInput = Readonly<{
  widthIn: number;
  heightIn: number;
  margins: DocumentSemanticMarginsIn;
  folioNumber: number;
  columnCount: number;
  columnGapPx: number;
}>;

export type DocumentLayoutRectangles = Readonly<{
  page: PageRectangle;
  bodyOnPage: PageRectangle;
  body: BodyRectangle;
  columns: readonly BodyRectangle[];
  columnCount: DocumentColumnCount;
  columnGapPx: number;
  columnWidthPx: number;
}>;

export type RectanglePaddingPx = Readonly<{
  topPx: number;
  rightPx: number;
  bottomPx: number;
  leftPx: number;
}>;

export type RectanglePaddingInput = number | Partial<RectanglePaddingPx>;

export type CollisionObstacle<
  Space extends DocumentCoordinateSpace,
> = Readonly<{
  id: string;
  rectangle: CoordinateRectangle<Space>;
}>;

export type CollisionMoveResult<
  Space extends DocumentCoordinateSpace,
> = Readonly<{
  rectangle: CoordinateRectangle<Space>;
  travelFraction: number;
  blockingObstacleIds: readonly string[];
  initialCollisionIds: readonly string[];
}>;

export type InitialOverlapResolution<
  Space extends DocumentCoordinateSpace,
> = Readonly<{
  rectangle: CoordinateRectangle<Space>;
  resolved: boolean;
  collisionIds: readonly string[];
}>;

export type CollisionResizeResult<
  Space extends DocumentCoordinateSpace,
> = Readonly<{
  rectangle: CoordinateRectangle<Space>;
  resizeFraction: number;
  blockingObstacleIds: readonly string[];
  initialCollisionIds: readonly string[];
}>;

const finiteOrZero = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const nonNegativeFinite = (value: unknown) =>
  Math.max(0, finiteOrZero(value));

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export const normalizeDocumentColumnCount = (
  value: unknown
): DocumentColumnCount => {
  const numeric = Number(value);
  const integer = Number.isFinite(numeric) ? Math.trunc(numeric) : 1;
  return clamp(integer, 1, 3) as DocumentColumnCount;
};

export const getDocumentColumnRectangles = ({
  bodyWidthPx,
  bodyHeightPx,
  columnCount,
  columnGapPx,
}: {
  bodyWidthPx: number;
  bodyHeightPx: number;
  columnCount: number;
  columnGapPx: number;
}): Readonly<{
  columns: readonly BodyRectangle[];
  columnCount: DocumentColumnCount;
  columnGapPx: number;
  columnWidthPx: number;
}> => {
  const safeWidth = nonNegativeFinite(bodyWidthPx);
  const safeHeight = nonNegativeFinite(bodyHeightPx);
  const safeCount = normalizeDocumentColumnCount(columnCount);
  const maximumGap = safeCount === 1
    ? 0
    : safeWidth / (safeCount - 1);
  const safeGap = safeCount === 1
    ? 0
    : Math.min(nonNegativeFinite(columnGapPx), maximumGap);
  const columnWidthPx = Math.max(
    0,
    (safeWidth - safeGap * (safeCount - 1)) / safeCount
  );
  const columns = Array.from({ length: safeCount }, (_, index) =>
    bodyRectangle(
      index * (columnWidthPx + safeGap),
      0,
      columnWidthPx,
      safeHeight
    )
  );

  return {
    columns,
    columnCount: safeCount,
    columnGapPx: safeGap,
    columnWidthPx,
  };
};

/**
 * Creates the complete page/body/column geometry in unzoomed layout pixels.
 * `bodyOnPage` has a page origin; `body` and every column have a body origin.
 */
export const getDocumentLayoutRectangles = ({
  widthIn,
  heightIn,
  margins,
  folioNumber,
  columnCount,
  columnGapPx,
}: DocumentLayoutRectangleInput): DocumentLayoutRectangles => {
  const pageWidthPx = nonNegativeFinite(widthIn)
    * DOCUMENT_CSS_PIXELS_PER_INCH;
  const pageHeightPx = nonNegativeFinite(heightIn)
    * DOCUMENT_CSS_PIXELS_PER_INCH;
  const content = getDocumentContentRectanglePx({
    widthIn,
    heightIn,
    margins,
    folioNumber,
  });
  const bodyOnPage = pageRectangle(
    content.xPx,
    content.yPx,
    content.widthPx,
    content.heightPx
  );
  const body = bodyRectangle(
    0,
    0,
    content.widthPx,
    content.heightPx
  );
  const columnGeometry = getDocumentColumnRectangles({
    bodyWidthPx: body.widthPx,
    bodyHeightPx: body.heightPx,
    columnCount,
    columnGapPx,
  });

  return {
    page: pageRectangle(0, 0, pageWidthPx, pageHeightPx),
    bodyOnPage,
    body,
    ...columnGeometry,
  };
};

export const clampPointToRectangle = <
  Space extends DocumentCoordinateSpace,
>(
  point: CoordinatePoint<Space>,
  bounds: CoordinateRectangle<Space>
): CoordinatePoint<Space> => coordinatePoint(
  point.coordinateSpace,
  clamp(point.xPx, bounds.leftPx, bounds.rightPx),
  clamp(point.yPx, bounds.topPx, bounds.bottomPx)
);

/**
 * Clamps only the origin. Oversized rectangles retain their size and anchor
 * to the top/left bound so callers can report the overflow explicitly.
 */
export const clampRectanglePositionToBounds = <
  Space extends DocumentCoordinateSpace,
>(
  rectangle: CoordinateRectangle<Space>,
  bounds: CoordinateRectangle<Space>
): CoordinateRectangle<Space> => {
  const maximumLeft = Math.max(
    bounds.leftPx,
    bounds.rightPx - rectangle.widthPx
  );
  const maximumTop = Math.max(
    bounds.topPx,
    bounds.bottomPx - rectangle.heightPx
  );
  return coordinateRectangle(
    rectangle.coordinateSpace,
    clamp(rectangle.leftPx, bounds.leftPx, maximumLeft),
    clamp(rectangle.topPx, bounds.topPx, maximumTop),
    rectangle.widthPx,
    rectangle.heightPx
  );
};

/**
 * Shrinks an oversized rectangle if necessary, then clamps its origin so the
 * returned rectangle is wholly contained by the bounds.
 */
export const fitRectangleWithinBounds = <
  Space extends DocumentCoordinateSpace,
>(
  rectangle: CoordinateRectangle<Space>,
  bounds: CoordinateRectangle<Space>
): CoordinateRectangle<Space> => {
  const widthPx = Math.min(rectangle.widthPx, bounds.widthPx);
  const heightPx = Math.min(rectangle.heightPx, bounds.heightPx);
  return coordinateRectangle(
    rectangle.coordinateSpace,
    clamp(
      rectangle.leftPx,
      bounds.leftPx,
      bounds.rightPx - widthPx
    ),
    clamp(
      rectangle.topPx,
      bounds.topPx,
      bounds.bottomPx - heightPx
    ),
    widthPx,
    heightPx
  );
};

export const isRectangleWithinBounds = <
  Space extends DocumentCoordinateSpace,
>(
  rectangle: CoordinateRectangle<Space>,
  bounds: CoordinateRectangle<Space>
) => (
  rectangle.leftPx >= bounds.leftPx
  && rectangle.topPx >= bounds.topPx
  && rectangle.rightPx <= bounds.rightPx
  && rectangle.bottomPx <= bounds.bottomPx
);

export const getRectangleOverflow = <
  Space extends DocumentCoordinateSpace,
>(
  rectangle: CoordinateRectangle<Space>,
  bounds: CoordinateRectangle<Space>
): RectanglePaddingPx => ({
  topPx: Math.max(0, bounds.topPx - rectangle.topPx),
  rightPx: Math.max(0, rectangle.rightPx - bounds.rightPx),
  bottomPx: Math.max(0, rectangle.bottomPx - bounds.bottomPx),
  leftPx: Math.max(0, bounds.leftPx - rectangle.leftPx),
});

export const normalizeRectanglePadding = (
  input: RectanglePaddingInput
): RectanglePaddingPx => {
  if (typeof input === 'number') {
    const uniform = nonNegativeFinite(input);
    return {
      topPx: uniform,
      rightPx: uniform,
      bottomPx: uniform,
      leftPx: uniform,
    };
  }
  return {
    topPx: nonNegativeFinite(input.topPx),
    rightPx: nonNegativeFinite(input.rightPx),
    bottomPx: nonNegativeFinite(input.bottomPx),
    leftPx: nonNegativeFinite(input.leftPx),
  };
};

export const expandRectangleByPadding = <
  Space extends DocumentCoordinateSpace,
>(
  rectangle: CoordinateRectangle<Space>,
  paddingInput: RectanglePaddingInput
): CoordinateRectangle<Space> => {
  const padding = normalizeRectanglePadding(paddingInput);
  return coordinateRectangle(
    rectangle.coordinateSpace,
    rectangle.leftPx - padding.leftPx,
    rectangle.topPx - padding.topPx,
    rectangle.widthPx + padding.leftPx + padding.rightPx,
    rectangle.heightPx + padding.topPx + padding.bottomPx
  );
};

export const intersectRectangles = <
  Space extends DocumentCoordinateSpace,
>(
  left: CoordinateRectangle<Space>,
  right: CoordinateRectangle<Space>
): CoordinateRectangle<Space> | null => {
  const intersectionLeft = Math.max(left.leftPx, right.leftPx);
  const intersectionTop = Math.max(left.topPx, right.topPx);
  const intersectionRight = Math.min(left.rightPx, right.rightPx);
  const intersectionBottom = Math.min(left.bottomPx, right.bottomPx);
  if (
    intersectionRight <= intersectionLeft
    || intersectionBottom <= intersectionTop
  ) {
    return null;
  }
  return coordinateRectangle(
    left.coordinateSpace,
    intersectionLeft,
    intersectionTop,
    intersectionRight - intersectionLeft,
    intersectionBottom - intersectionTop
  );
};

export const getBoundingRectangle = <
  Space extends DocumentCoordinateSpace,
>(
  rectangles: readonly CoordinateRectangle<Space>[]
): CoordinateRectangle<Space> | null => {
  const first = rectangles[0];
  if (!first) return null;
  const leftPx = Math.min(...rectangles.map((rectangle) => rectangle.leftPx));
  const topPx = Math.min(...rectangles.map((rectangle) => rectangle.topPx));
  const rightPx = Math.max(...rectangles.map((rectangle) => rectangle.rightPx));
  const bottomPx = Math.max(
    ...rectangles.map((rectangle) => rectangle.bottomPx)
  );
  return coordinateRectangle(
    first.coordinateSpace,
    leftPx,
    topPx,
    rightPx - leftPx,
    bottomPx - topPx
  );
};

/**
 * Builds one exclusion from one or more occupied rectangles. Passing the image
 * and caption rectangles together makes caption ownership part of geometry.
 */
export const buildExclusionRectangle = <
  Space extends DocumentCoordinateSpace,
>({
  occupiedRectangles,
  padding,
  bounds,
}: {
  occupiedRectangles: readonly CoordinateRectangle<Space>[];
  padding: RectanglePaddingInput;
  bounds?: CoordinateRectangle<Space>;
}): CoordinateRectangle<Space> | null => {
  const occupied = getBoundingRectangle(occupiedRectangles);
  if (!occupied) return null;
  const expanded = expandRectangleByPadding(occupied, padding);
  return bounds ? intersectRectangles(expanded, bounds) : expanded;
};

export const rectanglesOverlap = <
  Space extends DocumentCoordinateSpace,
>(
  left: CoordinateRectangle<Space>,
  right: CoordinateRectangle<Space>
) => (
  left.leftPx < right.rightPx
  && left.rightPx > right.leftPx
  && left.topPx < right.bottomPx
  && left.bottomPx > right.topPx
);

const compareObstacles = <Space extends DocumentCoordinateSpace>(
  left: CollisionObstacle<Space>,
  right: CollisionObstacle<Space>
) => (
  left.id.localeCompare(right.id)
  || left.rectangle.topPx - right.rectangle.topPx
  || left.rectangle.leftPx - right.rectangle.leftPx
);

export const findRectangleCollisions = <
  Space extends DocumentCoordinateSpace,
>(
  rectangle: CoordinateRectangle<Space>,
  obstacles: readonly CollisionObstacle<Space>[]
): readonly CollisionObstacle<Space>[] =>
  obstacles
    .filter((obstacle) => rectanglesOverlap(rectangle, obstacle.rectangle))
    .sort(compareObstacles);

const collisionIds = <Space extends DocumentCoordinateSpace>(
  rectangle: CoordinateRectangle<Space>,
  obstacles: readonly CollisionObstacle<Space>[]
) => [...new Set(
  findRectangleCollisions(rectangle, obstacles)
    .map((obstacle) => obstacle.id)
)];

const getAxisSweepTimes = (
  movingMinimum: number,
  movingMaximum: number,
  obstacleMinimum: number,
  obstacleMaximum: number,
  delta: number
): readonly [number, number] | null => {
  if (delta > 0) {
    return [
      (obstacleMinimum - movingMaximum) / delta,
      (obstacleMaximum - movingMinimum) / delta,
    ];
  }
  if (delta < 0) {
    return [
      (obstacleMaximum - movingMinimum) / delta,
      (obstacleMinimum - movingMaximum) / delta,
    ];
  }
  if (
    movingMaximum <= obstacleMinimum
    || movingMinimum >= obstacleMaximum
  ) {
    return null;
  }
  return [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
};

const getSweepCollisionFraction = <
  Space extends DocumentCoordinateSpace,
>(
  start: CoordinateRectangle<Space>,
  deltaX: number,
  deltaY: number,
  obstacle: CoordinateRectangle<Space>
): number | null => {
  const xTimes = getAxisSweepTimes(
    start.leftPx,
    start.rightPx,
    obstacle.leftPx,
    obstacle.rightPx,
    deltaX
  );
  const yTimes = getAxisSweepTimes(
    start.topPx,
    start.bottomPx,
    obstacle.topPx,
    obstacle.bottomPx,
    deltaY
  );
  if (!xTimes || !yTimes) return null;
  const entry = Math.max(xTimes[0], yTimes[0]);
  const exit = Math.min(xTimes[1], yTimes[1]);
  if (entry > exit || entry < 0 || entry > 1) return null;
  return entry;
};

/**
 * Sweeps a rectangle to a desired origin and stops at the first obstacle.
 * Obstacles already overlapping the start are reported but do not trap the
 * rectangle; callers can use `resolveInitialRectangleOverlaps` on insertion.
 */
export const moveRectangleWithoutCollisions = <
  Space extends DocumentCoordinateSpace,
>({
  start,
  desiredOrigin,
  obstacles,
  bounds,
}: {
  start: CoordinateRectangle<Space>;
  desiredOrigin: CoordinatePoint<Space>;
  obstacles: readonly CollisionObstacle<Space>[];
  bounds?: CoordinateRectangle<Space>;
}): CollisionMoveResult<Space> => {
  const safeStart = bounds
    ? clampRectanglePositionToBounds(start, bounds)
    : start;
  const desired = coordinateRectangle(
    safeStart.coordinateSpace,
    desiredOrigin.xPx,
    desiredOrigin.yPx,
    safeStart.widthPx,
    safeStart.heightPx
  );
  const safeDesired = bounds
    ? clampRectanglePositionToBounds(desired, bounds)
    : desired;
  const deltaX = safeDesired.leftPx - safeStart.leftPx;
  const deltaY = safeDesired.topPx - safeStart.topPx;
  const initialCollisionIds = collisionIds(safeStart, obstacles);
  const initialCollisionSet = new Set(initialCollisionIds);
  let travelFraction = 1;
  let blockingObstacleIds: string[] = [];
  const epsilon = 1e-9;

  obstacles.forEach((obstacle) => {
    if (initialCollisionSet.has(obstacle.id)) return;
    const fraction = getSweepCollisionFraction(
      safeStart,
      deltaX,
      deltaY,
      obstacle.rectangle
    );
    if (fraction === null || fraction > travelFraction + epsilon) return;
    if (fraction < travelFraction - epsilon) {
      travelFraction = fraction;
      blockingObstacleIds = [obstacle.id];
      return;
    }
    blockingObstacleIds.push(obstacle.id);
  });

  return {
    rectangle: coordinateRectangle(
      safeStart.coordinateSpace,
      safeStart.leftPx + deltaX * travelFraction,
      safeStart.topPx + deltaY * travelFraction,
      safeStart.widthPx,
      safeStart.heightPx
    ),
    travelFraction,
    blockingObstacleIds: [...new Set(blockingObstacleIds)].sort(),
    initialCollisionIds,
  };
};

/**
 * Finds the nearest collision-free origin from the finite set of obstacle and
 * boundary edges. Ties resolve top-most, then left-most, independent of input
 * obstacle order.
 */
export const resolveInitialRectangleOverlaps = <
  Space extends DocumentCoordinateSpace,
>({
  rectangle,
  obstacles,
  bounds,
}: {
  rectangle: CoordinateRectangle<Space>;
  obstacles: readonly CollisionObstacle<Space>[];
  bounds?: CoordinateRectangle<Space>;
}): InitialOverlapResolution<Space> => {
  const start = bounds
    ? clampRectanglePositionToBounds(rectangle, bounds)
    : rectangle;
  const initialCollisionIds = collisionIds(start, obstacles);
  if (initialCollisionIds.length === 0) {
    return {
      rectangle: start,
      resolved: true,
      collisionIds: [],
    };
  }

  const xCandidates = new Set<number>([start.leftPx]);
  const yCandidates = new Set<number>([start.topPx]);
  obstacles.forEach((obstacle) => {
    xCandidates.add(obstacle.rectangle.leftPx - start.widthPx);
    xCandidates.add(obstacle.rectangle.rightPx);
    yCandidates.add(obstacle.rectangle.topPx - start.heightPx);
    yCandidates.add(obstacle.rectangle.bottomPx);
  });
  if (bounds) {
    xCandidates.add(bounds.leftPx);
    xCandidates.add(Math.max(
      bounds.leftPx,
      bounds.rightPx - start.widthPx
    ));
    yCandidates.add(bounds.topPx);
    yCandidates.add(Math.max(
      bounds.topPx,
      bounds.bottomPx - start.heightPx
    ));
  }

  const candidates = Array.from(xCandidates).flatMap((leftPx) =>
    Array.from(yCandidates).map((topPx) => {
      const candidate = coordinateRectangle(
        start.coordinateSpace,
        leftPx,
        topPx,
        start.widthPx,
        start.heightPx
      );
      return bounds
        ? clampRectanglePositionToBounds(candidate, bounds)
        : candidate;
    })
  );
  const uniqueCandidates = Array.from(new Map(
    candidates.map((candidate) => [
      `${candidate.leftPx}:${candidate.topPx}`,
      candidate,
    ])
  ).values());
  const safeCandidates = uniqueCandidates
    .filter((candidate) => collisionIds(candidate, obstacles).length === 0)
    .sort((left, right) => {
      const leftDistance = (
        (left.leftPx - start.leftPx) ** 2
        + (left.topPx - start.topPx) ** 2
      );
      const rightDistance = (
        (right.leftPx - start.leftPx) ** 2
        + (right.topPx - start.topPx) ** 2
      );
      return (
        leftDistance - rightDistance
        || left.topPx - right.topPx
        || left.leftPx - right.leftPx
      );
    });
  const resolved = safeCandidates[0];
  if (!resolved) {
    return {
      rectangle: start,
      resolved: false,
      collisionIds: initialCollisionIds,
    };
  }
  return {
    rectangle: resolved,
    resolved: true,
    collisionIds: [],
  };
};

/**
 * Resizes from the rectangle's top-left anchor. Linear sampling followed by a
 * binary search finds the first collision for proportional or mixed-axis
 * resizes while preserving deterministic output.
 */
export const resizeRectangleWithoutCollisions = <
  Space extends DocumentCoordinateSpace,
>({
  start,
  desiredWidthPx,
  desiredHeightPx,
  obstacles,
  bounds,
  minimumWidthPx = 1,
  minimumHeightPx = 1,
}: {
  start: CoordinateRectangle<Space>;
  desiredWidthPx: number;
  desiredHeightPx: number;
  obstacles: readonly CollisionObstacle<Space>[];
  bounds?: CoordinateRectangle<Space>;
  minimumWidthPx?: number;
  minimumHeightPx?: number;
}): CollisionResizeResult<Space> => {
  const safeStart = bounds
    ? fitRectangleWithinBounds(start, bounds)
    : start;
  const maximumWidth = bounds
    ? Math.max(0, bounds.rightPx - safeStart.leftPx)
    : Number.POSITIVE_INFINITY;
  const maximumHeight = bounds
    ? Math.max(0, bounds.bottomPx - safeStart.topPx)
    : Number.POSITIVE_INFINITY;
  const targetWidth = clamp(
    nonNegativeFinite(desiredWidthPx),
    Math.min(nonNegativeFinite(minimumWidthPx), maximumWidth),
    maximumWidth
  );
  const targetHeight = clamp(
    nonNegativeFinite(desiredHeightPx),
    Math.min(nonNegativeFinite(minimumHeightPx), maximumHeight),
    maximumHeight
  );
  const initialCollisionIds = collisionIds(safeStart, obstacles);
  if (initialCollisionIds.length > 0) {
    return {
      rectangle: safeStart,
      resizeFraction: 0,
      blockingObstacleIds: [],
      initialCollisionIds,
    };
  }

  const atFraction = (fraction: number) => coordinateRectangle(
    safeStart.coordinateSpace,
    safeStart.leftPx,
    safeStart.topPx,
    safeStart.widthPx
      + (targetWidth - safeStart.widthPx) * fraction,
    safeStart.heightPx
      + (targetHeight - safeStart.heightPx) * fraction
  );
  const target = atFraction(1);
  const steps = 64;
  let lastSafeFraction = 0;
  let firstCollisionFraction = 1;
  let blockingObstacleIds: readonly string[] = [];
  let collided = false;
  for (let index = 1; index <= steps; index += 1) {
    const fraction = index / steps;
    const ids = collisionIds(atFraction(fraction), obstacles);
    if (ids.length > 0) {
      collided = true;
      firstCollisionFraction = fraction;
      blockingObstacleIds = ids;
      break;
    }
    lastSafeFraction = fraction;
  }
  if (!collided) {
    return {
      rectangle: target,
      resizeFraction: 1,
      blockingObstacleIds: [],
      initialCollisionIds: [],
    };
  }
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const middle = (lastSafeFraction + firstCollisionFraction) / 2;
    const ids = collisionIds(atFraction(middle), obstacles);
    if (ids.length > 0) {
      firstCollisionFraction = middle;
      blockingObstacleIds = ids;
    } else {
      lastSafeFraction = middle;
    }
  }

  return {
    rectangle: atFraction(lastSafeFraction),
    resizeFraction: lastSafeFraction,
    blockingObstacleIds,
    initialCollisionIds: [],
  };
};
