// Lighter provider
import { HttpClient } from '../../http/client.js';

const MAINNET = 'https://mainnet.zklighter.elliot.ai/api/v1';
const TESTNET = 'https://testnet.zklighter.elliot.ai/api/v1';

export async function fetchAccountByAddress(address, { timeoutMs = 10000 } = {}) {
  if (!address) return null;
  
  // Try mainnet first
  try {
    const data = await HttpClient.getJson(`${MAINNET}/account?by=l1_address&value=${address}`, { timeoutMs });
    if (data && data.accounts && Array.isArray(data.accounts) && data.accounts.length > 0) {
      return data;
    }
  } catch (_) {}
  
  // Try testnet fallback
  try {
    const data = await HttpClient.getJson(`${TESTNET}/account?by=l1_address&value=${address}`, { timeoutMs });
    if (data && data.accounts && Array.isArray(data.accounts) && data.accounts.length > 0) {
      return data;
    }
  } catch (_) {}
  
  return null;
}

export default { fetchAccountByAddress };

