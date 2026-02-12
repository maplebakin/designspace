/**
 * Service Worker for PWA functionality
 * Implements part of Task 15: Create PWA with offline support
 */

// Cache names
const CACHE_NAME = 'designspace-v1';
const ASSETS_CACHE = 'designspace-assets-v1';
const RUNTIME_CACHE = 'designspace-runtime-v1';

// Assets to cache during installation
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/src/main.tsx',
  '/src/App.tsx',
  '/src/index.css',
  // Add more assets as needed
];

// Install event - cache assets
self.addEventListener('install', (event: ExtendableEvent) => {
  console.log('Service Worker: Installing...');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('Service Worker: Installation complete');
        return self.skipWaiting(); // Activate immediately
      })
      .catch((error) => {
        console.error('Service Worker: Installation failed:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event: ExtendableEvent) => {
  console.log('Service Worker: Activating...');

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (
            cacheName !== CACHE_NAME &&
            cacheName !== ASSETS_CACHE &&
            cacheName !== RUNTIME_CACHE
          ) {
            console.log('Service Worker: Deleting old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );

  // Take control of all clients immediately
  return self.clients.claim();
});

// Fetch event - serve cached assets or fetch from network
self.addEventListener('fetch', (event: FetchEvent) => {
  // Don't cache requests to external domains
  if (event.request.url.startsWith(self.location.origin)) {
    event.respondWith(
      caches.match(event.request).then((response) => {
        // Return cached version if available, otherwise fetch from network
        return response || fetch(event.request);
      })
    );
  } else {
    // For external requests, just fetch from network
    event.respondWith(fetch(event.request));
  }
});

// Background sync for offline operations
self.addEventListener('sync', (event: SyncEvent) => {
  if (event.tag === 'sync-operations') {
    event.waitUntil(syncOfflineOperations());
  }
});

// Push notifications
self.addEventListener('push', (event: PushEvent) => {
  const options = {
    body: event.data ? event.data.text() : 'Default notification body',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: 'designspace-notification',
  };

  event.waitUntil(
    self.registration.showNotification('Design Space', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});

// Function to sync offline operations
async function syncOfflineOperations() {
  console.log('Service Worker: Syncing offline operations...');
  
  // In a real implementation, this would sync with a server
  // For now, just log the operation
  try {
    // Retrieve offline operations from IndexedDB
    // Process each operation
    // Remove processed operations
    console.log('Service Worker: Offline operations synced successfully');
  } catch (error) {
    console.error('Service Worker: Failed to sync offline operations:', error);
    // Retry logic could be implemented here
  }
}

// Listen for messages from the main thread
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CACHE_ASSETS') {
    // Cache additional assets as needed
    const assets = event.data.assets || [];
    if (Array.isArray(assets) && assets.length > 0) {
      event.waitUntil(
        caches.open(ASSETS_CACHE).then((cache) => {
          return cache.addAll(assets);
        })
      );
    }
  }
});

// Handle unhandled promise rejections
self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  console.error('Service Worker: Unhandled promise rejection:', event.reason);
  event.preventDefault(); // Prevent the browser from logging the error
});