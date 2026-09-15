import { describe, expect, it } from 'vitest';
import {
  createBlankDocumentPage,
  createBlankDocumentProject,
} from '../src/document/state/documentStore';
import { createDocumentHistory } from '../src/document/state/documentHistory';
import type { DocumentProjectPayload } from '../src/editor/project/projectSchema';

const transition = (
  history: ReturnType<typeof createDocumentHistory>,
  before: DocumentProjectPayload,
  after: DocumentProjectPayload,
  sessionIdentity = 'session-1'
) => {
  history.observeTransition(before, after, {
    previousSessionIdentity: sessionIdentity,
    sessionIdentity,
  });
  history.flushPending();
};

const titleProject = (project: DocumentProjectPayload, text: string) => ({
  ...project,
  pages: project.pages.map((page, index) => index === 0
    ? {
        ...page,
        titleContent: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        },
      }
    : page),
});

const overlayProject = (project: DocumentProjectPayload, xPx: number) => ({
  ...project,
  pages: project.pages.map((page, index) => index === 0
    ? {
        ...page,
        overlayObjects: [{
          id: 'overlay-1',
          assetId: 'asset-1',
          altText: '',
          xPx,
          yPx: 10,
          widthPx: 40,
          heightPx: 40,
          placement: 'front' as const,
          caption: '',
          captionAlignment: 'inherit' as const,
          captionItalic: 'inherit' as const,
          captionSpacingPx: 'inherit' as const,
          naturalWidth: 40,
          naturalHeight: 40,
          cropMode: 'fit' as const,
          cropFocalX: 0.5,
          cropFocalY: 0.5,
          locked: false,
        }],
      }
    : page),
});

describe('document authored history', () => {
  it('sequences text and non-text transitions while ignoring page selection', () => {
    const base = createBlankDocumentProject('History contract');
    const initial = {
      ...base,
      pages: [...base.pages, createBlankDocumentPage('Page 2')],
    };
    const history = createDocumentHistory(() => 100);
    history.reset(initial, 'session-1');
    const typed = titleProject(initial, 'Typed title');
    transition(history, initial, typed);
    const switched = { ...typed, activePageIndex: 1 };
    transition(history, typed, switched);
    const moved = overlayProject(typed, 80);
    transition(history, typed, moved);

    expect(history.getState()).toMatchObject({
      canUndo: true,
      canRedo: false,
      length: 2,
      index: 2,
    });

    const undone: DocumentProjectPayload[] = [];
    expect(history.undo((project) => undone.push(project))).toBe(true);
    expect(undone[0].pages[0].overlayObjects).toHaveLength(0);
    expect(undone[0].pages[0].titleContent).toEqual(typed.pages[0].titleContent);
    expect(history.undo((project) => undone.push(project))).toBe(true);
    expect(undone[1].pages[0].titleContent).toEqual(initial.pages[0].titleContent);
    expect(history.canUndo()).toBe(false);
  });

  it('discards the redo branch after a divergent authored action', () => {
    const initial = createBlankDocumentProject('Branching history');
    const history = createDocumentHistory(() => 100);
    history.reset(initial, 'session-1');
    const first = titleProject(initial, 'First');
    const second = titleProject(first, 'Second');
    transition(history, initial, first);
    transition(history, first, second);
    expect(history.undo(() => undefined)).toBe(true);
    expect(history.canRedo()).toBe(true);

    const divergent = titleProject(first, 'Divergent');
    transition(history, first, divergent);
    expect(history.canRedo()).toBe(false);
    const restored: DocumentProjectPayload[] = [];
    expect(history.undo((project) => restored.push(project))).toBe(true);
    expect(restored[0].pages[0].titleContent).toEqual(first.pages[0].titleContent);
  });

  it('keeps title and body draft commits as separate chronological actions', () => {
    const initial = createBlankDocumentProject('Title and body history');
    const history = createDocumentHistory(() => 100);
    history.reset(initial, 'session-1');
    const title = titleProject(initial, 'Title');
    const body = {
      ...title,
      pages: title.pages.map((page, index) => index === 0
        ? {
            ...page,
            bodyContent: {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }],
            },
          }
        : page),
    };
    transition(history, initial, title);
    transition(history, title, body);
    expect(history.getState()).toMatchObject({ length: 2, index: 2 });
    const undone: DocumentProjectPayload[] = [];
    history.undo((project) => undone.push(project));
    expect(undone[0].pages[0].bodyContent).toEqual(initial.pages[0].bodyContent);
    expect(undone[0].pages[0].titleContent).toEqual(title.pages[0].titleContent);
  });

  it('flushes an authored edit before an immediate page selection', () => {
    const base = createBlankDocumentProject('Immediate page selection');
    const initial = {
      ...base,
      pages: [...base.pages, createBlankDocumentPage('Page 2')],
    };
    const history = createDocumentHistory(() => 100);
    history.reset(initial, 'session-1');
    const typed = titleProject(initial, 'Typed before switching');
    history.observeTransition(initial, typed, {
      previousSessionIdentity: 'session-1',
      sessionIdentity: 'session-1',
    });
    history.observeTransition(typed, { ...typed, activePageIndex: 1 }, {
      previousSessionIdentity: 'session-1',
      sessionIdentity: 'session-1',
    });
    history.flushPending();
    expect(history.getState()).toMatchObject({ length: 1, index: 1 });
    const undone: DocumentProjectPayload[] = [];
    history.undo((project) => undone.push(project));
    expect(undone[0].activePageIndex).toBe(0);
    expect(undone[0].pages[0].titleContent).toEqual(initial.pages[0].titleContent);
  });

  it('keeps a pending text draft separate from an immediate image action', () => {
    const initial = createBlankDocumentProject('Immediate mixed action');
    const history = createDocumentHistory(() => 100);
    history.reset(initial, 'session-1');
    const typed = titleProject(initial, 'Typed before image move');
    const moved = overlayProject(typed, 80);
    history.observeTransition(initial, typed, {
      previousSessionIdentity: 'session-1',
      sessionIdentity: 'session-1',
    });
    history.observeTransition(typed, moved, {
      previousSessionIdentity: 'session-1',
      sessionIdentity: 'session-1',
    });
    history.flushPending();

    expect(history.getState()).toMatchObject({ length: 2, index: 2 });
    const undone: DocumentProjectPayload[] = [];
    history.undo((project) => undone.push(project));
    expect(undone[0].pages[0].overlayObjects).toHaveLength(0);
    expect(undone[0].pages[0].titleContent).toEqual(typed.pages[0].titleContent);
    history.undo((project) => undone.push(project));
    expect(undone[1].pages[0].titleContent).toEqual(initial.pages[0].titleContent);
  });

  it('resets history when the project session identity changes', () => {
    const initial = createBlankDocumentProject('Session history');
    const history = createDocumentHistory();
    history.reset(initial, 'session-1');
    const changed = titleProject(initial, 'Changed');
    transition(history, initial, changed);
    expect(history.canUndo()).toBe(true);
    history.observeTransition(changed, initial, {
      previousSessionIdentity: 'session-1',
      sessionIdentity: 'session-2',
    });
    expect(history.getState()).toMatchObject({
      canUndo: false,
      canRedo: false,
      length: 0,
    });
  });
});
