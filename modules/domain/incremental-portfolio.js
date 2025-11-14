/**
 * Incremental Portfolio Renderer
 * Streams positions as each provider responds (no blocking)
 */

export class IncrementalPortfolioRenderer {
  constructor({ providers, settings, containers, ui, expectedProviders = [] }) {
    this.providers = providers;
    this.settings = settings;
    this.containers = containers; // { positionsBody, mobileContainer, summaryEl }
    this.ui = ui; // { HeroUI, PositionsUI }
    
    // Accumulated state
    this.allPositions = [];
    this.providerStatus = new Map(); // track which providers finished
    this.renderDebounce = null;
    this.isLoading = true;
    this.expectedProviders = expectedProviders; // List of provider names we're waiting for
    
    // Store reference to renderer IMMEDIATELY for external re-renders
    window._portfolioRenderer = this;
    
    // Show loader in greeting
    this.showGreetingLoader();
    
    // Safety timeout: force hide loader after 10 seconds no matter what
    this.safetyTimeout = setTimeout(() => {
      if (this.isLoading) {
        console.warn('[Portfolio] Safety timeout reached, hiding loader');
        this.hideGreetingLoader();
      }
    }, 10000);
  }
  
  /**
   * Show mini loader in greeting while loading
   */
  showGreetingLoader() {
    const greeting = document.getElementById('newGreeting');
    if (!greeting) return;
    
    // ASCII spinner frames for smooth animation
    const frames = ['⢎⡰', '⢎⡡', '⢎⡑', '⢎⠱', '⠎⡱', '⢊⡱', '⢌⡱', '⢆⡱'];
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
    }, 100); // Update every 100ms for smooth rotation
    
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
    this.isLoading = false;
  }

  /**
   * Append new positions and re-render immediately
   */
  appendPositions(newRows, source) {
    if (!Array.isArray(newRows) || newRows.length === 0) {
      this.providerStatus.set(source, 'completed');
      this.checkIfAllProvidersFinished();
      return;
    }
    
    this.allPositions.push(...newRows);
    this.providerStatus.set(source, 'completed');
    
    // Check if all providers finished
    this.checkIfAllProvidersFinished();
    
    // Debounce renders to avoid thrashing (max 1 render per 100ms)
    clearTimeout(this.renderDebounce);
    this.renderDebounce = setTimeout(() => this.render(), 100);
  }

  /**
   * Mark provider as failed (render what we have so far)
   */
  markProviderFailed(source, error) {
    console.warn(`[${source}] Failed:`, error?.message || error);
    this.providerStatus.set(source, 'failed');
    this.checkIfAllProvidersFinished();
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
    }
  }

  /**
   * Re-render positions table and hero with current data
   */
  render() {
    const { PositionsUI, HeroUI } = this.ui;
    const { positionsBody, mobileContainer, summaryEl } = this.containers;
    
    if (this.allPositions.length === 0) {
      if (positionsBody) {
        positionsBody.innerHTML = '<tr><td colspan="8" class="loading">Fetching positions...</td></tr>';
      }
      if (summaryEl) {
        summaryEl.innerHTML = 'Loading portfolio...';
      }
      return;
    }

    // Aggregate and sort positions
    const aggregated = this.aggregatePositions(this.allPositions);
    const sorted = aggregated.sort((a, b) => (b.value || 0) - (a.value || 0));
    
    // Calculate portfolio totals
    const { totalValue, totalPnL, totalPnLPercent } = this.calculateTotals(sorted);
    
    // Filter for display (hide special positions + apply small balance filter)
    const hideSmallPositions = window.hideSmallPositions ?? true;
    const minThreshold = this.settings.minBalanceThreshold || 100;
    const hiddenAssets = window.hiddenAssets || new Set();
    
    const visible = sorted.filter(p => {
      // Hide special tracking positions
      if (p.isHlAccountEquity || p.isLighterAccountEquity) return false;
      
      // Hide manually hidden assets
      const assetKey = `${p.asset}_${p.exchange}`;
      if (hiddenAssets.has(assetKey)) return false;
      
      // Apply small balance filter if enabled
      if (hideSmallPositions) {
        const value = p.value || 0;
        if (value < minThreshold) return false;
      }
      
      return true;
    });
    
    // Render positions table
    if (PositionsUI && positionsBody) {
      PositionsUI.renderPositions({
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
            showPriceChart: this.settings.showPriceChart ?? true
          }
        }
      });
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
        useColoredPnL: this.settings.useColoredPnL ?? true,
        highlightsHtml: [],
        weather: null
      });
      summaryEl.innerHTML = heroHtml;
    }
    
    // Store in global cache for other functions
    window.cachedPositions = sorted;
    window.cachedSummaryData = { totalValue, totalPnL, totalPnLPercent };
    
    // Store reference to renderer for external re-renders
    window._portfolioRenderer = this;
  }
  
  /**
   * Force re-render with current data (for filter toggles)
   */
  forceRender() {
    this.render();
  }
  
  /**
   * Update positions with new data (e.g., from price updates)
   */
  updatePositions(newPositions) {
    if (Array.isArray(newPositions)) {
      this.allPositions = newPositions;
    }
    this.render();
  }

  /**
   * Aggregate duplicate assets
   */
  aggregatePositions(positions) {
    const aggregated = [];
    const assetGroups = new Map();
    
    for (const row of positions) {
      // Keep special positions separate
      if (row.isLeveraged || row.isHlAccountEquity || row.isLighterAccountEquity) {
        aggregated.push(row);
        continue;
      }
      
      // Keep Hyperliquid separate
      if (row.exchange === 'Hyperliquid' || row.exchange === 'Hyperliquid Spot') {
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

  /**
   * Calculate portfolio totals
   */
  calculateTotals(positions) {
    let totalValue = 0;
    let totalPnL = 0;
    
    const hlEquity = positions.find(p => p.isHlAccountEquity);
    const lighterEquity = positions.find(p => p.isLighterAccountEquity);
    
    if (hlEquity) {
      totalValue += (hlEquity.value || 0);
      totalPnL += (hlEquity.pnl || 0);
    }
    
    if (lighterEquity) {
      totalValue += (lighterEquity.value || 0);
      totalPnL += (lighterEquity.pnl || 0);
    }
    
    for (const p of positions) {
      if (p.isHlAccountEquity || p.isLighterAccountEquity) continue;
      if (p.exchange === 'Hyperliquid' || p.exchange === 'Hyperliquid Spot' || p.exchange === 'Lighter') continue;
      
      totalValue += (p.value || 0);
      if (p.pnl !== null && p.pnl !== undefined && !isNaN(p.pnl)) {
        totalPnL += p.pnl;
      }
    }
    
    const costBasis = totalValue - totalPnL;
    const totalPnLPercent = (costBasis > 0) ? (totalPnL / costBasis) * 100 : 0;
    
    return { totalValue, totalPnL, totalPnLPercent };
  }
}

export default { IncrementalPortfolioRenderer };

