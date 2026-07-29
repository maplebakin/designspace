import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  useDocumentStore,
} from '../src/document/state/documentStore';
import type {
  DocumentOverlayImage,
} from '../src/document/types/documentProject';

const dbMocks = vi.hoisted(() => ({
  loadProject: vi.fn(),
  saveProject: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock('../src/editor/db', () => ({
  db: dbMocks,
}));

const overlay = (
  id: string,
  update: Partial<DocumentOverlayImage> = {}
): DocumentOverlayImage => ({
  id,
  assetId: `asset-${id}`,
  altText: id,
  xPx: 20,
  yPx: 30,
  widthPx: 100,
  heightPx: 80,
  placement: 'front',
  ...update,
});

const readPage = (pageId: string) => {
  const page = useDocumentStore.getState().project?.pages.find(
    (candidate) => candidate.id === pageId
  );
  if (!page) throw new Error(`Missing test page ${pageId}`);
  return page;
};

const readOverlay = (pageId: string, overlayId: string) => {
  const object = readPage(pageId).overlayObjects.find(
    (candidate) => candidate.id === overlayId
  );
  if (!object) {
    throw new Error(`Missing test overlay ${overlayId} on ${pageId}`);
  }
  return object;
};

describe('document overlay store geometry contract', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useDocumentStore.getState().reset();
    vi.clearAllMocks();
    dbMocks.loadProject.mockResolvedValue(null);
    dbMocks.saveProject.mockResolvedValue('overlay-geometry-project');
    dbMocks.updateProject.mockResolvedValue(undefined);
  });

  afterEach(() => {
    useDocumentStore.getState().reset();
    vi.useRealTimers();
  });

  it('commits against the captured page ID without mutating the active page', () => {
    const store = useDocumentStore.getState();
    const project = store.createBlankProject('Captured page geometry');
    const capturedPageId = project.pages[0].id;
    store.addOverlay(overlay('captured-image'), capturedPageId);
    store.addPage();
    const activePageId = useDocumentStore.getState().project!.pages[1].id;
    store.addOverlay(overlay('active-image', {
      xPx: 240,
      yPx: 260,
    }), activePageId);
    const activeBefore = structuredClone(
      readPage(activePageId).overlayObjects
    );
    const revisionBeforeCommit = useDocumentStore.getState().revision;

    expect(store.commitOverlayGeometry(
      capturedPageId,
      'captured-image',
      { xPx: 64, yPx: 72 }
    )).toBe(true);

    expect(readOverlay(capturedPageId, 'captured-image')).toMatchObject({
      xPx: 64,
      yPx: 72,
    });
    expect(readPage(activePageId).overlayObjects).toEqual(activeBefore);
    expect(useDocumentStore.getState().project?.activePageIndex).toBe(1);
    expect(useDocumentStore.getState().revision).toBe(
      revisionBeforeCommit + 1
    );
  });

  it('treats stale page and overlay IDs as revision-free no-ops', () => {
    const store = useDocumentStore.getState();
    const project = store.createBlankProject('Stale geometry targets');
    const pageId = project.pages[0].id;
    store.addOverlay(overlay('valid-image'), pageId);
    const projectBefore = structuredClone(
      useDocumentStore.getState().project
    );
    const revisionBefore = useDocumentStore.getState().revision;

    expect(store.commitOverlayGeometry(
      'stale-page-id',
      'valid-image',
      { xPx: 400 }
    )).toBe(false);
    expect(store.commitOverlayGeometry(
      pageId,
      'stale-overlay-id',
      { xPx: 400 }
    )).toBe(false);
    expect(store.nudgeOverlay(
      'stale-page-id',
      'valid-image',
      10,
      0
    )).toBe(false);
    expect(store.nudgeOverlay(
      pageId,
      'stale-overlay-id',
      10,
      0
    )).toBe(false);

    expect(useDocumentStore.getState().revision).toBe(revisionBefore);
    expect(useDocumentStore.getState().project).toEqual(projectBefore);
  });

  it('records one revision for one atomic geometry commit', () => {
    const store = useDocumentStore.getState();
    const project = store.createBlankProject('Atomic overlay geometry');
    const pageId = project.pages[0].id;
    store.addOverlay(overlay('atomic-image'), pageId);
    const revisionBefore = useDocumentStore.getState().revision;

    expect(store.commitOverlayGeometry(pageId, 'atomic-image', {
      xPx: 50,
      yPx: 60,
      widthPx: 120,
      heightPx: 90,
    })).toBe(true);

    expect(readOverlay(pageId, 'atomic-image')).toMatchObject({
      xPx: 50,
      yPx: 60,
      widthPx: 120,
      heightPx: 90,
    });
    expect(useDocumentStore.getState()).toMatchObject({
      revision: revisionBefore + 1,
      isDirty: true,
      saveStatus: 'unsaved',
    });
  });

  it.each([0.5, 1, 2])(
    'applies 1 px and 10 px nudges in layout space at %d× zoom',
    (zoom) => {
      const store = useDocumentStore.getState();
      const project = store.createBlankProject(`Nudge at ${zoom}`);
      const pageId = project.pages[0].id;
      store.addOverlay(overlay('nudge-image', {
        xPx: 100,
        yPx: 100,
      }), pageId);
      store.setZoom(zoom);
      const revisionBefore = useDocumentStore.getState().revision;

      expect(store.nudgeOverlay(
        pageId,
        'nudge-image',
        1,
        -1
      )).toBe(true);
      expect(readOverlay(pageId, 'nudge-image')).toMatchObject({
        xPx: 101,
        yPx: 99,
      });
      expect(store.nudgeOverlay(
        pageId,
        'nudge-image',
        10,
        -10
      )).toBe(true);
      expect(readOverlay(pageId, 'nudge-image')).toMatchObject({
        xPx: 111,
        yPx: 89,
      });
      expect(useDocumentStore.getState().zoom).toBe(zoom);
      expect(useDocumentStore.getState().revision).toBe(
        revisionBefore + 2
      );
    }
  );

  it('enforces same-layer collision stops and physical page bounds', () => {
    const store = useDocumentStore.getState();
    const project = store.createBlankProject('Overlay constraints');
    const pageId = project.pages[0].id;
    store.addOverlay(overlay('moving', {
      xPx: 0,
      yPx: 100,
      widthPx: 100,
      heightPx: 100,
    }), pageId);
    store.addOverlay(overlay('fixed', {
      xPx: 180,
      yPx: 100,
      widthPx: 100,
      heightPx: 100,
    }), pageId);

    expect(store.commitOverlayGeometry(
      pageId,
      'moving',
      { xPx: 300, yPx: 100 }
    )).toBe(true);
    expect(readOverlay(pageId, 'moving')).toMatchObject({
      xPx: 80,
      yPx: 100,
    });

    store.addOverlay(overlay('page-boundary', {
      placement: 'behind',
    }), pageId);
    expect(store.commitOverlayGeometry(
      pageId,
      'page-boundary',
      { xPx: 9_000, yPx: 9_000 }
    )).toBe(true);
    expect(readOverlay(pageId, 'page-boundary')).toMatchObject({
      xPx: 716,
      yPx: 976,
      widthPx: 100,
      heightPx: 80,
    });
  });

  it('resolves newly added overlaps to the same deterministic edge', () => {
    const store = useDocumentStore.getState();
    const project = store.createBlankProject('New overlay resolution');
    const firstPageId = project.pages[0].id;
    store.addOverlay(overlay('first-existing', {
      xPx: 100,
      yPx: 100,
    }), firstPageId);
    const revisionBeforeFirstInsert = useDocumentStore.getState().revision;
    store.addOverlay(overlay('first-incoming', {
      xPx: 100,
      yPx: 100,
    }), firstPageId);
    const firstGeometry = readOverlay(
      firstPageId,
      'first-incoming'
    );
    expect(firstGeometry).toMatchObject({
      xPx: 100,
      yPx: 20,
      widthPx: 100,
      heightPx: 80,
    });
    expect(readOverlay(firstPageId, 'first-existing')).toMatchObject({
      xPx: 100,
      yPx: 100,
    });
    expect(useDocumentStore.getState().revision).toBe(
      revisionBeforeFirstInsert + 1
    );

    store.addPage();
    const secondPageId = useDocumentStore.getState().project!.pages[1].id;
    store.addOverlay(overlay('second-existing', {
      xPx: 100,
      yPx: 100,
    }), secondPageId);
    store.addOverlay(overlay('second-incoming', {
      xPx: 100,
      yPx: 100,
    }), secondPageId);
    expect(readOverlay(
      secondPageId,
      'second-incoming'
    )).toMatchObject({
      xPx: firstGeometry.xPx,
      yPx: firstGeometry.yPx,
      widthPx: firstGeometry.widthPx,
      heightPx: firstGeometry.heightPx,
    });
  });
});
