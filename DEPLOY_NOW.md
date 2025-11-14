# 🚨 CRITICAL FIX - DEPLOY IMMEDIATELY

## Problem: Users Not Seeing Latest Version
**Status**: ✅ FIXED

## Solution Summary
Changed Service Worker from "stale-while-revalidate" (old cached version) to "network-first" (always fetch latest), plus added automatic version detection and manual force update.

## Deploy in 3 Commands

```bash
cd /Users/light/Documents/code/lightdashboard

git add -A

git commit -m "v2.4.4: Critical fix - ensure users always get latest version

- Changed SW to network-first for JS/CSS (was stale-while-revalidate)
- Added automatic version detection on app startup
- Added Force Update button in Settings
- SW checks for updates every 30s + immediately on load
- Bumped version to 2.4.4"

git push origin main
```

## What Happens Next

### Within 30 seconds of deploy:
- Your production users' browsers will detect the new Service Worker
- They'll get an automatic reload
- They'll see version `v2.4.4` in the mobile menu

### On every subsequent load:
- JS/CSS files fetched from server first (not cache)
- Version check runs automatically
- If outdated → automatic cache clear + reload

## Verify Success (5 minutes after deploy)

Open your production site and check:

```javascript
// In browser console:
localStorage.getItem('viewport_last_version')
// Should show: "2.4.4"
```

Or just check the mobile menu → Version display at bottom

## If Users Still Report Issues

### Step 1: Tell them to try Force Update
1. Open Settings (gear icon)
2. Click `[FORCE UPDATE]` button
3. Wait for reload

### Step 2: If that doesn't work
Have them paste this in console:
```javascript
caches.keys().then(k => Promise.all(k.map(n => caches.delete(n)))).then(() => {
  localStorage.removeItem('viewport_last_version');
  location.reload(true);
});
```

### Step 3: iOS PWA users (last resort)
1. Delete PWA from home screen
2. Clear Safari cache
3. Re-add PWA

## Files Changed
- `sw.js` - Version 2.4.4, network-first strategy
- `app.js` - Added APP_VERSION constant + version checking + Force Update button
- `index.html` - Updated SW registration, added Force Update UI, version 2.4.4
- `update-version.sh` - Now updates APP_VERSION in app.js
- `DEPLOYMENT_GUIDE.md` - Full documentation (NEW)
- `UPDATE_SUMMARY.md` - Quick reference (NEW)

## Why This Works

### Before (Problem):
```
User loads → SW returns old cached JS → User stuck on old version
```

### After (Fixed):
```
User loads → SW fetches new JS from server → User gets latest version
                ↓
              If offline → fallback to cache
```

Plus:
- Version check on startup detects mismatches
- Auto-reload if version outdated
- Manual Force Update as escape hatch

---

**Ready to deploy?** Copy the 3 commands above and run them. ✅

