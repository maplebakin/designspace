
import * as fabric from 'fabric';

/**
 * Initializes logic to sync text object scaling with its font size.
 * When a text object is scaled, its fontSize is updated and scaleX/scaleY are reset to 1.
 * @param canvas The fabric.Canvas instance.
 * @returns A cleanup function to remove event listeners.
 */
export const initTextScalingSync = (canvas: fabric.Canvas) => {
  const onObjectScaling = (e: any) => {
    const target = e?.target as fabric.Object | undefined;

    // Only apply to text objects
    if (target && (target.type === 'i-text' || target.type === 'text' || target.type === 'textbox')) {
      const textObject = target as fabric.IText;
      const newFontSize = textObject.fontSize! * textObject.scaleX!; // Assume uniform scaling

      textObject.set({
        fontSize: newFontSize,
        scaleX: 1,
        scaleY: 1,
      });

    }
  };

  canvas.on('object:scaling', onObjectScaling);

  return () => {
    canvas.off('object:scaling', onObjectScaling);
  };
};
