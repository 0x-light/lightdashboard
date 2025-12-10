// Minimal alpha boot for the new modular dashboard
import * as AssetMapping from './modules/utils/asset-mapping.js';
import * as Portfolio from './modules/domain/portfolio.js';
import { closeMobileMenuWithScroll } from './modules/ui/mobile-menu.js';

// ============================================================================
// VERSION CHECKING
// ============================================================================
const APP_VERSION = '2.9.5';
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

  // Fetch weather data (non-blocking, will be used in hero summary)
  (async () => {
    try {
      const weatherLat = settings.weather?.lat;
      const weatherLon = settings.weather?.lon;
      const weatherLabel = settings.weather?.label || 'your location';

      if (weatherLat && weatherLon && mods.features?.weather?.fetchWeather) {
        const data = await mods.features.weather.fetchWeather(weatherLat, weatherLon, 5000);
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
          const moonText = showMoon ? ` with a ${moonIcon} ${moonName} moon` : '';

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
    const { PortfolioManager } = await import('./modules/domain/portfolio-manager.js?v=2.9.6');
    const { HyperliquidFetcher } = await import('./modules/data/fetchers/hyperliquid-fetcher.js');
    const { LighterFetcher } = await import('./modules/data/fetchers/lighter-fetcher.js?v=2.9.6');
    const { ZerionFetcher } = await import('./modules/data/fetchers/zerion-fetcher.js');
    const { AlchemyHeliusFetcher } = await import('./modules/data/fetchers/alchemy-helius-fetcher.js');
    const { BitcoinZcashFetcher } = await import('./modules/data/fetchers/bitcoin-fetcher.js');
    const { ManualFetcher } = await import('./modules/data/fetchers/manual-fetcher.js');

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

    // Make renderer globally available for updates
    window._portfolioRenderer = renderer;

    const manager = new PortfolioManager(renderer, providers, settings);
    manager.registerFetcher('Hyperliquid', new HyperliquidFetcher(providers, renderer, settings));
    manager.registerFetcher('Lighter', new LighterFetcher(providers, renderer));
    manager.registerFetcher('Zerion', new ZerionFetcher(providers, renderer, settings));
    manager.registerFetcher('AlchemyHelius', new AlchemyHeliusFetcher(providers, renderer, settings));
    manager.registerFetcher('BitcoinZcash', new BitcoinZcashFetcher(providers, renderer));
    manager.registerFetcher('Manual', new ManualFetcher(providers, renderer, settings));

    window._portfolioManager = manager;
  } else {
    // Update settings if needed
    window._portfolioManager.settings = settings;
    window._portfolioManager.renderer.settings = settings;
    window._portfolioManager.renderer.expectedProviders = expectedProviders;
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
let showHiddenPositions = false; // Toggle to show manually hidden positions
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
    if (mobileMenu && mobileMenu.classList.contains('open')) return true;

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
  applyFont(settings.font || 'berkeley');



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

      // Disable scroll when mobile menu open
      document.body.classList.add('modal-open');
    });
  }

  if (closeMobileMenuBtn && mobileMenu) {
    closeMobileMenuBtn.addEventListener('click', () => {
      mobileMenu.classList.remove('active');
      document.body.classList.remove('mobile-menu-open');

      // Re-enable scroll when mobile menu closed
      document.body.classList.remove('modal-open');
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

  syncMobileButtons('newSettingsBtn', 'newSettingsBtnMobile');

  // Show Hidden Positions toggle (shows <$100 positions and manually hidden)
  const showHiddenBtn = document.getElementById('newShowHiddenBtn');
  const threshold = settings.minBalanceThreshold || 100;

  function updateShowHiddenButton() {
    if (showHiddenBtn) {
      // Use original format: [SHOW <$X] / [HIDE <$X]
      showHiddenBtn.textContent = showHiddenPositions ? `[HIDE <$${threshold}]` : `[SHOW <$${threshold}]`;
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

      // Force re-render
      if (window._portfolioRenderer) {
        window._portfolioRenderer.forceRender();
      }
    });
  }

  // Edit list mode
  const editListBtn = document.getElementById('newEditListBtn');
  const cancelEditBtn = document.getElementById('newCancelEditBtn');
  let editModeSnapshot = null; // Store state before edit mode for cancel functionality

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
      editListBtn.textContent = editMode ? '[SAVE]' : '[EDIT]';

      // Show/hide cancel button
      if (cancelEditBtn) {
        cancelEditBtn.style.display = editMode ? 'inline' : 'none';
      }

      // Re-render with edit mode
      if (window._portfolioRenderer) {
        window._portfolioRenderer.forceRender();
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

              // Direct delete without confirmation
              {
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

                  // Also remove from hiddenAssets set in memory
                  hiddenAssets.delete(assetKey);
                  window.hiddenAssets = hiddenAssets; // Update global for incremental renderer

                  // Remove position from renderer's allPositions (the source of truth)
                  if (window._portfolioRenderer) {
                    if (manualType === 'custom') {
                      window._portfolioRenderer.removePositions(p => p.isManual && p.manualType === 'custom' && p.asset === asset);
                    } else if (manualType === 'pyth') {
                      window._portfolioRenderer.removePositions(p => p.isManual && p.manualType === 'pyth' && p.asset === asset);
                    }
                  }
                }
              }
            } else if (e.target.classList.contains('position-restore-btn')) {
              // Restore hidden position (remove from hiddenAssets)
              const assetKey = e.target.getAttribute('data-asset-key');
              hiddenAssets.delete(assetKey);
              window.hiddenAssets = hiddenAssets;

              // Save to localStorage
              const s = getSettings();
              s.hiddenAssets = Array.from(hiddenAssets);
              localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
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
          });
        }
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
        localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
        invalidateSettingsCache();
      }

      // Exit edit mode
      editMode = false;
      window.editMode = editMode;
      editListBtn.textContent = '[EDIT]';
      cancelEditBtn.style.display = 'none';

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
      amountsBtn.textContent = amountsVisible ? '[HIDE AMOUNTS]' : '[SHOW AMOUNTS]';

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
      compactBtn.textContent = compactMode ? '[EXPAND]' : '[COMPACT]';

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
      const fontSelectInput = document.getElementById('newFontSelect');

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
      if (fontSelectInput) fontSelectInput.value = s.font || 'berkeley';


      // Menu visibility checkboxes
      if (hideSnowBtnInput) hideSnowBtnInput.checked = s.hideSnowBtn ?? false;
      if (hideRainBtnInput) hideRainBtnInput.checked = s.hideRainBtn ?? false;
      if (hideFontSizeInput) hideFontSizeInput.checked = s.hideFontSize ?? false;
      if (hideThemeBtnInput) hideThemeBtnInput.checked = s.hideThemeBtn ?? false;
      if (hideAmountsBtnInput) hideAmountsBtnInput.checked = s.hideAmountsBtn ?? false;
      if (showCompactBtnInput) showCompactBtnInput.checked = s.showCompactBtn ?? true;
      if (hideDonateBtnInput) hideDonateBtnInput.checked = s.hideDonateBtn ?? false;
      if (hideStickersBtnInput) hideStickersBtnInput.checked = s.hideStickersBtn ?? false;

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
        importBtn.textContent = '[IMPORT]';
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

  // Force update button - clears all caches, unregisters SW, and hard reloads
  const forceUpdateBtn = document.getElementById('newForceUpdateBtn');
  if (forceUpdateBtn) {
    forceUpdateBtn.addEventListener('click', async () => {
      const originalText = forceUpdateBtn.textContent;
      forceUpdateBtn.textContent = '[CLEARING...]';
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

      // Close mobile menu if open (with scroll restoration)
      closeMobileMenuWithScroll();

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

      // Close mobile menu if open (with scroll restoration)
      closeMobileMenuWithScroll();

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
      const fontSelectInput = document.getElementById('newFontSelect');

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
      if (fontSelectInput) newSettings.font = fontSelectInput.value;

      // Save menu visibility settings
      if (hideSnowBtnInput) newSettings.hideSnowBtn = hideSnowBtnInput.checked;
      if (hideRainBtnInput) newSettings.hideRainBtn = hideRainBtnInput.checked;
      if (hideFontSizeInput) newSettings.hideFontSize = hideFontSizeInput.checked;
      if (hideThemeBtnInput) newSettings.hideThemeBtn = hideThemeBtnInput.checked;
      if (hideAmountsBtnInput) newSettings.hideAmountsBtn = hideAmountsBtnInput.checked;
      if (showCompactBtnInput) newSettings.showCompactBtn = showCompactBtnInput.checked;
      if (hideDonateBtnInput) newSettings.hideDonateBtn = hideDonateBtnInput.checked;
      if (hideStickersBtnInput) newSettings.hideStickersBtn = hideStickersBtnInput.checked;

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
        body.classList.toggle('hide-stickers-btn', newSettings.hideStickersBtn ?? false);
        body.classList.toggle('hide-watchlist', newSettings.hideWatchlist ?? false);
        body.classList.toggle('hide-comic', newSettings.hideComic ?? false);

        // Apply font setting
        applyFont(newSettings.font || 'berkeley');

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
    }
    // Close mobile menu if open (with scroll restoration)
    closeMobileMenuWithScroll();
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
      const feeds = await providers.pyth.getPriceFeeds(15000);

      // Check if we got valid results
      if (feeds && typeof feeds === 'object' && Object.keys(feeds).length > 0) {
        allPythFeeds = Object.entries(feeds).map(([symbol, id]) => ({ symbol, id }));
        console.log(`[Search] Loaded ${allPythFeeds.length} Pyth feeds from API`);
        return allPythFeeds;
      }

      // API returned empty - use fallback
      console.warn('[Search] Pyth API returned empty, using fallback feeds');
      allPythFeeds = FALLBACK_FEEDS;
      return allPythFeeds;
    } catch (e) {
      console.error('Failed to load Pyth feeds:', e);
      allPythFeeds = FALLBACK_FEEDS;
      return allPythFeeds;
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
      editWatchlistBtn.textContent = watchlistEditMode ? '[SAVE]' : '[EDIT]';
    }

    // Show/hide cancel button
    if (cancelWatchlistEditBtn) {
      cancelWatchlistEditBtn.style.display = watchlistEditMode ? 'inline' : 'none';
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

  // Cancel watchlist edit mode - restore snapshot
  if (cancelWatchlistEditBtn) {
    cancelWatchlistEditBtn.addEventListener('click', async () => {
      if (watchlistEditSnapshot) {
        // Restore watchlist from snapshot
        const s = getSettings();
        s.watchlist = [...watchlistEditSnapshot.watchlist];
        localStorage.setItem('myDashboardSettings.v1', JSON.stringify(s));
        invalidateSettingsCache();

        // Clear cached data to force refetch
        cachedWatchlistData = null;
      }

      // Exit edit mode
      watchlistEditMode = false;
      if (editWatchlistBtn) {
        editWatchlistBtn.textContent = '[EDIT]';
      }
      cancelWatchlistEditBtn.style.display = 'none';

      // Re-render watchlist
      const watchlistBody = document.getElementById('newWatchlistBody');
      if (watchlistBody) {
        try {
          const mod = await import('./modules/features/watchlist.js');
          const s = getSettings();
          await mod.render(watchlistBody, {
            feedIds: s.watchlist || [],
            pythProvider: window.AppModules?.data?.providers?.pyth,
            useColoredPnL: s.useColoredPnL ?? true,
            editMode: false,
            showPriceChart: s.showPriceChart ?? true
          });
        } catch (e) {
          console.error('Failed to cancel watchlist edit mode:', e);
        }
      }
    });
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

      // Load feeds in background (don't block modal display)
      loadAllPythFeeds().catch(() => { });
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
    body.classList.toggle('hide-stickers-btn', settings.hideStickersBtn ?? false);

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

  async function refreshPortfolio() {
    try {
      // Full re-fetch using the same path as initial load - this always works correctly
      await renderPortfolioIncremental();

      // Update watchlist separately
      const providers = window.AppModules?.data?.providers;
      const s = getSettings();
      const watchlistBody = document.getElementById('newWatchlistBody');

      if (watchlistBody && s.watchlist && s.watchlist.length > 0 && !watchlistEditMode && providers?.pyth) {
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
          // Silently fail watchlist updates
        }
      }
    } catch (e) {
      console.warn('[Refresh] Failed:', e?.message || e);
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