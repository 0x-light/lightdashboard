// Settings loader compatible with legacy app storage/encryption
const STORAGE_KEY = 'myDashboardSettings.v2';
const LEGACY_KEY = 'myDashboardSettings.v1';
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

// Keys that get reset to new defaults during v1→v2 migration
const V2_RESET_KEYS = [
  'fontSize', 'hideSnowBtn', 'hideRainBtn', 'hideStickersBtn'
];

// Settings that no longer do anything; dropped on load so they stop riding along in exports
const REMOVED_KEYS = [
  'refreshMinutes', 'usePythPrices', 'enableRealTimeUpdates', 'realTimeUpdateInterval',
  'showCompactBtn', 'showSettingsBtn', 'compactList', 'buttonBackgrounds', 'hideThemeBtn',
  'hideAmountsBtn', 'hideFontSize', 'onchainProvider', 'comicCollapsed', 'watchlistCollapsed',
  'enableKeyboardShortcuts', 'openSeaApiKey', 'hideDonateBtn'
];

export function loadSettings() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);

    // Migrate from v1 if v2 doesn't exist yet
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const old = JSON.parse(legacy);
        // Drop cosmetic keys so new defaults take over
        V2_RESET_KEYS.forEach(k => delete old[k]);
        const defaults = getDefaultSettings();
        const migrated = { ...defaults, ...old };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        localStorage.removeItem(LEGACY_KEY);
        raw = localStorage.getItem(STORAGE_KEY);
      }
    }

    if (!raw) return null;
    const s = JSON.parse(raw);
    REMOVED_KEYS.forEach(k => delete s[k]);
    if (s.walletAddresses) s.walletAddresses = simpleDecrypt(s.walletAddresses);
    if (s.alchemyApiKey) s.alchemyApiKey = simpleDecrypt(s.alchemyApiKey);
    if (s.heliusApiKey) s.heliusApiKey = simpleDecrypt(s.heliusApiKey);
    if (s.hyperliquidAddress) s.hyperliquidAddress = simpleDecrypt(s.hyperliquidAddress);
    if (s.lighterAddress) s.lighterAddress = simpleDecrypt(s.lighterAddress);
    if (s.zerionApiKey) s.zerionApiKey = simpleDecrypt(s.zerionApiKey);
    if (s.cieloApiKey) s.cieloApiKey = simpleDecrypt(s.cieloApiKey);

    // Columns still in an old default order with none hidden were never changed:
    // drop them so the current defaults apply.
    const oldOrders = [
      ['asset', 'price', 'pnl', 'change', 'chart', 'value', 'funding', 'expiry', 'underlying', 'amount', 'exchange'],
      ['asset', 'price', 'chart', 'value', 'pnl', 'funding', 'change', 'expiry', 'underlying', 'amount', 'exchange']
    ];
    const cols = s.positionColumns;
    const untouched = !Array.isArray(cols) || oldOrders.some(oldOrder =>
      cols.every((k, i) => oldOrder.indexOf(k) > (i ? oldOrder.indexOf(cols[i - 1]) : -1)));
    if (untouched && !(s.hiddenPositionColumns || []).length) {
      delete s.positionColumns;
      delete s.hiddenPositionColumns;
    }

    // A short-lived build moved 24h % into the price cell and hid its column; show it again.
    if (s.changeInPriceCell) {
      const stored = JSON.parse(raw);
      delete stored.changeInPriceCell;
      delete s.changeInPriceCell;
      if (Array.isArray(s.hiddenPositionColumns)) {
        s.hiddenPositionColumns = s.hiddenPositionColumns.filter(k => k !== 'change');
        stored.hiddenPositionColumns = s.hiddenPositionColumns;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    }

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
    userName: '',
    cryptoPositions: [], // { type: 'pyth', symbol, feedId, amount, entryPrice } or { type: 'custom', name, value }
    weather: { label: '', lat: null, lon: null },
    walletAddresses: '',
    solanaAddresses: '',
    bitcoinAddresses: '',
    zcashAddresses: '',
    unrecognizedAddresses: '', // Pasted addresses no chain pattern matched; kept so they aren't lost
    alchemyApiKey: '',
    heliusApiKey: '',
    zerionApiKey: '',
    cieloApiKey: '',
    ibkrFlexToken: '', // Interactive Brokers Flex Web Service token (read-only)
    ibkrFlexQueryId: '', // ID of the Activity Flex Query with Open Positions
    font: 'sf',
    fontSize: 14,
    fullWidth: false, // Content column fills the window instead of stopping at a reading width
    centerLayout: false, // Content column sits in the middle of the window instead of on the left
    valueInTitle: true, // Portfolio value and today's change in the browser tab title
    showValueChart: true, // portfolio value chart in the portfolio card
    comicStrip: 'calvinandhobbes',
    hideComic: false,
    hideWatchlist: false,
    showExactAmounts: false,
    showRainForecast: true,
    useColoredPnL: true,
    portfolioBaseCurrency: 'USD',
    minBalanceThreshold: 100,
    heroPnLMode: 'total', // 'total' or '24h'
    hideSnowBtn: true,
    hideRainBtn: true,
    hideStickersBtn: true,
    hiddenAssets: [], // Array of hidden asset keys: "ASSET_EXCHANGE"
    rainEnabled: false,
    snowEnabled: false,
    rainSnowManuallySet: false, // Whether user has manually set rain/snow preference
    watchlist: [], // Array of Pyth price feed IDs
    showPriceChart: true, // Whether to show 24h price chart column
    groupPositions: true, // Positions in runs: spot, perps, options; off for one list
    combineOptionLegs: true, // Several option legs on one name as one row that opens to them
    positionColumns: ['asset', 'price', 'pnl', 'chart', 'value', 'funding', 'change', 'expiry', 'underlying', 'amount', 'exchange'], // Table column order
    hiddenPositionColumns: ['expiry', 'underlying', 'amount', 'exchange'] // Table columns switched off in Settings
  };
}

export default { loadSettings, getDefaultSettings };
