export class LighterFetcher {
    constructor(providers, renderer) {
        this.providers = providers;
        this.renderer = renderer;
    }

    async fetch(wallets) {
        try {
            await Promise.all(wallets.map(async (wallet) => {
                const walletRows = [];
                try {
                    const data = await this.providers.lighter.fetchAccountByAddress(wallet, { timeoutMs: 3000 });
                    if (data?.accounts?.[0]) {
                        const account = data.accounts[0];
                        const equity = parseFloat(account.equity_usd || account.total_equity || account.equity || 0);
                        const pnl = parseFloat(account.unrealized_pnl || account.pnl || 0);

                        if (equity > 0) {
                            walletRows.push({
                                asset: 'LIGHTER_ACCOUNT_EQUITY',
                                exchange: 'Lighter',
                                amount: 1,
                                price: equity,
                                value: equity,
                                pnl,
                                isLighterAccountEquity: true,
                                isLeveraged: false,
                                _changeDetectionKey: `LIGHTER_ACCOUNT_EQUITY_Lighter_${wallet}`
                            });
                        }
                    }
                } catch (walletError) {
                    // Suppress 400/404 errors which likely mean account doesn't exist
                    if (!walletError.message?.includes('400') && !walletError.message?.includes('404')) {
                        console.warn(`[Lighter] Error for wallet ${wallet}:`, walletError.message);
                    }
                }

                this.renderer.appendPositions(walletRows, `Lighter_${wallet}`);
            }));

            // Mark the main 'Lighter' provider as completed
            this.renderer.appendPositions([], 'Lighter');
        } catch (e) {
            this.renderer.markProviderFailed('Lighter', e);
        }
    }
}
