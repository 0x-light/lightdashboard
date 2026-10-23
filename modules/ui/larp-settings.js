// Settings > Larp: turns larp mode on and off and edits the made-up portfolio it shows.
// The config lives in window.larp (larp-mode.js); edits save as you type and show after a reload.

const pos = row => row.type === 'pyth' || row.type === 'stock';
const fixed = row => row.type === 'custom';

// Columns of one list: how a cell reads and writes its row. `ro` makes a cell read-only for a row.
const SECTIONS = [
  {
    id: 'manual', title: 'Manual positions', list: 'manual', filter: pos,
    blank: () => ({ type: 'stock', symbol: '', name: '', amount: 1, entryPrice: null, category: 'equity', currency: 'USD', exchange: null }),
    cols: [
      { label: 'Symbol', w: 1.2, get: r => r.symbol, set: (r, v) => { r.symbol = v.toUpperCase(); r.name = r.name || r.symbol; }, ro: r => r.type === 'pyth' },
      { label: 'Amount', kind: 'number', get: r => r.amount, set: (r, v) => { r.amount = v; } },
      { label: 'Entry price', kind: 'number', get: r => r.entryPrice, set: (r, v) => { r.entryPrice = v > 0 ? v : null; } }
    ]
  },
  {
    id: 'fixed', title: 'Fixed values', list: 'manual', filter: fixed,
    blank: () => ({ type: 'custom', name: '', symbol: '', amount: 1, price: 0, value: 0, currency: 'USD' }),
    cols: [
      { label: 'Name', w: 1.6, get: r => r.name, set: (r, v) => { r.name = v; r.symbol = v; } },
      { label: 'Value', kind: 'number', get: r => r.value, set: (r, v) => { r.value = v; r.price = v; } }
    ]
  },
  {
    id: 'hlPerps', title: 'Hyperliquid perps', list: 'hlPerps',
    blank: () => ({ coin: '', size: 1, gain: 0, lev: 5, mode: 'cross' }),
    cols: [
      { label: 'Coin', w: 1.2, get: r => r.coin, set: (r, v) => { r.coin = v.toUpperCase(); } },
      { label: 'Size', kind: 'number', get: r => r.size, set: (r, v) => { r.size = v; } },
      { label: 'Gain %', kind: 'number', get: r => r.gain, set: (r, v) => { r.gain = v; } },
      { label: 'Lev', kind: 'number', get: r => r.lev, set: (r, v) => { r.lev = v; } }
    ]
  },
  {
    id: 'hlSpot', title: 'Hyperliquid spot', list: 'hlSpot',
    blank: () => ({ coin: '', amount: 1, gain: 0 }),
    cols: [
      { label: 'Coin', w: 1.2, get: r => r.coin, set: (r, v) => { r.coin = v.toUpperCase(); } },
      { label: 'Amount', kind: 'number', get: r => r.amount, set: (r, v) => { r.amount = v; } },
      { label: 'Gain %', kind: 'number', get: r => r.gain, set: (r, v) => { r.gain = v; } }
    ]
  },
  {
    id: 'lighterPerps', title: 'Lighter perps', list: 'lighterPerps',
    blank: () => ({ symbol: '', size: 1, gain: 0, lev: 5 }),
    cols: [
      { label: 'Coin', w: 1.2, get: r => r.symbol, set: (r, v) => { r.symbol = v.toUpperCase(); } },
      { label: 'Size', kind: 'number', get: r => r.size, set: (r, v) => { r.size = v; } },
      { label: 'Gain %', kind: 'number', get: r => r.gain, set: (r, v) => { r.gain = v; } },
      { label: 'Lev', kind: 'number', get: r => r.lev, set: (r, v) => { r.lev = v; } }
    ]
  },
  {
    id: 'stocks', title: 'IBKR stocks', list: 'stocks',
    blank: () => ({ symbol: '', description: '', exchange: 'NASDAQ', currency: 'USD', qty: 1, gain: 0 }),
    cols: [
      { label: 'Symbol', w: 1.2, get: r => r.symbol, set: (r, v) => { r.symbol = v.toUpperCase(); r.description = r.description || r.symbol; } },
      { label: 'Shares', kind: 'number', get: r => r.qty, set: (r, v) => { r.qty = v; } },
      { label: 'Gain %', kind: 'number', get: r => r.gain, set: (r, v) => { r.gain = v; } }
    ]
  },
  {
    id: 'options', title: 'IBKR options', list: 'options',
    blank: () => ({ underlying: '', expiry: '', strike: 0, right: 'C', qty: 1, entry: 1 }),
    cols: [
      { label: 'Stock', w: 1, get: r => r.underlying, set: (r, v) => { r.underlying = v.toUpperCase(); } },
      { label: 'Expiry', kind: 'date', w: 1.6, get: r => r.expiry, set: (r, v) => { r.expiry = v; } },
      { label: 'Strike', kind: 'number', get: r => r.strike, set: (r, v) => { r.strike = v; } },
      { label: 'Call / put', kind: 'select', opts: [['C', 'Call'], ['P', 'Put']], get: r => r.right, set: (r, v) => { r.right = v; } },
      { label: 'Contracts', kind: 'number', get: r => r.qty, set: (r, v) => { r.qty = v; } },
      { label: 'Entry', kind: 'number', get: r => r.entry, set: (r, v) => { r.entry = v; } }
    ]
  },
  {
    id: 'ibkrCash', title: 'IBKR cash', list: 'ibkrCash',
    blank: () => ({ currency: 'USD', amount: 0 }),
    cols: [
      { label: 'Currency', get: r => r.currency, set: (r, v) => { r.currency = v.toUpperCase(); } },
      { label: 'Amount', kind: 'number', get: r => r.amount, set: (r, v) => { r.amount = v; } }
    ]
  }
];

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

function cell(sec, ci, col, row, i) {
  const value = col.get(row);
  const ro = col.ro?.(row) ? ' readonly' : '';
  const id = `data-sec="${sec.id}" data-i="${i}" data-c="${ci}"`;
  const style = col.w ? ` style="flex: ${col.w} 1 0"` : '';
  if (col.kind === 'select') {
    const options = col.opts.map(([v, text]) => `<option value="${v}"${v === value ? ' selected' : ''}>${text}</option>`).join('');
    return `<span class="select larp-cell"${style}><select ${id} aria-label="${esc(col.label)}">${options}</select></span>`;
  }
  const type = col.kind === 'number' ? 'number" step="any' : col.kind === 'date' ? 'date' : 'text';
  return `<input class="larp-cell" type="${type}" ${id} value="${esc(value)}" aria-label="${esc(col.label)}" autocomplete="off" spellcheck="false"${ro}${style}>`;
}

function renderSection(sec, config) {
  const list = config[sec.list] || [];
  const rows = list.map((row, i) => ({ row, i })).filter(({ row }) => !sec.filter || sec.filter(row));
  const head = sec.cols.map(c => `<span class="larp-head-cell"${c.w ? ` style="flex: ${c.w} 1 0"` : ''}>${esc(c.label)}</span>`).join('');
  const body = rows.map(({ row, i }) => `
    <div class="larp-row">
      ${sec.cols.map((col, ci) => cell(sec, ci, col, row, i)).join('')}
      <button type="button" class="larp-remove" data-remove="${sec.id}" data-i="${i}" aria-label="Remove ${esc(sec.title)} row">×</button>
    </div>`).join('');
  return `
    <h3 class="settings-group">${esc(sec.title)}</h3>
    <div class="larp-list" data-list="${sec.id}">
      ${rows.length ? `<div class="larp-row larp-head">${head}<span class="larp-remove-gap"></span></div>` : ''}
      ${body}
    </div>
    <button type="button" class="btn-text" data-add="${sec.id}">Add</button>`;
}

export function setupLarpSettings() {
  const root = document.getElementById('larpRoot');
  const larp = window.larp;
  if (!root || !larp) return;

  let dirty = false;
  let saveTimer = null;
  const config = () => larp.config;
  const flush = () => { clearTimeout(saveTimer); larp.save(config()); };
  const touch = () => {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 200);
    const apply = root.querySelector('#larpApply');
    if (apply && larp.on) apply.hidden = false;
  };

  const render = () => {
    const c = config();
    root.innerHTML = `
      <div class="settings-row">
        <div class="settings-row-text">
          <div class="settings-row-title">Larp mode is ${larp.on ? 'on' : 'off'}</div>
          <div class="info">${larp.on
            ? 'The page shows the portfolio below. Your own data is hidden and stays as it is.'
            : 'Show a made-up portfolio. Your own data stays hidden. Use it for screenshots.'}</div>
        </div>
        <button type="button" class="btn-text" id="larpToggle">${larp.on ? 'Turn off' : 'Turn on'}</button>
      </div>
      <div class="info larp-apply" id="larpApply" hidden>You changed the portfolio. <button type="button" class="btn-text" id="larpReload">Reload</button></div>

      <label>Your name
        <input type="text" class="settings-input" id="larpName" value="${esc(c.name)}" autocomplete="off" placeholder="there">
      </label>
      <div class="settings-field">
        <label for="larpCity">City</label>
        <input type="text" class="settings-input" id="larpCity" value="${esc(placeText(c.place))}" autocomplete="off" placeholder="New York">
        <ul class="city-options" id="larpCityList" role="listbox" aria-label="Matching places" hidden></ul>
        <span class="info" id="larpCityHint" aria-live="polite"></span>
      </div>
      <div class="info">Gain is the profit in %. Enter a negative size for a short.</div>

      ${SECTIONS.map(sec => renderSection(sec, c)).join('')}

      <h3 class="settings-group">Hyperliquid staking</h3>
      <label>Staked HYPE
        <input type="number" step="any" class="settings-input settings-input-short" id="larpStaked" value="${esc(c.hlStaked)}">
      </label>

      <h3 class="settings-group">Watchlist</h3>
      <label>Symbols
        <input type="text" class="settings-input" id="larpWatchlist" value="${esc(c.watchlist)}" autocomplete="off" spellcheck="false" placeholder="TSLA, GC=F">
      </label>

      <h3 class="settings-group">Sample portfolio</h3>
      <button type="button" class="btn-text" id="larpReset">Reset to the sample</button>`;
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
    else if (t.dataset.sec) {
      const sec = SECTIONS.find(s => s.id === t.dataset.sec);
      const col = sec?.cols[Number(t.dataset.c)];
      const row = c[sec.list]?.[Number(t.dataset.i)];
      if (!col || !row) return;
      const value = col.kind === 'number' ? (t.value === '' ? null : Number(t.value)) : t.value;
      col.set(row, value);
    } else return;
    touch();
  });

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const c = config();
    if (t.dataset.add) {
      const sec = SECTIONS.find(s => s.id === t.dataset.add);
      (c[sec.list] ||= []).push(sec.blank());
      touch();
      render();
      root.querySelector(`[data-list="${sec.id}"] .larp-row:last-child input`)?.focus();
    } else if (t.dataset.remove) {
      const sec = SECTIONS.find(s => s.id === t.dataset.remove);
      c[sec.list].splice(Number(t.dataset.i), 1);
      touch();
      render();
    } else if (t.id === 'larpToggle') {
      flush();
      larp.setOn(!larp.on);
      location.reload();
    } else if (t.id === 'larpReload') {
      flush();
      location.reload();
    } else if (t.id === 'larpReset') {
      larp.save(larp.preset());
      dirty = true;
      render();
      const apply = root.querySelector('#larpApply');
      if (apply && larp.on) apply.hidden = false;
    }
  });

  render();
  document.getElementById('settingsTab-larp')?.addEventListener('click', () => { if (!dirty) render(); });
}

export default { setupLarpSettings };
