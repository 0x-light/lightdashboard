// Minimal alpha boot for the new modular dashboard

function setHealth(text) {
  const el = document.getElementById('healthMobile');
  if (el) {
    const contentDiv = el.querySelector('div:last-child');
    if (contentDiv) contentDiv.innerHTML = text;
  }
}

function get24hAgoTsSec() {
  const nowMs = Date.now();
  return Math.floor((nowMs - 24 * 60 * 60 * 1000) / 1000);
}

// Wallet asset entry price management utilities
window.walletPnLUtils = {
  // View all stored entry prices
  viewEntryPrices: () => {
    try {
      const stored = localStorage.getItem('walletAssetEntryPrices');
      const entryPrices = stored ? JSON.parse(stored) : {};
      console.table(Object.entries(entryPrices).map(([key, data]) => ({
        Asset: key,
        EntryPrice: `$${data.price.toFixed(4)}`,
        Date: new Date(data.date).toLocaleString(),
        OriginalAmount: data.amount.toFixed(6)
      })));
      return entryPrices;
    } catch (e) {
      console.error('Failed to load entry prices:', e);
      return {};
    }
  },
  
  // Reset entry price for a specific asset (e.g., "BTC_Ethereum")
  resetEntryPrice: (assetKey) => {
    try {
      const stored = localStorage.getItem('walletAssetEntryPrices');
      const entryPrices = stored ? JSON.parse(stored) : {};
      if (entryPrices[assetKey]) {
        delete entryPrices[assetKey];
        localStorage.setItem('walletAssetEntryPrices', JSON.stringify(entryPrices));
        console.log(`✓ Reset entry price for ${assetKey}. Refresh to see changes.`);
        return true;
      } else {
        console.warn(`No entry price found for ${assetKey}`);
        return false;
      }
    } catch (e) {
      console.error('Failed to reset entry price:', e);
      return false;
    }
  },
  
  // Manually set entry price for an asset
  setEntryPrice: (assetKey, price, date = null) => {
    try {
      const stored = localStorage.getItem('walletAssetEntryPrices');
      const entryPrices = stored ? JSON.parse(stored) : {};
      entryPrices[assetKey] = {
        price: parseFloat(price),
        date: date || new Date().toISOString(),
        amount: entryPrices[assetKey]?.amount || 0
      };
      localStorage.setItem('walletAssetEntryPrices', JSON.stringify(entryPrices));
      console.log(`✓ Set entry price for ${assetKey} to $${price}. Refresh to see changes.`);
      return true;
    } catch (e) {
      console.error('Failed to set entry price:', e);
      return false;
    }
  },
  
  // Reset all entry prices
  resetAll: () => {
    if (confirm('Are you sure you want to reset all wallet asset entry prices? This cannot be undone.')) {
      try {
        localStorage.removeItem('walletAssetEntryPrices');
        console.log('✓ Reset all entry prices. Refresh to recalculate.');
        return true;
      } catch (e) {
        console.error('Failed to reset entry prices:', e);
        return false;
      }
    }
    return false;
  },
  
  // Export entry prices as JSON
  export: () => {
    try {
      const stored = localStorage.getItem('walletAssetEntryPrices');
      const entryPrices = stored ? JSON.parse(stored) : {};
      const json = JSON.stringify(entryPrices, null, 2);
      console.log('Entry prices JSON (copy and save):');
      console.log(json);
      return json;
    } catch (e) {
      console.error('Failed to export entry prices:', e);
      return null;
    }
  },
  
  // Import entry prices from JSON
  import: (jsonString) => {
    try {
      const entryPrices = JSON.parse(jsonString);
      localStorage.setItem('walletAssetEntryPrices', JSON.stringify(entryPrices));
      console.log('✓ Imported entry prices. Refresh to see changes.');
      return true;
    } catch (e) {
      console.error('Failed to import entry prices:', e);
      return false;
    }
  }
};

// Log utility availability on load
console.log('💡 Wallet PnL utilities available: window.walletPnLUtils');
console.log('   • viewEntryPrices() - View all tracked entry prices');
console.log('   • setEntryPrice(assetKey, price) - Manually set entry price');
console.log('   • resetEntryPrice(assetKey) - Reset specific asset');
console.log('   • resetAll() - Clear all entry prices');
console.log('   • export() - Export entry prices as JSON');
console.log('   • import(json) - Import entry prices from JSON');

async function runHealthChecks() {
  const parts = [];
  const mods = window.AppModules || {};
  const providers = mods.data?.providers || {};
  const Settings = mods.core?.settings;

  // Pyth
  try {
    const feeds = await providers.pyth.getPriceFeeds(8000);
    const ok = feeds && typeof feeds === 'object' && Object.keys(feeds).length > 0;
    parts.push(`<span style="color: ${ok ? 'var(--green)' : 'var(--red)'};">●</span> Pyth`);
  } catch (e) {
    parts.push('<span style="color: var(--red);">●</span> Pyth');
  }

  // CoinGecko
  try {
    const data = await providers.coingecko.getSimplePrice('bitcoin,ethereum', { timeoutMs: 8000, ttlMs: 15000 });
    const ok = !!(data && (data.bitcoin || data.ethereum));
    parts.push(`<span style="color: ${ok ? 'var(--green)' : 'var(--red)'};">●</span> CoinGecko`);
  } catch (e) {
    parts.push('<span style="color: var(--red);">●</span> CoinGecko');
  }

  // Hyperliquid
  try {
    const meta = await providers.hyperliquid.fetchMetaAndAssetCtxs(8000);
    const ok = Array.isArray(meta) || (meta && typeof meta === 'object');
    parts.push(`<span style="color: ${ok ? 'var(--green)' : 'var(--red)'};">●</span> Hyperliquid`);
  } catch (e) {
    parts.push('<span style="color: var(--red);">●</span> Hyperliquid');
  }

  // Zerion
  const settings = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
  if (settings.zerionApiKey) {
    try {
      const wallets = (settings.walletAddresses || '').split(',').map(w => w.trim()).filter(Boolean);
      if (wallets.length > 0) {
        const data = await providers.zerion.getWalletPositions(wallets[0], settings.zerionApiKey, { timeoutMs: 8000, includeTrash: true });
        const ok = !!(data && data.data);
        parts.push(`<span style="color: ${ok ? 'var(--green)' : 'var(--red)'};">●</span> Zerion`);
      } else {
        console.warn('[Health] Zerion: No wallet addresses configured');
        parts.push('<span style="color: var(--red);">●</span> Zerion (no wallets)');
      }
    } catch (e) {
      console.error('[Health] Zerion error:', e);
      parts.push('<span style="color: var(--red);">●</span> Zerion');
    }
  } else {
    console.warn('[Health] Zerion: No API key configured');
  }

  // Bitcoin
  const bitcoinAddrs = (settings.bitcoinAddresses || '').split(',').map(a => a.trim()).filter(Boolean);
  if (bitcoinAddrs.length > 0) {
    try {
      const data = await providers.bitcoin.getTokenBalances([bitcoinAddrs[0]], { timeoutMs: 8000 });
      const ok = Array.isArray(data);
      parts.push(`<span style="color: ${ok ? 'var(--green)' : 'var(--red)'};">●</span> Bitcoin`);
    } catch (e) {
      console.error('[Health] Bitcoin error:', e);
      parts.push('<span style="color: var(--red);">●</span> Bitcoin');
    }
  }

  setHealth(parts.join('<br>'));
}

async function renderDemoSummary() {
  const mods = window.AppModules || {};
  const providers = mods.data?.providers || {};
  const Portfolio = mods.portfolio;
  const HeroUI = mods.ui?.hero;
  const PositionsUI = mods.ui?.positions;
  const Settings = mods.core?.settings;

  const summaryEl = document.getElementById('newSummary');
  if (!summaryEl) return;

  try {
    const settings = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
    // Try to fetch BTC/ETH prices and 24h ago values via Pyth
    const feedMap = await providers.pyth.getPriceFeeds(8000);
    const assets = ['BTC', 'ETH'];
    const feedIds = assets.map(a => feedMap[a]).filter(Boolean);

    let currentPrices = {};
    let prices24hAgo = {};

    if (feedIds.length > 0) {
      const latest = await providers.pyth.getLatestByFeedIds(feedIds, 8000);
      const ts24h = get24hAgoTsSec();
      const atTs = await providers.pyth.getAtTimestampByFeedIds(feedIds, ts24h, 8000);
      // Map back to asset keys
      for (const asset of assets) {
        const id = feedMap[asset];
        if (!id) continue;
        currentPrices[`${asset}_PYTH`] = latest[id];
        prices24hAgo[`${asset}_PYTH`] = atTs[id];
      }
    }

    // Fallback: CoinGecko if Pyth missing
    if (!currentPrices['BTC_PYTH'] || !currentPrices['ETH_PYTH']) {
      const cg = await providers.coingecko.getSimplePrice('bitcoin,ethereum', { timeoutMs: 8000, ttlMs: 15000 });
      if (cg?.bitcoin?.usd) currentPrices['BTC_PYTH'] = cg.bitcoin.usd;
      if (cg?.ethereum?.usd) currentPrices['ETH_PYTH'] = cg.ethereum.usd;
    }

    // Build demo positions with nominal amounts
    const positions = assets.map(a => ({ asset: a, exchange: 'PYTH', amount: 1 }));
    const { changeUsd, changePct } = Portfolio.calculatePortfolio24hChange({
      positions,
      currentPrices,
      prices24hAgo,
      keyFn: (p) => `${p.asset}_PYTH`
    });

    // Show loading state initially - will be replaced with real data
    summaryEl.innerHTML = '<span class="loading-terminal">Loading portfolio...</span>';

    // Render positions via providers if settings are available; fallback to demo
    const positionsBody = document.getElementById('newPositionsBody');
    const mobileContainer = document.getElementById('newMobilePositionsContainer');
    if (PositionsUI && typeof PositionsUI.renderPositions === 'function') {
      let rendered = false;
      try {
        const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
        const walletsRaw = s.walletAddresses || '';
        const wallets = walletsRaw.split(',').map(w => w.trim()).filter(Boolean);
        const zerionKey = s.zerionApiKey || '';

        if (wallets.length > 0) {
          const allRows = [];
          
          // CRITICAL: Only HL + Multi-chain for speed (fastest 2 providers)
          const [hlResults, multichainData] = await Promise.all([
            // Hyperliquid
            Promise.all(wallets.map(async (wallet) => {
              try {
                const hl = providers.hyperliquid;
                const data = await hl.fetchPositions(wallet, 10000);
                const rows = [];
                if (data?.perp?.assetPositions) {
                  for (const pos of data.perp.assetPositions) {
                    const position = pos.position;
                    const szi = parseFloat(position?.szi || 0);
                    if (Math.abs(szi) > 0) {
                      const entryPrice = parseFloat(position?.entryPx || 0);
                      const leverage = parseFloat(position?.leverage?.value || 10); // Default to 10x if not available
                      const notionalValue = Math.abs(parseFloat(position?.positionValue || 0));
                      const pnl = parseFloat(position?.unrealizedPnl || 0);
                      // Calculate margin based on ENTRY value to avoid double-counting PnL
                      const entryNotional = Math.abs(szi) * entryPrice;
                      const marginUsed = entryNotional / leverage;
                      
                      rows.push({
                        asset: position.coin,
                        exchange: 'Hyperliquid',
                        amount: szi,
                        price: entryPrice,
                        value: notionalValue, // Show leveraged value in position display
                        change24h: null,
                        pnl: pnl,
                        entryPrice: entryPrice,
                        marginUsed: marginUsed, // Track margin for portfolio total calculation
                        isLeveraged: true
                      });
                    }
                  }
                }
                if (data?.spot?.balances) {
                  for (const bal of data.spot.balances) {
                    const available = parseFloat(bal.total || 0) - parseFloat(bal.hold || 0);
                    if (available > 0) {
                      rows.push({
                        asset: bal.coin,
                        exchange: 'Hyperliquid Spot',
                        amount: available,
                        price: 0,
                        value: 0,
                        change24h: null,
                        pnl: null,
                        entryNtl: parseFloat(bal.entryNtl || 0)
                      });
                    }
                  }
                }
                return rows;
              } catch (_) { return []; }
            })),
            
            // Multi-chain balances (Zerion PRIMARY, Alchemy/Helius as fallback)
            (async () => {
              const alchemyKey = settings.alchemyApiKey;
              const heliusKey = settings.heliusApiKey;
              const solanaAddrs = (settings.solanaAddresses || '').split(',').map(a => a.trim()).filter(Boolean);
              const allWallets = [...wallets, ...solanaAddrs];
              
              if (allWallets.length === 0) {
                console.warn('[/portfolio] Multi-chain: No wallet addresses configured');
                return [];
              }
              
              // Try Zerion first (if API key available)
              let zerionRows = [];
              let zerionSucceeded = false;
              
              if (zerionKey && wallets.length > 0) {
                try {
                  const z = providers.zerion;
                  
                  // Fetch positions only
                  const positionsData = await z.getWalletPositions(wallets[0], zerionKey, { timeoutMs: 10000 }).catch(e => {
                    console.error('[/portfolio] Zerion positions error:', e);
                    return null;
                  });
                  
                  const chainMap = {
                    'ethereum': 'Ethereum', 
                    'arbitrum': 'Arbitrum', 
                    'optimism': 'Optimism',
                    'polygon': 'Polygon', 
                    'base': 'Base', 
                    'avalanche': 'Avalanche',
                    'bsc': 'BSC', 
                    'solana': 'Solana', 
                    'zksync-era': 'zkSync', 
                    'blast': 'Blast',
                    'hyperevm': 'HyperEVM',
                    'linea': 'Linea',
                    'scroll': 'Scroll',
                    'mantle': 'Mantle',
                    'fantom': 'Fantom',
                    'celo': 'Celo',
                    'gnosis': 'Gnosis',
                    'moonbeam': 'Moonbeam',
                    'moonriver': 'Moonriver',
                    'aurora': 'Aurora',
                    'cronos': 'Cronos'
                  };
                  
                  // Process fungible positions
                  if (positionsData && Array.isArray(positionsData.data)) {
                    for (const item of positionsData.data) {
                      const attr = item?.attributes || {};
                      const fungible = attr.fungible_info;
                      const flags = attr.flags || {};
                      
                      if (fungible && !flags.is_trash) {
                        const chainId = item?.relationships?.chain?.data?.id || 'unknown';
                        const chain = chainMap[chainId] || chainId.charAt(0).toUpperCase() + chainId.slice(1);
                        
                        zerionRows.push({
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
                  
                  // If we got data from Zerion, use it (but still fetch Bitcoin/Zcash separately)
                  if (zerionRows.length > 0) {
                    zerionSucceeded = true;
                  }
                } catch (e) { 
                  console.error('[/portfolio] Zerion error:', e.message || e);
                }
              }
              
              // Get Bitcoin and Zcash addresses from settings (always check, regardless of Zerion)
              const bitcoinAddrs = (settings.bitcoinAddresses || '').split(',').map(a => a.trim()).filter(Boolean);
              const zcashAddrs = (settings.zcashAddresses || '').split(',').map(a => a.trim()).filter(Boolean);
              
              // Fetch Bitcoin/Zcash separately since Zerion doesn't support them
              const btcZecRows = [];
              if (bitcoinAddrs.length > 0 || zcashAddrs.length > 0) {
                try {
                  const [btcTokens, zcashTokens, cryptoPrices] = await Promise.all([
                    // Bitcoin
                    bitcoinAddrs.length > 0
                      ? providers.bitcoin.getTokenBalances(bitcoinAddrs, { timeoutMs: 15000 }).catch(e => {
                          console.error('[/portfolio] Bitcoin error:', e.message || e);
                          return [];
                        })
                      : Promise.resolve([]),
                    
                    // Zcash
                    zcashAddrs.length > 0
                      ? providers.zcash.getTokenBalances(zcashAddrs, { timeoutMs: 15000 }).catch(e => {
                          console.error('[/portfolio] Zcash error:', e.message || e);
                          return [];
                        })
                      : Promise.resolve([]),
                    
                    // Get BTC and ZEC prices from CoinGecko
                    providers.coingecko.getSimplePrice('bitcoin,zcash', { timeoutMs: 8000, ttlMs: 60000 }).catch(e => {
                      console.error('[/portfolio] CoinGecko price error:', e.message || e);
                      return {};
                    })
                  ]);
                  
                  // Process Bitcoin - enrich with price
                  const btcPrice = cryptoPrices?.bitcoin?.usd || 0;
                  const btcChange24h = cryptoPrices?.bitcoin?.usd_24h_change || null;
                  for (const btc of btcTokens) {
                    btcZecRows.push({
                      asset: 'BTC',
                      exchange: 'Bitcoin',
                      amount: btc.balance,
                      price: btcPrice,
                      value: btc.balance * btcPrice,
                      change24h: btcChange24h,
                      pnl: null
                    });
                  }
                  
                  // Process Zcash - enrich with price
                  const zecPrice = cryptoPrices?.zcash?.usd || 0;
                  const zecChange24h = cryptoPrices?.zcash?.usd_24h_change || null;
                  for (const zec of zcashTokens) {
                    btcZecRows.push({
                      asset: 'ZEC',
                      exchange: 'Zcash',
                      amount: zec.balance,
                      price: zecPrice,
                      value: zec.balance * zecPrice,
                      change24h: zecChange24h,
                      pnl: null
                    });
                  }
                } catch (e) {
                  console.error('[/portfolio] Bitcoin/Zcash fetch error:', e.message || e);
                }
              }
              
              // Return Zerion data plus Bitcoin/Zcash
              if (zerionSucceeded) {
                return [...zerionRows, ...btcZecRows];
              }
              
              // Fallback to Alchemy + Helius (if no Zerion)
              if (alchemyKey || heliusKey) {
                const rows = [];
                
                // Fetch Alchemy and Helius in parallel
                const [alchemyTokens, heliusTokens] = await Promise.all([
                  // Alchemy (EVM chains)
                  alchemyKey && wallets.length > 0 
                    ? providers.alchemy.getTokenBalances(wallets, alchemyKey, { timeoutMs: 20000 }).catch(e => {
                        console.error('[/portfolio] Alchemy error:', e.message || e);
                        return [];
                      })
                    : Promise.resolve([]),
                  
                  // Helius (Solana)
                  heliusKey && solanaAddrs.length > 0
                    ? providers.helius.getTokenBalances(solanaAddrs, heliusKey, { timeoutMs: 15000 }).catch(e => {
                        console.error('[/portfolio] Helius error:', e.message || e);
                        return [];
                      })
                    : Promise.resolve([])
                ]);
                
                // Process Alchemy tokens
                for (const token of alchemyTokens) {
                  rows.push({
                    asset: token.tokenSymbol,
                    exchange: token.blockchain,
                    amount: token.balance,
                    price: token.tokenPrice || 0,
                    value: token.balanceUsd || 0,
                    change24h: token.change24h ?? null,
                    pnl: null
                  });
                }
                
                // Process Helius tokens
                for (const token of heliusTokens) {
                  rows.push({
                    asset: token.tokenSymbol,
                    exchange: token.blockchain,
                    amount: token.balance,
                    price: token.tokenPrice || 0,
                    value: token.balanceUsd || 0,
                    change24h: token.change24h ?? null,
                    pnl: null
                  });
                }
                
                // Combine with Bitcoin/Zcash data (fetched separately above)
                return [...rows, ...btcZecRows];
              }
              
              // If we only have Bitcoin/Zcash addresses (no other providers)
              if (btcZecRows.length > 0) {
                return btcZecRows;
              }
              
              console.warn('[/portfolio] ⚠️ No multi-chain data available (no API keys or all providers failed)');
              return [];
            })()
          ]);
          
          allRows.push(...hlResults.flat(), ...multichainData);
          
          if (allRows.length > 0) {
            // Enrich with prices for HL/Lighter (Zerion already has prices)
            const uniqueAssets = [...new Set(allRows.filter(r => !r.price || r.price === 0).map(r => r.asset))];
            
            if (uniqueAssets.length > 0) {
              try {
                // Fetch market data from Hyperliquid for all assets (perps + spot)
                const [marketData, allMids, spotMeta] = await Promise.all([
                  providers.hyperliquid.fetchMetaAndAssetCtxs(10000),
                  providers.hyperliquid.fetchAllMids(10000),
                  providers.hyperliquid.fetchSpotMeta(10000)
                ]);
                
                const priceMap = {};
                const change24hMap = {};
                
                // Get perp prices
                if (marketData && marketData[0] && marketData[1]) {
                  for (let i = 0; i < marketData[1].length; i++) {
                    const ctx = marketData[1][i];
                    const assetName = marketData[0].universe[i]?.name;
                    if (assetName && ctx?.markPx) {
                      const markPx = parseFloat(ctx.markPx);
                      const prevDayPx = parseFloat(ctx.prevDayPx || 0);
                      priceMap[assetName] = markPx;
                      
                      if (prevDayPx > 0) {
                        change24hMap[assetName] = ((markPx - prevDayPx) / prevDayPx) * 100;
                      }
                    }
                  }
                }
                
                // Get spot prices using proper @index mapping
                if (allMids && spotMeta && spotMeta.universe) {
                  for (const spotPair of spotMeta.universe) {
                    if (spotPair.tokens && spotPair.tokens[1] === 0) { // USDC quote
                      const spotKey = `@${spotPair.index}`;
                      const tokenName = spotPair.name;
                      if (allMids[spotKey]) {
                        priceMap[tokenName] = parseFloat(allMids[spotKey]);
                      }
                    }
                  }
                  // Also check tokens array
                  if (spotMeta.tokens) {
                    for (const token of spotMeta.tokens) {
                      if (token.name && token.index !== undefined) {
                        const spotPair = spotMeta.universe.find(pair => 
                          pair.tokens && pair.tokens[0] === token.index && pair.tokens[1] === 0
                        );
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
                
                // Load wallet asset entry prices from localStorage
                const getWalletEntryPrices = () => {
                  try {
                    const stored = localStorage.getItem('walletAssetEntryPrices');
                    return stored ? JSON.parse(stored) : {};
                  } catch {
                    return {};
                  }
                };
                
                const saveWalletEntryPrices = (entryPrices) => {
                  try {
                    localStorage.setItem('walletAssetEntryPrices', JSON.stringify(entryPrices));
                  } catch (e) {
                    console.error('[Portfolio] Failed to save entry prices:', e);
                  }
                };
                
                const walletEntryPrices = getWalletEntryPrices();
                let entryPricesUpdated = false;
                
                // Apply prices and 24h% to all positions (calculate PnL)
                for (const row of allRows) {
                  const currentPrice = priceMap[row.asset] || row.price || 0;
                  const change24h = change24hMap[row.asset];
                  
                  // Stablecoins default to $1
                  const finalPrice = (row.asset === 'USDC' || row.asset === 'USDT' || row.asset === 'FEUSD') && currentPrice === 0 ? 1 : currentPrice;
                  
                  if (finalPrice > 0) {
                    row.price = finalPrice;
                    // Recalculate value with current price
                    row.value = Math.abs(row.amount) * finalPrice;
                    
                    // Calculate PnL for Hyperliquid Spot using entryNtl
                    if (row.entryNtl && row.entryNtl > 0) {
                      row.pnl = row.value - row.entryNtl;
                    }
                    // Or use entry price if available (perp positions)
                    else if (row.entryPrice && row.entryPrice > 0) {
                      const costBasis = Math.abs(row.amount) * row.entryPrice;
                      const currentValue = Math.abs(row.amount) * finalPrice;
                      row.pnl = row.amount >= 0 ? (currentValue - costBasis) : (costBasis - currentValue);
                    }
                    // For wallet assets without entry price, track first-seen price
                    else if (row.exchange !== 'Hyperliquid' && row.exchange !== 'Lighter') {
                      const posKey = `${row.asset}_${row.exchange}`;
                      
                      // Check if we have a stored entry price
                      if (walletEntryPrices[posKey]) {
                        const storedEntry = walletEntryPrices[posKey];
                        row.entryPrice = storedEntry.price;
                        row.entryDate = storedEntry.date;
                        
                        // Calculate PnL using stored entry price
                        const costBasis = Math.abs(row.amount) * storedEntry.price;
                        const currentValue = Math.abs(row.amount) * finalPrice;
                        row.pnl = currentValue - costBasis;
                      } 
                      // First time seeing this asset - record current price as entry
                      else if (Math.abs(row.amount) > 0 && finalPrice > 0) {
                        walletEntryPrices[posKey] = {
                          price: finalPrice,
                          date: new Date().toISOString(),
                          amount: Math.abs(row.amount)
                        };
                        row.entryPrice = finalPrice;
                        row.entryDate = walletEntryPrices[posKey].date;
                        row.pnl = 0; // No PnL on first detection
                        entryPricesUpdated = true;
                      }
                    }
                  }
                  
                  if (change24h !== undefined && change24h !== null) {
                    row.change24h = change24h;
                  }
                }
                
                // Save updated entry prices if any were added
                if (entryPricesUpdated) {
                  saveWalletEntryPrices(walletEntryPrices);
                  console.log('[Portfolio] Saved entry prices for new wallet assets');
                }
                
                // Log PnL summary
                const walletAssetsWithPnl = allRows.filter(r => 
                  r.pnl !== null && r.pnl !== undefined && 
                  r.exchange !== 'Hyperliquid' && r.exchange !== 'Lighter'
                );
                if (walletAssetsWithPnl.length > 0) {
                  console.log(`[Portfolio] Tracking PnL for ${walletAssetsWithPnl.length} wallet assets`);
                }
              } catch (e) {
                console.error('[/portfolio] Price enrichment failed:', e);
              }
            }
            
            // Add manual positions from settings
            if (settings.cryptoPositions && settings.cryptoPositions.length > 0) {
              for (const manualPos of settings.cryptoPositions) {
                if (manualPos.type === 'custom') {
                  // Custom asset with fixed value
                  allRows.push({
                    asset: manualPos.name,
                    exchange: 'Manual',
                    amount: 1,
                    value: manualPos.value,
                    price: manualPos.value,
                    change24h: null,
                    pnl: null,
                    pnlPercent: null,
                    isManual: true,
                    manualType: 'custom'
                  });
                } else if (manualPos.type === 'pyth') {
                  // Pyth oracle position - fetch current price
                  const entryPrice = manualPos.entryPrice || 0;
                  const currentValue = manualPos.amount * entryPrice;
                  
                  // We'll try to get the current Pyth price
                  let currentPrice = entryPrice;
                  let pnl = null;
                  
                  try {
                    // Fetch Pyth price
                    const pythResp = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?ids[]=${manualPos.feedId}`);
                    if (pythResp.ok) {
                      const pythData = await pythResp.json();
                      if (pythData.parsed && pythData.parsed[0]) {
                        const priceData = pythData.parsed[0].price;
                        currentPrice = parseFloat(priceData.price) * Math.pow(10, priceData.expo);
                        
                        // Calculate PnL
                        const costBasis = manualPos.amount * entryPrice;
                        const currentValue = manualPos.amount * currentPrice;
                        pnl = currentValue - costBasis;
                      }
                    }
                  } catch (e) {
                    console.warn('Failed to fetch Pyth price for manual position:', e);
                  }
                  
                  allRows.push({
                    asset: manualPos.symbol,
                    exchange: 'Manual',
                    amount: manualPos.amount,
                    value: manualPos.amount * currentPrice,
                    price: currentPrice,
                    change24h: null,
                    pnl: pnl,
                    pnlPercent: pnl && entryPrice > 0 ? (pnl / (manualPos.amount * entryPrice)) * 100 : null,
                    entryPrice: entryPrice,
                    isManual: true,
                    manualType: 'pyth'
                  });
                }
              }
            }
            
            // Aggregate duplicate assets (except leveraged positions)
            const aggregatedRows = [];
            const assetGroups = new Map();
            
            for (const row of allRows) {
              // Keep leveraged positions separate - don't aggregate them
              if (row.isLeveraged) {
                aggregatedRows.push(row);
                continue;
              }
              
              // Group spot positions by asset
              const assetKey = row.asset;
              if (!assetGroups.has(assetKey)) {
                assetGroups.set(assetKey, []);
              }
              assetGroups.get(assetKey).push(row);
            }
            
            // Combine grouped positions
            for (const [asset, positions] of assetGroups) {
              if (positions.length === 1) {
                // Single position, add as-is
                aggregatedRows.push(positions[0]);
              } else {
                // Multiple positions for same asset - aggregate them
                const totalAmount = positions.reduce((sum, p) => sum + (p.amount || 0), 0);
                const totalValue = positions.reduce((sum, p) => sum + (p.value || 0), 0);
                const totalPnL = positions.reduce((sum, p) => sum + (p.pnl || 0), 0);
                
                // Calculate weighted average price
                const weightedPrice = totalAmount !== 0 ? totalValue / Math.abs(totalAmount) : 0;
                
                // Collect unique exchanges
                const exchanges = [...new Set(positions.map(p => p.exchange))];
                const exchangeLabel = exchanges.length > 1 ? 'Multiple' : exchanges[0];
                
                // Calculate weighted average entry price for PnL
                let totalEntryValue = 0;
                let hasEntryData = false;
                for (const pos of positions) {
                  if (pos.entryPrice && pos.amount) {
                    totalEntryValue += Math.abs(pos.amount) * pos.entryPrice;
                    hasEntryData = true;
                  }
                }
                const avgEntryPrice = hasEntryData && totalAmount !== 0 ? totalEntryValue / Math.abs(totalAmount) : null;
                
                aggregatedRows.push({
                  asset,
                  exchange: exchangeLabel,
                  amount: totalAmount,
                  value: totalValue,
                  price: weightedPrice,
                  change24h: positions[0].change24h, // Use first position's 24h change
                  pnl: totalPnL,
                  entryPrice: avgEntryPrice,
                  isAggregated: true,
                  aggregatedFrom: exchanges
                });
              }
            }
            
            const sorted = aggregatedRows.sort((a, b) => (b.value || 0) - (a.value || 0));
            
            // Cache for re-rendering
            cachedPositions = sorted;
            
            // Calculate total value and PnL from ALL positions (including hidden ones)
            // For leveraged positions: use margin + PnL (actual equity)
            // For spot/regular positions: use full value
            const totalValue = sorted.reduce((sum, p) => {
              if (p.isLeveraged && p.marginUsed !== undefined) {
                // Leveraged position: equity = margin + PnL
                return sum + p.marginUsed + (p.pnl || 0);
              }
              // Regular position: use full value
              return sum + (p.value || 0);
            }, 0);
            const totalPnL = sorted.reduce((sum, p) => sum + (p.pnl || 0), 0);
            
            // Calculate PnL percentage: (PnL / cost basis) * 100
            // Cost basis = current value - PnL
            const costBasis = totalValue - totalPnL;
            const totalPnLPercent = (costBasis > 0) ? (totalPnL / costBasis) * 100 : 0;
            
            cachedSummaryData = { totalValue, totalPnL, totalPnLPercent };
            
            // Filter out hidden assets for display
            const visible = sorted.filter(p => {
              const key = `${p.asset}_${p.exchange}`;
              return !hiddenAssets.has(key);
            });
            
            PositionsUI.renderPositions({
              positions: visible,
              containers: { positionsBody, mobilePositionsContainer: mobileContainer },
              options: { amountsVisible, hideSmallPositions, editMode, settings: { minBalanceThreshold: s.minBalanceThreshold || 100, showExactAmounts: s.showExactAmounts || false, useColoredPnL: s.useColoredPnL ?? true } }
            });
            
            rendered = true; // Mark as successfully rendered
            
            // Update hero with real portfolio value and PnL (without weather first)
            const heroHtml = HeroUI.composeSummary({
              portfolioValue: totalValue,
              amountsVisible,
              heroPnLMode: 'total',
              totalPnL,
              totalPnLPercent,
              totalDailyChange: 0,
              totalDailyChangePercent: 0,
              useColoredPnL: s.useColoredPnL ?? true,
              highlightsHtml: [],
              weather: null
            });
            summaryEl.innerHTML = heroHtml;
            
            // Load weather asynchronously and update hero when ready
            (async () => {
              try {
                if (s.weather?.lat && s.weather?.lon) {
                  const Weather = window.AppModules?.data?.providers?.weather;
                  if (Weather) {
                    const weatherData = await Weather.getWeather(s.weather.lat, s.weather.lon, 10000);
                    if (weatherData && weatherData.current) {
                      const temp = Math.round(weatherData.current.temperature_2m);
                      const city = s.weather?.label || 'your location';
                      const weatherCode = weatherData.current.weather_code || 0;
                      const isDay = weatherData.current.is_day === 1;
                      let weatherIcon = '';
                      if (weatherCode === 0) weatherIcon = isDay ? '☀︎' : '☾';
                      else if (weatherCode <= 3) weatherIcon = '☁︎';
                      else if (weatherCode <= 49) weatherIcon = '☁︎';
                      else if (weatherCode <= 67) weatherIcon = '⛆';
                      else if (weatherCode <= 77) weatherIcon = '❅';
                      else if (weatherCode <= 82) weatherIcon = '⛆';
                      else if (weatherCode <= 86) weatherIcon = '❅';
                      else if (weatherCode <= 99) weatherIcon = '⛈';
                      else weatherIcon = '☁︎';
                      const moonPhase = (weatherData.moonPhase !== undefined) ? weatherData.moonPhase : (() => {
                        const today = new Date();
                        const knownNewMoon = new Date('2000-01-06');
                        const daysSince = (today - knownNewMoon) / (1000 * 60 * 60 * 24);
                        return (daysSince % 29.53058867) / 29.53058867;
                      })();
                      let moonIcon = '';
                      let moonName = '';
                      if (moonPhase < 0.0625) { moonIcon = '○'; moonName = 'new moon'; }
                      else if (moonPhase < 0.1875) { moonIcon = '☽'; moonName = 'waxing crescent'; }
                      else if (moonPhase < 0.3125) { moonIcon = '◐'; moonName = 'first quarter'; }
                      else if (moonPhase < 0.4375) { moonIcon = '◐'; moonName = 'waxing gibbous'; }
                      else if (moonPhase < 0.5625) { moonIcon = '●'; moonName = 'full moon'; }
                      else if (moonPhase < 0.6875) { moonIcon = '◑'; moonName = 'waning gibbous'; }
                      else if (moonPhase < 0.8125) { moonIcon = '◑'; moonName = 'last quarter'; }
                      else if (moonPhase < 0.9375) { moonIcon = '☾'; moonName = 'waning crescent'; }
                      else { moonIcon = '○'; moonName = 'new moon'; }
                      const hour = new Date().getHours();
                      const showMoon = hour >= 18 || hour < 6;
                      const moonText = showMoon ? ` with a ${moonIcon} ${moonName} moon` : '';
                      const precipitation = weatherData.daily?.precipitation_sum?.[0] || 0;
                      const weather = { temp, city, icon: weatherIcon, moonText, precipitation };
                      
                      // Re-render hero with weather
                      const heroHtmlWithWeather = HeroUI.composeSummary({
                        portfolioValue: totalValue,
                        amountsVisible,
                        heroPnLMode: 'total',
                        totalPnL,
                        totalPnLPercent,
                        totalDailyChange: 0,
                        totalDailyChangePercent: 0,
                        useColoredPnL: s.useColoredPnL ?? true,
                        highlightsHtml: [],
                        weather
                      });
                      summaryEl.innerHTML = heroHtmlWithWeather;
                    }
                  }
                }
              } catch (e) {
                console.warn('[/portfolio] Weather load failed:', e);
                // Don't show error to user, just skip weather
              }
            })();
          }
        }
      } catch (e) {
        console.error('[/portfolio] Positions error:', e);
        summaryEl.innerHTML = `<span class="loading-terminal">Error loading positions: ${e?.message || e}</span>`;
      }

      if (!rendered) {
        // No positions found
        positionsBody.innerHTML = '<tr><td colspan="7" class="loading">No positions found. Add wallets in Settings.</td></tr>';
        if (mobileContainer) mobileContainer.innerHTML = '';
        summaryEl.innerHTML = 'Your portfolio is empty. Add wallets in Settings.';
      }
    }
  } catch (e) {
    summaryEl.innerHTML = `<span class="loading-terminal">Error: ${e?.message || e}</span>`;
  }
}

let amountsVisible = true; // Default: show values
let compactMode = true; // Default: compact mode
let editMode = false;
let hideSmallPositions = true; // Default: hide positions under $100
let hiddenAssets = new Set();
let cachedPositions = [];
let cachedSummaryData = {};
let cachedWatchlistData = null; // Cache watchlist data globally
let watchlistEditMode = false;
let rerenderPositions = null; // Global reference to rerender function
let currentFontSize = 15; // Default font size in px

function initLoadingScreen() {
  const dotGrid = document.getElementById('newDotGrid');
  if (!dotGrid) return;
  const gridSize = 8;
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const dot = document.createElement('div');
      dot.className = 'dot';
      const verticalProgress = row / gridSize;
      const horizontalWave = (col / gridSize) * 0.4;
      const randomOffset = Math.random() * 0.8;
      const verticalDelay = verticalProgress * 0.6;
      const totalDelay = horizontalWave + randomOffset + verticalDelay;
      const duration = 1.5 + verticalProgress * 0.8;
      dot.style.setProperty('--delay', `${totalDelay}s`);
      dot.style.setProperty('--duration', `${duration}s`);
      dotGrid.appendChild(dot);
    }
  }
}

function hideLoadingScreen() {
  const loadingScreen = document.getElementById('newLoadingScreen');
  if (loadingScreen) {
    loadingScreen.classList.add('hidden');
    setTimeout(() => { loadingScreen.style.display = 'none'; }, 300);
  }
}

function applyFontSize(size) {
  document.documentElement.style.fontSize = size + 'px';
  currentFontSize = size;
  const displays = [
    document.getElementById('newFontSizeDisplay'),
    document.getElementById('newFontSizeDisplayMobile')
  ];
  displays.forEach(display => {
    if (display) display.textContent = size + 'px';
  });
}

function setupControls() {
  const Settings = window.AppModules?.core?.settings;
  const settings = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
  
  // Load hidden assets from settings
  const savedHidden = settings.hiddenAssets || [];
  hiddenAssets = new Set(savedHidden);
  
  // Mobile menu
  const mobileMenuBtn = document.getElementById('newMobileMenuBtn');
  const mobileMenu = document.getElementById('newMobileMenu');
  const closeMobileMenuBtn = document.getElementById('newCloseMobileMenuBtn');
  
  if (mobileMenuBtn && mobileMenu) {
    mobileMenuBtn.addEventListener('click', () => {
      mobileMenu.classList.add('active');
      document.body.classList.add('mobile-menu-open');
    });
  }
  
  if (closeMobileMenuBtn && mobileMenu) {
    closeMobileMenuBtn.addEventListener('click', () => {
      mobileMenu.classList.remove('active');
      document.body.classList.remove('mobile-menu-open');
    });
  }
  
  // Sync mobile buttons with desktop
  const syncMobileButtons = (desktopId, mobileId, action) => {
    const desktop = document.getElementById(desktopId);
    const mobile = document.getElementById(mobileId);
    if (mobile && desktop) {
      mobile.addEventListener('click', () => {
        if (mobileMenu) {
          mobileMenu.classList.remove('active');
          document.body.classList.remove('mobile-menu-open');
        }
        desktop.click();
      });
    }
  };
  
  syncMobileButtons('newToggleAmountsBtn', 'newToggleAmountsBtnMobile');
  syncMobileButtons('newCompactModeBtn', 'newCompactModeBtnMobile');
  syncMobileButtons('newRefreshBtn', 'newRefreshBtnMobile');
  syncMobileButtons('newSettingsBtn', 'newSettingsBtnMobile');
  
  // Toggle small positions
  const hideSmallBtn = document.getElementById('newHideSmallBtn');
  if (hideSmallBtn) {
    hideSmallBtn.addEventListener('click', () => {
      hideSmallPositions = !hideSmallPositions;
      const threshold = settings.minBalanceThreshold || 100;
      hideSmallBtn.textContent = hideSmallPositions ? `[SHOW <$${threshold}]` : `[HIDE <$${threshold}]`;
      rerenderPositions();
    });
    // Sync button text with initial state
    const mobileHideSmallBtn = document.getElementById('newMobileHideSmallBtn');
    if (mobileHideSmallBtn) {
      mobileHideSmallBtn.textContent = hideSmallBtn.textContent;
    }
  }
  
  // Helper to re-render positions with current filters
  rerenderPositions = function() {
    const positionsBody = document.getElementById('newPositionsBody');
    const mobileContainer = document.getElementById('newMobilePositionsContainer');
    const PositionsUI = window.AppModules?.ui?.positions;
    if (PositionsUI && cachedPositions.length > 0) {
      let filtered = cachedPositions.filter(p => {
        const key = `${p.asset}_${p.exchange}`;
        if (hiddenAssets.has(key)) return false;
        if (hideSmallPositions) {
          const threshold = settings.minBalanceThreshold || 100;
          const value = p.value || (Math.abs(p.amount || 0) * (p.price || 0));
          if (value < threshold) return false;
        }
        return true;
      });
      
      PositionsUI.renderPositions({
        positions: filtered,
        containers: { positionsBody, mobilePositionsContainer: mobileContainer },
        options: { amountsVisible, hideSmallPositions: false, editMode, settings: { ...settings, showExactAmounts: settings.showExactAmounts || false, useColoredPnL: settings.useColoredPnL ?? true } }
      });
      
      // Update hero with filtered totals
      // For leveraged positions: use margin + PnL (actual equity)
      const totalValue = filtered.reduce((sum, p) => {
        if (p.isLeveraged && p.marginUsed !== undefined) {
          return sum + p.marginUsed + (p.pnl || 0);
        }
        return sum + (p.value || 0);
      }, 0);
      const totalPnL = filtered.reduce((sum, p) => sum + (p.pnl || 0), 0);
      const summaryEl = document.getElementById('newSummary');
      const HeroUI = window.AppModules?.ui?.hero;
      if (HeroUI && summaryEl) {
        const heroHtml = HeroUI.composeSummary({
          portfolioValue: totalValue,
          amountsVisible,
          heroPnLMode: 'total',
          totalPnL,
          totalPnLPercent: 0,
          totalDailyChange: 0,
          totalDailyChangePercent: 0,
          useColoredPnL: true,
          highlightsHtml: [],
          weather: null
        });
        summaryEl.innerHTML = heroHtml;
      }
    }
  };
  
  // Edit list mode
  const editListBtn = document.getElementById('newEditListBtn');
  if (editListBtn) {
    editListBtn.addEventListener('click', () => {
      editMode = !editMode;
      editListBtn.textContent = editMode ? '[SAVE CHANGES]' : '[EDIT LIST]';
      
      // Re-render with edit mode
      rerenderPositions();
      
      // Add click handlers for hide/delete buttons if in edit mode
      if (editMode) {
        const positionsBody = document.getElementById('newPositionsBody');
        if (positionsBody) {
          positionsBody.addEventListener('click', (e) => {
            if (e.target.classList.contains('position-edit-btn')) {
              const assetKey = e.target.getAttribute('data-asset-key');
              if (hiddenAssets.has(assetKey)) {
                hiddenAssets.delete(assetKey);
              } else {
                hiddenAssets.add(assetKey);
              }
              // Save to localStorage
              const Settings = window.AppModules?.core?.settings;
              const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
              s.hiddenAssets = Array.from(hiddenAssets);
              localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
              
              // Re-render
              rerenderPositions();
            } else if (e.target.classList.contains('position-delete-btn')) {
              // Delete manual position
              const asset = e.target.getAttribute('data-asset');
              const manualType = e.target.getAttribute('data-manual-type');
              
              if (confirm(`Delete manual position "${asset}"?`)) {
                const Settings = window.AppModules?.core?.settings;
                const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
                
                if (s.cryptoPositions && Array.isArray(s.cryptoPositions)) {
                  // Remove the matching position
                  if (manualType === 'custom') {
                    s.cryptoPositions = s.cryptoPositions.filter(p => !(p.type === 'custom' && p.name === asset));
                  } else if (manualType === 'pyth') {
                    s.cryptoPositions = s.cryptoPositions.filter(p => !(p.type === 'pyth' && p.symbol === asset));
                  }
                  
                  // Save
                  localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
                  
                  // Reload page to fetch fresh data
                  location.reload();
                }
              }
            }
          });
        }
      }
    });
  }
  
  // Sync mobile theme select
  const themeSelect = document.getElementById('newThemeSelect');
  const themeSelectMobile = document.getElementById('newThemeSelectMobile');
  if (themeSelect && themeSelectMobile) {
    themeSelectMobile.value = themeSelect.value;
    themeSelectMobile.addEventListener('change', (e) => {
      themeSelect.value = e.target.value;
      themeSelect.dispatchEvent(new Event('change'));
    });
  }
  
  // Toggle amounts
  const amountsBtn = document.getElementById('newToggleAmountsBtn');
  if (amountsBtn) {
    amountsBtn.addEventListener('click', () => {
      amountsVisible = !amountsVisible;
      amountsBtn.textContent = amountsVisible ? '[HIDE AMOUNTS]' : '[SHOW AMOUNTS]';
      
      // Re-render with new visibility
      rerenderPositions();
    });
  }
  
  // Toggle compact mode
  const compactBtn = document.getElementById('newCompactModeBtn');
  if (compactBtn) {
    compactBtn.addEventListener('click', () => {
      compactMode = !compactMode;
      compactBtn.textContent = compactMode ? '[NORMAL]' : '[COMPACT]';
      const tables = document.querySelectorAll('.data-table');
      const posTable = document.getElementById('newPositionsTable');
      
      tables.forEach(table => {
        if (compactMode) {
          table.classList.add('compact-mode');
        } else {
          table.classList.remove('compact-mode');
        }
      });
      
      if (compactMode) {
        document.body.classList.add('compact-mode');
      } else {
        document.body.classList.remove('compact-mode');
      }
      
      // Update table header order for compact mode
      if (posTable) {
        const headerRow = posTable.querySelector('thead tr');
        if (headerRow) {
          if (compactMode) {
            // Compact: Asset, Price, Value, P&L, 24H%, Amount, Exchange
            headerRow.innerHTML = `
              <th class="th-asset">Asset</th>
              <th class="th-price">Price</th>
              <th class="th-value">Value</th>
              <th class="th-pnl">P&L</th>
              <th class="th-change">24H%</th>
              <th class="th-amount">Amount</th>
              <th class="th-exchange">Exchange</th>
            `;
          } else {
            // Normal: Asset, Exchange, Amount, Price, Value, 24H%, P&L
            headerRow.innerHTML = `
              <th class="th-asset">Asset</th>
              <th class="th-exchange">Exchange</th>
              <th class="th-amount">Amount</th>
              <th class="th-price">Price</th>
              <th class="th-value">Value</th>
              <th class="th-change">24H%</th>
              <th class="th-pnl">P&L</th>
            `;
          }
        }
        
        // Re-render positions with new column order
        const positionsBody = document.getElementById('newPositionsBody');
        const mobileContainer = document.getElementById('newMobilePositionsContainer');
        const PositionsUI = window.AppModules?.ui?.positions;
        if (PositionsUI && cachedPositions.length > 0) {
          PositionsUI.renderPositions({
            positions: cachedPositions,
            containers: { positionsBody, mobilePositionsContainer: mobileContainer },
            options: { amountsVisible, hideSmallPositions: false, settings: { minBalanceThreshold: 0, showExactAmounts: false, useColoredPnL: true } }
          });
        }
      }
    });
  }
  
  // Refresh button
  const refreshBtn = document.getElementById('newRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      location.reload();
    });
  }
  
  // Settings dialog
  const settingsBtn = document.getElementById('newSettingsBtn');
  const settingsDialog = document.getElementById('newSettingsDialog');
  const settingsBackdrop = document.getElementById('newSettingsBackdrop');
  const closeBtn = document.getElementById('newCloseSettingsBtn');
  const cancelBtn = document.getElementById('newCancelSettingsBtn');
  const saveBtn = document.getElementById('newSaveSettingsBtn');
  
  const openSettings = () => {
    if (settingsDialog && settingsBackdrop) {
      // Load current settings into form
      const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
      const userNameInput = document.getElementById('newUserName');
      const walletInput = document.getElementById('newWalletAddresses');
      const solanaInput = document.getElementById('newSolanaAddresses');
      const bitcoinInput = document.getElementById('newBitcoinAddresses');
      const zcashInput = document.getElementById('newZcashAddresses');
      const zerionInput = document.getElementById('newZerionApiKey');
      const alchemyInput = document.getElementById('newAlchemyApiKey');
      const heliusInput = document.getElementById('newHeliusApiKey');
      const openseaInput = document.getElementById('newOpenSeaApiKey');
      const cityInput = document.getElementById('newWeatherCity');
      const latInput = document.getElementById('newWeatherLat');
      const lonInput = document.getElementById('newWeatherLon');
      const coloredPnLInput = document.getElementById('newUseColoredPnL');
      const showWatchlistInput = document.getElementById('newShowWatchlist');
      const showComicInput = document.getElementById('newShowComic');
      const comicStripInput = document.getElementById('newComicStrip');
      const minBalanceInput = document.getElementById('newMinBalanceThreshold');
      const leftAlignedInput = document.getElementById('newLeftAligned');
      
      // Menu visibility controls
      const showSnowBtnInput = document.getElementById('newShowSnowBtn');
      const showRainBtnInput = document.getElementById('newShowRainBtn');
      const showFontSizeInput = document.getElementById('newShowFontSize');
      const showThemeBtnInput = document.getElementById('newShowThemeBtn');
      const showAmountsBtnInput = document.getElementById('newShowAmountsBtn');
      const showCompactBtnInput = document.getElementById('newShowCompactBtn');
      const showRefreshBtnInput = document.getElementById('newShowRefreshBtn');
      const showDonateBtnInput = document.getElementById('newShowDonateBtn');
      const showSettingsBtnInput = document.getElementById('newShowSettingsBtn');
      
      if (userNameInput) userNameInput.value = s.userName || '';
      if (walletInput) walletInput.value = s.walletAddresses || '';
      if (solanaInput) solanaInput.value = s.solanaAddresses || '';
      if (bitcoinInput) bitcoinInput.value = s.bitcoinAddresses || '';
      if (zcashInput) zcashInput.value = s.zcashAddresses || '';
      if (zerionInput) zerionInput.value = s.zerionApiKey || '';
      if (alchemyInput) alchemyInput.value = s.alchemyApiKey || '';
      if (heliusInput) heliusInput.value = s.heliusApiKey || '';
      if (openseaInput) openseaInput.value = s.openSeaApiKey || '';
      if (cityInput) cityInput.value = s.weather?.label || '';
      if (latInput) latInput.value = s.weather?.lat || '';
      if (lonInput) lonInput.value = s.weather?.lon || '';
      if (coloredPnLInput) coloredPnLInput.checked = s.useColoredPnL ?? true;
      if (showWatchlistInput) showWatchlistInput.checked = s.showWatchlist ?? true;
      if (showComicInput) showComicInput.checked = s.showComic ?? false;
      if (comicStripInput) comicStripInput.value = s.comicStrip || 'calvinandhobbes';
      if (minBalanceInput) minBalanceInput.value = s.minBalanceThreshold || 100;
      if (leftAlignedInput) leftAlignedInput.checked = s.leftAligned ?? true;
      
      // Menu visibility checkboxes
      if (showSnowBtnInput) showSnowBtnInput.checked = s.showSnowBtn ?? true;
      if (showRainBtnInput) showRainBtnInput.checked = s.showRainBtn ?? true;
      if (showFontSizeInput) showFontSizeInput.checked = s.showFontSize ?? true;
      if (showThemeBtnInput) showThemeBtnInput.checked = s.showThemeBtn ?? true;
      if (showAmountsBtnInput) showAmountsBtnInput.checked = s.showAmountsBtn ?? true;
      if (showCompactBtnInput) showCompactBtnInput.checked = s.showCompactBtn ?? true;
      if (showRefreshBtnInput) showRefreshBtnInput.checked = s.showRefreshBtn ?? true;
      if (showDonateBtnInput) showDonateBtnInput.checked = s.showDonateBtn ?? true;
      if (showSettingsBtnInput) showSettingsBtnInput.checked = s.showSettingsBtn ?? true;
      
      settingsDialog.style.display = 'block';
      settingsBackdrop.style.display = 'block';
    }
  };
  
  // Import/Export state
  let importMode = false;
  const exportBtn = document.getElementById('newExportSettingsBtn');
  const exportArea = document.getElementById('newSettingsExportArea');
  const importBtn = document.getElementById('newImportSettingsBtn');
  
  const closeSettings = () => {
    if (settingsDialog && settingsBackdrop) {
      // Reset import mode if active
      if (importMode && exportArea && importBtn) {
        exportArea.style.display = 'none';
        exportArea.setAttribute('readonly', 'readonly');
        importBtn.textContent = '[IMPORT]';
        importMode = false;
      }
      settingsDialog.style.display = 'none';
      settingsBackdrop.style.display = 'none';
    }
  };
  
  if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
  if (closeBtn) closeBtn.addEventListener('click', closeSettings);
  if (cancelBtn) cancelBtn.addEventListener('click', closeSettings);
  if (settingsBackdrop) settingsBackdrop.addEventListener('click', closeSettings);
  
  // Export settings
  if (exportBtn && exportArea) {
    exportBtn.addEventListener('click', async () => {
      const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
      const exportData = btoa(JSON.stringify(s));
      exportArea.value = exportData;
      exportArea.style.display = 'block';
      exportArea.removeAttribute('readonly');
      exportArea.select();
      
      try {
        await navigator.clipboard.writeText(exportData);
        const originalText = exportBtn.textContent;
        exportBtn.textContent = '[COPIED!]';
        setTimeout(() => {
          exportBtn.textContent = originalText;
        }, 1500);
      } catch (err) {
        // Clipboard failed, but text is still selected
      }
    });
  }
  
  // Import settings
  if (importBtn && exportArea) {
    importBtn.addEventListener('click', () => {
      if (!importMode) {
        // First click: show textarea for pasting
        exportArea.value = '';
        exportArea.placeholder = 'Paste exported settings here, then click [SAVE & RELOAD] at the bottom';
        exportArea.style.display = 'block';
        exportArea.removeAttribute('readonly');
        exportArea.focus();
        importBtn.textContent = '[CANCEL IMPORT]';
        importMode = true;
      } else {
        // Second click: cancel import
        exportArea.style.display = 'none';
        exportArea.setAttribute('readonly', 'readonly');
        exportArea.value = '';
        importBtn.textContent = '[IMPORT]';
        importMode = false;
      }
    });
  }
  
  // Rain/Snow controls
  const Rain = window.AppModules?.features?.rain;
  const toggleRainBtn = document.getElementById('newToggleRainBtn');
  const toggleSnowBtn = document.getElementById('newToggleSnowBtn');
  const toggleRainBtnMobile = document.getElementById('newToggleRainBtnMobile');
  const toggleSnowBtnMobile = document.getElementById('newToggleSnowBtnMobile');
  
  if (Rain && toggleRainBtn) {
    toggleRainBtn.addEventListener('click', () => {
      const active = Rain.toggleRain();
      toggleRainBtn.textContent = active ? '[RAIN OFF]' : '[RAIN ON]';
      if (toggleRainBtnMobile) {
        toggleRainBtnMobile.textContent = active ? '[RAIN OFF]' : '[RAIN ON]';
      }
      if (active) {
        toggleSnowBtn.textContent = '[SNOW ON]';
        if (toggleSnowBtnMobile) toggleSnowBtnMobile.textContent = '[SNOW ON]';
      }
      
      // Save to localStorage
      const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
      s.rainEnabled = active;
      s.snowEnabled = false;
      localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
    });
  }
  
  if (Rain && toggleSnowBtn) {
    toggleSnowBtn.addEventListener('click', () => {
      const active = Rain.toggleSnow();
      toggleSnowBtn.textContent = active ? '[SNOW OFF]' : '[SNOW ON]';
      if (toggleSnowBtnMobile) {
        toggleSnowBtnMobile.textContent = active ? '[SNOW OFF]' : '[SNOW ON]';
      }
      if (active) {
        toggleRainBtn.textContent = '[RAIN ON]';
        if (toggleRainBtnMobile) toggleRainBtnMobile.textContent = '[RAIN ON]';
      }
      
      // Save to localStorage
      const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
      s.snowEnabled = active;
      s.rainEnabled = false;
      localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
    });
  }
  
  if (Rain && toggleRainBtnMobile) {
    toggleRainBtnMobile.addEventListener('click', () => {
      const active = Rain.toggleRain();
      toggleRainBtnMobile.textContent = active ? '[RAIN OFF]' : '[RAIN ON]';
      if (toggleRainBtn) {
        toggleRainBtn.textContent = active ? '[RAIN OFF]' : '[RAIN ON]';
      }
      if (active) {
        toggleSnowBtn.textContent = '[SNOW ON]';
        if (toggleSnowBtnMobile) toggleSnowBtnMobile.textContent = '[SNOW ON]';
      }
      
      // Close mobile menu if open
      const mobileMenu = document.getElementById('newMobileMenu');
      if (mobileMenu) {
        mobileMenu.classList.remove('active');
        document.body.classList.remove('mobile-menu-open');
      }
      
      // Save to localStorage
      const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
      s.rainEnabled = active;
      s.snowEnabled = false;
      localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
    });
  }
  
  if (Rain && toggleSnowBtnMobile) {
    toggleSnowBtnMobile.addEventListener('click', () => {
      const active = Rain.toggleSnow();
      toggleSnowBtnMobile.textContent = active ? '[SNOW OFF]' : '[SNOW ON]';
      if (toggleSnowBtn) {
        toggleSnowBtn.textContent = active ? '[SNOW OFF]' : '[SNOW ON]';
      }
      if (active) {
        toggleRainBtn.textContent = '[RAIN ON]';
        if (toggleRainBtnMobile) toggleRainBtnMobile.textContent = '[RAIN ON]';
      }
      
      // Close mobile menu if open
      const mobileMenu = document.getElementById('newMobileMenu');
      if (mobileMenu) {
        mobileMenu.classList.remove('active');
        document.body.classList.remove('mobile-menu-open');
      }
      
      // Save to localStorage
      const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
      s.snowEnabled = active;
      s.rainEnabled = false;
      localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
    });
  }
  
  // Font size controls
  const decreaseFontBtn = document.getElementById('newDecreaseFontBtn');
  const increaseFontBtn = document.getElementById('newIncreaseFontBtn');
  const decreaseFontBtnMobile = document.getElementById('newDecreaseFontBtnMobile');
  const increaseFontBtnMobile = document.getElementById('newIncreaseFontBtnMobile');
  
  if (decreaseFontBtn) {
    decreaseFontBtn.addEventListener('click', () => {
      if (currentFontSize > 10) { // minimum 10px
        const newSize = currentFontSize - 1;
        applyFontSize(newSize);
        const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
        s.fontSize = newSize;
        localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
      }
    });
  }
  
  if (increaseFontBtn) {
    increaseFontBtn.addEventListener('click', () => {
      if (currentFontSize < 24) { // maximum 24px
        const newSize = currentFontSize + 1;
        applyFontSize(newSize);
        const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
        s.fontSize = newSize;
        localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
      }
    });
  }
  
  if (decreaseFontBtnMobile) {
    decreaseFontBtnMobile.addEventListener('click', () => {
      if (currentFontSize > 10) {
        const newSize = currentFontSize - 1;
        applyFontSize(newSize);
        const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
        s.fontSize = newSize;
        localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
      }
    });
  }
  
  if (increaseFontBtnMobile) {
    increaseFontBtnMobile.addEventListener('click', () => {
      if (currentFontSize < 24) {
        const newSize = currentFontSize + 1;
        applyFontSize(newSize);
        const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
        s.fontSize = newSize;
        localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
      }
    });
  }
  
  // Use My Location button
  const useMyLocationBtn = document.getElementById('newUseMyLocationBtn');
  if (useMyLocationBtn) {
    useMyLocationBtn.addEventListener('click', async () => {
      if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser');
        return;
      }

      useMyLocationBtn.textContent = '[GETTING LOCATION...]';
      useMyLocationBtn.disabled = true;

      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
          });
        });

        const lat = position.coords.latitude;
        const lon = position.coords.longitude;

        const latInput = document.getElementById('newWeatherLat');
        const lonInput = document.getElementById('newWeatherLon');
        const cityInput = document.getElementById('newWeatherCity');

        if (latInput) latInput.value = lat;
        if (lonInput) lonInput.value = lon;

        // Try to get city name via reverse geocoding
        try {
          const geoResp = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
          if (geoResp.ok) {
            const geoData = await geoResp.json();
            const city = geoData.city || geoData.locality || geoData.principalSubdivision || '';
            if (city && cityInput) {
              cityInput.value = city;
            }
          }
        } catch (err) {
          // Silent - city name is optional
        }

        useMyLocationBtn.textContent = '[USE MY LOCATION]';
        useMyLocationBtn.disabled = false;
      } catch (err) {
        console.error('Location denied:', err);
        alert('Could not get your location. Please check browser permissions.');
        useMyLocationBtn.textContent = '[USE MY LOCATION]';
        useMyLocationBtn.disabled = false;
      }
    });
  }
  
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      // Check if import mode is active and there's data to import
      if (importMode && exportArea && exportArea.value.trim()) {
        try {
          const importData = exportArea.value.trim();
          const decoded = atob(importData);
          const importedSettings = JSON.parse(decoded);
          
          // Save imported settings to localStorage
          localStorage.setItem('myDashboardSettings.v1', JSON.stringify(importedSettings));
          
          // Reset import mode UI
          exportArea.style.display = 'none';
          exportArea.setAttribute('readonly', 'readonly');
          importBtn.textContent = '[IMPORT]';
          importMode = false;
          
          // Close settings and reload
          closeSettings();
          location.reload();
          return;
        } catch (err) {
          alert('Invalid settings data. Please check the pasted text and try again.');
          console.error('[Import] Failed to import settings:', err);
          return;
        }
      }
      
      // Normal save flow: Collect form values and save to legacy storage (compatibility)
      const newSettings = settings || {};
      const userNameInput = document.getElementById('newUserName');
      const walletInput = document.getElementById('newWalletAddresses');
      const solanaInput = document.getElementById('newSolanaAddresses');
      const bitcoinInput = document.getElementById('newBitcoinAddresses');
      const zcashInput = document.getElementById('newZcashAddresses');
      const zerionInput = document.getElementById('newZerionApiKey');
      const alchemyInput = document.getElementById('newAlchemyApiKey');
      const heliusInput = document.getElementById('newHeliusApiKey');
      const openseaInput = document.getElementById('newOpenSeaApiKey');
      const cityInput = document.getElementById('newWeatherCity');
      const latInput = document.getElementById('newWeatherLat');
      const lonInput = document.getElementById('newWeatherLon');
      const coloredPnLInput = document.getElementById('newUseColoredPnL');
      const showWatchlistInput = document.getElementById('newShowWatchlist');
      const showComicInput = document.getElementById('newShowComic');
      const comicStripInput = document.getElementById('newComicStrip');
      const minBalanceInput = document.getElementById('newMinBalanceThreshold');
      const leftAlignedInput = document.getElementById('newLeftAligned');
      
      // Menu visibility controls
      const showSnowBtnInput = document.getElementById('newShowSnowBtn');
      const showRainBtnInput = document.getElementById('newShowRainBtn');
      const showFontSizeInput = document.getElementById('newShowFontSize');
      const showThemeBtnInput = document.getElementById('newShowThemeBtn');
      const showAmountsBtnInput = document.getElementById('newShowAmountsBtn');
      const showCompactBtnInput = document.getElementById('newShowCompactBtn');
      const showRefreshBtnInput = document.getElementById('newShowRefreshBtn');
      const showDonateBtnInput = document.getElementById('newShowDonateBtn');
      const showSettingsBtnInput = document.getElementById('newShowSettingsBtn');
      
      if (userNameInput) newSettings.userName = userNameInput.value;
      if (walletInput) newSettings.walletAddresses = walletInput.value;
      if (solanaInput) newSettings.solanaAddresses = solanaInput.value;
      if (bitcoinInput) newSettings.bitcoinAddresses = bitcoinInput.value;
      if (zcashInput) newSettings.zcashAddresses = zcashInput.value;
      if (zerionInput) newSettings.zerionApiKey = zerionInput.value;
      if (alchemyInput) newSettings.alchemyApiKey = alchemyInput.value;
      if (heliusInput) newSettings.heliusApiKey = heliusInput.value;
      if (openseaInput) newSettings.openSeaApiKey = openseaInput.value;
      if (coloredPnLInput) newSettings.useColoredPnL = coloredPnLInput.checked;
      if (showWatchlistInput) newSettings.showWatchlist = showWatchlistInput.checked;
      if (showComicInput) newSettings.showComic = showComicInput.checked;
      if (comicStripInput) newSettings.comicStrip = comicStripInput.value;
      if (minBalanceInput) newSettings.minBalanceThreshold = parseFloat(minBalanceInput.value) || 100;
      if (leftAlignedInput) newSettings.leftAligned = leftAlignedInput.checked;
      
      // Save menu visibility settings
      if (showSnowBtnInput) newSettings.showSnowBtn = showSnowBtnInput.checked;
      if (showRainBtnInput) newSettings.showRainBtn = showRainBtnInput.checked;
      if (showFontSizeInput) newSettings.showFontSize = showFontSizeInput.checked;
      if (showThemeBtnInput) newSettings.showThemeBtn = showThemeBtnInput.checked;
      if (showAmountsBtnInput) newSettings.showAmountsBtn = showAmountsBtnInput.checked;
      if (showCompactBtnInput) newSettings.showCompactBtn = showCompactBtnInput.checked;
      if (showRefreshBtnInput) newSettings.showRefreshBtn = showRefreshBtnInput.checked;
      if (showDonateBtnInput) newSettings.showDonateBtn = showDonateBtnInput.checked;
      if (showSettingsBtnInput) newSettings.showSettingsBtn = showSettingsBtnInput.checked;
      
      newSettings.weather = {
        label: cityInput?.value || '',
        lat: parseFloat(latInput?.value) || 0,
        lon: parseFloat(lonInput?.value) || 0
      };
      
      // Save via legacy saveSettings (handles encryption)
      try {
        localStorage.setItem('myDashboardSettings.v1', JSON.stringify(newSettings));
        closeSettings();
        
        // Apply alignment immediately
        const container = document.querySelector('.container');
        if (container) {
          if (newSettings.leftAligned) {
            container.style.margin = '0 auto';
          } else {
            container.style.margin = '';
          }
        }
        
        // Soft reload: re-fetch positions without full page refresh (this will reload settings)
        await renderDemoSummary();
        rerenderPositions();
      } catch (e) {
        alert('Failed to save settings: ' + e.message);
      }
    });
  }
  
  // Watchlist Add functionality
  // Donate Window
  const donateBtn = document.getElementById('newDonateBtn');
  const donateBtnMobile = document.getElementById('newDonateBtnMobile');
  const donateWindow = document.getElementById('newDonateWindow');
  const donateBackdrop = document.getElementById('newDonateBackdrop');
  const closeDonateBtn = document.getElementById('newCloseDonateBtn');
  
  const openDonateWindow = () => {
    if (donateWindow) {
      if (donateBackdrop) donateBackdrop.style.display = 'block';
      donateWindow.style.display = 'flex';
    }
    // Close mobile menu if open
    const mobileMenu = document.getElementById('newMobileMenu');
    if (mobileMenu) {
      mobileMenu.classList.remove('active');
      document.body.classList.remove('mobile-menu-open');
    }
  };
  
  const closeDonateWindow = () => {
    if (donateWindow) {
      donateWindow.style.display = 'none';
      if (donateBackdrop) donateBackdrop.style.display = 'none';
    }
  };
  
  async function copyToClipboard(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      const originalText = button.textContent;
      button.textContent = '[COPIED!]';
      button.style.opacity = '0.6';
      setTimeout(() => {
        button.textContent = originalText;
        button.style.opacity = '1';
      }, 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
      alert('Failed to copy to clipboard');
    }
  }
  
  if (donateBtn) donateBtn.addEventListener('click', openDonateWindow);
  if (donateBtnMobile) donateBtnMobile.addEventListener('click', openDonateWindow);
  if (closeDonateBtn) closeDonateBtn.addEventListener('click', closeDonateWindow);
  if (donateBackdrop) donateBackdrop.addEventListener('click', closeDonateWindow);
  
  // Copy address buttons - event delegation
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('copy-address-btn')) {
      const address = e.target.getAttribute('data-address');
      if (address) {
        copyToClipboard(address, e.target);
      }
    }
  });
  
  // Watchlist
  const addToWatchlistBtn = document.getElementById('newAddToWatchlistBtn');
  const watchlistSearchWindow = document.getElementById('newWatchlistSearchWindow');
  const watchlistSearchBackdrop = document.getElementById('newWatchlistSearchBackdrop');
  const closeWatchlistSearchBtn = document.getElementById('newCloseWatchlistSearchBtn');
  const watchlistSearchInput = document.getElementById('newWatchlistSearchInput');
  const watchlistSearchResults = document.getElementById('newWatchlistSearchResults');
  
  let allPythFeeds = null;
  
  async function loadAllPythFeeds() {
    if (allPythFeeds) return allPythFeeds;
    try {
      const mods = window.AppModules || {};
      const providers = mods.data?.providers || {};
      const feeds = await providers.pyth.getPriceFeeds(15000);
      allPythFeeds = Object.entries(feeds).map(([symbol, id]) => ({ symbol, id }));
      return allPythFeeds;
    } catch (e) {
      console.error('Failed to load Pyth feeds:', e);
      return [];
    }
  }
  
  async function addToWatchlist(feedId) {
    const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
    if (!s.watchlist) s.watchlist = [];
    
    if (!s.watchlist.includes(feedId)) {
      s.watchlist.push(feedId);
      try {
        localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
        
        // Reload watchlist immediately
        const watchlistBody = document.getElementById('newWatchlistBody');
        if (watchlistBody) {
          watchlistBody.innerHTML = '<tr><td colspan="3" class="loading"><span class="loading-terminal">[LOADING...]</span></td></tr>';
          try {
            const mod = await import('./modules/features/watchlist.js');
            const pythProvider = window.AppModules?.data?.providers?.pyth;
            await mod.render(watchlistBody, {
              feedIds: s.watchlist,
              pythProvider,
              useColoredPnL: s.useColoredPnL ?? true
            });
          } catch (e) {
            watchlistBody.innerHTML = '<tr><td colspan="3" class="loading">Watchlist unavailable</td></tr>';
          }
        }
      } catch (e) {
        console.error('Failed to save watchlist:', e);
      }
    }
  }
  
  function closeWatchlistSearch() {
    if (watchlistSearchWindow) watchlistSearchWindow.style.display = 'none';
    if (watchlistSearchBackdrop) watchlistSearchBackdrop.style.display = 'none';
    if (watchlistSearchInput) watchlistSearchInput.value = '';
    if (watchlistSearchResults) watchlistSearchResults.innerHTML = '';
  }
  
  if (addToWatchlistBtn) {
    addToWatchlistBtn.addEventListener('click', async () => {
      // Load feeds
      const feeds = await loadAllPythFeeds();
      
      // Show modal
      if (watchlistSearchWindow) watchlistSearchWindow.style.display = 'block';
      if (watchlistSearchBackdrop) watchlistSearchBackdrop.style.display = 'block';
      
      // Focus input
      if (watchlistSearchInput) {
        setTimeout(() => watchlistSearchInput.focus(), 100);
      }
    });
  }
  
  if (closeWatchlistSearchBtn) {
    closeWatchlistSearchBtn.addEventListener('click', closeWatchlistSearch);
  }
  
  if (watchlistSearchBackdrop) {
    watchlistSearchBackdrop.addEventListener('click', closeWatchlistSearch);
  }
  
  if (watchlistSearchInput) {
    const addedFeeds = new Set();
    
    function performSearch(query) {
      if (!watchlistSearchResults) return;
      
      const feeds = allPythFeeds || [];
      const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
      const currentWatchlist = s.watchlist || [];
      
      if (!query) {
        watchlistSearchResults.innerHTML = '<div class="help" style="padding: 16px;">Type to search tokens...</div>';
        return;
      }
      
      const matches = feeds.filter(f => 
        f.symbol.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 50);
      
      if (matches.length === 0) {
        watchlistSearchResults.innerHTML = '<div class="help" style="padding: 16px;">No results found</div>';
        return;
      }
      
      watchlistSearchResults.innerHTML = '';
      matches.forEach(feed => {
        const resultDiv = document.createElement('div');
        resultDiv.className = 'watchlist-search-result';
        
        const isInWatchlist = currentWatchlist.includes(feed.id);
        const isAdded = addedFeeds.has(feed.id);
        
        if (isInWatchlist || isAdded) {
          resultDiv.classList.add('added');
        }
        
        resultDiv.innerHTML = `
          <span>${feed.symbol}</span>
          <button class="btn-text ${isInWatchlist || isAdded ? 'added' : ''}" data-feed-id="${feed.id}">
            ${isInWatchlist ? '[IN LIST]' : isAdded ? '[ADDED]' : '[ADD]'}
          </button>
        `;
        
        const btn = resultDiv.querySelector('button');
        if (!isInWatchlist) {
          btn.addEventListener('click', () => {
            if (!addedFeeds.has(feed.id)) {
              addToWatchlist(feed.id);
              addedFeeds.add(feed.id);
              btn.textContent = '[ADDED]';
              btn.classList.add('added');
              resultDiv.classList.add('added');
            }
          });
        }
        
        watchlistSearchResults.appendChild(resultDiv);
      });
    }
    
    watchlistSearchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      performSearch(query);
    });
  }
  
  // Watchlist Edit functionality
  const editWatchlistBtn = document.getElementById('newEditWatchlistBtn');
  
  function removeFromWatchlist(feedId) {
    const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
    if (!s.watchlist) s.watchlist = [];
    
    s.watchlist = s.watchlist.filter(id => id !== feedId);
    try {
      localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
      
      // Update cached data and re-render
      if (cachedWatchlistData) {
        cachedWatchlistData = cachedWatchlistData.filter(item => item.feedId !== feedId);
      }
      
      // Reload watchlist immediately
      const watchlistBody = document.getElementById('newWatchlistBody');
      if (watchlistBody) {
        watchlistBody.innerHTML = '<tr><td colspan="3" class="loading"><span class="loading-terminal">[LOADING...]</span></td></tr>';
        (async () => {
          try {
            const mod = await import('./modules/features/watchlist.js');
            const pythProvider = window.AppModules?.data?.providers?.pyth;
            const prices = await mod.render(watchlistBody, {
              feedIds: s.watchlist,
              pythProvider,
              useColoredPnL: s.useColoredPnL ?? true,
              editMode: watchlistEditMode
            });
            
            // Update cache with new data
            cachedWatchlistData = prices;
            
            // Re-attach event listeners for edit buttons
            if (watchlistEditMode) {
              attachWatchlistEditListeners();
            }
          } catch (e) {
            watchlistBody.innerHTML = '<tr><td colspan="3" class="loading">Watchlist unavailable</td></tr>';
          }
        })();
      }
    } catch (e) {
      console.error('Failed to remove from watchlist:', e);
    }
  }
  
  function attachWatchlistEditListeners() {
    const watchlistBody = document.getElementById('newWatchlistBody');
    if (watchlistBody) {
      // Remove old listeners by cloning
      const newWatchlistBody = watchlistBody.cloneNode(true);
      watchlistBody.parentNode.replaceChild(newWatchlistBody, watchlistBody);
      
      // Add new listener
      newWatchlistBody.addEventListener('click', (e) => {
        if (e.target.classList.contains('watchlist-edit-btn')) {
          const feedId = e.target.getAttribute('data-feed-id');
          removeFromWatchlist(feedId);
        }
      });
    }
  }
  
  async function toggleWatchlistEditMode() {
    watchlistEditMode = !watchlistEditMode;
    if (editWatchlistBtn) {
      editWatchlistBtn.textContent = watchlistEditMode ? '[SAVE]' : '[EDIT]';
    }
    
    // Re-render watchlist with edit mode (using cached data if available)
    const watchlistBody = document.getElementById('newWatchlistBody');
    if (watchlistBody && cachedWatchlistData) {
      // Use cached data for instant toggle
      try {
        const mod = await import('./modules/features/watchlist.js');
        const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
        await mod.render(watchlistBody, {
          feedIds: s.watchlist || [],
          pythProvider: window.AppModules?.data?.providers?.pyth,
          useColoredPnL: s.useColoredPnL ?? true,
          editMode: watchlistEditMode,
          cachedData: cachedWatchlistData // Pass cached data to avoid refetch
        });
        
        // Attach edit button listeners
        if (watchlistEditMode) {
          attachWatchlistEditListeners();
        }
      } catch (e) {
        console.error('Failed to toggle watchlist edit mode:', e);
      }
    }
  }
  
  if (editWatchlistBtn) {
    editWatchlistBtn.addEventListener('click', toggleWatchlistEditMode);
  }
  
  // Add Position functionality
  const addPositionBtn = document.getElementById('newAddPositionBtn');
  const addPositionModal = document.getElementById('newAddPositionModal');
  const addPositionBackdrop = document.getElementById('newAddPositionBackdrop');
  const closeAddPositionBtn = document.getElementById('newCloseAddPositionBtn');
  const addPositionTypePyth = document.getElementById('newAddPositionTypePyth');
  const addPositionTypeCustom = document.getElementById('newAddPositionTypeCustom');
  const addPositionPythSection = document.getElementById('newAddPositionPythSection');
  const addPositionCustomSection = document.getElementById('newAddPositionCustomSection');
  const addPositionPythSearch = document.getElementById('newAddPositionPythSearch');
  const addPositionPythResults = document.getElementById('newAddPositionPythResults');
  const addPositionPythAmount = document.getElementById('newAddPositionPythAmount');
  const addPositionPythEntryPrice = document.getElementById('newAddPositionPythEntryPrice');
  const addPositionCustomName = document.getElementById('newAddPositionCustomName');
  const addPositionCustomValue = document.getElementById('newAddPositionCustomValue');
  const savePositionBtn = document.getElementById('newSavePositionBtn');
  
  let selectedPositionType = 'pyth';
  let selectedPythFeed = null;
  
  function closeAddPosition() {
    if (addPositionModal) addPositionModal.style.display = 'none';
    if (addPositionBackdrop) addPositionBackdrop.style.display = 'none';
  }
  
  if (addPositionBtn) {
    addPositionBtn.addEventListener('click', async () => {
      // Load feeds
      await loadAllPythFeeds();
      
      // Show modal
      if (addPositionModal) addPositionModal.style.display = 'block';
      if (addPositionBackdrop) addPositionBackdrop.style.display = 'block';
      
      // Reset state
      selectedPositionType = 'pyth';
      selectedPythFeed = null;
      if (addPositionPythSearch) addPositionPythSearch.value = '';
      if (addPositionPythAmount) addPositionPythAmount.value = '';
      if (addPositionPythEntryPrice) addPositionPythEntryPrice.value = '';
      if (addPositionCustomName) addPositionCustomName.value = '';
      if (addPositionCustomValue) addPositionCustomValue.value = '';
      if (addPositionPythResults) addPositionPythResults.innerHTML = '';
      
      // Set initial view
      if (addPositionPythSection) addPositionPythSection.style.display = 'block';
      if (addPositionCustomSection) addPositionCustomSection.style.display = 'none';
      if (addPositionTypePyth) {
        addPositionTypePyth.style.background = 'var(--accent)';
        addPositionTypePyth.style.color = 'var(--bg)';
      }
      if (addPositionTypeCustom) {
        addPositionTypeCustom.style.background = '';
        addPositionTypeCustom.style.color = '';
      }
    });
  }
  
  if (closeAddPositionBtn) {
    closeAddPositionBtn.addEventListener('click', closeAddPosition);
  }
  
  if (addPositionBackdrop) {
    addPositionBackdrop.addEventListener('click', closeAddPosition);
  }
  
  if (addPositionTypePyth) {
    addPositionTypePyth.addEventListener('click', () => {
      selectedPositionType = 'pyth';
      if (addPositionPythSection) addPositionPythSection.style.display = 'block';
      if (addPositionCustomSection) addPositionCustomSection.style.display = 'none';
      addPositionTypePyth.style.background = 'var(--accent)';
      addPositionTypePyth.style.color = 'var(--bg)';
      if (addPositionTypeCustom) {
        addPositionTypeCustom.style.background = '';
        addPositionTypeCustom.style.color = '';
      }
    });
  }
  
  if (addPositionTypeCustom) {
    addPositionTypeCustom.addEventListener('click', () => {
      selectedPositionType = 'custom';
      if (addPositionPythSection) addPositionPythSection.style.display = 'none';
      if (addPositionCustomSection) addPositionCustomSection.style.display = 'block';
      addPositionTypeCustom.style.background = 'var(--accent)';
      addPositionTypeCustom.style.color = 'var(--bg)';
      if (addPositionTypePyth) {
        addPositionTypePyth.style.background = '';
        addPositionTypePyth.style.color = '';
      }
    });
  }
  
  if (addPositionPythSearch) {
    addPositionPythSearch.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      if (!query || !addPositionPythResults) {
        if (addPositionPythResults) addPositionPythResults.innerHTML = '';
        return;
      }
      
      const feeds = allPythFeeds || [];
      const matches = feeds.filter(f => 
        f.symbol.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 20);
      
      addPositionPythResults.innerHTML = '';
      matches.forEach(feed => {
        const resultDiv = document.createElement('div');
        resultDiv.className = 'watchlist-search-result';
        resultDiv.innerHTML = `<span>${feed.symbol}</span>`;
        resultDiv.style.cursor = 'pointer';
        resultDiv.addEventListener('click', () => {
          selectedPythFeed = feed;
          addPositionPythSearch.value = feed.symbol;
          addPositionPythResults.innerHTML = '';
        });
        addPositionPythResults.appendChild(resultDiv);
      });
    });
  }
  
  if (savePositionBtn) {
    savePositionBtn.addEventListener('click', async () => {
      const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
      
      // Ensure cryptoPositions array exists
      if (!s.cryptoPositions) {
        s.cryptoPositions = [];
      }
      
      if (selectedPositionType === 'pyth') {
        // Validate Pyth position
        if (!selectedPythFeed) {
          alert('Please select a token from the search results');
          return;
        }
        
        const amount = parseFloat(addPositionPythAmount.value);
        const entryPrice = parseFloat(addPositionPythEntryPrice.value);
        
        if (!amount || amount <= 0) {
          alert('Please enter a valid amount');
          return;
        }
        
        if (!entryPrice || entryPrice <= 0) {
          alert('Please enter a valid entry price');
          return;
        }
        
        // Add Pyth position
        s.cryptoPositions.push({
          type: 'pyth',
          symbol: selectedPythFeed.symbol,
          feedId: selectedPythFeed.id,
          amount: amount,
          entryPrice: entryPrice
        });
      } else {
        // Validate custom position
        const name = addPositionCustomName.value.trim();
        const value = parseFloat(addPositionCustomValue.value);
        
        if (!name) {
          alert('Please enter an asset name');
          return;
        }
        
        if (!value || value <= 0) {
          alert('Please enter a valid value');
          return;
        }
        
        // Add custom position
        s.cryptoPositions.push({
          type: 'custom',
          name: name,
          value: value
        });
      }
      
      try {
        localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
        closeAddPosition();
        
        // Soft reload: re-fetch positions without full page refresh
        await renderDemoSummary();
        rerenderPositions();
      } catch (e) {
        alert('Failed to save position: ' + e.message);
      }
    });
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  // Force service worker update if outdated
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      for (const registration of registrations) {
        registration.update();
      }
    });
  }
  
  // Init loading screen
  initLoadingScreen();
  
  // Init theme
  const Themes = window.AppModules?.core?.themes;
  const Settings = window.AppModules?.core?.settings;
  const settings = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
  
  // Apply alignment
  const applyAlignment = () => {
    const container = document.querySelector('.container');
    if (container) {
      if (settings.leftAligned) {
        container.style.margin = '0 auto';
      } else {
        container.style.margin = '';
      }
    }
  };
  applyAlignment();
  
  if (Themes) {
    const theme = settings.theme || Themes.getPreferredTheme();
    Themes.applyTheme(theme);
    const themeSelect = document.getElementById('newThemeSelect');
    const themeSelectMobile = document.getElementById('newThemeSelectMobile');
    
    if (themeSelect) {
      themeSelect.value = theme;
      themeSelect.addEventListener('change', (e) => {
        const newTheme = e.target.value;
        Themes.applyTheme(newTheme);
        
        // Save to localStorage
        const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
        s.theme = newTheme;
        localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
        
        // Sync mobile dropdown
        if (themeSelectMobile) themeSelectMobile.value = newTheme;
      });
    }
    
    if (themeSelectMobile) {
      themeSelectMobile.value = theme;
      themeSelectMobile.addEventListener('change', (e) => {
        const newTheme = e.target.value;
        Themes.applyTheme(newTheme);
        
        // Save to localStorage
        const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
        s.theme = newTheme;
        localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
        
        // Sync desktop dropdown
        if (themeSelect) themeSelect.value = newTheme;
      });
    }
  }
  
  // Init font size
  let fontSize = settings?.fontSize;
  if (typeof fontSize === 'string' || !fontSize) {
    fontSize = 15; // Default if it's a string or not set
  }
  applyFontSize(fontSize);
  
  // Apply button visibility settings
  const applyButtonVisibility = () => {
    // Desktop buttons
    const toggleSnowBtn = document.getElementById('newToggleSnowBtn');
    const toggleRainBtn = document.getElementById('newToggleRainBtn');
    const fontSizeControlsWrapper = document.querySelector('.header-actions .font-size-controls');
    const themeSelectWrapper = document.querySelector('.header-actions .theme-select-wrapper');
    const toggleAmountsBtn = document.getElementById('newToggleAmountsBtn');
    const refreshBtn = document.getElementById('newRefreshBtn');
    const donateBtn = document.getElementById('newDonateBtn');
    const settingsBtn = document.getElementById('newSettingsBtn');
    
    // Mobile buttons
    const toggleSnowBtnMobile = document.getElementById('newToggleSnowBtnMobile');
    const toggleRainBtnMobile = document.getElementById('newToggleRainBtnMobile');
    const fontSizeControlsWrapperMobile = document.querySelector('.mobile-menu-content .font-size-controls');
    const themeSelectWrapperMobile = document.querySelector('.mobile-menu-content .theme-select-wrapper');
    const toggleAmountsBtnMobile = document.getElementById('newToggleAmountsBtnMobile');
    const refreshBtnMobile = document.getElementById('newRefreshBtnMobile');
    const donateBtnMobile = document.getElementById('newDonateBtnMobile');
    const settingsBtnMobile = document.getElementById('newSettingsBtnMobile');
    
    // Apply visibility
    if (toggleSnowBtn) toggleSnowBtn.style.display = (settings.showSnowBtn ?? true) ? '' : 'none';
    if (toggleSnowBtnMobile) toggleSnowBtnMobile.style.display = (settings.showSnowBtn ?? true) ? '' : 'none';
    
    if (toggleRainBtn) toggleRainBtn.style.display = (settings.showRainBtn ?? true) ? '' : 'none';
    if (toggleRainBtnMobile) toggleRainBtnMobile.style.display = (settings.showRainBtn ?? true) ? '' : 'none';
    
    // Font size controls (hide entire wrapper)
    if (fontSizeControlsWrapper) fontSizeControlsWrapper.style.display = (settings.showFontSize ?? true) ? '' : 'none';
    if (fontSizeControlsWrapperMobile) fontSizeControlsWrapperMobile.style.display = (settings.showFontSize ?? true) ? '' : 'none';
    
    if (themeSelectWrapper) themeSelectWrapper.style.display = (settings.showThemeBtn ?? true) ? '' : 'none';
    if (themeSelectWrapperMobile) themeSelectWrapperMobile.style.display = (settings.showThemeBtn ?? true) ? '' : 'none';
    
    if (toggleAmountsBtn) toggleAmountsBtn.style.display = (settings.showAmountsBtn ?? true) ? '' : 'none';
    if (toggleAmountsBtnMobile) toggleAmountsBtnMobile.style.display = (settings.showAmountsBtn ?? true) ? '' : 'none';
    
    if (refreshBtn) refreshBtn.style.display = (settings.showRefreshBtn ?? true) ? '' : 'none';
    if (refreshBtnMobile) refreshBtnMobile.style.display = (settings.showRefreshBtn ?? true) ? '' : 'none';
    
    if (donateBtn) donateBtn.style.display = (settings.showDonateBtn ?? true) ? '' : 'none';
    if (donateBtnMobile) donateBtnMobile.style.display = (settings.showDonateBtn ?? true) ? '' : 'none';
    
    if (settingsBtn) settingsBtn.style.display = (settings.showSettingsBtn ?? true) ? '' : 'none';
    if (settingsBtnMobile) settingsBtnMobile.style.display = (settings.showSettingsBtn ?? true) ? '' : 'none';
  };
  applyButtonVisibility();
  
  // Init rain/snow from saved preferences (only one can be active)
  const Rain = window.AppModules?.features?.rain;
  if (Rain) {
    const toggleRainBtn = document.getElementById('newToggleRainBtn');
    const toggleSnowBtn = document.getElementById('newToggleSnowBtn');
    const toggleRainBtnMobile = document.getElementById('newToggleRainBtnMobile');
    const toggleSnowBtnMobile = document.getElementById('newToggleSnowBtnMobile');
    
    // Only enable one - prioritize rain if both are somehow enabled
    if (settings.rainEnabled && !settings.snowEnabled) {
      Rain.toggleRain();
      if (toggleRainBtn) toggleRainBtn.textContent = '[RAIN OFF]';
      if (toggleRainBtnMobile) toggleRainBtnMobile.textContent = '[RAIN OFF]';
    } else if (settings.snowEnabled && !settings.rainEnabled) {
      Rain.toggleSnow();
      if (toggleSnowBtn) toggleSnowBtn.textContent = '[SNOW OFF]';
      if (toggleSnowBtnMobile) toggleSnowBtnMobile.textContent = '[SNOW OFF]';
    }
  }
  
  // Apply initial compact mode styling
  if (compactMode) {
    document.body.classList.add('compact-mode');
    const tables = document.querySelectorAll('.data-table');
    tables.forEach(table => table.classList.add('compact-mode'));
  }
  
  // Update greeting
  function updateGreeting() {
    const greetingEl = document.getElementById('newGreeting');
    if (greetingEl) {
      const hour = new Date().getHours();
      let timeOfDay = 'Good morning';
      if (hour >= 12 && hour < 18) timeOfDay = 'Good afternoon';
      else if (hour >= 18) timeOfDay = 'Good evening';
      
      const userName = settings.userName || 'there';
      greetingEl.textContent = `${timeOfDay}, ${userName}.`;
    }
  }
  updateGreeting();
  
  // Hero click to refresh with ASCII spinner
  const heroSection = document.querySelector('.hero');
  const greetingEl = document.getElementById('newGreeting');
  
  if (heroSection && greetingEl) {
    heroSection.style.cursor = 'pointer';
    heroSection.style.userSelect = 'none';
    
    let spinnerInterval = null;
    let spinnerEl = null;
    
    const startSpinner = () => {
      // ASCII spinner frames: ◐ ◓ ◑ ◒ or ⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏
      const frames = ['◐', '◓', '◑', '◒'];
      let frameIndex = 0;
      
      // Create spinner element
      spinnerEl = document.createElement('span');
      spinnerEl.style.marginLeft = '8px';
      spinnerEl.style.opacity = '0.6';
      spinnerEl.textContent = frames[0];
      greetingEl.appendChild(spinnerEl);
      
      // Animate spinner
      spinnerInterval = setInterval(() => {
        frameIndex = (frameIndex + 1) % frames.length;
        if (spinnerEl) {
          spinnerEl.textContent = frames[frameIndex];
        }
      }, 150);
    };
    
    const stopSpinner = () => {
      if (spinnerInterval) {
        clearInterval(spinnerInterval);
        spinnerInterval = null;
      }
      if (spinnerEl) {
        spinnerEl.remove();
        spinnerEl = null;
      }
    };
    
    heroSection.addEventListener('click', async () => {
      if (spinnerInterval) return; // Already refreshing
      
      try {
        startSpinner();
        await renderDemoSummary();
        rerenderPositions();
        
        // Also refresh watchlist if present
        const watchlistModule = await import('./modules/features/watchlist.js').catch(() => null);
        if (watchlistModule && watchlistModule.refreshWatchlist) {
          await watchlistModule.refreshWatchlist().catch(() => {});
        }
      } catch (error) {
        console.error('[Hero] Refresh failed:', error);
      } finally {
        stopSpinner();
      }
    });
  }
  
  // Setup header controls (non-blocking)
  setupControls();
  
  // CRITICAL PATH: Positions + Hero only (everything else lazy)
  try {
    await renderDemoSummary();
  } catch (error) {
    console.error('[/portfolio] renderDemoSummary failed:', error);
    // Show error in hero
    const summaryEl = document.getElementById('newSummary');
    if (summaryEl) {
      summaryEl.innerHTML = `<span style="color: var(--red);">Error loading portfolio: ${error.message || error}</span>`;
    }
  }
  
  // Hide loading screen after critical data loads (even if there was an error)
  hideLoadingScreen();
  
  // NON-CRITICAL: Health checks in background
  runHealthChecks().catch(() => {});
  
  // NON-CRITICAL: Rain/Snow effects (lazy loaded after everything else)
  setTimeout(async () => {
    const Rain = window.AppModules?.features?.rain;
    if (!Rain) return;
    
    // Check weather and auto-enable
    const weather = await Rain.checkWeatherAndAutoEnable();
    if (weather) {
      if (weather.isSnowing) {
        Rain.toggleSnow();
        const btn = document.getElementById('newToggleSnowBtn');
        const mobileBtn = document.getElementById('newToggleSnowBtnMobile');
        if (btn) btn.textContent = '[SNOW OFF]';
        if (mobileBtn) mobileBtn.textContent = '[SNOW OFF]';
      } else if (weather.isRaining) {
        Rain.toggleRain();
        const btn = document.getElementById('newToggleRainBtn');
        const mobileBtn = document.getElementById('newToggleRainBtnMobile');
        if (btn) btn.textContent = '[RAIN OFF]';
        if (mobileBtn) mobileBtn.textContent = '[RAIN OFF]';
      }
    }
  }, 2000); // Wait 2 seconds after page load
  
  // Lazy-load comic on intersection or idle (if enabled in settings)
  const comicSection = document.getElementById('comicSection');
  const comicEl = document.getElementById('newComic');
  if (settings.showComic === false && comicSection) {
    comicSection.style.display = 'none';
  } else if (comicEl) {
    let currentComicStrip = settings.comicStrip || 'calvinandhobbes';
    
    const getComicMetadata = () => {
      return {
        calvinandhobbes: {
          startDate: new Date('1985-11-18'),
          endDate: new Date('1995-12-31')
        },
        peanuts: {
          startDate: new Date('1950-10-02'),
          endDate: new Date('2000-02-13')
        },
        farside: {
          startDate: new Date('1980-01-01'),
          endDate: new Date('1994-12-31')
        }
      };
    };
    
    // Get a deterministic random date for the comic based on today's date
    // This ensures the same comic shows all day, but changes daily
    const getValidComicDate = (comicKey) => {
      const metadata = getComicMetadata();
      const comic = metadata[comicKey];
      if (!comic) return new Date();
      
      // Create a seed based on the current date (YYYY-MM-DD format) AND the comic key
      // This ensures each comic gets a different strip on the same day
      const today = new Date();
      const dateString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}-${comicKey}`;
      
      // Simple hash function to create a deterministic seed from the date string
      let hash = 0;
      for (let i = 0; i < dateString.length; i++) {
        const char = dateString.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      
      // Make the hash positive and normalize to 0-1
      const seed = Math.abs(hash) / 2147483647;
      
      // Calculate random date within the comic's range using the seed
      const start = comic.startDate.getTime();
      const end = comic.endDate.getTime();
      const randomTime = start + seed * (end - start);
      
      return new Date(randomTime);
    };
    
    let currentComicDate = getValidComicDate(currentComicStrip);
    
    const loadComic = async (comicKey = currentComicStrip, date = currentComicDate) => {
      try {
        const mod = await import('./modules/features/comics.js');
        await mod.renderComic(comicEl, comicKey, date);
        currentComicDate = date;
        
        // Update button states
        updateComicButtons(comicKey, date);
      } catch (e) {
        console.error(`[Comics] Failed to load ${comicKey}:`, e);
        comicEl.textContent = 'Comic failed to load';
      }
    };
    
    const updateComicButtons = (comicKey, date) => {
      const metadata = getComicMetadata();
      const comic = metadata[comicKey];
      if (!comic) return;
      
      const prevButtons = [
        document.getElementById('newComicPrevBtn'),
        document.getElementById('newComicPrevBtnMobile')
      ];
      const nextButtons = [
        document.getElementById('newComicNextBtn'),
        document.getElementById('newComicNextBtnMobile')
      ];
      const randomButtons = [
        document.getElementById('newComicRandomBtn'),
        document.getElementById('newComicRandomBtnMobile')
      ];
      
      // Hide all buttons for Far Side (doesn't work due to caching)
      if (comicKey === 'farside') {
        [...prevButtons, ...nextButtons, ...randomButtons].forEach(btn => {
          if (btn) btn.style.display = 'none';
        });
        return;
      }
      
      // Show buttons for other comics
      [...prevButtons, ...nextButtons, ...randomButtons].forEach(btn => {
        if (btn) btn.style.display = '';
      });
      
      // Disable prev if at start date
      const atStart = date <= comic.startDate;
      prevButtons.forEach(btn => {
        if (btn) btn.disabled = atStart;
      });
      
      // Disable next if at end date
      const atEnd = date >= comic.endDate;
      nextButtons.forEach(btn => {
        if (btn) btn.disabled = atEnd;
      });
    };
    
    // Setup prev/next/random buttons
    const prevButtons = [
      document.getElementById('newComicPrevBtn'),
      document.getElementById('newComicPrevBtnMobile')
    ];
    const nextButtons = [
      document.getElementById('newComicNextBtn'),
      document.getElementById('newComicNextBtnMobile')
    ];
    const randomButtons = [
      document.getElementById('newComicRandomBtn'),
      document.getElementById('newComicRandomBtnMobile')
    ];
    
    prevButtons.forEach(btn => {
      if (btn) {
        btn.addEventListener('click', async () => {
          const newDate = new Date(currentComicDate);
          newDate.setDate(newDate.getDate() - 1);
          await loadComic(currentComicStrip, newDate);
        });
      }
    });
    
    nextButtons.forEach(btn => {
      if (btn) {
        btn.addEventListener('click', async () => {
          const newDate = new Date(currentComicDate);
          newDate.setDate(newDate.getDate() + 1);
          await loadComic(currentComicStrip, newDate);
        });
      }
    });
    
    randomButtons.forEach(btn => {
      if (btn) {
        btn.addEventListener('click', async () => {
          const metadata = getComicMetadata();
          const comic = metadata[currentComicStrip];
          if (!comic) return;
          
          const start = comic.startDate.getTime();
          const end = comic.endDate.getTime();
          const randomTime = start + Math.random() * (end - start);
          const randomDate = new Date(randomTime);
          
          await loadComic(currentComicStrip, randomDate);
        });
      }
    });
    
    // Setup tab switching
    const tabCalvin = document.getElementById('newTabCalvin');
    const tabPeanuts = document.getElementById('newTabPeanuts');
    const tabFarside = document.getElementById('newTabFarside');
    const tabs = [tabCalvin, tabPeanuts, tabFarside];
    
    tabs.forEach(tab => {
      if (tab) {
        tab.addEventListener('click', async () => {
          const comicKey = tab.getAttribute('data-comic');
          if (comicKey === currentComicStrip) return; // Already showing this comic
          
          currentComicStrip = comicKey;
          currentComicDate = getValidComicDate(comicKey); // Get a valid date for the new comic
          
          // Update active tab
          tabs.forEach(t => t?.classList.remove('active'));
          tab.classList.add('active');
          
          // Load new comic
          await loadComic(comicKey, currentComicDate);
          
          // Save preference
          const Settings = window.AppModules?.core?.settings;
          const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
          s.comicStrip = comicKey;
          localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
        });
      }
    });
    
    // Set initial active tab based on saved preference
    const savedComic = settings.comicStrip || 'calvinandhobbes';
    tabs.forEach(tab => {
      if (tab && tab.getAttribute('data-comic') === savedComic) {
        tab.classList.add('active');
      } else {
        tab?.classList.remove('active');
      }
    });
    
    // Hide buttons initially if Far Side is saved as preference
    if (savedComic === 'farside') {
      const allButtons = [
        ...prevButtons,
        ...nextButtons,
        ...randomButtons
      ];
      allButtons.forEach(btn => {
        if (btn) btn.style.display = 'none';
      });
    }
    
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            io.disconnect();
            loadComic();
            break;
          }
        }
      }, { rootMargin: '400px' });
      io.observe(comicEl);
      if ('requestIdleCallback' in window) {
        requestIdleCallback(loadComic, { timeout: 10000 });
      } else {
        setTimeout(loadComic, 10000);
      }
    } else {
      loadComic();
    }
  }
  
  // Lazy-load watchlist on intersection or idle (if enabled in settings)
  const watchlistSection = document.getElementById('watchlistSection');
  const watchlistBody = document.getElementById('newWatchlistBody');
  if (settings.showWatchlist === false && watchlistSection) {
    watchlistSection.style.display = 'none';
  } else if (watchlistBody) {
    const loadWatchlist = async () => {
      try {
        const mod = await import('./modules/features/watchlist.js');
        const pythProvider = window.AppModules?.data?.providers?.pyth;
        const watchlistIds = settings.watchlist || [];
        const prices = await mod.render(watchlistBody, {
          feedIds: watchlistIds,
          pythProvider,
          useColoredPnL: settings.useColoredPnL ?? true
        });
        // Cache the data for instant edit toggle
        cachedWatchlistData = prices;
      } catch (e) {
        watchlistBody.innerHTML = '<tr><td colspan="3" class="loading">Watchlist unavailable</td></tr>';
      }
    };
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            io.disconnect();
            loadWatchlist();
            break;
          }
        }
      }, { rootMargin: '300px' });
      io.observe(watchlistBody);
      if ('requestIdleCallback' in window) {
        requestIdleCallback(loadWatchlist, { timeout: 7000 });
      } else {
        setTimeout(loadWatchlist, 7000);
      }
    } else {
      loadWatchlist();
    }
  }
  
  // Periodic price updates (every 5 seconds)
  let updateInterval = null;
  
  async function updatePrices() {
    try {
      const providers = window.AppModules?.data?.providers;
      if (!providers) return;
      
      // Update positions if they exist
      if (cachedPositions && cachedPositions.length > 0) {
        // Get current prices from Hyperliquid (perps + spot)
        const [marketData, allMids, spotMeta] = await Promise.all([
          providers.hyperliquid.fetchMetaAndAssetCtxs(8000),
          providers.hyperliquid.fetchAllMids(8000),
          providers.hyperliquid.fetchSpotMeta(8000)
        ]);
        
        const priceMap = {};
        
        // Get perp prices
        if (marketData && marketData[0] && marketData[1]) {
          for (let i = 0; i < marketData[1].length; i++) {
            const ctx = marketData[1][i];
            const assetName = marketData[0].universe[i]?.name;
            if (assetName && ctx?.markPx) {
              priceMap[assetName] = parseFloat(ctx.markPx);
            }
          }
        }
        
        // Get spot prices using proper @index mapping
        if (allMids && spotMeta && spotMeta.universe) {
          for (const spotPair of spotMeta.universe) {
            if (spotPair.tokens && spotPair.tokens[1] === 0) { // USDC quote
              const spotKey = `@${spotPair.index}`;
              const tokenName = spotPair.name;
              if (allMids[spotKey]) {
                priceMap[tokenName] = parseFloat(allMids[spotKey]);
              }
            }
          }
          // Also check tokens array
          if (spotMeta.tokens) {
            for (const token of spotMeta.tokens) {
              if (token.name && token.index !== undefined) {
                const spotPair = spotMeta.universe.find(pair => 
                  pair.tokens && pair.tokens[0] === token.index && pair.tokens[1] === 0
                );
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
        
        // Update positions with new prices
        let hasChanges = false;
        const updatedPositions = cachedPositions.map(pos => {
          const newPrice = priceMap[pos.asset];
          if (newPrice && newPrice !== pos.price && Math.abs(newPrice - pos.price) > 0.0001) {
            hasChanges = true;
            const newValue = Math.abs(pos.amount) * newPrice;
            let newPnl = pos.pnl;
            
            // Recalculate PnL if we have entry data
            if (pos.entryNtl && pos.entryNtl > 0) {
              newPnl = newValue - pos.entryNtl;
            } else if (pos.entryPrice && pos.entryPrice > 0) {
              const costBasis = Math.abs(pos.amount) * pos.entryPrice;
              newPnl = pos.amount >= 0 ? (newValue - costBasis) : (costBasis - newValue);
            }
            
            return {
              ...pos,
              price: newPrice,
              value: newValue,
              pnl: newPnl,
              priceChanged: true // Flag for flash animation
            };
          }
          return { ...pos, priceChanged: false };
        });
        
        if (hasChanges) {
          cachedPositions = updatedPositions;
          
          // Re-render positions
          rerenderPositions();
          
          // Update hero
          // For leveraged positions: use margin + PnL (actual equity)
          const totalValue = cachedPositions.reduce((sum, p) => {
            if (p.isLeveraged && p.marginUsed !== undefined) {
              return sum + p.marginUsed + (p.pnl || 0);
            }
            return sum + (p.value || 0);
          }, 0);
          const totalPnL = cachedPositions.reduce((sum, p) => sum + (p.pnl || 0), 0);
          const costBasis = totalValue - totalPnL;
          const totalPnLPercent = (costBasis > 0) ? (totalPnL / costBasis) * 100 : 0;
          cachedSummaryData = { totalValue, totalPnL, totalPnLPercent };
          
          const summaryEl = document.getElementById('newSummary');
          const HeroUI = window.AppModules?.ui?.hero;
          const Settings = window.AppModules?.core?.settings;
          const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
          
          if (summaryEl && HeroUI) {
            const heroHtml = HeroUI.composeSummary({
              portfolioValue: totalValue,
              amountsVisible,
              heroPnLMode: 'total',
              totalPnL,
              totalPnLPercent,
              totalDailyChange: 0,
              totalDailyChangePercent: 0,
              useColoredPnL: s.useColoredPnL ?? true,
              highlightsHtml: [],
              weather: null // Keep existing weather
            });
            summaryEl.innerHTML = heroHtml;
          }
          
          // Flash updated cells with background color animation
          setTimeout(() => {
            const cells = document.querySelectorAll('td[data-flash="true"]');
            cells.forEach(cell => {
              cell.classList.add('cell-flash');
              // Remove the class after animation completes
              cell.addEventListener('animationend', () => {
                cell.classList.remove('cell-flash');
                cell.removeAttribute('data-flash');
              }, { once: true });
            });
          }, 50);
        }
      }
      
      // Update watchlist prices
      const Settings = window.AppModules?.core?.settings;
      const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
      const watchlistBody = document.getElementById('newWatchlistBody');
      
      if (watchlistBody && s.watchlist && s.watchlist.length > 0 && !watchlistEditMode) {
        try {
          const mod = await import('./modules/features/watchlist.js');
          const prices = await mod.render(watchlistBody, {
            feedIds: s.watchlist,
            pythProvider: providers.pyth,
            useColoredPnL: s.useColoredPnL ?? true,
            editMode: false,
            previousData: cachedWatchlistData
          });
          cachedWatchlistData = prices;
        } catch (e) {
          // Silently fail watchlist updates to avoid disrupting position updates
        }
      }
    } catch (e) {
      console.warn('Price update failed:', e);
    }
  }
  
  // Start updates after 5 seconds, then every 5 seconds
  setTimeout(() => {
    updatePrices();
    updateInterval = setInterval(updatePrices, 5000);
  }, 5000);
});


