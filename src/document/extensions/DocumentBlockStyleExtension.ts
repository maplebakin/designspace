import { Extension, type Command } from '@tiptap/core';
import {
  type DocumentStyleId,
  normalizeDocumentBlockFontSizePx,
  normalizeDocumentStyleId,
} from '../typography/documentTypography';

export const DOCUMENT_BLOCK_STYLE_IDS = [
  'body',
  'subsection-heading',
  'quotation',
  'author-signature',
  'article-title',
] as const;

export type DocumentBlockStyleId = Exclude<DocumentStyleId, 'caption'>;

export type DocumentBlockStyleOptions = {
  defaultStyleId: DocumentBlockStyleId;
};

const DOCUMENT_BLOCK_STYLE_ID_SET = new Set<string>(
  DOCUMENT_BLOCK_STYLE_IDS
);

export const normalizeDocumentBlockStyleId = (
  value: unknown,
  fallback: DocumentBlockStyleId = 'body'
): DocumentBlockStyleId => {
  const normalized = normalizeDocumentStyleId(value, fallback);
  return normalized === 'caption' ? fallback : normalized;
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    documentBlockStyle: {
      setDocumentBlockStyle: (styleId: DocumentBlockStyleId) => ReturnType;
      setDocumentBodyStyle: () => ReturnType;
      setDocumentSubsectionHeadingStyle: () => ReturnType;
      setDocumentQuotationStyle: () => ReturnType;
      setDocumentAuthorSignatureStyle: () => ReturnType;
      setDocumentArticleTitleStyle: () => ReturnType;
    };
  }
}

/**
 * Adds a bounded semantic role to paragraphs without accepting persisted CSS.
 *
 * Caption presentation remains structurally attached to image nodes, so the
 * paragraph roles intentionally exclude the named caption style.
 */
export const DocumentBlockStyleExtension =
Extension.create<DocumentBlockStyleOptions>({
  name: 'documentBlockStyle',

  addOptions() {
    return {
      defaultStyleId: 'body',
    };
  },

  addGlobalAttributes() {
    const defaultStyleId = normalizeDocumentBlockStyleId(
      this.options.defaultStyleId
    );
    return [{
      types: ['paragraph'],
      attributes: {
        documentStyleId: {
          default: defaultStyleId,
          parseHTML: (element) => normalizeDocumentBlockStyleId(
            element.getAttribute('data-document-style-id'),
            defaultStyleId
          ),
          renderHTML: (attributes) => ({
            'data-document-style-id': normalizeDocumentBlockStyleId(
              attributes.documentStyleId,
              defaultStyleId
            ),
          }),
        },
        documentStyleFontSizePx: {
          default: null,
          parseHTML: (element) => normalizeDocumentBlockFontSizePx(
            element.getAttribute('data-document-style-font-size-px')
          ),
          renderHTML: (attributes) => {
            const fontSizePx = normalizeDocumentBlockFontSizePx(
              attributes.documentStyleFontSizePx
            );
            return fontSizePx === null
              ? {}
              : {
                  'data-document-style-font-size-px': String(fontSizePx),
                  style: `font-size: ${fontSizePx}px`,
                };
          },
        },
      },
    }];
  },

  addCommands() {
    const applyStyle = (styleId: DocumentBlockStyleId): Command =>
      ({ commands }) => {
        if (!DOCUMENT_BLOCK_STYLE_ID_SET.has(styleId)) return false;
        return commands.updateAttributes('paragraph', {
          documentStyleId: styleId,
        });
      };

    return {
      setDocumentBlockStyle: (styleId) => applyStyle(styleId),
      setDocumentBodyStyle: () => applyStyle('body'),
      setDocumentSubsectionHeadingStyle: () =>
        applyStyle('subsection-heading'),
      setDocumentQuotationStyle: () => applyStyle('quotation'),
      setDocumentAuthorSignatureStyle: () =>
        applyStyle('author-signature'),
      setDocumentArticleTitleStyle: () => applyStyle('article-title'),
    };
  },
});
