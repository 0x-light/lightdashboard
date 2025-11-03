# Production Troubleshooting Guide

## 🐛 Issue: Features Work on Localhost but Not in Production

This guide helps diagnose and fix issues when features work locally but fail in production.

---

## 🎬 **Comics Not Working in Production**

### **Symptom:**
- Comics load fine on `http://localhost`
- Comics show "Unable to load comic" or infinite loading in production

### **Cause:**
The Cloudflare Function (`/functions/api/proxy.js`) may not be deployed or accessible.

### **Quick Fix:**

#### **Option 1: Verify Cloudflare Function is Deployed**

1. Go to your Cloudflare Dashboard
2. Navigate to **Pages** → Your Project → **Functions**
3. Check if `/api/proxy` appears in the list
4. If missing, the function wasn't deployed

#### **Option 2: Manual Deployment**

```bash
# Ensure functions directory is committed
git add functions/
git commit -m "Ensure Cloudflare Function is included"
git push origin main

# Or deploy directly with Wrangler
npx wrangler pages deploy . --project-name=lightdashboard
```

#### **Option 3: Test the Function Directly**

Open your browser and visit:
```
https://yourdomain.com/api/proxy?url=https://www.gocomics.com/calvinandhobbes
```

**Expected:** HTML content from GoComics
**If you get 404:** Function isn't deployed
**If you get CORS error:** Function deployed but needs CORS fix

### **Debugging:**

Open browser console (F12) and look for:
```
✅ Good: Fetching: /api/proxy?url=...
❌ Bad: Failed to fetch /api/proxy
❌ Bad: 404 Not Found
```

---

## 📊 **24h Change Not Working in Production**

### **Symptom:**
- 24h change shows correctly on localhost
- Shows "—" or 0% in production

### **Causes:**

1. **CORS Issues with Pyth API**
2. **Historical Price API Timing Out**
3. **Cache Issues in Production**
4. **Different Network Conditions**

### **Quick Diagnosis:**

Open browser console in production and look for:

```javascript
// Check what data was fetched
console.log(getDashboardPerf())

// Look for these messages:
✅ "Parallel data fetch completed in XXXXms"
⚠ "Pyth preload failed: ..."
⚠ "Historical prices preload failed: ..."
⚠ "Missing 24h change for X assets: ..."
```

### **Solution 1: Increase Timeouts for Production**

Production networks can be slower than localhost. The issue might be timeouts.

Add this to your `script.js` (near line 80-100 where PERF_CONFIG is):

```javascript
// Detect production environment
const isProduction = window.location.hostname !== 'localhost' && 
                     window.location.hostname !== '127.0.0.1';

// Use longer timeouts in production
const PERF_CONFIG = {
  TIMEOUTS: {
    PYTH: isProduction ? 20000 : 10000,        // 20s in prod vs 10s local
    COINGECKO: isProduction ? 15000 : 10000,   // 15s in prod vs 10s local
    ZERION: isProduction ? 20000 : 15000,      // 20s in prod vs 15s local
    OPENSEA: isProduction ? 20000 : 15000      // 20s in prod vs 15s local
  },
  // ... rest of config
};
```

### **Solution 2: Force Fallback to CoinGecko**

If Pyth is consistently failing in production, temporarily prioritize CoinGecko:

```javascript
// In fetchAndRenderPositions, around line 6060
// Change the fallback order:

// Try CoinGecko FIRST in production if Pyth fails often
if (isProduction && !change24h) {
  // Fetch from CoinGecko immediately
}
```

### **Solution 3: Check Network Tab**

1. Open DevTools → Network tab
2. Filter by "pyth" or "hermes"
3. Look for failed requests (red)
4. Check response times (should be < 5s)

Common issues:
- **Status 0**: CORS blocked
- **Status 429**: Rate limited
- **Status 504**: Gateway timeout
- **Status (canceled)**: Request timeout

---

## 🔍 **General Production Debugging**

### **Step 1: Enable Verbose Logging**

Add this at the top of `script.js` (after line 19):

```javascript
// Production debug mode
const PRODUCTION_DEBUG = true;

// Enhanced logging for production
if (PRODUCTION_DEBUG) {
  window.debugInfo = {
    fetchTimes: {},
    failedRequests: [],
    environment: {
      hostname: window.location.hostname,
      isProduction: window.location.hostname !== 'localhost',
      userAgent: navigator.userAgent
    }
  };
  
  console.log('🔍 Debug mode enabled:', window.debugInfo.environment);
}
```

### **Step 2: Check API Endpoints**

Run this in production console:

```javascript
// Test Pyth API
fetch('https://hermes.pyth.network/v2/updates/price/latest?ids[]=0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43')
  .then(r => console.log('Pyth API:', r.ok ? 'OK' : 'FAILED'))
  .catch(e => console.error('Pyth API ERROR:', e));

// Test your proxy function
fetch('/api/proxy?url=https://www.gocomics.com')
  .then(r => console.log('Proxy API:', r.ok ? 'OK' : 'FAILED'))
  .catch(e => console.error('Proxy API ERROR:', e));
```

### **Step 3: Compare Localhost vs Production**

| Feature | Localhost | Production | Why Different? |
|---------|-----------|------------|----------------|
| Comics | ✅ Working | ❌ Broken | Cloudflare Function not deployed |
| 24h Change | ✅ Working | ❌ Broken | API timeout or CORS |
| Prices | ✅ Working | ✅ Working | Direct API calls work |
| Positions | ✅ Working | ✅ Working | No proxy needed |

---

## 🛠️ **Quick Fixes for Common Issues**

### **Issue: "Failed to fetch" in Console**

**Cause:** CORS or network error
**Fix:** Check if APIs are accessible:

```javascript
// Run in production console
['https://hermes.pyth.network', 
 'https://api.hyperliquid.xyz',
 'https://api.coingecko.com'].forEach(api => {
  fetch(api).then(r => console.log(api, r.ok))
    .catch(e => console.error(api, 'BLOCKED'));
});
```

### **Issue: "Request Timeout"**

**Cause:** API too slow in production
**Fix:** Increase `PERF_CONFIG.TIMEOUTS` values

### **Issue: "404 Not Found" for /api/proxy**

**Cause:** Cloudflare Function not deployed
**Fix:** 
```bash
git push origin main  # If using GitHub integration
# OR
npx wrangler pages deploy .
```

### **Issue: Data Loads After 10+ Seconds**

**Cause:** Sequential instead of parallel fetching
**Fix:** Check for `await` statements that should be `Promise.all()`

---

## 🚀 **Cloudflare Pages Specific Issues**

### **Function Not Deploying**

**Check:**
1. `functions/` directory exists in repo
2. `functions/api/proxy.js` exists
3. File is committed: `git ls-files functions/`
4. Latest commit is pushed: `git status`

**Cloudflare Pages Requirements:**
- Functions must be in `/functions` directory
- Export format: `export async function onRequest(context)`
- No `package.json` needed for simple functions

### **Build Settings**

In Cloudflare Dashboard → Pages → Settings → Builds:
- **Build command:** (leave empty)
- **Build output directory:** `/`
- **Root directory:** `/`

### **Function Logs**

Check Cloudflare Dashboard → Pages → Your Project → Functions → Logs

Look for:
- Invocation count (should be > 0 if comics accessed)
- Error rate (should be low)
- Duration (should be < 5s)

---

## 📊 **Performance Comparison**

| Metric | Localhost | Production (Good) | Production (Bad) |
|--------|-----------|-------------------|------------------|
| Initial Load | 2-3s | 3-5s | 10-15s |
| 24h Data | 100% | 95%+ | <50% |
| Comics Load | 2s | 3-4s | Never/timeout |
| API Response | <500ms | <2s | >5s or timeout |

---

## 🔧 **Emergency Fallback Mode**

If production is completely broken, add this temporary fix:

```javascript
// At top of script.js
const EMERGENCY_MODE = window.location.hostname !== 'localhost';

if (EMERGENCY_MODE) {
  // Disable features that don't work in production
  const settings = loadSettings() || getDefaultSettings();
  settings.showComic = false;  // Disable comics temporarily
  settings.usePythPrices = false;  // Use exchange prices only
  saveSettings(settings);
  
  console.warn('⚠️ Emergency mode: Some features disabled for stability');
}
```

This disables problematic features while you debug.

---

## 📞 **Getting Help**

### **What to Include in Bug Report:**

1. **Browser Console Output:**
   ```
   Copy everything from console (F12)
   Especially errors (red) and warnings (yellow)
   ```

2. **Network Tab:**
   ```
   Screenshot of failed requests
   Response codes and times
   ```

3. **Environment:**
   ```
   - Browser: Chrome/Firefox/Safari + version
   - URL: your-domain.com
   - Cloudflare Project Name
   ```

4. **What Works:**
   ```
   ✅ Positions loading
   ✅ Prices showing
   ❌ Comics not loading
   ❌ 24h change missing
   ```

---

## ✅ **Verification Checklist**

After deploying fixes:

- [ ] Comics load (visit site and scroll to comic section)
- [ ] 24h change shows for all assets (check positions table)
- [ ] Hero section shows accurate daily P&L
- [ ] Console shows no errors (F12 → Console)
- [ ] Load time < 5 seconds (check Network tab)
- [ ] `/api/proxy` accessible (test URL directly)
- [ ] Functions tab in Cloudflare shows activity

---

## 🎯 **Most Likely Fixes**

**For Comics Not Working:**
```bash
# Ensure function is committed and pushed
git add functions/
git push origin main

# Wait 1-2 minutes for Cloudflare to deploy
# Then test: https://yourdomain.com/api/proxy?url=https://www.gocomics.com
```

**For 24h Change Not Working:**
1. Check browser console for specific errors
2. Increase TIMEOUTS in PERF_CONFIG
3. Verify Pyth API is accessible from production
4. Check if CoinGecko fallback is working

---

**Need more help?** Share console output and I can diagnose the specific issue!

