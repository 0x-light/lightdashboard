/**
 * CoinGecko Request Batcher
 * Batches multiple CoinGecko requests to reduce API calls and improve performance
 */

const BATCH_DELAY = 50; // Wait 50ms to collect requests before sending
const MAX_BATCH_SIZE = 250; // CoinGecko API limit per request
let pendingBatch = new Set();
let batchTimer = null;
let resolvers = new Map();

/**
 * Batch CoinGecko price requests
 * @param {string} coinId - CoinGecko coin ID
 * @param {Object} provider - CoinGecko provider instance
 * @param {Object} options - Request options (timeoutMs, ttlMs)
 * @returns {Promise} - Resolves with price data for the requested coin
 */
export async function batchGetSimplePrice(coinId, provider, options = {}) {
  if (!coinId || !provider) {
    throw new Error('coinId and provider are required');
  }

  // Add to pending batch
  pendingBatch.add(coinId);

  // Create promise for this request
  const promise = new Promise((resolve, reject) => {
    if (!resolvers.has(coinId)) {
      resolvers.set(coinId, []);
    }
    resolvers.get(coinId).push({ resolve, reject });
  });

  // Schedule batch execution if not already scheduled
  if (!batchTimer) {
    batchTimer = setTimeout(async () => {
      await executeBatch(provider, options);
    }, BATCH_DELAY);
  }

  return promise;
}

/**
 * Execute the batched request
 */
async function executeBatch(provider, options) {
  const coinsToFetch = Array.from(pendingBatch);
  const currentResolvers = new Map(resolvers);

  // Clear batch state
  pendingBatch.clear();
  resolvers.clear();
  batchTimer = null;

  if (coinsToFetch.length === 0) return;

  try {
    // Split into chunks if needed (CoinGecko has limits)
    const chunks = [];
    for (let i = 0; i < coinsToFetch.length; i += MAX_BATCH_SIZE) {
      chunks.push(coinsToFetch.slice(i, i + MAX_BATCH_SIZE));
    }

    // Fetch all chunks in parallel
    const results = await Promise.all(
      chunks.map(chunk => 
        provider.getSimplePrice(chunk.join(','), options).catch(() => ({}))
      )
    );

    // Merge results
    const mergedData = results.reduce((acc, data) => ({ ...acc, ...data }), {});

    // Resolve all pending promises
    for (const coinId of coinsToFetch) {
      const data = mergedData[coinId] || null;
      const callbacks = currentResolvers.get(coinId) || [];
      for (const { resolve } of callbacks) {
        resolve(data);
      }
    }
  } catch (error) {
    console.error('[CoinGeckoBatcher] Batch request failed:', error);
    // Reject all pending promises
    for (const coinId of coinsToFetch) {
      const callbacks = currentResolvers.get(coinId) || [];
      for (const { reject } of callbacks) {
        reject(error);
      }
    }
  }
}

/**
 * Batch enrich positions with CoinGecko 24h change data
 * @param {Array} positions - Array of positions with asset symbols
 * @param {Function} getCoingeckoId - Function to map asset symbol to CoinGecko ID
 * @param {Object} provider - CoinGecko provider instance
 * @param {Object} options - Request options
 * @returns {Promise<Array>} - Enriched positions array
 */
export async function batchEnrichPositions(positions, getCoingeckoId, provider, options = {}) {
  if (!Array.isArray(positions) || positions.length === 0) {
    return positions;
  }

  try {
    // Get unique assets that need enrichment
    const assetsToEnrich = positions
      .filter(p => p.change24h === null || p.change24h === undefined)
      .map(p => p.asset);
    
    const uniqueAssets = [...new Set(assetsToEnrich)];
    const coingeckoIds = uniqueAssets
      .map(asset => getCoingeckoId(asset))
      .filter(id => id !== null);

    if (coingeckoIds.length === 0) {
      return positions;
    }

    // Single batched request for all coins
    const cgData = await provider.getSimplePrice(
      coingeckoIds.join(','), 
      { timeoutMs: 3000, ttlMs: 60000, ...options }
    );

    // Enrich positions
    for (const row of positions) {
      if (row.change24h === null || row.change24h === undefined) {
        const cgId = getCoingeckoId(row.asset);
        if (cgId && cgData && cgData[cgId]) {
          row.change24h = cgData[cgId].usd_24h_change || null;
        }
      }
    }

    return positions;
  } catch (error) {
    console.warn('[CoinGeckoBatcher] Failed to enrich positions:', error);
    return positions;
  }
}

export default {
  batchGetSimplePrice,
  batchEnrichPositions
};

