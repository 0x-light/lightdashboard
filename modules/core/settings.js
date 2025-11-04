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
    return s;
  } catch (_) {
    return null;
  }
}

export function getDefaultSettings() {
  return {
    userName: 'there',
    usePythPrices: true,
    enableRealTimeUpdates: false,
    realTimeUpdateInterval: 10,
    minBalanceThreshold: 100
  };
}

export default { loadSettings, getDefaultSettings };


