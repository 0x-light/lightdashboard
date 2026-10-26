// UI helper for composing the hero: a row of label-over-figure columns (value, today, P&L, weather) and the allocation line.
import { formatMoney, normalizeBaseCurrency } from '../utils/currency.js';

function formatCurrency(value, amountsVisible, currency, options = {}) {
  return formatMoney(value, {
    currency,
    visible: amountsVisible,
    compact: true,
    ...options
  });
}

function classForChange(value, useColored) {
  if (!useColored) return value >= 0 ? 'positive-neutral' : 'negative-neutral';
  return value >= 0 ? 'positive-pnl' : 'negative-pnl';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// Unsigned magnitude. Two decimals only where one would read 0.0%.
function formatPercent(pct) {
  const abs = Math.abs(pct);
  return `${abs.toFixed(abs > 0 && abs < 0.1 ? 2 : 1)}%`;
}

// Whole units read better than cents at this size.
const roundForProse = (amount) => (Math.abs(amount) >= 100 ? Math.round(amount) : amount);

// Allocation line. Slices are shades of the text colour, so it reads in every theme without
// needing a categorical palette.
function composeAllocation(allocation, { amountsVisible, currency }) {
  if (!Array.isArray(allocation) || allocation.length < 2) return '';
  const bar = allocation.map((slice, i) => {
    const pct = (slice.share * 100).toFixed(2);
    const title = `${slice.label} ${(slice.share * 100).toFixed(1)}%`;
    return `<span class="alloc-seg alloc-fill-${slice.isOther ? 'other' : i}" style="flex-grow: ${pct}" title="${escapeHtml(title)}"></span>`;
  }).join('');
  const legend = allocation.map((slice, i) => {
    const share = slice.share * 100;
    const shareText = share >= 10 ? share.toFixed(0) : share.toFixed(1);
    const valueText = amountsVisible ? ` <span class="alloc-value">${formatCurrency(slice.value, true, currency)}</span>` : '';
    return `<li><span class="alloc-swatch alloc-fill-${slice.isOther ? 'other' : i}" aria-hidden="true"></span><span class="alloc-label">${escapeHtml(slice.label)}</span> <span class="alloc-share">${shareText}%</span>${valueText}</li>`;
  }).join('');
  return `<div class="alloc"><div class="alloc-bar" role="img" aria-label="Allocation">${bar}</div><ul class="alloc-legend">${legend}</ul></div>`;
}

// "Lisbon" over "21°C ☀" — the same label-over-figure shape as the money columns.
function weatherItem(weather) {
  if (!weather) return '';
  const { temp, city, icon, moonText, precipitation } = weather;
  if (typeof temp !== 'number' || !city) return '';
  const rain = precipitation && precipitation > 0 ? ' rain' : '';
  return readoutColumn(escapeHtml(city), `${Math.round(temp)}°C ${icon}${rain}${moonText || ''}`, 'hero-sentence-weather');
}

// Signed, so the figure carries its own direction: "−2.6%".
function formatSignedPercent(pct) {
  const sign = pct < 0 ? '−' : (pct > 0 ? '+' : '');
  return `${sign}${formatPercent(pct)}`;
}

const readoutColumn = (label, figureHtml, cls = '') =>
  `<div class="hero-readout-item${cls ? ` ${cls}` : ''}"><span class="hero-readout-label">${label}</span>${figureHtml}</div>`;

// "−$4,720 −2.6%" — percent only when amounts are hidden.
function changeColumn(label, amount, pct, { amountsVisible, currency, useColoredPnL }) {
  const cls = classForChange(amount, useColoredPnL);
  const pctText = Number.isFinite(pct) ? formatSignedPercent(pct) : '';
  const money = amountsVisible
    ? formatCurrency(roundForProse(amount), true, currency, { compact: false, showPlusSign: true })
    : '';
  const figure = [money, pctText].filter(Boolean).join(' ');
  return readoutColumn(label, `<strong class="${cls}">${figure}</strong>`);
}

const isMeaningfulChange = (amount) => Number.isFinite(amount) && Math.abs(amount) >= 0.01;

// The hero is a row of columns, label over figure: value, today's move, unrealized P&L.
function composeSentence({ valueText, amountsVisible, totalPnL, totalPnLPercent, totalDailyChange, totalDailyChangePercent, weather, ...options }) {
  const toggle = `<strong class="hero-amount-toggle" role="button" tabindex="0" title="${amountsVisible ? 'Hide amounts' : 'Show amounts'}">${valueText}</strong>`;
  const columns = [readoutColumn('Value', toggle)];
  if (isMeaningfulChange(totalDailyChange)) {
    columns.push(changeColumn('Today', totalDailyChange, totalDailyChangePercent, { amountsVisible, ...options }));
  }
  // Unrealized P&L: positions with a known entry price only, never realized gains.
  if (isMeaningfulChange(totalPnL)) {
    columns.push(changeColumn('Open P/L', totalPnL, totalPnLPercent, { amountsVisible, ...options }));
  }
  columns.push(weatherItem(weather));
  return `<div class="hero-sentence hero-readout">${columns.join('')}</div>`;
}

// Said in the panel's title line when a source is offline or a position has no price: "Lighter offline".
// It sits in the title line so it never adds height. Old data alone says nothing here.
// freshness: { offline: string[], oldestAt: number|null, stale: boolean } (summarizeFreshness).
export function freshnessNote(freshness) {
  if (!freshness?.stale) return '';
  const parts = [];
  if (freshness.offline?.length) parts.push(`${freshness.offline.join(', ')} offline`);
  if (freshness.unpriced?.length) parts.push(`no price for ${freshness.unpriced.join(', ')}`);
  if (parts.length === 0) return '';
  // The line can be cut short on a phone; the tooltip says all of it.
  const text = parts.join(' · ');
  const title = freshness.oldestAt
    ? `${text} · oldest figure: ${new Date(freshness.oldestAt).toLocaleString(undefined, { timeZone: globalThis.window?.larpTimeZone })}`
    : text;
  return `<span class="panel-note" title="${escapeHtml(title)}">${escapeHtml(text)}</span>`;
}

export function composeSummary({
  portfolioValue,
  amountsVisible,
  heroPnLMode, // kept for callers; the readout always shows both overall and today
  totalPnL,
  totalPnLPercent,
  totalDailyChange,
  totalDailyChangePercent,
  baseCurrency,
  useColoredPnL,
  allocation, // [{ label, value, share, isOther? }]
  highlightsHtml, // array of already-escaped HTML strings
  weather // { temp, city, icon, moonText } | null
}) {
  const currency = normalizeBaseCurrency(baseCurrency);
  // The total shows the full figure; compact notation is for the dense table cells.
  const valueText = formatCurrency(roundForProse(portfolioValue), amountsVisible, currency, { compact: false });

  return `
    ${composeSentence({ valueText, amountsVisible, totalPnL, totalPnLPercent, totalDailyChange, totalDailyChangePercent, weather, currency, useColoredPnL })}
    ${composeAllocation(allocation, { amountsVisible, currency })}
  `;
}

export default { composeSummary, freshnessNote };
