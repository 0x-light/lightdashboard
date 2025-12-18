// Settings dialog module - handles settings modal UI and persistence

const STORAGE_KEY = 'myDashboardSettings.v1';
const FORCE_UPDATE_KEY = 'viewport_last_version';

let importMode = false;
let cachedSettings = null;
let settingsTimestamp = 0;
const SETTINGS_CACHE_TTL = 5000;

// Form field mappings: { elementId: settingsKey }
const FIELD_MAPPINGS = {
  // Personal
  newUserName: 'userName',
  newWeatherCity: { key: 'weather', subKey: 'label' },
  newWeatherLat: { key: 'weather', subKey: 'lat', type: 'float' },
  newWeatherLon: { key: 'weather', subKey: 'lon', type: 'float' },

  // Wallets
  newWalletAddresses: 'walletAddresses',
  newSolanaAddresses: 'solanaAddresses',
  newBitcoinAddresses: 'bitcoinAddresses',
  newZcashAddresses: 'zcashAddresses',

  // API Keys
  newZerionApiKey: 'zerionApiKey',
  newCieloApiKey: 'cieloApiKey',
  newOnchainProvider: 'onchainProvider',
  newAlchemyApiKey: 'alchemyApiKey',
  newHeliusApiKey: 'heliusApiKey',
  newOpenSeaApiKey: 'openSeaApiKey',

  // Display Options (checkboxes)
  newFontSelect: 'font',
  newUseColoredPnL: { key: 'useColoredPnL', type: 'checkbox', default: true },
  newHideWatchlist: { key: 'hideWatchlist', type: 'checkbox', default: false },
  newHideComic: { key: 'hideComic', type: 'checkbox', default: false },
  newShowExactAmounts: { key: 'showExactAmounts', type: 'checkbox', default: false },
  newShowPriceChart: { key: 'showPriceChart', type: 'checkbox', default: true },
  newLeftAligned: { key: 'leftAligned', type: 'checkbox', default: true },
  newMinBalanceThreshold: { key: 'minBalanceThreshold', type: 'float', default: 100 },

  // Menu visibility
  newHideSnowBtn: { key: 'hideSnowBtn', type: 'checkbox', default: false },
  newHideRainBtn: { key: 'hideRainBtn', type: 'checkbox', default: false },
  newHideFontSize: { key: 'hideFontSize', type: 'checkbox', default: false },
  newHideThemeBtn: { key: 'hideThemeBtn', type: 'checkbox', default: false },
  newHideAmountsBtn: { key: 'hideAmountsBtn', type: 'checkbox', default: false },
  newShowCompactBtn: { key: 'showCompactBtn', type: 'checkbox', default: true },
  newHideDonateBtn: { key: 'hideDonateBtn', type: 'checkbox', default: false }
};

export function getSettings() {
  const now = Date.now();
  if (!cachedSettings || (now - settingsTimestamp) > SETTINGS_CACHE_TTL) {
    const Settings = window.AppModules?.core?.settings;
    cachedSettings = (Settings && Settings.loadSettings && Settings.loadSettings()) || {};
    settingsTimestamp = now;
  }
  return cachedSettings;
}

export function invalidateSettingsCache() {
  cachedSettings = null;
  settingsTimestamp = 0;
}

function loadFormFromSettings(settings) {
  for (const [elementId, mapping] of Object.entries(FIELD_MAPPINGS)) {
    const el = document.getElementById(elementId);
    if (!el) continue;

    let value;
    if (typeof mapping === 'string') {
      value = settings[mapping] || '';
    } else if (mapping.subKey) {
      value = settings[mapping.key]?.[mapping.subKey] ?? '';
    } else {
      value = settings[mapping.key] ?? mapping.default;
    }

    if (mapping.type === 'checkbox') {
      el.checked = value;
    } else {
      el.value = value;
    }
  }
}

function saveFormToSettings(settings) {
  for (const [elementId, mapping] of Object.entries(FIELD_MAPPINGS)) {
    const el = document.getElementById(elementId);
    if (!el) continue;

    let value;
    if (mapping.type === 'checkbox') {
      value = el.checked;
    } else if (mapping.type === 'float') {
      value = parseFloat(el.value) || mapping.default || 0;
    } else {
      value = el.value;
    }

    if (typeof mapping === 'string') {
      settings[mapping] = value;
    } else if (mapping.subKey) {
      if (!settings[mapping.key]) settings[mapping.key] = {};
      settings[mapping.key][mapping.subKey] = value;
    } else {
      settings[mapping.key] = value;
    }
  }

  return settings;
}

export function setupSettingsDialog({ onSave, onClose }) {
  const settingsBtn = document.getElementById('newSettingsBtn');
  const settingsDialog = document.getElementById('newSettingsDialog');
  const settingsBackdrop = document.getElementById('newSettingsBackdrop');
  const closeBtn = document.getElementById('newCloseSettingsBtn');
  const cancelBtn = document.getElementById('newCancelSettingsBtn');
  const saveBtn = document.getElementById('newSaveSettingsBtn');
  const exportBtn = document.getElementById('newExportSettingsBtn');
  const exportArea = document.getElementById('newSettingsExportArea');
  const importBtn = document.getElementById('newImportSettingsBtn');
  const forceUpdateBtn = document.getElementById('newForceUpdateBtn');
  const useMyLocationBtn = document.getElementById('newUseMyLocationBtn');

  const openSettings = () => {
    if (!settingsDialog || !settingsBackdrop) return;
    const s = getSettings();
    loadFormFromSettings(s);
    settingsDialog.style.display = 'block';
    settingsBackdrop.style.display = 'block';
    document.body.classList.add('modal-open');
  };

  const closeSettings = () => {
    if (!settingsDialog || !settingsBackdrop) return;
    if (importMode && exportArea && importBtn) {
      exportArea.style.display = 'none';
      exportArea.setAttribute('readonly', 'readonly');
      importBtn.textContent = '[IMPORT]';
      importMode = false;
    }
    settingsDialog.style.display = 'none';
    settingsBackdrop.style.display = 'none';
    document.body.classList.remove('modal-open');
    onClose?.();
  };

  if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
  if (closeBtn) closeBtn.addEventListener('click', closeSettings);
  if (cancelBtn) cancelBtn.addEventListener('click', closeSettings);
  if (settingsBackdrop) settingsBackdrop.addEventListener('click', closeSettings);

  // Export settings
  if (exportBtn && exportArea) {
    exportBtn.addEventListener('click', async () => {
      const s = getSettings();
      const exportData = btoa(JSON.stringify(s));
      exportArea.value = exportData;
      exportArea.style.display = 'block';
      exportArea.removeAttribute('readonly');
      exportArea.select();
      try {
        await navigator.clipboard.writeText(exportData);
        const originalText = exportBtn.textContent;
        exportBtn.textContent = '[COPIED!]';
        setTimeout(() => { exportBtn.textContent = originalText; }, 1500);
      } catch (err) { /* Clipboard failed but text is selected */ }
    });
  }

  // Import settings
  if (importBtn && exportArea) {
    importBtn.addEventListener('click', () => {
      if (!importMode) {
        exportArea.value = '';
        exportArea.placeholder = 'Paste exported settings here, then click [SAVE & RELOAD] at the bottom';
        exportArea.style.display = 'block';
        exportArea.removeAttribute('readonly');
        exportArea.focus();
        importBtn.textContent = '[CANCEL IMPORT]';
        importMode = true;
      } else {
        exportArea.style.display = 'none';
        exportArea.setAttribute('readonly', 'readonly');
        exportArea.value = '';
        importBtn.textContent = '[IMPORT]';
        importMode = false;
      }
    });
  }

  // Force update - aggressive cache clearing while preserving user settings
  if (forceUpdateBtn) {
    forceUpdateBtn.addEventListener('click', async () => {
      const originalText = forceUpdateBtn.textContent;
      forceUpdateBtn.textContent = '[CLEARING...]';
      forceUpdateBtn.disabled = true;
      try {
        // 1. Save user settings BEFORE clearing anything
        const savedSettings = localStorage.getItem(STORAGE_KEY);
        const savedTheme = localStorage.getItem('theme');

        // 2. Clear all caches (Service Worker cache)
        if ('caches' in window) {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map(name => caches.delete(name)));
          console.log('[Force Update] Cleared', cacheNames.length, 'caches');
        }

        // 3. Unregister ALL service workers and force them to stop
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const reg of registrations) {
            // Tell SW to skip waiting if there's an update
            if (reg.waiting) {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
            await reg.unregister();
          }
          console.log('[Force Update] Unregistered', registrations.length, 'service workers');
        }

        // 4. Clear IndexedDB databases
        if ('indexedDB' in window && indexedDB.databases) {
          try {
            const dbs = await indexedDB.databases();
            await Promise.all(dbs.map(db => {
              return new Promise((resolve) => {
                const req = indexedDB.deleteDatabase(db.name);
                req.onsuccess = resolve;
                req.onerror = resolve;
                req.onblocked = resolve;
              });
            }));
            console.log('[Force Update] Cleared', dbs.length, 'IndexedDB databases');
          } catch (e) { /* IndexedDB clearing is best-effort */ }
        }

        // 5. Clear sessionStorage completely
        sessionStorage.clear();

        // 6. Clear localStorage EXCEPT user settings
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key !== STORAGE_KEY && key !== 'theme') {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
        console.log('[Force Update] Cleared', keysToRemove.length, 'localStorage items (preserved settings)');

        // 7. Restore settings (in case they got cleared somehow)
        if (savedSettings) localStorage.setItem(STORAGE_KEY, savedSettings);
        if (savedTheme) localStorage.setItem('theme', savedTheme);

        // 8. Small delay to ensure cleanup completes
        await new Promise(resolve => setTimeout(resolve, 500));

        // 9. Force hard reload bypassing all caches
        const url = new URL(window.location.href);
        url.searchParams.set('_bust', Date.now().toString());
        // Use replace to prevent back button issues, and force reload
        window.location.replace(url.toString());
      } catch (error) {
        console.error('[Force Update] Error:', error);
        forceUpdateBtn.textContent = '[ERROR - TRY AGAIN]';
        forceUpdateBtn.disabled = false;
        setTimeout(() => { forceUpdateBtn.textContent = originalText; }, 2000);
      }
    });
  }

  // Use My Location
  if (useMyLocationBtn) {
    useMyLocationBtn.addEventListener('click', async () => {
      if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser');
        return;
      }
      useMyLocationBtn.textContent = '[GETTING LOCATION...]';
      useMyLocationBtn.disabled = true;
      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true, timeout: 10000, maximumAge: 0
          });
        });
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        const latInput = document.getElementById('newWeatherLat');
        const lonInput = document.getElementById('newWeatherLon');
        const cityInput = document.getElementById('newWeatherCity');
        if (latInput) latInput.value = lat;
        if (lonInput) lonInput.value = lon;
        try {
          const geoResp = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
          if (geoResp.ok) {
            const geoData = await geoResp.json();
            const city = geoData.city || geoData.locality || geoData.principalSubdivision || '';
            if (city && cityInput) cityInput.value = city;
          }
        } catch (err) { /* City name is optional */ }
        useMyLocationBtn.textContent = '[USE MY LOCATION]';
        useMyLocationBtn.disabled = false;
      } catch (err) {
        console.error('Location denied:', err);
        alert('Could not get your location. Please check browser permissions.');
        useMyLocationBtn.textContent = '[USE MY LOCATION]';
        useMyLocationBtn.disabled = false;
      }
    });
  }

  // Save settings
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      // Handle import mode
      if (importMode && exportArea && exportArea.value.trim()) {
        try {
          const importData = exportArea.value.trim();
          const decoded = atob(importData);
          const importedSettings = JSON.parse(decoded);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(importedSettings));
          invalidateSettingsCache();
          exportArea.style.display = 'none';
          exportArea.setAttribute('readonly', 'readonly');
          importBtn.textContent = '[IMPORT]';
          importMode = false;
          closeSettings();
          location.reload();
          return;
        } catch (err) {
          alert('Invalid settings data. Please check the pasted text and try again.');
          console.error('[Import] Failed to import settings:', err);
          return;
        }
      }

      // Normal save flow
      let settings = getSettings();
      settings = saveFormToSettings(settings);

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        invalidateSettingsCache();
        closeSettings();
        onSave?.(settings);
      } catch (e) {
        alert('Failed to save settings: ' + e.message);
      }
    });
  }

  return { openSettings, closeSettings };
}

export function applyVisibilityClasses(settings) {
  const body = document.body;
  body.classList.toggle('hide-snow-btn', settings.hideSnowBtn ?? false);
  body.classList.toggle('hide-rain-btn', settings.hideRainBtn ?? false);
  body.classList.toggle('hide-font-size', settings.hideFontSize ?? false);
  body.classList.toggle('hide-theme-btn', settings.hideThemeBtn ?? false);
  body.classList.toggle('hide-amounts-btn', settings.hideAmountsBtn ?? false);
  body.classList.toggle('hide-donate-btn', settings.hideDonateBtn ?? false);
  body.classList.toggle('hide-watchlist', settings.hideWatchlist ?? false);
  body.classList.toggle('hide-comic', settings.hideComic ?? false);
  body.classList.toggle('no-charts', !(settings.showPriceChart ?? true));
}

export function applyFont(settings) {
  const body = document.body;
  body.classList.remove('font-commit', 'font-departure');

  if (settings.font === 'commit') {
    body.classList.add('font-commit');
  } else if (settings.font === 'departure') {
    body.classList.add('font-departure');
  }
  // Default (berkeley) has no class
}

export function applyAlignment(settings) {
  const container = document.querySelector('.container');
  if (container) {
    container.style.margin = settings.leftAligned ? '0 auto' : '';
  }
}

export default { setupSettingsDialog, getSettings, invalidateSettingsCache, applyVisibilityClasses, applyAlignment, applyFont };


