#!/bin/bash

# Update manifest files for stickers and wallpapers
# Run this after adding new images to the folders

echo "🔄 Updating image manifests..."

# Update stickers manifest
if [ -d "stickers" ]; then
  cd stickers
  ls -1 *.png *.jpg *.jpeg *.gif *.webp 2>/dev/null | jq -R -s -c 'split("\n") | map(select(length > 0))' > index.json
  count=$(cat index.json | jq 'length')
  echo "✅ Stickers: $count files"
  cd ..
else
  echo "⚠️  No stickers/ folder found"
fi

# Update wallpapers manifest
if [ -d "wallpapers" ]; then
  cd wallpapers
  ls -1 *.png *.jpg *.jpeg *.gif *.webp 2>/dev/null | jq -R -s -c 'split("\n") | map(select(length > 0))' > index.json
  count=$(cat index.json | jq 'length')
  echo "✅ Wallpapers: $count files"
  cd ..
else
  echo "⚠️  No wallpapers/ folder found"
fi

echo ""
echo "🎉 Done! Refresh your dashboard to see the new images."

