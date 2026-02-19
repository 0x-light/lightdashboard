// Rain and Snow effects module
// Simplified version optimized for performance

const canvas = document.getElementById('newRainCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;

let drops = [];
let rainActive = false;
let snowActive = false;
let animationFrame = null;

const config = {
  density: 180,
  speed: 8,
  size: 1,
  length: 6
};

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
    y: Math.random() * canvas.height - canvas.height,
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

function draw() {
  if ((!rainActive && !snowActive) || !ctx) return;
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Set pixel art style
  ctx.imageSmoothingEnabled = false;
  
  // Get theme colors
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
  
  if (snowActive) {
    // Snow
    ctx.fillStyle = theme === 'light' ? (muted || '#93a1a1') : 'rgba(255, 255, 255, 0.9)';
  } else {
    // Rain
    if (theme === 'cyberpunk') {
      ctx.fillStyle = '#ffea00';
    } else if (theme === 'light') {
      ctx.fillStyle = 'rgba(180, 190, 210, 0.6)';
    } else {
      ctx.fillStyle = muted || '#586e75';
    }
  }
  
  // Update and draw drops
  drops.forEach(drop => {
    // Update position
    drop.y += drop.speed;
    drop.wobble += drop.wobbleSpeed;
    const wobbleX = Math.sin(drop.wobble) * 0.5;
    
    // Draw
    ctx.fillRect(Math.floor(drop.x + wobbleX), Math.floor(drop.y), drop.size, drop.length);
    
    // Reset if off screen
    if (drop.y > canvas.height) {
      drop.y = -drop.length;
      drop.x = Math.random() * canvas.width;
    }
  });
  
  animationFrame = requestAnimationFrame(draw);
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
  try {
    const settingsStr = localStorage.getItem('myDashboardSettings.v1');
    if (!settingsStr) return;
    
    const settings = JSON.parse(settingsStr);
    const weather = settings?.weather;

    const lat = Number(weather?.lat);
    const lon = Number(weather?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return;
    }
    
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code,precipitation&timezone=auto`,
      { signal: AbortSignal.timeout(5000) }
    );
    
    if (!response.ok) return;
    
    const data = await response.json();
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
}

export default { toggleRain, toggleSnow, checkWeatherAndAutoEnable };
