// Settings window. One field list drives filling the form, saving it and applying it.
// Changes save as you go; anything that needs fresh data is refetched when the window closes.
import { POSITION_COLUMNS, normalizeColumnOrder, normalizeHiddenColumns } from './positions.js';

const STORAGE_KEY = 'myDashboardSettings.v2';

// type: text | number | select | check. `invert` means the checkbox shows the opposite of the
// stored flag ("Show watchlist" is stored as hideWatchlist) so older saved settings keep working.
const FIELDS = [
  // General
  { id: 'newUserName', key: 'userName', type: 'text', fallback: '' },
  { id: 'newPortfolioBaseCurrency', key: 'portfolioBaseCurrency', type: 'select', fallback: 'USD', data: true },
  { id: 'newMinBalanceThreshold', key: 'minBalanceThreshold', type: 'number', fallback: 100, data: true },

  // API keys
  { id: 'newZerionApiKey', key: 'zerionApiKey', type: 'text', fallback: '', data: true },
  { id: 'newCieloApiKey', key: 'cieloApiKey', type: 'text', fallback: '', data: true },
  { id: 'newAlchemyApiKey', key: 'alchemyApiKey', type: 'text', fallback: '', data: true },
  { id: 'newHeliusApiKey', key: 'heliusApiKey', type: 'text', fallback: '', data: true },
  { id: 'newOpenSeaApiKey', key: 'openSeaApiKey', type: 'text', fallback: '', data: true },
  { id: 'newIbkrFlexToken', key: 'ibkrFlexToken', type: 'text', fallback: '', data: true },
  { id: 'newIbkrFlexQueryId', key: 'ibkrFlexQueryId', type: 'text', fallback: '', data: true },

  // Appearance
  { id: 'newFontSelect', key: 'font', type: 'select', fallback: 'sf' },
  { id: 'newFontSizeSelect', key: 'fontSize', type: 'number', fallback: 14 },
  { id: 'newFullWidth', key: 'fullWidth', type: 'check', fallback: false },
  { id: 'newCenterLayout', key: 'centerLayout', type: 'check', fallback: false },
  { id: 'newValueInTitle', key: 'valueInTitle', type: 'check', fallback: true },
  { id: 'newShowValueChart', key: 'showValueChart', type: 'check', fallback: true },
  { id: 'newUseColoredPnL', key: 'useColoredPnL', type: 'check', fallback: true },
  { id: 'newShowExactAmounts', key: 'showExactAmounts', type: 'check', fallback: false, data: true },
  { id: 'newShowPriceChart', key: 'showPriceChart', type: 'check', fallback: true },
  { id: 'newGroupPositions', key: 'groupPositions', type: 'check', fallback: true },
  { id: 'newCombineOptionLegs', key: 'combineOptionLegs', type: 'check', fallback: true },
  { id: 'newShowWatchlist', key: 'hideWatchlist', type: 'check', invert: true, fallback: false },
  { id: 'newShowComic', key: 'hideComic', type: 'check', invert: true, fallback: false }
];

const ADDRESS_KEYS = ['walletAddresses', 'solanaAddresses', 'bitcoinAddresses', 'zcashAddresses', 'unrecognizedAddresses'];
const ADDRESS_LABELS = {
  walletAddresses: 'EVM',
  solanaAddresses: 'Solana',
  bitcoinAddresses: 'Bitcoin',
  zcashAddresses: 'Zcash',
  unrecognizedAddresses: 'not recognized'
};

// Order matters: legacy Bitcoin and Solana addresses share the base58 alphabet, but Bitcoin's
// are 25–34 characters and Solana's 32-byte keys encode to 39–44.
const ADDRESS_PATTERNS = [
  ['walletAddresses', /^0x[0-9a-fA-F]{40}$/],
  ['bitcoinAddresses', /^(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{24,33})$/],
  ['zcashAddresses', /^t[13][1-9A-HJ-NP-Za-km-z]{33}$/],
  ['solanaAddresses', /^[1-9A-HJ-NP-Za-km-z]{39,44}$/]
];

const FONT_CLASSES = ['berkeley', 'commit', 'departure', 'sf'];

// Columns: one line per column with a show box and ↑ ↓ keys; the list's order is the
// order setting, the unticked boxes the hidden one. Asset is always on.
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function fillColumnOrder(order, hidden) {
  const list = document.getElementById('newColumnOrder');
  if (!list) return;
  const keys = normalizeColumnOrder(order);
  const off = normalizeHiddenColumns(hidden);
  list.innerHTML = keys.map((key, i) => {
    const col = POSITION_COLUMNS.find(c => c.key === key);
    const label = escapeHtml(col?.label || key);
    const move = (dir, glyph, word, disabled) =>
      `<button type="button" class="column-order__move" data-move="${dir}" aria-label="Move ${label} ${word}"${disabled ? ' disabled' : ''}>${glyph}</button>`;
    const show = `<input type="checkbox" class="column-order__show" aria-label="Show ${label}"` +
      `${off.includes(key) ? '' : ' checked'}${col?.fixed ? ' disabled' : ''}>`;
    return `<li data-key="${key}">${show}<span class="column-order__name">${label}</span>` +
      move(-1, '↑', 'up', i === 0) + move(1, '↓', 'down', i === keys.length - 1) + '</li>';
  }).join('');
}

function readColumnOrder() {
  const list = document.getElementById('newColumnOrder');
  if (!list) return null;
  return Array.from(list.querySelectorAll('li[data-key]')).map(li => li.dataset.key);
}

function readHiddenColumns() {
  const list = document.getElementById('newColumnOrder');
  if (!list) return null;
  return Array.from(list.querySelectorAll('li[data-key]'))
    .filter(li => !li.querySelector('.column-order__show')?.checked)
    .map(li => li.dataset.key);
}

function listOf(value) {
  return String(value || '').split(/[\s,]+/).map(a => a.trim()).filter(Boolean);
}

// Sorts pasted addresses (any separator, any chain) into the per-chain settings keys.
export function sortAddresses(text) {
  const sorted = Object.fromEntries(ADDRESS_KEYS.map(k => [k, []]));
  for (const address of new Set(listOf(text))) {
    const match = ADDRESS_PATTERNS.find(([, pattern]) => pattern.test(address));
    sorted[match ? match[0] : 'unrecognizedAddresses'].push(address);
  }
  return Object.fromEntries(Object.entries(sorted).map(([k, list]) => [k, list.join(', ')]));
}

function joinAddresses(settings) {
  return ADDRESS_KEYS.flatMap(k => listOf(settings[k])).join('\n');
}

function describeAddresses(text) {
  const sorted = sortAddresses(text);
  const parts = ADDRESS_KEYS
    .map(k => [k, listOf(sorted[k]).length])
    .filter(([, count]) => count > 0)
    .map(([k, count]) => `${count} ${ADDRESS_LABELS[k]}`);
  return parts.length ? parts.join(' · ') : 'EVM, Solana, Bitcoin or Zcash (t-addr).';
}

// Places matching a typed name, most relevant first. Region is "Texas, United States",
// so towns that share a name can be told apart.
async function searchCities(name, count = 6) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=${count}&language=en&format=json`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const results = (await resp.json()).results || [];
  return results.map(place => ({
    label: place.name,
    region: [place.admin1, place.country].filter((part, i, all) => part && part !== place.name && all.indexOf(part) === i).join(', '),
    lat: place.latitude,
    lon: place.longitude
  }));
}

async function geocodeCity(name) {
  return (await searchCities(name, 1))[0] || null;
}

// What the city field shows for a saved place: "Paris, Texas, United States".
function placeText(weather) {
  if (!weather?.label) return '';
  return weather.region ? `${weather.label}, ${weather.region}` : weather.label;
}

function fillForm(settings) {
  for (const field of FIELDS) {
    const el = document.getElementById(field.id);
    if (!el) continue;
    const value = settings[field.key] ?? field.fallback;
    if (field.type === 'check') {
      el.checked = field.invert ? !value : !!value;
    } else {
      el.value = value;
    }
  }
  const addresses = document.getElementById('newAddresses');
  if (addresses) addresses.value = joinAddresses(settings);
  const city = document.getElementById('newWeatherCity');
  if (city) city.value = placeText(settings.weather);
  fillColumnOrder(settings.positionColumns, settings.hiddenPositionColumns);
}

function readForm(settings) {
  const next = { ...settings };
  for (const field of FIELDS) {
    const el = document.getElementById(field.id);
    if (!el) continue;
    if (field.type === 'check') {
      next[field.key] = field.invert ? !el.checked : el.checked;
    } else if (field.type === 'number') {
      const parsed = parseFloat(el.value);
      next[field.key] = Number.isFinite(parsed) ? parsed : field.fallback;
    } else {
      next[field.key] = el.value.trim() || field.fallback;
    }
  }
  const addresses = document.getElementById('newAddresses');
  if (addresses) Object.assign(next, sortAddresses(addresses.value));
  const columns = readColumnOrder();
  if (columns) next.positionColumns = columns;
  const hidden = readHiddenColumns();
  if (hidden) next.hiddenPositionColumns = hidden;
  return next;
}

// The parts of settings whose change means positions, prices or weather must be refetched.
function dataSnapshot(settings) {
  const keys = [...FIELDS.filter(f => f.data).map(f => f.key), ...ADDRESS_KEYS];
  return JSON.stringify([keys.map(k => settings[k] ?? null), settings.weather || null]);
}

export function applyFont(font) {
  document.body.classList.remove(...FONT_CLASSES.map(f => `font-${f}`));
  if (FONT_CLASSES.includes(font)) document.body.classList.add(`font-${font}`);
  // Mirrored on <html> so the pre-paint script in index.html can pick the font before modules load.
  document.documentElement.dataset.font = font || 'system';
}

// Everything that changes without refetching: fonts, sections, optional menu buttons.
export function applyAppearance(settings) {
  const body = document.body;
  body.classList.toggle('hide-snow-btn', settings.hideSnowBtn ?? true);
  body.classList.toggle('hide-rain-btn', settings.hideRainBtn ?? true);
  body.classList.toggle('hide-donate-btn', settings.hideDonateBtn ?? true);
  body.classList.toggle('hide-stickers-btn', settings.hideStickersBtn ?? true);
  body.classList.toggle('hide-watchlist', settings.hideWatchlist ?? false);
  body.classList.toggle('hide-comic', settings.hideComic ?? false);
  body.classList.toggle('mono-pnl', !(settings.useColoredPnL ?? true));
  body.classList.toggle('no-charts', !(settings.showPriceChart ?? true));
  document.documentElement.classList.toggle('pm-full', settings.fullWidth ?? false);
  document.documentElement.classList.toggle('pm-center', settings.centerLayout ?? false);
  // The portfolio renderer writes the value into the tab title unless this says off.
  const titleValue = settings.valueInTitle ?? true;
  document.documentElement.dataset.titleValue = titleValue ? 'on' : 'off';
  document.documentElement.dataset.valueChart = (settings.showValueChart ?? true) ? 'on' : 'off';
  if (!titleValue) document.title = 'Viewport';
  // The positions table reads these at render time; give it the new values and redraw.
  const renderer = typeof window !== 'undefined' ? window._portfolioRenderer : null;
  if (renderer?.settings) {
    const view = (s) => ({
      groupPositions: s.groupPositions ?? true,
      combineOptionLegs: s.combineOptionLegs ?? true,
      positionColumns: normalizeColumnOrder(s.positionColumns),
      hiddenPositionColumns: normalizeHiddenColumns(s.hiddenPositionColumns)
    });
    const next = view(settings);
    const current = view(renderer.settings);
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      Object.assign(renderer.settings, next);
      renderer.forceRender?.();
    }
  }
  applyFont(settings.font || 'sf');
  const size = Number(settings.fontSize);
  document.documentElement.style.fontSize = `${Number.isFinite(size) && size > 0 ? size : 14}px`;
}

export function setupSettingsDialog({ getSettings, invalidateSettingsCache, onClose }) {
  const dialog = document.getElementById('newSettingsDialog');
  const backdrop = document.getElementById('newSettingsBackdrop');
  if (!dialog || !backdrop) return {};

  const save = (settings) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    invalidateSettingsCache();
  };

  // Tabs: vertical list on desktop, a scrolling row on phones
  const tabs = Array.from(dialog.querySelectorAll('.settings-tab'));
  const panes = dialog.querySelector('.settings-panes');
  const selectTab = (name) => {
    tabs.forEach(tab => {
      const selected = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    dialog.querySelectorAll('.settings-pane').forEach(pane => {
      pane.hidden = pane.dataset.pane !== name;
    });
    if (panes) panes.scrollTop = 0;
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab.dataset.tab));
    tab.addEventListener('keydown', (e) => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const next = tabs[(i + step + tabs.length) % tabs.length];
      selectTab(next.dataset.tab);
      next.focus();
    });
  });
  if (tabs.length) selectTab(tabs[0].dataset.tab);

  const addresses = document.getElementById('newAddresses');
  const addressesHint = document.getElementById('newAddressesHint');
  // "Hide below 100 USD": the unit follows the currency picked above it.
  const showCurrencyUnit = () => {
    const unit = document.getElementById('newMinBalanceUnit');
    const currency = document.getElementById('newPortfolioBaseCurrency');
    if (unit && currency) unit.textContent = currency.value;
  };
  const showAddressesHint = () => {
    if (addresses && addressesHint) addressesHint.textContent = describeAddresses(addresses.value);
  };

  // Auto-save: every edit writes settings and applies what can change without a refetch
  let snapshotAtOpen = '';
  let saveTimer = null;
  const saveForm = () => {
    clearTimeout(saveTimer);
    const next = readForm(getSettings());
    save(next);
    applyAppearance(next);
    return next;
  };
  const exportArea = document.getElementById('newSettingsExportArea');
  dialog.querySelector('.settings-panes')?.addEventListener('input', (e) => {
    if (e.target === exportArea || e.target.id === 'newWeatherCity') return;
    if (e.target === addresses) showAddressesHint();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveForm, 250);
  });
  // ↑ ↓ on the column list: move the line, keep the key under the finger, save.
  document.getElementById('newColumnOrder')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-move]');
    const li = btn?.closest('li[data-key]');
    if (!btn || !li || btn.disabled) return;
    const dir = Number(btn.dataset.move);
    const other = dir < 0 ? li.previousElementSibling : li.nextElementSibling;
    if (!other) return;
    other.insertAdjacentElement(dir < 0 ? 'beforebegin' : 'afterend', li);
    fillColumnOrder(readColumnOrder(), readHiddenColumns());
    const again = document.querySelector(`#newColumnOrder li[data-key="${li.dataset.key}"] button[data-move="${dir}"]`);
    (again && !again.disabled ? again : document.querySelector(`#newColumnOrder li[data-key="${li.dataset.key}"] button:not(:disabled)`))?.focus();
    saveForm();
  });
  dialog.querySelector('.settings-panes')?.addEventListener('change', (e) => {
    if (e.target === exportArea || e.target.id === 'newWeatherCity') return;
    if (e.target.id === 'newPortfolioBaseCurrency') showCurrencyUnit();
    saveForm();
  });

  // City: looked up when you leave the field, so typing a name is enough for weather
  const cityInput = document.getElementById('newWeatherCity');
  const cityHint = document.getElementById('newWeatherCityHint');
  const setCityHint = (text) => { if (cityHint) cityHint.textContent = text; };
  const saveWeather = (weather) => {
    const next = { ...getSettings(), weather };
    save(next);
  };
  let cityLookup = Promise.resolve();
  const defaultCityHint = '';
  const pickPlace = (place) => {
    saveWeather(place);
    cityInput.value = placeText(place);
    setCityHint(defaultCityHint);
  };
  // Leaving the field without picking a suggestion takes the best match for what was typed.
  const lookUpCity = () => {
    const name = cityInput.value.trim();
    const current = getSettings().weather || {};
    if (!name) {
      saveWeather({ label: '', region: '', lat: null, lon: null });
      setCityHint(defaultCityHint);
      return cityLookup;
    }
    if ((name === placeText(current) || name === current.label) && Number.isFinite(Number(current.lat))) return cityLookup;
    setCityHint('Looking up…');
    cityLookup = geocodeCity(name)
      .then(place => {
        if (!place) {
          setCityHint(`Cannot find "${name}". Try a larger city near it.`);
          return;
        }
        pickPlace(place);
      })
      .catch(() => setCityHint('Cannot find the city. Check your connection.'));
    return cityLookup;
  };

  // Suggestions as you type: a listbox under the field (combobox pattern). Arrow keys
  // move, Enter picks, Esc closes; clicking an option picks it without blurring first.
  const cityList = document.getElementById('newWeatherCityList');
  let cityOptions = [];
  let activeCity = -1;
  let suggestTimer = null;
  let suggestSeq = 0;

  const closeCityList = () => {
    cityOptions = [];
    activeCity = -1;
    if (cityList) {
      cityList.hidden = true;
      cityList.innerHTML = '';
    }
    cityInput?.setAttribute('aria-expanded', 'false');
    cityInput?.removeAttribute('aria-activedescendant');
  };

  const setActiveCity = (index) => {
    activeCity = index;
    Array.from(cityList.children).forEach((li, i) => li.setAttribute('aria-selected', String(i === index)));
    if (index >= 0) {
      cityInput.setAttribute('aria-activedescendant', `newWeatherCityOption${index}`);
      cityList.children[index]?.scrollIntoView({ block: 'nearest' });
    } else {
      cityInput.removeAttribute('aria-activedescendant');
    }
  };

  const showCityOptions = (places) => {
    cityOptions = places;
    if (!cityList || places.length === 0) {
      closeCityList();
      return;
    }
    cityList.innerHTML = '';
    places.forEach((place, i) => {
      const li = document.createElement('li');
      li.id = `newWeatherCityOption${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      const name = document.createElement('span');
      name.className = 'city-option__name';
      name.textContent = place.label;
      li.appendChild(name);
      if (place.region) {
        const region = document.createElement('span');
        region.className = 'city-option__region';
        region.textContent = place.region;
        li.append(' ', region);
      }
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', () => {
        pickPlace(place);
        closeCityList();
      });
      cityList.appendChild(li);
    });
    cityList.hidden = false;
    cityInput.setAttribute('aria-expanded', 'true');
    setActiveCity(-1);
  };

  const suggestCities = () => {
    clearTimeout(suggestTimer);
    const name = cityInput.value.trim();
    if (name.length < 2) {
      closeCityList();
      return;
    }
    suggestTimer = setTimeout(async () => {
      const seq = ++suggestSeq;
      try {
        const places = await searchCities(name);
        // A slower earlier search must not replace the list for what's typed now.
        if (seq === suggestSeq && cityInput.value.trim() === name) showCityOptions(places);
      } catch (_) { /* The plain lookup on leaving the field still works */ }
    }, 250);
  };

  if (cityInput) {
    cityInput.setAttribute('role', 'combobox');
    cityInput.setAttribute('aria-autocomplete', 'list');
    cityInput.setAttribute('aria-expanded', 'false');
    if (cityList) cityInput.setAttribute('aria-controls', cityList.id);
    cityInput.addEventListener('input', suggestCities);
    cityInput.addEventListener('change', () => {
      // A pick already saved and filled the field; only look up text that was typed.
      if (cityOptions.length === 0) lookUpCity();
    });
    cityInput.addEventListener('blur', () => {
      if (cityOptions.length > 0) {
        closeCityList();
        lookUpCity();
      }
    });
    cityInput.addEventListener('keydown', (e) => {
      const open = cityOptions.length > 0;
      if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActiveCity((activeCity + step + cityOptions.length) % cityOptions.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (open) {
          pickPlace(cityOptions[Math.max(0, activeCity)]);
          closeCityList();
        } else {
          cityInput.blur();
        }
      } else if (e.key === 'Escape' && open) {
        // Close the list, not the Settings window.
        e.preventDefault();
        e.stopPropagation();
        closeCityList();
      }
    });
  }

  const useMyLocationBtn = document.getElementById('newUseMyLocationBtn');
  if (useMyLocationBtn) {
    const idleLabel = useMyLocationBtn.textContent;
    useMyLocationBtn.addEventListener('click', async () => {
      if (!navigator.geolocation) {
        setCityHint('This browser cannot give your location.');
        return;
      }
      useMyLocationBtn.textContent = 'Locating…';
      useMyLocationBtn.disabled = true;
      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 10000 });
        });
        const { latitude: lat, longitude: lon } = position.coords;
        let label = '';
        try {
          const geo = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
          if (geo.ok) {
            const data = await geo.json();
            label = data.city || data.locality || data.principalSubdivision || '';
          }
        } catch (_) { /* City name is optional */ }
        saveWeather({ label, region: '', lat, lon });
        if (cityInput) cityInput.value = label;
        setCityHint(defaultCityHint);
      } catch (_) {
        setCityHint('Cannot get your location. Check the browser permissions.');
      }
      useMyLocationBtn.textContent = idleLabel;
      useMyLocationBtn.disabled = false;
    });
  }

  // Export: copies everything, including wallet entry prices kept under their own key
  const exportBtn = document.getElementById('newExportSettingsBtn');
  const importBtn = document.getElementById('newImportSettingsBtn');
  let importMode = false;
  const resetImport = () => {
    importMode = false;
    if (importBtn) importBtn.textContent = 'Import';
    if (exportArea) {
      exportArea.style.display = 'none';
      exportArea.value = '';
      exportArea.setAttribute('readonly', 'readonly');
    }
  };

  if (exportBtn && exportArea) {
    exportBtn.addEventListener('click', async () => {
      resetImport();
      const s = { ...getSettings() };
      try {
        const walletPrices = localStorage.getItem('walletAssetEntryPrices');
        if (walletPrices) s.__walletAssetEntryPrices = JSON.parse(walletPrices);
      } catch (_) { /* Skip entry prices if they don't parse */ }
      const exportData = btoa(JSON.stringify(s));
      exportArea.value = exportData;
      exportArea.style.display = 'block';
      exportArea.select();
      try {
        await navigator.clipboard.writeText(exportData);
        exportBtn.textContent = 'Copied';
        setTimeout(() => { exportBtn.textContent = 'Export'; }, 1500);
      } catch (_) { /* Clipboard blocked; the text is selected instead */ }
    });
  }

  // Import: first click opens the box, second click applies what was pasted (or cancels if empty)
  if (importBtn && exportArea) {
    importBtn.addEventListener('click', () => {
      if (!importMode) {
        importMode = true;
        importBtn.textContent = 'Apply';
        exportArea.value = '';
        exportArea.placeholder = 'Paste exported settings here, then press Apply';
        exportArea.style.display = 'block';
        exportArea.removeAttribute('readonly');
        exportArea.focus();
        return;
      }
      const pasted = exportArea.value.trim();
      if (!pasted) {
        resetImport();
        return;
      }
      try {
        const imported = JSON.parse(atob(pasted));
        const walletPrices = imported.__walletAssetEntryPrices;
        if (walletPrices && typeof walletPrices === 'object') {
          localStorage.setItem('walletAssetEntryPrices', JSON.stringify(walletPrices));
        }
        delete imported.__walletAssetEntryPrices;
        save(imported);
        location.reload();
      } catch (err) {
        exportArea.focus();
        alert('Cannot read these settings. Paste all of the exported text.');
        console.error('[Import] Failed to import settings:', err);
      }
    });
  }

  // Force update: clear caches, service workers and IndexedDB, keep settings, hard reload
  const forceUpdateBtn = document.getElementById('newForceUpdateBtn');
  if (forceUpdateBtn) {
    forceUpdateBtn.addEventListener('click', async () => {
      const idleLabel = forceUpdateBtn.textContent;
      forceUpdateBtn.textContent = 'Clearing…';
      forceUpdateBtn.disabled = true;
      try {
        const savedSettings = localStorage.getItem(STORAGE_KEY);
        const clearCaches = async () => {
          if (!('caches' in window)) return;
          const names = await caches.keys();
          await Promise.all(names.map(name => caches.delete(name)));
        };
        // Clearing the caches alone is not enough: the HTTP cache keeps app.js and the modules for
        // up to an hour, and the reload would load them from there again. Fetch each file this page
        // loaded with cache: 'reload' to replace those entries. Clear the caches first, so that the
        // service worker answers from the network and not from its own copy.
        await clearCaches();
        const assets = new Set(['/']);
        for (const entry of performance.getEntriesByType('resource')) {
          const assetUrl = new URL(entry.name);
          if (assetUrl.origin === location.origin && !assetUrl.pathname.startsWith('/api/')) {
            assets.add(assetUrl.pathname + assetUrl.search);
          }
        }
        await Promise.all([...assets].map(asset => fetch(asset, { cache: 'reload' }).catch(() => { })));
        // The service worker puts what it fetched back into its cache, so clear again.
        await clearCaches();
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const reg of registrations) {
            if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            await reg.unregister();
          }
        }
        if ('indexedDB' in window && indexedDB.databases) {
          try {
            const dbs = await indexedDB.databases();
            await Promise.all(dbs.map(db => new Promise((resolve) => {
              const req = indexedDB.deleteDatabase(db.name);
              req.onsuccess = req.onerror = req.onblocked = resolve;
            })));
          } catch (_) { /* Best effort */ }
        }
        sessionStorage.clear();
        const keep = new Set([STORAGE_KEY, 'theme', 'walletAssetEntryPrices', 'stickyStickers.v1']);
        Object.keys(localStorage).filter(key => !keep.has(key)).forEach(key => localStorage.removeItem(key));
        if (savedSettings) localStorage.setItem(STORAGE_KEY, savedSettings);
        const url = new URL(window.location.href);
        url.searchParams.set('_bust', Date.now().toString());
        window.location.replace(url.toString());
      } catch (error) {
        console.error('[Force Update] Error:', error);
        forceUpdateBtn.textContent = idleLabel;
        forceUpdateBtn.disabled = false;
      }
    });
  }

  const open = (tab) => {
    resetImport();
    const s = getSettings();
    fillForm(s);
    showAddressesHint();
    showCurrencyUnit();
    setCityHint(defaultCityHint);
    snapshotAtOpen = dataSnapshot(s);
    if (tab) selectTab(tab);
    dialog.style.display = 'block';
    backdrop.style.display = 'block';
    document.body.classList.add('modal-open');
    dialog.querySelector('.settings-tab[aria-selected="true"]')?.focus({ preventScroll: true });
  };

  const close = async () => {
    if (dialog.style.display === 'none') return;
    saveForm();
    if (cityInput && document.activeElement === cityInput) lookUpCity();
    resetImport();
    dialog.style.display = 'none';
    backdrop.style.display = 'none';
    document.body.classList.remove('modal-open');
    await cityLookup;
    const s = getSettings();
    onClose?.(s, { dataChanged: dataSnapshot(s) !== snapshotAtOpen });
  };

  document.getElementById('newSettingsBtn')?.addEventListener('click', () => open());
  document.getElementById('newCloseSettingsBtn')?.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  return { open, close };
}

export default { setupSettingsDialog, applyAppearance, applyFont, sortAddresses };
