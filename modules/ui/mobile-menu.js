// Mobile menu module - handles mobile navigation

export function setupMobileMenu() {
  const mobileMenuBtn = document.getElementById('newMobileMenuBtn');
  const mobileMenu = document.getElementById('newMobileMenu');
  const closeMobileMenuBtn = document.getElementById('newCloseMobileMenuBtn');

  const openMenu = () => {
    if (!mobileMenu) return;
    mobileMenu.classList.add('active');
    document.body.classList.add('mobile-menu-open');
    document.body.classList.add('modal-open');
  };

  const closeMenu = () => {
    if (!mobileMenu) return;
    mobileMenu.classList.remove('active');
    document.body.classList.remove('mobile-menu-open');
    document.body.classList.remove('modal-open');
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
      }
      desktop.click();
    });
  }
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

