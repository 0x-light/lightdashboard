// Pyth provider (Hermes REST) with CORS proxy support
import { fetchWithCorsProxy } from '../../http/cors-proxy.js';
import { HttpClient } from '../../http/client.js';

const HERMES_BASE = 'https://hermes.pyth.network';
const LOCAL_FAILURE_THRESHOLD = 3;
const LOCAL_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const MAX_IDS_PER_TIMESTAMP_REQUEST = 8;
const MAX_TIMESTAMP_SPLIT_DEPTH = 3;
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
      // Keep console clean: use first-party proxy only, no public proxy churn.
      preferDirect: false,
      maxPublicProxyAttempts: 0
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
const FEED_ID_PATTERN = /^0x[a-f0-9]{64}$/;

function normalizeFeedId(id) {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim().toLowerCase();
  if (!trimmed) return null;
  const normalized = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  return FEED_ID_PATTERN.test(normalized) ? normalized : null;
}

function getKnownFeedIdSet() {
  if ((!feedsCache || typeof feedsCache !== 'object') && typeof localStorage !== 'undefined') {
    try {
      const cached = localStorage.getItem(FEEDS_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        const ts = Number(parsed?.timestamp || 0);
        const data = parsed?.data;
        if (data && typeof data === 'object' && Number.isFinite(ts) && (Date.now() - ts) < FEEDS_CACHE_TTL) {
          feedsCache = data;
          feedsCacheTimestamp = ts;
        }
      }
    } catch (_) {
      // Ignore storage parse/access errors.
    }
  }

  if (!feedsCache || typeof feedsCache !== 'object') return null;
  const set = new Set();
  for (const id of Object.values(feedsCache)) {
    const normalized = normalizeFeedId(id);
    if (normalized) set.add(normalized);
  }
  return set.size > 0 ? set : null;
}

function normalizeFeedIds(feedIds) {
  if (!Array.isArray(feedIds) || feedIds.length === 0) return [];
  const knownSet = getKnownFeedIdSet();
  const out = [];
  const seen = new Set();
  for (const id of feedIds) {
    const normalized = normalizeFeedId(id);
    if (!normalized) continue;
    if (knownSet && !knownSet.has(normalized)) {
      // Skip unknown IDs when we have a known feed map to avoid 404 spam.
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function parseParsedPrices(data) {
  const prices = {};
  const parsed = data?.parsed;
  if (!Array.isArray(parsed)) return prices;

  for (const item of parsed) {
    const id = normalizeFeedId(item?.id);
    if (!id) continue;
    const price = parseFloat(item?.price?.price) * Math.pow(10, item?.price?.expo || 0);
    if (Number.isFinite(price)) {
      prices[id] = price;
    }
  }

  return prices;
}

function chunkArray(values, chunkSize) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const size = Math.max(1, Number(chunkSize) || 1);
  const out = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

async function fetchTimestampChunkWithSplit(feedIds, timestampSeconds, timeoutMs = 10000, depth = 0) {
  if (!Array.isArray(feedIds) || feedIds.length === 0) return {};

  const idsParam = feedIds.map(id => `ids[]=${id}`).join('&');
  const data = await fetchPyth(`/updates/price/${timestampSeconds}?${idsParam}&parsed=true`, timeoutMs);
  const prices = parseParsedPrices(data);

  // If we got data, keep it. If not, split to isolate bad IDs and salvage good ones.
  if (Object.keys(prices).length > 0 || feedIds.length <= 1 || depth >= MAX_TIMESTAMP_SPLIT_DEPTH) {
    return prices;
  }

  const mid = Math.ceil(feedIds.length / 2);
  const left = await fetchTimestampChunkWithSplit(feedIds.slice(0, mid), timestampSeconds, timeoutMs, depth + 1);
  const right = await fetchTimestampChunkWithSplit(feedIds.slice(mid), timestampSeconds, timeoutMs, depth + 1);
  return { ...left, ...right };
}

async function fetchTimestampPricesResilient(feedIds, timestampSeconds, timeoutMs = 10000) {
  const normalizedIds = normalizeFeedIds(feedIds);
  if (normalizedIds.length === 0) return {};

  const results = {};
  const chunks = chunkArray(normalizedIds, MAX_IDS_PER_TIMESTAMP_REQUEST);
  for (const chunk of chunks) {
    const chunkPrices = await fetchTimestampChunkWithSplit(chunk, timestampSeconds, timeoutMs, 0);
    Object.assign(results, chunkPrices);
  }
  return results;
}

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
  const normalizedIds = normalizeFeedIds(feedIds);
  if (normalizedIds.length === 0) return {};
  const idsParam = normalizedIds.map(id => `ids[]=${id}`).join('&');
  const data = await fetchPyth(`/updates/price/latest?${idsParam}&parsed=true`, timeoutMs, bypassCache);
  return parseParsedPrices(data);
}

export async function getAtTimestampByFeedIds(feedIds, timestampSeconds, timeoutMs = 10000) {
  if (isLocalPythDisabled()) return {};
  return fetchTimestampPricesResilient(feedIds, timestampSeconds, timeoutMs);
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

  // Normalize, dedupe, and optionally filter unknown/invalid IDs.
  const uniqueFeedIds = normalizeFeedIds(feedIds);
  if (uniqueFeedIds.length === 0) return {};

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

  const feedIdsToFetchInitial = uniqueFeedIds;

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
      const priceMap = await fetchTimestampPricesResilient(feedsNeeded, ts, 10000);
      if (!priceMap || Object.keys(priceMap).length === 0) return;

      for (const targetId of feedsNeeded) {
        const price = priceMap[targetId];
        if (Number.isFinite(price) && price > 0) {
          if (!results[targetId]) results[targetId] = [];
          results[targetId].push({ timestamp: ts, price });
          saveToCache(targetId, ts, price);
        }
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
  const normalized = normalizeFeedId(feedId);
  if (!normalized) return [];
  return result[normalized] || [];
}

export default { getPriceFeeds, getLatestByFeedIds, getAtTimestampByFeedIds, get24hPriceHistory, getBatch24hPriceHistory };
