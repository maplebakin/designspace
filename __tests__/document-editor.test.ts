import React from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
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
  mountCommittedDocumentExportPages,
} from '../src/document/components/DocumentProjectExportRenderer';
import {
  commitStructuredDocumentImagePosition,
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
  buildMultiDocumentSpanLayoutModel,
  moveRectangleWithoutCollisions,
  rectanglesOverlap,
} from '../src/document/components/StructuredDocumentSpanLayout';
import {
  canMoveSelectedStructuredImage,
  calculateDocumentImageHeight,
  calculateDocumentImageFrameHeight,
  calculateDocumentImageResizeWidth,
  calculateDocumentImageDragY,
  calculateDocumentImageXOffset,
  clampDocumentImageXOffset,
  clampDocumentImageWidth,
  clampDocumentImageY,
  getDocumentImageAspectRatio,
  normalizeDocumentImageAttributes,
} from '../src/document/extensions/DocumentImageExtension';
import { documentExportService } from '../src/document/services/documentExportService';
import { DEFAULT_DOCUMENT_PAPER_COLOR } from '../src/document/utils/documentColor';

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

const plainDocumentContent = (text: string): DocumentContentJson => ({
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [{ type: 'text', text }],
  }],
});

const seedHistoricalFourPageProject = () => {
  const store = useDocumentStore.getState();
  const firstPage = store.project!.pages[0];
  const pageIds = [firstPage.id];
  store.updateFolioSettings({
    startingNumber: 49,
    visible: true,
    placement: 'outside-bottom',
  });

  [49, 50, 51, 52].forEach((folio, index) => {
    if (index > 0) {
      store.addPage();
      pageIds.push(useDocumentStore.getState().project!.pages[index].id);
    }
    const pageId = pageIds[index];
    store.updatePage({
      name: `Page ${folio}`,
      margins: {
        topIn: 0.5,
        bottomIn: 0.75,
        innerIn: 0.8,
        outerIn: 0.45,
      },
      suppressFolio: folio === 51,
    }, pageId);
    store.updateTitleContent(
      plainDocumentContent(`Historical title ${folio}`),
      pageId
    );
    store.updateBodyContent(plainDocumentContent(`Story ${folio}`), pageId);
  });
  store.selectPage(0);
  return pageIds;
};

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

const dispatchTestPointer = (
  target: Element | Window,
  type: string,
  {
    pointerId,
    clientX = 0,
    clientY = 0,
  }: {
    pointerId: number;
    clientX?: number;
    clientY?: number;
  }
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  fireEvent(target, event);
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
) => model.columns
  .flatMap((column) => [column.topHtml, column.bottomHtml])
  .join('');

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
    vi.restoreAllMocks();
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
    expect(page?.dropCap.enabled).toBe(true);
    expect(useDocumentStore.getState().isDirty).toBe(true);
    expect(screen.getByTestId('document-flow-editor').getAttribute('data-column-count')).toBe('3');
    expect(screen.getByTestId('document-flow-editor').getAttribute('data-drop-cap')).toBe('true');
    expect(
      screen.getByTestId('document-body-region').style.getPropertyValue('--document-column-gap')
    ).toBe('40px');
    expect(screen.getByRole('button', { name: '3 columns' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('document-drop-cap-toggle').getAttribute('aria-pressed')).toBe('true');
  });

  it('reports one committed page-metadata observation for a column-count command', async () => {
    const onCommittedMutation = vi.fn();
    render(React.createElement(DocumentEditorShell, {
      onCommittedMutation,
    }));
    await waitFor(() => {
      expect(screen.getByTestId('document-flow-editor')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: '2 columns' }));

    expect(useDocumentStore.getState().project?.pages[0].columnCount).toBe(2);
    expect(onCommittedMutation).toHaveBeenCalledTimes(1);
    expect(onCommittedMutation).toHaveBeenCalledWith({
      action: 'modify-page-metadata',
      pageId: useDocumentStore.getState().project!.pages[0].id,
    });
  });

  it('switches Letter, A4, and custom pages between orientations and reflows columns', async () => {
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

    fireEvent.change(screen.getByLabelText('Page preset'), {
      target: { value: 'custom' },
    });
    expect(screen.queryByTestId('document-custom-page-size')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Custom page width in inches'), {
      target: { value: '6.25' },
    });
    fireEvent.change(screen.getByLabelText('Custom page height in inches'), {
      target: { value: '9.5' },
    });
    size = useDocumentStore.getState().project!.pages[0].size;
    expect(size).toMatchObject({
      presetId: 'custom',
      orientation: 'portrait',
      widthIn: 6.25,
      heightIn: 9.5,
    });
    expect(exportRoot.getAttribute('data-page-width-in')).toBe('6.25');
    expect(exportRoot.getAttribute('data-page-height-in')).toBe('9.5');

    fireEvent.click(screen.getByRole('button', {
      name: 'Landscape orientation',
    }));
    expect(useDocumentStore.getState().project?.pages[0].size).toMatchObject({
      presetId: 'custom',
      orientation: 'landscape',
      widthIn: 9.5,
      heightIn: 6.25,
    });
  });

  it('renders, edits, and forwards the authoritative project paper colour to export and print', async () => {
    const downloadPng = vi.spyOn(documentExportService, 'downloadPng')
      .mockResolvedValue({
        blob: new Blob(['png'], { type: 'image/png' }),
        fileName: 'archive-notes.png',
      });
    const downloadPngPages = vi.spyOn(documentExportService, 'downloadPngPages')
      .mockResolvedValue([]);
    const printPages = vi.spyOn(documentExportService, 'printPages')
      .mockResolvedValue(() => undefined);

    await renderShell();

    const paperInput = screen.getByTestId(
      'document-paper-color'
    ) as HTMLInputElement;
    const pageSheet = screen.getByTestId('document-page');
    const exportRoot = screen.getByTestId('document-export-root');

    expect(
      useDocumentStore.getState().project?.document.background?.value
    ).toBe(DEFAULT_DOCUMENT_PAPER_COLOR);
    expect(paperInput.value.toUpperCase()).toBe(DEFAULT_DOCUMENT_PAPER_COLOR);
    expect(pageSheet.style.backgroundColor).toBe('rgb(250, 248, 245)');
    expect(exportRoot.getAttribute('data-paper-color')).toBe(
      DEFAULT_DOCUMENT_PAPER_COLOR
    );
    expect(exportRoot.style.backgroundColor).toBe('rgb(250, 248, 245)');

    fireEvent.change(paperInput, {
      target: { value: '#e7dcc8' },
    });

    expect(
      useDocumentStore.getState().project?.document.background?.value
    ).toBe('#E7DCC8');
    expect(useDocumentStore.getState()).toMatchObject({
      isDirty: true,
      saveStatus: 'unsaved',
    });
    expect(pageSheet.style.backgroundColor).toBe('rgb(231, 220, 200)');
    expect(exportRoot.getAttribute('data-paper-color')).toBe('#E7DCC8');
    expect(exportRoot.style.backgroundColor).toBe('rgb(231, 220, 200)');

    fireEvent.click(screen.getByText('Export', { exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'PNG', exact: true }));
    await waitFor(() => {
      expect(downloadPng).toHaveBeenCalledTimes(1);
    });
    const [committedPngRoot, committedPngOptions] = downloadPng.mock.calls[0];
    expect(committedPngRoot).not.toBe(exportRoot);
    expect(committedPngRoot.getAttribute('data-paper-color')).toBe('#E7DCC8');
    expect(committedPngOptions).toEqual(expect.objectContaining({
      backgroundColor: '#E7DCC8',
    }));

    fireEvent.click(screen.getByText('Export', { exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'PNG all pages' }));
    await waitFor(() => {
      expect(downloadPngPages).toHaveBeenCalledTimes(1);
    });
    expect(downloadPngPages.mock.calls[0][0]).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Print', exact: true }));
    await waitFor(() => {
      expect(printPages).toHaveBeenCalledTimes(1);
    });
    const [committedPrintSources] = printPages.mock.calls[0];
    expect(committedPrintSources[0].element).not.toBe(exportRoot);
    expect(committedPrintSources[0].element.getAttribute('data-paper-color'))
      .toBe('#E7DCC8');
    expect(committedPrintSources[0].options).toEqual(expect.objectContaining({
      backgroundColor: '#E7DCC8',
    }));
  });

  it('keeps semantic margin fields readable and persists their page values', async () => {
    await renderShell();

    fireEvent.change(screen.getByLabelText('Top margin in inches'), {
      target: { value: '0.5' },
    });
    fireEvent.change(screen.getByLabelText('Bottom margin in inches'), {
      target: { value: '0.6' },
    });
    fireEvent.change(screen.getByLabelText('Inner margin in inches'), {
      target: { value: '0.7' },
    });
    fireEvent.change(screen.getByLabelText('Outer margin in inches'), {
      target: { value: '0.8' },
    });

    expect(useDocumentStore.getState().project?.pages[0].margins).toEqual({
      topIn: 0.5,
      bottomIn: 0.6,
      innerIn: 0.7,
      outerIn: 0.8,
    });
  });

  it('navigates four independent stories with mirrored folios and per-page suppression', async () => {
    seedHistoricalFourPageProject();
    const revisionBeforeNavigation = useDocumentStore.getState().revision;
    await renderShell();

    expect(screen.queryByTestId('document-page-navigation')).not.toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByTestId('document-page-tab-0').getAttribute(
      'aria-selected'
    )).toBe('true');
    expect(screen.getByLabelText('Document body').textContent).toContain(
      'Story 49'
    );
    expect(screen.getByTestId('document-export-root').getAttribute(
      'data-folio-number'
    )).toBe('49');
    expect(screen.getByTestId('document-export-root').getAttribute(
      'data-page-parity'
    )).toBe('recto');
    expect(screen.getByTestId('document-export-root').getAttribute(
      'data-folio-side'
    )).toBe('right');
    expect(screen.getByTestId('document-folio').textContent).toBe('49');
    expect(screen.getByTestId('document-folio').getAttribute(
      'data-folio-side'
    )).toBe('right');
    let pageContent = document.querySelector(
      '.document-page-content'
    ) as HTMLElement;
    expect(Number.parseFloat(pageContent.style.paddingLeft)).toBeCloseTo(
      0.8 * 96,
      5
    );
    expect(Number.parseFloat(pageContent.style.paddingRight)).toBeCloseTo(
      0.45 * 96,
      5
    );

    fireEvent.click(screen.getByTestId('document-page-tab-1'));
    await waitFor(() => {
      expect(screen.getByLabelText('Document body').textContent).toContain(
        'Story 50'
      );
    });
    expect(useDocumentStore.getState().revision).toBe(
      revisionBeforeNavigation + 1
    );
    expect(screen.getByTestId('document-export-root').getAttribute(
      'data-folio-number'
    )).toBe('50');
    expect(screen.getByTestId('document-export-root').getAttribute(
      'data-page-parity'
    )).toBe('verso');
    expect(screen.getByTestId('document-folio').getAttribute(
      'data-folio-side'
    )).toBe('left');
    pageContent = document.querySelector(
      '.document-page-content'
    ) as HTMLElement;
    expect(Number.parseFloat(pageContent.style.paddingLeft)).toBeCloseTo(
      0.45 * 96,
      5
    );
    expect(Number.parseFloat(pageContent.style.paddingRight)).toBeCloseTo(
      0.8 * 96,
      5
    );

    fireEvent.click(screen.getByTestId('document-page-tab-2'));
    await waitFor(() => {
      expect(screen.getByLabelText('Document body').textContent).toContain(
        'Story 51'
      );
    });
    expect(screen.getByTestId('document-export-root').getAttribute(
      'data-folio-number'
    )).toBe('51');
    expect(screen.getByTestId('document-export-root').getAttribute(
      'data-folio-side'
    )).toBe('right');
    expect(screen.queryByTestId('document-folio')).toBeNull();
    expect(screen.getByTestId('document-suppress-folio').getAttribute(
      'aria-pressed'
    )).toBe('true');

    fireEvent.click(screen.getByTestId('document-suppress-folio'));
    expect(screen.getByTestId('document-folio').textContent).toBe('51');
    fireEvent.click(screen.getByTestId('document-suppress-folio'));
    expect(screen.queryByTestId('document-folio')).toBeNull();

    fireEvent.click(screen.getByTestId('document-page-tab-3'));
    await waitFor(() => {
      expect(screen.getByLabelText('Document body').textContent).toContain(
        'Story 52'
      );
    });
    expect(screen.getByTestId('document-folio').textContent).toBe('52');
    expect(screen.getByTestId('document-folio').getAttribute(
      'data-folio-side'
    )).toBe('left');

    fireEvent.change(screen.getByTestId('document-starting-folio'), {
      target: { value: '60' },
    });
    expect(useDocumentStore.getState().project?.document.folios).toEqual({
      startingNumber: 60,
      visible: true,
      placement: 'outside-bottom',
    });
    expect(screen.getByTestId('document-folio').textContent).toBe('63');
    expect(screen.getByTestId('document-folio').getAttribute(
      'data-folio-side'
    )).toBe('right');

    fireEvent.click(screen.getByTestId('document-show-folios'));
    expect(screen.queryByTestId('document-folio')).toBeNull();
    fireEvent.click(screen.getByTestId('document-show-folios'));
    expect(screen.getByTestId('document-folio').textContent).toBe('63');
  });

  it('mounts every committed page offscreen with ordered content and page furniture', async () => {
    const pageIds = seedHistoricalFourPageProject();
    useDocumentStore.getState().updateDocumentBackground('#EFE6D2');
    const committedProject = useDocumentStore.getState().project!;
    let mounted: Awaited<ReturnType<
      typeof mountCommittedDocumentExportPages
    >> | undefined;

    try {
      let mountPromise!: ReturnType<typeof mountCommittedDocumentExportPages>;
      act(() => {
        mountPromise = mountCommittedDocumentExportPages(committedProject);
      });
      mounted = await mountPromise;

      expect(mounted?.project).not.toBe(committedProject);
      expect(mounted?.sources.map((source) => source.pageId)).toEqual(pageIds);
      const roots = mounted!.sources.map((source) => source.element);
      expect(roots.map((root) => root.getAttribute('data-page-id')))
        .toEqual(pageIds);
      expect(roots.map((root) => root.getAttribute('data-folio-number')))
        .toEqual(['49', '50', '51', '52']);
      expect(roots.map((root) => root.getAttribute('data-folio-side')))
        .toEqual(['right', 'left', 'right', 'left']);
      expect(roots.map((root) => root.getAttribute('data-paper-color')))
        .toEqual(['#EFE6D2', '#EFE6D2', '#EFE6D2', '#EFE6D2']);
      expect(roots.map((root) => root.textContent)).toEqual([
        expect.stringContaining('Historical title 49'),
        expect.stringContaining('Historical title 50'),
        expect.stringContaining('Historical title 51'),
        expect.stringContaining('Historical title 52'),
      ]);
      expect(roots.map((root) => root.textContent)).toEqual([
        expect.stringContaining('Story 49'),
        expect.stringContaining('Story 50'),
        expect.stringContaining('Story 51'),
        expect.stringContaining('Story 52'),
      ]);
      expect(roots.map((root) => root.querySelector(
        '.document-page-folio'
      )?.textContent ?? null)).toEqual(['49', '50', null, '52']);

      const [rectoContent, versoContent] = roots.map((root) =>
        root.querySelector('.document-page-content') as HTMLElement
      );
      expect(Number.parseFloat(rectoContent.style.paddingLeft)).toBeCloseTo(
        0.8 * 96,
        5
      );
      expect(Number.parseFloat(versoContent.style.paddingLeft)).toBeCloseTo(
        0.45 * 96,
        5
      );
    } finally {
      if (mounted) {
        act(() => {
          mounted?.cleanup();
        });
      }
    }
  });

  it('exposes compact add, duplicate, reorder, select, and remove page controls', async () => {
    const originalPageIds = seedHistoricalFourPageProject();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await renderShell();

    fireEvent.click(screen.getByTestId('document-page-tab-1'));
    await waitFor(() => {
      expect(screen.getByLabelText('Document body').textContent).toContain(
        'Story 50'
      );
    });

    fireEvent.click(screen.getByTestId('document-duplicate-page'));
    let project = useDocumentStore.getState().project!;
    expect(project.pages).toHaveLength(5);
    expect(project.activePageIndex).toBe(2);
    const duplicateId = project.pages[2].id;
    expect(duplicateId).not.toBe(originalPageIds[1]);
    expect(project.pages[2].bodyContent).toEqual(
      project.pages[1].bodyContent
    );
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(screen.getByTestId('document-page-tab-2').getAttribute(
      'aria-selected'
    )).toBe('true');

    fireEvent.click(screen.getByTestId('document-move-page-right'));
    project = useDocumentStore.getState().project!;
    expect(project.pages[3].id).toBe(duplicateId);
    expect(project.activePageIndex).toBe(3);
    expect(screen.getByTestId('document-page-tab-3').getAttribute(
      'aria-selected'
    )).toBe('true');

    fireEvent.click(screen.getByTestId('document-move-page-left'));
    project = useDocumentStore.getState().project!;
    expect(project.pages[2].id).toBe(duplicateId);
    expect(project.activePageIndex).toBe(2);

    fireEvent.click(screen.getByTestId('document-remove-page'));
    project = useDocumentStore.getState().project!;
    expect(project.pages).toHaveLength(4);
    expect(project.pages.some((page) => page.id === duplicateId)).toBe(false);
    expect(project.pages.map((page) => page.id)).toEqual(originalPageIds);

    fireEvent.click(screen.getByTestId('document-add-page'));
    project = useDocumentStore.getState().project!;
    expect(project.pages).toHaveLength(5);
    expect(project.activePageIndex).toBe(3);
    expect(new Set(project.pages.map((page) => page.id)).size).toBe(5);
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(screen.getByTestId('document-page-tab-3').getAttribute(
      'aria-selected'
    )).toBe('true');
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
      attrs: expect.objectContaining({
        fontSizePx: documentPointsToPixels(16),
      }),
    });
    expect(textNodes.find((node) => node.text === ' typed')?.marks).toContainEqual({
      type: 'documentTextStyle',
      attrs: expect.objectContaining({
        fontSizePx: documentPointsToPixels(12),
      }),
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
      attrs: expect.objectContaining({
        fontSizePx: documentPointsToPixels(24),
      }),
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

  it('round-trips independent horizontal placements for multiple spanning images', () => {
    const left = {
      ...spanningBodyContent(2, 1).content![1],
      attrs: {
        ...spanningBodyContent(2, 1).content![1].attrs,
        id: 'round-trip-left',
        verticalAnchor: 'page-position',
        yPx: 180,
        horizontalPlacement: 'custom',
        xOffsetPx: 36.5,
      },
    };
    const right = {
      ...spanningBodyContent(2, 2).content![1],
      attrs: {
        ...spanningBodyContent(2, 2).content![1].attrs,
        id: 'round-trip-right',
        verticalAnchor: 'page-position',
        yPx: 180,
        horizontalPlacement: 'right',
        xOffsetPx: 112,
      },
    };
    useDocumentStore.getState().updateBodyContent({
      type: 'doc',
      content: [left, right],
    });
    const serialized = JSON.stringify(useDocumentStore.getState().project);

    useDocumentStore.getState().reset();
    useDocumentStore.getState().hydrateProject(JSON.parse(serialized));
    const images = (
      useDocumentStore.getState().project?.pages[0].bodyContent.content || []
    ).filter((node) => node.type === 'documentFlowImage');
    expect(images.map((image) => ({
      id: image.attrs?.id,
      horizontalPlacement: image.attrs?.horizontalPlacement,
      xOffsetPx: image.attrs?.xOffsetPx,
      yPx: image.attrs?.yPx,
    }))).toEqual([
      {
        id: 'round-trip-left',
        horizontalPlacement: 'custom',
        xOffsetPx: 36.5,
        yPx: 180,
      },
      {
        id: 'round-trip-right',
        horizontalPlacement: 'right',
        xOffsetPx: 112,
        yPx: 180,
      },
    ]);
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
    const onCommittedMutation = vi.fn();
    render(React.createElement(DocumentEditorShell, { onCommittedMutation }));
    await waitFor(() => {
      expect(screen.getByTestId('document-overlay-image')).not.toBeNull();
    });

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
    expect(onCommittedMutation).toHaveBeenCalledTimes(1);
    expect(onCommittedMutation).toHaveBeenCalledWith({
      action: 'remove-structured-overlay',
      overlayId: overlay.id,
      assetEffect: 'cleanup-delegated',
    });
    act(() => {
      useDocumentStore.getState().setSelectedOverlayId('stale-overlay');
    });
    fireEvent.keyDown(screen.getByTestId('document-workspace'), {
      key: 'Backspace',
    });
    expect(onCommittedMutation).toHaveBeenCalledTimes(1);
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

    fireEvent.click(screen.getByTestId('document-reference-lock'));
    expect(
      useDocumentStore.getState().project?.pages[0].reference?.locked
    ).toBe(false);
    fireEvent.change(screen.getByLabelText('Reference fit'), {
      target: { value: 'cover' },
    });
    fireEvent.change(screen.getByLabelText('Reference scale'), {
      target: { value: '1.4' },
    });
    fireEvent.change(screen.getByLabelText('Reference X offset'), {
      target: { value: '18' },
    });
    fireEvent.click(screen.getByTestId('document-reference-fit-page'));
    expect(
      useDocumentStore.getState().project?.pages[0].reference
    ).toMatchObject({
      fit: 'contain',
      scale: 1,
      offsetXPx: 0,
      offsetYPx: 0,
    });

    fireEvent.keyDown(screen.getByTestId('document-workspace'), {
      key: 'r',
      shiftKey: true,
    });
    expect(
      useDocumentStore.getState().project?.pages[0].reference?.visible
    ).toBe(false);
    fireEvent.keyDown(screen.getByTestId('document-workspace'), {
      key: 'r',
      shiftKey: true,
    });
    expect(
      useDocumentStore.getState().project?.pages[0].reference?.visible
    ).toBe(true);
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
    const onCommittedMutation = vi.fn();
    render(React.createElement(
      React.StrictMode,
      null,
      React.createElement(DocumentEditorShell, { onCommittedMutation })
    ));
    await waitFor(() => {
      expect(screen.getByTestId('document-image-inspector')).not.toBeNull();
    });
    expect(screen.queryByTestId('document-image-inspector')).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Image width'), {
      target: { value: '360' },
    });
    fireEvent.change(screen.getByLabelText('Image width'), {
      target: { value: '360' },
    });
    fireEvent.change(screen.getByLabelText('Overlay X position'), {
      target: { value: '96' },
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
    expect(onCommittedMutation).toHaveBeenCalledTimes(2);
    expect(onCommittedMutation).toHaveBeenNthCalledWith(1, {
      action: 'modify-structured-geometry',
      overlayId: overlay.id,
    });
    expect(onCommittedMutation).toHaveBeenNthCalledWith(2, {
      action: 'modify-structured-geometry',
      overlayId: overlay.id,
    });
    expect(screen.getByTestId('document-image-width').getAttribute('value')).toBe('360');
    expect(screen.getByTestId('document-image-wrap').getAttribute('value')).toBeNull();
    expect((screen.getByTestId('document-image-wrap') as HTMLSelectElement).value).toBe('behind');
  });

  it('reports one overlay add for a flow-to-overlay conversion without a paired removal', async () => {
    const store = useDocumentStore.getState();
    store.addAsset('asset-flow-to-overlay', 'data:image/png;base64,FLOW');
    store.updateBodyContent({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before image.' }] },
        {
          type: 'documentFlowImage',
          attrs: {
            id: 'flow-to-overlay',
            assetId: 'asset-flow-to-overlay',
            altText: 'Flow image',
            widthPx: 240,
            heightPx: 160,
            naturalWidth: 1200,
            naturalHeight: 800,
            wrap: 'float-left',
            wrapPaddingPx: 12,
            caption: 'Flow image caption',
          },
        },
      ],
    });
    const onCommittedMutation = vi.fn();
    render(React.createElement(
      React.StrictMode,
      null,
      React.createElement(DocumentEditorShell, { onCommittedMutation })
    ));

    await waitFor(() => {
      expect(document.querySelector('[data-image-id="flow-to-overlay"]')).not.toBeNull();
    });
    fireEvent.click(document.querySelector('[data-image-id="flow-to-overlay"]')!);
    await waitFor(() => {
      expect(screen.getByLabelText('Image layout mode')).not.toBeNull();
    });

    fireEvent.change(screen.getByLabelText('Image layout mode'), {
      target: { value: 'front' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('document-overlay-image')).not.toBeNull();
    });
    expect(onCommittedMutation).toHaveBeenCalledTimes(1);
    expect(onCommittedMutation).toHaveBeenCalledWith({
      action: 'add-structured-overlay',
      overlayId: 'flow-to-overlay',
      assetEffect: 'retained-reference',
    });
    expect(onCommittedMutation).not.toHaveBeenCalledWith(expect.objectContaining({
      action: 'remove-structured-overlay',
    }));
  });

  it('reports one committed overlay geometry observation after pointer movement', async () => {
    addOverlayFixture();
    const onCommittedMutation = vi.fn();
    render(React.createElement(DocumentEditorShell, {
      onCommittedMutation,
    }));
    await waitFor(() => {
      expect(screen.getByTestId('document-overlay-image')).not.toBeNull();
    });

    const figure = screen.getByTestId('document-overlay-image');
    dispatchTestPointer(figure, 'pointerdown', {
      pointerId: 91,
      clientX: 100,
      clientY: 100,
    });
    dispatchTestPointer(figure, 'pointermove', {
      pointerId: 91,
      clientX: 120,
      clientY: 130,
    });
    dispatchTestPointer(window, 'pointerup', {
      pointerId: 91,
      clientX: 120,
      clientY: 130,
    });

    expect(onCommittedMutation).toHaveBeenCalledTimes(1);
    expect(onCommittedMutation).toHaveBeenCalledWith({
      action: 'modify-structured-geometry',
      overlayId: overlay.id,
    });
  });

  it('reports committed keyboard overlay nudges once and ignores stale or no-op targets', async () => {
    addOverlayFixture();
    const onCommittedMutation = vi.fn();
    render(React.createElement(
      React.StrictMode,
      null,
      React.createElement(DocumentEditorShell, { onCommittedMutation })
    ));
    await waitFor(() => {
      expect(screen.getByTestId('document-overlay-image')).not.toBeNull();
    });

    const workspace = screen.getByTestId('document-workspace');
    fireEvent.keyDown(workspace, { key: 'ArrowRight' });
    fireEvent.keyDown(workspace, { key: 'ArrowRight', shiftKey: true });

    expect(onCommittedMutation).toHaveBeenCalledTimes(2);
    expect(onCommittedMutation).toHaveBeenNthCalledWith(1, {
      action: 'modify-structured-geometry',
      overlayId: overlay.id,
    });
    expect(onCommittedMutation).toHaveBeenNthCalledWith(2, {
      action: 'modify-structured-geometry',
      overlayId: overlay.id,
    });
    expect(useDocumentStore.getState().project?.pages[0].overlayObjects[0].xPx)
      .toBe(95);

    act(() => {
      useDocumentStore.getState().setSelectedOverlayId('stale-overlay');
    });
    fireEvent.keyDown(workspace, { key: 'ArrowRight' });
    expect(onCommittedMutation).toHaveBeenCalledTimes(2);
  });

  it('keeps overlay selection and hydration silent for geometry observation', async () => {
    addOverlayFixture();
    const onCommittedMutation = vi.fn();
    const rendered = render(React.createElement(DocumentEditorShell, {
      onCommittedMutation,
    }));
    await waitFor(() => {
      expect(screen.getByTestId('document-overlay-image')).not.toBeNull();
    });

    act(() => {
      useDocumentStore.getState().setSelectedOverlayId(null);
      useDocumentStore.getState().setSelectedOverlayId(overlay.id);
      useDocumentStore.getState().addPage();
      useDocumentStore.getState().selectPage(0);
      useDocumentStore.getState().hydrateProject(
        structuredClone(useDocumentStore.getState().project)
      );
    });

    expect(onCommittedMutation).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().project?.pages[0].overlayObjects[0].id)
      .toBe(overlay.id);
    rendered.unmount();
    expect(onCommittedMutation).not.toHaveBeenCalled();
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
      const expectedPadding = wrap === 'inline'
        ? ['18px', '18px', '18px', '18px']
        : wrap === 'float-left'
          ? ['0px', '18px', '18px', '0px']
          : wrap === 'float-right'
            ? ['0px', '0px', '18px', '18px']
            : ['18px', '0px', '18px', '0px'];
      expect([
        imageElement.style.getPropertyValue(
          '--document-image-wrap-padding-top'
        ),
        imageElement.style.getPropertyValue(
          '--document-image-wrap-padding-right'
        ),
        imageElement.style.getPropertyValue(
          '--document-image-wrap-padding-bottom'
        ),
        imageElement.style.getPropertyValue(
          '--document-image-wrap-padding-left'
        ),
      ]).toEqual(expectedPadding);
      expect(imageElement.getAttribute('data-coordinate-space')).toBe('flow');
      expect(imageElement.querySelector('img')?.getAttribute('alt')).toBe(
        `${wrap} diagram`
      );
      expect(imageElement.textContent).toContain(`${wrap} caption`);
    }
  });

  it('adds a second photo after an image NodeSelection without replacing the first', async () => {
    let editor: Editor | null = null;
    render(React.createElement(FlowEditor, {
      content: {
        type: 'doc',
        content: [{ type: 'paragraph' }],
      } as JSONContent,
      columnCount: 3,
      columnGapPx: 24,
      dropCap: false,
      resolveAssetSource: () => 'data:image/png;base64,MULTI',
      onEditorReady: (readyEditor: Editor | null) => {
        editor = readyEditor;
      },
    }));
    await waitFor(() => expect(editor).not.toBeNull());

    const insert = (id: string) => editor!.commands.insertDocumentImage({
      id,
      assetId: `asset-${id}`,
      altText: id,
      widthPx: 240,
      heightPx: 160,
      naturalWidth: 1200,
      naturalHeight: 800,
      wrap: 'span-columns',
      spanCount: 2,
      verticalAnchor: 'page-position',
      yPx: id === 'first-photo' ? 120 : 390,
    });

    await act(async () => {
      insert('first-photo');
      let firstPosition = -1;
      editor!.state.doc.descendants((node, position) => {
        if (node.attrs.id === 'first-photo') {
          firstPosition = position;
          return false;
        }
        return true;
      });
      editor!.commands.setNodeSelection(firstPosition);
      insert('second-photo');
      await Promise.resolve();
    });

    const ids: string[] = [];
    editor!.state.doc.descendants((node) => {
      if (
        node.type.name === 'documentFlowImage'
        || node.type.name === 'documentInlineImage'
      ) {
        ids.push(node.attrs.id);
      }
      return true;
    });
    expect(ids).toEqual(['first-photo', 'second-photo']);
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
      verticalAnchor: 'flow',
      yPx: 0,
      caption: 'Legacy caption',
    });
    expect(container.querySelector('[data-document-span-layout]')).toBeNull();
  });

  it('normalizes fixed image placement and zoom-aware drag bounds', () => {
    expect(normalizeDocumentImageAttributes({
      verticalAnchor: 'invalid' as 'flow',
      yPx: Number.NaN,
    })).toMatchObject({
      verticalAnchor: 'flow',
      yPx: 0,
      horizontalPlacement: 'left',
      xOffsetPx: 0,
    });
    expect(normalizeDocumentImageAttributes({
      verticalAnchor: 'page-position',
      yPx: -500,
    })).toMatchObject({
      verticalAnchor: 'page-position',
      yPx: 0,
    });
    expect(clampDocumentImageY(260, 720, 240, 16)).toBe(260);
    expect(clampDocumentImageY(-100, 720, 240, 16)).toBe(16);
    expect(clampDocumentImageY(900, 720, 240, 16)).toBe(464);
    expect(calculateDocumentImageDragY({
      startY: 120,
      pointerDeltaY: 80,
      viewScale: 0.5,
      availableHeightPx: 720,
      imageRegionHeightPx: 240,
      verticalSpacingPx: 16,
    })).toBe(280);
    expect(getDocumentImageAspectRatio({
      naturalWidth: 1600,
      naturalHeight: 1000,
      widthPx: 320,
      heightPx: 200,
    })).toBe(1.6);
    expect(calculateDocumentImageHeight(420, 1.6)).toBe(263);
    expect(clampDocumentImageWidth(-100, 48, 472, 240)).toBe(48);
    expect(clampDocumentImageWidth(900, 48, 472, 240)).toBe(472);
    expect(calculateDocumentImageResizeWidth({
      startWidthPx: 240,
      pointerDeltaX: 60,
      viewScale: 0.5,
      minimumWidthPx: 48,
      maximumWidthPx: 472,
    })).toBe(360);
    expect(calculateDocumentImageXOffset({
      placement: 'left',
      xOffsetPx: 100,
      spanWidthPx: 472,
      imageWidthPx: 320,
    })).toBe(0);
    expect(calculateDocumentImageXOffset({
      placement: 'center',
      xOffsetPx: 0,
      spanWidthPx: 472,
      imageWidthPx: 320,
    })).toBe(76);
    expect(calculateDocumentImageXOffset({
      placement: 'right',
      xOffsetPx: 0,
      spanWidthPx: 472,
      imageWidthPx: 320,
    })).toBe(152);
    expect(clampDocumentImageXOffset(-20, 472, 320)).toBe(0);
    expect(clampDocumentImageXOffset(999, 472, 320)).toBe(152);
  });

  it.each([
    [2, 2],
    [1, 2],
    [1, 3],
  ] as const)(
    'places a fixed image from column %i across %i columns and allocates text once in physical reading order',
    async (spanStartColumn, spanCount) => {
      let editor: Editor | null = null;
      const paragraphs = Array.from({ length: 16 }, (_, index) => ({
        type: 'paragraph',
        content: [{
          type: 'text',
          text: `FIXED-${index + 1} ${'archive detail '.repeat(4)}`,
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
      const image = {
        ...spanningBodyContent(
          spanCount,
          spanStartColumn as 1 | 2
        ).content![1],
        attrs: {
          ...spanningBodyContent(
            spanCount,
            spanStartColumn as 1 | 2
          ).content![1].attrs,
          verticalAnchor: 'page-position',
          yPx: 180,
          widthPx: 360,
        },
      };
      render(React.createElement(FlowEditor, {
        content: {
          type: 'doc',
          content: [
            ...paragraphs.slice(0, 4),
            image,
            ...paragraphs.slice(4),
          ],
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
        720
      )!;
      expect(model.attributes).toMatchObject({
        verticalAnchor: 'page-position',
        yPx: 180,
        spanStartColumn,
        spanCount,
      });
      expect(model.imageTopPx).toBe(180);
      const renderedHtml = readColumnMajorModelHtml(model);
      for (let index = 1; index <= 16; index += 1) {
        expect(countTextOccurrences(
          renderedHtml,
          `FIXED-${index} `
        )).toBe(1);
      }
      const offsets = Array.from({ length: 16 }, (_, index) =>
        renderedHtml.indexOf(`FIXED-${index + 1} `)
      );
      expect(offsets).toEqual([...offsets].sort(
        (left, right) => left - right
      ));
      expect(renderedHtml).toContain('data-font-size-px="18"');
      expect(model.overflowing).toBe(false);
      expect(model.columns.some(
        (column) =>
          column.occupied
          && column.topHtml.length > 0
          && column.bottomHtml.length > 0
      )).toBe(true);
      if (spanStartColumn === 2) {
        expect(model.columns[0].topHtml.length).toBeGreaterThan(0);
        expect(model.columns[0].bottomHtml).toBe('');
        expect(model.columns[1].topHtml.length).toBeGreaterThan(0);
        expect(model.columns[1].bottomHtml.length).toBeGreaterThan(0);
      }
    }
  );

  it('records one undoable transaction when a fixed image position is committed', async () => {
    let editor: Editor | null = null;
    render(React.createElement(FlowEditor, {
      content: {
        ...spanningBodyContent(2, 2),
        content: (spanningBodyContent(2, 2).content || []).map((node) =>
          node.type === 'documentFlowImage'
            ? {
                ...node,
                attrs: {
                  ...node.attrs,
                  verticalAnchor: 'page-position',
                  yPx: 120,
                },
              }
            : node
        ),
      },
      columnCount: 3,
      columnGapPx: 24,
      dropCap: false,
      resolveAssetSource: () => 'data:image/png;base64,SPAN',
      onEditorReady: (readyEditor: Editor | null) => {
        editor = readyEditor;
      },
    }));
    await waitFor(() => expect(editor).not.toBeNull());
    let imagePosition = -1;
    editor!.state.doc.descendants((node, position) => {
      if (node.type.name === 'documentFlowImage') {
        imagePosition = position;
        return false;
      }
      return true;
    });
    editor!.chain()
      .setNodeSelection(imagePosition)
      .updateSelectedDocumentImage({ yPx: 300 })
      .run();
    expect(findDocumentImageNode(editor!.getJSON())?.attrs?.yPx).toBe(300);
    editor!.commands.undo();
    expect(findDocumentImageNode(editor!.getJSON())?.attrs?.yPx).toBe(120);
    editor!.commands.redo();
    expect(findDocumentImageNode(editor!.getJSON())?.attrs?.yPx).toBe(300);
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
        '[data-layout-role="physical-column"]'
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

      expect(layout.querySelector(
        '[data-layout-role="continuing-column"]'
      )).toBeNull();
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
      attrs: expect.objectContaining({ fontSizePx: 18 }),
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
    fireEvent.change(screen.getByLabelText('Image vertical placement'), {
      target: { value: 'page-position' },
    });
    fireEvent.change(await screen.findByLabelText('Image Y position'), {
      target: { value: '286' },
    });
    fireEvent.change(screen.getByLabelText('Image width'), {
      target: { value: '640' },
    });

    const image = findDocumentImageNode(
      useDocumentStore.getState().project?.pages[0].bodyContent
    );
    const page = useDocumentStore.getState().project!.pages[0];
    const bodyWidth = (
      page.size.widthIn - page.margins.innerIn - page.margins.outerIn
    ) * 96;
    const columnWidth = (
      bodyWidth - page.columnGapPx * (page.columnCount - 1)
    ) / page.columnCount;
    const maximumSpanWidth = columnWidth * 2 + page.columnGapPx;
    expect(image?.attrs).toMatchObject({
      spanCount: 2,
      spanStartColumn: 2,
      verticalAnchor: 'page-position',
      yPx: 286,
      caption: 'The family home, circa 1932',
    });
    expect(screen.queryByRole('button', { name: 'Move earlier' })).toBeNull();
    expect(Number(image?.attrs?.widthPx)).toBeCloseTo(maximumSpanWidth, 5);
    expect(Number(image?.attrs?.heightPx)).toBeCloseTo(
      maximumSpanWidth * 1000 / 1600,
      5
    );
  });

  it('previews a zoom-aware page-position drag and commits once on release', async () => {
    let editor: Editor | null = null;
    const anchored = spanningBodyContent(2, 2);
    anchored.content![1] = {
      ...anchored.content![1],
      attrs: {
        ...anchored.content![1].attrs,
        verticalAnchor: 'page-position',
        yPx: 120,
        widthPx: 360,
      },
    };
    const { container } = render(React.createElement(FlowEditor, {
      content: anchored,
      columnCount: 3,
      columnGapPx: 24,
      dropCap: false,
      viewScale: 0.5,
      resolveAssetSource: () => 'data:image/png;base64,SPAN',
      onEditorReady: (readyEditor: Editor | null) => {
        editor = readyEditor;
      },
    }));
    await waitFor(() => expect(editor).not.toBeNull());

    const slot = container.querySelector<HTMLElement>(
      '[data-layout-role="occupied-columns"]'
    )!;
    const layout = container.querySelector<HTMLElement>(
      '[data-document-span-layout]'
    )!;
    const dispatchPointer = (type: string, clientY: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        pointerId: { value: 7 },
        clientY: { value: clientY },
      });
      fireEvent(slot, event);
    };
    dispatchPointer('pointerdown', 100);
    dispatchPointer('pointermove', 150);
    expect(findDocumentImageNode(editor!.getJSON())?.attrs?.yPx).toBe(120);
    await waitFor(() => {
      expect(Number(layout.dataset.imageTopPx)).toBe(220);
    });
    dispatchPointer('pointerup', 150);
    await waitFor(() => {
      expect(findDocumentImageNode(editor!.getJSON())?.attrs).toMatchObject({
        verticalAnchor: 'page-position',
        yPx: 220,
      });
    });
    expect(editor!.getJSON().content?.filter(
      (node) => node.type === 'documentFlowImage'
    )).toHaveLength(1);
  });

  it.each([
    [2, 2, 0.5],
    [1, 2, 0.75],
    [1, 3, 1],
    [2, 2, 1.5],
  ] as const)(
    'resizes a structured span from column %i across %i columns at %d scale',
    async (spanStartColumn, spanCount, viewScale) => {
      let editor: Editor | null = null;
      const onUpdate = vi.fn();
      const content = spanningBodyContent(
        spanCount,
        spanStartColumn as 1 | 2
      );
      content.content![1] = {
        ...content.content![1],
        attrs: {
          ...content.content![1].attrs,
          verticalAnchor: 'page-position',
          yPx: 120,
          widthPx: 240,
          heightPx: 150,
        },
      };
      const { container } = render(React.createElement(FlowEditor, {
        content,
        columnCount: 3,
        columnGapPx: 24,
        dropCap: false,
        viewScale,
        resolveAssetSource: () => 'data:image/png;base64,SPAN',
        onUpdate,
        onEditorReady: (readyEditor: Editor | null) => {
          editor = readyEditor;
        },
      }));
      await waitFor(() => expect(editor).not.toBeNull());
      fireEvent.click(container.querySelector(
        '[data-layout-role="occupied-columns"]'
      )!);
      const handle = await waitFor(() => {
        const value = container.querySelector<HTMLButtonElement>(
          '[data-layout-role="occupied-columns"] '
          + '.document-image__resize-handle'
        );
        expect(value).not.toBeNull();
        return value!;
      });
      const layout = container.querySelector<HTMLElement>(
        '[data-document-span-layout]'
      )!;
      const originalRegionHeight = Number(
        layout.dataset.imageRegionHeightPx
      );
      const expectedWidth = Math.min(
        Number(layout.dataset.spanWidthPx),
        240 + 60 / viewScale
      );
      onUpdate.mockClear();

      dispatchTestPointer(handle, 'pointerdown', {
        pointerId: 21,
        clientX: 100,
      });
      dispatchTestPointer(handle, 'pointermove', {
        pointerId: 21,
        clientX: 160,
      });
      expect(findDocumentImageNode(editor!.getJSON())?.attrs).toMatchObject({
        widthPx: 240,
        heightPx: 150,
        yPx: 120,
      });
      expect(onUpdate).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(Number(layout.dataset.renderedImageWidthPx))
          .toBeCloseTo(expectedWidth, 5);
      });
      expect(Number(layout.dataset.renderedImageHeightPx)).toBeCloseTo(
        calculateDocumentImageFrameHeight({
          cropMode: 'fit',
          heightPx: 150,
          naturalWidth: 1.6,
          naturalHeight: 1,
        }, expectedWidth),
        5
      );
      expect(Number(layout.dataset.imageRegionHeightPx))
        .toBeGreaterThan(originalRegionHeight);
      const previewFigure = container.querySelector<HTMLElement>(
        '[data-layout-role="spanning-image"]'
      )!;
      expect(Number.parseFloat(previewFigure.style.width))
        .toBeCloseTo(expectedWidth, 5);
      expect(Number.parseFloat(previewFigure.querySelector<HTMLElement>(
        '.document-image__media'
      )!.style.height)).toBeCloseTo(
        calculateDocumentImageFrameHeight({
          cropMode: 'fit',
          heightPx: 150,
          naturalWidth: 1.6,
          naturalHeight: 1,
        }, expectedWidth),
        5
      );

      dispatchTestPointer(handle, 'pointerup', {
        pointerId: 21,
        clientX: 160,
      });
      await waitFor(() => {
        expect(findDocumentImageNode(editor!.getJSON())?.attrs).toMatchObject({
          widthPx: expectedWidth,
          heightPx: calculateDocumentImageHeight(expectedWidth, 1.6),
          yPx: 120,
        });
      });
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(container.querySelectorAll(
        '[data-layout-role="occupied-columns"] '
        + '.document-image__resize-handle'
      )).toHaveLength(1);

      editor!.commands.undo();
      await waitFor(() => {
        expect(findDocumentImageNode(editor!.getJSON())?.attrs?.widthPx)
          .toBe(240);
        expect(container.querySelector(
          '[data-layout-role="occupied-columns"] '
          + '.document-image__resize-handle'
        )).not.toBeNull();
      });
      editor!.commands.redo();
      await waitFor(() => {
        expect(findDocumentImageNode(editor!.getJSON())?.attrs?.widthPx)
          .toBe(expectedWidth);
      });

      onUpdate.mockClear();
      const clickOnlyHandle = container.querySelector<HTMLElement>(
        '[data-layout-role="occupied-columns"] '
        + '.document-image__resize-handle'
      )!;
      dispatchTestPointer(clickOnlyHandle, 'pointerdown', {
        pointerId: 22,
        clientX: 160,
      });
      dispatchTestPointer(clickOnlyHandle, 'pointerup', {
        pointerId: 22,
        clientX: 160,
      });
      expect(onUpdate).not.toHaveBeenCalled();
    }
  );

  it('clamps structured resize to the selected span and 48 pixel minimum', async () => {
    let editor: Editor | null = null;
    const content = spanningBodyContent(2, 2);
    content.content![1] = {
      ...content.content![1],
      attrs: {
        ...content.content![1].attrs,
        verticalAnchor: 'page-position',
        yPx: 80,
        widthPx: 240,
        heightPx: 150,
      },
    };
    const { container } = render(React.createElement(FlowEditor, {
      content,
      columnCount: 3,
      columnGapPx: 24,
      dropCap: false,
      viewScale: 1,
      resolveAssetSource: () => 'data:image/png;base64,SPAN',
      onEditorReady: (readyEditor: Editor | null) => {
        editor = readyEditor;
      },
    }));
    await waitFor(() => expect(editor).not.toBeNull());
    fireEvent.click(container.querySelector(
      '[data-layout-role="occupied-columns"]'
    )!);
    let handle = await waitFor(() => {
      const value = container.querySelector<HTMLButtonElement>(
        '[data-layout-role="occupied-columns"] '
        + '.document-image__resize-handle'
      );
      expect(value).not.toBeNull();
      return value!;
    });
    const maximumWidth = Number(container.querySelector<HTMLElement>(
      '[data-document-span-layout]'
    )!.dataset.spanWidthPx);
    dispatchTestPointer(handle, 'pointerdown', {
      pointerId: 31,
      clientX: 100,
    });
    dispatchTestPointer(handle, 'pointermove', {
      pointerId: 31,
      clientX: 5100,
    });
    dispatchTestPointer(handle, 'pointerup', {
      pointerId: 31,
      clientX: 5100,
    });
    await waitFor(() => {
      expect(findDocumentImageNode(editor!.getJSON())?.attrs?.widthPx)
        .toBe(maximumWidth);
    });

    handle = container.querySelector<HTMLButtonElement>(
      '[data-layout-role="occupied-columns"] '
      + '.document-image__resize-handle'
    )!;
    dispatchTestPointer(handle, 'pointerdown', {
      pointerId: 32,
      clientX: 100,
    });
    dispatchTestPointer(handle, 'pointermove', {
      pointerId: 32,
      clientX: -5100,
    });
    dispatchTestPointer(handle, 'pointerup', {
      pointerId: 32,
      clientX: -5100,
    });
    await waitFor(() => {
      expect(findDocumentImageNode(editor!.getJSON())?.attrs).toMatchObject({
        widthPx: 48,
        heightPx: 30,
      });
    });
  });

  it.each([
    ['page-position', 0.5],
    ['flow', 0.75],
  ] as const)(
    'keeps a %s spanning image selectable over structured text editing at %d scale',
    async (verticalAnchor, viewScale) => {
      let editor: Editor | null = null;
      const content = spanningBodyContent(2, 2);
      content.content![1] = {
        ...content.content![1],
        attrs: {
          ...content.content![1].attrs,
          verticalAnchor,
          yPx: verticalAnchor === 'page-position' ? 120 : 0,
          widthPx: 360,
        },
      };
      const { container } = render(React.createElement(FlowEditor, {
        content,
        columnCount: 3,
        columnGapPx: 24,
        dropCap: false,
        viewScale,
        resolveAssetSource: () => 'data:image/png;base64,SPAN',
        onEditorReady: (readyEditor: Editor | null) => {
          editor = readyEditor;
        },
      }));
      await waitFor(() => expect(editor).not.toBeNull());

      const layout = container.querySelector<HTMLElement>(
        '[data-document-span-layout]'
      )!;
      let imageSlot = container.querySelector<HTMLElement>(
        '[data-layout-role="occupied-columns"]'
      )!;
      fireEvent.click(imageSlot);
      await waitFor(() => {
        expect(editor!.state.selection).toBeInstanceOf(NodeSelection);
      });

      const originalAttributes = {
        ...findDocumentImageNode(editor!.getJSON())!.attrs,
      };
      fireEvent.click(container.querySelector(
        '[data-layout-role="explicit-text-column"]'
      )!);
      await waitFor(() => {
        expect(layout.dataset.textEditing).toBe('true');
      });
      const source = container.querySelector<HTMLElement>(
        '.document-flow-editor__content--structured-text-editing'
      )!;
      const sourceImage = source.querySelector<HTMLElement>(
        '.document-image-node[data-wrap="span-columns"]'
      )!;
      expect(sourceImage.matches(
        '.document-flow-editor__content--structured-text-editing '
        + '.document-image-node[data-wrap="span-columns"]'
      )).toBe(true);
      expect(imageSlot.querySelectorAll(
        '[data-document-image="true"]'
      )).toHaveLength(1);

      const dispatchPointer = (type: string, clientY: number) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, {
          pointerId: { value: 11 },
          clientY: { value: clientY },
        });
        fireEvent(imageSlot, event);
      };
      dispatchPointer('pointerdown', 100);
      dispatchPointer('pointerup', 100);
      fireEvent.click(imageSlot);
      await waitFor(() => {
        expect(layout.dataset.textEditing).toBe('false');
        expect(editor!.state.selection).toBeInstanceOf(NodeSelection);
      });
      expect(findDocumentImageNode(editor!.getJSON())!.attrs)
        .toEqual(originalAttributes);
      expect(container.querySelector(
        '.document-flow-editor__content--structured-source'
      )).not.toBeNull();

      if (verticalAnchor === 'page-position') {
        const resizeHandle = container.querySelector<HTMLElement>(
          '[data-layout-role="occupied-columns"] '
          + '.document-image__resize-handle'
        )!;
        dispatchTestPointer(resizeHandle, 'pointerdown', {
          pointerId: 12,
          clientX: 100,
        });
        dispatchTestPointer(resizeHandle, 'pointermove', {
          pointerId: 12,
          clientX: 130,
        });
        expect(findDocumentImageNode(editor!.getJSON())?.attrs).toMatchObject({
          widthPx: 360,
          yPx: 120,
        });
        dispatchTestPointer(resizeHandle, 'pointerup', {
          pointerId: 12,
          clientX: 130,
        });
        await waitFor(() => {
          expect(findDocumentImageNode(editor!.getJSON())?.attrs)
            .toMatchObject({
              widthPx: 420,
              heightPx: 263,
              yPx: 120,
            });
        });

        imageSlot = container.querySelector<HTMLElement>(
          '[data-layout-role="occupied-columns"]'
        )!;
        dispatchPointer('pointerdown', 100);
        dispatchPointer('pointermove', 130);
        dispatchPointer('pointerup', 130);
        await waitFor(() => {
          expect(findDocumentImageNode(editor!.getJSON())!.attrs?.yPx)
            .toBe(180);
        });
      }
    }
  );

  it.each([0.66, 1, 1.5])(
    'keeps wrapped lower-right flow geometry stable through text selection at %d scale',
    async (viewScale) => {
      let editor: Editor | null = null;
      const paragraphs = Array.from({ length: 12 }, (_, index) => ({
        type: 'paragraph',
        content: [{
          type: 'text',
          text: `COLUMN-${index + 1} ${'archival sentence '.repeat(12)}`,
        }],
      }));
      const image = {
        ...spanningBodyContent(2, 1).content![1],
        attrs: {
          ...spanningBodyContent(2, 1).content![1].attrs,
          id: 'lower-right-wrap-image',
          widthPx: 200,
          heightPx: 125,
          spanCount: 1,
          spanStartColumn: 3,
          verticalAnchor: 'page-position',
          horizontalPlacement: 'custom',
          xOffsetPx: 0,
          yPx: 360,
          wrapPaddingTopPx: 12,
          wrapPaddingRightPx: 12,
          wrapPaddingBottomPx: 12,
          wrapPaddingLeftPx: 12,
        },
      };
      const { container } = render(React.createElement(FlowEditor, {
        content: {
          type: 'doc',
          content: [...paragraphs.slice(0, 6), image, ...paragraphs.slice(6)],
        } as JSONContent,
        columnCount: 3,
        columnGapPx: 24,
        dropCap: false,
        viewScale,
        resolveAssetSource: () => 'data:image/png;base64,SPAN',
        onEditorReady: (readyEditor: Editor | null) => {
          editor = readyEditor;
        },
      }));
      await waitFor(() => {
        expect(editor).not.toBeNull();
        expect(container.querySelector('[data-document-span-layout]'))
          .not.toBeNull();
      });

      const layout = container.querySelector<HTMLElement>(
        '[data-document-span-layout]'
      )!;
      const readGeometry = () => ({
        availableWidth: layout.dataset.layoutAvailableWidthPx,
        availableHeight: layout.dataset.layoutAvailableHeightPx,
        columnWidth: layout.dataset.columnWidthPx,
        exclusions: layout.dataset.layoutExclusions,
        textBands: layout.dataset.layoutTextBands,
        imageLeft: layout.dataset.imageLeftPx,
        imageTop: layout.dataset.imageTopPx,
        imageWidth: layout.dataset.renderedImageWidthPx,
        imageHeight: layout.dataset.renderedImageHeightPx,
        imageSlots: container.querySelectorAll(
          '[data-layout-role="occupied-columns"]'
        ).length,
        sourceSpanImages: container.querySelectorAll(
          '.document-flow-prosemirror '
          + '.document-image-node[data-wrap="span-columns"]'
        ).length,
        renderedText: Array.from(container.querySelectorAll(
          '[data-layout-role="explicit-text-column"]'
        )).map((element) => element.textContent || ''),
      });
      const idleGeometry = readGeometry();
      expect(idleGeometry.imageSlots).toBe(1);
      expect(idleGeometry.sourceSpanImages).toBe(1);
      expect(idleGeometry.renderedText.join('')).toContain('COLUMN-1');

      const selectionEnd = Math.min(
        editor!.state.doc.content.size - 1,
        260
      );
      await act(async () => {
        editor!.commands.focus();
        editor!.commands.setTextSelection({ from: 1, to: selectionEnd });
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(layout.dataset.textEditing).toBe('true');
      });
      expect(readGeometry()).toEqual(idleGeometry);
      expect(layout.dataset.layoutCoordinateSpace).toBe('body');
      expect(layout.dataset.layoutZoom).toBe(String(viewScale));

      let imagePosition = -1;
      editor!.state.doc.descendants((node, position) => {
        if (node.attrs.id === 'lower-right-wrap-image') imagePosition = position;
      });
      expect(imagePosition).toBeGreaterThan(0);
      await act(async () => {
        editor!.commands.setNodeSelection(imagePosition);
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(editor!.state.selection).toBeInstanceOf(NodeSelection);
      });
      expect(readGeometry()).toEqual(idleGeometry);

      fireEvent.click(container.querySelector(
        '[data-layout-role="explicit-text-column"]'
      )!);
      await waitFor(() => {
        expect(layout.dataset.textEditing).toBe('true');
      });
      expect(readGeometry()).toEqual(idleGeometry);
    }
  );

  it.each([0.5, 0.75, 1, 1.5])(
    'moves a fixed spanning image in two dimensions at %d scale',
    async (viewScale) => {
      let editor: Editor | null = null;
      const onUpdate = vi.fn();
      const content = spanningBodyContent(2, 2);
      content.content![1] = {
        ...content.content![1],
        attrs: {
          ...content.content![1].attrs,
          verticalAnchor: 'page-position',
          yPx: 120,
          horizontalPlacement: 'custom',
          xOffsetPx: 40,
          widthPx: 240,
          heightPx: 150,
        },
      };
      const { container } = render(React.createElement(FlowEditor, {
        content,
        columnCount: 3,
        columnGapPx: 24,
        dropCap: false,
        viewScale,
        resolveAssetSource: () => 'data:image/png;base64,SPAN',
        onUpdate,
        onEditorReady: (readyEditor: Editor | null) => {
          editor = readyEditor;
        },
      }));
      await waitFor(() => expect(editor).not.toBeNull());
      const imageSlot = container.querySelector<HTMLElement>(
        '[data-layout-role="occupied-columns"]'
      )!;
      const startLeft = Number(imageSlot.dataset.imageLeftPx);
      const deltaX = 30;
      const deltaY = 24;
      // At 0.5× the requested edge lands within the snap threshold of the
      // next column edge. The other zoom cases remain away from a guide.
      const snapAdjustment = viewScale === 0.5 ? 4 : 0;
      const verticalSnapAdjustment = viewScale === 0.5 ? 7 : 0;
      onUpdate.mockClear();

      dispatchTestPointer(imageSlot, 'pointerdown', {
        pointerId: 71,
        clientX: 100,
        clientY: 100,
      });
      dispatchTestPointer(imageSlot, 'pointermove', {
        pointerId: 71,
        clientX: 100 + deltaX,
        clientY: 100 + deltaY,
      });
      expect(findDocumentImageNode(editor!.getJSON())?.attrs).toMatchObject({
        xOffsetPx: 40,
        yPx: 120,
      });
      expect(onUpdate).not.toHaveBeenCalled();
      await waitFor(() => {
        const preview = container.querySelector<HTMLElement>(
          '[data-layout-role="occupied-columns"]'
        )!;
        expect(Number(preview.dataset.imageLeftPx)).toBeCloseTo(
          startLeft + deltaX / viewScale + snapAdjustment,
          4
        );
      });

      dispatchTestPointer(window, 'pointerup', {
        pointerId: 71,
        clientX: 100 + deltaX,
        clientY: 100 + deltaY,
      });
      await waitFor(() => {
        expect(findDocumentImageNode(editor!.getJSON())?.attrs).toMatchObject({
          horizontalPlacement: 'custom',
          xOffsetPx: 40 + deltaX / viewScale + snapAdjustment,
          yPx: 120 + deltaY / viewScale + verticalSnapAdjustment,
        });
        expect(Number(container.querySelector<HTMLElement>(
          '[data-layout-role="occupied-columns"]'
        )!.dataset.imageXOffsetPx)).toBeCloseTo(
          40 + deltaX / viewScale + snapAdjustment,
          5
        );
      });
      expect(onUpdate).toHaveBeenCalledTimes(1);
      dispatchTestPointer(window, 'pointerup', {
        pointerId: 71,
        clientX: 100 + deltaX,
        clientY: 100 + deltaY,
      });
      expect(onUpdate).toHaveBeenCalledTimes(1);

      editor!.commands.undo();
      expect(findDocumentImageNode(editor!.getJSON())?.attrs).toMatchObject({
        xOffsetPx: 40,
        yPx: 120,
      });
      editor!.commands.redo();
      expect(findDocumentImageNode(editor!.getJSON())?.attrs).toMatchObject({
        xOffsetPx: 40 + deltaX / viewScale + snapAdjustment,
        yPx: 120 + deltaY / viewScale + verticalSnapAdjustment,
      });
    }
  );

  it('commits the latest structured move from the window mouseup fallback', async () => {
    let editor: Editor | null = null;
    const onUpdate = vi.fn();
    const content = spanningBodyContent(2, 2);
    content.content![1] = {
      ...content.content![1],
      attrs: {
        ...content.content![1].attrs,
        verticalAnchor: 'page-position',
        yPx: 100,
        horizontalPlacement: 'custom',
        xOffsetPx: 20,
        widthPx: 240,
        heightPx: 150,
      },
    };
    const { container } = render(React.createElement(FlowEditor, {
      content,
      columnCount: 3,
      columnGapPx: 24,
      dropCap: false,
      viewScale: 1,
      resolveAssetSource: () => 'data:image/png;base64,SPAN',
      onUpdate,
      onEditorReady: (readyEditor: Editor | null) => {
        editor = readyEditor;
      },
    }));
    await waitFor(() => expect(editor).not.toBeNull());
    const imageSlot = container.querySelector<HTMLElement>(
      '[data-layout-role="occupied-columns"]'
    )!;
    onUpdate.mockClear();
    dispatchTestPointer(imageSlot, 'pointerdown', {
      pointerId: 72,
      clientX: 100,
      clientY: 100,
    });
    dispatchTestPointer(imageSlot, 'pointermove', {
      pointerId: 72,
      clientX: 145,
      clientY: 130,
    });
    fireEvent.mouseUp(window);

    await waitFor(() => {
      expect(findDocumentImageNode(editor!.getJSON())?.attrs).toMatchObject({
        horizontalPlacement: 'custom',
        xOffsetPx: 65,
        yPx: 130,
      });
      expect(Number(container.querySelector<HTMLElement>(
        '[data-layout-role="occupied-columns"]'
      )!.dataset.imageXOffsetPx)).toBe(65);
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it.each(['pointercancel', 'blur'] as const)(
    'restores the original structured position after window %s',
    async (finishEvent) => {
      let editor: Editor | null = null;
      const onUpdate = vi.fn();
      const content = spanningBodyContent(2, 2);
      content.content![1] = {
        ...content.content![1],
        attrs: {
          ...content.content![1].attrs,
          verticalAnchor: 'page-position',
          yPx: 100,
          horizontalPlacement: 'custom',
          xOffsetPx: 20,
          widthPx: 240,
          heightPx: 150,
        },
      };
      const { container } = render(React.createElement(FlowEditor, {
        content,
        columnCount: 3,
        columnGapPx: 24,
        dropCap: false,
        viewScale: 1,
        resolveAssetSource: () => 'data:image/png;base64,SPAN',
        onUpdate,
        onEditorReady: (readyEditor: Editor | null) => {
          editor = readyEditor;
        },
      }));
      await waitFor(() => expect(editor).not.toBeNull());
      const imageSlot = container.querySelector<HTMLElement>(
        '[data-layout-role="occupied-columns"]'
      )!;
      onUpdate.mockClear();
      dispatchTestPointer(imageSlot, 'pointerdown', {
        pointerId: 73,
        clientX: 100,
        clientY: 100,
      });
      dispatchTestPointer(imageSlot, 'pointermove', {
        pointerId: 73,
        clientX: 150,
        clientY: 140,
      });
      await waitFor(() => {
        expect(Number(container.querySelector<HTMLElement>(
          '[data-layout-role="occupied-columns"]'
        )!.dataset.imageXOffsetPx)).toBe(70);
      });

      if (finishEvent === 'pointercancel') {
        dispatchTestPointer(window, 'pointercancel', {
          pointerId: 73,
          clientX: 150,
          clientY: 140,
        });
      } else {
        fireEvent(window, new Event('blur'));
      }
      await waitFor(() => {
        expect(Number(container.querySelector<HTMLElement>(
          '[data-layout-role="occupied-columns"]'
        )!.dataset.imageXOffsetPx)).toBe(20);
      });
      expect(findDocumentImageNode(editor!.getJSON())?.attrs).toMatchObject({
        xOffsetPx: 20,
        yPx: 100,
      });
      expect(onUpdate).not.toHaveBeenCalled();
    }
  );

  it('commits a structured move by stable image id when selection and position are stale', async () => {
    let editor: Editor | null = null;
    const onUpdate = vi.fn();
    const content = spanningBodyContent(2, 2);
    content.content![1] = {
      ...content.content![1],
      attrs: {
        ...content.content![1].attrs,
        verticalAnchor: 'page-position',
        yPx: 100,
        horizontalPlacement: 'custom',
        xOffsetPx: 20,
      },
    };
    render(React.createElement(FlowEditor, {
      content,
      columnCount: 3,
      columnGapPx: 24,
      dropCap: false,
      resolveAssetSource: () => 'data:image/png;base64,SPAN',
      onUpdate,
      onEditorReady: (readyEditor: Editor | null) => {
        editor = readyEditor;
      },
    }));
    await waitFor(() => expect(editor).not.toBeNull());
    editor!.commands.setTextSelection(1);
    onUpdate.mockClear();

    expect(commitStructuredDocumentImagePosition(
      editor!,
      0,
      'span-family-photo',
      55,
      160
    )).toBe(true);
    expect(findDocumentImageNode(editor!.getJSON())?.attrs).toMatchObject({
      verticalAnchor: 'page-position',
      horizontalPlacement: 'custom',
      xOffsetPx: 55,
      yPx: 160,
    });
    expect(editor!.state.selection).toBeInstanceOf(NodeSelection);
    expect((editor!.state.selection as NodeSelection).node.attrs.id)
      .toBe('span-family-photo');
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('renders and excludes two independently positioned spanning images', async () => {
    let editor: Editor | null = null;
    const first = {
      ...spanningBodyContent(2, 1).content![1],
      attrs: {
        ...spanningBodyContent(2, 1).content![1].attrs,
        id: 'span-left',
        caption: 'Left photograph',
        widthPx: 240,
        heightPx: 150,
        wrapPaddingPx: 0,
        verticalSpacingPx: 0,
        verticalAnchor: 'page-position',
        yPx: 140,
        horizontalPlacement: 'left',
        xOffsetPx: 0,
      },
    };
    const second = {
      ...spanningBodyContent(2, 2).content![1],
      attrs: {
        ...spanningBodyContent(2, 2).content![1].attrs,
        id: 'span-right',
        caption: 'Right photograph',
        widthPx: 240,
        heightPx: 150,
        wrapPaddingPx: 0,
        verticalSpacingPx: 0,
        verticalAnchor: 'page-position',
        yPx: 140,
        horizontalPlacement: 'right',
        xOffsetPx: 0,
      },
    };
    const markers = Array.from({ length: 10 }, (_, index) => ({
      type: 'paragraph',
      content: [{
        type: 'text',
        text: `MULTI-${index + 1} ${'marked text '.repeat(5)}`,
        ...(index === 3 ? {
          marks: [{
            type: 'documentTextStyle',
            attrs: { fontSizePx: 18 },
          }],
        } : {}),
      }],
    }));
    const { container } = render(React.createElement(FlowEditor, {
      content: {
        type: 'doc',
        content: [...markers.slice(0, 4), first, second, ...markers.slice(4)],
      } as JSONContent,
      columnCount: 3,
      columnGapPx: 24,
      dropCap: false,
      resolveAssetSource: () => 'data:image/png;base64,MULTI',
      onEditorReady: (readyEditor: Editor | null) => {
        editor = readyEditor;
      },
    }));
    await waitFor(() => expect(editor).not.toBeNull());

    const model = buildMultiDocumentSpanLayoutModel(
      editor!,
      3,
      24,
      720,
      620
    )!;
    expect(model.images).toHaveLength(2);
    expect(model.collisionRectangles).toHaveLength(2);
    expect(rectanglesOverlap(
      model.collisionRectangles[0],
      model.collisionRectangles[1]
    )).toBe(false);
    expect(model.images[0].attributes.horizontalPlacement).toBe('left');
    expect(model.images[0].imageLeftPx).toBe(0);
    expect(model.images[1].attributes.horizontalPlacement).toBe('right');
    expect(
      model.images[1].imageLeftPx + model.images[1].renderedImageWidthPx
    ).toBeCloseTo(720, 5);
    expect(model.exclusions.map((rectangle) => rectangle.widthPx))
      .toEqual(model.images.map((image) => image.renderedImageWidthPx));
    const rendered = model.textBands.map((band) => band.html).join('');
    for (let index = 1; index <= 10; index += 1) {
      expect(countTextOccurrences(rendered, `MULTI-${index} `)).toBe(1);
    }
    expect(rendered).toContain('data-font-size-px="18"');
    expect(container.querySelectorAll(
      '[data-layout-role="occupied-columns"]'
    )).toHaveLength(2);
    expect(container.querySelector<HTMLElement>(
      '[data-document-span-layout]'
    )!.dataset.structuredImageCount).toBe('2');
    const storedImages = (editor!.getJSON().content || []).filter(
      (node) => node.type === 'documentFlowImage'
    );
    expect(storedImages).toHaveLength(2);
    expect(storedImages.every(
      (node) => node.attrs?.wrap === 'span-columns'
    )).toBe(true);

    let imageSlots = container.querySelectorAll<HTMLElement>(
      '[data-layout-role="occupied-columns"]'
    );
    fireEvent.click(imageSlots[1]);
    await waitFor(() => {
      expect(
        (editor!.state.selection as NodeSelection).node.attrs.id
      ).toBe('span-right');
    });
    fireEvent.click(container.querySelector(
      '[data-layout-role="explicit-text-column"]'
    )!);
    await waitFor(() => {
      expect(container.querySelector<HTMLElement>(
        '[data-document-span-layout]'
      )!.dataset.textEditing).toBe('true');
    });
    expect(container.querySelectorAll(
      '[data-layout-role="occupied-columns"]'
    )).toHaveLength(2);
    imageSlots = container.querySelectorAll<HTMLElement>(
      '[data-layout-role="occupied-columns"]'
    );
    fireEvent.click(imageSlots[0]);
    await waitFor(() => {
      expect(
        (editor!.state.selection as NodeSelection).node.attrs.id
      ).toBe('span-left');
      expect(container.querySelectorAll(
        '[data-layout-role="occupied-columns"] '
        + '.document-image__resize-handle'
      )).toHaveLength(1);
    });

    const firstBefore = (editor!.getJSON().content || []).find(
      (node) => node.attrs?.id === 'span-left'
    )!.attrs!;
    const secondBefore = (editor!.getJSON().content || []).find(
      (node) => node.attrs?.id === 'span-right'
    )!.attrs!;
    const firstSlot = container.querySelector<HTMLElement>(
      '[data-layout-role="occupied-columns"][data-image-id="span-left"]'
    )!;
    dispatchTestPointer(firstSlot, 'pointerdown', {
      pointerId: 81,
      clientX: 100,
      clientY: 100,
    });
    dispatchTestPointer(firstSlot, 'pointermove', {
      pointerId: 81,
      clientX: 140,
      clientY: 100,
    });
    dispatchTestPointer(window, 'pointerup', {
      pointerId: 81,
      clientX: 140,
      clientY: 100,
    });
    await waitFor(() => {
      const images = editor!.getJSON().content || [];
      expect(images.find(
        (node) => node.attrs?.id === 'span-left'
      )?.attrs?.xOffsetPx).toBe(40);
      expect(images.find(
        (node) => node.attrs?.id === 'span-right'
      )?.attrs).toEqual(secondBefore);
    });
    editor!.commands.undo();
    expect((editor!.getJSON().content || []).find(
      (node) => node.attrs?.id === 'span-left'
    )?.attrs).toEqual(firstBefore);
    editor!.commands.redo();
    expect((editor!.getJSON().content || []).find(
      (node) => node.attrs?.id === 'span-left'
    )?.attrs?.xOffsetPx).toBe(40);

    const secondSlot = container.querySelector<HTMLElement>(
      '[data-layout-role="occupied-columns"][data-image-id="span-right"]'
    )!;
    const secondStartX = Number(secondSlot.dataset.imageXOffsetPx);
    dispatchTestPointer(secondSlot, 'pointerdown', {
      pointerId: 82,
      clientX: 200,
      clientY: 100,
    });
    dispatchTestPointer(secondSlot, 'pointermove', {
      pointerId: 82,
      clientX: 170,
      clientY: 100,
    });
    dispatchTestPointer(window, 'pointerup', {
      pointerId: 82,
      clientX: 170,
      clientY: 100,
    });
    await waitFor(() => {
      const images = editor!.getJSON().content || [];
      expect(images.find(
        (node) => node.attrs?.id === 'span-left'
      )?.attrs?.xOffsetPx).toBe(40);
      expect(images.find(
        (node) => node.attrs?.id === 'span-right'
      )?.attrs).toMatchObject({
        horizontalPlacement: 'custom',
        xOffsetPx: secondStartX - 30,
      });
    });
  });

  it('stops two-dimensional movement at the nearest image collision', () => {
    const start = {
      imageId: 'moving',
      leftPx: 0,
      topPx: 100,
      widthPx: 100,
      heightPx: 100,
    };
    const moved = moveRectangleWithoutCollisions({
      start,
      desiredLeftPx: 300,
      desiredTopPx: 100,
      obstacles: [{
        imageId: 'fixed',
        leftPx: 180,
        topPx: 100,
        widthPx: 100,
        heightPx: 100,
      }],
    });
    expect(moved).toEqual({ leftPx: 80, topPx: 100 });
    expect(rectanglesOverlap(
      { ...start, leftPx: moved.leftPx, topPx: moved.topPx },
      {
        imageId: 'fixed',
        leftPx: 180,
        topPx: 100,
        widthPx: 100,
        heightPx: 100,
      }
    )).toBe(false);
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
