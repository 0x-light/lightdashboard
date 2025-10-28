# Custom Stickers & Wallpapers

## Quick Start

### Adding Images

1. **Drop images** into `/stickers/` or `/wallpapers/` folders
2. **Run the update script:**
```bash
./update-manifests.sh
```
3. **Refresh** your dashboard
4. **Select** your images in Settings

That's it! 🎉

---

## How to Use

### Stickers (Rain Particles)

1. Add image files (PNG, JPG, GIF, WEBP) to the `/stickers/` folder
2. Run `./update-manifests.sh` to update the index
3. Refresh the dashboard
4. Images will appear in Settings > Rain Effect > Particle Style dropdown
5. Use the search bar to filter stickers by name
6. Preview shows the selected sticker before applying

**Recommended image specs:**
- Size: 32x32px to 128x128px (square works best)
- Format: PNG with transparency for best results
- File names: Use simple names like `btc.png`, `eth.png`, `saylor.png`

### Wallpapers (Background Images)

1. Create a `/wallpapers/` folder in your project root
2. Add image files (PNG, JPG, GIF, WEBP) to the folder
3. Images will automatically appear in the "Wallpaper" dropdown in Settings > Appearance
4. Select your wallpaper to apply it as a background

**Recommended image specs:**
- Resolution: 1920x1080 or higher for best quality
- Format: JPG for photos, PNG for graphics
- File size: Keep under 2MB for fast loading

### Pre-configured Filenames

The app will automatically try to load these filenames if they exist:

**Stickers:**
- btc.png, bitcoin.png, eth.png, ethereum.png
- zcash.png, hyperliquid.png, hl.png
- saylor.png, michael-saylor.png
- doge.png, pepe.png, wojak.png
- rocket.png, moon.png, diamond.png, hands.png

**Wallpapers:**
- wallpaper1.jpg, wallpaper2.jpg, wallpaper3.jpg
- matrix.jpg, rain.jpg, neon.jpg, cyberpunk.jpg
- bitcoin.jpg, crypto.jpg, abstract.jpg

You can use these exact filenames or add your own. The app will gracefully handle missing files.

### Tips

- The wallpaper has an 85% opacity overlay to maintain text readability
- Stickers will render at 2x their height for better visibility in the rain effect
- Images are loaded asynchronously, so the dashboard will still load even if images are missing
- Check the browser console for logs about which images were successfully loaded

