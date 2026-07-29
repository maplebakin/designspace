import React, { createRef } from 'react';
import {
  act,
  cleanup,
  render,
  waitFor,
} from '@testing-library/react';
import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  DocumentPageView,
} from '../src/document/components/DocumentPageView';
import {
  mountCommittedDocumentExportPages,
  type MountedDocumentExportPages,
} from '../src/document/components/DocumentProjectExportRenderer';
import {
  createCleanDocumentClone,
  prepareDocumentExportClone,
} from '../src/document/services/documentExportService';
import {
  createBlankDocumentPage,
  createBlankDocumentProject,
} from '../src/document/state/documentStore';
import type {
  DocumentContentJson,
  DocumentPage,
} from '../src/document/types/documentProject';
import {
  DEFAULT_DOCUMENT_DROP_CAP,
  DEFAULT_DOCUMENT_STYLES,
  type DocumentNamedStyleRegistry,
} from '../src/document/typography/documentTypography';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

const TYPOGRAPHY_STYLES: DocumentNamedStyleRegistry = {
  ...DEFAULT_DOCUMENT_STYLES,
  'article-title': {
    ...DEFAULT_DOCUMENT_STYLES['article-title'],
    color: '#165B9A',
    fontSizePx: 52,
    lineHeight: 1.12,
    trackingEm: 0.04,
  },
  body: {
    ...DEFAULT_DOCUMENT_STYLES.body,
    fontSizePx: 17,
    lineHeight: 1.5,
    paragraphSpacingPx: 12,
    firstLineIndentPx: 18,
    alignment: 'justify',
    hyphenation: 'auto',
  },
  'subsection-heading': {
    ...DEFAULT_DOCUMENT_STYLES['subsection-heading'],
    fontWeight: 600,
    color: '#243B53',
  },
  quotation: {
    ...DEFAULT_DOCUMENT_STYLES.quotation,
    italic: true,
  },
  'author-signature': {
    ...DEFAULT_DOCUMENT_STYLES['author-signature'],
    alignment: 'right',
  },
};

const DROP_CAP = {
  ...DEFAULT_DOCUMENT_DROP_CAP,
  enabled: true,
  color: '#165B9A',
  sizeEm: 4.25,
  lineSpan: 4,
  spacingPx: 9,
};

const styledTitleContent = (title: string): DocumentContentJson => ({
  type: 'doc',
  content: [{
    type: 'paragraph',
    attrs: { documentStyleId: 'article-title' },
    content: [{ type: 'text', text: title }],
  }],
});

const styledBodyContent = (prefix: string): DocumentContentJson => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { documentStyleId: 'subsection-heading' },
      content: [{ type: 'text', text: `${prefix} heading` }],
    },
    {
      type: 'paragraph',
      attrs: { documentStyleId: 'body' },
      content: [{ type: 'text', text: `${prefix} body paragraph` }],
    },
    {
      type: 'paragraph',
      attrs: { documentStyleId: 'quotation' },
      content: [{ type: 'text', text: `${prefix} scripture quotation` }],
    },
    {
      type: 'paragraph',
      attrs: { documentStyleId: 'author-signature' },
      content: [{ type: 'text', text: `${prefix} author credit` }],
    },
  ],
});

const createTypographyPage = (
  id: string,
  language?: string
): DocumentPage => ({
  ...createBlankDocumentPage(id),
  id,
  name: id,
  language,
  titleContent: styledTitleContent(`${id} title`),
  bodyContent: styledBodyContent(id),
  columnCount: 3,
  dropCap: { ...DROP_CAP },
});

describe('document typography page and export rendering', () => {
  it('keeps the validated named-style, language, and drop-cap contract on the live page and clean clone', () => {
    const page = createTypographyPage('page-49', 'de-AT');
    const exportRootRef = createRef<HTMLDivElement>();
    const { getByTestId } = render(React.createElement(
      DocumentPageView,
      {
        page,
        assetSources: {},
        paperColor: '#FAF8F5',
        folioNumber: 49,
        showFolio: true,
        documentLanguage: 'de-DE',
        typographyStyles: TYPOGRAPHY_STYLES,
        zoom: 0.8,
        exportRootRef,
        referenceAdjustMode: false,
        selectedOverlayId: null,
        isOverflowing: false,
        onReferenceChange: () => undefined,
        onSelectOverlay: () => undefined,
        onUpdateOverlay: () => undefined,
        titleEditor: React.createElement(
          'p',
          { 'data-document-style-id': 'article-title' },
          'Page title'
        ),
        bodyEditor: React.createElement(
          'div',
          {},
          React.createElement(
            'p',
            { 'data-document-style-id': 'body' },
            'Anfang des Artikels'
          ),
          React.createElement(
            'p',
            { 'data-document-style-id': 'quotation' },
            'Schriftwort'
          )
        ),
      }
    ));

    const pageSheet = getByTestId('document-page');
    const exportRoot = getByTestId('document-export-root');
    const bodyRegion = getByTestId('document-body-region');

    expect(pageSheet.getAttribute('lang')).toBe('de-AT');
    expect(exportRoot.getAttribute('lang')).toBe('de-AT');
    expect(exportRoot.getAttribute('data-document-language')).toBe('de-AT');
    expect(exportRoot.style.getPropertyValue(
      '--document-style-article-title-color'
    )).toBe('#165B9A');
    expect(exportRoot.style.getPropertyValue(
      '--document-style-body-font-size'
    )).toBe('17px');
    expect(exportRoot.style.getPropertyValue(
      '--document-style-subsection-heading-font-weight'
    )).toBe('600');
    expect(exportRoot.style.getPropertyValue(
      '--document-style-quotation-font-style'
    )).toBe('italic');
    expect(exportRoot.style.getPropertyValue(
      '--document-drop-cap-color'
    )).toBe('#165B9A');
    expect(exportRoot.style.getPropertyValue(
      '--document-drop-cap-size'
    )).toBe('4.25em');
    expect(exportRoot.style.getPropertyValue(
      '--document-drop-cap-spacing'
    )).toBe('9px');
    expect(bodyRegion.getAttribute('data-document-drop-cap')).toBe('true');
    expect(bodyRegion.getAttribute('data-drop-cap-line-span')).toBe('4');

    const clone = createCleanDocumentClone(exportRootRef.current!, {
      copyComputedStyles: false,
    });
    expect(clone.getAttribute('lang')).toBe('de-AT');
    expect(clone.style.getPropertyValue(
      '--document-style-body-font-size'
    )).toBe('17px');
    expect(clone.style.getPropertyValue(
      '--document-drop-cap-color'
    )).toBe('#165B9A');
    expect(clone.querySelector(
      '[data-document-drop-cap="true"]'
    )).not.toBeNull();
    expect(clone.querySelector(
      '[data-document-style-id="quotation"]'
    )?.textContent).toBe('Schriftwort');
  });

  it('reconstructs committed pages offscreen and retains typography metadata through the export-clone pipeline', async () => {
    const project = createBlankDocumentProject('Committed typography');
    const committedStyles = structuredClone(TYPOGRAPHY_STYLES);
    const inheritedLanguagePage = createTypographyPage('page-49');
    const overrideLanguagePage = {
      ...createTypographyPage('page-50', 'de-CH'),
      dropCap: {
        ...DEFAULT_DOCUMENT_DROP_CAP,
        enabled: false,
      },
    };
    project.document = {
      ...project.document,
      language: 'de-DE',
      styles: committedStyles,
      folios: {
        startingNumber: 49,
        visible: true,
        placement: 'outside-bottom',
      },
    };
    project.pages = [inheritedLanguagePage, overrideLanguagePage];

    let mounted: MountedDocumentExportPages | undefined;
    try {
      let mountPromise!: ReturnType<
        typeof mountCommittedDocumentExportPages
      >;
      act(() => {
        mountPromise = mountCommittedDocumentExportPages(project);
      });

      // Export owns the committed snapshot created at invocation time.
      project.document.language = 'fr';
      project.document.styles.body.fontSizePx = 99;
      project.pages[0].dropCap.color = '#FF0000';

      mounted = await mountPromise;
      const [firstRoot, secondRoot] = mounted.sources.map(
        (source) => source.element
      );

      await waitFor(() => {
        expect(firstRoot.querySelector(
          '.document-flow-prosemirror'
        )).not.toBeNull();
        expect(secondRoot.querySelector(
          '.document-flow-prosemirror'
        )).not.toBeNull();
      });

      expect(mounted.project.document.language).toBe('de-DE');
      expect(firstRoot.getAttribute('lang')).toBe('de-DE');
      expect(secondRoot.getAttribute('lang')).toBe('de-CH');
      expect(firstRoot.style.getPropertyValue(
        '--document-style-body-font-size'
      )).toBe('17px');
      expect(firstRoot.style.getPropertyValue(
        '--document-drop-cap-color'
      )).toBe('#165B9A');
      expect(firstRoot.querySelector(
        '.document-body-region'
      )?.getAttribute('data-document-drop-cap')).toBe('true');
      expect(secondRoot.querySelector(
        '.document-body-region'
      )?.getAttribute('data-document-drop-cap')).toBe('false');
      expect(firstRoot.querySelector(
        '[data-document-style-id="subsection-heading"]'
      )?.textContent).toBe('page-49 heading');
      expect(firstRoot.querySelector(
        '[data-document-style-id="quotation"]'
      )?.textContent).toBe('page-49 scripture quotation');
      expect(firstRoot.querySelector(
        '[data-document-style-id="author-signature"]'
      )?.textContent).toBe('page-49 author credit');

      const exportClone = await prepareDocumentExportClone(
        firstRoot,
        {
          widthIn: inheritedLanguagePage.size.widthIn,
          heightIn: inheritedLanguagePage.size.heightIn,
        },
        {
          copyComputedStyles: false,
          resourceWaitOptions: { fontsReady: null },
        }
      );

      expect(exportClone.getAttribute('lang')).toBe('de-DE');
      expect(exportClone.getAttribute('data-document-language')).toBe(
        'de-DE'
      );
      expect(exportClone.style.getPropertyValue(
        '--document-style-article-title-color'
      )).toBe('#165B9A');
      expect(exportClone.style.getPropertyValue(
        '--document-style-body-font-size'
      )).toBe('17px');
      expect(exportClone.style.getPropertyValue(
        '--document-drop-cap-size'
      )).toBe('4.25em');
      expect(exportClone.querySelector(
        '[data-document-drop-cap="true"]'
      )).not.toBeNull();
      expect(exportClone.querySelector(
        '[data-document-style-id="quotation"]'
      )?.textContent).toBe('page-49 scripture quotation');
      expect(exportClone.style.width).toBe('816px');
      expect(exportClone.style.height).toBe('1056px');
    } finally {
      if (mounted) {
        act(() => {
          mounted?.cleanup();
        });
      }
    }
  });
});
