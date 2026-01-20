import * as fabric from 'fabric';

type FilterType = 'Brightness' | 'Contrast' | 'Saturation' | 'Grayscale';

type FilterWithType = {
    type: FilterType;
    [key: string]: any;
};

export type ImageAdjustments = {
    brightness?: number;
    contrast?: number;
    saturation?: number;
};

export type GrayscaleMode = 'average' | 'lightness' | 'luminosity';

const ensureFilters = (image: fabric.Image) => {
    if (!image.filters) {
        image.filters = [];
    }
    return image.filters as FilterWithType[];
};

const ensureAdjustments = (image: fabric.Image) => {
    if (!image.adjustments) {
        image.adjustments = { brightness: 0, contrast: 0, saturation: 0 };
    }
    return image.adjustments;
};

const findFilter = <T extends FilterWithType>(image: fabric.Image, type: FilterType) =>
    (image.filters as FilterWithType[] | undefined)?.find((filter) => filter.type === type) as T | undefined;

const removeFilter = (image: fabric.Image, type: FilterType) => {
    if (!image.filters) return;
    image.filters = image.filters.filter((filter) => filter.type !== type);
};

const applyFilters = (image: fabric.Image, canvas?: fabric.Canvas) => {
    image.applyFilters();
    canvas?.requestRenderAll();
};

const upsertBrightness = (image: fabric.Image, value: number) => {
    let brightness = findFilter<fabric.filters.Brightness>(image, 'Brightness');
    if (brightness) {
        brightness.brightness = value;
        return;
    }
    const filters = ensureFilters(image);
    filters.push(new fabric.filters.Brightness({ brightness: value }));
};

const upsertContrast = (image: fabric.Image, value: number) => {
    let contrast = findFilter<fabric.filters.Contrast>(image, 'Contrast');
    if (contrast) {
        contrast.contrast = value;
        return;
    }
    const filters = ensureFilters(image);
    filters.push(new fabric.filters.Contrast({ contrast: value }));
};

const upsertSaturation = (image: fabric.Image, value: number) => {
    let saturation = findFilter<fabric.filters.Saturation>(image, 'Saturation');
    if (saturation) {
        saturation.saturation = value;
        return;
    }
    const filters = ensureFilters(image);
    filters.push(new fabric.filters.Saturation({ saturation: value }));
};

export const applyImageAdjustments = (
    image: fabric.Image,
    adjustments: ImageAdjustments,
    canvas?: fabric.Canvas
) => {
    const target = ensureAdjustments(image);

    if (adjustments.brightness !== undefined) {
        upsertBrightness(image, adjustments.brightness);
        target.brightness = adjustments.brightness;
    }

    if (adjustments.contrast !== undefined) {
        upsertContrast(image, adjustments.contrast);
        target.contrast = adjustments.contrast;
    }

    if (adjustments.saturation !== undefined) {
        upsertSaturation(image, adjustments.saturation);
        target.saturation = adjustments.saturation;
    }

    applyFilters(image, canvas);
};

export const setBrightnessFilter = (image: fabric.Image, value: number, canvas?: fabric.Canvas) => {
    applyImageAdjustments(image, { brightness: value }, canvas);
};

export const setContrastFilter = (image: fabric.Image, value: number, canvas?: fabric.Canvas) => {
    applyImageAdjustments(image, { contrast: value }, canvas);
};

export const setSaturationFilter = (image: fabric.Image, value: number, canvas?: fabric.Canvas) => {
    applyImageAdjustments(image, { saturation: value }, canvas);
};

export const setGrayscaleFilter = (
    image: fabric.Image,
    enabled: boolean,
    canvas?: fabric.Canvas,
    mode?: GrayscaleMode
) => {
    if (enabled) {
        let grayscale = findFilter<fabric.filters.Grayscale>(image, 'Grayscale');
        if (grayscale) {
            if (mode) {
                grayscale.mode = mode;
            }
        } else {
            const filters = ensureFilters(image);
            filters.push(new fabric.filters.Grayscale({ mode }));
        }
    } else {
        removeFilter(image, 'Grayscale');
    }
    applyFilters(image, canvas);
};
