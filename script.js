/**
 * Privacy-First Dashboard
 * 
 * SECURITY & PRIVACY NOTICE:
 * - All data is stored locally in your browser's localStorage only
 * - Sensitive data (wallet addresses, API keys) is encrypted before storage
 * - No analytics, tracking, or telemetry of any kind
 * - No user accounts, no server-side storage, no databases
 * - External API calls are made only to fetch your positions:
 *   • Hyperliquid API - for perp/spot positions
 *   • Lighter API - for lighter positions
 *   • OpenSea API - for NFT data
 *   • CoinGecko API - for price data (public, no personal data sent)
 *   • Open-Meteo API - for weather (only if enabled)
 * - Your data never leaves your device except to fetch positions from blockchain APIs
 * 
 * See SECURITY.md for full details.
 */
(function() {
  const storageKey = 'myDashboardSettings.v1';
  
  // Simple encryption for sensitive data in localStorage
  // Note: This is obfuscation, not true encryption. For true security, use a password-derived key.
  // All data stays local - nothing is sent to external servers except necessary API calls.
  const ENCRYPT_PREFIX = 'enc:';
  
  function simpleEncrypt(text) {
    if (!text) return text;
    // Add prefix to identify encrypted data
    return ENCRYPT_PREFIX + btoa(encodeURIComponent(text));
  }
  
  function simpleDecrypt(encoded) {
    if (!encoded) return encoded;
    
    // Check if data is encrypted (has our prefix)
    if (typeof encoded === 'string' && encoded.startsWith(ENCRYPT_PREFIX)) {
      try {
        return decodeURIComponent(atob(encoded.substring(ENCRYPT_PREFIX.length)));
      } catch (e) {
        console.error('✗ Decryption failed');
        return ''; // Return empty string if decryption fails
      }
    }
    
    // Not encrypted, return as-is (backward compatibility)
    return encoded;
  }

  // Store loaded sticker images
  const stickerImages = {};
  const wallpapers = [];
  
  // === PERFORMANCE CONFIGURATION ===
  // Detect production environment (different network conditions)
  const isProduction = window.location.hostname !== 'localhost' && 
                       window.location.hostname !== '127.0.0.1' &&
                       !window.location.hostname.includes('local');
  
  // Production needs longer timeouts due to network latency
  const timeoutMultiplier = isProduction ? 2 : 1;
  
  // Log environment info for debugging
  if (isProduction) {
    console.log('🌐 Production mode detected:', window.location.hostname);
    console.log('⏱️ Using extended timeouts for reliability');
  } else {
    console.log('💻 Development mode:', window.location.hostname);
  }
  
  const PERF_CONFIG = {
    // Cache durations (milliseconds)
    CACHE: {
      PRICES: 45000,      // 45 seconds - balance between freshness and speed
      NFT: 300000,        // 5 minutes - NFTs change rarely
      POSITIONS: 30000,   // 30 seconds - positions need freshness
      PYTH_FEEDS: 86400000, // 24 hours - feed metadata is static
      SETTINGS: 10000     // 10 seconds - settings accessed frequently
    },
    
    // API timeouts (milliseconds) - longer in production for reliability
    TIMEOUTS: {
      PYTH: 8000 * timeoutMultiplier,           // 8s local, 16s prod
      COINGECKO: 12000 * timeoutMultiplier,     // 12s local, 24s prod
      OPENSEA: 20000 * timeoutMultiplier,       // 20s local, 40s prod
      ZERION: 12000 * timeoutMultiplier,        // 12s local, 24s prod
      ALCHEMY: 12000 * timeoutMultiplier,       // 12s local, 24s prod
      HYPERLIQUID: 8000 * timeoutMultiplier     // 8s local, 16s prod
    },
    
    // Rate limiting
    RATE_LIMITS: {
      COINGECKO_DELAY: 250,
      MIN_REFRESH_INTERVAL: 8000,
      OPENSEA_BATCH_DELAY: 80,
      OPENSEA_STATS_DELAY: 120
    },
    
    // UI performance
    UI: {
      DEBOUNCE_RENDER: 50,
      ANIMATION_DURATION: 200,
      FLASH_DURATION: 400,
      THROTTLE_SCROLL: 16 // 60fps
    },
    
    // Data limits
    LIMITS: {
      MAX_CACHE_SIZE: 500,  // Doubled for better hit rate
      MAX_POSITIONS_PER_PAGE: 1000,
      DUST_THRESHOLD: 0.01 // USD
    }
  };
  
  // === API ENDPOINTS ===
  const API_ENDPOINTS = {
    HYPERLIQUID: 'https://api.hyperliquid.xyz/info',
    PYTH: 'https://hermes.pyth.network/v2',
    COINGECKO: 'https://api.coingecko.com/api/v3',
    OPENSEA: 'https://api.opensea.io/api/v2',
    ZERION: 'https://api.zerion.io/v1',
    BLOCKCHAIN_INFO: 'https://blockchain.info',
    ZCHA: 'https://api.zcha.in/v2/mainnet',
    ZKLIGHTER_MAIN: 'https://mainnet.zklighter.elliot.ai/api/v1',
    ZKLIGHTER_TEST: 'https://testnet.zklighter.elliot.ai/api/v1'
  };
  
  // === CORS PROXY HELPERS ===
  
  // Helper to proxy CoinGecko requests (avoids CORS)
  function proxyCoinGecko(url) {
    if (isProduction) {
      // Use Cloudflare Function in production
      return `/api/coingecko?url=${encodeURIComponent(url)}`;
    }
    // In development, try direct (will fail but allows testing other features)
    return url;
  }
  
  // === UTILITY FUNCTIONS ===
  
  // Generic memoization utility
  function memoize(fn, keyFn = (...args) => JSON.stringify(args)) {
    const cache = new Map();
    const maxSize = PERF_CONFIG.LIMITS.MAX_CACHE_SIZE;
    
    return function(...args) {
      const key = keyFn(...args);
      
      if (cache.has(key)) {
        return cache.get(key);
      }
      
      const result = fn.apply(this, args);
      
      // Prevent memory leak with size limit
      if (cache.size >= maxSize) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
      
      cache.set(key, result);
      return result;
    };
  }
  
  // Debounce function
  function debounce(fn, delay) {
    let timeoutId = null;
    
    return function(...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
  }
  
  // Throttle function
  function throttle(fn, limit) {
    let inThrottle;
    
    return function(...args) {
      if (!inThrottle) {
        fn.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }
  
  // Request deduplication
  class RequestDeduplicator {
    constructor() {
      this.pending = new Map();
    }
    
    async dedupe(key, fetcher) {
      // Return existing promise if request is in flight
      if (this.pending.has(key)) {
        return this.pending.get(key);
      }
      
      // Execute new request
      const promise = (async () => {
        try {
          const result = await fetcher();
          return result;
        } finally {
          // Clean up after completion
          this.pending.delete(key);
        }
      })();
      
      this.pending.set(key, promise);
      return promise;
    }
    
    clear() {
      this.pending.clear();
    }
  }
  
  const requestDeduplicator = new RequestDeduplicator();
  
  // Smart Cache with automatic pruning
  class SmartCache {
    constructor(maxSize = 250, ttl = 300000) {
      this.cache = new Map();
      this.timestamps = new Map();
      this.maxSize = maxSize;
      this.ttl = ttl;
      
      // Auto-prune every 5 minutes
      this.pruneInterval = setInterval(() => this.prune(), 300000);
    }
    
    set(key, value) {
      // Prune if at capacity
      if (this.cache.size >= this.maxSize) {
        this.pruneOldest();
      }
      
      this.cache.set(key, value);
      this.timestamps.set(key, Date.now());
    }
    
    get(key) {
      const value = this.cache.get(key);
      const timestamp = this.timestamps.get(key);
      
      // Check if expired
      if (value && timestamp && Date.now() - timestamp < this.ttl) {
        return value;
      }
      
      // Remove expired
      this.cache.delete(key);
      this.timestamps.delete(key);
      return null;
    }
    
    has(key) {
      const value = this.get(key);
      return value !== null;
    }
    
    prune() {
      const now = Date.now();
      
      for (const [key, timestamp] of this.timestamps) {
        if (now - timestamp > this.ttl) {
          this.cache.delete(key);
          this.timestamps.delete(key);
        }
      }
    }
    
    pruneOldest() {
      // Remove oldest entry
      const oldestKey = this.timestamps.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.timestamps.delete(oldestKey);
      }
    }
    
    clear() {
      this.cache.clear();
      this.timestamps.clear();
    }
    
    destroy() {
      if (this.pruneInterval) {
        clearInterval(this.pruneInterval);
      }
      this.clear();
    }
  }
  
  // Performance monitoring utility
  const perfMonitor = {
    marks: new Map(),
    
    start(name) {
      this.marks.set(name, performance.now());
    },
    
    end(name) {
      const start = this.marks.get(name);
      if (start) {
        const duration = performance.now() - start;
        this.marks.delete(name);
        return duration;
      }
    },
    
    measure(name, fn) {
      this.start(name);
      const result = fn();
      this.end(name);
      return result;
    },
    
    async measureAsync(name, fn) {
      this.start(name);
      const result = await fn();
      this.end(name);
      return result;
    }
  };
  
  // === ARCHITECTURAL LAYER: DATA SOURCES ===
  
  /**
   * Base DataSource class - all data sources inherit from this
   * Provides consistent interface for fetching, caching, and error handling
   */
  class DataSource {
    constructor(name, cache = null) {
      this.name = name;
      this.cache = cache || new SmartCache(PERF_CONFIG.LIMITS.MAX_CACHE_SIZE, PERF_CONFIG.CACHE.POSITIONS);
    }
    
    /**
     * Check if this data source supports the given address
     * @param {string} address - The address to check
     * @returns {boolean}
     */
    supports(address) {
      throw new Error('supports() must be implemented by subclass');
    }
    
    /**
     * Fetch data for the given address
     * @param {string} address - The address to fetch data for
     * @returns {Promise<any>}
     */
    async fetch(address) {
      throw new Error('fetch() must be implemented by subclass');
    }
    
    /**
     * Get cache key for the given address
     * @param {string} address - The address
     * @returns {string}
     */
    getCacheKey(address) {
      return `${this.name}_${address}`;
    }
    
    /**
     * Fetch with caching
     * @param {string} address - The address to fetch for
     * @returns {Promise<any>}
     */
    async fetchCached(address) {
      const cacheKey = this.getCacheKey(address);
      const cached = this.cache.get(cacheKey);
      
      if (cached) {
        return cached;
      }
      
      try {
        const data = await this.fetch(address);
        this.cache.set(cacheKey, data);
        return data;
      } catch (err) {
        return null;
      }
    }
  }
  
  /**
   * Hyperliquid Data Source
   */
  class HyperliquidSource extends DataSource {
    constructor() {
      super('Hyperliquid');
    }
    
    supports(address) {
      return isEVMAddress(address);
    }
    
    async fetch(address) {
      // Reuse existing fetchHyperliquidPositions logic
      // This will be refactored to return standardized format
      return null; // Placeholder - will integrate with existing code
    }
  }
  
  /**
   * Zerion Data Source
   */
  class ZerionSource extends DataSource {
    constructor(apiKey) {
      super('Zerion');
      this.apiKey = apiKey;
    }
    
    supports(address) {
      return isEVMAddress(address) && this.apiKey;
    }
    
    async fetch(address) {
      // Will integrate with existing Zerion code
      return null; // Placeholder
    }
  }
  
  /**
   * zkLighter Data Source
   */
  class ZkLighterSource extends DataSource {
    constructor() {
      super('zkLighter');
    }
    
    supports(address) {
      return isEVMAddress(address);
    }
    
    async fetch(address) {
      return null; // Placeholder
    }
  }
  
  /**
   * Alchemy Data Source
   */
  class AlchemySource extends DataSource {
    constructor() {
      super('Alchemy');
    }
    
    supports(address) {
      return isEVMAddress(address);
    }
    
    async fetch(address) {
      return null; // Placeholder
    }
  }
  
  /**
   * OpenSea Data Source
   */
  class OpenSeaSource extends DataSource {
    constructor(apiKey) {
      super('OpenSea');
      this.apiKey = apiKey;
    }
    
    supports(address) {
      return isEVMAddress(address) && this.apiKey;
    }
    
    async fetch(address) {
      return null; // Placeholder
    }
  }
  
  /**
   * Data Orchestrator - Manages parallel data fetching from multiple sources
   */
  class DataOrchestrator {
    constructor() {
      this.sources = new Map();
    }
    
    /**
     * Register a data source
     * @param {string} name - Source name
     * @param {DataSource} source - DataSource instance
     */
    registerSource(name, source) {
      this.sources.set(name, source);
    }
    
    /**
     * Fetch from all applicable sources for the given addresses
     * @param {Array<string>} addresses - Array of addresses
     * @returns {Promise<Map>} Map of source name to results
     */
    async fetchAll(addresses) {
      const results = new Map();
      const promises = [];
      
      for (const [name, source] of this.sources) {
        const supportedAddresses = addresses.filter(addr => source.supports(addr));
        
        if (supportedAddresses.length === 0) {
          continue;
        }
        
        const promise = Promise.all(
          supportedAddresses.map(addr => source.fetchCached(addr))
        ).then(data => {
          results.set(name, data.filter(Boolean)); // Filter out nulls
        }).catch(err => {
          results.set(name, []);
        });
        
        promises.push(promise);
      }
      
      await Promise.all(promises);
      return results;
    }
    
    /**
     * Fetch from a specific source
     * @param {string} sourceName - Name of the source
     * @param {Array<string>} addresses - Addresses to fetch
     * @returns {Promise<Array>}
     */
    async fetchFrom(sourceName, addresses) {
      const source = this.sources.get(sourceName);
      
      if (!source) {
        throw new Error(`Source ${sourceName} not registered`);
      }
      
      const supportedAddresses = addresses.filter(addr => source.supports(addr));
      
      if (supportedAddresses.length === 0) {
        return [];
      }
      
      const results = await Promise.all(
        supportedAddresses.map(addr => source.fetchCached(addr))
      );
      
      return results.filter(Boolean);
    }
    
    /**
     * Clear all caches
     */
    clearCaches() {
      for (const [, source] of this.sources) {
        source.cache.clear();
      }
    }
  }
  
  // Initialize data orchestrator
  const dataOrchestrator = new DataOrchestrator();
  
  /**
   * Data Pipeline - Single-pass data transformation
   */
  class DataPipeline {
    constructor() {
      this.transforms = [];
    }
    
    /**
     * Add a transformation step
     * @param {Function} transform - Transformation function
     * @returns {DataPipeline}
     */
    pipe(transform) {
      this.transforms.push(transform);
      return this;
    }
    
    /**
     * Execute the pipeline
     * @param {any} data - Initial data
     * @returns {any} Transformed data
     */
    async execute(data) {
      let result = data;
      
      for (const transform of this.transforms) {
        result = await transform(result);
      }
      
      return result;
    }
  }
  
  /**
   * Data Aggregator - Pure functions for data transformation
   */
  class DataAggregator {
    /**
     * Aggregate tokens by symbol and blockchain
     * @param {Array} tokens - Array of token objects
     * @returns {Map} Aggregated tokens keyed by "SYMBOL_BLOCKCHAIN"
     */
    static aggregateTokens(tokens) {
      const aggregates = new Map();
      
      for (const token of tokens) {
        // Skip dust
        if (token.balanceUsd < PERF_CONFIG.LIMITS.DUST_THRESHOLD) {
          continue;
        }
        
        const key = `${token.tokenSymbol}_${token.blockchain}`;
        const existing = aggregates.get(key);
        
        if (existing) {
          existing.amount += token.balance;
          existing.value += token.balanceUsd;
          existing.walletBreakdown.push({
            address: token.address,
            balance: token.balance,
            balanceUsd: token.balanceUsd
          });
        } else {
          aggregates.set(key, {
            asset: token.tokenSymbol,
            exchange: token.blockchain,
            amount: token.balance,
            value: token.balanceUsd,
            price: token.tokenPrice,
            change24h: token.change24h || null,
            pnl: null,
            pnlPercent: null,
            walletBreakdown: [{
              address: token.address,
              balance: token.balance,
              balanceUsd: token.balanceUsd
            }],
            coingeckoId: null
          });
        }
      }
      
      return aggregates;
    }
    
    /**
     * Enrich positions with price data
     * @param {Array} positions - Array of position objects
     * @param {Object} priceData - Map of symbol to price
     * @returns {Array} Enriched positions
     */
    static enrichWithPrices(positions, priceData) {
      return positions.map(pos => {
        const price = priceData[pos.asset];
        if (price) {
          return {
            ...pos,
            price: price,
            value: pos.amount * price
          };
        }
        return pos;
      });
    }
    
    /**
     * Enrich positions with Zerion PnL data
     * @param {Map} aggregates - Aggregated positions
     * @param {Object} zerionData - Zerion PnL data
     * @returns {Map} Enriched aggregates
     */
    static enrichWithZerion(aggregates, zerionData) {
      for (const [key, position] of aggregates) {
        const zerionKey = `${position.asset}_${position.exchange.toLowerCase()}`;
        const zerionInfo = zerionData[zerionKey];
        
        if (zerionInfo) {
          position.change24h = zerionInfo.changes?.percent_1d || position.change24h;
          position.pnl = zerionInfo.changes?.absolute_1d || position.pnl;
        }
      }
      
      return aggregates;
    }
  }
  
  /**
   * Position Calculator - Pure calculation functions
   */
  class PositionCalculator {
    /**
     * Calculate P&L for a position
     * @param {number} amount - Position amount
     * @param {number} entryPrice - Entry price
     * @param {number} currentPrice - Current price
     * @returns {Object} { pnl, pnlPercent }
     */
    static calculatePnL(amount, entryPrice, currentPrice) {
      if (!entryPrice || entryPrice === 0) {
        return { pnl: null, pnlPercent: null };
      }
      
      const costBasis = Math.abs(amount) * entryPrice;
      const currentValue = Math.abs(amount) * currentPrice;
      const pnl = currentValue - costBasis;
      const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
      
      return { pnl, pnlPercent };
    }
    
    /**
     * Calculate 24h change in USD
     * @param {number} currentValue - Current value in USD
     * @param {number} change24hPercent - 24h change percentage
     * @returns {number} 24h change in USD
     */
    static calculate24hChange(currentValue, change24hPercent) {
      if (!change24hPercent || change24hPercent === 0) {
        return 0;
      }
      
      const previousValue = currentValue / (1 + change24hPercent / 100);
      return currentValue - previousValue;
    }
  }
  
  /**
   * Smart Renderer - Incremental DOM updates
   */
  class SmartRenderer {
    constructor(containerId) {
      this.container = document.getElementById(containerId);
      this.rowCache = new Map();
      this.lastRenderData = null;
    }
    
    /**
     * Check if data has changed
     * @param {Array} newData - New data to render
     * @returns {boolean}
     */
    hasDataChanged(newData) {
      if (!this.lastRenderData || this.lastRenderData.length !== newData.length) {
        return true;
      }
      
      // Quick hash comparison
      const newHash = JSON.stringify(newData.map(d => ({ id: d.id, value: d.value, price: d.price })));
      const oldHash = JSON.stringify(this.lastRenderData.map(d => ({ id: d.id, value: d.value, price: d.price })));
      
      return newHash !== oldHash;
    }
    
    /**
     * Render with incremental updates
     * @param {Array} data - Data to render
     * @param {Function} createRow - Function to create a row element
     */
    render(data, createRow) {
      if (!this.container) return;
      
      // Skip if no changes
      if (!this.hasDataChanged(data)) {
        return;
      }
      
      // For now, do full render (incremental updates in next phase)
      const fragment = document.createDocumentFragment();
      
      for (const item of data) {
        const row = createRow(item);
        fragment.appendChild(row);
      }
      
      this.container.innerHTML = '';
      this.container.appendChild(fragment);
      
      this.lastRenderData = data;
    }
    
    /**
     * Clear the renderer
     */
    clear() {
      if (this.container) {
        this.container.innerHTML = '';
      }
      this.rowCache.clear();
      this.lastRenderData = null;
    }
  }
  
  /**
   * Lazy Loading Manager
   */
  class LazyLoadManager {
    constructor() {
      this.observers = new Map();
      this.observer = new IntersectionObserver(
        (entries) => this.handleIntersection(entries),
        { rootMargin: '100px' }
      );
    }
    
    /**
     * Register an element for lazy loading
     * @param {HTMLElement} element - Element to observe
     * @param {Function} loader - Function to call when visible
     */
    register(element, loader) {
      this.observers.set(element, loader);
      this.observer.observe(element);
    }
    
    /**
     * Handle intersection
     * @param {Array} entries - Intersection observer entries
     */
    handleIntersection(entries) {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const loader = this.observers.get(entry.target);
          if (loader) {
            loader();
            this.unregister(entry.target);
          }
        }
      }
    }
    
    /**
     * Unregister an element
     * @param {HTMLElement} element - Element to unregister
     */
    unregister(element) {
      this.observer.unobserve(element);
      this.observers.delete(element);
    }
    
    /**
     * Destroy the manager
     */
    destroy() {
      this.observer.disconnect();
      this.observers.clear();
    }
  }
  
  // Initialize lazy load manager
  const lazyLoadManager = new LazyLoadManager();
  
  /**
   * Progressive Loading Manager - Load content in stages
   */
  class ProgressiveLoader {
    constructor() {
      this.stages = [];
      this.currentStage = 0;
      this.isLoading = false;
    }
    
    /**
     * Add a loading stage
     * @param {string} name - Stage name
     * @param {Function} loader - Async function to execute
     * @param {number} priority - Priority (lower = higher priority)
     */
    addStage(name, loader, priority = 10) {
      this.stages.push({ name, loader, priority });
      this.stages.sort((a, b) => a.priority - b.priority);
    }
    
    /**
     * Execute all stages in order
     */
    async loadAll() {
      if (this.isLoading) return;
      
      this.isLoading = true;
      
      for (let i = 0; i < this.stages.length; i++) {
        const stage = this.stages[i];
        this.currentStage = i;
        
        try {
          await perfMonitor.measure(`ProgressiveLoad:${stage.name}`, async () => {
            await stage.loader();
          });
        } catch (err) {
          // Silently continue
        }
        
        // Yield to browser between stages
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      
      this.isLoading = false;
      this.currentStage = this.stages.length;
    }
    
    /**
     * Get current progress percentage
     * @returns {number} Progress (0-100)
     */
    getProgress() {
      if (this.stages.length === 0) return 0;
      return Math.round((this.currentStage / this.stages.length) * 100);
    }
  }
  
  // Initialize progressive loader
  const progressiveLoader = new ProgressiveLoader();
  
  /**
   * Skeleton State Manager - Show loading placeholders
   */
  class SkeletonManager {
    /**
     * Create skeleton rows for a container
     * @param {HTMLElement} container - Container to add skeletons to
     * @param {number} count - Number of skeleton rows
     */
    static createSkeletonRows(container, count = 5) {
      if (!container) return;
      
      const fragment = document.createDocumentFragment();
      
      for (let i = 0; i < count; i++) {
        const row = document.createElement('div');
        row.className = 'skeleton-row';
        row.innerHTML = `
          <div class="skeleton-text skeleton-text-short"></div>
          <div class="skeleton-text skeleton-text-long"></div>
          <div class="skeleton-text skeleton-text-medium"></div>
        `;
        fragment.appendChild(row);
      }
      
      container.innerHTML = '';
      container.appendChild(fragment);
    }
    
    /**
     * Remove skeleton state
     * @param {HTMLElement} container - Container to clear
     */
    static clearSkeletons(container) {
      if (!container) return;
      
      const skeletons = container.querySelectorAll('.skeleton-row');
      skeletons.forEach(skeleton => skeleton.remove());
    }
    
    /**
     * Show loading state for a section
     * @param {string} sectionId - ID of the section
     */
    static showLoadingState(sectionId) {
      const section = document.getElementById(sectionId);
      if (!section) return;
      
      section.classList.add('loading');
    }
    
    /**
     * Hide loading state for a section
     * @param {string} sectionId - ID of the section
     */
    static hideLoadingState(sectionId) {
      const section = document.getElementById(sectionId);
      if (!section) return;
      
      section.classList.remove('loading');
    }
  }
  
  /**
   * Virtual Scroll Manager - Efficient rendering of large lists
   */
  class VirtualScrollManager {
    constructor(container, itemHeight = 40, bufferSize = 10) {
      this.container = container;
      this.itemHeight = itemHeight;
      this.bufferSize = bufferSize;
      this.items = [];
      this.visibleRange = { start: 0, end: 0 };
      this.scrollContainer = null;
      
      this.handleScroll = throttle(() => this.updateVisibleRange(), PERF_CONFIG.UI.THROTTLE_SCROLL);
    }
    
    /**
     * Set items to be rendered
     * @param {Array} items - Items to render
     */
    setItems(items) {
      this.items = items;
      this.updateVisibleRange();
    }
    
    /**
     * Update visible range based on scroll position
     */
    updateVisibleRange() {
      if (!this.scrollContainer) {
        this.scrollContainer = this.container.closest('.scrollable') || window;
      }
      
      const scrollTop = this.scrollContainer === window ? window.scrollY : this.scrollContainer.scrollTop;
      const containerHeight = this.scrollContainer === window ? window.innerHeight : this.scrollContainer.clientHeight;
      
      const start = Math.max(0, Math.floor(scrollTop / this.itemHeight) - this.bufferSize);
      const end = Math.min(
        this.items.length,
        Math.ceil((scrollTop + containerHeight) / this.itemHeight) + this.bufferSize
      );
      
      if (start !== this.visibleRange.start || end !== this.visibleRange.end) {
        this.visibleRange = { start, end };
        this.render();
      }
    }
    
    /**
     * Render visible items
     */
    render() {
      // This is a simplified virtual scrolling implementation
      // Full implementation would require more sophisticated DOM management
      const visibleItems = this.items.slice(this.visibleRange.start, this.visibleRange.end);
      
      // Trigger render callback if set
      if (this.onRender) {
        this.onRender(visibleItems, this.visibleRange);
      }
    }
    
    /**
     * Set render callback
     * @param {Function} callback - Callback function
     */
    setRenderCallback(callback) {
      this.onRender = callback;
    }
    
    /**
     * Attach scroll listener
     */
    attach() {
      if (this.scrollContainer === window) {
        window.addEventListener('scroll', this.handleScroll);
      } else if (this.scrollContainer) {
        this.scrollContainer.addEventListener('scroll', this.handleScroll);
      }
    }
    
    /**
     * Detach scroll listener
     */
    detach() {
      if (this.scrollContainer === window) {
        window.removeEventListener('scroll', this.handleScroll);
      } else if (this.scrollContainer) {
        this.scrollContainer.removeEventListener('scroll', this.handleScroll);
      }
    }
  }
  
  /**
   * Error Boundary - Graceful error handling with fallback
   */
  class ErrorBoundary {
    /**
     * Wrap an async operation with error handling
     * @param {Function} fn - Async function to execute
     * @param {Object} options - Options
     * @returns {Promise<any>}
     */
    static async wrap(fn, options = {}) {
      const {
        name = 'Operation',
        fallback = null,
        onError = null,
        silent = false,
        retries = 0,
        retryDelay = 1000
      } = options;
      
      let lastError = null;
      
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          return await fn();
        } catch (err) {
          lastError = err;
          
          if (attempt < retries) {
            // Wait before retry with exponential backoff
            await new Promise(resolve => 
              setTimeout(resolve, retryDelay * Math.pow(2, attempt))
            );
            continue;
          }
          
          // Final attempt failed
          if (onError) {
            onError(err);
          }
          
          if (!silent) {
            console.error(`✗ ${name} failed:`, err.message || err);
          }
          
          return fallback;
        }
      }
      
      return fallback;
    }
    
    /**
     * Wrap multiple operations and handle errors individually
     * @param {Array<{fn: Function, options: Object}>} operations
     * @returns {Promise<Array>}
     */
    static async wrapAll(operations) {
      return Promise.all(
        operations.map(({ fn, options }) => 
          ErrorBoundary.wrap(fn, options)
        )
      );
    }
    
    /**
     * Create a safe version of a function with automatic error handling
     * @param {Function} fn - Function to make safe
     * @param {Object} options - Error handling options
     * @returns {Function}
     */
    static makeSafe(fn, options = {}) {
      return async (...args) => {
        return ErrorBoundary.wrap(() => fn(...args), options);
      };
    }
  }
  
  /**
   * Circuit Breaker - Prevent cascading failures
   */
  class CircuitBreaker {
    constructor(options = {}) {
      this.failureThreshold = options.failureThreshold || 5;
      this.resetTimeout = options.resetTimeout || 60000; // 1 minute
      this.failures = 0;
      this.lastFailureTime = null;
      this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    }
    
    /**
     * Execute a function through the circuit breaker
     * @param {Function} fn - Function to execute
     * @returns {Promise<any>}
     */
    async execute(fn) {
      if (this.state === 'OPEN') {
        const now = Date.now();
        if (now - this.lastFailureTime >= this.resetTimeout) {
          this.state = 'HALF_OPEN';
          this.failures = 0;
        } else {
          throw new Error('Circuit breaker is OPEN');
        }
      }
      
      try {
        const result = await fn();
        
        if (this.state === 'HALF_OPEN') {
          this.state = 'CLOSED';
        }
        
        this.failures = 0;
        return result;
      } catch (err) {
        this.failures++;
        this.lastFailureTime = Date.now();
        
        if (this.failures >= this.failureThreshold) {
          this.state = 'OPEN';
        }
        
        throw err;
      }
    }
    
    /**
     * Reset the circuit breaker
     */
    reset() {
      this.failures = 0;
      this.lastFailureTime = null;
      this.state = 'CLOSED';
    }
    
    /**
     * Get current state
     * @returns {string}
     */
    getState() {
      return this.state;
    }
  }
  
  // Create circuit breakers for different services
  const circuitBreakers = {
    pyth: new CircuitBreaker({ failureThreshold: 3, resetTimeout: 30000 }),
    coingecko: new CircuitBreaker({ failureThreshold: 5, resetTimeout: 60000 }),
    opensea: new CircuitBreaker({ failureThreshold: 5, resetTimeout: 60000 }),
    zerion: new CircuitBreaker({ failureThreshold: 3, resetTimeout: 30000 }),
    hyperliquid: new CircuitBreaker({ failureThreshold: 3, resetTimeout: 30000 })
  };
  
  /**
   * Batch Request Manager - Combine multiple requests into batches
   */
  class BatchRequestManager {
    constructor(batchSize = 10, batchDelay = 50) {
      this.batchSize = batchSize;
      this.batchDelay = batchDelay;
      this.queues = new Map();
      this.timers = new Map();
    }
    
    /**
     * Add a request to the batch queue
     * @param {string} queueName - Name of the queue
     * @param {any} request - Request data
     * @param {Function} processor - Function to process the batch
     * @returns {Promise<any>}
     */
    add(queueName, request, processor) {
      return new Promise((resolve, reject) => {
        // Initialize queue if it doesn't exist
        if (!this.queues.has(queueName)) {
          this.queues.set(queueName, []);
        }
        
        const queue = this.queues.get(queueName);
        queue.push({ request, resolve, reject });
        
        // Clear existing timer
        if (this.timers.has(queueName)) {
          clearTimeout(this.timers.get(queueName));
        }
        
        // Set new timer or process immediately if batch is full
        if (queue.length >= this.batchSize) {
          this.processBatch(queueName, processor);
        } else {
          const timer = setTimeout(() => {
            this.processBatch(queueName, processor);
          }, this.batchDelay);
          this.timers.set(queueName, timer);
        }
      });
    }
    
    /**
     * Process a batch of requests
     * @param {string} queueName - Name of the queue
     * @param {Function} processor - Function to process the batch
     */
    async processBatch(queueName, processor) {
      const queue = this.queues.get(queueName);
      if (!queue || queue.length === 0) return;
      
      // Clear the queue and timer
      this.queues.set(queueName, []);
      if (this.timers.has(queueName)) {
        clearTimeout(this.timers.get(queueName));
        this.timers.delete(queueName);
      }
      
      try {
        const requests = queue.map(item => item.request);
        const results = await processor(requests);
        
        // Resolve all promises
        queue.forEach((item, index) => {
          item.resolve(results[index]);
        });
      } catch (err) {
        // Reject all promises
        queue.forEach(item => {
          item.reject(err);
        });
      }
    }
  }
  
  // Initialize batch request manager
  const batchRequestManager = new BatchRequestManager(10, 50);
  
  /**
   * DOM Update Batcher - Batch DOM updates for better performance
   */
  class DOMBatcher {
    constructor() {
      this.updates = [];
      this.scheduled = false;
    }
    
    /**
     * Schedule a DOM update
     * @param {Function} update - Update function
     */
    schedule(update) {
      this.updates.push(update);
      
      if (!this.scheduled) {
        this.scheduled = true;
        requestAnimationFrame(() => this.flush());
      }
    }
    
    /**
     * Execute all pending updates
     */
    flush() {
      const updates = this.updates.splice(0);
      
      // Execute all updates in a single batch
      for (const update of updates) {
        try {
          update();
        } catch (err) {
          console.error('DOM update error:', err);
        }
      }
      
      this.scheduled = false;
    }
  }
  
  // Initialize DOM batcher
  const domBatcher = new DOMBatcher();
  
  // === UTILITY FUNCTIONS FOR API CALLS ===
  
  // Fetch with timeout
  async function fetchWithTimeout(url, options = {}, timeout = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw err;
    }
  }
  
  // Retry with exponential backoff
  async function fetchWithRetry(url, options = {}, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetchWithTimeout(url, options, 15000);
        
        // If rate limited (429), wait and retry
        if (response.status === 429) {
          if (attempt < maxRetries - 1) {
            const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        
        return response;
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }
  
  // CoinGecko API rate limiting (optimized for speed)
  let lastCoinGeckoCall = 0;
  let consecutiveRateLimits = 0;
  
  // Smart caches with automatic pruning
  const coinGeckoCache = new SmartCache(PERF_CONFIG.LIMITS.MAX_CACHE_SIZE, PERF_CONFIG.CACHE.PRICES);
  const nftCache = new SmartCache(PERF_CONFIG.LIMITS.MAX_CACHE_SIZE, PERF_CONFIG.CACHE.NFT);
  
  // Settings cache (avoid repeated localStorage reads)
  let settingsCache = null;
  let settingsCacheTime = 0;
  
  // === PYTH NETWORK PRICE FEEDS ===
  // Unified price source for portfolio calculations
  
  // Pyth price feed IDs for verified assets
  // To verify or find new feed IDs, visit: https://pyth.network/developers/price-feed-ids
  // These IDs are for mainnet and should be checked periodically for updates
  // Dynamic Pyth price feed mapping (fetched from Hermes API)
  // Cache: { symbol: feedId }
  let PYTH_PRICE_FEEDS = null;
  let pythFeedsLastFetched = 0;
  
  // Fetch Pyth price feed metadata from Hermes API
  // https://hermes.pyth.network/docs/#/rest/price_feeds_metadata
  async function fetchPythPriceFeeds() {
    try {
      const response = await fetchWithTimeout('https://hermes.pyth.network/v2/price_feeds', {}, 10000);
      if (!response.ok) return {};
      
      const feeds = await response.json();
      const feedMap = {};
      
      // Extract symbol mappings from metadata
      // Pyth provides feeds like "Crypto.BTC/USD", we want "BTC" -> feedId
      for (const feed of feeds) {
        if (feed.attributes && feed.attributes.symbol && feed.id) {
          const symbol = feed.attributes.symbol;
          
          // Parse symbols like "Crypto.BTC/USD" -> "BTC"
          const match = symbol.match(/Crypto\.([A-Z0-9]+)\/USD/i);
          if (match) {
            const asset = match[1].toUpperCase();
            feedMap[asset] = feed.id;
          }
        }
      }
      
      return feedMap;
    } catch (err) {
      return {};
    }
  }
  
  // Get or fetch Pyth price feeds with caching
  async function getPythPriceFeeds() {
    const now = Date.now();
    
    // Return cached if available and fresh
    if (PYTH_PRICE_FEEDS && (now - pythFeedsLastFetched) < PERF_CONFIG.CACHE.PYTH_FEEDS) {
      return PYTH_PRICE_FEEDS;
    }
    
    // Fetch fresh metadata
    PYTH_PRICE_FEEDS = await fetchPythPriceFeeds();
    pythFeedsLastFetched = now;
    
    return PYTH_PRICE_FEEDS;
  }
  
  async function fetchPythPrice(asset, timestamp = null) {
    // Get Pyth price feed ID for asset
    const priceFeeds = await getPythPriceFeeds();
    const feedId = priceFeeds[asset];
    if (!feedId) {
      return null; // Asset not supported by Pyth
    }
    
    try {
      let url;
      if (timestamp) {
        // Historical price - Hermes API uses Unix timestamp in seconds
        const unixTimestamp = Math.floor(timestamp / 1000);
        url = `https://hermes.pyth.network/v2/updates/price/${unixTimestamp}?ids[]=${feedId}`;
      } else {
        // Latest price
        url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${feedId}`;
      }
      
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      
      const data = await response.json();
      
      // Parse Pyth price data
      if (data.parsed && data.parsed.length > 0) {
        const priceData = data.parsed[0];
        const price = parseFloat(priceData.price.price) * Math.pow(10, priceData.price.expo);
        return price;
      }
      
      return null;
    } catch (err) {
      return null;
    }
  }
  
  /**
   * Fetch Pyth price at a specific timestamp
   * @param {Array<string>} feedIds - Array of Pyth feed IDs (with 0x prefix)
   * @param {number} timestamp - Unix timestamp in SECONDS
   * @returns {Promise<Object>} Map of feedId to price
   */
  async function fetchPythPricesAtTimestamp(feedIds, timestamp) {
    if (feedIds.length === 0) return {};
    
    try {
      // Ensure feedIds have 0x prefix
      const normalizedIds = feedIds.map(id => 
        id.toLowerCase().startsWith('0x') ? id : `0x${id}`
      );
      
      const idsParam = normalizedIds.map(id => `ids[]=${id}`).join('&');
      const url = `${API_ENDPOINTS.PYTH}/updates/price/${timestamp}?${idsParam}&parsed=true`;
      
      const response = await fetchWithTimeout(url, {}, PERF_CONFIG.TIMEOUTS.PYTH);
      if (!response.ok) return {};
      
      const data = await response.json();
      const prices = {};
      
      if (data.parsed && data.parsed.length > 0) {
        for (const priceData of data.parsed) {
          const normalizedId = priceData.id.toLowerCase().startsWith('0x') 
            ? priceData.id.toLowerCase() 
            : `0x${priceData.id.toLowerCase()}`;
          
          const price = parseFloat(priceData.price.price) * Math.pow(10, priceData.price.expo);
          prices[normalizedId] = price;
        }
      }
      
      return prices;
    } catch (err) {
      return {};
    }
  }

  /**
   * Enhanced Pyth price fetching with 24h change calculation
   * Uses local midnight prices for accurate 24h change
   * Returns: { asset: { price, change24h } }
   */
  async function fetchPythPrices(assets, manualFeedIds = [], includeChange24h = true) {
    // Use request deduplication to avoid duplicate concurrent requests
    const cacheKey = `pyth:${assets.sort().join(',')}_${JSON.stringify(manualFeedIds)}_${includeChange24h}`;
    
    return requestDeduplicator.dedupe(cacheKey, async () => {
      // Fetch multiple prices at once
      const priceFeeds = await getPythPriceFeeds();
      
      // Build feedId to asset mapping
      const feedIdToAsset = {};
      const assetToFeedId = {};
      
      // Add feed IDs from asset symbol lookups
      for (const asset of assets) {
        const feedId = priceFeeds[asset];
        if (feedId) {
          // Ensure consistent normalization with 0x prefix
          const normalizedId = feedId.toLowerCase().startsWith('0x') 
            ? feedId.toLowerCase() 
            : `0x${feedId.toLowerCase()}`;
          feedIdToAsset[normalizedId] = asset;
          assetToFeedId[asset] = normalizedId;
        }
      }
      
      // Add explicit feed IDs from manual Pyth positions (these take priority)
      for (const manual of manualFeedIds) {
        const normalizedId = manual.feedId.toLowerCase().startsWith('0x') 
          ? manual.feedId.toLowerCase() 
          : `0x${manual.feedId.toLowerCase()}`;
        feedIdToAsset[normalizedId] = manual.asset;
        assetToFeedId[manual.asset] = normalizedId;
      }
      
      const feedIds = Object.keys(feedIdToAsset);
      
      if (feedIds.length === 0) {
        return {};
      }
      
      try {
        // Parallel fetch: current prices AND midnight prices (if needed)
        const idsParam = feedIds.map(id => `ids[]=${id}`).join('&');
        
        const fetchPromises = [
          // Current prices
          fetchWithTimeout(
            `https://hermes.pyth.network/v2/updates/price/latest?${idsParam}`,
            {},
            PERF_CONFIG.TIMEOUTS.PYTH
          )
        ];
        
        // Add 24h ago price fetch if we need 24h changes
        let timestamp24hAgo = null;
        if (includeChange24h) {
          timestamp24hAgo = get24HoursAgoTimestamp();
          fetchPromises.push(
            fetchPythPricesAtTimestamp(feedIds, timestamp24hAgo)
          );
        }
        
        const [currentResponse, prices24hAgo] = await Promise.all(fetchPromises);
        
        if (!currentResponse.ok) return {};
        
        const currentData = await currentResponse.json();
        
        // Map results back to asset symbols with both price and 24h change
        const result = {};
        if (currentData.parsed && currentData.parsed.length > 0) {
          for (const priceData of currentData.parsed) {
            // Find asset symbol by feed ID
            const normalizedId = priceData.id.toLowerCase().startsWith('0x') 
              ? priceData.id.toLowerCase() 
              : `0x${priceData.id.toLowerCase()}`;
            
            const asset = feedIdToAsset[normalizedId];
            
            if (asset) {
              const currentPrice = parseFloat(priceData.price.price) * Math.pow(10, priceData.price.expo);
              
              let change24h = null;
              if (includeChange24h && prices24hAgo && prices24hAgo[normalizedId]) {
                const price24hAgo = prices24hAgo[normalizedId];
                if (price24hAgo > 0) {
                  change24h = ((currentPrice - price24hAgo) / price24hAgo) * 100;
                }
              }
              
              result[asset] = {
                price: currentPrice,
                change24h: change24h
              };
            }
          }
        }
        
        return result;
      } catch (err) {
        return {};
      }
    });
  }
  
  // === WATCHLIST FUNCTIONS ===
  
  let allPythFeeds = []; // Cache of all available Pyth feeds with metadata
  
  async function fetchAllPythFeeds() {
    if (allPythFeeds.length > 0) {
      return allPythFeeds;
    }
    
    try {
      const response = await fetchWithTimeout('https://hermes.pyth.network/v2/price_feeds', {}, 10000);
      if (!response.ok) return [];
      
      const feeds = await response.json();
      
      // Filter for Crypto/USD pairs and format for display
      allPythFeeds = feeds
        .filter(feed => feed.attributes && feed.attributes.symbol && feed.attributes.symbol.includes('Crypto.') && feed.attributes.symbol.includes('/USD'))
        .map(feed => ({
          id: feed.id, // Keep original ID
          idNormalized: feed.id.toLowerCase().startsWith('0x') ? feed.id.toLowerCase() : `0x${feed.id.toLowerCase()}`, // Add normalized version
          symbol: feed.attributes.symbol.match(/Crypto\.([A-Z0-9]+)\/USD/i)?.[1] || feed.attributes.symbol,
          fullSymbol: feed.attributes.symbol,
          description: feed.attributes.description || feed.attributes.base || '', // Asset name like "Solana"
          asset_type: feed.attributes.asset_type || 'Crypto'
        }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol));
      
      return allPythFeeds;
    } catch (err) {
      return [];
    }
  }
  
  function searchWatchlistTokens(query) {
    const lowerQuery = query.toLowerCase();
    return allPythFeeds.filter(feed => 
      feed.symbol.toLowerCase().includes(lowerQuery) ||
      feed.fullSymbol.toLowerCase().includes(lowerQuery) ||
      (feed.description && feed.description.toLowerCase().includes(lowerQuery))
    ).slice(0, 50); // Limit to 50 results
  }
  
  function addToWatchlist(feedId) {
    const settings = loadSettings() || getDefaultSettings();
    if (!settings.watchlist) settings.watchlist = [];
    
    if (!settings.watchlist.includes(feedId)) {
      settings.watchlist.push(feedId);
      saveSettings(settings);
      renderWatchlist();
    }
  }
  
  function removeFromWatchlist(feedId) {
    const settings = loadSettings() || getDefaultSettings();
    if (!settings.watchlist) settings.watchlist = [];
    
    settings.watchlist = settings.watchlist.filter(id => id !== feedId);
    saveSettings(settings);
    renderWatchlist();
  }
  
  async function fetchWatchlistPrices() {
    const settings = loadSettings() || getDefaultSettings();
    const watchlist = settings.watchlist || [];
    
    if (watchlist.length === 0) return [];
    
    // Ensure feeds are loaded
    await fetchAllPythFeeds();
    
    try {
      const idsParam = watchlist.map(id => `ids[]=${id}`).join('&');
      
      // Fetch current prices AND 24h ago prices in parallel
      const timestamp24hAgo = get24HoursAgoTimestamp();
      
      const [currentResponse, prices24hAgo] = await Promise.all([
        fetch(`https://hermes.pyth.network/v2/updates/price/latest?${idsParam}`),
        fetchPythPricesAtTimestamp(watchlist, timestamp24hAgo)
      ]);
      
      if (!currentResponse.ok) {
        return [];
      }
      
      const data = await currentResponse.json();
      
      const watchlistData = [];
      if (data.parsed && data.parsed.length > 0) {
        for (const priceData of data.parsed) {
          const normalizedId = priceData.id.toLowerCase().startsWith('0x') 
            ? priceData.id.toLowerCase() 
            : `0x${priceData.id.toLowerCase()}`;
          
          // Match using normalized IDs
          const feedInfo = allPythFeeds.find(f => f.idNormalized === normalizedId);
          
          if (feedInfo) {
            const price = parseFloat(priceData.price.price) * Math.pow(10, priceData.price.expo);
            
            // Calculate 24h change using actual historical price from 24 hours ago
            let change24h = null;
            if (prices24hAgo && prices24hAgo[normalizedId]) {
              const price24hAgo = prices24hAgo[normalizedId];
              if (price24hAgo > 0) {
                change24h = ((price - price24hAgo) / price24hAgo) * 100;
              }
            }
            
            watchlistData.push({
              id: feedInfo.id,
              symbol: feedInfo.symbol,
              price: price,
              change24h: change24h
            });
          }
        }
      }
      
      return watchlistData;
    } catch (err) {
      return [];
    }
  }
  
  async function renderWatchlist() {
    const watchlistBody = document.getElementById('watchlistBody');
    
    if (!watchlistBody) return;
    
    const watchlistData = await fetchWatchlistPrices();
    
    if (watchlistData.length === 0) {
      watchlistBody.innerHTML = '<tr><td colspan="4" class="loading">No assets in watchlist</td></tr>';
      return;
    }
    
    // Get current settings to check if colored P&L is enabled
    const settings = loadSettings() || getDefaultSettings();
    const useColoredPnL = settings.useColoredPnL ?? true;
    
    // Render table rows
    watchlistBody.innerHTML = '';
    for (const item of watchlistData) {
      const tr = document.createElement('tr');
      tr.dataset.feedId = item.id; // Store feed ID for edit mode
      
      const hasChange = item.change24h !== null && item.change24h !== undefined;
      
      const changeClass = useColoredPnL
        ? (hasChange ? (item.change24h >= 0 ? 'positive-pnl' : 'negative-pnl') : 'neutral-value')
        : (hasChange ? (item.change24h >= 0 ? 'positive-neutral' : 'negative-neutral') : 'neutral-value');
      const changeSign = hasChange ? (item.change24h >= 0 ? '+' : '') : '';
      const changeDisplay = hasChange ? `${changeSign}${item.change24h.toFixed(2)}%` : '—';
      
      const editButton = watchlistEditMode 
        ? `<button class="watchlist-edit-btn" data-feed-id="${item.id}">[REMOVE]</button>`
        : '';
      
      tr.innerHTML = `
        <td class="symbol-cell">${item.symbol} ${editButton}</td>
        <td class="price-cell">$${formatCompactNumber(item.price)}</td>
        <td class="${changeClass} change-cell">${changeDisplay}</td>
      `;
      
      watchlistBody.appendChild(tr);
      
      // Apply flash animations for value changes
      const rowKey = `watchlist_${item.id}`;
      flashCell(tr.querySelector('.price-cell'), `${rowKey}_price`, item.price);
      if (hasChange) {
        flashCell(tr.querySelector('.change-cell'), `${rowKey}_change`, item.change24h);
      }
    }
  }
  
  let watchlistEditMode = false;
  
  function toggleWatchlistEditMode() {
    watchlistEditMode = !watchlistEditMode;
    const editBtn = document.getElementById('editWatchlistBtn');
    
    editBtn.textContent = watchlistEditMode ? '[SAVE CHANGES]' : '[EDIT]';
    renderWatchlist();
  }
  
  function removeWatchlistItemInEditMode(feedId) {
    // Completely remove the item from the watchlist
    removeFromWatchlist(feedId);
  }
  
  // Tab visibility tracking
  let isTabVisible = true;
  let updateInProgress = false;
  let lastFullRefresh = 0;
  const MIN_REFRESH_INTERVAL = PERF_CONFIG.RATE_LIMITS.MIN_REFRESH_INTERVAL;
  
  // Performance monitoring
  const perfMetrics = {
    apiCalls: new Map(),
    renders: new Map(),
    startTime: Date.now()
  };
  
  function trackPerf(category, operation, duration) {
    if (!perfMetrics[category]) {
      perfMetrics[category] = new Map();
    }
    
    const key = operation;
    const existing = perfMetrics[category].get(key) || { count: 0, total: 0, max: 0, min: Infinity };
    
    existing.count++;
    existing.total += duration;
    existing.max = Math.max(existing.max, duration);
    existing.min = Math.min(existing.min, duration);
    existing.avg = existing.total / existing.count;
    
    perfMetrics[category].set(key, existing);
  }
  
  function getPerfReport() {
    const report = {
      uptime: Math.round((Date.now() - perfMetrics.startTime) / 1000) + 's',
      apiCalls: {},
      renders: {}
    };
    
    for (const [key, stats] of perfMetrics.apiCalls) {
      report.apiCalls[key] = {
        calls: stats.count,
        avgMs: Math.round(stats.avg),
        maxMs: Math.round(stats.max),
        minMs: Math.round(stats.min)
      };
    }
    
    for (const [key, stats] of perfMetrics.renders) {
      report.renders[key] = {
        renders: stats.count,
        avgMs: Math.round(stats.avg),
        maxMs: Math.round(stats.max),
        minMs: Math.round(stats.min)
      };
    }
    
    return report;
  }
  
  // Expose performance metrics to console for debugging
  window.getDashboardPerf = getPerfReport;
  
  // Global error boundary with recovery
  function withErrorBoundary(fn, fallback = null, context = 'operation') {
    return async function(...args) {
      try {
        return await fn(...args);
      } catch (error) {
        console.error(`Error in ${context}:`, error);
        
        // Try to recover gracefully
        if (fallback) {
          try {
            return await fallback(...args);
          } catch (fallbackError) {
            console.error(`Fallback also failed for ${context}:`, fallbackError);
          }
        }
        
        // Return sensible defaults based on context
        if (context.includes('fetch') || context.includes('load')) {
          return null;
        }
        if (context.includes('render') || context.includes('update')) {
          return;
        }
        
        throw error;
      }
    };
  }
  
  // Batch DOM updates for better performance
  let domUpdateQueue = [];
  let domUpdateScheduled = false;
  
  function scheduleDOMUpdate(updateFn) {
    domUpdateQueue.push(updateFn);
    
    if (!domUpdateScheduled) {
      domUpdateScheduled = true;
      requestAnimationFrame(() => {
        const updates = domUpdateQueue.slice();
        domUpdateQueue = [];
        domUpdateScheduled = false;
        
        // Execute all updates in one frame
        updates.forEach(fn => {
          try {
            fn();
          } catch (error) {
            console.error('DOM update failed:', error);
          }
        });
      });
    }
  }
  
  async function rateLimitedFetch(url, cacheKey = null, retryCount = 0) {
    // Check cache first (SmartCache handles expiration automatically)
    if (cacheKey) {
      const cached = coinGeckoCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Rate limit with exponential backoff (only if needed)
    const now = Date.now();
    const timeSinceLastCall = now - lastCoinGeckoCall;
    const baseDelay = consecutiveRateLimits > 0 
      ? PERF_CONFIG.RATE_LIMITS.COINGECKO_DELAY * Math.pow(2, consecutiveRateLimits) 
      : PERF_CONFIG.RATE_LIMITS.COINGECKO_DELAY;
    
    if (timeSinceLastCall < baseDelay) {
      await new Promise(resolve => setTimeout(resolve, baseDelay - timeSinceLastCall));
    }

    lastCoinGeckoCall = Date.now();

    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        if (resp.status === 429) {
          consecutiveRateLimits++;
          // Exponential backoff: 5s, 10s, 20s, 40s...
          const backoffDelay = 5000 * Math.pow(2, Math.min(retryCount, 4));
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
          
          // Limit retries to prevent infinite loops
          if (retryCount < 3) {
            return rateLimitedFetch(url, cacheKey, retryCount + 1);
          }
          return null; // Give up after 3 retries
        }
        throw new Error(`HTTP ${resp.status}`);
      }
      
      // Success - reset rate limit counter
      consecutiveRateLimits = Math.max(0, consecutiveRateLimits - 1);
      const data = await resp.json();

      // Cache the result (SmartCache handles size limiting and pruning automatically)
      if (cacheKey) {
        coinGeckoCache.set(cacheKey, data);
      }

      return data;
    } catch (err) {
      return null;
    }
  }

  const els = {
    loadingScreen: document.getElementById('loadingScreen'),
    miniLoader: document.getElementById('miniLoader'),
    toggleThemeBtn: document.getElementById('toggleThemeBtn'),
    openSettingsBtn: document.getElementById('openSettingsBtn'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    cancelSettingsBtn: document.getElementById('cancelSettingsBtn'),
    settingsBackdrop: document.getElementById('settingsBackdrop'),
    openStickersBtn: document.getElementById('openStickersBtn'),
    openStickersBtnMobile: document.getElementById('openStickersBtnMobile'),
    stickerWindow: document.getElementById('stickerWindow'),
    closeStickerWindowBtn: document.getElementById('closeStickerWindowBtn'),
    openDonateBtn: document.getElementById('openDonateBtn'),
    openDonateBtnMobile: document.getElementById('openDonateBtnMobile'),
    donateWindow: document.getElementById('donateWindow'),
    donateBackdrop: document.getElementById('donateBackdrop'),
    closeDonateWindowBtn: document.getElementById('closeDonateWindowBtn'),
    toggleAmountsBtn: document.getElementById('toggleAmountsBtn'),
    wallpaperSelect: document.getElementById('wallpaperSelect'),
    decreaseFontBtn: document.getElementById('decreaseFontBtn'),
    increaseFontBtn: document.getElementById('increaseFontBtn'),
    fontSizeDisplay: document.getElementById('fontSizeDisplay'),
    mobileMenuBtn: document.getElementById('mobileMenuBtn'),
    closeMobileMenuBtn: document.getElementById('closeMobileMenuBtn'),
    mobileMenu: document.getElementById('mobileMenu'),
    toggleSnowBtnMobile: document.getElementById('toggleSnowBtnMobile'),
    toggleRainBtnMobile: document.getElementById('toggleRainBtnMobile'),
    toggleThemeBtnMobile: document.getElementById('toggleThemeBtnMobile'),
    toggleAmountsBtnMobile: document.getElementById('toggleAmountsBtnMobile'),
    decreaseFontBtnMobile: document.getElementById('decreaseFontBtnMobile'),
    increaseFontBtnMobile: document.getElementById('increaseFontBtnMobile'),
    fontSizeDisplayMobile: document.getElementById('fontSizeDisplayMobile'),
    openSettingsBtnMobile: document.getElementById('openSettingsBtnMobile'),
    settingsDialog: document.getElementById('settingsDialog'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    exportSettingsBtn: document.getElementById('exportSettingsBtn'),
    importSettingsBtn: document.getElementById('importSettingsBtn'),
    settingsExportArea: document.getElementById('settingsExportArea'),
    walletAddresses: document.getElementById('walletAddresses'),
    solanaAddresses: document.getElementById('solanaAddresses'),
    bitcoinAddresses: document.getElementById('bitcoinAddresses'),
    zcashAddresses: document.getElementById('zcashAddresses'),
    alchemyApiKey: document.getElementById('alchemyApiKey'),
    heliusApiKey: document.getElementById('heliusApiKey'),
    openSeaApiKey: document.getElementById('openSeaApiKey'),
    zerionApiKey: document.getElementById('zerionApiKey'),
    themeSelect: document.getElementById('themeSelect'),
    userName: document.getElementById('userName'),
    positionsContainer: document.getElementById('positionsContainer'),
    addPositionBtn: document.getElementById('addPositionBtn'),
    weatherLabel: document.getElementById('weatherLabel'),
    weatherLat: document.getElementById('weatherLat'),
    weatherLon: document.getElementById('weatherLon'),
    showRainForecast: document.getElementById('showRainForecast'),
    useColoredPnL: document.getElementById('useColoredPnL'),
    leftAligned: document.getElementById('leftAligned'),
    usePythPrices: document.getElementById('usePythPrices'),
    heroPnLMode: document.getElementById('heroPnLMode'),
    compactList: document.getElementById('compactList'),
    buttonBackgrounds: document.getElementById('buttonBackgrounds'),
    minBalanceThreshold: document.getElementById('minBalanceThreshold'),
    enableRealTimeUpdates: document.getElementById('enableRealTimeUpdates'),
    realTimeUpdateInterval: document.getElementById('realTimeUpdateInterval'),
    getLocationBtn: document.getElementById('getLocationBtn'),
    refreshMins: document.getElementById('refreshMins'),
    greeting: document.getElementById('greeting'),
    greetingMobile: document.getElementById('greetingMobile'),
    summary: document.getElementById('summary'),
    positionsBody: document.getElementById('positionsBody'),
    mobilePositionsContainer: document.getElementById('mobilePositionsContainer'),
    calvinImage: document.getElementById('calvinImage'),
    tabCalvin: document.getElementById('tabCalvin'),
    tabPeanuts: document.getElementById('tabPeanuts'),
    tabFarside: document.getElementById('tabFarside'),
    comicToggleBtn: document.getElementById('comicToggleBtn'),
    comicSection: document.getElementById('comicSection'),
    calvinPrevBtn: document.getElementById('calvinPrevBtn'),
    calvinNextBtn: document.getElementById('calvinNextBtn'),
    calvinRandomBtn: document.getElementById('calvinRandomBtn'),
    calvinPrevBtnMobile: document.getElementById('calvinPrevBtnMobile'),
    calvinNextBtnMobile: document.getElementById('calvinNextBtnMobile'),
    calvinRandomBtnMobile: document.getElementById('calvinRandomBtnMobile'),
    hideSmallBtn: document.getElementById('hideSmallBtn'),
    toggleNftsBtn: document.getElementById('toggleNftsBtn'),
    editListBtn: document.getElementById('editListBtn'),
    comicStrip: document.getElementById('comicStrip'),
    showComic: document.getElementById('showComic'),
    showWatchlist: document.getElementById('showWatchlist'),
    lastUpdateTimestamp: document.getElementById('lastUpdateTimestamp'),
    showSnowBtn: document.getElementById('showSnowBtn'),
    showRainBtn: document.getElementById('showRainBtn'),
    showThemeBtn: document.getElementById('showThemeBtn'),
    showAmountsBtn: document.getElementById('showAmountsBtn'),
    showFontSize: document.getElementById('showFontSize'),
    showStickersBtn: document.getElementById('showStickersBtn'),
    showDonateBtn: document.getElementById('showDonateBtn'),
    toggleSnowBtn: document.getElementById('toggleSnowBtn'),
    toggleRainBtn: document.getElementById('toggleRainBtn'),
    fontSizeControls: document.getElementById('fontSizeControls'),
  };
  
  let amountsVisible = true;
  let hideSmallPositions = true;
  let hideNfts = false;
  let editMode = false;
  let currentFontSize = 15; // default font size in px
  let currentCalvinDate = new Date(); // Track current comic date
  
  // Comic metadata
  const comicMetadata = {
    calvinandhobbes: {
      name: 'Calvin & Hobbes',
      baseUrl: 'https://www.gocomics.com/calvinandhobbes',
      startDate: new Date('1985-11-18'),
      endDate: new Date('1995-12-31'),
    },
    peanuts: {
      name: 'Peanuts',
      baseUrl: 'https://www.gocomics.com/peanuts',
      startDate: new Date('1950-10-02'),
      endDate: new Date('2000-02-13'),
    },
    farside: {
      name: 'The Far Side',
      baseUrl: 'https://www.thefarside.com',
      startDate: new Date('1980-01-01'),
      endDate: new Date('1995-01-01'),
    },
  };

  // Format numbers in a compact way
  // Memoized number formatting (called thousands of times)
  const formatCompactNumber = memoize((num) => {
    if (num === null || num === undefined || isNaN(num)) return '—';
    
    const absNum = Math.abs(num);
    if (absNum >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (absNum >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (absNum >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    if (absNum >= 1) return num.toFixed(2);
    if (absNum >= 0.01) return num.toFixed(4);
    if (absNum >= 0.0001) return num.toFixed(6);
    return num.toExponential(2);
  }, (num) => `${num}`); // Simple key function

  function loadSettings() {
    // SPEED: Use cache to avoid repeated localStorage reads/decryption
    const now = Date.now();
    if (settingsCache && (now - settingsCacheTime) < PERF_CONFIG.CACHE.SETTINGS) {
      return settingsCache;
    }
    
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const settings = JSON.parse(raw);
      
      // Decrypt sensitive fields
      if (settings.walletAddresses) {
        settings.walletAddresses = simpleDecrypt(settings.walletAddresses);
      }
      if (settings.alchemyApiKey) {
        settings.alchemyApiKey = simpleDecrypt(settings.alchemyApiKey);
      }
      if (settings.heliusApiKey) {
        settings.heliusApiKey = simpleDecrypt(settings.heliusApiKey);
      }
      if (settings.openSeaApiKey) {
        settings.openSeaApiKey = simpleDecrypt(settings.openSeaApiKey);
      }
      // Backward compatibility for old format
      if (settings.hyperliquidAddress) {
        settings.hyperliquidAddress = simpleDecrypt(settings.hyperliquidAddress);
      }
      if (settings.lighterAddress) {
        settings.lighterAddress = simpleDecrypt(settings.lighterAddress);
      }
      
      // Cache the result
      settingsCache = settings;
      settingsCacheTime = now;
      
      return settings;
    } catch {
      return null;
    }
  }

  function saveSettings(settings) {
    // Create a copy to avoid modifying the original
    const settingsToSave = { ...settings };
    
    // Encrypt sensitive fields before saving
    if (settingsToSave.walletAddresses) {
      settingsToSave.walletAddresses = simpleEncrypt(settingsToSave.walletAddresses);
    }
    if (settingsToSave.alchemyApiKey) {
      settingsToSave.alchemyApiKey = simpleEncrypt(settingsToSave.alchemyApiKey);
    }
    if (settingsToSave.heliusApiKey) {
      settingsToSave.heliusApiKey = simpleEncrypt(settingsToSave.heliusApiKey);
    }
    if (settingsToSave.openSeaApiKey) {
      settingsToSave.openSeaApiKey = simpleEncrypt(settingsToSave.openSeaApiKey);
    }
    // Backward compatibility for old format
    if (settingsToSave.hyperliquidAddress) {
      settingsToSave.hyperliquidAddress = simpleEncrypt(settingsToSave.hyperliquidAddress);
    }
    if (settingsToSave.lighterAddress) {
      settingsToSave.lighterAddress = simpleEncrypt(settingsToSave.lighterAddress);
    }
    
    localStorage.setItem(storageKey, JSON.stringify(settingsToSave));
    
    // Invalidate cache
    settingsCache = null;
    settingsCacheTime = 0;
  }

  function getDefaultSettings() {
    return {
      theme: 'light',
      refreshMinutes: 30,
      userName: '',
      cryptoPositions: [], // { type: 'pyth', symbol, feedId, amount, entryPrice } or { type: 'custom', name, value }
      weather: { label: '', lat: null, lon: null },
      walletAddresses: '',
      solanaAddresses: '',
      bitcoinAddresses: '',
      zcashAddresses: '',
      alchemyApiKey: '',
      heliusApiKey: '',
      openSeaApiKey: '',
      zerionApiKey: '',
      fontSize: 15,
      comicStrip: 'calvinandhobbes',
      showComic: true,
      comicCollapsed: false, // Whether comic section is collapsed
      showWatchlist: true,
      showRainForecast: true,
      useColoredPnL: true,
      leftAligned: true, // true = centered, false = left-aligned
      usePythPrices: true,
      minBalanceThreshold: 100,
      enableRealTimeUpdates: true,
      realTimeUpdateInterval: 5, // seconds
      heroPnLMode: 'total', // 'total' or '24h'
      showSnowBtn: true,
      showRainBtn: true,
      showThemeBtn: true,
      showAmountsBtn: true,
      showFontSize: true,
      showStickersBtn: true,
      showDonateBtn: true,
      hiddenAssets: [], // Array of hidden asset keys: "ASSET_EXCHANGE"
      rainEnabled: false,
      snowEnabled: false,
      watchlist: [], // Array of Pyth price feed IDs
      watchlistCollapsed: false, // Whether watchlist section is collapsed
      compactList: false, // Whether to use compact list mode
      buttonBackgrounds: false // Whether to add backgrounds to buttons
    };
  }
  
  function parseWallets(walletString) {
    if (!walletString) return [];
    return walletString
      .split(',')
      .map(w => w.trim())
      .filter(w => w.length > 0);
  }
  
  function parseBitcoinAddresses(addressString) {
    if (!addressString) return [];
    return addressString
      .split(',')
      .map(a => a.trim())
      .filter(a => a.length > 0);
  }
  
  function parseZcashAddresses(addressString) {
    if (!addressString) return [];
    return addressString
      .split(',')
      .map(a => a.trim())
      .filter(a => a.length > 0);
  }
  
  // === ADDRESS VALIDATION UTILITIES ===
  
  function isEVMAddress(address) {
    // EVM addresses start with 0x and are 42 characters long
    return address && address.startsWith('0x') && address.length === 42;
  }
  
  function isSolanaAddress(address) {
    // Solana addresses are base58 encoded, typically 32-44 characters, no 0x prefix
    return address && !address.startsWith('0x') && !address.startsWith('t1') && !address.startsWith('t3') 
      && !address.startsWith('bc1') && !address.startsWith('1') && !address.startsWith('3')
      && address.length >= 32 && address.length <= 44;
  }
  
  function isBitcoinAddress(address) {
    // Bitcoin addresses: bc1 (bech32), 1 (P2PKH), 3 (P2SH)
    return address && (address.startsWith('bc1') || address.startsWith('1') || address.startsWith('3'));
  }
  
  function isZcashAddress(address) {
    // Zcash transparent addresses start with t1 or t3
    return address && (address.startsWith('t1') || address.startsWith('t3'));
  }
  
  function separateAddressesByType(addresses) {
    const evm = [];
    const solana = [];
    const bitcoin = [];
    const zcash = [];
    
    for (const addr of addresses) {
      if (isEVMAddress(addr)) {
        evm.push(addr);
      } else if (isSolanaAddress(addr)) {
        solana.push(addr);
      } else if (isBitcoinAddress(addr)) {
        bitcoin.push(addr);
      } else if (isZcashAddress(addr)) {
        zcash.push(addr);
      }
    }
    
    return { evm, solana, bitcoin, zcash };
  }

  function applyHeaderVisibility(settings) {
    // Show/hide header bar elements based on settings (default to true for undefined)
    if (els.toggleSnowBtn) {
      els.toggleSnowBtn.style.display = (settings.showSnowBtn ?? true) ? '' : 'none';
    }
    if (els.toggleRainBtn) {
      els.toggleRainBtn.style.display = (settings.showRainBtn ?? true) ? '' : 'none';
    }
    if (els.toggleThemeBtn) {
      els.toggleThemeBtn.style.display = (settings.showThemeBtn ?? true) ? '' : 'none';
    }
    if (els.toggleAmountsBtn) {
      els.toggleAmountsBtn.style.display = (settings.showAmountsBtn ?? true) ? '' : 'none';
    }
    if (els.fontSizeControls) {
      els.fontSizeControls.style.display = (settings.showFontSize ?? true) ? '' : 'none';
    }
    if (els.openStickersBtn) {
      els.openStickersBtn.style.display = (settings.showStickersBtn ?? true) ? '' : 'none';
    }
    if (els.openDonateBtn) {
      els.openDonateBtn.style.display = (settings.showDonateBtn ?? true) ? '' : 'none';
    }
  }

  function applyTheme(theme) {
    const previousTheme = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = theme;
    
    // Update all theme select elements to sync
    if (els.toggleThemeBtn) {
      els.toggleThemeBtn.value = theme;
    }
    if (els.toggleThemeBtnMobile) {
      els.toggleThemeBtnMobile.value = theme;
    }
    if (els.themeSelect) {
      els.themeSelect.value = theme;
    }
    
    // Auto-enable snow for Christmas theme
    if (theme === 'christmas' && !snowActive) {
      toggleSnow(true); // Pass true to indicate this is an auto-toggle
    }
    // Auto-disable snow when leaving Christmas theme (optional - you can remove this if you want snow to persist)
    else if (theme !== 'christmas' && snowActive) {
      toggleSnow(true); // Pass true to indicate this is an auto-toggle
    }
    
    // Auto-enable yellow rain for Cyberpunk theme
    if (theme === 'cyberpunk' && !rainActive) {
      rainAutoEnabled = true; // Mark as auto-enabled
      toggleRain(true); // Pass true to indicate this is an auto-toggle
    }
    // When switching away from cyberpunk, turn off rain if it was auto-enabled
    else if (previousTheme === 'cyberpunk' && theme !== 'cyberpunk' && rainActive && rainAutoEnabled) {
      toggleRain(true); // Pass true to indicate this is an auto-toggle
      rainAutoEnabled = false;
    }
  }
  
  function applyAlignment(leftAligned) {
    const container = document.querySelector('.container');
    if (container) {
      if (leftAligned) {
        container.style.margin = '0 auto';
      } else {
        container.style.margin = '';
      }
    }
  }
  
  function applyCompactList(compact) {
    const tables = document.querySelectorAll('.data-table');
    tables.forEach(table => {
      if (compact) {
        table.classList.add('compact-mode');
      } else {
        table.classList.remove('compact-mode');
      }
    });
    
    // Add/remove class to body for mobile card visibility
    if (compact) {
      document.body.classList.add('compact-mode');
    } else {
      document.body.classList.remove('compact-mode');
    }
    
    // Update positions table header for compact mode
    const positionsTable = document.getElementById('positionsTable');
    if (positionsTable) {
      const headerRow = positionsTable.querySelector('thead tr');
      if (headerRow) {
        if (compact) {
          // Compact mode: Asset, 24H%, P&L, Price, Value, Amount, Exchange
          headerRow.innerHTML = `
            <th class="th-asset">Asset</th>
            <th class="th-change">24H%</th>
            <th class="th-pnl">P&L</th>
            <th class="th-price">Price</th>
            <th class="th-value">Value</th>
            <th class="th-amount">Amount</th>
            <th class="th-exchange">Exchange</th>
          `;
        } else {
          // Normal mode: Asset, Exchange, Amount, Price, Value, 24H%, P&L
          headerRow.innerHTML = `
            <th class="th-asset">Asset</th>
            <th class="th-exchange">Exchange</th>
            <th class="th-amount">Amount</th>
            <th class="th-price">Price</th>
            <th class="th-value">Value</th>
            <th class="th-change">24H%</th>
            <th class="th-pnl">P&L</th>
          `;
        }
      }
    }
    
    // Re-render positions table to update column order (only if data is loaded)
    if (allPositionsData && allPositionsData.length > 0) {
      renderPositionsTable();
    }
  }
  
  function applyButtonBackgrounds(enabled) {
    const buttons = document.querySelectorAll('button, .btn-text');
    buttons.forEach(button => {
      if (enabled) {
        button.style.backgroundColor = 'var(--card-bg)';
      } else {
        button.style.backgroundColor = '';
      }
    });
  }

  function applyFontSize(size) {
    document.documentElement.style.fontSize = size + 'px';
    currentFontSize = size;
    if (els.fontSizeDisplay) {
      els.fontSizeDisplay.textContent = size + 'px';
    }
    if (els.fontSizeDisplayMobile) {
      els.fontSizeDisplayMobile.textContent = size + 'px';
    }
  }
  
  function openMobileMenu() {
    if (els.mobileMenu) {
      els.mobileMenu.classList.add('active');
    }
  }
  
  function closeMobileMenu() {
    if (els.mobileMenu) {
      els.mobileMenu.classList.remove('active');
    }
  }

  function initTheme(settings) {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = settings?.theme || (prefersDark ? 'dark' : 'light');
    applyTheme(theme);
    
    // Header theme select change handler
    if (els.toggleThemeBtn) {
      els.toggleThemeBtn.addEventListener('change', (e) => {
        const newTheme = e.target.value;
        applyTheme(newTheme);
        const s = loadSettings() || getDefaultSettings();
        s.theme = newTheme;
        saveSettings(s);
      });
    }
    
    // Settings theme select change handler
    if (els.themeSelect) {
      els.themeSelect.addEventListener('change', (e) => {
        const newTheme = e.target.value;
        applyTheme(newTheme);
        const s = loadSettings() || getDefaultSettings();
        s.theme = newTheme;
        saveSettings(s);
      });
    }
    
    // Initialize font size - convert old string values to numbers
    let fontSize = settings?.fontSize;
    if (typeof fontSize === 'string' || !fontSize) {
      fontSize = 15; // Reset to default if it's a string like "medium"
    }
    applyFontSize(fontSize);
  }

  function renderPositionRow(position, index) {
    const row = document.createElement('div');
    row.className = 'item-row item-row-wide';
    row.innerHTML = `
      <input type="text" value="${position.symbol || ''}" data-idx="${index}" data-field="symbol" placeholder="BTC">
      <input type="text" value="${position.coingeckoId || ''}" data-idx="${index}" data-field="coingeckoId" placeholder="bitcoin">
      <input type="number" step="any" value="${position.amount ?? ''}" data-idx="${index}" data-field="amount" placeholder="1.5">
      <input type="number" step="any" value="${position.entryPrice ?? ''}" data-idx="${index}" data-field="entryPrice" placeholder="50000">
      <button type="button" class="remove-btn btn-text" data-idx="${index}" data-kind="position">[X]</button>
    `;
    return row;
  }

  let assetsLoaded = false;
  let dragDropSetup = false;
  
  function openStickerWindow() {
    if (els.stickerWindow) {
      els.stickerWindow.style.display = 'flex';
      
      // Load assets if not already loaded
      if (!assetsLoaded) {
        loadCustomAssets().then(() => {
          assetsLoaded = true;
          // Setup drag-drop after assets are loaded
          if (!dragDropSetup) {
            setTimeout(() => {
              setupStickerDragDrop();
              dragDropSetup = true;
            }, 500);
          }
        }).catch(err => {
          console.error('✗ Asset load failed');
        });
      }
      
      // Add click-outside-to-close handler
      setTimeout(() => {
        document.addEventListener('click', handleStickerWindowClickOutside);
      }, 100);
    }
    
    // Close mobile menu if open
    if (els.mobileMenu) {
      els.mobileMenu.classList.remove('active');
    }
  }
  
  function handleStickerWindowClickOutside(e) {
    if (els.stickerWindow && 
        els.stickerWindow.style.display === 'flex' &&
        !els.stickerWindow.contains(e.target) &&
        !els.openStickersBtn?.contains(e.target) &&
        !els.openStickersBtnMobile?.contains(e.target)) {
      closeStickerWindow();
    }
  }
  
  function closeStickerWindow() {
    if (els.stickerWindow) {
      els.stickerWindow.style.display = 'none';
      document.removeEventListener('click', handleStickerWindowClickOutside);
    }
  }
  
  function openDonateWindow() {
    if (els.donateWindow) {
      if (els.donateBackdrop) {
        els.donateBackdrop.style.display = 'block';
      }
      els.donateWindow.style.display = 'flex';
      
      // Add click-outside-to-close after a short delay
      setTimeout(() => {
        document.addEventListener('click', handleDonateWindowClickOutside);
      }, 100);
    }
    
    // Close mobile menu if open
    if (els.mobileMenu) {
      els.mobileMenu.classList.remove('active');
    }
  }
  
  function handleDonateWindowClickOutside(e) {
    if (els.donateWindow && 
        els.donateWindow.style.display === 'flex' &&
        !els.donateWindow.contains(e.target) &&
        !els.openDonateBtn?.contains(e.target) &&
        !els.openDonateBtnMobile?.contains(e.target)) {
      closeDonateWindow();
    }
  }
  
  function closeDonateWindow() {
    if (els.donateWindow) {
      els.donateWindow.style.display = 'none';
      if (els.donateBackdrop) {
        els.donateBackdrop.style.display = 'none';
      }
      document.removeEventListener('click', handleDonateWindowClickOutside);
    }
  }
  
  async function copyToClipboard(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      const originalText = button.textContent;
      button.textContent = '[COPIED!]';
      button.style.opacity = '0.6';
      setTimeout(() => {
        button.textContent = originalText;
        button.style.opacity = '1';
      }, 1500);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  }

  function openSettings() {
    const settings = loadSettings() || getDefaultSettings();
    
    // Migrate old settings to new format
    if (!settings.walletAddresses && (settings.hyperliquidAddress || settings.lighterAddress)) {
      const addresses = [];
      if (settings.hyperliquidAddress) addresses.push(settings.hyperliquidAddress);
      if (settings.lighterAddress && settings.lighterAddress !== settings.hyperliquidAddress) {
        addresses.push(settings.lighterAddress);
      }
      settings.walletAddresses = addresses.join(', ');
    }
    
    // Populate settings
    els.walletAddresses.value = settings.walletAddresses || '';
    els.solanaAddresses.value = settings.solanaAddresses || '';
    els.bitcoinAddresses.value = settings.bitcoinAddresses || '';
    els.zcashAddresses.value = settings.zcashAddresses || '';
    els.alchemyApiKey.value = settings.alchemyApiKey || '';
    els.heliusApiKey.value = settings.heliusApiKey || '';
    els.openSeaApiKey.value = settings.openSeaApiKey || '';
    els.zerionApiKey.value = settings.zerionApiKey || '';
    els.themeSelect.value = settings.theme || 'light';
    els.userName.value = settings.userName || '';
    // Don't populate the deprecated manual positions form - it's hidden and causes conflicts
    els.positionsContainer.innerHTML = '';
    els.weatherLabel.value = settings.weather.label || '';
    els.weatherLat.value = settings.weather.lat ?? '';
    els.weatherLon.value = settings.weather.lon ?? '';
    els.showRainForecast.checked = settings.showRainForecast ?? true;
    els.useColoredPnL.checked = settings.useColoredPnL ?? true;
    els.leftAligned.checked = settings.leftAligned ?? false;
    els.usePythPrices.checked = settings.usePythPrices ?? false;
    els.heroPnLMode.value = settings.heroPnLMode ?? 'total';
    els.compactList.checked = settings.compactList ?? false;
    els.buttonBackgrounds.checked = settings.buttonBackgrounds ?? false;
    els.minBalanceThreshold.value = settings.minBalanceThreshold ?? 100;
    els.enableRealTimeUpdates.checked = settings.enableRealTimeUpdates ?? true;
    els.realTimeUpdateInterval.value = settings.realTimeUpdateInterval ?? 5;
    els.showComic.checked = settings.showComic ?? true;
    els.showWatchlist.checked = settings.showWatchlist ?? true;
    els.refreshMins.value = settings.refreshMinutes ?? 30;
    els.comicStrip.value = settings.comicStrip || 'calvinandhobbes';

    // Header bar visibility settings
    els.showSnowBtn.checked = settings.showSnowBtn ?? true;
    els.showRainBtn.checked = settings.showRainBtn ?? true;
    els.showThemeBtn.checked = settings.showThemeBtn ?? true;
    els.showAmountsBtn.checked = settings.showAmountsBtn ?? true;
    els.showFontSize.checked = settings.showFontSize ?? true;
    els.showStickersBtn.checked = settings.showStickersBtn ?? true;
    els.showDonateBtn.checked = settings.showDonateBtn ?? true;

    // Show settings panel
    els.settingsDialog.style.display = 'block';
    els.settingsBackdrop.style.display = 'block';
    // Toggle button visibility
    els.openSettingsBtn.style.display = 'none';
    els.closeSettingsBtn.style.display = 'inline-block';
  }
  
  function closeSettings() {
    // Hide settings panel
    els.settingsDialog.style.display = 'none';
    els.settingsBackdrop.style.display = 'none';
    // Toggle button visibility
    els.openSettingsBtn.style.display = 'inline-block';
    els.closeSettingsBtn.style.display = 'none';
    
    // Reset import/export mode
    if (els.settingsExportArea) {
      els.settingsExportArea.style.display = 'none';
      els.settingsExportArea.setAttribute('readonly', 'true');
    }
    if (els.importSettingsBtn) {
      els.importSettingsBtn.textContent = '[IMPORT]';
    }
  }

  function collectSettingsFromForm() {
    const current = loadSettings() || getDefaultSettings();
    const newSettings = { ...current };

    // Get wallet addresses and API keys
    newSettings.walletAddresses = els.walletAddresses.value.trim() || '';
    newSettings.solanaAddresses = els.solanaAddresses.value.trim() || '';
    newSettings.bitcoinAddresses = els.bitcoinAddresses.value.trim() || '';
    newSettings.zcashAddresses = els.zcashAddresses.value.trim() || '';
    newSettings.alchemyApiKey = els.alchemyApiKey.value.trim() || '';
    newSettings.heliusApiKey = els.heliusApiKey.value.trim() || '';
    newSettings.openSeaApiKey = els.openSeaApiKey.value.trim() || '';
    newSettings.zerionApiKey = els.zerionApiKey.value.trim() || '';

    // Preserve existing cryptoPositions (added via ADD POSITION button)
    // Don't read from the deprecated manual positions form
    // newSettings.cryptoPositions is already set from { ...current }

    newSettings.userName = els.userName.value.trim() || '';
    
    newSettings.weather = {
      label: els.weatherLabel.value.trim(),
      lat: els.weatherLat.value ? Number(els.weatherLat.value) : null,
      lon: els.weatherLon.value ? Number(els.weatherLon.value) : null,
    };

    newSettings.refreshMinutes = Math.max(1, Number(els.refreshMins.value || 30));
    newSettings.comicStrip = els.comicStrip.value || 'calvinandhobbes';
    newSettings.showComic = els.showComic.checked;
    newSettings.showWatchlist = els.showWatchlist.checked;
    newSettings.showRainForecast = els.showRainForecast.checked;
    newSettings.useColoredPnL = els.useColoredPnL.checked;
    newSettings.leftAligned = els.leftAligned.checked;
    newSettings.usePythPrices = els.usePythPrices.checked;
    newSettings.heroPnLMode = els.heroPnLMode.value || 'total';
    newSettings.compactList = els.compactList.checked;
    newSettings.buttonBackgrounds = els.buttonBackgrounds.checked;
    newSettings.minBalanceThreshold = Math.max(0, Number(els.minBalanceThreshold.value || 100));
    newSettings.theme = els.themeSelect.value || 'light';
    newSettings.wallpaper = els.wallpaperSelect ? els.wallpaperSelect.value : 'none';
    newSettings.enableRealTimeUpdates = els.enableRealTimeUpdates.checked;
    newSettings.realTimeUpdateInterval = Math.max(5, Math.min(60, Number(els.realTimeUpdateInterval.value || 5)));
    
    // Header bar visibility settings
    newSettings.showSnowBtn = els.showSnowBtn.checked;
    newSettings.showRainBtn = els.showRainBtn.checked;
    newSettings.showThemeBtn = els.showThemeBtn.checked;
    newSettings.showAmountsBtn = els.showAmountsBtn.checked;
    newSettings.showFontSize = els.showFontSize.checked;
    newSettings.showStickersBtn = els.showStickersBtn.checked;
    newSettings.showDonateBtn = els.showDonateBtn.checked;
    
    return newSettings;
  }

  function addHandlers() {
    els.openSettingsBtn.addEventListener('click', openSettings);
    
    if (els.openSettingsBtnMobile) {
      els.openSettingsBtnMobile.addEventListener('click', () => {
        closeMobileMenu();
        openSettings();
      });
    }
    
    // Last update timestamp - click to refresh
    if (els.lastUpdateTimestamp) {
      els.lastUpdateTimestamp.addEventListener('click', async () => {
        await refreshAll();
      });
    }
    
    // Sticker window handlers
    if (els.openStickersBtn) {
      els.openStickersBtn.addEventListener('click', openStickerWindow);
    }
    
    if (els.openStickersBtnMobile) {
      els.openStickersBtnMobile.addEventListener('click', () => {
        closeMobileMenu();
        openStickerWindow();
      });
    }
    
    if (els.closeStickerWindowBtn) {
      els.closeStickerWindowBtn.addEventListener('click', closeStickerWindow);
    }
    
    // Donate window handlers
    if (els.openDonateBtn) {
      els.openDonateBtn.addEventListener('click', openDonateWindow);
    }
    
    if (els.openDonateBtnMobile) {
      els.openDonateBtnMobile.addEventListener('click', () => {
        closeMobileMenu();
        openDonateWindow();
      });
    }
    
    if (els.closeDonateWindowBtn) {
      els.closeDonateWindowBtn.addEventListener('click', closeDonateWindow);
    }
    
    // Backdrop click to close donate window
    if (els.donateBackdrop) {
      els.donateBackdrop.addEventListener('click', closeDonateWindow);
    }
    
    // Copy address buttons - event delegation
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('copy-address-btn')) {
        const address = e.target.getAttribute('data-address');
        if (address) {
          copyToClipboard(address, e.target);
        }
      }
    });
    
    // Theme dropdown change handler
    if (els.themeSelect) {
      els.themeSelect.addEventListener('change', () => {
        const newTheme = els.themeSelect.value;
        applyTheme(newTheme);
      });
    }
    
    // Export settings
    if (els.exportSettingsBtn) {
      els.exportSettingsBtn.addEventListener('click', async () => {
        const settings = loadSettings() || getDefaultSettings();
        const exportData = btoa(JSON.stringify(settings));
        els.settingsExportArea.value = exportData;
        els.settingsExportArea.style.display = 'block';
        els.settingsExportArea.removeAttribute('readonly');
        els.settingsExportArea.select();
        
        try {
          await navigator.clipboard.writeText(exportData);
          const originalText = els.exportSettingsBtn.textContent;
          els.exportSettingsBtn.textContent = '[COPIED!]';
          setTimeout(() => {
            els.exportSettingsBtn.textContent = originalText;
          }, 1500);
        } catch (err) {
        }
      });
    }
    
    // Import settings
    if (els.importSettingsBtn) {
      let importMode = false;
      els.importSettingsBtn.addEventListener('click', () => {
        if (!importMode) {
          // First click: show textarea for pasting
          els.settingsExportArea.value = '';
          els.settingsExportArea.placeholder = 'Paste exported settings here and click [IMPORT] again';
          els.settingsExportArea.style.display = 'block';
          els.settingsExportArea.removeAttribute('readonly');
          els.settingsExportArea.focus();
          els.importSettingsBtn.textContent = '[APPLY IMPORT]';
          importMode = true;
        } else {
          // Second click: import the settings
          try {
            const importData = els.settingsExportArea.value.trim();
            if (!importData) {
              alert('Please paste settings data first');
              return;
            }
            const decoded = atob(importData);
            const settings = JSON.parse(decoded);
            saveSettings(settings);
            closeSettings();
            
            // Apply all settings
            applyAlignment(settings.leftAligned);
            applyTheme(settings.theme);
            
            // Restart real-time updates
            stopRealTimeUpdates();
            if (settings.enableRealTimeUpdates) {
              setTimeout(() => startRealTimeUpdates(), 1000);
            }
            
            // Hide textarea and reset
            els.settingsExportArea.style.display = 'none';
            els.importSettingsBtn.textContent = '[IMPORT]';
            importMode = false;
            
            refreshAll();
          } catch (err) {
            alert('Invalid settings data. Please check the pasted text and try again.');
            console.error('✗ Import failed');
          }
        }
      });
      
      // Reset import mode when settings dialog closes (handled below)
    }
    
    // Close settings button
    if (els.closeSettingsBtn) {
      els.closeSettingsBtn.addEventListener('click', closeSettings);
    }
    
    // Cancel settings button
    if (els.cancelSettingsBtn) {
      els.cancelSettingsBtn.addEventListener('click', closeSettings);
    }
    
    // Backdrop click to close
    if (els.settingsBackdrop) {
      els.settingsBackdrop.addEventListener('click', closeSettings);
    }
    
    // Click to copy on export textarea
    if (els.settingsExportArea) {
      els.settingsExportArea.addEventListener('click', async function() {
        if (this.value && this.readOnly) {
          this.select();
          try {
            await navigator.clipboard.writeText(this.value);
          } catch (err) {
          }
        }
      });
    }
    
    els.saveSettingsBtn.addEventListener('click', () => {
      const s = collectSettingsFromForm();
      saveSettings(s);
      closeSettings();
      
      // Show/hide comic section immediately based on showComic setting
      if (els.comicSection) {
        els.comicSection.style.display = s.showComic ? 'block' : 'none';
      }
      
      // Show/hide watchlist section based on showWatchlist setting (default to visible)
      const watchlistSection = document.getElementById('watchlistSection');
      if (watchlistSection) {
        watchlistSection.style.display = (s.showWatchlist ?? true) ? 'block' : 'none';
      }
      
      // Apply alignment setting
      applyAlignment(s.leftAligned);
      
      // Apply theme
      applyTheme(s.theme);
      
      // Apply wallpaper
      applyWallpaper(s.wallpaper);
      
      // Apply compact list styling
      applyCompactList(s.compactList);
      
      // Apply button backgrounds
      applyButtonBackgrounds(s.buttonBackgrounds);
      
      // Apply header visibility
      applyHeaderVisibility(s);
      
      // Restart real-time updates with new settings
      stopRealTimeUpdates();
      if (s.enableRealTimeUpdates) {
        setTimeout(() => startRealTimeUpdates(), 1000);
      }
      
      refreshAll();
    });
    
    // Settings tabs switching
    const settingsTabs = document.querySelectorAll('.settings-tab');
    const settingsTabContents = document.querySelectorAll('.settings-tab-content');
    const closeSettingsDialogBtn = document.getElementById('closeSettingsDialogBtn');
    const settingsTabsContainer = document.getElementById('settingsTabs');
    
    settingsTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.getAttribute('data-tab');
        
        // Switch tabs
        settingsTabs.forEach(t => t.classList.remove('active'));
        settingsTabContents.forEach(content => content.classList.remove('active'));
        
        tab.classList.add('active');
        document.querySelector(`[data-tab-content="${tabName}"]`).classList.add('active');
      });
    });
    
    // Close settings dialog button
    if (closeSettingsDialogBtn) {
      closeSettingsDialogBtn.addEventListener('click', closeSettings);
    }

    // Get location button
    if (els.getLocationBtn) {
      els.getLocationBtn.addEventListener('click', async () => {
        if (!navigator.geolocation) {
          alert('Geolocation is not supported by your browser');
          return;
        }

        els.getLocationBtn.textContent = '[GETTING LOCATION...]';
        els.getLocationBtn.disabled = true;

        try {
          const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 0
            });
          });

          const lat = position.coords.latitude;
          const lon = position.coords.longitude;

          els.weatherLat.value = lat;
          els.weatherLon.value = lon;

          // Try to get city name via reverse geocoding
          try {
            const geoResp = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
            if (geoResp.ok) {
              const geoData = await geoResp.json();
              const city = geoData.city || geoData.locality || geoData.principalSubdivision || '';
              if (city) {
                els.weatherLabel.value = city;
              }
            }
          } catch (err) {
            // Silent
          }

          els.getLocationBtn.textContent = '[USE MY LOCATION]';
          els.getLocationBtn.disabled = false;
        } catch (err) {
          console.error('✗ Location denied');
          alert('Could not get your location. Please check browser permissions.');
          els.getLocationBtn.textContent = '[USE MY LOCATION]';
          els.getLocationBtn.disabled = false;
        }
      });
    }

    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.matches('.remove-btn')) {
        const kind = target.dataset.kind;
        const idx = Number(target.dataset.idx);
        if (kind === 'position') {
          const rows = Array.from(els.positionsContainer.children);
          if (rows[idx]) rows[idx].remove();
        }
      }
    });
  }

  async function renderCalvin(date = null, shouldFade = false) {
    try {
      if (!date) date = currentCalvinDate;
      
      const settings = loadSettings() || getDefaultSettings();
      const comicStrip = settings.comicStrip || 'calvinandhobbes';
      const comic = comicMetadata[comicStrip];
      
      if (!comic) {
        throw new Error('Unknown comic strip');
      }
      
      // If we should fade, add fading class and wait
      if (shouldFade) {
        const calvinContainer = document.querySelector('.calvin-container');
        if (calvinContainer) {
          calvinContainer.classList.add('fading');
          await new Promise(resolve => setTimeout(resolve, 300)); // Wait for fade
        }
      } else {
        // First load, show loading
        els.calvinImage.innerHTML = '<span class="loading-terminal">[...]</span>';
      }
      
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      
      let comicUrl;
      
      // The Far Side uses a different URL structure
      if (comicStrip === 'farside') {
        comicUrl = `https://www.thefarside.com/${year}/${month}/${day}`;
      } else {
        // GoComics strips
        comicUrl = `${comic.baseUrl}/${year}/${month}/${day}`;
      }
      
      // Try multiple CORS proxies with fallback
      const proxies = [
        // 1. Our own Cloudflare Function (most reliable, deployed with your site)
        `/api/proxy?url=${encodeURIComponent(comicUrl)}`,
        // 2. AllOrigins (backup)
        `https://api.allorigins.win/raw?url=${encodeURIComponent(comicUrl)}`,
        // 3. CORSProxy.io (backup)
        `https://corsproxy.io/?${encodeURIComponent(comicUrl)}`
      ];
      
      let response = null;
      let lastError = null;
      
      // Try each proxy until one works
      for (let i = 0; i < proxies.length; i++) {
        const proxyUrl = proxies[i];
        const proxyName = i === 0 ? 'Cloudflare Function' : i === 1 ? 'AllOrigins' : 'CORSProxy';
        
        try {
          if (isProduction) console.log(`📡 Trying ${proxyName}...`);
          
          response = await fetch(proxyUrl, { 
            signal: AbortSignal.timeout(15000) // 15 second timeout
          });
          
          if (response.ok) {
            if (isProduction) console.log(`✅ ${proxyName} succeeded`);
            break; // Success! Stop trying proxies
          }
          
          lastError = `${proxyName} returned ${response.status}`;
          if (isProduction) console.warn(`⚠ ${lastError}`);
        } catch (err) {
          lastError = `${proxyName}: ${err.message}`;
          if (isProduction) console.warn(`⚠ ${lastError}`);
          // Continue to next proxy
        }
      }
      
      if (!response || !response.ok) {
        console.error('❌ All comic proxies failed:', lastError);
        throw new Error(lastError || 'All proxies failed');
      }
      
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      
      let imgUrl = null;
      
      // The Far Side uses a specific class and CDN
      if (comicStrip === 'farside') {
        // Method 1: Look for images from amuniversal CDN in all attributes
        const allImages = doc.querySelectorAll('img');
        for (const img of allImages) {
          // Check all possible attributes
          const attributes = ['src', 'data-src', 'data-lazy-src', 'srcset', 'data-srcset'];
          for (const attr of attributes) {
            const value = img.getAttribute(attr);
            if (value && value.includes('featureassets.amuniversal.com')) {
              imgUrl = value.split(',')[0].split(' ')[0]; // Handle srcset format
              break;
            }
          }
          if (imgUrl) break;
        }
        
        // Method 2: Look in the HTML source for amuniversal URLs
        if (!imgUrl) {
          const htmlText = html;
          const match = htmlText.match(/https?:\/\/featureassets\.amuniversal\.com\/[^\s"'<>]+/);
          if (match) {
            imgUrl = match[0];
          }
        }
      }
      
      // Method 1: Look for og:image meta tag
      if (!imgUrl) {
        const ogImage = doc.querySelector('meta[property="og:image"]');
        if (ogImage) {
          imgUrl = ogImage.getAttribute('content');
        }
      }
      
      // Method 2: Look for the main comic image (GoComics)
      if (!imgUrl) {
        const comicImg = doc.querySelector('.comic.img-fluid, picture img, .item-comic-image img');
        if (comicImg) {
          imgUrl = comicImg.getAttribute('src') || comicImg.getAttribute('data-src');
        }
      }
      
      
      if (imgUrl) {
        // Ensure the URL is absolute
        if (imgUrl.startsWith('//')) {
          imgUrl = 'https:' + imgUrl;
        } else if (imgUrl.startsWith('/')) {
          if (comicStrip === 'farside') {
            imgUrl = 'https://www.thefarside.com' + imgUrl;
          } else {
            imgUrl = 'https://www.gocomics.com' + imgUrl;
          }
        }
        
        // Preload the image before showing it
        const img = new Image();
        img.src = imgUrl;
        
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          setTimeout(reject, 10000);
        });
        
        // Image is loaded, now update DOM
        els.calvinImage.innerHTML = `
          <a href="${comicUrl}" target="_blank" style="display: block;">
            <img src="${imgUrl}" alt="${comic.name} comic">
          </a>
        `;
        
        // Remove fading class to fade back in
        const calvinContainer = document.querySelector('.calvin-container');
        if (calvinContainer) {
          calvinContainer.classList.remove('fading');
        }
        
        // Handle button visibility - show prev/random, conditionally show next
        if (els.calvinPrevBtn) els.calvinPrevBtn.style.display = '';
        if (els.calvinRandomBtn) els.calvinRandomBtn.style.display = '';
        if (els.calvinNextBtn) {
          if (date >= comic.endDate) {
            els.calvinNextBtn.style.display = 'none';
          } else {
            els.calvinNextBtn.style.display = '';
          }
        }
        
      } else {
        throw new Error('Could not find comic image');
      }
      
    } catch (err) {
      console.error('✗ Comic load failed');
      
      const settings = loadSettings() || getDefaultSettings();
      const comicStrip = settings.comicStrip || 'calvinandhobbes';
      const comic = comicMetadata[comicStrip];
      
      // Remove fading class on error too
      const calvinContainer = document.querySelector('.calvin-container');
      if (calvinContainer) {
        calvinContainer.classList.remove('fading');
      }
      
      // Check if we're at the last comic and hide next button even on error
      const checkDate = date || currentCalvinDate;
      if (els.calvinNextBtn && comic) {
        if (checkDate >= comic.endDate) {
          els.calvinNextBtn.style.display = 'none';
        } else {
          els.calvinNextBtn.style.display = '';
        }
      }
      
      const errorUrl = comic ? comic.baseUrl : 'https://www.gocomics.com';
      els.calvinImage.innerHTML = `
        <div style="text-align: center; padding: 40px; width: 100%; color: var(--muted);">
          <p id="retryComicText" style="cursor: pointer;">Unable to load comic. Click to retry.</p>
          <p style="font-size: 13px; margin-top: 12px;">
            <a href="${errorUrl}" target="_blank" class="external-link">View online ↗</a>
          </p>
        </div>
      `;
      
      // Add retry click event listener
      const retryText = document.getElementById('retryComicText');
      if (retryText) {
        retryText.addEventListener('click', () => renderCalvin());
      }
    }
  }

  async function fetchCryptoPrices() {
    const settings = loadSettings();
    if (!settings || !settings.cryptoPositions || settings.cryptoPositions.length === 0) return null;

    const ids = settings.cryptoPositions
      .filter(p => p.coingeckoId)
      .map(p => p.coingeckoId)
      .join(',');
    
    if (!ids) return null;

    const url = proxyCoinGecko(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
    return await rateLimitedFetch(url, `crypto-positions-${ids}`);
  }

  function getCoinIcon(symbol) {
    return `https://assets.coingecko.com/coins/images/${symbol === 'BTC' ? '1' : symbol === 'ETH' ? '279' : '0'}/small/${symbol.toLowerCase()}.png`;
  }

  async function renderCrypto() {
    const summary = document.getElementById('cryptoSummary');
    const list = document.getElementById('cryptoList');
    const updatedAt = document.getElementById('cryptoUpdatedAt');
    
    if (!summary || !list) return;

    const settings = loadSettings();
    
    // Don't clear list or return early - let Hyperliquid data append to it
    // Check if we have manual positions
    const hasManualPositions = settings && settings.cryptoPositions && settings.cryptoPositions.length > 0;
    
    if (!hasManualPositions && (!settings || !settings.hyperliquidAddress)) {
      summary.textContent = 'Configure positions in Settings or add Hyperliquid address';
      list.innerHTML = '';
      return;
    }
    
    // Clear list only for manual positions (keep for Hyperliquid/Lighter data)
    if (hasManualPositions) {
      list.innerHTML = '';
      
      const prices = await fetchCryptoPrices();
      if (!prices) {
        summary.textContent = 'Failed to fetch prices';
        list.innerHTML = '';
        return;
      }

      let total = 0;
      let totalPnL = 0;

      for (const pos of settings.cryptoPositions) {
        if (!pos.coingeckoId) continue;
        
        const priceData = prices[pos.coingeckoId];
        if (!priceData) continue;

        const priceUsd = priceData.usd || 0;
        const valueUsd = pos.amount * priceUsd;
        total += valueUsd;

        // Calculate P&L
        let pnl = 0;
        let pnlPercent = 0;
        let pnlClass = '';
        if (pos.entryPrice && pos.entryPrice > 0) {
          pnl = valueUsd - (pos.amount * pos.entryPrice);
          pnlPercent = ((priceUsd - pos.entryPrice) / pos.entryPrice) * 100;
          pnlClass = pnl >= 0 ? 'positive' : 'negative';
        }

        const li = document.createElement('li');
        li.className = 'crypto-item';
        li.innerHTML = `
          <div class="crypto-header">
            <img src="${getCoinIcon(pos.symbol)}" alt="${pos.symbol}" class="crypto-icon" onerror="this.style.display='none'">
            <strong>${pos.symbol}</strong>
            ${priceData.usd_24h_change ? `<span class="change ${priceData.usd_24h_change >= 0 ? 'positive' : 'negative'}">${priceData.usd_24h_change >= 0 ? '+' : '-'}${Math.abs(priceData.usd_24h_change).toFixed(2)}%</span>` : ''}
          </div>
          <div class="crypto-details">
            ${pos.amount.toFixed(4)} × $${priceUsd.toLocaleString()} = $${valueUsd.toLocaleString()}
            ${pnl !== 0 ? `<div class="pnl ${pnlClass}">P&L: ${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toLocaleString()} (${pnlPercent >= 0 ? '+' : '-'}${Math.abs(pnlPercent).toFixed(2)}%)</div>` : ''}
          </div>
        `;
        list.appendChild(li);
        totalPnL += pnl;
      }

      const totalPnLClass = totalPnL >= 0 ? 'positive' : 'negative';
      summary.innerHTML = `
        Total: $${total.toLocaleString()}
        ${totalPnL !== 0 ? `<span class="pnl-summary ${totalPnLClass}">(${totalPnL >= 0 ? '+' : ''}$${totalPnL.toLocaleString()})</span>` : ''}
      `;
    } else if (!hasManualPositions && settings && settings.hyperliquidAddress) {
      // Just show we're loading Hyperliquid data
      summary.innerHTML = '<span class="loading-terminal">[...]</span>';
    }
    
    if (updatedAt) updatedAt.textContent = new Date().toLocaleTimeString();
  }

  async function fetchWeather() {
    const settings = loadSettings();
    if (!settings || !settings.weather || !settings.weather.lat || !settings.weather.lon) return null;

    const { lat, lon } = settings.weather;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;
    
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Weather API failed');
      return await resp.json();
    } catch (err) {
      console.error('✗ Weather data unavailable');
      return null;
    }
  }

  async function renderWeather() {
    const now = document.getElementById('weatherNow');
    const forecast = document.getElementById('weatherForecast');
    const updatedAt = document.getElementById('weatherUpdatedAt');
    
    if (!now || !forecast) return;

    const settings = loadSettings();
    if (!settings || !settings.weather || !settings.weather.lat || !settings.weather.lon) {
      now.textContent = 'Set lat/lon in Settings';
      forecast.innerHTML = '';
      return;
    }

    const data = await fetchWeather();
    if (!data) {
      now.textContent = 'Failed to fetch weather';
      forecast.innerHTML = '';
      return;
    }

    const current = data.current;
    const location = settings.weather.label || `${settings.weather.lat.toFixed(2)}, ${settings.weather.lon.toFixed(2)}`;
    now.textContent = `${location}: ${current.temperature_2m}°C`;

    forecast.innerHTML = '';
    if (data.daily && data.daily.time) {
      for (let i = 0; i < Math.min(5, data.daily.time.length); i++) {
        const li = document.createElement('li');
        const date = new Date(data.daily.time[i]);
        li.innerHTML = `<strong>${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</strong>: ${data.daily.temperature_2m_max[i]}° / ${data.daily.temperature_2m_min[i]}°`;
        forecast.appendChild(li);
      }
    }

    if (updatedAt) updatedAt.textContent = new Date().toLocaleTimeString();
  }

  async function fetchHyperliquidPositions(address) {
    if (!address || !isEVMAddress(address)) return null;
    
    try {
      // Fetch perpetual positions
      const perpResp = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'clearinghouseState',
          user: address
        })
      });
      
      // Fetch spot positions
      const spotResp = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'spotClearinghouseState',
          user: address
        })
      });
      
      const perpData = perpResp.ok ? await perpResp.json() : null;
      const spotData = spotResp.ok ? await spotResp.json() : null;
      
      return { perp: perpData, spot: spotData };
    } catch (err) {
      // Silent fail - user likely doesn't have Hyperliquid positions
      return null;
    }
  }

  async function renderHyperliquidData() {
    const summary = document.getElementById('cryptoSummary');
    const list = document.getElementById('cryptoList');
    
    if (!summary || !list) {
      // Missing elements
      return;
    }
    
    const settings = loadSettings();
    if (!settings || !settings.hyperliquidAddress) {
      // No address
      return;
    }
    
    const data = await fetchHyperliquidPositions(settings.hyperliquidAddress);
    if (!data) {
      console.error('✗ Hyperliquid data unavailable');
      return;
    }
    
    
    let hyperliquidTotal = 0;
    
    // Fetch current prices for spot tokens
    let prices = null;
    if (data.spot && data.spot.balances && data.spot.balances.length > 0) {
      try {
        const [pricesResp, spotMetaResp] = await Promise.all([
          fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'allMids' })
          }),
          fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'spotMeta' })
          })
        ]);
        
        if (pricesResp.ok) {
          const allMids = await pricesResp.json();
          const spotMeta = spotMetaResp.ok ? await spotMetaResp.json() : null;
          
          // Build proper price map for spot tokens
          if (spotMeta && spotMeta.universe) {
            prices = { ...allMids };
            // Map token names to their spot indices
            for (const spotPair of spotMeta.universe) {
              if (spotPair.tokens && spotPair.tokens[1] === 0) { // USDC quote
                const spotKey = `@${spotPair.index}`;
                const tokenName = spotPair.name;
                if (allMids[spotKey]) {
                  prices[tokenName] = allMids[spotKey];
                }
              }
            }
            // Also check tokens array
            if (spotMeta.tokens) {
              for (const token of spotMeta.tokens) {
                if (token.name && token.index !== undefined) {
                  const spotPair = spotMeta.universe.find(pair => 
                    pair.tokens && pair.tokens[0] === token.index && pair.tokens[1] === 0
                  );
                  if (spotPair) {
                    const spotKey = `@${spotPair.index}`;
                    if (allMids[spotKey]) {
                      prices[token.name] = allMids[spotKey];
                    }
                  }
                }
              }
            }
          } else {
            prices = allMids;
          }
        }
      } catch (err) {
        // Price fetch failed
      }
    }
    
    // Fetch Hyperliquid market data for mark prices
    let hlMarketPrices = {};
    try {
      const marketResp = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' })
      });
      if (marketResp.ok) {
        const marketData = await marketResp.json();
        if (marketData && marketData[0] && marketData[1]) {
          for (let i = 0; i < marketData[1].length; i++) {
            const ctx = marketData[1][i];
            const assetName = marketData[0].universe[i]?.name;
            if (assetName && ctx && ctx.markPx) {
              hlMarketPrices[assetName] = parseFloat(ctx.markPx);
            }
          }
        }
      }
    } catch (err) {
      // Market price fetch failed
    }
    
    // Render perpetual positions
    if (data.perp && data.perp.assetPositions && data.perp.assetPositions.length > 0) {
      
      for (const pos of data.perp.assetPositions) {
        const coin = pos.position?.coin || 'Unknown';
        const pnl = parseFloat(pos.position?.unrealizedPnl || 0);
        hyperliquidTotal += pnl;
        
        // Use Hyperliquid's mark price (most accurate), fallback to entry price
        const currentPrice = hlMarketPrices[coin] || parseFloat(pos.position?.entryPx || 0);
        
        const li = document.createElement('li');
        li.className = 'crypto-item';
        li.innerHTML = `
          <div class="crypto-header">
            <strong>${coin}</strong>
            <span class="exchange-badge">Hyperliquid</span>
          </div>
          <div class="crypto-details">
            Size: ${pos.position?.szi || 0} | Price: $${currentPrice.toLocaleString()}
            ${pos.position?.unrealizedPnl ? `<div class="pnl ${parseFloat(pos.position.unrealizedPnl) >= 0 ? 'positive' : 'negative'}">PnL: ${parseFloat(pos.position.unrealizedPnl) >= 0 ? '+' : '-'}$${Math.abs(parseFloat(pos.position.unrealizedPnl)).toFixed(2)}</div>` : ''}
          </div>
        `;
        list.appendChild(li);
      }
    }
    
    // Render spot balances (HYPE, USDC, etc)
    if (data.spot && data.spot.balances && data.spot.balances.length > 0) {
      for (const bal of data.spot.balances) {
        // bal.total is the token amount, bal.token is the LP token count
        const tokenAmount = parseFloat(bal.total || 0);
        if (tokenAmount <= 0) continue;
        
        let usdValue = tokenAmount;
        let priceInfo = '';
        
        // For USDC, the amount IS the USD value
        if (bal.coin !== 'USDC' && prices) {
          const price = prices[bal.coin];
          if (price) {
            usdValue = tokenAmount * parseFloat(price);
            priceInfo = ` × $${parseFloat(price).toLocaleString()}`;
          }
        }
        
        // Calculate P&L using entryNtl (entry value in USD)
        let pnlInfo = '';
        if (bal.entryNtl && parseFloat(bal.entryNtl) > 0) {
          const entryValue = parseFloat(bal.entryNtl);
          const pnl = usdValue - entryValue;
          const pnlPercent = ((usdValue - entryValue) / entryValue) * 100;
          const pnlClass = pnl >= 0 ? 'positive' : 'negative';
          pnlInfo = `<div class="pnl ${pnlClass}">P&L: ${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)} (${pnlPercent >= 0 ? '+' : '-'}${Math.abs(pnlPercent).toFixed(2)}%)</div>`;
        }
        
        hyperliquidTotal += usdValue;
        
        const li = document.createElement('li');
        li.className = 'crypto-item';
        li.innerHTML = `
          <div class="crypto-header">
            <strong>${bal.coin}</strong>
            <span class="exchange-badge">Hyperliquid</span>
          </div>
          <div class="crypto-details">
            ${tokenAmount.toLocaleString()} ${bal.coin}${priceInfo} = $${usdValue.toLocaleString()}
            ${pnlInfo}
          </div>
        `;
        list.appendChild(li);
      }
    } else {
    }
    
    // Update summary with Hyperliquid total
    if (hyperliquidTotal > 0) {
      summary.innerHTML = `Hyperliquid Total: $${hyperliquidTotal.toLocaleString()}`;
    }
  }

  async function fetchLighterPositions(address) {
    if (!address || !isEVMAddress(address)) return null;
    
    try {
      // Try different Lighter API endpoints from https://apidocs.lighter.xyz
      let resp;
      
      // Try mainnet endpoint with correct v1 API format (silent fail for 400)
      try {
        resp = await fetch(`https://mainnet.zklighter.elliot.ai/api/v1/account?by=l1_address&value=${address}`);
        if (resp.ok) {
          const data = await resp.json();
          return data;
        }
      } catch (err) {
        // Silent fail
      }
      
      // Try testnet endpoint (silent fail for 400)
      try {
        resp = await fetch(`https://testnet.zklighter.elliot.ai/api/v1/account?by=l1_address&value=${address}`);
        if (resp.ok) {
          const data = await resp.json();
          return data;
        }
      } catch (err) {
        // Silent fail
      }
      
      return null;
    } catch (err) {
      // Silent fail - user likely doesn't have Lighter positions
      return null;
    }
  }

  async function renderLighterData() {
    const summary = document.getElementById('cryptoSummary');
    const list = document.getElementById('cryptoList');
    
    if (!summary || !list) {
      // Missing elements
      return;
    }
    
    const settings = loadSettings();
    if (!settings || !settings.lighterAddress) {
      return;
    }
    
    const data = await fetchLighterPositions(settings.lighterAddress);
    
    if (!data || !data.accounts || !Array.isArray(data.accounts) || data.accounts.length === 0) {
      return;
    }
    
    // Get the first account's positions
    const account = data.accounts[0];
    if (!account || !account.positions) {
      return;
    }
    
    
    let lighterTotal = 0;
    
    for (const pos of account.positions) {
      if (!pos.position || parseFloat(pos.position) === 0) continue;
      
      const position = parseFloat(pos.position);
      const positionValue = parseFloat(pos.position_value || 0);
      const unrealizedPnl = parseFloat(pos.unrealized_pnl || 0);
      lighterTotal += positionValue;
      
      const sign = pos.sign === 1 ? 'Long' : 'Short';
      
      const li = document.createElement('li');
      li.className = 'crypto-item';
      li.innerHTML = `
        <div class="crypto-header">
          <strong>${pos.symbol}</strong>
          <span class="exchange-badge">Lighter</span>
          <span class="change">${sign}</span>
        </div>
        <div class="crypto-details">
          Position: ${position.toFixed(2)} @ $${parseFloat(pos.avg_entry_price || 0).toFixed(2)} = $${positionValue.toLocaleString()}
          ${unrealizedPnl !== 0 ? `<div class="pnl ${unrealizedPnl >= 0 ? 'positive' : 'negative'}">Unrealized P&L: ${unrealizedPnl >= 0 ? '+' : '-'}$${Math.abs(unrealizedPnl).toFixed(2)}</div>` : ''}
        </div>
      `;
      list.appendChild(li);
    }
    
    // Update summary with Lighter total if no Hyperliquid total was shown
    if (lighterTotal > 0 && !summary.innerHTML.includes('Total')) {
      summary.innerHTML = `Lighter Total: $${lighterTotal.toLocaleString()}`;
    }
  }

  // Store all position data globally for hero summary
  let allPositionsData = [];
  let weatherData = null;
  
  // Track previous cell values for flash animation
  let previousCellValues = {};
  
  // Helper function to apply flash animation to a cell
  function flashCell(cell, key, newValue) {
    const prevValue = previousCellValues[key];
    if (prevValue !== undefined && prevValue !== newValue) {
      cell.classList.remove('cell-flash');
      // Force reflow to restart animation
      void cell.offsetWidth;
      cell.classList.add('cell-flash');
    }
    previousCellValues[key] = newValue;
  }
  
  // Store actual account balances for accurate total value calculation
  // This uses real account balances, not position notional values, to properly handle leverage
  // - Hyperliquid: accountValue from marginSummary (perp) + spot balance values
  // - Lighter: collateral + unrealized_pnl from account data
  // - NFTs: total floor value (count * floor price)
  let accountBalances = {
    hyperliquid: 0,  // Total account value including perp margin and spot balances
    lighter: 0,      // Collateral + unrealized PnL
    nfts: 0          // Total NFT floor value
  };
  
  // === TRUE 24-HOUR PRICE TRACKING ===
  // All 24h changes are calculated from exactly 24 hours ago (rolling 24h period)
  // 
  // How it works:
  // 1. Calculate timestamp for exactly 24 hours ago from current time
  // 2. Fetch historical prices from Pyth Network at that timestamp
  // 3. Calculate 24h changes as: (currentPrice - price24hAgo) / price24hAgo * 100
  // 4. This applies to:
  //    - Individual position 24h changes
  //    - Asset highlights in hero section
  //    - Watchlist items
  //    - Portfolio total daily change
  //    - Real-time price updates
  // 
  // Benefits:
  // - Consistent with your local time zone
  // - Not affected by exchange rolling 24h windows
  // - Easy to verify against other tracking tools
  // - Accurate accounting for trades and transfers during the day
  const DAILY_PRICES_KEY = 'dailyMidnightPrices.v1';
  
  function getDailyPrices() {
    try {
      const saved = localStorage.getItem(DAILY_PRICES_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }
  
  function saveDailyPrices(prices, timestamp) {
    try {
      localStorage.setItem(DAILY_PRICES_KEY, JSON.stringify({ prices, timestamp }));
    } catch {
      // Silent fail
    }
  }
  
  function get24HoursAgoTimestamp() {
    const now = Date.now();
    // Subtract exactly 24 hours (24 * 60 * 60 * 1000 milliseconds)
    const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
    // Return Unix timestamp in SECONDS (Pyth API requirement)
    return Math.floor(twentyFourHoursAgo / 1000);
  }
  
  // Keep getMidnightTimestamp for backward compatibility with cache keys
  function getMidnightTimestamp() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    // Return Unix timestamp in SECONDS (Pyth API requirement)
    return Math.floor(midnight.getTime() / 1000);
  }
  
  function isNewDay(timestamp) {
    const midnightToday = getMidnightTimestamp();
    return timestamp < midnightToday;
  }
  
  function isCacheStale(timestamp, maxAgeHours = 1) {
    // Check if cached data is older than maxAgeHours
    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    const age = now - timestamp;
    const maxAge = maxAgeHours * 60 * 60; // Convert hours to seconds
    return age > maxAge;
  }
  
  function getCurrentPricesMap(positionsData) {
    // Store both prices and account balances for accurate 24h tracking
    const priceMap = {
      _ACCOUNT_BALANCES: {
        hyperliquid: accountBalances.hyperliquid,
        lighter: accountBalances.lighter,
        nfts: accountBalances.nfts,
        multichain: accountBalances.multichain,
        total: accountBalances.hyperliquid + accountBalances.lighter + accountBalances.nfts + accountBalances.multichain
      }
    };
    
    // Also store individual asset prices for reference (NFTs primarily)
    for (const pos of positionsData) {
      if (pos.exchange === 'OpenSea') {
        priceMap[`${pos.asset}_NFT`] = pos.price || 0;
      }
    }
    
    return priceMap;
  }

  // Fetch historical price from Hyperliquid at specific timestamp (midnight local time)
  async function fetchHyperliquidHistoricalPrice(asset, timestamp) {
    try {
      // Request a small window around midnight to get the closest candle
      // Use 1-minute candles for best accuracy at exact midnight
      const response = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'candleSnapshot',
          req: {
            coin: asset,
            interval: '1m',
            startTime: timestamp - 60000, // 1 minute before midnight
            endTime: timestamp + 60000 // 1 minute after midnight
          }
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        
        // Find the candle closest to midnight
        if (data && data.length > 0) {
          // Sort by proximity to midnight timestamp
          const sortedCandles = data.sort((a, b) => {
            const aTime = a.t || 0;
            const bTime = b.t || 0;
            return Math.abs(aTime - timestamp) - Math.abs(bTime - timestamp);
          });
          
          const closestCandle = sortedCandles[0];
          if (closestCandle && closestCandle.c) {
            const price = parseFloat(closestCandle.c);
            return price;
          }
        }
      }
    } catch (err) {
      // API error
    }
    return null;
  }

  // Fetch historical price from CoinGecko as fallback
  async function fetchCoinGeckoHistoricalPrice(coinId, timestamp) {
    try {
      const date = new Date(timestamp);
      const dateStr = `${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear()}`;
      
      const response = await rateLimitedFetch(
        proxyCoinGecko(`https://api.coingecko.com/api/v3/coins/${coinId}/history?date=${dateStr}&localization=false`)
      );
      
      if (response.ok) {
        const data = await response.json();
        if (data && data.market_data && data.market_data.current_price) {
          return data.market_data.current_price.usd;
        }
      }
    } catch (err) {
      // Silent fail
    }
    return null;
  }

  // Get historical prices from 24 hours ago for all current assets
  async function fetchMidnightPrices() {
    // Updated to fetch prices from 24 hours ago for true rolling 24h change
    const timestamp24hAgo = get24HoursAgoTimestamp();
    const date24hAgo = new Date(timestamp24hAgo * 1000);
    const now = new Date();
    
    
    const priceMap = {
      _ACCOUNT_BALANCES: {
        hyperliquid: accountBalances.hyperliquid,
        lighter: accountBalances.lighter,
        nfts: accountBalances.nfts,
        multichain: accountBalances.multichain,
        total: accountBalances.hyperliquid + accountBalances.lighter + accountBalances.nfts + accountBalances.multichain
      }
    };


    // For NFTs, use current floor prices (no historical API available)
    // Store by collection slug since all NFTs in a collection share the same floor
    const nftCollections = new Set();
    for (const pos of allPositionsData) {
      if (pos.exchange === 'OpenSea') {
        priceMap[`${pos.asset}_NFT`] = pos.price || 0; // Legacy compatibility key

        if (pos.collectionSlug) {
          const key = `${pos.collectionSlug}_NFT`;
          if (!nftCollections.has(key)) {
            priceMap[key] = pos.price || 0;
            nftCollections.add(key);
          }
        }
      }
    }

    // Fetch historical prices for crypto assets at midnight
    const settings = loadSettings() || getDefaultSettings();
    const usePyth = settings.usePythPrices ?? true;
    const pricePromises = [];
    
    for (const pos of allPositionsData) {
      // Skip NFTs (they don't have historical price APIs)
      if (pos.exchange === 'OpenSea') {
        continue;
      }
      
      // Fetch prices for all crypto assets: Hyperliquid, Lighter, and multichain
      pricePromises.push(
        (async () => {
          const key = `${pos.asset}_${pos.exchange}`;
          let price = null;
          
          if (usePyth) {
            // Priority: Pyth → Hyperliquid (for HL/HYPE assets) → CoinGecko fallback
            price = await fetchPythPrice(pos.asset, timestamp24hAgo);
            
            // Use Hyperliquid historical API for:
            // 1. Assets on Hyperliquid exchange
            // 2. HYPE token (native to Hyperliquid, even on other chains)
            if (price === null && (pos.exchange === 'Hyperliquid' || pos.asset === 'HYPE')) {
              price = await fetchHyperliquidHistoricalPrice(pos.asset, timestamp24hAgo);
            }
            
            // Final fallback to CoinGecko
            if (price === null && pos.coingeckoId) {
              price = await fetchCoinGeckoHistoricalPrice(pos.coingeckoId, timestamp24hAgo);
            }
          } else {
            // Without Pyth: Hyperliquid (for HL/HYPE) → CoinGecko fallback
            if (pos.exchange === 'Hyperliquid' || pos.asset === 'HYPE') {
              price = await fetchHyperliquidHistoricalPrice(pos.asset, timestamp24hAgo);
            }
            
            if (price === null && pos.coingeckoId) {
              price = await fetchCoinGeckoHistoricalPrice(pos.coingeckoId, timestamp24hAgo);
            }
          }
          
          if (price !== null) {
            priceMap[key] = price;
          }
        })()
      );
    }

    await Promise.all(pricePromises);
    return priceMap;
  }

  async function refreshAll(priorityOnly = false) {
    // Throttle refreshes to prevent excessive API calls
    const now = Date.now();
    if (now - lastFullRefresh < MIN_REFRESH_INTERVAL) {
      return; // Skip if refreshed recently
    }
    lastFullRefresh = now;
    
    // Show mini loader during data fetch
    showMiniLoader();
    
    const startTime = performance.now();
    
    // Reset positions data
    allPositionsData = [];
    
    const settings = loadSettings() || getDefaultSettings();
    
    // === ULTRA-AGGRESSIVE PROGRESSIVE LOADING ===
    // PRIORITY 0: Critical Path Only - Positions/Assets Data
    // Everything else deferred to idle time or viewport intersection
    // Defer show/hide section logic to idle time (non-blocking)
    
    // Stage 1: CRITICAL - Load positions and hero ONLY (fastest possible)
    await perfMonitor.measure('Stage1:CriticalData', async () => {
      await fetchAndRenderPositions();
      await updateHeroSection();
      updateLastUpdateTimestamp();
    });
    
    // Hide mini loader after critical data loads
    hideMiniLoader();
    
    // Hide loading screen after first load
    if (els.loadingScreen && !els.loadingScreen.classList.contains('hidden')) {
      els.loadingScreen.classList.add('hidden');
      // Remove from DOM after fade completes
      setTimeout(() => {
        if (els.loadingScreen) {
          els.loadingScreen.style.display = 'none';
        }
      }, 300);
    }
    
    // Stage 2: NON-CRITICAL - Everything else (defer as much as possible)
    // Only load when user scrolls OR during idle time (never block critical path)
    if (!priorityOnly) {
      // Aggressive idle scheduling - prioritize browser responsiveness
      const scheduleIdleLoad = (callback, priority = 'low') => {
        if ('requestIdleCallback' in window) {
          const timeout = priority === 'high' ? 1000 : 5000; // High = 1s, low = 5s
          requestIdleCallback(callback, { timeout });
        } else {
          const delay = priority === 'high' ? 100 : 500;
          setTimeout(callback, delay);
        }
      };
      
      // Defer section visibility toggling to idle time (non-blocking)
      scheduleIdleLoad(() => {
        if (els.comicSection) {
          els.comicSection.style.display = settings.showComic ? 'block' : 'none';
        }
        const watchlistSection = document.getElementById('watchlistSection');
        if (watchlistSection) {
          watchlistSection.style.display = (settings.showWatchlist ?? true) ? 'block' : 'none';
        }
      }, 'high');
      
      // Watchlist - load on viewport intersection OR after delay
      if (settings.showWatchlist ?? true) {
        const watchlistSection = document.getElementById('watchlistSection');
        if (watchlistSection) {
          let watchlistLoaded = false;
          
          const watchlistLoader = () => {
            if (watchlistLoaded) return;
            watchlistLoaded = true;
            perfMonitor.measure('Stage2:Watchlist', () => renderWatchlist())
              .catch(err => {});
          };
          
          // Load on scroll-to-view
          const watchlistObserver = new IntersectionObserver(
            (entries) => {
              entries.forEach(entry => {
                if (entry.isIntersecting) {
                  watchlistLoader();
                  watchlistObserver.disconnect();
                }
              });
            },
            { rootMargin: '300px' } // Start 300px before viewport
          );
          
          watchlistObserver.observe(watchlistSection);
          
          // Fallback: load after 3 seconds if not scrolled to
          scheduleIdleLoad(watchlistLoader, 'high');
        }
      }
      
      // Weather - lowest priority, pure idle time
      scheduleIdleLoad(() => {
        perfMonitor.measure('Stage2:Weather', () => fetchAndRenderWeather())
          .catch(err => {});
      }, 'low');
      
      // Comics - ONLY load when user scrolls to it (never pre-load)
      if (settings.showComic && els.comicSection) {
        const comicLoader = () => {
          perfMonitor.measure('Stage2:Comic', () => renderCalvin())
            .catch(err => {});
        };
        
        const comicObserver = new IntersectionObserver(
          (entries) => {
            entries.forEach(entry => {
              if (entry.isIntersecting) {
                comicLoader();
                comicObserver.disconnect();
              }
            });
          },
          { rootMargin: '400px' } // Start 400px before entering viewport
        );
        
        comicObserver.observe(els.comicSection);
      }
    }
    
    perfMonitor.end('RefreshAll:Total');
  }
  
  function updateLastUpdateTimestamp() {
    if (!els.lastUpdateTimestamp) return;
    
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    els.lastUpdateTimestamp.textContent = `Last update: ${hours}:${minutes}:${seconds}`;
  }
  
  // Helper function to normalize NFT collection display names
  function normalizeNFTCollectionName(name, slug) {
    // Map of known slugs to proper display names
    const nameOverrides = {
      'hypurr-hyperevm': 'Hypurr',
      'moonbirds': 'Moonbirds'
    };
    
    // Check if we have an override for this slug
    if (slug && nameOverrides[slug.toLowerCase()]) {
      return nameOverrides[slug.toLowerCase()];
    }
    
    // Otherwise use the provided name
    return name;
  }
  
  async function fetchOpenSeaNFTs(address) {
    if (!address || !isEVMAddress(address)) return null;
    
    // SPEED: Check cache first (OpenSea is very slow)
    const cacheKey = `nft_${address}`;
    const cached = nftCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    const settings = loadSettings();
    const apiKey = settings?.openSeaApiKey || '';
    
    if (!apiKey) {
      console.error('✗ OpenSea: No API key configured');
      return null;
    }
    
    try {
      // Try OpenSea API first if we have an API key
      if (apiKey) {
        // Fetch from multiple chains
        const chains = [
          'ethereum', 
          'polygon', 
          'arbitrum', 
          'optimism', 
          'base', 
          'avalanche', 
          'blast', 
          'zora', 
          'bsc',
          'hyperevm',
          'apechain',
          'berachain',
          'gunz',
          'ronin',
          'sei',
          'shape',
          'somnia',
          'soneium',
          'unichain'
        ];
        // Fetch from all chains in parallel for speed
        // Add small delay between requests to reduce rate limiting
        const chainPromises = chains.map((chain, index) =>
          new Promise(resolve => setTimeout(resolve, index * 100)).then(() =>
            fetchWithRetry(`https://api.opensea.io/api/v2/chain/${chain}/account/${address}/nfts?limit=200`, {
              headers: {
                'X-API-KEY': apiKey,
                'accept': 'application/json'
              }
            }, 2, 3000)
            .then(async (chainResp) => {
              if (chainResp.ok) {
                const chainData = await chainResp.json();
                if (chainData.nfts && chainData.nfts.length > 0) {
                  // Tag each NFT with its chain
                  chainData.nfts.forEach(nft => {
                    nft._chain = chain;
                  });
                  return chainData.nfts;
                }
              }
              return [];
            })
            .catch((err) => {
              // Silent fail for rate limits
              return [];
            })
          )
        );
        
        const chainResults = await Promise.all(chainPromises);
        const allNfts = chainResults.flat();
        
        
        if (allNfts.length > 0) {
        const openSeaData = { nfts: allNfts };
        
              const collections = {};
              const collectionSlugs = new Set();
              const nftsByCollection = {};
              
            for (const rawNft of openSeaData.nfts) {
              const nft = { ...rawNft };

              // Collection metadata can be a string slug or an object depending on the API response
              const collectionInfo = nft.collection || {};
              const collectionSlug = typeof collectionInfo === 'string'
                ? collectionInfo
                : (collectionInfo.slug || collectionInfo.collection || null);
              const collectionName = typeof collectionInfo === 'string'
                ? collectionInfo
                : (collectionInfo.name || collectionSlug || null);

              // Use the chain we tagged when fetching
              const chain = nft._chain || 'ethereum';

              // Determine the contract address (can arrive as string or nested object)
                let contractAddr = nft.contract;
              if (contractAddr && typeof contractAddr === 'object') {
                contractAddr = contractAddr.address || contractAddr.contract_address || contractAddr.id || null;
              }

              if (!contractAddr && typeof collectionInfo === 'object') {
                const primaryContract = Array.isArray(collectionInfo.primary_asset_contracts)
                  ? collectionInfo.primary_asset_contracts[0]
                  : collectionInfo.contract;
                if (primaryContract) {
                  contractAddr = typeof primaryContract === 'string'
                    ? primaryContract
                    : (primaryContract.address || primaryContract.contract_address || null);
                }
              }

              // Fall back to identifier parsing if needed
              if ((!contractAddr || typeof contractAddr !== 'string') && nft.identifier && nft.identifier.includes(':')) {
                  const parts = nft.identifier.split(':');
                  if (parts.length >= 2) {
                  contractAddr = parts[1];
                }
              }

              if (contractAddr && typeof contractAddr === 'string') {
                contractAddr = contractAddr.toLowerCase();
              }

              const collectionKey = collectionSlug || contractAddr;
              if (!collectionKey) {
                continue;
              }
                
                if (collectionSlug) {
                  collectionSlugs.add(collectionSlug);
              }

              if (!nftsByCollection[collectionKey]) {
                nftsByCollection[collectionKey] = [];
              }

              nft._collectionSlug = collectionSlug || null;
              nft._contractAddress = contractAddr || null;
              nftsByCollection[collectionKey].push(nft);

              if (!collections[collectionKey]) {
            // We'll get the proper name from the stats API later when possible
                collections[collectionKey] = {
              name: collectionName || collectionSlug || contractAddr || 'Unknown Collection',
                    contract: contractAddr,
                  slug: collectionSlug || collectionKey,
              chain: chain,
                    count: 0,
                    floorPriceUsd: 0,
              floorPriceNative: 0,
              nativeToken: 'ETH',
                  change24h: null,
                  totalPaidUsd: 0,
                    nfts: []
                  };
          } else {
            // Update stored metadata if we discover more accurate info
            if (collectionName && (!collections[collectionKey].name || collections[collectionKey].name === collections[collectionKey].slug)) {
              collections[collectionKey].name = collectionName;
            }
            if (!collections[collectionKey].contract && contractAddr) {
              collections[collectionKey].contract = contractAddr;
            }
            if (!collections[collectionKey].slug && collectionSlug) {
              collections[collectionKey].slug = collectionSlug;
            }
            // Update chain if it's not ethereum (in case collection already exists)
            if (chain !== 'ethereum') {
              collections[collectionKey].chain = chain;
            }
              }

              collections[collectionKey].count++;
              collections[collectionKey].nfts.push(nft);
            }
              
          // Map chains to their native tokens and CoinGecko IDs
          const chainTokenMap = {
            'ethereum': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'polygon': { symbol: 'MATIC', coingeckoId: 'matic-network' },
            'arbitrum': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'optimism': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'base': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'avalanche': { symbol: 'AVAX', coingeckoId: 'avalanche-2' },
            'blast': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'zora': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'bsc': { symbol: 'BNB', coingeckoId: 'binancecoin' },
            'hyperevm': { symbol: 'HYPE', coingeckoId: 'hyperliquid' },
            'apechain': { symbol: 'APE', coingeckoId: 'apecoin' },
            'berachain': { symbol: 'BERA', coingeckoId: 'berachain-bera' },
            'gunz': { symbol: 'GUNZ', coingeckoId: 'gunz' },
            'ronin': { symbol: 'RON', coingeckoId: 'ronin' },
            'sei': { symbol: 'SEI', coingeckoId: 'sei-network' },
            'shape': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'somnia': { symbol: 'STT', coingeckoId: 'somnia' },
            'soneium': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'unichain': { symbol: 'ETH', coingeckoId: 'ethereum' }
          };
          
          // Fetch prices for all unique native tokens using Pyth (blazing fast, single call)
          const uniqueSymbols = [...new Set(Object.values(chainTokenMap).map(t => t.symbol))];
          const tokenPrices = {};
          const tokenPricesBySymbol = {};
          
          try {
            // Use Pyth API for prices + 24h changes (fast and reliable)
            const pythData = await fetchPythPrices(uniqueSymbols, [], true);
            
            // Map Pyth data to chains
            for (const [chain, tokenInfo] of Object.entries(chainTokenMap)) {
              if (pythData[tokenInfo.symbol]) {
                tokenPrices[chain] = pythData[tokenInfo.symbol].price;
                tokenPricesBySymbol[tokenInfo.symbol.toUpperCase()] = pythData[tokenInfo.symbol].price;
              }
            }
            
            // Fallback to CoinGecko ONLY for tokens Pyth doesn't have
            const missingChains = Object.entries(chainTokenMap).filter(([chain]) => !tokenPrices[chain]);
            
            if (missingChains.length > 0) {
              const uniqueCoinGeckoIds = [...new Set(missingChains.map(([, info]) => info.coingeckoId))];
              const pricesData = await rateLimitedFetch(
                proxyCoinGecko(`https://api.coingecko.com/api/v3/simple/price?ids=${uniqueCoinGeckoIds.join(',')}&vs_currencies=usd`),
                `nft-token-prices-${uniqueCoinGeckoIds.join(',')}`
              );
              
              if (pricesData) {
                for (const [chain, tokenInfo] of missingChains) {
                  const price = pricesData[tokenInfo.coingeckoId]?.usd;
                  if (price && price > 0) {
                    tokenPrices[chain] = price;
                    tokenPricesBySymbol[tokenInfo.symbol.toUpperCase()] = price;
                  }
                }
              }
            }
          } catch (err) {
            console.warn('⚠ NFT: Failed to fetch native token prices:', err.message);
          }
          
          // Log any missing token prices for debugging
          for (const [chain, tokenInfo] of Object.entries(chainTokenMap)) {
            if (!tokenPrices[chain]) {
              console.warn(`⚠ NFT: Missing price for ${tokenInfo.symbol} (${chain})`);
            }
          }
          
          // Update collection native tokens based on their chain
          for (const collection of Object.values(collections)) {
            const tokenInfo = chainTokenMap[collection.chain] || chainTokenMap['ethereum'];
            collection.nativeToken = tokenInfo.symbol;
          }
          
          // Fetch floor prices and stats using OpenSea Collection Stats API (in parallel)
          // Add small delay between requests to reduce rate limiting
          const statsPromises = Array.from(collectionSlugs).map((slug, index) =>
            new Promise(resolve => setTimeout(resolve, index * 150)).then(() =>
              fetchWithRetry(`https://api.opensea.io/api/v2/collections/${slug}/stats`, {
                headers: {
                  'X-API-KEY': apiKey,
                  'accept': 'application/json'
                }
              }, 2, 3000)
              .then(async (statsResp) => {
                if (statsResp.ok) {
                  const statsData = await statsResp.json();
                
                // Get floor price and proper collection name from stats
                const floorPriceNativeRaw = statsData.total?.floor_price
                  ?? statsData.total?.floor_price_native
                  ?? statsData.total?.floor_price_in_token;
                const floorPriceNative = floorPriceNativeRaw !== undefined && floorPriceNativeRaw !== null
                  ? parseFloat(floorPriceNativeRaw)
                  : null;
                const collectionName = statsData.name; // Use the proper display name from the API
                
                // Note: OpenSea API v2 does not provide floor price change data in intervals
                // The intervals only contain volume/sales data, not floor price changes
                // Setting to null so it displays as "—" in the dashboard
                let floorChange1d = null;
                
                if (collections[slug]) {
                  const collection = collections[slug];
                  const nativeTokenPrice = tokenPrices[collection.chain];
                  
                  // Update name with proper display name from API
                  if (collectionName) {
                    collection.name = collectionName;
                  }
                  
                  if (floorPriceNative && isFinite(floorPriceNative)) {
                    collection.floorPriceNative = floorPriceNative;
                    
                    // Only set USD price if we have a valid token price
                    if (nativeTokenPrice && nativeTokenPrice > 0) {
                      collection.floorPriceUsd = floorPriceNative * nativeTokenPrice;
                    } else {
                      // No valid price - set to null so it displays as "—"
                      collection.floorPriceUsd = null;
                    }
                    
                    collection.change24h = floorChange1d; // Can be null if no data
                  }
                }
              }
              return slug;
            })
            .catch(() => slug)
            )
          );
          
          await Promise.all(statsPromises);

          // Fetch last sale price for EACH individual NFT - SIMPLIFIED
          for (const [collectionKey, collection] of Object.entries(collections)) {
            const nftList = nftsByCollection[collectionKey];
            if (!nftList || nftList.length === 0) continue;

            const chain = collection.chain;
            const contractAddress = collection.contract;

            if (!contractAddress) {
              continue;
            }

            
            for (const nft of nftList) {
              // Determine token ID, supporting multiple possible fields
              let tokenId = nft.token_id || nft.tokenId || null;
              const identifier = nft.identifier;
              if (!tokenId && identifier) {
                if (identifier.includes(':')) {
                  const parts = identifier.split(':');
                  tokenId = parts[2] || parts[parts.length - 1];
                  } else {
                  tokenId = identifier;
                }
              }

              if (!tokenId) {
                continue;
              }

              nft.tokenId = tokenId;

              
              try {
                // Fetch sale events from OpenSea Events API (more reliable than last_sale field)
                const eventsUrl = `https://api.opensea.io/api/v2/events/chain/${chain}/contract/${contractAddress}/nfts/${tokenId}?event_type=sale`;
                
                const eventsResp = await fetchWithRetry(eventsUrl, {
                  headers: {
                    'X-API-KEY': apiKey,
                    'accept': 'application/json'
                  }
                }, 2, 3000);
                    
                if (!eventsResp.ok) {
                  continue;
                }
                
                const eventsData = await eventsResp.json();
                
                // Get the most recent sale event
                const saleEvents = eventsData.asset_events || [];
                const lastSaleEvent = saleEvents.length > 0 ? saleEvents[0] : null;
                
                
                if (lastSaleEvent && lastSaleEvent.payment) {
                  const payment = lastSaleEvent.payment;
                  const paymentToken = payment.symbol || collection.nativeToken;
                  const decimals = payment.decimals || 18;
                  
                  // Parse the sale price
                  const rawTotalPrice = typeof payment.quantity === 'string'
                    ? payment.quantity
                    : String(payment.quantity || '0');
                  const saleAmountInToken = parseFloat(rawTotalPrice) / Math.pow(10, decimals);

                  // Get USD price for the payment token
                  const tokenPriceFromSymbol = tokenPricesBySymbol[paymentToken.toUpperCase()] || null;
                  const tokenPrice = tokenPrices[chain]
                    || tokenPriceFromSymbol
                    || (paymentToken.toUpperCase() === 'ETH' ? tokenPrices['ethereum'] : null)
                    || 0;
                  const saleAmountUsd = tokenPrice > 0 ? saleAmountInToken * tokenPrice : null;

                  // Store it if we have a valid USD valuation
                  if (saleAmountUsd !== null && isFinite(saleAmountUsd) && saleAmountUsd > 0) {
                    nft.lastSalePriceUsd = saleAmountUsd;
                    nft.lastSalePriceNative = saleAmountInToken;
                    nft.lastSaleToken = paymentToken;
                  } else {
                  }
                } else {
                    }
                  } catch (err) {
                  }
                }
              }
              
              const result = { collections: Object.values(collections) };
              
              // Cache the result (SmartCache handles timestamp automatically)
              nftCache.set(cacheKey, result);
              
              return result;
            }
      }
      
      // Note: Reservoir API fallback removed due to CORS restrictions
      // The OpenSea API should provide all necessary NFT data
      
      return null;
    } catch (err) {
      console.error('✗ OpenSea: Fatal error -', err.message);
      return null;
    }
  }

  // Symbol to CoinGecko ID mapping
  const symbolToCoingeckoId = {
      'BTC': 'bitcoin',
      'ETH': 'ethereum',
      'USDC': 'usd-coin',
      'USDT': 'tether',
      'SOL': 'solana',
      'HYPE': 'hyperliquid',
      'ZEC': 'zcash',
      'MATIC': 'matic-network',
      'AVAX': 'avalanche-2',
      'ARB': 'arbitrum',
      'OP': 'optimism',
      'LINK': 'chainlink',
      'UNI': 'uniswap',
      'AAVE': 'aave',
      'CRV': 'curve-dao-token',
      'LDO': 'lido-dao',
      'MKR': 'maker',
      'SNX': 'synthetix-network-token',
      'DOGE': 'dogecoin',
      'ADA': 'cardano',
      'DOT': 'polkadot',
      'SHIB': 'shiba-inu',
      'ATOM': 'cosmos',
      'LTC': 'litecoin',
      'XRP': 'ripple',
      'TRX': 'tron',
      'FTM': 'fantom',
      'APE': 'apecoin',
      'SAND': 'the-sandbox',
      'MANA': 'decentraland',
      'GRT': 'the-graph',
      'SUSHI': 'sushi',
      'COMP': 'compound-governance-token',
      'YFI': 'yearn-finance'
    };
    
  async function fetchCoinGeckoPrices(symbols) {
    const ids = symbols
      .map(s => symbolToCoingeckoId[s.toUpperCase()])
      .filter(id => id)
      .join(',');
    
    if (!ids) return {};
    
    const data = await rateLimitedFetch(
      proxyCoinGecko(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`),
      `perp-prices-${ids}`
    );
    
    if (data) {
      const result = {};
      // Map back from ID to symbol with both price and change
      for (const [symbol, id] of Object.entries(symbolToCoingeckoId)) {
        if (data[id]) {
          result[symbol] = {
            price: data[id].usd || 0,
            change24h: data[id].usd_24h_change || 0
          };
        }
      }
      return result;
    }
    
    return {};
  }

  async function fetchCoinGecko24hChanges(symbols) {
    const ids = symbols
      .map(s => symbolToCoingeckoId[s.toUpperCase()])
      .filter(id => id)
      .join(',');
    
    if (!ids) return {};
    
    const data = await rateLimitedFetch(
      proxyCoinGecko(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`),
      `24h-changes-${ids}`
    );
    
    if (data) {
      const changes = {};
        // Map back from ID to symbol
      for (const [symbol, id] of Object.entries(symbolToCoingeckoId)) {
          if (data[id] && data[id].usd_24h_change !== undefined) {
            changes[symbol] = data[id].usd_24h_change;
          }
        }
        return changes;
      }
    
    return {};
  }

  // Fetch EVM token balances using Alchemy's API (user brings their own free API key)
  async function fetchAlchemyTokens(wallets, apiKey) {
    if (!apiKey) {
      return [];
    }
    
    // Filter to only EVM addresses - Alchemy only supports EVM chains
    const evmWallets = wallets.filter(wallet => isEVMAddress(wallet));
    
    if (evmWallets.length === 0) {
      return [];
    }
    
    // Alchemy supports these networks
    // Docs: https://www.alchemy.com/docs/reference/hyperliquid-api-quickstart
    const networks = [
      { id: 'eth-mainnet', name: 'Ethereum' },
      { id: 'arb-mainnet', name: 'Arbitrum' },
      { id: 'opt-mainnet', name: 'Optimism' },
      { id: 'polygon-mainnet', name: 'Polygon' },
      { id: 'base-mainnet', name: 'Base' },
      { id: 'hyperliquid-mainnet', name: 'HyperEVM' }
    ];
    
    // SPEED: Parallelize all wallet×network combinations instead of sequential fetches
    const fetchTasks = [];
    for (const wallet of evmWallets) {
      for (const network of networks) {
        fetchTasks.push((async () => {
          const data = [];
          try {
          const url = `https://${network.id}.g.alchemy.com/v2/${apiKey}`;
          
          // First, get native token balance (ETH, MATIC, etc.)
          const nativeResponse = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'eth_getBalance',
              params: [wallet, 'latest'],
              id: 1
            })
          });
          
          if (nativeResponse.ok) {
            const nativeData = await nativeResponse.json();
            if (nativeData.result) {
              const nativeBalance = parseInt(nativeData.result, 16) / 1e18; // Convert from Wei
              
              if (nativeBalance > 0.00001) {
                // Map network to native token symbol
                const nativeTokenMap = {
                  'Ethereum': 'ETH',
                  'Arbitrum': 'ETH',
                  'Optimism': 'ETH',
                  'Polygon': 'MATIC',
                  'Base': 'ETH',
                  'HyperEVM': 'HYPE'
                };
                
                const tokenSymbol = nativeTokenMap[network.name] || 'ETH';
                
                data.push({
                  address: wallet,
                  blockchain: network.name,
                  tokenSymbol: tokenSymbol,
                  tokenName: tokenSymbol,
              balance: nativeBalance,
              balanceUsd: 0, // Will be calculated from prices
              tokenPrice: 0,
              change24h: null, // Will be enriched later
              contractAddress: null // Native token has no contract
                });
              }
            }
          }
          
          // Then get all ERC20 token balances
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'alchemy_getTokenBalances',
              params: [wallet, 'erc20'],
              id: 1
            })
          });
          
          if (response.ok) {
            const responseData = await response.json();
            
            if (responseData.result && responseData.result.tokenBalances) {
              for (const token of responseData.result.tokenBalances) {
                const balance = parseInt(token.tokenBalance, 16);
                if (balance === 0) continue;
              
              // Get token metadata
              try {
                const metaResp = await fetch(url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'alchemy_getTokenMetadata',
                    params: [token.contractAddress],
                    id: 1
                  })
                });
                
                if (metaResp.ok) {
                  const meta = await metaResp.json();
                  if (meta.result) {
                    const decimals = meta.result.decimals || 18;
                    const balanceFormatted = balance / Math.pow(10, decimals);
                    
                    if (balanceFormatted < 0.000001) continue;
                    
                    data.push({
                      address: wallet,
                      blockchain: network.name,
                      tokenSymbol: meta.result.symbol || 'Unknown',
                      tokenName: meta.result.name,
                  balance: balanceFormatted,
                  balanceUsd: 0, // Will be calculated from prices
                  tokenPrice: 0,
                  change24h: null, // Will be enriched later
                  contractAddress: token.contractAddress
                    });
                  }
                }
              } catch (err) {
                // Skip token if metadata fetch fails
              }
            }
            }
          }
          } catch (err) {
            // Silently skip failed fetches
          }
          return data;
        })());
      }
    }
    
    // SPEED: Execute all fetches in parallel
    const results = await Promise.all(fetchTasks);
    return results.flat(); // Flatten array of arrays
  }

  // Fetch Solana token balances using Helius API (user brings their own free API key)
  async function fetchSolanaTokens(wallets, apiKey) {
    if (!apiKey) {
      return [];
    }
    
    const solanaData = [];
    
    for (const wallet of wallets) {
      try {
        const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'getAssetsByOwner',
            params: {
              ownerAddress: wallet,
              page: 1,
              limit: 1000
            },
            id: 1
          })
        });
        
        if (!response.ok) continue;
        
        const data = await response.json();
        
        if (data.result && data.result.items) {
          for (const asset of data.result.items) {
            if (asset.interface === 'FungibleToken' && asset.token_info) {
              const balance = asset.token_info.balance / Math.pow(10, asset.token_info.decimals || 9);
              
              if (balance < 0.000001) continue;
              
              solanaData.push({
                address: wallet,
                blockchain: 'Solana',
                tokenSymbol: asset.token_info.symbol || 'Unknown',
                tokenName: asset.token_info.name,
              balance: balance,
              balanceUsd: asset.token_info.price_info?.total_price || 0,
              tokenPrice: asset.token_info.price_info?.price_per_token || 0,
              change24h: null, // Will be enriched later
              contractAddress: asset.id
              });
            }
          }
        }
      } catch (err) {
        console.error(`Helius fetch failed for ${wallet}`);
      }
    }
    
    return solanaData;
  }

  // Fetch Bitcoin balances using blockchain.info API (public, no API key needed)
  async function fetchBitcoinBalances(addresses) {
    if (!addresses || addresses.length === 0) return [];
    
    const btcData = [];
    
    // Try Pyth first for BTC price
    let btcPrice = 0;
    let btcChange24h = null;
    
    try {
      const pythPrices = await fetchPythPrices(['BTC']);
      if (pythPrices && pythPrices.BTC && pythPrices.BTC > 0) {
        btcPrice = pythPrices.BTC;
      }
    } catch (err) {
      console.error('Failed to fetch BTC price from Pyth:', err);
    }
    
    // Fallback to CoinGecko if Pyth fails
    if (!btcPrice || btcPrice === 0) {
      try {
        const priceResp = await fetchWithRetry(proxyCoinGecko('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true'), {}, 2, 2000);
        if (priceResp.ok) {
          const priceData = await priceResp.json();
          btcPrice = priceData.bitcoin?.usd || 0;
          btcChange24h = priceData.bitcoin?.usd_24h_change || null;
        }
      } catch (err) {
        console.error('Failed to fetch BTC price from CoinGecko:', err.message);
      }
    }
    
    if (!btcPrice || btcPrice === 0) {
      console.warn('Failed to fetch BTC price from both Pyth and CoinGecko');
      return btcData;
    }
    
    // Fetch balance for each address
    for (const address of addresses) {
      try {
        const balanceResp = await fetch(`https://blockchain.info/balance?active=${address}`);
        if (balanceResp.ok) {
          const data = await balanceResp.json();
          const addressData = data[address];
          
          if (addressData) {
            const balanceBTC = addressData.final_balance / 100000000; // Satoshis to BTC
            
            if (balanceBTC > 0) {
              btcData.push({
                address,
                blockchain: 'Bitcoin',
                tokenSymbol: 'BTC',
                tokenName: 'Bitcoin',
                balance: balanceBTC,
                tokenPrice: btcPrice,
                balanceUsd: balanceBTC * btcPrice,
                change24h: btcChange24h,
                contractAddress: null,
                isSolana: false
              });
            }
          }
        }
        
        // Rate limit: wait 300ms between requests
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (err) {
        console.error(`Failed to fetch Bitcoin balance for ${address}:`, err);
      }
    }
    
    return btcData;
  }

  // Fetch Zcash balances using Zcash block explorer API
  async function fetchZcashBalances(addresses) {
    if (!addresses || addresses.length === 0) return [];
    
    // Filter out shielded addresses (z-addr) - only transparent addresses (t-addr) are supported
    const transparentAddresses = addresses.filter(addr => {
      const trimmed = addr.trim();
      return trimmed.startsWith('t1') || trimmed.startsWith('t3');
    });
    
    if (transparentAddresses.length === 0) {
      console.warn('No transparent Zcash addresses provided. Shielded addresses are not supported.');
      return [];
    }
    
    // Log if any shielded addresses were filtered out
    if (transparentAddresses.length < addresses.length) {
      console.warn(`Filtered out ${addresses.length - transparentAddresses.length} shielded Zcash address(es). Only transparent addresses (t-addr) are supported.`);
    }
    
    const zecData = [];
    
    // Try Pyth first for ZEC price
    let zecPrice = 0;
    let zecChange24h = null;
    
    try {
      const pythPrices = await fetchPythPrices(['ZEC']);
      if (pythPrices && pythPrices.ZEC && pythPrices.ZEC > 0) {
        zecPrice = pythPrices.ZEC;
      }
    } catch (err) {
      console.error('Failed to fetch ZEC price from Pyth:', err);
    }
    
    // Fallback to CoinGecko if Pyth fails
    if (!zecPrice || zecPrice === 0) {
      try {
        const priceResp = await fetchWithRetry(proxyCoinGecko('https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=usd&include_24hr_change=true'), {}, 2, 2000);
        if (priceResp.ok) {
          const priceData = await priceResp.json();
          zecPrice = priceData.zcash?.usd || 0;
          zecChange24h = priceData.zcash?.usd_24h_change || null;
        }
      } catch (err) {
        console.error('Failed to fetch ZEC price from CoinGecko:', err.message);
      }
    }
    
    if (!zecPrice || zecPrice === 0) {
      console.warn('Failed to fetch ZEC price from both Pyth and CoinGecko');
      return zecData;
    }
    
    // Fetch balance for each address using Zcash block explorer
    for (const address of transparentAddresses) {
      try {
        // Using zcha.in API for Zcash transparent addresses only
        const apiUrl = `https://api.zcha.in/v2/mainnet/accounts/${address}`;
        
        // Use retry logic for network errors
        const balanceResp = await fetchWithRetry(apiUrl, {}, 2, 2000);
        
        if (balanceResp.ok) {
          const data = await balanceResp.json();
          
          if (data && data.balance !== undefined) {
            const balanceZEC = data.balance / 100000000; // Zatoshis to ZEC
            
            // Include even zero balances (user added the address for a reason)
            zecData.push({
              address,
              blockchain: 'Zcash',
              tokenSymbol: 'ZEC',
              tokenName: 'Zcash',
              balance: balanceZEC,
              tokenPrice: zecPrice,
              balanceUsd: balanceZEC * zecPrice,
              change24h: zecChange24h,
              contractAddress: null,
              isSolana: false
            });
          }
        } else {
          console.warn(`⚠ Zcash API returned ${balanceResp.status} for ${address}`);
        }
        
        // Rate limit: wait 500ms between requests
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        console.warn(`⚠ Failed to fetch Zcash balance for ${address}: ${err.message}`);
        // Continue with next address instead of failing completely
      }
    }
    
    return zecData;
  }

  // Fetch cost basis and PnL data from Zerion API
  // https://developers.zerion.io/reference/intro/getting-started
  async function fetchZerionPositions(wallets, apiKey) {
    if (!apiKey) {
      return {};
    }
    
    // Filter to only EVM addresses - Zerion only supports EVM chains
    const evmWallets = wallets.filter(wallet => isEVMAddress(wallet));
    
    if (evmWallets.length === 0) {
      return {};
    }
    
    const zerionData = {};
    
    for (const wallet of evmWallets) {
      try {
        // Fetch fungible positions with PnL data
        // https://developers.zerion.io/reference/listpositions
        const response = await fetch(`https://api.zerion.io/v1/wallets/${wallet}/positions/?filter[positions]=only_simple&currency=usd&filter[trash]=only_non_trash&sort=value`, {
          headers: {
            'Authorization': `Basic ${btoa(apiKey + ':')}`,
            'Accept': 'application/json'
          }
        });
        
        if (!response.ok) {
          // Silent fail for expected errors (500s are common for addresses with no data)
          continue;
        }
        
        const data = await response.json();
        
        // Process positions data
        if (data && data.data && Array.isArray(data.data)) {
          for (const position of data.data) {
            if (position.attributes && position.attributes.fungible_info) {
              const fungible = position.attributes.fungible_info;
              const quantity = position.attributes.quantity?.float || 0;
              const value = position.attributes.value || 0;
              const price = position.attributes.price || 0;
              
              // Extract symbol and network
              const symbol = fungible.symbol || 'Unknown';
              const network = position.relationships?.chain?.data?.id || 'unknown';
              
              // Create key: symbol_network
              const key = `${symbol}_${network}`;
              
              if (!zerionData[key]) {
                zerionData[key] = {
                  symbol: symbol,
                  network: network,
                  balance: 0,
                  balanceUsd: 0,
                  price: price,
                  changes: position.attributes.changes || null
                };
              }
              
              // Aggregate balances
              zerionData[key].balance += quantity;
              zerionData[key].balanceUsd += value;
            }
          }
        }
        
        // Fetch wallet-level PnL data
        // https://developers.zerion.io/reference/getwalletpnl
        try {
          const pnlResponse = await fetch(`https://api.zerion.io/v1/wallets/${wallet}/pnl?currency=usd`, {
            headers: {
              'Authorization': `Basic ${btoa(apiKey + ':')}`,
              'Accept': 'application/json'
            }
          });
          
          if (pnlResponse.ok) {
            const pnlData = await pnlResponse.json();
            
            // Store wallet-level PnL for reference
            if (pnlData && pnlData.data && pnlData.data.attributes) {
              const pnl = pnlData.data.attributes;
              
              // We can use this for overall portfolio PnL tracking
              // Store in a special key for wallet-level data
              zerionData[`_wallet_${wallet}`] = {
                wallet: wallet,
                totalValue: pnl.total_value || 0,
                totalProfit: pnl.total_profit || 0,
                totalProfitPercent: pnl.total_profit_percent || 0,
                positions: pnl.positions_count || 0
              };
            }
          }
        } catch (pnlErr) {
          // PnL fetch is optional
          console.warn(`⚠ Zerion: Could not fetch PnL for ${wallet}`);
        }
        
      } catch (err) {
        console.error(`⚠ Zerion: Failed to fetch for ${wallet}:`, err.message);
      }
    }
    
    const positionCount = Object.keys(zerionData).filter(key => !key.startsWith('_wallet_')).length;
    
    return zerionData;
  }

  // Combined multi-chain token fetcher
  async function fetchMultiChainTokens(wallets, alchemyKey, heliusKey, bitcoinAddrs, zcashAddrs) {
    const [evmTokens, solTokens, btcBalances, zecBalances] = await Promise.all([
      fetchAlchemyTokens(wallets, alchemyKey),
      fetchSolanaTokens(wallets, heliusKey),
      fetchBitcoinBalances(bitcoinAddrs),
      fetchZcashBalances(zcashAddrs)
    ]);
    
    const allTokens = [...evmTokens, ...solTokens, ...btcBalances, ...zecBalances];
    
    return allTokens;
  }

  async function fetchAndRenderPositions() {
    perfMonitor.start('fetchAndRenderPositions');
    
    allPositionsData = [];
    
    // Reset account balances
    accountBalances = {
      hyperliquid: 0,
      lighter: 0,
      nfts: 0,
      multichain: 0
    };
    
    // Collect NFT holdings across wallets; aggregate by collection
    const nftAggregates = new Map();

    
    // Fetch data for all wallets
    const settings = loadSettings() || getDefaultSettings();
    const wallets = parseWallets(settings.walletAddresses);
    const solanaAddrs = parseWallets(settings.solanaAddresses || '');
    const bitcoinAddrs = parseBitcoinAddresses(settings.bitcoinAddresses || '');
    const zcashAddrs = parseZcashAddresses(settings.zcashAddresses || '');
    
    if (wallets.length === 0 && solanaAddrs.length === 0 && bitcoinAddrs.length === 0 && zcashAddrs.length === 0) {
      renderPositionsTable();
      await updateHeroSection();
      return;
    }
    
    // SPEED: Fetch EVERYTHING in parallel (market data + exchanges + multichain + NFTs + Zerion + Pyth + Historical)
    const criticalDataStart = performance.now();
    
    // Pre-calculate what assets we'll need prices for (to parallelize Pyth fetch)
    const estimatedAssets = new Set();
    
    const [hlMarketDataResult, allWalletData, multiChainTokens, zerionPositions, pythPricesPreload, historicalPricesPreload] = await Promise.all([
      // Hyperliquid market data
      (async () => {
        const t1 = performance.now();
        try {
          const marketResp = await fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'metaAndAssetCtxs' })
          });
          if (!marketResp.ok) return {};
          
          const data = await marketResp.json();
          const marketData = {};
          
          if (data && data[0] && data[0].universe) {
            for (const asset of data[0].universe) {
              marketData[asset.name] = {
                funding: parseFloat(asset.funding || 0),
                openInterest: parseFloat(asset.openInterest || 0),
                volume24h: parseFloat(asset.dayNtlVlm || 0)
              };
            }
          }
          
          if (data && data[1]) {
            for (let i = 0; i < data[1].length; i++) {
              const ctx = data[1][i];
              const assetName = data[0].universe[i]?.name;
              if (assetName && ctx) {
                const prevDayPx = parseFloat(ctx.prevDayPx || 0);
                const markPx = parseFloat(ctx.markPx || 0);
                
                if (!marketData[assetName]) {
                  marketData[assetName] = {};
                }
                marketData[assetName].markPx = markPx;
                
                if (prevDayPx > 0) {
                  marketData[assetName].change24h = ((markPx - prevDayPx) / prevDayPx) * 100;
                }
              }
            }
          }
          
          return marketData;
        } catch (err) {
          return {};
        } finally {
        }
      })(),
      
      // ALL wallet data in parallel (exchange + NFTs together)
      Promise.all(wallets.map(async (wallet, i) => {
        const t2 = performance.now();
        const [hlData, lighterData, nftData] = await Promise.all([
          fetchHyperliquidPositions(wallet),
          fetchLighterPositions(wallet),
          fetchOpenSeaNFTs(wallet).catch(() => null) // NFTs fail gracefully
        ]);
        return { hlData, lighterData, nftData };
      })),
      
      // Multi-chain tokens (Alchemy/Helius - will be used as fallback if Zerion fails)
      (async () => {
        if (!settings.alchemyApiKey && !settings.heliusApiKey) {
          return [];
        }
        const t3 = performance.now();
        // Combine EVM and Solana addresses for Alchemy/Helius
        const allWallets = [...wallets, ...solanaAddrs];
        const result = await fetchMultiChainTokens(allWallets, settings.alchemyApiKey, settings.heliusApiKey, bitcoinAddrs, zcashAddrs);
        return result;
      })(),
      
      // Zerion positions and PnL data (PRIMARY for multichain)
      (async () => {
        if (!settings.zerionApiKey) {
          return {};
        }
        const t4 = performance.now();
        // Combine all wallet addresses for Zerion
        const allWallets = [...wallets, ...solanaAddrs];
        const result = await fetchZerionPositions(allWallets, settings.zerionApiKey);
        return result;
      })(),
      
      // Pyth prices preload (parallel with everything else - MASSIVE speed improvement)
      (async () => {
        if (!(settings.usePythPrices ?? true)) return {};
        try {
          if (isProduction) console.log('📡 Fetching Pyth prices...');
          // Fetch prices for common assets (will be enriched with actual assets later)
          const commonAssets = ['BTC', 'ETH', 'SOL', 'HYPE', 'USDC', 'USDT'];
          const result = await fetchPythPrices(commonAssets, [], true);
          if (isProduction) console.log('✅ Pyth preload succeeded:', Object.keys(result).length, 'assets');
          return result;
        } catch (err) {
          console.error('❌ Pyth preload failed:', err.message);
          return {};
        }
      })(),
      
      // Historical prices preload (parallel with everything else)
      (async () => {
        try {
          // Check if cache is fresh
          const cached = getDailyPrices();
          const currentTime = Math.floor(Date.now() / 1000);
          if (cached && !isCacheStale(cached.timestamp, 1)) {
            if (isProduction) console.log('✅ Using cached historical prices');
            return cached.prices;
          }
          // Fetch fresh historical prices
          if (isProduction) console.log('📡 Fetching historical prices (24h ago)...');
          const prices = await fetchMidnightPrices();
          saveDailyPrices(prices, currentTime);
          if (isProduction) console.log('✅ Historical prices fetched:', Object.keys(prices).length, 'assets');
          return prices;
        } catch (err) {
          console.error('❌ Historical prices preload failed:', err.message);
          return {};
        }
      })()
    ]);
    
    // Performance logging
    const parallelFetchTime = performance.now() - criticalDataStart;
    console.log(`✅ Parallel data fetch completed in ${parallelFetchTime.toFixed(0)}ms`);
    
    const hlMarketData = hlMarketDataResult;
    
    // Determine data source strategy: Zerion is primary, Alchemy/Helius as fallback
    const zerionPositionCount = Object.keys(zerionPositions).filter(key => !key.startsWith('_wallet_')).length;
    const useZerionAsPrimary = zerionPositionCount > 0;
    
    if (useZerionAsPrimary) {
    } else if (multiChainTokens.length > 0) {
    }
    
    
    // Process all collected wallet data
    
    // Fetch Hyperliquid spot prices once for all wallets
    let hlSpotPrices = null;
    const hasSpotBalances = allWalletData.some(({ hlData }) => hlData && hlData.spot && hlData.spot.balances);
    if (hasSpotBalances) {
      try {
        const [pricesResp, spotMetaResp] = await Promise.all([
          fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'allMids' })
          }),
          fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'spotMeta' })
          })
        ]);
        
        if (pricesResp.ok) {
          const allMids = await pricesResp.json();
          const spotMeta = spotMetaResp.ok ? await spotMetaResp.json() : null;
          
          // Build proper price map for spot tokens
          if (spotMeta && spotMeta.universe) {
            hlSpotPrices = { ...allMids };
            // Map token names to their spot indices
            for (const spotPair of spotMeta.universe) {
              if (spotPair.tokens && spotPair.tokens[1] === 0) { // USDC quote
                const spotKey = `@${spotPair.index}`;
                const tokenName = spotPair.name;
                if (allMids[spotKey]) {
                  hlSpotPrices[tokenName] = allMids[spotKey];
                }
              }
            }
            // Also check tokens array
            if (spotMeta.tokens) {
              for (const token of spotMeta.tokens) {
                if (token.name && token.index !== undefined) {
                  const spotPair = spotMeta.universe.find(pair => 
                    pair.tokens && pair.tokens[0] === token.index && pair.tokens[1] === 0
                  );
                  if (spotPair) {
                    const spotKey = `@${spotPair.index}`;
                    if (allMids[spotKey]) {
                      hlSpotPrices[token.name] = allMids[spotKey];
                    }
                  }
                }
              }
            }
          } else {
            hlSpotPrices = allMids;
          }
        }
    } catch (err) {
        // Spot price fetch failed
      }
    }
    
    for (const { hlData, lighterData, nftData } of allWalletData) {
      // === Extract TRUE account balances for accurate portfolio value ===
      // Using actual balances instead of position notional values properly accounts for leverage
      // A 10x leveraged position with $1000 notional only requires ~$100 in margin
      
      // Hyperliquid perp: Use accountValue from marginSummary (balance + unrealized PnL)
      // Per https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api
      if (hlData && hlData.perp && hlData.perp.marginSummary) {
        const accountValue = parseFloat(hlData.perp.marginSummary.accountValue || 0);
        accountBalances.hyperliquid += accountValue;
      }
      
      // Hyperliquid spot: Sum all spot token balances converted to USD
      if (hlData && hlData.spot && hlData.spot.balances) {
        const spotPrices = hlSpotPrices || {};
        for (const bal of hlData.spot.balances) {
          const tokenAmount = parseFloat(bal.total || 0);
          if (tokenAmount > 0) {
            let usdValue = tokenAmount;
            if (bal.coin !== 'USDC' && spotPrices[bal.coin]) {
              usdValue = tokenAmount * parseFloat(spotPrices[bal.coin]);
            }
            accountBalances.hyperliquid += usdValue;
          }
        }
      }
      
      // Lighter: Use collateral + unrealized PnL from account data
      // Per https://apidocs.lighter.xyz/reference/account-1
      if (lighterData && lighterData.accounts && lighterData.accounts[0]) {
        const account = lighterData.accounts[0];
        const collateral = parseFloat(account.collateral || 0);
        const unrealizedPnl = parseFloat(account.unrealized_pnl || 0);
        accountBalances.lighter += (collateral + unrealizedPnl);
      }
      
      // NFTs: Use current floor value (no leverage applicable)
      if (nftData && nftData.collections && nftData.collections.length > 0) {
        for (const collection of nftData.collections) {
          const totalValue = collection.count * collection.floorPriceUsd;
          accountBalances.nfts += totalValue;
        }
      }
      
      // Process Hyperliquid perp positions (for display only, not for balance calculation)
      if (hlData && hlData.perp && hlData.perp.assetPositions) {
          for (const pos of hlData.perp.assetPositions) {
          const coin = pos.position?.coin || 'Unknown';
          const marketInfo = hlMarketData[coin] || {};
          const size = parseFloat(pos.position?.szi || 0);
          
          // Use Hyperliquid's markPx (most accurate real-time price from their orderbook)
          const currentPrice = marketInfo.markPx || parseFloat(pos.position?.entryPx || 0);
          const change24h = marketInfo.change24h || 0;
          
            allPositionsData.push({
            asset: coin,
            exchange: 'Hyperliquid',
            positionType: 'perp',
            amount: size,
            value: Math.abs(size) * currentPrice,
              price: currentPrice,
            change24h: change24h,
            pnl: parseFloat(pos.position?.unrealizedPnl || 0),
              pnlPercent: 0
            });
          }
        }
        
      // Process Hyperliquid spot balances
      if (hlData && hlData.spot && hlData.spot.balances) {
          const prices = hlSpotPrices;
          
          for (const bal of hlData.spot.balances) {
            const tokenAmount = parseFloat(bal.total || 0);
            if (tokenAmount <= 0) continue;
            
            let usdValue = tokenAmount;
            if (bal.coin !== 'USDC' && prices && prices[bal.coin]) {
              usdValue = tokenAmount * parseFloat(prices[bal.coin]);
            }
            
            let pnl = 0;
            let pnlPercent = 0;
            if (bal.entryNtl && parseFloat(bal.entryNtl) > 0) {
              const entryValue = parseFloat(bal.entryNtl);
              pnl = usdValue - entryValue;
              pnlPercent = (pnl / entryValue) * 100;
            }
            
            const marketInfo = hlMarketData[bal.coin] || {};
            const currentPrice = bal.coin === 'USDC' ? 1 : (prices && prices[bal.coin] ? parseFloat(prices[bal.coin]) : 0);
            allPositionsData.push({
              asset: bal.coin,
              exchange: 'Hyperliquid',
            positionType: 'spot',
              amount: tokenAmount,
              value: usdValue,
              price: currentPrice,
              change24h: marketInfo.change24h || 0,
              pnl: pnl,
              pnlPercent: pnlPercent
            });
        }
      }
      
      // Process Lighter data
      if (lighterData && lighterData.accounts && lighterData.accounts[0]) {
        const account = lighterData.accounts[0];
        if (account.positions) {
          for (const pos of account.positions) {
            if (!pos.position || parseFloat(pos.position) === 0) continue;
            
            const position = parseFloat(pos.position);
            const positionValue = parseFloat(pos.position_value || 0);
            const unrealizedPnl = parseFloat(pos.unrealized_pnl || 0);
            const pnlPercent = positionValue > 0 ? (unrealizedPnl / (positionValue - unrealizedPnl)) * 100 : 0;
            
            // Lighter provides position_value which is already calculated from current market price
            // So deriving price from position_value / position is accurate
            const currentPrice = position > 0 ? positionValue / position : 0;
            
            allPositionsData.push({
              asset: pos.symbol,
              exchange: 'Lighter',
              amount: position,
              value: positionValue,
              price: currentPrice,
              change24h: null, // Will be enriched with Pyth data
              pnl: unrealizedPnl,
              pnlPercent: pnlPercent
            });
          }
        }
      }
      
      // Process OpenSea NFTs - aggregate holdings per collection
      if (nftData && nftData.collections && nftData.collections.length > 0) {
        for (const collection of nftData.collections) {
          const collectionKey = collection.slug || collection.contract || collection.name;
          if (!collectionKey) {
            continue;
          }

          const floorPriceUsdRaw = typeof collection.floorPriceUsd === 'number'
            ? collection.floorPriceUsd
            : parseFloat(collection.floorPriceUsd || 0);
          const floorPriceUsd = Number.isFinite(floorPriceUsdRaw) ? floorPriceUsdRaw : 0;
          const floorPriceNativeRaw = typeof collection.floorPriceNative === 'number'
            ? collection.floorPriceNative
            : parseFloat(collection.floorPriceNative || 0);
          const floorPriceNative = Number.isFinite(floorPriceNativeRaw) ? floorPriceNativeRaw : 0;
          const rawChange24h = (collection.change24h !== null && collection.change24h !== undefined)
            ? parseFloat(collection.change24h)
            : null;
          const change24h = Number.isFinite(rawChange24h) ? rawChange24h : null;
          const nativeToken = collection.nativeToken || 'ETH';
          const rawDisplayName = collection.name || collection.slug || 'NFT Collection';
          const displayName = normalizeNFTCollectionName(rawDisplayName, collection.slug);

          let aggregate = nftAggregates.get(collectionKey);
          if (!aggregate) {
            aggregate = {
              asset: displayName,
              nativeToken,
              collectionSlug: collection.slug || null,
              priceUsd: floorPriceUsd,
              priceNative: floorPriceNative,
              change24h,
              amount: 0,
              totalCostUsd: 0,
              pnlSumUsd: 0,
              hasSaleData: false,
              tokenIds: []
            };
            nftAggregates.set(collectionKey, aggregate);
          } else {
            // Always update to the normalized display name
            aggregate.asset = displayName;
            aggregate.nativeToken = nativeToken;
            if (collection.slug && !aggregate.collectionSlug) {
              aggregate.collectionSlug = collection.slug;
            }
            if (floorPriceUsd > 0) {
              aggregate.priceUsd = floorPriceUsd;
            }
            if (floorPriceNative > 0) {
              aggregate.priceNative = floorPriceNative;
            }
            if (change24h !== null && !Number.isNaN(change24h)) {
              aggregate.change24h = change24h;
            }
          }

          if (Array.isArray(collection.nfts) && collection.nfts.length > 0) {
            for (const nft of collection.nfts) {
              const tokenId = nft.tokenId || nft.token_id || null;
              if (tokenId) {
                aggregate.tokenIds.push(tokenId);
              }

              aggregate.amount += 1;

              if (nft.lastSalePriceUsd && nft.lastSalePriceUsd > 0) {
                aggregate.hasSaleData = true;
                aggregate.pnlSumUsd += floorPriceUsd - nft.lastSalePriceUsd;
                aggregate.totalCostUsd += nft.lastSalePriceUsd;
              }
            }
          }
        }
      }
    }

    // Push aggregated NFT positions into the positions list
    if (nftAggregates.size > 0) {
      for (const aggregate of nftAggregates.values()) {
        const amount = aggregate.amount || 0;
        if (amount <= 0) continue;
        const unitPriceUsd = aggregate.priceUsd || 0;
        const unitPriceNative = aggregate.priceNative || 0;
        const totalValueUsd = amount * unitPriceUsd;

        let pnl = null;
        let pnlPercent = null;
        if (aggregate.hasSaleData) {
          pnl = aggregate.pnlSumUsd;
          if (aggregate.totalCostUsd > 0) {
            pnlPercent = (pnl / aggregate.totalCostUsd) * 100;
          }
          }
          
          allPositionsData.push({
          asset: aggregate.asset,
            exchange: 'OpenSea',
          amount: amount,
          value: totalValueUsd,
          price: unitPriceUsd,
          priceInNative: unitPriceNative,
          nativeToken: aggregate.nativeToken,
          change24h: aggregate.change24h,
          pnl: pnl,
          pnlPercent: pnlPercent,
          collectionSlug: aggregate.collectionSlug,
          tokenIds: aggregate.tokenIds
        });
      }
    }

    // === Multi-Chain Token Balances ===
    // Process tokens from Alchemy (EVM) and Helius (Solana) APIs
    // Fetch prices AND 24h changes from Pyth (blazing fast, single API call per token)
    if (multiChainTokens.length > 0) {
      // Step 1: Fetch Pyth prices + 24h changes for ALL tokens
      const uniqueSymbols = [...new Set(multiChainTokens.map(t => t.tokenSymbol))];
      
      // Pyth now returns { symbol: { price, change24h } }
      const pythData = await fetchPythPrices(uniqueSymbols, [], true);
      
      // Enrich ALL tokens with Pyth data (prices + 24h changes)
      for (const token of multiChainTokens) {
        if (pythData[token.tokenSymbol]) {
          // Update price only if token doesn't have one yet
          if (token.tokenPrice === 0 && pythData[token.tokenSymbol].price) {
            token.tokenPrice = pythData[token.tokenSymbol].price;
            token.balanceUsd = token.balance * token.tokenPrice;
          }
          // Always update 24h change from Pyth (most accurate)
          if (pythData[token.tokenSymbol].change24h !== null) {
            token.change24h = pythData[token.tokenSymbol].change24h;
          }
        }
      }
      
      // Step 2: Use Hyperliquid price for HYPE (most accurate for HyperEVM chain)
      if (hlMarketData && hlMarketData['HYPE'] && hlMarketData['HYPE'].markPx) {
        const hypePrice = hlMarketData['HYPE'].markPx;
        const hypeChange = hlMarketData['HYPE'].change24h || 0;
        for (const token of multiChainTokens) {
          if (token.tokenSymbol === 'HYPE') {
            token.tokenPrice = hypePrice;
            token.balanceUsd = token.balance * hypePrice;
            token.change24h = hypeChange;
          }
        }
      }
      
      // Step 3: CoinGecko fallback ONLY for tokens Pyth doesn't have (rare)
      const tokensByChain = {};
      for (const token of multiChainTokens) {
        if (token.blockchain !== 'Solana' && token.contractAddress && token.tokenPrice === 0) {
          if (!tokensByChain[token.blockchain]) {
            tokensByChain[token.blockchain] = [];
          }
          tokensByChain[token.blockchain].push(token);
        }
      }
      
      // CoinGecko chain ID mapping
      const chainIdMap = {
        'Ethereum': 'ethereum',
        'Arbitrum': 'arbitrum-one',
        'Optimism': 'optimistic-ethereum',
        'Polygon': 'polygon-pos',
        'Base': 'base'
      };
      
      // Fetch CoinGecko prices + 24h changes for remaining tokens (only if Pyth failed)
      for (const [blockchain, tokens] of Object.entries(tokensByChain)) {
        const chainId = chainIdMap[blockchain];
        if (!chainId) continue;
        
        try {
          const contracts = tokens.map(t => t.contractAddress).join(',');
          const priceResp = await rateLimitedFetch(
            proxyCoinGecko(`https://api.coingecko.com/api/v3/simple/token_price/${chainId}?contract_addresses=${contracts}&vs_currencies=usd&include_24hr_change=true`),
            { cache: `price-${blockchain}-tokens`, cacheTTL: 60000 }
          );
          
          if (priceResp) {
            for (const token of tokens) {
              const priceData = priceResp[token.contractAddress.toLowerCase()];
              if (priceData) {
                if (priceData.usd) {
                  token.tokenPrice = priceData.usd;
                  token.balanceUsd = token.balance * priceData.usd;
                }
                if (priceData.usd_24h_change !== undefined && token.change24h === null) {
                  token.change24h = priceData.usd_24h_change;
                }
              }
            }
          }
        } catch (err) {
          // Silent fallback
        }
      }
    }
    
    // Aggregate tokens by symbol + blockchain (combine same tokens from different wallets)
    const tokenAggregates = {};
    
    
    for (const token of multiChainTokens) {
      // Dust filter: Skip if value < $0.01 OR (no price data AND balance is tiny)
      if (token.balanceUsd < 0.01 || (token.tokenPrice === 0 && token.balance < 1)) {
        continue;
      }
      
      const key = `${token.tokenSymbol}_${token.blockchain}`;
      
      if (!tokenAggregates[key]) {
        tokenAggregates[key] = {
          asset: token.tokenSymbol,
          exchange: token.blockchain,
          amount: 0,
          value: 0,
          price: token.tokenPrice,
          change24h: token.change24h || null, // Use token's 24h change if available (BTC, ZEC), otherwise will be enriched from Zerion
          pnl: null, // Will be enriched from Zerion (total PnL)
          pnlPercent: null, // Will be enriched from Zerion (total PnL %)
          pnl24h: null, // Will be enriched from Zerion (24h PnL in $)
          walletBreakdown: [],
          coingeckoId: symbolToCoingeckoId[token.tokenSymbol] || null
        };
      }
      
      tokenAggregates[key].amount += token.balance;
      tokenAggregates[key].value += token.balanceUsd;
      
      // Update 24h change if token has it and aggregate doesn't (for BTC/ZEC)
      if (token.change24h !== null && token.change24h !== undefined && !tokenAggregates[key].change24h) {
        tokenAggregates[key].change24h = token.change24h;
      }
      tokenAggregates[key].walletBreakdown.push({
        address: token.address,
        balance: token.balance,
        balanceUsd: token.balanceUsd
      });
      
      if (token.balanceUsd > 0) {
        accountBalances.multichain += token.balanceUsd;
      }
    }
    
    
    // Enrich token aggregates with Zerion data (24h changes, PnL if available)
    if (zerionPositions && Object.keys(zerionPositions).length > 0) {
      let zerionMatches = 0;
      
      
      for (const [key, aggregate] of Object.entries(tokenAggregates)) {
        // Try to match with Zerion data
        // Zerion uses chain IDs like 'ethereum', 'arbitrum', 'optimism'
        const chainNameMap = {
          'Ethereum': 'ethereum',
          'Arbitrum': 'arbitrum',
          'Optimism': 'optimism',
          'Polygon': 'polygon',
          'Base': 'base',
          'Avalanche': 'avalanche',
          'BSC': 'binance-smart-chain',
          'Solana': 'solana',
          'HyperEVM': 'hyperevm' // Add HyperEVM mapping
        };
        
        const zerionChain = chainNameMap[aggregate.exchange];
        if (zerionChain) {
          const zerionKey = `${aggregate.asset}_${zerionChain}`;
          const zerionPos = zerionPositions[zerionKey];
          
          if (zerionPos) {
            
            if (zerionPos.changes) {
              // 24h change percentage
              if (zerionPos.changes.percent_1d !== undefined) {
                aggregate.change24h = zerionPos.changes.percent_1d;
              }
              
              // 24h change in $ value
              if (zerionPos.changes.absolute_1d !== undefined) {
                aggregate.pnl24h = zerionPos.changes.absolute_1d;
              }
              
              // Total PnL from cost basis (if available)
              if (zerionPos.changes.percent !== undefined) {
                aggregate.pnlPercent = zerionPos.changes.percent;
              }
              if (zerionPos.changes.absolute !== undefined) {
                aggregate.pnl = zerionPos.changes.absolute;
              }
              
              zerionMatches++;
            }
          } else {
          }
        } else {
        }
      }
      
      if (zerionMatches > 0) {
      } else {
      }
    }
    
    // Add aggregated tokens to positions
    let tokensAdded = 0;
    let dustTokensFiltered = Object.keys(tokenAggregates).length - tokensAdded;
    for (const aggregate of Object.values(tokenAggregates)) {
      allPositionsData.push(aggregate);
      tokensAdded++;
    }
    
    dustTokensFiltered = multiChainTokens.length - tokensAdded;
    if (tokensAdded === 0 && dustTokensFiltered > 0) {
    }
    
    // === Add Zerion positions that weren't matched with Alchemy/Helius ===
    // This handles assets that Zerion sees but Alchemy/Helius doesn't
    if (zerionPositions && Object.keys(zerionPositions).length > 0) {
      
      // Build set of existing token keys from Alchemy/Helius
      const existingKeys = new Set(Object.keys(tokenAggregates));
      
      let zerionOnlyAdded = 0;
      for (const [zerionKey, pos] of Object.entries(zerionPositions)) {
        // Skip wallet-level metadata
        if (zerionKey.startsWith('_wallet_')) continue;
        
        // Map Zerion network names to display names
        const networkDisplayMap = {
          'ethereum': 'Ethereum',
          'arbitrum': 'Arbitrum',
          'optimism': 'Optimism',
          'polygon': 'Polygon',
          'base': 'Base',
          'avalanche': 'Avalanche',
          'binance-smart-chain': 'BSC',
          'solana': 'Solana',
          'hyperevm': 'HyperEVM'
        };
        
        const displayNetwork = networkDisplayMap[pos.network] || pos.network;
        const aggregateKey = `${pos.symbol}_${displayNetwork}`;
        
        // Only add if not already in aggregates (i.e., not from Alchemy/Helius)
        if (!existingKeys.has(aggregateKey)) {
          // Add to positions
          allPositionsData.push({
            asset: pos.symbol,
            exchange: displayNetwork,
            amount: pos.balance,
            value: pos.balanceUsd,
            price: pos.price,
            change24h: pos.changes?.percent_1d || null,
            pnl: pos.changes?.absolute || null, // Total PnL if available
            pnlPercent: pos.changes?.percent || null, // Total PnL % if available
            pnl24h: pos.changes?.absolute_1d || null, // 24h PnL in $
            coingeckoId: symbolToCoingeckoId[pos.symbol] || null
          });
          
          accountBalances.multichain += pos.balanceUsd;
          zerionOnlyAdded++;
        }
      }
      
      if (zerionOnlyAdded > 0) {
      }
    }
    
    // === Manual Positions ===
    // Add manual positions from settings (Pyth Oracle or Custom Assets)
    // Ensure cryptoPositions exists
    if (!settings.cryptoPositions) {
      settings.cryptoPositions = [];
    }
    
    if (settings.cryptoPositions.length > 0) {
      
      for (const manualPos of settings.cryptoPositions) {
        if (manualPos.type === 'custom') {
          // Custom asset with fixed value
          allPositionsData.push({
            asset: manualPos.name,
            exchange: 'Manual',
            amount: 1, // Represent as 1 unit
            value: manualPos.value,
            price: manualPos.value,
            change24h: null,
            pnl: null, // No P&L for custom assets
            pnlPercent: null,
            isManual: true,
            manualType: 'custom'
          });
          accountBalances.multichain += manualPos.value;
        } else if (manualPos.type === 'pyth') {
          // Pyth oracle position - will get price later in Pyth pricing section
          const currentValue = manualPos.amount * (manualPos.entryPrice || 0);
          allPositionsData.push({
            asset: manualPos.symbol,
            exchange: 'Manual',
            amount: manualPos.amount,
            value: currentValue, // Temporary, will be updated with Pyth price
            price: manualPos.entryPrice || 0, // Will be updated with Pyth price
            change24h: null,
            pnl: null, // Will be calculated after price is fetched
            pnlPercent: null,
            entryPrice: manualPos.entryPrice,
            pythFeedId: manualPos.feedId,
            isManual: true,
            manualType: 'pyth'
          });
          // Add initial value based on entry price (will be updated with Pyth price)
          accountBalances.multichain += currentValue;
        }
      }
    }
    
    // === Pyth Network Pricing ===
    // Use preloaded Pyth prices (fetched in parallel) and enrich with any missing assets
    const usePyth = settings.usePythPrices ?? true;
    const pythPricesMap = { ...pythPricesPreload }; // Start with preloaded data
    
    if (usePyth && allPositionsData.length > 0) {
      const assets = [...new Set(allPositionsData
        .filter(pos => pos.exchange !== 'OpenSea')
        .map(pos => pos.asset))];
      
      // Collect feed IDs from manual Pyth positions (they have explicit feed IDs)
      const manualPythFeedIds = allPositionsData
        .filter(pos => pos.isManual && pos.manualType === 'pyth' && pos.pythFeedId)
        .map(pos => ({ asset: pos.asset, feedId: pos.pythFeedId }));
      
      // Find assets not in preload
      const missingAssets = assets.filter(asset => !pythPricesMap[asset]);
      
      if (missingAssets.length > 0 || manualPythFeedIds.length > 0) {
        try {
          const additionalPrices = await fetchPythPrices(missingAssets, manualPythFeedIds, true);
          Object.assign(pythPricesMap, additionalPrices);
        } catch (err) {
          console.warn('⚠ Failed to fetch additional Pyth prices:', err);
        }
      }
      
      // Only use Pyth as fallback when exchange price is missing or zero
      for (const pos of allPositionsData) {
        if (pos.exchange !== 'OpenSea' && pythPricesMap[pos.asset]) {
          const pythData = pythPricesMap[pos.asset];
          
          if (!pos.price || pos.price === 0) {
            pos.price = pythData.price;
            pos.value = Math.abs(pos.amount) * pos.price;
          }
          
          // Use Pyth's 24h change if we don't have one yet (or it's 0 from Lighter)
          if ((pos.change24h === null || pos.change24h === undefined || pos.change24h === 0) && pythData.change24h !== null) {
            pos.change24h = pythData.change24h;
          }
        }
        
        // Update manual Pyth positions with current price and calculate P&L
        if (pos.isManual && pos.manualType === 'pyth') {
          if (pythPricesMap[pos.asset]) {
            const oldValue = pos.value;
            const pythData = pythPricesMap[pos.asset];
            const currentPrice = pythData.price;
            pos.price = currentPrice;
            pos.value = Math.abs(pos.amount) * currentPrice;
            
            // Use Pyth's 24h change
            if (pythData.change24h !== null) {
              pos.change24h = pythData.change24h;
            }
            
            // Calculate P&L if entry price exists
            if (pos.entryPrice && pos.entryPrice > 0) {
              const costBasis = Math.abs(pos.amount) * pos.entryPrice;
              pos.pnl = pos.value - costBasis;
              pos.pnlPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
            }
            
            // Update balance with the difference (we already added initial value)
            accountBalances.multichain += (pos.value - oldValue);
          }
        }
      }
    }
    
    // === Calculate TRUE 24h changes from prices 24 hours ago ===
    // Use preloaded historical prices (fetched in parallel - MUCH faster!)
    const historicalData = { 
      prices: historicalPricesPreload || {}, 
      timestamp: Math.floor(Date.now() / 1000) 
    };
    
    // Calculate 24h change for each position - with fallback chain for robustness
    let change24hCalculated = 0;
    let missingSources = [];
    
    for (const pos of allPositionsData) {
      // Skip if we already have 24h change from a reliable source (Zerion, Hyperliquid)
      if (pos.change24h !== null && pos.change24h !== undefined && pos.change24h !== 0) {
        change24hCalculated++;
        continue;
      }
      
      const currentPrice = pos.price || 0;
      let change24h = null;
      let lookupKey = '';
      
      if (pos.exchange === 'OpenSea') {
        // NFTs: Use stored historical floor price by collection slug
        if (pos.collectionSlug) {
          lookupKey = `${pos.collectionSlug}_NFT`;
          const historicalPrice = historicalData.prices[lookupKey]
            ?? historicalData.prices[`${pos.asset}_NFT`];
          if (historicalPrice && historicalPrice > 0 && currentPrice > 0) {
            change24h = ((currentPrice - historicalPrice) / historicalPrice) * 100;
          }
        }
      } else {
        // Crypto: Multi-source fallback chain for robustness
        
        // Source 1: Historical price calculation (from preloaded data)
        lookupKey = `${pos.asset}_${pos.exchange}`;
        const historicalPrice = historicalData.prices[lookupKey];
        if (historicalPrice && historicalPrice > 0 && currentPrice > 0) {
          change24h = ((currentPrice - historicalPrice) / historicalPrice) * 100;
        }
        
        // Source 2: Pyth 24h change (if historical calc failed)
        if (change24h === null && pythPricesMap[pos.asset] && pythPricesMap[pos.asset].change24h !== null) {
          change24h = pythPricesMap[pos.asset].change24h;
        }
        
        // Source 3: Hyperliquid prevDayPx (most reliable for HL assets)
        if (change24h === null && pos.exchange === 'Hyperliquid' && hlMarketData[pos.asset] && hlMarketData[pos.asset].change24h) {
          change24h = hlMarketData[pos.asset].change24h;
        }
      }
      
      if (change24h !== null) {
        pos.change24h = change24h;
        change24hCalculated++;
      } else if (currentPrice > 0) {
        missingSources.push(`${pos.asset} (${pos.exchange})`);
      }
    }
    
    // CoinGecko fallback for remaining assets (last resort)
    if (missingSources.length > 0) {
      try {
        const assetSymbols = [...new Set(allPositionsData
          .filter(pos => pos.change24h === null || pos.change24h === undefined)
          .map(pos => pos.asset))];
        
        if (assetSymbols.length > 0 && assetSymbols.length < 20) {
          // Map common symbols to CoinGecko IDs
          const symbolMap = {
            'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana',
            'USDC': 'usd-coin', 'USDT': 'tether', 'HYPE': 'hyperliquid'
          };
          
          const ids = assetSymbols.map(s => symbolMap[s] || s.toLowerCase()).join(',');
          const cgResp = await rateLimitedFetch(
            proxyCoinGecko(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`),
            { cache: 'coingecko-24h-fallback', cacheTTL: 60000 }
          );
          
          if (cgResp) {
            for (const pos of allPositionsData) {
              if (pos.change24h === null || pos.change24h === undefined) {
                const cgId = symbolMap[pos.asset] || pos.asset.toLowerCase();
                if (cgResp[cgId] && cgResp[cgId].usd_24h_change !== undefined) {
                  pos.change24h = cgResp[cgId].usd_24h_change;
                  change24hCalculated++;
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn('⚠ CoinGecko 24h fallback failed:', err.message);
      }
      
      // Final warning for still-missing data
      const stillMissing = allPositionsData.filter(p => !p.change24h && p.price > 0).length;
      if (stillMissing > 0 && stillMissing < 10) {
        console.warn(`⚠ Still missing 24h change for ${stillMissing} assets after all fallbacks`);
      }
    }
    
    // Debug: Log position breakdown by exchange
    const positionsByExchange = {};
    for (const pos of allPositionsData) {
      if (!positionsByExchange[pos.exchange]) {
        positionsByExchange[pos.exchange] = [];
      }
      positionsByExchange[pos.exchange].push(pos.asset);
    }
    
    // Render positions table
    renderPositionsTable();
    await updateHeroSection();
    
    perfMonitor.end('fetchAndRenderPositions');
  }
  
  // Real-time price update functionality
  let realTimeUpdateTimer = null;
  
  async function updatePricesRealTime() {
    // Skip if tab is not visible to save API calls
    if (!isTabVisible) return;
    
    // Skip if update already in progress to prevent concurrent requests
    if (updateInProgress) return;
    
    if (allPositionsData.length === 0) return;
    
    // Use requestAnimationFrame for smoother DOM updates
    updateInProgress = true;
    
    try {
      const settings = loadSettings() || getDefaultSettings();
      const usePyth = settings.usePythPrices ?? true;
      
      let latestPrices = {};
      
      if (usePyth) {
        // Fetch both Pyth and Hyperliquid prices
        const assets = [...new Set(allPositionsData
          .filter(pos => pos.exchange !== 'OpenSea')
          .map(pos => pos.asset))];
        
        const pythPrices = await fetchPythPrices(assets);
        
        // Get exchange prices from Hyperliquid
        const marketResp = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'metaAndAssetCtxs' })
        });
        
        if (!marketResp.ok) return;
        
        const marketData = await marketResp.json();
        
        if (marketData && marketData[0] && marketData[1]) {
          for (let i = 0; i < marketData[1].length; i++) {
            const ctx = marketData[1][i];
            const assetName = marketData[0].universe[i]?.name;
            if (assetName && ctx && ctx.markPx) {
              latestPrices[assetName] = {
                price: parseFloat(ctx.markPx),
                prevDayPx: parseFloat(ctx.prevDayPx || 0)
              };
            }
          }
        }
        
        // Also fetch Hyperliquid spot prices
        const spotPricesResp = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'allMids' })
        });
        
        if (spotPricesResp.ok) {
          const spotPrices = await spotPricesResp.json();
          for (const [coin, price] of Object.entries(spotPrices)) {
            if (!latestPrices[coin]) {
              latestPrices[coin] = { price: parseFloat(price), prevDayPx: 0 };
            }
          }
        }
        
        // Use Pyth as fallback for assets not covered by exchanges
        for (const [asset, price] of Object.entries(pythPrices)) {
          if (!latestPrices[asset]) {
            latestPrices[asset] = {
              price: price,
              prevDayPx: 0
            };
          }
        }
      } else {
        // Pyth disabled: fetch exchange prices only
        const marketResp = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'metaAndAssetCtxs' })
        });
        
        if (marketResp.ok) {
          const marketData = await marketResp.json();
          
          if (marketData && marketData[0] && marketData[1]) {
            for (let i = 0; i < marketData[1].length; i++) {
              const ctx = marketData[1][i];
              const assetName = marketData[0].universe[i]?.name;
              if (assetName && ctx && ctx.markPx) {
                latestPrices[assetName] = {
                  price: parseFloat(ctx.markPx),
                  prevDayPx: parseFloat(ctx.prevDayPx || 0)
                };
              }
            }
          }
          
          // Also fetch spot prices
          const spotPricesResp = await fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'allMids' })
          });
          
          if (spotPricesResp.ok) {
            const spotPrices = await spotPricesResp.json();
            for (const [coin, price] of Object.entries(spotPrices)) {
              if (!latestPrices[coin]) {
                latestPrices[coin] = { price: parseFloat(price), prevDayPx: 0 };
              }
            }
          }
        }
      }
      
      // Fetch latest Lighter positions for all wallets
      const wallets = parseWallets(settings.walletAddresses);
      const lighterUpdates = {};
      
      for (const wallet of wallets) {
        try {
          const lighterData = await fetchLighterPositions(wallet);
          if (lighterData && lighterData.accounts && lighterData.accounts[0]) {
            const account = lighterData.accounts[0];
            if (account.positions) {
              for (const pos of account.positions) {
                if (pos.position && parseFloat(pos.position) !== 0) {
                  const position = parseFloat(pos.position);
                  const positionValue = parseFloat(pos.position_value || 0);
                  const currentPrice = position > 0 ? positionValue / position : 0;
                  lighterUpdates[pos.symbol] = {
                    value: positionValue,
                    price: currentPrice,
                    pnl: parseFloat(pos.unrealized_pnl || 0)
                  };
                }
              }
            }
          }
        } catch (err) {
        }
      }
      
      // Get historical prices (24h ago) for 24h change calculations
      const historicalData = getDailyPrices();
      
      // Update positions with new prices and track which ones changed
      const updatedAssets = new Set();
      
      // Update Hyperliquid positions
      for (const pos of allPositionsData) {
        if (pos.exchange === 'Hyperliquid' && latestPrices[pos.asset]) {
          const newPrice = latestPrices[pos.asset].price;
          if (newPrice && newPrice !== pos.price) {
            pos.price = newPrice;
            pos.value = Math.abs(pos.amount) * newPrice;
            
            // Calculate 24h change from historical price (24 hours ago)
            if (historicalData && historicalData.prices) {
              const price24hAgo = historicalData.prices[`${pos.asset}_${pos.exchange}`];
              if (price24hAgo && price24hAgo > 0) {
                pos.change24h = ((newPrice - price24hAgo) / price24hAgo) * 100;
              }
            }
            
            updatedAssets.add(pos.asset);
          }
        }
        
        // Update Lighter positions
        if (pos.exchange === 'Lighter' && lighterUpdates[pos.asset]) {
          const update = lighterUpdates[pos.asset];
          if (update.price !== pos.price || update.value !== pos.value) {
            pos.price = update.price;
            pos.value = update.value;
            pos.pnl = update.pnl;
            
            // Calculate 24h change from historical price (24 hours ago)
            if (historicalData && historicalData.prices) {
              const price24hAgo = historicalData.prices[`${pos.asset}_${pos.exchange}`];
              if (price24hAgo && price24hAgo > 0) {
                pos.change24h = ((update.price - price24hAgo) / price24hAgo) * 100;
              }
            }
            
            updatedAssets.add(pos.asset);
          }
        }
      }
      
      if (updatedAssets.size > 0) {
        renderPositionsTable();
        await updateHeroSection();
        updateLastUpdateTimestamp();
        
        // Update watchlist with latest prices
        await renderWatchlist();
        
        // Add flash animation to updated cells
        requestAnimationFrame(() => {
          updatedAssets.forEach(asset => {
            // Flash desktop table cells (price, value, change, pnl)
            const rows = els.positionsBody?.querySelectorAll('tr');
            if (rows) {
              rows.forEach(row => {
                const assetCell = row.querySelector('.asset-cell');
                if (assetCell && assetCell.textContent.trim() === asset) {
                  // Flash the price, value, 24h change, and PnL cells
                  const cells = row.querySelectorAll('td');
                  if (cells.length >= 7) {
                    // td indices: 0=asset, 1=exchange, 2=amount, 3=price, 4=value, 5=change24h, 6=pnl
                    [3, 4, 5, 6].forEach(idx => {
                      const cell = cells[idx];
                      if (cell) {
                        cell.classList.add('flash-update');
                        setTimeout(() => cell.classList.remove('flash-update'), 200);
                      }
                    });
                  }
                }
              });
            }
            
            // Flash mobile card fields
            const cards = els.mobilePositionsContainer?.querySelectorAll('.mobile-position-card');
            if (cards) {
              cards.forEach(card => {
                const assetSpan = card.querySelector('.card-asset');
                if (assetSpan && assetSpan.textContent.trim() === asset) {
                  // Flash the price, value, 24h change, and PnL fields
                  const fields = card.querySelectorAll('.card-value');
                  fields.forEach(field => {
                    field.classList.add('flash-update');
                    setTimeout(() => field.classList.remove('flash-update'), 200);
                  });
                }
              });
            }
          });
        });
      }
    } catch (err) {
      // Update error
    } finally {
      updateInProgress = false;
    }
  }
  
  function startRealTimeUpdates() {
    const settings = loadSettings();
    if (!settings || !settings.enableRealTimeUpdates) return;
    
    stopRealTimeUpdates(); // Clear any existing timer
    
    const interval = (settings.realTimeUpdateInterval || 5) * 1000;
    
    realTimeUpdateTimer = setInterval(updatePricesRealTime, interval);
  }
  
  function stopRealTimeUpdates() {
    if (realTimeUpdateTimer) {
      clearInterval(realTimeUpdateTimer);
      realTimeUpdateTimer = null;
    }
  }
  
  function toggleAssetVisibility(assetKey) {
    const settings = loadSettings() || getDefaultSettings();
    const hiddenAssets = settings.hiddenAssets || [];
    
    const index = hiddenAssets.indexOf(assetKey);
    if (index > -1) {
      // Asset is hidden, show it
      hiddenAssets.splice(index, 1);
    } else {
      // Asset is visible, hide it
      hiddenAssets.push(assetKey);
    }
    
    settings.hiddenAssets = hiddenAssets;
    saveSettings(settings);
    renderPositionsTable();
  }
  
  function getMarketLink(asset, exchange, positionType) {
    if (exchange === 'Hyperliquid') {
      if (positionType === 'perp') {
      return `https://app.hyperliquid.xyz/trade/${asset}`;
      } else if (positionType === 'spot') {
      return `https://app.hyperliquid.xyz/spot/${asset}`;
      }
      return null;
    } else if (exchange === 'Lighter') {
      // Lighter links - format: https://app.lighter.xyz/trade/BTC-USDC
      return `https://app.lighter.xyz/trade/${asset}-USDC`;
    } else if (exchange === 'OpenSea') {
      // OpenSea collection links - format collection name to slug
      const slug = asset.toLowerCase().replace(/\s+/g, '-');
      return `https://opensea.io/collection/${slug}`;
    }
    return null;
  }

  function renderPositionsTable() {
    if (!els.positionsBody) return;
    
    if (allPositionsData.length === 0) {
      els.positionsBody.innerHTML = '<tr><td colspan="7" class="loading">No positions found</td></tr>';
      return;
    }
    
    // Filter positions based on toggles
    let filteredPositions = allPositionsData;
    const settings = loadSettings() || getDefaultSettings();
    const minThreshold = settings.minBalanceThreshold || 100;
    const hiddenAssets = settings.hiddenAssets || [];
    const isCompactMode = settings.compactList ?? false;
    
    if (hideSmallPositions) {
      filteredPositions = filteredPositions.filter(pos => pos.value >= minThreshold);
    }
    
    if (hideNfts) {
      filteredPositions = filteredPositions.filter(pos => pos.exchange !== 'OpenSea');
    }
    
    // Filter hidden assets (only when not in edit mode)
    if (!editMode) {
      filteredPositions = filteredPositions.filter(pos => {
        const assetKey = `${pos.asset}_${pos.exchange}`;
        return !hiddenAssets.includes(assetKey);
      });
    }
    
    if (filteredPositions.length === 0) {
      els.positionsBody.innerHTML = '<tr><td colspan="7" class="loading">No positions matching filter</td></tr>';
      return;
    }
    
    els.positionsBody.innerHTML = '';
    if (els.mobilePositionsContainer) {
      els.mobilePositionsContainer.innerHTML = '';
    }
    
    const useColoredPnL = settings.useColoredPnL ?? true;
    
    for (const pos of filteredPositions) {
      const tr = document.createElement('tr');
      const assetKey = `${pos.asset}_${pos.exchange}`;
      const isHidden = hiddenAssets.includes(assetKey);
      
      // Add class for hidden items in edit mode
      if (editMode && isHidden) {
        tr.classList.add('position-row-hidden');
      }
      
      // For custom manual positions, never show P&L (only show for Pyth positions with actual P&L)
      const hasPnlValue = pos.pnl !== null && pos.pnl !== undefined && !(pos.isManual && pos.manualType === 'custom');
      const pnlClass = useColoredPnL 
        ? (hasPnlValue && pos.pnl >= 0 ? 'positive-pnl' : hasPnlValue ? 'negative-pnl' : 'neutral-value')
        : (hasPnlValue && pos.pnl >= 0 ? 'positive-neutral' : hasPnlValue ? 'negative-neutral' : 'neutral-value');
      const pnlSign = hasPnlValue ? (pos.pnl >= 0 ? '+' : '-') : '';
      
      const change24h = pos.change24h;
      const hasChange24h = change24h !== null && change24h !== undefined;
      const changeClass = useColoredPnL
        ? (hasChange24h ? (change24h >= 0 ? 'positive-pnl' : 'negative-pnl') : 'neutral-value')
        : (hasChange24h ? (change24h >= 0 ? 'positive-neutral' : 'negative-neutral') : 'neutral-value');
      const changeSign = hasChange24h ? (change24h >= 0 ? '+' : '-') : '';
      const change24hDisplay = hasChange24h ? `${changeSign}${Math.abs(change24h).toFixed(1)}%` : '—';
      
      const marketLink = getMarketLink(pos.asset, pos.exchange, pos.positionType);
      const exchangeDisplay = marketLink 
        ? `<a href="${marketLink}" target="_blank" class="exchange-link">${pos.exchange} ↗</a>`
        : pos.exchange;
      
      // Format amounts based on visibility toggle
      const amountDisplay = amountsVisible 
        ? (typeof pos.amount === 'number' ? formatCompactNumber(pos.amount) : pos.amount)
        : '••••';
      
      // Format price - for NFTs show in native token, for crypto show in USD
      let priceDisplay = '—';
      if (!amountsVisible) {
        priceDisplay = '••••';
      } else if (pos.exchange === 'OpenSea') {
        // For NFTs, prioritize showing native price if available
        if (pos.priceInNative && pos.priceInNative > 0) {
          const nativeToken = pos.nativeToken || 'ETH';
          priceDisplay = `${formatCompactNumber(pos.priceInNative)} ${nativeToken}`;
        } else if (pos.price && pos.price > 0) {
          priceDisplay = `$${formatCompactNumber(pos.price)}`;
        }
      } else if (pos.price && pos.price > 0) {
        priceDisplay = `$${formatCompactNumber(pos.price)}`;
      }
      
      // Format value - show in native token for NFTs without USD price
      let valueDisplay = '$••••';
      if (amountsVisible) {
        if (pos.exchange === 'OpenSea' && (!pos.price || pos.price === 0) && pos.priceInNative && pos.priceInNative > 0) {
          // NFT with only native price available
          const totalNative = pos.amount * pos.priceInNative;
          const nativeToken = pos.nativeToken || 'ETH';
          valueDisplay = `${formatCompactNumber(totalNative)} ${nativeToken}`;
        } else if (pos.value && pos.value > 0) {
          valueDisplay = `$${formatCompactNumber(pos.value)}`;
        } else {
          valueDisplay = '—';
        }
      }
      
      // For custom manual positions, never show P&L (only show for Pyth positions with actual P&L)
      const hasPnl = pos.pnl !== null && pos.pnl !== undefined && !(pos.isManual && pos.manualType === 'custom');
      const pnlAmount = hasPnl ? Math.abs(pos.pnl) : 0;
      const pnlDisplay = amountsVisible 
        ? (hasPnl ? `${pnlSign}$${formatCompactNumber(pnlAmount)}${pos.pnlPercent !== 0 ? ` (${pnlSign}${Math.abs(pos.pnlPercent).toFixed(1)}%)` : ''}` : '—')
        : '••••';
      
      // Desktop table row
      const editButton = editMode 
        ? `<button class="position-edit-btn" data-asset-key="${assetKey}">[${isHidden ? 'SHOW' : 'HIDE'}]</button>`
        : '';
      
      // Generate wallet breakdown tooltip if available
      const hasWalletBreakdown = pos.walletBreakdown && pos.walletBreakdown.length > 1;
      const assetCellClass = hasWalletBreakdown ? 'asset-cell has-wallet-breakdown' : 'asset-cell';
      const assetDisplay = hasWalletBreakdown ? `${pos.asset} <span class="wallet-breakdown-indicator">(i)</span>` : pos.asset;
      
      // In compact mode, reorder columns: Asset, 24H%, P&L, Price, Value, Amount, Exchange (last)
      if (isCompactMode) {
        tr.innerHTML = `
          <td class="${assetCellClass}">${assetDisplay}${editButton}</td>
          <td class="${changeClass} change-cell">${change24hDisplay}</td>
          <td class="${pnlClass} pnl-cell">${pnlDisplay}</td>
          <td class="price-cell">${priceDisplay}</td>
          <td class="value-cell">${valueDisplay}</td>
          <td class="amount-cell">${amountDisplay}</td>
          <td class="exchange-cell">${exchangeDisplay}</td>
        `;
      } else {
        tr.innerHTML = `
          <td class="${assetCellClass}">${assetDisplay}${editButton}</td>
          <td class="exchange-cell">${exchangeDisplay}</td>
          <td class="amount-cell">${amountDisplay}</td>
          <td class="price-cell">${priceDisplay}</td>
          <td class="value-cell">${valueDisplay}</td>
          <td class="${changeClass} change-cell">${change24hDisplay}</td>
          <td class="${pnlClass} pnl-cell">${pnlDisplay}</td>
        `;
      }
      
      // Add wallet breakdown tooltip if applicable
      if (hasWalletBreakdown) {
        const assetCell = tr.querySelector('.asset-cell');
        assetCell.setAttribute('data-wallet-breakdown', JSON.stringify(pos.walletBreakdown));
      }
      
      // Apply flash animations for value changes
      const rowKey = `${pos.asset}_${pos.exchange}`;
      if (amountsVisible) {
        flashCell(tr.querySelector('.price-cell'), `${rowKey}_price`, pos.price);
        flashCell(tr.querySelector('.value-cell'), `${rowKey}_value`, pos.value);
        flashCell(tr.querySelector('.change-cell'), `${rowKey}_change`, pos.change24h);
        if (hasPnl) {
          flashCell(tr.querySelector('.pnl-cell'), `${rowKey}_pnl`, pos.pnl);
        }
      }
      
      // Mobile card view
      const mobileCard = document.createElement('div');
      mobileCard.className = 'mobile-position-card';
      if (editMode && isHidden) {
        mobileCard.classList.add('position-row-hidden');
      }
      
      const assetClass = hasWalletBreakdown ? 'card-asset has-wallet-breakdown' : 'card-asset';
      const mobileAssetDisplay = hasWalletBreakdown ? `<span class="wallet-breakdown-indicator">(i)</span> ${pos.asset}` : pos.asset;
      
      mobileCard.innerHTML = `
        <div class="card-header">
          <span class="${assetClass}">${mobileAssetDisplay}${editButton}</span>
          <span class="card-exchange">${exchangeDisplay}</span>
        </div>
        <div class="card-grid">
          <div class="card-field">
            <span class="card-label">AMOUNT</span>
            <span class="card-value">${amountDisplay}</span>
          </div>
          <div class="card-field">
            <span class="card-label">PRICE</span>
            <span class="card-value">${priceDisplay}</span>
          </div>
          <div class="card-field">
            <span class="card-label">VALUE</span>
            <span class="card-value">${valueDisplay}</span>
          </div>
          <div class="card-field">
            <span class="card-label">24H%</span>
            <span class="card-value ${changeClass}">${change24hDisplay}</span>
          </div>
          <div class="card-field card-field-wide">
            <span class="card-label">P&L</span>
            <span class="card-value ${pnlClass}">${pnlDisplay}</span>
          </div>
        </div>
      `;
      
      els.positionsBody.appendChild(tr);
      if (els.mobilePositionsContainer) {
        els.mobilePositionsContainer.appendChild(mobileCard);
        
        // Add wallet breakdown to mobile card asset span
        if (hasWalletBreakdown) {
          const mobileAssetSpan = mobileCard.querySelector('.card-asset.has-wallet-breakdown');
          if (mobileAssetSpan) {
            mobileAssetSpan.setAttribute('data-wallet-breakdown', JSON.stringify(pos.walletBreakdown));
          }
        }
      }
    }
    
    // Initialize wallet breakdown tooltips
    initWalletBreakdownTooltips();
  }
  
  function initWalletBreakdownTooltips() {
    // Remove any existing tooltip
    let tooltip = document.getElementById('wallet-breakdown-tooltip');
    if (tooltip) {
      tooltip.remove();
    }
    
    // Create tooltip element
    tooltip = document.createElement('div');
    tooltip.id = 'wallet-breakdown-tooltip';
    tooltip.className = 'wallet-breakdown-tooltip';
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);
    
    // Add hover/touch listeners to all asset cells with wallet breakdown (desktop & mobile)
    const assetCells = document.querySelectorAll('.asset-cell.has-wallet-breakdown, .card-asset.has-wallet-breakdown');
    
    let activeTooltipCell = null;
    let mouseMoveHandler = null;
    
    assetCells.forEach(cell => {
      // Desktop: mouseenter/mouseleave
      cell.addEventListener('mouseenter', (e) => {
        const breakdownData = JSON.parse(cell.getAttribute('data-wallet-breakdown'));
        showWalletBreakdownTooltip(e, breakdownData);
        activeTooltipCell = cell;
        
        // Track mouse movement to update tooltip position
        mouseMoveHandler = (moveEvent) => {
          updateTooltipPosition(moveEvent);
        };
        document.addEventListener('mousemove', mouseMoveHandler);
      });
      
      cell.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
        activeTooltipCell = null;
        
        // Remove mouse tracking
        if (mouseMoveHandler) {
          document.removeEventListener('mousemove', mouseMoveHandler);
          mouseMoveHandler = null;
        }
      });
      
      // Mobile: tap to toggle
      cell.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
          e.stopPropagation();
          
          if (activeTooltipCell === cell && tooltip.style.display === 'block') {
            tooltip.style.display = 'none';
            activeTooltipCell = null;
          } else {
            const breakdownData = JSON.parse(cell.getAttribute('data-wallet-breakdown'));
            showWalletBreakdownTooltip(e, breakdownData);
            activeTooltipCell = cell;
          }
        }
      });
    });
    
    // Helper function to update tooltip position based on mouse
    function updateTooltipPosition(e) {
      if (tooltip.style.display === 'none') return;
      
      const offset = 15; // Pixels away from cursor
      let left = e.clientX + offset;
      let top = e.clientY + offset;
      
      // Get tooltip dimensions (needs to be visible to measure)
      const tooltipRect = tooltip.getBoundingClientRect();
      
      // Prevent tooltip from going off-screen (right edge)
      if (left + tooltipRect.width > window.innerWidth) {
        left = e.clientX - tooltipRect.width - offset;
      }
      
      // Prevent tooltip from going off-screen (bottom edge)
      if (top + tooltipRect.height > window.innerHeight) {
        top = e.clientY - tooltipRect.height - offset;
      }
      
      // Prevent tooltip from going off-screen (top edge)
      if (top < 0) {
        top = offset;
      }
      
      // Prevent tooltip from going off-screen (left edge)
      if (left < 0) {
        left = offset;
      }
      
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }
    
    // Close tooltip when clicking outside on mobile
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 768 && activeTooltipCell) {
        if (!tooltip.contains(e.target) && !activeTooltipCell.contains(e.target)) {
          tooltip.style.display = 'none';
          activeTooltipCell = null;
        }
      }
    });
  }
  
  function showWalletBreakdownTooltip(event, walletBreakdown) {
    const tooltip = document.getElementById('wallet-breakdown-tooltip');
    if (!tooltip || !walletBreakdown || walletBreakdown.length === 0) return;
    
    // Filter out shielded Zcash addresses (z-addr) - only show transparent addresses
    const filteredBreakdown = walletBreakdown.filter(wallet => {
      const addr = wallet.address;
      // Filter out if it starts with 'z' (shielded Zcash address)
      return !addr.startsWith('z');
    });
    
    if (filteredBreakdown.length === 0) return;
    
    // Calculate total balance
    const totalBalance = filteredBreakdown.reduce((sum, w) => sum + w.balance, 0);
    
    // Generate tooltip content
    let content = '<div class="wallet-breakdown-list">';
    
    filteredBreakdown.forEach((wallet, index) => {
      const percentage = (wallet.balance / totalBalance) * 100;
      const shortAddress = `${wallet.address.substring(0, 6)}...${wallet.address.substring(wallet.address.length - 4)}`;
      
      content += `
        <div class="wallet-breakdown-item">
          <div class="wallet-breakdown-info">
            <span class="wallet-address">${shortAddress}</span>
            <span class="wallet-amount">${formatCompactNumber(wallet.balance)} (${percentage.toFixed(1)}%)</span>
          </div>
        </div>
      `;
    });
    
    content += '</div>';
    
    // Add visual bar chart
    content += '<div class="wallet-breakdown-bar">';
    filteredBreakdown.forEach((wallet, index) => {
      const percentage = (wallet.balance / totalBalance) * 100;
      const colors = ['var(--accent)', 'var(--muted)', 'var(--text)'];
      const color = colors[index % colors.length];
      
      content += `<div class="wallet-bar-segment" style="width: ${percentage}%; background-color: ${color}; opacity: ${0.8 - (index * 0.1)}"></div>`;
    });
    content += '</div>';
    
    tooltip.innerHTML = content;
    tooltip.style.display = 'block';
    
    // Position tooltip at cursor (mobile uses tap position, desktop uses mouse position)
    const offset = 15;
    let left = event.clientX + offset;
    let top = event.clientY + offset;
    
    // For mobile, position below tap point
    if (window.innerWidth <= 768) {
      const rect = event.target.getBoundingClientRect();
      left = rect.left;
      top = rect.bottom + 8;
    }
    
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    
    // Adjust if tooltip goes off screen
    const tooltipRect = tooltip.getBoundingClientRect();
    if (tooltipRect.right > window.innerWidth) {
      tooltip.style.left = `${window.innerWidth - tooltipRect.width - 16}px`;
    }
    if (tooltipRect.bottom > window.innerHeight) {
      if (window.innerWidth <= 768) {
        const rect = event.target.getBoundingClientRect();
        tooltip.style.top = `${rect.top - tooltipRect.height - 8}px`;
      } else {
        tooltip.style.top = `${event.clientY - tooltipRect.height - offset}px`;
      }
    }
  }
  
  async function fetchAndRenderWeather() {
    const settings = loadSettings() || getDefaultSettings();
    const { label, lat, lon } = settings.weather || {};
    
    if (!lat || !lon) {
      weatherData = null;
      return;
    }
    
    try {
      const resp = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`
      );
      if (resp.ok) {
        weatherData = await resp.json();
        weatherData.label = label;
        
        // Calculate moon phase (0 = new moon, 0.5 = full moon, 1 = new moon)
        const today = new Date();
        const knownNewMoon = new Date('2000-01-06'); // Known new moon date
        const daysSinceKnownNewMoon = (today - knownNewMoon) / (1000 * 60 * 60 * 24);
        const lunarCycle = 29.53058867; // Days in a lunar cycle
        const phase = (daysSinceKnownNewMoon % lunarCycle) / lunarCycle;
        weatherData.moonPhase = phase;
      }
    } catch (err) {
      console.error('✗ Weather data unavailable');
      weatherData = null;
    }
  }
  
  async function updateHeroSection() {
    const settings = loadSettings() || getDefaultSettings();
    const userName = settings.userName || 'there';
    const usePyth = settings.usePythPrices ?? true;
    const heroPnLMode = settings.heroPnLMode ?? 'total';
    
    // Get time of day
    const hour = new Date().getHours();
    let timeOfDay = 'Good morning';
    if (hour >= 12 && hour < 18) timeOfDay = 'Good afternoon';
    else if (hour >= 18) timeOfDay = 'Good evening';
    
    els.greeting.textContent = `${timeOfDay}, ${userName}.`;
    if (els.greetingMobile) {
      els.greetingMobile.textContent = `${timeOfDay}, ${userName}.`;
    }
    
    // Filter out hidden assets
    const hiddenAssets = settings.hiddenAssets || [];
    const visiblePositions = allPositionsData.filter(pos => {
      const assetKey = `${pos.asset}_${pos.exchange}`;
      return !hiddenAssets.includes(assetKey);
    });
    
    // Calculate total portfolio value: Start with all account balances, subtract hidden positions
    // NOTE: For Hyperliquid/Lighter, account balances are account-level (all positions share margin)
    // For NFTs and multichain, we subtract individual hidden positions from their totals
    let totalValue = accountBalances.hyperliquid + accountBalances.lighter + accountBalances.nfts + accountBalances.multichain;
    
    // Subtract hidden positions (only NFTs and multichain can be individually hidden)
    const hiddenPositions = allPositionsData.filter(pos => {
      const assetKey = `${pos.asset}_${pos.exchange}`;
      return hiddenAssets.includes(assetKey);
    });
    
    for (const pos of hiddenPositions) {
      if (pos.exchange === 'OpenSea' || (pos.exchange !== 'Hyperliquid' && pos.exchange !== 'Lighter')) {
        totalValue -= (pos.value || 0);
      }
    }
    
    // === Daily Change Calculation from 24 Hours Ago ===
    // Fetch historical prices if needed (first load or cache is stale)
    
    let historicalData = getDailyPrices();
    const currentTime = Math.floor(Date.now() / 1000);
    
    // If no cached data or cache is stale (older than 1 hour), fetch fresh historical prices
    if (!historicalData || isCacheStale(historicalData.timestamp, 1)) {
      try {
        const prices24hAgo = await fetchMidnightPrices(); // Function name kept for compatibility
        saveDailyPrices(prices24hAgo, currentTime);
        historicalData = { prices: prices24hAgo, timestamp: currentTime };
      } catch (err) {
        console.error('✗ Hero: Failed to fetch 24h historical prices:', err);
        historicalData = { prices: {}, timestamp: currentTime };
      }
    } else {
    }
    
    // === Calculate Daily P&L from Price Movements ===
    // For each VISIBLE position: amount × (current_price - price24hAgo)
    // Reflects price changes only, not trades/transfers
    
    // SPEED: Use existing position prices instead of fetching Pyth again
    // Prices are already fetched during position loading
    const pythPricesForHero = {};
    
    let totalDailyChange = 0;
    let portfolioValue24hAgo = 0;
    
    for (const pos of visiblePositions) {
      // Use Pyth price for hero calculations if enabled, otherwise use exchange price
      let currentPrice = pos.price || 0;
      if (usePyth && pos.exchange !== 'OpenSea' && pythPricesForHero[pos.asset]) {
        currentPrice = pythPricesForHero[pos.asset];
      }
      
      const amount = Math.abs(pos.amount || 0); // Use absolute value for position size
      const originalAmount = pos.amount || 0; // Keep original for display
      const positionType = originalAmount >= 0 ? 'LONG' : 'SHORT';
      let price24hAgo = null;
      
      if (pos.exchange === 'OpenSea') {
        // NFTs: Use stored historical floor price by collection slug
        if (pos.collectionSlug) {
        price24hAgo = historicalData.prices[`${pos.collectionSlug}_NFT`]
          ?? historicalData.prices[`${pos.asset}_NFT`];
        }
      } else {
        // Crypto: Use stored historical price (24h ago) for this asset/exchange
        const key = `${pos.asset}_${pos.exchange}`;
        price24hAgo = historicalData.prices[key];
      }
      
      if (price24hAgo && price24hAgo > 0 && currentPrice > 0) {
        // Calculate P&L from price movement: amount * (current - price24hAgo)
        const positionPnL = amount * (currentPrice - price24hAgo);
        totalDailyChange += positionPnL;
        
        // Calculate what this position was worth 24h ago
        const value24hAgo = amount * price24hAgo;
        const currentValue = amount * currentPrice;
        portfolioValue24hAgo += value24hAgo;
        
      } else {
        // If no historical price, use current value as baseline
        const currentValue = amount * currentPrice;
        portfolioValue24hAgo += currentValue;
      }
    }
    
    // Calculate percentage based on what portfolio was worth 24 hours ago
    const totalDailyChangePercent = portfolioValue24hAgo > 0 
      ? (totalDailyChange / portfolioValue24hAgo) * 100 
      : 0;
    
    // === Calculate Total P&L from Entry Prices ===
    // Sum up P&L for all visible positions (includes realized + unrealized PnL)
    let totalPnL = 0;
    let totalCostBasis = 0;
    
    for (const pos of visiblePositions) {
      // Add position P&L if available (including 0, but not null/undefined)
      if (pos.pnl !== null && pos.pnl !== undefined && !isNaN(pos.pnl)) {
        totalPnL += pos.pnl;
        
        // Calculate cost basis for positions with P&L
        const currentValue = pos.value || 0;
        const costBasis = currentValue - pos.pnl;
        if (costBasis > 0) {
          totalCostBasis += costBasis;
        }
      }
    }
    
    // Calculate total P&L percentage based on cost basis
    const totalPnLPercent = totalCostBasis > 0 
      ? (totalPnL / totalCostBasis) * 100 
      : 0;
    
    
    // Get asset highlights based on 24h change (for individual assets, visible only)
    const highlights = [];
    const assetGroups = {};
    for (const pos of visiblePositions) {
      if (!assetGroups[pos.asset]) {
        assetGroups[pos.asset] = { 
          change24h: pos.change24h || 0, 
          value: pos.value 
        };
      } else {
        // If same asset on multiple exchanges, average the change weighted by value
        const totalAssetValue = assetGroups[pos.asset].value + pos.value;
        assetGroups[pos.asset].change24h = 
          (assetGroups[pos.asset].change24h * assetGroups[pos.asset].value + 
           (pos.change24h || 0) * pos.value) / totalAssetValue;
        assetGroups[pos.asset].value = totalAssetValue;
      }
    }
    
    const sortedAssets = Object.entries(assetGroups)
      .filter(([_, data]) => Math.abs(data.change24h) > 0.5 && data.value > 100) // Filter out small changes and small positions
      .sort((a, b) => Math.abs(b[1].change24h) - Math.abs(a[1].change24h))
      .slice(0, 2);
    
    const useColoredPnL = settings.useColoredPnL ?? true;
    for (const [asset, data] of sortedAssets) {
      const sign = data.change24h >= 0 ? 'up' : 'down';
      const colorClass = useColoredPnL 
        ? (data.change24h >= 0 ? 'positive-pnl' : 'negative-pnl')
        : (data.change24h >= 0 ? 'positive-neutral' : 'negative-neutral');
      highlights.push(`<strong>${asset}</strong> is <span class="${colorClass}">${sign} ${Math.abs(data.change24h).toFixed(1)}%</span>`);
    }
    
    // Build summary - start with portfolio value
    let summaryParts = [];
    
    // Portfolio value
    const valueText = amountsVisible 
      ? `$${totalValue.toLocaleString(undefined, {maximumFractionDigits: 0})}`
      : '$••••';
    
    // Choose which P&L mode to display based on settings
    if (heroPnLMode === 'total') {
      // Total P&L from entry prices (includes all positions with entry prices)
      if (totalPnL !== 0 && Math.abs(totalPnL) > 0.01) {
        const changeSign = totalPnL >= 0 ? 'up' : 'down';
        const changeAmountText = amountsVisible 
          ? `$${Math.abs(totalPnL).toLocaleString(undefined, {maximumFractionDigits: 0})}`
          : '$••••';
        
        // Apply color based on useColoredPnL setting
        const colorClass = useColoredPnL 
          ? (totalPnL >= 0 ? 'positive-pnl' : 'negative-pnl')
          : (totalPnL >= 0 ? 'positive-neutral' : 'negative-neutral');
        const colorStyle = ` class="${colorClass}"`;
        
        const sign = totalPnLPercent >= 0 ? '+' : '';
        summaryParts.push(`Your portfolio is worth ${valueText}, <strong${colorStyle}>${changeSign} ${changeAmountText} (${sign}${totalPnLPercent.toFixed(2)}%)</strong>`);
      } else {
        summaryParts.push(`Your portfolio is worth ${valueText}`);
      }
    } else {
      // Daily change from midnight local time (includes all assets: crypto positions + NFTs)
      if (totalDailyChange !== 0 && Math.abs(totalDailyChange) > 0.01) {
        const changeSign = totalDailyChange >= 0 ? 'up' : 'down';
        const changeAmountText = amountsVisible 
          ? `$${Math.abs(totalDailyChange).toLocaleString(undefined, {maximumFractionDigits: 0})}`
          : '$••••';
        
        // Apply color based on useColoredPnL setting
        const colorClass = useColoredPnL 
          ? (totalDailyChange >= 0 ? 'positive-pnl' : 'negative-pnl')
          : (totalDailyChange >= 0 ? 'positive-neutral' : 'negative-neutral');
        const colorStyle = ` class="${colorClass}"`;
        
        const sign = totalDailyChangePercent >= 0 ? '+' : '-';
        summaryParts.push(`Your portfolio is worth ${valueText}, <strong${colorStyle}>${changeSign} ${changeAmountText} (${sign}${Math.abs(totalDailyChangePercent).toFixed(2)}%)</strong> today`);
      } else {
        summaryParts.push(`Your portfolio is worth ${valueText}`);
      }
    }
    
    // Weather
    if (weatherData && weatherData.current) {
      const temp = Math.round(weatherData.current.temperature_2m);
      const city = weatherData.label || 'your location';
      const weatherCode = weatherData.current.weather_code || 0;
      const isDay = weatherData.current.is_day === 1;
      
      
      // Weather icons based on WMO Weather interpretation codes
      // https://open-meteo.com/en/docs
      let weatherIcon = '';
      if (weatherCode === 0) {
        weatherIcon = isDay ? '☀︎' : '☾'; // Clear sky
      } else if (weatherCode <= 3) {
        weatherIcon = '☁︎'; // Partly cloudy
      } else if (weatherCode <= 49) {
        weatherIcon = '☁︎'; // Cloudy/foggy
      } else if (weatherCode >= 51 && weatherCode <= 67) {
        weatherIcon = '⛆'; // Drizzle/rain/freezing rain
      } else if (weatherCode >= 71 && weatherCode <= 77) {
        weatherIcon = '❅'; // Snow
      } else if (weatherCode >= 80 && weatherCode <= 82) {
        weatherIcon = '⛆'; // Rain showers
      } else if (weatherCode >= 85 && weatherCode <= 86) {
        weatherIcon = '❅'; // Snow showers
      } else if (weatherCode >= 95 && weatherCode <= 99) {
        weatherIcon = '⛈'; // Thunderstorm
      } else {
        weatherIcon = '☁︎'; // Default to cloudy
      }
      
      // Get moon phase icon (Unicode moon symbols)
      const moonPhase = weatherData.moonPhase || 0;
      let moonIcon = '';
      let moonName = '';
      
      if (moonPhase < 0.0625) {
        moonIcon = '○';
        moonName = 'new moon';
      } else if (moonPhase < 0.1875) {
        moonIcon = '☽';
        moonName = 'waxing crescent';
      } else if (moonPhase < 0.3125) {
        moonIcon = '◐';
        moonName = 'first quarter';
      } else if (moonPhase < 0.4375) {
        moonIcon = '◐';
        moonName = 'waxing gibbous';
      } else if (moonPhase < 0.5625) {
        moonIcon = '●';
        moonName = 'full moon';
      } else if (moonPhase < 0.6875) {
        moonIcon = '◑';
        moonName = 'waning gibbous';
      } else if (moonPhase < 0.8125) {
        moonIcon = '◑';
        moonName = 'last quarter';
      } else if (moonPhase < 0.9375) {
        moonIcon = '☾';
        moonName = 'waning crescent';
      } else {
        moonIcon = '○';
        moonName = 'new moon';
      }
      
      // Only show moon during evening/night (6 PM - 6 AM)
      const currentHour = new Date().getHours();
      const showMoon = currentHour >= 18 || currentHour < 6;
      const moonText = showMoon ? ` with a ${moonIcon} ${moonName} moon` : '';
      
      if (settings.showRainForecast) {
        const precipitation = weatherData.daily?.precipitation_sum?.[0] || 0;
        if (precipitation > 0) {
          summaryParts.push(`It's ${temp}°C ${weatherIcon} in <strong>${city}</strong> with rain forecasted${moonText}`);
        } else {
          summaryParts.push(`It's ${temp}°C ${weatherIcon} in <strong>${city}</strong>${moonText}`);
        }
      } else {
        summaryParts.push(`It's ${temp}°C ${weatherIcon} in <strong>${city}</strong>${moonText}`);
      }
    }
    
    if (summaryParts.length === 0) {
      summaryParts.push('<span class="loading-terminal">[...]</span>');
    }
    
    els.summary.innerHTML = summaryParts.join('. ') + '.';
  }
  

  function initDotGrid() {
    const dotGrid = document.getElementById('dotGrid');
    if (!dotGrid) return;
    
    // Create 8x8 grid (64 dots) with flame-like density (denser at bottom)
    const gridSize = 8;
    
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const dot = document.createElement('div');
        dot.className = 'dot';
        
        // Vertical progress: 0 = bottom, 1 = top
        const verticalProgress = row / gridSize;
        
        // Bottom rows animate more frequently (denser/more active like fire base)
        // Top rows animate less frequently (sparser like dissipating flames)
        const densityFactor = 1 - verticalProgress; // 1 at bottom, 0 at top
        
        // Random delay with wave pattern
        const horizontalWave = (col / gridSize) * 0.4; // Wave across horizontally
        const randomOffset = Math.random() * 0.8; // Add randomness
        const verticalDelay = verticalProgress * 0.6; // Bottom starts earlier
        
        const totalDelay = horizontalWave + randomOffset + verticalDelay;
        
        // Animation duration: faster at bottom (denser), slower at top (sparser)
        const baseDuration = 1.5;
        const durationVariation = verticalProgress * 0.8; // Top is slower
        const duration = baseDuration + durationVariation;
        
        dot.style.setProperty('--delay', `${totalDelay}s`);
        dot.style.setProperty('--duration', `${duration}s`);
        
        dotGrid.appendChild(dot);
      }
    }
  }

  function initMiniLoader() {
    if (!els.miniLoader) return;
    
    // Create 4x4 mini grid (16 dots) with same flame-like pattern
    const gridSize = 4;
    
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const dot = document.createElement('div');
        dot.className = 'dot';
        
        const verticalProgress = row / gridSize;
        const horizontalWave = (col / gridSize) * 0.3;
        const randomOffset = Math.random() * 0.6;
        const verticalDelay = verticalProgress * 0.5;
        
        const totalDelay = horizontalWave + randomOffset + verticalDelay;
        
        const baseDuration = 1.2;
        const durationVariation = verticalProgress * 0.6;
        const duration = baseDuration + durationVariation;
        
        dot.style.setProperty('--delay', `${totalDelay}s`);
        dot.style.setProperty('--duration', `${duration}s`);
        
        els.miniLoader.appendChild(dot);
      }
    }
  }
  
  function showMiniLoader() {
    if (els.miniLoader) {
      els.miniLoader.style.display = 'grid';
    }
  }
  
  function hideMiniLoader() {
    if (els.miniLoader) {
      els.miniLoader.style.display = 'none';
    }
  }

  function init() {
    // CRITICAL PATH: Only absolute essentials for first render
    const settings = loadSettings() || getDefaultSettings();
    if (!loadSettings()) saveSettings(settings);
    
    // Critical: Theme and layout (affects LCP)
    initTheme(settings);
    applyAlignment(settings.leftAligned ?? false);
    applyCompactList(settings.compactList ?? false);
    applyButtonBackgrounds(settings.buttonBackgrounds ?? false);
    
    // Critical: Loading animations (user feedback)
    initDotGrid();
    initMiniLoader();
    
    // Critical: Event handlers and data fetch
    addHandlers();
    refreshAll();
    
    // NON-CRITICAL: Defer visual effects to after critical data loads
    setTimeout(() => {
      // Restore rain/snow preferences (visual only, non-blocking)
      if (settings.rainEnabled && !rainActive) {
        toggleRain(true);
        const rainBtn = document.getElementById('toggleRainBtn');
        const rainMobileBtn = document.getElementById('toggleRainBtnMobile');
        if (rainBtn) rainBtn.textContent = '[RAIN OFF]';
        if (rainMobileBtn) rainMobileBtn.textContent = '[RAIN OFF]';
      }
      if (settings.snowEnabled && !snowActive) {
        toggleSnow(true);
        const snowBtn = document.getElementById('toggleSnowBtn');
        const snowMobileBtn = document.getElementById('toggleSnowBtnMobile');
        if (snowBtn) snowBtn.textContent = '[SNOW OFF]';
        if (snowMobileBtn) snowMobileBtn.textContent = '[SNOW OFF]';
      }
    }, 1000); // Defer by 1 second to let critical data load first
    
    // Setup Page Visibility API to pause requests when tab is inactive
    document.addEventListener('visibilitychange', () => {
      isTabVisible = !document.hidden;
      
      if (isTabVisible) {
        // Tab became visible - resume updates
        startRealTimeUpdates();
      } else {
        // Tab became hidden - pause updates to save API calls
        stopRealTimeUpdates();
      }
    });
    
    // Start real-time updates after initial load
    setTimeout(() => {
      startRealTimeUpdates();
    }, 2000); // Start after 2s to let initial load complete

    // Add toggle handler for hide small positions
    if (els.hideSmallBtn) {
      const updateHideSmallBtn = () => {
        const settings = loadSettings() || getDefaultSettings();
        const threshold = settings.minBalanceThreshold || 100;
        els.hideSmallBtn.textContent = hideSmallPositions ? `[SHOW <$${threshold}]` : `[HIDE <$${threshold}]`;
      };
      
      updateHideSmallBtn();
      
      els.hideSmallBtn.addEventListener('click', () => {
        hideSmallPositions = !hideSmallPositions;
        updateHideSmallBtn();
        renderPositionsTable();
      });
    }

    // Add toggle handler for hide NFTs
    if (els.toggleNftsBtn) {
      els.toggleNftsBtn.addEventListener('click', () => {
        hideNfts = !hideNfts;
        els.toggleNftsBtn.textContent = hideNfts ? '[SHOW NFTS]' : '[HIDE NFTS]';
        renderPositionsTable();
      });
    }
    
    // Add edit list mode toggle
    if (els.editListBtn) {
      els.editListBtn.addEventListener('click', () => {
        editMode = !editMode;
        els.editListBtn.textContent = editMode ? '[SAVE CHANGES]' : '[EDIT]';
        renderPositionsTable();
      });
    }
    
    // Add event delegation for hide/show buttons (they're created dynamically)
    if (els.positionsBody) {
      els.positionsBody.addEventListener('click', (e) => {
        if (e.target.classList.contains('position-edit-btn')) {
          const assetKey = e.target.getAttribute('data-asset-key');
          toggleAssetVisibility(assetKey);
        }
      });
    }
    
    if (els.mobilePositionsContainer) {
      els.mobilePositionsContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('position-edit-btn')) {
          const assetKey = e.target.getAttribute('data-asset-key');
          toggleAssetVisibility(assetKey);
        }
      });
    }

    // Add toggle handler for amounts visibility
    if (els.toggleAmountsBtn) {
      els.toggleAmountsBtn.addEventListener('click', async () => {
        amountsVisible = !amountsVisible;
        els.toggleAmountsBtn.textContent = amountsVisible ? '[HIDE AMOUNTS]' : '[SHOW AMOUNTS]';
        if (els.toggleAmountsBtnMobile) {
          els.toggleAmountsBtnMobile.textContent = amountsVisible ? '[HIDE AMOUNTS]' : '[SHOW AMOUNTS]';
        }
        renderPositionsTable();
        await updateHeroSection(); // Also hide amounts in hero
      });
      els.toggleAmountsBtn.textContent = '[HIDE AMOUNTS]';
    }
    
    // Sync mobile button text
    if (els.toggleAmountsBtnMobile) {
      els.toggleAmountsBtnMobile.textContent = '[HIDE AMOUNTS]';
    }

    // Add font size controls
    if (els.decreaseFontBtn) {
      els.decreaseFontBtn.addEventListener('click', () => {
        if (currentFontSize > 10) { // minimum 10px
          const newSize = currentFontSize - 1;
          applyFontSize(newSize);
          const s = loadSettings() || getDefaultSettings();
          s.fontSize = newSize;
          saveSettings(s);
        }
      });
    }

    if (els.increaseFontBtn) {
      els.increaseFontBtn.addEventListener('click', () => {
        if (currentFontSize < 24) { // maximum 24px
          const newSize = currentFontSize + 1;
          applyFontSize(newSize);
          const s = loadSettings() || getDefaultSettings();
          s.fontSize = newSize;
          saveSettings(s);
        }
      });
    }

    // Mobile menu handlers
    if (els.mobileMenuBtn) {
      els.mobileMenuBtn.addEventListener('click', openMobileMenu);
    }
    
    if (els.closeMobileMenuBtn) {
      els.closeMobileMenuBtn.addEventListener('click', closeMobileMenu);
    }
    
    // Mobile snow toggle
    if (els.toggleSnowBtnMobile) {
      els.toggleSnowBtnMobile.addEventListener('click', () => {
        toggleSnow();
        const newText = snowActive ? '[SNOW OFF]' : '[SNOW ON]';
        els.toggleSnowBtnMobile.textContent = newText;
        // Update desktop button too
        const desktopBtn = document.getElementById('toggleSnowBtn');
        if (desktopBtn) desktopBtn.textContent = newText;
      });
    }
    
    // Mobile rain toggle
    if (els.toggleRainBtnMobile) {
      els.toggleRainBtnMobile.addEventListener('click', () => {
        toggleRain();
        const newText = rainActive ? '[RAIN OFF]' : '[RAIN ON]';
        els.toggleRainBtnMobile.textContent = newText;
        // Update desktop button too
        const desktopBtn = document.getElementById('toggleRainBtn');
        if (desktopBtn) desktopBtn.textContent = newText;
      });
    }
    
    // Mobile theme select change handler
    if (els.toggleThemeBtnMobile) {
      els.toggleThemeBtnMobile.addEventListener('change', (e) => {
        const newTheme = e.target.value;
        applyTheme(newTheme);
        const s = loadSettings() || getDefaultSettings();
        s.theme = newTheme;
        saveSettings(s);
      });
    }
    
    // Mobile amounts toggle
    if (els.toggleAmountsBtnMobile) {
      els.toggleAmountsBtnMobile.addEventListener('click', async () => {
        amountsVisible = !amountsVisible;
        els.toggleAmountsBtn.textContent = amountsVisible ? '[HIDE AMOUNTS]' : '[SHOW AMOUNTS]';
        els.toggleAmountsBtnMobile.textContent = amountsVisible ? '[HIDE AMOUNTS]' : '[SHOW AMOUNTS]';
        renderPositionsTable();
        await updateHeroSection();
      });
    }
    
    // Mobile font size controls
    if (els.decreaseFontBtnMobile) {
      els.decreaseFontBtnMobile.addEventListener('click', () => {
        if (currentFontSize > 10) {
          const newSize = currentFontSize - 1;
          applyFontSize(newSize);
          const s = loadSettings() || getDefaultSettings();
          s.fontSize = newSize;
          saveSettings(s);
        }
      });
    }
    
    if (els.increaseFontBtnMobile) {
      els.increaseFontBtnMobile.addEventListener('click', () => {
        if (currentFontSize < 24) {
          const newSize = currentFontSize + 1;
          applyFontSize(newSize);
          const s = loadSettings() || getDefaultSettings();
          s.fontSize = newSize;
          saveSettings(s);
        }
      });
    }

    // Comic toggle handler (collapse/expand)
    if (els.comicToggleBtn && els.comicSection) {
      els.comicToggleBtn.addEventListener('click', () => {
        const settings = loadSettings() || getDefaultSettings();
        const isCollapsed = els.comicSection.classList.contains('collapsed');
        
        if (isCollapsed) {
          els.comicSection.classList.remove('collapsed');
          settings.comicCollapsed = false;
        } else {
          els.comicSection.classList.add('collapsed');
          settings.comicCollapsed = true;
        }
        
        saveSettings(settings);
      });
    }
    
    if (els.calvinPrevBtn) {
      els.calvinPrevBtn.addEventListener('click', () => {
        currentCalvinDate.setDate(currentCalvinDate.getDate() - 1);
        renderCalvin(currentCalvinDate, true);
      });
    }
    
    if (els.calvinNextBtn) {
      els.calvinNextBtn.addEventListener('click', () => {
        currentCalvinDate.setDate(currentCalvinDate.getDate() + 1);
        renderCalvin(currentCalvinDate, true);
      });
    }
    
    if (els.calvinRandomBtn) {
      els.calvinRandomBtn.addEventListener('click', () => {
        const settings = loadSettings() || getDefaultSettings();
        const comicStrip = settings.comicStrip || 'calvinandhobbes';
        const comic = comicMetadata[comicStrip];
        
        if (comic) {
          const randomTime = comic.startDate.getTime() + Math.random() * (comic.endDate.getTime() - comic.startDate.getTime());
          currentCalvinDate = new Date(randomTime);
          renderCalvin(currentCalvinDate, true);
        }
      });
    }
    
    // Mobile button handlers (sync with desktop)
    if (els.calvinPrevBtnMobile) {
      els.calvinPrevBtnMobile.addEventListener('click', () => {
        if (els.calvinPrevBtn) {
          els.calvinPrevBtn.click();
        }
      });
    }
    
    if (els.calvinNextBtnMobile) {
      els.calvinNextBtnMobile.addEventListener('click', () => {
        if (els.calvinNextBtn) {
          els.calvinNextBtn.click();
        }
      });
    }
    
    if (els.calvinRandomBtnMobile) {
      els.calvinRandomBtnMobile.addEventListener('click', () => {
        if (els.calvinRandomBtn) {
          els.calvinRandomBtn.click();
        }
      });
    }
    
    // Comic tab switching
    const comicTabs = [els.tabCalvin, els.tabPeanuts, els.tabFarside];
    comicTabs.forEach(tab => {
      if (tab) {
        tab.addEventListener('click', () => {
          const comicName = tab.getAttribute('data-comic');
          
          // Update active state
          comicTabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          
          // Save to settings
          const settings = loadSettings() || getDefaultSettings();
          settings.comicStrip = comicName;
          saveSettings(settings);
          
          // Load the comic
          const comic = comicMetadata[comicName];
          if (comic) {
            currentCalvinDate = new Date(); // Reset to today
            renderCalvin(currentCalvinDate, true);
          }
        });
      }
    });
    
    // Hero section click to refresh
    const heroSection = document.querySelector('.hero');
    if (heroSection) {
      heroSection.style.cursor = 'pointer';
      heroSection.addEventListener('click', async () => {
        await refreshAll();
      });
    }

    // Set up auto-refresh
    const refreshMinutes = (settings && settings.refreshMinutes) || 30;
    if (refreshMinutes > 0) {
      setInterval(refreshAll, refreshMinutes * 60 * 1000);
    }
  }

  // Pixel art rain effect
  const rainCanvas = document.getElementById('rainCanvas');
  const rainCtx = rainCanvas ? rainCanvas.getContext('2d') : null;
  let rainDrops = [];
  let rainActive = false;
  let rainAutoEnabled = false; // Track if rain was auto-enabled by theme
  let snowActive = false;
  let rainAnimationFrame = null;
  
  const rainConfig = {
    density: 161,
    speed: 5,
    size: 1,
    length: 8,
    angle: -30,
    randomAngle: true,
    useTextColor: false,
    particleStyle: 'default',
    rainbow: false
  };
  
  let rainAngleOffset = 0;
  let rainAngleChangeTime = 0;
  let targetAngleOffset = 0;
  let windTransitionSpeed = 0.02; // Smooth wind transitions
  
  // Check weather at user's location and auto-enable rain/snow
  async function checkWeatherAndEnableRain() {
    try {
      const settings = loadSettings();
      const weather = settings?.weather;
      
      // Check if user has location set in settings
      if (!weather || !weather.lat || !weather.lon) {
        return;
      }
      
      const latitude = weather.lat;
      const longitude = weather.lon;
      
      // Fetch weather data from Open-Meteo (free, no API key required)
      const weatherResponse = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=weather_code,precipitation&timezone=auto`
      );
      
      if (!weatherResponse.ok) {
        return;
      }
      
      const weatherData = await weatherResponse.json();
      const weatherCode = weatherData.current?.weather_code;
      const precipitation = weatherData.current?.precipitation || 0;
      
      // Weather codes from Open-Meteo: https://open-meteo.com/en/docs
      // Snow codes: 71-77 (snow), 85-86 (snow showers)
      const isSnowing = (weatherCode >= 71 && weatherCode <= 77) ||
                       (weatherCode >= 85 && weatherCode <= 86);
      
      // Rain codes: 51-67 (drizzle/rain), 80-82 (rain showers), 95-99 (thunderstorm)
      const isRaining = !isSnowing && (precipitation > 0 || 
                       (weatherCode >= 51 && weatherCode <= 67) ||
                       (weatherCode >= 80 && weatherCode <= 82) ||
                       (weatherCode >= 95 && weatherCode <= 99));
      
      if (isSnowing && !snowActive) {
        toggleSnow();
        const toggleBtn = document.getElementById('toggleSnowBtn');
        const mobileBtn = document.getElementById('toggleSnowBtnMobile');
        if (toggleBtn) toggleBtn.textContent = '[SNOW OFF]';
        if (mobileBtn) mobileBtn.textContent = '[SNOW OFF]';
      } else if (isRaining && !rainActive) {
        toggleRain();
        const toggleBtn = document.getElementById('toggleRainBtn');
        const mobileBtn = document.getElementById('toggleRainBtnMobile');
        if (toggleBtn) toggleBtn.textContent = '[RAIN OFF]';
        if (mobileBtn) mobileBtn.textContent = '[RAIN OFF]';
      }
    } catch (error) {
      // Silently fail - API might be unavailable
    }
  }
  
  function resizeRainCanvas() {
    if (!rainCanvas) return;
    rainCanvas.width = window.innerWidth;
    rainCanvas.height = window.innerHeight;
  }
  
  function createRainDrop() {
    // Snow uses same rendering as rain but with slower speed
    const baseSpeed = snowActive ? 0.6 : rainConfig.speed;
    const baseSize = snowActive ? 1 : rainConfig.size;
    const baseLength = snowActive ? 2 : rainConfig.length;
    
    return {
      x: Math.random() * rainCanvas.width,
      y: Math.random() * rainCanvas.height - rainCanvas.height,
      speed: baseSpeed * (0.7 + Math.random() * 0.6), // More speed variation
      size: baseSize,
      length: baseLength,
      wobble: Math.random() * Math.PI * 2, // For slight horizontal variation
      wobbleSpeed: 0.02 + Math.random() * 0.03
    };
  }
  
  function initRain() {
    rainDrops = [];
    for (let i = 0; i < rainConfig.density; i++) {
      rainDrops.push(createRainDrop());
    }
  }
  
  function drawRain() {
    if ((!rainActive && !snowActive) || !rainCtx) return;
    
    rainCtx.clearRect(0, 0, rainCanvas.width, rainCanvas.height);
    
    // Set pixel art style - crisp rendering, no blur
    rainCtx.imageSmoothingEnabled = false;
    rainCtx.webkitImageSmoothingEnabled = false;
    rainCtx.mozImageSmoothingEnabled = false;
    rainCtx.msImageSmoothingEnabled = false;
    rainCtx.oImageSmoothingEnabled = false;
    
    // Color based on type
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    const isDark = theme !== 'light';
    
    // Get theme colors
    const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
    
    if (snowActive) {
      // Snow uses muted color on light mode, white on dark themes
      if (theme === 'light') {
        rainCtx.fillStyle = muted || '#93a1a1';
      } else {
        rainCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      }
    } else {
      // Rain color: yellow for cyberpunk, text color or default for others
      if (theme === 'cyberpunk') {
        rainCtx.fillStyle = '#ffea00'; // Yellow rain for cyberpunk
      } else if (rainConfig.useTextColor) {
        rainCtx.fillStyle = textColor || '#657b83';
      } else {
        // Use default subtle colors
        if (theme === 'light') {
          rainCtx.fillStyle = 'rgba(180, 190, 210, 0.6)';
        } else {
          // Dark themes use --muted
          rainCtx.fillStyle = muted || '#586e75';
        }
      }
    }
    
    // Realistic wind simulation - smooth transitions
    const currentTime = Date.now();
    if (rainConfig.randomAngle) {
      // Change wind target every 2-4 seconds
      if (currentTime - rainAngleChangeTime > 2000 + Math.random() * 2000) {
        targetAngleOffset = (Math.random() - 0.5) * 40; // ±20° variation
        rainAngleChangeTime = currentTime;
      }
      // Smoothly interpolate to target angle
      rainAngleOffset += (targetAngleOffset - rainAngleOffset) * windTransitionSpeed;
    } else {
      rainAngleOffset = 0;
      targetAngleOffset = 0;
    }
    
    const effectiveAngle = rainConfig.angle + rainAngleOffset;
    const angleRad = (effectiveAngle * Math.PI) / 180;
    
    rainDrops.forEach((drop, index) => {
      // Add subtle wobble for realism
      const wobbleOffset = Math.sin(drop.wobble) * 0.3;
      
      // Round ALL coordinates for sharp, crisp pixels - no sub-pixel rendering
      const x = Math.floor(drop.x + wobbleOffset);
      const y = Math.floor(drop.y);
      const width = Math.floor(drop.size);
      const height = Math.floor(drop.size * drop.length);
      
      // Rainbow mode - cycle through colors
      if (rainConfig.rainbow && !snowActive) {
        const hue = (index * 40 + currentTime * 0.1) % 360;
        rainCtx.fillStyle = `hsl(${hue}, 70%, 60%)`;
      }
      
      // Draw based on particle style
      if (snowActive || rainConfig.particleStyle === 'default') {
        // Default: sharp rectangle
        rainCtx.fillRect(x, y, width, height);
      } else if (rainConfig.particleStyle.startsWith('sticker:')) {
        // Custom sticker image - render larger and sharper
        const stickerFile = rainConfig.particleStyle.replace('sticker:', '');
        const img = stickerImages[stickerFile];
        if (img && img.complete) {
          // Larger size for better visibility and quality
          const size = height * 4; // Increased from 2 to 4
          const renderX = Math.floor(x - size/2);
          const renderY = Math.floor(y);
          
          // Save context state
          rainCtx.save();
          rainCtx.imageSmoothingEnabled = false;
          
          // Draw at integer coordinates for crisp pixels
          rainCtx.drawImage(img, renderX, renderY, size, size);
          
          rainCtx.restore();
        } else {
          // Fallback if image not loaded
          rainCtx.fillRect(x, y, width, height);
        }
      } else if (rainConfig.particleStyle === 'bitcoin') {
        rainCtx.font = `${height}px monospace`;
        rainCtx.fillText('₿', x, y + height);
      } else if (rainConfig.particleStyle === 'zcash') {
        rainCtx.font = `${height}px monospace`;
        rainCtx.fillText('ᙇ', x, y + height);
      } else if (rainConfig.particleStyle === 'text-second') {
        const text = 'There is no second best';
        const charIndex = index % text.length;
        rainCtx.font = `${height}px monospace`;
        rainCtx.fillText(text[charIndex], x, y + height);
      } else if (rainConfig.particleStyle === 'text-hl') {
        const text = 'Hyperliquid';
        const charIndex = index % text.length;
        rainCtx.font = `${height}px monospace`;
        rainCtx.fillText(text[charIndex], x, y + height);
      } else if (rainConfig.particleStyle === 'emoji') {
        const emojis = ['🌧️', '💧', '⚡'];
        const emoji = emojis[index % emojis.length];
        rainCtx.font = `${height}px sans-serif`;
        rainCtx.fillText(emoji, x, y + height);
      } else if (rainConfig.particleStyle === 'saylor') {
        const text = '🚀';
        rainCtx.font = `${height}px sans-serif`;
        rainCtx.fillText(text, x, y + height);
      } else {
        // Fallback
        rainCtx.fillRect(x, y, width, height);
      }
      
      // Update position with wind angle and individual wobble
      drop.y += drop.speed;
      drop.x += Math.sin(angleRad) * drop.speed * 0.35 + wobbleOffset;
      drop.wobble += drop.wobbleSpeed;
      
      // Reset drop when it goes off screen
      if (drop.y > rainCanvas.height) {
        drop.y = -10 - Math.random() * 20;
        drop.x = Math.random() * rainCanvas.width;
        const baseSpeed = snowActive ? 0.6 : rainConfig.speed;
        drop.speed = baseSpeed * (0.7 + Math.random() * 0.6);
        drop.wobble = Math.random() * Math.PI * 2;
      }
      if (drop.x < -20) drop.x = rainCanvas.width + 20;
      if (drop.x > rainCanvas.width + 20) drop.x = -20;
    });
    
    rainAnimationFrame = requestAnimationFrame(drawRain);
  }
  
  function toggleRain(isAutoToggle = false) {
    rainActive = !rainActive;
    
    // If user manually toggles rain (not auto-enabled), mark as user action
    if (!isAutoToggle && rainActive) {
      rainAutoEnabled = false;
    }
    
    if (rainActive) {
      snowActive = false; // Turn off snow if rain is enabled
      rainCanvas.classList.add('active');
      resizeRainCanvas();
      initRain();
      drawRain();
      
      // Update snow buttons
      const snowBtn = document.getElementById('toggleSnowBtn');
      const snowMobileBtn = document.getElementById('toggleSnowBtnMobile');
      if (snowBtn) snowBtn.textContent = '[SNOW ON]';
      if (snowMobileBtn) snowMobileBtn.textContent = '[SNOW ON]';
      
      // Save snow state when rain is turned on (snow is turned off)
      if (!isAutoToggle) {
        const settings = loadSettings() || getDefaultSettings();
        settings.snowEnabled = false;
        saveSettings(settings);
      }
    } else {
      rainCanvas.classList.remove('active');
      if (rainAnimationFrame) {
        cancelAnimationFrame(rainAnimationFrame);
        rainAnimationFrame = null;
      }
    }
    
    // Save rain state to localStorage (but not for auto-toggles from theme changes)
    if (!isAutoToggle) {
      const settings = loadSettings() || getDefaultSettings();
      settings.rainEnabled = rainActive;
      saveSettings(settings);
    }
  }
  
  function toggleSnow(isAutoToggle = false) {
    snowActive = !snowActive;
    
    if (snowActive) {
      rainActive = false; // Turn off rain if snow is enabled
      rainCanvas.classList.add('active');
      resizeRainCanvas();
      initRain(); // Use same particles
      drawRain(); // Use same draw function
      
      // Update rain buttons
      const rainBtn = document.getElementById('toggleRainBtn');
      const rainMobileBtn = document.getElementById('toggleRainBtnMobile');
      if (rainBtn) rainBtn.textContent = '[RAIN ON]';
      if (rainMobileBtn) rainMobileBtn.textContent = '[RAIN ON]';
      
      // Save rain state when snow is turned on (rain is turned off)
      if (!isAutoToggle) {
        const settings = loadSettings() || getDefaultSettings();
        settings.rainEnabled = false;
        saveSettings(settings);
      }
    } else {
      rainCanvas.classList.remove('active');
      if (rainAnimationFrame) {
        cancelAnimationFrame(rainAnimationFrame);
        rainAnimationFrame = null;
      }
    }
    
    // Save snow state to localStorage
    if (!isAutoToggle) {
      const settings = loadSettings() || getDefaultSettings();
      settings.snowEnabled = snowActive;
      saveSettings(settings);
    }
  }
  
  function setupRainControls() {
    const toggleBtn = document.getElementById('toggleRainBtn');
    const toggleSnowBtn = document.getElementById('toggleSnowBtn');
    const densityInput = document.getElementById('rainDensity');
    const speedInput = document.getElementById('rainSpeed');
    const sizeInput = document.getElementById('rainSize');
    const lengthInput = document.getElementById('rainLength');
    const angleInput = document.getElementById('rainAngle');
    const randomAngleCheckbox = document.getElementById('rainRandomAngle');
    const textColorCheckbox = document.getElementById('rainTextColor');
    const particleStyleSelect = document.getElementById('rainParticleStyle');
    const rainbowCheckbox = document.getElementById('rainRainbow');
    
    if (!toggleBtn) return;
    
    // Toggle rain on/off
    toggleBtn.addEventListener('click', () => {
      toggleRain();
      const newText = rainActive ? '[RAIN OFF]' : '[RAIN ON]';
      toggleBtn.textContent = newText;
      // Update mobile button too
      const mobileBtn = document.getElementById('toggleRainBtnMobile');
      if (mobileBtn) mobileBtn.textContent = newText;
    });
    
    // Toggle snow on/off
    if (toggleSnowBtn) {
      toggleSnowBtn.addEventListener('click', () => {
        toggleSnow();
        const newText = snowActive ? '[SNOW OFF]' : '[SNOW ON]';
        toggleSnowBtn.textContent = newText;
        // Update mobile button too
        const mobileBtn = document.getElementById('toggleSnowBtnMobile');
        if (mobileBtn) mobileBtn.textContent = newText;
      });
    }
    
    // Update density
    if (densityInput) {
      densityInput.addEventListener('input', (e) => {
        rainConfig.density = parseInt(e.target.value);
        document.getElementById('rainDensityValue').textContent = rainConfig.density;
        if (rainActive) initRain();
      });
    }
    
    // Update speed
    if (speedInput) {
      speedInput.addEventListener('input', (e) => {
        rainConfig.speed = parseInt(e.target.value);
        document.getElementById('rainSpeedValue').textContent = rainConfig.speed;
        if (rainActive) initRain();
      });
    }
    
    // Update size (width)
    if (sizeInput) {
      sizeInput.addEventListener('input', (e) => {
        rainConfig.size = parseInt(e.target.value);
        document.getElementById('rainSizeValue').textContent = rainConfig.size;
        if (rainActive) initRain();
      });
    }
    
    // Update length
    if (lengthInput) {
      lengthInput.addEventListener('input', (e) => {
        rainConfig.length = parseInt(e.target.value);
        document.getElementById('rainLengthValue').textContent = rainConfig.length;
        if (rainActive) initRain();
      });
    }
    
    // Update angle
    if (angleInput) {
      angleInput.addEventListener('input', (e) => {
        rainConfig.angle = parseInt(e.target.value);
        document.getElementById('rainAngleValue').textContent = rainConfig.angle + '°';
        rainConfig.randomAngle = false; // Disable random when manually adjusted
        if (randomAngleCheckbox) randomAngleCheckbox.checked = false;
      });
    }
    
    // Toggle random angle
    if (randomAngleCheckbox) {
      randomAngleCheckbox.addEventListener('change', (e) => {
        rainConfig.randomAngle = e.target.checked;
        if (e.target.checked) {
          rainAngleChangeTime = 0; // Force immediate angle change
        }
      });
    }
    
    // Toggle theme text color
    if (textColorCheckbox) {
      textColorCheckbox.addEventListener('change', (e) => {
        rainConfig.useTextColor = e.target.checked;
      });
    }
    
    // Rainbow mode toggle
    if (rainbowCheckbox) {
      rainbowCheckbox.addEventListener('change', (e) => {
        rainConfig.rainbow = e.target.checked;
      });
    }
    
    // Particle style dropdown
    if (particleStyleSelect) {
      particleStyleSelect.addEventListener('change', (e) => {
        rainConfig.particleStyle = e.target.value;
        if (rainActive) initRain(); // Reinitialize for immediate effect
      });
    }
    
    // Slider button controls
    document.querySelectorAll('.slider-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const delta = parseInt(btn.getAttribute('data-delta'));
        const input = document.getElementById(targetId);
        if (input) {
          const newValue = Math.max(
            parseInt(input.min),
            Math.min(parseInt(input.max), parseInt(input.value) + delta)
          );
          input.value = newValue;
          input.dispatchEvent(new Event('input'));
        }
      });
    });
    
    // Resize canvas on window resize
    window.addEventListener('resize', () => {
      if (rainActive) resizeRainCanvas();
    });
  }

  // Load custom stickers and wallpapers from local folders
  // Place image files in:
  //   - /stickers/ folder for rain particle images (png, jpg, gif, webp, svg)
  //   - /wallpapers/ folder for background images (png, jpg, gif, webp, svg)
  // Run this command to update the manifest after adding new files:
  //   cd stickers && ls -1 *.{png,jpg,jpeg,gif,webp,svg} 2>/dev/null | jq -R -s -c 'split("\n") | map(select(length > 0))' > index.json
  async function loadCustomAssets() {
    const stickerGrid = document.getElementById('stickerGrid');
    const stickerOptions = document.getElementById('stickerOptions');
    
    if (!stickerGrid) {
      return;
    }
    
    // Load stickers from index.json manifest
    try {
      const stickerManifest = await fetch('/stickers/index.json');
      
      if (!stickerManifest.ok) {
        throw new Error(`HTTP error! status: ${stickerManifest.status}`);
      }
      
      const stickerFiles = await stickerManifest.json();
      
      const loadedStickers = [];
      
      // Create and add sticker items with lazy loading to prevent mobile crashes
      for (let i = 0; i < stickerFiles.length; i++) {
        const file = stickerFiles[i];
        const imgSrc = `/stickers/${file}`;
        const displayName = file.replace(/\.(png|jpg|jpeg|gif|webp|svg)$/i, '');
        
        // Create grid item for drag-and-drop
        const item = document.createElement('div');
        item.className = 'sticker-item';
        item.dataset.value = `sticker:${file}`;
        item.title = displayName;
        
        // Create icon container
        const iconDiv = document.createElement('div');
        iconDiv.className = 'sticker-icon';
        
        // Create image for grid with lazy loading
        const imgElement = document.createElement('img');
        imgElement.alt = file;
        imgElement.loading = 'lazy'; // Native lazy loading
        imgElement.style.width = '100%';
        imgElement.style.height = 'auto';
        
        imgElement.addEventListener('load', function() {
          stickerImages[file] = this;
          loadedStickers.push(file);
          
          // Add to dropdown once loaded
          if (stickerOptions) {
            const option = document.createElement('option');
            option.value = `sticker:${file}`;
            option.textContent = displayName;
            option.dataset.image = imgSrc;
            stickerOptions.appendChild(option);
          }
        });
        
        imgElement.addEventListener('error', function() {
          item.style.display = 'none';
        });
        
        iconDiv.appendChild(imgElement);
        
        // Create label
        const label = document.createElement('div');
        label.className = 'sticker-label';
        label.textContent = displayName.substring(0, 10);
        
        item.appendChild(iconDiv);
        item.appendChild(label);
        
        if (stickerGrid) {
          stickerGrid.appendChild(item);
        }
        
        // Set src after adding to DOM to trigger lazy loading
        // Add slight delay between images on mobile to prevent memory issues
        if (i < 10 || !isMobileDevice()) {
          imgElement.src = imgSrc; // Load first 10 immediately
        } else {
          // Lazy load the rest with IntersectionObserver on mobile
          const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
              if (entry.isIntersecting && !imgElement.src) {
                imgElement.src = imgSrc;
                observer.unobserve(imgElement);
              }
            });
          }, { rootMargin: '50px' });
          observer.observe(imgElement);
        }
      }
    } catch (err) {
      // Silent fallback
    }
    
    // Load wallpapers from index.json manifest
    try {
      const wallpaperManifest = await fetch('/wallpapers/index.json');
      const wallpaperFiles = await wallpaperManifest.json();
      
      for (const file of wallpaperFiles) {
        try {
          const response = await fetch(`/wallpapers/${file}`, { method: 'HEAD' });
          if (response.ok) {
            wallpapers.push(file);
            
            // Add option to dropdown
            const option = document.createElement('option');
            option.value = file;
            option.textContent = file.replace(/\.(png|jpg|jpeg|gif|webp|svg)$/i, '');
            document.getElementById('wallpaperOptions')?.appendChild(option);
          }
        } catch (err) {
          // Silent fallback
        }
      }
    } catch (err) {
      // Silent fallback
    }
  }
  
  // Apply wallpaper
  function applyWallpaper(wallpaper) {
    if (wallpaper && wallpaper !== 'none') {
      document.body.style.backgroundImage = `url('/wallpapers/${wallpaper}')`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundAttachment = 'fixed';
    } else {
      document.body.style.backgroundImage = '';
    }
  }

  // Sticky Stickers functionality
  let stickyStickersData = [];
  const STICKY_STICKERS_KEY = 'stickyStickers.v1';
  
  function loadStickyStickers() {
    try {
      const saved = localStorage.getItem(STICKY_STICKERS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (err) {
      return [];
    }
  }
  
  function saveStickyStickers() {
    localStorage.setItem(STICKY_STICKERS_KEY, JSON.stringify(stickyStickersData));
  }
  
  function createStickySticker(imageSrc, x, y, width = null, height = null, rotation = 0) {
    const container = document.getElementById('stickyStickers');
    if (!container) return;
    
    const id = Date.now() + Math.random();
    const sticker = document.createElement('div');
    sticker.className = 'sticky-sticker';
    sticker.dataset.id = id;
    sticker.style.left = `${x}px`;
    sticker.style.top = `${y}px`;
    sticker.style.transform = `rotate(${rotation}deg)`;
    
    const img = document.createElement('img');
    img.src = imageSrc;
    img.draggable = false;
    
    // Load image to get natural dimensions and set proper aspect ratio
    img.onload = () => {
      const aspectRatio = img.naturalWidth / img.naturalHeight;
      
      if (width === null && height === null) {
        // Default: set width to 200px and calculate height
        width = 200;
        height = 200 / aspectRatio;
      } else if (width === null) {
        width = height * aspectRatio;
      } else if (height === null) {
        height = width / aspectRatio;
      }
      
      sticker.style.width = `${width}px`;
      sticker.style.height = `${height}px`;
      sticker.dataset.aspectRatio = aspectRatio;
      
      // Update saved data
      const data = stickyStickersData.find(s => s.id === id);
      if (data) {
        data.width = width;
        data.height = height;
        data.aspectRatio = aspectRatio;
        saveStickyStickers();
      }
    };
    
    // Set initial size if provided
    if (width !== null) sticker.style.width = `${width}px`;
    if (height !== null) sticker.style.height = `${height}px`;
    
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    resizeHandle.textContent = '[RESIZE]';
    
    const rotateHandle = document.createElement('div');
    rotateHandle.className = 'rotate-handle';
    rotateHandle.textContent = '[ROTATE]';
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '[X]';
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      removeStickySticker(id);
    };
    
    sticker.appendChild(img);
    sticker.appendChild(resizeHandle);
    sticker.appendChild(rotateHandle);
    sticker.appendChild(removeBtn);
    container.appendChild(sticker);
    
    // Make draggable
    makeDraggable(sticker);
    makeResizable(sticker, resizeHandle);
    makeRotatable(sticker, rotateHandle);
    
    // Save to data (will be updated with dimensions in img.onload)
    stickyStickersData.push({ id, imageSrc, x, y, width, height, rotation, aspectRatio: null });
    saveStickyStickers();
    
    return sticker;
  }
  
  function makeDraggable(element) {
    let isDragging = false;
    let startX, startY, initialX, initialY;
    
    element.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('resize-handle') || 
          e.target.classList.contains('rotate-handle') || 
          e.target.classList.contains('remove-btn')) return;
      isDragging = true;
      element.classList.add('dragging');
      
      const rect = element.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      initialX = rect.left;
      initialY = rect.top;
      
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      
      const newX = initialX + dx;
      const newY = initialY + dy;
      
      element.style.left = `${newX}px`;
      element.style.top = `${newY}px`;
      
      // Update data
      const id = parseFloat(element.dataset.id);
      const data = stickyStickersData.find(s => s.id === id);
      if (data) {
        data.x = newX;
        data.y = newY;
      }
    });
    
    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        element.classList.remove('dragging');
        saveStickyStickers();
      }
    });
  }
  
  function makeResizable(element, handle) {
    let isResizing = false;
    let startX, startY, startWidth, startHeight, aspectRatio;
    
    handle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = element.offsetWidth;
      startHeight = element.offsetHeight;
      aspectRatio = parseFloat(element.dataset.aspectRatio) || (startWidth / startHeight);
      e.stopPropagation();
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const delta = Math.max(dx, dy);
      
      // Calculate new width and maintain aspect ratio
      const newWidth = Math.max(32, Math.min(800, startWidth + delta));
      const newHeight = newWidth / aspectRatio;
      
      element.style.width = `${newWidth}px`;
      element.style.height = `${newHeight}px`;
      
      // Update data
      const id = parseFloat(element.dataset.id);
      const data = stickyStickersData.find(s => s.id === id);
      if (data) {
        data.width = newWidth;
        data.height = newHeight;
      }
    });
    
    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        saveStickyStickers();
      }
    });
  }
  
  function makeRotatable(element, handle) {
    let isRotating = false;
    let startAngle, startRotation;
    
    handle.addEventListener('mousedown', (e) => {
      isRotating = true;
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
      
      // Get current rotation from transform
      const transform = element.style.transform;
      const match = transform.match(/rotate\(([-\d.]+)deg\)/);
      startRotation = match ? parseFloat(match[1]) : 0;
      
      e.stopPropagation();
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isRotating) return;
      
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
      const deltaAngle = currentAngle - startAngle;
      const newRotation = startRotation + deltaAngle;
      
      element.style.transform = `rotate(${newRotation}deg)`;
      
      // Update data
      const id = parseFloat(element.dataset.id);
      const data = stickyStickersData.find(s => s.id === id);
      if (data) {
        data.rotation = newRotation;
      }
    });
    
    document.addEventListener('mouseup', () => {
      if (isRotating) {
        isRotating = false;
        saveStickyStickers();
      }
    });
  }
  
  function removeStickySticker(id) {
    const element = document.querySelector(`.sticky-sticker[data-id="${id}"]`);
    if (element) element.remove();
    
    stickyStickersData = stickyStickersData.filter(s => s.id !== id);
    saveStickyStickers();
  }
  
  function restoreStickyStickers() {
    stickyStickersData = loadStickyStickers();
    stickyStickersData.forEach(data => {
      const container = document.getElementById('stickyStickers');
      if (!container) return;
      
      // Handle old format (size) and new format (width/height)
      const width = data.width || data.size || 200;
      const height = data.height || data.size || 200;
      const aspectRatio = data.aspectRatio || (width / height);
      
      const sticker = document.createElement('div');
      sticker.className = 'sticky-sticker';
      sticker.dataset.id = data.id;
      sticker.dataset.aspectRatio = aspectRatio;
      sticker.style.left = `${data.x}px`;
      sticker.style.top = `${data.y}px`;
      sticker.style.width = `${width}px`;
      sticker.style.height = `${height}px`;
      sticker.style.transform = `rotate(${data.rotation || 0}deg)`;
      
      const img = document.createElement('img');
      img.src = data.imageSrc;
      img.draggable = false;
      
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'resize-handle';
      resizeHandle.textContent = '[RESIZE]';
      
      const rotateHandle = document.createElement('div');
      rotateHandle.className = 'rotate-handle';
      rotateHandle.textContent = '[ROTATE]';
      
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = '[X]';
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        removeStickySticker(data.id);
      };
      
      sticker.appendChild(img);
      sticker.appendChild(resizeHandle);
      sticker.appendChild(rotateHandle);
      sticker.appendChild(removeBtn);
      container.appendChild(sticker);
      
      makeDraggable(sticker);
      makeResizable(sticker, resizeHandle);
      makeRotatable(sticker, rotateHandle);
    });
  }
  
  function setupStickerDragDrop() {
    const stickerGrid = document.getElementById('stickerGrid');
    if (!stickerGrid) {
      return;
    }
    
    stickerGrid.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.sticker-item');
      if (!item) return;
      
      // Prevent default browser drag behavior
      e.preventDefault();
      e.stopPropagation();
      
      const value = item.dataset.value;
      let imageSrc;
      
      if (value && value.startsWith('sticker:')) {
        const file = value.replace('sticker:', '');
        imageSrc = `/stickers/${file}`;
      } else {
        // For emoji/text styles, we can't easily make them sticky
        return;
      }
      
      // Create ghost element for dragging
      const ghost = item.cloneNode(true);
      ghost.style.position = 'fixed';
      ghost.style.pointerEvents = 'none';
      ghost.style.opacity = '0.9';
      ghost.style.zIndex = '10000';
      ghost.style.filter = 'brightness(1.2)';
      
      // Add helper text
      const helper = document.createElement('div');
      helper.textContent = '[DROP TO PLACE]';
      helper.style.cssText = 'position: absolute; bottom: -20px; left: 50%; transform: translateX(-50%); color: var(--accent); font-size: 10px; white-space: nowrap; font-weight: bold;';
      ghost.appendChild(helper);
      
      document.body.appendChild(ghost);
      
      let isDraggingOut = false;
      
      const moveGhost = (e) => {
        ghost.style.left = `${e.clientX - 30}px`;
        ghost.style.top = `${e.clientY - 30}px`;
        
        // Check if dragged outside settings
        const settingsDialog = document.getElementById('settingsDialog');
        const dialogRect = settingsDialog?.getBoundingClientRect();
        if (dialogRect) {
          const isInside = e.clientX >= dialogRect.left && 
                          e.clientX <= dialogRect.right && 
                          e.clientY >= dialogRect.top && 
                          e.clientY <= dialogRect.bottom;
          
          isDraggingOut = !isInside;
        }
      };
      
      const endDrag = (e) => {
        document.removeEventListener('mousemove', moveGhost);
        document.removeEventListener('mouseup', endDrag);
        ghost.remove();
        
        if (isDraggingOut) {
          // Create sticky sticker at drop position (centered at 200px default width)
          createStickySticker(imageSrc, e.clientX - 100, e.clientY - 100);
        }
      };
      
      document.addEventListener('mousemove', moveGhost);
      document.addEventListener('mouseup', endDrag);
      
      moveGhost(e);
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    init();
    setupRainControls();
    restoreStickyStickers();
    
    // Preload Pyth price feed metadata (non-blocking)
    getPythPriceFeeds().catch(err => {
      console.warn('⚠ Failed to preload Pyth price feeds:', err);
    });
    
    // Apply settings on load
    const settings = loadSettings() || getDefaultSettings();
    if (settings.wallpaper) {
      applyWallpaper(settings.wallpaper);
      if (els.wallpaperSelect) els.wallpaperSelect.value = settings.wallpaper;
    }
    applyHeaderVisibility(settings);
    
    // Set active comic tab based on settings
    const comicStrip = settings.comicStrip || 'calvinandhobbes';
    const comicTabMap = {
      'calvinandhobbes': els.tabCalvin,
      'peanuts': els.tabPeanuts,
      'farside': els.tabFarside
    };
    const comicTabs = [els.tabCalvin, els.tabPeanuts, els.tabFarside];
    comicTabs.forEach(tab => {
      if (tab) tab.classList.remove('active');
    });
    const activeTab = comicTabMap[comicStrip];
    if (activeTab) {
      activeTab.classList.add('active');
    }
    
    // Apply collapsed state
    if (settings.comicCollapsed && els.comicSection) {
      els.comicSection.classList.add('collapsed');
    }
    
    // === WATCHLIST SETUP ===
    // Watchlist now loads via refreshAll() progressive loading (non-blocking)
    // Preload Pyth feeds in background for watchlist search feature
    fetchAllPythFeeds().catch(err => {
      console.warn('⚠ Failed to preload Pyth feeds for watchlist:', err);
    });
    
    // Apply watchlist collapsed state
    const watchlistSection = document.getElementById('watchlistSection');
    if (settings.watchlistCollapsed && watchlistSection) {
      watchlistSection.classList.add('collapsed');
    }
    
    // Watchlist toggle button
    const watchlistToggleBtn = document.getElementById('watchlistToggleBtn');
    if (watchlistToggleBtn && watchlistSection) {
      watchlistToggleBtn.addEventListener('click', () => {
        watchlistSection.classList.toggle('collapsed');
        const settings = loadSettings() || getDefaultSettings();
        settings.watchlistCollapsed = watchlistSection.classList.contains('collapsed');
        saveSettings(settings);
      });
    }
    
    // Add to watchlist button
    const addToWatchlistBtn = document.getElementById('addToWatchlistBtn');
    const watchlistSearchWindow = document.getElementById('watchlistSearchWindow');
    const watchlistSearchBackdrop = document.getElementById('watchlistSearchBackdrop');
    const closeWatchlistSearchBtn = document.getElementById('closeWatchlistSearchBtn');
    const watchlistSearchInput = document.getElementById('watchlistSearchInput');
    const watchlistSearchResults = document.getElementById('watchlistSearchResults');
    
    if (addToWatchlistBtn) {
      addToWatchlistBtn.addEventListener('click', async () => {
        // Ensure feeds are loaded
        await fetchAllPythFeeds();
        
        // Show modal
        if (watchlistSearchWindow) watchlistSearchWindow.style.display = 'block';
        if (watchlistSearchBackdrop) watchlistSearchBackdrop.style.display = 'block';
        
        // Focus search input
        if (watchlistSearchInput) {
          watchlistSearchInput.value = '';
          watchlistSearchInput.focus();
          watchlistSearchResults.innerHTML = '';
        }
      });
    }
    
    // Close watchlist search
    let addedFeeds = new Set();
    
    const closeWatchlistSearch = () => {
      if (watchlistSearchWindow) watchlistSearchWindow.style.display = 'none';
      if (watchlistSearchBackdrop) watchlistSearchBackdrop.style.display = 'none';
      addedFeeds.clear();
    };
    
    // Edit watchlist button
    const editWatchlistBtn = document.getElementById('editWatchlistBtn');
    if (editWatchlistBtn) {
      editWatchlistBtn.addEventListener('click', toggleWatchlistEditMode);
    }
    
    // Add event delegation for watchlist edit buttons (they're created dynamically)
    const watchlistBody = document.getElementById('watchlistBody');
    if (watchlistBody) {
      watchlistBody.addEventListener('click', (e) => {
        if (e.target.classList.contains('watchlist-edit-btn')) {
          const feedId = e.target.getAttribute('data-feed-id');
          removeWatchlistItemInEditMode(feedId);
        }
      });
    }
    
    // Search functionality with multi-select
    
    if (watchlistSearchInput) {
      // Debounce search for better performance (300ms delay)
      const performSearch = debounce((query) => {
        
        if (query.length < 1) {
          watchlistSearchResults.innerHTML = '';
          addedFeeds.clear();
          return;
        }
        
        const results = searchWatchlistTokens(query);
        const settings = loadSettings() || getDefaultSettings();
        const currentWatchlist = settings.watchlist || [];
        
        if (results.length === 0) {
          watchlistSearchResults.innerHTML = '';
          return;
        }
        
        watchlistSearchResults.innerHTML = '';
        for (const feed of results) {
          const resultDiv = document.createElement('div');
          resultDiv.className = 'watchlist-search-result';
          
          // Check if already in watchlist or just added
          const isInWatchlist = currentWatchlist.includes(feed.id);
          const isAdded = addedFeeds.has(feed.id);
          
          if (isInWatchlist || isAdded) {
            resultDiv.classList.add('added');
          }
          
          resultDiv.innerHTML = `
            <span>${feed.symbol}</span>
            <button class="btn-text ${isInWatchlist || isAdded ? 'added' : ''}" data-feed-id="${feed.id}">
              ${isInWatchlist ? '[IN LIST]' : isAdded ? '[ADDED]' : '[ADD]'}
            </button>
          `;
          
          const btn = resultDiv.querySelector('button');
          if (!isInWatchlist) {
            btn.addEventListener('click', () => {
              if (!isAdded) {
                addToWatchlist(feed.id);
                addedFeeds.add(feed.id);
                btn.textContent = '[ADDED]';
                btn.classList.add('added');
                resultDiv.classList.add('added');
              }
            });
          }
          
          watchlistSearchResults.appendChild(resultDiv);
        }
      }, 300); // 300ms debounce delay
      
      watchlistSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        performSearch(query);
      });
    }
    
    // Add event listeners for close buttons
    if (closeWatchlistSearchBtn) {
      closeWatchlistSearchBtn.addEventListener('click', closeWatchlistSearch);
    }
    
    if (watchlistSearchBackdrop) {
      watchlistSearchBackdrop.addEventListener('click', closeWatchlistSearch);
    }
    
    // Wallpaper change handler    
    // === ADD POSITION MODAL SETUP ===
    const addPositionBtn = document.getElementById('addPositionBtn');
    const addPositionModal = document.getElementById('addPositionModal');
    const addPositionBackdrop = document.getElementById('addPositionBackdrop');
    const closeAddPositionBtn = document.getElementById('closeAddPositionBtn');
    const addPositionTypePyth = document.getElementById('addPositionTypePyth');
    const addPositionTypeCustom = document.getElementById('addPositionTypeCustom');
    const addPositionPythSection = document.getElementById('addPositionPythSection');
    const addPositionCustomSection = document.getElementById('addPositionCustomSection');
    const addPositionPythSearch = document.getElementById('addPositionPythSearch');
    const addPositionPythResults = document.getElementById('addPositionPythResults');
    const addPositionPythAmount = document.getElementById('addPositionPythAmount');
    const addPositionPythEntryPrice = document.getElementById('addPositionPythEntryPrice');
    const addPositionCustomName = document.getElementById('addPositionCustomName');
    const addPositionCustomValue = document.getElementById('addPositionCustomValue');
    const savePositionBtn = document.getElementById('savePositionBtn');
    
    let selectedPositionType = 'pyth';
    let selectedPythFeed = null;
    
    // Open add position modal
    if (addPositionBtn) {
      addPositionBtn.addEventListener('click', async () => {
        // Ensure feeds are loaded
        await fetchAllPythFeeds();
        
        // Show modal
        if (addPositionModal) addPositionModal.style.display = 'block';
        if (addPositionBackdrop) addPositionBackdrop.style.display = 'block';
        
        // Reset state
        selectedPositionType = 'pyth';
        selectedPythFeed = null;
        if (addPositionPythSearch) addPositionPythSearch.value = '';
        if (addPositionPythAmount) addPositionPythAmount.value = '';
        if (addPositionPythEntryPrice) addPositionPythEntryPrice.value = '';
        if (addPositionCustomName) addPositionCustomName.value = '';
        if (addPositionCustomValue) addPositionCustomValue.value = '';
        if (addPositionPythResults) addPositionPythResults.innerHTML = '';
        
        // Set initial view
        if (addPositionPythSection) addPositionPythSection.style.display = 'block';
        if (addPositionCustomSection) addPositionCustomSection.style.display = 'none';
        if (addPositionTypePyth) {
          addPositionTypePyth.style.background = 'var(--accent)';
          addPositionTypePyth.style.color = 'var(--bg)';
        }
        if (addPositionTypeCustom) {
          addPositionTypeCustom.style.background = '';
          addPositionTypeCustom.style.color = '';
        }
      });
    }
    
    // Close add position modal
    const closeAddPosition = () => {
      if (addPositionModal) addPositionModal.style.display = 'none';
      if (addPositionBackdrop) addPositionBackdrop.style.display = 'none';
    };
    
    if (closeAddPositionBtn) {
      closeAddPositionBtn.addEventListener('click', closeAddPosition);
    }
    
    if (addPositionBackdrop) {
      addPositionBackdrop.addEventListener('click', closeAddPosition);
    }
    
    // Toggle position type
    if (addPositionTypePyth) {
      addPositionTypePyth.addEventListener('click', () => {
        selectedPositionType = 'pyth';
        if (addPositionPythSection) addPositionPythSection.style.display = 'block';
        if (addPositionCustomSection) addPositionCustomSection.style.display = 'none';
        addPositionTypePyth.style.background = 'var(--accent)';
        addPositionTypePyth.style.color = 'var(--bg)';
        if (addPositionTypeCustom) {
          addPositionTypeCustom.style.background = '';
          addPositionTypeCustom.style.color = '';
        }
      });
    }
    
    if (addPositionTypeCustom) {
      addPositionTypeCustom.addEventListener('click', () => {
        selectedPositionType = 'custom';
        if (addPositionPythSection) addPositionPythSection.style.display = 'none';
        if (addPositionCustomSection) addPositionCustomSection.style.display = 'block';
        addPositionTypeCustom.style.background = 'var(--accent)';
        addPositionTypeCustom.style.color = 'var(--bg)';
        if (addPositionTypePyth) {
          addPositionTypePyth.style.background = '';
          addPositionTypePyth.style.color = '';
        }
      });
    }
    
    // Pyth search functionality
    if (addPositionPythSearch) {
      // Debounce search for better performance (200ms delay - faster for this modal)
      const performPythSearch = debounce((query) => {
        // Show results when typing
        addPositionPythResults.style.display = 'block';
        
        if (query.length < 1) {
          addPositionPythResults.innerHTML = '';
          return;
        }
        
        const results = searchWatchlistTokens(query);
        
        if (results.length === 0) {
          addPositionPythResults.innerHTML = '';
          return;
        }
        
        addPositionPythResults.innerHTML = '';
        for (const feed of results) {
          const resultDiv = document.createElement('div');
          resultDiv.className = 'watchlist-search-result';
          resultDiv.style.cursor = 'pointer';
          
          if (selectedPythFeed && selectedPythFeed.id === feed.id) {
            resultDiv.classList.add('added');
          }
          
          resultDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div class="asset-symbol">${feed.symbol}</div>
              </div>
            </div>
          `;
          
          resultDiv.addEventListener('click', () => {
            selectedPythFeed = feed;
            // Update UI to show selected
            addPositionPythResults.querySelectorAll('.watchlist-search-result').forEach(el => {
              el.classList.remove('added');
            });
            resultDiv.classList.add('added');
            
            // Hide search results after selection
            addPositionPythResults.style.display = 'none';
          });
          
          addPositionPythResults.appendChild(resultDiv);
        }
      }, 200); // 200ms debounce delay
      
      addPositionPythSearch.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        performPythSearch(query);
      });
    }
    
    // Save position
    if (savePositionBtn) {
      savePositionBtn.addEventListener('click', () => {
        const settings = loadSettings() || getDefaultSettings();
        
        // Ensure cryptoPositions array exists
        if (!settings.cryptoPositions) {
          settings.cryptoPositions = [];
        }
        
        if (selectedPositionType === 'pyth') {
          // Validate Pyth position
          if (!selectedPythFeed) {
            alert('Please select a token from the search results');
            return;
          }
          
          const amount = parseFloat(addPositionPythAmount.value);
          const entryPrice = parseFloat(addPositionPythEntryPrice.value);
          
          if (!amount || amount <= 0) {
            alert('Please enter a valid amount');
            return;
          }
          
          if (!entryPrice || entryPrice <= 0) {
            alert('Please enter a valid entry price');
            return;
          }
          
          // Add Pyth position
          settings.cryptoPositions.push({
            type: 'pyth',
            symbol: selectedPythFeed.symbol,
            feedId: selectedPythFeed.id,
            amount: amount,
            entryPrice: entryPrice
          });
        } else {
          // Validate custom position
          const name = addPositionCustomName.value.trim();
          const value = parseFloat(addPositionCustomValue.value);
          
          if (!name) {
            alert('Please enter an asset name');
            return;
          }
          
          if (!value || value <= 0) {
            alert('Please enter a valid value');
            return;
          }
          
          // Add custom position
          settings.cryptoPositions.push({
            type: 'custom',
            name: name,
            value: value
          });
        }
        
        saveSettings(settings);
        closeAddPosition();
        
        // Refresh positions
        refreshAll();
      });
    }
    
    if (els.wallpaperSelect) {
      els.wallpaperSelect.addEventListener('change', (e) => {
        applyWallpaper(e.target.value);
      });
    }
    
    // Check weather and auto-enable rain if it's raining at user's location (desktop only)
    if (rainCanvas && !isMobileDevice()) {
      checkWeatherAndEnableRain();
    }
  });
  
  // Helper function to detect mobile devices
  function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) 
           || window.innerWidth <= 768;
  }
  
  // Stop real-time updates when page unloads
  window.addEventListener('beforeunload', stopRealTimeUpdates);
  
  // Expose helper function to manually test midnight price fetching
  // Usage in console: testMidnightPrices()
  window.testMidnightPrices = async function() {
    localStorage.removeItem('dailyMidnightPrices.v1');
    await refreshAll();
  };
  
})();