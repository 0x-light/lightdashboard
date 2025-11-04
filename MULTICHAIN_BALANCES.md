# Multi-Chain Balance Fetching

## Overview
The `/new` dashboard supports fetching on-chain token balances across multiple blockchains using a **smart fallback strategy**.

## Supported Providers

### Primary: Zerion
- **Chains**: Ethereum, Arbitrum, Optimism, Polygon, Base, Avalanche, BSC, Solana, zkSync, Blast
- **Features**: Fungible tokens + NFTs with USD pricing
- **API**: `https://api.zerion.io/v1/`
- **Setup**: Add `zerionApiKey` in settings

### Fallback: Alchemy + Helius

#### Alchemy (EVM Chains)
- **Chains**: Ethereum, Arbitrum, Optimism, Polygon, Base, HyperEVM
- **Features**: Native tokens (ETH, MATIC, etc.) + ERC20 tokens
- **API**: `https://{network}.g.alchemy.com/v2/{apiKey}`
- **Setup**: Add `alchemyApiKey` in settings

#### Helius (Solana)
- **Chains**: Solana
- **Features**: SOL + SPL tokens with USD pricing (from Helius)
- **API**: `https://mainnet.helius-rpc.com/?api-key={apiKey}`
- **Setup**: Add `heliusApiKey` + `solanaAddresses` in settings

## How It Works

### Priority Logic
```javascript
1. Try Zerion first (if API key exists)
   ├─ Success? Use Zerion data ✅
   └─ Failed? Continue to step 2 ⚠️

2. Fallback to Alchemy + Helius
   ├─ Fetch EVM tokens from Alchemy (if key exists)
   ├─ Fetch Solana tokens from Helius (if key exists)
   └─ Combine both sources ✅

3. If all fail, show empty positions ❌
```

### Settings Structure
```javascript
{
  // Wallets
  walletAddresses: "0x123...,0x456...",  // EVM addresses (comma-separated)
  solanaAddresses: "ABC...,DEF...",       // Solana addresses (comma-separated)
  
  // API Keys (at least one required)
  zerionApiKey: "zk_dev_...",             // Preferred
  alchemyApiKey: "...",                   // Fallback for EVM
  heliusApiKey: "..."                     // Fallback for Solana
}
```

## Getting API Keys

### Zerion (Free Dev Key)
1. Visit: https://developers.zerion.io/
2. Sign in
3. Generate dev key (zk_dev_...)
4. **Note**: Dev keys work on localhost only. Contact api@zerion.io for production.

### Alchemy (Free Tier)
1. Visit: https://www.alchemy.com/
2. Create account
3. Create app
4. Copy API key

### Helius (Free Tier)
1. Visit: https://www.helius.dev/
2. Create account
3. Create API key
4. Copy key

## Logging

All providers log their activity to the console:

```
[/new] Zerion: Fetching positions and NFTs for 0x...
[/new] Zerion positions: 15 fungible tokens
[/new] Zerion NFTs: 3 items
[/new] Zerion breakdown: 15 fungible tokens, 3 NFTs
[/new] ✅ Using Zerion as primary data source

# OR if Zerion fails:

[/new] Zerion error: Failed to fetch
[/new] ⚠️ Zerion unavailable, falling back to Alchemy + Helius
[/new] Alchemy returned 12 tokens
[/new] Helius returned 5 tokens
[/new] ✅ Fallback providers returned 17 total tokens
```

## Troubleshooting

### Zerion shows red indicator in health check
- **Dev key**: Only works on localhost
- **Solution**: Use Alchemy + Helius OR contact Zerion for production key

### No balances showing
1. Check Settings → API Keys are configured
2. Check Settings → Wallet addresses are correct
3. Open browser console (F12) and look for `[/new]` logs
4. Verify API keys are valid (test on provider websites)

### Prices showing as $0
- Alchemy/Helius don't provide prices for all tokens
- Solution: App will try to fetch prices from Pyth/CoinGecko for assets without prices

## Performance

- **Zerion**: ~2-3s for 1 wallet (includes NFTs)
- **Alchemy**: ~5-10s for 1 wallet × 6 chains (parallel)
- **Helius**: ~1-2s for 1 wallet
- **Total Fallback**: ~5-10s (Alchemy + Helius in parallel)

## Code Files

- `modules/data/providers/alchemy.js` - Alchemy provider
- `modules/data/providers/helius.js` - Helius provider
- `modules/data/providers/zerion.js` - Zerion provider (with CORS proxy)
- `modules/app-init.js` - Module registration
- `new/app.js` - Fetching logic (lines 187-347)

