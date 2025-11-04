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

export default {
  fetchPositions,
  fetchAllMids,
  fetchMetaAndAssetCtxs,
  fetchHistoricalPrice
};


