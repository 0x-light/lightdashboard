// Settings loader compatible with legacy app storage/encryption
const STORAGE_KEY = 'myDashboardSettings.v1';
const ENCRYPT_PREFIX = 'enc:';

function simpleDecrypt(encoded) {
  if (!encoded) return encoded;
  if (typeof encoded === 'string' && encoded.startsWith(ENCRYPT_PREFIX)) {
    try {
      return decodeURIComponent(atob(encoded.substring(ENCRYPT_PREFIX.length)));
    } catch (_) {
      return '';
    }
  }
  return encoded;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s.walletAddresses) s.walletAddresses = simpleDecrypt(s.walletAddresses);
    if (s.alchemyApiKey) s.alchemyApiKey = simpleDecrypt(s.alchemyApiKey);
    if (s.heliusApiKey) s.heliusApiKey = simpleDecrypt(s.heliusApiKey);
    if (s.openSeaApiKey) s.openSeaApiKey = simpleDecrypt(s.openSeaApiKey);
    if (s.hyperliquidAddress) s.hyperliquidAddress = simpleDecrypt(s.hyperliquidAddress);
    if (s.lighterAddress) s.lighterAddress = simpleDecrypt(s.lighterAddress);
    if (s.zerionApiKey) s.zerionApiKey = simpleDecrypt(s.zerionApiKey);
    if (s.cieloApiKey) s.cieloApiKey = simpleDecrypt(s.cieloApiKey);

    // Merge with defaults to ensure new settings are included
    const defaults = getDefaultSettings();
    const merged = { ...defaults, ...s };

    return merged;
  } catch (_) {
    return null;
  }
}

export function getDefaultSettings() {
  return {
    theme: 'dark',
    refreshMinutes: 30,
    userName: '',
    cryptoPositions: [], // { type: 'pyth', symbol, feedId, amount, entryPrice } or { type: 'custom', name, value }
    weather: { label: '', lat: null, lon: null },
    walletAddresses: '',
    solanaAddresses: '',
    bitcoinAddresses: '',
    zcashAddresses: '',
    alchemyApiKey: '',
    heliusApiKey: '',
    openSeaApiKey: '',
    zerionApiKey: '',
    cieloApiKey: '',
    onchainProvider: 'zerion', // 'zerion' or 'cielo'
    font: 'berkeley',
    fontSize: 15,
    comicStrip: 'calvinandhobbes',
    hideComic: false,
    comicCollapsed: false, // Whether comic section is collapsed
    hideWatchlist: false,
    showRainForecast: true,
    useColoredPnL: true,
    leftAligned: true, // true = centered, false = left-aligned
    usePythPrices: true,
    minBalanceThreshold: 100,
    enableRealTimeUpdates: true,
    realTimeUpdateInterval: 5, // seconds
    heroPnLMode: 'total', // 'total' or '24h'
    hideSnowBtn: true,
    hideRainBtn: true,
    hideThemeBtn: false,
    hideAmountsBtn: false,
    hideFontSize: true,
    showCompactBtn: true,
    hideStickersBtn: true,
    hideDonateBtn: true,
    showSettingsBtn: true,
    hiddenAssets: [], // Array of hidden asset keys: "ASSET_EXCHANGE"
    rainEnabled: false,
    snowEnabled: false,
    rainSnowManuallySet: false, // Whether user has manually set rain/snow preference
    watchlist: [], // Array of Pyth price feed IDs
    watchlistCollapsed: false, // Whether watchlist section is collapsed
    compactList: false, // Whether to use compact list mode
    buttonBackgrounds: false, // Whether to add backgrounds to buttons
    showPriceChart: true // Whether to show 24h price chart column
  };
}

export default { loadSettings, getDefaultSettings };


