export class ManualFetcher {
    constructor(providers, renderer) {
        this.providers = providers;
        this.renderer = renderer;
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

            // Process Custom positions
            for (const pos of customPositions) {
                const amount = parseFloat(pos.amount || 0);
                const price = parseFloat(pos.price || 0);
                const value = amount * price;

                rows.push({
                    asset: pos.symbol,
                    exchange: 'Manual (Custom)',
                    amount: amount,
                    price: price,
                    value: value,
                    change24h: null,
                    pnl: null,
                    isManual: true,
                    manualType: 'custom',
                    _changeDetectionKey: `MANUAL_CUSTOM_${pos.symbol}`
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

        const pythRows = rows.filter(r => r.exchange === 'Manual (Pyth)' && !r.priceHistory);
        console.log(`[Manual] Enriching ${pythRows.length} Pyth positions with history.`);
        if (pythRows.length === 0) return;

        // We need to find the feedId again or store it in the row.
        // In the fetch method, we didn't store feedId in the row, but we stored it in _changeDetectionKey.
        // Let's rely on the fact that we can get it from the original config if we had it, but we don't here easily.
        // Wait, I can see in the fetch method: `_changeDetectionKey: MANUAL_PYTH_${pos.symbol}_${pos.feedId}`
        // So I can extract it from there.

        const historyPromises = pythRows.map(async (row) => {
            try {
                const parts = row._changeDetectionKey.split('_');
                // Key format: MANUAL_PYTH_${symbol}_${feedId}
                // But symbol might contain underscores? Hopefully not.
                // Actually, let's look at how it's constructed: `MANUAL_PYTH_${pos.symbol}_${pos.feedId}`
                // If symbol has underscores, this is risky.
                // Better to add feedId to the row object in the fetch method first.

                // Let's assume I'll fix the fetch method to add feedId to the row.
                if (!row.feedId) {
                    console.warn(`[Manual] No feedId for ${row.asset}`);
                    return false;
                }

                const history = await this.providers.pyth.get24hPriceHistory(row.feedId, 6000);
                if (history && history.length > 0) {
                    console.log(`[Manual] Got ${history.length} history points for ${row.asset}`);
                    row.priceHistory = history;

                    if (row.change24h === null && history.length >= 2) {
                        const first = history[0].price;
                        const last = history[history.length - 1].price;
                        if (first > 0) {
                            row.change24h = ((last - first) / first) * 100;
                        }
                    }
                    return true;
                } else {
                    console.warn(`[Manual] No history found for ${row.asset} (Feed: ${row.feedId})`);
                }
            } catch (e) {
                console.error(`[Manual] Error fetching history for ${row.asset}:`, e);
            }
            return false;
        });

        await Promise.all(historyPromises);

        this.renderer.appendPositions(rows, 'Manual', {
            removeFilter: (p) => p.exchange && p.exchange.startsWith('Manual')
        });
    }
}
