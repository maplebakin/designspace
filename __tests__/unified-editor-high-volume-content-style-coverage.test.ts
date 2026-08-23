import React from 'react';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import * as fabric from 'fabric';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ControlSlider } from '../src/editor/components/Tooltip';
import { DocumentEditorShell } from '../src/document/components/DocumentEditorShell';
import { TitleEditor } from '../src/document/components/TitleEditor';
import { FlowEditor } from '../src/document/components/FlowEditor';
import {
  documentAuthoredContentDiffers,
} from '../src/document/services/documentContentObservation';
import { flushDocumentLiveDrafts } from '../src/document/services/documentLiveDraft';
import { useDocumentStore } from '../src/document/state/documentStore';
import {
  createProjectChangeCoordinator,
} from '../src/editor/session/projectChangeCoordinator';
import {
  observeCommittedEngineChange,
} from '../src/editor/session/projectChangeAdapters';
import {
  createProjectChangeDiagnosticObserver,
} from '../src/editor/session/projectChangeDiagnostic';
import { registerObjectEventHandlers } from '../src/editor/services/canvasEventService';
import {
  readCanvasStyleValue,
  withCanvasObjectMutationSuppressed,
} from '../src/editor/services/canvasMutationObservation';
import { useEditorStore } from '../src/editor/state/editorStore';
import { useHistoryStore } from '../src/editor/state/useHistoryStore';
import type { Editor, JSONContent } from '@tiptap/core';

vi.mock('../src/document/services/documentReferenceService', () => ({
  ingestDocumentReference: vi.fn(),
}));

type CanvasHarness = {
  canvas: fabric.Canvas;
  element: HTMLCanvasElement;
};

const originalEditorState = useEditorStore.getState();
const originalHistoryState = useHistoryStore.getState();
const canvases: CanvasHarness[] = [];
const originalElementGetClientRects = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'getClientRects'
);
const originalElementGetBoundingClientRect = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'getBoundingClientRect'
);
const originalRangeGetClientRects = Object.getOwnPropertyDescriptor(
  Range.prototype,
  'getClientRects'
);
const originalRangeGetBoundingClientRect = Object.getOwnPropertyDescriptor(
  Range.prototype,
  'getBoundingClientRect'
);

beforeAll(() => {
  if (!originalElementGetClientRects) {
    Object.defineProperty(Element.prototype, 'getClientRects', {
      configurable: true,
      value: () => [],
    });
  }
  if (!originalElementGetBoundingClientRect) {
    Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(),
    });
  }
  if (!originalRangeGetClientRects) {
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [],
    });
  }
  if (!originalRangeGetBoundingClientRect) {
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(),
    });
  }
});

afterAll(() => {
  if (!originalElementGetClientRects) {
    delete (Element.prototype as Partial<Element>).getClientRects;
  }
  if (!originalElementGetBoundingClientRect) {
    delete (Element.prototype as Partial<Element>).getBoundingClientRect;
  }
  if (!originalRangeGetClientRects) {
    delete (Range.prototype as Partial<Range>).getClientRects;
  }
  if (!originalRangeGetBoundingClientRect) {
    delete (Range.prototype as Partial<Range>).getBoundingClientRect;
  }
});

const createCanvas = () => {
  const element = document.createElement('canvas');
  element.width = 480;
  element.height = 320;
  document.body.appendChild(element);
  const canvas = new fabric.Canvas(element, {
    width: 480,
    height: 320,
    renderOnAddRemove: false,
  });
  canvases.push({ canvas, element });
  return canvas;
};

const installCanvas = (canvas: fabric.Canvas) => {
  useEditorStore.setState({
    canvas,
    canvasReadyState: 'ready',
    canvasObjects: [],
    selectedObjectId: null,
    selectedLayerIds: [],
    layers: [],
    layersById: {},
    dirtyObjectsRef: new Set(),
    committedMutationObserver: null,
    currentLibraryProjectId: null,
    isDirty: false,
    changeRevision: 0,
    autoSaveStatus: 'idle',
    saveStatus: 'saved',
    syncLock: { isLocked: false, reason: null, queuedSync: false },
  });
  useHistoryStore.getState().resetHistory();
  useHistoryStore.getState().takeSnapshot();
};

const seedText = (canvas: fabric.Canvas, id = 'canvas-text') => {
  const text = new fabric.IText('', {
    id,
    left: 32,
    top: 40,
    fontFamily: 'Inter, sans-serif',
  });
  canvas.add(text);
  useEditorStore.getState().syncCanvasToStore(canvas);
  useEditorStore.getState().selectObjectById(id);
  useHistoryStore.getState().resetHistory();
  useHistoryStore.getState().takeSnapshot();
  useEditorStore.setState({
    isDirty: false,
    changeRevision: 0,
    autoSaveStatus: 'idle',
    saveStatus: 'saved',
  });
  return text;
};

const installCanvasDiagnostic = (projectId = 'high-volume-canvas') => {
  const coordinator = createProjectChangeCoordinator();
  const diagnostic = createProjectChangeDiagnosticObserver({ coordinator });
  diagnostic.observeSession({
    projectId,
    legacyDirty: false,
    legacySaveStatus: 'saved',
  });
  const committed = vi.fn((mutation: any) => {
    const domains = mutation.action === 'modify-freeform-style'
      ? ['style'] as const
      : ['freeform-content'] as const;
    observeCommittedEngineChange(coordinator, {
      projectId,
      source: 'canvas',
      action: mutation.action,
      pageIds: ['canvas-page'],
      domains,
      target: {
        kind: 'freeform-object',
        id: mutation.objectId,
      },
      assetEffect: 'none',
    });
  });
  useEditorStore.getState().setCommittedMutationObserver(committed);
  return { coordinator, diagnostic, committed };
};

const registerTextHandlers = (
  canvas: fabric.Canvas,
  onCommittedMutation: (mutation: any) => void
) => registerObjectEventHandlers({
  canvas,
  callbacks: {
    onUpdate: (updatedCanvas) => {
      useEditorStore.getState().syncCanvasToStore(updatedCanvas);
      useEditorStore.getState().saveState();
    },
    onCommittedMutation,
  },
});

const runTextEditingSession = (
  canvas: fabric.Canvas,
  text: fabric.IText,
  value: string
) => {
  canvas.fire('text:editing:entered', { target: text });
  text.set('text', value);
  canvas.fire('text:changed', { target: text });
  canvas.fire('text:editing:exited', { target: text });
  canvas.fire('object:modified', { target: text });
};

describe('Unified Editor high-volume authored content and style coverage', () => {
  beforeEach(() => {
    useDocumentStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    canvases.splice(0).forEach(({ canvas, element }) => {
      canvas.dispose();
      element.remove();
    });
    useEditorStore.setState(originalEditorState, true);
    useHistoryStore.setState(originalHistoryState, true);
    useDocumentStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('groups all changed Fabric text in one entered/exited editing session', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const text = seedText(canvas);
    const { coordinator, diagnostic, committed } = installCanvasDiagnostic();
    const registration = registerTextHandlers(canvas, committed);

    runTextEditingSession(canvas, text, 'several characters');
    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledWith({
      action: 'modify-freeform-text-content',
      objectId: 'canvas-text',
    });
    expect(diagnostic.view.getSnapshot()).toMatchObject({
      observedRevision: 1,
      committedTransactionCount: 1,
      lastCommittedTransaction: {
        action: 'modify-freeform-text-content',
        domains: ['freeform-content'],
        target: { kind: 'freeform-object', id: 'canvas-text' },
        assetEffect: 'none',
      },
    });
    expect(diagnostic.view.getSnapshot().coverage).toMatchObject({
      canvasTextContent: true,
      canvasExplicitStyleControls: true,
      documentTitleContent: true,
      documentBodyContent: true,
      documentTextFormatting: true,
      documentStyleMetadata: true,
      completeAuthoredCoverage: true,
    });
    expect((canvas.getObjects()[0] as fabric.IText).text).toBe('several characters');
    expect((useEditorStore.getState().canvasObjects[0] as any).text).toBe('several characters');
    expect(useEditorStore.getState().isDirty).toBe(true);

    registration.cleanup();
    diagnostic.dispose();
    coordinator.dispose();
  });

  it('observes an explicit Canvas style commit only after live and store state agree', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const shape = new fabric.Rect({
      id: 'canvas-style',
      width: 80,
      height: 60,
      fill: '#ff0000',
      opacity: 1,
    });
    canvas.add(shape);
    useEditorStore.getState().syncCanvasToStore(canvas);
    const { coordinator, diagnostic, committed } = installCanvasDiagnostic();
    const beforeValue = readCanvasStyleValue(shape, 'opacity');

    shape.set('opacity', 0.6);
    useEditorStore.getState().syncCanvasToStore(canvas);
    useEditorStore.getState().reportCommittedCanvasStyle(
      'canvas-style',
      'opacity',
      beforeValue,
      0.6,
    );

    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledWith({
      action: 'modify-freeform-style',
      objectId: 'canvas-style',
      style: 'opacity',
    });
    expect(diagnostic.view.getSnapshot()).toMatchObject({
      observedRevision: 1,
      committedTransactionCount: 1,
      lastCommittedTransaction: {
        action: 'modify-freeform-style',
        domains: ['style'],
        target: { kind: 'freeform-object', id: 'canvas-style' },
        assetEffect: 'none',
      },
    });

    useEditorStore.getState().reportCommittedCanvasStyle(
      'canvas-style',
      'opacity',
      0.6,
      0.6,
    );
    expect(committed).toHaveBeenCalledTimes(1);
    expect((useEditorStore.getState().canvasObjects[0] as any).opacity).toBe(0.6);

    diagnostic.dispose();
    coordinator.dispose();
  });

  it('emits no Canvas text transaction for unchanged sessions, invalid targets, or replay', () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const text = seedText(canvas);
    const { coordinator, diagnostic, committed } = installCanvasDiagnostic();
    const registration = registerTextHandlers(canvas, committed);

    canvas.fire('text:editing:entered', { target: text });
    canvas.fire('text:editing:exited', { target: text });
    expect(committed).not.toHaveBeenCalled();

    useEditorStore.setState({
      syncLock: { isLocked: true, reason: 'undo', queuedSync: false },
    });
    runTextEditingSession(canvas, text, 'replay text');
    expect(committed).not.toHaveBeenCalled();

    useEditorStore.setState({
      syncLock: { isLocked: false, reason: null, queuedSync: false },
      selectedObjectId: 'stale-id',
    });
    canvas.fire('text:editing:entered', { target: text });
    text.set('text', 'stale text');
    canvas.fire('text:editing:exited', { target: text });
    withCanvasObjectMutationSuppressed(canvas, () => canvas.remove(text));
    canvas.fire('object:modified', { target: text });
    expect(committed).not.toHaveBeenCalled();
    expect(diagnostic.view.getSnapshot().observedRevision).toBe(0);

    registration.cleanup();
    diagnostic.dispose();
    coordinator.dispose();
  });

  it('keeps Fabric text editing successful when the optional observer throws', async () => {
    const canvas = createCanvas();
    installCanvas(canvas);
    const text = seedText(canvas);
    const observer = vi.fn(() => {
      throw new Error('shadow stream unavailable');
    });
    const registration = registerTextHandlers(canvas, observer);

    expect(() => runTextEditingSession(canvas, text, 'observer-safe')).not.toThrow();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(text.text).toBe('observer-safe');
    expect((useEditorStore.getState().canvasObjects[0] as any).text).toBe('observer-safe');
    expect(useEditorStore.getState().isDirty).toBe(true);
    expect(useHistoryStore.getState().canUndo()).toBe(true);

    registration.cleanup();
  });

  it('provides one explicit range commit for pointer and keyboard interaction', () => {
    const changes: number[] = [];
    const commits: Array<[number, number]> = [];
    render(React.createElement(ControlSlider, {
      min: 0,
      max: 1,
      step: 0.01,
      value: 0.2,
      onChange: (value: number) => changes.push(value),
      onCommit: (value: number, initialValue: number) => commits.push([value, initialValue]),
    }));
    const slider = screen.getByRole('slider');

    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '0.7' } });
    fireEvent.change(slider, { target: { value: '0.8' } });
    fireEvent.pointerUp(slider, { target: { value: '0.8' } });
    expect(changes).toEqual([0.7, 0.8]);
    expect(commits).toEqual([[0.8, 0.2]]);

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.change(slider, { target: { value: '0.81' } });
    fireEvent.keyUp(slider, { key: 'ArrowRight', target: { value: '0.81' } });
    expect(commits).toEqual([[0.8, 0.2], [0.81, 0.2]]);
  });

  it('does not classify image-only ProseMirror transactions as body content changes', () => {
    const before = {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    };
    const afterImage = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'documentFlowImage',
          attrs: { id: 'image-1', assetId: 'asset-1' },
        }],
      }],
    };
    const afterText = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'authored text' }],
      }],
    };
    expect(documentAuthoredContentDiffers(before, afterImage)).toBe(false);
    expect(documentAuthoredContentDiffers(before, afterText)).toBe(true);
  });

  it('passes real ProseMirror transactions from TitleEditor and FlowEditor', async () => {
    let titleEditor: Editor | null = null;
    const titleTransactions: any[] = [];
    render(React.createElement(TitleEditor, {
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Title' }] }],
      } as JSONContent,
      onEditorReady: (editor: Editor | null) => { titleEditor = editor; },
      onUpdate: (_content: JSONContent, _editor: Editor, transaction: any) => {
        titleTransactions.push(transaction);
      },
    }));
    await waitFor(() => expect(titleEditor).not.toBeNull());
    act(() => {
      titleEditor!.commands.insertContent(' edited');
    });
    expect(titleTransactions.some((transaction) => transaction.docChanged)).toBe(true);

    let bodyEditor: Editor | null = null;
    const bodyTransactions: any[] = [];
    render(React.createElement(FlowEditor, {
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }],
      } as JSONContent,
      columnCount: 1,
      columnGapPx: 24,
      dropCap: false,
      resolveAssetSource: () => undefined,
      onEditorReady: (editor: Editor | null) => { bodyEditor = editor; },
      onUpdate: (_content: JSONContent, _editor: Editor, transaction: any) => {
        bodyTransactions.push(transaction);
      },
    }));
    await waitFor(() => expect(bodyEditor).not.toBeNull());
    act(() => {
      bodyEditor!.commands.insertContent(' edited');
    });
    expect(bodyTransactions.some((transaction) => transaction.docChanged)).toBe(true);
  });

  it('observes only completed discrete Document style metadata updates', async () => {
    useDocumentStore.getState().createBlankProject('High volume document');
    const committed = vi.fn();
    render(React.createElement(DocumentEditorShell, {
      onCommittedMutation: committed,
    }));
    await waitFor(() => expect(screen.getByLabelText('Document body')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Named style font family'), {
      target: { value: 'book-serif' },
    });
    expect(committed).toHaveBeenCalledWith({
      action: 'modify-document-style-metadata',
      pageId: useDocumentStore.getState().project!.pages[0].id,
    });
    expect(committed).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Named style font size'), {
      target: { value: '22' },
    });
    expect(committed).toHaveBeenCalledTimes(1);
  });

  it('observes a real Tiptap body edit once and preserves the final store content', async () => {
    useDocumentStore.getState().createBlankProject('High volume document');
    const committed = vi.fn();
    render(React.createElement(DocumentEditorShell, {
      onCommittedMutation: committed,
    }));
    await waitFor(() => expect(screen.getByLabelText('Document body')).toBeTruthy());

    const body = screen.getByLabelText('Document body') as HTMLElement;
    const paragraph = body.querySelector('p');
    expect(paragraph).not.toBeNull();
    await act(async () => {
      body.focus();
      paragraph!.textContent = 'Several authored words';
      paragraph!.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: 'Several authored words',
        inputType: 'insertText',
      }));
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const pageId = useDocumentStore.getState().project!.pages[0].id;
    await waitFor(() => {
      expect(committed).toHaveBeenCalledWith({
        action: 'modify-structured-body-content',
        pageId,
      });
    });
    expect(committed).toHaveBeenCalledTimes(1);
    act(() => {
      flushDocumentLiveDrafts();
    });
    expect(JSON.stringify(useDocumentStore.getState().project!.pages[0].bodyContent))
      .toContain('Several authored words');
  });
});
