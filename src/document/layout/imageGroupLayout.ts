import {
  bodyDelta,
  bodyPoint,
  bodyRectangle,
  type BodyDelta,
  type BodyPoint,
  type BodyRectangle,
} from './coordinateSpaces';
import {
  clampRectanglePositionToBounds,
  isRectangleWithinBounds,
  moveRectangleWithoutCollisions,
  resolveInitialRectangleOverlaps,
  type CollisionObstacle,
} from './layoutKernel';

export type DocumentImageGroupLayoutKind = 'row' | 'stack';

export type DocumentImageGroupChildGeometry = Readonly<{
  imageId: string;
  widthPx: number;
  heightPx: number;
  captionHeightPx?: number;
  captionSpacingPx?: number;
}>;

export type DocumentImageGroupLayoutInput = Readonly<{
  kind: DocumentImageGroupLayoutKind;
  origin: BodyPoint;
  children: readonly DocumentImageGroupChildGeometry[];
  gapPx: number;
  sharedWidth?: boolean;
  /**
   * If shared width is enabled, this is the explicit target width. When it is
   * absent or malformed, the first ordered child's width is the stable anchor.
   */
  sharedWidthPx?: number;
}>;

export type DocumentImageGroupChildLayout = Readonly<{
  imageId: string;
  imageRectangle: BodyRectangle;
  captionRectangle: BodyRectangle | null;
  occupiedRectangle: BodyRectangle;
  aspectRatio: number;
}>;

export type DocumentImageGroupLayout = Readonly<{
  kind: DocumentImageGroupLayoutKind;
  origin: BodyPoint;
  gapPx: number;
  sharedWidth: boolean;
  sharedWidthPx: number | null;
  children: readonly DocumentImageGroupChildLayout[];
  bounds: BodyRectangle;
}>;

export type DocumentImageGroupFitResult = Readonly<{
  layout: DocumentImageGroupLayout;
  scale: number;
  fits: boolean;
}>;

export type DocumentImageGroupMoveResult = Readonly<{
  layout: DocumentImageGroupLayout;
  travelFraction: number;
  blockingObstacleIds: readonly string[];
  initialCollisionIds: readonly string[];
}>;

export type DocumentImageGroupOverlapResolution = Readonly<{
  layout: DocumentImageGroupLayout;
  resolved: boolean;
  collisionIds: readonly string[];
}>;

const finiteOrFallback = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const positiveFiniteOrOne = (value: unknown) =>
  Math.max(1, finiteOrFallback(value, 1));

const nonNegativeFinite = (value: unknown) =>
  Math.max(0, finiteOrFallback(value, 0));

const getCaptionRectangle = (
  imageRectangle: BodyRectangle,
  captionHeightPx: number,
  captionSpacingPx: number
): BodyRectangle | null => {
  if (captionHeightPx <= 0) return null;
  return bodyRectangle(
    imageRectangle.leftPx,
    imageRectangle.bottomPx + captionSpacingPx,
    imageRectangle.widthPx,
    captionHeightPx
  );
};

const getOccupiedRectangle = (
  imageRectangle: BodyRectangle,
  captionRectangle: BodyRectangle | null
) => bodyRectangle(
  imageRectangle.leftPx,
  imageRectangle.topPx,
  imageRectangle.widthPx,
  (captionRectangle?.bottomPx ?? imageRectangle.bottomPx)
    - imageRectangle.topPx
);

const getLayoutBounds = (
  origin: BodyPoint,
  children: readonly DocumentImageGroupChildLayout[]
): BodyRectangle => {
  if (children.length === 0) {
    return bodyRectangle(origin.xPx, origin.yPx, 0, 0);
  }
  const leftPx = Math.min(
    ...children.map((child) => child.occupiedRectangle.leftPx)
  );
  const topPx = Math.min(
    ...children.map((child) => child.occupiedRectangle.topPx)
  );
  const rightPx = Math.max(
    ...children.map((child) => child.occupiedRectangle.rightPx)
  );
  const bottomPx = Math.max(
    ...children.map((child) => child.occupiedRectangle.bottomPx)
  );
  return bodyRectangle(
    leftPx,
    topPx,
    rightPx - leftPx,
    bottomPx - topPx
  );
};

const getSharedWidthPx = (
  input: DocumentImageGroupLayoutInput,
  children: readonly DocumentImageGroupChildGeometry[]
) => {
  if (!input.sharedWidth || children.length === 0) return null;
  const firstWidthPx = positiveFiniteOrOne(children[0].widthPx);
  return positiveFiniteOrOne(
    finiteOrFallback(input.sharedWidthPx, firstWidthPx)
  );
};

/**
 * Derives row or stack rectangles from ordered canonical image geometry.
 *
 * Caption height is measurement input, not text style state. A stack advances
 * past the full occupied image/caption block before applying its group gap.
 * A row applies gaps between images and uses the tallest occupied child for
 * the group footprint.
 */
export const layoutDocumentImageGroup = (
  input: DocumentImageGroupLayoutInput
): DocumentImageGroupLayout => {
  const gapPx = nonNegativeFinite(input.gapPx);
  const sharedWidthPx = input.kind === 'stack'
    ? getSharedWidthPx(input, input.children)
    : null;
  let cursorX = input.origin.xPx;
  let cursorY = input.origin.yPx;

  const children = input.children.map((child) => {
    const sourceWidthPx = positiveFiniteOrOne(child.widthPx);
    const sourceHeightPx = positiveFiniteOrOne(child.heightPx);
    const aspectRatio = sourceWidthPx / sourceHeightPx;
    const widthPx = sharedWidthPx ?? sourceWidthPx;
    const heightPx = sharedWidthPx === null
      ? sourceHeightPx
      : widthPx / aspectRatio;
    const imageRectangle = bodyRectangle(
      cursorX,
      cursorY,
      widthPx,
      heightPx
    );
    const captionRectangle = getCaptionRectangle(
      imageRectangle,
      nonNegativeFinite(child.captionHeightPx),
      nonNegativeFinite(child.captionSpacingPx)
    );
    const occupiedRectangle = getOccupiedRectangle(
      imageRectangle,
      captionRectangle
    );

    if (input.kind === 'row') {
      cursorX = imageRectangle.rightPx + gapPx;
    } else {
      cursorY = occupiedRectangle.bottomPx + gapPx;
    }

    return {
      imageId: child.imageId,
      imageRectangle,
      captionRectangle,
      occupiedRectangle,
      aspectRatio,
    };
  });

  return {
    kind: input.kind,
    origin: input.origin,
    gapPx,
    sharedWidth: input.kind === 'stack' && Boolean(input.sharedWidth),
    sharedWidthPx,
    children,
    bounds: getLayoutBounds(input.origin, children),
  };
};

const translateRectangle = (
  rectangle: BodyRectangle,
  delta: BodyDelta
) => bodyRectangle(
  rectangle.leftPx + delta.xPx,
  rectangle.topPx + delta.yPx,
  rectangle.widthPx,
  rectangle.heightPx
);

export const translateDocumentImageGroupLayout = (
  layout: DocumentImageGroupLayout,
  delta: BodyDelta
): DocumentImageGroupLayout => {
  if (delta.xPx === 0 && delta.yPx === 0) return layout;
  const origin = bodyPoint(
    layout.origin.xPx + delta.xPx,
    layout.origin.yPx + delta.yPx
  );
  const children = layout.children.map((child) => ({
    ...child,
    imageRectangle: translateRectangle(child.imageRectangle, delta),
    captionRectangle: child.captionRectangle
      ? translateRectangle(child.captionRectangle, delta)
      : null,
    occupiedRectangle: translateRectangle(child.occupiedRectangle, delta),
  }));
  return {
    ...layout,
    origin,
    children,
    bounds: translateRectangle(layout.bounds, delta),
  };
};

/**
 * Returns the uniform geometry scale necessary to fit the occupied group
 * bounds. It never enlarges a group. Caption measurements are included in the
 * result because they are part of the occupied footprint.
 */
export const getDocumentImageGroupFitScale = (
  layout: DocumentImageGroupLayout,
  bounds: BodyRectangle
) => {
  if (layout.bounds.widthPx === 0 || layout.bounds.heightPx === 0) return 1;
  return Math.max(0, Math.min(
    1,
    bounds.widthPx / layout.bounds.widthPx,
    bounds.heightPx / layout.bounds.heightPx
  ));
};

const scaleRectangleFromOrigin = (
  rectangle: BodyRectangle,
  origin: BodyPoint,
  scale: number
) => bodyRectangle(
  origin.xPx + (rectangle.leftPx - origin.xPx) * scale,
  origin.yPx + (rectangle.topPx - origin.yPx) * scale,
  rectangle.widthPx * scale,
  rectangle.heightPx * scale
);

/**
 * Uniformly scales measured geometry around the group origin. This preserves
 * every image aspect ratio and relative gap. Renderers that reflow caption
 * text at the new width should rebuild the layout with the new measured
 * caption heights before committing canonical child geometry.
 */
export const scaleDocumentImageGroupLayout = (
  layout: DocumentImageGroupLayout,
  requestedScale: number
): DocumentImageGroupLayout => {
  const scale = Math.max(0, finiteOrFallback(requestedScale, 1));
  if (scale === 1) return layout;
  const children = layout.children.map((child) => ({
    ...child,
    imageRectangle: scaleRectangleFromOrigin(
      child.imageRectangle,
      layout.origin,
      scale
    ),
    captionRectangle: child.captionRectangle
      ? scaleRectangleFromOrigin(
          child.captionRectangle,
          layout.origin,
          scale
        )
      : null,
    occupiedRectangle: scaleRectangleFromOrigin(
      child.occupiedRectangle,
      layout.origin,
      scale
    ),
  }));
  return {
    ...layout,
    gapPx: layout.gapPx * scale,
    sharedWidthPx: layout.sharedWidthPx === null
      ? null
      : layout.sharedWidthPx * scale,
    children,
    bounds: scaleRectangleFromOrigin(
      layout.bounds,
      layout.origin,
      scale
    ),
  };
};

/**
 * Clamps a group as one rigid unit. Oversized groups keep their geometry and
 * anchor to the bounds' top/left, allowing overflow reporting to remain
 * explicit.
 */
export const clampDocumentImageGroupLayoutToBounds = (
  layout: DocumentImageGroupLayout,
  bounds: BodyRectangle
): DocumentImageGroupLayout => {
  const clamped = clampRectanglePositionToBounds(layout.bounds, bounds);
  return translateDocumentImageGroupLayout(
    layout,
    bodyDelta(
      clamped.leftPx - layout.bounds.leftPx,
      clamped.topPx - layout.bounds.topPx
    )
  );
};

/**
 * Uniformly fits measured group geometry, then clamps it into body bounds.
 * See `scaleDocumentImageGroupLayout` for the caption remeasurement contract.
 */
export const fitDocumentImageGroupLayoutWithinBounds = (
  layout: DocumentImageGroupLayout,
  bounds: BodyRectangle
): DocumentImageGroupFitResult => {
  const scale = getDocumentImageGroupFitScale(layout, bounds);
  const fitted = clampDocumentImageGroupLayoutToBounds(
    scaleDocumentImageGroupLayout(layout, scale),
    bounds
  );
  return {
    layout: fitted,
    scale,
    fits: isRectangleWithinBounds(fitted.bounds, bounds),
  };
};

export const getDocumentImageGroupCollisionObstacle = (
  groupId: string,
  layout: DocumentImageGroupLayout
): CollisionObstacle<'body'> => ({
  id: groupId,
  rectangle: layout.bounds,
});

/**
 * Resolves insertion overlap using the same deterministic candidate ordering
 * as positioned images, while translating all children atomically.
 */
export const resolveInitialDocumentImageGroupOverlaps = ({
  layout,
  obstacles,
  bounds,
}: {
  layout: DocumentImageGroupLayout;
  obstacles: readonly CollisionObstacle<'body'>[];
  bounds?: BodyRectangle;
}): DocumentImageGroupOverlapResolution => {
  const resolution = resolveInitialRectangleOverlaps({
    rectangle: layout.bounds,
    obstacles,
    bounds,
  });
  return {
    layout: translateDocumentImageGroupLayout(
      layout,
      bodyDelta(
        resolution.rectangle.leftPx - layout.bounds.leftPx,
        resolution.rectangle.topPx - layout.bounds.topPx
      )
    ),
    resolved: resolution.resolved,
    collisionIds: resolution.collisionIds,
  };
};

/**
 * Sweeps the conservative occupied group bounds and translates every child by
 * the accepted delta. Callers must exclude the moving group's child IDs from
 * `obstacles`; other groups should be supplied as their occupied bounds.
 */
export const moveDocumentImageGroupWithoutCollisions = ({
  layout,
  desiredOrigin,
  obstacles,
  bounds,
}: {
  layout: DocumentImageGroupLayout;
  desiredOrigin: BodyPoint;
  obstacles: readonly CollisionObstacle<'body'>[];
  bounds?: BodyRectangle;
}): DocumentImageGroupMoveResult => {
  const result = moveRectangleWithoutCollisions({
    start: layout.bounds,
    desiredOrigin,
    obstacles,
    bounds,
  });
  return {
    layout: translateDocumentImageGroupLayout(
      layout,
      bodyDelta(
        result.rectangle.leftPx - layout.bounds.leftPx,
        result.rectangle.topPx - layout.bounds.topPx
      )
    ),
    travelFraction: result.travelFraction,
    blockingObstacleIds: result.blockingObstacleIds,
    initialCollisionIds: result.initialCollisionIds,
  };
};
