// Comics feature (lazy-loaded)
import { HttpClient } from '../http/client.js';

const METADATA = {
  calvinandhobbes: {
    name: 'Calvin & Hobbes',
    baseUrl: 'https://www.gocomics.com/calvinandhobbes',
    startDate: new Date('1985-11-18'),
    endDate: new Date('1995-12-31'),
    imageSelector: 'picture.item-comic-image img'
  },
  peanuts: {
    name: 'Peanuts',
    baseUrl: 'https://www.gocomics.com/peanuts',
    startDate: new Date('1950-10-02'),
    endDate: new Date('2000-02-13'),
    imageSelector: 'picture.item-comic-image img'
  },
  farside: {
    name: 'The Far Side',
    baseUrl: 'https://www.thefarside.com',
    startDate: new Date('1980-01-01'),
    endDate: new Date('1994-12-31'),
    imageSelector: '.card__image img, .figure-image img'
  }
};

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

export async function fetchComicImage(comicKey, date = new Date()) {
  const comic = METADATA[comicKey];
  if (!comic) return null;
  const dateStr = formatDate(date);
  const url = `${comic.baseUrl}/${dateStr}`;

  // Add cache-busting timestamp to prevent proxy caching
  const cacheBuster = Date.now();
  const urlWithCacheBuster = `${url}?_=${cacheBuster}`;

  // Try multiple CORS proxies in order
  const proxies = [
    // Cloudflare Functions (production only) - skip on localhost to avoid 404s
    ...(window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
      ? [`/api/proxy?url=${encodeURIComponent(urlWithCacheBuster)}`]
      : []),
    `https://api.allorigins.win/raw?url=${encodeURIComponent(urlWithCacheBuster)}`, // Public CORS proxy
    `https://corsproxy.io/?${encodeURIComponent(urlWithCacheBuster)}` // Alternative public CORS proxy
  ];

  for (const proxyUrl of proxies) {
    try {
      const response = await fetch(proxyUrl, {
        signal: AbortSignal.timeout(10000),
        cache: 'no-store'
      });
      if (response.ok) {
        const html = await response.text();
        if (html && html.length > 100) {
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');

          let imgSrc = null;
          let caption = null;

          // Special handling for The Far Side
          if (comicKey === 'farside') {
            // Method 1: Look for images from amuniversal CDN in all img tag attributes
            const allImages = doc.querySelectorAll('img');
            const attributes = ['src', 'data-src', 'data-lazy-src', 'srcset', 'data-srcset'];

            for (const img of allImages) {
              for (const attr of attributes) {
                const value = img.getAttribute(attr);
                if (value && value.includes('featureassets.amuniversal.com')) {
                  // Handle srcset format (multiple URLs separated by commas)
                  imgSrc = value.split(',')[0].split(' ')[0];
                  break;
                }
              }
              if (imgSrc) break;
            }

            // Method 2: Search raw HTML for amuniversal URLs (fallback)
            if (!imgSrc) {
              const match = html.match(/https?:\/\/featureassets\.amuniversal\.com\/[^\s"'<>]+/);
              if (match) {
                imgSrc = match[0];
              }
            }

            // Try to get caption
            const farsideCaption = doc.querySelector('.figure-caption, figcaption');
            if (farsideCaption) {
              caption = farsideCaption.textContent.trim();
            }
          } else {
            // Method 1: Try og:image meta tag first (most reliable for GoComics)
            const ogImage = doc.querySelector('meta[property="og:image"]');
            if (ogImage) {
              imgSrc = ogImage.getAttribute('content');
            }

            // Method 2: Try multiple image selectors
            if (!imgSrc) {
              const selectors = [
                '.comic.img-fluid',
                'picture img',
                '.item-comic-image img',
                comic.imageSelector,
                'img[alt*="comic" i]'
              ];

              for (const selector of selectors) {
                const img = doc.querySelector(selector);
                if (img) {
                  imgSrc = img.getAttribute('src') || img.getAttribute('data-src') || img.src;
                  if (imgSrc) {
                    break;
                  }
                }
              }
            }
          }

          if (imgSrc) {
            // Handle relative URLs
            if (imgSrc.startsWith('//')) {
              imgSrc = 'https:' + imgSrc;
            } else if (imgSrc.startsWith('/')) {
              if (comicKey === 'farside') {
                imgSrc = 'https://www.thefarside.com' + imgSrc;
              } else {
                imgSrc = 'https://www.gocomics.com' + imgSrc;
              }
            }
            return { src: imgSrc, caption };
          }
        }
      }
    } catch (e) {
      continue;
    }
  }

  return null;
}

export async function renderComic(container, comicKey = 'calvinandhobbes', date = new Date()) {
  if (!container) return;

  const comic = METADATA[comicKey];
  if (!comic) {
    console.error(`[Comics] Invalid comic key: ${comicKey}`);
    container.textContent = 'Error: Invalid comic';
    return;
  }

  const dateStr = formatDate(date);
  const url = `${comic.baseUrl}/${dateStr}`;

  // Show loading message and add fading animation
  container.innerHTML = '<div style="text-align: center; padding: 10px 0;">Loading...</div>';
  container.classList.add('fading');

  const result = await fetchComicImage(comicKey, date);

  if (result && result.src) {
    const isFarSide = comicKey === 'farside';
    const isMobile = window.innerWidth <= 768;

    // Mobile only: set horizontal scroll on container for non-Far Side comics
    if (!isFarSide && isMobile) {
      container.style.overflowX = 'auto';
      container.style.overflowY = 'hidden';
      container.style.webkitOverflowScrolling = 'touch';
    } else {
      container.style.overflowX = '';
      container.style.overflowY = '';
    }

    // Successfully fetched comic image
    let html = `<img src="${result.src}" alt="${comic.name}" data-comic-type="${comicKey}">`;

    // Add caption if available (for The Far Side)
    if (result.caption) {
      html += `<div style="font-style: italic; text-align: center; opacity: 0.8; margin-top: 8px;">${result.caption}</div>`;
    }

    container.innerHTML = html;

    // Remove fading animation after new image is inserted
    setTimeout(() => {
      container.classList.remove('fading');
    }, 100);
  } else {
    // Fallback: link to view online with retry option
    container.innerHTML = `
      <div class="help" style="text-align: center; padding: 20px;">
        <p id="retryComicText" style="cursor: pointer; color: var(--accent);">Unable to load comic. Click to retry.</p>
        <p style="font-size: 13px; margin-top: 12px;">
          <a href="${url}" target="_blank" rel="noopener noreferrer" style="color: var(--accent); text-decoration: underline;">View ${comic.name} online ↗</a>
        </p>
      </div>
    `;

    // Remove fading animation
    container.classList.remove('fading');

    // Add retry click event listener
    const retryText = document.getElementById('retryComicText');
    if (retryText) {
      retryText.addEventListener('click', () => renderComic(container, comicKey, date));
    }
  }
}

export function getRandomDate(comicKey) {
  const comic = METADATA[comicKey];
  if (!comic) return new Date();

  const start = comic.startDate.getTime();
  const end = comic.endDate.getTime();
  const randomTime = start + Math.random() * (end - start);
  return new Date(randomTime);
}

export default { fetchComicImage, renderComic };

