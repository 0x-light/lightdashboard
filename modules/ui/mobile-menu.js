// Mobile menu module - handles mobile navigation

// Store scroll position when menu opens (position: fixed resets scroll)
let savedScrollPosition = 0;

export function setupMobileMenu() {
  const mobileMenuBtn = document.getElementById('newMobileMenuBtn');
  const mobileMenu = document.getElementById('newMobileMenu');
  const closeMobileMenuBtn = document.getElementById('newCloseMobileMenuBtn');

  const openMenu = () => {
    if (!mobileMenu) return;
    // Save scroll position before applying position: fixed
    savedScrollPosition = window.scrollY;
    mobileMenu.classList.add('active');
    document.body.classList.add('mobile-menu-open');
    document.body.classList.add('modal-open');
    // Apply negative top to keep visual position
    document.body.style.top = `-${savedScrollPosition}px`;
  };

  const closeMenu = () => {
    if (!mobileMenu) return;
    mobileMenu.classList.remove('active');
    document.body.classList.remove('mobile-menu-open');
    document.body.classList.remove('modal-open');
    // Restore scroll position
    document.body.style.top = '';
    window.scrollTo(0, savedScrollPosition);
  };

  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', openMenu);
  }

  if (closeMobileMenuBtn) {
    closeMobileMenuBtn.addEventListener('click', closeMenu);
  }

  return { openMenu, closeMenu };
}

// Sync a mobile button with its desktop counterpart
export function syncMobileButton(desktopId, mobileId, closeMenuAfter = true) {
  const desktop = document.getElementById(desktopId);
  const mobile = document.getElementById(mobileId);
  const mobileMenu = document.getElementById('newMobileMenu');

  if (mobile && desktop) {
    mobile.addEventListener('click', () => {
      if (closeMenuAfter && mobileMenu) {
        mobileMenu.classList.remove('active');
        document.body.classList.remove('mobile-menu-open');
        document.body.classList.remove('modal-open');
        // Restore scroll position
        document.body.style.top = '';
        window.scrollTo(0, savedScrollPosition);
      }
      desktop.click();
    });
  }
}

// Utility function to close mobile menu from anywhere in the app
export function closeMobileMenuWithScroll() {
  const mobileMenu = document.getElementById('newMobileMenu');
  if (mobileMenu) {
    mobileMenu.classList.remove('active');
  }
  document.body.classList.remove('mobile-menu-open');
  document.body.classList.remove('modal-open');
  document.body.style.top = '';
  window.scrollTo(0, savedScrollPosition);
}

// Sync mobile theme select with desktop
export function syncThemeSelects() {
  const themeSelect = document.getElementById('newThemeSelect');
  const themeSelectMobile = document.getElementById('newThemeSelectMobile');

  if (themeSelect && themeSelectMobile) {
    themeSelectMobile.value = themeSelect.value;
    themeSelectMobile.addEventListener('change', (e) => {
      themeSelect.value = e.target.value;
      themeSelect.dispatchEvent(new Event('change'));
    });
  }
}

export default { setupMobileMenu, syncMobileButton, syncThemeSelects };



