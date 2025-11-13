// Minimal alpha boot for the new modular dashboard

// ============================================================================
// PERFORMANCE: Cache frequently accessed elements and data
// ============================================================================
const DOMCache = {
  _elements: new Map(),
  
  get(id) {
    if (!this._elements.has(id)) {
      const el = document.getElementById(id);
      if (el) this._elements.set(id, el);
    }
    return this._elements.get(id) || null;
  },
  
  clear() {
    this._elements.clear();
  }
};

// Memoize settings to avoid repeated localStorage reads
let cachedSettings = null;
let settingsTimestamp = 0;
const SETTINGS_CACHE_TTL = 5000; // 5 seconds

function getSettings() {
  const now = Date.now();
  if (!cachedSettings || (now - settingsTimestamp) > SETTINGS_CACHE_TTL) {
    const Settings = window.AppModules?.core?.settings;
    cachedSettings = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
    settingsTimestamp = now;
  }
  return cachedSettings;
}

function invalidateSettingsCache() {
  cachedSettings = null;
  settingsTimestamp = 0;
}

// ============================================================================
// UTILITIES: Reusable functions to eliminate code duplication
// ============================================================================

// Filter positions based on hidden assets and balance threshold
function filterPositions(positions, options = {}) {
  const { 
    hideHidden = true,
    hideSmall = false, 
    threshold = 100 
  } = options;
  
  return positions.filter(p => {
    // Always hide the synthetic account equity positions (HL and Lighter)
    if (p.isHlAccountEquity || p.isLighterAccountEquity) return false;
    
    // Check hidden assets
    if (hideHidden) {
      const key = `${p.asset}_${p.exchange}`;
      if (hiddenAssets.has(key)) return false;
    }
    
    // Check balance threshold
    if (hideSmall) {
      const value = p.value || (Math.abs(p.amount || 0) * (p.price || 0));
      if (value < threshold) return false;
    }
    
    return true;
  });
}

// Calculate portfolio totals (value and PnL)
// SUPER SIMPLE: Just sum the dollar values from each source
// - Hyperliquid total equity (perps + spot)
// - Lighter total equity
// - Onchain wallet balances
function calculatePortfolioTotals(positions) {
  let totalValue = 0;
  let totalPnL = 0;
  const breakdown = []; // For debugging
  
  // Check for account equity positions (Hyperliquid and Lighter)
  const hlEquity = positions.find(p => p.isHlAccountEquity);
  const lighterEquity = positions.find(p => p.isLighterAccountEquity);
  
  let hlValue = 0;
  let lighterValue = 0;
  let walletValue = 0;
  
  // Add Hyperliquid total equity
  if (hlEquity) {
    hlValue = (hlEquity.value || 0);
    totalValue += hlValue;
    totalPnL += (hlEquity.pnl || 0);
    breakdown.push(`Hyperliquid Equity: $${hlEquity.value?.toFixed(2)}`);
  }
  
  // Add Lighter total equity
  if (lighterEquity) {
    lighterValue = (lighterEquity.value || 0);
    totalValue += lighterValue;
    totalPnL += (lighterEquity.pnl || 0);
    breakdown.push(`Lighter Equity: $${lighterEquity.value?.toFixed(2)}`);
  }
  
  // Add all wallet balances (skip synthetic equity positions and individual HL/Lighter positions)
  let walletCount = 0;
  for (const p of positions) {
    // Skip the synthetic equity positions
    if (p.isHlAccountEquity || p.isLighterAccountEquity) continue;
    
    // Skip individual Hyperliquid/Lighter positions (already counted in equity)
    if (p.exchange === 'Hyperliquid' || p.exchange === 'Hyperliquid Spot' || p.exchange === 'Lighter') continue;
    
    // Add wallet balance
    const value = p.value || 0;
    if (value > 0) {
      walletValue += value;
      totalValue += value;
      walletCount++;
      breakdown.push(`${p.asset} (${p.exchange}): $${value.toFixed(2)}`);
    }
    
    // Add PnL if available
    if (p.pnl !== null && p.pnl !== undefined && !isNaN(p.pnl)) {
      totalPnL += p.pnl;
    }
  }
  
  // Portfolio totals calculated
  
  const costBasis = totalValue - totalPnL;
  const totalPnLPercent = (costBasis > 0) ? (totalPnL / costBasis) * 100 : 0;
  
  return { totalValue, totalPnL, totalPnLPercent, costBasis };
}

// ============================================================================

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
        // Entry price reset
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
      // Entry price set
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
        // All entry prices reset
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
      // Entry prices exported
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
      // Entry prices imported
      return true;
    } catch (e) {
      console.error('Failed to import entry prices:', e);
      return false;
    }
  }
};

// Log utility availability on load
// Wallet PnL utilities available at window.walletPnLUtils

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
  const settings = getSettings();
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

/**
 * NEW: Incremental portfolio renderer - shows positions as each provider responds
 * This replaces the bloated renderDemoSummary with streaming updates
 */
async function renderPortfolioIncremental() {
  const mods = window.AppModules || {};
  const providers = mods.data?.providers || {};
  const { IncrementalPortfolioRenderer } = mods.incrementalPortfolio || {};
  const HeroUI = mods.ui?.hero;
  const PositionsUI = mods.ui?.positions;
  
  if (!IncrementalPortfolioRenderer) {
    console.error('[Portfolio] Incremental renderer not loaded');
    return;
  }
  
  const settings = getSettings();
  const wallets = (settings.walletAddresses || '').split(',').map(w => w.trim()).filter(Boolean);
  const solanaAddrs = (settings.solanaAddresses || '').split(',').map(a => a.trim()).filter(Boolean);
  const bitcoinAddrs = (settings.bitcoinAddresses || '').split(',').map(a => a.trim()).filter(Boolean);
  const zcashAddrs = (settings.zcashAddresses || '').split(',').map(a => a.trim()).filter(Boolean);
  
  if (wallets.length === 0 && solanaAddrs.length === 0 && bitcoinAddrs.length === 0 && zcashAddrs.length === 0) {
    const summaryEl = document.getElementById('newSummary');
    const positionsBody = document.getElementById('newPositionsBody');
    if (summaryEl) summaryEl.innerHTML = 'Your portfolio is empty. Add wallets in Settings.';
    if (positionsBody) positionsBody.innerHTML = '<tr><td colspan="8" class="loading">No wallets configured</td></tr>';
    return;
  }
  
  // Build list of expected providers based on configuration
  const expectedProviders = [];
  if (wallets.length > 0) {
    expectedProviders.push('Hyperliquid', 'Lighter');
    if (settings.zerionApiKey) {
      expectedProviders.push('Zerion');
    } else if (settings.alchemyApiKey || settings.heliusApiKey) {
      expectedProviders.push('Alchemy/Helius');
    }
  }
  if (bitcoinAddrs.length > 0 || zcashAddrs.length > 0) {
    expectedProviders.push('Bitcoin/Zcash');
  }
  
  const renderer = new IncrementalPortfolioRenderer({
    providers,
    settings,
    containers: {
      positionsBody: document.getElementById('newPositionsBody'),
      mobileContainer: document.getElementById('newMobilePositionsContainer'),
      summaryEl: document.getElementById('newSummary')
    },
    ui: { HeroUI, PositionsUI },
    expectedProviders
  });
  
  // Launch all providers concurrently (non-blocking)
  // Each will call renderer.appendPositions() when done
  
  // 1. Hyperliquid (fastest, ~500ms)
  if (wallets.length > 0) {
    (async () => {
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
        
        for (const wallet of wallets) {
          const data = await providers.hyperliquid.fetchPositions(wallet, 3000);
          const rows = [];
          
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
          
          if (data?.perp?.assetPositions) {
            for (const pos of data.perp.assetPositions) {
              const position = pos.position;
              const szi = parseFloat(position?.szi || 0);
              if (Math.abs(szi) > 0) {
                const entryPrice = parseFloat(position?.entryPx || 0);
                const currentPrice = hlPriceMap[position.coin] || entryPrice;
                const notionalValue = Math.abs(parseFloat(position?.positionValue || 0));
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
          
          if (data?.spot?.balances) {
            for (const bal of data.spot.balances) {
              const available = parseFloat(bal.total || 0) - parseFloat(bal.hold || 0);
              if (available > 0) {
                const price = parseFloat(spotPriceMap[bal.coin] || 0);
                const value = available * price;
                const entryNtl = parseFloat(bal.entryNtl || 0);
                const pnl = (entryNtl > 0 && value > 0) ? (value - entryNtl) : null;
                
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
          
          renderer.appendPositions(rows, 'Hyperliquid');
        }
      } catch (e) {
        renderer.markProviderFailed('Hyperliquid', e);
      }
    })();
  }
  
  // 2. Lighter (fast, ~500ms)
  if (wallets.length > 0) {
    (async () => {
      try {
        const rows = [];
        for (const wallet of wallets) {
          try {
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
          } catch (walletError) {
            console.warn(`[Lighter] Error for wallet ${wallet}:`, walletError.message);
          }
        }
        
        // Report completion even if no positions found
        renderer.appendPositions(rows, 'Lighter');
      } catch (e) {
        renderer.markProviderFailed('Lighter', e);
      }
    })();
  }
  
  // 3. Zerion (multichain, ~2-3s)
  if (settings.zerionApiKey && wallets.length > 0) {
    (async () => {
      try {
        const positionsData = await providers.zerion.getWalletPositions(wallets[0], settings.zerionApiKey, { timeoutMs: 5000 });
        const chainMap = {
          'ethereum': 'Ethereum', 'arbitrum': 'Arbitrum', 'optimism': 'Optimism',
          'polygon': 'Polygon', 'base': 'Base', 'avalanche': 'Avalanche',
          'bsc': 'BSC', 'solana': 'Solana', 'zksync-era': 'zkSync',
          'blast': 'Blast', 'hyperevm': 'HyperEVM'
        };
        
        const rows = [];
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
        renderer.appendPositions(rows, 'Zerion');
      } catch (e) {
        renderer.markProviderFailed('Zerion', e);
        // Fallback to Alchemy/Helius if Zerion fails
        if (settings.alchemyApiKey || settings.heliusApiKey) {
          (async () => {
            try {
              const [alchemyTokens, heliusTokens] = await Promise.all([
                settings.alchemyApiKey && wallets.length > 0
                  ? providers.alchemy.getTokenBalances(wallets, settings.alchemyApiKey, { timeoutMs: 5000 })
                  : Promise.resolve([]),
                settings.heliusApiKey && solanaAddrs.length > 0
                  ? providers.helius.getTokenBalances(solanaAddrs, settings.heliusApiKey, { timeoutMs: 5000 })
                  : Promise.resolve([])
              ]);
              
              const rows = [];
              for (const token of alchemyTokens) {
                rows.push({
                  asset: token.tokenSymbol,
                  exchange: token.blockchain,
                  amount: token.balance,
                  price: token.tokenPrice || 0,
                  value: token.balanceUsd || 0,
                  change24h: null,
                  pnl: null
                });
              }
              for (const token of heliusTokens) {
                rows.push({
                  asset: token.tokenSymbol,
                  exchange: token.blockchain,
                  amount: token.balance,
                  price: token.tokenPrice || 0,
                  value: token.balanceUsd || 0,
                  change24h: null,
                  pnl: null
                });
              }
              
              // Calculate PnL for wallet assets using entry price tracking
              const getWalletEntryPrices = () => {
                try {
                  const stored = localStorage.getItem('walletAssetEntryPrices');
                  return stored ? JSON.parse(stored) : {};
                } catch {
                  return {};
                }
              };
              const walletEntryPrices = getWalletEntryPrices();
              let entryPricesUpdated = false;
              const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'BUSD', 'FEUSD']);
              
              for (const row of rows) {
                const finalPrice = row.price || 0;
                const posKey = `${row.asset}_${row.exchange}`;
                
                // Skip stablecoins
                if (STABLECOINS.has(row.asset)) {
                  row.pnl = 0;
                  continue;
                }
                
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
              
              // Save updated entry prices if any were added
              if (entryPricesUpdated) {
                try {
                  localStorage.setItem('walletAssetEntryPrices', JSON.stringify(walletEntryPrices));
                } catch (e) {
                  console.error('[Portfolio] Failed to save entry prices:', e);
                }
              }
              
              renderer.appendPositions(rows, 'Alchemy/Helius');
            } catch (e2) {
              renderer.markProviderFailed('Alchemy/Helius', e2);
            }
          })();
        }
      }
    })();
  }
  
  // 4. Bitcoin + Zcash (slow, ~3-5s)
  if (bitcoinAddrs.length > 0 || zcashAddrs.length > 0) {
    (async () => {
      try {
        const [btcTokens, zcashTokens, cryptoPrices] = await Promise.all([
          bitcoinAddrs.length > 0 ? providers.bitcoin.getTokenBalances(bitcoinAddrs, { timeoutMs: 5000 }) : [],
          zcashAddrs.length > 0 ? providers.zcash.getTokenBalances(zcashAddrs, { timeoutMs: 5000 }) : [],
          providers.coingecko.getSimplePrice('bitcoin,zcash', { timeoutMs: 5000, ttlMs: 60000 })
        ]);
        
        const rows = [];
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
        
        // Calculate PnL for BTC/ZEC wallet assets using entry price tracking
        const getWalletEntryPrices = () => {
          try {
            const stored = localStorage.getItem('walletAssetEntryPrices');
            return stored ? JSON.parse(stored) : {};
          } catch {
            return {};
          }
        };
        const walletEntryPrices = getWalletEntryPrices();
        let entryPricesUpdated = false;
        
        for (const row of rows) {
          const finalPrice = row.price || 0;
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
        
        // Save updated entry prices if any were added
        if (entryPricesUpdated) {
          try {
            localStorage.setItem('walletAssetEntryPrices', JSON.stringify(walletEntryPrices));
          } catch (e) {
            console.error('[Portfolio] Failed to save entry prices:', e);
          }
        }
        
        renderer.appendPositions(rows, 'Bitcoin/Zcash');
      } catch (e) {
        renderer.markProviderFailed('Bitcoin/Zcash', e);
      }
    })();
  }
  
  // Initial render to show skeleton replaced by "Fetching..."
  renderer.render();
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
    const settings = getSettings();
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
    // Note: Loading state removed - using fade animation instead during refresh
    // summaryEl.innerHTML = '<span class="loading-terminal">Loading portfolio...</span>';

    // Render positions via providers if settings are available; fallback to demo
    const positionsBody = document.getElementById('newPositionsBody');
    const mobileContainer = document.getElementById('newMobilePositionsContainer');
    if (PositionsUI && typeof PositionsUI.renderPositions === 'function') {
      let rendered = false;
      try {
        const s = getSettings();
        const walletsRaw = s.walletAddresses || '';
        const wallets = walletsRaw.split(',').map(w => w.trim()).filter(Boolean);
        const zerionKey = s.zerionApiKey || '';

        if (wallets.length > 0) {
          const allRows = [];
          
          // CRITICAL: Only HL + Multi-chain for speed (fastest 2 providers)
          // Fetch Hyperliquid market data once for all wallets
          const [hlMarketData, hlAllMids, hlSpotMeta] = await Promise.all([
            providers.hyperliquid.fetchMetaAndAssetCtxs(5000),
            providers.hyperliquid.fetchAllMids(5000),
            providers.hyperliquid.fetchSpotMeta(5000)
          ]);
          
          // Build price map from market data
          const hlPriceMap = {};
          if (hlMarketData && hlMarketData[0] && hlMarketData[1]) {
            for (let i = 0; i < hlMarketData[1].length; i++) {
              const ctx = hlMarketData[1][i];
              const assetName = hlMarketData[0].universe[i]?.name;
              if (assetName && ctx?.markPx) {
                hlPriceMap[assetName] = parseFloat(ctx.markPx);
              }
            }
          }
          
          const [hlResults, lighterResults, multichainData] = await Promise.all([
            // Hyperliquid
            Promise.all(wallets.map(async (wallet) => {
              try {
                const hl = providers.hyperliquid;
                const data = await hl.fetchPositions(wallet, 5000);
                
                const rows = [];
                
                // Extract total account equity from Hyperliquid API
                // Perp equity from marginSummary.accountValue
                let perpEquity = 0;
                if (data?.perp?.marginSummary) {
                  perpEquity = parseFloat(data.perp.marginSummary.accountValue || 0);
                  // Perp equity calculated
                }
                
                // Spot equity from spot balances
                // Build spot price map from market data
                const spotPriceMap = providers.hyperliquid.buildSpotPriceMap(hlAllMids, hlSpotMeta);
                let spotEquity = 0;
                if (data?.spot?.balances) {
                  for (const bal of data.spot.balances) {
                    const total = parseFloat(bal.total || 0);
                    if (total > 0) {
                      const price = parseFloat(spotPriceMap[bal.coin] || 0);
                      const value = total * price;
                      spotEquity += value;
                    }
                  }
                  // Spot equity calculated
                }
                
                // Total Hyperliquid equity = perp + spot
                const hlAccountEquity = perpEquity + spotEquity;
                // Total equity calculated
                
                // Calculate total PnL from all positions
                let totalHlPnL = 0;
                if (data?.perp?.assetPositions) {
                  for (const pos of data.perp.assetPositions) {
                    const position = pos.position;
                    const szi = parseFloat(position?.szi || 0);
                    if (Math.abs(szi) > 0) {
                      const entryPrice = parseFloat(position?.entryPx || 0);
                      const currentPrice = hlPriceMap[position.coin] || entryPrice; // Use current market price
                      const leverage = parseFloat(position?.leverage?.value || 10); // Default to 10x if not available
                      const notionalValue = Math.abs(parseFloat(position?.positionValue || 0));
                      const pnl = parseFloat(position?.unrealizedPnl || 0);
                      totalHlPnL += pnl;
                      
                      // Calculate margin based on ENTRY value to avoid double-counting PnL
                      const entryNotional = Math.abs(szi) * entryPrice;
                      const marginUsed = entryNotional / leverage;
                      
                      rows.push({
                        asset: position.coin,
                        exchange: 'Hyperliquid',
                        amount: szi,
                        price: currentPrice, // Use current market price instead of entry price
                        value: notionalValue, // Show leveraged value in position display
                        change24h: null,
                        pnl: pnl,
                        entryPrice: entryPrice,
                        marginUsed: marginUsed, // Track margin for portfolio total calculation
                        isLeveraged: true,
                        hlAccountEquity: hlAccountEquity // Store account equity on first position
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
                
                // If we have account equity from API, add a synthetic position to track it
                // This ensures the total portfolio value reflects the true Hyperliquid equity
                if (hlAccountEquity !== null && hlAccountEquity > 0) {
                  // Account equity position created
                  // Add a synthetic position that represents the Hyperliquid account equity
                  // We'll use this to ensure portfolio total is correct
                  rows.push({
                    asset: 'HL_ACCOUNT_EQUITY',
                    exchange: 'Hyperliquid',
                    amount: 1,
                    price: hlAccountEquity,
                    value: hlAccountEquity,
                    change24h: null,
                    pnl: totalHlPnL,
                    isHlAccountEquity: true, // Mark this as special
                    isLeveraged: false, // Don't apply leveraged logic to this
                    walletAddress: wallet // Track which wallet this belongs to
                  });
                } else if (hlAccountEquity === 0) {
                  // Account equity is zero
                } else {
                  console.warn('[Hyperliquid] Could not extract account equity from API');
                }
                
                return rows;
              } catch (_) { return []; }
            })),
            
            // Lighter
            Promise.all(wallets.map(async (wallet) => {
              try {
                const lighter = providers.lighter;
                const data = await lighter.fetchAccountByAddress(wallet, { timeoutMs: 5000 });
                
                const rows = [];
                
                // Extract total equity from Lighter API
                // The API returns accounts array with account data
                let lighterAccountEquity = null;
                let totalLighterPnL = 0;
                
                if (data && data.accounts && Array.isArray(data.accounts) && data.accounts.length > 0) {
                  // Get the first account (user should only have one account per address)
                  const account = data.accounts[0];
                  
                  // Extract equity - Lighter typically returns equity_usd or total_equity
                  // Try multiple possible field names
                  lighterAccountEquity = parseFloat(
                    account.equity_usd || 
                    account.total_equity || 
                    account.equity || 
                    account.balance_usd ||
                    account.total_balance ||
                    0
                  );
                  
                  // Extract PnL if available
                  totalLighterPnL = parseFloat(
                    account.unrealized_pnl || 
                    account.pnl || 
                    account.total_pnl || 
                    0
                  );
                  
                  // Lighter account data extracted
                }
                
                // If we have account equity from API, add a synthetic position to track it
                if (lighterAccountEquity !== null && lighterAccountEquity > 0) {
                  // Lighter account equity position created
                  rows.push({
                    asset: 'LIGHTER_ACCOUNT_EQUITY',
                    exchange: 'Lighter',
                    amount: 1,
                    price: lighterAccountEquity,
                    value: lighterAccountEquity,
                    change24h: null,
                    pnl: totalLighterPnL,
                    isLighterAccountEquity: true, // Mark this as special
                    isLeveraged: false,
                    walletAddress: wallet
                  });
                } else if (lighterAccountEquity === 0) {
                  // Lighter account equity is zero
                } else {
                  // No Lighter account found
                }
                
                return rows;
              } catch (e) { 
                console.error('[Lighter] Error fetching account:', e);
                return []; 
              }
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
                  const positionsData = await z.getWalletPositions(wallets[0], zerionKey, { timeoutMs: 5000 }).catch(e => {
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
                      ? providers.bitcoin.getTokenBalances(bitcoinAddrs, { timeoutMs: 5000 }).catch(e => {
                          console.error('[/portfolio] Bitcoin error:', e.message || e);
                          return [];
                        })
                      : Promise.resolve([]),
                    
                    // Zcash
                    zcashAddrs.length > 0
                      ? providers.zcash.getTokenBalances(zcashAddrs, { timeoutMs: 5000 }).catch(e => {
                          console.error('[/portfolio] Zcash error:', e.message || e);
                          return [];
                        })
                      : Promise.resolve([]),
                    
                    // Get BTC and ZEC prices from CoinGecko
                    providers.coingecko.getSimplePrice('bitcoin,zcash', { timeoutMs: 5000, ttlMs: 60000 }).catch(e => {
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
                    ? providers.alchemy.getTokenBalances(wallets, alchemyKey, { timeoutMs: 8000 }).catch(e => {
                        console.error('[/portfolio] Alchemy error:', e.message || e);
                        return [];
                      })
                    : Promise.resolve([]),
                  
                  // Helius (Solana)
                  heliusKey && solanaAddrs.length > 0
                    ? providers.helius.getTokenBalances(solanaAddrs, heliusKey, { timeoutMs: 8000 }).catch(e => {
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
          
          const flatHlResults = hlResults.flat();
          const flatLighterResults = lighterResults.flat();
          // Data fetched from all sources
          allRows.push(...flatHlResults, ...flatLighterResults, ...multichainData);
          
          if (allRows.length > 0) {
            // Enrich with prices for HL/Lighter (Zerion already has prices)
            const uniqueAssets = [...new Set(allRows.filter(r => !r.price || r.price === 0).map(r => r.asset))];
            
            if (uniqueAssets.length > 0) {
              try {
                // Fetch market data from Hyperliquid for all assets (perps + spot)
                const [marketData, allMids, spotMeta] = await Promise.all([
                  providers.hyperliquid.fetchMetaAndAssetCtxs(5000),
                  providers.hyperliquid.fetchAllMids(5000),
                  providers.hyperliquid.fetchSpotMeta(5000)
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
                const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'BUSD', 'FEUSD']);
                for (const row of allRows) {
                  const currentPrice = priceMap[row.asset] || row.price || 0;
                  const change24h = change24hMap[row.asset];
                  
                  // Stablecoins default to $1
                  const finalPrice = STABLECOINS.has(row.asset) && currentPrice === 0 ? 1 : currentPrice;
                  
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
                  // Entry prices saved
                }
                
                // Log PnL summary
                const walletAssetsWithPnl = allRows.filter(r => 
                  r.pnl !== null && r.pnl !== undefined && 
                  r.exchange !== 'Hyperliquid' && r.exchange !== 'Lighter'
                );
                if (walletAssetsWithPnl.length > 0) {
                  // Wallet PnL tracking active
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
            
            // Aggregate duplicate assets (except leveraged positions and special tracking positions)
            const aggregatedRows = [];
            const assetGroups = new Map();
            const hasHlEquity = allRows.some(r => r.isHlAccountEquity);
            
            for (const row of allRows) {
              // Keep leveraged positions separate - don't aggregate them
              if (row.isLeveraged) {
                aggregatedRows.push(row);
                continue;
              }
              
              // Keep special account equity tracking positions separate (hidden from UI)
              if (row.isHlAccountEquity || row.isLighterAccountEquity) {
                aggregatedRows.push(row);
                continue;
              }
              
              // For Hyperliquid positions: keep them for display, but they won't be counted in total
              // (the account equity already includes them in the portfolio total)
              if (row.exchange === 'Hyperliquid' || row.exchange === 'Hyperliquid Spot') {
                // Don't aggregate HL positions with other exchanges to avoid confusion
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
            
            // Positions aggregated
            
            const sorted = aggregatedRows.sort((a, b) => (b.value || 0) - (a.value || 0));
            
            // Cache for re-rendering
            cachedPositions = sorted;
            
            // Calculate total value and PnL from ALL positions (including hidden ones)
            const { totalValue, totalPnL, totalPnLPercent } = calculatePortfolioTotals(sorted);
            cachedSummaryData = { totalValue, totalPnL, totalPnLPercent };
            
            // Filter out hidden assets for display
            const visible = filterPositions(sorted, { hideHidden: true, hideSmall: false });
            
            PositionsUI.renderPositions({
              positions: visible,
              containers: { positionsBody, mobilePositionsContainer: mobileContainer },
              options: { amountsVisible, hideSmallPositions, editMode, settings: { minBalanceThreshold: s.minBalanceThreshold || 100, showExactAmounts: s.showExactAmounts || false, useColoredPnL: s.useColoredPnL ?? true, showPriceChart: s.showPriceChart ?? true } }
            });
            
            rendered = true; // Mark as successfully rendered
            
            // Load charts in background (non-blocking) - ONLY if showPriceChart is enabled
            const showPriceChart = s.showPriceChart ?? true;
            if (showPriceChart) {
              (async () => {
                try {
                  const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'BUSD']);
                  const pythFeedMap = await providers.pyth.getPriceFeeds(5000);
                  const historyPromises = sorted.map(async (pos) => {
                    if (STABLECOINS.has(pos.asset?.toUpperCase())) {
                      pos.priceHistory = null;
                      return { success: true, pos };
                    }
                    
                    const feedId = pythFeedMap[pos.asset];
                    if (feedId && providers.pyth.get24hPriceHistory) {
                      try {
                        const history = await providers.pyth.get24hPriceHistory(feedId, 3000);
                        pos.priceHistory = history.length > 0 ? history : null;
                        return { success: history.length > 0, pos };
                      } catch (e) {
                        pos.priceHistory = null;
                        return { success: false, pos };
                      }
                    } else {
                      pos.priceHistory = null;
                      return { success: false, pos };
                    }
                  });
                  const results = await Promise.all(historyPromises);
                  const successCount = results.filter(r => r.success).length;
                  const totalNonStable = results.filter(r => !STABLECOINS.has(r.pos?.asset?.toUpperCase())).length;
                  if (totalNonStable > 0) {
                    // Charts loaded in background
                  }
                  // Re-render ONLY positions (don't recalculate portfolio)
                  const positionsBody = document.getElementById('newPositionsBody');
                  const mobileContainer = document.getElementById('newMobilePositionsContainer');
                  const visible = filterPositions(cachedPositions, { hideHidden: true, hideSmall: hideSmallPositions });
                  if (PositionsUI && positionsBody) {
                    PositionsUI.renderPositions({
                      positions: visible,
                      containers: { positionsBody, mobilePositionsContainer: mobileContainer },
                      options: { amountsVisible: !document.body.classList.contains('amounts-hidden'), hideSmallPositions, editMode: false, settings: { minBalanceThreshold: s.minBalanceThreshold || 100, showExactAmounts: s.showExactAmounts || false, useColoredPnL: s.useColoredPnL ?? true, showPriceChart: s.showPriceChart ?? true } }
                    });
                  }
                } catch (e) {
                  console.warn('[Charts] Background chart loading failed:', e);
                }
              })();
            }
            
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
                      
                      // Cache weather for reuse in re-renders
                      cachedWeather = weather;
                      
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
        positionsBody.innerHTML = '<tr><td colspan="8" class="loading">No positions found. Add wallets in Settings.</td></tr>';
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
let cachedWeather = null; // Cache weather data globally to preserve across re-renders
let cachedWatchlistData = null; // Cache watchlist data globally
let watchlistEditMode = false;
let rerenderPositions = null; // Global reference to rerender function
let currentFontSize = 15; // Default font size in px

// Expose to window for incremental renderer
window.hideSmallPositions = hideSmallPositions;
window.hiddenAssets = hiddenAssets;
window.editMode = editMode;
window.cachedPositions = cachedPositions;
window.cachedSummaryData = cachedSummaryData;

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

// Render lightweight skeletons so the app feels instant
function renderHeroSkeleton() {
  const summaryEl = document.getElementById('newSummary');
  if (!summaryEl) return;
  summaryEl.innerHTML = `
    <div class="skeleton-row" style="gap: 8px;">
      <div class="skeleton-text skeleton-text-long"></div>
    </div>
    <div class="skeleton-row" style="gap: 8px;">
      <div class="skeleton-text skeleton-text-medium"></div>
    </div>
  `;
}

function renderPositionsSkeleton(rows = 6) {
  const tbody = document.getElementById('newPositionsBody');
  const mobile = document.getElementById('newMobilePositionsContainer');
  if (!tbody) return;
  const cells = 8; // Asset, Price, Chart, Value, P&L, 24H %, Amount, Exchange
  let html = '';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cells; c++) {
      const widthClass = c === 0 ? 'skeleton-text-medium' : (c === 3 ? 'skeleton-text-long' : 'skeleton-text-short');
      html += `<td><div class="skeleton-text ${widthClass}"></div></td>`;
    }
    html += '</tr>';
  }
  tbody.innerHTML = html;
  if (mobile) {
    // Keep mobile container empty; table skeleton covers initial paint. Mobile shows cards later.
    mobile.innerHTML = '';
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
  const settings = getSettings();
  
  // Load hidden assets from settings
  const savedHidden = settings.hiddenAssets || [];
  hiddenAssets = new Set(savedHidden);
  
  // Cleanup: Remove any manual positions that are in hiddenAssets
  // (users might think hiding = deleting for manual positions)
  let needsSave = false;
  if (settings.cryptoPositions && Array.isArray(settings.cryptoPositions) && settings.cryptoPositions.length > 0) {
    const originalCount = settings.cryptoPositions.length;
    settings.cryptoPositions = settings.cryptoPositions.filter(p => {
      const assetName = p.type === 'custom' ? p.name : p.symbol;
      const assetKey = `${assetName}_Manual`;
      const isHidden = hiddenAssets.has(assetKey);
      if (isHidden) {
        // Hidden manual position removed
        hiddenAssets.delete(assetKey); // Also remove from hiddenAssets
      }
      return !isHidden;
    });
    
    if (settings.cryptoPositions.length !== originalCount) {
      needsSave = true;
      settings.hiddenAssets = Array.from(hiddenAssets);
    }
  }
  
  // Save if we cleaned up anything
  if (needsSave) {
    localStorage.setItem('myDashboardSettings.v1', JSON.stringify(settings));
    invalidateSettingsCache();
    // Cleanup completed
  }
  
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
      window.hideSmallPositions = hideSmallPositions; // Update global for incremental renderer
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
    const positionsBody = DOMCache.get('newPositionsBody');
    const mobileContainer = DOMCache.get('newMobilePositionsContainer');
    const PositionsUI = window.AppModules?.ui?.positions;
    if (PositionsUI && cachedPositions.length > 0) {
      const filtered = filterPositions(cachedPositions, { 
        hideHidden: true, 
        hideSmall: hideSmallPositions, 
        threshold: settings.minBalanceThreshold || 100 
      });
      
      // Debug: log positions with priceChanged flag
      const changedPositions = filtered.filter(p => p.priceChanged);
      if (changedPositions.length > 0) {
        // Positions marked as changed
      }
      
      // Pre-compute options object (avoid spreading in hot path)
      const renderOptions = {
        amountsVisible,
        hideSmallPositions: false,
        editMode,
        settings: {
          minBalanceThreshold: settings.minBalanceThreshold || 100,
          showExactAmounts: settings.showExactAmounts || false,
          useColoredPnL: settings.useColoredPnL ?? true,
          showPriceChart: settings.showPriceChart ?? true
        }
      };
      
      PositionsUI.renderPositions({
        positions: filtered,
        containers: { positionsBody, mobilePositionsContainer: mobileContainer },
        options: renderOptions
      });
      
      // Flash updated cells with background color animation
      setTimeout(() => {
        const cells = document.querySelectorAll('td[data-flash="true"]');
        if (cells.length > 0) {
          // Cells flashed
        }
        cells.forEach(cell => {
          cell.classList.add('cell-flash');
          // Remove the class after animation completes
          cell.addEventListener('animationend', () => {
            cell.classList.remove('cell-flash');
            cell.removeAttribute('data-flash');
          }, { once: true });
        });
        
        // Clear priceChanged flags after flashing
        cachedPositions = cachedPositions.map(pos => ({ ...pos, priceChanged: false }));
      }, 50);
      
      // Update hero with ALL positions (not filtered - need to include hidden equity positions)
      const { totalValue, totalPnL, totalPnLPercent } = calculatePortfolioTotals(cachedPositions);
      const summaryEl = DOMCache.get('newSummary');
      const HeroUI = window.AppModules?.ui?.hero;
      if (HeroUI && summaryEl) {
        const heroHtml = HeroUI.composeSummary({
          portfolioValue: totalValue,
          amountsVisible,
          heroPnLMode: 'total',
          totalPnL,
          totalPnLPercent,
          totalDailyChange: 0,
          totalDailyChangePercent: 0,
          useColoredPnL: true,
          highlightsHtml: [],
          weather: cachedWeather // Use cached weather to preserve it across re-renders
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
              const s = getSettings();
              s.hiddenAssets = Array.from(hiddenAssets);
              localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
              invalidateSettingsCache();
              
              // Re-render
              rerenderPositions();
            } else if (e.target.classList.contains('position-delete-btn')) {
              // Delete manual position
              const asset = e.target.getAttribute('data-asset');
              const manualType = e.target.getAttribute('data-manual-type');
              
              if (confirm(`Delete manual position "${asset}"?`)) {
                const Settings = window.AppModules?.core?.settings;
                const s = getSettings();
                
                if (s.cryptoPositions && Array.isArray(s.cryptoPositions)) {
                  // Remove the matching position from settings
                  if (manualType === 'custom') {
                    s.cryptoPositions = s.cryptoPositions.filter(p => !(p.type === 'custom' && p.name === asset));
                  } else if (manualType === 'pyth') {
                    s.cryptoPositions = s.cryptoPositions.filter(p => !(p.type === 'pyth' && p.symbol === asset));
                  }
                  
                  // Also remove from hiddenAssets if present (so it doesn't linger as hidden)
                  const assetKey = `${asset}_Manual`;
                  if (s.hiddenAssets && s.hiddenAssets.includes(assetKey)) {
                    s.hiddenAssets = s.hiddenAssets.filter(key => key !== assetKey);
                  }
                  
                  // Save
                  localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
                  invalidateSettingsCache();
                  
                  // Remove from cachedPositions to update portfolio value
                  if (manualType === 'custom') {
                    cachedPositions = cachedPositions.filter(p => !(p.isManual && p.manualType === 'custom' && p.asset === asset));
                  } else if (manualType === 'pyth') {
                    cachedPositions = cachedPositions.filter(p => !(p.isManual && p.manualType === 'pyth' && p.asset === asset));
                  }
                  
                  // Also remove from hiddenAssets set in memory
                  hiddenAssets.delete(assetKey);
                  
                  // Re-render without page reload
                  rerenderPositions();
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
  
  // Toggle compact mode (just controls padding/styling, column order is always the same)
  const compactBtn = document.getElementById('newCompactModeBtn');
  if (compactBtn) {
    compactBtn.addEventListener('click', () => {
      compactMode = !compactMode;
      compactBtn.textContent = compactMode ? '[EXPAND]' : '[COMPACT]';
      
      // Toggle compact mode class - CSS handles padding and column visibility
      document.body.classList.toggle('compact-mode', compactMode);
      document.querySelectorAll('.data-table').forEach(table => {
        table.classList.toggle('compact-mode', compactMode);
      });
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
      const s = getSettings();
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
      const showExactAmountsInput = document.getElementById('newShowExactAmounts');
      const showPriceChartInput = document.getElementById('newShowPriceChart');
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
      if (showExactAmountsInput) showExactAmountsInput.checked = s.showExactAmounts ?? false;
      if (showPriceChartInput) showPriceChartInput.checked = s.showPriceChart ?? true;
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
      const s = getSettings();
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
      const s = getSettings();
      s.rainEnabled = active;
      s.snowEnabled = false;
      s.rainSnowManuallySet = true; // User has manually set preference
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
      const s = getSettings();
      s.snowEnabled = active;
      s.rainEnabled = false;
      s.rainSnowManuallySet = true; // User has manually set preference
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
      const s = getSettings();
      s.rainEnabled = active;
      s.snowEnabled = false;
      s.rainSnowManuallySet = true; // User has manually set preference
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
      const s = getSettings();
      s.snowEnabled = active;
      s.rainEnabled = false;
      s.rainSnowManuallySet = true; // User has manually set preference
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
        const s = getSettings();
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
        const s = getSettings();
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
        const s = getSettings();
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
        const s = getSettings();
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
          invalidateSettingsCache(); // Clear cache so next getSettings() reads fresh data
          
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
      const showExactAmountsInput = document.getElementById('newShowExactAmounts');
      const showPriceChartInput = document.getElementById('newShowPriceChart');
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
      if (showExactAmountsInput) newSettings.showExactAmounts = showExactAmountsInput.checked;
      if (showPriceChartInput) newSettings.showPriceChart = showPriceChartInput.checked;
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
      
      newSettings.weather = {
        label: cityInput?.value || '',
        lat: parseFloat(latInput?.value) || 0,
        lon: parseFloat(lonInput?.value) || 0
      };
      
      // Save via legacy saveSettings (handles encryption)
      try {
        localStorage.setItem('myDashboardSettings.v1', JSON.stringify(newSettings));
        invalidateSettingsCache(); // Clear cache so next getSettings() reads fresh data
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
        
        // Apply chart visibility class
        if (!newSettings.showPriceChart) {
          document.body.classList.add('no-charts');
        } else {
          document.body.classList.remove('no-charts');
        }
        
        // Re-render watchlist with new showPriceChart setting
        const watchlistBody = document.getElementById('newWatchlistBody');
        if (watchlistBody && newSettings.watchlist && newSettings.watchlist.length > 0) {
          try {
            const watchlistMod = await import('./modules/features/watchlist.js');
            const pythProvider = window.AppModules?.data?.providers?.pyth;
            const prices = await watchlistMod.render(watchlistBody, {
              feedIds: newSettings.watchlist,
              pythProvider,
              useColoredPnL: newSettings.useColoredPnL ?? true,
              editMode: watchlistEditMode,
              cachedData: cachedWatchlistData,
              showPriceChart: newSettings.showPriceChart ?? true
            });
            cachedWatchlistData = prices; // Update cache
          } catch (e) {
            // Silently fail if watchlist re-render fails
          }
        }
        
        // Apply visibility settings via body classes
        const body = document.body;
        body.classList.toggle('hide-snow-btn', !(newSettings.showSnowBtn ?? true));
        body.classList.toggle('hide-rain-btn', !(newSettings.showRainBtn ?? true));
        body.classList.toggle('hide-font-size', !(newSettings.showFontSize ?? true));
        body.classList.toggle('hide-theme-btn', !(newSettings.showThemeBtn ?? true));
        body.classList.toggle('hide-amounts-btn', !(newSettings.showAmountsBtn ?? true));
        body.classList.toggle('hide-refresh-btn', !(newSettings.showRefreshBtn ?? true));
        body.classList.toggle('hide-donate-btn', !(newSettings.showDonateBtn ?? true));
        body.classList.toggle('hide-watchlist', newSettings.showWatchlist === false);
        body.classList.toggle('hide-comic', !(newSettings.showComic ?? false));
        
        // Soft reload: re-fetch positions without full page refresh (this will reload settings)
        await renderPortfolioIncremental();
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
    const s = getSettings();
    if (!s.watchlist) s.watchlist = [];
    
    if (!s.watchlist.includes(feedId)) {
      s.watchlist.push(feedId);
      try {
        localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
        
        // Reload watchlist immediately
        const watchlistBody = document.getElementById('newWatchlistBody');
        if (watchlistBody) {
          watchlistBody.innerHTML = `<tr><td colspan="4" class="loading"><span class="loading-terminal">[LOADING...]</span></td></tr>`;
          try {
            const mod = await import('./modules/features/watchlist.js');
            const pythProvider = window.AppModules?.data?.providers?.pyth;
            await mod.render(watchlistBody, {
              feedIds: s.watchlist,
              pythProvider,
              useColoredPnL: s.useColoredPnL ?? true,
              showPriceChart: s.showPriceChart ?? true
            });
          } catch (e) {
            watchlistBody.innerHTML = `<tr><td colspan="4" class="loading">Watchlist unavailable</td></tr>`;
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
    if (watchlistSearchResults) {
      watchlistSearchResults.innerHTML = '';
      watchlistSearchResults.style.display = 'none';
    }
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
      const s = getSettings();
      const currentWatchlist = s.watchlist || [];
      
      if (!query) {
        watchlistSearchResults.innerHTML = '<div class="help" style="padding: 16px;">Type to search tokens...</div>';
        watchlistSearchResults.style.display = 'block';
        return;
      }
      
      const matches = feeds.filter(f => 
        f.symbol.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 50);
      
      if (matches.length === 0) {
        watchlistSearchResults.innerHTML = '<div class="help" style="padding: 16px;">No results found</div>';
        watchlistSearchResults.style.display = 'block';
        return;
      }
      
      watchlistSearchResults.innerHTML = '';
      watchlistSearchResults.style.display = 'block';
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
    const s = getSettings();
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
        watchlistBody.innerHTML = `<tr><td colspan="4" class="loading"><span class="loading-terminal">[LOADING...]</span></td></tr>`;
        (async () => {
          try {
            const mod = await import('./modules/features/watchlist.js');
            const pythProvider = window.AppModules?.data?.providers?.pyth;
            const prices = await mod.render(watchlistBody, {
              feedIds: s.watchlist,
              pythProvider,
              useColoredPnL: s.useColoredPnL ?? true,
              editMode: watchlistEditMode,
              showPriceChart: s.showPriceChart ?? true
            });
            
            // Update cache with new data
            cachedWatchlistData = prices;
            
            // Re-attach event listeners for edit buttons
            if (watchlistEditMode) {
              attachWatchlistEditListeners();
            }
          } catch (e) {
            watchlistBody.innerHTML = '<tr><td colspan="4" class="loading">Watchlist unavailable</td></tr>';
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
        const s = getSettings();
        await mod.render(watchlistBody, {
          feedIds: s.watchlist || [],
          pythProvider: window.AppModules?.data?.providers?.pyth,
          useColoredPnL: s.useColoredPnL ?? true,
          editMode: watchlistEditMode,
          cachedData: cachedWatchlistData, // Pass cached data to avoid refetch
          showPriceChart: s.showPriceChart ?? true
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
      if (addPositionPythResults) {
        addPositionPythResults.innerHTML = '';
        addPositionPythResults.style.display = 'none';
      }
      
      // Set initial view
      if (addPositionPythSection) addPositionPythSection.style.display = 'block';
      if (addPositionCustomSection) addPositionCustomSection.style.display = 'none';
      if (addPositionTypePyth) {
        addPositionTypePyth.classList.add('active');
      }
      if (addPositionTypeCustom) {
        addPositionTypeCustom.classList.remove('active');
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
      addPositionTypePyth.classList.add('active');
      if (addPositionTypeCustom) {
        addPositionTypeCustom.classList.remove('active');
      }
    });
  }
  
  if (addPositionTypeCustom) {
    addPositionTypeCustom.addEventListener('click', () => {
      selectedPositionType = 'custom';
      if (addPositionPythSection) addPositionPythSection.style.display = 'none';
      if (addPositionCustomSection) addPositionCustomSection.style.display = 'block';
      addPositionTypeCustom.classList.add('active');
      if (addPositionTypePyth) {
        addPositionTypePyth.classList.remove('active');
      }
    });
  }
  
  if (addPositionPythSearch) {
    addPositionPythSearch.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      if (!query || !addPositionPythResults) {
        if (addPositionPythResults) {
          addPositionPythResults.innerHTML = '';
          addPositionPythResults.style.display = 'none';
        }
        return;
      }
      
      const feeds = allPythFeeds || [];
      const matches = feeds.filter(f => 
        f.symbol.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 20);
      
      addPositionPythResults.innerHTML = '';
      if (matches.length > 0) {
        addPositionPythResults.style.display = 'block';
        matches.forEach(feed => {
          const resultDiv = document.createElement('div');
          resultDiv.className = 'watchlist-search-result';
          resultDiv.innerHTML = `<span>${feed.symbol}</span>`;
          resultDiv.style.cursor = 'pointer';
          resultDiv.addEventListener('click', () => {
            selectedPythFeed = feed;
            addPositionPythSearch.value = feed.symbol;
            addPositionPythResults.innerHTML = '';
            addPositionPythResults.style.display = 'none';
          });
          addPositionPythResults.appendChild(resultDiv);
        });
      } else {
        addPositionPythResults.style.display = 'none';
      }
    });
  }
  
  if (savePositionBtn) {
    savePositionBtn.addEventListener('click', async () => {
      const s = getSettings();
      
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
        await renderPortfolioIncremental();
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
  // Do not block on loading overlay; switch to skeleton UI immediately
  hideLoadingScreen();
  renderHeroSkeleton();
  renderPositionsSkeleton(7);
  
  // NON-CRITICAL: Display version from service worker (async, non-blocking)
  setTimeout(() => {
    const versionDisplay = document.getElementById('versionDisplay');
    if (versionDisplay) {
      fetch('/sw.js')
        .then(response => response.text())
        .then(swCode => {
          const versionMatch = swCode.match(/CACHE_VERSION\s*=\s*'v([0-9.]+)'/);
          const timestampMatch = swCode.match(/BUILD_TIMESTAMP\s*=\s*'([^']+)'/);
          if (versionMatch) {
            const version = versionMatch[1];
            const timestamp = timestampMatch ? new Date(timestampMatch[1]).toLocaleString('en-US', { 
              month: 'short', 
              day: 'numeric', 
              hour: '2-digit', 
              minute: '2-digit' 
            }) : '';
            versionDisplay.textContent = `v${version}${timestamp ? ` (${timestamp})` : ''}`;
          }
        })
        .catch(() => {
          versionDisplay.textContent = 'Version: Unknown';
        });
    }
  }, 100);
  
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
        const s = getSettings();
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
        const s = getSettings();
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
  
  // Apply visibility settings via body classes (CSS handles the rest)
  const applyVisibilityClasses = () => {
    const body = document.body;
    
    // Button visibility
    body.classList.toggle('hide-snow-btn', !(settings.showSnowBtn ?? true));
    body.classList.toggle('hide-rain-btn', !(settings.showRainBtn ?? true));
    body.classList.toggle('hide-font-size', !(settings.showFontSize ?? true));
    body.classList.toggle('hide-theme-btn', !(settings.showThemeBtn ?? true));
    body.classList.toggle('hide-amounts-btn', !(settings.showAmountsBtn ?? true));
    body.classList.toggle('hide-refresh-btn', !(settings.showRefreshBtn ?? true));
    body.classList.toggle('hide-donate-btn', !(settings.showDonateBtn ?? true));
    
    // Section visibility
    body.classList.toggle('hide-watchlist', settings.showWatchlist === false);
    body.classList.toggle('hide-comic', !(settings.showComic ?? false));
  };
  applyVisibilityClasses();
  
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
      
      const summaryEl = document.getElementById('newSummary');
      
      try {
        startSpinner();
        
        // Apply pulsing animation (like comics)
        if (summaryEl) {
          summaryEl.classList.add('fading');
        }
        
        await renderPortfolioIncremental();
        rerenderPositions();
        
        // Remove pulsing animation after content is loaded
        if (summaryEl) {
          setTimeout(() => {
            summaryEl.classList.remove('fading');
          }, 100);
        }
        
        // Also refresh watchlist if present and enabled in settings
        const currentSettings = getSettings();
        if (currentSettings.showWatchlist !== false) {
          const watchlistModule = await import('./modules/features/watchlist.js').catch(() => null);
          if (watchlistModule && watchlistModule.refreshWatchlist) {
            await watchlistModule.refreshWatchlist().catch(() => {});
          }
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
    await renderPortfolioIncremental();
  } catch (error) {
    console.error('[/portfolio] renderPortfolioIncremental failed:', error);
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
    
    // Only auto-enable if user hasn't manually set preference
    if (!settings.rainSnowManuallySet) {
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
    }
  }, 2000); // Wait 2 seconds after page load
  
  // Lazy-load comic on intersection or idle (if enabled in settings)
  // Comic section visibility controlled by CSS via body.hide-comic class
  const comicSection = document.getElementById('comicSection');
  const comicEl = document.getElementById('newComic');
  if (settings.showComic !== false && comicEl) {
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
      comicEl.textContent = 'Loading...';
      try {
        const mod = await import('./modules/features/comics.js');
        await mod.renderComic(comicEl, comicKey, date);
        currentComicDate = date;
        
        // Update button states
        updateComicButtons(comicKey, date);
      } catch (e) {
        console.error(`[Comics] Failed to load ${comicKey}:`, e);
        comicEl.textContent = 'Loading...';
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
          const s = getSettings();
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
  
  // Apply chart visibility class to body
  const showPriceChart = settings.showPriceChart ?? true;
  if (!showPriceChart) {
    document.body.classList.add('no-charts');
  } else {
    document.body.classList.remove('no-charts');
  }
  
  // Lazy-load watchlist on intersection or idle (if enabled in settings)
  // Watchlist section visibility controlled by CSS via body.hide-watchlist class
  const watchlistSection = document.getElementById('watchlistSection');
  const watchlistBody = document.getElementById('newWatchlistBody');
  
  if (settings.showWatchlist !== false && watchlistBody) {
    const loadWatchlist = async () => {
      watchlistBody.innerHTML = `<tr><td colspan="4" class="loading">Loading...</td></tr>`;
      try {
        const mod = await import('./modules/features/watchlist.js');
        const pythProvider = window.AppModules?.data?.providers?.pyth;
        const watchlistIds = settings.watchlist || [];
        const prices = await mod.render(watchlistBody, {
          feedIds: watchlistIds,
          pythProvider,
          useColoredPnL: settings.useColoredPnL ?? true,
          showPriceChart: settings.showPriceChart ?? true
        });
        // Cache the data for instant edit toggle
        cachedWatchlistData = prices;
      } catch (e) {
        watchlistBody.innerHTML = `<tr><td colspan="4" class="loading">Watchlist unavailable</td></tr>`;
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
  
  // Periodic price updates (every 5 seconds for prices, every 30 seconds for full position refresh)
  let updateInterval = null;
  let updateCount = 0;
  
  async function updatePrices() {
    try {
      const providers = window.AppModules?.data?.providers;
      const Settings = window.AppModules?.core?.settings;
      if (!providers) return;
      
      updateCount++;
      const doLeveragedRefresh = true; // Refresh leveraged positions every 5 seconds
      let hasEquityChanges = false; // Track if equity positions changed
      
      // Update positions if they exist
      if (cachedPositions && cachedPositions.length > 0) {
        // If we have account equity positions, refresh them from APIs
        if (doLeveragedRefresh && cachedPositions.some(p => p.isLeveraged || p.isHlAccountEquity || p.isLighterAccountEquity)) {
          // Refreshing account equity
          const settings = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
          const wallets = (settings.walletAddresses || '').split(',').map(w => w.trim()).filter(Boolean);
          
          if (wallets.length > 0) {
            try {
              // Fetch Hyperliquid market data for current prices
              const [hlMarketData, hlAllMids, hlSpotMeta] = await Promise.all([
                providers.hyperliquid.fetchMetaAndAssetCtxs(8000),
                providers.hyperliquid.fetchAllMids(8000),
                providers.hyperliquid.fetchSpotMeta(8000)
              ]);
              
              // Build price map from market data
              const hlPriceMap = {};
              if (hlMarketData && hlMarketData[0] && hlMarketData[1]) {
                for (let i = 0; i < hlMarketData[1].length; i++) {
                  const ctx = hlMarketData[1][i];
                  const assetName = hlMarketData[0].universe[i]?.name;
                  if (assetName && ctx?.markPx) {
                    hlPriceMap[assetName] = parseFloat(ctx.markPx);
                  }
                }
              }
              
              // Fetch fresh Hyperliquid and Lighter positions
              const [hlResults, lighterResults] = await Promise.all([
                // Hyperliquid
                Promise.all(wallets.map(async (wallet) => {
                  try {
                    const hl = providers.hyperliquid;
                    const data = await hl.fetchPositions(wallet, 8000);
                    const rows = [];
                    
                    // Extract account equity (perp + spot)
                    let perpEquity = 0;
                    if (data?.perp?.marginSummary) {
                      perpEquity = parseFloat(data.perp.marginSummary.accountValue || 0);
                    }
                    
                    // Spot equity from spot balances
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
                    
                    // Calculate total PnL from all positions
                    let totalHlPnL = 0;
                    if (data?.perp?.assetPositions) {
                      for (const pos of data.perp.assetPositions) {
                        const position = pos.position;
                        const szi = parseFloat(position?.szi || 0);
                        if (Math.abs(szi) > 0) {
                          const entryPrice = parseFloat(position?.entryPx || 0);
                          const currentPrice = hlPriceMap[position.coin] || entryPrice; // Use current market price
                          const leverage = parseFloat(position?.leverage?.value || 10);
                          const notionalValue = Math.abs(parseFloat(position?.positionValue || 0));
                          const pnl = parseFloat(position?.unrealizedPnl || 0);
                          totalHlPnL += pnl;
                          const entryNotional = Math.abs(szi) * entryPrice;
                          const marginUsed = entryNotional / leverage;
                          
                          rows.push({
                            asset: position.coin,
                            exchange: 'Hyperliquid',
                            amount: szi,
                            price: currentPrice, // Use current market price instead of entry price
                            value: notionalValue,
                            pnl: pnl,
                            entryPrice: entryPrice,
                            marginUsed: marginUsed,
                            isLeveraged: true
                          });
                        }
                      }
                    }
                    
                    // Add synthetic account equity position if available
                    if (hlAccountEquity !== null && hlAccountEquity > 0) {
                      rows.push({
                        asset: 'HL_ACCOUNT_EQUITY',
                        exchange: 'Hyperliquid',
                        amount: 1,
                        price: hlAccountEquity,
                        value: hlAccountEquity,
                        change24h: null,
                        pnl: totalHlPnL,
                        isHlAccountEquity: true,
                        isLeveraged: false
                      });
                    }
                    
                    return rows;
                  } catch (e) {
                    console.error('[Update] Failed to fetch HL positions:', e);
                    return [];
                  }
                })),
                
                // Lighter
                Promise.all(wallets.map(async (wallet) => {
                  try {
                    const lighter = providers.lighter;
                    const data = await lighter.fetchAccountByAddress(wallet, { timeoutMs: 8000 });
                    const rows = [];
                    
                    let lighterAccountEquity = null;
                    let totalLighterPnL = 0;
                    
                    if (data && data.accounts && Array.isArray(data.accounts) && data.accounts.length > 0) {
                      const account = data.accounts[0];
                      lighterAccountEquity = parseFloat(
                        account.equity_usd || 
                        account.total_equity || 
                        account.equity || 
                        account.balance_usd ||
                        account.total_balance ||
                        0
                      );
                      totalLighterPnL = parseFloat(
                        account.unrealized_pnl || 
                        account.pnl || 
                        account.total_pnl || 
                        0
                      );
                    }
                    
                    if (lighterAccountEquity !== null && lighterAccountEquity > 0) {
                      rows.push({
                        asset: 'LIGHTER_ACCOUNT_EQUITY',
                        exchange: 'Lighter',
                        amount: 1,
                        price: lighterAccountEquity,
                        value: lighterAccountEquity,
                        change24h: null,
                        pnl: totalLighterPnL,
                        isLighterAccountEquity: true,
                        isLeveraged: false
                      });
                    }
                    
                    return rows;
                  } catch (e) {
                    console.error('[Update] Failed to fetch Lighter account:', e);
                    return [];
                  }
                }))
              ]);
              
              // Flatten and create a map of fresh equity positions by asset
              const freshEquityPositions = [...hlResults.flat(), ...lighterResults.flat()];
              const equityMap = new Map();
              for (const pos of freshEquityPositions) {
                const key = `${pos.asset}_${pos.exchange}`;
                equityMap.set(key, pos);
              }
              
              // Update cachedPositions with fresh equity data
              hasEquityChanges = false;
              cachedPositions = cachedPositions.map(pos => {
                if (pos.isLeveraged || pos.isHlAccountEquity || pos.isLighterAccountEquity) {
                  const key = `${pos.asset}_${pos.exchange}`;
                  const freshPos = equityMap.get(key);
                  if (freshPos) {
                    // Check if PnL or value changed
                    const pnlChanged = Math.abs((freshPos.pnl || 0) - (pos.pnl || 0)) > 0.01;
                    const valueChanged = Math.abs((freshPos.value || 0) - (pos.value || 0)) > 0.01;
                    if (pnlChanged || valueChanged) {
                      hasEquityChanges = true;
                      // Preserve priceHistory and other chart-related data from existing position
                      return { ...freshPos, priceChanged: true, priceHistory: pos.priceHistory };
                    }
                  }
                }
                return pos;
              });
              
              // Don't recalculate portfolio here - will do it after ALL updates are done
              if (hasEquityChanges) {
                const changedEquity = cachedPositions.filter(p => (p.isLeveraged || p.isHlAccountEquity || p.isLighterAccountEquity) && p.priceChanged);
                console.log('[Update] Equity positions updated:', changedEquity.map(p => `${p.asset} ($${p.value?.toFixed(2)})`));
              }
            } catch (e) {
              console.error('[Update] Failed to refresh leveraged positions:', e);
            }
          }
        }
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
          // Also check tokens array - optimized O(n) with Map lookup
          if (spotMeta.tokens) {
            // Build lookup map for O(1) access instead of O(n) find()
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
        
        // Update positions with new prices
        const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'BUSD', 'FEUSD']);
        let hasChanges = false;
        const updatedPositions = cachedPositions.map(pos => {
          let newPrice = priceMap[pos.asset];
          
          // Skip leveraged positions - they are refreshed from API periodically
          // Leveraged PnL includes funding payments which can't be calculated from price alone
          // BUT preserve their priceChanged flag if it was set by equity update
          if (pos.isLeveraged) {
            return pos; // Keep as-is, including priceChanged flag from equity update
          }
          
          // Skip synthetic equity positions
          if (pos.isHlAccountEquity || pos.isLighterAccountEquity) {
            return pos; // Keep as-is, including priceChanged flag from equity update
          }
          
          // Stablecoins default to $1 if no price found
          if ((!newPrice || newPrice === 0) && STABLECOINS.has(pos.asset)) {
            newPrice = 1;
          }
          
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
        
        // Check if ANY positions have priceChanged flag set (from equity or wallet updates)
        const hasAnyPriceChanges = updatedPositions.some(p => p.priceChanged);
        let anyChanges = hasEquityChanges || hasChanges || hasAnyPriceChanges;
        
        // Always update cachedPositions to preserve priceChanged flags
        if (hasChanges || hasEquityChanges) {
          if (hasChanges) {
            console.log('[Update] Wallet prices updated');
          }
          cachedPositions = updatedPositions;
          
          // Update price history for changed positions (skip stablecoins) - ONLY if showPriceChart is enabled
          const Settings = window.AppModules?.core?.settings;
          const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
          const showPriceChart = s.showPriceChart ?? true;
          
          if (showPriceChart) {
            const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'BUSD']);
            const changedAssets = updatedPositions.filter(p => p.priceChanged && !STABLECOINS.has(p.asset?.toUpperCase()));
            
            if (changedAssets.length > 0) {
              // Update price history in background (don't await to avoid blocking UI)
              (async () => {
                try {
                  const pythFeedMap = await providers.pyth.getPriceFeeds(5000);
                  const historyUpdates = changedAssets.map(async (pos) => {
                    const feedId = pythFeedMap[pos.asset];
                    if (feedId && providers.pyth.get24hPriceHistory) {
                      try {
                        // Increased timeout for better reliability during price updates
                        const history = await providers.pyth.get24hPriceHistory(feedId, 6000);
                        if (history.length > 0) {
                          pos.priceHistory = history;
                          return true;
                        }
                      } catch (e) {
                        // Keep existing history on error
                        return false;
                      }
                    }
                    return false;
                  });
                  const results = await Promise.all(historyUpdates);
                  const successCount = results.filter(r => r).length;
                  
                  // Re-render positions to show updated charts (don't recalculate portfolio)
                  if (successCount > 0) {
                    const positionsBody = document.getElementById('newPositionsBody');
                    const mobileContainer = document.getElementById('newMobilePositionsContainer');
                    const PositionsUI = window.AppModules?.ui?.positions;
                    if (PositionsUI && positionsBody && cachedPositions.length > 0) {
                      const filtered = filterPositions(cachedPositions, { 
                        hideHidden: true, 
                        hideSmall: hideSmallPositions, 
                        threshold: s.minBalanceThreshold || 100 
                      });
                      PositionsUI.renderPositions({
                        positions: filtered,
                        containers: { positionsBody, mobilePositionsContainer: mobileContainer },
                        options: { 
                          amountsVisible: !document.body.classList.contains('amounts-hidden'), 
                          hideSmallPositions: false, 
                          editMode: false, 
                          settings: { 
                            minBalanceThreshold: s.minBalanceThreshold || 100, 
                            showExactAmounts: s.showExactAmounts || false, 
                            useColoredPnL: s.useColoredPnL ?? true, 
                            showPriceChart: s.showPriceChart ?? true 
                          } 
                        }
                      });
                    }
                  }
                } catch (e) {
                  // Silently fail history updates
                }
              })();
            }
          }
          
        }
        
        // Recalculate portfolio ONCE if ANY changes happened (equity or wallet prices)
        if (anyChanges) {
          console.log('[Update] Recalculating portfolio after all updates...');
          // Re-render positions and hero together
          rerenderPositions();
        }
      }
      
      // Update watchlist prices
      const s = getSettings();
      const watchlistBody = document.getElementById('newWatchlistBody');
      
      if (watchlistBody && s.watchlist && s.watchlist.length > 0 && !watchlistEditMode) {
        try {
          const mod = await import('./modules/features/watchlist.js');
          const prices = await mod.render(watchlistBody, {
            feedIds: s.watchlist,
            pythProvider: providers.pyth,
            useColoredPnL: s.useColoredPnL ?? true,
            editMode: false,
            previousData: cachedWatchlistData,
            showPriceChart: s.showPriceChart ?? true
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
  
  // Cleanup on page unload (prevent memory leaks)
  window.addEventListener('beforeunload', () => {
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }
    DOMCache.clear(); // Clear DOM element cache
  });
  
  // Resume updates when tab becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Tab hidden - pause updates to save resources
      if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
      }
    } else {
      // Tab visible again - resume updates
      if (!updateInterval) {
        updatePrices();
        updateInterval = setInterval(updatePrices, 5000);
      }
    }
  });
});