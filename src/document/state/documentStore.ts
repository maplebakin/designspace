import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import {
  CURRENT_DOCUMENT_SCHEMA_VERSION,
  DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
  normalizeDocumentContentStyles,
  normalizeDesignSpaceProjectPayload,
  type DocumentProjectPayload,
} from '../../editor/project/projectSchema';
import type {
  DocumentContentJson,
  DocumentFolioSettings,
  DocumentOverlayImage,
  DocumentPage,
  ScanReference,
} from '../types/documentProject';
import type {
  DocumentDropCapSettings,
  DocumentNamedStyleDefinition,
  DocumentStyleId,
} from '../typography/documentTypography';
import {
  collectDocumentAssetReferences,
  findMissingDocumentAssetIds,
  fingerprintDocumentAssetSource,
  pruneDocumentAssets,
} from '../model/documentAssets';
import {
  DEFAULT_DOCUMENT_DROP_CAP,
  normalizeDocumentDropCap,
  normalizeDocumentLanguage,
  normalizeDocumentStyleDefinition,
} from '../typography/documentTypography';
import { parseDocumentColor } from '../utils/documentColor';
import {
  normalizeDocumentFolioNumber,
} from '../layout/pageGeometry';
import {
  commitDocumentOverlayGeometry,
  getDocumentOverlayPageBounds,
  resolveNewDocumentOverlayGeometry,
  type DocumentOverlayGeometry,
} from '../layout/overlayGeometry';
import {
  collectGroupableDocumentImageIds,
  duplicateDocumentPageImageState,
  repairDocumentImageGroups,
} from '../model/documentImageGroups';
import {
  deliverFile,
  type FileDeliveryResult,
} from '../../editor/services/fileDeliveryService';

export type DocumentSaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';
export type DocumentLegacyDirtyReason =
  | 'authored-content'
  | 'navigation-persistence';

type DocumentStoreState = {
  project: DocumentProjectPayload | null;
  currentLibraryProjectId: string | null;
  isDirty: boolean;
  saveStatus: DocumentSaveStatus;
  /** Runtime-only explanation for the latest legacy dirty transition. */
  lastDirtyReason: DocumentLegacyDirtyReason | null;
  revision: number;
  zoom: number;
  isReferenceAdjustMode: boolean;
  selectedOverlayId: string | null;
  selectedFlowImageId: string | null;
  isOverflowing: boolean;
  toastMessage: string | null;
  createBlankProject: (name?: string) => DocumentProjectPayload;
  hydrateProject: (payload: unknown, libraryProjectId?: string | null) => DocumentProjectPayload;
  loadLibraryProject: (projectId: string) => Promise<void>;
  loadProjectFile: (file: File) => Promise<void>;
  saveProject: (name?: string) => Promise<void>;
  downloadProjectFile: () => Promise<FileDeliveryResult | null>;
  renameProject: (name: string) => void;
  updateDocumentBackground: (value: string) => void;
  updateDocumentLanguage: (language: string) => void;
  updateDocumentStyle: (
    styleId: DocumentStyleId,
    update: Partial<DocumentNamedStyleDefinition>
  ) => void;
  updateFolioSettings: (update: Partial<DocumentFolioSettings>) => void;
  selectPage: (index: number) => void;
  addPage: () => void;
  duplicatePage: (index?: number) => void;
  removePage: (index?: number) => void;
  reorderPages: (fromIndex: number, toIndex: number) => void;
  updatePage: (
    update: Partial<DocumentPage> | ((page: DocumentPage) => DocumentPage),
    pageId?: string
  ) => void;
  updateTitleContent: (content: DocumentContentJson, pageId?: string) => void;
  updateBodyContent: (content: DocumentContentJson, pageId?: string) => void;
  commitPageImageState: (
    pageId: string,
    bodyContent: DocumentContentJson,
    imageGroups?: unknown
  ) => void;
  updateImageGroups: (pageId: string, imageGroups: unknown) => void;
  updatePageLanguage: (language?: string, pageId?: string) => void;
  updateDropCap: (
    update: Partial<DocumentDropCapSettings>,
    pageId?: string
  ) => void;
  addAsset: (assetId: string, source: string, metadata?: {
    mimeType?: string;
    naturalWidth?: number;
    naturalHeight?: number;
    fileName?: string;
  }) => string;
  inspectAssetReferences: () => {
    reachableAssetIds: string[];
    missingAssetIds: string[];
    orphanAssetIds: string[];
  };
  addOverlay: (overlay: DocumentOverlayImage, pageId?: string) => void;
  updateOverlay: (
    id: string,
    update: Partial<DocumentOverlayImage>,
    pageId?: string
  ) => void;
  commitOverlayGeometry: (
    pageId: string,
    id: string,
    update: Partial<DocumentOverlayGeometry>
  ) => boolean;
  nudgeOverlay: (
    pageId: string,
    id: string,
    deltaXPx: number,
    deltaYPx: number
  ) => boolean;
  removeOverlay: (id: string, pageId?: string) => void;
  setReference: (reference?: ScanReference) => void;
  setZoom: (zoom: number) => void;
  setReferenceAdjustMode: (enabled: boolean) => void;
  setSelectedOverlayId: (id: string | null) => void;
  setSelectedFlowImageId: (id: string | null) => void;
  setOverflowing: (overflowing: boolean) => void;
  setToastMessage: (message: string | null) => void;
  flushAutosave: () => Promise<void>;
  reset: () => void;
};

const emptyDocumentContent = (
  documentStyleId: DocumentStyleId
): DocumentContentJson => ({
  type: 'doc',
  content: [{ type: 'paragraph', attrs: { documentStyleId } }],
});

export const createBlankDocumentPage = (name = 'Page 1'): DocumentPage => ({
  kind: 'document',
  id: uuidv4(),
  name,
  size: {
    presetId: 'letter',
    orientation: 'portrait',
    widthIn: 8.5,
    heightIn: 11,
    dpi: 300,
  },
  margins: {
    topIn: 0.65,
    bottomIn: 0.65,
    innerIn: 0.65,
    outerIn: 0.65,
  },
  titleContent: emptyDocumentContent('article-title'),
  bodyContent: emptyDocumentContent('body'),
  columnCount: 1,
  columnGapPx: 24,
  dropCap: { ...DEFAULT_DOCUMENT_DROP_CAP },
  suppressFolio: false,
  overlayObjects: [],
  imageGroups: [],
});

export const createBlankDocumentProject = (
  name = 'Untitled Document'
): DocumentProjectPayload => {
  const now = new Date().toISOString();
  const projectId = uuidv4();
  return normalizeDesignSpaceProjectPayload<DocumentPage>({
    schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
    editorMode: 'document',
    projectId,
    projectName: name,
    metadata: {
      name,
      sourceApp: 'design-space',
    },
    createdAt: now,
    updatedAt: now,
    lastUpdated: now,
    document: {
      schemaVersion: CURRENT_DOCUMENT_SCHEMA_VERSION,
    },
    pages: [createBlankDocumentPage()],
    assets: {},
    assetMetadata: {},
  }, {
    editorMode: 'document',
    projectId,
    projectName: name,
    now,
  }) as DocumentProjectPayload;
};

const normalizeDocumentPayload = (
  payload: unknown,
  fallbackName?: string
): DocumentProjectPayload => {
  const normalized = normalizeDesignSpaceProjectPayload<DocumentPage>(payload, {
    projectName: fallbackName,
  });
  if (normalized.editorMode !== 'document') {
    throw new Error('This is a canvas project, not a document project.');
  }
  if (normalized.pages.length < 1 || normalized.pages.some(
    (page) => page?.kind !== 'document'
  )) {
    throw new Error('Document projects must contain at least one valid document page.');
  }
  return normalized as DocumentProjectPayload;
};

const compactDocumentProjectForPersistence = (
  project: DocumentProjectPayload
): DocumentProjectPayload => {
  const compacted = pruneDocumentAssets(
    project.pages,
    project.assets,
    project.assetMetadata
  );
  return {
    ...project,
    assets: compacted.assets,
    assetMetadata: compacted.assetMetadata,
  };
};

const getActivePageIndex = (project: DocumentProjectPayload) => {
  const requested = Number(project.activePageIndex);
  if (!Number.isFinite(requested)) return 0;
  return Math.max(
    0,
    Math.min(project.pages.length - 1, Math.trunc(requested))
  );
};

const normalizeRequestedPageIndex = (
  value: number,
  pageCount: number
): number | null => {
  if (!Number.isFinite(value) || pageCount < 1) return null;
  return Math.max(0, Math.min(pageCount - 1, Math.trunc(value)));
};

const duplicateDocumentPage = (
  page: DocumentPage,
  name: string
): DocumentPage => {
  const duplicatedImageState = duplicateDocumentPageImageState(page, {
    createImageId: () => uuidv4(),
    createGroupId: () => uuidv4(),
  });
  return {
    ...page,
    id: uuidv4(),
    name,
    size: { ...page.size },
    margins: { ...page.margins },
    dropCap: { ...page.dropCap },
    titleContent: duplicatedImageState.titleContent,
    bodyContent: duplicatedImageState.bodyContent,
    overlayObjects: duplicatedImageState.overlayObjects,
    imageGroups: duplicatedImageState.imageGroups,
    reference: page.reference ? { ...page.reference } : undefined,
  };
};

const createPageAfter = (
  page: DocumentPage,
  name: string
): DocumentPage => {
  const blank = createBlankDocumentPage(name);
  return {
    ...blank,
    size: { ...page.size },
    margins: { ...page.margins },
    columnCount: page.columnCount,
    columnGapPx: page.columnGapPx,
    language: page.language,
    dropCap: { ...page.dropCap },
  };
};

const withDerivedDocumentPageSize = (
  project: DocumentProjectPayload
): DocumentProjectPayload => {
  const firstPage = project.pages[0];
  if (!firstPage) return project;
  const width = Math.round(firstPage.size.widthIn * firstPage.size.dpi);
  const height = Math.round(firstPage.size.heightIn * firstPage.size.dpi);
  return {
    ...project,
    document: {
      ...project.document,
      pageSize: {
        presetId: firstPage.size.presetId,
        width,
        height,
        unitMode: 'px',
        dpi: firstPage.size.dpi,
      },
    },
    canvasSize: { width, height },
    unitMode: 'px',
  };
};

const omitEmptyDocumentJsonMetadata = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(omitEmptyDocumentJsonMetadata);
  }
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== null && entry !== undefined)
    .map(([key, entry]) => [key, omitEmptyDocumentJsonMetadata(entry)] as const)
    .filter(([key, entry]) => (
      key !== 'attrs'
      || typeof entry !== 'object'
      || entry === null
      || Object.keys(entry as Record<string, unknown>).length > 0
    ))
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return Object.fromEntries(entries);
};

const documentPagesAreEquivalent = (
  left: DocumentPage,
  right: DocumentPage
) => JSON.stringify(omitEmptyDocumentJsonMetadata(left))
  === JSON.stringify(omitEmptyDocumentJsonMetadata(right));

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let projectSessionToken = 0;

const cancelAutosave = () => {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
};

const queueAutosave = () => {
  cancelAutosave();
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    void useDocumentStore.getState().flushAutosave();
  }, 900);
};

const markDirty = (
  set: (partial: Partial<DocumentStoreState> | ((state: DocumentStoreState) => Partial<DocumentStoreState>)) => void,
  reason: DocumentLegacyDirtyReason = 'authored-content'
) => {
  set((state) => ({
    isDirty: true,
    saveStatus: 'unsaved',
    lastDirtyReason: reason,
    revision: state.revision + 1,
  }));
  if (useDocumentStore.getState().currentLibraryProjectId) {
    queueAutosave();
  }
};

const updateProjectTimestamp = (
  project: DocumentProjectPayload,
  name = project.projectName
): DocumentProjectPayload => {
  const now = new Date().toISOString();
  return {
    ...project,
    projectName: name,
    updatedAt: now,
    lastUpdated: now,
    metadata: {
      ...project.metadata,
      name,
    },
    productMetadata: {
      ...project.productMetadata,
      title: project.productMetadata?.title === project.projectName
        ? name
        : project.productMetadata?.title,
    },
  };
};

const safeProjectFileName = (name: string) => {
  const safe = Array.from(name.trim())
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('')
    .replace(/[<>:"/\\|?*]/g, '-');
  return `${safe || 'Untitled Document'}.apocaproject.json`;
};

const initialState = {
  project: null,
  currentLibraryProjectId: null,
  isDirty: false,
  saveStatus: 'saved' as DocumentSaveStatus,
  lastDirtyReason: null as DocumentLegacyDirtyReason | null,
  revision: 0,
  zoom: 0.75,
  isReferenceAdjustMode: false,
  selectedOverlayId: null,
  selectedFlowImageId: null,
  isOverflowing: false,
  toastMessage: null,
};

export const useDocumentStore = create<DocumentStoreState>((set, get) => ({
  ...initialState,

  createBlankProject: (name) => {
    cancelAutosave();
    projectSessionToken += 1;
    const project = createBlankDocumentProject(name);
    set({
      ...initialState,
      project,
    });
    return project;
  },

  hydrateProject: (payload, libraryProjectId = null) => {
    cancelAutosave();
    projectSessionToken += 1;
    const project = normalizeDocumentPayload(payload);
    set({
      ...initialState,
      project,
      currentLibraryProjectId: libraryProjectId,
    });
    return project;
  },

  loadLibraryProject: async (projectId) => {
    const { db } = await import('../../editor/db');
    const result = await db.loadProject(projectId);
    if (!result) throw new Error('Project not found.');
    const parsed = JSON.parse(result.canvasData);
    const namedPayload = {
      ...parsed,
      projectName: result.project.name,
      metadata: {
        ...(parsed?.metadata || {}),
        name: result.project.name,
      },
    };
    get().hydrateProject(namedPayload, projectId);
    set({ toastMessage: `Loaded document: ${result.project.name}` });
  },

  loadProjectFile: async (file) => {
    if (file.size > 100 * 1024 * 1024) {
      throw new Error('Project file exceeds the 100 MB import limit.');
    }
    const parsed = JSON.parse(await file.text());
    const fallbackName = file.name
      .replace(/\.apocaproject\.json$/i, '')
      .replace(/\.json$/i, '');
    const project = normalizeDocumentPayload(parsed, fallbackName);
    cancelAutosave();
    projectSessionToken += 1;
    set({
      ...initialState,
      project,
      currentLibraryProjectId: null,
      toastMessage: `Opened document: ${project.projectName}`,
    });
  },

  saveProject: async (name) => {
    const project = get().project;
    if (!project) return;
    const safeName = name?.trim() || project.projectName.trim() || 'Untitled Document';
    const revisionAtStart = get().revision;
    const sessionAtStart = projectSessionToken;
    const payload = updateProjectTimestamp(
      compactDocumentProjectForPersistence(project),
      safeName
    );
    set({ project: payload, saveStatus: 'saving' });
    try {
      const { db } = await import('../../editor/db');
      let libraryId = get().currentLibraryProjectId;
      if (libraryId && await db.loadProject(libraryId)) {
        await db.updateProject(libraryId, safeName, JSON.stringify(payload), undefined, 'document');
      } else {
        libraryId = await db.saveProject(safeName, JSON.stringify(payload), undefined, 'document');
      }
      if (projectSessionToken !== sessionAtStart) return;
      const hasNewerChanges = get().revision !== revisionAtStart;
      set({
        ...(hasNewerChanges ? {} : { project: payload }),
        currentLibraryProjectId: libraryId,
        isDirty: hasNewerChanges,
        saveStatus: hasNewerChanges ? 'unsaved' : 'saved',
        ...(hasNewerChanges ? {} : { lastDirtyReason: null }),
        toastMessage: `Saved document: ${safeName}`,
      });
      if (hasNewerChanges) queueAutosave();
    } catch (error) {
      console.error('Failed to save document project:', error);
      if (projectSessionToken !== sessionAtStart) return;
      set({
        saveStatus: 'error',
        isDirty: true,
        toastMessage: 'Failed to save the document project.',
      });
    }
  },

  downloadProjectFile: async () => {
    const project = get().project;
    if (!project) return null;
    const payload = updateProjectTimestamp(
      compactDocumentProjectForPersistence(project)
    );
    const fileName = safeProjectFileName(payload.projectName);
    let delivery: FileDeliveryResult;
    try {
      delivery = await deliverFile({
        content: new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
        fileName,
        extension: 'apocaproject.json',
        dialogTitle: 'Save Design Space project',
        filterName: 'Design Space project',
      });
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : 'Could not save the Design Space project.';
      set({
        saveStatus: 'error',
        isDirty: true,
        toastMessage: message,
      });
      return null;
    }
    if (delivery.status === 'cancelled') return delivery;
    set({
      project: payload,
      isDirty: false,
      saveStatus: 'saved',
      lastDirtyReason: null,
      toastMessage: delivery.path
        ? `Downloaded project to ${delivery.path}`
        : `Downloaded project: ${payload.projectName}`,
    });
    return delivery;
  },

  renameProject: (name) => {
    const project = get().project;
    const safeName = name.trim() || 'Untitled Document';
    if (!project || project.projectName === safeName) return;
    set({ project: updateProjectTimestamp(project, safeName) });
    markDirty(set);
  },

  updateDocumentBackground: (value) => {
    const project = get().project;
    if (!project) return;
    const normalized = parseDocumentColor(value);
    if (!normalized) {
      set({
        toastMessage: 'Paper colour must be a three- or six-digit hex colour.',
      });
      return;
    }
    if (project.document.background?.value === normalized) return;
    set({
      project: {
        ...project,
        document: {
          ...project.document,
          background: {
            ...project.document.background,
            value: normalized,
          },
        },
      },
    });
    markDirty(set);
  },

  updateDocumentLanguage: (language) => {
    const project = get().project;
    if (!project) return;
    const normalized = normalizeDocumentLanguage(
      language,
      project.document.language
    );
    if (normalized === project.document.language) return;
    set({
      project: {
        ...project,
        document: {
          ...project.document,
          language: normalized,
        },
      },
    });
    markDirty(set);
  },

  updateDocumentStyle: (styleId, update) => {
    const project = get().project;
    if (!project) return;
    const current = project.document.styles[styleId];
    const next = normalizeDocumentStyleDefinition(
      { ...current, ...update },
      current
    );
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    set({
      project: {
        ...project,
        document: {
          ...project.document,
          styles: {
            ...project.document.styles,
            [styleId]: next,
          },
        },
      },
    });
    markDirty(set);
  },

  updateFolioSettings: (update) => {
    const project = get().project;
    if (!project) return;
    const current = project.document.folios;
    const next: DocumentFolioSettings = {
      startingNumber: update.startingNumber === undefined
        ? current.startingNumber
        : normalizeDocumentFolioNumber(
            update.startingNumber,
            current.startingNumber
          ),
      visible: update.visible ?? current.visible,
      placement: 'outside-bottom',
    };
    if (
      next.startingNumber === current.startingNumber
      && next.visible === current.visible
    ) {
      return;
    }
    set({
      project: {
        ...project,
        document: {
          ...project.document,
          folios: next,
        },
      },
    });
    markDirty(set);
  },

  selectPage: (index) => {
    const project = get().project;
    if (!project) return;
    const nextIndex = normalizeRequestedPageIndex(index, project.pages.length);
    if (nextIndex === null) return;
    if (nextIndex === getActivePageIndex(project)) return;
    set({
      project: {
        ...project,
        activePageIndex: nextIndex,
      },
      isReferenceAdjustMode: false,
      selectedOverlayId: null,
      selectedFlowImageId: null,
      isOverflowing: false,
    });
    // Page selection is a discrete, persisted document preference. Advancing
    // the revision also prevents an in-flight save from restoring the older
    // activePageIndex when its write completes.
    markDirty(set, 'navigation-persistence');
  },

  addPage: () => {
    const project = get().project;
    if (!project) return;
    const activeIndex = getActivePageIndex(project);
    const activePage = project.pages[activeIndex] || project.pages[0];
    const insertIndex = activeIndex + 1;
    const nextPage = createPageAfter(
      activePage,
      `Page ${project.pages.length + 1}`
    );
    const pages = [...project.pages];
    pages.splice(insertIndex, 0, nextPage);
    set({
      project: withDerivedDocumentPageSize({
        ...project,
        pages,
        activePageIndex: insertIndex,
      }),
      isReferenceAdjustMode: false,
      selectedOverlayId: null,
      selectedFlowImageId: null,
      isOverflowing: false,
    });
    markDirty(set);
  },

  duplicatePage: (requestedIndex) => {
    const project = get().project;
    if (!project) return;
    const activeIndex = getActivePageIndex(project);
    const sourceIndex = requestedIndex === undefined
      ? activeIndex
      : normalizeRequestedPageIndex(requestedIndex, project.pages.length);
    if (sourceIndex === null) return;
    const sourcePage = project.pages[sourceIndex];
    if (!sourcePage) return;
    const insertIndex = sourceIndex + 1;
    const nextPage = duplicateDocumentPage(
      sourcePage,
      `${sourcePage.name} copy`
    );
    const pages = [...project.pages];
    pages.splice(insertIndex, 0, nextPage);
    set({
      project: withDerivedDocumentPageSize({
        ...project,
        pages,
        activePageIndex: insertIndex,
      }),
      isReferenceAdjustMode: false,
      selectedOverlayId: null,
      selectedFlowImageId: null,
      isOverflowing: false,
    });
    markDirty(set);
  },

  removePage: (requestedIndex) => {
    const project = get().project;
    if (!project) return;
    if (project.pages.length <= 1) {
      set({ toastMessage: 'A document must contain at least one page.' });
      return;
    }
    const activeIndex = getActivePageIndex(project);
    const removeIndex = requestedIndex === undefined
      ? activeIndex
      : normalizeRequestedPageIndex(requestedIndex, project.pages.length);
    if (removeIndex === null) return;
    const activePageId = project.pages[activeIndex]?.id;
    const pages = project.pages.filter((_page, index) => index !== removeIndex);
    const retainedActiveIndex = pages.findIndex(
      (page) => page.id === activePageId
    );
    const nextActiveIndex = retainedActiveIndex >= 0
      ? retainedActiveIndex
      : Math.min(removeIndex, pages.length - 1);
    set({
      project: withDerivedDocumentPageSize({
        ...project,
        pages,
        activePageIndex: nextActiveIndex,
      }),
      isReferenceAdjustMode: false,
      selectedOverlayId: null,
      selectedFlowImageId: null,
      isOverflowing: false,
    });
    markDirty(set);
  },

  reorderPages: (fromIndex, toIndex) => {
    const project = get().project;
    if (!project) return;
    const from = normalizeRequestedPageIndex(fromIndex, project.pages.length);
    const to = normalizeRequestedPageIndex(toIndex, project.pages.length);
    if (from === null || to === null) return;
    if (from === to) return;
    const activePageId = project.pages[getActivePageIndex(project)]?.id;
    const pages = [...project.pages];
    const [moved] = pages.splice(from, 1);
    if (!moved) return;
    pages.splice(to, 0, moved);
    const nextActiveIndex = Math.max(
      0,
      pages.findIndex((page) => page.id === activePageId)
    );
    set({
      project: withDerivedDocumentPageSize({
        ...project,
        pages,
        activePageIndex: nextActiveIndex,
      }),
    });
    markDirty(set);
  },

  updatePage: (update, pageId) => {
    const project = get().project;
    if (!project) return;
    const activePage = project.pages[getActivePageIndex(project)];
    const targetId = pageId || activePage?.id;
    const page = project.pages.find((candidate) => candidate.id === targetId);
    if (!page) return;
    const requestedPage = typeof update === 'function'
      ? update(page)
      : { ...page, ...update };
    const nextPage = {
      ...requestedPage,
      titleContent: requestedPage.titleContent === page.titleContent
        ? requestedPage.titleContent
        : normalizeDocumentContentStyles(
            requestedPage.titleContent,
            'article-title'
          ),
      bodyContent: requestedPage.bodyContent === page.bodyContent
        ? requestedPage.bodyContent
        : normalizeDocumentContentStyles(
            requestedPage.bodyContent,
            'body'
          ),
    };
    // Page-level groups are valid only when every member is a unique,
    // page-positioned span image in the resulting stories. Normalize on each
    // write so content edits and metadata edits cannot diverge.
    nextPage.imageGroups = repairDocumentImageGroups(
      nextPage.imageGroups,
      collectGroupableDocumentImageIds([
        nextPage.titleContent,
        nextPage.bodyContent,
      ])
    );
    if (documentPagesAreEquivalent(nextPage, page)) return;
    set({
      project: withDerivedDocumentPageSize({
        ...project,
        pages: project.pages.map((candidate) =>
          candidate.id === page.id ? nextPage : candidate
        ),
      }),
    });
    markDirty(set);
  },

  updateTitleContent: (titleContent, pageId) =>
    get().updatePage({
      titleContent: normalizeDocumentContentStyles(
        titleContent,
        'article-title'
      ),
    }, pageId),
  updateBodyContent: (bodyContent, pageId) =>
    get().updatePage({
      bodyContent: normalizeDocumentContentStyles(bodyContent, 'body'),
    }, pageId),
  commitPageImageState: (pageId, bodyContent, imageGroups) => {
    const project = get().project;
    if (!project) return;
    const page = project.pages.find((candidate) => candidate.id === pageId);
    if (!page) return;
    const normalizedBody = normalizeDocumentContentStyles(bodyContent, 'body');
    get().updatePage({
      bodyContent: normalizedBody,
      imageGroups: imageGroups === undefined
        ? page.imageGroups
        : imageGroups as DocumentPage['imageGroups'],
    }, pageId);
  },
  updateImageGroups: (pageId, imageGroups) => {
    const project = get().project;
    if (!project) return;
    if (!project.pages.some((candidate) => candidate.id === pageId)) return;
    get().updatePage({
      imageGroups: imageGroups as DocumentPage['imageGroups'],
    }, pageId);
  },
  updatePageLanguage: (language, pageId) => {
    const project = get().project;
    if (!project) return;
    const normalized = language === undefined
      ? undefined
      : normalizeDocumentLanguage(language, project.document.language);
    get().updatePage({ language: normalized }, pageId);
  },
  updateDropCap: (update, pageId) => {
    const project = get().project;
    if (!project) return;
    const activePage = project.pages[getActivePageIndex(project)];
    const targetId = pageId || activePage?.id;
    const page = project.pages.find((candidate) => candidate.id === targetId);
    if (!page) return;
    get().updatePage({
      dropCap: normalizeDocumentDropCap(
        { ...page.dropCap, ...update },
        page.dropCap
      ),
    }, targetId);
  },

  addAsset: (assetId, source, metadata = {}) => {
    const project = get().project;
    if (!project) return assetId;
    const contentHash = fingerprintDocumentAssetSource(source);
    const existingId = Object.entries(project.assets || {}).find(
      ([candidateId, candidateSource]) => (
        candidateSource === source
        && (
          project.assetMetadata?.[candidateId]?.contentHash === contentHash
          || !project.assetMetadata?.[candidateId]
        )
      )
    )?.[0];
    const canonicalId = existingId || assetId;
    const nextMetadata = {
      ...(project.assetMetadata || {}),
      [canonicalId]: {
        contentHash,
        byteLength: source.length,
        ...(metadata.mimeType ? { mimeType: metadata.mimeType } : {}),
        ...(metadata.naturalWidth ? { naturalWidth: metadata.naturalWidth } : {}),
        ...(metadata.naturalHeight ? { naturalHeight: metadata.naturalHeight } : {}),
        ...(metadata.fileName ? { fileName: metadata.fileName } : {}),
      },
    };
    if (existingId
      && project.assetMetadata?.[existingId]?.contentHash === contentHash
      && project.assetMetadata?.[existingId]?.byteLength === source.length
    ) return existingId;
    set({
      project: {
        ...project,
        assets: {
          ...(project.assets || {}),
          [canonicalId]: source,
        },
        assetMetadata: nextMetadata,
      },
    });
    markDirty(set);
    return canonicalId;
  },

  inspectAssetReferences: () => {
    const project = get().project;
    if (!project) {
      return {
        reachableAssetIds: [],
        missingAssetIds: [],
        orphanAssetIds: [],
      };
    }
    const reachable = collectDocumentAssetReferences(project.pages);
    const assetIds = Object.keys(project.assets || {});
    return {
      reachableAssetIds: Array.from(reachable).sort(),
      missingAssetIds: findMissingDocumentAssetIds(project.pages, project.assets),
      orphanAssetIds: assetIds
        .filter((assetId) => !reachable.has(assetId))
        .sort(),
    };
  },

  addOverlay: (overlay, pageId) => {
    get().updatePage((page) => {
      const geometry = resolveNewDocumentOverlayGeometry({
        overlay,
        objects: page.overlayObjects,
        bounds: getDocumentOverlayPageBounds(
          page.size.widthIn,
          page.size.heightIn
        ),
      });
      return {
        ...page,
        overlayObjects: [
          ...page.overlayObjects,
          { ...overlay, ...geometry },
        ],
      };
    }, pageId);
    set({ selectedOverlayId: overlay.id, selectedFlowImageId: null });
  },

  updateOverlay: (id, update, pageId) => get().updatePage((page) => ({
    ...page,
    overlayObjects: page.overlayObjects.map((overlay) =>
      overlay.id === id ? { ...overlay, ...update } : overlay
    ),
  }), pageId),

  commitOverlayGeometry: (pageId, id, update) => {
    const project = get().project;
    if (!project) return false;
    const page = project.pages.find((candidate) => candidate.id === pageId);
    const overlay = page?.overlayObjects.find(
      (candidate) => candidate.id === id
    );
    if (!page || !overlay) return false;
    const geometry = commitDocumentOverlayGeometry({
      overlay,
      update,
      objects: page.overlayObjects,
      bounds: getDocumentOverlayPageBounds(
        page.size.widthIn,
        page.size.heightIn
      ),
    });
    get().updatePage((currentPage) => ({
      ...currentPage,
      overlayObjects: currentPage.overlayObjects.map((candidate) =>
        candidate.id === id ? { ...candidate, ...geometry } : candidate
      ),
    }), pageId);
    return true;
  },

  nudgeOverlay: (pageId, id, deltaXPx, deltaYPx) => {
    const project = get().project;
    if (!project) return false;
    const page = project.pages.find((candidate) => candidate.id === pageId);
    const overlay = page?.overlayObjects.find(
      (candidate) => candidate.id === id
    );
    if (!page || !overlay) return false;
    const safeDeltaX = Number.isFinite(deltaXPx) ? deltaXPx : 0;
    const safeDeltaY = Number.isFinite(deltaYPx) ? deltaYPx : 0;
    return get().commitOverlayGeometry(pageId, id, {
      xPx: overlay.xPx + safeDeltaX,
      yPx: overlay.yPx + safeDeltaY,
    });
  },

  removeOverlay: (id, pageId) => {
    get().updatePage((page) => ({
      ...page,
      overlayObjects: page.overlayObjects.filter((overlay) => overlay.id !== id),
    }), pageId);
    if (get().selectedOverlayId === id) set({ selectedOverlayId: null });
  },

  setReference: (reference) => get().updatePage({ reference }),
  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(2, zoom)) }),
  setReferenceAdjustMode: (enabled) => set({
    isReferenceAdjustMode: enabled,
    selectedOverlayId: enabled ? null : get().selectedOverlayId,
  }),
  setSelectedOverlayId: (id) => set({
    selectedOverlayId: id,
    selectedFlowImageId: id ? null : get().selectedFlowImageId,
  }),
  setSelectedFlowImageId: (id) => set({
    selectedFlowImageId: id,
    selectedOverlayId: id ? null : get().selectedOverlayId,
  }),
  setOverflowing: (isOverflowing) => set({ isOverflowing }),
  setToastMessage: (toastMessage) => set({ toastMessage }),

  flushAutosave: async () => {
    const { currentLibraryProjectId, isDirty, project, revision } = get();
    if (!currentLibraryProjectId || !isDirty || !project) return;
    const sessionAtStart = projectSessionToken;
    const payload = updateProjectTimestamp(project);
    set({ project: payload, saveStatus: 'saving' });
    try {
      const { db } = await import('../../editor/db');
      await db.updateProject(
        currentLibraryProjectId,
        payload.projectName,
        JSON.stringify(payload),
        undefined,
        'document'
      );
      if (projectSessionToken !== sessionAtStart) return;
      const hasNewerChanges = get().revision !== revision;
      set({
        ...(hasNewerChanges ? {} : { project: payload }),
        isDirty: hasNewerChanges,
        saveStatus: hasNewerChanges ? 'unsaved' : 'saved',
        ...(hasNewerChanges ? {} : { lastDirtyReason: null }),
      });
      if (hasNewerChanges) queueAutosave();
    } catch (error) {
      console.error('Document autosave failed:', error);
      if (projectSessionToken !== sessionAtStart) return;
      set({
        isDirty: true,
        saveStatus: 'error',
        toastMessage: 'Autosave failed. Your changes remain in this editor.',
      });
    }
  },

  reset: () => {
    cancelAutosave();
    projectSessionToken += 1;
    set(initialState);
  },
}));
