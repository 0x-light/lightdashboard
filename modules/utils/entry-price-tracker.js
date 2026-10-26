/**
 * Entry Price Tracker Utility
 * Centralized entry price management for wallet assets (DRY principle)
 */

const STORAGE_KEY = 'walletAssetEntryPrices';
const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'BUSD', 'FEUSD']);

/**
 * Load entry prices from localStorage
 */
export function loadEntryPrices() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (e) {
    console.error('[EntryPriceTracker] Failed to load:', e);
    return {};
  }
}

/**
 * Save entry prices to localStorage
 */
export function saveEntryPrices(entryPrices) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entryPrices));
    return true;
  } catch (e) {
    console.error('[EntryPriceTracker] Failed to save:', e);
    return false;
  }
}

/**
 * Calculate PnL for positions using stored entry prices.
 * The entry is an estimate: the price when the dashboard first saw the holding, averaged with
 * the price at each later increase. It is not the real purchase price.
 * @param {Array} positions - Array of position objects with { asset, exchange, amount, price }
 * @param {Object} [options]
 * @param {Function} [options.scope] - (key) => true for the entries this report covers in full.
 *   Pass it only with a complete, successful report: an entry in scope that has no row is a
 *   sold-out holding and is deleted, so a later re-buy starts fresh.
 * @returns {Object} - { positions: enriched positions array, updated: boolean }
 */
export function calculatePositionsPnL(positions, { scope = null } = {}) {
  if (!Array.isArray(positions) || (positions.length === 0 && !scope)) {
    return { positions, updated: false };
  }

  const entryPrices = loadEntryPrices();
  const seededLegacyKeys = new Set();
  let updated = false;

  const enrichedPositions = positions.map(row => {
    // Stablecoins have no P&L, and their value must not enter the cost basis.
    if (STABLECOINS.has(row.asset)) {
      row.pnl = null;
      return row;
    }

    const price = Number(row.price);
    // A missing amount is unknown, not zero: it must not reset the entry.
    const amount = row.amount == null ? NaN : Math.abs(Number(row.amount));
    const posKey = row._changeDetectionKey || `${row.asset}_${row.exchange}_${row.wallet || 'unknown'}`;
    row.pnl = null;
    if (!Number.isFinite(amount)) return row;

    // A sold-out holding starts fresh when it comes back.
    if (amount === 0) {
      if (entryPrices[posKey]) {
        delete entryPrices[posKey];
        updated = true;
      }
      return row;
    }

    // Entries were once keyed by asset and exchange only: seed each wallet's entry from that.
    const legacyKey = `${row.asset}_${row.exchange}`;
    if (!entryPrices[posKey] && legacyKey !== posKey && entryPrices[legacyKey]) {
      entryPrices[posKey] = { ...entryPrices[legacyKey], amount };
      seededLegacyKeys.add(legacyKey);
      updated = true;
    }

    const entry = entryPrices[posKey];
    if (entry) {
      row.entryPrice = entry.price;
      row.entryDate = entry.date;
      row.entryIsEstimate = true;
    }
    // Without a price the P&L is unknown, not a full loss.
    if (!Number.isFinite(price) || price <= 0) return row;

    if (!entry) {
      entryPrices[posKey] = { price, date: new Date().toISOString(), amount };
      row.entryPrice = price;
      row.entryDate = entryPrices[posKey].date;
      row.entryIsEstimate = true;
      row.pnl = 0;
      updated = true;
      return row;
    }

    const storedAmount = Number(entry.amount);
    if (Number.isFinite(storedAmount) && storedAmount > 0 && amount > storedAmount) {
      // The added part is costed at the current price.
      entry.price = (storedAmount * entry.price + (amount - storedAmount) * price) / amount;
      row.entryPrice = entry.price;
    }
    if (storedAmount !== amount) {
      entry.amount = amount;
      updated = true;
    }

    row.pnl = amount * (price - entry.price);
    return row;
  });

  for (const key of seededLegacyKeys) delete entryPrices[key];

  if (scope) {
    const reported = new Set(positions.map(row => row._changeDetectionKey || `${row.asset}_${row.exchange}_${row.wallet || 'unknown'}`));
    for (const key of Object.keys(entryPrices)) {
      if (!reported.has(key) && scope(key)) {
        delete entryPrices[key];
        updated = true;
      }
    }
  }

  if (updated) {
    saveEntryPrices(entryPrices);
  }

  return { positions: enrichedPositions, updated };
}

/**
 * Reset entry price for a specific asset
 */
export function resetEntryPrice(assetKey) {
  const entryPrices = loadEntryPrices();
  if (entryPrices[assetKey]) {
    delete entryPrices[assetKey];
    saveEntryPrices(entryPrices);
    return true;
  }
  return false;
}

/**
 * Manually set entry price for an asset. Returns false if the price is not a finite positive
 * number, or if the underlying save fails — callers in the console helper can surface this.
 */
export function setEntryPrice(assetKey, price, date = null) {
  const parsed = parseFloat(price);
  if (!assetKey || !Number.isFinite(parsed) || parsed <= 0) {
    console.warn('[EntryPriceTracker] setEntryPrice rejected invalid input:', { assetKey, price });
    return false;
  }
  const entryPrices = loadEntryPrices();
  const previous = entryPrices[assetKey];
  entryPrices[assetKey] = {
    price: parsed,
    date: date || new Date().toISOString(),
    // Preserve the amount recorded at first detection when available; avoid clobbering it to 0
    // for a fresh manual entry so downstream tooling can distinguish "never detected" from zero.
    ...(previous?.amount !== undefined ? { amount: previous.amount } : {})
  };
  return saveEntryPrices(entryPrices);
}

/**
 * Reset all entry prices
 */
export function resetAllEntryPrices() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (e) {
    console.error('[EntryPriceTracker] Failed to reset:', e);
    return false;
  }
}

/**
 * Export entry prices as JSON string
 */
export function exportEntryPrices() {
  const entryPrices = loadEntryPrices();
  return JSON.stringify(entryPrices, null, 2);
}

/**
 * Import entry prices from JSON string
 */
export function importEntryPrices(jsonString) {
  try {
    const entryPrices = JSON.parse(jsonString);
    saveEntryPrices(entryPrices);
    return true;
  } catch (e) {
    console.error('[EntryPriceTracker] Failed to import:', e);
    return false;
  }
}

/**
 * View all stored entry prices (for debugging)
 */
export function viewEntryPrices() {
  return loadEntryPrices();
}

export default {
  calculatePositionsPnL,
  loadEntryPrices,
  saveEntryPrices,
  resetEntryPrice,
  setEntryPrice,
  resetAllEntryPrices,
  exportEntryPrices,
  importEntryPrices,
  viewEntryPrices
};

