import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DOCUMENT_EXPORT_EXCLUDE_ATTRIBUTE,
  createCleanDocumentClone,
} from '../src/document/services/documentExportService';
import {
  createBlankDocumentProject,
  useDocumentStore,
} from '../src/document/state/documentStore';
import type {
  DocumentContentJson,
  DocumentOverlayImage,
  ScanReference,
} from '../src/document/types/documentProject';
import {
  DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
  normalizeDocumentProjectPage,
} from '../src/editor/project/projectSchema';
import {
  updateDocumentPagePaper,
} from '../src/document/utils/documentPageOrientation';
import {
  DEFAULT_DOCUMENT_PAPER_COLOR,
  normalizeDocumentPaperColor,
  parseDocumentColor,
} from '../src/document/utils/documentColor';

const dbMocks = vi.hoisted(() => ({
  loadProject: vi.fn(),
  saveProject: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock('../src/editor/db', () => ({
  db: dbMocks,
}));

const NOW = '2026-07-20T14:30:00.000Z';

const bodyContent = (text: string): DocumentContentJson => ({
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [{ type: 'text', text }],
  }],
});

const spanningBodyContent = (): DocumentContentJson => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Article before image' }],
    },
    {
      type: 'documentFlowImage',
      attrs: {
        id: 'span-photo',
        assetId: 'asset-family',
        altText: 'Family photograph',
        widthPx: 540,
        heightPx: 360,
        naturalWidth: 1200,
        naturalHeight: 800,
        wrap: 'span-columns',
        spanCount: 2,
        spanStartColumn: 2,
        wrapPaddingPx: 12,
        verticalSpacingPx: 20,
        verticalAnchor: 'page-position',
        yPx: 286,
        caption: 'Family photograph caption',
      },
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Article after image' }],
    },
  ],
});

const overlay: DocumentOverlayImage = {
  id: 'overlay-family',
  assetId: 'asset-family',
  altText: 'Family at the lake',
  xPx: 72,
  yPx: 96,
  widthPx: 320,
  heightPx: 240,
  placement: 'front',
  caption: 'Summer, 1978',
  naturalWidth: 1280,
  naturalHeight: 960,
};

const reference: ScanReference = {
  assetId: 'asset-scan',
  sourceType: 'image',
  opacity: 0.4,
  fit: 'contain',
  scale: 1,
  offsetXPx: 0,
  offsetYPx: 0,
  visible: true,
  locked: true,
};

describe('document project store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    useDocumentStore.getState().reset();
    vi.clearAllMocks();
    dbMocks.loadProject.mockResolvedValue(null);
    dbMocks.saveProject.mockResolvedValue('library-document-1');
    dbMocks.updateProject.mockResolvedValue(undefined);
  });

  afterEach(() => {
    useDocumentStore.getState().reset();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('creates a blank one-page document with print-friendly defaults', () => {
    const project = useDocumentStore.getState().createBlankProject();
    const page = project.pages[0];

    expect(project).toMatchObject({
      schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      editorMode: 'document',
      projectName: 'Untitled Document',
      createdAt: NOW,
      updatedAt: NOW,
      lastUpdated: NOW,
      metadata: {
        name: 'Untitled Document',
        slug: 'untitled-document',
        sourceApp: 'design-space',
      },
      assets: {},
      document: {
        background: {
          value: DEFAULT_DOCUMENT_PAPER_COLOR,
        },
      },
    });
    expect(project.projectId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(project.pages).toHaveLength(1);
    expect(page).toMatchObject({
      kind: 'document',
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
      titleContent: {
        type: 'doc',
        content: [{ type: 'paragraph' }],
      },
      bodyContent: {
        type: 'doc',
        content: [{ type: 'paragraph' }],
      },
      titleFontSizePx: 38,
      columnCount: 1,
      columnGapPx: 24,
      dropCap: false,
      overlayObjects: [],
    });
    expect(page.reference).toBeUndefined();
    expect(useDocumentStore.getState()).toMatchObject({
      isDirty: false,
      saveStatus: 'saved',
      revision: 0,
      zoom: 0.75,
    });
  });

  it('accepts only bounded hex paper colours and marks valid changes dirty', () => {
    const store = useDocumentStore.getState();
    store.createBlankProject('Paper Test');

    expect(parseDocumentColor('#abc')).toBe('#AABBCC');
    expect(parseDocumentColor(' #e7dcc8 ')).toBe('#E7DCC8');
    expect(parseDocumentColor('rgb(231, 220, 200)')).toBeNull();
    expect(parseDocumentColor('url(javascript:alert(1))')).toBeNull();
    expect(normalizeDocumentPaperColor('not-a-colour')).toBe(
      DEFAULT_DOCUMENT_PAPER_COLOR
    );
    expect(normalizeDocumentPaperColor(null, '#abc')).toBe('#AABBCC');

    store.updateDocumentBackground('#e7dcc8');

    expect(useDocumentStore.getState()).toMatchObject({
      project: {
        document: {
          background: {
            value: '#E7DCC8',
          },
        },
      },
      isDirty: true,
      saveStatus: 'unsaved',
      revision: 1,
    });

    store.updateDocumentBackground('linear-gradient(red, blue)');

    expect(useDocumentStore.getState()).toMatchObject({
      project: {
        document: {
          background: {
            value: '#E7DCC8',
          },
        },
      },
      isDirty: true,
      saveStatus: 'unsaved',
      revision: 1,
      toastMessage: 'Paper colour must be a three- or six-digit hex colour.',
    });
  });

  it('persists paper colour through save, library reload, and portable project reopen', async () => {
    const store = useDocumentStore.getState();
    store.createBlankProject('Cream Archive');
    store.updateDocumentBackground('#e7dcc8');

    await store.saveProject();

    const serialized = dbMocks.saveProject.mock.calls[0][1] as string;
    expect(JSON.parse(serialized).document.background.value).toBe('#E7DCC8');

    dbMocks.loadProject.mockResolvedValueOnce({
      project: {
        id: 'library-document-1',
        name: 'Cream Archive',
      },
      canvasData: serialized,
    });
    useDocumentStore.getState().reset();
    await useDocumentStore.getState().loadLibraryProject('library-document-1');

    expect(
      useDocumentStore.getState().project?.document.background?.value
    ).toBe('#E7DCC8');
    expect(useDocumentStore.getState()).toMatchObject({
      isDirty: false,
      saveStatus: 'saved',
    });

    useDocumentStore.getState().reset();
    await useDocumentStore.getState().loadProjectFile({
      name: 'cream-archive.apocaproject.json',
      size: serialized.length,
      text: vi.fn().mockResolvedValue(serialized),
    } as unknown as File);

    expect(
      useDocumentStore.getState().project?.document.background?.value
    ).toBe('#E7DCC8');
    expect(useDocumentStore.getState()).toMatchObject({
      currentLibraryProjectId: null,
      isDirty: false,
      saveStatus: 'saved',
    });
  });

  it('safely normalizes malformed persisted document paper colours', () => {
    const project = createBlankDocumentProject('Malformed Paper');
    const hydrated = useDocumentStore.getState().hydrateProject({
      ...project,
      document: {
        ...project.document,
        background: {
          value: 'url(javascript:alert(1))',
        },
      },
    });

    expect(hydrated.document.background?.value).toBe(
      DEFAULT_DOCUMENT_PAPER_COLOR
    );
    expect(useDocumentStore.getState()).toMatchObject({
      isDirty: false,
      saveStatus: 'saved',
      revision: 0,
    });
  });

  it('mutates page settings, content, overlays, references, and assets as project data', () => {
    const store = useDocumentStore.getState();
    store.createBlankProject('Family Archive');

    store.updatePage({
      name: 'Translated article',
      size: { presetId: 'a4', widthIn: 8.27, heightIn: 11.69, dpi: 300 },
      margins: { topIn: 0.8, rightIn: 0.7, bottomIn: 0.75, leftIn: 0.7 },
      titleFontSizePx: 52,
      columnCount: 3,
      columnGapPx: 30,
      dropCap: true,
    });
    store.updateTitleContent(bodyContent('Our Family History'));
    store.updateBodyContent(bodyContent('The translated article.'));
    store.addAsset('asset-family', 'data:image/png;base64,PHOTO');
    store.addAsset('asset-scan', 'data:image/jpeg;base64,SCAN');
    store.addOverlay(overlay);
    store.updateOverlay(overlay.id, {
      placement: 'behind',
      xPx: 88,
      locked: true,
    });
    store.setReference(reference);

    const state = useDocumentStore.getState();
    expect(state.project?.assets).toEqual({
      'asset-family': 'data:image/png;base64,PHOTO',
      'asset-scan': 'data:image/jpeg;base64,SCAN',
    });
    expect(state.project?.pages[0]).toMatchObject({
      name: 'Translated article',
      size: { presetId: 'a4', widthIn: 8.27, heightIn: 11.69, dpi: 300 },
      margins: { topIn: 0.8, rightIn: 0.7, bottomIn: 0.75, leftIn: 0.7 },
      titleFontSizePx: 52,
      columnCount: 3,
      columnGapPx: 30,
      dropCap: true,
      titleContent: bodyContent('Our Family History'),
      bodyContent: bodyContent('The translated article.'),
      overlayObjects: [{
        ...overlay,
        placement: 'behind',
        xPx: 88,
        locked: true,
      }],
      reference,
    });
    expect(state.selectedOverlayId).toBe(overlay.id);
    expect(state.isDirty).toBe(true);
    expect(state.saveStatus).toBe('unsaved');
    expect(state.revision).toBe(8);

    state.removeOverlay(overlay.id);
    expect(useDocumentStore.getState().project?.pages[0].overlayObjects).toEqual([]);
    expect(useDocumentStore.getState().selectedOverlayId).toBeNull();
  });

  it('persists a discriminated v2 document shape and reloads it from the library', async () => {
    const store = useDocumentStore.getState();
    store.createBlankProject('Draft');
    store.updateBodyContent(bodyContent('Saved body'));
    store.addAsset('asset-family', 'data:image/png;base64,PHOTO');
    store.addOverlay(overlay);
    store.setReference(reference);

    await store.saveProject('Field Notes');

    expect(dbMocks.saveProject).toHaveBeenCalledWith(
      'Field Notes',
      expect.any(String),
      undefined,
      'document'
    );
    const serialized = dbMocks.saveProject.mock.calls[0][1] as string;
    const persisted = JSON.parse(serialized);
    expect(persisted).toMatchObject({
      schemaVersion: 'design-space-project-v2',
      editorMode: 'document',
      projectName: 'Field Notes',
      metadata: {
        name: 'Field Notes',
        sourceApp: 'design-space',
      },
      assets: {
        'asset-family': 'data:image/png;base64,PHOTO',
      },
      pages: [{
        kind: 'document',
        bodyContent: bodyContent('Saved body'),
        overlayObjects: [overlay],
        reference,
      }],
    });
    expect(persisted.pages).toHaveLength(1);
    expect(useDocumentStore.getState()).toMatchObject({
      currentLibraryProjectId: 'library-document-1',
      isDirty: false,
      saveStatus: 'saved',
      toastMessage: 'Saved document: Field Notes',
    });

    dbMocks.loadProject.mockResolvedValueOnce({
      project: {
        id: 'library-document-1',
        name: 'Field Notes',
      },
      canvasData: serialized,
    });
    useDocumentStore.getState().reset();
    await useDocumentStore.getState().loadLibraryProject('library-document-1');

    const reloaded = useDocumentStore.getState();
    expect(reloaded.project).toMatchObject(persisted);
    expect(reloaded.project?.pages[0].reference?.locked).toBe(true);
    expect(reloaded.currentLibraryProjectId).toBe('library-document-1');
    expect(reloaded.isDirty).toBe(false);
    expect(reloaded.saveStatus).toBe('saved');
    expect(reloaded.toastMessage).toBe('Loaded document: Field Notes');
  });

  it('loads previous v2 document projects from the library and project files', async () => {
    const legacyBody = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Legacy article introduction.' }],
        },
        {
          type: 'documentFlowImage',
          attrs: {
            id: 'legacy-photo',
            assetId: 'legacy-asset',
            altText: 'Legacy family photograph',
            widthPx: 240,
            heightPx: 160,
            wrap: 'float-left',
            wrapPaddingPx: 12,
            caption: 'Original caption',
          },
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Legacy article conclusion.' }],
        },
      ],
    } satisfies DocumentContentJson;
    const legacyPayload = {
      schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      editorMode: 'document',
      projectId: 'legacy-document-project',
      projectName: 'Previous Family Article',
      pages: [{
        id: 'legacy-document-page',
        name: 'Article',
        size: {
          presetId: 'letter',
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
        titleContent: bodyContent('A Previous Project'),
        bodyContent: legacyBody,
        columnCount: 3,
        columnGapPx: 24,
        dropCap: true,
        overlayObjects: [],
      }],
      assets: {
        'legacy-asset': 'data:image/png;base64,LEGACY',
      },
      lastUpdated: '2025-01-15T12:00:00.000Z',
    };

    dbMocks.loadProject.mockResolvedValueOnce({
      project: {
        id: 'legacy-library-id',
        name: 'Previous Family Article',
      },
      canvasData: JSON.stringify(legacyPayload),
    });
    await useDocumentStore.getState().loadLibraryProject('legacy-library-id');

    expect(useDocumentStore.getState()).toMatchObject({
      currentLibraryProjectId: 'legacy-library-id',
      isDirty: false,
      saveStatus: 'saved',
    });
    expect(useDocumentStore.getState().project?.pages[0]).toMatchObject({
      kind: 'document',
      id: 'legacy-document-page',
      size: {
        presetId: 'letter',
        orientation: 'portrait',
        widthIn: 8.5,
        heightIn: 11,
      },
      titleFontSizePx: 42,
      columnCount: 3,
      bodyContent: legacyBody,
    });

    useDocumentStore.getState().reset();
    const serializedLegacyPayload = JSON.stringify(legacyPayload);
    await useDocumentStore.getState().loadProjectFile({
      name: 'previous-family-article.apocaproject.json',
      size: serializedLegacyPayload.length,
      text: vi.fn().mockResolvedValue(serializedLegacyPayload),
    } as unknown as File);
    expect(useDocumentStore.getState()).toMatchObject({
      currentLibraryProjectId: null,
      isDirty: false,
      saveStatus: 'saved',
      toastMessage: 'Opened document: Previous Family Article',
    });
    expect(useDocumentStore.getState().project?.pages[0]).toMatchObject({
      kind: 'document',
      size: {
        orientation: 'portrait',
      },
      bodyContent: legacyBody,
    });
  });

  it('persists landscape orientation through save, reload, and serialized project data', async () => {
    const store = useDocumentStore.getState();
    store.createBlankProject('Landscape Notes');
    store.updatePage((page) => updateDocumentPagePaper(page, {
      orientation: 'landscape',
    }));

    await store.saveProject();

    const serialized = dbMocks.saveProject.mock.calls[0][1] as string;
    const persisted = JSON.parse(serialized);
    expect(persisted.pages[0].size).toMatchObject({
      presetId: 'letter',
      orientation: 'landscape',
      widthIn: 11,
      heightIn: 8.5,
    });

    dbMocks.loadProject.mockResolvedValueOnce({
      project: {
        id: 'library-document-1',
        name: 'Landscape Notes',
      },
      canvasData: serialized,
    });
    useDocumentStore.getState().reset();
    await useDocumentStore.getState().loadLibraryProject('library-document-1');

    expect(useDocumentStore.getState().project?.pages[0].size).toMatchObject({
      presetId: 'letter',
      orientation: 'landscape',
      widthIn: 11,
      heightIn: 8.5,
    });
  });

  it('round-trips structured spanning image data through save and reload', async () => {
    const store = useDocumentStore.getState();
    const originalContent = spanningBodyContent();
    const anchoredContent = {
      ...originalContent,
      content: [
        originalContent.content![0],
        originalContent.content![2],
        originalContent.content![1],
      ],
    };
    store.createBlankProject('Spanning Article');
    store.updatePage({
      columnCount: 3,
      bodyContent: anchoredContent,
    });
    store.addAsset('asset-family', 'data:image/png;base64,PHOTO');

    await store.saveProject();
    const serialized = dbMocks.saveProject.mock.calls[0][1] as string;
    const persisted = JSON.parse(serialized);
    expect(persisted.pages[0].bodyContent).toEqual(anchoredContent);

    dbMocks.loadProject.mockResolvedValueOnce({
      project: { id: 'library-document-1', name: 'Spanning Article' },
      canvasData: serialized,
    });
    useDocumentStore.getState().reset();
    await useDocumentStore.getState().loadLibraryProject('library-document-1');

    expect(useDocumentStore.getState().project?.pages[0]).toMatchObject({
      columnCount: 3,
      bodyContent: anchoredContent,
    });
  });

  it('autosaves dirty library documents after the debounce and preserves document routing', async () => {
    const existing = createBlankDocumentProject('Existing Document');
    useDocumentStore.getState().hydrateProject(existing, 'existing-library-id');
    useDocumentStore.getState().updatePage({
      dropCap: true,
      columnCount: 2,
    });
    useDocumentStore.getState().updatePage((page) =>
      updateDocumentPagePaper(page, { orientation: 'landscape' })
    );
    useDocumentStore.getState().updateDocumentBackground('#e7dcc8');

    await vi.advanceTimersByTimeAsync(899);
    expect(dbMocks.updateProject).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(dbMocks.updateProject).toHaveBeenCalledWith(
      'existing-library-id',
      'Existing Document',
      expect.any(String),
      undefined,
      'document'
    );
    const autosaved = JSON.parse(dbMocks.updateProject.mock.calls[0][2] as string);
    expect(autosaved).toMatchObject({
      schemaVersion: 'design-space-project-v2',
      editorMode: 'document',
      pages: [{
        kind: 'document',
        dropCap: true,
        columnCount: 2,
        size: {
          orientation: 'landscape',
          widthIn: 11,
          heightIn: 8.5,
        },
      }],
      document: {
        background: {
          value: '#E7DCC8',
        },
      },
    });
    expect(useDocumentStore.getState()).toMatchObject({
      isDirty: false,
      saveStatus: 'saved',
    });
  });

  it('never overwrites edits made while an autosave write is in flight', async () => {
    let finishWrite: (() => void) | undefined;
    dbMocks.updateProject.mockReturnValueOnce(new Promise<void>((resolve) => {
      finishWrite = resolve;
    }));
    const existing = createBlankDocumentProject('Concurrent Document');
    useDocumentStore.getState().hydrateProject(existing, 'concurrent-library-id');
    useDocumentStore.getState().updatePage({ columnCount: 2 });

    await vi.advanceTimersByTimeAsync(900);
    expect(dbMocks.updateProject).toHaveBeenCalledTimes(1);

    useDocumentStore.getState().setReference(reference);
    useDocumentStore.getState().updatePage({ columnCount: 3 });
    finishWrite?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(useDocumentStore.getState().project?.pages[0]).toMatchObject({
      columnCount: 3,
      reference,
    });
    expect(useDocumentStore.getState()).toMatchObject({
      isDirty: true,
      saveStatus: 'unsaved',
    });
  });

  it('ignores a completed autosave from a project session that has been replaced', async () => {
    let finishWrite: (() => void) | undefined;
    dbMocks.updateProject.mockReturnValueOnce(new Promise<void>((resolve) => {
      finishWrite = resolve;
    }));
    useDocumentStore.getState().hydrateProject(
      createBlankDocumentProject('First Session'),
      'first-library-id'
    );
    useDocumentStore.getState().updatePage({ dropCap: true });
    await vi.advanceTimersByTimeAsync(900);
    expect(dbMocks.updateProject).toHaveBeenCalledTimes(1);

    const replacement = createBlankDocumentProject('Replacement Session');
    useDocumentStore.getState().hydrateProject(replacement, 'replacement-library-id');
    finishWrite?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(useDocumentStore.getState()).toMatchObject({
      project: {
        projectName: 'Replacement Session',
        projectId: replacement.projectId,
      },
      currentLibraryProjectId: 'replacement-library-id',
      isDirty: false,
      saveStatus: 'saved',
    });
  });

  it('does not replace the live document when hydration receives unsupported data', () => {
    const original = useDocumentStore.getState().createBlankProject('Keep Me');

    expect(() => useDocumentStore.getState().hydrateProject({
      schemaVersion: 'design-space-project-v99',
      editorMode: 'document',
    })).toThrow(/unsupported project schema/i);
    expect(useDocumentStore.getState().project).toBe(original);

    expect(() => useDocumentStore.getState().hydrateProject({
      schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      editorMode: 'canvas',
      projectName: 'Wrong Editor',
      pages: [],
    })).toThrow(/canvas project, not a document project/i);
    expect(useDocumentStore.getState().project).toBe(original);
    expect(useDocumentStore.getState()).toMatchObject({
      isDirty: false,
      saveStatus: 'saved',
      revision: 0,
    });
  });
});

describe('document reference invariants', () => {
  it('normalizes references to locked and physically excludes marked reference material from export', () => {
    const page = normalizeDocumentProjectPage({
      kind: 'document',
      reference: {
        ...reference,
        locked: false,
        opacity: 3,
      },
    });

    expect(page.reference).toMatchObject({
      assetId: 'asset-scan',
      locked: true,
      opacity: 1,
    });

    const livePage = document.createElement('article');
    livePage.innerHTML = `
      <div ${DOCUMENT_EXPORT_EXCLUDE_ATTRIBUTE}="true" data-document-reference-layer>
        <img src="data:image/jpeg;base64,SCAN" alt="Editor scan">
      </div>
      <p>Publish this article.</p>
    `;

    const exported = createCleanDocumentClone(livePage, {
      copyComputedStyles: false,
    });

    expect(exported.querySelector('[data-document-reference-layer]')).toBeNull();
    expect(exported.textContent).not.toContain('Editor scan');
    expect(exported.textContent).toContain('Publish this article.');
  });
});
