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

export async function getBatch24hPriceHistory(feedIds, points = 48) {
  if (!feedIds || feedIds.length === 0) return {};

  // Deduplicate feedIds and normalize them
  const uniqueFeedIds = [...new Set(feedIds)].map(id => id.toLowerCase().startsWith('0x') ? id.toLowerCase() : `0x${id.toLowerCase()}`);

  const now = Math.floor(Date.now() / 1000);
  const day = 24 * 60 * 60;
  const startTime = now - day;
  const interval = day / points;

  const timestamps = [];
  for (let i = 0; i < points; i++) {
    timestamps.push(Math.floor(startTime + (i * interval)));
  }

  // Initialize results map
  const results = {};
  uniqueFeedIds.forEach(id => {
    results[id] = [];
  });

  // Helper to process a batch of timestamps
  const processBatch = async (timestampBatch) => {
    const promises = timestampBatch.map(async (ts) => {
      try {
        // Construct URL with all feedIds
        const idsParam = uniqueFeedIds.map(id => `ids[]=${id}`).join('&');
        const url = `${HERMES}/updates/price/${ts}?${idsParam}&parsed=true`;

        const data = await HttpClient.getJson(url, { timeoutMs: 10000 }).catch(() => null);

        if (data && data.parsed && Array.isArray(data.parsed)) {
          data.parsed.forEach(update => {
            const id = update.id.startsWith('0x') ? update.id.toLowerCase() : `0x${update.id.toLowerCase()}`;
            // Find matching target ID
            const targetId = uniqueFeedIds.find(fid => fid === id);

            if (targetId && update.price) {
              const price = parseFloat(update.price.price) * Math.pow(10, update.price.expo);
              if (Number.isFinite(price) && price > 0) {
                results[targetId].push({
                  timestamp: ts,
                  price: price
                });
              }
            }
          });
        }
      } catch (e) {
        console.warn(`[Pyth] Failed to fetch batch for ts ${ts}:`, e);
      }
    });

    await Promise.all(promises);
  };

  // Process timestamps in chunks to avoid hitting rate limits too hard
  // Reduced chunk size and added more delay to prevent 429s
  const chunkSize = 4;
  for (let i = 0; i < timestamps.length; i += chunkSize) {
    const batch = timestamps.slice(i, i + chunkSize);
    await processBatch(batch);
    // Increased delay between chunks to 500ms
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Sort results by timestamp
  Object.keys(results).forEach(id => {
    results[id].sort((a, b) => a.timestamp - b.timestamp);
  });

  return results;
}

export async function get24hPriceHistory(feedId, timeoutMs = 10000) {
  const result = await getBatch24hPriceHistory([feedId], 48);
  return result[feedId.toLowerCase().startsWith('0x') ? feedId.toLowerCase() : `0x${feedId.toLowerCase()}`] || [];
}

export default { getPriceFeeds, getLatestByFeedIds, getAtTimestampByFeedIds, get24hPriceHistory, getBatch24hPriceHistory };


