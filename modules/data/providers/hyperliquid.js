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

export async function fetchPositions(address, timeoutMs = 10000) {
  if (!address) return null;
  const [perp, spot] = await Promise.all([
    post({ type: 'clearinghouseState', user: address }, timeoutMs).catch(() => null),
    post({ type: 'spotClearinghouseState', user: address }, timeoutMs).catch(() => null)
  ]);
  return { perp, spot };
}

export async function fetchAllMids(timeoutMs = 10000) {
  return await post({ type: 'allMids' }, timeoutMs).catch(() => null);
}

export async function fetchMetaAndAssetCtxs(timeoutMs = 10000) {
  return await post({ type: 'metaAndAssetCtxs' }, timeoutMs).catch(() => null);
}

export async function fetchSpotMeta(timeoutMs = 10000) {
  return await post({ type: 'spotMeta' }, timeoutMs).catch(() => null);
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
  fetchSpotMeta,
  fetchHistoricalPrice,
  buildSpotPriceMap
};


