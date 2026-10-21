// Wide tables scroll sideways with no scrollbar (a deliberate choice), so this adds the cues
// instead: a fade on whichever edge hides columns, and a keyboard stop so arrows can scroll.

function update(wrapper) {
  const overflow = wrapper.scrollWidth - wrapper.clientWidth;
  const scrollable = overflow > 1;
  wrapper.classList.toggle('more-left', scrollable && wrapper.scrollLeft > 1);
  wrapper.classList.toggle('more-right', scrollable && wrapper.scrollLeft < overflow - 1);
  if (scrollable) {
    wrapper.tabIndex = 0;
  } else {
    wrapper.removeAttribute('tabindex');
  }
}

export function setupTableScrollCues() {
  document.querySelectorAll('.table-wrapper').forEach(wrapper => {
    const table = wrapper.querySelector('table');
    if (table?.id && !wrapper.hasAttribute('aria-label')) {
      wrapper.setAttribute('role', 'region');
      wrapper.setAttribute('aria-label', table.id.includes('Watchlist') ? 'Watchlist table' : 'Positions table');
    }
    wrapper.addEventListener('scroll', () => update(wrapper), { passive: true });
    const observer = new ResizeObserver(() => update(wrapper));
    observer.observe(wrapper);
    if (table) observer.observe(table);
    update(wrapper);
  });
}

export default { setupTableScrollCues };
