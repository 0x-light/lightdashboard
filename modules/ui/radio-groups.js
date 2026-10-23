// Radio groups (chart periods): one Tab stop per group, on the chosen option. ← → (or ↑ ↓)
// choose the next or previous option, Home and End the first or last. Choosing is a click, so
// each group's own click handler does the work.

function radios(group) {
  return [...group.querySelectorAll('[role="radio"]')].filter(r => !r.disabled);
}

function syncTabStops(group) {
  const list = radios(group);
  const checked = list.find(r => r.getAttribute('aria-checked') === 'true') || list[0];
  list.forEach(r => { r.tabIndex = r === checked ? 0 : -1; });
}

export function setupRadioGroups() {
  document.querySelectorAll('[role="radiogroup"]').forEach(syncTabStops);

  // Whoever changes the choice (click, key, a saved setting) moves the Tab stop with it
  new MutationObserver(records => {
    new Set(records.map(r => r.target.closest('[role="radiogroup"]')).filter(Boolean)).forEach(syncTabStops);
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-checked'] });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const radio = e.target.closest?.('[role="radio"]');
    const group = radio?.closest('[role="radiogroup"]');
    if (!group) return;
    const list = radios(group);
    const i = list.indexOf(radio);
    const next = {
      ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: list.length - 1
    }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    e.stopPropagation(); // not the comic's ← →
    const target = list[(next + list.length) % list.length];
    target.focus();
    if (target.getAttribute('aria-checked') !== 'true') target.click();
  }, true);
}

export default { setupRadioGroups };
