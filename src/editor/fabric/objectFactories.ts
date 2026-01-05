
import * as fabric from 'fabric';
import { useEditorStore } from '../state/editorStore';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_STROKE_COLOR = '#000000';
const DEFAULT_STROKE_WIDTH = 2;

/**
 * Adds a styled rectangle with rounded corners to the center of the canvas.
 * @param canvas - The fabric.Canvas instance.
 */
export const addRectangle = (canvas: fabric.Canvas) => {
  const rect = new fabric.Rect({
    id: uuidv4(),
    tokenRole: 'brand.primary.value',
    width: 150,
    height: 100,
    fill: useEditorStore.getState().themeData?.brand?.primary?.value || '#A133FF',
    stroke: DEFAULT_STROKE_COLOR,
    strokeWidth: DEFAULT_STROKE_WIDTH,
    rx: 10, // Corner radius
    ry: 10, // Corner radius
    originX: 'center',
    originY: 'center',
  });
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
    id: uuidv4(),
    tokenRole: 'brand.primary.value',
    radius: 75,
    fill: useEditorStore.getState().themeData?.brand?.primary?.value || '#A133FF',
    stroke: DEFAULT_STROKE_COLOR,
    strokeWidth: DEFAULT_STROKE_WIDTH,
    originX: 'center',
    originY: 'center',
  });
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
        id: uuidv4(),
        tokenRole: 'brand.primary.value',
        width: 150,
        height: 130,
        fill: useEditorStore.getState().themeData?.brand?.primary?.value || '#A133FF',
        stroke: DEFAULT_STROKE_COLOR,
        strokeWidth: DEFAULT_STROKE_WIDTH,
        originX: 'center',
        originY: 'center',
    });
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
        id: uuidv4(),
        tokenRole: 'brand.primary.value',
        fill: useEditorStore.getState().themeData?.brand?.primary?.value || '#A133FF',
        stroke: DEFAULT_STROKE_COLOR,
        strokeWidth: DEFAULT_STROKE_WIDTH,
        originX: 'center',
        originY: 'center',
    });
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
    id: uuidv4(),
    tokenRole: tokenRole,
    fontSize: options.fontSize,
    fontWeight: options.fontWeight || 'normal',
    fill: getThemeTextColor(role),
    originX: 'center',
    originY: 'center',
    fontFamily: getThemeFontFamily(role),
  });
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
        id: uuidv4(),
        tokenRole: 'typography.body.value',
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
