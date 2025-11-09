// Bitcoin provider - blazing fast multi-address support
import { HttpClient } from '../../http/client.js';

/**
 * Validate Bitcoin address format (basic check)
 */
function isBitcoinAddress(address) {
  if (!address || typeof address !== 'string') return false;
  // Support legacy (1...), P2SH (3...), and native segwit (bc1...)
  return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(address.trim());
}

/**
 * Fetch balances for multiple Bitcoin addresses in parallel
 * Uses blockchain.info batch API for speed
 */
export async function getTokenBalances(addresses, { timeoutMs = 15000 } = {}) {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    console.warn('[Bitcoin] No addresses provided');
    return [];
  }
  
  // Filter to valid Bitcoin addresses only
  const btcAddresses = addresses
    .map(addr => addr.trim())
    .filter(addr => isBitcoinAddress(addr));
  
  if (btcAddresses.length === 0) {
    console.warn('[Bitcoin] No valid Bitcoin addresses found');
    return [];
  }
  
  console.log(`[Bitcoin] Fetching balances for ${btcAddresses.length} address(es)...`);
  
  // Use blockchain.info batch API - supports up to 100 addresses per request
  // For speed, we'll batch in groups of 50
  const BATCH_SIZE = 50;
  const batches = [];
  
  for (let i = 0; i < btcAddresses.length; i += BATCH_SIZE) {
    batches.push(btcAddresses.slice(i, i + BATCH_SIZE));
  }
  
  // Fetch all batches in parallel for maximum speed
  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      try {
        const addressList = batch.join('|');
        const url = `https://blockchain.info/balance?active=${addressList}`;
        
        // 60s cache for balance data
        const data = await HttpClient.getJson(url, { 
          timeoutMs, 
          ttlMs: 60000 
        });
        
        if (!data || typeof data !== 'object') {
          console.warn('[Bitcoin] Invalid response from blockchain.info');
          return [];
        }
        
        const results = [];
        for (const [address, info] of Object.entries(data)) {
          if (info && typeof info.final_balance === 'number') {
            const balance = info.final_balance / 1e8; // Convert satoshis to BTC
            if (balance > 0) {
              results.push({
                address,
                balance,
                tokenSymbol: 'BTC',
                blockchain: 'Bitcoin',
                tokenPrice: null, // Will be enriched with price later
                balanceUsd: null,
                change24h: null
              });
            }
          }
        }
        return results;
      } catch (err) {
        console.error('[Bitcoin] Error fetching batch:', err.message);
        return [];
      }
    })
  );
  
  const allResults = batchResults.flat();
  console.log(`[Bitcoin] Found ${allResults.length} non-zero balance(s)`);
  
  return allResults;
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

