// Service Worker for Light Dashboard
// Provides offline support for the app shell and automatic updates
const CACHE_VERSION = 'v2.11.0';
const BUILD_TIMESTAMP = '2026-10-26T12:00:00Z';
const CACHE_NAME = `lightdash-${CACHE_VERSION}`;

// Force clear all caches on install - enabled to ensure users get new versions
const FORCE_CACHE_CLEAR = true;

// Assets to cache immediately on install
const STATIC_ASSETS = [
  '/',
  '/styles.css',
  '/palmeirim.css',
  '/palmeirim.js',
  '/app.js',
  '/modules/app-init.js',
  '/icon-180.png',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.png'
];

// Domains that may have CORS issues - don't intercept these in SW
// Let the browser handle them directly
const BYPASS_DOMAINS = [
  'hermes.pyth.network',
  'api.allorigins.win',
  'corsproxy.io',
  'cors-anywhere.herokuapp.com',
  'mainnet.zklighter.elliot.ai',
  'testnet.zklighter.elliot.ai'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Clear all caches if flag is set
      if (FORCE_CACHE_CLEAR) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
      }

      const cache = await caches.open(CACHE_NAME);
      // cache: 'reload' skips the HTTP cache, which can hold the previous version for up to 5 minutes.
      await cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })));
      await self.skipWaiting();
    })()
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('lightdash-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      return self.clients.claim(); // Take control immediately
    })
  );
});

// Helper: answer from cache when possible and refresh the entry in the background
function staleWhileRevalidate(event, request, cacheKey) {
  const cachePromise = caches.open(CACHE_NAME);
  const networkPromise = fetch(request).then(async (response) => {
    if (response.ok && response.type === 'basic' && !response.redirected) {
      const cache = await cachePromise;
      await cache.put(cacheKey, response.clone());
    }
    return response;
  });
  // Keep the worker alive until the cache is updated, even when the cached copy answered first.
  event.waitUntil(networkPromise.then(() => { }, () => { }));

  return cachePromise
    .then(cache => cache.match(cacheKey))
    .then(cached => cached || networkPromise)
    .catch(() => new Response('Offline - please check your connection', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' }
    }));
}

// Helper: answer from the network and keep a copy; the copy answers only when the network fails
function networkFirst(request, cacheKey) {
  return fetch(request).then(async (response) => {
    if (response.ok && response.type === 'basic' && !response.redirected) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(cacheKey, response.clone());
    }
    return response;
  }).catch(() => caches.open(CACHE_NAME)
    .then(cache => cache.match(cacheKey))
    .then(cached => cached || new Response('Offline - please check your connection', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' }
    })));
}

// Fetch event - the app shell only; API requests always go to the network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip domains that may have CORS issues - let browser handle directly
  // This prevents SW from triggering CORS errors
  for (const domain of BYPASS_DOMAINS) {
    if (url.hostname.includes(domain) || url.href.includes(domain)) {
      return; // Don't call event.respondWith - let browser handle it
    }
  }

  // Handle same-origin requests
  if (url.origin === self.location.origin) {
    // Same-origin API proxies carry live market/account data. Let the browser/network handle
    // them so they do not fall into the static asset cache-first branch below.
    if (url.pathname.startsWith('/api/')) {
      return;
    }

    // Code (HTML, JS, CSS, JSON): network first, the cache only when offline. Served from cache,
    // each file was one visit behind and lazily imported modules lagged on their own, so a device
    // that opens the app now and then ran old and new modules together and showed wrong totals.
    // Deploys don't change sw.js, so they can't be relied on to clear the cache.
    // Images and fonts: stale-while-revalidate, as they rarely change and a stale one is harmless.
    const isDocument = request.mode === 'navigate' || request.destination === 'document';
    const isCode = isDocument || ['script', 'style', 'worker', 'manifest'].includes(request.destination) ||
      /\.(m?js|css|json|html)$/.test(url.pathname);
    // Every route serves index.html (see _redirects), so all navigations share one cache entry.
    // '/index.html' itself 308s to '/' on Pages, and a redirected response can't answer a navigation.
    const cacheKey = isDocument ? '/' : request;
    event.respondWith(isCode ? networkFirst(request, cacheKey) : staleWhileRevalidate(event, request, cacheKey));
    return;
  }

  // Third-party APIs: network only. A cached answer would show old prices as if they were live.
});

// Message handler for cache control
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    // Clear ALL caches completely - don't re-cache, let normal fetch handle it
    event.waitUntil(
      caches.keys().then((names) => {
        return Promise.all(names.map(name => caches.delete(name)));
      })
    );
  }

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'GET_VERSION') {
    // Allow the app to check the SW version
    event.ports[0].postMessage({ version: CACHE_VERSION, timestamp: BUILD_TIMESTAMP });
  }
});
