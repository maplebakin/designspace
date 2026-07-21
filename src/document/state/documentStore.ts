import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import {
  DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
  normalizeDesignSpaceProjectPayload,
  type DocumentProjectPayload,
} from '../../editor/project/projectSchema';
import type {
  DocumentContentJson,
  DocumentOverlayImage,
  DocumentPage,
  ScanReference,
} from '../types/documentProject';

export type DocumentSaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

type DocumentStoreState = {
  project: DocumentProjectPayload | null;
  currentLibraryProjectId: string | null;
  isDirty: boolean;
  saveStatus: DocumentSaveStatus;
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
  downloadProjectFile: () => Promise<void>;
  renameProject: (name: string) => void;
  updatePage: (update: Partial<DocumentPage> | ((page: DocumentPage) => DocumentPage)) => void;
  updateTitleContent: (content: DocumentContentJson) => void;
  updateBodyContent: (content: DocumentContentJson) => void;
  addAsset: (assetId: string, source: string) => void;
  addOverlay: (overlay: DocumentOverlayImage) => void;
  updateOverlay: (id: string, update: Partial<DocumentOverlayImage>) => void;
  removeOverlay: (id: string) => void;
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

const emptyDocumentContent = (): DocumentContentJson => ({
  type: 'doc',
  content: [{ type: 'paragraph' }],
});

export const createBlankDocumentPage = (): DocumentPage => ({
  kind: 'document',
  id: uuidv4(),
  name: 'Page 1',
  size: {
    presetId: 'letter',
    orientation: 'portrait',
    widthIn: 8.5,
    heightIn: 11,
    dpi: 300,
  },
  margins: {
    topIn: 0.65,
    rightIn: 0.65,
    bottomIn: 0.65,
    leftIn: 0.65,
  },
  titleContent: emptyDocumentContent(),
  bodyContent: emptyDocumentContent(),
  titleFontSizePx: 38,
  columnCount: 1,
  columnGapPx: 24,
  dropCap: false,
  overlayObjects: [],
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
    pages: [createBlankDocumentPage()],
    assets: {},
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
  if (normalized.pages.length !== 1 || normalized.pages[0]?.kind !== 'document') {
    throw new Error('Document projects must contain exactly one document page in this version.');
  }
  return normalized as DocumentProjectPayload;
};

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
  set: (partial: Partial<DocumentStoreState> | ((state: DocumentStoreState) => Partial<DocumentStoreState>)) => void
) => {
  set((state) => ({
    isDirty: true,
    saveStatus: 'unsaved',
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

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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
    const payload = updateProjectTimestamp(project, safeName);
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
    if (!project) return;
    const payload = updateProjectTimestamp(project);
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      safeProjectFileName(payload.projectName)
    );
    set({
      project: payload,
      isDirty: false,
      saveStatus: 'saved',
      toastMessage: `Downloaded project: ${payload.projectName}`,
    });
  },

  renameProject: (name) => {
    const project = get().project;
    const safeName = name.trim() || 'Untitled Document';
    if (!project || project.projectName === safeName) return;
    set({ project: updateProjectTimestamp(project, safeName) });
    markDirty(set);
  },

  updatePage: (update) => {
    const project = get().project;
    const page = project?.pages[0];
    if (!project || !page) return;
    const nextPage = typeof update === 'function'
      ? update(page)
      : { ...page, ...update };
    set({
      project: {
        ...project,
        pages: [nextPage],
      },
    });
    markDirty(set);
  },

  updateTitleContent: (titleContent) => get().updatePage({ titleContent }),
  updateBodyContent: (bodyContent) => get().updatePage({ bodyContent }),

  addAsset: (assetId, source) => {
    const project = get().project;
    if (!project) return;
    set({
      project: {
        ...project,
        assets: {
          ...(project.assets || {}),
          [assetId]: source,
        },
      },
    });
    markDirty(set);
  },

  addOverlay: (overlay) => {
    get().updatePage((page) => ({
      ...page,
      overlayObjects: [...page.overlayObjects, overlay],
    }));
    set({ selectedOverlayId: overlay.id, selectedFlowImageId: null });
  },

  updateOverlay: (id, update) => get().updatePage((page) => ({
    ...page,
    overlayObjects: page.overlayObjects.map((overlay) =>
      overlay.id === id ? { ...overlay, ...update } : overlay
    ),
  })),

  removeOverlay: (id) => {
    get().updatePage((page) => ({
      ...page,
      overlayObjects: page.overlayObjects.filter((overlay) => overlay.id !== id),
    }));
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
