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

// Networks the key hasn't enabled (HTTP 403), logged once each.
const disabledNetworks = new Set();
// Token metadata by "network:contract": it doesn't change, so it is asked for once.
const metadataCache = new Map();
const METADATA_BATCH = 10;

// One JSON-RPC call. Throws on any failure: a network that doesn't answer must not read as
// one that holds nothing. A 403 (network not enabled for the key) is marked notEnabled.
async function rpc(network, apiKey, method, params, timeoutMs) {
  const response = await HttpClient.fetchWithTimeout(`https://${network.id}.g.alchemy.com/v2/${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 })
  }, timeoutMs);
  if (!response.ok) {
    const error = new Error(`Alchemy ${network.name}: HTTP ${response.status}`);
    error.notEnabled = response.status === 403;
    throw error;
  }
  const data = await response.json();
  if (data?.error) throw new Error(`Alchemy ${network.name}: ${data.error.message || 'error'}`);
  return data?.result;
}

async function fetchNativeBalance(wallet, network, apiKey, timeoutMs = 15000) {
  const result = await rpc(network, apiKey, 'eth_getBalance', [wallet, 'latest'], timeoutMs);
  const balance = parseInt(result, 16) / 1e18; // Convert from Wei
  if (!(balance > 0.00001)) return null;
  return {
    address: wallet,
    blockchain: network.name,
    network: network.id,
    tokenSymbol: network.nativeToken,
    tokenName: network.nativeToken,
    balance: balance,
    balanceUsd: null, // set by priceTokens
    tokenPrice: null,
    change24h: null,
    contractAddress: null // Native token has no contract
  };
}

async function tokenMetadata(network, apiKey, contract, timeoutMs) {
  const key = `${network.id}:${contract.toLowerCase()}`;
  if (!metadataCache.has(key)) {
    metadataCache.set(key, await rpc(network, apiKey, 'alchemy_getTokenMetadata', [contract], timeoutMs));
  }
  return metadataCache.get(key);
}

async function fetchERC20Balances(wallet, network, apiKey, timeoutMs = 20000) {
  const result = await rpc(network, apiKey, 'alchemy_getTokenBalances', [wallet, 'erc20'], timeoutMs);
  const held = (result?.tokenBalances || []).filter(token => parseInt(token.tokenBalance, 16) > 0);
  // Metadata in small batches: hundreds of spam tokens at once draw HTTP 429s.
  const tokens = [];
  for (let i = 0; i < held.length; i += METADATA_BATCH) {
    tokens.push(...await Promise.all(held.slice(i, i + METADATA_BATCH).map(token => erc20Token(wallet, network, apiKey, token, timeoutMs))));
  }
  return tokens.filter(t => t !== null);
}

async function erc20Token(wallet, network, apiKey, token, timeoutMs) {
  const balance = parseInt(token.tokenBalance, 16);
  let meta;
  try {
    meta = await tokenMetadata(network, apiKey, token.contractAddress, timeoutMs);
  } catch (_) {
    // Without decimals the amount is unknown: the token is listed, unpriced.
    return {
      address: wallet,
      blockchain: network.name,
      network: network.id,
      tokenSymbol: `${token.contractAddress.slice(0, 6)}…`,
      tokenName: token.contractAddress,
      metadataMissing: true,
      balance: null,
      balanceUsd: null,
      tokenPrice: null,
      change24h: null,
      contractAddress: token.contractAddress
    };
  }
  const decimals = meta?.decimals || 18;
  const balanceFormatted = balance / Math.pow(10, decimals);
  if (balanceFormatted < 0.000001) return null;
  return {
    address: wallet,
    blockchain: network.name,
    network: network.id,
    tokenSymbol: meta?.symbol || 'Unknown',
    tokenName: meta?.name || meta?.symbol || 'Unknown',
    balance: balanceFormatted,
    balanceUsd: null, // set by priceTokens
    tokenPrice: null,
    change24h: null,
    contractAddress: token.contractAddress
  };
}

// USD price from one entry of Alchemy's Prices API, or null when it has none for the token.
function usdOf(entry) {
  const price = Number(entry?.prices?.find(p => p.currency === 'usd')?.value);
  return price > 0 ? price : null;
}

/**
 * Prices tokens in place with Alchemy's Prices API: native coins by symbol, ERC20s by
 * contract address. A token Alchemy has no price for, or whose price request failed, keeps
 * tokenPrice null (unpriced).
 */
async function priceTokens(tokens, apiKey, timeoutMs) {
  const base = `https://api.g.alchemy.com/prices/v1/${apiKey}/tokens`;
  const natives = [...new Set(tokens.filter(t => !t.contractAddress).map(t => t.tokenSymbol))];
  const contracts = tokens.filter(t => t.contractAddress);
  const bySymbol = new Map();
  const byAddress = new Map();
  const requests = [];
  if (natives.length > 0) {
    const query = natives.map(s => `symbols=${encodeURIComponent(s)}`).join('&');
    requests.push(HttpClient.getJson(`${base}/by-symbol?${query}`, { timeoutMs }).then(data => {
      for (const entry of data?.data || []) bySymbol.set(entry.symbol, usdOf(entry));
    }, e => console.warn('[Alchemy] Prices by symbol failed:', e?.message || e)));
  }
  // The API takes at most 25 addresses per request.
  for (let i = 0; i < contracts.length; i += 25) {
    const addresses = contracts.slice(i, i + 25).map(t => ({ network: t.network, address: t.contractAddress }));
    requests.push(HttpClient.requestJson(`${base}/by-address`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses }),
      timeoutMs
    }).then(data => {
      for (const entry of data?.data || []) {
        byAddress.set(`${entry.network}:${String(entry.address).toLowerCase()}`, usdOf(entry));
      }
    }, e => console.warn('[Alchemy] Prices by address failed:', e?.message || e)));
  }
  await Promise.all(requests);
  for (const token of tokens) {
    const price = token.contractAddress
      ? byAddress.get(`${token.network}:${token.contractAddress.toLowerCase()}`)
      : bySymbol.get(token.tokenSymbol);
    if (price > 0 && token.balance != null) {
      token.tokenPrice = price;
      token.balanceUsd = token.balance * price;
    }
  }
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

  // Parallelize all wallet×network combinations
  // `read` lists the wallet and chain pairs read in full, for resetting sold-out entries.
  const read = [];
  const fetchTasks = [];
  for (const wallet of evmWallets) {
    for (const network of NETWORKS) {
      if (disabledNetworks.has(network.id)) continue;
      fetchTasks.push((async () => {
        try {
          const [native, erc20] = await Promise.all([
            fetchNativeBalance(wallet, network, apiKey, timeoutMs),
            fetchERC20Balances(wallet, network, apiKey, timeoutMs)
          ]);
          const tokens = [native, ...erc20].filter(t => t !== null);
          if (!tokens.some(t => t.metadataMissing)) read.push({ wallet, chain: network.name });
          return tokens;
        } catch (e) {
          // A network the key hasn't enabled holds nothing we can read; skip it from now on.
          if (!e.notEnabled) throw e;
          disabledNetworks.add(network.id);
          console.warn(`[Alchemy] ${network.name} is not enabled for this key; skipped`);
          return [];
        }
      })());
    }
  }

  const results = await Promise.all(fetchTasks);
  const allTokens = results.flat();
  if (allTokens.length > 0) await priceTokens(allTokens, apiKey, timeoutMs);
  allTokens.read = read;
  return allTokens;
}

export default { getTokenBalances };

