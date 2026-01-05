export const PRINT_DPI = 300;
export const SAFE_MARGIN_PX = 24;

export const pxToIn = (px: number, dpi: number = PRINT_DPI) => px / dpi;

export const safeMarginInches = (dpi: number = PRINT_DPI) => pxToIn(SAFE_MARGIN_PX, dpi);

export const canvasDimensionsInInches = (
  width: number,
  height: number,
  dpi: number = PRINT_DPI
) => ({
  width: pxToIn(width, dpi),
  height: pxToIn(height, dpi),
});

export const formatInches = (inches: number, precision = 2) => {
  if (!Number.isFinite(inches)) return '0';
  return inches.toFixed(precision).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
};
