// UI helper for composing the hero: one sentence (value, P&L, today, weather) and the allocation line.
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

function formatPercent(pct) {
  const sign = pct > 0 ? '+' : (pct < 0 ? '−' : '');
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

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

function weatherSentence(weather) {
  if (!weather) return '';
  const { temp, city, icon, moonText, precipitation } = weather;
  if (typeof temp !== 'number' || !city) return '';
  const rain = precipitation && precipitation > 0 ? ' with rain forecasted' : '';
  return `It's ${Math.round(temp)}°C ${icon} in <strong>${escapeHtml(city)}</strong>${rain}${moonText || ''}.`;
}

// "up $939 (+1.01%) on open positions" — percent only when amounts are hidden. Whole units read better in
// prose than cents; `withDirection: false` lets a second clause drop a repeated "up"/"down".
function changeClause(amount, pct, suffix, { amountsVisible, currency, useColoredPnL, withDirection = true }) {
  const cls = classForChange(amount, useColoredPnL);
  const direction = amount >= 0 ? 'up' : 'down';
  const pctText = Number.isFinite(pct) ? formatPercent(pct) : '';
  const rounded = Math.abs(amount) >= 100 ? Math.round(Math.abs(amount)) : Math.abs(amount);
  const figure = amountsVisible
    ? `${formatCurrency(rounded, true, currency, { compact: false })}${pctText ? ` (${pctText})` : ''}`
    : pctText.replace(/^[+−]/, '');
  return `${withDirection ? `${direction} ` : ''}<strong class="${cls}">${figure}</strong> ${suffix}`;
}

const isMeaningfulChange = (amount) => Number.isFinite(amount) && Math.abs(amount) >= 0.01;

// The hero is one conversational sentence.
function composeSentence({ valueText, amountsVisible, totalPnL, totalPnLPercent, totalDailyChange, totalDailyChangePercent, weather, ...options }) {
  const toggle = `<strong class="hero-amount-toggle" role="button" tabindex="0" title="${amountsVisible ? 'Hide amounts' : 'Show amounts'}">${valueText}</strong>`;
  const hasOverall = isMeaningfulChange(totalPnL);
  const hasToday = isMeaningfulChange(totalDailyChange);
  const sameDirection = hasOverall && hasToday && (totalPnL >= 0) === (totalDailyChange >= 0);
  const clauses = [];
  // Unrealized P&L: positions with a known entry price only, never realized gains.
  if (hasOverall) clauses.push(changeClause(totalPnL, totalPnLPercent, 'on open positions', { amountsVisible, ...options }));
  if (hasToday) {
    clauses.push(changeClause(totalDailyChange, totalDailyChangePercent, 'today', {
      amountsVisible,
      ...options,
      withDirection: !sameDirection
    }));
  }
  const changes = clauses.length > 0 ? `, ${clauses.join(' and ')}` : '';
  const weatherText = weatherSentence(weather);
  return `<p class="hero-sentence">Your portfolio is worth ${toggle}${changes}.${weatherText ? ` <span class="hero-sentence-weather">${weatherText}</span>` : ''}</p>`;
}

export function composeSummary({
  portfolioValue,
  amountsVisible,
  heroPnLMode, // kept for callers; the sentence always reads both overall and today
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
  const valueText = formatCurrency(portfolioValue, amountsVisible, currency, { compact: false });

  return `
    ${composeSentence({ valueText, amountsVisible, totalPnL, totalPnLPercent, totalDailyChange, totalDailyChangePercent, weather, currency, useColoredPnL })}
    ${composeAllocation(allocation, { amountsVisible, currency })}
  `;
}

export default { composeSummary };
