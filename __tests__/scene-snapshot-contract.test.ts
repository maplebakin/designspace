import { describe, expect, it } from 'vitest';
import {
  assertCanonicalSerializedScene,
  assertPortableScene,
  createAuthoredCanvasPageSnapshot,
  createDurableSceneSnapshot,
  createExportSceneSnapshot,
  createPageSceneSnapshot,
  createTemplateSceneSnapshot,
  resolveCanvasSourceDpi,
  type CanonicalSerializedScene,
} from '../src/editor/scene/sceneSnapshot';
import { createInitialAuthoredRevision } from '../src/editor/session/authoredRevision';

const serializedScene: CanonicalSerializedScene = {
  objects: [{
    id: 'shape-1',
    type: 'rect',
    left: 12,
    top: 24,
  }],
  coordinateSpace: 'page-space',
};

describe('typed scene snapshot boundary', () => {
  it('keeps serialized scenes separate from live runtime objects', () => {
    expect(assertCanonicalSerializedScene(serializedScene)).toBe(serializedScene);
    expect(() => assertCanonicalSerializedScene({
      objects: [{
        id: 'live-shape',
        type: 'rect',
        set: () => undefined,
      }],
    })).toThrow(/not a live runtime object|not a live runtime object/i);
  });

  it('rejects selection-local coordinates and session-only blob resources at durable edges', () => {
    expect(() => assertCanonicalSerializedScene({
      objects: [],
      coordinateSpace: 'selection-local',
    })).toThrow(/coordinateSpace/i);

    expect(() => assertPortableScene({
      objects: [{
        id: 'image-1',
        type: 'image',
        src: 'blob:session-only',
      }],
    })).toThrow(/blob URL/i);
    expect(() => assertPortableScene(
      { objects: [] },
      { 'image-1': 'blob:session-only' },
    )).toThrow(/blob URL/i);
    expect(() => assertPortableScene({
      objects: [],
      assets: { 'image-1': 'blob:session-only' },
    })).toThrow(/blob URL/i);
  });

  it('labels page, durable, template, and export snapshots without cloning the scene', () => {
    const page = createPageSceneSnapshot({
      pageId: 'page-1',
      canvasSize: { width: 800, height: 600 },
      scene: serializedScene,
    });
    const authoredRevision = createInitialAuthoredRevision({
      sessionIdentity: 'session-1',
      projectIdentity: 'project-1',
    });
    const durable = createDurableSceneSnapshot({
      projectId: 'project-1',
      sessionIdentity: 'session-1',
      authoredRevision,
      activePageId: page.pageId,
      pages: [page],
      assets: { 'image-1': 'data:image/png;base64,AAAA' },
    });
    const exported = createExportSceneSnapshot({
      pageId: page.pageId,
      canvasSize: page.canvasSize,
      scene: page.scene,
    });

    expect(page.kind).toBe('page-scene-snapshot');
    expect(durable.kind).toBe('durable-scene-snapshot');
    expect(durable.authoredRevision).toBe(authoredRevision);
    expect(exported.kind).toBe('export-scene-snapshot');
    expect(exported.scene).toBe(page.scene);
  });

  it('makes page geometry, background, and export density explicit at the authored boundary', () => {
    const authored = createAuthoredCanvasPageSnapshot({
      pageId: 'page-1',
      canvasSize: { width: 2550, height: 3300 },
      unitMode: 'in',
      scene: { objects: [] },
      backgroundColor: 'transparent',
    });
    const page = createPageSceneSnapshot({
      pageId: 'page-1',
      canvasSize: { width: 2550, height: 3300 },
      scene: { objects: [] },
    });

    expect(authored.dimensions).toEqual({
      canvasSize: { width: 2550, height: 3300 },
      unitMode: 'in',
      sourceDpi: 300,
    });
    expect(authored.backgroundColor).toBe('#FAF8F5');
    expect(authored.scene).toMatchObject({
      canvasSize: { width: 2550, height: 3300 },
      coordinateSpace: 'page-space',
      background: '#FAF8F5',
    });
    expect(page.scene).toMatchObject({
      canvasSize: { width: 2550, height: 3300 },
      coordinateSpace: 'page-space',
      background: '#FAF8F5',
    });
    expect(resolveCanvasSourceDpi('px')).toBe(96);
    expect(resolveCanvasSourceDpi('mm', 240)).toBe(240);
    expect(() => createExportSceneSnapshot({
      canvasSize: { width: 800, height: 600 },
      scene: { objects: [], canvasSize: { width: 801, height: 600 } },
    })).toThrow(/dimensions/i);
  });

  it('rejects non-string portable asset entries before a snapshot is handed to a loader', () => {
    expect(() => assertPortableScene({
      objects: [],
      assets: { 'image-1': { url: 'data:image/png;base64,AAAA' } },
    })).toThrow(/string/i);
  });

  it('normalizes portable template scenes to the declared page boundary', () => {
    const template = createTemplateSceneSnapshot({
      canvasSize: { width: 640, height: 480 },
      scene: { objects: [] },
    });

    expect(template.scene).toMatchObject({
      canvasSize: { width: 640, height: 480 },
      coordinateSpace: 'page-space',
      background: '#FAF8F5',
    });
    expect(() => createTemplateSceneSnapshot({
      canvasSize: { width: 640, height: 480 },
      scene: {
        objects: [],
        canvasSize: { width: 641, height: 480 },
      },
    })).toThrow(/dimensions/i);
  });

  it('keeps ephemeral export delivery distinct from portable durability', () => {
    const exported = createExportSceneSnapshot({
      canvasSize: { width: 800, height: 600 },
      scene: {
        objects: [{ id: 'image-1', type: 'image', src: 'blob:session-only' }],
      },
      assets: { 'image-1': 'blob:session-only' },
    });

    expect(exported.kind).toBe('export-scene-snapshot');
    expect(() => createDurableSceneSnapshot({
      projectId: 'project-1',
      sessionIdentity: 'session-1',
      authoredRevision: createInitialAuthoredRevision({
        sessionIdentity: 'session-1',
        projectIdentity: 'project-1',
      }),
      activePageId: null,
      pages: [],
      assets: exported.assets,
    })).toThrow(/blob URL/i);
  });
});
