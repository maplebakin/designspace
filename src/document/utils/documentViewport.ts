export type FitPageZoomInput = {
  viewportWidth: number;
  viewportHeight: number;
  pageWidth: number;
  pageHeight: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  minimumZoom?: number;
  maximumZoom?: number;
};

const finiteOrZero = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(0, value || 0) : 0;

export const calculateFitPageZoom = ({
  viewportWidth,
  viewportHeight,
  pageWidth,
  pageHeight,
  paddingLeft = 0,
  paddingRight = 0,
  paddingTop = 0,
  paddingBottom = 0,
  minimumZoom = 0.25,
  maximumZoom = 1.5,
}: FitPageZoomInput): number | null => {
  if (
    !Number.isFinite(viewportWidth)
    || !Number.isFinite(viewportHeight)
    || !Number.isFinite(pageWidth)
    || !Number.isFinite(pageHeight)
    || viewportWidth <= 0
    || viewportHeight <= 0
    || pageWidth <= 0
    || pageHeight <= 0
  ) {
    return null;
  }

  const availableWidth = viewportWidth
    - finiteOrZero(paddingLeft)
    - finiteOrZero(paddingRight);
  const availableHeight = viewportHeight
    - finiteOrZero(paddingTop)
    - finiteOrZero(paddingBottom);
  if (availableWidth <= 0 || availableHeight <= 0) return null;

  const lower = Math.max(0.01, finiteOrZero(minimumZoom));
  const upper = Math.max(lower, finiteOrZero(maximumZoom));
  const fit = Math.min(
    availableWidth / pageWidth,
    availableHeight / pageHeight
  );
  return Math.max(lower, Math.min(upper, fit));
};
