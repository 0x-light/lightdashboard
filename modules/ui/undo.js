// One undo line for actions that save straight away (hide, delete, remove).
// It replaces confirm dialogs: the action happens, the line offers to take it back
// for a few seconds, by its button or the U key. A new action replaces the old offer.

const UNDO_MS = 8000;

let line = null;
let textEl = null;
let pending = null;
let timer = null;

function isTyping(target) {
  const tag = target?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
}

function ensureLine() {
  if (line) return;
  line = document.createElement('div');
  line.className = 'undo-line';
  line.setAttribute('role', 'status');
  line.setAttribute('aria-live', 'polite');
  line.hidden = true;
  line.innerHTML = '<span class="undo-line__text"></span>' +
    '<button type="button" class="undo-line__btn"><kbd>U</kbd><span>Undo</span></button>';
  textEl = line.querySelector('.undo-line__text');
  line.querySelector('.undo-line__btn').addEventListener('click', undo);
  document.body.appendChild(line);

  document.addEventListener('keydown', (e) => {
    if (!pending || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
    if (e.key === 'u' || e.key === 'U') {
      e.preventDefault();
      undo();
    }
  });
}

function dismiss() {
  clearTimeout(timer);
  pending = null;
  if (line) line.hidden = true;
}

function undo() {
  const fn = pending;
  dismiss();
  if (fn) fn();
}

export function showUndo(message, onUndo) {
  ensureLine();
  clearTimeout(timer);
  pending = onUndo;
  textEl.textContent = message;
  line.hidden = false;
  timer = setTimeout(dismiss, UNDO_MS);
}

export default { showUndo };
