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
}

export const pwaOfflineManager = new PwaOfflineManager();
