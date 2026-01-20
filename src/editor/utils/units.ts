export const PRINT_DPI = 300;
export const SAFE_MARGIN_PX = 24;

export type UnitMode = 'px' | 'in' | 'cm' | 'mm';

const UNIT_SCALE_MAP: Record<UnitMode, number> = {
  px: 1,
  in: PRINT_DPI,
  cm: PRINT_DPI / 2.54,
  mm: PRINT_DPI / 25.4,
};

export const unitScale: Record<UnitMode, number> = UNIT_SCALE_MAP;

export const pxToIn = (px: number, dpi: number = PRINT_DPI) => px / dpi;

export const inToPx = (inches: number, dpi: number = PRINT_DPI) => inches * dpi;

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

type DimensionValue = { width: number; height: number };
type CoordinateValue = { x: number; y: number };
type MeasurementValue = number | DimensionValue | CoordinateValue;

const convertMeasurement = (
  value: MeasurementValue,
  converter: (input: number) => number
): MeasurementValue => {
  if (typeof value === 'number') {
    return converter(value);
  }
  const cloned = { ...value };
  if ('width' in cloned) {
    cloned.width = converter(cloned.width);
  }
  if ('height' in cloned) {
    cloned.height = converter(cloned.height);
  }
  if ('x' in cloned) {
    cloned.x = converter(cloned.x);
  }
  if ('y' in cloned) {
    cloned.y = converter(cloned.y);
  }
  return cloned;
};

export const toCanvasUnits = (
  value: MeasurementValue,
  unitMode: UnitMode = 'px'
): MeasurementValue => {
  const scale = unitScale[unitMode];
  return convertMeasurement(value, (input) => input * scale);
};

export const fromCanvasUnits = (
  value: MeasurementValue,
  unitMode: UnitMode = 'px'
): MeasurementValue => {
  const scale = unitScale[unitMode];
  return convertMeasurement(value, (input) => input / scale);
};
