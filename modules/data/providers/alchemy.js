// Alchemy provider - Multi-chain EVM token balances
import { HttpClient } from '../../http/client.js';

// Alchemy supports these networks
const NETWORKS = [
  { id: 'eth-mainnet', name: 'Ethereum', nativeToken: 'ETH' },
  { id: 'arb-mainnet', name: 'Arbitrum', nativeToken: 'ETH' },
  { id: 'opt-mainnet', name: 'Optimism', nativeToken: 'ETH' },
  { id: 'polygon-mainnet', name: 'Polygon', nativeToken: 'MATIC' },
  { id: 'base-mainnet', name: 'Base', nativeToken: 'ETH' },
  { id: 'hyperliquid-mainnet', name: 'HyperEVM', nativeToken: 'HYPE' }
];

function isEVMAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

async function fetchNativeBalance(wallet, network, apiKey, timeoutMs = 15000) {
  const url = `https://${network.id}.g.alchemy.com/v2/${apiKey}`;
  
  try {
    const response = await HttpClient.fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [wallet, 'latest'],
        id: 1
      })
    }, timeoutMs);
    
    if (!response.ok) return null;
    
    const data = await response.json();
    if (data.result) {
      const balance = parseInt(data.result, 16) / 1e18; // Convert from Wei
      
      if (balance > 0.00001) {
        return {
          address: wallet,
          blockchain: network.name,
          tokenSymbol: network.nativeToken,
          tokenName: network.nativeToken,
          balance: balance,
          balanceUsd: 0, // Will be calculated from prices
          tokenPrice: 0,
          change24h: null,
          contractAddress: null // Native token has no contract
        };
      }
    }
  } catch (err) {
    console.warn(`[Alchemy] Native balance failed for ${network.name}:`, err.message);
  }
  
  return null;
}

async function fetchERC20Balances(wallet, network, apiKey, timeoutMs = 20000) {
  const url = `https://${network.id}.g.alchemy.com/v2/${apiKey}`;
  const tokens = [];
  
  try {
    // Get token balances
    const response = await HttpClient.fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'alchemy_getTokenBalances',
        params: [wallet, 'erc20'],
        id: 1
      })
    }, timeoutMs);
    
    if (!response.ok) return tokens;
    
    const data = await response.json();
    
    if (data.result && data.result.tokenBalances) {
      // Fetch metadata for each token with balance
      const metadataPromises = data.result.tokenBalances
        .filter(token => {
          const balance = parseInt(token.tokenBalance, 16);
          return balance > 0;
        })
        .map(async (token) => {
          try {
            const balance = parseInt(token.tokenBalance, 16);
            
            // Get token metadata
            const metaResp = await HttpClient.fetchWithTimeout(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'alchemy_getTokenMetadata',
                params: [token.contractAddress],
                id: 1
              })
            }, timeoutMs);
            
            if (!metaResp.ok) return null;
            
            const meta = await metaResp.json();
            if (meta.result) {
              const decimals = meta.result.decimals || 18;
              const balanceFormatted = balance / Math.pow(10, decimals);
              
              if (balanceFormatted < 0.000001) return null;
              
              return {
                address: wallet,
                blockchain: network.name,
                tokenSymbol: meta.result.symbol || 'Unknown',
                tokenName: meta.result.name || meta.result.symbol || 'Unknown',
                balance: balanceFormatted,
                balanceUsd: 0, // Will be calculated from prices
                tokenPrice: 0,
                change24h: null,
                contractAddress: token.contractAddress
              };
            }
          } catch (err) {
            return null;
          }
        });
      
      const results = await Promise.all(metadataPromises);
      tokens.push(...results.filter(t => t !== null));
    }
  } catch (err) {
    console.warn(`[Alchemy] ERC20 balances failed for ${network.name}:`, err.message);
  }
  
  return tokens;
}

export async function getTokenBalances(wallets, apiKey, { timeoutMs = 30000 } = {}) {
  if (!apiKey) {
    console.warn('[Alchemy] No API key provided');
    return [];
  }
  
  // Filter to only EVM addresses
  const evmWallets = wallets.filter(wallet => isEVMAddress(wallet));
  
  if (evmWallets.length === 0) {
    console.warn('[Alchemy] No valid EVM addresses');
    return [];
  }
  
  console.log(`[Alchemy] Fetching balances for ${evmWallets.length} wallets across ${NETWORKS.length} networks...`);
  
  // Parallelize all wallet×network combinations
  const fetchTasks = [];
  for (const wallet of evmWallets) {
    for (const network of NETWORKS) {
      fetchTasks.push((async () => {
        const [native, erc20] = await Promise.all([
          fetchNativeBalance(wallet, network, apiKey, timeoutMs),
          fetchERC20Balances(wallet, network, apiKey, timeoutMs)
        ]);
        return [native, ...erc20].filter(t => t !== null);
      })());
    }
  }
  
  const results = await Promise.all(fetchTasks);
  const allTokens = results.flat();
  
  console.log(`[Alchemy] Found ${allTokens.length} tokens`);
  
  return allTokens;
}

export default { getTokenBalances };

