// Builds assets/map-data.js: simplified, projected area-code boundary polygons.
// Run AFTER build-data.mjs (reads assets/data.js).   node scripts/build-map.mjs
//
// Source: UCLA Geoportal "North America Telephone Area Code Boundaries" (2015, public domain),
// republished as GeoJSON by https://github.com/1ec5/nanp-boundaries
// Codes created after 2015 (mostly overlays) have no polygon of their own; they reuse the outline of
// the codes they overlay (`alias`).
// The 2015 data outlines only the Northwest Territories for 867 (which also serves Yukon and Nunavut), so
// that one code is rebuilt from Natural Earth 1:50m admin-1 polygons (public domain).
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "assets", "map-data.js");
const URL_GEO = "https://raw.githubusercontent.com/1ec5/nanp-boundaries/master/area-codes.geojson";
const UA = "area-code-search-build/1.0 (static site data build)";
const URL_NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson";
const TERRITORIES_867 = ["Yukon", "Northwest Territories", "Nunavut"];

const WORLD = 2 ** 21; // world width in output units (≈ 19 m per unit at the equator); tile zoom z spans WORLD / 2^z units
const DIV = 1600; // per-feature simplification tolerance = longest side / DIV (≈ 0.5 px when fitted to ~800 px)

function assert(cond, msg) {
  if (!cond) throw new Error("Assertion failed: " + msg);
}

// ---- Web Mercator (EPSG:3857), so outlines line up with slippy-map tiles; y points down like tile rows ----
const D2R = Math.PI / 180;
const MAX_LAT = 85.0511287798;

function project(lon, lat) {
  const s = Math.sin(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * D2R);
  return [((lon + 180) / 360) * WORLD, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD];
}

// ---- Douglas–Peucker (iterative) ----
function simplify(pts, tol) {
  const n = pts.length;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const dx = pts[b][0] - ax;
    const dy = pts[b][1] - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] - ax;
      const py = pts[i][1] - ay;
      let d2;
      if (len2 === 0) d2 = px * px + py * py;
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        d2 = (px - t * dx) ** 2 + (py - t * dy) ** 2;
      }
      if (d2 > maxD) {
        maxD = d2;
        idx = i;
      }
    }
    if (maxD > tol2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const ringArea = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(a) / 2;
};

function ringsOf(geom) {
  if (geom.type === "Polygon") return geom.coordinates;
  if (geom.type === "MultiPolygon") return geom.coordinates.flat();
  throw new Error("Unexpected geometry " + geom.type);
}

function bboxOf(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

function encodeFeature(rawRings) {
  const proj = rawRings.map((r) => r.map(([lon, lat]) => project(lon, lat)));
  const [x0, y0, x1, y1] = bboxOf(proj);
  const tol = Math.max(0.6, Math.max(x1 - x0, y1 - y0) / DIV);
  const rings = [];
  for (const ring of proj) {
    const pts = simplify(ring, tol).map(([x, y]) => [Math.round(x), Math.round(y)]);
    if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop(); // client closes rings
    const dedup = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
    if (dedup.length < 3) continue;
    rings.push({ pts: dedup, area: ringArea(dedup) });
  }
  assert(rings.length > 0, "feature lost all rings");
  const biggest = Math.max(...rings.map((r) => r.area));
  const kept = rings.filter((r) => r.area >= tol * tol * 2 || r.area === biggest);
  return kept.map(({ pts }) => {
    const flat = [pts[0][0], pts[0][1]];
    for (let i = 1; i < pts.length; i++) flat.push(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return flat;
  });
}

function decodeBbox(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) {
    let x = 0, y = 0;
    for (let i = 0; i < r.length; i += 2) {
      x = i === 0 ? r[0] : x + r[i];
      y = i === 0 ? r[1] : y + r[i + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return [x0, y0, x1, y1];
}

async function main() {
  const site = {};
  vm.runInNewContext(readFileSync(resolve(ROOT, "assets", "data.js"), "utf8"), { window: site });
  const entries = site.AREA_CODES;
  assert(Array.isArray(entries) && entries.length > 400, "assets/data.js missing — run scripts/build-data.mjs first");
  const byCode = new Map(entries.map((e) => [e.code, e]));

  const res = await fetch(URL_GEO, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`GET ${URL_GEO} -> HTTP ${res.status}`);
  const text = await res.text();

  // The file has one feature per line; parse line by line to avoid holding a 100 MB object graph.
  const raw = new Map(); // code -> rings (lon/lat)
  let nFeat = 0;
  for (const line of text.split("\n")) {
    if (!line.startsWith('{ "type": "Feature"')) continue;
    const f = JSON.parse(line.trim().replace(/,$/, ""));
    nFeat++;
    const code = String(f.properties.NPA);
    if (!byCode.has(code)) throw new Error(`Boundary for ${code} but the code is not in assets/data.js`);
    if (!f.geometry) continue;
    if (!raw.has(code)) raw.set(code, []);
    let rings = ringsOf(f.geometry);
    // The Aleutians cross the antimeridian: keep Alaska continuous by pushing eastern-hemisphere points west of -180.
    if (code === "907") rings = rings.map((r) => r.map(([x, y]) => [x > 0 ? x - 360 : x, y]));
    raw.get(code).push(...rings);
  }
  assert(nFeat >= 330, `only ${nFeat} features parsed; GeoJSON layout changed?`);

  const neRes = await fetch(URL_NE, { headers: { "User-Agent": UA } });
  if (!neRes.ok) throw new Error(`GET ${URL_NE} -> HTTP ${neRes.status}`);
  const ne = await neRes.json();
  const terr = ne.features.filter((f) => f.properties.admin === "Canada" && TERRITORIES_867.includes(f.properties.name));
  assert(terr.length === TERRITORIES_867.length, `Natural Earth territories found: ${terr.length}`);
  raw.set("867", terr.flatMap((f) => ringsOf(f.geometry)));

  const shapes = {};
  for (const [code, rings] of raw) {
    const enc = encodeFeature(rings);
    shapes[code] = { b: decodeBbox(enc), r: enc };
  }

  // Codes without a polygon reuse the outline of the codes they overlay.
  const alias = {};
  const geographic = entries.filter((e) => e.group !== "OTHER");
  for (let pass = 0; pass < 2; pass++) {
    for (const e of geographic) {
      if (shapes[e.code] || alias[e.code]) continue;
      const src = new Set();
      for (const o of e.overlays) {
        if (shapes[o]) src.add(o);
        else if (pass === 1 && alias[o]) alias[o].forEach((s) => src.add(s));
      }
      if (src.size) alias[e.code] = [...src].sort();
    }
  }
  const unresolved = geographic.filter((e) => !shapes[e.code] && !alias[e.code]).map((e) => e.code);

  // Default view: the continent, Hawaii and the Caribbean (not the Arctic islands or the far-Pacific territories).
  const [vx0, vy1] = project(-170, 10);
  const [vx1, vy0] = project(-50, 72);
  const view = [vx0, vy0, vx1, vy1];

  const data = { world: WORLD, view, shapes, alias };
  const header =
    `/* Generated by scripts/build-map.mjs on ${new Date().toISOString().slice(0, 10)}. ` +
    `Boundaries: UCLA Geoportal "North America Telephone Area Code Boundaries" (2015, public domain) via github.com/1ec5/nanp-boundaries; 867 from Natural Earth (public domain). ` +
    `Web Mercator, world = ${WORLD} units wide, y down. Rings are [x0,y0,dx,dy,...] (even-odd). */\n`;
  const body =
    "window.AREA_MAP = {\n" +
    `world:${WORLD},\nview:${JSON.stringify(view)},\n` +
    "shapes:{\n" +
    Object.keys(shapes).sort().map((c) => `${JSON.stringify(c)}:${JSON.stringify(shapes[c])}`).join(",\n") +
    "\n},\nalias:" + JSON.stringify(alias) + "\n};\n";
  writeFileSync(OUT, header + body);

  const size = statSync(OUT).size;
  const nShapes = Object.keys(shapes).length;
  assert(nShapes >= 330, `only ${nShapes} shapes`);
  assert(size <= 4 * 1024 * 1024, `map-data.js is ${(size / 1048576).toFixed(2)} MB (> 4 MB)`);
  for (const c of ["212", "416", "808", "907", "876"]) assert(shapes[c], `${c} has no shape`);
  assert(alias["346"]?.includes("713"), "346 should reuse 713's outline");
  assert(alias["332"]?.includes("212"), "332 should reuse 212's outline");
  assert(view[2] > view[0] && view[3] > view[1], "empty default view");

  console.log(
    `wrote assets/map-data.js: ${nShapes} outlines + ${Object.keys(alias).length} aliased, ` +
      `${(size / 1048576).toFixed(2)} MB, view ${view.map(Math.round).join(",")}, no outline: [${unresolved.join(", ")}]`,
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
