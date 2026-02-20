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

export async function fetchPositions(address, timeoutMs = 10000) {
  if (!address) return null;

  // First get meta to find all vaults
  const meta = await post({ type: 'meta' }, timeoutMs).catch(() => null);

  const queries = [
    // Standard dex (main Hyperliquid)
    post({ type: 'clearinghouseState', user: address }, timeoutMs).catch(() => null),
    post({ type: 'spotClearinghouseState', user: address }, timeoutMs).catch(() => null),
    // Query xyz dex (trade.xyz HIP-3 markets)
    post({ type: 'clearinghouseState', user: address, dex: 'xyz' }, timeoutMs).catch(() => null)
  ];

  // Query additional HIP-3 vaults if discovered in meta
  if (meta?.vaults && Array.isArray(meta.vaults)) {
    for (const vault of meta.vaults) {
      queries.push(
        post({
          type: 'clearinghouseState',
          user: address,
          vaultAddress: vault.vaultAddress || vault.address || vault
        }, timeoutMs).catch(() => null)
      );
    }
  }

  const results = await Promise.all(queries);
  let [perp, spot, xyzDex, ...vaultResults] = results;

  // Merge xyz dex and vault positions into main perp response
  // Track which coins we've already seen to avoid duplicates
  const existingCoins = new Set((perp?.assetPositions || []).map(p => p.position?.coin).filter(Boolean));

  const perpSources = [perp, xyzDex, ...vaultResults].filter(Boolean);
  const combinedPerpEquity = perpSources.reduce((sum, source) => {
    const value = resolvePerpAccountValue(source);
    return sum + (value ?? 0);
  }, 0);

  if (!perp && (perpSources.length > 0 || combinedPerpEquity !== 0)) {
    perp = { assetPositions: [] };
  }

  if (perp) {
    if (!Array.isArray(perp.assetPositions)) {
      perp.assetPositions = [];
    }
    if (!perp.marginSummary || typeof perp.marginSummary !== 'object') {
      perp.marginSummary = {};
    }
    perp.marginSummary.accountValue = combinedPerpEquity.toString();
  }

  // Add xyz dex positions (trade.xyz equity perps)
  if (xyzDex?.assetPositions) {
    for (const pos of xyzDex.assetPositions) {
      const coin = pos.position?.coin;
      if (!existingCoins.has(coin)) {
        if (!perp) perp = { assetPositions: [] };
        if (!perp.assetPositions) perp.assetPositions = [];
        perp.assetPositions.push(pos);
        existingCoins.add(coin);
      }
    }
  }

  // Add positions from other HIP-3 vaults (if any discovered)
  for (const vaultData of vaultResults) {
    if (vaultData?.assetPositions) {
      for (const pos of vaultData.assetPositions) {
        const coin = pos.position?.coin;
        if (!existingCoins.has(coin)) {
          if (!perp) perp = { assetPositions: [] };
          if (!perp.assetPositions) perp.assetPositions = [];
          perp.assetPositions.push(pos);
          existingCoins.add(coin);
        }
      }
    }
  }

  return { perp, spot };
}

export async function fetchAllMids(timeoutMs = 10000) {
  return await post({ type: 'allMids' }, timeoutMs).catch(() => null);
}

export async function fetchMetaAndAssetCtxs(timeoutMs = 10000) {
  return await post({ type: 'metaAndAssetCtxs' }, timeoutMs).catch(() => null);
}

export async function fetchXyzDexMetaAndAssetCtxs(timeoutMs = 10000) {
  return await post({ type: 'metaAndAssetCtxs', dex: 'xyz' }, timeoutMs).catch(() => null);
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

export default {
  fetchPositions,
  fetchAllMids,
  fetchMetaAndAssetCtxs,
  fetchXyzDexMetaAndAssetCtxs,
  fetchSpotMeta,
  fetchSpotMetaAndAssetCtxs,
  fetchHistoricalPrice,
  buildSpotPriceMap,
  fetchCandles,
  resolvePerpAccountValue
};
