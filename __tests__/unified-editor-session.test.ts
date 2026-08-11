import React from 'react';
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDocumentStore } from '../src/document/state/documentStore';
import { useEditorStore } from '../src/editor/state/editorStore';
import { useProjectSessionStore } from '../src/editor/state/projectSessionStore';

const rendererMocks = vi.hoisted(() => ({
  canvas: vi.fn(() => null),
  document: vi.fn(() => null),
}));

vi.mock('../src/editor/components/EditorShell', () => ({
  EditorShell: rendererMocks.canvas,
}));

vi.mock('../src/document/components/DocumentEditorShell', () => ({
  DocumentEditorShell: rendererMocks.document,
}));

import { UnifiedEditorSession } from '../src/editor/session/UnifiedEditorSession';

describe('UnifiedEditorSession legacy renderer seam', () => {
  afterEach(() => {
    cleanup();
    useProjectSessionStore.getState().clearSession();
    useDocumentStore.getState().reset();
    rendererMocks.canvas.mockClear();
    rendererMocks.document.mockClear();
  });

  it('mounts the existing Canvas renderer through a canvas page viewport', async () => {
    useEditorStore.setState({
      projectName: 'Canvas seam project',
      currentLibraryProjectId: 'canvas-project',
      pages: [{
        id: 'canvas-page',
        name: 'Page 1',
        canvasSize: { width: 1200, height: 900 },
      }] as any,
      activePageIndex: 0,
      isDirty: false,
      saveStatus: 'saved',
      selectedObjectId: 'shape-1',
      selectedLayerIds: [],
      zoom: 0.75,
      unitMode: 'in',
      productProjectFields: null,
    });
    useProjectSessionStore.getState().setEditorMode('canvas');

    render(React.createElement(UnifiedEditorSession));

    await waitFor(() => {
      expect(screen.getByTestId('unified-page-viewport')
        .getAttribute('data-renderer-kind')).toBe('canvas');
      expect(rendererMocks.canvas).toHaveBeenCalled();
      expect(useProjectSessionStore.getState().session?.activePageId)
        .toBe('canvas-page');
    });

    expect(rendererMocks.canvas.mock.calls.at(-1)?.[0]).toMatchObject({
      useSharedChrome: true,
    });
    expect(useProjectSessionStore.getState().commands).toMatchObject({
      renameProject: expect.any(Function),
      mutatePage: expect.any(Function),
      describePageAssets: expect.any(Function),
      changeCoordinator: expect.objectContaining({
        subscribe: expect.any(Function),
        observeCommitted: expect.any(Function),
      }),
      close: expect.any(Function),
      fitPage: expect.any(Function),
    });

    expect(screen.getByTestId('unified-page-viewport')
      .getAttribute('data-page-coordinate-space')).toBe('canvas-logical-px');
    await waitFor(() => {
      expect(useProjectSessionStore.getState().selection.target).toMatchObject({
        kind: 'freeform-object',
        objectId: 'shape-1',
      });
    });
  });

  it('mounts the existing Document renderer and observes high-level selection events', async () => {
    useDocumentStore.getState().createBlankProject('Document seam project');
    useProjectSessionStore.getState().setEditorMode('document');

    render(React.createElement(UnifiedEditorSession));

    await waitFor(() => {
      expect(screen.getByTestId('unified-page-viewport')
        .getAttribute('data-renderer-kind')).toBe('document');
      expect(rendererMocks.document).toHaveBeenCalled();
      expect(useProjectSessionStore.getState().session?.rendererKind)
        .toBe('document');
    });

    expect(rendererMocks.document.mock.calls.at(-1)?.[0]).toMatchObject({
      useSharedChrome: true,
    });
    expect(useProjectSessionStore.getState().commands).toMatchObject({
      renameProject: expect.any(Function),
      mutatePage: expect.any(Function),
      describePageAssets: expect.any(Function),
      changeCoordinator: expect.objectContaining({
        subscribe: expect.any(Function),
        observeCommitted: expect.any(Function),
      }),
      close: expect.any(Function),
      fitPage: expect.any(Function),
    });

    expect(screen.getByTestId('unified-page-viewport')
      .getAttribute('data-page-coordinate-space')).toBe('document-page-css-px');

    const props = rendererMocks.document.mock.calls.at(-1)?.[0] as {
      onSelectionEvent: (event: {
        source: 'document';
        pageId: string;
        target: { kind: 'structured-text'; pageId: string; editor: 'body' };
        isFocused: boolean;
        isEditing: boolean;
      }) => void;
    } | undefined;
    expect(props?.onSelectionEvent).toBeTypeOf('function');

    act(() => {
      props?.onSelectionEvent({
        source: 'document',
        pageId: useProjectSessionStore.getState().session?.activePageId || '',
        target: {
          kind: 'structured-text',
          pageId: useProjectSessionStore.getState().session?.activePageId || '',
          editor: 'body',
        },
        isFocused: true,
        isEditing: true,
      });
    });

    expect(useProjectSessionStore.getState().selection.target).toMatchObject({
      kind: 'structured-text',
      editor: 'body',
    });
  });

  it('opts into one diagnostic subscription under React StrictMode', async () => {
    useEditorStore.setState({
      projectName: 'Diagnostic seam project',
      currentLibraryProjectId: 'diagnostic-project',
      pages: [{
        id: 'diagnostic-page',
        name: 'Page 1',
        canvasSize: { width: 1200, height: 900 },
      }] as any,
      activePageIndex: 0,
      isDirty: false,
      saveStatus: 'saved',
      zoom: 0.75,
      unitMode: 'in',
      productProjectFields: null,
    });
    useProjectSessionStore.getState().setEditorMode('canvas');

    render(React.createElement(
      React.StrictMode,
      null,
      React.createElement(UnifiedEditorSession, {
        enableChangeDiagnostics: true,
      })
    ));

    await waitFor(() => {
      expect(useProjectSessionStore.getState().commands?.changeDiagnostic)
        .toBeDefined();
    });

    const commands = useProjectSessionStore.getState().commands;
    const diagnostic = commands?.changeDiagnostic;
    expect(diagnostic?.getSnapshot()).toMatchObject({
      projectId: 'diagnostic-project',
      observedRevision: 0,
      committedTransactionCount: 0,
      recentCheckpoints: [
        expect.objectContaining({ kind: 'session-opened' }),
      ],
    });

    act(() => {
      commands?.changeCoordinator?.observeCommitted({
        projectId: 'diagnostic-project',
        source: 'canvas',
        action: 'modify-freeform-geometry',
        pageIds: ['diagnostic-page'],
        domains: ['geometry'],
        target: {
          kind: 'freeform-object',
          id: 'diagnostic-object',
        },
        assetEffect: 'none',
      });
    });

    expect(diagnostic?.getSnapshot()).toMatchObject({
      observedRevision: 1,
      committedTransactionCount: 1,
    });
  });
});
