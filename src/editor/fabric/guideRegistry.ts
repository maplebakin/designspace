/**
 * PHASE 3.1: Centralized Guide Object Registry
 *
 * This registry provides a single source of truth for identifying guide objects.
 * It solves the problem of inconsistent guide tagging that could cause false negatives
 * in isCanvasInSync(), which could trigger infinite force-rerender loops.
 *
 * Usage:
 * 1. Register guides when creating them: guideRegistry.register(obj, 'safe-margin')
 * 2. Check if an object is a guide: guideRegistry.isGuide(obj)
 * 3. Unregister when removing: guideRegistry.unregister(obj)
 * 4. Clear all on canvas dispose: guideRegistry.clear()
 */

import { v4 as uuidv4 } from 'uuid';
import type * as fabric from 'fabric';

export type GuideType =
  | 'safe-margin'    // Cyan dashed lines for safe area
  | 'bleed'          // Red dashed lines for bleed area
  | 'trim'           // White edge trim lines
  | 'smart-guide'    // Purple snap lines (temporary)
  | 'grid'           // Grid overlay lines
  | 'ruler'          // Ruler markings
  | 'bleed-zone';    // Grey background for bleed

// Internal ID property name to avoid conflicts
const GUIDE_ID_PROP = '__guideRegistryId';

class GuideRegistry {
  private guideIds = new Set<string>();
  private guideTypes = new Map<string, GuideType>();

  /**
   * Register an object as a guide.
   * Assigns a unique internal ID if not already present.
   */
  register(obj: fabric.Object, type: GuideType): string {
    let id = (obj as any)[GUIDE_ID_PROP];

    if (!id) {
      id = `guide-${uuidv4()}`;
      (obj as any)[GUIDE_ID_PROP] = id;
    }

    // Also set the legacy isGuide property for backward compatibility
    (obj as any).isGuide = true;

    this.guideIds.add(id);
    this.guideTypes.set(id, type);

    return id;
  }

  /**
   * Unregister an object from the guide registry.
   */
  unregister(obj: fabric.Object): void {
    const id = (obj as any)[GUIDE_ID_PROP];
    if (id) {
      this.guideIds.delete(id);
      this.guideTypes.delete(id);
    }
  }

  /**
   * Check if an object is registered as a guide.
   * This is the primary method for filtering guides from canvas objects.
   */
  isGuide(obj: fabric.Object): boolean {
    // First check our registry (most reliable)
    const id = (obj as any)[GUIDE_ID_PROP];
    if (id && this.guideIds.has(id)) {
      return true;
    }

    // Fall back to legacy isGuide property for backward compatibility
    // This handles guides that were created before the registry was introduced
    if ((obj as any).isGuide === true) {
      // Register it now for future checks
      this.register(obj, 'safe-margin'); // Default type for legacy guides
      return true;
    }

    return false;
  }

  /**
   * Get the type of a registered guide.
   */
  getGuideType(obj: fabric.Object): GuideType | null {
    const id = (obj as any)[GUIDE_ID_PROP];
    return id ? (this.guideTypes.get(id) ?? null) : null;
  }

  /**
   * Clear all registrations.
   * Call this when disposing of a canvas.
   */
  clear(): void {
    this.guideIds.clear();
    this.guideTypes.clear();
  }

  /**
   * Get the count of registered guides.
   * Useful for debugging and testing.
   */
  get count(): number {
    return this.guideIds.size;
  }

  /**
   * Get all registered guide IDs.
   * Useful for debugging.
   */
  getRegisteredIds(): string[] {
    return Array.from(this.guideIds);
  }

  /**
   * Filter an array of objects to exclude guides.
   * This is the recommended way to get user content from canvas.getObjects().
   */
  filterNonGuides<T extends fabric.Object>(objects: T[]): T[] {
    return objects.filter(obj => !this.isGuide(obj));
  }

  /**
   * Filter an array of objects to include only guides.
   */
  filterGuides<T extends fabric.Object>(objects: T[]): T[] {
    return objects.filter(obj => this.isGuide(obj));
  }

  /**
   * Filter guides by type.
   */
  filterGuidesByType<T extends fabric.Object>(objects: T[], type: GuideType): T[] {
    return objects.filter(obj => {
      const guideType = this.getGuideType(obj);
      return guideType === type;
    });
  }
}

// Export a singleton instance for global use
export const guideRegistry = new GuideRegistry();

// Export the class for testing purposes
export { GuideRegistry };
