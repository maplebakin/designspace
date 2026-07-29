/**
 * Coordinate-space types for document layout.
 *
 * Page and body values are always unzoomed 96-CSS-pixel layout values.
 * Viewport values are browser/client pixels and must never be persisted.
 * Constructors keep the runtime discriminant while the unique-symbol brands
 * prevent accidental structural assignment between otherwise similar shapes.
 */

export type DocumentCoordinateSpace = 'page' | 'body' | 'viewport';
export type DocumentLayoutCoordinateSpace = Exclude<
  DocumentCoordinateSpace,
  'viewport'
>;

declare const coordinatePointBrand: unique symbol;
declare const coordinateRectangleBrand: unique symbol;
declare const coordinateDeltaBrand: unique symbol;

export type CoordinatePoint<
  Space extends DocumentCoordinateSpace,
> = Readonly<{
  coordinateSpace: Space;
  xPx: number;
  yPx: number;
  readonly [coordinatePointBrand]: Space;
}>;

export type CoordinateRectangle<
  Space extends DocumentCoordinateSpace,
> = Readonly<{
  coordinateSpace: Space;
  leftPx: number;
  topPx: number;
  widthPx: number;
  heightPx: number;
  rightPx: number;
  bottomPx: number;
  readonly [coordinateRectangleBrand]: Space;
}>;

export type CoordinateDelta<
  Space extends DocumentCoordinateSpace,
> = Readonly<{
  coordinateSpace: Space;
  xPx: number;
  yPx: number;
  readonly [coordinateDeltaBrand]: Space;
}>;

export type PagePoint = CoordinatePoint<'page'>;
export type BodyPoint = CoordinatePoint<'body'>;
export type ViewportPoint = CoordinatePoint<'viewport'>;

export type PageRectangle = CoordinateRectangle<'page'>;
export type BodyRectangle = CoordinateRectangle<'body'>;
export type ViewportRectangle = CoordinateRectangle<'viewport'>;

export type PageDelta = CoordinateDelta<'page'>;
export type BodyDelta = CoordinateDelta<'body'>;
export type ViewportDelta = CoordinateDelta<'viewport'>;

const finiteOrZero = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const nonNegativeFinite = (value: unknown) =>
  Math.max(0, finiteOrZero(value));

export const coordinatePoint = <
  Space extends DocumentCoordinateSpace,
>(
  coordinateSpace: Space,
  xPx: number,
  yPx: number
): CoordinatePoint<Space> => ({
  coordinateSpace,
  xPx: finiteOrZero(xPx),
  yPx: finiteOrZero(yPx),
}) as CoordinatePoint<Space>;

export const pagePoint = (xPx: number, yPx: number): PagePoint =>
  coordinatePoint('page', xPx, yPx);

export const bodyPoint = (xPx: number, yPx: number): BodyPoint =>
  coordinatePoint('body', xPx, yPx);

export const viewportPoint = (xPx: number, yPx: number): ViewportPoint =>
  coordinatePoint('viewport', xPx, yPx);

export const coordinateRectangle = <
  Space extends DocumentCoordinateSpace,
>(
  coordinateSpace: Space,
  leftPx: number,
  topPx: number,
  widthPx: number,
  heightPx: number
): CoordinateRectangle<Space> => {
  const safeLeft = finiteOrZero(leftPx);
  const safeTop = finiteOrZero(topPx);
  const safeWidth = nonNegativeFinite(widthPx);
  const safeHeight = nonNegativeFinite(heightPx);
  return {
    coordinateSpace,
    leftPx: safeLeft,
    topPx: safeTop,
    widthPx: safeWidth,
    heightPx: safeHeight,
    rightPx: safeLeft + safeWidth,
    bottomPx: safeTop + safeHeight,
  } as CoordinateRectangle<Space>;
};

export const pageRectangle = (
  leftPx: number,
  topPx: number,
  widthPx: number,
  heightPx: number
): PageRectangle =>
  coordinateRectangle('page', leftPx, topPx, widthPx, heightPx);

export const bodyRectangle = (
  leftPx: number,
  topPx: number,
  widthPx: number,
  heightPx: number
): BodyRectangle =>
  coordinateRectangle('body', leftPx, topPx, widthPx, heightPx);

export const viewportRectangle = (
  leftPx: number,
  topPx: number,
  widthPx: number,
  heightPx: number
): ViewportRectangle =>
  coordinateRectangle('viewport', leftPx, topPx, widthPx, heightPx);

export const coordinateDelta = <
  Space extends DocumentCoordinateSpace,
>(
  coordinateSpace: Space,
  xPx: number,
  yPx: number
): CoordinateDelta<Space> => ({
  coordinateSpace,
  xPx: finiteOrZero(xPx),
  yPx: finiteOrZero(yPx),
}) as CoordinateDelta<Space>;

export const pageDelta = (xPx: number, yPx: number): PageDelta =>
  coordinateDelta('page', xPx, yPx);

export const bodyDelta = (xPx: number, yPx: number): BodyDelta =>
  coordinateDelta('body', xPx, yPx);

export const viewportDelta = (xPx: number, yPx: number): ViewportDelta =>
  coordinateDelta('viewport', xPx, yPx);

const normalizeViewScale = (viewScale: number) => (
  Number.isFinite(viewScale) && viewScale > 0 ? viewScale : 1
);

export const pagePointToBodyPoint = (
  point: PagePoint,
  bodyBoundsOnPage: PageRectangle
): BodyPoint => bodyPoint(
  point.xPx - bodyBoundsOnPage.leftPx,
  point.yPx - bodyBoundsOnPage.topPx
);

export const bodyPointToPagePoint = (
  point: BodyPoint,
  bodyBoundsOnPage: PageRectangle
): PagePoint => pagePoint(
  point.xPx + bodyBoundsOnPage.leftPx,
  point.yPx + bodyBoundsOnPage.topPx
);

export const pageRectangleToBodyRectangle = (
  rectangle: PageRectangle,
  bodyBoundsOnPage: PageRectangle
): BodyRectangle => bodyRectangle(
  rectangle.leftPx - bodyBoundsOnPage.leftPx,
  rectangle.topPx - bodyBoundsOnPage.topPx,
  rectangle.widthPx,
  rectangle.heightPx
);

export const bodyRectangleToPageRectangle = (
  rectangle: BodyRectangle,
  bodyBoundsOnPage: PageRectangle
): PageRectangle => pageRectangle(
  rectangle.leftPx + bodyBoundsOnPage.leftPx,
  rectangle.topPx + bodyBoundsOnPage.topPx,
  rectangle.widthPx,
  rectangle.heightPx
);

/**
 * Converts a browser/client delta to an unzoomed layout delta. The target
 * space is explicit because page and body deltas share units but not origins.
 */
export const viewportDeltaToLayoutDelta = <
  Space extends DocumentLayoutCoordinateSpace,
>(
  delta: ViewportDelta,
  viewScale: number,
  targetSpace: Space
): CoordinateDelta<Space> => {
  const scale = normalizeViewScale(viewScale);
  return coordinateDelta(
    targetSpace,
    delta.xPx / scale,
    delta.yPx / scale
  );
};

export const layoutDeltaToViewportDelta = <
  Space extends DocumentLayoutCoordinateSpace,
>(
  delta: CoordinateDelta<Space>,
  viewScale: number
): ViewportDelta => {
  const scale = normalizeViewScale(viewScale);
  return viewportDelta(delta.xPx * scale, delta.yPx * scale);
};

export const viewportPointToPagePoint = (
  point: ViewportPoint,
  pageOrigin: ViewportPoint,
  viewScale: number
): PagePoint => {
  const delta = viewportDelta(
    point.xPx - pageOrigin.xPx,
    point.yPx - pageOrigin.yPx
  );
  const layoutDelta = viewportDeltaToLayoutDelta(
    delta,
    viewScale,
    'page'
  );
  return pagePoint(layoutDelta.xPx, layoutDelta.yPx);
};

export const pagePointToViewportPoint = (
  point: PagePoint,
  pageOrigin: ViewportPoint,
  viewScale: number
): ViewportPoint => {
  const delta = layoutDeltaToViewportDelta(
    pageDelta(point.xPx, point.yPx),
    viewScale
  );
  return viewportPoint(
    pageOrigin.xPx + delta.xPx,
    pageOrigin.yPx + delta.yPx
  );
};
