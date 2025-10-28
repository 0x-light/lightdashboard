(function() {
  const storageKey = 'myDashboardSettings.v1';

  const els = {
    toggleThemeBtn: document.getElementById('toggleThemeBtn'),
    openSettingsBtn: document.getElementById('openSettingsBtn'),
    toggleAmountsBtn: document.getElementById('toggleAmountsBtn'),
    decreaseFontBtn: document.getElementById('decreaseFontBtn'),
    increaseFontBtn: document.getElementById('increaseFontBtn'),
    fontSizeDisplay: document.getElementById('fontSizeDisplay'),
    mobileMenuBtn: document.getElementById('mobileMenuBtn'),
    closeMobileMenuBtn: document.getElementById('closeMobileMenuBtn'),
    mobileMenu: document.getElementById('mobileMenu'),
    toggleSnowBtnMobile: document.getElementById('toggleSnowBtnMobile'),
    toggleRainBtnMobile: document.getElementById('toggleRainBtnMobile'),
    toggleThemeBtnMobile: document.getElementById('toggleThemeBtnMobile'),
    toggleAmountsBtnMobile: document.getElementById('toggleAmountsBtnMobile'),
    decreaseFontBtnMobile: document.getElementById('decreaseFontBtnMobile'),
    increaseFontBtnMobile: document.getElementById('increaseFontBtnMobile'),
    fontSizeDisplayMobile: document.getElementById('fontSizeDisplayMobile'),
    openSettingsBtnMobile: document.getElementById('openSettingsBtnMobile'),
    settingsDialog: document.getElementById('settingsDialog'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    walletAddresses: document.getElementById('walletAddresses'),
    openSeaApiKey: document.getElementById('openSeaApiKey'),
    userName: document.getElementById('userName'),
    positionsContainer: document.getElementById('positionsContainer'),
    addPositionBtn: document.getElementById('addPositionBtn'),
    weatherLabel: document.getElementById('weatherLabel'),
    weatherLat: document.getElementById('weatherLat'),
    weatherLon: document.getElementById('weatherLon'),
    showRainForecast: document.getElementById('showRainForecast'),
    useColoredPnL: document.getElementById('useColoredPnL'),
    centerUI: document.getElementById('centerUI'),
    enableRealTimeUpdates: document.getElementById('enableRealTimeUpdates'),
    realTimeUpdateInterval: document.getElementById('realTimeUpdateInterval'),
    getLocationBtn: document.getElementById('getLocationBtn'),
    refreshMins: document.getElementById('refreshMins'),
    greeting: document.getElementById('greeting'),
    greetingMobile: document.getElementById('greetingMobile'),
    summary: document.getElementById('summary'),
    positionsBody: document.getElementById('positionsBody'),
    mobilePositionsContainer: document.getElementById('mobilePositionsContainer'),
    calvinImage: document.getElementById('calvinImage'),
    calvinPrevBtn: document.getElementById('calvinPrevBtn'),
    calvinNextBtn: document.getElementById('calvinNextBtn'),
    calvinRandomBtn: document.getElementById('calvinRandomBtn'),
    hideSmallBtn: document.getElementById('hideSmallBtn'),
    toggleNftsBtn: document.getElementById('toggleNftsBtn'),
    comicStrip: document.getElementById('comicStrip'),
    showComic: document.getElementById('showComic'),
    comicTitle: document.getElementById('comicTitle'),
  };
  
  let amountsVisible = true;
  let hideSmallPositions = true;
  let hideNfts = false;
  let currentFontSize = 15; // default font size in px
  let currentCalvinDate = new Date(); // Track current comic date
  
  // Comic metadata
  const comicMetadata = {
    calvinandhobbes: {
      name: 'Calvin & Hobbes',
      baseUrl: 'https://www.gocomics.com/calvinandhobbes',
      startDate: new Date('1985-11-18'),
      endDate: new Date('1995-12-31'),
    },
    peanuts: {
      name: 'Peanuts',
      baseUrl: 'https://www.gocomics.com/peanuts',
      startDate: new Date('1950-10-02'),
      endDate: new Date('2000-02-13'),
    },
    farside: {
      name: 'The Far Side',
      baseUrl: 'https://www.thefarside.com',
      startDate: new Date('1980-01-01'),
      endDate: new Date('1995-01-01'),
    },
  };

  // Format numbers in a compact way
  function formatCompactNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'k';
    } else if (num >= 1) {
      return num.toFixed(2);
    } else {
      return num.toFixed(4);
    }
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(storageKey, JSON.stringify(settings));
  }

  function getDefaultSettings() {
    return {
      theme: 'light',
      refreshMinutes: 30,
      userName: '',
      cryptoPositions: [],
      weather: { label: '', lat: null, lon: null },
      walletAddresses: '',
      openSeaApiKey: '',
      fontSize: 15,
      comicStrip: 'calvinandhobbes',
      showComic: true,
      showRainForecast: true,
      useColoredPnL: true,
      centerUI: false,
      enableRealTimeUpdates: true,
      realTimeUpdateInterval: 10 // seconds
    };
  }
  
  function parseWallets(walletString) {
    if (!walletString) return [];
    return walletString
      .split(',')
      .map(w => w.trim())
      .filter(w => w.length > 0);
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    // Update button text if it exists
    if (els.toggleThemeBtn) {
      els.toggleThemeBtn.textContent = theme === 'dark' ? '[LIGHT MODE]' : '[DARK MODE]';
    }
    if (els.toggleThemeBtnMobile) {
      els.toggleThemeBtnMobile.textContent = theme === 'dark' ? '[LIGHT MODE]' : '[DARK MODE]';
    }
  }
  
  function applyCenterUI(centerUI) {
    const container = document.querySelector('.container');
    if (container) {
      if (centerUI) {
        container.style.margin = '0 auto';
      } else {
        container.style.margin = '';
      }
    }
  }

  function applyFontSize(size) {
    document.documentElement.style.fontSize = size + 'px';
    currentFontSize = size;
    if (els.fontSizeDisplay) {
      els.fontSizeDisplay.textContent = size + 'px';
    }
    if (els.fontSizeDisplayMobile) {
      els.fontSizeDisplayMobile.textContent = size + 'px';
    }
  }
  
  function openMobileMenu() {
    if (els.mobileMenu) {
      els.mobileMenu.classList.add('active');
    }
  }
  
  function closeMobileMenu() {
    if (els.mobileMenu) {
      els.mobileMenu.classList.remove('active');
    }
  }

  function initTheme(settings) {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = settings?.theme || (prefersDark ? 'dark' : 'light');
    applyTheme(theme);
    
    // Add click handler for theme toggle button
    if (els.toggleThemeBtn) {
      els.toggleThemeBtn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        applyTheme(newTheme);
        const s = loadSettings() || getDefaultSettings();
        s.theme = newTheme;
        saveSettings(s);
      });
    }
    
    // Initialize font size - convert old string values to numbers
    let fontSize = settings?.fontSize;
    if (typeof fontSize === 'string' || !fontSize) {
      fontSize = 15; // Reset to default if it's a string like "medium"
    }
    applyFontSize(fontSize);
  }

  function renderPositionRow(position, index) {
    const row = document.createElement('div');
    row.className = 'item-row item-row-wide';
    row.innerHTML = `
      <input type="text" value="${position.symbol || ''}" data-idx="${index}" data-field="symbol">
      <input type="text" value="${position.coingeckoId || ''}" data-idx="${index}" data-field="coingeckoId">
      <input type="number" step="any" value="${position.amount ?? ''}" data-idx="${index}" data-field="amount">
      <input type="number" step="any" value="${position.entryPrice ?? ''}" data-idx="${index}" data-field="entryPrice">
      <button type="button" class="remove-btn btn-text" data-idx="${index}" data-kind="position">[X]</button>
    `;
    return row;
  }

  function openSettings() {
    const settings = loadSettings() || getDefaultSettings();
    
    // Migrate old settings to new format
    if (!settings.walletAddresses && (settings.hyperliquidAddress || settings.lighterAddress)) {
      const addresses = [];
      if (settings.hyperliquidAddress) addresses.push(settings.hyperliquidAddress);
      if (settings.lighterAddress && settings.lighterAddress !== settings.hyperliquidAddress) {
        addresses.push(settings.lighterAddress);
      }
      settings.walletAddresses = addresses.join(', ');
      console.log('Migrated old wallet settings to:', settings.walletAddresses);
    }
    
    // Populate settings
    els.walletAddresses.value = settings.walletAddresses || '';
    els.openSeaApiKey.value = settings.openSeaApiKey || '';
    els.userName.value = settings.userName || '';
    els.positionsContainer.innerHTML = '';
    settings.cryptoPositions.forEach((p, i) => {
      els.positionsContainer.appendChild(renderPositionRow(p, i));
    });
    els.weatherLabel.value = settings.weather.label || '';
    els.weatherLat.value = settings.weather.lat ?? '';
    els.weatherLon.value = settings.weather.lon ?? '';
    els.showRainForecast.checked = settings.showRainForecast ?? true;
    els.useColoredPnL.checked = settings.useColoredPnL ?? true;
    els.centerUI.checked = settings.centerUI ?? false;
    els.enableRealTimeUpdates.checked = settings.enableRealTimeUpdates ?? true;
    els.realTimeUpdateInterval.value = settings.realTimeUpdateInterval ?? 10;
    els.showComic.checked = settings.showComic ?? true;
    els.refreshMins.value = settings.refreshMinutes ?? 30;
    els.comicStrip.value = settings.comicStrip || 'calvinandhobbes';

    if (typeof els.settingsDialog.showModal === 'function') {
      els.settingsDialog.showModal();
    } else {
      alert('Your browser does not support <dialog>.');
    }
  }

  function collectSettingsFromForm() {
    const current = loadSettings() || getDefaultSettings();
    const newSettings = { ...current };

    // Get wallet addresses
    newSettings.walletAddresses = els.walletAddresses.value.trim() || '';
    newSettings.openSeaApiKey = els.openSeaApiKey.value.trim() || '';

    const posInputs = els.positionsContainer.querySelectorAll('input');
    const positionsMap = new Map();
    posInputs.forEach((inp) => {
      const idx = Number(inp.dataset.idx);
      const field = inp.dataset.field;
      const prev = positionsMap.get(idx) || {};
      if (field === 'amount' || field === 'entryPrice') {
        prev[field] = Number(inp.value || 0);
      } else if (field === 'symbol') {
        prev[field] = inp.value.trim().toUpperCase();
      } else if (field === 'coingeckoId') {
        prev[field] = inp.value.trim().toLowerCase();
      }
      positionsMap.set(idx, prev);
    });
    newSettings.cryptoPositions = Array.from(positionsMap.values()).filter(p => p.symbol);

    newSettings.userName = els.userName.value.trim() || 'Tomas';
    
    newSettings.weather = {
      label: els.weatherLabel.value.trim(),
      lat: els.weatherLat.value ? Number(els.weatherLat.value) : null,
      lon: els.weatherLon.value ? Number(els.weatherLon.value) : null,
    };

    newSettings.refreshMinutes = Math.max(1, Number(els.refreshMins.value || 30));
    newSettings.comicStrip = els.comicStrip.value || 'calvinandhobbes';
    newSettings.showComic = els.showComic.checked;
    newSettings.showRainForecast = els.showRainForecast.checked;
    newSettings.useColoredPnL = els.useColoredPnL.checked;
    newSettings.centerUI = els.centerUI.checked;
    newSettings.enableRealTimeUpdates = els.enableRealTimeUpdates.checked;
    newSettings.realTimeUpdateInterval = Math.max(5, Math.min(60, Number(els.realTimeUpdateInterval.value || 10)));
    return newSettings;
  }

  function addHandlers() {
    els.openSettingsBtn.addEventListener('click', openSettings);
    
    if (els.openSettingsBtnMobile) {
      els.openSettingsBtnMobile.addEventListener('click', () => {
        closeMobileMenu();
        openSettings();
      });
    }
    
    els.saveSettingsBtn.addEventListener('click', () => {
      const s = collectSettingsFromForm();
      saveSettings(s);
      els.settingsDialog.close();
      
      // Show/hide comic section immediately
      const comicSection = document.querySelector('.data-section:has(#comicTitle)');
      if (comicSection) {
        comicSection.style.display = s.showComic ? 'block' : 'none';
      }
      
      // Apply center UI setting
      applyCenterUI(s.centerUI);
      
      // Restart real-time updates with new settings
      stopRealTimeUpdates();
      if (s.enableRealTimeUpdates) {
        setTimeout(() => startRealTimeUpdates(), 1000);
      }
      
      refreshAll();
    });

    els.addPositionBtn.addEventListener('click', () => {
      const idx = (els.positionsContainer.querySelectorAll('.item-row').length) || 0;
      els.positionsContainer.appendChild(renderPositionRow({ symbol: '', coingeckoId: '', amount: 0, entryPrice: 0 }, idx));
    });

    // Get location button
    if (els.getLocationBtn) {
      els.getLocationBtn.addEventListener('click', async () => {
        if (!navigator.geolocation) {
          alert('Geolocation is not supported by your browser');
          return;
        }

        els.getLocationBtn.textContent = '[GETTING LOCATION...]';
        els.getLocationBtn.disabled = true;

        try {
          const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 0
            });
          });

          const lat = position.coords.latitude;
          const lon = position.coords.longitude;

          els.weatherLat.value = lat;
          els.weatherLon.value = lon;

          // Try to get city name via reverse geocoding
          try {
            const geoResp = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
            if (geoResp.ok) {
              const geoData = await geoResp.json();
              const city = geoData.city || geoData.locality || geoData.principalSubdivision || '';
              if (city) {
                els.weatherLabel.value = city;
              }
            }
          } catch (err) {
            console.log('Could not fetch city name:', err);
          }

          els.getLocationBtn.textContent = '[USE MY LOCATION]';
          els.getLocationBtn.disabled = false;
        } catch (err) {
          console.error('Geolocation error:', err);
          alert('Could not get your location. Please check browser permissions.');
          els.getLocationBtn.textContent = '[USE MY LOCATION]';
          els.getLocationBtn.disabled = false;
        }
      });
    }

    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.matches('.remove-btn')) {
        const kind = target.dataset.kind;
        const idx = Number(target.dataset.idx);
        if (kind === 'position') {
          const rows = Array.from(els.positionsContainer.children);
          if (rows[idx]) rows[idx].remove();
        }
      }
    });
  }

  async function renderCalvin(date = null, shouldFade = false) {
    try {
      if (!date) date = currentCalvinDate;
      
      const settings = loadSettings() || getDefaultSettings();
      const comicStrip = settings.comicStrip || 'calvinandhobbes';
      const comic = comicMetadata[comicStrip];
      
      if (!comic) {
        throw new Error('Unknown comic strip');
      }
      
      // Update title
      if (els.comicTitle) {
        els.comicTitle.textContent = comic.name;
      }
      
      // If we should fade, add fading class and wait
      if (shouldFade) {
        const calvinContainer = document.querySelector('.calvin-container');
        if (calvinContainer) {
          calvinContainer.classList.add('fading');
          await new Promise(resolve => setTimeout(resolve, 300)); // Wait for fade
        }
      } else {
        // First load, show loading
        els.calvinImage.innerHTML = '<span class="loading-terminal">[...]</span>';
      }
      
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      
      let comicUrl, proxyUrl;
      
      // The Far Side uses a different URL structure
      if (comicStrip === 'farside') {
        comicUrl = `https://www.thefarside.com/${year}/${month}/${day}`;
        proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(comicUrl)}`;
      } else {
        // GoComics strips
        comicUrl = `${comic.baseUrl}/${year}/${month}/${day}`;
        proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(comicUrl)}`;
      }
      
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error('Failed to fetch comic');
      
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      console.log(`Fetching ${comic.name} from:`, comicUrl);
      
      let imgUrl = null;
      
      // The Far Side uses a specific class and CDN
      if (comicStrip === 'farside') {
        // Method 1: Look for images from amuniversal CDN in all attributes
        const allImages = doc.querySelectorAll('img');
        for (const img of allImages) {
          // Check all possible attributes
          const attributes = ['src', 'data-src', 'data-lazy-src', 'srcset', 'data-srcset'];
          for (const attr of attributes) {
            const value = img.getAttribute(attr);
            if (value && value.includes('featureassets.amuniversal.com')) {
              imgUrl = value.split(',')[0].split(' ')[0]; // Handle srcset format
              console.log('Far Side image found (amuniversal CDN):', imgUrl);
              break;
            }
          }
          if (imgUrl) break;
        }
        
        // Method 2: Look in the HTML source for amuniversal URLs
        if (!imgUrl) {
          const htmlText = html;
          const match = htmlText.match(/https?:\/\/featureassets\.amuniversal\.com\/[^\s"'<>]+/);
          if (match) {
            imgUrl = match[0];
            console.log('Far Side image found (HTML regex):', imgUrl);
          }
        }
      }
      
      // Method 1: Look for og:image meta tag
      if (!imgUrl) {
        const ogImage = doc.querySelector('meta[property="og:image"]');
        if (ogImage) {
          imgUrl = ogImage.getAttribute('content');
        }
      }
      
      // Method 2: Look for the main comic image (GoComics)
      if (!imgUrl) {
        const comicImg = doc.querySelector('.comic.img-fluid, picture img, .item-comic-image img');
        if (comicImg) {
          imgUrl = comicImg.getAttribute('src') || comicImg.getAttribute('data-src');
        }
      }
      
      console.log('Image URL found:', imgUrl);
      
      if (imgUrl) {
        // Ensure the URL is absolute
        if (imgUrl.startsWith('//')) {
          imgUrl = 'https:' + imgUrl;
        } else if (imgUrl.startsWith('/')) {
          if (comicStrip === 'farside') {
            imgUrl = 'https://www.thefarside.com' + imgUrl;
          } else {
            imgUrl = 'https://www.gocomics.com' + imgUrl;
          }
        }
        
        // Preload the image before showing it
        const img = new Image();
        img.src = imgUrl;
        
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          setTimeout(reject, 10000);
        });
        
        // Image is loaded, now update DOM
        els.calvinImage.innerHTML = `
          <a href="${comicUrl}" target="_blank" style="display: block;">
            <img src="${imgUrl}" alt="${comic.name} comic">
          </a>
        `;
        
        // Remove fading class to fade back in
        const calvinContainer = document.querySelector('.calvin-container');
        if (calvinContainer) {
          calvinContainer.classList.remove('fading');
        }
        
        // Handle button visibility - show prev/random, conditionally show next
        if (els.calvinPrevBtn) els.calvinPrevBtn.style.display = '';
        if (els.calvinRandomBtn) els.calvinRandomBtn.style.display = '';
        if (els.calvinNextBtn) {
          if (date >= comic.endDate) {
            els.calvinNextBtn.style.display = 'none';
          } else {
            els.calvinNextBtn.style.display = '';
          }
        }
        
        console.log(`✅ ${comic.name} comic rendered successfully`);
      } else {
        throw new Error('Could not find comic image');
      }
      
    } catch (err) {
      console.error('Comic render error:', err);
      
      const settings = loadSettings() || getDefaultSettings();
      const comicStrip = settings.comicStrip || 'calvinandhobbes';
      const comic = comicMetadata[comicStrip];
      
      // Remove fading class on error too
      const calvinContainer = document.querySelector('.calvin-container');
      if (calvinContainer) {
        calvinContainer.classList.remove('fading');
      }
      
      // Check if we're at the last comic and hide next button even on error
      const checkDate = date || currentCalvinDate;
      if (els.calvinNextBtn && comic) {
        if (checkDate >= comic.endDate) {
          els.calvinNextBtn.style.display = 'none';
        } else {
          els.calvinNextBtn.style.display = '';
        }
      }
      
      const errorUrl = comic ? comic.baseUrl : 'https://www.gocomics.com';
      els.calvinImage.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--muted);">
          <p>Unable to load comic</p>
          <p style="font-size: 13px; margin-top: 12px;">
            <a href="${errorUrl}" target="_blank" style="color: var(--accent); text-decoration: none;">View online →</a>
          </p>
        </div>
      `;
    }
  }

  async function fetchCryptoPrices() {
    const settings = loadSettings();
    if (!settings || !settings.cryptoPositions || settings.cryptoPositions.length === 0) return null;

    const ids = settings.cryptoPositions
      .filter(p => p.coingeckoId)
      .map(p => p.coingeckoId)
      .join(',');
    
    if (!ids) return null;

    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
    
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('CoinGecko failed');
      return await resp.json();
    } catch (err) {
      console.error('Crypto fetch error:', err);
      return null;
    }
  }

  function getCoinIcon(symbol) {
    return `https://assets.coingecko.com/coins/images/${symbol === 'BTC' ? '1' : symbol === 'ETH' ? '279' : '0'}/small/${symbol.toLowerCase()}.png`;
  }

  async function renderCrypto() {
    const summary = document.getElementById('cryptoSummary');
    const list = document.getElementById('cryptoList');
    const updatedAt = document.getElementById('cryptoUpdatedAt');
    
    if (!summary || !list) return;

    const settings = loadSettings();
    
    // Don't clear list or return early - let Hyperliquid data append to it
    // Check if we have manual positions
    const hasManualPositions = settings && settings.cryptoPositions && settings.cryptoPositions.length > 0;
    
    if (!hasManualPositions && (!settings || !settings.hyperliquidAddress)) {
      summary.textContent = 'Configure positions in Settings or add Hyperliquid address';
      list.innerHTML = '';
      return;
    }
    
    // Clear list only for manual positions (keep for Hyperliquid/Lighter data)
    if (hasManualPositions) {
      list.innerHTML = '';
      
      const prices = await fetchCryptoPrices();
      if (!prices) {
        summary.textContent = 'Failed to fetch prices';
        list.innerHTML = '';
        return;
      }

      let total = 0;
      let totalPnL = 0;

      for (const pos of settings.cryptoPositions) {
        if (!pos.coingeckoId) continue;
        
        const priceData = prices[pos.coingeckoId];
        if (!priceData) continue;

        const priceUsd = priceData.usd || 0;
        const valueUsd = pos.amount * priceUsd;
        total += valueUsd;

        // Calculate P&L
        let pnl = 0;
        let pnlPercent = 0;
        let pnlClass = '';
        if (pos.entryPrice && pos.entryPrice > 0) {
          pnl = valueUsd - (pos.amount * pos.entryPrice);
          pnlPercent = ((priceUsd - pos.entryPrice) / pos.entryPrice) * 100;
          pnlClass = pnl >= 0 ? 'positive' : 'negative';
        }

        const li = document.createElement('li');
        li.className = 'crypto-item';
        li.innerHTML = `
          <div class="crypto-header">
            <img src="${getCoinIcon(pos.symbol)}" alt="${pos.symbol}" class="crypto-icon" onerror="this.style.display='none'">
            <strong>${pos.symbol}</strong>
            ${priceData.usd_24h_change ? `<span class="change ${priceData.usd_24h_change >= 0 ? 'positive' : 'negative'}">${priceData.usd_24h_change.toFixed(2)}%</span>` : ''}
          </div>
          <div class="crypto-details">
            ${pos.amount.toFixed(4)} × $${priceUsd.toLocaleString()} = $${valueUsd.toLocaleString()}
            ${pnl !== 0 ? `<div class="pnl ${pnlClass}">P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toLocaleString()} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)</div>` : ''}
          </div>
        `;
        list.appendChild(li);
        totalPnL += pnl;
      }

      const totalPnLClass = totalPnL >= 0 ? 'positive' : 'negative';
      summary.innerHTML = `
        Total: $${total.toLocaleString()}
        ${totalPnL !== 0 ? `<span class="pnl-summary ${totalPnLClass}">(${totalPnL >= 0 ? '+' : ''}$${totalPnL.toLocaleString()})</span>` : ''}
      `;
    } else if (!hasManualPositions && settings && settings.hyperliquidAddress) {
      // Just show we're loading Hyperliquid data
      summary.innerHTML = '<span class="loading-terminal">[...]</span>';
    }
    
    if (updatedAt) updatedAt.textContent = new Date().toLocaleTimeString();
  }

  async function fetchWeather() {
    const settings = loadSettings();
    if (!settings || !settings.weather || !settings.weather.lat || !settings.weather.lon) return null;

    const { lat, lon } = settings.weather;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;
    
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Weather API failed');
      return await resp.json();
    } catch (err) {
      console.error('Weather fetch error:', err);
      return null;
    }
  }

  async function renderWeather() {
    const now = document.getElementById('weatherNow');
    const forecast = document.getElementById('weatherForecast');
    const updatedAt = document.getElementById('weatherUpdatedAt');
    
    if (!now || !forecast) return;

    const settings = loadSettings();
    if (!settings || !settings.weather || !settings.weather.lat || !settings.weather.lon) {
      now.textContent = 'Set lat/lon in Settings';
      forecast.innerHTML = '';
      return;
    }

    const data = await fetchWeather();
    if (!data) {
      now.textContent = 'Failed to fetch weather';
      forecast.innerHTML = '';
      return;
    }

    const current = data.current;
    const location = settings.weather.label || `${settings.weather.lat.toFixed(2)}, ${settings.weather.lon.toFixed(2)}`;
    now.textContent = `${location}: ${current.temperature_2m}°C`;

    forecast.innerHTML = '';
    if (data.daily && data.daily.time) {
      for (let i = 0; i < Math.min(5, data.daily.time.length); i++) {
        const li = document.createElement('li');
        const date = new Date(data.daily.time[i]);
        li.innerHTML = `<strong>${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</strong>: ${data.daily.temperature_2m_max[i]}° / ${data.daily.temperature_2m_min[i]}°`;
        forecast.appendChild(li);
      }
    }

    if (updatedAt) updatedAt.textContent = new Date().toLocaleTimeString();
  }

  async function fetchHyperliquidPositions(address) {
    if (!address) return null;
    
    try {
      // Fetch perpetual positions
      const perpResp = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'clearinghouseState',
          user: address
        })
      });
      
      // Fetch spot positions
      const spotResp = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'spotClearinghouseState',
          user: address
        })
      });
      
      const perpData = perpResp.ok ? await perpResp.json() : null;
      const spotData = spotResp.ok ? await spotResp.json() : null;
      
      return { perp: perpData, spot: spotData };
    } catch (err) {
      console.error('Hyperliquid fetch error:', err);
      return null;
    }
  }

  async function renderHyperliquidData() {
    const summary = document.getElementById('cryptoSummary');
    const list = document.getElementById('cryptoList');
    
    if (!summary || !list) {
      console.error('Missing summary or list elements');
      return;
    }
    
    const settings = loadSettings();
    if (!settings || !settings.hyperliquidAddress) {
      console.error('No hyperliquid address in settings');
      return;
    }
    
    console.log('Fetching Hyperliquid positions for:', settings.hyperliquidAddress);
    const data = await fetchHyperliquidPositions(settings.hyperliquidAddress);
    if (!data) {
      console.error('Failed to fetch Hyperliquid data');
      return;
    }
    
    console.log('Hyperliquid data:', data);
    
    let hyperliquidTotal = 0;
    
    // Fetch current prices for spot tokens
    let prices = null;
    if (data.spot && data.spot.balances && data.spot.balances.length > 0) {
      try {
        const pricesResp = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'allMids' })
        });
        if (pricesResp.ok) {
          prices = await pricesResp.json();
        }
      } catch (err) {
        console.error('Failed to fetch prices', err);
      }
    }
    
    // Fetch Hyperliquid market data for mark prices
    let hlMarketPrices = {};
    try {
      const marketResp = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' })
      });
      if (marketResp.ok) {
        const marketData = await marketResp.json();
        if (marketData && marketData[0] && marketData[1]) {
          for (let i = 0; i < marketData[1].length; i++) {
            const ctx = marketData[1][i];
            const assetName = marketData[0].universe[i]?.name;
            if (assetName && ctx && ctx.markPx) {
              hlMarketPrices[assetName] = parseFloat(ctx.markPx);
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch market prices', err);
    }
    
    // Render perpetual positions
    if (data.perp && data.perp.assetPositions && data.perp.assetPositions.length > 0) {
      console.log('Rendering perp positions:', data.perp.assetPositions);
      
      for (const pos of data.perp.assetPositions) {
        console.log('Perp position:', pos);
        const coin = pos.position?.coin || 'Unknown';
        const pnl = parseFloat(pos.position?.unrealizedPnl || 0);
        hyperliquidTotal += pnl;
        
        // Use Hyperliquid's mark price (most accurate), fallback to entry price
        const currentPrice = hlMarketPrices[coin] || parseFloat(pos.position?.entryPx || 0);
        
        const li = document.createElement('li');
        li.className = 'crypto-item';
        li.innerHTML = `
          <div class="crypto-header">
            <strong>${coin}</strong>
            <span class="exchange-badge">Hyperliquid</span>
          </div>
          <div class="crypto-details">
            Size: ${pos.position?.szi || 0} | Price: $${currentPrice.toLocaleString()}
            ${pos.position?.unrealizedPnl ? `<div class="pnl ${parseFloat(pos.position.unrealizedPnl) >= 0 ? 'positive' : 'negative'}">PnL: $${parseFloat(pos.position.unrealizedPnl).toFixed(2)}</div>` : ''}
          </div>
        `;
        list.appendChild(li);
      }
    }
    
    // Render spot balances (HYPE, USDC, etc)
    if (data.spot && data.spot.balances && data.spot.balances.length > 0) {
      console.log('Rendering spot balances:', data.spot.balances);
      for (const bal of data.spot.balances) {
        // bal.total is the token amount, bal.token is the LP token count
        const tokenAmount = parseFloat(bal.total || 0);
        if (tokenAmount <= 0) continue;
        
        let usdValue = tokenAmount;
        let priceInfo = '';
        
        // For USDC, the amount IS the USD value
        if (bal.coin !== 'USDC' && prices) {
          const price = prices[bal.coin];
          if (price) {
            usdValue = tokenAmount * parseFloat(price);
            priceInfo = ` × $${parseFloat(price).toLocaleString()}`;
          }
        }
        
        // Calculate P&L using entryNtl (entry value in USD)
        let pnlInfo = '';
        if (bal.entryNtl && parseFloat(bal.entryNtl) > 0) {
          const entryValue = parseFloat(bal.entryNtl);
          const pnl = usdValue - entryValue;
          const pnlPercent = ((usdValue - entryValue) / entryValue) * 100;
          const pnlClass = pnl >= 0 ? 'positive' : 'negative';
          pnlInfo = `<div class="pnl ${pnlClass}">P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)</div>`;
        }
        
        console.log(`Rendering ${bal.coin}: ${tokenAmount} = $${usdValue}`);
        hyperliquidTotal += usdValue;
        
        const li = document.createElement('li');
        li.className = 'crypto-item';
        li.innerHTML = `
          <div class="crypto-header">
            <strong>${bal.coin}</strong>
            <span class="exchange-badge">Hyperliquid</span>
          </div>
          <div class="crypto-details">
            ${tokenAmount.toLocaleString()} ${bal.coin}${priceInfo} = $${usdValue.toLocaleString()}
            ${pnlInfo}
          </div>
        `;
        list.appendChild(li);
      }
    } else {
      console.log('No spot balances to render');
    }
    
    // Update summary with Hyperliquid total
    if (hyperliquidTotal > 0) {
      summary.innerHTML = `Hyperliquid Total: $${hyperliquidTotal.toLocaleString()}`;
    }
  }

  async function fetchLighterPositions(address) {
    if (!address) return null;
    
    try {
      // Try different Lighter API endpoints from https://apidocs.lighter.xyz
      let resp;
      
      // Try mainnet endpoint with correct v1 API format
      resp = await fetch(`https://mainnet.zklighter.elliot.ai/api/v1/account?by=l1_address&value=${address}`);
      if (resp.ok) {
        const data = await resp.json();
        console.log('Lighter mainnet account data:', data);
        return data;
      }
      
      // Try testnet endpoint
      resp = await fetch(`https://testnet.zklighter.elliot.ai/api/v1/account?by=l1_address&value=${address}`);
      if (resp.ok) {
        const data = await resp.json();
        console.log('Lighter testnet account data:', data);
        return data;
      }
      
      console.log('Lighter API endpoints returned no data');
      return null;
    } catch (err) {
      console.error('Lighter fetch error:', err);
      return null;
    }
  }

  async function renderLighterData() {
    const summary = document.getElementById('cryptoSummary');
    const list = document.getElementById('cryptoList');
    
    if (!summary || !list) {
      console.error('Missing summary or list elements in renderLighterData');
      return;
    }
    
    const settings = loadSettings();
    if (!settings || !settings.lighterAddress) {
      console.log('No lighter address in settings');
      return;
    }
    
    console.log('Fetching Lighter positions for:', settings.lighterAddress);
    const data = await fetchLighterPositions(settings.lighterAddress);
    console.log('Lighter data:', data);
    
    if (!data || !data.accounts || !Array.isArray(data.accounts) || data.accounts.length === 0) {
      console.log('No Lighter positions found');
      return;
    }
    
    // Get the first account's positions
    const account = data.accounts[0];
    if (!account || !account.positions) {
      console.log('No positions in Lighter account');
      return;
    }
    
    console.log('Rendering', account.positions.length, 'Lighter positions');
    
    let lighterTotal = 0;
    
    for (const pos of account.positions) {
      if (!pos.position || parseFloat(pos.position) === 0) continue;
      
      const position = parseFloat(pos.position);
      const positionValue = parseFloat(pos.position_value || 0);
      const unrealizedPnl = parseFloat(pos.unrealized_pnl || 0);
      lighterTotal += positionValue;
      
      const sign = pos.sign === 1 ? 'Long' : 'Short';
      
      const li = document.createElement('li');
      li.className = 'crypto-item';
      li.innerHTML = `
        <div class="crypto-header">
          <strong>${pos.symbol}</strong>
          <span class="exchange-badge">Lighter</span>
          <span class="change">${sign}</span>
        </div>
        <div class="crypto-details">
          Position: ${position.toFixed(2)} @ $${parseFloat(pos.avg_entry_price || 0).toFixed(2)} = $${positionValue.toLocaleString()}
          ${unrealizedPnl !== 0 ? `<div class="pnl ${unrealizedPnl >= 0 ? 'positive' : 'negative'}">Unrealized P&L: $${unrealizedPnl.toFixed(2)}</div>` : ''}
        </div>
      `;
      list.appendChild(li);
    }
    
    // Update summary with Lighter total if no Hyperliquid total was shown
    if (lighterTotal > 0 && !summary.innerHTML.includes('Total')) {
      summary.innerHTML = `Lighter Total: $${lighterTotal.toLocaleString()}`;
    }
  }

  // Store all position data globally for hero summary
  let allPositionsData = [];
  let weatherData = null;

  async function refreshAll() {
    // Reset positions data
    allPositionsData = [];
    
    const settings = loadSettings() || getDefaultSettings();
    
    // Show/hide comic section
    const comicSection = document.querySelector('.data-section:has(#comicTitle)');
    if (comicSection) {
      comicSection.style.display = settings.showComic ? 'block' : 'none';
    }
    
    // Fetch all data
    const tasks = [
      fetchAndRenderPositions(),
      fetchAndRenderWeather(),
    ];
    
    // Only fetch comic if it's visible
    if (settings.showComic) {
      tasks.push(renderCalvin());
    }
    
    await Promise.all(tasks);
    
    // Update hero section with summary
    updateHeroSection();
  }
  
  async function fetchOpenSeaNFTs(address) {
    if (!address) return null;
    
    console.log('🎨 Fetching NFTs for address:', address);
    
    const settings = loadSettings();
    const apiKey = settings?.openSeaApiKey || '';
    
    try {
      // Try OpenSea API first if we have an API key
      if (apiKey) {
        console.log('🔑 Trying OpenSea API with API key...');
        
        // Fetch from multiple chains
        const chains = [
          'ethereum', 
          'polygon', 
          'arbitrum', 
          'optimism', 
          'base', 
          'avalanche', 
          'blast', 
          'zora', 
          'bsc',
          'hyperevm',
          'apechain',
          'berachain',
          'gunz',
          'ronin',
          'sei',
          'shape',
          'somnia',
          'soneium',
          'unichain'
        ];
        // Fetch from all chains in parallel for speed
        console.log(`🔍 Fetching NFTs from ${chains.length} chains in parallel...`);
        const chainPromises = chains.map(chain =>
          fetch(`https://api.opensea.io/api/v2/chain/${chain}/account/${address}/nfts?limit=200`, {
            headers: {
              'X-API-KEY': apiKey,
              'accept': 'application/json'
            }
          })
          .then(async (chainResp) => {
            if (chainResp.ok) {
              const chainData = await chainResp.json();
              if (chainData.nfts && chainData.nfts.length > 0) {
                console.log(`✅ Fetched ${chainData.nfts.length} NFTs from ${chain}`);
                // Tag each NFT with its chain
                chainData.nfts.forEach(nft => {
                  nft._chain = chain;
                });
                return chainData.nfts;
              }
            }
            return [];
          })
          .catch(err => {
            console.log(`⚠️ Error fetching from ${chain}:`, err.message);
            return [];
          })
        );
        
        const chainResults = await Promise.all(chainPromises);
        const allNfts = chainResults.flat();
        
        console.log(`📊 NFT Summary: ${allNfts.length} total NFTs across ${chains.length} chains`);
        
        if (allNfts.length > 0) {
          const openSeaData = { nfts: allNfts };
          console.log('✅ Total NFTs fetched across all chains:', allNfts.length);
          
          // Log NFTs by chain
          const nftsByChain = {};
          allNfts.forEach(nft => {
            const chain = nft._chain || 'unknown';
            nftsByChain[chain] = (nftsByChain[chain] || 0) + 1;
          });
          console.log('📊 NFTs by chain:', nftsByChain);
          
          const collections = {};
          const collectionSlugs = new Set();
          const nftsByCollection = {};
          
          // Log first NFT to see what data we have
          if (openSeaData.nfts.length > 0) {
            console.log('📋 Sample NFT data:', JSON.stringify(openSeaData.nfts[0], null, 2));
          }
          
          for (const nft of openSeaData.nfts) {
            const collectionSlug = nft.collection;
            // Use the chain we tagged when fetching
            let chain = nft._chain || 'ethereum';
            let contractAddr = nft.contract;
            if (nft.identifier && nft.identifier.includes(':')) {
              const parts = nft.identifier.split(':');
              if (parts.length >= 2) {
                contractAddr = parts[1]; // Second part is the contract address
              }
            }
            
            console.log(`🎨 NFT: slug=${collectionSlug}, chain=${chain}, contract=${contractAddr}`);
            
            if (collectionSlug) {
              collectionSlugs.add(collectionSlug);
              
              if (!nftsByCollection[collectionSlug]) {
                nftsByCollection[collectionSlug] = [];
              }
              nftsByCollection[collectionSlug].push(nft);
            }
            
            if (!collections[collectionSlug || contractAddr]) {
              // We'll get the proper name from the stats API later
              collections[collectionSlug || contractAddr] = {
                name: collectionSlug || contractAddr, // Temporary, will be updated from stats API
                contract: contractAddr,
                slug: collectionSlug,
                chain: chain, // Store the chain
                count: 0,
                floorPriceUsd: 0,
                floorPriceNative: 0, // Floor price in native token
                nativeToken: 'ETH', // Will be updated based on chain
                change24h: null, // null indicates no data available
                totalPaidUsd: 0, // Track what was paid for all NFTs
                nfts: []
              };
            } else {
              // Update chain if it's not ethereum (in case collection already exists)
              if (chain !== 'ethereum') {
                collections[collectionSlug || contractAddr].chain = chain;
              }
            }
            collections[collectionSlug || contractAddr].count++;
            collections[collectionSlug || contractAddr].nfts.push(nft);
          }
          
          // Map chains to their native tokens and CoinGecko IDs
          const chainTokenMap = {
            'ethereum': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'polygon': { symbol: 'MATIC', coingeckoId: 'matic-network' },
            'arbitrum': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'optimism': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'base': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'avalanche': { symbol: 'AVAX', coingeckoId: 'avalanche-2' },
            'blast': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'zora': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'bsc': { symbol: 'BNB', coingeckoId: 'binancecoin' },
            'hyperevm': { symbol: 'HYPE', coingeckoId: 'hyperliquid' },
            'apechain': { symbol: 'APE', coingeckoId: 'apecoin' },
            'berachain': { symbol: 'BERA', coingeckoId: 'berachain-bera' },
            'gunz': { symbol: 'GUNZ', coingeckoId: 'gunz' },
            'ronin': { symbol: 'RON', coingeckoId: 'ronin' },
            'sei': { symbol: 'SEI', coingeckoId: 'sei-network' },
            'shape': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'somnia': { symbol: 'STT', coingeckoId: 'somnia' },
            'soneium': { symbol: 'ETH', coingeckoId: 'ethereum' },
            'unichain': { symbol: 'ETH', coingeckoId: 'ethereum' }
          };
          
          // Fetch prices for all unique native tokens
          const uniqueCoingeckoIds = [...new Set(Object.values(chainTokenMap).map(t => t.coingeckoId))];
          const tokenPrices = {};
          
          try {
            const pricesResp = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${uniqueCoingeckoIds.join(',')}&vs_currencies=usd`);
            if (pricesResp.ok) {
              const pricesData = await pricesResp.json();
              for (const [chain, tokenInfo] of Object.entries(chainTokenMap)) {
                const price = pricesData[tokenInfo.coingeckoId]?.usd;
                if (price) {
                  tokenPrices[chain] = price;
                  console.log(`💱 ${tokenInfo.symbol} Price: $${price}`);
                }
              }
            }
          } catch (err) {
            console.log('⚠️ Error fetching token prices:', err);
          }
          
          // Update collection native tokens based on their chain
          for (const collection of Object.values(collections)) {
            const tokenInfo = chainTokenMap[collection.chain] || chainTokenMap['ethereum'];
            collection.nativeToken = tokenInfo.symbol;
            console.log(`🏷️ Collection "${collection.name}" on chain "${collection.chain}" using token ${collection.nativeToken}`);
          }
          
          // Fetch floor prices and stats using OpenSea Collection Stats API (in parallel)
          console.log('💰 Fetching floor prices and stats for', collectionSlugs.size, 'collections in parallel...');
          console.log('📋 Collection slugs:', Array.from(collectionSlugs));
          
          const statsPromises = Array.from(collectionSlugs).map(slug =>
            fetch(`https://api.opensea.io/api/v2/collections/${slug}/stats`, {
              headers: {
                'X-API-KEY': apiKey,
                'accept': 'application/json'
              }
            })
            .then(async (statsResp) => {
              if (statsResp.ok) {
                const statsData = await statsResp.json();
                
                // Get floor price and proper collection name from stats
                const floorPriceNative = statsData.total?.floor_price;
                const collectionName = statsData.name; // Use the proper display name from the API
                
                // OpenSea provides 24h change in different intervals
                let floorChange1d = null;
                if (statsData.intervals && statsData.intervals.length > 0) {
                  const interval = statsData.intervals[0];
                  if (interval && interval.floor_price_change !== undefined && interval.floor_price_change !== null) {
                    floorChange1d = parseFloat(interval.floor_price_change);
                  }
                }
                
                if (collections[slug]) {
                  const collection = collections[slug];
                  const nativeTokenPrice = tokenPrices[collection.chain] || 1;
                  
                  // Update name with proper display name from API
                  if (collectionName) {
                    collection.name = collectionName;
                  }
                  
                  if (floorPriceNative) {
                    collection.floorPriceNative = floorPriceNative;
                    collection.floorPriceUsd = floorPriceNative * nativeTokenPrice;
                    collection.change24h = floorChange1d; // Can be null if no data
                    
                    const changeStr = floorChange1d !== null ? `${floorChange1d.toFixed(2)}%` : 'N/A';
                    console.log(`✅ ${collection.name}: ${floorPriceNative} ${collection.nativeToken} ($${collection.floorPriceUsd.toFixed(2)}), 24h: ${changeStr}`);
                  }
                }
              }
              return slug;
            })
            .catch(err => {
              console.log(`⚠️ Failed to fetch stats for ${slug}:`, err.message);
              return slug;
            })
          );
          
          await Promise.all(statsPromises);
          
          // Fetch last sale price for each NFT to calculate PnL
          console.log('💸 Fetching last sale prices for NFTs...');
          for (const slug of collectionSlugs) {
            if (!nftsByCollection[slug]) continue;
            
            for (const nft of nftsByCollection[slug]) {
              try {
                // Get individual NFT data including last sale
                const nftResp = await fetch(`https://api.opensea.io/api/v2/chain/ethereum/contract/${collections[slug].contract}/nfts/${nft.identifier.split(':')[2]}`, {
                  headers: {
                    'X-API-KEY': apiKey,
                    'accept': 'application/json'
                  }
                });
                
                if (nftResp.ok) {
                  const nftData = await nftResp.json();
                  const lastSale = nftData.nft?.last_sale;
                  
                  if (lastSale) {
                    // Convert last sale to USD
                    const saleAmountEth = parseFloat(lastSale.total_price) / 1e18; // Wei to ETH
                    const saleAmountUsd = saleAmountEth * ethPrice;
                    collections[slug].totalPaidUsd += saleAmountUsd;
                    console.log(`💸 ${slug} NFT #${nft.identifier.split(':')[2]}: Last sale ${saleAmountEth.toFixed(4)} ETH ($${saleAmountUsd.toFixed(2)})`);
                  }
                }
              } catch (err) {
                console.log(`⚠️ Failed to fetch NFT data for ${nft.identifier}:`, err);
              }
            }
          }
              
          console.log('✅ Grouped NFT collections from OpenSea with prices:', Object.values(collections));
          return { collections: Object.values(collections) };
        } else {
          console.log('⚠️ No NFTs found across any chains');
        }
      } else {
        console.log('⚠️ No OpenSea API key provided, skipping OpenSea API');
      }
      
      // Fallback: Try Reservoir API (aggregates multiple marketplaces)
      console.log('🔄 Trying Reservoir API...');
      try {
        const reservoirResp = await fetch(`https://api.reservoir.tools/users/${address}/tokens/v10?limit=100`, {
          headers: {
            'accept': 'application/json'
          }
        });
        
        if (reservoirResp.ok) {
          const reservoirData = await reservoirResp.json();
          console.log('✅ Fetched NFTs from Reservoir:', reservoirData);
          
          if (reservoirData.tokens && reservoirData.tokens.length > 0) {
            const collections = {};
            const contractAddresses = new Set();
            
            for (const token of reservoirData.tokens) {
              const collectionName = token.token?.collection?.name || 'Unknown';
              const contractAddr = token.token?.contract;
              
              if (contractAddr) {
                contractAddresses.add(contractAddr);
              }
              
              if (!collections[contractAddr]) {
                collections[contractAddr] = {
                  name: collectionName,
                  contract: contractAddr,
                  count: 0,
                  floorPriceUsd: 0,
                  floorPriceNative: 0,
                  nativeToken: 'ETH',
                  change24h: 0
                };
              }
              collections[contractAddr].count += parseInt(token.ownership?.tokenCount || 1);
            }
            
            // Fetch floor prices from Reservoir collections API
            console.log('💰 Fetching floor prices from Reservoir...');
            for (const contractAddr of contractAddresses) {
              try {
                const collResp = await fetch(`https://api.reservoir.tools/collections/v7?id=${contractAddr}`);
                if (collResp.ok) {
                  const collData = await collResp.json();
                  if (collData.collections?.[0]?.floorAsk?.price?.amount?.usd) {
                    collections[contractAddr].floorPriceUsd = collData.collections[0].floorAsk.price.amount.usd;
                    console.log(`✅ ${collections[contractAddr].name}: $${collections[contractAddr].floorPriceUsd}`);
                  }
                }
              } catch (err) {
                console.log(`⚠️ Failed to fetch floor for ${contractAddr}`);
              }
            }
            
            console.log('✅ Grouped NFT collections from Reservoir with prices:', Object.values(collections));
            return { collections: Object.values(collections) };
          }
        } else {
          console.log('⚠️ Reservoir API returned', reservoirResp.status);
        }
      } catch (reservoirErr) {
        console.log('❌ Reservoir failed:', reservoirErr);
      }
      
      console.log('❌ All NFT fetching methods failed');
      return null;
    } catch (err) {
      console.error('❌ NFT fetch error:', err);
      return null;
    }
  }

  // Symbol to CoinGecko ID mapping
  const symbolToCoingeckoId = {
    'BTC': 'bitcoin',
    'ETH': 'ethereum',
    'USDC': 'usd-coin',
    'USDT': 'tether',
    'SOL': 'solana',
    'HYPE': 'hyperliquid',
    'ZEC': 'zcash',
    'MATIC': 'matic-network',
    'AVAX': 'avalanche-2',
    'ARB': 'arbitrum',
    'OP': 'optimism',
    'LINK': 'chainlink',
    'UNI': 'uniswap',
    'AAVE': 'aave',
    'CRV': 'curve-dao-token',
    'LDO': 'lido-dao',
    'MKR': 'maker',
    'SNX': 'synthetix-network-token',
    'DOGE': 'dogecoin',
    'ADA': 'cardano',
    'DOT': 'polkadot',
    'SHIB': 'shiba-inu',
    'ATOM': 'cosmos',
    'LTC': 'litecoin',
    'XRP': 'ripple',
    'TRX': 'tron',
    'FTM': 'fantom',
    'APE': 'apecoin',
    'SAND': 'the-sandbox',
    'MANA': 'decentraland',
    'GRT': 'the-graph',
    'SUSHI': 'sushi',
    'COMP': 'compound-governance-token',
    'YFI': 'yearn-finance'
  };
  
  async function fetchCoinGeckoPrices(symbols) {
    const ids = symbols
      .map(s => symbolToCoingeckoId[s.toUpperCase()])
      .filter(id => id)
      .join(',');
    
    if (!ids) return {};
    
    try {
      const resp = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
      if (resp.ok) {
        const data = await resp.json();
        const result = {};
        
        // Map back from ID to symbol with both price and change
        for (const [symbol, id] of Object.entries(symbolToCoingeckoId)) {
          if (data[id]) {
            result[symbol] = {
              price: data[id].usd || 0,
              change24h: data[id].usd_24h_change || 0
            };
          }
        }
        
        return result;
      }
    } catch (err) {
      console.error('Error fetching CoinGecko prices:', err);
    }
    return {};
  }

  async function fetchCoinGecko24hChanges(symbols) {
    const ids = symbols
      .map(s => symbolToCoingeckoId[s.toUpperCase()])
      .filter(id => id)
      .join(',');
    
    if (!ids) return {};
    
    try {
      const resp = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
      if (resp.ok) {
        const data = await resp.json();
        const changes = {};
        
        // Map back from ID to symbol
        for (const [symbol, id] of Object.entries(symbolToCoingeckoId)) {
          if (data[id] && data[id].usd_24h_change !== undefined) {
            changes[symbol] = data[id].usd_24h_change;
          }
        }
        
        return changes;
      }
    } catch (err) {
      console.error('Error fetching CoinGecko changes:', err);
    }
    return {};
  }

  async function fetchAndRenderPositions() {
    allPositionsData = [];
    
    // Fetch data for all wallets
    const settings = loadSettings() || getDefaultSettings();
    const wallets = parseWallets(settings.walletAddresses);
    
    console.log('Wallet addresses:', settings.walletAddresses);
    console.log('Parsed wallets:', wallets);
    
    if (wallets.length === 0) {
      renderPositionsTable();
      return;
    }
    
    // Fetch Hyperliquid market data for 24h changes
    let hlMarketData = {};
    try {
      const marketResp = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' })
      });
      if (marketResp.ok) {
        const data = await marketResp.json();
        if (data && data[0] && data[0].universe) {
          for (const asset of data[0].universe) {
            hlMarketData[asset.name] = {
              funding: parseFloat(asset.funding || 0),
              openInterest: parseFloat(asset.openInterest || 0),
              volume24h: parseFloat(asset.dayNtlVlm || 0)
            };
          }
        }
        // Get current prices and 24h price changes from ctx data
        if (data && data[1]) {
          for (let i = 0; i < data[1].length; i++) {
            const ctx = data[1][i];
            const assetName = data[0].universe[i]?.name;
            if (assetName && ctx) {
              const prevDayPx = parseFloat(ctx.prevDayPx || 0);
              const markPx = parseFloat(ctx.markPx || 0);
              
              // Store current mark price
              if (!hlMarketData[assetName]) {
                hlMarketData[assetName] = {};
              }
              hlMarketData[assetName].markPx = markPx;
              
              // Calculate 24h change
              if (prevDayPx > 0) {
                const change24h = ((markPx - prevDayPx) / prevDayPx) * 100;
                hlMarketData[assetName].change24h = change24h;
              }
            }
          }
        }
        
        console.log('📊 Hyperliquid market data loaded:', Object.keys(hlMarketData).length, 'assets');
      }
    } catch (err) {
      console.error('Error fetching Hyperliquid market data:', err);
    }
    
    // Fetch data for all wallets in parallel
    console.log('⚡ Fetching data for', wallets.length, 'wallets in parallel...');
    const walletDataPromises = wallets.map(async (wallet) => {
      const [hlData, lighterData, nftData] = await Promise.all([
        fetchHyperliquidPositions(wallet),
        fetchLighterPositions(wallet),
        fetchOpenSeaNFTs(wallet)
      ]);
      
      console.log(`Wallet ${wallet} - HL:${hlData ? '✓' : '✗'} Lighter:${lighterData ? '✓' : '✗'} NFTs:${nftData ? '✓' : '✗'}`);
      
      return { hlData, lighterData, nftData };
    });
    
    const allWalletData = await Promise.all(walletDataPromises);
    
    // Process all collected wallet data
    console.log('Processing', allWalletData.length, 'wallets of data');
    
    for (const { hlData, lighterData, nftData } of allWalletData) {
      // Process Hyperliquid perp positions
      if (hlData && hlData.perp && hlData.perp.assetPositions) {
        console.log('Processing Hyperliquid perp positions:', hlData.perp.assetPositions.length);
        for (const pos of hlData.perp.assetPositions) {
          const coin = pos.position?.coin || 'Unknown';
          const marketInfo = hlMarketData[coin] || {};
          const size = parseFloat(pos.position?.szi || 0);
          
          // Use Hyperliquid's markPx (most accurate real-time price from their orderbook)
          const currentPrice = marketInfo.markPx || parseFloat(pos.position?.entryPx || 0);
          const change24h = marketInfo.change24h || 0;
          
          console.log(`💹 ${coin}: markPx=$${marketInfo.markPx || 'N/A'}, using price=$${currentPrice.toFixed(2)}`);
          
          allPositionsData.push({
            asset: coin,
            exchange: 'Hyperliquid',
            positionType: 'perp',
            amount: size,
            value: Math.abs(size) * currentPrice,
            price: currentPrice,
            change24h: change24h,
            pnl: parseFloat(pos.position?.unrealizedPnl || 0),
            pnlPercent: 0
          });
        }
      }
      
      // Process Hyperliquid spot balances
      if (hlData && hlData.spot && hlData.spot.balances) {
        const pricesResp = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'allMids' })
        });
        const prices = pricesResp.ok ? await pricesResp.json() : null;
        
        for (const bal of hlData.spot.balances) {
          const tokenAmount = parseFloat(bal.total || 0);
          if (tokenAmount <= 0) continue;
          
          let usdValue = tokenAmount;
          if (bal.coin !== 'USDC' && prices && prices[bal.coin]) {
            usdValue = tokenAmount * parseFloat(prices[bal.coin]);
          }
          
          let pnl = 0;
          let pnlPercent = 0;
          if (bal.entryNtl && parseFloat(bal.entryNtl) > 0) {
            const entryValue = parseFloat(bal.entryNtl);
            pnl = usdValue - entryValue;
            pnlPercent = (pnl / entryValue) * 100;
          }
          
          const marketInfo = hlMarketData[bal.coin] || {};
          const currentPrice = bal.coin === 'USDC' ? 1 : (prices && prices[bal.coin] ? parseFloat(prices[bal.coin]) : 0);
          allPositionsData.push({
            asset: bal.coin,
            exchange: 'Hyperliquid',
            positionType: 'spot',
            amount: tokenAmount,
            value: usdValue,
            price: currentPrice,
            change24h: marketInfo.change24h || 0,
            pnl: pnl,
            pnlPercent: pnlPercent
          });
        }
      }
      
      // Process Lighter data
      if (lighterData && lighterData.accounts && lighterData.accounts[0]) {
        const account = lighterData.accounts[0];
        if (account.positions) {
          // Log first position to see available fields
          if (account.positions.length > 0) {
            console.log('📋 Sample Lighter position data:', account.positions[0]);
          }
          
          console.log(`💹 Processing ${account.positions.length} Lighter positions`);
          
          for (const pos of account.positions) {
            if (!pos.position || parseFloat(pos.position) === 0) continue;
            
            const position = parseFloat(pos.position);
            const positionValue = parseFloat(pos.position_value || 0);
            const unrealizedPnl = parseFloat(pos.unrealized_pnl || 0);
            const pnlPercent = positionValue > 0 ? (unrealizedPnl / (positionValue - unrealizedPnl)) * 100 : 0;
            
            // Lighter provides position_value which is already calculated from current market price
            // So deriving price from position_value / position is accurate
            const currentPrice = position > 0 ? positionValue / position : 0;
            console.log(`💹 Lighter ${pos.symbol}: value=$${positionValue.toFixed(2)}, position=${position}, price=$${currentPrice.toFixed(2)}, pnl=$${unrealizedPnl.toFixed(2)}`);
            
            allPositionsData.push({
              asset: pos.symbol,
              exchange: 'Lighter',
              amount: position,
              value: positionValue,
              price: currentPrice,
              change24h: 0, // Lighter API doesn't provide 24h change
              pnl: unrealizedPnl,
              pnlPercent: pnlPercent
            });
          }
        }
      }
      
      // Process OpenSea NFTs
      if (nftData && nftData.collections && nftData.collections.length > 0) {
        for (const collection of nftData.collections) {
          const totalValue = collection.count * collection.floorPriceUsd;
          
          // Calculate PnL if we have purchase data
          let pnl = 0;
          let pnlPercent = 0;
          if (collection.totalPaidUsd > 0) {
            pnl = totalValue - collection.totalPaidUsd;
            pnlPercent = (pnl / collection.totalPaidUsd) * 100;
          }
          
          allPositionsData.push({
            asset: collection.name,
            exchange: 'OpenSea',
            amount: collection.count,
            value: totalValue,
            price: collection.floorPriceUsd,
            priceInNative: collection.floorPriceNative || 0,
            nativeToken: collection.nativeToken || 'ETH',
            change24h: collection.change24h, // Keep as null if not available
            pnl: collection.totalPaidUsd > 0 ? pnl : null, // null if no purchase data
            pnlPercent: collection.totalPaidUsd > 0 ? pnlPercent : null
          });
        }
      }
    }
    
    // Fetch CoinGecko 24h changes for crypto assets only (not NFTs)
    // NFTs already have their floor price changes from OpenSea
    const cryptoAssets = [...new Set(
      allPositionsData
        .filter(pos => pos.exchange !== 'OpenSea') // Exclude NFTs
        .map(pos => pos.asset)
    )];
    
    if (cryptoAssets.length > 0) {
      const coinGeckoChanges = await fetchCoinGecko24hChanges(cryptoAssets);
      
      // Apply CoinGecko changes only to crypto positions (not OpenSea)
      for (const pos of allPositionsData) {
        if (pos.exchange !== 'OpenSea' && coinGeckoChanges[pos.asset] !== undefined) {
          pos.change24h = coinGeckoChanges[pos.asset];
        }
      }
    }
    
    console.log('Total positions collected:', allPositionsData.length);
    console.log('Positions by exchange:', 
      allPositionsData.reduce((acc, pos) => {
        acc[pos.exchange] = (acc[pos.exchange] || 0) + 1;
        return acc;
      }, {})
    );
    
    // Render positions table
    renderPositionsTable();
  }
  
  // Real-time price update functionality
  let realTimeUpdateTimer = null;
  
  async function updatePricesRealTime() {
    if (allPositionsData.length === 0) return;
    
    try {
      // Fetch latest Hyperliquid mark prices
      const marketResp = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' })
      });
      
      if (!marketResp.ok) return;
      
      const marketData = await marketResp.json();
      const latestPrices = {};
      
      if (marketData && marketData[0] && marketData[1]) {
        for (let i = 0; i < marketData[1].length; i++) {
          const ctx = marketData[1][i];
          const assetName = marketData[0].universe[i]?.name;
          if (assetName && ctx && ctx.markPx) {
            latestPrices[assetName] = {
              price: parseFloat(ctx.markPx),
              prevDayPx: parseFloat(ctx.prevDayPx || 0)
            };
          }
        }
      }
      
      // Also fetch Hyperliquid spot prices
      const spotPricesResp = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'allMids' })
      });
      
      if (spotPricesResp.ok) {
        const spotPrices = await spotPricesResp.json();
        for (const [coin, price] of Object.entries(spotPrices)) {
          if (!latestPrices[coin]) {
            latestPrices[coin] = { price: parseFloat(price), prevDayPx: 0 };
          }
        }
      }
      
      // Fetch latest Lighter positions for all wallets
      const settings = loadSettings();
      const wallets = parseWallets(settings.walletAddresses);
      const lighterUpdates = {};
      
      for (const wallet of wallets) {
        try {
          const lighterData = await fetchLighterPositions(wallet);
          if (lighterData && lighterData.accounts && lighterData.accounts[0]) {
            const account = lighterData.accounts[0];
            if (account.positions) {
              for (const pos of account.positions) {
                if (pos.position && parseFloat(pos.position) !== 0) {
                  const position = parseFloat(pos.position);
                  const positionValue = parseFloat(pos.position_value || 0);
                  const currentPrice = position > 0 ? positionValue / position : 0;
                  lighterUpdates[pos.symbol] = {
                    value: positionValue,
                    price: currentPrice,
                    pnl: parseFloat(pos.unrealized_pnl || 0)
                  };
                }
              }
            }
          }
        } catch (err) {
          console.log('Error fetching Lighter data for real-time update:', err.message);
        }
      }
      
      // Fetch CoinGecko 24h changes for all assets (fallback for non-Hyperliquid)
      const allAssets = [...new Set(allPositionsData.map(pos => pos.asset))];
      const coinGeckoChanges = await fetchCoinGecko24hChanges(allAssets);
      
      // Update positions with new prices and track which ones changed
      const updatedAssets = new Set();
      
      // Update Hyperliquid positions
      for (const pos of allPositionsData) {
        if (pos.exchange === 'Hyperliquid' && latestPrices[pos.asset]) {
          const newPrice = latestPrices[pos.asset].price;
          if (newPrice && newPrice !== pos.price) {
            pos.price = newPrice;
            pos.value = Math.abs(pos.amount) * newPrice;
            
            // Update 24h change if we have prevDayPx
            if (latestPrices[pos.asset].prevDayPx > 0) {
              const change = ((newPrice - latestPrices[pos.asset].prevDayPx) / latestPrices[pos.asset].prevDayPx) * 100;
              pos.change24h = change;
            }
            
            updatedAssets.add(pos.asset);
          }
        }
        
        // Update Lighter positions
        if (pos.exchange === 'Lighter' && lighterUpdates[pos.asset]) {
          const update = lighterUpdates[pos.asset];
          if (update.price !== pos.price || update.value !== pos.value) {
            pos.price = update.price;
            pos.value = update.value;
            pos.pnl = update.pnl;
            updatedAssets.add(pos.asset);
          }
          
          // Update 24h change from CoinGecko
          if (coinGeckoChanges[pos.asset] !== undefined && coinGeckoChanges[pos.asset] !== pos.change24h) {
            pos.change24h = coinGeckoChanges[pos.asset];
            updatedAssets.add(pos.asset);
          }
        }
        
        // Update 24h change from CoinGecko for any other exchanges
        if (pos.exchange !== 'Hyperliquid' && pos.exchange !== 'Lighter' && pos.exchange !== 'OpenSea') {
          if (coinGeckoChanges[pos.asset] !== undefined && coinGeckoChanges[pos.asset] !== pos.change24h) {
            pos.change24h = coinGeckoChanges[pos.asset];
            updatedAssets.add(pos.asset);
          }
        }
      }
      
      if (updatedAssets.size > 0) {
        renderPositionsTable();
        updateHeroSection();
        
        // Add flash animation to updated cells
        requestAnimationFrame(() => {
          updatedAssets.forEach(asset => {
            // Flash desktop table cells (price, value, change, pnl)
            const rows = els.positionsBody?.querySelectorAll('tr');
            if (rows) {
              rows.forEach(row => {
                const assetCell = row.querySelector('.asset-cell');
                if (assetCell && assetCell.textContent.trim() === asset) {
                  // Flash the price, value, 24h change, and PnL cells
                  const cells = row.querySelectorAll('td');
                  if (cells.length >= 7) {
                    // td indices: 0=asset, 1=exchange, 2=amount, 3=price, 4=value, 5=change24h, 6=pnl
                    [3, 4, 5, 6].forEach(idx => {
                      const cell = cells[idx];
                      if (cell) {
                        cell.classList.add('flash-update');
                        setTimeout(() => cell.classList.remove('flash-update'), 200);
                      }
                    });
                  }
                }
              });
            }
            
            // Flash mobile card fields
            const cards = els.mobilePositionsContainer?.querySelectorAll('.mobile-position-card');
            if (cards) {
              cards.forEach(card => {
                const assetSpan = card.querySelector('.card-asset');
                if (assetSpan && assetSpan.textContent.trim() === asset) {
                  // Flash the price, value, 24h change, and PnL fields
                  const fields = card.querySelectorAll('.card-value');
                  fields.forEach(field => {
                    field.classList.add('flash-update');
                    setTimeout(() => field.classList.remove('flash-update'), 200);
                  });
                }
              });
            }
          });
        });
      }
    } catch (err) {
      console.error('Real-time update error:', err);
    }
  }
  
  function startRealTimeUpdates() {
    const settings = loadSettings();
    if (!settings || !settings.enableRealTimeUpdates) return;
    
    stopRealTimeUpdates(); // Clear any existing timer
    
    const interval = (settings.realTimeUpdateInterval || 10) * 1000;
    console.log(`⚡ Starting real-time updates every ${settings.realTimeUpdateInterval}s`);
    
    realTimeUpdateTimer = setInterval(updatePricesRealTime, interval);
  }
  
  function stopRealTimeUpdates() {
    if (realTimeUpdateTimer) {
      clearInterval(realTimeUpdateTimer);
      realTimeUpdateTimer = null;
      console.log('⏸️ Stopped real-time updates');
    }
  }
  
  function getMarketLink(asset, exchange, positionType) {
    if (exchange === 'Hyperliquid') {
      if (positionType === 'perp') {
        return `https://app.hyperliquid.xyz/trade/${asset}`;
      } else if (positionType === 'spot') {
        return `https://app.hyperliquid.xyz/spot/${asset}`;
      }
      return null;
    } else if (exchange === 'Lighter') {
      // Lighter links - format: https://app.lighter.xyz/trade/BTC-USDC
      return `https://app.lighter.xyz/trade/${asset}-USDC`;
    } else if (exchange === 'OpenSea') {
      // OpenSea collection links - format collection name to slug
      const slug = asset.toLowerCase().replace(/\s+/g, '-');
      return `https://opensea.io/collection/${slug}`;
    }
    return null;
  }

  function renderPositionsTable() {
    if (!els.positionsBody) return;
    
    if (allPositionsData.length === 0) {
      els.positionsBody.innerHTML = '<tr><td colspan="7" class="loading">No positions found</td></tr>';
      return;
    }
    
    // Filter positions based on toggles
    let filteredPositions = allPositionsData;
    
    if (hideSmallPositions) {
      filteredPositions = filteredPositions.filter(pos => pos.value >= 100);
    }
    
    if (hideNfts) {
      filteredPositions = filteredPositions.filter(pos => pos.exchange !== 'OpenSea');
    }
    
    if (filteredPositions.length === 0) {
      els.positionsBody.innerHTML = '<tr><td colspan="7" class="loading">No positions matching filter</td></tr>';
      return;
    }
    
    els.positionsBody.innerHTML = '';
    if (els.mobilePositionsContainer) {
      els.mobilePositionsContainer.innerHTML = '';
    }
    
    const settings = loadSettings() || getDefaultSettings();
    const useColoredPnL = settings.useColoredPnL ?? true;
    
    for (const pos of filteredPositions) {
      const tr = document.createElement('tr');
      const hasPnlValue = pos.pnl !== null && pos.pnl !== undefined;
      const pnlClass = useColoredPnL 
        ? (hasPnlValue && pos.pnl >= 0 ? 'positive-pnl' : hasPnlValue ? 'negative-pnl' : 'neutral-value')
        : (hasPnlValue && pos.pnl >= 0 ? 'positive-neutral' : hasPnlValue ? 'negative-neutral' : 'neutral-value');
      const pnlSign = hasPnlValue && pos.pnl >= 0 ? '+' : '';
      
      const change24h = pos.change24h;
      const hasChange24h = change24h !== null && change24h !== undefined;
      const changeClass = useColoredPnL
        ? (hasChange24h ? (change24h >= 0 ? 'positive-pnl' : 'negative-pnl') : 'neutral-value')
        : (hasChange24h ? (change24h >= 0 ? 'positive-neutral' : 'negative-neutral') : 'neutral-value');
      const changeSign = hasChange24h && change24h >= 0 ? '+' : '';
      const change24hDisplay = hasChange24h ? `${changeSign}${Math.abs(change24h).toFixed(1)}%` : '—';
      
      const marketLink = getMarketLink(pos.asset, pos.exchange, pos.positionType);
      const exchangeDisplay = marketLink 
        ? `<a href="${marketLink}" target="_blank" class="exchange-link">${pos.exchange}</a>`
        : pos.exchange;
      
      // Format amounts based on visibility toggle
      const amountDisplay = amountsVisible 
        ? (typeof pos.amount === 'number' ? formatCompactNumber(pos.amount) : pos.amount)
        : '••••';
      
      // Format price - for NFTs show in native token, for crypto show in USD
      let priceDisplay = '—';
      if (amountsVisible && pos.price) {
        if (pos.exchange === 'OpenSea' && pos.priceInNative) {
          const nativeToken = pos.nativeToken || 'ETH';
          priceDisplay = `${formatCompactNumber(pos.priceInNative)} ${nativeToken}`;
        } else {
          priceDisplay = `$${formatCompactNumber(pos.price)}`;
        }
      } else if (!amountsVisible) {
        priceDisplay = '••••';
      }
      
      const valueDisplay = amountsVisible 
        ? `$${formatCompactNumber(pos.value)}`
        : '$••••';
      
      const hasPnl = pos.pnl !== null && pos.pnl !== undefined;
      const pnlAmount = hasPnl ? Math.abs(pos.pnl) : 0;
      const pnlDisplay = amountsVisible 
        ? (hasPnl ? `${pnlSign}$${formatCompactNumber(pnlAmount)}${pos.pnlPercent !== 0 ? ` (${pnlSign}${pos.pnlPercent.toFixed(1)}%)` : ''}` : '—')
        : '••••';
      
      // Desktop table row
      tr.innerHTML = `
        <td class="asset-cell">${pos.asset}</td>
        <td class="exchange-cell">${exchangeDisplay}</td>
        <td>${amountDisplay}</td>
        <td>${priceDisplay}</td>
        <td>${valueDisplay}</td>
        <td class="${changeClass}">${change24hDisplay}</td>
        <td class="${pnlClass}">${pnlDisplay}</td>
      `;
      
      // Mobile card view
      const mobileCard = document.createElement('div');
      mobileCard.className = 'mobile-position-card';
      mobileCard.innerHTML = `
        <div class="card-header">
          <span class="card-asset">${pos.asset}</span>
          <span class="card-exchange">${exchangeDisplay}</span>
        </div>
        <div class="card-grid">
          <div class="card-field">
            <span class="card-label">AMOUNT</span>
            <span class="card-value">${amountDisplay}</span>
          </div>
          <div class="card-field">
            <span class="card-label">PRICE</span>
            <span class="card-value">${priceDisplay}</span>
          </div>
          <div class="card-field">
            <span class="card-label">VALUE</span>
            <span class="card-value">${valueDisplay}</span>
          </div>
          <div class="card-field">
            <span class="card-label">24H CHANGE</span>
            <span class="card-value ${changeClass}">${change24hDisplay}</span>
          </div>
          <div class="card-field card-field-wide">
            <span class="card-label">P&L</span>
            <span class="card-value ${pnlClass}">${pnlDisplay}</span>
          </div>
        </div>
      `;
      
      els.positionsBody.appendChild(tr);
      if (els.mobilePositionsContainer) {
        els.mobilePositionsContainer.appendChild(mobileCard);
      }
    }
  }
  
  async function fetchAndRenderWeather() {
    const settings = loadSettings() || getDefaultSettings();
    const { label, lat, lon } = settings.weather || {};
    
    if (!lat || !lon) {
      weatherData = null;
      return;
    }
    
    try {
      const resp = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`
      );
      if (resp.ok) {
        weatherData = await resp.json();
        weatherData.label = label;
        
        // Calculate moon phase (0 = new moon, 0.5 = full moon, 1 = new moon)
        const today = new Date();
        const knownNewMoon = new Date('2000-01-06'); // Known new moon date
        const daysSinceKnownNewMoon = (today - knownNewMoon) / (1000 * 60 * 60 * 24);
        const lunarCycle = 29.53058867; // Days in a lunar cycle
        const phase = (daysSinceKnownNewMoon % lunarCycle) / lunarCycle;
        weatherData.moonPhase = phase;
      }
    } catch (err) {
      console.error('Weather fetch error:', err);
      weatherData = null;
    }
  }
  
  function updateHeroSection() {
    const settings = loadSettings() || getDefaultSettings();
    const userName = settings.userName || 'there';
    
    // Get time of day
    const hour = new Date().getHours();
    let timeOfDay = 'Good morning';
    if (hour >= 12 && hour < 18) timeOfDay = 'Good afternoon';
    else if (hour >= 18) timeOfDay = 'Good evening';
    
    els.greeting.textContent = `${timeOfDay}, ${userName}.`;
    if (els.greetingMobile) {
      els.greetingMobile.textContent = `${timeOfDay}, ${userName}.`;
    }
    
    // Calculate total P&L
    const totalPnl = allPositionsData.reduce((sum, pos) => sum + pos.pnl, 0);
    const totalValue = allPositionsData.reduce((sum, pos) => sum + pos.value, 0);
    
    // Get asset highlights based on 24h change
    const highlights = [];
    const assetGroups = {};
    for (const pos of allPositionsData) {
      if (!assetGroups[pos.asset]) {
        assetGroups[pos.asset] = { 
          change24h: pos.change24h || 0, 
          value: pos.value 
        };
      } else {
        // If same asset on multiple exchanges, average the change weighted by value
        const totalValue = assetGroups[pos.asset].value + pos.value;
        assetGroups[pos.asset].change24h = 
          (assetGroups[pos.asset].change24h * assetGroups[pos.asset].value + 
           (pos.change24h || 0) * pos.value) / totalValue;
        assetGroups[pos.asset].value = totalValue;
      }
    }
    
    const sortedAssets = Object.entries(assetGroups)
      .filter(([_, data]) => Math.abs(data.change24h) > 0.5 && data.value > 100) // Filter out small changes and small positions
      .sort((a, b) => Math.abs(b[1].change24h) - Math.abs(a[1].change24h))
      .slice(0, 2);
    
    for (const [asset, data] of sortedAssets) {
      const sign = data.change24h >= 0 ? 'up' : 'down';
      highlights.push(`<strong>${asset}</strong> is ${sign} ${Math.abs(data.change24h).toFixed(1)}%`);
    }
    
    // Calculate total daily change (based on 24h change %)
    let totalDailyChange = 0;
    let totalDailyChangePercent = 0;
    
    for (const pos of allPositionsData) {
      if (pos.change24h && pos.value) {
        // Calculate the $ change based on the % change
        // If current value is V and 24h change is C%, then yesterday value was V / (1 + C/100)
        // Daily change = V - (V / (1 + C/100)) = V * C / (100 + C)
        const changeDecimal = pos.change24h / 100;
        const yesterdayValue = pos.value / (1 + changeDecimal);
        const dailyChange = pos.value - yesterdayValue;
        totalDailyChange += dailyChange;
      }
    }
    
    if (totalValue > 0) {
      totalDailyChangePercent = (totalDailyChange / (totalValue - totalDailyChange)) * 100;
    }
    
    // Build summary
    let summaryParts = [];
    
    if (totalDailyChange !== 0 && Math.abs(totalDailyChange) > 0.01) {
      const changeSign = totalDailyChange >= 0 ? 'up' : 'down';
      const amountText = amountsVisible 
        ? `$${Math.abs(totalDailyChange).toLocaleString(undefined, {maximumFractionDigits: 2})}`
        : '$••••';
      
      // Apply color based on useColoredPnL setting
      const useColoredPnL = settings.useColoredPnL ?? true;
      const colorClass = useColoredPnL 
        ? (totalDailyChange >= 0 ? 'positive-pnl' : 'negative-pnl')
        : '';
      const colorStyle = colorClass ? ` class="${colorClass}"` : '';
      
      summaryParts.push(`Your portfolio is <strong${colorStyle}>${changeSign} ${amountText} (${totalDailyChangePercent >= 0 ? '+' : ''}${totalDailyChangePercent.toFixed(2)}%)</strong>`);
    }
    
    // Weather
    if (weatherData && weatherData.current_weather) {
      const temp = Math.round(weatherData.current_weather.temperature);
      const city = weatherData.label || 'your location';
      const weatherCode = weatherData.current_weather.weather_code || 0;
      const isDay = weatherData.current_weather.is_day;
      
      // Weather icons based on WMO Weather interpretation codes
      // https://open-meteo.com/en/docs
      let weatherIcon = '';
      if (weatherCode === 0) {
        weatherIcon = isDay ? '☀︎' : '☾'; // Clear sky
      } else if (weatherCode <= 3) {
        weatherIcon = isDay ? '⛅︎' : '☁︎'; // Partly cloudy
      } else if (weatherCode <= 49) {
        weatherIcon = '☁︎'; // Cloudy/foggy
      } else if (weatherCode <= 69 || (weatherCode >= 80 && weatherCode <= 99)) {
        weatherIcon = '☂︎'; // Rain/drizzle/showers
      } else if (weatherCode <= 79) {
        weatherIcon = '❅'; // Snow
      } else {
        weatherIcon = '⛈'; // Thunderstorm
      }
      
      // Get moon phase icon (Unicode symbols)
      const moonPhase = weatherData.moonPhase || 0;
      let moonIcon = '';
      let moonName = '';
      
      if (moonPhase < 0.0625) {
        moonIcon = '○';
        moonName = 'New Moon';
      } else if (moonPhase < 0.1875) {
        moonIcon = '◑';
        moonName = 'Waxing Crescent';
      } else if (moonPhase < 0.3125) {
        moonIcon = '◐';
        moonName = 'First Quarter';
      } else if (moonPhase < 0.4375) {
        moonIcon = '◕';
        moonName = 'Waxing Gibbous';
      } else if (moonPhase < 0.5625) {
        moonIcon = '●';
        moonName = 'Full Moon';
      } else if (moonPhase < 0.6875) {
        moonIcon = '◔';
        moonName = 'Waning Gibbous';
      } else if (moonPhase < 0.8125) {
        moonIcon = '◑';
        moonName = 'Last Quarter';
      } else if (moonPhase < 0.9375) {
        moonIcon = '◐';
        moonName = 'Waning Crescent';
      } else {
        moonIcon = '○';
        moonName = 'New Moon';
      }
      
      // Only show moon during evening/night (6 PM - 6 AM)
      const currentHour = new Date().getHours();
      const showMoon = currentHour >= 18 || currentHour < 6;
      const moonText = showMoon ? ` with a ${moonIcon} ${moonName.toLowerCase()} moon` : '';
      
      if (settings.showRainForecast) {
        const precipitation = weatherData.daily?.precipitation_sum?.[0] || 0;
        if (precipitation > 0) {
          summaryParts.push(`It's ${temp}°C ${weatherIcon} in <strong>${city}</strong> with rain forecasted${moonText}`);
        } else {
          summaryParts.push(`It's ${temp}°C ${weatherIcon} in <strong>${city}</strong>${moonText}`);
        }
      } else {
        summaryParts.push(`It's ${temp}°C ${weatherIcon} in <strong>${city}</strong>${moonText}`);
      }
    }
    
    if (summaryParts.length === 0) {
      summaryParts.push('<span class="loading-terminal">[...]</span>');
    }
    
    els.summary.innerHTML = summaryParts.join('. ') + '.';
  }
  
  function init() {
    const settings = loadSettings() || getDefaultSettings();
    if (!loadSettings()) saveSettings(settings);
    initTheme(settings);
    applyCenterUI(settings.centerUI ?? false);
    addHandlers();
    refreshAll();
    
    // Start real-time updates after initial load
    setTimeout(() => {
      startRealTimeUpdates();
    }, 2000); // Start after 2s to let initial load complete

    // Add toggle handler for hide small positions
    if (els.hideSmallBtn) {
      els.hideSmallBtn.textContent = hideSmallPositions ? '[SHOW <$100]' : '[HIDE <$100]';
      els.hideSmallBtn.addEventListener('click', () => {
        hideSmallPositions = !hideSmallPositions;
        els.hideSmallBtn.textContent = hideSmallPositions ? '[SHOW <$100]' : '[HIDE <$100]';
        renderPositionsTable();
      });
    }

    // Add toggle handler for hide NFTs
    if (els.toggleNftsBtn) {
      els.toggleNftsBtn.addEventListener('click', () => {
        hideNfts = !hideNfts;
        els.toggleNftsBtn.textContent = hideNfts ? '[SHOW NFTS]' : '[HIDE NFTS]';
        renderPositionsTable();
      });
    }

    // Add toggle handler for amounts visibility
    if (els.toggleAmountsBtn) {
      els.toggleAmountsBtn.addEventListener('click', () => {
        amountsVisible = !amountsVisible;
        els.toggleAmountsBtn.textContent = amountsVisible ? '[HIDE AMOUNTS]' : '[SHOW AMOUNTS]';
        if (els.toggleAmountsBtnMobile) {
          els.toggleAmountsBtnMobile.textContent = amountsVisible ? '[HIDE AMOUNTS]' : '[SHOW AMOUNTS]';
        }
        renderPositionsTable();
        updateHeroSection(); // Also hide amounts in hero
      });
      els.toggleAmountsBtn.textContent = '[HIDE AMOUNTS]';
    }
    
    // Sync mobile button text
    if (els.toggleAmountsBtnMobile) {
      els.toggleAmountsBtnMobile.textContent = '[HIDE AMOUNTS]';
    }

    // Add font size controls
    if (els.decreaseFontBtn) {
      els.decreaseFontBtn.addEventListener('click', () => {
        if (currentFontSize > 10) { // minimum 10px
          const newSize = currentFontSize - 1;
          applyFontSize(newSize);
          const s = loadSettings() || getDefaultSettings();
          s.fontSize = newSize;
          saveSettings(s);
        }
      });
    }

    if (els.increaseFontBtn) {
      els.increaseFontBtn.addEventListener('click', () => {
        if (currentFontSize < 24) { // maximum 24px
          const newSize = currentFontSize + 1;
          applyFontSize(newSize);
          const s = loadSettings() || getDefaultSettings();
          s.fontSize = newSize;
          saveSettings(s);
        }
      });
    }

    // Mobile menu handlers
    if (els.mobileMenuBtn) {
      els.mobileMenuBtn.addEventListener('click', openMobileMenu);
    }
    
    if (els.closeMobileMenuBtn) {
      els.closeMobileMenuBtn.addEventListener('click', closeMobileMenu);
    }
    
    // Mobile snow toggle
    if (els.toggleSnowBtnMobile) {
      els.toggleSnowBtnMobile.addEventListener('click', () => {
        toggleSnow();
        const newText = snowActive ? '[SNOW OFF]' : '[SNOW ON]';
        els.toggleSnowBtnMobile.textContent = newText;
        // Update desktop button too
        const desktopBtn = document.getElementById('toggleSnowBtn');
        if (desktopBtn) desktopBtn.textContent = newText;
      });
    }
    
    // Mobile rain toggle
    if (els.toggleRainBtnMobile) {
      els.toggleRainBtnMobile.addEventListener('click', () => {
        toggleRain();
        const newText = rainActive ? '[RAIN OFF]' : '[RAIN ON]';
        els.toggleRainBtnMobile.textContent = newText;
        // Update desktop button too
        const desktopBtn = document.getElementById('toggleRainBtn');
        if (desktopBtn) desktopBtn.textContent = newText;
      });
    }
    
    // Mobile theme toggle
    if (els.toggleThemeBtnMobile) {
      els.toggleThemeBtnMobile.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        applyTheme(newTheme);
        els.toggleThemeBtnMobile.textContent = newTheme === 'dark' ? '[LIGHT MODE]' : '[DARK MODE]';
        const s = loadSettings() || getDefaultSettings();
        s.theme = newTheme;
        saveSettings(s);
      });
    }
    
    // Mobile amounts toggle
    if (els.toggleAmountsBtnMobile) {
      els.toggleAmountsBtnMobile.addEventListener('click', () => {
        amountsVisible = !amountsVisible;
        els.toggleAmountsBtn.textContent = amountsVisible ? '[HIDE AMOUNTS]' : '[SHOW AMOUNTS]';
        els.toggleAmountsBtnMobile.textContent = amountsVisible ? '[HIDE AMOUNTS]' : '[SHOW AMOUNTS]';
        renderPositionsTable();
        updateHeroSection();
      });
    }
    
    // Mobile font size controls
    if (els.decreaseFontBtnMobile) {
      els.decreaseFontBtnMobile.addEventListener('click', () => {
        if (currentFontSize > 10) {
          const newSize = currentFontSize - 1;
          applyFontSize(newSize);
          const s = loadSettings() || getDefaultSettings();
          s.fontSize = newSize;
          saveSettings(s);
        }
      });
    }
    
    if (els.increaseFontBtnMobile) {
      els.increaseFontBtnMobile.addEventListener('click', () => {
        if (currentFontSize < 24) {
          const newSize = currentFontSize + 1;
          applyFontSize(newSize);
          const s = loadSettings() || getDefaultSettings();
          s.fontSize = newSize;
          saveSettings(s);
        }
      });
    }

    // Calvin navigation handlers
    if (els.calvinPrevBtn) {
      els.calvinPrevBtn.addEventListener('click', () => {
        currentCalvinDate.setDate(currentCalvinDate.getDate() - 1);
        renderCalvin(currentCalvinDate, true);
      });
    }
    
    if (els.calvinNextBtn) {
      els.calvinNextBtn.addEventListener('click', () => {
        currentCalvinDate.setDate(currentCalvinDate.getDate() + 1);
        renderCalvin(currentCalvinDate, true);
      });
    }
    
    if (els.calvinRandomBtn) {
      els.calvinRandomBtn.addEventListener('click', () => {
        const settings = loadSettings() || getDefaultSettings();
        const comicStrip = settings.comicStrip || 'calvinandhobbes';
        const comic = comicMetadata[comicStrip];
        
        if (comic) {
          const randomTime = comic.startDate.getTime() + Math.random() * (comic.endDate.getTime() - comic.startDate.getTime());
          currentCalvinDate = new Date(randomTime);
          renderCalvin(currentCalvinDate, true);
        }
      });
    }

    // Set up auto-refresh
    const refreshMinutes = (settings && settings.refreshMinutes) || 30;
    if (refreshMinutes > 0) {
      setInterval(refreshAll, refreshMinutes * 60 * 1000);
    }
  }

  // Pixel art rain effect
  const rainCanvas = document.getElementById('rainCanvas');
  const rainCtx = rainCanvas ? rainCanvas.getContext('2d') : null;
  let rainDrops = [];
  let rainActive = false;
  let snowActive = false;
  let rainAnimationFrame = null;
  
  const rainConfig = {
    density: 161,
    speed: 5,
    size: 1,
    length: 8,
    angle: -30,
    randomAngle: true,
    useThemeColor: false
  };
  
  let rainAngleOffset = 0;
  let rainAngleChangeTime = 0;
  let targetAngleOffset = 0;
  let windTransitionSpeed = 0.02; // Smooth wind transitions
  
  // Check weather at user's location and auto-enable rain/snow
  async function checkWeatherAndEnableRain() {
    try {
      const settings = loadSettings();
      const weather = settings?.weather;
      
      // Check if user has location set in settings
      if (!weather || !weather.lat || !weather.lon) {
        console.log('Weather check skipped: No location set in settings');
        return;
      }
      
      const latitude = weather.lat;
      const longitude = weather.lon;
      
      // Fetch weather data from Open-Meteo (free, no API key required)
      const weatherResponse = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=weather_code,precipitation&timezone=auto`
      );
      
      if (!weatherResponse.ok) {
        console.log('Weather API error:', weatherResponse.status);
        return;
      }
      
      const weatherData = await weatherResponse.json();
      const weatherCode = weatherData.current?.weather_code;
      const precipitation = weatherData.current?.precipitation || 0;
      
      // Weather codes from Open-Meteo: https://open-meteo.com/en/docs
      // Snow codes: 71-77 (snow), 85-86 (snow showers)
      const isSnowing = (weatherCode >= 71 && weatherCode <= 77) ||
                       (weatherCode >= 85 && weatherCode <= 86);
      
      // Rain codes: 51-67 (drizzle/rain), 80-82 (rain showers), 95-99 (thunderstorm)
      const isRaining = !isSnowing && (precipitation > 0 || 
                       (weatherCode >= 51 && weatherCode <= 67) ||
                       (weatherCode >= 80 && weatherCode <= 82) ||
                       (weatherCode >= 95 && weatherCode <= 99));
      
      if (isSnowing && !snowActive) {
        console.log('❄️ Detected snow at your location, enabling snow effect');
        toggleSnow();
        const toggleBtn = document.getElementById('toggleSnowBtn');
        const mobileBtn = document.getElementById('toggleSnowBtnMobile');
        if (toggleBtn) toggleBtn.textContent = '[SNOW OFF]';
        if (mobileBtn) mobileBtn.textContent = '[SNOW OFF]';
      } else if (isRaining && !rainActive) {
        console.log('🌧️ Detected rain at your location, enabling rain effect');
        toggleRain();
        const toggleBtn = document.getElementById('toggleRainBtn');
        const mobileBtn = document.getElementById('toggleRainBtnMobile');
        if (toggleBtn) toggleBtn.textContent = '[RAIN OFF]';
        if (mobileBtn) mobileBtn.textContent = '[RAIN OFF]';
      }
    } catch (error) {
      // Silently fail - API might be unavailable
      console.log('Weather check skipped:', error.message);
    }
  }
  
  function resizeRainCanvas() {
    if (!rainCanvas) return;
    rainCanvas.width = window.innerWidth;
    rainCanvas.height = window.innerHeight;
  }
  
  function createRainDrop() {
    // Snow uses same rendering as rain but with slower speed
    const baseSpeed = snowActive ? 0.6 : rainConfig.speed;
    const baseSize = snowActive ? 1 : rainConfig.size;
    const baseLength = snowActive ? 2 : rainConfig.length;
    
    return {
      x: Math.random() * rainCanvas.width,
      y: Math.random() * rainCanvas.height - rainCanvas.height,
      speed: baseSpeed * (0.7 + Math.random() * 0.6), // More speed variation
      size: baseSize,
      length: baseLength,
      wobble: Math.random() * Math.PI * 2, // For slight horizontal variation
      wobbleSpeed: 0.02 + Math.random() * 0.03
    };
  }
  
  function initRain() {
    rainDrops = [];
    for (let i = 0; i < rainConfig.density; i++) {
      rainDrops.push(createRainDrop());
    }
  }
  
  function drawRain() {
    if ((!rainActive && !snowActive) || !rainCtx) return;
    
    rainCtx.clearRect(0, 0, rainCanvas.width, rainCanvas.height);
    
    // Set pixel art style - crisp rendering
    rainCtx.imageSmoothingEnabled = false;
    
    // Color based on type
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (snowActive) {
      // Snow is pure white
      rainCtx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.85)';
    } else {
      // Rain color - more whitish
      if (rainConfig.useThemeColor) {
        rainCtx.fillStyle = isDark ? '#268bd2' : '#268bd2';
      } else {
        rainCtx.fillStyle = isDark ? 'rgba(230, 240, 255, 0.7)' : 'rgba(180, 190, 210, 0.6)';
      }
    }
    
    // Realistic wind simulation - smooth transitions
    const currentTime = Date.now();
    if (rainConfig.randomAngle) {
      // Change wind target every 2-4 seconds
      if (currentTime - rainAngleChangeTime > 2000 + Math.random() * 2000) {
        targetAngleOffset = (Math.random() - 0.5) * 40; // ±20° variation
        rainAngleChangeTime = currentTime;
      }
      // Smoothly interpolate to target angle
      rainAngleOffset += (targetAngleOffset - rainAngleOffset) * windTransitionSpeed;
    } else {
      rainAngleOffset = 0;
      targetAngleOffset = 0;
    }
    
    const effectiveAngle = rainConfig.angle + rainAngleOffset;
    const angleRad = (effectiveAngle * Math.PI) / 180;
    
    rainDrops.forEach(drop => {
      // Round coordinates for sharp pixels
      const x = Math.round(drop.x);
      const y = Math.round(drop.y);
      
      // Add subtle wobble for realism
      const wobbleOffset = Math.sin(drop.wobble) * 0.3;
      
      // Draw pixel art raindrop/snow (sharp rectangle)
      // Snow uses same rendering, just different color and speed
      rainCtx.fillRect(
        x + wobbleOffset, 
        y, 
        drop.size, 
        drop.size * drop.length
      );
      
      // Update position with wind angle and individual wobble
      drop.y += drop.speed;
      drop.x += Math.sin(angleRad) * drop.speed * 0.35 + wobbleOffset;
      drop.wobble += drop.wobbleSpeed;
      
      // Reset drop when it goes off screen
      if (drop.y > rainCanvas.height) {
        drop.y = -10 - Math.random() * 20;
        drop.x = Math.random() * rainCanvas.width;
        const baseSpeed = snowActive ? 0.6 : rainConfig.speed;
        drop.speed = baseSpeed * (0.7 + Math.random() * 0.6);
        drop.wobble = Math.random() * Math.PI * 2;
      }
      if (drop.x < -20) drop.x = rainCanvas.width + 20;
      if (drop.x > rainCanvas.width + 20) drop.x = -20;
    });
    
    rainAnimationFrame = requestAnimationFrame(drawRain);
  }
  
  function toggleRain() {
    rainActive = !rainActive;
    
    if (rainActive) {
      snowActive = false; // Turn off snow if rain is enabled
      rainCanvas.classList.add('active');
      resizeRainCanvas();
      initRain();
      drawRain();
      
      // Update snow buttons
      const snowBtn = document.getElementById('toggleSnowBtn');
      const snowMobileBtn = document.getElementById('toggleSnowBtnMobile');
      if (snowBtn) snowBtn.textContent = '[SNOW ON]';
      if (snowMobileBtn) snowMobileBtn.textContent = '[SNOW ON]';
    } else {
      rainCanvas.classList.remove('active');
      if (rainAnimationFrame) {
        cancelAnimationFrame(rainAnimationFrame);
        rainAnimationFrame = null;
      }
    }
  }
  
  function toggleSnow() {
    snowActive = !snowActive;
    
    if (snowActive) {
      rainActive = false; // Turn off rain if snow is enabled
      rainCanvas.classList.add('active');
      resizeRainCanvas();
      initRain(); // Use same particles
      drawRain(); // Use same draw function
      
      // Update rain buttons
      const rainBtn = document.getElementById('toggleRainBtn');
      const rainMobileBtn = document.getElementById('toggleRainBtnMobile');
      if (rainBtn) rainBtn.textContent = '[RAIN ON]';
      if (rainMobileBtn) rainMobileBtn.textContent = '[RAIN ON]';
    } else {
      rainCanvas.classList.remove('active');
      if (rainAnimationFrame) {
        cancelAnimationFrame(rainAnimationFrame);
        rainAnimationFrame = null;
      }
    }
  }
  
  function setupRainControls() {
    const toggleBtn = document.getElementById('toggleRainBtn');
    const toggleSnowBtn = document.getElementById('toggleSnowBtn');
    const densityInput = document.getElementById('rainDensity');
    const speedInput = document.getElementById('rainSpeed');
    const sizeInput = document.getElementById('rainSize');
    const lengthInput = document.getElementById('rainLength');
    const angleInput = document.getElementById('rainAngle');
    const randomAngleCheckbox = document.getElementById('rainRandomAngle');
    const colorCheckbox = document.getElementById('rainColor');
    
    if (!toggleBtn) return;
    
    // Toggle rain on/off
    toggleBtn.addEventListener('click', () => {
      toggleRain();
      const newText = rainActive ? '[RAIN OFF]' : '[RAIN ON]';
      toggleBtn.textContent = newText;
      // Update mobile button too
      const mobileBtn = document.getElementById('toggleRainBtnMobile');
      if (mobileBtn) mobileBtn.textContent = newText;
    });
    
    // Toggle snow on/off
    if (toggleSnowBtn) {
      toggleSnowBtn.addEventListener('click', () => {
        toggleSnow();
        const newText = snowActive ? '[SNOW OFF]' : '[SNOW ON]';
        toggleSnowBtn.textContent = newText;
        // Update mobile button too
        const mobileBtn = document.getElementById('toggleSnowBtnMobile');
        if (mobileBtn) mobileBtn.textContent = newText;
      });
    }
    
    // Update density
    if (densityInput) {
      densityInput.addEventListener('input', (e) => {
        rainConfig.density = parseInt(e.target.value);
        document.getElementById('rainDensityValue').textContent = rainConfig.density;
        if (rainActive) initRain();
      });
    }
    
    // Update speed
    if (speedInput) {
      speedInput.addEventListener('input', (e) => {
        rainConfig.speed = parseInt(e.target.value);
        document.getElementById('rainSpeedValue').textContent = rainConfig.speed;
      });
    }
    
    // Update size (width)
    if (sizeInput) {
      sizeInput.addEventListener('input', (e) => {
        rainConfig.size = parseInt(e.target.value);
        document.getElementById('rainSizeValue').textContent = rainConfig.size;
      });
    }
    
    // Update length
    if (lengthInput) {
      lengthInput.addEventListener('input', (e) => {
        rainConfig.length = parseInt(e.target.value);
        document.getElementById('rainLengthValue').textContent = rainConfig.length;
      });
    }
    
    // Update angle
    if (angleInput) {
      angleInput.addEventListener('input', (e) => {
        rainConfig.angle = parseInt(e.target.value);
        document.getElementById('rainAngleValue').textContent = rainConfig.angle + '°';
        rainConfig.randomAngle = false; // Disable random when manually adjusted
        if (randomAngleCheckbox) randomAngleCheckbox.checked = false;
      });
    }
    
    // Toggle random angle
    if (randomAngleCheckbox) {
      randomAngleCheckbox.addEventListener('change', (e) => {
        rainConfig.randomAngle = e.target.checked;
        if (e.target.checked) {
          rainAngleChangeTime = 0; // Force immediate angle change
        }
      });
    }
    
    // Toggle theme color
    if (colorCheckbox) {
      colorCheckbox.addEventListener('change', (e) => {
        rainConfig.useThemeColor = e.target.checked;
      });
    }
    
    // Slider button controls
    document.querySelectorAll('.slider-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const delta = parseInt(btn.getAttribute('data-delta'));
        const input = document.getElementById(targetId);
        if (input) {
          const newValue = Math.max(
            parseInt(input.min),
            Math.min(parseInt(input.max), parseInt(input.value) + delta)
          );
          input.value = newValue;
          input.dispatchEvent(new Event('input'));
        }
      });
    });
    
    // Resize canvas on window resize
    window.addEventListener('resize', () => {
      if (rainActive) resizeRainCanvas();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    init();
    setupRainControls();
    
    // Check weather and auto-enable rain if it's raining at user's location (desktop only)
    if (rainCanvas && !isMobileDevice()) {
      checkWeatherAndEnableRain();
    }
  });
  
  // Helper function to detect mobile devices
  function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) 
           || window.innerWidth <= 768;
  }
  
  // Stop real-time updates when page unloads
  window.addEventListener('beforeunload', stopRealTimeUpdates);
})();
