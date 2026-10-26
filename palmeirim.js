// palmeirim.com skin: reshapes the dashboard chrome into that site's vocabulary
// (an account chip, a framed portfolio card with time and weather in its
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

  var header = $(".app-header");

  // ── Tools fold into one MENU chip that drops down a framed list ──
  // It is the header's own tool row, restyled, so every button keeps the listeners
  // app.js gave it. Picking a tool, clicking outside or Esc closes it.

  var tools = $(".header-actions", header);
  tools.id = "pmTools";
  tools.setAttribute("aria-label", "Menu");
  var menuBtn = el("button", { type: "button", class: "pm-menu-btn chip", "aria-expanded": "false", "aria-controls": "pmTools", "aria-keyshortcuts": "M" },
    '<kbd aria-hidden="true">M</kbd><span class="chip__label">Menu</span>');

  // ACCOUNT, THEME and MENU sit flush in one framed strip at the left of the bar, as on
  // sacred.computer. MENU's list hangs from its chip, so the two share an anchor.
  var bar = el("div", { class: "pm-bar" });
  var menuAnchor = el("span", { class: "pm-dd-anchor" });
  menuAnchor.append(menuBtn, tools);
  bar.appendChild(menuAnchor);
  header.insertBefore(bar, header.firstChild);

  // The list ends in a footer, as SRCL's menus do: "Press escape to ESC CLOSE".
  var menuFoot = el("div", { class: "pm-dd__foot" },
    '<span class="pm-dd__hint">Press escape to</span>' +
    '<button type="button" class="chip pm-dd__esc"><kbd aria-hidden="true">Esc</kbd><span class="chip__label">Close</span></button>');
  tools.appendChild(menuFoot);
  $(".pm-dd__esc", menuFoot).addEventListener("click", function () { menuBtn.focus(); });

  // The update time sits at the right of the bar. Click it to drop down the sources,
  // as MENU drops down its list. Clicking outside or Esc closes it.
  var stamp = $("#lastUpdateTimestamp");
  var sources = $("#newProviderStatus");
  var stampAnchor = el("span", { class: "pm-dd-anchor pm-stamp" });
  if (stamp) {
    stampAnchor.appendChild(stamp);
    header.appendChild(stampAnchor);
  }
  function setSources(open) {
    stampAnchor.classList.toggle("is-open", open);
    if (stamp) stamp.setAttribute("aria-expanded", String(open));
  }
  if (stamp && sources) {
    stampAnchor.appendChild(sources);
    stamp.setAttribute("role", "button");
    stamp.setAttribute("tabindex", "0");
    stamp.setAttribute("aria-controls", "newProviderStatus");
    stamp.setAttribute("aria-expanded", "false");
    stamp.addEventListener("click", function () { setSources(!stampAnchor.classList.contains("is-open")); });
    stamp.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); stamp.click(); }
    });
    document.addEventListener("click", function (e) {
      if (stampAnchor.classList.contains("is-open") && !stampAnchor.contains(e.target)) setSources(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && stampAnchor.classList.contains("is-open")) { setSources(false); stamp.focus(); }
    });
  }

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
    if (e.key !== "Escape") return;
    if (header.classList.contains("pm-menu-open")) { setMenu(false); menuBtn.focus(); }
  });

  // In the open list ↑ ↓ move between tools, Home and End go to the ends. Tabbing out closes it.
  function menuItems() {
    // In the order they're shown: CSS moves Settings to the top. The footer's Esc is not a tool.
    return $$("button", tools).filter(function (b) { return !b.disabled && b.getClientRects().length && !b.closest(".pm-dd__foot"); })
      .sort(function (a, b) { return a.getBoundingClientRect().top - b.getBoundingClientRect().top; });
  }

  function openMenuAt(index) {
    setMenu(true);
    var items = menuItems();
    if (items.length) items[(index + items.length) % items.length].focus();
  }

  [menuBtn, tools].forEach(function (node) {
    node.addEventListener("keydown", function (e) {
      var items = menuItems();
      var i = items.indexOf(document.activeElement);
      var open = header.classList.contains("pm-menu-open");
      if (e.key === "ArrowDown" && (open || e.target === menuBtn)) { e.preventDefault(); openMenuAt(i + 1); }
      else if (e.key === "ArrowUp" && (open || e.target === menuBtn)) { e.preventDefault(); openMenuAt(i < 0 ? -1 : i - 1); }
      else if (e.key === "Home" && open && i >= 0) { e.preventDefault(); openMenuAt(0); }
      else if (e.key === "End" && open && i >= 0) { e.preventDefault(); openMenuAt(-1); }
    });
  });

  tools.addEventListener("focusout", function (e) {
    if (e.relatedTarget && !tools.contains(e.relatedTarget) && e.relatedTarget !== menuBtn) setMenu(false);
  });

  // Crossing the phone breakpoint closes the menu, so it never jumps between layouts.
  window.matchMedia("(max-width: 720px)").addEventListener("change", function () { setMenu(false); });

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

  // ── Portfolio value chart ──
  // Every account's own history added up (modules/data/portfolio-history.js), so the line is
  // the same on every device. Sits under the sentence: periods on the left (the chosen one
  // inverted), the change over the period on the right, a line over the dim dither. Pointing
  // at it names the value, its change and the time in a tag beside the point, as in the
  // chart window. Settings → Sections can hide it (html[data-value-chart="off"]).
  var PERIODS = [["day", "1D"], ["week", "1W"], ["month", "1M"], ["allTime", "All"]];
  // Shown from the start, its line's height kept while the history loads, so the
  // positions below don't jump when it arrives.
  var valueBox = el("div", { class: "pm-value" },
    '<div class="pm-value__head">' +
    '<span class="pm-value__periods" role="radiogroup" aria-label="Period">' +
    PERIODS.map(function (p) { return '<button type="button" role="radio" class="pm-value__period" data-period="' + p[0] + '">' + p[1] + '</button>'; }).join("") +
    '</span><span class="pm-value__change"></span></div><div class="pm-value__chart"></div>');
  card.appendChild(valueBox);
  var valuePeriod = "week";
  try { valuePeriod = localStorage.getItem("pmValuePeriod") || "week"; } catch (_e) {}
  var valueData = null; // { values: [[t, v]], currency, symbol } for valuePeriod
  var valueSeries = [];
  var valueSymbol = "$";
  var valueTag = el("p", { class: "pm-value__tag", "aria-hidden": "true", hidden: "" });

  // Written like the table's amounts: $561.5k, $126.4M.
  function money(v, signed) {
    var abs = Math.abs(v);
    var text = abs >= 1e9 ? (abs / 1e9).toFixed(1) + "B"
      : abs >= 1e6 ? (abs / 1e6).toFixed(1) + "M"
      : abs >= 1e4 ? (abs / 1e3).toFixed(1) + "k"
      : Math.round(abs).toLocaleString("en-US");
    return (v < 0 ? "−" : signed ? "+" : "") + valueSymbol + text;
  }

  function chartHeight() {
    return Math.round((parseFloat(getComputedStyle(document.documentElement).getPropertyValue("font-size")) || 14) * 18 / 14 * 6);
  }

  function drawValue() {
    var chart = $(".pm-value__chart", valueBox);
    $$(".pm-value__period", valueBox).forEach(function (b) { b.setAttribute("aria-checked", String(b.dataset.period === valuePeriod)); });
    var data = valueData;
    if (!data || data.values.length < 2) {
      // The line's height either way: empty while loading, then say there is none.
      chart.innerHTML = valueSettled ? '<p class="pm-value__empty">No history for this period.</p>' : "";
      chart.style.height = chartHeight() + "px";
      $(".pm-value__change", valueBox).textContent = "";
      valueSeries = [];
      return;
    }
    chart.style.height = "";
    valueSymbol = data.symbol || "$";
    var first = data.values[0][1];
    var pnl = data.values[data.values.length - 1][1] - first;
    var pct = first > 0 ? (pnl / first) * 100 : null;
    $(".pm-value__change", valueBox).textContent = money(pnl, true) + (pct !== null ? " (" + (pct >= 0 ? "+" : "−") + Math.abs(pct).toFixed(1) + "%)" : "");

    // Drawn at the box's real pixel size, so the 1px dither stays crisp.
    var w = Math.max(100, Math.round(chart.clientWidth));
    var h = chartHeight();
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
    valueTag.hidden = true;
    chart.appendChild(valueTag);
    chart.setAttribute("role", "img");
    chart.setAttribute("aria-label", "Portfolio value, " + $(".pm-value__period[aria-checked=true]", valueBox).textContent + ": " + money(vs[0]) + " to " + money(vs[vs.length - 1]));
  }

  // The series for the chosen period. The first draws come from the last snapshot while the
  // providers are still loading, so it loads again until they have all reported; after that
  // once a minute (the sources are cached, so that mostly re-adds cached series).
  var valueLoad = 0, valueSettled = false;
  function loadValue() {
    if (document.documentElement.dataset.valueChart === "off") { valueBox.hidden = true; return; }
    var period = valuePeriod, seq = ++valueLoad;
    import("./modules/data/portfolio-history.js").then(function (m) {
      // Settled with no rows yet is the boot, before any source has started: not settled.
      var settled = m.isPortfolioSettled() && ((window.venuePositions || window.cachedPositions || []).length > 0);
      return m.getPortfolioHistory(period).then(function (data) {
        if (seq !== valueLoad) return; // a newer load is on its way
        valueData = data;
        if (settled) valueSettled = true;
        valueBox.hidden = false;
        drawValue();
        // A source that failed (Hyperliquid rate-limits bursts) gets another go soon.
        if (!valueSettled || data.values.length < 2) setTimeout(loadValueIfSeen, valueSettled ? 15000 : 4000);
      });
    }).catch(function () { valueBox.hidden = true; });
  }

  $(".pm-value__periods", valueBox).addEventListener("click", function (e) {
    var b = e.target.closest(".pm-value__period");
    if (!b) return;
    valuePeriod = b.dataset.period;
    try { localStorage.setItem("pmValuePeriod", valuePeriod); } catch (_e) {}
    $$(".pm-value__period", valueBox).forEach(function (r) { r.setAttribute("aria-checked", String(r === b)); });
    loadValue();
  });

  // Pointing (mouse) or touching and dragging (finger) moves a cursor along the line, and
  // the tag beside the point names it: the value and its change since the period's start,
  // the time below. The tag sits on the side with room and stays inside the chart.
  var valueChart = $(".pm-value__chart", valueBox);
  function scrub(e) {
    if (!valueSeries.length) return;
    var x = e.clientX - valueChart.getBoundingClientRect().left;
    var near = valueSeries.reduce(function (best, p) { return Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best; });
    var cursor = $(".pm-value__cursor", valueChart), point = $(".pm-value__point", valueChart);
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
      ? when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: window.larpTimeZone })
      : when.toLocaleDateString(undefined, { month: "short", day: "numeric", year: valuePeriod === "allTime" ? "numeric" : undefined });
    var first = valueSeries[0].v;
    var pct = first > 0 ? (near.v / first - 1) * 100 : null;
    var value = el("span"), time = el("span", { class: "pm-value__tag-when" });
    value.textContent = money(near.v) + (pct !== null ? "  " + (pct < 0 ? "−" : "+") + Math.abs(pct).toFixed(2) + "%" : "");
    time.textContent = label;
    valueTag.replaceChildren(value, time);
    valueTag.hidden = false;
    var w = valueChart.clientWidth, h = valueChart.clientHeight, gap = 12;
    var tw = valueTag.offsetWidth, th = valueTag.offsetHeight;
    var left = near.x + gap + tw <= w ? near.x + gap : Math.max(0, near.x - gap - tw);
    var top = Math.max(0, Math.min(h - th, near.y - th - gap));
    valueTag.style.transform = "translate(" + Math.round(left) + "px, " + Math.round(top) + "px)";
  }
  function endScrub() {
    valueTag.hidden = true;
    $$(".pm-value__cursor, .pm-value__point", valueChart).forEach(function (n) { n.setAttribute("visibility", "hidden"); });
  }
  valueChart.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse") return;
    try { valueChart.setPointerCapture(e.pointerId); } catch (_e) {}
    scrub(e);
  });
  valueChart.addEventListener("pointermove", scrub);
  valueChart.addEventListener("pointerup", function (e) { if (e.pointerType !== "mouse") endScrub(); });
  valueChart.addEventListener("pointercancel", endScrub);
  valueChart.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") endScrub(); });

  // By keyboard: focus the chart, ← → step along the line, Home and End jump to its ends.
  // Starts at the latest point.
  var valueIndex = -1;
  valueChart.tabIndex = 0;
  valueChart.addEventListener("keydown", function (e) {
    if (!valueSeries.length || e.metaKey || e.ctrlKey || e.altKey) return;
    var last = valueSeries.length - 1;
    var from = valueIndex < 0 || valueIndex > last ? last : valueIndex;
    var step = Math.max(1, Math.round(valueSeries.length / 40));
    var next = { ArrowLeft: from - step, ArrowRight: from + step, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    e.stopPropagation(); // not the comic's ← →
    valueIndex = valueIndex < 0 && (e.key === "ArrowLeft" || e.key === "ArrowRight") ? last : Math.max(0, Math.min(last, next));
    var p = valueSeries[valueIndex];
    scrub({ clientX: valueChart.getBoundingClientRect().left + p.x, pointerType: "mouse" });
  });
  valueChart.addEventListener("blur", function () { valueIndex = -1; endScrub(); });

  var valueResize = null;
  window.addEventListener("resize", function () {
    clearTimeout(valueResize);
    valueResize = setTimeout(function () { if (valueData) drawValue(); }, 150);
  });
  new MutationObserver(loadValue).observe(document.documentElement, { attributes: true, attributeFilter: ["data-value-chart"] });
  drawValue();
  loadValue();
  // Not while the tab is in the background; once on return if a load was missed.
  var valueMissed = false;
  function loadValueIfSeen() {
    if (document.hidden) { valueMissed = true; return; }
    loadValue();
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden || !valueMissed) return;
    valueMissed = false;
    loadValue();
  });
  setInterval(loadValueIfSeen, 60 * 1000);

  function tick() {
    var text = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: window.larpTimeZone });
    var time = $(".js-pm-time");
    if (time.textContent !== text) time.textContent = text;
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

  // ── Theme: THEME drops down a list of every theme, with a search line ──
  // Pointing at (or arrowing to) a theme previews it on the page; clicking or Enter
  // keeps it; Esc, clicking outside or tabbing away puts the previous one back.
  // Settings → Theme opens the same list under its field. Themes you made come first.

  var themeSelect = $("#newThemeSelect");
  var themeSelectMobile = $("#newThemeSelectMobile");
  var themeChip = el("button", { type: "button", id: "pmThemeChip", class: "chip", "aria-haspopup": "dialog", "aria-expanded": "false", "aria-controls": "pmThemeDd", "aria-keyshortcuts": "T" },
    '<kbd aria-hidden="true">T</kbd><span class="chip__label">Theme</span>');
  bar.insertBefore(themeChip, menuAnchor);

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  function syncThemeName() {
    var opt = themeSelect && themeSelect.selectedOptions[0];
    // Settings writes it as its own list does: Dark, Game Boy
    var label = opt ? opt.textContent.trim() : "";
    $$(".js-pm-theme-label").forEach(function (n) { if (n.textContent !== label) n.textContent = label; });
    themeChip.setAttribute("aria-label", "Theme: " + label.toLowerCase() + ". Choose a theme");
  }

  function previewTheme(value) {
    document.documentElement.dataset.theme = value;
  }

  // Your own themes: kept on this device under their own key, so the app's settings
  // writes never drop them. Each becomes a CSS block (window.pmThemeCss, from index.html,
  // so the first paint has it too) and an option in the selects app.js listens to.
  var CUSTOM_KEY = "myDashboardCustomThemes";
  var customThemes = [];
  try { customThemes = JSON.parse(localStorage.getItem(CUSTOM_KEY)) || []; } catch (_e) {}
  function storeCustom() {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(customThemes)); } catch (_e) {}
  }
  var customStyle = $("#pmCustomThemes") || document.head.appendChild(el("style", { id: "pmCustomThemes" }));

  function renderCustom(draft) {
    customStyle.textContent = customThemes.concat(draft ? [draft] : []).map(window.pmThemeCss || function () { return ""; }).join("\n");
    [themeSelect, themeSelectMobile].forEach(function (sel) {
      if (!sel) return;
      var value = sel.value;
      $$("option[data-custom]", sel).forEach(function (o) { o.remove(); });
      customThemes.slice().reverse().forEach(function (t) {
        var o = el("option", { value: t.id, "data-custom": "" });
        o.textContent = t.name;
        sel.insertBefore(o, sel.firstChild);
      });
      if (value) sel.value = value;
    });
  }
  renderCustom();

  // Each theme's background, read once from the stylesheets, tags it [light] or [dark].
  var themeBgs = null;
  function themeBg(value) {
    var mine = customThemes.find(function (t) { return t.id === value; });
    if (mine) return mine.bg;
    if (!themeBgs) {
      themeBgs = {};
      Array.prototype.forEach.call(document.styleSheets, function (sheet) {
        var rules;
        try { rules = sheet.cssRules; } catch (_e) { return; }
        Array.prototype.forEach.call(rules || [], function (r) {
          var m = r.selectorText && r.selectorText.match(/^html\[data-theme="([^"]+)"\]$/);
          var bg = m && r.style && r.style.getPropertyValue("--bg").trim();
          if (bg) themeBgs[m[1]] = bg;
        });
      });
    }
    return themeBgs[value];
  }

  function rgbOf(color) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color || "");
    if (m) {
      var h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
      return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16); });
    }
    m = (color || "").match(/^rgba?\(([^)]+)\)/);
    return m ? m[1].split(/[ ,/]+/).slice(0, 3).map(Number) : null;
  }

  function luminance(rgb) {
    var c = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  var themeDd = el("div", { class: "pm-dd pm-theme-dd", id: "pmThemeDd", role: "dialog", "aria-label": "Theme", hidden: "" },
    '<label class="pm-dd__search"><span class="pm-dd__ic" aria-hidden="true">/</span>' +
    '<input type="search" class="js-pm-theme-find" placeholder="Search themes" aria-label="Search themes" aria-controls="pmThemeList" autocomplete="off" spellcheck="false"></label>' +
    '<div class="pm-dd__list" id="pmThemeList" role="listbox" aria-label="Themes"></div>' +
    '<button type="button" class="pm-dd__item pm-dd__new js-pm-theme-new"><span class="pm-dd__ic" aria-hidden="true">+</span><span class="pm-dd__tx">New theme</span></button>' +
    '<div class="pm-dd__foot"><span class="pm-dd__hint">Press escape to</span>' +
    '<button type="button" class="chip pm-dd__esc js-pm-theme-close"><kbd aria-hidden="true">Esc</kbd><span class="chip__label">Close</span></button></div>');
  document.body.appendChild(themeDd);
  var themeFind = $(".js-pm-theme-find", themeDd);
  var themeList = $(".pm-dd__list", themeDd);
  var themeBefore = null;
  var themeOpener = null;

  function themeRows() {
    var q = themeFind.value.trim().toLowerCase();
    var rows = Array.prototype.map.call(themeSelect.options, function (opt) {
      var name = opt.textContent.trim();
      if (q && name.toLowerCase().indexOf(q) < 0) return "";
      var on = opt.value === themeBefore;
      var mine = opt.hasAttribute("data-custom");
      var rgb = rgbOf(themeBg(opt.value));
      var tag = mine ? "mine" : rgb ? (luminance(rgb) > 0.18 ? "light" : "dark") : "";
      return '<div class="pm-dd__row" role="none">' +
        '<button type="button" class="pm-dd__item" role="option" data-value="' + esc(opt.value) + '" aria-selected="' + on + '">' +
        '<span class="pm-dd__ic" aria-hidden="true">' + (on ? "●" : "⊹") + '</span>' +
        '<span class="pm-dd__tx">' + esc(name) + (tag ? "<em>[" + tag + "]</em>" : "") + '</span></button>' +
        (mine ? '<button type="button" class="pm-dd__edit" data-edit="' + esc(opt.value) + '" aria-label="Edit ' + esc(name) + '">Edit</button>' : "") +
        '</div>';
    }).join("");
    themeList.innerHTML = rows || '<p class="pm-dd__empty">No theme matches.</p>';
  }

  // Under its opener, at its left edge, kept on screen; the list takes all the room below.
  // When it doesn't fit, it ends half way through a row, so the cut row shows there is more.
  function placeThemeDd() {
    var r = themeOpener.getBoundingClientRect();
    var lh = parseFloat(getComputedStyle(themeDd).lineHeight) || 18;
    themeDd.style.top = r.bottom + "px";
    themeDd.style.left = Math.max(8, Math.min(r.left, window.innerWidth - themeDd.offsetWidth - 8)) + "px";
    themeList.style.maxHeight = "";
    var chrome = themeDd.offsetHeight - themeList.offsetHeight;
    var room = window.innerHeight - r.bottom - chrome - lh / 2;
    if (themeList.scrollHeight > room) themeList.style.maxHeight = Math.max(4, Math.floor(room / lh) - 0.5) * lh + "px";
  }

  var coarse = window.matchMedia("(pointer: coarse)");
  function openThemeDd(opener) {
    if (!themeSelect) return;
    if (!themeDd.hidden) { var same = themeOpener === opener; closeThemeDd(false); if (same) return; }
    themeBefore = themeSelect.value;
    themeOpener = opener;
    themeFind.value = "";
    themeRows();
    // Settings makes the rest of the page inert (dialog-focus.js); the list belongs to its field.
    themeDd.inert = false;
    themeDd.hidden = false;
    opener.setAttribute("aria-expanded", "true");
    placeThemeDd();
    var current = $('[aria-selected="true"]', themeList);
    if (current) themeList.scrollTop = current.offsetTop - themeList.clientHeight / 2;
    // A phone would open its keyboard for the search; start on the current theme instead.
    (coarse.matches ? current || themeFind : themeFind).focus({ preventScroll: true });
  }

  function closeThemeDd(keep, refocus) {
    if (themeDd.hidden) return;
    if (!keep && themeBefore) previewTheme(themeBefore);
    themeDd.hidden = true;
    themeOpener.setAttribute("aria-expanded", "false");
    if (refocus !== false && themeOpener.focus) themeOpener.focus();
  }

  function chooseTheme(value) {
    themeBefore = value; // a late mouseleave on the hidden list previews this, not the old theme
    themeSelect.value = value;
    themeSelect.dispatchEvent(new Event("change"));
    syncThemeName();
    closeThemeDd(true);
  }

  themeChip.addEventListener("click", function () { openThemeDd(themeChip); });
  var settingsTheme = $("#settingsThemeBtn");
  if (settingsTheme) {
    settingsTheme.setAttribute("aria-controls", "pmThemeDd");
    settingsTheme.setAttribute("aria-expanded", "false");
    settingsTheme.addEventListener("click", function () { openThemeDd(settingsTheme); });
  }

  themeFind.addEventListener("input", function () {
    themeRows();
    var first = $(".pm-dd__item[role=option]", themeList);
    previewTheme(first ? first.dataset.value : themeBefore);
  });

  themeDd.addEventListener("click", function (e) {
    var edit = e.target.closest(".pm-dd__edit");
    var opt = e.target.closest(".pm-dd__item[role=option]");
    if (edit) { closeThemeDd(false, false); openMaker(edit.dataset.edit); }
    else if (opt) chooseTheme(opt.dataset.value);
    else if (e.target.closest(".js-pm-theme-new")) { closeThemeDd(false, false); openMaker(null); }
    else if (e.target.closest(".js-pm-theme-close")) closeThemeDd(false);
  });

  // Pointing or focusing previews; leaving the list shows the focused one, or the one you started with.
  themeList.addEventListener("mouseover", function (e) {
    var opt = e.target.closest(".pm-dd__item");
    if (opt) previewTheme(opt.dataset.value);
  });
  themeList.addEventListener("focusin", function (e) {
    var opt = e.target.closest(".pm-dd__item");
    if (opt) previewTheme(opt.dataset.value);
  });
  themeList.addEventListener("mouseleave", function () {
    if (themeDd.hidden) return;
    var focused = document.activeElement && document.activeElement.closest(".pm-dd__item[role=option]");
    previewTheme(focused ? focused.dataset.value : themeBefore);
  });

  document.addEventListener("click", function (e) {
    if (!themeDd.hidden && !themeDd.contains(e.target) && !themeOpener.contains(e.target)) closeThemeDd(false, false);
  });
  themeDd.addEventListener("focusout", function (e) {
    if (e.relatedTarget && !themeDd.contains(e.relatedTarget)) closeThemeDd(false, false);
  });
  window.addEventListener("resize", function () { closeThemeDd(false, false); });

  // Search: ↓ goes into the list, ↵ keeps the first match. List: ↑ ↓ Home End move,
  // ↑ from the top goes back to the search, and typing goes on searching.
  themeDd.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeThemeDd(false); return; }
    var opts = $$(".pm-dd__item[role=option]", themeList);
    if (e.target === themeFind) {
      if (e.key === "ArrowDown" && opts.length) { e.preventDefault(); opts[0].focus(); }
      else if (e.key === "Enter") { e.preventDefault(); if (opts.length) chooseTheme(opts[0].dataset.value); }
      e.stopPropagation(); // the page's own keys don't fire while you type
      return;
    }
    var i = opts.indexOf(document.activeElement);
    if (i < 0) return;
    var next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: opts.length - 1 }[e.key];
    if (next !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      if (next < 0) themeFind.focus();
      else opts[Math.min(next, opts.length - 1)].focus();
    } else if ((e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && e.key !== " ") || e.key === "Backspace") {
      e.stopPropagation();
      themeFind.focus(); // the key lands in the search
    }
  });

  // ── Your own theme: four colours, shown on the page as you pick them ──

  var MAKER_COLOURS = [["bg", "Background", "--bg"], ["ink", "Text", "--pm-ink"], ["green", "Gains", "--green"], ["red", "Losses", "--red"]];
  var makerBackdrop = el("div", { class: "settings-backdrop", style: "display: none;" });
  var maker = el("div", { class: "sticker-window pm-maker", role: "dialog", "aria-modal": "true", "aria-labelledby": "pmMakerTitle", style: "display: none;" },
    '<div class="sticker-window-header"><h2 id="pmMakerTitle" class="window-title">New theme</h2>' +
    '<button type="button" class="btn-text js-pm-maker-close">Close</button></div>' +
    '<div class="sticker-window-content"><form class="pm-maker__form" novalidate>' +
    '<div class="pm-maker__field"><label for="pmMakerName">Name</label>' +
    '<input type="text" id="pmMakerName" name="name" maxlength="24" autocomplete="off" spellcheck="false" placeholder="My theme"></div>' +
    MAKER_COLOURS.map(function (c) {
      return '<div class="pm-maker__field"><label for="pmMaker-' + c[0] + '">' + c[1] + '</label>' +
        '<input type="color" id="pmMaker-' + c[0] + '" name="' + c[0] + '">' +
        '<input type="text" class="pm-maker__hex" name="' + c[0] + 'Hex" maxlength="7" autocomplete="off" spellcheck="false" aria-label="' + c[1] + ', hex"></div>';
    }).join("") +
    '<p class="pm-maker__sample" aria-hidden="true">BTC <span class="pm-maker__up">+2.4%</span> · ETH <span class="pm-maker__down">−1.1%</span> · <span class="pm-maker__muted">Updated 18:32</span></p>' +
    '<p class="pm-maker__note" aria-live="polite"></p>' +
    '<div class="form-actions"><button type="button" class="btn-text form-delete js-pm-maker-delete" hidden>Delete</button>' +
    '<button type="submit" class="btn-text btn-primary">Save</button></div>' +
    '</form></div>');
  document.body.append(makerBackdrop, maker);
  var makerForm = $("form", maker);
  var makerEditing = null; // the saved theme being changed, or null for a new one
  var makerBefore = null;
  var makerOpener = null;
  var makerOverModal = false;

  // The painted value of a colour variable, as #rrggbb, to start from the theme you have.
  function cssHex(prop) {
    var probe = el("span", { style: "color: var(" + prop + ")" });
    document.body.appendChild(probe);
    var rgb = rgbOf(getComputedStyle(probe).color);
    probe.remove();
    return rgb ? "#" + rgb.map(function (n) { return ("0" + Math.round(n).toString(16)).slice(-2); }).join("") : "#000000";
  }

  function makerTheme() {
    var t = { id: makerEditing ? makerEditing.id : "custom-draft", name: makerForm.name.value.trim() || "My theme" };
    MAKER_COLOURS.forEach(function (c) { t[c[0]] = makerForm[c[0]].value.toLowerCase(); });
    return t;
  }

  function makerPreview() {
    var t = makerTheme();
    renderCustom(t);
    previewTheme(t.id);
    var ratio = (luminance(rgbOf(t.ink)) + 0.05) / (luminance(rgbOf(t.bg)) + 0.05);
    if (ratio < 1) ratio = 1 / ratio;
    $(".pm-maker__note", maker).textContent = "Text contrast " + ratio.toFixed(1) + ":1." +
      (ratio < 4.5 ? " This is low. Text can be hard to read." : "");
  }

  function openMaker(id) {
    makerEditing = customThemes.find(function (t) { return t.id === id; }) || null;
    makerBefore = themeSelect.value;
    makerOpener = themeOpener || themeChip;
    makerOverModal = document.body.classList.contains("modal-open");
    $("#pmMakerTitle").textContent = makerEditing ? "Edit theme" : "New theme";
    $(".js-pm-maker-delete", maker).hidden = !makerEditing;
    makerForm.name.value = makerEditing ? makerEditing.name : "";
    MAKER_COLOURS.forEach(function (c) {
      var v = makerEditing ? makerEditing[c[0]] : cssHex(c[2]);
      makerForm[c[0]].value = v;
      makerForm[c[0] + "Hex"].value = v;
    });
    makerBackdrop.style.display = "block";
    maker.style.display = "flex";
    document.body.classList.add("modal-open");
    makerPreview();
    makerForm.name.focus();
  }

  function closeMaker(kept) {
    if (maker.style.display === "none") return;
    renderCustom(); // drops the draft
    if (!kept) previewTheme(makerBefore);
    makerBackdrop.style.display = "none";
    maker.style.display = "none";
    if (!makerOverModal) document.body.classList.remove("modal-open");
    if (makerOpener && makerOpener.focus) makerOpener.focus();
  }

  // A colour well and its hex field follow each other; a hex counts once it is whole.
  makerForm.addEventListener("input", function (e) {
    var name = e.target.name || "";
    if (e.target.type === "color") makerForm[name + "Hex"].value = e.target.value;
    else if (/Hex$/.test(name)) {
      var v = e.target.value.trim();
      if (v && v[0] !== "#") v = "#" + v;
      if (!/^#[0-9a-f]{6}$/i.test(v)) return;
      makerForm[name.slice(0, -3)].value = v.toLowerCase();
    }
    makerPreview();
  });

  makerForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var t = makerTheme();
    if (!makerEditing) t.id = "custom-" + Date.now().toString(36);
    var at = customThemes.findIndex(function (x) { return x.id === t.id; });
    if (at >= 0) customThemes[at] = t; else customThemes.push(t);
    storeCustom();
    renderCustom();
    themeSelect.value = t.id;
    themeSelect.dispatchEvent(new Event("change"));
    syncThemeName();
    closeMaker(true);
  });

  $(".js-pm-maker-delete", maker).addEventListener("click", function () {
    var id = makerEditing.id;
    customThemes = customThemes.filter(function (t) { return t.id !== id; });
    storeCustom();
    var wasOn = makerBefore === id;
    renderCustom();
    if (wasOn) {
      themeSelect.value = "dark";
      themeSelect.dispatchEvent(new Event("change"));
      syncThemeName();
      makerBefore = "dark";
    }
    closeMaker(false);
  });

  $(".js-pm-maker-close", maker).addEventListener("click", function () { closeMaker(false); });
  makerBackdrop.addEventListener("click", function () { closeMaker(false); });
  maker.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMaker(false); }
  });

  // The footer's Retry, on a source that failed, refreshes everything, as R does.
  document.addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest(".provider-line__retry")) return;
    var refresh = $("#newRefreshBtn");
    if (refresh) refresh.click();
  });

  // ── Settings drop-downs, as SRCL's select: a ▼ cell, then the value; open, the options
  // list in place under the field and the window grows. With a mouse only: touch keeps the
  // phone's own picker. The <select> stays the source of truth, so the app still reads it
  // and hears its change event. ──

  var SELECT = ".settings-panes .select:not(.larp-cell) > select";
  var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  var selOpen = null; // the open <select>

  function closeSel(refocus) {
    if (!selOpen) return;
    var select = selOpen;
    selOpen = null;
    var wrap = select.parentNode;
    wrap.classList.remove("is-open");
    var list = $(".pm-sel__list", wrap);
    if (list) list.remove();
    if (refocus) select.focus();
  }

  function openSel(select) {
    closeSel(false);
    selOpen = select;
    var wrap = select.parentNode;
    var label = select.getAttribute("aria-label") || (select.closest("label") && select.closest("label").textContent.trim().split("\n")[0]) || "Options";
    var list = el("div", { class: "pm-sel__list", role: "listbox", "aria-label": label });
    list.innerHTML = Array.prototype.map.call(select.options, function (o, i) {
      return '<button type="button" role="option" data-index="' + i + '" aria-selected="' + (i === select.selectedIndex) + '"' +
        (o.disabled ? " disabled" : "") + ">" + esc(o.textContent.trim()) + "</button>";
    }).join("");
    wrap.appendChild(list);
    wrap.classList.add("is-open");
    ($('[aria-selected="true"]', list) || list.firstElementChild).focus();
  }

  function pickSel(button) {
    var select = selOpen;
    var index = +button.dataset.index;
    closeSel(true);
    if (select.selectedIndex === index) return;
    select.selectedIndex = index;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  document.addEventListener("mousedown", function (e) {
    var select = e.target.closest && e.target.closest(SELECT);
    if (!select || !finePointer.matches || select.disabled) return;
    e.preventDefault(); // no native list
    if (selOpen === select) closeSel(true);
    else openSel(select);
  }, true);

  document.addEventListener("keydown", function (e) {
    var select = e.target.closest && e.target.closest(SELECT);
    if (select && finePointer.matches && !selOpen &&
      (e.key === " " || e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "F4")) {
      e.preventDefault();
      e.stopPropagation();
      openSel(select);
      return;
    }
    if (!selOpen || !e.target.closest(".pm-sel__list")) return;
    var opts = $$("button:not(:disabled)", selOpen.parentNode);
    var i = opts.indexOf(document.activeElement);
    var next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: opts.length - 1 }[e.key];
    if (next !== undefined) {
      e.preventDefault();
      opts[Math.max(0, Math.min(opts.length - 1, next))].focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // closes the list, not Settings
      closeSel(true);
    } else if (e.key === "Tab") closeSel(false);
  }, true);

  document.addEventListener("click", function (e) {
    if (!selOpen) return;
    var opt = e.target.closest(".pm-sel__list button");
    if (opt) pickSel(opt);
    else if (!selOpen.parentNode.contains(e.target)) closeSel(false);
  });

  // ── Shortcuts: ? (or the menu's last item) lists every key in a window ──

  var SHORTCUTS = [
    ["/", "Search positions"],
    ["↑ ↓", "Move between rows"],
    ["↵", "Open or close a row"],
    ["E", "Edit the open position"],
    ["H", "Hide or show the open position"],
    ["⌫", "Delete or remove the open item"],
    ["Esc", "Close"],
    ["U", "Undo the last change"],
    ["1–4", "Go to Portfolio, Positions, Watchlist, Comics"],
    ["H", "Hide or show amounts"],
    ["R", "Refresh"],
    ["P", "Add a position"],
    ["W", "Add to the watchlist"],
    ["A", "Account: margin, funding, fees"],
    ["S", "Settings"],
    ["M", "Menu"],
    ["T", "Theme: pick or search"],
    ["N", "Snow on or off"],
    ["Y", "Rain on or off"],
    ["K", "Stickers"],
    ["G", "Donate"],
    ["← →", "Previous or next comic"],
    ["C", "Next comic strip (Shift+C: previous)"],
    ["X", "Random comic"],
    ["D", "Download the comic"],
    ["← →", "In a chart: move along the line"],
    ["↑ ↓", "In the chart window: previous or next item"],
    ["1–7", "In the chart window: period"],
    ["P H V D L", "In the chart window: position, high/low, volume, days, log scale"],
    ["A", "In the chart window: the list as a grid, or back"],
    ["← → ↑ ↓", "In the grid: move between charts (Shift: move the chart)"],
    ["⌫ P +", "In the grid: remove, prices, add"],
    ["← → ↑ ↓", "On a sticker: move it (Shift: further)"],
    ["+ −", "On a sticker: make it bigger or smaller"],
    ["[ ]", "On a sticker: turn it"],
    ["?", "Show these keys"]
  ];

  var keysItem = el("button", { type: "button", id: "pmKeysBtn", class: "btn-text", "aria-haspopup": "dialog" }, "Shortcuts");
  tools.appendChild(keysItem);

  // Account: Hyperliquid margin, funding, fees and staking, in a window of its own.
  // A chip of its own at the left of the bar, so it's one click away.
  var accountItem = el("button", { type: "button", id: "pmAccountBtn", class: "pm-account-btn chip", "aria-haspopup": "dialog", "aria-keyshortcuts": "A" },
    '<kbd aria-hidden="true">A</kbd><span class="chip__label">Account</span>');
  bar.insertBefore(accountItem, bar.firstChild);
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

  // ── Keys: ? lists them, A account, M menu, T themes, H amounts ──
  // The rest are the app's own shortcuts (modules/features/keyboard-shortcuts.js).

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
    if (e.key === "?") { e.preventDefault(); openKeys(); return; }
    if (e.key === "a" || e.key === "A") { e.preventDefault(); openAccount(); return; }
    if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      if (header.classList.contains("pm-menu-open")) { setMenu(false); menuBtn.focus(); } else openMenuAt(0);
      return;
    }
    if (e.key === "t" || e.key === "T") { e.preventDefault(); openThemeDd(themeChip); return; }
    if (e.key === "h" || e.key === "H") {
      var btn = $("#newToggleAmountsBtn");
      if (btn) { e.preventDefault(); btn.click(); }
    }
  });

  // The app renders asynchronously and hides sections from settings; follow along.
  new MutationObserver(function () { syncWeather(); syncSparks(); }).observe($("#main"), { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "hidden", "class"] });

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

  window.addEventListener("load", function () { syncThemeName(); syncWeather(); syncSparks(); });
  syncThemeName();
})();
