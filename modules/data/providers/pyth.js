// Pyth provider (Hermes REST) with CORS proxy support
import { fetchWithCorsProxy } from '../../http/cors-proxy.js';
import { HttpClient } from '../../http/client.js';
import * as Hyperliquid from './hyperliquid.js';
import * as Stocks from './stocks.js';

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
let feedsMetadataCache = null;
// v5 adds the Commodities.Index feeds (24/7 Brent) and plain commodity names.
const FEEDS_CACHE_KEY = 'pyth_price_feeds_v5';
const FEEDS_METADATA_CACHE_KEY = 'pyth_feed_metadata_v5';
const FEEDS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const FEED_ID_PATTERN = /^0x[a-f0-9]{64}$/;
const LEGACY_FEEDS_CACHE_KEYS = ['pyth_price_feeds_v1', 'pyth_price_feeds_v2', 'pyth_price_feeds_v3', 'pyth_price_feeds_v4', 'pyth_feed_metadata_v2', 'pyth_feed_metadata_v3', 'pyth_feed_metadata_v4'];

// Pyth symbols are structured as `<Category>.<Rest>/<Quote>`. We extract a compact
// symbol (AAPL, BTC, EUR/USD, XAU) and the category so the UI can label stocks distinctly
// from crypto. Non-USD quotes are intentionally excluded — everything in the dashboard is USD.
const FEED_PARSERS = [
  {
    category: 'crypto',
    // Crypto.BTC/USD → BTC
    test: /^Crypto\.([A-Za-z0-9]+)\/USD$/i,
    extractSymbol: (m) => m[1].toUpperCase()
  },
  {
    category: 'equity',
    // Equity.US.AAPL/USD → AAPL  (also tolerate Equity.AAPL/USD just in case)
    test: /^Equity(?:\.[A-Z]{2})?\.([A-Za-z0-9._-]+)\/USD$/i,
    extractSymbol: (m) => m[1].toUpperCase()
  },
  {
    category: 'fx',
    // FX.EUR/USD → EUR/USD
    test: /^FX\.([A-Za-z]{3})\/USD$/i,
    extractSymbol: (m) => `${m[1].toUpperCase()}/USD`
  },
  {
    category: 'metal',
    // Metal.XAU/USD → XAU (gold), XAG (silver), etc.
    test: /^Metal\.([A-Za-z]+)\/USD$/i,
    extractSymbol: (m) => m[1].toUpperCase()
  },
  {
    category: 'commodity',
    // Commodities.WTI/USD, Commodity.WTI/USD, Commodities.Index.BRENT/USD (Pyth's 24/7 spot)
    test: /^Commodit(?:y|ies)\.(?:Index\.)?([A-Za-z0-9]+)\/USD$/i,
    extractSymbol: (m) => m[1].toUpperCase()
  }
];

// Pyth describes its commodity feeds as "PYTH PRICE IN USD FOR BRENT 24/7": the asset is the rest.
const FEED_NAMES = { BRENT: 'Brent crude', WTI: 'WTI crude', NATGAS: 'Natural gas' };
function feedName(feed, symbol) {
  const description = feed?.attributes?.description || feed?.attributes?.display_symbol || symbol;
  const commodity = /^PYTH PRICE IN USD FOR (.+?)(?: 24\/7)?$/i.exec(description);
  if (!commodity) return description;
  return FEED_NAMES[symbol] || commodity[1];
}

function parsePythFeed(feed) {
  const symbolField = feed?.attributes?.symbol;
  const id = feed?.id;
  if (!symbolField || !id) return null;

  for (const parser of FEED_PARSERS) {
    const m = symbolField.match(parser.test);
    if (m) {
      const symbol = parser.extractSymbol(m);
      if (!symbol) return null;
      const normalizedId = id.toLowerCase().startsWith('0x') ? id.toLowerCase() : `0x${id.toLowerCase()}`;
      return {
        symbol,
        id: normalizedId,
        category: parser.category,
        // display/description come from Pyth metadata when available — e.g. "Apple Inc.", "Bitcoin / US Dollar"
        name: feedName(feed, symbol),
        displaySymbol: feed?.attributes?.display_symbol || feed?.attributes?.generic_symbol || null,
        assetType: feed?.attributes?.asset_type || null,
        // Flag stocks as market-hours-sensitive so the UI can hint that prices may be stale off-hours.
        marketHours: parser.category === 'equity' ? 'us-equity' : null
      };
    }
  }
  return null;
}

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

// Load cached metadata from localStorage into memory on demand. Returns null if absent/expired.
function loadCachedMetadata() {
  if (feedsMetadataCache && (Date.now() - feedsCacheTimestamp < FEEDS_CACHE_TTL)) {
    return feedsMetadataCache;
  }
  try {
    const cached = localStorage?.getItem(FEEDS_METADATA_CACHE_KEY);
    if (!cached) return null;
    const { timestamp, data } = JSON.parse(cached);
    if (!data || !Array.isArray(data)) return null;
    if (Date.now() - timestamp >= FEEDS_CACHE_TTL) return null;
    feedsMetadataCache = data;
    feedsCacheTimestamp = timestamp;
    // Derive flat map from metadata so both functions stay in sync.
    feedsCache = buildFlatMap(data);
    return data;
  } catch (_) {
    return null;
  }
}

function buildFlatMap(metadata) {
  const map = {};
  if (!Array.isArray(metadata)) return map;
  // Resolve collisions: crypto wins over other categories if a ticker collides (preserves
  // behavior for existing wallet-asset enrichment callers that expect BTC/ETH/etc).
  const priorityOrder = { crypto: 0, equity: 1, fx: 2, metal: 3, commodity: 4 };
  const currentPriority = {};
  for (const feed of metadata) {
    if (!feed?.symbol || !feed?.id) continue;
    const existingPri = currentPriority[feed.symbol];
    const newPri = priorityOrder[feed.category] ?? 99;
    if (existingPri === undefined || newPri < existingPri) {
      map[feed.symbol] = feed.id;
      currentPriority[feed.symbol] = newPri;
    }
  }
  return map;
}

async function fetchAndCacheFeeds(timeoutMs) {
  const now = Date.now();
  const feeds = await fetchPyth('/price_feeds', timeoutMs) || [];
  const metadata = [];
  if (Array.isArray(feeds)) {
    for (const feed of feeds) {
      const parsed = parsePythFeed(feed);
      if (parsed) metadata.push(parsed);
    }
  }

  if (metadata.length > 0) {
    feedsMetadataCache = metadata;
    feedsCache = buildFlatMap(metadata);
    feedsCacheTimestamp = now;
    try {
      localStorage?.setItem(FEEDS_METADATA_CACHE_KEY, JSON.stringify({ timestamp: now, data: metadata }));
      localStorage?.setItem(FEEDS_CACHE_KEY, JSON.stringify({ timestamp: now, data: feedsCache }));
      // Older lists are no longer consulted; drop them to free quota.
      for (const key of LEGACY_FEEDS_CACHE_KEYS) localStorage?.removeItem(key);
    } catch (_) { /* ignore quota */ }
  }

  return metadata;
}

/**
 * Flat `{ symbol: feedId }` map across all supported asset classes (crypto, equity, FX, metal,
 * commodity). Existing callers that only care about crypto symbols still work because crypto
 * wins on ticker collisions (see `buildFlatMap`). Cached for 24h.
 */
export async function getPriceFeeds(timeoutMs = 15000) {
  if (feedsCache && (Date.now() - feedsCacheTimestamp < FEEDS_CACHE_TTL)) {
    return feedsCache;
  }
  if (loadCachedMetadata()) return feedsCache || {};

  try {
    await fetchAndCacheFeeds(timeoutMs);
    return feedsCache || {};
  } catch (e) {
    console.error('[Pyth] Failed to fetch price feeds', e);
    return feedsCache || {};
  }
}

/**
 * Rich metadata for each feed — { symbol, id, category, name, displaySymbol, assetType, marketHours }.
 * Used by the add-position search UI to show asset class and a friendly name (e.g. "AAPL — Apple Inc.").
 */
export async function getFeedsWithMetadata(timeoutMs = 15000) {
  if (feedsMetadataCache && (Date.now() - feedsCacheTimestamp < FEEDS_CACHE_TTL)) {
    return feedsMetadataCache;
  }
  if (loadCachedMetadata()) return feedsMetadataCache || [];

  try {
    return await fetchAndCacheFeeds(timeoutMs);
  } catch (e) {
    console.error('[Pyth] Failed to fetch price feeds (metadata)', e);
    return feedsMetadataCache || [];
  }
}

// ---------------------------------------------------------------------------------------------
// Keyless prices for Pyth feed ids
//
// Since Pyth's Core upgrade (Aug 26, 2026) every Hermes price endpoint (latest, by timestamp,
// streaming, benchmarks) answers 401 without an API key, and browser use of a key needs a
// backend minting short-lived tokens. Only /v2/price_feeds (metadata) is still open. So feed ids
// are mapped to symbols and priced from keyless sources the app already uses:
//   crypto → Hyperliquid (allMids / metaAndAssetCtxs prevDayPx / candleSnapshot), shared with
//            the Hyperliquid fetcher's identical requests through HttpClient's in-flight dedup;
//   equities, ETFs, FX, metals, commodities → Yahoo spark (price, previous close and intraday
//            history in one batched call, via our /api/yahoo proxy).
// Set to false to go back to Hermes once an authenticated route exists.
const HERMES_PRICES_NEED_KEY = true;
const KEYLESS_QUOTE_TTL_MS = 10 * 1000;
const KEYLESS_CANDLE_TTL_MS = 60 * 1000;

const feedHints = new Map(); // feedId -> { symbol, category }
const keylessQuoteCache = new Map(); // feedId -> { quote, at }
const keylessCandleCache = new Map(); // coin -> { promise, at }
let hlMidsCache = null; // { at, promise }
let hlPrevDayCache = null; // { at, promise }

// Yahoo tickers for the non-equity symbols Pyth uses. Spot metals and crude aren't on Yahoo's
// spark endpoint, so the front-month future stands in (within ~1% of spot).
const YAHOO_COMMODITY_SYMBOLS = {
  XAU: 'GC=F', XAG: 'SI=F', XPT: 'PL=F', XPD: 'PA=F', XCU: 'HG=F', COPPER: 'HG=F', CU: 'HG=F',
  WTI: 'CL=F', WTI1M: 'CL=F', USOILSPOT: 'CL=F'
};
const FUTURES_MONTH_CODES = 'FGHJKMNQUVXZ';

const weekend = d => d.getUTCDay() === 0 || d.getUTCDay() === 6;

// A month's last business day (n = 0), or the nth business day before the month starts.
function businessDayUTC(year, month, n) {
  if (n === 0) {
    const d = new Date(Date.UTC(year, month + 1, 0));
    while (weekend(d)) d.setUTCDate(d.getUTCDate() - 1);
    return d;
  }
  const d = new Date(Date.UTC(year, month, 1));
  for (let left = n; left > 0;) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (!weekend(d)) left--;
  }
  return d;
}

// Futures on Yahoo by Pyth's root: Yahoo's root, exchange and when a contract for a delivery
// month stops trading. Brent: the last business day of the second month before. Henry Hub gas:
// three business days before the delivery month.
const FUTURES = {
  BRENT: { root: 'BZ', exchange: 'NYM', expiry: (y, m) => businessDayUTC(y, m - 2, 0) },
  HN: { root: 'NG', exchange: 'NYM', expiry: (y, m) => businessDayUTC(y, m, 3) },
  CLL: { root: 'CL', exchange: 'NYM' },
  CA: { root: 'CC', exchange: 'NYB' }
};
// Pyth's spot feeds where Yahoo's continuous future (BZ=F, NG=F) rolls weeks before expiry and
// sits off the cash price: these take the contract nearest expiry.
const FRONT_MONTH = { BRENT: 'BRENT', BRENT1M: 'BRENT', UKOILSPOT: 'BRENT', NATGAS: 'HN', NGAS: 'HN', HHGAS1M: 'HN', HLGAS1M: 'HN' };

const contractTicker = (f, year, month) =>
  `${f.root}${FUTURES_MONTH_CODES[month]}${String(year % 100).padStart(2, '0')}.${f.exchange}`;

export function frontMonthTicker(root, now = new Date()) {
  const f = FUTURES[root];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let ahead = 0; ahead < 4; ahead++) {
    const delivery = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + ahead, 1));
    const y = delivery.getUTCFullYear();
    const m = delivery.getUTCMonth();
    if (f.expiry(y, m).getTime() >= today) return contractTicker(f, y, m);
  }
  return null;
}

// Pyth's dated feeds (BRENTZ6 = December 2026 Brent, CLLZ6 WTI, HNX6 gas) map to Yahoo's
// matching contract.
function datedContractTicker(symbol, now = new Date()) {
  const m = /^([A-Z]+?)([FGHJKMNQUVXZ])(\d)$/.exec(symbol);
  const f = m && FUTURES[m[1]];
  if (!f) return null;
  const year = now.getUTCFullYear();
  let contractYear = year - (year % 10) + Number(m[3]);
  if (contractYear < year - 1) contractYear += 10;
  return contractTicker(f, contractYear, FUTURES_MONTH_CODES.indexOf(m[2]));
}

function yahooCommoditySymbol(symbol) {
  if (FRONT_MONTH[symbol]) return frontMonthTicker(FRONT_MONTH[symbol]);
  return YAHOO_COMMODITY_SYMBOLS[symbol] || datedContractTicker(symbol);
}

/**
 * Callers that already know a feed's symbol (manual positions store it) register it here, so
 * pricing doesn't have to download Pyth's ~1MB feed list just to learn that an id means "ETH".
 */
export function registerFeedHints(hints) {
  for (const hint of Array.isArray(hints) ? hints : []) {
    const id = normalizeFeedId(hint?.id);
    const symbol = String(hint?.symbol || '').trim().toUpperCase();
    if (id && symbol) feedHints.set(id, { symbol, category: String(hint.category || 'crypto').toLowerCase() });
  }
}

async function resolveFeedSymbols(ids) {
  const out = new Map();
  const missing = [];
  for (const id of ids) {
    if (feedHints.has(id)) out.set(id, feedHints.get(id));
    else missing.push(id);
  }
  if (missing.length === 0) return out;
  const metadata = loadCachedMetadata() || await getFeedsWithMetadata();
  const byId = new Map((metadata || []).map(feed => [feed.id, feed]));
  for (const id of missing) {
    const feed = byId.get(id);
    if (feed?.symbol) out.set(id, { symbol: feed.symbol, category: feed.category || 'crypto' });
  }
  return out;
}

function yahooSymbolForFeed({ symbol, category }) {
  if (category === 'fx') {
    const [base, quote] = symbol.split('/');
    return base && quote ? `${base}${quote}=X` : null;
  }
  if (category === 'metal' || category === 'commodity') return yahooCommoditySymbol(symbol);
  if (['equity', 'etf', 'fund', 'stock', 'index'].includes(category)) {
    return /^[A-Z^][A-Z0-9.\-=^]{0,11}$/.test(symbol) ? symbol : null;
  }
  return null;
}

function getHyperliquidMids() {
  const now = Date.now();
  if (hlMidsCache && now - hlMidsCache.at < KEYLESS_QUOTE_TTL_MS) return hlMidsCache.promise;
  const promise = Hyperliquid.fetchAllMids(4000).then(mids => mids || {}).catch(() => ({}));
  hlMidsCache = { at: now, promise };
  return promise;
}

// prevDayPx lives in metaAndAssetCtxs (~70KB), so it's only fetched when a 24h-ago price is asked for.
function getHyperliquidPrevDay() {
  const now = Date.now();
  if (hlPrevDayCache && now - hlPrevDayCache.at < KEYLESS_QUOTE_TTL_MS) return hlPrevDayCache.promise;
  const promise = Hyperliquid.fetchMetaAndAssetCtxs(4000).then(metaAndCtxs => {
    const prevDay = {};
    const universe = metaAndCtxs?.[0]?.universe || [];
    const ctxs = metaAndCtxs?.[1] || [];
    for (let i = 0; i < ctxs.length; i++) {
      const name = universe[i]?.name;
      const prev = Number(ctxs[i]?.prevDayPx);
      if (name && prev > 0) prevDay[name] = prev;
    }
    return prevDay;
  }).catch(() => ({}));
  hlPrevDayCache = { at: now, promise };
  return promise;
}

// Hyperliquid lists some low-priced coins per 1000 units (kPEPE, kSHIB, kBONK).
function hyperliquidCoinFor(symbol, mids) {
  if (Number(mids[symbol]) > 0) return { coin: symbol, scale: 1 };
  if (Number(mids[`k${symbol}`]) > 0) return { coin: `k${symbol}`, scale: 1 / 1000 };
  return null;
}

/**
 * Current quote per feed id: { price, priceHistory?, source, coin?/yahooSymbol? }, plus
 * prevDayPrice where the source returns it with the quote (Yahoo) — Hyperliquid's comes from
 * getPrevDayPrice(). Ids that no keyless source covers are absent.
 */
async function getKeylessQuotes(ids) {
  const now = Date.now();
  const result = {};
  const toFetch = [];
  for (const id of ids) {
    const cached = keylessQuoteCache.get(id);
    if (cached && now - cached.at < KEYLESS_QUOTE_TTL_MS) {
      if (cached.quote) result[id] = cached.quote;
    } else {
      toFetch.push(id);
    }
  }
  if (toFetch.length === 0) return result;

  const symbols = await resolveFeedSymbols(toFetch);
  const cryptoIds = toFetch.filter(id => symbols.get(id)?.category === 'crypto');
  const yahooById = new Map();
  for (const id of toFetch) {
    const meta = symbols.get(id);
    const yahooSymbol = meta && meta.category !== 'crypto' ? yahooSymbolForFeed(meta) : null;
    if (yahooSymbol) yahooById.set(id, yahooSymbol);
  }

  const [mids, yahooQuotes] = await Promise.all([
    cryptoIds.length > 0 ? getHyperliquidMids() : null,
    yahooById.size > 0
      ? Stocks.getQuotes(Array.from(new Set(yahooById.values())), { timeoutMs: 4000 }).catch(() => ({}))
      : {}
  ]);

  for (const id of toFetch) {
    let quote = null;
    const meta = symbols.get(id);
    if (mids && meta?.category === 'crypto') {
      const match = hyperliquidCoinFor(meta.symbol, mids);
      if (match) {
        quote = {
          price: Number(mids[match.coin]) * match.scale,
          source: 'hyperliquid',
          coin: match.coin,
          scale: match.scale
        };
      }
    } else if (yahooById.has(id)) {
      const q = yahooQuotes?.[yahooById.get(id)];
      if (Number(q?.price) > 0) {
        quote = {
          price: Number(q.price),
          prevDayPrice: Number(q.previousClose) > 0 ? Number(q.previousClose) : null,
          priceHistory: q.priceHistory,
          source: 'yahoo',
          yahooSymbol: yahooById.get(id)
        };
      }
    }
    keylessQuoteCache.set(id, { quote, at: now });
    if (quote) result[id] = quote;
  }
  return result;
}

function getHyperliquidCandles(coin, now) {
  const cached = keylessCandleCache.get(coin);
  if (cached && now - cached.at < KEYLESS_CANDLE_TTL_MS) return cached.promise;
  const promise = Hyperliquid.fetchCandles(coin, '15m', now - 24 * 60 * 60 * 1000, now, 5000).catch(() => []);
  keylessCandleCache.set(coin, { promise, at: now });
  return promise;
}

function downsample(points, count) {
  if (!Array.isArray(points) || points.length <= count) return points || [];
  const step = (points.length - 1) / (count - 1);
  const out = [];
  for (let i = 0; i < count; i++) out.push(points[Math.round(i * step)]);
  return out;
}

async function getKeylessHistory(ids, points, endTime) {
  const quotes = await getKeylessQuotes(ids);
  const results = {};
  await Promise.all(ids.map(async (id) => {
    const quote = quotes[id];
    let history = [];
    if (quote?.source === 'hyperliquid') {
      const candles = await getHyperliquidCandles(quote.coin, endTime);
      history = candles.map(c => ({ timestamp: Math.floor(c.t / 1000), price: c.c * quote.scale }));
    } else if (quote?.source === 'yahoo' && Array.isArray(quote.priceHistory)) {
      history = quote.priceHistory.map(p => ({ timestamp: Math.floor(p.timestamp / 1000), price: p.price }));
    }
    results[id] = downsample(history.filter(p => Number.isFinite(p.price) && p.price > 0), points);
  }));
  return results;
}

/**
 * Price history per feed id over a longer window, from the same keyless sources as the quotes:
 * `{ ms, hl, yahoo: [range, interval] }` names the window, the Hyperliquid candle interval and
 * the Yahoo chart range. Points are `{ timestamp (ms), price, volume }`, at most `points` of them.
 */
// Where a feed's prices come from, once it has been quoted: 'hyperliquid' or 'yahoo'.
export function historySource(feedId) {
  return keylessQuoteCache.get(normalizeFeedId(feedId))?.quote?.source || null;
}

export async function getPeriodHistoryByFeedIds(feedIds, { ms, hl, yahoo }, points = 120) {
  const ids = Array.from(new Set((feedIds || []).map(normalizeFeedId).filter(Boolean)));
  if (ids.length === 0) return {};
  const quotes = await getKeylessQuotes(ids);
  const now = Date.now();
  const results = {};
  await Promise.all(ids.map(async (id) => {
    const quote = quotes[id];
    let history = [];
    if (quote?.source === 'hyperliquid') {
      const candles = await Hyperliquid.fetchCandles(quote.coin, hl, now - ms, now, 8000).catch(() => []);
      history = candles.map(c => ({ timestamp: c.t, price: c.c * quote.scale, volume: c.v }));
    } else if (quote?.source === 'yahoo') {
      const [range, interval] = yahoo;
      history = await Stocks.get24hPriceHistory(quote.yahooSymbol, { range, interval, timeoutMs: 8000 }).catch(() => []);
    }
    results[id] = downsample(history.filter(p => Number.isFinite(p.price) && p.price > 0), points);
  }));
  return results;
}

async function getKeylessPricesAt(ids, timestampSeconds) {
  const quotes = await getKeylessQuotes(ids);
  const prices = {};
  const targetMs = timestampSeconds * 1000;
  // "24h ago" is what nearly every caller asks for, and both sources already return it.
  const isDayAgo = Math.abs(Date.now() - 24 * 60 * 60 * 1000 - targetMs) < 2 * 60 * 60 * 1000;
  const prevDay = isDayAgo && Object.values(quotes).some(q => q.source === 'hyperliquid')
    ? await getHyperliquidPrevDay()
    : {};
  await Promise.all(ids.map(async (id) => {
    const quote = quotes[id];
    if (!quote) return;
    const dayAgoPrice = quote.source === 'hyperliquid'
      ? Number(prevDay[quote.coin]) * quote.scale
      : quote.prevDayPrice;
    if (isDayAgo && dayAgoPrice > 0) {
      prices[id] = dayAgoPrice;
      return;
    }
    if (quote.source === 'hyperliquid') {
      const ageDays = (Date.now() - targetMs) / 86400000;
      // Hyperliquid keeps the latest 5000 candles per interval: 1m covers ~3.5 days, 1h ~200.
      const interval = ageDays < 3 ? '1m' : (ageDays < 200 ? '1h' : '1d');
      const span = { '1m': 60e3, '1h': 3600e3, '1d': 86400e3 }[interval];
      const candles = await Hyperliquid.fetchCandles(quote.coin, interval, targetMs - span, targetMs + span, 5000).catch(() => []);
      const closest = candles.sort((a, b) => Math.abs(a.t - targetMs) - Math.abs(b.t - targetMs))[0];
      if (closest?.c > 0) prices[id] = closest.c * quote.scale;
    } else if (quote.source === 'yahoo') {
      const date = new Date(targetMs).toISOString().slice(0, 10);
      const price = await Stocks.getHistoricalPrice(quote.yahooSymbol, date).catch(() => null);
      if (price > 0) prices[id] = price;
    }
  }));
  return prices;
}

/**
 * 24h-ago USD prices keyed by crypto symbol, straight from Hyperliquid's prevDayPx. Lets the
 * portfolio fill missing 24h changes without first mapping symbols to Pyth feed ids (which needs
 * the ~1MB feed list). Symbols Hyperliquid doesn't list are absent.
 */
export async function getDayAgoPricesBySymbol(symbols) {
  const [mids, prevDay] = await Promise.all([getHyperliquidMids(), getHyperliquidPrevDay()]);
  const out = {};
  for (const raw of Array.isArray(symbols) ? symbols : []) {
    const symbol = String(raw || '').toUpperCase();
    const match = symbol ? hyperliquidCoinFor(symbol, mids) : null;
    const prev = match ? Number(prevDay[match.coin]) : 0;
    if (prev > 0) out[symbol] = prev * match.scale;
  }
  return out;
}

export async function getLatestByFeedIds(feedIds, timeoutMs = 10000, bypassCache = false) {
  if (HERMES_PRICES_NEED_KEY) {
    const ids = Array.from(new Set((feedIds || []).map(normalizeFeedId).filter(Boolean)));
    if (ids.length === 0) return {};
    if (bypassCache) ids.forEach(id => keylessQuoteCache.delete(id));
    const quotes = await getKeylessQuotes(ids);
    return Object.fromEntries(Object.entries(quotes).map(([id, q]) => [id, q.price]));
  }
  if (isLocalPythDisabled()) return {};
  const normalizedIds = normalizeFeedIds(feedIds);
  if (normalizedIds.length === 0) return {};
  const idsParam = normalizedIds.map(id => `ids[]=${id}`).join('&');
  const data = await fetchPyth(`/updates/price/latest?${idsParam}&parsed=true`, timeoutMs, bypassCache);
  return parseParsedPrices(data);
}

export async function getAtTimestampByFeedIds(feedIds, timestampSeconds, timeoutMs = 10000) {
  if (HERMES_PRICES_NEED_KEY) {
    const ids = Array.from(new Set((feedIds || []).map(normalizeFeedId).filter(Boolean)));
    return ids.length > 0 ? getKeylessPricesAt(ids, Number(timestampSeconds)) : {};
  }
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
  if (HERMES_PRICES_NEED_KEY) {
    const ids = Array.from(new Set(feedIds.map(normalizeFeedId).filter(Boolean)));
    return ids.length > 0 ? getKeylessHistory(ids, points, endTime) : {};
  }

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

// Exposed for tests; not meant for general consumers.
export const _internal = { parsePythFeed, buildFlatMap };

export default { getPriceFeeds, getFeedsWithMetadata, getLatestByFeedIds, getAtTimestampByFeedIds, get24hPriceHistory, getBatch24hPriceHistory, registerFeedHints, getDayAgoPricesBySymbol };
