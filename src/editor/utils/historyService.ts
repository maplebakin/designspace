const MAX_HISTORY_SIZE = 50;
const SNAPSHOT_THROTTLE_MS = 2000;

let snapshots: string[] = [];
let currentIndex = -1;
let lastSnapshotAt = 0;

type PushOptions = {
  force?: boolean;
};

export const historyService = {
  get currentIndex() {
    return currentIndex;
  },
  get length() {
    return snapshots.length;
  },
  pushSnapshot(snapshot: string, options: PushOptions = {}) {
    const now = Date.now();
    if (!options.force && now - lastSnapshotAt < SNAPSHOT_THROTTLE_MS) {
      return { pushed: false, dropped: [] as string[] };
    }
    lastSnapshotAt = now;
    const dropped: string[] = snapshots.slice(currentIndex + 1);
    const trimmed = snapshots.slice(0, currentIndex + 1);
    trimmed.push(snapshot);
    if (trimmed.length > MAX_HISTORY_SIZE) {
      while (trimmed.length > MAX_HISTORY_SIZE) {
        const removed = trimmed.shift();
        if (removed) dropped.push(removed);
      }
    }
    snapshots = trimmed;
    currentIndex = snapshots.length - 1;
    return { pushed: true, dropped };
  },
  reset() {
    snapshots = [];
    currentIndex = -1;
    lastSnapshotAt = 0;
  },
  getSnapshot(index: number) {
    return snapshots[index] ?? null;
  },
  canUndo() {
    return currentIndex > 0;
  },
  canRedo() {
    return currentIndex < snapshots.length - 1;
  },
  undo() {
    if (!this.canUndo()) return null;
    currentIndex -= 1;
    return snapshots[currentIndex] ?? null;
  },
  redo() {
    if (!this.canRedo()) return null;
    currentIndex += 1;
    return snapshots[currentIndex] ?? null;
  },
};
