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
    endDate: new Date('1995-01-01'),
    imageSelector: '.card__image img'
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
  
  // Use proxy for CORS - fetch as text not JSON
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
  try {
    const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const html = await response.text();
    if (!html) return null;
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const img = doc.querySelector(comic.imageSelector);
    if (img && img.src) return img.src;
    return null;
  } catch (_) {
    return null;
  }
}

export async function renderComic(container, comicKey = 'calvinandhobbes', date = new Date()) {
  if (!container) return;
  const src = await fetchComicImage(comicKey, date);
  if (src) {
    container.innerHTML = `<img src="${src}" alt="${METADATA[comicKey]?.name || 'Comic'}" style="max-width: 100%; height: auto;">`;
  } else {
    const comic = METADATA[comicKey];
    const dateStr = formatDate(date);
    const url = `${comic.baseUrl}/${dateStr}`;
    container.innerHTML = `<div class="help">Comic unavailable. Requires <code>npm run dev:pages</code> for /api/proxy. <a href="${url}" target="_blank" class="external-link">View online ↗</a></div>`;
  }
}

export default { fetchComicImage, renderComic };

