// Watchlist feature (lazy-loaded)

const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'BUSD']);

function isStablecoin(symbol) {
  if (!symbol) return false;
  const upper = symbol.toUpperCase();
  // Check exact match first
  if (STABLECOINS.has(upper)) return true;
  // Check if symbol contains a stablecoin (e.g., "Crypto.USDC/USD")
  for (const stable of STABLECOINS) {
    if (upper.includes(stable)) return true;
  }
  return false;
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
async function fetchBasicPrices(feedIds, pythProvider, bypassCache = false) {
  if (!Array.isArray(feedIds) || feedIds.length === 0 || !pythProvider) return [];

  try {
    // Get prices FIRST (fast, critical) - bypass cache on refresh to get fresh data
    const current = await pythProvider.getLatestByFeedIds(feedIds, 5000, bypassCache);

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
async function enrichWithHistory(prices, pythProvider, onProgress = null) {
  // Filter logic specific to chart fetching (thresholds etc should be handled by caller or here)
  const itemsToFetch = prices.filter(item => !isStablecoin(item.symbol));
  if (itemsToFetch.length === 0) return;

  const feedIds = itemsToFetch.map(i => i.feedId);
  const now = Date.now(); // Anchor time for consistent grid alignment between passes

  try {
    // Pass 1: Low resolution (24 points / 1h) for FAST load
    // This gives the user something to see almost immediately (~4x faster)
    const fastResults = await pythProvider.getBatch24hPriceHistory(feedIds, 24, now);

    // Update items with fast data first
    let hasFastData = false;
    for (const item of itemsToFetch) {
      const history = fastResults[item.feedId];
      if (history && history.length > 0) {
        // Only overwrite if we don't have better data already (e.g. from previous render)
        const shouldUpdate = !item.priceHistory || item.priceHistory.length <= history.length;

        if (shouldUpdate) {
          item.priceHistory = history;
          hasFastData = true;
        }
      }
    }

    // Trigger intermediate render if we found data
    if (hasFastData && onProgress) {
      onProgress();
    }
  } catch (e) {
    console.warn('[Watchlist] Fast history fetch failed', e);
  }

  // Pass 2: High resolution (96 points / 15m) for FINAL quality
  // This will leverage the cache from Pass 1 and only fetch the missing points
  try {
    const fullResults = await pythProvider.getBatch24hPriceHistory(feedIds, 96, now);

    for (const item of itemsToFetch) {
      const history = fullResults[item.feedId];
      if (history && history.length > 0) {
        item.priceHistory = history;
      }
    }
  } catch (e) {
    console.warn('[Watchlist] Full history fetch failed', e);
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

    // Change Color - show pulsing loading indicator if data is still being fetched
    let changeColor = '';
    let changeText = '—'; // Default static dash
    if (change24h !== null && change24h !== undefined) {
      const isPos = change24h >= 0;
      changeColor = useColoredPnL ? (isPos ? 'var(--green)' : 'var(--red)') : '';
      changeText = `${isPos ? '+' : ''}${change24h.toFixed(2)}%`;
    } else if (!isStablecoin(symbol)) {
      // Loading - show pulsing indicator (stablecoins get static dash)
      changeText = '<span class="cell-loading">—</span>';
    }

    // Sparkline - determine chart content based on asset type and data availability
    let chartHtml;
    if (!showPriceChart) {
      // Charts disabled - show nothing
      chartHtml = '';
    } else if (isStablecoin(symbol)) {
      // Stablecoins don't have price charts - show static dash (no loading animation)
      chartHtml = '—';
    } else if (item.priceHistory && item.priceHistory.length > 1) {
      // Has chart data - render sparkline
      const sparkline = createSparkline(item.priceHistory, 60, 24, change24h);
      chartHtml = sparkline || '<span class="cell-loading">—</span>';
    } else {
      // Loading chart data - show pulsing placeholder
      chartHtml = '<span class="cell-loading">—</span>';
    }

    // Flash effect
    const prevPrice = prevPriceMap[feedId];
    let flashClass = '';
    if (prevPrice && price !== prevPrice) {
      flashClass = price > prevPrice ? 'flash-green' : 'flash-red';
    }

    // Edit Mode Action - use same format as positions: [X] symbol (no span wrapper in edit mode)
    const assetCellContent = editMode
      ? `<button class="watchlist-edit-btn" data-feed-id="${feedId}">[X]</button> ${symbol}`
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

export async function render(container, { feedIds, pythProvider, useColoredPnL = true, editMode = false, cachedData = null, previousData = null, showPriceChart = true, forceRefresh = false }) {
  if (!container) return;

  let prices = cachedData;
  const prevPriceMap = {};
  if (previousData) {
    previousData.forEach(p => prevPriceMap[p.feedId] = p.price);
  }

  // Render context helper (must be after prevPriceMap is defined)
  const updateUI = (data) => renderRows(container, data, { useColoredPnL, editMode, showPriceChart, prevPriceMap });

  // Stage 1: Basic Prices (Immediate)
  // On forceRefresh, always fetch fresh data even if we have cached data
  if (!prices || forceRefresh) {
    prices = await fetchBasicPrices(feedIds, pythProvider, forceRefresh);

    if (prices.length === 0) {
      container.innerHTML = `<tr><td colspan="4" class="loading">No data available</td></tr>`;
      return [];
    }

    // Render immediately with what we have (Prices only)
    // Merge with previous data to prevent flickering
    if (previousData) {
      for (const item of prices) {
        // Find matching item in previous data
        // Check both direct feedId match and potential normalized versions
        const prevItem = previousData.find(p =>
          p.feedId === item.feedId ||
          p.feedId.toLowerCase() === item.feedId.toLowerCase()
        );

        if (prevItem) {
          // Preserve existing data if present
          if (!item.change24h && prevItem.change24h) {
            item.change24h = prevItem.change24h;
          }
          if ((!item.priceHistory || item.priceHistory.length === 0) && prevItem.priceHistory) {
            item.priceHistory = prevItem.priceHistory;
          }
          // Also preserve resolved symbol if we currently have a placeholder
          if (item.symbol.startsWith('...') && !prevItem.symbol.startsWith('...')) {
            item.symbol = prevItem.symbol;
          }
        }
      }
    }

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
        // Pass callback to update UI after "fast preview" loaded
        await enrichWithHistory(prices, pythProvider, () => updateUI(prices));
        updateUI(prices); // Re-render with Final Charts
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


