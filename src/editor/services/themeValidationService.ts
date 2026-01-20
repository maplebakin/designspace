/**
 * Theme Validation Service
 *
 * Handles validation and processing of Apocapalette theme JSON files.
 * Provides standardized error handling for UI components.
 */

import type { ApocapaletteTheme } from '../types/apocapalette';

// --- TYPES ---

export interface ValidationError {
  code: 'INVALID_FILE_TYPE' | 'FILE_TOO_LARGE' | 'READ_ERROR' | 'INVALID_JSON' | 'INVALID_SCHEMA' | 'UNKNOWN_ERROR';
  message: string;
  details?: any;
}

export interface ValidationResult<T = string> {
  success: boolean;
  data?: T;
  error?: ValidationError;
}

export interface ThemeValidationOptions {
  maxSizeBytes?: number;
  requiredFields?: string[];
  allowedExtensions?: string[];
}

export interface ValidatedTheme {
  rawJson: string;
  parsed: ApocapaletteTheme;
  metadata: {
    fileName: string;
    fileSize: number;
    validatedAt: Date;
  };
}

// --- CONSTANTS ---

const DEFAULT_MAX_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_REQUIRED_FIELDS = ['name', 'id'];
const DEFAULT_ALLOWED_EXTENSIONS = ['.json'];

// --- VALIDATION FUNCTIONS ---

/**
 * Validates file type based on extension.
 */
export function validateFileType(
  file: File,
  allowedExtensions: string[] = DEFAULT_ALLOWED_EXTENSIONS
): ValidationResult<File> {
  const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

  if (!allowedExtensions.includes(extension)) {
    return {
      success: false,
      error: {
        code: 'INVALID_FILE_TYPE',
        message: `Invalid file type. Please select a JSON file.`,
        details: { fileName: file.name, extension, allowedExtensions }
      }
    };
  }

  return {
    success: true,
    data: file
  };
}

/**
 * Validates file size.
 */
export function validateFileSize(
  file: File,
  maxSizeBytes: number = DEFAULT_MAX_SIZE
): ValidationResult<File> {
  if (file.size > maxSizeBytes) {
    const maxSizeMB = (maxSizeBytes / (1024 * 1024)).toFixed(1);
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);

    return {
      success: false,
      error: {
        code: 'FILE_TOO_LARGE',
        message: `File too large. Maximum size is ${maxSizeMB}MB.`,
        details: { fileSize: file.size, maxSize: maxSizeBytes, fileSizeMB, maxSizeMB }
      }
    };
  }

  return {
    success: true,
    data: file
  };
}

/**
 * Reads file content as text using FileReader.
 */
export function readFileAsText(file: File): Promise<ValidationResult<string>> {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (event: ProgressEvent<FileReader>) => {
      const result = event.target?.result;

      if (typeof result === 'string') {
        resolve({
          success: true,
          data: result
        });
      } else {
        resolve({
          success: false,
          error: {
            code: 'READ_ERROR',
            message: 'Failed to read file content.',
            details: { fileName: file.name }
          }
        });
      }
    };

    reader.onerror = () => {
      resolve({
        success: false,
        error: {
          code: 'READ_ERROR',
          message: 'Failed to read file.',
          details: { fileName: file.name, error: reader.error }
        }
      });
    };

    reader.readAsText(file);
  });
}

/**
 * Parses JSON string.
 */
export function parseJSON<T = any>(jsonString: string): ValidationResult<T> {
  try {
    const parsed = JSON.parse(jsonString);
    return {
      success: true,
      data: parsed as T
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Invalid JSON format. Please check the file.',
        details: { error: error instanceof Error ? error.message : 'Unknown parse error' }
      }
    };
  }
}

/**
 * Validates Apocapalette theme schema.
 */
export function validateThemeSchema(
  theme: any,
  requiredFields: string[] = DEFAULT_REQUIRED_FIELDS
): ValidationResult<ApocapaletteTheme> {
  const missingFields: string[] = [];

  for (const field of requiredFields) {
    if (!(field in theme) || !theme[field]) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    return {
      success: false,
      error: {
        code: 'INVALID_SCHEMA',
        message: `Invalid theme format. Missing required fields: ${missingFields.join(', ')}.`,
        details: { missingFields, requiredFields }
      }
    };
  }

  // Additional Apocapalette-specific validation
  if (typeof theme.name !== 'string' || theme.name.trim().length === 0) {
    return {
      success: false,
      error: {
        code: 'INVALID_SCHEMA',
        message: 'Invalid theme format. Theme name must be a non-empty string.',
        details: { field: 'name', value: theme.name }
      }
    };
  }

  if (typeof theme.id !== 'string' || theme.id.trim().length === 0) {
    return {
      success: false,
      error: {
        code: 'INVALID_SCHEMA',
        message: 'Invalid theme format. Theme ID must be a non-empty string.',
        details: { field: 'id', value: theme.id }
      }
    };
  }

  return {
    success: true,
    data: theme as ApocapaletteTheme
  };
}

/**
 * Validates and processes a theme file (all-in-one).
 * This is the main function components should use.
 */
export async function validateThemeFile(
  file: File,
  options: ThemeValidationOptions = {}
): Promise<ValidationResult<ValidatedTheme>> {
  const {
    maxSizeBytes = DEFAULT_MAX_SIZE,
    requiredFields = DEFAULT_REQUIRED_FIELDS,
    allowedExtensions = DEFAULT_ALLOWED_EXTENSIONS
  } = options;

  try {
    // Step 1: Validate file type
    const typeResult = validateFileType(file, allowedExtensions);
    if (!typeResult.success) {
      return {
        success: false,
        error: typeResult.error
      };
    }

    // Step 2: Validate file size
    const sizeResult = validateFileSize(file, maxSizeBytes);
    if (!sizeResult.success) {
      return {
        success: false,
        error: sizeResult.error
      };
    }

    // Step 3: Read file content
    const readResult = await readFileAsText(file);
    if (!readResult.success) {
      return {
        success: false,
        error: readResult.error
      };
    }

    const rawJson = readResult.data!;

    // Step 4: Parse JSON
    const parseResult = parseJSON(rawJson);
    if (!parseResult.success) {
      return {
        success: false,
        error: parseResult.error
      };
    }

    const parsedJson = parseResult.data!;

    // Step 5: Validate schema
    const schemaResult = validateThemeSchema(parsedJson, requiredFields);
    if (!schemaResult.success) {
      return {
        success: false,
        error: schemaResult.error
      };
    }

    const validatedTheme = schemaResult.data!;

    // Return validated theme with metadata
    return {
      success: true,
      data: {
        rawJson,
        parsed: validatedTheme,
        metadata: {
          fileName: file.name,
          fileSize: file.size,
          validatedAt: new Date()
        }
      }
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'UNKNOWN_ERROR',
        message: error instanceof Error ? error.message : 'An unknown error occurred.',
        details: { error }
      }
    };
  }
}

/**
 * Checks if a theme with the given ID already exists in a list.
 */
export function isDuplicateTheme(
  themeId: string,
  existingThemes: Array<{ id: string }>
): boolean {
  return existingThemes.some(theme => theme.id === themeId);
}

/**
 * Generates a unique theme ID by appending a number if duplicate exists.
 */
export function generateUniqueThemeId(
  baseId: string,
  existingThemes: Array<{ id: string }>
): string {
  let uniqueId = baseId;
  let counter = 1;

  while (isDuplicateTheme(uniqueId, existingThemes)) {
    uniqueId = `${baseId}-${counter}`;
    counter++;
  }

  return uniqueId;
}

/**
 * Validates multiple theme files at once.
 * Returns results for each file.
 */
export async function validateThemeFiles(
  files: File[],
  options: ThemeValidationOptions = {}
): Promise<ValidationResult<ValidatedTheme>[]> {
  return Promise.all(
    files.map(file => validateThemeFile(file, options))
  );
}

/**
 * Format file size for display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
