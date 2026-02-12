/**
 * Error Handling Utilities
 *
 * Provides standardized error handling and user feedback mechanisms.
 * Ensures consistent error messages and logging throughout the application.
 *
 * Note: This module uses a toast callback pattern to avoid circular
 * dependencies with the editor store.
 */

// ============================================================================
// TYPES
// ============================================================================

/** Error severity levels for logging and display */
export type ErrorSeverity = 'info' | 'warning' | 'error';

/** Standard result type for operations that can fail */
export interface OperationResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

/** Options for error display */
interface ErrorDisplayOptions {
  /** Duration to show toast in milliseconds (default: 4000) */
  duration?: number;
  /** Whether to log to console (default: true for errors) */
  log?: boolean;
  /** Additional context for logging */
  context?: Record<string, unknown>;
}

// ============================================================================
// TOAST CALLBACK REGISTRY
// ============================================================================

/** Callback to display toast messages (set by EditorShell on mount) */
let toastCallback: ((message: string) => void) | null = null;

/**
 * Registers the toast callback. Called once by EditorShell on mount.
 * This avoids circular dependencies with the editor store.
 */
export function registerToastCallback(callback: (message: string) => void): void {
  toastCallback = callback;
}

/**
 * Internal helper to show a toast message.
 */
function showToast(message: string): void {
  if (toastCallback) {
    toastCallback(message);
  } else {
    // Fallback to console if toast not registered yet
    console.log(`[Toast] ${message}`);
  }
}

// ============================================================================
// ERROR DISPLAY
// ============================================================================

/**
 * Displays an error message to the user via toast notification.
 *
 * @param message - The error message to display
 * @param options - Display and logging options
 */
export function showError(message: string, options: ErrorDisplayOptions = {}): void {
  const { log = true, context } = options;

  // Display toast
  showToast(message);

  // Log to console
  if (log) {
    console.error(`[DesignSpace Error] ${message}`, context ?? '');
  }
}

/**
 * Displays a warning message to the user.
 *
 * @param message - The warning message to display
 * @param options - Display and logging options
 */
export function showWarning(message: string, options: ErrorDisplayOptions = {}): void {
  const { log = true, context } = options;

  showToast(message);

  if (log) {
    console.warn(`[DesignSpace Warning] ${message}`, context ?? '');
  }
}

/**
 * Displays a success/info message to the user.
 *
 * @param message - The info message to display
 */
export function showInfo(message: string): void {
  showToast(message);
}

// ============================================================================
// ERROR WRAPPING
// ============================================================================

/**
 * Wraps an async operation with standardized error handling.
 * Returns an OperationResult instead of throwing.
 *
 * @param operation - The async operation to execute
 * @param errorMessage - User-friendly error message if operation fails
 * @returns OperationResult with success status and optional data/error
 *
 * @example
 * ```ts
 * const result = await safeAsync(
 *   () => saveProject(name),
 *   'Failed to save project'
 * );
 * if (!result.success) {
 *   // Error already displayed to user
 *   return;
 * }
 * ```
 */
export async function safeAsync<T>(
  operation: () => Promise<T>,
  errorMessage: string
): Promise<OperationResult<T>> {
  try {
    const data = await operation();
    return { success: true, data };
  } catch (error) {
    const detailedError = error instanceof Error ? error.message : String(error);
    showError(errorMessage, { context: { detail: detailedError } });
    return { success: false, error: detailedError };
  }
}

/**
 * Wraps a synchronous operation with standardized error handling.
 *
 * @param operation - The sync operation to execute
 * @param errorMessage - User-friendly error message if operation fails
 * @returns OperationResult with success status and optional data/error
 */
export function safeSync<T>(
  operation: () => T,
  errorMessage: string
): OperationResult<T> {
  try {
    const data = operation();
    return { success: true, data };
  } catch (error) {
    const detailedError = error instanceof Error ? error.message : String(error);
    showError(errorMessage, { context: { detail: detailedError } });
    return { success: false, error: detailedError };
  }
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validates file type against allowed extensions.
 *
 * @param file - The file to validate
 * @param allowedExtensions - Array of allowed extensions (e.g., ['.json', '.svg'])
 * @returns True if valid, false otherwise (with error shown)
 */
export function validateFileType(file: File, allowedExtensions: string[]): boolean {
  const fileName = file.name.toLowerCase();
  const isValid = allowedExtensions.some((ext) => fileName.endsWith(ext));

  if (!isValid) {
    showError(`Invalid file type. Allowed: ${allowedExtensions.join(', ')}`);
  }

  return isValid;
}

/**
 * Validates file size against maximum allowed.
 *
 * @param file - The file to validate
 * @param maxSizeBytes - Maximum allowed size in bytes
 * @returns True if valid, false otherwise (with error shown)
 */
export function validateFileSize(file: File, maxSizeBytes: number): boolean {
  if (file.size > maxSizeBytes) {
    const maxMB = (maxSizeBytes / (1024 * 1024)).toFixed(1);
    showError(`File too large. Maximum size: ${maxMB}MB`);
    return false;
  }

  return true;
}

// ============================================================================
// COMMON ERROR MESSAGES
// ============================================================================

export const ErrorMessages = {
  CANVAS_NOT_READY: 'Canvas is not ready. Please wait.',
  NO_SELECTION: 'Please select an object first.',
  EXPORT_FAILED: 'Export failed. Please try again.',
  SAVE_FAILED: 'Failed to save. Please try again.',
  LOAD_FAILED: 'Failed to load file. Please check the file format.',
  INVALID_THEME: 'Invalid theme file. Please check the format.',
  IMAGE_LOAD_FAILED: 'Failed to load image. The file may be corrupted or unsupported.',
  CORS_ERROR: 'Cannot load external image due to security restrictions.',
} as const;
