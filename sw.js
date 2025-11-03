// Service Worker for Light Dashboard
// Provides offline support, aggressive caching, and performance optimization

const CACHE_VERSION = 'v2.0.0-production-fixes';
const CACHE_NAME = `lightdash-${CACHE_VERSION}`;

// Assets to cache immediately on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/script.js'
];

// API cache duration by endpoint pattern
const API_CACHE_CONFIG = {
  'api.coingecko.com': 5 * 60 * 1000, // 5 minutes
  'hermes.pyth.network': 30 * 1000, // 30 seconds
  'api.hyperliquid.xyz': 10 * 1000, // 10 seconds
  'blockchain.info': 60 * 1000, // 1 minute
  'api.zcha.in': 60 * 1000 // 1 minute
};

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      return self.skipWaiting(); // Activate immediately
    })
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

// Helper: Check if response is still fresh
function isFresh(response, maxAge) {
  if (!response) return false;
  
  const cachedTime = response.headers.get('sw-cached-time');
  if (!cachedTime) return false;
  
  const age = Date.now() - parseInt(cachedTime, 10);
  return age < maxAge;
}

// Helper: Clone response with custom headers
function cloneWithCacheTime(response) {
  const headers = new Headers(response.headers);
  headers.set('sw-cached-time', Date.now().toString());
  
  return response.blob().then((body) => {
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: headers
    });
  });
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

// Fetch event - network first with cache fallback for APIs, cache first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Handle static assets - cache first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        return cached || fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, clone);
            });
          }
          return response;
        });
      }).catch(() => {
        // Return offline page or placeholder
        return new Response('Offline - please check your connection', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' }
        });
      })
    );
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
            fetch(request).then((response) => {
              if (response.ok) {
                cloneWithCacheTime(response).then((clonedResponse) => {
                  cache.put(request, clonedResponse);
                });
              }
            }).catch(() => {
              // Ignore background fetch errors
            });
            return cached;
          }
          
          // Fetch from network
          return fetch(request).then((response) => {
            if (response.ok) {
              cloneWithCacheTime(response).then((clonedResponse) => {
                cache.put(request, clonedResponse);
              });
            }
            return response;
          }).catch((error) => {
            // Return stale cache if available
            if (cached) {
              return cached;
            }
            throw error;
          });
        });
      })
    );
  } else {
    // Default behavior - network only
    event.respondWith(fetch(request));
  }
});

// Message handler for cache control
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.delete(CACHE_NAME).then(() => {
        return caches.open(CACHE_NAME);
      }).then((cache) => {
        return cache.addAll(STATIC_ASSETS);
      })
    );
  }
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

