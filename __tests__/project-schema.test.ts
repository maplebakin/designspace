import { describe, expect, it } from 'vitest';
import {
  DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
  normalizeDesignSpaceProjectPayload,
} from '../src/editor/project/projectSchema';

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
});
