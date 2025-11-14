// Service Worker for Light Dashboard
// Provides offline support, intelligent caching, and automatic updates
// UPDATE THIS VERSION NUMBER WHENEVER YOU DEPLOY CHANGES
const CACHE_VERSION = 'v2.4.7';
const BUILD_TIMESTAMP = '2025-11-14T17:00:00Z'; // Update on each deployment
const CACHE_NAME = `lightdash-${CACHE_VERSION}`;

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
  'api.coingecko.com': 5 * 60 * 1000, // 5 minutes
  'hermes.pyth.network': 30 * 1000, // 30 seconds
  'api.hyperliquid.xyz': 10 * 1000, // 10 seconds
  'blockchain.info': 60 * 1000, // 1 minute
  'api.zcha.in': 60 * 1000 // 1 minute
  // NOTE: api.zerion.io is NOT cached - always fetch fresh
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
async function cloneWithCacheTime(response) {
  // IMPORTANT: Clone the response BEFORE reading the body
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
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

