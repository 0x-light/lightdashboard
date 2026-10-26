// The chart window: one watchlist item's price over the whole screen, with the list at
// its side, bigger and finer than its tile. A tile
// opens it (click, or Enter when focused) on the watchlist's period; ← → step to the
// previous or next item, ⌫ removes the item, 1 to 7 choose a period and L turns Log on or
// off. Pointing at the line reads one point in a tag by the cursor; pressing and dragging
// reads the change between two points, and the range stays until the next press or Esc.
// Layers you turn on or off: your position (entry, liquidation, TP/SL, profit at the
// cursor), the period's high and low, volume, and day lines with weekends.
// Every action has a key, shown on its button: P H V D the layers, ↑ ↓ any item in the side
// list. In the grid, the arrows move between cells, ⇧ with an arrow moves the cell, ⌫ removes
// it, P shows the prices and + adds.
// Grid in a list's heading (or A) shows the whole list at once, each item a small chart on
// the period; one opens on its own. In the grid you remove, drag into order and add: the
// watchlist's grid changes the watchlist, the positions' grid only itself, until it closes.
import { getPeriodHistoryByFeedIds, historySource } from '../data/providers/pyth.js';
import { get24hPriceHistory } from '../data/providers/stocks.js';
import { fetchCandles } from '../data/providers/hyperliquid.js';
import { formatPrice, formatLevel } from '../utils/currency.js';

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
const FROM_TILES = { day: '1d', week: '1w', month: '1m', year: '1y', all: 'all' };
const MAX_POINTS = 400;
const CACHE_TTL_MS = 60 * 1000;
// Layers on the chart, each on or off; Position and Volume show only when there is one.
const LAYERS = [
  { id: 'position', label: 'Position', key: 'p' },
  { id: 'highlow', label: 'High/low', key: 'h' },
  { id: 'volume', label: 'Volume', key: 'v' },
  { id: 'days', label: 'Days', key: 'd' }
];
const LAYER_KEY = 'pmChartLayers';
// Day lines and weekends read only where a period spans a few days.
const DAY_PERIODS = new Set(['1d', '1w', '1m']);

const cache = new Map(); // `${period}|${key}` -> { at, points }
// When an item's history starts inside 1Y or 5Y: key -> its first point's time. Those
// periods show no more than All, so they are hidden and All shows the whole history.
const since = new Map();
let win = null;
let backdrop = null;
let lists = []; // [{ id, title, items(), onRemove(key)?, onClose(key)?, onAdd()? }], in the side list's order
let listId = null; // the list the open item is from: ← → and Remove work in it
let listHtml = '';
let key = null;
let period = '1d';
let points = null; // [{ timestamp, price }] for key and period; null while loading
let pointsAt = 0; // when points were fetched
let series = []; // points with their x, y on the chart
let hover = -1;
let measure = null; // { a, b } indexes; set while dragging and kept after
let logChoice = null; // the Log toggle's setting for this period; null is the default
let dragging = false;
let loads = 0;
let tick = null;
let layers = loadLayers();
let pos = null; // your position in the current item, or null
let scale = null; // { yOf, w, h, full, unit } of the drawn chart, for the live price tag
// The chart takes the room the page leaves it and redraws when that changes.
let sized = null;
let grid = null; // the list shown as a grid of small charts, by id; null shows one item
let gridHtml = ''; // the cells and the period, so the cells are rebuilt only when they change
const tried = new Set(); // `${period}|${key}` the grid has asked for
const queue = []; // the grid's points still to fetch
let running = 0;
// Changes in the positions' grid last until it closes: what you hid, added and moved.
let gridHidden = new Set();
let gridAdded = []; // [{ list, key }] from the other lists
let gridOrder = null; // keys, once you have moved one
let gridDragged = false; // the click that ends a drag opens nothing
let cellHover = null; // { key, x } of the cell chart being pointed at
// What + Add's search found and you added: the Added list, until the window closes.
let added = [];
let search = null; // the caller's search: query -> items, or null
let found = []; // the search's last items
let searchSeq = 0;
let searchWait = null;

function loadLayers() {
  const on = Object.fromEntries(LAYERS.map(l => [l.id, true]));
  try { Object.assign(on, JSON.parse(localStorage.getItem(LAYER_KEY) || '{}')); } catch (_) { /* all on */ }
  return on;
}

function saveLayers() {
  try { localStorage.setItem(LAYER_KEY, JSON.stringify(layers)); } catch (_) { /* this visit only */ }
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const active = () => lists.find(l => l.id === listId);
const items = () => active()?.items() || [];
const current = () => items().find(i => i.key === key) || null;
const gridList = () => lists.find(l => l.id === grid);
// One per asset: a position held in two places is one, summed.
function oncePerAsset(list) {
  const seen = new Set();
  return list.filter(i => {
    const id = `${String(i.symbol || i.label || '').toUpperCase()}|${i.currency || 'USD'}`;
    return !seen.has(id) && seen.add(id);
  });
}
// A list's items as its grid shows them: positions once per asset; in the open grid, without
// those you hid, with those you added, in the order you moved them to. Each knows its list.
function ownItems(id) {
  const l = lists.find(x => x.id === id);
  if (!l) return [];
  return (id === 'positions' ? oncePerAsset(l.items()) : l.items()).map(i => ({ ...i, list: id }));
}
function gridItems(id = grid) {
  const own = ownItems(id);
  if (id !== grid) return own;
  const added = gridAdded
    .map(a => ({ ...lists.find(x => x.id === a.list)?.items().find(i => i.key === a.key), list: a.list }))
    .filter(i => i.key && !own.some(o => o.key === i.key));
  const out = [...own, ...added].filter(i => !gridHidden.has(i.key));
  if (gridOrder) {
    const rank = new Map(gridOrder.map((k, i) => [k, i]));
    out.sort((a, b) => (rank.get(a.key) ?? Infinity) - (rank.get(b.key) ?? Infinity));
  }
  return out;
}
// A period the item's history does not fill.
const tooLong = (id, k = key) => (id === '1y' || id === '5y') && since.has(k) &&
  PERIODS.find(p => p.id === id).ms * 0.9 > Date.now() - since.get(k);
// All asks for the 1Y candles when the whole history is under a year, so a young item
// keeps daily points, not weekly ones.
const spec = () => {
  const p = PERIODS.find(x => x.id === period);
  return period === 'all' && tooLong('1y') ? { ...PERIODS.find(x => x.id === '1y'), id: 'all', label: p.label, ms: p.ms } : p;
};
// A log scale shows years of growth evenly: on by default for 5Y and All.
const logScale = () => logChoice ?? (period === '5y' || period === 'all');

function price(v, item = current()) {
  if (item?.category === 'index' || item?.category === 'fx') return formatLevel(v);
  return formatPrice(v, { currency: item?.currency || 'USD' });
}

function change(from, to) {
  if (!(from > 0) || !Number.isFinite(to)) return '';
  const diff = to - from;
  const pct = (diff / from) * 100;
  const sign = diff < 0 ? '−' : '+';
  return `${sign}${price(Math.abs(diff))} (${sign}${Math.abs(pct).toFixed(2)}%)`;
}

// A signed amount; from 1,000 up, whole.
function signed(v) {
  const abs = Math.abs(v) >= 1000 ? Math.round(Math.abs(v)) : Math.abs(v);
  return `${v < 0 ? '−' : '+'}${price(abs)}`;
}

function pctOf(r) {
  return `${r < 0 ? '−' : '+'}${Math.abs(r * 100).toFixed(2)}%`;
}

// How long a range lasts: 45m, 6h 15m, 3d 4h, 12d, 5mo, 2.4y.
function lasting(ms) {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m}m`;
  const hrs = Math.floor(m / 60);
  if (hrs < 24) return m % 60 ? `${hrs}h ${m % 60}m` : `${hrs}h`;
  const d = Math.floor(hrs / 24);
  if (d < 7) return hrs % 24 ? `${d}d ${hrs % 24}h` : `${d}d`;
  if (d < 60) return `${d}d`;
  const mo = Math.round(d / 30.44);
  return mo < 24 ? `${mo}mo` : `${(d / 365.25).toFixed(1)}y`;
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
  const item = current();
  const currency = item?.currency || 'USD';
  const plain = item?.category === 'index' || item?.category === 'fx';
  const digits = Math.max(1, Math.min(6, Math.floor(Math.log10(v)) - Math.floor(Math.log10(unit)) + 1));
  try {
    return new Intl.NumberFormat('en-US', {
      ...(plain ? {} : { style: 'currency', currency }), notation: v >= 1e4 ? 'compact' : 'standard',
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

// Your position in this item, from the positions on screen in the item's own currency:
// the rows with an entry price, their net amount, the average entry weighted by amount,
// and a perp's liquidation price and TP/SL orders. Null when you hold none with an entry.
function positionFor(item) {
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
  const entry = weight > 0
    ? rows.reduce((s, p) => s + Number(p.entryPrice) * Math.abs(Number(p.amount) || 0), 0) / weight
    : rows.reduce((s, p) => s + Number(p.entryPrice), 0) / rows.length;
  const amount = rows.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const liq = rows.map(p => Number(p.liquidationPx)).find(v => v > 0) || null;
  // Orders are there once the positions table has fetched them.
  const orders = rows.flatMap(p => window.hlOrders?.[p.asset] || [])
    .filter(o => (o.kind === 'tp' || o.kind === 'sl') && Number(o.px) > 0);
  return { rows, amount, entry, liq, orders };
}

// What your position gains or loses between its entry and a price.
function pnlAt(v) {
  return pos.rows.reduce((s, p) => s + (Number(p.amount) || 0) * (v - Number(p.entryPrice)), 0);
}

const side = () => (pos.amount < 0 ? 'short' : 'long');

async function fetchPoints(item, p) {
  if (item.provider === 'yahoo') {
    const [range, interval] = p.yahoo;
    return get24hPriceHistory(item.yahooSymbol || item.symbol, { range, interval, timeoutMs: 8000 });
  }
  if (item.provider === 'hyperliquid') {
    const now = Date.now();
    const candles = await fetchCandles(item.coin, p.hl, now - p.ms, now, 8000);
    return (candles || []).map(c => ({ timestamp: c.t, price: Number(c.c), volume: Number(c.v) }));
  }
  if (!item.feedId) return [];
  const results = await getPeriodHistoryByFeedIds([item.feedId], p, MAX_POINTS);
  return results[item.feedId] || Object.values(results)[0] || [];
}

// One item's points for a period: the cache's while fresh, else fetched, cut to the
// period and kept. A refusal gives what the cache last had.
async function pointsFor(item, periodId) {
  const p = PERIODS.find(x => x.id === periodId);
  const id = `${periodId}|${item.key}`;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.points;
  let list = [];
  try { list = await fetchPoints(item, p); } catch (_) { list = []; }
  list = (list || []).filter(x => Number.isFinite(x.price) && x.price > 0 && Number.isFinite(x.timestamp));
  const last = list.length ? list[list.length - 1].timestamp : 0;
  list = thin(list.filter(x => x.timestamp >= last - p.ms), MAX_POINTS);
  if (list.length) cache.set(id, { at: Date.now(), points: list });
  return list.length ? list : hit?.points || [];
}

// The grid's points it has none of for the period, three at a time, so the sources do not
// refuse; each cell draws as its points come.
function requestPoints(list) {
  for (const item of list) {
    const id = `${period}|${item.key}`;
    const hit = cache.get(id);
    if (tried.has(id) || queue.some(q => q.id === id) || (hit && Date.now() - hit.at < CACHE_TTL_MS)) continue;
    queue.push({ id, item, period });
  }
  while (running < 3 && queue.length) fetchQueued(queue.shift());
}

async function fetchQueued(job) {
  if (job.period !== period || !grid) return;
  running++;
  await pointsFor(job.item, job.period);
  running--;
  tried.add(job.id);
  if (grid) draw();
  requestPoints([]);
}

async function load() {
  if (grid) { draw(); return; }
  const item = current();
  if (!item) { close(); return; }
  if (tooLong(period, item.key)) period = 'all';
  const p = spec();
  const id = `${period}|${item.key}`;
  const hit = cache.get(id);
  hover = -1;
  measure = null;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    points = hit.points;
    pointsAt = hit.at;
    draw();
    return;
  }
  points = hit ? hit.points : null;
  draw();
  const seq = ++loads;
  let list = [];
  try { list = await fetchPoints(item, p); } catch (_) { list = []; }
  list = (list || []).filter(x => Number.isFinite(x.price) && x.price > 0 && Number.isFinite(x.timestamp));
  // A closed market's last point is its last close: the period runs back from there.
  const last = list.length ? list[list.length - 1].timestamp : 0;
  list = thin(list.filter(x => x.timestamp >= last - p.ms), MAX_POINTS);
  // A history that starts well inside 1Y or 5Y shows what All shows: the window moves to All.
  if ((period === '1y' || period === '5y') && list.length >= 2 && list[0].timestamp > last - p.ms * 0.9) {
    since.set(item.key, list[0].timestamp);
    if (seq === loads) load();
    return;
  }
  // A source that refuses for a while (Hyperliquid and Yahoo answer 429 when asked too often)
  // gives nothing, as a missing history does: nothing is kept, so the next try asks again,
  // and the line this period last had stays on screen meanwhile.
  const at = list.length ? Date.now() : hit?.at || 0;
  if (list.length) cache.set(id, { at, points: list });
  else if (hit) list = hit.points;
  if (seq !== loads) return;
  points = list;
  pointsAt = at;
  draw();
}

// The line over the dim dither, drawn at the box's pixel size so the dither stays crisp.
// Points are spaced evenly, so a closed market's nights and weekends take no room.
// Above the price: the asset's name and its ticker, as "Bitcoin BTC". A feed's name is the
// pair in capitals ("BITCOIN / US DOLLAR"): only the asset is kept, in title case.
function nameLine(item) {
  const ticker = item.label || item.symbol || '';
  let name = String(item.name || '').split(' / ')[0].trim();
  if (name && name === name.toUpperCase()) name = name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  if (!name || name.toUpperCase() === ticker.toUpperCase()) return esc(ticker);
  return `${esc(name)} <span class="wlc__ticker">${esc(ticker)}</span>`;
}

// The title is a path, as SRCL's breadcrumbs: Watchlist ❯ BTC. The first part, where the
// window came from, goes back; the period shows in its own row.
function title(item) {
  win.querySelector('.window-title').innerHTML =
    `<button type="button" class="wlc__crumb js-wlc-back">${esc(active().title)}</button><span class="wlc__sep" aria-hidden="true">❯</span>` +
    `<span>${esc(item.label || item.symbol || '')}</span>`;
}

// The side list: each list under its heading (one with no items is left out, unless you
// can add to it), every item with its price and 24h change; the open one is lit. Grid in a
// heading shows that list as a grid, lit while it does. It is
// rebuilt only when it changes, so the refreshes keep focus and hover.
function list() {
  const nav = win.querySelector('.wlc__list');
  const html = lists.map(l => {
    const rows = l.items();
    if (!rows.length && !l.onAdd) return '';
    return `<p class="wlc__list-head"><span>${esc(l.title)}</span><span class="wlc__list-tools">` +
      (gridItems(l.id).length >= 2 ? `<button type="button" class="btn-text panel-action js-wlc-grid" data-list="${esc(l.id)}" aria-pressed="${grid === l.id}">Grid</button>` : '') +
      (l.onAdd ? '<button type="button" class="btn-text panel-action js-wlc-add">+ Add</button>' : '') + '</span></p>' +
      rows.map(i => {
        const ch = Number.isFinite(i.change24h) ? `${i.change24h < 0 ? '−' : '+'}${Math.abs(i.change24h).toFixed(2)}%` : '';
        const level = i.category === 'index' || i.category === 'fx';
        return `<button type="button" class="wlc__item" data-list="${esc(l.id)}" data-key="${esc(i.key)}" aria-current="${!grid && l.id === listId && i.key === key}">` +
          `<span>${esc(i.label || i.symbol || '')}</span><span class="wlc__item-price">${!Number.isFinite(i.price) ? '—' : esc(level ? formatLevel(i.price) : formatPrice(i.price, { currency: i.currency || 'USD' }))}</span>` +
          `<span class="wlc__item-change">${esc(ch)}</span></button>`;
      }).join('');
  }).join('');
  if (html !== listHtml) nav.innerHTML = listHtml = html;
}

// Under the figures: the kind of asset, where its prices come from and when they came.
function facts(item) {
  const kind = item.category === 'fx' ? 'FX' : String(item.category || '').replace(/^\w/, c => c.toUpperCase());
  const from = item.provider === 'yahoo' || item.provider === 'hyperliquid' ? item.provider : historySource(item.feedId);
  const source = { yahoo: 'Yahoo Finance', hyperliquid: 'Hyperliquid' }[from] || '';
  const updated = points?.length && pointsAt
    ? `Updated ${new Date(pointsAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: window.larpTimeZone })}`
    : '';
  return [kind, source, updated].filter(Boolean).join(' · ');
}

function draw() {
  if (!win) return;
  // Narrow, with no side list, the title bar has Grid for the open item's list.
  const all = win.querySelector('.js-wlc-all');
  all.hidden = gridItems(grid || listId).length < 2;
  all.setAttribute('aria-pressed', String(!!grid));
  win.querySelector('.wlc').classList.toggle('wlc--grid', !!grid);
  // Price in the grid: each cell's latest price large over its chart.
  win.querySelector('.wlc').classList.toggle('wlc--big', !!layers.gridPrice);
  win.querySelector('.js-wlc-grid-price').setAttribute('aria-pressed', String(!!layers.gridPrice));
  win.querySelectorAll('.wlc__period').forEach(b => {
    b.setAttribute('aria-checked', String(b.dataset.period === period));
    b.tabIndex = b.dataset.period === period ? 0 : -1;
    b.hidden = !grid && tooLong(b.dataset.period);
  });
  if (grid) { list(); drawGrid(); return; }
  const item = current();
  if (!item) return;
  title(item);
  const log = win.querySelector('.wlc__log');
  log.setAttribute('aria-pressed', String(logScale()));
  win.querySelector('.wlc__name').innerHTML = nameLine(item);
  win.querySelector('.wlc__facts').textContent = facts(item);
  win.querySelector('.wlc__foot').hidden = !active().onRemove;
  pos = positionFor(item);

  list();

  const box = win.querySelector('.wlc__chart');
  // One character and one line, for the axis labels' room.
  const cs = getComputedStyle(box);
  const measure2d = document.createElement('canvas').getContext('2d');
  measure2d.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const ch = measure2d.measureText('0').width || 8;
  const axisH = Math.round(parseFloat(cs.lineHeight) || ch * 2.2);
  const h = Math.max(axisH * 4, box.clientHeight - axisH);
  series = [];
  scale = null;
  if (!points || points.length < 2) {
    box.innerHTML = `<p class="wlc__empty">${points
      ? 'No prices came back for this period. <button type="button" class="link-button js-wlc-retry">Try again</button>'
      : '<span class="loading-terminal">Loading</span>'}</p>`;
    box.removeAttribute('role');
    win.querySelector('.wlc__rows').innerHTML = '';
    win.querySelector('.wlc__pos').innerHTML = '';
    layerButtons(false);
    show();
    return;
  }

  const full = Math.max(100, Math.round(box.clientWidth));
  const prices = points.map(x => x.price);
  const pmin = Math.min(...prices);
  const pmax = Math.max(...prices);
  const f = logScale() ? Math.log : v => v;
  let lo = pmin;
  let hi = pmax;
  // Your levels join the scale when they sit near the line; far off, they are named at the edge.
  const showPos = layers.position && pos;
  const levels = showPos ? [
    { cls: 'wlc__entry', px: pos.entry, name: 'entry' },
    pos.liq && { cls: 'wlc__liq', px: pos.liq, name: 'liq' },
    ...pos.orders.map(o => ({ cls: 'wlc__order', px: Number(o.px), name: o.kind.toUpperCase() }))
  ].filter(Boolean) : [];
  const span = f(hi) - f(lo) || Math.abs(f(hi)) * 0.01 || 1;
  for (const l of levels) {
    if (f(l.px) > f(pmin) - span * 0.5 && f(l.px) < f(pmax) + span * 0.5) {
      lo = Math.min(lo, l.px);
      hi = Math.max(hi, l.px);
    }
  }
  let [flo, fhi] = [f(lo), f(hi)];
  if (fhi === flo) { flo -= 1; fhi += 1; }
  // Room above the high and below the low for their labels.
  const pad = Math.round(Math.max(h * 0.08, layers.highlow ? axisH : 0));
  const yOf = v => pad + (1 - (f(v) - flo) / (fhi - flo)) * (h - 2 * pad);
  // Prices sit inside the chart at the right edge, so the line has the full width.
  const tickValues = priceTicks(pmin, pmax, logScale(), Math.max(3, Math.round(h / (axisH * 2.5))));
  const ticks = tickValues.map((v, i) => ({ v, label: axisPrice(v, Math.abs((tickValues[i + 1] ?? tickValues[i - 1] ?? v) - v) || v) }));
  const unit = Math.abs((tickValues[1] ?? tickValues[0] * 2) - tickValues[0]) || pmax;
  const w = full;
  // Your levels' labels and the high and low keep clear of the price labels.
  const edge = Math.round(w - (Math.max(...ticks.map(t => t.label.length)) + 2) * ch);
  const last = points.length - 1;
  series = points.map((x, i) => ({ t: x.timestamp, v: x.price, x: (i / last) * (w - 1), y: yOf(x.price) }));
  const pts = series.map(s => `${s.x.toFixed(1)},${s.y.toFixed(1)}`).join(' ');
  scale = { yOf, w, h, full, unit };

  // Your levels: a line where each sits on the scale, its label at the right; the side
  // past the liquidation price is hatched.
  let levelHtml = '';
  const labels = [];
  for (const l of levels) {
    const inside = l.px >= lo && l.px <= hi;
    const y = Math.round(yOf(l.px)) + 0.5;
    const arrow = inside ? '' : l.px > hi ? '↑ ' : '↓ ';
    labels.push({ y: inside ? y - 4 : l.px > hi ? 14 : h - 4, text: `${arrow}${l.name} ${price(l.px)}` });
    if (!inside) continue;
    levelHtml += `<line class="${l.cls}" x1="0" x2="${w}" y1="${y}" y2="${y}"/>`;
    if (l.cls === 'wlc__liq') {
      const [y1, y2] = pos.amount < 0 ? [0, y] : [y, h];
      levelHtml += `<rect x="0" y="${y1}" width="${w}" height="${Math.max(0, y2 - y1)}" fill="url(#wlcHatch)"/>`;
    }
  }
  // Labels never sit on one another: each is at least a line below the one above it.
  const lineH = axisH * 0.85;
  labels.sort((a, b) => a.y - b.y).forEach((l, i, list) => {
    if (i && l.y - list[i - 1].y < lineH) l.y = list[i - 1].y + lineH;
  });
  // Those pushed past the bottom stack up from it.
  for (let i = labels.length - 1; i >= 0; i--) {
    labels[i].y = Math.min(i < labels.length - 1 ? labels[i + 1].y - lineH : h - 4, labels[i].y);
  }
  // Each label's box, from its baseline and its length in characters.
  const boxOf = (x, y, len, anchor, hanging) => {
    const width = len * ch;
    const left = anchor === 'end' ? x - width : x;
    const top = hanging ? y : y - lineH;
    return { left, right: left + width, top, bottom: top + lineH };
  };
  const hits = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  labels.forEach(l => { l.box = boxOf(edge - 4, l.y, l.text.length, 'end', false); });

  // The high and the low, named where they are on the line: on the side of the point with
  // room and clear of your levels' labels; when both sides are taken, the level's label
  // moves past the name.
  const iHi = prices.indexOf(pmax);
  const iLo = prices.indexOf(pmin);
  let hlHtml = '';
  if (layers.highlow) {
    const named = (i, text, above) => {
      const s = series[i];
      const y = above ? s.y - 6 : s.y + 6;
      const sides = (s.x > w / 2 ? ['end', 'start'] : ['start', 'end'])
        .map(anchor => ({ anchor, x: s.x + (anchor === 'end' ? -4 : 4) }))
        .map(o => ({ ...o, box: boxOf(o.x, y, text.length, o.anchor, !above) }))
        .filter(o => o.box.left >= 0 && o.box.right <= edge);
      const pick = sides.find(o => !labels.some(l => hits(l.box, o.box))) || sides[0] ||
        { anchor: 'start', x: s.x + 4, box: boxOf(s.x + 4, y, text.length, 'start', !above) };
      // Labels that move stack, one line apart.
      let moved = 0;
      for (const l of labels) {
        if (!hits(l.box, pick.box)) continue;
        l.y = pick.box.top - 2 - moved * lineH >= lineH ? pick.box.top - 2 - moved * lineH : pick.box.bottom + (moved + 1) * lineH;
        moved++;
        l.box = boxOf(edge - 4, l.y, l.text.length, 'end', false);
      }
      return `<text class="wlc__hl" x="${pick.x.toFixed(1)}" y="${y.toFixed(1)}"` +
        ` text-anchor="${pick.anchor}" dominant-baseline="${above ? 'auto' : 'hanging'}">${esc(text)}</text>`;
    };
    hlHtml = named(iHi, `H ${price(pmax)}`, true) + named(iLo, `L ${price(pmin)}`, false);
  }
  const labelHtml = labels.map(l =>
    `<text class="wlc__label" x="${edge - 4}" y="${l.y.toFixed(1)}" text-anchor="end">${esc(l.text)}</text>`).join('');

  // Volume: a bar under each point, the period's largest a fifth of the chart's height.
  const vols = points.map(x => Number(x.volume) || 0);
  const vmax = Math.max(...vols);
  let volHtml = '';
  if (layers.volume && vmax > 0) {
    const bw = Math.max(1, (w / series.length) * 0.6);
    volHtml = '<g class="wlc__vol">' + series.map((s, i) => {
      const bh = (vols[i] / vmax) * h * 0.2;
      return bh >= 0.5 ? `<rect x="${(s.x - bw / 2).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}"/>` : '';
    }).join('') + '</g>';
  }

  // Days: a line where each day starts and a shade over Saturdays and Sundays. A closed
  // market has no points on its weekends, so only what trades then shows one.
  let dayHtml = '';
  if (layers.days && DAY_PERIODS.has(period)) {
    const fmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', timeZone: window.larpTimeZone });
    const half = w / last / 2;
    let prev = null;
    let weekend = null;
    const shade = (a, b) => `<rect class="wlc__weekend" x="${Math.max(0, a).toFixed(1)}" y="0" width="${(Math.min(w, b) - Math.max(0, a)).toFixed(1)}" height="${h}"/>`;
    series.forEach((s, i) => {
      const day = fmt.format(new Date(s.t));
      const isWeekend = day.startsWith('Sat') || day.startsWith('Sun');
      if (prev !== null && day !== prev) {
        const x = Math.round(s.x - half) + 0.5;
        dayHtml += `<line class="wlc__day" x1="${x}" x2="${x}" y1="0" y2="${h}"/>`;
      }
      if (isWeekend && weekend === null) weekend = i ? s.x - half : 0;
      if (!isWeekend && weekend !== null) { dayHtml = shade(weekend, s.x - half) + dayHtml; weekend = null; }
      prev = day;
    });
    if (weekend !== null) dayHtml = shade(weekend, w) + dayHtml;
  }

  // Grid lines under the line, their prices over it.
  const yTicks = ticks.map(t => ({ ...t, y: Math.round(yOf(t.v)) + 0.5 })).filter(t => t.y > axisH / 2 && t.y < h - axisH / 2);
  const yGrid = yTicks.map(t => `<line class="wlc__grid" x1="0" x2="${w}" y1="${t.y}" y2="${t.y}"/>`).join('');
  const yLabels = yTicks.map(t =>
      `<text class="wlc__ytick" x="${w - ch}" y="${t.y}" text-anchor="end" dominant-baseline="middle">${esc(t.label)}</text>`).join('');
  // Time labels where they fit: every k-th turnover, none cut off at either edge.
  const turns = timeTicks();
  const lw = (Math.max(0, ...turns.map(t => t.label.length)) + 3) * ch;
  const k = Math.max(1, Math.ceil(turns.length * lw / w));
  const xAxis = turns.filter((t, i) => i % k === 0 && t.x >= lw / 2 - ch && t.x <= w - lw / 2 + ch)
    .map(t => `<line class="wlc__grid" x1="${Math.round(t.x) + 0.5}" x2="${Math.round(t.x) + 0.5}" y1="${h}" y2="${h + 4}"/>` +
      `<text class="wlc__tick" x="${t.x.toFixed(1)}" y="${h + axisH / 2 + 2}" text-anchor="middle" dominant-baseline="middle">${esc(t.label)}</text>`).join('');

  box.innerHTML =
    `<svg class="wlc__svg" width="${full}" height="${h + axisH}" viewBox="0 0 ${full} ${h + axisH}" aria-hidden="true">` +
    '<defs><pattern id="wlcDz" width="2" height="2" patternUnits="userSpaceOnUse"><rect class="pm-value__dot" width="1" height="1"/><rect class="pm-value__dot" x="1" y="1" width="1" height="1"/></pattern>' +
    '<pattern id="wlcHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="wlc__hatch" x1="0" y1="0" x2="0" y2="6"/></pattern></defs>' +
    dayHtml +
    yGrid +
    `<line class="wlc__axis" x1="0" x2="${w}" y1="${h - 0.5}" y2="${h - 0.5}"/>` +
    xAxis +
    `<rect class="wlc__range" x="0" y="0" width="0" height="${h}" visibility="hidden"/>` +
    `<polygon points="0,${h} ${pts} ${w - 1},${h}" fill="url(#wlcDz)"/>` +
    volHtml +
    levelHtml +
    `<line class="wlc__nowline" x1="0" x2="${w}" y1="0" y2="0" visibility="hidden"/>` +
    `<polyline points="${pts}" class="pm-value__line" fill="none"/>` +
    yLabels +
    hlHtml +
    labelHtml +
    `<line class="wlc__anchor" x1="0" x2="0" y1="0" y2="${h}" visibility="hidden"/>` +
    `<line class="pm-value__cursor" x1="0" x2="0" y1="0" y2="${h}" visibility="hidden"/>` +
    '<rect class="pm-value__point" width="5" height="5" x="0" y="0" visibility="hidden"/></svg>' +
    '<span class="wlc__now" aria-hidden="true" hidden></span>' +
    '<p class="wlc__tip" aria-live="polite" hidden></p>';
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', `${item.label || item.symbol}, ${spec().label}: ${price(prices[0])} to ${price(prices[last])}`);

  // The period: open and close, high and low.
  const rows = [
    ['Open', price(prices[0])],
    ['Close', price(prices[last])],
    ['High', price(pmax)],
    ['Low', price(pmin)]
  ];
  win.querySelector('.wlc__rows').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  // Your position on one line: side and size, entry, liquidation and profit now.
  const now = Number.isFinite(item.price) ? item.price : prices[last];
  const held = showPos ? [
    [side() === 'short' ? 'Short' : 'Long', Math.abs(pos.amount).toLocaleString('en-US', { maximumFractionDigits: 4 })],
    ['Entry', price(pos.entry)],
    pos.liq && ['Liq', price(pos.liq)],
    ['P&L', `${signed(pnlAt(now))} ${pctOf(pnlAt(now) / (Math.abs(pos.amount) * pos.entry || 1))}`]
  ].filter(Boolean) : [];
  win.querySelector('.wlc__pos').innerHTML = held.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  layerButtons(true, vmax > 0);
  show();
}

// How many cells across: the count whose cells come nearest twice as wide as high, with the
// rows filling the height and no cell under 30 characters wide. With too many to fit, as
// many across as fit and the rows scroll at their least height.
function columns(n, box) {
  const cs = getComputedStyle(box);
  const ch = parseFloat(cs.fontSize) * 0.6;
  const minW = ch * 30;
  const minH = (parseFloat(cs.lineHeight) || ch * 2) * 7;
  let best = 0;
  let bestScore = Infinity;
  for (let c = 1; c <= n; c++) {
    const w = box.clientWidth / c;
    const h = box.clientHeight / Math.ceil(n / c);
    if (c > 1 && w < minW) break;
    if (h < minH) continue;
    const score = Math.abs(Math.log(w / h / 2));
    if (score < bestScore) { best = c; bestScore = score; }
  }
  return best || Math.max(1, Math.min(n, Math.floor(box.clientWidth / minW)));
}

// The grid: a cell for each item, with its ticker, price and change over the period, your
// side and profit, and its line with your entry, to the cell's edges. The cells fill the
// space in rows of equal height; a short last row's cells widen to fill it. They are built
// once for a period and a layout and filled on each draw, so the refreshes keep focus and hover.
function drawGrid() {
  const l = gridList();
  win.querySelector('.window-title').textContent = l.title;
  const box = win.querySelector('.wlc__all');
  const all = gridItems();
  requestPoints(all);
  // The watchlist's grid ends in a cell that adds to it; it takes a place as the others do.
  const adds = !!l.onAdd;
  const across = columns(all.length + (adds ? 1 : 0), box);
  const cell = i =>
    `<div class="wlc__cell" data-key="${esc(i.key)}" data-list="${esc(i.list)}">` +
    '<button type="button" class="wlc__cell-open"><span class="wlc__cell-head"><span class="wlc__cell-name"></span><span class="wlc__cell-price"></span>' +
    '<span class="wlc__cell-pos"></span><span class="wlc__cell-change"></span></span><span class="wlc__cell-chart"></span></button>' +
    `<button type="button" class="wlc__cell-x" aria-label="${esc(`${l.onRemove && i.list === l.id ? 'Remove' : 'Hide'} ${i.label || i.symbol || ''}`)}">×</button></div>`;
  const cells = all.map(cell);
  if (adds) cells.push(`<div class="wlc__cell wlc__cell--add"><button type="button" class="wlc__cell-add">+ Add to ${esc(l.title.toLowerCase())}</button></div>`);
  let html = '';
  for (let r = 0; r < cells.length; r += across) html += `<div class="wlc__row">${cells.slice(r, r + across).join('')}</div>`;
  win.querySelector('.js-wlc-grid-add').hidden = adds;
  if (html + period !== gridHtml) {
    // The cell in focus keeps it when the cells are rebuilt (moved, removed, refreshed).
    const focused = box.contains(document.activeElement) ? document.activeElement.closest('.wlc__cell') : null;
    box.innerHTML = html || '<p class="wlc__empty">Nothing to show. Add an item.</p>';
    gridHtml = html + period;
    if (focused) focusCell(focused.dataset.key ?? 'add');
  }
  const label = PERIODS.find(x => x.id === period)?.label || '';
  box.querySelectorAll('.wlc__cell').forEach(cell => {
    const item = all.find(i => i.key === cell.dataset.key);
    if (!item) return;
    const open = cell.querySelector('.wlc__cell-open');
    const pts = cache.get(`${period}|${item.key}`)?.points || [];
    const prices = pts.map(x => x.price);
    const live = Number.isFinite(item.price) ? item.price : prices[prices.length - 1];
    // As the window's head: on 1D from the quote's day-ago price, else from the first point.
    const first = period === '1d' && Number.isFinite(item.change24h) && Number.isFinite(item.price)
      ? item.price / (1 + item.change24h / 100) : prices[0];
    cell.querySelector('.wlc__cell-name').textContent = item.label || item.symbol || '';
    cell.querySelector('.wlc__cell-price').textContent = Number.isFinite(live) ? price(live, item) : '—';
    // The period is in the period row, so the change is the figure alone.
    const changeText = first > 0 && Number.isFinite(live) ? pctOf(live / first - 1) : '';
    cell.querySelector('.wlc__cell-change').textContent = changeText;
    // Under the ticker: your profit at full strength, then your side and entry, muted; a
    // narrow cell cuts the entry, not the profit.
    const mine = positionFor(item);
    let side = '';
    let pnlText = '';
    if (mine && Number.isFinite(live)) {
      const pnl = mine.rows.reduce((s, p) => s + (Number(p.amount) || 0) * (live - Number(p.entryPrice)), 0);
      const abs = Math.abs(pnl) >= 1000 ? Math.round(Math.abs(pnl)) : Math.abs(pnl);
      side = `${mine.amount < 0 ? 'short' : 'long'} from ${price(mine.entry, item)}`;
      pnlText = `${pnl < 0 ? '−' : '+'}${price(abs, item)}`;
    }
    cell.querySelector('.wlc__cell-pos').innerHTML = side ? `<span class="wlc__cell-pnl">${esc(pnlText)}</span>  ${esc(side)}` : '';
    open.setAttribute('aria-label', [item.label || item.symbol, cell.querySelector('.wlc__cell-price').textContent,
      changeText && `${changeText} ${label}`, pnlText, side].filter(Boolean).join(', '));

    const chart = cell.querySelector('.wlc__cell-chart');
    if (pts.length < 2) {
      chart.innerHTML = `<span class="wlc__empty">${tried.has(`${period}|${item.key}`) ? 'No prices' : '<span class="loading-terminal">Loading</span>'}</span>`;
      return;
    }
    const w = Math.max(40, Math.round(chart.clientWidth));
    const h = Math.max(20, Math.round(chart.clientHeight));
    const f = logScale() ? Math.log : v => v;
    let lo = Math.min(...prices);
    let hi = Math.max(...prices);
    // Your entry joins the scale when it sits near the line.
    const span = hi - lo || hi * 0.01 || 1;
    const entry = mine?.entry;
    if (entry > lo - span * 0.5 && entry < hi + span * 0.5) { lo = Math.min(lo, entry); hi = Math.max(hi, entry); }
    let [flo, fhi] = [f(lo), f(hi)];
    if (fhi === flo) { flo -= 1; fhi += 1; }
    const pad = 4;
    const yOf = v => pad + (1 - (f(v) - flo) / (fhi - flo)) * (h - 2 * pad);
    const last = pts.length - 1;
    // The line stops 3 characters short of the right edge, where a dot marks the latest
    // price, so it does not run into the next cell's.
    const end = w - 1 - Math.round(parseFloat(getComputedStyle(chart).fontSize) * 0.6 * 3);
    const xOf = i => (i / last) * end;
    const line = pts.map((x, i) => `${xOf(i).toFixed(1)},${yOf(x.price).toFixed(1)}`).join(' ');
    const nowY = yOf(pts[last].price);
    const entryY = entry >= lo && entry <= hi ? Math.round(yOf(entry)) + 0.5 : null;
    chart.innerHTML =
      `<svg class="wlc__svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">` +
      `<polygon points="0,${h} ${line} ${end},${h}" fill="url(#wlcCellDz)"/>` +
      (entryY !== null ? `<line class="wlc__entry" x1="0" x2="${w}" y1="${entryY}" y2="${entryY}"/>` : '') +
      `<polyline points="${line}" class="pm-value__line" fill="none"/>` +
      `<rect class="wlc__cell-now" width="5" height="5" x="${(end - 2.5).toFixed(1)}" y="${(nowY - 2.5).toFixed(1)}"/>` +
      `<line class="pm-value__cursor" x1="0" x2="0" y1="0" y2="${h}" visibility="hidden"/>` +
      '<rect class="pm-value__point" width="5" height="5" x="0" y="0" visibility="hidden"/></svg>' +
      `<span class="wlc__cell-big" aria-hidden="true">${esc(cell.querySelector('.wlc__cell-price').textContent)}</span>` +
      '<p class="wlc__tip" aria-hidden="true" hidden></p>';
    chart.cellSeries = { item, mine, first, points: pts.map((x, i) => ({ t: x.timestamp, v: x.price, x: xOf(i), y: yOf(x.price) })) };
    if (cellHover?.key === item.key) cellPoint(chart, cellHover.x);
  });
}

// Pointing at a cell's chart reads one point in a tag by the cursor, as the account value
// chart: its price and change since the period's start, what your position makes there,
// and when.
function cellPoint(chart, x) {
  const data = chart?.cellSeries;
  const svg = chart?.querySelector('svg');
  const tip = chart?.querySelector('.wlc__tip');
  if (!data || !svg || !tip) return;
  const { item, mine, first, points: pts } = data;
  const p = pts.reduce((best, q) => (Math.abs(q.x - x) < Math.abs(best.x - x) ? q : best));
  const cx = Math.round(p.x) + 0.5;
  const set = (sel, attrs) => Object.entries(attrs).forEach(([k, v]) => svg.querySelector(sel).setAttribute(k, v));
  set('.pm-value__cursor', { x1: cx, x2: cx, visibility: 'visible' });
  set('.pm-value__point', { x: (p.x - 2.5).toFixed(1), y: (p.y - 2.5).toFixed(1), visibility: 'visible' });
  const pnl = mine && mine.rows.reduce((s, r) => s + (Number(r.amount) || 0) * (p.v - Number(r.entryPrice)), 0);
  const lines = [
    `${price(p.v, item)}${first > 0 ? `  ${pctOf(p.v / first - 1)}` : ''}`,
    mine && `your ${mine.amount < 0 ? 'short' : 'long'} ${pnl < 0 ? '−' : '+'}${price(Math.abs(pnl) >= 1000 ? Math.round(Math.abs(pnl)) : Math.abs(pnl), item)}`,
    when(p.t)
  ].filter(Boolean);
  tip.innerHTML = lines.map((t, i) => `<span${i === lines.length - 1 ? ' class="wlc__tip-when"' : ''}>${esc(t)}</span>`).join('');
  tip.hidden = false;
  const gap = 12;
  const w = chart.clientWidth;
  const h = chart.clientHeight;
  const left = p.x + gap + tip.offsetWidth <= w ? p.x + gap : Math.max(0, p.x - gap - tip.offsetWidth);
  const top = Math.max(0, Math.min(h - tip.offsetHeight, p.y - tip.offsetHeight - gap));
  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

function cellPointOff() {
  if (!cellHover) return;
  const chart = win.querySelector(`.wlc__cell[data-key="${CSS.escape(cellHover.key)}"] .wlc__cell-chart`);
  chart?.querySelectorAll('.pm-value__cursor, .pm-value__point').forEach(n => n.setAttribute('visibility', 'hidden'));
  const tip = chart?.querySelector('.wlc__tip');
  if (tip) tip.hidden = true;
  cellHover = null;
}

// The layer buttons: each says whether its layer is on; one with nothing to show is hidden.
function layerButtons(drawn, hasVolume = false) {
  const shown = {
    position: drawn && !!pos,
    highlow: drawn,
    volume: drawn && hasVolume,
    days: drawn && DAY_PERIODS.has(period)
  };
  const row = win.querySelector('.wlc__layers');
  row.querySelectorAll('.wlc__layer[data-layer]').forEach(b => {
    b.hidden = !shown[b.dataset.layer];
    b.setAttribute('aria-pressed', String(!!layers[b.dataset.layer]));
  });
  row.hidden = !Object.values(shown).some(Boolean);
}

// The head line keeps the latest price and the change over the period. The point being
// pointed at, or the range being measured, reads in a tag next to the cursor; the latest
// price is a tag on the price axis.
function show() {
  if (!win) return;
  const item = current();
  const left = win.querySelector('.wlc__price');
  const right = win.querySelector('.wlc__change');
  const svg = win.querySelector('.wlc__svg');
  const tip = win.querySelector('.wlc__tip');
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
  left.textContent = Number.isFinite(live) ? price(live) : '—';
  const label = PERIODS.find(x => x.id === period)?.label;
  right.innerHTML = series.length && first > 0
    ? `${esc(change(first, live))} <span class="wlc__head-period">· ${esc(label || '')}</span>` : '';

  if (m) {
    const [a, b] = [Math.min(m.a, m.b), Math.max(m.a, m.b)];
    mark('.wlc__range', { x: series[a].x.toFixed(1), width: (series[b].x - series[a].x).toFixed(1), visibility: 'visible' });
    mark('.wlc__anchor', { x1: Math.round(series[m.a].x) + 0.5, x2: Math.round(series[m.a].x) + 0.5, visibility: 'visible' });
  } else {
    mark('.wlc__range', { visibility: 'hidden' });
    mark('.wlc__anchor', { visibility: 'hidden' });
  }
  // A measured range keeps its tag at its far end once the pointer has gone.
  const p = hover >= 0 ? series[hover] : m ? series[m.b] : null;
  if (p) {
    const cx = Math.round(p.x) + 0.5;
    mark('.pm-value__cursor', { x1: cx, x2: cx, visibility: 'visible' });
    mark('.pm-value__point', { x: (p.x - 2.5).toFixed(1), y: (p.y - 2.5).toFixed(1), visibility: 'visible' });
  } else {
    mark('.pm-value__cursor', { visibility: 'hidden' });
    mark('.pm-value__point', { visibility: 'hidden' });
  }
  if (tip) placeTip(tip, p, m, first);

  // The latest price: an inverted tag on the axis and a dotted line across, moving with
  // the watchlist's refreshes.
  const nowTag = win.querySelector('.wlc__now');
  if (nowTag && scale && Number.isFinite(live)) {
    const y = Math.max(0, Math.min(scale.h, scale.yOf(live)));
    nowTag.textContent = axisPrice(live, scale.unit / 100);
    nowTag.hidden = false;
    // At the right edge, over the price labels.
    const left = scale.full - nowTag.offsetWidth;
    const top = Math.max(0, Math.min(scale.h - nowTag.offsetHeight / 2, y - nowTag.offsetHeight / 2));
    nowTag.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    const ly = Math.round(y) + 0.5;
    mark('.wlc__nowline', { y1: ly, y2: ly, visibility: 'visible' });
  }
}

// The change for the tag. From a price of 1,000 or more the money part is whole, so a
// $46,679 point does not give a −$16,637.40 change.
function tipChange(from, to, money) {
  if (!(from > 0) || !Number.isFinite(to)) return '';
  const pct = pctOf(to / from - 1);
  if (!money) return pct;
  const diff = to - from;
  return `${from >= 1000 ? signed(Math.round(diff)) : signed(diff)}  ${pct}`;
}

// The largest fall from a high and the largest rise from a low, within a range.
function swings(a, b) {
  let peak = series[a].v;
  let trough = series[a].v;
  let drop = 0;
  let rise = 0;
  for (let i = a; i <= b; i++) {
    const v = series[i].v;
    peak = Math.max(peak, v);
    trough = Math.min(trough, v);
    drop = Math.min(drop, v / peak - 1);
    rise = Math.max(rise, v / trough - 1);
  }
  return { drop, rise };
}

// The tag sits beside the point, on the side with room, and stays inside the plot. The
// value is on top and the time at the bottom. A point reads its price, the change since
// the period's start and what your position makes there; a range reads its change, how
// long it lasts, its largest fall and rise, and what your position made over it.
function placeTip(tip, p, m, first) {
  if (!p) { tip.hidden = true; return; }
  const mine = layers.position && pos;
  let lines;
  if (m) {
    const [a, b] = [Math.min(m.a, m.b), Math.max(m.a, m.b)];
    const { drop, rise } = swings(a, b);
    lines = [
      tipChange(series[a].v, series[b].v, true),
      `${lasting(series[b].t - series[a].t)} · fall ${pctOf(drop)} · rise ${pctOf(rise)}`,
      mine && `your ${side()} ${signed(pnlAt(series[b].v) - pnlAt(series[a].v))}`,
      `${when(series[a].t)} → ${when(series[b].t)}`
    ];
  } else {
    lines = [
      `${price(p.v)}  ${tipChange(first, p.v, false)}`,
      mine && `your ${side()} ${signed(pnlAt(p.v))}`,
      when(p.t)
    ];
  }
  lines = lines.filter(Boolean);
  tip.innerHTML = lines.map((t, i) => `<span${i === lines.length - 1 ? ' class="wlc__tip-when"' : ''}>${esc(t)}</span>`).join('');
  tip.hidden = false;
  const plotW = series[series.length - 1].x + 1;
  const plotH = Number(win.querySelector('.pm-value__cursor')?.getAttribute('y2')) || 0;
  const gap = 12;
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  const x = p.x + gap + tw <= plotW ? p.x + gap : Math.max(0, p.x - gap - tw);
  const y = Math.max(0, Math.min(plotH - th, p.y - th - gap));
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
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
  if (!active()?.onRemove) return;
  const list = items();
  const i = list.findIndex(x => x.key === key);
  if (i < 0) return;
  const next = list[i + 1] || list[i - 1];
  active().onRemove(key);
  if (!next) { close(); return; }
  key = next.key;
  load();
}

function choosePeriod(id) {
  if (id === period) return;
  period = id;
  logChoice = null;
  if (current()) title(current());
  load();
}

function toggleLog() {
  logChoice = !logScale();
  draw();
}

// A list as a grid, or (null) one item. Back from a grid, the window shows the item it
// showed, or the list's first. Each time a grid opens, it is as its list is.
function showGrid(id) {
  if (id && gridItems(id).length < 2) return;
  if (id === grid) return;
  grid = id;
  gridHtml = '';
  cellHover = null;
  gridHidden = new Set();
  gridAdded = [];
  gridOrder = null;
  tried.clear();
  queue.length = 0;
  addMenu(false);
  hover = -1;
  measure = null;
  if (!grid && !current()) {
    listId = lists.find(l => l.items().length)?.id || listId;
    key = items()[0]?.key;
  }
  load();
  // Into a grid, focus is on its first cell, so the arrows move between cells at once.
  if (grid) cellRows()[0]?.[0]?.button.focus({ preventScroll: true });
  else win.querySelector('.wlc').focus({ preventScroll: true });
}

// Remove or hide a cell: one from the watchlist's own grid leaves the watchlist; any other
// goes from this grid only.
function removeCell(k) {
  const l = gridList();
  const item = gridItems().find(i => i.key === k);
  if (!item) return;
  if (l.onRemove && item.list === l.id) l.onRemove(k);
  else gridHidden.add(k);
  draw();
}

// + Add: the watchlist's search for the watchlist's grid; for the positions', a search over
// the positions you hid, the other lists' items and, as you type, all assets.
function addMenu(open) {
  const menu = win.querySelector('.wlc__menu');
  const button = win.querySelector('.js-wlc-grid-add');
  const l = gridList();
  if (!open || !l) {
    // Focus inside the menu goes back to its button, so the window's keys still work.
    const inside = menu.contains(document.activeElement);
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (inside) (button.hidden ? win.querySelector('.wlc') : button).focus({ preventScroll: true });
    return;
  }
  if (l.onAdd) { l.onAdd(); return; }
  const input = menu.querySelector('.wlc__menu-search');
  input.value = '';
  searchMenu();
  menu.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  input.focus();
}

const matches = (i, q) => !q || [i.label, i.symbol, i.name].some(v => String(v || '').toLowerCase().includes(q));

function menuRows() {
  const menu = win.querySelector('.wlc__menu');
  const l = gridList();
  const q = menu.querySelector('.wlc__menu-search').value.trim().toLowerCase();
  const shown = new Set(gridItems().map(i => i.key));
  const hidden = ownItems(l.id).filter(i => !shown.has(i.key));
  const others = lists.filter(x => x.id !== l.id).flatMap(x => gridItems(x.id)).filter(i => !shown.has(i.key));
  const rows = [...hidden, ...others].filter(i => matches(i, q))
    .map(i => ({ ...i, from: lists.find(x => x.id === i.list)?.title || '' }));
  const known = new Set([...shown, ...rows.map(i => i.key)]);
  // The search's items, or before you type its suggestions, that are on no list yet.
  rows.push(...found.filter(i => !known.has(i.key)).map(i => ({ ...i, list: 'found', from: i.kind || '' })));
  menu.querySelector('.wlc__menu-rows').innerHTML = rows.length
    ? rows.map(i => `<button type="button" class="wlc__menu-item" data-key="${esc(i.key)}" data-list="${esc(i.list)}">` +
      `<span>${esc(i.label || i.symbol || '')}</span><span class="wlc__menu-from">${esc(i.from)}</span></button>`).join('')
    : `<p class="wlc__empty">${q ? (search ? 'Searching…' : 'No results.') : 'Nothing more to add.'}</p>`;
}

// Typing filters the menu at once and asks the search after a pause.
function searchMenu() {
  const q = win.querySelector('.wlc__menu-search').value.trim();
  const seq = ++searchSeq;
  found = [];
  menuRows();
  clearTimeout(searchWait);
  if (!search) return;
  searchWait = setTimeout(async () => {
    let result = [];
    try { result = await search(q); } catch (_) { /* no results */ }
    if (seq !== searchSeq || win.querySelector('.wlc__menu').hidden) return;
    found = result || [];
    menuRows();
    if (q && !found.length && !win.querySelector('.wlc__menu-item')) {
      win.querySelector('.wlc__menu-rows').innerHTML = '<p class="wlc__empty">No results.</p>';
    }
  }, q ? 250 : 0);
}

function addCell(listOf, k) {
  if (listOf === 'found') {
    const item = found.find(i => i.key === k);
    if (!item) return;
    if (!added.some(i => i.key === k)) added.push(item);
    listOf = 'added';
  }
  if (listOf === grid) gridHidden.delete(k);
  else gridAdded.push({ list: listOf, key: k });
  gridOrder?.push(k);
  addMenu(false);
  draw();
  // Focus on the cell just added.
  focusCell(k);
}

// Drag a cell to move it: a mouse drags once it moves, a finger after holding still for a
// moment, as the watchlist's tiles. The others make room; the watchlist's grid saves the
// order to the watchlist.
function dragCell(e) {
  const cell = e.target.closest('.wlc__cell');
  if (!cell?.dataset.key || e.target.closest('.wlc__cell-x') || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const k = cell.dataset.key;
  const touch = e.pointerType !== 'mouse';
  const startX = e.clientX, startY = e.clientY;
  let moving = false;
  let holdTimer = null;
  const mark = () => win.querySelector(`.wlc__cell[data-key="${CSS.escape(k)}"]`)?.classList.add('is-dragging');
  const start = () => { moving = true; mark(); window.getSelection()?.removeAllRanges(); };
  const blockTouch = (ev) => { if (moving) ev.preventDefault(); };
  const onMove = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    const moved = Math.hypot(ev.clientX - startX, ev.clientY - startY);
    if (!moving) {
      if (touch) { if (moved > 8) finish(); return; }
      if (moved < 4) return;
      start();
    }
    ev.preventDefault();
    const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.wlc__cell');
    if (!over?.dataset.key || over.dataset.key === k) return;
    const keys = gridItems().map(i => i.key);
    const to = keys.indexOf(over.dataset.key);
    keys.splice(keys.indexOf(k), 1);
    keys.splice(to, 0, k);
    gridOrder = keys;
    drawGrid();
    mark();
  };
  const finish = () => {
    clearTimeout(holdTimer);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('touchmove', blockTouch);
    window.removeEventListener('contextmenu', blockTouch);
    if (!moving) return;
    win.querySelector('.wlc__cell.is-dragging')?.classList.remove('is-dragging');
    gridDragged = true;
    setTimeout(() => { gridDragged = false; }, 0);
    gridList()?.onReorder?.(gridOrder);
  };
  const onUp = (ev) => { if (ev.pointerId === e.pointerId) finish(); };
  if (touch) holdTimer = setTimeout(start, 350);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('touchmove', blockTouch, { passive: false });
  window.addEventListener('contextmenu', blockTouch);
}

function toggleLayer(id) {
  layers[id] = !layers[id];
  saveLayers();
  draw();
}

// ↑ ↓ in one item's view: the item above or below in the side list, across its lists.
function stepAll(by) {
  const all = lists.flatMap(l => l.items().map(i => ({ list: l.id, key: i.key })));
  const i = all.findIndex(x => x.list === listId && x.key === key);
  if (i < 0 || all.length < 2) return;
  ({ list: listId, key } = all[(i + by + all.length) % all.length]);
  load();
}

// The grid's cells by row, each its focusable button; 'add' is the add cell.
function cellRows() {
  return [...win.querySelectorAll('.wlc__all .wlc__row')].map(r =>
    [...r.querySelectorAll('.wlc__cell')].map(c => ({ key: c.dataset.key ?? 'add', button: c.querySelector('.wlc__cell-open, .wlc__cell-add') })));
}

function focusCell(k) {
  cellRows().flat().find(c => c.key === k)?.button.focus({ preventScroll: false });
}

// The arrows between cells: ← → in reading order, ↑ ↓ to the cell above or below.
function moveFocus(keyName) {
  const rows = cellRows();
  const flat = rows.flat();
  if (!flat.length) return;
  const at = flat.findIndex(c => c.button === document.activeElement);
  if (at < 0) { flat[0].button.focus(); return; }
  if (keyName === 'ArrowLeft' || keyName === 'ArrowRight') {
    flat[Math.max(0, Math.min(flat.length - 1, at + (keyName === 'ArrowRight' ? 1 : -1)))].button.focus();
    return;
  }
  const r = rows.findIndex(row => row.some(c => c.button === document.activeElement));
  const target = rows[r + (keyName === 'ArrowDown' ? 1 : -1)];
  if (!target) return;
  const x = document.activeElement.getBoundingClientRect();
  const mid = x.left + x.width / 2;
  const near = target.reduce((best, c) => {
    const b = c.button.getBoundingClientRect();
    return Math.abs(b.left + b.width / 2 - mid) < Math.abs(best.r.left + best.r.width / 2 - mid) ? { c, r: b } : best;
  }, { c: target[0], r: target[0].button.getBoundingClientRect() });
  near.c.button.focus();
}

// ⇧ with an arrow moves the cell in focus: one place for ← →, a row for ↑ ↓.
function moveCell(keyName) {
  const k = document.activeElement?.closest('.wlc__cell')?.dataset.key;
  if (!k) return;
  const keys = gridItems().map(i => i.key);
  const from = keys.indexOf(k);
  const across = cellRows()[0]?.length || 1;
  const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -across, ArrowDown: across }[keyName];
  const to = Math.max(0, Math.min(keys.length - 1, from + by));
  if (to === from) return;
  keys.splice(from, 1);
  keys.splice(to, 0, k);
  gridOrder = keys;
  drawGrid();
  gridList()?.onReorder?.(gridOrder);
}

// ⌫ removes the cell in focus; focus goes to the next one.
function removeFocused() {
  const k = document.activeElement?.closest('.wlc__cell')?.dataset.key;
  if (!k) return;
  const keys = gridItems().map(i => i.key);
  const next = keys[keys.indexOf(k) + 1] || keys[keys.indexOf(k) - 1];
  removeCell(k);
  if (next) focusCell(next);
}

function close() {
  if (!win || win.style.display === 'none') return;
  win.style.display = 'none';
  backdrop.style.display = 'none';
  document.body.classList.remove('modal-open');
  clearInterval(tick);
  sized?.disconnect();
  active()?.onClose?.(current() ? key : null);
}

function build() {
  backdrop = el('<div class="settings-backdrop" style="display: none;"></div>');
  win = el(
    '<div class="sticker-window pm-chart-window" role="dialog" aria-modal="true" aria-labelledby="pmChartTitle" style="display: none;">' +
    '<div class="sticker-window-header"><h2 id="pmChartTitle" class="window-title"></h2>' +
    '<div class="wlc__actions"><button type="button" class="btn-text js-wlc-all" aria-pressed="false" hidden>Grid</button>' +
    '<button type="button" class="btn-text js-wlc-close">Close</button></div></div>' +
    '<div class="sticker-window-content wlc" tabindex="-1">' +
    '<p class="wlc__name"></p>' +
    '<p class="wlc__head" aria-live="polite"><span class="wlc__price"></span><span class="wlc__change"></span></p>' +
    `<div class="wlc__periods" role="radiogroup" aria-label="Period">${PERIODS.map((p, i) =>
      `<button type="button" role="radio" class="wlc__period" data-period="${p.id}" aria-keyshortcuts="${i + 1}" title="${i + 1}">${p.label}</button>`).join('')}</div>` +
    '<div class="wlc__chart" tabindex="0"></div>' +
    '<div class="wlc__all" role="group" aria-label="Grid"></div>' +
    '<div class="wlc__grid-tools"><button type="button" class="wlc__layer js-wlc-grid-price" aria-pressed="false" data-key="p" aria-keyshortcuts="P">Price</button>' +
    '<button type="button" class="wlc__layer js-wlc-grid-add" aria-expanded="false" data-key="+" aria-keyshortcuts="+">Add</button>' +
    '<div class="wlc__menu" hidden><input type="search" class="wlc__menu-search" placeholder="Search" aria-label="Search assets" autocomplete="off" spellcheck="false">' +
    '<div class="wlc__menu-rows"></div></div></div>' +
    // The cells' dither, defined once where it is never hidden.
    '<svg width="0" height="0" class="wlc__defs" aria-hidden="true"><defs><pattern id="wlcCellDz" width="2" height="2" patternUnits="userSpaceOnUse">' +
    '<rect class="pm-value__dot" width="1" height="1"/><rect class="pm-value__dot" x="1" y="1" width="1" height="1"/></pattern></defs></svg>' +
    `<div class="wlc__layers" role="group" aria-label="Show on the chart"><span class="wlc__layers-label" aria-hidden="true">Show</span>${LAYERS.map(l =>
      `<button type="button" class="wlc__layer" data-layer="${l.id}" aria-pressed="true" data-key="${l.key}" aria-keyshortcuts="${l.key.toUpperCase()}">${l.label}</button>`).join('')}` +
    '<button type="button" class="wlc__layer wlc__log" aria-pressed="false" data-key="l" aria-keyshortcuts="L">Log</button></div>' +
    '<dl class="wlc__rows"></dl>' +
    '<dl class="wlc__rows wlc__pos"></dl>' +
    '<p class="wlc__facts"></p>' +
    '<p class="wlc__foot"><button type="button" class="link-button js-wlc-remove" aria-keyshortcuts="Backspace">Remove from watchlist</button></p>' +
    '<nav class="wlc__list" aria-label="Items"></nav>' +
    '</div></div>');
  document.body.append(backdrop, win);
  backdrop.addEventListener('click', close);
  win.querySelector('.js-wlc-close').addEventListener('click', close);
  win.querySelector('.js-wlc-remove').addEventListener('click', remove);
  win.querySelector('.js-wlc-all').addEventListener('click', () => showGrid(grid ? null : listId));
  const cells = win.querySelector('.wlc__all');
  cells.addEventListener('pointerdown', (e) => { cellPointOff(); dragCell(e); });
  // A mouse reads the cell chart under it; a finger opens the chart, which reads by touch.
  cells.addEventListener('pointermove', (e) => {
    const chart = e.target.closest('.wlc__cell-chart');
    if (e.pointerType !== 'mouse' || e.buttons || !chart?.cellSeries) { cellPointOff(); return; }
    const key = chart.closest('.wlc__cell').dataset.key;
    if (cellHover && cellHover.key !== key) cellPointOff();
    cellHover = { key, x: e.clientX - chart.getBoundingClientRect().left };
    cellPoint(chart, cellHover.x);
  });
  cells.addEventListener('pointerleave', cellPointOff);
  cells.addEventListener('click', (e) => {
    if (e.target.closest('.wlc__cell-add')) { gridList()?.onAdd?.(); return; }
    const cell = e.target.closest('.wlc__cell');
    if (!cell?.dataset.key) return;
    if (e.target.closest('.wlc__cell-x')) { removeCell(cell.dataset.key); return; }
    if (gridDragged) return;
    listId = cell.dataset.list;
    key = cell.dataset.key;
    showGrid(null);
  });
  win.querySelector('.wlc__grid-tools').addEventListener('click', (e) => {
    if (e.target.closest('.js-wlc-grid-add')) { addMenu(win.querySelector('.wlc__menu').hidden); return; }
    if (e.target.closest('.js-wlc-grid-price')) {
      toggleLayer('gridPrice');
      return;
    }
    const b = e.target.closest('.wlc__menu-item');
    if (b) addCell(b.dataset.list, b.dataset.key);
  });
  // ↵ in the box adds the first row; ↓ moves into the rows and ↑ ↓ between them.
  const menu = win.querySelector('.wlc__menu');
  menu.querySelector('.wlc__menu-search').addEventListener('input', searchMenu);
  menu.addEventListener('keydown', (e) => {
    const rows = [...menu.querySelectorAll('.wlc__menu-item')];
    const input = menu.querySelector('.wlc__menu-search');
    if (e.target === input && e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      rows[0]?.click();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    e.stopPropagation();
    const i = rows.indexOf(e.target);
    const next = e.target === input ? (e.key === 'ArrowDown' ? rows[0] : null) : rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
    (next || (e.key === 'ArrowUp' ? input : null))?.focus();
  });
  win.querySelector('.wlc__periods').addEventListener('click', (e) => {
    const b = e.target.closest('.wlc__period');
    if (b) choosePeriod(b.dataset.period);
  });
  win.querySelector('.wlc__layers').addEventListener('click', (e) => {
    const b = e.target.closest('.wlc__layer');
    if (!b) return;
    if (!b.dataset.layer) { toggleLog(); return; }
    toggleLayer(b.dataset.layer);
  });
  win.querySelector('.window-title').addEventListener('click', (e) => {
    if (e.target.closest('.js-wlc-back')) close();
  });
  win.querySelector('.wlc__list').addEventListener('click', (e) => {
    if (e.target.closest('.js-wlc-add')) { lists.find(l => l.onAdd).onAdd(); return; }
    const g = e.target.closest('.js-wlc-grid');
    if (g) { showGrid(grid === g.dataset.list ? null : g.dataset.list); return; }
    const b = e.target.closest('.wlc__item');
    if (!b || (!grid && b.dataset.list === listId && b.dataset.key === key)) return;
    listId = b.dataset.list;
    key = b.dataset.key;
    if (grid) showGrid(null);
    else load();
  });

  // Mouse: pointing reads a point, pressing and dragging measures. Touch: a tap reads the
  // point and keeps it; a sideways drag measures from where the finger landed.
  const chart = win.querySelector('.wlc__chart');
  chart.addEventListener('click', (e) => {
    if (e.target.closest('.js-wlc-retry')) load();
  });
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
    // After a touch drag the range's tag stays at its far end.
    if (e.pointerType !== 'mouse' && measure) hover = -1;
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

  // Anywhere else in the window: ← → the previous or next item, ⌫ removes it, 1 to 7
  // choose a period, L turns Log on or off, A shows the list as a grid or one item, Esc
  // clears a measured range, or closes the add menu or leaves the grid, first; then closes.
  win.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Typing in the search box is typing; only Esc acts.
    if (e.target.matches('input') && e.key !== 'Escape') return;
    const nth = PERIODS[Number(e.key) - 1];
    if (/^[1-9]$/.test(e.key) && nth) {
      e.preventDefault();
      e.stopPropagation();
      choosePeriod(nth.id);
      return;
    }
    if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      e.stopPropagation();
      toggleLog();
      return;
    }
    if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      e.stopPropagation();
      showGrid(grid ? null : listId);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (measure) { measure = null; show(); } else if (!win.querySelector('.wlc__menu').hidden) addMenu(false);
      else if (grid) showGrid(null); else close();
      return;
    }
    const act = (fn) => { e.preventDefault(); e.stopPropagation(); fn(); };
    const letter = e.key.toLowerCase();
    if (grid) {
      if (e.key.startsWith('Arrow')) act(() => (e.shiftKey ? moveCell(e.key) : moveFocus(e.key)));
      else if (e.key === 'Backspace' || e.key === 'Delete') act(removeFocused);
      else if (letter === 'p') act(() => toggleLayer('gridPrice'));
      else if (e.key === '+' || e.key === '=') act(() => (gridList()?.onAdd ? gridList().onAdd() : addMenu(true)));
      return;
    }
    // A layer by its key, when its button is there.
    const layer = LAYERS.find(l => l.key === letter);
    if (layer) {
      const b = win.querySelector(`.wlc__layer[data-layer="${layer.id}"]`);
      if (b && !b.hidden) act(() => toggleLayer(layer.id));
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      act(() => stepAll(e.key === 'ArrowDown' ? 1 : -1));
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

// Opens on one item of one list; a list without onRemove (the positions) leaves out Remove.
export function openChartWindow({ key: openKey, list: openList, lists: allLists, tilePeriod, search: searchAssets = null }) {
  if (!win) build();
  added = [];
  search = searchAssets;
  lists = [...allLists, { id: 'added', title: 'Added', items: () => added }];
  listId = openList;
  key = openKey;
  period = FROM_TILES[tilePeriod] || '1d';
  logChoice = null;
  grid = null;
  backdrop.style.display = 'block';
  win.style.display = 'flex';
  document.body.classList.add('modal-open');
  sized ??= new ResizeObserver(draw);
  sized.observe(win.querySelector('.wlc__chart'));
  sized.observe(win.querySelector('.wlc__all'));
  // The head's price and the axis tag follow the watchlist's refreshes.
  clearInterval(tick);
  tick = setInterval(() => { if (!dragging) { list(); if (grid) drawGrid(); else show(); } }, 5000);
  load();
  // Focus starts on the window itself, so ← → step through the items straight away (on the
  // periods they choose a period, as in every period row).
  win.querySelector('.wlc').focus({ preventScroll: true });
}

export default { openChartWindow };
