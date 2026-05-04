/**
 * Incremental Portfolio Renderer
 * Streams positions as each provider responds (no blocking)
 */
import { getRandomSpinner } from '../ui/unicode-animations.js';
import {
  getFxCurrency,
  getQuoteUnitScale,
  normalizeBaseCurrency,
  normalizeCurrencyCode
} from '../utils/currency.js';
import { calculatePortfolioTotals } from './portfolio.js';

export class IncrementalPortfolioRenderer {
  constructor({ providers, settings, containers, ui, expectedProviders = [], initialPositions = null }) {
    this.providers = providers;
    this.settings = settings;
    this.containers = containers; // { positionsBody, mobileContainer, summaryEl }
    this.ui = ui; // { HeroUI, PositionsUI }

    // Accumulated state - use cached positions if available to prevent flicker on refresh
    // This allows the UI to show existing data while fresh data is being fetched
    this.allPositions = initialPositions || window.cachedPositions || [];
    this.providerStatus = new Map(); // track which providers finished
    this.providerErrors = new Map();
    this.renderDebounce = null;
    // If we have initial positions, we're not really "loading" - just refreshing in background
    this.isLoading = this.allPositions.length === 0;
    this.expectedProviders = expectedProviders; // List of provider names we're waiting for
    // Preserve previous render data from last renderer instance for smooth transitions
    // This prevents flickering when tab visibility changes or portfolio refreshes
    this.previousRenderData = window._previousRenderData || [];
    this.renderCount = 0; // Track render calls for performance monitoring
    this.isRendering = false; // Lock to prevent concurrent renders
    this.pendingRender = false; // Flag to schedule another render after current completes

    // Memoization: aggregation + totals are pure over `allPositions`. A token bumped whenever
    // positions change lets filter-only renders (hide-small, edit mode, amount visibility) reuse
    // prior work instead of rebuilding Maps and re-summing every time.
    this._positionsToken = 0;
    this._cachedAggregation = null;
    this._cachedAggregationToken = -1;
    this._cachedTotals = null;
    this._cachedTotalsToken = -1;
    this._fxRatesToken = 0;
    this._fxRatesBase = null;
    this._fxRates = new Map();
    this._fxRatesLoading = new Set();

    // Store reference to renderer IMMEDIATELY for external re-renders
    window._portfolioRenderer = this;

    // Only show loader if we don't have initial positions
    if (this.isLoading) {
      this.showGreetingLoader();
    }

    // Safety timeout: force hide loader after 10 seconds no matter what
    this.safetyTimeout = setTimeout(() => {
      if (this.isLoading) {
        this.hideGreetingLoader();
      }
    }, 10000);

    // If we have initial positions, render them immediately
    if (this.allPositions.length > 0) {
      this.render();
    }
  }

  /**
   * Show mini loader in greeting while loading
   */
  showGreetingLoader() {
    const greeting = document.getElementById('newGreeting');
    if (!greeting) return;

    // Check if a spinner already exists (prevent duplicates)
    if (document.getElementById('greetingLoader') || greeting.querySelector('span[style*="marginLeft"]')) {
      return;
    }

    // Pick a random spinner each time
    const { frames, interval } = getRandomSpinner();
    let currentFrame = 0;

    // Create loader span
    const loader = document.createElement('span');
    loader.id = 'greetingLoader';
    loader.style.marginLeft = '8px';
    loader.style.color = 'var(--accent)';
    loader.textContent = frames[0];

    // Animate the spinner
    this.spinnerInterval = setInterval(() => {
      currentFrame = (currentFrame + 1) % frames.length;
      if (loader.parentElement) {
        loader.textContent = frames[currentFrame];
      }
    }, interval);

    greeting.appendChild(loader);
  }

  /**
   * Hide loader in greeting
   */
  hideGreetingLoader() {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }

    if (this.safetyTimeout) {
      clearTimeout(this.safetyTimeout);
      this.safetyTimeout = null;
    }

    const loader = document.getElementById('greetingLoader');
    if (loader) {
      loader.remove();
    }

    // Also remove hero loading animation
    const summaryEl = document.getElementById('newSummary');
    if (summaryEl) {
      summaryEl.classList.remove('fading');
    }

    this.isLoading = false;
  }

  /**
   * Clear all positions and reset status (for hard refresh)
   */
  clearPositions() {
    this.allPositions = [];
    this._positionsToken++;
    this.providerStatus.clear();
    this.providerErrors.clear();
    this.isLoading = true;
    this.showGreetingLoader();
    this.render(); // Clear UI immediately
  }

  /**
   * Remove positions matching a predicate
   * @param {Function} predicate - Function that returns true for positions to remove
   */
  removePositions(predicate) {
    if (typeof predicate !== 'function') return;
    const before = this.allPositions.length;
    this.allPositions = this.allPositions.filter(p => !predicate(p));
    if (this.allPositions.length !== before) {
      this._positionsToken++;
      this.render();
    }
  }

  /**
   * Append new positions and re-render immediately
   * When refreshing, removes old positions from the same source to prevent duplicates
   */
  appendPositions(newRows, source, options = {}) {
    if (!Array.isArray(newRows) || newRows.length === 0) {
      this.providerStatus.set(source, 'completed');
      this.providerErrors.delete(source);
      this.checkIfAllProvidersFinished();
      this.renderProviderStatus();
      return;
    }

    const lengthBefore = this.allPositions.length;

    // If a removeFilter is provided, use it to remove specific old positions
    // This is useful for refreshing specific wallets/providers without clearing everything
    if (options.removeFilter && typeof options.removeFilter === 'function') {
      try {
        this.allPositions = this.allPositions.filter(p => {
          try {
            return !options.removeFilter(p);
          } catch (e) {
            console.warn('[Portfolio] removeFilter error:', e);
            return true; // Keep position if filter fails
          }
        });
      } catch (e) {
        console.error('[Portfolio] Failed to apply removeFilter:', e);
      }
    }
    // Fallback: If this source already reported data, remove old positions from same source
    // This prevents accumulating duplicates when refreshing if no filter is provided
    else if (this.providerStatus.has(source)) {
      // Build a set of keys from new rows for efficient lookup
      const newKeys = new Set(newRows.map(r => r._changeDetectionKey || `${r.asset}_${r.exchange}`));
      // Filter out positions that will be replaced by new ones
      this.allPositions = this.allPositions.filter(p => {
        const key = p._changeDetectionKey || `${p.asset}_${p.exchange}`;
        return !newKeys.has(key);
      });
    }

    if (this.allPositions.length !== lengthBefore) this._positionsToken++;

    this.allPositions.push(...newRows);
    this._positionsToken++;
    this.providerStatus.set(source, 'completed');
    this.providerErrors.delete(source);

    // Check if all providers finished
    this.checkIfAllProvidersFinished();
    const fxPromise = this.loadFxRatesForPositions(newRows);

    // Debouncing tuned for streaming providers: render first batch quickly, coalesce the rest.
    // Prior value (250ms) added ~750ms to first paint with 3 providers. 80ms feels instant while
    // still batching the common "multiple providers return within one tick" case.
    const debounceDelay = this.renderCount === 0 ? 16 : 80;
    const scheduleRender = () => {
      clearTimeout(this.renderDebounce);
      this.renderDebounce = setTimeout(() => this.render(), debounceDelay);
    };
    if (fxPromise) {
      fxPromise.finally(scheduleRender);
    } else {
      scheduleRender();
    }
    this.renderProviderStatus();
  }

  /**
   * Mark provider as failed (render what we have so far)
   */
  markProviderFailed(source, error) {
    console.warn(`[${source}] Failed:`, error?.message || error);
    this.providerStatus.set(source, 'failed');
    this.providerErrors.set(source, error?.message || String(error || 'Unknown error'));
    this.checkIfAllProvidersFinished();
    this.renderProviderStatus();
  }

  getBaseCurrency() {
    return normalizeBaseCurrency(this.settings?.portfolioBaseCurrency);
  }

  resetFxRatesIfNeeded() {
    const base = this.getBaseCurrency();
    if (this._fxRatesBase === base) return;
    this._fxRatesBase = base;
    this._fxRates = new Map([[base, 1]]);
    this._fxRatesLoading.clear();
    this._fxRatesToken++;
  }

  localConversionRate(currency) {
    const base = this.getBaseCurrency();
    const normalized = normalizeCurrencyCode(currency, 'USD');
    const fxCurrency = getFxCurrency(normalized);
    if (fxCurrency === base) return getQuoteUnitScale(normalized);
    return null;
  }

  conversionRateFor(currency) {
    this.resetFxRatesIfNeeded();
    const normalized = normalizeCurrencyCode(currency, 'USD');
    const localRate = this.localConversionRate(normalized);
    if (Number.isFinite(localRate)) return localRate;
    const rate = Number(this._fxRates.get(normalized));
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  }

  currenciesNeedingFx(positions) {
    this.resetFxRatesIfNeeded();
    const missing = new Set();
    for (const position of Array.isArray(positions) ? positions : []) {
      const currency = normalizeCurrencyCode(position?.currency || position?.sourceCurrency || 'USD', 'USD');
      if (this.localConversionRate(currency) !== null) continue;
      if (this._fxRates.has(currency)) continue;
      if (this._fxRatesLoading.has(currency)) continue;
      missing.add(currency);
    }
    return Array.from(missing);
  }

  loadFxRatesForPositions(positions) {
    const missing = this.currenciesNeedingFx(positions);
    if (missing.length === 0) return null;
    const base = this.getBaseCurrency();
    missing.forEach(currency => this._fxRatesLoading.add(currency));

    return (async () => {
      try {
        const rates = await this.providers?.stocks?.getFxRates?.(missing, base, { timeoutMs: 5000 });
        const unresolved = [];
        for (const currency of missing) {
          const rate = Number(rates?.[currency]);
          if (Number.isFinite(rate) && rate > 0) {
            this._fxRates.set(currency, rate);
          } else {
            this._fxRates.set(currency, null);
            unresolved.push(currency);
          }
        }
        if (unresolved.length > 0) {
          this.providerStatus.set('FX', 'failed');
          this.providerErrors.set('FX', `missing ${unresolved.join(', ')} rate`);
        } else {
          this.providerStatus.set('FX', 'completed');
          this.providerErrors.delete('FX');
        }
      } catch (e) {
        missing.forEach(currency => this._fxRates.set(currency, null));
        this.providerStatus.set('FX', 'failed');
        this.providerErrors.set('FX', e?.message || String(e || 'Failed to load FX rates'));
      } finally {
        missing.forEach(currency => this._fxRatesLoading.delete(currency));
        this._fxRatesToken++;
        this.renderProviderStatus();
        this.forceRender();
      }
    })();
  }

  convertPositionToBase(position) {
    const baseCurrency = this.getBaseCurrency();
    const sourceCurrency = normalizeCurrencyCode(position?.currency || position?.sourceCurrency || 'USD', 'USD');
    const rate = this.conversionRateFor(sourceCurrency);
    const sourcePrice = Number(position?.sourcePrice ?? position?.price ?? 0);
    const sourceValue = Number(position?.sourceValue ?? position?.value ?? 0);
    const sourcePnl = position?.sourcePnl ?? position?.pnl;
    const sourceFunding = position?.sourceFunding ?? position?.funding;
    const hasRate = Number.isFinite(rate) && rate > 0;

    return {
      ...position,
      price: sourcePrice,
      sourcePrice,
      sourceValue,
      sourcePnl,
      sourceFunding,
      sourceCurrency,
      currency: sourceCurrency,
      baseCurrency,
      fxRate: hasRate ? rate : null,
      fxConversionMissing: !hasRate,
      value: hasRate && Number.isFinite(sourceValue) ? sourceValue * rate : 0,
      pnl: hasRate && Number.isFinite(Number(sourcePnl)) ? Number(sourcePnl) * rate : null,
      funding: hasRate && Number.isFinite(Number(sourceFunding)) ? Number(sourceFunding) * rate : sourceFunding
    };
  }

  convertPositionsToBase(positions) {
    this.loadFxRatesForPositions(positions);
    return (Array.isArray(positions) ? positions : []).map(position => this.convertPositionToBase(position));
  }

  renderProviderStatus() {
    const el = this.containers?.providerStatusEl || document.getElementById('newProviderStatus');
    if (!el) return;

    const expected = Array.from(new Set(this.expectedProviders || []));
    const failed = [];
    const pending = [];
    for (const provider of expected) {
      const status = this.providerStatus.get(provider);
      if (status === 'failed') failed.push(provider);
      else if (!status && this.isLoading) pending.push(provider);
    }
    for (const [provider, status] of this.providerStatus.entries()) {
      if (status === 'failed' && !failed.includes(provider)) failed.push(provider);
    }

    const parts = [];
    if (pending.length > 0) parts.push(`Loading: ${pending.join(', ')}`);
    if (failed.length > 0) {
      const failedText = failed.map(provider => {
        const message = this.providerErrors.get(provider);
        return message ? `${provider} (${message})` : provider;
      }).join(', ');
      parts.push(`Failed: ${failedText}`);
    }

    if (parts.length === 0) {
      el.hidden = true;
      el.textContent = '';
      return;
    }

    el.hidden = false;
    el.textContent = parts.join(' · ');
  }

  /**
   * Check if all expected providers have finished (completed or failed)
   */
  checkIfAllProvidersFinished() {
    if (!this.isLoading) return;

    // If no expected providers specified, hide after first data
    if (this.expectedProviders.length === 0) {
      if (this.allPositions.length > 0) {
        this.hideGreetingLoader();
      }
      return;
    }

    // Check if all expected providers have reported in
    const finished = [];
    const pending = [];

    for (const provider of this.expectedProviders) {
      if (this.providerStatus.has(provider)) {
        finished.push(provider);
      } else {
        pending.push(provider);
      }
    }

    const allFinished = pending.length === 0;

    if (allFinished) {
      this.hideGreetingLoader();
      // Trigger Pyth enrichment for positions missing 24h change
      this.enrichMissing24hWithPyth();
    }
  }

  /**
   * Enrich positions missing 24h change using Pyth historical prices
   */
  async enrichMissing24hWithPyth() {
    // Find positions missing 24h change
    const needsEnrichment = this.allPositions.filter(p =>
      p.change24h === null || p.change24h === undefined
    );

    if (needsEnrichment.length === 0) return;

    try {
      // Get Pyth feed map
      const feedMap = await this.providers?.pyth?.getPriceFeeds?.();
      if (!feedMap) return;

      // Map asset symbols to feed IDs
      const symbolToFeedId = {};
      for (const [symbol, id] of Object.entries(feedMap)) {
        symbolToFeedId[symbol.toUpperCase()] = id;
      }

      // Find positions that have matching Pyth feeds
      const positionsWithFeeds = [];
      for (const pos of needsEnrichment) {
        const feedId = symbolToFeedId[pos.asset?.toUpperCase()];
        if (feedId) {
          positionsWithFeeds.push({ pos, feedId });
        }
      }

      if (positionsWithFeeds.length === 0) return;

      // Get 24h ago timestamp
      const ts24hAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);

      // Fetch historical prices from Pyth
      const feedIds = positionsWithFeeds.map(p => p.feedId);
      const historicalPrices = await this.providers?.pyth?.getAtTimestampByFeedIds?.(feedIds, ts24hAgo, 10000);

      if (!historicalPrices) return;

      let updated = false;
      for (const { pos, feedId } of positionsWithFeeds) {
        const normalizedFeedId = feedId.toLowerCase().startsWith('0x') ? feedId.toLowerCase() : `0x${feedId.toLowerCase()}`;
        const price24hAgo = historicalPrices[normalizedFeedId];

        if (price24hAgo && price24hAgo > 0 && pos.price && pos.price > 0) {
          pos.change24h = ((pos.price - price24hAgo) / price24hAgo) * 100;
          updated = true;
        }
      }

      // Re-render if we updated any positions
      if (updated) {
        this._positionsToken++; // mutated change24h in place, invalidate aggregation/totals cache
        this.render();
      }
    } catch (e) {
      console.warn('[Portfolio] Pyth 24h enrichment failed:', e);
    }
  }


  /**
   * Re-render positions table and hero with current data
   * Uses a render lock to prevent concurrent renders that cause flickering
   */
  render() {
    // If a render is in progress, mark that we need another render when it completes
    if (this.isRendering) {
      this.pendingRender = true;
      return;
    }

    this.isRendering = true;
    this.renderCount++;
    this.renderProviderStatus();
    const { PositionsUI, HeroUI } = this.ui;
    const { positionsBody, mobileContainer, summaryEl } = this.containers;

    if (this.allPositions.length === 0) {
      if (positionsBody) {
        positionsBody.innerHTML = '<tr><td colspan="9" class="loading">Fetching positions...</td></tr>';
      }
      if (summaryEl) {
        summaryEl.innerHTML = 'Loading portfolio...';
      }
      this.isRendering = false;
      return;
    }

    // Aggregate + totals are memoized on the positions token. Toggle-driven renders
    // (hide amounts, edit mode, small-position filter) reuse the cached result.
    let sorted;
    const baseCurrency = this.getBaseCurrency();
    const aggregationToken = `${this._positionsToken}:${this._fxRatesToken}:${baseCurrency}`;
    if (this._cachedAggregationToken === aggregationToken && this._cachedAggregation) {
      sorted = this._cachedAggregation;
    } else {
      const converted = this.convertPositionsToBase(this.allPositions);
      const aggregated = this.aggregatePositions(converted);
      sorted = aggregated.sort((a, b) => (b.value || 0) - (a.value || 0));
      this._cachedAggregation = sorted;
      this._cachedAggregationToken = aggregationToken;
    }

    let totals;
    if (this._cachedTotalsToken === aggregationToken && this._cachedTotals) {
      totals = this._cachedTotals;
    } else {
      totals = this.calculateTotals(sorted);
      this._cachedTotals = totals;
      this._cachedTotalsToken = aggregationToken;
    }
    const { totalValue, totalPnL, totalPnLPercent } = totals;

    // Filter for display (hide special positions + apply filters)
    // Edit mode: shows manually hidden positions (for editing), but NOT <$100 positions
    // Normal mode: hides both unless showHiddenPositions is true
    const hideSmallPositions = window.hideSmallPositions ?? true;
    const showHiddenPositions = window.showHiddenPositions ?? false;
    const editMode = window.editMode ?? false;
    const minThreshold = this.settings.minBalanceThreshold || 100;
    const hiddenAssets = window.hiddenAssets || new Set();

    const visible = sorted.filter(p => {
      // Hide special tracking positions always
      if (p.isHlAccountEquity || p.isLighterAccountEquity) return false;

      const assetKey = `${p.asset}_${p.exchange}`;
      const isManuallyHidden = hiddenAssets.has(assetKey);
      const isSmall = !p.fxConversionMissing && hideSmallPositions && (p.value || 0) < minThreshold;

      // Clear flags first
      p.isHiddenPosition = false;
      p.isManuallyHidden = false;

      // Handle manually hidden positions
      if (isManuallyHidden) {
        if (editMode || showHiddenPositions) {
          // Show in edit mode (or when showing hidden)
          p.isHiddenPosition = true;
          p.isManuallyHidden = true; // Flag for [+] button
          return true;
        }
        return false;
      }

      // Handle <$100 positions (never get [+], just filtered)
      if (isSmall) {
        if (showHiddenPositions) {
          // Show with styling but NO [+] button (not restorable, just filtered)
          p.isHiddenPosition = true;
          p.isManuallyHidden = false; // No [+] button for these
          return true;
        }
        return false;
      }

      return true;
    });

    // Render positions table
    if (PositionsUI && positionsBody) {
      const rendered = PositionsUI.renderPositions({
        positions: visible,
        containers: { positionsBody, mobilePositionsContainer: mobileContainer },
        options: {
          amountsVisible: !document.body.classList.contains('amounts-hidden'),
          hideSmallPositions: false, // Already filtered above
          editMode: window.editMode || false,
          settings: {
            minBalanceThreshold: minThreshold,
            showExactAmounts: this.settings.showExactAmounts || false,
            useColoredPnL: this.settings.useColoredPnL ?? true,
            showPriceChart: this.settings.showPriceChart ?? true,
            portfolioBaseCurrency: baseCurrency
          }
        },
        previousPositions: this.previousRenderData || window._previousRenderData || []
      });
      // Cache for next render (like watchlist) - update both local and global
      this.previousRenderData = rendered;
      window._previousRenderData = rendered;
    }

    // Render hero
    if (HeroUI && summaryEl) {
      const heroHtml = HeroUI.composeSummary({
        portfolioValue: totalValue,
        amountsVisible: !document.body.classList.contains('amounts-hidden'),
        heroPnLMode: 'total',
        totalPnL,
        totalPnLPercent,
        totalDailyChange: 0,
        totalDailyChangePercent: 0,
        baseCurrency,
        useColoredPnL: this.settings.useColoredPnL ?? true,
        highlightsHtml: [],
        weather: window.cachedWeather || null
      });
      summaryEl.innerHTML = heroHtml;
    }

    // Store in global cache for other functions
    window.cachedPositions = sorted;
    window.cachedSummaryData = { totalValue, totalPnL, totalPnLPercent };

    // Store reference to renderer for external re-renders
    window._portfolioRenderer = this;

    // Release render lock
    this.isRendering = false;

    // If another render was requested while we were rendering, do it now
    if (this.pendingRender) {
      this.pendingRender = false;
      // Use requestAnimationFrame to batch the next render with the browser's paint cycle
      requestAnimationFrame(() => this.render());
    }
  }

  /**
   * Force re-render with current data (for filter toggles)
   * Uses minimal debounce to coalesce rapid clicks
   */
  forceRender() {
    clearTimeout(this.renderDebounce);
    this.renderDebounce = setTimeout(() => this.render(), 16); // ~1 frame
  }

  /**
   * Aggregate duplicate assets
   */
  aggregatePositions(positions) {
    // First, deduplicate positions by unique key (asset + exchange)
    // This prevents duplicates from showing up when providers are called multiple times
    const uniquePositions = new Map();
    for (const row of positions) {
      const key = row._changeDetectionKey || `${row.asset}_${row.exchange}`;
      // Keep the LAST occurrence of each position (newer data takes precedence)
      uniquePositions.set(key, row);
    }

    const aggregated = [];
    const assetGroups = new Map();

    for (const row of uniquePositions.values()) {
      // Keep special positions separate
      if (row.isLeveraged || row.isHlAccountEquity || row.isLighterAccountEquity) {
        aggregated.push(row);
        continue;
      }

      // Keep HL Perps/Spot and Lighter Spot separate
      if (row.exchange === 'HL Perps' || row.exchange === 'HL Spot' || row.exchange === 'Lighter Spot') {
        aggregated.push(row);
        continue;
      }

      // Keep Manual positions separate (to allow deletion)
      if (row.exchange && typeof row.exchange === 'string' && row.exchange.startsWith('Manual')) {
        aggregated.push(row);
        continue;
      }

      // Keep brokerage positions separate; they may share tickers with manual/watchlist assets
      // but carry account-specific value, P&L, and currency data.
      if (row.exchange && typeof row.exchange === 'string' && row.exchange.startsWith('IBKR')) {
        aggregated.push(row);
        continue;
      }

      // Group by asset
      const key = row.asset;
      if (!assetGroups.has(key)) {
        assetGroups.set(key, []);
      }
      assetGroups.get(key).push(row);
    }

    // Combine grouped positions
    for (const [asset, items] of assetGroups) {
      if (items.length === 1) {
        aggregated.push(items[0]);
      } else {
        const totalAmount = items.reduce((sum, p) => sum + (p.amount || 0), 0);
        const totalValue = items.reduce((sum, p) => sum + (p.value || 0), 0);
        const totalPnL = items.reduce((sum, p) => sum + (p.pnl || 0), 0);
        const weightedPrice = totalAmount !== 0 ? totalValue / Math.abs(totalAmount) : 0;
        const exchanges = [...new Set(items.map(p => p.exchange))];

        // Use the first non-null change24h value from any of the items
        const change24h = items.find(p => p.change24h !== null && p.change24h !== undefined)?.change24h || null;

        // Get priceHistory from first item that has it
        const priceHistory = items.find(p => p.priceHistory)?.priceHistory || null;

        // Use consistent exchange name for aggregated positions (for change detection)
        // If multiple exchanges, use the asset name itself as the exchange for stable keying
        const exchangeKey = exchanges.length > 1 ? asset : exchanges[0];

        aggregated.push({
          asset,
          exchange: exchanges.length > 1 ? 'Multiple' : exchanges[0],
          _changeDetectionKey: `${asset}_${exchangeKey}`, // Stable key for change detection
          amount: totalAmount,
          value: totalValue,
          price: weightedPrice,
          change24h,
          pnl: totalPnL,
          priceHistory,
          isAggregated: true
        });
      }
    }

    return aggregated;
  }

  calculateTotals(positions) {
    return calculatePortfolioTotals(positions);
  }
}

export default { IncrementalPortfolioRenderer };
