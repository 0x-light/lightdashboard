import { getChainDisplayName } from '../../utils/chain-mapping.js';
import { unambiguousFeedSymbol } from '../providers/pyth.js';

export class ZerionFetcher {
    constructor(providers, renderer, settings) {
        this.providers = providers;
        this.renderer = renderer;
        this.settings = settings;
        this.historyCache = new Map(); // key: asset, value: { priceHistory, change24h, timestamp }
    }

    async fetch(wallets) {
        // Late chart enrichment from an older round must not replace a newer round's rows.
        const generation = this.generation = (this.generation || 0) + 1;
        try {
            let failed = 0;
            await Promise.all(wallets.map(async (wallet) => {
                const source = `Zerion_${wallet}`;
                const walletRows = [];
                // Row -> the feed symbol its chart may be read under, for verified tokens only.
                const chartSymbols = new Map();
                try {
                    const positionsData = await this.providers.zerion.getWalletPositions(wallet, this.settings.zerionApiKey, { timeoutMs: 5000 });
                    if (!Array.isArray(positionsData?.data)) throw new Error('No position list from Zerion');

                    for (const item of positionsData.data) {
                        const attr = item?.attributes || {};
                        const fungible = attr.fungible_info;
                        if (fungible && !attr.flags?.is_trash) {
                            const chainId = item?.relationships?.chain?.data?.id || 'unknown';
                            const chain = getChainDisplayName(chainId);
                            // Zerion has no price for some tokens: unpriced, not worth $0.
                            const priced = Number.isFinite(attr.price) && attr.price > 0;
                            const row = {
                                asset: fungible.symbol || 'Unknown',
                                exchange: chain,
                                amount: attr.quantity?.float || 0,
                                price: priced ? attr.price : null,
                                value: priced ? (attr.value || 0) : 0,
                                change24h: attr.changes?.percent_24h ?? null,
                                pnl: null,
                                ...(priced ? {} : { quoteUnavailable: true }),
                                _changeDetectionKey: `${fungible.symbol || 'Unknown'}_${chain}_${wallet}`
                            };
                            const symbol = fungible.flags?.verified ? unambiguousFeedSymbol(row.asset) : null;
                            if (symbol) chartSymbols.set(row, symbol);

                            // Apply cached history. Zerion's own 24h change wins over the cached one.
                            const cached = symbol && this.historyCache.get(symbol);
                            if (cached && Date.now() - cached.timestamp < 15 * 60 * 1000) {
                                row.priceHistory = cached.priceHistory;
                                if (row.change24h == null && cached.change24h != null) row.change24h = cached.change24h;
                            }

                            walletRows.push(row);
                        }
                    }
                } catch (err) {
                    // Marked failed, so the wallet's last rows stay.
                    this.renderer.markProviderFailed(source, err);
                    failed++;
                    return;
                }

                this.renderer.appendPositions(walletRows, source);

                // Enrich with Pyth History for Charts
                this.enrichWithPythHistory(walletRows, wallet, generation, row => chartSymbols.get(row));
            }));

            // Every wallet failed: most likely the key. Settings shows this as "Cannot read".
            if (wallets.length > 0 && failed === wallets.length) throw new Error('Zerion read no wallet');
            // Mark the main 'Zerion' provider as completed
            this.renderer.appendPositions([], 'Zerion');
        } catch (e) {
            this.renderer.markProviderFailed('Zerion', e);
        }
    }

    async enrichWithPythHistory(rows, wallet, generation = this.generation, chartSymbolOf = () => null) {
        if (!rows || rows.length === 0) return;
        if (this.settings.showPriceChart === false) return;


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
                    // Check threshold and hidden status
                    const isHidden = this.settings.hiddenAssets && this.settings.hiddenAssets.includes(`${row.asset}_${row.exchange}`);
                    // Use generous threshold check (defaults to 0 if not set)
                    const threshold = this.settings.minBalanceThreshold || 0;
                    if (isHidden || row.value < threshold) {
                        // Skip history for small/hidden assets
                        continue;
                    }

                    // A chart by ticker only for a verified token whose ticker can't mean another coin.
                    const symbol = chartSymbolOf(row);
                    if (!symbol) continue;

                    // Fallback for known assets if missing from dynamic map
                    const FALLBACK_IDS = {
                        'ETH': 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
                        'MON': '31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1',
                        'USDC': 'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a'
                    };
                    const feedId = symbolToId[symbol] || FALLBACK_IDS[symbol];

                    if (feedId) {
                        itemsToFetch.push({ row, feedId, symbol });
                    }
                }
            }

            // console.log(`[Zerion] Enriching ${itemsToFetch.length} items with Pyth history. Assets: ${itemsToFetch.map(i => i.row.asset).join(', ')}`);

            if (itemsToFetch.length === 0) return;

            // 3. Fetch history in batch
            // 3. Fetch history in batch
            const feedIds = itemsToFetch.map(i => i.feedId);
            const now = Date.now(); // Anchor time for consistent grid alignment

            try {
                // Pass 1: Low resolution (24 points / 1h) for FAST load
                const fastResults = await this.providers.pyth.getBatch24hPriceHistory(feedIds, 24, now);

                // Update items with fast data first
                let hasFastData = false;
                for (const { row, feedId } of itemsToFetch) {
                    const normalizedId = feedId.toLowerCase().startsWith('0x') ? feedId.toLowerCase() : `0x${feedId.toLowerCase()}`;
                    const history = fastResults[normalizedId];

                    if (history && history.length > 0) {
                        row.priceHistory = history;
                        hasFastData = true;
                    }
                }

                // Trigger intermediate render if we found data
                if (hasFastData && generation === this.generation) {
                    this.renderer.appendPositions(rows, `Zerion_${wallet}`);
                }

                // Pass 2: High resolution (96 points / 15m) for FINAL quality
                const fullResults = await this.providers.pyth.getBatch24hPriceHistory(feedIds, 96, now);

                for (const { row, feedId, symbol } of itemsToFetch) {
                    const normalizedId = feedId.toLowerCase().startsWith('0x') ? feedId.toLowerCase() : `0x${feedId.toLowerCase()}`;
                    const history = fullResults[normalizedId];

                    if (history && history.length > 0) {
                        // console.log(`[Zerion] Got ${history.length} points for ${row.asset}`);
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
                        this.historyCache.set(symbol, {
                            priceHistory: history,
                            change24h,
                            timestamp: Date.now()
                        });
                    }
                }
            } catch (e) {
                console.warn(`[Zerion] Error fetching batch history:`, e);
            }

            // 4. Update UI, unless a newer round has reported since
            if (generation === this.generation) this.renderer.appendPositions(rows, `Zerion_${wallet}`);

        } catch (e) {
            console.warn(`[Zerion] Failed to enrich history for ${wallet}:`, e);
        }
    }
}
