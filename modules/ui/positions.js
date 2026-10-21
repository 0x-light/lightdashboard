// Positions UI module (incremental extraction)
// This module progressively takes over rendering of desktop table and mobile cards.
import { manualTypeFromExchange } from '../features/manual-positions.js';
import {
  formatMoney,
  formatPrice as formatCurrencyPrice,
  normalizeBaseCurrency,
  normalizeCurrencyCode
} from '../utils/currency.js';

const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'BUSD']);

function isStablecoin(asset) {
  return STABLECOINS.has(asset?.toUpperCase());
}

// Custom mouse-tracking tooltip for funding rates
let fundingTooltipEl = null;
let activeTooltipCell = null; // Track which cell has active tooltip

function initFundingTooltip() {
  if (fundingTooltipEl) return;
  fundingTooltipEl = document.createElement('div');
  fundingTooltipEl.className = 'funding-rate-tooltip';
  document.body.appendChild(fundingTooltipEl);

  // Click anywhere to dismiss tooltip (for mobile)
  document.addEventListener('click', (e) => {
    // If clicking on the active tooltip cell, toggle off
    // If clicking elsewhere, hide tooltip
    if (activeTooltipCell && !activeTooltipCell.contains(e.target)) {
      hideFundingTooltip();
    }
  }, true);

  // Also hide on scroll
  document.addEventListener('scroll', hideFundingTooltip, true);
}

function showFundingTooltip(e, text) {
  if (!fundingTooltipEl) initFundingTooltip();
  fundingTooltipEl.textContent = text;
  fundingTooltipEl.classList.add('visible');
  activeTooltipCell = e.currentTarget;
  updateTooltipPosition(e);
}

function showFundingTooltipAt(cell, text) {
  if (!fundingTooltipEl) initFundingTooltip();
  fundingTooltipEl.textContent = text;
  fundingTooltipEl.classList.add('visible');
  activeTooltipCell = cell;
  const rect = cell.getBoundingClientRect();
  fundingTooltipEl.style.left = `${rect.left}px`;
  fundingTooltipEl.style.top = `${rect.bottom + 4}px`;
}

function escapeAttr(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function isManualPosition(pos) {
  return pos.isManual || (typeof pos.exchange === 'string' && pos.exchange.startsWith('Manual'));
}

// A position's actions, shown in the detail line under an open row (and on phone cards).
// Manual positions can be edited or deleted; the rest can be hidden or shown again.
// The handler in app.js keys off the class names, data attributes and data-shortcut.
function rowActionsHtml(pos, assetKey) {
  const name = escapeAttr(pos.asset);
  const action = (cls, attrs, shortcut, glyph, label) =>
    `<button type="button" class="row-action ${cls}" ${attrs} data-shortcut="${shortcut}" aria-label="${label} ${name}">` +
    `<kbd>${glyph}</kbd><span>${label}</span></button>`;
  if (isManualPosition(pos)) {
    const manualType = pos.manualType || (pos.exchange ? manualTypeFromExchange(pos.exchange) : '');
    const attrs = `data-asset="${name}"${manualType ? ` data-manual-type="${manualType}"` : ''}`;
    return action('position-manual-edit-btn', attrs, 'e', 'E', 'Edit') +
      action('position-delete-btn', attrs, 'delete', '⌫', 'Delete');
  }
  const keyAttr = `data-asset-key="${escapeAttr(assetKey)}"`;
  return pos.isManuallyHidden
    ? action('position-restore-btn', keyAttr, 'h', 'H', 'Show')
    : action('position-edit-btn', keyAttr, 'h', 'H', 'Hide');
}

// A perp's price ladder: liquidation, entry, now, and its TP/SL and nearest limit
// orders on one scale, with a legend of prices and distances from now. Orders come
// from window.hlOrders (fetched by app.js when the row opens); `null` means loading.
const LADDER_NAMES = {
  liq: 'Liquidation', entry: 'Entry', now: 'Now', tp: 'Take profit', sl: 'Stop loss',
  buy: 'Buy limit', sell: 'Sell limit'
};
const LADDER_KEYS = { liq: 'L', entry: 'E', now: '▼', tp: 'T', sl: 'S', buy: '·', sell: '·' };

function ladderHtml(pos, quoteCurrency) {
  const now = Number(pos.price);
  if (!(now > 0)) return '';
  const orders = typeof window !== 'undefined' ? window.hlOrders?.[pos.asset] : undefined;
  const loading = typeof window !== 'undefined' && window.hlOrdersState === 'loading';
  const levels = [{ kind: 'now', px: now }];
  if (Number(pos.entryPrice) > 0) levels.push({ kind: 'entry', px: Number(pos.entryPrice) });
  const triggers = (orders || []).filter(o => o.kind === 'tp' || o.kind === 'sl');
  levels.push(...triggers.map(o => ({ kind: o.kind, px: o.px, sz: o.sz, whole: o.wholePosition })));
  // Of the resting limits, only the nearest on each side; the legend gives the count.
  const limits = (orders || []).filter(o => o.kind === 'buy' || o.kind === 'sell');
  const nearest = (kind, cmp) => limits.filter(o => o.kind === kind && cmp(o.px)).sort((a, b) => Math.abs(a.px - now) - Math.abs(b.px - now))[0];
  const nearBuy = nearest('buy', px => px <= now);
  const nearSell = nearest('sell', px => px >= now);
  if (nearBuy) levels.push({ kind: 'buy', px: nearBuy.px, count: limits.filter(o => o.kind === 'buy').length });
  if (nearSell) levels.push({ kind: 'sell', px: nearSell.px, count: limits.filter(o => o.kind === 'sell').length });
  const liq = Number(pos.liquidationPx) > 0 ? Number(pos.liquidationPx) : null;

  // Scale: fit the levels around now; liquidation joins it unless it's far away, then it
  // sits at the edge with an arrow so the near levels stay readable.
  let lo = Math.min(...levels.map(l => l.px));
  let hi = Math.max(...levels.map(l => l.px));
  const span = Math.max(hi - lo, now * 0.02);
  let liqOff = null;
  if (liq) {
    if (liq > hi + span * 3) liqOff = 'right';
    else if (liq < lo - span * 3) liqOff = 'left';
    else { lo = Math.min(lo, liq); hi = Math.max(hi, liq); }
  }
  const pad = Math.max(hi - lo, now * 0.02) * 0.08;
  lo -= pad;
  hi += pad;
  const at = px => Math.max(0, Math.min(100, ((px - lo) / (hi - lo)) * 100));
  const marks = [...levels];
  if (liq) marks.push({ kind: 'liq', px: liq, off: liqOff });

  const isShort = Number(pos.amount) < 0;
  // The liquidated side: below liquidation for a long, above it for a short.
  let zone = '';
  if (liq) {
    const x = liqOff === 'right' ? 100 : liqOff === 'left' ? 0 : at(liq);
    zone = isShort
      ? `<span class="ladder__zone" style="left:${x}%;right:0"></span>`
      : `<span class="ladder__zone" style="left:0;right:${100 - x}%"></span>`;
  }
  // Letters sit above the track on rows: a letter too close to the one before it moves
  // up a row, and its stem runs from just under it down to the track.
  const placed = marks
    .map(m => ({ ...m, x: m.off === 'right' ? 100 : m.off === 'left' ? 0 : at(m.px) }))
    .sort((a, b) => a.x - b.x);
  const rowEnds = [];
  for (const m of placed) {
    let row = rowEnds.findIndex(end => m.x - end >= 5);
    if (row === -1) row = rowEnds.length;
    rowEnds[row] = m.x;
    m.row = row;
  }
  const rows = Math.max(1, rowEnds.length);
  const markHtml = placed.map(m => {
    const glyph = m.off === 'right' ? 'L→' : m.off === 'left' ? '←L' : LADDER_KEYS[m.kind];
    const top = rows - 1 - m.row; // row 0 sits lowest, next to the track
    return `<span class="ladder__mark ladder__mark--${m.kind}" style="left:${m.x}%;top:calc(var(--pm-lh) * ${top})">${glyph}</span>` +
      `<span class="ladder__tick ladder__tick--${m.kind}" style="left:${m.x}%;top:calc(var(--pm-lh) * ${top + 1})"></span>`;
  }).join('');

  const pct = px => {
    const d = ((px - now) / now) * 100;
    return `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(Math.abs(d) < 10 ? 2 : 1)}%`;
  };
  const legend = marks
    .slice()
    .sort((a, b) => b.px - a.px)
    .map(m => {
      const name = m.kind === 'buy' || m.kind === 'sell'
        ? `${LADDER_NAMES[m.kind]}${m.count > 1 ? ` (nearest of ${m.count})` : ''}`
        : LADDER_NAMES[m.kind] + ((m.kind === 'tp' || m.kind === 'sl') && m.whole ? ' (whole position)' : '');
      const dist = m.kind === 'now' ? '' : pct(m.px);
      return `<li class="ladder__row ladder__row--${m.kind}"><span class="ladder__key">${LADDER_KEYS[m.kind]}</span>` +
        `<span class="ladder__name">${name}</span><span class="ladder__px">${formatPrice(m.px, true, quoteCurrency)}</span>` +
        `<span class="ladder__dist">${dist}</span></li>`;
    }).join('');
  const status = loading && !orders
    ? '<p class="ladder__note">Loading orders…</p>'
    : (orders && !triggers.length && !limits.length ? '<p class="ladder__note">No open orders.</p>' : '');
  const label = `Price levels for ${escapeAttr(pos.asset)} ${isShort ? 'short' : 'long'}` +
    (liq ? `, liquidation ${pct(liq)} from now` : ', no liquidation price');
  return `<div class="ladder" role="img" aria-label="${label}" style="--rows:${rows}"><div class="ladder__marks">${markHtml}</div>` +
    `<div class="ladder__track">${zone}</div></div><ul class="ladder__legend">${legend}</ul>${status}`;
}

// The line that opens under a row: what the row can't fit, then its actions.
function createDetailRow(doc, pos, opts, colSpan) {
  const amountVisible = !!opts.amountsVisible;
  const showExactAmounts = opts.settings?.showExactAmounts ?? false;
  const baseCurrency = normalizeBaseCurrency(opts.settings?.portfolioBaseCurrency);
  const quoteCurrency = normalizeCurrencyCode(pos.currency || pos.sourceCurrency || baseCurrency, baseCurrency);
  const facts = [
    `${formatAmount(pos.amount, amountVisible, showExactAmounts)} ${escapeAttr(pos.asset)}`,
    escapeAttr(pos.exchange || '')
  ];
  if (Number(pos.entryPrice) > 0) {
    const entry = `entry ${formatPrice(Number(pos.entryPrice), true, quoteCurrency)}`;
    facts.push(pos.entryDate ? `${entry} on ${escapeAttr(pos.entryDate)}` : entry);
  }
  // Perps: leverage, and how far the price can move before liquidation.
  if (Number(pos.leverage) > 0) {
    facts.push(`${pos.leverage}× ${escapeAttr(pos.leverageType || '')}`.trim());
  }
  // Cross margin can leave no liquidation price: the account covers it.
  if (pos.isLeveraged && !(Number(pos.liquidationPx) > 0)) facts.push('no liquidation price');
  if (pos.staking) {
    facts.length = 0;
    facts.push(`${formatAmount(pos.staking.staked, amountVisible, showExactAmounts)} staked`);
    if (pos.staking.unstaked > 0) facts.push(`${formatAmount(pos.staking.unstaked, amountVisible, showExactAmounts)} not staked`);
    if (pos.staking.withdrawing > 0) facts.push(`${formatAmount(pos.staking.withdrawing, amountVisible, showExactAmounts)} withdrawing`);
    facts.push('rewards in Account');
  }
  if (pos.isManuallyHidden) facts.push('hidden');

  const tr = doc.createElement('tr');
  tr.className = 'position-detail';
  const td = doc.createElement('td');
  td.colSpan = colSpan;
  td.innerHTML = `<div class="position-detail__facts">${facts.filter(Boolean).join(' · ')}</div>` +
    (pos.isLeveraged ? `<div class="position-detail__ladder">${ladderHtml(pos, quoteCurrency)}</div>` : '') +
    `<div class="position-detail__actions">${rowActionsHtml(pos, `${pos.asset}_${pos.exchange}`)}</div>`;
  tr.appendChild(td);
  return tr;
}

// Columns a detail line should span: only the ones showing. Spanning a column that a
// narrow screen hides would add a phantom column and shift the others.
function visibleColumnCount(table) {
  const heads = Array.from(table?.querySelectorAll('thead th') || []);
  const shown = heads.filter(th => getComputedStyle(th).display !== 'none').length;
  return shown || heads.length || 9;
}

function hideFundingTooltip() {
  if (fundingTooltipEl) {
    fundingTooltipEl.classList.remove('visible');
  }
  activeTooltipCell = null;
}

function updateTooltipPosition(e) {
  if (!fundingTooltipEl) return;
  // Position tooltip to follow mouse with offset
  const x = e.clientX + 12;
  const y = e.clientY + 12;
  fundingTooltipEl.style.left = `${x}px`;
  fundingTooltipEl.style.top = `${y}px`;
}

// No header templates needed - CSS handles chart visibility via .chart class

function createSparkline(priceData, width = 60, height = 24, currentChange24h = null) {
  if (!Array.isArray(priceData) || priceData.length < 2) {
    return null;
  }

  const prices = priceData.map(d => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;

  if (range === 0) {
    // Flat line
    const y = height / 2;
    const points = priceData.map((_, i) => `${(i / (priceData.length - 1)) * width},${y}`).join(' ');
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="sparkline" aria-hidden="true" focusable="false"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1"/></svg>`;
  }

  // Normalize prices to chart height
  const points = priceData.map((d, i) => {
    const x = (i / (priceData.length - 1)) * width;
    const y = height - ((d.price - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  // Determine color: use 24h change if provided (for consistency with 24h% column),
  // otherwise fall back to first vs last price comparison
  let color;
  if (currentChange24h !== null && currentChange24h !== undefined) {
    color = currentChange24h >= 0 ? 'var(--green)' : 'var(--red)';
  } else {
    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    color = lastPrice >= firstPrice ? 'var(--green)' : 'var(--red)';
  }

  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="sparkline" aria-hidden="true" focusable="false"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1"/></svg>`;
}

function formatAmount(num, visible, showExact = false) {
  if (!visible) return '••••';
  const n = Number(num || 0);
  if (!Number.isFinite(n)) return '—';

  if (showExact) {
    return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
  }

  // Round to reasonable precision
  const abs = Math.abs(n);
  if (abs >= 1000000) {
    const formatted = (abs / 1000000).toFixed(2);
    return (n < 0 ? '−' : '') + formatted.replace(/\.?0+$/, '') + 'M';
  } else if (abs >= 1000) {
    const formatted = (abs / 1000).toFixed(2);
    return (n < 0 ? '−' : '') + formatted.replace(/\.?0+$/, '') + 'k';
  } else if (abs >= 1) {
    return (n < 0 ? '−' : '') + abs.toFixed(2).replace(/\.?0+$/, '');
  } else if (abs === 0) {
    return '0';
  } else {
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
}

function formatBaseMoney(num, visible, currency, showPlusSign = false) {
  return formatMoney(num, {
    currency,
    visible,
    compact: true,
    showPlusSign
  });
}

// Format price with full precision (no compact notation) - like watchlist
function formatPrice(num, visible, currency) {
  return formatCurrencyPrice(num, { currency, visible });
}

function formatPct(num, isLoading = false) {
  if (num === null || num === undefined || Number.isNaN(num)) {
    return isLoading ? '<span class="cell-loading">—</span>' : '—';
  }
  const n = Number(num);
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : (n < 0 ? '−' : '');
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

function formatFunding(num, visible, currency, isLoading = false) {
  if (!visible) return formatMoney(0, { currency, visible: false });
  if (num === null || num === undefined || Number.isNaN(num)) {
    return isLoading ? '<span class="cell-loading">—</span>' : '—';
  }
  const n = Number(num);
  if (!Number.isFinite(n)) return '—';
  return formatMoney(n, { currency, visible, compact: true, showPlusSign: true });
}

function formatQuoteBackedMoney(pos, value, visible, currency, showPlusSign = false) {
  if (pos.quoteLoading) return '<span class="cell-loading">—</span>';
  if (pos.quoteUnavailable) return 'Quote unavailable';
  if (pos.fxConversionMissing) return showPlusSign ? '—' : 'FX rate unavailable';
  return formatBaseMoney(value, visible, currency, showPlusSign);
}

function formatFundingRate(rate) {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return null;
  const n = Number(rate);
  if (!Number.isFinite(n)) return null;
  // Convert to percentage and format (rate is per hour, e.g. 0.0000125 = 0.00125%)
  const pct = n * 100;
  const sign = pct > 0 ? '+' : (pct < 0 ? '−' : '');
  return `${sign}${Math.abs(pct).toFixed(4)}%/hr`;
}

function formatFundingRateExtended(rate) {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return null;
  const n = Number(rate);
  if (!Number.isFinite(n)) return null;

  // rate is per hour as decimal
  const hourlyPct = n * 100;
  const monthlyPct = n * 100 * 24 * 30;  // 720 hours/month
  const yearlyPct = n * 100 * 24 * 365;  // 8760 hours/year

  const sign = (v) => v > 0 ? '+' : (v < 0 ? '−' : '');

  return {
    hourly: `${sign(hourlyPct)}${Math.abs(hourlyPct).toFixed(4)}%`,
    monthly: `${sign(monthlyPct)}${Math.abs(monthlyPct).toFixed(2)}%`,
    yearly: `${sign(yearlyPct)}${Math.abs(yearlyPct).toFixed(1)}%`
  };
}

function computeValue(pos) {
  if (typeof pos.value === 'number') return pos.value;
  const amount = Number(pos.amount || 0);
  const price = Number(pos.price || 0);
  if (!Number.isFinite(amount) || !Number.isFinite(price)) return 0;
  return amount * price;
}

function isShortPosition(pos) {
  const amount = Number(pos?.amount);
  return !!pos?.isLeveraged && Number.isFinite(amount) && amount < 0;
}

function formatAssetLabel(pos) {
  return pos?.asset || '—';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function formatAssetLabelHtml(pos) {
  const base = formatAssetLabel(pos);
  if (!isShortPosition(pos)) return base;
  return `${base}<span class="short-arrow"> ↓</span>`;
}

// Table variant: ticker plus the full name in muted text when the provider gives one.
function formatAssetCellHtml(pos) {
  const label = formatAssetLabelHtml(pos);
  const name = String(pos?.assetName || '').trim();
  if (!name || name.toUpperCase() === String(pos?.asset || '').toUpperCase()) return label;
  return `${label}<span class="asset-name">${escapeHtml(name)}</span>`;
}

// Column sorting (header clicks in app.js set opts.sort = { key, dir }). Empty values
// sort last whichever way the column goes.
const SORT_VALUES = {
  asset: p => String(p.asset || '').toLowerCase(),
  price: p => Number(p.price),
  value: p => computeValue(p),
  pnl: p => p.pnl,
  funding: p => p.funding,
  change: p => p.change24h,
  amount: p => Math.abs(Number(p.amount)),
  exchange: p => String(p.exchange || '').toLowerCase()
};

function sortPositions(list, sort) {
  const get = SORT_VALUES[sort?.key];
  if (!get) return list;
  const dir = sort.dir === 'asc' ? 1 : -1;
  const empty = v => v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v));
  return [...list].sort((a, b) => {
    const va = get(a), vb = get(b);
    if (empty(va) || empty(vb)) return empty(va) - empty(vb);
    return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
  });
}

// The search box above the table: matches ticker, name or source.
function matchesQuery(pos, query) {
  if (!query) return true;
  return [pos.asset, pos.name, pos.exchange].some(v => String(v || '').toLowerCase().includes(query));
}

function shouldHidePosition(pos, opts) {
  if (opts.hideNfts && pos.exchange === 'OpenSea') return true;
  if (opts.hideSmallPositions) {
    const threshold = Number(opts.settings?.minBalanceThreshold || 100);
    if (computeValue(pos) < threshold) return true;
  }
  return false;
}

function createTableRow(doc, pos, opts, prevDataMap) {
  const tr = doc.createElement('tr');

  // Add class for hidden positions (shown with reduced opacity)
  if (pos.isHiddenPosition) {
    tr.className = 'position-row-hidden';
  }

  // Each row opens in place (click, or Enter when focused) to show its detail line and
  // actions; app.js handles that from these attributes.
  const rowKey = `${pos.asset}_${pos.exchange}`;
  const isOpen = opts.openKey === rowKey;
  tr.classList.add('position-row');
  if (isOpen) tr.classList.add('is-open');
  tr.dataset.key = rowKey;
  tr.tabIndex = 0;
  tr.setAttribute('aria-expanded', String(isOpen));

  const amountVisible = !!opts.amountsVisible;
  const value = computeValue(pos);
  const baseCurrency = normalizeBaseCurrency(opts.settings?.portfolioBaseCurrency);
  const quoteCurrency = normalizeCurrencyCode(pos.currency || pos.sourceCurrency || baseCurrency, baseCurrency);
  const showExactAmounts = opts.settings?.showExactAmounts ?? false;
  const showPriceChart = opts.settings?.showPriceChart ?? true;

  // Check if values changed (simple comparison like watchlist)
  const key = pos._changeDetectionKey || `${pos.asset}_${pos.exchange}`;
  // Ignore transitions from a loading placeholder (price 0 / null) so the first quote doesn't flash.
  const prev = prevDataMap[key];
  const hadQuote = prev && Number(prev.price) > 0;
  const priceChanged = hadQuote && Math.abs((pos.price || 0) - (prev.price || 0)) > 0.0001;
  const valueChanged = hadQuote && Math.abs(value - (prev.value || 0)) > 0.01;
  const pnlChanged = hadQuote && prev.pnl != null && Math.abs((pos.pnl || 0) - (prev.pnl || 0)) > 0.01;
  const change24hChanged = hadQuote && prev.change24h != null && Math.abs((pos.change24h || 0) - (prev.change24h || 0)) > 0.01;
  const fundingChanged = hadQuote && prev.funding != null && Math.abs((pos.funding || 0) - (prev.funding || 0)) > 0.01;

  // Change detection for flash animations

  // Create sparkline chart - stablecoins get static dash, others get pulsing loading indicator
  let chartCell;
  if (isStablecoin(pos.asset) || pos.quoteUnavailable) {
    // Static dash for assets without a usable chart.
    chartCell = '—';
  } else if (pos.priceHistory) {
    // Has chart data - render sparkline
    chartCell = createSparkline(pos.priceHistory, 60, 24, pos.change24h) || '<span class="chart-loading">—</span>';
  } else {
    // Loading chart data - pulsing placeholder
    chartCell = '<span class="chart-loading">—</span>';
  }

  // Determine loading states:
  // - 24H% is loading if null and not a stablecoin
  // - Funding is loading if null and position is leveraged (perps have funding)
  const is24hLoading = pos.change24h == null && !isStablecoin(pos.asset) && !pos.quoteUnavailable;
  const isFundingLoading = pos.funding == null && pos.isLeveraged;
  const priceCell = pos.quoteLoading
    ? '<span class="cell-loading">—</span>'
    : (pos.quoteUnavailable ? 'Quote unavailable' : formatPrice(pos.price, true, quoteCurrency));
  const valueCell = formatQuoteBackedMoney(pos, value, amountVisible, baseCurrency);
  const pnlCell = pos.quoteLoading || pos.quoteUnavailable || pos.fxConversionMissing || pos.pnl == null
    ? '—'
    : formatBaseMoney(pos.pnl, amountVisible, baseCurrency, true);
  const fundingCell = pos.fxConversionMissing
    ? '—'
    : formatFunding(pos.funding, amountVisible, baseCurrency, isFundingLoading);

  // Use compact column order
  // Order: Asset, Price, Chart, Value, P&L, Funding, 24H%, Amount, Exchange
  const cells = [
    formatAssetCellHtml(pos),
    priceCell,
    chartCell,
    valueCell,
    pnlCell,
    fundingCell,
    formatPct(pos.change24h, is24hLoading),
    formatAmount(pos.amount, amountVisible, showExactAmounts),
    pos.exchange || '—'
  ];

  const useColoredPnL = opts.settings?.useColoredPnL ?? true;
  const fundingRateTooltip = formatFundingRate(pos.fundingRate);
  const fundingRateExt = formatFundingRateExtended(pos.fundingRate);
  // Build extended tooltip text with hourly, monthly, yearly extrapolations
  const fundingTooltipText = fundingRateExt
    ? `Hourly: ${fundingRateExt.hourly}\nMonthly: ${fundingRateExt.monthly}\nYearly: ${fundingRateExt.yearly}`
    : null;

  for (let i = 0; i < cells.length; i++) {
    const td = doc.createElement('td');

    // Column indices: Asset, Price, Chart, Value, P&L, Funding, 24H%, Amount, Exchange
    const isPrice = (i === 1);
    const isChart = (i === 2);
    const isValue = (i === 3);
    const isPnL = (i === 4);
    const isFunding = (i === 5);
    const isChange24h = (i === 6);

    // Add color classes for PnL, Funding, and 24H%
    if (useColoredPnL) {
      if (isPnL && pos.pnl != null) {
        td.className = pos.pnl >= 0 ? 'positive-pnl' : 'negative-pnl';
      } else if (isFunding && pos.funding != null) {
        td.className = pos.funding >= 0 ? 'positive-pnl' : 'negative-pnl';
      } else if (isChange24h && pos.change24h != null) {
        td.className = pos.change24h >= 0 ? 'positive-pnl' : 'negative-pnl';
      }
    }

    // Mark cells that should flash on price changes (like watchlist)
    const shouldFlash =
      (isPrice && priceChanged) ||
      (isValue && valueChanged) ||
      (isPnL && pnlChanged) ||
      (isFunding && fundingChanged) ||
      (isChart && (priceChanged || change24hChanged)) ||
      (isChange24h && change24hChanged);

    if (shouldFlash) {
      td.setAttribute('data-flash', 'true');
    }

    if (isChart) {
      // Chart column uses innerHTML
      td.innerHTML = cells[i];
      td.className = 'chart-cell chart';
    } else if (isFunding && fundingTooltipText) {
      // Funding column with custom mouse-tracking tooltip for current rate
      // Use innerHTML if content contains HTML (loading indicator)
      const cellContent = String(cells[i]);
      if (cellContent.includes('<span')) {
        td.innerHTML = cellContent;
      } else {
        td.textContent = cellContent;
      }
      td.classList.add('funding-cell');
      td.setAttribute('data-funding-rate', fundingTooltipText);
      // Tooltip follows the pointer; keyboard users reach the same rate by focusing the cell
      td.tabIndex = 0;
      td.setAttribute('aria-label', `${td.textContent.trim()}, ${fundingTooltipText}`);
      td.addEventListener('mouseenter', (e) => showFundingTooltip(e, fundingTooltipText));
      td.addEventListener('mousemove', updateTooltipPosition);
      td.addEventListener('mouseleave', hideFundingTooltip);
      td.addEventListener('focus', (e) => showFundingTooltipAt(e.currentTarget, fundingTooltipText));
      td.addEventListener('blur', hideFundingTooltip);
    } else {
      // Use innerHTML if content contains HTML (loading indicator), otherwise textContent
      const cellContent = String(cells[i]);
      if (cellContent.includes('<span')) {
        td.innerHTML = cellContent;
      } else {
        td.textContent = cellContent;
      }
    }
    if (i === 0) {
      td.classList.add('asset-cell');
      // The cell fills to the row's share of the portfolio: the allocation, read in place.
      // The largest holding fills the cell, so small shares still show; the title has the
      // exact share.
      const share = opts.shares?.[rowKey];
      if (share > 0) {
        td.style.setProperty('--share', `${(Math.min(1, share / (opts.largestShare || share)) * 100).toFixed(2)}%`);
        td.title = `${share >= 0.1 ? Math.round(share * 100) : (share * 100).toFixed(1)}% of portfolio`;
      }
    }
    if (i === cells.length - 1) {
      td.classList.add('exchange-cell');
      td.title = pos.exchange || '';
    }
    tr.appendChild(td);
  }
  return tr;
}

// Cards are rebuilt on every refresh, so remember which ones the user opened.
const expandedCards = new Set();

function createMobileCard(doc, pos, opts) {
  const card = doc.createElement('div');
  card.className = 'mobile-position-card';
  const amountVisible = !!opts.amountsVisible;
  const value = computeValue(pos);
  const useColoredPnL = opts.settings?.useColoredPnL ?? true;
  const baseCurrency = normalizeBaseCurrency(opts.settings?.portfolioBaseCurrency);
  const quoteCurrency = normalizeCurrencyCode(pos.currency || pos.sourceCurrency || baseCurrency, baseCurrency);

  // Compute change flags for mobile flash animations (mirrors table logic)
  const key = pos._changeDetectionKey || `${pos.asset}_${pos.exchange}`;
  const prevGlobal = (typeof window !== 'undefined' && Array.isArray(window._previousRenderData))
    ? window._previousRenderData.find(p => (p._changeDetectionKey || `${p.asset}_${p.exchange}`) === key)
    : null;
  const prevValue = prevGlobal ? computeValue(prevGlobal) : null;
  const hadQuote = prevGlobal && Number(prevGlobal.price) > 0;
  const priceChanged = hadQuote && Math.abs((pos.price || 0) - (prevGlobal.price || 0)) > 0.0001;
  const valueChanged = hadQuote && Math.abs(value - (prevValue || 0)) > 0.01;
  const pnlChanged = hadQuote && prevGlobal.pnl != null && Math.abs((pos.pnl || 0) - (prevGlobal.pnl || 0)) > 0.01;
  const change24hChanged = hadQuote && prevGlobal.change24h != null && Math.abs((pos.change24h || 0) - (prevGlobal.change24h || 0)) > 0.01;
  const fundingChanged = hadQuote && prevGlobal.funding != null && Math.abs((pos.funding || 0) - (prevGlobal.funding || 0)) > 0.01;
  const flash = (changed) => (changed ? ' data-flash="true"' : '');

  // Color classes for PnL, Funding, and 24H%
  const pnlClass = useColoredPnL && pos.pnl != null ? (pos.pnl >= 0 ? 'positive-pnl' : 'negative-pnl') : '';
  const changeClass = useColoredPnL && pos.change24h != null ? (pos.change24h >= 0 ? 'positive-pnl' : 'negative-pnl') : '';
  const fundingClass = useColoredPnL && pos.funding != null ? (pos.funding >= 0 ? 'positive-pnl' : 'negative-pnl') : '';

  const priceText = pos.quoteLoading
    ? '<span class="cell-loading">—</span>'
    : (pos.quoteUnavailable ? 'Quote unavailable' : formatPrice(pos.price, true, quoteCurrency));
  const pnlText = pos.quoteLoading || pos.quoteUnavailable || pos.fxConversionMissing || pos.pnl == null
    ? ''
    : formatBaseMoney(pos.pnl, amountVisible, baseCurrency, true);

  // Return on cost: entry notional when we know the entry price, else value minus P&L (spot).
  let pnlPctText = '';
  if (pnlText) {
    const fx = Number(pos.fxRate) > 0 ? Number(pos.fxRate) : 1;
    const entryBasis = Math.abs(Number(pos.amount) * Number(pos.entryPrice) * fx);
    const basis = entryBasis > 0 ? entryBasis : (pos.isLeveraged ? 0 : value - pos.pnl);
    if (Number.isFinite(basis) && basis > 0) pnlPctText = formatPct((pos.pnl / basis) * 100);
  }

  // 24h change rides next to the price; left out when there's no 24h figure.
  const changeText = pos.change24h != null
    ? ` <span class="card-change ${changeClass}"${flash(change24hChanged)}>(${formatPct(pos.change24h)})</span>`
    : '';

  // Funding only matters for perps; skip it entirely for spot holdings.
  const hasFunding = pos.isLeveraged || pos.funding != null;
  const fundingRateText = formatFundingRate(pos.fundingRate);
  const fundingText = hasFunding
    ? `<span class="card-funding ${fundingClass}"${flash(fundingChanged)}><span class="card-label">Funding</span> ${pos.fxConversionMissing ? '—' : formatFunding(pos.funding, amountVisible, baseCurrency)}${fundingRateText ? ` <span class="funding-rate-inline">${fundingRateText}</span>` : ''}</span>`
    : '';

  // Ledger style:  ASSET ................ VALUE
  //                price (24h)        P&L +46k +48%
  //   tap to show: venue          Funding (perps)
  card.innerHTML = `
    <div class="card-line">
      <span class="card-asset">${formatAssetLabelHtml(pos)}</span>
      <span class="card-value card-total"${flash(valueChanged)}>${formatQuoteBackedMoney(pos, value, amountVisible, baseCurrency)}</span>
    </div>
    <div class="card-line card-sub">
      <span class="card-meta"><span${flash(priceChanged)}>${priceText}</span>${changeText}</span>
      ${pnlText ? `<span class="card-pnl ${pnlClass}"${flash(pnlChanged)}><span class="card-label">P&amp;L</span> ${pnlText}${pnlPctText ? ` <span class="card-pnl-pct">${pnlPctText}</span>` : ''}</span>` : ''}
    </div>
    <div class="card-line card-sub card-details">
      <span class="card-exchange">${pos.exchange || '—'}</span>
      ${fundingText}
    </div>
    ${opts.editMode ? `<div class="card-actions">${rowActionsHtml(pos, `${pos.asset}_${pos.exchange}`)}</div>` : ''}
  `;

  // A button can't hold other buttons, so in edit mode the card stops being one and its
  // Hide / Delete / Edit actions take the focus stops instead
  if (!opts.editMode) {
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
  }
  const setExpanded = (expanded) => {
    card.classList.toggle('expanded', expanded);
    if (!opts.editMode) card.setAttribute('aria-expanded', String(expanded));
  };
  setExpanded(expandedCards.has(key));
  const toggle = () => {
    const expanded = !expandedCards.has(key);
    if (expanded) expandedCards.add(key); else expandedCards.delete(key);
    setExpanded(expanded);
  };
  card.addEventListener('click', (e) => {
    if (e.target.closest('.card-actions')) return; // edit actions are handled in app.js
    toggle();
  });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });
  return card;
}

function updateHeaders(tableBody, baseCurrency) {
  const table = tableBody?.closest?.('table');
  if (!table) return;
  const valueHeader = table.querySelector('.th-value');
  const pnlHeader = table.querySelector('.th-pnl');
  const fundingHeader = table.querySelector('.th-funding');
  // The cells already carry the currency symbol, so the labels stay short; the code
  // is there on hover for the odd case it isn't obvious.
  const label = (th, text) => {
    if (!th) return;
    // Sortable headers hold a button; the label goes inside it.
    (th.querySelector('.th-sort') || th).textContent = text;
    th.title = `In ${baseCurrency}`;
  };
  label(valueHeader, 'Value');
  label(pnlHeader, 'P&L');
  label(fundingHeader, 'Funding');
}

/**
 * Render positions with atomic header+body update.
 * Returns positions array for caching (like watchlist).
 */
export function renderPositions({ positions, containers, options, previousPositions = [] }) {
  try {
    if (!containers?.positionsBody) return positions;
    const doc = containers.positionsBody.ownerDocument || document;
    const opts = { ...options };
    opts.largestShare = Math.max(0, ...Object.values(opts.shares || {}));
    const baseCurrency = normalizeBaseCurrency(opts.settings?.portfolioBaseCurrency);
    updateHeaders(containers.positionsBody, baseCurrency);

    const list = Array.isArray(positions) ? positions : [];
    const query = String(opts.query || '').trim().toLowerCase();
    const filtered = sortPositions(list.filter(p => !shouldHidePosition(p, opts) && matchesQuery(p, query)), opts.sort);

    const table = containers.positionsBody.closest('table');
    if (table) {
      table.classList.toggle('has-funding', filtered.some(p => p.isLeveraged || p.funding != null));
    }
    const countEl = containers.positionsBody.closest('section')?.querySelector('.panel-count');
    if (countEl) countEl.textContent = filtered.length > 0 ? String(filtered.length) : '';

    if (filtered.length === 0) {
      const emptyRow = doc.createElement('tr');
      const emptyCell = doc.createElement('td');
      emptyCell.colSpan = 9;
      emptyCell.className = 'loading';
      emptyCell.textContent = query ? `No positions match “${opts.query.trim()}”.` : 'No positions.';
      emptyRow.appendChild(emptyCell);
      containers.positionsBody.replaceChildren(emptyRow);
      // The table is hidden on phones, so the cards area needs its own message.
      if (containers.mobilePositionsContainer) {
        const note = doc.createElement('p');
        note.className = 'panel-empty';
        note.textContent = 'No positions.';
        containers.mobilePositionsContainer.replaceChildren(note);
      }
      return positions;
    }

    // Build map of previous values for comparison (like watchlist)
    const prevDataMap = {};
    if (Array.isArray(previousPositions)) {
      for (const pos of previousPositions) {
        if (!pos || !pos.asset || !pos.exchange) continue; // Skip invalid entries
        try {
          const key = pos._changeDetectionKey || `${pos.asset}_${pos.exchange}`;
          prevDataMap[key] = {
            price: pos.price,
            value: computeValue(pos), // Compute value dynamically
            pnl: pos.pnl,
            change24h: pos.change24h,
            funding: pos.funding
          };
        } catch (e) {
          // Skip this position if there's an error computing value
          continue;
        }
      }
    }

    // Build fragments for atomic update
    const frag = doc.createDocumentFragment();
    const mobileFrag = doc.createDocumentFragment();
    const colSpan = visibleColumnCount(table);
    for (const pos of filtered) {
      frag.appendChild(createTableRow(doc, pos, opts, prevDataMap));
      if (opts.openKey === `${pos.asset}_${pos.exchange}`) {
        frag.appendChild(createDetailRow(doc, pos, opts, colSpan));
      }
      if (containers.mobilePositionsContainer) {
        mobileFrag.appendChild(createMobileCard(doc, pos, opts));
      }
    }

    // Rows are rebuilt on every refresh; remember what had keyboard focus (a row or one
    // of its actions) so it can be handed back to the new element.
    const active = doc.activeElement;
    const focusedRow = containers.positionsBody.contains(active)
      ? (active.closest('tr.position-detail')?.previousElementSibling || active.closest('tr'))
      : null;
    const focusedKey = focusedRow?.dataset?.key || null;
    const focusedAction = active?.dataset?.shortcut || null;

    // Atomic DOM update using replaceChildren() which is truly atomic
    // (no intermediate empty state visible to the user, unlike innerHTML = '' + appendChild)
    containers.positionsBody.replaceChildren(frag);

    if (focusedKey) {
      const row = Array.from(containers.positionsBody.querySelectorAll('tr.position-row'))
        .find(r => r.dataset.key === focusedKey);
      const target = focusedAction && row?.nextElementSibling?.classList.contains('position-detail')
        ? row.nextElementSibling.querySelector(`[data-shortcut="${focusedAction}"]`)
        : row;
      target?.focus({ preventScroll: true });
    }
    if (containers.mobilePositionsContainer) {
      containers.mobilePositionsContainer.replaceChildren(mobileFrag);
    }

    // Trigger flash animations (like watchlist)
    requestAnimationFrame(() => {
      const flashCells = containers.positionsBody.querySelectorAll('td[data-flash="true"]');
      flashCells.forEach(cell => {
        cell.classList.add('cell-flash');
        cell.addEventListener('animationend', () => {
          cell.classList.remove('cell-flash');
          cell.removeAttribute('data-flash');
        }, { once: true });
      });

      // Trigger flash animations in mobile cards
      if (containers.mobilePositionsContainer) {
        const mobileFlashNodes = containers.mobilePositionsContainer.querySelectorAll('[data-flash="true"]');
        mobileFlashNodes.forEach(node => {
          node.classList.add('cell-flash');
          node.addEventListener('animationend', () => {
            node.classList.remove('cell-flash');
            node.removeAttribute('data-flash');
          }, { once: true });
        });
      }
    });

    return positions; // Return for caching
  } catch (_) {
    return positions;
  }
}

export default { renderPositions };
