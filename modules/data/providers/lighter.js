// Lighter provider - Optimized for Performance
import { HttpClient } from '../../http/client.js';
import { fetchWithCorsProxy } from '../../http/cors-proxy.js';

const MAINNET = 'https://mainnet.zklighter.elliot.ai/api/v1';
const EXPLORER_BASE = 'https://explorer.elliot.ai/api';

// Perp market ID mapping (symbol -> market_id), as /orderBooks lists them.
const MARKET_ID_MAP = {
  'ETH': 0,
  'BTC': 1,
  'SOL': 2,
  'HYPE': 24,
  'YZY': 70,
  'ZEC': 90,
  'ASTER': 83,
  'LIT': 120
};

// Spot asset ID mapping (for spot balances)
const SPOT_ASSET_MAP = {
  1: 'ETH',
  2: 'LIT'
};
// Spot markets (symbol -> market_id): a spot balance is priced from its spot pair, not the perp.
const SPOT_MARKET_ID_MAP = {
  'ETH': 2048,
  'LIT': 2049
};
const MARKET_SYMBOL_BY_ID = Object.fromEntries(
  Object.entries(MARKET_ID_MAP).map(([symbol, id]) => [String(id), symbol])
);

// Cached funding rates (provider-level cache)
let cachedFundingRates = null;
let fundingRatesCacheTime = 0;
const FUNDING_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Account lookup cache to avoid repeating expensive endpoint probing on every refresh. Only
// Lighter's own "no such account" answer is cached as no account; a failed lookup throws.
const ACCOUNT_SUCCESS_CACHE_TTL_MS = 45 * 1000;
const ACCOUNT_FAILURE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const accountLookupCache = new Map();
const accountLookupInFlight = new Map();
// v1 entries were also written after timeouts and rate limits; they are not read.
const ACCOUNT_NEGATIVE_STORAGE_PREFIX = 'lighter_no_account_v2:';

function hasLocalStorage() {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch (_) {
    return false;
  }
}

function getNegativeStorageKey(cacheKey) {
  return `${ACCOUNT_NEGATIVE_STORAGE_PREFIX}${String(cacheKey || '').toLowerCase()}`;
}

function readPersistentNegativeLookup(cacheKey) {
  if (!hasLocalStorage() || !cacheKey) return false;
  try {
    const raw = window.localStorage.getItem(getNegativeStorageKey(cacheKey));
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const ts = Number(parsed?.timestamp || 0);
    if (!Number.isFinite(ts) || ts <= 0) {
      window.localStorage.removeItem(getNegativeStorageKey(cacheKey));
      return false;
    }
    if ((Date.now() - ts) <= ACCOUNT_FAILURE_CACHE_TTL_MS) {
      return true;
    }
    window.localStorage.removeItem(getNegativeStorageKey(cacheKey));
  } catch (_) {
    // Ignore malformed storage values.
  }
  return false;
}

function writePersistentNegativeLookup(cacheKey) {
  if (!hasLocalStorage() || !cacheKey) return;
  try {
    window.localStorage.setItem(
      getNegativeStorageKey(cacheKey),
      JSON.stringify({ timestamp: Date.now() })
    );
  } catch (_) {
    // Ignore storage quota/privacy errors.
  }
}

function clearPersistentNegativeLookup(cacheKey) {
  if (!hasLocalStorage() || !cacheKey) return;
  try {
    window.localStorage.removeItem(getNegativeStorageKey(cacheKey));
  } catch (_) {
    // Ignore storage errors.
  }
}

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

function parseApiErrorCode(error) {
  if (!error) return null;
  const message = String(error.message || '');
  const match = message.match(/"code"\s*:\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function isAccountNotFoundError(error) {
  const status = parseHttpStatus(error);
  const code = parseApiErrorCode(error);
  const message = String(error?.message || '');
  return status === 400 && (code === 21100 || /account not found/i.test(message));
}

function isInvalidParamError(error) {
  const status = parseHttpStatus(error);
  const code = parseApiErrorCode(error);
  const message = String(error?.message || '');
  return status === 400 && (code === 20001 || /invalid param/i.test(message));
}

function isDefinitiveLookupFailure(error) {
  return isAccountNotFoundError(error) || isInvalidParamError(error);
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
    `${baseUrl}/account?by=account_index&value=${encodedIndex}`
  ];

  let lastError = null;
  for (const url of endpoints) {
    try {
      const data = await getJsonWithDevCorsFallback(url, timeoutMs);
      const accounts = normalizeAccountsPayload(data);
      if (accounts.length > 0) {
        return { accounts };
      }
    } catch (err) {
      if (isDefinitiveLookupFailure(err)) {
        return null;
      }
      lastError = err;
    }
  }
  // A sub-account that didn't answer would drop out of the wallet's value.
  if (lastError) throw lastError;
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
  const url = `${EXPLORER_BASE}/search?q=${encodedAddress}`;
  try {
    const data = await getJsonWithDevCorsFallback(url, timeoutMs);
    const indexes = extractIndexesFromExplorerSearch(data);
    if (indexes.length > 0) {
      return indexes;
    }
  } catch (_) {
    // Ignore: explorer lookup is a best-effort fallback.
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

  // Canonical main endpoint from Lighter docs.
  try {
    const byL1Url = `${baseUrl}/account?by=l1_address&value=${encodedAddress}`;
    const data = await getJsonWithDevCorsFallback(byL1Url, timeoutMs);
    const accounts = normalizeAccountsPayload(data);
    if (accounts.length > 0) {
      return { accounts, source: 'account_by_l1_address' };
    }
  } catch (err) {
    if (isAccountNotFoundError(err)) {
      return { notFound: true };
    }
    // A timeout, rate limit or server error: the caller tries the explorer, then throws.
    if (!isInvalidParamError(err)) throw err;
  }

  // Fallback for clusters exposing sub-accounts first.
  try {
    const listUrl = `${baseUrl}/accountsByL1Address?l1_address=${encodedAddress}`;
    const data = await getJsonWithDevCorsFallback(listUrl, timeoutMs);
    const directAccounts = normalizeAccountsPayload(data);
    if (directAccounts.some(hasDetailedAccountShape)) {
      return { accounts: directAccounts, source: 'accountsByL1Address_detailed' };
    }

    const indexes = extractAccountIndexes(data);
    if (indexes.length > 0) {
      const accountResults = await Promise.all(indexes.map((idx) => fetchAccountByIndex(baseUrl, idx, timeoutMs)));
      const mergedAccounts = accountResults.flatMap(result => result?.accounts || []);
      if (mergedAccounts.length > 0) {
        return { accounts: mergedAccounts, source: 'accountsByL1Address_indexes' };
      }
    }

    if (directAccounts.length > 0) {
      return { accounts: directAccounts, source: 'accountsByL1Address_raw' };
    }
  } catch (err) {
    if (isDefinitiveLookupFailure(err)) {
      return { notFound: true };
    }
    throw err;
  }

  return null;
}

/**
 * Fetch account data by L1 address: { accounts, source }, or null when Lighter answers that
 * the address has no account. Throws when the lookup fails.
 */
export async function fetchAccountByAddress(address, { timeoutMs = 10000 } = {}) {
  if (!address) return null;

  const raw = String(address).trim();
  const lowerAddress = raw.toLowerCase();
  const withoutPrefix = lowerAddress.startsWith('0x') ? lowerAddress.slice(2) : lowerAddress;
  const withPrefix = withoutPrefix ? `0x${withoutPrefix}` : '';
  const addressCandidates = [raw];
  const cacheKey = withPrefix || lowerAddress || raw;

  const cachedValue = readCachedAccountLookup(cacheKey);
  if (cachedValue !== undefined) {
    return cachedValue;
  }

  if (readPersistentNegativeLookup(cacheKey)) {
    accountLookupCache.set(cacheKey, {
      value: null,
      ok: false,
      timestamp: Date.now()
    });
    return null;
  }

  if (accountLookupInFlight.has(cacheKey)) {
    return accountLookupInFlight.get(cacheKey);
  }

  const lookupPromise = (async () => {
    // Use mainnet only by default to avoid duplicate request noise.
    // Testnet can still be queried via explicit provider entry if needed.
    const baseUrls = [MAINNET];
    let sawDefinitiveNotFound = false;
    let lookupError = null;

    for (const baseUrl of baseUrls) {
      for (const addr of addressCandidates) {
        let result;
        try {
          result = await fetchAccountsFromCluster(baseUrl, addr, timeoutMs);
        } catch (err) {
          lookupError = err;
          continue;
        }
        if (result?.accounts?.length) {
          return result;
        }
        if (result?.notFound) {
          sawDefinitiveNotFound = true;
          break;
        }
      }
      if (sawDefinitiveNotFound) {
        break;
      }
    }

    if (!sawDefinitiveNotFound) {
      // Final fallback: Explorer API by address/account index.
      const explorerResult = await fetchAccountsFromExplorer(addressCandidates, timeoutMs);
      if (explorerResult?.accounts?.length) {
        return explorerResult;
      }
    }

    if (lookupError) throw lookupError;
    return null;
  })();

  accountLookupInFlight.set(cacheKey, lookupPromise);
  try {
    const result = await lookupPromise;
    const hasAccounts = !!(result?.accounts?.length);
    accountLookupCache.set(cacheKey, {
      value: result,
      ok: hasAccounts,
      timestamp: Date.now()
    });
    if (hasAccounts) {
      clearPersistentNegativeLookup(cacheKey);
    } else {
      writePersistentNegativeLookup(cacheKey);
    }
    return result;
  } finally {
    accountLookupInFlight.delete(cacheKey);
  }
}

/**
 * Fetch candlestick data for sparkline charts. `market: 'spot'` reads the symbol's spot pair.
 */
export async function fetchCandlesticks(symbol, { timeoutMs = 5000, days = 7, market = 'perp' } = {}) {
  const marketId = (market === 'spot' ? SPOT_MARKET_ID_MAP : MARKET_ID_MAP)[symbol];
  if (marketId === undefined) return null;

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
      return { priceHistory, change24h: change24hOf(candles), currentPrice: candles[candles.length - 1].close || null };
    }
  } catch (_) { }

  return null;
}

// The change since the last close at least 24 hours before the latest one, or null when the
// candles don't reach that far back (missing hours would make an array index lie).
export function change24hOf(candles) {
  const sorted = candles.filter(c => c.timestamp > 0).sort((a, b) => a.timestamp - b.timestamp);
  const last = sorted[sorted.length - 1];
  if (!last) return null;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const old = sorted.filter(c => c.timestamp <= last.timestamp - DAY_MS).pop();
  return old?.close > 0 ? ((last.close - old.close) / old.close) * 100 : null;
}

/**
 * Fetch all funding rates
 */
// Each P&L row turned into what the account's value has gained since it opened: profits
// from trading, pools and staking, plus deposits, minus withdrawals. Moves between the
// account and its pools or staking are internal and cancel out. Two points' difference is
// the value change between them.
export function pnlSeries(data) {
  const rows = Array.isArray(data?.pnl) ? data.pnl : [];
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return rows
    .map(r => ({
      t: n(r.timestamp) * 1000,
      equityDelta: n(r.trade_pnl) + n(r.trade_spot_pnl) + n(r.pool_pnl) + n(r.staking_pnl)
        + n(r.inflow) - n(r.outflow) + n(r.spot_inflow) - n(r.spot_outflow)
    }))
    .filter(p => p.t > 0)
    .sort((a, b) => a.t - b.t);
}

/**
 * Account P&L history, oldest first: [{ t, equityDelta }] (see pnlSeries). The API gives
 * hourly or daily rows ('1h' | '1d'), `countBack` of them up to now.
 */
export async function fetchPnlHistory(accountIndex, { resolution = '1h', countBack = 24, timeoutMs = 8000 } = {}) {
  const end = Math.floor(Date.now() / 1000);
  const step = resolution === '1d' ? 86400 : 3600;
  const url = `${MAINNET}/pnl?by=index&value=${encodeURIComponent(accountIndex)}&resolution=${resolution}`
    + `&start_timestamp=${end - countBack * step}&end_timestamp=${end}&count_back=${countBack}&ignore_transfers=false`;
  return pnlSeries(await getJsonWithDevCorsFallback(url, timeoutMs));
}

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
 * Fetch current price for a spot asset via candlesticks (last close price)
 */
export async function fetchSpotPrice(symbol, { timeoutMs = 5000 } = {}) {
  const marketId = SPOT_MARKET_ID_MAP[symbol];
  if (marketId === undefined) return null;

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
  return MARKET_ID_MAP[symbol] ?? null;
}

export function getSymbolByMarketId(marketId) {
  if (marketId === undefined || marketId === null) return null;
  return MARKET_SYMBOL_BY_ID[String(marketId)] || null;
}

export default {
  fetchAccountByAddress,
  fetchCandlesticks,
  fetchFundingRates,
  fetchSpotPrice,
  getSpotAssetMap,
  getMarketId,
  getSymbolByMarketId
};
