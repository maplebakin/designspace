
import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import { finalizeInsertionSelection, useEditorStore } from '../state/editorStore';
import { toSerializableObject } from '../utils/serialization';
import { withManifestZIndex, ZIndexLayer } from './zIndexManifest';

const FRAME_DEFAULTS = {
  fill: '#f0f0f0',
  stroke: '#cccccc',
  strokeDashArray: [5, 5],
  strokeWidth: 2,
};

type FrameType = 'circle' | 'star' | 'hexagon' | 'badge';

const applyFrameProps = (shape: fabric.FabricObject, frameType: FrameType) => {
  shape.set({
    isFrame: true,
    isPlaceholder: true,
    colorLocked: false,
    patternSourceUrl: null,
    patternZoom: 1,
    patternOffsetX: 0,
    patternOffsetY: 0,
    frameType,
  });
};

const addFrameToStore = (canvas: fabric.Canvas, frame: fabric.Object) => {
  canvas.centerObject(frame);
  const serialized = withManifestZIndex(
    toSerializableObject(frame),
    ZIndexLayer.Content
  );
  useEditorStore.getState().addObject(serialized, { save: true, select: true });
  if (typeof (serialized as any).id === 'string') {
    finalizeInsertionSelection((serialized as any).id);
  }
};


/**
 * Adds a circle frame to the canvas.
 * @param canvas The fabric.Canvas instance.
 */
export const addCircleFrame = (canvas: fabric.Canvas) => {
  const circle = new fabric.Circle({
    ...FRAME_DEFAULTS,
    strokeUniform: true,
    radius: 100,
  });
  (circle as any).id = uuidv4();
  applyFrameProps(circle, 'circle');
  addFrameToStore(canvas, circle);
};

/**
 * Adds a circle frame as a placeholder for image masking.
 * @param canvas The fabric.Canvas instance.
 */
export const addCircleFramePlaceholder = (canvas: fabric.Canvas) => {
  const circle = new fabric.Circle({
    fill: 'rgba(148, 163, 184, 0.35)', // Same as placeholder color
    stroke: 'rgba(148, 163, 184, 0.6)',
    strokeWidth: 1,
    strokeUniform: true,
    radius: 100,
    originX: 'center',
    originY: 'center',
    hasControls: true,
    lockMovementX: false,
    lockMovementY: false,
  });
  (circle as any).id = uuidv4();
  applyFrameProps(circle, 'circle');
  circle.set({ tokenRole: 'surfaces.surface-plain' });
  addFrameToStore(canvas, circle);
  return circle;
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
        ...FRAME_DEFAULTS,
        strokeUniform: true,
    });
    (hexagon as any).id = uuidv4();
    applyFrameProps(hexagon, 'hexagon');
    addFrameToStore(canvas, hexagon);
};

/**
 * Adds a hexagon frame as a placeholder for image masking.
 * @param canvas The fabric.Canvas instance.
 */
export const addHexagonFramePlaceholder = (canvas: fabric.Canvas) => {
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
        fill: 'rgba(148, 163, 184, 0.35)', // Same as placeholder color
        stroke: 'rgba(148, 163, 184, 0.6)',
        strokeWidth: 1,
        strokeUniform: true,
        originX: 'center',
        originY: 'center',
        hasControls: true,
        lockMovementX: false,
        lockMovementY: false,
    });
    (hexagon as any).id = uuidv4();
    applyFrameProps(hexagon, 'hexagon');
    hexagon.set({ tokenRole: 'surfaces.surface-plain' });
    addFrameToStore(canvas, hexagon);
    return hexagon;
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
        ...FRAME_DEFAULTS,
        strokeUniform: true,
    });
    (star as any).id = uuidv4();
    applyFrameProps(star, 'star');
    addFrameToStore(canvas, star);
};

/**
 * Adds a star frame as a placeholder for image masking.
 * @param canvas The fabric.Canvas instance.
 */
export const addStarFramePlaceholder = (canvas: fabric.Canvas) => {
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
        fill: 'rgba(148, 163, 184, 0.35)', // Same as placeholder color
        stroke: 'rgba(148, 163, 184, 0.6)',
        strokeWidth: 1,
        strokeUniform: true,
        originX: 'center',
        originY: 'center',
        hasControls: true,
        lockMovementX: false,
        lockMovementY: false,
    });
    (star as any).id = uuidv4();
    applyFrameProps(star, 'star');
    star.set({ tokenRole: 'surfaces.surface-plain' });
    addFrameToStore(canvas, star);
    return star;
};

export const addBadgeFrame = (canvas: fabric.Canvas) => {
    const badgePoints = (outerRadius: number, innerRadius: number, lobes = 12) => {
        const points = [];
        const totalPoints = lobes * 2;
        const step = (Math.PI * 2) / totalPoints;
        const startAngle = -Math.PI / 2;
        for (let i = 0; i < totalPoints; i += 1) {
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const angle = startAngle + step * i;
            points.push({
                x: radius * Math.cos(angle),
                y: radius * Math.sin(angle),
            });
        }
        return points;
    };

    const badge = new fabric.Polygon(badgePoints(100, 82), {
        ...FRAME_DEFAULTS,
        strokeUniform: true,
    });
    (badge as any).id = uuidv4();
    applyFrameProps(badge, 'badge');
    addFrameToStore(canvas, badge);
};
