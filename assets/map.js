/* Canvas map of area-code zones. Classic script; defines the global AreaMap.
   Zone data (assets/map-data.js) is Web Mercator, so OpenStreetMap raster tiles (roads, water, towns, labels)
   drag along underneath; in the dark theme they are inverted into a dark map. Without a network the tiles
   simply don't load and the zone outlines still draw on their own. */
class AreaMap {
  static TILE = 256; // css px per tile at the tile zoom level
  static MAX_Z = 18;
  // Standard OSM tiles are light; this turns them into a dark map (cached once per tile, see #source).
  static DARK_FILTER = "invert(1) hue-rotate(180deg) saturate(0.7) brightness(0.92) contrast(0.92)";

  /* host: positioned element to fill. data: window.AREA_MAP.
     opts.onPick(codes)  — click/tap; codes under the point, smallest zone first ([] on empty space)
     opts.onHover(info)  — info = { codes, x, y } (host-relative px) or null */
  constructor(host, data, opts) {
    this.host = host;
    this.data = data;
    this.opts = opts;
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");

    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this.v = null; // view: { cx, cy, k } — world centre and px per unit
    this.pendingBBox = data.view;
    this.matched = null; // Set of codes, or null when nothing filters the map
    this.selected = null;
    this.listHover = null;
    this.mapHover = [];
    this.anim = null;
    this.drawQueued = false;
    this.world = data.world;
    this.tiles = new Map(); // "z/x/y" -> { img, ok, dark }, in LRU order
    this.darkOk = typeof CanvasRenderingContext2D !== "undefined" && "filter" in CanvasRenderingContext2D.prototype;
    this.theme = "dark";
    this.kFitAll = 0.001;
    this.kMin = 0.0005;
    this.kMax = (2 ** AreaMap.MAX_Z * AreaMap.TILE) / data.world;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    this.#buildZones();
    this.#refreshColors();
    this.#bindInput();

    new ResizeObserver(() => this.#layout()).observe(host);
    new MutationObserver(() => {
      this.#refreshColors();
      this.#queueDraw();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.#queueDraw());
  }

  /* ---------- data ---------- */
  #decode(s) {
    const rings = [];
    let best = -1;
    let bestArea = -1;
    let areaSum = 0;
    const path = new Path2D();
    for (const flat of s.r) {
      const n = flat.length / 2;
      const r = new Int32Array(flat.length);
      r[0] = flat[0];
      r[1] = flat[1];
      for (let i = 2; i < flat.length; i += 2) {
        r[i] = r[i - 2] + flat[i];
        r[i + 1] = r[i - 1] + flat[i + 1];
      }
      path.moveTo(r[0], r[1]);
      for (let i = 1; i < n; i++) path.lineTo(r[2 * i], r[2 * i + 1]);
      path.closePath();
      let a = 0;
      for (let i = 0, j = n - 1; i < n; j = i++) a += r[2 * j] * r[2 * i + 1] - r[2 * i] * r[2 * j + 1];
      a = Math.abs(a) / 2;
      areaSum += a;
      if (a > bestArea) {
        bestArea = a;
        best = rings.length;
      }
      rings.push(r);
    }
    return { b: s.b, rings, path, area: areaSum, label: this.#centroid(rings[best]) };
  }

  #centroid(r) {
    const n = r.length / 2;
    const ox = r[0];
    const oy = r[1];
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xj = r[2 * j] - ox;
      const yj = r[2 * j + 1] - oy;
      const xi = r[2 * i] - ox;
      const yi = r[2 * i + 1] - oy;
      const f = xj * yi - xi * yj;
      a += f;
      cx += (xj + xi) * f;
      cy += (yj + yi) * f;
    }
    if (a === 0) return [r[0], r[1]];
    return [ox + cx / (3 * a), oy + cy / (3 * a)];
  }

  #buildZones() {
    const shapes = new Map(Object.entries(this.data.shapes).map(([c, s]) => [c, this.#decode(s)]));
    this.zones = new Map();
    const codes = new Set([...shapes.keys(), ...Object.keys(this.data.alias)]);
    for (const code of codes) {
      const own = shapes.get(code);
      const sources = own ? [] : this.data.alias[code];
      const parts = own ? [own] : sources.map((c) => shapes.get(c));
      const b = parts[0].b.slice();
      for (const p of parts) {
        b[0] = Math.min(b[0], p.b[0]);
        b[1] = Math.min(b[1], p.b[1]);
        b[2] = Math.max(b[2], p.b[2]);
        b[3] = Math.max(b[3], p.b[3]);
      }
      const biggest = parts.reduce((m, p) => (p.area > m.area ? p : m));
      this.zones.set(code, {
        code,
        parts,
        bbox: b,
        area: parts.reduce((s, p) => s + p.area, 0),
        label: biggest.label,
        sources,
      });
    }
    this.order = [...this.zones.values()].sort((a, b) => b.area - a.area); // big first: small zones paint on top
  }

  has(code) {
    return this.zones.has(code);
  }

  /* Codes whose outline this code borrows (overlays created after the boundary data), or []. */
  borrowedFrom(code) {
    return this.zones.get(code)?.sources ?? [];
  }

  /* ---------- colours ---------- */
  #refreshColors() {
    const cs = getComputedStyle(document.documentElement);
    const ink = cs.getPropertyValue("--ink-rgb").trim().split(/\s+/).map(Number);
    const hex = cs.getPropertyValue("--accent").trim().replace("#", "");
    const accent = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const bg = cs.getPropertyValue("--bg").trim().replace("#", "");
    this.col = { ink, accent, bg: [0, 2, 4].map((i) => parseInt(bg.slice(i, i + 2), 16)) };
    this.theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  }

  #rgba(c, a) {
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  }

  /* ---------- layout / view ---------- */
  #layout() {
    const W = this.host.clientWidth;
    const H = this.host.clientHeight;
    if (!W || !H) return;
    const first = !this.v;
    this.W = W;
    this.H = H;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(W * this.dpr);
    this.canvas.height = Math.round(H * this.dpr);
    const [x0, y0, x1, y1] = this.data.view;
    const pad = this.#pad();
    this.kFitAll = Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (y1 - y0));
    this.kMin = this.kFitAll * 0.5;
    if (first) this.#applyFit(false);
    else this.#queueDraw();
  }

  #pad() {
    return Math.max(16, Math.min(56, Math.min(this.W, this.H) * 0.1));
  }

  #clampK(k) {
    return Math.min(this.kMax, Math.max(this.kMin, k));
  }

  #applyFit(animate) {
    const [x0, y0, x1, y1] = this.pendingBBox;
    const pad = this.#pad();
    const k = this.#clampK(Math.min((this.W - 2 * pad) / Math.max(x1 - x0, 1), (this.H - 2 * pad) / Math.max(y1 - y0, 1)));
    this.#moveTo({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, k }, animate);
  }

  /* codes: iterable of codes to frame, or null/empty for the whole map. */
  fit(codes, animate = true) {
    let b = null;
    if (codes) {
      for (const c of codes) {
        const z = this.zones.get(c);
        if (!z) continue;
        if (!b) b = z.bbox.slice();
        else {
          b[0] = Math.min(b[0], z.bbox[0]);
          b[1] = Math.min(b[1], z.bbox[1]);
          b[2] = Math.max(b[2], z.bbox[2]);
          b[3] = Math.max(b[3], z.bbox[3]);
        }
      }
    }
    this.pendingBBox = b || this.data.view;
    if (this.W) this.#applyFit(animate);
  }

  zoomBy(factor) {
    if (!this.v) return;
    const base = this.anim ? this.anim.to : this.v;
    this.#moveTo({ cx: base.cx, cy: base.cy, k: this.#clampK(base.k * factor) }, true);
  }

  #moveTo(to, animate) {
    this.anim = null;
    if (!animate || this.reduced.matches || !this.v) {
      this.v = to;
      this.#queueDraw();
      return;
    }
    this.anim = { from: { ...this.v }, to, t0: performance.now(), dur: 362 };
    this.#queueDraw();
  }

  #step(now) {
    const a = this.anim;
    if (!a) return;
    const t = Math.min(1, (now - a.t0) / a.dur);
    // critically damped spring, x(τ) = 1 - (1 + ωτ)e^(-ωτ), normalised so it lands exactly on 1
    const w = 5.83;
    const e = (1 - (1 + w * t) * Math.exp(-w * t)) / (1 - (1 + w) * Math.exp(-w));
    this.v = {
      cx: a.from.cx + (a.to.cx - a.from.cx) * e,
      cy: a.from.cy + (a.to.cy - a.from.cy) * e,
      k: Math.exp(Math.log(a.from.k) + (Math.log(a.to.k) - Math.log(a.from.k)) * e),
    };
    if (t >= 1) this.anim = null;
  }

  /* ---------- state from the app ---------- */
  setMatched(codes) {
    this.matched = codes ? new Set(codes) : null;
    this.#queueDraw();
  }

  setSelected(code) {
    this.selected = code;
    this.#queueDraw();
  }

  setListHover(code) {
    this.listHover = code;
    this.#queueDraw();
  }

  /* ---------- input ---------- */
  #toWorld(px, py) {
    return [this.v.cx + (px - this.W / 2) / this.v.k, this.v.cy + (py - this.H / 2) / this.v.k];
  }

  #hit(px, py) {
    if (!this.v) return [];
    const [x, y] = this.#toWorld(px, py);
    const hits = [];
    for (const z of this.zones.values()) {
      const b = z.bbox;
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      if (z.parts.some((p) => AreaMap.#inside(p, x, y))) hits.push(z);
    }
    hits.sort((a, b) => a.area - b.area || (a.code < b.code ? -1 : 1));
    return hits.map((z) => z.code);
  }

  static #inside(p, x, y) {
    const b = p.b;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
    let inside = false;
    for (const r of p.rings) {
      const n = r.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = r[2 * i];
        const yi = r[2 * i + 1];
        const xj = r[2 * j];
        const yj = r[2 * j + 1];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  }

  #zoomAt(px, py, factor) {
    const base = this.v;
    const k = this.#clampK(base.k * factor);
    const [wx, wy] = this.#toWorld(px, py);
    this.anim = null;
    this.v = { cx: wx - (px - this.W / 2) / k, cy: wy - (py - this.H / 2) / k, k };
    this.#queueDraw();
  }

  #setMapHover(codes, x, y) {
    const same = codes.length === this.mapHover.length && codes.every((c, i) => c === this.mapHover[i]);
    this.mapHover = codes;
    this.host.style.cursor = codes.length ? "pointer" : "";
    this.opts.onHover(codes.length ? { codes, x, y } : null);
    if (!same) this.#queueDraw();
  }

  #bindInput() {
    const host = this.host;
    const pts = new Map();
    let drag = null; // { x, y, moved }
    let pinch = null; // { dist, mx, my }
    const rel = (e) => {
      const r = host.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    host.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.v) return;
      if (e.target.closest("button")) return; // overlay controls handle themselves
      host.setPointerCapture(e.pointerId);
      const [x, y] = rel(e);
      pts.set(e.pointerId, { x, y });
      this.anim = null;
      if (pts.size === 1) drag = { x, y, moved: false };
      else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        drag = null;
      }
      this.#setMapHover([], 0, 0);
    });

    host.addEventListener("pointermove", (e) => {
      const [x, y] = rel(e);
      if (!pts.has(e.pointerId)) {
        if (e.pointerType === "mouse" && !pts.size) this.#setMapHover(this.#hit(x, y), x, y);
        return;
      }
      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, { x, y });
      if (pts.size === 1 && drag) {
        if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) > 4) {
          drag.moved = true;
          host.style.cursor = "grabbing";
        }
        if (drag.moved) {
          this.v = { cx: this.v.cx - (x - prev.x) / this.v.k, cy: this.v.cy - (y - prev.y) / this.v.k, k: this.v.k };
          this.#queueDraw();
        }
      } else if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        this.v = { cx: this.v.cx - (mx - pinch.mx) / this.v.k, cy: this.v.cy - (my - pinch.my) / this.v.k, k: this.v.k };
        if (pinch.dist > 0) this.#zoomAt(mx, my, dist / pinch.dist);
        pinch = { dist, mx, my };
        this.#queueDraw();
      }
    });

    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      const [x, y] = rel(e);
      const wasClick = e.type === "pointerup" && pts.size === 1 && drag && !drag.moved;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!pts.size) {
        drag = null;
        host.style.cursor = "";
      }
      if (wasClick) this.opts.onPick(this.#hit(x, y));
    };
    host.addEventListener("pointerup", end);
    host.addEventListener("pointercancel", end);
    host.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse" && !pts.size) this.#setMapHover([], 0, 0);
    });

    host.addEventListener(
      "wheel",
      (e) => {
        if (!this.v) return;
        e.preventDefault();
        const [x, y] = rel(e);
        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        this.#zoomAt(x, y, Math.exp(-dy * 0.0015));
      },
      { passive: false },
    );

    host.addEventListener("keydown", (e) => {
      if (!this.v || e.ctrlKey || e.metaKey || e.altKey) return;
      const step = 80 / this.v.k;
      const pan = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (pan) {
        e.preventDefault();
        this.#moveTo({ cx: this.v.cx + pan[0], cy: this.v.cy + pan[1], k: this.v.k }, false);
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        this.zoomBy(1.6);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        this.zoomBy(1 / 1.6);
      }
    });
  }

  /* ---------- drawing ---------- */
  #queueDraw() {
    if (this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame((now) => {
      this.drawQueued = false;
      this.#step(now);
      this.#draw();
      if (this.anim) this.#queueDraw();
    });
  }

  #draw() {
    if (!this.W || !this.v) return;
    const { ctx, dpr, W, H, col } = this;
    const { cx, cy, k } = this.v;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(k * dpr, 0, 0, k * dpr, (W / 2 - cx * k) * dpr, (H / 2 - cy * k) * dpr);
    ctx.lineJoin = "round";
    const vx0 = cx - W / 2 / k;
    const vx1 = cx + W / 2 / k;
    const vy0 = cy - H / 2 / k;
    const vy1 = cy + H / 2 / k;
    this.#drawTiles(vx0, vx1, vy0, vy1);
    const paint = (z, fill, stroke, lw) => {
      for (const p of z.parts) {
        const b = p.b;
        if (b[2] < vx0 || b[0] > vx1 || b[3] < vy0 || b[1] > vy1) continue;
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fill(p.path, "evenodd");
        }
        if (stroke) {
          ctx.lineWidth = lw / k;
          ctx.strokeStyle = stroke;
          ctx.stroke(p.path);
        }
      }
    };

    const m = this.matched;
    const ink = col.ink;
    const acc = col.accent;
    const neutralFill = this.#rgba(ink, 0.06);
    const neutralLine = this.#rgba(ink, 0.3);
    const dimLine = this.#rgba(ink, 0.24);
    for (const z of this.order) {
      if (!m) paint(z, neutralFill, neutralLine, 0.7);
      else if (!m.has(z.code)) paint(z, null, dimLine, 0.6);
    }
    // Highlights are outline-only so the street map underneath stays readable.
    const accent = this.#rgba(acc, 1);
    if (m) for (const z of this.order) if (m.has(z.code)) paint(z, null, accent, 1.6);

    const hover = new Set(this.mapHover);
    if (this.listHover) hover.add(this.listHover);
    for (const c of hover) {
      const z = this.zones.get(c);
      if (z) paint(z, null, accent, 2);
    }
    const sel = this.selected && this.zones.get(this.selected);
    if (sel) paint(sel, null, accent, 2.6);

    this.#drawLabels(sel, hover, m);
  }

  /* ---------- basemap tiles ---------- */
  #tile(z, x, y, load) {
    const key = `${z}/${x}/${y}`;
    let t = this.tiles.get(key);
    if (t) {
      this.tiles.delete(key); // refresh LRU position
      this.tiles.set(key, t);
      return t;
    }
    if (!load) return null;
    const img = new Image();
    t = { img, ok: false, dark: null };
    img.onload = () => {
      t.ok = true;
      this.#queueDraw();
    };
    // A failed tile is forgotten after 5 s so a flaky connection can retry on a later frame.
    img.onerror = () => setTimeout(() => this.tiles.get(key) === t && this.tiles.delete(key), 5000);
    img.src = `https://tile.openstreetmap.org/${key}.png`;
    this.tiles.set(key, t);
    if (this.tiles.size > 500) this.tiles.delete(this.tiles.keys().next().value);
    return t;
  }

  /* What to draw for a loaded tile: the image, or in the dark theme a filtered copy made once. */
  #source(t) {
    if (this.theme !== "dark" || !this.darkOk) return t.img;
    if (!t.dark) {
      const c = document.createElement("canvas");
      c.width = t.img.naturalWidth;
      c.height = t.img.naturalHeight;
      const g = c.getContext("2d");
      g.filter = AreaMap.DARK_FILTER;
      g.drawImage(t.img, 0, 0);
      t.dark = c;
    }
    return t.dark;
  }

  #drawTiles(vx0, vx1, vy0, vy1) {
    const { ctx, world, v } = this;
    // OSM tiles are 256 px; on high-density screens use one level deeper so they stay sharp.
    const bias = this.dpr >= 1.5 ? 1 : 0;
    const z = Math.max(0, Math.min(AreaMap.MAX_Z, Math.round(Math.log2((v.k * world) / AreaMap.TILE) + bias)));
    const n = 2 ** z;
    const ts = world / n;
    const tx0 = Math.floor(vx0 / ts);
    const tx1 = Math.floor(vx1 / ts);
    const ty0 = Math.max(0, Math.floor(vy0 / ts));
    const ty1 = Math.min(n - 1, Math.floor(vy1 / ts));
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 150) return;
    const seam = 0.5 / v.k; // half a device-independent px of overlap hides hairlines between tiles
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const wx = ((tx % n) + n) % n;
        const t = this.#tile(z, wx, ty, true);
        if (t.ok) {
          ctx.drawImage(this.#source(t), tx * ts, ty * ts, ts + seam, ts + seam);
          continue;
        }
        // Not loaded yet: show the nearest loaded ancestor, cropped and scaled, so zooming never flashes blank.
        for (let dz = 1; dz <= 4 && dz <= z; dz++) {
          const p = this.#tile(z - dz, wx >> dz, ty >> dz, false);
          if (!p || !p.ok) continue;
          const src = this.#source(p);
          const cell = (src.naturalWidth || src.width) / 2 ** dz;
          const sx = (wx - ((wx >> dz) << dz)) * cell;
          const sy = (ty - ((ty >> dz) << dz)) * cell;
          ctx.drawImage(src, sx, sy, cell, cell, tx * ts, ty * ts, ts + seam, ts + seam);
          break;
        }
      }
    }
  }

  #drawLabels(sel, hover, matched) {
    const { ctx, dpr, W, H, col } = this;
    const { cx, cy, k } = this.v;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '500 13px Outfit, system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3.5;
    const halo = this.#rgba(col.bg, 0.75);
    const text = this.#rgba(col.ink, 0.95);

    const queue = [];
    if (sel) queue.push(sel);
    // Hovering a stack of overlays: the code you searched for gets the label.
    const hoverFirst = [...hover].sort((a, b) => (matched?.has(b) ? 1 : 0) - (matched?.has(a) ? 1 : 0));
    for (const c of hoverFirst) {
      const z = this.zones.get(c);
      if (z && z !== sel) queue.push(z);
    }
    const priority = queue.length;
    // Everyone else, biggest first. Unselected zones only get a label when large on screen.
    const seen = new Set(queue);
    for (const z of this.order) {
      if ((matched ? matched.has(z.code) : true) && !seen.has(z)) queue.push(z);
    }

    const placed = [];
    let drawn = 0;
    for (let i = 0; i < queue.length && drawn < 80; i++) {
      const z = queue[i];
      const sw = (z.bbox[2] - z.bbox[0]) * k;
      const sh = (z.bbox[3] - z.bbox[1]) * k;
      if (i >= priority && (sw < 44 || sh < 22)) continue;
      const x = (z.label[0] - cx) * k + W / 2;
      const y = (z.label[1] - cy) * k + H / 2;
      const w = ctx.measureText(z.code).width + 8;
      const h = 18;
      if (x + w / 2 < 0 || x - w / 2 > W || y + h / 2 < 0 || y - h / 2 > H) continue;
      if (placed.some((r) => Math.abs(r[0] - x) < (r[2] + w) / 2 && Math.abs(r[1] - y) < (r[3] + h) / 2)) continue;
      placed.push([x, y, w, h]);
      ctx.strokeStyle = halo;
      ctx.strokeText(z.code, x, y);
      ctx.fillStyle = text;
      ctx.fillText(z.code, x, y);
      drawn++;
    }
  }
}
