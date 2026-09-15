import type { DocumentProjectPayload } from '../../editor/project/projectSchema';

export type DocumentHistoryAction =
  | 'text'
  | 'image'
  | 'reference'
  | 'layout'
  | 'style'
  | 'page-structure'
  | 'metadata'
  | 'mixed';

/**
 * The document editor has one project-wide authored chronology. Text edits are
 * grouped at the existing draft-commit boundary, while committed image,
 * reference, layout, style, metadata, and page-structure transitions each
 * contribute one reversible entry. Page selection alone is navigation and is
 * not an undo entry; entries remain available after switching pages. A new
 * authored transition after undo truncates the redo branch.
 */

export type DocumentHistoryEntry = Readonly<{
  before: DocumentProjectPayload;
  after: DocumentProjectPayload;
  action: DocumentHistoryAction;
  pageIds: readonly string[];
  recordedAt: number;
}>;

export type DocumentHistoryState = Readonly<{
  canUndo: boolean;
  canRedo: boolean;
  length: number;
  index: number;
}>;

type DocumentHistoryListener = (state: DocumentHistoryState) => void;

type PendingTransition = Readonly<{
  before: DocumentProjectPayload;
  after: DocumentProjectPayload;
  action: DocumentHistoryAction;
}>;

type ProjectTransitionContext = Readonly<{
  previousSessionIdentity: string;
  sessionIdentity: string;
}>;

const MAX_DOCUMENT_HISTORY_ENTRIES = 100;

const jsonEqual = (left: unknown, right: unknown) => {
  if (left === right) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};

const projectMetadataEqual = (
  left: DocumentProjectPayload,
  right: DocumentProjectPayload
) => jsonEqual(left.metadata, right.metadata)
  && jsonEqual(left.productMetadata, right.productMetadata)
  && left.projectName === right.projectName;

const projectNonPageEqual = (
  left: DocumentProjectPayload,
  right: DocumentProjectPayload
) => (
  left.projectId === right.projectId
  && left.editorMode === right.editorMode
  && projectMetadataEqual(left, right)
  && left.pages === right.pages
  && left.assets === right.assets
  && left.assetMetadata === right.assetMetadata
  && left.document === right.document
  && left.canvasSize === right.canvasSize
  && left.unitMode === right.unitMode
  && left.theme === right.theme
  && left.recipe === right.recipe
  && left.exportSettings === right.exportSettings
  && left.recovery === right.recovery
  && left.activeTheme === right.activeTheme
  && left.canvasData === right.canvasData
);

const projectAuthoredEqual = (
  left: DocumentProjectPayload,
  right: DocumentProjectPayload
) => (
  projectNonPageEqual(left, right)
  && left.pages === right.pages
  && left.activePageIndex === right.activePageIndex
);

const projectExceptActivePageEqual = (
  left: DocumentProjectPayload,
  right: DocumentProjectPayload
) => (
  projectNonPageEqual(left, right)
  && left.pages === right.pages
);

const changedPageRegions = (
  before: DocumentProjectPayload,
  after: DocumentProjectPayload
) => {
  const titlePageIds: string[] = [];
  const bodyPageIds: string[] = [];
  const beforePages = new Map(before.pages.map((page) => [page.id, page]));
  after.pages.forEach((page) => {
    const previous = beforePages.get(page.id);
    if (!previous) return;
    if (previous.titleContent !== page.titleContent) titlePageIds.push(page.id);
    if (
      previous.bodyContent !== page.bodyContent
      || previous.imageGroups !== page.imageGroups
    ) {
      bodyPageIds.push(page.id);
    }
  });
  return { titlePageIds, bodyPageIds };
};

const classifyTransition = (
  before: DocumentProjectPayload,
  after: DocumentProjectPayload
): { action: DocumentHistoryAction; pageIds: readonly string[] } => {
  const { titlePageIds, bodyPageIds } = changedPageRegions(before, after);
  const pageIds = Array.from(new Set([...titlePageIds, ...bodyPageIds]));
  const documentChanged = before.document !== after.document;
  const assetsChanged = before.assets !== after.assets
    || before.assetMetadata !== after.assetMetadata;

  const onlyTextChanged = (
    pageIds.length > 0
    && before.pages.length === after.pages.length
    && before.pages.every((page, index) => {
      const next = after.pages[index];
      if (!next || page.id !== next.id) return false;
      const titleChanged = page.titleContent !== next.titleContent;
      const bodyChanged = page.bodyContent !== next.bodyContent
        || page.imageGroups !== next.imageGroups;
      if (!titleChanged && !bodyChanged) {
        return jsonEqual(page, next);
      }
      const left = { ...page, titleContent: undefined, bodyContent: undefined };
      const right = { ...next, titleContent: undefined, bodyContent: undefined };
      return jsonEqual(left, right);
    })
    && !documentChanged
    && !assetsChanged
    && before.theme === after.theme
    && before.recipe === after.recipe
    && before.exportSettings === after.exportSettings
    && before.recovery === after.recovery
    && before.activeTheme === after.activeTheme
    && before.canvasData === after.canvasData
    && before.projectName === after.projectName
    && jsonEqual(before.metadata, after.metadata)
    && jsonEqual(before.productMetadata, after.productMetadata)
    && before.activePageIndex === after.activePageIndex
  );
  if (onlyTextChanged) {
    return {
      action: titlePageIds.length > 0 && bodyPageIds.length > 0
        ? 'mixed'
        : 'text',
      pageIds,
    };
  }

  if (assetsChanged || bodyPageIds.length > 0) {
    const imageOnly = after.pages.every((page, index) => {
      const previous = before.pages[index];
      if (!previous || previous.id !== page.id) return false;
      const previousWithoutImages = {
        ...previous,
        bodyContent: undefined,
        imageGroups: undefined,
        overlayObjects: undefined,
      };
      const nextWithoutImages = {
        ...page,
        bodyContent: undefined,
        imageGroups: undefined,
        overlayObjects: undefined,
      };
      return jsonEqual(previousWithoutImages, nextWithoutImages);
    });
    if (imageOnly || assetsChanged) return { action: 'image', pageIds };
  }

  if (before.pages !== after.pages) {
    const referenceChanged = after.pages.some((page, index) => (
      before.pages[index]?.reference !== page.reference
    ));
    if (referenceChanged) return { action: 'reference', pageIds };
    const pageStructureChanged = before.pages.length !== after.pages.length
      || before.pages.some((page, index) => page.id !== after.pages[index]?.id);
    if (pageStructureChanged) return { action: 'page-structure', pageIds };
    return { action: 'layout', pageIds };
  }
  if (documentChanged) return { action: 'style', pageIds };
  if (!projectMetadataEqual(before, after)) return { action: 'metadata', pageIds };
  return { action: 'mixed', pageIds };
};

export type DocumentHistory = Readonly<{
  observeTransition: (
    before: DocumentProjectPayload | null,
    after: DocumentProjectPayload | null,
    context: ProjectTransitionContext
  ) => void;
  flushPending: () => void;
  reset: (project: DocumentProjectPayload | null, sessionIdentity: string) => void;
  undo: (apply: (project: DocumentProjectPayload) => void) => boolean;
  redo: (apply: (project: DocumentProjectPayload) => void) => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
  getState: () => DocumentHistoryState;
  subscribe: (listener: DocumentHistoryListener) => () => void;
}>;

export const createDocumentHistory = (now: () => number = () => Date.now()): DocumentHistory => {
  let sessionIdentity = '';
  let entries: DocumentHistoryEntry[] = [];
  let index = 0;
  let pending: PendingTransition[] = [];
  let pendingFlushScheduled = false;
  let applying = false;
  const listeners = new Set<DocumentHistoryListener>();

  const state = (): DocumentHistoryState => ({
    canUndo: index > 0,
    canRedo: index < entries.length,
    length: entries.length,
    index,
  });

  const notify = () => {
    const current = state();
    listeners.forEach((listener) => listener(current));
  };

  const reset = (project: DocumentProjectPayload | null, nextSessionIdentity: string) => {
    sessionIdentity = nextSessionIdentity;
    entries = [];
    index = 0;
    pending = [];
    pendingFlushScheduled = false;
    if (project) {
      // The baseline is represented by the first entry's `before` reference;
      // no deep clone is taken, so unchanged image bytes remain shared.
      entries = [];
    }
    notify();
  };

  const record = (before: DocumentProjectPayload, after: DocumentProjectPayload) => {
    if (projectAuthoredEqual(before, after)) return;
    if (projectExceptActivePageEqual(before, after)) return;
    const classification = classifyTransition(before, after);
    if (index < entries.length) entries = entries.slice(0, index);
    entries.push({
      before,
      after,
      action: classification.action,
      pageIds: classification.pageIds,
      recordedAt: now(),
    });
    if (entries.length > MAX_DOCUMENT_HISTORY_ENTRIES) entries.shift();
    index = entries.length;
    notify();
  };

  const flushPending = () => {
    pendingFlushScheduled = false;
    if (pending.length === 0) return;
    const first = pending[0];
    const last = pending[pending.length - 1];
    pending = [];
    record(first.before, last.after);
  };

  const observeTransition = (
    before: DocumentProjectPayload | null,
    after: DocumentProjectPayload | null,
    context: ProjectTransitionContext
  ) => {
    if (!after || !before) {
      if (context.sessionIdentity !== sessionIdentity) {
        reset(after, context.sessionIdentity);
      }
      return;
    }
    if (context.sessionIdentity !== sessionIdentity) {
      reset(after, context.sessionIdentity);
      return;
    }
    // A page selection is navigation, not an authored action. Flush an
    // authored transition that arrived immediately before it so the
    // selection cannot accidentally become part of that history entry.
    if (projectExceptActivePageEqual(before, after)) {
      flushPending();
      return;
    }
    if (applying) return;
    const classification = classifyTransition(before, after);
    const previous = pending[pending.length - 1];
    // A synchronous store operation can legitimately publish more than one
    // project replacement (for example, allocating an asset and then
    // inserting its image node). Keep those same-domain replacements atomic,
    // but never let a pending text draft swallow the next heterogeneous
    // authored action merely because both notifications arrived in one turn.
    if (
      previous
      && (
        previous.action !== classification.action
        || previous.action === 'mixed'
        || classification.action === 'mixed'
      )
    ) {
      flushPending();
    }
    pending.push({ before, after, action: classification.action });
    if (pendingFlushScheduled) return;
    pendingFlushScheduled = true;
    queueMicrotask(flushPending);
  };

  const apply = (
    target: DocumentProjectPayload,
    applyProject: (project: DocumentProjectPayload) => void
  ) => {
    applying = true;
    try {
      applyProject(target);
    } finally {
      applying = false;
    }
  };

  const undo = (applyProject: (project: DocumentProjectPayload) => void) => {
    flushPending();
    if (index <= 0) return false;
    const entry = entries[index - 1];
    apply(entry.before, applyProject);
    index -= 1;
    notify();
    return true;
  };

  const redo = (applyProject: (project: DocumentProjectPayload) => void) => {
    flushPending();
    if (index >= entries.length) return false;
    const entry = entries[index];
    apply(entry.after, applyProject);
    index += 1;
    notify();
    return true;
  };

  return {
    observeTransition,
    flushPending,
    reset,
    undo,
    redo,
    canUndo: () => index > 0,
    canRedo: () => index < entries.length,
    getState: state,
    subscribe: (listener) => {
      listeners.add(listener);
      listener(state());
      return () => listeners.delete(listener);
    },
  };
};
