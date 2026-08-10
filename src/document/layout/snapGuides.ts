import {
  coordinateRectangle,
  type CoordinatePoint,
  type CoordinateRectangle,
  type DocumentCoordinateSpace,
  type DocumentLayoutCoordinateSpace,
} from './coordinateSpaces';

export type DocumentSnapGuide = {
  axis: 'x' | 'y';
  positionPx: number;
  source: 'page' | 'body' | 'column' | 'nearby';
};

export type DocumentSnapResult<Space extends DocumentLayoutCoordinateSpace> = {
  rectangle: CoordinateRectangle<Space>;
  guides: readonly DocumentSnapGuide[];
};

type SnapCandidate<Space extends DocumentCoordinateSpace> = {
  rectangle: CoordinateRectangle<Space>;
  source: DocumentSnapGuide['source'];
};

const anchors = (rectangle: CoordinateRectangle<DocumentCoordinateSpace>) => ({
  start: rectangle.leftPx,
  center: rectangle.leftPx + rectangle.widthPx / 2,
  end: rectangle.rightPx,
});

const verticalAnchors = (
  rectangle: CoordinateRectangle<DocumentCoordinateSpace>
) => ({
  start: rectangle.topPx,
  center: rectangle.topPx + rectangle.heightPx / 2,
  end: rectangle.bottomPx,
});

const candidateAnchors = (
  rectangle: CoordinateRectangle<DocumentCoordinateSpace>,
  axis: 'x' | 'y'
) => axis === 'x' ? anchors(rectangle) : verticalAnchors(rectangle);

const bestAxisSnap = (
  rectangle: CoordinateRectangle<DocumentCoordinateSpace>,
  candidates: readonly SnapCandidate<DocumentCoordinateSpace>[],
  axis: 'x' | 'y',
  desiredStart: number,
  thresholdPx: number
): { delta: number; guide: DocumentSnapGuide } | null => {
  const moving = candidateAnchors(rectangle, axis);
  const rectangleStart = axis === 'x' ? rectangle.leftPx : rectangle.topPx;
  let best: { delta: number; guide: DocumentSnapGuide } | null = null;
  candidates.forEach(({ rectangle: candidate, source }) => {
    const target = candidateAnchors(candidate, axis);
    (Object.keys(moving) as Array<keyof typeof moving>).forEach((movingKey) => {
      (Object.keys(target) as Array<keyof typeof target>).forEach((targetKey) => {
        const movingPosition = moving[movingKey] + (desiredStart - rectangleStart);
        const delta = target[targetKey] - movingPosition;
        if (Math.abs(delta) > thresholdPx) return;
        if (!best || Math.abs(delta) < Math.abs(best.delta)) {
          best = {
            delta,
            guide: {
              axis,
              positionPx: target[targetKey],
              source,
            },
          };
        }
      });
    });
  });
  return best;
};

/**
 * Snaps a proposed unzoomed layout rectangle to page/body/column/nearby
 * geometry. Callers feed the result into the existing collision kernel; this
 * module only computes guides and never persists preview state.
 */
export const snapDocumentRectangle = <Space extends DocumentLayoutCoordinateSpace>({
  rectangle,
  desiredOrigin,
  bounds,
  boundsSource,
  columns = [],
  nearby = [],
  thresholdPx = 8,
}: {
  rectangle: CoordinateRectangle<Space>;
  desiredOrigin: CoordinatePoint<Space>;
  bounds?: CoordinateRectangle<Space>;
  boundsSource?: 'page' | 'body';
  columns?: readonly CoordinateRectangle<Space>[];
  nearby?: readonly CoordinateRectangle<Space>[];
  thresholdPx?: number;
}): DocumentSnapResult<Space> => {
  const candidates: Array<SnapCandidate<Space>> = [
    ...(bounds ? [{
      rectangle: bounds,
      source: boundsSource || 'body' as const,
    }] : []),
    ...columns.map((candidate) => ({
      rectangle: candidate,
      source: 'column' as const,
    })),
    ...nearby.map((candidate) => ({
      rectangle: candidate,
      source: 'nearby' as const,
    })),
  ];
  const safeThreshold = Math.max(0, Number.isFinite(thresholdPx) ? thresholdPx : 8);
  const x = bestAxisSnap(
    rectangle,
    candidates,
    'x',
    desiredOrigin.xPx,
    safeThreshold
  );
  const y = bestAxisSnap(
    rectangle,
    candidates,
    'y',
    desiredOrigin.yPx,
    safeThreshold
  );
  const xDelta = x ? x.delta : 0;
  const yDelta = y ? y.delta : 0;
  const guides: DocumentSnapGuide[] = [];
  if (x) guides.push(x.guide);
  if (y) guides.push(y.guide);
  return {
    rectangle: coordinateRectangle(
      rectangle.coordinateSpace,
      desiredOrigin.xPx + xDelta,
      desiredOrigin.yPx + yDelta,
      rectangle.widthPx,
      rectangle.heightPx
    ) as CoordinateRectangle<Space>,
    guides,
  };
};
