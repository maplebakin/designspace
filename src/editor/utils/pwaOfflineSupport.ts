/**
 * pwaOfflineSupport - PWA with offline support
 * Implements Task 15: Create PWA with offline support
 */


export interface OfflineProject {
  id: string;
  name: string;
  data: string; // Serialized canvas data
  thumbnail: string; // Data URL of thumbnail
  lastModified: Date;
  size: number; // Size in bytes
  tags?: string[];
}

export interface OfflineAsset {
  id: string;
  name: string;
  url: string; // Local URL for offline access
  type: 'image' | 'template' | 'sticker' | 'font' | 'theme';
  size: number;
  lastAccessed: Date;
}

export interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  lastSync: Date | null;
  pendingOperations: number;
  syncProgress: number; // 0-100
}

export class PwaOfflineManager {
  private static instance: PwaOfflineManager;
  private db: IDBDatabase | null = null;
  private dbName: string = 'DesignSpaceOfflineDB';
  private dbVersion: number = 1;
  private syncStatus: SyncStatus = {
    isOnline: navigator.onLine,
    isSyncing: false,
    lastSync: null,
    pendingOperations: 0,
    syncProgress: 0
  };
  private syncCallbacks: Set<(status: SyncStatus) => void> = new Set();

  static getInstance(): PwaOfflineManager {
    if (!PwaOfflineManager.instance) {
      PwaOfflineManager.instance = new PwaOfflineManager();
    }
    return PwaOfflineManager.instance;
  }

  constructor() {
    this.initializeDatabase();
    this.setupOnlineStatusListener();
    this.registerServiceWorker();
  }

  /**
   * Initialize IndexedDB for offline storage
   */
  private async initializeDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('IndexedDB opened successfully');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create projects store
        if (!db.objectStoreNames.contains('projects')) {
          const projectStore = db.createObjectStore('projects', { keyPath: 'id' });
          projectStore.createIndex('name', 'name', { unique: false });
          projectStore.createIndex('lastModified', 'lastModified', { unique: false });
        }

        // Create assets store
        if (!db.objectStoreNames.contains('assets')) {
          const assetStore = db.createObjectStore('assets', { keyPath: 'id' });
          assetStore.createIndex('name', 'name', { unique: false });
          assetStore.createIndex('type', 'type', { unique: false });
          assetStore.createIndex('lastAccessed', 'lastAccessed', { unique: false });
        }

        // Create sync queue store
        if (!db.objectStoreNames.contains('syncQueue')) {
          const syncStore = db.createObjectStore('syncQueue', { keyPath: 'id' });
          syncStore.createIndex('timestamp', 'timestamp', { unique: false });
          syncStore.createIndex('operation', 'operation', { unique: false });
        }

        console.log('IndexedDB stores created');
      };
    });
  }

  /**
   * Set up online/offline status listener
   */
  private setupOnlineStatusListener(): void {
    window.addEventListener('online', () => {
      this.syncStatus.isOnline = true;
      this.notifySyncStatusChange();
      this.processSyncQueue();
    });

    window.addEventListener('offline', () => {
      this.syncStatus.isOnline = false;
      this.notifySyncStatusChange();
    });
  }

  /**
   * Register service worker for caching
   */
  private registerServiceWorker(): void {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then((registration) => {
            console.log('SW registered: ', registration);
          })
          .catch((registrationError) => {
            console.log('SW registration failed: ', registrationError);
          });
      });
    }
  }

  /**
   * Save project for offline access
   */
  async saveProjectOffline(project: Omit<OfflineProject, 'size'>): Promise<boolean> {
    if (!this.db) {
      console.error('Database not initialized');
      return false;
    }

    try {
      const transaction = this.db.transaction(['projects'], 'readwrite');
      const store = transaction.objectStore('projects');

      // Calculate size of the project data
      const size = new Blob([project.data]).size;

      const offlineProject: OfflineProject = {
        ...project,
        size,
      };

      const request = store.put(offlineProject);

      return new Promise<boolean>((resolve) => {
        request.onsuccess = () => {
          console.log(`Project saved offline: ${project.name}`);
          resolve(true);
        };

        request.onerror = () => {
          console.error('Failed to save project offline:', request.error);
          resolve(false);
        };
      });
    } catch (error) {
      console.error('Error saving project offline:', error);
      return false;
    }
  }

  /**
   * Load project from offline storage
   */
  async loadProjectOffline(projectId: string): Promise<OfflineProject | null> {
    if (!this.db) {
      console.error('Database not initialized');
      return null;
    }

    try {
      const transaction = this.db.transaction(['projects'], 'readonly');
      const store = transaction.objectStore('projects');

      const request = store.get(projectId);

      return new Promise<OfflineProject | null>((resolve) => {
        request.onsuccess = () => {
          const project = request.result;
          if (project) {
            console.log(`Project loaded from offline storage: ${project.name}`);
            
            // Update last accessed time
            this.updateProjectAccessTime(projectId);
          }
          resolve(project || null);
        };

        request.onerror = () => {
          console.error('Failed to load project from offline storage:', request.error);
          resolve(null);
        };
      });
    } catch (error) {
      console.error('Error loading project from offline storage:', error);
      return null;
    }
  }

  /**
   * Update project access time
   */
  private async updateProjectAccessTime(projectId: string): Promise<void> {
    if (!this.db) return;

    try {
      const transaction = this.db.transaction(['projects'], 'readwrite');
      const store = transaction.objectStore('projects');

      const getRequest = store.get(projectId);
      getRequest.onsuccess = () => {
        const project = getRequest.result;
        if (project) {
          project.lastModified = new Date();
          store.put(project);
        }
      };
    } catch (error) {
      console.error('Error updating project access time:', error);
    }
  }

  /**
   * Save asset for offline access
   */
  async saveAssetOffline(asset: Omit<OfflineAsset, 'size' | 'url'>, file: File): Promise<OfflineAsset | null> {
    if (!this.db) {
      console.error('Database not initialized');
      return null;
    }

    try {
      // Store the file in IndexedDB or cache API
      const fileUrl = await this.storeFileLocally(file, asset.id);
      if (!fileUrl) return null;

      const transaction = this.db.transaction(['assets'], 'readwrite');
      const store = transaction.objectStore('assets');

      const offlineAsset: OfflineAsset = {
        ...asset,
        url: fileUrl,
        size: file.size,
        lastAccessed: new Date(),
      };

      const request = store.put(offlineAsset);

      return new Promise<OfflineAsset | null>((resolve) => {
        request.onsuccess = () => {
          console.log(`Asset saved offline: ${asset.name}`);
          resolve(offlineAsset);
        };

        request.onerror = () => {
          console.error('Failed to save asset offline:', request.error);
          resolve(null);
        };
      });
    } catch (error) {
      console.error('Error saving asset offline:', error);
      return null;
    }
  }

  /**
   * Store file locally using Cache API or IndexedDB
   */
  private async storeFileLocally(file: File, fileId: string): Promise<string | null> {
    try {
      // Use Cache API if available
      if ('caches' in window) {
        const cache = await caches.open('designspace-assets');
        await cache.put(`/offline-assets/${fileId}`, new Response(await file.arrayBuffer()));
        return `/offline-assets/${fileId}`;
      } else {
        // Fallback to storing in IndexedDB as blob
        // This is more complex and would require a separate implementation
        console.warn('Cache API not available, falling back to IndexedDB storage');
        return null;
      }
    } catch (error) {
      console.error('Error storing file locally:', error);
      return null;
    }
  }

  /**
   * Load asset from offline storage
   */
  async loadAssetOffline(assetId: string): Promise<OfflineAsset | null> {
    if (!this.db) {
      console.error('Database not initialized');
      return null;
    }

    try {
      const transaction = this.db.transaction(['assets'], 'readonly');
      const store = transaction.objectStore('assets');

      const request = store.get(assetId);

      return new Promise<OfflineAsset | null>((resolve) => {
        request.onsuccess = () => {
          const asset = request.result;
          if (asset) {
            console.log(`Asset loaded from offline storage: ${asset.name}`);
            
            // Update last accessed time
            this.updateAssetAccessTime(assetId);
          }
          resolve(asset || null);
        };

        request.onerror = () => {
          console.error('Failed to load asset from offline storage:', request.error);
          resolve(null);
        };
      });
    } catch (error) {
      console.error('Error loading asset from offline storage:', error);
      return null;
    }
  }

  /**
   * Update asset access time
   */
  private async updateAssetAccessTime(assetId: string): Promise<void> {
    if (!this.db) return;

    try {
      const transaction = this.db.transaction(['assets'], 'readwrite');
      const store = transaction.objectStore('assets');

      const getRequest = store.get(assetId);
      getRequest.onsuccess = () => {
        const asset = getRequest.result;
        if (asset) {
          asset.lastAccessed = new Date();
          store.put(asset);
        }
      };
    } catch (error) {
      console.error('Error updating asset access time:', error);
    }
  }

  /**
   * Get all offline projects
   */
  async getOfflineProjects(): Promise<OfflineProject[]> {
    if (!this.db) {
      console.error('Database not initialized');
      return [];
    }

    try {
      const transaction = this.db.transaction(['projects'], 'readonly');
      const store = transaction.objectStore('projects');

      const request = store.getAll();

      return new Promise<OfflineProject[]>((resolve) => {
        request.onsuccess = () => {
          const projects = request.result;
          console.log(`Retrieved ${projects.length} offline projects`);
          resolve(projects);
        };

        request.onerror = () => {
          console.error('Failed to get offline projects:', request.error);
          resolve([]);
        };
      });
    } catch (error) {
      console.error('Error getting offline projects:', error);
      return [];
    }
  }

  /**
   * Get all offline assets
   */
  async getOfflineAssets(): Promise<OfflineAsset[]> {
    if (!this.db) {
      console.error('Database not initialized');
      return [];
    }

    try {
      const transaction = this.db.transaction(['assets'], 'readonly');
      const store = transaction.objectStore('assets');

      const request = store.getAll();

      return new Promise<OfflineAsset[]>((resolve) => {
        request.onsuccess = () => {
          const assets = request.result;
          console.log(`Retrieved ${assets.length} offline assets`);
          resolve(assets);
        };

        request.onerror = () => {
          console.error('Failed to get offline assets:', request.error);
          resolve([]);
        };
      });
    } catch (error) {
      console.error('Error getting offline assets:', error);
      return [];
    }
  }

  /**
   * Delete offline project
   */
  async deleteOfflineProject(projectId: string): Promise<boolean> {
    if (!this.db) {
      console.error('Database not initialized');
      return false;
    }

    try {
      const transaction = this.db.transaction(['projects'], 'readwrite');
      const store = transaction.objectStore('projects');

      const request = store.delete(projectId);

      return new Promise<boolean>((resolve) => {
        request.onsuccess = () => {
          console.log(`Offline project deleted: ${projectId}`);
          resolve(true);
        };

        request.onerror = () => {
          console.error('Failed to delete offline project:', request.error);
          resolve(false);
        };
      });
    } catch (error) {
      console.error('Error deleting offline project:', error);
      return false;
    }
  }

  /**
   * Delete offline asset
   */
  async deleteOfflineAsset(assetId: string): Promise<boolean> {
    if (!this.db) {
      console.error('Database not initialized');
      return false;
    }

    try {
      const transaction = this.db.transaction(['assets'], 'readwrite');
      const store = transaction.objectStore('assets');

      const request = store.delete(assetId);

      return new Promise<boolean>((resolve) => {
        request.onsuccess = () => {
          console.log(`Offline asset deleted: ${assetId}`);
          resolve(true);
        };

        request.onerror = () => {
          console.error('Failed to delete offline asset:', request.error);
          resolve(false);
        };
      });
    } catch (error) {
      console.error('Error deleting offline asset:', error);
      return false;
    }
  }

  /**
   * Add operation to sync queue
   */
  async addToSyncQueue(operation: string, data: any): Promise<boolean> {
    if (!this.db) {
      console.error('Database not initialized');
      return false;
    }

    try {
      const transaction = this.db.transaction(['syncQueue'], 'readwrite');
      const store = transaction.objectStore('syncQueue');

      const syncItem = {
        id: `${Date.now()}-${Math.random()}`,
        operation,
        data,
        timestamp: new Date(),
        synced: false
      };

      const request = store.add(syncItem);

      return new Promise<boolean>((resolve) => {
        request.onsuccess = () => {
          console.log(`Added operation to sync queue: ${operation}`);
          this.syncStatus.pendingOperations += 1;
          this.notifySyncStatusChange();
          resolve(true);
        };

        request.onerror = () => {
          console.error('Failed to add to sync queue:', request.error);
          resolve(false);
        };
      });
    } catch (error) {
      console.error('Error adding to sync queue:', error);
      return false;
    }
  }

  /**
   * Process sync queue when online
   */
  async processSyncQueue(): Promise<void> {
    if (!this.db || !this.syncStatus.isOnline) {
      return;
    }

    try {
      const transaction = this.db.transaction(['syncQueue'], 'readwrite');
      const store = transaction.objectStore('syncQueue');

      // Get all unsynced items
      const index = store.index('timestamp');
      const range = IDBKeyRange.lowerBound(0); // All items
      const request = index.openCursor(range);

      return new Promise<void>((resolve) => {
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            const syncItem = cursor.value;
            if (!syncItem.synced) {
              // Process the sync operation
              this.executeSyncOperation(syncItem.operation, syncItem.data)
                .then(success => {
                  if (success) {
                    // Mark as synced
                    syncItem.synced = true;
                    cursor.update(syncItem);
                    this.syncStatus.pendingOperations -= 1;
                    this.syncStatus.syncProgress = Math.min(100, this.syncStatus.syncProgress + (100 / this.syncStatus.pendingOperations));
                    this.notifySyncStatusChange();
                  }
                })
                .catch(error => {
                  console.error('Sync operation failed:', error);
                });

              cursor.continue();
            } else {
              cursor.continue();
            }
          } else {
            // All items processed
            this.syncStatus.lastSync = new Date();
            this.syncStatus.isSyncing = false;
            this.syncStatus.syncProgress = 100;
            this.notifySyncStatusChange();
            resolve();
          }
        };

        request.onerror = () => {
          console.error('Failed to process sync queue:', request.error);
          resolve();
        };
      });
    } catch (error) {
      console.error('Error processing sync queue:', error);
    }
  }

  /**
   * Execute a sync operation
   */
  private async executeSyncOperation(operation: string, data: any): Promise<boolean> {
    try {
      // In a real implementation, this would sync with a server
      console.log(`Executing sync operation: ${operation}`, data);
      
      // Simulate network request
      await new Promise(resolve => setTimeout(resolve, 500));
      
      return true;
    } catch (error) {
      console.error(`Failed to execute sync operation ${operation}:`, error);
      return false;
    }
  }

  /**
   * Get sync status
   */
  getSyncStatus(): SyncStatus {
    return { ...this.syncStatus };
  }

  /**
   * Subscribe to sync status changes
   */
  subscribeToSyncStatus(callback: (status: SyncStatus) => void): () => void {
    this.syncCallbacks.add(callback);

    // Return unsubscribe function
    return () => {
      this.syncCallbacks.delete(callback);
    };
  }

  /**
   * Notify sync status change
   */
  private notifySyncStatusChange(): void {
    this.syncCallbacks.forEach(callback => callback(this.syncStatus));
  }

  /**
   * Preload assets for offline use
   */
  async preloadAssets(assetIds: string[]): Promise<void> {
    console.log(`Preloading ${assetIds.length} assets for offline use`);
    
    // In a real implementation, this would download and cache the assets
    // For now, just log the operation
    for (const id of assetIds) {
      console.log(`Preloading asset: ${id}`);
    }
  }

  /**
   * Clear offline storage
   */
  async clearOfflineStorage(): Promise<boolean> {
    if (!this.db) {
      console.error('Database not initialized');
      return false;
    }

    try {
      const transaction = this.db.transaction(['projects', 'assets', 'syncQueue'], 'readwrite');
      
      const projectStore = transaction.objectStore('projects');
      const assetStore = transaction.objectStore('assets');
      const syncStore = transaction.objectStore('syncQueue');

      const projectClear = projectStore.clear();
      const assetClear = assetStore.clear();
      const syncClear = syncStore.clear();

      return new Promise<boolean>((resolve) => {
        let completed = 0;
        const checkComplete = () => {
          completed++;
          if (completed === 3) {
            console.log('Offline storage cleared');
            resolve(true);
          }
        };

        projectClear.onsuccess = checkComplete;
        assetClear.onsuccess = checkComplete;
        syncClear.onsuccess = checkComplete;

        projectClear.onerror = () => resolve(false);
        assetClear.onerror = () => resolve(false);
        syncClear.onerror = () => resolve(false);
      });
    } catch (error) {
      console.error('Error clearing offline storage:', error);
      return false;
    }
  }

  /**
   * Get storage usage
   */
  async getStorageUsage(): Promise<{ used: number; quota: number | null }> {
    try {
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        return {
          used: estimate.usage || 0,
          quota: estimate.quota || null
        };
      } else {
        // Fallback: return 0 for now
        return { used: 0, quota: null };
      }
    } catch (error) {
      console.error('Error getting storage usage:', error);
      return { used: 0, quota: null };
    }
  }
}

// Create a singleton instance
export const pwaOfflineManager = PwaOfflineManager.getInstance();

// Helper function to check if running in offline mode
export const isOfflineMode = (): boolean => {
  return !navigator.onLine;
};

// Helper function to check if PWA is installed
export const isPwaInstalled = (): boolean => {
  return (window.matchMedia('(display-mode: standalone)').matches ||
          ('standalone' in navigator && (navigator as any).standalone) ||
          document.referrer.includes('android-app://'));
};