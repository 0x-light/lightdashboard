// Settings window. One field list drives filling the form, saving it and applying it.
// Changes save as you go; anything that needs fresh data is refetched when the window closes.

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

  // Appearance
  { id: 'newFontSelect', key: 'font', type: 'select', fallback: 'sf' },
  { id: 'newFontSizeSelect', key: 'fontSize', type: 'number', fallback: 14 },
  { id: 'newUseColoredPnL', key: 'useColoredPnL', type: 'check', fallback: true },
  { id: 'newShowExactAmounts', key: 'showExactAmounts', type: 'check', fallback: false, data: true },
  { id: 'newShowPriceChart', key: 'showPriceChart', type: 'check', fallback: true },
  { id: 'newShowWatchlist', key: 'hideWatchlist', type: 'check', invert: true, fallback: false },
  { id: 'newShowComic', key: 'hideComic', type: 'check', invert: true, fallback: false },
  { id: 'newShowStickersBtn', key: 'hideStickersBtn', type: 'check', invert: true, fallback: true },
  { id: 'newShowSnowBtn', key: 'hideSnowBtn', type: 'check', invert: true, fallback: true },
  { id: 'newShowRainBtn', key: 'hideRainBtn', type: 'check', invert: true, fallback: true },
  { id: 'newShowDonateBtn', key: 'hideDonateBtn', type: 'check', invert: true, fallback: true }
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
  return parts.length ? parts.join(' · ') : 'EVM, Solana, Bitcoin and Zcash (t-addr) are detected automatically.';
}

async function geocodeCity(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const place = (await resp.json()).results?.[0];
  return place ? { label: place.name, lat: place.latitude, lon: place.longitude } : null;
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
  if (city) city.value = settings.weather?.label || '';
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
  dialog.querySelector('.settings-panes')?.addEventListener('change', (e) => {
    if (e.target === exportArea || e.target.id === 'newWeatherCity') return;
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
  const lookUpCity = () => {
    const name = cityInput.value.trim();
    const current = getSettings().weather || {};
    if (!name) {
      saveWeather({ label: '', lat: null, lon: null });
      setCityHint('Optional. Only used to show the weather.');
      return cityLookup;
    }
    if (name === current.label && Number.isFinite(Number(current.lat))) return cityLookup;
    setCityHint('Looking up…');
    cityLookup = geocodeCity(name)
      .then(place => {
        if (!place) {
          setCityHint(`Couldn't find "${name}". Try a nearby larger city.`);
          return;
        }
        saveWeather(place);
        cityInput.value = place.label;
        setCityHint('Optional. Only used to show the weather.');
      })
      .catch(() => setCityHint("Couldn't look up the city. Check your connection."));
    return cityLookup;
  };
  if (cityInput) {
    cityInput.addEventListener('change', lookUpCity);
    cityInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') cityInput.blur(); });
  }

  const useMyLocationBtn = document.getElementById('newUseMyLocationBtn');
  if (useMyLocationBtn) {
    const idleLabel = useMyLocationBtn.textContent;
    useMyLocationBtn.addEventListener('click', async () => {
      if (!navigator.geolocation) {
        setCityHint('Your browser does not support location.');
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
        saveWeather({ label, lat, lon });
        if (cityInput) cityInput.value = label;
        setCityHint('Optional. Only used to show the weather.');
      } catch (_) {
        setCityHint('Could not get your location. Check your browser permissions.');
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
        alert('Those settings could not be read. Check that you pasted the whole exported text.');
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
        if ('caches' in window) {
          const names = await caches.keys();
          await Promise.all(names.map(name => caches.delete(name)));
        }
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
    setCityHint('Optional. Only used to show the weather.');
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
