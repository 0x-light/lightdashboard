import { getChainDisplayName } from '../../utils/chain-mapping.js';

export class ZerionFetcher {
    constructor(providers, renderer, settings) {
        this.providers = providers;
        this.renderer = renderer;
        this.settings = settings;
        this.historyCache = new Map(); // key: asset, value: { priceHistory, change24h, timestamp }
    }

    async fetch(wallets) {
        try {
            await Promise.all(wallets.map(async (wallet) => {
                const walletRows = [];
                try {
                    const positionsData = await this.providers.zerion.getWalletPositions(wallet, this.settings.zerionApiKey, { timeoutMs: 5000 });

                    if (positionsData?.data) {
                        for (const item of positionsData.data) {
                            const attr = item?.attributes || {};
                            const fungible = attr.fungible_info;
                            if (fungible && !attr.flags?.is_trash) {
                                const chainId = item?.relationships?.chain?.data?.id || 'unknown';
                                const chain = getChainDisplayName(chainId);
                                const row = {
                                    asset: fungible.symbol || 'Unknown',
                                    exchange: chain,
                                    amount: attr.quantity?.float || 0,
                                    price: attr.price || 0,
                                    value: attr.value || 0,
                                    change24h: attr.changes?.percent_24h ?? null,
                                    pnl: null,
                                    _changeDetectionKey: `${fungible.symbol || 'Unknown'}_${chain}_${wallet}`
                                };

                                // Apply cached history
                                if (this.historyCache.has(row.asset)) {
                                    const cached = this.historyCache.get(row.asset);
                                    if (Date.now() - cached.timestamp < 15 * 60 * 1000) {
                                        row.priceHistory = cached.priceHistory;
                                        if (cached.change24h !== null) row.change24h = cached.change24h;
                                    }
                                }

                                walletRows.push(row);
                            }
                        }
                    }
                } catch (err) {
                    console.warn(`[Zerion] Failed for wallet ${wallet}:`, err);
                }

                // Enrich with CoinGecko (Basic implementation, can be improved)
                const missingChange24h = walletRows.filter(r => r.change24h === null);
                if (missingChange24h.length > 0) {
                    // ... existing enrichment logic ...
                }

                this.renderer.appendPositions(walletRows, `Zerion_${wallet}`);

                // Enrich with Pyth History for Charts
                this.enrichWithPythHistory(walletRows, wallet);
            }));

            // Mark the main 'Zerion' provider as completed
            this.renderer.appendPositions([], 'Zerion');
        } catch (e) {
            this.renderer.markProviderFailed('Zerion', e);
        }
    }

    async enrichWithPythHistory(rows, wallet) {
        if (!rows || rows.length === 0) return;

        try {
            // 1. Get Feed IDs map
            const feedMap = await this.providers.pyth.getPriceFeeds();
            // console.log(`[Zerion] Pyth feed map size: ${Object.keys(feedMap).length}`);

            const symbolToId = {};
            for (const [symbol, id] of Object.entries(feedMap)) {
                symbolToId[symbol] = id;
            }

            // 2. Identify rows that need history and have a matching feed
            const itemsToFetch = [];
            for (const row of rows) {
                if (!row.priceHistory && row.asset) {
                    // Check cache first
                    if (this.historyCache.has(row.asset)) {
                        const cached = this.historyCache.get(row.asset);
                        if (Date.now() - cached.timestamp < 15 * 60 * 1000) {
                            row.priceHistory = cached.priceHistory;
                            if (cached.change24h !== null) row.change24h = cached.change24h;
                            continue;
                        }
                    }

                    let feedId = symbolToId[row.asset.toUpperCase()];

                    // Fallback for known assets if missing from dynamic map
                    if (!feedId) {
                        const FALLBACK_IDS = {
                            'ETH': 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
                            'WETH': 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // Map WETH to ETH
                            'MON': '31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1',
                            'USDC': 'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a'
                        };
                        feedId = FALLBACK_IDS[row.asset.toUpperCase()];
                    }

                    if (feedId) {
                        itemsToFetch.push({ row, feedId });
                    } else {
                        // Try mapping WETH -> ETH, etc. if needed
                        // console.log(`[Zerion] No Pyth feed found for ${row.asset}`);
                    }
                }
            }

            console.log(`[Zerion] Enriching ${itemsToFetch.length} items with Pyth history. Assets: ${itemsToFetch.map(i => i.row.asset).join(', ')}`);

            if (itemsToFetch.length === 0) return;

            // 3. Fetch history in batch
            const feedIds = itemsToFetch.map(i => i.feedId);
            try {
                console.log(`[Zerion] Batch fetching history for ${feedIds.length} feeds`);
                const batchResults = await this.providers.pyth.getBatch24hPriceHistory(feedIds, 24); // Use 24 points (1h) to avoid rate limits

                for (const { row, feedId } of itemsToFetch) {
                    const normalizedId = feedId.toLowerCase().startsWith('0x') ? feedId.toLowerCase() : `0x${feedId.toLowerCase()}`;
                    const history = batchResults[normalizedId];

                    if (history && history.length > 0) {
                        console.log(`[Zerion] Got ${history.length} points for ${row.asset}`);
                        row.priceHistory = history;

                        // Update 24h change if missing or we want to be more accurate
                        let change24h = row.change24h;
                        if (row.change24h === null && history.length >= 2) {
                            const first = history[0].price;
                            const last = history[history.length - 1].price;
                            if (first > 0) {
                                change24h = ((last - first) / first) * 100;
                                row.change24h = change24h;
                            }
                        }

                        // Update cache
                        this.historyCache.set(row.asset, {
                            priceHistory: history,
                            change24h,
                            timestamp: Date.now()
                        });
                    } else {
                        console.warn(`[Zerion] No history returned for ${row.asset}`);
                    }
                }
            } catch (e) {
                console.warn(`[Zerion] Error fetching batch history:`, e);
            }

            // 4. Update UI
            this.renderer.appendPositions(rows, `Zerion_${wallet}`);

        } catch (e) {
            console.warn(`[Zerion] Failed to enrich history for ${wallet}:`, e);
        }
    }
}
