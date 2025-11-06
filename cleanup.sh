#!/bin/bash
set -e  # Exit on error

echo "🧹 Starting repository cleanup..."
echo ""

# Step 1: Safety commit
echo "📦 Step 1: Committing current state (safety backup)..."
git add -A
git commit -m "chore: final state before cleanup - all versions preserved" || echo "Nothing to commit"
echo "✅ Current state committed"
echo ""

# Step 2: Delete old app versions
echo "🗑️  Step 2: Removing old app versions..."
rm -rf new/
rm -f script.js
[ -f index.html ] && mv index.html index.html.old  # Keep as backup temporarily
echo "✅ Removed: /new/, script.js"
echo ""

# Step 3: Delete documentation files (keep README.md)
echo "📄 Step 3: Removing documentation files..."
rm -f ARCHITECTURE_*.md COMIC_FIX.md CRITICAL_FIXES.md DEPLOY.md \
   EMERGENCY_FIX.md FIXES_SUMMARY.md HYPERLIQUID_SPOT_FIX.md \
   IMPLEMENTATION_*.md MOBILE_CACHE_FIX.md MULTICHAIN_BALANCES.md \
   NFT_AND_24H_FIXES.md PERFORMANCE*.md PRODUCTION*.md PYTH_INTEGRATION.md \
   QUICK_WINS_IMPLEMENTATION.md README_REFACTOR.md REFACTOR_*.md \
   SECURITY.md STICKERS_AND_WALLPAPERS.md ZERION_PROXY_FIX.md
echo "✅ Removed all .md docs (kept README.md)"
echo ""

# Step 4: Delete debug files
echo "🐛 Step 4: Removing debug files..."
rm -f clear_cache.html diagnose.html wrangler.log
echo "✅ Removed debug files"
echo ""

# Step 5: Optional - delete tests
echo "🧪 Step 5: Removing tests..."
rm -rf tests/
echo "✅ Removed tests/"
echo ""

# Step 6: Move portfolio to root
echo "📁 Step 6: Moving /portfolio to root..."
mv portfolio/index.html index.html
mv portfolio/app.js app.js
rmdir portfolio/
echo "✅ Moved portfolio contents to root"
echo ""

# Step 7: Update file paths
echo "🔧 Step 7: Updating file paths..."

# Update index.html paths
sed -i.bak 's|href="../styles.css|href="./styles.css|g' index.html
sed -i.bak 's|src="../modules/app-init.js|src="./modules/app-init.js|g' index.html
sed -i.bak 's|src="./app.js|src="./app.js|g' index.html
rm -f index.html.bak

# Update app.js paths
sed -i.bak "s|from '../modules/|from './modules/|g" app.js
sed -i.bak "s|import('../modules/|import('./modules/|g" app.js
rm -f app.js.bak

echo "✅ Updated all file paths"
echo ""

# Step 8: Clean up old index.html backup
echo "🧹 Step 8: Cleaning up..."
rm -f index.html.old
echo "✅ Cleanup complete"
echo ""

# Step 9: Final commit
echo "📦 Step 9: Committing cleaned version..."
git add -A
git commit -m "chore: cleanup - removed legacy code, moved portfolio to root

- Removed /new/ and old script.js
- Removed all documentation .md files (kept README)
- Removed debug files (clear_cache.html, diagnose.html)
- Moved /portfolio/ contents to root
- Updated all import paths from '../modules/' to './modules/'
- Removed tests/ directory

All old versions are preserved in git history."

echo "✅ Cleanup committed"
echo ""
echo "🎉 Repository cleanup complete!"
echo ""
echo "📊 Summary:"
echo "  - Old app versions: DELETED"
echo "  - Documentation: CLEANED"
echo "  - Portfolio: MOVED TO ROOT"
echo "  - Paths: UPDATED"
echo ""
echo "💡 To recover old files: git checkout <commit-hash>~1 -- <file>"

