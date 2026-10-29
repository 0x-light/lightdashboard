// Ambient effects (lazy-loaded): small touches that follow the real world.
//   Sky       wind slants the rain, stars every night (more at a new moon)
//   Market    stock rows dim while their exchange is closed (New York, Europe, London)
//   Calendar  Halloween week (Oct 25-31) and Christmas week (Dec 19-26) wear their
//             theme. The themes, however chosen, bring lights on the rules, and bats
//             (Halloween) or snow (Christmas).
//             Fireworks in the first hour of the year.
//   Touch     the rain follows the phone's tilt
// Each effect follows the world. Two are settings: Positions > Dim closed markets
// (`dimClosedMarkets`) and Appearance > Seasonal themes (`seasonalThemes`). For testing,
// `ambient.set(id, 'on' | 'off' | 'auto')` in the console forces one until the next
// reload. Rain and snow themselves stay in rain.js.
import { fetchForecast } from './weather.js';

const STORAGE_KEY = 'myDashboardSettings.v2';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export const EFFECTS = [
  { id: 'wind' },
  { id: 'stars' },
  { id: 'closed', setting: 'dimClosedMarkets' },
  { id: 'halloween', setting: 'seasonalThemes' },
  { id: 'christmas', setting: 'seasonalThemes' },
  { id: 'newyear' },
  { id: 'tilt' }
];

const MODES = ['auto', 'on', 'off'];

let modes = {}; // id -> 'auto' | 'on' | 'off', set from the console for testing
const auto = {}; // id -> what the world says
const running = {}; // id -> started
let sky = null; // the latest Open-Meteo answer
let initialized = false;

const rain = () => window.AppModules?.features?.rain;

// ── Settings ──

function readSettings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}

const modeOf = (id) => (MODES.includes(modes[id]) ? modes[id] : 'auto');
// An effect with a setting runs on Auto only while that setting is on (the default)
const allowed = (id, settings) => {
  const key = EFFECTS.find(e => e.id === id)?.setting;
  return !key || settings[key] !== false;
};
const isOn = (id, settings = readSettings()) =>
  modeOf(id) === 'on' || (modeOf(id) === 'auto' && !!auto[id] && allowed(id, settings));

// ── Theme colours, read once and again only after the theme changes ──

let colors = new Map();

function themeColor(name, fallback) {
  if (!colors.has(name)) colors.set(name, getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  return colors.get(name) || fallback;
}

// ── The world ──

function moonIllumination(date = new Date()) {
  const days = (date - new Date('2000-01-06T00:00:00Z')) / 86400000;
  const phase = (days % 29.53058867) / 29.53058867;
  return (1 - Math.cos(phase * 2 * Math.PI)) / 2;
}

async function fetchSky() {
  const w = readSettings().weather;
  const isCoord = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  if (!isCoord(w?.lat) || !isCoord(w?.lon)) return null;
  // The same request as the weather line and the rain (sunrise and sunset in unix seconds)
  try {
    return await fetchForecast(w.lat, w.lon, 8000);
  } catch (_) {
    return null;
  }
}

// Wind as rain slope: pixels across per pixel down. Open-Meteo gives the direction the wind
// comes from; on screen east is right, so a west wind pushes the rain right.
function windSlope() {
  const speed = Number(sky?.current?.wind_speed_10m) || 0;
  const from = Number(sky?.current?.wind_direction_10m);
  const across = Number.isFinite(from) ? -Math.sin(from * Math.PI / 180) : 1;
  const sign = across < 0 ? -1 : 1;
  const strength = Math.min(1.2, speed / 45);
  // Forced on in calm air: a steady breeze from the west, so there is something to see
  return modeOf('wind') === 'on' && strength < 0.25 ? 0.5 * sign : strength * sign;
}

// Regular hours on trading days: NYSE 9:30-16:00 New York, Xetra and Euronext 9:00-17:30
// Frankfurt, LSE 8:00-16:30 London. Only NYSE's holidays are listed.
const EXCHANGES = {
  us: { zone: 'America/New_York', open: 570, close: 960 },
  eu: { zone: 'Europe/Berlin', open: 540, close: 1050 },
  uk: { zone: 'Europe/London', open: 480, close: 990 }
};

const NYSE_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19',
  '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18',
  '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24'
]);

function exchangeOpen(market, now = new Date()) {
  const { zone, open, close } = EXCHANGES[market];
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, weekday: 'short', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(p => [p.type, p.value]));
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;
  if (market === 'us' && NYSE_HOLIDAYS.has(`${parts.year}-${parts.month}-${parts.day}`)) return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= open && minutes < close;
}

// Which exchanges are closed now; turned on by hand, all of them
function markClosedExchanges(now) {
  for (const market of Object.keys(EXCHANGES)) {
    const closed = modeOf('closed') === 'on' || !exchangeOpen(market, now);
    document.documentElement.classList.toggle(`ambient-closed-${market}`, closed);
  }
}

function readWorld(now = new Date()) {
  const c = sky?.current;
  const t = now.getTime() / 1000;
  const sunrise = Number(sky?.daily?.sunrise?.[0]);
  const sunset = Number(sky?.daily?.sunset?.[0]);
  const hasSun = Number.isFinite(sunrise) && Number.isFinite(sunset);
  const hour = now.getHours();
  const night = hasSun ? (t < sunrise || t > sunset) : c ? c.is_day === 0 : (hour < 6 || hour >= 20);

  auto.wind = !!c && (Number(c.wind_speed_10m) || 0) >= 8;
  auto.stars = night;

  markClosedExchanges(now);
  auto.closed = Object.keys(EXCHANGES).some(market => !exchangeOpen(market, now));

  const month = now.getMonth();
  const day = now.getDate();
  auto.halloween = month === 9 && day >= 25;
  auto.christmas = month === 11 && day >= 19 && day <= 26;
  auto.newyear = month === 0 && day === 1 && now.getHours() === 0;

  // Tilt needs no question only on phones that don't ask (iPhones ask; choose On there)
  auto.tilt = 'DeviceOrientationEvent' in window && typeof DeviceOrientationEvent.requestPermission !== 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
}

// ── Overlays ──

let canvas = null;
let ctx = null;
let frame = null; // the next animation frame
let timer = null; // the wait before it

function setupOverlays() {
  canvas = document.createElement('canvas');
  canvas.id = 'ambientCanvas';
  canvas.className = 'ambient-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  const size = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (running.stars) makeStars();
    if (!frame && !timer) drawCanvas();
  };
  size();
  window.addEventListener('resize', size);

}

// ── Canvas layers: stars, bats, fireworks ──

let stars = [];
let bats = [];
let sparks = [];
let nextRocket = 0;

function makeStars() {
  const count = Math.round(60 + 120 * (1 - moonIllumination()));
  const band = canvas.height * 0.6;
  stars = Array.from({ length: count }, () => {
    const y = Math.random() ** 1.6 * band;
    return {
      x: Math.floor(Math.random() * canvas.width),
      y: Math.floor(y),
      b: Math.random(),
      phase: Math.random() * Math.PI * 2,
      speed: 0.01 + Math.random() * 0.03,
      fade: 1 - y / band
    };
  });
}

function drawStars(color, dt) {
  ctx.fillStyle = color;
  for (const s of stars) {
    s.phase += s.speed * dt;
    ctx.globalAlpha = (0.6 + 0.4 * s.b) * (0.75 + 0.25 * Math.sin(s.phase)) * (0.5 + 0.5 * s.fade);
    const size = s.b > 0.6 ? 2 : 1;
    ctx.fillRect(s.x, s.y, size, size);
    if (s.b > 0.9) {
      ctx.globalAlpha *= 0.6;
      ctx.fillRect(s.x - 1, s.y, 1, size);
      ctx.fillRect(s.x + size, s.y, 1, size);
      ctx.fillRect(s.x, s.y - 1, size, 1);
      ctx.fillRect(s.x, s.y + size, size, 1);
    }
  }
  ctx.globalAlpha = 1;
}

// Two-frame bat, wings up and down, drawn at 2px per pixel
const BAT_FRAMES = [
  ['X.......X', 'XX.....XX', '.XXX.XXX.', '...XXX...'],
  ['.........', '...X.X...', '.XXXXXXX.', 'XX..X..XX']
];

function makeBat(fromEdge = true) {
  const dir = Math.random() < 0.5 ? 1 : -1;
  return {
    x: fromEdge ? (dir > 0 ? -30 : canvas.width + 30) : Math.random() * canvas.width,
    y: 30 + Math.random() * canvas.height * 0.5,
    vx: dir * (0.8 + Math.random() * 1.2),
    t: Math.random() * 100,
    amp: 6 + Math.random() * 14
  };
}

function drawBats(color, dt) {
  ctx.fillStyle = color;
  for (let i = 0; i < bats.length; i++) {
    const bat = bats[i];
    bat.t += dt;
    bat.x += bat.vx * dt;
    const y = bat.y + Math.sin(bat.t / 18) * bat.amp;
    // The wings beat once per drawn frame; from the clock they would stutter at 12 fps
    bat.wing = 1 - (bat.wing || 0);
    const rows = BAT_FRAMES[bat.wing];
    const x0 = Math.floor(bat.x);
    const y0 = Math.floor(y);
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        if (row[c] === 'X') ctx.fillRect(x0 + c * 2, y0 + r * 2, 2, 2);
      }
    });
    if (bat.x < -40 || bat.x > canvas.width + 40) bats[i] = makeBat();
  }
}

function drawFireworks(palette, now, dt) {
  if (now > nextRocket) {
    nextRocket = now + 700 + Math.random() * 1100;
    sparks.push({
      rocket: true,
      x: canvas.width * (0.15 + Math.random() * 0.7),
      y: canvas.height,
      vx: (Math.random() - 0.5) * 0.6,
      vy: -(6 + Math.random() * 3),
      color: palette[Math.floor(Math.random() * palette.length)]
    });
  }
  const next = [];
  for (const p of sparks) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.rocket) {
      p.vy += 0.09 * dt;
      if (p.vy >= -1) {
        // Burst: a ring of sparks in the rocket's colour
        const n = 36 + Math.floor(Math.random() * 20);
        const speed = 1.6 + Math.random() * 1.6;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const v = speed * (0.7 + Math.random() * 0.3);
          next.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, color: p.color });
        }
        continue;
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 2, 3);
      next.push(p);
      continue;
    }
    p.vy += 0.035 * dt;
    p.vx *= 0.985 ** dt;
    p.life -= 0.012 * dt;
    if (p.life <= 0) continue;
    ctx.globalAlpha = Math.min(1, p.life * 1.4);
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 2, 2);
    next.push(p);
  }
  sparks = next;
  ctx.globalAlpha = 1;
}

// Motion is in 60 Hz frames; dt keeps it the same speed at any frame rate. Stars and bats are
// pixel art and draw 12 times a second; fireworks need 30. A late frame moves at most 10.
const STEP_MS = 1000 / 12;
const FIREWORKS_STEP_MS = 1000 / 30;
const MAX_DT = 10;
let lastDraw = 0;

function drawCanvas() {
  frame = null;
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const layers = running.stars || bats.length > 0 || running.newyear;
  canvas.classList.toggle('active', !!layers);
  document.documentElement.classList.toggle('ambient-canvas-on', !!layers);
  if (!layers) return;
  const now = performance.now();
  const dt = lastDraw ? Math.min(MAX_DT, (now - lastDraw) / (1000 / 60)) : 1;
  lastDraw = now;
  if (running.stars) drawStars(themeColor('--text-bright', themeColor('--text', '#fff')), dt);
  if (bats.length) drawBats(themeColor('--text', '#888'), dt);
  if (running.newyear && !reducedMotion.matches) {
    const palette = ['--accent', '--green', '--red', '--yellow', '--cyan', '--orange', '--text-bright']
      .map(name => themeColor(name, '')).filter(Boolean);
    drawFireworks(palette, now, dt);
  }
  if (reducedMotion.matches || document.hidden) return;
  // Wait out the rest of the step, then draw on the next frame
  const step = running.newyear ? FIREWORKS_STEP_MS : STEP_MS;
  const wait = Math.max(0, step - (performance.now() - now));
  timer = setTimeout(() => { timer = null; frame = requestAnimationFrame(drawCanvas); }, wait);
}

function wakeCanvas() {
  if (frame) cancelAnimationFrame(frame);
  clearTimeout(timer);
  frame = null;
  timer = null;
  lastDraw = 0;
  drawCanvas();
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && initialized) wakeCanvas(); });

// ── The seasonal themes' extras ──
// With the Christmas or Halloween theme on (picked, or worn for the week): bulbs hang on
// the portfolio box's top line and the positions table's top line, with gaps where a title
// sits on the line (colours and blinking are in CSS). Halloween adds bats; Christmas
// snows, and stops the snow it started when the theme goes.

const SEASON_THEMES = new Set(['christmas', 'halloween']);
let christmasSnow = false;

function syncSeason() {
  const theme = document.documentElement.dataset.theme;
  const seasonal = SEASON_THEMES.has(theme);
  const hung = !!document.querySelector('.season-lights');
  if (seasonal && !hung) hangLights();
  else if (!seasonal && hung) takeDownLights();

  if (theme === 'halloween' && !bats.length) {
    bats = Array.from({ length: 7 }, () => makeBat(false));
    wakeCanvas();
  } else if (theme !== 'halloween' && bats.length) {
    bats = [];
    wakeCanvas();
  }

  const r = rain();
  if (!r?.state) return;
  if (theme === 'christmas' && !r.state().snow) {
    r.toggleSnow();
    christmasSnow = true;
    setSnowLabels(true);
  } else if (theme !== 'christmas' && christmasSnow) {
    if (r.state().snow) {
      r.toggleSnow();
      setSnowLabels(false);
    }
    christmasSnow = false;
  }
}

const BULB_GAP = 26;
let lightsObserver = null;
let lightsFrame = null;

function hangLights() {
  takeDownLights(false);
  const spots = [];
  const card = document.querySelector('.pm-card');
  if (card) spots.push({ box: card, inside: true, avoid: card.querySelectorAll('.pm-card__title, .pm-card__meta') });
  const table = document.querySelector('#positionsSection .table-wrapper');
  if (table) spots.push({ box: table, inside: false, avoid: [] });
  for (const { box, inside, avoid } of spots) {
    const string = document.createElement('div');
    string.className = `season-lights ${inside ? 'season-lights--card' : 'season-lights--table'}`;
    string.setAttribute('aria-hidden', 'true');
    const left = box.getBoundingClientRect().left;
    const gaps = Array.from(avoid, el => {
      const r = el.getBoundingClientRect();
      return [r.left - left - 10, r.right - left + 10];
    });
    const width = box.clientWidth;
    for (let x = 12; x < width - 8; x += BULB_GAP) {
      if (gaps.some(([a, b]) => x > a && x < b)) continue;
      const bulb = document.createElement('span');
      bulb.className = 'season-bulb';
      bulb.style.left = `${x}px`;
      string.appendChild(bulb);
    }
    if (inside) {
      box.appendChild(string);
    } else {
      // Placed before the table, then moved down onto its top line (the table has a margin)
      box.before(string);
      const line = (box.querySelector('table') || box).getBoundingClientRect().top;
      string.style.top = `${line - string.getBoundingClientRect().top}px`;
    }
  }
  // Hung again when a box or a label it avoids changes width, e.g. when the offline note
  // appears beside the time (the observer also reports each element once at the start)
  const watched = spots.flatMap(({ box, avoid }) => [box, ...avoid]);
  const widths = new Map(watched.map(el => [el, el.clientWidth]));
  lightsObserver = new ResizeObserver(entries => {
    if (entries.every(e => widths.get(e.target) === e.target.clientWidth)) return;
    cancelAnimationFrame(lightsFrame);
    lightsFrame = requestAnimationFrame(hangLights);
  });
  watched.forEach(el => lightsObserver.observe(el));
}

function takeDownLights(all = true) {
  lightsObserver?.disconnect();
  lightsObserver = null;
  document.querySelectorAll('.season-lights').forEach(el => el.remove());
  if (all) cancelAnimationFrame(lightsFrame);
}

// ── Starting and stopping each effect ──

function setSnowLabels(on) {
  const html = `Snow <span class="pm-theme-current">${on ? 'on' : 'off'}</span>`;
  ['newToggleSnowBtn', 'newToggleSnowBtnMobile'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.innerHTML = html;
  });
  if (on) {
    ['newToggleRainBtn', 'newToggleRainBtnMobile'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.innerHTML = 'Rain <span class="pm-theme-current">off</span>';
    });
  }
}

// A season wears its theme for its week; the theme you chose comes back after. Nothing is
// saved, so the theme picker keeps your own.
let themeBefore = null;

function wearTheme(name) {
  const html = document.documentElement;
  // index.html puts the season's theme on before the first frame; yours is window.pmOwnTheme
  if (themeBefore === null) themeBefore = (html.dataset.theme === name ? window.pmOwnTheme : html.dataset.theme) || '';
  if (html.dataset.theme !== name) setTheme(name);
}

function takeOffTheme(name) {
  if (themeBefore !== null && document.documentElement.dataset.theme === name) setTheme(themeBefore);
  themeBefore = null;
  // Both seasons on by hand: the other one keeps its theme
  ['halloween', 'christmas'].forEach(season => { if (running[season]) wearTheme(season); });
}

function setTheme(name) {
  const themes = window.AppModules?.core?.themes;
  if (themes?.applyTheme) themes.applyTheme(name);
  else document.documentElement.dataset.theme = name;
}
let tiltHandler = null;

const EFFECT_HANDLERS = {
  wind: {
    start: () => rain()?.setWind?.(windSlope()),
    stop: () => rain()?.setWind?.(0),
    refresh: () => rain()?.setWind?.(windSlope())
  },
  stars: { start: () => { makeStars(); wakeCanvas(); }, stop: wakeCanvas },
  closed: { className: 'ambient-markets-closed' },
  halloween: { start: () => wearTheme('halloween'), stop: () => takeOffTheme('halloween') },
  christmas: { start: () => wearTheme('christmas'), stop: () => takeOffTheme('christmas') },
  newyear: { start: () => { sparks = []; nextRocket = 0; wakeCanvas(); }, stop: () => { sparks = []; wakeCanvas(); } },
  tilt: {
    start: () => {
      tiltHandler = (e) => {
        const angle = screen.orientation?.angle ?? window.orientation ?? 0;
        // Sideways tilt is gamma held upright, beta held on its side
        const lean = angle === 90 ? e.beta : (angle === -90 || angle === 270) ? -e.beta : e.gamma;
        if (Number.isFinite(lean)) rain()?.setTilt?.(Math.max(-1.4, Math.min(1.4, lean / 35)));
      };
      window.addEventListener('deviceorientation', tiltHandler);
    },
    stop: () => {
      if (tiltHandler) window.removeEventListener('deviceorientation', tiltHandler);
      tiltHandler = null;
      rain()?.setTilt?.(0);
    }
  }
};

function apply() {
  const settings = readSettings();
  for (const { id } of EFFECTS) {
    const h = EFFECT_HANDLERS[id];
    const want = isOn(id, settings);
    if (want === !!running[id]) {
      if (want) h.refresh?.();
      continue;
    }
    running[id] = want;
    if (h.className) document.documentElement.classList.toggle(h.className, want);
    (want ? h.start : h.stop)?.();
  }
}

// For testing from the console: a new choice starts the effect over, kept until reload
function setMode(id, mode) {
  if (!EFFECT_HANDLERS[id]) return;
  modes[id] = mode;
  if (running[id]) {
    const h = EFFECT_HANDLERS[id];
    running[id] = false;
    if (h.className) document.documentElement.classList.remove(h.className);
    h.stop?.();
  }
  if (id === 'closed') readWorld();
  apply();
}

// ── Start ──

export async function init() {
  if (initialized) return;
  initialized = true;
  setupOverlays();
  // Lights, bats and snow follow the theme, however it was chosen
  new MutationObserver(syncSeason).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  // Colours are read again after a theme change (a still frame is drawn again in them)
  new MutationObserver(() => {
    colors = new Map();
    if (!frame && !timer) drawCanvas();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  syncSeason();
  readWorld();
  apply();

  sky = await fetchSky();
  readWorld();
  apply();

  // The clock: nights, market hours and dates move on their own
  setInterval(() => { readWorld(); apply(); }, 30 * 1000);
  setInterval(async () => { sky = await fetchSky() || sky; readWorld(); apply(); }, 15 * 60 * 1000);

  window.ambient = {
    // Settings changed (settings-dialog.js calls this)
    refresh: () => { readWorld(); apply(); },
    set: setMode,
    state: () => Object.fromEntries(EFFECTS.map(({ id }) => [id, { mode: modeOf(id), auto: !!auto[id], on: !!running[id] }])),
    sky: () => sky
  };
}

export default { init, EFFECTS };
