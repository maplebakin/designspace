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

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Options for dimension conversion.
 */
export interface DimensionOptions {
  /** Width in the source unit */
  width: number;
  /** Height in the source unit */
  height: number;
  /** Source unit mode (default: current store mode) */
  fromUnit?: UnitMode;
  /** Target unit mode (default: 'px') */
  toUnit?: UnitMode;
}

/**
 * Converts width and height from one unit to another.
 *
 * @param options - Conversion options
 * @returns Object with converted width and height
 *
 * @example
 * ```ts
 * // Convert 8.5" x 11" to pixels at 300 DPI
 * const { width, height } = convertDimensions({
 *   width: 8.5,
 *   height: 11,
 *   fromUnit: 'in',
 *   toUnit: 'px'
 * });
 * // Result: { width: 2550, height: 3300 }
 * ```
 */
export function convertDimensions(options: DimensionOptions): { width: number; height: number } {
  const { width, height, fromUnit = 'px', toUnit = 'px' } = options;

  // Convert from source unit to pixels
  const pxWidth = width * unitScale[fromUnit];
  const pxHeight = height * unitScale[fromUnit];

  // Convert from pixels to target unit
  const targetWidth = pxWidth / unitScale[toUnit];
  const targetHeight = pxHeight / unitScale[toUnit];

  return { width: targetWidth, height: targetHeight };
}

/**
 * Common print sizes in pixels at 300 DPI.
 * Use these for project presets.
 */
export const PrintSizes = {
  /** US Letter (8.5" × 11") */
  LETTER: { width: 2550, height: 3300, label: 'US Letter' },
  /** A4 (210mm × 297mm) */
  A4: { width: 2480, height: 3508, label: 'A4' },
  /** US Legal (8.5" × 14") */
  LEGAL: { width: 2550, height: 4200, label: 'US Legal' },
  /** US Tabloid (11" × 17") */
  TABLOID: { width: 3300, height: 5100, label: 'Tabloid' },
  /** 4" × 6" Photo */
  PHOTO_4X6: { width: 1200, height: 1800, label: '4×6 Photo' },
  /** 5" × 7" Photo */
  PHOTO_5X7: { width: 1500, height: 2100, label: '5×7 Photo' },
  /** 8" × 10" Photo */
  PHOTO_8X10: { width: 2400, height: 3000, label: '8×10 Photo' },
  /** Business Card (3.5" × 2") */
  BUSINESS_CARD: { width: 1050, height: 600, label: 'Business Card' },
  /** Postcard (6" × 4") */
  POSTCARD: { width: 1800, height: 1200, label: 'Postcard' },
} as const;

/**
 * Common social media sizes in pixels.
 */
export const SocialSizes = {
  /** Instagram Post (1080 × 1080) */
  INSTAGRAM_POST: { width: 1080, height: 1080, label: 'Instagram Post' },
  /** Instagram Story (1080 × 1920) */
  INSTAGRAM_STORY: { width: 1080, height: 1920, label: 'Instagram Story' },
  /** Facebook Post (1200 × 630) */
  FACEBOOK_POST: { width: 1200, height: 630, label: 'Facebook Post' },
  /** Twitter Post (1200 × 675) */
  TWITTER_POST: { width: 1200, height: 675, label: 'Twitter/X Post' },
  /** Pinterest Pin (1000 × 1500) */
  PINTEREST_PIN: { width: 1000, height: 1500, label: 'Pinterest Pin' },
  /** LinkedIn Post (1200 × 627) */
  LINKEDIN_POST: { width: 1200, height: 627, label: 'LinkedIn Post' },
} as const;
