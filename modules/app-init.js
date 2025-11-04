// ESM bootstrap: expose modules on window without altering existing app flow
import * as Portfolio from './domain/portfolio.js';
import * as Http from './http/client.js';
import * as HL from './data/providers/hyperliquid.js';
import * as CG from './data/providers/coingecko.js';
import * as PYTH from './data/providers/pyth.js';
import * as OPENSEA from './data/providers/opensea.js';
import * as ZERION from './data/providers/zerion.js';
import * as LIGHTER from './data/providers/lighter.js';
import * as BTC from './data/providers/bitcoin.js';
import * as ZEC from './data/providers/zcash.js';
import * as HeroUI from './ui/hero.js';
import * as PositionsUI from './ui/positions.js';
import * as Settings from './core/settings.js';
import * as Themes from './core/themes.js';
import * as Rain from './features/rain.js';

if (!window.AppModules) {
  window.AppModules = {};
}

window.AppModules.portfolio = Portfolio;
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
window.AppModules.ui = window.AppModules.ui || {};
window.AppModules.ui.hero = HeroUI;
window.AppModules.ui.positions = PositionsUI;
window.AppModules.core = window.AppModules.core || {};
window.AppModules.core.settings = Settings;
window.AppModules.core.themes = Themes;
window.AppModules.features = window.AppModules.features || {};
window.AppModules.features.rain = Rain;

// Non-blocking log to confirm availability during development
try {
  if (Http.HttpClient && Http.HttpClient.isProductionHost) {
    const env = Http.HttpClient.isProductionHost() ? 'prod' : 'dev';
    console.debug(`[modules] loaded (env=${env})`);
  }
} catch (_) {
  // ignore
}


