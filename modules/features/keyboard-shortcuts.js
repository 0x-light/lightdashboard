// Keyboard shortcuts feature (lazy-loaded)
// Only active when enabled in settings

let initialized = false;
let enabled = false;

// Modal selectors to check for open state
const MODAL_SELECTORS = [
    '#newSettingsDialog',
    '#newWatchlistSearchWindow',
    '#newDonateWindow',
    '#newAddPositionModal',
    '#stickerWindow',
    '#newMobileMenu'
];

function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
}

function getPinnedScrollPosition() {
    const topValue = document.body.style.top;
    if (!topValue) return 0;
    const parsed = parseInt(topValue, 10);
    return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

// Check if any modal is currently open
function isModalOpen() {
    for (const selector of MODAL_SELECTORS) {
        const el = document.querySelector(selector);
        if (selector === '#newMobileMenu') {
            if (el?.classList.contains('active') || document.body.classList.contains('mobile-menu-open')) {
                return true;
            }
            continue;
        }
        if (isElementVisible(el)) {
            return true;
        }
    }
    return false;
}

// Check if user is typing in an input field
function isTyping(target) {
    if (!target) return false;
    const tag = target.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

// Close any open modal
function closeModals() {
    // Settings
    const settingsDialog = document.getElementById('newSettingsDialog');
    const settingsBackdrop = document.getElementById('newSettingsBackdrop');
    if (isElementVisible(settingsDialog)) {
        settingsDialog.style.display = 'none';
        if (settingsBackdrop) settingsBackdrop.style.display = 'none';
        document.body.classList.remove('modal-open');
        return true;
    }

    // Watchlist search
    const watchlistWindow = document.getElementById('newWatchlistSearchWindow');
    const watchlistBackdrop = document.getElementById('newWatchlistSearchBackdrop');
    if (isElementVisible(watchlistWindow)) {
        watchlistWindow.style.display = 'none';
        if (watchlistBackdrop) watchlistBackdrop.style.display = 'none';
        const input = document.getElementById('newWatchlistSearchInput');
        if (input) input.value = '';
        const results = document.getElementById('newWatchlistSearchResults');
        if (results) {
            results.innerHTML = '';
            results.style.display = 'none';
        }
        document.body.classList.remove('modal-open');
        return true;
    }

    // Donate
    const donateWindow = document.getElementById('newDonateWindow');
    const donateBackdrop = document.getElementById('newDonateBackdrop');
    if (isElementVisible(donateWindow)) {
        donateWindow.style.display = 'none';
        if (donateBackdrop) donateBackdrop.style.display = 'none';
        document.body.classList.remove('modal-open');
        return true;
    }

    // Add Position
    const positionModal = document.getElementById('newAddPositionModal');
    const positionBackdrop = document.getElementById('newAddPositionBackdrop');
    if (isElementVisible(positionModal)) {
        positionModal.style.display = 'none';
        if (positionBackdrop) positionBackdrop.style.display = 'none';
        document.body.classList.remove('modal-open');
        return true;
    }

    // Sticker window
    const stickerWindow = document.getElementById('stickerWindow');
    const stickerBackdrop = document.getElementById('stickerBackdrop');
    if (isElementVisible(stickerWindow)) {
        stickerWindow.style.display = 'none';
        if (stickerBackdrop) stickerBackdrop.style.display = 'none';
        document.body.classList.remove('modal-open');
        return true;
    }

    // Mobile menu
    const mobileMenu = document.getElementById('newMobileMenu');
    if (mobileMenu?.classList.contains('active') || document.body.classList.contains('mobile-menu-open')) {
        const restoreTo = getPinnedScrollPosition();
        mobileMenu?.classList.remove('active');
        document.body.classList.remove('mobile-menu-open');
        document.body.classList.remove('modal-open');
        document.body.style.top = '';
        if (restoreTo > 0) {
            window.scrollTo(0, restoreTo);
        }
        return true;
    }

    return false;
}

// Handle keyboard events
function handleKeydown(e) {
    if (!enabled) return;

    const key = e.key;
    const target = e.target;

    // Esc always works (even in inputs) to close modals
    if (key === 'Escape') {
        if (closeModals()) {
            e.preventDefault();
        }
        return;
    }

    // Don't handle shortcuts when typing in inputs (except Esc)
    if (isTyping(target)) return;

    // Don't handle letter shortcuts when modal is open
    if (isModalOpen() && (key === 'r' || key === 'R' || key === 's' || key === 'S' || key === 'w' || key === 'W')) {
        return;
    }

    switch (key) {
        case 'r':
        case 'R':
            e.preventDefault();
            // Trigger refresh
            if (typeof window.renderPortfolioIncremental === 'function') {
                window.renderPortfolioIncremental();
            } else {
                // Fallback: click greeting to trigger refresh
                const greeting = document.querySelector('.greeting-container');
                if (greeting) greeting.click();
            }
            break;

        case 's':
        case 'S':
            e.preventDefault();
            // Open settings
            const settingsBtn = document.getElementById('newSettingsBtn');
            if (settingsBtn) settingsBtn.click();
            break;

        case 'w':
        case 'W':
            e.preventDefault();
            // Open watchlist search and focus input
            const addBtn = document.getElementById('newAddToWatchlistBtn');
            if (addBtn) {
                addBtn.click();
                // Focus input after modal opens
                setTimeout(() => {
                    const input = document.getElementById('newWatchlistSearchInput');
                    if (input) input.focus();
                }, 100);
            }
            break;

        case 'ArrowLeft':
            // Previous comic (only if comic section is visible)
            if (!isModalOpen()) {
                const comicSection = document.getElementById('comicSection');
                if (comicSection && comicSection.offsetParent !== null) {
                    e.preventDefault();
                    const prevBtn = document.getElementById('newComicPrevBtn');
                    if (prevBtn && !prevBtn.disabled) prevBtn.click();
                }
            }
            break;

        case 'ArrowRight':
            // Next comic (only if comic section is visible)
            if (!isModalOpen()) {
                const comicSection = document.getElementById('comicSection');
                if (comicSection && comicSection.offsetParent !== null) {
                    e.preventDefault();
                    const nextBtn = document.getElementById('newComicNextBtn');
                    if (nextBtn && !nextBtn.disabled) nextBtn.click();
                }
            }
            break;
    }
}

// Initialize the keyboard shortcuts
export function init() {
    if (initialized) return;
    initialized = true;
    enabled = true;

    document.addEventListener('keydown', handleKeydown);
    console.log('[Keyboard] Shortcuts enabled: R=Refresh, S=Settings, W=Watchlist, Esc=Close, ←→=Comic nav');
}

// Disable shortcuts (for cleanup)
export function disable() {
    enabled = false;
    document.removeEventListener('keydown', handleKeydown);
    console.log('[Keyboard] Shortcuts disabled');
}

// Re-enable shortcuts
export function enable() {
    if (!initialized) {
        init();
    } else {
        enabled = true;
    }
}

export default { init, disable, enable };
