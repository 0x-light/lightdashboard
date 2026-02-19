// Pyth provider (Hermes REST) with CORS proxy support
import { fetchWithCorsProxy } from '../../http/cors-proxy.js';
import { HttpClient } from '../../http/client.js';

const HERMES_BASE = 'https://hermes.pyth.network';
const LOCAL_FAILURE_THRESHOLD = 3;
const LOCAL_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
let localConsecutiveFailures = 0;
let localPythDisabledUntil = 0;
let didLogLocalDisable = false;

function isLocalPythDisabled() {
  return !HttpClient.isProductionHost() && Date.now() < localPythDisabledUntil;
}

function notePythSuccess() {
  localConsecutiveFailures = 0;
  localPythDisabledUntil = 0;
  didLogLocalDisable = false;
}

function notePythFailure() {
  if (HttpClient.isProductionHost()) return;
  localConsecutiveFailures += 1;
  if (localConsecutiveFailures >= LOCAL_FAILURE_THRESHOLD) {
    localPythDisabledUntil = Date.now() + LOCAL_COOLDOWN_MS;
    localConsecutiveFailures = 0;
    if (!didLogLocalDisable) {
      console.warn('[Pyth] Temporarily disabling remote requests for 5 minutes after repeated failures on localhost.');
      didLogLocalDisable = true;
    }
  }
}

// Helper to fetch valid Pyth data with robust fallbacks
async function fetchPyth(path, timeoutMs = 10000, bypassCache = false) {
  if (isLocalPythDisabled()) {
    return null;
  }

  // Add cache-busting param when bypassing cache to ensure unique request keys
  const finalPath = bypassCache ? `${path}${path.includes('?') ? '&' : '?'}_t=${Date.now()}` : path;
  const finalUrl = `${HERMES_BASE}/v2${finalPath}`;

  try {
    const data = await fetchWithCorsProxy(finalUrl, {
      cloudflareProxy: '/api/pyth?path=',
      timeoutMs,
      // Avoid hammering public proxies on localhost when they are rate-limited.
      maxPublicProxyAttempts: HttpClient.isProductionHost() ? 0 : 1
    });
    notePythSuccess();
    return data;
  } catch (e) {
    notePythFailure();
    return null;
  }
}

let feedsCache = null;
let feedsCacheTimestamp = 0;
const FEEDS_CACHE_KEY = 'pyth_price_feeds_v1';
const FEEDS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function getPriceFeeds(timeoutMs = 15000) {
  const now = Date.now();

  // 1. Check Memory Cache
  if (feedsCache && (now - feedsCacheTimestamp < FEEDS_CACHE_TTL)) {
    return feedsCache;
  }

  // 2. Check LocalStorage
  try {
    const cached = localStorage.getItem(FEEDS_CACHE_KEY);
    if (cached) {
      const { timestamp, data } = JSON.parse(cached);
      if (now - timestamp < FEEDS_CACHE_TTL) {
        feedsCache = data;
        feedsCacheTimestamp = timestamp;
        return data; // Return immediately from local storage
      }
    }
  } catch (e) {
    console.warn('[Pyth] Failed to load feeds from storage', e);
  }

  // 3. Fetch from API
  try {
    const feeds = await fetchPyth('/price_feeds', timeoutMs) || [];
    const feedMap = {};
    if (Array.isArray(feeds)) {
      for (const feed of feeds) {
        const symbol = feed?.attributes?.symbol;
        const id = feed?.id;
        if (symbol && id) {
          const match = symbol.match(/Crypto\.([A-Z0-9]+)\/USD/i);
          if (match) {
            const asset = match[1].toUpperCase();
            const normalizedId = id.toLowerCase().startsWith('0x') ? id.toLowerCase() : `0x${id.toLowerCase()}`;
            feedMap[asset] = normalizedId;
          }
        }
      }
    }

    // Save to Cache
    if (Object.keys(feedMap).length > 0) {
      feedsCache = feedMap;
      feedsCacheTimestamp = now;
      try {
        localStorage.setItem(FEEDS_CACHE_KEY, JSON.stringify({ timestamp: now, data: feedMap }));
      } catch (e) { /* ignore quota */ }
    }

    return feedMap;
  } catch (e) {
    console.error('[Pyth] Failed to fetch price feeds', e);
    // Fallback to cache even if expired? No, return empty or old cache if available
    return feedsCache || {};
  }
}

export async function getLatestByFeedIds(feedIds, timeoutMs = 10000, bypassCache = false) {
  if (isLocalPythDisabled()) return {};
  if (!Array.isArray(feedIds) || feedIds.length === 0) return {};
  const normalizedIds = feedIds.map(id => id.toLowerCase().startsWith('0x') ? id.toLowerCase() : `0x${id.toLowerCase()}`);
  const idsParam = normalizedIds.map(id => `ids[]=${id}`).join('&');
  const data = await fetchPyth(`/updates/price/latest?${idsParam}&parsed=true`, timeoutMs, bypassCache);
  const prices = {};
  const parsed = data?.parsed || [];
  for (const p of parsed) {
    const id = p?.id ? (p.id.toLowerCase().startsWith('0x') ? p.id.toLowerCase() : `0x${p.id.toLowerCase()}`) : null;
    if (!id) continue;
    const price = parseFloat(p?.price?.price) * Math.pow(10, p?.price?.expo || 0);
    if (Number.isFinite(price)) prices[id] = price;
  }
  return prices;
}

export async function getAtTimestampByFeedIds(feedIds, timestampSeconds, timeoutMs = 10000) {
  if (isLocalPythDisabled()) return {};
  if (!Array.isArray(feedIds) || feedIds.length === 0) return {};
  const normalizedIds = feedIds.map(id => id.toLowerCase().startsWith('0x') ? id.toLowerCase() : `0x${id.toLowerCase()}`);
  const idsParam = normalizedIds.map(id => `ids[]=${id}`).join('&');
  const data = await fetchPyth(`/updates/price/${timestampSeconds}?${idsParam}&parsed=true`, timeoutMs);
  const prices = {};
  const parsed = data?.parsed || [];
  for (const p of parsed) {
    const id = p?.id ? (p.id.toLowerCase().startsWith('0x') ? p.id.toLowerCase() : `0x${p.id.toLowerCase()}`) : null;
    if (!id) continue;
    const price = parseFloat(p?.price?.price) * Math.pow(10, p?.price?.expo || 0);
    if (Number.isFinite(price)) prices[id] = price;
  }
  return prices;
}

// Global Concurrency Queue
const MAX_CONCURRENCY = HttpClient.isProductionHost() ? 6 : 2;
const globalQueue = []; // Array of functions returning promises
let activeRequests = 0;

const processQueue = async () => {
  if (activeRequests >= MAX_CONCURRENCY || globalQueue.length === 0) return;

  activeRequests++;
  const task = globalQueue.shift();

  try {
    await task();
  } catch (e) {
    console.error('[Pyth] Queue task failed', e);
  } finally {
    activeRequests--;
    // Add a small delay between requests to be nice to the API
    setTimeout(processQueue, 100);
  }
};

const enqueue = (task) => {
  return new Promise((resolve, reject) => {
    globalQueue.push(async () => {
      try {
        const result = await task();
        resolve(result);
      } catch (e) {
        reject(e);
      }
    });
    processQueue();
  });
};

export async function getBatch24hPriceHistory(feedIds, points = 48, endTime = Date.now()) {
  if (!feedIds || feedIds.length === 0) return {};

  // Deduplicate feedIds and normalize them
  const uniqueFeedIds = [...new Set(feedIds)].map(id => id.toLowerCase().startsWith('0x') ? id.toLowerCase() : `0x${id.toLowerCase()}`);

  const now = Math.floor(endTime / 1000);
  const day = 24 * 60 * 60;
  const startTime = now - day;
  const interval = day / points;

  const timestamps = [];
  for (let i = 0; i < points; i++) {
    timestamps.push(Math.floor(startTime + (i * interval)));
  }

  // --- Smart Caching Logic ---
  const CACHE_PREFIX = 'pyth_history_';
  // Helper to get from cache
  const getFromCache = (feedId, timestamp) => {
    try {
      const key = `${CACHE_PREFIX}${feedId}_${timestamp}`;
      const cached = localStorage.getItem(key);
      if (cached) {
        const val = parseFloat(cached);
        return Number.isFinite(val) ? val : null;
      }
    } catch (e) { /* ignore storage errors */ }
    return null;
  };
  // Helper to save to cache
  const saveToCache = (feedId, timestamp, price) => {
    try {
      const key = `${CACHE_PREFIX}${feedId}_${timestamp}`;
      localStorage.setItem(key, price.toString());
    } catch (e) {
      // Handle quota exceeded by clearing old entries (simple FIFO approximation or clear all)
      try {
        console.warn('[Pyth] Storage full, clearing old history...');
        // Simple strategy: clear all history items to start fresh
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
        });
        localStorage.setItem(key, price.toString());
      } catch (err) { /* give up */ }
    }
  };
  // ---------------------------

  const feedIdsToFetchInitial = [...new Set(feedIds.map(id => id.toLowerCase().startsWith('0x') ? id.toLowerCase() : `0x${id.toLowerCase()}`))];

  // 1. Check Cache First
  // We need to know which (feedId, timestamp) pairs are missing.
  // result structure: { feedId: [ { timestamp, price } ] }

  // Initialize results map
  const results = {};
  uniqueFeedIds.forEach(id => {
    results[id] = [];
  });

  const timestampsToFetch = []; // List of timestamps that have at least one missing feed
  const missingDataMap = {}; // timestamp -> [feedIds that need fetching]

  timestamps.forEach(ts => {
    let hasMissing = false;
    const missingFeedsForTs = [];

    feedIdsToFetchInitial.forEach(fid => {
      const cachedPrice = getFromCache(fid, ts);
      if (cachedPrice !== null) {
        // Add to results immediately
        if (!results[fid]) results[fid] = [];
        results[fid].push({ timestamp: ts, price: cachedPrice });
      } else {
        hasMissing = true;
        missingFeedsForTs.push(fid);
      }
    });

    if (hasMissing) {
      timestampsToFetch.push(ts);
      missingDataMap[ts] = missingFeedsForTs;
    }
  });

  if (timestampsToFetch.length === 0) {
    // Sort results by timestamp before returning
    Object.keys(results).forEach(id => {
      results[id].sort((a, b) => a.timestamp - b.timestamp);
    });
    return results;
  }

  if (isLocalPythDisabled()) {
    Object.keys(results).forEach(id => {
      results[id].sort((a, b) => a.timestamp - b.timestamp);
    });
    return results;
  }

  // console.log(`[Pyth] Smart Cache: Fetching ${timestampsToFetch.length}/${timestamps.length} timestamps from API.`);

  const processTimestamp = async (ts) => {
    if (isLocalPythDisabled()) return;

    const feedsNeeded = missingDataMap[ts];
    if (!feedsNeeded || feedsNeeded.length === 0) return;

    try {
      const idsParam = feedsNeeded.map(id => `ids[]=${id}`).join('&');

      // Use fetchPyth which handles 429 retries internally via fetchWithCorsProxy logic? 
      // Actually fetchWithCorsProxy just tries proxies. Error handling is still basic.
      // But we can catch 429 here if needed.
      const data = await fetchPyth(`/updates/price/${ts}?${idsParam}&parsed=true`, 10000);

      if (!data) return; // Silent fail if all proxies fail

      if (data && data.parsed && Array.isArray(data.parsed)) {
        data.parsed.forEach(update => {
          const id = update.id.startsWith('0x') ? update.id.toLowerCase() : `0x${update.id.toLowerCase()}`;
          const targetId = feedsNeeded.find(fid => fid === id);

          if (targetId && update.price) {
            const price = parseFloat(update.price.price) * Math.pow(10, update.price.expo);
            if (Number.isFinite(price) && price > 0) {
              if (!results[targetId]) results[targetId] = [];
              results[targetId].push({ timestamp: ts, price: price });
              saveToCache(targetId, ts, price);
            }
          }
        });
      }
    } catch (e) {
      // If 429, we should arguably retry, but for now just log
      console.warn(`[Pyth] Failed ts ${ts}:`, e);
    }
  };

  // Queue all timestamp fetches globally
  const promises = timestampsToFetch.map(ts => enqueue(() => processTimestamp(ts)));

  await Promise.all(promises);

  // Sort results by timestamp
  Object.keys(results).forEach(id => {
    results[id].sort((a, b) => a.timestamp - b.timestamp);
  });

  return results;
}

export async function get24hPriceHistory(feedId, timeoutMs = 10000, points = 96) {
  // Check if second argument is number (legacy support if points was passed as 2nd arg in some calls? No, signature was timeoutMs)
  // Actually, let's just use named args or be careful. 
  // Previous signature: (feedId, timeoutMs = 10000)
  // If I change it to (feedId, points = 96), it might break callers passing timeout.
  // Let's keep timeoutMs but maybe it's unused?
  // Let's modify ManualFetcher to pass points.
  const result = await getBatch24hPriceHistory([feedId], points);
  return result[feedId.toLowerCase().startsWith('0x') ? feedId.toLowerCase() : `0x${feedId.toLowerCase()}`] || [];
}

export default { getPriceFeeds, getLatestByFeedIds, getAtTimestampByFeedIds, get24hPriceHistory, getBatch24hPriceHistory };
