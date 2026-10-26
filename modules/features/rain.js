// Rain and Snow effects module
// Simplified version optimized for performance
import { fetchForecast } from './weather.js';

const canvas = document.getElementById('newRainCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;

let drops = [];
let rainActive = false;
let snowActive = false;
let animationFrame = null;
let lastDraw = 0;
let fill = null; // the drops' colour, read again after a theme change

// Motion is in 60 Hz frames; dt keeps it the same speed at any frame rate. Rain draws at
// most 60 times a second (every other frame at 120 Hz), slow snow 30.
const RAIN_STEP_MS = 1000 / 60;
const SNOW_STEP_MS = 1000 / 30;

// With reduced motion the effect still shows, as one still frame instead of falling drops
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const config = {
  density: 180,
  speed: 8,
  size: 1,
  length: 6
};

// Sideways pull, in pixels across per pixel down: the real wind plus the phone's tilt.
// Set from ambient.js.
let wind = 0;
let tilt = 0;

export function setWind(slope) { wind = Number.isFinite(slope) ? slope : 0; }
export function setTilt(slope) { tilt = Number.isFinite(slope) ? slope : 0; }
export function state() { return { rain: rainActive, snow: snowActive }; }

function resizeCanvas() {
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function createDrop() {
  const baseSpeed = snowActive ? 0.6 : config.speed;
  const baseSize = snowActive ? 1 : config.size;
  const baseLength = snowActive ? 1 : config.length;
  
  return {
    x: Math.random() * canvas.width,
    // Drops fall in from above; a still frame needs them spread over the visible area instead
    y: Math.random() * canvas.height - (reducedMotion.matches ? 0 : canvas.height),
    speed: baseSpeed * (0.4 + Math.random() * 0.5),
    size: baseSize,
    length: baseLength,
    wobble: Math.random() * Math.PI * 2,
    wobbleSpeed: 0.02 + Math.random() * 0.03
  };
}

function initDrops() {
  drops = [];
  for (let i = 0; i < config.density; i++) {
    drops.push(createDrop());
  }
}

function dropColor() {
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
  if (snowActive) return theme === 'light' ? (muted || '#93a1a1') : 'rgba(255, 255, 255, 0.9)';
  if (theme === 'cyberpunk') return '#ffea00';
  if (theme === 'light') return 'rgba(180, 190, 210, 0.6)';
  return muted || '#586e75';
}

function draw(now = performance.now()) {
  if ((!rainActive && !snowActive) || !ctx) return;

  // Skip frames that come sooner than the step (2 ms early is close enough)
  const step = snowActive ? SNOW_STEP_MS : RAIN_STEP_MS;
  if (lastDraw && now - lastDraw < step - 2) {
    animationFrame = requestAnimationFrame(draw);
    return;
  }
  // A late frame (a hidden tab, a busy page) moves at most 4 steps
  const dt = lastDraw ? Math.min(4, (now - lastDraw) / (1000 / 60)) : 1;
  lastDraw = now;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Set pixel art style
  ctx.imageSmoothingEnabled = false;
  
  if (!fill) fill = dropColor();
  ctx.fillStyle = fill;
  
  // Snow drifts with the wind more slowly than rain is driven by it
  const slope = (wind + tilt) * (snowActive ? 0.6 : 1);
  const w = canvas.width;

  // Update and draw drops
  drops.forEach(drop => {
    // Update position
    drop.y += drop.speed * dt;
    drop.x += slope * drop.speed * dt;
    drop.wobble += drop.wobbleSpeed * dt;
    const wobbleX = Math.sin(drop.wobble) * 0.5;

    // Draw: a slanted drop is a staircase of pixels, so it stays crisp
    const x = Math.floor(drop.x + wobbleX);
    const y = Math.floor(drop.y);
    if (snowActive || Math.abs(slope) < 0.08) {
      ctx.fillRect(x, y, drop.size, drop.length);
    } else {
      for (let i = 0; i < drop.length; i++) {
        ctx.fillRect(Math.floor(x - slope * i), y - i, drop.size, 1);
      }
    }

    // Reset if off screen; a drop blown off one side comes back on the other
    if (drop.y > canvas.height) {
      drop.y = -drop.length;
      drop.x = Math.random() * w;
    } else if (drop.x < -20) {
      drop.x += w + 40;
    } else if (drop.x > w + 20) {
      drop.x -= w + 40;
    }
  });

  animationFrame = reducedMotion.matches ? null : requestAnimationFrame(draw);
}

export function toggleRain() {
  rainActive = !rainActive;
  
  if (rainActive) {
    // Turn off snow and stop its animation
    snowActive = false;
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    canvas.classList.add('active');
    resizeCanvas();
    initDrops();
    lastDraw = 0;
    fill = null;
    draw();
  } else {
    canvas.classList.remove('active');
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  }
  
  return rainActive;
}

export function toggleSnow() {
  snowActive = !snowActive;
  
  if (snowActive) {
    // Turn off rain and stop its animation
    rainActive = false;
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    canvas.classList.add('active');
    resizeCanvas();
    initDrops();
    lastDraw = 0;
    fill = null;
    draw();
  } else {
    canvas.classList.remove('active');
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  }
  
  return snowActive;
}

// Check weather and auto-enable rain/snow
export async function checkWeatherAndAutoEnable() {
  // Never start a full-screen effect by itself for someone who asked for less motion
  if (reducedMotion.matches) return null;
  try {
    const settingsStr = localStorage.getItem('myDashboardSettings.v2');
    if (!settingsStr) return;
    
    const settings = JSON.parse(settingsStr);
    const weather = settings?.weather;

    const lat = Number(weather?.lat);
    const lon = Number(weather?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return;
    }
    
    // The same request as the weather line and the ambient sky
    const data = await fetchForecast(lat, lon, 5000);
    if (!data) return;
    const weatherCode = data.current?.weather_code;
    const precipitation = data.current?.precipitation || 0;
    
    // Snow codes: 71-77, 85-86
    const isSnowing = (weatherCode >= 71 && weatherCode <= 77) || 
                     (weatherCode >= 85 && weatherCode <= 86);
    
    // Rain codes: 51-67, 80-82, 95-99
    const isRaining = !isSnowing && (precipitation > 0 || 
                     (weatherCode >= 51 && weatherCode <= 67) ||
                     (weatherCode >= 80 && weatherCode <= 82) ||
                     (weatherCode >= 95 && weatherCode <= 99));
    
    return { isSnowing, isRaining };
  } catch (error) {
    console.warn('[Weather] Failed to check weather:', error.message);
    return null;
  }
}

// Initialize
if (canvas) {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  // Read the colour again after a theme change
  new MutationObserver(() => { fill = null; }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
}

export default { toggleRain, toggleSnow, checkWeatherAndAutoEnable, setWind, setTilt, state };
