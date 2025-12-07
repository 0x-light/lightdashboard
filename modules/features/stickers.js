// Stickers feature module - Mobile compatible using pointer events
// Lazy loaded when sticker window is opened

const STICKERS_MANIFEST_URL = '/stickers/index.json';
const STICKY_STICKERS_KEY = 'stickyStickers.v1';

let stickersLoaded = false;
let stickerFiles = [];
let stickyStickersData = [];

/**
 * Initialize the stickers feature - call on window open
 */
export async function init() {
    if (!stickersLoaded) {
        await loadStickerManifest();
        stickersLoaded = true;
    }
    renderStickerGrid();
    setupGridInteraction();
}

/**
 * Restore saved sticky stickers on page load
 */
export function restoreStickyStickers() {
    stickyStickersData = loadFromStorage();
    const container = document.getElementById('stickyStickers');
    if (!container) return;

    stickyStickersData.forEach(data => {
        createStickySticker(data.imageSrc, data.x, data.y, data.width, data.height, data.rotation, data.id, false);
    });
}

/**
 * Load sticker manifest from server
 */
async function loadStickerManifest() {
    try {
        const response = await fetch(STICKERS_MANIFEST_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        stickerFiles = await response.json();
        console.log(`[Stickers] Loaded ${stickerFiles.length} stickers`);
    } catch (e) {
        console.error('[Stickers] Failed to load manifest:', e);
        stickerFiles = [];
    }
}

/**
 * Render sticker grid in the picker window
 */
function renderStickerGrid() {
    const grid = document.getElementById('stickerGrid');
    if (!grid) return;

    grid.innerHTML = '';

    for (const file of stickerFiles) {
        const imgSrc = `/stickers/${encodeURIComponent(file)}`;
        const displayName = file.replace(/\.(png|jpg|jpeg|gif|webp|svg)$/i, '');

        const item = document.createElement('div');
        item.className = 'sticker-item';
        item.dataset.src = imgSrc;
        item.title = displayName;

        const iconDiv = document.createElement('div');
        iconDiv.className = 'sticker-icon';

        const img = document.createElement('img');
        img.src = imgSrc;
        img.alt = displayName;
        img.loading = 'lazy';
        img.draggable = false;

        iconDiv.appendChild(img);

        const label = document.createElement('div');
        label.className = 'sticker-label';
        label.textContent = displayName;

        item.appendChild(iconDiv);
        item.appendChild(label);
        grid.appendChild(item);
    }
}

/**
 * Setup grid interaction - tap to place on mobile, drag on desktop
 */
function setupGridInteraction() {
    const grid = document.getElementById('stickerGrid');
    if (!grid) return;

    // Remove old listeners by replacing node
    const newGrid = grid.cloneNode(true);
    grid.parentNode.replaceChild(newGrid, grid);

    let dragGhost = null;
    let isDragging = false;
    let startX, startY;

    newGrid.addEventListener('pointerdown', (e) => {
        const item = e.target.closest('.sticker-item');
        if (!item) return;

        e.preventDefault();
        const imageSrc = item.dataset.src;
        if (!imageSrc) return;

        startX = e.clientX;
        startY = e.clientY;

        // Create drag ghost
        dragGhost = item.cloneNode(true);
        dragGhost.style.position = 'fixed';
        dragGhost.style.left = `${e.clientX - 30}px`;
        dragGhost.style.top = `${e.clientY - 30}px`;
        dragGhost.style.width = '60px';
        dragGhost.style.height = '60px';
        dragGhost.style.pointerEvents = 'none';
        dragGhost.style.opacity = '0.9';
        dragGhost.style.zIndex = '10001';
        dragGhost.style.filter = 'brightness(1.2)';
        dragGhost.dataset.imageSrc = imageSrc;
        document.body.appendChild(dragGhost);

        isDragging = true;
        item.setPointerCapture(e.pointerId);
    });

    newGrid.addEventListener('pointermove', (e) => {
        if (!isDragging || !dragGhost) return;

        dragGhost.style.left = `${e.clientX - 30}px`;
        dragGhost.style.top = `${e.clientY - 30}px`;
    });

    newGrid.addEventListener('pointerup', (e) => {
        if (!isDragging || !dragGhost) return;

        const imageSrc = dragGhost.dataset.imageSrc;
        const dropX = e.clientX;
        const dropY = e.clientY;

        // Check if dropped outside the sticker window
        const stickerWindow = document.getElementById('stickerWindow');
        const windowRect = stickerWindow?.getBoundingClientRect();
        const droppedOutside = !windowRect ||
            dropX < windowRect.left || dropX > windowRect.right ||
            dropY < windowRect.top || dropY > windowRect.bottom;

        // Check if user moved enough to count as a drag
        const moved = Math.abs(dropX - startX) > 20 || Math.abs(dropY - startY) > 20;

        // On mobile: tap to place at center, or drag outside to place at drop point
        // On desktop: only drag outside to place (no tap-to-place)
        const isMobile = window.innerWidth < 768;
        const shouldPlace = droppedOutside || (isMobile && !moved);

        if (shouldPlace) {
            // Place sticker - if tapped (not dragged much), place at center
            const placeX = moved ? dropX - 100 : (window.innerWidth / 2) - 100;
            const placeY = moved ? dropY - 100 : (window.innerHeight / 2) - 100;

            createStickySticker(imageSrc, placeX, placeY);

            // Close sticker window on mobile after tap-to-place
            if (!moved && isMobile) {
                closeStickerWindow();
            }
        }

        // Cleanup
        dragGhost.remove();
        dragGhost = null;
        isDragging = false;
    });

    newGrid.addEventListener('pointercancel', () => {
        if (dragGhost) {
            dragGhost.remove();
            dragGhost = null;
        }
        isDragging = false;
    });
}

/**
 * Create a sticky sticker on the page
 */
function createStickySticker(imageSrc, x, y, width = null, height = null, rotation = 0, existingId = null, save = true) {
    const container = document.getElementById('stickyStickers');
    if (!container) return null;

    const id = existingId || (Date.now() + Math.random());

    const sticker = document.createElement('div');
    sticker.className = 'sticky-sticker';
    sticker.dataset.id = id;
    sticker.style.left = `${x}px`;
    sticker.style.top = `${y}px`;
    sticker.style.transform = `rotate(${rotation}deg)`;
    sticker.style.touchAction = 'none'; // Prevent scroll on touch

    const img = document.createElement('img');
    img.src = imageSrc;
    img.draggable = false;

    img.onload = () => {
        const aspectRatio = img.naturalWidth / img.naturalHeight;

        if (width === null && height === null) {
            width = 150;
            height = 150 / aspectRatio;
        } else if (width === null) {
            width = height * aspectRatio;
        } else if (height === null) {
            height = width / aspectRatio;
        }

        sticker.style.width = `${width}px`;
        sticker.style.height = `${height}px`;
        sticker.dataset.aspectRatio = aspectRatio;

        // Update saved data
        const data = stickyStickersData.find(s => s.id === id);
        if (data) {
            data.width = width;
            data.height = height;
            saveToStorage();
        }
    };

    if (width !== null) sticker.style.width = `${width}px`;
    if (height !== null) sticker.style.height = `${height}px`;

    // Control buttons
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    resizeHandle.textContent = '[RESIZE]';

    const rotateHandle = document.createElement('div');
    rotateHandle.className = 'rotate-handle';
    rotateHandle.textContent = '[ROTATE]';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '[REMOVE]';
    removeBtn.onclick = (e) => {
        e.stopPropagation();
        removeStickySticker(id);
    };

    sticker.appendChild(img);
    sticker.appendChild(resizeHandle);
    sticker.appendChild(rotateHandle);
    sticker.appendChild(removeBtn);
    container.appendChild(sticker);

    // Setup interaction handlers
    makeDraggable(sticker);
    makeResizable(sticker, resizeHandle);
    makeRotatable(sticker, rotateHandle);

    // Save to data
    if (save) {
        stickyStickersData.push({ id, imageSrc, x, y, width, height, rotation });
        saveToStorage();
    }

    return sticker;
}

/**
 * Make element draggable with pointer events
 */
function makeDraggable(element) {
    let isDragging = false;
    let startX, startY, initialX, initialY;

    element.addEventListener('pointerdown', (e) => {
        if (e.target.classList.contains('resize-handle') ||
            e.target.classList.contains('rotate-handle') ||
            e.target.classList.contains('remove-btn')) return;

        isDragging = true;
        element.classList.add('dragging');

        const rect = element.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        initialX = rect.left;
        initialY = rect.top;

        element.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    element.addEventListener('pointermove', (e) => {
        if (!isDragging) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        const newX = initialX + deltaX;
        const newY = initialY + deltaY;

        element.style.left = `${newX}px`;
        element.style.top = `${newY}px`;

        // Update data
        const id = parseFloat(element.dataset.id);
        const data = stickyStickersData.find(s => s.id === id);
        if (data) {
            data.x = newX;
            data.y = newY;
        }
    });

    element.addEventListener('pointerup', () => {
        if (isDragging) {
            isDragging = false;
            element.classList.remove('dragging');
            saveToStorage();
        }
    });

    element.addEventListener('pointercancel', () => {
        isDragging = false;
        element.classList.remove('dragging');
    });
}

/**
 * Make element resizable with pointer events
 */
function makeResizable(element, handle) {
    let isResizing = false;
    let startX, startWidth, aspectRatio;

    handle.addEventListener('pointerdown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = element.offsetWidth;
        aspectRatio = parseFloat(element.dataset.aspectRatio) || 1;

        handle.setPointerCapture(e.pointerId);
        e.stopPropagation();
        e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
        if (!isResizing) return;

        const deltaX = e.clientX - startX;
        const newWidth = Math.max(50, startWidth + deltaX);
        const newHeight = newWidth / aspectRatio;

        element.style.width = `${newWidth}px`;
        element.style.height = `${newHeight}px`;

        // Update data
        const id = parseFloat(element.dataset.id);
        const data = stickyStickersData.find(s => s.id === id);
        if (data) {
            data.width = newWidth;
            data.height = newHeight;
        }
    });

    handle.addEventListener('pointerup', () => {
        if (isResizing) {
            isResizing = false;
            saveToStorage();
        }
    });

    handle.addEventListener('pointercancel', () => {
        isResizing = false;
    });
}

/**
 * Make element rotatable with pointer events
 */
function makeRotatable(element, handle) {
    let isRotating = false;
    let startAngle, startRotation;

    handle.addEventListener('pointerdown', (e) => {
        isRotating = true;

        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;

        const transform = element.style.transform;
        const match = transform.match(/rotate\(([-\d.]+)deg\)/);
        startRotation = match ? parseFloat(match[1]) : 0;

        handle.setPointerCapture(e.pointerId);
        e.stopPropagation();
        e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
        if (!isRotating) return;

        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
        const deltaAngle = currentAngle - startAngle;
        const newRotation = startRotation + deltaAngle;

        element.style.transform = `rotate(${newRotation}deg)`;

        // Update data
        const id = parseFloat(element.dataset.id);
        const data = stickyStickersData.find(s => s.id === id);
        if (data) {
            data.rotation = newRotation;
        }
    });

    handle.addEventListener('pointerup', () => {
        if (isRotating) {
            isRotating = false;
            saveToStorage();
        }
    });

    handle.addEventListener('pointercancel', () => {
        isRotating = false;
    });
}

/**
 * Remove a sticky sticker
 */
function removeStickySticker(id) {
    const element = document.querySelector(`.sticky-sticker[data-id="${id}"]`);
    if (element) element.remove();

    stickyStickersData = stickyStickersData.filter(s => s.id !== id);
    saveToStorage();
}

/**
 * Storage helpers
 */
function loadFromStorage() {
    try {
        const saved = localStorage.getItem(STICKY_STICKERS_KEY);
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        return [];
    }
}

function saveToStorage() {
    try {
        localStorage.setItem(STICKY_STICKERS_KEY, JSON.stringify(stickyStickersData));
    } catch (e) {
        console.error('[Stickers] Failed to save:', e);
    }
}

/**
 * Open sticker window
 */
export function openStickerWindow() {
    const window = document.getElementById('stickerWindow');
    const backdrop = document.getElementById('stickerBackdrop');

    if (window) window.style.display = 'flex';
    if (backdrop) backdrop.style.display = 'block';

    // Initialize if needed
    init();
}

/**
 * Close sticker window
 */
export function closeStickerWindow() {
    const window = document.getElementById('stickerWindow');
    const backdrop = document.getElementById('stickerBackdrop');

    if (window) window.style.display = 'none';
    if (backdrop) backdrop.style.display = 'none';
}

/**
 * Clear all stickers
 */
export function clearAllStickers() {
    const container = document.getElementById('stickyStickers');
    if (container) container.innerHTML = '';

    stickyStickersData = [];
    saveToStorage();
}
