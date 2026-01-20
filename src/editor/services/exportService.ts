/**
 * Export Service
 *
 * Handles canvas validation and image export operations.
 * Provides standardized error handling for UI components.
 */

import * as fabric from 'fabric';

// --- TYPES ---

export interface ExportError {
  code: 'CANVAS_NOT_AVAILABLE' | 'CANVAS_EMPTY' | 'EXPORT_FAILED' | 'INVALID_DATA_URL' | 'DOWNLOAD_FAILED' | 'UNKNOWN_ERROR';
  message: string;
  details?: any;
}

export interface ExportResult<T = string> {
  success: boolean;
  data?: T;
  error?: ExportError;
}

export interface ExportOptions {
  format: 'jpeg' | 'png' | 'svg' | 'pdf';
  quality?: number; // 0-100 (for jpeg)
  multiplier?: number; // Scale multiplier (default: 2 for high DPI)
  fileName?: string;
  includeBackground?: boolean;
  withoutTransform?: boolean;
}

export interface ExportedImage {
  dataURL: string;
  fileName: string;
  format: string;
  size: number; // Approximate size in bytes
  metadata: {
    width: number;
    height: number;
    quality?: number;
    multiplier: number;
    timestamp: Date;
  };
}

// --- VALIDATION FUNCTIONS ---

/**
 * Validates that canvas is available and ready.
 */
export function validateCanvas(canvas: fabric.Canvas | null): ExportResult<fabric.Canvas> {
  if (!canvas) {
    return {
      success: false,
      error: {
        code: 'CANVAS_NOT_AVAILABLE',
        message: 'Canvas not available. Please try again.',
        details: { canvas: null }
      }
    };
  }

  return {
    success: true,
    data: canvas
  };
}

/**
 * Validates that canvas has content to export.
 */
export function validateCanvasContent(canvas: fabric.Canvas): ExportResult<fabric.Canvas> {
  const objects = canvas.getObjects();

  if (objects.length === 0) {
    return {
      success: false,
      error: {
        code: 'CANVAS_EMPTY',
        message: 'Canvas is empty. Add some content before exporting.',
        details: { objectCount: 0 }
      }
    };
  }

  return {
    success: true,
    data: canvas
  };
}

/**
 * Validates data URL generated from canvas.
 */
export function validateDataURL(dataURL: string): ExportResult<string> {
  if (!dataURL || dataURL === 'data:,' || dataURL.length < 20) {
    return {
      success: false,
      error: {
        code: 'INVALID_DATA_URL',
        message: 'Failed to generate image. Please try again.',
        details: { dataURL: dataURL?.substring(0, 50) }
      }
    };
  }

  return {
    success: true,
    data: dataURL
  };
}

/**
 * Estimates the size of a data URL in bytes.
 */
export function estimateDataURLSize(dataURL: string): number {
  // Remove data URL prefix to get base64 string
  const base64String = dataURL.split(',')[1] || '';
  // Each base64 character represents 6 bits, so divide by 1.33 to get bytes
  return Math.ceil(base64String.length * 0.75);
}

// --- EXPORT FUNCTIONS ---

/**
 * Generates a data URL from the canvas.
 */
export async function generateDataURL(
  canvas: fabric.Canvas,
  options: Pick<ExportOptions, 'format' | 'quality' | 'multiplier'> = { format: 'png' }
): Promise<ExportResult<string>> {
  try {
    // Allow UI to update before heavy operation
    await new Promise(resolve => setTimeout(resolve, 50));

    const {
      format = 'png',
      quality = 0.9,
      multiplier = 2
    } = options;

    // Filter format to only supported raster formats for toDataURL
    const rasterFormat = (format === 'jpeg' || format === 'png') ? format : 'png';

    const dataURL = canvas.toDataURL({
      format: rasterFormat,
      quality: format === 'jpeg' ? quality : 1,
      multiplier,
    });

    return validateDataURL(dataURL);
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'EXPORT_FAILED',
        message: 'Failed to generate image data.',
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      }
    };
  }
}

/**
 * Generates a timestamped filename.
 */
export function generateFileName(
  baseName: string = 'design',
  format: string,
  includeTimestamp: boolean = true
): string {
  if (includeTimestamp) {
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return `${baseName}-${timestamp}.${format}`;
  }

  return `${baseName}.${format}`;
}

/**
 * Downloads a data URL as a file.
 */
export function downloadDataURL(
  dataURL: string,
  fileName: string
): ExportResult<void> {
  try {
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = fileName;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    return {
      success: true
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'DOWNLOAD_FAILED',
        message: 'Failed to download file.',
        details: { error: error instanceof Error ? error.message : 'Unknown error', fileName }
      }
    };
  }
}

/**
 * Exports canvas to an image file (all-in-one).
 * This is the main function components should use.
 */
export async function exportCanvasToImage(
  canvas: fabric.Canvas | null,
  options: ExportOptions
): Promise<ExportResult<ExportedImage>> {
  try {
    // Step 1: Validate canvas
    const canvasResult = validateCanvas(canvas);
    if (!canvasResult.success) {
      return {
        success: false,
        error: canvasResult.error
      };
    }

    const validCanvas = canvasResult.data!;

    // Step 2: Validate canvas has content
    const contentResult = validateCanvasContent(validCanvas);
    if (!contentResult.success) {
      return {
        success: false,
        error: contentResult.error
      };
    }

    // Step 3: Generate data URL
    const {
      format = 'png',
      quality = 90,
      multiplier = 2,
      fileName
    } = options;

    const dataURLResult = await generateDataURL(validCanvas, {
      format,
      quality: quality / 100, // Convert 0-100 to 0-1
      multiplier
    });

    if (!dataURLResult.success) {
      return {
        success: false,
        error: dataURLResult.error
      };
    }

    const dataURL = dataURLResult.data!;

    // Step 4: Generate filename
    const generatedFileName = fileName || generateFileName('design', format);

    // Step 5: Get canvas dimensions
    const width = validCanvas.getWidth();
    const height = validCanvas.getHeight();
    const size = estimateDataURLSize(dataURL);

    // Return export result with metadata
    return {
      success: true,
      data: {
        dataURL,
        fileName: generatedFileName,
        format,
        size,
        metadata: {
          width,
          height,
          quality: format === 'jpeg' ? quality : undefined,
          multiplier,
          timestamp: new Date()
        }
      }
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'UNKNOWN_ERROR',
        message: error instanceof Error ? error.message : 'An unknown error occurred during export.',
        details: { error }
      }
    };
  }
}

/**
 * Full export workflow: generate image and download.
 */
export async function exportAndDownload(
  canvas: fabric.Canvas | null,
  options: ExportOptions
): Promise<ExportResult<ExportedImage>> {
  // Generate image
  const exportResult = await exportCanvasToImage(canvas, options);

  if (!exportResult.success) {
    return exportResult;
  }

  const exportedImage = exportResult.data!;

  // Download image
  const downloadResult = downloadDataURL(exportedImage.dataURL, exportedImage.fileName);

  if (!downloadResult.success) {
    return {
      success: false,
      error: downloadResult.error
    };
  }

  // Return success with exported image data
  return {
    success: true,
    data: exportedImage
  };
}

// --- UTILITY FUNCTIONS ---

/**
 * Gets canvas dimensions.
 */
export function getCanvasDimensions(canvas: fabric.Canvas | null): { width: number; height: number } | null {
  if (!canvas) return null;

  return {
    width: canvas.getWidth(),
    height: canvas.getHeight()
  };
}

/**
 * Gets canvas object count.
 */
export function getCanvasObjectCount(canvas: fabric.Canvas | null): number {
  if (!canvas) return 0;
  return canvas.getObjects().length;
}

/**
 * Formats file size for display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Calculates export dimensions based on multiplier.
 */
export function calculateExportDimensions(
  canvas: fabric.Canvas | null,
  multiplier: number = 1
): { width: number; height: number } | null {
  const dimensions = getCanvasDimensions(canvas);
  if (!dimensions) return null;

  return {
    width: dimensions.width * multiplier,
    height: dimensions.height * multiplier
  };
}

/**
 * Validates export options.
 */
export function validateExportOptions(options: Partial<ExportOptions>): ExportResult<ExportOptions> {
  const {
    format = 'png',
    quality = 90,
    multiplier = 2
  } = options;

  // Validate format
  const validFormats: ExportOptions['format'][] = ['jpeg', 'png', 'svg', 'pdf'];
  if (!validFormats.includes(format)) {
    return {
      success: false,
      error: {
        code: 'UNKNOWN_ERROR',
        message: `Invalid export format. Must be one of: ${validFormats.join(', ')}.`,
        details: { format, validFormats }
      }
    };
  }

  // Validate quality (for jpeg)
  if (format === 'jpeg' && (quality < 1 || quality > 100)) {
    return {
      success: false,
      error: {
        code: 'UNKNOWN_ERROR',
        message: 'Quality must be between 1 and 100.',
        details: { quality }
      }
    };
  }

  // Validate multiplier
  if (multiplier < 0.1 || multiplier > 10) {
    return {
      success: false,
      error: {
        code: 'UNKNOWN_ERROR',
        message: 'Multiplier must be between 0.1 and 10.',
        details: { multiplier }
      }
    };
  }

  return {
    success: true,
    data: {
      format,
      quality,
      multiplier,
      ...options
    } as ExportOptions
  };
}
