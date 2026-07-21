import React from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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
import { DocumentEditorShell } from '../src/document/components/DocumentEditorShell';
import {
  FlowEditor,
  isDocumentFlowOverflowing,
} from '../src/document/components/FlowEditor';
import { TitleEditor } from '../src/document/components/TitleEditor';
import { useDocumentStore } from '../src/document/state/documentStore';
import type {
  DocumentContentJson,
  DocumentOverlayImage,
  ScanReference,
} from '../src/document/types/documentProject';
import { calculateFitPageZoom } from '../src/document/utils/documentViewport';
import {
  documentPointsToPixels,
} from '../src/document/extensions/DocumentTextStyleExtension';
import {
  buildDocumentSpanLayoutModel,
} from '../src/document/components/StructuredDocumentSpanLayout';
import {
  canMoveSelectedStructuredImage,
} from '../src/document/extensions/DocumentImageExtension';

vi.mock('../src/document/services/documentReferenceService', () => ({
  ingestDocumentReference: vi.fn(),
}));

const originalRangeGetClientRects = Object.getOwnPropertyDescriptor(
  Range.prototype,
  'getClientRects'
);
const originalRangeGetBoundingClientRect = Object.getOwnPropertyDescriptor(
  Range.prototype,
  'getBoundingClientRect'
);

const overlay: DocumentOverlayImage = {
  id: 'overlay-portrait',
  assetId: 'asset-portrait',
  altText: 'Portrait of Ada',
  xPx: 84,
  yPx: 132,
  widthPx: 300,
  heightPx: 200,
  placement: 'front',
  caption: 'Ada, 1986',
  naturalWidth: 1200,
  naturalHeight: 800,
};

const reference: ScanReference = {
  assetId: 'asset-reference',
  sourceType: 'image',
  opacity: 0.35,
  fit: 'contain',
  scale: 1,
  offsetXPx: 0,
  offsetYPx: 0,
  visible: true,
  locked: true,
};

const readDocumentText = (content?: DocumentContentJson): string => [
  content?.text || '',
  ...(content?.content || []).map(readDocumentText),
].join('');

const findDocumentImageNode = (content?: JSONContent): JSONContent | undefined => {
  if (
    content?.type === 'documentInlineImage'
    || content?.type === 'documentFlowImage'
  ) {
    return content;
  }
  for (const child of content?.content || []) {
    const image = findDocumentImageNode(child);
    if (image) return image;
  }
  return undefined;
};

const findTextNodes = (content?: JSONContent): JSONContent[] => {
  if (!content) return [];
  return [
    ...(content.type === 'text' ? [content] : []),
    ...(content.content || []).flatMap(findTextNodes),
  ];
};

const spanningBodyContent = (
  spanCount: 2 | 3,
  spanStartColumn: 1 | 2 = 1
): JSONContent => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Text above the photograph.' }],
    },
    {
      type: 'documentFlowImage',
      attrs: {
        id: 'span-family-photo',
        assetId: 'asset-span-family',
        altText: 'Family outside the farmhouse',
        widthPx: 520,
        heightPx: 325,
        naturalWidth: 1600,
        naturalHeight: 1000,
        wrap: 'span-columns',
        spanCount,
        spanStartColumn,
        wrapPaddingPx: 12,
        verticalSpacingPx: 18,
        caption: 'The family home, circa 1932',
      },
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'The unoccupied column continues here.' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'The article continues below the photograph.' }],
    },
  ],
});

const topLevelBodyOrder = (content: JSONContent): string[] =>
  (content.content || []).map((node) => {
    if (node.type === 'documentFlowImage') {
      return `image:${String(node.attrs?.id || '')}`;
    }
    return (node.content || [])
      .map((child) => child.text || '')
      .join('');
  });

const normalizeBodyWithoutSpanImage = (content: JSONContent): JSONContent => {
  const normalized = JSON.parse(JSON.stringify(content)) as JSONContent;
  normalized.content = (normalized.content || []).filter(
    (node) => node.type !== 'documentFlowImage'
  );
  while (
    normalized.content.length > 0
    && normalized.content[normalized.content.length - 1].type === 'paragraph'
    && !normalized.content[normalized.content.length - 1].content?.length
  ) {
    normalized.content.pop();
  }
  return normalized;
};

const countTextOccurrences = (value: string, search: string) =>
  value.split(search).length - 1;

const readColumnMajorModelHtml = (
  model: NonNullable<ReturnType<typeof buildDocumentSpanLayoutModel>>
) => {
  const start = model.attributes.spanStartColumn;
  const end = start + model.attributes.spanCount - 1;
  return [
    ...model.columns
      .filter((column) => column.column < start)
      .map((column) => column.topHtml),
    ...model.columns
      .filter((column) => column.column >= start && column.column <= end)
      .map((column) => column.topHtml),
    ...model.columns
      .filter((column) => column.column > end)
      .map((column) => column.topHtml),
    ...model.columns
      .filter((column) => column.column >= start && column.column <= end)
      .map((column) => column.bottomHtml),
  ].join('');
};

const renderShell = async () => {
  const result = render(React.createElement(DocumentEditorShell));
  await waitFor(() => {
    expect(screen.queryByLabelText('Document title')).not.toBeNull();
    expect(screen.queryByLabelText('Document body')).not.toBeNull();
  });
  return result;
};

const addOverlayFixture = () => {
  const store = useDocumentStore.getState();
  store.addAsset(overlay.assetId, 'data:image/png;base64,PORTRAIT');
  store.addOverlay(overlay);
};

const createPasteEvent = ({
  html = '',
  text = '',
}: {
  html?: string;
  text?: string;
}) => {
  const event = new Event('paste', {
    bubbles: true,
    cancelable: true,
  }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: {
      files: [],
      items: [],
      types: html ? ['text/html', 'text/plain'] : ['text/plain'],
      getData: (type: string) => {
        if (type === 'text/html') return html;
        if (type === 'text/plain' || type === 'text') return text;
        return '';
      },
    },
  });
  return event;
};

describe('live document editor UI', () => {
  beforeAll(() => {
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
    if (!originalRangeGetClientRects) {
      delete (Range.prototype as Partial<Range>).getClientRects;
    }
    if (!originalRangeGetBoundingClientRect) {
      delete (Range.prototype as Partial<Range>).getBoundingClientRect;
    }
  });

  beforeEach(() => {
    useDocumentStore.getState().reset();
    useDocumentStore.getState().createBlankProject('Archive Notes');
  });

  afterEach(() => {
    cleanup();
    useDocumentStore.getState().reset();
  });

  it('renders the document shell with separate title and body editors and no Fabric canvas', async () => {
    const { container } = await renderShell();

    expect(screen.queryByTestId('document-editor-shell')).not.toBeNull();
    expect(screen.queryByTestId('document-top-bar')).not.toBeNull();
    expect(screen.queryByTestId('document-properties-sidebar')).not.toBeNull();
    expect(screen.queryByTestId('document-context-toolbar')).not.toBeNull();
    expect(screen.queryByTestId('document-zoom-controls')).not.toBeNull();
    expect(screen.queryByTestId('document-workspace')).not.toBeNull();
    expect(screen.queryByTestId('document-page')).not.toBeNull();
    expect(screen.queryByTestId('document-title-editor')).not.toBeNull();
    expect(screen.queryByTestId('document-flow-editor')).not.toBeNull();
    expect(screen.getByTestId('document-context-toolbar').getAttribute('data-context')).toBe('body');
    expect(screen.getByLabelText('Document title').getAttribute('contenteditable')).toBe('true');
    expect(screen.getByLabelText('Document body').getAttribute('contenteditable')).toBe('true');
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('[data-testid="canvas-stage"]')).toBeNull();
    expect(container.querySelector('.canvas-container')).toBeNull();
  });

  it('persists column count, gap, and drop-cap controls to the document store and page', async () => {
    await renderShell();

    fireEvent.click(screen.getByRole('button', { name: '3 columns' }));
    fireEvent.change(screen.getByLabelText('Column gap in pixels'), {
      target: { value: '40' },
    });
    fireEvent.click(screen.getByTestId('document-drop-cap-toggle'));

    const page = useDocumentStore.getState().project?.pages[0];
    expect(page?.columnCount).toBe(3);
    expect(page?.columnGapPx).toBe(40);
    expect(page?.dropCap).toBe(true);
    expect(useDocumentStore.getState().isDirty).toBe(true);
    expect(screen.getByTestId('document-flow-editor').getAttribute('data-column-count')).toBe('3');
    expect(screen.getByTestId('document-flow-editor').getAttribute('data-drop-cap')).toBe('true');
    expect(
      screen.getByTestId('document-body-region').style.getPropertyValue('--document-column-gap')
    ).toBe('40px');
    expect(screen.getByRole('button', { name: '3 columns' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('document-drop-cap-toggle').getAttribute('aria-pressed')).toBe('true');
  });

  it('switches Letter and A4 between portrait and landscape and reflows columns', async () => {
    await renderShell();
    fireEvent.click(screen.getByRole('button', { name: '3 columns' }));

    const exportRoot = screen.getByTestId('document-export-root');
    const body = screen.getByLabelText('Document body') as HTMLElement;
    expect(screen.getByTestId('document-page-orientation').getAttribute(
      'data-value'
    )).toBe('portrait');
    expect(exportRoot.getAttribute('data-page-width-in')).toBe('8.5');
    expect(exportRoot.getAttribute('data-page-height-in')).toBe('11');

    fireEvent.click(screen.getByRole('button', {
      name: 'Landscape orientation',
    }));
    expect(useDocumentStore.getState().project?.pages[0].size).toMatchObject({
      presetId: 'letter',
      orientation: 'landscape',
      widthIn: 11,
      heightIn: 8.5,
    });
    expect(exportRoot.getAttribute('data-page-orientation')).toBe('landscape');
    expect(body.style.columnCount).toBe('');
    expect(screen.getByTestId('document-flow-editor').getAttribute(
      'data-column-count'
    )).toBe('3');

    fireEvent.change(screen.getByLabelText('Page preset'), {
      target: { value: 'a4' },
    });
    let size = useDocumentStore.getState().project!.pages[0].size;
    expect(size.orientation).toBe('landscape');
    expect(size.widthIn).toBeCloseTo(297 / 25.4, 8);
    expect(size.heightIn).toBeCloseTo(210 / 25.4, 8);

    fireEvent.click(screen.getByRole('button', {
      name: 'Portrait orientation',
    }));
    size = useDocumentStore.getState().project!.pages[0].size;
    expect(size.orientation).toBe('portrait');
    expect(size.widthIn).toBeCloseTo(210 / 25.4, 8);
    expect(size.heightIn).toBeCloseTo(297 / 25.4, 8);
    expect(screen.getByTestId('document-flow-editor').getAttribute(
      'data-column-count'
    )).toBe('3');
  });

  it('keeps all four margin fields readable and persists their page values', async () => {
    await renderShell();

    fireEvent.change(screen.getByLabelText('Top margin in inches'), {
      target: { value: '0.5' },
    });
    fireEvent.change(screen.getByLabelText('Right margin in inches'), {
      target: { value: '0.6' },
    });
    fireEvent.change(screen.getByLabelText('Bottom margin in inches'), {
      target: { value: '0.7' },
    });
    fireEvent.change(screen.getByLabelText('Left margin in inches'), {
      target: { value: '0.8' },
    });

    expect(useDocumentStore.getState().project?.pages[0].margins).toEqual({
      topIn: 0.5,
      rightIn: 0.6,
      bottomIn: 0.7,
      leftIn: 0.8,
    });
  });

  it('persists basic title and body DOM typing through their Tiptap editors', async () => {
    await renderShell();
    expect(screen.queryByTestId('document-title-placeholder')).not.toBeNull();
    expect(screen.queryByTestId('document-body-placeholder')).not.toBeNull();
    expect(
      screen.getByTestId('document-title-placeholder').getAttribute(
        'data-document-export-exclude'
      )
    ).toBe('true');
    expect(
      screen.getByTestId('document-body-placeholder').getAttribute(
        'data-document-export-exclude'
      )
    ).toBe('true');
    const title = screen.getByLabelText('Document title') as HTMLElement;
    const body = screen.getByLabelText('Document body') as HTMLElement;
    const titleParagraph = title.querySelector('p');
    const bodyParagraph = body.querySelector('p');
    expect(titleParagraph).not.toBeNull();
    expect(bodyParagraph).not.toBeNull();

    await act(async () => {
      title.focus();
      titleParagraph!.textContent = 'A typed title';
      titleParagraph!.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: 'A typed title',
        inputType: 'insertText',
      }));
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(
        readDocumentText(useDocumentStore.getState().project?.pages[0].titleContent)
      ).toContain('A typed title');
      expect(screen.queryByTestId('document-title-placeholder')).toBeNull();
    });

    await act(async () => {
      body.focus();
      bodyParagraph!.textContent = 'A typed body paragraph';
      bodyParagraph!.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: 'A typed body paragraph',
        inputType: 'insertText',
      }));
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(
        readDocumentText(useDocumentStore.getState().project?.pages[0].bodyContent)
      ).toContain('A typed body paragraph');
      expect(screen.queryByTestId('document-body-placeholder')).toBeNull();
    });
  });

  it('applies body text size to a selection and to future typing', async () => {
    let editor: Editor | null = null;
    render(React.createElement(FlowEditor, {
      content: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: 'Body copy' }],
        }],
      } as JSONContent,
      columnCount: 1,
      columnGapPx: 24,
      dropCap: false,
      resolveAssetSource: () => undefined,
      onEditorReady: (readyEditor: Editor | null) => {
        editor = readyEditor;
      },
    }));
    await waitFor(() => expect(editor).not.toBeNull());

    act(() => {
      editor!.commands.setTextSelection({ from: 1, to: 5 });
      editor!.commands.setDocumentFontSize(documentPointsToPixels(16));
      editor!.commands.setTextSelection(10);
      editor!.commands.setDocumentFontSize(documentPointsToPixels(12));
      editor!.commands.insertContent(' typed');
    });

    const textNodes = findTextNodes(editor!.getJSON());
    expect(textNodes.find((node) => node.text === 'Body')?.marks).toContainEqual({
      type: 'documentTextStyle',
      attrs: { fontSizePx: documentPointsToPixels(16) },
    });
    expect(textNodes.find((node) => node.text === ' typed')?.marks).toContainEqual({
      type: 'documentTextStyle',
      attrs: { fontSizePx: documentPointsToPixels(12) },
    });
    expect(
      screen.getByLabelText('Document body').querySelector(
        `span[data-font-size-px="${documentPointsToPixels(16)}"]`
      )
    ).not.toBeNull();
  });

  it('applies title text size through the document text-style mark', async () => {
    let editor: Editor | null = null;
    render(React.createElement(TitleEditor, {
      content: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: 'Document title' }],
        }],
      } as JSONContent,
      onEditorReady: (readyEditor: Editor | null) => {
        editor = readyEditor;
      },
    }));
    await waitFor(() => expect(editor).not.toBeNull());

    act(() => {
      editor!.commands.selectAll();
      editor!.commands.setDocumentFontSize(documentPointsToPixels(24));
    });

    expect(findTextNodes(editor!.getJSON())[0]?.marks).toContainEqual({
      type: 'documentTextStyle',
      attrs: { fontSizePx: documentPointsToPixels(24) },
    });
    expect(
      screen.getByLabelText('Document title').querySelector(
        `span[data-font-size-px="${documentPointsToPixels(24)}"]`
      )
    ).not.toBeNull();
  });

  it('preserves mixed font sizes in one body document', async () => {
    let editor: Editor | null = null;
    render(React.createElement(FlowEditor, {
      content: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: 'Small Large' }],
        }],
      } as JSONContent,
      columnCount: 1,
      columnGapPx: 24,
      dropCap: false,
      resolveAssetSource: () => undefined,
      onEditorReady: (readyEditor: Editor | null) => {
        editor = readyEditor;
      },
    }));
    await waitFor(() => expect(editor).not.toBeNull());

    act(() => {
      editor!.commands.setTextSelection({ from: 1, to: 6 });
      editor!.commands.setDocumentFontSize(documentPointsToPixels(10));
      editor!.commands.setTextSelection({ from: 7, to: 12 });
      editor!.commands.setDocumentFontSize(documentPointsToPixels(18));
    });

    const sizes = findTextNodes(editor!.getJSON()).flatMap((node) =>
      (node.marks || [])
        .filter((mark) => mark.type === 'documentTextStyle')
        .map((mark) => mark.attrs?.fontSizePx)
    );
    expect(sizes).toContain(documentPointsToPixels(10));
    expect(sizes).toContain(documentPointsToPixels(18));
    expect(screen.getByLabelText('Document body').querySelectorAll(
      'span[data-font-size-px]'
    )).toHaveLength(2);
  });

  it('restores inline font sizes from persisted document JSON after reload', async () => {
    const fontSizePx = documentPointsToPixels(14);
    const store = useDocumentStore.getState();
    store.updateBodyContent({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'Persisted size',
          marks: [{
            type: 'documentTextStyle',
            attrs: { fontSizePx },
          }],
        }],
      }],
    });
    const serialized = JSON.stringify(useDocumentStore.getState().project);

    useDocumentStore.getState().reset();
    useDocumentStore.getState().hydrateProject(JSON.parse(serialized));
    await renderShell();

    const sizedText = screen.getByLabelText('Document body').querySelector(
      `span[data-font-size-px="${fontSizePx}"]`
    ) as HTMLElement | null;
    expect(sizedText?.textContent).toBe('Persisted size');
    expect(sizedText?.style.fontSize).toBe(`${fontSizePx}px`);
  });

  it('collapses document properties without hiding the workspace or page', async () => {
    await renderShell();

    fireEvent.click(screen.getByRole('button', {
      name: 'Collapse properties sidebar',
    }));
    expect(
      screen.getByTestId('document-properties-sidebar').getAttribute('aria-expanded')
    ).toBe('false');
    expect(screen.queryByTestId('document-workspace')).not.toBeNull();
    expect(screen.queryByTestId('document-page')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', {
      name: 'Expand properties sidebar',
    }));
    expect(
      screen.getByTestId('document-properties-sidebar').getAttribute('aria-expanded')
    ).toBe('true');
  });

  it('sanitizes HTML and normalizes plain text through the live Tiptap paste pipeline', async () => {
    let editor: Editor | null = null;
    render(React.createElement(TitleEditor, {
      content: {
        type: 'doc',
        content: [{ type: 'paragraph' }],
      } as JSONContent,
      onEditorReady: (readyEditor: Editor | null) => {
        editor = readyEditor;
      },
    }));

    await waitFor(() => {
      expect(editor).not.toBeNull();
      expect(screen.queryByLabelText('Document title')).not.toBeNull();
    });
    const title = screen.getByLabelText('Document title') as HTMLElement;

    act(() => {
      editor!.commands.focus('start');
    });
    fireEvent(title, createPasteEvent({
      html: [
        '<p onclick="steal()">',
        '<strong>Safe</strong>',
        '<script>evil()</script>',
        '<span style="font-size: 20px; color: red"> copy</span>',
        '<img src="https://example.invalid/tracker.png">',
        '</p>',
      ].join(''),
      text: 'Safe copy',
    }));

    await waitFor(() => {
      expect(title.textContent).toContain('Safe copy');
    });
    expect(title.textContent).not.toContain('evil');
    expect(title.querySelector('script')).toBeNull();
    expect(title.querySelector('img')).toBeNull();
    expect(title.querySelector('[onclick]')).toBeNull();
    expect(title.innerHTML).not.toContain('color');
    expect(title.innerHTML).toContain('font-size');

    act(() => {
      editor!.commands.clearContent();
      editor!.commands.focus('start');
    });
    fireEvent(title, createPasteEvent({
      text: 'First line\r\nSecond line\u0000',
    }));

    await waitFor(() => {
      expect(title.textContent).toContain('First line');
      expect(title.textContent).toContain('Second line');
    });
    expect(title.textContent).not.toContain('\u0000');
  });

  it('reflects the overflow warning state without placing it in the export root', async () => {
    await renderShell();

    act(() => {
      useDocumentStore.getState().setOverflowing(true);
    });

    const warning = screen.getByTestId('document-overflow-warning');
    expect(warning.getAttribute('role')).toBe('status');
    expect(warning.getAttribute('data-document-export-exclude')).toBe('true');
    expect(screen.getByTestId('document-export-root').contains(warning)).toBe(false);

    act(() => {
      useDocumentStore.getState().setOverflowing(false);
    });
    expect(screen.queryByTestId('document-overflow-warning')).toBeNull();
  });

  it('keeps a selected overlay while Delete comes from an input or editor, then deletes it from noneditable UI', async () => {
    addOverlayFixture();
    await renderShell();

    fireEvent.keyDown(screen.getByLabelText('Document project name'), {
      key: 'Delete',
    });
    expect(useDocumentStore.getState().project?.pages[0].overlayObjects).toHaveLength(1);

    const body = screen.getByLabelText('Document body') as HTMLElement;
    Object.defineProperty(body, 'isContentEditable', {
      configurable: true,
      value: true,
    });
    fireEvent.keyDown(body, { key: 'Delete' });
    expect(useDocumentStore.getState().project?.pages[0].overlayObjects).toHaveLength(1);

    fireEvent.keyDown(screen.getByTestId('document-workspace'), {
      key: 'Delete',
    });
    expect(useDocumentStore.getState().project?.pages[0].overlayObjects).toHaveLength(0);
    expect(useDocumentStore.getState().selectedOverlayId).toBeNull();
  });

  it('persists reference visibility and opacity controls and updates the live reference layer', async () => {
    const store = useDocumentStore.getState();
    store.addAsset(reference.assetId, 'data:image/png;base64,REFERENCE');
    store.setReference(reference);
    await renderShell();

    expect(screen.queryByTestId('document-reference-controls')).not.toBeNull();
    expect(screen.getByText('Locked')).not.toBeNull();
    expect(screen.getByTestId('document-reference-layer').style.opacity).toBe('0.35');
    fireEvent.change(screen.getByLabelText('Reference opacity'), {
      target: { value: '0.65' },
    });
    expect(
      useDocumentStore.getState().project?.pages[0].reference?.opacity
    ).toBe(0.65);
    expect(screen.getByTestId('document-reference-layer').style.opacity).toBe('0.65');

    fireEvent.click(screen.getByTestId('document-reference-visibility'));
    expect(
      useDocumentStore.getState().project?.pages[0].reference?.visible
    ).toBe(false);
    expect(screen.queryByTestId('document-reference-layer')).toBeNull();

    fireEvent.click(screen.getByTestId('document-reference-visibility'));
    expect(
      useDocumentStore.getState().project?.pages[0].reference?.visible
    ).toBe(true);
    expect(screen.queryByTestId('document-reference-layer')).not.toBeNull();
  });

  it('switches the contextual toolbar between text, image, and reference adjustment', async () => {
    const store = useDocumentStore.getState();
    store.addAsset(reference.assetId, 'data:image/png;base64,REFERENCE');
    store.setReference(reference);
    await renderShell();

    const contextToolbar = screen.getByTestId('document-context-toolbar');
    expect(contextToolbar.getAttribute('data-context')).toBe('body');
    expect(within(contextToolbar).queryByLabelText('Bold')).not.toBeNull();
    expect(within(contextToolbar).queryByLabelText('Body text font size')).not.toBeNull();
    expect(within(contextToolbar).queryByLabelText('Title text font size')).toBeNull();

    fireEvent.focus(screen.getByLabelText('Document title'));
    await waitFor(() => {
      expect(contextToolbar.getAttribute('data-context')).toBe('title');
    });
    expect(within(contextToolbar).queryByLabelText('Title text font size')).not.toBeNull();
    expect(within(contextToolbar).queryByLabelText('Body text font size')).toBeNull();

    act(() => {
      addOverlayFixture();
    });
    await waitFor(() => {
      expect(contextToolbar.getAttribute('data-context')).toBe('image');
    });
    expect(within(contextToolbar).queryByTestId('document-image-inspector')).not.toBeNull();
    expect(within(contextToolbar).queryByLabelText('Bold')).toBeNull();
    expect(within(contextToolbar).queryByTestId('document-font-size')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Adjust reference' }));
    expect(contextToolbar.getAttribute('data-context')).toBe('reference');
    expect(within(contextToolbar).queryByRole('button', {
      name: 'Finish adjusting',
    })).not.toBeNull();
    expect(within(contextToolbar).queryByTestId('document-image-inspector')).toBeNull();
    expect(within(contextToolbar).queryByLabelText('Bold')).toBeNull();
    expect(within(contextToolbar).queryByTestId('document-font-size')).toBeNull();

    fireEvent.click(within(contextToolbar).getByRole('button', {
      name: 'Finish adjusting',
    }));
    expect(contextToolbar.getAttribute('data-context')).toBe('title');
  });

  it('uses the selected overlay inspector to persist size, metadata, and placement', async () => {
    addOverlayFixture();
    await renderShell();
    expect(screen.queryByTestId('document-image-inspector')).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Image width'), {
      target: { value: '360' },
    });
    fireEvent.change(screen.getByLabelText('Image caption'), {
      target: { value: 'Updated caption' },
    });
    fireEvent.change(screen.getByLabelText('Image alt text'), {
      target: { value: 'Updated portrait description' },
    });
    fireEvent.change(screen.getByLabelText('Image layout mode'), {
      target: { value: 'behind' },
    });

    expect(
      useDocumentStore.getState().project?.pages[0].overlayObjects[0]
    ).toMatchObject({
      id: overlay.id,
      widthPx: 360,
      heightPx: 240,
      caption: 'Updated caption',
      altText: 'Updated portrait description',
      placement: 'behind',
    });
    expect(screen.getByTestId('document-image-width').getAttribute('value')).toBe('360');
    expect(screen.getByTestId('document-image-wrap').getAttribute('value')).toBeNull();
    expect((screen.getByTestId('document-image-wrap') as HTMLSelectElement).value).toBe('behind');
  });

  it('serializes and renders every flow image wrapping mode with its document attributes', async () => {
    let editor: Editor | null = null;
    let latestContent: JSONContent | null = null;
    const { container } = render(React.createElement(FlowEditor, {
      content: {
        type: 'doc',
        content: [{ type: 'paragraph' }],
      } as JSONContent,
      columnCount: 1,
      columnGapPx: 24,
      dropCap: false,
      resolveAssetSource: () => 'data:image/png;base64,FLOW',
      onEditorReady: (readyEditor: Editor | null) => {
        editor = readyEditor;
      },
      onUpdate: (content: JSONContent) => {
        latestContent = content;
      },
    }));
    await waitFor(() => {
      expect(editor).not.toBeNull();
    });

    const modes = [
      ['inline', 'documentInlineImage'],
      ['float-left', 'documentFlowImage'],
      ['float-right', 'documentFlowImage'],
      ['top-bottom', 'documentFlowImage'],
    ] as const;

    for (const [wrap, nodeType] of modes) {
      const id = `flow-${wrap}`;
      await act(async () => {
        editor!.commands.clearContent();
        editor!.commands.insertDocumentImage({
          id,
          assetId: 'asset-flow',
          altText: `${wrap} diagram`,
          widthPx: 240,
          heightPx: 160,
          naturalWidth: 1200,
          naturalHeight: 800,
          wrap,
          wrapPaddingPx: 18,
          caption: `${wrap} caption`,
        });
        await Promise.resolve();
      });

      const imageNode = findDocumentImageNode(editor!.getJSON());
      expect(imageNode).toMatchObject({
        type: nodeType,
        attrs: {
          id,
          assetId: 'asset-flow',
          altText: `${wrap} diagram`,
          widthPx: 240,
          heightPx: 160,
          naturalWidth: 1200,
          naturalHeight: 800,
          wrap,
          wrapPaddingPx: 18,
          caption: `${wrap} caption`,
        },
      });
      expect(findDocumentImageNode(latestContent || undefined)).toMatchObject({
        type: nodeType,
        attrs: { id, wrap },
      });

      await waitFor(() => {
        expect(container.querySelector(`[data-image-id="${id}"]`)).not.toBeNull();
      });
      const nodeView = container.querySelector<HTMLElement>(
        `[data-image-id="${id}"]`
      )!;
      const imageElement = nodeView.querySelector<HTMLElement>(
        '[data-node-view-wrapper]'
      )!;
      expect(imageElement.tagName).toBe(wrap === 'inline' ? 'SPAN' : 'FIGURE');
      expect(imageElement.getAttribute('data-wrap')).toBe(wrap);
      expect(nodeView.getAttribute('data-width-px')).toBe('240');
      expect(nodeView.getAttribute('data-height-px')).toBe('160');
      expect(imageElement.style.width).toBe('240px');
      expect(
        imageElement.style.getPropertyValue('--document-image-wrap-padding')
      ).toBe('18px');
      expect(imageElement.querySelector('img')?.getAttribute('alt')).toBe(
        `${wrap} diagram`
      );
      expect(imageElement.textContent).toContain(`${wrap} caption`);
    }
  });

  it('opens legacy document content whose image nodes predate structured spans', async () => {
    let editor: Editor | null = null;
    const { container } = render(React.createElement(FlowEditor, {
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Legacy text before.' }],
          },
          {
            type: 'documentFlowImage',
            attrs: {
              id: 'legacy-flow-photo',
              assetId: 'legacy-flow-asset',
              altText: 'Legacy photograph',
              widthPx: 240,
              heightPx: 160,
              wrap: 'float-left',
              wrapPaddingPx: 12,
              caption: 'Legacy caption',
            },
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Legacy text after.' }],
          },
        ],
      } as JSONContent,
      columnCount: 3,
      columnGapPx: 24,
      dropCap: false,
      resolveAssetSource: () => 'data:image/png;base64,LEGACY',
      onEditorReady: (readyEditor: Editor | null) => {
        editor = readyEditor;
      },
    }));

    await waitFor(() => {
      expect(editor).not.toBeNull();
      expect(container.querySelector('[data-image-id="legacy-flow-photo"]'))
        .not.toBeNull();
    });
    expect(editor!.getText()).toContain('Legacy text before.');
    expect(editor!.getText()).toContain('Legacy text after.');
    expect(findDocumentImageNode(editor!.getJSON())?.attrs).toMatchObject({
      id: 'legacy-flow-photo',
      wrap: 'float-left',
      spanCount: 1,
      spanStartColumn: 1,
      verticalSpacingPx: 12,
      caption: 'Legacy caption',
    });
    expect(container.querySelector('[data-document-span-layout]')).toBeNull();
  });

  it.each([
    [2, 2, 1, null],
    [3, 2, 1, 3],
    [3, 2, 2, 1],
    [3, 3, 1, null],
  ] as const)(
    'renders %i-column layout with span %i from column %i',
    async (columnCount, spanCount, spanStartColumn, continuingColumn) => {
      let editor: Editor | null = null;
      const { container } = render(React.createElement(FlowEditor, {
        content: spanningBodyContent(spanCount, spanStartColumn),
        columnCount,
        columnGapPx: 24,
        dropCap: false,
        resolveAssetSource: () => 'data:image/png;base64,SPAN',
        onEditorReady: (readyEditor: Editor | null) => {
          editor = readyEditor;
        },
      }));
      await waitFor(() => {
        expect(editor).not.toBeNull();
        expect(container.querySelector('[data-document-span-layout]')).not.toBeNull();
      });

      const model = buildDocumentSpanLayoutModel(
        editor!,
        columnCount,
        24,
        720
      );
      expect(model).toMatchObject({
        attributes: { spanCount, spanStartColumn },
        sideColumn: continuingColumn,
      });
      expect(model?.beforeColumnHtml).toHaveLength(columnCount);
      expect(model?.afterColumnHtml).toHaveLength(columnCount);
      expect(model!.columnWidthPx).toBeGreaterThan(150);
      expect(model!.renderedImageWidthPx).toBeLessThanOrEqual(
        model!.spanWidthPx
      );
      const layout = container.querySelector('[data-document-span-layout]')!;
      expect(layout.classList.contains('document-flow-prosemirror')).toBe(false);
      expect(layout.querySelectorAll(
        '[data-layout-region="above"][data-layout-role="explicit-text-column"]'
      )).toHaveLength(columnCount);
      layout.querySelectorAll<HTMLElement>(
        '[data-layout-role="explicit-text-column"]'
      ).forEach((column) => {
        expect(column.style.columnCount).toBe('');
      });
      const occupied = layout.querySelector('[data-layout-role="occupied-columns"]')!;
      expect(occupied.getAttribute('data-start-column'))
        .toBe(String(spanStartColumn));
      expect(occupied.getAttribute('data-end-column'))
        .toBe(String(spanStartColumn + spanCount - 1));
      expect(occupied.textContent).toContain('The family home, circa 1932');
      expect(occupied.textContent).not.toContain('unoccupied column');
      expect(occupied.querySelector('figcaption')?.textContent)
        .toBe('The family home, circa 1932');
      const renderedText = Array.from(layout.querySelectorAll<HTMLElement>(
        '[data-layout-role="explicit-text-column"]'
      )).map((column) => column.textContent || '').join('');
      expect(renderedText).toContain('Text above the photograph.');
      expect(renderedText).toContain('The unoccupied column continues here.');
      expect(renderedText).toContain('The article continues below the photograph.');
      expect(countTextOccurrences(
        renderedText,
        'The unoccupied column continues here.'
      )).toBe(1);

      const side = layout.querySelector('[data-layout-role="continuing-column"]');
      if (continuingColumn === null) {
        expect(side).toBeNull();
      } else {
        expect(side?.getAttribute('data-column')).toBe(String(continuingColumn));
      }
    }
  );

  it.each([
    [1, 3],
    [2, 1],
  ] as const)(
    'allocates span text in column-major order with continuing column %i',
    async (spanStartColumn, continuingColumn) => {
      let editor: Editor | null = null;
      const trailingParagraphs = Array.from({ length: 9 }, (_, index) => ({
        type: 'paragraph',
        content: [{
          type: 'text',
          text: `REGION-${index + 1} ${'family history detail '.repeat(8)}`,
          ...(index === 4
            ? {
                marks: [{
                  type: 'documentTextStyle',
                  attrs: { fontSizePx: 18 },
                }],
              }
            : {}),
        }],
      }));
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{
              type: 'text',
              text: `UPPER ${'formatted archive introduction '.repeat(70)}`,
              marks: [{
                type: 'documentTextStyle',
                attrs: { fontSizePx: 18 },
              }],
            }],
          },
          spanningBodyContent(2, spanStartColumn).content![1],
          ...trailingParagraphs,
        ],
      } as JSONContent;
      render(React.createElement(FlowEditor, {
        content,
        columnCount: 3,
        columnGapPx: 24,
        dropCap: false,
        resolveAssetSource: () => 'data:image/png;base64,SPAN',
        onEditorReady: (readyEditor: Editor | null) => {
          editor = readyEditor;
        },
      }));
      await waitFor(() => expect(editor).not.toBeNull());

      const model = buildDocumentSpanLayoutModel(editor!, 3, 24, 720)!;
      expect(model.sideColumn).toBe(continuingColumn);
      expect(model.beforeColumnHtml).toHaveLength(3);
      expect(model.afterColumnHtml).toHaveLength(3);
      const renderedHtml = readColumnMajorModelHtml(model);
      expect(countTextOccurrences(renderedHtml, 'UPPER')).toBe(1);
      for (let index = 1; index <= 9; index += 1) {
        expect(countTextOccurrences(renderedHtml, `REGION-${index}`)).toBe(1);
      }
      const markerOffsets = Array.from({ length: 9 }, (_, index) =>
        renderedHtml.indexOf(`REGION-${index + 1}`)
      );
      expect(markerOffsets).toEqual([...markerOffsets].sort(
        (left, right) => left - right
      ));
      expect(renderedHtml).toContain('data-font-size-px="18"');
      expect(model.columns[continuingColumn - 1].bottomHtml).toBe('');
      if (continuingColumn === 1) {
        expect(model.columns[0].topHtml).toContain('UPPER');
        expect(model.columns[0].topHtml).not.toContain('REGION-9');
      } else {
        expect(model.columns[2].topHtml).toContain(
          'formatted archive introduction'
        );
      }
      expect(isDocumentFlowOverflowing({
        clientHeight: 720,
        clientWidth: 720,
        scrollHeight: 900,
        scrollWidth: 720,
        structuredOverflowing: false,
      })).toBe(false);
      expect(isDocumentFlowOverflowing({
        clientHeight: 720,
        clientWidth: 720,
        scrollHeight: 720,
        scrollWidth: 720,
        structuredOverflowing: true,
      })).toBe(true);
    }
  );

  it('fills physical columns in reading order before the spanning exclusion', async () => {
    let editor: Editor | null = null;
    const paragraphs = Array.from({ length: 12 }, (_, index) => ({
      type: 'paragraph',
      content: [{
        type: 'text',
        text: `ARTICLE-${index + 1} ${'archive sentence '.repeat(6)}`,
      }],
    }));
    const image = {
      ...spanningBodyContent(2, 2).content![1],
      attrs: {
        ...spanningBodyContent(2, 2).content![1].attrs,
        widthPx: 200,
        heightPx: 125,
      },
    };
    render(React.createElement(FlowEditor, {
      content: {
        type: 'doc',
        content: [...paragraphs.slice(0, 8), image, ...paragraphs.slice(8)],
      } as JSONContent,
      columnCount: 3,
      columnGapPx: 24,
      dropCap: false,
      resolveAssetSource: () => 'data:image/png;base64,SPAN',
      onEditorReady: (readyEditor: Editor | null) => {
        editor = readyEditor;
      },
    }));
    await waitFor(() => expect(editor).not.toBeNull());

    const model = buildDocumentSpanLayoutModel(
      editor!,
      3,
      24,
      720,
      360
    )!;
    const columnOne = model.columns[0].topHtml;
    const columnTwoAbove = model.columns[1].topHtml;
    const columnThreeAbove = model.columns[2].topHtml;
    expect(columnOne).toContain('ARTICLE-1');
    expect(columnTwoAbove.length).toBeGreaterThan(0);
    expect(columnThreeAbove.length).toBeGreaterThan(0);
    expect(columnOne).not.toContain('ARTICLE-12');
    expect(model.columns[0].bottomHtml).toBe('');
    expect(model.imageTopPx).toBeGreaterThan(0);
    expect(model.attributes).toMatchObject({
      spanCount: 2,
      spanStartColumn: 2,
    });

    const renderedHtml = readColumnMajorModelHtml(model);
    const offsets = Array.from({ length: 12 }, (_, index) =>
      renderedHtml.indexOf(`ARTICLE-${index + 1}`)
    );
    expect(offsets.every((offset) => offset >= 0)).toBe(true);
    expect(offsets).toEqual([...offsets].sort(
      (left, right) => left - right
    ));
  });

  it('flows Span 3 text through upper and lower three-column regions', async () => {
    let editor: Editor | null = null;
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{
            type: 'text',
            text: `SPAN3-UPPER ${'archive introduction '.repeat(70)}`,
          }],
        },
        spanningBodyContent(3, 1).content![1],
        ...Array.from({ length: 9 }, (_, index) => ({
          type: 'paragraph',
          content: [{
            type: 'text',
            text: `SPAN3-LOWER-${index + 1} ${'continued article '.repeat(8)}`,
          }],
        })),
      ],
    } as JSONContent;
    render(React.createElement(FlowEditor, {
      content,
      columnCount: 3,
      columnGapPx: 24,
      dropCap: false,
      resolveAssetSource: () => 'data:image/png;base64,SPAN',
      onEditorReady: (readyEditor: Editor | null) => {
        editor = readyEditor;
      },
    }));
    await waitFor(() => expect(editor).not.toBeNull());

    const model = buildDocumentSpanLayoutModel(editor!, 3, 24, 720)!;
    expect(model.sideColumn).toBeNull();
    expect(model.sideHtml).toBe('');
    const renderedHtml = readColumnMajorModelHtml(model);
    expect(model.beforeColumnHtml.some((column) => column.length > 0)).toBe(true);
    expect(model.afterColumnHtml.some((column) => column.length > 0)).toBe(true);
    for (let index = 1; index <= 9; index += 1) {
      expect(countTextOccurrences(
        renderedHtml,
        `SPAN3-LOWER-${index}`
      )).toBe(1);
    }
  });

  it('moves a structured span image by one paragraph without changing its data', async () => {
    let editor: Editor | null = null;
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First paragraph.' }],
        },
        {
          type: 'paragraph',
          content: [{
            type: 'text',
            text: 'Second paragraph.',
            marks: [{
              type: 'documentTextStyle',
              attrs: { fontSizePx: 18 },
            }],
          }],
        },
        spanningBodyContent(2, 2).content![1],
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Third paragraph.' }],
        },
      ],
    } as JSONContent;
    const { container } = render(React.createElement(FlowEditor, {
      content,
      columnCount: 3,
      columnGapPx: 24,
      dropCap: false,
      resolveAssetSource: () => 'data:image/png;base64,SPAN',
      onEditorReady: (readyEditor: Editor | null) => {
        editor = readyEditor;
      },
    }));
    await waitFor(() => {
      expect(editor).not.toBeNull();
      expect(container.querySelector('[data-document-span-layout]')).not.toBeNull();
    });

    let imagePosition = -1;
    editor!.state.doc.descendants((node, position) => {
      if (node.attrs.id === 'span-family-photo') imagePosition = position;
    });
    editor!.commands.setNodeSelection(imagePosition);
    const originalAttributes = {
      ...findDocumentImageNode(editor!.getJSON())!.attrs,
    };
    const originalTextDocument = normalizeBodyWithoutSpanImage(
      editor!.getJSON()
    );
    expect(findTextNodes(originalTextDocument).find(
      (node) => node.text === 'Second paragraph.'
    )?.marks).toContainEqual({
      type: 'documentTextStyle',
      attrs: { fontSizePx: 18 },
    });

    expect(canMoveSelectedStructuredImage(editor!.state, 'earlier')).toBe(true);
    expect(canMoveSelectedStructuredImage(editor!.state, 'later')).toBe(true);
    await act(async () => {
      expect(editor!.commands.moveSelectedDocumentImage('earlier')).toBe(true);
      await Promise.resolve();
    });
    expect(topLevelBodyOrder(editor!.getJSON())).toEqual([
      'First paragraph.',
      'image:span-family-photo',
      'Second paragraph.',
      'Third paragraph.',
    ]);
    expect(findDocumentImageNode(editor!.getJSON())!.attrs)
      .toEqual(originalAttributes);
    expect(normalizeBodyWithoutSpanImage(editor!.getJSON()))
      .toEqual(originalTextDocument);
    await waitFor(() => {
      const model = buildDocumentSpanLayoutModel(editor!, 3, 24, 720)!;
      expect(model.imagePosition).toBeLessThan(imagePosition);
      const renderedText = readColumnMajorModelHtml(model);
      expect(countTextOccurrences(renderedText, 'First paragraph.')).toBe(1);
      expect(countTextOccurrences(renderedText, 'Second paragraph.')).toBe(1);
      expect(countTextOccurrences(renderedText, 'Third paragraph.')).toBe(1);
    });

    await act(async () => {
      expect(editor!.commands.undo()).toBe(true);
      await Promise.resolve();
    });
    expect(topLevelBodyOrder(editor!.getJSON())).toEqual([
      'First paragraph.',
      'Second paragraph.',
      'image:span-family-photo',
      'Third paragraph.',
    ]);
    await act(async () => {
      expect(editor!.commands.redo()).toBe(true);
      expect(editor!.commands.moveSelectedDocumentImage('later')).toBe(true);
      await Promise.resolve();
    });
    expect(topLevelBodyOrder(editor!.getJSON())).toEqual([
      'First paragraph.',
      'Second paragraph.',
      'image:span-family-photo',
      'Third paragraph.',
    ]);

    await act(async () => {
      editor!.commands.moveSelectedDocumentImage('earlier');
      editor!.commands.moveSelectedDocumentImage('earlier');
      await Promise.resolve();
    });
    expect(topLevelBodyOrder(editor!.getJSON())[0])
      .toBe('image:span-family-photo');
    expect(canMoveSelectedStructuredImage(editor!.state, 'earlier')).toBe(false);
    expect(editor!.commands.moveSelectedDocumentImage('earlier')).toBe(false);

    await act(async () => {
      editor!.commands.moveSelectedDocumentImage('later');
      editor!.commands.moveSelectedDocumentImage('later');
      editor!.commands.moveSelectedDocumentImage('later');
      await Promise.resolve();
    });
    expect(topLevelBodyOrder(editor!.getJSON())).toEqual([
      'First paragraph.',
      'Second paragraph.',
      'Third paragraph.',
      'image:span-family-photo',
      '',
    ]);
    expect(canMoveSelectedStructuredImage(editor!.state, 'later')).toBe(false);
    expect(editor!.commands.moveSelectedDocumentImage('later')).toBe(false);
    expect(findDocumentImageNode(editor!.getJSON())!.attrs)
      .toEqual(originalAttributes);
    expect(normalizeBodyWithoutSpanImage(editor!.getJSON()))
      .toEqual(originalTextDocument);
  });

  it('shows span repositioning controls with correct boundary states', async () => {
    const store = useDocumentStore.getState();
    store.addAsset('asset-span-family', 'data:image/png;base64,SPAN');
    store.updatePage({
      columnCount: 3,
      bodyContent: {
        type: 'doc',
        content: [
          spanningBodyContent(2, 1).content![1],
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Only following paragraph.' }],
          },
        ],
      },
    });
    await renderShell();

    await waitFor(() => {
      expect(document.querySelector(
        '[data-document-span-layout] [data-document-image="true"]'
      )).not.toBeNull();
    });
    fireEvent.click(document.querySelector(
      '[data-document-span-layout] [data-document-image="true"]'
    )!);
    const moveEarlier = await screen.findByRole('button', {
      name: 'Move earlier',
    });
    const moveLater = screen.getByRole('button', { name: 'Move later' });
    expect((moveEarlier as HTMLButtonElement).disabled).toBe(true);
    expect((moveLater as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(moveLater);
    await waitFor(() => {
      expect(topLevelBodyOrder(
        useDocumentStore.getState().project!.pages[0].bodyContent
      )).toEqual([
        'Only following paragraph.',
        'image:span-family-photo',
        '',
      ]);
      expect((
        screen.getByRole('button', { name: 'Move earlier' }) as HTMLButtonElement
      ).disabled).toBe(false);
      expect((
        screen.getByRole('button', { name: 'Move later' }) as HTMLButtonElement
      ).disabled).toBe(true);
    });
  });

  it('preserves spanning image aspect ratio when width changes', async () => {
    const store = useDocumentStore.getState();
    store.addAsset('asset-span-family', 'data:image/png;base64,SPAN');
    store.updatePage({
      columnCount: 3,
      bodyContent: spanningBodyContent(2, 2),
    });
    await renderShell();

    await waitFor(() => {
      expect(document.querySelector(
        '[data-document-span-layout] [data-document-image="true"]'
      )).not.toBeNull();
    });
    fireEvent.click(document.querySelector(
      '[data-document-span-layout] [data-document-image="true"]'
    )!);
    await waitFor(() => {
      expect(screen.queryByTestId('document-image-inspector')).not.toBeNull();
    });
    const layoutMode = screen.getByLabelText(
      'Image layout mode'
    ) as HTMLSelectElement;
    expect(within(layoutMode).queryByRole('option', {
      name: 'Span 2 columns',
    })).not.toBeNull();
    expect(within(layoutMode).queryByRole('option', {
      name: 'Span all 3 columns',
    })).not.toBeNull();
    expect(screen.queryByLabelText('Spanning image starting column')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Image width'), {
      target: { value: '640' },
    });

    const image = findDocumentImageNode(
      useDocumentStore.getState().project?.pages[0].bodyContent
    );
    const page = useDocumentStore.getState().project!.pages[0];
    const bodyWidth = (
      page.size.widthIn - page.margins.leftIn - page.margins.rightIn
    ) * 96;
    const columnWidth = (
      bodyWidth - page.columnGapPx * (page.columnCount - 1)
    ) / page.columnCount;
    const maximumSpanWidth = columnWidth * 2 + page.columnGapPx;
    expect(image?.attrs).toMatchObject({
      spanCount: 2,
      spanStartColumn: 2,
      caption: 'The family home, circa 1932',
    });
    expect(Number(image?.attrs?.widthPx)).toBeCloseTo(maximumSpanWidth, 5);
    expect(Number(image?.attrs?.heightPx)).toBeCloseTo(
      maximumSpanWidth * 1000 / 1600,
      5
    );
  });

  it('normalizes spanning images without losing content when column count shrinks', async () => {
    let editor: Editor | null = null;
    const baseProps = {
      content: spanningBodyContent(2, 2),
      columnGapPx: 24,
      dropCap: false,
      resolveAssetSource: () => 'data:image/png;base64,SPAN',
      onEditorReady: (readyEditor: Editor | null) => {
        editor = readyEditor;
      },
    };
    const { rerender } = render(React.createElement(FlowEditor, {
      ...baseProps,
      columnCount: 3,
    }));
    await waitFor(() => expect(editor).not.toBeNull());

    rerender(React.createElement(FlowEditor, {
      ...baseProps,
      columnCount: 2,
    }));
    await waitFor(() => {
      expect(findDocumentImageNode(editor!.getJSON())?.attrs).toMatchObject({
        wrap: 'span-columns',
        spanCount: 2,
        spanStartColumn: 1,
        caption: 'The family home, circa 1932',
      });
    });

    rerender(React.createElement(FlowEditor, {
      ...baseProps,
      columnCount: 1,
    }));
    await waitFor(() => {
      expect(findDocumentImageNode(editor!.getJSON())?.attrs).toMatchObject({
        wrap: 'top-bottom',
        spanCount: 1,
        spanStartColumn: 1,
        caption: 'The family home, circa 1932',
      });
      expect(editor!.getText()).toContain('article continues below');
    });
  });

  it('shows only span choices valid for the current column count', async () => {
    const store = useDocumentStore.getState();
    store.addAsset('asset-span-family', 'data:image/png;base64,SPAN');
    store.updateBodyContent(spanningBodyContent(2, 1));
    await renderShell();

    await waitFor(() => {
      expect(document.querySelector('[data-image-id="span-family-photo"]'))
        .not.toBeNull();
    });
    fireEvent.click(document.querySelector(
      '.document-image[data-image-id="span-family-photo"]'
    )!);
    await waitFor(() => {
      expect(screen.queryByLabelText('Image layout mode')).not.toBeNull();
    });
    let layoutMode = screen.getByLabelText('Image layout mode');
    expect(within(layoutMode).queryByText(/Span/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '2 columns' }));
    layoutMode = screen.getByLabelText('Image layout mode');
    expect(within(layoutMode).queryByRole('option', {
      name: 'Span both columns',
    })).not.toBeNull();
    expect(within(layoutMode).queryByRole('option', {
      name: 'Span all 3 columns',
    })).toBeNull();
  });
});

describe('document viewport fitting', () => {
  it('fits a physical page inside the usable viewport and clamps invalid extremes', () => {
    expect(calculateFitPageZoom({
      viewportWidth: 1600,
      viewportHeight: 940,
      pageWidth: 816,
      pageHeight: 1056,
      paddingLeft: 32,
      paddingRight: 32,
      paddingTop: 24,
      paddingBottom: 76,
    })).toBeCloseTo(840 / 1056, 5);

    expect(calculateFitPageZoom({
      viewportWidth: 1600,
      viewportHeight: 940,
      pageWidth: 1056,
      pageHeight: 816,
      paddingLeft: 32,
      paddingRight: 32,
      paddingTop: 24,
      paddingBottom: 76,
    })).toBeCloseTo(840 / 816, 5);

    expect(calculateFitPageZoom({
      viewportWidth: 5000,
      viewportHeight: 5000,
      pageWidth: 816,
      pageHeight: 1056,
    })).toBe(1.5);

    expect(calculateFitPageZoom({
      viewportWidth: 0,
      viewportHeight: 940,
      pageWidth: 816,
      pageHeight: 1056,
    })).toBeNull();
  });
});
