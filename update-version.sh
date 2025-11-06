#!/bin/bash
# Version Update Script
# Automatically updates version numbers across all files

# Check if version argument is provided
if [ -z "$1" ]; then
    echo "Usage: ./update-version.sh <new-version>"
    echo "Example: ./update-version.sh 2.2.4"
    exit 1
fi

NEW_VERSION="$1"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "🔄 Updating version to v${NEW_VERSION}..."

# Update sw.js
if [ -f "sw.js" ]; then
    echo "  ✓ Updating sw.js..."
    sed -i.bak "s/const CACHE_VERSION = 'v[0-9.]*';/const CACHE_VERSION = 'v${NEW_VERSION}';/" sw.js
    sed -i.bak "s/const BUILD_TIMESTAMP = '[^']*';/const BUILD_TIMESTAMP = '${TIMESTAMP}';/" sw.js
    rm sw.js.bak 2>/dev/null
fi

# Update index.html
if [ -f "index.html" ]; then
    echo "  ✓ Updating index.html..."
    sed -i.bak "s/styles\.css?v=[0-9.]*/styles.css?v=${NEW_VERSION}/" index.html
    sed -i.bak "s/app\.js?v=[0-9.]*/app.js?v=${NEW_VERSION}/g" index.html
    sed -i.bak "s/app-init\.js?v=[0-9.]*/app-init.js?v=${NEW_VERSION}/" index.html
    rm index.html.bak 2>/dev/null
fi

echo ""
echo "✅ Version updated to v${NEW_VERSION}"
echo "📅 Timestamp: ${TIMESTAMP}"
echo ""
echo "Next steps:"
echo "  1. Test your changes locally"
echo "  2. Commit: git add -A && git commit -m \"Bump version to v${NEW_VERSION}\""
echo "  3. Deploy to production"
echo "  4. Verify update on mobile after ~5 minutes"

