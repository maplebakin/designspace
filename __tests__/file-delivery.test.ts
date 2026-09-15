import { afterEach, describe, expect, it, vi } from 'vitest';

const tauriMocks = vi.hoisted(() => ({
  save: vi.fn(),
  open: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: tauriMocks.open,
  save: tauriMocks.save,
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeFile: tauriMocks.writeFile,
  rename: tauriMocks.rename,
  remove: tauriMocks.remove,
}));

import {
  deliverFile,
  deliverFiles,
  ensureFileExtension,
} from '../src/editor/services/fileDeliveryService';
import { isTauriRecoveryAvailable } from '../src/editor/recovery/recoveryClient';

const setTauriRuntime = (enabled: boolean) => {
  if (enabled) {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    return;
  }
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  delete (window as Window & { __TAURI__?: unknown }).__TAURI__;
};

describe('file delivery service', () => {
  afterEach(() => {
    setTauriRuntime(false);
    vi.restoreAllMocks();
    tauriMocks.save.mockReset();
    tauriMocks.open.mockReset();
    tauriMocks.writeFile.mockReset();
    tauriMocks.rename.mockReset();
    tauriMocks.remove.mockReset();
    document.body.innerHTML = '';
  });

  it('uses the configured internal Tauri bridge for platform detection', () => {
    setTauriRuntime(true);
    expect(isTauriRecoveryAvailable()).toBe(true);
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    Object.defineProperty(window, '__TAURI__', { configurable: true, value: {} });
    expect(isTauriRecoveryAvailable()).toBe(true);
  });

  it('keeps browser delivery on the normal Blob/ObjectURL download path', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:browser-export');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const result = await deliverFile({
      content: new Blob(['browser bytes'], { type: 'image/png' }),
      fileName: 'Browser Export.png',
      extension: 'png',
    });

    expect(result).toEqual({ status: 'initiated', fileName: 'Browser Export.png' });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:browser-export');
    expect(tauriMocks.save).not.toHaveBeenCalled();
    expect(tauriMocks.writeFile).not.toHaveBeenCalled();
  });

  it('opens a Tauri save dialog and reports success only after bytes are written', async () => {
    setTauriRuntime(true);
    tauriMocks.save.mockResolvedValue('/exports/design-space.jpg');
    tauriMocks.writeFile.mockResolvedValue(undefined);
    tauriMocks.rename.mockResolvedValue(undefined);
    tauriMocks.remove.mockResolvedValue(undefined);

    const result = await deliverFile({
      content: new Uint8Array([1, 2, 3]),
      fileName: 'design-space.png',
      extension: 'png',
      dialogTitle: 'Save PNG export',
    });

    expect(tauriMocks.save).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: 'design-space.png',
      title: 'Save PNG export',
      filters: [{ name: 'PNG', extensions: ['png'] }],
    }));
    expect(tauriMocks.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/^\/exports\/design-space\.png\.design-space-.+\.tmp$/),
      expect.any(Uint8Array)
    );
    expect(Array.from(tauriMocks.writeFile.mock.calls[0][1] as Uint8Array)).toEqual([1, 2, 3]);
    expect(tauriMocks.rename).toHaveBeenCalledWith(
      expect.stringMatching(/^\/exports\/design-space\.png\.design-space-.+\.tmp$/),
      '/exports/design-space.png'
    );
    expect(result).toEqual({
      status: 'saved',
      fileName: 'design-space.png',
      path: '/exports/design-space.png',
    });
  });

  it('treats a cancelled Tauri save dialog as a non-error and does not write', async () => {
    setTauriRuntime(true);
    tauriMocks.save.mockResolvedValue(null);

    const result = await deliverFile({
      content: new Blob(['cancelled']),
      fileName: 'cancelled.pdf',
      extension: 'pdf',
    });

    expect(result).toEqual({ status: 'cancelled', fileName: 'cancelled.pdf' });
    expect(tauriMocks.writeFile).not.toHaveBeenCalled();
  });

  it('surfaces Tauri write failures with the destination context', async () => {
    setTauriRuntime(true);
    tauriMocks.save.mockResolvedValue('/exports/project.zip');
    tauriMocks.writeFile.mockRejectedValue(new Error('permission denied'));
    tauriMocks.rename.mockResolvedValue(undefined);
    tauriMocks.remove.mockResolvedValue(undefined);

    await expect(deliverFile({
      content: new Blob(['zip']),
      fileName: 'project.zip',
      extension: 'zip',
    })).rejects.toThrow('Could not save project.zip: permission denied');
    expect(tauriMocks.remove).toHaveBeenCalledWith(
      expect.stringMatching(/^\/exports\/project\.zip\.design-space-.+\.tmp$/)
    );
  });

  it('cleans a staged native file when the atomic rename fails', async () => {
    setTauriRuntime(true);
    tauriMocks.save.mockResolvedValue('/exports/project.zip');
    tauriMocks.writeFile.mockResolvedValue(undefined);
    tauriMocks.rename.mockRejectedValue(new Error('destination is locked'));
    tauriMocks.remove.mockResolvedValue(undefined);

    await expect(deliverFile({
      content: new Uint8Array([4, 5, 6]),
      fileName: 'project.zip',
      extension: 'zip',
    })).rejects.toThrow('Could not save project.zip: destination is locked');
    expect(tauriMocks.remove).toHaveBeenCalledWith(
      expect.stringMatching(/^\/exports\/project\.zip\.design-space-.+\.tmp$/)
    );
  });

  it('uses one Tauri folder picker and writes numbered all-page files', async () => {
    setTauriRuntime(true);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    tauriMocks.open.mockResolvedValue('/exports/pages');
    tauriMocks.writeFile.mockResolvedValue(undefined);
    tauriMocks.rename.mockResolvedValue(undefined);

    const result = await deliverFiles([
      { content: new Blob(['page 1']), fileName: 'book-page-01.png', extension: 'png' },
      { content: new ArrayBuffer(2), fileName: 'book-page-02.png', extension: 'png' },
    ], { dialogTitle: 'Choose a folder for the exported PNG pages' });

    expect(tauriMocks.open).toHaveBeenCalledWith({
      title: 'Choose a folder for the exported PNG pages',
      directory: true,
      multiple: false,
    });
    expect(tauriMocks.writeFile).toHaveBeenCalledTimes(2);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(tauriMocks.writeFile.mock.calls.map(([path]) => path)).toEqual([
      expect.stringMatching(/^\/exports\/pages\/book-page-01\.png\.design-space-.+\.tmp$/),
      expect.stringMatching(/^\/exports\/pages\/book-page-02\.png\.design-space-.+\.tmp$/),
    ]);
    expect(tauriMocks.rename.mock.calls.map(([from, to]) => [
      from,
      to,
    ])).toEqual([
      [expect.stringMatching(/^\/exports\/pages\/book-page-01\.png\.design-space-.+\.tmp$/), '/exports/pages/book-page-01.png'],
      [expect.stringMatching(/^\/exports\/pages\/book-page-02\.png\.design-space-.+\.tmp$/), '/exports/pages/book-page-02.png'],
    ]);
    expect(result).toMatchObject({
      status: 'saved',
      directory: '/exports/pages',
      files: [
        { fileName: 'book-page-01.png', path: '/exports/pages/book-page-01.png' },
        { fileName: 'book-page-02.png', path: '/exports/pages/book-page-02.png' },
      ],
    });
  });

  it('reports a partial native batch when a later file cannot be staged', async () => {
    setTauriRuntime(true);
    tauriMocks.open.mockResolvedValue('/exports/pages');
    tauriMocks.writeFile
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk full'));
    tauriMocks.rename.mockResolvedValue(undefined);
    tauriMocks.remove.mockResolvedValue(undefined);

    const result = await deliverFiles([
      { content: new Uint8Array([1]), fileName: 'page-01.png', extension: 'png' },
      { content: new Uint8Array([2]), fileName: 'page-02.png', extension: 'png' },
    ]);

    expect(result).toMatchObject({
      status: 'partial',
      directory: '/exports/pages',
      failedFileName: 'page-02.png',
      error: expect.stringMatching(/disk full/i),
      files: [{ fileName: 'page-01.png', path: '/exports/pages/page-01.png' }],
    });
    expect(tauriMocks.remove).toHaveBeenCalledWith(
      expect.stringMatching(/^\/exports\/pages\/page-02\.png\.design-space-.+\.tmp$/)
    );
  });

  it('replaces a user-selected mismatched extension without changing the basename', () => {
    expect(ensureFileExtension('/exports/family-history.jpg', 'png'))
      .toBe('/exports/family-history.png');
    expect(ensureFileExtension('/exports/family-history.apocaproject.json', 'apocaproject.json'))
      .toBe('/exports/family-history.apocaproject.json');
  });
});
