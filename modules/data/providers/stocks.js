// Yahoo Finance provider for stocks, ETFs, indices, FX, commodities, and (bonus) crypto.
// Endpoints:
//   - Search:      GET https://query2.finance.yahoo.com/v1/finance/search?q=<query>
//   - Quote batch: GET https://query1.finance.yahoo.com/v8/finance/spark?symbols=<csv>&range=1d&interval=5m
//                  (spark is unauthenticated and batched; /v7/finance/quote requires a crumb
//                  as of ~2023 and silently fails without one — don't use it)
//   - Historical:  GET https://query1.finance.yahoo.com/v8/finance/chart/<symbol>?period1=<ts>&period2=<ts>&interval=1d
//
// The HTTP client auto-proxies both Yahoo hostnames through /api/yahoo (Cloudflare Pages
// Function) so the browser sidesteps CORS. This provider issues plain URLs.

import { HttpClient } from '../../http/client.js';

const SEARCH_BASE = 'https://query2.finance.yahoo.com/v1/finance/search';
const SPARK_BASE = 'https://query1.finance.yahoo.com/v8/finance/spark';
const CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

// Yahoo returns a `quoteType` per match — we map it to the same category vocabulary used by
// the rest of the app so the UI can show consistent chips.
function categoryFromQuoteType(quoteType) {
  switch (String(quoteType || '').toUpperCase()) {
    case 'EQUITY': return 'equity';
    case 'ETF': return 'etf';
    case 'MUTUALFUND': return 'fund';
    case 'INDEX': return 'index';
    case 'CURRENCY': return 'fx';
    case 'FUTURE': return 'commodity';
    case 'CRYPTOCURRENCY': return 'crypto';
    default: return 'other';
  }
}

/**
 * Live symbol search. Returns up to `limit` matches with { symbol, name, category, exchange }.
 * Yahoo's search endpoint handles fuzzy queries ("apple", "tesla", "brk.b", etc.) and returns
 * matches across all asset types in a single call.
 */
export async function searchSymbols(query, { limit = 15, timeoutMs = 4000 } = {}) {
  const q = String(query || '').trim();
  if (q.length < 1) return [];

  const url = `${SEARCH_BASE}?q=${encodeURIComponent(q)}&quotesCount=${limit}&newsCount=0&enableFuzzyQuery=true&quotesQueryId=tss_match_phrase_query`;
  try {
    const data = await HttpClient.getJson(url, { timeoutMs, ttlMs: 60_000, retries: 1 });
    const quotes = Array.isArray(data?.quotes) ? data.quotes : [];
    const out = [];
    for (const q of quotes) {
      const symbol = q?.symbol;
      if (!symbol) continue;
      // Skip duplicate-ish matches that don't have pricing (e.g. news-only hits).
      out.push({
        symbol,
        name: q.shortname || q.longname || symbol,
        longName: q.longname || null,
        exchange: q.exchDisp || q.exchange || null,
        category: categoryFromQuoteType(q.quoteType),
        provider: 'yahoo',
        marketHours: q.quoteType === 'EQUITY' || q.quoteType === 'ETF' ? 'us-equity' : null
      });
    }
    return out;
  } catch (e) {
    console.warn('[Stocks] Search failed:', e?.message || e);
    return [];
  }
}

// Pull the most recent non-null close from Yahoo's spark response. Spark returns nulls for
// pre-market / after-hours slots when no prints have happened yet; we walk backwards to find
// the last real quote so the UI never shows "null".
function lastFiniteClose(closes) {
  if (!Array.isArray(closes)) return null;
  for (let i = closes.length - 1; i >= 0; i--) {
    const v = Number(closes[i]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * Batch quote lookup via Yahoo's `/v8/finance/spark` endpoint. Returns a map keyed by symbol
 * with current price, 24h change %, previous close, and sparkline data points. Missing or
 * invalid symbols are absent from the map.
 *
 * We use `spark` instead of `/v7/finance/quote` because the latter was locked behind a crumb
 * cookie in ~2023 and silently returns empty for unauthenticated callers; spark has stayed
 * open and gives us the same price data plus intraday candles in a single round-trip.
 */
export async function getQuotes(symbols, { timeoutMs = 5000 } = {}) {
  if (!Array.isArray(symbols) || symbols.length === 0) return {};
  const unique = Array.from(new Set(symbols.map(s => String(s || '').trim()).filter(Boolean)));
  if (unique.length === 0) return {};

  const CHUNK = 40;
  const chunks = [];
  for (let i = 0; i < unique.length; i += CHUNK) chunks.push(unique.slice(i, i + CHUNK));

  const merged = {};
  const results = await Promise.all(chunks.map(async (chunk) => {
    const url = `${SPARK_BASE}?symbols=${encodeURIComponent(chunk.join(','))}&range=1d&interval=5m&includePrePost=false`;
    try {
      // Spark responds as { "<SYMBOL>": { close, timestamp, previousClose, ... } }
      return await HttpClient.getJson(url, { timeoutMs, ttlMs: 15_000, retries: 1 });
    } catch (e) {
      console.warn('[Stocks] Spark chunk failed:', e?.message || e);
      return {};
    }
  }));

  for (const data of results) {
    if (!data || typeof data !== 'object') continue;
    for (const [sym, payload] of Object.entries(data)) {
      if (!payload || typeof payload !== 'object') continue;
      const price = lastFiniteClose(payload.close);
      const prevClose = Number(payload.previousClose ?? payload.chartPreviousClose);
      if (!Number.isFinite(price)) continue;

      // Spark gives us sparkline data for free — carry it through so the watchlist / manual
      // fetcher doesn't need to make a second chart request.
      const priceHistory = [];
      if (Array.isArray(payload.timestamp) && Array.isArray(payload.close)) {
        for (let i = 0; i < payload.timestamp.length; i++) {
          const ts = Number(payload.timestamp[i]);
          const c = Number(payload.close[i]);
          if (Number.isFinite(ts) && Number.isFinite(c)) {
            priceHistory.push({ timestamp: ts * 1000, price: c });
          }
        }
      }

      const change24h = Number.isFinite(prevClose) && prevClose > 0
        ? ((price - prevClose) / prevClose) * 100
        : null;

      merged[sym] = {
        symbol: sym,
        name: sym,
        price,
        change24h,
        previousClose: Number.isFinite(prevClose) ? prevClose : null,
        currency: 'USD',
        marketState: null, // spark doesn't expose this — caller can infer from time-of-day
        exchange: null,
        priceHistory
      };
    }
  }
  return merged;
}

/**
 * Fetch the closing price at or immediately before the given date (UTC). Yahoo's chart
 * endpoint returns daily candles; we pick the last candle with `ts <= target` so weekends
 * and holidays fall back to the most recent trading day's close. Returns null if there's
 * no usable data (ticker doesn't exist, date in the future, etc.).
 */
export async function getHistoricalPrice(symbol, dateStr, { timeoutMs = 5000 } = {}) {
  if (!symbol || !dateStr) return null;
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return null;

  const targetTs = Math.floor(Date.UTC(y, m - 1, d, 23, 59, 59) / 1000);
  if (targetTs * 1000 > Date.now()) return null;

  // Fetch a small window before the target to survive weekends / holidays.
  const period1 = targetTs - 14 * 24 * 60 * 60;
  const period2 = targetTs + 24 * 60 * 60;
  const url = `${CHART_BASE}/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false`;

  try {
    const data = await HttpClient.getJson(url, { timeoutMs, ttlMs: 60_000, retries: 1 });
    const result = data?.chart?.result?.[0];
    const timestamps = result?.timestamp;
    const closes = result?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(timestamps) || !Array.isArray(closes)) return null;

    let bestPrice = null;
    let bestTs = -Infinity;
    for (let i = 0; i < timestamps.length; i++) {
      const ts = Number(timestamps[i]);
      const price = Number(closes[i]);
      if (!Number.isFinite(ts) || !Number.isFinite(price)) continue;
      if (ts <= targetTs && ts > bestTs) {
        bestTs = ts;
        bestPrice = price;
      }
    }
    return bestPrice;
  } catch (e) {
    console.warn('[Stocks] Historical lookup failed:', e?.message || e);
    return null;
  }
}

/**
 * Fetch an intraday / short-range history for sparkline rendering. Returns an array of
 * `{ timestamp, price }`, newest last. `range` is in Yahoo's format (1d, 5d, 1mo, etc.).
 */
export async function get24hPriceHistory(symbol, { timeoutMs = 5000, range = '1d', interval = '15m' } = {}) {
  if (!symbol) return [];
  const url = `${CHART_BASE}/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  try {
    const data = await HttpClient.getJson(url, { timeoutMs, ttlMs: 60_000, retries: 1 });
    const result = data?.chart?.result?.[0];
    const timestamps = result?.timestamp;
    const closes = result?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(timestamps) || !Array.isArray(closes)) return [];
    const series = [];
    for (let i = 0; i < timestamps.length; i++) {
      const ts = Number(timestamps[i]);
      const price = Number(closes[i]);
      if (Number.isFinite(ts) && Number.isFinite(price)) {
        series.push({ timestamp: ts * 1000, price });
      }
    }
    return series;
  } catch (e) {
    console.warn('[Stocks] Chart history failed:', e?.message || e);
    return [];
  }
}

export default { searchSymbols, getQuotes, getHistoricalPrice, get24hPriceHistory };
