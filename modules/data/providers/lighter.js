// Lighter provider - Optimized for Performance
import { HttpClient } from '../../http/client.js';

const MAINNET = 'https://mainnet.zklighter.elliot.ai/api/v1';
const TESTNET = 'https://testnet.zklighter.elliot.ai/api/v1';

// Market ID mapping (symbol -> market_id)
const MARKET_ID_MAP = {
  'BTC': 1,
  'ETH': 2,
  'SOL': 3,
  'HYPE': 24,
  'YZY': 70,
  'ZEC': 90,
  'ASTER': 83,
  'LIT': 120
};

// Spot asset ID mapping (for spot balances)
const SPOT_ASSET_MAP = {
  2: 'LIT'  // asset_id 2 = LIT token
};

// Cached funding rates (provider-level cache)
let cachedFundingRates = null;
let fundingRatesCacheTime = 0;
const FUNDING_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch account data by L1 address
 */
export async function fetchAccountByAddress(address, { timeoutMs = 10000 } = {}) {
  if (!address) return null;

  // Try mainnet first
  try {
    const data = await HttpClient.getJson(`${MAINNET}/account?by=l1_address&value=${address}`, { timeoutMs });
    if (data?.accounts?.length > 0) return data;
  } catch (_) { }

  // Fallback to testnet
  try {
    const data = await HttpClient.getJson(`${TESTNET}/account?by=l1_address&value=${address}`, { timeoutMs });
    if (data?.accounts?.length > 0) return data;
  } catch (_) { }

  return null;
}

/**
 * Fetch candlestick data for sparkline charts
 */
export async function fetchCandlesticks(symbol, { timeoutMs = 5000, days = 7 } = {}) {
  const marketId = MARKET_ID_MAP[symbol];
  if (!marketId) return null;

  try {
    const now = Math.floor(Date.now() / 1000);
    const startTimestamp = now - (days * 24 * 60 * 60);
    const url = `${MAINNET}/candlesticks?market_id=${marketId}&resolution=1h&start_timestamp=${startTimestamp}&end_timestamp=${now}&count_back=${days * 24}`;
    const data = await HttpClient.getJson(url, { timeoutMs });

    if (data?.candlesticks?.length) {
      const priceHistory = data.candlesticks.map(c => ({ price: c.close, timestamp: c.timestamp }));
      const closePrices = data.candlesticks.map(c => c.close);
      const len = closePrices.length;

      // Calculate 24H change
      let change24h = null;
      if (len >= 24) {
        const old = closePrices[len - 24], cur = closePrices[len - 1];
        if (old > 0) change24h = ((cur - old) / old) * 100;
      } else if (len >= 2) {
        const old = closePrices[0], cur = closePrices[len - 1];
        if (old > 0) change24h = ((cur - old) / old) * 100;
      }

      return { priceHistory, change24h, currentPrice: closePrices[len - 1] || null };
    }
  } catch (_) { }

  return null;
}

/**
 * Fetch all funding rates
 */
export async function fetchFundingRates({ timeoutMs = 5000 } = {}) {
  // Return cached if valid
  if (cachedFundingRates && (Date.now() - fundingRatesCacheTime) < FUNDING_CACHE_TTL) {
    return cachedFundingRates;
  }

  try {
    const data = await HttpClient.getJson(`${MAINNET}/funding-rates`, { timeoutMs });

    if (data?.funding_rates?.length) {
      const rateMap = {};
      for (const rate of data.funding_rates) {
        if (rate.exchange === 'lighter') {
          rateMap[rate.symbol] = rate.rate;
        }
      }
      cachedFundingRates = rateMap;
      fundingRatesCacheTime = Date.now();
      return rateMap;
    }
  } catch (_) { }

  return {};
}

/**
 * Fetch cumulative funding for a position
 */
export async function fetchCumFunding(accountIndex, symbol, isLong, { timeoutMs = 5000, days = 30 } = {}) {
  const marketId = MARKET_ID_MAP[symbol];
  if (!marketId || !accountIndex) return null;

  try {
    const now = Math.floor(Date.now() / 1000);
    const startTimestamp = now - (days * 24 * 60 * 60);
    const url = `${MAINNET}/fundings?account_index=${accountIndex}&market_id=${marketId}&resolution=1h&start_timestamp=${startTimestamp}&end_timestamp=${now}&count_back=${days * 24}`;
    const data = await HttpClient.getJson(url, { timeoutMs });

    if (data?.fundings?.length) {
      let cumFunding = 0;
      for (const f of data.fundings) {
        const value = parseFloat(f.value || 0);
        // Long pays when direction is 'short', receives when 'long'
        if (isLong) {
          cumFunding += (f.direction === 'long') ? value : -value;
        } else {
          cumFunding += (f.direction === 'short') ? value : -value;
        }
      }
      return cumFunding;
    }
  } catch (_) { }

  return null;
}

/**
 * Fetch current price for a spot asset via candlesticks (last close price)
 */
export async function fetchSpotPrice(symbol, { timeoutMs = 5000 } = {}) {
  const marketId = MARKET_ID_MAP[symbol];
  if (!marketId) return null;

  try {
    const now = Math.floor(Date.now() / 1000);
    const startTimestamp = now - (24 * 60 * 60); // Last 24 hours
    const url = `${MAINNET}/candlesticks?market_id=${marketId}&resolution=1h&start_timestamp=${startTimestamp}&end_timestamp=${now}&count_back=24`;
    const data = await HttpClient.getJson(url, { timeoutMs });

    if (data?.candlesticks?.length) {
      const closePrices = data.candlesticks.map(c => c.close);
      return closePrices[closePrices.length - 1] || null;
    }
  } catch (_) { }

  return null;
}

/**
 * Get spot asset info mapping
 */
export function getSpotAssetMap() {
  return SPOT_ASSET_MAP;
}

/**
 * Get market ID for a symbol
 */
export function getMarketId(symbol) {
  return MARKET_ID_MAP[symbol] || null;
}

export default { fetchAccountByAddress, fetchCandlesticks, fetchFundingRates, fetchCumFunding, fetchSpotPrice, getSpotAssetMap, getMarketId };
