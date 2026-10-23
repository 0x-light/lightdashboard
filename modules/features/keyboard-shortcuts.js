// Keyboard shortcuts feature (lazy-loaded, always on)

let initialized = false;
let enabled = false;

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

// Any pop-up on screen: the app's own, and the theme, shortcuts, account and comic windows.
// The phone menu is always laid out, so it counts only while it's open.
function isModalOpen() {
    const mobileMenu = document.getElementById('newMobileMenu');
    if (mobileMenu?.classList.contains('active') || document.body.classList.contains('mobile-menu-open')) return true;
    return [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
        .some(el => el !== mobileMenu && isElementVisible(el));
}

// Check if user is typing in an input field
function isTyping(target) {
    if (!target) return false;
    const tag = target.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

// Close any open modal
function closeModals() {
    // Settings: go through its Close button so pending edits save and data refreshes
    const settingsDialog = document.getElementById('newSettingsDialog');
    if (isElementVisible(settingsDialog)) {
        document.getElementById('newCloseSettingsBtn')?.click();
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

    // Leave the browser's own keys alone (⌘R reloads, ⌘W closes the tab)
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // Don't handle shortcuts when typing in inputs (except Esc), or behind a pop-up
    if (isTyping(target) || isModalOpen()) return;

    const action = SHORTCUTS[key.length === 1 ? key.toLowerCase() : key];
    if (action && action(e) !== false) e.preventDefault();
}

const click = (id) => () => {
    const btn = document.getElementById(id);
    if (!btn || btn.disabled || !btn.getClientRects().length && !btn.closest('#pmTools')) return false;
    btn.click();
};

// Comic keys work only while the comic section is on the page
const comicClick = (id) => () => {
    const comicSection = document.getElementById('comicSection');
    if (!comicSection || comicSection.offsetParent === null) return false;
    return click(id)();
};

// 1–4 jump to a section and put focus on it, so Tab carries on from there
const SECTIONS = ['pmTop', 'positionsSection', 'watchlistSection', 'comicSection'];
const goToSection = (index) => () => {
    const section = document.getElementById(SECTIONS[index]);
    if (!section || section.offsetParent === null) return false;
    if (!section.hasAttribute('tabindex')) section.tabIndex = -1;
    section.focus({ preventScroll: true });
    section.scrollIntoView({ block: 'start' });
};

// The next or previous comic strip tab
const stepComicTab = (e) => {
    const tabs = [...document.querySelectorAll('#comicSection .comic-tab')].filter(t => t.offsetParent !== null);
    if (!tabs.length) return false;
    const i = tabs.findIndex(t => t.classList.contains('active'));
    tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length].click();
};

// Keys handled here. T, H, A, M and ? live in palmeirim.js; rows and windows handle their own.
const SHORTCUTS = {
    r: () => {
        // Trigger refresh
        if (typeof window.renderPortfolioIncremental === 'function') {
            window.renderPortfolioIncremental();
        } else {
            // Fallback: click greeting to trigger refresh
            const greeting = document.querySelector('.greeting-container');
            if (greeting) greeting.click();
        }
    },
    s: click('newSettingsBtn'),
    p: click('newAddPositionBtn'),
    w: () => {
        // Open watchlist search and focus input
        const addBtn = document.getElementById('newAddToWatchlistBtn');
        if (!addBtn) return false;
        addBtn.click();
        setTimeout(() => document.getElementById('newWatchlistSearchInput')?.focus(), 100);
    },
    n: click('newToggleSnowBtn'),
    y: click('newToggleRainBtn'),
    k: click('newStickersBtn'),
    g: click('newDonateBtn'),
    1: goToSection(0),
    2: goToSection(1),
    3: goToSection(2),
    4: goToSection(3),
    c: stepComicTab,
    x: comicClick('newComicRandomBtn'),
    d: comicClick('newComicDownloadBtn'),
    ArrowLeft: comicClick('newComicPrevBtn'),
    ArrowRight: comicClick('newComicNextBtn')
};

// Initialize the keyboard shortcuts
export function init() {
    if (initialized) return;
    initialized = true;
    enabled = true;

    document.addEventListener('keydown', handleKeydown);
    console.log('[Keyboard] Shortcuts enabled; press ? for the list');
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
