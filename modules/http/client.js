// Minimal centralized HTTP client for native ESM usage
// Features: timeout, retries with jittered backoff, request de-duplication, and TTL cache

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_BASE_MS = 300;

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
    const response = await fetch(url, { ...options, signal: controller.signal });
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

function maybeProxyCoinGecko(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.hostname === 'api.coingecko.com' && isProductionHost()) {
      return `/api/coingecko?url=${encodeURIComponent(rawUrl)}`;
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
  backoffBaseMs = DEFAULT_BACKOFF_BASE_MS
} = {}) {
  // CoinGecko proxy in production for CORS
  const finalUrl = maybeProxyCoinGecko(url);
  const key = buildKey(method, finalUrl, headers, body);

  // De-duplicate concurrent identical requests
  if (inFlightByKey.has(key)) {
    return inFlightByKey.get(key);
  }

  const exec = (async () => {
    let attempt = 0;
    while (true) {
      try {
        const response = await fetchWithTimeout(finalUrl, { method, headers, body }, timeoutMs);
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
  backoffBaseMs = DEFAULT_BACKOFF_BASE_MS
} = {}) {
  const key = buildKey('GET', url, headers, undefined);
  if (ttlMs > 0) {
    const cached = memoryCacheByKey.get(key);
    if (cached && (Date.now() - cached.storedAt) < ttlMs) {
      return cached.value;
    }
  }
  const value = await requestJson(url, { method: 'GET', headers, timeoutMs, retries, backoffBaseMs });
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


