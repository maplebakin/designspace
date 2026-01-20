import * as fabric from 'fabric';

export type TextOutlineOptions = {
    color: string;
    width: number;
};

export const applyTextOutline = (
    target: fabric.Text | fabric.IText | fabric.Textbox,
    options: TextOutlineOptions
) => {
    target.set({
        stroke: options.color,
        strokeWidth: options.width,
    });
};

export const clearTextOutline = (target: fabric.Text | fabric.IText | fabric.Textbox) => {
    target.set({
        stroke: undefined,
        strokeWidth: 0,
    });
};

export const hasTextOutline = (target: fabric.Text | fabric.IText | fabric.Textbox) =>
    Boolean(target.stroke && (target.strokeWidth ?? 0) > 0);
