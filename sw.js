// Service Worker for Light Dashboard
// Provides offline support, intelligent caching, and automatic updates
const CACHE_VERSION = 'v2.5.4';
const BUILD_TIMESTAMP = '2025-11-14T23:00:00Z';
const CACHE_NAME = `lightdash-${CACHE_VERSION}`;

// Force clear all caches on install (disabled to prevent reload loops)
const FORCE_CACHE_CLEAR = false;

// Assets to cache immediately on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/modules/app-init.js',
  '/icon-180.png',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon_correct.png'
];

// API cache duration by endpoint pattern
const API_CACHE_CONFIG = {
  'api.coingecko.com': 30 * 1000, // 30 seconds
  'hermes.pyth.network': 15 * 1000, // 15 seconds
  'api.hyperliquid.xyz': 10 * 1000, // 10 seconds
  'blockchain.info': 30 * 1000, // 30 seconds
  'api.zcha.in': 30 * 1000 // 30 seconds
  // Note: api.zerion.io is not cached, always fetches fresh
};

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
      await cache.addAll(STATIC_ASSETS);
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

// Helper: Get cache duration for URL
function getCacheDuration(url) {
  for (const [pattern, duration] of Object.entries(API_CACHE_CONFIG)) {
    if (url.includes(pattern)) {
      return duration;
    }
  }
  return 0; // Don't cache by default
}

// Fetch event - network first for HTML, cache first for other static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Handle same-origin requests
  if (url.origin === self.location.origin) {
    // For HTML files - always network first to get updates immediately
    if (request.destination === 'document' || url.pathname.endsWith('.html') || url.pathname === '/') {
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, clone);
              });
            }
            return response;
          })
          .catch(() => {
            // Fallback to cache only if network fails
            return caches.match(request).then((cached) => {
              return cached || new Response('Offline - please check your connection', {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'text/html' }
              });
            });
          })
      );
      return;
    }
    
    // For JS/CSS files - use network-first to ensure users get latest version
    if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, clone);
              });
            }
            return response;
          })
          .catch(() => {
            // Fallback to cache only if network fails (offline support)
            return caches.match(request).then((cached) => {
              return cached || new Response('Offline - please check your connection', {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'text/javascript' }
              });
            });
          })
      );
      return;
    }
    
    // For other static assets (images, fonts, etc.) - cache first
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
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

