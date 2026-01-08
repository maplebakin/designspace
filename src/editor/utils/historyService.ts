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
      return false;
    }
    lastSnapshotAt = now;
    const trimmed = snapshots.slice(0, currentIndex + 1);
    trimmed.push(snapshot);
    if (trimmed.length > MAX_HISTORY_SIZE) {
      trimmed.shift();
    }
    snapshots = trimmed;
    currentIndex = snapshots.length - 1;
    return true;
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
