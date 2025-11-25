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
                    _changeDetectionKey: `MANUAL_CUSTOM_${pos.symbol}`
                });
            }

            this.renderer.appendPositions(rows, 'Manual', {
                removeFilter: (p) => p.exchange && p.exchange.startsWith('Manual')
            });
        } catch (e) {
            this.renderer.markProviderFailed('Manual', e);
        }
    }
}
