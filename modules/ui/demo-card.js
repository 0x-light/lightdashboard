// The card on a ?demo link (see larp-mode.js): says the portfolio is a sample and leads to the
// visitor's own. Hide keeps it away for the tab's session.

const HIDDEN_KEY = 'pmDemoCardHidden';

export function showDemoCard() {
  try { if (sessionStorage.getItem(HIDDEN_KEY)) return; } catch (_) { /* storage blocked: show it */ }
  const card = document.createElement('aside');
  card.className = 'demo-card';
  card.setAttribute('aria-label', 'Sample portfolio');
  card.innerHTML =
    '<p class="demo-card__text">This is a sample portfolio. Prices are live.</p>' +
    '<p class="demo-card__text demo-card__muted">Add a wallet or a position to see your own. No sign-up.</p>' +
    '<div class="demo-card__actions">' +
      '<a class="demo-card__go"></a>' +
      '<button type="button" class="demo-card__hide">Hide</button>' +
    '</div>';
  const go = card.querySelector('.demo-card__go');
  go.href = window.larp.ownAddress();
  go.textContent = 'Show your portfolio';
  card.querySelector('.demo-card__hide').addEventListener('click', () => {
    try { sessionStorage.setItem(HIDDEN_KEY, '1'); } catch (_) { /* hidden until reload */ }
    card.remove();
  });
  document.body.appendChild(card);
}

export default { showDemoCard };
