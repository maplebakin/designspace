import * as fabric from 'fabric';

export type GradientStop = {
    color: string;
    offset: number;
    opacity?: number;
};

export type GradientBounds = {
    width: number;
    height: number;
};

export type LinearGradientCoords = {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
};

export type RadialGradientCoords = {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    r1: number;
    r2: number;
};

export type LinearGradientOptions = {
    type?: 'linear';
    gradientUnits?: 'pixels' | 'percentage';
    coords?: Partial<LinearGradientCoords>;
    colorStops: GradientStop[];
    bounds?: GradientBounds;
    id?: string;
};

export type RadialGradientOptions = {
    type?: 'radial';
    gradientUnits?: 'pixels' | 'percentage';
    coords?: Partial<RadialGradientCoords>;
    colorStops: GradientStop[];
    bounds?: GradientBounds;
    id?: string;
};

export type GradientOptions = LinearGradientOptions | RadialGradientOptions;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const normalizeStops = (stops: GradientStop[]) =>
    [...stops]
        .map((stop) => ({
            ...stop,
            offset: clamp(stop.offset),
        }))
        .sort((a, b) => a.offset - b.offset);

const resolveLinearCoords = (
    options: LinearGradientOptions
): LinearGradientCoords => {
    const gradientUnits = options.gradientUnits ?? 'percentage';
    const bounds = options.bounds ?? { width: 1, height: 1 };
    const defaults = gradientUnits === 'percentage'
        ? { x1: 0, y1: 0, x2: 1, y2: 1 }
        : { x1: 0, y1: 0, x2: bounds.width, y2: bounds.height };
    return { ...defaults, ...(options.coords ?? {}) };
};

const resolveRadialCoords = (
    options: RadialGradientOptions
): RadialGradientCoords => {
    const gradientUnits = options.gradientUnits ?? 'percentage';
    const bounds = options.bounds ?? { width: 1, height: 1 };
    const defaultRadius = gradientUnits === 'percentage'
        ? 0.5
        : Math.max(bounds.width, bounds.height) / 2;
    const defaultCenter = gradientUnits === 'percentage'
        ? { x: 0.5, y: 0.5 }
        : { x: bounds.width / 2, y: bounds.height / 2 };
    const defaults = {
        x1: defaultCenter.x,
        y1: defaultCenter.y,
        x2: defaultCenter.x,
        y2: defaultCenter.y,
        r1: 0,
        r2: defaultRadius,
    };
    return { ...defaults, ...(options.coords ?? {}) };
};

export const createLinearGradient = (options: LinearGradientOptions) =>
    new fabric.Gradient<'linear'>({
        type: 'linear',
        gradientUnits: options.gradientUnits ?? 'percentage',
        coords: resolveLinearCoords(options),
        colorStops: normalizeStops(options.colorStops),
        id: options.id,
    });

export const createRadialGradient = (options: RadialGradientOptions) =>
    new fabric.Gradient<'radial'>({
        type: 'radial',
        gradientUnits: options.gradientUnits ?? 'percentage',
        coords: resolveRadialCoords(options),
        colorStops: normalizeStops(options.colorStops),
        id: options.id,
    });

export const createGradient = (options: GradientOptions) => {
    if (options.type === 'radial') {
        return createRadialGradient(options as RadialGradientOptions);
    }
    return createLinearGradient(options as LinearGradientOptions);
};
