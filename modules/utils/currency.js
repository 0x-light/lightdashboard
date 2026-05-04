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

  if (compact && abs >= 1000000) {
    const formatted = (abs / 1000000).toFixed(1).replace(/\.0$/, '');
    return `${sign}${symbol}${formatted}M${suffix}`;
  }
  if (compact && abs >= 1000) {
    const formatted = (abs / 1000).toFixed(1).replace(/\.0$/, '');
    return `${sign}${symbol}${formatted}k${suffix}`;
  }
  if (abs >= 1) {
    const formatted = abs.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).replace(/\.00$/, '');
    return `${sign}${symbol}${formatted}${suffix}`;
  }
  if (abs === 0) return `${symbol}0${suffix}`;
  return `${sign}${symbol}${abs.toPrecision(4)}${suffix}`;
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
