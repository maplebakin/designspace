/**
 * Converts an RGB color array to a hex string.
 * @param rgb - An array of [r, g, b] values.
 * @returns A hex color string (e.g., '#RRGGBB').
 */
const rgbToHex = (rgb: Uint8ClampedArray): string => {
    return '#' + [rgb[0], rgb[1], rgb[2]].map(v => v.toString(16).padStart(2, '0')).join('');
};

/**
 * Calculates the dominant color of a fabric.Image object using a 1x1 canvas downsample.
 * @param imageObject - The fabric.Image to analyze.
 * @returns A hex string of the dominant color.
 */
export const getDominantColor = (imageObject: fabric.Image): string => {
    const imgElement = imageObject.getElement() as HTMLImageElement;
    if (!imgElement) {
        return '#ffffff';
    }

    // Create a temporary 1x1 canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 1;
    tempCanvas.height = 1;
    const ctx = tempCanvas.getContext('2d');

    if (!ctx) {
        return '#ffffff';
    }

    // Draw the image onto the 1x1 canvas, which forces downsampling
    ctx.drawImage(imgElement, 0, 0, 1, 1);

    // Get the color of the single pixel
    const pixelData = ctx.getImageData(0, 0, 1, 1).data;
    
    return rgbToHex(pixelData);
};

/**
 * Converts a hex color string to an [r, g, b] array.
 * @param hex - The hex color string.
 * @returns An array of [r, g, b] values.
 */
const hexToRgb = (hex: string): [number, number, number] => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? [
            parseInt(result[1], 16),
            parseInt(result[2], 16),
            parseInt(result[3], 16),
          ]
        : [0, 0, 0];
};

/**
 * Calculates the simple Euclidean distance between two hex colors in RGB space.
 * @param hex1 - The first hex color.
 * @param hex2 - The second hex color.
 * @returns A number representing the color difference.
 */
export const colorDifference = (hex1: string, hex2: string): number => {
    const rgb1 = hexToRgb(hex1);
    const rgb2 = hexToRgb(hex2);

    const rDiff = rgb1[0] - rgb2[0];
    const gDiff = rgb1[1] - rgb2[1];
    const bDiff = rgb1[2] - rgb2[2];

    return Math.sqrt(rDiff * rDiff + gDiff * gDiff + bDiff * bDiff);
};
