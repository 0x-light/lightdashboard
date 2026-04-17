// Minimal centralized HTTP client for native ESM usage
// Features: timeout, retries with jittered backoff, request de-duplication, and TTL cache

const DEFAULT_TIMEOUT_MS = 5000; // Reduced from 15s to 5s for faster failures
const DEFAULT_RETRIES = 1; // Reduced from 2 to 1 retry for speed
const DEFAULT_BACKOFF_BASE_MS = 200; // Reduced from 300ms to 200ms
const DEFAULT_DEV_PROXY_ORIGIN = 'https://viewport.is';
const DEV_PROXY_ORIGIN_KEY = 'ld_proxy_origin';

// In-flight requests for deduplication
const inFlightByKey = new Map();

// Simple in-memory response cache
const memoryCacheByKey = new Map();

function isProductionHost() {
  try {
    const host = window.location.hostname || '';
    return host !== 'localhost' && host !== '127.0.0.1' && !host.includes('local');
  } catch (_) {
    return false;
  }
}

function buildKey(method, url, headers, body) {
  // Only use stable subset to keep keys short and deterministic
  const hdrPairs = [];
  if (headers && typeof headers === 'object') {
    for (const [k, v] of Object.entries(headers)) {
      hdrPairs.push(`${k}:${String(v)}`);
    }
    hdrPairs.sort();
  }
  const bodySig = body && typeof body === 'string' ? body.slice(0, 128) : '';
  return `${method || 'GET'}|${url}|${hdrPairs.join(',')}|${bodySig}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jitteredBackoff(attempt, baseMs = DEFAULT_BACKOFF_BASE_MS) {
  const exp = Math.pow(2, attempt);
  const randomJitter = Math.floor(Math.random() * baseMs);
  return exp * baseMs + randomJitter;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Add cache busting to ensure fresh data (especially on page load)
    // This helps bypass stale service worker cache
    const fetchOptions = { 
      ...options, 
      signal: controller.signal,
      cache: options.bypassCache ? 'reload' : (options.cache || 'default')
    };
    const response = await fetch(url, fetchOptions);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function shouldRetry(errorOrResponse) {
  if (errorOrResponse instanceof Error) {
    return true; // network/timeout
  }
  const status = errorOrResponse && errorOrResponse.status;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  return false;
}

function normalizeOrigin(origin) {
  if (typeof origin !== 'string') return null;
  const trimmed = origin.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (_) {
    return null;
  }
}

function getDevProxyOrigin() {
  if (isProductionHost()) return '';
  try {
    const fromWindow = normalizeOrigin(window.__LD_PROXY_ORIGIN__);
    if (fromWindow) return fromWindow;
  } catch (_) {
    // ignore
  }
  try {
    const fromStorage = normalizeOrigin(localStorage.getItem(DEV_PROXY_ORIGIN_KEY));
    if (fromStorage) return fromStorage;
  } catch (_) {
    // ignore
  }
  return DEFAULT_DEV_PROXY_ORIGIN;
}

function maybeProxyCoinGecko(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.hostname === 'api.coingecko.com') {
      if (isProductionHost()) {
        return `/api/coingecko?url=${encodeURIComponent(rawUrl)}`;
      }
      const devOrigin = getDevProxyOrigin();
      return `${devOrigin}/api/coingecko?url=${encodeURIComponent(rawUrl)}`;
    }
    // Yahoo Finance is CORS-restricted; route through our Cloudflare Pages Function. Always
    // use a relative path: Pages serves /functions/api/* at the same origin, so the proxy is
    // available in both `wrangler pages dev` and in production. (The CoinGecko branch above
    // uses an external dev origin to let plain `python3 -m http.server` piggyback on a
    // deployed proxy — we don't replicate that for Yahoo since it causes silent failures when
    // the external origin hasn't deployed this endpoint yet.)
    if (u.hostname === 'query1.finance.yahoo.com' || u.hostname === 'query2.finance.yahoo.com') {
      return `/api/yahoo?url=${encodeURIComponent(rawUrl)}`;
    }
    return rawUrl;
  } catch (_) {
    return rawUrl;
  }
}

async function requestJson(url, {
  method = 'GET',
  headers = {},
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
  backoffBaseMs = DEFAULT_BACKOFF_BASE_MS,
  bypassCache = false
} = {}) {
  // CoinGecko proxy in production for CORS
  const finalUrl = maybeProxyCoinGecko(url);
  const key = buildKey(method, finalUrl, headers, body);

  // De-duplicate concurrent identical requests (but skip dedup if bypassing cache)
  if (!bypassCache && inFlightByKey.has(key)) {
    return inFlightByKey.get(key);
  }

  const exec = (async () => {
    let attempt = 0;
    while (true) {
      try {
        const response = await fetchWithTimeout(finalUrl, { method, headers, body, bypassCache }, timeoutMs);
        if (!response.ok) {
          if (shouldRetry(response) && attempt < retries) {
            attempt += 1;
            await sleep(jitteredBackoff(attempt, backoffBaseMs));
            continue;
          }
          const text = await response.text().catch(() => '');
          throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
        }
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          return await response.json();
        }
        // Fallback: try text for APIs that mislabel
        const text = await response.text();
        try {
          return JSON.parse(text);
        } catch (_) {
          return text;
        }
      } catch (err) {
        if (shouldRetry(err) && attempt < retries) {
          attempt += 1;
          await sleep(jitteredBackoff(attempt, backoffBaseMs));
          continue;
        }
        throw err;
      }
    }
  })();

  inFlightByKey.set(key, exec);
  try {
    const result = await exec;
    return result;
  } finally {
    inFlightByKey.delete(key);
  }
}

/**
 * GET JSON with optional in-memory caching
 */
async function getJson(url, {
  ttlMs = 0,
  headers = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
  backoffBaseMs = DEFAULT_BACKOFF_BASE_MS,
  bypassCache = false
} = {}) {
  const key = buildKey('GET', url, headers, undefined);
  // Skip memory cache check if bypassCache is true
  if (!bypassCache && ttlMs > 0) {
    const cached = memoryCacheByKey.get(key);
    if (cached && (Date.now() - cached.storedAt) < ttlMs) {
      return cached.value;
    }
  }
  const value = await requestJson(url, { method: 'GET', headers, timeoutMs, retries, backoffBaseMs, bypassCache });
  if (ttlMs > 0) {
    memoryCacheByKey.set(key, { value, storedAt: Date.now(), ttlMs });
  }
  return value;
}

export const HttpClient = {
  getJson,
  requestJson,
  fetchWithTimeout,
  isProductionHost,
  _internal: {
    memoryCacheByKey,
    inFlightByKey,
    buildKey,
    jitteredBackoff
  }
};

export default HttpClient;

