// Minimal alpha boot for the new modular dashboard

// ============================================================================
// VERSION CHECKING: Force reload if user is on old version
// ============================================================================
const APP_VERSION = '2.5.0';
const FORCE_UPDATE_KEY = 'viewport_last_version';

function checkVersion() {
  const lastVersion = localStorage.getItem(FORCE_UPDATE_KEY);
  
  if (lastVersion && lastVersion !== APP_VERSION) {
    console.log(`[Version] Updating from ${lastVersion} to ${APP_VERSION}`);
    
    // Clear all caches
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => caches.delete(name));
      });
    }
    
    // Store new version
    localStorage.setItem(FORCE_UPDATE_KEY, APP_VERSION);
    
    // Force hard reload (bypass cache)
    window.location.reload(true);
    return false; // Don't continue initialization
  }
  
  // Store version if first time
  if (!lastVersion) {
    localStorage.setItem(FORCE_UPDATE_KEY, APP_VERSION);
  }
  
  return true; // Continue initialization
}

// Check version immediately - if returns false, reload is happening
if (!checkVersion()) {
  throw new Error('Version update in progress, reloading...');
}

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

// Map asset symbols to CoinGecko IDs for 24h change data
function getCoingeckoId(assetSymbol) {
  const mapping = {
    'BTC': 'bitcoin',
    'ETH': 'ethereum',
    'SOL': 'solana',
    'ARB': 'arbitrum',
    'AVAX': 'avalanche-2',
    'MATIC': 'matic-network',
    'OP': 'optimism',
    'LINK': 'chainlink',
    'UNI': 'uniswap',
    'AAVE': 'aave',
    'MKR': 'maker',
    'SNX': 'synthetix-network-token',
    'CRV': 'curve-dao-token',
    'LDO': 'lido-dao',
    'DOGE': 'dogecoin',
    'XRP': 'ripple',
    'ADA': 'cardano',
    'DOT': 'polkadot',
    'ATOM': 'cosmos',
    'NEAR': 'near',
    'FIL': 'filecoin',
    'LTC': 'litecoin',
    'BCH': 'bitcoin-cash',
    'ETC': 'ethereum-classic',
    'XMR': 'monero',
    'APT': 'aptos',
    'SUI': 'sui',
    'SEI': 'sei-network',
    'TIA': 'celestia',
    'INJ': 'injective-protocol',
    'WIF': 'dogwifcoin',
    'BONK': 'bonk',
    'PEPE': 'pepe',
    'SHIB': 'shiba-inu',
    'WLD': 'worldcoin-wld',
    'RNDR': 'render-token',
    'IMX': 'immutable-x',
    'STX': 'blockstack',
    'FTM': 'fantom',
    'BLUR': 'blur',
    'MINA': 'mina-protocol',
    'SAND': 'the-sandbox',
    'MANA': 'decentraland',
    'AXS': 'axie-infinity',
    'GALA': 'gala',
    'ENJ': 'enjincoin',
    'CHZ': 'chiliz',
    'HBAR': 'hedera-hashgraph',
    'ALGO': 'algorand',
    'EOS': 'eos',
    'XTZ': 'tezos',
    'THETA': 'theta-token',
    'VET': 'vechain',
    'ICP': 'internet-computer',
    'ZEC': 'zcash',
    'KAVA': 'kava',
    'COMP': 'compound-governance-token',
    'SUSHI': 'sushi',
    'YFI': 'yearn-finance',
    'BAL': 'balancer',
    '1INCH': '1inch',
    'RUNE': 'thorchain',
    'HYPE': 'hyperliquid',
    'ONDO': 'ondo-finance',
    'PENDLE': 'pendle',
    'ENA': 'ethena',
    'EIGEN': 'eigenlayer',
    'TAO': 'bittensor',
    'JUP': 'jupiter-exchange-solana',
    'PYTH': 'pyth-network',
    'JTO': 'jito-governance-token',
    'TNSR': 'tensor',
    'W': 'wormhole',
    'STRK': 'starknet',
    'ORDI': 'ordinals',
    'SATS': 'sats-ordinals',
    'TRX': 'tron',
    'DYDX': 'dydx-chain',
    'GMX': 'gmx',
    'GRT': 'the-graph',
    'LRC': 'loopring',
    'ENS': 'ethereum-name-service',
    'APE': 'apecoin',
    'JASMY': 'jasmy',
    'QNT': 'quant-network',
    'ROSE': 'oasis-network',
    'FLOW': 'flow',
    'ONE': 'harmony',
    'ZIL': 'zilliqa',
    'BAT': 'basic-attention-token',
    'ZRX': '0x'
  };
  return mapping[assetSymbol] || null;
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
  
  const hasManualPositions = settings.cryptoPositions && Array.isArray(settings.cryptoPositions) && settings.cryptoPositions.length > 0;
  
  if (wallets.length === 0 && solanaAddrs.length === 0 && bitcoinAddrs.length === 0 && zcashAddrs.length === 0 && !hasManualPositions) {
    const summaryEl = document.getElementById('newSummary');
    const positionsBody = document.getElementById('newPositionsBody');
    if (summaryEl) summaryEl.innerHTML = 'Your portfolio is empty. Add wallets in Settings or add manual positions.';
    if (positionsBody) positionsBody.innerHTML = '<tr><td colspan="8" class="loading">No wallets or positions configured</td></tr>';
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
  if (hasManualPositions) {
    expectedProviders.push('Manual');
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
                
                // Add spot position PnL to total
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
          
          // Enrich positions with 24h change data from CoinGecko
          const uniqueAssets = [...new Set(rows.filter(r => !r.isHlAccountEquity).map(r => r.asset))];
          const coingeckoIds = uniqueAssets.map(asset => getCoingeckoId(asset)).filter(id => id !== null);
          
          if (coingeckoIds.length > 0) {
            try {
              const cgData = await providers.coingecko.getSimplePrice(coingeckoIds.join(','), { timeoutMs: 3000, ttlMs: 60000 });
              if (cgData) {
                // Create a reverse mapping from CoinGecko ID to asset symbol
                const idToAsset = {};
                for (const asset of uniqueAssets) {
                  const cgId = getCoingeckoId(asset);
                  if (cgId) idToAsset[cgId] = asset;
                }
                
                // Enrich each row with 24h change
                for (const row of rows) {
                  if (!row.isHlAccountEquity) {
                    const cgId = getCoingeckoId(row.asset);
                    if (cgId && cgData[cgId]) {
                      row.change24h = cgData[cgId].usd_24h_change || null;
                    }
                  }
                }
              }
            } catch (e) {
              // Continue without 24h change data if CoinGecko fails
            }
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
        
        // Enrich positions missing 24h change data with CoinGecko
        const missingChange24h = rows.filter(r => r.change24h === null);
        if (missingChange24h.length > 0) {
          const uniqueAssets = [...new Set(missingChange24h.map(r => r.asset))];
          const coingeckoIds = uniqueAssets.map(asset => getCoingeckoId(asset)).filter(id => id !== null);
          
          if (coingeckoIds.length > 0) {
            try {
              const cgData = await providers.coingecko.getSimplePrice(coingeckoIds.join(','), { timeoutMs: 3000, ttlMs: 60000 });
              if (cgData) {
                // Enrich rows that are missing change24h
                for (const row of rows) {
                  if (row.change24h === null) {
                    const cgId = getCoingeckoId(row.asset);
                    if (cgId && cgData[cgId]) {
                      row.change24h = cgData[cgId].usd_24h_change || null;
                    }
                  }
                }
              }
            } catch (e) {
              // Continue without 24h change data if CoinGecko fails
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
              
              // Enrich positions with 24h change data from CoinGecko
              const uniqueAssets = [...new Set(rows.map(r => r.asset))];
              const coingeckoIds = uniqueAssets.map(asset => getCoingeckoId(asset)).filter(id => id !== null);
              
              if (coingeckoIds.length > 0) {
                try {
                  const cgData = await providers.coingecko.getSimplePrice(coingeckoIds.join(','), { timeoutMs: 3000, ttlMs: 60000 });
                  if (cgData) {
                    // Enrich each row with 24h change
                    for (const row of rows) {
                      const cgId = getCoingeckoId(row.asset);
                      if (cgId && cgData[cgId]) {
                        row.change24h = cgData[cgId].usd_24h_change || null;
                      }
                    }
                  }
                } catch (e) {
                  // Continue without 24h change data if CoinGecko fails
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
  
  // 5. Manual positions from settings (cryptoPositions)
  if (settings.cryptoPositions && Array.isArray(settings.cryptoPositions) && settings.cryptoPositions.length > 0) {
    (async () => {
      try {
        const rows = [];
        const pythPositions = settings.cryptoPositions.filter(p => p.type === 'pyth');
        const customPositions = settings.cryptoPositions.filter(p => p.type === 'custom');
        
        // Fetch prices for Pyth positions
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
                  amount: amount,
                  price: currentPrice,
                  value: value,
                  change24h: null,
                  pnl: pnl,
                  entryPrice: entryPrice,
                  isManual: true,
                  manualType: 'pyth'
                });
              }
            } catch (e) {
              console.warn('[Portfolio] Failed to fetch Pyth prices for manual positions:', e);
            }
          }
        }
        
        // Add custom positions (no price fetch needed)
        for (const pos of customPositions) {
          const value = parseFloat(pos.value || 0);
          rows.push({
            asset: pos.name,
            exchange: 'Manual',
            amount: 1,
            price: value,
            value: value,
            change24h: null,
            pnl: null,
            isManual: true,
            manualType: 'custom'
          });
        }
        
        // Enrich Pyth positions with 24h change data from CoinGecko
        if (pythPositions.length > 0) {
          const uniqueAssets = [...new Set(pythPositions.map(p => p.symbol))];
          const coingeckoIds = uniqueAssets.map(asset => getCoingeckoId(asset)).filter(id => id !== null);
          
          if (coingeckoIds.length > 0) {
            try {
              const cgData = await providers.coingecko.getSimplePrice(coingeckoIds.join(','), { timeoutMs: 3000, ttlMs: 60000 });
              if (cgData) {
                for (const row of rows) {
                  if (row.manualType === 'pyth') {
                    const cgId = getCoingeckoId(row.asset);
                    if (cgId && cgData[cgId]) {
                      row.change24h = cgData[cgId].usd_24h_change || null;
                    }
                  }
                }
              }
            } catch (e) {
              // Continue without 24h change data if CoinGecko fails
            }
          }
        }
        
        renderer.appendPositions(rows, 'Manual');
      } catch (e) {
        console.error('[Portfolio] Failed to load manual positions:', e);
      }
    })();
  }
  
  // Initial render to show skeleton replaced by "Fetching..."
  renderer.render();
}

// OLD renderDemoSummary removed - replaced by renderPortfolioIncremental for performance

// Legacy function wrapper for compatibility
async function renderDemoSummary() {
  // Redirect to new incremental renderer
  return await renderPortfolioIncremental();
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
  syncMobileButtons('newHideSmallBtn', 'newHideSmallBtnMobile');
  
  // Toggle small positions
  const hideSmallBtn = document.getElementById('newHideSmallBtn');
  if (hideSmallBtn) {
    hideSmallBtn.addEventListener('click', () => {
      hideSmallPositions = !hideSmallPositions;
      window.hideSmallPositions = hideSmallPositions; // Update global for incremental renderer
      const threshold = settings.minBalanceThreshold || 100;
      hideSmallBtn.textContent = hideSmallPositions ? `[SHOW <$${threshold}]` : `[HIDE <$${threshold}]`;
      // Also update mobile button text
      const mobileHideSmallBtn = document.getElementById('newHideSmallBtnMobile');
      if (mobileHideSmallBtn) {
        mobileHideSmallBtn.textContent = hideSmallBtn.textContent;
      }
      // Call both renderers to support both incremental and full render modes
      if (window._portfolioRenderer) {
        window._portfolioRenderer.forceRender();
      } else {
        rerenderPositions();
      }
    });
    // Sync button text with initial state
    const mobileHideSmallBtn = document.getElementById('newHideSmallBtnMobile');
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
      
      const rendered = PositionsUI.renderPositions({
        positions: filtered,
        containers: { positionsBody, mobilePositionsContainer: mobileContainer },
        options: renderOptions,
        previousPositions: window._previousRenderData || []
      });
      window._previousRenderData = rendered; // Cache for flash detection
      
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
      window.editMode = editMode; // Update global for incremental renderer
      editListBtn.textContent = editMode ? '[SAVE CHANGES]' : '[EDIT]';
      
      // Re-render with edit mode - call both renderers to support both modes
      if (window._portfolioRenderer) {
        window._portfolioRenderer.forceRender();
      } else {
        rerenderPositions();
      }
      
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
              window.hiddenAssets = hiddenAssets; // Update global for incremental renderer
              
              // Save to localStorage
              const Settings = window.AppModules?.core?.settings;
              const s = getSettings();
              s.hiddenAssets = Array.from(hiddenAssets);
              localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
              invalidateSettingsCache();
              
              // Re-render - call both renderers to support both modes
              if (window._portfolioRenderer) {
                window._portfolioRenderer.forceRender();
              } else {
                rerenderPositions();
              }
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
                  window.hiddenAssets = hiddenAssets; // Update global for incremental renderer
                  
                  // Re-render without page reload - call both renderers to support both modes
                  if (window._portfolioRenderer) {
                    window._portfolioRenderer.forceRender();
                  } else {
                    rerenderPositions();
                  }
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
      const hideWatchlistInput = document.getElementById('newHideWatchlist');
      const hideComicInput = document.getElementById('newHideComic');
      const showExactAmountsInput = document.getElementById('newShowExactAmounts');
      const showPriceChartInput = document.getElementById('newShowPriceChart');
      const minBalanceInput = document.getElementById('newMinBalanceThreshold');
      const leftAlignedInput = document.getElementById('newLeftAligned');
      
      // Menu visibility controls
      const hideSnowBtnInput = document.getElementById('newHideSnowBtn');
      const hideRainBtnInput = document.getElementById('newHideRainBtn');
      const hideFontSizeInput = document.getElementById('newHideFontSize');
      const hideThemeBtnInput = document.getElementById('newHideThemeBtn');
      const hideAmountsBtnInput = document.getElementById('newHideAmountsBtn');
      const showCompactBtnInput = document.getElementById('newShowCompactBtn');
      const hideDonateBtnInput = document.getElementById('newHideDonateBtn');
      
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
      if (hideWatchlistInput) hideWatchlistInput.checked = s.hideWatchlist ?? false;
      if (hideComicInput) hideComicInput.checked = s.hideComic ?? false;
      if (showExactAmountsInput) showExactAmountsInput.checked = s.showExactAmounts ?? false;
      if (showPriceChartInput) showPriceChartInput.checked = s.showPriceChart ?? true;
      if (minBalanceInput) minBalanceInput.value = s.minBalanceThreshold || 100;
      if (leftAlignedInput) leftAlignedInput.checked = s.leftAligned ?? true;
      
      // Menu visibility checkboxes
      if (hideSnowBtnInput) hideSnowBtnInput.checked = s.hideSnowBtn ?? false;
      if (hideRainBtnInput) hideRainBtnInput.checked = s.hideRainBtn ?? false;
      if (hideFontSizeInput) hideFontSizeInput.checked = s.hideFontSize ?? false;
      if (hideThemeBtnInput) hideThemeBtnInput.checked = s.hideThemeBtn ?? false;
      if (hideAmountsBtnInput) hideAmountsBtnInput.checked = s.hideAmountsBtn ?? false;
      if (showCompactBtnInput) showCompactBtnInput.checked = s.showCompactBtn ?? true;
      if (hideDonateBtnInput) hideDonateBtnInput.checked = s.hideDonateBtn ?? false;
      
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
  
  // Force update button - clears all caches and reloads
  const forceUpdateBtn = document.getElementById('newForceUpdateBtn');
  if (forceUpdateBtn) {
    forceUpdateBtn.addEventListener('click', async () => {
      const originalText = forceUpdateBtn.textContent;
      forceUpdateBtn.textContent = '[CLEARING...]';
      forceUpdateBtn.disabled = true;
      
      try {
        // Clear all caches
        if ('caches' in window) {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map(name => caches.delete(name)));
        }
        
        // Send message to service worker to clear its cache
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.getRegistration();
          if (registration?.active) {
            registration.active.postMessage({ type: 'CLEAR_CACHE' });
          }
        }
        
        // Reset version to force reload on next visit
        localStorage.removeItem(FORCE_UPDATE_KEY);
        
        // Wait a moment for caches to clear
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Hard reload (bypass cache)
        window.location.reload(true);
      } catch (error) {
        console.error('[Force Update] Error:', error);
        forceUpdateBtn.textContent = '[ERROR - TRY AGAIN]';
        forceUpdateBtn.disabled = false;
        setTimeout(() => {
          forceUpdateBtn.textContent = originalText;
        }, 2000);
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
      const hideWatchlistInput = document.getElementById('newHideWatchlist');
      const hideComicInput = document.getElementById('newHideComic');
      const showExactAmountsInput = document.getElementById('newShowExactAmounts');
      const showPriceChartInput = document.getElementById('newShowPriceChart');
      const minBalanceInput = document.getElementById('newMinBalanceThreshold');
      const leftAlignedInput = document.getElementById('newLeftAligned');
      
      // Menu visibility controls
      const hideSnowBtnInput = document.getElementById('newHideSnowBtn');
      const hideRainBtnInput = document.getElementById('newHideRainBtn');
      const hideFontSizeInput = document.getElementById('newHideFontSize');
      const hideThemeBtnInput = document.getElementById('newHideThemeBtn');
      const hideAmountsBtnInput = document.getElementById('newHideAmountsBtn');
      const showCompactBtnInput = document.getElementById('newShowCompactBtn');
      const hideDonateBtnInput = document.getElementById('newHideDonateBtn');
      
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
      if (hideWatchlistInput) newSettings.hideWatchlist = hideWatchlistInput.checked;
      if (hideComicInput) newSettings.hideComic = hideComicInput.checked;
      if (showExactAmountsInput) newSettings.showExactAmounts = showExactAmountsInput.checked;
      if (showPriceChartInput) newSettings.showPriceChart = showPriceChartInput.checked;
      if (minBalanceInput) newSettings.minBalanceThreshold = parseFloat(minBalanceInput.value) || 100;
      if (leftAlignedInput) newSettings.leftAligned = leftAlignedInput.checked;
      
      // Save menu visibility settings
      if (hideSnowBtnInput) newSettings.hideSnowBtn = hideSnowBtnInput.checked;
      if (hideRainBtnInput) newSettings.hideRainBtn = hideRainBtnInput.checked;
      if (hideFontSizeInput) newSettings.hideFontSize = hideFontSizeInput.checked;
      if (hideThemeBtnInput) newSettings.hideThemeBtn = hideThemeBtnInput.checked;
      if (hideAmountsBtnInput) newSettings.hideAmountsBtn = hideAmountsBtnInput.checked;
      if (showCompactBtnInput) newSettings.showCompactBtn = showCompactBtnInput.checked;
      if (hideDonateBtnInput) newSettings.hideDonateBtn = hideDonateBtnInput.checked;
      
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
        body.classList.toggle('hide-snow-btn', newSettings.hideSnowBtn ?? false);
        body.classList.toggle('hide-rain-btn', newSettings.hideRainBtn ?? false);
        body.classList.toggle('hide-font-size', newSettings.hideFontSize ?? false);
        body.classList.toggle('hide-theme-btn', newSettings.hideThemeBtn ?? false);
        body.classList.toggle('hide-amounts-btn', newSettings.hideAmountsBtn ?? false);
        body.classList.toggle('hide-donate-btn', newSettings.hideDonateBtn ?? false);
        body.classList.toggle('hide-watchlist', newSettings.hideWatchlist ?? false);
        body.classList.toggle('hide-comic', newSettings.hideComic ?? false);
        
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
  
  // Display version immediately (using APP_VERSION constant)
  const versionDisplay = document.getElementById('versionDisplay');
  if (versionDisplay) {
    const buildDate = new Date('2025-11-14T22:00:00Z').toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit',
      timeZone: 'UTC'
    });
    versionDisplay.textContent = `v${APP_VERSION} (${buildDate} UTC)`;
  }
  
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
    body.classList.toggle('hide-snow-btn', settings.hideSnowBtn ?? false);
    body.classList.toggle('hide-rain-btn', settings.hideRainBtn ?? false);
    body.classList.toggle('hide-font-size', settings.hideFontSize ?? false);
    body.classList.toggle('hide-theme-btn', settings.hideThemeBtn ?? false);
    body.classList.toggle('hide-amounts-btn', settings.hideAmountsBtn ?? false);
    body.classList.toggle('hide-donate-btn', settings.hideDonateBtn ?? false);
    
    // Section visibility
    body.classList.toggle('hide-watchlist', settings.hideWatchlist ?? false);
    body.classList.toggle('hide-comic', settings.hideComic ?? false);
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
        if (!currentSettings.hideWatchlist) {
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
  if (!settings.hideComic && comicEl) {
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
  
  if (!settings.hideWatchlist && watchlistBody) {
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
      if (!providers) {
        console.warn('[updatePrices] No providers found');
        return;
      }
      
      updateCount++;
      const doLeveragedRefresh = true; // Refresh leveraged positions every 5 seconds
      let hasEquityChanges = false; // Track if equity positions changed
      
      // Read from window.cachedPositions which is updated by the renderer
      cachedPositions = window.cachedPositions || cachedPositions || [];
      
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
                    
                    // Calculate total PnL from all positions (perp + spot)
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
                    
                    // Add spot position PnL to total
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
              const updatedCachedPositions = cachedPositions.map(pos => {
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
                      return { ...freshPos, priceHistory: pos.priceHistory };
                    }
                  }
                }
                return pos;
              });
              
              cachedPositions = updatedCachedPositions;
              window.cachedPositions = updatedCachedPositions;
              
              // Don't recalculate portfolio here - will do it after ALL updates are done
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
          if (pos.isLeveraged) {
            return pos; // Keep as-is
          }
          
          // Skip synthetic equity positions
          if (pos.isHlAccountEquity || pos.isLighterAccountEquity) {
            return pos; // Keep as-is
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
              pnl: newPnl
            };
          }
          return pos;
        });
        
        // Update if anything changed
        let anyChanges = hasEquityChanges || hasChanges;
        
        if (anyChanges) {
          cachedPositions = updatedPositions;
          window.cachedPositions = updatedPositions;
          
          // Update price history for changed positions (skip stablecoins) - ONLY if showPriceChart is enabled
          const Settings = window.AppModules?.core?.settings;
          const s = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
          const showPriceChart = s.showPriceChart ?? true;
          
          if (showPriceChart) {
            const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'BUSD']);
            const changedAssets = updatedPositions.filter(p => !STABLECOINS.has(p.asset?.toUpperCase()));
            
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
                    if (window._portfolioRenderer && typeof window._portfolioRenderer.updatePositions === 'function') {
                      window._portfolioRenderer.updatePositions(cachedPositions);
                    } else if (rerenderPositions) {
                      rerenderPositions();
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
          // Re-render positions and hero together
          if (window._portfolioRenderer && typeof window._portfolioRenderer.updatePositions === 'function') {
            window._portfolioRenderer.updatePositions(cachedPositions);
          } else if (rerenderPositions) {
            rerenderPositions();
          }
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
      console.warn('[updatePrices] Failed:', e?.message || e);
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