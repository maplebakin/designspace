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
import {
  measureDocumentLiveTextMetric,
  recordDocumentProjectReplacement,
  recordDocumentFastTextCommit,
} from '../services/documentLiveTextDiagnostics';
import { flushDocumentLiveDrafts } from '../services/documentLiveDraft';
import {
  persistenceOperationStillOwnsCurrentState,
  type PersistenceOperationContext,
} from '../../editor/session/persistenceOperation';

export type DocumentSaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';
export type DocumentLifecycleAuthorityMode = 'legacy' | 'shared';
export type DocumentLegacyDirtyReason =
  | 'authored-content'
  | 'navigation-persistence';

type DocumentStoreState = {
  project: DocumentProjectPayload | null;
  currentLibraryProjectId: string | null;
  /** Revision last acknowledged by the browser-library project record. */
  currentLibraryProjectRevision: number | null;
  /** Runtime identity used to distinguish project replacement from page edits. */
  sessionIdentity: string;
  /**
   * Legacy persistence fields. Unified editor chrome reads the shared
   * ProjectLifecycleAuthority; these remain for compatibility and storage
   * execution paths.
   */
  isDirty: boolean;
  saveStatus: DocumentSaveStatus;
  lifecycleAuthorityMode: DocumentLifecycleAuthorityMode;
  /** Runtime-only explanation for the latest legacy dirty transition. */
  lastDirtyReason: DocumentLegacyDirtyReason | null;
  revision: number;
  zoom: number;
  isReferenceAdjustMode: boolean;
  /**
   * Compatibility mirrors for legacy adapters. Document UI selection is
   * projected from the current editor selection in DocumentEditorShell.
   */
  selectedOverlayId: string | null;
  /** @see selectedOverlayId */
  selectedFlowImageId: string | null;
  isOverflowing: boolean;
  toastMessage: string | null;
  createBlankProject: (name?: string) => DocumentProjectPayload;
  hydrateProject: (
    payload: unknown,
    libraryProjectId?: string | null,
    libraryProjectRevision?: number | null
  ) => DocumentProjectPayload;
  loadLibraryProject: (projectId: string) => Promise<void>;
  loadProjectFile: (file: File) => Promise<void>;
  saveProject: (name?: string) => Promise<boolean>;
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
  commitTitleContentSnapshot: (
    pageId: string,
    content: DocumentContentJson
  ) => void;
  commitBodyContentSnapshot: (
    pageId: string,
    content: DocumentContentJson,
    options?: {
      imageGroups?: unknown;
      repairImageGroups?: boolean;
    }
  ) => void;
  commitPageImageState: (
    pageId: string,
    bodyContent: DocumentContentJson,
    imageGroups?: unknown
  ) => void;
  restoreDocumentHistoryProject: (project: DocumentProjectPayload) => void;
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
  addOverlay: (overlay: DocumentOverlayImage, pageId?: string) => boolean;
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
  removeOverlay: (id: string, pageId?: string) => boolean;
  setReference: (reference?: ScanReference, pageId?: string) => void;
  setZoom: (zoom: number) => void;
  setReferenceAdjustMode: (enabled: boolean) => void;
  setSelectedOverlayId: (id: string | null) => void;
  setSelectedFlowImageId: (id: string | null) => void;
  setOverflowing: (overflowing: boolean) => void;
  setToastMessage: (message: string | null) => void;
  flushAutosave: (options?: { allowSharedAuthority?: boolean }) => Promise<boolean>;
  setLifecycleAuthorityMode: (mode: DocumentLifecycleAuthorityMode) => void;
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

const omitEmptyDocumentJsonMetadataRecursive = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(omitEmptyDocumentJsonMetadataRecursive);
  }
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== null && entry !== undefined)
    .map(([key, entry]) => [key, omitEmptyDocumentJsonMetadataRecursive(entry)] as const)
    .filter(([key, entry]) => (
      key !== 'attrs'
      || typeof entry !== 'object'
      || entry === null
      || Object.keys(entry as Record<string, unknown>).length > 0
    ))
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return Object.fromEntries(entries);
};

const omitEmptyDocumentJsonMetadata = (value: unknown): unknown => (
  measureDocumentLiveTextMetric(
    'omitEmptyDocumentJsonMetadata',
    () => omitEmptyDocumentJsonMetadataRecursive(value)
  )
);

const documentPagesAreEquivalent = (
  left: DocumentPage,
  right: DocumentPage
) => measureDocumentLiveTextMetric(
  'documentPagesAreEquivalent',
  () => JSON.stringify(omitEmptyDocumentJsonMetadata(left))
    === JSON.stringify(omitEmptyDocumentJsonMetadata(right))
);

const normalizeDocumentContentStylesMeasured = (
  content: DocumentContentJson,
  region: 'article-title' | 'body'
) => measureDocumentLiveTextMetric(
  'normalizeDocumentContentStyles',
  () => normalizeDocumentContentStyles(content, region)
);

const collectGroupableDocumentImageIdsMeasured = (
  content: readonly DocumentContentJson[]
) => measureDocumentLiveTextMetric(
  'collectGroupableDocumentImageIds',
  () => collectGroupableDocumentImageIds(content)
);

const repairDocumentImageGroupsMeasured = (
  imageGroups: DocumentPage['imageGroups'],
  imageIds: ReturnType<typeof collectGroupableDocumentImageIds>
) => measureDocumentLiveTextMetric(
  'repairDocumentImageGroups',
  () => repairDocumentImageGroups(imageGroups, imageIds)
);

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let navigationPersistenceTimer: ReturnType<typeof setTimeout> | null = null;
let projectSessionToken = 0;
let documentLoadRequestToken = 0;
let documentPersistenceWriteQueue: Promise<void> = Promise.resolve();

type DocumentLibraryDb = {
  updateProject: (...args: unknown[]) => Promise<boolean>;
  saveProject: (...args: unknown[]) => Promise<string>;
  updateProjectIfRevision?: (...args: unknown[]) => Promise<{
    status: 'saved' | 'conflict';
    projectId: string;
    revision?: number;
    expectedRevision?: number;
    actualRevision?: number;
  }>;
  saveProjectWithRevision?: (...args: unknown[]) => Promise<{
    projectId: string;
    revision: number;
  }>;
};

const isDurableRevisionConflict = (error: unknown): error is {
  name: 'ProjectRevisionConflictError';
  projectId: string;
  expectedRevision: number;
  actualRevision: number;
} => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as Record<string, unknown>;
  return candidate.name === 'ProjectRevisionConflictError'
    && typeof candidate.projectId === 'string'
    && typeof candidate.expectedRevision === 'number'
    && typeof candidate.actualRevision === 'number';
};

const saveDocumentLibraryProject = async (
  db: DocumentLibraryDb,
  name: string,
  jsonPayload: string,
  editorMode: 'document',
): Promise<{ projectId: string; revision: number }> => {
  if (typeof db.saveProjectWithRevision === 'function') {
    return db.saveProjectWithRevision(name, jsonPayload, undefined, editorMode);
  }
  return {
    projectId: await db.saveProject(name, jsonPayload, undefined, editorMode),
    revision: 1,
  };
};

const updateDocumentLibraryProject = async (
  db: DocumentLibraryDb,
  projectId: string,
  name: string,
  jsonPayload: string,
  editorMode: 'document',
  expectedRevision: number,
): Promise<number> => {
  if (typeof db.updateProjectIfRevision === 'function') {
    const result = await db.updateProjectIfRevision(
      projectId,
      name,
      jsonPayload,
      undefined,
      editorMode,
      expectedRevision,
    );
    if (result.status === 'conflict') {
      const error = new Error(
        `Project ${projectId} changed in another context (expected revision ${result.expectedRevision}, found ${result.actualRevision}).`
      ) as Error & {
        name: 'ProjectRevisionConflictError';
        projectId: string;
        expectedRevision: number;
        actualRevision: number;
      };
      error.name = 'ProjectRevisionConflictError';
      error.projectId = projectId;
      error.expectedRevision = result.expectedRevision ?? expectedRevision;
      error.actualRevision = result.actualRevision ?? expectedRevision + 1;
      throw error;
    }
    return result.revision ?? expectedRevision + 1;
  }
  await db.updateProject(projectId, name, jsonPayload, undefined, editorMode);
  return expectedRevision + 1;
};

/** Serialize every whole-project Document write to the library row. */
const enqueueDocumentPersistenceWrite = <T>(
  write: () => Promise<T>
): Promise<T> => {
  const queued = documentPersistenceWriteQueue.then(write, write);
  documentPersistenceWriteQueue = queued.then(
    () => undefined,
    () => undefined
  );
  return queued;
};

const cancelAutosave = () => {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
};

const cancelNavigationPersistence = () => {
  if (navigationPersistenceTimer) {
    clearTimeout(navigationPersistenceTimer);
    navigationPersistenceTimer = null;
  }
};

const queueAutosave = () => {
  if (useDocumentStore.getState().lifecycleAuthorityMode === 'shared') return;
  cancelAutosave();
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    if (useDocumentStore.getState().lifecycleAuthorityMode === 'shared') return;
    void useDocumentStore.getState().flushAutosave();
  }, 900);
};

const persistNavigationState = async (): Promise<boolean> => {
  const {
    currentLibraryProjectId,
    currentLibraryProjectRevision,
    isDirty,
    lastDirtyReason,
    project,
    revision,
  } = useDocumentStore.getState();
  if (
    !currentLibraryProjectId
    || !isDirty
    || lastDirtyReason !== 'navigation-persistence'
    || !project
  ) return false;

  const sessionAtStart = projectSessionToken;
  let durableRevision = currentLibraryProjectRevision ?? 1;
  const payload = updateProjectTimestamp(
    compactDocumentProjectForPersistence(project)
  );
  useDocumentStore.setState({ saveStatus: 'saving' });
  try {
    await enqueueDocumentPersistenceWrite(async () => {
      if (projectSessionToken !== sessionAtStart) return false;
      const { db } = await import('../../editor/db');
      durableRevision = await updateDocumentLibraryProject(
        db as DocumentLibraryDb,
        currentLibraryProjectId,
        payload.projectName,
        JSON.stringify(payload),
        'document',
        durableRevision,
      );
    });
    if (projectSessionToken !== sessionAtStart) return false;
    const current = useDocumentStore.getState();
    const hasNewerChanges = current.revision !== revision;
    useDocumentStore.setState({
      ...(hasNewerChanges ? {} : {
        project: {
          ...payload,
          // Compaction is for the durable snapshot. Keep the live asset map
          // intact so an undo/history or a still-mounted editor can recover a
          // source that is no longer reachable from the saved page graph.
          assets: current.project?.assets ?? payload.assets,
          assetMetadata: current.project?.assetMetadata ?? payload.assetMetadata,
        },
      }),
      isDirty: hasNewerChanges,
      saveStatus: hasNewerChanges ? 'unsaved' : 'saved',
      currentLibraryProjectRevision: durableRevision,
      ...(hasNewerChanges ? {} : { lastDirtyReason: null }),
    });
    if (hasNewerChanges) {
      if (current.lastDirtyReason === 'navigation-persistence') {
        queueNavigationPersistence();
      } else if (current.lifecycleAuthorityMode === 'legacy') {
        queueAutosave();
      }
    }
    return true;
  } catch (error) {
    console.error('Document navigation persistence failed:', error);
    if (projectSessionToken !== sessionAtStart) return false;
    useDocumentStore.setState({
      isDirty: true,
      saveStatus: 'error',
      toastMessage: isDurableRevisionConflict(error)
        ? 'This document changed in another window. Reload it before saving again so neither version is lost.'
        : 'Could not persist the active document page.',
    });
    return false;
  }
};

const queueNavigationPersistence = () => {
  cancelNavigationPersistence();
  if (!useDocumentStore.getState().currentLibraryProjectId) return;
  navigationPersistenceTimer = setTimeout(() => {
    navigationPersistenceTimer = null;
    void persistNavigationState();
  }, 900);
};

const markDirty = (
  set: (partial: Partial<DocumentStoreState> | ((state: DocumentStoreState) => Partial<DocumentStoreState>)) => void,
  reason: DocumentLegacyDirtyReason = 'authored-content'
) => {
  const before = useDocumentStore.getState();
  const hadAuthoredDirtyState = before.isDirty
    && before.lastDirtyReason === 'authored-content';
  if (reason === 'authored-content') cancelNavigationPersistence();
  set((state) => ({
    isDirty: true,
    saveStatus: 'unsaved',
    lastDirtyReason: reason,
    revision: state.revision + 1,
  }));
  const current = useDocumentStore.getState();
  if (!current.currentLibraryProjectId) return;
  if (reason === 'navigation-persistence') {
    if (hadAuthoredDirtyState && current.lifecycleAuthorityMode === 'legacy') {
      queueAutosave();
    } else if (!hadAuthoredDirtyState) {
      queueNavigationPersistence();
    }
    return;
  }
  if (current.lifecycleAuthorityMode === 'legacy') queueAutosave();
};

type DocumentTextSnapshotRegion = 'title' | 'body';

const commitDocumentTextSnapshot = (
  set: (
    partial:
      | Partial<DocumentStoreState>
      | ((state: DocumentStoreState) => Partial<DocumentStoreState>)
  ) => void,
  get: () => DocumentStoreState,
  pageId: string,
  region: DocumentTextSnapshotRegion,
  content: DocumentContentJson,
  options: {
    imageGroups?: unknown;
    repairImageGroups?: boolean;
  } = {}
) => {
  const project = get().project;
  if (!project) return false;
  const page = project.pages.find((candidate) => candidate.id === pageId);
  if (!page) return false;
  const currentContent = region === 'title'
    ? page.titleContent
    : page.bodyContent;
  if (currentContent === content && !options.repairImageGroups) return false;

  const nextContent = normalizeDocumentContentStylesMeasured(
    content,
    region === 'title' ? 'article-title' : 'body'
  );
  const nextPage: DocumentPage = {
    ...page,
    ...(region === 'title'
      ? { titleContent: nextContent }
      : { bodyContent: nextContent }),
  };

  if (region === 'body' && options.repairImageGroups) {
    const nextGroups = options.imageGroups === undefined
      ? page.imageGroups
      : options.imageGroups as DocumentPage['imageGroups'];
    nextPage.imageGroups = repairDocumentImageGroupsMeasured(
      nextGroups,
      collectGroupableDocumentImageIdsMeasured([
        nextPage.titleContent,
        nextPage.bodyContent,
      ])
    );
  }

  set({
    project: {
      ...project,
      pages: project.pages.map((candidate) => (
        candidate.id === pageId ? nextPage : candidate
      )),
    },
  });
  recordDocumentProjectReplacement();
  recordDocumentFastTextCommit();
  markDirty(set);
  return true;
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
  currentLibraryProjectRevision: null,
  sessionIdentity: uuidv4(),
  isDirty: false,
  saveStatus: 'saved' as DocumentSaveStatus,
  lifecycleAuthorityMode: 'legacy' as DocumentLifecycleAuthorityMode,
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
    flushDocumentLiveDrafts();
    cancelAutosave();
    cancelNavigationPersistence();
    projectSessionToken += 1;
    documentLoadRequestToken += 1;
    const lifecycleAuthorityMode = get().lifecycleAuthorityMode;
    const project = createBlankDocumentProject(name);
    set({
      ...initialState,
      project,
      lifecycleAuthorityMode,
      sessionIdentity: uuidv4(),
    });
    return project;
  },

  hydrateProject: (payload, libraryProjectId = null, libraryProjectRevision = null) => {
    flushDocumentLiveDrafts();
    cancelAutosave();
    cancelNavigationPersistence();
    projectSessionToken += 1;
    documentLoadRequestToken += 1;
    const lifecycleAuthorityMode = get().lifecycleAuthorityMode;
    const project = normalizeDocumentPayload(payload);
    set({
      ...initialState,
      project,
      currentLibraryProjectId: libraryProjectId,
      currentLibraryProjectRevision: libraryProjectId
        ? libraryProjectRevision ?? null
        : null,
      lifecycleAuthorityMode,
      sessionIdentity: uuidv4(),
    });
    return project;
  },

  loadLibraryProject: async (projectId) => {
    flushDocumentLiveDrafts();
    const requestToken = ++documentLoadRequestToken;
    await documentPersistenceWriteQueue;
    if (requestToken !== documentLoadRequestToken) return;
    const { db } = await import('../../editor/db');
    const result = await db.loadProject(projectId);
    if (!result) throw new Error('Project not found.');
    if (requestToken !== documentLoadRequestToken) return;
    const parsed = JSON.parse(result.canvasData);
    const namedPayload = {
      ...parsed,
      projectName: result.project.name,
      metadata: {
        ...(parsed?.metadata || {}),
        name: result.project.name,
      },
    };
    get().hydrateProject(namedPayload, projectId, result.project.revision ?? 1);
    set({ toastMessage: `Loaded document: ${result.project.name}` });
  },

  loadProjectFile: async (file) => {
    flushDocumentLiveDrafts();
    const requestToken = ++documentLoadRequestToken;
    if (file.size > 100 * 1024 * 1024) {
      throw new Error('Project file exceeds the 100 MB import limit.');
    }
    const parsed = JSON.parse(await file.text());
    const fallbackName = file.name
      .replace(/\.apocaproject\.json$/i, '')
      .replace(/\.json$/i, '');
    const project = normalizeDocumentPayload(parsed, fallbackName);
    if (requestToken !== documentLoadRequestToken) return;
    cancelAutosave();
    cancelNavigationPersistence();
    projectSessionToken += 1;
    const lifecycleAuthorityMode = get().lifecycleAuthorityMode;
    set({
      ...initialState,
      project,
      currentLibraryProjectId: null,
      lifecycleAuthorityMode,
      sessionIdentity: uuidv4(),
      toastMessage: `Opened document: ${project.projectName}`,
    });
  },

  saveProject: async (name) => {
    flushDocumentLiveDrafts();
    cancelAutosave();
    cancelNavigationPersistence();
    const project = get().project;
    if (!project) return false;
    const safeName = name?.trim() || project.projectName.trim() || 'Untitled Document';
    const revisionAtStart = get().revision;
    const sessionAtStart = projectSessionToken;
    const sessionIdentityAtStart = get().sessionIdentity;
    const libraryIdAtStart = get().currentLibraryProjectId;
    const durableRevisionAtStart = get().currentLibraryProjectRevision;
    const operation: PersistenceOperationContext<DocumentProjectPayload> = {
      sessionIdentity: sessionIdentityAtStart,
      projectIdentity: project.projectId,
      targetIdentity: libraryIdAtStart,
      durableRevision: durableRevisionAtStart,
      capturedRevision: revisionAtStart,
      snapshot: updateProjectTimestamp(
        compactDocumentProjectForPersistence(project),
        safeName
      ),
    };
    const payload = updateProjectTimestamp(
      operation.snapshot,
      safeName
    );
    set({ saveStatus: 'saving' });
    try {
      let libraryId = libraryIdAtStart;
      let libraryRevision = durableRevisionAtStart
        ?? (libraryIdAtStart ? 1 : null);
      await enqueueDocumentPersistenceWrite(async () => {
        if (projectSessionToken !== sessionAtStart) return;
        const { db } = await import('../../editor/db');
        // A later manual save/autosave may have queued behind this first-save
        // allocation.  Reuse the target adopted by the earlier completion
        // instead of allocating a second project for the same session.
        libraryId = libraryId || get().currentLibraryProjectId;
        if (libraryId) {
          const existing = await db.loadProject(libraryId);
          if (existing) {
            libraryRevision = libraryRevision
              ?? existing.project.revision
              ?? 1;
            libraryRevision = await updateDocumentLibraryProject(
              db as DocumentLibraryDb,
              libraryId,
              safeName,
              JSON.stringify(payload),
              'document',
              libraryRevision,
            );
          } else {
            libraryId = null;
            libraryRevision = null;
          }
        }
        if (!libraryId) {
          const allocated = await saveDocumentLibraryProject(
            db as DocumentLibraryDb,
            safeName,
            JSON.stringify(payload),
            'document',
          );
          libraryId = allocated.projectId;
          libraryRevision = allocated.revision;
        }
        if (
          libraryId
          && libraryRevision !== null
          && projectSessionToken === sessionAtStart
          && (
            get().currentLibraryProjectId === null
            || get().currentLibraryProjectId === libraryId
          )
        ) {
          set({ currentLibraryProjectRevision: libraryRevision });
        }
        // Publish a newly allocated target before releasing the queue latch so
        // a save already queued behind this one can update the same record.
        // This is target adoption only; the outer completion still decides
        // whether this snapshot may be installed or marked clean.
        if (
          !operation.targetIdentity
          && libraryId
          && projectSessionToken === sessionAtStart
          && get().currentLibraryProjectId === null
        ) {
          set({
            currentLibraryProjectId: libraryId,
            currentLibraryProjectRevision: libraryRevision,
          });
        }
      });
      if (projectSessionToken !== sessionAtStart) return false;
      const current = get();
      const sameSession = current.sessionIdentity === operation.sessionIdentity;
      const targetStillOwned = operation.targetIdentity
        ? current.currentLibraryProjectId === operation.targetIdentity
        : current.currentLibraryProjectId === null
          || current.currentLibraryProjectId === libraryId;
      const ownsCurrentState = sameSession
        && targetStillOwned
        && current.revision === revisionAtStart;
      const hasNewerChanges = current.revision !== revisionAtStart;
      if (!sameSession || !targetStillOwned) return true;
      if (!ownsCurrentState) {
        // A first save establishes the durable target even when the user
        // edits while the allocation is pending. Do not install the older
        // snapshot or clear the newer dirty state.
        if (!operation.targetIdentity && current.currentLibraryProjectId === null) {
          set({
            currentLibraryProjectId: libraryId,
            currentLibraryProjectRevision: libraryRevision,
            isDirty: true,
            saveStatus: 'unsaved',
          });
        }
        return true;
      }
      set({
        ...(!hasNewerChanges && current.project
          ? {
              project: {
                ...payload,
                // Compaction is a persisted-payload concern. Keep orphaned
                // bytes in the live session while renderer history can still
                // restore their stable IDs.
                assets: current.project.assets,
                assetMetadata: current.project.assetMetadata,
              },
            }
          : {}),
        ...(ownsCurrentState ? {
          currentLibraryProjectId: libraryId,
          currentLibraryProjectRevision: libraryRevision,
        } : {}),
        isDirty: hasNewerChanges,
        saveStatus: hasNewerChanges ? 'unsaved' : 'saved',
        ...(hasNewerChanges ? {} : { lastDirtyReason: null }),
        toastMessage: `Saved document: ${safeName}`,
      });
      if (
        hasNewerChanges
        && get().lifecycleAuthorityMode === 'legacy'
      ) queueAutosave();
      return true;
    } catch (error) {
      console.error('Failed to save document project:', error);
      if (projectSessionToken !== sessionAtStart) return false;
      if (isDurableRevisionConflict(error)) {
        set({
          saveStatus: 'error',
          isDirty: true,
          toastMessage: 'This project changed in another window. Reload it before saving again so neither version is lost.',
        });
        return false;
      }
      set({
        saveStatus: 'error',
        isDirty: true,
        toastMessage: 'Failed to save the document project.',
      });
      return false;
    }
  },

  downloadProjectFile: async () => {
    flushDocumentLiveDrafts();
    const project = get().project;
    if (!project) return null;
    const operation: PersistenceOperationContext<DocumentProjectPayload> = {
      sessionIdentity: get().sessionIdentity,
      projectIdentity: project.projectId,
      targetIdentity: get().currentLibraryProjectId,
      capturedRevision: get().revision,
      snapshot: project,
    };
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
    const current = get();
    if (!persistenceOperationStillOwnsCurrentState(operation, {
      sessionIdentity: current.sessionIdentity,
      projectIdentity: current.project?.projectId || '',
      targetIdentity: current.currentLibraryProjectId,
      revision: current.revision,
    })) {
      return delivery;
    }
    if (delivery.status === 'saved') {
      set({
        isDirty: false,
        saveStatus: 'saved',
        lastDirtyReason: null,
        toastMessage: delivery.path
          ? `Downloaded project to ${delivery.path}`
          : `Downloaded project: ${payload.projectName}`,
      });
    } else {
      set({
        saveStatus: 'unsaved',
        toastMessage: 'Project download started. Keep the editor open until the browser finishes saving it.',
      });
    }
    return delivery;
  },

  renameProject: (name) => {
    flushDocumentLiveDrafts();
    const project = get().project;
    const safeName = name.trim() || 'Untitled Document';
    if (!project || project.projectName === safeName) return;
    set({ project: updateProjectTimestamp(project, safeName) });
    markDirty(set);
  },

  updateDocumentBackground: (value) => {
    flushDocumentLiveDrafts();
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
    flushDocumentLiveDrafts();
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
    flushDocumentLiveDrafts();
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
    flushDocumentLiveDrafts();
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
    flushDocumentLiveDrafts();
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
    flushDocumentLiveDrafts();
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
    flushDocumentLiveDrafts();
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
    flushDocumentLiveDrafts();
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
    flushDocumentLiveDrafts();
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

  updatePage: (update, pageId) => measureDocumentLiveTextMetric(
    'updatePage',
    () => {
    flushDocumentLiveDrafts();
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
        : normalizeDocumentContentStylesMeasured(
            requestedPage.titleContent,
            'article-title'
          ),
      bodyContent: requestedPage.bodyContent === page.bodyContent
        ? requestedPage.bodyContent
        : normalizeDocumentContentStylesMeasured(
            requestedPage.bodyContent,
            'body'
          ),
    };
    // Page-level groups are valid only when every member is a unique,
    // page-positioned span image in the resulting stories. Normalize on each
    // write so content edits and metadata edits cannot diverge.
    nextPage.imageGroups = repairDocumentImageGroupsMeasured(
      nextPage.imageGroups,
      collectGroupableDocumentImageIdsMeasured([
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
    recordDocumentProjectReplacement();
    markDirty(set);
    }
  ),

  updateTitleContent: (titleContent, pageId) => measureDocumentLiveTextMetric(
    'updateTitleContent',
    () => {
      const project = get().project;
      if (!project) return;
      const activePage = project.pages[getActivePageIndex(project)];
      const targetPageId = pageId || activePage?.id;
      if (!targetPageId) return;
      commitDocumentTextSnapshot(
        set,
        get,
        targetPageId,
        'title',
        titleContent
      );
    }
  ),
  updateBodyContent: (bodyContent, pageId) => measureDocumentLiveTextMetric(
    'updateBodyContent',
    () => {
      const project = get().project;
      if (!project) return;
      const activePage = project.pages[getActivePageIndex(project)];
      const targetPageId = pageId || activePage?.id;
      if (!targetPageId) return;
      commitDocumentTextSnapshot(
        set,
        get,
        targetPageId,
        'body',
        bodyContent,
        { repairImageGroups: true }
      );
    }
  ),
  commitTitleContentSnapshot: (pageId, titleContent) => {
    commitDocumentTextSnapshot(set, get, pageId, 'title', titleContent);
  },
  commitBodyContentSnapshot: (pageId, bodyContent, options) => {
    commitDocumentTextSnapshot(set, get, pageId, 'body', bodyContent, options);
  },
  commitPageImageState: (pageId, bodyContent, imageGroups) => {
    commitDocumentTextSnapshot(set, get, pageId, 'body', bodyContent, {
      imageGroups,
      repairImageGroups: true,
    });
  },
  restoreDocumentHistoryProject: (project) => {
    cancelAutosave();
    cancelNavigationPersistence();
    set((state) => ({
      project,
      isDirty: true,
      saveStatus: 'unsaved',
      lastDirtyReason: 'authored-content',
      revision: state.revision + 1,
      isReferenceAdjustMode: false,
      selectedOverlayId: null,
      selectedFlowImageId: null,
      isOverflowing: false,
    }));
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
    flushDocumentLiveDrafts();
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
    const project = get().project;
    if (!project || !overlay.id.trim()) return false;
    const activePage = project.pages[getActivePageIndex(project)];
    const targetPageId = pageId || activePage?.id;
    const page = project.pages.find((candidate) => candidate.id === targetPageId);
    if (!page || page.overlayObjects.some((candidate) => candidate.id === overlay.id)) {
      return false;
    }
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
    }, targetPageId);
    const committed = get().project?.pages
      .find((candidate) => candidate.id === targetPageId)
      ?.overlayObjects.some((candidate) => candidate.id === overlay.id) === true;
    if (!committed) return false;
    set({ selectedOverlayId: overlay.id, selectedFlowImageId: null });
    return true;
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
    // `updatePage` already treats an equivalent page as a no-op. Keep the
    // return value aligned with that behavior so passive observers do not
    // report a geometry commit that never changed authored state.
    if (
      geometry.xPx === overlay.xPx
      && geometry.yPx === overlay.yPx
      && geometry.widthPx === overlay.widthPx
      && geometry.heightPx === overlay.heightPx
    ) {
      return false;
    }
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
    const project = get().project;
    if (!project) return false;
    const activePage = project.pages[getActivePageIndex(project)];
    const targetPageId = pageId || activePage?.id;
    const page = project.pages.find((candidate) => candidate.id === targetPageId);
    if (!page || !page.overlayObjects.some((overlay) => overlay.id === id)) {
      return false;
    }
    get().updatePage((page) => ({
      ...page,
      overlayObjects: page.overlayObjects.filter((overlay) => overlay.id !== id),
    }), targetPageId);
    const committedPage = get().project?.pages
      .find((candidate) => candidate.id === targetPageId);
    if (!committedPage || committedPage.overlayObjects.some((overlay) => overlay.id === id)) {
      return false;
    }
    if (get().selectedOverlayId === id) set({ selectedOverlayId: null });
    return true;
  },

  setReference: (reference, pageId) => get().updatePage({ reference }, pageId),
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

  flushAutosave: async (options) => {
    flushDocumentLiveDrafts();
    cancelNavigationPersistence();
    const {
      currentLibraryProjectId,
      currentLibraryProjectRevision,
      isDirty,
      project,
      revision,
      lifecycleAuthorityMode,
    } = get();
    if (
      (lifecycleAuthorityMode === 'shared' && !options?.allowSharedAuthority)
      || !currentLibraryProjectId
      || !isDirty
      || !project
    ) return false;
    const sessionAtStart = projectSessionToken;
    let durableRevision = currentLibraryProjectRevision ?? 1;
    const payload = updateProjectTimestamp(
      compactDocumentProjectForPersistence(project)
    );
    set({ saveStatus: 'saving' });
    try {
      await enqueueDocumentPersistenceWrite(async () => {
        if (projectSessionToken !== sessionAtStart) return;
        const { db } = await import('../../editor/db');
        durableRevision = await updateDocumentLibraryProject(
          db as DocumentLibraryDb,
          currentLibraryProjectId,
          payload.projectName,
          JSON.stringify(payload),
          'document',
          durableRevision,
        );
      });
      if (projectSessionToken !== sessionAtStart) return false;
      const hasNewerChanges = get().revision !== revision;
      const current = get();
      set({
        ...(hasNewerChanges ? {} : {
          project: {
            ...payload,
            // Keep live bytes for the mounted session; only the durable
            // payload is compacted.
            assets: current.project?.assets ?? payload.assets,
            assetMetadata: current.project?.assetMetadata ?? payload.assetMetadata,
          },
        }),
        isDirty: hasNewerChanges,
        saveStatus: hasNewerChanges ? 'unsaved' : 'saved',
        currentLibraryProjectRevision: durableRevision,
        ...(hasNewerChanges ? {} : { lastDirtyReason: null }),
      });
      if (hasNewerChanges && get().lifecycleAuthorityMode === 'legacy') {
        queueAutosave();
      }
      return true;
    } catch (error) {
      console.error('Document autosave failed:', error);
      if (projectSessionToken !== sessionAtStart) return false;
      set({
        isDirty: true,
        saveStatus: 'error',
        toastMessage: isDurableRevisionConflict(error)
          ? 'This document changed in another window. Reload it before saving again so neither version is lost.'
          : 'Autosave failed. Your changes remain in this editor.',
      });
      return false;
    }
  },

  setLifecycleAuthorityMode: (mode) => {
    if (mode === 'shared') cancelAutosave();
    set({ lifecycleAuthorityMode: mode });
  },

  reset: () => {
    flushDocumentLiveDrafts();
    cancelAutosave();
    cancelNavigationPersistence();
    projectSessionToken += 1;
    documentLoadRequestToken += 1;
    set({ ...initialState, sessionIdentity: uuidv4() });
  },
}));
