import * as fabric from 'fabric';

export type CommitCanvasMutationCallbacks = {
  syncCanvasToStore?: (canvasOverride?: fabric.Canvas | null) => void;
  syncActivePageFromCanvas?: () => void;
  saveState?: () => void;
  requestLayerSync?: () => void;
  /** Optional product-level callback after the legacy commit has completed. */
  onCommitted?: () => void;
};

export type CommitCanvasMutationOptions = {
  render?: boolean;
  syncPage?: boolean;
  save?: boolean;
  layerSync?: boolean;
};

/**
 * Commits direct Fabric mutations back into editor state before history/layer writes.
 */
export const commitCanvasMutation = (
  canvas: fabric.Canvas,
  callbacks: CommitCanvasMutationCallbacks,
  options: CommitCanvasMutationOptions = {}
) => {
  if (options.render !== false) {
    canvas.requestRenderAll();
  }

  callbacks.syncCanvasToStore?.(canvas);

  if (options.syncPage) {
    callbacks.syncActivePageFromCanvas?.();
  }

  if (options.save !== false) {
    callbacks.saveState?.();
  }

  if (options.layerSync !== false) {
    callbacks.requestLayerSync?.();
  }
};
