import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  describeCanvasPageAssetReferences,
  describeDocumentPageAssetReferences,
} from '../src/editor/session/legacyAssetReferences';
import {
  executeCanvasPageMutation,
  executeDocumentPageMutation,
} from '../src/editor/session/legacyPageMutationAdapters';
import { useDocumentStore } from '../src/document/state/documentStore';
import { useEditorStore, type ProjectPage } from '../src/editor/state/editorStore';

const originalCanvasState = useEditorStore.getState();

const canvasPage = (id: string): ProjectPage => ({
  id,
  name: id,
  canvasSize: { width: 1200, height: 900 },
  canvasData: { objects: [] },
});

afterEach(() => {
  useDocumentStore.getState().reset();
  useEditorStore.setState(originalCanvasState, true);
});

describe('Unified Editor Phase 1C mutation boundaries', () => {
  it('reports a Canvas add-page mutation by stable created page ID', async () => {
    const first = canvasPage('canvas-page-1');
    useEditorStore.setState({
      currentLibraryProjectId: 'canvas-mutation-project',
      productProjectFields: null,
      pages: [first],
      activePageIndex: 0,
      addPage: vi.fn(async () => {
        useEditorStore.setState((state) => ({
          pages: [...state.pages, canvasPage('canvas-page-2')],
          activePageIndex: state.pages.length,
        }));
      }),
    });

    const result = await executeCanvasPageMutation({
      kind: 'add-page',
      projectId: 'canvas-mutation-project',
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'success',
      kind: 'add-page',
      createdPageId: 'canvas-page-2',
      activePageId: 'canvas-page-2',
      pageOrder: ['canvas-page-1', 'canvas-page-2'],
      effects: {
        contentChanged: false,
        pageStructureChanged: true,
        assetEffects: 'none',
        selection: 'active-page-changed',
      },
    });
  });

  it('normalizes Document duplicate/remove failures and asset consequences', async () => {
    const project = useDocumentStore.getState().createBlankProject('Mutation project');
    const sourcePageId = project.pages[0].id;

    const duplicate = await executeDocumentPageMutation({
      kind: 'duplicate-page',
      projectId: project.projectId,
      sourcePageId,
    });

    expect(duplicate).toMatchObject({
      ok: true,
      status: 'success',
      kind: 'duplicate-page',
      createdPageId: expect.any(String),
      affectedPageIds: [sourcePageId, expect.any(String)],
      effects: {
        contentChanged: true,
        pageStructureChanged: true,
        assetEffects: 'retained-reference',
      },
    });

    const removeLastProject = useDocumentStore.getState().createBlankProject('Last page');
    const rejected = await executeDocumentPageMutation({
      kind: 'remove-page',
      projectId: removeLastProject.projectId,
      pageId: removeLastProject.pages[0].id,
    });

    expect(rejected).toMatchObject({
      ok: false,
      status: 'rejected',
      error: {
        code: 'cannot-remove-last-page',
      },
    });
  });

  it('keeps reorder requests ID-based and rejects stale or invalid targets', async () => {
    const project = useDocumentStore.getState().createBlankProject('Reorder project');
    useDocumentStore.getState().addPage();
    const ordered = useDocumentStore.getState().project!;
    const firstPageId = ordered.pages[0].id;

    const reordered = await executeDocumentPageMutation({
      kind: 'reorder-page',
      projectId: project.projectId,
      pageId: firstPageId,
      targetIndex: 1,
    });

    expect(reordered).toMatchObject({
      ok: true,
      pageOrder: [ordered.pages[1].id, firstPageId],
    });

    const invalid = await executeDocumentPageMutation({
      kind: 'reorder-page',
      projectId: project.projectId,
      pageId: firstPageId,
      targetIndex: 99,
    });
    expect(invalid).toMatchObject({
      ok: false,
      status: 'rejected',
      error: { code: 'invalid-reorder-target' },
    });
  });
});

describe('Unified Editor Phase 1C asset reference vocabulary', () => {
  it('describes Canvas image references without treating a blob URL as identity', () => {
    const references = describeCanvasPageAssetReferences({
      page: {
        canvasData: {
          objects: [
            { type: 'image', id: 'embedded-image', src: 'embedded-image', width: 640, height: 480 },
            { type: 'image', id: 'runtime-image', src: 'runtime-image', width: 320, height: 240 },
          ],
        },
      },
      imageAssets: {
        'embedded-image': 'data:image/png;base64,AAAA',
        'runtime-image': 'blob:https://design-space.test/runtime',
      },
    });

    expect(references).toEqual(expect.arrayContaining([
      expect.objectContaining({
        assetId: 'embedded-image',
        kind: 'image',
        sourceKind: 'data-url',
        runtimeOnly: false,
        naturalWidth: 640,
        naturalHeight: 480,
      }),
      expect.objectContaining({
        assetId: 'runtime-image',
        kind: 'image',
        sourceKind: 'blob-url',
        runtimeOnly: true,
      }),
    ]));
  });

  it('describes Document content, overlay, and reference assets from stable IDs/metadata', () => {
    const page = useDocumentStore.getState().createBlankProject('Asset project').pages[0];
    const populatedPage = {
      ...page,
      bodyContent: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{
            type: 'documentFlowImage',
            attrs: { assetId: 'flow-image', naturalWidth: 800, naturalHeight: 600 },
          }],
        }],
      },
      overlayObjects: [{
        id: 'overlay-1',
        assetId: 'overlay-image',
        altText: '',
        xPx: 0,
        yPx: 0,
        widthPx: 120,
        heightPx: 80,
        placement: 'front' as const,
      }],
      reference: {
        assetId: 'scan-1',
        sourceType: 'image' as const,
        opacity: 0.35,
        fit: 'contain' as const,
        scale: 1,
        offsetXPx: 0,
        offsetYPx: 0,
        visible: true,
        locked: true,
      },
    };

    const references = describeDocumentPageAssetReferences({
      page: populatedPage,
      assets: {
        'flow-image': 'data:image/jpeg;base64,AAAA',
        'overlay-image': 'data:image/png;base64,AAAA',
        'scan-1': 'data:image/png;base64,AAAA',
      },
      assetMetadata: {
        'flow-image': {
          contentHash: 'hash',
          byteLength: 4,
          mimeType: 'image/jpeg',
          naturalWidth: 800,
          naturalHeight: 600,
          fileName: 'flow.jpg',
        },
      },
    });

    expect(references).toEqual(expect.arrayContaining([
      expect.objectContaining({
        assetId: 'flow-image',
        kind: 'image',
        mimeType: 'image/jpeg',
        filename: 'flow.jpg',
      }),
      expect.objectContaining({ assetId: 'overlay-image', kind: 'image' }),
      expect.objectContaining({ assetId: 'scan-1', kind: 'reference' }),
    ]));
  });
});
