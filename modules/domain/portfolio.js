// Pure portfolio math utilities (no side effects)

/**
 * Calculate portfolio 24h change using aggregated positions.
 * Inputs are normalized so this module does not depend on external APIs.
 *
 * @param {Object} params
 * @param {Array} params.positions - Array of positions: { asset, exchange, amount }
 * @param {Object} params.currentPrices - Map: key -> currentPrice
 * @param {Object} params.prices24hAgo - Map: key -> price24hAgo
 * @param {Function} [params.keyFn] - Function to build lookup key for price maps
 * @returns {{ changeUsd: number, changePct: number, value24hAgoUsd: number }}
 */
export function calculatePortfolio24hChange({ positions, currentPrices, prices24hAgo, keyFn }) {
  const makeKey = keyFn || ((pos) => `${pos.asset}_${pos.exchange || 'NA'}`);

  let totalChangeUsd = 0;
  let portfolioValue24hAgo = 0;

  if (!Array.isArray(positions) || positions.length === 0) {
    return { changeUsd: 0, changePct: 0, value24hAgoUsd: 0 };
  }

  for (const pos of positions) {
    const amountAbs = Math.abs(Number(pos?.amount || 0));
    if (!isFinite(amountAbs) || amountAbs <= 0) continue;

    const key = makeKey(pos);
    const current = Number(currentPrices?.[key] ?? currentPrices?.[pos.asset] ?? 0);
    const ago = Number(prices24hAgo?.[key] ?? prices24hAgo?.[pos.asset] ?? 0);

    if (current > 0 && ago > 0) {
      totalChangeUsd += amountAbs * (current - ago);
      portfolioValue24hAgo += amountAbs * ago;
    } else if (current > 0) {
      // If no historical price, use current as baseline to avoid skewing percentage denominator to zero
      portfolioValue24hAgo += amountAbs * current;
    }
  }

  const changePct = portfolioValue24hAgo > 0 ? (totalChangeUsd / portfolioValue24hAgo) * 100 : 0;
  return {
    changeUsd: totalChangeUsd,
    changePct,
    value24hAgoUsd: portfolioValue24hAgo
  };
}

/**
 * Compute realized P&L relative to entry prices for positions that have entry data.
 *
 * @param {Object} params
 * @param {Array} params.positions - { asset, exchange, amount, entryPrice }
 * @param {Object} params.currentPrices - key/value map for current prices
 * @param {Function} [params.keyFn]
 * @returns {{ totalPnlUsd: number }}
 */
export function calculatePortfolioPnL({ positions, currentPrices, keyFn }) {
  const makeKey = keyFn || ((pos) => `${pos.asset}_${pos.exchange || 'NA'}`);
  let totalPnlUsd = 0;
  if (!Array.isArray(positions)) return { totalPnlUsd: 0 };

  for (const pos of positions) {
    const amount = Number(pos?.amount || 0);
    const entry = Number(pos?.entryPrice || 0);
    const key = makeKey(pos);
    const current = Number(currentPrices?.[key] ?? currentPrices?.[pos.asset] ?? 0);
    if (!isFinite(amount) || !isFinite(entry) || !isFinite(current) || entry <= 0 || current <= 0) continue;
    totalPnlUsd += amount * (current - entry);
  }

  return { totalPnlUsd };
}

/**
 * Compute total PnL and PnL% using either per-position pnl values or entry prices.
 * If a position has `pnl` and `value`, we use those to derive cost basis.
 * Otherwise, if it has `entryPrice`, we compute pnl as amount*(current-entry), and
 * cost basis as amount*entry.
 *
 * @param {Array} positions - items may contain { amount, value, pnl, entryPrice, asset, exchange }
 * @param {Object} [currentPrices] - optional; if provided and entryPrice exists, we can compute pnl
 * @param {Function} [keyFn] - optional key fn for currentPrices lookup
 * @returns {{ totalPnlUsd: number, totalPnlPercent: number, totalCostBasisUsd: number }}
 */
export function calculateTotalPnLSummary(positions, currentPrices = undefined, keyFn = undefined) {
  const makeKey = keyFn || ((pos) => `${pos.asset}_${pos.exchange || 'NA'}`);
  let totalPnl = 0;
  let totalCostBasis = 0;

  if (!Array.isArray(positions)) {
    return { totalPnlUsd: 0, totalPnlPercent: 0, totalCostBasisUsd: 0 };
  }

  for (const pos of positions) {
    const currentValue = Number(pos?.value || 0);
    const explicitPnl = pos?.pnl;
    if (explicitPnl !== null && explicitPnl !== undefined && !isNaN(explicitPnl)) {
      totalPnl += Number(explicitPnl) || 0;
      const costBasis = currentValue - (Number(explicitPnl) || 0);
      if (costBasis > 0) totalCostBasis += costBasis;
      continue;
    }

    // Fallback to entry price math if available
    const amount = Number(pos?.amount || 0);
    const entry = Number(pos?.entryPrice || 0);
    if (isFinite(amount) && isFinite(entry) && entry > 0) {
      let currentPrice = undefined;
      if (currentPrices) {
        const key = makeKey(pos);
        currentPrice = Number(currentPrices[key] ?? currentPrices[pos.asset]);
      }
      if (isFinite(currentPrice) && currentPrice > 0) {
        const pnl = amount * (currentPrice - entry);
        totalPnl += pnl;
        totalCostBasis += amount * entry;
        continue;
      }
    }

    // If we reach here, we cannot compute PnL for this position
    // Skip rather than introduce noise.
  }

  const totalPnlPercent = totalCostBasis > 0 ? (totalPnl / totalCostBasis) * 100 : 0;
  return { totalPnlUsd: totalPnl, totalPnlPercent, totalCostBasisUsd: totalCostBasis };
}

export default {
  calculatePortfolio24hChange,
  calculatePortfolioPnL,
  calculateTotalPnLSummary,
  filterPositions,
  calculatePortfolioTotals
};

/**
 * Filter positions based on hidden assets and balance threshold
 * @param {Array} positions 
 * @param {Object} options 
 * @returns {Array}
 */
export function filterPositions(positions, options = {}) {
  const {
    hideHidden = true,
    hideSmall = false,
    threshold = 100,
    hiddenAssets = new Set()
  } = options;

  return positions.filter(p => {
    // Always hide the synthetic account equity positions (HL and Lighter)
    if (p.isHlAccountEquity || p.isLighterAccountEquity) return false;

    // Check hidden assets
    if (hideHidden) {
      const key = `${p.asset}_${p.exchange}`;
      if (hiddenAssets.has(key)) return false;
    }

    // Check balance threshold
    if (hideSmall) {
      const value = p.value || (Math.abs(p.amount || 0) * (p.price || 0));
      if (value < threshold) return false;
    }

    return true;
  });
}

/**
 * Calculate portfolio totals (value and PnL)
 * @param {Array} positions 
 * @returns {Object} { totalValue, totalPnL, totalPnLPercent, costBasis }
 */
export function calculatePortfolioTotals(positions) {
  let totalValue = 0;
  let totalPnL = 0;
  const hasHlEquity = positions.some(p => p.isHlAccountEquity);
  const hasLighterEquity = positions.some(p => p.isLighterAccountEquity);

  // Sum ALL positions in a single pass (handles multiple wallets correctly)
  for (const p of positions) {
    if (p.isHlAccountEquity) {
      // Add Hyperliquid equity (may have multiple wallets)
      totalValue += (p.value || 0);
      totalPnL += (p.pnl || 0);
    } else if (p.isLighterAccountEquity) {
      // Add Lighter equity (may have multiple wallets)
      totalValue += (p.value || 0);
      totalPnL += (p.pnl || 0);
    } else if ((p.exchange === 'HL Perps' || p.exchange === 'HL Spot') && hasHlEquity) {
      // Skip individual HL positions only when account equity is present
      continue;
    } else if (p.exchange === 'Lighter' && hasLighterEquity) {
      // Skip individual Lighter positions only when account equity is present
      continue;
    } else if (p.exchange === 'Lighter Spot') {
      // Lighter Spot positions are NOT included in account equity, add them
      const value = p.value || 0;
      if (value > 0) {
        totalValue += value;
      }
      if (p.pnl !== null && p.pnl !== undefined && !isNaN(p.pnl)) {
        totalPnL += p.pnl;
      }
    } else {
      // Add other positions (wallet balances, etc.)
      const value = p.value || 0;
      if (value > 0) {
        totalValue += value;
      }
      if (p.pnl !== null && p.pnl !== undefined && !isNaN(p.pnl)) {
        totalPnL += p.pnl;
      }
    }
  }

  const costBasis = totalValue - totalPnL;
  const totalPnLPercent = (costBasis > 0) ? (totalPnL / costBasis) * 100 : 0;

  return { totalValue, totalPnL, totalPnLPercent, costBasis };
}

