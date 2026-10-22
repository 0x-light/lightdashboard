// UI helper for composing the hero: one sentence (value, today, P&L, weather) and the allocation line.
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

// Unsigned: the sentence says "up" or "down". Two decimals only where one would read 0.0%.
function formatPercent(pct) {
  const abs = Math.abs(pct);
  return `${abs.toFixed(abs > 0 && abs < 0.1 ? 2 : 1)}%`;
}

// Whole units read better in prose than cents.
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

function weatherSentence(weather) {
  if (!weather) return '';
  const { temp, city, icon, moonText, precipitation } = weather;
  if (typeof temp !== 'number' || !city) return '';
  const rain = precipitation && precipitation > 0 ? ' with rain forecasted' : '';
  return `It's ${Math.round(temp)}°C ${icon} in <strong>${escapeHtml(city)}</strong>${rain}${moonText || ''}.`;
}

// "up $1,234 (1.0%) today" — percent only when amounts are hidden. `withDirection: false` lets
// a second clause drop a repeated "up"/"down".
function changeClause(amount, pct, suffix, { amountsVisible, currency, useColoredPnL, withDirection = true }) {
  const cls = classForChange(amount, useColoredPnL);
  const direction = amount >= 0 ? 'up' : 'down';
  const pctText = Number.isFinite(pct) ? formatPercent(pct) : '';
  const figure = amountsVisible
    ? `${formatCurrency(Math.abs(roundForProse(amount)), true, currency, { compact: false })}${pctText ? ` (${pctText})` : ''}`
    : pctText;
  return `${withDirection ? `${direction} ` : ''}<strong class="${cls}">${figure}</strong> ${suffix}`;
}

const isMeaningfulChange = (amount) => Number.isFinite(amount) && Math.abs(amount) >= 0.01;

// The hero is one conversational sentence: value, today's move and what drove it, then
// unrealized P&L ("…, up $1,234 (1.0%) today, mostly from BTC, and $939 (4.2%) on open positions.").
function composeSentence({ valueText, amountsVisible, totalPnL, totalPnLPercent, totalDailyChange, totalDailyChangePercent, topMover, weather, ...options }) {
  const toggle = `<strong class="hero-amount-toggle" role="button" tabindex="0" title="${amountsVisible ? 'Hide amounts' : 'Show amounts'}">${valueText}</strong>`;
  const hasToday = isMeaningfulChange(totalDailyChange);
  const hasOverall = isMeaningfulChange(totalPnL);
  const sameDirection = hasOverall && hasToday && (totalPnL >= 0) === (totalDailyChange >= 0);
  let changes = '';
  if (hasToday) {
    changes += `, ${changeClause(totalDailyChange, totalDailyChangePercent, 'today', { amountsVisible, ...options })}`;
    if (topMover?.label) changes += `, mostly from <strong>${escapeHtml(topMover.label)}</strong>`;
  }
  // Unrealized P&L: positions with a known entry price only, never realized gains.
  if (hasOverall) {
    const joiner = !hasToday ? ', ' : (sameDirection ? ', and ' : ', but ');
    changes += `${joiner}${changeClause(totalPnL, totalPnLPercent, 'on open positions', {
      amountsVisible,
      ...options,
      withDirection: !sameDirection
    })}`;
  }
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
  topMover, // { label, change } | null — the asset that made most of today's move
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
    ${composeSentence({ valueText, amountsVisible, totalPnL, totalPnLPercent, totalDailyChange, totalDailyChangePercent, topMover, weather, currency, useColoredPnL })}
    ${composeAllocation(allocation, { amountsVisible, currency })}
  `;
}

export default { composeSummary };
