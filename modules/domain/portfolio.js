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

const finiteOrZero = (v) => (Number.isFinite(v) ? v : 0);

/**
 * True when position should be excluded from totals because a synthetic account-equity row
 * covers its venue. Keeps per-position rows visible in the UI while preventing notional/
 * leveraged value from leaking into portfolio totals.
 */
function isCoveredByVenueEquity(p, hasHlEquity, hasLighterEquity) {
  if (hasHlEquity && (p.exchange === 'HL Perps' || p.exchange === 'HL Spot')) return true;
  // Lighter Spot represents standalone token balances, NOT covered by account equity.
  if (hasLighterEquity && p.exchange === 'Lighter') return true;
  return false;
}

/**
 * Calculate portfolio totals (value and PnL).
 * Single source of truth — IncrementalPortfolioRenderer must delegate here to avoid drift.
 *
 * @param {Array} positions
 * @returns {{ totalValue: number, totalPnL: number, totalPnLPercent: number, costBasis: number }}
 */
export function calculatePortfolioTotals(positions) {
  if (!Array.isArray(positions) || positions.length === 0) {
    return { totalValue: 0, totalPnL: 0, totalPnLPercent: 0, costBasis: 0 };
  }

  let totalValue = 0;
  let totalPnL = 0;
  // Cost basis only counts positions with a known P&L. Holdings without an entry price (cash,
  // custom assets, untracked tokens) would otherwise inflate the basis and shrink the P&L %.
  let costBasis = 0;
  const hasHlEquity = positions.some(p => p?.isHlAccountEquity);
  const hasLighterEquity = positions.some(p => p?.isLighterAccountEquity);

  for (const p of positions) {
    if (!p) continue;

    // Venue equity rows carry the account's NAV. Their P&L is deliberately ignored: it's an
    // exchange-reported account field whose meaning varies (Lighter's generic `pnl` can be
    // lifetime, realized included), and the per-position rows below already carry the
    // unrealized P&L the table shows — so the headline always equals the sum of the P&L column.
    if (p.isHlAccountEquity || p.isLighterAccountEquity) {
      totalValue += finiteOrZero(Number(p.value));
      continue;
    }

    const value = Number(p.value);
    const hasValue = Number.isFinite(value) && value > 0;
    // Covered positions are already inside the venue's equity, so they add no value of their own.
    if (hasValue && !isCoveredByVenueEquity(p, hasHlEquity, hasLighterEquity)) {
      totalValue += value;
    }

    const pnl = p.pnl == null ? NaN : Number(p.pnl);
    if (Number.isFinite(pnl)) {
      totalPnL += pnl;
      costBasis += positionCostBasis(p, pnl);
    }
  }

  const totalPnLPercent = (costBasis > 0) ? (totalPnL / costBasis) * 100 : 0;

  return { totalValue, totalPnL, totalPnLPercent, costBasis };
}

// What the position cost to open, in base currency. Perps: entry notional (value is current
// notional, so a long's entry is value − pnl and a short's is value + pnl). Spot: value − pnl.
function positionCostBasis(p, pnl) {
  const value = Math.abs(finiteOrZero(Number(p.value)));
  if (p.isLeveraged) {
    const fx = Number(p.fxRate) > 0 ? Number(p.fxRate) : 1;
    const entryNotional = Math.abs(Number(p.amount) * Number(p.entryPrice) * fx);
    if (Number.isFinite(entryNotional) && entryNotional > 0) return entryNotional;
    const direction = Number(p.amount) < 0 ? -1 : 1;
    return Math.max(value - direction * pnl, 0);
  }
  return value > 0 ? Math.max(value - pnl, 0) : 0;
}

function venueOf(p) {
  if (p.isHlAccountEquity || p.exchange === 'HL Perps' || p.exchange === 'HL Spot') return 'hl';
  if (p.isLighterAccountEquity || p.exchange === 'Lighter') return 'lighter';
  return null;
}

/**
 * Portfolio composition and 24h move. Slices add up to the headline value from
 * calculatePortfolioTotals, but are always labelled by asset, never by venue:
 *
 * - Venue equity rows (Hyperliquid / Lighter) are split back into what they hold. Spot balances
 *   on the venue keep their own value; the rest of the equity (perp margin + unrealized P&L) is
 *   spread across the venue's open perps by notional size, or shown as "Cash" when none are open.
 * - allocation: [{ label, value, share }] sorted by value; tail folded into "Other" past maxSlices.
 * - change24h / change24hPercent: price-driven move over the last 24h. Perps contribute their
 *   signed notional exposure (shorts gain when price falls); spot contributes its value.
 *   null when no position reports a 24h change.
 */
export function calculatePortfolioBreakdown(positions, { maxSlices = 6 } = {}) {
  const empty = { allocation: [], change24h: null, change24hPercent: null };
  if (!Array.isArray(positions) || positions.length === 0) return empty;

  const hasHlEquity = positions.some(p => p?.isHlAccountEquity);
  const hasLighterEquity = positions.some(p => p?.isLighterAccountEquity);
  const venues = new Map(); // venue -> { equity, spot: [], perps: [] }
  const venue = (key) => {
    if (!venues.has(key)) venues.set(key, { equity: 0, spot: [], perps: [] });
    return venues.get(key);
  };
  const slices = new Map();
  let totalValue = 0;
  let change = 0;
  let hasChange = false;

  const addSlice = (label, value) => {
    if (!(value > 0)) return;
    slices.set(label, (slices.get(label) || 0) + value);
    totalValue += value;
  };

  for (const p of positions) {
    if (!p) continue;

    if (p.isHlAccountEquity || p.isLighterAccountEquity) {
      venue(venueOf(p)).equity += finiteOrZero(Number(p.value));
      continue;
    }

    const pct = Number(p.change24h);
    if (Number.isFinite(pct) && pct > -100) {
      const fx = Number.isFinite(Number(p.fxRate)) && Number(p.fxRate) > 0 ? Number(p.fxRate) : 1;
      const exposure = p.isLeveraged
        ? finiteOrZero(Number(p.amount) * Number(p.price) * fx)
        : finiteOrZero(Number(p.value));
      if (exposure !== 0) {
        change += exposure * (pct / (100 + pct));
        hasChange = true;
      }
    }

    if (isCoveredByVenueEquity(p, hasHlEquity, hasLighterEquity)) {
      const v = venue(venueOf(p));
      (p.isLeveraged || p.exchange === 'HL Perps' ? v.perps : v.spot).push(p);
      continue;
    }
    addSlice(p.asset || '—', finiteOrZero(Number(p.value)));
  }

  for (const { equity, spot, perps } of venues.values()) {
    let remaining = equity;
    for (const p of spot) {
      const value = Math.min(Math.max(finiteOrZero(Number(p.value)), 0), Math.max(remaining, 0));
      addSlice(p.asset || '—', value);
      remaining -= value;
    }
    if (!(remaining > 0)) continue;

    const notional = perps.map(p => Math.abs(finiteOrZero(Number(p.value))));
    const totalNotional = notional.reduce((sum, n) => sum + n, 0);
    if (totalNotional > 0) {
      perps.forEach((p, i) => addSlice(p.asset || '—', remaining * (notional[i] / totalNotional)));
    } else {
      addSlice('Cash', remaining);
    }
  }

  const ranked = Array.from(slices, ([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  const head = ranked.length > maxSlices ? ranked.slice(0, maxSlices - 1) : ranked;
  const tailValue = ranked.slice(head.length).reduce((sum, s) => sum + s.value, 0);
  if (tailValue > 0) head.push({ label: 'Other', value: tailValue, isOther: true });

  const allocation = totalValue > 0
    ? head.map(s => ({ ...s, share: s.value / totalValue }))
    : [];

  const previousValue = totalValue - change;
  return {
    allocation,
    change24h: hasChange ? change : null,
    change24hPercent: hasChange && previousValue > 0 ? (change / previousValue) * 100 : null
  };
}

