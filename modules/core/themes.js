// Theme system module
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;

  // Update iOS/PWA status bar color to match theme background
  requestAnimationFrame(() => {
    const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    const themeColorMeta = document.getElementById('themeColorMeta');
    if (themeColorMeta && bgColor) {
      themeColorMeta.setAttribute('content', bgColor);
    }
  });
}

export function getPreferredTheme() {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

export function initTheme(themeName) {
  const theme = themeName || getPreferredTheme();
  applyTheme(theme);
  return theme;
}

export default { applyTheme, getPreferredTheme, initTheme };

