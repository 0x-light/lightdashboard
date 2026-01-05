// UI Controls module - handles button interactions
import { closeMobileMenuWithScroll } from './mobile-menu.js';

const STORAGE_KEY = 'myDashboardSettings.v1';

export function setupRainSnowControls(Rain, getSettings) {
  const toggleRainBtn = document.getElementById('newToggleRainBtn');
  const toggleSnowBtn = document.getElementById('newToggleSnowBtn');
  const toggleRainBtnMobile = document.getElementById('newToggleRainBtnMobile');
  const toggleSnowBtnMobile = document.getElementById('newToggleSnowBtnMobile');

  const updateRainButtons = (active) => {
    const text = active ? '[RAIN OFF]' : '[RAIN ON]';
    if (toggleRainBtn) toggleRainBtn.textContent = text;
    if (toggleRainBtnMobile) toggleRainBtnMobile.textContent = text;
  };

  const updateSnowButtons = (active) => {
    const text = active ? '[SNOW OFF]' : '[SNOW ON]';
    if (toggleSnowBtn) toggleSnowBtn.textContent = text;
    if (toggleSnowBtnMobile) toggleSnowBtnMobile.textContent = text;
  };

  const saveRainSnowState = (rainEnabled, snowEnabled) => {
    const s = getSettings();
    s.rainEnabled = rainEnabled;
    s.snowEnabled = snowEnabled;
    s.rainSnowManuallySet = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  };

  const handleRainToggle = () => {
    if (!Rain) return;
    const active = Rain.toggleRain();
    updateRainButtons(active);
    if (active) updateSnowButtons(false);
    saveRainSnowState(active, false);
    return active;
  };

  const handleSnowToggle = () => {
    if (!Rain) return;
    const active = Rain.toggleSnow();
    updateSnowButtons(active);
    if (active) updateRainButtons(false);
    saveRainSnowState(false, active);
    return active;
  };

  if (toggleRainBtn) toggleRainBtn.addEventListener('click', handleRainToggle);
  if (toggleSnowBtn) toggleSnowBtn.addEventListener('click', handleSnowToggle);

  if (toggleRainBtnMobile) {
    toggleRainBtnMobile.addEventListener('click', () => {
      handleRainToggle();
      closeMobileMenuWithScroll();
    });
  }

  if (toggleSnowBtnMobile) {
    toggleSnowBtnMobile.addEventListener('click', () => {
      handleSnowToggle();
      closeMobileMenuWithScroll();
    });
  }

  return { updateRainButtons, updateSnowButtons };
}

export function setupFontSizeControls(getSettings, invalidateCache) {
  let currentFontSize = 15;

  const applyFontSize = (size) => {
    document.documentElement.style.fontSize = size + 'px';
    currentFontSize = size;
    ['newFontSizeDisplay', 'newFontSizeDisplayMobile'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = size + 'px';
    });
  };

  const saveFontSize = (size) => {
    const s = getSettings();
    s.fontSize = size;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    invalidateCache?.();
  };

  const handleDecrease = () => {
    if (currentFontSize > 10) {
      const newSize = currentFontSize - 1;
      applyFontSize(newSize);
      saveFontSize(newSize);
    }
  };

  const handleIncrease = () => {
    if (currentFontSize < 24) {
      const newSize = currentFontSize + 1;
      applyFontSize(newSize);
      saveFontSize(newSize);
    }
  };

  ['newDecreaseFontBtn', 'newDecreaseFontBtnMobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', handleDecrease);
  });

  ['newIncreaseFontBtn', 'newIncreaseFontBtnMobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', handleIncrease);
  });

  return { applyFontSize, getCurrentFontSize: () => currentFontSize };
}

export function setupAmountsToggle(onToggle) {
  let amountsVisible = true;

  const amountsBtn = document.getElementById('newToggleAmountsBtn');
  const mobileAmountsBtn = document.getElementById('newToggleAmountsBtnMobile');

  const updateButtons = () => {
    const text = amountsVisible ? '[HIDE AMOUNTS]' : '[SHOW AMOUNTS]';
    if (amountsBtn) amountsBtn.textContent = text;
    if (mobileAmountsBtn) mobileAmountsBtn.textContent = text;
  };

  const handleToggle = () => {
    amountsVisible = !amountsVisible;
    updateButtons();
    document.body.classList.toggle('amounts-hidden', !amountsVisible);
    onToggle?.(amountsVisible);
  };

  if (amountsBtn) amountsBtn.addEventListener('click', handleToggle);

  return { isVisible: () => amountsVisible };
}

export function setupHideSmallToggle(getSettings, onToggle) {
  let hideSmallPositions = true;

  const hideSmallBtn = document.getElementById('newHideSmallBtn');
  const mobileHideSmallBtn = document.getElementById('newHideSmallBtnMobile');

  const updateButtons = () => {
    const settings = getSettings();
    const threshold = settings.minBalanceThreshold || 100;
    const text = hideSmallPositions ? `[SHOW <$${threshold}]` : `[HIDE <$${threshold}]`;
    if (hideSmallBtn) hideSmallBtn.textContent = text;
    if (mobileHideSmallBtn) mobileHideSmallBtn.textContent = text;
  };

  const handleToggle = () => {
    hideSmallPositions = !hideSmallPositions;
    window.hideSmallPositions = hideSmallPositions;
    updateButtons();
    onToggle?.(hideSmallPositions);
  };

  if (hideSmallBtn) hideSmallBtn.addEventListener('click', handleToggle);

  window.hideSmallPositions = hideSmallPositions;
  return { isHiding: () => hideSmallPositions, updateButtons };
}

export function setupEditModeToggle(getSettings, onToggle, invalidateCache) {
  let editMode = false;
  let hiddenAssets = new Set();

  const editListBtn = document.getElementById('newEditListBtn');
  const positionsBody = document.getElementById('newPositionsBody');

  // Load hidden assets from settings
  const settings = getSettings();
  hiddenAssets = new Set(settings.hiddenAssets || []);
  window.hiddenAssets = hiddenAssets;

  const saveHiddenAssets = () => {
    const s = getSettings();
    s.hiddenAssets = Array.from(hiddenAssets);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    invalidateCache?.();
  };

  const handlePositionEdit = (e) => {
    if (!editMode) return;

    if (e.target.classList.contains('position-edit-btn')) {
      const assetKey = e.target.getAttribute('data-asset-key');
      if (hiddenAssets.has(assetKey)) {
        hiddenAssets.delete(assetKey);
      } else {
        hiddenAssets.add(assetKey);
      }
      window.hiddenAssets = hiddenAssets;
      saveHiddenAssets();
      onToggle?.();
    } else if (e.target.classList.contains('position-delete-btn')) {
      const asset = e.target.getAttribute('data-asset');
      const manualType = e.target.getAttribute('data-manual-type');
      if (confirm(`Delete manual position "${asset}"?`)) {
        const s = getSettings();
        if (s.cryptoPositions && Array.isArray(s.cryptoPositions)) {
          if (manualType === 'custom') {
            s.cryptoPositions = s.cryptoPositions.filter(p => !(p.type === 'custom' && p.name === asset));
          } else if (manualType === 'pyth') {
            s.cryptoPositions = s.cryptoPositions.filter(p => !(p.type === 'pyth' && p.symbol === asset));
          }
          const assetKey = `${asset}_Manual`;
          if (s.hiddenAssets) {
            s.hiddenAssets = s.hiddenAssets.filter(key => key !== assetKey);
          }
          localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
          invalidateCache?.();
          hiddenAssets.delete(assetKey);
          window.hiddenAssets = hiddenAssets;
          onToggle?.();
        }
      }
    }
  };

  const handleEditToggle = () => {
    editMode = !editMode;
    window.editMode = editMode;
    if (editListBtn) {
      editListBtn.textContent = editMode ? '[SAVE CHANGES]' : '[EDIT]';
    }
    if (editMode && positionsBody) {
      positionsBody.addEventListener('click', handlePositionEdit);
    }
    onToggle?.();
  };

  if (editListBtn) {
    editListBtn.addEventListener('click', handleEditToggle);
  }

  window.editMode = editMode;
  return { isEditing: () => editMode };
}

export function setupThemeControls(getSettings, invalidateCache) {
  const Themes = window.AppModules?.core?.themes;
  if (!Themes) return;

  const themeSelect = document.getElementById('newThemeSelect');
  const themeSelectMobile = document.getElementById('newThemeSelectMobile');
  const settings = getSettings();
  const theme = settings.theme || Themes.getPreferredTheme();

  Themes.applyTheme(theme);

  const handleThemeChange = (newTheme) => {
    Themes.applyTheme(newTheme);
    const s = getSettings();
    s.theme = newTheme;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    invalidateCache?.();
  };

  if (themeSelect) {
    themeSelect.value = theme;
    themeSelect.addEventListener('change', (e) => {
      handleThemeChange(e.target.value);
      if (themeSelectMobile) themeSelectMobile.value = e.target.value;
    });
  }

  if (themeSelectMobile) {
    themeSelectMobile.value = theme;
    themeSelectMobile.addEventListener('change', (e) => {
      handleThemeChange(e.target.value);
      if (themeSelect) themeSelect.value = e.target.value;
    });
  }
}

export default {
  setupRainSnowControls,
  setupFontSizeControls,
  setupAmountsToggle,
  setupHideSmallToggle,
  setupEditModeToggle,
  setupThemeControls
};



