import {
  generateHTML,
  generateJSON,
  type JSONContent,
} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import {
  DocumentFlowImageExtension,
  normalizeDocumentImageAttributes,
} from '../src/document/extensions/DocumentImageExtension';
import {
  CURRENT_DOCUMENT_SCHEMA_VERSION,
  DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
  normalizeDesignSpaceProjectPayload,
  type DocumentProjectPayload,
} from '../src/editor/project/projectSchema';

const extensions = [
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
  DocumentFlowImageExtension.configure({
    resolveAssetSource: () => 'data:image/png;base64,AA==',
    getViewScale: () => 1,
    minWidthPx: 48,
    maxWidthPx: 720,
    maxSpanWidthPx: 720,
    getSpanWidthPx: () => 720,
  }),
];

const imageContent: JSONContent = {
  type: 'doc',
  content: [{
    type: 'documentFlowImage',
    attrs: {
      id: 'photo-1',
      assetId: 'asset-1',
      widthPx: 300,
      heightPx: 180,
      naturalWidth: 1200,
      naturalHeight: 800,
      wrap: 'top-bottom',
      cropMode: 'fill',
      cropFocalX: 0.2,
      cropFocalY: 0.8,
    },
  }],
};

describe('document image frame and crop state', () => {
  it('normalizes frame mode and focal position without changing the asset', () => {
    expect(normalizeDocumentImageAttributes({
      id: 'photo-1',
      assetId: 'asset-1',
      cropMode: 'fill',
      cropFocalX: -2,
      cropFocalY: 3,
      widthPx: 300,
      heightPx: 180,
      naturalWidth: 1200,
      naturalHeight: 800,
    })).toMatchObject({
      cropMode: 'fill',
      cropFocalX: 0,
      cropFocalY: 1,
      widthPx: 300,
      heightPx: 180,
    });
  });

  it('serializes a non-destructive frame and renders crop styling', () => {
    const html = generateHTML(imageContent, extensions);
    expect(html).toContain('data-crop-mode="fill"');
    expect(html).toContain('data-crop-focal-x="0.2"');
    expect(html).toContain('object-fit: cover');
    expect(html).toContain('document-image__frame');

    const roundTrip = generateJSON(html, extensions);
    expect(roundTrip.content?.[0]?.attrs).toMatchObject({
      cropMode: 'fill',
      cropFocalX: 0.2,
      cropFocalY: 0.8,
    });
  });

  it('migrates pre-crop documents to a stable fit frame in schema v6', () => {
    const normalized = normalizeDesignSpaceProjectPayload({
      schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      editorMode: 'document',
      projectName: 'Crop migration',
      document: { schemaVersion: 5 },
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
        titleContent: { type: 'doc', content: [{ type: 'paragraph' }] },
        bodyContent: {
          type: 'doc',
          content: [{
            type: 'documentFlowImage',
            attrs: {
              id: 'legacy-flow-photo',
              assetId: 'asset-flow-photo',
              widthPx: 240,
              heightPx: 160,
              naturalWidth: 1200,
              naturalHeight: 800,
              wrap: 'span-columns',
            },
          }],
        },
        columnCount: 1,
        columnGapPx: 24,
        dropCap: false,
        suppressFolio: false,
        overlayObjects: [{
          id: 'legacy-overlay-photo',
          assetId: 'asset-overlay-photo',
          altText: 'Legacy overlay',
          xPx: 20,
          yPx: 20,
          widthPx: 160,
          heightPx: 100,
          placement: 'front',
        }],
      }],
    }) as DocumentProjectPayload;

    expect(CURRENT_DOCUMENT_SCHEMA_VERSION).toBe(6);
    expect(normalized.document.schemaVersion).toBe(6);
    expect(normalized.pages[0].bodyContent.content?.[0]?.attrs).toMatchObject({
      cropMode: 'fit',
      cropFocalX: 0.5,
      cropFocalY: 0.5,
    });
    expect(normalized.pages[0].overlayObjects[0]).toMatchObject({
      cropMode: 'fit',
      cropFocalX: 0.5,
      cropFocalY: 0.5,
    });

    const authored = {
      ...normalized,
      pages: normalized.pages.map((page) => ({
        ...page,
        bodyContent: imageContent,
      })),
    };
    const reopened = normalizeDesignSpaceProjectPayload(
      JSON.parse(JSON.stringify(authored))
    ) as DocumentProjectPayload;
    expect(reopened.pages[0].bodyContent.content?.[0]?.attrs).toMatchObject({
      cropMode: 'fill',
      cropFocalX: 0.2,
      cropFocalY: 0.8,
    });
  });
});
