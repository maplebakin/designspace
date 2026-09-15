import { describe, expect, it, vi } from 'vitest';
import {
  DesignSpaceDB,
  fingerprintProjectContent,
  fingerprintProjectPayload,
} from '../src/editor/db';

describe('browser-library write deduplication', () => {
  it('keeps authored-content fingerprints stable across save timestamps', () => {
    const first = JSON.stringify({
      schemaVersion: 'design-space-project-v1',
      updatedAt: '2026-09-13T12:00:00.000Z',
      lastUpdated: '2026-09-13T12:00:00.000Z',
      pages: [{ id: 'page-1', canvasData: { objects: [] } }],
    });
    const later = JSON.stringify({
      schemaVersion: 'design-space-project-v1',
      updatedAt: '2026-09-13T12:01:00.000Z',
      lastUpdated: '2026-09-13T12:01:00.000Z',
      pages: [{ id: 'page-1', canvasData: { objects: [] } }],
    });

    expect(fingerprintProjectContent(first)).toBe(fingerprintProjectContent(later));
    expect(fingerprintProjectContent(first)).not.toBe(fingerprintProjectPayload(first));
  });

  it('ignores regenerated page thumbnails while retaining authored page changes', () => {
    const first = JSON.stringify({
      projectName: 'Previewed project',
      pages: [{
        id: 'page-1',
        thumbnail: 'data:image/png;base64,old-preview',
        canvasData: { objects: [{ id: 'shape', left: 10 }] },
      }],
    });
    const regenerated = JSON.stringify({
      projectName: 'Previewed project',
      pages: [{
        id: 'page-1',
        thumbnail: 'data:image/png;base64,new-preview',
        canvasData: { objects: [{ id: 'shape', left: 10 }] },
      }],
    });
    const authoredChange = JSON.stringify({
      projectName: 'Previewed project',
      pages: [{
        id: 'page-1',
        thumbnail: 'data:image/png;base64,new-preview',
        canvasData: { objects: [{ id: 'shape', left: 11 }] },
      }],
    });

    expect(fingerprintProjectContent(first)).toBe(fingerprintProjectContent(regenerated));
    expect(fingerprintProjectContent(first)).not.toBe(fingerprintProjectContent(authoredChange));
  });

  it('does not rewrite an unchanged serialized project payload', async () => {
    const payload = JSON.stringify({ schemaVersion: 'design-space-project-v1', pages: [] });
    const modify = vi.fn().mockResolvedValue(1);
    const update = vi.fn().mockResolvedValue(1);
    const fakeDb = Object.create(DesignSpaceDB.prototype) as DesignSpaceDB;
    (fakeDb as any).projects = {
      get: vi.fn().mockResolvedValue({
        id: 'project-1',
        contentHash: fingerprintProjectPayload(payload),
        payloadLength: payload.length,
      }),
      update,
    };
    (fakeDb as any).canvasData = {
      get: vi.fn().mockResolvedValue({
        id: 'canvas-current',
        projectId: 'project-1',
        jsonPayload: payload,
      }),
      update: vi.fn().mockResolvedValue(1),
      where: vi.fn(() => ({ equals: vi.fn(() => ({ modify })) })),
    };
    (fakeDb as any).transaction = vi.fn(async (...args: unknown[]) => {
      const callback = args.at(-1) as () => Promise<boolean>;
      return callback();
    });

    const changed = await fakeDb.updateProject(
      'project-1',
      'Unchanged project',
      payload,
      undefined,
      'canvas'
    );

    expect(changed).toBe(false);
    expect(modify).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
  });

  it('updates only the project-referenced canvas-data row when duplicates exist', async () => {
    const oldPayload = JSON.stringify({ schemaVersion: 'design-space-project-v1', pages: [] });
    const nextPayload = JSON.stringify({ schemaVersion: 'design-space-project-v2', pages: [{}] });
    const rowUpdate = vi.fn().mockResolvedValue(1);
    const modify = vi.fn().mockResolvedValue(1);
    const project = {
      id: 'project-1',
      canvasDataId: 'canvas-current',
      contentHash: fingerprintProjectPayload(oldPayload),
      payloadLength: oldPayload.length,
    };
    const fakeDb = Object.create(DesignSpaceDB.prototype) as DesignSpaceDB;
    (fakeDb as any).projects = {
      get: vi.fn().mockResolvedValue(project),
      update: vi.fn().mockResolvedValue(1),
    };
    (fakeDb as any).canvasData = {
      get: vi.fn().mockResolvedValue({
        id: 'canvas-current',
        projectId: 'project-1',
        jsonPayload: oldPayload,
      }),
      update: rowUpdate,
      where: vi.fn(() => ({ equals: vi.fn(() => ({ modify })) })),
    };
    (fakeDb as any).transaction = vi.fn(async (...args: unknown[]) => {
      const callback = args.at(-1) as () => Promise<boolean>;
      return callback();
    });

    await fakeDb.updateProject(
      'project-1',
      'Changed project',
      nextPayload,
      undefined,
      'canvas'
    );

    expect(rowUpdate).toHaveBeenCalledWith(
      'canvas-current',
      expect.objectContaining({ jsonPayload: nextPayload })
    );
    expect(modify).not.toHaveBeenCalled();
  });

  it('returns a durable conflict without touching either row when the expected revision is stale', async () => {
    const projectUpdate = vi.fn().mockResolvedValue(1);
    const canvasUpdate = vi.fn().mockResolvedValue(1);
    const payload = JSON.stringify({ schemaVersion: 'design-space-project-v2', pages: [] });
    const fakeDb = Object.create(DesignSpaceDB.prototype) as DesignSpaceDB;
    (fakeDb as any).projects = {
      get: vi.fn().mockResolvedValue({
        id: 'project-1',
        canvasDataId: 'canvas-current',
        projectId: 'project-1',
        revision: 2,
        contentHash: fingerprintProjectContent(payload),
        payloadLength: payload.length,
      }),
      update: projectUpdate,
    };
    (fakeDb as any).canvasData = {
      get: vi.fn().mockResolvedValue({
        id: 'canvas-current',
        projectId: 'project-1',
        jsonPayload: payload,
      }),
      update: canvasUpdate,
    };
    (fakeDb as any).transaction = vi.fn(async (...args: unknown[]) => {
      const callback = args.at(-1) as () => Promise<unknown>;
      return callback();
    });

    const result = await fakeDb.updateProjectIfRevision(
      'project-1',
      'Stale writer',
      payload,
      undefined,
      'canvas',
      1,
    );

    expect(result).toEqual({
      status: 'conflict',
      projectId: 'project-1',
      expectedRevision: 1,
      actualRevision: 2,
    });
    expect(projectUpdate).not.toHaveBeenCalled();
    expect(canvasUpdate).not.toHaveBeenCalled();
  });

  it('fences metadata renames with the same durable revision as scene writes', async () => {
    const projectUpdate = vi.fn().mockResolvedValue(1);
    const canvasUpdate = vi.fn().mockResolvedValue(1);
    const fakeDb = Object.create(DesignSpaceDB.prototype) as DesignSpaceDB;
    (fakeDb as any).projects = {
      get: vi.fn().mockResolvedValue({
        id: 'project-1',
        canvasDataId: 'canvas-current',
        revision: 3,
      }),
      update: projectUpdate,
    };
    (fakeDb as any).canvasData = {
      get: vi.fn().mockResolvedValue({
        id: 'canvas-current',
        projectId: 'project-1',
      }),
      update: canvasUpdate,
    };
    (fakeDb as any).transaction = vi.fn(async (...args: unknown[]) => {
      const callback = args.at(-1) as () => Promise<unknown>;
      return callback();
    });

    const result = await fakeDb.renameProjectIfRevision('project-1', 'Renamed', 3);

    expect(result).toMatchObject({ status: 'saved', projectId: 'project-1', revision: 4 });
    expect(projectUpdate).toHaveBeenCalledWith('project-1', expect.objectContaining({
      name: 'Renamed',
      revision: 4,
    }));
    expect(canvasUpdate).toHaveBeenCalledWith('canvas-current', expect.objectContaining({
      revision: 4,
    }));
  });
});
