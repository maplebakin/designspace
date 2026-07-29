import React, { type CSSProperties } from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import {
  cleanup,
  render,
  waitFor,
} from '@testing-library/react';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { FlowEditor } from '../src/document/components/FlowEditor';
import {
  buildMultiDocumentSpanLayoutModel,
  getStructuredDocumentTypographyVariables,
  markFirstEligibleDocumentDropCapParagraph,
} from '../src/document/components/StructuredDocumentSpanLayout';
import { createCleanDocumentClone } from '../src/document/services/documentExportService';
import {
  DEFAULT_DOCUMENT_DROP_CAP,
  DEFAULT_DOCUMENT_STYLES,
} from '../src/document/typography/documentTypography';
import {
  getDocumentTypographyCssVariables,
} from '../src/document/typography/documentTypographyCss';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('structured document typography', () => {
  it('copies only bounded document typography variables to detached layout hosts', () => {
    const variables = getStructuredDocumentTypographyVariables({
      '--document-style-body-font-size': '19px',
      '--document-drop-cap-color': '#285F9E',
      '--unrelated-variable': 'discarded',
      backgroundImage: 'url(https://example.invalid/tracker.png)',
    } as CSSProperties);

    expect(variables).toEqual({
      '--document-style-body-font-size': '19px',
      '--document-drop-cap-color': '#285F9E',
    });
  });

  it('marks the first non-empty body paragraph and clears stale markers', () => {
    const parsed = new DOMParser().parseFromString(`
      <div>
        <p
          data-document-style-id="subsection-heading"
          data-document-drop-cap-target="true"
        >Section</p>
        <p data-document-style-id="body">   </p>
        <p data-document-style-id="body">First body paragraph</p>
        <p data-document-style-id="body">Second body paragraph</p>
      </div>
    `, 'text/html');
    const root = parsed.body.firstElementChild!;
    const target = markFirstEligibleDocumentDropCapParagraph(
      [root],
      true
    );

    expect(target?.textContent).toBe('First body paragraph');
    expect(root.querySelectorAll(
      '[data-document-drop-cap-target="true"]'
    )).toHaveLength(1);
    expect(markFirstEligibleDocumentDropCapParagraph([root], false))
      .toBeNull();
    expect(root.querySelector(
      '[data-document-drop-cap-target]'
    )).toBeNull();
  });

  it('uses identical typography variables for measurement and rendered bands without duplicating a split drop cap', async () => {
    let editor: Editor | null = null;
    const styles = {
      ...DEFAULT_DOCUMENT_STYLES,
      body: {
        ...DEFAULT_DOCUMENT_STYLES.body,
        fontSizePx: 19,
        lineHeight: 1.5,
        paragraphSpacingPx: 13,
      },
    };
    const dropCap = {
      ...DEFAULT_DOCUMENT_DROP_CAP,
      enabled: true,
      color: '#285F9E',
      sizeEm: 4,
      lineSpan: 4,
      spacingPx: 9,
    };
    const typographyStyle = getDocumentTypographyCssVariables(
      styles,
      dropCap
    );
    const content: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { documentStyleId: 'subsection-heading' },
          content: [{ type: 'text', text: 'Section heading' }],
        },
        {
          type: 'paragraph',
          attrs: { documentStyleId: 'body' },
          content: [{
            type: 'text',
            text: `Anfang ${'historischer Fließtext '.repeat(420)}`,
          }],
        },
        {
          type: 'documentFlowImage',
          attrs: {
            id: 'structured-photo',
            assetId: 'structured-asset',
            altText: 'Historical photograph',
            widthPx: 280,
            heightPx: 180,
            naturalWidth: 1400,
            naturalHeight: 900,
            wrap: 'span-columns',
            spanCount: 2,
            spanStartColumn: 2,
            wrapPaddingPx: 12,
            verticalSpacingPx: 12,
            verticalAnchor: 'page-position',
            yPx: 220,
            caption: 'Historische Bildunterschrift',
          },
        },
        {
          type: 'paragraph',
          attrs: { documentStyleId: 'body' },
          content: [{ type: 'text', text: 'Closing paragraph.' }],
        },
      ],
    };

    const { container } = render(React.createElement(FlowEditor, {
      content,
      columnCount: 3,
      columnGapPx: 24,
      dropCap,
      language: 'de',
      typographyStyle,
      resolveAssetSource: () => 'data:image/png;base64,AA==',
      onEditorReady: (readyEditor: Editor | null) => {
        editor = readyEditor;
      },
    }));
    await waitFor(() => {
      expect(editor).not.toBeNull();
      expect(container.querySelector(
        '[data-document-span-layout]'
      )).not.toBeNull();
    });

    const layout = container.querySelector<HTMLElement>(
      '[data-document-span-layout]'
    )!;
    expect(layout.lang).toBe('de');
    expect(layout.getAttribute('data-document-drop-cap')).toBe('true');
    expect(layout.style.getPropertyValue(
      '--document-style-body-font-size'
    )).toBe('19px');
    expect(layout.style.getPropertyValue(
      '--document-drop-cap-line-height'
    )).toBe('1.5');
    expect(layout.querySelectorAll(
      '[data-document-drop-cap-target="true"]'
    )).toHaveLength(1);
    expect(layout.querySelector(
      '[data-document-drop-cap-target="true"]'
    )?.textContent).toContain('Anfang');

    const appendedElements: HTMLElement[] = [];
    const originalAppendChild = document.body.appendChild.bind(document.body);
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      if (node instanceof HTMLElement) appendedElements.push(node);
      return originalAppendChild(node);
    });
    const model = buildMultiDocumentSpanLayoutModel(
      editor!,
      3,
      24,
      720,
      720,
      {},
      { typographyStyle, dropCap, language: 'de' }
    );
    const measureHost = appendedElements.find((element) =>
      element.classList.contains('document-span-layout__measure')
    );
    expect(measureHost?.style.getPropertyValue(
      '--document-style-body-font-size'
    )).toBe('19px');
    expect(measureHost?.style.getPropertyValue(
      '--document-drop-cap-line-height'
    )).toBe('1.5');
    expect(measureHost?.getAttribute('data-document-drop-cap')).toBe('true');
    expect(measureHost?.lang).toBe('de');

    const renderedHtml = model!.textBands
      .map((band) => band.html)
      .join('');
    expect(
      renderedHtml.match(/data-document-drop-cap-target="true"/g)
    ).toHaveLength(1);
    expect(renderedHtml).toContain('data-document-style-id="subsection-heading"');
    expect(renderedHtml).toContain('data-document-style-id="body"');
  });

  it('retains structured drop-cap targets for export pseudo-style capture', () => {
    const source = document.createElement('div');
    source.innerHTML = `
      <div class="document-spanning-layout">
        <p
          data-document-style-id="body"
          data-document-drop-cap-target="true"
        >Anfang des Artikels</p>
      </div>
    `;
    document.body.appendChild(source);

    const declaration = document.createElement('div').style;
    declaration.setProperty('font-size', '48px');
    declaration.setProperty('color', 'rgb(40, 95, 158)');
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(
      declaration as CSSStyleDeclaration
    );

    const clone = createCleanDocumentClone(source);
    const target = clone.querySelector<HTMLElement>(
      '[data-document-drop-cap-target="true"]'
    );
    const ruleId = target?.getAttribute('data-document-export-pseudo');
    expect(ruleId).toMatch(/^drop-cap-/);
    expect(clone.querySelector('style')?.textContent).toContain(
      `[data-document-export-pseudo="${ruleId}"]::first-letter`
    );
    expect(clone.querySelector('style')?.textContent).toContain(
      'font-size:48px'
    );
  });
});
