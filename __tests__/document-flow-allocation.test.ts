import React from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import {
  cleanup,
  render,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FlowEditor } from '../src/document/components/FlowEditor';
import {
  allocateElementsToHeight,
  buildMultiDocumentSpanLayoutModel,
} from '../src/document/components/StructuredDocumentSpanLayout';

afterEach(() => cleanup());

const element = (attrs: Record<string, string>, height: number) => {
  const node = document.createElement('p');
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  node.setAttribute('data-test-height', String(height));
  node.textContent = 'text';
  return node;
};

const measure = (elements: Element[]) => elements.reduce(
  (total, current) => total + Number(current.getAttribute('data-test-height') || 0),
  0
);

describe('structured paragraph allocation controls', () => {
  it('starts a marked paragraph in the next physical region', () => {
    const first = element({}, 10);
    const second = element({
      'data-document-column-break-before': 'true',
    }, 10);
    const allocation = allocateElementsToHeight(
      [first, second],
      200,
      100,
      measure
    );

    expect(allocation.allocated).toEqual([first]);
    expect(allocation.remaining).toEqual([second]);
    expect(allocation.breakBefore).toBe(true);
  });

  it('keeps headings and marked blocks with the next paragraph', () => {
    const heading = element({
      'data-document-style-id': 'subsection-heading',
    }, 10);
    const body = element({}, 10);
    const allocation = allocateElementsToHeight(
      [heading, body],
      200,
      15,
      measure
    );
    expect(allocation.allocated).toEqual([]);
    expect(allocation.remaining).toEqual([heading, body]);

    const together = element({
      'data-document-keep-lines-together': 'true',
    }, 20);
    const togetherAllocation = allocateElementsToHeight(
      [together],
      200,
      10,
      measure
    );
    expect(togetherAllocation.allocated).toEqual([]);
    expect(togetherAllocation.remaining).toEqual([together]);
  });

  it('uses an explicit break to skip the rest of the current physical column', async () => {
    let editor: Editor | null = null;
    const content: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { documentStyleId: 'body' },
          content: [{ type: 'text', text: 'First physical column paragraph.' }],
        },
        {
          type: 'paragraph',
          attrs: {
            documentStyleId: 'body',
            documentColumnBreakBefore: true,
          },
          content: [{ type: 'text', text: 'Intentional next column paragraph.' }],
        },
        {
          type: 'documentFlowImage',
          attrs: {
            id: 'flow-break-test-image',
            assetId: 'flow-break-test-asset',
            altText: 'Flow break test image',
            widthPx: 120,
            heightPx: 80,
            naturalWidth: 120,
            naturalHeight: 80,
            wrap: 'span-columns',
            spanCount: 1,
            spanStartColumn: 2,
            verticalAnchor: 'page-position',
            horizontalPlacement: 'left',
            xOffsetPx: 0,
            yPx: 120,
          },
        },
      ],
    };
    render(React.createElement(FlowEditor, {
      content,
      columnCount: 2,
      columnGapPx: 24,
      dropCap: false,
      maxSpanImageWidthPx: 480,
      resolveAssetSource: () => 'data:image/png;base64,AA==',
      onEditorReady: (readyEditor) => {
        editor = readyEditor;
      },
    }));
    await waitFor(() => expect(editor).not.toBeNull());

    const model = buildMultiDocumentSpanLayoutModel(
      editor!,
      2,
      24,
      480,
      240
    );
    expect(model).not.toBeNull();
    const firstColumnHtml = model!.textBands
      .filter((band) => band.column === 1)
      .map((band) => band.html)
      .join('');
    const secondColumnHtml = model!.textBands
      .filter((band) => band.column === 2)
      .map((band) => band.html)
      .join('');
    expect(firstColumnHtml).toContain('First physical column paragraph.');
    expect(firstColumnHtml).not.toContain('Intentional next column paragraph.');
    expect(secondColumnHtml).toContain('Intentional next column paragraph.');
  });

  it('consumes a column break once when later regions are available', async () => {
    let editor: Editor | null = null;
    const content: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { documentStyleId: 'body' },
          content: [{ type: 'text', text: 'Opening column copy.' }],
        },
        {
          type: 'paragraph',
          attrs: {
            documentStyleId: 'body',
            documentColumnBreakBefore: true,
          },
          content: [{ type: 'text', text: 'Forced second column copy.' }],
        },
        {
          type: 'paragraph',
          attrs: { documentStyleId: 'body' },
          content: [{ type: 'text', text: 'Following second column copy.' }],
        },
        {
          type: 'documentFlowImage',
          attrs: {
            id: 'flow-break-consume-image',
            assetId: 'flow-break-consume-asset',
            altText: 'Flow break consume test image',
            widthPx: 120,
            heightPx: 60,
            naturalWidth: 120,
            naturalHeight: 60,
            wrap: 'span-columns',
            spanCount: 1,
            spanStartColumn: 3,
            verticalAnchor: 'page-position',
            horizontalPlacement: 'left',
            xOffsetPx: 0,
            yPx: 180,
          },
        },
      ],
    };
    render(React.createElement(FlowEditor, {
      content,
      columnCount: 3,
      columnGapPx: 24,
      dropCap: false,
      maxSpanImageWidthPx: 720,
      resolveAssetSource: () => 'data:image/png;base64,AA==',
      onEditorReady: (readyEditor) => {
        editor = readyEditor;
      },
    }));
    await waitFor(() => expect(editor).not.toBeNull());

    const model = buildMultiDocumentSpanLayoutModel(
      editor!,
      3,
      24,
      720,
      300
    );
    expect(model).not.toBeNull();
    const firstColumnHtml = model!.textBands
      .filter((band) => band.column === 1)
      .map((band) => band.html)
      .join('');
    const secondColumnHtml = model!.textBands
      .filter((band) => band.column === 2)
      .map((band) => band.html)
      .join('');
    expect(firstColumnHtml).toContain('Opening column copy.');
    expect(firstColumnHtml).not.toContain('Forced second column copy.');
    expect(secondColumnHtml).toContain('Forced second column copy.');
    expect(secondColumnHtml).toContain('Following second column copy.');
  });
});
