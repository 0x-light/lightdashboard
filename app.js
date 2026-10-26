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
import { setupSettingsDialog, applyAppearance } from './modules/ui/settings-dialog.js';
import { setupLarpSettings } from './modules/ui/larp-settings.js';
import { setupDialogFocus } from './modules/ui/dialog-focus.js';
import { setupRadioGroups } from './modules/ui/radio-groups.js';
import { setupTableScrollCues } from './modules/ui/table-scroll-cue.js';
import { showUndo } from './modules/ui/undo.js';
import { getRandomSpinner } from './modules/ui/unicode-animations.js';
import { formatMoney, normalizeBaseCurrency } from './modules/utils/currency.js';

// ============================================================================
// VERSION CHECKING
// ============================================================================
const APP_VERSION = '2.11.0';
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
  const hasIbkr = !!(settings.ibkrFlexToken && settings.ibkrFlexQueryId);

  const isEmpty = wallets.length === 0 && solanaAddrs.length === 0 && bitcoinAddrs.length === 0 && zcashAddrs.length === 0 && !hasManualPositions && !hasIbkr;
  // Empty portfolio: the hero sentence carries the call to action, so the (empty) positions
  // section is hidden rather than showing headers and buttons with nothing behind them.
  document.body.classList.toggle('portfolio-empty', isEmpty);

  if (isEmpty) {
    const summaryEl = document.getElementById('newSummary');
    const positionsBody = document.getElementById('newPositionsBody');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <p class="hero-sentence">Your portfolio is empty. <button type="button" class="link-button" data-empty-action="newSettingsBtn" data-empty-tab="accounts">Add a wallet</button> or <button type="button" class="link-button" data-empty-action="newAddPositionBtn">a position</button> to start tracking.</p>`;
      summaryEl.querySelectorAll('[data-empty-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          document.getElementById(btn.dataset.emptyAction)?.click();
          if (btn.dataset.emptyTab) {
            document.getElementById(`settingsTab-${btn.dataset.emptyTab}`)?.click();
            // Land in the field the link promised, not on the tab Settings focused as it opened
            document.getElementById(`settingsPane-${btn.dataset.emptyTab}`)?.querySelector('input, textarea, select')?.focus();
          }
        });
      });
    }
    if (positionsBody) positionsBody.innerHTML = '<tr><td colspan="9" class="loading">No wallets or positions configured</td></tr>';
    return;
  }

  // Build list of expected providers based on configuration
  const expectedProviders = [];
  if (wallets.length > 0) {
    expectedProviders.push('Hyperliquid', 'Lighter');
    // Onchain provider: whichever key is set, Zerion first
    if (settings.zerionApiKey) {
      expectedProviders.push('Zerion');
    } else if (settings.cieloApiKey) {
      expectedProviders.push('Cielo');
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
  if (hasIbkr) {
    expectedProviders.push('IBKR');
  }

  // Fetch weather data (non-blocking, will be used in hero summary)
  (async () => {
    try {
      const weatherLat = settings.weather?.lat;
      const weatherLon = settings.weather?.lon;
      let weatherLabel = settings.weather?.label || '';

      // No city set: no weather. (Number(null) is 0, which would be the sea off Ghana.)
      const isCoord = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
      const hasWeatherCoords = isCoord(weatherLat) && isCoord(weatherLon);
      // A place saved with coordinates but no name (older settings, or the name lookup
      // failed): look the name up once and keep it.
      if (hasWeatherCoords && !weatherLabel && mods.features?.weather?.placeName) {
        weatherLabel = await mods.features.weather.placeName(Number(weatherLat), Number(weatherLon));
        if (weatherLabel) {
          const s = getSettings();
          s.weather = { ...s.weather, label: weatherLabel };
          localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
          invalidateSettingsCache();
        }
      }
      if (!weatherLabel) weatherLabel = 'your location';
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

          const hour = Number(now.toLocaleString('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: window.larpTimeZone }));
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
    const makeRenderer = () => new IncrementalPortfolioRenderer({
      providers,
      settings,
      containers: {
        positionsBody: document.getElementById('newPositionsBody'),
        mobileContainer: document.getElementById('newMobilePositionsContainer'),
        summaryEl: document.getElementById('newSummary'),
        providerStatusEl: document.getElementById('newProviderStatus'),
        lastUpdatedEl: document.getElementById('lastUpdateTimestamp')
      },
      ui: { HeroUI, PositionsUI },
      expectedProviders
    });
    // Made before the fetchers load, so the saved snapshot is in the first frame. Demo mode
    // swaps the providers first, so it waits for them.
    const larp = document.documentElement.dataset.larp === 'on';
    let renderer = larp ? null : makeRenderer();

    // Load all fetchers in one parallel wave (sequential awaits cost one round trip each on a cold load).
    const [
      { HyperliquidFetcher },
      { LighterFetcher },
      { ZerionFetcher },
      { CieloFetcher },
      { AlchemyHeliusFetcher },
      { BitcoinZcashFetcher },
      { ManualFetcher },
      { IbkrFetcher }
    ] = await Promise.all([
      import('./modules/data/fetchers/hyperliquid-fetcher.js'),
      import('./modules/data/fetchers/lighter-fetcher.js'),
      import('./modules/data/fetchers/zerion-fetcher.js'),
      import('./modules/data/fetchers/cielo-fetcher.js'),
      import('./modules/data/fetchers/alchemy-helius-fetcher.js'),
      import('./modules/data/fetchers/bitcoin-fetcher.js'),
      import('./modules/data/fetchers/manual-fetcher.js'),
      import('./modules/data/fetchers/ibkr-fetcher.js')
    ]);

    // Demo mode (?demo): sample accounts in place of the real exchange and broker data
    if (larp) {
      (await import('./modules/larp/larp-data.js')).installLarp(providers);
      renderer = makeRenderer();
    }

    // Make renderer globally available for updates
    window._portfolioRenderer = renderer;

    const manager = new PortfolioManager(renderer, providers, settings);
    manager.registerFetcher('Hyperliquid', new HyperliquidFetcher(providers, renderer, settings));
    manager.registerFetcher('Lighter', new LighterFetcher(providers, renderer));
    manager.registerFetcher('Zerion', new ZerionFetcher(providers, renderer, settings));
    manager.registerFetcher('Cielo', new CieloFetcher(providers, renderer, settings));
    manager.registerFetcher('AlchemyHelius', new AlchemyHeliusFetcher(providers, renderer, settings));
    manager.registerFetcher('BitcoinZcash', new BitcoinZcashFetcher(providers, renderer));
    manager.registerFetcher('Manual', new ManualFetcher(providers, renderer, settings));
    manager.registerFetcher('IBKR', new IbkrFetcher(providers, renderer, settings));

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
  if (!window._portfolioManager.isFetching) {
    window._portfolioRenderer?.beginRefresh?.(expectedProviders);
  }
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


// Expose to window for incremental renderer
window.hideSmallPositions = hideSmallPositions;
window.showHiddenPositions = showHiddenPositions;
window.hiddenAssets = hiddenAssets;
window.editMode = editMode;
window.cachedPositions = cachedPositions;
window.cachedWeather = cachedWeather;
window.cachedSummaryData = cachedSummaryData;





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


// Greeting uses the saved name; the settings window calls this again on close
function updateGreeting() {
  const greetingEl = document.getElementById('newGreeting');
  if (greetingEl) {
    const hour = Number(new Date().toLocaleString('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: window.larpTimeZone }));
    let timeOfDay = 'Good morning';
    if (hour >= 12 && hour < 18) timeOfDay = 'Good afternoon';
    else if (hour >= 18) timeOfDay = 'Good evening';

    const userName = (getSettings().userName || '').trim();
    greetingEl.textContent = userName ? `${timeOfDay}, ${userName}.` : `${timeOfDay}.`;
  }
}

// Rain and snow in the menu show their state, like Theme: "Rain off" reads as it is now.
function effectLabel(name, on) {
  return `${name} <span class="pm-theme-current">${on ? 'on' : 'off'}</span>`;
}

function setupControls() {
  const settings = getSettings();

  // Fonts, text size, sections and optional menu buttons
  applyAppearance(settings);

  // Pop-ups take focus when they open and hand it back when they close
  setupDialogFocus();
  // Chart period switches: arrow keys choose, one Tab stop per group
  setupRadioGroups();
  setupTableScrollCues();

  // Toggle groups (comic strip, position type) mark the current choice with `.active`; mirror it
  // as aria-pressed so screen readers hear which one is on, whichever code path flips the class
  const pressedObserver = new MutationObserver(records => records.forEach(({ target }) => {
    target.setAttribute('aria-pressed', String(target.classList.contains('active')));
  }));
  document.querySelectorAll('.comic-tab, .btn-tab').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.classList.contains('active')));
    pressedObserver.observe(btn, { attributes: true, attributeFilter: ['class'] });
  });



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

  // Positions: a row opens in place (click it, or Enter when it has focus) to show its
  // details and actions. Actions save straight away and offer an undo line instead of
  // asking first; there is no separate edit mode.
  const positionsBody = document.getElementById('newPositionsBody');

  function rerenderPositions() {
    window._portfolioRenderer?.forceRender();
  }

  function positionRows() {
    return Array.from(positionsBody?.querySelectorAll('tr.position-row') || []);
  }

  // Rows are rebuilt on render, so focus is handed over by key.
  function focusPositionRow(key) {
    requestAnimationFrame(() => {
      positionRows().find(r => r.dataset.key === key)?.focus({ preventScroll: true });
    });
  }

  function toggleOpenPosition(row) {
    const key = row.dataset.key;
    window.openPositionKey = window.openPositionKey === key ? null : key;
    rerenderPositions();
    focusPositionRow(key);
    // A perp's ladder shows its TP/SL and limit orders; fetch them when one opens.
    if (window.openPositionKey && /_HL Perps$/.test(key)) loadHlOrders();
  }

  // Open Hyperliquid orders for every EVM wallet, kept 30s by hl-account.js.
  // window.hlOrders = { coin: [orders] }, read by the positions renderer.
  async function loadHlOrders() {
    const addresses = String(getSettings().walletAddresses || '').split(/[\s,]+/).filter(a => /^0x[0-9a-fA-F]{40}$/.test(a));
    if (!addresses.length) return;
    if (!window.hlOrders) {
      window.hlOrdersState = 'loading';
      rerenderPositions();
    }
    try {
      const { getOpenOrders } = await import('./modules/data/hl-account.js');
      window.hlOrders = await getOpenOrders(addresses);
      window.hlOrdersState = 'ready';
    } catch (e) {
      console.warn('[Orders] Could not load open orders:', e?.message || e);
      window.hlOrdersState = 'failed';
    }
    rerenderPositions();
  }

  function saveHiddenAssets() {
    window.hiddenAssets = hiddenAssets; // Update global for incremental renderer
    const s = getSettings();
    s.hiddenAssets = Array.from(hiddenAssets);
    localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
    invalidateSettingsCache();
    window.updateShowHiddenButton?.();
  }

  function setPositionHidden(assetKey, hidden) {
    if (hidden) hiddenAssets.add(assetKey); else hiddenAssets.delete(assetKey);
    saveHiddenAssets();
    rerenderPositions();
  }

  function deleteManualPosition(asset, manualType) {
    const s = getSettings();
    const before = Array.isArray(s.cryptoPositions) ? s.cryptoPositions : [];
    // Keep each removed entry with its index so undo puts it back where it was.
    const removed = before
      .map((position, index) => ({ position, index }))
      .filter(({ position }) => storedManualPositionMatches(position, asset, manualType));
    if (removed.length === 0) return;

    s.cryptoPositions = removeManualPositionByAsset(before, asset, manualType);
    // Also drop its hiddenAssets keys so it doesn't linger as hidden
    const manualKeys = getManualPositionHiddenKeys(asset);
    if (Array.isArray(s.hiddenAssets)) {
      s.hiddenAssets = s.hiddenAssets.filter(key => !manualKeys.includes(key));
    }
    localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
    invalidateSettingsCache();
    manualKeys.forEach(key => hiddenAssets.delete(key));
    window.hiddenAssets = hiddenAssets;

    // Remove it from the renderer's allPositions (the source of truth)
    window._portfolioRenderer?.removePositions(p => renderedManualPositionMatches(p, asset, manualType));

    showUndo(`Deleted ${asset}`, async () => {
      const t = getSettings();
      const list = Array.isArray(t.cryptoPositions) ? [...t.cryptoPositions] : [];
      removed.forEach(({ position, index }) => list.splice(Math.min(index, list.length), 0, position));
      t.cryptoPositions = list;
      localStorage.setItem('myDashboardSettings.v2', JSON.stringify(t));
      invalidateSettingsCache();
      await renderPortfolioIncremental();
    });
  }

  function runPositionAction(btn) {
    const asset = btn.getAttribute('data-asset') || '';
    const assetKey = btn.getAttribute('data-asset-key');
    const manualType = btn.getAttribute('data-manual-type');
    const row = btn.closest('tr.position-detail')?.previousElementSibling;
    const rowKey = row?.dataset.key;

    if (btn.classList.contains('position-edit-btn')) {
      // Hiding takes the row away (unless hidden rows are showing): close it and move
      // focus to the next row so the keyboard user keeps their place.
      const rows = positionRows();
      const next = rows[rows.indexOf(row) + 1] || rows[rows.indexOf(row) - 1];
      window.openPositionKey = null;
      setPositionHidden(assetKey, true);
      if (next) focusPositionRow(next.dataset.key);
      showUndo(`Hid ${asset}`, () => {
        setPositionHidden(assetKey, false);
        focusPositionRow(assetKey);
      });
    } else if (btn.classList.contains('position-restore-btn')) {
      setPositionHidden(assetKey, false);
      if (rowKey) focusPositionRow(rowKey);
      showUndo(`Showed ${asset}`, () => setPositionHidden(assetKey, true));
    } else if (btn.classList.contains('position-delete-btn')) {
      window.openPositionKey = null;
      deleteManualPosition(asset, manualType);
    } else if (btn.classList.contains('position-manual-edit-btn')) {
      openManualPositionEdit(asset, manualType);
    }
  }

  positionsBody?.addEventListener('click', (e) => {
    const btn = e.target.closest('button.row-action');
    if (btn) {
      runPositionAction(btn);
      return;
    }
    // Selecting text to copy a number shouldn't open or close the row
    if (window.getSelection()?.toString()) return;
    const row = e.target.closest('tr.position-row');
    // The 24h chart opens the chart window; the rest of the row opens the row.
    if (row && e.target.closest('td.chart-cell svg.sparkline')) {
      openPositionChart(row.dataset.key);
      return;
    }
    if (row) toggleOpenPosition(row);
  });

  // Sorting: a header click sorts by that column, largest first (A–Z for text); a
  // second click flips it, a third goes back to the default order (by value). The
  // choice is remembered in this browser.
  const positionsTable = document.getElementById('newPositionsTable');
  const TEXT_SORTS = new Set(['asset', 'exchange']);

  function applySortHeaders() {
    const sort = window.positionsSort;
    positionsTable?.querySelectorAll('th').forEach(th => {
      const key = th.querySelector('.th-sort')?.dataset.sort;
      if (!key) return;
      if (sort?.key === key) th.setAttribute('aria-sort', sort.dir === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
  }

  try { window.positionsSort = JSON.parse(localStorage.getItem('positionsSort') || 'null'); } catch (_) { window.positionsSort = null; }
  applySortHeaders();

  positionsTable?.querySelector('thead')?.addEventListener('click', (e) => {
    const key = e.target.closest('.th-sort')?.dataset.sort;
    if (!key) return;
    const first = TEXT_SORTS.has(key) ? 'asc' : 'desc';
    const current = window.positionsSort;
    let next;
    if (current?.key !== key) next = { key, dir: first };
    else if (current.dir === first) next = { key, dir: first === 'asc' ? 'desc' : 'asc' };
    else next = null;
    window.positionsSort = next;
    try { localStorage.setItem('positionsSort', JSON.stringify(next)); } catch (_) { /* sort just isn't remembered */ }
    applySortHeaders();
    rerenderPositions();
  });

  // Search: narrows the table to tickers or sources containing what's typed. / jumps
  // to the box from anywhere; Esc clears it.
  const positionsSearch = document.getElementById('newPositionsSearch');
  positionsSearch?.addEventListener('input', () => {
    window.positionsQuery = positionsSearch.value;
    window.openPositionKey = null;
    rerenderPositions();
  });
  positionsSearch?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (positionsSearch.value) {
        positionsSearch.value = '';
        window.positionsQuery = '';
        rerenderPositions();
      } else {
        positionsSearch.blur();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      positionRows()[0]?.focus();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = e.target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
    if (document.querySelector('[role="dialog"]:not([hidden])[style*="block"], [role="dialog"]:not([hidden])[style*="flex"]')) return;
    if (!positionsSearch || positionsSearch.offsetParent === null) return;
    e.preventDefault();
    positionsSearch.focus();
    positionsSearch.scrollIntoView({ block: 'center' });
  });

  // ↑ ↓ move between rows, Enter opens, Esc closes; on an open row its action keys work
  // (E edit, H hide or show, Delete/Backspace delete). Handled here so they don't also
  // reach the page-wide shortcuts.
  positionsBody?.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const row = e.target.closest('tr.position-row');
    const owner = row || e.target.closest('tr.position-detail')?.previousElementSibling;
    if (!owner) return;
    const rows = positionRows();
    const index = rows.indexOf(owner);

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      rows[index + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target === row) {
      e.preventDefault();
      toggleOpenPosition(row);
      return;
    }
    if (e.key === 'Escape' && window.openPositionKey) {
      e.preventDefault();
      e.stopPropagation();
      window.openPositionKey = null;
      rerenderPositions();
      focusPositionRow(owner.dataset.key);
      return;
    }
    if (window.openPositionKey !== owner.dataset.key) return;
    const shortcut = e.key === 'Backspace' || e.key === 'Delete' ? 'delete' : e.key.toLowerCase();
    const btn = owner.nextElementSibling?.querySelector(`[data-shortcut="${shortcut}"]`);
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      runPositionAction(btn);
    }
  });

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
      amountsBtn.textContent = amountsVisible ? 'Hide amounts' : 'Show amounts';

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



  // Shows new settings: the greeting, the watchlist and the positions, refetched.
  const showSettings = async (newSettings) => {
    updateGreeting();
    if (newSettings.watchlist && newSettings.watchlist.length > 0) {
      try {
        await renderWatchlistPanel({
          feedIdsOverride: newSettings.watchlist,
          forceRefresh: false,
          editMode: watchlistEditMode,
          preserveCurrentData: true
        });
      } catch (_) {
        // Keep the current rows if the re-render fails
      }
    }
    await renderPortfolioIncremental();
  };
  // Demo edits show while the dialog is open.
  setupLarpSettings({ invalidateSettingsCache, refresh: () => showSettings(getSettings()) });
  // Settings dialog (modules/ui/settings-dialog.js). Changes save as you go; closing refetches
  // positions only when wallets, keys or number formatting changed.
  setupSettingsDialog({
    getSettings,
    invalidateSettingsCache,
    onClose: async (newSettings, { dataChanged }) => {
      if (dataChanged) await showSettings(newSettings);
      else updateGreeting();
    }
  });

  // Rain/Snow controls
  const Rain = window.AppModules?.features?.rain;
  const toggleRainBtn = document.getElementById('newToggleRainBtn');
  const toggleSnowBtn = document.getElementById('newToggleSnowBtn');
  const toggleRainBtnMobile = document.getElementById('newToggleRainBtnMobile');
  const toggleSnowBtnMobile = document.getElementById('newToggleSnowBtnMobile');

  if (Rain && toggleRainBtn) {
    toggleRainBtn.addEventListener('click', () => {
      const active = Rain.toggleRain();
      toggleRainBtn.innerHTML = effectLabel('Rain', active);
      if (toggleRainBtnMobile) {
        toggleRainBtnMobile.innerHTML = effectLabel('Rain', active);
      }
      if (active) {
        toggleSnowBtn.innerHTML = effectLabel('Snow', false);
        if (toggleSnowBtnMobile) toggleSnowBtnMobile.innerHTML = effectLabel('Snow', false);
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
      toggleSnowBtn.innerHTML = effectLabel('Snow', active);
      if (toggleSnowBtnMobile) {
        toggleSnowBtnMobile.innerHTML = effectLabel('Snow', active);
      }
      if (active) {
        toggleRainBtn.innerHTML = effectLabel('Rain', false);
        if (toggleRainBtnMobile) toggleRainBtnMobile.innerHTML = effectLabel('Rain', false);
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
      toggleRainBtnMobile.innerHTML = effectLabel('Rain', active);
      if (toggleRainBtn) {
        toggleRainBtn.innerHTML = effectLabel('Rain', active);
      }
      if (active) {
        toggleSnowBtn.innerHTML = effectLabel('Snow', false);
        if (toggleSnowBtnMobile) toggleSnowBtnMobile.innerHTML = effectLabel('Snow', false);
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
      toggleSnowBtnMobile.innerHTML = effectLabel('Snow', active);
      if (toggleSnowBtn) {
        toggleSnowBtn.innerHTML = effectLabel('Snow', active);
      }
      if (active) {
        toggleRainBtn.innerHTML = effectLabel('Rain', false);
        if (toggleRainBtnMobile) toggleRainBtnMobile.innerHTML = effectLabel('Rain', false);
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
      button.textContent = 'Copied';
      const status = document.getElementById('newDonateStatus');
      if (status) status.textContent = 'Address copied';
      setTimeout(() => {
        button.textContent = originalText;
        if (status) status.textContent = '';
      }, 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
      alert('Cannot copy. Select the address and copy it.');
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

  // 1D / 1W / 1M / 1Y / All: every tile's chart and change over that period.
  document.querySelector('#watchlistSection .wl-periods')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.wl-period');
    if (!btn) return;
    const mod = await import('./modules/features/watchlist.js');
    mod.setPeriod(btn.dataset.period);
  });

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
    if (toStore.provider === 'yahoo' && entry.label) toStore.label = entry.label;

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
      showWatchlistSuggestions();
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

  // Before anything is typed: what you hold, then the markets most people follow.
  const WATCHLIST_MARKETS = [
    { provider: 'yahoo', symbol: '^GSPC', label: 'SPX', name: 'S&P 500', category: 'index', words: ['s&p', 's&p 500', 's&p500', 'sp500', 'sp 500', 'spx'] },
    { provider: 'yahoo', symbol: '^NDX', label: 'NDX', name: 'Nasdaq 100', category: 'index', words: ['nasdaq', 'nasdaq 100', 'ndx'] },
    { provider: 'yahoo', symbol: '^VIX', label: 'VIX', name: 'Cboe volatility', category: 'index', words: ['vix', 'volatility'] },
    { provider: 'yahoo', symbol: 'DX-Y.NYB', label: 'DXY', name: 'ICE US dollar', category: 'index', words: ['dxy', 'dollar', 'dollar index', 'us dollar'] },
    { provider: 'yahoo', symbol: '^TNX', label: 'US10Y', name: '10-year Treasury yield', category: 'index', words: ['us10y', '10y', '10 year', 'treasury', 'yield', 'bond', 'tnx'] },
    { provider: 'yahoo', symbol: 'GC=F', label: 'GOLD', name: 'Gold futures', category: 'commodity', words: ['gold', 'xau'] },
    { provider: 'yahoo', symbol: 'SI=F', label: 'SILVER', name: 'Silver futures', category: 'commodity', words: ['silver', 'xag'] },
    // Brent, the world's oil benchmark: Pyth's 24/7 spot, priced from the contract nearest expiry.
    { feed: 'BRENT', label: 'BRENT', name: 'Brent crude', words: ['oil', 'crude', 'brent'], fallback: { provider: 'yahoo', symbol: 'BZ=F', label: 'BRENT', name: 'Brent crude futures', category: 'commodity' } },
    { crypto: 'BTC', words: ['bitcoin'] },
    { crypto: 'ETH', words: ['ether', 'ethereum'] },
    { provider: 'yahoo', symbol: 'EURUSD=X', label: 'EUR/USD', name: 'Euro / US dollar', category: 'fx', words: ['euro', 'eur', 'eurusd', 'eur/usd'] }
  ];
  // Searched for by name, not suggested.
  const SEARCH_MARKETS = [
    { provider: 'yahoo', symbol: 'CL=F', label: 'WTI', name: 'WTI crude futures', category: 'commodity', words: ['wti', 'oil', 'crude'] },
    { feed: 'NATGAS', label: 'NATGAS', name: 'Natural gas', words: ['gas', 'natural gas', 'natgas', 'henry hub'], fallback: { provider: 'yahoo', symbol: 'NG=F', label: 'NATGAS', name: 'Natural gas futures', category: 'commodity' } },
    { provider: 'yahoo', symbol: '^DJI', label: 'DOW', name: 'Dow Jones industrial average', category: 'index', words: ['dow', 'dow jones', 'djia'] },
    { provider: 'yahoo', symbol: '^RUT', label: 'RUT', name: 'Russell 2000', category: 'index', words: ['russell', 'russell 2000', 'rut'] }
  ];
  const CASH_OR_STABLE = /^(USD|EUR|GBP|CHF|JPY|CAD|AUD|USDC|USDT0?|DAI|USDE|USDH|USDS|FDUSD|PYUSD|USDHL)$/;

  function feedForSymbol(symbol, preferCrypto = true) {
    const matches = (allPythFeeds || []).filter(f => (f.symbol || '').toUpperCase() === symbol);
    return matches.find(f => (f.category === 'crypto') === preferCrypto) || matches[0] || null;
  }

  // Your biggest holdings, one row per ticker. Options, cash and stablecoins are left out.
  function positionSuggestions() {
    const totals = new Map();
    for (const p of window.cachedPositions || []) {
      if (p.isHlAccountEquity || p.isLighterAccountEquity || p.underlyingPrice != null || p._strategy) continue;
      // Hyperliquid's builder-deployed perps carry their dex: "xyz:AAPL" is AAPL.
      const symbol = String(p.asset || '').replace(/^[a-z0-9]+:/i, '').trim().toUpperCase();
      if (!symbol || CASH_OR_STABLE.test(symbol)) continue;
      const t = totals.get(symbol) || { symbol, value: 0, stock: false, name: null };
      t.value += Math.abs(Number(p.value) || 0);
      if (/IBKR/i.test(p.exchange || '')) t.stock = true;
      t.name = t.name || p.name || null;
      totals.set(symbol, t);
    }
    const out = [];
    for (const t of [...totals.values()].sort((a, b) => b.value - a.value)) {
      const feed = feedForSymbol(t.symbol, !t.stock);
      if (feed) out.push({ ...feed, provider: 'pyth' });
      else if (t.stock) out.push({ provider: 'yahoo', symbol: t.symbol, name: t.name, category: 'equity' });
      if (out.length === 8) break;
    }
    return out;
  }

  function marketFeed(m) {
    if (m.feed) {
      const feed = feedForSymbol(m.feed, false);
      return feed ? { ...feed, provider: 'pyth', label: m.label, name: m.name } : m.fallback;
    }
    if (!m.crypto) return m;
    const feed = feedForSymbol(m.crypto);
    return feed ? { ...feed, provider: 'pyth' } : null;
  }

  function marketSuggestions() {
    return WATCHLIST_MARKETS.map(marketFeed).filter(Boolean);
  }

  // Everyday words lead to the market they mean: "oil" to Brent and WTI, "s&p" to the S&P 500,
  // ahead of the tickers that only contain the word. A word matches from its third letter.
  function withMarkets(query, feeds) {
    const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!q) return feeds;
    const named = [...WATCHLIST_MARKETS, ...SEARCH_MARKETS]
      .filter(m => (m.words || []).some(w => w === q || (q.length >= 3 && w.startsWith(q))))
      .map(marketFeed).filter(Boolean);
    // The same market from another source (Pyth's EUR/USD and Yahoo's) shows once.
    const keys = new Set(named.map(watchlistEntryKey));
    const names = new Set(named.map(f => `${f.category}|${(f.label || f.symbol || '').toUpperCase()}`));
    return [...named, ...feeds.filter(f => !keys.has(watchlistEntryKey(f.provider ? f : { provider: 'pyth', id: f.id })) &&
      !names.has(`${f.category}|${(f.label || f.symbol || '').toUpperCase()}`))];
  }

  let showWatchlistSuggestions = () => {};

  if (watchlistSearchInput) {
    // Keys (composite) that were just added during this search session. The dedupe against
    // the persisted watchlist is separate — this set only stops double-clicks.
    const addedKeys = new Set();
    let watchlistSearchDebounce = null;
    let watchlistSearchSeq = 0;
    // Last price per entry key, so a re-render (Yahoo results merging in) shows it at once.
    const searchPrices = new Map();

    function setSearchPrice(key, text) {
      watchlistSearchResults?.querySelectorAll('.result-price').forEach(el => {
        if (el.dataset.priceKey === key) el.textContent = text;
      });
    }

    // The provider keys prices by lowercase id with the 0x prefix.
    const pythPriceKey = id => {
      const lower = String(id).toLowerCase();
      return lower.startsWith('0x') ? lower : `0x${lower}`;
    };

    // Each row shows the current price, to tell apart look-alike tickers.
    async function fillSearchPrices(rows) {
      const providers = window.AppModules?.data?.providers;
      const missing = rows.filter(r => !searchPrices.has(r.key));
      missing.forEach(r => searchPrices.set(r.key, null));
      const pyth = missing.filter(r => r.entry.provider === 'pyth' && r.entry.id);
      const yahoo = missing.filter(r => r.entry.provider === 'yahoo' && r.entry.symbol);
      const show = (row, price, currency) => {
        if (!Number.isFinite(price) || price <= 0) {
          searchPrices.delete(row.key);
          setSearchPrice(row.key, '—');
          return;
        }
        const text = formatPriceWithCurrency(price, currency);
        searchPrices.set(row.key, text);
        setSearchPrice(row.key, text);
      };
      await Promise.all([
        pyth.length && providers?.pyth?.getLatestByFeedIds?.(pyth.map(r => r.entry.id))
          .then(prices => pyth.forEach(r => show(r, prices?.[pythPriceKey(r.entry.id)], 'USD')))
          .catch(() => pyth.forEach(r => show(r, null))),
        yahoo.length && providers?.stocks?.getQuotes?.(yahoo.map(r => r.entry.symbol))
          .then(quotes => yahoo.forEach(r => {
            const q = quotes?.[r.entry.symbol];
            // An index is a level and a yield a percent: neither is in a currency.
            show(r, q?.price, r.feed?.category === 'index' ? '' : q?.currency || quoteCurrencyForFeed(r.feed));
          }))
          .catch(() => yahoo.forEach(r => show(r, null)))
      ]);
    }

    // `groups` is [{ title?, feeds }]; a search has one group without a title.
    function renderWatchlistSearchRows(groups) {
      if (!watchlistSearchResults) return;
      const watchlistKeys = currentWatchlistKeys();

      if (groups.every(g => g.feeds.length === 0)) {
        watchlistSearchResults.innerHTML = '<p class="search-empty">No results.</p>';
        watchlistSearchResults.style.display = 'block';
        return;
      }

      watchlistSearchResults.innerHTML = '';
      watchlistSearchResults.style.display = 'block';
      const priceRows = [];
      groups.filter(g => g.feeds.length > 0).forEach(group => {
        if (group.title) {
          const heading = document.createElement('p');
          heading.className = 'search-group';
          heading.textContent = group.title;
          watchlistSearchResults.appendChild(heading);
        }
        group.feeds.forEach(feed => {
          // Wrap the raw feed in an entry object matching our storage format so the key is
          // computed identically to what's persisted / rendered downstream.
          const entry = feed.provider === 'yahoo'
            ? { provider: 'yahoo', symbol: feed.symbol, label: feed.label, name: feed.name, category: feed.category }
            : { provider: 'pyth', id: feed.id };
          const key = watchlistEntryKey(entry);

          const resultDiv = document.createElement('div');
          resultDiv.className = 'watchlist-search-result';

          const isInWatchlist = watchlistKeys.has(key);
          const isAdded = addedKeys.has(key);
          if (isInWatchlist || isAdded) resultDiv.classList.add('added');

          const label = categoryLabel(feed.category);
          const name = feed.name && feed.name !== feed.symbol ? ` <span class="result-meta">— ${escapeHtml(feed.name)}</span>` : '';
          resultDiv.innerHTML = `
            <span><strong>${escapeHtml(feed.label || feed.symbol)}</strong>${name}${label ? ` <span class="result-meta">${label}</span>` : ''}</span>
            <span class="result-price" data-price-key="${escapeHtml(key)}">${escapeHtml(searchPrices.get(key) || '…')}</span>
            <button type="button" class="btn-text ${isInWatchlist || isAdded ? 'added' : ''}" data-entry-key="${key}"
              aria-label="${isInWatchlist ? 'In watchlist' : isAdded ? 'Added' : 'Add'}: ${escapeHtml(feed.label || feed.symbol)}"${isInWatchlist || isAdded ? ' disabled' : ''}>
              ${isInWatchlist ? 'In list' : isAdded ? 'Added' : 'Add'}
            </button>
          `;

          const btn = resultDiv.querySelector('button');
          if (!isInWatchlist) {
            btn.addEventListener('click', () => {
              if (!addedKeys.has(key)) {
                addToWatchlist(entry);
                addedKeys.add(key);
                btn.textContent = 'Added';
                btn.setAttribute('aria-label', `Added: ${feed.label || feed.symbol}`);
                btn.classList.add('added');
                resultDiv.classList.add('added');
                // Keep focus in the results rather than dropping it to the page when the button disables
                btn.setAttribute('aria-disabled', 'true');
              }
            });
          }

          watchlistSearchResults.appendChild(resultDiv);
          priceRows.push({ key, entry, feed });
        });
      });
      fillSearchPrices(priceRows);
    }

    showWatchlistSuggestions = () => {
      ++watchlistSearchSeq; // drop a search still in flight
      const held = positionSuggestions();
      const heldKeys = new Set(held.map(f => watchlistEntryKey(f)));
      renderWatchlistSearchRows([
        { title: 'Your positions', feeds: held },
        { title: 'Markets', feeds: marketSuggestions().filter(f => !heldKeys.has(watchlistEntryKey(f))) }
      ]);
    };

    function performSearch(query) {
      if (!watchlistSearchResults) return;
      clearTimeout(watchlistSearchDebounce);

      if (!query) {
        showWatchlistSuggestions();
        return;
      }

      const feeds = allPythFeeds || [];
      const pythMatches = rankFeedMatches(query, feeds);
      // Instant feedback from local Pyth corpus; Yahoo results arrive shortly after.
      renderWatchlistSearchRows([{ feeds: withMarkets(query, pythMatches) }]);

      const seq = ++watchlistSearchSeq;
      watchlistSearchDebounce = setTimeout(async () => {
        const stocksProvider = window.AppModules?.data?.providers?.stocks;
        if (!stocksProvider?.searchSymbols) return;
        try {
          const yahoo = await stocksProvider.searchSymbols(query, { limit: 25 });
          if (seq !== watchlistSearchSeq) return;
          renderWatchlistSearchRows([{ feeds: withMarkets(query, mergeSearchResults(query, pythMatches, yahoo)) }]);
        } catch (err) {
          console.warn('[Watchlist search] Yahoo search failed:', err?.message || err);
        }
      }, 250);
    }

    watchlistSearchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      performSearch(query);
    });

    // ↵ in the box adds the first match. ↓ moves into the results and ↑ ↓ between their Add
    // buttons; ↑ from the first goes back to the box.
    const resultButtons = () => Array.from(watchlistSearchResults?.querySelectorAll('button:not([disabled])') || []);
    watchlistSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        const first = resultButtons()[0];
        if (first) {
          e.preventDefault();
          first.focus();
        }
      } else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        resultButtons().find(b => b.getAttribute('aria-disabled') !== 'true')?.click();
      }
    });
    watchlistSearchResults?.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const buttons = resultButtons();
      const i = buttons.indexOf(e.target);
      if (i < 0) return;
      e.preventDefault();
      const next = buttons[i + (e.key === 'ArrowDown' ? 1 : -1)];
      (next || (e.key === 'ArrowUp' ? watchlistSearchInput : null))?.focus();
    });
  }

  // Watchlist: an item opens the chart window (click it, or Enter when it has focus),
  // which also has its Remove action. Removing saves straight away and offers an undo line.
  const watchlistTable = document.getElementById('newWatchlistTable');

  function watchlistItems() {
    return Array.from(document.querySelectorAll('#newWatchlistBody tr.watchlist-row'));
  }

  function focusWatchlistItem(key) {
    requestAnimationFrame(() => {
      watchlistItems().find(r => r.dataset.entryKey === key)?.focus({ preventScroll: true });
    });
  }

  // The chart window lists your positions and then the watchlist; it opens on one item of
  // one of them. Pyth's feeds name the positions' charts: they join the list once loaded.
  async function openChart(key, list) {
    loadAllPythFeeds().catch(() => null);
    const [watchlist, chartWindow] = await Promise.all([
      import('./modules/features/watchlist.js'),
      import('./modules/ui/chart-window.js')
    ]);
    chartWindow.openChartWindow({
      key,
      list,
      tilePeriod: watchlist.getPeriod(),
      search: searchChartItems,
      lists: [
        {
          id: 'positions',
          title: 'Positions',
          items: () => positionRows().map(positionChartItem).filter(Boolean),
          onClose: (shownKey) => { if (shownKey) focusPositionRow(shownKey); }
        },
        {
          id: 'watchlist',
          title: 'Watchlist',
          // The saved list decides, so a removed item drops out at once and an undo brings it back.
          items: () => {
            const saved = new Set((getSettings().watchlist || []).map(watchlistEntryKey));
            return watchlist.chartItems().filter(i => saved.has(i.key));
          },
          onRemove: removeFromWatchlist,
          onReorder: saveWatchlistOrder,
          onAdd: () => addToWatchlistBtn?.click(),
          onClose: (shownKey) => { if (shownKey) focusWatchlistItem(shownKey); }
        }
      ]
    });
  }

  // The chart window's + Add search: Pyth's feeds and Yahoo's symbols, as the watchlist's
  // search finds them, as chart items. Before you type, the watchlist's markets.
  async function searchChartItems(query) {
    const all = await loadAllPythFeeds();
    let feeds = query ? rankFeedMatches(query, all) : marketSuggestions();
    if (query) {
      try {
        const yahoo = await window.AppModules?.data?.providers?.stocks?.searchSymbols?.(query, { limit: 25 });
        if (yahoo) feeds = mergeSearchResults(query, feeds, yahoo);
      } catch (_) { /* Pyth's matches only */ }
    }
    return withMarkets(query, feeds).slice(0, 12).map(feed => {
      const kind = categoryLabel(feed.category);
      const name = feed.name && feed.name !== feed.symbol ? feed.name : null;
      if (feed.provider === 'yahoo') {
        const key = watchlistEntryKey({ provider: 'yahoo', symbol: feed.symbol });
        return { key, provider: 'yahoo', symbol: feed.symbol, label: feed.label || feed.symbol, name, category: feed.category, currency: quoteCurrencyForFeed(feed) || 'USD', kind };
      }
      const key = watchlistEntryKey({ provider: 'pyth', id: feed.id });
      return { key, provider: 'pyth', feedId: key.slice('pyth:'.length), symbol: feed.symbol, label: feed.label || feed.symbol, name, category: feed.category, currency: 'USD', kind };
    });
  }

  const openWatchlistChart = key => openChart(key, 'watchlist');

  // A position's chart: the same window, from its price feed (a stock from IBKR without a
  // feed, from Yahoo). ← → step through the positions that have a chart, in the table's order.
  function positionChartItem(row) {
    const pos = (window.cachedPositions || []).find(p => `${p.asset}_${p.exchange}` === row.dataset.key);
    if (!pos || !row.querySelector('td.chart-cell svg.sparkline')) return null;
    if (pos.isHlAccountEquity || pos.isLighterAccountEquity || pos.underlyingPrice != null) return null;
    // Hyperliquid's builder-deployed perps carry their dex: "xyz:AAPL" is AAPL.
    const symbol = String(pos.asset || '').replace(/^[a-z0-9]+:/i, '').trim().toUpperCase();
    if (!symbol || CASH_OR_STABLE.test(symbol)) return null;
    const stock = /IBKR/i.test(pos.exchange || '');
    const feed = feedForSymbol(symbol, !stock);
    const live = { key: row.dataset.key, price: Number(pos.price) || null, change24h: pos.change24h ?? null, currency: pos.currency || 'USD' };
    // Hyperliquid's own candles where the row has them: a spot token's pair ("@248") has
    // no other name there.
    if (pos.chartCoin) {
      return { ...live, provider: 'hyperliquid', coin: pos.chartCoin, symbol, name: feed?.name || pos.assetName || null, category: feed?.category || 'crypto' };
    }
    if (feed) {
      const id = String(feed.id).toLowerCase();
      return { ...live, provider: 'pyth', feedId: id.startsWith('0x') ? id : `0x${id}`, symbol, name: feed.name, category: feed.category };
    }
    // A listing outside the US is under its exchange's ticker on Yahoo ("VWCE.DE").
    return stock ? { ...live, provider: 'yahoo', symbol, yahooSymbol: pos.yahooSymbol, name: pos.name || null, category: 'equity' } : null;
  }

  async function openPositionChart(rowKey) {
    await loadAllPythFeeds().catch(() => null);
    const row = positionRows().find(r => r.dataset.key === rowKey);
    if (row && positionChartItem(row)) openChart(rowKey, 'positions');
  }

  // Remove by composite key so mixed Pyth/Yahoo entries can all be deleted the same way.
  function removeFromWatchlist(targetKey) {
    if (!targetKey) return;
    const s = getSettings();
    const before = Array.isArray(s.watchlist) ? s.watchlist : [];
    const index = before.findIndex(e => watchlistEntryKey(e) === targetKey);
    if (index === -1) return;
    const entry = before[index];
    // Pyth entries store only the feed id; the loaded row knows the symbol.
    const shown = cachedWatchlistData?.find(item => item.key === targetKey);

    s.watchlist = before.filter(e => watchlistEntryKey(e) !== targetKey);
    try {
      localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
      invalidateSettingsCache();

      if (cachedWatchlistData) {
        cachedWatchlistData = cachedWatchlistData.filter(item => item.key !== targetKey);
      }
      renderWatchlistPanel({
        entriesOverride: s.watchlist,
        forceRefresh: false,
        preserveCurrentData: true
      });
    } catch (e) {
      console.error('Failed to remove from watchlist:', e);
      return;
    }

    const label = entry?.label || entry?.symbol || shown?.symbol || shown?.name || 'item';
    showUndo(`Removed ${label}`, async () => {
      const t = getSettings();
      const list = Array.isArray(t.watchlist) ? [...t.watchlist] : [];
      list.splice(Math.min(index, list.length), 0, entry);
      t.watchlist = list;
      localStorage.setItem('myDashboardSettings.v2', JSON.stringify(t));
      invalidateSettingsCache();
      await renderWatchlistPanel({ entriesOverride: list, forceRefresh: true, preserveCurrentData: true });
      focusWatchlistItem(targetKey);
    });
  }

  // Save the order the tiles now show.
  function saveWatchlistOrder(keys) {
    const s = getSettings();
    const list = Array.isArray(s.watchlist) ? s.watchlist : [];
    const rank = new Map(keys.map((k, i) => [k, i]));
    s.watchlist = [...list].sort((a, b) => (rank.get(watchlistEntryKey(a)) ?? Infinity) - (rank.get(watchlistEntryKey(b)) ?? Infinity));
    try {
      localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
      invalidateSettingsCache();
    } catch (e) {
      console.error('Failed to save watchlist order:', e);
    }
    renderWatchlistPanel({ entriesOverride: s.watchlist, forceRefresh: false, preserveCurrentData: true });
  }

  // Drag a tile to move it: a mouse drags once it moves, a finger after holding still for a
  // moment (so a swipe still scrolls). The others make room; drop saves the order.
  let watchlistDragged = false;
  watchlistTable?.addEventListener('pointerdown', (e) => {
    const tile = e.target.closest('tr.watchlist-row');
    const body = tile?.parentElement;
    if (!tile || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const touch = e.pointerType !== 'mouse';
    const startX = e.clientX, startY = e.clientY;
    let dragging = false;
    let holdTimer = null;

    const start = () => {
      dragging = true;
      body.dataset.dragging = '';
      tile.classList.add('is-dragging');
      window.getSelection()?.removeAllRanges();
    };
    // A finger that holds still owns the page until it lifts: no scrolling, no callout.
    const blockTouch = (ev) => { if (dragging) ev.preventDefault(); };
    const onMove = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const moved = Math.hypot(ev.clientX - startX, ev.clientY - startY);
      if (!dragging) {
        if (touch) { if (moved > 8) finish(); return; } // a swipe: let it scroll
        if (moved < 4) return;
        start();
      }
      ev.preventDefault();
      const over = Array.from(body.children).find(other => {
        if (other === tile || !other.classList.contains('watchlist-row')) return false;
        const r = other.getBoundingClientRect();
        return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      });
      if (!over) return;
      const after = over.compareDocumentPosition(tile) & Node.DOCUMENT_POSITION_PRECEDING;
      over.insertAdjacentElement(after ? 'afterend' : 'beforebegin', tile);
    };
    const finish = () => {
      clearTimeout(holdTimer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('touchmove', blockTouch);
      window.removeEventListener('contextmenu', blockTouch);
      if (!dragging) return;
      tile.classList.remove('is-dragging');
      delete body.dataset.dragging;
      // The click that ends a drag doesn't open the chart.
      watchlistDragged = true;
      setTimeout(() => { watchlistDragged = false; }, 0);
      saveWatchlistOrder(Array.from(body.querySelectorAll('tr.watchlist-row')).map(r => r.dataset.entryKey));
    };
    const onUp = (ev) => { if (ev.pointerId === e.pointerId) finish(); };
    if (touch) holdTimer = setTimeout(start, 350);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('touchmove', blockTouch, { passive: false });
    window.addEventListener('contextmenu', blockTouch);
  });

  watchlistTable?.addEventListener('click', (e) => {
    if (watchlistDragged) return;
    if (window.getSelection()?.toString()) return;
    const item = e.target.closest('tr.watchlist-row');
    if (item) openWatchlistChart(item.dataset.entryKey);
  });

  // ←/→ and ↑/↓ move between items, Enter opens the chart. Handled here so the arrows
  // don't also page the comic.
  watchlistTable?.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const item = e.target.closest('tr.watchlist-row');
    if (!item) return;
    const items = watchlistItems();
    const index = items.indexOf(item);

    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
      items[index + step]?.focus();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target === item) {
      e.preventDefault();
      openWatchlistChart(item.dataset.entryKey);
    }
  });

  // Add / edit position: one form in three states. While adding, a single Asset field
  // searches live tickers (Pyth, then Yahoo); its last option adds what was typed as a
  // custom asset. Picking decides the fields: amount, entry price and date for a live
  // asset, a value for a custom one. Editing fixes the asset and offers Delete.
  const addPositionBtn = document.getElementById('newAddPositionBtn');
  const addPositionModal = document.getElementById('newAddPositionModal');
  const addPositionBackdrop = document.getElementById('newAddPositionBackdrop');
  const addPositionTitle = document.getElementById('newAddPositionTitle');
  const closeAddPositionBtn = document.getElementById('newCloseAddPositionBtn');
  const positionForm = document.getElementById('newPositionForm');
  const assetRow = document.getElementById('newPositionAssetRow');
  const assetLabel = document.getElementById('newPositionAssetLabel');
  const assetInput = document.getElementById('newPositionAsset');
  const assetResults = document.getElementById('newPositionResults');
  const chosenLine = document.getElementById('newPositionChosen');
  const liveFields = document.getElementById('newPositionLiveFields');
  const customFields = document.getElementById('newPositionCustomFields');
  const amountInput = document.getElementById('newPositionAmount');
  const entryPriceInput = document.getElementById('newPositionEntryPrice');
  const entryDateInput = document.getElementById('newPositionEntryDate');
  const entryNote = document.getElementById('newPositionEntryNote');
  const currencyAffix = document.getElementById('newPositionCurrency');
  const valueInput = document.getElementById('newPositionValue');
  const valueCurrencyAffix = document.getElementById('newPositionValueCurrency');
  const deletePositionBtn = document.getElementById('newDeletePositionBtn');
  const savePositionBtn = document.getElementById('newSavePositionBtn');

  const ENTRY_NOTE = 'Add a date to get the price on that day.';

  // kind: null (nothing picked yet) | 'live' | 'custom'
  let kind = null;
  let selectedFeed = null;
  let editing = null; // { index, asset, manualType } while editing
  let customCurrency = null;
  let assetOptions = []; // [{ feed } | { custom: name }]
  let activeOption = -1;

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

  // "$", "€", "p" for pence; the code itself when there's no short symbol.
  function currencySymbol(currency) {
    if (!currency) return '';
    if (currency === 'GBp') return 'p';
    try {
      const part = new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
        .formatToParts(0).find(p => p.type === 'currency');
      return part?.value || currency;
    } catch (_) {
      return currency;
    }
  }

  // Feed names like "SOLANA / US DOLLAR" repeat the quote currency the line already shows.
  function feedName(feed) {
    const name = String(feed?.name || '').replace(/\s*\/\s*US DOLLAR$/i, '').trim();
    return name && name.toUpperCase() !== String(feed?.symbol || '').toUpperCase() ? name : '';
  }

  function formatPriceWithCurrency(price, currency) {
    const formatted = Number(price).toLocaleString(undefined, { maximumFractionDigits: 4 });
    return currency ? `${formatted} ${currency}` : formatted;
  }

  function setNote(text) {
    if (entryNote) entryNote.textContent = text;
  }

  // The line under the asset: what was picked, in one row. While adding it ends in a
  // Change link that brings the search back.
  function renderChosen() {
    if (!chosenLine) return;
    chosenLine.innerHTML = '';
    if (!kind) {
      chosenLine.hidden = true;
      return;
    }
    const parts = kind === 'live'
      ? [feedName(selectedFeed), categoryLabel(selectedFeed.category), selectedFeed.exchange, quoteCurrencyForFeed(selectedFeed)]
      : ['Custom asset', `value in ${customCurrency}`];
    const text = document.createElement('span');
    text.textContent = parts.filter(Boolean).join(' · ');
    chosenLine.appendChild(text);
    if (kind === 'live' && selectedFeed.marketHours === 'us-equity') {
      const hours = document.createElement('span');
      hours.className = 'form-chosen__aside';
      hours.textContent = ' · prices change 9:30–16:00 ET';
      chosenLine.appendChild(hours);
    }
    if (!editing) {
      const change = document.createElement('button');
      change.type = 'button';
      change.className = 'form-chosen__change';
      change.textContent = 'Change';
      change.addEventListener('click', () => {
        setKind(null);
        assetInput.select();
        assetInput.focus();
      });
      chosenLine.append(' ', change);
    }
    chosenLine.hidden = false;
  }

  function setKind(next) {
    kind = next;
    if (next !== 'live') selectedFeed = null;
    if (liveFields) liveFields.hidden = next === 'custom';
    if (customFields) customFields.hidden = next !== 'custom';
    if (currencyAffix) currencyAffix.textContent = next === 'live' ? currencySymbol(quoteCurrencyForFeed(selectedFeed)) : '';
    if (valueCurrencyAffix) valueCurrencyAffix.textContent = currencySymbol(customCurrency);
    renderChosen();
  }

  function closeAssetOptions() {
    assetOptions = [];
    activeOption = -1;
    if (assetResults) {
      assetResults.hidden = true;
      assetResults.innerHTML = '';
    }
    assetInput?.setAttribute('aria-expanded', 'false');
    assetInput?.removeAttribute('aria-activedescendant');
  }

  function setActiveOption(index) {
    activeOption = index;
    Array.from(assetResults.children).forEach((li, i) => li.setAttribute('aria-selected', String(i === index)));
    if (index >= 0) {
      assetInput.setAttribute('aria-activedescendant', `newPositionOption${index}`);
      assetResults.children[index]?.scrollIntoView({ block: 'nearest' });
    } else {
      assetInput.removeAttribute('aria-activedescendant');
    }
  }

  function pickOption(option) {
    if (!option) return;
    closeAssetOptions();
    if (option.custom) {
      customCurrency = getSettings().portfolioBaseCurrency || 'USD';
      assetInput.value = option.custom;
      setKind('custom');
      valueInput?.focus();
      return;
    }
    selectedFeed = option.feed;
    assetInput.value = option.feed.symbol;
    setKind('live');
    setNote(ENTRY_NOTE);
    if (entryDateInput?.value) fetchHistoricalEntryPrice(selectedFeed, entryDateInput.value).catch(() => {});
    amountInput?.focus();
  }

  // Tickers first; the last option always adds the typed text as a custom asset.
  function showAssetOptions(feeds, query) {
    if (!assetResults) return;
    assetOptions = feeds.map(feed => ({ feed }));
    if (query) assetOptions.push({ custom: query });
    assetResults.innerHTML = '';
    assetOptions.forEach((option, i) => {
      const li = document.createElement('li');
      li.id = `newPositionOption${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      if (option.custom) {
        li.className = 'form-option form-option--custom';
        li.textContent = `Add “${option.custom}” as a custom asset`;
      } else {
        const feed = option.feed;
        li.className = 'form-option';
        const sym = document.createElement('span');
        sym.className = 'form-option__name';
        sym.textContent = feed.symbol;
        const meta = document.createElement('span');
        meta.className = 'form-option__meta';
        meta.textContent = [feedName(feed), categoryLabel(feed.category), feed.exchange]
          .filter(Boolean).join(' · ');
        li.append(sym, ' ', meta);
      }
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', () => pickOption(option));
      assetResults.appendChild(li);
    });
    assetResults.hidden = assetOptions.length === 0;
    assetInput.setAttribute('aria-expanded', String(assetOptions.length > 0));
    setActiveOption(assetOptions.length > 0 ? 0 : -1);
  }

  // Rank local Pyth matches. Yahoo results arrive pre-ranked by their API and are interleaved
  // separately so we don't have to second-guess a much larger corpus.
  function rankFeedMatches(query, feeds) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const scored = [];
    for (const feed of feeds) {
      const sym = (feed.symbol || '').toLowerCase();
      // Pyth names end in "/ US DOLLAR"; matching it would find every feed for "dollar".
      const name = (feed.name || '').toLowerCase().replace(/\s*\/\s*us dollar$/, '');
      let score = -1;
      if (sym === q) score = 100;
      else if (sym.startsWith(q)) score = 80;
      else if (sym.includes(q)) score = 60;
      else if (name.startsWith(q)) score = 50;
      else if (` ${name}`.includes(` ${q}`)) score = 45;
      else if (name.includes(q)) score = 40;
      else continue;
      if (feed.category === 'crypto') score += 2;
      // Tokenized copies of a stock (AAPLX "Apple xStock", AAPLON) and Pyth's INDEX.AAPL go
      // after the stock itself.
      if (sym !== q && (/xstock|tokenized/.test(name) || sym.startsWith('index.'))) score -= 30;
      scored.push({ feed, score });
    }
    scored.sort((a, b) => b.score - a.score || a.feed.symbol.length - b.feed.symbol.length);
    return scored.slice(0, 12).map(s => s.feed);
  }

  // Merge Pyth + Yahoo results, deduping by normalized symbol. Pyth wins ties because its
  // crypto prices are real-time on-chain vs Yahoo's cached retail feed. An exact symbol
  // match always leads.
  function mergeSearchResults(query, pythMatches, yahooMatches) {
    const seen = new Map();
    const add = (feed, fromPyth) => {
      const key = `${feed.category || ''}|${(feed.symbol || '').toUpperCase()}`;
      if (seen.has(key)) return;
      seen.set(key, { ...feed, provider: fromPyth ? 'pyth' : 'yahoo' });
    };
    for (const f of pythMatches) add(f, true);
    for (const f of yahooMatches) add(f, false);
    const q = query.trim().toUpperCase();
    return Array.from(seen.values())
      .sort((a, b) => ((b.symbol || '').toUpperCase() === q) - ((a.symbol || '').toUpperCase() === q))
      .slice(0, 8);
  }

  function resetForm() {
    clearPositionErrors();
    closeAssetOptions();
    editing = null;
    customCurrency = null;
    selectedFeed = null;
    [assetInput, amountInput, entryPriceInput, entryDateInput, valueInput].forEach(input => {
      if (input) input.value = '';
    });
    if (entryPriceInput) delete entryPriceInput.dataset.userEdited;
    if (assetRow) assetRow.hidden = false;
    if (assetInput) {
      assetInput.readOnly = false;
      assetInput.setAttribute('role', 'combobox');
    }
    if (assetLabel) assetLabel.textContent = 'Asset';
    if (deletePositionBtn) deletePositionBtn.hidden = true;
    setNote(ENTRY_NOTE);
    setKind(null);
  }

  function openPositionWindow() {
    if (addPositionModal) addPositionModal.style.display = 'block';
    if (addPositionBackdrop) addPositionBackdrop.style.display = 'block';
    // Disable scroll on mobile when modal open
    document.body.classList.add('modal-open');
  }

  function closeAddPosition() {
    if (addPositionModal) addPositionModal.style.display = 'none';
    if (addPositionBackdrop) addPositionBackdrop.style.display = 'none';
    editing = null;
    // Re-enable scroll on mobile
    document.body.classList.remove('modal-open');
  }

  if (addPositionBtn) {
    addPositionBtn.addEventListener('click', () => {
      resetForm();
      if (addPositionTitle) addPositionTitle.textContent = 'Add position';
      if (savePositionBtn) savePositionBtn.textContent = 'Add';
      openPositionWindow();
      assetInput?.focus();
      // Load feeds in background (don't block modal display)
      loadAllPythFeeds().catch(() => { });
    });
  }

  function openManualPositionEdit(asset, manualType) {
    const s = getSettings();
    const positions = Array.isArray(s.cryptoPositions) ? s.cryptoPositions : [];
    const index = positions.findIndex(position => storedManualPositionMatches(position, asset, manualType));
    if (index < 0) return;

    const position = positions[index];
    resetForm();
    editing = { index, asset, manualType };
    if (deletePositionBtn) deletePositionBtn.hidden = false;
    if (savePositionBtn) savePositionBtn.textContent = 'Save';

    if (position.type === 'custom') {
      // A custom asset keeps an editable name; there's no ticker to search.
      customCurrency = position.currency || s.portfolioBaseCurrency || 'USD';
      if (addPositionTitle) addPositionTitle.textContent = `Edit ${position.name || position.symbol || 'position'}`;
      if (assetLabel) assetLabel.textContent = 'Name';
      if (assetInput) {
        assetInput.value = position.name || position.symbol || '';
        assetInput.removeAttribute('role');
      }
      if (valueInput) valueInput.value = position.value || position.price || '';
      setKind('custom');
    } else {
      selectedFeed = {
        provider: position.type === 'stock' ? 'yahoo' : 'pyth',
        symbol: position.symbol,
        id: position.feedId || null,
        category: position.category || (position.type === 'stock' ? 'equity' : 'crypto'),
        name: position.name || position.symbol,
        exchange: position.exchange || null,
        currency: position.currency || (position.type === 'stock' ? null : 'USD')
      };
      if (addPositionTitle) addPositionTitle.textContent = `Edit ${position.symbol}`;
      // The ticker is fixed while editing; it's in the title and described on one line.
      if (assetRow) assetRow.hidden = true;
      if (assetInput) assetInput.value = position.symbol || '';
      if (amountInput) amountInput.value = position.amount || '';
      if (entryDateInput) entryDateInput.value = position.entryDate || '';
      if (entryPriceInput) {
        entryPriceInput.value = position.entryPrice || '';
        entryPriceInput.dataset.userEdited = '1';
      }
      setKind('live');
    }
    openPositionWindow();
    (position.type === 'custom' ? valueInput : amountInput)?.focus();
  }

  closeAddPositionBtn?.addEventListener('click', closeAddPosition);
  addPositionBackdrop?.addEventListener('click', closeAddPosition);

  deletePositionBtn?.addEventListener('click', () => {
    if (!editing) return;
    const { asset, manualType } = editing;
    closeAddPosition();
    window.openPositionKey = null;
    deleteManualPosition(asset, manualType);
  });

  // Debounced merged search: local Pyth results show instantly, Yahoo results arrive ~250ms
  // later and are merged in. Each keystroke supersedes the previous Yahoo call via searchSeq.
  let searchDebounce = null;
  let searchSeq = 0;

  if (assetInput) {
    assetInput.addEventListener('input', () => {
      if (editing) return; // a custom asset's name, not a search
      const query = assetInput.value.trim();
      clearTimeout(searchDebounce);
      // Typing again means a new choice; never keep the old ticker behind new text.
      if (kind) setKind(null);
      if (!query) {
        closeAssetOptions();
        return;
      }

      const pythMatches = rankFeedMatches(query, allPythFeeds || []);
      showAssetOptions(mergeSearchResults(query, pythMatches, []), query);

      const seq = ++searchSeq;
      searchDebounce = setTimeout(async () => {
        const stocksProvider = window.AppModules?.data?.providers?.stocks;
        if (!stocksProvider?.searchSymbols) return;
        try {
          const yahoo = await stocksProvider.searchSymbols(query, { limit: 15 });
          if (seq !== searchSeq || assetInput.value.trim() !== query) return; // superseded
          showAssetOptions(mergeSearchResults(query, pythMatches, yahoo), query);
        } catch (err) {
          console.warn('[Search] Yahoo search failed:', err?.message || err);
        }
      }, 250);
    });

    assetInput.addEventListener('keydown', (e) => {
      const open = assetOptions.length > 0;
      if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActiveOption((activeOption + step + assetOptions.length) % assetOptions.length);
      } else if (e.key === 'Enter' && open) {
        // Enter picks the highlighted option instead of submitting the form.
        e.preventDefault();
        e.stopPropagation();
        pickOption(assetOptions[Math.max(0, activeOption)]);
      } else if (e.key === 'Escape' && open) {
        // Close the list, not the window.
        e.preventDefault();
        e.stopPropagation();
        closeAssetOptions();
      }
    });

    assetInput.addEventListener('blur', () => closeAssetOptions());
  }

  // Look up the close on a given date and pre-fill the entry-price field. Routed to the
  // appropriate provider based on the selected feed: Pyth for its on-chain crypto feeds,
  // Yahoo for stocks/ETFs/FX/indices. Pre-fill is non-authoritative — the user can override.
  let historicalLookupSeq = 0;
  async function fetchHistoricalEntryPrice(feed, dateStr) {
    if (!feed || !dateStr) return;
    const mods = window.AppModules || {};

    const token = ++historicalLookupSeq;
    setNote('Finding the price…');

    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) return;
    if (Date.UTC(y, m - 1, d) > Date.now()) {
      setNote('Use a date in the past.');
      return;
    }

    let price = null;
    const currency = quoteCurrencyForFeed(feed);
    try {
      if (feed.provider === 'yahoo' || (!feed.id && feed.symbol)) {
        price = await mods.data?.providers?.stocks?.getHistoricalPrice?.(feed.symbol, dateStr);
      } else if (feed.id) {
        // 16:00 UTC picks a liquid intraday moment for equities; crypto/FX/metal tick continuously.
        const ts = Math.floor(Date.UTC(y, m - 1, d, 16, 0, 0) / 1000);
        const prices = await mods.data?.providers?.pyth?.getAtTimestampByFeedIds?.([feed.id], ts, 10000);
        price = prices ? prices[feed.id.toLowerCase()] : null;
      }
      if (token !== historicalLookupSeq) return;

      if (Number.isFinite(price) && price > 0) {
        if (entryPriceInput && !entryPriceInput.dataset.userEdited) {
          // Keep meaningful precision but trim trailing zeros so the input stays readable.
          entryPriceInput.value = price.toFixed(6).replace(/\.?0+$/, '');
        }
        setNote(`Price on ${dateStr}: ${formatPriceWithCurrency(price, currency)}`);
      } else {
        setNote('No price for that date. Enter the price.');
      }
    } catch (e) {
      if (token !== historicalLookupSeq) return;
      setNote('Cannot get the price. Enter the price.');
    }
  }

  entryDateInput?.addEventListener('change', () => {
    if (!selectedFeed) {
      setNote('Select an asset first.');
      return;
    }
    // A new date may refill the price; typing over it afterwards still wins.
    if (entryPriceInput) delete entryPriceInput.dataset.userEdited;
    fetchHistoricalEntryPrice(selectedFeed, entryDateInput.value).catch(() => {});
  });

  // Respect manual edits to the entry-price field: once the user types, we stop overwriting it.
  entryPriceInput?.addEventListener('input', () => {
    entryPriceInput.dataset.userEdited = '1';
  });

  // Errors sit under the field they belong to and say what to enter
  function clearPositionErrors() {
    document.querySelectorAll('#newAddPositionModal .field-error').forEach(el => {
      const field = document.querySelector(`[aria-errormessage="${el.id}"]`);
      field?.removeAttribute('aria-invalid');
      field?.removeAttribute('aria-errormessage');
      el.remove();
    });
  }
  function showPositionError(field, message) {
    clearPositionErrors();
    const error = document.createElement('div');
    error.className = 'field-error';
    error.id = `${field.id}Error`;
    error.setAttribute('role', 'alert');
    error.textContent = message;
    (field.closest('.form-row') || field).insertAdjacentElement('afterend', error);
    if (field.matches('input, select, textarea')) {
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-errormessage', error.id);
    }
    field.focus();
  }
  positionForm?.addEventListener('input', clearPositionErrors);

  positionForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearPositionErrors();
    const s = getSettings();
    if (!s.cryptoPositions) s.cryptoPositions = [];

    let savedPosition = null;

    if (kind === 'live') {
      const amount = parseFloat(amountInput.value);
      const entryPrice = parseFloat(entryPriceInput.value);
      if (!amount || amount <= 0) {
        showPositionError(amountInput, 'Enter an amount more than 0.');
        return;
      }
      if (entryPriceInput.value.trim() && !(entryPrice > 0)) {
        showPositionError(entryPriceInput, 'Enter a price more than 0, or leave it empty.');
        return;
      }
      // Without an entry price the position still tracks value; it just shows no P&L.
      const entry = entryPrice > 0 ? entryPrice : null;
      // Route the saved position to the right provider:
      //   - Pyth feed (has feed id): type: 'pyth'  → on-chain real-time price via Pyth
      //   - Yahoo feed (no id):     type: 'stock' → Yahoo Finance quote lookup
      // Both share the same PnL math in manual-fetcher; only the price source differs.
      const provider = selectedFeed.provider || (selectedFeed.id ? 'pyth' : 'yahoo');
      savedPosition = provider === 'yahoo'
        ? {
          type: 'stock',
          symbol: selectedFeed.symbol,
          amount,
          entryPrice: entry,
          category: selectedFeed.category || 'equity',
          currency: quoteCurrencyForFeed(selectedFeed) || null,
          name: selectedFeed.name || selectedFeed.symbol,
          exchange: selectedFeed.exchange || null,
          entryDate: entryDateInput?.value || null
        }
        : {
          type: 'pyth',
          symbol: selectedFeed.symbol,
          feedId: selectedFeed.id,
          amount,
          entryPrice: entry,
          category: selectedFeed.category || 'crypto',
          currency: 'USD',
          name: selectedFeed.name || selectedFeed.symbol,
          entryDate: entryDateInput?.value || null
        };
    } else if (kind === 'custom') {
      const name = assetInput.value.trim();
      const value = parseFloat(valueInput.value);
      if (!name) {
        showPositionError(assetInput, 'Enter a name, for example "Gold bars".');
        return;
      }
      if (!value || value <= 0) {
        showPositionError(valueInput, 'Enter a value more than 0.');
        return;
      }
      savedPosition = {
        type: 'custom',
        name,
        symbol: name,
        amount: 1,
        price: value,
        value,
        currency: customCurrency || s.portfolioBaseCurrency || 'USD'
      };
    } else {
      showPositionError(assetInput, assetInput.value.trim()
        ? 'Select an item in the list.'
        : 'Enter a ticker or a name. Then select it in the list.');
      return;
    }

    try {
      if (editing && s.cryptoPositions[editing.index]) {
        s.cryptoPositions[editing.index] = savedPosition;
      } else {
        s.cryptoPositions.push(savedPosition);
      }
      localStorage.setItem('myDashboardSettings.v2', JSON.stringify(s));
      closeAddPosition();

      // Soft reload: re-fetch positions without full page refresh
      await renderPortfolioIncremental();
    } catch (err) {
      console.error('[Add position] Save failed:', err);
      showPositionError(savePositionBtn, 'Cannot save. The browser storage is full or blocked.');
    }
  });
}

// Module scripts run after the document is parsed, so boot now rather than at DOMContentLoaded:
// index.html makes this script render-blocking, and the saved snapshot then lands in the first frame.
const boot = async () => {
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

  // Clear the SW's API cache if this is a fresh session or stale. The worker itself is checked for
  // updates by the registration script in index.html; awaiting that here would hold the first
  // render behind a network round trip for sw.js.
  if (shouldForceFresh && navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_API_CACHE' });
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
      if (toggleRainBtn) toggleRainBtn.innerHTML = effectLabel('Rain', true);
      if (toggleRainBtnMobile) toggleRainBtnMobile.innerHTML = effectLabel('Rain', true);
    } else if (settings.snowEnabled && !settings.rainEnabled) {
      Rain.toggleSnow();
      if (toggleSnowBtn) toggleSnowBtn.innerHTML = effectLabel('Snow', true);
      if (toggleSnowBtnMobile) toggleSnowBtnMobile.innerHTML = effectLabel('Snow', true);
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

  updateGreeting();

  // Greeting container click to refresh with ASCII spinner
  const greetingContainer = document.querySelector('.greeting-container');
  const greetingEl = document.getElementById('newGreeting');

  if (greetingContainer && greetingEl) {
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
      spinnerEl.setAttribute('aria-hidden', 'true');
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

  // Tapping the total hides/shows amounts — same toggle as the header button, so labels stay in sync.
  // Delegated because the hero is re-rendered on every price update.
  const summaryForToggle = document.getElementById('newSummary');
  const toggleAmountsFromHero = (e) => {
    if (!e.target.closest('.hero-amount-toggle')) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    document.getElementById('newToggleAmountsBtn')?.click();
  };
  summaryForToggle?.addEventListener('click', toggleAmountsFromHero);
  summaryForToggle?.addEventListener('keydown', toggleAmountsFromHero);

  // Header refresh chip shares the greeting's refresh path (spinner + hero pulse + watchlist)
  document.getElementById('newRefreshBtn')?.addEventListener('click', () => {
    document.querySelector('.greeting-container')?.click();
  });

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
      console.error('[Portfolio] Load failed:', error);
      summaryEl.innerHTML = `<span style="color: var(--red);">Couldn't load your portfolio. Check your connection, then press Refresh.</span>`;
    }
  }



  // NON-CRITICAL: Health checks only feed the mobile menu. Run them once the page is idle so their
  // requests (including Pyth's ~1MB feed list on a cold cache) don't compete with the portfolio fetch.
  const scheduleHealthChecks = () => runHealthChecks().catch(() => { });
  if ('requestIdleCallback' in window) {
    setTimeout(() => requestIdleCallback(scheduleHealthChecks, { timeout: 10000 }), 8000);
  } else {
    setTimeout(scheduleHealthChecks, 10000);
  }

  // NON-CRITICAL: Keyboard shortcuts (always on, lazy loaded)
  import('./modules/features/keyboard-shortcuts.js')
    .then(mod => mod.init())
    .catch(e => console.warn('[Keyboard] Failed to load:', e));

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
          if (btn) btn.innerHTML = effectLabel('Snow', true);
          if (mobileBtn) mobileBtn.innerHTML = effectLabel('Snow', true);
        } else if (weather.isRaining) {
          Rain.toggleRain();
          const btn = document.getElementById('newToggleRainBtn');
          const mobileBtn = document.getElementById('newToggleRainBtnMobile');
          if (btn) btn.innerHTML = effectLabel('Rain', true);
          if (mobileBtn) mobileBtn.innerHTML = effectLabel('Rain', true);
        }
      }
    }

    // Ambient effects start after the weather has set rain or snow, which they build on
    import('./modules/features/ambient.js')
      .then(mod => mod.init())
      .catch(e => console.warn('[Ambient] Failed to load:', e));
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
        comicEl.innerHTML = '<span class="loading-terminal">Loading</span>';
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

    // Download saves the strip on screen as a file, named for the comic and its date
    // (calvinandhobbes-1988-06-05.jpg). GoComics images allow a direct fetch; others go
    // through our proxy; if both fail, the image opens in a new tab to save from there.
    const downloadComicBtn = document.getElementById('newComicDownloadBtn');
    // Nothing to save while a strip loads or after it fails: Download shows only with one on screen.
    const comicBox = document.getElementById('newComic');
    if (downloadComicBtn && comicBox) {
      const syncDownload = () => { downloadComicBtn.hidden = !comicBox.querySelector('img'); };
      new MutationObserver(syncDownload).observe(comicBox, { childList: true });
      syncDownload();
    }
    downloadComicBtn?.addEventListener('click', async () => {
      const img = document.querySelector('#newComic img');
      if (!img?.src) return;
      const idle = downloadComicBtn.textContent;
      downloadComicBtn.disabled = true;
      downloadComicBtn.textContent = 'Downloading…';
      try {
        let blob = null;
        for (const url of [img.src, `/api/proxy?url=${encodeURIComponent(img.src)}`]) {
          try {
            const resp = await fetch(url, { mode: 'cors' });
            const body = resp.ok ? await resp.blob() : null;
            if (body?.type.startsWith('image/')) {
              blob = body;
              break;
            }
          } catch (_) { /* try the next source */ }
        }
        if (!blob) {
          window.open(img.src, '_blank', 'noopener');
          return;
        }
        const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace(/\+.*$/, '');
        const name = `${img.dataset.comicType || 'comic'}${img.dataset.date ? `-${img.dataset.date}` : ''}.${ext}`;
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      } finally {
        downloadComicBtn.disabled = false;
        downloadComicBtn.textContent = idle;
      }
    });

    // Tapping the strip opens it full screen, fitted to the screen. Pinch zooms around the
    // fingers and one finger pans (Sunday strips are unreadable fitted to a phone's width);
    // on a computer a trackpad pinch or ctrl + wheel zooms. A swipe up or down, Esc or Close
    // goes back to the same place on the page.
    const comicContainer = document.getElementById('newComic');
    let comicViewer = null;
    let comicViewerOpener = null;
    let comicPageScroll = 0;

    // Zoom state: the strip's scale and its offset from its fitted place.
    const comicZoom = { s: 1, x: 0, y: 0 };
    const clampBetween = (v, a, b) => Math.min(Math.max(v, Math.min(a, b)), Math.max(a, b));
    // The strip's fitted box (its box with the zoom taken off) and the most it can zoom.
    const comicBase = () => {
      const big = comicViewer.querySelector('.comic-viewer__img');
      const r = big.getBoundingClientRect();
      const w = r.width / comicZoom.s;
      return {
        left: r.left - comicZoom.x,
        top: r.top - comicZoom.y,
        w,
        h: r.height / comicZoom.s,
        max: Math.max(4, big.naturalWidth / w),
      };
    };
    // Sets the zoom and keeps the strip on screen: larger than the screen, it can't leave a
    // gap at an edge; at fitted size it goes back to its place.
    const setComicZoom = (s, x, y, base = comicBase()) => {
      const big = comicViewer.querySelector('.comic-viewer__img');
      const box = comicViewer.querySelector('.comic-viewer__scroll').getBoundingClientRect();
      s = clampBetween(s, 1, base.max);
      comicZoom.s = s;
      comicZoom.x = s === 1 ? 0 : clampBetween(x, box.left - base.left, box.right - base.w * s - base.left);
      comicZoom.y = s === 1 ? 0 : clampBetween(y, box.top - base.top, box.bottom - base.h * s - base.top);
      big.style.transform = s === 1 ? '' : `translate(${comicZoom.x}px, ${comicZoom.y}px) scale(${s})`;
      comicViewer.classList.toggle('is-zoomed', s > 1);
    };
    // Zooms to scale s and keeps the point (cx, cy) of the strip where it is on screen.
    const zoomComicAt = (s, cx, cy) => {
      const base = comicBase();
      const k = clampBetween(s, 1, base.max) / comicZoom.s;
      setComicZoom(
        s,
        cx - base.left - (cx - base.left - comicZoom.x) * k,
        cy - base.top - (cy - base.top - comicZoom.y) * k,
        base,
      );
    };

    const closeComicViewer = () => {
      if (!comicViewer || comicViewer.hidden) return;
      comicViewer.hidden = true;
      document.body.classList.remove('modal-open');
      document.body.style.top = '';
      window.scrollTo(0, comicPageScroll);
      comicViewerOpener?.focus?.({ preventScroll: true });
    };

    const openComicViewer = (img) => {
      if (!comicViewer) {
        comicViewer = document.createElement('div');
        comicViewer.className = 'comic-viewer';
        comicViewer.setAttribute('role', 'dialog');
        comicViewer.setAttribute('aria-modal', 'true');
        comicViewer.setAttribute('aria-label', 'Comic, full screen');
        // Close sits in a bar at the bottom, within thumb reach.
        comicViewer.innerHTML =
          '<div class="comic-viewer__scroll"><img class="comic-viewer__img" alt="" draggable="false"></div>' +
          '<div class="comic-viewer__bar"><button type="button" class="btn-text comic-viewer__close">Close</button></div>';
        document.body.appendChild(comicViewer);
        comicViewer.querySelector('.comic-viewer__close').addEventListener('click', closeComicViewer);
        comicViewer.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeComicViewer();
          }
        });

        // Two fingers zoom and pan, one finger pans. Each change of fingers starts a new
        // gesture from where the strip is, so lifting one finger doesn't make it jump.
        const scroller = comicViewer.querySelector('.comic-viewer__scroll');
        const pointers = new Map();
        let gesture = null;
        const fingers = () => {
          const [a, b] = [...pointers.values()];
          if (!b) return { m: a, d: 0 };
          return { m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: Math.hypot(a.x - b.x, a.y - b.y) };
        };
        const startGesture = () => {
          gesture = pointers.size ? { ...fingers(), base: comicBase(), ...comicZoom } : null;
        };

        // At fitted size one finger swipes the strip away: it follows the finger, the page
        // shows through as it goes, and a long or fast swipe up or down closes the viewer.
        // A short swipe springs back.
        const strip = comicViewer.querySelector('.comic-viewer__img');
        let swipe = null;
        const setSwipe = (dx, dy) => {
          strip.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : '';
          comicViewer.style.setProperty('--comic-backdrop', String(1 - Math.min(Math.abs(dy) / (innerHeight / 2), 1)));
        };
        const settleSwipe = (dx, dy, then) => {
          const instant = matchMedia('(prefers-reduced-motion: reduce)').matches;
          comicViewer.classList.add('is-settling');
          setSwipe(dx, dy);
          setTimeout(() => {
            comicViewer.classList.remove('is-settling');
            then?.();
          }, instant ? 0 : 200);
        };

        scroller.addEventListener('pointerdown', (e) => {
          if (comicViewer.classList.contains('is-settling')) return;
          scroller.setPointerCapture(e.pointerId);
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          // A second finger turns a swipe into a pinch: put the strip back first.
          if (swipe) {
            swipe = null;
            setSwipe(0, 0);
          }
          startGesture();
          if (pointers.size === 1 && comicZoom.s === 1) {
            swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0, vy: 0, t: e.timeStamp };
          }
        });
        scroller.addEventListener('pointermove', (e) => {
          if (!pointers.has(e.pointerId) || !gesture) return;
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (swipe) {
            const dy = e.clientY - swipe.y;
            const dt = e.timeStamp - swipe.t;
            if (dt > 0) swipe.vy = (dy - swipe.dy) / dt;
            Object.assign(swipe, { dx: e.clientX - swipe.x, dy, t: e.timeStamp });
            setSwipe(swipe.dx, swipe.dy);
            return;
          }
          const { m, d } = fingers();
          const g = gesture;
          const s = d && g.d ? clampBetween(g.s * d / g.d, 1, g.base.max) : g.s;
          // The point of the strip that was under the fingers stays under them.
          const k = s / g.s;
          setComicZoom(
            s,
            m.x - g.base.left - (g.m.x - g.base.left - g.x) * k,
            m.y - g.base.top - (g.m.y - g.base.top - g.y) * k,
            g.base,
          );
        });
        const endPointer = (e) => {
          pointers.delete(e.pointerId);
          if (swipe?.id === e.pointerId) {
            const { dx, dy } = swipe;
            // A finger held still before lifting has no speed left.
            const vy = e.timeStamp - swipe.t > 100 ? 0 : swipe.vy;
            swipe = null;
            const flung = Math.abs(dy) > 20 && Math.abs(vy) > 0.5 && Math.sign(vy) === Math.sign(dy);
            if (e.type === 'pointerup' && (Math.abs(dy) > 100 || flung)) {
              settleSwipe(dx, Math.sign(dy) * innerHeight, closeComicViewer);
            } else {
              settleSwipe(0, 0);
            }
          }
          startGesture();
        };
        scroller.addEventListener('pointerup', endPointer);
        scroller.addEventListener('pointercancel', endPointer);

        // Trackpad pinch (Chrome and Firefox send it as ctrl + wheel) or ctrl + wheel zooms;
        // the wheel alone pans.
        scroller.addEventListener('wheel', (e) => {
          e.preventDefault();
          if (e.ctrlKey) zoomComicAt(comicZoom.s * Math.exp(-e.deltaY / 300), e.clientX, e.clientY);
          else setComicZoom(comicZoom.s, comicZoom.x - e.deltaX, comicZoom.y - e.deltaY);
        }, { passive: false });
        // Safari sends pinches as gesture events: stop its own page zoom. With no fingers down
        // it is a Mac trackpad, so the pinch zooms the strip.
        let gestureScale = 1;
        comicViewer.addEventListener('gesturestart', (e) => {
          e.preventDefault();
          gestureScale = comicZoom.s;
        });
        comicViewer.addEventListener('gesturechange', (e) => {
          e.preventDefault();
          if (!pointers.size) zoomComicAt(gestureScale * e.scale, e.clientX, e.clientY);
        });
      }
      const big = comicViewer.querySelector('.comic-viewer__img');
      big.src = img.src;
      big.alt = img.alt;
      Object.assign(comicZoom, { s: 1, x: 0, y: 0 });
      big.style.transform = '';
      comicViewer.style.removeProperty('--comic-backdrop');
      comicViewer.classList.remove('is-zoomed');
      comicViewerOpener = document.activeElement;
      // On phones modal-open fixes the body in place; the negative top keeps the page where
      // it was, and close scrolls back to it.
      comicPageScroll = window.scrollY;
      comicViewer.hidden = false;
      document.body.classList.add('modal-open');
      if (getComputedStyle(document.body).position === 'fixed') document.body.style.top = `-${comicPageScroll}px`;
      comicViewer.querySelector('.comic-viewer__close').focus({ preventScroll: true });
    };

    comicContainer?.addEventListener('click', (e) => {
      const img = e.target.closest('img');
      if (img) openComicViewer(img);
    });
    // The strip itself is reachable by keyboard: Enter or Space opens it.
    comicContainer?.addEventListener('keydown', (e) => {
      const img = comicContainer.querySelector('img');
      if (img && (e.key === 'Enter' || e.key === ' ') && e.target === comicContainer) {
        e.preventDefault();
        openComicViewer(img);
      }
    });
    if (comicContainer) {
      comicContainer.tabIndex = 0;
      comicContainer.setAttribute('role', 'button');
      comicContainer.setAttribute('aria-label', 'Open the comic full screen');
    }

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
        watchlistBody.innerHTML = `<tr><td colspan="4" class="loading"><span class="loading-terminal">Loading</span></td></tr>`;
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
  let lastRefreshAt = Date.now(); // the first load counts

  async function refreshPortfolio() {
    if (refreshInProgress) {
      refreshQueued = true;
      return;
    }
    refreshInProgress = true;
    lastRefreshAt = Date.now();

    try {
      updateGreeting();
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

  // Start periodic refresh after 30 seconds, then every 30 seconds. Held in updateInterval so a
  // hidden tab stops it too.
  updateInterval = setTimeout(() => {
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
        // Back before the next refresh was due: what is on screen is current, so keep the schedule
        // instead of refetching everything. One timer id serves both: clearInterval clears a timeout.
        const sinceRefresh = Date.now() - lastRefreshAt;
        if (sinceRefresh < 30000) {
          updateInterval = setTimeout(() => {
            refreshPortfolio();
            updateInterval = setInterval(refreshPortfolio, 30000);
          }, 30000 - sinceRefresh);
          tabHiddenAt = null;
          return;
        }

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

        // Check for a new service worker in the background (never block the refresh on it) and
        // clear stale API cache if the tab was hidden for a while
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations()
            .then(registrations => registrations.forEach(registration => registration.update().catch(() => { })))
            .catch(() => { });
          if (wasHiddenLong && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_API_CACHE' });
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


};
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
