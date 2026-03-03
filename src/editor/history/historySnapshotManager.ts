import type { SerializedFabricObject } from '../state/editorStore';

const cloneSnapshot = (snapshot: SerializedFabricObject[]) =>
  JSON.parse(JSON.stringify(snapshot)) as SerializedFabricObject[];

export class HistorySnapshotManager {
  private snapshots: SerializedFabricObject[][] = [];
  private index = -1;

  pushSnapshot(state: SerializedFabricObject[]): SerializedFabricObject[] {
    const nextSnapshot = cloneSnapshot(state);
    const previousSnapshot = this.snapshots[this.index];
    if (previousSnapshot && JSON.stringify(previousSnapshot) === JSON.stringify(nextSnapshot)) {
      return cloneSnapshot(previousSnapshot);
    }

    this.snapshots = this.snapshots.slice(0, this.index + 1);
    this.snapshots.push(nextSnapshot);
    this.index = this.snapshots.length - 1;
    return cloneSnapshot(nextSnapshot);
  }

  undo(): SerializedFabricObject[] | null {
    if (this.index <= 0) {
      return null;
    }
    this.index -= 1;
    return cloneSnapshot(this.snapshots[this.index]);
  }

  redo(): SerializedFabricObject[] | null {
    if (this.index >= this.snapshots.length - 1) {
      return null;
    }
    this.index += 1;
    return cloneSnapshot(this.snapshots[this.index]);
  }

  clear(): void {
    this.snapshots = [];
    this.index = -1;
  }

  canUndo(): boolean {
    return this.index > 0;
  }

  canRedo(): boolean {
    return this.index >= 0 && this.index < this.snapshots.length - 1;
  }

  getCurrent(): SerializedFabricObject[] | null {
    if (this.index < 0) {
      return null;
    }
    return cloneSnapshot(this.snapshots[this.index]);
  }
}

export const historySnapshotManager = new HistorySnapshotManager();
