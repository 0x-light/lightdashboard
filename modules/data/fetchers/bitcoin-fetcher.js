export class BitcoinZcashFetcher {
    constructor(providers, renderer) {
        this.providers = providers;
        this.renderer = renderer;
    }

    async fetch(bitcoinAddrs, zcashAddrs) {
        try {
            const [btcTokens, zcashTokens, cryptoPrices] = await Promise.all([
                bitcoinAddrs.length > 0 ? this.providers.bitcoin.getTokenBalances(bitcoinAddrs, { timeoutMs: 5000 }) : [],
                zcashAddrs.length > 0 ? this.providers.zcash.getTokenBalances(zcashAddrs, { timeoutMs: 5000 }) : [],
                this.providers.coingecko.getSimplePrice('bitcoin,zcash', { timeoutMs: 5000, ttlMs: 60000 })
            ]);

            let rows = [];
            const btcPrice = cryptoPrices?.bitcoin?.usd || 0;
            const zecPrice = cryptoPrices?.zcash?.usd || 0;

            for (const btc of btcTokens) {
                rows.push({
                    asset: 'BTC',
                    exchange: 'Bitcoin',
                    amount: btc.balance,
                    price: btcPrice,
                    value: btc.balance * btcPrice,
                    change24h: cryptoPrices?.bitcoin?.usd_24h_change,
                    pnl: null,
                    _changeDetectionKey: `BTC_Bitcoin_${btc.address}`
                });
            }

            for (const zec of zcashTokens) {
                rows.push({
                    asset: 'ZEC',
                    exchange: 'Zcash',
                    amount: zec.balance,
                    price: zecPrice,
                    value: zec.balance * zecPrice,
                    change24h: cryptoPrices?.zcash?.usd_24h_change,
                    pnl: null,
                    _changeDetectionKey: `ZEC_Zcash_${zec.address}`
                });
            }

            // Calculate PnL if utility is available
            if (window.AppModules?.utils?.entryPriceTracker) {
                const result = window.AppModules.utils.entryPriceTracker.calculatePositionsPnL(rows);
                rows = result.positions;
            }

            this.renderer.appendPositions(rows, 'Bitcoin/Zcash');
        } catch (e) {
            this.renderer.markProviderFailed('Bitcoin/Zcash', e);
        }
    }
}
