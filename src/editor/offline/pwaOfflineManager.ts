import { openDB } from 'idb';
import type { SerializedFabricObject } from '../state/editorStore';

type OfflineSnapshot = {
  projectName: string;
  canvasObjects: SerializedFabricObject[];
  savedAt: string;
};

const DB_NAME = 'design-space-offline';
const STORE_NAME = 'editor-state';
const SNAPSHOT_KEY = 'latest';

export class PwaOfflineManager {
  async registerServiceWorker(): Promise<void> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch (error) {
      console.warn('Failed to register service worker', error);
    }
  }

  async saveOfflineState(state: OfflineSnapshot): Promise<void> {
    const db = await openDB(DB_NAME, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      },
    });
    await db.put(STORE_NAME, state, SNAPSHOT_KEY);
  }

  async loadOfflineState(): Promise<OfflineSnapshot | null> {
    const db = await openDB(DB_NAME, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      },
    });
    return (await db.get(STORE_NAME, SNAPSHOT_KEY)) ?? null;
  }

  async hasOfflineState(): Promise<boolean> {
    return (await this.loadOfflineState()) !== null;
  }
}

export const pwaOfflineManager = new PwaOfflineManager();
