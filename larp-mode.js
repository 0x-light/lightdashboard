// Larp mode: a made-up portfolio for screenshots. Settings > Demo turns it on and edits it;
// ?larp turns it on and ?larp=off turns it off. ?demo is the link to send people: the sample
// portfolio for that page only, with the suggested watchlist and a card that leads to their own.
// ?demo&theme=<name> shows it in that theme.
// Runs before everything else. While it is on, localStorage is a throw-away copy filled from
// the larp config, so the real wallets, keys and positions are never read, shown or written.
// Prices stay live. The larp config itself is kept in the real localStorage (pmLarp.v1), and
// the last good prices in pmLarp.prices.v1, so a failed price request never drops a row.
(function () {
  var KEY = 'pmLarp.v1';
  var PRICES_KEY = 'pmLarp.prices.v1';
  var SETTINGS_KEY = 'myDashboardSettings.v2';
  var real;
  try { real = window.localStorage; } catch (_) { return; }

  var NEW_YORK = { label: 'New York', region: 'New York, United States', lat: 40.7128, lon: -74.006, tz: 'America/New_York' };
  // Any address and token do: the providers that read them are replaced (larp-data.js).
  var WALLET = '0xa1b2c3d4e5a1b2c3d4e5a1b2c3d4e5a1b2c3d4e5';

  // gain is a percent on the position, as profit: +10 is up 10%, whether long or short.
  // Entry prices follow the live price, so P&L stays believable whatever the market does.
  var PRESET = {
    name: 'Alex',
    place: NEW_YORK,
    manual: [
      { type: 'pyth', symbol: 'BTC', name: 'Bitcoin', feedId: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', amount: 0.85, gain: 34, category: 'crypto', currency: 'USD' },
      { type: 'pyth', symbol: 'ETH', name: 'Ethereum', feedId: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', amount: 12, gain: -12, category: 'crypto', currency: 'USD' },
      { type: 'pyth', symbol: 'SOL', name: 'Solana', feedId: '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d', amount: 140, gain: 18, category: 'crypto', currency: 'USD' },
      { type: 'stock', symbol: 'AAPL', name: 'Apple', amount: 80, gain: 64, category: 'equity', currency: 'USD', exchange: 'NASDAQ' },
      { type: 'custom', name: 'Gold bars', symbol: 'Gold bars', amount: 1, price: 24000, value: 24000, currency: 'USD' },
      { type: 'custom', name: 'Cash', symbol: 'Cash', amount: 1, price: 18000, value: 18000, currency: 'USD' }
    ],
    hlPerps: [
      { coin: 'BTC', size: 0.6, gain: 8, lev: 10, mode: 'cross' },
      { coin: 'HYPE', size: 450, gain: 22, lev: 5, mode: 'isolated' },
      { coin: 'SOL', size: -90, gain: 4, lev: 8, mode: 'cross' }
    ],
    hlSpot: [
      { coin: 'HYPE', amount: 320, gain: 43 },
      { coin: 'USDC', amount: 2400, gain: 0 }
    ],
    hlStaked: 150,
    lighterPerps: [
      { symbol: 'ETH', size: 6, gain: 5, lev: 10 },
      { symbol: 'LINK', size: -800, gain: 6, lev: 5 }
    ],
    stocks: [
      { symbol: 'NVDA', description: 'NVIDIA CORP', exchange: 'NASDAQ', currency: 'USD', qty: 40, gain: 82 },
      { symbol: 'MSFT', description: 'MICROSOFT CORP', exchange: 'NASDAQ', currency: 'USD', qty: 20, gain: 14 },
      { symbol: 'TSM', description: 'TAIWAN SEMICONDUCTOR-SP ADR', exchange: 'NYSE', currency: 'USD', qty: 55, gain: 39 },
      { symbol: 'VOO', description: 'VANGUARD S&P 500 ETF', exchange: 'ARCA', currency: 'USD', qty: 30, gain: 8, category: 'ETF' },
      { symbol: 'ASML', description: 'ASML HOLDING NV', exchange: 'AEB', currency: 'EUR', qty: 12, gain: -11, yahoo: 'ASML.AS' },
      { symbol: 'VWCE', description: 'VANGUARD FTSE ALL-WORLD UCITS ETF', exchange: 'IBIS2', currency: 'EUR', qty: 90, gain: 11, category: 'ETF', yahoo: 'VWCE.DE' }
    ],
    options: [
      { underlying: 'NVDA', expiry: '2027-01-15', strike: 240, right: 'C', qty: 4, entry: 11.5 },
      { underlying: 'NVDA', expiry: '2027-01-15', strike: 280, right: 'C', qty: -4, entry: 5.2 },
      { underlying: 'MSFT', expiry: '2026-12-18', strike: 560, right: 'C', qty: 2, entry: 24.8 },
      { underlying: 'AAPL', expiry: '2026-12-18', strike: 300, right: 'P', qty: -3, entry: 5.6 }
    ],
    ibkrCash: [
      { currency: 'USD', amount: 9400 },
      { currency: 'EUR', amount: 3100 }
    ],
    watchlist: 'TSLA, AMZN, GC=F, ^GSPC'
  };

  // What a demo link shows: three spot holdings and the perps, with no broker account.
  var DEMO = Object.assign({}, PRESET, {
    manual: PRESET.manual.filter(function (row) { return ['BTC', 'Gold bars', 'Cash'].indexOf(row.symbol) !== -1; }),
    hlSpot: [], hlStaked: 0, stocks: [], options: [], ibkrCash: []
  });

  // The markets the watchlist suggests before anything is typed (WATCHLIST_MARKETS in app.js).
  var BASICS = [
    { provider: 'yahoo', symbol: '^GSPC', label: 'SPX', name: 'S&P 500', category: 'index' },
    { provider: 'yahoo', symbol: '^NDX', label: 'NDX', name: 'Nasdaq 100', category: 'index' },
    { provider: 'yahoo', symbol: '^VIX', label: 'VIX', name: 'Cboe volatility', category: 'index' },
    { provider: 'yahoo', symbol: 'DX-Y.NYB', label: 'DXY', name: 'ICE US dollar', category: 'index' },
    { provider: 'yahoo', symbol: '^TNX', label: 'US10Y', name: '10-year Treasury yield', category: 'index' },
    { provider: 'yahoo', symbol: 'GC=F', label: 'GOLD', name: 'Gold futures', category: 'commodity' },
    { provider: 'yahoo', symbol: 'SI=F', label: 'SILVER', name: 'Silver futures', category: 'commodity' },
    { provider: 'yahoo', symbol: 'BZ=F', label: 'BRENT', name: 'Brent crude futures', category: 'commodity' },
    { provider: 'pyth', id: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43' },
    { provider: 'pyth', id: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace' },
    { provider: 'yahoo', symbol: 'EURUSD=X', label: 'EUR/USD', name: 'Euro / US dollar', category: 'fx' }
  ];

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  var state = { on: false, config: null, saved: {} };
  try { state = Object.assign(state, JSON.parse(real.getItem(KEY) || 'null') || {}); } catch (_) { /* keep defaults */ }
  if (!state.saved || typeof state.saved !== 'object') state.saved = {};
  var config = Object.assign(clone(PRESET), state.config || {});
  if (!config.place || !Number.isFinite(config.place.lat)) config.place = clone(NEW_YORK); // older saves named a city

  var prices = { hl: {}, yahoo: {}, feed: {}, manual: {} };
  try { prices = Object.assign(prices, JSON.parse(real.getItem(PRICES_KEY) || 'null') || {}); } catch (_) { /* start empty */ }

  // Older saves gave manual positions an entry price. Turn it into a gain where a price is known.
  (config.manual || []).forEach(function (row) {
    var price = prices.manual[String(row.symbol || '').toUpperCase()];
    if (row.type !== 'custom' && !Number.isFinite(row.gain) && row.entryPrice > 0 && price > 0) {
      row.gain = Math.round((price / row.entryPrice - 1) * 100);
      delete row.entryPrice;
    }
  });

  var shared = false; // opened from a ?demo link

  function persist() {
    if (shared) return; // a demo link changes nothing that is kept
    try { real.setItem(KEY, JSON.stringify({ on: state.on, config: config, saved: state.saved })); } catch (_) { /* not saved */ }
  }
  var pricesTimer = null;
  function persistPrices() {
    clearTimeout(pricesTimer);
    pricesTimer = setTimeout(function () {
      try { real.setItem(PRICES_KEY, JSON.stringify(prices)); } catch (_) { /* not saved */ }
    }, 1000);
  }

  try {
    var q = new URLSearchParams(location.search);
    var asked = q.has('larp') ? q.get('larp') : q.get('demo');
    var off = asked === 'off' || asked === '0' || asked === 'false';
    var linkTheme = /^[a-z0-9-]+$/i.test(q.get('theme') || '') ? q.get('theme') : null;
    if (q.has('demo') && !q.has('larp') && !off) {
      // The link stays in the address bar, so a reload shows the demo again and the plain
      // address shows the visitor's own portfolio.
      shared = true;
      config = clone(DEMO);
    } else if (asked !== null) {
      state.on = !off;
      persist();
      q.delete('larp'); q.delete('demo');
      var search = q.toString();
      history.replaceState(null, '', location.pathname + (search ? '?' + search : '') + location.hash);
    }
  } catch (_) { /* leave as saved */ }

  // The settings that come from the larp config. The rest of the copy is the app's own.
  function larpSettings(c) {
    var place = c.place || NEW_YORK;
    return {
      userName: c.name || '',
      weather: { label: place.label, region: place.region, lat: place.lat, lon: place.lon },
      walletAddresses: WALLET,
      ibkrFlexToken: shared ? '' : 'larp',
      ibkrFlexQueryId: shared ? '' : 'larp',
      cryptoPositions: clone(c.manual || []),
      watchlist: shared ? clone(BASICS) : String(c.watchlist || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)
        .map(function (symbol) { return { provider: 'yahoo', symbol: symbol, name: null, category: null }; })
    };
  }

  var data = Object.create(null);

  // The page without ?demo: the visitor's own portfolio.
  function ownAddress() {
    var q = new URLSearchParams(location.search);
    q.delete('demo'); q.delete('theme');
    var search = q.toString();
    return location.pathname + (search ? '?' + search : '') + location.hash;
  }

  window.larp = {
    on: state.on || shared,
    shared: shared,
    ownAddress: ownAddress,
    config: config,
    prices: prices,
    rememberPrices: persistPrices,
    preset: function () { return clone(PRESET); },
    save: function (next) { config = next; window.larp.config = next; persist(); },
    setOn: function (on) {
      if (shared) { if (!on) location.assign(ownAddress()); return; }
      state.on = !!on; persist();
    },
    saved: function () { return state.saved; },
    keep: function (name, c) { state.saved[name] = clone(c); persist(); },
    forget: function (name) { delete state.saved[name]; persist(); },
    // Writes the config into the page's copy of the settings. Returns false when larp is off.
    apply: function () {
      if (!window.larp.on) return false;
      var current = {};
      try { current = JSON.parse(data[SETTINGS_KEY] || '{}') || {}; } catch (_) { /* start again */ }
      data[SETTINGS_KEY] = JSON.stringify(Object.assign(current, larpSettings(config)));
      window.larpTimeZone = (config.place && config.place.tz) || undefined;
      return true;
    }
  };

  if (!window.larp.on) return;

  data[SETTINGS_KEY] = JSON.stringify(Object.assign({
    theme: 'dark',
    portfolioBaseCurrency: 'USD',
    minBalanceThreshold: 0,
    hideComic: !shared // screenshots leave the comic out; a demo link shows the whole page
  }, larpSettings(config), shared && linkTheme ? { theme: linkTheme, seasonalThemes: false } : {}));

  var methods = {
    getItem: function (k) { k = String(k); return k in data ? data[k] : null; },
    setItem: function (k, v) { data[String(k)] = String(v); },
    removeItem: function (k) { delete data[String(k)]; },
    clear: function () { for (var k in data) delete data[k]; },
    key: function (i) { return Object.keys(data)[i] || null; }
  };
  var fake = new Proxy({}, {
    get: function (_t, p) {
      if (p === 'length') return Object.keys(data).length;
      if (typeof p === 'string' && methods[p]) return methods[p];
      return typeof p === 'string' && p in data ? data[p] : undefined;
    },
    set: function (_t, p, v) { data[String(p)] = String(v); return true; },
    deleteProperty: function (_t, p) { delete data[p]; return true; },
    has: function (_t, p) { return p in data; },
    ownKeys: function () { return Object.keys(data); },
    getOwnPropertyDescriptor: function (_t, p) {
      return p in data ? { value: data[p], writable: true, enumerable: true, configurable: true } : undefined;
    }
  });
  try {
    Object.defineProperty(window, 'localStorage', { value: fake, configurable: true });
  } catch (_) { window.larp.on = false; return; }
  document.documentElement.dataset.larp = 'on';
  window.larpTimeZone = config.place.tz || undefined; // clocks show the sample location's time, not the real one
})();
