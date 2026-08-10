import { describe, expect, it } from 'vitest';
import {
  createEmptySelectionEvent,
  createPageViewport,
  createProjectSessionDescriptor,
} from '../src/editor/session/projectSession';

describe('shared project session contract', () => {
  it('adapts legacy Canvas geometry into display CSS pixels without changing source units', () => {
    const session = createProjectSessionDescriptor({
      editorMode: 'canvas',
      projectId: 'canvas-project',
      projectName: 'Canvas project',
      pages: [{
        id: 'canvas-page',
        name: 'Page 1',
        kind: 'canvas',
        canvasSize: { width: 2550, height: 3300 },
      }],
      document: { pageSize: { dpi: 300 } },
      activePageIndex: 0,
    }, { source: 'portable' });

    expect(session.source).toBe('portable');
    expect(session.rendererKind).toBe('canvas');
    expect(session.activePageId).toBe('canvas-page');
    expect(session.pages[0].size).toMatchObject({
      sourceWidth: 2550,
      sourceHeight: 3300,
      coordinateSpace: 'canvas-logical-px',
      physicalWidthIn: 8.5,
      physicalHeightIn: 11,
      widthCssPx: 816,
      heightCssPx: 1056,
    });
  });

  it('adapts Document physical page sizes into the shared CSS display space', () => {
    const session = createProjectSessionDescriptor({
      editorMode: 'document',
      projectId: 'document-project',
      projectName: 'Document project',
      pages: [{
        id: 'document-page',
        name: 'Page 1',
        kind: 'document',
        size: { widthIn: 8.5, heightIn: 11, dpi: 300 },
      }],
      activePageIndex: 0,
    }, { source: 'library' });

    expect(session.source).toBe('library');
    expect(session.rendererKind).toBe('document');
    expect(session.pages[0].size).toMatchObject({
      sourceWidth: 816,
      sourceHeight: 1056,
      coordinateSpace: 'document-page-css-px',
      widthCssPx: 816,
      heightCssPx: 1056,
      outputDpi: 300,
    });
  });

  it('keeps zoom and viewport measurement transient at the shared boundary', () => {
    const session = createProjectSessionDescriptor({
      editorMode: 'document',
      projectId: 'document-project',
      projectName: 'Document project',
      pages: [{
        id: 'document-page',
        name: 'Page 1',
        kind: 'document',
        size: { widthIn: 8.5, heightIn: 11, dpi: 300 },
      }],
    });

    const viewport = createPageViewport({
      session,
      zoom: 0.75,
      viewportWidthCssPx: 900,
      viewportHeightCssPx: 700,
    });

    expect(viewport).toMatchObject({
      pageId: 'document-page',
      editorChromeBoundary: 'outside-legacy-renderer',
      zoom: 0.75,
      viewportWidthCssPx: 900,
      viewportHeightCssPx: 700,
      mounted: true,
    });
    expect(session).not.toHaveProperty('zoom');
    expect(createEmptySelectionEvent()).toEqual({
      source: 'shell',
      pageId: null,
      target: { kind: 'none' },
      isFocused: false,
      isEditing: false,
    });
  });
});
