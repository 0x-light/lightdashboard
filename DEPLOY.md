# Production Deployment Guide

This guide will help you deploy the Light Dashboard for optimal performance and security.

## 🚀 Quick Start

### Option 1: Static Hosting (Recommended)

Deploy to any static hosting service:

- **Vercel**: `vercel --prod`
- **Netlify**: Drag & drop the directory
- **GitHub Pages**: Push to `gh-pages` branch
- **Cloudflare Pages**: Connect your repo

### Option 2: Self-Hosting

1. **Apache**: Copy files to web root, use included `.htaccess`
2. **Nginx**: Use the `nginx.conf` example below
3. **Any HTTP Server**: Serve static files, enable compression

## ⚡ Performance Optimizations

### Built-In Optimizations

The dashboard includes these production-ready optimizations:

✅ **Service Worker** - Offline support & aggressive API caching
✅ **Intelligent Retry Logic** - Auto-retry failed API calls with exponential backoff
✅ **Performance Monitoring** - Track API calls and render times (use `getDashboardPerf()` in console)
✅ **Request Batching** - Parallel API calls with smart debouncing
✅ **DOM Update Batching** - requestAnimationFrame for smooth 60fps rendering
✅ **Aggressive Caching** - CoinGecko (5min), Pyth feeds (30min), Settings (10s)
✅ **Tab Visibility Check** - Pause updates when tab is inactive
✅ **CSS Containment** - Optimized layout and paint performance
✅ **Preconnect Hints** - Faster API connections

### Recommended Server Configuration

#### Nginx

```nginx
# /etc/nginx/sites-available/dashboard

server {
    listen 443 ssl http2;
    server_name yourdomain.com;
    
    # SSL configuration
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    root /var/www/dashboard;
    index index.html;
    
    # Compression
    gzip on;
    gzip_vary on;
    gzip_types text/plain text/css text/javascript application/javascript application/json image/svg+xml;
    gzip_min_length 1000;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$ {
        expires 1M;
        add_header Cache-Control "public, immutable";
    }
    
    # Don't cache service worker
    location = /sw.js {
        expires off;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
    
    # HTML with short cache
    location / {
        expires 1h;
        try_files $uri $uri/ /index.html;
    }
}
```

#### Apache

The included `.htaccess` file provides:
- Gzip compression for all text assets
- Cache headers for optimal performance
- Security headers (HSTS, X-Frame-Options, CSP)
- Service Worker no-cache policy

## 🔒 Security Checklist

- [ ] Enable HTTPS (required for service workers)
- [ ] Configure Content Security Policy (CSP)
- [ ] Enable HSTS (Strict-Transport-Security)
- [ ] Set X-Frame-Options to prevent clickjacking
- [ ] Enable X-Content-Type-Options (nosniff)
- [ ] Configure firewall to allow only HTTP/HTTPS
- [ ] Review API keys and ensure they're encrypted in localStorage
- [ ] Use environment-specific API endpoints if needed

## 📊 Performance Monitoring

### Check Performance Metrics

Open browser console and run:

```javascript
getDashboardPerf()
```

This returns:
- **uptime**: How long the app has been running
- **apiCalls**: Stats for each API endpoint (calls, avg/max/min response time)
- **renders**: Stats for UI render operations

### Performance Targets

- **First Contentful Paint (FCP)**: < 1.5s
- **Time to Interactive (TTI)**: < 3.5s
- **Largest Contentful Paint (LCP)**: < 2.5s
- **API Response Times**: < 500ms average
- **UI Render Time**: < 16ms (60fps)

### Tools

- **Lighthouse**: Run in Chrome DevTools for comprehensive audit
- **WebPageTest**: https://www.webpagetest.org/
- **Chrome DevTools Performance**: Record and analyze runtime performance

## 🌐 CDN Configuration

### Cloudflare (Recommended)

1. Add your domain to Cloudflare
2. Enable these features:
   - **Auto Minify**: JS, CSS, HTML
   - **Brotli**: Better compression than gzip
   - **HTTP/2 & HTTP/3**: Faster protocol
   - **Caching Level**: Standard
   - **Browser Cache TTL**: Respect existing headers

3. Create Page Rules:
   ```
   yourdomain.com/sw.js
   - Cache Level: Bypass
   
   yourdomain.com/*.js
   - Cache Level: Cache Everything
   - Edge Cache TTL: 1 week
   
   yourdomain.com/*.css
   - Cache Level: Cache Everything
   - Edge Cache TTL: 1 week
   ```

## 🐛 Debugging

### Common Issues

**1. Service Worker not registering**
- Check HTTPS is enabled (required)
- Verify `/sw.js` is accessible
- Check browser console for errors

**2. Slow API responses**
- Check `getDashboardPerf()` for slow endpoints
- Verify network connectivity
- Check API rate limits

**3. Data not persisting**
- Verify localStorage is enabled
- Check browser storage limits (usually 5-10MB)
- Clear cache and reload if corrupted

### Debug Mode

Enable verbose logging by adding to URL:
```
?debug=true
```

## 📦 Minification (Optional)

For production, minify assets:

```bash
# Install terser and csso-cli
npm install -g terser csso-cli

# Minify JavaScript
terser script.js -c -m -o script.min.js

# Minify CSS
csso styles.css -o styles.min.css

# Update index.html to reference minified files
```

## 🚢 Deployment Checklist

- [ ] Test locally with production build
- [ ] Run Lighthouse audit (score > 90)
- [ ] Verify all API keys are encrypted
- [ ] Test offline functionality (service worker)
- [ ] Check mobile responsiveness
- [ ] Verify HTTPS and security headers
- [ ] Test with real wallet addresses
- [ ] Monitor performance with `getDashboardPerf()`
- [ ] Set up error tracking (optional)
- [ ] Document any custom API endpoints

## 🎯 Optimization Tips

1. **Reduce API Calls**: Configure longer cache durations if real-time updates aren't critical
2. **Lazy Load Images**: If adding logos/icons, use lazy loading
3. **Code Splitting**: For very large deployments, split script.js by feature
4. **Service Worker Caching**: Tune cache durations in `sw.js` based on your needs
5. **Monitor Bundle Size**: Keep total JS < 200KB for fast loading

## 📞 Support

- Check `SECURITY.md` for security best practices
- Review browser console for errors
- Use `getDashboardPerf()` to diagnose slow operations
- Check service worker status in DevTools → Application → Service Workers

---

**Ready for production!** 🎉

For updates and contributions, see the main README.

