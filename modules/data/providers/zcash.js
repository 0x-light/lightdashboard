// Zcash provider
import { HttpClient } from '../../http/client.js';

export async function fetchBalance(address, { timeoutMs = 10000 } = {}) {
  if (!address) return null;
  const url = `https://api.zcha.in/v2/mainnet/accounts/${address}`;
  const data = await HttpClient.getJson(url, { timeoutMs, ttlMs: 60000 }).catch(() => null);
  if (data && typeof data.balance === 'number') {
    return { address, balance: data.balance };
  }
  return null;
}

export default { fetchBalance };

