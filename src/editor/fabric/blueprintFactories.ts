
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

  // 1. Header Text
  const headerText = new fabric.IText('DAILY PLANNER', {
    id: uuidv4(),
    left: canvasWidth / 2,
    top: 50,
    originX: 'center',
    fontSize: 48,
    fontWeight: 'bold',
    fontFamily: 'sans-serif',
    fill: palette[0] || '#000000',
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
    stroke: palette[4] || '#3357FF',
    strokeWidth: 2,
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
    stroke: palette[5] || '#FF33A1',
    strokeWidth: 2,
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
    fill: palette[6] || '#A133FF',
  });

  // Add all objects to the canvas
  canvas.add(headerText, taskBox1, taskBox2, decorativeCircle);

  // Render all changes
  canvas.requestRenderAll();
};
