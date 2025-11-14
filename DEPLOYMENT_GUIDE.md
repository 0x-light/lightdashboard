# Critical Deployment Guide - Ensuring Users Get Latest Version

## 🚨 Problem Solved
Users were not seeing the latest version because:
1. Service Worker was using "stale-while-revalidate" strategy (returned old cached content immediately)
2. Version checking wasn't aggressive enough
3. No manual cache clear option for stuck users

## ✅ Changes Made (v2.4.4)

### 1. Service Worker Strategy Change
**Location**: `sw.js` lines 132-157
- **Changed**: JS/CSS files from stale-while-revalidate to **network-first**
- **Impact**: Users now get fresh JS/CSS files immediately, with offline fallback only when network fails
- **Trade-off**: Slightly slower initial load, but ensures latest version always loads

### 2. Automatic Version Detection
**Location**: `app.js` lines 3-41
- **Added**: `APP_VERSION` constant and version checking on app startup
- **Behavior**: 
  - Compares current version with last loaded version from localStorage
  - If version mismatch detected → clears all caches + forces hard reload
  - Ensures users can't run old code even if SW is cached

### 3. Aggressive Update Checking
**Location**: `index.html` lines 519-545
- **Changed**: Service Worker update check from every 60s to every **30s**
- **Added**: Immediate update check on page load
- **Added**: Auto-skip-waiting when new SW detected (no manual intervention needed)

### 4. Manual Force Update Button
**Location**: `index.html` line 179, `app.js` lines 1653-1693
- **Added**: `[FORCE UPDATE]` button in Settings
- **Function**: 
  - Clears all browser caches
  - Sends CLEAR_CACHE message to Service Worker
  - Resets version tracking
  - Forces hard reload
- **Use case**: Emergency bailout for users stuck on old version

### 5. Version Display
**Location**: `app.js` lines 2564-2575
- **Changed**: Now uses APP_VERSION constant (fast, no fetch needed)
- **Shows**: Version number + build timestamp in mobile menu

## 🔄 Deployment Process

### Every Deployment:
```bash
# 1. Update version number everywhere
./update-version.sh 2.4.5

# 2. Test locally
# - Open in browser
# - Check console for version logs
# - Check Settings → version display
# - Test Force Update button

# 3. Commit and deploy
git add -A
git commit -m "Bump version to v2.4.5"
git push origin main

# 4. Verify on production (wait 5-10 minutes)
# - Open production URL
# - Check version in mobile menu
# - Check console logs
# - Try force reload if needed
```

## 📋 Update Script Modified
**Location**: `update-version.sh`
Now updates:
- `sw.js`: CACHE_VERSION + BUILD_TIMESTAMP
- `index.html`: All `?v=` version params
- `app.js`: APP_VERSION constant (NEW!)

## 🧪 Testing Update Mechanism

### Local Testing:
```bash
# 1. Set current version to 2.4.4
localStorage.setItem('viewport_last_version', '2.4.4');

# 2. Change APP_VERSION in app.js to 2.4.5
const APP_VERSION = '2.4.5';

# 3. Reload page
# Should see: "[Version] Updating from 2.4.4 to 2.4.5" in console
# Page should auto-reload
```

### Production Verification:
```javascript
// Check service worker
navigator.serviceWorker.getRegistration().then(reg => {
  console.log('SW version:', reg.active?.scriptURL);
  console.log('SW state:', reg.active?.state);
});

// Check caches
caches.keys().then(keys => console.log('Cache keys:', keys));

// Check app version
console.log('App version:', localStorage.getItem('viewport_last_version'));

// Force cache clear (if needed)
caches.keys().then(keys => 
  Promise.all(keys.map(k => caches.delete(k)))
).then(() => location.reload(true));
```

## ⚡ What Happens When User Loads New Version

1. **HTML loads** (always network-first, never cached)
2. **Version check runs immediately**:
   - If version mismatch → clear caches + reload
3. **Service Worker registers**:
   - Checks for SW updates immediately
   - If new SW found → auto-activates within 30s
4. **JS/CSS load**:
   - Network-first (get latest from server)
   - Falls back to cache only if offline
5. **Version displays** in mobile menu

## 🔥 Emergency: Users Still Stuck?

### Option 1: User Action
1. Open Settings
2. Click `[FORCE UPDATE]`
3. Wait for reload

### Option 2: Console Command
```javascript
// Have user paste in console:
caches.keys().then(k => Promise.all(k.map(n => caches.delete(n)))).then(() => {
  localStorage.removeItem('viewport_last_version');
  location.reload(true);
});
```

### Option 3: Bump Version Again
```bash
# Sometimes iOS PWA needs extra nudge
./update-version.sh 2.4.6
git add -A && git commit -m "Force version bump for iOS PWA" && git push
```

### Option 4: Nuclear Option (iOS PWA)
Users need to:
1. Delete PWA from home screen
2. Clear Safari cache: Settings → Safari → Clear History and Website Data
3. Re-add PWA from browser

## 📊 Monitoring

After deployment, check:
- [ ] Version number in mobile menu shows new version
- [ ] Console shows no SW errors
- [ ] No users reporting old version (wait 1 hour)
- [ ] Force Update button works in Settings

## 🎯 Version History

- **v2.4.4** (Nov 14, 2025): Implemented aggressive cache-busting + network-first strategy
- **v2.4.3** (Jan 13, 2025): Previous version (had caching issues)

## 💡 Best Practices Going Forward

1. **Always use `update-version.sh`** - don't manually edit version numbers
2. **Test Force Update button** after each deploy
3. **Monitor for 1 hour** after production deploy
4. **Communicate updates** to users if major changes
5. **Bump version even for small fixes** - version tracking is now core to update mechanism

## 🔗 Related Files

- `sw.js` - Service Worker (caching strategy)
- `app.js` - Main app (version checking)
- `index.html` - SW registration (update checking)
- `update-version.sh` - Version update script
- `_headers` - HTTP cache headers (Cloudflare Pages)

---

**Last Updated**: Nov 14, 2025  
**Current Version**: v2.4.4

