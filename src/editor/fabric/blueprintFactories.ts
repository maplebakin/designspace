
import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';

/**
 * Loads a 'Daily Planner' template onto the canvas.
 * This function clears the canvas and adds a predefined set of objects.
 * @param canvas - The fabric.Canvas instance.
 * @param palette - An array of hex color strings from the brand palette.
 */
export const loadDailyPlannerTemplate = (canvas: fabric.Canvas, palette: string[]) => {
  // Clear the canvas first
  canvas.clear();

  // Get canvas dimensions
  const canvasWidth = canvas.getWidth();
  const canvasHeight = canvas.getHeight();

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
  canvas.add(headerText, taskBox1, taskBox2, decorativeCircle);

  // Render all changes
  canvas.requestRenderAll();
};

export const loadRetroManualTemplate = (canvas: fabric.Canvas, palette: string[]) => {
  const width = Math.round(5.5 * 300);
  const height = Math.round(8.5 * 300);
  const ink = palette[0] || '#1f2933';
  const accent = palette[6] || '#2f3650';

  canvas.discardActiveObject();
  canvas.clear();
  canvas.setWidth(width);
  canvas.setHeight(height);
  canvas.backgroundColor = '#FDFBF7';

  const bannerHeight = 220;
  const banner = new fabric.Rect({
    id: uuidv4(),
    left: width / 2,
    top: 120,
    originX: 'center',
    originY: 'center',
    width: width - 200,
    height: bannerHeight,
    fill: accent,
    rx: 18,
    ry: 18,
    strokeUniform: true,
  });

  const title = new fabric.IText('RETRO MANUAL', {
    id: uuidv4(),
    left: width / 2,
    top: 120,
    originX: 'center',
    originY: 'center',
    fontSize: 54,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    fill: '#FDFBF7',
    charSpacing: 140,
  });

  const bioBox = new fabric.Rect({
    id: uuidv4(),
    left: width / 2,
    top: 520,
    originX: 'center',
    originY: 'center',
    width: width - 220,
    height: 520,
    fill: 'rgba(15, 23, 42, 0.03)',
    stroke: ink,
    strokeWidth: 3,
    strokeDashArray: [10, 6],
    strokeUniform: true,
    rx: 10,
    ry: 10,
  });

  const bioTitle = new fabric.IText('CHARACTER BIO', {
    id: uuidv4(),
    left: width / 2,
    top: 320,
    originX: 'center',
    originY: 'center',
    fontSize: 26,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    fill: ink,
    charSpacing: 80,
  });

  const bioText = new fabric.IText('Name: ________  Class: ________', {
    id: uuidv4(),
    left: width / 2,
    top: 460,
    originX: 'center',
    originY: 'center',
    fontSize: 22,
    fontFamily: 'monospace',
    fill: ink,
  });

  const controlsTitle = new fabric.IText('CONTROLS', {
    id: uuidv4(),
    left: width / 2,
    top: 980,
    originX: 'center',
    originY: 'center',
    fontSize: 28,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    fill: ink,
    charSpacing: 80,
  });

  const buttonLabels = ['A', 'B', 'X', 'Y'];
  const buttonColors = [accent, ink, accent, ink];
  const buttonGroup: fabric.Object[] = [];
  const buttonRadius = 48;
  const startX = width / 2 - 220;
  const startY = 1120;
  const gap = 140;

  buttonLabels.forEach((label, index) => {
    const x = startX + index * gap;
    const circle = new fabric.Circle({
      id: uuidv4(),
      left: x,
      top: startY,
      originX: 'center',
      originY: 'center',
      radius: buttonRadius,
      fill: buttonColors[index],
      stroke: ink,
      strokeWidth: 3,
      strokeUniform: true,
    });
    const letter = new fabric.IText(label, {
      id: uuidv4(),
      left: x,
      top: startY,
      originX: 'center',
      originY: 'center',
      fontSize: 42,
      fontWeight: 'bold',
      fontFamily: 'monospace',
      fill: '#FDFBF7',
    });
    buttonGroup.push(circle, letter);
  });

  const footerNote = new fabric.IText('Press Start to Begin', {
    id: uuidv4(),
    left: width / 2,
    top: height - 120,
    originX: 'center',
    originY: 'center',
    fontSize: 20,
    fontFamily: 'monospace',
    fill: ink,
    charSpacing: 60,
  });

  canvas.add(
    banner,
    title,
    bioTitle,
    bioBox,
    bioText,
    controlsTitle,
    ...buttonGroup,
    footerNote
  );
  canvas.requestRenderAll();
};
