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

  // Pointing at the value chart names the point on the card's bottom border. It lives
  // on <body>, outside the observed #main, so placing it doesn't re-run the observer.
  var readout = el("p", { class: "pm-card__readout", "aria-hidden": "true", hidden: "" });
  document.body.appendChild(readout);
  window.addEventListener("scroll", function () { readout.hidden = true; }, { passive: true });

  // ── Account value chart: Hyperliquid's own history, so it's the same on every device ──
  // Sits under the sentence: period choice on the left, change on the right, a line over
  // the dim dither. Pointing at it names the time and value on the card's bottom border.
  // Settings → Sections can hide it (html[data-value-chart="off"]).
  var PERIODS = [["day", "1D"], ["week", "1W"], ["month", "1M"], ["allTime", "All"]];
  var valueBox = el("div", { class: "pm-value", hidden: "" },
    '<div class="pm-value__head"><span class="pm-value__label">HL account</span>' +
    '<span class="pm-value__periods" role="radiogroup" aria-label="Period">' +
    PERIODS.map(function (p) { return '<button type="button" role="radio" class="pm-value__period" data-period="' + p[0] + '">' + p[1] + '</button>'; }).join("") +
    '</span><span class="pm-value__change"></span></div><div class="pm-value__chart"></div>');
  card.appendChild(valueBox);
  var valuePeriod = "week";
  try { valuePeriod = localStorage.getItem("pmValuePeriod") || "week"; } catch (_e) {}
  var valueData = null;
  var valueSeries = [];

  function hlAddresses() {
    try {
      var s = JSON.parse(localStorage.getItem("myDashboardSettings.v2") || "{}");
      return String(s.walletAddresses || "").split(/[\s,]+/).filter(function (a) { return /^0x[0-9a-fA-F]{40}$/.test(a); });
    } catch (_e) { return []; }
  }

  function money(v, signed) {
    var abs = Math.abs(v);
    var text = "$" + new Intl.NumberFormat(undefined, { notation: abs >= 10000 ? "compact" : "standard", maximumFractionDigits: abs >= 10000 ? 2 : 0 }).format(abs);
    return (v < 0 ? "−" : signed ? "+" : "") + text;
  }

  // Several addresses: add their values up, step by step, on the first one's timestamps.
  function combine(perAddress, period) {
    var lists = perAddress.map(function (p) { return p && p[period]; }).filter(Boolean);
    if (!lists.length) return null;
    var base = lists[0].values;
    var at = function (series, t) {
      var v = 0;
      for (var i = 0; i < series.length && series[i][0] <= t; i++) v = series[i][1];
      return v;
    };
    var values = base.map(function (pt) {
      return [pt[0], lists.reduce(function (sum, l) { return sum + at(l.values, pt[0]); }, 0)];
    });
    var pnl = lists.reduce(function (sum, l) { return sum + (l.pnl.length ? l.pnl[l.pnl.length - 1][1] : 0); }, 0);
    return { values: values, pnl: pnl };
  }

  function drawValue() {
    var chart = $(".pm-value__chart", valueBox);
    $$(".pm-value__period", valueBox).forEach(function (b) { b.setAttribute("aria-checked", String(b.dataset.period === valuePeriod)); });
    var data = valueData && combine(valueData, valuePeriod);
    if (!data || data.values.length < 2) {
      chart.innerHTML = '<p class="pm-value__empty">No history for this period.</p>';
      $(".pm-value__change", valueBox).textContent = "";
      valueSeries = [];
      return;
    }
    var first = data.values[0][1];
    var pct = first > 0 ? (data.pnl / first) * 100 : null;
    $(".pm-value__change", valueBox).textContent = money(data.pnl, true) + (pct !== null ? " (" + (pct >= 0 ? "+" : "−") + Math.abs(pct).toFixed(1) + "%)" : "");

    // Drawn at the box's real pixel size, so the 1px dither stays crisp.
    var w = Math.max(100, Math.round(chart.clientWidth));
    var h = Math.round((parseFloat(getComputedStyle(document.documentElement).getPropertyValue("font-size")) || 14) * 18 / 14 * 3);
    var ts = data.values.map(function (p) { return p[0]; });
    var vs = data.values.map(function (p) { return p[1]; });
    var t0 = Math.min.apply(null, ts), t1 = Math.max.apply(null, ts);
    var v0 = Math.min.apply(null, vs), v1 = Math.max.apply(null, vs);
    if (v1 === v0) { v0 -= 1; v1 += 1; }
    valueSeries = data.values.map(function (p) {
      return { t: p[0], v: p[1], x: (p[0] - t0) / (t1 - t0 || 1) * (w - 1), y: 1 + (1 - (p[1] - v0) / (v1 - v0)) * (h - 3) };
    });
    var pts = valueSeries.map(function (p) { return p.x.toFixed(1) + "," + p.y.toFixed(1); }).join(" ");
    chart.innerHTML =
      '<svg class="pm-value__svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" aria-hidden="true">' +
      '<defs><pattern id="pmValueDz" width="2" height="2" patternUnits="userSpaceOnUse"><rect class="pm-value__dot" width="1" height="1"/><rect class="pm-value__dot" x="1" y="1" width="1" height="1"/></pattern></defs>' +
      '<polygon points="0,' + h + " " + pts + " " + (w - 1) + "," + h + '" fill="url(#pmValueDz)"/>' +
      '<polyline points="' + pts + '" class="pm-value__line" fill="none"/>' +
      // Hover marker: moved by attributes (not style), which the page observer ignores.
      '<line class="pm-value__cursor" x1="0" x2="0" y1="0" y2="' + h + '" visibility="hidden"/>' +
      '<rect class="pm-value__point" width="5" height="5" x="0" y="0" visibility="hidden"/></svg>';
    chart.setAttribute("role", "img");
    chart.setAttribute("aria-label", "Hyperliquid account value, " + $(".pm-value__period[aria-checked=true]", valueBox).textContent + ": " + money(vs[0]) + " to " + money(vs[vs.length - 1]));
  }

  function loadValue() {
    var off = document.documentElement.dataset.valueChart === "off";
    var addresses = hlAddresses();
    if (off || !addresses.length) { valueBox.hidden = true; return; }
    import("./modules/data/hl-account.js").then(function (m) {
      return Promise.all(addresses.map(function (a) { return m.getPortfolio(a).catch(function () { return null; }); }));
    }).then(function (perAddress) {
      var any = perAddress.some(function (p) { return p && p.allTime && p.allTime.values.some(function (pt) { return pt[1] > 0; }); });
      valueBox.hidden = !any;
      if (!any) return;
      valueData = perAddress;
      drawValue();
    }).catch(function () { valueBox.hidden = true; });
  }

  $(".pm-value__periods", valueBox).addEventListener("click", function (e) {
    var b = e.target.closest(".pm-value__period");
    if (!b) return;
    valuePeriod = b.dataset.period;
    try { localStorage.setItem("pmValuePeriod", valuePeriod); } catch (_e) {}
    drawValue();
  });

  $(".pm-value__chart", valueBox).addEventListener("mousemove", function (e) {
    if (!valueSeries.length) return;
    var x = e.clientX - this.getBoundingClientRect().left;
    var near = valueSeries.reduce(function (best, p) { return Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best; });
    var cursor = $(".pm-value__cursor", this), point = $(".pm-value__point", this);
    if (cursor && point) {
      var cx = Math.round(near.x) + 0.5;
      cursor.setAttribute("x1", cx);
      cursor.setAttribute("x2", cx);
      cursor.setAttribute("visibility", "visible");
      point.setAttribute("x", (near.x - 2.5).toFixed(1));
      point.setAttribute("y", (near.y - 2.5).toFixed(1));
      point.setAttribute("visibility", "visible");
    }
    var when = new Date(near.t);
    var label = valuePeriod === "day"
      ? when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : when.toLocaleDateString(undefined, { month: "short", day: "numeric", year: valuePeriod === "allTime" ? "numeric" : undefined });
    readout.textContent = label + " · " + money(near.v);
    readout.hidden = false;
    var box = card.getBoundingClientRect();
    var left = this.getBoundingClientRect().left + near.x - readout.offsetWidth / 2;
    readout.style.left = Math.max(box.left + 1, Math.min(box.right - readout.offsetWidth - 8, left)) + "px";
    readout.style.top = (box.bottom - readout.offsetHeight / 2) + "px";
  });
  $(".pm-value__chart", valueBox).addEventListener("mouseleave", function () {
    readout.hidden = true;
    $$(".pm-value__cursor, .pm-value__point", this).forEach(function (n) { n.setAttribute("visibility", "hidden"); });
  });

  var valueResize = null;
  window.addEventListener("resize", function () {
    clearTimeout(valueResize);
    valueResize = setTimeout(function () { if (valueData) drawValue(); }, 150);
  });
  new MutationObserver(loadValue).observe(document.documentElement, { attributes: true, attributeFilter: ["data-value-chart"] });
  loadValue();
  setInterval(loadValue, 5 * 60 * 1000);

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

  // Account: Hyperliquid margin, funding, fees and staking, in a window of its own.
  // A chip of its own in the bar, beside MENU, so it's one click away.
  var accountItem = el("button", { type: "button", id: "pmAccountBtn", class: "pm-account-btn chip", "aria-haspopup": "dialog" },
    '<kbd>A</kbd><span class="chip__label">Account</span>');
  header.insertBefore(accountItem, menuBtn);
  function openAccount() {
    import("./modules/ui/account-window.js").then(function (m) { m.openAccountWindow(); });
  }
  accountItem.addEventListener("click", openAccount);

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
    if (e.key === "a" || e.key === "A") { e.preventDefault(); openAccount(); return; }
    if (e.key === "t" || e.key === "T") { e.preventDefault(); cycleTheme(e.shiftKey ? -1 : 1); return; }
    if (e.key === "h" || e.key === "H") {
      var btn = $("#newToggleAmountsBtn");
      if (btn) { e.preventDefault(); btn.click(); }
    }
  });

  // The app renders asynchronously and hides sections from settings; follow along.
  new MutationObserver(function () { syncWeather(); syncSparks(); renderNav(); }).observe($("#main"), { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "hidden", "class"] });

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

  window.addEventListener("load", function () { syncThemeName(); syncWeather(); syncSparks(); renderNav(); });
  syncThemeName();
  renderNav();
})();
