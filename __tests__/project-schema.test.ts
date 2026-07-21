import { describe, expect, it } from 'vitest';
import {
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
    expect(normalized.assets).toEqual({
      photo: 'data:image/png;base64,AAAA',
      scan: 'data:image/jpeg;base64,BBBB',
    });
    expect(normalized.pages[0]).toMatchObject({
      kind: 'document',
      id: 'document-page',
      titleFontSizePx: 48,
      columnCount: 3,
      columnGapPx: 28,
      dropCap: true,
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
        locked: true,
      },
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
  });

  it('reports invalid JSON and invalid asset envelopes before routing', () => {
    expect(() => inspectDesignSpaceProjectJson('{nope')).toThrow(
      'Project file contains invalid JSON.'
    );
    expect(() => inspectDesignSpaceProjectJson(JSON.stringify({
      assets: ['not', 'a', 'map'],
    }))).toThrow('Project assets must be a map of image sources.');
  });
});
