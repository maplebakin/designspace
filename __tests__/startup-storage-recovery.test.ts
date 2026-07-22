import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_STORAGE_RECOVERY_PREFIX,
  MAX_SAFE_ORIGIN_STORAGE_BYTES,
  STORAGE_RECOVERY_MARKER_KEY,
  TEMPLATE_MIGRATION_FLAG_KEY,
  getStartupStorageStatus,
  prepareStartupStorage,
} from '../src/editor/persistence/startupStorageRecovery';

const setStorageEstimate = (usage: number) => {
  Object.defineProperty(window.navigator, 'storage', {
    configurable: true,
    value: {
      estimate: vi.fn().mockResolvedValue({
        usage,
        quota: MAX_SAFE_ORIGIN_STORAGE_BYTES * 4,
      }),
    },
  });
};

describe('startup persistence recovery', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(TEMPLATE_MIGRATION_FLAG_KEY, 'done');
    setStorageEstimate(1024);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('quarantines malformed Zustand state and continues with clean active storage', async () => {
    window.localStorage.setItem('designspace-theme', '{broken-json');

    const status = await prepareStartupStorage();

    expect(status.indexedDbBlocked).toBe(false);
    expect(window.localStorage.getItem('designspace-theme')).toBeNull();
    const recoveryKey = Array.from(
      { length: window.localStorage.length },
      (_, index) => window.localStorage.key(index) || ''
    )
      .find((key) => key.startsWith(`${LOCAL_STORAGE_RECOVERY_PREFIX}designspace-theme:`));
    expect(recoveryKey).toBeTruthy();
    expect(window.localStorage.getItem(recoveryKey!)).toBe('{broken-json');
    expect(status.quarantinedLocalStorage).toEqual([
      expect.objectContaining({ key: 'designspace-theme', reason: 'corrupt-json' }),
    ]);
  });

  it('blocks IndexedDB startup while preserving an abnormally large library in place', async () => {
    setStorageEstimate(MAX_SAFE_ORIGIN_STORAGE_BYTES + 1);

    const status = await prepareStartupStorage();

    expect(status).toMatchObject({
      indexedDbBlocked: true,
      reason: 'origin-storage-oversized',
      usageBytes: MAX_SAFE_ORIGIN_STORAGE_BYTES + 1,
    });
    expect(getStartupStorageStatus().indexedDbBlocked).toBe(true);
    expect(JSON.parse(window.localStorage.getItem('designspace-storage-recovery-v1') || '{}'))
      .toMatchObject({ dataPreservedInPlace: true });
  });

  it('exits recovery mode and clears the marker after storage is healthy again', async () => {
    window.localStorage.setItem(STORAGE_RECOVERY_MARKER_KEY, JSON.stringify({
      reason: 'origin-storage-oversized',
      dataPreservedInPlace: true,
    }));

    const status = await prepareStartupStorage();

    expect(status.indexedDbBlocked).toBe(false);
    expect(status.reason).toBe('healthy');
    expect(window.localStorage.getItem(STORAGE_RECOVERY_MARKER_KEY)).toBeNull();
  });
});
