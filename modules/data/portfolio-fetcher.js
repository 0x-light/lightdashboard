// Portfolio data fetcher - consolidates provider logic

import { getCoingeckoId } from '../utils/asset-mapping.js';
import { STABLECOINS } from '../utils/format.js';

/**
 * Fetch Hyperliquid positions for wallets
 */
export async function fetchHyperliquidPositions(wallets, providers) {
  const rows = [];
  
  try {
    const [hlMarketData, hlAllMids, hlSpotMeta] = await Promise.all([
      providers.hyperliquid.fetchMetaAndAssetCtxs(3000),
      providers.hyperliquid.fetchAllMids(3000),
      providers.hyperliquid.fetchSpotMeta(3000)
    ]);

    const hlPriceMap = {};
    if (hlMarketData?.[0] && hlMarketData?.[1]) {
      for (let i = 0; i < hlMarketData[1].length; i++) {
        const ctx = hlMarketData[1][i];
        const assetName = hlMarketData[0].universe[i]?.name;
        if (assetName && ctx?.markPx) {
          hlPriceMap[assetName] = parseFloat(ctx.markPx);
        }
      }
    }
    
    if (hlAllMids) {
      for (const [key, value] of Object.entries(hlAllMids)) {
        if (value && !key.startsWith('@')) {
          hlPriceMap[key] = parseFloat(value);
        }
      }
    }

    for (const wallet of wallets) {
      const data = await providers.hyperliquid.fetchPositions(wallet, 3000);
      
      let perpEquity = 0;
      if (data?.perp?.marginSummary) {
        perpEquity = parseFloat(data.perp.marginSummary.accountValue || 0);
      }

      const spotPriceMap = providers.hyperliquid.buildSpotPriceMap(hlAllMids, hlSpotMeta);
      let spotEquity = 0;
      if (data?.spot?.balances) {
        for (const bal of data.spot.balances) {
          const total = parseFloat(bal.total || 0);
          if (total > 0) {
            const price = parseFloat(spotPriceMap[bal.coin] || 0);
            spotEquity += total * price;
          }
        }
      }

      const hlAccountEquity = perpEquity + spotEquity;
      let totalHlPnL = 0;

      // Perp positions
      if (data?.perp?.assetPositions) {
        for (const pos of data.perp.assetPositions) {
          const position = pos.position;
          const szi = parseFloat(position?.szi || 0);
          if (Math.abs(szi) > 0) {
            const entryPrice = parseFloat(position?.entryPx || 0);
            const notionalValue = Math.abs(parseFloat(position?.positionValue || 0));
            let currentPrice = notionalValue / Math.abs(szi);
            if (!currentPrice || isNaN(currentPrice)) {
              currentPrice = hlPriceMap[position.coin] || entryPrice;
            }
            const pnl = parseFloat(position?.unrealizedPnl || 0);
            totalHlPnL += pnl;

            rows.push({
              asset: position.coin,
              exchange: 'Hyperliquid',
              amount: szi,
              price: currentPrice,
              value: notionalValue,
              change24h: null,
              pnl,
              entryPrice,
              isLeveraged: true
            });
          }
        }
      }

      // Spot positions
      if (data?.spot?.balances) {
        for (const bal of data.spot.balances) {
          const available = parseFloat(bal.total || 0) - parseFloat(bal.hold || 0);
          if (available > 0) {
            const price = parseFloat(spotPriceMap[bal.coin] || 0);
            const value = available * price;
            const entryNtl = parseFloat(bal.entryNtl || 0);
            const pnl = (entryNtl > 0 && value > 0) ? (value - entryNtl) : null;
            if (pnl !== null && !isNaN(pnl)) {
              totalHlPnL += pnl;
            }

            rows.push({
              asset: bal.coin,
              exchange: 'Hyperliquid Spot',
              amount: available,
              price,
              value,
              change24h: null,
              pnl,
              entryNtl
            });
          }
        }
      }

      // Account equity position
      if (hlAccountEquity > 0) {
        rows.push({
          asset: 'HL_ACCOUNT_EQUITY',
          exchange: 'Hyperliquid',
          amount: 1,
          price: hlAccountEquity,
          value: hlAccountEquity,
          pnl: totalHlPnL,
          isHlAccountEquity: true,
          isLeveraged: false
        });
      }
    }

    // Enrich with CoinGecko 24h change
    await enrich24hChange(rows, providers.coingecko);
  } catch (e) {
    console.error('[Portfolio] Hyperliquid fetch failed:', e);
  }
  
  return rows;
}

/**
 * Fetch Lighter positions
 */
export async function fetchLighterPositions(wallets, providers) {
  const rows = [];
  
  try {
    for (const wallet of wallets) {
      const data = await providers.lighter.fetchAccountByAddress(wallet, { timeoutMs: 3000 });
      if (data?.accounts?.[0]) {
        const account = data.accounts[0];
        const equity = parseFloat(account.equity_usd || account.total_equity || account.equity || 0);
        const pnl = parseFloat(account.unrealized_pnl || account.pnl || 0);

        if (equity > 0) {
          rows.push({
            asset: 'LIGHTER_ACCOUNT_EQUITY',
            exchange: 'Lighter',
            amount: 1,
            price: equity,
            value: equity,
            pnl,
            isLighterAccountEquity: true,
            isLeveraged: false
          });
        }
      }
    }
  } catch (e) {
    console.error('[Portfolio] Lighter fetch failed:', e);
  }
  
  return rows;
}

/**
 * Fetch Zerion multichain positions
 */
export async function fetchZerionPositions(wallets, settings, providers) {
  const rows = [];
  const chainMap = {
    'ethereum': 'Ethereum', 'arbitrum': 'Arbitrum', 'optimism': 'Optimism',
    'polygon': 'Polygon', 'base': 'Base', 'avalanche': 'Avalanche',
    'bsc': 'BSC', 'solana': 'Solana', 'zksync-era': 'zkSync',
    'blast': 'Blast', 'hyperevm': 'HyperEVM'
  };

  try {
    const positionsData = await providers.zerion.getWalletPositions(
      wallets[0], 
      settings.zerionApiKey, 
      { timeoutMs: 5000 }
    );

    if (positionsData?.data) {
      for (const item of positionsData.data) {
        const attr = item?.attributes || {};
        const fungible = attr.fungible_info;
        if (fungible && !attr.flags?.is_trash) {
          const chainId = item?.relationships?.chain?.data?.id || 'unknown';
          const chain = chainMap[chainId] || chainId;
          rows.push({
            asset: fungible.symbol || 'Unknown',
            exchange: chain,
            amount: attr.quantity?.float || 0,
            price: attr.price || 0,
            value: attr.value || 0,
            change24h: attr.changes?.percent_24h ?? null,
            pnl: null
          });
        }
      }
    }

    // Enrich missing 24h change
    const missingChange = rows.filter(r => r.change24h === null);
    if (missingChange.length > 0) {
      await enrich24hChange(missingChange, providers.coingecko);
    }
  } catch (e) {
    console.error('[Portfolio] Zerion fetch failed:', e);
    throw e; // Re-throw for fallback handling
  }

  return rows;
}

/**
 * Fetch Bitcoin/Zcash positions
 */
export async function fetchBitcoinZcashPositions(bitcoinAddrs, zcashAddrs, providers) {
  const rows = [];

  try {
    const [btcTokens, zcashTokens, cryptoPrices] = await Promise.all([
      bitcoinAddrs.length > 0 ? providers.bitcoin.getTokenBalances(bitcoinAddrs, { timeoutMs: 5000 }) : [],
      zcashAddrs.length > 0 ? providers.zcash.getTokenBalances(zcashAddrs, { timeoutMs: 5000 }) : [],
      providers.coingecko.getSimplePrice('bitcoin,zcash', { timeoutMs: 5000, ttlMs: 60000 })
    ]);

    const btcPrice = cryptoPrices?.bitcoin?.usd || 0;
    const zecPrice = cryptoPrices?.zcash?.usd || 0;

    for (const btc of btcTokens) {
      rows.push({
        asset: 'BTC',
        exchange: 'Bitcoin',
        amount: btc.balance,
        price: btcPrice,
        value: btc.balance * btcPrice,
        change24h: cryptoPrices?.bitcoin?.usd_24h_change,
        pnl: null
      });
    }

    for (const zec of zcashTokens) {
      rows.push({
        asset: 'ZEC',
        exchange: 'Zcash',
        amount: zec.balance,
        price: zecPrice,
        value: zec.balance * zecPrice,
        change24h: cryptoPrices?.zcash?.usd_24h_change,
        pnl: null
      });
    }
  } catch (e) {
    console.error('[Portfolio] Bitcoin/Zcash fetch failed:', e);
  }

  return rows;
}

/**
 * Fetch manual (Pyth/custom) positions
 */
export async function fetchManualPositions(cryptoPositions, providers) {
  const rows = [];
  const pythPositions = cryptoPositions.filter(p => p.type === 'pyth');
  const customPositions = cryptoPositions.filter(p => p.type === 'custom');

  // Pyth positions
  if (pythPositions.length > 0) {
    const feedIds = pythPositions.map(p => p.feedId).filter(Boolean);
    if (feedIds.length > 0) {
      try {
        const pythPrices = await providers.pyth.getLatestByFeedIds(feedIds, 5000);

        for (const pos of pythPositions) {
          const currentPrice = pythPrices[pos.feedId] || 0;
          const amount = parseFloat(pos.amount || 0);
          const entryPrice = parseFloat(pos.entryPrice || 0);
          const value = amount * currentPrice;
          const pnl = amount > 0 && entryPrice > 0 ? (amount * (currentPrice - entryPrice)) : null;

          rows.push({
            asset: pos.symbol,
            exchange: 'Manual',
            amount,
            price: currentPrice,
            value,
            change24h: null,
            pnl,
            entryPrice,
            isManual: true,
            manualType: 'pyth'
          });
        }
      } catch (e) {
        console.warn('[Portfolio] Failed to fetch Pyth prices:', e);
      }
    }
  }

  // Custom positions
  for (const pos of customPositions) {
    const value = parseFloat(pos.value || 0);
    rows.push({
      asset: pos.name,
      exchange: 'Manual',
      amount: 1,
      price: value,
      value,
      change24h: null,
      pnl: null,
      isManual: true,
      manualType: 'custom'
    });
  }

  // Enrich Pyth positions with 24h change
  if (pythPositions.length > 0) {
    const pythRows = rows.filter(r => r.manualType === 'pyth');
    await enrich24hChange(pythRows, providers.coingecko);
  }

  return rows;
}

/**
 * Enrich positions with 24h change from CoinGecko
 */
async function enrich24hChange(rows, coingeckoProvider) {
  if (!coingeckoProvider || rows.length === 0) return;

  const uniqueAssets = [...new Set(rows.filter(r => !r.isHlAccountEquity).map(r => r.asset))];
  const coingeckoIds = uniqueAssets.map(asset => getCoingeckoId(asset)).filter(id => id !== null);

  if (coingeckoIds.length === 0) return;

  try {
    const cgData = await coingeckoProvider.getSimplePrice(coingeckoIds.join(','), { timeoutMs: 3000, ttlMs: 60000 });
    if (cgData) {
      for (const row of rows) {
        if (!row.isHlAccountEquity && row.change24h === null) {
          const cgId = getCoingeckoId(row.asset);
          if (cgId && cgData[cgId]) {
            row.change24h = cgData[cgId].usd_24h_change || null;
          }
        }
      }
    }
  } catch (e) {
    // Continue without 24h change data
  }
}

/**
 * Update prices for existing positions (for periodic updates)
 */
export async function updatePositionPrices(positions, providers) {
  const [marketData, allMids, spotMeta] = await Promise.all([
    providers.hyperliquid.fetchMetaAndAssetCtxs(8000),
    providers.hyperliquid.fetchAllMids(8000),
    providers.hyperliquid.fetchSpotMeta(8000)
  ]);

  const priceMap = {};

  // Perp prices
  if (marketData?.[0] && marketData?.[1]) {
    for (let i = 0; i < marketData[1].length; i++) {
      const ctx = marketData[1][i];
      const assetName = marketData[0].universe[i]?.name;
      if (assetName && ctx?.markPx) {
        priceMap[assetName] = parseFloat(ctx.markPx);
      }
    }
  }

  // Spot prices
  if (allMids && spotMeta?.universe) {
    for (const spotPair of spotMeta.universe) {
      if (spotPair.tokens && spotPair.tokens[1] === 0) {
        const spotKey = `@${spotPair.index}`;
        const tokenName = spotPair.name;
        if (allMids[spotKey]) {
          priceMap[tokenName] = parseFloat(allMids[spotKey]);
        }
      }
    }
    
    if (spotMeta.tokens) {
      const pairsByTokenIndex = new Map();
      for (const pair of spotMeta.universe) {
        if (pair.tokens && pair.tokens[1] === 0) {
          pairsByTokenIndex.set(pair.tokens[0], pair);
        }
      }

      for (const token of spotMeta.tokens) {
        if (token.name && token.index !== undefined) {
          const spotPair = pairsByTokenIndex.get(token.index);
          if (spotPair) {
            const spotKey = `@${spotPair.index}`;
            if (allMids[spotKey]) {
              priceMap[token.name] = parseFloat(allMids[spotKey]);
            }
          }
        }
      }
    }
  }

  // Update positions
  let hasChanges = false;
  const updatedPositions = positions.map(pos => {
    if (pos.isLeveraged || pos.isHlAccountEquity || pos.isLighterAccountEquity) {
      return pos;
    }

    let newPrice = priceMap[pos.asset];
    
    // Stablecoins default to $1
    if ((!newPrice || newPrice === 0) && STABLECOINS.has(pos.asset)) {
      newPrice = 1;
    }

    if (newPrice && newPrice !== pos.price && Math.abs(newPrice - pos.price) > 0.0001) {
      hasChanges = true;
      const newValue = Math.abs(pos.amount) * newPrice;
      let newPnl = pos.pnl;

      if (pos.entryNtl && pos.entryNtl > 0) {
        newPnl = newValue - pos.entryNtl;
      } else if (pos.entryPrice && pos.entryPrice > 0) {
        const costBasis = Math.abs(pos.amount) * pos.entryPrice;
        newPnl = pos.amount >= 0 ? (newValue - costBasis) : (costBasis - newValue);
      }

      return { ...pos, price: newPrice, value: newValue, pnl: newPnl };
    }
    
    return pos;
  });

  return { positions: updatedPositions, hasChanges };
}

export default {
  fetchHyperliquidPositions,
  fetchLighterPositions,
  fetchZerionPositions,
  fetchBitcoinZcashPositions,
  fetchManualPositions,
  updatePositionPrices
};


