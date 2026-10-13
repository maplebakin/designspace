import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { DocumentWritingExtension } from '../src/document/extensions/DocumentWritingExtension';
import { normalizeWritingAttributes } from '../src/document/model/documentWriting';
import { publishingPageDesign, publishingTypography } from '../src/document/model/publishing';
import { createDocumentLayout } from '../src/document/services/documentLayoutService';
import { createBlankDocumentProject, useDocumentStore } from '../src/document/state/documentStore';
import { normalizeDesignSpaceProjectPayload } from '../src/editor/project/projectSchema';
import { DEFAULT_DOCUMENT_STYLES } from '../src/document/typography/documentTypography';
import { publishingFontFile, publishingFontFromCss } from '../src/document/typography/publishingFonts';
import { assertPublishingText, publishingPdfColor } from '../src/document/services/publishingPdfService';
import { documentAuthoredContentDiffers } from '../src/document/services/documentContentObservation';

afterEach(() => useDocumentStore.getState().reset());

describe('printable publishing', () => {
  it('bounds writing geometry, rejects unsafe colours, and keeps legacy defaults implicit', () => {
    expect(normalizeWritingAttributes({})).toEqual({});
    expect(normalizeWritingAttributes({ documentWritingRows: Infinity })).toEqual({});
    expect(normalizeWritingAttributes({ documentWritingRows: 200, documentWritingSpacing: 2, documentRuleColor: 'url(secret)' })).toEqual({
      documentWritingRows: 30, documentWritingSpacing: 20, documentRuleColor: '#9A8B94',
    });
    expect(documentAuthoredContentDiffers(
      { type: 'paragraph', attrs: { documentStyleId: 'body', documentStyleFontSizePx: null } },
      { type: 'paragraph', attrs: { documentStyleId: 'body', documentStyleFontSizePx: null, documentWritingRows: null, documentWritingSpacing: null, documentRuleColor: null, documentDivider: null } },
    )).toBe(false);
  });

  it('renders ruled paragraphs and dividers from the same editable model and roundtrips HTML', () => {
    const editor = new Editor({
      extensions: [StarterKit, DocumentWritingExtension],
      content: { type: 'doc', content: [
        { type: 'paragraph', attrs: { documentWritingRows: 8, documentWritingSpacing: 36, documentRuleColor: '#713B59' } },
        { type: 'paragraph', attrs: { documentDivider: true, documentRuleColor: '#713B59' } },
      ] },
    });
    try {
      const html = editor.getHTML();
      expect(html).toContain('min-height: 288px');
      expect(html).toContain('repeating-linear-gradient');
      expect(html).toContain('border-top: 1px solid');
      editor.commands.setContent(html);
      expect(editor.getJSON().content?.[0].attrs?.documentWritingRows).toBe('8');
      expect(editor.getJSON().content?.[1].attrs?.documentDivider).toBe(true);
    } finally { editor.destroy(); }
  });

  it('preserves publishing fonts, writing areas, and independent copies through portable reopen', () => {
    const store = useDocumentStore.getState();
    store.createBlankProject('Pilot');
    store.updatePage(publishingPageDesign('worksheet'));
    const styles = publishingTypography(DEFAULT_DOCUMENT_STYLES, 'cinzel', 'cormorant-garamond', '#713B59');
    for (const [id, style] of Object.entries(styles)) store.updateDocumentStyle(id as keyof typeof styles, style);
    store.duplicatePage();
    const before = useDocumentStore.getState().project!;
    expect(before.pages[0].id).not.toBe(before.pages[1].id);
    const reopened = normalizeDesignSpaceProjectPayload(JSON.parse(JSON.stringify(before)), { editorMode: 'document' });
    expect(reopened.document.styles?.body.fontFamilyId).toBe('cormorant-garamond');
    expect(reopened.pages[1].bodyContent).toEqual(before.pages[1].bodyContent);
    store.hydrateProject(reopened);
    store.updatePage({ name: 'Independent copy' });
    expect(useDocumentStore.getState().project?.pages[0].name).toBe('Worksheet');
  });

  it('reuses layouts across documents without losing artwork or colliding with destination IDs', () => {
    const source = createBlankDocumentProject('Layout source');
    source.pages[0] = { ...source.pages[0], ...publishingPageDesign('worksheet'), overlayObjects: [{ id: 'image', assetId: 'asset', altText: 'Decoration', xPx: 80, yPx: 100, widthPx: 40, heightPx: 40, placement: 'front' }] };
    source.assets = { asset: 'data:image/png;base64,SOURCE', orphan: 'data:image/png;base64,ORPHAN' };
    const record = createDocumentLayout(source, 0, 'My worksheet');
    expect(record.payload.assets).toEqual({ asset: 'data:image/png;base64,SOURCE' });
    const destination = createBlankDocumentProject('Destination');
    destination.assets = { asset: 'data:image/png;base64,DESTINATION' };
    const store = useDocumentStore.getState();
    store.hydrateProject(destination);
    store.insertPageLayout(record.payload);
    store.insertPageLayout(record.payload);
    const result = useDocumentStore.getState().project!;
    expect(result.assets?.asset).toBe('data:image/png;base64,DESTINATION');
    expect(result.pages[1].overlayObjects[0].id).not.toBe(result.pages[2].overlayObjects[0].id);
    expect(result.assets?.[result.pages[1].overlayObjects[0].assetId]).toBe('data:image/png;base64,SOURCE');
    expect(result.pages[1].bodyContent).toEqual(record.payload.pages[0].bodyContent);
    expect(result.document.styles).toEqual(destination.document.styles);
  });

  it('selects exact bundled faces and converts colours to neutral grayscale', () => {
    expect(publishingFontFromCss('"Cormorant Garamond", serif')).toBe('cormorant-garamond');
    expect(publishingFontFile('cormorant-garamond', 700, true)).toContain('CormorantGaramond-Italic-700.ttf');
    expect(() => publishingFontFile('cinzel', 400, true)).toThrow('no italic face');
    const color = publishingPdfColor(113, 59, 89, true);
    expect(color.red).toBe(color.green);
    expect(color.green).toBe(color.blue);
    expect(() => assertPublishingText('Café')).not.toThrow();
    expect(() => assertPublishingText('Cafe\u0301')).toThrow('combining characters');
  });
});
