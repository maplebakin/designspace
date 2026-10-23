export type AlignmentDirection = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributionAxis = 'horizontal' | 'vertical';

export type RectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type Delta = {
  dx: number;
  dy: number;
};

/**
 * Calculates a translation that aligns one rectangle inside a target bounds.
 * For a single object the target is the document; for a multi-selection the
 * target is the selection's own bounding box.
 */
export const calculateAlignmentDeltaToBounds = (
  rect: RectLike,
  bounds: RectLike,
  direction: AlignmentDirection,
): Delta => {
  let dx = 0;
  let dy = 0;

  switch (direction) {
    case 'left':
      dx = bounds.left - rect.left;
      break;
    case 'center':
      dx = bounds.left + bounds.width / 2 - (rect.left + rect.width / 2);
      break;
    case 'right':
      dx = bounds.left + bounds.width - (rect.left + rect.width);
      break;
    case 'top':
      dy = bounds.top - rect.top;
      break;
    case 'middle':
      dy = bounds.top + bounds.height / 2 - (rect.top + rect.height / 2);
      break;
    case 'bottom':
      dy = bounds.top + bounds.height - (rect.top + rect.height);
      break;
  }

  return { dx, dy };
};

export type IndexedRect = RectLike & { index: number };

/**
 * Returns scene-space translations that produce equal gaps while leaving the
 * first and last edges anchored to the current selection bounds.
 */
export const calculateDistributionDeltas = (
  rects: RectLike[],
  bounds: RectLike,
  axis: DistributionAxis,
): Delta[] => {
  const deltas = rects.map(() => ({ dx: 0, dy: 0 }));
  if (rects.length < 3) return deltas;

  const horizontal = axis === 'horizontal';
  const indexed: IndexedRect[] = rects.map((rect, index) => ({ ...rect, index }));
  indexed.sort((a, b) => horizontal ? a.left - b.left : a.top - b.top);

  const totalSize = indexed.reduce(
    (sum, rect) => sum + (horizontal ? rect.width : rect.height),
    0,
  );
  const span = horizontal ? bounds.width : bounds.height;
  const start = horizontal ? bounds.left : bounds.top;
  const gap = (span - totalSize) / (indexed.length - 1);

  let cursor = start;
  indexed.forEach((rect) => {
    if (horizontal) {
      deltas[rect.index] = { dx: cursor - rect.left, dy: 0 };
      cursor += rect.width + gap;
    } else {
      deltas[rect.index] = { dx: 0, dy: cursor - rect.top };
      cursor += rect.height + gap;
    }
  });

  return deltas;
};
