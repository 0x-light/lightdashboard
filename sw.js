// Service Worker for Light Dashboard
// Provides offline support, intelligent caching, and automatic updates
const CACHE_VERSION = 'v2.11.0';
const BUILD_TIMESTAMP = '2026-10-26T12:00:00Z';
const CACHE_NAME = `lightdash-${CACHE_VERSION}`;

// Force clear all caches on install - enabled to ensure users get new versions
const FORCE_CACHE_CLEAR = true;

// Images to cache on install. The code is cached as the app shell, below.
const STATIC_ASSETS = [
  '/icon-180.png',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.png'
];

// API cache duration by endpoint pattern
const API_CACHE_CONFIG = {
  'api.coingecko.com': 60 * 1000, // 60 seconds (CoinGecko has strict rate limits)
  'hermes.pyth.network': 10 * 1000, // 10 seconds (Real-time prices)
  'api.hyperliquid.xyz': 10 * 1000, // 10 seconds (Fast updates)
  'blockchain.info': 60 * 1000, // 60 seconds (Bitcoin blocks are slow)
  'api.zcha.in': 60 * 1000 // 60 seconds (Zcash blocks are slow)
  // Note: api.zerion.io is not cached, always fetches fresh
};

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

      shellName = null;
      const cache = await caches.open(CACHE_NAME);
      // cache: 'reload' skips the HTTP cache, which can hold the previous version for up to 5 minutes.
      await cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })));
      // Without a shell the first launches still work, from the network.
      await buildShell().catch(() => { });
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
          .filter((name) => name.startsWith('lightdash-') && name !== CACHE_NAME &&
            name !== META_CACHE && !name.startsWith(SHELL_PREFIX))
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      return self.clients.claim(); // Take control immediately
    })
  );
});

// ── App shell ──
// The code (HTML, JS, CSS) is served from one complete copy of the app, so a launch needs no
// network. A few seconds after each launch the worker revalidates every file of that copy. When
// any file changed, it builds a complete new copy and switches to it in one step, so a page never
// runs old and new modules together. Deploys don't change sw.js, so the files themselves are compared.
const SHELL_PREFIX = 'lightdash-shell-';
const META_CACHE = 'lightdash-meta';
const SHELL_POINTER = '/__shell';
const REVALIDATE_DELAY_MS = 4000;
const REVALIDATE_MIN_GAP_MS = 60 * 1000;
let shellName = null;
let revalidating = null;
let lastRevalidate = 0;

async function currentShell() {
  if (shellName) return shellName;
  const pointer = await (await caches.open(META_CACHE)).match(SHELL_POINTER);
  shellName = pointer ? await pointer.text() : null;
  // The page can clear all caches (version check, Settings reset); then there is no shell.
  if (shellName && !(await caches.has(shellName))) shellName = null;
  return shellName;
}

async function setShell(name) {
  await (await caches.open(META_CACHE)).put(SHELL_POINTER, new Response(name));
  shellName = name;
  const names = await caches.keys();
  await Promise.all(names.filter(n => n.startsWith(SHELL_PREFIX) && n !== name).map(n => caches.delete(n)));
}

function cacheable(response) {
  return response && response.ok && response.type === 'basic' && !response.redirected;
}

function urlKey(url) {
  const u = new URL(url, self.location.origin);
  return u.pathname + u.search;
}

// Same-origin scripts, styles, module preloads and the manifest that the page names.
function assetsIn(html) {
  const urls = new Set();
  for (const m of html.matchAll(/<(?:script|link)\b[^>]*?\s(?:src|href)="([^"]+)"/g)) {
    const url = new URL(m[1], self.location.origin);
    if (url.origin === self.location.origin && /\.(m?js|css|json)$/.test(url.pathname)) urls.add(urlKey(url));
  }
  return [...urls];
}

// Six at a time. no-cache revalidates with the server, so an unchanged file costs a 304.
async function fetchAll(urls) {
  const out = new Map();
  let i = 0;
  const worker = async () => {
    while (i < urls.length) {
      const url = urls[i++];
      try {
        const response = await fetch(new Request(url, { cache: 'no-cache' }));
        // Read now: an unread body holds its connection, and over HTTP/1.1 six of them stall the rest.
        if (cacheable(response)) {
          const { status, statusText, headers } = response;
          out.set(url, new Response(await response.blob(), { status, statusText, headers }));
        } else {
          await response.body?.cancel();
        }
      } catch (_) {
        // Left out; the page fetches it from the network when it needs it.
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

async function sameBody(a, b) {
  const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  if (x.byteLength !== y.byteLength) return false;
  const p = new Uint8Array(x);
  const q = new Uint8Array(y);
  for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return false;
  return true;
}

// A complete copy: the page, what it names, and the modules the app loaded later (`extra`).
async function buildShell(extra = []) {
  const page = await fetch(new Request('/', { cache: 'no-cache' }));
  if (!cacheable(page)) throw new Error('No page');
  const urls = [...new Set([...assetsIn(await page.clone().text()), ...extra])].filter(u => u !== '/');
  const files = await fetchAll(urls);
  const name = SHELL_PREFIX + Date.now();
  const cache = await caches.open(name);
  await cache.put('/', page);
  await Promise.all([...files].map(([url, response]) => cache.put(url, response)));
  await setShell(name);
}

async function revalidateShell() {
  const name = await currentShell();
  if (!name) return buildShell();
  const cache = await caches.open(name);
  const urls = (await cache.keys()).map(request => urlKey(request.url));
  const fresh = await fetchAll(urls);
  for (const [url, response] of fresh) {
    const cached = await cache.match(url, { ignoreVary: true });
    if (cached && await sameBody(cached, response)) continue;
    await buildShell(urls);
    // The open page keeps its version until it is out of sight, then reloads (index.html).
    const pages = await self.clients.matchAll({ type: 'window' });
    pages.forEach(page => page.postMessage({ type: 'SHELL_UPDATED' }));
    return;
  }
}

function revalidateSoon(delayMs = REVALIDATE_DELAY_MS) {
  if (revalidating || Date.now() - lastRevalidate < REVALIDATE_MIN_GAP_MS) return revalidating || Promise.resolve();
  lastRevalidate = Date.now();
  // Waits so the check doesn't compete with the launch's own price requests.
  revalidating = new Promise(resolve => setTimeout(resolve, delayMs))
    .then(revalidateShell)
    .catch(() => { })
    .finally(() => { revalidating = null; });
  return revalidating;
}

async function fromShell(request, cacheKey) {
  const name = await currentShell();
  if (name) {
    const cached = await (await caches.open(name)).match(cacheKey, { ignoreVary: true });
    if (cached) return cached;
  }
  // Not in the shell: the first launch, or a module the app hasn't loaded before
  try {
    const response = await fetch(request);
    if (name && cacheable(response)) await (await caches.open(name)).put(cacheKey, response.clone());
    return response;
  } catch (_) {
    return new Response('Offline - please check your connection', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// Helper: Check if response is still fresh
function isFresh(response, maxAge) {
  if (!response) return false;

  const cachedTime = response.headers.get('sw-cached-time');
  if (!cachedTime) return false;

  const age = Date.now() - parseInt(cachedTime, 10);
  return age < maxAge;
}

// Helper: Clone response with custom headers
async function cloneWithCacheTime(response) {
  // Clone the response before reading the body
  const clone = response.clone();
  const headers = new Headers(clone.headers);
  headers.set('sw-cached-time', Date.now().toString());

  const body = await clone.blob();
  return new Response(body, {
    status: clone.status,
    statusText: clone.statusText,
    headers: headers
  });
}

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

// Helper: Get cache duration for URL
function getCacheDuration(url) {
  for (const [pattern, duration] of Object.entries(API_CACHE_CONFIG)) {
    if (url.includes(pattern)) {
      return duration;
    }
  }
  return 0; // Don't cache by default
}

// Fetch event - stale-while-revalidate for the app shell, short-lived caching for some APIs
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

    // Code (HTML, JS, CSS, JSON): from the app shell, which is checked after each launch.
    // Per-file stale-while-revalidate once left each file one visit behind, so a device ran old and
    // new modules together and showed wrong totals; the shell is replaced only as a whole.
    // Images and fonts: stale-while-revalidate, as they rarely change and a stale one is harmless.
    const isDocument = request.mode === 'navigate' || request.destination === 'document';
    const isCode = isDocument || ['script', 'style', 'worker', 'manifest'].includes(request.destination) ||
      /\.(m?js|css|json|html)$/.test(url.pathname);
    // Every route serves index.html (see _redirects), so all navigations share one cache entry.
    // '/index.html' itself 308s to '/' on Pages, and a redirected response can't answer a navigation.
    const cacheKey = isDocument ? '/' : urlKey(request.url);
    if (isDocument) event.waitUntil(revalidateSoon());
    event.respondWith(isCode ? fromShell(request, cacheKey) : staleWhileRevalidate(event, request, request));
    return;
  }

  // Handle API requests - network first with intelligent caching
  const cacheDuration = getCacheDuration(url.href);

  if (cacheDuration > 0) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(request).then((cached) => {
          // Check if cached response is still fresh
          if (cached && isFresh(cached, cacheDuration)) {
            // Return cached but update in background
            fetch(request).then(async (response) => {
              if (response.ok) {
                const clonedResponse = await cloneWithCacheTime(response);
                cache.put(request, clonedResponse);
              }
            }).catch(() => {
              // Ignore background fetch errors
            });
            return cached.clone(); // Clone before returning
          }

          // Fetch from network
          return fetch(request).then(async (response) => {
            if (response.ok) {
              const clonedResponse = await cloneWithCacheTime(response);
              cache.put(request, clonedResponse);
            }
            return response;
          }).catch((error) => {
            // Return stale cache if available
            if (cached) {
              return cached.clone(); // Clone before returning
            }
            throw error;
          });
        });
      })
    );
  } else {
    // Default behavior - network only (no caching)
    // Don't call respondWith - let browser handle it directly
    // This avoids the invalid status 0 Response bug
    return;
  }
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

  if (event.data && event.data.type === 'CLEAR_API_CACHE') {
    // Clear only API responses, keep static assets
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.keys().then((requests) => {
          const apiRequests = requests.filter((request) => {
            const url = request.url;
            return url.includes('api.coingecko.com') ||
              url.includes('hermes.pyth.network') ||
              url.includes('api.hyperliquid.xyz') ||
              url.includes('blockchain.info') ||
              url.includes('api.zcha.in') ||
              url.includes('api.zerion.io') ||
              url.includes('api/');
          });
          return Promise.all(apiRequests.map((request) => cache.delete(request)));
        });
      })
    );
  }

  // A PWA resumed from the background doesn't navigate, so the page asks for the check itself.
  if (event.data && event.data.type === 'REVALIDATE_SHELL') {
    event.waitUntil(revalidateSoon(0));
  }

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'GET_VERSION') {
    // Allow the app to check the SW version
    event.ports[0].postMessage({ version: CACHE_VERSION, timestamp: BUILD_TIMESTAMP });
  }
});
