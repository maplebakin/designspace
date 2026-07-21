const CACHE_NAME = 'design-space-app-v2';
const APP_SHELL_URLS = ['/', '/index.html', '/manifest.json'];

const cacheResponse = async (cache, request, response) => {
  if (response && response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
};

const cacheBuiltAssetsFromIndex = async (cache, indexResponse) => {
  const html = await indexResponse.clone().text();
  const assetUrls = Array.from(
    html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g),
    (match) => match[1]
  );
  await Promise.all(
    [...new Set(assetUrls)].map(async (url) => {
      try {
        const response = await fetch(url, { cache: 'reload' });
        await cacheResponse(cache, url, response);
      } catch {
        // A later online request will populate the runtime cache.
      }
    })
  );
};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL_URLS);
    const indexResponse = await cache.match('/index.html') || await cache.match('/');
    if (indexResponse) {
      await cacheBuiltAssetsFromIndex(cache, indexResponse);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName !== CACHE_NAME)
        .map((cacheName) => caches.delete(cacheName))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        return await cacheResponse(cache, '/', response);
      } catch {
        return (await cache.match(request))
          || (await cache.match('/'))
          || (await cache.match('/index.html'));
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    return await cacheResponse(cache, request, response);
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});
