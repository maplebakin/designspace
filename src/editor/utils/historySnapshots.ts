/**
 * historySnapshots - Undo/redo history snapshots with visual thumbnails
 * Implements Task 14: Implement undo/redo history snapshots with visual thumbnails
 */

import * as fabric from 'fabric';

export interface HistorySnapshot {
  id: string;
  timestamp: number;
  thumbnail: string; // Data URL of the thumbnail
  description: string;
  canvasState: any; // Serialized canvas state
}

export class HistorySnapshotManager {
  private static instance: HistorySnapshotManager;
  private snapshots: HistorySnapshot[] = [];
  private currentIndex: number = -1;
  private maxSnapshots: number = 50; // Limit to prevent memory issues

  static getInstance(): HistorySnapshotManager {
    if (!HistorySnapshotManager.instance) {
      HistorySnapshotManager.instance = new HistorySnapshotManager();
    }
    return HistorySnapshotManager.instance;
  }

  /**
   * Capture a snapshot of the current canvas state
   */
  async captureSnapshot(canvas: fabric.Canvas, description: string = 'Action'): Promise<void> {
    // Create a thumbnail by rendering a small version of the canvas
    const thumbnail = await this.createThumbnail(canvas);
    
    // Serialize the canvas state
    const canvasState = await this.serializeCanvas(canvas);
    
    const snapshot: HistorySnapshot = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      thumbnail,
      description,
      canvasState,
    };

    // If we're not at the end of the history, truncate everything after current position
    if (this.currentIndex < this.snapshots.length - 1) {
      this.snapshots = this.snapshots.slice(0, this.currentIndex + 1);
    }

    // Add the new snapshot
    this.snapshots.push(snapshot);

    // If we exceed the max snapshots, remove the oldest ones
    if (this.snapshots.length > this.maxSnapshots) {
      const excess = this.snapshots.length - this.maxSnapshots;
      this.snapshots = this.snapshots.slice(excess);
      this.currentIndex = this.snapshots.length - 1;
    } else {
      this.currentIndex = this.snapshots.length - 1;
    }
  }

  /**
   * Create a thumbnail of the canvas
   */
  private async createThumbnail(canvas: fabric.Canvas): Promise<string> {
    // Create a temporary canvas for the thumbnail
    const canvasElement = document.createElement('canvas');
    canvasElement.width = 100; // Thumbnail width
    canvasElement.height = 100; // Thumbnail height

    const tempCanvas = new fabric.Canvas(canvasElement, {
      width: 100, // Thumbnail width
      height: 100, // Thumbnail height
    });

    // Clone objects from the original canvas
    const objects = canvas.getObjects();
    const clonedObjectsPromises: Promise<fabric.Object>[] = objects.map(async (obj: fabric.Object) => {
      // Clone the object
      const cloned = await new Promise<fabric.Object>((resolve) => {
        (obj.clone as any)(['id', 'tokenRole', 'colorLocked']).then((clonedObj: fabric.Object) => resolve(clonedObj));
      });

      // Scale the object to fit the thumbnail
      const scaleX = tempCanvas.width! / canvas.width!;
      const scaleY = tempCanvas.height! / canvas.height!;
      const scale = Math.min(scaleX, scaleY) * 0.8; // Leave some padding

      cloned.set({
        left: (cloned.left! * scale),
        top: (cloned.top! * scale),
        scaleX: (cloned.scaleX || 1) * scale,
        scaleY: (cloned.scaleY || 1) * scale,
        angle: cloned.angle,
      });

      return cloned;
    });

    const clonedObjects = await Promise.all(clonedObjectsPromises);

    // Add cloned objects to the temporary canvas
    clonedObjects.forEach(obj => tempCanvas.add(obj));
    
    // Set the background color to match the original canvas
    if (canvas.backgroundColor) {
      tempCanvas.backgroundColor = canvas.backgroundColor as any;
    }

    // Generate the data URL for the thumbnail
    const thumbnailDataUrl = tempCanvas.toDataURL({
      format: 'png',
      quality: 0.7,
      multiplier: 1,
    });

    // Clean up the temporary canvas
    tempCanvas.dispose();

    return thumbnailDataUrl;
  }

  /**
   * Serialize the canvas state
   */
  private async serializeCanvas(canvas: fabric.Canvas): Promise<any> {
    // Get all objects and serialize them
    const objects = canvas.getObjects();
    const serializedObjects = objects.map(obj => {
      // Use the existing serialization method
      return (obj as any).toObject(['id', 'tokenRole', 'colorLocked']);
    });

    return {
      objects: serializedObjects,
      backgroundColor: canvas.backgroundColor,
      width: canvas.width,
      height: canvas.height,
      viewportTransform: canvas.viewportTransform,
    };
  }

  /**
   * Restore canvas to a specific snapshot
   */
  async restoreSnapshot(canvas: fabric.Canvas, snapshotId: string): Promise<boolean> {
    const snapshotIndex = this.snapshots.findIndex(snap => snap.id === snapshotId);
    
    if (snapshotIndex === -1) {
      console.error(`Snapshot with ID ${snapshotId} not found`);
      return false;
    }

    const snapshot = this.snapshots[snapshotIndex];
    if (!snapshot) {
      console.error(`Snapshot with ID ${snapshotId} not found`);
      return false;
    }

    try {
      // Clear the current canvas
      canvas.clear();

      // Set canvas properties from the snapshot
      canvas.backgroundColor = snapshot.canvasState.backgroundColor;
      canvas.setWidth(snapshot.canvasState.width);
      canvas.setHeight(snapshot.canvasState.height);

      // Set viewport transform
      if (snapshot.canvasState.viewportTransform) {
        canvas.setViewportTransform(snapshot.canvasState.viewportTransform);
      }

      // Load objects from the snapshot
      for (const objData of snapshot.canvasState.objects) {
        try {
          // Create object from JSON data
          const obj = await new Promise<fabric.Object>((resolve, reject) => {
            (fabric.util.enlivenObjects as any)([objData], (enlivenedObjects: fabric.Object[]) => {
              if (enlivenedObjects && enlivenedObjects.length > 0 && enlivenedObjects[0]) {
                resolve(enlivenedObjects[0]);
              } else {
                reject(new Error('Could not create object from data'));
              }
            });
          });

          canvas.add(obj);
        } catch (error) {
          console.error('Error restoring object:', error);
          // Continue with other objects
        }
      }

      canvas.renderAll();
      this.currentIndex = snapshotIndex;

      return true;
    } catch (error) {
      console.error('Error restoring snapshot:', error);
      return false;
    }
  }

  /**
   * Undo to the previous snapshot
   */
  async undo(canvas: fabric.Canvas): Promise<boolean> {
    if (this.currentIndex <= 0) {
      console.log('No more undo steps available');
      return false;
    }

    const previousSnapshot = this.snapshots[this.currentIndex - 1];
    if (!previousSnapshot) {
      return false;
    }

    const success = await this.restoreSnapshot(canvas, previousSnapshot.id);
    if (success) {
      this.currentIndex--;
    }

    return success;
  }

  /**
   * Redo to the next snapshot
   */
  async redo(canvas: fabric.Canvas): Promise<boolean> {
    if (this.currentIndex >= this.snapshots.length - 1) {
      console.log('No more redo steps available');
      return false;
    }

    const nextSnapshot = this.snapshots[this.currentIndex + 1];
    if (!nextSnapshot) {
      return false;
    }

    const success = await this.restoreSnapshot(canvas, nextSnapshot.id);
    if (success) {
      this.currentIndex++;
    }

    return success;
  }

  /**
   * Get all snapshots
   */
  getSnapshots(): HistorySnapshot[] {
    return [...this.snapshots]; // Return a copy to prevent external mutations
  }

  /**
   * Get the current snapshot index
   */
  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * Get the current snapshot
   */
  getCurrentSnapshot(): HistorySnapshot | null {
    if (this.currentIndex >= 0 && this.currentIndex < this.snapshots.length) {
      return this.snapshots[this.currentIndex];
    }
    return null;
  }

  /**
   * Clear all snapshots
   */
  clearHistory(): void {
    this.snapshots = [];
    this.currentIndex = -1;
  }

  /**
   * Get the number of snapshots
   */
  getSnapshotCount(): number {
    return this.snapshots.length;
  }

  /**
   * Check if undo is possible
   */
  canUndo(): boolean {
    return this.currentIndex > 0;
  }

  /**
   * Check if redo is possible
   */
  canRedo(): boolean {
    return this.currentIndex < this.snapshots.length - 1;
  }
}

// Create a singleton instance
export const historySnapshotManager = HistorySnapshotManager.getInstance();