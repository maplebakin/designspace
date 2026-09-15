import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FabricImage, StaticCanvas, Rect } from 'fabric/node';
import { recordDiff } from '../src/editor/utils/diffSaver';
import {
  applyAssetRefCounts,
  useHistoryStore,
} from '../src/editor/state/useHistoryStore';
import { isSerializedImageObject } from '../src/editor/utils/serialization';

describe('history replay contract', () => {
  let canvas: StaticCanvas;

  beforeEach(() => {
    canvas = new StaticCanvas(null, {
      width: 800,
      height: 600,
      enableRetinaScaling: false,
      renderOnAddRemove: false,
    });
    useHistoryStore.getState().resetHistory();
    useHistoryStore.getState().setContext({
      getCanvas: () => canvas as any,
      getImageAssets: () => ({}),
      setImageAssets: () => undefined,
      getAssetRefCount: () => new Map(),
      setAssetRefCount: () => undefined,
      getDirtyObjectsRef: () => null,
      requestLayerSync: () => undefined,
      setSelectedObjectId: () => undefined,
      clearSelection: () => undefined,
      getBackground: () => undefined,
      setBackground: () => undefined,
    });
  });

  afterEach(() => {
    useHistoryStore.getState().resetHistory();
    useHistoryStore.getState().setContext(null as any);
    canvas.dispose();
  });

  it('records complete inverse data for stack order and property removal', () => {
    const before = [
      { id: 'first', type: 'rect', left: 1, tokenRole: 'primary' },
      { id: 'second', type: 'rect', left: 2 },
    ] as any;
    const after = [
      { id: 'second', type: 'rect', left: 2 },
      { id: 'first', type: 'rect', left: 3 },
    ] as any;
    const diff = recordDiff(before, after);

    expect(diff.order).toEqual({
      before: ['first', 'second'],
      after: ['second', 'first'],
    });
    expect(diff.changed[0]).toMatchObject({
      id: 'first',
      prev: { left: 1, tokenRole: 'primary' },
      next: { left: 3 },
      unsetNext: ['tokenRole'],
    });
  });

  it('replays a stacking-order change without losing the Fabric objects', async () => {
    const first = new Rect({ width: 40, height: 40, left: 20, top: 20 }) as any;
    const second = new Rect({ width: 40, height: 40, left: 80, top: 80 }) as any;
    first.id = 'stack-first';
    second.id = 'stack-second';
    canvas.add(first, second);
    useHistoryStore.getState().takeSnapshot();

    canvas.moveObjectTo(second, 0);
    useHistoryStore.getState().saveState({ force: true });
    expect(canvas.getObjects().map((object) => (object as any).id)).toEqual([
      'stack-second',
      'stack-first',
    ]);

    await useHistoryStore.getState().undo();
    expect(canvas.getObjects().map((object) => (object as any).id)).toEqual([
      'stack-first',
      'stack-second',
    ]);
    await useHistoryStore.getState().redo();
    expect(canvas.getObjects().map((object) => (object as any).id)).toEqual([
      'stack-second',
      'stack-first',
    ]);
  });

  it('keeps a reconstructable baseline while trimming and traverses every retained state', async () => {
    const object = new Rect({ width: 40, height: 40, left: 0, top: 0 }) as any;
    object.id = 'moving-rect';
    canvas.add(object);
    useHistoryStore.getState().takeSnapshot();

    for (let index = 1; index <= 60; index += 1) {
      object.set('left', index);
      useHistoryStore.getState().saveState({ force: true });
    }

    const history = useHistoryStore.getState();
    expect(history.historyLength()).toBe(50);
    expect(JSON.parse(history.getSnapshot(0) || '{}').type).toBe('full');

    for (let index = 0; index < 49; index += 1) {
      await history.undo();
    }
    expect(object.left).toBe(11);

    for (let index = 0; index < 49; index += 1) {
      await history.redo();
    }
    expect(object.left).toBe(60);
  });

  it('flushes the pending debounce so Edit then immediate Undo is not a no-op', async () => {
    const object = new Rect({ width: 40, height: 40, left: 0, top: 0 }) as any;
    object.id = 'immediate-undo';
    canvas.add(object);
    useHistoryStore.getState().takeSnapshot();
    object.set('left', 25);
    useHistoryStore.getState().markHistoryDirty();
    useHistoryStore.getState().saveState();

    await useHistoryStore.getState().undo();

    expect(object.left).toBe(0);
    expect(useHistoryStore.getState().historyIndex).toBe(0);
  });

  it('does not advance history or authored replay state when the sync lock is held', async () => {
    const object = new Rect({ width: 40, height: 40, left: 0, top: 0 }) as any;
    object.id = 'locked-replay';
    canvas.add(object);
    useHistoryStore.getState().takeSnapshot();
    object.set('left', 25);
    useHistoryStore.getState().saveState({ force: true });
    const beforeIndex = useHistoryStore.getState().historyIndex;
    const beforeLeft = object.left;
    useHistoryStore.setState({
      _context: {
        ...useHistoryStore.getState()._context!,
        acquireSyncLock: () => false,
      },
    });

    await expect(useHistoryStore.getState().undo()).resolves.toBe(false);
    expect(object.left).toBe(beforeLeft);
    expect(useHistoryStore.getState().historyIndex).toBe(beforeIndex);
  });

  it('releases discarded snapshot asset references without double-retaining a live image', () => {
    const source = new Rect({ width: 3, height: 3 });
    const image = new FabricImage(source, { left: 30, top: 30 }) as any;
    image.id = 'rebaseline-image';
    canvas.add(image);

    let imageAssets: Record<string, string> = {
      'rebaseline-image': 'blob:rebaseline-image',
    };
    let assetRefCount = new Map<string, number>([['rebaseline-image', 1]]);
    useHistoryStore.getState().setContext({
      ...useHistoryStore.getState()._context!,
      getImageAssets: () => imageAssets,
      setImageAssets: (assets) => { imageAssets = assets; },
      getAssetRefCount: () => assetRefCount,
      setAssetRefCount: (counts) => { assetRefCount = counts; },
    });

    const history = useHistoryStore.getState();
    history.takeSnapshot();
    expect(assetRefCount.get('rebaseline-image')).toBe(2);

    history.resetHistory();
    expect(assetRefCount.get('rebaseline-image')).toBe(1);
    expect(imageAssets['rebaseline-image']).toBe('blob:rebaseline-image');

    history.takeSnapshot();
    expect(assetRefCount.get('rebaseline-image')).toBe(2);
    history.resetHistory();
    expect(assetRefCount.get('rebaseline-image')).toBe(1);
  });

  it('fences a delayed undo replay after the page/session has been replaced', async () => {
    let scope: string | null = 'old-session/page-1';
    let lockOwner: 'undo' | 'redo' | null = null;
    let lockToken: object | null = null;
    let resolveRevival: ((objects: any[]) => void) | undefined;

    const object = new Rect({ width: 40, height: 40, left: 20, top: 20 }) as any;
    object.id = 'old-object';
    canvas.add(object);
    useHistoryStore.getState().takeSnapshot();
    const added = new Rect({ width: 30, height: 30, left: 100, top: 100 }) as any;
    added.id = 'added-object';
    canvas.add(added);
    useHistoryStore.getState().saveState({ force: true });

    useHistoryStore.setState({
      _context: {
        ...useHistoryStore.getState()._context!,
        getScope: () => scope,
        acquireSyncLock: (reason) => {
          if (lockOwner) return false;
          lockOwner = reason;
          lockToken = {};
          return true;
        },
        getSyncLockToken: () => lockToken,
        isSyncLockOwned: (reason, token) => lockOwner === reason && token === lockToken,
        releaseSyncLock: (_reason, token) => {
          if (token === lockToken) {
            lockOwner = null;
            lockToken = null;
          }
        },
        reviveObjects: () => new Promise((resolve) => {
          resolveRevival = resolve;
        }),
      },
    });

    try {
      const replay = useHistoryStore.getState().undo();
      await Promise.resolve();
      expect(lockOwner).toBe('undo');

      // The replacement deliberately reuses the same Fabric canvas, which is
      // the failure mode a scope-only check must protect.
      scope = 'new-session/page-1';
      lockOwner = 'redo';
      lockToken = {};
      canvas.clear();
      const replacement = new Rect({ width: 50, height: 50, left: 400, top: 400 }) as any;
      replacement.id = 'replacement-object';
      canvas.add(replacement);
      resolveRevival?.([]);

      await expect(replay).resolves.toBe(false);
      expect(canvas.getObjects().map((candidate) => (candidate as any).id)).toEqual([
        'replacement-object',
      ]);
      expect(useHistoryStore.getState().historyIndex).toBe(1);
      expect(lockOwner).toBe('redo');
    } finally {
      lockOwner = null;
      lockToken = null;
    }
  });

  it('rebases long mixed image history without retaining orphaned asset roots', () => {
    const imageA = new FabricImage(new Rect({ width: 3, height: 3 }), {
      left: 20,
      top: 20,
    }) as any;
    imageA.id = 'history-image-a';
    canvas.add(imageA);

    let imageAssets: Record<string, string> = {
      'history-image-a': 'blob:history-image-a',
      'history-image-b': 'blob:history-image-b',
    };
    let assetRefCount = new Map<string, number>([['history-image-a', 1]]);
    const context = useHistoryStore.getState()._context!;
    useHistoryStore.getState().setContext({
      ...context,
      getImageAssets: () => imageAssets,
      setImageAssets: (assets) => { imageAssets = assets; },
      getAssetRefCount: () => assetRefCount,
      setAssetRefCount: (counts) => { assetRefCount = counts; },
    });

    const adjustLiveRef = (id: string, delta: 1 | -1) => {
      const adjusted = applyAssetRefCounts(
        assetRefCount,
        imageAssets,
        new Map([[id, 1]]),
        delta,
      );
      assetRefCount = adjusted.nextRefCount;
      imageAssets = adjusted.nextAssets;
    };
    const countSnapshotImages = (snapshotString: string) => {
      const parsed = JSON.parse(snapshotString);
      let count = 0;
      const visit = (value: any) => {
        if (!value || typeof value !== 'object') return;
        if (isSerializedImageObject(value) && typeof value.id === 'string') count += 1;
        if (Array.isArray(value.objects)) value.objects.forEach(visit);
        if (Array.isArray(value.added)) value.added.forEach(visit);
        if (Array.isArray(value.removed)) value.removed.forEach(visit);
      };
      visit(parsed.data ?? parsed);
      return count;
    };

    const history = useHistoryStore.getState();
    history.takeSnapshot();
    const scalar = new Rect({ width: 20, height: 20, left: 60, top: 60 }) as any;
    scalar.id = 'history-scalar';
    canvas.add(scalar);
    for (let index = 1; index <= 60; index += 1) {
      scalar.set('left', index);
      if (index === 20) {
        canvas.remove(imageA);
        adjustLiveRef('history-image-a', -1);
        const imageB = new FabricImage(new Rect({ width: 4, height: 4 }), {
          left: 120,
          top: 120,
        }) as any;
        imageB.id = 'history-image-b';
        canvas.add(imageB);
        adjustLiveRef('history-image-b', 1);
      }
      if (index === 40) {
        const imageB = canvas.getObjects().find((object) => (object as any).id === 'history-image-b');
        if (imageB) canvas.remove(imageB);
        adjustLiveRef('history-image-b', -1);
        const replacement = new FabricImage(new Rect({ width: 5, height: 5 }), {
          left: 160,
          top: 160,
        }) as any;
        replacement.id = 'history-image-a';
        canvas.add(replacement);
        adjustLiveRef('history-image-a', 1);
      }
      history.saveState({ force: true });
    }

    expect(history.historyLength()).toBe(50);
    const snapshotImageCounts = new Map<string, number>();
    const currentHistory = useHistoryStore.getState();
    currentHistory._snapshots.forEach((snapshotString) => {
      const parsed = JSON.parse(snapshotString);
      const visit = (value: any) => {
        if (!value || typeof value !== 'object') return;
        if (isSerializedImageObject(value) && typeof value.id === 'string') {
          snapshotImageCounts.set(value.id, (snapshotImageCounts.get(value.id) ?? 0) + 1);
        }
        if (Array.isArray(value.objects)) value.objects.forEach(visit);
        if (Array.isArray(value.added)) value.added.forEach(visit);
        if (Array.isArray(value.removed)) value.removed.forEach(visit);
      };
      visit(parsed.data ?? parsed);
    });
    // The retained snapshot roots are compared against the live-canvas owner
    // below; use the current Zustand state after the final forced save.
    // Every retained snapshot root is represented exactly once, in addition
    // to the one live-canvas owner for the currently visible replacement.
    expect(assetRefCount.get('history-image-a')).toBe(
      (snapshotImageCounts.get('history-image-a') ?? 0) + 1,
    );
    expect(assetRefCount.has('history-image-b')).toBe(
      (snapshotImageCounts.get('history-image-b') ?? 0) > 0,
    );

    history.resetHistory();
    expect(assetRefCount).toEqual(new Map([['history-image-a', 1]]));
    expect(imageAssets).toEqual({ 'history-image-a': 'blob:history-image-a' });
  });

  it('replays authoritative page dimensions together with scene history', async () => {
    let canvasSize = { width: 800, height: 600 };
    useHistoryStore.getState().setContext({
      ...useHistoryStore.getState()._context!,
      getCanvasSize: () => canvasSize,
      setCanvasSize: (nextSize) => {
        canvasSize = { ...nextSize };
      },
    });

    const object = new Rect({ width: 40, height: 40, left: 80, top: 90 }) as any;
    object.id = 'page-size-object';
    canvas.add(object);
    useHistoryStore.getState().takeSnapshot();

    object.set({ left: 140 });
    useHistoryStore.getState().saveState({ force: true });
    canvasSize = { width: 1200, height: 900 };
    useHistoryStore.getState().saveState({ force: true });
    object.set({ left: 300, scaleX: 1.4, scaleY: 0.8 });
    canvasSize = { width: 1600, height: 1000 };
    useHistoryStore.getState().saveState({ force: true });

    expect(useHistoryStore.getState().historyLength()).toBe(4);

    await useHistoryStore.getState().undo();
    expect(canvasSize).toEqual({ width: 1200, height: 900 });
    expect((canvas.getObjects()[0] as any).left).toBeCloseTo(140, 5);
    expect((canvas.getObjects()[0] as any).scaleX).toBeCloseTo(1, 5);

    await useHistoryStore.getState().undo();
    expect(canvasSize).toEqual({ width: 800, height: 600 });
    expect((canvas.getObjects()[0] as any).left).toBeCloseTo(140, 5);

    await useHistoryStore.getState().redo();
    expect(canvasSize).toEqual({ width: 1200, height: 900 });
    await useHistoryStore.getState().redo();
    expect(canvasSize).toEqual({ width: 1600, height: 1000 });
    expect((canvas.getObjects()[0] as any).left).toBeCloseTo(300, 5);
    expect((canvas.getObjects()[0] as any).scaleX).toBeCloseTo(1.4, 5);
  });
});
