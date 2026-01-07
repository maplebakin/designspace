
import * as fabric from 'fabric';
import { useEditorStore } from '../state/editorStore';
import { v4 as uuidv4 } from 'uuid';
import { SAFE_MARGIN_PX } from '../utils/units';

const DEFAULT_STROKE_COLOR = '#000000';
const DEFAULT_STROKE_WIDTH = 2;
const DEFAULT_PLACEHOLDER_TOKEN_ROLE = 'surfaces.surface-plain';
const DEFAULT_SHAPE_FILL = '#1f2933';

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
export const addRectangle = (canvas: fabric.Canvas) => {
  const rect = new fabric.Rect({
    width: 150,
    height: 100,
    fill: useEditorStore.getState().themeData?.brand?.primary?.value || DEFAULT_SHAPE_FILL,
    stroke: DEFAULT_STROKE_COLOR,
    strokeWidth: DEFAULT_STROKE_WIDTH,
    strokeUniform: true,
    rx: 10, // Corner radius
    ry: 10, // Corner radius
    originX: 'center',
    originY: 'center',
  });
  (rect as any).id = uuidv4();
  (rect as any).tokenRole = 'brand.primary.value';
  canvas.add(rect);
  canvas.centerObject(rect);
  canvas.requestRenderAll();
};

/**
 * Adds a styled circle to the center of the canvas.
 * @param canvas - The fabric.Canvas instance.
 */
export const addCircle = (canvas: fabric.Canvas) => {
  const circle = new fabric.Circle({
    radius: 75,
    fill: useEditorStore.getState().themeData?.brand?.primary?.value || DEFAULT_SHAPE_FILL,
    stroke: DEFAULT_STROKE_COLOR,
    strokeWidth: DEFAULT_STROKE_WIDTH,
    strokeUniform: true,
    originX: 'center',
    originY: 'center',
  });
  (circle as any).id = uuidv4();
  (circle as any).tokenRole = 'brand.primary.value';
  canvas.add(circle);
  canvas.centerObject(circle);
  canvas.requestRenderAll();
};

/**
 * Adds a styled triangle to the center of the canvas.
 * @param canvas The fabric.Canvas instance.
 */
export const addTriangle = (canvas: fabric.Canvas) => {
    const triangle = new fabric.Triangle({
        width: 150,
        height: 130,
        fill: useEditorStore.getState().themeData?.brand?.primary?.value || DEFAULT_SHAPE_FILL,
        stroke: DEFAULT_STROKE_COLOR,
        strokeWidth: DEFAULT_STROKE_WIDTH,
        strokeUniform: true,
        originX: 'center',
        originY: 'center',
    });
    (triangle as any).id = uuidv4();
    (triangle as any).tokenRole = 'brand.primary.value';
    canvas.add(triangle);
    canvas.centerObject(triangle);
    canvas.requestRenderAll();
}

/**
 * Adds a 5-pointed star to the center of the canvas.
 * @param canvas The fabric.Canvas instance.
 */
export const addStar = (canvas: fabric.Canvas) => {
    const starPoints = (outerRadius: number, innerRadius: number) => {
        const points = [];
        for (let i = 0; i < 10; i++) {
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const angle = (i * 36 * Math.PI) / 180;
            points.push({
                x: radius * Math.sin(angle),
                y: -radius * Math.cos(angle),
            });
        }
        return points;
    };

    const star = new fabric.Polygon(starPoints(80, 40), {
        fill: useEditorStore.getState().themeData?.brand?.primary?.value || DEFAULT_SHAPE_FILL,
        stroke: DEFAULT_STROKE_COLOR,
        strokeWidth: DEFAULT_STROKE_WIDTH,
        strokeUniform: true,
        originX: 'center',
        originY: 'center',
    });
    (star as any).id = uuidv4();
    (star as any).tokenRole = 'brand.primary.value';
    canvas.add(star);
    canvas.centerObject(star);
    canvas.requestRenderAll();
};


interface ITextOptions {
    text: string;
    fontSize: number;
    fontWeight?: string;
    role?: 'heading' | 'subheading' | 'body';
}

const getThemeFontFamily = (role?: ITextOptions['role']) => {
    const { themeData } = useEditorStore.getState();
    if (role === 'heading' || role === 'subheading') {
        return themeData?.typography.heading.fontFamily || 'serif';
    }
    return themeData?.typography.body.fontFamily || 'sans-serif';
};

const getThemeTextColor = (role?: ITextOptions['role']) => {
    const { themeData } = useEditorStore.getState();
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
  
  const text = new fabric.IText(options.text, {
    fontSize: options.fontSize,
    fontWeight: options.fontWeight || 'normal',
    fill: getThemeTextColor(role),
    originX: 'center',
    originY: 'center',
    fontFamily: getThemeFontFamily(role),
  });
  (text as any).id = uuidv4();
  (text as any).tokenRole = tokenRole;
  canvas.add(text);
  canvas.centerObject(text);
  canvas.setActiveObject(text);
  text.enterEditing();
  canvas.requestRenderAll();
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
    useEditorStore.getState().saveState(); // Save state after adjustment
};

/**
 * Adds a fixed-frame textbox with auto-adjusting font size to the canvas.
 * @param canvas The fabric.Canvas instance.
 */
export const addFixedTextbox = (canvas: fabric.Canvas) => {
    const defaultWidth = 300;
    const defaultHeight = 150;
    const defaultFontSize = 30;

    const textbox = new fabric.Textbox('Type here...', {
        width: defaultWidth,
        height: defaultHeight,
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

    canvas.add(textbox);
    canvas.centerObject(textbox);
    canvas.setActiveObject(textbox);
    textbox.enterEditing();
    canvas.requestRenderAll();

    // Attach listener for text changes
    textbox.on('changed', () => {
        adjustFontSizeToFit(textbox, canvas);
    });
};

interface PlaceholderOptions {
    width?: number;
    height?: number;
    tokenRole?: string;
    lockMovement?: boolean;
}

const createPlaceholderRect = (options: PlaceholderOptions = {}) => {
    const { themeData } = useEditorStore.getState();
    const width = options.width ?? 200;
    const height = options.height ?? 200;
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
    const placeholder = createPlaceholderRect(options);
    canvas.add(placeholder);
    canvas.centerObject(placeholder);
    canvas.requestRenderAll();
};

interface GridOptions {
    gutter?: number;
    tokenRole?: string;
}

export const generateGrid = (canvas: fabric.Canvas, rows: number, cols: number, options: GridOptions = {}) => {
    if (rows <= 0 || cols <= 0) return;
    const { bleedPx } = useEditorStore.getState();
    const gutter = options.gutter ?? 20;
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
    canvas.add(group);
    canvas.setActiveObject(group);
    canvas.requestRenderAll();
    useEditorStore.getState().saveState();
};

export const addTriptychLayout = (canvas: fabric.Canvas) => {
    generateGrid(canvas, 1, 3);
};

export const addWeeklyTrackerLayout = (canvas: fabric.Canvas) => {
    generateGrid(canvas, 1, 7);
};

export const addHerbProfileLayout = (canvas: fabric.Canvas) => {
    const { bleedPx } = useEditorStore.getState();
    const gutter = 20;
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
    canvas.add(group);
    canvas.setActiveObject(group);
    canvas.requestRenderAll();
    useEditorStore.getState().saveState();
};

/**
 * Loads an SVG from a URL and adds it to the canvas, linking it to the theme.
 * @param canvas The fabric.Canvas instance.
 * @param url The URL of the SVG file.
 */
export const addSvgFromUrl = async (canvas: fabric.Canvas, url: string) => {
    const { themeData } = useEditorStore.getState();
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

        canvas.add(group);
        group.scaleToWidth(150);
        canvas.centerObject(group);
        canvas.requestRenderAll();
        useEditorStore.getState().saveState();
    });
};
