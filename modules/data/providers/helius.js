// Helius provider - Solana token balances and NFTs
import { HttpClient } from '../../http/client.js';

function isSolanaAddress(address) {
  // Solana addresses are base58 encoded, typically 32-44 characters
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

export async function getTokenBalances(wallets, apiKey, { timeoutMs = 15000 } = {}) {
  if (!apiKey) {
    console.warn('[Helius] No API key provided');
    return [];
  }
  
  // Filter to only Solana addresses
  const solanaWallets = wallets.filter(wallet => isSolanaAddress(wallet));
  
  if (solanaWallets.length === 0) {
    console.warn('[Helius] No valid Solana addresses');
    return [];
  }
  
  console.log(`[Helius] Fetching balances for ${solanaWallets.length} wallets...`);
  
  const allTokens = [];
  
  for (const wallet of solanaWallets) {
    try {
      const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'getAssetsByOwner',
          params: {
            ownerAddress: wallet,
            page: 1,
            limit: 1000
          },
          id: 1
        })
      });
      
      if (!response.ok) {
        console.warn(`[Helius] Request failed for ${wallet}:`, response.status);
        continue;
      }
      
      const data = await response.json();
      
      if (data.result && data.result.items) {
        for (const asset of data.result.items) {
          // Only process fungible tokens
          if (asset.interface === 'FungibleToken' && asset.token_info) {
            const decimals = asset.token_info.decimals || 9;
            const balance = asset.token_info.balance / Math.pow(10, decimals);
            
            if (balance < 0.000001) continue;
            
            allTokens.push({
              address: wallet,
              blockchain: 'Solana',
              tokenSymbol: asset.token_info.symbol || 'Unknown',
              tokenName: asset.token_info.name || asset.token_info.symbol || 'Unknown',
              balance: balance,
              balanceUsd: asset.token_info.price_info?.total_price || 0,
              tokenPrice: asset.token_info.price_info?.price_per_token || 0,
              change24h: null,
              contractAddress: asset.id
            });
          }
        }
      }
    } catch (err) {
      console.warn(`[Helius] Error fetching wallet ${wallet}:`, err.message);
    }
  }
  
  console.log(`[Helius] Found ${allTokens.length} tokens`);
  
  return allTokens;
}

export async function getNFTs(wallets, apiKey, { timeoutMs = 15000 } = {}) {
  if (!apiKey) {
    console.warn('[Helius] No API key provided');
    return [];
  }
  
  // Filter to only Solana addresses
  const solanaWallets = wallets.filter(wallet => isSolanaAddress(wallet));
  
  if (solanaWallets.length === 0) {
    console.warn('[Helius] No valid Solana addresses');
    return [];
  }
  
  console.log(`[Helius] Fetching NFTs for ${solanaWallets.length} wallets...`);
  
  const allNFTs = [];
  
  for (const wallet of solanaWallets) {
    try {
      const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'getAssetsByOwner',
          params: {
            ownerAddress: wallet,
            page: 1,
            limit: 1000
          },
          id: 1
        })
      });
      
      if (!response.ok) {
        console.warn(`[Helius] Request failed for ${wallet}:`, response.status);
        continue;
      }
      
      const data = await response.json();
      
      if (data.result && data.result.items) {
        for (const asset of data.result.items) {
          // Process NFTs (V1_NFT, ProgrammableNFT, etc.)
          if (asset.interface && asset.interface.includes('NFT')) {
            const content = asset.content || {};
            const metadata = content.metadata || {};
            
            allNFTs.push({
              address: wallet,
              blockchain: 'Solana',
              name: content.metadata?.name || 'Unknown NFT',
              collection: metadata.symbol || 'Unknown Collection',
              image: content.links?.image || content.files?.[0]?.uri || null,
              contractAddress: asset.id,
              tokenId: asset.id
            });
          }
        }
      }
    } catch (err) {
      console.warn(`[Helius] Error fetching NFTs for ${wallet}:`, err.message);
    }
  }
  
  console.log(`[Helius] Found ${allNFTs.length} NFTs`);
  
  return allNFTs;
}

export default { getTokenBalances, getNFTs };

