/**
 * Type declarations for our custom Fabric.js extensions.
 * This file augments the Fabric.js types with our custom properties.
 */

import * as fabric from 'fabric';

// Filter types for Fabric.js v6
interface BaseFilter {
  type: string;
  [key: string]: any;
}

interface BrightnessFilter extends BaseFilter {
  type: 'Brightness';
  brightness: number;
}

interface ContrastFilter extends BaseFilter {
  type: 'Contrast';
  contrast: number;
}

interface SaturationFilter extends BaseFilter {
  type: 'Saturation';
  saturation: number;
}

interface GrayscaleFilter extends BaseFilter {
  type: 'Grayscale';
  mode?: 'average' | 'lightness' | 'luminosity';
}

type ImageFilter = BrightnessFilter | ContrastFilter | SaturationFilter | GrayscaleFilter | BaseFilter;

// Image adjustments stored on the object
interface ImageAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
}

// Custom properties we add to all objects
interface CustomObjectProps {
  id?: string;
  tokenRole?: string | null;
  colorLocked?: boolean;
  isPlaceholder?: boolean;
  isGuide?: boolean;
  isFrame?: boolean;
  frameType?: 'circle' | 'star' | 'hexagon' | 'badge';
  __baseRx?: number;
  __baseRy?: number;
}

// Extended Image type with our custom properties
interface ExtendedImageProps extends CustomObjectProps {
  adjustments?: ImageAdjustments;
  filters?: ImageFilter[];
}

// Augment fabric module
declare module 'fabric' {
  interface FabricObject extends CustomObjectProps {}

  interface FabricImage extends ExtendedImageProps {
    applyFilters(): void;
  }

  interface IText extends CustomObjectProps {
    charSpacing?: number;
  }

  interface Textbox extends CustomObjectProps {
    charSpacing?: number;
  }

  interface Rect extends CustomObjectProps {
    rx?: number;
    ry?: number;
  }

  interface Circle extends CustomObjectProps {}

  interface Triangle extends CustomObjectProps {}

  interface Polygon extends CustomObjectProps {}

  interface Group extends CustomObjectProps {}

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

export { ImageAdjustments, ImageFilter, CustomObjectProps, ExtendedImageProps };
