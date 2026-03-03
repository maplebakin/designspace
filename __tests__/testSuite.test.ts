import { describe, it, expect, vi } from 'vitest';
import {
  validateFileType,
  validateFileSize,
  parseJSON,
  validateThemeSchema,
  validateThemeFile,
  validateThemeFiles,
} from '../src/editor/services/themeValidationService';
import {
  validateCanvas,
  validateCanvasContent,
  validateDataURL,
  generateFileName,
  formatFileSize,
  calculateExportDimensions,
  validateExportOptions,
} from '../src/editor/services/exportService';
import { formatInches, convertDimensions } from '../src/editor/utils/units';
import { FrameScheduler, TaskPriority } from '../src/editor/utils/frameScheduler';
import { enforceSerializedZOrder, ZIndexLayer } from '../src/editor/fabric/zIndexManifest';
import { HistorySnapshotManager } from '../src/editor/history/historySnapshotManager';
import { applySuggestionToObjects, generateSuggestions } from '../src/editor/utils/aiLayoutSuggestions';

vi.mock('../src/editor/state/editorStore', () => ({
  useEditorStore: { setState: vi.fn() },
}));

import { CoordinateSystem } from '../src/editor/utils/coordinateSystem';

describe('theme validation service', () => {
  it('validates schema via meta.name', () => {
    const result = validateThemeSchema({ meta: { name: 'Aurora' } }, ['name']);
    expect(result.success).toBe(true);
  });

  it('rejects non-json extension', () => {
    const file = new File(['x'], 'theme.txt', { type: 'text/plain' });
    const result = validateFileType(file);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_FILE_TYPE');
  });

  it('rejects oversized files', () => {
    const file = new File([new ArrayBuffer(2048)], 'theme.json', { type: 'application/json' });
    const result = validateFileSize(file, 1024);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FILE_TOO_LARGE');
  });

  it('parses valid json', () => {
    const parsed = parseJSON('{"ok":true}');
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ ok: true });
  });

  it('validates a valid theme file end-to-end', async () => {
    const file = new File([JSON.stringify({ meta: { name: 'Moon Theme' } })], 'theme.json', {
      type: 'application/json',
    });
    const result = await validateThemeFile(file);
    expect(result.success).toBe(true);
    expect((result.data?.parsed as any)?.meta?.name).toBe('Moon Theme');
  });

  it('validates multiple files', async () => {
    const files = [
      new File([JSON.stringify({ meta: { name: 'A' } })], 'a.json', { type: 'application/json' }),
      new File([JSON.stringify({ meta: { name: 'B' } })], 'b.json', { type: 'application/json' }),
    ];
    const results = await validateThemeFiles(files);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });
});

describe('export service', () => {
  const mockCanvas = {
    getObjects: vi.fn(() => [{ id: 1 }]),
    getWidth: vi.fn(() => 800),
    getHeight: vi.fn(() => 600),
  } as any;

  it('validates canvas and content', () => {
    expect(validateCanvas(mockCanvas).success).toBe(true);
    expect(validateCanvasContent(mockCanvas).success).toBe(true);
    expect(validateCanvas(null).success).toBe(false);
  });

  it('validates data urls', () => {
    expect(validateDataURL('data:image/png;base64,AAAA').success).toBe(true);
    expect(validateDataURL('bad').success).toBe(false);
  });

  it('generates filename with date stamp', () => {
    const name = generateFileName('design', 'png');
    expect(name).toMatch(/^design-\d{4}-\d{2}-\d{2}\.png$/);
  });

  it('formats file sizes with compact formatting', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1 MB');
  });

  it('calculates export dimensions', () => {
    expect(calculateExportDimensions(mockCanvas, 2)).toEqual({ width: 1600, height: 1200 });
  });

  it('validates export options', () => {
    expect(validateExportOptions({ format: 'png', multiplier: 2 }).success).toBe(true);
    expect(validateExportOptions({ format: 'jpeg', quality: 101 }).success).toBe(false);
  });
});

describe('units + coordinate system', () => {
  it('converts dimensions between units', () => {
    const d = convertDimensions({ width: 8.5, height: 11, fromUnit: 'in', toUnit: 'px' });
    expect(Math.round(d.width)).toBe(2550);
    expect(Math.round(d.height)).toBe(3300);
  });

  it('formats inches cleanly', () => {
    expect(formatInches(2)).toBe('2');
    expect(formatInches(2.5)).toBe('2.5');
  });

  it('supports lock + mode changes and conversion', () => {
    const cs = new CoordinateSystem('in');
    expect(cs.toCanvas(2)).toBe(600);
    expect(cs.fromCanvas(600)).toBe(2);

    cs.lock();
    expect(() => cs.setMode('cm')).toThrow();
    cs.unlock();
    expect(() => cs.setMode('cm')).not.toThrow();
  });
});

describe('frame scheduler', () => {
  it('runs higher priority tasks first', () => {
    const scheduler = new FrameScheduler();
    const order: string[] = [];
    const originalRAF = globalThis.requestAnimationFrame;
    let rafCallback: FrameRequestCallback | null = null;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      rafCallback = callback;
      return 1;
    }) as typeof requestAnimationFrame;

    scheduler.scheduleTask(() => order.push('low'), TaskPriority.Low);
    scheduler.scheduleTask(() => order.push('high'), TaskPriority.High);
    rafCallback?.(0);

    expect(order).toEqual(['high', 'low']);
    globalThis.requestAnimationFrame = originalRAF;
  });
});

describe('z-index manifest', () => {
  it('sorts serialized objects by manifest z-index', () => {
    const ordered = enforceSerializedZOrder([
      { id: 'content', type: 'rect', zIndex: ZIndexLayer.Content },
      { id: 'guide', type: 'line', isGuide: true },
      { id: 'paper', type: 'rect', isDocumentPaper: true },
    ] as any);

    expect(ordered.map((entry) => entry.id)).toEqual(['paper', 'content', 'guide']);
  });
});

describe('history snapshot manager', () => {
  it('supports push, undo, and redo', () => {
    const manager = new HistorySnapshotManager();
    manager.pushSnapshot([{ id: 'one', type: 'rect' }] as any);
    manager.pushSnapshot([{ id: 'two', type: 'rect' }] as any);

    expect(manager.undo()?.[0]?.id).toBe('one');
    expect(manager.redo()?.[0]?.id).toBe('two');
  });
});

describe('ai layout suggestions', () => {
  it('generates and applies suggestion patches', () => {
    const objects = [
      { id: 'a', type: 'rect', left: 20, top: 20, width: 100, height: 100 },
      { id: 'b', type: 'rect', left: 40, top: 40, width: 100, height: 100 },
    ] as any;

    const suggestions = generateSuggestions(objects, { width: 400, height: 400 });
    expect(suggestions.length).toBeGreaterThan(0);

    const updated = applySuggestionToObjects(objects, suggestions[0]);
    expect(updated).not.toEqual(objects);
  });
});
