// Lighter provider - Optimized for Performance
import { HttpClient } from '../../http/client.js';
import { fetchWithCorsProxy } from '../../http/cors-proxy.js';

const MAINNET = 'https://mainnet.zklighter.elliot.ai/api/v1';
const TESTNET = 'https://testnet.zklighter.elliot.ai/api/v1';
const EXPLORER_BASE = 'https://explorer.elliot.ai/api';

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
const MARKET_SYMBOL_BY_ID = Object.fromEntries(
  Object.entries(MARKET_ID_MAP).map(([symbol, id]) => [String(id), symbol])
);

// Cached funding rates (provider-level cache)
let cachedFundingRates = null;
let fundingRatesCacheTime = 0;
const FUNDING_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Account lookup cache to avoid repeating expensive endpoint probing on every refresh.
const ACCOUNT_SUCCESS_CACHE_TTL_MS = 45 * 1000;
const ACCOUNT_FAILURE_CACHE_TTL_MS = 2 * 60 * 1000;
const accountLookupCache = new Map();
const accountLookupInFlight = new Map();

function readCachedAccountLookup(cacheKey) {
  const cached = accountLookupCache.get(cacheKey);
  if (!cached) return undefined;
  const ttl = cached.ok ? ACCOUNT_SUCCESS_CACHE_TTL_MS : ACCOUNT_FAILURE_CACHE_TTL_MS;
  if ((Date.now() - cached.timestamp) <= ttl) {
    return cached.value;
  }
  accountLookupCache.delete(cacheKey);
  return undefined;
}

function normalizeCandleRows(data) {
  if (!data || typeof data !== 'object') return [];

  const normalize = (row) => {
    if (!row || typeof row !== 'object') return null;
    const close = firstFiniteNumber(row.close, row.c);
    if (close === null) return null;
    const timestamp = firstFiniteNumber(row.timestamp, row.t);
    return {
      timestamp: timestamp !== null ? timestamp : 0,
      close
    };
  };

  const series = [];
  if (Array.isArray(data.candlesticks)) {
    for (const row of data.candlesticks) {
      const normalized = normalize(row);
      if (normalized) series.push(normalized);
    }
    return series;
  }
  if (Array.isArray(data.candles)) {
    for (const row of data.candles) {
      const normalized = normalize(row);
      if (normalized) series.push(normalized);
    }
    return series;
  }
  if (Array.isArray(data.c)) {
    for (const row of data.c) {
      const normalized = normalize(row);
      if (normalized) series.push(normalized);
    }
    return series;
  }
  return series;
}

function parseHttpStatus(error) {
  if (!error) return null;
  if (Number.isFinite(error.status)) return Number(error.status);
  const message = String(error.message || '');
  const match = message.match(/\bHTTP\s+(\d{3})\b/i);
  return match ? Number(match[1]) : null;
}

function shouldUseDevProxyFallback(error) {
  const status = parseHttpStatus(error);
  if (status === null) return true; // network/CORS-level failures
  if (status === 429 || status >= 500) return true;
  // 4xx are usually real API rejections (bad params/not found/forbidden), not CORS issues.
  return false;
}

async function getJsonWithDevCorsFallback(url, timeoutMs) {
  try {
    return await HttpClient.getJson(url, { timeoutMs });
  } catch (err) {
    if (!HttpClient.isProductionHost() && shouldUseDevProxyFallback(err)) {
      return await fetchWithCorsProxy(url, {
        timeoutMs,
        preferDirect: false,
        maxPublicProxyAttempts: 1
      }).catch(() => {
        throw err;
      });
    }
    throw err;
  }
}

function hasDetailedAccountShape(account) {
  if (!account || typeof account !== 'object') return false;
  return Array.isArray(account.positions) ||
    Array.isArray(account.perpetual_positions) ||
    Array.isArray(account.perp_positions) ||
    Array.isArray(account.assets) ||
    Array.isArray(account.spot_assets) ||
    account.available_balance !== undefined ||
    account.free_collateral !== undefined ||
    account.total_asset_value !== undefined ||
    account.collateral !== undefined;
}

function looksLikePosition(item) {
  if (!item || typeof item !== 'object') return false;
  return item.symbol !== undefined ||
    item.market !== undefined ||
    item.market_symbol !== undefined ||
    item.market_id !== undefined ||
    item.position !== undefined ||
    item.size !== undefined ||
    item.amount !== undefined ||
    item.qty !== undefined ||
    item.unrealized_pnl !== undefined ||
    item.unrealizedPnl !== undefined;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeAccountsPayload(data) {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.filter(item => item && typeof item === 'object');
  }
  if (typeof data !== 'object') return [];
  if (Array.isArray(data.accounts)) return data.accounts;
  if (data.accounts && typeof data.accounts === 'object') {
    return Object.values(data.accounts).filter(item => item && typeof item === 'object');
  }
  if (data.account && typeof data.account === 'object') return [data.account];
  if (Array.isArray(data.sub_accounts)) return data.sub_accounts;
  if (data.sub_accounts && typeof data.sub_accounts === 'object') {
    return Object.values(data.sub_accounts).filter(item => item && typeof item === 'object');
  }
  if (Array.isArray(data.subAccounts)) return data.subAccounts;
  if (Array.isArray(data.data)) return data.data.filter(item => item && typeof item === 'object');
  if (data.data && typeof data.data === 'object') return [data.data];
  if (Array.isArray(data.result)) return data.result.filter(item => item && typeof item === 'object');
  if (Array.isArray(data.items)) return data.items.filter(item => item && typeof item === 'object');
  // Some endpoints return a single account object directly (not wrapped).
  if (data.index !== undefined || data.account_index !== undefined || data.accountIndex !== undefined ||
    Array.isArray(data.positions) || Array.isArray(data.assets) ||
    Array.isArray(data.perpetual_positions) || Array.isArray(data.spot_assets)) {
    return [data];
  }
  return [];
}

function extractExplorerPositionRows(data) {
  const rows = [];

  const addRows = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (looksLikePosition(item)) rows.push(item);
      }
      return;
    }
    if (typeof value === 'object') {
      for (const item of Object.values(value)) {
        if (looksLikePosition(item)) rows.push(item);
      }
    }
  };

  if (Array.isArray(data)) {
    addRows(data);
    return rows;
  }
  if (!data || typeof data !== 'object') return rows;

  addRows(data.positions);
  addRows(data.data);
  addRows(data.result);
  addRows(data.items);

  return rows;
}

function buildAccountsFromExplorerPositions(positions, data) {
  if (!Array.isArray(positions) || positions.length === 0) return [];

  const groups = new Map();
  const topLevelBalance = firstFiniteNumber(
    data?.available_balance,
    data?.availableBalance,
    data?.collateral,
    data?.free_collateral,
    data?.freeCollateral,
    data?.equity,
    data?.account_value,
    data?.accountValue,
    data?.total_asset_value
  );

  for (const pos of positions) {
    const rawIndex = pos?.account_index ?? pos?.accountIndex ?? pos?.index ?? pos?.account?.index ?? null;
    const key = rawIndex !== null && rawIndex !== undefined ? String(rawIndex) : '__unknown__';
    if (!groups.has(key)) {
      groups.set(key, {
        account_index: rawIndex,
        positions: []
      });
    }
    const account = groups.get(key);
    account.positions.push(pos);

    if (account.available_balance === undefined) {
      const accountBalance = firstFiniteNumber(
        pos?.available_balance,
        pos?.availableBalance,
        pos?.collateral,
        pos?.free_collateral,
        pos?.freeCollateral,
        pos?.equity,
        pos?.account_value,
        pos?.accountValue,
        pos?.total_asset_value
      );
      if (accountBalance !== null) account.available_balance = accountBalance;
    }
  }

  const accounts = Array.from(groups.values());
  if (topLevelBalance !== null) {
    for (const account of accounts) {
      if (account.available_balance === undefined) {
        account.available_balance = topLevelBalance;
      }
    }
  }

  return accounts;
}

function extractAccountsFromExplorerPayload(data) {
  const directAccounts = normalizeAccountsPayload(data);
  if (directAccounts.length > 0) return directAccounts;

  const positions = extractExplorerPositionRows(data);
  if (positions.length === 0) return [];

  return buildAccountsFromExplorerPositions(positions, data);
}

function extractAccountIndexes(data) {
  const indexes = new Set();
  const addIndex = (value) => {
    if (value === undefined || value === null || value === '') return;
    indexes.add(String(value));
  };
  const addFromCandidate = (item) => {
    if (item === undefined || item === null) return;
    if (typeof item === 'string' || typeof item === 'number') {
      addIndex(item);
      return;
    }
    if (typeof item !== 'object') return;
    const idx = item?.index ?? item?.account_index ?? item?.accountIndex ?? item?.sub_account_index ?? item?.id;
    addIndex(idx);
  };

  if (Array.isArray(data)) {
    data.forEach(addFromCandidate);
  }

  const candidateLists = [
    data?.sub_accounts,
    data?.subAccounts,
    data?.accounts,
    data?.account_indexes,
    data?.accountIndices,
    data?.accountIndexes,
    data?.sub_account_indexes,
    data?.subAccountIndexes,
    data?.indexes,
    data?.indices
  ];

  for (const list of candidateLists) {
    if (!list) continue;
    if (Array.isArray(list)) {
      list.forEach(addFromCandidate);
    } else if (typeof list === 'object') {
      Object.values(list).forEach(addFromCandidate);
    }
  }

  if (data?.account && typeof data.account === 'object') addFromCandidate(data.account);
  return Array.from(indexes);
}

function extractIndexesFromExplorerSearch(data) {
  const indexes = new Set();
  const addIndex = (value) => {
    if (value === undefined || value === null || value === '') return;
    indexes.add(String(value));
  };
  const inspectItem = (item) => {
    if (!item || typeof item !== 'object') return;
    addIndex(item?.account_index);
    addIndex(item?.accountIndex);
    addIndex(item?.index);
    addIndex(item?.account?.index);
    addIndex(item?.account?.account_index);
  };

  if (Array.isArray(data)) {
    data.forEach(inspectItem);
    return Array.from(indexes);
  }
  if (!data || typeof data !== 'object') return [];

  const collections = [
    data.data,
    data.results,
    data.items,
    data.accounts,
    data.matches
  ];
  for (const collection of collections) {
    if (!collection) continue;
    if (Array.isArray(collection)) {
      collection.forEach(inspectItem);
    } else if (typeof collection === 'object') {
      Object.values(collection).forEach(inspectItem);
    }
  }

  inspectItem(data);
  return Array.from(indexes);
}

async function fetchAccountByIndex(baseUrl, accountIndex, timeoutMs) {
  const encodedIndex = encodeURIComponent(String(accountIndex));
  const endpoints = [
    `${baseUrl}/account?by=index&value=${encodedIndex}`,
    `${baseUrl}/account?by=account_index&value=${encodedIndex}`,
    `${baseUrl}/account?by=accountIndex&value=${encodedIndex}`,
    `${baseUrl}/account?account_index=${encodedIndex}`,
    `${baseUrl}/account?accountIndex=${encodedIndex}`,
    `${baseUrl}/account?index=${encodedIndex}`,
    `${baseUrl}/account/${encodedIndex}`,
    `${baseUrl}/accounts/${encodedIndex}`
  ];

  for (const url of [...new Set(endpoints)]) {
    try {
      const data = await getJsonWithDevCorsFallback(url, timeoutMs);
      const accounts = normalizeAccountsPayload(data);
      if (accounts.length > 0) {
        // Prefer detailed account objects, but don't drop unknown-valid payloads.
        return { accounts };
      }
    } catch (_) { }
  }
  return null;
}

async function fetchExplorerPositionsByParam(param, timeoutMs) {
  const encodedParam = encodeURIComponent(String(param));
  const url = `${EXPLORER_BASE}/accounts/${encodedParam}/positions`;
  try {
    return await getJsonWithDevCorsFallback(url, timeoutMs);
  } catch (_) {
    return null;
  }
}

async function fetchExplorerAccountIndexes(address, timeoutMs) {
  const encodedAddress = encodeURIComponent(address);
  const urls = [
    `${EXPLORER_BASE}/search?query=${encodedAddress}`,
    `${EXPLORER_BASE}/search?q=${encodedAddress}`
  ];

  for (const url of urls) {
    try {
      const data = await getJsonWithDevCorsFallback(url, timeoutMs);
      const indexes = extractIndexesFromExplorerSearch(data);
      if (indexes.length > 0) {
        return indexes;
      }
    } catch (_) { }
  }

  return [];
}

async function fetchAccountsFromExplorer(addressCandidates, timeoutMs) {
  // 1) Try direct address/account path first.
  for (const candidate of addressCandidates) {
    const payload = await fetchExplorerPositionsByParam(candidate, timeoutMs);
    const accounts = extractAccountsFromExplorerPayload(payload);
    if (accounts.length > 0) {
      return { accounts, source: 'explorer_positions' };
    }
  }

  // 2) Discover account indexes via explorer search and retry.
  const discoveredIndexes = new Set();
  for (const candidate of addressCandidates) {
    const indexes = await fetchExplorerAccountIndexes(candidate, timeoutMs);
    for (const idx of indexes) discoveredIndexes.add(String(idx));
  }

  for (const index of discoveredIndexes) {
    const payload = await fetchExplorerPositionsByParam(index, timeoutMs);
    const accounts = extractAccountsFromExplorerPayload(payload);
    if (accounts.length > 0) {
      return { accounts, source: 'explorer_search' };
    }
  }

  return null;
}

async function fetchAccountsFromCluster(baseUrl, address, timeoutMs) {
  const encodedAddress = encodeURIComponent(address);

  // Legacy endpoint shape
  const directAccountEndpoints = [
    `${baseUrl}/account?by=l1_address&value=${encodedAddress}`,
    `${baseUrl}/account?by=l1Address&value=${encodedAddress}`,
    `${baseUrl}/account?by=address&value=${encodedAddress}`,
    `${baseUrl}/account?by=owner&value=${encodedAddress}`,
    `${baseUrl}/account?l1_address=${encodedAddress}`,
    `${baseUrl}/account?l1Address=${encodedAddress}`,
    `${baseUrl}/account?address=${encodedAddress}`,
    `${baseUrl}/account?owner=${encodedAddress}`
  ];

  for (const url of [...new Set(directAccountEndpoints)]) {
    try {
      const data = await getJsonWithDevCorsFallback(url, timeoutMs);
      const accounts = normalizeAccountsPayload(data);
      if (accounts.some(hasDetailedAccountShape)) {
        return { accounts };
      }

      // If accounts are present but not in a recognized shape, try by-index expansion first.
      if (accounts.length > 0) {
        const indexes = extractAccountIndexes(data);
        if (indexes.length > 0) {
          const accountResults = await Promise.all(indexes.map(idx => fetchAccountByIndex(baseUrl, idx, timeoutMs)));
          const mergedAccounts = accountResults.flatMap(result => result?.accounts || []);
          if (mergedAccounts.length > 0) {
            return { accounts: mergedAccounts };
          }
        }
        // Last resort: return raw accounts so fetcher can attempt best-effort parsing.
        return { accounts };
      }
    } catch (_) { }
  }

  // New endpoint shape (returns sub-account indexes on some API versions)
  const accountsByAddressEndpoints = [
    `${baseUrl}/accountsByL1Address?l1_address=${encodedAddress}`,
    `${baseUrl}/accountsByL1Address?address=${encodedAddress}`,
    `${baseUrl}/accounts-by-l1-address?l1_address=${encodedAddress}`,
    `${baseUrl}/accounts-by-l1-address?address=${encodedAddress}`,
    `${baseUrl}/accounts/by-l1-address?l1_address=${encodedAddress}`,
    `${baseUrl}/accounts/by-l1-address?address=${encodedAddress}`,
    `${baseUrl}/accounts?l1_address=${encodedAddress}`,
    `${baseUrl}/accounts?address=${encodedAddress}`
  ];

  for (const url of [...new Set(accountsByAddressEndpoints)]) {
    try {
      const data = await getJsonWithDevCorsFallback(url, timeoutMs);
      const directAccounts = normalizeAccountsPayload(data);
      if (directAccounts.some(hasDetailedAccountShape)) {
        return { accounts: directAccounts };
      }

      // Some API versions already return usable account objects under non-standard fields.
      if (directAccounts.length > 0 && directAccounts.some(a => a && typeof a === 'object')) {
        return { accounts: directAccounts };
      }

      const indexes = extractAccountIndexes(data);
      if (indexes.length === 0) {
        continue;
      }

      const accountResults = await Promise.all(indexes.map(idx => fetchAccountByIndex(baseUrl, idx, timeoutMs)));
      const mergedAccounts = accountResults.flatMap(result => result?.accounts || []);
      if (mergedAccounts.length > 0) {
        return { accounts: mergedAccounts };
      }
    } catch (_) { }
  }

  return null;
}

/**
 * Fetch account data by L1 address
 */
export async function fetchAccountByAddress(address, { timeoutMs = 10000 } = {}) {
  if (!address) return null;

  const raw = String(address).trim();
  const lowerAddress = raw.toLowerCase();
  const withoutPrefix = lowerAddress.startsWith('0x') ? lowerAddress.slice(2) : lowerAddress;
  const withPrefix = withoutPrefix ? `0x${withoutPrefix}` : '';
  const addressCandidates = Array.from(new Set([raw, lowerAddress, withPrefix, withoutPrefix].filter(Boolean)));
  const cacheKey = withPrefix || lowerAddress || raw;

  const cachedValue = readCachedAccountLookup(cacheKey);
  if (cachedValue !== undefined) {
    return cachedValue;
  }

  if (accountLookupInFlight.has(cacheKey)) {
    return accountLookupInFlight.get(cacheKey);
  }

  const lookupPromise = (async () => {
    for (const baseUrl of [MAINNET, TESTNET]) {
      for (const addr of addressCandidates) {
        const result = await fetchAccountsFromCluster(baseUrl, addr, timeoutMs);
        if (result?.accounts?.length) {
          return result;
        }
      }
    }

    // Final fallback: Explorer API by address/account index.
    const explorerResult = await fetchAccountsFromExplorer(addressCandidates, timeoutMs);
    if (explorerResult?.accounts?.length) {
      return explorerResult;
    }

    return null;
  })();

  accountLookupInFlight.set(cacheKey, lookupPromise);
  try {
    const result = await lookupPromise;
    accountLookupCache.set(cacheKey, {
      value: result,
      ok: !!(result?.accounts?.length),
      timestamp: Date.now()
    });
    return result;
  } finally {
    accountLookupInFlight.delete(cacheKey);
  }
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
    const endpoints = [
      `${MAINNET}/candles?market_id=${marketId}&resolution=1h&start_timestamp=${startTimestamp}&end_timestamp=${now}&count_back=${days * 24}`,
      `${MAINNET}/candlesticks?market_id=${marketId}&resolution=1h&start_timestamp=${startTimestamp}&end_timestamp=${now}&count_back=${days * 24}`
    ];

    let candles = [];
    for (const url of endpoints) {
      const data = await getJsonWithDevCorsFallback(url, timeoutMs).catch(() => null);
      const normalized = normalizeCandleRows(data);
      if (normalized.length > 0) {
        candles = normalized;
        break;
      }
    }

    if (candles?.length) {
      const priceHistory = candles.map(c => ({ price: c.close, timestamp: c.timestamp }));
      const closePrices = candles.map(c => c.close);
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
    const data = await getJsonWithDevCorsFallback(`${MAINNET}/funding-rates`, timeoutMs);

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
  if (!marketId || accountIndex === undefined || accountIndex === null || accountIndex === '') return null;

  try {
    const now = Math.floor(Date.now() / 1000);
    const startTimestamp = now - (days * 24 * 60 * 60);
    const url = `${MAINNET}/fundings?account_index=${accountIndex}&market_id=${marketId}&resolution=1h&start_timestamp=${startTimestamp}&end_timestamp=${now}&count_back=${days * 24}`;
    const data = await getJsonWithDevCorsFallback(url, timeoutMs);

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
    const endpoints = [
      `${MAINNET}/candles?market_id=${marketId}&resolution=1h&start_timestamp=${startTimestamp}&end_timestamp=${now}&count_back=24`,
      `${MAINNET}/candlesticks?market_id=${marketId}&resolution=1h&start_timestamp=${startTimestamp}&end_timestamp=${now}&count_back=24`
    ];

    for (const url of endpoints) {
      const data = await getJsonWithDevCorsFallback(url, timeoutMs).catch(() => null);
      const candles = normalizeCandleRows(data);
      if (candles?.length) {
        const closePrices = candles.map(c => c.close);
        return closePrices[closePrices.length - 1] || null;
      }
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

export function getSymbolByMarketId(marketId) {
  if (marketId === undefined || marketId === null) return null;
  return MARKET_SYMBOL_BY_ID[String(marketId)] || null;
}

export default {
  fetchAccountByAddress,
  fetchCandlesticks,
  fetchFundingRates,
  fetchCumFunding,
  fetchSpotPrice,
  getSpotAssetMap,
  getMarketId,
  getSymbolByMarketId
};
