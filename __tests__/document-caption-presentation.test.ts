import React from 'react';
import { generateHTML, generateJSON, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
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
import { DocumentOverlayLayer } from '../src/document/components/DocumentOverlayLayer';
import {
  DocumentToolbar,
  type DocumentImageInspectorValue,
} from '../src/document/components/DocumentToolbar';
import {
  DocumentFlowImageExtension,
  normalizeDocumentImageAttributes,
} from '../src/document/extensions/DocumentImageExtension';
import { DEFAULT_DOCUMENT_DROP_CAP } from '../src/document/typography/documentTypography';
import type {
  DocumentOverlayImage,
  DocumentPage,
} from '../src/document/types/documentProject';

const imageExtensions = [
  StarterKit.configure({
    blockquote: false,
    bulletList: false,
    code: false,
    codeBlock: false,
    heading: false,
    horizontalRule: false,
    link: false,
    listItem: false,
    listKeymap: false,
    orderedList: false,
    strike: false,
  }),
  DocumentFlowImageExtension.configure({
    resolveAssetSource: () => 'data:image/png;base64,AA==',
    getViewScale: () => 1,
    minWidthPx: 48,
    maxWidthPx: 720,
    maxSpanWidthPx: 720,
    getSpanWidthPx: () => 720,
  }),
];

const page: DocumentPage = {
  kind: 'document',
  id: 'caption-page',
  name: 'Caption page',
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
  id: 'caption-image',
  kind: 'flow',
  widthPx: 240,
  heightPx: 160,
  wrap: 'float-left',
  caption: 'Eine Bildunterschrift',
  captionAlignment: 'left',
  captionItalic: true,
  captionSpacingPx: 5,
  altText: '',
};

afterEach(() => {
  cleanup();
});

describe('document image caption presentation', () => {
  it('inherits named defaults and bounds explicit presentation values', () => {
    expect(normalizeDocumentImageAttributes({})).toMatchObject({
      captionAlignment: 'inherit',
      captionItalic: 'inherit',
      captionSpacingPx: 'inherit',
    });

    expect(normalizeDocumentImageAttributes({
      captionAlignment: 'center',
      captionItalic: false,
      captionSpacingPx: 140,
    })).toMatchObject({
      captionAlignment: 'center',
      captionItalic: false,
      captionSpacingPx: 96,
    });

    expect(normalizeDocumentImageAttributes({
      captionAlignment: 'start' as never,
      captionSpacingPx: -20,
    })).toMatchObject({
      captionAlignment: 'inherit',
      captionSpacingPx: 0,
    });
  });

  it('does not shadow the named caption style without an explicit override', () => {
    const content: JSONContent = {
      type: 'doc',
      content: [{
        type: 'documentFlowImage',
        attrs: {
          id: 'inherited-caption',
          assetId: 'caption-asset',
          caption: 'Named-style caption',
        },
      }],
    };

    const html = generateHTML(content, imageExtensions);
    expect(html).toContain('data-caption-alignment="inherit"');
    expect(html).toContain('data-caption-italic="inherit"');
    expect(html).toContain('data-caption-spacing-px="inherit"');
    expect(html).not.toContain('--document-caption-alignment:');
    expect(html).not.toContain('--document-caption-font-style:');
    expect(html).not.toContain('--document-caption-spacing:');
  });

  it('round-trips caption presentation through Tiptap JSON and safe HTML', () => {
    const content: JSONContent = {
      type: 'doc',
      content: [{
        type: 'documentFlowImage',
        attrs: {
          id: 'caption-image',
          assetId: 'caption-asset',
          altText: 'Historical photograph',
          widthPx: 240,
          heightPx: 160,
          naturalWidth: 1200,
          naturalHeight: 800,
          wrap: 'float-left',
          caption: 'Centered caption',
          captionAlignment: 'center',
          captionItalic: false,
          captionSpacingPx: 18,
        },
      }],
    };

    const html = generateHTML(content, imageExtensions);
    expect(html).toContain('data-caption-alignment="center"');
    expect(html).toContain('data-caption-italic="false"');
    expect(html).toContain('data-caption-spacing-px="18"');
    expect(html).toContain('--document-caption-spacing: 18px');

    const parsed = generateJSON(html, imageExtensions);
    expect(parsed.content?.[0]?.attrs).toMatchObject({
      caption: 'Centered caption',
      captionAlignment: 'center',
      captionItalic: false,
      captionSpacingPx: 18,
    });
  });

  it('renders overlay captions from the same explicit presentation values', () => {
    const overlay: DocumentOverlayImage = {
      id: 'overlay-caption',
      assetId: 'caption-asset',
      altText: 'Historical photograph',
      xPx: 40,
      yPx: 60,
      widthPx: 240,
      heightPx: 160,
      placement: 'front',
      caption: 'Overlay caption',
      captionAlignment: 'right',
      captionItalic: false,
      captionSpacingPx: 22,
    };

    render(React.createElement(DocumentOverlayLayer, {
      placement: 'front',
      objects: [overlay],
      assetSources: {
        'caption-asset': 'data:image/png;base64,AA==',
      },
      selectedId: null,
      zoom: 1,
      onSelect: () => undefined,
      onChange: () => undefined,
    }));

    const figure = screen.getByTestId('document-overlay-image');
    const caption = figure.querySelector('figcaption');
    expect(figure.getAttribute('data-caption-alignment')).toBe('right');
    expect(figure.getAttribute('data-caption-italic')).toBe('false');
    expect(figure.getAttribute('data-caption-spacing-px')).toBe('22');
    expect(figure.style.getPropertyValue('--document-caption-alignment'))
      .toBe('right');
    expect(figure.style.getPropertyValue('--document-caption-font-style'))
      .toBe('normal');
    expect(figure.style.getPropertyValue('--document-caption-spacing'))
      .toBe('22px');
    expect(caption?.textContent).toBe('Overlay caption');
  });

  it('exposes bounded alignment, italic, and spacing inspector controls', () => {
    const onSelectedImageChange = vi.fn();
    render(React.createElement(DocumentToolbar, {
      page,
      activeTextRegion: 'body',
      selectedImage,
      referenceAdjustMode: false,
      textFormatState: {
        bold: false,
        italic: false,
        underline: false,
        alignment: 'left',
        fontSizePt: 10.5,
      },
      onFormat: () => undefined,
      onFontSizeChange: () => undefined,
      onImportImages: () => undefined,
      onReferenceAdjustModeChange: () => undefined,
      onReferenceChange: () => undefined,
      onResetReference: () => undefined,
      onSelectedImageChange,
      onSelectedImageLayoutChange: () => undefined,
      onSelectedImageSpanStartChange: () => undefined,
      onMoveSelectedImage: () => undefined,
      onReplaceSelectedImage: () => undefined,
      onDeleteSelectedImage: () => undefined,
      onResetSelectedImageSize: () => undefined,
    }));

    fireEvent.change(screen.getByLabelText('Caption alignment'), {
      target: { value: 'center' },
    });
    fireEvent.change(screen.getByLabelText('Caption italic style'), {
      target: { value: 'roman' },
    });
    fireEvent.change(screen.getByLabelText('Caption spacing'), {
      target: { value: '140' },
    });

    expect(onSelectedImageChange).toHaveBeenNthCalledWith(1, {
      captionAlignment: 'center',
    });
    expect(onSelectedImageChange).toHaveBeenNthCalledWith(2, {
      captionItalic: false,
    });
    expect(onSelectedImageChange).toHaveBeenNthCalledWith(3, {
      captionSpacingPx: 96,
    });
  });
});
