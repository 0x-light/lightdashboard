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
            const customPositions = cryptoPositions.filter(p => p.type === 'custom');

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

                            rows.push({
                                asset: pos.symbol,
                                exchange: 'Manual (Pyth)',
                                amount: amount,
                                price: currentPrice,
                                value: value,
                                change24h: null, // Could fetch if needed
                                pnl: pnl,
                                feedId: pos.feedId,
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

            // Enrich with Pyth History
            this.enrichWithPythHistory(rows);

        } catch (e) {
            this.renderer.markProviderFailed('Manual', e);
        }
    }

    async enrichWithPythHistory(rows) {
        if (!rows || rows.length === 0) return;
        if (this.settings && this.settings.showPriceChart === false) return;


        const pythRows = rows.filter(r => r.exchange === 'Manual (Pyth)' && !r.priceHistory);
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

            // Check threshold and hidden status
            const isHidden = this.settings.hiddenAssets && this.settings.hiddenAssets.includes(`${row.asset}_Manual (Pyth)`);
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
