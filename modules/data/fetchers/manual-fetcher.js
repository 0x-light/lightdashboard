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

export class ManualFetcher {
    constructor(providers, renderer, settings) {
        this.providers = providers;
        this.renderer = renderer;
        this.settings = settings;
    }

    async fetch(cryptoPositions) {
        try {
            const rows = [];
            const pythPositions = cryptoPositions.filter(p => p.type === 'pyth');
            const stockPositions = cryptoPositions.filter(p => p.type === 'stock');
            const customPositions = cryptoPositions.filter(p => p.type === 'custom');

            // Stock/ETF/FX/Index positions via Yahoo Finance. Single batched quote request
            // covers everything in one round-trip.
            if (stockPositions.length > 0 && this.providers.stocks?.getQuotes) {
                try {
                    const symbols = stockPositions.map(p => p.symbol).filter(Boolean);
                    const quotes = await this.providers.stocks.getQuotes(symbols, { timeoutMs: 5000 });

                    for (const pos of stockPositions) {
                        const amount = parseFloat(pos.amount || 0);
                        const entryPrice = parseFloat(pos.entryPrice || 0);
                        const quote = quotes[pos.symbol];
                        const currentPrice = Number.isFinite(quote?.price) ? quote.price : 0;
                        const value = amount * currentPrice;
                        const pnl = entryPrice > 0 ? (currentPrice - entryPrice) * amount : null;

                        const category = pos.category || 'equity';
                        rows.push({
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
                            marketState: quote?.marketState || null,
                            // Spark quote already includes sparkline data — use it so the row
                            // renders with a chart on first paint, no follow-up fetch needed.
                            priceHistory: Array.isArray(quote?.priceHistory) && quote.priceHistory.length > 1
                              ? quote.priceHistory
                              : undefined,
                            category,
                            isManual: true,
                            manualType: 'stock',
                            _changeDetectionKey: `MANUAL_STOCK_${pos.symbol}`
                        });
                    }
                } catch (e) {
                    console.warn('[Manual] Failed to fetch stock quotes:', e);
                }
            }

            // Fetch prices for Pyth positions
            if (pythPositions.length > 0) {
                const feedIds = pythPositions.map(p => p.feedId).filter(Boolean);
                if (feedIds.length > 0) {
                    try {
                        const pythPrices = await this.providers.pyth.getLatestByFeedIds(feedIds, 5000);

                        for (const pos of pythPositions) {
                            const currentPrice = pythPrices[pos.feedId] || 0;
                            const amount = parseFloat(pos.amount || 0);
                            const entryPrice = parseFloat(pos.entryPrice || 0);
                            const value = amount * currentPrice;
                            let pnl = null;

                            if (entryPrice > 0) {
                                pnl = (currentPrice - entryPrice) * amount;
                            }

                            // Category-aware exchange label distinguishes stocks from crypto in the
                            // positions table. Legacy Pyth crypto positions saved before this change
                            // lack `category` — treat them as crypto.
                            const category = pos.category || 'crypto';
                            const exchange = labelForCategory(category);

                            rows.push({
                                asset: pos.symbol,
                                exchange,
                                amount,
                                price: currentPrice,
                                value,
                                change24h: null, // Could fetch if needed
                                pnl,
                                feedId: pos.feedId,
                                entryPrice: entryPrice || undefined,
                                entryDate: pos.entryDate || undefined,
                                assetName: pos.name || pos.symbol,
                                category,
                                isManual: true,
                                manualType: 'pyth',
                                _changeDetectionKey: `MANUAL_PYTH_${pos.symbol}_${pos.feedId}`
                            });
                        }
                    } catch (e) {
                        console.warn('[Manual] Failed to fetch Pyth prices:', e);
                    }
                }
            }

            // Process custom positions (supports both legacy and current schema)
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
                    isManual: true,
                    manualType: 'custom',
                    _changeDetectionKey: `MANUAL_CUSTOM_${asset}`
                });
            }

            this.renderer.appendPositions(rows, 'Manual', {
                removeFilter: (p) => p.exchange && p.exchange.startsWith('Manual')
            });

            // Enrich asynchronously from the appropriate provider. Each enrichment re-pushes
            // the rows so the renderer picks up the updated price history for sparklines.
            this.enrichWithPythHistory(rows);
            this.enrichWithStockHistory(rows);

        } catch (e) {
            this.renderer.markProviderFailed('Manual', e);
        }
    }

    async enrichWithStockHistory(rows) {
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

        this.renderer.appendPositions(rows, 'Manual', {
            removeFilter: (p) => p.exchange && p.exchange.startsWith('Manual')
        });
    }

    async enrichWithPythHistory(rows) {
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

            if (hasFastData) {
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

        this.renderer.appendPositions(rows, 'Manual', {
            removeFilter: (p) => p.exchange && p.exchange.startsWith('Manual')
        });
    }
}
