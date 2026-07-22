import { describe, expect, it, vi } from 'vitest';
import {
  isCanvasHydrating,
  loadCanvasFromJsonSafely,
} from '../src/editor/fabric/initFabricCanvas';
import { registerObjectEventHandlers } from '../src/editor/services/canvasEventService';

type Listener = (event: { target?: Record<string, unknown> }) => void;

const createCanvasHarness = () => {
  const listeners = new Map<string, Listener>();
  const canvas = {
    on: vi.fn((name: string, listener: Listener) => listeners.set(name, listener)),
    off: vi.fn((name: string) => listeners.delete(name)),
    getObjects: vi.fn(() => []),
    loadFromJSON: vi.fn(async () => {
      listeners.get('object:added')?.({ target: { id: 'loaded', type: 'rect' } });
      listeners.get('object:removed')?.({ target: { id: 'old', type: 'rect' } });
    }),
  };
  return { canvas, listeners };
};

describe('Fabric hydration event isolation', () => {
  it('does not turn loadFromJSON object events into persistent user mutations', async () => {
    const { canvas, listeners } = createCanvasHarness();
    const onUpdate = vi.fn();
    const onHistoryDirty = vi.fn();
    const registry = registerObjectEventHandlers({
      canvas: canvas as any,
      callbacks: { onUpdate, onHistoryDirty },
    });

    await loadCanvasFromJsonSafely(canvas as any, { objects: [] });

    expect(onUpdate).not.toHaveBeenCalled();
    expect(onHistoryDirty).not.toHaveBeenCalled();
    expect(isCanvasHydrating(canvas as any)).toBe(false);

    listeners.get('object:added')?.({ target: { id: 'user-shape', type: 'rect' } });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    registry.cleanup();
  });

  it('clears the hydration guard when Fabric rejects malformed data', async () => {
    const canvas = {
      loadFromJSON: vi.fn().mockRejectedValue(new Error('invalid canvas JSON')),
    };

    await expect(loadCanvasFromJsonSafely(canvas as any, { objects: [] }))
      .rejects.toThrow('invalid canvas JSON');
    expect(isCanvasHydrating(canvas as any)).toBe(false);
  });
});
