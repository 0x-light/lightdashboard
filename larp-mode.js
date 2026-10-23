// Larp mode: a made-up portfolio for screenshots. Settings > Larp turns it on and edits it;
// ?larp turns it on and ?larp=off turns it off.
// Runs before everything else. While it is on, localStorage is a throw-away copy filled from
// the larp config, so the real wallets, keys and positions are never read, shown or written.
// Prices stay live. The larp config itself is kept in the real localStorage (pmLarp.v1).
(function () {
  var KEY = 'pmLarp.v1';
  var real;
  try { real = window.localStorage; } catch (_) { return; }

  var CITIES = {
    'New York': { lat: 40.7128, lon: -74.006, tz: 'America/New_York' },
    'San Francisco': { lat: 37.7749, lon: -122.4194, tz: 'America/Los_Angeles' },
    'London': { lat: 51.5072, lon: -0.1276, tz: 'Europe/London' },
    'Berlin': { lat: 52.52, lon: 13.405, tz: 'Europe/Berlin' },
    'Dubai': { lat: 25.2048, lon: 55.2708, tz: 'Asia/Dubai' },
    'Singapore': { lat: 1.3521, lon: 103.8198, tz: 'Asia/Singapore' },
    'Tokyo': { lat: 35.6762, lon: 139.6503, tz: 'Asia/Tokyo' }
  };

  // gain is a percent on the position, as profit: +10 is up 10%, whether long or short.
  // Entry prices follow the live price, so P&L stays believable whatever the market does.
  var PRESET = {
    name: 'Alex',
    city: 'New York',
    manual: [
      { type: 'pyth', symbol: 'BTC', name: 'Bitcoin', feedId: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', amount: 0.85, entryPrice: 61000, category: 'crypto', currency: 'USD' },
      { type: 'pyth', symbol: 'ETH', name: 'Ethereum', feedId: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', amount: 12, entryPrice: 2900, category: 'crypto', currency: 'USD' },
      { type: 'pyth', symbol: 'SOL', name: 'Solana', feedId: '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d', amount: 140, entryPrice: 120, category: 'crypto', currency: 'USD' },
      { type: 'stock', symbol: 'AAPL', name: 'Apple', amount: 80, entryPrice: 170, category: 'equity', currency: 'USD', exchange: 'NASDAQ' },
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

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  var state = { on: false, config: null };
  try { state = Object.assign(state, JSON.parse(real.getItem(KEY) || 'null') || {}); } catch (_) { /* keep defaults */ }
  var config = Object.assign(clone(PRESET), state.config || {});

  function persist() {
    try { real.setItem(KEY, JSON.stringify({ on: state.on, config: config })); } catch (_) { /* not saved */ }
  }

  try {
    var q = new URLSearchParams(location.search);
    var asked = q.has('larp') ? q.get('larp') : q.get('demo');
    if (asked !== null) {
      state.on = asked !== 'off' && asked !== '0' && asked !== 'false';
      persist();
      q.delete('larp'); q.delete('demo');
      var search = q.toString();
      history.replaceState(null, '', location.pathname + (search ? '?' + search : '') + location.hash);
    }
  } catch (_) { /* leave as saved */ }

  window.larp = {
    on: state.on,
    cities: CITIES,
    config: config,
    preset: function () { return clone(PRESET); },
    save: function (next) { config = next; window.larp.config = next; persist(); },
    setOn: function (on) { state.on = !!on; persist(); }
  };

  if (!state.on) return;

  var city = CITIES[config.city] || CITIES['New York'];
  var settings = {
    theme: 'dark',
    userName: config.name || '',
    portfolioBaseCurrency: 'USD',
    minBalanceThreshold: 0,
    weather: { label: CITIES[config.city] ? config.city : 'New York', lat: city.lat, lon: city.lon },
    // A sample wallet and broker login switch those providers on; their data is made up.
    walletAddresses: (config.hlPerps || []).length + (config.hlSpot || []).length + (config.lighterPerps || []).length + (+config.hlStaked > 0 ? 1 : 0)
      ? '0xa1b2c3d4e5a1b2c3d4e5a1b2c3d4e5a1b2c3d4e5' : '',
    ibkrFlexToken: (config.stocks || []).length + (config.options || []).length + (config.ibkrCash || []).length ? 'larp' : '',
    ibkrFlexQueryId: (config.stocks || []).length + (config.options || []).length + (config.ibkrCash || []).length ? 'larp' : '',
    cryptoPositions: clone(config.manual || []),
    watchlist: String(config.watchlist || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)
      .map(function (symbol) { return { provider: 'yahoo', symbol: symbol, name: null, category: null }; }),
    hideComic: true
  };

  var data = Object.create(null);
  data['myDashboardSettings.v2'] = JSON.stringify(settings);

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
  window.larpTimeZone = city.tz; // clocks show the sample location's time, not the real one
})();
