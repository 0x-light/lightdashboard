// Watchlist feature (lazy-loaded). Supports mixed entries: Pyth-backed crypto feeds and
// Yahoo-backed stocks/ETFs/FX/indices.
//
// Storage format (persisted on `settings.watchlist`):
//   - Legacy: array of strings (each is a Pyth feed id) — still read for backward compat.
//   - New:    array of objects `{ provider: 'pyth', id: '0x...' }` or
//                               `{ provider: 'yahoo', symbol: 'AAPL', name?, category? }`.
//
// Each rendered item carries a composite `key` (`pyth:<id>` or `yahoo:<SYM>`) used for
// edit-mode removal, flash detection, and caching.

import { formatPrice, formatLevel } from '../utils/currency.js';

const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'BUSD']);
let lastGoodWatchlistData = null;

// The chart period every tile shows. 'day' is the 24h chart and change the quotes carry; the
// others fetch a longer history per item, and the change runs from its first point to now.
const DAY_MS = 24 * 60 * 60 * 1000;
export const PERIODS = {
  day: null,
  week: { ms: 7 * DAY_MS, hl: '1h', yahoo: ['5d', '1h'] },
  month: { ms: 30 * DAY_MS, hl: '4h', yahoo: ['1mo', '1h'] },
  year: { ms: 365 * DAY_MS, hl: '1d', yahoo: ['1y', '1d'] }
};
const PERIOD_KEY = 'pmWatchlistPeriod';
const PERIOD_TTL_MS = 5 * 60 * 1000;
const periodHistory = new Map(); // `${period}|${key}` -> { at, points }
let period = 'day';
try {
  const saved = localStorage.getItem(PERIOD_KEY);
  if (saved && saved in PERIODS) period = saved;
} catch (_) { /* storage blocked: stay on day */ }
let providers = {}; // { pythProvider, stocksProvider } from the last render

function cloneWatchlistData(data) {
  if (!Array.isArray(data)) return null;
  return data.map(item => ({
    ...item,
    priceHistory: Array.isArray(item.priceHistory) ? [...item.priceHistory] : item.priceHistory
  }));
}

function isStablecoin(symbol) {
  if (!symbol) return false;
  const upper = symbol.toUpperCase();
  if (STABLECOINS.has(upper)) return true;
  for (const stable of STABLECOINS) {
    if (upper.includes(stable)) return true;
  }
  return false;
}

/**
 * Coerce raw watchlist storage (legacy feed-id strings or rich entry objects) into a
 * normalized `[{ provider, id?, symbol?, name?, category? }]` array. Keeps source order.
 */
export function normalizeEntries(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item) continue;
    if (typeof item === 'string') {
      out.push({ provider: 'pyth', id: item });
    } else if (item.provider === 'yahoo' && item.symbol) {
      out.push({
        provider: 'yahoo',
        symbol: String(item.symbol),
        label: item.label || null,
        name: item.name || null,
        category: item.category || null
      });
    } else if (item.provider === 'pyth' && item.id) {
      out.push({ provider: 'pyth', id: String(item.id) });
    } else if (item.id && !item.provider) {
      // Heuristic for older persisted shapes that just dropped in an object with an id field.
      out.push({ provider: 'pyth', id: String(item.id) });
    }
  }
  return out;
}

function entryKey(entry) {
  if (entry.provider === 'yahoo') return `yahoo:${entry.symbol.toUpperCase()}`;
  const id = (entry.id || '').toLowerCase();
  return `pyth:${id.startsWith('0x') ? id : `0x${id}`}`;
}

function createSparkline(priceData, width = 60, height = 24, currentChange24h = null) {
  if (!Array.isArray(priceData) || priceData.length < 2) return null;

  const prices = priceData.map(d => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;

  if (range === 0) {
    const y = height / 2;
    const points = priceData.map((_, i) => `${(i / (priceData.length - 1)) * width},${y}`).join(' ');
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="sparkline" aria-hidden="true" focusable="false"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1"/></svg>`;
  }

  const points = priceData.map((d, i) => {
    const x = (i / (priceData.length - 1)) * width;
    const y = height - ((d.price - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

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

// A Pyth entry is saved as a feed id. The symbol each id resolved to is kept, so a tile
// whose quote hasn't arrived (or failed) still reads ETH, not a slice of the id.
const SYMBOLS_KEY = 'pmWatchlistSymbols';
const feedKey = id => `0x${String(id || '').toLowerCase().replace(/^0x/, '')}`;
function knownSymbol(id) {
  if (!id) return null;
  try { return JSON.parse(localStorage.getItem(SYMBOLS_KEY) || '{}')[feedKey(id)] || null; } catch (_) { return null; }
}
function rememberSymbols(items) {
  try {
    const known = JSON.parse(localStorage.getItem(SYMBOLS_KEY) || '{}');
    let changed = false;
    for (const item of items || []) {
      if (!item?.feedId || !item.symbol || item.symbol.startsWith('...')) continue;
      const k = feedKey(item.feedId);
      if (known[k] !== item.symbol) { known[k] = item.symbol; changed = true; }
    }
    if (changed) localStorage.setItem(SYMBOLS_KEY, JSON.stringify(known));
  } catch (_) { /* labels only */ }
}

// --- Pyth fetch path (unchanged semantics, just keyed by entry.key now) ---

async function fetchPythItems(pythEntries, pythProvider, bypassCache = false) {
  if (pythEntries.length === 0 || !pythProvider) return [];

  const feedIds = pythEntries.map(e => e.id);
  try {
    const current = await pythProvider.getLatestByFeedIds(feedIds, 5000, bypassCache);

    let idToSymbol = {};
    try {
      const feedMap = await Promise.race([
        pythProvider.getPriceFeeds(500),
        new Promise(resolve => setTimeout(() => resolve({}), 100))
      ]);
      for (const [symbol, id] of Object.entries(feedMap || {})) {
        idToSymbol[id.toLowerCase()] = symbol;
      }
    } catch (_) { /* ignore — placeholders acceptable */ }

    const results = [];
    for (const entry of pythEntries) {
      const normalizedId = entry.id.toLowerCase().startsWith('0x')
        ? entry.id.toLowerCase()
        : `0x${entry.id.toLowerCase()}`;
      const curr = current[normalizedId];
      const symbol = idToSymbol[normalizedId] || knownSymbol(normalizedId) || `...${normalizedId.slice(-6)}`;

      if (curr !== undefined) {
        results.push({
          key: `pyth:${normalizedId}`,
          provider: 'pyth',
          feedId: normalizedId,
          symbol,
          price: curr,
          change24h: null,
          priceHistory: null
        });
      }
    }
    return results;
  } catch (e) {
    console.error('[Watchlist] Pyth basic fetch failed', e);
    return [];
  }
}

async function enrichPythWith24hChange(pythItems, pythProvider) {
  if (!pythItems || pythItems.length === 0) return;
  const feedIds = pythItems.map(p => p.feedId);
  const ts24hAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);

  try {
    const historical = await pythProvider.getAtTimestampByFeedIds(feedIds, ts24hAgo, 10000);
    for (const item of pythItems) {
      const hist = historical[item.feedId];
      if (hist && hist > 0 && item.price > 0) {
        item.change24h = ((item.price - hist) / hist) * 100;
      }
    }
  } catch (e) {
    console.warn('[Watchlist] Pyth 24h change fetch failed', e);
  }
}

async function enrichPythWithHistory(pythItems, pythProvider, onProgress = null) {
  const itemsToFetch = pythItems.filter(item => !isStablecoin(item.symbol));
  if (itemsToFetch.length === 0) return;
  const feedIds = itemsToFetch.map(i => i.feedId);
  const now = Date.now();

  try {
    const fastResults = await pythProvider.getBatch24hPriceHistory(feedIds, 24, now);
    let hasFastData = false;
    for (const item of itemsToFetch) {
      const history = fastResults[item.feedId];
      if (history && history.length > 0) {
        const shouldUpdate = !item.priceHistory || item.priceHistory.length <= history.length;
        if (shouldUpdate) {
          item.priceHistory = history;
          hasFastData = true;
        }
      }
    }
    if (hasFastData && onProgress) onProgress();
  } catch (e) {
    console.warn('[Watchlist] Pyth fast history failed', e);
  }

  try {
    const fullPoints = itemsToFetch.length > 8 ? 48 : 72;
    const fullResults = await pythProvider.getBatch24hPriceHistory(feedIds, fullPoints, now);
    for (const item of itemsToFetch) {
      const history = fullResults[item.feedId];
      if (history && history.length > 0) item.priceHistory = history;
    }
  } catch (e) {
    console.warn('[Watchlist] Pyth full history failed', e);
  }
}

// --- Yahoo fetch path for stocks/ETFs/FX/indices ---

async function fetchYahooItems(yahooEntries, stocksProvider) {
  if (yahooEntries.length === 0 || !stocksProvider?.getQuotes) return [];

  const symbols = yahooEntries.map(e => e.symbol);
  try {
    const quotes = await stocksProvider.getQuotes(symbols, { timeoutMs: 5000 });
    const results = [];
    for (const entry of yahooEntries) {
      const q = quotes[entry.symbol];
      if (!q || !Number.isFinite(q.price)) {
        // Emit a loading placeholder so the row stays visible even if the quote call
        // temporarily fails — avoids flickering the entry in/out of the list.
        results.push({
          key: `yahoo:${entry.symbol.toUpperCase()}`,
          provider: 'yahoo',
          symbol: entry.symbol,
          label: entry.label,
          name: entry.name || entry.symbol,
          category: entry.category || null,
          price: null,
          change24h: null,
          priceHistory: null,
          marketState: null
        });
        continue;
      }
      results.push({
        key: `yahoo:${entry.symbol.toUpperCase()}`,
        provider: 'yahoo',
        symbol: entry.symbol,
        label: entry.label,
        name: entry.name || q.name || entry.symbol,
        category: entry.category || null,
        price: q.price,
        change24h: Number.isFinite(q.change24h) ? q.change24h : null,
        // Spark endpoint returns intraday sparkline data alongside the quote, so the row has
        // a chart from the first paint — no second request required.
        priceHistory: Array.isArray(q.priceHistory) && q.priceHistory.length > 1 ? q.priceHistory : null,
        marketState: q.marketState || null,
        currency: q.currency || null
      });
    }
    return results;
  } catch (e) {
    console.warn('[Watchlist] Yahoo quote fetch failed', e);
    return [];
  }
}

async function enrichYahooWithHistory(yahooItems, stocksProvider, onProgress = null) {
  // Yahoo items already carry a sparkline from the spark quote call — only backfill here if
  // something is missing (e.g. a stale cached row rehydrated from previous session).
  if (!yahooItems || yahooItems.length === 0) return;
  const needsHistory = yahooItems.filter(item => !item.priceHistory || item.priceHistory.length < 2);
  if (needsHistory.length === 0) return;
  if (!stocksProvider?.get24hPriceHistory) return;

  const results = await Promise.all(needsHistory.map(async (item) => {
    try {
      const history = await stocksProvider.get24hPriceHistory(item.symbol, { timeoutMs: 5000 });
      return { item, history };
    } catch (_) {
      return { item, history: null };
    }
  }));

  let any = false;
  for (const { item, history } of results) {
    if (Array.isArray(history) && history.length > 0) {
      item.priceHistory = history;
      any = true;
    }
  }
  if (any && onProgress) onProgress();
}

// --- Longer periods: one history per item, cached five minutes ---

function thin(points, count = 120) {
  if (!Array.isArray(points) || points.length <= count) return points || [];
  const step = (points.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => points[Math.round(i * step)]);
}

function historyFor(item) {
  if (period === 'day') return item.priceHistory;
  return periodHistory.get(`${period}|${item.key}`)?.points;
}

function changeFor(item, history) {
  if (period === 'day') return item.change24h;
  if (!Array.isArray(history) || history.length < 2) return null;
  const first = history[0].price;
  const last = Number.isFinite(item.price) ? item.price : history[history.length - 1].price;
  return first > 0 ? ((last - first) / first) * 100 : null;
}

// Fetches the chosen period for items without a fresh history, then redraws. Entries are
// claimed before the requests go out, so the redraws this causes find nothing left to do.
async function loadPeriodHistory(items) {
  const spec = PERIODS[period];
  if (!spec) return;
  const forPeriod = period;
  const now = Date.now();
  const due = items.filter((item) => {
    if (!item.key || item.unavailable || isStablecoin(item.symbol)) return false;
    const hit = periodHistory.get(`${forPeriod}|${item.key}`);
    return !hit || now - hit.at > PERIOD_TTL_MS;
  });
  if (due.length === 0) return;
  for (const item of due) {
    const hit = periodHistory.get(`${forPeriod}|${item.key}`);
    periodHistory.set(`${forPeriod}|${item.key}`, { at: now, points: hit?.points ?? null });
  }

  const { pythProvider, stocksProvider } = providers;
  const pythItems = due.filter(i => i.provider === 'pyth' && i.feedId);
  const yahooItems = due.filter(i => i.provider === 'yahoo');
  const [pythResults, yahooResults] = await Promise.all([
    pythItems.length > 0 && pythProvider?.getPeriodHistoryByFeedIds
      ? pythProvider.getPeriodHistoryByFeedIds(pythItems.map(i => i.feedId), spec).catch(() => ({}))
      : {},
    Promise.all(yahooItems.map((item) => {
      if (!stocksProvider?.get24hPriceHistory) return [];
      const [range, interval] = spec.yahoo;
      return stocksProvider.get24hPriceHistory(item.symbol, { range, interval, timeoutMs: 8000 }).catch(() => []);
    }))
  ]);

  for (const item of pythItems) {
    periodHistory.set(`${forPeriod}|${item.key}`, { at: now, points: pythResults[item.feedId] || [] });
  }
  yahooItems.forEach((item, i) => {
    periodHistory.set(`${forPeriod}|${item.key}`, { at: now, points: thin(yahooResults[i]) });
  });
  if (forPeriod === period) rerenderOpenState();
}

export function getPeriod() {
  return period;
}

export function setPeriod(next) {
  if (!(next in PERIODS) || next === period) return;
  period = next;
  try { localStorage.setItem(PERIOD_KEY, period); } catch (_) { /* per-viewer convenience only */ }
  rerenderOpenState();
}

// --- Rendering ---

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// The last render, so opening or closing an item can redraw without refetching.
let lastRender = null;

// Each item opens the chart window (click, or Enter when focused); app.js handles the
// clicks and keys.
function renderRows(container, data, options) {
  const { useColoredPnL, showPriceChart, prevPriceMap } = options;
  lastRender = { container, data, options: { ...options, prevPriceMap: {} } };
  // A tile is being dragged (app.js): leave the rows alone; the drop redraws.
  if (container.dataset.dragging !== undefined) return;

  if (!data || data.length === 0) {
    container.innerHTML = '<tr class="watchlist-empty-row"><td colspan="4">Your watchlist is empty.</td></tr>';
    return;
  }

  if (typeof document !== 'undefined') {
    document.querySelectorAll('.wl-period').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.period === period));
    });
  }

  const html = data.map(item => {
    const symbol = escapeHtml(item.label || item.symbol);
    const price = item.price;
    const history = historyFor(item);
    const change = changeFor(item, history);
    const key = item.key || (item.feedId ? `pyth:${item.feedId}` : `yahoo:${(item.symbol || '').toUpperCase()}`);
    const keyAttr = escapeHtml(key);

    // Quote currency (EUR for VWCE.DE, GBp for LSE…); Pyth feeds are USD-quoted.
    const priceFormatted = price == null
      ? '—'
      : item.category === 'index' || item.category === 'fx'
        ? formatLevel(price)
        : formatPrice(price, { currency: item.currency || 'USD' });

    let changeColor = '';
    let changeText = '—';
    if (change !== null && change !== undefined) {
      const isPos = change >= 0;
      changeColor = useColoredPnL ? (isPos ? 'var(--green)' : 'var(--red)') : '';
      changeText = `${isPos ? '+' : ''}${change.toFixed(2)}%`;
    } else if (!isStablecoin(item.symbol) && !item.unavailable && !(period !== 'day' && Array.isArray(history))) {
      changeText = '<span class="cell-loading">—</span>';
    }

    let chartHtml;
    if (!showPriceChart) {
      chartHtml = '';
    } else if (isStablecoin(item.symbol) || item.unavailable) {
      chartHtml = '—';
    } else if (history && history.length > 1) {
      chartHtml = createSparkline(history, 60, 24, change) || '<span class="cell-loading">—</span>';
    } else if (Array.isArray(history)) {
      chartHtml = '—'; // the source has no history for this period
    } else {
      chartHtml = '<span class="cell-loading">—</span>';
    }

    const prevPrice = prevPriceMap[key];
    let flashClass = '';
    if (prevPrice && price !== prevPrice) {
      flashClass = price > prevPrice ? ' flash-green' : ' flash-red';
    }

    return `
      <tr class="watchlist-row${flashClass}" data-entry-key="${keyAttr}" tabindex="0" aria-haspopup="dialog">
        <td class="wl-symbol"><span class="symbol">${symbol}</span></td>
        <td class="wl-price text-right font-mono"${item.unavailable ? ' title="Quote unavailable"' : ''}>${priceFormatted}</td>
        <td class="wl-chart text-center chart">${chartHtml}</td>
        <td class="wl-change text-right font-mono" style="color: ${changeColor}">${changeText}</td>
      </tr>
    `;
  }).join('');

  // Rows are rebuilt on every refresh; hand keyboard focus back to the item that had it.
  const active = container.ownerDocument?.activeElement;
  const focusedKey = container.contains(active) ? active.closest('tr')?.dataset.entryKey : null;

  container.innerHTML = html;

  if (focusedKey) {
    const row = Array.from(container.querySelectorAll('tr.watchlist-row')).find(r => r.dataset.entryKey === focusedKey);
    row?.focus({ preventScroll: true });
  }

  loadPeriodHistory(data);
}

// Redraw the last render; no fetching.
export function rerenderOpenState() {
  if (lastRender) renderRows(lastRender.container, lastRender.data, lastRender.options);
}

// The items as the tiles show them, in order, for the chart window.
export function chartItems() {
  return lastRender?.data || [];
}

export async function render(container, {
  feedIds,
  entries,
  pythProvider,
  stocksProvider,
  useColoredPnL = true,
  editMode: _editMode = false, // accepted for older callers; items open the chart window instead
  cachedData = null,
  previousData = null,
  showPriceChart = true,
  forceRefresh = false
}) {
  if (!container) return;
  providers = { pythProvider, stocksProvider };

  // Accept either the legacy `feedIds: string[]` (implicitly pyth) or the new rich `entries`.
  const normalized = Array.isArray(entries) && entries.length > 0
    ? normalizeEntries(entries)
    : normalizeEntries(feedIds);

  if (normalized.length === 0) {
    lastGoodWatchlistData = null;
    renderRows(container, [], { useColoredPnL, showPriceChart, prevPriceMap: {} });
    return [];
  }

  const pythEntries = normalized.filter(e => e.provider === 'pyth');
  const yahooEntries = normalized.filter(e => e.provider === 'yahoo');
  const orderIndex = new Map(normalized.map((e, i) => [entryKey(e), i]));

  const prevPriceMap = {};
  if (previousData) {
    for (const p of previousData) {
      if (p?.key) prevPriceMap[p.key] = p.price;
    }
  }

  const updateUI = (data) => {
    rememberSymbols(data);
    // Every saved entry gets a row, even when its quote failed — otherwise an entry whose feed
    // is down has no remove button and can never be deleted. Rows for entries no longer saved
    // (stale fallback data) are dropped.
    const byKey = new Map();
    for (const item of data || []) {
      if (item?.key && orderIndex.has(item.key) && !byKey.has(item.key)) byKey.set(item.key, item);
    }
    for (const entry of normalized) {
      const key = entryKey(entry);
      if (byKey.has(key)) continue;
      const id = String(entry.id || '');
      byKey.set(key, {
        key,
        provider: entry.provider,
        symbol: entry.symbol || knownSymbol(id) || '…',
        label: entry.label,
        price: null,
        change24h: null,
        unavailable: true
      });
    }
    // Preserve the order the user added entries in, regardless of fetch completion order.
    const sorted = [...byKey.values()].sort((a, b) => (orderIndex.get(a.key) ?? 0) - (orderIndex.get(b.key) ?? 0));
    renderRows(container, sorted, { useColoredPnL, showPriceChart, prevPriceMap });
  };
  const getLastGoodData = () => {
    if (Array.isArray(lastGoodWatchlistData) && lastGoodWatchlistData.length > 0) return lastGoodWatchlistData;
    if (Array.isArray(previousData) && previousData.length > 0) return previousData;
    if (Array.isArray(cachedData) && cachedData.length > 0) return cachedData;
    return null;
  };
  const persistLastGoodData = (data) => {
    if (Array.isArray(data) && data.length > 0) {
      lastGoodWatchlistData = cloneWatchlistData(data);
    }
  };

  let prices = cachedData;

  if (!prices || forceRefresh) {
    // Fetch both providers in parallel.
    const [pythItems, yahooItems] = await Promise.all([
      fetchPythItems(pythEntries, pythProvider, forceRefresh),
      fetchYahooItems(yahooEntries, stocksProvider)
    ]);
    prices = [...pythItems, ...yahooItems];

    if (prices.length === 0) {
      const fallback = getLastGoodData();
      if (fallback) {
        updateUI(fallback);
        persistLastGoodData(fallback);
        return fallback;
      }
      updateUI([]);
      return [];
    }

    // Merge forward data from previousData to avoid flicker.
    if (previousData) {
      for (const item of prices) {
        const prev = previousData.find(p => p.key === item.key);
        if (!prev) continue;
        if (item.change24h == null && prev.change24h != null) item.change24h = prev.change24h;
        if ((!item.priceHistory || item.priceHistory.length === 0) && prev.priceHistory) {
          item.priceHistory = prev.priceHistory;
        }
        if (item.symbol?.startsWith('...') && prev.symbol && !prev.symbol.startsWith('...')) {
          item.symbol = prev.symbol;
        }
      }
    }

    updateUI(prices);
    persistLastGoodData(prices);

    // Background enrichment: symbol resolution (pyth), 24h change (pyth), charts (both).
    (async () => {
      const pythItems = prices.filter(p => p.provider === 'pyth');
      const yahooItems = prices.filter(p => p.provider === 'yahoo');

      const needsSymbols = pythItems.some(p => p.symbol?.startsWith('...'));
      if (needsSymbols && pythProvider?.getPriceFeeds) {
        try {
          const feedMap = await pythProvider.getPriceFeeds(30000);
          const idToSymbol = {};
          for (const [symbol, id] of Object.entries(feedMap || {})) {
            idToSymbol[id.toLowerCase()] = symbol;
          }
          let updated = false;
          for (const item of pythItems) {
            if (item.symbol.startsWith('...') && idToSymbol[item.feedId]) {
              item.symbol = idToSymbol[item.feedId];
              updated = true;
            }
          }
          if (updated) {
            updateUI(prices);
            persistLastGoodData(prices);
          }
        } catch (e) {
          console.warn('[Watchlist] Symbol resolution failed', e);
        }
      }

      await enrichPythWith24hChange(pythItems, pythProvider);
      // Yahoo items already have change24h from the quote endpoint; no extra call needed.
      updateUI(prices);
      persistLastGoodData(prices);

      if (showPriceChart) {
        await Promise.all([
          enrichPythWithHistory(pythItems, pythProvider, () => {
            updateUI(prices);
            persistLastGoodData(prices);
          }),
          enrichYahooWithHistory(yahooItems, stocksProvider, () => {
            updateUI(prices);
            persistLastGoodData(prices);
          })
        ]);
        updateUI(prices);
        persistLastGoodData(prices);
      }
    })();

  } else {
    updateUI(prices);
    persistLastGoodData(prices);

    if (showPriceChart) {
      const pythItems = prices.filter(p => p.provider === 'pyth');
      const yahooItems = prices.filter(p => p.provider === 'yahoo');
      (async () => {
        await Promise.all([
          enrichPythWithHistory(pythItems, pythProvider),
          enrichYahooWithHistory(yahooItems, stocksProvider)
        ]);
        updateUI(prices);
        persistLastGoodData(prices);
      })();
    }
  }

  persistLastGoodData(prices);
  return prices;
}

// Legacy export kept for any outside callers that may still rely on the old shape.
export async function fetchPrices(feedIds, pythProvider, includePriceHistory = false) {
  const entries = normalizeEntries(feedIds);
  const pythEntries = entries.filter(e => e.provider === 'pyth');
  const prices = await fetchPythItems(pythEntries, pythProvider);
  await enrichPythWith24hChange(prices, pythProvider);
  if (includePriceHistory && pythProvider?.getBatch24hPriceHistory) {
    await enrichPythWithHistory(prices, pythProvider);
  }
  return prices;
}

export default { fetchPrices, render, normalizeEntries, getPeriod, setPeriod, chartItems, PERIODS };
