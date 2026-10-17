// Builds assets/data.js from Wikipedia (code list, regions, descriptions, dates, overlays)
// and Google libphonenumber (cities, time zones). Node >= 18, built-ins only.
//   node scripts/build-data.mjs
import { writeFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "assets", "data.js");
const UA = "area-code-search-build/1.0 (static site data build)";

const URL_WIKI =
  "https://en.wikipedia.org/w/index.php?title=List_of_North_American_Numbering_Plan_area_codes&action=raw";
const URL_GEO =
  "https://raw.githubusercontent.com/google/libphonenumber/master/resources/geocoding/en/1.txt";
const URL_TZ =
  "https://raw.githubusercontent.com/google/libphonenumber/master/resources/timezones/map_data.txt";

const ABBR = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO",
  Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS",
  Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA",
  Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT",
  Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
  "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
  Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA",
  Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
  Alberta: "AB", "British Columbia": "BC", Manitoba: "MB", "New Brunswick": "NB",
  "Newfoundland and Labrador": "NL", "Northwest Territories": "NT", "Nova Scotia": "NS",
  Nunavut: "NU", Ontario: "ON", "Prince Edward Island": "PE", Quebec: "QC",
  Saskatchewan: "SK", Yukon: "YT",
};

const SECTIONS = [
  { heading: "=== United States ===", group: "US", country: "United States" },
  { heading: "=== Canada ===", group: "CA", country: "Canada" },
  { heading: "=== Caribbean and Atlantic islands ===", group: "CAR", country: null },
  { heading: "=== U.S. Pacific territories ===", group: "PAC", country: null },
  { heading: "=== Non-geographic area codes ===", group: "OTHER", country: "Non-geographic" },
];

const CODE_RE = /\b[2-9]\d\d\b/g;

function assert(cond, msg) {
  if (!cond) throw new Error("Assertion failed: " + msg);
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.text();
}

const ENTITIES = { "&nbsp;": " ", "&ndash;": "–", "&mdash;": "—", "&amp;": "&", "&#124;": "|", "&quot;": '"' };

function stripRefs(s) {
  return s
    .replace(/<ref\b[^>]*\/>/gi, "")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

function clean(s) {
  s = stripRefs(s);
  let prev;
  do {
    prev = s;
    s = s.replace(/\{\{[^{}]*\}\}/g, "");
  } while (s !== prev);
  s = s
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/'''|''/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:nbsp|ndash|mdash|amp|quot|#124);/g, (m) => ENTITIES[m]);
  return s.replace(/\s+/g, " ").trim();
}

function sliceBetween(text, startHeading, endHeading) {
  const start = text.indexOf("\n" + startHeading + "\n");
  if (start < 0) throw new Error(`Wikipedia heading not found: ${startHeading}`);
  const end = endHeading === null ? text.length : text.indexOf("\n" + endHeading + "\n", start + 1);
  if (end < 0) throw new Error(`Wikipedia heading not found: ${endHeading}`);
  return text.slice(start + startHeading.length + 2, end);
}

function firstLinkDisplay(cell) {
  const m = cell.match(/\[\[([^\]]+)\]\]/);
  if (!m) throw new Error("No wiki link in label cell: " + cell);
  const parts = m[1].split("|");
  return clean(parts.length > 1 ? parts[1] : parts[0]);
}

function parseRegionTables(wiki) {
  const block = sliceBetween(
    wiki,
    "== Area codes by country, state, province, and regions ==",
    "== Assignment actions by year ==",
  );
  const entries = new Map();
  for (let i = 0; i < SECTIONS.length; i++) {
    const sec = SECTIONS[i];
    const start = block.indexOf("\n" + sec.heading + "\n");
    if (start < 0) throw new Error(`Wikipedia heading not found: ${sec.heading}`);
    const next = block.indexOf("\n===", start + 1);
    const body = block.slice(start, next < 0 ? block.length : next);
    let rows = 0;
    for (const line of body.split("\n")) {
      if (!line.startsWith("| ") || !line.includes(" || ")) continue;
      const k = line.indexOf(" || ");
      const labelCell = line.slice(2, k);
      const codesCell = line.slice(k + 4);
      let region;
      if (sec.group === "OTHER") region = clean(labelCell);
      else region = firstLinkDisplay(labelCell);
      if (sec.group === "PAC" && /Midway/.test(labelCell)) continue;
      const codes = clean(codesCell.replace(/''.*?''/g, "")).match(CODE_RE) || [];
      rows++;
      const country = sec.country ?? region;
      let abbr = null;
      if (sec.group === "US" || sec.group === "CA") {
        abbr = ABBR[region];
        if (!abbr) throw new Error(`No USPS/Canada abbreviation for region "${region}"`);
      }
      for (const code of codes) {
        let e = entries.get(code);
        if (!e) {
          e = { code, group: sec.group, regions: [], abbrs: [], country };
          entries.set(code, e);
        } else if (e.group !== sec.group) {
          throw new Error(`Code ${code} appears in groups ${e.group} and ${sec.group}`);
        }
        if (!e.regions.includes(region)) e.regions.push(region);
        if (abbr && !e.abbrs.includes(abbr)) e.abbrs.push(abbr);
      }
    }
    assert(rows > 0, `no rows parsed in section ${sec.heading}`);
  }
  return entries;
}

const BASE_WORDING =
  /^(?:created as (?:an? )?(?:concentrated )?overlay (?:of|for)|overlay (?:for|with)|overlaid(?!\s+(?:on|by|with)\b))/i;

function parseNumericalTable(wiki, entries) {
  const block = sliceBetween(
    wiki,
    "== Area codes in numerical order ==",
    "== Area codes by country, state, province, and regions ==",
  );
  const meta = new Map(); // code -> { description, since, bases:Set, over:Set }
  const getMeta = (c) => {
    let m = meta.get(c);
    if (!m) meta.set(c, (m = { description: "", since: "", bases: new Set(), over: new Set() }));
    return m;
  };
  for (const chunk of block.split("\n|-")) {
    const cells = [];
    for (const line of chunk.split("\n")) {
      if (/^(\|\}|\{\||!|=)/.test(line)) continue;
      if (line.startsWith("|")) cells.push(line.slice(1));
      else if (cells.length) cells[cells.length - 1] += "\n" + line;
    }
    if (cells.length < 2) continue;
    const key = clean(cells[0]).match(CODE_RE)?.[0];
    if (!key || !entries.has(key) || meta.has(key)) continue;
    const m = getMeta(key);
    m.description = clean(cells[1] ?? "").replace(/^\|\s*/, ""); // source typo on 640: "| | [[New Jersey]]…"
    const rawDate = cells[2] ?? "";
    m.since =
      rawDate.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? rawDate.match(/\b(?:1[89]\d\d|20\d\d)\b/)?.[0] ?? "";
    for (const line of stripRefs(cells[3] ?? "").split("\n")) {
      const kind = line.match(/overlaid\s+(on|by|with)/i)?.[1].toLowerCase();
      if (!kind) {
        // Other wordings that name the base codes of an in-service overlay, e.g.
        // "Created as an overlay of 212, 646…", "Overlay for 312 and 773", "Overlaid 404, 770, 678".
        const text = clean(line).replace(/^\*\s*/, "").replace(/^\d{4}(?:-\d{2}-\d{2})?:\s*/, "");
        if (!BASE_WORDING.test(text)) continue;
        for (const other of text.match(CODE_RE) || []) {
          if (other === key) continue;
          m.over.add(other);
          m.bases.add(other);
        }
        continue;
      }
      for (const lm of line.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
        if (!/^area codes?\b/i.test(lm[1])) continue;
        for (const other of lm[1].match(CODE_RE) || []) {
          if (other === key) continue;
          m.over.add(other);
          if (kind === "on") m.bases.add(other);
        }
      }
    }
  }
  return meta;
}

function parseKeyed(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("|");
    if (i < 0) continue;
    rows.push([line.slice(0, i), line.slice(i + 1)]);
  }
  return rows;
}

const uniqSorted = (arr) => [...new Set(arr)].sort((a, b) => a.localeCompare(b));

async function main() {
  const [wiki, geoText, tzText] = await Promise.all([fetchText(URL_WIKI), fetchText(URL_GEO), fetchText(URL_TZ)]);

  const entries = parseRegionTables(wiki);
  const meta = parseNumericalTable(wiki, entries);

  // Overlay edges: undirected, direct neighbours only, restricted to included codes.
  const overlays = new Map([...entries.keys()].map((c) => [c, new Set()]));
  const bases = new Map([...entries.keys()].map((c) => [c, new Set()]));
  for (const [code, m] of meta) {
    for (const o of m.over) {
      if (!entries.has(o)) continue;
      overlays.get(code).add(o);
      overlays.get(o).add(code);
    }
    for (const b of m.bases) if (entries.has(b)) bases.get(code).add(b);
  }

  // Own cities / zones per code from libphonenumber.
  const ownCities = new Map([...entries.keys()].map((c) => [c, new Set()]));
  for (const [key, value] of parseKeyed(geoText)) {
    if (key[0] !== "1" || key.length < 4) continue;
    const e = entries.get(key.slice(1, 4));
    if (!e) continue;
    const m = value.match(/^(.+), ([A-Z]{2})$/);
    if (m) ownCities.get(e.code).add(m[1]);
    else if ((e.group === "CAR" || e.group === "PAC") && !e.regions.some((r) => r.toLowerCase() === value.toLowerCase()))
      ownCities.get(e.code).add(value);
  }
  const ownZones = new Map([...entries.keys()].map((c) => [c, new Set()]));
  for (const [key, value] of parseKeyed(tzText)) {
    if (key[0] !== "1" || key.length < 4) continue; // map_data.txt covers every country calling code
    const e = entries.get(key.slice(1, 4));
    if (!e) continue;
    for (const z of value.split("&")) ownZones.get(e.code).add(z);
  }

  const out = [];
  for (const code of [...entries.keys()].sort()) {
    const e = entries.get(code);
    const m = meta.get(code);
    const geographic = e.group !== "OTHER";
    const cityPool = [], zonePool = [];
    if (geographic) {
      for (const c of [code, ...bases.get(code)]) {
        cityPool.push(...ownCities.get(c));
        zonePool.push(...ownZones.get(c));
      }
    }
    out.push({
      code,
      group: e.group,
      regions: e.regions,
      abbrs: e.abbrs,
      country: e.country,
      description: m?.description || e.regions[0],
      since: m?.since ?? "",
      overlays: [...overlays.get(code)].sort(),
      zones: uniqSorted(zonePool),
      cities: uniqSorted(cityPool),
    });
  }

  const byCode = Object.fromEntries(out.map((e) => [e.code, e]));
  const G = out.filter((e) => e.group !== "OTHER").length;
  const O = out.length - G;
  const nCities = new Set(out.flatMap((e) => e.cities)).size;
  const noTz = out.filter((e) => e.group !== "OTHER" && e.zones.length === 0).map((e) => e.code);

  const header =
    `/* Generated by scripts/build-data.mjs on ${new Date().toISOString().slice(0, 10)}. ` +
    `Sources: Wikipedia "List of North American Numbering Plan area codes" (CC BY-SA 4.0); ` +
    `Google libphonenumber geocoding + timezone data (Apache-2.0). */\n`;
  const js = header + "window.AREA_CODES = [\n" + out.map((e) => JSON.stringify(e)).join(",\n") + "\n];\n";
  writeFileSync(OUT, js);

  // Assertions.
  const size = statSync(OUT).size;
  assert(G >= 400 && G <= 520, `geographic count ${G} not in 400..520`);
  assert(out.every((e) => e.regions.length >= 1), "every entry needs >=1 region");
  assert(O >= 7, `non-geographic count ${O} < 7`);
  assert(size <= 400 * 1024, `data.js is ${size} bytes (> 400 KB)`);
  const has = (code, field, v) => byCode[code]?.[field].includes(v);
  assert(byCode["212"]?.regions[0] === "New York", "212 region");
  assert(has("212", "zones", "America/New_York"), "212 zone");
  assert(has("212", "overlays", "646"), "212 overlays 646");
  assert(has("212", "cities", "New York"), "212 city New York");
  assert(byCode["416"]?.country === "Canada", "416 country");
  assert(has("416", "cities", "Toronto"), "416 city Toronto");
  assert(has("312", "cities", "Chicago"), "312 city Chicago");
  assert(has("305", "cities", "Miami"), "305 city Miami");
  assert(byCode["876"]?.country === "Jamaica", "876 country");
  assert(JSON.stringify(byCode["808"]?.regions) === '["Hawaii"]', "808 regions " + JSON.stringify(byCode["808"]?.regions));
  assert(byCode["867"]?.regions.length === 3, "867 regions " + JSON.stringify(byCode["867"]?.regions));
  assert(byCode["888"]?.group === "OTHER", "888 group");
  assert(has("346", "cities", "Houston"), "346 inherits Houston");
  assert(byCode["313"]?.regions[0] === "Michigan", "313 region");
  assert(byCode["679"]?.regions.includes("Michigan"), "679 exists in Michigan");
  assert(JSON.stringify(byCode["808"]?.zones) === '["Pacific/Honolulu"]', "808 zones " + JSON.stringify(byCode["808"]?.zones));
  assert(JSON.stringify(byCode["416"]?.zones) === '["America/Toronto"]', "416 zones " + JSON.stringify(byCode["416"]?.zones));

  console.log(
    `wrote assets/data.js: ${out.length} codes (${G} geographic, ${O} non-geographic), ${nCities} cities, ` +
      `${(size / 1024).toFixed(0)} KB, codes without time zone: [${noTz.join(", ")}]`,
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
