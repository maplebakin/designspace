import { describe, expect, it, vi } from 'vitest';
import {
  DesignSpaceDB,
  fingerprintProjectPayload,
} from '../src/editor/db';

describe('browser-library write deduplication', () => {
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
});
