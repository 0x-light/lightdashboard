// CoinGecko provider client (uses Cloudflare proxy in production via HttpClient)
import { HttpClient } from '../../http/client.js';
import { buildCoinGeckoUrl } from '../../http/cors-proxy.js';

function proxy(url) {
  return buildCoinGeckoUrl(url);
}

// Prices are kept per coin, so callers that ask for different lists share them. Coins asked
// for within BATCH_MS of each other go out in one request; a coin already on its way waits
// for that request instead of starting another.
const BATCH_MS = 50;
const prices = new Map(); // id -> { value, at }
const inFlight = new Map(); // id -> the answer of the request that carries it
let batch = null; // { ids, timeoutMs, promise }

async function fetchPrices(ids, timeoutMs) {
  const url = proxy(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`);
  try {
    const data = await HttpClient.getJson(url, { timeoutMs });
    const at = Date.now();
    // A coin CoinGecko does not know is kept too, so it is not asked for again until it expires
    // (but an answer with none of them, like a rate-limit notice, is not kept)
    if (data && typeof data === 'object' && ids.some(id => data[id])) ids.forEach(id => prices.set(id, { value: data[id], at }));
    return data || {};
  } catch (_) {
    return {};
  } finally {
    ids.forEach(id => inFlight.delete(id));
  }
}

function queue(ids, timeoutMs) {
  if (!batch) {
    const b = batch = { ids: new Set(), timeoutMs };
    b.promise = new Promise(resolve => setTimeout(resolve, BATCH_MS)).then(() => {
      batch = null;
      return fetchPrices([...b.ids], b.timeoutMs);
    });
  }
  ids.forEach(id => { batch.ids.add(id); inFlight.set(id, batch.promise); });
  // The batch waits as long as its most patient caller would
  batch.timeoutMs = Math.max(batch.timeoutMs, timeoutMs);
  return batch.promise;
}

export async function getSimplePrice(idsCsv, { timeoutMs = 15000, ttlMs = 60000 } = {}) {
  if (!idsCsv) return {};
  const ids = [...new Set(String(idsCsv).split(',').map(id => id.trim()).filter(Boolean))];
  const now = Date.now();
  const result = {};
  const missing = [];
  const waits = new Set();
  for (const id of ids) {
    const hit = prices.get(id);
    if (hit && now - hit.at < ttlMs) {
      if (hit.value) result[id] = hit.value;
    } else if (inFlight.has(id)) {
      waits.add(inFlight.get(id));
    } else {
      missing.push(id);
    }
  }
  if (missing.length) waits.add(queue(missing, timeoutMs));
  for (const data of await Promise.all(waits)) {
    for (const id of ids) if (data?.[id]) result[id] = data[id];
  }
  return result;
}

export async function getHistoricalUsd(coinId, dateStr, { timeoutMs = 15000, ttlMs = 60000 } = {}) {
  const url = proxy(`https://api.coingecko.com/api/v3/coins/${coinId}/history?date=${dateStr}&localization=false`);
  const data = await HttpClient.getJson(url, { timeoutMs, ttlMs }).catch(() => null);
  const usd = data?.market_data?.current_price?.usd;
  return typeof usd === 'number' ? usd : null;
}

export default { getSimplePrice, getHistoricalUsd };

