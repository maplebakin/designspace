/**
 * Type declarations for our custom Fabric.js extensions.
 * This file augments the Fabric.js types with our custom properties.
 *
 * @description Provides type-safe access to custom properties added to Fabric.js objects
 * throughout the Design Space application. These extensions support theming, layer management,
 * and canvas organization features.
 */

import * as fabric from 'fabric';

// ============================================================================
// FILTER TYPES
// ============================================================================

/** Base interface for all Fabric.js filters */
interface BaseFilter {
  type: string;
  [key: string]: unknown;
}

/** Brightness filter configuration */
interface BrightnessFilter extends BaseFilter {
  type: 'Brightness';
  /** Brightness adjustment value (-1 to 1, 0 is neutral) */
  brightness: number;
}

/** Contrast filter configuration */
interface ContrastFilter extends BaseFilter {
  type: 'Contrast';
  /** Contrast adjustment value (-1 to 1, 0 is neutral) */
  contrast: number;
}

/** Saturation filter configuration */
interface SaturationFilter extends BaseFilter {
  type: 'Saturation';
  /** Saturation adjustment value (-1 to 1, 0 is neutral) */
  saturation: number;
}

/** Grayscale filter configuration */
interface GrayscaleFilter extends BaseFilter {
  type: 'Grayscale';
  /** Grayscale calculation mode */
  mode?: 'average' | 'lightness' | 'luminosity';
}

/** Union type for all supported image filters */
type ImageFilter = BrightnessFilter | ContrastFilter | SaturationFilter | GrayscaleFilter | BaseFilter;

// ============================================================================
// IMAGE ADJUSTMENTS
// ============================================================================

/**
 * Image adjustment values stored on image objects.
 * All values range from -1 to 1, where 0 is neutral.
 */
interface ImageAdjustments {
  /** Brightness adjustment (-1 darker to 1 brighter) */
  brightness: number;
  /** Contrast adjustment (-1 less contrast to 1 more contrast) */
  contrast: number;
  /** Saturation adjustment (-1 desaturated to 1 oversaturated) */
  saturation: number;
}

// ============================================================================
// GUIDE TYPES
// ============================================================================

/** Types of guides that can be registered in the guide registry */
type GuideType =
  | 'smart-guide'
  | 'safe-margin'
  | 'bleed'
  | 'bleed-zone'
  | 'trim'
  | 'document-paper'
  | 'grid';

// ============================================================================
// CUSTOM OBJECT PROPERTIES
// ============================================================================

/**
 * Custom properties added to all Fabric.js objects in Design Space.
 * These properties support theming, layer management, and canvas organization.
 */
interface CustomObjectProps {
  /** Unique identifier for the object (UUID) */
  id?: string;
  /** Theme token path for dynamic color application (e.g., 'brand.primary.value') */
  tokenRole?: string | null;
  /** When true, object fill follows theme changes */
  colorLocked?: boolean;
  /** Marks object as a placeholder for layout purposes */
  isPlaceholder?: boolean;
  /** Marks object as a guide (excluded from layers/export) */
  isGuide?: boolean;
  /** Marks object as a decorative frame */
  isFrame?: boolean;
  /** Type of frame shape when isFrame is true */
  frameType?: 'circle' | 'star' | 'hexagon' | 'badge';
  /** Base corner radius X (preserved during scaling) */
  __baseRx?: number;
  /** Base corner radius Y (preserved during scaling) */
  __baseRy?: number;
  /** Marks object as the document background paper */
  isDocumentPaper?: boolean;
  /** Marks object as bleed zone visualization */
  isBleedZone?: boolean;
  /** Marks object as trim line */
  isTrimLine?: boolean;
  /** When true, object is excluded from export */
  excludeFromExport?: boolean;
  /** Custom name for the layer panel */
  name?: string;
}

// ============================================================================
// EXTENDED TYPE DEFINITIONS
// ============================================================================

/** Extended Image type with adjustment properties */
interface ExtendedImageProps extends CustomObjectProps {
  /** Stored adjustment values for persistence */
  adjustments?: ImageAdjustments;
  /** Applied image filters */
  filters?: ImageFilter[];
}

/** Fixed-frame textbox custom properties */
interface FixedTextboxProps extends CustomObjectProps {
  /** Fixed width for font auto-sizing */
  __fixedWidth?: number;
  /** Fixed height for font auto-sizing */
  __fixedHeight?: number;
  /** Original font size before auto-sizing */
  originalFontSize?: number;
}

// ============================================================================
// FABRIC MODULE AUGMENTATION
// ============================================================================

declare module 'fabric' {
  // Base object extensions
  interface FabricObject extends CustomObjectProps {}

  // Image extensions
  interface FabricImage extends ExtendedImageProps {
    /** Applies all filters in the filters array to the image */
    applyFilters(): void;
  }

  // Text extensions
  interface IText extends CustomObjectProps {
    /** Character spacing in 1/1000 em */
    charSpacing?: number;
  }

  interface Textbox extends FixedTextboxProps {
    /** Character spacing in 1/1000 em */
    charSpacing?: number;
    /** Line height multiplier */
    lineHeight?: number;
  }

  // Shape extensions
  interface Rect extends CustomObjectProps {
    /** Horizontal corner radius */
    rx?: number;
    /** Vertical corner radius */
    ry?: number;
  }

  interface Circle extends CustomObjectProps {}
  interface Triangle extends CustomObjectProps {}
  interface Polygon extends CustomObjectProps {}
  interface Group extends CustomObjectProps {}
  interface Line extends CustomObjectProps {}
  interface ActiveSelection extends CustomObjectProps {}

  // Filter constructors
  namespace filters {
    class Brightness {
      type: 'Brightness';
      brightness: number;
      constructor(options?: { brightness?: number });
    }

    class Contrast {
      type: 'Contrast';
      contrast: number;
      constructor(options?: { contrast?: number });
    }

    class Saturation {
      type: 'Saturation';
      saturation: number;
      constructor(options?: { saturation?: number });
    }

    class Grayscale {
      type: 'Grayscale';
      mode: 'average' | 'lightness' | 'luminosity';
      constructor(options?: { mode?: 'average' | 'lightness' | 'luminosity' });
    }
  }
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Helper type to get a Fabric object with our custom properties.
 * Use this when you need to access custom props without casting.
 */
type DesignSpaceObject = fabric.FabricObject & CustomObjectProps;

/**
 * Helper type for images with adjustments.
 */
type DesignSpaceImage = fabric.FabricImage & ExtendedImageProps;

/**
 * Helper type for textboxes with fixed-frame properties.
 */
type DesignSpaceTextbox = fabric.Textbox & FixedTextboxProps;

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if an object is a guide.
 */
declare function isGuideObject(obj: fabric.FabricObject): obj is fabric.FabricObject & { isGuide: true };

/**
 * Type guard to check if an object is an image with adjustments.
 */
declare function isImageWithAdjustments(obj: fabric.FabricObject): obj is DesignSpaceImage;

/**
 * Type guard to check if an object is a text object.
 */
declare function isTextObject(obj: fabric.FabricObject): obj is fabric.IText | fabric.Textbox;

export {
  ImageAdjustments,
  ImageFilter,
  CustomObjectProps,
  ExtendedImageProps,
  FixedTextboxProps,
  DesignSpaceObject,
  DesignSpaceImage,
  DesignSpaceTextbox,
  GuideType,
  isGuideObject,
  isImageWithAdjustments,
  isTextObject,
};
