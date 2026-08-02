import {
  generateHTML,
  generateJSON,
  type JSONContent,
} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import {
  DocumentFlowImageExtension,
  DocumentInlineImageExtension,
  normalizeDocumentImageAttributes,
} from '../src/document/extensions/DocumentImageExtension';
import {
  CURRENT_DOCUMENT_SCHEMA_VERSION,
  DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
  normalizeDesignSpaceProjectPayload,
  normalizeDocumentImageContentGeometry,
  type DocumentProjectPayload,
} from '../src/editor/project/projectSchema';
import {
  normalizeDocumentImageGeometry,
} from '../src/document/types/documentProject';

const imageExtensions = [
  StarterKit.configure({
    blockquote: false,
    bulletList: false,
    code: false,
    codeBlock: false,
    heading: false,
    horizontalRule: false,
    link: false,
    listItem: false,
    listKeymap: false,
    orderedList: false,
    strike: false,
  }),
  DocumentInlineImageExtension.configure({
    resolveAssetSource: () => 'data:image/png;base64,AA==',
    getViewScale: () => 1,
    minWidthPx: 48,
    maxWidthPx: 720,
    maxSpanWidthPx: 720,
    getSpanWidthPx: () => 720,
  }),
  DocumentFlowImageExtension.configure({
    resolveAssetSource: () => 'data:image/png;base64,AA==',
    getViewScale: () => 1,
    minWidthPx: 48,
    maxWidthPx: 720,
    maxSpanWidthPx: 720,
    getSpanWidthPx: () => 720,
  }),
];

const documentPayload = (
  documentSchemaVersion: number,
  bodyContent: JSONContent
) => ({
  schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
  editorMode: 'document',
  projectId: 'image-schema-project',
  projectName: 'Image schema project',
  document: {
    schemaVersion: documentSchemaVersion,
  },
  pages: [{
    kind: 'document',
    id: 'page-1',
    name: 'Page 1',
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
    titleContent: {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    },
    bodyContent,
    columnCount: 3,
    columnGapPx: 24,
    dropCap: false,
    suppressFolio: false,
    overlayObjects: [],
  }],
  lastUpdated: '2026-07-29T00:00:00.000Z',
});

const imageNodes = (project: DocumentProjectPayload) => (
  project.pages[0].bodyContent.content || []
).filter((node) => (
  node.type === 'documentFlowImage'
  || node.type === 'documentInlineImage'
));

describe('document image schema v3', () => {
  it('migrates v2 scalar span geometry to canonical four-sided body-span attrs', () => {
    const normalized = normalizeDesignSpaceProjectPayload(
      documentPayload(2, {
        type: 'doc',
        content: [{
          type: 'documentFlowImage',
          attrs: {
            id: 'legacy-span',
            assetId: 'asset-span',
            wrap: 'span-columns',
            wrapPaddingPx: 17,
            verticalSpacingPx: 29,
            verticalAnchor: 'page-position',
            xOffsetPx: 31,
            yPx: 140,
          },
        }, {
          type: 'documentFlowImage',
          attrs: {
            id: 'legacy-float',
            assetId: 'asset-float',
            wrap: 'float-left',
            wrapPaddingPx: 13,
            verticalSpacingPx: 47,
          },
        }],
      })
    ) as DocumentProjectPayload;

    expect(normalized.document.schemaVersion).toBe(4);
    expect(CURRENT_DOCUMENT_SCHEMA_VERSION).toBe(4);
    const [span, float] = imageNodes(normalized);

    expect(span.attrs).toMatchObject({
      wrap: 'span-columns',
      verticalAnchor: 'page-position',
      coordinateSpace: 'body-span',
      wrapPaddingTopPx: 29,
      wrapPaddingRightPx: 17,
      wrapPaddingBottomPx: 29,
      wrapPaddingLeftPx: 17,
      xOffsetPx: 31,
      yPx: 140,
      captionAlignment: 'inherit',
      captionItalic: 'inherit',
      captionSpacingPx: 'inherit',
    });
    expect(float.attrs).toMatchObject({
      wrap: 'float-left',
      verticalAnchor: 'flow',
      coordinateSpace: 'flow',
      wrapPaddingTopPx: 0,
      wrapPaddingRightPx: 13,
      wrapPaddingBottomPx: 13,
      wrapPaddingLeftPx: 0,
    });
    [span, float].forEach((node) => {
      expect(node.attrs).not.toHaveProperty('wrapPaddingPx');
      expect(node.attrs).not.toHaveProperty('verticalSpacingPx');
    });
  });

  it('bounds malformed sides and derives coordinate space from active geometry', () => {
    expect(normalizeDocumentImageGeometry({
      wrap: 'span-columns',
      verticalAnchor: 'page-position',
      coordinateSpace: 'viewport',
      wrapPaddingPx: 40,
      verticalSpacingPx: 7,
      wrapPaddingTopPx: -100,
      wrapPaddingRightPx: 500,
      wrapPaddingBottomPx: '25.6',
      wrapPaddingLeftPx: 'not-a-number',
    })).toEqual({
      wrap: 'span-columns',
      verticalAnchor: 'page-position',
      coordinateSpace: 'body-span',
      wrapPaddingTopPx: 0,
      wrapPaddingRightPx: 96,
      wrapPaddingBottomPx: 26,
      wrapPaddingLeftPx: 40,
    });

    expect(normalizeDocumentImageGeometry({
      wrap: 'float-right',
      verticalAnchor: 'flow',
      coordinateSpace: 'body-span',
      wrapPaddingPx: 9,
    })).toEqual({
      wrap: 'float-right',
      verticalAnchor: 'flow',
      coordinateSpace: 'flow',
      wrapPaddingTopPx: 0,
      wrapPaddingRightPx: 0,
      wrapPaddingBottomPx: 9,
      wrapPaddingLeftPx: 9,
    });
  });

  it('keeps canonical v3 sides authoritative and removes contradictory aliases', () => {
    const normalized = normalizeDesignSpaceProjectPayload(
      documentPayload(3, {
        type: 'doc',
        content: [{
          type: 'documentFlowImage',
          attrs: {
            id: 'canonical-span',
            assetId: 'asset-canonical',
            wrap: 'span-columns',
            verticalAnchor: 'page-position',
            coordinateSpace: 'flow',
            wrapPaddingTopPx: 3,
            wrapPaddingRightPx: 5,
            wrapPaddingBottomPx: 7,
            wrapPaddingLeftPx: 11,
            wrapPaddingPx: 88,
            verticalSpacingPx: 77,
          },
        }],
      })
    ) as DocumentProjectPayload;
    const [image] = imageNodes(normalized);

    expect(image.attrs).toMatchObject({
      coordinateSpace: 'body-span',
      wrapPaddingTopPx: 3,
      wrapPaddingRightPx: 5,
      wrapPaddingBottomPx: 7,
      wrapPaddingLeftPx: 11,
    });
    expect(image.attrs).not.toHaveProperty('wrapPaddingPx');
    expect(image.attrs).not.toHaveProperty('verticalSpacingPx');
  });

  it('canonicalizes raw nested editor JSON without retaining legacy aliases', () => {
    const canonical = normalizeDocumentImageContentGeometry({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'documentInlineImage',
          attrs: {
            id: 'legacy-inline',
            assetId: 'asset-inline',
            wrap: 'inline',
            wrapPaddingPx: 21,
            verticalSpacingPx: 44,
          },
        }],
      }],
    });
    const inline = canonical.content?.[0]?.content?.[0];

    expect(inline?.attrs).toMatchObject({
      wrap: 'inline',
      coordinateSpace: 'flow',
      wrapPaddingTopPx: 21,
      wrapPaddingRightPx: 21,
      wrapPaddingBottomPx: 21,
      wrapPaddingLeftPx: 21,
    });
    expect(inline?.attrs).not.toHaveProperty('wrapPaddingPx');
    expect(inline?.attrs).not.toHaveProperty('verticalSpacingPx');
  });

  it('parses legacy HTML safely and renders canonical HTML attributes only', () => {
    const legacyHtml = [
      '<figure data-document-image="true"',
      ' data-image-id="legacy-html"',
      ' data-asset-id="asset-html"',
      ' data-wrap="span-columns"',
      ' data-wrap-padding-px="18"',
      ' data-vertical-spacing-px="27"',
      ' data-vertical-anchor="page-position"',
      ' data-y-px="120" data-x-offset-px="30">',
      '<img alt="Archive" />',
      '</figure>',
    ].join('');
    const parsed = generateJSON(legacyHtml, imageExtensions);
    const parsedAttrs = parsed.content?.[0]?.attrs;

    expect(parsedAttrs).toMatchObject({
      coordinateSpace: 'body-span',
      wrapPaddingTopPx: 27,
      wrapPaddingRightPx: 18,
      wrapPaddingBottomPx: 27,
      wrapPaddingLeftPx: 18,
    });

    const canonicalHtml = generateHTML(parsed, imageExtensions);
    expect(canonicalHtml).toContain('data-coordinate-space="body-span"');
    expect(canonicalHtml).toContain('data-wrap-padding-top-px="27"');
    expect(canonicalHtml).toContain('data-wrap-padding-right-px="18"');
    expect(canonicalHtml).toContain('data-wrap-padding-bottom-px="27"');
    expect(canonicalHtml).toContain('data-wrap-padding-left-px="18"');
    expect(canonicalHtml).not.toContain('data-wrap-padding-px=');
    expect(canonicalHtml).not.toContain('data-vertical-spacing-px=');
  });

  it('keeps runtime legacy input compatible while making canonical sides authoritative', () => {
    const normalized = normalizeDocumentImageAttributes({
      wrap: 'span-columns',
      verticalAnchor: 'page-position',
      wrapPaddingPx: 14,
      verticalSpacingPx: 22,
      wrapPaddingRightPx: 31,
    });

    expect(normalized).toMatchObject({
      coordinateSpace: 'body-span',
      wrapPaddingTopPx: 22,
      wrapPaddingRightPx: 31,
      wrapPaddingBottomPx: 22,
      wrapPaddingLeftPx: 14,
      // Derived compatibility aliases cannot contradict canonical geometry.
      wrapPaddingPx: 31,
      verticalSpacingPx: 22,
    });
  });

  it('rejects document schema versions newer than the current schema', () => {
    expect(() => normalizeDesignSpaceProjectPayload(
      documentPayload(CURRENT_DOCUMENT_SCHEMA_VERSION + 1, {
        type: 'doc',
        content: [{ type: 'paragraph' }],
      })
    )).toThrow(/unsupported document schema/i);
  });
});
