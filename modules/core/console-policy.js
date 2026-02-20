// Console policy: keep console output intentionally minimal and readable.
// Any deep debugging can be re-enabled with localStorage.setItem('debug.console', '1').

const NOISE_PATTERNS = [
  /SES Removing unpermitted intrinsics/i,
  /Removing intrinsics\./i,
  /lockdown-install\.js/i,
  /Cross-Origin Request Blocked/i,
  /CORS Missing Allow Origin/i,
  /Content-Security-Policy:.*WebAssembly/i
];

const ALLOW_PASSTHROUGH_PATTERNS = [
  /^Made with HTML, CSS, and JavaScript$/i,
  /^by Tomás$/i,
  /^palmeirim\.com$/i
];

const REQUIRED_PREFIXES = ['[LD]', '[LightDashboard]'];

let installed = false;
let bannerPrinted = false;

function isVerboseConsoleEnabled() {
  try {
    const fromStorage = localStorage.getItem('debug.console') === '1';
    const fromQuery = typeof window !== 'undefined' && /[?&]debugConsole=1(?:&|$)/.test(window.location.search || '');
    return fromStorage || fromQuery;
  } catch (_) {
    return false;
  }
}

function toMessageText(args) {
  if (!Array.isArray(args) || args.length === 0) return '';
  return args.map((arg) => {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return arg.message || String(arg);
    try {
      return JSON.stringify(arg);
    } catch (_) {
      return String(arg);
    }
  }).join(' ').trim();
}

function matchesAny(text, patterns) {
  if (!text) return false;
  return patterns.some((pattern) => pattern.test(text));
}

function hasRequiredPrefix(text) {
  if (!text) return false;
  return REQUIRED_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function normalizePrefixedText(text) {
  if (!text) return text;
  for (const prefix of REQUIRED_PREFIXES) {
    if (text.startsWith(prefix)) {
      return text.slice(prefix.length).trim();
    }
  }
  return text;
}

function formatAndEmit(originalConsole, method, text, originalArgs) {
  const outMethod = method === 'debug' ? 'info' : method;
  const fn = originalConsole[outMethod] || originalConsole.log;
  if (outMethod === 'error' || outMethod === 'warn') {
    fn.call(
      originalConsole,
      `%c[LightDashboard ${outMethod.toUpperCase()}]%c ${text}`,
      'color:#d4c35f;font-weight:600',
      'color:inherit',
      ...originalArgs
    );
    return;
  }
  fn.call(
    originalConsole,
    `%c[LightDashboard]%c ${text}`,
    'color:#d4c35f;font-weight:600',
    'color:inherit',
    ...originalArgs
  );
}

export function installConsolePolicy() {
  if (installed || typeof window === 'undefined' || typeof console === 'undefined') return;
  installed = true;

  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug ? console.debug.bind(console) : console.log.bind(console)
  };

  window.__LD_ORIGINAL_CONSOLE__ = originalConsole;

  if (isVerboseConsoleEnabled()) {
    return;
  }

  const wrap = (method) => (...args) => {
    const text = toMessageText(args);
    if (!text) return;

    if (matchesAny(text, NOISE_PATTERNS)) return;

    if (matchesAny(text, ALLOW_PASSTHROUGH_PATTERNS)) {
      (originalConsole[method] || originalConsole.log)(...args);
      return;
    }

    if (hasRequiredPrefix(text)) {
      const normalized = normalizePrefixedText(text);
      formatAndEmit(originalConsole, method, normalized, args.filter((a) => typeof a !== 'string'));
      return;
    }

    // Suppress non-prefixed info/log/warn/debug by default.
  };

  console.log = wrap('log');
  console.info = wrap('info');
  console.warn = wrap('warn');
  console.error = wrap('error');
  console.debug = wrap('debug');

  window.addEventListener('error', (event) => {
    const message = event?.message ? String(event.message) : '';
    if (!message || matchesAny(message, NOISE_PATTERNS)) return;
    formatAndEmit(originalConsole, 'error', message, []);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    const message = reason instanceof Error ? (reason.message || String(reason)) : String(reason || '');
    if (!message || matchesAny(message, NOISE_PATTERNS)) return;
    formatAndEmit(originalConsole, 'error', message, []);
  });
}

export function printSignatureBanner() {
  if (bannerPrinted || typeof window === 'undefined') return;
  bannerPrinted = true;
  const original = window.__LD_ORIGINAL_CONSOLE__ || console;
  original.log('Made with HTML, CSS, and JavaScript\nby Tomás\npalmeirim.com');
}

installConsolePolicy();

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', printSignatureBanner, { once: true });
  } else {
    printSignatureBanner();
  }
}
