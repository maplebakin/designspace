import { createWithEqualityFn } from 'zustand/traditional';
import { DEFAULT_CANVAS_SIZE } from './canvasDefaults';

/**
 * Runtime page geometry for the active Fabric canvas. `width` and `height`
 * are authored logical page pixels, not viewport CSS dimensions. The active
 * ProjectPage/page snapshot is the durable mirror; persistence, history, and
 * export cross that boundary through a typed scene snapshot rather than
 * treating this store as a second durable record.
 */
interface CanvasState {
    width: number;
    height: number;
    hasPendingSize: boolean;
    setCanvasSize: (width: number, height: number) => void;
    consumePendingSize: () => { width: number; height: number } | null;
    clearPendingSize: () => void;
}

export const useCanvasStore = createWithEqualityFn<CanvasState>()((set, get) => ({
    width: DEFAULT_CANVAS_SIZE.width,
    height: DEFAULT_CANVAS_SIZE.height,
    hasPendingSize: false,
    setCanvasSize: (width, height) =>
        set({
            width,
            height,
            hasPendingSize: true,
        }),
    consumePendingSize: () => {
        const { width, height, hasPendingSize } = get();
        if (!hasPendingSize) return null;
        set({ hasPendingSize: false });
        return { width, height };
    },
    clearPendingSize: () => set({ hasPendingSize: false }),
}));
