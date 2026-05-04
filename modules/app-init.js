// ESM bootstrap: expose modules on window without altering existing app flow
import './core/console-policy.js';
import * as Portfolio from './domain/portfolio.js';
import * as IncrementalPortfolio from './domain/incremental-portfolio.js';
import * as Http from './http/client.js';
import * as HL from './data/providers/hyperliquid.js';
import * as CG from './data/providers/coingecko.js';
import * as PYTH from './data/providers/pyth.js';
import * as OPENSEA from './data/providers/opensea.js';
import * as ZERION from './data/providers/zerion.js';
import * as CIELO from './data/providers/cielo.js';
import * as LIGHTER from './data/providers/lighter.js';
import * as BTC from './data/providers/bitcoin.js';
import * as ZEC from './data/providers/zcash.js';
import * as ALCHEMY from './data/providers/alchemy.js';
import * as HELIUS from './data/providers/helius.js';
import * as STOCKS from './data/providers/stocks.js';
import * as IBKR from './data/providers/ibkr.js';
import * as HeroUI from './ui/hero.js';
import * as PositionsUI from './ui/positions.js';
import * as Settings from './core/settings.js';
import * as Themes from './core/themes.js';
import * as Rain from './features/rain.js';
import * as Weather from './features/weather.js';
import * as EntryPriceTracker from './utils/entry-price-tracker.js';
import * as CoinGeckoBatcher from './utils/coingecko-batcher.js';
import * as AssetMapping from './utils/asset-mapping.js';

if (!window.AppModules) {
  window.AppModules = {};
}

window.AppModules.portfolio = Portfolio;
window.AppModules.incrementalPortfolio = IncrementalPortfolio;
window.AppModules.http = Http;
window.AppModules.data = window.AppModules.data || {};
window.AppModules.data.providers = window.AppModules.data.providers || {};
window.AppModules.data.providers.hyperliquid = HL;
window.AppModules.data.providers.coingecko = CG;
window.AppModules.data.providers.pyth = PYTH;
window.AppModules.data.providers.opensea = OPENSEA;
window.AppModules.data.providers.zerion = ZERION;
window.AppModules.data.providers.cielo = CIELO;
window.AppModules.data.providers.lighter = LIGHTER;
window.AppModules.data.providers.bitcoin = BTC;
window.AppModules.data.providers.zcash = ZEC;
window.AppModules.data.providers.alchemy = ALCHEMY;
window.AppModules.data.providers.helius = HELIUS;
window.AppModules.data.providers.stocks = STOCKS;
window.AppModules.data.providers.ibkr = IBKR;
window.AppModules.ui = window.AppModules.ui || {};
window.AppModules.ui.hero = HeroUI;
window.AppModules.ui.positions = PositionsUI;
window.AppModules.utils = window.AppModules.utils || {};
window.AppModules.utils.entryPriceTracker = EntryPriceTracker;
window.AppModules.utils.coinGeckoBatcher = CoinGeckoBatcher;
window.AppModules.utils.assetMapping = AssetMapping;

// README documents walletPnLUtils on window as the entry-price console helper. Expose it here
// (the docs were ahead of the code). See README "Wallet Asset PnL Management" section.
window.walletPnLUtils = {
  viewEntryPrices: EntryPriceTracker.viewEntryPrices,
  setEntryPrice: EntryPriceTracker.setEntryPrice,
  resetEntryPrice: EntryPriceTracker.resetEntryPrice,
  resetAll: EntryPriceTracker.resetAllEntryPrices,
  export: EntryPriceTracker.exportEntryPrices,
  import: EntryPriceTracker.importEntryPrices
};
window.AppModules.core = window.AppModules.core || {};
window.AppModules.core.settings = Settings;
window.AppModules.core.themes = Themes;
window.AppModules.features = window.AppModules.features || {};
window.AppModules.features.rain = Rain;
window.AppModules.features.weather = Weather;

// Modules loaded
