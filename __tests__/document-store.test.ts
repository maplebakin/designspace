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
  CURRENT_DOCUMENT_SCHEMA_VERSION,
  DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
  normalizeDocumentContentStyles,
  normalizeDocumentProjectPage,
} from '../src/editor/project/projectSchema';
import {
  DEFAULT_DOCUMENT_DROP_CAP,
  type DocumentStyleId,
} from '../src/document/typography/documentTypography';
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

const bodyContent = (
  text: string,
  documentStyleId: DocumentStyleId = 'body'
): DocumentContentJson => ({
  type: 'doc',
  content: [{
    type: 'paragraph',
    attrs: {
      documentStyleId,
      documentStyleFontSizePx: null,
    },
    content: [{ type: 'text', text }],
  }],
});

const spanningBodyContent = (): DocumentContentJson => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: {
        documentStyleId: 'body',
        documentStyleFontSizePx: null,
      },
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
        wrapPaddingTopPx: 20,
        wrapPaddingRightPx: 12,
        wrapPaddingBottomPx: 20,
        wrapPaddingLeftPx: 12,
        coordinateSpace: 'body-span',
        verticalAnchor: 'page-position',
        yPx: 286,
        caption: 'Family photograph caption',
        captionAlignment: 'inherit',
        captionItalic: 'inherit',
        captionSpacingPx: 'inherit',
      },
    },
    {
      type: 'paragraph',
      attrs: {
        documentStyleId: 'body',
        documentStyleFontSizePx: null,
      },
      content: [{ type: 'text', text: 'Article after image' }],
    },
  ],
});

const collectDocumentNodeIds = (
  content: DocumentContentJson | undefined,
  nodeType: string
): string[] => {
  if (!content) return [];
  return [
    ...(content.type === nodeType && typeof content.attrs?.id === 'string'
      ? [content.attrs.id]
      : []),
    ...(content.content || []).flatMap((child) =>
      collectDocumentNodeIds(child, nodeType)
    ),
  ];
};

const withoutCanonicalDocumentNodeIds = (
  content: DocumentContentJson
): DocumentContentJson => {
  const clone = structuredClone(content);
  const visit = (node: DocumentContentJson) => {
    if (
      (
        node.type === 'documentInlineImage'
        || node.type === 'documentFlowImage'
      )
      && node.attrs
    ) {
      delete node.attrs.id;
    }
    (node.content || []).forEach(visit);
  };
  visit(clone);
  return clone;
};

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
        schemaVersion: CURRENT_DOCUMENT_SCHEMA_VERSION,
        background: {
          value: DEFAULT_DOCUMENT_PAPER_COLOR,
        },
        folios: {
          startingNumber: 1,
          visible: false,
          placement: 'outside-bottom',
        },
      },
      activePageIndex: 0,
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
        bottomIn: 0.65,
        innerIn: 0.65,
        outerIn: 0.65,
      },
      titleContent: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          attrs: { documentStyleId: 'article-title' },
        }],
      },
      bodyContent: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          attrs: { documentStyleId: 'body' },
        }],
      },
      columnCount: 1,
      columnGapPx: 24,
      dropCap: DEFAULT_DOCUMENT_DROP_CAP,
      suppressFolio: false,
      overlayObjects: [],
      imageGroups: [],
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

  it('deduplicates identical imported assets and reports unreachable payload entries', () => {
    const store = useDocumentStore.getState();
    store.createBlankProject('Asset lifecycle');
    const firstId = store.addAsset(
      'asset-first',
      'data:image/png;base64,SAME',
      { mimeType: 'image/png', naturalWidth: 120, naturalHeight: 80 }
    );
    const secondId = store.addAsset(
      'asset-second',
      'data:image/png;base64,SAME',
      { mimeType: 'image/png', naturalWidth: 120, naturalHeight: 80 }
    );
    expect(firstId).toBe('asset-first');
    expect(secondId).toBe('asset-first');
    expect(useDocumentStore.getState().project?.assets).toEqual({
      'asset-first': 'data:image/png;base64,SAME',
    });
    expect(useDocumentStore.getState().project?.assetMetadata?.['asset-first']).toMatchObject({
      mimeType: 'image/png',
      naturalWidth: 120,
    });
    expect(store.inspectAssetReferences()).toMatchObject({
      orphanAssetIds: ['asset-first'],
      missingAssetIds: [],
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

  it('updates independent page stories by ID so stale editor callbacks cannot overwrite the active page', () => {
    const store = useDocumentStore.getState();
    const project = store.createBlankProject('Independent Stories');
    const firstPageId = project.pages[0].id;
    store.updateTitleContent(
      bodyContent('Page 1 title', 'article-title'),
      firstPageId
    );
    store.updateBodyContent(bodyContent('Page 1 body'), firstPageId);
    store.addPage();

    const secondPageId = useDocumentStore.getState().project!.pages[1].id;
    expect(useDocumentStore.getState().project?.activePageIndex).toBe(1);
    store.updateTitleContent(
      bodyContent('Page 2 title', 'article-title'),
      secondPageId
    );
    store.updateBodyContent(bodyContent('Page 2 body'), secondPageId);

    // This models a delayed Tiptap onUpdate from page 1 after page 2 mounted.
    store.updateBodyContent(bodyContent('Late page 1 body'), firstPageId);
    store.updatePage({ columnCount: 3 }, firstPageId);

    const pages = useDocumentStore.getState().project!.pages;
    expect(pages[0]).toMatchObject({
      id: firstPageId,
      titleContent: bodyContent('Page 1 title', 'article-title'),
      bodyContent: bodyContent('Late page 1 body'),
      columnCount: 3,
    });
    expect(pages[1]).toMatchObject({
      id: secondPageId,
      titleContent: bodyContent('Page 2 title', 'article-title'),
      bodyContent: bodyContent('Page 2 body'),
      columnCount: 1,
    });
    expect(useDocumentStore.getState().project?.activePageIndex).toBe(1);
  });

  it('commits body JSON and image groups as one repaired page revision', () => {
    const store = useDocumentStore.getState();
    const project = store.createBlankProject('Atomic image groups');
    const pageId = project.pages[0].id;
    const first = spanningBodyContent();
    const second = structuredClone(first.content?.find(
      (node) => node.type === 'documentFlowImage'
    ));
    if (!second) throw new Error('fixture image missing');
    second.attrs = { ...(second.attrs || {}), id: 'span-photo-second' };
    first.content = [
      ...(first.content || []),
      second,
    ];
    store.updatePage({
      bodyContent: first,
      imageGroups: [{
        id: 'row-atomic',
        kind: 'row',
        childImageIds: ['span-photo', 'span-photo-second'],
        gapPx: 12,
        sharedWidth: false,
      }],
    }, pageId);
    const before = useDocumentStore.getState().revision;
    const withoutSecond = {
      ...first,
      content: first.content?.filter(
        (node) => node.attrs?.id !== 'span-photo-second'
      ),
    };
    store.commitPageImageState(pageId, withoutSecond, [{
      id: 'row-atomic',
      kind: 'row',
      childImageIds: ['span-photo', 'span-photo-second'],
      gapPx: 12,
      sharedWidth: false,
    }]);
    const page = useDocumentStore.getState().project!.pages[0];
    expect(useDocumentStore.getState().revision).toBe(before + 1);
    expect(page.bodyContent.content?.some(
      (node) => node.attrs?.id === 'span-photo-second'
    )).toBe(false);
    expect(page.imageGroups).toEqual([]);
  });

  it('persists active page selection through the bounded autosave', async () => {
    const store = useDocumentStore.getState();
    store.createBlankProject('Selection Only');
    store.addPage();
    const snapshot = useDocumentStore.getState().project!;
    store.hydrateProject(snapshot, 'selection-library-id');

    expect(useDocumentStore.getState()).toMatchObject({
      isDirty: false,
      saveStatus: 'saved',
      revision: 0,
      project: { activePageIndex: 1 },
    });

    store.selectPage(0);
    expect(useDocumentStore.getState()).toMatchObject({
      isDirty: true,
      saveStatus: 'unsaved',
      revision: 1,
      project: { activePageIndex: 0 },
    });

    await vi.advanceTimersByTimeAsync(900);
    expect(dbMocks.updateProject).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(dbMocks.updateProject.mock.calls[0][2] as string);
    expect(saved.activePageIndex).toBe(0);
    expect(useDocumentStore.getState()).toMatchObject({
      isDirty: false,
      saveStatus: 'saved',
      project: { activePageIndex: 0 },
    });
  });

  it('does not roll active page selection back when a manual save is in flight', async () => {
    let finishWrite: (() => void) | undefined;
    dbMocks.saveProject.mockReturnValueOnce(new Promise<string>((resolve) => {
      finishWrite = () => resolve('selection-race-library-id');
    }));
    const store = useDocumentStore.getState();
    store.createBlankProject('Selection Race');
    store.addPage();
    store.selectPage(0);

    const save = useDocumentStore.getState().saveProject();
    useDocumentStore.getState().selectPage(1);
    finishWrite?.();
    await save;

    expect(useDocumentStore.getState()).toMatchObject({
      isDirty: true,
      saveStatus: 'unsaved',
      project: { activePageIndex: 1 },
    });
  });

  it('ignores non-finite page action indexes without dirtying the project', () => {
    const store = useDocumentStore.getState();
    store.createBlankProject('Safe page indexes');
    store.addPage();
    const snapshot = useDocumentStore.getState().project!;
    store.hydrateProject(snapshot, 'safe-index-library-id');

    store.selectPage(Number.NaN);
    store.duplicatePage(Number.NaN);
    store.removePage(Number.POSITIVE_INFINITY);
    store.reorderPages(Number.NaN, 0);

    expect(useDocumentStore.getState()).toMatchObject({
      revision: 0,
      isDirty: false,
      project: {
        activePageIndex: 1,
        pages: [{}, {}],
      },
    });
  });

  it('adds, duplicates, reorders, and removes pages while remapping canonical IDs', () => {
    const store = useDocumentStore.getState();
    const project = store.createBlankProject('Page Operations');
    const sourcePageId = project.pages[0].id;
    const groupedBody = spanningBodyContent();
    groupedBody.content = [
      ...(groupedBody.content || []),
      {
        type: 'documentFlowImage',
        attrs: {
          ...groupedBody.content?.find(
            (node) => node.type === 'documentFlowImage'
          )?.attrs,
          id: 'span-photo-second',
          assetId: 'asset-family-second',
          caption: 'Second independently editable caption',
          xOffsetPx: 280,
        },
      },
    ];
    store.updatePage({
      bodyContent: groupedBody,
      overlayObjects: [overlay],
      imageGroups: [{
        id: 'source-row',
        kind: 'row',
        childImageIds: ['span-photo', 'span-photo-second'],
        gapPx: 18,
        sharedWidth: false,
      }],
      reference,
    }, sourcePageId);

    store.duplicatePage(0);

    let state = useDocumentStore.getState();
    expect(state.project?.pages).toHaveLength(2);
    expect(state.project?.activePageIndex).toBe(1);
    const source = state.project!.pages[0];
    const duplicate = state.project!.pages[1];
    expect(duplicate.id).not.toBe(source.id);
    expect(duplicate.bodyContent).not.toBe(source.bodyContent);
    expect(withoutCanonicalDocumentNodeIds(duplicate.bodyContent)).toEqual(
      withoutCanonicalDocumentNodeIds(source.bodyContent)
    );
    expect(duplicate.overlayObjects[0].id).not.toBe(
      source.overlayObjects[0].id
    );
    expect(duplicate.overlayObjects[0].assetId).toBe(
      source.overlayObjects[0].assetId
    );
    expect(duplicate.reference).toEqual(source.reference);
    expect(
      collectDocumentNodeIds(duplicate.bodyContent, 'documentFlowImage')
    ).not.toEqual(
      collectDocumentNodeIds(source.bodyContent, 'documentFlowImage')
    );
    expect(
      collectDocumentNodeIds(duplicate.bodyContent, 'documentFlowImage')
    ).toHaveLength(2);
    expect(duplicate.imageGroups).toHaveLength(1);
    expect(duplicate.imageGroups[0]).toMatchObject({
      kind: 'row',
      gapPx: 18,
      sharedWidth: false,
      childImageIds: collectDocumentNodeIds(
        duplicate.bodyContent,
        'documentFlowImage'
      ),
    });
    expect(duplicate.imageGroups[0].id).not.toBe(
      source.imageGroups[0].id
    );

    const duplicateId = duplicate.id;
    store.addPage();
    state = useDocumentStore.getState();
    expect(state.project?.pages).toHaveLength(3);
    expect(state.project?.activePageIndex).toBe(2);
    expect(new Set(state.project?.pages.map((page) => page.id)).size).toBe(3);

    store.reorderPages(1, 0);
    state = useDocumentStore.getState();
    expect(state.project?.pages[0].id).toBe(duplicateId);
    expect(state.project?.activePageIndex).toBe(2);

    store.selectPage(0);
    const revisionBeforeSelection = useDocumentStore.getState().revision;
    store.selectPage(1);
    expect(useDocumentStore.getState().revision).toBe(revisionBeforeSelection + 1);

    store.removePage(0);
    expect(useDocumentStore.getState().project?.pages).toHaveLength(2);
    store.removePage(0);
    expect(useDocumentStore.getState().project?.pages).toHaveLength(1);
    const lastPageId = useDocumentStore.getState().project!.pages[0].id;
    store.removePage(0);
    expect(useDocumentStore.getState().project?.pages).toHaveLength(1);
    expect(useDocumentStore.getState().project?.pages[0].id).toBe(lastPageId);
    expect(useDocumentStore.getState().project?.activePageIndex).toBe(0);
  });

  it('round-trips four page stories, active selection, and folio settings', async () => {
    const store = useDocumentStore.getState();
    const project = store.createBlankProject('Pages 49–52');
    const pageIds = [project.pages[0].id];

    store.updateFolioSettings({
      startingNumber: 49,
      visible: true,
      placement: 'outside-bottom',
    });
    store.updatePage({
      name: 'Page 49',
      columnCount: 3,
      suppressFolio: false,
    }, pageIds[0]);
    store.updateTitleContent(
      bodyContent('Historical page 49', 'article-title'),
      pageIds[0]
    );
    store.updateBodyContent(bodyContent('Story 49'), pageIds[0]);

    for (const folio of [50, 51, 52]) {
      store.addPage();
      const page = useDocumentStore.getState().project!.pages.at(-1)!;
      pageIds.push(page.id);
      store.updatePage({
        name: `Page ${folio}`,
        columnCount: folio === 51 ? 1 : 3,
        suppressFolio: folio === 51,
      }, page.id);
      store.updateTitleContent(
        bodyContent(`Historical page ${folio}`, 'article-title'),
        page.id
      );
      store.updateBodyContent(bodyContent(`Story ${folio}`), page.id);
    }

    await store.saveProject();

    const serialized = dbMocks.saveProject.mock.calls[0][1] as string;
    const persisted = JSON.parse(serialized);
    expect(persisted).toMatchObject({
      activePageIndex: 3,
      document: {
        schemaVersion: CURRENT_DOCUMENT_SCHEMA_VERSION,
        folios: {
          startingNumber: 49,
          visible: true,
          placement: 'outside-bottom',
        },
      },
    });
    expect(persisted.pages).toHaveLength(4);
    expect(persisted.pages.map((page: { id: string }) => page.id)).toEqual(
      pageIds
    );
    expect(persisted.pages.map((
      page: { bodyContent: DocumentContentJson }
    ) => page.bodyContent)).toEqual(
      [49, 50, 51, 52].map((folio) => bodyContent(`Story ${folio}`))
    );

    dbMocks.loadProject.mockResolvedValueOnce({
      project: {
        id: 'library-document-1',
        name: 'Pages 49–52',
      },
      canvasData: serialized,
    });
    useDocumentStore.getState().reset();
    await useDocumentStore.getState().loadLibraryProject('library-document-1');

    const reloaded = useDocumentStore.getState();
    expect(reloaded.project?.pages).toHaveLength(4);
    expect(reloaded.project?.pages.map((page) => page.id)).toEqual(pageIds);
    expect(reloaded.project?.pages.map((page) => page.bodyContent)).toEqual(
      [49, 50, 51, 52].map((folio) => bodyContent(`Story ${folio}`))
    );
    expect(reloaded.project?.pages[2].suppressFolio).toBe(true);
    expect(reloaded.project?.activePageIndex).toBe(3);
    expect(reloaded.project?.document.folios).toEqual({
      startingNumber: 49,
      visible: true,
      placement: 'outside-bottom',
    });
    expect(reloaded).toMatchObject({
      isDirty: false,
      saveStatus: 'saved',
    });

    reloaded.updateBodyContent(bodyContent('Story 49 revised'), pageIds[0]);
    await vi.advanceTimersByTimeAsync(900);
    await Promise.resolve();
    await Promise.resolve();

    expect(dbMocks.updateProject).toHaveBeenCalledTimes(1);
    const autosaved = JSON.parse(
      dbMocks.updateProject.mock.calls[0][2] as string
    );
    expect(autosaved.pages).toHaveLength(4);
    expect(autosaved.pages.map((
      page: { bodyContent: DocumentContentJson }
    ) => page.bodyContent)).toEqual([
      bodyContent('Story 49 revised'),
      bodyContent('Story 50'),
      bodyContent('Story 51'),
      bodyContent('Story 52'),
    ]);
    expect(autosaved.activePageIndex).toBe(3);
  });

  it('mutates page settings, content, overlays, references, and assets as project data', () => {
    const store = useDocumentStore.getState();
    store.createBlankProject('Family Archive');

    store.updatePage({
      name: 'Translated article',
      size: { presetId: 'a4', widthIn: 8.27, heightIn: 11.69, dpi: 300 },
      margins: { topIn: 0.8, bottomIn: 0.75, innerIn: 0.7, outerIn: 0.7 },
      titleFontSizePx: 52,
      columnCount: 3,
      columnGapPx: 30,
      dropCap: true,
    });
    store.updateTitleContent(
      bodyContent('Our Family History', 'article-title')
    );
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
      margins: { topIn: 0.8, bottomIn: 0.75, innerIn: 0.7, outerIn: 0.7 },
      titleFontSizePx: 52,
      columnCount: 3,
      columnGapPx: 30,
      dropCap: true,
      titleContent: bodyContent('Our Family History', 'article-title'),
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
        titleContent: bodyContent('A Previous Project', 'article-title'),
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
    const canonicalLegacyBody = normalizeDocumentContentStyles(
      legacyBody,
      'body',
      { legacyCaptionPresentation: true }
    );

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
      columnCount: 3,
      bodyContent: canonicalLegacyBody,
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
      bodyContent: canonicalLegacyBody,
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
    const canonicalAnchoredContent = normalizeDocumentContentStyles(
      anchoredContent,
      'body'
    );
    expect(persisted.pages[0].bodyContent).toEqual(
      canonicalAnchoredContent
    );

    dbMocks.loadProject.mockResolvedValueOnce({
      project: { id: 'library-document-1', name: 'Spanning Article' },
      canvasData: serialized,
    });
    useDocumentStore.getState().reset();
    await useDocumentStore.getState().loadLibraryProject('library-document-1');

    expect(useDocumentStore.getState().project?.pages[0]).toMatchObject({
      columnCount: 3,
      bodyContent: canonicalAnchoredContent,
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
