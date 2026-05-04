import { HttpClient } from '../../http/client.js';

const DEFAULT_GATEWAY_URL = 'https://localhost:5000/v1/api';

function normalizeBaseUrl(baseUrl = DEFAULT_GATEWAY_URL) {
  const raw = String(baseUrl || '').trim() || DEFAULT_GATEWAY_URL;
  const withoutTrailingSlash = raw.replace(/\/+$/, '');
  return withoutTrailingSlash.endsWith('/v1/api')
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/v1/api`;
}

function endpoint(baseUrl, path) {
  return `${normalizeBaseUrl(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`;
}

function normalizeAccountId(account) {
  return String(account?.accountId || account?.id || account?.acctId || '').trim();
}

function normalizePositionList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.positions)) return data.positions;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

async function getJson(baseUrl, path, { timeoutMs = 8000, method = 'GET', body = undefined } = {}) {
  return HttpClient.requestJson(endpoint(baseUrl, path), {
    method,
    body,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    timeoutMs,
    retries: 0,
    bypassCache: true
  });
}

export function getDefaultGatewayUrl() {
  return DEFAULT_GATEWAY_URL;
}

export async function getAccounts({ baseUrl = DEFAULT_GATEWAY_URL, timeoutMs = 8000 } = {}) {
  const data = await getJson(baseUrl, '/portfolio/accounts', { timeoutMs });
  return Array.isArray(data)
    ? data.filter(account => normalizeAccountId(account))
    : [];
}

async function getPositionsV2(accountId, { baseUrl = DEFAULT_GATEWAY_URL, timeoutMs = 8000 } = {}) {
  const encodedAccount = encodeURIComponent(accountId);
  const data = await getJson(
    baseUrl,
    `/portfolio2/${encodedAccount}/positions?direction=a&sort=position`,
    { timeoutMs }
  );
  return normalizePositionList(data);
}

async function getPositionsPaged(accountId, { baseUrl = DEFAULT_GATEWAY_URL, timeoutMs = 8000 } = {}) {
  const encodedAccount = encodeURIComponent(accountId);
  const rows = [];
  for (let page = 0; page < 25; page++) {
    const data = await getJson(
      baseUrl,
      `/portfolio/${encodedAccount}/positions/${page}?direction=a&sort=position`,
      { timeoutMs }
    );
    const pageRows = normalizePositionList(data);
    if (pageRows.length === 0) break;
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
  }
  return rows;
}

export async function getPositions(accountId, options = {}) {
  try {
    return await getPositionsV2(accountId, options);
  } catch (e) {
    console.warn('[IBKR] portfolio2 positions failed, falling back to paged endpoint:', e?.message || e);
    return getPositionsPaged(accountId, options);
  }
}

export async function invalidatePositions(accountId, { baseUrl = DEFAULT_GATEWAY_URL, timeoutMs = 8000 } = {}) {
  const encodedAccount = encodeURIComponent(accountId);
  return getJson(baseUrl, `/portfolio/${encodedAccount}/positions/invalidate`, {
    timeoutMs,
    method: 'POST',
    body: '{}'
  });
}

export const _internal = {
  normalizeBaseUrl,
  normalizeAccountId,
  normalizePositionList
};

export default {
  getDefaultGatewayUrl,
  getAccounts,
  getPositions,
  invalidatePositions
};
