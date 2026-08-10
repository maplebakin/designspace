import { describe, expect, it, vi } from 'vitest';
import {
  CURRENT_DOCUMENT_SCHEMA_VERSION,
  DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
  LEGACY_DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
  normalizeDesignSpaceProjectPayload,
} from '../src/editor/project/projectSchema';
import {
  inspectDesignSpaceProjectFile,
  inspectDesignSpaceProjectJson,
  inspectLibraryProject,
} from '../src/editor/project/projectOpenService';
import type { DocumentPage } from '../src/document/types/documentProject';
import {
  DEFAULT_DOCUMENT_DROP_CAP,
} from '../src/document/typography/documentTypography';

describe('project schema normalization', () => {
  it('wraps old editor-centric payloads into the product-aware schema', () => {
    const legacy = {
      projectName: 'Legacy Planner',
      pages: [{
        id: 'page-1',
        name: 'Page 1',
        canvasData: { objects: [{ id: 'shape-1', type: 'rect' }], background: '#ffffff' },
        canvasSize: { width: 2550, height: 3300 },
      }],
      activePageIndex: 0,
      canvasData: { objects: [{ id: 'shape-1', type: 'rect' }], background: '#ffffff' },
      activeTheme: { meta: { schema: 'generic-token-pack-v1', name: 'Moon Kit', slug: 'moon-kit' } },
      lastUpdated: '2026-01-01T00:00:00.000Z',
      canvasSize: { width: 2550, height: 3300 },
      unitMode: 'in',
    };

    const normalized = normalizeDesignSpaceProjectPayload(legacy, { projectId: 'legacy-id' });

    expect(normalized.schemaVersion).toBe(DESIGN_SPACE_PROJECT_SCHEMA_VERSION);
    expect(normalized.editorMode).toBe('canvas');
    expect(normalized.projectId).toBe('legacy-id');
    expect(normalized.metadata).toMatchObject({
      name: 'Legacy Planner',
      slug: 'legacy-planner',
      sourceApp: 'design-space',
    });
    expect(normalized.document.pageSize).toMatchObject({
      width: 2550,
      height: 3300,
      unitMode: 'in',
      dpi: 300,
    });
    expect(normalized.document.background?.value).toBe('#ffffff');
    expect(normalized.theme).toMatchObject({
      source: 'apocapalette',
      name: 'Moon Kit',
      slug: 'moon-kit',
    });
    expect(normalized.pages[0].kind).toBe('canvas');
  });

  it('keeps pages canvasData compatible', () => {
    const canvasData = { objects: [{ id: 'text-1', type: 'i-text', text: 'Hello' }], background: '#eeeeee' };
    const normalized = normalizeDesignSpaceProjectPayload({
      projectName: 'Canvas Data Test',
      pages: [{
        id: 'page-1',
        name: 'Page 1',
        canvasData,
        canvasSize: { width: 800, height: 600 },
      }],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    });

    expect(normalized.pages[0].canvasData).toBe(canvasData);
    expect(normalized.pages[0].canvasData.objects[0].id).toBe('text-1');
    expect(normalized.pages[0].kind).toBe('canvas');
  });

  it('fills missing product fields with safe defaults', () => {
    const normalized = normalizeDesignSpaceProjectPayload({}, {
      now: '2026-01-01T00:00:00.000Z',
    });

    expect(normalized.schemaVersion).toBe(DESIGN_SPACE_PROJECT_SCHEMA_VERSION);
    expect(normalized.projectName).toBe('Untitled Project');
    expect(normalized.document.pageSize).toMatchObject({
      width: 2550,
      height: 3300,
      unitMode: 'in',
      dpi: 300,
    });
    expect(normalized.exportSettings).toMatchObject({
      pdfFileName: 'untitled-project.pdf',
      previewFileNames: ['untitled-project-preview-page-01.png'],
      formats: ['pdf', 'png'],
      dpi: 300,
      includeBackground: true,
    });
    expect(normalized.productMetadata).toMatchObject({
      title: 'Untitled Project',
      description: '',
      tags: [],
      category: '',
      useCases: [],
      includedFiles: [],
    });
  });

  it('normalizes explicit v1 canvas payloads to discriminated v2 canvas payloads', () => {
    const normalized = normalizeDesignSpaceProjectPayload({
      schemaVersion: LEGACY_DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      editorMode: 'document',
      projectName: 'Legacy Canvas',
      pages: [{
        id: 'legacy-page',
        name: 'Legacy Page',
        canvasData: { objects: [] },
        canvasSize: { width: 1200, height: 900 },
      }],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    });

    expect(normalized.schemaVersion).toBe('design-space-project-v2');
    expect(normalized.editorMode).toBe('canvas');
    expect(normalized.pages).toEqual([
      expect.objectContaining({
        kind: 'canvas',
        id: 'legacy-page',
        canvasSize: { width: 1200, height: 900 },
      }),
    ]);
  });

  it('round-trips v2 canvas payloads without changing Fabric canvas data', () => {
    const canvasData = {
      objects: [{ id: 'canvas-text', type: 'i-text', text: 'Still Fabric' }],
      background: '#ffffff',
    };
    const normalized = normalizeDesignSpaceProjectPayload({
      schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      editorMode: 'canvas',
      projectId: 'canvas-v2',
      projectName: 'Canvas V2',
      pages: [{
        kind: 'canvas',
        id: 'canvas-page',
        name: 'Page 1',
        canvasData,
        canvasSize: { width: 2550, height: 3300 },
      }],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    });

    expect(normalized.editorMode).toBe('canvas');
    expect(normalized.pages[0].kind).toBe('canvas');
    expect(normalized.pages[0].canvasData).toBe(canvasData);
  });

  it('imports a recovered portable project and preserves its forensic metadata', () => {
    const inspection = inspectDesignSpaceProjectJson(JSON.stringify({
      schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      editorMode: 'canvas',
      projectId: 'recovered-project',
      projectName: 'Recovered Planner',
      updatedAt: '2026-02-01T00:00:00.000Z',
      pages: [{
        kind: 'canvas',
        id: 'page-1',
        name: 'Page 1',
        canvasData: { objects: [] },
        canvasSize: { width: 800, height: 600 },
      }],
      recovery: {
        originalProjectId: 'legacy-project',
        originalTimestamp: '2026-01-31T22:00:00.000Z',
        recoveredAt: '2026-07-22T12:00:00.000Z',
        sourceBrowserProfile: 'Google Chrome / Default',
        sourceRecord: '000123.ldb',
        sourceSequence: 42,
        validationWarnings: ['Migrated legacy metadata.'],
        assetsDeduplicated: 3,
        complete: true,
        payloadHash: 'abc123',
      },
    }));

    expect(inspection.editorMode).toBe('canvas');
    expect(inspection.payload.recovery).toEqual(expect.objectContaining({
      originalProjectId: 'legacy-project',
      sourceBrowserProfile: 'Google Chrome / Default',
      assetsDeduplicated: 3,
      complete: true,
    }));
  });

  it('round-trips and safely normalizes a v2 document payload', () => {
    const normalized = normalizeDesignSpaceProjectPayload<DocumentPage>({
      schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      editorMode: 'document',
      projectId: 'document-v2',
      projectName: 'Family History',
      assets: {
        photo: 'data:image/png;base64,AAAA',
        scan: 'data:image/jpeg;base64,BBBB',
      },
      pages: [{
        kind: 'document',
        id: 'document-page',
        name: 'Article',
        size: { presetId: 'letter', widthIn: 8.5, heightIn: 11, dpi: 300 },
        margins: { topIn: 0.6, rightIn: 0.5, bottomIn: 0.6, leftIn: 0.5 },
        titleContent: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Our History' }] }],
        },
        bodyContent: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Translated article' }] }],
        },
        titleFontSizePx: 48,
        columnCount: 3,
        columnGapPx: 28,
        dropCap: true,
        overlayObjects: [{
          id: 'overlay-photo',
          assetId: 'photo',
          altText: 'Family portrait',
          xPx: 96,
          yPx: 120,
          widthPx: 240,
          heightPx: 180,
          placement: 'front',
          caption: 'The family',
        }],
        reference: {
          assetId: 'scan',
          sourceType: 'image',
          opacity: 1.4,
          fit: 'cover',
          scale: 1.1,
          offsetXPx: 8,
          offsetYPx: -4,
          visible: true,
          locked: false,
        },
      }],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    });

    expect(normalized.schemaVersion).toBe(DESIGN_SPACE_PROJECT_SCHEMA_VERSION);
    expect(normalized.editorMode).toBe('document');
    expect(normalized.document).toMatchObject({
      schemaVersion: CURRENT_DOCUMENT_SCHEMA_VERSION,
      styles: {
        'article-title': {
          fontSizePx: 48,
        },
      },
      folios: {
        startingNumber: 1,
        visible: false,
        placement: 'outside-bottom',
      },
    });
    expect(normalized.assets).toEqual({
      photo: 'data:image/png;base64,AAAA',
      scan: 'data:image/jpeg;base64,BBBB',
    });
    expect(normalized.pages[0]).toMatchObject({
      kind: 'document',
      id: 'document-page',
      columnCount: 3,
      columnGapPx: 28,
      dropCap: {
        ...DEFAULT_DOCUMENT_DROP_CAP,
        enabled: true,
      },
      suppressFolio: false,
      margins: {
        topIn: 0.6,
        bottomIn: 0.6,
        innerIn: 0.5,
        outerIn: 0.5,
      },
      overlayObjects: [{
        id: 'overlay-photo',
        assetId: 'photo',
        placement: 'front',
        caption: 'The family',
      }],
      reference: {
        assetId: 'scan',
        opacity: 1,
        fit: 'cover',
        locked: false,
      },
    });
  });

  it('migrates a one-page document to document schema v2 without losing its story', () => {
    const titleContent = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Legacy title' }],
      }],
    };
    const bodyContent = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Legacy body' }],
      }],
    };
    const normalized = normalizeDesignSpaceProjectPayload<DocumentPage>({
      schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      editorMode: 'document',
      projectId: 'legacy-one-page',
      projectName: 'Legacy one-page story',
      document: {
        pageSize: {
          width: 2550,
          height: 3300,
          unitMode: 'in',
          dpi: 300,
        },
        background: { value: '#FAF8F5' },
      },
      pages: [{
        kind: 'document',
        id: 'legacy-page',
        name: 'Article',
        size: {
          presetId: 'letter',
          widthIn: 8.5,
          heightIn: 11,
          dpi: 300,
        },
        margins: {
          topIn: 0.6,
          rightIn: 0.45,
          bottomIn: 0.7,
          leftIn: 0.8,
        },
        titleContent,
        bodyContent,
        columnCount: 3,
        columnGapPx: 22,
        dropCap: true,
        overlayObjects: [],
      }],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    });

    expect(normalized.pages).toHaveLength(1);
    expect(normalized.activePageIndex).toBe(0);
    expect(normalized.document).toMatchObject({
      schemaVersion: CURRENT_DOCUMENT_SCHEMA_VERSION,
      folios: {
        startingNumber: 1,
        visible: false,
        placement: 'outside-bottom',
      },
    });
    expect(normalized.pages[0]).toMatchObject({
      id: 'legacy-page',
      titleContent,
      bodyContent,
      columnCount: 3,
      columnGapPx: 22,
      dropCap: {
        ...DEFAULT_DOCUMENT_DROP_CAP,
        enabled: true,
      },
      suppressFolio: false,
      margins: {
        topIn: 0.6,
        bottomIn: 0.7,
        // The first migrated page is recto: physical left becomes inner.
        innerIn: 0.8,
        outerIn: 0.45,
      },
    });
  });

  it('normalizes four independent pages, folios, parity-aware legacy margins, and active selection', () => {
    const pages = Array.from({ length: 4 }, (_, index) => ({
      kind: 'document',
      id: `historical-page-${49 + index}`,
      name: `Page ${49 + index}`,
      size: {
        presetId: 'letter',
        widthIn: 8.5,
        heightIn: 11,
        dpi: 300,
      },
      margins: {
        topIn: 0.5,
        rightIn: 0.4 + index * 0.01,
        bottomIn: 0.55,
        leftIn: 0.8 + index * 0.01,
      },
      titleContent: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: `Title ${49 + index}` }],
        }],
      },
      bodyContent: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: `Body ${49 + index}` }],
        }],
      },
      columnCount: 3,
      columnGapPx: 24,
      dropCap: index === 0,
      suppressFolio: index === 2,
      overlayObjects: [],
    }));
    const normalized = normalizeDesignSpaceProjectPayload<DocumentPage>({
      schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      editorMode: 'document',
      projectId: 'historical-four-pages',
      projectName: 'Historical pages 49–52',
      activePageIndex: 99,
      document: {
        schemaVersion: CURRENT_DOCUMENT_SCHEMA_VERSION,
        pageSize: {
          width: 2550,
          height: 3300,
          unitMode: 'in',
          dpi: 300,
        },
        background: { value: '#FAF8F5' },
        folios: {
          startingNumber: 49.9,
          visible: true,
          placement: 'inside-top',
        },
      },
      pages,
      lastUpdated: '2026-01-01T00:00:00.000Z',
    });

    expect(normalized.pages).toHaveLength(4);
    expect(normalized.activePageIndex).toBe(3);
    expect(normalized.document.folios).toEqual({
      startingNumber: 49,
      visible: true,
      placement: 'outside-bottom',
    });
    expect(normalized.pages.map((page) => page.id)).toEqual(
      pages.map((page) => page.id)
    );
    expect(normalized.pages.map((page) => page.suppressFolio)).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(normalized.pages[0].margins).toMatchObject({
      innerIn: 0.8,
      outerIn: 0.4,
    });
    // Page 50 is verso: physical right becomes inner.
    expect(normalized.pages[1].margins.innerIn).toBeCloseTo(0.41, 8);
    expect(normalized.pages[1].margins.outerIn).toBeCloseTo(0.81, 8);
    expect(normalized.pages[2].bodyContent).toMatchObject({
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: { documentStyleId: 'body' },
        content: [{ type: 'text', text: 'Body 51' }],
      }],
    });
    expect(normalized.pages[3].bodyContent).toMatchObject({
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: { documentStyleId: 'body' },
        content: [{ type: 'text', text: 'Body 52' }],
      }],
    });
  });

  it('preserves bounded custom physical page dimensions', () => {
    const normalized = normalizeDesignSpaceProjectPayload<DocumentPage>({
      schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      editorMode: 'document',
      projectName: 'Custom trim',
      pages: [{
        kind: 'document',
        id: 'custom-page',
        name: 'Custom page',
        size: {
          presetId: 'custom',
          orientation: 'portrait',
          widthIn: 6.25,
          heightIn: 9.5,
          dpi: 300,
        },
        margins: {
          topIn: 0.5,
          bottomIn: 0.6,
          innerIn: 0.7,
          outerIn: 0.45,
        },
        titleContent: { type: 'doc', content: [{ type: 'paragraph' }] },
        bodyContent: { type: 'doc', content: [{ type: 'paragraph' }] },
        columnCount: 1,
        columnGapPx: 24,
        dropCap: false,
        suppressFolio: false,
        overlayObjects: [],
      }],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    });

    expect(normalized.pages[0]).toMatchObject({
      size: {
        presetId: 'custom',
        orientation: 'portrait',
        widthIn: 6.25,
        heightIn: 9.5,
      },
      margins: {
        topIn: 0.5,
        bottomIn: 0.6,
        innerIn: 0.7,
        outerIn: 0.45,
      },
    });

    const bounded = normalizeDesignSpaceProjectPayload<DocumentPage>({
      ...normalized,
      pages: [{
        ...normalized.pages[0],
        size: {
          ...normalized.pages[0].size,
          widthIn: 0.1,
          heightIn: 300,
        },
      }],
    });
    expect(bounded.pages[0].size.widthIn).toBe(1);
    expect(bounded.pages[0].size.heightIn).toBe(24);
  });

  it('migrates semantic margins independently from parity-aware legacy sides', () => {
    const normalized = normalizeDesignSpaceProjectPayload<DocumentPage>({
      schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      editorMode: 'document',
      projectName: 'Partial semantic margins',
      document: {
        folios: { startingNumber: 50, visible: true },
      },
      pages: [{
        kind: 'document',
        size: { presetId: 'letter', widthIn: 8.5, heightIn: 11, dpi: 300 },
        margins: {
          topIn: 0.5,
          bottomIn: 0.5,
          leftIn: 0.35,
          rightIn: 0.8,
          innerIn: 0.72,
        },
      }],
    });

    // Page 50 is verso: the missing outer margin comes from physical left.
    expect(normalized.pages[0].margins).toMatchObject({
      innerIn: 0.72,
      outerIn: 0.35,
    });
  });

  it('rejects unknown project schemas and editor modes', () => {
    expect(() => normalizeDesignSpaceProjectPayload({
      schemaVersion: 'design-space-project-v99',
    })).toThrow('Unsupported project schema: design-space-project-v99');

    expect(() => normalizeDesignSpaceProjectPayload({
      schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      editorMode: 'mixed',
    })).toThrow('Unsupported editor mode: mixed');

    expect(() => normalizeDesignSpaceProjectPayload({
      schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      editorMode: 'document',
      document: {
        schemaVersion: CURRENT_DOCUMENT_SCHEMA_VERSION + 1,
      },
    })).toThrow(/unsupported document schema/i);

    expect(() => normalizeDesignSpaceProjectPayload({
      schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      editorMode: 'document',
      document: {
        schemaVersion: 'future-v2',
      },
    })).toThrow(/unsupported document schema/i);
  });
});

describe('project pre-mount inspection', () => {
  const documentJson = JSON.stringify({
    schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
    editorMode: 'document',
    projectId: 'document-project',
    projectName: 'Granddad Article',
    pages: [{
      kind: 'document',
      id: 'page-1',
      name: 'Page 1',
      size: { presetId: 'letter', widthIn: 8.5, heightIn: 11, dpi: 300 },
      margins: { topIn: 0.5, rightIn: 0.5, bottomIn: 0.5, leftIn: 0.5 },
      titleContent: { type: 'doc', content: [{ type: 'paragraph' }] },
      bodyContent: { type: 'doc', content: [{ type: 'paragraph' }] },
      titleFontSizePx: 42,
      columnCount: 1,
      columnGapPx: 24,
      dropCap: false,
      overlayObjects: [],
    }],
    lastUpdated: '2026-01-01T00:00:00.000Z',
  });

  it('inspects a project file before an editor shell is mounted', async () => {
    const file = new File([documentJson], 'granddad-article.apocaproject.json', {
      type: 'application/json',
    });

    const inspection = await inspectDesignSpaceProjectFile(file);

    expect(inspection.editorMode).toBe('document');
    expect(inspection.projectName).toBe('Granddad Article');
    expect(inspection.payload.pages[0].kind).toBe('document');
    expect(inspection.session).toMatchObject({
      rendererKind: 'document',
      activePageId: inspection.payload.pages[0].id,
      pages: [{
        size: {
          coordinateSpace: 'document-page-css-px',
          widthCssPx: 816,
          heightCssPx: 1056,
        },
      }],
    });
  });

  it('loads and inspects opaque library JSON without requiring a canvas', async () => {
    const loadProject = async (projectId: string) => ({
      project: {
        id: projectId,
        name: 'Granddad Article',
        lastModified: new Date('2026-01-01T00:00:00.000Z'),
        canvasDataId: 'payload-1',
        editorMode: 'document' as const,
      },
      canvasData: documentJson,
    });

    const inspection = await inspectLibraryProject('document-project', { loadProject } as any);

    expect(inspection).toMatchObject({
      editorMode: 'document',
      projectName: 'Granddad Article',
      libraryProjectId: 'document-project',
      libraryProject: { editorMode: 'document' },
    });
    expect(inspection.session.source).toBe('library');
    expect(inspection.session.rendererKind).toBe('document');
  });

  it('routes v1 product records with root-level Fabric data back to the canvas editor', async () => {
    const canvasJson = JSON.stringify({
      schemaVersion: LEGACY_DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
      projectName: 'Recent Product Draft',
      pages: [{
        id: 'legacy-page',
        name: 'Cover',
        canvasSize: { width: 1200, height: 900 },
      }],
      activePageIndex: 0,
      canvasData: {
        objects: [{ id: 'legacy-shape', type: 'rect' }],
        background: '#ffffff',
      },
      canvasSize: { width: 1200, height: 900 },
      unitMode: 'in',
      lastUpdated: '2026-06-20T10:30:00.000Z',
    });
    const loadProject = async (projectId: string) => ({
      project: {
        id: projectId,
        name: 'Recent Product Draft',
        lastModified: new Date('2026-06-20T10:30:00.000Z'),
        canvasDataId: 'legacy-payload',
      },
      canvasData: canvasJson,
    });

    const inspection = await inspectLibraryProject('recent-product', { loadProject } as any);

    expect(inspection).toMatchObject({
      editorMode: 'canvas',
      projectName: 'Recent Product Draft',
      libraryProjectId: 'recent-product',
      payload: {
        schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
        editorMode: 'canvas',
        canvasData: {
          objects: [{ id: 'legacy-shape', type: 'rect' }],
        },
      },
    });
    expect(inspection.session).toMatchObject({
      source: 'library',
      rendererKind: 'canvas',
      activePageId: 'legacy-page',
      pages: [{
        size: {
          coordinateSpace: 'canvas-logical-px',
          sourceWidth: 1200,
          sourceHeight: 900,
          widthCssPx: 384,
          heightCssPx: 288,
        },
      }],
    });
  });

  it('reports invalid JSON and invalid asset envelopes before routing', () => {
    expect(() => inspectDesignSpaceProjectJson('{nope')).toThrow(
      'Project file contains invalid JSON.'
    );
    expect(() => inspectDesignSpaceProjectJson(JSON.stringify({
      assets: ['not', 'a', 'map'],
    }))).toThrow('Project assets must be a map of image sources.');
  });

  it('quarantines a corrupt library project without affecting other records', async () => {
    const quarantineProject = vi.fn().mockResolvedValue(undefined);
    const reader = {
      loadProject: vi.fn().mockResolvedValue({
        project: {
          id: 'corrupt-project',
          name: 'Recover Me',
          canvasDataId: 'corrupt-data',
          lastModified: new Date(),
        },
        canvasData: '{invalid-json',
      }),
      quarantineProject,
    };

    await expect(inspectLibraryProject('corrupt-project', reader as any))
      .rejects.toThrow('isolated in browser-library recovery data');
    expect(quarantineProject).toHaveBeenCalledWith(
      'corrupt-project',
      'Project file contains invalid JSON.'
    );
  });
});
