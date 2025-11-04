// Theme system module
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
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

