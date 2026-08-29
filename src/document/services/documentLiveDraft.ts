export type DocumentLiveDraftFlushHandler = () => number;

export type DocumentLiveDraftScope = Readonly<{
  register: (handler: DocumentLiveDraftFlushHandler) => () => void;
  flush: () => number;
  dispose: () => void;
}>;

let nextScopeId = 1;
const handlers = new Map<number, DocumentLiveDraftFlushHandler>();

const registerHandler = (
  ownerId: number,
  handler: DocumentLiveDraftFlushHandler
) => {
  handlers.set(ownerId, handler);
  return () => {
    if (handlers.get(ownerId) === handler) handlers.delete(ownerId);
  };
};

/**
 * Creates a page/editor-owned draft bridge. A scope cannot be replaced by a
 * later mount, so an old editor cannot flush a newer editor's draft.
 */
export const createDocumentLiveDraftScope = (): DocumentLiveDraftScope => {
  const ownerId = nextScopeId;
  nextScopeId += 1;
  let disposed = false;

  return {
    register: (handler) => {
      if (disposed) return () => undefined;
      return registerHandler(ownerId, handler);
    },
    flush: () => {
      if (disposed) return 0;
      return handlers.get(ownerId)?.() || 0;
    },
    dispose: () => {
      disposed = true;
      handlers.delete(ownerId);
    },
  };
};

/**
 * Legacy registration remains for non-React callers/tests. Production
 * DocumentEditorShell instances use a scope so ownership is explicit.
 */
export const registerDocumentLiveDraftFlushHandler = (
  handler: DocumentLiveDraftFlushHandler
) => {
  const ownerId = nextScopeId;
  nextScopeId += 1;
  return registerHandler(ownerId, handler);
};

export const flushDocumentLiveDrafts = () => {
  let flushed = 0;
  [...handlers.values()].forEach((handler) => {
    flushed += handler();
  });
  return flushed;
};

