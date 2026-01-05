
import * as pdfjsLib from 'pdfjs-dist';
import * as fabric from 'fabric';
import { useEditorStore } from '../state/editorStore';

// Set up the worker source for pdfjs-dist
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

/**
 * Loads the first page of a PDF and sets it as the canvas background.
 * @param file The PDF file to load.
 * @param canvas The fabric.Canvas instance.
 */
export const loadPdfAsBackground = async (file: File, canvas: fabric.Canvas) => {
    const fileReader = new FileReader();

    fileReader.onload = async function() {
        if (this.result) {
            const typedarray = new Uint8Array(this.result as ArrayBuffer);
            const pdf = await pdfjsLib.getDocument(typedarray).promise;
            const page = await pdf.getPage(1); // Get the first page

            // Create a temporary canvas to render the PDF page
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            
            const viewport = page.getViewport({ scale: 1.5 });
            tempCanvas.width = viewport.width;
            tempCanvas.height = viewport.height;
            
            if (!tempCtx) {
                console.error("Could not create temporary canvas context for PDF rendering.");
                return;
            }

            const renderContext = {
                canvasContext: tempCtx,
                viewport,
                canvas: tempCanvas,
            };

            await page.render(renderContext).promise;

            // Create a fabric image from the temporary canvas
            const imgData = tempCanvas.toDataURL('image/png');
            fabric.Image.fromURL(imgData, { crossOrigin: 'anonymous' }).then((img: fabric.FabricImage) => {
                img.scaleX = (canvas.width || img.width || 1) / (img.width || 1);
                img.scaleY = (canvas.height || img.height || 1) / (img.height || 1);
                canvas.backgroundImage = img;
                canvas.requestRenderAll();
                useEditorStore.getState().saveState();
            });
        }
    };

    fileReader.readAsArrayBuffer(file);
};
