// Weather feature (lazy-loaded)
import { HttpClient } from '../http/client.js';

function moonPhaseFraction(date = new Date()) {
  const knownNewMoon = new Date('2000-01-06T00:00:00Z');
  const days = (date - knownNewMoon) / (1000 * 60 * 60 * 24);
  const cycle = 29.53058867;
  return (days % cycle) / cycle;
}

function weatherIconFromCode(code, isDay) {
  if (code === 0) return isDay ? '☀︎' : '☾';
  if (code <= 3) return '☁︎';
  if (code <= 49) return '☁︎';
  if (code <= 67) return '⛆';
  if (code <= 77) return '❆';
  if (code <= 82) return '⛆';
  if (code <= 86) return '❆';
  if (code <= 99) return '⛈';
  return '☁︎';
}

export async function fetchWeather(lat, lon, timeoutMs = 10000) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
  const data = await HttpClient.getJson(url, { timeoutMs, ttlMs: 10 * 60 * 1000 });
  return data || null;
}

export async function renderWeather(container, settings = {}) {
  if (!container) return;
  const label = settings.weather?.label || 'your location';
  const lat = settings.weather?.lat;
  const lon = settings.weather?.lon;
  if (!lat || !lon) {
    container.textContent = 'Set latitude and longitude in Settings to see weather.';
    return;
  }
  try {
    const data = await fetchWeather(lat, lon);
    if (!data || !data.current) {
      container.textContent = 'Weather unavailable';
      return;
    }
    const temp = Math.round(data.current.temperature_2m);
    const code = data.current.weather_code || 0;
    const isDay = data.current.is_day === 1;
    const icon = weatherIconFromCode(code, isDay);
    const phase = moonPhaseFraction(new Date());
    let moonIcon = '', moonName = '';
    if (phase < 0.0625) { moonIcon = '○'; moonName = 'new moon'; }
    else if (phase < 0.1875) { moonIcon = '☽'; moonName = 'waxing crescent'; }
    else if (phase < 0.3125) { moonIcon = '◐'; moonName = 'first quarter'; }
    else if (phase < 0.4375) { moonIcon = '◐'; moonName = 'waxing gibbous'; }
    else if (phase < 0.5625) { moonIcon = '●'; moonName = 'full moon'; }
    else if (phase < 0.6875) { moonIcon = '◑'; moonName = 'waning gibbous'; }
    else if (phase < 0.8125) { moonIcon = '◑'; moonName = 'last quarter'; }
    else if (phase < 0.9375) { moonIcon = '☾'; moonName = 'waning crescent'; }
    else { moonIcon = '○'; moonName = 'new moon'; }
    const hour = new Date().getHours();
    const showMoon = hour >= 18 || hour < 6;
    const moonText = showMoon ? ` with a ${moonIcon} ${moonName} moon` : '';
    const precipitation = data.daily?.precipitation_sum?.[0] || 0;
    const rainText = (settings.showRainForecast && precipitation > 0) ? ' with rain forecasted' : '';
    container.innerHTML = `It's ${temp}°C ${icon} in <strong>${label}</strong>${rainText}${moonText}`;
  } catch (_) {
    container.textContent = 'Weather unavailable';
  }
}

// Alias for compatibility with app.js
export const getWeather = fetchWeather;

export default { fetchWeather, renderWeather, getWeather };


