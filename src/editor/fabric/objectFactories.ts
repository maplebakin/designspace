
import * as fabric from 'fabric';
import { useEditorStore } from '../state/editorStore';
import { useThemeStore } from '../state/useThemeStore';
import { v4 as uuidv4 } from 'uuid';
import { SAFE_MARGIN_PX, toCanvasUnits } from '../utils/units';

const DEFAULT_STROKE_COLOR = '#000000';
const DEFAULT_STROKE_WIDTH = 2;
const DEFAULT_PLACEHOLDER_TOKEN_ROLE = 'surfaces.surface-plain';
const DEFAULT_SHAPE_FILL = '#1f2933';
const DEFAULT_RECTANGLE_SIZE_WIDTH = 2;
const DEFAULT_RECTANGLE_SIZE_HEIGHT = 3;
const DEFAULT_TEXTBOX_WIDTH = 3;
const DEFAULT_TEXTBOX_HEIGHT = 1.5;
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

interface InsertOptions {
    center?: boolean;
    activate?: boolean;
    enterEditing?: boolean;
}

const insertFabricObject = (
  canvas: fabric.Canvas,
  createObject: () => fabric.Object,
  options: InsertOptions = {}
) => {
  const obj = createObject();
  if (options.center !== false) {
    const center = getCanvasCenterPoint(canvas);
    obj.set({ left: center.x, top: center.y });
    obj.setCoords();
  }
  canvas.add(obj);
  const shouldActivate = options.activate ?? true;
  if (shouldActivate) {
    canvas.setActiveObject(obj);
  }
  if (options.enterEditing && typeof (obj as any).enterEditing === 'function') {
    (obj as any).enterEditing();
  }

  canvas.requestRenderAll();
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


interface ITextOptions {
    text: string;
    fontSize: number;
    fontWeight?: string;
    role?: 'heading' | 'subheading' | 'body';
}

const getThemeFontFamily = (role?: ITextOptions['role']) => {
    const { themeData } = useThemeStore.getState();
    if (role === 'heading' || role === 'subheading') {
        return themeData?.typography.heading.fontFamily || 'serif';
    }
    return themeData?.typography.body.fontFamily || 'sans-serif';
};

const getThemeTextColor = (role?: ITextOptions['role']) => {
    const { themeData } = useThemeStore.getState();
    if (role === 'heading' || role === 'subheading') {
        return themeData?.typography.heading.value || '#000000';
    }
    return themeData?.typography.body.value || '#000000';
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
 * Helper to adjust font size of a textbox to fit its bounds.
 * @param textbox The fabric.Textbox instance.
 * @param canvas The fabric.Canvas instance.
 */
const adjustFontSizeToFit = (textbox: fabric.Textbox, canvas: fabric.Canvas) => {
    if (!textbox.originalFontSize) {
        textbox.originalFontSize = textbox.fontSize; // Store initial font size
    }

    const minFontSize = 8;
    const maxFontSize = textbox.originalFontSize;
    let currentFontSize = textbox.fontSize;

    // Check if text overflows
    if (textbox.getScaledHeight() > textbox.height) {
        // Decrease font size until it fits or reaches min
        while (textbox.getScaledHeight() > textbox.height && currentFontSize > minFontSize) {
            currentFontSize -= 1;
            textbox.set('fontSize', currentFontSize);
            textbox.initDimensions(); // Recalculate dimensions
        }
    } else if (textbox.getScaledHeight() < textbox.height) {
        // Increase font size until it overflows or reaches max
        while (textbox.getScaledHeight() < textbox.height && currentFontSize < maxFontSize) {
            currentFontSize += 1;
            textbox.set('fontSize', currentFontSize);
            textbox.initDimensions();
            // If it overshot, revert to previous size
            if (textbox.getScaledHeight() > textbox.height) {
                currentFontSize -= 1;
                textbox.set('fontSize', currentFontSize);
                textbox.initDimensions();
                break;
            }
        }
    }
    
    textbox.setCoords(); // Update controls
    canvas.requestRenderAll();
};

/**
 * Adds a fixed-frame textbox with auto-adjusting font size to the canvas.
 * @param canvas The fabric.Canvas instance.
 */
export const addFixedTextbox = (canvas: fabric.Canvas) => {
    const defaultFontSize = 30;

    insertFabricObject(canvas, () => {
        const textbox = new fabric.Textbox('Type here...', {
            width: getDefaultLength(DEFAULT_TEXTBOX_WIDTH, DEFAULT_PX_TEXTBOX_WIDTH),
            height: getDefaultLength(DEFAULT_TEXTBOX_HEIGHT, DEFAULT_PX_TEXTBOX_HEIGHT),
            fontSize: defaultFontSize,
            originalFontSize: defaultFontSize, // Custom property to store original size
            fill: getThemeTextColor('body'),
            textAlign: 'center',
            originX: 'center',
            originY: 'center',
            fontFamily: getThemeFontFamily('body'),
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true,
            hasControls: false,
            hasBorders: true,
        });
        (textbox as any).id = uuidv4();
        (textbox as any).tokenRole = 'typography.body.value';

        // Attach listener for text changes
        textbox.on('changed', () => {
            adjustFontSizeToFit(textbox, canvas);
        });

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
    const safeWidth = canvas.getWidth() - safeInset * 2;
    const safeHeight = canvas.getHeight() - safeInset * 2;
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
    const safeWidth = canvas.getWidth() - safeInset * 2;
    const safeHeight = canvas.getHeight() - safeInset * 2;
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
 * Loads an SVG from a URL and adds it to the canvas, linking it to the theme.
 * @param canvas The fabric.Canvas instance.
 * @param url The URL of the SVG file.
 */
export const addSvgFromUrl = async (canvas: fabric.Canvas, url: string) => {
    const { themeData } = useThemeStore.getState();
    const accentColor = themeData?.brand?.accent?.value || '#A133FF';

    fabric.loadSVGFromURL(url, (objects, options) => {
        const objArray = Array.isArray(objects) ? objects : [objects];
        objArray.forEach((obj: fabric.Object) => {
            (obj as any).id = uuidv4();
            (obj as any).tokenRole = 'brand.accent.value';
            obj.set({
                colorLocked: false,
                fill: accentColor,
            });
        });

        const group = new fabric.Group([...objArray], {
            ...options,
        });
        (group as any).id = uuidv4();

        group.scaleToWidth(getDefaultLength(2, DEFAULT_PX_SVG_WIDTH));
        insertFabricObject(canvas, () => group, { activate: true });
    });
};
