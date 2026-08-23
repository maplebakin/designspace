import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getDocumentLiveTextDiagnostics,
  resetDocumentLiveTextDiagnostics,
} from '../src/document/services/documentLiveTextDiagnostics';
import { flushDocumentLiveDrafts, registerDocumentLiveDraftFlushHandler } from '../src/document/services/documentLiveDraft';
import {
  useDocumentStore,
} from '../src/document/state/documentStore';
import type { DocumentContentJson } from '../src/document/types/documentProject';

const content = (text: string): DocumentContentJson => ({
  type: 'doc',
  content: [{
    type: 'paragraph',
    attrs: {
      documentStyleId: 'body',
      documentStyleFontSizePx: null,
    },
    content: [{ type: 'text', text }],
  }],
});

describe('document live text state boundary', () => {
  beforeEach(() => {
    useDocumentStore.getState().createBlankProject('Live text state test');
    resetDocumentLiveTextDiagnostics();
  });

  afterEach(() => {
    flushDocumentLiveDrafts();
    useDocumentStore.getState().reset();
  });

  it('commits a known body snapshot without generic page comparison or group repair', () => {
    const store = useDocumentStore.getState();
    const projectBefore = store.project!;
    const pageBefore = projectBefore.pages[0];

    store.commitBodyContentSnapshot(pageBefore.id, content('Latest body'));

    const projectAfter = useDocumentStore.getState().project!;
    const metrics = getDocumentLiveTextDiagnostics().metrics;
    expect(projectAfter.pages[0].bodyContent).toEqual(content('Latest body'));
    expect(projectAfter.pages[0].imageGroups).toBe(pageBefore.imageGroups);
    expect(projectAfter.pages[0].overlayObjects).toBe(pageBefore.overlayObjects);
    expect(metrics.normalizeDocumentContentStyles?.count).toBe(1);
    expect(metrics.documentPagesAreEquivalent?.count || 0).toBe(0);
    expect(metrics.collectGroupableDocumentImageIds?.count || 0).toBe(0);
    expect(metrics.repairDocumentImageGroups?.count || 0).toBe(0);
    expect(getDocumentLiveTextDiagnostics().fastTextCommits).toBe(1);
  });

  it('flushes the latest live draft synchronously at a persistence boundary', () => {
    const pageId = useDocumentStore.getState().project!.pages[0].id;
    const unregister = registerDocumentLiveDraftFlushHandler(() => {
      useDocumentStore.getState().commitBodyContentSnapshot(
        pageId,
        content('typed immediately before save')
      );
      return 1;
    });

    expect(flushDocumentLiveDrafts()).toBe(1);
    expect(
      useDocumentStore.getState().project!.pages[0].bodyContent
    ).toEqual(content('typed immediately before save'));
    unregister();
  });

  it('does not normalize or repair repeatedly when the same live draft is flushed once', () => {
    const pageId = useDocumentStore.getState().project!.pages[0].id;
    let latest = content('one');
    const unregister = registerDocumentLiveDraftFlushHandler(() => {
      useDocumentStore.getState().commitBodyContentSnapshot(pageId, latest);
      return 1;
    });

    latest = content('one two three');
    flushDocumentLiveDrafts();

    const metrics = getDocumentLiveTextDiagnostics().metrics;
    expect(metrics.normalizeDocumentContentStyles?.count).toBe(1);
    expect(metrics.repairDocumentImageGroups?.count || 0).toBe(0);
    expect(metrics.documentPagesAreEquivalent?.count || 0).toBe(0);
    unregister();
  });
});
