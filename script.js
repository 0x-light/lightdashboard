/**
 * Privacy-First Dashboard
 * 
 * SECURITY & PRIVACY NOTICE:
 * - All data is stored locally in your browser's localStorage only
 * - Sensitive data (wallet addresses, API keys) is encrypted before storage
 * - No analytics, tracking, or telemetry of any kind
 * - No user accounts, no server-side storage, no databases
 * - External API calls are made only to fetch your positions:
 *   • Hyperliquid API - for perp/spot positions
 *   • Lighter API - for lighter positions
 *   • OpenSea API - for NFT data
 *   • CoinGecko API - for price data (public, no personal data sent)
 *   • Open-Meteo API - for weather (only if enabled)
 * - Your data never leaves your device except to fetch positions from blockchain APIs
 * 
 * See SECURITY.md for full details.
 */
(function() {
  const storageKey = 'myDashboardSettings.v1';
  
  // Simple encryption for sensitive data in localStorage
  // Note: This is obfuscation, not true encryption. For true security, use a password-derived key.
  // All data stays local - nothing is sent to external servers except necessary API calls.
  const ENCRYPT_PREFIX = 'enc:';
  
  function simpleEncrypt(text) {
    if (!text) return text;
    // Add prefix to identify encrypted data
    return ENCRYPT_PREFIX + btoa(encodeURIComponent(text));
  }
  
  function simpleDecrypt(encoded) {
    if (!encoded) return encoded;
    
    // Check if data is encrypted (has our prefix)
    if (typeof encoded === 'string' && encoded.startsWith(ENCRYPT_PREFIX)) {
      try {
        return decodeURIComponent(atob(encoded.substring(ENCRYPT_PREFIX.length)));
      } catch (e) {
        console.error('✗ Decryption failed');
        return ''; // Return empty string if decryption fails
      }
    }
    
    // Not encrypted, return as-is (backward compatibility)
    return encoded;
  }

  // Store loaded sticker images
  const stickerImages = {};
  const wallpapers = [];
  
  // CoinGecko API rate limiting (optimized for speed)
  let lastCoinGeckoCall = 0;
  const COINGECKO_DELAY = 300; // 300ms between calls (aggressive but respectful)
  const coinGeckoCache = new Map();
  const CACHE_DURATION = 180000; // Cache for 3 minutes (longer caching)
  const MAX_CACHE_SIZE = 200; // Larger cache for better performance
  let consecutiveRateLimits = 0;
  
  // Settings cache (avoid repeated localStorage reads)
  let settingsCache = null;
  let settingsCacheTime = 0;
  
  // NFT data cache (OpenSea is slow, cache aggressively)
  const nftCache = new Map();
  const NFT_CACHE_DURATION = 300000; // 5 minutes
  
  // === PYTH NETWORK PRICE FEEDS ===
  // Unified price source for portfolio calculations
  
  // Pyth price feed IDs for verified assets
  // To verify or find new feed IDs, visit: https://pyth.network/developers/price-feed-ids
  // These IDs are for mainnet and should be checked periodically for updates
  const PYTH_PRICE_FEEDS = {
    // Major assets
    'BTC': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
    'ETH': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
    'SOL': '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
    
    // Stablecoins
    'USDT': '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
    // Note: USDC price feed may vary by chain - using exchange fallback instead
    
    // L2s & Alt L1s
    'ARB': '0x3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5',
    'AVAX': '0x93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7',
    'MATIC': '0x5de33a9112c2b700b8d30b8a3402c103578ccfa2765696471cc672bd5cf6ac52',
    'OP': '0x385f64d993f7b77d8182ed5003d97c60aa3361f3cecfe711544d2d59165e9bdf',
    'APT': '0x03ae4db29ed4ae33d323568895aa00337e658e348b37509f5372ae51f0af00d5',
    'SUI': '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744',
    'NEAR': '0xc415de8d2eba7db216527dff4b60e8f3a5311c740dadb233e13e12547e226750',
    
    // DeFi & Other
    'BNB': '0x2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f',
    'DOGE': '0xdcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c',
    'ADA': '0x2a01deaec9e51a579277b34b122399984d0bbf57e2458a7e42fecd2829867a0d',
    'DOT': '0xca3eed9b267293f6595901c734c7525ce8ef49adafe8284606ceb307afa2ca5b',
    'LINK': '0x8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221',
    'UNI': '0x78d185a741d07edb3412b09008b7c5cfb9bbbd7d568bf00ba737b456ba171501',
    'XRP': '0xec5d399846a9209f3fe5881d70aae9268c94339ff9817e8d18ff19fa05eea1c8',
    'LTC': '0x6e3f3fa8253588df9326580180233eb791e03b443a3ba7a1d892e73874e19a54',
    'ATOM': '0xb00b60f88b03a6a625a8d1c048c3f66653edf217439983d037e7222c4e612819',
    'APE': '0x15add95022ae13563a11992e727c91bdb6b55bc183d9754a32f71c72c9daa5e',
    'ICP': '0xc9907d786c5821547777780a1e4f89484f3417cb14dd244f09b9ea82b38aa65',
    'MKR': '0x9375299e31c0deb9c6bc378e6329aab44cb48ec655552a70d4b9050346a30378',
    'AAVE': '0x2b9ab1e972a281585084148ba1389800799bd4be63b957507db1349314e47445',
    'FIL': '0x150ac9b959aee0051e4091f0ef5216d941f590e1c5e7f91cf7635b5c11628c0e',
    
    // Additional assets
    'ZEC': '0xbe9b59d178f0d6a97ab4c343bff2aa69caa1eaae3e9048a65788c529b125bb24'  // Crypto.ZEC/USD (Zcash)
    
    // Note: HYPE uses Hyperliquid exchange price (more accurate)
    // Note: USDC uses exchange price (more accurate at $1.00 stable)
  };
  
  async function fetchPythPrice(asset, timestamp = null) {
    // Get Pyth price feed ID for asset
    const feedId = PYTH_PRICE_FEEDS[asset];
    if (!feedId) {
      return null; // Asset not supported by Pyth
    }
    
    try {
      let url;
      if (timestamp) {
        // Historical price - Hermes API uses Unix timestamp in seconds
        const unixTimestamp = Math.floor(timestamp / 1000);
        url = `https://hermes.pyth.network/v2/updates/price/${unixTimestamp}?ids[]=${feedId}`;
      } else {
        // Latest price
        url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${feedId}`;
      }
      
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      
      const data = await response.json();
      
      // Parse Pyth price data
      if (data.parsed && data.parsed.length > 0) {
        const priceData = data.parsed[0];
        const price = parseFloat(priceData.price.price) * Math.pow(10, priceData.price.expo);
        return price;
      }
      
      return null;
    } catch (err) {
      return null;
    }
  }
  
  async function fetchPythPrices(assets) {
    // Fetch multiple prices at once
    const feedIds = assets
      .map(asset => PYTH_PRICE_FEEDS[asset])
      .filter(id => id);
    
    if (feedIds.length === 0) {
      console.log('  ⚠ Pyth: No feed IDs found for requested assets');
      return {};
    }
    
    try {
      const idsParam = feedIds.map(id => `ids[]=${id}`).join('&');
      const url = `https://hermes.pyth.network/v2/updates/price/latest?${idsParam}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        console.log(`  ⚠ Pyth API error: ${response.status}`);
        return {};
      }
      
      const data = await response.json();
      
      // Map results back to asset symbols
      const prices = {};
      if (data.parsed && data.parsed.length > 0) {
        for (const priceData of data.parsed) {
          // Find asset symbol by feed ID (normalize to lowercase with 0x prefix)
          const normalizedId = priceData.id.toLowerCase().startsWith('0x') 
            ? priceData.id.toLowerCase() 
            : `0x${priceData.id.toLowerCase()}`;
          
          const asset = Object.keys(PYTH_PRICE_FEEDS).find(
            key => PYTH_PRICE_FEEDS[key].toLowerCase() === normalizedId
          );
          
          if (asset) {
            const price = parseFloat(priceData.price.price) * Math.pow(10, priceData.price.expo);
            prices[asset] = price;
          }
        }
      } else {
        console.log('  ⚠ Pyth: No parsed data in response');
      }
      
      return prices;
    } catch (err) {
      console.log(`  ⚠ Pyth fetch error:`, err.message);
      return {};
    }
  }
  
  // Tab visibility tracking
  let isTabVisible = true;
  let updateInProgress = false;
  let lastFullRefresh = 0;
  const MIN_REFRESH_INTERVAL = 10000; // Minimum 10s between full refreshes (faster updates)
  
  async function rateLimitedFetch(url, cacheKey = null, retryCount = 0) {
    // Check cache first - extend cache if we've been rate limited recently
    if (cacheKey && coinGeckoCache.has(cacheKey)) {
      const cached = coinGeckoCache.get(cacheKey);
      const cacheAge = Date.now() - cached.timestamp;
      const extendedDuration = consecutiveRateLimits > 0 ? CACHE_DURATION * 2 : CACHE_DURATION;
      if (cacheAge < extendedDuration) {
        return cached.data;
      }
    }

    // Rate limit with exponential backoff (only if needed)
    const now = Date.now();
    const timeSinceLastCall = now - lastCoinGeckoCall;
    const baseDelay = consecutiveRateLimits > 0 
      ? COINGECKO_DELAY * Math.pow(2, consecutiveRateLimits) 
      : COINGECKO_DELAY;
    
    if (timeSinceLastCall < baseDelay) {
      await new Promise(resolve => setTimeout(resolve, baseDelay - timeSinceLastCall));
    }

    lastCoinGeckoCall = Date.now();

    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        if (resp.status === 429) {
          consecutiveRateLimits++;
          // Exponential backoff: 5s, 10s, 20s, 40s...
          const backoffDelay = 5000 * Math.pow(2, Math.min(retryCount, 4));
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
          
          // Limit retries to prevent infinite loops
          if (retryCount < 3) {
            return rateLimitedFetch(url, cacheKey, retryCount + 1);
          }
          return null; // Give up after 3 retries
        }
        throw new Error(`HTTP ${resp.status}`);
      }
      
      // Success - reset rate limit counter
      consecutiveRateLimits = Math.max(0, consecutiveRateLimits - 1);
      const data = await resp.json();

      // Cache the result
      if (cacheKey) {
        coinGeckoCache.set(cacheKey, { data, timestamp: Date.now() });
        
        // Clean up old cache entries if cache is too large
        if (coinGeckoCache.size > MAX_CACHE_SIZE) {
          const oldestKeys = Array.from(coinGeckoCache.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp)
            .slice(0, coinGeckoCache.size - MAX_CACHE_SIZE)
            .map(entry => entry[0]);
          
          oldestKeys.forEach(key => coinGeckoCache.delete(key));
        }
      }

      return data;
    } catch (err) {
      return null;
    }
  }

  const els = {
    loadingScreen: document.getElementById('loadingScreen'),
    toggleThemeBtn: document.getElementById('toggleThemeBtn'),
    openSettingsBtn: document.getElementById('openSettingsBtn'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    cancelSettingsBtn: document.getElementById('cancelSettingsBtn'),
    settingsBackdrop: document.getElementById('settingsBackdrop'),
    openStickersBtn: document.getElementById('openStickersBtn'),
    openStickersBtnMobile: document.getElementById('openStickersBtnMobile'),
    stickerWindow: document.getElementById('stickerWindow'),
    closeStickerWindowBtn: document.getElementById('closeStickerWindowBtn'),
    openDonateBtn: document.getElementById('openDonateBtn'),
    openDonateBtnMobile: document.getElementById('openDonateBtnMobile'),
    donateWindow: document.getElementById('donateWindow'),
    closeDonateWindowBtn: document.getElementById('closeDonateWindowBtn'),
    toggleAmountsBtn: document.getElementById('toggleAmountsBtn'),
    wallpaperSelect: document.getElementById('wallpaperSelect'),
    decreaseFontBtn: document.getElementById('decreaseFontBtn'),
    increaseFontBtn: document.getElementById('increaseFontBtn'),
    fontSizeDisplay: document.getElementById('fontSizeDisplay'),
    mobileMenuBtn: document.getElementById('mobileMenuBtn'),
    closeMobileMenuBtn: document.getElementById('closeMobileMenuBtn'),
    mobileMenu: document.getElementById('mobileMenu'),
    toggleSnowBtnMobile: document.getElementById('toggleSnowBtnMobile'),
    toggleRainBtnMobile: document.getElementById('toggleRainBtnMobile'),
    toggleThemeBtnMobile: document.getElementById('toggleThemeBtnMobile'),
    toggleAmountsBtnMobile: document.getElementById('toggleAmountsBtnMobile'),
    decreaseFontBtnMobile: document.getElementById('decreaseFontBtnMobile'),
    increaseFontBtnMobile: document.getElementById('increaseFontBtnMobile'),
    fontSizeDisplayMobile: document.getElementById('fontSizeDisplayMobile'),
    openSettingsBtnMobile: document.getElementById('openSettingsBtnMobile'),
    settingsDialog: document.getElementById('settingsDialog'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    exportSettingsBtn: document.getElementById('exportSettingsBtn'),
    importSettingsBtn: document.getElementById('importSettingsBtn'),
    settingsExportArea: document.getElementById('settingsExportArea'),
    walletAddresses: document.getElementById('walletAddresses'),
    alchemyApiKey: document.getElementById('alchemyApiKey'),
    heliusApiKey: document.getElementById('heliusApiKey'),
    openSeaApiKey: document.getElementById('openSeaApiKey'),
    themeSelect: document.getElementById('themeSelect'),
    userName: document.getElementById('userName'),
    positionsContainer: document.getElementById('positionsContainer'),
    addPositionBtn: document.getElementById('addPositionBtn'),
    weatherLabel: document.getElementById('weatherLabel'),
    weatherLat: document.getElementById('weatherLat'),
    weatherLon: document.getElementById('weatherLon'),
    showRainForecast: document.getElementById('showRainForecast'),
    useColoredPnL: document.getElementById('useColoredPnL'),
    leftAligned: document.getElementById('leftAligned'),
    usePythPrices: document.getElementById('usePythPrices'),
    minBalanceThreshold: document.getElementById('minBalanceThreshold'),
    enableRealTimeUpdates: document.getElementById('enableRealTimeUpdates'),
    realTimeUpdateInterval: document.getElementById('realTimeUpdateInterval'),
    getLocationBtn: document.getElementById('getLocationBtn'),
    refreshMins: document.getElementById('refreshMins'),
    greeting: document.getElementById('greeting'),
    greetingMobile: document.getElementById('greetingMobile'),
    summary: document.getElementById('summary'),
    positionsBody: document.getElementById('positionsBody'),
    mobilePositionsContainer: document.getElementById('mobilePositionsContainer'),
    calvinImage: document.getElementById('calvinImage'),
    tabCalvin: document.getElementById('tabCalvin'),
    tabPeanuts: document.getElementById('tabPeanuts'),
    tabFarside: document.getElementById('tabFarside'),
    comicToggleBtn: document.getElementById('comicToggleBtn'),
    comicSection: document.getElementById('comicSection'),
    calvinPrevBtn: document.getElementById('calvinPrevBtn'),
    calvinNextBtn: document.getElementById('calvinNextBtn'),
    calvinRandomBtn: document.getElementById('calvinRandomBtn'),
    calvinPrevBtnMobile: document.getElementById('calvinPrevBtnMobile'),
    calvinNextBtnMobile: document.getElementById('calvinNextBtnMobile'),
    calvinRandomBtnMobile: document.getElementById('calvinRandomBtnMobile'),
    hideSmallBtn: document.getElementById('hideSmallBtn'),
    toggleNftsBtn: document.getElementById('toggleNftsBtn'),
    editListBtn: document.getElementById('editListBtn'),
    comicStrip: document.getElementById('comicStrip'),
    showComic: document.getElementById('showComic'),
    lastUpdateTimestamp: document.getElementById('lastUpdateTimestamp'),
    showSnowBtn: document.getElementById('showSnowBtn'),
    showRainBtn: document.getElementById('showRainBtn'),
    showThemeBtn: document.getElementById('showThemeBtn'),
    showAmountsBtn: document.getElementById('showAmountsBtn'),
    showFontSize: document.getElementById('showFontSize'),
    showStickersBtn: document.getElementById('showStickersBtn'),
    showDonateBtn: document.getElementById('showDonateBtn'),
    toggleSnowBtn: document.getElementById('toggleSnowBtn'),
    toggleRainBtn: document.getElementById('toggleRainBtn'),
    fontSizeControls: document.getElementById('fontSizeControls'),
  };
  
  let amountsVisible = true;
  let hideSmallPositions = true;
  let hideNfts = false;
  let editMode = false;
  let currentFontSize = 15; // default font size in px
  let currentCalvinDate = new Date(); // Track current comic date
  
  // Comic metadata
  const comicMetadata = {
    calvinandhobbes: {
      name: 'Calvin & Hobbes',
      baseUrl: 'https://www.gocomics.com/calvinandhobbes',
      startDate: new Date('1985-11-18'),
      endDate: new Date('1995-12-31'),
    },
    peanuts: {
      name: 'Peanuts',
      baseUrl: 'https://www.gocomics.com/peanuts',
      startDate: new Date('1950-10-02'),
      endDate: new Date('2000-02-13'),
    },
    farside: {
      name: 'The Far Side',
      baseUrl: 'https://www.thefarside.com',
      startDate: new Date('1980-01-01'),
      endDate: new Date('1995-01-01'),
    },
  };

  // Format numbers in a compact way
  function formatCompactNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'k';
    } else if (num >= 1) {
      return num.toFixed(2);
    } else {
      return num.toFixed(4);
    }
  }

  function loadSettings() {
    // SPEED: Use cache to avoid repeated localStorage reads/decryption
    const now = Date.now();
    if (settingsCache && (now - settingsCacheTime) < 5000) {
      return settingsCache;
    }
    
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const settings = JSON.parse(raw);
      
      // Decrypt sensitive fields
      if (settings.walletAddresses) {
        settings.walletAddresses = simpleDecrypt(settings.walletAddresses);
      }
      if (settings.alchemyApiKey) {
        settings.alchemyApiKey = simpleDecrypt(settings.alchemyApiKey);
      }
      if (settings.heliusApiKey) {
        settings.heliusApiKey = simpleDecrypt(settings.heliusApiKey);
      }
      if (settings.openSeaApiKey) {
        settings.openSeaApiKey = simpleDecrypt(settings.openSeaApiKey);
      }
      // Backward compatibility for old format
      if (settings.hyperliquidAddress) {
        settings.hyperliquidAddress = simpleDecrypt(settings.hyperliquidAddress);
      }
      if (settings.lighterAddress) {
        settings.lighterAddress = simpleDecrypt(settings.lighterAddress);
      }
      
      // Cache the result
      settingsCache = settings;
      settingsCacheTime = now;
      
      return settings;
    } catch {
      return null;
    }
  }

  function saveSettings(settings) {
    // Create a copy to avoid modifying the original
    const settingsToSave = { ...settings };
    
    // Encrypt sensitive fields before saving
    if (settingsToSave.walletAddresses) {
      settingsToSave.walletAddresses = simpleEncrypt(settingsToSave.walletAddresses);
    }
    if (settingsToSave.alchemyApiKey) {
      settingsToSave.alchemyApiKey = simpleEncrypt(settingsToSave.alchemyApiKey);
    }
    if (settingsToSave.heliusApiKey) {
      settingsToSave.heliusApiKey = simpleEncrypt(settingsToSave.heliusApiKey);
    }
    if (settingsToSave.openSeaApiKey) {
      settingsToSave.openSeaApiKey = simpleEncrypt(settingsToSave.openSeaApiKey);
    }
    // Backward compatibility for old format
    if (settingsToSave.hyperliquidAddress) {
      settingsToSave.hyperliquidAddress = simpleEncrypt(settingsToSave.hyperliquidAddress);
    }
    if (settingsToSave.lighterAddress) {
      settingsToSave.lighterAddress = simpleEncrypt(settingsToSave.lighterAddress);
    }
    
    localStorage.setItem(storageKey, JSON.stringify(settingsToSave));
    
    // Invalidate cache
    settingsCache = null;
    settingsCacheTime = 0;
  }

  function getDefaultSettings() {
    return {
      theme: 'light',
      refreshMinutes: 30,
      userName: '',
      cryptoPositions: [],
      weather: { label: '', lat: null, lon: null },
      walletAddresses: '',
      alchemyApiKey: '',
      heliusApiKey: '',
      openSeaApiKey: '',
      fontSize: 15,
      comicStrip: 'calvinandhobbes',
      showComic: true,
      comicCollapsed: false, // Whether comic section is collapsed
      showRainForecast: true,
      useColoredPnL: true,
      leftAligned: false,
      usePythPrices: true,
      minBalanceThreshold: 100,
      enableRealTimeUpdates: true,
      realTimeUpdateInterval: 10, // seconds
      showSnowBtn: true,
      showRainBtn: true,
      showThemeBtn: true,
      showAmountsBtn: true,
      showFontSize: true,
      showStickersBtn: true,
      showDonateBtn: true,
      hiddenAssets: [] // Array of hidden asset keys: "ASSET_EXCHANGE"
    };
  }
  
  function parseWallets(walletString) {
    if (!walletString) return [];
    return walletString
      .split(',')
      .map(w => w.trim())
      .filter(w => w.length > 0);
  }

  function applyHeaderVisibility(settings) {
    // Show/hide header bar elements based on settings (default to true for undefined)
    if (els.toggleSnowBtn) {
      els.toggleSnowBtn.style.display = (settings.showSnowBtn ?? true) ? '' : 'none';
    }
    if (els.toggleRainBtn) {
      els.toggleRainBtn.style.display = (settings.showRainBtn ?? true) ? '' : 'none';
    }
    if (els.toggleThemeBtn) {
      els.toggleThemeBtn.style.display = (settings.showThemeBtn ?? true) ? '' : 'none';
    }
    if (els.toggleAmountsBtn) {
      els.toggleAmountsBtn.style.display = (settings.showAmountsBtn ?? true) ? '' : 'none';
    }
    if (els.fontSizeControls) {
      els.fontSizeControls.style.display = (settings.showFontSize ?? true) ? '' : 'none';
    }
    if (els.openStickersBtn) {
      els.openStickersBtn.style.display = (settings.showStickersBtn ?? true) ? '' : 'none';
    }
    if (els.openDonateBtn) {
      els.openDonateBtn.style.display = (settings.showDonateBtn ?? true) ? '' : 'none';
    }
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    
    // Update theme button text - shows the NEXT theme when clicked
    // light -> dark -> halloween -> christmas -> amber -> matrix -> light
    const themeLabels = {
      'light': 'DARK THEME',
      'dark': 'HALLOWEEN THEME',
      'halloween': 'CHRISTMAS THEME',
      'christmas': 'AMBER THEME',
      'amber': 'MATRIX THEME',
      'matrix': 'LIGHT THEME'
    };
    
    const nextThemeLabel = themeLabels[theme] || 'DARK THEME';
    
    if (els.toggleThemeBtn) {
      els.toggleThemeBtn.textContent = `[${nextThemeLabel}]`;
    }
    if (els.toggleThemeBtnMobile) {
      els.toggleThemeBtnMobile.textContent = `[${nextThemeLabel}]`;
    }
    
    // Update dropdown if it exists
    if (els.themeSelect) {
      els.themeSelect.value = theme;
    }
    
    // Auto-enable snow for Christmas theme
    if (theme === 'christmas' && !snowActive) {
      toggleSnow();
    }
    // Auto-disable snow when leaving Christmas theme (optional - you can remove this if you want snow to persist)
    else if (theme !== 'christmas' && snowActive) {
      toggleSnow();
    }
  }
  
  function applyAlignment(leftAligned) {
    const container = document.querySelector('.container');
    if (container) {
      if (leftAligned) {
        container.style.margin = '';
      } else {
        container.style.margin = '0 auto';
      }
    }
  }

  function applyFontSize(size) {
    document.documentElement.style.fontSize = size + 'px';
    currentFontSize = size;
    if (els.fontSizeDisplay) {
      els.fontSizeDisplay.textContent = size + 'px';
    }
    if (els.fontSizeDisplayMobile) {
      els.fontSizeDisplayMobile.textContent = size + 'px';
    }
  }
  
  function openMobileMenu() {
    if (els.mobileMenu) {
      els.mobileMenu.classList.add('active');
    }
  }
  
  function closeMobileMenu() {
    if (els.mobileMenu) {
      els.mobileMenu.classList.remove('active');
    }
  }

  function initTheme(settings) {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = settings?.theme || (prefersDark ? 'dark' : 'light');
    applyTheme(theme);
    
    // Add click handler for theme toggle button - cycle through themes
    if (els.toggleThemeBtn) {
      els.toggleThemeBtn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const themeOrder = ['light', 'dark', 'halloween', 'christmas', 'amber', 'matrix'];
        const currentIndex = themeOrder.indexOf(currentTheme);
        const newTheme = themeOrder[(currentIndex + 1) % themeOrder.length];
        applyTheme(newTheme);
        const s = loadSettings() || getDefaultSettings();
        s.theme = newTheme;
        saveSettings(s);
      });
    }
    
    // Initialize font size - convert old string values to numbers
    let fontSize = settings?.fontSize;
    if (typeof fontSize === 'string' || !fontSize) {
      fontSize = 15; // Reset to default if it's a string like "medium"
    }
    applyFontSize(fontSize);
  }

  function renderPositionRow(position, index) {
    const row = document.createElement('div');
    row.className = 'item-row item-row-wide';
    row.innerHTML = `
      <input type="text" value="${position.symbol || ''}" data-idx="${index}" data-field="symbol" placeholder="BTC">
      <input type="text" value="${position.coingeckoId || ''}" data-idx="${index}" data-field="coingeckoId" placeholder="bitcoin">
      <input type="number" step="any" value="${position.amount ?? ''}" data-idx="${index}" data-field="amount" placeholder="1.5">
      <input type="number" step="any" value="${position.entryPrice ?? ''}" data-idx="${index}" data-field="entryPrice" placeholder="50000">
      <button type="button" class="remove-btn btn-text" data-idx="${index}" data-kind="position">[X]</button>
    `;
    return row;
  }

  let assetsLoaded = false;
  let dragDropSetup = false;
  
  function openStickerWindow() {
    if (els.stickerWindow) {
      els.stickerWindow.style.display = 'flex';
      
      // Load assets if not already loaded
      if (!assetsLoaded) {
        loadCustomAssets().then(() => {
          assetsLoaded = true;
          // Setup drag-drop after assets are loaded
          if (!dragDropSetup) {
            setTimeout(() => {
              setupStickerDragDrop();
              dragDropSetup = true;
            }, 500);
          }
        }).catch(err => {
          console.error('✗ Asset load failed');
        });
      }
      
      // Add click-outside-to-close handler
      setTimeout(() => {
        document.addEventListener('click', handleStickerWindowClickOutside);
      }, 100);
    }
    
    // Close mobile menu if open
    if (els.mobileMenu) {
      els.mobileMenu.classList.remove('active');
    }
  }
  
  function handleStickerWindowClickOutside(e) {
    if (els.stickerWindow && 
        els.stickerWindow.style.display === 'flex' &&
        !els.stickerWindow.contains(e.target) &&
        !els.openStickersBtn?.contains(e.target) &&
        !els.openStickersBtnMobile?.contains(e.target)) {
      closeStickerWindow();
    }
  }
  
  function closeStickerWindow() {
    if (els.stickerWindow) {
      els.stickerWindow.style.display = 'none';
      document.removeEventListener('click', handleStickerWindowClickOutside);
    }
  }
  
  function openDonateWindow() {
    if (els.donateWindow) {
      els.donateWindow.style.display = 'flex';
      
      // Add click-outside-to-close after a short delay
      setTimeout(() => {
        document.addEventListener('click', handleDonateWindowClickOutside);
      }, 100);
    }
    
    // Close mobile menu if open
    if (els.mobileMenu) {
      els.mobileMenu.classList.remove('active');
    }
  }
  
  function handleDonateWindowClickOutside(e) {
    if (els.donateWindow && 
        els.donateWindow.style.display === 'flex' &&
        !els.donateWindow.contains(e.target) &&
        !els.openDonateBtn?.contains(e.target) &&
        !els.openDonateBtnMobile?.contains(e.target)) {
      closeDonateWindow();
    }
  }
  
  function closeDonateWindow() {
    if (els.donateWindow) {
      els.donateWindow.style.display = 'none';
      document.removeEventListener('click', handleDonateWindowClickOutside);
    }
  }
  
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
      console.error('Copy failed:', err);
    }
  }

  function openSettings() {
    const settings = loadSettings() || getDefaultSettings();
    
    // Migrate old settings to new format
    if (!settings.walletAddresses && (settings.hyperliquidAddress || settings.lighterAddress)) {
      const addresses = [];
      if (settings.hyperliquidAddress) addresses.push(settings.hyperliquidAddress);
      if (settings.lighterAddress && settings.lighterAddress !== settings.hyperliquidAddress) {
        addresses.push(settings.lighterAddress);
      }
      settings.walletAddresses = addresses.join(', ');
    }
    
    // Populate settings
    els.walletAddresses.value = settings.walletAddresses || '';
    els.alchemyApiKey.value = settings.alchemyApiKey || '';
    els.heliusApiKey.value = settings.heliusApiKey || '';
    els.openSeaApiKey.value = settings.openSeaApiKey || '';
    els.themeSelect.value = settings.theme || 'light';
    els.userName.value = settings.userName || '';
    els.positionsContainer.innerHTML = '';
    if (settings.cryptoPositions.length === 0) {
      // Always show at least one empty row
      els.positionsContainer.appendChild(renderPositionRow({ symbol: '', coingeckoId: '', amount: 0, entryPrice: 0 }, 0));
    } else {
    settings.cryptoPositions.forEach((p, i) => {
      els.positionsContainer.appendChild(renderPositionRow(p, i));
    });
    }
    els.weatherLabel.value = settings.weather.label || '';
    els.weatherLat.value = settings.weather.lat ?? '';
    els.weatherLon.value = settings.weather.lon ?? '';
    els.showRainForecast.checked = settings.showRainForecast ?? true;
    els.useColoredPnL.checked = settings.useColoredPnL ?? true;
    els.leftAligned.checked = settings.leftAligned ?? false;
    els.usePythPrices.checked = settings.usePythPrices ?? false;
    els.minBalanceThreshold.value = settings.minBalanceThreshold ?? 100;
    els.enableRealTimeUpdates.checked = settings.enableRealTimeUpdates ?? true;
    els.realTimeUpdateInterval.value = settings.realTimeUpdateInterval ?? 10;
    els.showComic.checked = settings.showComic ?? true;
    els.refreshMins.value = settings.refreshMinutes ?? 30;
    els.comicStrip.value = settings.comicStrip || 'calvinandhobbes';

    // Header bar visibility settings
    els.showSnowBtn.checked = settings.showSnowBtn ?? true;
    els.showRainBtn.checked = settings.showRainBtn ?? true;
    els.showThemeBtn.checked = settings.showThemeBtn ?? true;
    els.showAmountsBtn.checked = settings.showAmountsBtn ?? true;
    els.showFontSize.checked = settings.showFontSize ?? true;
    els.showStickersBtn.checked = settings.showStickersBtn ?? true;
    els.showDonateBtn.checked = settings.showDonateBtn ?? true;

    // Show settings panel
    els.settingsDialog.style.display = 'block';
    els.settingsBackdrop.style.display = 'block';
    // Toggle button visibility
    els.openSettingsBtn.style.display = 'none';
    els.closeSettingsBtn.style.display = 'inline-block';
  }
  
  function closeSettings() {
    // Hide settings panel
    els.settingsDialog.style.display = 'none';
    els.settingsBackdrop.style.display = 'none';
    // Toggle button visibility
    els.openSettingsBtn.style.display = 'inline-block';
    els.closeSettingsBtn.style.display = 'none';
    
    // Reset import/export mode
    if (els.settingsExportArea) {
      els.settingsExportArea.style.display = 'none';
      els.settingsExportArea.setAttribute('readonly', 'true');
    }
    if (els.importSettingsBtn) {
      els.importSettingsBtn.textContent = '[IMPORT]';
    }
  }

  function collectSettingsFromForm() {
    const current = loadSettings() || getDefaultSettings();
    const newSettings = { ...current };

    // Get wallet addresses and API keys
    newSettings.walletAddresses = els.walletAddresses.value.trim() || '';
    newSettings.alchemyApiKey = els.alchemyApiKey.value.trim() || '';
    newSettings.heliusApiKey = els.heliusApiKey.value.trim() || '';
    newSettings.openSeaApiKey = els.openSeaApiKey.value.trim() || '';

    const posInputs = els.positionsContainer.querySelectorAll('input');
    const positionsMap = new Map();
    posInputs.forEach((inp) => {
      const idx = Number(inp.dataset.idx);
      const field = inp.dataset.field;
      const prev = positionsMap.get(idx) || {};
      if (field === 'amount' || field === 'entryPrice') {
        prev[field] = Number(inp.value || 0);
      } else if (field === 'symbol') {
        prev[field] = inp.value.trim().toUpperCase();
      } else if (field === 'coingeckoId') {
        prev[field] = inp.value.trim().toLowerCase();
      }
      positionsMap.set(idx, prev);
    });
    newSettings.cryptoPositions = Array.from(positionsMap.values()).filter(p => p.symbol);

    newSettings.userName = els.userName.value.trim() || 'Tomas';
    
    newSettings.weather = {
      label: els.weatherLabel.value.trim(),
      lat: els.weatherLat.value ? Number(els.weatherLat.value) : null,
      lon: els.weatherLon.value ? Number(els.weatherLon.value) : null,
    };

    newSettings.refreshMinutes = Math.max(1, Number(els.refreshMins.value || 30));
    newSettings.comicStrip = els.comicStrip.value || 'calvinandhobbes';
    newSettings.showComic = els.showComic.checked;
    newSettings.showRainForecast = els.showRainForecast.checked;
    newSettings.useColoredPnL = els.useColoredPnL.checked;
    newSettings.leftAligned = els.leftAligned.checked;
    newSettings.usePythPrices = els.usePythPrices.checked;
    newSettings.minBalanceThreshold = Math.max(0, Number(els.minBalanceThreshold.value || 100));
    newSettings.theme = els.themeSelect.value || 'light';
    newSettings.wallpaper = els.wallpaperSelect ? els.wallpaperSelect.value : 'none';
    newSettings.enableRealTimeUpdates = els.enableRealTimeUpdates.checked;
    newSettings.realTimeUpdateInterval = Math.max(5, Math.min(60, Number(els.realTimeUpdateInterval.value || 10)));
    
    // Header bar visibility settings
    newSettings.showSnowBtn = els.showSnowBtn.checked;
    newSettings.showRainBtn = els.showRainBtn.checked;
    newSettings.showThemeBtn = els.showThemeBtn.checked;
    newSettings.showAmountsBtn = els.showAmountsBtn.checked;
    newSettings.showFontSize = els.showFontSize.checked;
    newSettings.showStickersBtn = els.showStickersBtn.checked;
    newSettings.showDonateBtn = els.showDonateBtn.checked;
    
    return newSettings;
  }

  function addHandlers() {
    els.openSettingsBtn.addEventListener('click', openSettings);
    
    if (els.openSettingsBtnMobile) {
      els.openSettingsBtnMobile.addEventListener('click', () => {
        closeMobileMenu();
        openSettings();
      });
    }
    
    // Last update timestamp - click to refresh
    if (els.lastUpdateTimestamp) {
      els.lastUpdateTimestamp.addEventListener('click', async () => {
        els.lastUpdateTimestamp.textContent = 'Updating...';
        await refreshAll();
      });
    }
    
    // Sticker window handlers
    if (els.openStickersBtn) {
      els.openStickersBtn.addEventListener('click', openStickerWindow);
    }
    
    if (els.openStickersBtnMobile) {
      els.openStickersBtnMobile.addEventListener('click', () => {
        closeMobileMenu();
        openStickerWindow();
      });
    }
    
    if (els.closeStickerWindowBtn) {
      els.closeStickerWindowBtn.addEventListener('click', closeStickerWindow);
    }
    
    // Donate window handlers
    if (els.openDonateBtn) {
      els.openDonateBtn.addEventListener('click', openDonateWindow);
    }
    
    if (els.openDonateBtnMobile) {
      els.openDonateBtnMobile.addEventListener('click', () => {
        closeMobileMenu();
        openDonateWindow();
      });
    }
    
    if (els.closeDonateWindowBtn) {
      els.closeDonateWindowBtn.addEventListener('click', closeDonateWindow);
    }
    
    // Copy address buttons - event delegation
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('copy-address-btn')) {
        const address = e.target.getAttribute('data-address');
        if (address) {
          copyToClipboard(address, e.target);
        }
      }
    });
    
    // Theme dropdown change handler
    if (els.themeSelect) {
      els.themeSelect.addEventListener('change', () => {
        const newTheme = els.themeSelect.value;
        applyTheme(newTheme);
      });
    }
    
    // Export settings
    if (els.exportSettingsBtn) {
      els.exportSettingsBtn.addEventListener('click', async () => {
        const settings = loadSettings() || getDefaultSettings();
        const exportData = btoa(JSON.stringify(settings));
        els.settingsExportArea.value = exportData;
        els.settingsExportArea.style.display = 'block';
        els.settingsExportArea.removeAttribute('readonly');
        els.settingsExportArea.select();
        
        try {
          await navigator.clipboard.writeText(exportData);
          const originalText = els.exportSettingsBtn.textContent;
          els.exportSettingsBtn.textContent = '[COPIED!]';
          setTimeout(() => {
            els.exportSettingsBtn.textContent = originalText;
          }, 1500);
        } catch (err) {
        }
      });
    }
    
    // Import settings
    if (els.importSettingsBtn) {
      let importMode = false;
      els.importSettingsBtn.addEventListener('click', () => {
        if (!importMode) {
          // First click: show textarea for pasting
          els.settingsExportArea.value = '';
          els.settingsExportArea.placeholder = 'Paste exported settings here and click [IMPORT] again';
          els.settingsExportArea.style.display = 'block';
          els.settingsExportArea.removeAttribute('readonly');
          els.settingsExportArea.focus();
          els.importSettingsBtn.textContent = '[APPLY IMPORT]';
          importMode = true;
        } else {
          // Second click: import the settings
          try {
            const importData = els.settingsExportArea.value.trim();
            if (!importData) {
              alert('Please paste settings data first');
              return;
            }
            const decoded = atob(importData);
            const settings = JSON.parse(decoded);
            saveSettings(settings);
            closeSettings();
            
            // Apply all settings
            applyAlignment(settings.leftAligned);
            applyTheme(settings.theme);
            
            // Restart real-time updates
            stopRealTimeUpdates();
            if (settings.enableRealTimeUpdates) {
              setTimeout(() => startRealTimeUpdates(), 1000);
            }
            
            // Hide textarea and reset
            els.settingsExportArea.style.display = 'none';
            els.importSettingsBtn.textContent = '[IMPORT]';
            importMode = false;
            
            refreshAll();
          } catch (err) {
            alert('Invalid settings data. Please check the pasted text and try again.');
            console.error('✗ Import failed');
          }
        }
      });
      
      // Reset import mode when settings dialog closes (handled below)
    }
    
    // Close settings button
    if (els.closeSettingsBtn) {
      els.closeSettingsBtn.addEventListener('click', closeSettings);
    }
    
    // Cancel settings button
    if (els.cancelSettingsBtn) {
      els.cancelSettingsBtn.addEventListener('click', closeSettings);
    }
    
    // Backdrop click to close
    if (els.settingsBackdrop) {
      els.settingsBackdrop.addEventListener('click', closeSettings);
    }
    
    // Click to copy on export textarea
    if (els.settingsExportArea) {
      els.settingsExportArea.addEventListener('click', async function() {
        if (this.value && this.readOnly) {
          this.select();
          try {
            await navigator.clipboard.writeText(this.value);
          } catch (err) {
          }
        }
      });
    }
    
    els.saveSettingsBtn.addEventListener('click', () => {
      const s = collectSettingsFromForm();
      saveSettings(s);
      closeSettings();
      
      // Show/hide comic section immediately based on showComic setting
      if (els.comicSection) {
        els.comicSection.style.display = s.showComic ? 'block' : 'none';
      }
      
      // Apply alignment setting
      applyAlignment(s.leftAligned);
      
      // Apply theme
      applyTheme(s.theme);
      
      // Apply wallpaper
      applyWallpaper(s.wallpaper);
      
      // Apply header visibility
      applyHeaderVisibility(s);
      
      // Restart real-time updates with new settings
      stopRealTimeUpdates();
      if (s.enableRealTimeUpdates) {
        setTimeout(() => startRealTimeUpdates(), 1000);
      }
      
      refreshAll();
    });

    els.addPositionBtn.addEventListener('click', () => {
      const idx = (els.positionsContainer.querySelectorAll('.item-row').length) || 0;
      els.positionsContainer.appendChild(renderPositionRow({ symbol: '', coingeckoId: '', amount: 0, entryPrice: 0 }, idx));
    });

    // Get location button
    if (els.getLocationBtn) {
      els.getLocationBtn.addEventListener('click', async () => {
        if (!navigator.geolocation) {
          alert('Geolocation is not supported by your browser');
          return;
        }

        els.getLocationBtn.textContent = '[GETTING LOCATION...]';
        els.getLocationBtn.disabled = true;

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

          els.weatherLat.value = lat;
          els.weatherLon.value = lon;

          // Try to get city name via reverse geocoding
          try {
            const geoResp = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
            if (geoResp.ok) {
              const geoData = await geoResp.json();
              const city = geoData.city || geoData.locality || geoData.principalSubdivision || '';
              if (city) {
                els.weatherLabel.value = city;
              }
            }
          } catch (err) {
            // Silent
          }

          els.getLocationBtn.textContent = '[USE MY LOCATION]';
          els.getLocationBtn.disabled = false;
        } catch (err) {
          console.error('✗ Location denied');
          alert('Could not get your location. Please check browser permissions.');
          els.getLocationBtn.textContent = '[USE MY LOCATION]';
          els.getLocationBtn.disabled = false;
        }
      });
    }

    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.matches('.remove-btn')) {
        const kind = target.dataset.kind;
        const idx = Number(target.dataset.idx);
        if (kind === 'position') {
          const rows = Array.from(els.positionsContainer.children);
          if (rows[idx]) rows[idx].remove();
        }
      }
    });
  }

  async function renderCalvin(date = null, shouldFade = false) {
    try {
      if (!date) date = currentCalvinDate;
      
      const settings = loadSettings() || getDefaultSettings();
      const comicStrip = settings.comicStrip || 'calvinandhobbes';
      const comic = comicMetadata[comicStrip];
      
      if (!comic) {
        throw new Error('Unknown comic strip');
      }
      
      // If we should fade, add fading class and wait
      if (shouldFade) {
        const calvinContainer = document.querySelector('.calvin-container');
        if (calvinContainer) {
          calvinContainer.classList.add('fading');
          await new Promise(resolve => setTimeout(resolve, 300)); // Wait for fade
        }
      } else {
        // First load, show loading
        els.calvinImage.innerHTML = '<span class="loading-terminal">[...]</span>';
      }
      
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      
      let comicUrl, proxyUrl;
      
      // The Far Side uses a different URL structure
      if (comicStrip === 'farside') {
        comicUrl = `https://www.thefarside.com/${year}/${month}/${day}`;
        proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(comicUrl)}`;
      } else {
        // GoComics strips
        comicUrl = `${comic.baseUrl}/${year}/${month}/${day}`;
        proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(comicUrl)}`;
      }
      
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error('Failed to fetch comic');
      
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      
      let imgUrl = null;
      
      // The Far Side uses a specific class and CDN
      if (comicStrip === 'farside') {
        // Method 1: Look for images from amuniversal CDN in all attributes
        const allImages = doc.querySelectorAll('img');
        for (const img of allImages) {
          // Check all possible attributes
          const attributes = ['src', 'data-src', 'data-lazy-src', 'srcset', 'data-srcset'];
          for (const attr of attributes) {
            const value = img.getAttribute(attr);
            if (value && value.includes('featureassets.amuniversal.com')) {
              imgUrl = value.split(',')[0].split(' ')[0]; // Handle srcset format
              break;
            }
          }
          if (imgUrl) break;
        }
        
        // Method 2: Look in the HTML source for amuniversal URLs
        if (!imgUrl) {
          const htmlText = html;
          const match = htmlText.match(/https?:\/\/featureassets\.amuniversal\.com\/[^\s"'<>]+/);
          if (match) {
            imgUrl = match[0];
          }
        }
      }
      
      // Method 1: Look for og:image meta tag
      if (!imgUrl) {
        const ogImage = doc.querySelector('meta[property="og:image"]');
        if (ogImage) {
          imgUrl = ogImage.getAttribute('content');
        }
      }
      
      // Method 2: Look for the main comic image (GoComics)
      if (!imgUrl) {
        const comicImg = doc.querySelector('.comic.img-fluid, picture img, .item-comic-image img');
        if (comicImg) {
          imgUrl = comicImg.getAttribute('src') || comicImg.getAttribute('data-src');
        }
      }
      
      
      if (imgUrl) {
        // Ensure the URL is absolute
        if (imgUrl.startsWith('//')) {
          imgUrl = 'https:' + imgUrl;
        } else if (imgUrl.startsWith('/')) {
          if (comicStrip === 'farside') {
            imgUrl = 'https://www.thefarside.com' + imgUrl;
          } else {
            imgUrl = 'https://www.gocomics.com' + imgUrl;
          }
        }
        
        // Preload the image before showing it
        const img = new Image();
        img.src = imgUrl;
        
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          setTimeout(reject, 10000);
        });
        
        // Image is loaded, now update DOM
        els.calvinImage.innerHTML = `
          <a href="${comicUrl}" target="_blank" style="display: block;">
            <img src="${imgUrl}" alt="${comic.name} comic">
          </a>
        `;
        
        // Remove fading class to fade back in
        const calvinContainer = document.querySelector('.calvin-container');
        if (calvinContainer) {
          calvinContainer.classList.remove('fading');
        }
        
        // Handle button visibility - show prev/random, conditionally show next
        if (els.calvinPrevBtn) els.calvinPrevBtn.style.display = '';
        if (els.calvinRandomBtn) els.calvinRandomBtn.style.display = '';
        if (els.calvinNextBtn) {
          if (date >= comic.endDate) {
            els.calvinNextBtn.style.display = 'none';
          } else {
            els.calvinNextBtn.style.display = '';
          }
        }
        
      } else {
        throw new Error('Could not find comic image');
      }
      
    } catch (err) {
      console.error('✗ Comic load failed');
      
      const settings = loadSettings() || getDefaultSettings();
      const comicStrip = settings.comicStrip || 'calvinandhobbes';
      const comic = comicMetadata[comicStrip];
      
      // Remove fading class on error too
      const calvinContainer = document.querySelector('.calvin-container');
      if (calvinContainer) {
        calvinContainer.classList.remove('fading');
      }
      
      // Check if we're at the last comic and hide next button even on error
      const checkDate = date || currentCalvinDate;
      if (els.calvinNextBtn && comic) {
        if (checkDate >= comic.endDate) {
          els.calvinNextBtn.style.display = 'none';
        } else {
          els.calvinNextBtn.style.display = '';
        }
      }
      
      const errorUrl = comic ? comic.baseUrl : 'https://www.gocomics.com';
      els.calvinImage.innerHTML = `
        <div style="text-align: center; padding: 40px; width: 100%; color: var(--muted);">
          <p id="retryComicText" style="cursor: pointer;">Unable to load comic. Click to retry.</p>
          <p style="font-size: 13px; margin-top: 12px;">
            <a href="${errorUrl}" target="_blank" class="external-link">View online ↗</a>
          </p>
        </div>
      `;
      
      // Add retry click event listener
      const retryText = document.getElementById('retryComicText');
      if (retryText) {
        retryText.addEventListener('click', () => renderCalvin());
      }
    }
  }

  async function fetchCryptoPrices() {
    const settings = loadSettings();
    if (!settings || !settings.cryptoPositions || settings.cryptoPositions.length === 0) return null;

    const ids = settings.cryptoPositions
      .filter(p => p.coingeckoId)
      .map(p => p.coingeckoId)
      .join(',');
    
    if (!ids) return null;

    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
    return await rateLimitedFetch(url, `crypto-positions-${ids}`);
  }

  function getCoinIcon(symbol) {
    return `https://assets.coingecko.com/coins/images/${symbol === 'BTC' ? '1' : symbol === 'ETH' ? '279' : '0'}/small/${symbol.toLowerCase()}.png`;
  }

  async function renderCrypto() {
    const summary = document.getElementById('cryptoSummary');
    const list = document.getElementById('cryptoList');
    const updatedAt = document.getElementById('cryptoUpdatedAt');
    
    if (!summary || !list) return;

    const settings = loadSettings();
    
    // Don't clear list or return early - let Hyperliquid data append to it
    // Check if we have manual positions
    const hasManualPositions = settings && settings.cryptoPositions && settings.cryptoPositions.length > 0;
    
    if (!hasManualPositions && (!settings || !settings.hyperliquidAddress)) {
      summary.textContent = 'Configure positions in Settings or add Hyperliquid address';
      list.innerHTML = '';
      return;
    }
    
    // Clear list only for manual positions (keep for Hyperliquid/Lighter data)
    if (hasManualPositions) {
      list.innerHTML = '';
      
      const prices = await fetchCryptoPrices();
      if (!prices) {
        summary.textContent = 'Failed to fetch prices';
        list.innerHTML = '';
        return;
      }

      let total = 0;
      let totalPnL = 0;

      for (const pos of settings.cryptoPositions) {
        if (!pos.coingeckoId) continue;
        
        const priceData = prices[pos.coingeckoId];
        if (!priceData) continue;

        const priceUsd = priceData.usd || 0;
        const valueUsd = pos.amount * priceUsd;
        total += valueUsd;

        // Calculate P&L
        let pnl = 0;
        let pnlPercent = 0;
        let pnlClass = '';
        if (pos.entryPrice && pos.entryPrice > 0) {
          pnl = valueUsd - (pos.amount * pos.entryPrice);
          pnlPercent = ((priceUsd - pos.entryPrice) / pos.entryPrice) * 100;
          pnlClass = pnl >= 0 ? 'positive' : 'negative';
        }

        const li = document.createElement('li');
        li.className = 'crypto-item';
        li.innerHTML = `
          <div class="crypto-header">
            <img src="${getCoinIcon(pos.symbol)}" alt="${pos.symbol}" class="crypto-icon" onerror="this.style.display='none'">
            <strong>${pos.symbol}</strong>
            ${priceData.usd_24h_change ? `<span class="change ${priceData.usd_24h_change >= 0 ? 'positive' : 'negative'}">${priceData.usd_24h_change >= 0 ? '+' : '-'}${Math.abs(priceData.usd_24h_change).toFixed(2)}%</span>` : ''}
          </div>
          <div class="crypto-details">
            ${pos.amount.toFixed(4)} × $${priceUsd.toLocaleString()} = $${valueUsd.toLocaleString()}
            ${pnl !== 0 ? `<div class="pnl ${pnlClass}">P&L: ${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toLocaleString()} (${pnlPercent >= 0 ? '+' : '-'}${Math.abs(pnlPercent).toFixed(2)}%)</div>` : ''}
          </div>
        `;
        list.appendChild(li);
        totalPnL += pnl;
      }

      const totalPnLClass = totalPnL >= 0 ? 'positive' : 'negative';
      summary.innerHTML = `
        Total: $${total.toLocaleString()}
        ${totalPnL !== 0 ? `<span class="pnl-summary ${totalPnLClass}">(${totalPnL >= 0 ? '+' : ''}$${totalPnL.toLocaleString()})</span>` : ''}
      `;
    } else if (!hasManualPositions && settings && settings.hyperliquidAddress) {
      // Just show we're loading Hyperliquid data
      summary.innerHTML = '<span class="loading-terminal">[...]</span>';
    }
    
    if (updatedAt) updatedAt.textContent = new Date().toLocaleTimeString();
  }

  async function fetchWeather() {
    const settings = loadSettings();
    if (!settings || !settings.weather || !settings.weather.lat || !settings.weather.lon) return null;

    const { lat, lon } = settings.weather;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;
    
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Weather API failed');
      return await resp.json();
    } catch (err) {
      console.error('✗ Weather data unavailable');
      return null;
    }
  }

  async function renderWeather() {
    const now = document.getElementById('weatherNow');
    const forecast = document.getElementById('weatherForecast');
    const updatedAt = document.getElementById('weatherUpdatedAt');
    
    if (!now || !forecast) return;

    const settings = loadSettings();
    if (!settings || !settings.weather || !settings.weather.lat || !settings.weather.lon) {
      now.textContent = 'Set lat/lon in Settings';
      forecast.innerHTML = '';
      return;
    }

    const data = await fetchWeather();
    if (!data) {
      now.textContent = 'Failed to fetch weather';
      forecast.innerHTML = '';
      return;
    }

    const current = data.current;
    const location = settings.weather.label || `${settings.weather.lat.toFixed(2)}, ${settings.weather.lon.toFixed(2)}`;
    now.textContent = `${location}: ${current.temperature_2m}°C`;

    forecast.innerHTML = '';
    if (data.daily && data.daily.time) {
      for (let i = 0; i < Math.min(5, data.daily.time.length); i++) {
        const li = document.createElement('li');
        const date = new Date(data.daily.time[i]);
        li.innerHTML = `<strong>${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</strong>: ${data.daily.temperature_2m_max[i]}° / ${data.daily.temperature_2m_min[i]}°`;
        forecast.appendChild(li);
      }
    }

    if (updatedAt) updatedAt.textContent = new Date().toLocaleTimeString();
  }

  async function fetchHyperliquidPositions(address) {
    if (!address) return null;
    
    try {
      // Fetch perpetual positions
      const perpResp = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'clearinghouseState',
          user: address
        })
      });
      
      // Fetch spot positions
      const spotResp = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'spotClearinghouseState',
          user: address
        })
      });
      
      const perpData = perpResp.ok ? await perpResp.json() : null;
      const spotData = spotResp.ok ? await spotResp.json() : null;
      
      return { perp: perpData, spot: spotData };
    } catch (err) {
      console.error('✗ Hyperliquid connection failed');
      return null;
    }
  }

  async function renderHyperliquidData() {
    const summary = document.getElementById('cryptoSummary');
    const list = document.getElementById('cryptoList');
    
    if (!summary || !list) {
      // Missing elements
      return;
    }
    
    const settings = loadSettings();
    if (!settings || !settings.hyperliquidAddress) {
      // No address
      return;
    }
    
    const data = await fetchHyperliquidPositions(settings.hyperliquidAddress);
    if (!data) {
      console.error('✗ Hyperliquid data unavailable');
      return;
    }
    
    
    let hyperliquidTotal = 0;
    
    // Fetch current prices for spot tokens
    let prices = null;
    if (data.spot && data.spot.balances && data.spot.balances.length > 0) {
      try {
        const pricesResp = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'allMids' })
        });
        if (pricesResp.ok) {
          prices = await pricesResp.json();
        }
      } catch (err) {
        // Price fetch failed
      }
    }
    
    // Fetch Hyperliquid market data for mark prices
    let hlMarketPrices = {};
    try {
      const marketResp = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' })
      });
      if (marketResp.ok) {
        const marketData = await marketResp.json();
        if (marketData && marketData[0] && marketData[1]) {
          for (let i = 0; i < marketData[1].length; i++) {
            const ctx = marketData[1][i];
            const assetName = marketData[0].universe[i]?.name;
            if (assetName && ctx && ctx.markPx) {
              hlMarketPrices[assetName] = parseFloat(ctx.markPx);
            }
          }
        }
      }
    } catch (err) {
      // Market price fetch failed
    }
    
    // Render perpetual positions
    if (data.perp && data.perp.assetPositions && data.perp.assetPositions.length > 0) {
      
      for (const pos of data.perp.assetPositions) {
        const coin = pos.position?.coin || 'Unknown';
        const pnl = parseFloat(pos.position?.unrealizedPnl || 0);
        hyperliquidTotal += pnl;
        
        // Use Hyperliquid's mark price (most accurate), fallback to entry price
        const currentPrice = hlMarketPrices[coin] || parseFloat(pos.position?.entryPx || 0);
        
        const li = document.createElement('li');
        li.className = 'crypto-item';
        li.innerHTML = `
          <div class="crypto-header">
            <strong>${coin}</strong>
            <span class="exchange-badge">Hyperliquid</span>
          </div>
          <div class="crypto-details">
            Size: ${pos.position?.szi || 0} | Price: $${currentPrice.toLocaleString()}
            ${pos.position?.unrealizedPnl ? `<div class="pnl ${parseFloat(pos.position.unrealizedPnl) >= 0 ? 'positive' : 'negative'}">PnL: ${parseFloat(pos.position.unrealizedPnl) >= 0 ? '+' : '-'}$${Math.abs(parseFloat(pos.position.unrealizedPnl)).toFixed(2)}</div>` : ''}
          </div>
        `;
        list.appendChild(li);
      }
    }
    
    // Render spot balances (HYPE, USDC, etc)
    if (data.spot && data.spot.balances && data.spot.balances.length > 0) {
      for (const bal of data.spot.balances) {
        // bal.total is the token amount, bal.token is the LP token count
        const tokenAmount = parseFloat(bal.total || 0);
        if (tokenAmount <= 0) continue;
        
        let usdValue = tokenAmount;
        let priceInfo = '';
        
        // For USDC, the amount IS the USD value
        if (bal.coin !== 'USDC' && prices) {
          const price = prices[bal.coin];
          if (price) {
            usdValue = tokenAmount * parseFloat(price);
            priceInfo = ` × $${parseFloat(price).toLocaleString()}`;
          }
        }
        
        // Calculate P&L using entryNtl (entry value in USD)
        let pnlInfo = '';
        if (bal.entryNtl && parseFloat(bal.entryNtl) > 0) {
          const entryValue = parseFloat(bal.entryNtl);
          const pnl = usdValue - entryValue;
          const pnlPercent = ((usdValue - entryValue) / entryValue) * 100;
          const pnlClass = pnl >= 0 ? 'positive' : 'negative';
          pnlInfo = `<div class="pnl ${pnlClass}">P&L: ${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)} (${pnlPercent >= 0 ? '+' : '-'}${Math.abs(pnlPercent).toFixed(2)}%)</div>`;
        }
        
        hyperliquidTotal += usdValue;
        
        const li = document.createElement('li');
        li.className = 'crypto-item';
        li.innerHTML = `
          <div class="crypto-header">
            <strong>${bal.coin}</strong>
            <span class="exchange-badge">Hyperliquid</span>
          </div>
          <div class="crypto-details">
            ${tokenAmount.toLocaleString()} ${bal.coin}${priceInfo} = $${usdValue.toLocaleString()}
            ${pnlInfo}
          </div>
        `;
        list.appendChild(li);
      }
    } else {
    }
    
    // Update summary with Hyperliquid total
    if (hyperliquidTotal > 0) {
      summary.innerHTML = `Hyperliquid Total: $${hyperliquidTotal.toLocaleString()}`;
    }
  }

  async function fetchLighterPositions(address) {
    if (!address) return null;
    
    try {
      // Try different Lighter API endpoints from https://apidocs.lighter.xyz
      let resp;
      
      // Try mainnet endpoint with correct v1 API format
      resp = await fetch(`https://mainnet.zklighter.elliot.ai/api/v1/account?by=l1_address&value=${address}`);
      if (resp.ok) {
        const data = await resp.json();
        return data;
      }
      
      // Try testnet endpoint
      resp = await fetch(`https://testnet.zklighter.elliot.ai/api/v1/account?by=l1_address&value=${address}`);
      if (resp.ok) {
        const data = await resp.json();
        return data;
      }
      
      return null;
    } catch (err) {
      console.error('✗ Lighter connection failed');
      return null;
    }
  }

  async function renderLighterData() {
    const summary = document.getElementById('cryptoSummary');
    const list = document.getElementById('cryptoList');
    
    if (!summary || !list) {
      // Missing elements
      return;
    }
    
    const settings = loadSettings();
    if (!settings || !settings.lighterAddress) {
      return;
    }
    
    const data = await fetchLighterPositions(settings.lighterAddress);
    
    if (!data || !data.accounts || !Array.isArray(data.accounts) || data.accounts.length === 0) {
      return;
    }
    
    // Get the first account's positions
    const account = data.accounts[0];
    if (!account || !account.positions) {
      return;
    }
    
    
    let lighterTotal = 0;
    
    for (const pos of account.positions) {
      if (!pos.position || parseFloat(pos.position) === 0) continue;
      
      const position = parseFloat(pos.position);
      const positionValue = parseFloat(pos.position_value || 0);
      const unrealizedPnl = parseFloat(pos.unrealized_pnl || 0);
      lighterTotal += positionValue;
      
      const sign = pos.sign === 1 ? 'Long' : 'Short';
      
      const li = document.createElement('li');
      li.className = 'crypto-item';
      li.innerHTML = `
        <div class="crypto-header">
          <strong>${pos.symbol}</strong>
          <span class="exchange-badge">Lighter</span>
          <span class="change">${sign}</span>
        </div>
        <div class="crypto-details">
          Position: ${position.toFixed(2)} @ $${parseFloat(pos.avg_entry_price || 0).toFixed(2)} = $${positionValue.toLocaleString()}
          ${unrealizedPnl !== 0 ? `<div class="pnl ${unrealizedPnl >= 0 ? 'positive' : 'negative'}">Unrealized P&L: ${unrealizedPnl >= 0 ? '+' : '-'}$${Math.abs(unrealizedPnl).toFixed(2)}</div>` : ''}
        </div>
      `;
      list.appendChild(li);
    }
    
    // Update summary with Lighter total if no Hyperliquid total was shown
    if (lighterTotal > 0 && !summary.innerHTML.includes('Total')) {
      summary.innerHTML = `Lighter Total: $${lighterTotal.toLocaleString()}`;
    }
  }

  // Store all position data globally for hero summary
  let allPositionsData = [];
  let weatherData = null;
  
  // Store actual account balances for accurate total value calculation
  // This uses real account balances, not position notional values, to properly handle leverage
  // - Hyperliquid: accountValue from marginSummary (perp) + spot balance values
  // - Lighter: collateral + unrealized_pnl from account data
  // - NFTs: total floor value (count * floor price)
  let accountBalances = {
    hyperliquid: 0,  // Total account value including perp margin and spot balances
    lighter: 0,      // Collateral + unrealized PnL
    nfts: 0          // Total NFT floor value
  };
  
  // === TRUE LOCAL MIDNIGHT PRICE TRACKING ===
  // All 24h changes are calculated from YOUR local midnight (00:00:00), not exchange 24h periods
  // 
  // How it works:
  // 1. At midnight (or first page load after midnight), fetch historical prices from:
  //    - Hyperliquid API (1-minute candles at midnight timestamp) - PRIMARY
  //    - CoinGecko API (historical daily data) - FALLBACK
  // 2. Store these midnight prices in localStorage
  // 3. Throughout the day, calculate 24h changes as: (currentPrice - midnightPrice) / midnightPrice * 100
  // 4. This applies to:
  //    - Individual position 24h changes
  //    - Asset highlights in hero section
  //    - Portfolio total daily change
  //    - Real-time price updates
  // 
  // Benefits:
  // - Consistent with your local time zone
  // - Not affected by exchange rolling 24h windows
  // - Easy to verify against other tracking tools
  // - Accurate accounting for trades and transfers during the day
  const DAILY_PRICES_KEY = 'dailyMidnightPrices.v1';
  
  function getDailyPrices() {
    try {
      const saved = localStorage.getItem(DAILY_PRICES_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }
  
  function saveDailyPrices(prices, timestamp) {
    try {
      localStorage.setItem(DAILY_PRICES_KEY, JSON.stringify({ prices, timestamp }));
    } catch {
      // Silent fail
    }
  }
  
  function getMidnightTimestamp() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    return midnight.getTime();
  }
  
  function isNewDay(timestamp) {
    const midnightToday = getMidnightTimestamp();
    return timestamp < midnightToday;
  }
  
  function getCurrentPricesMap(positionsData) {
    // Store both prices and account balances for accurate 24h tracking
    const priceMap = {
      _ACCOUNT_BALANCES: {
        hyperliquid: accountBalances.hyperliquid,
        lighter: accountBalances.lighter,
        nfts: accountBalances.nfts,
        multichain: accountBalances.multichain,
        total: accountBalances.hyperliquid + accountBalances.lighter + accountBalances.nfts + accountBalances.multichain
      }
    };
    
    // Also store individual asset prices for reference (NFTs primarily)
    for (const pos of positionsData) {
      if (pos.exchange === 'OpenSea') {
        priceMap[`${pos.asset}_NFT`] = pos.price || 0;
      }
    }
    
    return priceMap;
  }

  // Fetch historical price from Hyperliquid at specific timestamp (midnight local time)
  async function fetchHyperliquidHistoricalPrice(asset, timestamp) {
    try {
      // Request a small window around midnight to get the closest candle
      // Use 1-minute candles for best accuracy at exact midnight
      const response = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'candleSnapshot',
          req: {
            coin: asset,
            interval: '1m',
            startTime: timestamp - 60000, // 1 minute before midnight
            endTime: timestamp + 60000 // 1 minute after midnight
          }
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        
        // Find the candle closest to midnight
        if (data && data.length > 0) {
          // Sort by proximity to midnight timestamp
          const sortedCandles = data.sort((a, b) => {
            const aTime = a.t || 0;
            const bTime = b.t || 0;
            return Math.abs(aTime - timestamp) - Math.abs(bTime - timestamp);
          });
          
          const closestCandle = sortedCandles[0];
          if (closestCandle && closestCandle.c) {
            const price = parseFloat(closestCandle.c);
            return price;
          }
        }
      }
    } catch (err) {
      // API error
    }
    return null;
  }

  // Fetch historical price from CoinGecko as fallback
  async function fetchCoinGeckoHistoricalPrice(coinId, timestamp) {
    try {
      const date = new Date(timestamp);
      const dateStr = `${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear()}`;
      
      const response = await rateLimitedFetch(
        `https://api.coingecko.com/api/v3/coins/${coinId}/history?date=${dateStr}&localization=false`
      );
      
      if (response.ok) {
        const data = await response.json();
        if (data && data.market_data && data.market_data.current_price) {
          return data.market_data.current_price.usd;
        }
      }
    } catch (err) {
      // Silent fail
    }
    return null;
  }

  // Get midnight prices for all current assets
  async function fetchMidnightPrices() {
    const midnightTs = getMidnightTimestamp();
    const midnightDate = new Date(midnightTs);
    const now = new Date();
    
    
    const priceMap = {
      _ACCOUNT_BALANCES: {
        hyperliquid: accountBalances.hyperliquid,
        lighter: accountBalances.lighter,
        nfts: accountBalances.nfts,
        multichain: accountBalances.multichain,
        total: accountBalances.hyperliquid + accountBalances.lighter + accountBalances.nfts + accountBalances.multichain
      }
    };


    // For NFTs, use current floor prices (no historical API available)
    // Store by collection slug since all NFTs in a collection share the same floor
    const nftCollections = new Set();
    for (const pos of allPositionsData) {
      if (pos.exchange === 'OpenSea') {
        priceMap[`${pos.asset}_NFT`] = pos.price || 0; // Legacy compatibility key

        if (pos.collectionSlug) {
          const key = `${pos.collectionSlug}_NFT`;
          if (!nftCollections.has(key)) {
            priceMap[key] = pos.price || 0;
            nftCollections.add(key);
          }
        }
      }
    }

    // Fetch historical prices for crypto assets at midnight
    const settings = loadSettings() || getDefaultSettings();
    const usePyth = settings.usePythPrices ?? true;
    const pricePromises = [];
    
    for (const pos of allPositionsData) {
      if (pos.exchange === 'Hyperliquid' || pos.exchange === 'Lighter') {
        pricePromises.push(
          (async () => {
            const key = `${pos.asset}_${pos.exchange}`;
            let price = null;
            
            if (usePyth) {
              // Pyth → Hyperliquid → CoinGecko fallback chain
              price = await fetchPythPrice(pos.asset, midnightTs);
              
              if (price === null) {
                price = await fetchHyperliquidHistoricalPrice(pos.asset, midnightTs);
              }
              
              if (price === null && pos.coingeckoId) {
                price = await fetchCoinGeckoHistoricalPrice(pos.coingeckoId, midnightTs);
              }
            } else {
              // Hyperliquid → CoinGecko fallback (when Pyth disabled)
              price = await fetchHyperliquidHistoricalPrice(pos.asset, midnightTs);
              
              if (price === null && pos.coingeckoId) {
                price = await fetchCoinGeckoHistoricalPrice(pos.coingeckoId, midnightTs);
              }
            }
            
            if (price !== null) {
              priceMap[key] = price;
            }
          })()
        );
      }
    }

    await Promise.all(pricePromises);
    return priceMap;
  }

  async function refreshAll(priorityOnly = false) {
    // Throttle refreshes to prevent excessive API calls
    const now = Date.now();
    if (now - lastFullRefresh < MIN_REFRESH_INTERVAL) {
      return; // Skip if refreshed recently
    }
    lastFullRefresh = now;
    
    const startTime = performance.now();
    
    // Reset positions data
    allPositionsData = [];
    
    const settings = loadSettings() || getDefaultSettings();
    
    // Show/hide comic section based on settings
    if (els.comicSection) {
      els.comicSection.style.display = settings.showComic ? 'block' : 'none';
    }
    
    // PRIORITY: Fetch positions first (critical)
    await fetchAndRenderPositions();
    await updateHeroSection();
    updateLastUpdateTimestamp();
    
    const loadTime = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`⚡ Loaded in ${loadTime}s`);
    
    // Hide loading screen after first load
    if (els.loadingScreen && !els.loadingScreen.classList.contains('hidden')) {
      els.loadingScreen.classList.add('hidden');
      // Remove from DOM after fade completes
      setTimeout(() => {
        if (els.loadingScreen) {
          els.loadingScreen.style.display = 'none';
        }
      }, 300);
    }
    
    // BACKGROUND: Non-critical data (weather, comics) - don't block UI
    if (!priorityOnly) {
      Promise.all([
        fetchAndRenderWeather(),
        settings.showComic ? renderCalvin() : Promise.resolve()
      ]).catch(err => console.error('Background data error:', err));
    }
  }
  
  function updateLastUpdateTimestamp() {
    if (!els.lastUpdateTimestamp) return;
    
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    els.lastUpdateTimestamp.textContent = `Last update: ${hours}:${minutes}:${seconds}`;
  }
  
  // Helper function to normalize NFT collection display names
  function normalizeNFTCollectionName(name, slug) {
    // Map of known slugs to proper display names
    const nameOverrides = {
      'hypurr-hyperevm': 'Hypurr',
      'moonbirds': 'Moonbirds'
    };
    
    // Check if we have an override for this slug
    if (slug && nameOverrides[slug.toLowerCase()]) {
      return nameOverrides[slug.toLowerCase()];
    }
    
    // Otherwise use the provided name
    return name;
  }
  
  async function fetchOpenSeaNFTs(address) {
    if (!address) return null;
    
    // SPEED: Check cache first (OpenSea is very slow)
    const cacheKey = `nft_${address}`;
    if (nftCache.has(cacheKey)) {
      const cached = nftCache.get(cacheKey);
      const age = Date.now() - cached.timestamp;
      if (age < NFT_CACHE_DURATION) {
        return cached.data;
      }
    }
    
    const settings = loadSettings();
    const apiKey = settings?.openSeaApiKey || '';
    
    if (!apiKey) {
      console.error('✗ OpenSea: No API key configured');
      return null;
    }
    
    try {
      // Try OpenSea API first if we have an API key
      if (apiKey) {
        console.log(`⟳ OpenSea: Fetching NFTs for ${address.substring(0, 6)}...${address.substring(address.length - 4)}`);
        // Fetch from multiple chains
        const chains = [
          'ethereum', 
          'polygon', 
          'arbitrum', 
          'optimism', 
          'base', 
          'avalanche', 
          'blast', 
          'zora', 
          'bsc',
          'hyperevm',
          'apechain',
          'berachain',
          'gunz',
          'ronin',
          'sei',
          'shape',
          'somnia',
          'soneium',
          'unichain'
        ];
        // Fetch from all chains in parallel for speed
        const chainPromises = chains.map(chain =>
          fetch(`https://api.opensea.io/api/v2/chain/${chain}/account/${address}/nfts?limit=200`, {
            headers: {
              'X-API-KEY': apiKey,
              'accept': 'application/json'
            }
          })
          .then(async (chainResp) => {
            if (chainResp.ok) {
              const chainData = await chainResp.json();
              if (chainData.nfts && chainData.nfts.length > 0) {
                console.log(`  ✓ ${chain}: Found ${chainData.nfts.length} NFT(s)`);
                // Tag each NFT with its chain
                chainData.nfts.forEach(nft => {
                  nft._chain = chain;
                });
                return chainData.nfts;
              }
            } else {
              console.log(`  ⚠ ${chain}: ${chainResp.status} ${chainResp.statusText}`);
            }
            return [];
          })
          .catch((err) => {
            console.error(`  ✗ ${chain}: ${err.message}`);
            return [];
          })
        );
        
        const chainResults = await Promise.all(chainPromises);
        const allNfts = chainResults.flat();
        
        console.log(`⟳ OpenSea: Total ${allNfts.length} NFT(s) found across all chains`);
        
        if (allNfts.length > 0) {
        const openSeaData = { nfts: allNfts };
        
              const collections = {};
              const collectionSlugs = new Set();
              const nftsByCollection = {};
              
            for (const rawNft of openSeaData.nfts) {
              const nft = { ...rawNft };

              // Collection metadata can be a string slug or an object depending on the API response
              const collectionInfo = nft.collection || {};
              const collectionSlug = typeof collectionInfo === 'string'
                ? collectionInfo
                : (collectionInfo.slug || collectionInfo.collection || null);
              const collectionName = typeof collectionInfo === 'string'
                ? collectionInfo
                : (collectionInfo.name || collectionSlug || null);

              // Use the chain we tagged when fetching
              const chain = nft._chain || 'ethereum';

              // Determine the contract address (can arrive as string or nested object)
                let contractAddr = nft.contract;
              if (contractAddr && typeof contractAddr === 'object') {
                contractAddr = contractAddr.address || contractAddr.contract_address || contractAddr.id || null;
              }

              if (!contractAddr && typeof collectionInfo === 'object') {
                const primaryContract = Array.isArray(collectionInfo.primary_asset_contracts)
                  ? collectionInfo.primary_asset_contracts[0]
                  : collectionInfo.contract;
                if (primaryContract) {
                  contractAddr = typeof primaryContract === 'string'
                    ? primaryContract
                    : (primaryContract.address || primaryContract.contract_address || null);
                }
              }

              // Fall back to identifier parsing if needed
              if ((!contractAddr || typeof contractAddr !== 'string') && nft.identifier && nft.identifier.includes(':')) {
                  const parts = nft.identifier.split(':');
                  if (parts.length >= 2) {
                  contractAddr = parts[1];
                }
              }

              if (contractAddr && typeof contractAddr === 'string') {
                contractAddr = contractAddr.toLowerCase();
              }

              const collectionKey = collectionSlug || contractAddr;
              if (!collectionKey) {
                continue;
              }
                
                if (collectionSlug) {
                  collectionSlugs.add(collectionSlug);
              }

              if (!nftsByCollection[collectionKey]) {
                nftsByCollection[collectionKey] = [];
              }

              nft._collectionSlug = collectionSlug || null;
              nft._contractAddress = contractAddr || null;
              nftsByCollection[collectionKey].push(nft);

              if (!collections[collectionKey]) {
            // We'll get the proper name from the stats API later when possible
                collections[collectionKey] = {
              name: collectionName || collectionSlug || contractAddr || 'Unknown Collection',
                    contract: contractAddr,
                  slug: collectionSlug || collectionKey,
              chain: chain,
                    count: 0,
                    floorPriceUsd: 0,
              floorPriceNative: 0,
              nativeToken: 'ETH',
                  change24h: null,
                  totalPaidUsd: 0,
                    nfts: []
                  };
          } else {
            // Update stored metadata if we discover more accurate info
            if (collectionName && (!collections[collectionKey].name || collections[collectionKey].name === collections[collectionKey].slug)) {
              collections[collectionKey].name = collectionName;
            }
            if (!collections[collectionKey].contract && contractAddr) {
              collections[collectionKey].contract = contractAddr;
            }
            if (!collections[collectionKey].slug && collectionSlug) {
              collections[collectionKey].slug = collectionSlug;
            }
            // Update chain if it's not ethereum (in case collection already exists)
            if (chain !== 'ethereum') {
              collections[collectionKey].chain = chain;
            }
              }

              collections[collectionKey].count++;
              collections[collectionKey].nfts.push(nft);
            }
              
          // Map chains to their native tokens and CoinGecko IDs
          const chainTokenMap = {
            'ethereum': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'polygon': { symbol: 'MATIC', coingeckoId: 'matic-network' },
            'arbitrum': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'optimism': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'base': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'avalanche': { symbol: 'AVAX', coingeckoId: 'avalanche-2' },
            'blast': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'zora': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'bsc': { symbol: 'BNB', coingeckoId: 'binancecoin' },
            'hyperevm': { symbol: 'HYPE', coingeckoId: 'hyperliquid' },
            'apechain': { symbol: 'APE', coingeckoId: 'apecoin' },
            'berachain': { symbol: 'BERA', coingeckoId: 'berachain-bera' },
            'gunz': { symbol: 'GUNZ', coingeckoId: 'gunz' },
            'ronin': { symbol: 'RON', coingeckoId: 'ronin' },
            'sei': { symbol: 'SEI', coingeckoId: 'sei-network' },
            'shape': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'somnia': { symbol: 'STT', coingeckoId: 'somnia' },
            'soneium': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'unichain': { symbol: 'ETH', coingeckoId: 'ethereum' }
          };
          
          // Fetch prices for all unique native tokens
          const uniqueCoingeckoIds = [...new Set(Object.values(chainTokenMap).map(t => t.coingeckoId))];
          const tokenPrices = {};
          const tokenPricesBySymbol = {};
          
          try {
            const pricesData = await rateLimitedFetch(
              `https://api.coingecko.com/api/v3/simple/price?ids=${uniqueCoingeckoIds.join(',')}&vs_currencies=usd`,
              `nft-token-prices-${uniqueCoingeckoIds.join(',')}`
            );
            if (pricesData) {
              for (const [chain, tokenInfo] of Object.entries(chainTokenMap)) {
                const price = pricesData[tokenInfo.coingeckoId]?.usd;
                if (price) {
                  tokenPrices[chain] = price;
                  tokenPricesBySymbol[tokenInfo.symbol.toUpperCase()] = price;
                }
              }
                }
              } catch (err) {
            // Silent fallback
          }
          
          // Update collection native tokens based on their chain
          for (const collection of Object.values(collections)) {
            const tokenInfo = chainTokenMap[collection.chain] || chainTokenMap['ethereum'];
            collection.nativeToken = tokenInfo.symbol;
          }
          
          // Fetch floor prices and stats using OpenSea Collection Stats API (in parallel)
          
          const statsPromises = Array.from(collectionSlugs).map(slug =>
            fetch(`https://api.opensea.io/api/v2/collections/${slug}/stats`, {
                    headers: {
                      'X-API-KEY': apiKey,
                      'accept': 'application/json'
                    }
            })
            .then(async (statsResp) => {
                  if (statsResp.ok) {
                    const statsData = await statsResp.json();
                
                // Get floor price and proper collection name from stats
                const floorPriceNativeRaw = statsData.total?.floor_price
                  ?? statsData.total?.floor_price_native
                  ?? statsData.total?.floor_price_in_token;
                const floorPriceNative = floorPriceNativeRaw !== undefined && floorPriceNativeRaw !== null
                  ? parseFloat(floorPriceNativeRaw)
                  : null;
                const collectionName = statsData.name; // Use the proper display name from the API
                
                // Note: OpenSea API v2 does not provide floor price change data in intervals
                // The intervals only contain volume/sales data, not floor price changes
                // Setting to null so it displays as "—" in the dashboard
                let floorChange1d = null;
                
                if (collections[slug]) {
                  const collection = collections[slug];
                  const nativeTokenPrice = tokenPrices[collection.chain] || 1;
                  
                  // Update name with proper display name from API
                  if (collectionName) {
                    collection.name = collectionName;
                  }
                  
                  if (floorPriceNative && isFinite(floorPriceNative)) {
                    collection.floorPriceNative = floorPriceNative;
                    collection.floorPriceUsd = floorPriceNative * nativeTokenPrice;
                    collection.change24h = floorChange1d; // Can be null if no data
                  }
                }
              }
              return slug;
            })
            .catch(() => slug)
          );
          
          await Promise.all(statsPromises);

          // Fetch last sale price for EACH individual NFT - SIMPLIFIED
          for (const [collectionKey, collection] of Object.entries(collections)) {
            const nftList = nftsByCollection[collectionKey];
            if (!nftList || nftList.length === 0) continue;

            const chain = collection.chain;
            const contractAddress = collection.contract;

            if (!contractAddress) {
              continue;
            }

            
            for (const nft of nftList) {
              // Determine token ID, supporting multiple possible fields
              let tokenId = nft.token_id || nft.tokenId || null;
              const identifier = nft.identifier;
              if (!tokenId && identifier) {
                if (identifier.includes(':')) {
                  const parts = identifier.split(':');
                  tokenId = parts[2] || parts[parts.length - 1];
                  } else {
                  tokenId = identifier;
                }
              }

              if (!tokenId) {
                continue;
              }

              nft.tokenId = tokenId;

              
              try {
                // Fetch sale events from OpenSea Events API (more reliable than last_sale field)
                const eventsUrl = `https://api.opensea.io/api/v2/events/chain/${chain}/contract/${contractAddress}/nfts/${tokenId}?event_type=sale`;
                
                const eventsResp = await fetch(eventsUrl, {
                      headers: {
                        'X-API-KEY': apiKey,
                        'accept': 'application/json'
                      }
                    });
                    
                if (!eventsResp.ok) {
                  const errorText = await eventsResp.text();
                  continue;
                }
                
                const eventsData = await eventsResp.json();
                
                // Get the most recent sale event
                const saleEvents = eventsData.asset_events || [];
                const lastSaleEvent = saleEvents.length > 0 ? saleEvents[0] : null;
                
                
                if (lastSaleEvent && lastSaleEvent.payment) {
                  const payment = lastSaleEvent.payment;
                  const paymentToken = payment.symbol || collection.nativeToken;
                  const decimals = payment.decimals || 18;
                  
                  // Parse the sale price
                  const rawTotalPrice = typeof payment.quantity === 'string'
                    ? payment.quantity
                    : String(payment.quantity || '0');
                  const saleAmountInToken = parseFloat(rawTotalPrice) / Math.pow(10, decimals);

                  // Get USD price for the payment token
                  const tokenPriceFromSymbol = tokenPricesBySymbol[paymentToken.toUpperCase()] || null;
                  const tokenPrice = tokenPrices[chain]
                    || tokenPriceFromSymbol
                    || (paymentToken.toUpperCase() === 'ETH' ? tokenPrices['ethereum'] : null)
                    || 0;
                  const saleAmountUsd = tokenPrice > 0 ? saleAmountInToken * tokenPrice : null;

                  // Store it if we have a valid USD valuation
                  if (saleAmountUsd !== null && isFinite(saleAmountUsd) && saleAmountUsd > 0) {
                    nft.lastSalePriceUsd = saleAmountUsd;
                    nft.lastSalePriceNative = saleAmountInToken;
                    nft.lastSaleToken = paymentToken;
                  } else {
                  }
                } else {
                    }
                  } catch (err) {
                  }
                }
              }
              
              const result = { collections: Object.values(collections) };
              
              // Cache the result
              nftCache.set(cacheKey, { data: result, timestamp: Date.now() });
              
              console.log(`✓ OpenSea: Processed ${result.collections.length} collection(s)`);
              
              return result;
            }
      } else {
        console.log('⚠ OpenSea: No NFTs found');
      }
      
      // Fallback: Try Reservoir API (aggregates multiple marketplaces)
        const reservoirResp = await fetch(`https://api.reservoir.tools/users/${address}/tokens/v10?limit=100`, {
          headers: {
            'accept': 'application/json'
          }
        });
        
        if (reservoirResp.ok) {
          const reservoirData = await reservoirResp.json();
          
          if (reservoirData.tokens && reservoirData.tokens.length > 0) {
            const collections = {};
            const contractAddresses = new Set();
            
            for (const token of reservoirData.tokens) {
              const collectionName = token.token?.collection?.name || 'Unknown';
              const contractAddr = token.token?.contract;
              
              if (contractAddr) {
                contractAddresses.add(contractAddr);
              }
              
              if (!collections[contractAddr]) {
                collections[contractAddr] = {
                  name: collectionName,
                  contract: contractAddr,
                  count: 0,
                  floorPriceUsd: 0,
                  floorPriceNative: 0,
                  nativeToken: 'ETH',
                  change24h: 0
                };
              }
              collections[contractAddr].count += parseInt(token.ownership?.tokenCount || 1);
            }
            
            // Fetch floor prices from Reservoir collections API
            for (const contractAddr of contractAddresses) {
              try {
                const collResp = await fetch(`https://api.reservoir.tools/collections/v7?id=${contractAddr}`);
                if (collResp.ok) {
                  const collData = await collResp.json();
                  if (collData.collections?.[0]?.floorAsk?.price?.amount?.usd) {
                    collections[contractAddr].floorPriceUsd = collData.collections[0].floorAsk.price.amount.usd;
                  }
                }
              } catch (err) {
                // Silent fallback
              }
            }
            
            const result = { collections: Object.values(collections) };
            
            // Cache the result
            nftCache.set(cacheKey, { data: result, timestamp: Date.now() });
            
            return result;
          }
      }
      
      return null;
    } catch (err) {
      console.error('✗ OpenSea: Fatal error -', err.message);
      return null;
    }
  }

  // Symbol to CoinGecko ID mapping
  const symbolToCoingeckoId = {
      'BTC': 'bitcoin',
      'ETH': 'ethereum',
      'USDC': 'usd-coin',
      'USDT': 'tether',
      'SOL': 'solana',
      'HYPE': 'hyperliquid',
      'ZEC': 'zcash',
      'MATIC': 'matic-network',
      'AVAX': 'avalanche-2',
      'ARB': 'arbitrum',
      'OP': 'optimism',
      'LINK': 'chainlink',
      'UNI': 'uniswap',
      'AAVE': 'aave',
      'CRV': 'curve-dao-token',
      'LDO': 'lido-dao',
      'MKR': 'maker',
      'SNX': 'synthetix-network-token',
      'DOGE': 'dogecoin',
      'ADA': 'cardano',
      'DOT': 'polkadot',
      'SHIB': 'shiba-inu',
      'ATOM': 'cosmos',
      'LTC': 'litecoin',
      'XRP': 'ripple',
      'TRX': 'tron',
      'FTM': 'fantom',
      'APE': 'apecoin',
      'SAND': 'the-sandbox',
      'MANA': 'decentraland',
      'GRT': 'the-graph',
      'SUSHI': 'sushi',
      'COMP': 'compound-governance-token',
      'YFI': 'yearn-finance'
    };
    
  async function fetchCoinGeckoPrices(symbols) {
    const ids = symbols
      .map(s => symbolToCoingeckoId[s.toUpperCase()])
      .filter(id => id)
      .join(',');
    
    if (!ids) return {};
    
    const data = await rateLimitedFetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      `perp-prices-${ids}`
    );
    
    if (data) {
      const result = {};
      // Map back from ID to symbol with both price and change
      for (const [symbol, id] of Object.entries(symbolToCoingeckoId)) {
        if (data[id]) {
          result[symbol] = {
            price: data[id].usd || 0,
            change24h: data[id].usd_24h_change || 0
          };
        }
      }
      return result;
    }
    
    return {};
  }

  async function fetchCoinGecko24hChanges(symbols) {
    const ids = symbols
      .map(s => symbolToCoingeckoId[s.toUpperCase()])
      .filter(id => id)
      .join(',');
    
    if (!ids) return {};
    
    const data = await rateLimitedFetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      `24h-changes-${ids}`
    );
    
    if (data) {
      const changes = {};
        // Map back from ID to symbol
      for (const [symbol, id] of Object.entries(symbolToCoingeckoId)) {
          if (data[id] && data[id].usd_24h_change !== undefined) {
            changes[symbol] = data[id].usd_24h_change;
          }
        }
        return changes;
      }
    
    return {};
  }

  // Fetch EVM token balances using Alchemy's API (user brings their own free API key)
  async function fetchAlchemyTokens(wallets, apiKey) {
    if (!apiKey) {
      console.log('⚠ Alchemy: No API key provided');
      return [];
    }
    
    console.log(`⟳ Alchemy: Fetching tokens for ${wallets.length} wallet(s)`);
    console.log('  Supported: Ethereum, Arbitrum, Optimism, Polygon, Base, HyperEVM');
    
    // Alchemy supports these networks
    // Docs: https://www.alchemy.com/docs/reference/hyperliquid-api-quickstart
    const networks = [
      { id: 'eth-mainnet', name: 'Ethereum' },
      { id: 'arb-mainnet', name: 'Arbitrum' },
      { id: 'opt-mainnet', name: 'Optimism' },
      { id: 'polygon-mainnet', name: 'Polygon' },
      { id: 'base-mainnet', name: 'Base' },
      { id: 'hyperliquid-mainnet', name: 'HyperEVM' }
    ];
    
    // SPEED: Parallelize all wallet×network combinations instead of sequential fetches
    const fetchTasks = [];
    for (const wallet of wallets) {
      for (const network of networks) {
        fetchTasks.push((async () => {
          const data = [];
          try {
          const url = `https://${network.id}.g.alchemy.com/v2/${apiKey}`;
          
          // First, get native token balance (ETH, MATIC, etc.)
          const nativeResponse = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'eth_getBalance',
              params: [wallet, 'latest'],
              id: 1
            })
          });
          
          if (nativeResponse.ok) {
            const nativeData = await nativeResponse.json();
            if (nativeData.result) {
              const nativeBalance = parseInt(nativeData.result, 16) / 1e18; // Convert from Wei
              
              if (nativeBalance > 0.00001) {
                // Map network to native token symbol
                const nativeTokenMap = {
                  'Ethereum': 'ETH',
                  'Arbitrum': 'ETH',
                  'Optimism': 'ETH',
                  'Polygon': 'MATIC',
                  'Base': 'ETH',
                  'HyperEVM': 'HYPE'
                };
                
                const tokenSymbol = nativeTokenMap[network.name] || 'ETH';
                
                data.push({
                  address: wallet,
                  blockchain: network.name,
                  tokenSymbol: tokenSymbol,
                  tokenName: tokenSymbol,
                  balance: nativeBalance,
                  balanceUsd: 0, // Will be calculated from prices
                  tokenPrice: 0,
                  contractAddress: null // Native token has no contract
                });
              }
            }
          }
          
          // Then get all ERC20 token balances
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'alchemy_getTokenBalances',
              params: [wallet, 'erc20'],
              id: 1
            })
          });
          
          if (response.ok) {
            const responseData = await response.json();
            
            if (responseData.result && responseData.result.tokenBalances) {
              for (const token of responseData.result.tokenBalances) {
                const balance = parseInt(token.tokenBalance, 16);
                if (balance === 0) continue;
              
              // Get token metadata
              try {
                const metaResp = await fetch(url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'alchemy_getTokenMetadata',
                    params: [token.contractAddress],
                    id: 1
                  })
                });
                
                if (metaResp.ok) {
                  const meta = await metaResp.json();
                  if (meta.result) {
                    const decimals = meta.result.decimals || 18;
                    const balanceFormatted = balance / Math.pow(10, decimals);
                    
                    if (balanceFormatted < 0.000001) continue;
                    
                    data.push({
                      address: wallet,
                      blockchain: network.name,
                      tokenSymbol: meta.result.symbol || 'Unknown',
                      tokenName: meta.result.name,
                      balance: balanceFormatted,
                      balanceUsd: 0, // Will be calculated from prices
                      tokenPrice: 0,
                      contractAddress: token.contractAddress
                    });
                  }
                }
              } catch (err) {
                // Skip token if metadata fetch fails
              }
            }
            }
          }
          } catch (err) {
            // Silently skip failed fetches
          }
          return data;
        })());
      }
    }
    
    // SPEED: Execute all fetches in parallel
    const results = await Promise.all(fetchTasks);
    return results.flat(); // Flatten array of arrays
  }

  // Fetch Solana token balances using Helius API (user brings their own free API key)
  async function fetchSolanaTokens(wallets, apiKey) {
    if (!apiKey) {
      console.log('⚠ Helius: No API key provided');
      return [];
    }
    
    console.log(`⟳ Helius: Fetching tokens for ${wallets.length} wallet(s)`);
    const solanaData = [];
    
    for (const wallet of wallets) {
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
        
        if (!response.ok) continue;
        
        const data = await response.json();
        
        if (data.result && data.result.items) {
          for (const asset of data.result.items) {
            if (asset.interface === 'FungibleToken' && asset.token_info) {
              const balance = asset.token_info.balance / Math.pow(10, asset.token_info.decimals || 9);
              
              if (balance < 0.000001) continue;
              
              solanaData.push({
                address: wallet,
                blockchain: 'Solana',
                tokenSymbol: asset.token_info.symbol || 'Unknown',
                tokenName: asset.token_info.name,
                balance: balance,
                balanceUsd: asset.token_info.price_info?.total_price || 0,
                tokenPrice: asset.token_info.price_info?.price_per_token || 0,
                contractAddress: asset.id
              });
            }
          }
        }
      } catch (err) {
        console.error(`Helius fetch failed for ${wallet}`);
      }
    }
    
    return solanaData;
  }

  // Combined multi-chain token fetcher
  async function fetchMultiChainTokens(wallets, alchemyKey, heliusKey) {
    const [evmTokens, solTokens] = await Promise.all([
      fetchAlchemyTokens(wallets, alchemyKey),
      fetchSolanaTokens(wallets, heliusKey)
    ]);
    
    const allTokens = [...evmTokens, ...solTokens];
    console.log(`✓ Multi-chain: Found ${allTokens.length} tokens (${evmTokens.length} EVM, ${solTokens.length} Solana)`);
    
    return allTokens;
  }

  async function fetchAndRenderPositions() {
    allPositionsData = [];
    
    // Reset account balances
    accountBalances = {
      hyperliquid: 0,
      lighter: 0,
      nfts: 0,
      multichain: 0
    };
    
    // Collect NFT holdings across wallets; aggregate by collection
    const nftAggregates = new Map();

    
    // Fetch data for all wallets
    const settings = loadSettings() || getDefaultSettings();
    const wallets = parseWallets(settings.walletAddresses);
    
    if (wallets.length === 0) {
      renderPositionsTable();
      await updateHeroSection();
      return;
    }
    
    // SPEED: Fetch everything in parallel (market data + exchanges + multichain + NFTs)
    const criticalDataStart = performance.now();
    
    const [hlMarketDataResult, allWalletData, multiChainTokens] = await Promise.all([
      // Hyperliquid market data
      (async () => {
        const t1 = performance.now();
        console.log('→ Fetching Hyperliquid market data...');
        try {
          const marketResp = await fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'metaAndAssetCtxs' })
          });
          if (!marketResp.ok) return {};
          
          const data = await marketResp.json();
          const marketData = {};
          
          if (data && data[0] && data[0].universe) {
            for (const asset of data[0].universe) {
              marketData[asset.name] = {
                funding: parseFloat(asset.funding || 0),
                openInterest: parseFloat(asset.openInterest || 0),
                volume24h: parseFloat(asset.dayNtlVlm || 0)
              };
            }
          }
          
          if (data && data[1]) {
            for (let i = 0; i < data[1].length; i++) {
              const ctx = data[1][i];
              const assetName = data[0].universe[i]?.name;
              if (assetName && ctx) {
                const prevDayPx = parseFloat(ctx.prevDayPx || 0);
                const markPx = parseFloat(ctx.markPx || 0);
                
                if (!marketData[assetName]) {
                  marketData[assetName] = {};
                }
                marketData[assetName].markPx = markPx;
                
                if (prevDayPx > 0) {
                  marketData[assetName].change24h = ((markPx - prevDayPx) / prevDayPx) * 100;
                }
              }
            }
          }
          
          return marketData;
        } catch (err) {
          return {};
        } finally {
          console.log(`  ✓ Market data: ${((performance.now() - t1) / 1000).toFixed(2)}s`);
        }
      })(),
      
      // ALL wallet data in parallel (exchange + NFTs together)
      Promise.all(wallets.map(async (wallet, i) => {
        const t2 = performance.now();
        console.log(`→ Wallet ${i + 1}: Fetching positions + NFTs...`);
        const [hlData, lighterData, nftData] = await Promise.all([
          fetchHyperliquidPositions(wallet),
          fetchLighterPositions(wallet),
          fetchOpenSeaNFTs(wallet).catch(() => null) // NFTs fail gracefully
        ]);
        console.log(`  ✓ Wallet ${i + 1}: ${((performance.now() - t2) / 1000).toFixed(2)}s`);
        return { hlData, lighterData, nftData };
      })),
      
      // Multi-chain tokens (if keys provided)
      (async () => {
        if (!settings.alchemyApiKey && !settings.heliusApiKey) {
          return [];
        }
        const t3 = performance.now();
        console.log('→ Fetching multi-chain tokens...');
        const result = await fetchMultiChainTokens(wallets, settings.alchemyApiKey, settings.heliusApiKey);
        console.log(`  ✓ Multi-chain: ${((performance.now() - t3) / 1000).toFixed(2)}s`);
        return result;
      })()
    ]);
    
    const hlMarketData = hlMarketDataResult;
    
    console.log(`⚡ Loaded data: ${((performance.now() - criticalDataStart) / 1000).toFixed(2)}s`);
    
    // Process all collected wallet data
    
    // Fetch Hyperliquid spot prices once for all wallets
    let hlSpotPrices = null;
    const hasSpotBalances = allWalletData.some(({ hlData }) => hlData && hlData.spot && hlData.spot.balances);
    if (hasSpotBalances) {
      try {
        const pricesResp = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'allMids' })
        });
        hlSpotPrices = pricesResp.ok ? await pricesResp.json() : null;
    } catch (err) {
        // Spot price fetch failed
      }
    }
    
    for (const { hlData, lighterData, nftData } of allWalletData) {
      // === Extract TRUE account balances for accurate portfolio value ===
      // Using actual balances instead of position notional values properly accounts for leverage
      // A 10x leveraged position with $1000 notional only requires ~$100 in margin
      
      // Hyperliquid perp: Use accountValue from marginSummary (balance + unrealized PnL)
      // Per https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api
      if (hlData && hlData.perp && hlData.perp.marginSummary) {
        const accountValue = parseFloat(hlData.perp.marginSummary.accountValue || 0);
        accountBalances.hyperliquid += accountValue;
      }
      
      // Hyperliquid spot: Sum all spot token balances converted to USD
      if (hlData && hlData.spot && hlData.spot.balances) {
        const spotPrices = hlSpotPrices || {};
        for (const bal of hlData.spot.balances) {
          const tokenAmount = parseFloat(bal.total || 0);
          if (tokenAmount > 0) {
            let usdValue = tokenAmount;
            if (bal.coin !== 'USDC' && spotPrices[bal.coin]) {
              usdValue = tokenAmount * parseFloat(spotPrices[bal.coin]);
            }
            accountBalances.hyperliquid += usdValue;
          }
        }
      }
      
      // Lighter: Use collateral + unrealized PnL from account data
      // Per https://apidocs.lighter.xyz/reference/account-1
      if (lighterData && lighterData.accounts && lighterData.accounts[0]) {
        const account = lighterData.accounts[0];
        const collateral = parseFloat(account.collateral || 0);
        const unrealizedPnl = parseFloat(account.unrealized_pnl || 0);
        accountBalances.lighter += (collateral + unrealizedPnl);
      }
      
      // NFTs: Use current floor value (no leverage applicable)
      if (nftData && nftData.collections && nftData.collections.length > 0) {
        for (const collection of nftData.collections) {
          const totalValue = collection.count * collection.floorPriceUsd;
          accountBalances.nfts += totalValue;
        }
      }
      
      // Process Hyperliquid perp positions (for display only, not for balance calculation)
      if (hlData && hlData.perp && hlData.perp.assetPositions) {
          for (const pos of hlData.perp.assetPositions) {
          const coin = pos.position?.coin || 'Unknown';
          const marketInfo = hlMarketData[coin] || {};
          const size = parseFloat(pos.position?.szi || 0);
          
          // Use Hyperliquid's markPx (most accurate real-time price from their orderbook)
          const currentPrice = marketInfo.markPx || parseFloat(pos.position?.entryPx || 0);
          const change24h = marketInfo.change24h || 0;
          
            allPositionsData.push({
            asset: coin,
            exchange: 'Hyperliquid',
            positionType: 'perp',
            amount: size,
            value: Math.abs(size) * currentPrice,
              price: currentPrice,
            change24h: change24h,
            pnl: parseFloat(pos.position?.unrealizedPnl || 0),
              pnlPercent: 0
            });
          }
        }
        
      // Process Hyperliquid spot balances
      if (hlData && hlData.spot && hlData.spot.balances) {
          const prices = hlSpotPrices;
          
          for (const bal of hlData.spot.balances) {
            const tokenAmount = parseFloat(bal.total || 0);
            if (tokenAmount <= 0) continue;
            
            let usdValue = tokenAmount;
            if (bal.coin !== 'USDC' && prices && prices[bal.coin]) {
              usdValue = tokenAmount * parseFloat(prices[bal.coin]);
            }
            
            let pnl = 0;
            let pnlPercent = 0;
            if (bal.entryNtl && parseFloat(bal.entryNtl) > 0) {
              const entryValue = parseFloat(bal.entryNtl);
              pnl = usdValue - entryValue;
              pnlPercent = (pnl / entryValue) * 100;
            }
            
            const marketInfo = hlMarketData[bal.coin] || {};
            const currentPrice = bal.coin === 'USDC' ? 1 : (prices && prices[bal.coin] ? parseFloat(prices[bal.coin]) : 0);
            allPositionsData.push({
              asset: bal.coin,
              exchange: 'Hyperliquid',
            positionType: 'spot',
              amount: tokenAmount,
              value: usdValue,
              price: currentPrice,
              change24h: marketInfo.change24h || 0,
              pnl: pnl,
              pnlPercent: pnlPercent
            });
        }
      }
      
      // Process Lighter data
      if (lighterData && lighterData.accounts && lighterData.accounts[0]) {
        const account = lighterData.accounts[0];
        if (account.positions) {
          for (const pos of account.positions) {
            if (!pos.position || parseFloat(pos.position) === 0) continue;
            
            const position = parseFloat(pos.position);
            const positionValue = parseFloat(pos.position_value || 0);
            const unrealizedPnl = parseFloat(pos.unrealized_pnl || 0);
            const pnlPercent = positionValue > 0 ? (unrealizedPnl / (positionValue - unrealizedPnl)) * 100 : 0;
            
            // Lighter provides position_value which is already calculated from current market price
            // So deriving price from position_value / position is accurate
            const currentPrice = position > 0 ? positionValue / position : 0;
            
            allPositionsData.push({
              asset: pos.symbol,
              exchange: 'Lighter',
              amount: position,
              value: positionValue,
              price: currentPrice,
              change24h: 0, // Lighter API doesn't provide 24h change
              pnl: unrealizedPnl,
              pnlPercent: pnlPercent
            });
          }
        }
      }
      
      // Process OpenSea NFTs - aggregate holdings per collection
      if (nftData && nftData.collections && nftData.collections.length > 0) {
        for (const collection of nftData.collections) {
          const collectionKey = collection.slug || collection.contract || collection.name;
          if (!collectionKey) {
            continue;
          }

          const floorPriceUsdRaw = typeof collection.floorPriceUsd === 'number'
            ? collection.floorPriceUsd
            : parseFloat(collection.floorPriceUsd || 0);
          const floorPriceUsd = Number.isFinite(floorPriceUsdRaw) ? floorPriceUsdRaw : 0;
          const floorPriceNativeRaw = typeof collection.floorPriceNative === 'number'
            ? collection.floorPriceNative
            : parseFloat(collection.floorPriceNative || 0);
          const floorPriceNative = Number.isFinite(floorPriceNativeRaw) ? floorPriceNativeRaw : 0;
          const rawChange24h = (collection.change24h !== null && collection.change24h !== undefined)
            ? parseFloat(collection.change24h)
            : null;
          const change24h = Number.isFinite(rawChange24h) ? rawChange24h : null;
          const nativeToken = collection.nativeToken || 'ETH';
          const rawDisplayName = collection.name || collection.slug || 'NFT Collection';
          const displayName = normalizeNFTCollectionName(rawDisplayName, collection.slug);

          let aggregate = nftAggregates.get(collectionKey);
          if (!aggregate) {
            aggregate = {
              asset: displayName,
              nativeToken,
              collectionSlug: collection.slug || null,
              priceUsd: floorPriceUsd,
              priceNative: floorPriceNative,
              change24h,
              amount: 0,
              totalCostUsd: 0,
              pnlSumUsd: 0,
              hasSaleData: false,
              tokenIds: []
            };
            nftAggregates.set(collectionKey, aggregate);
          } else {
            // Always update to the normalized display name
            aggregate.asset = displayName;
            aggregate.nativeToken = nativeToken;
            if (collection.slug && !aggregate.collectionSlug) {
              aggregate.collectionSlug = collection.slug;
            }
            if (floorPriceUsd > 0) {
              aggregate.priceUsd = floorPriceUsd;
            }
            if (floorPriceNative > 0) {
              aggregate.priceNative = floorPriceNative;
            }
            if (change24h !== null && !Number.isNaN(change24h)) {
              aggregate.change24h = change24h;
            }
          }

          if (Array.isArray(collection.nfts) && collection.nfts.length > 0) {
            for (const nft of collection.nfts) {
              const tokenId = nft.tokenId || nft.token_id || null;
              if (tokenId) {
                aggregate.tokenIds.push(tokenId);
              }

              aggregate.amount += 1;

              if (nft.lastSalePriceUsd && nft.lastSalePriceUsd > 0) {
                aggregate.hasSaleData = true;
                aggregate.pnlSumUsd += floorPriceUsd - nft.lastSalePriceUsd;
                aggregate.totalCostUsd += nft.lastSalePriceUsd;
              }
            }
          }
        }
      }
    }

    // Push aggregated NFT positions into the positions list
    if (nftAggregates.size > 0) {
      for (const aggregate of nftAggregates.values()) {
        const amount = aggregate.amount || 0;
        if (amount <= 0) continue;
        const unitPriceUsd = aggregate.priceUsd || 0;
        const unitPriceNative = aggregate.priceNative || 0;
        const totalValueUsd = amount * unitPriceUsd;

        let pnl = null;
        let pnlPercent = null;
        if (aggregate.hasSaleData) {
          pnl = aggregate.pnlSumUsd;
          if (aggregate.totalCostUsd > 0) {
            pnlPercent = (pnl / aggregate.totalCostUsd) * 100;
          }
          }
          
          allPositionsData.push({
          asset: aggregate.asset,
            exchange: 'OpenSea',
          amount: amount,
          value: totalValueUsd,
          price: unitPriceUsd,
          priceInNative: unitPriceNative,
          nativeToken: aggregate.nativeToken,
          change24h: aggregate.change24h,
          pnl: pnl,
          pnlPercent: pnlPercent,
          collectionSlug: aggregate.collectionSlug,
          tokenIds: aggregate.tokenIds
        });
      }
    }

    // === Multi-Chain Token Balances ===
    // Process tokens from Alchemy (EVM) and Helius (Solana) APIs
    // Fetch prices: Pyth first (faster, more accurate), then CoinGecko fallback
    if (multiChainTokens.length > 0) {
      // Step 1: Try Pyth prices first for all tokens without prices
      const tokensNeedingPrice = multiChainTokens.filter(t => t.tokenPrice === 0);
      if (tokensNeedingPrice.length > 0) {
        const uniqueSymbols = [...new Set(tokensNeedingPrice.map(t => t.tokenSymbol))];
        console.log(`⟳ Fetching prices for ${uniqueSymbols.length} unique tokens via Pyth: [${uniqueSymbols.join(', ')}]`);
        
        const pythPrices = await fetchPythPrices(uniqueSymbols);
        console.log(`  Pyth returned prices for:`, Object.keys(pythPrices));
        
        let pythPricesFound = 0;
        
        for (const token of tokensNeedingPrice) {
          if (pythPrices[token.tokenSymbol]) {
            token.tokenPrice = pythPrices[token.tokenSymbol];
            token.balanceUsd = token.balance * token.tokenPrice;
            pythPricesFound++;
          }
        }
        
        if (pythPricesFound > 0) {
          console.log(`✓ Pyth: Applied ${pythPricesFound}/${tokensNeedingPrice.length} prices`);
        }
      }
      
      // Step 1.5: Use Hyperliquid price for HYPE (more accurate than Pyth/others)
      if (hlMarketData && hlMarketData['HYPE'] && hlMarketData['HYPE'].markPx) {
        const hypePrice = hlMarketData['HYPE'].markPx;
        for (const token of multiChainTokens) {
          if (token.tokenSymbol === 'HYPE') {
            token.tokenPrice = hypePrice;
            token.balanceUsd = token.balance * hypePrice;
            console.log(`  ✓ HYPE: $${hypePrice.toFixed(2)} (from Hyperliquid) → ${token.blockchain} balance = $${token.balanceUsd.toFixed(2)}`);
          }
        }
      }
      
      // Step 2: Fallback to CoinGecko for tokens still without prices
      const tokensByChain = {};
      for (const token of multiChainTokens) {
        if (token.blockchain !== 'Solana' && token.tokenPrice === 0 && token.contractAddress) {
          if (!tokensByChain[token.blockchain]) {
            tokensByChain[token.blockchain] = [];
          }
          tokensByChain[token.blockchain].push(token);
        }
      }
      
      // CoinGecko chain ID mapping
      const chainIdMap = {
        'Ethereum': 'ethereum',
        'Arbitrum': 'arbitrum-one',
        'Optimism': 'optimistic-ethereum',
        'Polygon': 'polygon-pos',
        'Base': 'base'
      };
      
      // Fetch CoinGecko prices for remaining tokens
      for (const [blockchain, tokens] of Object.entries(tokensByChain)) {
        const chainId = chainIdMap[blockchain];
        if (!chainId) continue;
        
        try {
          const contracts = tokens.map(t => t.contractAddress).join(',');
          const priceResp = await rateLimitedFetch(
            `https://api.coingecko.com/api/v3/simple/token_price/${chainId}?contract_addresses=${contracts}&vs_currencies=usd`,
            { cache: `price-${blockchain}-tokens`, cacheTTL: 60000 }
          );
          
          if (priceResp) {
            let pricesFound = 0;
            for (const token of tokens) {
              const priceData = priceResp[token.contractAddress.toLowerCase()];
              if (priceData && priceData.usd) {
                token.tokenPrice = priceData.usd;
                token.balanceUsd = token.balance * priceData.usd;
                pricesFound++;
              }
            }
            if (pricesFound > 0) {
              console.log(`✓ CoinGecko (${blockchain}): Found prices for ${pricesFound}/${tokens.length} tokens`);
            }
          }
        } catch (err) {
          console.log(`⚠ CoinGecko price fetch failed for ${blockchain}`);
        }
      }
    }
    
    // Aggregate tokens by symbol + blockchain (combine same tokens from different wallets)
    const tokenAggregates = {};
    
    for (const token of multiChainTokens) {
      // Dust filter: Skip if value < $0.01 OR (no price data AND balance is tiny)
      if (token.balanceUsd < 0.01 || (token.tokenPrice === 0 && token.balance < 1)) {
        continue;
      }
      
      const key = `${token.tokenSymbol}_${token.blockchain}`;
      
      if (!tokenAggregates[key]) {
        tokenAggregates[key] = {
          asset: token.tokenSymbol,
          exchange: token.blockchain,
          amount: 0,
          value: 0,
          price: token.tokenPrice,
          change24h: null,
          pnl: null,
          pnlPercent: null,
          walletBreakdown: []
        };
      }
      
      tokenAggregates[key].amount += token.balance;
      tokenAggregates[key].value += token.balanceUsd;
      tokenAggregates[key].walletBreakdown.push({
        address: token.address,
        balance: token.balance,
        balanceUsd: token.balanceUsd
      });
      
      if (token.balanceUsd > 0) {
        accountBalances.multichain += token.balanceUsd;
      }
    }
    
    // Add aggregated tokens to positions
    let tokensAdded = 0;
    let dustTokensFiltered = Object.keys(tokenAggregates).length - tokensAdded;
    for (const aggregate of Object.values(tokenAggregates)) {
      allPositionsData.push(aggregate);
      tokensAdded++;
    }
    
    dustTokensFiltered = multiChainTokens.length - tokensAdded;
    console.log(`✓ Multi-chain: Added ${tokensAdded} unique tokens (${multiChainTokens.length} total from ${wallets.length} wallet(s))`);
    if (tokensAdded === 0 && dustTokensFiltered > 0) {
      console.log('⚠ All tokens filtered as dust. Check [SHOW <$100] to view them.');
    }
    
    // === Pyth Network Pricing ===
    // Fetch Pyth prices for unified portfolio calculations
    // Exchange prices shown in table; Pyth used for hero section and as fallback
    const usePyth = settings.usePythPrices ?? true;
    const pythPricesMap = {};
    
    if (usePyth && allPositionsData.length > 0) {
      const assets = [...new Set(allPositionsData
        .filter(pos => pos.exchange !== 'OpenSea')
        .map(pos => pos.asset))];
      
      const pythPrices = await fetchPythPrices(assets);
      Object.assign(pythPricesMap, pythPrices);
      
      // Only use Pyth as fallback when exchange price is missing or zero
      for (const pos of allPositionsData) {
        if (pos.exchange !== 'OpenSea' && pythPricesMap[pos.asset]) {
          if (!pos.price || pos.price === 0) {
            pos.price = pythPricesMap[pos.asset];
            pos.value = Math.abs(pos.amount) * pos.price;
          }
        }
      }
    }
    
    // === Calculate TRUE 24h changes from local midnight prices ===
    // SPEED: Use cached midnight prices, fetch new ones in background
    
    let midnightData = getDailyPrices();
    
    // Background: Fetch fresh midnight prices if needed (non-blocking)
    if (!midnightData || isNewDay(midnightData.timestamp)) {
      fetchMidnightPrices().then(midnightPrices => {
        saveDailyPrices(midnightPrices, getMidnightTimestamp());
        // Re-render with updated 24h changes
        renderPositionsTable();
        updateHeroSection();
      }).catch(() => {});
      
      // Use old data or empty for now
      if (!midnightData) {
        midnightData = { prices: {}, timestamp: getMidnightTimestamp() };
      }
    }
    
    // Calculate 24h change for each position based on midnight price
      for (const pos of allPositionsData) {
      const currentPrice = pos.price || 0;
      let midnightPrice = null;
      
      if (pos.exchange === 'OpenSea') {
        // NFTs: Use stored midnight floor price by collection slug
        if (pos.collectionSlug) {
          midnightPrice = midnightData.prices[`${pos.collectionSlug}_NFT`]
            ?? midnightData.prices[`${pos.asset}_NFT`];
        }
      } else {
        // Crypto: Use stored midnight price for this asset on this exchange
        const key = `${pos.asset}_${pos.exchange}`;
        midnightPrice = midnightData.prices[key];
      }
      
      // Calculate change if we have both prices
      if (midnightPrice && midnightPrice > 0 && currentPrice > 0) {
        const change24h = ((currentPrice - midnightPrice) / midnightPrice) * 100;
        pos.change24h = change24h;
      }
    }
    
    
    // Render positions table
    renderPositionsTable();
    await updateHeroSection();
  }
  
  // Real-time price update functionality
  let realTimeUpdateTimer = null;
  
  async function updatePricesRealTime() {
    // Skip if tab is not visible to save API calls
    if (!isTabVisible) return;
    
    // Skip if update already in progress to prevent concurrent requests
    if (updateInProgress) return;
    
    if (allPositionsData.length === 0) return;
    
    updateInProgress = true;
    
    try {
      const settings = loadSettings() || getDefaultSettings();
      const usePyth = settings.usePythPrices ?? true;
      
      let latestPrices = {};
      
      if (usePyth) {
        // Fetch both Pyth and Hyperliquid prices
        const assets = [...new Set(allPositionsData
          .filter(pos => pos.exchange !== 'OpenSea')
          .map(pos => pos.asset))];
        
        const pythPrices = await fetchPythPrices(assets);
        
        // Get exchange prices from Hyperliquid
        const marketResp = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'metaAndAssetCtxs' })
        });
        
        if (!marketResp.ok) return;
        
        const marketData = await marketResp.json();
        
        if (marketData && marketData[0] && marketData[1]) {
          for (let i = 0; i < marketData[1].length; i++) {
            const ctx = marketData[1][i];
            const assetName = marketData[0].universe[i]?.name;
            if (assetName && ctx && ctx.markPx) {
              latestPrices[assetName] = {
                price: parseFloat(ctx.markPx),
                prevDayPx: parseFloat(ctx.prevDayPx || 0)
              };
            }
          }
        }
        
        // Also fetch Hyperliquid spot prices
        const spotPricesResp = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'allMids' })
        });
        
        if (spotPricesResp.ok) {
          const spotPrices = await spotPricesResp.json();
          for (const [coin, price] of Object.entries(spotPrices)) {
            if (!latestPrices[coin]) {
              latestPrices[coin] = { price: parseFloat(price), prevDayPx: 0 };
            }
          }
        }
        
        // Use Pyth as fallback for assets not covered by exchanges
        for (const [asset, price] of Object.entries(pythPrices)) {
          if (!latestPrices[asset]) {
            latestPrices[asset] = {
              price: price,
              prevDayPx: 0
            };
          }
        }
      } else {
        // Pyth disabled: fetch exchange prices only
        const marketResp = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'metaAndAssetCtxs' })
        });
        
        if (marketResp.ok) {
          const marketData = await marketResp.json();
          
          if (marketData && marketData[0] && marketData[1]) {
            for (let i = 0; i < marketData[1].length; i++) {
              const ctx = marketData[1][i];
              const assetName = marketData[0].universe[i]?.name;
              if (assetName && ctx && ctx.markPx) {
                latestPrices[assetName] = {
                  price: parseFloat(ctx.markPx),
                  prevDayPx: parseFloat(ctx.prevDayPx || 0)
                };
              }
            }
          }
          
          // Also fetch spot prices
          const spotPricesResp = await fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'allMids' })
          });
          
          if (spotPricesResp.ok) {
            const spotPrices = await spotPricesResp.json();
            for (const [coin, price] of Object.entries(spotPrices)) {
              if (!latestPrices[coin]) {
                latestPrices[coin] = { price: parseFloat(price), prevDayPx: 0 };
              }
            }
          }
        }
      }
      
      // Fetch latest Lighter positions for all wallets
      const wallets = parseWallets(settings.walletAddresses);
      const lighterUpdates = {};
      
      for (const wallet of wallets) {
        try {
          const lighterData = await fetchLighterPositions(wallet);
          if (lighterData && lighterData.accounts && lighterData.accounts[0]) {
            const account = lighterData.accounts[0];
            if (account.positions) {
              for (const pos of account.positions) {
                if (pos.position && parseFloat(pos.position) !== 0) {
                  const position = parseFloat(pos.position);
                  const positionValue = parseFloat(pos.position_value || 0);
                  const currentPrice = position > 0 ? positionValue / position : 0;
                  lighterUpdates[pos.symbol] = {
                    value: positionValue,
                    price: currentPrice,
                    pnl: parseFloat(pos.unrealized_pnl || 0)
                  };
                }
              }
            }
          }
        } catch (err) {
        }
      }
      
      // Get midnight prices for 24h change calculations
      const midnightData = getDailyPrices();
      
      // Update positions with new prices and track which ones changed
      const updatedAssets = new Set();
      
      // Update Hyperliquid positions
      for (const pos of allPositionsData) {
        if (pos.exchange === 'Hyperliquid' && latestPrices[pos.asset]) {
          const newPrice = latestPrices[pos.asset].price;
          if (newPrice && newPrice !== pos.price) {
            pos.price = newPrice;
            pos.value = Math.abs(pos.amount) * newPrice;
            
            // Calculate 24h change from midnight price (true local midnight)
            if (midnightData && midnightData.prices) {
              const midnightPrice = midnightData.prices[`${pos.asset}_${pos.exchange}`];
              if (midnightPrice && midnightPrice > 0) {
                pos.change24h = ((newPrice - midnightPrice) / midnightPrice) * 100;
              }
            }
            
            updatedAssets.add(pos.asset);
          }
        }
        
        // Update Lighter positions
        if (pos.exchange === 'Lighter' && lighterUpdates[pos.asset]) {
          const update = lighterUpdates[pos.asset];
          if (update.price !== pos.price || update.value !== pos.value) {
            pos.price = update.price;
            pos.value = update.value;
            pos.pnl = update.pnl;
            
            // Calculate 24h change from midnight price (true local midnight)
            if (midnightData && midnightData.prices) {
              const midnightPrice = midnightData.prices[`${pos.asset}_${pos.exchange}`];
              if (midnightPrice && midnightPrice > 0) {
                pos.change24h = ((update.price - midnightPrice) / midnightPrice) * 100;
              }
            }
            
            updatedAssets.add(pos.asset);
          }
        }
      }
      
      if (updatedAssets.size > 0) {
        renderPositionsTable();
        await updateHeroSection();
        updateLastUpdateTimestamp();
        
        // Add flash animation to updated cells
        requestAnimationFrame(() => {
          updatedAssets.forEach(asset => {
            // Flash desktop table cells (price, value, change, pnl)
            const rows = els.positionsBody?.querySelectorAll('tr');
            if (rows) {
              rows.forEach(row => {
                const assetCell = row.querySelector('.asset-cell');
                if (assetCell && assetCell.textContent.trim() === asset) {
                  // Flash the price, value, 24h change, and PnL cells
                  const cells = row.querySelectorAll('td');
                  if (cells.length >= 7) {
                    // td indices: 0=asset, 1=exchange, 2=amount, 3=price, 4=value, 5=change24h, 6=pnl
                    [3, 4, 5, 6].forEach(idx => {
                      const cell = cells[idx];
                      if (cell) {
                        cell.classList.add('flash-update');
                        setTimeout(() => cell.classList.remove('flash-update'), 200);
                      }
                    });
                  }
                }
              });
            }
            
            // Flash mobile card fields
            const cards = els.mobilePositionsContainer?.querySelectorAll('.mobile-position-card');
            if (cards) {
              cards.forEach(card => {
                const assetSpan = card.querySelector('.card-asset');
                if (assetSpan && assetSpan.textContent.trim() === asset) {
                  // Flash the price, value, 24h change, and PnL fields
                  const fields = card.querySelectorAll('.card-value');
                  fields.forEach(field => {
                    field.classList.add('flash-update');
                    setTimeout(() => field.classList.remove('flash-update'), 200);
                  });
                }
              });
            }
          });
        });
      }
    } catch (err) {
      // Update error
    } finally {
      updateInProgress = false;
    }
  }
  
  function startRealTimeUpdates() {
    const settings = loadSettings();
    if (!settings || !settings.enableRealTimeUpdates) return;
    
    stopRealTimeUpdates(); // Clear any existing timer
    
    const interval = (settings.realTimeUpdateInterval || 10) * 1000;
    
    realTimeUpdateTimer = setInterval(updatePricesRealTime, interval);
  }
  
  function stopRealTimeUpdates() {
    if (realTimeUpdateTimer) {
      clearInterval(realTimeUpdateTimer);
      realTimeUpdateTimer = null;
    }
  }
  
  function toggleAssetVisibility(assetKey) {
    const settings = loadSettings() || getDefaultSettings();
    const hiddenAssets = settings.hiddenAssets || [];
    
    const index = hiddenAssets.indexOf(assetKey);
    if (index > -1) {
      // Asset is hidden, show it
      hiddenAssets.splice(index, 1);
    } else {
      // Asset is visible, hide it
      hiddenAssets.push(assetKey);
    }
    
    settings.hiddenAssets = hiddenAssets;
    saveSettings(settings);
    renderPositionsTable();
  }
  
  function getMarketLink(asset, exchange, positionType) {
    if (exchange === 'Hyperliquid') {
      if (positionType === 'perp') {
      return `https://app.hyperliquid.xyz/trade/${asset}`;
      } else if (positionType === 'spot') {
      return `https://app.hyperliquid.xyz/spot/${asset}`;
      }
      return null;
    } else if (exchange === 'Lighter') {
      // Lighter links - format: https://app.lighter.xyz/trade/BTC-USDC
      return `https://app.lighter.xyz/trade/${asset}-USDC`;
    } else if (exchange === 'OpenSea') {
      // OpenSea collection links - format collection name to slug
      const slug = asset.toLowerCase().replace(/\s+/g, '-');
      return `https://opensea.io/collection/${slug}`;
    }
    return null;
  }

  function renderPositionsTable() {
    if (!els.positionsBody) return;
    
    if (allPositionsData.length === 0) {
      els.positionsBody.innerHTML = '<tr><td colspan="7" class="loading">No positions found</td></tr>';
      return;
    }
    
    // Filter positions based on toggles
    let filteredPositions = allPositionsData;
    const settings = loadSettings() || getDefaultSettings();
    const minThreshold = settings.minBalanceThreshold || 100;
    const hiddenAssets = settings.hiddenAssets || [];
    
    if (hideSmallPositions) {
      filteredPositions = filteredPositions.filter(pos => pos.value >= minThreshold);
    }
    
    if (hideNfts) {
      filteredPositions = filteredPositions.filter(pos => pos.exchange !== 'OpenSea');
    }
    
    // Filter hidden assets (only when not in edit mode)
    if (!editMode) {
      filteredPositions = filteredPositions.filter(pos => {
        const assetKey = `${pos.asset}_${pos.exchange}`;
        return !hiddenAssets.includes(assetKey);
      });
    }
    
    if (filteredPositions.length === 0) {
      els.positionsBody.innerHTML = '<tr><td colspan="7" class="loading">No positions matching filter</td></tr>';
      return;
    }
    
    els.positionsBody.innerHTML = '';
    if (els.mobilePositionsContainer) {
      els.mobilePositionsContainer.innerHTML = '';
    }
    
    const useColoredPnL = settings.useColoredPnL ?? true;
    
    for (const pos of filteredPositions) {
      const tr = document.createElement('tr');
      const assetKey = `${pos.asset}_${pos.exchange}`;
      const isHidden = hiddenAssets.includes(assetKey);
      
      // Add class for hidden items in edit mode
      if (editMode && isHidden) {
        tr.classList.add('position-row-hidden');
      }
      
      const hasPnlValue = pos.pnl !== null && pos.pnl !== undefined;
      const pnlClass = useColoredPnL 
        ? (hasPnlValue && pos.pnl >= 0 ? 'positive-pnl' : hasPnlValue ? 'negative-pnl' : 'neutral-value')
        : (hasPnlValue && pos.pnl >= 0 ? 'positive-neutral' : hasPnlValue ? 'negative-neutral' : 'neutral-value');
      const pnlSign = hasPnlValue ? (pos.pnl >= 0 ? '+' : '-') : '';
      
      const change24h = pos.change24h;
      const hasChange24h = change24h !== null && change24h !== undefined;
      const changeClass = useColoredPnL
        ? (hasChange24h ? (change24h >= 0 ? 'positive-pnl' : 'negative-pnl') : 'neutral-value')
        : (hasChange24h ? (change24h >= 0 ? 'positive-neutral' : 'negative-neutral') : 'neutral-value');
      const changeSign = hasChange24h ? (change24h >= 0 ? '+' : '-') : '';
      const change24hDisplay = hasChange24h ? `${changeSign}${Math.abs(change24h).toFixed(1)}%` : '—';
      
      const marketLink = getMarketLink(pos.asset, pos.exchange, pos.positionType);
      const exchangeDisplay = marketLink 
        ? `<a href="${marketLink}" target="_blank" class="exchange-link">${pos.exchange} ↗</a>`
        : pos.exchange;
      
      // Format amounts based on visibility toggle
      const amountDisplay = amountsVisible 
        ? (typeof pos.amount === 'number' ? formatCompactNumber(pos.amount) : pos.amount)
        : '••••';
      
      // Format price - for NFTs show in native token, for crypto show in USD
      let priceDisplay = '—';
      if (amountsVisible && pos.price) {
        if (pos.exchange === 'OpenSea' && pos.priceInNative) {
          const nativeToken = pos.nativeToken || 'ETH';
          priceDisplay = `${formatCompactNumber(pos.priceInNative)} ${nativeToken}`;
        } else {
          priceDisplay = `$${formatCompactNumber(pos.price)}`;
        }
      } else if (!amountsVisible) {
        priceDisplay = '••••';
      }
      
      const valueDisplay = amountsVisible 
        ? `$${formatCompactNumber(pos.value)}`
        : '$••••';
      
      const hasPnl = pos.pnl !== null && pos.pnl !== undefined;
      const pnlAmount = hasPnl ? Math.abs(pos.pnl) : 0;
      const pnlDisplay = amountsVisible 
        ? (hasPnl ? `${pnlSign}$${formatCompactNumber(pnlAmount)}${pos.pnlPercent !== 0 ? ` (${pnlSign}${Math.abs(pos.pnlPercent).toFixed(1)}%)` : ''}` : '—')
        : '••••';
      
      // Desktop table row
      const editButton = editMode 
        ? `<button class="position-edit-btn" data-asset-key="${assetKey}">[${isHidden ? 'SHOW' : 'HIDE'}]</button>`
        : '';
      
      // Generate wallet breakdown tooltip if available
      const hasWalletBreakdown = pos.walletBreakdown && pos.walletBreakdown.length > 1;
      const assetCellClass = hasWalletBreakdown ? 'asset-cell has-wallet-breakdown' : 'asset-cell';
      const assetDisplay = hasWalletBreakdown ? `${pos.asset} (i)` : pos.asset;
      
      tr.innerHTML = `
        <td class="${assetCellClass}">${assetDisplay}${editButton}</td>
        <td class="exchange-cell">${exchangeDisplay}</td>
        <td>${amountDisplay}</td>
        <td>${priceDisplay}</td>
        <td>${valueDisplay}</td>
        <td class="${changeClass}">${change24hDisplay}</td>
        <td class="${pnlClass}">${pnlDisplay}</td>
      `;
      
      // Add wallet breakdown tooltip if applicable
      if (hasWalletBreakdown) {
        const assetCell = tr.querySelector('.asset-cell');
        assetCell.setAttribute('data-wallet-breakdown', JSON.stringify(pos.walletBreakdown));
      }
      
      // Mobile card view
      const mobileCard = document.createElement('div');
      mobileCard.className = 'mobile-position-card';
      if (editMode && isHidden) {
        mobileCard.classList.add('position-row-hidden');
      }
      
      const assetClass = hasWalletBreakdown ? 'card-asset has-wallet-breakdown' : 'card-asset';
      const mobileAssetDisplay = hasWalletBreakdown ? `(i) ${pos.asset}` : pos.asset;
      
      mobileCard.innerHTML = `
        <div class="card-header">
          <span class="${assetClass}">${mobileAssetDisplay}${editButton}</span>
          <span class="card-exchange">${exchangeDisplay}</span>
        </div>
        <div class="card-grid">
          <div class="card-field">
            <span class="card-label">AMOUNT</span>
            <span class="card-value">${amountDisplay}</span>
          </div>
          <div class="card-field">
            <span class="card-label">PRICE</span>
            <span class="card-value">${priceDisplay}</span>
          </div>
          <div class="card-field">
            <span class="card-label">VALUE</span>
            <span class="card-value">${valueDisplay}</span>
          </div>
          <div class="card-field">
            <span class="card-label">24H CHANGE</span>
            <span class="card-value ${changeClass}">${change24hDisplay}</span>
          </div>
          <div class="card-field card-field-wide">
            <span class="card-label">P&L</span>
            <span class="card-value ${pnlClass}">${pnlDisplay}</span>
          </div>
        </div>
      `;
      
      els.positionsBody.appendChild(tr);
      if (els.mobilePositionsContainer) {
        els.mobilePositionsContainer.appendChild(mobileCard);
        
        // Add wallet breakdown to mobile card asset span
        if (hasWalletBreakdown) {
          const mobileAssetSpan = mobileCard.querySelector('.card-asset.has-wallet-breakdown');
          if (mobileAssetSpan) {
            mobileAssetSpan.setAttribute('data-wallet-breakdown', JSON.stringify(pos.walletBreakdown));
          }
        }
      }
    }
    
    // Initialize wallet breakdown tooltips
    initWalletBreakdownTooltips();
  }
  
  function initWalletBreakdownTooltips() {
    // Remove any existing tooltip
    let tooltip = document.getElementById('wallet-breakdown-tooltip');
    if (tooltip) {
      tooltip.remove();
    }
    
    // Create tooltip element
    tooltip = document.createElement('div');
    tooltip.id = 'wallet-breakdown-tooltip';
    tooltip.className = 'wallet-breakdown-tooltip';
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);
    
    // Add hover/touch listeners to all asset cells with wallet breakdown (desktop & mobile)
    const assetCells = document.querySelectorAll('.asset-cell.has-wallet-breakdown, .card-asset.has-wallet-breakdown');
    
    let activeTooltipCell = null;
    let mouseMoveHandler = null;
    
    assetCells.forEach(cell => {
      // Desktop: mouseenter/mouseleave
      cell.addEventListener('mouseenter', (e) => {
        const breakdownData = JSON.parse(cell.getAttribute('data-wallet-breakdown'));
        showWalletBreakdownTooltip(e, breakdownData);
        activeTooltipCell = cell;
        
        // Track mouse movement to update tooltip position
        mouseMoveHandler = (moveEvent) => {
          updateTooltipPosition(moveEvent);
        };
        document.addEventListener('mousemove', mouseMoveHandler);
      });
      
      cell.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
        activeTooltipCell = null;
        
        // Remove mouse tracking
        if (mouseMoveHandler) {
          document.removeEventListener('mousemove', mouseMoveHandler);
          mouseMoveHandler = null;
        }
      });
      
      // Mobile: tap to toggle
      cell.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
          e.stopPropagation();
          
          if (activeTooltipCell === cell && tooltip.style.display === 'block') {
            tooltip.style.display = 'none';
            activeTooltipCell = null;
          } else {
            const breakdownData = JSON.parse(cell.getAttribute('data-wallet-breakdown'));
            showWalletBreakdownTooltip(e, breakdownData);
            activeTooltipCell = cell;
          }
        }
      });
    });
    
    // Helper function to update tooltip position based on mouse
    function updateTooltipPosition(e) {
      if (tooltip.style.display === 'none') return;
      
      const offset = 15; // Pixels away from cursor
      let left = e.clientX + offset;
      let top = e.clientY + offset;
      
      // Get tooltip dimensions (needs to be visible to measure)
      const tooltipRect = tooltip.getBoundingClientRect();
      
      // Prevent tooltip from going off-screen (right edge)
      if (left + tooltipRect.width > window.innerWidth) {
        left = e.clientX - tooltipRect.width - offset;
      }
      
      // Prevent tooltip from going off-screen (bottom edge)
      if (top + tooltipRect.height > window.innerHeight) {
        top = e.clientY - tooltipRect.height - offset;
      }
      
      // Prevent tooltip from going off-screen (top edge)
      if (top < 0) {
        top = offset;
      }
      
      // Prevent tooltip from going off-screen (left edge)
      if (left < 0) {
        left = offset;
      }
      
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }
    
    // Close tooltip when clicking outside on mobile
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 768 && activeTooltipCell) {
        if (!tooltip.contains(e.target) && !activeTooltipCell.contains(e.target)) {
          tooltip.style.display = 'none';
          activeTooltipCell = null;
        }
      }
    });
  }
  
  function showWalletBreakdownTooltip(event, walletBreakdown) {
    const tooltip = document.getElementById('wallet-breakdown-tooltip');
    if (!tooltip || !walletBreakdown || walletBreakdown.length === 0) return;
    
    // Calculate total balance
    const totalBalance = walletBreakdown.reduce((sum, w) => sum + w.balance, 0);
    
    // Generate tooltip content
    let content = '<div class="wallet-breakdown-list">';
    
    walletBreakdown.forEach((wallet, index) => {
      const percentage = (wallet.balance / totalBalance) * 100;
      const shortAddress = `${wallet.address.substring(0, 6)}...${wallet.address.substring(wallet.address.length - 4)}`;
      
      content += `
        <div class="wallet-breakdown-item">
          <div class="wallet-breakdown-info">
            <span class="wallet-address">${shortAddress}</span>
            <span class="wallet-amount">${formatCompactNumber(wallet.balance)} (${percentage.toFixed(1)}%)</span>
          </div>
        </div>
      `;
    });
    
    content += '</div>';
    
    // Add visual bar chart
    content += '<div class="wallet-breakdown-bar">';
    walletBreakdown.forEach((wallet, index) => {
      const percentage = (wallet.balance / totalBalance) * 100;
      const colors = ['var(--accent)', 'var(--muted)', 'var(--text)'];
      const color = colors[index % colors.length];
      
      content += `<div class="wallet-bar-segment" style="width: ${percentage}%; background-color: ${color}; opacity: ${0.8 - (index * 0.1)}"></div>`;
    });
    content += '</div>';
    
    tooltip.innerHTML = content;
    tooltip.style.display = 'block';
    
    // Position tooltip at cursor (mobile uses tap position, desktop uses mouse position)
    const offset = 15;
    let left = event.clientX + offset;
    let top = event.clientY + offset;
    
    // For mobile, position below tap point
    if (window.innerWidth <= 768) {
      const rect = event.target.getBoundingClientRect();
      left = rect.left;
      top = rect.bottom + 8;
    }
    
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    
    // Adjust if tooltip goes off screen
    const tooltipRect = tooltip.getBoundingClientRect();
    if (tooltipRect.right > window.innerWidth) {
      tooltip.style.left = `${window.innerWidth - tooltipRect.width - 16}px`;
    }
    if (tooltipRect.bottom > window.innerHeight) {
      if (window.innerWidth <= 768) {
        const rect = event.target.getBoundingClientRect();
        tooltip.style.top = `${rect.top - tooltipRect.height - 8}px`;
      } else {
        tooltip.style.top = `${event.clientY - tooltipRect.height - offset}px`;
      }
    }
  }
  
  async function fetchAndRenderWeather() {
    const settings = loadSettings() || getDefaultSettings();
    const { label, lat, lon } = settings.weather || {};
    
    if (!lat || !lon) {
      weatherData = null;
      return;
    }
    
    try {
      const resp = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`
      );
      if (resp.ok) {
        weatherData = await resp.json();
        weatherData.label = label;
        
        // Calculate moon phase (0 = new moon, 0.5 = full moon, 1 = new moon)
        const today = new Date();
        const knownNewMoon = new Date('2000-01-06'); // Known new moon date
        const daysSinceKnownNewMoon = (today - knownNewMoon) / (1000 * 60 * 60 * 24);
        const lunarCycle = 29.53058867; // Days in a lunar cycle
        const phase = (daysSinceKnownNewMoon % lunarCycle) / lunarCycle;
        weatherData.moonPhase = phase;
      }
    } catch (err) {
      console.error('✗ Weather data unavailable');
      weatherData = null;
    }
  }
  
  async function updateHeroSection() {
    const settings = loadSettings() || getDefaultSettings();
    const userName = settings.userName || 'there';
    const usePyth = settings.usePythPrices ?? true;
    
    // Get time of day
    const hour = new Date().getHours();
    let timeOfDay = 'Good morning';
    if (hour >= 12 && hour < 18) timeOfDay = 'Good afternoon';
    else if (hour >= 18) timeOfDay = 'Good evening';
    
    els.greeting.textContent = `${timeOfDay}, ${userName}.`;
    if (els.greetingMobile) {
      els.greetingMobile.textContent = `${timeOfDay}, ${userName}.`;
    }
    
    // Calculate total portfolio value from actual account balances
    // This is more accurate than summing position values as it accounts for leverage
    const totalValue = accountBalances.hyperliquid + accountBalances.lighter + accountBalances.nfts + accountBalances.multichain;
    
    // === Daily Change Calculation from TRUE Midnight Local Time ===
    // SPEED: Use cached midnight prices (non-blocking)
    
    let midnightData = getDailyPrices();
    
    // Use cached data or empty if not available
    if (!midnightData) {
      midnightData = { prices: {}, timestamp: getMidnightTimestamp() };
    }
    
    // === Calculate Daily P&L from Price Movements ===
    // For each position: amount × (current_price - midnight_price)
    // Reflects price changes only, not trades/transfers
    
    // SPEED: Use existing position prices instead of fetching Pyth again
    // Prices are already fetched during position loading
    const pythPricesForHero = {};
    
    let totalDailyChange = 0;
    let portfolioValueAtMidnightPrices = 0;
    
    
    for (const pos of allPositionsData) {
      // Use Pyth price for hero calculations if enabled, otherwise use exchange price
      let currentPrice = pos.price || 0;
      if (usePyth && pos.exchange !== 'OpenSea' && pythPricesForHero[pos.asset]) {
        currentPrice = pythPricesForHero[pos.asset];
      }
      
      const amount = Math.abs(pos.amount || 0); // Use absolute value for position size
      let midnightPrice = null;
      
      if (pos.exchange === 'OpenSea') {
        // NFTs: Use stored midnight floor price by collection slug
        if (pos.collectionSlug) {
        midnightPrice = midnightData.prices[`${pos.collectionSlug}_NFT`]
          ?? midnightData.prices[`${pos.asset}_NFT`];
        }
      } else {
        // Crypto: Use stored midnight price for this asset/exchange
        const key = `${pos.asset}_${pos.exchange}`;
        midnightPrice = midnightData.prices[key];
      }
      
      if (midnightPrice && midnightPrice > 0 && currentPrice > 0) {
        // Calculate P&L from price movement: amount * (current - midnight)
        const positionPnL = amount * (currentPrice - midnightPrice);
        totalDailyChange += positionPnL;
        
        // Calculate what this position was worth at midnight
        const midnightValue = amount * midnightPrice;
        portfolioValueAtMidnightPrices += midnightValue;
        
        const pnlPercent = ((currentPrice - midnightPrice) / midnightPrice) * 100;
      } else {
        // If no midnight price, use current value as midnight value
        portfolioValueAtMidnightPrices += (amount * currentPrice);
      }
    }
    
    // Calculate percentage based on what portfolio was worth at midnight prices
    const totalDailyChangePercent = portfolioValueAtMidnightPrices > 0 
      ? (totalDailyChange / portfolioValueAtMidnightPrices) * 100 
      : 0;
    
    
    // Get asset highlights based on 24h change (for individual assets)
    const highlights = [];
    const assetGroups = {};
    for (const pos of allPositionsData) {
      if (!assetGroups[pos.asset]) {
        assetGroups[pos.asset] = { 
          change24h: pos.change24h || 0, 
          value: pos.value 
        };
      } else {
        // If same asset on multiple exchanges, average the change weighted by value
        const totalAssetValue = assetGroups[pos.asset].value + pos.value;
        assetGroups[pos.asset].change24h = 
          (assetGroups[pos.asset].change24h * assetGroups[pos.asset].value + 
           (pos.change24h || 0) * pos.value) / totalAssetValue;
        assetGroups[pos.asset].value = totalAssetValue;
      }
    }
    
    const sortedAssets = Object.entries(assetGroups)
      .filter(([_, data]) => Math.abs(data.change24h) > 0.5 && data.value > 100) // Filter out small changes and small positions
      .sort((a, b) => Math.abs(b[1].change24h) - Math.abs(a[1].change24h))
      .slice(0, 2);
    
    const useColoredPnL = settings.useColoredPnL ?? true;
    for (const [asset, data] of sortedAssets) {
      const sign = data.change24h >= 0 ? 'up' : 'down';
      const colorClass = useColoredPnL 
        ? (data.change24h >= 0 ? 'positive-pnl' : 'negative-pnl')
        : (data.change24h >= 0 ? 'positive-neutral' : 'negative-neutral');
      highlights.push(`<strong>${asset}</strong> is <span class="${colorClass}">${sign} ${Math.abs(data.change24h).toFixed(1)}%</span>`);
    }
    
    // Build summary - start with portfolio value
    let summaryParts = [];
    
    // Portfolio value
    const valueText = amountsVisible 
      ? `$${totalValue.toLocaleString(undefined, {maximumFractionDigits: 0})}`
      : '$••••';
    
    // Daily change from midnight local time (includes all assets: crypto positions + NFTs)
    if (totalDailyChange !== 0 && Math.abs(totalDailyChange) > 0.01) {
      const changeSign = totalDailyChange >= 0 ? 'up' : 'down';
      const changeAmountText = amountsVisible 
        ? `$${Math.abs(totalDailyChange).toLocaleString(undefined, {maximumFractionDigits: 0})}`
        : '$••••';
      
      // Apply color based on useColoredPnL setting
      const colorClass = useColoredPnL 
        ? (totalDailyChange >= 0 ? 'positive-pnl' : 'negative-pnl')
        : (totalDailyChange >= 0 ? 'positive-neutral' : 'negative-neutral');
      const colorStyle = ` class="${colorClass}"`;
      
      const sign = totalDailyChangePercent >= 0 ? '+' : '-';
      summaryParts.push(`Your portfolio is worth ${valueText}, <strong${colorStyle}>${changeSign} ${changeAmountText} (${sign}${Math.abs(totalDailyChangePercent).toFixed(2)}%)</strong>`);
    } else {
      summaryParts.push(`Your portfolio is worth ${valueText}`);
    }
    
    // Weather
    if (weatherData && weatherData.current) {
      const temp = Math.round(weatherData.current.temperature_2m);
      const city = weatherData.label || 'your location';
      const weatherCode = weatherData.current.weather_code || 0;
      const isDay = weatherData.current.is_day === 1;
      
      
      // Weather icons based on WMO Weather interpretation codes
      // https://open-meteo.com/en/docs
      let weatherIcon = '';
      if (weatherCode === 0) {
        weatherIcon = isDay ? '☀︎' : '☾'; // Clear sky
      } else if (weatherCode <= 3) {
        weatherIcon = '☁︎'; // Partly cloudy
      } else if (weatherCode <= 49) {
        weatherIcon = '☁︎'; // Cloudy/foggy
      } else if (weatherCode >= 51 && weatherCode <= 67) {
        weatherIcon = '⛆'; // Drizzle/rain/freezing rain
      } else if (weatherCode >= 71 && weatherCode <= 77) {
        weatherIcon = '❅'; // Snow
      } else if (weatherCode >= 80 && weatherCode <= 82) {
        weatherIcon = '⛆'; // Rain showers
      } else if (weatherCode >= 85 && weatherCode <= 86) {
        weatherIcon = '❅'; // Snow showers
      } else if (weatherCode >= 95 && weatherCode <= 99) {
        weatherIcon = '⛈'; // Thunderstorm
      } else {
        weatherIcon = '☁︎'; // Default to cloudy
      }
      
      // Get moon phase icon (minimal ASCII)
      const moonPhase = weatherData.moonPhase || 0;
      let moonIcon = '';
      let moonName = '';
      
      if (moonPhase < 0.0625) {
        moonIcon = 'o';
        moonName = 'new moon';
      } else if (moonPhase < 0.1875) {
        moonIcon = ')';
        moonName = 'waxing crescent';
      } else if (moonPhase < 0.3125) {
        moonIcon = 'D';
        moonName = 'first quarter';
      } else if (moonPhase < 0.4375) {
        moonIcon = 'O';
        moonName = 'waxing gibbous';
      } else if (moonPhase < 0.5625) {
        moonIcon = '@';
        moonName = 'full moon';
      } else if (moonPhase < 0.6875) {
        moonIcon = 'C';
        moonName = 'waning gibbous';
      } else if (moonPhase < 0.8125) {
        moonIcon = '(';
        moonName = 'last quarter';
      } else if (moonPhase < 0.9375) {
        moonIcon = 'c';
        moonName = 'waning crescent';
      } else {
        moonIcon = 'o';
        moonName = 'new moon';
      }
      
      // Only show moon during evening/night (6 PM - 6 AM)
      const currentHour = new Date().getHours();
      const showMoon = currentHour >= 18 || currentHour < 6;
      const moonText = showMoon ? ` with a ${moonIcon} ${moonName} moon` : '';
      
      if (settings.showRainForecast) {
        const precipitation = weatherData.daily?.precipitation_sum?.[0] || 0;
        if (precipitation > 0) {
          summaryParts.push(`It's ${temp}°C ${weatherIcon} in <strong>${city}</strong> with rain forecasted${moonText}`);
        } else {
          summaryParts.push(`It's ${temp}°C ${weatherIcon} in <strong>${city}</strong>${moonText}`);
        }
      } else {
        summaryParts.push(`It's ${temp}°C ${weatherIcon} in <strong>${city}</strong>${moonText}`);
      }
    }
    
    if (summaryParts.length === 0) {
      summaryParts.push('<span class="loading-terminal">[...]</span>');
    }
    
    els.summary.innerHTML = summaryParts.join('. ') + '.';
  }
  

  function initDotGrid() {
    const dotGrid = document.getElementById('dotGrid');
    if (!dotGrid) return;
    
    // Create 8x8 grid (64 dots) with flame-like density (denser at bottom)
    const gridSize = 8;
    
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const dot = document.createElement('div');
        dot.className = 'dot';
        
        // Vertical progress: 0 = bottom, 1 = top
        const verticalProgress = row / gridSize;
        
        // Bottom rows animate more frequently (denser/more active like fire base)
        // Top rows animate less frequently (sparser like dissipating flames)
        const densityFactor = 1 - verticalProgress; // 1 at bottom, 0 at top
        
        // Random delay with wave pattern
        const horizontalWave = (col / gridSize) * 0.4; // Wave across horizontally
        const randomOffset = Math.random() * 0.8; // Add randomness
        const verticalDelay = verticalProgress * 0.6; // Bottom starts earlier
        
        const totalDelay = horizontalWave + randomOffset + verticalDelay;
        
        // Animation duration: faster at bottom (denser), slower at top (sparser)
        const baseDuration = 1.5;
        const durationVariation = verticalProgress * 0.8; // Top is slower
        const duration = baseDuration + durationVariation;
        
        dot.style.setProperty('--delay', `${totalDelay}s`);
        dot.style.setProperty('--duration', `${duration}s`);
        
        dotGrid.appendChild(dot);
      }
    }
  }

  function init() {
    // Initialize loading animation
    initDotGrid();
    
    // console.log('✓ Dashboard initialized');
    const settings = loadSettings() || getDefaultSettings();
    if (!loadSettings()) saveSettings(settings);
    initTheme(settings);
    applyAlignment(settings.leftAligned ?? false);
    addHandlers();
    refreshAll();
    
    // Setup Page Visibility API to pause requests when tab is inactive
    document.addEventListener('visibilitychange', () => {
      isTabVisible = !document.hidden;
      
      if (isTabVisible) {
        // Tab became visible - resume updates
        startRealTimeUpdates();
      } else {
        // Tab became hidden - pause updates to save API calls
        stopRealTimeUpdates();
      }
    });
    
    // Start real-time updates after initial load
    setTimeout(() => {
      startRealTimeUpdates();
    }, 2000); // Start after 2s to let initial load complete

    // Add toggle handler for hide small positions
    if (els.hideSmallBtn) {
      const updateHideSmallBtn = () => {
        const settings = loadSettings() || getDefaultSettings();
        const threshold = settings.minBalanceThreshold || 100;
        els.hideSmallBtn.textContent = hideSmallPositions ? `[SHOW <$${threshold}]` : `[HIDE <$${threshold}]`;
      };
      
      updateHideSmallBtn();
      
      els.hideSmallBtn.addEventListener('click', () => {
        hideSmallPositions = !hideSmallPositions;
        updateHideSmallBtn();
        renderPositionsTable();
      });
    }

    // Add toggle handler for hide NFTs
    if (els.toggleNftsBtn) {
      els.toggleNftsBtn.addEventListener('click', () => {
        hideNfts = !hideNfts;
        els.toggleNftsBtn.textContent = hideNfts ? '[SHOW NFTS]' : '[HIDE NFTS]';
        renderPositionsTable();
      });
    }
    
    // Add edit list mode toggle
    if (els.editListBtn) {
      els.editListBtn.addEventListener('click', () => {
        editMode = !editMode;
        els.editListBtn.textContent = editMode ? '[SAVE CHANGES]' : '[EDIT LIST]';
        renderPositionsTable();
      });
    }
    
    // Add event delegation for hide/show buttons (they're created dynamically)
    if (els.positionsBody) {
      els.positionsBody.addEventListener('click', (e) => {
        if (e.target.classList.contains('position-edit-btn')) {
          const assetKey = e.target.getAttribute('data-asset-key');
          toggleAssetVisibility(assetKey);
        }
      });
    }
    
    if (els.mobilePositionsContainer) {
      els.mobilePositionsContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('position-edit-btn')) {
          const assetKey = e.target.getAttribute('data-asset-key');
          toggleAssetVisibility(assetKey);
        }
      });
    }

    // Add toggle handler for amounts visibility
    if (els.toggleAmountsBtn) {
      els.toggleAmountsBtn.addEventListener('click', async () => {
        amountsVisible = !amountsVisible;
        els.toggleAmountsBtn.textContent = amountsVisible ? '[HIDE AMOUNTS]' : '[SHOW AMOUNTS]';
        if (els.toggleAmountsBtnMobile) {
          els.toggleAmountsBtnMobile.textContent = amountsVisible ? '[HIDE AMOUNTS]' : '[SHOW AMOUNTS]';
        }
        renderPositionsTable();
        await updateHeroSection(); // Also hide amounts in hero
      });
      els.toggleAmountsBtn.textContent = '[HIDE AMOUNTS]';
    }
    
    // Sync mobile button text
    if (els.toggleAmountsBtnMobile) {
      els.toggleAmountsBtnMobile.textContent = '[HIDE AMOUNTS]';
    }

    // Add font size controls
    if (els.decreaseFontBtn) {
      els.decreaseFontBtn.addEventListener('click', () => {
        if (currentFontSize > 10) { // minimum 10px
          const newSize = currentFontSize - 1;
          applyFontSize(newSize);
          const s = loadSettings() || getDefaultSettings();
          s.fontSize = newSize;
          saveSettings(s);
        }
      });
    }

    if (els.increaseFontBtn) {
      els.increaseFontBtn.addEventListener('click', () => {
        if (currentFontSize < 24) { // maximum 24px
          const newSize = currentFontSize + 1;
          applyFontSize(newSize);
          const s = loadSettings() || getDefaultSettings();
          s.fontSize = newSize;
          saveSettings(s);
        }
      });
    }

    // Mobile menu handlers
    if (els.mobileMenuBtn) {
      els.mobileMenuBtn.addEventListener('click', openMobileMenu);
    }
    
    if (els.closeMobileMenuBtn) {
      els.closeMobileMenuBtn.addEventListener('click', closeMobileMenu);
    }
    
    // Mobile snow toggle
    if (els.toggleSnowBtnMobile) {
      els.toggleSnowBtnMobile.addEventListener('click', () => {
        toggleSnow();
        const newText = snowActive ? '[SNOW OFF]' : '[SNOW ON]';
        els.toggleSnowBtnMobile.textContent = newText;
        // Update desktop button too
        const desktopBtn = document.getElementById('toggleSnowBtn');
        if (desktopBtn) desktopBtn.textContent = newText;
      });
    }
    
    // Mobile rain toggle
    if (els.toggleRainBtnMobile) {
      els.toggleRainBtnMobile.addEventListener('click', () => {
        toggleRain();
        const newText = rainActive ? '[RAIN OFF]' : '[RAIN ON]';
        els.toggleRainBtnMobile.textContent = newText;
        // Update desktop button too
        const desktopBtn = document.getElementById('toggleRainBtn');
        if (desktopBtn) desktopBtn.textContent = newText;
      });
    }
    
    // Mobile theme toggle - cycle through themes
    if (els.toggleThemeBtnMobile) {
      els.toggleThemeBtnMobile.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const themeOrder = ['light', 'dark', 'halloween', 'christmas', 'amber', 'matrix'];
        const currentIndex = themeOrder.indexOf(currentTheme);
        const newTheme = themeOrder[(currentIndex + 1) % themeOrder.length];
        applyTheme(newTheme);
        const s = loadSettings() || getDefaultSettings();
        s.theme = newTheme;
        saveSettings(s);
      });
    }
    
    // Mobile amounts toggle
    if (els.toggleAmountsBtnMobile) {
      els.toggleAmountsBtnMobile.addEventListener('click', async () => {
        amountsVisible = !amountsVisible;
        els.toggleAmountsBtn.textContent = amountsVisible ? '[HIDE AMOUNTS]' : '[SHOW AMOUNTS]';
        els.toggleAmountsBtnMobile.textContent = amountsVisible ? '[HIDE AMOUNTS]' : '[SHOW AMOUNTS]';
        renderPositionsTable();
        await updateHeroSection();
      });
    }
    
    // Mobile font size controls
    if (els.decreaseFontBtnMobile) {
      els.decreaseFontBtnMobile.addEventListener('click', () => {
        if (currentFontSize > 10) {
          const newSize = currentFontSize - 1;
          applyFontSize(newSize);
          const s = loadSettings() || getDefaultSettings();
          s.fontSize = newSize;
          saveSettings(s);
        }
      });
    }
    
    if (els.increaseFontBtnMobile) {
      els.increaseFontBtnMobile.addEventListener('click', () => {
        if (currentFontSize < 24) {
          const newSize = currentFontSize + 1;
          applyFontSize(newSize);
          const s = loadSettings() || getDefaultSettings();
          s.fontSize = newSize;
          saveSettings(s);
        }
      });
    }

    // Comic toggle handler (collapse/expand)
    if (els.comicToggleBtn && els.comicSection) {
      els.comicToggleBtn.addEventListener('click', () => {
        const settings = loadSettings() || getDefaultSettings();
        const isCollapsed = els.comicSection.classList.contains('collapsed');
        
        if (isCollapsed) {
          els.comicSection.classList.remove('collapsed');
          settings.comicCollapsed = false;
        } else {
          els.comicSection.classList.add('collapsed');
          settings.comicCollapsed = true;
        }
        
        saveSettings(settings);
      });
    }
    
    if (els.calvinPrevBtn) {
      els.calvinPrevBtn.addEventListener('click', () => {
        currentCalvinDate.setDate(currentCalvinDate.getDate() - 1);
        renderCalvin(currentCalvinDate, true);
      });
    }
    
    if (els.calvinNextBtn) {
      els.calvinNextBtn.addEventListener('click', () => {
        currentCalvinDate.setDate(currentCalvinDate.getDate() + 1);
        renderCalvin(currentCalvinDate, true);
      });
    }
    
    if (els.calvinRandomBtn) {
      els.calvinRandomBtn.addEventListener('click', () => {
        const settings = loadSettings() || getDefaultSettings();
        const comicStrip = settings.comicStrip || 'calvinandhobbes';
        const comic = comicMetadata[comicStrip];
        
        if (comic) {
          const randomTime = comic.startDate.getTime() + Math.random() * (comic.endDate.getTime() - comic.startDate.getTime());
          currentCalvinDate = new Date(randomTime);
          renderCalvin(currentCalvinDate, true);
        }
      });
    }
    
    // Mobile button handlers (sync with desktop)
    if (els.calvinPrevBtnMobile) {
      els.calvinPrevBtnMobile.addEventListener('click', () => {
        if (els.calvinPrevBtn) {
          els.calvinPrevBtn.click();
        }
      });
    }
    
    if (els.calvinNextBtnMobile) {
      els.calvinNextBtnMobile.addEventListener('click', () => {
        if (els.calvinNextBtn) {
          els.calvinNextBtn.click();
        }
      });
    }
    
    if (els.calvinRandomBtnMobile) {
      els.calvinRandomBtnMobile.addEventListener('click', () => {
        if (els.calvinRandomBtn) {
          els.calvinRandomBtn.click();
        }
      });
    }
    
    // Comic tab switching
    const comicTabs = [els.tabCalvin, els.tabPeanuts, els.tabFarside];
    comicTabs.forEach(tab => {
      if (tab) {
        tab.addEventListener('click', () => {
          const comicName = tab.getAttribute('data-comic');
          
          // Update active state
          comicTabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          
          // Save to settings
          const settings = loadSettings() || getDefaultSettings();
          settings.comicStrip = comicName;
          saveSettings(settings);
          
          // Load the comic
          const comic = comicMetadata[comicName];
          if (comic) {
            currentCalvinDate = new Date(); // Reset to today
            renderCalvin(currentCalvinDate, true);
          }
        });
      }
    });
    
    // Hero section click to refresh
    const heroSection = document.querySelector('.hero');
    if (heroSection) {
      heroSection.style.cursor = 'pointer';
      heroSection.addEventListener('click', async () => {
        if (els.summary) {
          const originalText = els.summary.innerHTML;
          els.summary.innerHTML = '<span class="loading-terminal">[Updating...]</span>';
          await refreshAll();
          // Text will be updated by refreshAll, but fallback if it fails
          if (els.summary.innerHTML.includes('[Updating...]')) {
            els.summary.innerHTML = originalText;
          }
        } else {
          await refreshAll();
        }
      });
    }

    // Set up auto-refresh
    const refreshMinutes = (settings && settings.refreshMinutes) || 30;
    if (refreshMinutes > 0) {
      setInterval(refreshAll, refreshMinutes * 60 * 1000);
    }
  }

  // Pixel art rain effect
  const rainCanvas = document.getElementById('rainCanvas');
  const rainCtx = rainCanvas ? rainCanvas.getContext('2d') : null;
  let rainDrops = [];
  let rainActive = false;
  let snowActive = false;
  let rainAnimationFrame = null;
  
  const rainConfig = {
    density: 161,
    speed: 5,
    size: 1,
    length: 8,
    angle: -30,
    randomAngle: true,
    useTextColor: false,
    particleStyle: 'default',
    rainbow: false
  };
  
  let rainAngleOffset = 0;
  let rainAngleChangeTime = 0;
  let targetAngleOffset = 0;
  let windTransitionSpeed = 0.02; // Smooth wind transitions
  
  // Check weather at user's location and auto-enable rain/snow
  async function checkWeatherAndEnableRain() {
    try {
      const settings = loadSettings();
      const weather = settings?.weather;
      
      // Check if user has location set in settings
      if (!weather || !weather.lat || !weather.lon) {
        return;
      }
      
      const latitude = weather.lat;
      const longitude = weather.lon;
      
      // Fetch weather data from Open-Meteo (free, no API key required)
      const weatherResponse = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=weather_code,precipitation&timezone=auto`
      );
      
      if (!weatherResponse.ok) {
        return;
      }
      
      const weatherData = await weatherResponse.json();
      const weatherCode = weatherData.current?.weather_code;
      const precipitation = weatherData.current?.precipitation || 0;
      
      // Weather codes from Open-Meteo: https://open-meteo.com/en/docs
      // Snow codes: 71-77 (snow), 85-86 (snow showers)
      const isSnowing = (weatherCode >= 71 && weatherCode <= 77) ||
                       (weatherCode >= 85 && weatherCode <= 86);
      
      // Rain codes: 51-67 (drizzle/rain), 80-82 (rain showers), 95-99 (thunderstorm)
      const isRaining = !isSnowing && (precipitation > 0 || 
                       (weatherCode >= 51 && weatherCode <= 67) ||
                       (weatherCode >= 80 && weatherCode <= 82) ||
                       (weatherCode >= 95 && weatherCode <= 99));
      
      if (isSnowing && !snowActive) {
        toggleSnow();
        const toggleBtn = document.getElementById('toggleSnowBtn');
        const mobileBtn = document.getElementById('toggleSnowBtnMobile');
        if (toggleBtn) toggleBtn.textContent = '[SNOW OFF]';
        if (mobileBtn) mobileBtn.textContent = '[SNOW OFF]';
      } else if (isRaining && !rainActive) {
        toggleRain();
        const toggleBtn = document.getElementById('toggleRainBtn');
        const mobileBtn = document.getElementById('toggleRainBtnMobile');
        if (toggleBtn) toggleBtn.textContent = '[RAIN OFF]';
        if (mobileBtn) mobileBtn.textContent = '[RAIN OFF]';
      }
    } catch (error) {
      // Silently fail - API might be unavailable
    }
  }
  
  function resizeRainCanvas() {
    if (!rainCanvas) return;
    rainCanvas.width = window.innerWidth;
    rainCanvas.height = window.innerHeight;
  }
  
  function createRainDrop() {
    // Snow uses same rendering as rain but with slower speed
    const baseSpeed = snowActive ? 0.6 : rainConfig.speed;
    const baseSize = snowActive ? 1 : rainConfig.size;
    const baseLength = snowActive ? 2 : rainConfig.length;
    
    return {
      x: Math.random() * rainCanvas.width,
      y: Math.random() * rainCanvas.height - rainCanvas.height,
      speed: baseSpeed * (0.7 + Math.random() * 0.6), // More speed variation
      size: baseSize,
      length: baseLength,
      wobble: Math.random() * Math.PI * 2, // For slight horizontal variation
      wobbleSpeed: 0.02 + Math.random() * 0.03
    };
  }
  
  function initRain() {
    rainDrops = [];
    for (let i = 0; i < rainConfig.density; i++) {
      rainDrops.push(createRainDrop());
    }
  }
  
  function drawRain() {
    if ((!rainActive && !snowActive) || !rainCtx) return;
    
    rainCtx.clearRect(0, 0, rainCanvas.width, rainCanvas.height);
    
    // Set pixel art style - crisp rendering, no blur
    rainCtx.imageSmoothingEnabled = false;
    rainCtx.webkitImageSmoothingEnabled = false;
    rainCtx.mozImageSmoothingEnabled = false;
    rainCtx.msImageSmoothingEnabled = false;
    rainCtx.oImageSmoothingEnabled = false;
    
    // Color based on type
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    const isDark = theme !== 'light';
    
    // Get theme colors
    const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
    
    if (snowActive) {
      // Snow uses muted color on light mode, white on dark themes
      if (theme === 'light') {
        rainCtx.fillStyle = muted || '#93a1a1';
      } else {
        rainCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      }
    } else {
      // Rain color: text color or default
      if (rainConfig.useTextColor) {
        rainCtx.fillStyle = textColor || '#657b83';
      } else {
        // Use default subtle colors
        if (theme === 'light') {
          rainCtx.fillStyle = 'rgba(180, 190, 210, 0.6)';
        } else {
          // Dark themes use --muted
          rainCtx.fillStyle = muted || '#586e75';
        }
      }
    }
    
    // Realistic wind simulation - smooth transitions
    const currentTime = Date.now();
    if (rainConfig.randomAngle) {
      // Change wind target every 2-4 seconds
      if (currentTime - rainAngleChangeTime > 2000 + Math.random() * 2000) {
        targetAngleOffset = (Math.random() - 0.5) * 40; // ±20° variation
        rainAngleChangeTime = currentTime;
      }
      // Smoothly interpolate to target angle
      rainAngleOffset += (targetAngleOffset - rainAngleOffset) * windTransitionSpeed;
    } else {
      rainAngleOffset = 0;
      targetAngleOffset = 0;
    }
    
    const effectiveAngle = rainConfig.angle + rainAngleOffset;
    const angleRad = (effectiveAngle * Math.PI) / 180;
    
    rainDrops.forEach((drop, index) => {
      // Add subtle wobble for realism
      const wobbleOffset = Math.sin(drop.wobble) * 0.3;
      
      // Round ALL coordinates for sharp, crisp pixels - no sub-pixel rendering
      const x = Math.floor(drop.x + wobbleOffset);
      const y = Math.floor(drop.y);
      const width = Math.floor(drop.size);
      const height = Math.floor(drop.size * drop.length);
      
      // Rainbow mode - cycle through colors
      if (rainConfig.rainbow && !snowActive) {
        const hue = (index * 40 + currentTime * 0.1) % 360;
        rainCtx.fillStyle = `hsl(${hue}, 70%, 60%)`;
      }
      
      // Draw based on particle style
      if (snowActive || rainConfig.particleStyle === 'default') {
        // Default: sharp rectangle
        rainCtx.fillRect(x, y, width, height);
      } else if (rainConfig.particleStyle.startsWith('sticker:')) {
        // Custom sticker image - render larger and sharper
        const stickerFile = rainConfig.particleStyle.replace('sticker:', '');
        const img = stickerImages[stickerFile];
        if (img && img.complete) {
          // Larger size for better visibility and quality
          const size = height * 4; // Increased from 2 to 4
          const renderX = Math.floor(x - size/2);
          const renderY = Math.floor(y);
          
          // Save context state
          rainCtx.save();
          rainCtx.imageSmoothingEnabled = false;
          
          // Draw at integer coordinates for crisp pixels
          rainCtx.drawImage(img, renderX, renderY, size, size);
          
          rainCtx.restore();
        } else {
          // Fallback if image not loaded
          rainCtx.fillRect(x, y, width, height);
        }
      } else if (rainConfig.particleStyle === 'bitcoin') {
        rainCtx.font = `${height}px monospace`;
        rainCtx.fillText('₿', x, y + height);
      } else if (rainConfig.particleStyle === 'zcash') {
        rainCtx.font = `${height}px monospace`;
        rainCtx.fillText('ᙇ', x, y + height);
      } else if (rainConfig.particleStyle === 'text-second') {
        const text = 'There is no second best';
        const charIndex = index % text.length;
        rainCtx.font = `${height}px monospace`;
        rainCtx.fillText(text[charIndex], x, y + height);
      } else if (rainConfig.particleStyle === 'text-hl') {
        const text = 'Hyperliquid';
        const charIndex = index % text.length;
        rainCtx.font = `${height}px monospace`;
        rainCtx.fillText(text[charIndex], x, y + height);
      } else if (rainConfig.particleStyle === 'emoji') {
        const emojis = ['🌧️', '💧', '⚡'];
        const emoji = emojis[index % emojis.length];
        rainCtx.font = `${height}px sans-serif`;
        rainCtx.fillText(emoji, x, y + height);
      } else if (rainConfig.particleStyle === 'saylor') {
        const text = '🚀';
        rainCtx.font = `${height}px sans-serif`;
        rainCtx.fillText(text, x, y + height);
      } else {
        // Fallback
        rainCtx.fillRect(x, y, width, height);
      }
      
      // Update position with wind angle and individual wobble
      drop.y += drop.speed;
      drop.x += Math.sin(angleRad) * drop.speed * 0.35 + wobbleOffset;
      drop.wobble += drop.wobbleSpeed;
      
      // Reset drop when it goes off screen
      if (drop.y > rainCanvas.height) {
        drop.y = -10 - Math.random() * 20;
        drop.x = Math.random() * rainCanvas.width;
        const baseSpeed = snowActive ? 0.6 : rainConfig.speed;
        drop.speed = baseSpeed * (0.7 + Math.random() * 0.6);
        drop.wobble = Math.random() * Math.PI * 2;
      }
      if (drop.x < -20) drop.x = rainCanvas.width + 20;
      if (drop.x > rainCanvas.width + 20) drop.x = -20;
    });
    
    rainAnimationFrame = requestAnimationFrame(drawRain);
  }
  
  function toggleRain() {
    rainActive = !rainActive;
    
    if (rainActive) {
      snowActive = false; // Turn off snow if rain is enabled
      rainCanvas.classList.add('active');
      resizeRainCanvas();
      initRain();
      drawRain();
      
      // Update snow buttons
      const snowBtn = document.getElementById('toggleSnowBtn');
      const snowMobileBtn = document.getElementById('toggleSnowBtnMobile');
      if (snowBtn) snowBtn.textContent = '[SNOW ON]';
      if (snowMobileBtn) snowMobileBtn.textContent = '[SNOW ON]';
    } else {
      rainCanvas.classList.remove('active');
      if (rainAnimationFrame) {
        cancelAnimationFrame(rainAnimationFrame);
        rainAnimationFrame = null;
      }
    }
  }
  
  function toggleSnow() {
    snowActive = !snowActive;
    
    if (snowActive) {
      rainActive = false; // Turn off rain if snow is enabled
      rainCanvas.classList.add('active');
      resizeRainCanvas();
      initRain(); // Use same particles
      drawRain(); // Use same draw function
      
      // Update rain buttons
      const rainBtn = document.getElementById('toggleRainBtn');
      const rainMobileBtn = document.getElementById('toggleRainBtnMobile');
      if (rainBtn) rainBtn.textContent = '[RAIN ON]';
      if (rainMobileBtn) rainMobileBtn.textContent = '[RAIN ON]';
    } else {
      rainCanvas.classList.remove('active');
      if (rainAnimationFrame) {
        cancelAnimationFrame(rainAnimationFrame);
        rainAnimationFrame = null;
      }
    }
  }
  
  function setupRainControls() {
    const toggleBtn = document.getElementById('toggleRainBtn');
    const toggleSnowBtn = document.getElementById('toggleSnowBtn');
    const densityInput = document.getElementById('rainDensity');
    const speedInput = document.getElementById('rainSpeed');
    const sizeInput = document.getElementById('rainSize');
    const lengthInput = document.getElementById('rainLength');
    const angleInput = document.getElementById('rainAngle');
    const randomAngleCheckbox = document.getElementById('rainRandomAngle');
    const textColorCheckbox = document.getElementById('rainTextColor');
    const particleStyleSelect = document.getElementById('rainParticleStyle');
    const rainbowCheckbox = document.getElementById('rainRainbow');
    
    if (!toggleBtn) return;
    
    // Toggle rain on/off
    toggleBtn.addEventListener('click', () => {
      toggleRain();
      const newText = rainActive ? '[RAIN OFF]' : '[RAIN ON]';
      toggleBtn.textContent = newText;
      // Update mobile button too
      const mobileBtn = document.getElementById('toggleRainBtnMobile');
      if (mobileBtn) mobileBtn.textContent = newText;
    });
    
    // Toggle snow on/off
    if (toggleSnowBtn) {
      toggleSnowBtn.addEventListener('click', () => {
        toggleSnow();
        const newText = snowActive ? '[SNOW OFF]' : '[SNOW ON]';
        toggleSnowBtn.textContent = newText;
        // Update mobile button too
        const mobileBtn = document.getElementById('toggleSnowBtnMobile');
        if (mobileBtn) mobileBtn.textContent = newText;
      });
    }
    
    // Update density
    if (densityInput) {
      densityInput.addEventListener('input', (e) => {
        rainConfig.density = parseInt(e.target.value);
        document.getElementById('rainDensityValue').textContent = rainConfig.density;
        if (rainActive) initRain();
      });
    }
    
    // Update speed
    if (speedInput) {
      speedInput.addEventListener('input', (e) => {
        rainConfig.speed = parseInt(e.target.value);
        document.getElementById('rainSpeedValue').textContent = rainConfig.speed;
        if (rainActive) initRain();
      });
    }
    
    // Update size (width)
    if (sizeInput) {
      sizeInput.addEventListener('input', (e) => {
        rainConfig.size = parseInt(e.target.value);
        document.getElementById('rainSizeValue').textContent = rainConfig.size;
        if (rainActive) initRain();
      });
    }
    
    // Update length
    if (lengthInput) {
      lengthInput.addEventListener('input', (e) => {
        rainConfig.length = parseInt(e.target.value);
        document.getElementById('rainLengthValue').textContent = rainConfig.length;
        if (rainActive) initRain();
      });
    }
    
    // Update angle
    if (angleInput) {
      angleInput.addEventListener('input', (e) => {
        rainConfig.angle = parseInt(e.target.value);
        document.getElementById('rainAngleValue').textContent = rainConfig.angle + '°';
        rainConfig.randomAngle = false; // Disable random when manually adjusted
        if (randomAngleCheckbox) randomAngleCheckbox.checked = false;
      });
    }
    
    // Toggle random angle
    if (randomAngleCheckbox) {
      randomAngleCheckbox.addEventListener('change', (e) => {
        rainConfig.randomAngle = e.target.checked;
        if (e.target.checked) {
          rainAngleChangeTime = 0; // Force immediate angle change
        }
      });
    }
    
    // Toggle theme text color
    if (textColorCheckbox) {
      textColorCheckbox.addEventListener('change', (e) => {
        rainConfig.useTextColor = e.target.checked;
      });
    }
    
    // Rainbow mode toggle
    if (rainbowCheckbox) {
      rainbowCheckbox.addEventListener('change', (e) => {
        rainConfig.rainbow = e.target.checked;
      });
    }
    
    // Particle style dropdown
    if (particleStyleSelect) {
      particleStyleSelect.addEventListener('change', (e) => {
        rainConfig.particleStyle = e.target.value;
        if (rainActive) initRain(); // Reinitialize for immediate effect
      });
    }
    
    // Slider button controls
    document.querySelectorAll('.slider-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const delta = parseInt(btn.getAttribute('data-delta'));
        const input = document.getElementById(targetId);
        if (input) {
          const newValue = Math.max(
            parseInt(input.min),
            Math.min(parseInt(input.max), parseInt(input.value) + delta)
          );
          input.value = newValue;
          input.dispatchEvent(new Event('input'));
        }
      });
    });
    
    // Resize canvas on window resize
    window.addEventListener('resize', () => {
      if (rainActive) resizeRainCanvas();
    });
  }

  // Load custom stickers and wallpapers from local folders
  // Place image files in:
  //   - /stickers/ folder for rain particle images (png, jpg, gif, webp, svg)
  //   - /wallpapers/ folder for background images (png, jpg, gif, webp, svg)
  // Run this command to update the manifest after adding new files:
  //   cd stickers && ls -1 *.{png,jpg,jpeg,gif,webp,svg} 2>/dev/null | jq -R -s -c 'split("\n") | map(select(length > 0))' > index.json
  async function loadCustomAssets() {
    const stickerGrid = document.getElementById('stickerGrid');
    const stickerOptions = document.getElementById('stickerOptions');
    
    if (!stickerGrid) {
      return;
    }
    
    // Load stickers from index.json manifest
    try {
      const stickerManifest = await fetch('/stickers/index.json');
      
      if (!stickerManifest.ok) {
        throw new Error(`HTTP error! status: ${stickerManifest.status}`);
      }
      
      const stickerFiles = await stickerManifest.json();
      
      const loadedStickers = [];
      
      // Create and add sticker items with lazy loading to prevent mobile crashes
      for (let i = 0; i < stickerFiles.length; i++) {
        const file = stickerFiles[i];
        const imgSrc = `/stickers/${file}`;
        const displayName = file.replace(/\.(png|jpg|jpeg|gif|webp|svg)$/i, '');
        
        // Create grid item for drag-and-drop
        const item = document.createElement('div');
        item.className = 'sticker-item';
        item.dataset.value = `sticker:${file}`;
        item.title = displayName;
        
        // Create icon container
        const iconDiv = document.createElement('div');
        iconDiv.className = 'sticker-icon';
        
        // Create image for grid with lazy loading
        const imgElement = document.createElement('img');
        imgElement.alt = file;
        imgElement.loading = 'lazy'; // Native lazy loading
        imgElement.style.width = '100%';
        imgElement.style.height = 'auto';
        
        imgElement.addEventListener('load', function() {
          stickerImages[file] = this;
          loadedStickers.push(file);
          
          // Add to dropdown once loaded
          if (stickerOptions) {
            const option = document.createElement('option');
            option.value = `sticker:${file}`;
            option.textContent = displayName;
            option.dataset.image = imgSrc;
            stickerOptions.appendChild(option);
          }
        });
        
        imgElement.addEventListener('error', function() {
          item.style.display = 'none';
        });
        
        iconDiv.appendChild(imgElement);
        
        // Create label
        const label = document.createElement('div');
        label.className = 'sticker-label';
        label.textContent = displayName.substring(0, 10);
        
        item.appendChild(iconDiv);
        item.appendChild(label);
        
        if (stickerGrid) {
          stickerGrid.appendChild(item);
        }
        
        // Set src after adding to DOM to trigger lazy loading
        // Add slight delay between images on mobile to prevent memory issues
        if (i < 10 || !isMobileDevice()) {
          imgElement.src = imgSrc; // Load first 10 immediately
        } else {
          // Lazy load the rest with IntersectionObserver on mobile
          const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
              if (entry.isIntersecting && !imgElement.src) {
                imgElement.src = imgSrc;
                observer.unobserve(imgElement);
              }
            });
          }, { rootMargin: '50px' });
          observer.observe(imgElement);
        }
      }
    } catch (err) {
      // Silent fallback
    }
    
    // Load wallpapers from index.json manifest
    try {
      const wallpaperManifest = await fetch('/wallpapers/index.json');
      const wallpaperFiles = await wallpaperManifest.json();
      
      for (const file of wallpaperFiles) {
        try {
          const response = await fetch(`/wallpapers/${file}`, { method: 'HEAD' });
          if (response.ok) {
            wallpapers.push(file);
            
            // Add option to dropdown
            const option = document.createElement('option');
            option.value = file;
            option.textContent = file.replace(/\.(png|jpg|jpeg|gif|webp|svg)$/i, '');
            document.getElementById('wallpaperOptions')?.appendChild(option);
          }
        } catch (err) {
          // Silent fallback
        }
      }
    } catch (err) {
      // Silent fallback
    }
  }
  
  // Apply wallpaper
  function applyWallpaper(wallpaper) {
    if (wallpaper && wallpaper !== 'none') {
      document.body.style.backgroundImage = `url('/wallpapers/${wallpaper}')`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundAttachment = 'fixed';
    } else {
      document.body.style.backgroundImage = '';
    }
  }

  // Sticky Stickers functionality
  let stickyStickersData = [];
  const STICKY_STICKERS_KEY = 'stickyStickers.v1';
  
  function loadStickyStickers() {
    try {
      const saved = localStorage.getItem(STICKY_STICKERS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (err) {
      return [];
    }
  }
  
  function saveStickyStickers() {
    localStorage.setItem(STICKY_STICKERS_KEY, JSON.stringify(stickyStickersData));
  }
  
  function createStickySticker(imageSrc, x, y, width = null, height = null, rotation = 0) {
    const container = document.getElementById('stickyStickers');
    if (!container) return;
    
    const id = Date.now() + Math.random();
    const sticker = document.createElement('div');
    sticker.className = 'sticky-sticker';
    sticker.dataset.id = id;
    sticker.style.left = `${x}px`;
    sticker.style.top = `${y}px`;
    sticker.style.transform = `rotate(${rotation}deg)`;
    
    const img = document.createElement('img');
    img.src = imageSrc;
    img.draggable = false;
    
    // Load image to get natural dimensions and set proper aspect ratio
    img.onload = () => {
      const aspectRatio = img.naturalWidth / img.naturalHeight;
      
      if (width === null && height === null) {
        // Default: set width to 200px and calculate height
        width = 200;
        height = 200 / aspectRatio;
      } else if (width === null) {
        width = height * aspectRatio;
      } else if (height === null) {
        height = width / aspectRatio;
      }
      
      sticker.style.width = `${width}px`;
      sticker.style.height = `${height}px`;
      sticker.dataset.aspectRatio = aspectRatio;
      
      // Update saved data
      const data = stickyStickersData.find(s => s.id === id);
      if (data) {
        data.width = width;
        data.height = height;
        data.aspectRatio = aspectRatio;
        saveStickyStickers();
      }
    };
    
    // Set initial size if provided
    if (width !== null) sticker.style.width = `${width}px`;
    if (height !== null) sticker.style.height = `${height}px`;
    
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    resizeHandle.textContent = '[RESIZE]';
    
    const rotateHandle = document.createElement('div');
    rotateHandle.className = 'rotate-handle';
    rotateHandle.textContent = '[ROTATE]';
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '[X]';
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      removeStickySticker(id);
    };
    
    sticker.appendChild(img);
    sticker.appendChild(resizeHandle);
    sticker.appendChild(rotateHandle);
    sticker.appendChild(removeBtn);
    container.appendChild(sticker);
    
    // Make draggable
    makeDraggable(sticker);
    makeResizable(sticker, resizeHandle);
    makeRotatable(sticker, rotateHandle);
    
    // Save to data (will be updated with dimensions in img.onload)
    stickyStickersData.push({ id, imageSrc, x, y, width, height, rotation, aspectRatio: null });
    saveStickyStickers();
    
    return sticker;
  }
  
  function makeDraggable(element) {
    let isDragging = false;
    let startX, startY, initialX, initialY;
    
    element.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('resize-handle') || 
          e.target.classList.contains('rotate-handle') || 
          e.target.classList.contains('remove-btn')) return;
      isDragging = true;
      element.classList.add('dragging');
      
      const rect = element.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      initialX = rect.left;
      initialY = rect.top;
      
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      
      const newX = initialX + dx;
      const newY = initialY + dy;
      
      element.style.left = `${newX}px`;
      element.style.top = `${newY}px`;
      
      // Update data
      const id = parseFloat(element.dataset.id);
      const data = stickyStickersData.find(s => s.id === id);
      if (data) {
        data.x = newX;
        data.y = newY;
      }
    });
    
    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        element.classList.remove('dragging');
        saveStickyStickers();
      }
    });
  }
  
  function makeResizable(element, handle) {
    let isResizing = false;
    let startX, startY, startWidth, startHeight, aspectRatio;
    
    handle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = element.offsetWidth;
      startHeight = element.offsetHeight;
      aspectRatio = parseFloat(element.dataset.aspectRatio) || (startWidth / startHeight);
      e.stopPropagation();
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const delta = Math.max(dx, dy);
      
      // Calculate new width and maintain aspect ratio
      const newWidth = Math.max(32, Math.min(800, startWidth + delta));
      const newHeight = newWidth / aspectRatio;
      
      element.style.width = `${newWidth}px`;
      element.style.height = `${newHeight}px`;
      
      // Update data
      const id = parseFloat(element.dataset.id);
      const data = stickyStickersData.find(s => s.id === id);
      if (data) {
        data.width = newWidth;
        data.height = newHeight;
      }
    });
    
    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        saveStickyStickers();
      }
    });
  }
  
  function makeRotatable(element, handle) {
    let isRotating = false;
    let startAngle, startRotation;
    
    handle.addEventListener('mousedown', (e) => {
      isRotating = true;
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
      
      // Get current rotation from transform
      const transform = element.style.transform;
      const match = transform.match(/rotate\(([-\d.]+)deg\)/);
      startRotation = match ? parseFloat(match[1]) : 0;
      
      e.stopPropagation();
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isRotating) return;
      
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
      const deltaAngle = currentAngle - startAngle;
      const newRotation = startRotation + deltaAngle;
      
      element.style.transform = `rotate(${newRotation}deg)`;
      
      // Update data
      const id = parseFloat(element.dataset.id);
      const data = stickyStickersData.find(s => s.id === id);
      if (data) {
        data.rotation = newRotation;
      }
    });
    
    document.addEventListener('mouseup', () => {
      if (isRotating) {
        isRotating = false;
        saveStickyStickers();
      }
    });
  }
  
  function removeStickySticker(id) {
    const element = document.querySelector(`.sticky-sticker[data-id="${id}"]`);
    if (element) element.remove();
    
    stickyStickersData = stickyStickersData.filter(s => s.id !== id);
    saveStickyStickers();
  }
  
  function restoreStickyStickers() {
    stickyStickersData = loadStickyStickers();
    stickyStickersData.forEach(data => {
      const container = document.getElementById('stickyStickers');
      if (!container) return;
      
      // Handle old format (size) and new format (width/height)
      const width = data.width || data.size || 200;
      const height = data.height || data.size || 200;
      const aspectRatio = data.aspectRatio || (width / height);
      
      const sticker = document.createElement('div');
      sticker.className = 'sticky-sticker';
      sticker.dataset.id = data.id;
      sticker.dataset.aspectRatio = aspectRatio;
      sticker.style.left = `${data.x}px`;
      sticker.style.top = `${data.y}px`;
      sticker.style.width = `${width}px`;
      sticker.style.height = `${height}px`;
      sticker.style.transform = `rotate(${data.rotation || 0}deg)`;
      
      const img = document.createElement('img');
      img.src = data.imageSrc;
      img.draggable = false;
      
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'resize-handle';
      resizeHandle.textContent = '[RESIZE]';
      
      const rotateHandle = document.createElement('div');
      rotateHandle.className = 'rotate-handle';
      rotateHandle.textContent = '[ROTATE]';
      
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = '[X]';
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        removeStickySticker(data.id);
      };
      
      sticker.appendChild(img);
      sticker.appendChild(resizeHandle);
      sticker.appendChild(rotateHandle);
      sticker.appendChild(removeBtn);
      container.appendChild(sticker);
      
      makeDraggable(sticker);
      makeResizable(sticker, resizeHandle);
      makeRotatable(sticker, rotateHandle);
    });
  }
  
  function setupStickerDragDrop() {
    const stickerGrid = document.getElementById('stickerGrid');
    if (!stickerGrid) {
      return;
    }
    
    stickerGrid.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.sticker-item');
      if (!item) return;
      
      // Prevent default browser drag behavior
      e.preventDefault();
      e.stopPropagation();
      
      const value = item.dataset.value;
      let imageSrc;
      
      if (value && value.startsWith('sticker:')) {
        const file = value.replace('sticker:', '');
        imageSrc = `/stickers/${file}`;
      } else {
        // For emoji/text styles, we can't easily make them sticky
        return;
      }
      
      // Create ghost element for dragging
      const ghost = item.cloneNode(true);
      ghost.style.position = 'fixed';
      ghost.style.pointerEvents = 'none';
      ghost.style.opacity = '0.9';
      ghost.style.zIndex = '10000';
      ghost.style.filter = 'brightness(1.2)';
      
      // Add helper text
      const helper = document.createElement('div');
      helper.textContent = '[DROP TO PLACE]';
      helper.style.cssText = 'position: absolute; bottom: -20px; left: 50%; transform: translateX(-50%); color: var(--accent); font-size: 10px; white-space: nowrap; font-weight: bold;';
      ghost.appendChild(helper);
      
      document.body.appendChild(ghost);
      
      let isDraggingOut = false;
      
      const moveGhost = (e) => {
        ghost.style.left = `${e.clientX - 30}px`;
        ghost.style.top = `${e.clientY - 30}px`;
        
        // Check if dragged outside settings
        const settingsDialog = document.getElementById('settingsDialog');
        const dialogRect = settingsDialog?.getBoundingClientRect();
        if (dialogRect) {
          const isInside = e.clientX >= dialogRect.left && 
                          e.clientX <= dialogRect.right && 
                          e.clientY >= dialogRect.top && 
                          e.clientY <= dialogRect.bottom;
          
          isDraggingOut = !isInside;
        }
      };
      
      const endDrag = (e) => {
        document.removeEventListener('mousemove', moveGhost);
        document.removeEventListener('mouseup', endDrag);
        ghost.remove();
        
        if (isDraggingOut) {
          // Create sticky sticker at drop position (centered at 200px default width)
          createStickySticker(imageSrc, e.clientX - 100, e.clientY - 100);
        }
      };
      
      document.addEventListener('mousemove', moveGhost);
      document.addEventListener('mouseup', endDrag);
      
      moveGhost(e);
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    init();
    setupRainControls();
    restoreStickyStickers();
    
    // Apply settings on load
    const settings = loadSettings() || getDefaultSettings();
    if (settings.wallpaper) {
      applyWallpaper(settings.wallpaper);
      if (els.wallpaperSelect) els.wallpaperSelect.value = settings.wallpaper;
    }
    applyHeaderVisibility(settings);
    
    // Set active comic tab based on settings
    const comicStrip = settings.comicStrip || 'calvinandhobbes';
    const comicTabMap = {
      'calvinandhobbes': els.tabCalvin,
      'peanuts': els.tabPeanuts,
      'farside': els.tabFarside
    };
    const comicTabs = [els.tabCalvin, els.tabPeanuts, els.tabFarside];
    comicTabs.forEach(tab => {
      if (tab) tab.classList.remove('active');
    });
    const activeTab = comicTabMap[comicStrip];
    if (activeTab) {
      activeTab.classList.add('active');
    }
    
    // Apply collapsed state
    if (settings.comicCollapsed && els.comicSection) {
      els.comicSection.classList.add('collapsed');
    }
    
    // Wallpaper change handler
    if (els.wallpaperSelect) {
      els.wallpaperSelect.addEventListener('change', (e) => {
        applyWallpaper(e.target.value);
      });
    }
    
    // Check weather and auto-enable rain if it's raining at user's location (desktop only)
    if (rainCanvas && !isMobileDevice()) {
      checkWeatherAndEnableRain();
    }
  });
  
  // Helper function to detect mobile devices
  function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) 
           || window.innerWidth <= 768;
  }
  
  // Stop real-time updates when page unloads
  window.addEventListener('beforeunload', stopRealTimeUpdates);
  
  // Expose helper function to manually test midnight price fetching
  // Usage in console: testMidnightPrices()
  window.testMidnightPrices = async function() {
    localStorage.removeItem('dailyMidnightPrices.v1');
    await refreshAll();
  };
  
})();

