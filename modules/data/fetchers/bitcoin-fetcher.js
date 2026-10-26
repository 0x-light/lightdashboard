export class BitcoinZcashFetcher {
    constructor(providers, renderer) {
        this.providers = providers;
        this.renderer = renderer;
    }

    // Bitcoin and Zcash report apart (Bitcoin/Zcash_BTC, Bitcoin/Zcash_ZEC), so one chain's
    // outage keeps its last rows without holding back the other. A balance without a price
    // fails its chain: it would read as $0.
    async fetch(bitcoinAddrs, zcashAddrs) {
        const chains = [
            { asset: 'BTC', exchange: 'Bitcoin', coinId: 'bitcoin', provider: this.providers.bitcoin, addrs: bitcoinAddrs },
            { asset: 'ZEC', exchange: 'Zcash', coinId: 'zcash', provider: this.providers.zcash, addrs: zcashAddrs }
        ].filter(chain => chain.addrs.length > 0);
        const errors = await Promise.all(chains.map(async ({ asset, exchange, coinId, provider, addrs }) => {
            const source = `Bitcoin/Zcash_${asset}`;
            try {
                const balances = await provider.getTokenBalances(addrs, { timeoutMs: 5000 });
                let rows = [];
                if (balances.length > 0) {
                    // Both chains ask for both coins: the client shares one request.
                    const prices = await this.providers.coingecko.getSimplePrice('bitcoin,zcash', { timeoutMs: 5000, ttlMs: 60000 });
                    const quote = prices?.[coinId];
                    const price = Number(quote?.usd);
                    if (!(price > 0)) throw new Error(`No ${asset} price from CoinGecko`);
                    rows = balances.map(b => ({
                        asset,
                        exchange,
                        amount: b.balance,
                        price,
                        value: b.balance * price,
                        change24h: Number.isFinite(quote.usd_24h_change) ? quote.usd_24h_change : null,
                        pnl: null,
                        _changeDetectionKey: `${asset}_${exchange}_${b.address}`
                    }));
                }
                // A complete report: entries of this chain's holdings that are gone are reset.
                const prefix = `${asset}_${exchange}_`;
                if (window.AppModules?.utils?.entryPriceTracker) {
                    rows = window.AppModules.utils.entryPriceTracker
                        .calculatePositionsPnL(rows, { scope: key => key.startsWith(prefix) }).positions;
                }
                this.renderer.appendPositions(rows, source);
                return null;
            } catch (e) {
                this.renderer.markProviderFailed(source, e);
                return e;
            }
        }));
        // Rows saved under the old combined source name are cleared only when every chain
        // reported: a failed chain's old rows stay.
        const error = errors.find(Boolean);
        if (error) this.renderer.markProviderFailed('Bitcoin/Zcash', error);
        else this.renderer.appendPositions([], 'Bitcoin/Zcash');
    }
}
