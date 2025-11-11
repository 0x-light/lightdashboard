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
    return `<svg width="${width}" height="${height}" class="sparkline"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1"/></svg>`;
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
  
  return `<svg width="${width}" height="${height}" class="sparkline"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1"/></svg>`;
}

export async function fetchPrices(feedIds, pythProvider, includePriceHistory = false) {
  if (!Array.isArray(feedIds) || feedIds.length === 0 || !pythProvider) return [];
  
  const get24hAgoTsSec = () => {
    const nowMs = Date.now();
    return Math.floor((nowMs - 24 * 60 * 60 * 1000) / 1000);
  };
  
  try {
    // Fetch feed metadata to map IDs to symbols
    const feedMap = await pythProvider.getPriceFeeds(10000);
    const idToSymbol = {};
    for (const [symbol, id] of Object.entries(feedMap)) {
      idToSymbol[id.toLowerCase()] = symbol;
    }
    
    const [current, historical] = await Promise.all([
      pythProvider.getLatestByFeedIds(feedIds, 10000),
      pythProvider.getAtTimestampByFeedIds(feedIds, get24hAgoTsSec(), 10000)
    ]);
    
    const results = [];
    for (const feedId of feedIds) {
      const normalizedId = feedId.toLowerCase().startsWith('0x') ? feedId.toLowerCase() : `0x${feedId.toLowerCase()}`;
      const curr = current[normalizedId];
      const hist = historical[normalizedId];
      const symbol = idToSymbol[normalizedId] || normalizedId.slice(0, 10);
      if (curr && curr > 0) {
        const change24h = (hist && hist > 0) ? ((curr - hist) / hist) * 100 : null;
        results.push({ feedId: normalizedId, symbol, price: curr, change24h, priceHistory: null });
      }
    }
    
    // Fetch price history if requested (skip stablecoins)
    // Force to true by default for better UX
    const shouldFetchHistory = includePriceHistory !== false;
    if (shouldFetchHistory && pythProvider.get24hPriceHistory) {
      const historyPromises = results.map(async (item) => {
        if (!isStablecoin(item.symbol)) {
          try {
            const history = await pythProvider.get24hPriceHistory(item.feedId, 3000);
            item.priceHistory = history.length > 0 ? history : null;
          } catch (e) {
            console.warn(`Failed to fetch price history for ${item.symbol}:`, e);
            item.priceHistory = null;
          }
        }
      });
      await Promise.all(historyPromises);
    }
    
    return results;
  } catch (e) {
    console.error('Watchlist fetchPrices error:', e);
    return [];
  }
}

export async function render(container, { feedIds, pythProvider, useColoredPnL = true, editMode = false, cachedData = null, previousData = null, showPriceChart = true }) {
  if (!container) return;
  // Use cached data if available, otherwise fetch fresh (with price history if chart enabled)
  const prices = cachedData || await fetchPrices(feedIds, pythProvider, showPriceChart);
  if (prices.length === 0) {
    const colspan = showPriceChart ? 4 : 3;
    container.innerHTML = `<tr><td colspan="${colspan}" class="loading">No assets in watchlist</td></tr>`;
    return prices; // Return empty array for caching
  }
  
  // Create a map of previous prices for comparison
  const prevPriceMap = {};
  if (previousData && Array.isArray(previousData)) {
    for (const item of previousData) {
      prevPriceMap[item.feedId] = item.price;
    }
  }
  
  const frag = container.ownerDocument.createDocumentFragment();
  for (const item of prices) {
    const tr = container.ownerDocument.createElement('tr');
    const hasChange = item.change24h !== null && item.change24h !== undefined;
    const cls = useColoredPnL
      ? (hasChange ? (item.change24h >= 0 ? 'positive-pnl' : 'negative-pnl') : 'neutral-value')
      : (hasChange ? (item.change24h >= 0 ? 'positive-neutral' : 'negative-neutral') : 'neutral-value');
    const sign = hasChange ? (item.change24h >= 0 ? '+' : '') : '';
    const changeDisplay = hasChange ? `${sign}${item.change24h.toFixed(2)}%` : '—';
    
    // Check if price changed since last update
    const prevPrice = prevPriceMap[item.feedId];
    const priceChanged = prevPrice && Math.abs(item.price - prevPrice) > 0.0001;
    
    // Create cells
    const td1 = container.ownerDocument.createElement('td');
    const td2 = container.ownerDocument.createElement('td');
    const td3 = container.ownerDocument.createElement('td');
    const td4 = container.ownerDocument.createElement('td');
    
    // Set cell contents
    if (editMode) {
      td1.innerHTML = `${item.symbol || '—'} <button class="watchlist-edit-btn btn-text" data-feed-id="${item.feedId}">[REMOVE]</button>`;
    } else {
      td1.textContent = item.symbol || '—';
    }
    
    td2.textContent = `$${item.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    
    // Chart cell (conditionally rendered)
    if (showPriceChart) {
      let chartCell = '<span class="chart-loading">—</span>';
      if (!isStablecoin(item.symbol)) {
        const chartSvg = item.priceHistory ? createSparkline(item.priceHistory, 60, 24, item.change24h) : null;
        chartCell = chartSvg || '<span class="chart-loading">—</span>';
      }
      td3.innerHTML = chartCell;
      td3.className = 'chart-cell';
    }
    
    td4.textContent = changeDisplay;
    td4.className = cls;
    
    // Mark cells for flash animation when price changes
    if (priceChanged) {
      td2.setAttribute('data-flash', 'true');
      if (showPriceChart) {
        td3.setAttribute('data-flash', 'true');
      }
      td4.setAttribute('data-flash', 'true');
    }
    
    tr.appendChild(td1);
    tr.appendChild(td2);
    if (showPriceChart) {
      tr.appendChild(td3);
    }
    tr.appendChild(td4);
    frag.appendChild(tr);
  }
  
  // Insert into DOM first
  container.innerHTML = '';
  container.appendChild(frag);
  
  // Trigger flash animations on changed cells
  requestAnimationFrame(() => {
    const flashCells = container.querySelectorAll('td[data-flash="true"]');
    flashCells.forEach(cell => {
      cell.classList.add('cell-flash');
      cell.addEventListener('animationend', () => {
        cell.classList.remove('cell-flash');
        cell.removeAttribute('data-flash');
      }, { once: true });
    });
  });
  
  return prices; // Return prices for caching
}

export default { fetchPrices, render };


