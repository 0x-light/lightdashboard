// Watchlist feature (lazy-loaded)

export async function fetchPrices(feedIds, pythProvider) {
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
        results.push({ feedId: normalizedId, symbol, price: curr, change24h });
      }
    }
    return results;
  } catch (_) {
    return [];
  }
}

export async function render(container, { feedIds, pythProvider, useColoredPnL = true, editMode = false, cachedData = null, previousData = null }) {
  if (!container) return;
  // Use cached data if available, otherwise fetch fresh
  const prices = cachedData || await fetchPrices(feedIds, pythProvider);
  if (prices.length === 0) {
    container.innerHTML = '<tr><td colspan="3" class="loading">No assets in watchlist</td></tr>';
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
    
    // Set cell contents
    if (editMode) {
      td1.innerHTML = `${item.symbol || '—'} <button class="watchlist-edit-btn btn-text" data-feed-id="${item.feedId}">[REMOVE]</button>`;
    } else {
      td1.textContent = item.symbol || '—';
    }
    
    td2.textContent = `$${item.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    td3.textContent = changeDisplay;
    td3.className = cls;
    
    // Mark cells for flash animation when price changes
    if (priceChanged) {
      td2.setAttribute('data-flash', 'true');
      td3.setAttribute('data-flash', 'true');
    }
    
    tr.appendChild(td1);
    tr.appendChild(td2);
    tr.appendChild(td3);
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

