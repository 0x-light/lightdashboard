// Keyboard focus for pop-ups. When one opens, focus moves inside and the page behind it goes
// inert, so Tab can't wander onto controls hidden by the backdrop. When it closes, focus goes
// back to whatever opened it. It watches each pop-up's visibility rather than hooking every
// open and close path (buttons, Esc, backdrop clicks, keyboard shortcuts all toggle display).

const DIALOG_IDS = [
  'newSettingsDialog',
  'newWatchlistSearchWindow',
  'newDonateWindow',
  'newAddPositionModal',
  'stickerWindow',
  'newMobileMenu'
];

const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function isShown(el) {
  return el.style.display !== 'none' && getComputedStyle(el).display !== 'none';
}

function isFocusableNow(el) {
  return el && el.isConnected && typeof el.focus === 'function' && el.getClientRects().length > 0;
}

export function setupDialogFocus() {
  const dialogs = DIALOG_IDS.map(id => document.getElementById(id)).filter(Boolean);
  const selector = DIALOG_IDS.map(id => `#${id}`).join(',');

  // The control that opened a pop-up. Buttons don't always take focus on click (Safari), so
  // pointer presses count too.
  let lastTrigger = null;
  const remember = (e) => {
    const target = e.target.closest?.('button, a, [tabindex], select');
    if (target && !target.closest(selector)) lastTrigger = target;
  };
  document.addEventListener('focusin', remember, true);
  document.addEventListener('pointerdown', remember, true);
  document.addEventListener('click', remember, true); // also fires for Enter and Space

  const state = new Map(); // dialog -> { opener, inerted: Element[] }

  const open = (dialog) => {
    // Whatever had focus as it opened is the opener (read before the page goes inert and drops
    // focus); fall back to the last control pressed
    const active = document.activeElement;
    const opener = active && active !== document.body && !dialog.contains(active) ? active : lastTrigger;

    // Everything outside the pop-up's own branch goes inert, except backdrops, which close it on click
    const inerted = [];
    for (let node = dialog; node.parentElement && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling === node || sibling.inert || sibling.matches('script, .settings-backdrop')) continue;
        sibling.inert = true;
        inerted.push(sibling);
      }
    }
    state.set(dialog, { opener, inerted });

    // Settings focuses its own selected tab; others get their first control past the header.
    // Runs right away (the observer fires after the pop-up is shown), not on an animation frame,
    // which background tabs don't run.
    if (!dialog.contains(document.activeElement)) {
      const content = dialog.querySelector('.sticker-window-content, .settings-panes, .mobile-menu-content') || dialog;
      const target = [...content.querySelectorAll(FOCUSABLE)].find(isFocusableNow)
        || [...dialog.querySelectorAll(FOCUSABLE)].find(isFocusableNow);
      target?.focus({ preventScroll: true });
    }
  };

  const close = (dialog) => {
    const entry = state.get(dialog);
    if (!entry) return;
    state.delete(dialog);
    entry.inerted.forEach(el => { el.inert = false; });
    const focusInside = dialog.contains(document.activeElement) || document.activeElement === document.body;
    // Pop-ups opened from the phone menu outlive it, so their opener is gone; the Menu button stands in
    const fallback = entry.opener?.closest?.('#newMobileMenu') ? document.getElementById('newMobileMenuBtn') : null;
    const target = isFocusableNow(entry.opener) ? entry.opener : fallback;
    if (focusInside && isFocusableNow(target)) target.focus({ preventScroll: true });
  };

  const sync = (dialog) => {
    const shown = isShown(dialog);
    if (shown && !state.has(dialog)) open(dialog);
    else if (!shown && state.has(dialog)) close(dialog);
  };

  const observer = new MutationObserver(records => {
    new Set(records.map(r => r.target)).forEach(sync);
  });
  dialogs.forEach(dialog => {
    observer.observe(dialog, { attributes: true, attributeFilter: ['style', 'class'] });
    sync(dialog);
  });
}

export default { setupDialogFocus };
