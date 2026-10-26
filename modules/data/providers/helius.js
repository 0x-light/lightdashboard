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
  
  const allTokens = [];
  
  // A wallet that can't be read throws: it would otherwise read as empty.
  for (const wallet of solanaWallets) {
    const response = await HttpClient.fetchWithTimeout(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'getAssetsByOwner',
        params: {
          ownerAddress: wallet,
          page: 1,
          limit: 1000,
          // Without these, the answer has no fungible tokens and no SOL balance.
          displayOptions: { showFungible: true, showNativeBalance: true }
        },
        id: 1
      })
    }, timeoutMs);
    if (!response.ok) throw new Error(`Helius: HTTP ${response.status} for ${wallet}`);

    const data = await response.json();
    if (!data?.result || !Array.isArray(data.result.items)) {
      throw new Error(`Helius: ${data?.error?.message || 'no asset list'} for ${wallet}`);
    }

    const native = data.result.nativeBalance;
    const sol = Number(native?.lamports) / 1e9;
    if (sol >= 0.000001) {
      const price = Number(native.price_per_sol);
      allTokens.push({
        address: wallet,
        blockchain: 'Solana',
        tokenSymbol: 'SOL',
        tokenName: 'Solana',
        balance: sol,
        balanceUsd: price > 0 ? sol * price : null,
        tokenPrice: price > 0 ? price : null,
        change24h: null,
        contractAddress: null
      });
    }

    for (const asset of data.result.items) {
      if (!['FungibleToken', 'FungibleAsset'].includes(asset.interface) || !asset.token_info) continue;
      const decimals = asset.token_info.decimals || 9;
      const balance = asset.token_info.balance / Math.pow(10, decimals);
      if (balance < 0.000001) continue;

      // Helius prices only some tokens; the rest are unpriced (null), not worth $0.
      const price = Number(asset.token_info.price_info?.price_per_token);
      allTokens.push({
        address: wallet,
        blockchain: 'Solana',
        tokenSymbol: asset.token_info.symbol || asset.content?.metadata?.symbol || 'Unknown',
        tokenName: asset.content?.metadata?.name || asset.token_info.symbol || 'Unknown',
        balance: balance,
        balanceUsd: price > 0 ? (Number(asset.token_info.price_info.total_price) || balance * price) : null,
        tokenPrice: price > 0 ? price : null,
        change24h: null,
        contractAddress: asset.id
      });
    }
  }
  
  // Every wallet was read in full (a failure throws above).
  allTokens.read = solanaWallets.map(wallet => ({ wallet, chain: 'Solana' }));
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
  
  const allNFTs = [];
  
  for (const wallet of solanaWallets) {
    try {
      const response = await HttpClient.fetchWithTimeout(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
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
      }, timeoutMs);
      
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
  
  return allNFTs;
}

export default { getTokenBalances, getNFTs };

