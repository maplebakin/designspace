import * as fabric from 'fabric';
import { useEditorStore, ApocapaletteTheme } from '../state/editorStore';

/**
 * Safely retrieves a nested value from an object using a dot-notation string.
 * @param obj The object to query.
 * @param path The dot-notation path (e.g., 'brand.primary.value').
 * @returns The value if found, otherwise undefined.
 */
const getValueByPath = (obj: object, path: string): any => {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
};



/**

 * Iterates through all objects on the canvas and applies colors from the

 * active theme if the object has a 'tokenRole' property.

 * SKIPS any objects that are locked.

 */

export const applyActiveThemeToCanvas = () => {

    const { canvas, themeData } = useEditorStore.getState();



    if (!canvas || !themeData) {

        console.warn('Apply theme called but no canvas or theme data is available.');

        return;

    }



    let objectsChanged = false;



    canvas.getObjects().forEach(obj => {

        // Skip locked objects

        if (obj.lockMovementX) {

            return;

        }



        const tokenRole = (obj as any).tokenRole;

        if (tokenRole) {

            const colorValue = getValueByPath(themeData, tokenRole);



            if (colorValue) {

                // Determine whether to apply to fill or stroke

                // Simple heuristic: if it has a stroke and no fill, apply to stroke. Otherwise, fill.

                if (obj.stroke && !obj.fill) {

                    if (obj.stroke !== colorValue) {

                        obj.set('stroke', colorValue);

                        objectsChanged = true;

                    }

                } else {

                    if (obj.fill !== colorValue) {

                        obj.set('fill', colorValue);

                        objectsChanged = true;

                    }

                }

            }

        }

    });



    if (objectsChanged) {

        canvas.requestRenderAll();

        useEditorStore.getState().saveState();

        console.log('Canvas themes refreshed.');

    }

};
