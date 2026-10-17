/* DOM, state, sheet, theme and keyboard handling. Search rules live in search.js. */
(function () {
  "use strict";

  const ENTRIES = prepareEntries(window.AREA_CODES);
  const byCode = Object.fromEntries(ENTRIES.map((e) => [e.code, e]));
  const state = { query: "", group: "ALL", openCode: null, lastFocus: null, selected: null, matchedCodes: null };

  const $ = (sel) => document.querySelector(sel);
  const root = document.documentElement;
  const input = $("#q");
  const searchBox = $("#search");
  const clearBtn = $("#clear");
  const chips = $("#chips");
  const countEl = $("#count");
  const results = $("#results");
  const scrim = $("#scrim");
  const sheet = $("#sheet");
  const sheetClose = $("#sheet-close");
  const copyBtn = $("#copy");

  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICON = {
    chevron: "M9,6L15,12L9,18",
    check: "M5,12.5L9.5,17L19,7",
  };

  function icon(d) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.75");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
    return svg;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* ---------- Map ---------- */
  const mapHost = $("#map");
  const tip = $("#map-tip");
  const mapNote = $("#map-note");
  const MAP_ZOOM = 1.6;

  const map = new AreaMap(mapHost, window.AREA_MAP, {
    onPick(codes) {
      if (codes.length) openSheet(codes[0]);
      else if (state.selected) selectZone(null);
    },
    onHover(info) {
      if (!info) {
        tip.hidden = true;
        return;
      }
      const shown = info.codes.slice(0, 5).join(" · ") + (info.codes.length > 5 ? " +" + (info.codes.length - 5) : "");
      tip.replaceChildren(el("b", "", shown), el("span", "", byCode[info.codes[0]].regions.join(" · ")));
      tip.hidden = false;
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      let x = info.x + 14;
      let y = info.y + 18;
      if (x + w > mapHost.clientWidth - 8) x = info.x - w - 14;
      if (y + h > mapHost.clientHeight - 8) y = info.y - h - 14;
      tip.style.transform = "translate(" + Math.max(8, x) + "px," + Math.max(8, y) + "px)";
    },
  });

  function updateNote() {
    let msg = "";
    if (state.selected) {
      const code = state.selected;
      if (!map.has(code)) {
        msg = byCode[code].group === "OTHER" ? "Non-geographic code — no area on the map." : "No outline available for +1 " + code + ".";
      } else {
        const src = map.borrowedFrom(code);
        if (src.length) msg = "Outline of the code(s) it overlays: " + src.join(", ") + ".";
      }
    } else if (state.matchedCodes && lastHits.length && !lastHits.some((h) => map.has(h.entry.code))) {
      msg = "These codes have no area on the map.";
    }
    mapNote.textContent = msg;
    mapNote.hidden = !msg;
  }

  function selectZone(code) {
    state.selected = code;
    map.setSelected(code);
    updateNote();
  }

  function syncMap(hits) {
    const filtered = state.query.trim() !== "" || state.group !== "ALL";
    state.matchedCodes = filtered ? hits.map((h) => h.entry.code) : null;
    selectZone(null);
    map.setMatched(state.matchedCodes);
    map.fit(state.matchedCodes);
  }

  $("#map-zoom-in").addEventListener("click", () => map.zoomBy(MAP_ZOOM));
  $("#map-zoom-out").addEventListener("click", () => map.zoomBy(1 / MAP_ZOOM));
  $("#map-reset").addEventListener("click", () => {
    selectZone(null);
    map.fit(state.matchedCodes);
  });

  // Hovering or focusing a list row lights up its zone on the map.
  let hoveredRow = null;
  function hoverRow(code) {
    if (code === hoveredRow) return;
    hoveredRow = code;
    map.setListHover(code);
  }

  /* ---------- Results ---------- */
  let lastHits = [];

  function rowFor({ entry, matchedCities }) {
    const row = el("button", "row");
    row.type = "button";
    row.dataset.code = entry.code;
    const main = el("span", "row-main");
    main.append(
      el("span", "row-title", entry.regions.join(" · ")),
      el("span", "row-sub", matchedCities.length ? matchedCities.join(", ") : entry.description),
    );
    row.append(el("span", "row-code", entry.code), main, icon(ICON.chevron));
    return row;
  }

  function render() {
    const hits = searchAreaCodes(ENTRIES, state.query, state.group);
    lastHits = hits;
    hoverRow(null);
    syncMap(hits);
    countEl.textContent = hits.length === 1 ? "1 area code" : hits.length + " area codes";
    if (!hits.length) {
      const empty = el("div", "empty");
      empty.append(
        el("p", "", "No area codes match “" + state.query.trim() + "”"),
        el("p", "", "Try a city, state, 3-digit code, or paste a phone number."),
      );
      results.replaceChildren(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const hit of hits) frag.appendChild(rowFor(hit));
    results.replaceChildren(frag);
  }

  function setQuery(value) {
    state.query = value;
    searchBox.classList.toggle("has-value", value !== "");
    render();
  }

  input.addEventListener("input", () => setQuery(input.value));
  clearBtn.addEventListener("click", () => {
    input.value = "";
    setQuery("");
    input.focus();
  });
  results.addEventListener("click", (ev) => {
    const row = ev.target.closest(".row");
    if (row) openSheet(row.dataset.code);
  });
  results.addEventListener("pointerover", (ev) => {
    if (ev.pointerType !== "mouse") return;
    const row = ev.target.closest(".row");
    hoverRow(row ? row.dataset.code : null);
  });
  results.addEventListener("pointerleave", () => hoverRow(null));
  results.addEventListener("focusin", (ev) => {
    const row = ev.target.closest(".row");
    hoverRow(row ? row.dataset.code : null);
  });
  results.addEventListener("focusout", () => hoverRow(null));

  chips.addEventListener("click", (ev) => {
    const chip = ev.target.closest("button[data-group]");
    if (!chip) return;
    state.group = chip.dataset.group;
    for (const c of chips.querySelectorAll("button[data-group]")) {
      c.setAttribute("aria-pressed", String(c === chip));
    }
    render();
  });

  /* ---------- Press feedback (minimum visible press: 70 ms) ---------- */
  document.addEventListener("pointerdown", (ev) => {
    const btn = ev.target.closest && ev.target.closest("button");
    if (!btn || btn.disabled) return;
    const started = performance.now();
    btn.classList.add("is-pressed");
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      document.removeEventListener("pointerup", release);
      document.removeEventListener("pointercancel", release);
      btn.removeEventListener("pointerleave", release);
      setTimeout(() => btn.classList.remove("is-pressed"), Math.max(0, 70 - (performance.now() - started)));
    };
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", release);
    btn.addEventListener("pointerleave", release);
  });

  /* ---------- Sheet ---------- */
  let cancelClose = null;
  let copyTimer = 0;

  function formatSince(since) {
    if (since.length === 4) return since;
    return new Date(since + "T00:00:00").toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function localTimes(zones) {
    const now = new Date();
    const seen = new Set();
    const lines = [];
    for (const zone of zones) {
      let time;
      try {
        time = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(now);
      } catch (_) {
        continue; // zone id unknown to this browser
      }
      let label = zone;
      try {
        const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longGeneric" })
          .formatToParts(now)
          .find((p) => p.type === "timeZoneName");
        if (part) label = part.value;
      } catch (_) {
        /* longGeneric unsupported: keep the IANA id */
      }
      const key = label + "|" + time;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(label + " · " + time);
    }
    return lines;
  }

  function fact(label, value) {
    const wrap = el("div", "fact");
    const dt = el("dt", "", label);
    const dd = el("dd");
    if (typeof value === "string") dd.textContent = value;
    else dd.appendChild(value);
    wrap.append(dt, dd);
    return wrap;
  }

  function setCopyLabel(kind) {
    const code = state.openCode;
    copyBtn.classList.toggle("is-error", kind === "failed");
    copyBtn.replaceChildren();
    if (kind === "copied") copyBtn.append(icon(ICON.check), "Copied");
    else if (kind === "failed") copyBtn.append("Copy failed");
    else copyBtn.append("Copy +1 " + code);
  }

  function fillSheet(e) {
    $("#sheet-code").textContent = e.code;
    $("#sheet-title").textContent = e.regions.join(" · ");
    $("#sheet-country").textContent = e.country;

    const facts = [];
    if (e.description) facts.push(fact("Coverage", e.description));
    if (e.since) facts.push(fact("In service", formatSince(e.since)));
    const times = localTimes(e.zones);
    if (times.length) {
      const box = el("div");
      for (const t of times) box.appendChild(el("div", "", t));
      facts.push(fact("Local time", box));
    }
    if (e.overlays.length) {
      const list = el("div", "chip-list");
      for (const code of e.overlays) {
        const b = el("button", "btn glass", "+1 " + code);
        b.type = "button";
        b.addEventListener("click", () => openSheet(code));
        list.appendChild(b);
      }
      facts.push(fact("Overlays", list));
    }
    if (e.cities.length) facts.push(fact("Cities (" + e.cities.length + ")", el("div", "cities", e.cities.join(" · "))));
    $("#sheet-facts").replaceChildren(...facts);

    clearTimeout(copyTimer);
    setCopyLabel("idle");
  }

  function openSheet(code) {
    const e = byCode[code];
    if (!e) return;
    if (cancelClose) cancelClose(); // reopened mid-close: keep the element, reverse the transition
    const wasOpen = state.openCode !== null;
    state.openCode = code;
    hoverRow(null);
    selectZone(code);
    map.fit([code]);
    fillSheet(e);
    if (!wasOpen) {
      if (!state.lastFocus) state.lastFocus = document.activeElement;
      scrim.hidden = false;
      sheet.hidden = false;
      void sheet.offsetHeight; // commit the closed position so the open transition runs
      scrim.classList.add("open");
      sheet.classList.add("open");
      document.body.style.overflow = "hidden";
    }
    sheet.scrollTop = 0;
    sheetClose.focus();
  }

  function closeSheet() {
    if (state.openCode === null) return;
    state.openCode = null;
    clearTimeout(copyTimer);
    scrim.classList.remove("open");
    sheet.classList.remove("open");
    let timer = 0;
    const cleanup = () => {
      sheet.removeEventListener("transitionend", onEnd);
      clearTimeout(timer);
      cancelClose = null;
    };
    const finish = () => {
      cleanup();
      sheet.hidden = true;
      scrim.hidden = true;
      document.body.style.overflow = "";
      const back = state.lastFocus;
      state.lastFocus = null;
      if (back) back.focus();
    };
    const onEnd = (ev) => {
      if (ev.target === sheet) finish();
    };
    sheet.addEventListener("transitionend", onEnd);
    timer = setTimeout(finish, 400);
    cancelClose = cleanup;
  }

  scrim.addEventListener("click", closeSheet);
  sheetClose.addEventListener("click", closeSheet);

  copyBtn.addEventListener("click", async () => {
    const code = state.openCode;
    if (!code) return;
    clearTimeout(copyTimer);
    let ok = true;
    try {
      await navigator.clipboard.writeText("+1 " + code);
    } catch (_) {
      ok = false;
    }
    if (state.openCode !== code) return;
    setCopyLabel(ok ? "copied" : "failed");
    copyTimer = setTimeout(() => setCopyLabel("idle"), 1500);
  });

  /* ---------- Keyboard ---------- */
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && lastHits.length) {
      ev.preventDefault();
      openSheet(lastHits[0].entry.code);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      if (input.value) {
        input.value = "";
        setQuery("");
      } else {
        input.blur();
      }
    }
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && state.openCode !== null) {
      ev.preventDefault();
      closeSheet();
      return;
    }
    if (ev.key === "/" && state.openCode === null && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      const a = document.activeElement;
      if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return;
      ev.preventDefault();
      input.focus();
      return;
    }
    if (ev.key === "Tab" && state.openCode !== null) {
      const focusable = sheet.querySelectorAll("button:not([disabled])");
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    }
  });

  /* ---------- Theme ---------- */
  const themeBox = $("#theme");
  const themeBtns = [...themeBox.querySelectorAll("button[data-mode]")];
  const indicator = themeBox.querySelector(".seg-indicator");
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  let mode = "auto";
  let fadeTimer = 0;

  try {
    mode = localStorage.getItem("acs-theme") || "auto";
  } catch (_) {}
  if (!themeBtns.some((b) => b.dataset.mode === mode)) mode = "auto";

  const resolveTheme = (m) => (m === "auto" ? (mq.matches ? "dark" : "light") : m);

  function fadeThemeChange() {
    root.classList.add("theme-fade");
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => root.classList.remove("theme-fade"), 340);
  }

  function syncThemeUI() {
    themeBtns.forEach((b, i) => {
      const on = b.dataset.mode === mode;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) themeBox.style.setProperty("--seg-index", String(i));
    });
  }

  function setMode(next, animate) {
    mode = next;
    try {
      localStorage.setItem("acs-theme", mode);
    } catch (_) {}
    if (animate) fadeThemeChange();
    root.dataset.theme = resolveTheme(mode);
    syncThemeUI();
  }

  // Initial state: jump the indicator to the saved mode without a glide.
  indicator.style.transition = "none";
  root.dataset.theme = resolveTheme(mode);
  syncThemeUI();
  void indicator.offsetWidth;
  indicator.style.transition = "";

  themeBox.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-mode]");
    if (b) setMode(b.dataset.mode, true);
  });

  themeBox.addEventListener("keydown", (ev) => {
    const i = themeBtns.findIndex((b) => b.dataset.mode === mode);
    let next = -1;
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown") next = (i + 1) % themeBtns.length;
    else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") next = (i + themeBtns.length - 1) % themeBtns.length;
    else if (ev.key === "Home") next = 0;
    else if (ev.key === "End") next = themeBtns.length - 1;
    if (next < 0) return;
    ev.preventDefault();
    setMode(themeBtns[next].dataset.mode, true);
    themeBtns[next].focus();
  });

  mq.addEventListener("change", () => {
    if (mode !== "auto") return;
    fadeThemeChange();
    root.dataset.theme = resolveTheme(mode);
  });

  render();
})();
