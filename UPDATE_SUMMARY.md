# 🚀 Version 2.4.4 - Critical Update System Overhaul

## ✅ FIXED: Users Now Get Latest Version Immediately

### What Was Wrong
- Service Worker returned cached (old) JS/CSS files immediately
- Users could be stuck on old versions for hours/days
- No automatic version checking in the app itself

### What's Fixed
1. **Network-First Strategy**: JS/CSS now fetched from server first, cache only as offline fallback
2. **Automatic Version Detection**: App checks version on startup and force-reloads if outdated
3. **Aggressive Update Checks**: Service Worker checks for updates every 30s (was 60s) + immediately on load
4. **Manual Force Update Button**: Added `[FORCE UPDATE]` button in Settings for users who get stuck
5. **Improved Version Display**: Shows current version + build time in mobile menu

## 📝 Files Changed
- ✅ `sw.js` - Changed caching strategy to network-first for JS/CSS
- ✅ `app.js` - Added version checking + force update button handler
- ✅ `index.html` - Updated SW registration + added force update button
- ✅ `update-version.sh` - Now updates APP_VERSION in app.js
- ✅ `DEPLOYMENT_GUIDE.md` - Comprehensive deployment documentation
- ✅ All version numbers bumped: `2.4.3` → `2.4.4`

## 🚀 Deploy Now

```bash
# Already done - just commit and push!
git add -A
git commit -m "v2.4.4: Fix critical caching issue - ensure users get latest version"
git push origin main
```

## ⏰ User Experience After Deploy

### First Load After Update (within 30 seconds):
1. User opens app
2. Service Worker detects new version
3. App automatically reloads
4. User sees version `v2.4.4` in mobile menu

### Subsequent Loads:
- Always gets latest JS/CSS files (network-first)
- If offline → uses cached version
- Version check runs on every startup

### If User Gets Stuck:
1. Open Settings
2. Click `[FORCE UPDATE]`
3. All caches cleared + hard reload

## 🧪 Verify After Deploy (5-10 min)

```javascript
// Open production site, paste in console:

// 1. Check version
console.log('Version:', localStorage.getItem('viewport_last_version'));
// Should show: "2.4.4"

// 2. Check service worker
navigator.serviceWorker.getRegistration().then(reg => 
  console.log('SW state:', reg.active?.state)
);
// Should show: "activated"

// 3. Check caches
caches.keys().then(keys => console.log('Caches:', keys));
// Should show: ["lightdash-v2.4.4"]
```

## 📱 iOS PWA Special Considerations

iOS PWAs can be extra stubborn about caching. If users report issues:

### User Steps (iOS):
1. **First**: Try Settings → `[FORCE UPDATE]`
2. **If that fails**: Delete PWA from home screen → Clear Safari cache → Re-add PWA

### Your Steps (if many users affected):
```bash
# Bump version again (extra nudge for iOS)
./update-version.sh 2.4.5
git add -A && git commit -m "Additional version bump for iOS PWA" && git push
```

## 🎯 Success Metrics

After 1 hour, you should see:
- ✅ No users reporting old version
- ✅ Version display shows `v2.4.4` for all users
- ✅ Console shows no service worker errors
- ✅ Force Update button works when tested

## 🔄 Future Updates

Every deployment, just run:
```bash
./update-version.sh 2.4.5  # or whatever version
git add -A
git commit -m "Bump version to v2.4.5"
git push
```

The script now updates:
- Service Worker cache version
- Build timestamp
- All HTML version params
- **APP_VERSION constant in app.js** ← NEW!

---

## 🆘 Emergency Contacts

If users are **still** stuck after Force Update:

**Console Command** (have them paste):
```javascript
caches.keys().then(k => Promise.all(k.map(n => caches.delete(n)))).then(() => {
  localStorage.removeItem('viewport_last_version');
  window.location.reload(true);
});
```

This will:
1. Delete all caches
2. Reset version tracking
3. Force hard reload

---

**Version**: 2.4.4  
**Date**: November 14, 2025  
**Critical**: YES - Deploy ASAP  
**Breaking**: NO - Backward compatible

