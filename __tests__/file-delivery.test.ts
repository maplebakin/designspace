import { afterEach, describe, expect, it, vi } from 'vitest';

const tauriMocks = vi.hoisted(() => ({
  save: vi.fn(),
  open: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: tauriMocks.open,
  save: tauriMocks.save,
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeFile: tauriMocks.writeFile,
}));

import {
  deliverFile,
  deliverFiles,
  ensureFileExtension,
} from '../src/editor/services/fileDeliveryService';

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
    document.body.innerHTML = '';
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

    expect(result).toEqual({ status: 'saved', fileName: 'Browser Export.png' });
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
      '/exports/design-space.png',
      expect.any(Uint8Array)
    );
    expect(Array.from(tauriMocks.writeFile.mock.calls[0][1] as Uint8Array)).toEqual([1, 2, 3]);
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

    await expect(deliverFile({
      content: new Blob(['zip']),
      fileName: 'project.zip',
      extension: 'zip',
    })).rejects.toThrow('Could not save project.zip: permission denied');
  });

  it('uses one Tauri folder picker and writes numbered all-page files', async () => {
    setTauriRuntime(true);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    tauriMocks.open.mockResolvedValue('/exports/pages');
    tauriMocks.writeFile.mockResolvedValue(undefined);

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
      '/exports/pages/book-page-01.png',
      '/exports/pages/book-page-02.png',
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

  it('replaces a user-selected mismatched extension without changing the basename', () => {
    expect(ensureFileExtension('/exports/family-history.jpg', 'png'))
      .toBe('/exports/family-history.png');
    expect(ensureFileExtension('/exports/family-history.apocaproject.json', 'apocaproject.json'))
      .toBe('/exports/family-history.apocaproject.json');
  });
});
