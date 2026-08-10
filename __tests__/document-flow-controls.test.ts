import { Editor, generateHTML, generateJSON, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentBlockStyleExtension } from '../src/document/extensions/DocumentBlockStyleExtension';
import { DocumentFlowControlExtension } from '../src/document/extensions/DocumentFlowControlExtension';

const editors: Editor[] = [];

const extensions = [
  StarterKit,
  DocumentBlockStyleExtension.configure({ defaultStyleId: 'body' }),
  DocumentFlowControlExtension,
];

afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

describe('document paragraph flow controls', () => {
  it('stores a column break and keep rules on the selected paragraph', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions,
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
        ],
      },
    });
    editors.push(editor);

    editor.commands.setTextSelection(1);
    expect(editor.commands.toggleDocumentColumnBreak()).toBe(true);
    expect(editor.commands.toggleDocumentKeepWithNext()).toBe(true);
    expect(editor.commands.toggleDocumentKeepLinesTogether()).toBe(true);

    const paragraph = editor.getJSON().content?.[0];
    expect(paragraph?.attrs).toMatchObject({
      documentColumnBreakBefore: true,
      documentKeepWithNext: true,
      documentKeepLinesTogether: true,
    });
  });

  it('round-trips flow controls as editor-visible data attributes', () => {
    const content: JSONContent = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: {
          documentColumnBreakBefore: true,
          documentKeepWithNext: true,
          documentKeepLinesTogether: true,
        },
        content: [{ type: 'text', text: 'Next column' }],
      }],
    };
    const html = generateHTML(content, extensions);
    expect(html).toContain('data-document-column-break-before="true"');
    expect(html).toContain('data-document-keep-with-next="true"');
    expect(html).toContain('data-document-keep-lines-together="true"');
    expect(generateJSON(html, extensions).content?.[0]?.attrs).toMatchObject({
      documentColumnBreakBefore: true,
      documentKeepWithNext: true,
      documentKeepLinesTogether: true,
    });
  });
});
