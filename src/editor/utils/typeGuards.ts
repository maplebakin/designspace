/**
 * Type Guards and Utility Functions
 *
 * Provides type-safe access to custom Fabric.js object properties,
 * reducing the need for `any` casts throughout the codebase.
 */

import * as fabric from 'fabric';
import type {
  ImageAdjustments,
  DesignSpaceObject,
  DesignSpaceImage,
} from '../types/fabric-extensions.d';

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Checks if an object is a guide (excluded from layers/export).
 */
export function isGuide(obj: fabric.FabricObject | null | undefined): boolean {
  if (!obj) return false;
  return !!(obj as DesignSpaceObject).isGuide;
}

/**
 * Checks if an object is the document paper background.
 */
export function isDocumentPaper(obj: fabric.FabricObject | null | undefined): boolean {
  if (!obj) return false;
  return !!(obj as DesignSpaceObject).isDocumentPaper;
}

/**
 * Checks if an object is a text object (IText or Textbox).
 */
export function isTextObject(obj: fabric.FabricObject | null | undefined): obj is fabric.IText | fabric.Textbox {
  if (!obj) return false;
  return obj.type === 'i-text' || obj.type === 'textbox' || obj.type === 'text';
}

/**
 * Checks if an object is an image.
 */
export function isImage(obj: fabric.FabricObject | null | undefined): obj is fabric.FabricImage {
  if (!obj) return false;
  return obj.type === 'image';
}

/**
 * Checks if an object is a group.
 */
export function isGroup(obj: fabric.FabricObject | null | undefined): obj is fabric.Group {
  if (!obj) return false;
  return obj.type === 'group';
}

/**
 * Checks if an object is an active selection.
 */
export function isActiveSelection(obj: fabric.FabricObject | null | undefined): obj is fabric.ActiveSelection {
  if (!obj) return false;
  return obj.type === 'activeSelection' || obj.type === 'activeselection';
}

/**
 * Checks if an object is a rectangle.
 */
export function isRect(obj: fabric.FabricObject | null | undefined): obj is fabric.Rect {
  if (!obj) return false;
  return obj.type === 'rect';
}

/**
 * Checks if a text object is currently being edited.
 */
export function isTextEditing(obj: fabric.FabricObject | null | undefined): boolean {
  if (!isTextObject(obj)) return false;
  const textObj = obj as fabric.IText;
  return !!(textObj as any).isEditing || !!(textObj as any).editing;
}

// ============================================================================
// PROPERTY ACCESSORS
// ============================================================================

/**
 * Gets the unique ID of an object, or undefined if not set.
 */
export function getObjectId(obj: fabric.FabricObject | null | undefined): string | undefined {
  if (!obj) return undefined;
  const id = (obj as DesignSpaceObject).id;
  return typeof id === 'string' && id.trim().length > 0 ? id : undefined;
}

/**
 * Sets the unique ID of an object.
 */
export function setObjectId(obj: fabric.FabricObject, id: string): void {
  (obj as DesignSpaceObject).id = id;
}

/**
 * Gets the token role of an object (theme color binding).
 */
export function getTokenRole(obj: fabric.FabricObject | null | undefined): string | null {
  if (!obj) return null;
  const role = (obj as DesignSpaceObject).tokenRole;
  return typeof role === 'string' && role.trim().length > 0 ? role : null;
}

/**
 * Sets the token role of an object.
 */
export function setTokenRole(obj: fabric.FabricObject, tokenRole: string | null): void {
  (obj as DesignSpaceObject).tokenRole = tokenRole;
}

/**
 * Checks if an object's color is locked to theme.
 */
export function isColorLocked(obj: fabric.FabricObject | null | undefined): boolean {
  if (!obj) return false;
  return !!(obj as DesignSpaceObject).colorLocked;
}

/**
 * Sets the color locked state of an object.
 */
export function setColorLocked(obj: fabric.FabricObject, locked: boolean): void {
  (obj as DesignSpaceObject).colorLocked = locked;
}

/**
 * Gets image adjustments from an image object.
 */
export function getImageAdjustments(obj: fabric.FabricObject | null | undefined): ImageAdjustments {
  const defaults: ImageAdjustments = { brightness: 0, contrast: 0, saturation: 0 };
  if (!obj || !isImage(obj)) return defaults;
  return (obj as DesignSpaceImage).adjustments ?? defaults;
}

/**
 * Sets image adjustments on an image object.
 */
export function setImageAdjustments(obj: fabric.FabricImage, adjustments: Partial<ImageAdjustments>): void {
  const dsImage = obj as DesignSpaceImage;
  if (!dsImage.adjustments) {
    dsImage.adjustments = { brightness: 0, contrast: 0, saturation: 0 };
  }
  Object.assign(dsImage.adjustments, adjustments);
}

// ============================================================================
// COLLECTION UTILITIES
// ============================================================================

/**
 * Filters out guide objects from an array of objects.
 */
export function filterNonGuides(objects: fabric.FabricObject[]): fabric.FabricObject[] {
  return objects.filter((obj) => !isGuide(obj));
}

/**
 * Gets all content objects from a canvas (excludes guides).
 */
export function getContentObjects(canvas: fabric.Canvas): fabric.FabricObject[] {
  return filterNonGuides(canvas.getObjects());
}

/**
 * Finds an object by ID on the canvas.
 */
export function findObjectById(
  canvas: fabric.Canvas | null | undefined,
  id: string | null | undefined
): fabric.FabricObject | null {
  if (!canvas || !id) return null;
  return canvas.getObjects().find((obj) => getObjectId(obj) === id) ?? null;
}

/**
 * Walks through all objects including nested group children.
 */
export function walkObjects(
  objects: fabric.FabricObject[],
  callback: (obj: fabric.FabricObject) => void
): void {
  objects.forEach((obj) => {
    callback(obj);
    if (isGroup(obj) || isActiveSelection(obj)) {
      walkObjects((obj as fabric.Group).getObjects(), callback);
    }
  });
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Validates that a string is a non-empty trimmed value.
 */
export function isValidString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates that a number is finite and within a range.
 */
export function isValidNumber(value: unknown, min?: number, max?: number): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

/**
 * Clamps a value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
