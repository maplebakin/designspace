import type {
  DocumentOverlayImage,
  DocumentOverlayPlacement,
} from '../types/documentProject';
import {
  moveRectangleWithoutCollisions,
  resizeRectangleWithoutCollisions,
  resolveInitialRectangleOverlaps,
  type CollisionObstacle,
} from './layoutKernel';
import {
  pagePoint,
  pageRectangle,
  type PageRectangle,
} from './coordinateSpaces';
import {
  DOCUMENT_CSS_PIXELS_PER_INCH,
} from './pageGeometry';

export type DocumentOverlayGeometry = Pick<
  DocumentOverlayImage,
  'xPx' | 'yPx' | 'widthPx' | 'heightPx'
>;

const finiteOrFallback = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

export const getDocumentOverlayPageBounds = (
  widthIn: number,
  heightIn: number
) => pageRectangle(
  0,
  0,
  Math.max(
    0,
    finiteOrFallback(widthIn, 0) * DOCUMENT_CSS_PIXELS_PER_INCH
  ),
  Math.max(
    0,
    finiteOrFallback(heightIn, 0) * DOCUMENT_CSS_PIXELS_PER_INCH
  )
);

export const getDocumentOverlayOccupiedRectangle = (
  overlay: DocumentOverlayGeometry,
  captionExtraHeightPx = 0
) => pageRectangle(
  finiteOrFallback(overlay.xPx, 0),
  finiteOrFallback(overlay.yPx, 0),
  Math.max(1, finiteOrFallback(overlay.widthPx, 1)),
  Math.max(1, finiteOrFallback(overlay.heightPx, 1))
    + Math.max(0, finiteOrFallback(captionExtraHeightPx, 0))
);

export const getDocumentOverlayObstacles = (
  objects: readonly DocumentOverlayImage[],
  {
    excludeId,
    placement,
  }: {
    excludeId?: string;
    placement?: DocumentOverlayPlacement;
  } = {}
): CollisionObstacle<'page'>[] => objects
  .filter((object) => (
    object.id !== excludeId
    && (placement === undefined || object.placement === placement)
  ))
  .map((object) => ({
    id: object.id,
    rectangle: getDocumentOverlayOccupiedRectangle(object),
  }));

export const resolveNewDocumentOverlayGeometry = ({
  overlay,
  objects,
  bounds,
}: {
  overlay: DocumentOverlayImage;
  objects: readonly DocumentOverlayImage[];
  bounds: PageRectangle;
}): DocumentOverlayGeometry => {
  const start = getDocumentOverlayOccupiedRectangle(overlay);
  const result = resolveInitialRectangleOverlaps({
    rectangle: start,
    obstacles: getDocumentOverlayObstacles(objects, {
      excludeId: overlay.id,
      placement: overlay.placement,
    }),
    bounds,
  });
  return {
    xPx: result.rectangle.leftPx,
    yPx: result.rectangle.topPx,
    widthPx: result.rectangle.widthPx,
    heightPx: result.rectangle.heightPx,
  };
};

export const commitDocumentOverlayGeometry = ({
  overlay,
  update,
  objects,
  bounds,
}: {
  overlay: DocumentOverlayImage;
  update: Partial<DocumentOverlayGeometry>;
  objects: readonly DocumentOverlayImage[];
  bounds: PageRectangle;
}): DocumentOverlayGeometry => {
  const start = getDocumentOverlayOccupiedRectangle(overlay);
  const desiredWidthPx = Math.max(
    1,
    finiteOrFallback(update.widthPx, overlay.widthPx)
  );
  const desiredHeightPx = Math.max(
    1,
    finiteOrFallback(update.heightPx, overlay.heightPx)
  );
  const obstacles = getDocumentOverlayObstacles(objects, {
    excludeId: overlay.id,
    placement: overlay.placement,
  });
  const resized = (
    Math.abs(desiredWidthPx - overlay.widthPx) > 0.001
    || Math.abs(desiredHeightPx - overlay.heightPx) > 0.001
  )
    ? resizeRectangleWithoutCollisions({
        start,
        desiredWidthPx,
        desiredHeightPx,
        obstacles,
        bounds,
        minimumWidthPx: Math.min(1, bounds.widthPx),
        minimumHeightPx: Math.min(1, bounds.heightPx),
      }).rectangle
    : start;
  const desiredX = finiteOrFallback(update.xPx, resized.leftPx);
  const desiredY = finiteOrFallback(update.yPx, resized.topPx);
  const moved = (
    Math.abs(desiredX - resized.leftPx) > 0.001
    || Math.abs(desiredY - resized.topPx) > 0.001
  )
    ? moveRectangleWithoutCollisions({
        start: resized,
        desiredOrigin: pagePoint(desiredX, desiredY),
        obstacles,
        bounds,
      }).rectangle
    : resizeRectangleWithoutCollisions({
        start: resized,
        desiredWidthPx: resized.widthPx,
        desiredHeightPx: resized.heightPx,
        obstacles: [],
        bounds,
      }).rectangle;
  return {
    xPx: moved.leftPx,
    yPx: moved.topPx,
    widthPx: moved.widthPx,
    heightPx: moved.heightPx,
  };
};
