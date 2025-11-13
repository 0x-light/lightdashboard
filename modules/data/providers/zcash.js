// Zcash provider - blazing fast multi-address support
import { HttpClient } from '../../http/client.js';

/**
 * Validate Zcash transparent address format (basic check)
 */
function isZcashAddress(address) {
  if (!address || typeof address !== 'string') return false;
  // Support transparent addresses (t-addr) only for now
  return /^t[a-zA-Z0-9]{34}$/.test(address.trim());
}

/**
 * Fetch balances for multiple Zcash addresses in parallel
 */
export async function getTokenBalances(addresses, { timeoutMs = 15000 } = {}) {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    console.warn('[Zcash] No addresses provided');
    return [];
  }
  
  // Filter to valid Zcash addresses only
  const zecAddresses = addresses
    .map(addr => addr.trim())
    .filter(addr => isZcashAddress(addr));
  
  if (zecAddresses.length === 0) {
    console.warn('[Zcash] No valid Zcash addresses found');
    return [];
  }
  
  // Fetch all addresses in parallel for maximum speed
  const results = await Promise.all(
    zecAddresses.map(async (address) => {
      try {
        const url = `https://api.zcha.in/v2/mainnet/accounts/${address}`;
        
        // 60s cache for balance data
        const data = await HttpClient.getJson(url, { 
          timeoutMs, 
          ttlMs: 60000 
        });
        
        if (data && typeof data.balance === 'number' && data.balance > 0) {
          return {
            address,
            balance: data.balance,
            tokenSymbol: 'ZEC',
            blockchain: 'Zcash',
            tokenPrice: null, // Will be enriched with price later
            balanceUsd: null,
            change24h: null
          };
        }
        return null;
      } catch (err) {
        console.error(`[Zcash] Error fetching ${address}:`, err.message);
        return null;
      }
    })
  );
  
  const validResults = results.filter(r => r !== null);
  
  return validResults;
}

/**
 * Legacy single address fetch (kept for backwards compatibility)
 */
export async function fetchBalance(address, { timeoutMs = 10000 } = {}) {
  if (!address) return null;
  const results = await getTokenBalances([address], { timeoutMs });
  return results.length > 0 ? { address: results[0].address, balance: results[0].balance } : null;
}

export default { 
  getTokenBalances, 
  fetchBalance 
};

