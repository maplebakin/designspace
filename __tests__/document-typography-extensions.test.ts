import {
  Editor,
  generateHTML,
  generateJSON,
  type JSONContent,
} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  DocumentBlockStyleExtension,
  type DocumentBlockStyleId,
  normalizeDocumentBlockStyleId,
} from '../src/document/extensions/DocumentBlockStyleExtension';
import {
  DocumentTextStyleExtension,
  documentPixelsToPoints,
  documentPointsToPixels,
  normalizeDocumentFontSize,
} from '../src/document/extensions/DocumentTextStyleExtension';

const editors: Editor[] = [];

const extensions = (defaultStyleId: DocumentBlockStyleId = 'body') => [
  StarterKit,
  DocumentBlockStyleExtension.configure({ defaultStyleId }),
  DocumentTextStyleExtension,
];

const createEditor = (
  content: JSONContent,
  defaultStyleId: DocumentBlockStyleId = 'body'
) => {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: extensions(defaultStyleId),
    content,
  });
  editors.push(editor);
  return editor;
};

const paragraphStyleIds = (content: JSONContent) =>
  (content.content ?? []).map((node) => node.attrs?.documentStyleId);

const firstTextStyleAttributes = (content: JSONContent) => {
  const paragraph = content.content?.[0];
  const text = paragraph?.content?.find((node) => node.type === 'text');
  return text?.marks?.find(
    (mark) => mark.type === 'documentTextStyle'
  )?.attrs;
};

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe('DocumentBlockStyleExtension', () => {
  it('uses a configurable, bounded default semantic paragraph role', () => {
    const bodyEditor = createEditor({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
    const titleEditor = createEditor({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    }, 'article-title');

    expect(paragraphStyleIds(bodyEditor.getJSON())).toEqual(['body']);
    expect(paragraphStyleIds(titleEditor.getJSON())).toEqual([
      'article-title',
    ]);
    expect(titleEditor.getHTML()).toContain(
      'data-document-style-id="article-title"'
    );
  });

  it('applies each supported role and rejects caption or arbitrary values', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Second' }],
        },
      ],
    });
    editor.commands.selectAll();

    expect(editor.commands.setDocumentSubsectionHeadingStyle()).toBe(true);
    expect(paragraphStyleIds(editor.getJSON())).toEqual([
      'subsection-heading',
      'subsection-heading',
    ]);
    expect(editor.commands.setDocumentQuotationStyle()).toBe(true);
    expect(paragraphStyleIds(editor.getJSON())).toEqual([
      'quotation',
      'quotation',
    ]);
    expect(editor.commands.setDocumentAuthorSignatureStyle()).toBe(true);
    expect(paragraphStyleIds(editor.getJSON())).toEqual([
      'author-signature',
      'author-signature',
    ]);
    expect(editor.commands.setDocumentArticleTitleStyle()).toBe(true);
    expect(paragraphStyleIds(editor.getJSON())).toEqual([
      'article-title',
      'article-title',
    ]);
    expect(editor.commands.setDocumentBodyStyle()).toBe(true);

    const setUncheckedStyle = editor.commands.setDocumentBlockStyle as (
      value: string
    ) => boolean;
    expect(setUncheckedStyle('caption')).toBe(false);
    expect(setUncheckedStyle('position:fixed')).toBe(false);
    expect(paragraphStyleIds(editor.getJSON())).toEqual(['body', 'body']);
  });

  it('round-trips roles through data attributes and repairs invalid roles', () => {
    const content: JSONContent = {
      type: 'doc',
      content: [
        'body',
        'subsection-heading',
        'quotation',
        'author-signature',
        'article-title',
      ].map((documentStyleId) => ({
        type: 'paragraph',
        attrs: { documentStyleId },
        content: [{ type: 'text', text: documentStyleId }],
      })),
    };

    const html = generateHTML(content, extensions());
    expect(html.match(/data-document-style-id=/g)).toHaveLength(5);
    expect(paragraphStyleIds(generateJSON(html, extensions()))).toEqual([
      'body',
      'subsection-heading',
      'quotation',
      'author-signature',
      'article-title',
    ]);

    const repaired = generateJSON(
      '<p data-document-style-id="caption">Caption</p>'
      + '<p data-document-style-id="position:fixed">Unsafe</p>',
      extensions('article-title')
    );
    expect(paragraphStyleIds(repaired)).toEqual([
      'article-title',
      'article-title',
    ]);
    expect(normalizeDocumentBlockStyleId('caption')).toBe('body');
  });

  it('round-trips bounded legacy block-size overrides on empty titles', () => {
    const content: JSONContent = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: {
          documentStyleId: 'article-title',
          documentStyleFontSizePx: 31,
        },
      }],
    };
    const html = generateHTML(content, extensions('article-title'));
    expect(html).toContain(
      'data-document-style-font-size-px="31"'
    );
    expect(html).toContain('font-size: 31px');

    const roundTripped = generateJSON(
      html,
      extensions('article-title')
    );
    expect(roundTripped.content?.[0].attrs).toMatchObject({
      documentStyleId: 'article-title',
      documentStyleFontSizePx: 31,
    });
    const clamped = generateJSON(
      '<p data-document-style-font-size-px="9999">Title</p>',
      extensions('article-title')
    );
    expect(clamped.content?.[0].attrs?.documentStyleFontSizePx).toBe(240);

    const editor = createEditor(content, 'article-title');
    editor.commands.focus('end');
    editor.commands.insertContent('First line');
    editor.commands.splitBlock();
    editor.commands.insertContent('Second line');
    expect(editor.getJSON().content?.map(
      (node) => node.attrs?.documentStyleFontSizePx
    )).toEqual([31, 31]);
  });
});

describe('DocumentTextStyleExtension', () => {
  it('keeps the point-size API and bounds absent or extreme values', () => {
    expect(normalizeDocumentFontSize(null)).toBeNull();
    expect(normalizeDocumentFontSize('')).toBeNull();
    expect(normalizeDocumentFontSize('not-a-number')).toBeNull();
    expect(normalizeDocumentFontSize(0)).toBe(8);
    expect(normalizeDocumentFontSize(1000)).toBe(140);
    expect(documentPointsToPixels(12)).toBe(16);
    expect(documentPixelsToPoints(documentPointsToPixels(10))).toBe(10);
  });

  it('applies bounded inline overrides without discarding sibling overrides', () => {
    const editor = createEditor({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Styled text' }],
      }],
    });
    editor.commands.selectAll();

    expect(editor.commands.setDocumentFontSize(18)).toBe(true);
    expect(editor.commands.setDocumentFontFamily('book-serif')).toBe(true);
    expect(editor.commands.setDocumentTextColor('#12aBcF')).toBe(true);
    expect(editor.commands.setDocumentTrackingEm(0.125)).toBe(true);
    expect(firstTextStyleAttributes(editor.getJSON())).toEqual({
      fontSizePx: 18,
      fontFamilyId: 'book-serif',
      textColor: '#12ABCF',
      trackingEm: 0.125,
    });

    expect(editor.commands.unsetDocumentFontSize()).toBe(true);
    expect(firstTextStyleAttributes(editor.getJSON())).toEqual({
      fontSizePx: null,
      fontFamilyId: 'book-serif',
      textColor: '#12ABCF',
      trackingEm: 0.125,
    });

    expect(editor.commands.setDocumentTrackingEm(99)).toBe(true);
    expect(firstTextStyleAttributes(editor.getJSON())?.trackingEm).toBe(0.5);
    expect(editor.commands.setDocumentTrackingEm(-99)).toBe(true);
    expect(firstTextStyleAttributes(editor.getJSON())?.trackingEm).toBe(-0.15);

    expect(editor.commands.unsetDocumentFontFamily()).toBe(true);
    expect(editor.commands.unsetDocumentTextColor()).toBe(true);
    expect(editor.commands.unsetDocumentTrackingEm()).toBe(true);
    expect(firstTextStyleAttributes(editor.getJSON())).toEqual({
      fontSizePx: null,
      fontFamilyId: null,
      textColor: null,
      trackingEm: null,
    });
  });

  it('rejects unbounded inline values without changing committed marks', () => {
    const editor = createEditor({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Safe text' }],
      }],
    });
    editor.commands.selectAll();
    editor.commands.setDocumentFontFamily('historical-serif');
    editor.commands.setDocumentTextColor('#123456');
    editor.commands.setDocumentTrackingEm(0.05);
    const before = firstTextStyleAttributes(editor.getJSON());

    const setUncheckedFamily = editor.commands.setDocumentFontFamily as (
      value: string
    ) => boolean;
    expect(setUncheckedFamily('serif; position: fixed')).toBe(false);
    expect(editor.commands.setDocumentTextColor('red')).toBe(false);
    expect(editor.commands.setDocumentTextColor(
      '#fff; background: url(example.invalid)'
    )).toBe(false);
    expect(editor.commands.setDocumentTrackingEm(Number.NaN)).toBe(false);
    expect(editor.commands.setDocumentFontSize(Number.NaN)).toBe(false);
    expect(firstTextStyleAttributes(editor.getJSON())).toEqual(before);
  });

  it('round-trips trusted values through HTML and ignores arbitrary CSS', () => {
    const content: JSONContent = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'Historical style',
          marks: [{
            type: 'documentTextStyle',
            attrs: {
              fontSizePx: 18,
              fontFamilyId: 'classic-serif',
              textColor: '#285F9E',
              trackingEm: 0.075,
            },
          }],
        }],
      }],
    };

    const html = generateHTML(content, extensions());
    const host = document.createElement('div');
    host.innerHTML = html;
    const span = host.querySelector('span') as HTMLElement;
    expect(span.dataset.fontSizePx).toBe('18');
    expect(span.dataset.fontFamilyId).toBe('classic-serif');
    expect(span.dataset.textColor).toBe('#285F9E');
    expect(span.dataset.trackingEm).toBe('0.075');
    expect(span.style.fontSize).toBe('18px');
    expect(span.style.fontFamily).toContain('Times New Roman');
    expect(span.style.color).toBe('rgb(40, 95, 158)');
    expect(span.style.letterSpacing).toBe('0.075em');

    expect(firstTextStyleAttributes(
      generateJSON(html, extensions())
    )).toEqual({
      fontSizePx: 18,
      fontFamilyId: 'classic-serif',
      textColor: '#285F9E',
      trackingEm: 0.075,
    });

    const unsafe = generateJSON(
      '<p><span data-font-size-px="999"'
      + ' data-font-family-id="serif;position:fixed"'
      + ' data-text-color="red"'
      + ' data-tracking-em="calc(1 + 1)"'
      + ' style="font-size:999px;color:red;position:fixed">'
      + 'Untrusted</span></p>',
      extensions()
    );
    expect(firstTextStyleAttributes(unsafe)).toEqual({
      fontSizePx: 140,
      fontFamilyId: null,
      textColor: null,
      trackingEm: null,
    });
    const sanitizedHtml = generateHTML(unsafe, extensions());
    expect(sanitizedHtml).not.toContain('position: fixed');
    expect(sanitizedHtml).not.toContain('calc(');
    expect(sanitizedHtml).not.toContain('data-text-color');
    expect(sanitizedHtml).toContain('data-font-size-px="140"');
  });

  it('parses valid data attributes without depending on inline CSS', () => {
    const parsed = generateJSON(
      '<p><span data-font-size-px="16"'
      + ' data-font-family-id="system-sans"'
      + ' data-text-color="#abc"'
      + ' data-tracking-em="-0.025">Data only</span></p>',
      extensions()
    );

    expect(firstTextStyleAttributes(parsed)).toEqual({
      fontSizePx: 16,
      fontFamilyId: 'system-sans',
      textColor: '#AABBCC',
      trackingEm: -0.025,
    });
  });
});
