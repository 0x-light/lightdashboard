// Maps a feed category to the exchange label shown in the positions table. Back-compat:
// when category is missing (older saved positions) we fall back to "Manual (Pyth)".
function labelForCategory(category) {
  switch (category) {
    case 'equity': return 'Manual (Stock)';
    case 'etf': return 'Manual (ETF)';
    case 'fund': return 'Manual (Fund)';
    case 'index': return 'Manual (Index)';
    case 'fx': return 'Manual (FX)';
    case 'metal': return 'Manual (Metal)';
    case 'commodity': return 'Manual (Commodity)';
    case 'crypto': return 'Manual (Pyth)';
    default: return 'Manual (Pyth)';
  }
}

// Demo positions (larp-data.js) give a gain in percent; their entry follows the live price.
function entryOf(pos, price) {
  return globalThis.larp?.entryOf?.(pos, price) ?? parseFloat(pos.entryPrice || 0);
}

// `asOf` marks a quote reused from an earlier refresh: its time, for the row's age.
function buildStockRow(pos, quote = null, { quoteLoading = false, quoteUnavailable = false, asOf = null } = {}) {
  const amount = parseFloat(pos.amount || 0);
  const currentPrice = Number.isFinite(quote?.price) ? quote.price : 0;
  const entryPrice = entryOf(pos, currentPrice);
  const value = amount * currentPrice;
  const pnl = entryPrice > 0 && currentPrice > 0 ? (currentPrice - entryPrice) * amount : null;
  const category = pos.category || 'equity';

  return {
    asset: pos.symbol,
    exchange: labelForCategory(category),
    amount,
    price: currentPrice,
    value,
    change24h: Number.isFinite(quote?.change24h) ? quote.change24h : null,
    pnl,
    entryPrice: entryPrice || undefined,
    entryDate: pos.entryDate || undefined,
    assetName: pos.name || quote?.name || pos.symbol,
    currency: pos.currency || quote?.currency || undefined,
    marketState: quote?.marketState || null,
    quoteTime: quote?.quoteTime || undefined,
    ...(asOf ? { asOf } : {}),
    // Spark quote already includes sparkline data — use it so the row renders with a chart
    // on first paint after the quote response, no follow-up fetch needed.
    priceHistory: Array.isArray(quote?.priceHistory) && quote.priceHistory.length > 1
      ? quote.priceHistory
      : undefined,
    category,
    isManual: true,
    manualType: 'stock',
    quoteLoading,
    quoteUnavailable,
    _changeDetectionKey: `MANUAL_STOCK_${pos.symbol}`
  };
}

function buildCustomRows(customPositions, settings) {
  const rows = [];
  for (const pos of customPositions) {
    const asset = String(pos.symbol || pos.name || '').trim();
    if (!asset) continue;

    const rawAmount = Number(pos.amount);
    const rawPrice = Number(pos.price);
    const rawValue = Number(pos.value);

    // Legacy custom entries are stored as { name, value }.
    // Default to amount=1 and derive price from value when needed.
    const amount = Number.isFinite(rawAmount) && rawAmount !== 0 ? rawAmount : 1;
    let price = Number.isFinite(rawPrice) ? rawPrice : 0;
    let value = Number.isFinite(rawValue) ? rawValue : 0;

    if (value > 0 && (!Number.isFinite(rawPrice) || rawPrice <= 0)) {
      price = value / Math.abs(amount);
    } else if (value <= 0 && price > 0) {
      value = Math.abs(amount) * price;
    }

    if (!Number.isFinite(value) || value <= 0) continue;
    if (!Number.isFinite(price) || price < 0) price = 0;

    rows.push({
      asset,
      exchange: 'Manual (Custom)',
      amount,
      price,
      value,
      change24h: null,
      pnl: null,
      currency: pos.currency || settings?.portfolioBaseCurrency || 'USD',
      isManual: true,
      manualType: 'custom',
      _changeDetectionKey: `MANUAL_CUSTOM_${asset}`
    });
  }
  return rows;
}

// Yahoo ticker for a Pyth-backed manual position, used only when Pyth has no price.
// US equities/ETFs share tickers across both; crypto and FX/metals are deliberately excluded.
function yahooSymbolForPythPosition(pos) {
  const category = String(pos?.category || '').toLowerCase();
  if (!['equity', 'etf', 'fund', 'stock'].includes(category)) return null;
  const symbol = String(pos?.symbol || '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol) ? symbol : null;
}

const MANUAL_REMOVE_OPTIONS = {
  removeFilter: (p) => p.exchange && p.exchange.startsWith('Manual')
};

export class ManualFetcher {
    constructor(providers, renderer, settings) {
        this.providers = providers;
        this.renderer = renderer;
        this.settings = settings;
        // Last good quote per symbol (and Pyth price per feed, { price, at }), so a refresh
        // that loads or fails shows the last real numbers, with asOf, instead of $0.
        this._lastQuotes = new Map();
        this._lastPythPrices = new Map();
    }

    // The last good quote for a symbol and its time, or nulls.
    _lastQuote(symbol) {
        const quote = this._lastQuotes.get(symbol) || null;
        return { quote, asOf: quote ? (quote.quoteTime || quote.receivedAt) : null };
    }

    async fetch(cryptoPositions) {
        // Late history enrichment from an older round must not replace a newer round's rows.
        const generation = this.generation = (this.generation || 0) + 1;
        try {
            const rows = [];
            const pythPositions = cryptoPositions.filter(p => p.type === 'pyth');
            const stockPositions = cryptoPositions.filter(p => p.type === 'stock');
            const customPositions = cryptoPositions.filter(p => p.type === 'custom');
            const customRows = buildCustomRows(customPositions, this.settings);

            if (stockPositions.length > 0) {
                rows.push(...stockPositions.map(pos => {
                    const { quote, asOf } = this._lastQuote(pos.symbol);
                    return buildStockRow(pos, quote, { quoteLoading: !quote, asOf });
                }));
                rows.push(...customRows);
                // Partial update: leave the Pyth-backed rows (still on screen from the last
                // fetch) alone until their own prices arrive below.
                this.renderer.appendPositions(rows.map(row => ({ ...row })), 'Manual', {
                    removeFilter: (p) => p.isManual && (p.manualType === 'stock' || p.manualType === 'custom'),
                    markCompleted: false
                });
            }

            // Both quote sources are independent: start them together instead of one after the other.
            const feedIds = pythPositions.map(p => p.feedId).filter(Boolean);
            this.providers.pyth?.registerFeedHints?.(pythPositions.map(p => ({
                id: p.feedId,
                symbol: p.symbol,
                category: p.category || 'crypto'
            })));
            const pythPricesPromise = feedIds.length > 0
                ? Promise.resolve(this.providers.pyth.getLatestByFeedIds(feedIds, 5000)).catch(e => {
                    console.warn('[Manual] Failed to fetch Pyth prices:', e);
                    return {};
                })
                : Promise.resolve({});

            // Stock/ETF/FX/Index positions via Yahoo Finance. Single batched quote request
            // covers everything in one round-trip. A symbol without a quote now keeps its last
            // one, with asOf; with none ever, the row is unpriced.
            if (stockPositions.length > 0) {
                let quotes = {};
                try {
                    const symbols = stockPositions.map(p => p.symbol).filter(Boolean);
                    quotes = await this.providers.stocks?.getQuotes?.(symbols, { timeoutMs: 3500 }) || {};
                } catch (e) {
                    console.warn('[Manual] Failed to fetch stock quotes:', e);
                }
                const stockRows = stockPositions.map(pos => {
                    const fresh = quotes[pos.symbol];
                    if (fresh) {
                        this._lastQuotes.set(pos.symbol, { ...fresh, receivedAt: Date.now() });
                        return buildStockRow(pos, fresh);
                    }
                    const { quote, asOf } = this._lastQuote(pos.symbol);
                    return buildStockRow(pos, quote, { quoteUnavailable: !quote, asOf });
                });
                rows.splice(0, stockPositions.length, ...stockRows);
            }

            // Fetch prices for Pyth positions
            if (pythPositions.length > 0) {
                const pythPrices = (await pythPricesPromise) || {};

                // Pyth can be down or drop a feed. Equities/ETFs fall back to Yahoo on the same
                // ticker; crypto tickers are ambiguous on Yahoo, so those stay unavailable rather
                // than risk pricing the wrong coin.
                const missing = pythPositions.filter(pos => !(Number(pythPrices[pos.feedId]) > 0));
                const fallbackSymbols = missing.map(yahooSymbolForPythPosition).filter(Boolean);
                let fallbackQuotes = {};
                if (fallbackSymbols.length > 0 && this.providers.stocks?.getQuotes) {
                    try {
                        fallbackQuotes = await this.providers.stocks.getQuotes(fallbackSymbols, { timeoutMs: 3500 }) || {};
                    } catch (e) {
                        console.warn('[Manual] Yahoo fallback for Pyth positions failed:', e);
                    }
                }

                for (const pos of pythPositions) {
                    const pythPrice = Number(pythPrices[pos.feedId]);
                    const fallback = fallbackQuotes[yahooSymbolForPythPosition(pos)];
                    let currentPrice = pythPrice > 0
                        ? pythPrice
                        : (Number(fallback?.price) > 0 ? Number(fallback.price) : 0);
                    // Neither source answered: the last good price, with its time as asOf.
                    let asOf = null;
                    if (currentPrice > 0) {
                        this._lastPythPrices.set(pos.feedId, { price: currentPrice, at: Date.now() });
                    } else if (this._lastPythPrices.has(pos.feedId)) {
                        ({ price: currentPrice, at: asOf } = this._lastPythPrices.get(pos.feedId));
                    }
                    const amount = parseFloat(pos.amount || 0);
                    const entryPrice = entryOf(pos, currentPrice);
                    const value = amount * currentPrice;
                    // Without a live price there is no P&L — never report "0 − entry" as a loss.
                    const pnl = entryPrice > 0 && currentPrice > 0 ? (currentPrice - entryPrice) * amount : null;

                    // Category-aware exchange label distinguishes stocks from crypto in the
                    // positions table. Legacy Pyth crypto positions saved before this change
                    // lack `category` — treat them as crypto.
                    const category = pos.category || 'crypto';
                    const exchange = labelForCategory(category);
                    const usedFallback = !(pythPrice > 0) && !asOf && currentPrice > 0;

                    rows.push({
                        asset: pos.symbol,
                        exchange,
                        amount,
                        price: currentPrice,
                        value,
                        change24h: usedFallback && Number.isFinite(fallback?.change24h) ? fallback.change24h : null,
                        pnl,
                        feedId: pos.feedId,
                        entryPrice: entryPrice || undefined,
                        entryDate: pos.entryDate || undefined,
                        assetName: pos.name || pos.symbol,
                        currency: pos.currency || (usedFallback ? fallback?.currency : null) || 'USD',
                        priceHistory: usedFallback && Array.isArray(fallback?.priceHistory) && fallback.priceHistory.length > 1
                            ? fallback.priceHistory
                            : undefined,
                        quoteUnavailable: !(currentPrice > 0),
                        ...(asOf ? { asOf } : {}),
                        category,
                        isManual: true,
                        manualType: 'pyth',
                        _changeDetectionKey: `MANUAL_PYTH_${pos.symbol}_${pos.feedId}`
                    });
                }
            }

            if (stockPositions.length === 0) {
                rows.push(...customRows);
            }

            this.renderer.appendPositions(rows, 'Manual', MANUAL_REMOVE_OPTIONS);

            // Enrich asynchronously from the appropriate provider. Each enrichment re-pushes
            // the rows so the renderer picks up the updated price history for sparklines.
            this.enrichWithPythHistory(rows, generation);
            this.enrichWithStockHistory(rows, generation);

        } catch (e) {
            this.renderer.markProviderFailed('Manual', e);
        }
    }

    async enrichWithStockHistory(rows, generation = this.generation) {
        if (!rows || rows.length === 0) return;
        if (this.settings && this.settings.showPriceChart === false) return;
        const provider = this.providers?.stocks;
        if (!provider?.get24hPriceHistory) return;

        const stockRows = rows.filter(r => r.manualType === 'stock' && !r.priceHistory);
        if (stockRows.length === 0) return;

        const threshold = this.settings.minBalanceThreshold || 0;

        // Fetch per-symbol in parallel; Yahoo doesn't batch chart requests. Cheap for typical
        // portfolios (<20 symbols) and the HTTP client's in-flight dedup prevents duplicates.
        const fetches = stockRows.map(async (row) => {
            const exchangeKey = row.exchange || 'Manual (Stock)';
            const isHidden = this.settings.hiddenAssets?.includes(`${row.asset}_${exchangeKey}`);
            if (isHidden || row.value < threshold) return;
            try {
                const history = await provider.get24hPriceHistory(row.asset, { timeoutMs: 5000 });
                if (Array.isArray(history) && history.length > 0) {
                    row.priceHistory = history;
                }
            } catch (_) { /* non-fatal: row renders without sparkline */ }
        });

        await Promise.all(fetches);

        if (generation !== this.generation) return;
        this.renderer.appendPositions(rows, 'Manual', {
            removeFilter: (p) => p.exchange && p.exchange.startsWith('Manual')
        });
    }

    async enrichWithPythHistory(rows, generation = this.generation) {
        if (!rows || rows.length === 0) return;
        if (this.settings && this.settings.showPriceChart === false) return;


        // Any Pyth-backed manual row qualifies for history enrichment — the category-aware
        // exchange labels (Manual (Stock), Manual (FX), etc.) are all sourced from Pyth feeds.
        const pythRows = rows.filter(r => r.manualType === 'pyth' && !r.priceHistory);
        // console.log(`[Manual] Enriching ${pythRows.length} Pyth positions with history.`);
        if (pythRows.length === 0) return;

        // We need to find the feedId again or store it in the row.
        // In the fetch method, we didn't store feedId in the row, but we stored it in _changeDetectionKey.
        // Let's rely on the fact that we can get it from the original config if we had it, but we don't here easily.
        // Wait, I can see in the fetch method: `_changeDetectionKey: MANUAL_PYTH_${pos.symbol}_${pos.feedId}`
        // So I can extract it from there.

        const itemsToFetch = [];
        for (const row of pythRows) {
            // Extract feedId from _changeDetectionKey if not on row
            // Key format: MANUAL_PYTH_${symbol}_${feedId} or MANUAL_PYTH_${symbol} if feedId missing?
            // Actually manual fetcher stored it as `feedId: pos.feedId` in lines 40
            let feedId = row.feedId;

            // Fallback to extraction if missing (legacy support)
            if (!feedId && row._changeDetectionKey) {
                const parts = row._changeDetectionKey.split('_');
                // This is brittle if symbol has underscores. 
                // But better to rely on row.feedId which we set in fetch()
            }

            if (!feedId) {
                console.warn(`[Manual] No feedId for ${row.asset}`);
                continue;
            }

            // Check threshold and hidden status — exchange label varies by category now.
            const exchangeKey = row.exchange || 'Manual (Pyth)';
            const isHidden = this.settings.hiddenAssets && this.settings.hiddenAssets.includes(`${row.asset}_${exchangeKey}`);
            const threshold = this.settings.minBalanceThreshold || 0;
            if (isHidden || row.value < threshold) {
                continue;
            }

            itemsToFetch.push({ row, feedId });
        }

        if (itemsToFetch.length === 0) return;

        const feedIds = itemsToFetch.map(i => i.feedId);
        const now = Date.now();

        try {
            // Pass 1: Low resolution (24 points / 1h)
            const fastResults = await this.providers.pyth.getBatch24hPriceHistory(feedIds, 24, now);

            let hasFastData = false;
            for (const { row, feedId } of itemsToFetch) {
                const normalizedId = feedId.toLowerCase().startsWith('0x') ? feedId.toLowerCase() : `0x${feedId.toLowerCase()}`;
                const history = fastResults[normalizedId];
                if (history && history.length > 0) {
                    row.priceHistory = history;
                    hasFastData = true;
                }
            }

            if (hasFastData && generation === this.generation) {
                this.renderer.appendPositions(rows, 'Manual', {
                    removeFilter: (p) => p.exchange && p.exchange.startsWith('Manual')
                });
            }

            // Pass 2: High resolution (96 points / 15m)
            const fullResults = await this.providers.pyth.getBatch24hPriceHistory(feedIds, 96, now);

            for (const { row, feedId } of itemsToFetch) {
                const normalizedId = feedId.toLowerCase().startsWith('0x') ? feedId.toLowerCase() : `0x${feedId.toLowerCase()}`;
                const history = fullResults[normalizedId];

                if (history && history.length > 0) {
                    row.priceHistory = history;

                    if (row.change24h === null && history.length >= 2) {
                        const first = history[0].price;
                        const last = history[history.length - 1].price;
                        if (first > 0) {
                            row.change24h = ((last - first) / first) * 100;
                        }
                    }
                }
            }

        } catch (e) {
            console.error(`[Manual] Error batch fetching history:`, e);
        }

        if (generation !== this.generation) return;
        this.renderer.appendPositions(rows, 'Manual', {
            removeFilter: (p) => p.exchange && p.exchange.startsWith('Manual')
        });
    }
}
