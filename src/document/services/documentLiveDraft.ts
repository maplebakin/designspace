export type DocumentLiveDraftFlushHandler = () => number;

let activeFlushHandler: DocumentLiveDraftFlushHandler | null = null;

/**
 * The mounted document editor owns the live ProseMirror draft. Persistence
 * boundaries call this synchronous bridge before reading the canonical store.
 * It intentionally contains no second document model.
 */
export const registerDocumentLiveDraftFlushHandler = (
  handler: DocumentLiveDraftFlushHandler
) => {
  activeFlushHandler = handler;
  return () => {
    if (activeFlushHandler === handler) activeFlushHandler = null;
  };
};

export const flushDocumentLiveDrafts = () => activeFlushHandler?.() || 0;

