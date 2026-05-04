// Minimal alpha boot for the new modular dashboard
import * as AssetMapping from './modules/utils/asset-mapping.js';
import * as Portfolio from './modules/domain/portfolio.js';
import { PortfolioManager } from './modules/domain/portfolio-manager.js';
import {
  getManualPositionAssetAliases,
  getManualPositionHiddenKeys,
  removeManualPositionByAsset,
  renderedManualPositionMatches,
  storedManualPositionMatches
} from './modules/features/manual-positions.js';
import { closeMobileMenuWithScroll } from './modules/ui/mobile-menu.js';
import { getRandomSpinner } from './modules/ui/unicode-animations.js';
import { formatMoney, normalizeBaseCurrency } from './modules/utils/currency.js';

// ============================================================================
// VERSION CHECKING
// ============================================================================
const APP_VERSION = '2.9.16';
const FORCE_UPDATE_KEY = 'viewport_last_version';

function checkVersion() {
  const lastVersion = localStorage.getItem(FORCE_UPDATE_KEY);

  if (lastVersion && lastVersion !== APP_VERSION) {
    localStorage.setItem(FORCE_UPDATE_KEY, APP_VERSION);

    // Clear all caches to ensure fresh content
    if ('caches' in window) {
      caches.keys().then(names => {
        Promise.all(names.map(name => caches.delete(name)));
      });
    }

    // Force service worker to update
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(reg => reg.update());
      });
    }
  }

  if (!lastVersion) {
    localStorage.setItem(FORCE_UPDATE_KEY, APP_VERSION);
  }

  return true;
}

checkVersion();

// Listen for service worker updates and auto-refresh
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
}

// ============================================================================
// SHARED STATE & UTILS
// ============================================================================

// Memoize settings
let cachedSettings = null;
let settingsTimestamp = 0;
const SETTINGS_CACHE_TTL = 5000;

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

// Another tab (or this tab via a different code path) may mutate settings. The `storage` event
// fires on *other* tabs; we still want same-tab writes to go through `invalidateSettingsCache()`,
// but this catches cross-tab drift automatically.
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', (e) => {
    if (e.key === 'myDashboardSettings.v2' || e.key === null) invalidateSettingsCache();
  });
}

// Re-export utilities for legacy compatibility if needed, or just use modules directly
const { getCoingeckoId } = AssetMapping;
const { calculatePortfolioTotals, filterPositions } = Portfolio;

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

// Wallet asset entry price management utilities (using centralized module)
// Wallet PnL utilities are available at window.walletPnLUtils (initialized in modules/app-init.js)
// Wallet PnL utilities available at window.walletPnLUtils (powered by centralized tracker)

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

  // Lighter
  try {
    // Avoid wallet-address probes here; they create noisy 400s for wallets without Lighter accounts.
    // Funding-rates endpoint is a stable health signal for Lighter API availability.
    const data = await providers.lighter.fetchFundingRates({ timeoutMs: 8000 });
    const ok = !!(data && typeof data === 'object');
    parts.push(`<span style="color: ${ok ? 'var(--green)' : 'var(--red)'};">●</span> Lighter`);
  } catch (e) {
    parts.push('<span style="color: var(--red);">●</span> Lighter');
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
// Track if a render is already in progress to prevent duplicate concurrent renders
let _renderInProgress = false;
let _pendingRenderRequest = false;

async function renderPortfolioIncremental() {
  // If a render is already in progress, mark that we need another render and return
  if (_renderInProgress) {
    _pendingRenderRequest = true;
    return;
  }

  _renderInProgress = true;
  _pendingRenderRequest = false;

  try {
    await _doRenderPortfolioIncremental();
  } finally {
    _renderInProgress = false;

    // If another render was requested while we were running, start it now
    if (_pendingRenderRequest) {
      _pendingRenderRequest = false;
      renderPortfolioIncremental();
    }
  }
}

async function _doRenderPortfolioIncremental() {
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
  const hasIbkr = settings.ibkrEnabled && settings.ibkrGatewayUrl;

  if (wallets.length === 0 && solanaAddrs.length === 0 && bitcoinAddrs.length === 0 && zcashAddrs.length === 0 && !hasManualPositions && !hasIbkr) {
    const summaryEl = document.getElementById('newSummary');
    const positionsBody = document.getElementById('newPositionsBody');
    if (summaryEl) summaryEl.innerHTML = 'Your portfolio is empty. Add wallets in Settings or add manual positions.';
    if (positionsBody) positionsBody.innerHTML = '<tr><td colspan="9" class="loading">No wallets or positions configured</td></tr>';
    return;
  }

  // Build list of expected providers based on configuration
  const expectedProviders = [];
  if (wallets.length > 0) {
    expectedProviders.push('Hyperliquid', 'Lighter');
    // Check which onchain provider to use
    const onchainProvider = settings.onchainProvider || 'zerion';
    if (onchainProvider === 'cielo' && settings.cieloApiKey) {
      expectedProviders.push('Cielo');
    } else if (onchainProvider === 'zerion' && settings.zerionApiKey) {
      expectedProviders.push('Zerion');
    } else if (settings.zerionApiKey) {
      // Fallback to Zerion if configured
      expectedProviders.push('Zerion');
    } else if (settings.cieloApiKey) {
      // Fallback to Cielo if configured
      expectedProviders.push('Cielo');
    } else if (settings.alchemyApiKey || settings.heliusApiKey) {
      expectedProviders.push('Alchemy/Helius');
    }
  }
  if (bitcoinAddrs.length > 0 || zcashAddrs.length > 0) {
    expectedProviders.push('Bitcoin/Zcash');
  }
  if (hasIbkr) {
    expectedProviders.push('IBKR');
  }
  if (hasManualPositions) {
    expectedProviders.push('Manual');
  }

  // Fetch weather data (non-blocking, will be used in hero summary)
  (async () => {
    try {
      const weatherLat = settings.weather?.lat;
      const weatherLon = settings.weather?.lon;
      const weatherLabel = settings.weather?.label || 'your location';

      const hasWeatherCoords = Number.isFinite(Number(weatherLat)) && Number.isFinite(Number(weatherLon));
      if (hasWeatherCoords && mods.features?.weather?.fetchWeather) {
        const data = await mods.features.weather.fetchWeather(Number(weatherLat), Number(weatherLon), 5000);
        if (data?.current) {
          const temp = data.current.temperature_2m;
          const code = data.current.weather_code || 0;
          const isDay = data.current.is_day === 1;

          // Weather icon
          let icon = '☁︎';
          if (code === 0) icon = isDay ? '☀︎' : '☾';
          else if (code <= 3) icon = '☁︎';
          else if (code <= 49) icon = '☁︎';
          else if (code <= 67) icon = '⛆';
          else if (code <= 77) icon = '❆';
          else if (code <= 82) icon = '⛆';
          else if (code <= 86) icon = '❆';
          else if (code <= 99) icon = '⛆';

          // Moon phase
          const knownNewMoon = new Date('2000-01-06T00:00:00Z');
          const now = new Date();
          const days = (now - knownNewMoon) / (1000 * 60 * 60 * 24);
          const cycle = 29.53058867;
          const phase = (days % cycle) / cycle;

          let moonIcon = '', moonName = '';
          if (phase < 0.0625) { moonIcon = '○'; moonName = 'new moon'; }
          else if (phase < 0.1875) { moonIcon = '☽'; moonName = 'waxing crescent'; }
          else if (phase < 0.3125) { moonIcon = '◐'; moonName = 'first quarter'; }
          else if (phase < 0.4375) { moonIcon = '◐'; moonName = 'waxing gibbous'; }
          else if (phase < 0.5625) { moonIcon = '●'; moonName = 'full moon'; }
          else if (phase < 0.6875) { moonIcon = '◑'; moonName = 'waning gibbous'; }
          else if (phase < 0.8125) { moonIcon = '◑'; moonName = 'last quarter'; }
          else if (phase < 0.9375) { moonIcon = '☾'; moonName = 'waning crescent'; }
          else { moonIcon = '○'; moonName = 'new moon'; }

          const hour = now.getHours();
          const showMoon = hour >= 18 || hour < 6;
          // Avoid "new moon moon" / "full moon moon": moonName already contains "moon" for
          // the cardinal phases, so only append the word for the crescent/gibbous/quarter ones.
          const moonSuffix = moonName.endsWith('moon') ? '' : ' moon';
          const moonText = showMoon ? ` with a ${moonIcon} ${moonName}${moonSuffix}` : '';

          const precipitation = data.daily?.precipitation_sum?.[0] || 0;

          cachedWeather = {
            temp,
            city: weatherLabel,
            icon,
            moonText,
            precipitation
          };
          window.cachedWeather = cachedWeather; // Update global reference

          // Trigger a hero update via renderer (single source of truth for portfolio totals)
          // The renderer already reads window.cachedWeather and has the authoritative positions
          if (window._portfolioRenderer && window._portfolioRenderer.allPositions.length > 0) {
            window._portfolioRenderer.render();
          }
        }
      }
    } catch (err) {
      console.warn('[Weather] Failed to fetch weather:', err);
    }
  })();

  // Initialize Portfolio Manager and Fetchers (Singleton pattern)
  if (!window._portfolioManager) {
    const { HyperliquidFetcher } = await import('./modules/data/fetchers/hyperliquid-fetcher.js');
    const { LighterFetcher } = await import('./modules/data/fetchers/lighter-fetcher.js');
    const { ZerionFetcher } = await import('./modules/data/fetchers/zerion-fetcher.js');
    const { CieloFetcher } = await import('./modules/data/fetchers/cielo-fetcher.js');
    const { AlchemyHeliusFetcher } = await import('./modules/data/fetchers/alchemy-helius-fetcher.js');
    const { BitcoinZcashFetcher } = await import('./modules/data/fetchers/bitcoin-fetcher.js');
    const { IbkrFetcher } = await import('./modules/data/fetchers/ibkr-fetcher.js');
    const { ManualFetcher } = await import('./modules/data/fetchers/manual-fetcher.js');

    const renderer = new IncrementalPortfolioRenderer({
      providers,
      settings,
      containers: {
        positionsBody: document.getElementById('newPositionsBody'),
        mobileContainer: document.getElementById('newMobilePositionsContainer'),
        summaryEl: document.getElementById('newSummary'),
        providerStatusEl: document.getElementById('newProviderStatus')
      },
      ui: { HeroUI, PositionsUI },
      expectedProviders
    });

    // Make renderer globally available for updates
    window._portfolioRenderer = renderer;

    const manager = new PortfolioManager(renderer, providers, settings);
    manager.registerFetcher('Hyperliquid', new HyperliquidFetcher(providers, renderer, settings));
    manager.registerFetcher('Lighter', new LighterFetcher(providers, renderer));
    manager.registerFetcher('Zerion', new ZerionFetcher(providers, renderer, settings));
    manager.registerFetcher('Cielo', new CieloFetcher(providers, renderer, settings));
    manager.registerFetcher('AlchemyHelius', new AlchemyHeliusFetcher(providers, renderer, settings));
    manager.registerFetcher('BitcoinZcash', new BitcoinZcashFetcher(providers, renderer));
    manager.registerFetcher('IBKR', new IbkrFetcher(providers, renderer, settings));
    manager.registerFetcher('Manual', new ManualFetcher(providers, renderer, settings));

    window._portfolioManager = manager;
  } else {
    // Update settings if needed
    window._portfolioManager.settings = settings;
    window._portfolioManager.renderer.settings = settings;
    window._portfolioManager.renderer.expectedProviders = expectedProviders;
    Object.values(window._portfolioManager.fetchers || {}).forEach(fetcher => {
      if (fetcher && 'settings' in fetcher) fetcher.settings = settings;
    });
  }

  // Trigger Fetch
  window._portfolioManager.fetchAll(wallets, solanaAddrs, bitcoinAddrs, zcashAddrs);



  // Initial render to show skeleton replaced by "Fetching..."
  window._portfolioRenderer.render();
}

// OLD renderDemoSummary removed - replaced by renderPortfolioIncremental for performance

let amountsVisible = true; // Default: show values
let compactMode = true; // Default: compact mode
let editMode = false;
let hideSmallPositions = true; // Default: hide positions under $100
// Restore the "show hidden positions" toggle from settings so users don't have to click it
// on every page load. Fall back to false (the historical default) when not yet saved.
let showHiddenPositions = (() => {
  try { return !!getSettings().showHiddenPositions; } catch { return false; }
})();
let hiddenAssets = new Set();
let cachedPositions = [];
let cachedSummaryData = {};
let cachedWeather = null; // Cache weather data globally to preserve across re-renders
let cachedWatchlistData = null; // Cache watchlist data globally
let watchlistEditMode = false;

let currentFontSize = 15; // Default font size in px

// Expose to window for incremental renderer
window.hideSmallPositions = hideSmallPositions;
window.showHiddenPositions = showHiddenPositions;
window.hiddenAssets = hiddenAssets;
window.editMode = editMode;
window.cachedPositions = cachedPositions;
window.cachedWeather = cachedWeather;
window.cachedSummaryData = cachedSummaryData;




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

function applyFont(fontName) {
  const body = document.body;
  body.classList.remove('font-commit', 'font-departure');

  if (fontName === 'commit') {
    body.classList.add('font-commit');
  } else if (fontName === 'departure') {
    body.classList.add('font-departure');
  }
}

// ============================================================================
// PULL TO REFRESH (Mobile Only)
// ============================================================================
function setupPullToRefresh() {
  const pullToRefreshEl = document.getElementById('pullToRefresh');
  const mainContent = document.getElementById('mainContent');
  if (!pullToRefreshEl || !mainContent) return;

  // Only enable on mobile (870px breakpoint matches CSS)
  const isMobile = () => window.innerWidth <= 870;

  // State
  let startX = 0;
  let startY = 0;
  let pulling = false;
  let directionLocked = false;
  let isHorizontalScroll = false;

  // Config
  const PULL_THRESHOLD = 50; // Screen px needed to trigger refresh
  const MAX_PULL = 100; // Max screen translation
  const RESISTANCE = 0.4; // Lower = harder to pull (0.4 means 40% of finger movement)
  const DIRECTION_LOCK_THRESHOLD = 10; // px before locking direction

  // Simple resistance: constant ratio with slight curve at the end
  const calcPull = (fingerDistance) => {
    if (fingerDistance <= 0) return 0;
    const pull = fingerDistance * RESISTANCE;
    // Add slight extra resistance as we approach max
    if (pull > MAX_PULL * 0.7) {
      const overage = pull - MAX_PULL * 0.7;
      return MAX_PULL * 0.7 + overage * 0.3;
    }
    return Math.min(pull, MAX_PULL);
  };

  // Check if touch is inside a modal or interactive element that shouldn't trigger PTR
  const shouldIgnorePTR = (target) => {
    // Check if any modal/dialog/backdrop is visible
    const settingsDialog = document.getElementById('newSettingsDialog');
    const stickerWindow = document.getElementById('stickerWindow');
    const mobileMenu = document.getElementById('newMobileMenu');
    const settingsBackdrop = document.getElementById('newSettingsBackdrop');
    const stickerBackdrop = document.getElementById('stickerBackdrop');

    // Check if settings is open
    if (settingsDialog && settingsDialog.style.display !== 'none') return true;
    if (settingsBackdrop && settingsBackdrop.style.display !== 'none') return true;

    // Check if sticker window is open
    if (stickerWindow && stickerWindow.style.display !== 'none') return true;
    if (stickerBackdrop && stickerBackdrop.style.display !== 'none') return true;

    // Check if mobile menu is open
    if ((mobileMenu && mobileMenu.classList.contains('active')) || document.body.classList.contains('mobile-menu-open')) return true;

    // Check if touching any interactive elements (stickers, modal contents)
    if (target.closest('.sticker-controls, .placed-sticker, #stickerGrid, .settings, .sticker-window, .mobile-menu, .settings-backdrop')) {
      return true;
    }

    return false;
  };

  let ptrBlocked = false; // Flag set at touchstart if we should ignore this gesture

  document.addEventListener('touchstart', (e) => {
    if (!isMobile()) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    pulling = false;
    directionLocked = false;
    isHorizontalScroll = false;
    // Block PTR for entire gesture if starting on an excluded element
    ptrBlocked = shouldIgnorePTR(e.target);
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!isMobile()) return;

    // Don't interfere with modals or sticker interactions - check flag AND current target
    if (ptrBlocked || shouldIgnorePTR(e.target)) return;

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = Math.abs(currentX - startX);
    const deltaY = currentY - startY;

    // Determine scroll direction if not locked yet
    if (!directionLocked && (deltaX > DIRECTION_LOCK_THRESHOLD || Math.abs(deltaY) > DIRECTION_LOCK_THRESHOLD)) {
      // If horizontal movement is greater, this is a horizontal scroll
      isHorizontalScroll = deltaX > Math.abs(deltaY);
      directionLocked = true;
    }

    // Don't activate pull-to-refresh during horizontal scrolling
    if (isHorizontalScroll) return;

    // Only activate pull-to-refresh when:
    // 1. At top of page (scrollY === 0)
    // 2. Pulling DOWN (deltaY > 0)
    // 3. Have moved at least 10px vertically
    // 4. Not horizontal scrolling
    if (window.scrollY === 0 && deltaY > 10 && !isHorizontalScroll) {
      // Prevent native iOS bounce
      e.preventDefault();

      pulling = true;
      const translateY = calcPull(deltaY);

      mainContent.classList.add('pulling-active');
      mainContent.style.transform = `translateY(${translateY}px)`;

      // Show indicator when past a small threshold
      if (translateY > 15) {
        pullToRefreshEl.classList.add('visible');
      }
    } else if (pulling && window.scrollY > 0) {
      // If we started pulling but user scrolled up, cancel
      cancelPull();
    }
  }, { passive: false });

  document.addEventListener('touchend', () => {
    if (!isMobile() || !pulling) return;

    const finalPullY = parseFloat(mainContent.style.transform.replace(/[^0-9.-]/g, '')) || 0;

    // Trigger refresh if pulled enough
    if (finalPullY >= PULL_THRESHOLD) {
      triggerRefresh();
    }

    // Always animate back
    snapBack();
  }, { passive: true });

  function cancelPull() {
    pulling = false;
    mainContent.classList.remove('pulling-active');
    mainContent.style.transform = '';
    pullToRefreshEl.classList.remove('visible');
  }

  function snapBack() {
    mainContent.classList.remove('pulling-active');
    mainContent.classList.add('snapping-back');

    requestAnimationFrame(() => {
      mainContent.style.transform = 'translateY(0)';

      setTimeout(() => {
        pullToRefreshEl.classList.remove('visible');
        mainContent.style.transform = '';
        mainContent.classList.remove('snapping-back');
        pulling = false;
      }, 300);
    });
  }

  function triggerRefresh() {
    if (window._portfolioRenderer && window._portfolioManager) {
      window._portfolioRenderer.clearPositions();

      const settings = getSettings();
      const wallets = (settings.walletAddresses || '').split(',').map(w => w.trim()).filter(Boolean);
      const solanaAddrs = (settings.solanaAddresses || '').split(',').map(a => a.trim()).filter(Boolean);
      const bitcoinAddrs = (settings.bitcoinAddresses || '').split(',').map(a => a.trim()).filter(Boolean);
      const zcashAddrs = (settings.zcashAddresses || '').split(',').map(a => a.trim()).filter(Boolean);

      window._portfolioManager.fetchAll(wallets, solanaAddrs, bitcoinAddrs, zcashAddrs);
    }
  }
}


function setupControls() {
  const settings = getSettings();

  // Apply saved font
  applyFont(settings.font || 'system');



  // Load hidden assets from settings
  const savedHidden = settings.hiddenAssets || [];
  hiddenAssets = new Set(savedHidden);

  // Cleanup: Remove any manual positions that are in hiddenAssets
  // (users might think hiding = deleting for manual positions)
  let needsSave = false;
  if (settings.cryptoPositions && Array.isArray(settings.cryptoPositions) && settings.cryptoPositions.length > 0) {
    const originalCount = settings.cryptoPositions.length;
    settings.cryptoPositions = settings.cryptoPositions.filter(p => {
      const assetNames = getManualPositionAssetAliases(p);
      if (assetNames.length === 0) return true;
      const manualKeys = assetNames.flatMap(getManualPositionHiddenKeys);
      const hiddenKey = manualKeys.find(key => hiddenAssets.has(key));
      if (hiddenKey) {
        // Hidden manual position removed
        manualKeys.forEach(key => hiddenAssets.delete(key)); // Also remove all variants from hiddenAssets
      }
      return !hiddenKey;
    });

    if (settings.cryptoPositions.length !== originalCount) {
      needsSave = true;
      settings.hiddenAssets = Array.from(hiddenAssets);
    }
  }

  // Save if we cleaned up anything
  if (needsSave) {
    localStorage.setItem('myDashboardSettings.v2', JSON.stringify(settings));
    invalidateSettingsCache();
    // Cleanup completed
  }

  // Mobile menu
  const mobileMenuBtn = document.getElementById('newMobileMenuBtn');
  const mobileMenu = document.getElementById('newMobileMenu');
  const closeMobileMenuBtn = document.getElementById('newCloseMobileMenuBtn');

  if (mobileMenuBtn && mobileMenu) {
    mobileMenuBtn.addEventListener('click', () => {
      const scrollY = window.scrollY;
      mobileMenu.classList.add('active');
      document.body.classList.add('mobile-menu-open');

      // Disable scroll when mobile menu open
      document.body.classList.add('modal-open');
      // Preserve current visual position while body is fixed
      document.body.style.top = `-${scrollY}px`;
    });
  }

  if (closeMobileMenuBtn && mobileMenu) {
    closeMobileMenuBtn.addEventListener('click', () => {
      closeMobileMenuWithScroll();
    });
  }

  // Sync mobile buttons with desktop
  const syncMobileButtons = (desktopId, mobileId, action) => {
    const desktop = document.getElementById(desktopId);
    const mobile = document.getElementById(mobileId);
    if (mobile && desktop) {
      mobile.addEventListener('click', () => {
        closeMobileMenuWithScroll();
        desktop.click();
      });
    }
  };

  syncMobileButtons('newToggleAmountsBtn', 'newToggleAmountsBtnMobile');
  syncMobileButtons('newCompactModeBtn', 'newCompactModeBtnMobile');

  syncMobileButtons('newSettingsBtn', 'newSettingsBtnMobile');

  // Show Hidden Positions toggle (shows <$100 positions and manually hidden)
  const showHiddenBtn = document.getElementById('newShowHiddenBtn');
  const threshold = settings.minBalanceThreshold || 100;

  function updateShowHiddenButton() {
    if (showHiddenBtn) {
      const s = getSettings();
      const thresholdValue = Number(s.minBalanceThreshold || threshold);
      const baseCurrency = normalizeBaseCurrency(s.portfolioBaseCurrency);
      const thresholdLabel = formatMoney(thresholdValue, {
        currency: baseCurrency,
        visible: true,
        compact: false
      });
      showHiddenBtn.textContent = showHiddenPositions ? `Hide <${thresholdLabel}` : `Show <${thresholdLabel}`;
    }
  }

  // Initial update
  updateShowHiddenButton();
  // Make function available globally for updates when hiddenAssets changes
  window.updateShowHiddenButton = updateShowHiddenButton;

  if (showHiddenBtn) {
    showHiddenBtn.addEventListener('click', () => {
      showHiddenPositions = !showHiddenPositions;
      window.showHiddenPositions = showHiddenPositions;
      updateShowHiddenButton();

      // Persist so the choice survives a reload.
      try {
        const s = getSettings();
        s.showHiddenPositions = showHiddenPositions;
        localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
        invalidateSettingsCache();
      } catch (e) {
        console.warn('[Settings] Failed to persist showHiddenPositions:', e);
      }

      // Force re-render
      if (window._portfolioRenderer) {
        window._portfolioRenderer.forceRender();
      }
    });
  }

  // Edit list mode
  const editListBtn = document.getElementById('newEditListBtn');
  const cancelEditBtn = document.getElementById('newCancelEditBtn');
  const positionsBody = document.getElementById('newPositionsBody');
  let editModeSnapshot = null; // Store state before edit mode for cancel functionality
  const handlePositionEditClick = (e) => {
    if (!editMode) return;

    if (e.target.classList.contains('position-edit-btn')) {
      const assetKey = e.target.getAttribute('data-asset-key');
      if (hiddenAssets.has(assetKey)) {
        hiddenAssets.delete(assetKey);
      } else {
        hiddenAssets.add(assetKey);
      }
      window.hiddenAssets = hiddenAssets; // Update global for incremental renderer

      // Save to localStorage
      const s = getSettings();
      s.hiddenAssets = Array.from(hiddenAssets);
      localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
      invalidateSettingsCache();

      // Update show hidden button visibility
      if (window.updateShowHiddenButton) {
        window.updateShowHiddenButton();
      }

      // Re-render
      if (window._portfolioRenderer) {
        window._portfolioRenderer.forceRender();
      }
    } else if (e.target.classList.contains('position-delete-btn')) {
      // Delete manual position
      const asset = e.target.getAttribute('data-asset');
      const manualType = e.target.getAttribute('data-manual-type');

      const s = getSettings();
      if (s.cryptoPositions && Array.isArray(s.cryptoPositions)) {
        s.cryptoPositions = removeManualPositionByAsset(s.cryptoPositions, asset, manualType);

        // Also remove from hiddenAssets if present (so it doesn't linger as hidden)
        const manualKeys = getManualPositionHiddenKeys(asset);
        if (s.hiddenAssets && Array.isArray(s.hiddenAssets)) {
          s.hiddenAssets = s.hiddenAssets.filter(key => !manualKeys.includes(key));
        }

        // Save
        localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
        invalidateSettingsCache();

        // Also remove from hiddenAssets set in memory
        manualKeys.forEach(key => hiddenAssets.delete(key));
        window.hiddenAssets = hiddenAssets; // Update global for incremental renderer

        // Remove position from renderer's allPositions (the source of truth)
        if (window._portfolioRenderer) {
          window._portfolioRenderer.removePositions(p => renderedManualPositionMatches(p, asset, manualType));
        }
      }
    } else if (e.target.classList.contains('position-manual-edit-btn')) {
      const asset = e.target.getAttribute('data-asset');
      const manualType = e.target.getAttribute('data-manual-type');
      openManualPositionEdit(asset, manualType);
    } else if (e.target.classList.contains('position-restore-btn')) {
      // Restore hidden position (remove from hiddenAssets)
      const assetKey = e.target.getAttribute('data-asset-key');
      hiddenAssets.delete(assetKey);
      window.hiddenAssets = hiddenAssets;

      // Save to localStorage
      const s = getSettings();
      s.hiddenAssets = Array.from(hiddenAssets);
      localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
      invalidateSettingsCache();

      // Update show hidden button visibility
      if (window.updateShowHiddenButton) {
        window.updateShowHiddenButton();
      }

      // Re-render
      if (window._portfolioRenderer) {
        window._portfolioRenderer.forceRender();
      }
    }
  };

  if (editListBtn) {
    editListBtn.addEventListener('click', () => {
      if (!editMode) {
        // Entering edit mode - take snapshot
        editModeSnapshot = {
          hiddenAssets: new Set(hiddenAssets)
        };
      }

      editMode = !editMode;
      window.editMode = editMode; // Update global for incremental renderer
      editListBtn.textContent = editMode ? 'Save' : 'Edit';

      // Show/hide cancel button
      if (cancelEditBtn) {
        cancelEditBtn.style.display = editMode ? 'inline' : 'none';
      }

      if (positionsBody) {
        if (editMode) {
          positionsBody.addEventListener('click', handlePositionEditClick);
        } else {
          positionsBody.removeEventListener('click', handlePositionEditClick);
        }
      }

      // Re-render with edit mode
      if (window._portfolioRenderer) {
        window._portfolioRenderer.forceRender();
      }
    });
  }

  // Cancel edit mode - restore snapshot
  if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', () => {
      if (editModeSnapshot) {
        // Restore hidden assets from snapshot
        hiddenAssets = new Set(editModeSnapshot.hiddenAssets);
        window.hiddenAssets = hiddenAssets;

        // Save restored state
        const s = getSettings();
        s.hiddenAssets = Array.from(hiddenAssets);
        localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
        invalidateSettingsCache();
      }

      // Exit edit mode
      editMode = false;
      window.editMode = editMode;
      editListBtn.textContent = 'Edit';
      cancelEditBtn.style.display = 'none';
      if (positionsBody) {
        positionsBody.removeEventListener('click', handlePositionEditClick);
      }

      // Re-render
      if (window._portfolioRenderer) {
        window._portfolioRenderer.forceRender();
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
      amountsBtn.textContent = amountsVisible ? 'Hide Amounts' : 'Show Amounts';

      // Also update mobile button text
      const mobileAmountsBtn = document.getElementById('newToggleAmountsBtnMobile');
      if (mobileAmountsBtn) {
        mobileAmountsBtn.textContent = amountsBtn.textContent;
      }

      // Toggle class for renderer detection
      document.body.classList.toggle('amounts-hidden', !amountsVisible);

      // Re-render with new visibility
      if (window._portfolioRenderer) {
        window._portfolioRenderer.forceRender();
      }
    });
  }

  // Toggle compact mode (just controls padding/styling, column order is always the same)
  const compactBtn = document.getElementById('newCompactModeBtn');
  if (compactBtn) {
    compactBtn.addEventListener('click', () => {
      compactMode = !compactMode;
      compactBtn.textContent = compactMode ? 'Expand' : 'Compact';

      // Toggle compact mode class - CSS handles padding and column visibility
      document.body.classList.toggle('compact-mode', compactMode);
      document.querySelectorAll('.data-table').forEach(table => {
        table.classList.toggle('compact-mode', compactMode);
      });
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
      const cieloInput = document.getElementById('newCieloApiKey');
      const onchainProviderInput = document.getElementById('newOnchainProvider');
      const alchemyInput = document.getElementById('newAlchemyApiKey');
      const heliusInput = document.getElementById('newHeliusApiKey');
      const openseaInput = document.getElementById('newOpenSeaApiKey');
      const ibkrEnabledInput = document.getElementById('newIbkrEnabled');
      const ibkrGatewayUrlInput = document.getElementById('newIbkrGatewayUrl');
      const ibkrAccountIdsInput = document.getElementById('newIbkrAccountIds');
      const cityInput = document.getElementById('newWeatherCity');
      const latInput = document.getElementById('newWeatherLat');
      const lonInput = document.getElementById('newWeatherLon');
      const coloredPnLInput = document.getElementById('newUseColoredPnL');
      const hideWatchlistInput = document.getElementById('newHideWatchlist');
      const hideComicInput = document.getElementById('newHideComic');
      const showExactAmountsInput = document.getElementById('newShowExactAmounts');
      const showPriceChartInput = document.getElementById('newShowPriceChart');
      const minBalanceInput = document.getElementById('newMinBalanceThreshold');
      const fontSelectInput = document.getElementById('newFontSelect');
      const portfolioBaseCurrencyInput = document.getElementById('newPortfolioBaseCurrency');

      // Menu visibility controls
      const hideSnowBtnInput = document.getElementById('newHideSnowBtn');
      const hideRainBtnInput = document.getElementById('newHideRainBtn');
      const hideFontSizeInput = document.getElementById('newHideFontSize');
      const hideThemeBtnInput = document.getElementById('newHideThemeBtn');
      const hideAmountsBtnInput = document.getElementById('newHideAmountsBtn');
      const showCompactBtnInput = document.getElementById('newShowCompactBtn');
      const hideDonateBtnInput = document.getElementById('newHideDonateBtn');
      const hideStickersBtnInput = document.getElementById('newHideStickersBtn');

      if (userNameInput) userNameInput.value = s.userName || '';
      if (walletInput) walletInput.value = s.walletAddresses || '';
      if (solanaInput) solanaInput.value = s.solanaAddresses || '';
      if (bitcoinInput) bitcoinInput.value = s.bitcoinAddresses || '';
      if (zcashInput) zcashInput.value = s.zcashAddresses || '';
      if (zerionInput) zerionInput.value = s.zerionApiKey || '';
      if (cieloInput) cieloInput.value = s.cieloApiKey || '';
      if (onchainProviderInput) onchainProviderInput.value = s.onchainProvider || 'zerion';
      if (alchemyInput) alchemyInput.value = s.alchemyApiKey || '';
      if (heliusInput) heliusInput.value = s.heliusApiKey || '';
      if (openseaInput) openseaInput.value = s.openSeaApiKey || '';
      if (ibkrEnabledInput) ibkrEnabledInput.checked = s.ibkrEnabled ?? false;
      if (ibkrGatewayUrlInput) ibkrGatewayUrlInput.value = s.ibkrGatewayUrl || 'https://localhost:5000/v1/api';
      if (ibkrAccountIdsInput) ibkrAccountIdsInput.value = s.ibkrAccountIds || '';
      if (cityInput) cityInput.value = s.weather?.label || '';
      if (latInput) latInput.value = s.weather?.lat ?? '';
      if (lonInput) lonInput.value = s.weather?.lon ?? '';
      if (coloredPnLInput) coloredPnLInput.checked = s.useColoredPnL ?? false;
      if (hideWatchlistInput) hideWatchlistInput.checked = s.hideWatchlist ?? false;
      if (hideComicInput) hideComicInput.checked = s.hideComic ?? false;
      if (showExactAmountsInput) showExactAmountsInput.checked = s.showExactAmounts ?? false;
      if (showPriceChartInput) showPriceChartInput.checked = s.showPriceChart ?? true;
      if (minBalanceInput) minBalanceInput.value = s.minBalanceThreshold || 100;
      if (fontSelectInput) fontSelectInput.value = s.font || 'system';
      if (portfolioBaseCurrencyInput) portfolioBaseCurrencyInput.value = s.portfolioBaseCurrency || 'USD';


      // Menu visibility checkboxes
      if (hideSnowBtnInput) hideSnowBtnInput.checked = s.hideSnowBtn ?? true;
      if (hideRainBtnInput) hideRainBtnInput.checked = s.hideRainBtn ?? true;
      if (hideFontSizeInput) hideFontSizeInput.checked = s.hideFontSize ?? true;
      if (hideThemeBtnInput) hideThemeBtnInput.checked = s.hideThemeBtn ?? false;
      if (hideAmountsBtnInput) hideAmountsBtnInput.checked = s.hideAmountsBtn ?? false;
      if (showCompactBtnInput) showCompactBtnInput.checked = s.showCompactBtn ?? true;
      if (hideDonateBtnInput) hideDonateBtnInput.checked = s.hideDonateBtn ?? true;
      if (hideStickersBtnInput) hideStickersBtnInput.checked = s.hideStickersBtn ?? true;

      settingsDialog.style.display = 'block';
      settingsBackdrop.style.display = 'block';

      // Disable scroll on mobile when settings open
      document.body.classList.add('modal-open');
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
        importBtn.textContent = 'Import';
        importMode = false;
      }
      settingsDialog.style.display = 'none';
      settingsBackdrop.style.display = 'none';

      // Re-enable scroll on mobile
      document.body.classList.remove('modal-open');
    }
  };

  if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
  if (closeBtn) closeBtn.addEventListener('click', closeSettings);
  if (cancelBtn) cancelBtn.addEventListener('click', closeSettings);
  if (settingsBackdrop) settingsBackdrop.addEventListener('click', closeSettings);

  // Live font preview
  const fontSelectInput = document.getElementById('newFontSelect');
  if (fontSelectInput) {
    fontSelectInput.addEventListener('change', (e) => {
      applyFont(e.target.value);
    });
  }

  // Export settings. Wallet-asset entry prices live in a separate localStorage key
  // (`walletAssetEntryPrices`) rather than in the settings blob, so we splice them in under
  // a namespaced field. Import unpacks them back into that key.
  if (exportBtn && exportArea) {
    exportBtn.addEventListener('click', async () => {
      const s = { ...getSettings() };
      try {
        const walletPrices = localStorage.getItem('walletAssetEntryPrices');
        if (walletPrices) {
          s.__walletAssetEntryPrices = JSON.parse(walletPrices);
        }
      } catch (_) { /* ignore parse failures — just skip in that case */ }

      const exportData = btoa(JSON.stringify(s));
      exportArea.value = exportData;
      exportArea.style.display = 'block';
      exportArea.removeAttribute('readonly');
      exportArea.select();

      try {
        await navigator.clipboard.writeText(exportData);
        const originalText = exportBtn.textContent;
        exportBtn.textContent = 'Copied!';
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
        exportArea.placeholder = 'Paste exported settings here, then click Save & Reload at the bottom';
        exportArea.style.display = 'block';
        exportArea.removeAttribute('readonly');
        exportArea.focus();
        importBtn.textContent = 'Cancel Import';
        importMode = true;
      } else {
        // Second click: cancel import
        exportArea.style.display = 'none';
        exportArea.setAttribute('readonly', 'readonly');
        exportArea.value = '';
        importBtn.textContent = 'Import';
        importMode = false;
      }
    });
  }

  // Force update button - clears all caches, unregisters SW, and hard reloads
  const forceUpdateBtn = document.getElementById('newForceUpdateBtn');
  if (forceUpdateBtn) {
    forceUpdateBtn.addEventListener('click', async () => {
      const originalText = forceUpdateBtn.textContent;
      forceUpdateBtn.textContent = 'Clearing...';
      forceUpdateBtn.disabled = true;

      try {
        // Step 1: Clear all browser caches
        if ('caches' in window) {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map(name => caches.delete(name)));
        }

        // Step 2: Unregister ALL service workers (this is the key fix)
        // This ensures no stale SW serves cached content
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map(reg => reg.unregister()));
        }

        // Step 3: Clear localStorage version to force fresh state
        localStorage.removeItem(FORCE_UPDATE_KEY);

        // Step 4: Clear sessionStorage
        sessionStorage.clear();

        // Step 5: Wait for unregistration to complete
        await new Promise(resolve => setTimeout(resolve, 300));

        // Step 6: Hard reload using cache-busting URL
        // Adding a timestamp query param forces the browser to bypass any cached redirects
        const url = new URL(window.location.href);
        url.searchParams.set('_cb', Date.now().toString());
        window.location.replace(url.toString());
      } catch (error) {
        console.error('[Force Update] Error:', error);
        forceUpdateBtn.textContent = 'Error - Try Again';
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
      toggleRainBtn.textContent = active ? 'Rain Off' : 'Rain On';
      if (toggleRainBtnMobile) {
        toggleRainBtnMobile.textContent = active ? 'Rain Off' : 'Rain On';
      }
      if (active) {
        toggleSnowBtn.textContent = 'Snow On';
        if (toggleSnowBtnMobile) toggleSnowBtnMobile.textContent = 'Snow On';
      }

      // Save to localStorage
      const s = getSettings();
      s.rainEnabled = active;
      s.snowEnabled = false;
      s.rainSnowManuallySet = true; // User has manually set preference
      localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
    });
  }

  if (Rain && toggleSnowBtn) {
    toggleSnowBtn.addEventListener('click', () => {
      const active = Rain.toggleSnow();
      toggleSnowBtn.textContent = active ? 'Snow Off' : 'Snow On';
      if (toggleSnowBtnMobile) {
        toggleSnowBtnMobile.textContent = active ? 'Snow Off' : 'Snow On';
      }
      if (active) {
        toggleRainBtn.textContent = 'Rain On';
        if (toggleRainBtnMobile) toggleRainBtnMobile.textContent = 'Rain On';
      }

      // Save to localStorage
      const s = getSettings();
      s.snowEnabled = active;
      s.rainEnabled = false;
      s.rainSnowManuallySet = true; // User has manually set preference
      localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
    });
  }

  if (Rain && toggleRainBtnMobile) {
    toggleRainBtnMobile.addEventListener('click', () => {
      const active = Rain.toggleRain();
      toggleRainBtnMobile.textContent = active ? 'Rain Off' : 'Rain On';
      if (toggleRainBtn) {
        toggleRainBtn.textContent = active ? 'Rain Off' : 'Rain On';
      }
      if (active) {
        toggleSnowBtn.textContent = 'Snow On';
        if (toggleSnowBtnMobile) toggleSnowBtnMobile.textContent = 'Snow On';
      }

      // Close mobile menu if open (with scroll restoration)
      closeMobileMenuWithScroll();

      // Save to localStorage
      const s = getSettings();
      s.rainEnabled = active;
      s.snowEnabled = false;
      s.rainSnowManuallySet = true; // User has manually set preference
      localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
    });
  }

  if (Rain && toggleSnowBtnMobile) {
    toggleSnowBtnMobile.addEventListener('click', () => {
      const active = Rain.toggleSnow();
      toggleSnowBtnMobile.textContent = active ? 'Snow Off' : 'Snow On';
      if (toggleSnowBtn) {
        toggleSnowBtn.textContent = active ? 'Snow Off' : 'Snow On';
      }
      if (active) {
        toggleRainBtn.textContent = 'Rain On';
        if (toggleRainBtnMobile) toggleRainBtnMobile.textContent = 'Rain On';
      }

      // Close mobile menu if open (with scroll restoration)
      closeMobileMenuWithScroll();

      // Save to localStorage
      const s = getSettings();
      s.snowEnabled = active;
      s.rainEnabled = false;
      s.rainSnowManuallySet = true; // User has manually set preference
      localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
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
        localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
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
        localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
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
        localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
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
        localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
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

      useMyLocationBtn.textContent = 'Getting Location...';
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

        useMyLocationBtn.textContent = 'Use My Location';
        useMyLocationBtn.disabled = false;
      } catch (err) {
        console.error('Location denied:', err);
        alert('Could not get your location. Please check browser permissions.');
        useMyLocationBtn.textContent = 'Use My Location';
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

          // Split out the wallet-asset entry prices back into their own localStorage key
          // so the EntryPriceTracker finds them. Strip the namespaced field before storing
          // the rest as settings so we don't leak it into subsequent exports.
          const walletPrices = importedSettings.__walletAssetEntryPrices;
          if (walletPrices && typeof walletPrices === 'object') {
            try {
              localStorage.setItem('walletAssetEntryPrices', JSON.stringify(walletPrices));
            } catch (e) {
              console.warn('[Import] Failed to restore walletAssetEntryPrices:', e);
            }
          }
          delete importedSettings.__walletAssetEntryPrices;

          // Save imported settings to localStorage
          localStorage.setItem('myDashboardSettings.v2', JSON.stringify(importedSettings));
          invalidateSettingsCache(); // Clear cache so next getSettings() reads fresh data

          // Reset import mode UI
          exportArea.style.display = 'none';
          exportArea.setAttribute('readonly', 'readonly');
          importBtn.textContent = 'Import';
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
      const cieloInput = document.getElementById('newCieloApiKey');
      const onchainProviderInput = document.getElementById('newOnchainProvider');
      const alchemyInput = document.getElementById('newAlchemyApiKey');
      const heliusInput = document.getElementById('newHeliusApiKey');
      const openseaInput = document.getElementById('newOpenSeaApiKey');
      const ibkrEnabledInput = document.getElementById('newIbkrEnabled');
      const ibkrGatewayUrlInput = document.getElementById('newIbkrGatewayUrl');
      const ibkrAccountIdsInput = document.getElementById('newIbkrAccountIds');
      const cityInput = document.getElementById('newWeatherCity');
      const latInput = document.getElementById('newWeatherLat');
      const lonInput = document.getElementById('newWeatherLon');
      const coloredPnLInput = document.getElementById('newUseColoredPnL');
      const hideWatchlistInput = document.getElementById('newHideWatchlist');
      const hideComicInput = document.getElementById('newHideComic');
      const showExactAmountsInput = document.getElementById('newShowExactAmounts');
      const showPriceChartInput = document.getElementById('newShowPriceChart');
      const minBalanceInput = document.getElementById('newMinBalanceThreshold');
      const fontSelectInput = document.getElementById('newFontSelect');
      const portfolioBaseCurrencyInput = document.getElementById('newPortfolioBaseCurrency');

      // Menu visibility controls
      const hideSnowBtnInput = document.getElementById('newHideSnowBtn');
      const hideRainBtnInput = document.getElementById('newHideRainBtn');
      const hideFontSizeInput = document.getElementById('newHideFontSize');
      const hideThemeBtnInput = document.getElementById('newHideThemeBtn');
      const hideAmountsBtnInput = document.getElementById('newHideAmountsBtn');
      const showCompactBtnInput = document.getElementById('newShowCompactBtn');
      const hideDonateBtnInput = document.getElementById('newHideDonateBtn');
      const hideStickersBtnInput = document.getElementById('newHideStickersBtn');

      if (userNameInput) newSettings.userName = userNameInput.value;
      if (walletInput) newSettings.walletAddresses = walletInput.value;
      if (solanaInput) newSettings.solanaAddresses = solanaInput.value;
      if (bitcoinInput) newSettings.bitcoinAddresses = bitcoinInput.value;
      if (zcashInput) newSettings.zcashAddresses = zcashInput.value;
      if (zerionInput) newSettings.zerionApiKey = zerionInput.value;
      if (cieloInput) newSettings.cieloApiKey = cieloInput.value;
      if (onchainProviderInput) newSettings.onchainProvider = onchainProviderInput.value;
      if (alchemyInput) newSettings.alchemyApiKey = alchemyInput.value;
      if (heliusInput) newSettings.heliusApiKey = heliusInput.value;
      if (openseaInput) newSettings.openSeaApiKey = openseaInput.value;
      if (ibkrEnabledInput) newSettings.ibkrEnabled = ibkrEnabledInput.checked;
      if (ibkrGatewayUrlInput) newSettings.ibkrGatewayUrl = ibkrGatewayUrlInput.value.trim() || 'https://localhost:5000/v1/api';
      if (ibkrAccountIdsInput) newSettings.ibkrAccountIds = ibkrAccountIdsInput.value;
      if (coloredPnLInput) newSettings.useColoredPnL = coloredPnLInput.checked;
      if (hideWatchlistInput) newSettings.hideWatchlist = hideWatchlistInput.checked;
      if (hideComicInput) newSettings.hideComic = hideComicInput.checked;
      if (showExactAmountsInput) newSettings.showExactAmounts = showExactAmountsInput.checked;
      if (showPriceChartInput) newSettings.showPriceChart = showPriceChartInput.checked;
      if (minBalanceInput) newSettings.minBalanceThreshold = parseFloat(minBalanceInput.value) || 100;
      if (fontSelectInput) newSettings.font = fontSelectInput.value;
      if (portfolioBaseCurrencyInput) newSettings.portfolioBaseCurrency = portfolioBaseCurrencyInput.value || 'USD';

      // Save menu visibility settings
      if (hideSnowBtnInput) newSettings.hideSnowBtn = hideSnowBtnInput.checked;
      if (hideRainBtnInput) newSettings.hideRainBtn = hideRainBtnInput.checked;
      if (hideFontSizeInput) newSettings.hideFontSize = hideFontSizeInput.checked;
      if (hideThemeBtnInput) newSettings.hideThemeBtn = hideThemeBtnInput.checked;
      if (hideAmountsBtnInput) newSettings.hideAmountsBtn = hideAmountsBtnInput.checked;
      if (showCompactBtnInput) newSettings.showCompactBtn = showCompactBtnInput.checked;
      if (hideDonateBtnInput) newSettings.hideDonateBtn = hideDonateBtnInput.checked;
      if (hideStickersBtnInput) newSettings.hideStickersBtn = hideStickersBtnInput.checked;

      const parsedLat = parseFloat(latInput?.value);
      const parsedLon = parseFloat(lonInput?.value);
      newSettings.weather = {
        label: cityInput?.value || '',
        lat: Number.isFinite(parsedLat) ? parsedLat : null,
        lon: Number.isFinite(parsedLon) ? parsedLon : null
      };

      // Save via legacy saveSettings (handles encryption)
      try {
        localStorage.setItem('myDashboardSettings.v2', JSON.stringify(newSettings));
        invalidateSettingsCache(); // Clear cache so next getSettings() reads fresh data
        closeSettings();

        // Apply alignment immediately
        const container = document.querySelector('.container');
        if (container) {
          if (true) {
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

        // Re-render watchlist with updated settings while preserving existing rows
        if (newSettings.watchlist && newSettings.watchlist.length > 0) {
          try {
            await renderWatchlistPanel({
              feedIdsOverride: newSettings.watchlist,
              forceRefresh: false,
              editMode: watchlistEditMode,
              preserveCurrentData: true
            });
          } catch (_) {
            // Silently fail if watchlist re-render fails
          }
        }

        // Apply visibility settings via body classes
        const body = document.body;
        body.classList.toggle('hide-snow-btn', newSettings.hideSnowBtn ?? true);
        body.classList.toggle('hide-rain-btn', newSettings.hideRainBtn ?? true);
        body.classList.toggle('hide-font-size', newSettings.hideFontSize ?? true);
        body.classList.toggle('hide-theme-btn', newSettings.hideThemeBtn ?? false);
        body.classList.toggle('hide-amounts-btn', newSettings.hideAmountsBtn ?? false);
        body.classList.toggle('hide-donate-btn', newSettings.hideDonateBtn ?? true);
        body.classList.toggle('hide-stickers-btn', newSettings.hideStickersBtn ?? true);
        body.classList.toggle('hide-watchlist', newSettings.hideWatchlist ?? false);
        body.classList.toggle('hide-comic', newSettings.hideComic ?? false);
        body.classList.toggle('mono-pnl', !(newSettings.useColoredPnL ?? false));

        // Apply font setting
        applyFont(newSettings.font || 'system');

        // Apply keyboard shortcuts setting (dynamic enable/disable)
        if (newSettings.enableKeyboardShortcuts) {
          import('./modules/features/keyboard-shortcuts.js')
            .then(mod => mod.init())
            .catch(e => console.warn('[Keyboard] Failed to load:', e));
        } else {
          // Try to disable if module was loaded
          import('./modules/features/keyboard-shortcuts.js')
            .then(mod => mod.disable())
            .catch(() => { /* Module not loaded, nothing to disable */ });
        }

        // Soft reload: re-fetch positions without full page refresh (this will reload settings)
        await renderPortfolioIncremental();
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
      // Disable scroll on mobile when modal open
      document.body.classList.add('modal-open');
    }
    // Close mobile menu if open (with scroll restoration)
    closeMobileMenuWithScroll();
  };

  const closeDonateWindow = () => {
    if (donateWindow) {
      donateWindow.style.display = 'none';
      if (donateBackdrop) donateBackdrop.style.display = 'none';
      // Re-enable scroll on mobile
      document.body.classList.remove('modal-open');
    }
  };

  async function copyToClipboard(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      const originalText = button.textContent;
      button.textContent = 'Copied!';
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

  // Stickers functionality
  const stickersBtn = document.getElementById('newStickersBtn');
  const stickersBtnMobile = document.getElementById('newStickersBtnMobile');
  const closeStickerWindowBtn = document.getElementById('closeStickerWindowBtn');
  const stickerBackdrop = document.getElementById('stickerBackdrop');

  const openStickerWindow = async () => {
    // Lazy load stickers module
    try {
      const stickersModule = await import('./modules/features/stickers.js');
      stickersModule.openStickerWindow();
    } catch (e) {
      console.error('[Stickers] Failed to load module:', e);
    }
    // Close mobile menu if open
    closeMobileMenuWithScroll();
  };

  const closeStickerWindowHandler = async () => {
    try {
      const stickersModule = await import('./modules/features/stickers.js');
      stickersModule.closeStickerWindow();
    } catch (e) {
      console.error('[Stickers] Failed to close:', e);
    }
  };

  if (stickersBtn) stickersBtn.addEventListener('click', openStickerWindow);
  if (stickersBtnMobile) stickersBtnMobile.addEventListener('click', openStickerWindow);
  if (closeStickerWindowBtn) closeStickerWindowBtn.addEventListener('click', closeStickerWindowHandler);
  if (stickerBackdrop) stickerBackdrop.addEventListener('click', closeStickerWindowHandler);

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

    // Fallback data for when API fails or returns empty (CORS issues, etc.)
    const FALLBACK_FEEDS = [
      { symbol: 'BTC', id: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43' },
      { symbol: 'ETH', id: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace' },
      { symbol: 'SOL', id: '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d' },
      { symbol: 'BNB', id: '0x2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d11bed02' },
      { symbol: 'DOGE', id: '0xdcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c' },
      { symbol: 'AVAX', id: '0x93da3352f9ee7d82e5b72c88f15ec963795d9038e9dc8564c974003cb3e97029' },
      { symbol: 'MATIC', id: '0x5de33a9112c2b700b8d30b8a3402c10363715bbc5aadd63a35d8e12a2aa7d863' },
      { symbol: 'DOT', id: '0x59c3d0f04ec60d70928e1005bbf2f7ee628290f0ca93ee4f03975550302d7e9e' },
      { symbol: 'LINK', id: '0x8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221' },
      { symbol: 'UNI', id: '0x78d185a741d07edb3412b09008b7c5cfb9bbbd7d568bf00ba737b456ba171501' },
      { symbol: 'XRP', id: '0xec5d399846a9209f3fe5881d70aae9268c94339ff9817e8d18ff19fa05eea1c8' },
      { symbol: 'ADA', id: '0x2a01deaec9e51a579277b34b122399984d0bbf57e2458a7e42fecd2829867a0d' },
      { symbol: 'ATOM', id: '0xb00b60f88b03a6a625a8d1c048c3f66653edf217439cb4d1c21c60c4b4b0fce0' },
      { symbol: 'LTC', id: '0x6e3f3fa8253588df9326580180233eb791e03b5cd0a3b7c25afc30c9c42bc8a9' },
      { symbol: 'NEAR', id: '0xc415de8d2eba7db216527dff4b60e8f3a5311c740daee748c31d8cc844ef0807' },
      { symbol: 'SHIB', id: '0xf0d57deca57b3da2fe63a493f4c25925c4c4c1f1d64c7f98c7c7a0eb3b4c0a44' },
      { symbol: 'ARB', id: '0x3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5' },
      { symbol: 'OP', id: '0x385f64d993f7b77d8182ed5003d97c60aa3361f3cecfe711544d2d59165e9bdf' },
      { symbol: 'APT', id: '0x03ae4db29ed4ae33d323568895aa00337e658e348b37509f5372ae51f0af00d5' },
      { symbol: 'SUI', id: '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744' }
    ];

    try {
      const mods = window.AppModules || {};
      const providers = mods.data?.providers || {};

      // Prefer the richer metadata endpoint — gives us asset class (crypto/equity/fx/metal),
      // human-readable names ("Apple Inc."), and market-hours flags for stocks. Fall back to the
      // flat symbol→id map if metadata isn't exposed (older provider revisions).
      let metadata = [];
      if (typeof providers.pyth?.getFeedsWithMetadata === 'function') {
        metadata = await providers.pyth.getFeedsWithMetadata(15000);
      }

      if (Array.isArray(metadata) && metadata.length > 0) {
        allPythFeeds = metadata;
        console.log(`[Search] Loaded ${allPythFeeds.length} Pyth feeds (with metadata) from API`);
        return allPythFeeds;
      }

      const feeds = await providers.pyth.getPriceFeeds(15000);
      if (feeds && typeof feeds === 'object' && Object.keys(feeds).length > 0) {
        allPythFeeds = Object.entries(feeds).map(([symbol, id]) => ({
          symbol, id, category: 'crypto', name: symbol
        }));
        console.log(`[Search] Loaded ${allPythFeeds.length} Pyth feeds from API`);
        return allPythFeeds;
      }

      console.warn('[Search] Pyth API returned empty, using fallback feeds');
      allPythFeeds = FALLBACK_FEEDS.map(f => ({ ...f, category: 'crypto', name: f.symbol }));
      return allPythFeeds;
    } catch (e) {
      console.error('Failed to load Pyth feeds:', e);
      allPythFeeds = FALLBACK_FEEDS.map(f => ({ ...f, category: 'crypto', name: f.symbol }));
      return allPythFeeds;
    }
  }

  // Category label shown as a chip next to the ticker in search results / selection summary.
  function categoryLabel(cat) {
    switch (cat) {
      case 'equity': return 'Stock';
      case 'etf': return 'ETF';
      case 'fund': return 'Fund';
      case 'index': return 'Index';
      case 'crypto': return 'Crypto';
      case 'fx': return 'FX';
      case 'metal': return 'Metal';
      case 'commodity': return 'Commodity';
      default: return '';
    }
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  let watchlistRenderInFlight = false;
  let watchlistRenderQueued = false;
  let watchlistQueuedOptions = null;

  async function renderWatchlistPanel(options = {}) {
    const {
      feedIdsOverride = null,
      entriesOverride = null,
      forceRefresh = false,
      editMode = watchlistEditMode,
      preserveCurrentData = true
    } = options;

    const watchlistBody = document.getElementById('newWatchlistBody');
    if (!watchlistBody) return [];

    const s = getSettings();
    // Support both legacy (string[]) and new (object[]) watchlist shapes. The new shape lets us
    // distinguish Pyth crypto feeds from Yahoo stocks/ETFs without losing the symbol on load.
    const rawList = Array.isArray(entriesOverride)
      ? entriesOverride
      : (Array.isArray(feedIdsOverride) ? feedIdsOverride : (s.watchlist || []));
    const providers = window.AppModules?.data?.providers || {};
    const pythProvider = providers.pyth;
    const stocksProvider = providers.stocks;
    if (!pythProvider && !stocksProvider) return cachedWatchlistData || [];

    if (watchlistRenderInFlight) {
      watchlistRenderQueued = true;
      watchlistQueuedOptions = options;
      return cachedWatchlistData || [];
    }

    watchlistRenderInFlight = true;
    try {
      const mod = await import('./modules/features/watchlist.js');
      const previousData = Array.isArray(cachedWatchlistData) && cachedWatchlistData.length > 0
        ? cachedWatchlistData
        : null;

      const prices = await mod.render(watchlistBody, {
        entries: rawList,
        pythProvider,
        stocksProvider,
        useColoredPnL: s.useColoredPnL ?? false,
        editMode,
        cachedData: preserveCurrentData ? previousData : null,
        previousData,
        showPriceChart: s.showPriceChart ?? true,
        forceRefresh
      });

      if (rawList.length === 0) {
        cachedWatchlistData = [];
      } else if (Array.isArray(prices) && prices.length > 0) {
        cachedWatchlistData = prices;
      }

      if (editMode) {
        attachWatchlistEditListeners();
      }

      return prices;
    } catch (e) {
      console.warn('[Watchlist] Render failed:', e?.message || e);
      if (!watchlistBody.querySelector('tr')) {
        watchlistBody.innerHTML = `<tr><td colspan="4" class="loading">Watchlist unavailable</td></tr>`;
      }
      return cachedWatchlistData || [];
    } finally {
      watchlistRenderInFlight = false;
      if (watchlistRenderQueued) {
        const queued = watchlistQueuedOptions || {};
        watchlistRenderQueued = false;
        watchlistQueuedOptions = null;
        queueMicrotask(() => { renderWatchlistPanel(queued); });
      }
    }
  }

  // Expose watchlist renderer for lifecycle code outside setupControls().
  window.renderWatchlistPanel = renderWatchlistPanel;

  // Composite key that uniquely identifies a watchlist entry across providers. Matches the
  // key format used by modules/features/watchlist.js so UI events and storage stay in sync.
  function watchlistEntryKey(entry) {
    if (!entry) return '';
    if (typeof entry === 'string') {
      const id = entry.toLowerCase();
      return `pyth:${id.startsWith('0x') ? id : `0x${id}`}`;
    }
    if (entry.provider === 'yahoo' && entry.symbol) return `yahoo:${entry.symbol.toUpperCase()}`;
    if (entry.provider === 'pyth' && entry.id) {
      const id = entry.id.toLowerCase();
      return `pyth:${id.startsWith('0x') ? id : `0x${id}`}`;
    }
    if (entry.id) {
      const id = entry.id.toLowerCase();
      return `pyth:${id.startsWith('0x') ? id : `0x${id}`}`;
    }
    return '';
  }

  function currentWatchlistKeys() {
    const s = getSettings();
    const list = s.watchlist || [];
    return new Set(list.map(watchlistEntryKey).filter(Boolean));
  }

  // Add either a Pyth feed (via id) or a Yahoo symbol to the watchlist. Callers pass a
  // normalized entry object; we dedupe on composite key so adding the same ticker twice is a
  // no-op regardless of which source the user picked it from.
  async function addToWatchlist(entry) {
    const s = getSettings();
    if (!s.watchlist) s.watchlist = [];

    const targetKey = watchlistEntryKey(entry);
    if (!targetKey) return;

    const existing = new Set(s.watchlist.map(watchlistEntryKey));
    if (existing.has(targetKey)) return;

    // Normalize to the rich object form on write — legacy string entries can coexist but new
    // writes always carry provider info so the UI keeps working after a reload.
    const toStore = typeof entry === 'string'
      ? { provider: 'pyth', id: entry }
      : (entry.provider === 'yahoo'
          ? { provider: 'yahoo', symbol: entry.symbol, name: entry.name || null, category: entry.category || null }
          : { provider: 'pyth', id: entry.id });

    s.watchlist.push(toStore);
    try {
      localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
      invalidateSettingsCache();
      await renderWatchlistPanel({
        entriesOverride: s.watchlist,
        forceRefresh: true,
        editMode: watchlistEditMode,
        preserveCurrentData: true
      });
    } catch (e) {
      console.error('Failed to save watchlist:', e);
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
    // Re-enable scroll on mobile
    document.body.classList.remove('modal-open');
  }

  if (addToWatchlistBtn) {
    addToWatchlistBtn.addEventListener('click', async () => {
      // Load feeds
      const feeds = await loadAllPythFeeds();

      // Show modal
      if (watchlistSearchWindow) watchlistSearchWindow.style.display = 'block';
      if (watchlistSearchBackdrop) watchlistSearchBackdrop.style.display = 'block';

      // Disable scroll on mobile when modal open
      document.body.classList.add('modal-open');

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
    // Keys (composite) that were just added during this search session. The dedupe against
    // the persisted watchlist is separate — this set only stops double-clicks.
    const addedKeys = new Set();
    let watchlistSearchDebounce = null;
    let watchlistSearchSeq = 0;

    function renderWatchlistSearchRows(feeds) {
      if (!watchlistSearchResults) return;
      const watchlistKeys = currentWatchlistKeys();

      if (feeds.length === 0) {
        watchlistSearchResults.innerHTML = '<div class="help" style="padding: 16px;">No results found</div>';
        watchlistSearchResults.style.display = 'block';
        return;
      }

      watchlistSearchResults.innerHTML = '';
      watchlistSearchResults.style.display = 'block';
      feeds.forEach(feed => {
        // Wrap the raw feed in an entry object matching our storage format so the key is
        // computed identically to what's persisted / rendered downstream.
        const entry = feed.provider === 'yahoo'
          ? { provider: 'yahoo', symbol: feed.symbol, name: feed.name, category: feed.category }
          : { provider: 'pyth', id: feed.id };
        const key = watchlistEntryKey(entry);

        const resultDiv = document.createElement('div');
        resultDiv.className = 'watchlist-search-result';

        const isInWatchlist = watchlistKeys.has(key);
        const isAdded = addedKeys.has(key);
        if (isInWatchlist || isAdded) resultDiv.classList.add('added');

        const label = categoryLabel(feed.category);
        const name = feed.name && feed.name !== feed.symbol ? ` <span style="opacity: 0.65;">— ${escapeHtml(feed.name)}</span>` : '';
        resultDiv.innerHTML = `
          <span><strong>${escapeHtml(feed.symbol)}</strong>${name}${label ? ` <span style="opacity: 0.5; font-size: 0.85em;">${label}</span>` : ''}</span>
          <button class="btn-text ${isInWatchlist || isAdded ? 'added' : ''}" data-entry-key="${key}">
            ${isInWatchlist ? 'In List' : isAdded ? 'Added' : 'Add'}
          </button>
        `;

        const btn = resultDiv.querySelector('button');
        if (!isInWatchlist) {
          btn.addEventListener('click', () => {
            if (!addedKeys.has(key)) {
              addToWatchlist(entry);
              addedKeys.add(key);
              btn.textContent = 'Added';
              btn.classList.add('added');
              resultDiv.classList.add('added');
            }
          });
        }

        watchlistSearchResults.appendChild(resultDiv);
      });
    }

    function performSearch(query) {
      if (!watchlistSearchResults) return;
      clearTimeout(watchlistSearchDebounce);

      if (!query) {
        watchlistSearchResults.innerHTML = '<div class="help" style="padding: 16px;">Type to search tokens or stocks...</div>';
        watchlistSearchResults.style.display = 'block';
        return;
      }

      const feeds = allPythFeeds || [];
      const pythMatches = rankFeedMatches(query, feeds);
      // Instant feedback from local Pyth corpus; Yahoo results arrive shortly after.
      renderWatchlistSearchRows(pythMatches);

      const seq = ++watchlistSearchSeq;
      watchlistSearchDebounce = setTimeout(async () => {
        const stocksProvider = window.AppModules?.data?.providers?.stocks;
        if (!stocksProvider?.searchSymbols) return;
        try {
          const yahoo = await stocksProvider.searchSymbols(query, { limit: 25 });
          if (seq !== watchlistSearchSeq) return;
          renderWatchlistSearchRows(mergeSearchResults(pythMatches, yahoo));
        } catch (err) {
          console.warn('[Watchlist search] Yahoo search failed:', err?.message || err);
        }
      }, 250);
    }

    watchlistSearchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      performSearch(query);
    });
  }

  // Watchlist Edit functionality
  const editWatchlistBtn = document.getElementById('newEditWatchlistBtn');

  // Remove by composite key so mixed Pyth/Yahoo entries can all be deleted the same way.
  function removeFromWatchlist(targetKey) {
    if (!targetKey) return;
    const s = getSettings();
    if (!s.watchlist) s.watchlist = [];

    s.watchlist = s.watchlist.filter(e => watchlistEntryKey(e) !== targetKey);
    try {
      localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
      invalidateSettingsCache();

      if (cachedWatchlistData) {
        cachedWatchlistData = cachedWatchlistData.filter(item => item.key !== targetKey);
      }
      renderWatchlistPanel({
        entriesOverride: s.watchlist,
        forceRefresh: false,
        editMode: watchlistEditMode,
        preserveCurrentData: true
      });
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

      newWatchlistBody.addEventListener('click', (e) => {
        if (e.target.classList.contains('watchlist-edit-btn')) {
          // Prefer the new composite key; fall back to legacy `data-feed-id` if an older
          // render's buttons are still in the DOM (e.g. partial update races).
          const key = e.target.getAttribute('data-entry-key')
            || (e.target.getAttribute('data-feed-id') ? `pyth:${e.target.getAttribute('data-feed-id').toLowerCase()}` : null);
          if (key) removeFromWatchlist(key);
        }
      });
    }
  }

  const cancelWatchlistEditBtn = document.getElementById('newCancelWatchlistEditBtn');
  let watchlistEditSnapshot = null;

  async function toggleWatchlistEditMode() {
    if (!watchlistEditMode) {
      // Entering edit mode - take snapshot of current watchlist
      const s = getSettings();
      watchlistEditSnapshot = {
        watchlist: [...(s.watchlist || [])]
      };
    }

    watchlistEditMode = !watchlistEditMode;
    if (editWatchlistBtn) {
      editWatchlistBtn.textContent = watchlistEditMode ? 'Save' : 'Edit';
    }

    // Show/hide cancel button
    if (cancelWatchlistEditBtn) {
      cancelWatchlistEditBtn.style.display = watchlistEditMode ? 'inline' : 'none';
    }

    try {
      const s = getSettings();
      await renderWatchlistPanel({
        feedIdsOverride: s.watchlist || [],
        forceRefresh: false,
        editMode: watchlistEditMode,
        preserveCurrentData: true
      });
    } catch (e) {
      console.error('Failed to toggle watchlist edit mode:', e);
    }
  }

  if (editWatchlistBtn) {
    editWatchlistBtn.addEventListener('click', toggleWatchlistEditMode);
  }

  // Cancel watchlist edit mode - restore snapshot
  if (cancelWatchlistEditBtn) {
    cancelWatchlistEditBtn.addEventListener('click', async () => {
      if (watchlistEditSnapshot) {
        // Restore watchlist from snapshot
        const s = getSettings();
        s.watchlist = [...watchlistEditSnapshot.watchlist];
        localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
        invalidateSettingsCache();

        // Clear cached data to force refetch
        cachedWatchlistData = null;
      }

      // Exit edit mode
      watchlistEditMode = false;
      if (editWatchlistBtn) {
        editWatchlistBtn.textContent = 'Edit';
      }
      cancelWatchlistEditBtn.style.display = 'none';

      try {
        const s = getSettings();
        await renderWatchlistPanel({
          feedIdsOverride: s.watchlist || [],
          forceRefresh: true,
          editMode: false,
          preserveCurrentData: true
        });
      } catch (e) {
        console.error('Failed to cancel watchlist edit mode:', e);
      }
    });
  }

  // Add Position functionality
  const addPositionBtn = document.getElementById('newAddPositionBtn');
  const addPositionModal = document.getElementById('newAddPositionModal');
  const addPositionBackdrop = document.getElementById('newAddPositionBackdrop');
  const addPositionTitle = document.getElementById('newAddPositionTitle');
  const closeAddPositionBtn = document.getElementById('newCloseAddPositionBtn');
  const addPositionTypePyth = document.getElementById('newAddPositionTypePyth');
  const addPositionTypeCustom = document.getElementById('newAddPositionTypeCustom');
  const addPositionPythSection = document.getElementById('newAddPositionPythSection');
  const addPositionCustomSection = document.getElementById('newAddPositionCustomSection');
  const addPositionPythSearch = document.getElementById('newAddPositionPythSearch');
  const addPositionPythResults = document.getElementById('newAddPositionPythResults');
  const addPositionPythSelection = document.getElementById('newAddPositionPythSelection');
  const addPositionPythAmount = document.getElementById('newAddPositionPythAmount');
  const addPositionPythEntryDate = document.getElementById('newAddPositionPythEntryDate');
  const addPositionPythEntryPriceLabel = document.getElementById('newAddPositionPythEntryPriceLabel');
  const addPositionPythEntryPrice = document.getElementById('newAddPositionPythEntryPrice');
  const addPositionPythEntryPriceHint = document.getElementById('newAddPositionPythEntryPriceHint');
  const addPositionCustomName = document.getElementById('newAddPositionCustomName');
  const addPositionCustomValueLabel = document.getElementById('newAddPositionCustomValueLabel');
  const addPositionCustomValue = document.getElementById('newAddPositionCustomValue');
  const savePositionBtn = document.getElementById('newSavePositionBtn');

  let selectedPositionType = 'pyth';
  let selectedPythFeed = null;
  let editingManualPositionIndex = null;
  let editingCustomCurrency = null;

  function normalizeQuoteCurrency(value) {
    const currency = String(value || '').trim();
    if (!/^[A-Za-z]{3,5}$/.test(currency)) return '';
    // Yahoo uses "GBp" for London instruments quoted in pence; uppercasing it to GBP would
    // tell users to enter the wrong unit.
    if (currency === 'GBp') return currency;
    return currency.toUpperCase();
  }

  function quoteCurrencyForFeed(feed) {
    if (!feed) return '';
    const explicitCurrency = normalizeQuoteCurrency(feed.currency || feed.quoteCurrency);
    if (explicitCurrency) return explicitCurrency;
    // Pyth feeds are filtered to USD quotes by the provider. Yahoo symbols can be non-USD,
    // so leave unknown Yahoo currencies generic unless Yahoo search supplied one.
    if (feed.provider === 'pyth' || feed.id) return 'USD';
    return '';
  }

  function formatPriceWithCurrency(price, currency) {
    const formatted = Number(price).toLocaleString(undefined, { maximumFractionDigits: 4 });
    return currency ? `${formatted} ${currency}` : formatted;
  }

  function updateEntryPriceCurrencyUi(feed, { showHint = false } = {}) {
    const currency = quoteCurrencyForFeed(feed);
    const labelCurrency = currency || 'ticker quote currency';
    if (addPositionPythEntryPriceLabel) {
      addPositionPythEntryPriceLabel.textContent = `Entry Price (${labelCurrency})`;
    }
    if (showHint && addPositionPythEntryPriceHint) {
      if (currency) {
        addPositionPythEntryPriceHint.textContent = `Use ${currency} for this entry price.`;
      } else {
        addPositionPythEntryPriceHint.textContent = 'Use the quote currency shown by the selected ticker.';
      }
    }
  }

  function updateCustomValueCurrencyUi(currencyOverride = null) {
    const currency = currencyOverride || getSettings().portfolioBaseCurrency || 'USD';
    if (addPositionCustomValueLabel) {
      addPositionCustomValueLabel.textContent = `Value (${currency})`;
    }
  }

  function closeAddPosition() {
    if (addPositionModal) addPositionModal.style.display = 'none';
    if (addPositionBackdrop) addPositionBackdrop.style.display = 'none';
    if (addPositionTitle) addPositionTitle.textContent = 'Add Position';
    if (savePositionBtn) savePositionBtn.textContent = 'Save Position';
    editingManualPositionIndex = null;
    editingCustomCurrency = null;

    // Re-enable scroll on mobile
    document.body.classList.remove('modal-open');
  }

  if (addPositionBtn) {
    addPositionBtn.addEventListener('click', async () => {
      // Show modal immediately (don't wait for feeds to load)
      if (addPositionModal) addPositionModal.style.display = 'block';
      if (addPositionBackdrop) addPositionBackdrop.style.display = 'block';

      // Disable scroll on mobile when modal open
      document.body.classList.add('modal-open');

      // Reset state
      selectedPositionType = 'pyth';
      selectedPythFeed = null;
      editingManualPositionIndex = null;
      editingCustomCurrency = null;
      if (addPositionTitle) addPositionTitle.textContent = 'Add Position';
      if (savePositionBtn) savePositionBtn.textContent = 'Save Position';
      if (addPositionPythSearch) addPositionPythSearch.value = '';
      if (addPositionPythAmount) addPositionPythAmount.value = '';
      if (addPositionPythEntryDate) addPositionPythEntryDate.value = '';
      if (addPositionPythEntryPrice) {
        addPositionPythEntryPrice.value = '';
        delete addPositionPythEntryPrice.dataset.userEdited;
      }
      if (addPositionPythEntryPriceHint) addPositionPythEntryPriceHint.textContent = '';
      updateEntryPriceCurrencyUi(null);
      updateCustomValueCurrencyUi();
      if (addPositionCustomName) addPositionCustomName.value = '';
      if (addPositionCustomValue) addPositionCustomValue.value = '';
      if (addPositionPythResults) {
        addPositionPythResults.innerHTML = '';
        addPositionPythResults.style.display = 'none';
      }
      if (addPositionPythSelection) {
        addPositionPythSelection.innerHTML = '';
        addPositionPythSelection.style.display = 'none';
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

      // Load feeds in background (don't block modal display)
      loadAllPythFeeds().catch(() => { });
    });
  }

  function openManualPositionEdit(asset, manualType) {
    const s = getSettings();
    const positions = Array.isArray(s.cryptoPositions) ? s.cryptoPositions : [];
    const index = positions.findIndex(position => storedManualPositionMatches(position, asset, manualType));
    if (index < 0) {
      alert('Could not find that manual position in settings.');
      return;
    }

    const position = positions[index];
    editingManualPositionIndex = index;

    if (addPositionModal) addPositionModal.style.display = 'block';
    if (addPositionBackdrop) addPositionBackdrop.style.display = 'block';
    document.body.classList.add('modal-open');
    if (addPositionTitle) addPositionTitle.textContent = 'Edit Position';
    if (savePositionBtn) savePositionBtn.textContent = 'Save Changes';

    if (addPositionPythResults) {
      addPositionPythResults.innerHTML = '';
      addPositionPythResults.style.display = 'none';
    }

    if (position.type === 'custom') {
      selectedPositionType = 'custom';
      selectedPythFeed = null;
      if (addPositionPythSection) addPositionPythSection.style.display = 'none';
      if (addPositionCustomSection) addPositionCustomSection.style.display = 'block';
      if (addPositionTypeCustom) addPositionTypeCustom.classList.add('active');
      if (addPositionTypePyth) addPositionTypePyth.classList.remove('active');
      editingCustomCurrency = position.currency || s.portfolioBaseCurrency || 'USD';
      updateCustomValueCurrencyUi(editingCustomCurrency);
      if (addPositionCustomName) addPositionCustomName.value = position.name || position.symbol || '';
      if (addPositionCustomValue) addPositionCustomValue.value = position.value || position.price || '';
      if (addPositionPythSelection) {
        addPositionPythSelection.innerHTML = '';
        addPositionPythSelection.style.display = 'none';
      }
      return;
    }

    selectedPositionType = 'pyth';
    selectedPythFeed = {
      provider: position.type === 'stock' ? 'yahoo' : 'pyth',
      symbol: position.symbol,
      id: position.feedId || null,
      category: position.category || (position.type === 'stock' ? 'equity' : 'crypto'),
      name: position.name || position.symbol,
      exchange: position.exchange || null,
      currency: position.currency || (position.type === 'stock' ? null : 'USD')
    };

    if (addPositionPythSection) addPositionPythSection.style.display = 'block';
    if (addPositionCustomSection) addPositionCustomSection.style.display = 'none';
    if (addPositionTypePyth) addPositionTypePyth.classList.add('active');
    if (addPositionTypeCustom) addPositionTypeCustom.classList.remove('active');
    if (addPositionPythSearch) addPositionPythSearch.value = position.symbol || '';
    if (addPositionPythAmount) addPositionPythAmount.value = position.amount || '';
    if (addPositionPythEntryDate) addPositionPythEntryDate.value = position.entryDate || '';
    if (addPositionPythEntryPrice) {
      addPositionPythEntryPrice.value = position.entryPrice || '';
      addPositionPythEntryPrice.dataset.userEdited = '1';
    }
    renderSelectedFeed(selectedPythFeed);
    updateEntryPriceCurrencyUi(selectedPythFeed, { showHint: true });
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
      updateCustomValueCurrencyUi();
    });
  }

  if (addPositionTypeCustom) {
    addPositionTypeCustom.addEventListener('click', () => {
      selectedPositionType = 'custom';
      editingCustomCurrency = null;
      if (addPositionPythSection) addPositionPythSection.style.display = 'none';
      if (addPositionCustomSection) addPositionCustomSection.style.display = 'block';
      addPositionTypeCustom.classList.add('active');
      if (addPositionTypePyth) {
        addPositionTypePyth.classList.remove('active');
      }
      updateCustomValueCurrencyUi();
    });
  }

  // Rank local Pyth matches. Yahoo results arrive pre-ranked by their API and are interleaved
  // separately so we don't have to second-guess a much larger corpus.
  function rankFeedMatches(query, feeds) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const scored = [];
    for (const feed of feeds) {
      const sym = (feed.symbol || '').toLowerCase();
      const name = (feed.name || '').toLowerCase();
      let score = -1;
      if (sym === q) score = 100;
      else if (sym.startsWith(q)) score = 80;
      else if (sym.includes(q)) score = 60;
      else if (name.includes(q)) score = 40;
      else continue;
      if (feed.category === 'crypto') score += 2;
      scored.push({ feed, score });
    }
    scored.sort((a, b) => b.score - a.score || a.feed.symbol.length - b.feed.symbol.length);
    return scored.slice(0, 12).map(s => s.feed);
  }

  // Merge Pyth + Yahoo results, deduping by normalized symbol. Pyth wins ties because its
  // crypto prices are real-time on-chain vs Yahoo's cached retail feed.
  function mergeSearchResults(pythMatches, yahooMatches) {
    const seen = new Map();
    const add = (feed, fromPyth) => {
      const key = `${feed.category || ''}|${(feed.symbol || '').toUpperCase()}`;
      if (seen.has(key)) return;
      seen.set(key, { ...feed, provider: fromPyth ? 'pyth' : 'yahoo' });
    };
    for (const f of pythMatches) add(f, true);
    for (const f of yahooMatches) add(f, false);
    return Array.from(seen.values()).slice(0, 25);
  }

  function renderSelectedFeed(feed) {
    if (!addPositionPythSelection) return;
    if (!feed) {
      addPositionPythSelection.style.display = 'none';
      addPositionPythSelection.innerHTML = '';
      return;
    }
    const label = categoryLabel(feed.category);
    const name = feed.name && feed.name !== feed.symbol ? ` — ${escapeHtml(feed.name)}` : '';
    let hint = '';
    if (feed.marketHours === 'us-equity') {
      hint = '<div style="margin-top: 4px; opacity: 0.7;">Prices update only during US market hours (9:30–16:00 ET, Mon–Fri).</div>';
    }
    const exchange = feed.exchange ? `<span style="opacity: 0.6;"> · ${escapeHtml(feed.exchange)}</span>` : '';
    const currency = quoteCurrencyForFeed(feed);
    const currencyHint = currency
      ? `<div style="margin-top: 4px; opacity: 0.7;">Entry price should be entered in ${escapeHtml(currency)}.</div>`
      : '<div style="margin-top: 4px; opacity: 0.7;">Entry price should use this ticker’s quote currency.</div>';
    addPositionPythSelection.innerHTML =
      `<strong>${escapeHtml(feed.symbol)}</strong>${name}` +
      (label ? ` <span style="opacity: 0.6;">· ${label}</span>` : '') +
      exchange +
      currencyHint +
      hint;
    addPositionPythSelection.style.display = 'block';
  }

  function renderSearchResults(matches) {
    if (!addPositionPythResults) return;
    addPositionPythResults.innerHTML = '';
    if (matches.length === 0) {
      addPositionPythResults.style.display = 'none';
      return;
    }
    addPositionPythResults.style.display = 'block';
    matches.forEach(feed => {
      const resultDiv = document.createElement('div');
      resultDiv.className = 'watchlist-search-result';
      resultDiv.style.cursor = 'pointer';
      resultDiv.style.padding = '6px 8px';
      resultDiv.style.display = 'flex';
      resultDiv.style.justifyContent = 'space-between';
      resultDiv.style.gap = '8px';
      const label = categoryLabel(feed.category);
      const name = feed.name && feed.name !== feed.symbol ? escapeHtml(feed.name) : '';
      const exchange = feed.exchange ? ` <span style="opacity: 0.5; font-size: 0.8em;">(${escapeHtml(feed.exchange)})</span>` : '';
      resultDiv.innerHTML =
        `<span><strong>${escapeHtml(feed.symbol)}</strong>${name ? ` <span style="opacity: 0.7;">— ${name}</span>` : ''}${exchange}</span>` +
        (label ? `<span style="opacity: 0.6; font-size: 0.85em;">${label}</span>` : '');
      resultDiv.addEventListener('click', () => {
        selectedPythFeed = feed;
        addPositionPythSearch.value = feed.symbol;
        addPositionPythResults.innerHTML = '';
        addPositionPythResults.style.display = 'none';
        renderSelectedFeed(feed);
        updateEntryPriceCurrencyUi(feed, { showHint: true });
        if (addPositionPythEntryDate?.value) {
          fetchHistoricalEntryPrice(feed, addPositionPythEntryDate.value).catch(() => {});
        }
      });
      addPositionPythResults.appendChild(resultDiv);
    });
  }

  // Debounced merged search: local Pyth results show instantly, Yahoo results arrive ~250ms
  // later and are merged in. Each keystroke supersedes the previous Yahoo call via searchSeq.
  let searchDebounce = null;
  let searchSeq = 0;

  if (addPositionPythSearch) {
    addPositionPythSearch.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      clearTimeout(searchDebounce);

      if (!query || !addPositionPythResults) {
        if (addPositionPythResults) {
          addPositionPythResults.innerHTML = '';
          addPositionPythResults.style.display = 'none';
        }
        return;
      }

      const feeds = allPythFeeds || [];
      const pythMatches = rankFeedMatches(query, feeds);
      renderSearchResults(pythMatches);

      const seq = ++searchSeq;
      searchDebounce = setTimeout(async () => {
        const stocksProvider = window.AppModules?.data?.providers?.stocks;
        if (!stocksProvider?.searchSymbols) return;
        try {
          const yahoo = await stocksProvider.searchSymbols(query, { limit: 15 });
          if (seq !== searchSeq) return; // newer query superseded this one
          renderSearchResults(mergeSearchResults(pythMatches, yahoo));
        } catch (err) {
          console.warn('[Search] Yahoo search failed:', err?.message || err);
        }
      }, 250);
    });
  }

  // Look up the close on a given date and pre-fill the entry-price field. Routed to the
  // appropriate provider based on the selected feed: Pyth for its on-chain crypto feeds,
  // Yahoo for stocks/ETFs/FX/indices. Pre-fill is non-authoritative — the user can override.
  // Empty-hint collapse is handled by CSS (`.help:empty { display: none }`).
  let historicalLookupSeq = 0;
  async function fetchHistoricalEntryPrice(feed, dateStr) {
    if (!feed || !dateStr) return;
    const mods = window.AppModules || {};
    const hint = addPositionPythEntryPriceHint;

    const token = ++historicalLookupSeq;
    if (hint) hint.textContent = 'Looking up entry price…';

    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) return;
    if (Date.UTC(y, m - 1, d) > Date.now()) {
      if (hint) hint.textContent = 'Date must be in the past.';
      return;
    }

    let price = null;
    let sourceLabel = '';
    let currency = quoteCurrencyForFeed(feed);
    try {
      if (feed.provider === 'yahoo' || (!feed.id && feed.symbol)) {
        price = await mods.data?.providers?.stocks?.getHistoricalPrice?.(feed.symbol, dateStr);
        sourceLabel = 'Yahoo';
      } else if (feed.id) {
        // 16:00 UTC picks a liquid intraday moment for equities; crypto/FX/metal tick continuously.
        const ts = Math.floor(Date.UTC(y, m - 1, d, 16, 0, 0) / 1000);
        const prices = await mods.data?.providers?.pyth?.getAtTimestampByFeedIds?.([feed.id], ts, 10000);
        price = prices ? prices[feed.id.toLowerCase()] : null;
        sourceLabel = 'Pyth';
      }
      if (token !== historicalLookupSeq) return;

      if (Number.isFinite(price) && price > 0) {
        if (addPositionPythEntryPrice && !addPositionPythEntryPrice.dataset.userEdited) {
          // Keep meaningful precision but trim trailing zeros so the input stays readable.
          addPositionPythEntryPrice.value = price.toFixed(6).replace(/\.?0+$/, '');
        }
        if (hint) {
          hint.textContent = `${sourceLabel} price on ${dateStr}: ${formatPriceWithCurrency(price, currency)}`;
        }
      } else if (hint) {
        hint.textContent = 'No historical price available — enter manually.';
      }
    } catch (e) {
      if (token !== historicalLookupSeq) return;
      if (hint) hint.textContent = 'Historical lookup failed — enter price manually.';
    }
  }

  if (addPositionPythEntryDate) {
    addPositionPythEntryDate.addEventListener('change', () => {
      if (!selectedPythFeed) {
        if (addPositionPythEntryPriceHint) {
          addPositionPythEntryPriceHint.textContent = 'Pick a ticker first to auto-fill the price.';
        }
        return;
      }
      // Reset userEdited so a fresh lookup can populate when the user changes dates; they can
      // still type over the value afterwards.
      if (addPositionPythEntryPrice) delete addPositionPythEntryPrice.dataset.userEdited;
      fetchHistoricalEntryPrice(selectedPythFeed, addPositionPythEntryDate.value).catch(() => {});
    });
  }

  // Respect manual edits to the entry-price field: once the user types, we stop overwriting it.
  if (addPositionPythEntryPrice) {
    addPositionPythEntryPrice.addEventListener('input', () => {
      addPositionPythEntryPrice.dataset.userEdited = '1';
    });
  }

  if (savePositionBtn) {
    savePositionBtn.addEventListener('click', async () => {
      const s = getSettings();

      // Ensure cryptoPositions array exists
      if (!s.cryptoPositions) {
        s.cryptoPositions = [];
      }

      let savedPosition = null;

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

        // Route the saved position to the right provider:
        //   - Pyth feed (has feed id): type: 'pyth'  → on-chain real-time price via Pyth
        //   - Yahoo feed (no id):     type: 'stock' → Yahoo Finance quote lookup
        // Both share the same PnL math in manual-fetcher; only the price source differs.
        const provider = selectedPythFeed.provider || (selectedPythFeed.id ? 'pyth' : 'yahoo');
        if (provider === 'yahoo') {
          savedPosition = {
            type: 'stock',
            symbol: selectedPythFeed.symbol,
            amount,
            entryPrice,
            category: selectedPythFeed.category || 'equity',
            currency: quoteCurrencyForFeed(selectedPythFeed) || null,
            name: selectedPythFeed.name || selectedPythFeed.symbol,
            exchange: selectedPythFeed.exchange || null,
            entryDate: addPositionPythEntryDate?.value || null
          };
        } else {
          savedPosition = {
            type: 'pyth',
            symbol: selectedPythFeed.symbol,
            feedId: selectedPythFeed.id,
            amount,
            entryPrice,
            category: selectedPythFeed.category || 'crypto',
            currency: 'USD',
            name: selectedPythFeed.name || selectedPythFeed.symbol,
            entryDate: addPositionPythEntryDate?.value || null
          };
        }
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
        savedPosition = {
          type: 'custom',
          name: name,
          symbol: name,
          amount: 1,
          price: value,
          value: value,
          currency: editingCustomCurrency || s.portfolioBaseCurrency || 'USD'
        };
      }

      try {
        if (savedPosition) {
          if (editingManualPositionIndex !== null && s.cryptoPositions[editingManualPositionIndex]) {
            s.cryptoPositions[editingManualPositionIndex] = savedPosition;
          } else {
            s.cryptoPositions.push(savedPosition);
          }
        }
        localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
        closeAddPosition();

        // Soft reload: re-fetch positions without full page refresh
        await renderPortfolioIncremental();
      } catch (e) {
        alert('Failed to save position: ' + e.message);
      }
    });
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  // Check if app has been closed for a while (detect stale sessions)
  const lastLoadTime = localStorage.getItem('lastLoadTime');
  const now = Date.now();
  const timeSinceLastLoad = lastLoadTime ? now - parseInt(lastLoadTime, 10) : Infinity;
  const shouldForceFresh = !lastLoadTime || timeSinceLastLoad > 60000; // 1 minute

  // Store current load time
  localStorage.setItem('lastLoadTime', now.toString());

  // Clear HTTP cache to ensure fresh data on page load
  const HttpClient = window.AppModules?.http?.HttpClient;
  if (HttpClient?._internal?.memoryCacheByKey) {
    HttpClient._internal.memoryCacheByKey.clear();
  }

  // Clear in-flight requests to prevent using stale deduplicated requests
  if (HttpClient?._internal?.inFlightByKey) {
    HttpClient._internal.inFlightByKey.clear();
  }

  // Force service worker update if outdated or stale session
  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.update();
      }
      // Clear API cache if this is a fresh session or stale
      if (shouldForceFresh && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_API_CACHE' });
      }
    } catch (e) {
      // Silently ignore SW update failures
    }
  }



  // Display version dynamically from service worker
  const versionDisplay = document.getElementById('versionDisplay');
  if (versionDisplay) {
    // Try to get version from service worker
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      const messageChannel = new MessageChannel();
      messageChannel.port1.onmessage = (event) => {
        if (event.data?.version && event.data?.timestamp) {
          const buildDate = new Date(event.data.timestamp).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'UTC'
          });
          versionDisplay.textContent = `${event.data.version} (${buildDate} UTC)`;
        }
      };
      navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' }, [messageChannel.port2]);
    } else {
      // Fallback to APP_VERSION if no service worker
      versionDisplay.textContent = `v${APP_VERSION}`;
    }
  }

  // Init theme
  const Themes = window.AppModules?.core?.themes;
  const Settings = window.AppModules?.core?.settings;
  const settings = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};


  // Apply alignment
  const applyAlignment = () => {
    const container = document.querySelector('.container');
    if (container) {
      if (true) {
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
        localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));

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
        localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));

        // Sync desktop dropdown
        if (themeSelect) themeSelect.value = newTheme;
      });
    }
  }

  // Init font size
  let fontSize = settings?.fontSize;
  if (typeof fontSize === 'string' || !fontSize) {
    fontSize = 14; // Default if it's a string or not set
  }
  applyFontSize(fontSize);

  // Apply visibility settings via body classes (CSS handles the rest)
  const applyVisibilityClasses = () => {
    const body = document.body;

    // Button visibility
    body.classList.toggle('hide-snow-btn', settings.hideSnowBtn ?? true);
    body.classList.toggle('hide-rain-btn', settings.hideRainBtn ?? true);
    body.classList.toggle('hide-font-size', settings.hideFontSize ?? true);
    body.classList.toggle('hide-theme-btn', settings.hideThemeBtn ?? false);
    body.classList.toggle('hide-amounts-btn', settings.hideAmountsBtn ?? false);
    body.classList.toggle('hide-donate-btn', settings.hideDonateBtn ?? true);
    body.classList.toggle('hide-stickers-btn', settings.hideStickersBtn ?? true);

    // Section visibility
    body.classList.toggle('hide-watchlist', settings.hideWatchlist ?? false);
    body.classList.toggle('hide-comic', settings.hideComic ?? false);
    body.classList.toggle('mono-pnl', !(settings.useColoredPnL ?? false));
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
      if (toggleRainBtn) toggleRainBtn.textContent = 'Rain Off';
      if (toggleRainBtnMobile) toggleRainBtnMobile.textContent = 'Rain Off';
    } else if (settings.snowEnabled && !settings.rainEnabled) {
      Rain.toggleSnow();
      if (toggleSnowBtn) toggleSnowBtn.textContent = 'Snow Off';
      if (toggleSnowBtnMobile) toggleSnowBtnMobile.textContent = 'Snow Off';
    }
  }

  // Restore saved sticky stickers (lazy load module only if stickers exist)
  const savedStickers = localStorage.getItem('stickyStickers.v1');
  if (savedStickers && savedStickers !== '[]') {
    import('./modules/features/stickers.js')
      .then(mod => mod.restoreStickyStickers())
      .catch(e => console.warn('[Stickers] Failed to restore:', e));
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

  // Greeting container click to refresh with ASCII spinner
  const greetingContainer = document.querySelector('.greeting-container');
  const greetingEl = document.getElementById('newGreeting');

  if (greetingContainer && greetingEl) {
    greetingContainer.style.cursor = 'pointer';
    greetingContainer.style.userSelect = 'none';

    let spinnerInterval = null;
    let spinnerEl = null;

    const startSpinner = () => {
      // Check if a spinner already exists (prevent duplicates)
      if (document.getElementById('greetingLoader') || greetingEl.querySelector('span[style*="marginLeft"]')) {
        return;
      }

      // Pick a random spinner each time
      const { frames, interval } = getRandomSpinner();
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
      }, interval);
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

    greetingContainer.addEventListener('click', async () => {
      if (spinnerInterval) return; // Already refreshing

      const summaryEl = document.getElementById('newSummary');

      try {
        startSpinner();

        // Apply pulsing animation (like comics)
        if (summaryEl) {
          summaryEl.classList.add('fading');
        }

        // Clear existing positions to prevent duplication
        if (window._portfolioRenderer) {
          window._portfolioRenderer.clearPositions();
        }

        await renderPortfolioIncremental();

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
            await watchlistModule.refreshWatchlist().catch(() => { });
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

  // Setup pull-to-refresh for mobile
  setupPullToRefresh();

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



  // NON-CRITICAL: Health checks in background
  runHealthChecks().catch(() => { });

  // NON-CRITICAL: Keyboard shortcuts (lazy loaded if enabled)
  if (settings.enableKeyboardShortcuts) {
    import('./modules/features/keyboard-shortcuts.js')
      .then(mod => mod.init())
      .catch(e => console.warn('[Keyboard] Failed to load:', e));
  }

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
          if (btn) btn.textContent = 'Snow Off';
          if (mobileBtn) mobileBtn.textContent = 'Snow Off';
        } else if (weather.isRaining) {
          Rain.toggleRain();
          const btn = document.getElementById('newToggleRainBtn');
          const mobileBtn = document.getElementById('newToggleRainBtnMobile');
          if (btn) btn.textContent = 'Rain Off';
          if (mobileBtn) mobileBtn.textContent = 'Rain Off';
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
      try {
        comicEl.scrollLeft = 0;
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
          localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
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

    // Flag to prevent double-loading from both IntersectionObserver and idle callback
    let comicLoaded = false;
    const loadComicOnce = () => {
      if (comicLoaded) return;
      comicLoaded = true;
      loadComic();
    };

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            io.disconnect();
            loadComicOnce();
            break;
          }
        }
      }, { rootMargin: '400px' });
      io.observe(comicEl);
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => loadComicOnce(), { timeout: 10000 });
      } else {
        setTimeout(loadComicOnce, 10000);
      }
    } else {
      loadComicOnce();
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
      if ((!Array.isArray(cachedWatchlistData) || cachedWatchlistData.length === 0) && !watchlistBody.querySelector('tr')) {
        watchlistBody.innerHTML = `<tr><td colspan="4" class="loading">Loading...</td></tr>`;
      }
      try {
        const watchlistIds = settings.watchlist || [];
        const renderWatchlist = window.renderWatchlistPanel;
        if (typeof renderWatchlist === 'function') {
          await renderWatchlist({
            feedIdsOverride: watchlistIds,
            forceRefresh: false,
            editMode: watchlistEditMode,
            preserveCurrentData: true
          });
        } else {
          throw new Error('Watchlist renderer not initialized');
        }
      } catch (e) {
        watchlistBody.innerHTML = `<tr><td colspan="4" class="loading">Watchlist unavailable</td></tr>`;
      }
    };
    // Flag to prevent double-loading from both IntersectionObserver and idle callback
    let watchlistLoaded = false;
    const loadWatchlistOnce = () => {
      if (watchlistLoaded) return;
      watchlistLoaded = true;
      loadWatchlist();
    };

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            io.disconnect();
            loadWatchlistOnce();
            break;
          }
        }
      }, { rootMargin: '300px' });
      io.observe(watchlistBody);
      if ('requestIdleCallback' in window) {
        requestIdleCallback(loadWatchlistOnce, { timeout: 7000 });
      } else {
        setTimeout(loadWatchlistOnce, 7000);
      }
    } else {
      loadWatchlistOnce();
    }
  }

  // Periodic updates - just do a full refresh like initial load (it works correctly)
  let updateInterval = null;
  let refreshInProgress = false;
  let refreshQueued = false;

  async function refreshPortfolio() {
    if (refreshInProgress) {
      refreshQueued = true;
      return;
    }
    refreshInProgress = true;

    try {
      // Full re-fetch using the same path as initial load - this always works correctly
      await renderPortfolioIncremental();

      // Update watchlist separately
      const providers = window.AppModules?.data?.providers;
      const s = getSettings();
      const watchlistBody = document.getElementById('newWatchlistBody');

      if (watchlistBody && s.watchlist && s.watchlist.length > 0 && !watchlistEditMode && providers?.pyth) {
        try {
          const renderWatchlist = window.renderWatchlistPanel;
          if (typeof renderWatchlist === 'function') {
            await renderWatchlist({
              feedIdsOverride: s.watchlist,
              forceRefresh: true,
              editMode: false,
              preserveCurrentData: true
            });
          }
        } catch (e) {
          // Silently fail watchlist updates
        }
      }
    } catch (e) {
      console.warn('[Refresh] Failed:', e?.message || e);
    } finally {
      refreshInProgress = false;
      if (refreshQueued) {
        refreshQueued = false;
        queueMicrotask(() => { refreshPortfolio(); });
      }
    }
  }

  // Start periodic refresh after 30 seconds, then every 30 seconds
  setTimeout(() => {
    refreshPortfolio();
    updateInterval = setInterval(refreshPortfolio, 30000);
  }, 30000);

  // Cleanup on page unload (prevent memory leaks)
  window.addEventListener('beforeunload', () => {
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }
  });

  // Track when tab was last hidden
  let tabHiddenAt = null;

  // Resume updates when tab becomes visible again
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) {
      // Tab hidden - pause updates to save resources and track time
      tabHiddenAt = Date.now();
      if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
      }
    } else {
      // Tab visible again - force full refresh to get fresh data
      if (!updateInterval) {
        // Check if tab was hidden for a long time (more than 1 minute)
        const wasHiddenLong = tabHiddenAt && (Date.now() - tabHiddenAt) > 60000;

        // Clear HTTP cache to ensure fresh data
        const HttpClient = window.AppModules?.http?.HttpClient;
        if (HttpClient?._internal?.memoryCacheByKey) {
          HttpClient._internal.memoryCacheByKey.clear();
        }

        // Clear in-flight requests
        if (HttpClient?._internal?.inFlightByKey) {
          HttpClient._internal.inFlightByKey.clear();
        }

        // Force service worker to update and clear stale API cache if hidden long
        if ('serviceWorker' in navigator) {
          try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) {
              await registration.update();
            }
            // Clear API cache if tab was hidden for a while
            if (wasHiddenLong && navigator.serviceWorker.controller) {
              navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_API_CACHE' });
            }
          } catch (e) {
            // Silently ignore SW update failures
          }
        }

        // Full portfolio re-fetch
        try {
          await refreshPortfolio();
        } catch (e) {
          console.warn('[Visibility] Portfolio refresh failed:', e);
        }

        // Resume periodic refresh
        updateInterval = setInterval(refreshPortfolio, 30000);

        // Reset hidden time
        tabHiddenAt = null;
      }
    }
  });


});
