# Personal Dashboard

A beautiful, ultra-minimal terminal-style dashboard for tracking crypto positions, NFTs, weather, and daily comic strips.

## Features

- **Portfolio Tracking**: Track positions across Hyperliquid, Lighter, and OpenSea NFTs
- **Multi-Wallet Support**: Add multiple wallets (comma-separated)
- **Automatic PnL Tracking**: Smart profit/loss calculation for all wallet assets
  - Automatically tracks entry prices when assets are first detected
  - Calculate gains/losses based on your actual cost basis
  - Manual cost basis entry for existing holdings
  - Import/export entry price data for backup
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

## Privacy & Security

**🔒 Your data never leaves your device** - This dashboard is designed with privacy-first principles:

- ✅ **100% Local Storage**: All settings, wallet addresses, and API keys are stored only in your browser's localStorage
- ✅ **Encrypted**: Sensitive data (wallet addresses, API keys) is encrypted before storage
- ✅ **No Tracking**: Zero analytics, no cookies, no telemetry
- ✅ **No Accounts**: No sign-up, no server, no database
- ✅ **Open Source**: Audit the code yourself
- ✅ **Self-Hostable**: Deploy on your own infrastructure for complete control

### What Gets Sent to External APIs?
- Your **wallet addresses** → Only to blockchain APIs (Hyperliquid, Lighter, OpenSea) to fetch your positions
- Your **location coordinates** → Only to weather API (if you enable weather)
- **Nothing else** → No personal data, no usage statistics, no tracking

**See [SECURITY.md](./SECURITY.md) for complete security details and API documentation.**

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

## Advanced Features

### Wallet Asset PnL Management

The dashboard automatically tracks profit/loss for all wallet assets by recording the price when each asset is first detected. You can manage this data using the browser console utilities:

```javascript
// View all tracked entry prices
walletPnLUtils.viewEntryPrices()

// Manually set entry price for an asset (e.g., if you bought before tracking started)
walletPnLUtils.setEntryPrice('BTC_Ethereum', 50000)

// Reset entry price for a specific asset (will re-track on next detection)
walletPnLUtils.resetEntryPrice('ETH_Arbitrum')

// Export your entry prices as JSON (for backup)
const backup = walletPnLUtils.export()

// Import entry prices from JSON (restore from backup)
walletPnLUtils.import(backup)

// Reset all entry prices (fresh start)
walletPnLUtils.resetAll()
```

**How it works:**
1. When a wallet asset is first detected, the current price is recorded as the entry price
2. On subsequent loads, PnL is calculated as: `(current value) - (amount × entry price)`
3. Entry prices are stored in localStorage and persist across sessions
4. For existing holdings, manually set your actual purchase price using `setEntryPrice()`

**Important Notes:**
- Entry prices are tracked per asset per chain (e.g., `BTC_Ethereum` vs `BTC_Arbitrum`)
- For assets you already owned before enabling this feature, manually set the entry price for accurate PnL
- Hyperliquid and Lighter positions use their native entry price data (not localStorage)

## Troubleshooting

### NFTs not showing
1. Add OpenSea API key in settings
2. Check browser console for errors
3. Verify wallet address is correct

### Positions not updating
1. Check refresh interval setting
2. Force refresh by clicking `[SAVE]` in settings
3. Check browser console for API errors

### PnL showing incorrect values
1. Check entry prices: `walletPnLUtils.viewEntryPrices()`
2. For existing holdings, manually set your purchase price
3. If you transferred assets between chains, reset and re-track the entry price

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
