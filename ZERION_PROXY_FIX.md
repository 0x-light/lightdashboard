# Zerion CORS Fix

## The Problem
Zerion API blocks browser requests from production domains. They only allow:
- `localhost`
- `127.0.0.1`
- `*.local` domains

## The Solution
Added a backend proxy (`/api/zerion`) that:
1. Accepts requests from your frontend
2. Adds Zerion API authentication
3. Forwards to Zerion API
4. Returns data with CORS headers

## How It Works

### Development (localhost)
- Direct calls to `https://api.zerion.io/v1/...`
- No proxy needed

### Production (your domain)
- Calls go to `/api/zerion?apiKey=...&path=...&currency=usd`
- Cloudflare Function proxies to Zerion
- Returns data with CORS headers

## Deployment

### Cloudflare Pages (Automatic)
The `functions/api/zerion.js` file is automatically deployed as a Cloudflare Function.

### Other Platforms
If you're not using Cloudflare, you need to:
1. Create a backend endpoint at `/api/zerion`
2. Use the same logic from `functions/api/zerion.js`
3. Deploy it alongside your frontend

## Testing

### Clear Cache First
Visit `/diagnose.html` and click "FORCE CLEAR EVERYTHING"

### Test in Development
```bash
cd /Users/light/Documents/code/lightdashboard
npm run dev
```
Should work without proxy (direct Zerion API calls).

### Test in Production
Deploy and visit your domain. Should automatically use the proxy.

### Debug
Visit `/diagnose.html` and:
1. Check service workers
2. Test Zerion API direct
3. Clear everything if needed

## Alternative: Whitelist Your Domain
Email `api@zerion.io` to whitelist your production domain for CORS.

Include:
- Your API key
- Your production domain
- Request CORS enablement

**Note**: Using a proxy is more secure as it hides your API key from the frontend.

