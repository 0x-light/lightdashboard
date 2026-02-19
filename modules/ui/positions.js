// Positions UI module (incremental extraction)
// This module progressively takes over rendering of desktop table and mobile cards.

const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'BUSD']);

function isStablecoin(asset) {
  return STABLECOINS.has(asset?.toUpperCase());
}

// Custom mouse-tracking tooltip for funding rates
let fundingTooltipEl = null;
let activeTooltipCell = null; // Track which cell has active tooltip

function initFundingTooltip() {
  if (fundingTooltipEl) return;
  fundingTooltipEl = document.createElement('div');
  fundingTooltipEl.className = 'funding-rate-tooltip';
  document.body.appendChild(fundingTooltipEl);

  // Click anywhere to dismiss tooltip (for mobile)
  document.addEventListener('click', (e) => {
    // If clicking on the active tooltip cell, toggle off
    // If clicking elsewhere, hide tooltip
    if (activeTooltipCell && !activeTooltipCell.contains(e.target)) {
      hideFundingTooltip();
    }
  }, true);

  // Also hide on scroll
  document.addEventListener('scroll', hideFundingTooltip, true);
}

function showFundingTooltip(e, text) {
  if (!fundingTooltipEl) initFundingTooltip();
  fundingTooltipEl.textContent = text;
  fundingTooltipEl.classList.add('visible');
  activeTooltipCell = e.currentTarget;
  updateTooltipPosition(e);
}

function hideFundingTooltip() {
  if (fundingTooltipEl) {
    fundingTooltipEl.classList.remove('visible');
  }
  activeTooltipCell = null;
}

function updateTooltipPosition(e) {
  if (!fundingTooltipEl) return;
  // Position tooltip to follow mouse with offset
  const x = e.clientX + 12;
  const y = e.clientY + 12;
  fundingTooltipEl.style.left = `${x}px`;
  fundingTooltipEl.style.top = `${y}px`;
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
    // For small values, preserve significant digits (e.g., $0.0341 not $0.03)
    return `${sign}$${abs.toPrecision(4)}`;
  }
}

// Format price with full precision (no compact notation) - like watchlist
function formatPrice(num, visible) {
  if (!visible) return '$••••';
  const n = Number(num || 0);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '$0';

  const abs = Math.abs(n);
  // For small prices, use precision-based formatting to preserve significant digits
  // e.g., 0.0341 should show as $0.0341, not $0.03
  if (abs < 1) {
    return `$${abs.toPrecision(4)}`;
  }
  // For larger prices, use 2 decimal places with comma separators
  return `$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPct(num, isLoading = false) {
  if (num === null || num === undefined || Number.isNaN(num)) {
    return isLoading ? '<span class="cell-loading">—</span>' : '—';
  }
  const n = Number(num);
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : (n < 0 ? '−' : '');
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

function formatFunding(num, visible, isLoading = false) {
  if (!visible) return '$••••';
  if (num === null || num === undefined || Number.isNaN(num)) {
    return isLoading ? '<span class="cell-loading">—</span>' : '—';
  }
  const n = Number(num);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '$0';

  const abs = Math.abs(n);
  const sign = n > 0 ? '+' : '−';

  // Format with appropriate precision
  if (abs >= 1000) {
    const formatted = (abs / 1000).toFixed(1);
    return `${sign}$${formatted.replace(/\.0$/, '')}k`;
  } else if (abs >= 1) {
    return `${sign}$${abs.toFixed(2)}`;
  } else {
    return `${sign}$${abs.toFixed(4)}`;
  }
}

function formatFundingRate(rate) {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return null;
  const n = Number(rate);
  if (!Number.isFinite(n)) return null;
  // Convert to percentage and format (rate is per hour, e.g. 0.0000125 = 0.00125%)
  const pct = n * 100;
  const sign = pct > 0 ? '+' : (pct < 0 ? '−' : '');
  return `${sign}${Math.abs(pct).toFixed(4)}%/hr`;
}

function formatFundingRateExtended(rate) {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return null;
  const n = Number(rate);
  if (!Number.isFinite(n)) return null;

  // rate is per hour as decimal
  const hourlyPct = n * 100;
  const monthlyPct = n * 100 * 24 * 30;  // 720 hours/month
  const yearlyPct = n * 100 * 24 * 365;  // 8760 hours/year

  const sign = (v) => v > 0 ? '+' : (v < 0 ? '−' : '');

  return {
    hourly: `${sign(hourlyPct)}${Math.abs(hourlyPct).toFixed(4)}%`,
    monthly: `${sign(monthlyPct)}${Math.abs(monthlyPct).toFixed(2)}%`,
    yearly: `${sign(yearlyPct)}${Math.abs(yearlyPct).toFixed(1)}%`
  };
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

  // Add class for hidden positions (shown with reduced opacity)
  if (pos.isHiddenPosition) {
    tr.className = 'position-row-hidden';
  }

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
  const fundingChanged = prev && Math.abs((pos.funding || 0) - (prev.funding || 0)) > 0.01;

  // Change detection for flash animations

  // Create sparkline chart - stablecoins get static dash, others get pulsing loading indicator
  let chartCell;
  if (isStablecoin(pos.asset)) {
    // Stablecoins don't have charts - static dash (no animation)
    chartCell = '—';
  } else if (pos.priceHistory) {
    // Has chart data - render sparkline
    chartCell = createSparkline(pos.priceHistory, 60, 24, pos.change24h) || '<span class="chart-loading">—</span>';
  } else {
    // Loading chart data - pulsing placeholder
    chartCell = '<span class="chart-loading">—</span>';
  }

  // Determine loading states:
  // - 24H% is loading if null and not a stablecoin
  // - Funding is loading if null and position is leveraged (perps have funding)
  const is24hLoading = pos.change24h == null && !isStablecoin(pos.asset);
  const isFundingLoading = pos.funding == null && pos.isLeveraged;

  // Use compact column order
  // Order: Asset, Price, Chart, Value, P&L, Funding, 24H%, Amount, Exchange
  const cells = [
    pos.asset || '—',
    formatPrice(pos.price, true),
    chartCell,
    formatUsd(value, amountVisible),
    formatUsd(pos.pnl, amountVisible, true),
    formatFunding(pos.funding, amountVisible, isFundingLoading),
    formatPct(pos.change24h, is24hLoading),
    formatAmount(pos.amount, amountVisible, showExactAmounts),
    pos.exchange || '—'
  ];

  const useColoredPnL = opts.settings?.useColoredPnL ?? true;
  const fundingRateTooltip = formatFundingRate(pos.fundingRate);
  const fundingRateExt = formatFundingRateExtended(pos.fundingRate);
  // Build extended tooltip text with hourly, monthly, yearly extrapolations
  const fundingTooltipText = fundingRateExt
    ? `Hourly: ${fundingRateExt.hourly}\nMonthly: ${fundingRateExt.monthly}\nYearly: ${fundingRateExt.yearly}`
    : null;

  for (let i = 0; i < cells.length; i++) {
    const td = doc.createElement('td');

    // Column indices: Asset, Price, Chart, Value, P&L, Funding, 24H%, Amount, Exchange
    const isPrice = (i === 1);
    const isChart = (i === 2);
    const isValue = (i === 3);
    const isPnL = (i === 4);
    const isFunding = (i === 5);
    const isChange24h = (i === 6);

    // Add color classes for PnL, Funding, and 24H%
    if (useColoredPnL) {
      if (isPnL && pos.pnl != null) {
        td.className = pos.pnl >= 0 ? 'positive-pnl' : 'negative-pnl';
      } else if (isFunding && pos.funding != null) {
        td.className = pos.funding >= 0 ? 'positive-pnl' : 'negative-pnl';
      } else if (isChange24h && pos.change24h != null) {
        td.className = pos.change24h >= 0 ? 'positive-pnl' : 'negative-pnl';
      }
    }

    // Mark cells that should flash on price changes (like watchlist)
    const shouldFlash =
      (isPrice && priceChanged) ||
      (isValue && valueChanged) ||
      (isPnL && pnlChanged) ||
      (isFunding && fundingChanged) ||
      (isChart && (priceChanged || change24hChanged)) ||
      (isChange24h && change24hChanged);

    if (shouldFlash) {
      td.setAttribute('data-flash', 'true');
    }

    if (i === 0 && opts.editMode) {
      // Add × or + button to asset cell in edit mode
      // × = hide, + = restore (only for manually hidden positions, NOT <$100)
      // For manual positions, mark with data-manual-type for proper deletion
      const isManual = pos.isManual || (pos.exchange && typeof pos.exchange === 'string' && pos.exchange.startsWith('Manual'));
      const isManuallyHidden = pos.isManuallyHidden; // Only manually hidden get +

      if (isManual) {
        // Manual positions can be deleted
        let manualType = pos.manualType;
        if (!manualType && pos.exchange) {
          manualType = pos.exchange.includes('Pyth') ? 'pyth' : 'custom';
        }
        td.innerHTML = `<span class="edit-asset-cell"><button class="position-delete-btn" data-asset="${pos.asset}" data-manual-type="${manualType}">×</button>${String(cells[i])}</span>`;
      } else if (isManuallyHidden) {
        // Manually hidden positions show + to restore
        td.innerHTML = `<span class="edit-asset-cell"><button class="position-restore-btn" data-asset-key="${assetKey}">+</button>${String(cells[i])}</span>`;
      } else {
        // Normal positions show × to hide
        td.innerHTML = `<span class="edit-asset-cell"><button class="position-edit-btn" data-asset-key="${assetKey}">×</button>${String(cells[i])}</span>`;
      }
    } else if (isChart) {
      // Chart column uses innerHTML
      td.innerHTML = cells[i];
      td.className = 'chart-cell chart';
    } else if (isFunding && fundingTooltipText) {
      // Funding column with custom mouse-tracking tooltip for current rate
      // Use innerHTML if content contains HTML (loading indicator)
      const cellContent = String(cells[i]);
      if (cellContent.includes('<span')) {
        td.innerHTML = cellContent;
      } else {
        td.textContent = cellContent;
      }
      td.classList.add('funding-cell');
      td.setAttribute('data-funding-rate', fundingTooltipText);
      // Attach tooltip event listeners
      td.addEventListener('mouseenter', (e) => showFundingTooltip(e, fundingTooltipText));
      td.addEventListener('mousemove', updateTooltipPosition);
      td.addEventListener('mouseleave', hideFundingTooltip);
    } else {
      // Use innerHTML if content contains HTML (loading indicator), otherwise textContent
      const cellContent = String(cells[i]);
      if (cellContent.includes('<span')) {
        td.innerHTML = cellContent;
      } else {
        td.textContent = cellContent;
      }
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

  // Compute change flags for mobile flash animations (mirrors table logic)
  const key = pos._changeDetectionKey || `${pos.asset}_${pos.exchange}`;
  const prevGlobal = (typeof window !== 'undefined' && Array.isArray(window._previousRenderData))
    ? window._previousRenderData.find(p => (p._changeDetectionKey || `${p.asset}_${p.exchange}`) === key)
    : null;
  const prevValue = prevGlobal ? computeValue(prevGlobal) : null;
  const priceChanged = prevGlobal && Math.abs((pos.price || 0) - (prevGlobal.price || 0)) > 0.0001;
  const valueChanged = prevGlobal && Math.abs(value - (prevValue || 0)) > 0.01;
  const pnlChanged = prevGlobal && Math.abs((pos.pnl || 0) - (prevGlobal.pnl || 0)) > 0.01;
  const change24hChanged = prevGlobal && Math.abs((pos.change24h || 0) - (prevGlobal.change24h || 0)) > 0.01;
  const fundingChanged = prevGlobal && Math.abs((pos.funding || 0) - (prevGlobal.funding || 0)) > 0.01;

  // Color classes for PnL, Funding, and 24H%
  const pnlClass = useColoredPnL && pos.pnl != null ? (pos.pnl >= 0 ? 'positive-pnl' : 'negative-pnl') : '';
  const changeClass = useColoredPnL && pos.change24h != null ? (pos.change24h >= 0 ? 'positive-pnl' : 'negative-pnl') : '';
  const fundingClass = useColoredPnL && pos.funding != null ? (pos.funding >= 0 ? 'positive-pnl' : 'negative-pnl') : '';

  // Format funding rate for display (shown inline on mobile)
  const fundingRateText = formatFundingRate(pos.fundingRate);
  const fundingRateDisplay = fundingRateText ? ` <span class="funding-rate-inline">(${fundingRateText})</span>` : '';

  card.innerHTML = `
    <div class="card-row"><span class="card-label">Asset</span><span class="card-asset">${pos.asset || '—'}</span></div>
    <div class="card-row"><span class="card-label">Exchange</span><span class="card-value">${pos.exchange || '—'}</span></div>
    <div class="card-row"><span class="card-label">Amount</span><span class="card-value">${formatAmount(pos.amount, amountVisible, showExactAmounts)}</span></div>
    <div class="card-row"><span class="card-label">Price</span><span class="card-value"${priceChanged ? ' data-flash="true"' : ''}>${formatPrice(pos.price, true)}</span></div>
    <div class="card-row"><span class="card-label">Value</span><span class="card-value"${valueChanged ? ' data-flash="true"' : ''}>${formatUsd(value, amountVisible)}</span></div>
    <div class="card-row"><span class="card-label">24H%</span><span class="card-value ${changeClass}"${change24hChanged ? ' data-flash="true"' : ''}>${formatPct(pos.change24h)}</span></div>
    <div class="card-row"><span class="card-label">P&L</span><span class="card-value ${pnlClass}"${pnlChanged ? ' data-flash="true"' : ''}>${formatUsd(pos.pnl, amountVisible, true)}</span></div>
    <div class="card-row"><span class="card-label">Funding</span><span class="card-value ${fundingClass}"${fundingChanged ? ' data-flash="true"' : ''}>${formatFunding(pos.funding, amountVisible)}${fundingRateDisplay}</span></div>
  `;
  return card;
}

/**
 * Render positions with atomic header+body update.
 * Returns positions array for caching (like watchlist).
 */
export function renderPositions({ positions, containers, options, previousPositions = [] }) {
  try {
    if (!containers?.positionsBody) return positions;
    const doc = containers.positionsBody.ownerDocument || document;
    const opts = options || {};

    const list = Array.isArray(positions) ? positions : [];
    const filtered = list.filter(p => !shouldHidePosition(p, opts));

    if (filtered.length === 0) {
      const emptyRow = doc.createElement('tr');
      const emptyCell = doc.createElement('td');
      emptyCell.colSpan = 9;
      emptyCell.className = 'loading';
      emptyCell.textContent = 'No positions found';
      emptyRow.appendChild(emptyCell);
      containers.positionsBody.replaceChildren(emptyRow);
      if (containers.mobilePositionsContainer) containers.mobilePositionsContainer.replaceChildren();
      return positions;
    }

    // Build map of previous values for comparison (like watchlist)
    const prevDataMap = {};
    if (Array.isArray(previousPositions)) {
      for (const pos of previousPositions) {
        if (!pos || !pos.asset || !pos.exchange) continue; // Skip invalid entries
        try {
          const key = pos._changeDetectionKey || `${pos.asset}_${pos.exchange}`;
          prevDataMap[key] = {
            price: pos.price,
            value: computeValue(pos), // Compute value dynamically
            pnl: pos.pnl,
            change24h: pos.change24h,
            funding: pos.funding
          };
        } catch (e) {
          // Skip this position if there's an error computing value
          continue;
        }
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

    // Atomic DOM update using replaceChildren() which is truly atomic
    // (no intermediate empty state visible to the user, unlike innerHTML = '' + appendChild)
    containers.positionsBody.replaceChildren(frag);
    if (containers.mobilePositionsContainer) {
      containers.mobilePositionsContainer.replaceChildren(mobileFrag);
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

      // Trigger flash animations in mobile cards
      if (containers.mobilePositionsContainer) {
        const mobileFlashNodes = containers.mobilePositionsContainer.querySelectorAll('[data-flash="true"]');
        mobileFlashNodes.forEach(node => {
          node.classList.add('cell-flash');
          node.addEventListener('animationend', () => {
            node.classList.remove('cell-flash');
            node.removeAttribute('data-flash');
          }, { once: true });
        });
      }
    });

    return positions; // Return for caching
  } catch (_) {
    return positions;
  }
}

export default { renderPositions };


