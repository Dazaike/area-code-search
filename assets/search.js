/* Pure search logic for the area code list. No DOM; classic script so it also loads in a Node vm. */

function normalizeText(s) {
  return String(s)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* Adds normalized caches to every entry (in place) and returns the same array. */
function prepareEntries(entries) {
  for (const e of entries) {
    e._regions = e.regions.map(normalizeText);
    e._abbrs = e.abbrs.map(normalizeText);
    e._country = normalizeText(e.country);
    e._cities = e.cities.map(normalizeText);
    e._hay =
      " " + normalizeText([e.code, e.regions, e.abbrs, e.country, e.description, e.cities].flat().join(" ")) + " ";
  }
  return entries;
}

const PHONE_RE = /^\s*(?:\+?1[\s.-]*)?\(?([2-9]\d\d)\)?[\s.-]*\d{3}[\s.-]*\d{4}\s*$/;

function tokenPasses(e, token) {
  return token.length >= 3 ? e._hay.includes(token) : e._abbrs.includes(token);
}

function tierOf(e, q) {
  if (e._cities.some((c) => c === q)) return 100;
  if (e._regions.includes(q) || (q.length <= 2 && !q.includes(" ") && e._abbrs.includes(q))) return 80;
  if (e._cities.some((c) => c.startsWith(q))) return 60;
  if (e._regions.some((r) => r.startsWith(q)) || e._country.startsWith(q)) return 40;
  return 20;
}

/* Up to 3 original-cased cities that explain a text match. Short queries (<3 chars) matched by
   abbreviation only, so substring-matching city names would just be noise. */
function matchCities(e, q, tokens) {
  const pick = (test) => {
    const out = [];
    for (let i = 0; i < e._cities.length && out.length < 3; i++) if (test(e._cities[i])) out.push(e.cities[i]);
    return out;
  };
  if (q.length < 3) return [];
  const whole = pick((c) => c.includes(q));
  if (whole.length || tokens.length < 2) return whole;
  const long = tokens.filter((t) => t.length >= 3);
  return long.length ? pick((c) => long.some((t) => c.includes(t))) : [];
}

/* group: "ALL" | "US" | "CA" | "CAR" | "PAC" | "OTHER". Returns [{ entry, matchedCities }]. */
function searchAreaCodes(entries, query, group) {
  const pool = group && group !== "ALL" ? entries.filter((e) => e.group === group) : entries;
  const q = normalizeText(query);
  if (!q) return pool.map((entry) => ({ entry, matchedCities: [] }));

  const phone = PHONE_RE.exec(query);
  if (phone) {
    const hit = pool.find((e) => e.code === phone[1]);
    return hit ? [{ entry: hit, matchedCities: [] }] : [];
  }

  if (/^\d{1,3}$/.test(q)) {
    return pool
      .filter((e) => e.code.startsWith(q))
      .sort((a, b) => (a.code === q ? -1 : b.code === q ? 1 : a.code < b.code ? -1 : 1))
      .map((entry) => ({ entry, matchedCities: [] }));
  }

  const tokens = q.split(" ");
  const scored = [];
  for (const e of pool) {
    if (tokens.every((t) => tokenPasses(e, t))) scored.push({ e, tier: tierOf(e, q) });
  }
  scored.sort((a, b) => b.tier - a.tier || (a.e.code < b.e.code ? -1 : 1));
  return scored.map(({ e }) => ({ entry: e, matchedCities: matchCities(e, q, tokens) }));
}
