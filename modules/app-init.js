// ESM bootstrap: expose modules on window without altering existing app flow
import * as Portfolio from './domain/portfolio.js?v=2.5.0';
import * as IncrementalPortfolio from './domain/incremental-portfolio.js?v=2.5.0';
import * as Http from './http/client.js?v=2.5.0';
import * as HL from './data/providers/hyperliquid.js?v=2.5.0';
import * as CG from './data/providers/coingecko.js?v=2.5.0';
import * as PYTH from './data/providers/pyth.js?v=2.5.0';
import * as OPENSEA from './data/providers/opensea.js?v=2.5.0';
import * as ZERION from './data/providers/zerion.js?v=2.5.0';
import * as LIGHTER from './data/providers/lighter.js?v=2.5.0';
import * as BTC from './data/providers/bitcoin.js?v=2.5.0';
import * as ZEC from './data/providers/zcash.js?v=2.5.0';
import * as ALCHEMY from './data/providers/alchemy.js?v=2.5.0';
import * as HELIUS from './data/providers/helius.js?v=2.5.0';
import * as HeroUI from './ui/hero.js?v=2.5.0';
import * as PositionsUI from './ui/positions.js?v=2.5.0';
import * as Settings from './core/settings.js?v=2.5.0';
import * as Themes from './core/themes.js?v=2.5.0';
import * as Rain from './features/rain.js?v=2.5.0';
import * as Weather from './features/weather.js?v=2.5.0';

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
window.AppModules.data.providers.lighter = LIGHTER;
window.AppModules.data.providers.bitcoin = BTC;
window.AppModules.data.providers.zcash = ZEC;
window.AppModules.data.providers.alchemy = ALCHEMY;
window.AppModules.data.providers.helius = HELIUS;
window.AppModules.data.providers.weather = Weather;
window.AppModules.ui = window.AppModules.ui || {};
window.AppModules.ui.hero = HeroUI;
window.AppModules.ui.positions = PositionsUI;
window.AppModules.core = window.AppModules.core || {};
window.AppModules.core.settings = Settings;
window.AppModules.core.themes = Themes;
window.AppModules.features = window.AppModules.features || {};
window.AppModules.features.rain = Rain;

// Modules loaded


