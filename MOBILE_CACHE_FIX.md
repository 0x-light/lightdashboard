# 📱 Mobile Cache Fix

## Problem
Desktop shows the latest version with all improvements, but mobile devices show an older cached version without:
- Production debugging logs
- Extended timeouts
- Fixed 24h change calculations
- Working comics

## Root Cause
**Service Worker + Browser Caching**

The service worker (sw.js) was using version `v1.0.0` and caching static files (script.js, styles.css, index.html) with a "cache first" strategy. Mobile devices that visited the site before the fixes were serving files from cache instead of fetching fresh versions from the server.

## Solution

### 1. Service Worker Version Bump
**Changed:** `sw.js`
```javascript
// Before
const CACHE_VERSION = 'v1.0.0';

// After
const CACHE_VERSION = 'v2.0.0-production-fixes';
```

**How it works:**
- Service worker detects version change on next visit
- Automatically deletes old cache (`lightdash-v1.0.0`)
- Creates new cache (`lightdash-v2.0.0-production-fixes`)
- Downloads fresh copies of all files
- Takes control of all open pages

### 2. Cache-Busting Query Parameters
**Changed:** `index.html`
```html
<!-- Before -->
<link rel="preload" href="script.js" as="script">
<link rel="stylesheet" href="styles.css">
<script src="script.js" defer></script>

<!-- After -->
<link rel="preload" href="script.js?v=2.0.0" as="script">
<link rel="stylesheet" href="styles.css?v=2.0.0">
<script src="script.js?v=2.0.0" defer></script>
```

**Why this matters:**
- Browser treats `script.js?v=2.0.0` as a different file than `script.js`
- Bypasses browser cache even if service worker doesn't update immediately
- Double insurance against stale cache

## Deployment

### Step 1: Push to Production
```bash
cd /Users/light/Documents/code/lightdashboard
git push origin main
```

### Step 2: Verify Cloudflare Deployed
1. Go to https://dash.cloudflare.com
2. Navigate to Workers & Pages → Your project
3. Confirm latest commit is deployed
4. Check deployment timestamp

### Step 3: Force Refresh on Mobile
Mobile users need to do ONE of these:

**Option A: Hard Refresh (Recommended)**
- **iOS Safari:** 
  - Close all Safari tabs completely
  - Clear Safari cache: Settings → Safari → Clear History and Website Data
  - Reopen site
  
- **Android Chrome:**
  - Tap menu (⋮) → Settings → Privacy → Clear browsing data
  - Select "Cached images and files"
  - Clear
  - Reopen site

**Option B: Wait for Automatic Update (24-48 hours)**
- Service worker will auto-update on next site visit
- Background refresh will download new version
- Page reload will activate new version

## Verification

Mobile users should see these in the browser console:

```
🌐 Production mode detected: yourdomain.com
⏱️ Using extended timeouts for reliability
✅ Service Worker v2.0.0-production-fixes active
```

If they see `v1.0.0` or no service worker message, cache hasn't updated yet.

## Future Updates

**To force cache refresh in future releases:**

1. **Bump service worker version:**
```javascript
// In sw.js
const CACHE_VERSION = 'v3.0.0'; // Increment
```

2. **Update query parameters:**
```html
<!-- In index.html -->
<script src="script.js?v=3.0.0" defer></script>
<link rel="stylesheet" href="styles.css?v=3.0.0">
```

3. **Commit and push**

**Pro tip:** Use semantic versioning
- Major changes: `v2.0.0` → `v3.0.0`
- Minor features: `v2.0.0` → `v2.1.0`
- Bug fixes: `v2.0.0` → `v2.0.1`

## Emergency Cache Clear

If users still see old version after hard refresh, add this to console:

```javascript
// In browser console on mobile
navigator.serviceWorker.getRegistrations().then(registrations => {
  registrations.forEach(registration => registration.unregister());
});
caches.keys().then(names => {
  names.forEach(name => caches.delete(name));
});
location.reload(true);
```

This nukes all service workers and caches, forcing a completely fresh start.

## What Changed in v2.0.0

Users will now see:
- ✅ 24h change calculations working (Pyth + CoinGecko fallbacks)
- ✅ Comics loading reliably (Cloudflare Function proxy)
- ✅ Watchlist showing on initial load
- ✅ Much faster load times (< 2s for critical data)
- ✅ Production-specific timeouts and logging
- ✅ Clear console messages about what's loading/failing

No more "Why isn't this working on my phone?" issues! 📱✨

