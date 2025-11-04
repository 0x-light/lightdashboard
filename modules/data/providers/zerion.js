// Zerion provider
import { HttpClient } from '../../http/client.js';

const BASE = 'https://api.zerion.io/v1';
const USE_PROXY = HttpClient.isProductionHost && HttpClient.isProductionHost();

function authHeaders(apiKey) {
  const token = typeof btoa === 'function' ? btoa(apiKey + ':') : Buffer.from(apiKey + ':').toString('base64');
  return {
    'Authorization': `Basic ${token}`,
    'accept': 'application/json'
  };
}

function buildUrl(path, params, apiKey) {
  if (USE_PROXY) {
    // Use proxy in production to avoid CORS
    const queryParams = new URLSearchParams({ apiKey, path, ...params });
    return `/api/zerion?${queryParams.toString()}`;
  } else {
    // Direct API call in development
    const queryParams = new URLSearchParams(params);
    return `${BASE}/${path}?${queryParams.toString()}`;
  }
}

export async function getWalletPositions(wallet, apiKey, { timeoutMs = 15000, includeTrash = false } = {}) {
  // Fungible positions (tokens)
  const trashFilter = includeTrash ? '' : 'only_non_trash';
  const params = {
    currency: 'usd',
    sort: 'value'
  };
  if (trashFilter) {
    params['filter[trash]'] = trashFilter;
  }
  
  const url = buildUrl(`wallets/${wallet}/positions/`, params, apiKey);
  const headers = USE_PROXY ? {} : authHeaders(apiKey);
  
  return await HttpClient.getJson(url, { headers, timeoutMs }).catch(() => null);
}

export async function getWalletNfts(wallet, apiKey, { timeoutMs = 15000 } = {}) {
  // NFT positions - using positions endpoint with filter
  const params = {
    currency: 'usd',
    'filter[position_types]': 'nft',
    sort: 'value'
  };
  
  const url = buildUrl(`wallets/${wallet}/positions/`, params, apiKey);
  const headers = USE_PROXY ? {} : authHeaders(apiKey);
  
  return await HttpClient.getJson(url, { headers, timeoutMs }).catch(() => null);
}

export async function getWalletPnl(wallet, apiKey, { timeoutMs = 15000 } = {}) {
  const url = `${BASE}/wallets/${wallet}/pnl?currency=usd`;
  return await HttpClient.getJson(url, { headers: authHeaders(apiKey), timeoutMs }).catch(() => null);
}

export default { getWalletPositions, getWalletNfts, getWalletPnl };


