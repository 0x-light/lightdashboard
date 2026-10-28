// Settings > Demo: turns larp mode on and off and edits the made-up portfolio it shows.
// The config lives in window.larp (larp-mode.js). Edits save as you type and, while larp mode
// is on, show on the page behind the dialog a moment later, without a reload.
import { PRESETS } from '../larp/larp-presets.js';

const upper = v => String(v ?? '').trim().toUpperCase();
const num = v => (v === '' || v === null || v === undefined ? null : Number(v));
const STABLE = new Set(['USDC', 'USDT', 'USDH', 'USDE']);

// Real Pyth ids for the sample's coins; other coins get a made-up id, as pricing only needs
// the symbol (pyth.js registerFeedHints).
const FEEDS = {
  BTC: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  ETH: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  SOL: '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d'
};
const feedIdFor = symbol => FEEDS[symbol]
  || '0x' + Array.from(`larp:${symbol}`.slice(0, 32), ch => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0');

// Hyperliquid's coin names, to tell crypto from stocks and to spell coins as Hyperliquid does
// (kPEPE). Filled from the last good prices, then from a live request.
const coins = new Map(); // upper case -> Hyperliquid's name
function learnCoins(mids) {
  for (const name of Object.keys(mids || {})) if (!name.startsWith('@')) coins.set(name.toUpperCase(), name);
}
const coinName = v => coins.get(upper(v)) || upper(v);
const isCoin = v => coins.has(upper(v)) || STABLE.has(upper(v));

function setManualSymbol(row, value) {
  const symbol = upper(value);
  row.symbol = symbol;
  row.name = symbol;
  delete row.entryPrice;
  if (isCoin(symbol)) {
    Object.assign(row, { type: 'pyth', feedId: feedIdFor(symbol), category: 'crypto', currency: 'USD' });
    delete row.exchange;
  } else {
    Object.assign(row, { type: 'stock', category: 'equity', exchange: null });
    delete row.feedId;
    delete row.currency; // the quote's currency
  }
}

// A manual row saved with an entry price shows its gain at the last known price.
function manualGain(row) {
  if (typeof row.gain === 'number') return row.gain;
  const price = window.larp?.prices?.manual?.[upper(row.symbol)];
  return row.entryPrice > 0 && price > 0 ? Math.round((price / row.entryPrice - 1) * 100) : null;
}

// Where a row lives in the config, how its cells read and write it, and what prices it.
// `kind` says where its price comes from: 'coin' (Hyperliquid) or 'stock' (Yahoo).
const VENUES = {
  manual: {
    label: 'Manual', list: 'manual', filter: r => r.type === 'pyth' || r.type === 'stock',
    blank: () => ({ type: 'stock', symbol: '', name: '', amount: 1, gain: 0, category: 'equity', exchange: null }),
    get: { symbol: r => r.symbol, amount: r => r.amount, gain: manualGain },
    set: { symbol: setManualSymbol, amount: (r, v) => { r.amount = v; }, gain: (r, v) => { r.gain = v; delete r.entryPrice; } },
    kind: r => (r.type === 'pyth' ? 'coin' : 'stock'), quote: r => upper(r.symbol)
  },
  hlSpot: {
    label: 'Hyperliquid', list: 'hlSpot',
    blank: () => ({ coin: '', amount: 1, gain: 0 }),
    get: { symbol: r => r.coin, amount: r => r.amount, gain: r => r.gain },
    set: { symbol: (r, v) => { r.coin = coinName(v); }, amount: (r, v) => { r.amount = v; }, gain: (r, v) => { r.gain = v; } },
    kind: () => 'coin', quote: r => r.coin
  },
  stocks: {
    label: 'IBKR', list: 'stocks',
    blank: () => ({ symbol: '', description: '', exchange: 'NASDAQ', currency: 'USD', qty: 1, gain: 0 }),
    get: { symbol: r => r.symbol, amount: r => r.qty, gain: r => r.gain },
    set: {
      symbol: (r, v) => { r.symbol = upper(v); r.description = r.symbol; delete r.yahoo; },
      amount: (r, v) => { r.qty = v; },
      gain: (r, v) => { r.gain = v; }
    },
    kind: () => 'stock', quote: r => r.yahoo || upper(r.symbol)
  },
  hlPerps: {
    label: 'Hyperliquid', list: 'hlPerps',
    blank: () => ({ coin: '', size: 1, gain: 0, lev: 5, mode: 'cross' }),
    get: { symbol: r => r.coin, amount: r => r.size, gain: r => r.gain, lev: r => r.lev },
    set: { symbol: (r, v) => { r.coin = coinName(v); }, amount: (r, v) => { r.size = v; }, gain: (r, v) => { r.gain = v; }, lev: (r, v) => { r.lev = v; } },
    kind: () => 'coin', quote: r => r.coin
  },
  lighterPerps: {
    label: 'Lighter', list: 'lighterPerps',
    blank: () => ({ symbol: '', size: 1, gain: 0, lev: 5 }),
    get: { symbol: r => r.symbol, amount: r => r.size, gain: r => r.gain, lev: r => r.lev },
    set: { symbol: (r, v) => { r.symbol = coinName(v); }, amount: (r, v) => { r.size = v; }, gain: (r, v) => { r.gain = v; }, lev: (r, v) => { r.lev = v; } },
    kind: () => 'coin', quote: r => r.symbol
  },
  options: {
    label: 'IBKR', list: 'options',
    blank: () => ({ underlying: '', expiry: '', strike: 0, right: 'C', qty: 1, entry: 1 }),
    get: { symbol: r => r.underlying, expiry: r => r.expiry, strike: r => r.strike, right: r => r.right, amount: r => r.qty, entry: r => r.entry },
    set: {
      symbol: (r, v) => { r.underlying = upper(v); },
      expiry: (r, v) => { r.expiry = v; },
      strike: (r, v) => { r.strike = v; },
      right: (r, v) => { r.right = v; },
      amount: (r, v) => { r.qty = v; },
      entry: (r, v) => { r.entry = v; }
    },
    kind: () => 'stock', quote: r => upper(r.underlying)
  },
  ibkrCash: {
    label: 'IBKR', list: 'ibkrCash',
    blank: () => ({ currency: 'USD', amount: 0 }),
    get: { symbol: r => r.currency, amount: r => r.amount },
    set: { symbol: (r, v) => { r.currency = upper(v); }, amount: (r, v) => { r.amount = v; } }
  },
  fixed: {
    label: 'Manual', list: 'manual', filter: r => r.type === 'custom',
    blank: () => ({ type: 'custom', name: '', symbol: '', amount: 1, price: 0, value: 0, currency: 'USD' }),
    get: { symbol: r => r.name, amount: r => r.value },
    set: { symbol: (r, v) => { r.name = v; r.symbol = v; }, amount: (r, v) => { r.value = v; r.price = v; } }
  }
};

// The lists as people think of them; the venue column moves a row between accounts.
const GROUPS = [
  {
    id: 'holdings', title: 'Holdings', hint: 'Gain is the profit in %.', venues: ['manual', 'hlSpot', 'stocks'],
    cols: [
      { key: 'symbol', label: 'Symbol' },
      { key: 'amount', label: 'Amount', kind: 'number' },
      { key: 'gain', label: 'Gain %', kind: 'number', w: 0.8 },
      { key: 'venue', label: 'Venue', kind: 'venue', w: 1.6 }
    ]
  },
  {
    id: 'perps', title: 'Perps', hint: 'Gain is the profit in %. Enter a negative size for a short.', venues: ['hlPerps', 'lighterPerps'],
    cols: [
      { key: 'symbol', label: 'Coin' },
      { key: 'amount', label: 'Size', kind: 'number' },
      { key: 'gain', label: 'Gain %', kind: 'number', w: 0.8 },
      { key: 'lev', label: 'Lev', kind: 'number', w: 0.6 },
      { key: 'venue', label: 'Venue', kind: 'venue', w: 1.6 }
    ]
  },
  {
    id: 'options', title: 'Options at IBKR', hint: 'Entry is the price for one share. Enter negative contracts for a short.', venues: ['options'],
    cols: [
      { key: 'symbol', label: 'Stock', w: 0.8 },
      { key: 'expiry', label: 'Expiry', kind: 'date', w: 1.7 },
      { key: 'strike', label: 'Strike', kind: 'number', w: 0.8 },
      { key: 'right', label: 'C/P', kind: 'select', opts: [['C', 'C'], ['P', 'P']], w: 0.9 },
      { key: 'amount', label: 'Contracts', kind: 'number', w: 1.1 },
      { key: 'entry', label: 'Entry', kind: 'number', w: 0.9 }
    ]
  },
  {
    id: 'cash', title: 'Cash at IBKR', venues: ['ibkrCash'],
    cols: [
      { key: 'symbol', label: 'Currency' },
      { key: 'amount', label: 'Amount', kind: 'number' }
    ]
  },
  {
    id: 'fixed', title: 'Fixed values', hint: 'A value that does not move, as a house.', venues: ['fixed'],
    cols: [
      { key: 'symbol', label: 'Name', w: 1.6 },
      { key: 'amount', label: 'Value', kind: 'number' }
    ]
  }
];

// Rows of a group in order: each venue's rows, as `{ venue, i, row }` (i is the list index).
function rowsOf(group, config) {
  return group.venues.flatMap(id => {
    const venue = VENUES[id];
    return (config[venue.list] || []).map((row, i) => ({ venue: id, i, row })).filter(({ row }) => !venue.filter || venue.filter(row));
  });
}

// The portfolio parts of a config: what a preset replaces.
const PORTFOLIO_KEYS = ['manual', 'hlPerps', 'hlSpot', 'hlStaked', 'lighterPerps', 'stocks', 'options', 'ibkrCash', 'watchlist'];
const clone = x => JSON.parse(JSON.stringify(x));

// Places matching a typed name (Open-Meteo), with the time zone the clocks need.
async function searchPlaces(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=6&language=en&format=json`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  return ((await resp.json()).results || []).map(r => ({
    label: r.name,
    region: [r.admin1, r.country].filter((part, i, all) => part && part !== r.name && all.indexOf(part) === i).join(', '),
    lat: r.latitude,
    lon: r.longitude,
    tz: r.timezone
  }));
}

const placeText = place => (place?.region ? `${place.label}, ${place.region}` : place?.label || '');

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// One cell: its own label (shown on phones, where the rows are cards) and the field.
function cell(group, col, { venue, i, row }) {
  const fieldId = `larp-${venue}-${i}-${col.key}`;
  const attrs = `id="${fieldId}" data-venue="${venue}" data-i="${i}" data-c="${col.key}"`;
  const style = col.w ? ` style="--w: ${col.w}"` : '';
  let field;
  if (col.kind === 'venue' || col.kind === 'select') {
    const opts = col.kind === 'venue' ? group.venues.map(v => [v, VENUES[v].label]) : col.opts;
    const value = col.kind === 'venue' ? venue : VENUES[venue].get[col.key](row);
    const options = opts.map(([v, text]) => `<option value="${v}"${v === value ? ' selected' : ''}>${esc(text)}</option>`).join('');
    field = `<span class="select"><select ${attrs}>${options}</select></span>`;
  } else {
    const value = VENUES[venue].get[col.key]?.(row);
    const type = col.kind === 'number' ? 'number" step="any' : col.kind === 'date' ? 'date' : 'text';
    field = `<input type="${type}" ${attrs} value="${esc(value)}" autocomplete="off" spellcheck="false">`;
  }
  return `<div class="larp-cell"${style}><label class="larp-cell-label" for="${fieldId}">${esc(col.label)}</label>${field}</div>`;
}

function renderGroup(group, config) {
  const rows = rowsOf(group, config);
  const head = group.cols.map(c => `<span class="larp-head-cell"${c.w ? ` style="--w: ${c.w}"` : ''}>${esc(c.label)}</span>`).join('');
  const body = rows.map(r => `
    <div class="larp-row">
      ${group.cols.map(col => cell(group, col, r)).join('')}
      <button type="button" class="larp-remove" data-remove="${r.venue}" data-i="${r.i}" aria-label="Remove ${esc(VENUES[r.venue].get.symbol(r.row) || 'row')}">×</button>
    </div>`).join('');
  const staked = group.id === 'holdings' ? `
      <label>Staked HYPE
        <input type="number" step="any" class="settings-input settings-input-short" id="larpStaked" value="${esc(config.hlStaked)}">
      </label>` : '';
  return `
    <section class="settings-box">
      <h3 class="settings-group">${esc(group.title)}</h3>
      ${group.hint ? `<div class="info">${group.hint}</div>` : ''}
      <div class="larp-list" data-list="${group.id}">
        ${rows.length ? `<div class="larp-row larp-head" aria-hidden="true">${head}<span class="larp-remove-gap"></span></div>` : ''}
        ${body}
      </div>
      <p class="info larp-problems" data-problems="${group.id}" hidden></p>
      <button type="button" class="btn-text" data-add="${group.id}">Add</button>${staked}
    </section>`;
}

// What is wrong with a row, if anything. `priced(kind, symbol)` is true, false or null (not
// known yet).
function problemOf(venueId, row, priced) {
  const venue = VENUES[venueId];
  const symbol = String(venue.get.symbol(row) ?? '').trim();
  const amount = Number(venue.get.amount(row));
  if (!symbol) return { key: 'symbol', text: 'Enter a symbol or a name.' };
  if (venueId === 'ibkrCash') {
    if (!/^[A-Z]{3}$/.test(symbol)) return { key: 'symbol', text: 'Use a 3-letter currency, as USD.' };
  } else if (venue.kind && priced(venue.kind(row), venue.quote(row)) === false) {
    // An option is priced on its own; its stock only has to exist.
    return { key: 'symbol', text: venueId === 'options' ? `No price for ${symbol}.` : `No price for ${symbol}. The row does not show.` };
  }
  if (!amount) return { key: 'amount', text: `${symbol} has no amount. The row does not show.` };
  if (venueId === 'options') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.expiry || '')) return { key: 'expiry', text: `Enter the expiry of the ${symbol} option.` };
    if (row.expiry < new Date().toISOString().slice(0, 10)) return { key: 'expiry', text: `The ${symbol} option expired.` };
    if (!(Number(row.strike) > 0)) return { key: 'strike', text: `Enter the strike of the ${symbol} option.` };
  }
  return null;
}

export function setupLarpSettings({ invalidateSettingsCache, refresh } = {}) {
  const root = document.getElementById('larpRoot');
  const larp = window.larp;
  if (!root || !larp) return;

  let dirty = false;
  let saveTimer = null;
  let applyTimer = null;
  let undo = null; // { config, text } after a load, until the next edit
  let picked = 'sample'; // the Start from choice, kept across renders
  const config = () => larp.config;

  // Shows the config on the page: the copy of the settings, the General tab's fields (the
  // settings dialog saves them on close) and a fresh fetch.
  const apply = async () => {
    if (!larp.apply()) return;
    larp.refresh?.();
    const c = config();
    const name = document.getElementById('newUserName');
    if (name) name.value = c.name || '';
    const city = document.getElementById('newWeatherCity');
    if (city) city.value = placeText(c.place);
    invalidateSettingsCache?.();
    await refresh?.();
  };
  const flush = () => { clearTimeout(saveTimer); larp.save(config()); };
  const touch = ({ keepUndo = false } = {}) => {
    dirty = true;
    if (!keepUndo && undo) { undo = null; showStatus(''); }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 200);
    clearTimeout(applyTimer);
    applyTimer = setTimeout(apply, 700);
    check();
  };

  // Prices, to say which symbols have none. Coins come from Hyperliquid; stocks from Yahoo,
  // asked once each.
  learnCoins(larp.prices?.hl);
  const stockPriced = new Map(); // symbol -> true | false | promise
  let coinsLoaded = coins.size > 0;
  const priced = (kind, symbol) => {
    const s = String(symbol || '');
    if (kind === 'coin') return coinsLoaded ? isCoin(s) : null;
    const known = stockPriced.get(s);
    return typeof known === 'boolean' ? known : null;
  };
  const askPrices = (symbols) => {
    const providers = window.AppModules?.data?.providers;
    if (!coinsLoaded && providers?.hyperliquid?.fetchAllMids) {
      coinsLoaded = 'loading';
      Promise.resolve(providers.hyperliquid.fetchAllMids(4000)).then((mids) => {
        learnCoins(mids);
        coinsLoaded = coins.size > 0;
        // A manual holding typed before the coin list came may be a coin.
        for (const row of config().manual || []) {
          if ((row.type === 'stock') && isCoin(row.symbol)) { setManualSymbol(row, row.symbol); touch({ keepUndo: true }); }
        }
        check();
      }, () => { coinsLoaded = false; });
    }
    const todo = symbols.filter(s => s && !stockPriced.has(s));
    if (!todo.length || !providers?.stocks?.getQuotes) return;
    const ask = Promise.resolve(providers.stocks.getQuotes(todo, { timeoutMs: 6000 })).then((quotes) => {
      todo.forEach(s => stockPriced.set(s, Number(quotes?.[s]?.price) > 0));
      check();
    }, () => todo.forEach(s => stockPriced.delete(s)));
    todo.forEach(s => stockPriced.set(s, ask));
  };

  // Marks the cells with a problem and says what it is under the list, in place, so typing
  // keeps its focus.
  let checkTimer = null;
  const check = () => {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(() => {
      const c = config();
      const stocks = [];
      for (const group of GROUPS) {
        const texts = [];
        for (const r of rowsOf(group, c)) {
          const venue = VENUES[r.venue];
          if (venue.kind?.(r.row) === 'stock') stocks.push(venue.quote(r.row));
          const problem = problemOf(r.venue, r.row, priced);
          root.querySelectorAll(`[data-venue="${r.venue}"][data-i="${r.i}"]`).forEach((el) => {
            const bad = problem && el.dataset.c === problem.key;
            if (bad) el.setAttribute('aria-invalid', 'true');
            else el.removeAttribute('aria-invalid');
          });
          if (problem && !texts.includes(problem.text)) texts.push(problem.text);
        }
        const el = root.querySelector(`[data-problems="${group.id}"]`);
        if (el) { el.textContent = texts.join(' '); el.hidden = texts.length === 0; }
      }
      askPrices([...new Set(stocks)]);
    }, 300);
  };

  const showStatus = (text, withUndo = false) => {
    const el = root.querySelector('#larpStatus');
    if (!el) return;
    el.innerHTML = text ? `${esc(text)}${withUndo ? ' <button type="button" class="btn-text" id="larpUndo">Undo</button>' : ''}` : '';
    el.hidden = !text;
  };

  const presetOptions = () => {
    const saved = Object.keys(larp.saved?.() || {});
    return `<option value="sample">Sample</option>`
      + PRESETS.map(p => `<option value="preset:${p.id}">${esc(p.label)}</option>`).join('')
      + (saved.length ? `<optgroup label="Saved">${saved.map(n => `<option value="saved:${esc(n)}">${esc(n)}</option>`).join('')}</optgroup>` : '');
  };

  const render = () => {
    const c = config();
    root.innerHTML = `
      <section class="settings-box">
        <h3 class="settings-group">Demo mode</h3>
        <button type="button" class="settings-switch" id="larpToggle" aria-pressed="${larp.on}"><span class="settings-switch__state" aria-hidden="true"></span>Show a made-up portfolio</button>
        <div class="info">Your own data stays hidden and as it is. Use it for screenshots.${larp.on ? '' : ' Edits show when you turn it on.'}</div>
      </section>

      <section class="settings-box">
        <h3 class="settings-group">Portfolio</h3>
        <div class="settings-field">
          <label for="larpPreset">Start from</label>
          <div class="settings-inline">
            <span class="select"><select id="larpPreset" class="settings-input">${presetOptions()}</select></span>
            <button type="button" class="btn-text" id="larpLoad">Load</button>
            <button type="button" class="btn-text" id="larpForget" hidden>Delete</button>
          </div>
        </div>
        <div class="settings-field">
          <label for="larpSaveName">Save as</label>
          <div class="settings-inline">
            <input type="text" class="settings-input" id="larpSaveName" autocomplete="off" placeholder="Name">
            <button type="button" class="btn-text" id="larpSave">Save</button>
          </div>
        </div>
        <div class="info larp-status" id="larpStatus" aria-live="polite" hidden></div>
      </section>

      <section class="settings-box">
        <h3 class="settings-group">Greeting</h3>
        <label>Your name
          <input type="text" class="settings-input" id="larpName" value="${esc(c.name)}" autocomplete="off" placeholder="Not set">
        </label>
        <div class="settings-field">
          <label for="larpCity">City</label>
          <input type="text" class="settings-input" id="larpCity" value="${esc(placeText(c.place))}" autocomplete="off" placeholder="New York">
          <ul class="city-options" id="larpCityList" role="listbox" aria-label="Matching places" hidden></ul>
          <span class="info" id="larpCityHint" aria-live="polite"></span>
        </div>
      </section>

      ${GROUPS.map(group => renderGroup(group, c)).join('')}

      <section class="settings-box">
        <h3 class="settings-group">Watchlist</h3>
        <label>Symbols
          <input type="text" class="settings-input" id="larpWatchlist" value="${esc(c.watchlist)}" autocomplete="off" spellcheck="false" placeholder="TSLA, GC=F">
        </label>
      </section>`;
    const select = root.querySelector('#larpPreset');
    if (!select.querySelector(`option[value="${CSS.escape(picked)}"]`)) picked = 'sample';
    select.value = picked;
    root.querySelector('#larpForget').hidden = !picked.startsWith('saved:');
    if (undo) showStatus(undo.text, true);
    check();
  };

  // Replaces the portfolio (a preset) or the whole config (a saved one); Undo puts it back.
  const load = (value) => {
    const before = clone(config());
    let next;
    let label;
    if (value === 'sample' || value.startsWith('preset:')) {
      const preset = value === 'sample' ? { label: 'Sample', portfolio: larp.preset() } : PRESETS.find(p => `preset:${p.id}` === value);
      if (!preset) return;
      next = { ...before };
      PORTFOLIO_KEYS.forEach(k => { next[k] = clone(preset.portfolio[k] ?? (k === 'hlStaked' ? 0 : k === 'watchlist' ? '' : [])); });
      label = preset.label;
    } else {
      const name = value.slice('saved:'.length);
      const saved = larp.saved?.()[name];
      if (!saved) return;
      next = clone(saved);
      label = name;
    }
    (next.manual || []).forEach(row => { if (row.type === 'pyth' && !row.feedId) row.feedId = feedIdFor(upper(row.symbol)); });
    larp.save(next);
    undo = { config: before, text: `Loaded ${label}.` };
    render();
    touch({ keepUndo: true });
  };

  // City: suggestions as you type. Pick one, or press Enter for the first.
  let seq = 0;
  let found = [];
  const cityList = () => root.querySelector('#larpCityList');
  const cityHint = text => { const el = root.querySelector('#larpCityHint'); if (el) el.textContent = text; };
  const choose = (place) => {
    config().place = place;
    found = [];
    const input = root.querySelector('#larpCity');
    if (input) input.value = placeText(place);
    const list = cityList();
    if (list) { list.hidden = true; list.innerHTML = ''; }
    cityHint('');
    touch();
  };
  const suggest = () => {
    const input = root.querySelector('#larpCity');
    const name = input.value.trim();
    const mine = ++seq;
    if (name.length < 2) { found = []; cityList().hidden = true; return; }
    searchPlaces(name).then(places => {
      if (mine !== seq) return;
      found = places;
      const list = cityList();
      list.innerHTML = places.map((p, i) => `<li role="option" tabindex="-1" data-place="${i}">${esc(placeText(p))}</li>`).join('');
      list.hidden = places.length === 0;
      cityHint(places.length ? '' : `Cannot find "${name}". Try a larger city near it.`);
    }).catch(() => { if (mine === seq) cityHint('Cannot find the city. Check your connection.'); });
  };
  root.addEventListener('keydown', (e) => {
    if (e.target.id === 'larpSaveName' && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); root.querySelector('#larpSave')?.click(); return; }
    if (e.target.id !== 'larpCity') return;
    if (e.key === 'Enter' && found[0]) { e.preventDefault(); e.stopPropagation(); choose(found[0]); }
    else if (e.key === 'Escape' && !cityList().hidden) { e.stopPropagation(); cityList().hidden = true; }
  });
  root.addEventListener('mousedown', (e) => {
    const li = e.target.closest('[data-place]');
    if (!li) return;
    e.preventDefault();
    choose(found[Number(li.dataset.place)]);
  });
  root.addEventListener('focusout', (e) => {
    if (e.target.id !== 'larpCity') return;
    const list = cityList();
    if (list) list.hidden = true;
    // Leaving the field with no pick: show the saved city again.
    e.target.value = placeText(config().place);
  });

  // Typing in this pane must not reach the settings form's own auto-save.
  root.addEventListener('input', (e) => {
    e.stopPropagation();
    const t = e.target;
    const c = config();
    if (t.id === 'larpName') c.name = t.value;
    else if (t.id === 'larpCity') { suggest(); return; }
    else if (t.id === 'larpStaked') c.hlStaked = Number(t.value) || 0;
    else if (t.id === 'larpWatchlist') c.watchlist = t.value;
    else if (t.id === 'larpSaveName' || t.id === 'larpPreset') return;
    else if (t.dataset.venue && t.dataset.c !== 'venue') {
      const venue = VENUES[t.dataset.venue];
      const row = c[venue.list]?.[Number(t.dataset.i)];
      const set = venue.set[t.dataset.c];
      if (!row || !set) return;
      const col = GROUPS.flatMap(g => g.cols).find(cc => cc.key === t.dataset.c);
      set(row, col?.kind === 'number' ? num(t.value) : t.value);
    } else return;
    touch();
  });

  // Venue: the row moves to the other account, keeping what both have.
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'larpPreset') {
      picked = t.value;
      root.querySelector('#larpForget').hidden = !picked.startsWith('saved:');
      return;
    }
    if (t.dataset.c !== 'venue') return;
    e.stopPropagation();
    const c = config();
    const from = VENUES[t.dataset.venue];
    const to = VENUES[t.value];
    const row = c[from.list]?.[Number(t.dataset.i)];
    if (!row || !to) return;
    const next = to.blank();
    for (const key of ['symbol', 'amount', 'gain', 'lev']) {
      const value = from.get[key]?.(row);
      if (value !== null && value !== undefined && value !== '' && to.set[key]) to.set[key](next, value);
    }
    if (row.yahoo && t.value === 'manual') setManualSymbol(next, row.yahoo);
    c[from.list].splice(Number(t.dataset.i), 1);
    (c[to.list] ||= []).push(next);
    touch();
    render();
    root.querySelector(`[data-venue="${t.value}"][data-i="${c[to.list].length - 1}"][data-c="venue"]`)?.focus();
  });

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const c = config();
    if (t.dataset.add) {
      const group = GROUPS.find(g => g.id === t.dataset.add);
      const venue = VENUES[group.venues[0]];
      (c[venue.list] ||= []).push(venue.blank());
      touch();
      render();
      root.querySelector(`[data-venue="${group.venues[0]}"][data-i="${c[venue.list].length - 1}"]`)?.focus();
    } else if (t.dataset.remove) {
      c[VENUES[t.dataset.remove].list].splice(Number(t.dataset.i), 1);
      touch();
      render();
    } else if (t.id === 'larpToggle') {
      flush();
      larp.setOn(!larp.on);
      if (!larp.shared) location.reload(); // a demo link leaves for the visitor's own page
    } else if (t.id === 'larpLoad') {
      picked = root.querySelector('#larpPreset').value;
      load(picked);
    } else if (t.id === 'larpUndo' && undo) {
      larp.save(undo.config);
      undo = null;
      render();
      touch();
      root.querySelector('#larpLoad')?.focus();
    } else if (t.id === 'larpSave') {
      const input = root.querySelector('#larpSaveName');
      const name = input.value.trim();
      if (!name) { showStatus('Enter a name.'); input.focus(); return; }
      flush();
      larp.keep(name, config());
      picked = `saved:${name}`;
      render();
      showStatus(`Saved ${name}.`);
    } else if (t.id === 'larpForget') {
      const select = root.querySelector('#larpPreset');
      const name = select.value.slice('saved:'.length);
      const kept = larp.saved?.()[name];
      if (!kept) return;
      larp.forget(name);
      render();
      undo = null;
      const status = root.querySelector('#larpStatus');
      status.innerHTML = `Deleted ${esc(name)}. <button type="button" class="btn-text" id="larpRestore">Undo</button>`;
      status.hidden = false;
      status.querySelector('#larpRestore').addEventListener('click', () => {
        larp.keep(name, kept);
        picked = `saved:${name}`;
        render();
      });
    }
  });

  render();
  document.getElementById('settingsTab-larp')?.addEventListener('click', () => { if (!dirty) render(); });
}

export default { setupLarpSettings };
