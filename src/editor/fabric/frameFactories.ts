
import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';

const FRAME_DEFAULTS = {
  fill: '#f0f0f0',
  stroke: '#cccccc',
  strokeDashArray: [5, 5],
  strokeWidth: 2,
};

const applyFrameProps = (shape: fabric.FabricObject) => {
  shape.set({
    isFrame: true,
    patternSourceUrl: null,
    patternZoom: 1,
    patternOffsetX: 0,
    patternOffsetY: 0,
  });
};


/**
 * Adds a circle frame to the canvas.
 * @param canvas The fabric.Canvas instance.
 */
export const addCircleFrame = (canvas: fabric.Canvas) => {
  const circle = new fabric.Circle({
    id: uuidv4(),
    ...FRAME_DEFAULTS,
    radius: 100,
  });
  applyFrameProps(circle);
  canvas.add(circle);
  canvas.centerObject(circle);
  canvas.requestRenderAll();
};


/**
 * Adds a hexagon frame to the canvas.
 * @param canvas The fabric.Canvas instance.
 */
export const addHexagonFrame = (canvas: fabric.Canvas) => {
    const hexagonPoints = (size: number) => {
        const points = [];
        for (let i = 0; i < 6; i++) {
            const angle = (i * 60 * Math.PI) / 180;
            points.push({
                x: size * Math.cos(angle),
                y: size * Math.sin(angle),
            });
        }
        return points;
    };

    const hexagon = new fabric.Polygon(hexagonPoints(100), {
        id: uuidv4(),
        ...FRAME_DEFAULTS,
    });
    applyFrameProps(hexagon);
    canvas.add(hexagon);
    canvas.centerObject(hexagon);
    canvas.requestRenderAll();
};


/**
 * Adds a 5-pointed star frame to the canvas.
 * @param canvas The fabric.Canvas instance.
 */
export const addStarFrame = (canvas: fabric.Canvas) => {
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

    const star = new fabric.Polygon(starPoints(100, 50), {
        id: uuidv4(),
        ...FRAME_DEFAULTS,
    });
    applyFrameProps(star);
    canvas.add(star);
    canvas.centerObject(star);
    canvas.requestRenderAll();
};
