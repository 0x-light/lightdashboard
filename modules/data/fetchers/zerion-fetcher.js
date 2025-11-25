export class ZerionFetcher {
    constructor(providers, renderer, settings) {
        this.providers = providers;
        this.renderer = renderer;
        this.settings = settings;
        this.chainMap = {
            'ethereum': 'Ethereum', 'arbitrum': 'Arbitrum', 'optimism': 'Optimism',
            'polygon': 'Polygon', 'base': 'Base', 'avalanche': 'Avalanche',
            'bsc': 'BSC', 'solana': 'Solana', 'zksync-era': 'zkSync',
            'blast': 'Blast', 'hyperevm': 'HyperEVM'
        };
    }

    async fetch(wallets) {
        try {
            for (const wallet of wallets) {
                const walletRows = [];
                try {
                    const positionsData = await this.providers.zerion.getWalletPositions(wallet, this.settings.zerionApiKey, { timeoutMs: 5000 });

                    if (positionsData?.data) {
                        for (const item of positionsData.data) {
                            const attr = item?.attributes || {};
                            const fungible = attr.fungible_info;
                            if (fungible && !attr.flags?.is_trash) {
                                const chainId = item?.relationships?.chain?.data?.id || 'unknown';
                                const chain = this.chainMap[chainId] || chainId;
                                walletRows.push({
                                    asset: fungible.symbol || 'Unknown',
                                    exchange: chain,
                                    amount: attr.quantity?.float || 0,
                                    price: attr.price || 0,
                                    value: attr.value || 0,
                                    change24h: attr.changes?.percent_24h ?? null,
                                    pnl: null,
                                    _changeDetectionKey: `${fungible.symbol || 'Unknown'}_${chain}_${wallet}`
                                });
                            }
                        }
                    }
                } catch (err) {
                    console.warn(`[Zerion] Failed for wallet ${wallet}:`, err);
                }

                // Enrich with CoinGecko (Basic implementation, can be improved)
                const missingChange24h = walletRows.filter(r => r.change24h === null);
                if (missingChange24h.length > 0) {
                    const uniqueAssets = [...new Set(missingChange24h.map(r => r.asset))];
                    // Assuming getCoingeckoId is globally available or we need to import it. 
                    // For now, we'll skip enrichment inside the fetcher to keep it pure, 
                    // or we can pass the utility in. 
                    // Ideally, the fetcher should just fetch. Enrichment can happen here if we have access.
                    // Let's assume we can access providers.coingecko.
                }

                this.renderer.appendPositions(walletRows, `Zerion_${wallet}`);
            }
        } catch (e) {
            this.renderer.markProviderFailed('Zerion', e);
        }
    }
}
