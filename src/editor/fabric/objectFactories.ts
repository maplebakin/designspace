/**
 * Object Factories
 *
 * Factory functions for creating themed Fabric.js objects.
 * All objects created through these factories are:
 * - Centered in the viewport by default
 * - Assigned unique IDs
 * - Linked to theme tokens for dynamic color updates
 * - Sized appropriately for the current unit mode (inches or pixels)
 *
 * @module objectFactories
 */

import * as fabric from 'fabric';
import { finalizeInsertionSelection, useEditorStore } from '../state/editorStore';
import { useCanvasStore } from '../state/useCanvasStore';
import { useThemeStore } from '../state/useThemeStore';
import { v4 as uuidv4 } from 'uuid';
import { SAFE_MARGIN_PX, toCanvasUnits } from '../utils/units';
import { toSerializableObject } from '../utils/serialization';
import { frameScheduler, TaskPriority } from '../utils/frameScheduler';
import { ZIndexLayer, withManifestZIndex } from './zIndexManifest';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default stroke color for shapes (neutral gray from palette) */
const DEFAULT_STROKE_COLOR = '#686664';
/** Default stroke width in pixels */
const DEFAULT_STROKE_WIDTH = 2;
/** Default theme token for placeholder fills */
const DEFAULT_PLACEHOLDER_TOKEN_ROLE = 'surfaces.surface-plain';
/** Default fill color when no theme is active */
const DEFAULT_SHAPE_FILL = '#f1f0ee';

// Unit-based default sizes (in inches at 300 DPI)
const DEFAULT_RECTANGLE_SIZE_WIDTH = 2;
const DEFAULT_RECTANGLE_SIZE_HEIGHT = 3;
const DEFAULT_TEXTBOX_WIDTH = 3;
const DEFAULT_TEXTBOX_HEIGHT = 1.5;

// Pixel-based default sizes (for px unit mode)
const DEFAULT_PX_RECTANGLE_WIDTH = 200;
const DEFAULT_PX_RECTANGLE_HEIGHT = 150;
const DEFAULT_PX_CIRCLE_RADIUS = 80;
const DEFAULT_PX_TRIANGLE_WIDTH = 180;
const DEFAULT_PX_TRIANGLE_HEIGHT = 140;
const DEFAULT_PX_STAR_OUTER_RADIUS = 70;
const DEFAULT_PX_STAR_INNER_RADIUS = 32;
const DEFAULT_PX_ITEXT_WIDTH = 320;
const DEFAULT_PX_ITEXT_HEIGHT = 60;
const DEFAULT_PX_TEXTBOX_WIDTH = 320;
const DEFAULT_PX_TEXTBOX_HEIGHT = 120;
const DEFAULT_PX_PLACEHOLDER_WIDTH = 240;
const DEFAULT_PX_PLACEHOLDER_HEIGHT = 180;
const DEFAULT_PX_SVG_WIDTH = 220;

const convertLength = (value: number) =>
  toCanvasUnits(value, useEditorStore.getState().unitMode) as number;
const getDefaultLength = (unitValue: number, pxValue: number) => {
  const unitMode = useEditorStore.getState().unitMode;
  const baseValue = unitMode === 'px' ? pxValue : unitValue;
  return toCanvasUnits(baseValue, unitMode) as number;
};
const getCanvasCenterPoint = (canvas: fabric.Canvas) => {
  const vpt = canvas.viewportTransform;
  if (!vpt) {
    return { x: canvas.getWidth() / 2, y: canvas.getHeight() / 2 };
  }
  const screenCenter = new fabric.Point(canvas.getWidth() / 2, canvas.getHeight() / 2);
  const inverted = fabric.util.invertTransform(vpt);
  const worldCenter = fabric.util.transformPoint(screenCenter, inverted);
  return { x: worldCenter.x, y: worldCenter.y };
};

/**
 * Options for inserting objects onto the canvas.
 */
interface InsertOptions {
  /** Center the object in the viewport (default: true) */
  center?: boolean;
  /** Select the object after insertion (default: true) */
  activate?: boolean;
  /** Enter editing mode for text objects (default: false) */
  enterEditing?: boolean;
}

/**
 * Inserts a Fabric.js object onto the canvas with common setup.
 *
 * @param canvas - The Fabric.js canvas instance
 * @param createObject - Factory function that creates the object
 * @param options - Insertion options (center, activate, enterEditing)
 * @returns The created and inserted object
 *
 * @example
 * ```ts
 * const rect = insertFabricObject(canvas, () => new fabric.Rect({...}));
 * ```
 */
const insertFabricObject = (
  canvas: fabric.Canvas,
  createObject: () => fabric.Object,
  options: InsertOptions = {}
): fabric.Object => {
  const obj = createObject();
  if (options.center !== false) {
    const center = getCanvasCenterPoint(canvas);
    obj.set({ left: center.x, top: center.y });
    obj.setCoords();
  }
  const shouldActivate = options.activate ?? true;
  const serialized = withManifestZIndex(
    toSerializableObject(obj),
    ZIndexLayer.Content
  );
  useEditorStore.getState().addObject(serialized, {
    save: true,
    select: shouldActivate,
  });
  if (shouldActivate && typeof (serialized as any).id === 'string') {
    finalizeInsertionSelection((serialized as any).id);
  }

  if (options.enterEditing && typeof (obj as any).enterEditing === 'function') {
    const objectId = (serialized as any).id;
    frameScheduler.scheduleTask(() => {
      const activeCanvas = useEditorStore.getState().canvas;
      const syncedObject = activeCanvas?.getObjects().find((candidate) => (candidate as any).id === objectId) as any;
      if (syncedObject && typeof syncedObject.enterEditing === 'function') {
        syncedObject.enterEditing();
        activeCanvas?.requestRenderAll();
      }
    }, TaskPriority.High);
  }

  return obj;
};

const getValueByPath = (obj: object, path: string): any => {
    return path.split('.').reduce((acc, part) => acc && (acc as any)[part], obj);
};

const resolveTokenValue = (themeData: object | null, tokenRole: string) => {
    if (!themeData) return null;
    let value = getValueByPath(themeData, tokenRole);
    if (!value && !tokenRole.endsWith('.value')) {
        value = getValueByPath(themeData, `${tokenRole}.value`);
    }
    if (value && typeof value === 'object' && 'value' in value) {
        return (value as { value: string }).value;
    }
    return typeof value === 'string' ? value : null;
};

/**
 * Adds a styled rectangle with rounded corners to the center of the canvas.
 * @param canvas - The fabric.Canvas instance.
 */
export const addRectangle = (canvas: fabric.Canvas) =>
  insertFabricObject(canvas, () => {
    const width = getDefaultLength(DEFAULT_RECTANGLE_SIZE_WIDTH, DEFAULT_PX_RECTANGLE_WIDTH);
    const height = getDefaultLength(DEFAULT_RECTANGLE_SIZE_HEIGHT, DEFAULT_PX_RECTANGLE_HEIGHT);
    const rect = new fabric.Rect({
      width,
      height,
      fill: useThemeStore.getState().themeData?.brand?.primary?.value || DEFAULT_SHAPE_FILL,
      stroke: DEFAULT_STROKE_COLOR,
      strokeWidth: DEFAULT_STROKE_WIDTH,
      strokeUniform: true,
      rx: 10,
      ry: 10,
      originX: 'center',
      originY: 'center',
    });
    (rect as any).id = uuidv4();
    (rect as any).tokenRole = 'brand.primary.value';
    return rect;
  });

/**
 * Adds a styled circle to the center of the canvas.
 * @param canvas - The fabric.Canvas instance.
 */
const DEFAULT_CIRCLE_RADIUS = 1.5;

export const addCircle = (canvas: fabric.Canvas) =>
  insertFabricObject(canvas, () => {
    const radius = getDefaultLength(DEFAULT_CIRCLE_RADIUS, DEFAULT_PX_CIRCLE_RADIUS);
    const circle = new fabric.Circle({
      radius,
      fill: useThemeStore.getState().themeData?.brand?.primary?.value || DEFAULT_SHAPE_FILL,
      stroke: DEFAULT_STROKE_COLOR,
      strokeWidth: DEFAULT_STROKE_WIDTH,
      strokeUniform: true,
      originX: 'center',
      originY: 'center',
    });
    (circle as any).id = uuidv4();
    (circle as any).tokenRole = 'brand.primary.value';
    return circle;
  });

/**
 * Adds a styled triangle to the center of the canvas.
 * @param canvas The fabric.Canvas instance.
 */
export const addTriangle = (canvas: fabric.Canvas) =>
    insertFabricObject(canvas, () => {
        const triangle = new fabric.Triangle({
            width: getDefaultLength(2.5, DEFAULT_PX_TRIANGLE_WIDTH),
            height: getDefaultLength(2, DEFAULT_PX_TRIANGLE_HEIGHT),
            fill: useThemeStore.getState().themeData?.brand?.primary?.value || DEFAULT_SHAPE_FILL,
            stroke: DEFAULT_STROKE_COLOR,
            strokeWidth: DEFAULT_STROKE_WIDTH,
            strokeUniform: true,
            originX: 'center',
            originY: 'center',
        });
        (triangle as any).id = uuidv4();
        (triangle as any).tokenRole = 'brand.primary.value';
        return triangle;
    });

export const addStar = (canvas: fabric.Canvas) =>
    insertFabricObject(canvas, () => {
        const outerRadius = getDefaultLength(1.7, DEFAULT_PX_STAR_OUTER_RADIUS);
        const innerRadius = getDefaultLength(0.8, DEFAULT_PX_STAR_INNER_RADIUS);
        const starPoints = (outer: number, inner: number) => {
            const points = [];
            for (let i = 0; i < 10; i++) {
                const radius = i % 2 === 0 ? outer : inner;
                const angle = (i * 36 * Math.PI) / 180;
                points.push({
                    x: radius * Math.sin(angle),
                    y: -radius * Math.cos(angle),
                });
            }
            return points;
        };

        const star = new fabric.Polygon(starPoints(outerRadius, innerRadius), {
            fill: useThemeStore.getState().themeData?.brand?.primary?.value || DEFAULT_SHAPE_FILL,
            stroke: DEFAULT_STROKE_COLOR,
            strokeWidth: DEFAULT_STROKE_WIDTH,
            strokeUniform: true,
            originX: 'center',
            originY: 'center',
        });
        (star as any).id = uuidv4();
        (star as any).tokenRole = 'brand.primary.value';
        return star;
    });


/**
 * Options for creating IText objects.
 */
interface ITextOptions {
  /** The initial text content */
  text: string;
  /** Font size in pixels */
  fontSize: number;
  /** Font weight (e.g., 'normal', 'bold', '700') */
  fontWeight?: string;
  /** Typography role for theme font selection */
  role?: 'heading' | 'subheading' | 'body';
}

const getThemeFontFamily = (role?: ITextOptions['role']) => {
    const { themeData } = useThemeStore.getState();
    if (role === 'heading' || role === 'subheading') {
        return themeData?.typography?.heading?.fontFamily || 'serif';
    }
    return themeData?.typography?.body?.fontFamily || 'sans-serif';
};

const getThemeTextColor = (role?: ITextOptions['role']) => {
    const { themeData } = useThemeStore.getState();
    if (role === 'heading' || role === 'subheading') {
        return themeData?.typography?.heading?.value || '#000000';
    }
    return themeData?.typography?.body?.value || '#000000';
}

/**
 * Adds a styled, editable text box to the center of the canvas.
 * @param canvas - The fabric.Canvas instance.
 */
export const addIText = (canvas: fabric.Canvas, options: ITextOptions) => {
  const role = options.role || 'body';
  const tokenRole = role === 'heading' || role === 'subheading' ? 'typography.heading.value' : 'typography.body.value';

  return insertFabricObject(canvas, () => {
    const text = new fabric.IText(options.text, {
      fontSize: options.fontSize,
      fontWeight: options.fontWeight || 'normal',
      width: getDefaultLength(3.5, DEFAULT_PX_ITEXT_WIDTH),
      height: getDefaultLength(1, DEFAULT_PX_ITEXT_HEIGHT),
      fill: getThemeTextColor(role),
      originX: 'center',
      originY: 'center',
      fontFamily: getThemeFontFamily(role),
    });
    (text as any).id = uuidv4();
    (text as any).tokenRole = tokenRole;
    return text;
  }, { activate: true, enterEditing: true });
};


/**
 * Helper to adjust font size of a textbox to fit a fixed size.
 * @param textbox The fabric.Textbox instance.
 * @param canvas The fabric.Canvas instance.
 * @param targetSize Optional target width/height for the textbox.
 */
const adjustFontSizeToFit = (
    textbox: fabric.Textbox,
    canvas: fabric.Canvas,
    targetSize: { width?: number; height?: number } = {}
) => {
    const currentWidth = textbox.width ?? textbox.getScaledWidth();
    const currentHeight = textbox.height ?? textbox.getScaledHeight();
    const storedWidth = (textbox as any).__fixedWidth as number | undefined;
    const storedHeight = (textbox as any).__fixedHeight as number | undefined;
    const targetWidth = Math.max(1, targetSize.width ?? storedWidth ?? currentWidth);
    const targetHeight = Math.max(1, targetSize.height ?? storedHeight ?? currentHeight);

    if (!(textbox as any).originalFontSize) {
        (textbox as any).originalFontSize = textbox.fontSize;
    }

    const minFontSize = 4;
    const maxFontSize = Math.max(
        minFontSize,
        Math.ceil(Math.max(targetHeight, (textbox as any).originalFontSize ?? 0))
    );

    textbox.set({ width: targetWidth });

    let bestFontSize = minFontSize;
    let low = minFontSize;
    let high = maxFontSize;

    const fits = (fontSize: number) => {
        textbox.set('fontSize', fontSize);
        textbox.initDimensions();
        const textHeight = textbox.height ?? 0;
        const textWidth = typeof textbox.calcTextWidth === 'function'
            ? textbox.calcTextWidth()
            : textbox.getScaledWidth();
        return textHeight <= targetHeight && textWidth <= targetWidth;
    };

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (fits(mid)) {
            bestFontSize = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    textbox.set('fontSize', bestFontSize);
    textbox.initDimensions();
    textbox.set({ height: targetHeight });
    (textbox as any).__fixedWidth = targetWidth;
    (textbox as any).__fixedHeight = targetHeight;
    textbox.setCoords();
    canvas.requestRenderAll();
};

/**
 * Adds a fixed-frame textbox with auto-adjusting font size to the canvas.
 * @param canvas The fabric.Canvas instance.
 */
export const addFixedTextbox = (canvas: fabric.Canvas) => {
    const defaultFontSize = 30;
    const boxWidth = getDefaultLength(DEFAULT_TEXTBOX_WIDTH, DEFAULT_PX_TEXTBOX_WIDTH);
    const boxHeight = getDefaultLength(DEFAULT_TEXTBOX_HEIGHT, DEFAULT_PX_TEXTBOX_HEIGHT);

    insertFabricObject(canvas, () => {
        const textbox = new fabric.Textbox('Type here...', {
            width: boxWidth,
            height: boxHeight,
            fontSize: defaultFontSize,
            fill: getThemeTextColor('body'),
            textAlign: 'center',
            originX: 'center',
            originY: 'center',
            fontFamily: getThemeFontFamily('body'),
            lockRotation: true,
            hasControls: true,
            hasBorders: true,
        });
        (textbox as any).id = uuidv4();
        (textbox as any).tokenRole = 'typography.body.value';
        (textbox as any).__fixedWidth = boxWidth;
        (textbox as any).__fixedHeight = boxHeight;
        (textbox as any).originalFontSize = defaultFontSize;

        const handleScaling = () => {
            const scaleX = Math.abs(textbox.scaleX ?? 1);
            const scaleY = Math.abs(textbox.scaleY ?? 1);
            if (scaleX === 1 && scaleY === 1) {
                return;
            }
            const targetWidth = Math.max(1, (textbox.width ?? 0) * scaleX);
            const targetHeight = Math.max(1, (textbox.height ?? 0) * scaleY);
            textbox.set({ width: targetWidth, scaleX: 1, scaleY: 1 });
            adjustFontSizeToFit(textbox, canvas, { width: targetWidth, height: targetHeight });
        };

        textbox.on('scaling', handleScaling);

        // Attach listener for text changes
        textbox.on('changed', () => {
            adjustFontSizeToFit(textbox, canvas);
        });

        adjustFontSizeToFit(textbox, canvas, { width: boxWidth, height: boxHeight });

        return textbox;
    }, { activate: true, enterEditing: true });
};

interface PlaceholderOptions {
    width?: number;
    height?: number;
    tokenRole?: string;
    lockMovement?: boolean;
}

const createPlaceholderRect = (options: PlaceholderOptions = {}) => {
    const { themeData } = useThemeStore.getState();
    const width = options.width == null
        ? getDefaultLength(2, DEFAULT_PX_PLACEHOLDER_WIDTH)
        : convertLength(options.width);
    const height = options.height == null
        ? getDefaultLength(2, DEFAULT_PX_PLACEHOLDER_HEIGHT)
        : convertLength(options.height);
    const tokenRole = options.tokenRole ?? DEFAULT_PLACEHOLDER_TOKEN_ROLE;
    const themedFill = resolveTokenValue(themeData, tokenRole);
    const lockMovement = options.lockMovement ?? false;

    const placeholder = new fabric.Rect({
        width,
        height,
        fill: themedFill || 'rgba(148, 163, 184, 0.35)',
        stroke: 'rgba(148, 163, 184, 0.6)',
        strokeWidth: 1,
        strokeUniform: true,
        rx: 12,
        ry: 12,
        originX: 'center',
        originY: 'center',
        lockMovementX: lockMovement,
        lockMovementY: lockMovement,
        hasControls: !lockMovement,
    });
    (placeholder as any).id = uuidv4();
    (placeholder as any).tokenRole = tokenRole;
    (placeholder as any).isPlaceholder = true;
    (placeholder as any).colorLocked = false;

    return placeholder;
};

export const addPlaceholder = (canvas: fabric.Canvas, options: PlaceholderOptions = {}) => {
    return insertFabricObject(canvas, () => createPlaceholderRect(options));
};

interface GridOptions {
    gutter?: number;
    tokenRole?: string;
}

export const generateGrid = (canvas: fabric.Canvas, rows: number, cols: number, options: GridOptions = {}) => {
    if (rows <= 0 || cols <= 0) return;
    const { bleedPx } = useEditorStore.getState();
    const gutterUnits = options.gutter ?? 0.2;
    const gutter = convertLength(gutterUnits);
    const tokenRole = options.tokenRole ?? DEFAULT_PLACEHOLDER_TOKEN_ROLE;

    const safeInset = bleedPx + SAFE_MARGIN_PX;
    const { width: documentWidth, height: documentHeight } = useCanvasStore.getState();
    const safeWidth = documentWidth - safeInset * 2;
    const safeHeight = documentHeight - safeInset * 2;
    if (safeWidth <= 0 || safeHeight <= 0) return;

    const cellWidth = (safeWidth - gutter * (cols - 1)) / cols;
    const cellHeight = (safeHeight - gutter * (rows - 1)) / rows;
    if (cellWidth <= 0 || cellHeight <= 0) return;

    const placeholders: fabric.Object[] = [];
    for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
            const placeholder = createPlaceholderRect({
                width: cellWidth,
                height: cellHeight,
                tokenRole,
                lockMovement: true,
            });
            placeholder.set({
                left: safeInset + col * (cellWidth + gutter) + cellWidth / 2,
                top: safeInset + row * (cellHeight + gutter) + cellHeight / 2,
            });
            placeholders.push(placeholder);
        }
    }

    const group = new fabric.Group(placeholders, {
        subTargetCheck: true,
    });
    (group as any).id = uuidv4();
    insertFabricObject(canvas, () => group, { center: false, activate: true });
};

export const addTriptychLayout = (canvas: fabric.Canvas) => {
    generateGrid(canvas, 1, 3);
};

export const addWeeklyTrackerLayout = (canvas: fabric.Canvas) => {
    generateGrid(canvas, 1, 7);
};

export const addHerbProfileLayout = (canvas: fabric.Canvas) => {
    const { bleedPx } = useEditorStore.getState();
    const gutter = convertLength(0.2);
    const safeInset = bleedPx + SAFE_MARGIN_PX;
    const { width: documentWidth, height: documentHeight } = useCanvasStore.getState();
    const safeWidth = documentWidth - safeInset * 2;
    const safeHeight = documentHeight - safeInset * 2;
    if (safeWidth <= 0 || safeHeight <= 0) return;

    const columnWidth = safeWidth - gutter;
    const imageWidth = columnWidth * 0.6;
    const textWidth = columnWidth * 0.4;
    const textHeight = (safeHeight - gutter * 2) / 3;
    const tokenRole = DEFAULT_PLACEHOLDER_TOKEN_ROLE;

    const placeholders: fabric.Object[] = [];
    const imagePlaceholder = createPlaceholderRect({
        width: imageWidth,
        height: safeHeight,
        tokenRole,
        lockMovement: true,
    });
    imagePlaceholder.set({
        left: safeInset + imageWidth / 2,
        top: safeInset + safeHeight / 2,
    });
    placeholders.push(imagePlaceholder);

    for (let i = 0; i < 3; i += 1) {
        const textPlaceholder = createPlaceholderRect({
            width: textWidth,
            height: textHeight,
            tokenRole,
            lockMovement: true,
        });
        textPlaceholder.set({
            left: safeInset + imageWidth + gutter + textWidth / 2,
            top: safeInset + i * (textHeight + gutter) + textHeight / 2,
        });
        placeholders.push(textPlaceholder);
    }

    const group = new fabric.Group(placeholders, {
        subTargetCheck: true,
    });
    (group as any).id = uuidv4();
    insertFabricObject(canvas, () => group, { center: false, activate: true });
};

/**
 * Parses already-sanitized SVG markup and adds it to the canvas.
 */
export const addSvgFromString = async (canvas: fabric.Canvas, svgMarkup: string) => {
    const { themeData } = useThemeStore.getState();
    const accentColor = themeData?.brand?.accent?.value || '#A133FF';
    const { objects, options } = await fabric.loadSVGFromString(svgMarkup);
    const objectArray = objects.filter((object): object is fabric.Object => !!object);
    if (objectArray.length === 0) {
        throw new Error('The SVG did not contain any supported artwork.');
    }
    objectArray.forEach((object) => {
        (object as any).id = uuidv4();
        (object as any).tokenRole = 'brand.accent.value';
        object.set({
            colorLocked: false,
            fill: accentColor,
        });
    });

    const group = new fabric.Group(objectArray, { ...options });
    (group as any).id = uuidv4();
    group.scaleToWidth(getDefaultLength(2, DEFAULT_PX_SVG_WIDTH));
    return insertFabricObject(canvas, () => group, { activate: true });
};
