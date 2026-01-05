import type { FabricObject } from 'fabric';

declare module 'fabric' {
  interface FabricObject {
    originalFontSize?: number;
    selectionId?: string;
    isFrame?: boolean;
    patternSourceUrl?: string | null;
    patternZoom?: number;
    patternOffsetX?: number;
    patternOffsetY?: number;
    isGuide?: boolean;
    isBleedZone?: boolean;
    isTrimLine?: boolean;
  }

  interface StaticCanvas {
    bringObjectToFront(object: FabricObject): boolean;
    bringObjectForward(object: FabricObject, intersecting?: boolean): boolean;
    sendObjectBackwards(object: FabricObject, intersecting?: boolean): boolean;
    sendObjectToBack(object: FabricObject): boolean;
    moveObjectTo(object: FabricObject, index: number): boolean;
  }

  interface Canvas {
    bringObjectToFront(object: FabricObject): boolean;
    bringObjectForward(object: FabricObject, intersecting?: boolean): boolean;
    sendObjectBackwards(object: FabricObject, intersecting?: boolean): boolean;
    sendObjectToBack(object: FabricObject): boolean;
    moveObjectTo(object: FabricObject, index: number): boolean;
  }

  interface FabricImage {
    // placeholder for future augmentations
  }
}
