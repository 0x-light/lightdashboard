// Hyperliquid provider client
import { HttpClient } from '../../http/client.js';

const HL_URL = 'https://api.hyperliquid.xyz/info';

async function post(body, timeoutMs) {
  return await HttpClient.requestJson(HL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs
  });
}

function parseFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function resolvePerpAccountValue(state) {
  if (!state) return null;

  const accountValue = parseFiniteNumber(state?.marginSummary?.accountValue);
  const crossAccountValue = parseFiniteNumber(state?.crossMarginSummary?.accountValue);
  const rawUsd = parseFiniteNumber(state?.marginSummary?.totalRawUsd);
  const crossRawUsd = parseFiniteNumber(state?.crossMarginSummary?.totalRawUsd);
  const withdrawable = parseFiniteNumber(state?.withdrawable);

  let best = null;
  for (const candidate of [accountValue, crossAccountValue, rawUsd, crossRawUsd]) {
    if (candidate !== null) {
      best = candidate;
      break;
    }
  }

  if (best !== null && withdrawable !== null) {
    if (best >= 0 && withdrawable >= 0) {
      return Math.max(best, withdrawable);
    }
    return best;
  }

  return best ?? withdrawable;
}

// HIP-3 dexes, named as the API names them ('' is the main dex). Positions, margin and
// orders live on each dex separately, and the account's value on Hyperliquid is the sum
// over all of them. The list rarely changes, so it's kept for a day (in localStorage too,
// so a page load doesn't wait for it); without it, the main and xyz dexes are assumed.
const FALLBACK_DEXES = ['', 'xyz'];
const PERP_DEXS_CACHE_KEY = 'hl_perp_dexs_v1';
const PERP_DEXS_TTL_MS = 24 * 60 * 60 * 1000;
let perpDexsCache = null; // { at, promise }
const activeDexesByUser = new Map(); // address -> dexes with money or positions, from the last fetchPositions

/** Dex names out of a `perpDexs` response: null is the main dex, the rest carry a name. */
export function perpDexNames(list) {
  const names = (Array.isArray(list) ? list : [])
    .map(d => (d === null ? '' : d?.name))
    .filter(n => typeof n === 'string');
  if (!names.includes('')) names.unshift('');
  return names;
}

export async function fetchPerpDexs(timeoutMs = 10000) {
  const now = Date.now();
  if (perpDexsCache && now - perpDexsCache.at < PERP_DEXS_TTL_MS) return perpDexsCache.promise;
  if (!perpDexsCache) {
    try {
      const cached = JSON.parse(localStorage.getItem(PERP_DEXS_CACHE_KEY) || 'null');
      if (cached && now - Number(cached.savedAt) < PERP_DEXS_TTL_MS && Array.isArray(cached.names)) {
        perpDexsCache = { at: Number(cached.savedAt), promise: Promise.resolve(cached.names) };
        return perpDexsCache.promise;
      }
    } catch (_) { /* no storage: fetch */ }
  }
  const promise = post({ type: 'perpDexs' }, timeoutMs)
    .then(list => {
      const names = perpDexNames(list);
      if (names.length < 2) throw new Error('perpDexs: empty');
      try { localStorage.setItem(PERP_DEXS_CACHE_KEY, JSON.stringify({ savedAt: now, names })); } catch (_) { /* in memory only */ }
      return names;
    })
    .catch(() => {
      perpDexsCache = null; // ask again next time
      return FALLBACK_DEXES;
    });
  perpDexsCache = { at: now, promise };
  return promise;
}

/** Dexes `address` had money or positions on at the last fetchPositions, or null before that. */
export function getUserDexes(address) {
  return activeDexesByUser.get(String(address || '').toLowerCase()) ?? null;
}

/**
 * One perp state for the account out of each dex's clearinghouse state: equity summed,
 * positions merged (the first dex to report a coin keeps it). `activeDexes` names the dexes
 * with at least a dollar or a position on them, so orders and margin ask only those.
 * `perp` is null only when no dex answered.
 */
export function combinePerpStates(states) {
  let perp = null;
  let equity = 0;
  const activeDexes = [];
  const seen = new Set();
  for (const { dex, state } of states || []) {
    if (!state) continue;
    const value = resolvePerpAccountValue(state) ?? 0;
    equity += value;
    const positions = Array.isArray(state.assetPositions) ? state.assetPositions : [];
    const open = positions.some(p => Math.abs(parseFloat(p?.position?.szi || 0)) > 0);
    if (value >= 1 || open) activeDexes.push(dex);
    if (!perp) {
      perp = dex === '' ? state : { assetPositions: [] };
      if (!Array.isArray(perp.assetPositions)) perp.assetPositions = [];
      if (!perp.marginSummary || typeof perp.marginSummary !== 'object') perp.marginSummary = {};
      if (dex === '') {
        for (const p of perp.assetPositions) if (p?.position?.coin) seen.add(p.position.coin);
        continue;
      }
    }
    for (const p of positions) {
      const coin = p?.position?.coin;
      if (!coin || seen.has(coin)) continue;
      perp.assetPositions.push(p);
      seen.add(coin);
    }
  }
  if (perp) perp.marginSummary.accountValue = equity.toString();
  return { perp, activeDexes };
}

export async function fetchPositions(address, timeoutMs = 10000) {
  if (!address) return null;

  // Spot and the clearinghouse state of every dex, all at once. `meta` has no dex list
  // (it's { universe, marginTables, collateralToken }); perpDexs has.
  const dexes = await fetchPerpDexs(timeoutMs);
  const [spot, ...states] = await Promise.all([
    post({ type: 'spotClearinghouseState', user: address }, timeoutMs).catch(() => null),
    ...dexes.map(dex => post(dex ? { type: 'clearinghouseState', user: address, dex } : { type: 'clearinghouseState', user: address }, timeoutMs)
      .catch(() => null))
  ]);

  const { perp, activeDexes } = combinePerpStates(dexes.map((dex, i) => ({ dex, state: states[i] })));
  activeDexesByUser.set(String(address).toLowerCase(), activeDexes);
  return { perp, spot, dexes: activeDexes };
}

export async function fetchAllMids(timeoutMs = 10000) {
  return await post({ type: 'allMids' }, timeoutMs).catch(() => null);
}

export async function fetchMetaAndAssetCtxs(timeoutMs = 10000) {
  return await post({ type: 'metaAndAssetCtxs' }, timeoutMs).catch(() => null);
}

/** Perp metadata and contexts (markPx, prevDayPx, funding) for one HIP-3 dex, e.g. 'xyz'. */
export async function fetchDexMetaAndAssetCtxs(dex, timeoutMs = 10000) {
  if (!dex) return await fetchMetaAndAssetCtxs(timeoutMs);
  return await post({ type: 'metaAndAssetCtxs', dex }, timeoutMs).catch(() => null);
}

export async function fetchSpotMeta(timeoutMs = 10000) {
  return await post({ type: 'spotMeta' }, timeoutMs).catch(() => null);
}

export async function fetchSpotMetaAndAssetCtxs(timeoutMs = 10000) {
  return await post({ type: 'spotMetaAndAssetCtxs' }, timeoutMs).catch(() => null);
}

export async function fetchHistoricalPrice(asset, timestamp, timeoutMs = 10000) {
  try {
    const data = await post({
      type: 'candleSnapshot',
      req: {
        coin: asset,
        interval: '1m',
        startTime: timestamp - 60000,
        endTime: timestamp + 60000
      }
    }, timeoutMs);
    if (Array.isArray(data) && data.length > 0) {
      const sorted = data.sort((a, b) => Math.abs((a.t || 0) - timestamp) - Math.abs((b.t || 0) - timestamp));
      const c = sorted[0];
      if (c && c.c) return parseFloat(c.c);
    }
    return null;
  } catch (_) {
    return null;
  }
}

export async function fetchCandles(coin, interval, startTime, endTime, timeoutMs = 10000) {
  try {
    const data = await post({
      type: 'candleSnapshot',
      req: {
        coin,
        interval,
        startTime,
        endTime
      }
    }, timeoutMs);

    if (Array.isArray(data)) {
      return data.map(c => ({
        t: c.t,
        o: parseFloat(c.o),
        h: parseFloat(c.h),
        l: parseFloat(c.l),
        c: parseFloat(c.c),
        v: parseFloat(c.v)
      }));
    }
    return [];
  } catch (e) {
    // 500 errors are common for assets without history or invalid requests
    // We shouldn't spam the console for expected failures on obscure assets
    if (e.message && e.message.includes('500')) {
      // console.debug(`[Hyperliquid] No candles found for ${coin} (500)`);
    } else {
      console.warn(`[Hyperliquid] Failed to fetch candles for ${coin}:`, e);
    }
    return [];
  }
}

/**
 * Build a price map that properly handles spot tokens.
 * Spot tokens are indexed as @{spotIndex} in allMids, but balances use token names.
 * This function creates a mapping from token name to price.
 * 
 * @param {Object} allMids - Result from fetchAllMids()
 * @param {Object} spotMeta - Result from fetchSpotMeta()
 * @returns {Object} Map from token name to price
 */
export function buildSpotPriceMap(allMids, spotMeta) {
  if (!allMids || !spotMeta || !spotMeta.universe) {
    return allMids || {};
  }

  const priceMap = { ...allMids };

  // Build mapping from token name to spot index
  // spotMeta.universe is an array where each entry is { name, tokens, index, isCanonical }
  // tokens is [baseTokenIndex, quoteTokenIndex] and we want pairs with USDC (token 0) as quote
  for (const spotPair of spotMeta.universe) {
    if (spotPair.tokens && spotPair.tokens[1] === 0) { // Quote token is USDC (index 0)
      const spotIndex = spotPair.index;
      const spotKey = `@${spotIndex}`;
      const tokenName = spotPair.name; // This is like "HYPE", "BZEC", etc.

      if (allMids[spotKey]) {
        priceMap[tokenName] = allMids[spotKey];
      }
    }
  }

  // Also check for tokens field which contains the name mapping
  if (spotMeta.tokens) {
    for (const token of spotMeta.tokens) {
      if (token.name && token.index !== undefined) {
        // Find the spot pair for this token paired with USDC
        const spotPair = spotMeta.universe.find(pair =>
          pair.tokens && pair.tokens[0] === token.index && pair.tokens[1] === 0
        );
        if (spotPair) {
          const spotKey = `@${spotPair.index}`;
          if (allMids[spotKey]) {
            priceMap[token.name] = allMids[spotKey];
          }
        }
      }
    }
  }

  return priceMap;
}

// Any read-only /info query (orders, portfolio, funding, fees, staking). Callers cache.
export async function fetchInfo(body, timeoutMs = 10000) {
  return await post(body, timeoutMs);
}

// Staked HYPE: { delegated, undelegated, totalPendingWithdrawal, nPendingWithdrawals }.
export async function fetchDelegatorSummary(address, timeoutMs = 10000) {
  if (!address) return null;
  return await post({ type: 'delegatorSummary', user: address }, timeoutMs);
}

export default {
  fetchInfo,
  fetchDelegatorSummary,
  fetchPositions,
  fetchPerpDexs,
  getUserDexes,
  combinePerpStates,
  perpDexNames,
  fetchAllMids,
  fetchMetaAndAssetCtxs,
  fetchDexMetaAndAssetCtxs,
  fetchSpotMeta,
  fetchSpotMetaAndAssetCtxs,
  fetchHistoricalPrice,
  buildSpotPriceMap,
  fetchCandles,
  resolvePerpAccountValue
};
