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

const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'BUSD']);
let lastGoodWatchlistData = null;

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
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="sparkline"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1"/></svg>`;
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

  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="sparkline"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1"/></svg>`;
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
      const symbol = idToSymbol[normalizedId] || `...${normalizedId.slice(-6)}`;

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
        name: entry.name || q.name || entry.symbol,
        category: entry.category || null,
        price: q.price,
        change24h: Number.isFinite(q.change24h) ? q.change24h : null,
        // Spark endpoint returns intraday sparkline data alongside the quote, so the row has
        // a chart from the first paint — no second request required.
        priceHistory: Array.isArray(q.priceHistory) && q.priceHistory.length > 1 ? q.priceHistory : null,
        marketState: q.marketState || null
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

// --- Rendering ---

function renderRows(container, data, options) {
  const { useColoredPnL, editMode, showPriceChart, prevPriceMap } = options;

  if (!data || data.length === 0) {
    container.innerHTML = '<tr><td colspan="4" class="text-center dimmed">Watchlist is empty</td></tr>';
    return;
  }

  const html = data.map(item => {
    const symbol = item.symbol;
    const price = item.price;
    const change24h = item.change24h;
    const key = item.key || (item.feedId ? `pyth:${item.feedId}` : `yahoo:${(symbol || '').toUpperCase()}`);

    const priceFormatted = price == null
      ? '—'
      : price < 1
        ? price.toPrecision(4)
        : price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    let changeColor = '';
    let changeText = '—';
    if (change24h !== null && change24h !== undefined) {
      const isPos = change24h >= 0;
      changeColor = useColoredPnL ? (isPos ? 'var(--green)' : 'var(--red)') : '';
      changeText = `${isPos ? '+' : ''}${change24h.toFixed(2)}%`;
    } else if (!isStablecoin(symbol)) {
      changeText = '<span class="cell-loading">—</span>';
    }

    let chartHtml;
    if (!showPriceChart) {
      chartHtml = '';
    } else if (isStablecoin(symbol)) {
      chartHtml = '—';
    } else if (item.priceHistory && item.priceHistory.length > 1) {
      chartHtml = createSparkline(item.priceHistory, 60, 24, change24h) || '<span class="cell-loading">—</span>';
    } else {
      chartHtml = '<span class="cell-loading">—</span>';
    }

    const prevPrice = prevPriceMap[key];
    let flashClass = '';
    if (prevPrice && price !== prevPrice) {
      flashClass = price > prevPrice ? 'flash-green' : 'flash-red';
    }

    const assetCellContent = editMode
      ? `<span class="edit-asset-cell"><button class="watchlist-edit-btn" data-entry-key="${key}">[X]</button>${symbol}</span>`
      : `<span class="symbol">${symbol}</span>`;

    return `
      <tr class="${flashClass}">
        <td>${assetCellContent}</td>
        <td class="text-right font-mono">$${priceFormatted}</td>
        <td class="text-center chart">${chartHtml}</td>
        <td class="text-right font-mono" style="color: ${changeColor}">${changeText}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = html;
}

export async function render(container, {
  feedIds,
  entries,
  pythProvider,
  stocksProvider,
  useColoredPnL = true,
  editMode = false,
  cachedData = null,
  previousData = null,
  showPriceChart = true,
  forceRefresh = false
}) {
  if (!container) return;

  // Accept either the legacy `feedIds: string[]` (implicitly pyth) or the new rich `entries`.
  const normalized = Array.isArray(entries) && entries.length > 0
    ? normalizeEntries(entries)
    : normalizeEntries(feedIds);

  if (normalized.length === 0) {
    lastGoodWatchlistData = null;
    renderRows(container, [], { useColoredPnL, editMode, showPriceChart, prevPriceMap: {} });
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
    // Preserve the order the user added entries in, regardless of fetch completion order.
    const sorted = [...data].sort((a, b) => (orderIndex.get(a.key) ?? 0) - (orderIndex.get(b.key) ?? 0));
    renderRows(container, sorted, { useColoredPnL, editMode, showPriceChart, prevPriceMap });
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
      container.innerHTML = `<tr><td colspan="4" class="loading">No data available</td></tr>`;
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

export default { fetchPrices, render, normalizeEntries };
