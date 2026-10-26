// Hyperliquid candles shared by the chart window and the portfolio's history: the same
// coin, interval and window asked by both (the chart's 1D and the portfolio's day, the
// chart's 1Y and the portfolio's all-time) is one request. A request still running is
// shared; an answer is kept a minute. Nothing is kept for an empty answer (a refusal or
// a coin with no history), so the next ask tries again.
import { fetchCandles } from './providers/hyperliquid.js';

const TTL_MS = 60 * 1000;
const cache = new Map(); // `${coin}|${interval}|${windowMs}` -> { at, promise }

// The candles of the `windowMs` up to now.
export function recentCandles(coin, interval, windowMs, timeoutMs = 8000) {
  const id = `${coin}|${interval}|${windowMs}`;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const now = Date.now();
  const promise = fetchCandles(coin, interval, now - windowMs, now, timeoutMs)
    .then(list => list || [])
    .catch(() => []);
  const entry = { at: now, promise };
  cache.set(id, entry);
  promise.then(list => { if (!list.length && cache.get(id) === entry) cache.delete(id); });
  return promise;
}
