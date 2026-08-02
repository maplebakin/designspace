import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  DocumentToolbar,
  type DocumentImageGroupInspectorValue,
  type DocumentImageInspectorValue,
} from '../src/document/components/DocumentToolbar';
import { DEFAULT_DOCUMENT_DROP_CAP } from '../src/document/typography/documentTypography';
import type { DocumentPage } from '../src/document/types/documentProject';

const page: DocumentPage = {
  kind: 'document',
  id: 'page-1',
  name: 'Page 1',
  size: {
    presetId: 'letter',
    orientation: 'portrait',
    widthIn: 8.5,
    heightIn: 11,
    dpi: 300,
  },
  margins: {
    topIn: 0.5,
    bottomIn: 0.5,
    innerIn: 0.5,
    outerIn: 0.5,
  },
  titleContent: {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  },
  bodyContent: {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  },
  columnCount: 3,
  columnGapPx: 24,
  language: 'de',
  dropCap: DEFAULT_DOCUMENT_DROP_CAP,
  suppressFolio: false,
  overlayObjects: [],
};

const selectedImage: DocumentImageInspectorValue = {
  id: 'image-a',
  kind: 'flow',
  widthPx: 240,
  heightPx: 160,
  wrap: 'span-columns',
  verticalAnchor: 'page-position',
  horizontalPlacement: 'left',
  spanCount: 2,
  spanStartColumn: 1,
  wrapPaddingTopPx: 12,
  wrapPaddingRightPx: 12,
  wrapPaddingBottomPx: 12,
  wrapPaddingLeftPx: 12,
  caption: 'Independent caption',
  captionAlignment: 'center',
  captionItalic: true,
  captionSpacingPx: 6,
  altText: 'Historical photograph',
};

const renderToolbar = (
  overrides: Partial<React.ComponentProps<typeof DocumentToolbar>> = {}
) => render(React.createElement(DocumentToolbar, {
  page,
  activeTextRegion: 'body',
  selectedImage: null,
  referenceAdjustMode: false,
  textFormatState: {
    bold: false,
    italic: false,
    underline: false,
    alignment: 'justify',
    fontSizePt: 10.5,
    blockStyleId: 'body',
  },
  onFormat: () => undefined,
  onFontSizeChange: () => undefined,
  onBlockStyleChange: () => undefined,
  onImportImages: () => undefined,
  onReferenceAdjustModeChange: () => undefined,
  onReferenceChange: () => undefined,
  onResetReference: () => undefined,
  onSelectedImageChange: () => undefined,
  onSelectedImageLayoutChange: () => undefined,
  onSelectedImageSpanStartChange: () => undefined,
  onMoveSelectedImage: () => undefined,
  onReplaceSelectedImage: () => undefined,
  onDeleteSelectedImage: () => undefined,
  onResetSelectedImageSize: () => undefined,
  ...overrides,
}));

afterEach(cleanup);

describe('DocumentToolbar image group controls', () => {
  it('offers row and stack arrangement for a transient multi-selection', () => {
    const onArrangeSelectedImages = vi.fn();
    renderToolbar({
      selectedImageIds: ['image-a', 'image-b'],
      onArrangeSelectedImages,
    });

    const selection = screen.getByTestId('document-image-group-selection');
    expect(selection.getAttribute('data-image-count')).toBe('2');

    fireEvent.click(screen.getByTestId('document-image-group-row'));
    fireEvent.click(screen.getByTestId('document-image-group-stack'));

    expect(onArrangeSelectedImages).toHaveBeenNthCalledWith(1, 'row');
    expect(onArrangeSelectedImages).toHaveBeenNthCalledWith(2, 'stack');
  });

  it('edits an active stack while retaining individual image controls', () => {
    const selectedImageGroup: DocumentImageGroupInspectorValue = {
      id: 'group-1',
      kind: 'stack',
      childImageIds: ['image-a', 'image-b'],
      gapPx: 16,
      sharedWidth: false,
    };
    const onSelectedImageGroupChange = vi.fn();
    const onUngroupSelectedImages = vi.fn();

    renderToolbar({
      selectedImage,
      selectedImageIds: ['image-a', 'image-b'],
      selectedImageGroup,
      onSelectedImageGroupChange,
      onUngroupSelectedImages,
    });

    expect(
      (screen.getByTestId('document-image-caption') as HTMLInputElement).value
    ).toBe('Independent caption');
    expect(
      screen.getByTestId('document-image-group-stack')
        .getAttribute('aria-pressed')
    ).toBe('true');

    fireEvent.click(screen.getByTestId('document-image-group-row'));
    fireEvent.change(screen.getByTestId('document-image-group-gap'), {
      target: { value: '999' },
    });
    fireEvent.click(screen.getByTestId('document-image-group-shared-width'));
    fireEvent.click(screen.getByTestId('document-image-group-ungroup'));

    expect(onSelectedImageGroupChange).toHaveBeenNthCalledWith(1, {
      kind: 'row',
    });
    expect(onSelectedImageGroupChange).toHaveBeenNthCalledWith(2, {
      gapPx: 480,
    });
    expect(onSelectedImageGroupChange).toHaveBeenNthCalledWith(3, {
      sharedWidth: true,
    });
    expect(onUngroupSelectedImages).toHaveBeenCalledTimes(1);
  });
});
