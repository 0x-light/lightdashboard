// Zerion provider
import { HttpClient } from '../../http/client.js';

const BASE = 'https://api.zerion.io/v1';

function authHeaders(apiKey) {
  const token = typeof btoa === 'function' ? btoa(apiKey + ':') : Buffer.from(apiKey + ':').toString('base64');
  return {
    'Authorization': `Basic ${token}`,
    'accept': 'application/json'
  };
}

export async function getWalletPositions(wallet, apiKey, { timeoutMs = 15000, includeTrash = false } = {}) {
  // Removed filter[positions]=only_simple to include NFTs
  // includeTrash option to see if NFTs are being filtered as "trash"
  const trashFilter = includeTrash ? '' : '&filter[trash]=only_non_trash';
  const url = `${BASE}/wallets/${wallet}/positions/?currency=usd${trashFilter}&sort=value`;
  return await HttpClient.getJson(url, { headers: authHeaders(apiKey), timeoutMs }).catch(() => null);
}

export async function getWalletPnl(wallet, apiKey, { timeoutMs = 15000 } = {}) {
  const url = `${BASE}/wallets/${wallet}/pnl?currency=usd`;
  return await HttpClient.getJson(url, { headers: authHeaders(apiKey), timeoutMs }).catch(() => null);
}

export default { getWalletPositions, getWalletPnl };


