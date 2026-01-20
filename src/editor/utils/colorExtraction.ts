/**
 * Color Extraction Utility
 * Uses Canvas API to extract dominant colors from images
 */

export interface ExtractedColor {
  hex: string;
  rgb: { r: number; g: number; b: number };
  count: number;
  percentage: number;
}

export interface ColorExtractionOptions {
  /** Number of colors to extract. Default: 5 */
  colorCount?: number;
  /** Quality (1 = every pixel, 10 = every 10th pixel). Default: 10 */
  quality?: number;
  /** Minimum difference between colors (0-255). Default: 25 */
  minColorDifference?: number;
  /** Skip very dark colors (brightness < threshold). Default: 10 */
  minBrightness?: number;
  /** Skip very light colors (brightness > threshold). Default: 245 */
  maxBrightness?: number;
}

/**
 * Convert RGB to hex string
 */
const rgbToHex = (r: number, g: number, b: number): string => {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
};

/**
 * Calculate color brightness (0-255)
 */
const getBrightness = (r: number, g: number, b: number): number => {
  return (r * 299 + g * 587 + b * 114) / 1000;
};

/**
 * Calculate color difference using Euclidean distance in RGB space
 */
const colorDistance = (
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number
): number => {
  return Math.sqrt(
    Math.pow(r1 - r2, 2) +
    Math.pow(g1 - g2, 2) +
    Math.pow(b1 - b2, 2)
  );
};

/**
 * Quantize a color value to reduce the color space
 */
const quantize = (value: number, factor: number = 24): number => {
  return Math.round(value / factor) * factor;
};

/**
 * Extract dominant colors from an image using Canvas API
 */
export const extractColorsFromImage = async (
  imageSource: string | HTMLImageElement,
  options: ColorExtractionOptions = {}
): Promise<ExtractedColor[]> => {
  const {
    colorCount = 5,
    quality = 10,
    minColorDifference = 25,
    minBrightness = 10,
    maxBrightness = 245,
  } = options;

  return new Promise((resolve, reject) => {
    const processImage = (img: HTMLImageElement) => {
      try {
        // Create canvas
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        // Scale down large images for performance
        const maxDimension = 200;
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (width > maxDimension || height > maxDimension) {
          const scale = maxDimension / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        canvas.width = width;
        canvas.height = height;

        // Draw image
        ctx.drawImage(img, 0, 0, width, height);

        // Get pixel data
        const imageData = ctx.getImageData(0, 0, width, height);
        const pixels = imageData.data;

        // Count colors using quantization
        const colorMap = new Map<string, { r: number; g: number; b: number; count: number }>();

        for (let i = 0; i < pixels.length; i += 4 * quality) {
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          const a = pixels[i + 3];

          // Skip transparent pixels
          if (a < 128) continue;

          // Skip very dark or very light colors
          const brightness = getBrightness(r, g, b);
          if (brightness < minBrightness || brightness > maxBrightness) continue;

          // Quantize color
          const qr = quantize(r);
          const qg = quantize(g);
          const qb = quantize(b);
          const key = `${qr},${qg},${qb}`;

          const existing = colorMap.get(key);
          if (existing) {
            existing.count++;
            // Average the actual colors for better accuracy
            existing.r = Math.round((existing.r * (existing.count - 1) + r) / existing.count);
            existing.g = Math.round((existing.g * (existing.count - 1) + g) / existing.count);
            existing.b = Math.round((existing.b * (existing.count - 1) + b) / existing.count);
          } else {
            colorMap.set(key, { r, g, b, count: 1 });
          }
        }

        // Sort by frequency
        const sortedColors = Array.from(colorMap.values())
          .sort((a, b) => b.count - a.count);

        // Select diverse colors
        const selectedColors: ExtractedColor[] = [];
        const totalPixels = (width * height) / quality;

        for (const color of sortedColors) {
          if (selectedColors.length >= colorCount) break;

          // Check if this color is different enough from already selected colors
          const isDifferent = selectedColors.every(selected =>
            colorDistance(
              color.r, color.g, color.b,
              selected.rgb.r, selected.rgb.g, selected.rgb.b
            ) >= minColorDifference
          );

          if (isDifferent) {
            selectedColors.push({
              hex: rgbToHex(color.r, color.g, color.b),
              rgb: { r: color.r, g: color.g, b: color.b },
              count: color.count,
              percentage: Math.round((color.count / totalPixels) * 100),
            });
          }
        }

        resolve(selectedColors);
      } catch (error) {
        reject(error);
      }
    };

    // Handle different input types
    if (typeof imageSource === 'string') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => processImage(img);
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = imageSource;
    } else {
      processImage(imageSource);
    }
  });
};

/**
 * Extract colors from a blob
 */
export const extractColorsFromBlob = async (
  blob: Blob,
  options: ColorExtractionOptions = {}
): Promise<ExtractedColor[]> => {
  const url = URL.createObjectURL(blob);
  try {
    const colors = await extractColorsFromImage(url, options);
    return colors;
  } finally {
    URL.revokeObjectURL(url);
  }
};

/**
 * Extract colors from a data URL
 */
export const extractColorsFromDataUrl = async (
  dataUrl: string,
  options: ColorExtractionOptions = {}
): Promise<ExtractedColor[]> => {
  return extractColorsFromImage(dataUrl, options);
};

/**
 * Get just the hex values from extracted colors
 */
export const extractHexColors = async (
  imageSource: string | HTMLImageElement | Blob,
  options: ColorExtractionOptions = {}
): Promise<string[]> => {
  let colors: ExtractedColor[];

  if (imageSource instanceof Blob) {
    colors = await extractColorsFromBlob(imageSource, options);
  } else {
    colors = await extractColorsFromImage(imageSource, options);
  }

  return colors.map(c => c.hex);
};

/**
 * Calculate a complementary color
 */
export const getComplementaryColor = (hex: string): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return rgbToHex(255 - r, 255 - g, 255 - b);
};

/**
 * Check if a color is light or dark
 */
export const isLightColor = (hex: string): boolean => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return getBrightness(r, g, b) > 128;
};

/**
 * Sort colors by hue for a more pleasing arrangement
 */
export const sortColorsByHue = (colors: string[]): string[] => {
  const rgbToHsl = (r: number, g: number, b: number) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0;
    const l = (max + min) / 2;
    const d = max - min;

    if (max !== min) {
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h, s: max === min ? 0 : d / (1 - Math.abs(2 * l - 1)), l };
  };

  return [...colors].sort((a, b) => {
    const colorA = {
      r: parseInt(a.slice(1, 3), 16),
      g: parseInt(a.slice(3, 5), 16),
      b: parseInt(a.slice(5, 7), 16),
    };
    const colorB = {
      r: parseInt(b.slice(1, 3), 16),
      g: parseInt(b.slice(3, 5), 16),
      b: parseInt(b.slice(5, 7), 16),
    };
    const hslA = rgbToHsl(colorA.r, colorA.g, colorA.b);
    const hslB = rgbToHsl(colorB.r, colorB.g, colorB.b);
    return hslA.h - hslB.h;
  });
};
