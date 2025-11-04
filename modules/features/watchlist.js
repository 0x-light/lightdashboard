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

export async function render(container, { feedIds, pythProvider, useColoredPnL = true, editMode = false, cachedData = null }) {
  if (!container) return;
  // Use cached data if available, otherwise fetch fresh
  const prices = cachedData || await fetchPrices(feedIds, pythProvider);
  if (prices.length === 0) {
    container.innerHTML = '<tr><td colspan="3" class="loading">No assets in watchlist</td></tr>';
    return prices; // Return empty array for caching
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
    
    if (editMode) {
      // In edit mode, add a remove button
      tr.innerHTML = `
        <td>${item.symbol || '—'} <button class="watchlist-edit-btn btn-text" data-feed-id="${item.feedId}">[REMOVE]</button></td>
        <td>$${item.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
        <td class="${cls}">${changeDisplay}</td>
      `;
    } else {
      tr.innerHTML = `
        <td>${item.symbol || '—'}</td>
        <td>$${item.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
        <td class="${cls}">${changeDisplay}</td>
      `;
    }
    frag.appendChild(tr);
  }
  container.innerHTML = '';
  container.appendChild(frag);
  return prices; // Return prices for caching
}

export default { fetchPrices, render };

