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
  var nav = el("nav", { class: "pm-nav", "aria-label": "Sections" });
  header.insertBefore(nav, header.firstChild);

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
    links.forEach(function (a) {
      if (a === current) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    });
  }

  document.addEventListener("scroll", markCurrent, { capture: true, passive: true });

  function goTo(index) {
    var link = $$("a", nav)[index];
    if (!link) return;
    var target = document.getElementById(link.hash.slice(1));
    if (index === 0) window.scrollTo({ top: 0 });
    else if (target) target.scrollIntoView();
    history.replaceState(null, "", index === 0 ? location.pathname + location.search : link.hash);
  }

  // ── Tools fold into one MENU chip: a popover on desktop, a sheet on phones ──
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
  }

  menuBtn.addEventListener("click", function () { setMenu(!header.classList.contains("pm-menu-open")); });

  // Close after the tool's own click handler has run.
  tools.addEventListener("click", function (e) {
    if (e.target.closest("button")) setTimeout(function () { setMenu(false); }, 0);
  });

  document.addEventListener("click", function (e) {
    if (header.classList.contains("pm-menu-open") && !tools.contains(e.target) && !menuBtn.contains(e.target)) setMenu(false);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && header.classList.contains("pm-menu-open")) { setMenu(false); menuBtn.focus(); }
  });

  // Crossing the phone breakpoint closes it, so it never jumps between sheet and popover.
  window.matchMedia("(max-width: 720px)").addEventListener("change", function () { setMenu(false); });

  nav.addEventListener("click", function (e) {
    var link = e.target.closest("a");
    if (!link) return;
    e.preventDefault();
    goTo($$("a", nav).indexOf(link));
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

  function setAllocOpen(open) {
    strip.setAttribute("aria-expanded", String(open));
    strip.title = open ? "Hide allocation" : "Show allocation";
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
      return '<span class="pm-strip__seg pm-tone-' + toneFor(it, i) + '" style="flex-grow:' + it.pct + '"></span>';
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

  // ── Footer: theme chip on the left, last update on the right ──

  var themeSelect = $("#newThemeSelect");
  var foot = $(".status-bar");
  var themeBtn = el("button", { type: "button", class: "pm-theme" },
    '<span class="chip">' + chip("T", "Theme") + '</span><span class="js-pm-theme-name"></span>');
  foot.insertBefore(themeBtn, foot.firstChild);

  function syncThemeName() {
    var opt = themeSelect && themeSelect.selectedOptions[0];
    var name = opt ? opt.textContent.trim().toLowerCase() : "";
    $(".js-pm-theme-name").textContent = name;
    themeBtn.setAttribute("aria-label", "Theme: " + name + ". Next theme");
  }

  function cycleTheme(delta) {
    if (!themeSelect) return;
    var n = themeSelect.options.length;
    themeSelect.selectedIndex = (themeSelect.selectedIndex + delta + n) % n;
    themeSelect.dispatchEvent(new Event("change"));
    syncThemeName();
  }

  themeBtn.addEventListener("click", function (e) { cycleTheme(e.shiftKey ? -1 : 1); });
  if (themeSelect) themeSelect.addEventListener("change", syncThemeName);

  // ── Keys: 1–4 sections, T / Shift+T theme, H amounts ──
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
    if (e.target.tagName === "TEXTAREA" || e.target.tagName === "BUTTON" || e.target.id === "newAddPositionPythSearch") return;
    e.preventDefault();
    primary.click();
  });

  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || modalOpen()) return;
    if (/^[1-9]$/.test(e.key)) { e.preventDefault(); goTo(Number(e.key) - 1); return; }
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
