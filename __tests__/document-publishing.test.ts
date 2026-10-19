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
import { createCleanDocumentClone } from '../src/document/services/documentExportService';
import { updateSelectedWritingArea } from '../src/document/services/documentWritingCommands';

afterEach(() => useDocumentStore.getState().reset());

describe('printable publishing', () => {
  it('bounds writing geometry, rejects unsafe colours, and keeps legacy defaults implicit', () => {
    expect(normalizeWritingAttributes({})).toEqual({});
    expect(normalizeWritingAttributes({ documentWritingRows: Infinity })).toEqual({});
    expect(normalizeWritingAttributes({ documentWritingRows: 200, documentWritingSpacing: 2, documentRuleColor: 'url(secret)' })).toEqual({
      documentWritingRows: 30, documentWritingSpacing: 20, documentWritingRuleWidthPt: 0.75, documentRuleColor: '#9A8B94',
    });
    expect(documentAuthoredContentDiffers(
      { type: 'paragraph', attrs: { documentStyleId: 'body', documentStyleFontSizePx: null } },
      { type: 'paragraph', attrs: { documentStyleId: 'body', documentStyleFontSizePx: null, documentWritingRows: null, documentWritingSpacing: null, documentWritingRuleWidthPt: null, documentRuleColor: null, documentDivider: null } },
    )).toBe(false);
  });

  it('renders ruled paragraphs and dividers from the same editable model and roundtrips HTML', () => {
    const editor = new Editor({
      extensions: [StarterKit, DocumentWritingExtension],
      content: { type: 'doc', content: [
        { type: 'paragraph', attrs: { documentWritingRows: 8, documentWritingSpacing: 36, documentWritingRuleWidthPt: 1.5, documentRuleColor: '#000000' } },
        { type: 'paragraph', attrs: { documentDivider: true, documentRuleColor: '#713B59' } },
      ] },
    });
    try {
      const html = editor.getHTML();
      expect(html).toContain('min-height: 288px');
      expect(html).toContain('repeating-linear-gradient');
      expect(html).toContain('transparent 34px');
      expect(html).toContain('#000000 34px,#000000 36px');
      expect(html).toContain('border-top: 1px solid');
      editor.commands.setContent(html);
      expect(editor.getJSON().content?.[0].attrs?.documentWritingRows).toBe('8');
      expect(editor.getJSON().content?.[0].attrs?.documentWritingRuleWidthPt).toBe('1.5');
      expect(editor.getJSON().content?.[1].attrs?.documentDivider).toBe(true);
    } finally { editor.destroy(); }
  });

  it('highlights only the selected ruled paragraph and strips the editor marker from export clones', () => {
    const editor = new Editor({
      extensions: [StarterKit, DocumentWritingExtension],
      content: { type: 'doc', content: [
        { type: 'paragraph', attrs: { documentWritingRows: 4 } },
        { type: 'paragraph', attrs: { documentWritingRows: 6, documentRuleColor: '#000000' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'Prompt' }] },
      ] },
    });
    try {
      editor.commands.setTextSelection(1);
      expect(editor.view.dom.querySelectorAll('.document-writing-area--selected')).toHaveLength(1);
      expect(editor.view.dom.querySelector('[data-document-writing-area-selected="true"]')?.getAttribute('data-document-writing-area')).toBe('true');

      editor.commands.setTextSelection(3);
      const selected = editor.view.dom.querySelectorAll('.document-writing-area--selected');
      expect(selected).toHaveLength(1);
      expect(selected[0]?.getAttribute('data-document-writing-area')).toBe('true');
      const cleanClone = createCleanDocumentClone(editor.view.dom);
      expect(cleanClone.querySelector('.document-writing-area--selected')).toBeNull();
      expect(cleanClone.querySelector('[data-document-writing-area-selected]')).toBeNull();
      expect(cleanClone.querySelectorAll('[data-document-writing-area]')[1]?.style.backgroundImage).toContain('#000000');

      editor.commands.setTextSelection(5);
      expect(editor.view.dom.querySelector('.document-writing-area--selected')).toBeNull();
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

  it('preserves multiple distinct writing blocks through duplicate and save/reopen', () => {
    const store = useDocumentStore.getState();
    store.createBlankProject('Worksheet with multiple areas');
    const worksheet = publishingPageDesign('worksheet');
    store.updatePage({
      ...worksheet,
      bodyContent: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Keep this prompt.' }] },
          { type: 'paragraph', attrs: { documentWritingRows: 12, documentWritingSpacing: 32, documentWritingRuleWidthPt: 0.75, documentRuleColor: '#000000' } },
          { type: 'paragraph', content: [{ type: 'text', text: 'Second prompt stays below the first area.' }] },
          { type: 'paragraph', attrs: { documentWritingRows: 22, documentWritingSpacing: 32, documentWritingRuleWidthPt: 0.75, documentRuleColor: '#9A8B94' } },
        ],
      },
    });
    store.duplicatePage();
    const original = useDocumentStore.getState().project!;
    const reopened = normalizeDesignSpaceProjectPayload(
      JSON.parse(JSON.stringify(original)),
      { editorMode: 'document' }
    );
    expect(reopened.pages[0].bodyContent.content?.map((node) => node.type)).toEqual([
      'paragraph', 'paragraph', 'paragraph', 'paragraph',
    ]);
    expect(reopened.pages[0].bodyContent.content?.[1]?.attrs).toMatchObject({
      documentWritingRows: 12,
      documentRuleColor: '#000000',
    });
    expect(reopened.pages[0].bodyContent.content?.[3]?.attrs).toMatchObject({
      documentWritingRows: 22,
      documentRuleColor: '#9A8B94',
    });
    expect(reopened.pages[1].bodyContent).toEqual(reopened.pages[0].bodyContent);

    store.hydrateProject(reopened);
    const editor = new Editor({
      extensions: [StarterKit, DocumentWritingExtension],
      content: reopened.pages[1].bodyContent,
    });
    try {
      let secondAreaPosition = -1;
      editor.state.doc.forEach((_node, position, index) => {
        if (index === 3) secondAreaPosition = position;
      });
      editor.commands.setTextSelection(secondAreaPosition + 1);
      expect(updateSelectedWritingArea(editor, {
        documentWritingRows: 18,
        documentWritingSpacing: 30,
        documentWritingRuleWidthPt: 1,
        documentRuleColor: '#713B59',
      })).toBe(true);
      expect(editor.getJSON().content?.[1]?.attrs).toMatchObject({
        documentWritingRows: 12,
        documentRuleColor: '#000000',
      });
      expect(editor.getJSON().content?.[3]?.attrs).toMatchObject({
        documentWritingRows: 18,
        documentRuleColor: '#713B59',
      });
      expect(editor.getText()).toContain('Keep this prompt.');
      expect(editor.getText()).toContain('Second prompt stays below the first area.');
    } finally { editor.destroy(); }
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
