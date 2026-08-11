
import * as fabric from 'fabric';
import { useEditorStore } from '../state/editorStore';
import { useCanvasStore } from '../state/useCanvasStore';
import { v4 as uuidv4 } from 'uuid';
import { withCanvasObjectMutationSuppressed } from '../services/canvasMutationObservation';

const commitBlueprintInsertion = (canvas: fabric.Canvas) => {
  const { clearSelection, syncCanvasToStore, requestLayerSync, saveState } = useEditorStore.getState();
  clearSelection();
  canvas.requestRenderAll();
  syncCanvasToStore(canvas);
  requestLayerSync({ force: true });
  saveState({ force: true });
};

/**
 * Loads a 'Daily Planner' template onto the canvas.
 * This function clears the canvas and adds a predefined set of objects.
 * @param canvas - The fabric.Canvas instance.
 * @param palette - An array of hex color strings from the brand palette.
 */
export const loadDailyPlannerTemplate = (canvas: fabric.Canvas, palette: string[]) => {
  // Clear the canvas first
  useEditorStore.getState().clearSelection();
  withCanvasObjectMutationSuppressed(canvas, () => canvas.clear());

  // Get canvas dimensions
  const { width: canvasWidth, height: canvasHeight } = useCanvasStore.getState();

  const ink = palette[0] || '#1f2933';
  const accent = palette[4] || ink;
  const accentAlt = palette[5] || ink;
  const accentFill = palette[6] || ink;

  // 1. Header Text
  const headerText = new fabric.IText('DAILY PLANNER', {
    id: uuidv4(),
    left: canvasWidth / 2,
    top: 50,
    originX: 'center',
    fontSize: 48,
    fontWeight: 'bold',
    fontFamily: 'sans-serif',
    fill: ink,
  });

  // 2. Task Boxes
  const boxWidth = canvasWidth * 0.6;
  const boxHeight = canvasHeight * 0.3;

  const taskBox1 = new fabric.Rect({
    id: uuidv4(),
    left: canvasWidth / 2,
    top: canvasHeight * 0.35,
    originX: 'center',
    originY: 'center',
    width: boxWidth,
    height: boxHeight,
    fill: 'transparent',
    stroke: accent,
    strokeWidth: 2,
    strokeUniform: true,
    rx: 10, // rounded corners
    ry: 10,
  });

  const taskBox2 = new fabric.Rect({
    id: uuidv4(),
    left: canvasWidth / 2,
    top: canvasHeight * 0.70,
    originX: 'center',
    originY: 'center',
    width: boxWidth,
    height: boxHeight,
    fill: 'transparent',
    stroke: accentAlt,
    strokeWidth: 2,
    strokeUniform: true,
    rx: 10,
    ry: 10,
  });

  // 3. Decorative Circle
  const decorativeCircle = new fabric.Circle({
    id: uuidv4(),
    left: canvasWidth - 40,
    top: 40,
    originX: 'center',
    originY: 'center',
    radius: 20,
    fill: accentFill,
    strokeUniform: true,
  });

  // Add all objects to the canvas
  withCanvasObjectMutationSuppressed(canvas, () => {
    canvas.add(headerText, taskBox1, taskBox2, decorativeCircle);
  });

  commitBlueprintInsertion(canvas);
};

export const loadRetroManualTemplate = (canvas: fabric.Canvas, palette: string[]) => {
  const width = Math.round(5.5 * 300);
  const height = Math.round(8.5 * 300);
  const ink = '#0f0f0f';
  const accent = palette[6] || '#1d1b1b';

  useEditorStore.getState().clearSelection();
  withCanvasObjectMutationSuppressed(canvas, () => canvas.clear());
  canvas.setDimensions({ width, height });
  useCanvasStore.getState().setCanvasSize(width, height);
  useEditorStore.getState().setCanvasBackgroundColor('#FDFBF7', { save: false });

  const header = new fabric.IText('GAME TITLE', {
    id: uuidv4(),
    left: width / 2,
    top: 120,
    originX: 'center',
    originY: 'center',
    fontSize: 56,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    fill: ink,
    charSpacing: 120,
  });

  const headerRule = new fabric.Rect({
    id: uuidv4(),
    left: width / 2,
    top: 190,
    originX: 'center',
    originY: 'center',
    width: width - 220,
    height: 12,
    fill: ink,
    strokeUniform: true,
  });

  const portraitFrame = new fabric.Rect({
    id: uuidv4(),
    left: width / 2,
    top: 520,
    originX: 'center',
    originY: 'center',
    width: 520,
    height: 520,
    fill: 'rgba(0,0,0,0.02)',
    stroke: ink,
    strokeWidth: 6,
    strokeDashArray: [18, 10],
    strokeUniform: true,
    rx: 12,
    ry: 12,
  });

  const portraitLabel = new fabric.IText('PIXEL-ART PORTRAIT', {
    id: uuidv4(),
    left: width / 2,
    top: 300,
    originX: 'center',
    originY: 'center',
    fontSize: 22,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    fill: ink,
    charSpacing: 80,
  });

  const controllerBox = new fabric.Rect({
    id: uuidv4(),
    left: width / 2,
    top: 1100,
    originX: 'center',
    originY: 'center',
    width: width - 220,
    height: 360,
    fill: 'transparent',
    stroke: ink,
    strokeWidth: 5,
    strokeUniform: true,
    rx: 16,
    ry: 16,
  });

  const controllerTitle = new fabric.IText('CONTROLLER MAP', {
    id: uuidv4(),
    left: width / 2,
    top: 960,
    originX: 'center',
    originY: 'center',
    fontSize: 26,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    fill: ink,
    charSpacing: 90,
  });

  const buttonLabels = ['A', 'B', 'X', 'Y'];
  const buttonGroup: fabric.Object[] = [];
  const buttonRadius = 46;
  const startX = width / 2 - 200;
  const startY = 1120;
  const gap = 130;

  buttonLabels.forEach((label, index) => {
    const x = startX + index * gap;
    const circle = new fabric.Circle({
      id: uuidv4(),
      left: x,
      top: startY,
      originX: 'center',
      originY: 'center',
      radius: buttonRadius,
      fill: accent,
      stroke: ink,
      strokeWidth: 5,
      strokeUniform: true,
    });
    const letter = new fabric.IText(label, {
      id: uuidv4(),
      left: x,
      top: startY,
      originX: 'center',
      originY: 'center',
      fontSize: 40,
      fontWeight: 'bold',
      fontFamily: 'monospace',
      fill: '#FDFBF7',
    });
    buttonGroup.push(circle, letter);
  });

  const dpad = new fabric.Rect({
    id: uuidv4(),
    left: width / 2 - 260,
    top: 1220,
    originX: 'center',
    originY: 'center',
    width: 160,
    height: 40,
    fill: ink,
    strokeUniform: true,
  });

  const dpadVertical = new fabric.Rect({
    id: uuidv4(),
    left: width / 2 - 260,
    top: 1220,
    originX: 'center',
    originY: 'center',
    width: 40,
    height: 160,
    fill: ink,
    strokeUniform: true,
  });

  withCanvasObjectMutationSuppressed(canvas, () => {
    canvas.add(
      header,
      headerRule,
      portraitLabel,
      portraitFrame,
      controllerTitle,
      controllerBox,
      dpad,
      dpadVertical,
      ...buttonGroup
    );
  });
  commitBlueprintInsertion(canvas);
};
