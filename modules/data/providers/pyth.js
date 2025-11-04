// Pyth provider (Hermes REST)
import { HttpClient } from '../../http/client.js';

const HERMES = 'https://hermes.pyth.network/v2';

export async function getPriceFeeds(timeoutMs = 10000) {
  const feeds = await HttpClient.getJson(`${HERMES}/price_feeds`, { timeoutMs }).catch(() => []);
  const feedMap = {};
  if (Array.isArray(feeds)) {
    for (const feed of feeds) {
      const symbol = feed?.attributes?.symbol;
      const id = feed?.id;
      if (symbol && id) {
        const match = symbol.match(/Crypto\.([A-Z0-9]+)\/USD/i);
        if (match) {
          const asset = match[1].toUpperCase();
          const normalizedId = id.toLowerCase().startsWith('0x') ? id.toLowerCase() : `0x${id.toLowerCase()}`;
          feedMap[asset] = normalizedId;
        }
      }
    }
  }
  return feedMap;
}

export async function getLatestByFeedIds(feedIds, timeoutMs = 10000) {
  if (!Array.isArray(feedIds) || feedIds.length === 0) return {};
  const normalizedIds = feedIds.map(id => id.toLowerCase().startsWith('0x') ? id.toLowerCase() : `0x${id.toLowerCase()}`);
  const idsParam = normalizedIds.map(id => `ids[]=${id}`).join('&');
  const url = `${HERMES}/updates/price/latest?${idsParam}&parsed=true`;
  const data = await HttpClient.getJson(url, { timeoutMs }).catch(() => null);
  const prices = {};
  const parsed = data?.parsed || [];
  for (const p of parsed) {
    const id = p?.id ? (p.id.toLowerCase().startsWith('0x') ? p.id.toLowerCase() : `0x${p.id.toLowerCase()}`) : null;
    if (!id) continue;
    const price = parseFloat(p?.price?.price) * Math.pow(10, p?.price?.expo || 0);
    if (Number.isFinite(price)) prices[id] = price;
  }
  return prices;
}

export async function getAtTimestampByFeedIds(feedIds, timestampSeconds, timeoutMs = 10000) {
  if (!Array.isArray(feedIds) || feedIds.length === 0) return {};
  const normalizedIds = feedIds.map(id => id.toLowerCase().startsWith('0x') ? id.toLowerCase() : `0x${id.toLowerCase()}`);
  const idsParam = normalizedIds.map(id => `ids[]=${id}`).join('&');
  const url = `${HERMES}/updates/price/${timestampSeconds}?${idsParam}&parsed=true`;
  const data = await HttpClient.getJson(url, { timeoutMs }).catch(() => null);
  const prices = {};
  const parsed = data?.parsed || [];
  for (const p of parsed) {
    const id = p?.id ? (p.id.toLowerCase().startsWith('0x') ? p.id.toLowerCase() : `0x${p.id.toLowerCase()}`) : null;
    if (!id) continue;
    const price = parseFloat(p?.price?.price) * Math.pow(10, p?.price?.expo || 0);
    if (Number.isFinite(price)) prices[id] = price;
  }
  return prices;
}

export default { getPriceFeeds, getLatestByFeedIds, getAtTimestampByFeedIds };


