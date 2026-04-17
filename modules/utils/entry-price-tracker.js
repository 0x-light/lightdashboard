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
 * Calculate PnL for positions using stored entry prices
 * @param {Array} positions - Array of position objects with { asset, exchange, amount, price }
 * @returns {Object} - { positions: enriched positions array, updated: boolean }
 */
export function calculatePositionsPnL(positions) {
  if (!Array.isArray(positions) || positions.length === 0) {
    return { positions, updated: false };
  }

  const entryPrices = loadEntryPrices();
  let updated = false;

  const enrichedPositions = positions.map(row => {
    const finalPrice = row.price || 0;
    const posKey = `${row.asset}_${row.exchange}`;
    
    // Skip stablecoins
    if (STABLECOINS.has(row.asset)) {
      row.pnl = 0;
      return row;
    }
    
    // Check if we have a stored entry price
    if (entryPrices[posKey]) {
      const storedEntry = entryPrices[posKey];
      row.entryPrice = storedEntry.price;
      row.entryDate = storedEntry.date;
      
      // Calculate PnL using stored entry price
      const costBasis = Math.abs(row.amount) * storedEntry.price;
      const currentValue = Math.abs(row.amount) * finalPrice;
      row.pnl = currentValue - costBasis;
    } 
    // First time seeing this asset - record current price as entry
    else if (Math.abs(row.amount) > 0 && finalPrice > 0) {
      entryPrices[posKey] = {
        price: finalPrice,
        date: new Date().toISOString(),
        amount: Math.abs(row.amount)
      };
      row.entryPrice = finalPrice;
      row.entryDate = entryPrices[posKey].date;
      row.pnl = 0; // No PnL on first detection
      updated = true;
    }
    
    return row;
  });

  // Save if any entry prices were added
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

