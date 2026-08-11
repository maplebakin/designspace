import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProjectSessionDescriptor,
  createSessionSnapshot,
  type ProjectSessionCommands,
} from '../src/editor/session/projectSession';
import type {
  PageMutationCommand,
  PageMutationResult,
} from '../src/editor/session/projectMutation';
import { UnifiedEditorShell } from '../src/editor/session/UnifiedEditorChrome';
import { useProjectSessionStore } from '../src/editor/state/projectSessionStore';

const createCommands = (dirty = false): ProjectSessionCommands => ({
  save: vi.fn(async () => undefined),
  download: vi.fn(async () => null),
  notify: vi.fn(),
  isDirty: vi.fn(() => dirty),
  renameProject: vi.fn(async () => undefined),
  mutatePage: vi.fn(async (command: PageMutationCommand): Promise<PageMutationResult> => ({
    ok: true,
    status: 'success',
    kind: command.kind,
    projectId: command.projectId,
    affectedPageIds: [],
    activePageId: null,
    pageOrder: [],
    effects: {
      contentChanged: false,
      pageStructureChanged: false,
      assetEffects: 'none',
      selection: 'unchanged',
    },
  })),
  setViewportZoom: vi.fn(),
  fitPage: vi.fn(),
});

const createSession = (rendererKind: 'canvas' | 'document', isDirty = false) => {
  const descriptor = createProjectSessionDescriptor({
    editorMode: rendererKind,
    projectId: `${rendererKind}-project`,
    projectName: `${rendererKind} project`,
    pages: [
      rendererKind === 'document'
        ? {
            id: 'page-1',
            name: 'Opening',
            kind: 'document',
            size: { widthIn: 8.5, heightIn: 11, dpi: 300 },
          }
        : {
            id: 'page-1',
            name: 'Opening',
            kind: 'canvas',
            canvasSize: { width: 2550, height: 3300 },
          },
      rendererKind === 'document'
        ? {
            id: 'page-2',
            name: 'Continuation',
            kind: 'document',
            size: { widthIn: 8.5, heightIn: 11, dpi: 300 },
          }
        : {
            id: 'page-2',
            name: 'Continuation',
            kind: 'canvas',
            canvasSize: { width: 2550, height: 3300 },
          },
    ],
    document: rendererKind === 'document'
      ? {
          pageSize: { dpi: 300 },
          folios: { startingNumber: 49 },
        }
      : { pageSize: { dpi: 300 } },
    activePageIndex: 0,
  }, { source: 'library' });
  return createSessionSnapshot(descriptor, isDirty, isDirty ? 'unsaved' : 'saved');
};

const renderShell = (
  session: ReturnType<typeof createSession>,
  commands: ProjectSessionCommands,
  zoom: number,
  onBackToDashboard?: () => void
) => render(React.createElement(
  UnifiedEditorShell,
  { session, commands, zoom, onBackToDashboard },
  React.createElement('div', { 'data-testid': 'legacy-renderer' })
));

describe('UnifiedEditorSession Phase 1b shared chrome', () => {
  afterEach(() => {
    cleanup();
    useProjectSessionStore.getState().clearSession();
  });

  it('owns Canvas page navigation, project identity, save state, and zoom while delegating commands', () => {
    const session = createSession('canvas');
    const commands = createCommands();
    renderShell(session, commands, 0.75);

    expect(screen.getByTestId('unified-project-header')).toBeTruthy();
    expect(screen.getByTestId('project-name-display').textContent).toContain('canvas project');
    expect(screen.getByTestId('unified-save-status').textContent).toContain('Saved');
    expect(screen.getByTestId('product-page-navigator').textContent).toContain('2 total');
    expect(screen.getByTestId('page-strip')).toBeTruthy();
    expect(screen.getByTestId('unified-zoom-controls').textContent).toContain('75%');

    fireEvent.click(screen.getByRole('button', { name: 'Go to page 2 Continuation' }));
    fireEvent.click(within(screen.getByTestId('page-strip')).getByText('Page 2'));
    fireEvent.click(within(screen.getByTestId('product-page-navigator')).getByRole('button', { name: 'Add Page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fit page' }));

    expect(commands.mutatePage).toHaveBeenCalledWith({
      kind: 'select-page',
      projectId: 'canvas-project',
      pageId: 'page-2',
    });
    expect(commands.mutatePage).toHaveBeenCalledWith({
      kind: 'add-page',
      projectId: 'canvas-project',
    });
    expect(commands.setViewportZoom).toHaveBeenCalledWith(0.85);
    expect(commands.fitPage).toHaveBeenCalled();
  });

  it('uses the same lifecycle and page contract for Document without exposing engine state', () => {
    const session = createSession('document');
    const commands = createCommands();
    renderShell(session, commands, 1);

    expect((screen.getByTestId('document-project-name') as HTMLInputElement).value).toBe('document project');
    expect(screen.getByTestId('document-save-status').textContent).toContain('Saved');
    expect(screen.getByTestId('document-page-navigation')).toBeTruthy();
    expect(screen.getByTestId('document-page-tab-0').getAttribute('aria-label')).toBe('Open Opening, folio 49');
    expect(screen.getByTestId('document-zoom-controls')).toBeTruthy();

    fireEvent.click(screen.getByTestId('document-page-tab-1'));
    fireEvent.click(screen.getByTestId('document-add-page'));
    fireEvent.click(screen.getByTestId('document-duplicate-page'));
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));

    expect(commands.mutatePage).toHaveBeenCalledWith({
      kind: 'select-page',
      projectId: 'document-project',
      pageId: 'page-2',
    });
    expect(commands.mutatePage).toHaveBeenCalledWith({
      kind: 'add-page',
      projectId: 'document-project',
    });
    expect(commands.mutatePage).toHaveBeenCalledWith({
      kind: 'duplicate-page',
      projectId: 'document-project',
      sourcePageId: 'page-1',
    });
    expect(commands.save).toHaveBeenCalledWith('document project');
  });

  it('keeps dirty navigation protection in the shared shell', async () => {
    const session = createSession('document', true);
    const commands = createCommands(true);
    const onBackToDashboard = vi.fn();
    renderShell(session, commands, 1, onBackToDashboard);

    fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }));
    expect(screen.getByTestId('unsaved-navigation-dialog')).toBeTruthy();
    expect(onBackToDashboard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
    await waitFor(() => expect(onBackToDashboard).toHaveBeenCalledTimes(1));
    expect(useProjectSessionStore.getState().session).toBeNull();
  });
});
