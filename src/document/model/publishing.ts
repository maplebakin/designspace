import type { DocumentContentJson, DocumentPage } from '../types/documentProject';
import { DOCUMENT_STYLE_IDS, type DocumentNamedStyleRegistry } from '../typography/documentTypography';

export type PublishingPageDesign = 'cover' | 'guide' | 'worksheet';

const paragraph = (text: string, attrs: Record<string, unknown> = {}): DocumentContentJson => ({
  type: 'paragraph',
  attrs: { documentStyleId: 'body', ...attrs },
  ...(text ? { content: [{ type: 'text', text }] } : {}),
});
const story = (...content: DocumentContentJson[]): DocumentContentJson => ({ type: 'doc', content });

/** Generic starter designs, composed exclusively of ordinary editor content. */
export const publishingPageDesign = (design: PublishingPageDesign): Partial<DocumentPage> => ({
  name: design === 'cover' ? 'Cover' : design === 'guide' ? 'Guide' : 'Worksheet',
  columnCount: 1,
  suppressFolio: design === 'cover',
  dropCap: { enabled: false, fontFamilyId: 'inherit', color: 'inherit', sizeEm: 3.35, lineSpan: 3, spacingPx: 6 },
  titleContent: story(paragraph(design === 'cover' ? 'Your journal title' : design === 'guide' ? 'A moment to reflect' : 'Your reflection', {
    documentStyleId: 'article-title',
    ...(design === 'cover' ? { textAlign: 'center', documentStyleFontSizePx: 52, documentSpaceBeforePx: 140, documentSpaceAfterPx: 20 } : {}),
  })),
  bodyContent: design === 'cover' ? story(
    paragraph('A journal for the things that matter', { textAlign: 'center' }),
    paragraph('', { documentDivider: true, documentRuleColor: '#713B59' }),
    paragraph('Created by you', { textAlign: 'center', documentStyleId: 'author-signature' }),
  ) : design === 'guide' ? story(
    paragraph('Begin here', { documentStyleId: 'subsection-heading' }),
    paragraph('Introduce this reflection in your own words. Keep the guidance short and leave room for the reader to find their own meaning.'),
    paragraph('', { documentDivider: true, documentRuleColor: '#713B59' }),
    paragraph('An example', { documentStyleId: 'subsection-heading' }),
    paragraph('Add an optional example here. The worksheet on the next page offers space to respond.', { documentStyleId: 'quotation' }),
  ) : story(
    paragraph('What would you like to remember?', { documentStyleId: 'subsection-heading' }),
    paragraph('', { documentWritingRows: 12, documentWritingSpacing: 32, documentWritingRuleWidthPt: 0.75, documentRuleColor: '#9A8B94' }),
  ),
});

export const publishingTypography = (
  existing: DocumentNamedStyleRegistry,
  headingFont: 'cinzel' | 'cormorant-garamond',
  bodyFont: 'cinzel' | 'cormorant-garamond',
  accent: string,
): DocumentNamedStyleRegistry => Object.fromEntries(DOCUMENT_STYLE_IDS.map((id) => {
  const heading = id === 'article-title' || id === 'subsection-heading';
  const fontFamilyId = heading ? headingFont : bodyFont;
  return [id, {
    ...existing[id],
    fontFamilyId,
    fontSizePx: id === 'body' ? 18 : id === 'article-title' ? 38 : id === 'subsection-heading' ? 22 : existing[id].fontSizePx,
    color: heading ? accent : '#302B2F',
    alignment: id === 'author-signature' ? 'right' : 'left',
    firstLineIndentPx: 0,
    lineHeight: heading ? 1.2 : 1.5,
    hyphenation: 'none',
    italic: fontFamilyId === 'cinzel' ? false : existing[id].italic,
  }];
})) as DocumentNamedStyleRegistry;
