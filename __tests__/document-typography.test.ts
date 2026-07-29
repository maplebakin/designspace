import { beforeEach, describe, expect, it } from 'vitest';
import {
  CURRENT_DOCUMENT_SCHEMA_VERSION,
  DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
  normalizeDesignSpaceProjectPayload,
} from '../src/editor/project/projectSchema';
import {
  createBlankDocumentProject,
  useDocumentStore,
} from '../src/document/state/documentStore';
import type {
  DocumentContentJson,
  DocumentPage,
} from '../src/document/types/documentProject';
import {
  DEFAULT_DOCUMENT_DROP_CAP,
  DOCUMENT_STYLE_IDS,
  getDocumentDropCapCss,
  getDocumentStyleCss,
  normalizeDocumentDropCap,
  normalizeDocumentLanguage,
  normalizeDocumentStyleDefinition,
  normalizeDocumentStyleRegistry,
} from '../src/document/typography/documentTypography';

describe('document typography model', () => {
  beforeEach(() => {
    useDocumentStore.getState().reset();
  });

  it('keeps named-style and drop-cap values inside a CSS-safe contract', () => {
    const defaults = normalizeDocumentStyleRegistry(undefined);
    const body = normalizeDocumentStyleDefinition({
      fontFamilyId: 'url(https://example.invalid/font)',
      fontSizePx: 9000,
      color: 'red; position: fixed',
      lineHeight: -4,
      paragraphSpacingPx: 999,
      firstLineIndentPx: -20,
      alignment: 'start',
      fontWeight: 999,
      italic: 'yes',
      trackingEm: 4,
      hyphenation: 'dictionary-script',
    }, defaults.body);

    expect(body).toEqual({
      ...defaults.body,
      fontSizePx: 240,
      lineHeight: 0.75,
      paragraphSpacingPx: 192,
      firstLineIndentPx: 0,
      trackingEm: 0.5,
    });
    expect(getDocumentStyleCss(body)).toMatchObject({
      fontFamily: expect.stringContaining('Georgia'),
      color: defaults.body.color,
      fontSize: '240px',
      letterSpacing: '0.5em',
      hyphens: defaults.body.hyphenation,
    });

    const dropCap = normalizeDocumentDropCap({
      enabled: true,
      fontFamilyId: 'url(bad)',
      color: 'expression(alert(1))',
      sizeEm: 99,
      lineSpan: 0,
      spacingPx: 400,
    });
    expect(dropCap).toEqual({
      enabled: true,
      fontFamilyId: 'historical-serif',
      color: 'inherit',
      sizeEm: 12,
      lineSpan: 1,
      spacingPx: 96,
    });
    expect(JSON.stringify(getDocumentDropCapCss(dropCap))).not.toContain(
      'expression'
    );
    expect(normalizeDocumentLanguage('de-de')).toBe('de-DE');
    expect(normalizeDocumentLanguage('de" onmouseover="x', 'de')).toBe('de');
  });

  it('migrates schema v1 typography, semantic block roles, captions, and drop caps', () => {
    const titleContent: DocumentContentJson = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: { textAlign: 'center', customMetadata: 'retained' },
        content: [{
          type: 'text',
          text: 'Legacy title',
          marks: [{ type: 'bold' }],
        }],
      }],
    };
    const bodyContent: DocumentContentJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { customMetadata: 'retained' },
          content: [{ type: 'text', text: 'Body' }],
        },
        {
          type: 'heading',
          attrs: { level: 2, documentStyleId: 'unsafe-style' },
          content: [{ type: 'text', text: 'Heading' }],
        },
        {
          type: 'blockquote',
          content: [{
            type: 'paragraph',
            content: [{
              type: 'text',
              text: 'Scripture',
              marks: [{ type: 'italic' }],
            }],
          }],
        },
        {
          type: 'documentFlowImage',
          attrs: {
            id: 'image-1',
            assetId: 'asset-1',
            caption: 'Caption retained',
          },
        },
      ],
    };

    const normalized = normalizeDesignSpaceProjectPayload<DocumentPage>({
      schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      editorMode: 'document',
      projectId: 'typography-v1',
      projectName: 'Legacy typography',
      document: {
        schemaVersion: 1,
        language: 'de-de',
        styles: {
          body: {
            fontFamilyId: 'javascript:alert(1)',
            trackingEm: 10,
          },
        },
      },
      pages: [{
        kind: 'document',
        id: 'page-49',
        name: 'Page 49',
        size: {
          presetId: 'letter',
          orientation: 'portrait',
          widthIn: 8.5,
          heightIn: 11,
          dpi: 300,
        },
        margins: {
          topIn: 0.5,
          bottomIn: 0.5,
          innerIn: 0.5,
          outerIn: 0.5,
        },
        titleContent,
        bodyContent,
        titleFontSizePx: 57,
        columnCount: 3,
        columnGapPx: 24,
        dropCap: true,
        overlayObjects: [{
          id: 'overlay-1',
          assetId: 'asset-1',
          altText: '',
          xPx: 0,
          yPx: 0,
          widthPx: 100,
          heightPx: 100,
          placement: 'front',
          caption: 'Overlay caption retained',
        }],
      }],
    }) as ReturnType<typeof createBlankDocumentProject>;

    expect(normalized.document.schemaVersion).toBe(
      CURRENT_DOCUMENT_SCHEMA_VERSION
    );
    expect(normalized.document.language).toBe('de-DE');
    expect(Object.keys(normalized.document.styles)).toEqual(DOCUMENT_STYLE_IDS);
    expect(normalized.document.styles['article-title'].fontSizePx).toBe(57);
    expect(normalized.document.styles.body).toMatchObject({
      fontFamilyId: 'historical-serif',
      trackingEm: 0.5,
    });
    expect(normalized.pages[0].language).toBeUndefined();
    expect(normalized.pages[0].dropCap).toEqual({
      ...DEFAULT_DOCUMENT_DROP_CAP,
      enabled: true,
    });
    expect(normalized.pages[0].titleContent.content?.[0]).toMatchObject({
      attrs: {
        textAlign: 'center',
        customMetadata: 'retained',
        documentStyleId: 'article-title',
      },
      content: [{
        text: 'Legacy title',
        marks: [{ type: 'bold' }],
      }],
    });
    expect(normalized.pages[0].bodyContent.content?.map(
      (node) => node.attrs?.documentStyleId
    )).toEqual([
      'body',
      'subsection-heading',
      'quotation',
      undefined,
    ]);
    expect(
      normalized.pages[0].bodyContent.content?.[2].content?.[0]
        .attrs?.documentStyleId
    ).toBe('quotation');
    expect(
      normalized.pages[0].bodyContent.content?.[2].content?.[0]
        .content?.[0].marks
    ).toEqual([{ type: 'italic' }]);
    expect(normalized.pages[0].bodyContent.content?.[3].attrs).toMatchObject({
      caption: 'Caption retained',
      captionAlignment: 'left',
      captionItalic: true,
      captionSpacingPx: 5,
    });
    expect(normalized.pages[0].overlayObjects[0]).toMatchObject({
      caption: 'Overlay caption retained',
      captionAlignment: 'left',
      captionItalic: true,
      captionSpacingPx: 5,
    });
  });

  it('preserves legacy typography while giving new projects historical defaults', () => {
    const legacy = normalizeDesignSpaceProjectPayload<DocumentPage>({
      schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      editorMode: 'document',
      projectId: 'legacy-appearance',
      projectName: 'Legacy appearance',
      document: {
        schemaVersion: 1,
      },
      pages: [
        {
          kind: 'document',
          id: 'legacy-page-1',
          titleFontSizePx: 46,
          titleContent: {
            type: 'doc',
            content: [{
              type: 'paragraph',
              content: [{ type: 'text', text: 'First title' }],
            }],
          },
        },
        {
          kind: 'document',
          id: 'legacy-page-2',
          titleFontSizePx: 32,
          titleContent: {
            type: 'doc',
            content: [{
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Second title ' },
                {
                  type: 'text',
                  text: 'with existing override',
                  marks: [{
                    type: 'documentTextStyle',
                    attrs: { fontSizePx: 28 },
                  }],
                },
              ],
            }],
          },
        },
      ],
    }) as ReturnType<typeof createBlankDocumentProject>;

    expect(legacy.document.styles['article-title']).toMatchObject({
      fontSizePx: 46,
      color: '#1F1C18',
      paragraphSpacingPx: 0,
    });
    expect(legacy.document.styles.body).toMatchObject({
      color: '#1F1C18',
      alignment: 'left',
    });
    expect(legacy.document.styles.caption).toMatchObject({
      fontSizePx: 10,
      color: '#48433D',
      alignment: 'left',
    });
    expect(
      legacy.pages[1].titleContent.content?.[0].attrs
    ).toMatchObject({
      documentStyleId: 'article-title',
      documentStyleFontSizePx: 32,
    });
    expect(
      legacy.pages[1].titleContent.content?.[0].content?.[0].marks
    ).toBeUndefined();
    expect(
      legacy.pages[1].titleContent.content?.[0].content?.[1].marks
    ).toEqual([{
      type: 'documentTextStyle',
      attrs: {
        fontSizePx: 28,
        fontFamilyId: null,
        textColor: null,
        trackingEm: null,
      },
    }]);

    const blank = createBlankDocumentProject('Historical defaults');
    expect(blank.document.schemaVersion).toBe(CURRENT_DOCUMENT_SCHEMA_VERSION);
    expect(blank.document.styles['article-title'].color).toBe('#285F9E');
    expect(blank.document.styles.body.alignment).toBe('justify');
    expect(blank.document.styles.caption).toMatchObject({
      alignment: 'center',
      italic: true,
    });
  });

  it('repairs empty legacy title overrides and hostile inline style marks', () => {
    const normalized = normalizeDesignSpaceProjectPayload<DocumentPage>({
      schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      editorMode: 'document',
      projectId: 'legacy-empty-title',
      projectName: 'Legacy empty title',
      document: { schemaVersion: 1 },
      pages: [
        {
          kind: 'document',
          id: 'legacy-default-title',
          titleContent: {
            type: 'doc',
            content: [{
              type: 'paragraph',
              content: [{
                type: 'text',
                text: 'Default legacy title',
                marks: [{
                  type: 'documentTextStyle',
                  attrs: {
                    fontSizePx: null,
                    fontFamilyId: 'serif;position:fixed',
                    textColor: 'red;display:none',
                    trackingEm: 'calc(99)',
                    arbitraryCss: 'position:fixed',
                  },
                }],
              }],
            }],
          },
        },
        {
          kind: 'document',
          id: 'legacy-empty-title-override',
          titleFontSizePx: 31,
          titleContent: {
            type: 'doc',
            content: [{
              type: 'paragraph',
            }],
          },
        },
      ],
    }) as ReturnType<typeof createBlankDocumentProject>;

    expect(normalized.document.styles['article-title'].fontSizePx).toBe(42);
    expect(
      normalized.pages[1].titleContent.content?.[0].attrs
    ).toMatchObject({
      documentStyleId: 'article-title',
      documentStyleFontSizePx: 31,
    });
    expect(
      normalized.pages[0].titleContent.content?.[0].content?.[0].marks
    ).toEqual([{
      type: 'documentTextStyle',
      attrs: {
        fontSizePx: null,
        fontFamilyId: null,
        textColor: null,
        trackingEm: null,
      },
    }]);
    expect(JSON.stringify(normalized)).not.toContain('position:fixed');
    expect(JSON.stringify(normalized)).not.toContain('calc(');
    expect(JSON.stringify(normalized)).not.toContain('display:none');
  });

  it('updates document styles, language, page overrides, and drop caps atomically', () => {
    const store = useDocumentStore.getState();
    const project = store.createBlankProject('Typography');
    const pageId = project.pages[0].id;

    store.updateDocumentLanguage('de-de');
    store.updatePageLanguage('de-at', pageId);
    store.updateDocumentStyle('article-title', {
      color: '#1670B7',
      fontSizePx: 52,
      trackingEm: 0.04,
    });
    store.updateDropCap({
      enabled: true,
      color: '#1670B7',
      sizeEm: 4.2,
      lineSpan: 4,
    }, pageId);

    const state = useDocumentStore.getState();
    expect(state.project?.document.language).toBe('de-DE');
    expect(state.project?.document.styles['article-title']).toMatchObject({
      color: '#1670B7',
      fontSizePx: 52,
      trackingEm: 0.04,
    });
    expect(state.project?.pages[0].language).toBe('de-AT');
    expect(state.project?.pages[0].dropCap).toMatchObject({
      enabled: true,
      color: '#1670B7',
      sizeEm: 4.2,
      lineSpan: 4,
    });
    expect(state).toMatchObject({
      isDirty: true,
      saveStatus: 'unsaved',
      revision: 4,
    });

    state.updateDocumentLanguage('de-DE');
    state.updateDocumentStyle('article-title', { fontSizePx: 52 });
    state.updateDropCap({ enabled: true }, pageId);
    expect(useDocumentStore.getState().revision).toBe(4);

    state.updatePageLanguage(undefined, pageId);
    expect(useDocumentStore.getState().project?.pages[0].language).toBeUndefined();
    expect(useDocumentStore.getState().revision).toBe(5);
  });
});
