// Bitcoin provider
import { HttpClient } from '../../http/client.js';

export async function fetchBalance(address, { timeoutMs = 10000 } = {}) {
  if (!address) return null;
  const url = `https://blockchain.info/balance?active=${address}`;
  const data = await HttpClient.getJson(url, { timeoutMs, ttlMs: 60000 }).catch(() => null);
  if (data && data[address]) {
    const balance = parseFloat(data[address].final_balance || 0) / 1e8;
    return { address, balance };
  }
  return null;
}

export default { fetchBalance };

