// The chart window: one watchlist item's price, bigger and finer than its tile. A tile
// opens it (click, or Enter when focused) on the watchlist's period; ← → step to the
// previous or next item and ⌫ removes the item. Pointing at the line reads one point on
// the head line; pressing and dragging reads the change between two points, and the range
// stays until the next press or Esc. Your entry price, from the positions on screen, is a
// dashed line.
import { getPeriodHistoryByFeedIds } from '../data/providers/pyth.js';
import { get24hPriceHistory } from '../data/providers/stocks.js';
import { formatPrice } from '../utils/currency.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// Finer than the tiles: Hyperliquid candle interval and Yahoo [range, interval] per period.
const PERIODS = [
  { id: '1h', label: '1H', ms: HOUR, hl: '1m', yahoo: ['1d', '1m'] },
  { id: '1d', label: '1D', ms: DAY, hl: '5m', yahoo: ['1d', '5m'] },
  { id: '1w', label: '1W', ms: 7 * DAY, hl: '30m', yahoo: ['5d', '30m'] },
  { id: '1m', label: '1M', ms: 30 * DAY, hl: '2h', yahoo: ['1mo', '1h'] },
  { id: '1y', label: '1Y', ms: 365 * DAY, hl: '1d', yahoo: ['1y', '1d'] },
  { id: '5y', label: '5Y', ms: 5 * 365 * DAY, hl: '1w', yahoo: ['5y', '1wk'] },
  // Everything the source keeps: Hyperliquid from the coin's listing, Yahoo from the first trade.
  { id: 'all', label: 'All', ms: 50 * 365 * DAY, hl: '1w', yahoo: ['max', '1wk'] }
];
// The watchlist's tile periods, as this window's.
const FROM_TILES = { day: '1d', week: '1w', month: '1m', year: '1y' };
const MAX_POINTS = 400;
const CACHE_TTL_MS = 60 * 1000;

const cache = new Map(); // `${period}|${key}` -> { at, points }
let win = null;
let backdrop = null;
let ctx = null; // { items(), onRemove(key), onClose(key) }
let key = null;
let period = '1d';
let points = null; // [{ timestamp, price }] for key and period; null while loading
let series = []; // points with their x, y on the chart
let hover = -1;
let measure = null; // { a, b } indexes; set while dragging and kept after
let logChoice = null; // the Log toggle's setting for this period; null is the default
let dragging = false;
let loads = 0;
let tick = null;

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const items = () => ctx?.items() || [];
const current = () => items().find(i => i.key === key) || null;
const spec = () => PERIODS.find(p => p.id === period);
// A log scale shows years of growth evenly: on by default for 5Y and All.
const logScale = () => logChoice ?? (period === '5y' || period === 'all');

function price(v) {
  return formatPrice(v, { currency: current()?.currency || 'USD' });
}

function change(from, to) {
  if (!(from > 0) || !Number.isFinite(to)) return '';
  const diff = to - from;
  const pct = (diff / from) * 100;
  const sign = diff < 0 ? '−' : '+';
  return `${sign}${price(Math.abs(diff))} (${sign}${Math.abs(pct).toFixed(2)}%)`;
}

function when(t) {
  const d = new Date(t);
  const tz = window.larpTimeZone;
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz });
  if (period === '1h' || period === '1d') return time;
  if (period === '1w' || period === '1m') return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: tz })} ${time}`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: period === '5y' || period === 'all' ? 'numeric' : undefined, timeZone: tz });
}

function thin(list, count) {
  if (list.length <= count) return list;
  const step = (list.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => list[Math.round(i * step)]);
}

// Price axis: round steps of 1, 2 or 5 on a linear scale. On a log scale, 1, 2 and 5 of
// each power of ten; 1 to 9 when the range is narrow; linear steps when narrower still.
function priceTicks(lo, hi, log, count) {
  if (!(hi > lo)) return [lo];
  if (log) {
    const within = steps => {
      const out = [];
      for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
        for (const m of steps) {
          const v = Number((m * 10 ** e).toPrecision(12));
          if (v >= lo && v <= hi) out.push(v);
        }
      }
      return out;
    };
    for (const steps of [[1], [1, 2, 5], [1, 2, 3, 4, 5, 6, 7, 8, 9]]) {
      const out = within(steps);
      if (out.length >= 3 && out.length <= count + 2) return out;
    }
  }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 5, 10].find(s => s * mag >= raw) * mag;
  const out = [];
  for (let v = Math.ceil(lo / unit) * unit; v <= hi; v += unit) out.push(Number(v.toPrecision(12)));
  return out;
}

// As many digits as the step between labels needs, so two labels never read the same.
function axisPrice(v, unit) {
  const currency = current()?.currency || 'USD';
  const digits = Math.max(1, Math.min(6, Math.floor(Math.log10(v)) - Math.floor(Math.log10(unit)) + 1));
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, notation: v >= 1e4 ? 'compact' : 'standard',
      minimumSignificantDigits: Math.min(digits, 2), maximumSignificantDigits: Math.max(digits, 2)
    }).format(v);
  } catch (_) {
    return price(v);
  }
}

// Time axis: a label where the hour, day, month or year turns over, by period.
function timeTicks() {
  const parts = t => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    timeZone: window.larpTimeZone
  }).formatToParts(new Date(t)).map(p => [p.type, p.value]));
  const rule = {
    '1h': p => [`${p.hour}:${Math.floor(p.minute / 15)}`, `${p.hour}:${String(Math.floor(p.minute / 15) * 15).padStart(2, '0')}`],
    '1d': p => [`${p.day} ${Math.floor(p.hour / 3)}`, `${String(Math.floor(p.hour / 3) * 3).padStart(2, '0')}:00`],
    '1w': p => [`${p.month} ${p.day}`, `${p.month} ${p.day}`],
    '1m': p => [`${p.month} ${p.day}`, `${p.month} ${p.day}`],
    '1y': p => [`${p.year} ${p.month}`, p.month === 'Jan' ? p.year : p.month],
    '5y': p => [p.year, p.year],
    all: p => [p.year, p.year]
  }[period];
  const out = [];
  let prev = null;
  series.forEach((s, i) => {
    const [bucket, label] = rule(parts(s.t));
    if (prev !== null && bucket !== prev) out.push({ x: s.x, label });
    prev = bucket;
  });
  return out;
}

// Your average entry for this item, weighted by amount, from the positions on screen in
// the item's own currency. Null when you hold none with an entry price.
function entryFor(item) {
  const symbol = String(item?.symbol || '').toUpperCase();
  const currency = String(item?.currency || 'USD').toUpperCase();
  // Hyperliquid's builder-deployed perps carry their dex: "xyz:AAPL" is AAPL.
  const rows = (window.venuePositions || window.cachedPositions || []).filter(p =>
    String(p.asset || '').replace(/^[a-z0-9]+:/i, '').toUpperCase() === symbol &&
    Number(p.entryPrice) > 0 &&
    !p.isHlAccountEquity && !p.isLighterAccountEquity &&
    String(p.currency || p.sourceCurrency || 'USD').toUpperCase() === currency);
  if (!rows.length) return null;
  const weight = rows.reduce((s, p) => s + Math.abs(Number(p.amount) || 0), 0);
  return weight > 0
    ? rows.reduce((s, p) => s + Number(p.entryPrice) * Math.abs(Number(p.amount) || 0), 0) / weight
    : rows.reduce((s, p) => s + Number(p.entryPrice), 0) / rows.length;
}

async function fetchPoints(item, p) {
  if (item.provider === 'yahoo') {
    const [range, interval] = p.yahoo;
    return get24hPriceHistory(item.symbol, { range, interval, timeoutMs: 8000 });
  }
  if (!item.feedId) return [];
  const results = await getPeriodHistoryByFeedIds([item.feedId], p, MAX_POINTS);
  return results[item.feedId] || Object.values(results)[0] || [];
}

async function load() {
  const item = current();
  if (!item) { close(); return; }
  const p = spec();
  const id = `${period}|${item.key}`;
  const hit = cache.get(id);
  hover = -1;
  measure = null;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    points = hit.points;
    draw();
    return;
  }
  points = null;
  draw();
  const seq = ++loads;
  let list = [];
  try { list = await fetchPoints(item, p); } catch (_) { list = []; }
  list = (list || []).filter(x => Number.isFinite(x.price) && x.price > 0 && Number.isFinite(x.timestamp));
  // A closed market's last point is its last close: the period runs back from there.
  const last = list.length ? list[list.length - 1].timestamp : 0;
  list = thin(list.filter(x => x.timestamp >= last - p.ms), MAX_POINTS);
  cache.set(id, { at: Date.now(), points: list });
  if (seq !== loads) return;
  points = list;
  draw();
}

function chartHeight() {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 14;
  const unit = rem * 18 / 14;
  if (window.innerWidth <= 520) return Math.round(unit * 8);
  if (window.innerWidth <= 870) return Math.round(unit * 12);
  return Math.round(Math.max(unit * 12, Math.min(unit * 20, window.innerHeight * 0.45)));
}

// The line over the dim dither, drawn at the box's pixel size so the dither stays crisp.
// Points are spaced evenly, so a closed market's nights and weekends take no room.
// The title is a path, as SRCL's breadcrumbs: Watchlist ❯ BTC ❯ 1W. Watchlist goes back.
function title(item) {
  const label = PERIODS.find(p => p.id === period)?.label || '';
  win.querySelector('.window-title').innerHTML =
    '<button type="button" class="wlc__crumb js-wlc-back">Watchlist</button><span class="wlc__sep" aria-hidden="true">❯</span>' +
    `<span>${esc(item.symbol || '')}</span><span class="wlc__sep" aria-hidden="true">❯</span><span class="wlc__crumb-now">${esc(label)}</span>`;
}

function draw() {
  if (!win) return;
  const item = current();
  if (!item) return;
  title(item);
  win.querySelectorAll('.wlc__period').forEach(b => {
    b.setAttribute('aria-checked', String(b.dataset.period === period));
    b.tabIndex = b.dataset.period === period ? 0 : -1;
  });
  const log = win.querySelector('.wlc__log');
  log.setAttribute('aria-pressed', String(logScale()));
  const facts = [item.name, item.category].filter(Boolean).map(esc).join(' · ');
  win.querySelector('.wlc__facts').innerHTML = facts;

  const box = win.querySelector('.wlc__chart');
  const h = chartHeight();
  // One character and one line, for the axis labels' room.
  const cs = getComputedStyle(box);
  const measure2d = document.createElement('canvas').getContext('2d');
  measure2d.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const ch = measure2d.measureText('0').width || 8;
  const axisH = Math.round(parseFloat(cs.lineHeight) || ch * 2.2);
  box.style.height = `${h + axisH}px`;
  series = [];
  if (!points || points.length < 2) {
    box.innerHTML = `<p class="wlc__empty">${points ? 'No history for this period.' : '<span class="loading-terminal">Loading</span>'}</p>`;
    box.removeAttribute('role');
    win.querySelector('.wlc__rows').innerHTML = '';
    show();
    return;
  }

  const full = Math.max(100, Math.round(box.clientWidth));
  const prices = points.map(x => x.price);
  const f = logScale() ? Math.log : v => v;
  let lo = Math.min(...prices);
  let hi = Math.max(...prices);
  // The entry joins the scale when it sits near the line; far off, it is named at the edge.
  const entry = entryFor(item);
  const span = f(hi) - f(lo) || Math.abs(f(hi)) * 0.01 || 1;
  if (entry && f(entry) > f(lo) - span * 0.5 && f(entry) < f(hi) + span * 0.5) {
    lo = Math.min(lo, entry);
    hi = Math.max(hi, entry);
  }
  let [flo, fhi] = [f(lo), f(hi)];
  if (fhi === flo) { flo -= 1; fhi += 1; }
  const pad = Math.round(h * 0.08);
  const yOf = v => pad + (1 - (f(v) - flo) / (fhi - flo)) * (h - 2 * pad);
  // Prices sit in a gutter at the right, as wide as the longest label.
  const tickValues = priceTicks(Math.min(...prices), Math.max(...prices), logScale(), Math.max(3, Math.round(h / (axisH * 2.5))));
  const ticks = tickValues.map((v, i) => ({ v, label: axisPrice(v, Math.abs((tickValues[i + 1] ?? tickValues[i - 1] ?? v) - v) || v) }));
  const w = Math.round(full - (Math.max(...ticks.map(t => t.label.length)) + 2) * ch);
  const last = points.length - 1;
  series = points.map((x, i) => ({ t: x.timestamp, v: x.price, x: (i / last) * (w - 1), y: yOf(x.price) }));
  const pts = series.map(s => `${s.x.toFixed(1)},${s.y.toFixed(1)}`).join(' ');

  let entryHtml = '';
  if (entry) {
    const inside = entry >= lo && entry <= hi;
    const ey = inside ? Math.round(yOf(entry)) + 0.5 : entry > hi ? 0 : h;
    const label = `${inside ? '' : entry > hi ? '↑ ' : '↓ '}entry ${price(entry)}`;
    entryHtml = (inside ? `<line class="wlc__entry" x1="0" x2="${w}" y1="${ey}" y2="${ey}"/>` : '') +
      `<text class="wlc__label" x="${w - 4}" y="${inside ? ey - 4 : entry > hi ? 14 : h - 4}" text-anchor="end">${esc(label)}</text>`;
  }

  const yAxis = ticks.map(t => ({ ...t, y: Math.round(yOf(t.v)) + 0.5 })).filter(t => t.y > axisH / 2 && t.y < h - axisH / 2)
    .map(t => `<line class="wlc__grid" x1="0" x2="${w}" y1="${t.y}" y2="${t.y}"/>` +
      `<text class="wlc__tick" x="${w + ch}" y="${t.y}" dominant-baseline="middle">${esc(t.label)}</text>`).join('');
  // Time labels where they fit: every k-th turnover, none cut off at either edge.
  const turns = timeTicks();
  const lw = (Math.max(0, ...turns.map(t => t.label.length)) + 3) * ch;
  const k = Math.max(1, Math.ceil(turns.length * lw / w));
  const xAxis = turns.filter((t, i) => i % k === 0 && t.x >= lw / 2 - ch && t.x <= w - lw / 2 + ch)
    .map(t => `<line class="wlc__grid" x1="${Math.round(t.x) + 0.5}" x2="${Math.round(t.x) + 0.5}" y1="${h}" y2="${h + 4}"/>` +
      `<text class="wlc__tick" x="${t.x.toFixed(1)}" y="${h + axisH / 2 + 2}" text-anchor="middle" dominant-baseline="middle">${esc(t.label)}</text>`).join('');

  box.innerHTML =
    `<svg class="wlc__svg" width="${full}" height="${h + axisH}" viewBox="0 0 ${full} ${h + axisH}" aria-hidden="true">` +
    '<defs><pattern id="wlcDz" width="2" height="2" patternUnits="userSpaceOnUse"><rect class="pm-value__dot" width="1" height="1"/><rect class="pm-value__dot" x="1" y="1" width="1" height="1"/></pattern></defs>' +
    yAxis +
    `<line class="wlc__axis" x1="0" x2="${w}" y1="${h - 0.5}" y2="${h - 0.5}"/>` +
    `<line class="wlc__axis" x1="${w + 0.5}" x2="${w + 0.5}" y1="0" y2="${h}"/>` +
    xAxis +
    `<rect class="wlc__range" x="0" y="0" width="0" height="${h}" visibility="hidden"/>` +
    `<polygon points="0,${h} ${pts} ${w - 1},${h}" fill="url(#wlcDz)"/>` +
    `<polyline points="${pts}" class="pm-value__line" fill="none"/>` +
    entryHtml +
    `<line class="wlc__anchor" x1="0" x2="0" y1="0" y2="${h}" visibility="hidden"/>` +
    `<line class="pm-value__cursor" x1="0" x2="0" y1="0" y2="${h}" visibility="hidden"/>` +
    '<rect class="pm-value__point" width="5" height="5" x="0" y="0" visibility="hidden"/></svg>';
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', `${item.symbol}, ${spec().label}: ${price(prices[0])} to ${price(prices[last])}`);

  // High and low with their times; the open is the period's first point.
  const iHi = prices.indexOf(Math.max(...prices));
  const iLo = prices.indexOf(Math.min(...prices));
  const now = Number.isFinite(item.price) ? item.price : prices[last];
  const rows = [
    ['Open', `${price(prices[0])} · ${when(points[0].timestamp)}`],
    ['High', `${price(prices[iHi])} · ${when(points[iHi].timestamp)}`],
    ['Low', `${price(prices[iLo])} · ${when(points[iLo].timestamp)}`],
    entry && ['Your entry', `${price(entry)} · ${now >= entry ? '+' : '−'}${Math.abs((now / entry - 1) * 100).toFixed(2)}% since`]
  ].filter(Boolean);
  win.querySelector('.wlc__rows').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  show();
}

// The head line and the marks: the range being measured, else the point being pointed
// at, else the latest price and the change over the period.
function show() {
  if (!win) return;
  const item = current();
  const left = win.querySelector('.wlc__price');
  const right = win.querySelector('.wlc__change');
  const svg = win.querySelector('.wlc__svg');
  const mark = (sel, attrs) => {
    const n = svg?.querySelector(sel);
    if (!n) return;
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  };
  const live = Number.isFinite(item?.price) ? item.price : series[series.length - 1]?.v;
  // Changes run from the period's first point; on 1D from the quote's own day-ago price
  // (a stock's previous close), so the window says what the tile says.
  const day = period === '1d' && Number.isFinite(item?.change24h) && Number.isFinite(item?.price);
  const first = day ? item.price / (1 + item.change24h / 100) : series[0]?.v;
  const m = measure && measure.a !== measure.b ? measure : null;

  if (m) {
    const [a, b] = [Math.min(m.a, m.b), Math.max(m.a, m.b)];
    left.textContent = `${when(series[a].t)} → ${when(series[b].t)}`;
    right.textContent = change(series[a].v, series[b].v);
    mark('.wlc__range', { x: series[a].x.toFixed(1), width: (series[b].x - series[a].x).toFixed(1), visibility: 'visible' });
    mark('.wlc__anchor', { x1: Math.round(series[m.a].x) + 0.5, x2: Math.round(series[m.a].x) + 0.5, visibility: 'visible' });
  } else {
    mark('.wlc__range', { visibility: 'hidden' });
    mark('.wlc__anchor', { visibility: 'hidden' });
    if (hover >= 0 && series[hover]) {
      left.textContent = `${when(series[hover].t)} · ${price(series[hover].v)}`;
      right.textContent = change(first, series[hover].v);
    } else {
      left.textContent = Number.isFinite(live) ? price(live) : '—';
      right.textContent = series.length ? change(first, live) : '';
    }
  }
  const p = hover >= 0 ? series[hover] : null;
  if (p) {
    const cx = Math.round(p.x) + 0.5;
    mark('.pm-value__cursor', { x1: cx, x2: cx, visibility: 'visible' });
    mark('.pm-value__point', { x: (p.x - 2.5).toFixed(1), y: (p.y - 2.5).toFixed(1), visibility: 'visible' });
  } else {
    mark('.pm-value__cursor', { visibility: 'hidden' });
    mark('.pm-value__point', { visibility: 'hidden' });
  }
}

function nearest(e) {
  const box = win.querySelector('.wlc__chart');
  if (!series.length) return -1;
  const x = e.clientX - box.getBoundingClientRect().left;
  const i = Math.round((x / (series[series.length - 1].x || 1)) * (series.length - 1));
  return Math.max(0, Math.min(series.length - 1, i));
}

function step(by) {
  const list = items();
  const i = list.findIndex(x => x.key === key);
  if (i < 0 || list.length < 2) return;
  key = list[(i + by + list.length) % list.length].key;
  load();
}

function remove() {
  const list = items();
  const i = list.findIndex(x => x.key === key);
  if (i < 0) return;
  const next = list[i + 1] || list[i - 1];
  ctx.onRemove(key);
  if (!next) { close(); return; }
  key = next.key;
  load();
}

function close() {
  if (!win || win.style.display === 'none') return;
  win.style.display = 'none';
  backdrop.style.display = 'none';
  document.body.classList.remove('modal-open');
  clearInterval(tick);
  window.removeEventListener('resize', draw);
  ctx?.onClose?.(current() ? key : null);
}

function build() {
  backdrop = el('<div class="settings-backdrop" style="display: none;"></div>');
  win = el(
    '<div class="sticker-window pm-chart-window" role="dialog" aria-modal="true" aria-labelledby="pmChartTitle" style="display: none;">' +
    '<div class="sticker-window-header"><h2 id="pmChartTitle" class="window-title"></h2>' +
    '<button type="button" class="btn-text js-wlc-close">Close</button></div>' +
    '<div class="sticker-window-content wlc" tabindex="-1">' +
    '<p class="wlc__head" aria-live="polite"><span class="wlc__price"></span><span class="wlc__change"></span></p>' +
    '<div class="wlc__controls">' +
    `<div class="wlc__periods" role="radiogroup" aria-label="Period">${PERIODS.map(p =>
      `<button type="button" role="radio" class="wlc__period" data-period="${p.id}">${p.label}</button>`).join('')}</div>` +
    '<button type="button" class="wlc__log" aria-pressed="false"><span class="settings-switch__state" aria-hidden="true"></span>Log</button></div>' +
    '<div class="wlc__chart" tabindex="0"></div>' +
    '<dl class="wlc__rows"></dl>' +
    '<p class="wlc__facts"></p>' +
    '<p class="wlc__foot"><button type="button" class="link-button js-wlc-remove">Remove from watchlist</button></p>' +
    '</div></div>');
  document.body.append(backdrop, win);
  backdrop.addEventListener('click', close);
  win.querySelector('.js-wlc-close').addEventListener('click', close);
  win.querySelector('.js-wlc-remove').addEventListener('click', remove);
  win.querySelector('.wlc__periods').addEventListener('click', (e) => {
    const b = e.target.closest('.wlc__period');
    if (!b || b.dataset.period === period) return;
    period = b.dataset.period;
    logChoice = null;
    if (current()) title(current());
    load();
  });
  win.querySelector('.wlc__log').addEventListener('click', () => {
    logChoice = !logScale();
    draw();
  });
  win.querySelector('.window-title').addEventListener('click', (e) => {
    if (e.target.closest('.js-wlc-back')) close();
  });

  // Mouse: pointing reads a point, pressing and dragging measures. Touch: a drag measures
  // from where the finger landed; lifting it without a drag clears the point.
  const chart = win.querySelector('.wlc__chart');
  chart.addEventListener('pointerdown', (e) => {
    const i = nearest(e);
    if (i < 0 || e.button > 0) return;
    try { chart.setPointerCapture(e.pointerId); } catch (_) { /* the drag still reads within the box */ }
    dragging = true;
    measure = { a: i, b: i };
    hover = i;
    show();
  });
  chart.addEventListener('pointermove', (e) => {
    const i = nearest(e);
    if (i < 0) return;
    hover = i;
    if (dragging) measure.b = i;
    show();
  });
  const release = (e) => {
    if (!dragging) return;
    dragging = false;
    if (measure && measure.a === measure.b) measure = null;
    if (e.pointerType !== 'mouse') hover = -1;
    show();
  };
  chart.addEventListener('pointerup', release);
  chart.addEventListener('pointercancel', release);
  chart.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse' || dragging) return;
    hover = -1;
    show();
  });
  // By keyboard on the chart: ← → step along the line, Home and End jump to its ends.
  chart.addEventListener('keydown', (e) => {
    if (!series.length || e.metaKey || e.ctrlKey || e.altKey) return;
    const last = series.length - 1;
    const from = hover < 0 ? last : hover;
    const by = Math.max(1, Math.round(series.length / 40));
    const next = { ArrowLeft: from - by, ArrowRight: from + by, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    hover = Math.max(0, Math.min(last, next));
    show();
  });
  chart.addEventListener('blur', () => { hover = -1; show(); });

  // Anywhere else in the window: ← → the previous or next item, ⌫ removes it, Esc clears
  // a measured range first and then closes.
  win.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (measure) { measure = null; show(); } else close();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      step(e.key === 'ArrowRight' ? 1 : -1);
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      e.stopPropagation();
      remove();
    }
  });
}

export function openChartWindow({ key: openKey, tilePeriod, items: getItems, onRemove, onClose }) {
  if (!win) build();
  ctx = { items: getItems, onRemove, onClose };
  key = openKey;
  period = FROM_TILES[tilePeriod] || '1d';
  logChoice = null;
  backdrop.style.display = 'block';
  win.style.display = 'flex';
  document.body.classList.add('modal-open');
  window.addEventListener('resize', draw);
  // The head's price follows the watchlist's refreshes.
  clearInterval(tick);
  tick = setInterval(() => { if (!dragging && hover < 0 && !measure) show(); }, 5000);
  load();
  // Focus starts on the window itself, so ← → step through the items straight away (on the
  // periods they choose a period, as in every period row).
  win.querySelector('.wlc').focus({ preventScroll: true });
}

export default { openChartWindow };
