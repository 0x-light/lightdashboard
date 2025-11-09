// Positions UI module (incremental extraction)
// This module progressively takes over rendering of desktop table and mobile cards.

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

function formatUsd(num, visible) {
  if (!visible) return '$••••';
  const n = Number(num || 0);
  if (!Number.isFinite(n)) return '—';
  
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  
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

function createTableRow(doc, pos, opts) {
  const tr = doc.createElement('tr');
  const amountVisible = !!opts.amountsVisible;
  const value = computeValue(pos);
  const assetKey = `${pos.asset}_${pos.exchange}`;
  const showExactAmounts = opts.settings?.showExactAmounts ?? false;
  
  // Check if compact mode is active by checking body class
  const isCompactMode = doc.body?.classList?.contains('compact-mode');
  
  let cells;
  if (isCompactMode) {
    // Compact: Asset, Price, Value, P&L, 24H%, Amount, Exchange
    // Price and 24H% always visible, hide Value/PnL/Amount
    cells = [
      pos.asset || '—',
      formatUsd(pos.price, true), // Always show price
      formatUsd(value, amountVisible), // Hide value
      formatUsd(pos.pnl, amountVisible), // Hide PnL
      formatPct(pos.change24h), // Always show 24H%
      formatAmount(pos.amount, amountVisible, showExactAmounts), // Hide amount
      pos.exchange || '—'
    ];
  } else {
    // Normal: Asset, Exchange, Amount, Price, Value, 24H%, P&L
    // Price and 24H% always visible, hide Value/PnL/Amount
    cells = [
      pos.asset || '—',
      pos.exchange || '—',
      formatAmount(pos.amount, amountVisible, showExactAmounts), // Hide amount
      formatUsd(pos.price, true), // Always show price
      formatUsd(value, amountVisible), // Hide value
      formatPct(pos.change24h), // Always show 24H%
      formatUsd(pos.pnl, amountVisible) // Hide PnL
    ];
  }
  
  const useColoredPnL = opts.settings?.useColoredPnL ?? true;
  
  for (let i = 0; i < cells.length; i++) {
    const td = doc.createElement('td');
    
    // Determine which column this is
    let isPnL = false;
    let isChange24h = false;
    let isPrice = false;
    let isValue = false;
    if (isCompactMode) {
      // Compact: Asset, Price, Value, P&L, 24H%, Amount, Exchange
      isPrice = (i === 1);
      isValue = (i === 2);
      isPnL = (i === 3);
      isChange24h = (i === 4);
    } else {
      // Normal: Asset, Exchange, Amount, Price, Value, 24H%, P&L
      isPrice = (i === 3);
      isValue = (i === 4);
      isChange24h = (i === 5);
      isPnL = (i === 6);
    }
    
    // Add color classes for PnL and 24H%
    if (useColoredPnL) {
      if (isPnL && pos.pnl != null) {
        td.className = pos.pnl >= 0 ? 'positive-pnl' : 'negative-pnl';
      } else if (isChange24h && pos.change24h != null) {
        td.className = pos.change24h >= 0 ? 'positive-pnl' : 'negative-pnl';
      }
    }
    
    // Mark cells that should flash on price changes
    if (pos.priceChanged && (isPrice || isValue || isPnL)) {
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
    <div class="card-row"><span class="card-label">P&L</span><span class="card-value ${pnlClass}">${formatUsd(pos.pnl, amountVisible)}</span></div>
  `;
  return card;
}

/**
 * Attempt to render positions. Return true if handled, false to let legacy code run.
 */
export function renderPositions({ positions, containers, options }) {
  try {
    if (!containers?.positionsBody) return false;
    const doc = containers.positionsBody.ownerDocument || document;
    const opts = options || {};
    const list = Array.isArray(positions) ? positions : [];
    const filtered = list.filter(p => !shouldHidePosition(p, opts));

    if (filtered.length === 0) {
      containers.positionsBody.innerHTML = '<tr><td colspan="7" class="loading">No positions found</td></tr>';
      if (containers.mobilePositionsContainer) containers.mobilePositionsContainer.innerHTML = '';
      return true;
    }

    const frag = doc.createDocumentFragment();
    const mobileFrag = doc.createDocumentFragment();
    for (const pos of filtered) {
      frag.appendChild(createTableRow(doc, pos, opts));
      if (containers.mobilePositionsContainer) {
        mobileFrag.appendChild(createMobileCard(doc, pos, opts));
      }
    }

    containers.positionsBody.innerHTML = '';
    containers.positionsBody.appendChild(frag);
    if (containers.mobilePositionsContainer) {
      containers.mobilePositionsContainer.innerHTML = '';
      containers.mobilePositionsContainer.appendChild(mobileFrag);
    }

    return true;
  } catch (_) {
    return false;
  }
}

export default { renderPositions };


