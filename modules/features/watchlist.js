// Watchlist feature (lazy-loaded)

const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'BUSD']);

function isStablecoin(asset) {
  return STABLECOINS.has(asset?.toUpperCase());
}

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
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="sparkline"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1"/></svg>`;
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

  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="sparkline"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1"/></svg>`;
}

export async function fetchPrices(feedIds, pythProvider, includePriceHistory = false) {
  // Legacy wrapper for compatibility if used elsewhere, but we recommend using granular fetches
  const prices = await fetchBasicWith24h(feedIds, pythProvider);
  if (includePriceHistory && pythProvider.getBatch24hPriceHistory) {
    await enrichWithHistory(prices, pythProvider);
  }
  return prices;
}

// 1. Minimum Viable Data: Current Prices (Symbols loaded async)
async function fetchBasicPrices(feedIds, pythProvider) {
  if (!Array.isArray(feedIds) || feedIds.length === 0 || !pythProvider) return [];

  try {
    // Get prices FIRST (fast, critical)
    const current = await pythProvider.getLatestByFeedIds(feedIds, 5000);

    // Try to get symbol map from cache (non-blocking, best effort)
    // getPriceFeeds will return instantly from cache if available
    let idToSymbol = {};
    try {
      const feedMap = await Promise.race([
        pythProvider.getPriceFeeds(500), // Very short timeout - only use if cached
        new Promise(resolve => setTimeout(() => resolve({}), 100)) // Fallback to empty after 100ms
      ]);
      for (const [symbol, id] of Object.entries(feedMap)) {
        idToSymbol[id.toLowerCase()] = symbol;
      }
    } catch (e) {
      // Ignore - symbols will just be feed IDs initially
    }

    const results = [];
    for (const feedId of feedIds) {
      const normalizedId = feedId.toLowerCase().startsWith('0x') ? feedId.toLowerCase() : `0x${feedId.toLowerCase()}`;
      const curr = current[normalizedId];
      // Use symbol if available, otherwise show a short version of the feed ID
      const symbol = idToSymbol[normalizedId] || `...${normalizedId.slice(-6)}`;

      if (curr !== undefined) {
        results.push({
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
    console.error('[Watchlist] Basic fetch failed', e);
    return [];
  }
}

// 2. Secondary Data: 24h Change
async function enrichWith24hChange(prices, pythProvider) {
  if (!prices || prices.length === 0) return;

  const get24hAgoTsSec = () => Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
  const feedIds = prices.map(p => p.feedId);

  try {
    const historical = await pythProvider.getAtTimestampByFeedIds(feedIds, get24hAgoTsSec(), 10000);

    for (const item of prices) {
      const hist = historical[item.feedId];
      if (hist && hist > 0 && item.price > 0) {
        item.change24h = ((item.price - hist) / hist) * 100;
      }
    }
  } catch (e) {
    console.warn('[Watchlist] 24h change fetch failed', e);
  }
}

async function fetchBasicWith24h(feedIds, pythProvider) {
  const prices = await fetchBasicPrices(feedIds, pythProvider);
  await enrichWith24hChange(prices, pythProvider);
  return prices;
}

// 3. Tertiary Data: Charts
async function enrichWithHistory(prices, pythProvider) {
  // Filter logic specific to chart fetching (thresholds etc should be handled by caller or here)
  const itemsToFetch = prices.filter(item => !isStablecoin(item.symbol) && !item.priceHistory);
  if (itemsToFetch.length === 0) return;

  try {
    const feedIds = itemsToFetch.map(i => i.feedId);
    const batchResults = await pythProvider.getBatch24hPriceHistory(feedIds, 96); // Match positions resolution

    for (const item of itemsToFetch) {
      const history = batchResults[item.feedId];
      if (history && history.length > 0) {
        item.priceHistory = history;
      }
    }
  } catch (e) {
    console.warn('[Watchlist] History fetch failed', e);
  }
}

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
    const feedId = item.feedId;

    // Formatting
    const priceFormatted = price < 1
      ? price.toPrecision(4)
      : price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Change Color
    let changeColor = '';
    let changeText = '-';
    if (change24h !== null && change24h !== undefined) {
      const isPos = change24h >= 0;
      changeColor = useColoredPnL ? (isPos ? 'var(--green)' : 'var(--red)') : '';
      changeText = `${isPos ? '+' : ''}${change24h.toFixed(2)}%`;
    }

    // Sparkline
    let chartHtml = '';
    if (showPriceChart && item.priceHistory && item.priceHistory.length > 1) {
      chartHtml = createSparkline(item.priceHistory, 80, 24, change24h) || '';
    }

    // Flash effect
    const prevPrice = prevPriceMap[feedId];
    let flashClass = '';
    if (prevPrice && price !== prevPrice) {
      flashClass = price > prevPrice ? 'flash-green' : 'flash-red';
    }

    // Edit Mode Action
    let actionHtml = '';
    if (editMode) {
      actionHtml = `<button class="btn-text watchlist-edit-btn" data-feed-id="${feedId}" style="color: var(--red);">[X]</button>`;
    }

    return `
      <tr class="${flashClass}">
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${editMode ? actionHtml : ''}
            <span class="symbol">${symbol}</span>
          </div>
        </td>
        <td class="text-right font-mono">$${priceFormatted}</td>
        <td class="text-center chart">${chartHtml}</td>
        <td class="text-right font-mono" style="color: ${changeColor}">${changeText}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = html;
}

export async function render(container, { feedIds, pythProvider, useColoredPnL = true, editMode = false, cachedData = null, previousData = null, showPriceChart = true }) {
  if (!container) return;

  let prices = cachedData;
  const prevPriceMap = {};
  if (previousData) {
    previousData.forEach(p => prevPriceMap[p.feedId] = p.price);
  }

  // Render context helper (must be after prevPriceMap is defined)
  const updateUI = (data) => renderRows(container, data, { useColoredPnL, editMode, showPriceChart, prevPriceMap });

  // Stage 1: Basic Prices (Immediate)
  if (!prices) {
    prices = await fetchBasicPrices(feedIds, pythProvider);

    if (prices.length === 0) {
      container.innerHTML = `<tr><td colspan="4" class="loading">No data available</td></tr>`;
      return [];
    }

    // Render immediately with what we have (Prices only)
    updateUI(prices);

    // Trigger Stage 2 & 3 in background

    // Stage 1.5: Resolve Symbols (if we showed feed IDs initially)
    // Stage 2: 24h Change
    (async () => {
      // Check if any item has placeholder symbol (starts with "...")
      const needsSymbols = prices.some(p => p.symbol.startsWith('...'));
      if (needsSymbols) {
        try {
          const feedMap = await pythProvider.getPriceFeeds(30000); // Full timeout now
          const idToSymbol = {};
          for (const [symbol, id] of Object.entries(feedMap)) {
            idToSymbol[id.toLowerCase()] = symbol;
          }
          let updated = false;
          for (const item of prices) {
            if (item.symbol.startsWith('...') && idToSymbol[item.feedId]) {
              item.symbol = idToSymbol[item.feedId];
              updated = true;
            }
          }
          if (updated) updateUI(prices);
        } catch (e) {
          console.warn('[Watchlist] Symbol resolution failed', e);
        }
      }

      await enrichWith24hChange(prices, pythProvider);
      updateUI(prices); // Re-render with % changes

      // Stage 3: Charts
      if (showPriceChart) {
        await enrichWithHistory(prices, pythProvider);
        updateUI(prices); // Re-render with Charts
      }
    })();

  } else {
    // Cached data case
    updateUI(prices);

    // Refresh background data if needed? 
    // For now assume cached data is good enough to start, but we might want to refresh.
    // Current design assumes 'cachedData' is fresh from a recent fetch if generated by app.js?
    // Actually usually cachedData is from localStorage and might be stale.
    // But let's stick to the requested scope: "Fast Load".

    // Check if we are missing history
    if (showPriceChart) {
      (async () => {
        await enrichWithHistory(prices, pythProvider);
        updateUI(prices);
      })();
    }
  }

  return prices;
}

export default { fetchPrices, render };


