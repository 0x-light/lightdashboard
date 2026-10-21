// palmeirim.com skin: reshapes the dashboard chrome into that site's vocabulary
// (numbered page chips, a framed portfolio card with time and weather in its
// border, a theme chip in the footer). Only moves and adds nodes; every
// element app.js looks up by id stays where it can find it.
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function el(tag, attrs, html) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (html != null) node.innerHTML = html;
    return node;
  }

  function chip(key, label) {
    return '<kbd>' + key + '</kbd><span class="chip__label">' + label + '</span>';
  }

  // ── Top bar: one chip per section ──

  var SECTIONS = [
    { id: "pmTop", label: "Portfolio" },
    { id: "positionsSection", label: "Positions" },
    { id: "watchlistSection", label: "Watchlist" },
    { id: "comicSection", label: "Comics" }
  ];

  var header = $(".app-header");
  var nav = el("nav", { class: "pm-nav", id: "pmNav", "aria-label": "Sections" });
  header.insertBefore(nav, header.firstChild);

  // Phones: one chip naming the section in view ("Positions") opens the list of
  // sections, framed like the menu. On wider screens the chips sit in the bar.
  var sectionBtn = el("button", { type: "button", class: "pm-section-btn chip", "aria-expanded": "false", "aria-controls": "pmNav" },
    '<span class="chip__label"><span class="js-pm-current">Portfolio</span></span>');
  header.insertBefore(sectionBtn, nav);

  function visibleSections() {
    return SECTIONS.filter(function (s) {
      var node = document.getElementById(s.id);
      return node && node.offsetParent !== null;
    });
  }

  // Number only the sections that are showing, so the keys stay 1, 2, 3…
  function renderNav() {
    var shown = visibleSections();
    var sig = shown.map(function (s) { return s.id; }).join();
    if (nav.dataset.sig === sig) return;
    nav.dataset.sig = sig;
    nav.innerHTML = shown.map(function (s, i) {
      return '<a class="chip" href="#' + s.id + '">' + chip(i + 1, s.label) + '</a>';
    }).join("");
    markCurrent();
  }

  function markCurrent() {
    var links = $$("a", nav);
    var line = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--pm-lh")) || 18;
    var current = links[0];
    links.forEach(function (a) {
      var target = document.getElementById(a.hash.slice(1));
      if (target && target.getBoundingClientRect().top <= line * 4) current = a;
    });
    // At the very bottom the last short section may never reach the top.
    var scroller = document.scrollingElement;
    if (scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) current = links[links.length - 1];
    // A section you just jumped to stays current until you scroll away from it, even
    // when the page is too short for it to reach the top.
    if (lastJump && Math.abs(scroller.scrollTop - lastJump.top) < 4 && links[lastJump.index]) current = links[lastJump.index];
    links.forEach(function (a) {
      if (a === current) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    });
    var name = current ? $(".chip__label", current).textContent : "";
    var label = $(".js-pm-current", sectionBtn);
    if (label.textContent !== name) label.textContent = name;
    sectionBtn.setAttribute("aria-label", "Section: " + name + ". Go to another section");
  }

  document.addEventListener("scroll", markCurrent, { capture: true, passive: true });

  var lastJump = null;

  function goTo(index) {
    var link = $$("a", nav)[index];
    if (!link) return;
    var target = document.getElementById(link.hash.slice(1));
    if (index === 0) window.scrollTo({ top: 0 });
    else if (target) target.scrollIntoView();
    lastJump = { index: index, top: document.scrollingElement.scrollTop };
    markCurrent();
    history.replaceState(null, "", index === 0 ? location.pathname + location.search : link.hash);
  }

  // ── Tools fold into one MENU chip that drops down a framed list ──
  // It is the header's own tool row, restyled, so every button keeps the listeners
  // app.js gave it. Picking a tool, clicking outside or Esc closes it.

  var tools = $(".header-actions", header);
  tools.id = "pmTools";
  tools.setAttribute("aria-label", "Menu");
  var menuBtn = el("button", { type: "button", class: "pm-menu-btn chip", "aria-expanded": "false", "aria-controls": "pmTools" },
    '<span class="chip__label">Menu</span>');
  header.insertBefore(menuBtn, tools);

  function setMenu(open) {
    header.classList.toggle("pm-menu-open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
    if (open) setSections(false);
  }

  function setSections(open) {
    header.classList.toggle("pm-sections-open", open);
    sectionBtn.setAttribute("aria-expanded", String(open));
    if (open) setMenu(false);
  }

  menuBtn.addEventListener("click", function () { setMenu(!header.classList.contains("pm-menu-open")); });
  sectionBtn.addEventListener("click", function () { setSections(!header.classList.contains("pm-sections-open")); });

  // Close after the tool's own click handler has run.
  tools.addEventListener("click", function (e) {
    if (e.target.closest("button")) setTimeout(function () { setMenu(false); }, 0);
  });

  document.addEventListener("click", function (e) {
    if (header.classList.contains("pm-menu-open") && !tools.contains(e.target) && !menuBtn.contains(e.target)) setMenu(false);
    if (header.classList.contains("pm-sections-open") && !nav.contains(e.target) && !sectionBtn.contains(e.target)) setSections(false);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (header.classList.contains("pm-menu-open")) { setMenu(false); menuBtn.focus(); }
    if (header.classList.contains("pm-sections-open")) { setSections(false); sectionBtn.focus(); }
  });

  // Crossing the phone breakpoint closes both, so they never jump between layouts.
  window.matchMedia("(max-width: 720px)").addEventListener("change", function () { setMenu(false); setSections(false); });

  nav.addEventListener("click", function (e) {
    var link = e.target.closest("a");
    if (!link) return;
    e.preventDefault();
    goTo($$("a", nav).indexOf(link));
    setSections(false);
  });

  // ── Intro: a framed card (title and time/place cut into the top border) holding
  // the portfolio sentence and the allocation ──

  var summary = $("#newSummary");
  var heroSection = summary.closest("section");
  heroSection.id = "pmTop";
  var card = el("div", { class: "pm-card" },
    '<p class="pm-card__title">Portfolio</p>' +
    '<p class="pm-card__meta"><span class="js-pm-time"></span><span class="js-pm-place"></span></p>');
  heroSection.insertBefore(card, summary);
  card.appendChild(summary);

  // Folded, the allocation is one strip split by holding; the strip is the button
  // that opens a row per holding. Closed by default: the positions table below
  // already lists every holding.
  var allocWrap = el("div", { class: "pm-alloc-wrap", hidden: "" },
    '<button type="button" class="pm-strip" aria-expanded="false" aria-controls="pmAlloc"></button>');
  var allocList = el("ul", { class: "pm-alloc", id: "pmAlloc", "aria-label": "Allocation", hidden: "" });
  allocWrap.appendChild(allocList);
  card.appendChild(allocWrap);
  var strip = $(".pm-strip", allocWrap);

  // Pointing at a segment names it on the card's bottom border, starting where that
  // segment starts: "ZRO · 64% · $76.4k". It lives on <body>, outside the observed
  // #main, so placing it doesn't re-run the observer.
  var readout = el("p", { class: "pm-card__readout", "aria-hidden": "true", hidden: "" });
  document.body.appendChild(readout);
  strip.addEventListener("mouseover", function (e) {
    var seg = e.target.closest(".pm-strip__seg");
    if (!seg) return;
    if (readout.textContent !== seg.dataset.readout) readout.textContent = seg.dataset.readout;
    readout.hidden = false;
    var box = card.getBoundingClientRect();
    // The label's own 1ch padding lines its text up with the segment's left edge.
    var pad = parseFloat(getComputedStyle(readout).paddingLeft) || 0;
    var x = Math.min(seg.getBoundingClientRect().left - pad, box.right - readout.offsetWidth - 8);
    readout.style.left = Math.max(box.left + 1, x) + "px";
    readout.style.top = (box.bottom - readout.offsetHeight / 2) + "px";
  });
  strip.addEventListener("mouseleave", function () { readout.hidden = true; });
  window.addEventListener("scroll", function () { readout.hidden = true; }, { passive: true });

  function setAllocOpen(open) {
    strip.setAttribute("aria-expanded", String(open));
    allocList.hidden = !open;
    try { localStorage.setItem("pmAllocOpen", open ? "1" : "0"); } catch (_e) {}
  }

  strip.addEventListener("click", function () {
    setAllocOpen(strip.getAttribute("aria-expanded") !== "true");
  });

  setAllocOpen(false);
  try { if (localStorage.getItem("pmAllocOpen") === "1") setAllocOpen(true); } catch (_e) {}

  // Strip and rows share one vocabulary: solid ink, one dither pattern, then
  // quieter shades. The strip splits the line by holding; each row is a solid bar on
  // a dithered track.
  var narrow = window.matchMedia("(max-width: 520px)");

  function toneFor(it, i) { return it.label === "Other" ? "other" : String(Math.min(i, 3)); }

  // Rebuilt from the app's legend, which already holds label, share and (when shown) value.
  function syncAlloc() {
    var items = $$("#newSummary .alloc-legend li").map(function (li) {
      var label = $(".alloc-label", li), share = $(".alloc-share", li), value = $(".alloc-value", li);
      return {
        label: label ? label.textContent : "",
        share: share ? share.textContent : "",
        pct: share ? Math.max(0, Math.min(100, parseFloat(share.textContent) || 0)) : 0,
        value: value ? value.textContent : ""
      };
    });
    var showValue = !narrow.matches;

    var segs = items.map(function (it, i) {
      var readout = [it.label, it.share, it.value].filter(Boolean).join(" · ");
      return '<span class="pm-strip__seg pm-tone-' + toneFor(it, i) + '" style="flex-grow:' + it.pct + '" data-readout="' + escapeHtml(readout) + '"></span>';
    }).join("");
    var label = "Allocation: " + items.map(function (it) { return it.label + " " + it.share; }).join(", ");
    var rows = items.map(function (it) {
      return '<li><span class="pm-alloc__label">' + escapeHtml(it.label) + '</span>' +
        '<span class="pm-alloc__bar" aria-hidden="true"><span style="width:' + it.pct + '%"></span></span>' +
        '<span class="pm-alloc__share">' + escapeHtml(it.share) + '</span>' +
        (showValue ? '<span class="pm-alloc__value">' + escapeHtml(it.value) + '</span>' : '') + '</li>';
    }).join("");

    // Inside the observed subtree, so only write real changes. Compare against what we
    // wrote, not innerHTML: the browser re-serialises styles, which would never match.
    var key = segs + rows;
    if (key === lastAlloc) return;
    lastAlloc = key;
    strip.innerHTML = segs;
    strip.setAttribute("aria-label", label);
    allocList.innerHTML = rows;
    allocWrap.hidden = !rows;
  }
  var lastAlloc = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  narrow.addEventListener("change", syncAlloc);

  function tick() {
    var now = new Date();
    var hh = String(now.getHours()).padStart(2, "0");
    var mm = String(now.getMinutes()).padStart(2, "0");
    var time = $(".js-pm-time");
    if (time.textContent !== hh + ":" + mm) time.textContent = hh + ":" + mm;
  }
  tick();
  setInterval(tick, 15000);

  // The hero sentence carries the weather ("It's 18°C ☀︎ in Lisbon."); lift it into the badge.
  function syncWeather() {
    var w = $("#newSummary .hero-sentence-weather");
    var place = $(".js-pm-place");
    var temp = w && w.textContent.match(/(-?\d+)°C/);
    var city = w && $("strong", w);
    var text = temp && city ? " " + city.textContent + " · " + temp[1] + "°C" : "";
    // The badge lives inside the observed subtree; writing the same text would loop.
    if (place.textContent !== text) place.textContent = text;
  }

  // ── Theme: a menu item under Settings opens a window listing every theme ──
  // Pointing at (or arrowing to) a theme previews it on the page; clicking or Enter
  // keeps it; Esc or Close puts the previous one back. T / Shift+T still step through.

  var themeSelect = $("#newThemeSelect");
  var themeItem = el("button", { type: "button", id: "pmThemeBtn", class: "btn-text", "aria-haspopup": "dialog" },
    'Theme <span class="pm-theme-current js-pm-theme-name"></span>');
  tools.insertBefore(themeItem, tools.firstChild);

  function syncThemeName() {
    var opt = themeSelect && themeSelect.selectedOptions[0];
    var name = opt ? opt.textContent.trim().toLowerCase() : "";
    $$(".js-pm-theme-name").forEach(function (n) { if (n.textContent !== name) n.textContent = name; });
    themeItem.setAttribute("aria-label", "Theme: " + name + ". Choose a theme");
  }

  function cycleTheme(delta) {
    if (!themeSelect) return;
    var n = themeSelect.options.length;
    themeSelect.selectedIndex = (themeSelect.selectedIndex + delta + n) % n;
    themeSelect.dispatchEvent(new Event("change"));
    syncThemeName();
  }

  var themeBackdrop = el("div", { class: "settings-backdrop", id: "pmThemeBackdrop", style: "display: none;" });
  var themeWindow = el("div", { class: "sticker-window pm-theme-window", id: "pmThemeWindow", role: "dialog",
    "aria-modal": "true", "aria-labelledby": "pmThemeTitle", style: "display: none;" },
    '<div class="sticker-window-header"><h2 id="pmThemeTitle" class="window-title">Theme</h2>' +
    '<button type="button" class="btn-text js-pm-theme-close">Close</button></div>' +
    '<div class="sticker-window-content"><div class="pm-theme-grid" role="listbox" aria-labelledby="pmThemeTitle"></div></div>');
  document.body.append(themeBackdrop, themeWindow);
  var themeGrid = $(".pm-theme-grid", themeWindow);
  var themeBefore = null;
  var themeOpener = null;

  function previewTheme(value) {
    document.documentElement.dataset.theme = value;
  }

  function openThemeWindow() {
    if (!themeSelect) return;
    themeBefore = themeSelect.value;
    themeOpener = document.activeElement;
    themeGrid.innerHTML = Array.prototype.map.call(themeSelect.options, function (opt) {
      var on = opt.value === themeBefore;
      return '<button type="button" class="pm-theme-option" role="option" data-value="' + opt.value + '" aria-selected="' + on + '">' +
        opt.textContent.trim() + '</button>';
    }).join("");
    themeBackdrop.style.display = "block";
    themeWindow.style.display = "flex";
    document.body.classList.add("modal-open");
    var current = $('[aria-selected="true"]', themeGrid) || themeGrid.firstElementChild;
    current.focus();
    current.scrollIntoView({ block: "center" });
  }

  function closeThemeWindow(keep) {
    if (themeWindow.style.display === "none") return;
    if (!keep && themeBefore) previewTheme(themeBefore);
    themeBackdrop.style.display = "none";
    themeWindow.style.display = "none";
    document.body.classList.remove("modal-open");
    if (themeOpener && themeOpener.focus) themeOpener.focus();
  }

  function chooseTheme(value) {
    themeSelect.value = value;
    themeSelect.dispatchEvent(new Event("change"));
    syncThemeName();
    closeThemeWindow(true);
  }

  themeItem.addEventListener("click", openThemeWindow);
  themeBackdrop.addEventListener("click", function () { closeThemeWindow(false); });
  $(".js-pm-theme-close", themeWindow).addEventListener("click", function () { closeThemeWindow(false); });

  themeGrid.addEventListener("click", function (e) {
    var opt = e.target.closest(".pm-theme-option");
    if (opt) chooseTheme(opt.dataset.value);
  });

  // Pointing or focusing previews; leaving the grid shows the one you started with.
  themeGrid.addEventListener("mouseover", function (e) {
    var opt = e.target.closest(".pm-theme-option");
    if (opt) previewTheme(opt.dataset.value);
  });
  themeGrid.addEventListener("focusin", function (e) {
    var opt = e.target.closest(".pm-theme-option");
    if (opt) previewTheme(opt.dataset.value);
  });
  themeGrid.addEventListener("mouseleave", function () {
    var focused = document.activeElement && document.activeElement.closest(".pm-theme-option");
    previewTheme(focused ? focused.dataset.value : themeBefore);
  });

  themeWindow.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeThemeWindow(false);
      return;
    }
    var opts = $$(".pm-theme-option", themeGrid);
    var i = opts.indexOf(document.activeElement);
    if (i < 0) return;
    var cols = getComputedStyle(themeGrid).gridTemplateColumns.split(" ").length || 1;
    var step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (step) {
      e.preventDefault();
      e.stopPropagation();
      var next = opts[Math.max(0, Math.min(opts.length - 1, i + step))];
      next.focus();
      next.scrollIntoView({ block: "nearest" });
    }
  });

  // ── Shortcuts: ? (or the menu's last item) lists every key in a window ──

  var SHORTCUTS = [
    ["1–4", "Go to a section"],
    ["/", "Search positions"],
    ["↑ ↓", "Move between rows"],
    ["↵", "Open or close a row"],
    ["E", "Edit the open position"],
    ["H", "Hide or show the open position"],
    ["⌫", "Delete or remove the open item"],
    ["U", "Undo the last change"],
    ["H", "Hide or show amounts (no row open)"],
    ["R", "Refresh"],
    ["S", "Settings"],
    ["A", "Account: margin, funding, fees"],
    ["T", "Next theme (Shift+T: previous)"],
    ["W", "Add to the watchlist"],
    ["← →", "Previous or next comic"],
    ["Esc", "Close"],
    ["?", "Show these keys"]
  ];

  var keysItem = el("button", { type: "button", id: "pmKeysBtn", class: "btn-text", "aria-haspopup": "dialog" }, "Shortcuts");
  tools.appendChild(keysItem);

  var keysBackdrop = el("div", { class: "settings-backdrop", style: "display: none;" });
  var keysWindow = el("div", { class: "sticker-window pm-keys-window", role: "dialog", "aria-modal": "true",
    "aria-labelledby": "pmKeysTitle", style: "display: none;" },
    '<div class="sticker-window-header"><h2 id="pmKeysTitle" class="window-title">Shortcuts</h2>' +
    '<button type="button" class="btn-text js-pm-keys-close">Close</button></div>' +
    '<div class="sticker-window-content"><dl class="pm-keys">' +
    SHORTCUTS.map(function (s) { return '<div><dt><kbd>' + s[0] + '</kbd></dt><dd>' + s[1] + '</dd></div>'; }).join("") +
    '</dl></div>');
  document.body.append(keysBackdrop, keysWindow);
  var keysOpener = null;

  function openKeys() {
    keysOpener = document.activeElement;
    keysBackdrop.style.display = "block";
    keysWindow.style.display = "flex";
    document.body.classList.add("modal-open");
    $(".js-pm-keys-close", keysWindow).focus();
  }

  function closeKeys() {
    if (keysWindow.style.display === "none") return;
    keysBackdrop.style.display = "none";
    keysWindow.style.display = "none";
    document.body.classList.remove("modal-open");
    if (keysOpener && keysOpener.focus) keysOpener.focus();
  }

  keysItem.addEventListener("click", openKeys);
  keysBackdrop.addEventListener("click", closeKeys);
  $(".js-pm-keys-close", keysWindow).addEventListener("click", closeKeys);
  keysWindow.addEventListener("keydown", function (e) {
    if (e.key === "Escape" || e.key === "?") { e.preventDefault(); e.stopPropagation(); closeKeys(); }
  });

  // Native controls (date pickers, select menus, scrollbars) follow the theme: a dark
  // background asks the browser for its dark versions. Read from the painted body
  // colour, so it works whatever form the theme's --bg is written in.
  function syncColorScheme() {
    var m = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g);
    if (!m) return;
    var lum = (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
    var scheme = lum < 0.5 ? "dark" : "light";
    if (document.documentElement.style.colorScheme !== scheme) document.documentElement.style.colorScheme = scheme;
  }

  // The app switches themes through data-theme on <html>.
  new MutationObserver(syncColorScheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  syncColorScheme();
  if (themeSelect) themeSelect.addEventListener("change", syncThemeName);

  // ── Keys: 1–4 sections, T / Shift+T step through themes, H amounts ──
  // R, S, W and ←/→ are already handled by the app's own shortcuts.

  function typing(t) {
    var tag = t && t.tagName ? t.tagName.toLowerCase() : "";
    return tag === "input" || tag === "textarea" || tag === "select" || (t && t.isContentEditable);
  }

  function modalOpen() {
    return $$('[role="dialog"]').some(function (d) { return d.offsetParent !== null; }) ||
      document.body.classList.contains("mobile-menu-open");
  }

  // ↵ in a window presses its main action, as its key chip says. Not from the ticker
  // search, where Enter is still choosing what to add.
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey) return;
    var win = e.target.closest && e.target.closest(".sticker-window");
    var primary = win && $(".btn-primary", win);
    if (!primary || primary.disabled || primary.offsetParent === null) return;
    if (e.target.tagName === "TEXTAREA" || e.target.tagName === "BUTTON") return;
    // A form submits on Enter by itself; pressing the button too would save twice.
    if (e.target.form || e.defaultPrevented) return;
    e.preventDefault();
    primary.click();
  });

  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || modalOpen()) return;
    if (/^[1-9]$/.test(e.key)) { e.preventDefault(); goTo(Number(e.key) - 1); return; }
    if (e.key === "?") { e.preventDefault(); openKeys(); return; }
    if (e.key === "t" || e.key === "T") { e.preventDefault(); cycleTheme(e.shiftKey ? -1 : 1); return; }
    if (e.key === "h" || e.key === "H") {
      var btn = $("#newToggleAmountsBtn");
      if (btn) { e.preventDefault(); btn.click(); }
    }
  });

  // The app renders asynchronously and hides sections from settings; follow along.
  new MutationObserver(function () { syncWeather(); syncAlloc(); syncSparks(); renderNav(); }).observe($("#main"), { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "hidden", "class"] });

  // app.js sets the theme select's value after this runs.
  // ── 24h sparklines: the same dim dither as the allocation tracks, under the line ──
  // The app draws each sparkline as one polyline in a viewBox stretched to the cell
  // (preserveAspectRatio="none"), so a pattern in user units would stretch too. Each
  // SVG gets its own pattern, sized so one checker cell is 1×1 CSS pixel.

  var sparkSeq = 0;

  function ditherSpark(svg) {
    var line = $("polyline", svg);
    var box = svg.viewBox && svg.viewBox.baseVal;
    var rect = svg.getBoundingClientRect();
    if (!line || !box || !box.width || !rect.width || !rect.height) return;
    var px = box.width / rect.width, py = box.height / rect.height;
    var id = "pmSparkDz" + (++sparkSeq);
    var ns = "http://www.w3.org/2000/svg";
    var defs = document.createElementNS(ns, "defs");
    defs.innerHTML =
      '<pattern id="' + id + '" patternUnits="userSpaceOnUse" width="' + 2 * px + '" height="' + 2 * py + '">' +
      '<rect class="pm-spark-dot" width="' + px + '" height="' + py + '"/>' +
      '<rect class="pm-spark-dot" x="' + px + '" y="' + py + '" width="' + px + '" height="' + py + '"/></pattern>';
    var area = document.createElementNS(ns, "polygon");
    area.setAttribute("class", "pm-spark-area");
    area.setAttribute("fill", "url(#" + id + ")");
    area.setAttribute("points", "0," + box.height + " " + line.getAttribute("points") + " " + box.width + "," + box.height);
    svg.insertBefore(defs, line);
    svg.insertBefore(area, line);
  }

  // Inside the observed subtree: only SVGs without an area get one, so the writes
  // this makes find nothing left to do on the next pass.
  function syncSparks() {
    $$("#main svg.sparkline").forEach(function (svg) {
      if (!$(".pm-spark-area", svg)) ditherSpark(svg);
    });
  }

  // Cell widths change at breakpoints; rebuild every area at the new size.
  window.matchMedia("(max-width: 720px)").addEventListener("change", function () {
    $$("#main svg.sparkline").forEach(function (svg) {
      $$(".pm-spark-area, defs", svg).forEach(function (n) { n.remove(); });
    });
  });

  window.addEventListener("load", function () { syncThemeName(); syncWeather(); syncAlloc(); syncSparks(); renderNav(); });
  syncThemeName();
  renderNav();
})();
