# Personal Dashboard

A beautiful, ultra-minimal terminal-style dashboard for tracking crypto positions, NFTs, weather, and daily comic strips.

## Features

- **Portfolio Tracking**: Track positions across Hyperliquid, Lighter, and OpenSea NFTs
- **Multi-Wallet Support**: Add multiple wallets (comma-separated)
- **Live Price Data**: Real-time prices and 24h changes from CoinGecko
- **Weather Integration**: Local weather with moon phases
- **Comic Strips**: Daily Calvin & Hobbes, Peanuts, or The Far Side
- **Customizable**: 
  - Light/Dark themes
  - Adjustable font size (10-24px)
  - Show/hide various elements
  - Color-coded or neutral P&L display
- **Fully Responsive**: Mobile-optimized with card views

## Deployment

### Quick Start (Static Hosting)

This dashboard is a single-page application with no backend requirements. Deploy to any static hosting service:

#### Option 1: GitHub Pages
1. Create a new GitHub repository
2. Upload `index.html`, `styles.css`, and `script.js`
3. Go to Settings → Pages → Enable GitHub Pages
4. Your dashboard will be live at `https://yourusername.github.io/repository-name`

#### Option 2: Netlify
1. Drag and drop the folder to [Netlify Drop](https://app.netlify.com/drop)
2. Your dashboard is instantly deployed

#### Option 3: Vercel
1. Install Vercel CLI: `npm i -g vercel`
2. Run `vercel` in the dashboard directory
3. Follow the prompts

#### Option 4: Local Server
```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx http-server

# Using PHP
php -S localhost:8000
```

Then open `http://localhost:8000` in your browser.

## Configuration

All settings are stored in `localStorage` and persist across sessions:

### Initial Setup
1. Click **[SETTINGS]** in the top right
2. Configure:
   - **Wallet Addresses**: Add your wallet addresses (comma-separated)
   - **OpenSea API Key** (optional): For NFT price data
   - **Personal Info**: Name, city, coordinates
   - **Comic Strip**: Choose your preferred comic
   - **Preferences**: Toggle rain forecast, colored P&L, comic visibility

### Customization
- **Font Size**: Use `[-` / `+]` controls in the header
- **Theme**: Toggle between light/dark modes with `[DARK MODE]` / `[LIGHT MODE]`
- **Visibility**: Hide amounts, small positions (<$100), or NFTs
- **Refresh**: Set auto-refresh interval (default: 30 minutes)

## API Keys

### Required
- None! The dashboard works out of the box with public APIs

### Optional
- **OpenSea API Key**: Get from [OpenSea Developer Portal](https://docs.opensea.io/reference/api-overview)
  - Enables NFT price tracking and floor prices
  - Without it, only basic NFT data is available

## Data Sources

- **Crypto Prices**: [CoinGecko API](https://www.coingecko.com/en/api) (free, no key required)
- **Hyperliquid Positions**: [Hyperliquid API](https://hyperliquid.xyz)
- **Lighter Positions**: [Lighter API](https://lighter.xyz)
- **NFT Data**: [OpenSea API](https://opensea.io) / [Reservoir API](https://reservoir.tools)
- **Weather**: [Open-Meteo API](https://open-meteo.com)
- **Comics**: [GoComics](https://www.gocomics.com) / [The Far Side](https://www.thefarside.com)

## Browser Support

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support
- Mobile browsers: Fully responsive with card layouts

## Privacy

- All data is stored locally in your browser
- No tracking, analytics, or external dependencies beyond API calls
- API keys are stored in `localStorage` (never transmitted except to the respective APIs)

## Technical Stack

- **Pure JavaScript** (no frameworks)
- **Vanilla CSS** with CSS variables for theming
- **Berkeley Mono** font for that terminal aesthetic
- **localStorage** for persistence
- **No build tools** required

## Keyboard Shortcuts

None currently implemented, but the UI is designed for quick access:
- Settings: Click `[SETTINGS]`
- Mobile menu: Click `[MENU]` on mobile devices

## Troubleshooting

### NFTs not showing
1. Add OpenSea API key in settings
2. Check browser console for errors
3. Verify wallet address is correct

### Positions not updating
1. Check refresh interval setting
2. Force refresh by clicking `[SAVE]` in settings
3. Check browser console for API errors

### Comic not loading
1. Try a different comic strip
2. Check browser console for CORS errors
3. The Far Side may have loading delays due to external hosting

## License

MIT License - Feel free to customize and deploy as your own!

## Credits

Built with an ultra-minimal terminal aesthetic inspired by:
- Solarized color scheme
- Berkeley Mono typeface
- Classic Unix terminals
