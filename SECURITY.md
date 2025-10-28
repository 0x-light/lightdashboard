# Security & Privacy

All data is stored locally in your browser. Nothing is sent to external servers except necessary API calls to fetch your positions.

## Data Storage

Everything is stored in your browser's localStorage:
- Wallet addresses (Base64 encrypted)
- API keys (Base64 encrypted)
- UI preferences
- Manual positions
- Weather location

The encryption prevents casual inspection but is not cryptographically secure. Keep your device secure and do not share your browser profile.

## External API Calls

Your wallet addresses are sent only to blockchain APIs that fetch your positions. All calls use HTTPS.

**Hyperliquid API** - Perpetual and spot positions
**Lighter API** - Lighter positions  
**OpenSea API** - NFT holdings and floor prices
**CoinGecko API** - Cryptocurrency prices (public data, no personal information sent)
**Open-Meteo API** - Weather data (only if enabled)
**BigDataCloud** - Reverse geocoding (only when clicking "Use My Location")
**GoComics** - Comic strips (only if enabled)

CoinGecko calls are rate limited to 1.5 seconds between requests with one minute caching.

## What We Do Not Do

No analytics. No tracking. No cookies. No user accounts. No server-side storage. No data collection. No third-party scripts. No telemetry.

We do not know who uses this dashboard.

## Best Practices

Access the dashboard over HTTPS. Use a password-protected browser profile. Keep your OpenSea API key private. Use browser DevTools to verify network activity.

## Compliance

All data processing occurs locally in your browser. We do not process, collect, or store any personal data. You can self-host for complete control.

## Security Issues

Report security vulnerabilities privately to the maintainer. Do not open public issues for security problems.

