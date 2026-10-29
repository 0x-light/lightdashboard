// Positions UI module (incremental extraction)
// This module progressively takes over rendering of desktop table and mobile cards.
import { manualTypeFromExchange } from '../features/manual-positions.js';
import {
  formatMoney,
  formatPrice as formatCurrencyPrice,
  normalizeBaseCurrency,
  normalizeCurrencyCode
} from '../utils/currency.js';
import {
  KIND_LABELS,
  KIND_ORDER,
  breakevens,
  combinedPayoff,
  daysToExpiry,
  formatExpiry,
  formatStrike,
  legOf,
  legsByUnderlying,
  moneyness,
  netPremium,
  optionOf,
  payoffProfile,
  positionKind,
  strategyName
} from '../domain/instruments.js';

// The table's columns, in their default order. Settings can reorder them
// (settings.positionColumns holds the keys) and hide them (hiddenPositionColumns);
// unknown keys are dropped and missing ones go where the default puts them, so an old
// list keeps working when a column is added.
export const POSITION_COLUMNS = [
  { key: 'asset', label: 'Asset', sort: 'asset', cellClass: 'asset-cell', fixed: true },
  { key: 'price', label: 'Price', sort: 'price', num: true },
  { key: 'pnl', label: 'P&L', sort: 'pnl', num: true },
  { key: 'chart', label: 'Chart', headClass: 'chart', cellClass: 'chart-cell chart' },
  { key: 'value', label: 'Value', sort: 'value', num: true },
  { key: 'funding', label: 'Funding', sort: 'funding', num: true },
  { key: 'change', label: '24h %', sort: 'change', num: true },
  { key: 'expiry', label: 'Expiry', sort: 'expiry' },
  { key: 'underlying', label: 'Underlying', sort: 'underlying', num: true },
  { key: 'amount', label: 'Amount', sort: 'amount', num: true },
  { key: 'exchange', label: 'Source', sort: 'exchange', cellClass: 'exchange-cell' }
];

// The columns a saved list hides; Asset never hides.
export function normalizeHiddenColumns(keys) {
  const known = POSITION_COLUMNS.filter(c => !c.fixed).map(c => c.key);
  return Array.isArray(keys) ? known.filter(k => keys.includes(k)) : [];
}

export function normalizeColumnOrder(keys) {
  const known = POSITION_COLUMNS.map(c => c.key);
  const order = Array.isArray(keys) ? keys.filter((k, i, all) => known.includes(k) && all.indexOf(k) === i) : [];
  // A column the saved order doesn't know goes where the default puts it: after the
  // nearest default predecessor that is in the order.
  known.forEach((key, i) => {
    if (order.includes(key)) return;
    const before = known.slice(0, i).reverse().find(k => order.includes(k));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, key);
  });
  return order;
}

function columnsFor(opts) {
  const hidden = normalizeHiddenColumns(opts?.settings?.hiddenPositionColumns);
  return normalizeColumnOrder(opts?.settings?.positionColumns)
    .filter(key => !hidden.includes(key))
    .map(key => POSITION_COLUMNS.find(c => c.key === key));
}

function cellClassFor(col) {
  return [`col-${col.key}`, col.num ? 'num' : '', col.cellClass || ''].filter(Boolean).join(' ');
}

const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'BUSD']);

// Stocks, funds and options trade in market hours; ambient.js dims them while their
// exchange is closed. The quote currency names the exchange: euro listings trade in
// Frankfurt or on Euronext, sterling in London, the rest in New York.
const STOCK_CATEGORIES = new Set(['equity', 'stock', 'etf', 'fund', 'index', 'option']);
function isStockMarket(pos) {
  return STOCK_CATEGORIES.has(String(pos.category || '').toLowerCase()) ||
    /^Manual \((Stock|ETF|Fund|Index)\)$/.test(pos.exchange || '');
}
function stockMarketOf(pos) {
  if (!isStockMarket(pos)) return null;
  const currency = String(pos.currency || pos.sourceCurrency || '').toUpperCase();
  if (currency === 'EUR') return 'eu';
  if (currency === 'GBP' || currency === 'GBX') return 'uk';
  return 'us';
}

// A stock can share a stablecoin's ticker (StablecoinX trades as USDE on Nasdaq).
function isStablecoin(pos) {
  return STABLECOINS.has(pos?.asset?.toUpperCase()) && !isStockMarket(pos);
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

function showFundingTooltip(cell, e, text) {
  if (!fundingTooltipEl) initFundingTooltip();
  fundingTooltipEl.textContent = text;
  fundingTooltipEl.classList.add('visible');
  activeTooltipCell = cell;
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
    return action('position-manual-edit-btn', attrs, 'e', 'E', 'Edit position') +
      action('position-delete-btn', attrs, 'delete', '⌫', 'Delete position');
  }
  const keyAttr = `data-asset-key="${escapeAttr(assetKey)}"`;
  return pos.isManuallyHidden
    ? action('position-restore-btn', keyAttr, 'h', 'H', 'Show position')
    : action('position-edit-btn', keyAttr, 'h', 'H', 'Hide position');
}

// ── Price ladders (open rows) ──
// One drawing for perps and options: levels on a price scale, each a key glyph on a row
// above the track with a stem down to it, a dithered zone for the side that costs the
// position, and a legend high to low with price and distance from now. Options also get
// their payoff at expiry drawn on the same scale, so the stems become its reference lines.
const LADDER_NAMES = {
  liq: 'Liquidation', entry: 'Entry', now: 'Now', tp: 'Take profit', sl: 'Stop loss',
  buy: 'Buy limit', sell: 'Sell limit', strike: 'Strike', short: 'Strike', breakeven: 'Breakeven', leg: 'Strike'
};
const LADDER_KEYS = {
  liq: 'L', entry: 'E', now: '▼', tp: 'T', sl: 'S', buy: '·', sell: '·',
  strike: 'K', short: 'K', breakeven: 'B', leg: '·'
};

function pctFrom(now) {
  return px => {
    const d = ((px - now) / now) * 100;
    return `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(Math.abs(d) < 10 ? 2 : 1)}%`;
  };
}

// marks: [{ kind, px, off?, name? }]; zone: { left, right } in percent; curve: SVG html
// drawn in rows of its own between the keys and the track.
function renderLadder({ marks, lo, hi, now, zones = [], label, quoteCurrency, curve = '', curveRows = 0, note = '' }) {
  const at = px => Math.max(0, Math.min(100, ((px - lo) / (hi - lo)) * 100));
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
    const top = rows - 1 - m.row; // row 0 sits lowest, next to the track (or the curve)
    return `<span class="ladder__mark ladder__mark--${m.kind}" style="left:${m.x}%;top:calc(var(--pm-lh) * ${top})">${glyph}</span>` +
      `<span class="ladder__tick ladder__tick--${m.kind}" style="left:${m.x}%;top:calc(var(--pm-lh) * ${top + 1})"></span>`;
  }).join('');
  const zoneHtml = zones.map(zone =>
    `<span class="ladder__zone" style="left:${zone.left}%;right:${100 - zone.right}%"></span>`).join('');
  const pct = now > 0 ? pctFrom(now) : () => '';
  const legend = marks
    .slice()
    .sort((a, b) => b.px - a.px)
    .map(m => {
      const dist = m.kind === 'now' ? '' : pct(m.px);
      return `<li class="ladder__row ladder__row--${m.kind}"><span class="ladder__key">${LADDER_KEYS[m.kind]}</span>` +
        `<span class="ladder__name">${m.name || LADDER_NAMES[m.kind]}</span><span class="ladder__px">${formatPrice(m.px, true, quoteCurrency)}</span>` +
        `<span class="ladder__dist">${dist}</span></li>`;
    }).join('');
  const curveHtml = curve ? `<div class="ladder__curve" style="top:calc(var(--pm-lh) * ${rows})">${curve}</div>` : '';
  return `<div class="ladder${curve ? ' ladder--curve' : ''}" role="img" aria-label="${label}" style="--rows:${rows};--curve-rows:${curveRows}">` +
    `<div class="ladder__marks">${markHtml}</div>${curveHtml}<div class="ladder__track">${zoneHtml}</div></div>` +
    `<ul class="ladder__legend">${legend}</ul>${note}`;
}

// A perp's ladder: liquidation, entry, now, and its TP/SL and nearest limit orders.
// Orders come from window.hlOrders (fetched by app.js when the row opens); `null` means loading.
function ladderHtml(pos, quoteCurrency) {
  const now = Number(pos.price);
  if (!(now > 0)) return '';
  const orders = typeof window !== 'undefined' ? window.hlOrders?.[pos.asset] : undefined;
  const loading = typeof window !== 'undefined' && window.hlOrdersState === 'loading';
  const levels = [{ kind: 'now', px: now }];
  if (Number(pos.entryPrice) > 0) levels.push({ kind: 'entry', px: Number(pos.entryPrice) });
  const triggers = (orders || []).filter(o => o.kind === 'tp' || o.kind === 'sl');
  // A TP/SL names how much of the position it closes: 100% for the whole position.
  const held = Math.abs(Number(pos.amount));
  const shareOf = (o) => o.wholePosition ? 1 : (held > 0 && o.sz > 0 ? Math.min(1, o.sz / held) : null);
  levels.push(...triggers.map(o => {
    const share = shareOf(o);
    return { kind: o.kind, px: o.px, name: LADDER_NAMES[o.kind] + (share != null ? ` ${Math.round(share * 100)}%` : '') };
  }));
  // Of the resting limits, only the nearest on each side; the legend gives the count.
  const limits = (orders || []).filter(o => o.kind === 'buy' || o.kind === 'sell');
  const nearest = (kind, cmp) => limits.filter(o => o.kind === kind && cmp(o.px)).sort((a, b) => Math.abs(a.px - now) - Math.abs(b.px - now))[0];
  const nearBuy = nearest('buy', px => px <= now);
  const nearSell = nearest('sell', px => px >= now);
  const limitName = (kind) => {
    const count = limits.filter(o => o.kind === kind).length;
    return `${LADDER_NAMES[kind]}${count > 1 ? ` (nearest of ${count})` : ''}`;
  };
  if (nearBuy) levels.push({ kind: 'buy', px: nearBuy.px, name: limitName('buy') });
  if (nearSell) levels.push({ kind: 'sell', px: nearSell.px, name: limitName('sell') });
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
  const marks = [...levels];
  if (liq) marks.push({ kind: 'liq', px: liq, off: liqOff });

  const isShort = Number(pos.amount) < 0;
  // The liquidated side: below liquidation for a long, above it for a short.
  let zone = null;
  if (liq) {
    const x = liqOff === 'right' ? 100 : liqOff === 'left' ? 0 : ((liq - lo) / (hi - lo)) * 100;
    zone = isShort ? { left: x, right: 100 } : { left: 0, right: x };
  }
  const pct = pctFrom(now);
  const note = loading && !orders
    ? '<p class="ladder__note"><span class="loading-terminal">Loading orders</span></p>'
    : (orders && !triggers.length && !limits.length ? '<p class="ladder__note">No open orders.</p>' : '');
  const label = `Price levels for ${escapeAttr(pos.asset)} ${isShort ? 'short' : 'long'}` +
    (liq ? `, liquidation ${pct(liq)} from now` : ', no liquidation price');
  return renderLadder({ marks, lo, hi, now, zones: zone ? [zone] : [], label, quoteCurrency, note });
}

// An option ladder, on the underlying's price: now, each strike, the breakevens, and
// (for one contract) the strikes of the other contracts held on the same name. The zone
// is where the legs together lose money at expiry. Above the track, the payoff at expiry
// on the same scale, its profit tinted.
const PAYOFF_ROWS = 3;

function legsLadderHtml(legs, { quoteCurrency, siblings = [], underlying }) {
  if (!legs.length) return '';
  const nowOf = legs.map(l => Number(l.pos?.underlyingPrice)).find(v => v > 0);
  const now = nowOf > 0 ? nowOf : null;
  const single = legs.length === 1 ? legs[0] : null;
  const name = underlying || legs[0].option.underlying;
  const written = l => l.qty < 0;
  const count = l => `${Math.abs(l.qty)} ${written(l) ? 'written' : 'held'}`;

  const marks = [];
  for (const leg of legs) {
    marks.push({
      kind: written(leg) ? 'short' : 'strike',
      px: leg.option.strike,
      name: single ? 'Strike' : `${formatStrike(leg.option.strike)} ${leg.option.right} · ${count(leg)}`
    });
  }
  if (now) marks.push({ kind: 'now', px: now, name: `${escapeAttr(name)} now` });
  for (const leg of siblings) {
    if (legs.some(l => l.pos === leg.pos || (l.option.strike === leg.option.strike && l.option.expiry === leg.option.expiry))) continue;
    marks.push({
      kind: 'leg',
      px: leg.option.strike,
      name: `${formatStrike(leg.option.strike)} ${leg.option.right} ${formatExpiry(leg.option.expiry)} · ${count(leg)}`
    });
  }

  // Scale: the strikes and now, with room past them so the payoff shows its bends;
  // then the breakevens, which may sit outside the strikes.
  const anchors = marks.map(m => m.px);
  let lo = Math.min(...anchors);
  let hi = Math.max(...anchors);
  const pad = Math.max(hi - lo, lo * 0.05) * 0.25;
  lo = Math.max(0, lo - pad);
  hi += pad;
  const evens = breakevens(legs, Math.max(0, lo - pad * 4), hi + pad * 4);
  for (const px of evens) {
    lo = Math.min(lo, Math.max(0, px - pad / 2));
    hi = Math.max(hi, px + pad / 2);
  }
  const atCost = legs.every(l => l.atCost);
  for (const px of evens) marks.push({ kind: 'breakeven', px, name: atCost ? 'Breakeven' : 'Breakeven at today’s premium' });
  const at = px => ((px - lo) / (hi - lo)) * 100;

  // Payoff at expiry across the scale: straight between its bends (the strikes and the
  // breakevens), so the curve, the loss zones and the tinted profit all come from it.
  const xs = [...new Set([lo, hi, ...legs.map(l => l.option.strike), ...evens])]
    .filter(px => px >= lo && px <= hi)
    .sort((a, b) => a - b);
  const ys = xs.map(px => combinedPayoff(legs, px));
  const yMin = Math.min(0, ...ys), yMax = Math.max(0, ...ys);
  const y = v => yMax === yMin ? 50 : 92 - ((v - yMin) / (yMax - yMin)) * 84;
  const pt = (px, v) => `${at(px).toFixed(2)},${y(v).toFixed(2)}`;
  const zero = `<line class="payoff__zero" x1="0" x2="100" y1="${y(0).toFixed(2)}" y2="${y(0).toFixed(2)}" vector-effect="non-scaling-stroke"/>`;
  // Runs of the line on each side of zero: profit tinted above the track, loss dithered on
  // it. The line only crosses zero at a breakeven, and those are points of the line, so
  // each stretch between two points has one sign.
  const runs = [];
  for (let i = 1; i < xs.length; i++) {
    const mid = ys[i - 1] + ys[i];
    const sign = mid > 1e-9 ? 1 : mid < -1e-9 ? -1 : 0;
    if (sign === 0) continue;
    const last = runs.at(-1);
    if (last && last.sign === sign && last.end === i - 1) { last.end = i; continue; }
    runs.push({ sign, start: i - 1, end: i });
  }
  for (const r of runs) {
    r.from = xs[r.start];
    r.to = xs[r.end];
    r.pts = xs.slice(r.start, r.end + 1).map((px, k) => [px, ys[r.start + k]]);
  }
  const gain = runs.filter(r => r.sign > 0).map(r =>
    `<polygon class="payoff__gain" points="${[pt(r.from, 0), ...r.pts.map(([px, v]) => pt(px, v)), pt(r.to, 0)].join(' ')}"/>`).join('');
  const zones = runs.filter(r => r.sign < 0).map(r => ({ left: at(r.from), right: at(r.to) }));
  const curve = `<svg class="payoff" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">${gain}${zero}` +
    `<polyline class="payoff__line" points="${xs.map((px, i) => pt(px, ys[i])).join(' ')}" fill="none" vector-effect="non-scaling-stroke"/></svg>`;

  const days = daysToExpiry(legs[0].option.expiry);
  const when = days === null ? '' : days < 0 ? 'expired' : days === 0 ? 'expires today' : `${days} day${days === 1 ? '' : 's'} to ${formatExpiry(legs[0].option.expiry)}`;
  const facts = [when];
  if (single && now) {
    const d = Math.abs((now - single.option.strike) / single.option.strike) * 100;
    facts.push(`${d.toFixed(d < 10 ? 1 : 0)}% ${moneyness(single.option, now) === 'in' ? 'in' : 'out of'} the money`);
  }
  if (atCost) {
    const profile = payoffProfile(legs);
    const money = v => formatPrice(Math.abs(v), true, quoteCurrency);
    facts.push(`max loss ${Number.isFinite(profile.maxLoss) ? money(profile.maxLoss) : 'unlimited'}`);
    facts.push(`max gain ${Number.isFinite(profile.maxGain) ? money(profile.maxGain) : 'unlimited'}`);
  }
  const note = `<p class="ladder__note">${facts.filter(Boolean).join(' · ')}</p>`;
  const what = single ? `${formatStrike(single.option.strike)} ${single.option.right}` : strategyName(legs);
  const label = `${escapeAttr(name)} ${what}` +
    (now ? `: ${escapeAttr(name)} at ${formatPrice(now, true, quoteCurrency)}` : '') +
    (evens.length ? `, breakeven ${evens.map(px => formatPrice(px, true, quoteCurrency)).join(' and ')}` : '');
  return renderLadder({ marks, lo, hi, now, zones, label, quoteCurrency, curve, curveRows: PAYOFF_ROWS, note });
}

// The line that opens under a row: what the row can't fit, then its actions.
function createDetailRow(doc, pos, opts, colSpan) {
  const amountVisible = !!opts.amountsVisible;
  const showExactAmounts = opts.settings?.showExactAmounts ?? false;
  const baseCurrency = normalizeBaseCurrency(opts.settings?.portfolioBaseCurrency);
  const quoteCurrency = normalizeCurrencyCode(pos.currency || pos.sourceCurrency || baseCurrency, baseCurrency);
  const option = optionOf(pos);
  const facts = [];
  if (option) {
    // Contracts, and the shares they are on; a negative amount is a contract written.
    const contracts = Math.abs(Number(pos.amount)) || 0;
    const shares = contracts * (Number(pos.multiplier) > 0 ? Number(pos.multiplier) : 100);
    facts.push(`${formatAmount(contracts, amountVisible, showExactAmounts)} contract${contracts === 1 ? '' : 's'}` +
      `${Number(pos.amount) < 0 ? ' written' : ''} (${formatAmount(shares, amountVisible, showExactAmounts)} shares)`);
  } else {
    facts.push(`${formatAmount(pos.amount, amountVisible, showExactAmounts)} ${escapeAttr(pos.asset)}`);
  }
  facts.push(escapeAttr(pos.exchange || ''));
  if (Number(pos.entryPrice) > 0) {
    const what = option ? (Number(pos.amount) < 0 ? 'premium received' : 'premium paid') : 'entry';
    const entry = `${what} ${formatPrice(Number(pos.entryPrice), true, quoteCurrency)}`;
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
    (option ? `<div class="position-detail__ladder">${legsLadderHtml([legOf(pos)], { quoteCurrency, siblings: opts.optionLegs?.[option.underlying] || [] })}</div>` : '') +
    `<div class="position-detail__actions">${rowActionsHtml(pos, `${pos.asset}_${pos.exchange}`)}</div>`;
  tr.appendChild(td);
  return tr;
}

// Columns a detail line should span: only the ones showing. Spanning a column that a
// narrow screen hides would add a phantom column and shift the others. Reading the
// styles forces a style pass, so the count is kept until the columns or a class that
// can hide one (has-funding, has-options, body.no-charts) changes.
let columnCountCache = { signature: null, count: 0 };
function visibleColumnCount(table) {
  const doc = table?.ownerDocument;
  const signature = [table?.querySelector('thead')?.dataset.columns, table?.className,
    doc?.body?.className, doc?.documentElement?.className].join('|');
  if (table && columnCountCache.signature === signature) return columnCountCache.count;
  const heads = Array.from(table?.querySelectorAll('thead th') || []);
  const shown = heads.filter(th => getComputedStyle(th).display !== 'none').length;
  const count = shown || heads.length || 9;
  if (table) columnCountCache = { signature, count };
  return count;
}

// One set of funding-tooltip listeners on the table body, for every funding cell it
// will hold; each cell carries its text in data-funding-rate.
const fundingTooltipBodies = new WeakSet();
function bindFundingTooltip(body) {
  if (fundingTooltipBodies.has(body)) return;
  fundingTooltipBodies.add(body);
  const cellOf = (e) => e.target.closest?.('td.funding-cell[data-funding-rate]');
  body.addEventListener('mouseover', (e) => {
    const cell = cellOf(e);
    if (cell && !cell.contains(e.relatedTarget)) showFundingTooltip(cell, e, cell.dataset.fundingRate);
  });
  body.addEventListener('mousemove', (e) => { if (cellOf(e)) updateTooltipPosition(e); });
  body.addEventListener('mouseout', (e) => {
    const cell = cellOf(e);
    if (cell && !cell.contains(e.relatedTarget)) hideFundingTooltip();
  });
  body.addEventListener('focusin', (e) => {
    const cell = cellOf(e);
    if (cell && e.target === cell) showFundingTooltipAt(cell, cell.dataset.fundingRate);
  });
  body.addEventListener('focusout', (e) => {
    const cell = cellOf(e);
    if (cell && e.target === cell) hideFundingTooltip();
  });
}

// Which layout shows: the table, or the cards on a narrow screen. palmeirim.css keeps
// the table at every width (html.pm), so the cards show only without it. Only the one
// showing is built; crossing the breakpoint renders again to build the other.
const NARROW_QUERY = '(max-width: 870px)';
function cardsShown(doc) {
  const media = doc.defaultView?.matchMedia?.(NARROW_QUERY);
  if (!media) return null; // can't tell: build both
  return !doc.documentElement.classList.contains('pm') && media.matches;
}

let layoutWatched = false;
function watchLayout(doc) {
  if (layoutWatched) return;
  const media = doc.defaultView?.matchMedia?.(NARROW_QUERY);
  if (!media?.addEventListener) return;
  layoutWatched = true;
  let shown = cardsShown(doc);
  media.addEventListener('change', () => {
    const now = cardsShown(doc);
    if (now === shown) return;
    shown = now;
    window._portfolioRenderer?.render?.();
  });
}

// What each table row was built from, so a render keeps the rows whose HTML is the
// same (with their focus, hover and the dither palmeirim.js adds to sparklines) and
// replaces only the ones that changed.
const builtRows = new WeakMap(); // tr → { key, html }

function rowIdentity(tr, prevKey) {
  if (tr.dataset.key) return `row:${tr.dataset.key}`;
  if (tr.classList.contains('position-detail')) return `detail:${prevKey}`;
  return tr.className;
}

function patchRows(body, frag) {
  const old = new Map();
  for (const tr of body.children) {
    const built = builtRows.get(tr);
    if (built) old.set(built.key, tr);
  }
  const seen = new Map();
  let prevKey = '';
  const next = Array.from(frag.children).map(tr => {
    const base = rowIdentity(tr, prevKey);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    const key = n ? `${base}#${n}` : base;
    prevKey = key;
    const html = tr.outerHTML;
    const kept = old.get(key);
    // A row with a cell to flash is new every time, so the flash plays again.
    if (kept && builtRows.get(kept).html === html && !html.includes('data-flash')) {
      old.delete(key);
      return kept;
    }
    builtRows.set(tr, { key, html });
    return tr;
  });
  // In order, moving only what is out of place, then drop what is left over.
  next.forEach((tr, i) => {
    const at = body.children[i];
    if (at !== tr) body.insertBefore(tr, at || null);
  });
  while (body.children.length > next.length) body.lastElementChild.remove();
  for (const node of Array.from(body.childNodes)) if (node.nodeType !== 1) node.remove();
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
  // null is an amount the source couldn't read, not zero.
  if (num == null) return '—';
  const n = Number(num);
  if (!Number.isFinite(n)) return '—';

  if (showExact) {
    return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
  }

  // Round to reasonable precision
  const abs = Math.abs(n);
  if (abs >= 1e9) {
    const formatted = (abs / 1e9).toFixed(2);
    return (n < 0 ? '−' : '') + formatted.replace(/\.?0+$/, '') + 'B';
  } else if (abs >= 1000000) {
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

// The 24h figure of a market that is not in its regular session: "+1.20% post", or "closed"
// alone when the move is from an earlier session (sessionChange24h, in the title).
function formatChangeCell(pos, isLoading) {
  if (!pos.marketLabel) return formatPct(pos.change24h, isLoading);
  const label = `<span class="cell-note">${escapeHtml(pos.marketLabel)}</span>`;
  if (pos.change24h == null) return label;
  return `${formatPct(pos.change24h)} ${label}`;
}

function changeCellTitle(pos) {
  if (!pos.marketLabel) return '';
  const last = pos.sessionChange24h ?? pos.change24h;
  const state = pos.marketLabel === 'closed' ? 'Market closed' : `${pos.marketLabel === 'pre' ? 'Pre' : 'After'}-market`;
  return last != null ? `${state}. Last session ${formatPct(last)}` : state;
}

// The age beside a stale row's ticker ("12m ago"); the title has the exact time and why.
function staleNoteHtml(pos) {
  if (!pos?.isStale) return '';
  return `<span class="stale-note" title="${escapeAttr(pos.staleTitle || '')}">${escapeHtml(pos.staleNote || 'stale')}</span>`;
}

// The oldest stale row of several (a strategy's legs).
function oldestStale(rows) {
  return rows.filter(p => p?.isStale).sort((a, b) => (a.staleAt || 0) - (b.staleAt || 0))[0] || null;
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

// Short: a perp sold, or an option written.
function isShortPosition(pos) {
  const amount = Number(pos?.amount);
  return (!!pos?.isLeveraged || !!optionOf(pos)) && Number.isFinite(amount) && amount < 0;
}

// A Hyperliquid builder dex's market, "xyz:GOLD": the dex and the market's own name.
function hip3Of(pos) {
  if (pos?.exchange !== 'HL Perps') return null;
  const m = /^([a-z0-9]+):(.+)$/.exec(String(pos.asset || ''));
  return m ? { dex: m[1], name: m[2] } : null;
}

// The ticker alone: a builder dex's prefix goes to the Source column.
function formatAssetLabel(pos) {
  const option = optionOf(pos);
  return option ? option.underlying : (hip3Of(pos)?.name || pos?.asset || '—');
}

function formatSource(pos) {
  const hip3 = hip3Of(pos);
  return hip3 ? `${pos.exchange} · ${hip3.dex}` : (pos.exchange || '—');
}

// An option's strike and right after its underlying, short enough for the Asset column:
// "8C". The expiry has a column of its own; the detail line and the ladder legend spell
// the right out.
function optionTerms(option) {
  const strike = Number(option.strike).toLocaleString('en-US', { maximumFractionDigits: 3, useGrouping: false });
  return `${strike}${option.right === 'put' ? 'P' : 'C'}`;
}

function optionTermsHtml(pos) {
  const option = optionOf(pos);
  return option ? `<span class="asset-terms">${escapeHtml(optionTerms(option))}</span>` : '';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function formatAssetLabelHtml(pos) {
  const base = escapeHtml(formatAssetLabel(pos));
  const arrow = isShortPosition(pos) ? '<span class="short-arrow"> short</span>' : '';
  return `${base}${arrow}${optionTermsHtml(pos)}`;
}

// Table variant: ticker plus the full name in muted text when the provider gives one.
function formatAssetCellHtml(pos, { leg = false } = {}) {
  // A leg under its underlying's row: the contract's terms stand in for the ticker.
  if (leg) {
    const option = optionOf(pos);
    const arrow = isShortPosition(pos) ? '<span class="short-arrow"> short</span>' : '';
    // Drawn as a tree, as SRCL's tree view: ├─ for each leg, └─ for the last.
    const branch = leg === 'last' ? '└─' : '├─';
    return `<span class="asset-leg"><span class="asset-leg__branch" aria-hidden="true">${branch}</span>${escapeHtml(optionTerms(option))}${arrow}</span>`;
  }
  const label = formatAssetLabelHtml(pos);
  const name = String(pos?.assetName || '').trim();
  if (optionOf(pos) || !name || name.toUpperCase() === String(pos?.asset || '').toUpperCase()) return label;
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
  exchange: p => String(p.exchange || '').toLowerCase(),
  expiry: p => optionOf(p)?.expiry || null,
  underlying: p => (Number(p.underlyingPrice) > 0 ? Number(p.underlyingPrice) : null)
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
  const kind = positionKind(pos);
  const option = optionOf(pos);
  const terms = [pos.asset, pos.name, pos.exchange, KIND_LABELS[kind], kind];
  if (option) terms.push(option.underlying, optionTerms(option), `${formatStrike(option.strike)} ${option.right}`, formatExpiry(option.expiry), 'option');
  return terms.some(v => String(v || '').toLowerCase().includes(query));
}

function shouldHidePosition(pos, opts) {
  if (opts.hideNfts && pos.exchange === 'OpenSea') return true;
  if (opts.hideSmallPositions) {
    const threshold = Number(opts.settings?.minBalanceThreshold || 100);
    // A written option's value is negative: its size is what counts.
    if (Math.abs(computeValue(pos)) < threshold) return true;
  }
  return false;
}

function createTableRow(doc, pos, opts, prevDataMap, { leg = false } = {}) {
  const tr = doc.createElement('tr');

  // Add class for hidden positions (shown with reduced opacity)
  if (pos.isHiddenPosition) {
    tr.className = 'position-row-hidden';
  }
  if (pos.isStale) tr.classList.add('position-row-stale');

  // Each row opens in place (click, or Enter when focused) to show its detail line and
  // actions; app.js handles that from these attributes.
  const rowKey = `${pos.asset}_${pos.exchange}`;
  const isOpen = opts.openKey === rowKey;
  tr.classList.add('position-row');
  if (isOpen) tr.classList.add('is-open');
  tr.dataset.key = rowKey;
  if (stockMarketOf(pos)) tr.dataset.market = stockMarketOf(pos);
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
  const option = optionOf(pos);
  if (option && !pos.priceHistory) {
    // An option without its own chart (it hasn't traded today) shows its underlying's, as a
    // strategy row does.
    chartCell = (pos.underlyingPriceHistory && createSparkline(pos.underlyingPriceHistory, 60, 24, pos.underlyingChange24h)) || '—';
  } else if (isStablecoin(pos) || pos.quoteUnavailable) {
    // Static dash for assets without a usable chart
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
  const is24hLoading = pos.change24h == null && !isStablecoin(pos) && !pos.quoteUnavailable && !option && !pos.marketLabel;
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

  const underlyingNow = Number(pos.underlyingPrice) > 0 ? Number(pos.underlyingPrice) : null;
  const cells = {
    asset: formatAssetCellHtml(pos, { leg }) + staleNoteHtml(pos),
    expiry: option ? formatExpiry(option.expiry) : '—',
    underlying: underlyingNow ? formatPrice(underlyingNow, true, quoteCurrency) : '—',
    price: priceCell,
    chart: chartCell,
    value: valueCell,
    pnl: pnlCell,
    funding: fundingCell,
    change: formatChangeCell(pos, is24hLoading),
    amount: formatAmount(pos.amount, amountVisible, showExactAmounts),
    exchange: escapeHtml(formatSource(pos))
  };
  const flash = {
    price: priceChanged,
    value: valueChanged,
    pnl: pnlChanged,
    funding: fundingChanged,
    chart: priceChanged || change24hChanged,
    change: change24hChanged
  };
  const useColoredPnL = opts.settings?.useColoredPnL ?? true;
  const signClass = v => (useColoredPnL && v != null ? (v >= 0 ? 'positive-pnl' : 'negative-pnl') : '');
  const tone = { pnl: signClass(pos.pnl), funding: signClass(pos.funding), change: signClass(pos.change24h) };
  const fundingRateExt = formatFundingRateExtended(pos.fundingRate);
  // Extended tooltip text with hourly, monthly, yearly extrapolations
  const fundingTooltipText = fundingRateExt
    ? `Hourly: ${fundingRateExt.hourly}\nMonthly: ${fundingRateExt.monthly}\nYearly: ${fundingRateExt.yearly}`
    : null;

  for (const col of columnsFor(opts)) {
    const td = doc.createElement('td');
    td.className = cellClassFor(col);
    if (tone[col.key]) td.classList.add(tone[col.key]);
    // Cells that flash on a change (like the watchlist)
    if (flash[col.key]) td.setAttribute('data-flash', 'true');
    // innerHTML only where the content carries markup (charts, loading placeholders)
    const content = String(cells[col.key]);
    if (col.key === 'chart' || col.key === 'asset' || content.includes('<span')) td.innerHTML = content;
    else td.textContent = content;

    if (col.key === 'funding' && fundingTooltipText) {
      // Funding column with custom mouse-tracking tooltip for current rate
      td.classList.add('funding-cell');
      td.setAttribute('data-funding-rate', fundingTooltipText);
      // Tooltip follows the pointer; keyboard users reach the same rate by focusing the cell
      td.tabIndex = 0;
      td.setAttribute('aria-label', `${td.textContent.trim()}, ${fundingTooltipText}`);
      // The listeners are on the table body (bindFundingTooltip), so rows carry none.
    }
    if (col.key === 'asset') {
      // The cell fills to the row's share of the portfolio: the allocation, read in place.
      // The largest holding fills the cell, so small shares still show; the title has the
      // exact share.
      const share = opts.shares?.[rowKey];
      if (share > 0) {
        td.style.setProperty('--share', `${(Math.min(1, share / (opts.largestShare || share)) * 100).toFixed(2)}%`);
        td.title = `${share >= 0.1 ? Math.round(share * 100) : (share * 100).toFixed(1)}% of portfolio`;
      }
    }
    if (col.key === 'exchange') td.title = pos.exchange || '';
    if (col.key === 'change' && pos.marketLabel) td.title = changeCellTitle(pos);
    tr.appendChild(td);
  }
  return tr;
}

// ── Several contracts on one underlying ──
// They sit under a row for the underlying itself: its price now and 24h move, what the
// legs make together ("bull call spread · 15 Jan 27"), their value and P&L summed. The
// row opens to the legs' combined payoff, one ladder per expiry.
function strategyKey(underlying, legs) {
  return `options:${underlying}_${legs[0]?.pos?.exchange || ''}`;
}

// The one row that stands for several legs on a name. It sorts and totals like a
// position: the name, the underlying's price and move, the legs' value and P&L summed.
function strategyRowOf(underlying, legs) {
  const first = legs[0].pos;
  const quoted = legs.find(l => Number(l.pos.underlyingPrice) > 0)?.pos;
  const totals = groupTotals(legs.map(l => l.pos));
  return {
    asset: underlying,
    exchange: first.exchange,
    currency: first.currency,
    sourceCurrency: first.sourceCurrency,
    price: quoted ? Number(quoted.underlyingPrice) : null,
    value: totals.value ?? 0,
    pnl: totals.pnl,
    change24h: quoted?.underlyingChange24h ?? null,
    amount: null,
    category: 'option',
    _strategy: { underlying, legs },
    _changeDetectionKey: strategyKey(underlying, legs)
  };
}

// Legs on one name fold into one row in the position list, where the first of them was.
function combineLegs(positions) {
  const byName = legsByUnderlying(positions);
  const placed = new Set();
  const out = [];
  for (const pos of positions) {
    const option = optionOf(pos);
    const legs = option ? byName[option.underlying] : null;
    if (!legs || legs.length < 2) { out.push(pos); continue; }
    if (placed.has(option.underlying)) continue;
    placed.add(option.underlying);
    out.push(strategyRowOf(option.underlying, legs));
  }
  return out;
}

function legsByExpiry(legs) {
  const out = new Map();
  for (const leg of legs) {
    if (!out.has(leg.option.expiry)) out.set(leg.option.expiry, []);
    out.get(leg.option.expiry).push(leg);
  }
  return out;
}

// What the legs make: "bull call spread" for one expiry; across expiries, "long calls"
// when they are all one way, else each expiry's name in turn.
function strategyDescription(legs) {
  const groups = [...legsByExpiry(legs).values()];
  if (groups.length === 1) return strategyName(legs);
  const rights = new Set(legs.map(l => l.option.right));
  if (rights.size === 1 && legs.every(l => l.qty > 0)) return `long ${[...rights][0]}s`;
  if (rights.size === 1 && legs.every(l => l.qty < 0)) return `short ${[...rights][0]}s`;
  return [...new Set(groups.map(strategyName))].join(', ');
}

// The row's tag, one word: "spread", "calls", "straddle", "butterfly"; "options" when the
// legs make nothing standard. The open row's facts line has the whole name.
function strategyTag(legs) {
  const name = strategyDescription(legs);
  if (name.includes(',')) return 'options';
  return name.split(' ').at(-1);
}

// The expiries a set of legs runs to: dates for one or two, a count past that.
function expiriesText(legs) {
  const dates = [...legsByExpiry(legs).keys()];
  return dates.length > 2 ? `${dates.length} expiries` : dates.map(d => formatExpiry(d)).join(', ');
}

function createStrategyRow(doc, underlying, legs, opts) {
  const tr = doc.createElement('tr');
  const rowKey = strategyKey(underlying, legs);
  const isOpen = opts.openKey === rowKey;
  tr.className = 'position-row position-strategy';
  if (isOpen) tr.classList.add('is-open');
  const stale = oldestStale(legs.map(l => l.pos));
  if (stale) tr.classList.add('position-row-stale');
  tr.dataset.key = rowKey;
  if (legs.every(l => isStockMarket(l.pos))) tr.dataset.market = stockMarketOf(legs[0].pos);
  tr.tabIndex = 0;
  tr.setAttribute('aria-expanded', String(isOpen));

  const amountVisible = !!opts.amountsVisible;
  const baseCurrency = normalizeBaseCurrency(opts.settings?.portfolioBaseCurrency);
  const first = legs[0].pos;
  const quoteCurrency = normalizeCurrencyCode(first.currency || first.sourceCurrency || baseCurrency, baseCurrency);
  const now = legs.map(l => Number(l.pos.underlyingPrice)).find(v => v > 0);
  const withQuote = legs.find(l => Number(l.pos.underlyingPrice) > 0)?.pos;
  const change = withQuote?.underlyingChange24h ?? null;
  const totals = groupTotals(legs.map(l => l.pos));
  const chart = withQuote?.underlyingPriceHistory ? createSparkline(withQuote.underlyingPriceHistory, 60, 24, change) : null;
  const useColoredPnL = opts.settings?.useColoredPnL ?? true;
  const signClass = v => (useColoredPnL && v != null ? (v >= 0 ? 'positive-pnl' : 'negative-pnl') : '');

  const cells = {
    asset: `${escapeHtml(underlying)}<span class="asset-terms">${escapeHtml(strategyTag(legs))}</span>${staleNoteHtml(stale)}`,
    expiry: escapeHtml(expiriesText(legs)),
    underlying: now ? formatPrice(now, true, quoteCurrency) : '—',
    price: now ? formatPrice(now, true, quoteCurrency) : '—',
    chart: chart || '—',
    value: totals.value !== null ? formatBaseMoney(totals.value, amountVisible, baseCurrency) : '—',
    pnl: totals.pnl !== null ? formatBaseMoney(totals.pnl, amountVisible, baseCurrency, true) : '—',
    funding: '',
    change: formatPct(change),
    amount: `${legs.length} legs`,
    exchange: escapeHtml(first.exchange || '—')
  };
  const tone = { pnl: signClass(totals.pnl), change: signClass(change) };
  for (const col of columnsFor(opts)) {
    const td = doc.createElement('td');
    td.className = cellClassFor(col);
    if (tone[col.key]) td.classList.add(tone[col.key]);
    td.innerHTML = cells[col.key] || '';
    if (col.key === 'asset') {
      const share = legs.reduce((acc, l) => acc + (opts.shares?.[`${l.pos.asset}_${l.pos.exchange}`] || 0), 0);
      if (share > 0) {
        td.style.setProperty('--share', `${(Math.min(1, share / (opts.largestShare || share)) * 100).toFixed(2)}%`);
        td.title = `${share >= 0.1 ? Math.round(share * 100) : (share * 100).toFixed(1)}% of portfolio`;
      }
    }
    if (col.key === 'exchange') td.title = first.exchange || '';
    tr.appendChild(td);
  }
  return tr;
}

function createStrategyDetailRow(doc, underlying, legs, opts, colSpan) {
  const baseCurrency = normalizeBaseCurrency(opts.settings?.portfolioBaseCurrency);
  const first = legs[0].pos;
  const quoteCurrency = normalizeCurrencyCode(first.currency || first.sourceCurrency || baseCurrency, baseCurrency);
  const facts = [`${legs.length} legs`, escapeHtml(strategyDescription(legs)), escapeAttr(first.exchange || '')];
  if (legs.every(l => l.atCost)) {
    const net = netPremium(legs);
    facts.push(`net premium ${net < 0 ? 'received' : 'paid'} ${formatPrice(Math.abs(net), true, quoteCurrency)}`);
  }
  const ladders = [...legsByExpiry(legs)].map(([, group]) =>
    `<div class="position-detail__ladder">${legsLadderHtml(group, { quoteCurrency, underlying })}</div>`).join('');
  const tr = doc.createElement('tr');
  tr.className = 'position-detail';
  const td = doc.createElement('td');
  td.colSpan = colSpan;
  td.innerHTML = `<div class="position-detail__facts">${facts.filter(Boolean).join(' · ')}</div>${ladders}`;
  tr.appendChild(td);
  return tr;
}

// How many positions a run of rows holds: a combined row counts each of its legs.
function positionsIn(rows) {
  return rows.reduce((n, p) => n + (p._strategy ? p._strategy.legs.length : 1), 0);
}

// A group's totals: value, P&L and funding over the rows that have a usable quote.
function groupTotals(rows) {
  const usable = rows.filter(p => !p.quoteLoading && !p.quoteUnavailable && !p.fxConversionMissing);
  const sum = (get) => usable.reduce((acc, p) => {
    const v = Number(get(p));
    return Number.isFinite(v) ? (acc ?? 0) + v : acc;
  }, null);
  return { value: sum(computeValue), pnl: sum(p => p.pnl), funding: sum(p => p.funding) };
}

// A perp's value is its notional, size × price, not money in the account: the perps head
// says so, so its total isn't read as part of the portfolio's.
function notionalNote(group) {
  return group.kind === 'perp' ? ' <span class="position-group__label">notional</span>' : '';
}

// A group folds to its head, as SRCL's accordion: ▾ open, ▸ folded. The totals stay in
// the head. Which kinds are folded is kept in this browser for the next visit.
const FOLD_KEY = 'positionsFolded';
function foldedKinds() {
  try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || '[]')); } catch (_) { return new Set(); }
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('.position-group__fold');
  if (!btn) return;
  const kind = btn.dataset.kind;
  const folded = foldedKinds();
  if (folded.has(kind)) folded.delete(kind); else folded.add(kind);
  try { localStorage.setItem(FOLD_KEY, JSON.stringify([...folded])); } catch (_) {}
  window._portfolioRenderer?.render?.();
  document.querySelector(`.position-group__fold[data-kind="${kind}"]`)?.focus({ preventScroll: true });
});

// The head of a run of rows: the kind on the left, its totals under the Value, P&L
// and Funding heads. Not a position: it does not open; its kind folds the group.
function createGroupRow(doc, group, opts, folded) {
  const amountVisible = !!opts.amountsVisible;
  const baseCurrency = normalizeBaseCurrency(opts.settings?.portfolioBaseCurrency);
  const totals = groupTotals(group.rows);
  const tr = doc.createElement('tr');
  tr.className = `position-group position-group--${group.kind}${folded ? ' is-folded' : ''}`;
  const cells = {
    asset: `<button type="button" class="position-group__fold" data-kind="${group.kind}" aria-expanded="${!folded}">` +
      `<span class="position-group__mark" aria-hidden="true">${folded ? '▸' : '▾'}</span>` +
      `<span class="position-group__label">${KIND_LABELS[group.kind]}</span><span class="position-group__count">${positionsIn(group.rows)}</span></button>`
  };
  if (totals.value !== null) cells.value = formatBaseMoney(totals.value, amountVisible, baseCurrency) + notionalNote(group);
  if (totals.pnl !== null) cells.pnl = formatBaseMoney(totals.pnl, amountVisible, baseCurrency, true);
  if (group.kind === 'perp' && totals.funding !== null) cells.funding = formatBaseMoney(totals.funding, amountVisible, baseCurrency, true);
  for (const col of columnsFor(opts)) {
    const td = doc.createElement('td');
    td.className = cellClassFor(col);
    td.innerHTML = cells[col.key] || '';
    tr.appendChild(td);
  }
  return tr;
}

function createMobileGroupLine(doc, group, opts) {
  const amountVisible = !!opts.amountsVisible;
  const baseCurrency = normalizeBaseCurrency(opts.settings?.portfolioBaseCurrency);
  const totals = groupTotals(group.rows);
  const line = doc.createElement('div');
  line.className = 'mobile-positions-group';
  line.innerHTML = `<span class="card-asset">${KIND_LABELS[group.kind]}</span>` +
    (totals.value !== null ? `<span class="card-value">${formatBaseMoney(totals.value, amountVisible, baseCurrency)}${notionalNote(group)}</span>` : '');
  return line;
}

// Cards are rebuilt on every refresh, so remember which ones the user opened.
const expandedCards = new Set();

function createMobileCard(doc, pos, opts) {
  const card = doc.createElement('div');
  card.className = 'mobile-position-card';
  if (pos.isStale) card.classList.add('is-stale');
  if (stockMarketOf(pos)) card.dataset.market = stockMarketOf(pos);
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
    // pnlValue: a merged row's value from the holdings that have a P&L.
    const basis = entryBasis > 0 ? entryBasis : (pos.isLeveraged ? 0 : (pos.pnlValue ?? value) - pos.pnl);
    if (Number.isFinite(basis) && basis > 0) pnlPctText = formatPct((pos.pnl / basis) * 100);
  }

  // 24h change rides next to the price; left out when there's no 24h figure.
  const changeText = pos.change24h != null || pos.marketLabel
    ? ` <span class="card-change ${changeClass}"${flash(change24hChanged)}${pos.marketLabel ? ` title="${escapeAttr(changeCellTitle(pos))}"` : ''}>(${formatChangeCell(pos)})</span>`
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
      <span class="card-meta"><span${flash(priceChanged)}>${priceText}</span>${changeText}${staleNoteHtml(pos)}</span>
      ${pnlText ? `<span class="card-pnl ${pnlClass}"${flash(pnlChanged)}><span class="card-label">P&amp;L</span> ${pnlText}${pnlPctText ? ` <span class="card-pnl-pct">${pnlPctText}</span>` : ''}</span>` : ''}
    </div>
    <div class="card-line card-sub card-details">
      <span class="card-exchange">${escapeHtml(pos.exchange || '—')}</span>
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

// The head row follows the column order; it is rebuilt only when that changes. The
// currency is on hover (the cells carry the symbol); the sort is marked for assistive tech.
function updateHeaders(tableBody, baseCurrency, opts) {
  const table = tableBody?.closest?.('table');
  const thead = table?.querySelector('thead');
  if (!thead) return;
  const columns = columnsFor(opts);
  const signature = columns.map(c => c.key).join(',');
  if (thead.dataset.columns !== signature) {
    thead.innerHTML = '<tr>' + columns.map(col => {
      const cls = [`th-${col.key}`, col.num ? 'num' : '', col.headClass || ''].filter(Boolean).join(' ');
      const label = escapeHtml(col.label);
      const inner = col.sort ? `<button type="button" class="th-sort" data-sort="${col.sort}">${label}</button>` : label;
      return `<th class="${cls}">${inner}</th>`;
    }).join('') + '</tr>';
    thead.dataset.columns = signature;
  }
  for (const key of ['value', 'pnl', 'funding']) {
    const th = thead.querySelector(`.th-${key}`);
    if (th) th.title = `In ${baseCurrency}`;
  }
  const sort = opts?.sort;
  thead.querySelectorAll('th').forEach(th => {
    const key = th.querySelector('.th-sort')?.dataset.sort;
    if (!key) return;
    if (sort?.key === key) th.setAttribute('aria-sort', sort.dir === 'asc' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  });
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
    updateHeaders(containers.positionsBody, baseCurrency, opts);
    bindFundingTooltip(containers.positionsBody);
    watchLayout(doc);
    // Only the layout showing is built (cardsShown is null when it can't tell: both).
    const cards = cardsShown(doc);
    const buildTable = cards !== true;
    const mobileContainer = cards === false ? null : containers.mobilePositionsContainer;

    const list = Array.isArray(positions) ? positions : [];
    const query = String(opts.query || '').trim().toLowerCase();
    const matching = list.filter(p => !shouldHidePosition(p, opts) && matchesQuery(p, query));
    // Several option legs on one name can show as one row that sorts by their total.
    const combine = opts.settings?.combineOptionLegs ?? true;
    const filtered = sortPositions(combine ? combineLegs(matching) : matching, opts.sort);

    const table = containers.positionsBody.closest('table');
    if (table) {
      table.classList.toggle('has-funding', matching.some(p => p.isLeveraged || p.funding != null));
      table.classList.toggle('has-options', matching.some(p => !!optionOf(p)));
    }
    const countEl = containers.positionsBody.closest('section')?.querySelector('.panel-count');
    if (countEl) countEl.textContent = matching.length > 0 ? String(matching.length) : '';

    if (filtered.length === 0) {
      const emptyRow = doc.createElement('tr');
      const emptyCell = doc.createElement('td');
      emptyCell.colSpan = POSITION_COLUMNS.length;
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
    const colSpan = buildTable ? visibleColumnCount(table) : 0;
    // Spot, perps and options are different things: each kind gets its own run of rows
    // under a head with its totals. One kind alone needs no head, and the setting can
    // ask for one list in sort order instead.
    const grouped = opts.settings?.groupPositions ?? true;
    const groups = grouped
      ? KIND_ORDER.map(kind => ({ kind, rows: filtered.filter(p => positionKind(p) === kind) })).filter(g => g.rows.length)
      : [{ kind: 'all', rows: filtered }];
    opts.optionLegs = legsByUnderlying(list);
    const folded = foldedKinds();
    for (const group of groups) {
      if (groups.length > 1) {
        if (buildTable) frag.appendChild(createGroupRow(doc, group, opts, folded.has(group.kind)));
        if (mobileContainer) mobileFrag.appendChild(createMobileGroupLine(doc, group, opts));
        if (folded.has(group.kind)) continue;
      }
      const addRow = (pos, leg) => {
        if (!buildTable) return;
        frag.appendChild(createTableRow(doc, pos, opts, prevDataMap, { leg }));
        if (opts.openKey === `${pos.asset}_${pos.exchange}`) {
          frag.appendChild(createDetailRow(doc, pos, opts, colSpan));
        }
      };
      for (const pos of group.rows) {
        if (!pos._strategy) {
          addRow(pos, false);
          if (mobileContainer) mobileFrag.appendChild(createMobileCard(doc, pos, opts));
          continue;
        }
        // Legs on one name: their row, and when open, each leg as a row and the
        // combined payoff under them.
        const { underlying, legs } = pos._strategy;
        if (buildTable) {
          frag.appendChild(createStrategyRow(doc, underlying, legs, opts));
          if (opts.openKey === strategyKey(underlying, legs)) {
            legs.forEach((leg, i) => addRow(leg.pos, i === legs.length - 1 ? 'last' : 'mid'));
            frag.appendChild(createStrategyDetailRow(doc, underlying, legs, opts, colSpan));
          }
        }
        if (mobileContainer) {
          for (const leg of legs) mobileFrag.appendChild(createMobileCard(doc, leg.pos, opts));
        }
      }
    }

    // Changed rows are replaced; remember what had keyboard focus (a row or one of its
    // actions) so it can be handed back to the new element.
    const active = doc.activeElement;
    const focusedRow = containers.positionsBody.contains(active)
      ? (active.closest('tr.position-detail')?.previousElementSibling || active.closest('tr'))
      : null;
    const focusedKey = focusedRow?.dataset?.key || null;
    const focusedAction = active?.dataset?.shortcut || null;

    // In one pass: rows whose HTML is the same stay, the rest are put in place.
    if (buildTable) patchRows(containers.positionsBody, frag);

    if (buildTable && focusedKey) {
      const row = Array.from(containers.positionsBody.querySelectorAll('tr.position-row'))
        .find(r => r.dataset.key === focusedKey);
      const target = focusedAction && row?.nextElementSibling?.classList.contains('position-detail')
        ? row.nextElementSibling.querySelector(`[data-shortcut="${focusedAction}"]`)
        : row;
      if (target && target !== doc.activeElement) target.focus({ preventScroll: true });
    }
    if (mobileContainer) {
      mobileContainer.replaceChildren(mobileFrag);
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
      if (mobileContainer) {
        const mobileFlashNodes = mobileContainer.querySelectorAll('[data-flash="true"]');
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
