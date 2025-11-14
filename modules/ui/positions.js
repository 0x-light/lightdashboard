// Positions UI module (incremental extraction)
// This module progressively takes over rendering of desktop table and mobile cards.

const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'BUSD']);

function isStablecoin(asset) {
  return STABLECOINS.has(asset?.toUpperCase());
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

function formatAmount(num, visible, showExact = false) {
  if (!visible) return '••••';
  const n = Number(num || 0);
  if (!Number.isFinite(n)) return '—';
  
  if (showExact) {
    return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
  }
  
  // Round to reasonable precision
  const abs = Math.abs(n);
  if (abs >= 1000000) {
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

function formatUsd(num, visible, showPlusSign = false) {
  if (!visible) return '$••••';
  const n = Number(num || 0);
  if (!Number.isFinite(n)) return '—';
  
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : (showPlusSign && n > 0 ? '+' : '');
  
  // Format large numbers compactly
  if (abs >= 1000000) {
    const formatted = (abs / 1000000).toFixed(1);
    return `${sign}$${formatted.replace(/\.0$/, '')}M`;
  } else if (abs >= 1000) {
    const formatted = (abs / 1000).toFixed(1);
    return `${sign}$${formatted.replace(/\.0$/, '')}k`;
  } else if (abs >= 1) {
    // Show cents, but remove unnecessary trailing zeros
    return `${sign}$${abs.toFixed(2).replace(/\.00$/, '')}`;
  } else if (abs === 0) {
    return '$0';
  } else {
    return `${sign}$${abs.toFixed(2)}`;
  }
}

function formatPct(num) {
  if (num === null || num === undefined || Number.isNaN(num)) return '—';
  const n = Number(num);
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : (n < 0 ? '−' : '');
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

function computeValue(pos) {
  if (typeof pos.value === 'number') return pos.value;
  const amount = Number(pos.amount || 0);
  const price = Number(pos.price || 0);
  if (!Number.isFinite(amount) || !Number.isFinite(price)) return 0;
  return amount * price;
}

function shouldHidePosition(pos, opts) {
  if (opts.hideNfts && pos.exchange === 'OpenSea') return true;
  if (opts.hideSmallPositions) {
    const threshold = Number(opts.settings?.minBalanceThreshold || 100);
    if (computeValue(pos) < threshold) return true;
  }
  return false;
}

function createTableRow(doc, pos, opts, prevDataMap) {
  const tr = doc.createElement('tr');
  const amountVisible = !!opts.amountsVisible;
  const value = computeValue(pos);
  const assetKey = `${pos.asset}_${pos.exchange}`;
  const showExactAmounts = opts.settings?.showExactAmounts ?? false;
  const showPriceChart = opts.settings?.showPriceChart ?? true;
  
  // Check if values changed (simple comparison like watchlist)
  const key = pos._changeDetectionKey || `${pos.asset}_${pos.exchange}`;
  const prev = prevDataMap[key];
  const priceChanged = prev && Math.abs((pos.price || 0) - (prev.price || 0)) > 0.0001;
  const valueChanged = prev && Math.abs(value - (prev.value || 0)) > 0.01;
  const pnlChanged = prev && Math.abs((pos.pnl || 0) - (prev.pnl || 0)) > 0.01;
  const change24hChanged = prev && Math.abs((pos.change24h || 0) - (prev.change24h || 0)) > 0.01;
  
  // Create sparkline chart (skip for stablecoins)
  let chartCell = '<span class="chart-loading">—</span>';
  if (!isStablecoin(pos.asset)) {
    const chartSvg = pos.priceHistory ? createSparkline(pos.priceHistory, 60, 24, pos.change24h) : null;
    chartCell = chartSvg || '<span class="chart-loading">—</span>';
  }
  
  // Use compact column order (only order)
  // Order: Asset, Price, Chart, Value, P&L, 24H%, Amount, Exchange
  const cells = [
    pos.asset || '—',
    formatUsd(pos.price, true),
    chartCell,
    formatUsd(value, amountVisible),
    formatUsd(pos.pnl, amountVisible, true),
    formatPct(pos.change24h),
    formatAmount(pos.amount, amountVisible, showExactAmounts),
    pos.exchange || '—'
  ];
  
  const useColoredPnL = opts.settings?.useColoredPnL ?? true;
  
  for (let i = 0; i < cells.length; i++) {
    const td = doc.createElement('td');
    
    // Column indices: Asset, Price, Chart, Value, P&L, 24H%, Amount, Exchange
    const isPrice = (i === 1);
    const isChart = (i === 2);
    const isValue = (i === 3);
    const isPnL = (i === 4);
    const isChange24h = (i === 5);
    
    // Add color classes for PnL and 24H%
    if (useColoredPnL) {
      if (isPnL && pos.pnl != null) {
        td.className = pos.pnl >= 0 ? 'positive-pnl' : 'negative-pnl';
      } else if (isChange24h && pos.change24h != null) {
        td.className = pos.change24h >= 0 ? 'positive-pnl' : 'negative-pnl';
      }
    }
    
    // Mark cells that should flash on price changes (like watchlist)
    const shouldFlash = 
      (isPrice && priceChanged) ||
      (isValue && valueChanged) ||
      (isPnL && pnlChanged) ||
      (isChart && (priceChanged || change24hChanged)) ||
      (isChange24h && change24hChanged);
    
    if (shouldFlash) {
      td.setAttribute('data-flash', 'true');
    }
    
    if (i === 0 && opts.editMode) {
      // Add hide/show button to asset cell in edit mode
      // For manual positions, add a DELETE button instead
      if (pos.isManual) {
        td.innerHTML = `${String(cells[i])} <button class="position-delete-btn" data-asset="${pos.asset}" data-manual-type="${pos.manualType}">[DELETE]</button>`;
      } else {
        td.innerHTML = `${String(cells[i])} <button class="position-edit-btn" data-asset-key="${assetKey}">[HIDE]</button>`;
      }
    } else if (isChart) {
      // Chart column uses innerHTML
      td.innerHTML = cells[i];
      td.className = 'chart-cell chart';
    } else {
      td.textContent = String(cells[i]);
    }
    tr.appendChild(td);
  }
  return tr;
}

function createMobileCard(doc, pos, opts) {
  const card = doc.createElement('div');
  card.className = 'mobile-position-card';
  const amountVisible = !!opts.amountsVisible;
  const value = computeValue(pos);
  const useColoredPnL = opts.settings?.useColoredPnL ?? true;
  const showExactAmounts = opts.settings?.showExactAmounts ?? false;
  
  // Color classes for PnL and 24H%
  const pnlClass = useColoredPnL && pos.pnl != null ? (pos.pnl >= 0 ? 'positive-pnl' : 'negative-pnl') : '';
  const changeClass = useColoredPnL && pos.change24h != null ? (pos.change24h >= 0 ? 'positive-pnl' : 'negative-pnl') : '';
  
  card.innerHTML = `
    <div class="card-row"><span class="card-label">Asset</span><span class="card-asset">${pos.asset || '—'}</span></div>
    <div class="card-row"><span class="card-label">Exchange</span><span class="card-value">${pos.exchange || '—'}</span></div>
    <div class="card-row"><span class="card-label">Amount</span><span class="card-value">${formatAmount(pos.amount, amountVisible, showExactAmounts)}</span></div>
    <div class="card-row"><span class="card-label">Price</span><span class="card-value">${formatUsd(pos.price, true)}</span></div>
    <div class="card-row"><span class="card-label">Value</span><span class="card-value">${formatUsd(value, amountVisible)}</span></div>
    <div class="card-row"><span class="card-label">24H%</span><span class="card-value ${changeClass}">${formatPct(pos.change24h)}</span></div>
    <div class="card-row"><span class="card-label">P&L</span><span class="card-value ${pnlClass}">${formatUsd(pos.pnl, amountVisible, true)}</span></div>
  `;
  return card;
}

/**
 * Render positions with atomic header+body update.
 * Returns positions array for caching (like watchlist).
 */
export function renderPositions({ positions, containers, options, previousPositions = [] }) {
  console.log(`[Positions Render] Called with ${positions?.length || 0} positions, ${previousPositions?.length || 0} previous`);
  try {
    if (!containers?.positionsBody) return positions;
    const doc = containers.positionsBody.ownerDocument || document;
    const opts = options || {};

    const list = Array.isArray(positions) ? positions : [];
    const filtered = list.filter(p => !shouldHidePosition(p, opts));

    if (filtered.length === 0) {
      containers.positionsBody.innerHTML = `<tr><td colspan="8" class="loading">No positions found</td></tr>`;
      if (containers.mobilePositionsContainer) containers.mobilePositionsContainer.innerHTML = '';
      return positions;
    }

    // Build map of previous values for comparison (like watchlist)
    const prevDataMap = {};
    if (Array.isArray(previousPositions)) {
      for (const pos of previousPositions) {
        if (!pos) continue; // Skip undefined/null entries
        const key = pos._changeDetectionKey || `${pos.asset}_${pos.exchange}`;
        prevDataMap[key] = {
          price: pos.price,
          value: computeValue(pos), // Compute value dynamically
          pnl: pos.pnl,
          change24h: pos.change24h
        };
      }
    }

    // Build fragments for atomic update
    const frag = doc.createDocumentFragment();
    const mobileFrag = doc.createDocumentFragment();
    for (const pos of filtered) {
      frag.appendChild(createTableRow(doc, pos, opts, prevDataMap));
      if (containers.mobilePositionsContainer) {
        mobileFrag.appendChild(createMobileCard(doc, pos, opts));
      }
    }

    // Atomic DOM update - clear and replace in one operation
    containers.positionsBody.innerHTML = '';
    containers.positionsBody.appendChild(frag);
    if (containers.mobilePositionsContainer) {
      containers.mobilePositionsContainer.innerHTML = '';
      containers.mobilePositionsContainer.appendChild(mobileFrag);
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
    });

    return positions; // Return for caching
  } catch (_) {
    return positions;
  }
}

export default { renderPositions };


