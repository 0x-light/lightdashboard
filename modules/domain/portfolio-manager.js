export class PortfolioManager {
    constructor(renderer, providers, settings) {
        this.renderer = renderer;
        this.providers = providers;
        this.settings = settings;
        this.fetchers = {};
        // Fetcher name -> its running fetch. Each source refreshes on its own: a slow one skips
        // only its own next round and never holds the others back.
        this.inFlight = new Map();
    }

    get isFetching() {
        return this.inFlight.size > 0;
    }

    registerFetcher(name, fetcher) {
        this.fetchers[name] = fetcher;
    }

    // Starts `name`'s fetch unless its previous one is still running; resolves when it ends.
    run(name, start) {
        if (this.inFlight.has(name)) return this.inFlight.get(name);
        const promise = Promise.resolve()
            .then(start)
            .catch(e => console.error(`[PortfolioManager] ${name} fetch failed:`, e))
            .finally(() => this.inFlight.delete(name));
        this.inFlight.set(name, promise);
        return promise;
    }

    async fetchAll(wallets, solanaAddrs, bitcoinAddrs, zcashAddrs) {
        const runs = [];
        const start = (name, ...args) => runs.push(this.run(name, () => this.fetchers[name].fetch(...args)));

        // 1. Hyperliquid
        if (this.fetchers['Hyperliquid'] && wallets.length > 0) start('Hyperliquid', wallets);

        // 2. Lighter
        if (this.fetchers['Lighter'] && wallets.length > 0) start('Lighter', wallets);

        // 3. Onchain wallet data: whichever key is set (Zerion first), else Alchemy/Helius
        if (wallets.length > 0) {
            if (this.fetchers['Zerion'] && this.settings.zerionApiKey) {
                start('Zerion', wallets);
            } else if (this.fetchers['Cielo'] && this.settings.cieloApiKey) {
                start('Cielo', wallets);
            } else if (this.fetchers['AlchemyHelius'] && (this.settings.alchemyApiKey || this.settings.heliusApiKey)) {
                start('AlchemyHelius', wallets, solanaAddrs);
            }
        } else if (this.fetchers['AlchemyHelius'] && solanaAddrs.length > 0 && this.settings.heliusApiKey) {
            // Solana-only via Helius
            start('AlchemyHelius', wallets, solanaAddrs);
        }

        // 4. Bitcoin/Zcash
        if (this.fetchers['BitcoinZcash'] && (bitcoinAddrs.length > 0 || zcashAddrs.length > 0)) {
            start('BitcoinZcash', bitcoinAddrs, zcashAddrs);
        }

        // 5. Manual
        if (this.fetchers['Manual'] && this.settings.cryptoPositions?.length > 0) {
            start('Manual', this.settings.cryptoPositions);
        }

        // 6. Interactive Brokers (Flex Web Service)
        if (this.fetchers['IBKR'] && this.settings.ibkrFlexToken && this.settings.ibkrFlexQueryId) {
            start('IBKR');
        }

        await Promise.allSettled(runs);
    }
}
