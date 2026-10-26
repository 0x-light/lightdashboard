export const SUPPORTED_BASE_CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP']);

const CURRENCY_SYMBOLS = Object.freeze({
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CHF: 'CHF ',
  CAD: 'C$',
  AUD: 'A$',
  NZD: 'NZ$',
  HKD: 'HK$',
  SGD: 'S$',
  GBp: ''
});

export function normalizeCurrencyCode(value, fallback = 'USD') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (raw === 'GBp' || raw.toLowerCase() === 'gbpence') return 'GBp';
  const upper = raw.toUpperCase();
  return /^[A-Z]{3,5}$/.test(upper) ? upper : fallback;
}

export function normalizeBaseCurrency(value) {
  const currency = normalizeCurrencyCode(value, 'USD');
  return SUPPORTED_BASE_CURRENCIES.includes(currency) ? currency : 'USD';
}

export function getFxCurrency(currency) {
  const normalized = normalizeCurrencyCode(currency);
  return normalized === 'GBp' ? 'GBP' : normalized;
}

export function getQuoteUnitScale(currency) {
  return normalizeCurrencyCode(currency) === 'GBp' ? 0.01 : 1;
}

export function formatMoney(value, {
  currency = 'USD',
  visible = true,
  compact = true,
  showPlusSign = false
} = {}) {
  const normalized = normalizeCurrencyCode(currency);
  const symbol = Object.prototype.hasOwnProperty.call(CURRENCY_SYMBOLS, normalized)
    ? CURRENCY_SYMBOLS[normalized]
    : `${normalized} `;
  if (!visible) return `${symbol}••••`;

  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '—';

  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : (showPlusSign && n > 0 ? '+' : '');
  const suffix = normalized === 'GBp' ? ' GBp' : '';

  // Compact amounts always keep one decimal, so a column reads $7.0M over $7.4M, not $7M.
  if (compact && abs >= 1e9) return `${sign}${symbol}${(abs / 1e9).toFixed(1)}B${suffix}`;
  if (compact && abs >= 1e6) return `${sign}${symbol}${(abs / 1e6).toFixed(1)}M${suffix}`;
  if (compact && abs >= 1e3) return `${sign}${symbol}${(abs / 1e3).toFixed(1)}k${suffix}`;
  if (abs >= 1) {
    const formatted = abs.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).replace(/\.00$/, '');
    return `${sign}${symbol}${formatted}${suffix}`;
  }
  if (abs === 0) return `${symbol}0${suffix}`;
  return `${sign}${symbol}${small(abs)}${suffix}`;
}

// Under 1: four significant digits, written out ($0.0000001, not $1.000e-7).
function small(abs) {
  return abs.toLocaleString('en-US', { maximumSignificantDigits: 4, maximumFractionDigits: 20 });
}

// Index levels, yields and FX rates are numbers, not prices: no currency symbol.
export function formatLevel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const digits = abs < 10 ? 4 : 2;
  return `${n < 0 ? '−' : ''}${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;
}

export function formatPrice(value, {
  currency = 'USD',
  visible = true
} = {}) {
  return formatMoney(value, {
    currency,
    visible,
    compact: false
  });
}
