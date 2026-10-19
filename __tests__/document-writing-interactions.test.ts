import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { DocumentWritingExtension } from '../src/document/extensions/DocumentWritingExtension';
import { resolveStructuredDocumentTextAtPoint } from '../src/document/components/StructuredDocumentSpanLayout';
import {
  insertDocumentWritingBlock,
  updateSelectedWritingArea,
} from '../src/document/services/documentWritingCommands';

const editors: Editor[] = [];

const createEditor = (content: Parameters<typeof Editor>[0]['content']) => {
  const editor = new Editor({
    extensions: [StarterKit, DocumentWritingExtension],
    content,
  });
  editors.push(editor);
  return editor;
};

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe('writing-area editing', () => {
  it('resolves a click on an empty structured ruled block to that exact paragraph', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Reflection prompt' }] },
        { type: 'paragraph', attrs: { documentWritingRows: 8, documentRuleColor: '#000000' } },
        { type: 'paragraph', attrs: { documentWritingRows: 22, documentWritingSpacing: 32, documentRuleColor: '#9A8B94' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'Another prompt' }] },
      ],
    });
    let targetPosition = -1;
    editor.state.doc.forEach((node, position, index) => {
      if (index === 2) targetPosition = position + 1;
    });

    const root = document.createElement('div');
    const target = document.createElement('p');
    target.setAttribute('data-document-writing-area', 'true');
    target.setAttribute('data-document-block-from', String(targetPosition));
    target.setAttribute('data-document-block-to', String(targetPosition));
    target.setAttribute('data-document-fragment-from', String(targetPosition));
    target.setAttribute('data-document-fragment-to', String(targetPosition));
    target.setAttribute('data-document-fragment-id', 'worksheet:block-2:fragment-0');
    root.append(target);

    const previousElementFromPoint = Object.getOwnPropertyDescriptor(
      document,
      'elementFromPoint'
    );
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => target,
    });
    try {
      const hit = resolveStructuredDocumentTextAtPoint({
        root,
        editor,
        clientX: 40,
        clientY: 500,
      });
      expect(hit).toEqual({
        position: targetPosition,
        fragmentId: 'worksheet:block-2:fragment-0',
      });
      editor.commands.setTextSelection(hit!.position);
      expect(editor.state.selection.$from.parent.attrs.documentWritingRows).toBe(22);
      expect(editor.state.selection.$from.parent.attrs.documentRuleColor).toBe('#9A8B94');
    } finally {
      if (previousElementFromPoint) {
        Object.defineProperty(document, 'elementFromPoint', previousElementFromPoint);
      } else {
        delete (document as Document & { elementFromPoint?: unknown }).elementFromPoint;
      }
    }
  });

  it('selects the clicked empty writing paragraph among several editor blocks', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Prompt above' }] },
        { type: 'paragraph', attrs: { documentWritingRows: 8, documentRuleColor: '#000000' } },
        { type: 'paragraph', attrs: { documentWritingRows: 22, documentRuleColor: '#9A8B94' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'Prompt below' }] },
      ],
    });
    const areas = editor.view.dom.querySelectorAll<HTMLElement>(
      '[data-document-writing-area]'
    );
    areas[0]?.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    }));
    expect(editor.state.selection.$from.parent.attrs.documentWritingRows).toBe(8);

    areas[1]?.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    }));
    expect(editor.state.selection.$from.parent.attrs.documentWritingRows).toBe(22);
    expect(editor.state.selection.$from.parent.attrs.documentRuleColor).toBe('#9A8B94');
  });

  it('updates only the selected writing paragraph when multiple areas share a page', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Keep this prompt' }] },
        { type: 'paragraph', attrs: { documentWritingRows: 8, documentWritingSpacing: 28, documentRuleColor: '#000000' } },
        { type: 'paragraph', attrs: { documentWritingRows: 22, documentWritingSpacing: 32, documentRuleColor: '#9A8B94' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'Keep this second prompt' }] },
      ],
    });
    let secondAreaPosition = -1;
    editor.state.doc.forEach((_node, position, index) => {
      if (index === 2) secondAreaPosition = position;
    });
    editor.commands.setTextSelection(secondAreaPosition + 1);

    expect(updateSelectedWritingArea(editor, {
      documentWritingRows: 16,
      documentWritingSpacing: 30,
      documentWritingRuleWidthPt: 1.25,
      documentRuleColor: '#713B59',
    })).toBe(true);

    const content = editor.getJSON().content || [];
    expect(content[0]?.content?.[0]?.text).toBe('Keep this prompt');
    expect(content[1]?.attrs).toMatchObject({
      documentWritingRows: 8,
      documentWritingSpacing: 28,
      documentRuleColor: '#000000',
    });
    expect(content[2]?.attrs).toMatchObject({
      documentWritingRows: 16,
      documentWritingSpacing: 30,
      documentWritingRuleWidthPt: 1.25,
      documentRuleColor: '#713B59',
    });
    expect(content[3]?.content?.[0]?.text).toBe('Keep this second prompt');
  });

  it('inserts a writing area after the selected block without replacing selected prompt text', () => {
    const prompt = 'Keep every word in this reflection prompt.';
    const editor = createEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: prompt }] }],
    });
    editor.commands.setTextSelection({ from: 6, to: 18 });

    expect(insertDocumentWritingBlock(editor, {
      documentWritingRows: 12,
      documentWritingSpacing: 32,
      documentWritingRuleWidthPt: 0.75,
      documentRuleColor: '#9A8B94',
    })).toBe(true);

    const content = editor.getJSON().content || [];
    expect(content[0]?.content?.[0]?.text).toBe(prompt);
    expect(content[1]?.attrs).toMatchObject({
      documentWritingRows: 12,
      documentWritingSpacing: 32,
      documentRuleColor: '#9A8B94',
    });
    expect(content.some((node) => node.content?.some((child) => child.text === prompt))).toBe(true);
  });
});
